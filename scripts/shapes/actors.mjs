// PAVEMENT PEOPLE AS MESHES: THE BAKE, THE OUTFITS AND THE HAND-OFF FROM THE SWEEP.
//
//   node scripts/shapes/actors.mjs            # gate
//   node scripts/shapes/actors.mjs --report   # the numbers behind it
//
// Three parts, because three things can go wrong without a picture showing it.
//
// The bake (client/game/js/panels/actor3d.js) is data. Its failures are a texture too wide for the
// guaranteed 2048, a clip whose last frame doesn't meet its first (a hitch once a cycle), a figure
// floating or sunk, and feet that slide because the root solve came out with the wrong sign.
//
// The outfits have to vary, stay deterministic per token, and stay inside the palette.
//
// The sweep (windshield.js) decides who is a mesh. No harness reaches a GL draw call, so this reads
// the records it hands to the world pass, the same way scripts/shapes/fauna.mjs reads the birds: near
// figures become records and far ones stay billboards, nothing on a record can name an NPC, a walker
// faces the way they're going, the gait follows distance, the hitcher faces the camera, and with the
// switch off the frame is the billboard frame it always was.
import { actorBake, actorOutfit, actorStrideM, ACTOR_OUTFITS } from '../../client/game/js/panels/actor3d.js';
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
import { readFileSync } from 'node:fs';

const REPORT = process.argv.includes('--report');
const problems = [];
const report = (...a) => { if (REPORT) console.log(...a); };

// ── 1. The bake ─────────────────────────────────────────────────────────────────────────────────────
const bk = actorBake();
const { nv, W, H, rows, frames, preview, idx, clips, top } = bk;
report(`bake: ${nv} vertices, ${bk.nt} triangles, ${W}×${H} texels (${rows} rows a frame), ${frames} frames, top ${top.toFixed(3)} m`);
if (W > 2048 || H > 2048) problems.push(`the pose texture is ${W}×${H}, past WebGL2's guaranteed 2048`);
if (W * rows < nv) problems.push(`${W}×${rows} texels a frame can't hold ${nv} vertices`);
if (nv >= 65536) problems.push(`${nv} vertices won't index with UNSIGNED_SHORT`);
if (bk.pos.length !== W * H * 4 || bk.nrm.length !== W * H * 4) problems.push('a pose texture is not W×H×4 halves');
for (const name of ['walk', 'idle', 'wave']) if (!clips[name]) problems.push(`the bake has no ${name} clip`);
if (!(top > 1.65 && top < 1.9)) problems.push(`the figure stands ${top.toFixed(3)} m tall; the sizing in windshield.js assumes about 1.75`);

const at = (F, v) => [preview[(F * nv + v) * 3], preview[(F * nv + v) * 3 + 1], preview[(F * nv + v) * 3 + 2]];
let nan = 0, worstGround = 0;
for (let F = 0; F < frames; F++) {
  let lo = Infinity;
  for (let v = 0; v < nv; v++) { const p = at(F, v); if (!p.every(Number.isFinite)) nan++; if (p[1] < lo) lo = p[1]; }
  worstGround = Math.max(worstGround, Math.abs(lo));
}
if (nan) problems.push(`${nan} baked positions are not finite`);
if (worstGround > 1e-4) problems.push(`a frame's lowest point is ${worstGround.toFixed(4)} m off the ground; a foot should always be on it`);

// Winding: the signed volume of the first idle frame is positive when the faces wind outward, which
// is what the per-frame normals are averaged from.
{
  const F = clips.idle.row0;
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = at(F, idx[t]), b = at(F, idx[t + 1]), c = at(F, idx[t + 2]);
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  report(`enclosed volume ${vol.toFixed(4)} m³`);
  if (!(vol > 0.03)) problems.push(`the mesh encloses ${vol.toFixed(4)} m³; its faces are wound inward or it has fallen apart`);
}

// Loops: the step from a clip's last frame back to its first must look like any other step in it.
for (const [name, c] of Object.entries(clips)) {
  const step = (A, Bf, dz) => { let m = 0; for (let v = 0; v < nv; v++) { const p = at(A, v), q = at(Bf, v); m = Math.max(m, Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2] + dz)); } return m; };
  let inner = 0;
  for (let f = 0; f < c.len - 1; f++) inner = Math.max(inner, step(c.row0 + f, c.row0 + f + 1, 0));
  const wrap = step(c.row0 + c.len - 1, c.row0, 0);
  report(`${name}: largest step inside the clip ${inner.toFixed(4)} m, across the wrap ${wrap.toFixed(4)} m`);
  if (wrap > inner * 1.5 + 1e-4) problems.push(`the ${name} clip jumps ${wrap.toFixed(3)} m from its last frame to its first, against ${inner.toFixed(3)} inside it`);
}

