
jest.setTimeout(30000);

require('dotenv').config({ path: '.env.local' });

const request = require('supertest');
const { pool, initDb } = require('../db');
const app = require('../server');

beforeAll(async () => {
  await initDb();
});

afterAll(async () => {
  await pool.end();
});

describe('POST /api/tickets', () => {
  test('creates a ticket with required fields', async () => {
    const res = await request(app).post('/api/tickets').send({
      customer_name: 'Aisha Khan',
      customer_email: 'aisha@example.com',
      subject: 'Login not working',
      description: 'Cannot log in after password reset',
    });

    expect(res.status).toBe(201);
    expect(res.body.ticket_id).toMatch(/^TKT-\d{3,}$/);
    expect(res.body.created_at).toBeDefined();
  });

  test('defaults priority to Medium when omitted', async () => {
    const create = await request(app).post('/api/tickets').send({
      customer_name: 'Ravi Mehta',
      customer_email: 'ravi@example.com',
      subject: 'Refund',
    });

    expect(create.status).toBe(201);

    const detail = await request(app)
      .get(`/api/tickets/${create.body.ticket_id}`);

    expect(detail.status).toBe(200);
    expect(detail.body.priority).toBe('Medium');
  });

  test('rejects missing required fields', async () => {
    const res = await request(app).post('/api/tickets').send({
      customer_name: 'No Email',
    });

    expect(res.status).toBe(400);
  });

  test('rejects an invalid priority', async () => {
    const res = await request(app).post('/api/tickets').send({
      customer_name: 'X',
      customer_email: 'x@example.com',
      subject: 'Y',
      priority: 'Whenever',
    });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/tickets', () => {
  test('lists tickets sorted urgent-first', async () => {
    await request(app).post('/api/tickets').send({
      customer_name: 'Low Prio',
      customer_email: 'a@example.com',
      subject: 'Minor issue',
      priority: 'Low',
    });

    await request(app).post('/api/tickets').send({
      customer_name: 'Urgent Prio',
      customer_email: 'b@example.com',
      subject: 'Outage',
      priority: 'Urgent',
    });

    const res = await request(app).get('/api/tickets');

    expect(res.status).toBe(200);
    expect(res.body[0].priority).toBe('Urgent');
  });

  test('filters by status and priority', async () => {
    const res = await request(app)
      .get('/api/tickets?status=Open&priority=Urgent');

    expect(res.status).toBe(200);

    res.body.forEach(ticket => {
      expect(ticket.status).toBe('Open');
      expect(ticket.priority).toBe('Urgent');
    });
  });

  test('search matches customer name', async () => {
    const res = await request(app)
      .get('/api/tickets?search=Urgent Prio');

    expect(res.status).toBe(200);
    expect(res.body.some(
      ticket => ticket.customer_name === 'Urgent Prio'
    )).toBe(true);
  });

  test('search matches text found in ticket descriptions', async () => {
    const created = await request(app).post('/api/tickets').send({
      customer_name: 'Description Search Regression',
      customer_email: 'description-regression@example.com',
      subject: 'Routine issue',
      description: 'Unique description-only token ZXQ-500-ONLY',
    });

    expect(created.status).toBe(201);

    const res = await request(app)
      .get('/api/tickets?search=ZXQ-500-ONLY');

    expect(res.status).toBe(200);

    expect(res.body.some(
      ticket => ticket.ticket_id === created.body.ticket_id
    )).toBe(true);
  });

  test('paginates and exposes count headers', async () => {
    const res = await request(app)
      .get('/api/tickets?page=1&limit=1');

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.headers['x-total-count']).toBeDefined();
    expect(res.headers['x-total-pages']).toBeDefined();
  });
});

describe('GET /api/tickets/:ticket_id', () => {
  test('returns ticket detail with notes array', async () => {
    const created = await request(app).post('/api/tickets').send({
      customer_name: 'Detail Test',
      customer_email: 'd@example.com',
      subject: 'Check detail',
    });

    expect(created.status).toBe(201);

    const res = await request(app)
      .get(`/api/tickets/${created.body.ticket_id}`);

    expect(res.status).toBe(200);
    expect(res.body.ticket_id).toBe(created.body.ticket_id);
    expect(Array.isArray(res.body.notes)).toBe(true);
  });

  test('404s for an unknown ticket', async () => {
    const res = await request(app).get('/api/tickets/TKT-999999');

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/tickets/:ticket_id', () => {
  test('updates status and priority, and adds a note', async () => {
    const created = await request(app).post('/api/tickets').send({
      customer_name: 'Update Test',
      customer_email: 'u@example.com',
      subject: 'Needs update',
    });

    expect(created.status).toBe(201);

    const id = created.body.ticket_id;

    const update = await request(app)
      .put(`/api/tickets/${id}`)
      .send({
        status: 'In Progress',
        priority: 'High',
        notes: 'Investigating now',
      });

    expect(update.status).toBe(200);
    expect(update.body.success).toBe(true);

    const detail = await request(app).get(`/api/tickets/${id}`);

    expect(detail.body.status).toBe('In Progress');
    expect(detail.body.priority).toBe('High');
    expect(detail.body.notes.length).toBe(1);
    expect(detail.body.notes[0].note_text).toBe('Investigating now');
  });

  test('rejects an invalid status', async () => {
    const created = await request(app).post('/api/tickets').send({
      customer_name: 'Bad Status',
      customer_email: 'b@example.com',
      subject: 'Test',
    });

    expect(created.status).toBe(201);

    const res = await request(app)
      .put(`/api/tickets/${created.body.ticket_id}`)
      .send({ status: 'Cancelled' });

    expect(res.status).toBe(400);
  });

  test('404s for an unknown ticket', async () => {
    const res = await request(app)
      .put('/api/tickets/TKT-999999')
      .send({ status: 'Closed' });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/stats', () => {
  test('returns counts by status and open-urgent count', async () => {
    const res = await request(app).get('/api/stats');

    expect(res.status).toBe(200);

    expect(res.body).toEqual(expect.objectContaining({
      total: expect.any(Number),
      open: expect.any(Number),
      in_progress: expect.any(Number),
      closed: expect.any(Number),
      urgent_open: expect.any(Number),
    }));
  });
});