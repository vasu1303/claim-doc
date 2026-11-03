const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authenticate, roles, audit } = require('../middleware/auth');
const { asyncRoute, parse, z, uuid, HttpError } = require('../http');

router.use(authenticate, roles('admin'));
router.get('/', asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT id,name,email,role,patient_id,active,created_at FROM users ORDER BY created_at');
  res.json(rows);
}));
router.get('/audit', asyncRoute(async (req, res) => {
  res.json((await pool.query(
    `SELECT a.id,a.action,a.created_at,u.name AS user_name,p.patient_id FROM audit_events a
     LEFT JOIN users u ON u.id=a.user_id LEFT JOIN patients p ON p.id=a.patient_id ORDER BY a.created_at DESC LIMIT 100`
  )).rows);
}));
router.post('/', asyncRoute(async (req, res) => {
  const input = parse(z.object({
    name: z.string().trim().min(1).max(255), email: z.string().email().transform((s) => s.toLowerCase()),
    password: z.string().min(12).max(128), role: z.enum(['admin', 'staff', 'patient']), patient_id: uuid.nullish(),
  }), req.body);
  if (input.role === 'patient' && !input.patient_id) throw new HttpError(400, 'A patient account must be linked to a locker.');
  if (input.patient_id && !(await pool.query('SELECT id FROM patients WHERE id=$1', [input.patient_id])).rows[0]) throw new HttpError(400, 'Patient does not exist.');
  const { rows } = await pool.query(
    'INSERT INTO users(name,email,password_hash,role,patient_id) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,role,patient_id,active',
    [input.name, input.email, await bcrypt.hash(input.password, 12), input.role, input.role === 'patient' ? input.patient_id : null]
  );
  await audit(req.user.id, 'account_created', input.patient_id || null);
  res.status(201).json(rows[0]);
}));
router.patch('/:id', asyncRoute(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const input = parse(z.object({ active: z.boolean().optional(), password: z.string().min(12).max(128).optional() }).refine((v) => Object.keys(v).length > 0), req.body);
  if (id === req.user.id) throw new HttpError(400, 'Use your profile to change your own password. You cannot disable your own account.');
  const hash = input.password ? await bcrypt.hash(input.password, 12) : null;
  const { rows } = await pool.query(
    'UPDATE users SET active=COALESCE($1,active),password_hash=COALESCE($2,password_hash),token_version=token_version+1 WHERE id=$3 RETURNING id,name,email,role,active',
    [input.active ?? null, hash, id]
  );
  if (!rows[0]) throw new HttpError(404, 'Account not found.');
  await audit(req.user.id, 'account_updated');
  res.json(rows[0]);
}));
module.exports = router;