// Planted feet: move the walk forward at one stride a cycle and follow the sole vertices that are on
// the ground in two frames running. Those are the foot that's down, and they should hardly move.
// (Following "whatever is lowest" instead measures the heel handing over to the toe, not a slide.)
{
  const stride = actorStrideM(), c = clips.walk;
  if (!(stride > 0.9 && stride < 1.8)) problems.push(`the walk's stride is ${stride.toFixed(3)} m; a person's is about 1.2 to 1.5`);
  let slip = 0;
  for (let f = 0; f < c.len - 1; f++) {
    const moves = [];
    for (let v = 0; v < nv; v++) {
      const a = at(c.row0 + f, v), b = at(c.row0 + f + 1, v);
      if (a[1] < 0.006 && b[1] < 0.006) moves.push(Math.abs((b[2] + stride * (f + 1) / c.len) - (a[2] + stride * f / c.len)));
    }
    if (moves.length >= 3) { moves.sort((x, y) => x - y); slip = Math.max(slip, moves[moves.length >> 1] * c.len / c.dur); }
  }
  const pace = stride / c.dur;
  report(`walk: stride ${stride.toFixed(3)} m, pace ${pace.toFixed(2)} m/s, worst contact slip ${slip.toFixed(3)} m/s`);
  if (slip > pace * 0.15) problems.push(`a planted foot slides at ${slip.toFixed(2)} m/s against a ${pace.toFixed(2)} m/s walk; the root solve is off`);
}

// ── 2. Outfits ──────────────────────────────────────────────────────────────────────────────────────
{
  const hash = (s, k) => { let h = 0x811c9dc5 ^ k; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return (h >>> 8) / 0x1000000; };
  const tok = (i) => (Math.imul(i + 1, 2654435761) >>> 0).toString(36);   // six or seven mixed characters, like the server's
  const seen = { coat: new Set(), legs: new Set(), skin: new Set(), hair: new Set(), shoes: new Set() };
  const combos = new Set();
  for (let i = 0; i < 5000; i++) {
    const t = tok(i), o = actorOutfit((k) => hash(t, 20 + k));
    const again = actorOutfit((k) => hash(t, 20 + k));
    if (JSON.stringify(o) !== JSON.stringify(again)) { problems.push('the same token dressed two different ways'); break; }
    for (const p of Object.keys(seen)) {
      const c = o[p];
      if (!Array.isArray(c) || c.length !== 3 || c.some((x) => !(Number.isInteger(x) && x >= 0 && x <= 255))) { problems.push(`outfit part ${p} is ${JSON.stringify(c)}, not an 0..255 rgb`); break; }
      seen[p].add(c.join());
    }
    if (!(o.tone >= 0 && o.tone <= 5 && Number.isInteger(o.tone))) problems.push(`outfit tone ${o.tone} is outside the blob's six buckets`);
    if (i < 500) combos.add(o.coat.join() + '|' + o.legs.join() + '|' + o.skin.join());
  }
  for (const p of Object.keys(seen)) {
    if (seen[p].size !== ACTOR_OUTFITS[p].length) problems.push(`only ${seen[p].size} of ${ACTOR_OUTFITS[p].length} ${p} colours turned up in 5,000 figures`);
  }
  report(`outfits: ${combos.size} distinct coat/trouser/skin combinations over 500 figures`);
  if (combos.size < 200) problems.push(`500 figures wore only ${combos.size} distinct coat/trouser/skin combinations`);
}

// ── 3. The sweep ────────────────────────────────────────────────────────────────────────────────────
const ws = await loadWindshield();
const Wc = 640, Hc = 360;
stubCanvas('__ac', Wc, Hc);
const N = 41, R = 20;
// A north-south street under the camera, shopfronts either side. Forward is -y at heading 0.
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
  if (x === R) return { kind: 'land', biome: 'city', flr: 0, road: 1, rd: 'ns', pw: 1 };
  if (Math.abs(x - R) === 1) return { kind: 'land', biome: 'city', flr: 0, bt: 'shop', is_building: 1, floors: 3 };
  return { kind: 'land', biome: 'city', flr: 0 };
}));
const C = { x: 100, y: 100 };
const people = () => [
  // near: these should be meshes
  { t: 'q7k2m1a', x: 100, y: 99 }, { t: 'z1w9e4b', x: 100, y: 98.6 },
  // far: these should stay billboards
  { t: 'p3c8r2c', x: 100, y: 88 }, { t: 'm5t6y7d', x: 100, y: 86 },
];
const VIEW = {
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22, propMul: 1.75,
  hour: 13, weather: 'clear', speed: 0, map, heading: 0, mapCenter: C, mapOffset: { x: 0, y: 0 },
  actors: people(),
  roadside: { x: 100.6, y: 99, t: 'hk4x9s2' },
};

