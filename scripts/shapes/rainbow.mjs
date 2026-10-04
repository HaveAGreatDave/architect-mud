// THE RAINBOW IS IN THE RAIN, AND IT IS 42° FROM WHEREVER YOU ARE.
//
// `drawWorldRainbow` builds the bow as a cone with its apex in the eye and lays each band where that
// cone passes through falling rain. No headless harness reaches a GL draw call, so what is checked
// here is the geometry the frame hands the stroke layer. Each claim is one that would stay silent in
// a screenshot if it were wrong:
//
//   1. rain opposite the sun makes a bow; the same rain on the sun's side makes none
//   2. every point of it is 42° (primary) or 51° (secondary) off the antisolar point, seen from the
//      eye, which is what makes it a trick of light rather than a thing painted on the world
//   3. move the eye toward it and claim 2 still holds from the NEW eye: it went with you
//   4. every point is inside the rain, none is under the ground, and from the air a foot stands on it
//   5. it is light: every stroke is additive
//   6. `worldBow` 0 sends nothing to the world (the sky-painted fallback takes over)
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const W = 640, H = 360;
stubCanvas('__bow', W, H);

const N = 41, R = 20, CX = 500, CY = 500;
const map = Array.from({ length: N }, () => Array.from({ length: N }, () => ({ kind: 'land', biome: 'grassland', flr: 0 })));
const field = (cells) => ({
  tick: 30, bounds: { minX: CX - 80, maxX: CX + 80, minY: CY - 80, maxY: CY + 80 },
  wind: { dir: 220, kph: 10 }, baseCloud: 0.1,
  cells: cells.map(([x, y, r]) => ({ x, y, r, vx: 0, vy: 0, type: 'precip', intensity: 0.9, precip: 'rain' })),
});

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
ws.RENDER_TUNE.geese = 0;
const was = { gl: ws.RENDER_TUNE.gl, floor: ws.RENDER_TUNE.glFloor, bow: ws.RENDER_TUNE.worldBow };
const problems = [];
const D2R = Math.PI / 180;

function collect(view) {
  let seen = null;
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1;
  ws.installGLWorld((cells, cam, o) => {
    seen = { eye: [cam.ex || 0, cam.ey || 0, cam.EH || 0],
             bow: (o.strokes || []).filter((s) => s.tag === 'rainbow').map((s) => ({ a: s.a.slice(), b: s.b.slice(), add: s.add })) };
    return null;
  });
  // ⚠ ONE PAINT PER COLLECTION. A hook that answers null is the no-WebGL2 path, which puts
  // RENDER_TUNE.gl back to 0, so a second paint would be a GLASS 1 frame with no world bow in it.
  ws.paintWindshield('__bow', view);
  ws.installGLWorld(null);
  return { ...seen, sun: ws.lastBow() };
}

const view = (seat, at, cells) => ({
  cls: seat === 'air' ? 'prop' : 'truck', phase: 'cruise', worldBlend: 1,
  height: seat === 'air' ? 0.5 : 0, eyeH: seat === 'air' ? undefined : 0.12, speed: 0.2,
  hour: 17, weather: 'clear', map, heading: 75,
  mapCenter: { x: at[0], y: at[1] }, mapOffset: { x: 0, y: 0 },
  wxField: field(cells), acX: at[0], acY: at[1],
});

// Off the eye, the angle between a point and the antisolar direction.
function offAxis(sun, eye, P) {
  const saz = Math.sin(sun.az * D2R), caz = Math.cos(sun.az * D2R);
  const cel = Math.cos(sun.el * D2R), sel = Math.sin(sun.el * D2R);
  const A = [-cel * saz, cel * caz, -sel];
  const d = [P[0] - eye[0], P[1] - eye[1], P[2] - eye[2]];
  const L = Math.hypot(...d);
  return Math.acos(Math.max(-1, Math.min(1, (d[0] * A[0] + d[1] * A[1] + d[2] * A[2]) / L))) / D2R;
}
const onCone = (deg) => (deg >= 39.5 && deg <= 44.5) || (deg >= 48 && deg <= 54);
const pts = (bow) => bow.flatMap((s) => [s.a, s.b]);

