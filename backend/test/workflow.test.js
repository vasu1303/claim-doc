const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const bcrypt = require('bcryptjs');
const root = path.resolve(__dirname, '..', '..');
let pool, server, messenger, ai, stopWorker, base, temporary, admin, patientOne, patientTwo, patientToken, staffToken, documentId, queryId;
const secret = 'synthetic-test-secret-'.padEnd(64, 'x');
async function freePort() {
  const socket = net.createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => socket.once('listening', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
async function waitFor(fn, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 150)); }
  throw new Error('Timed out waiting for automatic processing.');
}
async function request(url, { token = admin, method = 'GET', body } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${url}`, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  return { status: response.status, data };
}
async function login(email, password = 'Synthetic-password-123') {
  const response = await request('/api/auth/login', { token: null, method: 'POST', body: { email, password } });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data.token;
}
async function upload(patient, kind, sample, type, token = admin) {
  const body = new FormData();
  body.append('file', new Blob([await fs.readFile(path.join(root, 'samples', sample))], { type: 'text/plain' }), path.basename(sample));
  if (type) body.append('doc_type', type);
  return request(`/api/patients/${patient.id}/${kind}`, { method: 'POST', body, token });
}
before(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'locker-workflow-'));
  Object.assign(process.env, {
    PGLITE_DIR: path.join(temporary, 'postgres'), STORAGE_DIR: path.join(temporary, 'files'), DATABASE_URL: '',
    JWT_SECRET: secret, SERVICE_TOKEN: secret, ANALYSIS_MODE: 'demo', DELIVERY_MODE: 'mock',
    FILE_STORAGE: 'local', OPENAI_API_KEY: '', FRONTEND_URL: 'http://localhost:3000',
  });
  const aiPort = await freePort();
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${aiPort}`;
  const python = path.join(root, 'ai_service', '.venv', process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');
  await fs.access(python);
  ai = spawn(python, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(aiPort), '--no-access-log'], { cwd: path.join(root, 'ai_service'), env: process.env, stdio: 'pipe' });
  let aiError = '';
  ai.stderr.on('data', data => { aiError += data.toString(); });
  ai.on('error', error => { aiError += error.message; });
  await waitFor(async () => {
    if (ai.exitCode !== null) throw new Error(`AI failed to start: ${aiError}`);
    try { return (await fetch(`${process.env.AI_SERVICE_URL}/health`)).ok; } catch (error) { if (error.cause?.code !== 'ECONNREFUSED') throw error; return false; }
  });
  messenger = require('../../messenger/src/index').createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => messenger.once('listening', resolve));
  process.env.MESSENGER_URL = `http://127.0.0.1:${messenger.address().port}`;
  pool = require('../src/db/pool');
  await require('../src/db/migrate')();
  await require('../src/storage').initialize();
  await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES('Synthetic Admin','admin@example.invalid',$1,'admin')", [await bcrypt.hash('Synthetic-password-123', 4)]);
  server = require('../src/index').createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  stopWorker = require('../src/worker').startWorker();
  admin = await login('admin@example.invalid');
});
after(async () => {
  if (stopWorker) await stopWorker();
  for (const listener of [server, messenger]) if (listener) await new Promise(resolve => listener.close(resolve));
  if (ai && ai.exitCode === null) { ai.kill(); await new Promise(resolve => ai.once('exit', resolve)); }
  if (pool) await pool.end();
  if (temporary) await fs.rm(temporary, { recursive: true, force: true });
});
test('authentication is required and public registration is unavailable', async () => {
  assert.equal((await request('/api/patients', { token: null })).status, 401);
  assert.equal((await request('/api/auth/register', { token: null, method: 'POST', body: {} })).status, 404);
});
test('administrator creates two lockers and provisions scoped staff/patient accounts', async () => {
  for (const short of ['TEST-ONE', 'TEST-TWO']) {
    const response = await request('/api/patients', { method: 'POST', body: { patient_id: short, name: short, is_synthetic: true } });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    if (!patientOne) patientOne = response.data; else patientTwo = response.data;
  }
  const staff = await request('/api/users', { method: 'POST', body: { name: 'Test Staff', email: 'staff@example.invalid', password: 'Synthetic-password-123', role: 'staff' } });
  assert.equal(staff.status, 201);
  const assignment = await request(`/api/patients/${patientOne.id}/assignments`, { method: 'PUT', body: { user_ids: [staff.data.id] } });
  assert.equal(assignment.status, 200, JSON.stringify(assignment.data));
  assert.equal((await request(`/api/patients/${patientOne.id}/assignments`, { method: 'PUT', body: { user_ids: [staff.data.id] } })).status, 200);
  const patient = await request('/api/users', { method: 'POST', body: { name: 'Test Patient', email: 'patient@example.invalid', password: 'Synthetic-password-123', role: 'patient', patient_id: patientOne.id } });
  assert.equal(patient.status, 201);
  staffToken = await login('staff@example.invalid');
  patientToken = await login('patient@example.invalid');
});
test('patient and staff access is scoped across lists, direct IDs, messages and account management', async () => {
  for (const token of [patientToken, staffToken]) {
    const list = await request('/api/patients', { token });
    assert.equal(list.data.total, 1);
    assert.equal(list.data.patients[0].id, patientOne.id);
    assert.equal((await request(`/api/patients/${patientTwo.id}`, { token })).status, 404);
    assert.equal((await request(`/api/patients/${patientTwo.id}/documents`, { token })).status, 404);
    assert.equal((await request(`/api/messages/patient/${patientTwo.id}`, { token })).status, 404);
    assert.equal((await request('/api/users', { token })).status, 403);
    assert.equal((await request('/api/messages/stats', { token })).data.total_patients, 1);
  }
  assert.equal((await request(`/api/patients/${patientOne.patient_id}`, { token: patientToken })).status, 200);
  assert.equal((await request('/api/patients', { token: patientToken, method: 'POST', body: {} })).status, 403);
});
test('a patient uploads a document and the worker indexes it without manual action', async () => {
  const response = await upload(patientOne, 'documents', 'documents\\discharge-summary.txt', 'discharge_summary', patientToken);
  assert.equal(response.status, 201, JSON.stringify(response.data));
  documentId = response.data.id;
  await waitFor(async () => (await request(`/api/patients/${patientOne.id}/documents`)).data.some(d => d.id === documentId && d.extraction_status === 'completed'));
  assert.equal((await request(`/api/patients/${patientTwo.id}/documents/${documentId}/download`)).status, 404);
  const download = await fetch(`${base}/api/patients/${patientOne.id}/documents/${documentId}/download`, { headers: { Authorization: `Bearer ${patientToken}` } });
  assert.equal(download.status, 200);
  assert.match(await download.text(), /SYNTHETIC DEMO DOCUMENT/);
});
test('query upload automatically analyzes every point and dispatches both channels', async () => {
  await upload(patientOne, 'documents', 'documents\\policy-copy.txt', 'policy_copy');
  const uploaded = await upload(patientOne, 'queries', 'queries\\mixed-query.txt');
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  queryId = uploaded.data.id;
  const q = await waitFor(async () => {
    const result = await request(`/api/queries/${queryId}`);
    return result.data.status === 'completed' && result.data.messages?.[0]?.email_status === 'mock_sent' && result.data.messages?.[0]?.whatsapp_status === 'mock_sent' ? result.data : null;
  });
  assert.equal(q.points.length, 4);
  assert.deepEqual(q.points.map(p => p.status), ['available', 'missing', 'available', 'clarification_needed']);
  const message = q.messages[0].message_body;
  assert.match(message, /hospital bill/);
  assert.match(message, /delay/);
  assert.doesNotMatch(message, /provide the discharge summary|provide the policy copy/);
  assert.match(message, /Why:/);
  assert.equal(q.messages[0].delivery_mode, 'mock');
  assert.equal((await request(`/api/queries/${queryId}`, { token: staffToken })).status, 200);
  assert.equal((await request(`/api/patients/${patientTwo.id}/queries/${queryId}/download`)).status, 404);
});
test('newly uploaded missing documents trigger reassessment and an updated message', async () => {
  assert.equal((await upload(patientOne, 'documents', 'documents\\hospital-bill.txt', 'hospital_bill', patientToken)).status, 201);
  const q = await waitFor(async () => {
    const result = (await request(`/api/queries/${queryId}`)).data;
    return result.revision > 1 && result.status === 'completed' && result.messages?.length === 2 && result.messages[0].email_status === 'mock_sent' ? result : null;
  });
  assert.equal(q.points[1].status, 'available');
  assert.doesNotMatch(q.messages[0].message_body, /provide the hospital bill/);
  assert.match(q.messages[0].message_body, /delay/);
});
test('an all-available letter never asks for existing documents', async () => {
  const response = await upload(patientOne, 'queries', 'queries\\all-available.txt');
  const q = await waitFor(async () => {
    const result = (await request(`/api/queries/${response.data.id}`)).data;
    return result.status === 'completed' && result.messages?.[0]?.email_status === 'mock_sent' ? result : null;
  });
  assert(q.points.every(p => p.status === 'available'));
  assert.match(q.messages[0].message_body, /do not need to submit anything else/);
});
test('unknown demo letters fail visibly without fabricated success or patient messages', async () => {
  const body = new FormData();
  body.append('file', new Blob(['Unseen query letter. Please supply an item not supported by demo mode.']), 'unseen.txt');
  const response = await request(`/api/patients/${patientOne.id}/queries`, { method: 'POST', body });
  const q = await waitFor(async () => {
    const result = (await request(`/api/queries/${response.data.id}`)).data;
    return result.status === 'needs_review' ? result : null;
  });
  assert.equal(q.messages.length, 0);
  assert.match(q.error, /Demo analysis/);
});
test('file validation, pagination bounds and patient query-upload permissions are enforced', async () => {
  assert.equal((await request('/api/patients?page=-1')).status, 400);
  const body = new FormData();
  body.append('file', new Blob(['not a PDF']), 'fake.pdf'); body.append('doc_type', 'hospital_bill');
  assert.equal((await request(`/api/patients/${patientOne.id}/documents`, { method: 'POST', body })).status, 400);
  assert.equal((await upload(patientOne, 'queries', 'queries\\mixed-query.txt', null, patientToken)).status, 403);
  assert.equal((await request('/api/patients?status=completed')).data.total, 0);
});
test('disabling staff revokes an existing session and audit events are admin-only', async () => {
  assert.equal((await request('/api/users/audit', { token: patientToken })).status, 403);
  const users = (await request('/api/users')).data;
  const staff = users.find(user => user.role === 'staff');
  assert.equal((await request(`/api/users/${staff.id}`, { method: 'PATCH', body: { active: false } })).status, 200);
  assert.equal((await request('/api/auth/me', { token: staffToken })).status, 401);
  assert((await request('/api/users/audit')).data.some(event => event.action === 'document_downloaded'));
});
test('startup recovery reconstructs missing work and does not blindly repeat interrupted deliveries', async () => {
  await stopWorker();
  stopWorker = null;
  const message = (await pool.query('SELECT id FROM messages ORDER BY created_at LIMIT 1')).rows[0];
  await pool.query("UPDATE messages SET whatsapp_status='sending' WHERE id=$1", [message.id]);
  const query = await pool.query("INSERT INTO queries(patient_id,file_name,status) VALUES($1,'interrupted.txt','pending') RETURNING id", [patientOne.id]);
  await require('../src/worker').recoverJobs();
  assert.equal((await pool.query('SELECT whatsapp_status FROM messages WHERE id=$1', [message.id])).rows[0].whatsapp_status, 'unknown');
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM jobs WHERE entity_id=$1 AND status='pending'", [query.rows[0].id])).rows[0].count, 1);
});
test('logout invalidates the server-side token immediately', async () => {
  const token = await login('patient@example.invalid');
  assert.equal((await request('/api/auth/logout', { token, method: 'POST' })).status, 200);
  assert.equal((await request('/api/auth/me', { token })).status, 401);
});
