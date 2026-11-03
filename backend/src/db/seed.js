const fs = require('node:fs/promises');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const pool = require('./pool');
const migrate = require('./migrate');
const config = require('../config');
const storage = require('../storage');

async function seed() {
  if (!process.env.ADMIN_EMAIL || (process.env.ADMIN_PASSWORD || '').length < 12) throw new Error('Configure ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) in root .env.');
  await migrate();
  await storage.initialize();
  await pool.query(
    `INSERT INTO users(name,email,password_hash,role) VALUES('Local Administrator',$1,$2,'admin') ON CONFLICT(email) DO NOTHING`,
    [process.env.ADMIN_EMAIL.toLowerCase(), await bcrypt.hash(process.env.ADMIN_PASSWORD, 12)]
  );
  const admin = (await pool.query('SELECT id FROM users WHERE email=$1', [process.env.ADMIN_EMAIL.toLowerCase()])).rows[0];
  const names = ['Alex Demo', 'Blair Demo', 'Casey Demo', 'Drew Demo', 'Ellis Demo', 'Finley Demo', 'Gray Demo', 'Harper Demo', 'Indigo Demo', 'Jordan Demo'];
  for (let i = 0; i < names.length; i++) {
    const short = `DEMO-${String(i + 1).padStart(3, '0')}`;
    const result = await pool.query(
      `INSERT INTO patients(patient_id,name,email,phone,policy_number,insurer_name,is_synthetic,notes)
       VALUES($1,$2,$3,'', $4,'Synthetic Test Insurance',TRUE,'Fictional assignment fixture. Not a real patient.')
       ON CONFLICT(patient_id) DO NOTHING RETURNING id`,
      [short, names[i], `patient${i + 1}@example.invalid`, `DEMO-POL-${i + 1}`]
    );
    if (!result.rows[0]) continue;
    const patientId = result.rows[0].id;
    for (const [type, name] of [['discharge_summary', 'discharge-summary.txt'], ['policy_copy', 'policy-copy.txt']]) {
      const content = await fs.readFile(path.join(config.root, 'samples', 'documents', name));
      const key = await storage.put(content, 'text/plain');
      const { rows } = await pool.query(
        `INSERT INTO documents(patient_id,file_name,original_name,doc_type,file_url,file_size,mime_type,uploaded_by,extracted_text,extraction_status)
         VALUES($1,$2,$3,$4,'private',$5,'text/plain',$6,$7,'completed') RETURNING id`,
        [patientId, key, name, type, content.length, admin.id, content.toString('utf8')]
      );
      if (!rows[0]) throw new Error('Fixture document insertion failed.');
    }
  }
  // No query is seeded: uploading one is the event that must trigger both channels.
  console.log('Admin and ten synthetic lockers are ready. Existing accounts/passwords were not overwritten.');
}
if (require.main === module) seed().then(() => pool.end()).catch(async (err) => {
  console.error('Seed failed:', err.message); await pool.end(); process.exitCode = 1;
});
module.exports = { seed };
