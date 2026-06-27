import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

// Single connection pool, reused across all requests
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('DB pool error:', err.message);
});

// Run a query. Automatically acquires + releases a connection.
export async function query(text, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

// Log a server activity event. Caps the table at 500 rows automatically.
export async function logActivity(eventType, handle, adminHandle = null) {
  query(
    `INSERT INTO server_activity_log (event_type, handle, admin_handle) VALUES ($1, $2, $3)`,
    [eventType, handle, adminHandle]
  ).then(() =>
    query(`DELETE FROM server_activity_log WHERE id NOT IN (SELECT id FROM server_activity_log ORDER BY occurred_at DESC LIMIT 500)`)
  ).catch(() => {});
}

// For transactions
export async function getClient() {
  return pool.connect();
}

export default pool;
