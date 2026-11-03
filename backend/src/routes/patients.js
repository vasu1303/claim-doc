const router = require('express').Router();
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// GET /api/patients
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    let query = `
      SELECT p.*,
        (SELECT COUNT(*) FROM documents d WHERE d.patient_id = p.id) AS doc_count,
        (SELECT COUNT(*) FROM queries q WHERE q.patient_id = p.id) AS query_count,
        (SELECT COUNT(*) FROM messages m WHERE m.patient_id = p.id) AS message_count
      FROM patients p
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    if (search) {
      query += ` AND (p.name ILIKE $${paramIndex} OR p.patient_id ILIKE $${paramIndex} OR p.email ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (status) {
      query += ` AND p.claim_status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    query += ` ORDER BY p.created_at DESC`;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), offset);

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM patients p WHERE 1=1${search ? ` AND (p.name ILIKE $1 OR p.patient_id ILIKE $1 OR p.email ILIKE $1)` : ''}`,
      search ? [`%${search}%`] : []
    );

    const result = await pool.query(query, params);
    res.json({ patients: result.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/patients/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*,
        (SELECT COUNT(*) FROM documents d WHERE d.patient_id = p.id) AS doc_count,
        (SELECT COUNT(*) FROM queries q WHERE q.patient_id = p.id) AS query_count
       FROM patients p WHERE p.id = $1 OR p.patient_id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Patient not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/patients
router.post('/', authenticate, async (req, res) => {
  try {
    const { patient_id, name, phone, email, dob, gender, policy_number, insurer_name, notes } = req.body;
    if (!patient_id || !name) return res.status(400).json({ error: 'patient_id and name required' });
    const result = await pool.query(
      `INSERT INTO patients (patient_id, name, phone, email, dob, gender, policy_number, insurer_name, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [patient_id, name, phone, email, dob || null, gender, policy_number, insurer_name, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Patient ID already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/patients/:id
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { name, phone, email, dob, gender, policy_number, insurer_name, claim_status, notes } = req.body;
    const result = await pool.query(
      `UPDATE patients SET name=COALESCE($1,name), phone=COALESCE($2,phone), email=COALESCE($3,email),
       dob=COALESCE($4,dob), gender=COALESCE($5,gender), policy_number=COALESCE($6,policy_number),
       insurer_name=COALESCE($7,insurer_name), claim_status=COALESCE($8,claim_status), notes=COALESCE($9,notes),
       updated_at=NOW() WHERE id=$10 RETURNING *`,
      [name, phone, email, dob, gender, policy_number, insurer_name, claim_status, notes, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Patient not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
