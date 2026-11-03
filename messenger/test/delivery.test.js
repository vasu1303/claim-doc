const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.SERVICE_TOKEN = 'test-service-token-'.padEnd(64, 'x');
process.env.DELIVERY_MODE = 'mock';
const { send, createApp } = require('../src/index');
const axios = require('axios');
const payload = { idempotency_key: 'synthetic-test-message-key', message_body: 'Fictional test notification', is_synthetic: true };

test('mock delivery is explicit and never marked sent', async () => {
  for (const channel of ['email', 'whatsapp']) {
    const result = await send(channel, payload);
    assert.equal(result.status, 'mock_sent');
    assert.match(result.message_id, /^mock-/);
  }
});
test('real patient data is blocked even in mock mode', async () => {
  assert.equal((await send('email', { ...payload, is_synthetic: false })).status, 'failed');
});
test('live mode without explicit recipients fails rather than falling back to mocks', async () => {
  process.env.DELIVERY_MODE = 'live';
  process.env.EMAIL_TEST_TO = '';
  process.env.WHATSAPP_TEST_NUMBER = '';
  assert.equal((await send('email', payload)).status, 'failed');
  assert.equal((await send('whatsapp', payload)).status, 'failed');
  process.env.DELIVERY_MODE = 'mock';
});
test('WhatsApp sends actual generated text to the configured test recipient', async (t) => {
  process.env.DELIVERY_MODE = 'live';
  process.env.WHATSAPP_TEST_NUMBER = '+19995550123';
  process.env.WHATSAPP_TOKEN = 'test-placeholder';
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-id';
  process.env.WHATSAPP_TEMPLATE_NAME = '';
  t.mock.method(axios, 'post', async (url, body) => {
    assert.equal(body.to, '19995550123');
    assert.equal(body.text.body, payload.message_body);
    return { data: { messages: [{ id: 'wa-test-id' }] } };
  });
  assert.equal((await send('whatsapp', payload)).message_id, 'wa-test-id');
  process.env.DELIVERY_MODE = 'mock';
});
test('WhatsApp rate limits retry but network ambiguity does not blindly resend', async (t) => {
  process.env.DELIVERY_MODE = 'live';
  const mocked = t.mock.method(axios, 'post', async () => { throw { response: { status: 429, data: {} } }; });
  assert.equal((await send('whatsapp', payload)).status, 'retrying');
  mocked.mock.mockImplementation(async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); });
  assert.equal((await send('whatsapp', payload)).status, 'unknown');
  process.env.DELIVERY_MODE = 'mock';
});
test('approved WhatsApp template parameters preserve text without prohibited whitespace', async (t) => {
  process.env.DELIVERY_MODE = 'live';
  process.env.WHATSAPP_TEMPLATE_NAME = 'synthetic_claim_update';
  t.mock.method(axios, 'post', async (url, body) => {
    assert.equal(body.type, 'template');
    assert.equal(body.template.components[0].parameters[0].text, 'First line Second line');
    return { data: { messages: [{ id: 'template-id' }] } };
  });
  assert.equal((await send('whatsapp', { ...payload, message_body: 'First line\\nSecond line'.replace('\\n', '\n') })).message_id, 'template-id');
  assert.equal((await send('whatsapp', { ...payload, message_body: 'x'.repeat(1025) })).status, 'failed');
  process.env.WHATSAPP_TEMPLATE_NAME = '';
  process.env.DELIVERY_MODE = 'mock';
});
test('Resend provider IDs and idempotency keys use the actual SDK response shape', async (t) => {
  process.env.DELIVERY_MODE = 'live';
  process.env.EMAIL_TEST_TO = 'recipient@example.invalid';
  process.env.EMAIL_FROM = 'sender@example.invalid';
  process.env.RESEND_API_KEY = 're_test_placeholder';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(String(url), /api\.resend\.com/);
    assert.equal(new Headers(options.headers).get('idempotency-key'), payload.idempotency_key);
    assert.equal(JSON.parse(options.body).text, payload.message_body);
    return new Response(JSON.stringify({ id: 'email-provider-id' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const result = await send('email', payload);
  assert.equal(result.status, 'sent');
  assert.equal(result.message_id, 'email-provider-id');
  process.env.DELIVERY_MODE = 'mock';
});
test('dispatch endpoints require service authentication', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/send/email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    assert.equal(response.status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
