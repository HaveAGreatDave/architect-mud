// CLOTH ON THE GPU: THE BAKE, AND THE HAND-OFF FROM THE SWEEP.
//
//   node scripts/shapes/cloth.mjs            # gate
//   node scripts/shapes/cloth.mjs --report   # the numbers behind it
//
// Two parts.
//
// The bake (client/game/js/panels/cloth3d.js) is data, and its failures are silent: a texture wider
// than one row, a frame that isn't finite, a cycle whose last frame doesn't meet its first (a hitch
// every loop), a sock that stands out in a calm or hangs in a gale, a flag that doesn't fly.
//
// The sweep (windshield.js) decides what becomes a record. No harness reaches a GL draw call, so this
// reads the records it hands the world pass, as actors.mjs does: with the cloth pass installed an
// airfield's socks and a camp's shelters become `cloth` records and leave no decal behind; the camp's
// paint and patches are there and point at the atlas; a tent after dark near the brazier is warmer
// than one on the far side; and with the pass off or the switch at 0 the frame is the decal frame it
// always was.
import { clothBake, CLOTH_KINDS, CLOTH_SHELTERS, CLOTH_BANDS, CLOTH_FRAMES } from '../../client/game/js/panels/cloth3d.js';
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const REPORT = process.argv.includes('--report');
const problems = [];
const report = (...a) => { if (REPORT) console.log(...a); };

// ── 1. The bake ─────────────────────────────────────────────────────────────────────────────────────
const F = CLOTH_FRAMES, NB = CLOTH_BANDS.length;
const bakes = {};
for (const kind of CLOTH_KINDS) {
  const bk = bakes[kind] = clothBake(kind);
  const { nv, W, H, preview, pos } = bk;
  report(`${kind}: ${nv} vertices, ${bk.nt} triangles, ${W}×${H} texels`);
  if (W > 1024 || W < nv) problems.push(`${kind}: ${nv} vertices in a ${W}-wide texture`);
  if (H !== NB * F) problems.push(`${kind}: ${H} rows, not ${NB} bands × ${F} frames`);
  if (pos.length !== W * H * 4) problems.push(`${kind}: the pose texture is not W×H×4 halves`);
  if (preview.some((x) => !Number.isFinite(x))) problems.push(`${kind}: a baked position is not finite`);
  const at = (row, v) => [preview[(row * nv + v) * 3], preview[(row * nv + v) * 3 + 1], preview[(row * nv + v) * 3 + 2]];
  for (let b = 0; b < NB; b++) {
    const step = (r0, r1) => { let m = 0; for (let v = 0; v < nv; v++) { const p = at(r0, v), q = at(r1, v); m = Math.max(m, Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])); } return m; };
    let inner = 0;
    for (let f = 0; f < F - 1; f++) inner = Math.max(inner, step(b * F + f, b * F + f + 1));
    const wrap = step(b * F + F - 1, b * F);
    if (wrap > inner * 1.6 + 1e-4) problems.push(`${kind} at wind ${CLOTH_BANDS[b]}: the loop jumps ${wrap.toFixed(4)} across the wrap against ${inner.toFixed(4)} inside it`);
  }
  // Tents stand on the ground: nothing under z 0 in any frame.
  if (CLOTH_SHELTERS.includes(kind)) {
    let lo = Infinity;
    for (let r = 0; r < H; r++) for (let v = 0; v < nv; v++) lo = Math.min(lo, at(r, v)[2]);
    if (lo < -0.02) problems.push(`${kind}: a frame reaches ${lo.toFixed(3)} under the ground`);
  }
}
// The sock hangs in a calm and flies level in a gale; its tail tells you which.
{
  const bk = bakes.sock, tail = (b) => { let z = 0; for (let v = 0; v < bk.nv; v++) z = Math.min(z, bk.preview[((b * F) * bk.nv + v) * 3 + 2]); return z; };
  const calm = tail(0), gale = tail(NB - 1);
  report(`sock: tail at ${calm.toFixed(3)} in a calm, ${gale.toFixed(3)} in a gale`);
  if (!(calm < gale - 0.05)) problems.push(`the sock's tail is at ${calm.toFixed(3)} in a calm and ${gale.toFixed(3)} in a gale; it should hang in the one and fly in the other`);
  if (gale < -0.05) problems.push(`the sock droops to ${gale.toFixed(3)} in a gale; it should stand out`);
}
// The flag flies further in a wind than it does hanging.
{
  const bk = bakes.flag, reach = (b) => { let y = 0; for (let v = 0; v < bk.nv; v++) y = Math.max(y, bk.preview[((b * F) * bk.nv + v) * 3 + 1]); return y; };
  if (!(reach(NB - 1) > reach(0) * 2)) problems.push(`the flag reaches ${reach(NB - 1).toFixed(2)} in a gale against ${reach(0).toFixed(2)} in a calm`);
}

