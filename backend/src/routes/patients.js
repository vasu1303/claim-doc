const router = require('express').Router();
const pool = require('../db/pool');
const { authenticate, roles, scope, patientAccess, audit } = require('../middleware/auth');
const { asyncRoute, parse, z, uuid, HttpError } = require('../http');

const patientSchema = z.object({
  patient_id: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(255), phone: z.string().max(30).default(''),
  email: z.union([z.string().email(), z.literal('')]).default(''),
  dob: z.union([z.string().date(), z.literal('')]).optional(),
  gender: z.string().max(30).default(''), policy_number: z.string().max(100).default(''),
  insurer_name: z.string().max(255).default(''), notes: z.string().max(5000).default(''),
  is_synthetic: z.boolean().default(true),
});
router.use(authenticate);
router.get('/', asyncRoute(async (req, res) => {
  const input = parse(z.object({
    search: z.string().max(200).default(''), status: z.string().max(50).default(''),
    page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
  }), req.query);
  const filter = scope(req.user);
  const params = [...filter.params, `%${input.search}%`, input.status];
  const s = filter.params.length + 1;
  const where = `${filter.sql} AND (p.name ILIKE $${s} OR p.patient_id ILIKE $${s} OR p.email ILIKE $${s}) AND ($${s + 1}='' OR p.claim_status=$${s + 1})`;
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM patients p WHERE ${where}`, params);
  const result = await pool.query(
    `SELECT p.*,(SELECT COUNT(*)::int FROM documents d WHERE d.patient_id=p.id) AS doc_count,
     (SELECT COUNT(*)::int FROM queries q WHERE q.patient_id=p.id) AS query_count,
     (SELECT COUNT(*)::int FROM messages m WHERE m.patient_id=p.id) AS message_count
     FROM patients p WHERE ${where} ORDER BY p.created_at DESC LIMIT $${s + 2} OFFSET $${s + 3}`,
    [...params, input.limit, (input.page - 1) * input.limit]
  );
  res.json({ patients: result.rows, total: count.rows[0].total, page: input.page, limit: input.limit });
}));
router.get('/:id', patientAccess, (req, res) => res.json(req.patient));
router.post('/', roles('admin', 'staff'), asyncRoute(async (req, res) => {
  const p = parse(patientSchema, req.body);
  const { rows } = await pool.query(
    `INSERT INTO patients(patient_id,name,phone,email,dob,gender,policy_number,insurer_name,notes,is_synthetic)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [p.patient_id, p.name, p.phone, p.email, p.dob || null, p.gender, p.policy_number, p.insurer_name, p.notes, p.is_synthetic]
  );
  if (req.user.role === 'staff') await pool.query('INSERT INTO patient_assignments VALUES($1,$2)', [rows[0].id, req.user.id]);
  await audit(req.user.id, 'patient_created', rows[0].id);
  res.status(201).json(rows[0]);
}));
router.patch('/:id', roles('admin', 'staff'), patientAccess, asyncRoute(async (req, res) => {
  const input = parse(patientSchema.omit({ patient_id: true, is_synthetic: true }).partial().extend({
    claim_status: z.enum(['pending', 'processing', 'awaiting_documents', 'completed']).optional(),
  }), req.body);
  const entries = Object.entries(input);
  if (!entries.length) throw new HttpError(400, 'No changes supplied.');
  const params = entries.map(([key, value]) => key === 'dob' ? value || null : value);
  const { rows } = await pool.query(
    `UPDATE patients SET ${entries.map(([key], i) => `${key}=$${i + 1}`).join(',')},updated_at=NOW() WHERE id=$${params.length + 1} RETURNING *`,
    [...params, req.patient.id]
  );
  await audit(req.user.id, 'patient_updated', req.patient.id);
  res.json(rows[0]);
}));
router.get('/:id/assignments', roles('admin'), patientAccess, asyncRoute(async (req, res) => {
  res.json((await pool.query('SELECT user_id FROM patient_assignments WHERE patient_id=$1', [req.patient.id])).rows.map((r) => r.user_id));
}));
router.put('/:id/assignments', roles('admin'), patientAccess, asyncRoute(async (req, res) => {
  const { user_ids } = parse(z.object({ user_ids: z.array(uuid).max(100) }), req.body);
  if (user_ids.length) {
    const valid = await pool.query("SELECT id FROM users WHERE id=ANY($1::uuid[]) AND role='staff' AND active=TRUE", [user_ids]);
    if (valid.rows.length !== new Set(user_ids).size) throw new HttpError(400, 'Assignments must reference active staff.');
  }
  await pool.transaction(async (db) => {
    await db.query('DELETE FROM patient_assignments WHERE patient_id=$1', [req.patient.id]);
    for (const id of new Set(user_ids)) await db.query('INSERT INTO patient_assignments(patient_id,user_id) VALUES($1,$2)', [req.patient.id, id]);
  });
  await audit(req.user.id, 'assignments_updated', req.patient.id);
  res.json({ ok: true });
}));
module.exports = router;
