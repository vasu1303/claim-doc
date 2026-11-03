const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const express = require('express');
const helmet = require('helmet');
const axios = require('axios');
const { Resend } = require('resend');

function serviceAuth(req, res, next) {
  const expected = process.env.SERVICE_TOKEN || '';
  const actual = req.get('X-Service-Token') || '';
  if (expected.length < 32 || Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
      !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return res.status(401).json({ error: 'Service authentication required.' });
  next();
}
const outcome = (status, messageId = null, error = null) => ({ status, message_id: messageId, error });

async function send(channel, payload) {
  const mode = process.env.DELIVERY_MODE || 'mock';
  if (!payload.is_synthetic) return outcome('failed', null, 'Real-patient external delivery is disabled. Use synthetic data only.');
  if (mode === 'mock') return outcome('mock_sent', `mock-${payload.idempotency_key}`);
  if (mode !== 'live') return outcome('failed', null, 'DELIVERY_MODE must be mock or live.');
  // Live assignment runs must target explicit test recipients, never patient contact fields.
  const target = channel === 'email' ? process.env.EMAIL_TEST_TO : process.env.WHATSAPP_TEST_NUMBER;
  if (!target) return outcome('failed', null, `Configure ${channel === 'email' ? 'EMAIL_TEST_TO' : 'WHATSAPP_TEST_NUMBER'} before live delivery.`);
  try {
    if (channel === 'email') {
      if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return outcome('failed', null, 'Configure RESEND_API_KEY and EMAIL_FROM.');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const result = await resend.emails.send({
        from: process.env.EMAIL_FROM, to: target, subject: 'Insurance claim: documents and information requested',
        text: payload.message_body,
      }, { idempotencyKey: payload.idempotency_key });
      if (result.error) {
        const retryable = result.error.name === 'rate_limit_exceeded';
        return outcome(retryable ? 'retrying' : 'failed', null, `Email provider rejected the request (${result.error.name}). Check sender verification and recipient restrictions.`);
      }
      if (!result.data?.id) return outcome('unknown', null, 'Email provider returned no delivery identifier.');
      return outcome('sent', result.data.id);
    }
    if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) return outcome('failed', null, 'Configure WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID.');
    const to = target.replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(to)) return outcome('failed', null, 'WHATSAPP_TEST_NUMBER must include a country code.');
    if (payload.message_body.length > 4096) return outcome('failed', null, 'WhatsApp message exceeds 4096 characters. Shorten the message template.');
    const template = process.env.WHATSAPP_TEMPLATE_NAME;
    const templateText = payload.message_body.replace(/\s+/g, ' ').trim();
    if (template && templateText.length > 1024) return outcome('failed', null, 'WhatsApp template parameter exceeds 1024 characters. Use a shorter template or an open text-message conversation.');
    const body = template
      ? { type: 'template', template: { name: template, language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: templateText }] }] } }
      : { type: 'text', text: { body: payload.message_body } };
    const response = await axios.post(
      `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v22.0'}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', to, ...body },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }, timeout: 20000 }
    );
    if (!response.data.messages?.[0]?.id) return outcome('unknown', null, 'WhatsApp provider returned no delivery identifier.');
    return outcome('sent', response.data.messages[0].id);
  } catch (err) {
    if (err.response) {
      const code = err.response.data?.error?.code;
      const retryable = err.response.status === 429;
      console.error(`Provider ${channel} rejected a request: HTTP ${err.response.status}, code ${code || 'unspecified'}`);
      return outcome(retryable ? 'retrying' : 'failed', null,
        `Provider rejected the request (HTTP ${err.response.status}${code ? `, code ${code}` : ''}). Check credentials, approved recipient, and WhatsApp conversation/template requirements.`);
    }
    console.error(`Provider ${channel} transport error:`, err.code || 'network');
    return outcome('unknown', null, 'Provider outcome is unknown. Verify the provider dashboard before resending.');
  }
}
function createApp() {
  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: '128kb' }));
  app.post('/send/:channel', serviceAuth, async (req, res, next) => {
    const { channel } = req.params;
    const { idempotency_key, message_body, is_synthetic } = req.body;
    if (!['whatsapp', 'email'].includes(channel) || typeof idempotency_key !== 'string' ||
        !/^[a-zA-Z0-9-]{8,100}$/.test(idempotency_key) || typeof message_body !== 'string' ||
        !message_body.trim() || message_body.length > 20000 || typeof is_synthetic !== 'boolean') {
      return res.status(400).json({ error: 'Invalid delivery request.' });
    }
    try { res.json(await send(channel, req.body)); } catch (err) { next(err); }
  });
  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'messenger', delivery_mode: process.env.DELIVERY_MODE || 'mock' }));
  app.use((err, req, res, next) => {
    console.error('Messenger error:', err.message);
    res.status(500).json({ error: 'Messenger request failed.' });
  });
  return app;
}
if (require.main === module) {
  if ((process.env.SERVICE_TOKEN || '').length < 32) throw new Error('Configure SERVICE_TOKEN in the root environment file.');
  const port = Number(process.env.MESSENGER_PORT || 8002);
  createApp().listen(port, '127.0.0.1', () => console.log(`Messenger: http://localhost:${port}`));
}
module.exports = { createApp, send };
