// The world's light reaches the room you sit in: the moon brightens a cab at night, a roof dims it
// at noon (a shed, the gate's lock road, the gate, a hangar, a bridge or arch overhead), street lamps and neon light it after dark from the side they're on, and rolled inverted the light comes up off the floor (cabinEnvLight in windshield.js).
// Measured on the interior faces the frame collects, as mean luminance, so it proves direction and
// not taste.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const W = 640, H = 360;
stubCanvas('__cl', W, H);
const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };

const N = 41;
const mkMap = (mark) => Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
  { kind: 'land', biome: 'parkland', flr: 0, surf: (x === 20 || y === 20) ? 'road' : null, ...(mark && x === 20 && y === 20 ? { mark } : null) })));
const TRUCK = {
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour: 13, weather: 'clear', speed: 0, map: mkMap(false), heading: 30,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 }, gearAnim: 1,
};

const problems = [];
// The face-colour checks are the CPU path (RENDER_TUNE.cabGPU 0). On the GPU path the faces carry
// albedo, and the same three facts are checked on the light the frame uploads, at the end.
const tuneWas = { gl: ws.RENDER_TUNE.gl, glShip: ws.RENDER_TUNE.glShip, cabGPU: ws.RENDER_TUNE.cabGPU };
ws.RENDER_TUNE.cabGPU = 0;
let lastLight = null;
function faces(view) {
  let seen = null;
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glShip = 1;
  ws.installGLWorld((cells, cam, opts) => { seen = opts.ship ? opts.ship.filter((q) => q.interior) : null; lastLight = opts.ship ? opts.ship.interiorLight : null; return null; });
  try { ws.paintWindshield('__cl', view); } finally { ws.installGLWorld(null); }
  return seen || [];
}
const light = (view) => { faces(view); return lastLight; };
const lum = (fs) => fs.length ? fs.reduce((a, q) => a + 0.3 * q.rgb[0] + 0.59 * q.rgb[1] + 0.11 * q.rgb[2], 0) / fs.length : NaN;

// Full moon is up and high at midnight; a new moon is not.
const newMoon = lum(faces({ ...TRUCK, hour: 0, moon: 0 }));
const fullMoon = lum(faces({ ...TRUCK, hour: 0, moon: 0.5 }));
if (!(fullMoon > newMoon * 1.03)) problems.push(`a full moon did not light the cab (new ${newMoon.toFixed(1)}, full ${fullMoon.toFixed(1)})`);

const open = lum(faces({ ...TRUCK }));
// A shed, the covered lock road at the South Gate, the gate's own yoke, and a seat that says so
// (the hangar bay's booth). The yoke is a band, not a roof, so it has to sit between open and shed.
const shed = lum(faces({ ...TRUCK, map: mkMap('bay') }));
const lock = lum(faces({ ...TRUCK, map: mkMap('lock') }));
const gate = lum(faces({ ...TRUCK, map: mkMap('gate') }));
const said = lum(faces({ ...TRUCK, covered: 0.9 }));
for (const [k, x] of [['shed', shed], ['lock road', lock], ['covered seat', said]]) {
  if (!(x < open * 0.9)) problems.push(`the ${k} did not darken the cab at noon (open ${open.toFixed(1)}, ${k} ${x.toFixed(1)})`);
}
if (!(gate < open * 0.97 && gate > shed)) problems.push(`the gate yoke is not a partial shade (open ${open.toFixed(1)}, gate ${gate.toFixed(1)}, shed ${shed.toFixed(1)})`);

// Under a bridge: parked beneath the The Arch arch (a named model whose mass starts above a
// truck's eye), against the same spot with no building. overheadAt answers from the captured
// segments, so this is the real model, not a stand-in.
{
  const arch = { kind: 'land', biome: 'downtown', bt: 'chrome_arch', bn: 'The Arch', flr: 3, ent: 'south' };
  const m = mkMap(null); m[20][20] = arch;
  if (!ws.overheadAt(100, 100, arch, 99.8, 100, 0.12)) problems.push('overheadAt no longer finds the The Arch arch over a truck');
  const under = lum(faces({ ...TRUCK, map: m, mapOffset: { x: -0.2, y: 0 } }));
  const clear = lum(faces({ ...TRUCK, mapOffset: { x: -0.2, y: 0 } }));
  if (!(under < clear * 0.9)) problems.push(`driving under the The Arch arch did not darken the cab (clear ${clear.toFixed(1)}, under ${under.toFixed(1)})`);
  // A stacked building is mass above every point of it, and being in it is not being under it.
  const wh = { kind: 'land', biome: 'freight', bt: 'warehouse', flr: 2, ent: 'south' };
  if (ws.overheadAt(100, 100, wh, 100, 100, 0.12)) problems.push('overheadAt called the inside of a warehouse wall a bridge');
}

