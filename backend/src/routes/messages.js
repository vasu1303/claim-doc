const router = require('express').Router();
const pool = require('../db/pool');
const { authenticate, scope, findPatient } = require('../middleware/auth');
const { asyncRoute, parse, z } = require('../http');
router.use(authenticate);
router.get('/stats', asyncRoute(async (req, res) => {
  const filter = scope(req.user);
  const { rows } = await pool.query(
    `WITH visible AS (SELECT p.id FROM patients p WHERE ${filter.sql})
     SELECT (SELECT COUNT(*)::int FROM visible) AS total_patients,
     (SELECT COUNT(*)::int FROM documents WHERE patient_id IN (SELECT id FROM visible)) AS total_documents,
     (SELECT COUNT(*)::int FROM queries WHERE patient_id IN (SELECT id FROM visible)) AS total_queries,
     (SELECT COUNT(*)::int FROM queries WHERE patient_id IN (SELECT id FROM visible) AND status='completed') AS completed_queries,
     (SELECT COUNT(*)::int FROM queries WHERE patient_id IN (SELECT id FROM visible) AND status IN ('pending','processing')) AS pending_queries,
     (SELECT COUNT(*)::int FROM queries WHERE patient_id IN (SELECT id FROM visible) AND status IN ('failed','needs_review')) AS failed_queries,
     (SELECT COUNT(*)::int FROM messages WHERE patient_id IN (SELECT id FROM visible)) AS messages_sent,
     (SELECT COUNT(*)::int FROM messages WHERE patient_id IN (SELECT id FROM visible) AND (whatsapp_status IN ('failed','unknown') OR email_status IN ('failed','unknown'))) AS delivery_issues`,
    filter.params
  );
  res.json({ ...rows[0], analysis_mode: process.env.ANALYSIS_MODE || 'demo', delivery_mode: process.env.DELIVERY_MODE || 'mock', data_mode: process.env.EXTERNAL_DATA_MODE || 'synthetic' });
}));
router.get('/patient/:patientId', asyncRoute(async (req, res) => {
  const p = await findPatient(req.user, req.params.patientId);
  res.json((await pool.query('SELECT * FROM messages WHERE patient_id=$1 ORDER BY created_at DESC', [p.id])).rows);
}));
router.get('/', asyncRoute(async (req, res) => {
  const filter = scope(req.user);
  const { page } = parse(z.object({ page: z.coerce.number().int().min(1).default(1) }), req.query);
  const { rows } = await pool.query(
    `SELECT m.*,p.name AS patient_name,COUNT(*) OVER()::int AS total FROM messages m JOIN patients p ON p.id=m.patient_id
     WHERE ${filter.sql} ORDER BY m.created_at DESC LIMIT 50 OFFSET $${filter.params.length + 1}`, [...filter.params, (page - 1) * 50]
  );
  res.json({ messages: rows, total: rows[0]?.total || 0 });
}));
module.exports = router;
