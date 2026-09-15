// chaseclip — does the street behind the vehicle still draw when the camera is behind it too?
//
//   node scripts/shapes/chaseclip.mjs
//   node scripts/shapes/chaseclip.mjs --detail
//
// ⚠ THIS EXISTS BECAUSE `f` MEANS TWO DIFFERENT THINGS AND BOTH OF THEM READ LIKE "HOW FAR AHEAD".
// Every ground pass computes `f = dx·sinh − dy·cosh` off the CRAFT, and the external chase camera
// sits `cam.fwdOff` tiles further back — so a lamp, a signal or a pedestrian that has passed the
// vehicle is still most of the way up the frame while its craft-relative `f` has already gone
// negative. Near-clipping on the raw number deleted it there. drawWorldObjects carries the
// correction and says so in as many words ("clipping on the raw craft distance popped it out the
// instant it passed the tail"); the four passes that stand ON the ground never got it, and the
// result is street furniture blinking out at exactly the moment you are looking at it.
//
// ⚠ AND IT IS INVISIBLE FROM THE ONLY SEATS ANYTHING MEASURES. In a cockpit or a cab the camera is
// ON the craft, `fwdOff` is 0, and the two numbers are the same number — so `framecost` (cockpit +
// cab) and every other harness in this directory are structurally unable to see it. That is why the
// sweep below carries the same rig at three camera distances rather than one: the number that
// matters is not "is anything drawn behind the vehicle" but "does that band grow as the camera
// moves back", and a single seat cannot answer it.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
import { CAB_VIEW_TUNE } from '../../client/shared/cab-render-tune.js';

const DETAIL = process.argv.includes('--detail');
const ws = await loadWindshield();

// ── THE SCENE ───────────────────────────────────────────────────────────────
// A straight north–south street with a crossroads on it and a lamp on every tile. Heading 0 makes
// forward −y, so rows BELOW the centre (ry > R) are the ground the vehicle has already passed.
// `furniture` decides whether the street carries any: the pair of frames differ in nothing else, so
// every call of difference between them belongs to the lamps, the signals and the people.
// ⚠ THE VEHICLE STANDS HALF A TILE OFF A TILE CENTRE (`mapOffset`), AND IT HAS TO. On a whole-tile
// offset the nearest ground behind the craft is a FULL tile back, and a truck's chase camera sits
// ~1.75 tiles out — so with the fix in place there would be exactly one row in the recovered band
// and half the test's resolution would be an accident of where the grid happened to line up. The
// offset puts the rows at −0.4 and −1.4, either side of nothing in particular.
const R = 12, N = R * 2 + 1, OFF_Y = -0.4;
// An APRON rather than a single file of lamps. The recovered band is a couple of tiles deep, so a
// one-tile-wide street puts one or two lamps in it and the difference is small enough to be noise.
const APRON = 4;
function scene({ furniture, where }) {
  const behind = where === 'behind';
  return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
    // Craft-relative forward distance of this row: heading 0 makes forward −y.
    const f = -((y - R) + OFF_Y);
    const on = furniture && (behind ? f < 0 : f > 0) && Math.abs(x - R) <= APRON;
    const base = { kind: 'land', biome: 'citycore', road: 1, pw: 1, flr: 0 };
    // The crossroads, deep enough into the dressed half that its two masts land in the band too.
    if (x === R && y === (behind ? R + 2 : R - 1)) return { ...base, rd: 'nesw', ...(on ? { sl: 1 } : {}) };
    if (x === R) return { ...base, rd: 'ns', ...(on ? { sl: 1 } : {}) };
    // Plain ground either side, deliberately with no buildings at all: a building is the one thing
    // that could hide a lamp for a reason that has nothing to do with the clip being tested.
    return { kind: 'land', biome: 'citycore', flr: 0, ...(on ? { sl: (x + y) % 2, rd: 'ew' } : {}) };
  }));
}

// ── THE COUNTER ─────────────────────────────────────────────────────────────
// framecost.mjs's shape: a Proxy over the stub context tallying every method call. `getContext` is
// replaced rather than wrapped once, because paintWindshield asks for it every frame.
const el = stubCanvas('__chaseclip', 900, 520);
const inner = el.getContext('2d');
let TALLY = 0;
el.getContext = () => new Proxy({}, {
  get(_t, k) {
    const v = inner[k];
    if (typeof v !== 'function') return v;
    return (...a) => { TALLY++; return v(...a); };
  },
  set(_t, k, v) { inner[k] = v; return true; },
});