// Street light: a lit shop beside the road at night reaches into the cab, on the side it's on, and
// nothing changes by day. Measured with `cabStreet` off against on, same frame otherwise.
{
  const shopAt = (sx, sy = 0) => { const m = mkMap(null); m[20 + sy][20 + sx] = { kind: 'land', biome: 'downtown', bt: 'shop', bn: 'Ohm Sweet Ohm', flr: 2, ent: sx > 0 ? 'west' : 'east' }; return m; };
  const pair = (view) => {
    ws.RENDER_TUNE.cabStreet = 0; const a = faces(view);
    ws.RENDER_TUNE.cabStreet = 1; const b = faces(view);
    return [a, b];
  };
  const night = { ...TRUCK, hour: 0, moon: 0, mapOffset: { x: 0, y: 0 } };
  // Which side of the cab a face is on, off its world position: the cab's right is (cos h, sin h)
  // and the eye is at the origin. Light coming in through the glass on one side lands on the
  // surfaces facing it, which are on the OTHER side of the room: a lamp to the right lights the
  // left door and the left of the dash.
  const sideGain = ([a, b], hdg) => {
    const c = Math.cos(hdg * Math.PI / 180), sn = Math.sin(hdg * Math.PI / 180);
    let R = 0, Lf = 0;
    for (let i = 0; i < a.length; i++) {
      const g = lum([b[i]]) - lum([a[i]]);
      const x = a[i].p.reduce((t, p) => t + p[0] * c + p[1] * sn, 0) / a[i].p.length;
      if (x > 0) R += g; else Lf += g;
    }
    return { R, L: Lf };
  };
  // The shop's one lit sign faces west, onto the road. Heading north with the shop east, it is ahead
  // and right; heading south with the shop a tile further south, it is ahead and left. Ahead both
  // times, because a light behind the camera is never drawn and so never reaches the sink.
  const right = pair({ ...night, heading: 0, map: shopAt(1) }), left = pair({ ...night, heading: 180, map: shopAt(1, 1) });
  if (!(lum(right[1]) > lum(right[0]) * 1.03)) problems.push(`a lit shop beside the road did not light the cab at night (off ${lum(right[0]).toFixed(1)}, on ${lum(right[1]).toFixed(1)})`);
  const r = sideGain(right, 0), l = sideGain(left, 180);
  if (!(r.L > r.R && l.R > l.L)) problems.push(`street light did not come in from the side the lamp is on (lamp right: R ${r.R.toFixed(0)} L ${r.L.toFixed(0)}; lamp left: R ${l.R.toFixed(0)} L ${l.L.toFixed(0)})`);
  const day = pair({ ...night, heading: 0, hour: 13, map: shopAt(1) });
  if (Math.abs(lum(day[1]) - lum(day[0])) > 0.01) problems.push(`street light changed the cab at noon (${lum(day[0]).toFixed(2)} -> ${lum(day[1]).toFixed(2)})`);
  ws.RENDER_TUNE.cabStreet = 1;
}

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

// THE GPU PATH: the same three facts, on the uniforms the cabin shader lights the room by.
ws.RENDER_TUNE.cabGPU = 1;
{
  const f3 = (x) => (x == null ? 'none' : x.toFixed(3));
  const nm = light({ ...TRUCK, hour: 0, moon: 0 }), fm = light({ ...TRUCK, hour: 0, moon: 0.5 });
  if (!nm || !fm) problems.push('the GPU path uploaded no cabin light');
  else {
    if (!(fm.amb > nm.amb * 1.03)) problems.push(`GPU: a full moon did not light the cab (amb new ${f3(nm.amb)}, full ${f3(fm.amb)})`);
    const op = light({ ...TRUCK }), sh = light({ ...TRUCK, map: mkMap('bay') }), gt = light({ ...TRUCK, map: mkMap('gate') });
    if (!(sh.amb < op.amb * 0.9)) problems.push(`GPU: a shed did not darken the cab (amb open ${f3(op.amb)}, shed ${f3(sh.amb)})`);
    if (!(gt.amb < op.amb * 0.97 && gt.amb > sh.amb)) problems.push(`GPU: the gate yoke is not a partial shade (${f3(op.amb)} / ${f3(gt.amb)} / ${f3(sh.amb)})`);
    if (!op.sunC || !op.lightMat) problems.push('GPU: no direct sun or sun shadow map in an open cab at noon');
    if (sh.sunC) problems.push('GPU: the sun reached into a shed');
    const lv = light({ ...TRUCK, cls: 'drake', phase: 'air', alt: 800, bank: 0, pitch: 0 });
    const iv = light({ ...TRUCK, cls: 'drake', phase: 'air', alt: 800, bank: 180, pitch: 0 });
    if (!(lv && iv && lv.up[2] > 0.5 && iv.up[2] < -0.5)) problems.push(`GPU: inverted, the sky did not turn under the floor (up.z level ${f3(lv && lv.up[2])}, inverted ${f3(iv && iv.up[2])})`);
  }
}
ws.RENDER_TUNE.gl = tuneWas.gl; ws.RENDER_TUNE.glShip = tuneWas.glShip; ws.RENDER_TUNE.cabGPU = tuneWas.cabGPU;
globalThis.performance = clock;
if (problems.length) { for (const p of problems) console.log('  FAIL  ' + p); process.exit(1); }
