// Read-only content diff: PROD vs LOCAL, across every CONTENT_TABLES entry.
//
//   node scripts/content-diff-prod.mjs
//
// For each world-content table it reports prod row count, local row count, and how
// many primary-key rows exist on PROD but are MISSING locally (the delta you'd pull
// down). Honors the same WHERE filters buildDump() uses (e.g. is_npc=1 orgs), so it
// compares exactly what the seed would carry. Pure SELECTs — never writes anything,
// tiny egress (counts + primary keys only). Reuses CONTENT_TABLES so it can't drift.
import 'dotenv/config';
import pg from 'pg';
import { CONTENT_TABLES } from '../server/api/backup.routes.js';

const LOCAL = process.env.DATABASE_URL;
const PROD = process.env.PROD_DATABASE_URL;
if (!LOCAL || !PROD) { console.error('✗ Need both DATABASE_URL (local) and PROD_DATABASE_URL set in .env'); process.exit(1); }
const isRemote = (u) => !/^(localhost|127\.0\.0\.1|::1)$/.test(new URL(u).hostname);
const client = (u) => new pg.Client({ connectionString: u, ssl: isRemote(u) ? { rejectUnauthorized: false } : undefined });

const local = client(LOCAL);
const prod = client(PROD);
await local.connect();
await prod.connect();

// Primary-key columns per table (schema is identical both sides; read from local).
async function pkCols(table) {
  const { rows } = await local.query(`
    SELECT a.attname FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = $1::regclass AND i.indisprimary`, [table]);
  return rows.map(r => r.attname);
}

const count = async (c, table, where) =>
  (await c.query(`SELECT count(*)::int n FROM ${table}${where ? ' WHERE ' + where : ''}`)).rows[0].n;

const pkSet = async (c, table, cols, where) => {
  const { rows } = await c.query(`SELECT ${cols.map(x => `"${x}"`).join(',')} FROM ${table}${where ? ' WHERE ' + where : ''}`);
  return new Set(rows.map(r => cols.map(x => r[x]).join('')));
};

console.log(`\n  table                          prod   local   pull↓  push↑`);
console.log(  `  ─────────────────────────────  ─────  ─────   ─────  ─────`);
let totalPull = 0, totalPush = 0;
for (const entry of CONTENT_TABLES) {
  const table = typeof entry === 'string' ? entry : entry.table;
  const where = typeof entry === 'string' ? '' : entry.where;
  const [pc, lc] = [await count(prod, table, where), await count(local, table, where)];
  let pull = '—', push = '—';
  try {
    const cols = await pkCols(table);
    if (cols.length) {
      const [ps, ls] = [await pkSet(prod, table, cols, where), await pkSet(local, table, cols, where)];
      const onlyProd = [...ps].filter(k => !ls.has(k)).length;   // on prod, missing local → pull down
      const onlyLocal = [...ls].filter(k => !ps.has(k)).length;  // on local, missing prod → push up
      pull = String(onlyProd); push = String(onlyLocal);
      totalPull += onlyProd; totalPush += onlyLocal;
    }
  } catch (e) { pull = push = 'err:' + e.code; }
  const mark = (v) => (v !== '—' && v !== '0' && !String(v).startsWith('err'));
  const flag = mark(pull) && mark(push) ? '  ⚠ both' : mark(pull) ? '  ⬅ pull' : mark(push) ? '  ➡ push' : '';
  console.log(`  ${table.padEnd(29)}  ${String(pc).padStart(5)}  ${String(lc).padStart(5)}   ${String(pull).padStart(5)}  ${String(push).padStart(5)}${flag}`);
}
console.log(`\n  Prod→local rows to pull: ${totalPull}   |   Local→prod rows to push: ${totalPush}\n`);
await local.end();
await prod.end();
