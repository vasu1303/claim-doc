const router = require('express').Router({ mergeParams: true });
const pool = require('../db/pool');
const storage = require('../storage');
const { authenticate, patientAccess, roles, audit } = require('../middleware/auth');
const { enqueue, reprocessPatient } = require('../jobs');
const { asyncRoute, parse, z, uuid, HttpError } = require('../http');
const docTypes = ['discharge_summary', 'hospital_bill', 'consultation_notes', 'lab_report', 'prescription',
  'policy_copy', 'kyc_document', 'claim_form', 'previous_medical_history', 'authorization_letter', 'id_proof', 'other'];
router.use(authenticate, patientAccess);
router.get('/', asyncRoute(async (req, res) => {
  res.json((await pool.query(
    `SELECT id,patient_id,original_name,doc_type,file_size,mime_type,extraction_status,created_at
     FROM documents WHERE patient_id=$1 ORDER BY created_at DESC`, [req.patient.id]
  )).rows);
}));
router.post('/', storage.upload.single('file'), asyncRoute(async (req, res) => {
  const { doc_type } = parse(z.object({ doc_type: z.enum(docTypes) }), req.body);
  const file = storage.validateFile(req.file);
  const key = await storage.put(req.file.buffer, file.mime);
  let doc;
  try {
    doc = await pool.transaction(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO documents(patient_id,file_name,original_name,doc_type,file_url,file_size,mime_type,uploaded_by)
         VALUES($1,$2,$3,$4,'private',$5,$6,$7) RETURNING id,patient_id,original_name,doc_type,extraction_status`,
        [req.patient.id, key, file.name, doc_type, req.file.size, file.mime, req.user.id]
      );
      await enqueue('document', rows[0].id, `document:${rows[0].id}`, db);
      return rows[0];
    });
  } catch (err) {
    try { await storage.remove(key); } catch (cleanup) { console.error('Failed to remove orphaned upload:', cleanup.message); }
    throw err;
  }
  await audit(req.user.id, 'document_uploaded', req.patient.id);
  res.status(201).json(doc);
}));
router.get('/:docId/download', asyncRoute(async (req, res) => {
  const id = parse(uuid, req.params.docId);
  const { rows } = await pool.query('SELECT * FROM documents WHERE id=$1 AND patient_id=$2', [id, req.patient.id]);
  if (!rows[0]) throw new HttpError(404, 'Document not found.');
  const doc = rows[0];
  const content = await storage.get(doc.file_name);
  await audit(req.user.id, 'document_downloaded', req.patient.id);
  res.set('Content-Type', doc.mime_type).attachment(doc.original_name).send(content);
}));
router.post('/:docId/retry', asyncRoute(async (req, res) => {
  const id = parse(uuid, req.params.docId);
  const { rows } = await pool.query(
    "UPDATE documents SET extraction_status='pending' WHERE id=$1 AND patient_id=$2 AND extraction_status='failed' RETURNING id",
    [id, req.patient.id]
  );
  if (!rows[0]) throw new HttpError(409, 'Only a failed document can be retried.');
  await enqueue('document', id, `document:${id}`);
  await audit(req.user.id, 'document_index_retried', req.patient.id);
  res.json({ ok: true });
}));
router.delete('/:docId', roles('admin', 'staff'), asyncRoute(async (req, res) => {
  const id = parse(uuid, req.params.docId);
  const { rows } = await pool.query('SELECT file_name FROM documents WHERE id=$1 AND patient_id=$2', [id, req.patient.id]);
  if (!rows[0]) throw new HttpError(404, 'Document not found.');
  await pool.transaction(async (db) => {
    await db.query("UPDATE query_points SET matched_doc_id=NULL,status='missing',evidence=NULL WHERE matched_doc_id=$1", [id]);
    await db.query('DELETE FROM documents WHERE id=$1', [id]);
    await reprocessPatient(req.patient.id, db);
  });
  await storage.remove(rows[0].file_name);
  await audit(req.user.id, 'document_deleted', req.patient.id);
  res.json({ ok: true });
}));
module.exports = router;