// The shower: well off to the east-north-east, where the sun at hour 17 puts the antisolar point.
const SHOWER = [[CX + 24, CY - 6, 22]];
const cab = collect(view('cab', [CX, CY], SHOWER));
if (!cab.sun) problems.push('no bow was armed at hour 17 under a lit sky');
if (!cab.bow.length) problems.push('rain opposite the sun made no bow');

// 1. The same shower on the SUN's side of the sky.
if (cab.sun) {
  const s = cab.sun, dx = Math.sin(s.az * D2R), dy = -Math.cos(s.az * D2R);
  const sunSide = collect(view('cab', [CX, CY], [[CX + dx * 24, CY + dy * 24, 22]]));
  if (sunSide.bow.length) problems.push(`a shower on the sun's side made ${sunSide.bow.length} bow strokes`);
}

// 2. The cone.
const offCab = pts(cab.bow).map((P) => offAxis(cab.sun, cab.eye, P)).filter((d) => !onCone(d));
if (offCab.length) problems.push(`${offCab.length} bow points are not 42° or 51° off the antisolar point (e.g. ${offCab[0].toFixed(2)}°)`);

// 3. Drive six tiles toward it.
const near = collect(view('cab', [CX + 6, CY - 1], SHOWER));
const offNear = pts(near.bow).map((P) => offAxis(near.sun, near.eye, P)).filter((d) => !onCone(d));
if (!near.bow.length) problems.push('driving toward the bow made it vanish rather than recede');
if (offNear.length) problems.push(`after driving toward it, ${offNear.length} points are off the cone: the bow stayed put in the world`);

// 4. In the rain, never underground, and a foot on the ground from the air.
const air = collect(view('air', [CX, CY], SHOWER));
const inRain = (at, P) => SHOWER.some(([x, y, r]) => Math.hypot(at[0] + P[0] - x, at[1] + P[1] - y) < r);
const dry = pts(air.bow).filter((P) => !inRain([CX, CY], P)).length + pts(cab.bow).filter((P) => !inRain([CX, CY], P)).length;
if (dry) problems.push(`${dry} bow points stand outside the rain`);
// ⚠ THE CONE FROM THE AIR TOO. A cab's eye sits almost on the craft origin, so a bow built from the
// wrong eye passes claim 2 from the cab and only shows up once the eye is well off the ground.
const offAir = pts(air.bow).map((P) => offAxis(air.sun, air.eye, P)).filter((d) => !onCone(d));
if (offAir.length) problems.push(`${offAir.length} bow points seen from the air are not on the cone from the eye (e.g. ${offAir[0].toFixed(2)}°)`);
const under = pts(air.bow).filter((P) => P[2] < -0.01).length;
if (under) problems.push(`${under} bow points are below the ground`);
const lowest = Math.min(...pts(air.bow).map((P) => P[2]));
if (!(lowest < 0.4)) problems.push(`from the air the bow never reaches the ground (lowest point z ${lowest.toFixed(2)})`);

// 5. Light.
const opaque = [...cab.bow, ...air.bow].filter((s) => !s.add).length;
if (opaque) problems.push(`${opaque} bow strokes are not additive`);

// 6. The switch.
ws.RENDER_TUNE.worldBow = 0;
const off = collect(view('cab', [CX, CY], SHOWER));
if (off.bow.length) problems.push(`worldBow 0 still sent ${off.bow.length} bow strokes`);

ws.RENDER_TUNE.gl = was.gl; ws.RENDER_TUNE.glFloor = was.floor; ws.RENDER_TUNE.worldBow = was.bow;
globalThis.performance = clock;

if (REPORT) {
  console.log(`sun az ${cab.sun?.az} el ${cab.sun?.el?.toFixed(1)} · cab ${cab.bow.length} strokes · after driving 6 tiles ${near.bow.length} · air ${air.bow.length}, lowest z ${lowest.toFixed(3)}`);
}
if (problems.length) {
  console.error('✗ rainbow:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`✓ rainbow: ${cab.bow.length} strokes from the cab and ${air.bow.length} from the air, all on the 42°/51° cone from the eye, all in the rain, feet on the ground; it recedes when you drive at it.`);
