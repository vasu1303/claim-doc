const router = require('express').Router();
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// POST /api/messages (called by messenger service)
router.post('/', async (req, res) => {
  try {
    const { patient_id, query_id, message_body, whatsapp_status, email_status, whatsapp_message_id, email_message_id } = req.body;
    const result = await pool.query(
      `INSERT INTO messages (patient_id, query_id, message_body, whatsapp_status, email_status, whatsapp_message_id, email_message_id, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
      [patient_id, query_id, message_body, whatsapp_status, email_status, whatsapp_message_id, email_message_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/messages/patient/:patientId
router.get('/patient/:patientId', authenticate, async (req, res) => {
  try {
    const patient = await pool.query('SELECT id FROM patients WHERE id=$1 OR patient_id=$1', [req.params.patientId]);
    if (!patient.rows[0]) return res.status(404).json({ error: 'Patient not found' });
    const msgs = await pool.query(
      'SELECT * FROM messages WHERE patient_id=$1 ORDER BY created_at DESC',
      [patient.rows[0].id]
    );
    res.json(msgs.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/messages/stats
router.get('/stats', authenticate, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM patients) as total_patients,
        (SELECT COUNT(*) FROM queries) as total_queries,
        (SELECT COUNT(*) FROM queries WHERE status='completed') as completed_queries,
        (SELECT COUNT(*) FROM queries WHERE status='pending' OR status='processing') as pending_queries,
        (SELECT COUNT(*) FROM messages) as messages_sent,
        (SELECT COUNT(*) FROM documents) as total_documents
    `);
    res.json(stats.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
