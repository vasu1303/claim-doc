const axios = require('axios');
const path = require('node:path');
const pool = require('./db/pool');
const storage = require('./storage');
const config = require('./config');
const { enqueue, reprocessPatient } = require('./jobs');
const { generateMessage } = require('./message');
const { z } = require('zod');

const pointSchema = z.object({
  description: z.string().min(1).max(2000), requirement_type: z.enum(['document', 'clarification']),
  document_type: z.string().nullable(), reason: z.string().min(1).max(2000), qualifiers: z.string().default(''),
  status: z.enum(['available', 'missing', 'clarification_needed']),
  matched_doc_id: z.string().uuid().nullable(), evidence: z.string().nullable(),
});
const analysisSchema = z.object({ raw_text: z.string().min(1), points: z.array(pointSchema).min(1).max(100) });
const headers = () => ({ 'X-Service-Token': config.serviceToken });
const mimeForName = (name) => ({ '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain' }[path.extname(name).toLowerCase()]);
async function callAI(endpoint, payload) {
  return (await axios.post(`${config.aiUrl}${endpoint}`, payload, { headers: headers(), timeout: 180000, maxBodyLength: 40 * 1024 * 1024 })).data;
}
async function processDocument(job) {
  const { rows } = await pool.query('SELECT d.*,p.is_synthetic FROM documents d JOIN patients p ON p.id=d.patient_id WHERE d.id=$1', [job.entity_id]);
  const d = rows[0];
  if (!d) throw new Error('Document no longer exists.');
  const result = z.object({ text: z.string().min(1).max(100000) }).parse(await callAI('/extract', {
    file_name: d.original_name, mime_type: d.mime_type, file_base64: (await storage.get(d.file_name)).toString('base64'), is_synthetic: d.is_synthetic,
  }));
  await pool.transaction(async (db) => {
    await db.query("UPDATE documents SET extracted_text=$1,extraction_status='completed' WHERE id=$2", [result.text, d.id]);
    await reprocessPatient(d.patient_id, db);
  });
}
async function processQuery(job) {
  const { rows } = await pool.query('SELECT q.*,p.is_synthetic,p.name,p.phone,p.email,p.patient_id AS short_id FROM queries q JOIN patients p ON p.id=q.patient_id WHERE q.id=$1', [job.entity_id]);
  const q = rows[0];
  if (!q) throw new Error('Query no longer exists.');
  if (job.job_key !== `query:${q.id}:${q.revision}`) return;
  if (!q.storage_key) throw new Error('Legacy query must be re-uploaded to private storage.');
  const docs = (await pool.query('SELECT id,original_name,doc_type,extracted_text,extraction_status FROM documents WHERE patient_id=$1', [q.patient_id])).rows;
  if (docs.some((d) => d.extraction_status === 'pending')) {
    const err = new Error('Waiting for uploaded documents to be indexed.');
    err.waiting = true;
    throw err;
  }
  if (docs.some((d) => d.extraction_status === 'failed')) {
    throw Object.assign(new Error('A locker document could not be read. Replace it with a readable file before retrying this query.'), { permanent: true });
  }
  await pool.query("UPDATE queries SET status='processing',error=NULL WHERE id=$1", [q.id]);
  const start = Date.now();
  const result = analysisSchema.parse(await callAI('/analyze', {
    file_name: q.file_name, mime_type: mimeForName(q.file_name),
    file_base64: (await storage.get(q.storage_key)).toString('base64'), is_synthetic: q.is_synthetic,
    documents: docs.map(({ extraction_status, ...doc }) => doc),
  }));
  const docIds = new Set(docs.map((d) => d.id));
  if (result.points.some((p) => (p.matched_doc_id && !docIds.has(p.matched_doc_id)) || (p.status === 'available' && !p.matched_doc_id))) {
    throw new Error('Analysis returned invalid document evidence.');
  }
  const message = generateMessage({ ...q, id: q.patient_id, patient_id: q.short_id }, result.points);
  await pool.transaction(async (db) => {
    await db.query('DELETE FROM query_points WHERE query_id=$1', [q.id]);
    for (const [index, p] of result.points.entries()) {
      await db.query(
        `INSERT INTO query_points(query_id,point_index,description,requirement_type,document_type,status,matched_doc_id,reason,qualifiers,evidence)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [q.id, index + 1, p.description, p.requirement_type, p.document_type, p.status, p.matched_doc_id, p.reason, p.qualifiers, p.evidence]
      );
    }
    const previous = await db.query('SELECT message_body FROM messages WHERE query_id=$1 ORDER BY revision DESC LIMIT 1', [q.id]);
    if (previous.rows[0]?.message_body !== message) {
      const { rows: msgs } = await db.query(
        `INSERT INTO messages(patient_id,query_id,message_body,revision,delivery_mode) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(query_id,revision) DO UPDATE SET message_body=EXCLUDED.message_body RETURNING id`,
        [q.patient_id, q.id, message, q.revision, process.env.DELIVERY_MODE || 'mock']
      );
      await enqueue('dispatch', msgs[0].id, `dispatch:${msgs[0].id}`, db);
    }
    await db.query("UPDATE queries SET status='completed',raw_text=$1,error=NULL,processed_at=NOW(),duration_ms=$2 WHERE id=$3",
      [result.raw_text, Date.now() - start, q.id]);
    await db.query("UPDATE patients SET claim_status=$1,updated_at=NOW() WHERE id=$2",
      [result.points.some((p) => p.status !== 'available') ? 'awaiting_documents' : 'processing', q.patient_id]);
  });
}
async function dispatchMessage(job) {
  const { rows } = await pool.query(
    'SELECT m.*,p.is_synthetic,p.phone,p.email FROM messages m JOIN patients p ON p.id=m.patient_id WHERE m.id=$1', [job.entity_id]
  );
  const message = rows[0];
  if (!message) throw new Error('Message no longer exists.');
  for (const channel of ['whatsapp', 'email']) {
    if (!['pending', 'retrying'].includes(message[`${channel}_status`])) continue;
    // Persist the attempt before the network call. Crash recovery treats ambiguous sends as unknown, not as safe retries.
    await pool.query(`UPDATE messages SET ${channel}_status='sending',updated_at=NOW() WHERE id=$1`, [message.id]);
    let result;
    try {
      result = (await axios.post(`${config.messengerUrl}/send/${channel}`, {
        idempotency_key: `${message.id}-${channel}`, message_body: message.message_body,
        to: channel === 'email' ? message.email : message.phone,
        is_synthetic: message.is_synthetic,
      }, { headers: headers(), timeout: 30000 })).data;
      result = z.object({
        status: z.enum(['sent', 'mock_sent', 'failed', 'retrying', 'unknown']),
        message_id: z.string().nullable(), error: z.string().nullable(),
      }).parse(result);
    } catch (err) {
      console.error(`Dispatch ${channel} transport error:`, err.code || 'invalid response');
      result = { status: 'unknown', message_id: null, error: 'Delivery outcome is unknown. Check the provider before resending to avoid duplicates.' };
    }
    await pool.query(
      `UPDATE messages SET ${channel}_status=$1::text,${channel}_message_id=$2,${channel}_error=$3,
       sent_at=CASE WHEN $1::text IN ('sent','mock_sent') THEN COALESCE(sent_at,NOW()) ELSE sent_at END,updated_at=NOW() WHERE id=$4`,
      [result.status, result.message_id, result.error, message.id]
    );
    message[`${channel}_status`] = result.status;
  }
  if (['whatsapp', 'email'].some((c) => message[`${c}_status`] === 'retrying')) throw new Error('Provider rejected a transient delivery attempt; retry scheduled.');
}
async function runOneJob() {
  const { rows } = await pool.query(
    `UPDATE jobs SET status='running',locked_at=NOW(),attempts=attempts+1 WHERE id=(
       SELECT id FROM jobs WHERE status='pending' AND available_at<=NOW()
       ORDER BY CASE kind WHEN 'dispatch' THEN 0 WHEN 'document' THEN 1 ELSE 2 END,created_at
       FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`
  );
  const job = rows[0];
  if (!job) return false;
  try {
    if (job.kind === 'document') await processDocument(job);
    else if (job.kind === 'query') await processQuery(job);
    else if (job.kind === 'dispatch') await dispatchMessage(job);
    else throw new Error('Unknown job type.');
    await pool.query("UPDATE jobs SET status='completed',locked_at=NULL,error=NULL WHERE id=$1", [job.id]);
  } catch (err) {
    const providerDetail = err.response?.data?.detail;
    const safeError = typeof providerDetail === 'string' ? providerDetail.slice(0, 500)
      : err.response ? `Analysis service returned HTTP ${err.response.status}. Check its configuration and availability.` : err.message;
    const permanent = err.permanent || [400, 401, 403, 413, 422].includes(err.response?.status);
    const failed = permanent || (!err.waiting && job.attempts >= 4);
    console.error(`Job ${job.kind} ${job.id}: ${safeError}`);
    await pool.query(
      `UPDATE jobs SET status=$1,error=$2,locked_at=NULL,attempts=CASE WHEN $3 THEN attempts-1 ELSE attempts END,
       available_at=NOW()+($4 * INTERVAL '1 second') WHERE id=$5`,
      [failed ? 'failed' : 'pending', safeError, Boolean(err.waiting), err.waiting ? 2 : Math.min(60, 5 * 2 ** (job.attempts - 1)), job.id]
    );
    if (job.kind === 'query') await pool.query('UPDATE queries SET status=$1,error=$2 WHERE id=$3',
      [failed ? 'needs_review' : 'pending', safeError, job.entity_id]);
    if (failed && job.kind === 'document') await pool.query("UPDATE documents SET extraction_status='failed' WHERE id=$1", [job.entity_id]);
    if (failed && job.kind === 'dispatch') {
      for (const channel of ['whatsapp', 'email']) await pool.query(
        `UPDATE messages SET ${channel}_status='failed',${channel}_error=$1 WHERE id=$2 AND ${channel}_status='retrying'`,
        ['Delivery retries exhausted. Check provider configuration.', job.entity_id]
      );
    }
  }
  return true;
}
async function recoverJobs() {
  await pool.query("UPDATE messages SET whatsapp_status='unknown',whatsapp_error='Server restarted during delivery; check provider before resending.' WHERE whatsapp_status='sending'");
  await pool.query("UPDATE messages SET email_status='unknown',email_error='Server restarted during delivery; check provider before resending.' WHERE email_status='sending'");
  await pool.query("UPDATE jobs SET status='pending',locked_at=NULL WHERE status='running'");
  await pool.query(`INSERT INTO jobs(kind,entity_id,job_key)
    SELECT 'document',id,'document:' || id::text FROM documents WHERE extraction_status='pending'
    ON CONFLICT(job_key) DO NOTHING`);
  await pool.query(`INSERT INTO jobs(kind,entity_id,job_key)
    SELECT 'query',id,'query:' || id::text || ':' || revision::text FROM queries WHERE status IN ('pending','processing')
    ON CONFLICT(job_key) DO NOTHING`);
  await pool.query(`INSERT INTO jobs(kind,entity_id,job_key)
    SELECT 'dispatch',id,'dispatch:' || id::text FROM messages WHERE whatsapp_status IN ('pending','retrying') OR email_status IN ('pending','retrying')
    ON CONFLICT(job_key) DO NOTHING`);
}
function startWorker() {
  let stopping = false;
  let current = Promise.resolve();
  const tick = async () => {
    while (!stopping) {
      try { if (!await runOneJob()) await new Promise((resolve) => setTimeout(resolve, 750)); }
      catch (err) {
        console.error('Worker database error:', err.message);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  };
  current = tick();
  return async () => { stopping = true; await current; };
}
module.exports = { runOneJob, recoverJobs, startWorker };
