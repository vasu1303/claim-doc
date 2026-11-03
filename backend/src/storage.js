const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, CreateBucketCommand } = require('@aws-sdk/client-s3');
const config = require('./config');
const { HttpError } = require('./http');

const directory = path.resolve(process.env.STORAGE_DIR || path.join(config.root, 'data', 'files'));
const useS3 = process.env.FILE_STORAGE === 's3';
const s3 = useS3 ? new S3Client({
  region: process.env.AWS_REGION || 'us-east-1', endpoint: process.env.MINIO_ENDPOINT,
  forcePathStyle: true, credentials: { accessKeyId: process.env.MINIO_ROOT_USER, secretAccessKey: process.env.MINIO_ROOT_PASSWORD },
}) : null;
const bucket = process.env.MINIO_BUCKET || 'patient-docs';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 5 } });
function localPath(key) {
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new HttpError(400, 'Invalid storage key.');
  return path.join(directory, key);
}
function validateFile(file) {
  if (!file) throw new HttpError(400, 'Choose a PDF, PNG, JPEG, or text file.');
  const ext = path.extname(file.originalname).toLowerCase();
  const b = file.buffer;
  const mime = ext === '.pdf' && b.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf'
    : ext === '.png' && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
    : ['.jpg', '.jpeg'].includes(ext) && b[0] === 255 && b[1] === 216 && b[2] === 255 ? 'image/jpeg'
    : ext === '.txt' && b.length > 0 && !b.includes(0) && !b.toString('utf8').includes('\ufffd') ? 'text/plain' : null;
  if (!mime) throw new HttpError(400, 'Unsupported or invalid file. Use a valid PDF, PNG, JPEG, or UTF-8 text file.');
  return { name: path.basename(file.originalname).replace(/[\x00-\x1f]/g, '').slice(0, 240), mime };
}
async function initialize() {
  if (!useS3) return fs.mkdir(directory, { recursive: true });
  try { await s3.send(new HeadBucketCommand({ Bucket: bucket })); }
  catch (err) {
    if (err.$metadata?.httpStatusCode !== 404) throw err;
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}
async function put(buffer, mime) {
  const key = crypto.randomUUID();
  if (useS3) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mime }));
  else await fs.writeFile(localPath(key), buffer, { flag: 'wx', mode: 0o600 });
  return key;
}
async function get(key) {
  if (!useS3) return fs.readFile(localPath(key));
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await response.Body.transformToByteArray());
}
async function remove(key) {
  if (useS3) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  else await fs.unlink(localPath(key));
}
module.exports = { initialize, put, get, remove, upload, validateFile };
