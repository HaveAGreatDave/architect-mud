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
export async function logActivity(eventType, handle, adminHandle = null, detail = null) {
  query(
    `INSERT INTO server_activity_log (event_type, handle, admin_handle, detail) VALUES ($1, $2, $3, $4)`,
    [eventType, handle, adminHandle, detail]
  ).then(() =>
    query(`DELETE FROM server_activity_log WHERE id NOT IN (SELECT id FROM server_activity_log ORDER BY occurred_at DESC LIMIT 500)`)
  ).catch(() => {});
}

// For transactions
export async function getClient() {
  return pool.connect();
}

// Run fn inside a single DB transaction. fn receives a `q(text, params)` runner
// bound to the transaction's client — pass it anywhere a `query`-shaped executor
// is accepted (e.g. adjustCredits/transferCredits) so several writes commit as
// one atomic unit. Commits if fn resolves, rolls back if it throws (the error
// then propagates). Returning a value from fn (including a falsy "nothing
// happened" result) commits normally.
export async function withTransaction(fn) {
  const client = await pool.connect();
  const q = (text, params) => client.query(text, params);
  try {
    await client.query('BEGIN');
    const result = await fn(q);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