const clock = globalThis.performance;
let T = 1e6;
globalThis.performance = { ...clock, now: () => T };
const glWas = ws.RENDER_TUNE.gl, floorWas = ws.RENDER_TUNE.glFloor, meshWas = ws.RENDER_TUNE.actorMesh;

let got = null;
function frame(view) {
  const c = globalThis.document.createElement('canvas');
  c.width = Wc; c.height = Hc;
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1;
  ws.installGLWorld((cells, cam, o) => {
    got = {
      cam: { ex: cam.ex, ey: cam.ey, ox: cam.ox || 0, oy: cam.oy || 0 },
      recs: (o.fauna || []).filter((q) => q.actor),
      boards: (o.scatter || []).filter((q) => typeof q.key === 'string' && q.key.startsWith('actor|')).length,
    };
    return { faces: 1, canvas: c };
  });
  got = null;
  ws.paintWindshield('__ac', view);
  return got || { recs: [], boards: 0 };
}
// Born on the first frame, faded in by the next (FADE_MS is 900).
const settle = (view) => { frame(view); T += 1000; return frame(view); };

ws.installGLActorMesh(true);
ws.RENDER_TUNE.actorMesh = 1;
const on = settle(VIEW);
const recs = on.recs;
report(`sweep, mesh on: ${recs.length} actor records, ${on.boards} actor billboards`);
const walkers = recs.filter((r) => r.clip !== 'wave'), hitchers = recs.filter((r) => r.clip === 'wave');
if (walkers.length !== 2) problems.push(`${walkers.length} pavement figures became meshes; the two near ones should have and the two far ones should not`);
if (hitchers.length !== 1) problems.push(`${hitchers.length} hitcher meshes; the one on the verge beside the camera should be one`);
if (on.boards !== 2) problems.push(`${on.boards} figures stayed billboards; the two far ones should have`);
const ALLOWED = new Set(['actor', 'x', 'y', 'z', 's', 'hd', 'o', 'clip', 'ph', 'clip2', 'ph2', 'mix', 'lum', 'a', 'lx', 'ly']);
for (const r of recs) {
  for (const k of Object.keys(r)) if (!ALLOWED.has(k)) problems.push(`an actor record carries '${k}'; a record may carry nothing that could name somebody`);
  for (const k of ['x', 'y', 's', 'hd', 'ph', 'lum', 'a']) if (!Number.isFinite(r[k])) problems.push(`an actor record's ${k} is ${r[k]}`);
  if (!(r.ph >= 0 && r.ph < 1)) problems.push(`an actor record's phase is ${r.ph}, outside 0..1`);
  const tall = r.s * top;
  if (!(tall > 0.03 && tall < 0.2)) problems.push(`a mesh figure is ${tall.toFixed(3)} tiles tall; the billboard it replaces is about 0.07 from a cab`);
  for (const p of ['coat', 'legs', 'skin', 'hair', 'shoes']) if (!Array.isArray(r.o && r.o[p])) problems.push(`an actor record has no ${p} colour`);
}
// A one-wide straight street raises its pavement to the kerb top, and people stand on it, not in it.
const kerbZ = ws.RENDER_TUNE.kerbHeight + 0.002;
for (const r of walkers) if (Math.abs(r.z - kerbZ) > 1e-6) problems.push(`a figure on a raised pavement stands at z ${r.z}, not on the kerb top at ${kerbZ}`);
// Standing about, they face along the street: north or south.
for (const r of walkers) {
  const along = Math.abs(Math.sin(r.hd));
  if (r.clip !== 'idle') problems.push(`a figure who hasn't moved is playing '${r.clip}'`);
  if (along < 0.99) problems.push(`a figure standing on a north-south street faces ${(r.hd * 180 / Math.PI).toFixed(0)}°, not along it`);
}
// The hitcher faces the camera: the vehicle they want a lift from.
for (const r of hitchers) {
  const ex = got.cam.ex + got.cam.ox - r.x, ey = got.cam.ey + got.cam.oy - r.y;
  const off = Math.abs(Math.atan2(Math.sin(r.hd - Math.atan2(ey, ex)), Math.cos(r.hd - Math.atan2(ey, ex))));
  if (off > 0.05) problems.push(`the hitcher faces ${(off * 180 / Math.PI).toFixed(0)}° away from the camera`);
}

