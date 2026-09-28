
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool, initDb } = require('./db');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const STATUSES = ['Open', 'In Progress', 'Closed'];

function asyncRoute(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

// POST /api/tickets
app.post('/api/tickets', asyncRoute(async (req, res) => {
  let {
    customer_name,
    customer_email,
    subject,
    description,
    priority
  } = req.body || {};

  customer_name = typeof customer_name === 'string'
    ? customer_name.trim() : '';

  customer_email = typeof customer_email === 'string'
    ? customer_email.trim().toLowerCase() : '';

  subject = typeof subject === 'string'
    ? subject.trim() : '';

  description = typeof description === 'string'
    ? description.trim() : '';

  if (!customer_name || !customer_email || !subject) {
    return res.status(400).json({
      error: 'Customer name, a valid email, and issue title are required'
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
    return res.status(400).json({
      error: 'Please provide a valid customer email'
    });
  }

  if (
    customer_name.length > 120 ||
    customer_email.length > 254 ||
    subject.length > 180 ||
    description.length > 10000
  ) {
    return res.status(400).json({
      error: 'One or more fields exceed the allowed length'
    });
  }

  if (priority && !PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority' });
  }

  const idempotencyKey = req.get('Idempotency-Key');

  if (
    idempotencyKey &&
    (idempotencyKey.length > 200 ||
      !/^[\w:.-]+$/.test(idempotencyKey))
  ) {
    return res.status(400).json({
      error: 'Invalid Idempotency-Key'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Serialize ticket creation to prevent duplicate ticket IDs.
    await client.query(
      'SELECT pg_advisory_xact_lock($1)',
      [981237]
    );

    if (idempotencyKey) {
      const prior = await client.query(
        `SELECT ticket_id, created_at
         FROM ticket_requests
         WHERE request_key = $1`,
        [idempotencyKey]
      );

      if (prior.rows.length) {
        await client.query('COMMIT');

        return res.status(200).json({
          ...prior.rows[0],
          idempotent_replay: true
        });
      }
    }

    const maxResult = await client.query(`
      SELECT COALESCE(
        MAX(SUBSTRING(ticket_id FROM 5)::BIGINT), 0
      ) AS max_num
      FROM tickets
      WHERE ticket_id ~ '^TKT-[0-9]+$'
    `);

    const nextNumber = Number(maxResult.rows[0].max_num) + 1;

    const ticket_id =
      `TKT-${String(nextNumber).padStart(3, '0')}`;

    const created = await client.query(
      `INSERT INTO tickets
       (ticket_id, customer_name, customer_email,
        subject, description, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ticket_id, created_at`,
      [
        ticket_id,
        customer_name,
        customer_email,
        subject,
        description || '',
        priority || 'Medium'
      ]
    );

    const ticket = created.rows[0];

    if (idempotencyKey) {
      await client.query(
        `INSERT INTO ticket_requests
         (request_key, ticket_id, created_at)
         VALUES ($1, $2, $3)`,
        [
          idempotencyKey,
          ticket.ticket_id,
          ticket.created_at
        ]
      );
    }

    await client.query('COMMIT');

    return res.status(201).json(ticket);

  } catch (err) {
    await client.query('ROLLBACK');

    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Ticket already exists; retry the request with the same Idempotency-Key'
      });
    }

    throw err;

  } finally {
    client.release();
  }
}));

// GET /api/stats
app.get('/api/stats', asyncRoute(async (req, res) => {
  const [byStatus, urgent, total] = await Promise.all([
    pool.query(`
      SELECT status, COUNT(*)::INTEGER AS count
      FROM tickets
      GROUP BY status
    `),

    pool.query(`
      SELECT COUNT(*)::INTEGER AS count
      FROM tickets
      WHERE priority = 'Urgent'
        AND status != 'Closed'
    `),

    pool.query(`
      SELECT COUNT(*)::INTEGER AS count
      FROM tickets
    `)
  ]);

  const stats = {
    total: total.rows[0].count,
    open: 0,
    in_progress: 0,
    closed: 0,
    urgent_open: urgent.rows[0].count
  };

  for (const row of byStatus.rows) {
    if (row.status === 'Open') {
      stats.open = row.count;
    }

    if (row.status === 'In Progress') {
      stats.in_progress = row.count;
    }

    if (row.status === 'Closed') {
      stats.closed = row.count;
    }
  }

  res.json(stats);
}));

// GET /api/tickets
app.get('/api/tickets', asyncRoute(async (req, res) => {
  const { status, priority, search } = req.query;

  const page = Math.max(
    1,
    parseInt(req.query.page, 10) || 1
  );

  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit, 10) || 25)
  );

  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  function addCondition(sql, value) {
    params.push(value);
    conditions.push(
      sql.replace('?', `$${params.length}`)
    );
  }

  if (status) {
    if (!STATUSES.includes(status)) {
      return res.status(400).json({
        error: 'Invalid status'
      });
    }

    addCondition('status = ?', status);
  }

  if (priority) {
    if (!PRIORITIES.includes(priority)) {
      return res.status(400).json({
        error: 'Invalid priority'
      });
    }

    addCondition('priority = ?', priority);
  }

  // Search by ticket ID, customer name, email,
  // subject, and description.
  if (search) {
    params.push(`%${search}%`);

    const p = `$${params.length}`;

    conditions.push(
      `(customer_name ILIKE ${p}
        OR customer_email ILIKE ${p}
        OR ticket_id ILIKE ${p}
        OR subject ILIKE ${p}
        OR description ILIKE ${p})`
    );
  }

  const where = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const countResult = await pool.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM tickets
     ${where}`,
    params
  );

  const queryParams = [...params, limit, offset];

  const result = await pool.query(
    `SELECT ticket_id, customer_name, customer_email,
            subject, status, priority, created_at
     FROM tickets
     ${where}
     ORDER BY
       CASE priority
         WHEN 'Urgent' THEN 0
         WHEN 'High' THEN 1
         WHEN 'Medium' THEN 2
         ELSE 3
       END,
       created_at DESC
     LIMIT $${params.length + 1}
     OFFSET $${params.length + 2}`,
    queryParams
  );

  const total = countResult.rows[0].count;

  res.set('X-Total-Count', String(total));
  res.set('X-Page', String(page));
  res.set(
    'X-Total-Pages',
    String(Math.max(1, Math.ceil(total / limit)))
  );

  res.json(result.rows);
}));

// GET /api/tickets/:ticket_id
app.get('/api/tickets/:ticket_id', asyncRoute(async (req, res) => {
  const ticketId = req.params.ticket_id;

  const ticketResult = await pool.query(
    `SELECT *
     FROM tickets
     WHERE ticket_id = $1`,
    [ticketId]
  );

  if (!ticketResult.rows.length) {
    return res.status(404).json({
      error: 'Ticket not found'
    });
  }

  const notesResult = await pool.query(
    `SELECT id, note_text, created_at
     FROM notes
     WHERE ticket_id = $1
     ORDER BY created_at DESC`,
    [ticketId]
  );

  res.json({
    ...ticketResult.rows[0],
    notes: notesResult.rows
  });
}));

// PUT /api/tickets/:ticket_id
app.put('/api/tickets/:ticket_id', asyncRoute(async (req, res) => {
  const ticketId = req.params.ticket_id;

  const { status, priority } = req.body || {};

  const notes = typeof req.body?.notes === 'string'
    ? req.body.notes.trim() : '';

  if (notes.length > 2000) {
    return res.status(400).json({
      error: 'Notes must be 2,000 characters or fewer'
    });
  }

  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({
      error: 'Invalid status'
    });
  }

  if (priority && !PRIORITIES.includes(priority)) {
    return res.status(400).json({
      error: 'Invalid priority'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const ticketResult = await client.query(
      `SELECT ticket_id
       FROM tickets
       WHERE ticket_id = $1
       FOR UPDATE`,
      [ticketId]
    );

    if (!ticketResult.rows.length) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        error: 'Ticket not found'
      });
    }

    const fields = [];
    const values = [];

    if (status) {
      values.push(status);
      fields.push(`status = $${values.length}`);
    }

    if (priority) {
      values.push(priority);
      fields.push(`priority = $${values.length}`);
    }

    fields.push('updated_at = NOW()');

    values.push(ticketId);

    const updated = await client.query(
      `UPDATE tickets
       SET ${fields.join(', ')}
       WHERE ticket_id = $${values.length}
       RETURNING updated_at`,
      values
    );

    if (notes) {
      await client.query(
        `INSERT INTO notes (ticket_id, note_text)
         VALUES ($1, $2)`,
        [ticketId, notes]
      );
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      updated_at: updated.rows[0].updated_at
    });

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;

  } finally {
    client.release();
  }
}));

// Unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'Not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    error: 'Internal server error'
  });
});

// Start server
async function startServer() {
  await initDb();

  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(`Support CRM running on port ${PORT}`);
  });
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = app;