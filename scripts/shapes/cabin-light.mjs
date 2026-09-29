// The world's light reaches the room you sit in: the moon brightens a cab at night, a roof dims it
// at noon, and rolled inverted the light comes up off the floor (cabinEnvLight in windshield.js).
// Measured on the interior faces the frame collects, as mean luminance, so it proves direction and
// not taste.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const W = 640, H = 360;
stubCanvas('__cl', W, H);
const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };

const N = 41;
const mkMap = (bay) => Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
  { kind: 'land', biome: 'parkland', flr: 0, surf: (x === 20 || y === 20) ? 'road' : null, ...(bay && x === 20 && y === 20 ? { mark: 'bay' } : null) })));
const TRUCK = {
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour: 13, weather: 'clear', speed: 0, map: mkMap(false), heading: 30,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 }, gearAnim: 1,
};

const problems = [];
const tuneWas = { gl: ws.RENDER_TUNE.gl, glShip: ws.RENDER_TUNE.glShip };
function faces(view) {
  let seen = null;
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glShip = 1;
  ws.installGLWorld((cells, cam, opts) => { seen = opts.ship ? opts.ship.filter((q) => q.interior) : null; return null; });
  try { ws.paintWindshield('__cl', view); } finally { ws.installGLWorld(null); }
  return seen || [];
}
const lum = (fs) => fs.length ? fs.reduce((a, q) => a + 0.3 * q.rgb[0] + 0.59 * q.rgb[1] + 0.11 * q.rgb[2], 0) / fs.length : NaN;

// Full moon is up and high at midnight; a new moon is not.
const newMoon = lum(faces({ ...TRUCK, hour: 0, moon: 0 }));
const fullMoon = lum(faces({ ...TRUCK, hour: 0, moon: 0.5 }));
if (!(fullMoon > newMoon * 1.03)) problems.push(`a full moon did not light the cab (new ${newMoon.toFixed(1)}, full ${fullMoon.toFixed(1)})`);

const open = lum(faces({ ...TRUCK }));
const shed = lum(faces({ ...TRUCK, map: mkMap(true) }));
if (!(shed < open * 0.9)) problems.push(`a roof overhead did not darken the cab at noon (open ${open.toFixed(1)}, shed ${shed.toFixed(1)})`);

// Upside down: the upper half of the room loses to the lower half compared with level. Per-face
// comparison on the same slots, split by each face's height in the level frame.
const lvl = faces({ ...TRUCK, cls: 'drake', phase: 'air', alt: 800, bank: 0, pitch: 0 });
const inv = faces({ ...TRUCK, cls: 'drake', phase: 'air', alt: 800, bank: 180, pitch: 0 });
if (!lvl.length || lvl.length !== inv.length) problems.push(`the aircraft cockpit collected ${lvl.length} and ${inv.length} faces; cannot compare`);
else {
  // Split by which way each face looks: its winding normal, turned to face into the room (toward
  // the centroid of the lot, which sits about the eye). Inverted, what looks down at the floor has to
  // gain on what looks up at the sky.
  const all = lvl.flatMap((q) => q.p), C = [0, 1, 2].map((i) => all.reduce((a, p) => a + p[i], 0) / all.length);
  const nzIn = (q) => {
    const p = q.p, e1 = [0, 1, 2].map((i) => p[1][i] - p[0][i]), e2 = [0, 1, 2].map((i) => p[2][i] - p[0][i]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const m = [0, 1, 2].map((i) => p.reduce((a, v) => a + v[i], 0) / p.length);
    const into = (C[0] - m[0]) * n[0] + (C[1] - m[1]) * n[1] + (C[2] - m[2]) * n[2];
    return (into < 0 ? -n[2] : n[2]) / (Math.hypot(n[0], n[1], n[2]) || 1);
  };
  const s = { hiL: 0, hiI: 0, loL: 0, loI: 0 };
  const lumQ = (q) => 0.3 * q.rgb[0] + 0.59 * q.rgb[1] + 0.11 * q.rgb[2];
  for (let i = 0; i < lvl.length; i++) {
    const z = nzIn(lvl[i]);
    if (z < -0.5) { s.hiL += lumQ(lvl[i]); s.hiI += lumQ(inv[i]); } else if (z > 0.5) { s.loL += lumQ(lvl[i]); s.loI += lumQ(inv[i]); }
  }
  // hi: faces looking down (the roof side); lo: faces looking up (the floor and dash tops).
  const hi = s.hiI / s.hiL, lo = s.loI / s.loL;
  if (!(hi > lo * 1.03)) problems.push(`inverted, the light did not move off the upward faces onto the downward ones (down-facing x${hi.toFixed(3)}, up-facing x${lo.toFixed(3)})`);
}

ws.RENDER_TUNE.gl = tuneWas.gl; ws.RENDER_TUNE.glShip = tuneWas.glShip;
globalThis.performance = clock;
if (problems.length) { for (const p of problems) console.log('  FAIL  ' + p); process.exit(1); }