// Now the nearest one walks a tile north. They turn to face it, play the walk, and their gait advances
// by the ground they cover.
const moved = people();
moved[0] = { ...moved[0], y: 98.2 };
const view2 = { ...VIEW, actors: moved };
let last = null, prev = null;
for (let i = 0; i < 12; i++) { T += 200; prev = last; last = frame(view2); }
const nearest = (f) => f.recs.filter((r) => r.clip !== 'wave').sort((a, b) => b.y - a.y)[0];
const w1 = prev && nearest(prev), w2 = last && nearest(last);
if (!w1 || !w2) problems.push('the walker stopped being drawn as a mesh');
else {
  const north = -Math.PI / 2;
  const turn = Math.abs(Math.atan2(Math.sin(w2.hd - north), Math.cos(w2.hd - north)));
  report(`walker: clip ${w2.clip}, heading off north by ${(turn * 180 / Math.PI).toFixed(1)}°`);
  if (w2.clip !== 'walk') problems.push(`a figure walking north is playing '${w2.clip}'`);
  if (turn > 0.05) problems.push(`a figure walking north faces ${(turn * 180 / Math.PI).toFixed(0)}° off it`);
  const d = Math.hypot(w2.x - w1.x, w2.y - w1.y);
  let dph = w2.ph - w1.ph; if (dph < 0) dph += 1;
  const covered = dph * actorStrideM() * w2.s;
  report(`walker: moved ${d.toFixed(4)} tiles, gait advanced ${covered.toFixed(4)} tiles of stride`);
  if (!(d > 0)) problems.push('the walker did not move between frames');
  else if (Math.abs(covered - d) > d * 0.1) problems.push(`the gait covered ${covered.toFixed(4)} tiles while the figure moved ${d.toFixed(4)}; the feet will slide`);
}

// ── 4. Every seat ───────────────────────────────────────────────────────────────────────────────────
// The mesh only reaches a view that hands the renderer its `actors`. The cab did and nothing else
// asked, so the cockpit, free look and the boat each need their own camera shape to give meshes.
// A 720p canvas: at 360 a cockpit's figure a tile off is just under actorMeshPx.
stubCanvas('__acs', 1280, 720);
const SEATS = {
  cockpit: { cls: 'cessna', phase: 'cruise', height: 0, pitch: 0, bank: 0, speed: 0 },
  freelook: { external: true, hideOwnShip: true, phase: 'cruise', height: 0, speed: 0, freeCam: { x: 0, y: 0.3, z: 0.08, yaw: 0, pitch: -0.05 } },
  boat: { cls: 'hydro', phase: 'cruise', height: 0, metreTiles: 0.02, eyeH: 0.05 },
};
for (const [seat, cam] of Object.entries(SEATS)) {
  let seen = null;
  const c = globalThis.document.createElement('canvas');
  c.width = 1280; c.height = 720;
  ws.installGLWorld((cells, _cam, o) => { seen = (o.fauna || []).filter((q) => q.actor).length; return { faces: 1, canvas: c }; });
  const v = () => ({ hour: 13, weather: 'clear', map, mapCenter: C, mapOffset: { x: 0, y: 0 }, heading: 0, worldBlend: 1, ...cam, actors: people().slice(0, 2) });
  ws.paintWindshield('__acs', v()); T += 1000; ws.paintWindshield('__acs', v()); T += 1000;
  report(`${seat}: ${seen} actor records`);
  if (!seen) problems.push(`the ${seat} camera turned no near figure into a mesh`);
}
// And each seat passes the list on. A view that drops `actors` draws an empty street with nothing said.
for (const f of ['cab-view.js', 'cockpit.js', 'freelook-view.js', 'boat-view.js']) {
  if (!/\bactors:\s*(st|F)\.actors\b/.test(readFileSync(new URL(`../../client/game/js/panels/${f}`, import.meta.url), 'utf8'))) problems.push(`${f} never hands the renderer its street actors`);
}

// Off: the frame is the billboard frame it always was.
ws.RENDER_TUNE.actorMesh = 0;
const off = frame(VIEW);
if (off.recs.length) problems.push(`${off.recs.length} actor records with RENDER_TUNE.actorMesh at 0`);
ws.RENDER_TUNE.actorMesh = 1;
ws.installGLActorMesh(false);
const unplugged = frame(VIEW);
if (unplugged.recs.length) problems.push(`${unplugged.recs.length} actor records with the mesh pass not installed; every other harness depends on there being none`);
if (unplugged.boards !== 5) problems.push(`${unplugged.boards} actor billboards with the mesh pass not installed; all four pavement figures and the hitcher should be billboards`);

ws.installGLWorld(null);
ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = floorWas; ws.RENDER_TUNE.actorMesh = meshWas;
globalThis.performance = clock;

if (problems.length) {
  console.error(`\n✗ actors — ${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ actors: ${nv}-vertex figure, ${frames} baked frames that loop and keep a foot down, varied outfits, and the sweep hands near figures to the mesh pass and nothing else.`);
