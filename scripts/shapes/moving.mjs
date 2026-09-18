// moving — do the parts of the city that are supposed to move, move? And do they all stop?
//
//   node scripts/shapes/moving.mjs
//   node scripts/shapes/moving.mjs --report    # every model, and how many poses it has
//
// The motion layer has two promises and no gate held either of them.
//
//   1. THE NAMED PARTS MOVE. "All the cranes are animated" is a standing requirement now, and the
//      way it stops being true is nobody noticing: a crane added next month, or an arm refactored
//      so its jib goes back through `draw3DBoxAt`, draws a perfectly good still crane. Nothing
//      throws, no budget moves, and the only witness is somebody who happens to watch that one
//      building for thirty seconds.
//   2. `RENDER_TUNE.motion` 0 IS THE RENDERER AS IT SHIPPED. That flag's whole contract is "a still
//      crane, not a missing one" — so every animated arm has to collapse to exactly ONE pose with
//      it off, and the pose has to be the one its cycle calls home. An arm that still moves with
//      the slider off is a flag that does not work; an arm that draws NOTHING with it off is the
//      worse half of the same bug, and both of them look fine in a single screenshot.
//
// ⚠ IT SWEEPS A WHOLE PERIOD, NOT THREE INSTANTS. Every cycle here is a DUTY cycle — `work` is
// under half, so a machine is parked most of the time — and three samples can land in the idle
// stretch of all of them and report a city of statues. The sweep walks the longest period in the
// set, so a cycle cannot hide inside the gaps between samples.
//
// ⚠ AND A POSE IS THE WHOLE EMITTED FRAME, not a face count. A slewing crane emits the same number
// of quads at every bearing — what changes is where they are — so anything counting parts would
// pass a jib that had been nailed to one heading, which is the exact failure the motion layer's own
// ⚠ is written about.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const REPORT = process.argv.includes('--report');

// ⚠ A LIST OF REASONS, NOT A LIST OF NAMES. Each of these is here because somebody can look at that
// building and say what it is doing; that is the bar the whole layer is held to, and a model added
// without one does not belong on it.
const MUST_MOVE = new Map([
  ['type:wharf', 'the loading crane slews, runs its trolley and lifts'],
  ['type:quay_crane', 'the harbour crane slews, runs its trolley and lifts a box off a hull'],
  ['type:pier', 'the flags fly downwind and ripple'],
  ['type:junkyard', 'the grabber drops into the scrap pile and takes a bite'],
  ['type:fabrication', 'the gantry trolley runs its beam'],
  ['named:coldwaterclonefacility', 'the vats breathe'],
  ['named:halloransfixit', 'the chain block pulls an engine'],
  ['named:thedynamo', 'the wind wheel turns at the speed of the wind'],
]);

// ⚠ AN ARM MAY CARRY BOTH KINDS OF ANIMATION, and one of them does. `RENDER_TUNE.motion` parks the
// motion LAYER; a smoke plume, a beacon and an arc strike are adornments on their own clocks that
// predate the flag and are not moving parts. So an arm holding one of those still reads as two
// poses with the slider off, and that is correct rather than a leak — but it is exactly the shape
// a jib nailed to one bearing would also have, so it is declared with its REASON rather than
// waved through by a number. Adding a name here without one is how this check stops meaning
// anything.
const ALSO_DRIFTS = new Map([
  ['named:halloransfixit', 'the rooftop extractor smokes, and smoke is not a moving part'],
]);

const ws = await loadWindshield();
const cam = ws.makeCam(640, 160, 360, { heading: 0, height: 0, eyeH: 0.24, map: null });
const reg = ws.shapeModelRegistry();
const byKey = new Map(reg.map((e) => [e.key, e.m]));

// The longest cycle in the layer is the wharf crane's 38 s. Twenty samples over forty seconds puts
// one inside the working stroke of every duty cycle in the set, whatever its phase offset.
const TIMES = Array.from({ length: 20 }, (_, i) => i * 2000);

const poses = (m, motion) => {
  ws.RENDER_TUNE.motion = motion;
  const seen = new Set();
  for (const now of TIMES) {
    const r = ws.canvasResidue(m, { cam, night: 0, bn: 'THE EXAMPLE', dy: -2, now });
    if (r.threw) return { threw: r.threw };
    seen.add(JSON.stringify(r));
  }
  return { n: seen.size };
};

const problems = [], rows = [];
for (const [key, why] of MUST_MOVE) {
  const m = byKey.get(key);
  if (!m) { problems.push(`${key}: not in the model registry at all — ${why}`); continue; }
  const on = poses(m, 1), off = poses(m, 0);
  if (on.threw) { problems.push(`${key}: threw with motion on — ${on.threw}`); continue; }
  if (off.threw) { problems.push(`${key}: threw with motion off — ${off.threw}`); continue; }
  rows.push({ key, on: on.n, off: off.n, why });
  if (on.n < 2) problems.push(`${key}: ONE pose over a 40 s sweep with motion on — ${why}, and it is not`);
  const drifts = ALSO_DRIFTS.has(key);
  if (off.n !== 1 && !drifts) problems.push(`${key}: ${off.n} poses with RENDER_TUNE.motion 0 — that flag promises a still building, not a slower one`);
  // …and a declared exception still has to be STILLER with the slider off, or the declaration is
  // covering for a part that never parked.
  if (drifts && off.n >= on.n) problems.push(`${key}: ${off.n} poses with motion 0 against ${on.n} with it on — it is declared as "${ALSO_DRIFTS.get(key)}", but the motion layer is not parking either`);
}

