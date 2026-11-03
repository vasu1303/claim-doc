const pool = require('./pool');

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'staff',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(30),
  email VARCHAR(255),
  dob DATE,
  gender VARCHAR(20),
  policy_number VARCHAR(100),
  insurer_name VARCHAR(255),
  claim_status VARCHAR(50) DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  file_name VARCHAR(500) NOT NULL,
  original_name VARCHAR(500) NOT NULL,
  doc_type VARCHAR(100) NOT NULL,
  doc_category VARCHAR(100),
  file_url TEXT NOT NULL,
  file_size BIGINT,
  mime_type VARCHAR(100),
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  file_name VARCHAR(500),
  file_url TEXT,
  raw_text TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  insurer_name VARCHAR(255),
  received_date DATE DEFAULT CURRENT_DATE,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS query_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id UUID NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  point_index INTEGER NOT NULL,
  description TEXT NOT NULL,
  requirement_type VARCHAR(50) DEFAULT 'document',
  document_type VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending',
  matched_doc_id UUID REFERENCES documents(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  query_id UUID REFERENCES queries(id),
  message_body TEXT NOT NULL,
  whatsapp_status VARCHAR(50) DEFAULT 'pending',
  email_status VARCHAR(50) DEFAULT 'pending',
  whatsapp_message_id VARCHAR(255),
  email_message_id VARCHAR(255),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patients_patient_id ON patients(patient_id);
CREATE INDEX IF NOT EXISTS idx_documents_patient_id ON documents(patient_id);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_queries_patient_id ON queries(patient_id);
CREATE INDEX IF NOT EXISTS idx_query_points_query_id ON query_points(query_id);
CREATE INDEX IF NOT EXISTS idx_messages_patient_id ON messages(patient_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS is_synthetic BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extracted_text TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE queries ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE queries ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE queries ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE queries ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE query_points ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE query_points ADD COLUMN IF NOT EXISTS qualifiers TEXT NOT NULL DEFAULT '';
ALTER TABLE query_points ADD COLUMN IF NOT EXISTS evidence TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS whatsapp_error TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS email_error TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS patient_assignments (
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (patient_id, user_id)
);
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  entity_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_query_revision ON messages(query_id, revision);
CREATE UNIQUE INDEX IF NOT EXISTS idx_query_point_index ON query_points(query_id, point_index);
CREATE INDEX IF NOT EXISTS idx_jobs_ready ON jobs(status, available_at);
CREATE INDEX IF NOT EXISTS idx_assignments_user ON patient_assignments(user_id);
`;

async function migrate() {
  if (pool.exec) await pool.exec(schema);
  else await pool.query(schema);
}

if (require.main === module) {
  migrate().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = migrate;
