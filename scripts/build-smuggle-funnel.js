// One-shot map surgery: funnel the wilderness→city border through ONE checkpoint.
//   Preview:  node scripts/build-smuggle-funnel.js --dry
//   Apply:    node scripts/build-smuggle-funnel.js
//   Restart / world-reload after so the zone cache picks up the new exits + flag.
//
// The whole 89-zone wilderness (the Scald included) touches the inhabited city at
// only four doors. Old Coldwater (zone_ruins), reached down The Haul Road, is the
// thematic gateway town — we make it THE gate: sever the two crossings that bypass
// it into the city (Gravel Throat→Meltwater Row and Cardboard Row→The Sprawl), and
// flag zone_ruins as a smuggle checkpoint. The badland route already funnels through
// ruins, so after the two cuts ruins is the sole wilderness→city crossing — every
// raw-carrier must pass its scanner (plugins/smuggle checkpoint gate).
//
// The two cuts strand nothing (verified: all zones stay reachable); the badland
// crossing is deliberately LEFT because cutting it would strand The Static Wood.
// The script refuses to write if the cuts would disconnect the map.
import { query } from '../server/models/db.js';

const CHECKPOINT = 'zone_ruins';
// [a, b] — remove the exit both ways so neither zone links to the other.
const CUTS = [
  ['zone_waste_gravel', 'zone_civ_meltwater'],
  ['zone_deep_cardboard', 'zone_slums'],
];
const CHECKPOINT_LINE = ' A Precinct checkpoint straddles the old haul road here — a scanner arch, a bored guard, and a queue: the one way the wastes bleed into the city.';

const asObj = (v) => (v && typeof v === 'object') ? v : (() => { try { return JSON.parse(v || '{}'); } catch { return {}; } })();
const DRY = process.argv.includes('--dry');

// Remove every exit in `exits` that points at `target`. Returns true if changed.
function removeExit(exits, target) {
  let changed = false;
  for (const [dir, t] of Object.entries(exits)) {
    if (Array.isArray(t)) {
      const kept = t.filter(x => x !== target);
      if (kept.length !== t.length) { changed = true; if (kept.length) exits[dir] = kept.length === 1 ? kept[0] : kept; else delete exits[dir]; }
    } else if (t === target) { delete exits[dir]; changed = true; }
  }
  return changed;
}

async function main() {
  if (DRY) console.log('— DRY RUN: no writes —');
  const { rows } = await query('SELECT id, exits, flags, description FROM zones');
  const Z = new Map(rows.map(r => [r.id, { id: r.id, exits: asObj(r.exits), flags: asObj(r.flags), description: r.description }]));

  // Apply the cuts in memory.
  const touched = new Set();
  for (const [a, b] of CUTS) {
    for (const [from, to] of [[a, b], [b, a]]) {
      const z = Z.get(from);
      if (!z) { console.error(`✗ zone ${from} not found`); process.exit(1); }
      if (removeExit(z.exits, to)) { touched.add(from); console.log(`  cut ${from} ⇏ ${to}`); }
      else console.log(`  (already no ${from} → ${to} exit)`);
    }
  }

  // Connectivity guard: BFS from zone_start over the post-cut graph; every zone must survive.
  const adj = new Map();
  for (const z of Z.values()) { const outs = []; for (const t of Object.values(z.exits)) { const ts = Array.isArray(t) ? t : [t]; for (const tid of ts) if (Z.has(tid)) outs.push(tid); } adj.set(z.id, outs); }
  const seen = new Set(['zone_start']); const q = ['zone_start'];
  while (q.length) { const c = q.shift(); for (const to of adj.get(c) || []) if (!seen.has(to)) { seen.add(to); q.push(to); } }
  const stranded = [...Z.keys()].filter(id => !seen.has(id));
  if (stranded.length) { console.error(`✗ ABORT — the cuts would strand ${stranded.length} zone(s): ${stranded.join(', ')}`); process.exit(1); }
  console.log(`✓ connectivity holds: all ${Z.size} zones still reachable after the cuts.`);

  // Flag the checkpoint + give it a visible cue (once).
  const cp = Z.get(CHECKPOINT);
  if (!cp) { console.error(`✗ checkpoint ${CHECKPOINT} not found`); process.exit(1); }
  cp.flags.checkpoint = true;
  if (cp.description && !/Precinct checkpoint/.test(cp.description)) cp.description = cp.description + CHECKPOINT_LINE;

  if (DRY) { console.log(`\n(dry) would update exits on: ${[...touched].join(', ')}`); console.log(`(dry) would flag ${CHECKPOINT} as checkpoint`); process.exit(0); }

  for (const id of touched) await query('UPDATE zones SET exits=$1::jsonb WHERE id=$2', [JSON.stringify(Z.get(id).exits), id]);
  await query('UPDATE zones SET flags = COALESCE(flags,\'{}\'::jsonb) || \'{"checkpoint":true}\'::jsonb, description=$1 WHERE id=$2', [cp.description, CHECKPOINT]);
  console.log(`✓ funnel built: ${touched.size} zone exits rewired, ${CHECKPOINT} is now the sole scanned crossing. Restart / reload the world.`);
  process.exit(0);
}
main().catch((e) => { console.error('✗ build-smuggle-funnel failed:', e.message); process.exit(1); });
