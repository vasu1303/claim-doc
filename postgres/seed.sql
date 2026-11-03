-- Sample users
INSERT INTO users (name, email, password_hash, role) VALUES
  ('Admin User', 'admin@locker.dev', '$2b$10$qVLj/OYyYn2A1GFQQ4Lr3.P.0BG/qK.HtriPDx7N.cYVNQfWGolby', 'admin')
ON CONFLICT DO NOTHING;
-- Default password: admin123

-- Sample patients (10)
INSERT INTO patients (patient_id, name, phone, email, dob, gender, policy_number, insurer_name, claim_status) VALUES
  ('PAT-001', 'Rahul Sharma', '+919876543210', 'rahul.sharma@email.com', '1985-03-15', 'Male', 'POL-2024-001', 'Star Health Insurance', 'pending'),
  ('PAT-002', 'Priya Mehta', '+919876543211', 'priya.mehta@email.com', '1990-07-22', 'Female', 'POL-2024-002', 'HDFC ERGO Health', 'processing'),
  ('PAT-003', 'Arun Kumar', '+919876543212', 'arun.kumar@email.com', '1978-11-30', 'Male', 'POL-2024-003', 'Max Bupa Health', 'pending'),
  ('PAT-004', 'Sunita Verma', '+919876543213', 'sunita.verma@email.com', '1965-04-10', 'Female', 'POL-2024-004', 'New India Assurance', 'completed'),
  ('PAT-005', 'Vikram Singh', '+919876543214', 'vikram.singh@email.com', '1992-09-05', 'Male', 'POL-2024-005', 'Bajaj Allianz Health', 'pending'),
  ('PAT-006', 'Anjali Patel', '+919876543215', 'anjali.patel@email.com', '1988-01-18', 'Female', 'POL-2024-006', 'ICICI Lombard Health', 'processing'),
  ('PAT-007', 'Rajesh Nair', '+919876543216', 'rajesh.nair@email.com', '1975-06-25', 'Male', 'POL-2024-007', 'SBI Health Insurance', 'pending'),
  ('PAT-008', 'Deepa Krishnan', '+919876543217', 'deepa.krishnan@email.com', '1983-12-03', 'Female', 'POL-2024-008', 'Reliance Health', 'awaiting_documents'),
  ('PAT-009', 'Mohit Gupta', '+919876543218', 'mohit.gupta@email.com', '1995-08-14', 'Male', 'POL-2024-009', 'Care Health Insurance', 'pending'),
  ('PAT-010', 'Kavitha Reddy', '+919876543219', 'kavitha.reddy@email.com', '1970-02-28', 'Female', 'POL-2024-010', 'Aditya Birla Health', 'completed')
ON CONFLICT (patient_id) DO NOTHING;