// ── 2. The sweep ────────────────────────────────────────────────────────────────────────────────────
const ws = await loadWindshield();
const Wc = 640, Hc = 360;
stubCanvas('__cl', Wc, Hc);
const N = 41, R = 20;
const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
const was = { gl: ws.RENDER_TUNE.gl, floor: ws.RENDER_TUNE.glFloor, cloth: ws.RENDER_TUNE.glCloth };

function frame(view, cloth) {
  const c = globalThis.document.createElement('canvas');
  c.width = Wc; c.height = Hc;
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1;
  ws.installGLCloth(cloth);
  let got = null;
  ws.installGLWorld((cells, cam, o) => {
    got = {
      recs: (o.fauna || []).filter((q) => q.cloth),
      decals: (o.decals || []).map((d) => String(d.key)),
    };
    return { faces: 1, canvas: c };
  });
  ws.paintWindshield('__cl', view);
  ws.paintWindshield('__cl', view);
  ws.installGLWorld(null);
  ws.installGLCloth(false);
  return got || { recs: [], decals: [] };
}

// An airfield strip ahead of the camera, as airfield.mjs builds it.
const field = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) =>
  (x === R && y >= R - 11 && y <= R - 5) ? { kind: 'field', flr: 0 } : { kind: 'land', biome: 'city', flr: 0 }));
const fieldView = { cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour: 22, weather: 'clear', speed: 0, map: field, heading: 0, mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 },
  wind: 16, windVec: { dir: 250 } };
{
  const on = frame(fieldView, true), off = frame(fieldView, false);
  const socks = on.recs.filter((r) => r.kind === 'sock');
  const sockDecals = (fr) => fr.decals.filter((k) => k.startsWith('sock|')).length;
  report(`airfield: ${socks.length} sock records with the pass, ${sockDecals(off)} sock decals without it`);
  if (!sockDecals(off)) problems.push('the control drew no windsock decals; the scene has no windsock, so the rest means nothing');
  if (!socks.length) problems.push('no windsock became a cloth record with the cloth pass installed');
  if (sockDecals(on)) problems.push(`${sockDecals(on)} windsock decals with the cloth pass installed; the sock is drawn twice`);
  for (const r of socks) {
    if (!(r.wind > 0 && r.wind <= 1)) problems.push(`a sock's wind is ${r.wind}`);
    for (const k of ['x', 'y', 'z', 'hd', 'ph']) if (!Number.isFinite(r[k])) problems.push(`a sock record's ${k} is ${r[k]}`);
  }
  if (off.recs.length) problems.push(`${off.recs.length} cloth records with the cloth pass not installed; every other harness depends on there being none`);
  ws.RENDER_TUNE.glCloth = 0;
  const zero = frame(fieldView, true);
  if (zero.recs.length) problems.push(`${zero.recs.length} cloth records with RENDER_TUNE.glCloth at 0`);
  ws.RENDER_TUNE.glCloth = was.cloth;
}

// A camp: three Old Coldwater pitch tiles ahead of the camera, by night and by day.
const camp = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) =>
  (Math.abs(x - R) <= 1 && y === R - 3) ? { kind: 'land', biome: 'city', flr: 0, mark: 'camp' } : { kind: 'land', biome: 'city', flr: 0 }));
