require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Resend } = require('resend');

const app = express();
app.use(cors());
app.use(express.json());

const resend = new Resend(process.env.RESEND_API_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Cloud API
// ─────────────────────────────────────────────────────────────────────────────
async function sendWhatsApp(to, text) {
  if (!process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_TOKEN === 'your_whatsapp_token') {
    console.log(`[WhatsApp MOCK] To: ${to}\n${text}`);
    return { mock: true, to };
  }
  const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: to.replace(/[^+\d]/g, ''),
    type: 'text',
    text: { body: text },
  };
  const resp = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
  });
  return resp.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Email via Resend
// ─────────────────────────────────────────────────────────────────────────────
async function sendEmail(to, subject, text) {
  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === 're_your_key') {
    console.log(`[Email MOCK] To: ${to}\nSubject: ${subject}\n${text}`);
    return { mock: true, to };
  }
  const html = text.split('\n').map(line => `<p>${line}</p>`).join('');
  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    text,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">${html}</div>`,
  });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch endpoint
// ─────────────────────────────────────────────────────────────────────────────
app.post('/dispatch', async (req, res) => {
  const { patient_id, query_id, patient_name, patient_phone, patient_email, message_body } = req.body;

  let waStatus = 'pending', emailStatus = 'pending';
  let waMessageId = null, emailMessageId = null;
  const waErrors = [];
  const emailErrors = [];

  // WhatsApp
  const phoneTarget = process.env.WHATSAPP_TEST_NUMBER || patient_phone;
  if (phoneTarget) {
    try {
      const waResult = await sendWhatsApp(phoneTarget, message_body);
      waStatus = waResult.mock ? 'mock_sent' : 'sent';
      waMessageId = waResult.messages?.[0]?.id || 'mock';
    } catch (err) {
      console.error('WhatsApp error:', err.message);
      waStatus = 'failed';
      waErrors.push(err.message);
    }
  } else {
    waStatus = 'no_phone';
  }

  // Email
  const emailTarget = patient_email;
  if (emailTarget) {
    try {
      const emailResult = await sendEmail(
        emailTarget,
        'Insurance Claim Query – Action Required',
        message_body
      );
      emailStatus = emailResult.mock ? 'mock_sent' : 'sent';
      emailMessageId = emailResult.id || 'mock';
    } catch (err) {
      console.error('Email error:', err.message);
      emailStatus = 'failed';
      emailErrors.push(err.message);
    }
  } else {
    emailStatus = 'no_email';
  }

  // Record in backend
  try {
    await axios.post(`${process.env.BACKEND_URL}/api/messages`, {
      patient_id,
      query_id,
      message_body,
      whatsapp_status: waStatus,
      email_status: emailStatus,
      whatsapp_message_id: waMessageId,
      email_message_id: emailMessageId,
    });
  } catch (err) {
    console.error('Failed to record message in backend:', err.message);
  }

  res.json({
    whatsapp: { status: waStatus, message_id: waMessageId, errors: waErrors },
    email: { status: emailStatus, message_id: emailMessageId, errors: emailErrors },
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'messenger' }));

const PORT = process.env.PORT || 8002;
app.listen(PORT, () => console.log(`📨 Messenger running on http://localhost:${PORT}`));
