const { z } = require('zod');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const uuid = z.string().uuid();
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
}
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Files must be 20 MB or smaller.' });
  if (err.code === '23505') return res.status(409).json({ error: 'That record already exists.' });
  const status = err.status || 500;
  if (status >= 500) console.error(`${req.method} ${req.path}:`, err.message);
  return res.status(status).json({ error: status < 500 ? err.message : 'The request failed. Please try again or contact an administrator.' });
}
module.exports = { HttpError, asyncRoute, parse, uuid, z, errorHandler };
