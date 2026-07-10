// Schema report — introspects the live DB and renders an interactive HTML explorer
// with an automated inefficiency review (missing FK indexes, convention joins,
// sparse columns, redundant indexes, islands).
//
//   npm run db:report                                       → local dev DB
//   node --env-file=.env.prod tools/schema-report/report.mjs → prod (read-only queries)
//
// Output: tools/schema-report/schema-report.html (git-ignored). Open it in a browser.
import { query } from '../../server/models/db.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = {};

out.generatedAt = new Date().toISOString();

out.tables = (await query(`
  SELECT c.relname AS table, c.reltuples::bigint AS approx_rows,
         pg_total_relation_size(c.oid) AS total_bytes,
         obj_description(c.oid) AS comment
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY c.relname`)).rows;

out.columns = (await query(`
  SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position`)).rows;

out.fks = (await query(`
  SELECT tc.table_name AS from_table, kcu.column_name AS from_col,
         ccu.table_name AS to_table, ccu.column_name AS to_col,
         rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = 'public'
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = 'public'
  JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`)).rows;

out.pks = (await query(`
  SELECT tc.table_name, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = 'public'
  WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'`)).rows;

out.indexes = (await query(`
  SELECT tablename AS table_name, indexname, indexdef
  FROM pg_indexes WHERE schemaname = 'public'`)).rows;

const nulls = (await query(`
  SELECT tablename AS table_name, attname AS column_name, null_frac
  FROM pg_stats WHERE schemaname = 'public' AND null_frac > 0.5
  ORDER BY tablename`)).rows;

// Workload stats (pg_stat counters) — meaningful mostly against prod, where real
// traffic has accumulated; on dev they reflect regress/dev-session noise.
out.indexUsage = (await query(`
  SELECT s.relname AS table_name, s.indexrelname AS indexname, s.idx_scan,
         pg_relation_size(s.indexrelid) AS bytes,
         i.indisunique OR i.indisprimary AS is_constraint
  FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid = s.indexrelid
  WHERE s.schemaname = 'public'`)).rows;

out.tableActivity = (await query(`
  SELECT relname AS table_name, seq_scan, seq_tup_read, idx_scan,
         n_live_tup, n_dead_tup
  FROM pg_stat_user_tables WHERE schemaname = 'public'`)).rows;

let html = readFileSync(path.join(dir, 'template.html'), 'utf8');
html = html.replace('/*__DATA__*/', JSON.stringify(out));
html = html.replace('/*__NULLS__*/', JSON.stringify(nulls));
const target = path.join(dir, 'schema-report.html');
writeFileSync(target, html);

console.log(`tables=${out.tables.length} columns=${out.columns.length} fks=${out.fks.length} indexes=${out.indexes.length} sparseCols=${nulls.length}`);
console.log(`wrote ${target}`);
process.exit(0);
