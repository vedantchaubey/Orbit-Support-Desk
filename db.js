
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is missing. Check your .env.local file.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function initDb() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ticket_id TEXT UNIQUE NOT NULL,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'Open'
          CHECK (status IN ('Open','In Progress','Closed')),
        priority TEXT NOT NULL DEFAULT 'Medium'
          CHECK (priority IN ('Low','Medium','High','Urgent')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ticket_requests (
        request_key TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notes (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
        note_text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
      CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
      CREATE INDEX IF NOT EXISTS idx_notes_ticket_id ON notes(ticket_id);
    `);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };