const path = require('node:path');
const fs = require('node:fs');
const config = require('../config');

let database;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  database = new Pool({ connectionString: process.env.DATABASE_URL });
  database.on('error', (err) => console.error('Database connection error:', err.message));
  database.transaction = async (fn) => {
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  };
} else {
  const { PGlite } = require('@electric-sql/pglite');
  const directory = process.env.PGLITE_DIR || path.join(config.root, 'data', 'postgres');
  fs.mkdirSync(directory, { recursive: true });
  const db = new PGlite(directory);
  const query = async (text, params) => {
    await db.waitReady;
    const result = await db.query(text, params);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  };
  database = {
    query,
    exec: async (text) => { await db.waitReady; return db.exec(text); },
    transaction: async (fn) => { await db.waitReady; return db.transaction((tx) => fn(tx)); },
    end: () => db.close(),
  };
}

module.exports = database;
