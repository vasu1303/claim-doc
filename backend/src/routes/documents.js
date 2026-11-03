const router = require('express').Router({ mergeParams: true });
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const multer = require('multer');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');

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

async function ensureBucket() {
  try {
    const { CreateBucketCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
    await s3.send(new HeadBucketCommand({ Bucket: process.env.MINIO_BUCKET }));
  } catch {
    try {
      const { CreateBucketCommand } = require('@aws-sdk/client-s3');
      await s3.send(new CreateBucketCommand({ Bucket: process.env.MINIO_BUCKET }));
    } catch(e) { console.log('Bucket already exists or error:', e.message); }
  }
}
ensureBucket();

// GET /api/patients/:patientId/documents
router.get('/', authenticate, async (req, res) => {
  try {
    const patient = await pool.query('SELECT id FROM patients WHERE id=$1 OR patient_id=$1', [req.params.patientId]);
    if (!patient.rows[0]) return res.status(404).json({ error: 'Patient not found' });
    const docs = await pool.query(
      'SELECT * FROM documents WHERE patient_id=$1 ORDER BY created_at DESC',
      [patient.rows[0].id]
    );
    res.json(docs.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/patients/:patientId/documents
router.post('/', authenticate, upload.single('file'), async (req, res) => {
  try {
    const patient = await pool.query('SELECT id FROM patients WHERE id=$1 OR patient_id=$1', [req.params.patientId]);
    if (!patient.rows[0]) return res.status(404).json({ error: 'Patient not found' });
    const patientDbId = patient.rows[0].id;
    const { doc_type, doc_category } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'File required' });

    const key = `${patientDbId}/${uuidv4()}-${file.originalname}`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.MINIO_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    }));

    const fileUrl = `${process.env.MINIO_ENDPOINT}/${process.env.MINIO_BUCKET}/${key}`;
    const result = await pool.query(
      `INSERT INTO documents (patient_id, file_name, original_name, doc_type, doc_category, file_url, file_size, mime_type, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [patientDbId, key, file.originalname, doc_type, doc_category, fileUrl, file.size, file.mimetype, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/patients/:patientId/documents/:docId/download
router.get('/:docId/download', authenticate, async (req, res) => {
  try {
    const doc = await pool.query('SELECT * FROM documents WHERE id=$1', [req.params.docId]);
    if (!doc.rows[0]) return res.status(404).json({ error: 'Document not found' });
    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: process.env.MINIO_BUCKET,
      Key: doc.rows[0].file_name,
    }), { expiresIn: 300 });
    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
