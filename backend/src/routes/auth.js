const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const pool = require('../db/pool');
const config = require('../config');
const { authenticate, publicUser, audit } = require('../middleware/auth');
const { asyncRoute, parse, z, HttpError } = require('../http');

router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' } }), asyncRoute(async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email().transform((s) => s.toLowerCase()), password: z.string().min(1).max(128) }), req.body);
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email)=$1 AND active=TRUE', [email]);
  const user = rows[0];
  const dummyHash = '$2b$10$qVLj/OYyYn2A1GFQQ4Lr3.P.0BG/qK.HtriPDx7N.cYVNQfWGolby';
  const valid = await bcrypt.compare(password, user?.password_hash || dummyHash);
  if (!user || !valid) throw new HttpError(401, 'Invalid email or password.');
  const token = jwt.sign({ version: user.token_version }, config.jwtSecret, {
    subject: user.id, issuer: 'patient-locker', expiresIn: '8h', algorithm: 'HS256',
  });
  await audit(user.id, 'login');
  res.json({ token, user: publicUser(user) });
}));
router.get('/me', authenticate, (req, res) => res.json(req.user));
router.post('/logout', authenticate, asyncRoute(async (req, res) => {
  await pool.query('UPDATE users SET token_version=token_version+1 WHERE id=$1', [req.user.id]);
  res.json({ ok: true });
}));
router.post('/password', authenticate, asyncRoute(async (req, res) => {
  const input = parse(z.object({ current_password: z.string().min(1), password: z.string().min(12).max(128) }), req.body);
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!await bcrypt.compare(input.current_password, rows[0].password_hash)) throw new HttpError(400, 'Current password is incorrect.');
  await pool.query('UPDATE users SET password_hash=$1,token_version=token_version+1 WHERE id=$2', [await bcrypt.hash(input.password, 12), req.user.id]);
  await audit(req.user.id, 'password_changed');
  res.json({ ok: true, message: 'Password changed. Please sign in again.' });
}));
module.exports = router;
