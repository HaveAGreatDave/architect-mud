// scripts/migrate-airfields-to-table.mjs — one-shot DATA TRANSFORMATION.
//
// Lifts the twelve airfield_* config flags off the tiles that carried them and into
// the `airfields` table, leaving `flags.airfield_id` behind as the membership
// pointer (the shape regions and districts already use).
//
// The additive content deploy can never REMOVE a key from an existing row, so the
// strip half has to be a deliberate one-shot; the airfields rows themselves ride the
// ordinary pipeline once this has written content/airfields/*.json.
//
// Two things this deliberately fixes rather than preserves:
//
//   • FUEL WAS AUTHORABLE IN TWO PLACES. fieldStocks() read the ramp and fell back
//     to the hangar interior, so the Echelon helipad had a fuels list on its interior
//     and no fuel flag on its ramp, while Solenne had one on both. The union wins:
//     if either tile said the field stocks fuel, the field stocks fuel — one column,
//     and the fallback in acquisition.js goes away.
//   • airfield_name WAS DUPLICATED onto two hangar interiors as a courtesy copy, and
//     mapPoi() used the presence of that display string as its "this is an airport"
//     predicate. The copies are dropped; the name lives on the row.
//
// IDEMPOTENT, and the guard below is the whole reason it is. The first version of this
// script rebuilt every row from the tiles on every run — so the SECOND run, against tiles
// whose flags it had already stripped, derived a row of all-defaults (the name falling
// back to the tile's own, so Coldwater Regional became "Runway") and upserted that over
// the good data. A migration that destroys its own output when run twice is not a
// migration. A tile with no lifted config and an existing row is now left alone.
//
// ORDER MATTERS ON PROD, and it is the opposite of what it looks like. Prod gets
// SCHEMA_SQL from the CODEX deploy, never from db:schema — so the `airfields` table
// does not exist there until this branch is pushed. The same deploy also INSERTs the
// five rows out of content/airfields/, because the additive import creates rows it has
// never seen. So the push alone leaves prod correct: table, rows, and code agreeing.
//
// What this script does for prod is only the STRIP half — clearing the twelve lifted
// keys off the zone rows, which the additive deploy can never do. Nothing reads them
// after the deploy, so it is hygiene rather than correctness, and it can run whenever.
//
// Local:  npm run db:schema  (creates the table)  then
//         node scripts/migrate-airfields-to-table.mjs
// Prod:   push to main FIRST, then
//         node --env-file=.env.prod scripts/migrate-airfields-to-table.mjs
import fs from 'fs';
import path from 'path';
import { query } from '../server/models/db.js';
import { CONTENT_DIR, canonicalJson } from './content/lib.mjs';

// Every key that becomes a column. `airfield_id` is NOT here — it stays on the tile.
const LIFTED = ['airfield_name', 'airfield_charter', 'airfield_rental', 'airfield_dealer',
  'airfield_fuel', 'airfield_fuels', 'airfield_vtol_only', 'charter_vtol_only',
  'airfield_residents_only', 'airfield_lawless', 'airfield_theme', 'airfield_surface'];

// No table means the schema half hasn't landed on this database yet. Say which step is
// missing rather than letting a 42P01 stack trace be the whole answer — on prod the
// answer is "push first", which is not what a missing-relation error looks like.
const { rows: hasTable } = await query(
  `SELECT to_regclass('public.airfields') IS NOT NULL AS ok`
);
if (!hasTable[0]?.ok) {
  console.error('✗ no `airfields` table on this database.');
  console.error('  local: run `npm run db:schema` first.');
  console.error('  prod:  push to main first — CI applies SCHEMA_SQL and imports content/airfields/.');
  process.exit(1);
}

// ── Gather: the field tile, plus any tile linked to it that carries lifted config ──
const { rows: fields } = await query(
  `SELECT id, name, flags FROM zones WHERE flags ? 'airfield_id' ORDER BY id`
);
if (!fields.length) { console.log('no airfield tiles found — nothing to do'); process.exit(0); }

const { rows: existing } = await query('SELECT id FROM airfields');
const haveRow = new Set(existing.map(r => r.id));

