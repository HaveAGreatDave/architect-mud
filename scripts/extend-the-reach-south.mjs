// Extend THE REACH southwards — twice its own distance from the Basin.
//
// A one-shot content generator. It writes files under `content/` and touches no database: git is the
// source of truth, so this emits the tree and `npm run content:import` loads it. Re-runnable — it
// overwrites its own output and nothing else.
//
// THE MEASUREMENT. The Reach sits x903-922, y976-995: a 20x20 block of scrub. Coldwater's south rim
// is y947, so the void gap between the two is 28 tiles (y948-975) — that is "the distance the Reach
// is from the Basin". Twice that is 56 rows, so the block grows to y996-1051 and the region becomes
// 20 wide by 76 tall. The road in does not move: both void limbs land on the NORTH side
// (`zone_the_reach_870_1958` inbound, `zone_district_918_947` back out — plugins/voidwalking), so
// everything here happens behind the arrival tile and the tank maths in flight-model.js is untouched.
//
// THE GROUND IS UNIFORM ON PURPOSE, exactly as the Scarletwastes shipped. Every new tile is `scrub`
// and nothing else, so the whole extension is one flat canvas to be painted by hand in the Studio
// afterwards. Do not "improve" it by scattering terrain here. Paint it.
//
// THE ID SCHEME IS NOT THE GRID, and this is the trap. Reach zone ids carry a legacy offset:
// `zone_the_reach_<x-40>_<y+972>`, so grid 903,976 is `zone_the_reach_863_1948`. The offset is kept
// rather than corrected, because two naming schemes inside one region is worse than one odd one.
//
// NO EM DASHES in any player-facing prose in this file.
//
// FIRST RUN, in order:
//
//   node scripts/extend-the-reach-south.mjs
//   npm run content:import && npm run map:derive
//
// There are no buildings in here, so unlike the Scarletwastes build this needs no export/import
// round trip to pick up derived map codes.

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const REGION = 'region_the_reach';

const X0 = 903, X1 = 922;        // unchanged: the extension is the same width as the block
const OLD_Y1 = 995;              // the existing southern row, which gains a `south` exit
const NEW_Y0 = 996, NEW_Y1 = 1051;

// The legacy id offset. See the header note.
const id = (x, y) => `zone_the_reach_${x - 40}_${y + 972}`;
const localName = (x, y) => `The Reach ${x - 40},${y + 972}`;
const zonePath = (i) => join(ROOT, 'content', 'zones', `${i}.json`);

// Canonical JSON: keys sorted, two-space indent, trailing newline — matches what `content:export`
// emits, so a later export produces no spurious diff. (A naive sorted-key REPLACER silently empties
// nested objects; sorting the KEYS during stringify does not.)
function canonical(obj) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(obj), null, 2) + '\n';
}
const write = (p, obj) => writeFileSync(p, canonical(obj), 'utf8');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

// Lifted verbatim off the existing 400 tiles so the ambience does not change halfway down the
// region. When the extension gets painted, this is the first thing that should vary by band.
const AMBIENT = [
  "Wind hisses through the scrub, carrying grit and the far-off drone of a plane that isn't coming here.",
  'Something small breaks cover and bolts through the brush, gone before you can place it.',
  "Heat-shimmer wobbles the horizon; for a moment the town looks like it's underwater.",
  'A dust-devil spins up out of nowhere, staggers a few yards across the hardpan, and collapses.',
  'Out in the flats a loose sheet of metal bangs, over and over, in a wind that never fully quits.',
  "The scrub ticks and rustles as the day's heat bleeds slowly out of it.",
  'A buzzard rides the thermals in a wide, patient circle, in no hurry at all.',
  "Grit stings your cheek. The wind out here doesn't stop; it just changes its mind.",
  'Tire-ruts and bootprints cross the hardpan and vanish into the brush, going nowhere good.',
  'The light goes long and copper, and the whole waste seems to hold its breath.',
];

// The existing 400 carry `[PLANNER STUB]`. The new tiles get real prose instead, because a stub that
// ships is a stub that stays. It stays deliberately generic: this is canvas, not content.
const DESCRIPTION =
  'Scrub and hardpan, running flat to a horizon that never gets any closer. The brush comes up to '
  + 'the knee in patches and gives out to bare grit in others, and the wind works steadily through '
  + 'all of it. Nothing out here was built, and nothing out here was cleared.';

const zone = (x, y) => {
  const exits = {};
  // North is unconditional: the row above is either another new row or the old y995 edge, which
  // gains its reciprocal `south` at the bottom of this script.
  exits.north = id(x, y - 1);
  if (y < NEW_Y1) exits.south = id(x, y + 1);
  if (x > X0) exits.west = id(x - 1, y);
  if (x < X1) exits.east = id(x + 1, y);
  return {
    ambient_events: AMBIENT,
    ambient_theme: 'wasteland',
    description: DESCRIPTION,
    exits,
    flags: { lawless: true, region_id: REGION, terrain: 'scrub' },
    grid_x: x,
    grid_y: y,
    grid_z: 0,
    id: id(x, y),
    map_id: 'map_world',
    name: localName(x, y),
    parent_zone: null,
  };
};

// ── Refuse to build over anything ────────────────────────────────────────────
// The box is empty today (nothing in the tree sits at x903-922 below y995), but a generator that
// silently overwrites a neighbour's tiles is a generator that eats a district one day.
const collisions = [];
for (let y = NEW_Y0; y <= NEW_Y1; y++) {
  for (let x = X0; x <= X1; x++) {
    const p = zonePath(id(x, y));
    if (!existsSync(p)) continue;
    const z = read(p);
    if ((z.flags || {}).region_id !== REGION) collisions.push(z.id);
  }
}
if (collisions.length) {
  console.error(`REFUSING: ${collisions.length} tiles in the target box belong elsewhere:`);
  console.error(collisions.slice(0, 10).join('\n'));
  process.exit(1);
}

let written = 0;
for (let y = NEW_Y0; y <= NEW_Y1; y++) {
  for (let x = X0; x <= X1; x++) {
    write(zonePath(id(x, y)), zone(x, y));
    written++;
  }
}

// ── Open the old southern edge ───────────────────────────────────────────────
// Exits are the source of truth for movement, so without this the extension is 1,120 tiles nobody
// can walk into.
let opened = 0;
for (let x = X0; x <= X1; x++) {
  const p = zonePath(id(x, OLD_Y1));
  const z = read(p);
  const south = id(x, NEW_Y0);
  if (z.exits && z.exits.south === south) continue;
  z.exits = { ...(z.exits || {}), south };
  write(p, z);
  opened++;
}

console.log(`The Reach: wrote ${written} tiles (y${NEW_Y0}-${NEW_Y1}, x${X0}-${X1}).`);
console.log(`Opened ${opened} south exits on the old y${OLD_Y1} edge.`);
console.log(`Region is now ${X1 - X0 + 1} x ${NEW_Y1 - 976 + 1} = ${(X1 - X0 + 1) * (NEW_Y1 - 976 + 1)} tiles.`);
console.log('Next: npm run content:import && npm run map:derive');
