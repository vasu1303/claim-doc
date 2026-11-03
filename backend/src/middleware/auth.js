const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const config = require('../config');
const { HttpError, asyncRoute } = require('../http');

const publicUser = ({ id, name, email, role, patient_id }) => ({ id, name, email, role, patient_id });
const authenticate = asyncRoute(async (req, res, next) => {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, 'Please sign in.');
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: 'patient-locker' }); }
  catch { throw new HttpError(401, 'Your session expired. Please sign in again.'); }
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1 AND active=TRUE', [payload.sub]);
  const user = rows[0];
  if (!user || user.token_version !== payload.version) throw new HttpError(401, 'Your session is no longer valid.');
  req.user = publicUser(user);
  next();
});
const roles = (...allowed) => (req, res, next) => {
  if (!allowed.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission for this action.'));
  next();
};
function scope(user, alias = 'p', start = 1) {
  if (user.role === 'admin') return { sql: 'TRUE', params: [] };
  if (user.role === 'patient') return { sql: `${alias}.id=$${start}::uuid`, params: [user.patient_id] };
  return {
    sql: `EXISTS (SELECT 1 FROM patient_assignments pa WHERE pa.patient_id=${alias}.id AND pa.user_id=$${start})`,
    params: [user.id],
  };
}
async function findPatient(user, identifier) {
  const filter = scope(user, 'p', 2);
  const { rows } = await pool.query(
    `SELECT p.* FROM patients p WHERE (p.id::text=$1 OR p.patient_id=$1) AND ${filter.sql}`, [identifier, ...filter.params]
  );
  if (!rows[0]) throw new HttpError(404, 'Patient not found or not accessible.');
  return rows[0];
}
const patientAccess = asyncRoute(async (req, res, next) => {
  req.patient = await findPatient(req.user, req.params.patientId || req.params.id);
  next();
});
async function audit(userId, action, patientId = null) {
  await pool.query('INSERT INTO audit_events(user_id,action,patient_id) VALUES($1,$2,$3)', [userId, action, patientId]);
}
module.exports = { authenticate, roles, scope, findPatient, patientAccess, publicUser, audit };
