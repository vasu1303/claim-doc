import os
import io
import json
import re
import logging
from typing import List, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
import requests
import openai
from dotenv import load_dotenv
import psycopg2
import psycopg2.extras

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Locker AI Service", version="1.0.0")

openai.api_key = os.getenv("OPENAI_API_KEY")

# ─────────────────────────────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────────────────────────────

class ProcessQueryPayload(BaseModel):
    query_id: str
    patient_id: str
    patient_short_id: Optional[str] = None
    file_url: str

class QueryPoint(BaseModel):
    id: int
    description: str
    requirement_type: str  # document | clarification
    document_type: Optional[str] = None

# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(
        os.getenv("DATABASE_URL"),
        cursor_factory=psycopg2.extras.RealDictCursor
    )


def update_query_status(query_id: str, status: str, raw_text: str = None):
    conn = get_conn()
    try:
        cur = conn.cursor()
        if raw_text:
            cur.execute(
                "UPDATE queries SET status=%s, raw_text=%s, processed_at=NOW() WHERE id=%s",
                (status, raw_text, query_id)
            )
        else:
            cur.execute(
                "UPDATE queries SET status=%s, processed_at=NOW() WHERE id=%s",
                (status, query_id)
            )
        conn.commit()
    finally:
        conn.close()


def save_query_points(query_id: str, points: List[QueryPoint], matches: list):
    conn = get_conn()
    try:
        cur = conn.cursor()
        match_map = {m['point_id']: m for m in matches}
        for pt in points:
            m = match_map.get(pt.id, {})
            matched_doc_id = m.get('doc_id')
            status = m.get('status', 'missing')
            cur.execute(
                """INSERT INTO query_points (query_id, point_index, description, requirement_type, document_type, status, matched_doc_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (query_id, pt.id, pt.description, pt.requirement_type, pt.document_type, status, matched_doc_id)
            )
        conn.commit()
    finally:
        conn.close()


def get_patient_documents(patient_id: str) -> list:
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, file_name, original_name, doc_type, doc_category FROM documents WHERE patient_id=%s",
            (patient_id,)
        )
        return cur.fetchall()
    finally:
        conn.close()


def get_patient_info(patient_id: str) -> dict:
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM patients WHERE id=%s", (patient_id,))
        row = cur.fetchone()
        return dict(row) if row else {}
    finally:
        conn.close()

# ─────────────────────────────────────────────────────────────────────────────
# PDF Extraction
# ─────────────────────────────────────────────────────────────────────────────

def extract_text_from_pdf(content: bytes) -> str:
    import PyPDF2
    try:
        reader = PyPDF2.PdfReader(io.BytesIO(content))
        text = ""
        for page in reader.pages:
            text += (page.extract_text() or "") + "\n"
        return text.strip()
    except Exception as e:
        logger.error(f"PDF extraction error: {e}")
        return ""


def download_file(url: str) -> bytes:
    # Try with MinIO credentials
    auth = None
    minio_user = os.getenv("MINIO_ROOT_USER")
    minio_pass = os.getenv("MINIO_ROOT_PASSWORD")
    if minio_user and minio_pass:
        auth = (minio_user, minio_pass)
    resp = requests.get(url, auth=auth, timeout=30)
    resp.raise_for_status()
    return resp.content

# ─────────────────────────────────────────────────────────────────────────────
# LLM: Decompose query letter into structured points
# ─────────────────────────────────────────────────────────────────────────────

DECOMPOSE_PROMPT = """
You are an expert insurance claims analyst in India.
Given the following insurer query letter, extract every individual item the insurer is requesting.
Return a JSON array only (no markdown, no prose). Each element must have:
- "id": integer (1-based)
- "description": short plain-English description of what is being requested
- "requirement_type": "document" if a file/record is needed, "clarification" if an explanation is needed
- "document_type": canonical snake_case document type (e.g. discharge_summary, consultation_notes, hospital_bill, policy_copy, kyc_document, lab_report, prescription, previous_medical_history, claim_form, authorization_letter, id_proof) or null for clarifications

Query letter text:
\"\"\"
{query_text}
\"\"\"

Respond with ONLY the JSON array.
"""


def decompose_query(text: str) -> List[QueryPoint]:
    client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    prompt = DECOMPOSE_PROMPT.format(query_text=text)
    response = client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1000,
        temperature=0,
    )
    raw = response.choices[0].message.content.strip()
    # Strip markdown code fences if present
    raw = re.sub(r'^```[\w]*\n?', '', raw)
    raw = re.sub(r'\n?```$', '', raw)
    items = json.loads(raw)
    return [QueryPoint(**item) for item in items]

# ─────────────────────────────────────────────────────────────────────────────
# Document Matching (semantic + exact)
# ─────────────────────────────────────────────────────────────────────────────

DOC_TYPE_ALIASES = {
    "discharge_summary": ["discharge", "discharge summary", "discharge report", "final discharge"],
    "hospital_bill": ["bill", "invoice", "billing", "hospital bill", "final bill", "itemized bill"],
    "consultation_notes": ["consultation", "consult notes", "doctor notes", "treating doctor", "clinical notes"],
    "lab_report": ["lab", "laboratory", "test report", "investigation", "blood test", "pathology"],
    "prescription": ["prescription", "medicine", "rx"],
    "policy_copy": ["policy", "insurance policy", "policy document", "policy schedule"],
    "kyc_document": ["kyc", "aadhaar", "pan", "id proof", "identity", "id card"],
    "claim_form": ["claim form", "claim application"],
    "previous_medical_history": ["medical history", "previous history", "past history", "prior treatment"],
    "authorization_letter": ["authorization", "auth letter", "pre-auth", "preauth"],
    "id_proof": ["id proof", "identity proof", "aadhaar", "pan card", "passport"],
}


def normalize(text: str) -> str:
    return text.lower().replace('_', ' ').replace('-', ' ').strip()


def doc_matches_requirement(doc: dict, req_doc_type: str) -> bool:
    """Check if a stored document matches a requested document type."""
    if not req_doc_type:
        return False
    req_norm = normalize(req_doc_type)
    doc_type_norm = normalize(doc.get('doc_type', ''))
    doc_name_norm = normalize(doc.get('original_name', ''))

    # Exact match
    if req_norm == doc_type_norm:
        return True

    # Alias match
    aliases = DOC_TYPE_ALIASES.get(req_doc_type, [])
    for alias in aliases:
        if alias in doc_type_norm or alias in doc_name_norm:
            return True
    # Check if required type's aliases match stored doc type
    for canonical, aliases_list in DOC_TYPE_ALIASES.items():
        if req_norm in aliases_list or req_norm == normalize(canonical):
            if normalize(canonical) == doc_type_norm:
                return True
            for alias in aliases_list:
                if alias in doc_type_norm or alias in doc_name_norm:
                    return True
    return False


def match_documents(patient_docs: list, points: List[QueryPoint]) -> list:
    matches = []
    for pt in points:
        if pt.requirement_type == "clarification":
            matches.append({'point_id': pt.id, 'status': 'clarification_needed', 'doc_id': None, 'doc_name': None})
            continue
        found = None
        for doc in patient_docs:
            if doc_matches_requirement(doc, pt.document_type):
                found = doc
                break
        if found:
            matches.append({'point_id': pt.id, 'status': 'available', 'doc_id': str(found['id']), 'doc_name': found.get('original_name')})
        else:
            matches.append({'point_id': pt.id, 'status': 'missing', 'doc_id': None, 'doc_name': None})
    return matches

# ─────────────────────────────────────────────────────────────────────────────
# Message Generation
# ─────────────────────────────────────────────────────────────────────────────

MESSAGE_TEMPLATE = """Dear {patient_name},

We hope you are doing well. We have received a query from your insurance company regarding your claim.

After reviewing your documents, we need the following from you:

{required_items}

Please submit these at your earliest convenience so we can process your claim without further delay.

For any questions, please contact our claims team.

Warm regards,
Claims Processing Team
Patient Locker"""


def generate_message(patient_name: str, points: List[QueryPoint], matches: list) -> str:
    match_map = {m['point_id']: m for m in matches}
    required_lines = []
    for i, pt in enumerate(points, 1):
        m = match_map.get(pt.id, {})
        status = m.get('status', 'missing')
        if status == 'available':
            continue
        if status == 'clarification_needed':
            required_lines.append(f"{i}. {pt.description} (Please provide a written explanation)")
        else:
            doc_label = (pt.document_type or '').replace('_', ' ').title() if pt.document_type else 'Required document'
            required_lines.append(f"{i}. {pt.description} — Please submit: {doc_label}")

    if not required_lines:
        items_text = "✅ All requested items are already available in your file. No further action needed from you."
    else:
        items_text = "\n".join(required_lines)

    return MESSAGE_TEMPLATE.format(patient_name=patient_name, required_items=items_text)

# ─────────────────────────────────────────────────────────────────────────────
# Main processing pipeline
# ─────────────────────────────────────────────────────────────────────────────

def process_query_pipeline(payload: ProcessQueryPayload):
    query_id = payload.query_id
    patient_id = payload.patient_id

    try:
        update_query_status(query_id, 'processing')

        # 1. Download PDF
        logger.info(f"Downloading query PDF: {payload.file_url}")
        content = download_file(payload.file_url)

        # 2. Extract text
        raw_text = extract_text_from_pdf(content)
        if not raw_text:
            raw_text = "[PDF text extraction failed – manual review required]"
        update_query_status(query_id, 'processing', raw_text)

        # 3. Decompose with LLM
        logger.info(f"Decomposing query with LLM for query {query_id}")
        points = decompose_query(raw_text)
        logger.info(f"Found {len(points)} query points")

        # 4. Get patient docs
        patient_docs = get_patient_documents(patient_id)
        patient_info = get_patient_info(patient_id)
        logger.info(f"Patient has {len(patient_docs)} documents")

        # 5. Match
        matches = match_documents(patient_docs, points)

        # 6. Save points
        save_query_points(query_id, points, matches)

        # 7. Generate message
        message = generate_message(patient_info.get('name', 'Patient'), points, matches)

        # 8. Send to messenger service
        messenger_url = os.getenv("MESSENGER_URL", "http://localhost:8002")
        messenger_payload = {
            "patient_id": patient_id,
            "query_id": query_id,
            "patient_name": patient_info.get('name'),
            "patient_phone": patient_info.get('phone'),
            "patient_email": patient_info.get('email'),
            "message_body": message,
            "points": [{"id": p.id, "description": p.description, "type": p.requirement_type} for p in points],
            "matches": matches,
        }
        resp = requests.post(f"{messenger_url}/dispatch", json=messenger_payload, timeout=30)
        resp.raise_for_status()

        update_query_status(query_id, 'completed')
        logger.info(f"Query {query_id} processed successfully")

    except Exception as e:
        logger.error(f"Pipeline error for query {query_id}: {e}")
        update_query_status(query_id, 'failed')
        raise


@app.post("/process-query")
async def process_query(payload: ProcessQueryPayload, background_tasks: BackgroundTasks):
    background_tasks.add_task(process_query_pipeline, payload)
    return {"status": "queued", "query_id": payload.query_id}


@app.get("/health")
def health():
    return {"status": "ok", "service": "ai-service"}
