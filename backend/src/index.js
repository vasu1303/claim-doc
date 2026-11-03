require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const migrate = require('./db/migrate');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/patients/:patientId/documents', require('./routes/documents'));
app.use('/api/patients/:patientId/queries', require('./routes/queries'));
app.use('/api/messages', require('./routes/messages'));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'locker-backend' }));

const PORT = process.env.PORT || 8000;

async function start() {
  try {
    await migrate();
    app.listen(PORT, () => console.log(`🚀 Backend running on http://localhost:${PORT}`));
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