// ⚠ AND THE SWEEP DELIBERATELY DOES NOT ASK THE OTHER 200 MODELS TO HOLD STILL, which a first cut
// did and which reported twenty arms as broken. `RENDER_TUNE.motion` parks the MOTION LAYER — the
// jibs, trolleys, hooks, flags and the wind wheel — and it was never a switch for every animated
// adornment in the renderer. A smoke plume drifts, a beacon blinks and an arc welder strikes on
// their own clocks; all three predate this flag and none of them is a moving PART. Widening the
// check to cover them would not have found a bug, it would have redefined the flag.
//
// The invariant those arms DO have to hold — that nothing reading the clock reaches the captured
// mass — is not this file's to assert either: `shapes:smoke` already captures every model twice and
// demands the two agree, which is the same question asked where it can be answered exactly.

// ── 3. AND THE FLAGS FOLLOW THE WIND ────────────────────────────────────────
//
// `canvasResidue` runs an arm on its own, outside a world pass, so `WIND_STATE` is null and every
// flag it draws is becalmed — which is right for the checks above and useless for this one. The
// wind only exists inside a frame, so this asks a frame.
//
// ⚠ THE SUBJECT MUST BE AHEAD OF THE CAMERA, and a first cut put the pier on the window's centre
// tile — which is where the camera itself sits, so the near clip dropped it and all three wind
// bearings came back byte-identical. A confident, reproducible, completely false green: the same
// trap `worldresidue` records for its junction, and the reason that file says the crossing has to
// be ahead rather than underfoot.
//
// ⚠ AND THE CLOCK AND THE DICE ARE BOTH PINNED. Two renders of one scene differ by themselves —
// the clouds drift and GLASS throws a meteor across a clear sky on a random timer — so without
// both, "the wind changed the picture" is a statement about the weather rather than the flags.
// The identity check at one bearing is what proves the pinning took.
{
  const el = stubCanvas('__moving', 900, 500);
  const real = el.getContext('2d');
  let ops = [];
  el.getContext = () => new Proxy(real, {
    get(o, k) { const v = o[k]; if (typeof v !== 'function') return v;
      return (...a) => { if (k === 'drawImage') ops.push(a.slice(1).map((x) => typeof x === 'number' ? x.toFixed(3) : '').join(',')); return v.apply(o, a); }; },
    set(o, k, v) { o[k] = v; return true; },
  });
  const clock = globalThis.performance; globalThis.performance = { ...clock, now: () => 1e6 };
  const rnd = Math.random; Math.random = () => 0.42;
  const RR = 8, N2 = RR * 2 + 1;
  const sea = Array.from({ length: N2 }, () => Array.from({ length: N2 }, () => ({ kind: 'land', biome: 'water', flr: 0 })));
  sea[RR - 3][RR] = { kind: 'land', biome: 'water', bt: 'pier', ent: 'south', flr: 1 };
  const field = (dir) => ({ tick: 1, bounds: { minX: 0, maxX: 200, minY: 0, maxY: 200 }, wind: { dir, kph: 34 }, baseCloud: 0.2, precipFloor: 0, floorType: 'none', cells: [] });
  const shot = (dir) => {
    const v = { cls: 'prop', phase: 'cruise', worldBlend: 1, map: sea, heading: 0, speed: 0, hour: 13, height: 0.02, weather: 'clear', wxField: field(dir), acX: 100, acY: 100 };
    ws.paintWindshield('__moving', v); ops = []; ws.paintWindshield('__moving', v); return ops.join('|');
  };
  shot(90);                       // warm every lazy cache and bake
  const w90 = shot(90), w90b = shot(90), w180 = shot(180), w270 = shot(270);
  globalThis.performance = clock; Math.random = rnd;
  if (!w90.length) problems.push('the wind scene drew no textured quads at all — the pier is not reaching the frame, so nothing below means anything');
  else if (w90 !== w90b) problems.push('the same wind twice drew two different frames — the clock or the dice are not pinned, so a difference between bearings proves nothing');
  else {
    if (w90 === w180) problems.push('the flags draw identically at 90° and 180° of wind — they are not following it');
    if (w90 === w270) problems.push('the flags draw identically at 90° and 270° of wind — they are not following it');
  }
  rows.push({ key: 'wind', on: 3, off: 1, why: 'the flags point downwind and re-point when it shifts' });
}

ws.RENDER_TUNE.motion = 1;

if (REPORT) {
  console.log('\n  poses over a 40 s sweep (motion on / off):');
  for (const r of rows.sort((a, b) => b.on - a.on)) console.log(`    ${String(r.on).padStart(3)} / ${r.off}   ${r.key.padEnd(20)} ${r.why}`);
}

if (problems.length) {
  console.error(`\n✗ moving — ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 20)) console.error('  ' + p);
  if (problems.length > 20) console.error(`  …and ${problems.length - 20} more`);
  process.exit(1);
}

const tot = rows.reduce((a, r) => a + r.on, 0);
console.log(`✓ moving: ${rows.length} arms move and every one of them parks — ${tot} distinct poses across a 40 s sweep, `
  + `down to one each with RENDER_TUNE.motion 0 (${ALSO_DRIFTS.size} declared exception: smoke, which is not a moving part).`);