const built = [];
let skipped = 0;
for (const f of fields) {
  const id = f.flags.airfield_id;
  // ALREADY MIGRATED. The tile has nothing left to lift, so there is nothing this
  // script could add — and deriving a row anyway would mean writing defaults over
  // whatever the row has since been edited to say.
  if (haveRow.has(id) && !LIFTED.some(k => k in f.flags)) { skipped++; continue; }
  // The hangar interior this ramp links to, if any — the other place config landed.
  const interiorId = f.flags.hangar_interior_zone || null;
  const { rows: ir } = interiorId
    ? await query('SELECT id, flags FROM zones WHERE id = $1', [interiorId])
    : { rows: [] };
  const iflags = ir[0]?.flags || {};

  // Ramp wins on every scalar; the interior is only consulted for fuel, which is the
  // one key the old reader genuinely fell back on.
  const fuels = Array.isArray(f.flags.airfield_fuels) ? f.flags.airfield_fuels
    : f.flags.airfield_fuel ? ['avgas', 'jet', 'biofuel']
    : Array.isArray(iflags.airfield_fuels) ? iflags.airfield_fuels
    : iflags.airfield_fuel ? ['avgas', 'jet', 'biofuel']
    : null;

  built.push({
    id,
    name: f.flags.airfield_name || f.name,
    charter: !!f.flags.airfield_charter,
    rental: !!f.flags.airfield_rental,
    dealer: !!f.flags.airfield_dealer,
    fuels,
    vtol_only: !!f.flags.airfield_vtol_only,
    charter_vtol_only: !!f.flags.charter_vtol_only,
    residents_only: f.flags.airfield_residents_only || null,
    lawless: !!f.flags.airfield_lawless,
    theme: f.flags.airfield_theme || null,
    surface: f.flags.airfield_surface || null,
  });
}

// ── Write the rows ──────────────────────────────────────────────────────────
for (const a of built) {
  await query(
    `INSERT INTO airfields (id, name, charter, rental, dealer, fuels, vtol_only,
                            charter_vtol_only, residents_only, lawless, theme, surface)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, charter=EXCLUDED.charter,
       rental=EXCLUDED.rental, dealer=EXCLUDED.dealer, fuels=EXCLUDED.fuels,
       vtol_only=EXCLUDED.vtol_only, charter_vtol_only=EXCLUDED.charter_vtol_only,
       residents_only=EXCLUDED.residents_only, lawless=EXCLUDED.lawless,
       theme=EXCLUDED.theme, surface=EXCLUDED.surface`,
    [a.id, a.name, a.charter, a.rental, a.dealer, a.fuels ? JSON.stringify(a.fuels) : null,
     a.vtol_only, a.charter_vtol_only, a.residents_only, a.lawless, a.theme, a.surface]
  );
  console.log(`airfield ${a.id.padEnd(18)} ${a.name}`);
}
if (skipped) console.log(`(${skipped} already migrated — left alone)`);

// ── Strip the lifted keys off every tile, ramp and interior alike ────────────
const { rowCount } = await query(
  `UPDATE zones SET flags = flags - $1::text[] WHERE flags ?| $1::text[]`, [LIFTED]
);
console.log(`\ndb: lifted config off ${rowCount} tiles`);

// ── Content files: the same strip, plus the new airfields/ tree ──────────────
const zoneDir = path.join(CONTENT_DIR, 'zones');
let touched = 0;
for (const name of fs.readdirSync(zoneDir)) {
  if (!name.endsWith('.json')) continue;
  const file = path.join(zoneDir, name);
  const row = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!row.flags || !LIFTED.some(k => k in row.flags)) continue;
  for (const k of LIFTED) delete row.flags[k];
  fs.writeFileSync(file, canonicalJson(row), 'utf8');
  touched++;
}
console.log(`content: rewrote ${touched} zone files`);

const afDir = path.join(CONTENT_DIR, 'airfields');
fs.mkdirSync(afDir, { recursive: true });
const { rows: out } = await query('SELECT * FROM airfields ORDER BY id');
for (const r of out) fs.writeFileSync(path.join(afDir, `${r.id}.json`), canonicalJson(r), 'utf8');
console.log(`content: wrote ${out.length} airfield files`);

const { rows: left } = await query(
  `SELECT count(*)::int AS n FROM zones WHERE flags ?| $1::text[]`, [LIFTED]
);
console.log(`db: tiles still carrying lifted config: ${left[0].n}`);
process.exit(0);
