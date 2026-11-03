const router = require('express').Router({ mergeParams: true });
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: process.env.MINIO_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MINIO_ROOT_USER,
    secretAccessKey: process.env.MINIO_ROOT_PASSWORD,
  },
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// GET /api/patients/:patientId/queries
router.get('/', authenticate, async (req, res) => {
  try {
    const patient = await pool.query('SELECT id FROM patients WHERE id=$1 OR patient_id=$1', [req.params.patientId]);
    if (!patient.rows[0]) return res.status(404).json({ error: 'Patient not found' });
    const queries = await pool.query(
      'SELECT * FROM queries WHERE patient_id=$1 ORDER BY created_at DESC',
      [patient.rows[0].id]
    );
    res.json(queries.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/patients/:patientId/queries/:queryId
router.get('/:queryId', authenticate, async (req, res) => {
  try {
    const q = await pool.query('SELECT * FROM queries WHERE id=$1', [req.params.queryId]);
    if (!q.rows[0]) return res.status(404).json({ error: 'Query not found' });
    const points = await pool.query(
      `SELECT qp.*, d.original_name as matched_doc_name, d.doc_type as matched_doc_type
       FROM query_points qp
       LEFT JOIN documents d ON d.id = qp.matched_doc_id
       WHERE qp.query_id=$1 ORDER BY qp.point_index`,
      [req.params.queryId]
    );
    res.json({ ...q.rows[0], points: points.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/patients/:patientId/queries - Upload query letter
router.post('/', authenticate, upload.single('file'), async (req, res) => {
  try {
    const patient = await pool.query('SELECT * FROM patients WHERE id=$1 OR patient_id=$1', [req.params.patientId]);
    if (!patient.rows[0]) return res.status(404).json({ error: 'Patient not found' });
    const pat = patient.rows[0];
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'File required' });

    // Upload to S3/MinIO
    const key = `${pat.id}/queries/${uuidv4()}-${file.originalname}`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.MINIO_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    }));
    const fileUrl = `${process.env.MINIO_ENDPOINT}/${process.env.MINIO_BUCKET}/${key}`;

    // Persist query
    const queryResult = await pool.query(
      `INSERT INTO queries (patient_id, file_name, file_url, status, insurer_name)
       VALUES ($1,$2,$3,'pending',$4) RETURNING *`,
      [pat.id, file.originalname, fileUrl, req.body.insurer_name || pat.insurer_name]
    );
    const queryId = queryResult.rows[0].id;

    // 🚀 Fire-and-forget: trigger AI service
    axios.post(`${process.env.AI_SERVICE_URL}/process-query`, {
      query_id: queryId,
      patient_id: pat.id,
      patient_short_id: pat.patient_id,
      file_url: fileUrl,
    }).catch(err => console.error('AI service trigger failed:', err.message));

    res.status(201).json({ query_id: queryId, status: 'queued', message: 'Query letter uploaded – AI processing started' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
