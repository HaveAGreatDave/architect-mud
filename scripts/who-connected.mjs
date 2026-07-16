import { query } from '../server/models/db.js';

const { rows } = await query(`
  SELECT pid, application_name AS app, client_addr, state,
         (now() - state_change)::text AS since_state_change,
         (now() - backend_start)::text AS conn_age,
         left(query, 50) AS last_query
  FROM pg_stat_activity
  WHERE backend_type = 'client backend'
    AND pid <> pg_backend_pid()   -- exclude this script's own connection
  ORDER BY backend_start
`);
console.table(rows.map(r => ({
  pid: r.pid,
  app: r.app,
  client: r.client_addr,
  state: r.state,
  since_state: String(r.since_state_change).split('.')[0],
  conn_age: String(r.conn_age).split('.')[0],
  last_query: r.last_query,
})));
process.exit(0);
