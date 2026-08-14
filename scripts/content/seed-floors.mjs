/**
 * Seed `flags.floor` on every interior zone.
 *
 * WHAT THIS IS FOR
 *
 * Outdoors, a footstep is voiced by `flags.terrain` — already the ground-surface
 * SSOT, already painted on every tile, so the sound costs no authoring at all.
 * Indoors there is no such field: `resolveTerrain` returns null for an interior
 * BY DESIGN, because an interior has no ground surface. So the indoor half of the
 * question needs its own authored answer, one per room, 591 of them.
 *
 * WHAT THIS IS NOT
 *
 * It is not the authoring. It is a FIRST DRAFT of the authoring, so that the pass
 * starts from something arguable rather than from nothing — a clinic that sounds
 * like a tenement is this feature failing quietly, and the only fix for that is a
 * person reading the list. Run it once, then correct it by hand.
 *
 * It writes ONLY where `flags.floor` is absent, so it is safe to re-run after new
 * interiors are built and it can never overwrite a hand-made decision.
 *
 *   node scripts/content/seed-floors.mjs           # report what it would write
 *   node scripts/content/seed-floors.mjs --write   # write it
 *
 * Files only — no DB in the process. Run `npm run content:lint` and then
 * `npm run content:import` afterwards. Do NOT run `content:export` in between:
 * that rewrites content/ from the local DB and would undo the pass.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

const WRITE = process.argv.includes('--write');
const ZONES = join(CONTENT_DIR, 'zones');

// Rules are tried IN ORDER and the first match wins, so put the specific ones
// first. `re` matches the zone NAME, which is where most of the signal is — 449
// of the 591 interiors carry no district and no building_type at all.
const RULES = [
  // Wet rooms are tiled. The single biggest cluster in the tree.
  [/bathroom|shower|washroom|latrine|lavator|toilet|sauna|pool|locker/i, 'tile'],
  // Cold rooms, laundries and anything else hosed down at the end of a shift.
  [/cold room|freezer|chiller|refrigerat|the wash\b|laundry|soaking/i, 'tile'],
  // A lift car is a steel box, and it is one of the few rooms where that is the
  // most recognisable thing about it.
  [/elevator|lift car|helipad|helideck/i, 'metal'],
  // Machine spaces. Slab under heavy plant.
  [/turbine|switch room|transformer|switchgear|pump ?house|basement|stockroom|store ?room|stock cage|pallet/i, 'concrete'],
  // Somebody spent money on the entrance. Stone reads as civic or as bank.
  [/marble|rotunda|the great hall|hall of /i, 'stone'],
  // Anything clinical, laboratory or food-preparing is a wipeable hard floor.
  [/clinic|surgery|medical|infirmar|ward|autopsy|morgue|lab\b|laborator|chem|kitchen|galley|pharmac|dental/i, 'tile'],
  // Industrial and infrastructural. Poured slab.
  [/bunker|nest|pit|emplacement|generator|plant|works|foundry|refiner|warehouse|depot|garage|hangar|yard|dock|silo|reactor|boiler|utility|maintenance|substation|vault|cell block|holding/i, 'concrete'],
  // Walkways, gantries, decks and anything aboard something that flies or floats.
  [/gantry|catwalk|walkway|engine room|bridge|helm|airlock|deck|cockpit|fuselage|scaffold|rig\b/i, 'metal'],
  // Under the city. Brick and standing water, not floorboards.
  [/sewer|drain|culvert|tunnel|conduit|undercroft|crawl/i, 'stone'],
  // Money. A carpeted floor is a floor somebody is maintaining.
  [/penthouse|suite|sanctum|executive|boardroom|lounge|parlour|parlor|office|study|library|gallery|salon|theatre|theater|cinema|chapel|nave|hotel room|guest room/i, 'carpet'],
  // Municipal and retail: hard-wearing, cheap, and mopped nightly.
  [/concourse|lobby|foyer|atrium|terminal|station|corridor|hallway|stairwell|landing|shop floor|store|market|bodega|counter|canteen|cafeteria|mess\b/i, 'linoleum'],
  // Nothing under it at all.
  [/cave|burrow|den\b|warren|dugout|cellar|root|earthworks/i, 'dirt'],
];

// Everything else. Boards is the fallback the runtime uses too, so an interior
// this script cannot classify sounds the same whether or not it was ever seeded.
const FALLBACK = 'boards';

function proposeFloor(z) {
  const hay = `${z.name || ''} ${z.flags?.building_type || ''} ${z.flags?.district || ''}`;
  for (const [re, floor] of RULES) if (re.test(hay)) return floor;
  return FALLBACK;
}

const counts = {};
let touched = 0, already = 0, interiors = 0;
const samples = {};

for (const file of readdirSync(ZONES)) {
  if (!file.endsWith('.json')) continue;
  const path = join(ZONES, file);
  const z = JSON.parse(readFileSync(path, 'utf8'));
  const flags = z.flags || {};
  if (!(flags.is_interior || flags.is_apartment)) continue;
  interiors++;
  if (flags.floor) { already++; continue; }

  const floor = proposeFloor(z);
  counts[floor] = (counts[floor] || 0) + 1;
  (samples[floor] ||= []).push(z.name || z.id);
  touched++;

  if (WRITE) {
    z.flags = { ...flags, floor };
    writeFileSync(path, canonicalJson(z), 'utf8');
  }
}

console.log(`${interiors} interiors · ${already} already authored · ${touched} ${WRITE ? 'written' : 'would be written'}\n`);
for (const [floor, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${floor.padEnd(9)} ${String(n).padStart(4)}   e.g. ${samples[floor].slice(0, 4).join(' · ')}`);
}
if (!WRITE) console.log('\nDry run. Re-run with --write to apply, then correct it by hand.');
