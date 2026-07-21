// scripts/reach-night-commute.mjs — one-shot data transformation.
//
// Gives the Reach's five staffed NPCs a real day: a post they work and a cabin at
// The Layover they sleep in. They already carry the default vendor behaviour graph
// (check_work → GO_TO_WORK / GO_HOME), so this only has to fill the three fields
// that graph reads: home_zone, work_zone_id, vendor_schedule.
//
// Why a script and not just the content files: content:import is additive
// (INSERT … ON CONFLICT DO NOTHING) and can never rewrite an existing row, so an
// already-seeded DB needs this. The content/npcs/*.json files are updated in the
// same commit and are the source of truth for a fresh import.
//
//   node scripts/reach-night-commute.mjs                     # local dev DB
//   node --env-file=.env.prod scripts/reach-night-commute.mjs # prod
//
// Idempotent — safe to re-run.

import { query } from '../server/models/db.js';

const SALOON  = 'zone_bld_899_1171_lobby';   // The Coyote's Rest — the saloon floor
const HANGAR  = 'zone_bld_897_1175_lobby';   // Buzzard Field — the hangar bay
const DYNAMO  = 'zone_bld_898_1171_lobby';   // The Dynamo — the switch room

// vendor_schedule hours are 0–24 per weekday. A shift that crosses midnight is two
// ranges on the SAME day key (…→24 and 0→…), which is how the engine's
// isVendorWorkTime reads it — there is no wrap-around range.
const day = (ranges) => Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, ranges]));

const LATE   = day([{ from: 0, to: 4 },  { from: 16, to: 24 }]); // bar hours
const CARDS  = day([{ from: 0, to: 3 },  { from: 18, to: 24 }]); // the game runs at night
const TABLE  = day([{ from: 0, to: 2 },  { from: 19, to: 24 }]); // Del sits down later still
const DAY    = day([{ from: 6, to: 20 }]);                        // daylight flying
const SHIFT  = day([{ from: 8, to: 20 }]);                        // the genset is a day job

const STAFF = [
  // id,                    name,          home cabin,                        post,   schedule
  ['npc_1784515589442', 'Marla Kest',   'zone_bld_900_1171_cabin_marla', SALOON, LATE],
  ['npc_1784515536919', 'Bram Odell',   'zone_bld_900_1171_cabin_bram',  DYNAMO, SHIFT],
  ['npc_reach_dealer',  'Doc Teller',   'zone_bld_900_1171_cabin_doc',   SALOON, CARDS],
  ['npc_reach_gambler', 'Del Roan',     'zone_bld_900_1171_cabin_del',   SALOON, TABLE],
];

// Cass Renner is deliberately NOT in this list. She became the Reach's charter
// pilot (scripts/reach-charter-pilot.mjs), and charter.js `syncPilots()` owns a
// pilot's position from `flags.charter_pilot.shift_start`, hard-relocating them
// every tick. Giving her a vendor_schedule here would put the commute graph's
// GO_TO_WORK/GO_HOME in a tug-of-war with it. She still sleeps in her cabin —
// pilotTarget() sends an off-shift pilot to home_zone.
//
// Amos Dune is deliberately NOT in this list either. He is the fence and the motel keeper,
// homed to the front office with an empty schedule — always on. The air-cargo raws
// loop (UNLOCK_AIR_CARGO → fence pallets) starts by talking to him, so putting him
// to bed would gate a whole supply chain behind the clock.

async function main() {
  // Fail loudly if a cabin or post doesn't exist — a typo'd zone id would strand an
  // NPC in an unreachable room rather than error.
  const zoneIds = [...new Set(STAFF.flatMap(([, , home, work]) => [home, work]))];
  const { rows: found } = await query('SELECT id FROM zones WHERE id = ANY($1)', [zoneIds]);
  const missing = zoneIds.filter(z => !found.some(r => r.id === z));
  if (missing.length) throw new Error(`missing zones: ${missing.join(', ')}`);

  for (const [id, name, home, work, schedule] of STAFF) {
    const { rowCount } = await query(
      `UPDATE npcs SET home_zone = $2, work_zone_id = $3, vendor_schedule = $4 WHERE id = $1`,
      [id, home, work, JSON.stringify(schedule)]);
    if (!rowCount) { console.warn(`  ! ${name} (${id}) not found — skipped`); continue; }
    const hrs = Object.values(schedule)[0].map(r => `${r.from}-${r.to}`).join(',');
    console.log(`  ✓ ${name}: works ${work} (${hrs}), sleeps ${home}`);
  }
  console.log('\nThe Reach now keeps hours. Restart or /world/reload to pick it up.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
