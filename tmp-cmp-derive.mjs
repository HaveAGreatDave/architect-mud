// TEMP diagnostic — delete after use.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, readPalette } from './scripts/content/lib.mjs';
import { deriveWorld } from './scripts/content/derive.mjs';
import { query } from './server/models/db.js';

function load(t) {
  const dir = join(CONTENT_DIR, t);
  return readdirSync(dir).filter(n => n.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}
const zones = load('zones');
const w = deriveWorld({ zones, regions: load('regions'), connections: [], palette: readPalette() });
const rows = (await query('SELECT zone_id, spec FROM zone_derived')).rows;
const db = new Map(rows.map(r => [r.zone_id, r.spec]));
const at = a => a ? Object.entries(a).filter(([, v]) => v).map(([k]) => k).join('') : '-';
let diffs = 0, missing = 0;
for (const [id, val] of w.render) {
  const f = val?.spec ?? {};
  const d = db.get(id);
  if (!d) { missing++; if (missing < 15) console.log(`MISSING in DB: ${id}`); continue; }
  if (f.feature !== d.feature || f.text !== d.text || f.fill !== d.fill
      || (f.label?.text ?? null) !== (d.label?.text ?? null)
      || (f.label?.kind ?? null) !== (d.label?.kind ?? null)) {
    if (diffs < 60) {
      console.log(`${id}`);
      console.log(`   file: feature=${f.feature} text=${f.text} label=${JSON.stringify(f.label)} auto=${at(f.auto_tile)}`);
      console.log(`   db  : feature=${d.feature} text=${d.text} label=${JSON.stringify(d.label)} auto=${at(d.auto_tile)}`);
    }
    diffs++;
  }
}
console.log(`\nfile zones: ${w.render.size}  db rows: ${rows.length}  diffs: ${diffs}  missingInDb: ${missing}`);
process.exit(0);
