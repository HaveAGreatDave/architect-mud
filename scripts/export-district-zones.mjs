// Targeted export: rewrite content/zones/zone_district_<x>_<y>.json from the local
// DB, using the exact pipeline serialization (excludeColumns + canonical bytes).
// Surgical alternative to `content:export` on a played DB — touches only district
// grid tiles, so it captures terrain repaints + exit wiring without dredging up
// runtime residue from every other table. Run: node scripts/export-district-zones.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { contentEntries } from '../server/models/content-registry.js';
import { canonicalJson, rowToFileObject, fileNameForRow, needsSsl, CONTENT_DIR } from './content/lib.mjs';

const entry = contentEntries().find(e => e.table === 'zones');
const url = (() => { const m = readFileSync('.env', 'utf8').match(/^DATABASE_URL=(.+)$/m); return m[1].trim().replace(/^["']|["']$/g, ''); })();
const c = new pg.Client({ connectionString: url, ssl: needsSsl(url) ? { rejectUnauthorized: false } : false });
await c.connect();
const { rows } = await c.query(`SELECT * FROM zones WHERE id ~ '^zone_district_[0-9]+_[0-9]+$' ORDER BY id`);
await c.end();

let written = 0, skipped = 0, created = 0;
for (const row of rows) {
  const file = join(CONTENT_DIR, 'zones', fileNameForRow(entry, row));
  const next = canonicalJson(rowToFileObject(entry, row));
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (prev === next) { skipped++; continue; }
  writeFileSync(file, next);
  if (prev === null) created++; else written++;
}
console.log(`district zones: ${rows.length} rows — ${written} updated, ${created} newly written, ${skipped} unchanged`);
