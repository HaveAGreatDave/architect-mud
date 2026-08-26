/**
 * 49 lit rooms were never wired to their building's junction box. 2026-08-26.
 *
 * ── The bug ──────────────────────────────────────────────────────────────────
 *
 * The power sim buckets every zone by its generator (environment.js):
 *
 *     const key = z.generator_id ?? '__orphan__';
 *
 * and Phase 6 then blacks out the orphan bucket UNCONDITIONALLY, every cycle:
 *
 *     for (const z of (zonesByGen.get('__orphan__') || [])) writeZonePower(z, 'offline', 0, cap);
 *
 * So a power_zones row with a NULL generator_id is not "on the city grid" — it is
 * on nothing, and it is dark forever. `source_type: 'city_grid'` buys it nothing;
 * the sim never reads source_type in a decision at all (every occurrence in
 * environment.js is a write).
 *
 * 49 zones holding a real lit fixture are in exactly that state. Each one is in a
 * building that ALREADY HAS a junction box — Second Helpings has
 * gen_zone_util_zone_helpings_shop sitting in its utility room, and that utility
 * room is the one room in the shop whose light works, because it is the one room
 * whose power_zones row carries the generator_id. The shop floor and the restock
 * bay were simply never attached to it.
 *
 * ── What this changes, and what it deliberately does not ─────────────────────
 *
 * ONLY generator_id. Not source_type and not capacity_kw, even though the engine's
 * own reassignZoneGenerator() writes all three — because the working utility room
 * in each of these buildings is already `city_grid` with a generator_id, so
 * matching it is the smaller change and provably the one that works. capacity_kw
 * is a per-zone ceiling and these rooms draw under a kilowatt against a 200 kW
 * one; rewriting it would be churn with a chance of being wrong.
 *
 * ── Why there is a second, DB-only step ──────────────────────────────────────
 *
 * Fixing the files is not enough, and the reason is a trap worth writing down.
 *
 * When the sim cuts a zone it preserves the fixture's intent — light_on = 0,
 * light_on_intended = 1 — and restores it on the transition back:
 *
 *     } else if (nowOk && !wasOk) {   // ← a TRANSITION, not a state
 *
 * `wasOk` comes from power_zones.status, which is derived state the sim stopped
 * persisting. The stale value frozen in every one of these rows is 'powered'. So
 * once the topology is fixed the zone computes 'powered', the sim compares it to
 * a stale 'powered', sees no transition, and NEVER RUNS THE RESTORE. The rooms
 * would stay dark with their lights "installed" and their intent recorded, which
 * is indistinguishable from the bug we just fixed.
 *
 * light_on / light_on_intended are excludeColumns on furniture, so no file can
 * carry them and the deploy structurally cannot do this. Hence --unlatch.
 *
 * ⚠ --unlatch DOES NOT BELONG IN oneshots.bat. It is a clamp, not a converging
 * script: run it a year from now while one of these buildings is in a genuine
 * blackout and it switches the lights back on over the top of the outage — the
 * exact failure the lights-kitchenware script was removed for. Run it once, by
 * hand, after the content is imported, and leave it out of the list.
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *
 *   node scripts/content/wire-orphan-power-zones.mjs                 # report only
 *   node scripts/content/wire-orphan-power-zones.mjs --write         # rewrite content files
 *   npm run content:import                                           # ← then this
 *   node scripts/content/wire-orphan-power-zones.mjs --unlatch       # then clear the latch
 *   node --env-file=.env.prod scripts/content/wire-orphan-power-zones.mjs --unlatch   # prod
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const UNLATCH = process.argv.includes('--unlatch');

const readDir = (dir) => fs.readdirSync(path.join(ROOT, dir))
  .filter(f => f.endsWith('.json'))
  .map(f => ({ file: path.join(ROOT, dir, f), data: JSON.parse(fs.readFileSync(path.join(ROOT, dir, f), 'utf8')) }));

// ── 1. what map is each zone on, and which map holds a junction box ─────────
const mapOfZone = new Map();
for (const { data } of readDir('zones')) if (data.map_id) mapOfZone.set(data.id, data.map_id);

const jbByMap = new Map(); // map_id -> [generator id]
for (const { data } of readDir('generators')) {
  if (data.generator_type !== 'junction_box') continue;
  const map = mapOfZone.get(data.zone_id);
  if (!map) continue;
  if (!jbByMap.has(map)) jbByMap.set(map, []);
  jbByMap.get(map).push(data.id);
}

// ── 2. which zones hold a fixture that is supposed to light the room ────────
// Streetlights are excluded: they answer to the day/night clock, never to intent,
// so an orphaned street tile is not the defect this is about.
const litZones = new Set();
for (const { data } of readDir('furniture')) {
  if (data.object_type !== 'light') continue;
  if ((data.light_type || '') === 'streetlight') continue;
  if (!(data.lumen_output > 0)) continue;
  litZones.add(data.zone_id);
}

// ── 3. which junction box is the one actually in service ────────────────────
// Eight of these maps hold TWO junction-box rows in a single utility room: the
// canonical gen_zone_util_<zone> and a timestamped duplicate the autobuild left
// behind. They are not a real choice — the utility room's own power_zones row
// already names the one it runs on, and that room's light is the one still
// working. So the tie-break is "whichever box this building is already using",
// which needs no judgement about the stray. (The duplicates are their own bit of
// litter and are deliberately not touched here.)
const inServiceGens = new Set();
for (const { data } of readDir('power_zones')) if (data.generator_id) inServiceGens.add(data.generator_id);

const pickBox = (boxes) => {
  if (boxes.length <= 1) return boxes[0];
  const live = boxes.filter(g => inServiceGens.has(g));
  return live.length === 1 ? live[0] : undefined;
};

// ── 4. rewire every orphan that has a junction box to attach to ─────────────
const wired = [];
const skipped = [];
for (const { file, data } of readDir('power_zones')) {
  if (data.generator_id !== null && data.generator_id !== undefined) continue;
  if (!litZones.has(data.id)) continue;
  const map = mapOfZone.get(data.id);
  const boxes = (map && jbByMap.get(map)) || [];
  const box = pickBox(boxes);
  if (!box) {
    skipped.push(`${data.id} — ${boxes.length === 0
      ? 'no junction box on ' + (map || 'no map')
      : boxes.length + ' junction boxes on ' + map + ' and none of them singled out as in service'}`);
    continue;
  }
  data.generator_id = box;
  if (WRITE) fs.writeFileSync(file, canonicalJson(data), 'utf8');
  wired.push([data.id, box]);
}

console.log(`${WRITE ? 'wired' : 'would wire'} ${wired.length} orphaned lit zone(s) to their building's junction box:`);
for (const [z, g] of wired) console.log(`  ${z}  ->  ${g}`);
if (skipped.length) {
  console.log(`\nskipped ${skipped.length} — these need a junction box built, or a choice made:`);
  for (const s of skipped) console.log(`  ${s}`);
}
if (!WRITE && !UNLATCH) console.log('\n(report only — pass --write to rewrite the content files)');

// ── 5. clear the light latch the deploy cannot carry ────────────────────────
//
// The zones the file pass above found orphaned, frozen as a list on 2026-08-26.
//
// It has to be frozen, and the reason is the whole shape of this script: --unlatch
// runs AFTER content:import, by which point the files are already correct and the
// pass above rightly finds nothing. Deriving the list from what this run changed
// gives an empty set on every run that matters.
//
// A frozen list is also the only version that stays narrow. The obvious dynamic
// rule — "any lit zone attached to its map's junction box that still carries a
// latch" — matches the Echelon, whose rooms are dark because an airship's engine
// is off, and switches its lights on from under it. This can only ever touch the
// 49 rooms that were actually broken, which is what makes re-running it harmless.
const TARGET_ZONES = [
  'zone_adequate_floor', 'zone_adequate_upper', 'zone_bolt_shop',
  'zone_bolt_yard', 'zone_broth_counter', 'zone_broth_galley',
  'zone_giardia_back', 'zone_giardia_shop', 'zone_greenroom_booth',
  'zone_greenroom_lounge', 'zone_helpings_back', 'zone_helpings_shop',
  'zone_hock_pawn', 'zone_hulls_back', 'zone_hulls_shop',
  'zone_kessel_back', 'zone_kessel_shop', 'zone_kiln_back',
  'zone_kiln_shop', 'zone_ksab_gallery', 'zone_ksab_lobby',
  'zone_meltwater_clinic', 'zone_meltwater_diner', 'zone_mintcond_back',
  'zone_mintcond_floor', 'zone_secondskin_fitting', 'zone_secondskin_floor',
  'zone_sentinel_bullpen', 'zone_sentinel_editor', 'zone_slag_back',
  'zone_slag_shop', 'zone_slip_back', 'zone_slip_shop',
  'zone_soak_baths', 'zone_soak_front', 'zone_stimcafe',
  'zone_thumb_back', 'zone_thumb_shop', 'zone_trackmarks_back',
  'zone_trackmarks_shop', 'zone_util_zone_aurelia_floor', 'zone_util_zone_sf_kessler3',
  'zone_util_zone_sf_marrow4', 'zone_util_zone_sf_marrow9', 'zone_util_zone_sf_voss7',
  'zone_util_zone_voltage_floor', 'zone_ward_permits', 'zone_watts_back',
  'zone_watts_shop',
];

if (UNLATCH) {
  const { query } = await import('../../server/models/db.js');
  const ids = TARGET_ZONES;
  // Refuse to run against a database that has not had the topology fix yet — the
  // sim would simply cut these rooms again on its next cycle and the run would
  // look like it worked. Cheap, and it makes the ordering self-enforcing.
  const { rows: [{ n }] } = await query(
    `SELECT COUNT(*)::int AS n FROM power_zones WHERE id = ANY($1) AND generator_id IS NULL`, [ids]);
  if (n > 0) {
    console.error(`\n[unlatch] refusing: ${n} of these zones still have no generator_id here.`);
    console.error('          run --write and then content:import against this database first.');
    process.exit(1);
  }
  // Exactly the restore the sim would have run, scoped to the zones rewired above
  // and gated on a latch actually being present — so a fixture nobody cut is never
  // written, and a second run is a no-op.
  const { rowCount } = await query(`
    UPDATE furniture
       SET light_on = COALESCE(light_on_intended, light_on),
           light_on_intended = NULL
     WHERE zone_id = ANY($1)
       AND object_type = 'light'
       AND COALESCE(light_type, '') <> 'streetlight'
       AND light_on_intended IS NOT NULL`, [ids]);
  console.log(`\n[unlatch] restored ${rowCount} fixture(s) the sim had cut and never brought back`);
  process.exit(0);
}
