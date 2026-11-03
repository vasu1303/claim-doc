const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

module.exports = {
  root: path.resolve(__dirname, '..', '..'),
  port: Number(process.env.BACKEND_PORT || 8000),
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET,
  serviceToken: process.env.SERVICE_TOKEN,
  aiUrl: process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001',
  messengerUrl: process.env.MESSENGER_URL || 'http://127.0.0.1:8002',
};
