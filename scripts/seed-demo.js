const { Pool } = require('pg');

if (!process.env.ALLOW_DEMO_SEED || process.env.NODE_ENV === 'production') {
  console.log('Demo seeding is disabled. Set ALLOW_DEMO_SEED=1 and NODE_ENV=development to enable a local-only demo seed.');
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for demo seeding.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const demoTickets = [
  {
    customer_name: 'Maya Patel',
    customer_email: 'maya.patel@northstar.io',
    subject: 'Billing discrepancy on annual plan',
    description: 'Customer reports duplicate invoice entries after renewal.',
    priority: 'Urgent',
    status: 'Open',
  },
  {
    customer_name: 'Ethan Brooks',
    customer_email: 'ethan@harborlabs.co',
    subject: 'Unable to login after password reset',
    description: 'The login screen loops back to the forgot password flow after reset.',
    priority: 'High',
    status: 'In Progress',
  },
  {
    customer_name: 'Nina Romero',
    customer_email: 'nina@clearline.app',
    subject: 'Export feature returns partial CSV',
    description: 'Large CSV export appears to omit the last three rows.',
    priority: 'Medium',
    status: 'Open',
  },
  {
    customer_name: 'Julian Park',
    customer_email: 'julian@meridian.ai',
    subject: 'Mobile app crashes on launch',
    description: 'Crash occurs only on iOS 18.4 on devices with older storage.',
    priority: 'High',
    status: 'Closed',
  },
];

async function main() {
  const client = await pool.connect();

  try {
    const countResult = await client.query('SELECT COUNT(*)::INTEGER AS count FROM tickets');
    const currentCount = Number(countResult.rows[0].count || 0);

    if (currentCount > 10) {
      console.log(`Refusing to seed: database already has ${currentCount} tickets. Use a fresh local development database or delete the demo seed records manually.`);
      process.exit(0);
    }

    for (const ticket of demoTickets) {
      const ticketId = `TKT-${String(Date.now() + Math.random()).slice(-6)}`;
      await client.query(
        `INSERT INTO tickets (ticket_id, customer_name, customer_email, subject, description, status, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ticketId,
          ticket.customer_name,
          ticket.customer_email,
          ticket.subject,
          ticket.description,
          ticket.status,
          ticket.priority,
        ],
      );
    }

    console.log(`Inserted ${demoTickets.length} fictional demo tickets.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Demo seeding failed:', error);
  process.exit(1);
});