const campView = (hour) => ({ cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour, weather: 'clear', speed: 0, map: camp, heading: 0, mapCenter: { x: 300, y: 300 }, mapOffset: { x: 0, y: 0 }, wind: 20 });
{
  const on = frame(campView(13), true), off = frame(campView(13), false);
  const tents = on.recs.filter((r) => CLOTH_SHELTERS.includes(r.kind));
  const campDecals = (fr) => fr.decals.filter((k) => /camp\|(slope|gable|tarp|lean|patch|dome|bell|tunnel)/.test(k) || k.startsWith('cloth|')).length;
  report(`camp: ${tents.length} shelters as records (${new Set(tents.map((r) => r.kind)).size} kinds), ${campDecals(off)} canvas decals without the pass`);
  if (!campDecals(off)) problems.push('the camp control drew no shelter decals; the scene has no camp, so the rest means nothing');
  if (tents.length < 9) problems.push(`${tents.length} shelters became records over three camp tiles; every pitch should`);
  if (campDecals(on)) problems.push(`${campDecals(on)} shelter decals with the cloth pass installed; the tents are drawn twice`);
  const kinds = new Set(tents.map((r) => r.kind));
  if (kinds.size < 4) problems.push(`the camp has only ${[...kinds].join('/')}; it should have ridge tents, tarps, lean-tos and bought tents (domes, bells, tunnels)`);
  if (!['dome', 'bell', 'tunnel'].some((k) => kinds.has(k))) problems.push('no dome, bell or tunnel tent in three camp tiles');
  const colours = new Set(tents.map((r) => r.colA.map(Math.round).join()));
  if (colours.size < tents.length * 0.6) problems.push(`${colours.size} colours over ${tents.length} shelters; a camp is every drab there is`);
  for (const r of tents) {
    const lum = (0.2126 * r.colA[0] + 0.7152 * r.colA[1] + 0.0722 * r.colA[2]);
    if (lum > 170) problems.push(`a shelter is ${r.colA.map(Math.round)}; tarps here are drab, never bright`);
  }
  const painted = tents.filter((r) => r.tag);
  report(`camp: ${painted.length} of ${tents.length} shelters carry paint, ${tents.filter((r) => r.patch).length} a patch`);
  if (painted.length < tents.length * 0.3) problems.push(`${painted.length} of ${tents.length} shelters carry paint; the Pitch should have more of it than anywhere`);
  for (const r of painted) {
    if (!r.atlas || !r.atlas.canvas) problems.push('a painted shelter carries no atlas');
    else if (!(r.tag.cell >= 1 && r.tag.cell < r.atlas.cells)) problems.push(`a shelter's paint cell is ${r.tag.cell}; cell 0 is the flag's eye and the rest are the camp's`);
  }
  if (off.recs.length) problems.push(`${off.recs.length} camp cloth records with the pass not installed`);

  // After dark, the camp's own light: the warmest shelter is much warmer than the coldest, and in
  // daylight nothing is warm at all.
  const night = frame(campView(23), true).recs.filter((r) => CLOTH_SHELTERS.includes(r.kind));
  const heat = (r) => (r.warm ? r.warm[0] + r.warm[1] + r.warm[2] : 0);
  const hs = night.map(heat).sort((a, b) => a - b);
  report(`camp at night: warmth from ${hs[0]?.toFixed(3)} to ${hs[hs.length - 1]?.toFixed(3)}`);
  if (!(hs.length && hs[hs.length - 1] > hs[0] + 0.1)) problems.push('after dark every shelter is lit the same; the lamps and braziers should light the ones near them');
  if (tents.some((r) => heat(r) > 0)) problems.push('a shelter is warm in daylight');
  if (!night.every((r) => r.lum < 1)) problems.push('a shelter is not dimmed after dark');
}

// Standing in the camp: the camera's own tile is a camp. `emitDecoFill` drops a polygon with any
// corner near the eye, so before the camp clipped its own sheets at the eye plane, the shelters
// beside you vanished whole. With the pass off, the canvas shelters round the eye must still draw.
{
  const inside = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) =>
    (x === R && (y === R || y === R - 1)) ? { kind: 'land', biome: 'city', flr: 0, mark: 'camp' } : { kind: 'land', biome: 'city', flr: 0 }));
  const v = { ...campView(13), map: inside, eyeH: 0.03 };
  const off = frame(v, false);
  const n = off.decals.filter((k) => /camp\|(slope|gable|tarp|lean|dome|bell|tunnel)/.test(k)).length;
  report(`standing in a camp: ${n} shelter decals`);
  if (!n) problems.push('standing in a camp, no shelter drew at all');
  // And near to, the kit round the shelters: doors, flaps, tyres, washing, on both paths.
  const kit = (fr) => fr.decals.filter((k) => /camp\|(door|flap|tyre|laundry)/.test(k)).length;
  const on = frame(v, true);
  report(`standing in a camp: ${kit(off)} kit decals on the canvas path, ${kit(on)} with the pass`);
  if (!kit(off) || !kit(on)) problems.push(`near to, the camp drew ${kit(off)} doors, flaps, tyres or washing on the canvas path and ${kit(on)} with the pass`);
}

ws.RENDER_TUNE.gl = was.gl; ws.RENDER_TUNE.glFloor = was.floor; ws.RENDER_TUNE.glCloth = was.cloth;
globalThis.performance = clock;

if (problems.length) {
  console.error(`\n✗ cloth — ${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ cloth: ${CLOTH_KINDS.length} kinds bake and loop at ${NB} wind strengths, the sock hangs and flies, and socks and shelters reach the cloth pass with their paint and their light, and nothing else.`);
