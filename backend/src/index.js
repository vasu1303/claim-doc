const config = require('./config');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const pool = require('./db/pool');
const migrate = require('./db/migrate');
const storage = require('./storage');
const { errorHandler } = require('./http');
const { authenticate } = require('./middleware/auth');
const { recoverJobs, startWorker } = require('./worker');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.origin }));
  app.use(express.json({ limit: '128kb' }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a minute.' } }));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/patients', require('./routes/patients'));
  app.use('/api/patients/:patientId/documents', require('./routes/documents'));
  app.use('/api/patients/:patientId/queries', require('./routes/queries').router);
  app.use('/api/queries', require('./routes/queries').listRouter);
  app.use('/api/messages', require('./routes/messages'));
  app.get('/api/system', authenticate, async (req, res, next) => {
    try {
      await pool.query('SELECT 1');
      res.json({ database: 'ok', analysis_mode: process.env.ANALYSIS_MODE || 'demo', delivery_mode: process.env.DELIVERY_MODE || 'mock' });
    } catch (err) { next(err); }
  });
  app.get('/health', async (req, res) => {
    try { await pool.query('SELECT 1'); res.json({ status: 'ok', service: 'backend' }); }
    catch (err) { console.error('Health check failed:', err.message); res.status(503).json({ status: 'unavailable' }); }
  });
  app.use((req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use(errorHandler);
  return app;
}
async function start() {
  if (!config.jwtSecret || config.jwtSecret.length < 32 || !config.serviceToken || config.serviceToken.length < 32) {
    throw new Error('Run npm run setup, or configure JWT_SECRET and SERVICE_TOKEN with at least 32 characters each.');
  }
  await migrate();
  await storage.initialize();
  await recoverJobs();
  const server = createApp().listen(config.port, '127.0.0.1', () => console.log(`Backend: http://localhost:${config.port}`));
  const stop = startWorker();
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    server.close();
    await stop();
    await pool.end();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
if (require.main === module) start().catch((err) => { console.error('Startup failed:', err.message); process.exitCode = 1; });
module.exports = { createApp };