const SEATS = {
  // The truck's own external chase — `cls: 'truck'`, ground phase, the cab's render tune — which is
  // the seat the report came from.
  // `extZoom` is the wheel, dollied out — a real resting player state (the cab hands the renderer
  // `1.15 × st.extZoom` and the clamp is 2.4), and the one where the camera is far enough back that
  // the ground behind the rig is unmistakeably in frame.
  chase: { cls: 'truck', phase: 'ground', height: 0, worldBlend: 1, variant: 'rigid', tier: 2,
           resFloor: 1, resFloorPx: 1, perfDS: 0, tune: CAB_VIEW_TUNE, external: true, extZoom: 2.4 },
  // The same chase camera dollied all the way IN (the wheel's own floor). It is barely off the rig,
  // so almost nothing behind the rig is in front of it — which is what makes the pair below a
  // measurement of the SETBACK rather than of the clip having been deleted.
  chaseNear: { cls: 'truck', phase: 'ground', height: 0, worldBlend: 1, variant: 'rigid', tier: 2,
               resFloor: 1, resFloorPx: 1, perfDS: 0, tune: CAB_VIEW_TUNE, external: true, extZoom: 0.15 },
  // …and the same rig from inside it. THE CONTROL: `fwdOff` is 0 here, so the fix is arithmetically
  // a no-op and anything behind the vehicle is behind the camera as well.
  cab: { cls: 'truck', phase: 'ground', height: 0, worldBlend: 1, variant: 'rigid', tier: 2,
         resFloor: 1, resFloorPx: 1, perfDS: 0, tune: CAB_VIEW_TUNE, eyeH: 0.12, fovMul: 1.22 },
};

// The clock is frozen for the reason framecost gives: paintWindshield hands `performance.now()` to
// every animated thing in the world, and a pair of frames taken a millisecond apart differ by a
// couple of calls for reasons that have nothing to do with what is being measured.
const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };

function calls(seat, opts) {
  const map = scene(opts);
  // Painted twice, the first discarded: the first frame builds every lazy cache the renderer has.
  let n = 0;
  for (let i = 0; i < 2; i++) {
    TALLY = 0;
    ws.paintWindshield('__chaseclip', { ...SEATS[seat], map, mapOffset: { x: 0, y: OFF_Y }, heading: 0, hour: 21, weather: 'clear', speed: 0.4 });
    n = TALLY;
  }
  return n;
}

const fails = [];
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
  else if (DETAIL) console.log(`  ✓ ${name}${detail ? `  (${detail})` : ''}`);
};

const cost = {};
for (const seat of ['chase', 'chaseNear', 'cab']) for (const where of ['ahead', 'behind']) {
  const on = calls(seat, { furniture: true, where });
  const off = calls(seat, { furniture: false, where });
  cost[`${seat}:${where}`] = on - off;
}
globalThis.performance = clock;
if (DETAIL) for (const k of Object.keys(cost)) console.log(`  · ${k}: ${cost[k]} calls`);

// 1. The case the report is about. A dressed street the vehicle has already driven past must still
//    cost something to draw from a camera standing behind the vehicle.
check('the chase camera still draws the street behind the rig', cost['chase:behind'] > 0,
  `the lamps and signals behind the truck cost ${cost['chase:behind']} canvas calls — nothing is being drawn`);

// 2. …and it must be a real amount, not one stray call. A lamp is on the order of 25 canvas calls,
//    so a hundred is several tiles of dressed street; anything much under that would mean one tile
//    had survived the clip by a hair and the rest are still going.
check('and it is a street rather than a survivor', cost['chase:behind'] > 100,
  `only ${cost['chase:behind']} calls — most of the street is still being clipped`);

// 3. THE DEPTH RECOVERED IS THE CAMERA'S SETBACK, which is the actual claim and the one a call
//    count on its own cannot make. Dolly the same camera all the way in and the band collapses,
//    because the wheel is what moves the clip once the clip is against the camera. Restore the
//    craft-relative test and BOTH go to zero; this is what says the number tracks the setback
//    rather than just being non-zero.
check('the clip follows the camera, not the craft', cost['chase:behind'] > cost['chaseNear:behind'] * 4 + 50,
  `dollied out ${cost['chase:behind']} calls against ${cost['chaseNear:behind']} dollied in — the setback is not moving the clip`);

// 4. THE CAB IS UNTOUCHED. `fwdOff` is 0 from inside the vehicle, so behind it is behind the camera
//    and the same dressed street must still cost exactly nothing — the change is arithmetically a
//    no-op at the seat players spend most of their time in, and this is what says so.
check('the cab draws nothing behind itself', cost['cab:behind'] === 0,
  `${cost['cab:behind']} canvas calls spent on ground the driver cannot see`);

// 5. Both seats still draw the street IN FRONT of them — the sanity leg that says the passes are
//    running at all and the scene is dressed the way this file thinks it is.
check('the chase camera draws the street ahead', cost['chase:ahead'] > 200, `${cost['chase:ahead']} calls`);
check('the cab draws the street ahead', cost['cab:ahead'] > 200, `${cost['cab:ahead']} calls`);

if (fails.length) {
  console.error(`\n✗ chaseclip — ${fails.length} failure${fails.length === 1 ? '' : 's'}:`);
  for (const f of fails) console.error(`    ${f}`);
  process.exit(1);
}
console.log(`✓ chaseclip: the street behind the rig costs ${cost['chase:behind']} canvas calls from the chase camera `
  + `and ${cost['cab:behind']} from the cab — lamps, signals and people are clipped against the CAMERA, not the craft.`);
