import base64
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ["ANALYSIS_MODE"] = "demo"
os.environ["SERVICE_TOKEN"] = "test-service-token-" + "x" * 40
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fitz
from fastapi import HTTPException
from fastapi.testclient import TestClient
from main import app, FilePayload, Document, ProposedPoint, ProposedAnalysis, demo_analysis, extract, match_points, openai_analysis


def point(**overrides):
    values = dict(description="Please provide the hospital bill.", requirement_type="document",
                  document_type="hospital_bill", reason="The insurer asks for the bill.",
                  qualifiers="", matched_doc_id=None, evidence=None, confidence=1)
    values.update(overrides)
    return ProposedPoint(**values)


def payload(content, mime="text/plain", synthetic=True):
    return FilePayload(file_name="fixture", mime_type=mime, file_base64=base64.b64encode(content).decode(), is_synthetic=synthetic)


class AnalysisTests(unittest.TestCase):
    def test_generic_existing_document_is_never_requested_again(self):
        docs = [Document(id="doc1", original_name="bill.txt", doc_type="hospital_bill", extracted_text="Hospital Bill INR 1000")]
        result = match_points(ProposedAnalysis(points=[point()]), docs)
        self.assertEqual(result[0]["status"], "available")
        self.assertEqual(result[0]["matched_doc_id"], "doc1")

    def test_wrong_category_and_similar_filename_do_not_match(self):
        docs = [Document(id="doc1", original_name="hospital-bill-policy.pdf", doc_type="policy_copy", extracted_text="Policy")]
        self.assertEqual(match_points(ProposedAnalysis(points=[point()]), docs)[0]["status"], "missing")

    def test_qualified_document_needs_evidence(self):
        docs = [Document(id="doc1", original_name="bill.txt", doc_type="hospital_bill", extracted_text="Generic hospital bill")]
        result = match_points(ProposedAnalysis(points=[point(qualifiers="Itemized bill for 2 January 2026")]), docs)
        self.assertEqual(result[0]["status"], "missing")

    def test_qualified_document_with_grounded_quote_matches(self):
        quote = "Itemized hospital bill dated 2 January 2026"
        docs = [Document(id="doc1", original_name="bill.txt", doc_type="hospital_bill", extracted_text=quote)]
        result = match_points(ProposedAnalysis(points=[point(qualifiers="Itemized, 2 January", matched_doc_id="doc1", evidence=quote)]), docs)
        self.assertEqual(result[0]["status"], "available")

    def test_invented_evidence_is_rejected(self):
        docs = [Document(id="doc1", original_name="bill.txt", doc_type="hospital_bill", extracted_text="Generic bill")]
        result = match_points(ProposedAnalysis(points=[point(qualifiers="signed", matched_doc_id="doc1", evidence="A signed stamped bill")]), docs)
        self.assertEqual(result[0]["status"], "missing")

    def test_document_from_another_patient_is_rejected(self):
        result = match_points(ProposedAnalysis(points=[point(qualifiers="signed", matched_doc_id="other-patient", evidence="Signed bill exists")]), [])
        self.assertEqual(result[0]["status"], "missing")

    def test_clarification_is_not_satisfied_by_generic_category(self):
        docs = [Document(id="doc1", original_name="history.txt", doc_type="previous_medical_history", extracted_text="History record")]
        result = match_points(ProposedAnalysis(points=[point(requirement_type="clarification", document_type=None)]), docs)
        self.assertEqual(result[0]["status"], "clarification_needed")

    def test_explicit_written_answer_can_satisfy_clarification(self):
        quote = "The notification delay was caused by a network outage."
        docs = [Document(id="doc1", original_name="explanation.txt", doc_type="other", extracted_text=quote)]
        result = match_points(ProposedAnalysis(points=[point(requirement_type="clarification", document_type=None, matched_doc_id="doc1", evidence=quote)]), docs)
        self.assertEqual(result[0]["status"], "available")

    def test_low_confidence_stops_all_automatic_requests(self):
        with self.assertRaises(HTTPException):
            match_points(ProposedAnalysis(points=[point(confidence=0.4)]), [])

    def test_demo_splits_multiple_requested_documents(self):
        result = demo_analysis("SYNTHETIC DEMO QUERY\n1. Please provide the hospital bill and policy copy.\n2. Explain the delay.")
        self.assertEqual(len(result.points), 3)
        self.assertEqual(result.points[2].requirement_type, "clarification")

    def test_unseen_letters_are_not_silently_processed_by_demo_rules(self):
        with self.assertRaises(HTTPException):
            demo_analysis("Dear team,\n1. Please provide hospital bill.")

    def test_extract_utf8_and_pdf(self):
        self.assertIn("fictional", extract(payload(b"This is a fictional test document.")))
        with fitz.open() as pdf:
            page = pdf.new_page()
            page.insert_text((50, 50), "This is a fictional readable discharge summary document.")
            content = pdf.tobytes()
        self.assertIn("discharge", extract(payload(content, "application/pdf")))

    def test_image_uses_ocr_not_pdf_parser(self):
        with fitz.open() as pdf:
            page = pdf.new_page(width=100, height=100)
            image = page.get_pixmap().tobytes("png")
        with patch("main.vision_text", return_value="Fictional OCR transcription") as ocr:
            self.assertEqual(extract(payload(image, "image/png")), "Fictional OCR transcription")
            ocr.assert_called_once()

    def test_real_patient_data_is_blocked_before_provider_call(self):
        with patch("main.client") as provider:
            with self.assertRaises(HTTPException) as error:
                extract(payload(b"Do not send this real patient text", synthetic=False))
            self.assertEqual(error.exception.status_code, 403)
            provider.assert_not_called()

    def test_empty_corrupt_and_oversized_text_fail_explicitly(self):
        for content in [b"", b"\xff\xff", b"x", b"a" * 100001]:
            with self.assertRaises(HTTPException):
                extract(payload(content))

    def test_internal_auth_required_and_full_api_shape(self):
        with TestClient(app) as client:
            data = payload(b"SYNTHETIC DEMO QUERY\n1. Please provide the policy copy.").model_dump()
            data["documents"] = []
            self.assertEqual(client.post("/analyze", json=data).status_code, 401)
            response = client.post("/analyze", json=data, headers={"X-Service-Token": os.environ["SERVICE_TOKEN"]})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["points"][0]["status"], "missing")

    def test_openai_uses_validated_structured_output_and_retains_every_point(self):
        import json
        from types import SimpleNamespace
        structured = ProposedAnalysis(points=[point(), point(requirement_type="clarification", document_type=None)])
        response = SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=structured.model_dump_json()))])
        with patch("main.client") as provider:
            provider.return_value.chat.completions.create.return_value = response
            result = openai_analysis("A fictional insurer query letter", [])
            self.assertEqual(len(result.points), 2)
            arguments = provider.return_value.chat.completions.create.call_args.kwargs
            schema = arguments["response_format"]["json_schema"]
            self.assertTrue(schema["strict"])
            self.assertFalse(schema["schema"]["additionalProperties"])
            self.assertEqual(json.loads(arguments["messages"][1]["content"])["locker_documents"], [])

    def test_truncated_model_responses_are_not_treated_as_complete_letters(self):
        from types import SimpleNamespace
        response = SimpleNamespace(choices=[SimpleNamespace(finish_reason="length", message=SimpleNamespace(content='{"points":[]}'))])
        with patch("main.client") as provider:
            provider.return_value.chat.completions.create.return_value = response
            with self.assertRaises(HTTPException):
                openai_analysis("A fictional insurer query letter", [])


if __name__ == "__main__":
    unittest.main()
