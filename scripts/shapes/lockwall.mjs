// lockwall: does a truck stop at the South Lock's plate, and does it still get in by the one door?
//
//   node scripts/shapes/lockwall.mjs
//   node scripts/shapes/lockwall.mjs --detail
//
// The lock is a mark, not a building, so the building sweep never saw its walls and a cab could
// drive in through the side of the Outer Lock and out through the gate without using a door.
// `groundObstructionAt` now reads the lock's walls off the same `lk` fields GLASS draws from, when
// the caller passes the cells round the point (cab-view.js does). This drives a rig across each wall
// at the sampling the cab uses, both ways round: every wall stops it, and the mouth, the gate tube
// and the lanes inside do not. Then it drops the door for a lockdown and checks the mouth shuts.
//
// The cells are the baked world (client/game/flightsim-world.json), which deriveSurfaceCell wrote,
// so this is the real hall and not a picture of one. Re-bake after moving the lock and this follows.
import { readFileSync } from 'node:fs';
import { loadWindshield } from './dom-stub.mjs';

const DETAIL = process.argv.includes('--detail');
const ws = await loadWindshield();
const { groundObstructionAt, TRUCK_STEP_Z } = ws;

const fails = [];
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(`${name}${detail ? `: ${detail}` : ''}`);
  else if (DETAIL) console.log(`  ✓ ${name}${detail ? `  (${detail})` : ''}`);
};

const world = JSON.parse(readFileSync(new URL('../../client/game/flightsim-world.json', import.meta.url), 'utf8'));
const base = world.cells;
const cellsWith = (patch = {}) => (x, y) => patch[x + ',' + y] || base[x + ',' + y] || null;

// The cab's sampling: four points a frame. A frame's worth of road at the worst either sim sees, and
// a start a fraction of a step off the grid so no sample lands exactly on a wall's line (the trap
// curtain.mjs records: a zero-thickness plane passes every symmetric walk).
const SWEEP = 4, WORST_FRAME = 0.25, STEP = WORST_FRAME / SWEEP;
function blocked(cellAt, fx, fy, tx, ty) {
  const L = Math.hypot(tx - fx, ty - fy), ux = (tx - fx) / L, uy = (ty - fy) / L;
  for (let d = STEP * 0.317; d <= L; d += STEP) {
    const px = fx + ux * d, py = fy + uy * d, wx = Math.round(px), wy = Math.round(py);
    if (groundObstructionAt(wx, wy, cellAt(wx, wy), px, py, 0.01, TRUCK_STEP_Z, cellAt) > 0) return [px, py];
  }
  return null;
}
const at = (p) => p ? p.map((v) => v.toFixed(2)).join(',') : 'clear';

const lockTiles = Object.entries(base).filter(([, c]) => c.lk).map(([k]) => k);
check('the baked world has both halls', lockTiles.length === 11, `${lockTiles.length} lock tiles: ${lockTiles.join(' ')}`);
const cw = cellsWith();

// ── 1. THE ONE WAY THROUGH ───────────────────────────────────────────────────
// Glacis road in through the middle mouth, the length of the hall, the tube, the gate, the inner
// lock and out onto Meltwater Row. Down the middle of the lane, as a driver would.
{
  const p = blocked(cw, 911, 923.6, 911, 915.4);
  check('a rig drives from the waste to the town through the mouth and the gate', !p, `stopped at ${at(p)}`);
}
// The side lanes are inside the hall, and the scale lane is where everybody is sent.
check('the weigh lane is open from end to end inside the hall', !blocked(cw, 910, 922.35, 910, 919.65));
check('…and so is the police lane', !blocked(cw, 912, 922.35, 912, 919.65));
check('a rig can cross the hall from lane to lane', !blocked(cw, 910, 921, 912, 921));

// ── 2. EVERY OTHER WAY IS PLATE ──────────────────────────────────────────────
// Each crossing starts outside and ends inside, then runs back the other way: a wall must stop both.
const WALLS = [
  ['the Post Ramp\'s old mouth, from the waste', 912, 923.6, 912, 921.8],
  ['the weigh lane\'s end, from the waste', 910, 923.6, 910, 921.8],
  ['the hall\'s west wall, at the south corner', 907.6, 922, 910, 922],
  ['the hall\'s west wall, at the empty corner', 907.6, 920, 910, 920],
  ['the hall\'s east wall, at the empty corner', 914.4, 920, 912, 920],
  ['the hall\'s north wall, from the Curtain side', 910, 919.2, 910, 921],
  ['the inner lock\'s west wall, from Windrow Lane', 909.6, 918, 911, 918],
  ['the inner lock\'s east wall, from the meadow', 912.4, 917, 911, 917],
];
for (const [name, fx, fy, tx, ty] of WALLS) {
  const inward = blocked(cw, fx, fy, tx, ty), outward = blocked(cw, tx, ty, fx, fy);
  check(`${name} stops a rig going in`, !!inward, at(inward));
  check(`${name} stops a rig going out`, !!outward, at(outward));
}

// ── 3. THE DOOR COMES DOWN ───────────────────────────────────────────────────
// What deriveSurfaceCell puts on the mouth's tile while the city is locked down: the side leaves
// `mo`, joins `wl`, and is named in `dn`. The hall is otherwise the same hall.
{
  const k = '911,922', c = base[k];
  const mo = c?.lk?.mo || '';
  check('the mouth is on the hall\'s south end', mo === 's', JSON.stringify(c?.lk));
  const down = { ...c, lk: { ...c.lk, mo: undefined, wl: (c.lk.wl || '') + 's', dn: 's', ld: 1 } };
  const ld = cellsWith({ [k]: down });
  const p = blocked(ld, 911, 923.6, 911, 921.8);
  check('with the door down, the mouth stops a rig', !!p, at(p));
  check('…from the inside as well', !!blocked(ld, 911, 921.8, 911, 923.6));
  check('…and the gate end is still open behind it', !blocked(ld, 911, 921.5, 911, 915.4));
}

// ── 4. THE PROBE IS OPT-IN ───────────────────────────────────────────────────
// Without the cells round it, `groundObstructionAt` answers as it always did: a lock is a road.
{
  const c = base['911,918'];
  check('without `cellAt` a lock wall is not tested', groundObstructionAt(911, 918, c, 911.5, 918, 0.01, TRUCK_STEP_Z) === 0);
  check('with it, the same point is plate', groundObstructionAt(911, 918, c, 911.5, 918, 0.01, TRUCK_STEP_Z, cw) > 0);
}

if (fails.length) {
  console.error(`\n✗ lockwall: ${fails.length} failure${fails.length === 1 ? '' : 's'}:`);
  for (const f of fails) console.error(`    ${f}`);
  process.exit(1);
}
console.log(`✓ lockwall: one way through the South Lock at ${WORST_FRAME} tiles/frame, ${WALLS.length} walls stop a rig both ways, `
  + 'and the door shuts the mouth for a lockdown.');
