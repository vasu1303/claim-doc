const router = require('express').Router({ mergeParams: true });
const listRouter = require('express').Router();
const pool = require('../db/pool');
const storage = require('../storage');
const { authenticate, roles, patientAccess, scope, audit } = require('../middleware/auth');
const { enqueue } = require('../jobs');
const { asyncRoute, parse, z, uuid, HttpError } = require('../http');

listRouter.use(authenticate);
listRouter.get('/', asyncRoute(async (req, res) => {
  const filter = scope(req.user);
  const input = parse(z.object({ page: z.coerce.number().int().min(1).default(1) }), req.query);
  const { rows } = await pool.query(
    `SELECT q.id,q.patient_id,q.file_name,q.status,q.error,q.created_at,q.duration_ms,p.name AS patient_name,p.patient_id AS patient_short_id,
     COUNT(*) OVER()::int AS total FROM queries q JOIN patients p ON p.id=q.patient_id WHERE ${filter.sql}
     ORDER BY q.created_at DESC LIMIT 50 OFFSET $${filter.params.length + 1}`,
    [...filter.params, (input.page - 1) * 50]
  );
  res.json({ queries: rows, total: rows[0]?.total || 0 });
}));
listRouter.get('/:queryId', asyncRoute(async (req, res) => {
  const id = parse(uuid, req.params.queryId);
  const filter = scope(req.user, 'p', 2);
  const { rows } = await pool.query(
    `SELECT q.*,p.name AS patient_name,p.patient_id AS patient_short_id FROM queries q
     JOIN patients p ON p.id=q.patient_id WHERE q.id=$1 AND ${filter.sql}`, [id, ...filter.params]
  );
  if (!rows[0]) throw new HttpError(404, 'Query not found or not accessible.');
  const points = await pool.query(
    `SELECT qp.*,d.original_name AS matched_doc_name FROM query_points qp LEFT JOIN documents d ON d.id=qp.matched_doc_id
     WHERE qp.query_id=$1 ORDER BY qp.point_index`, [id]
  );
  const messages = await pool.query('SELECT * FROM messages WHERE query_id=$1 ORDER BY revision DESC', [id]);
  const { storage_key, file_url, ...query } = rows[0];
  res.json({ ...query, points: points.rows, messages: messages.rows });
}));
router.use(authenticate, patientAccess);
router.get('/', asyncRoute(async (req, res) => {
  res.json((await pool.query(
    'SELECT id,patient_id,file_name,status,error,revision,created_at,processed_at,duration_ms FROM queries WHERE patient_id=$1 ORDER BY created_at DESC',
    [req.patient.id]
  )).rows);
}));
router.get('/:queryId/download', asyncRoute(async (req, res) => {
  const id = parse(uuid, req.params.queryId);
  const { rows } = await pool.query('SELECT * FROM queries WHERE id=$1 AND patient_id=$2', [id, req.patient.id]);
  if (!rows[0]) throw new HttpError(404, 'Query not found.');
  if (!rows[0].storage_key) throw new HttpError(409, 'This legacy file must be re-uploaded into private storage.');
  const buffer = await storage.get(rows[0].storage_key);
  await audit(req.user.id, 'query_downloaded', req.patient.id);
  res.attachment(rows[0].file_name).send(buffer);
}));
router.post('/', roles('admin', 'staff'), storage.upload.single('file'), asyncRoute(async (req, res) => {
  const file = storage.validateFile(req.file);
  const key = await storage.put(req.file.buffer, file.mime);
  let query;
  try {
    query = await pool.transaction(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO queries(patient_id,file_name,storage_key,file_url,insurer_name) VALUES($1,$2,$3,'private',$4) RETURNING id,status,revision`,
        [req.patient.id, file.name, key, req.patient.insurer_name]
      );
      await enqueue('query', rows[0].id, `query:${rows[0].id}:1`, db);
      return rows[0];
    });
  } catch (err) {
    try { await storage.remove(key); } catch (cleanup) { console.error('Failed to remove orphaned query:', cleanup.message); }
    throw err;
  }
  await audit(req.user.id, 'query_uploaded', req.patient.id);
  res.status(201).json({ ...query, query_id: query.id });
}));
router.post('/:queryId/retry', roles('admin', 'staff'), asyncRoute(async (req, res) => {
  const id = parse(uuid, req.params.queryId);
  const { rows } = await pool.query(
    `UPDATE queries SET status='pending',error=NULL,revision=revision+1 WHERE id=$1 AND patient_id=$2
     AND status IN ('failed','needs_review') RETURNING *`, [id, req.patient.id]
  );
  if (!rows[0]) throw new HttpError(409, 'Only failed queries or queries requiring review can be retried.');
  await enqueue('query', id, `query:${id}:${rows[0].revision}`);
  await audit(req.user.id, 'query_retried', req.patient.id);
  res.json({ ok: true });
}));
module.exports = { router, listRouter };
