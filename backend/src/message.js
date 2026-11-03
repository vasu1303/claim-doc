const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

function generateMessage(patient, points) {
  const template = fs.readFileSync(process.env.MESSAGE_TEMPLATE_PATH || path.join(config.root, 'config', 'message-template.txt'), 'utf8');
  const required = points.filter((p) => p.status !== 'available');
  const lines = required.map((p, index) =>
    `${index + 1}. ${p.description}\n   Why: ${p.reason}\n   ${p.requirement_type === 'clarification' ? 'Please provide a written explanation.' : 'Please upload this document to your locker.'}`
  );
  const values = {
    patient_name: patient.name, patient_id: patient.patient_id,
    required_items: lines.length ? lines.join('\n\n') : 'All requested documents are already in your locker. You do not need to submit anything else.',
    portal_url: `${config.origin}/patients/${patient.id}`,
  };
  for (const requiredKey of ['patient_name', 'required_items']) {
    if (!template.includes(`{${requiredKey}}`)) throw new Error(`Message template is missing {${requiredKey}}.`);
  }
  return template.replace(/\{(patient_name|patient_id|required_items|portal_url)\}/g, (_, key) => values[key]);
}
module.exports = { generateMessage };
