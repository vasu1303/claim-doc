const pool = require('./db/pool');

async function enqueue(kind, entityId, key, db = pool) {
  await db.query(
    `INSERT INTO jobs(kind,entity_id,job_key) VALUES($1,$2,$3)
     ON CONFLICT(job_key) DO UPDATE SET status='pending',attempts=0,available_at=NOW(),error=NULL
     WHERE jobs.status IN ('completed','failed')`,
    [kind, entityId, key]
  );
}
async function reprocessPatient(patientId, db = pool) {
  const { rows } = await db.query(
    `UPDATE queries SET status='pending',revision=revision+1,error=NULL
     WHERE patient_id=$1 AND status IN ('completed','needs_review','failed') RETURNING id,revision`, [patientId]
  );
  for (const q of rows) await enqueue('query', q.id, `query:${q.id}:${q.revision}`, db);
}
module.exports = { enqueue, reprocessPatient };
