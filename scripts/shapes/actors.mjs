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
// figures become close-up records, far ones far-body records (and billboards with that switched off),
// nothing on a record can name an NPC, a walker
// faces the way they're going, the gait follows distance, the hitcher faces the camera, and with the
// switch off the frame is the billboard frame it always was.
//
// The fifth part is street life (glass/street-life.js): what people do while they stand. Nobody
// leaves the pavement band, two on one stretch of kerb face each other and take turns to talk,
// somebody on their own does more than one thing, a stroll moves the feet as far as the figure, and
// on a road three tiles wide everybody stands on its outer pavement rather than in a lane.
import { actorBake, actorOutfit, actorStrideM, ACTOR_OUTFITS, ACTOR_MATERIALS, ACTOR_MATERIAL } from '../../client/game/js/panels/actor3d.js';
import { LIFE } from '../../client/game/js/panels/glass/street-life.js';
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
import { readFileSync } from 'node:fs';

const REPORT = process.argv.includes('--report');
const problems = [];
const report = (...a) => { if (REPORT) console.log(...a); };

// ── 1. The bake ─────────────────────────────────────────────────────────────────────────────────────
// Both bodies get the same checks: the close-up one, and the far one (bk.far) for somebody a few
// pixels tall, which has its own vertex budget and has to stand the same height.
const bk = actorBake();
const { nv, frames, top } = bk;
checkBake(bk, 'bake', 2000, 4000);
if (!bk.far) problems.push('the bake has no far body');
else {
  checkBake(bk.far, 'far bake', 250, 500);
  if (Math.abs(bk.far.top - top) > 0.03) problems.push(`the far body stands ${bk.far.top.toFixed(3)} m against the near body's ${top.toFixed(3)}; the swap would pop`);
}
function checkBake(bk, label, minV, maxV) {
const { nv, W, H, rows, frames, preview, idx, clips, top } = bk;
if (!(nv >= minV && nv <= maxV)) problems.push(`the ${label} has ${nv} vertices; expected ${minV}–${maxV}`);
report(`${label}: ${nv} vertices, ${bk.nt} triangles, ${W}×${H} texels (${rows} rows a frame), ${frames} frames, top ${top.toFixed(3)} m`);
if (W > 2048 || H > 2048) problems.push(`the pose texture is ${W}×${H}, past WebGL2's guaranteed 2048`);
if (W * rows < nv) problems.push(`${W}×${rows} texels a frame can't hold ${nv} vertices`);
if (nv >= 65536) problems.push(`${nv} vertices won't index with UNSIGNED_SHORT`);
if (bk.pos.length !== W * H * 4 || bk.nrm.length !== W * H * 4) problems.push('a pose texture is not W×H×4 halves');
// walk, idle and wave for the pass itself; the rest are what glass/street-life.js stands people in.
for (const name of ['walk', 'idle', 'wave', 'talk', 'listen', 'wait', 'phone', 'smoke']) if (!clips[name]) problems.push(`the bake has no ${name} clip`);
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
  if (slip > pace * 0.15) problems.push(`${label}: a planted foot slides at ${slip.toFixed(2)} m/s against a ${pace.toFixed(2)} m/s walk; the root solve is off`);
}
}

// ── 2. Outfits ──────────────────────────────────────────────────────────────────────────────────────
{
  const hash = (s, k) => { let h = 0x811c9dc5 ^ k; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return (h >>> 8) / 0x1000000; };
  const tok = (i) => (Math.imul(i + 1, 2654435761) >>> 0).toString(36);   // six or seven mixed characters, like the server's
  const seen = { coat: new Set(), legs: new Set(), skin: new Set(), hair: new Set(), shoes: new Set() };
  const MAT_PARTS = ['coat', 'legs', 'shoes'];
  const matSeen = { coat: new Set(), legs: new Set(), shoes: new Set() };
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
    // Materials: gl/actors.js packs each code into three bits, so anything outside its part's list
    // (or past 7) would light a garment as something else.
    if (!Array.isArray(o.mat) || o.mat.length !== 3) { problems.push(`outfit materials are ${JSON.stringify(o.mat)}, not [coat, trousers, shoes]`); break; }
    MAT_PARTS.forEach((p, k) => {
      if (!ACTOR_MATERIALS[p].some(([c]) => c === o.mat[k])) problems.push(`a ${p} is material ${o.mat[k]}, which isn't in ACTOR_MATERIALS.${p}`);
      matSeen[p].add(o.mat[k]);
    });
  }
  for (const p of Object.keys(seen)) {
    if (seen[p].size !== ACTOR_OUTFITS[p].length) problems.push(`only ${seen[p].size} of ${ACTOR_OUTFITS[p].length} ${p} colours turned up in 5,000 figures`);
  }
  for (const p of MAT_PARTS) {
    if (matSeen[p].size !== ACTOR_MATERIALS[p].length) problems.push(`only ${matSeen[p].size} of ${ACTOR_MATERIALS[p].length} ${p} materials turned up in 5,000 figures`);
  }
  if (Object.values(ACTOR_MATERIAL).some((c) => !(Number.isInteger(c) && c >= 0 && c <= 7))) problems.push('an ACTOR_MATERIAL code won\'t fit the three bits gl/actors.js packs it into');
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
const glWas = ws.RENDER_TUNE.gl, floorWas = ws.RENDER_TUNE.glFloor, meshWas = ws.RENDER_TUNE.actorMesh, farWas = ws.RENDER_TUNE.actorFarPx;
// Parts 3 and 4 are the pass as it shipped: everybody standing still at their kerb spot. Part 5 turns
// street life back on.
const lifeWas = ws.RENDER_TUNE.actorLife;
ws.RENDER_TUNE.actorLife = 0;

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
// With the far body off, the two far figures stay billboards, as shipped before it.
ws.RENDER_TUNE.actorFarPx = 0;
const on = settle(VIEW);
report(`sweep, far body off: ${on.recs.length} actor records, ${on.boards} actor billboards`);
if (on.recs.some((r) => r.lod)) problems.push('a far-body record with RENDER_TUNE.actorFarPx at 0');
if (on.boards !== 2) problems.push(`${on.boards} figures stayed billboards with the far body off; the two far ones should have`);
// With it on, those two become far-body records, and nobody is a billboard. At 640×360 and dpr 1 a
// figure twelve tiles off is about a pixel tall, under the shipped 1.5, so the cut-off is set here.
ws.RENDER_TUNE.actorFarPx = 0.5;
const onFar = frame(VIEW);
const recs = onFar.recs;
report(`sweep, far body on: ${recs.length} actor records (${recs.filter((r) => r.lod).length} far), ${onFar.boards} actor billboards`);
const walkers = recs.filter((r) => r.clip !== 'wave' && !r.lod), hitchers = recs.filter((r) => r.clip === 'wave');
const farRecs = recs.filter((r) => r.lod === 1);
if (walkers.length !== 2) problems.push(`${walkers.length} pavement figures became close-up meshes; the two near ones should have and the two far ones should not`);
if (farRecs.length !== 2) problems.push(`${farRecs.length} pavement figures became far-body meshes; the two far ones should have`);
if (hitchers.length !== 1) problems.push(`${hitchers.length} hitcher meshes; the one on the verge beside the camera should be one`);
if (onFar.boards !== 0) problems.push(`${onFar.boards} figures stayed billboards with the far body on; none should have`);
// Tiny: with the cut-off above everybody's size, nobody far is a mesh and the billboard is back.
ws.RENDER_TUNE.actorFarPx = 7.99;
const tiny = frame(VIEW);
if (tiny.recs.some((r) => r.lod)) problems.push('a far-body record for somebody under RENDER_TUNE.actorFarPx');
ws.RENDER_TUNE.actorFarPx = farWas;
const ALLOWED = new Set(['actor', 'lod', 'x', 'y', 'z', 's', 'hd', 'o', 'clip', 'ph', 'clip2', 'ph2', 'mix', 'lum', 'a', 'lx', 'ly']);
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
const nearest = (f) => f.recs.filter((r) => r.clip !== 'wave' && !r.lod).sort((a, b) => b.y - a.y)[0];
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

// ── 5. Street life ──────────────────────────────────────────────────────────────────────────────────
// What people standing on the pavement do. A record carries nothing that names anybody, so each
// figure is followed from frame to frame by nearest position: people in a ring stand 0.06 tiles
// apart at the closest and nobody moves more than about 0.025 in a 250 ms frame (a leg is a tile in
// 15 s, plus letting go of up to half a tile of standing offset), so the nearest match is the same
// person, and anything over 0.03 is a jump.
ws.RENDER_TUNE.actorLife = 1;
ws.RENDER_TUNE.actorFarPx = 0.5;   // everybody in view is a record, so everybody can be read
{
  const G = ws._lifeGeo, stride = actorStrideM();
  const hash = (s, k) => { let h = 0x811c9dc5 ^ k; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return (h >>> 8) / 0x1000000; };
  const tok = (i) => (Math.imul(i + 1, 2654435761) >>> 0).toString(36);
  const pick = (want, from) => { for (let i = from; ; i++) if (want(tok(i))) return tok(i); };
  const angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const social = (t) => hash(t, 60) < LIFE.social;
  // Clear the street: whoever the parts above left standing fades and is forgotten.
  const clear = (view) => { frame({ ...view, actors: [] }); T += 60000; frame({ ...view, actors: [] }); T += 1000; };
  // Run a scene for `secs`, a frame every 250 ms, and follow everybody in it.
  const run = (view, secs) => {
    const tracks = new Map();
    let prev = [], next = 0;
    for (let s = 0; s < secs * 4; s++) {
      T += 250;
      const recs = frame(view).recs.filter((r) => r.clip !== 'wave'), cur = new Array(recs.length);
      const pairs = [];
      prev.forEach((p, i) => recs.forEach((r, j) => pairs.push([Math.hypot(p.r.x - r.x, p.r.y - r.y), i, j])));
      pairs.sort((a, b) => a[0] - b[0]);
      const ui = new Set(), uj = new Set();
      for (const [d, i, j] of pairs) { if (d > 0.08 || ui.has(i) || uj.has(j)) continue; ui.add(i); uj.add(j); cur[j] = { id: prev[i].id, r: recs[j] }; }
      recs.forEach((r, j) => { if (!cur[j]) cur[j] = { id: next++, r }; });
      for (const c of cur) { if (!tracks.has(c.id)) tracks.set(c.id, []); tracks.get(c.id).push({ s, ...c.r }); }
      prev = cur;
    }
    return [...tracks.values()];
  };
  // A track's own checks: on the band the whole time, no jumps, and a figure on the move faces
  // the way it's going (once it has had a second to turn) with feet that cover the ground it does.
  const checkTrack = (tr, label, onBand) => {
    for (let i = 0; i < tr.length; i++) {
      const r = tr[i];
      if (!onBand(r)) { problems.push(`${label}: a figure stood off the pavement, at ${r.x.toFixed(3)}, ${r.y.toFixed(3)}`); return; }
      if (!i) continue;
      const q = tr[i - 1], d = Math.hypot(r.x - q.x, r.y - q.y);
      if (d > 0.03) { problems.push(`${label}: a figure jumped ${d.toFixed(3)} tiles in one frame`); return; }
      if (r.clip === 'walk' && q.clip === 'walk' && d > 0.004 && i >= 5 && tr.slice(i - 5, i).every((u) => u.clip === 'walk')) {
        const off = Math.abs(angle(r.hd - Math.atan2(r.y - q.y, r.x - q.x)));
        if (off > 0.1) { problems.push(`${label}: a figure walking faces ${(off * 180 / Math.PI).toFixed(0)}° off the way it's going`); return; }
        let dph = r.ph - q.ph; if (dph < 0) dph += 1;
        const covered = dph * stride * r.s;
        if (Math.abs(covered - d) > d * 0.1 + 1e-4) { problems.push(`${label}: the gait covered ${covered.toFixed(4)} tiles while the figure moved ${d.toFixed(4)}; the feet slide`); return; }
      }
    }
  };
  const band = (lat) => Math.abs(lat) >= G.VERGE - G.WALK_HW - 1e-6 && Math.abs(lat) <= G.VERGE + G.WALK_HW + 1e-6;

  // A one-tile street: two who'll stand together on the west kerb of 97, and three on their own.
  // The two have kerb spots at opposite ends of the tile (hash 2 is the old vergeOffset's along), so
  // whichever of them leaves later has a spot a good way from the ring, and a walk that forgot where
  // they were standing would jump.
  const p1 = pick((t) => social(t) && hash(t, 1) < 0.5 && hash(t, 2) < 0.1, 9000);
  const p2 = pick((t) => social(t) && hash(t, 1) < 0.5 && hash(t, 2) > 0.9, 9000);
  const lone = [9100, 9200, 9300].map((i) => pick(() => true, i));
  const cast = [{ t: p1, x: 100, y: 97 }, { t: p2, x: 100, y: 97 }, ...lone.map((t, i) => ({ t, x: 100, y: 95 - 2 * i }))];
  const SV = { ...VIEW, roadside: null, actors: cast };
  clear(SV);
  frame(SV);   // born, at zero alpha
  const tracks = run(SV, 60);
  const tile = (tr) => Math.round(tr[0].y + C.y);
  const pair = tracks.filter((tr) => tile(tr) === 97 && tr.length > 200), alone = tracks.filter((tr) => tile(tr) !== 97 && tr.length > 200);
  report(`street life: ${tracks.length} tracks, ${pair.length} in the pair, ${alone.length} alone`);
  if (pair.length !== 2 || alone.length !== 3) problems.push(`street life: followed ${pair.length} in the pair and ${alone.length} on their own, not 2 and 3`);
  for (const tr of tracks) checkTrack(tr, 'street life', (r) => band(r.x) && Math.abs(r.y + C.y - tile(tr)) <= 0.5);
  if (pair.length === 2) {
    // Facing each other, a metre apart, every frame; one talking and the other listening, by turns.
    let faced = 0, talks = [0, 0];
    const n = Math.min(pair[0].length, pair[1].length);
    for (let i = 0; i < n; i++) {
      const a = pair[0][i], b = pair[1][i], d = Math.hypot(a.x - b.x, a.y - b.y);
      const faces = (u, v) => Math.abs(angle(u.hd - Math.atan2(v.y - u.y, v.x - u.x))) < 0.15;
      if (Math.abs(d - 2 * LIFE.pairR) < 0.004 && faces(a, b) && faces(b, a)) faced++;
      if (a.clip === 'talk') talks[0]++;
      if (b.clip === 'talk') talks[1]++;
      if (a.clip === 'talk' && b.clip === 'talk') { problems.push('street life: both of a pair are talking at once'); break; }
    }
    report(`street life: the pair faced each other ${faced} of ${n} frames; talked ${talks[0]} and ${talks[1]} frames`);
    if (faced < n * 0.95) problems.push(`street life: the pair faced each other a metre apart in only ${faced} of ${n} frames`);
    if (!talks[0] || !talks[1]) problems.push(`street life: in a minute only one of the pair ever talked (${talks.join(' and ')} frames)`);
  }
  // On their own, everybody does more than one thing in a minute, and somebody strolls.
  let strolled = 0;
  for (const tr of alone) {
    const clips = new Set(tr.map((r) => r.clip));
    let moved = 0;
    for (const r of tr) moved = Math.max(moved, Math.hypot(r.x - tr[0].x, r.y - tr[0].y));
    if (clips.has('walk')) strolled++;
    report(`street life: alone on ${tile(tr)}: ${[...clips].join(', ')}; furthest ${moved.toFixed(3)} tiles from where they started`);
    if (clips.size < 2 && moved < 0.03) problems.push(`street life: somebody on their own on ${tile(tr)} stood doing one thing for a minute`);
  }
  if (!strolled) problems.push('street life: nobody on their own strolled in a minute');

  // One of the pair sets off for the next tile: whichever has the kerb spot further from the ring.
  // The walk starts from their spot in the ring, with no jump, and stays on the kerb all the way.
  const ringY = pair.length === 2 ? (pair[0][pair[0].length - 1].y + pair[1][pair[1].length - 1].y) / 2 : 0;
  const kerbY = (t) => 97 - C.y + (hash(t, 2) - 0.5) * 0.5;
  const leaver = Math.abs(kerbY(p1) - ringY) > Math.abs(kerbY(p2) - ringY) ? p1 : p2;
  report(`street life: the leaver's kerb spot is ${Math.abs(kerbY(leaver) - ringY).toFixed(3)} tiles from the ring`);
  const moved2 =cast.map((a) => (a.t === leaver ? { ...a, y: 96 } : a));
  const legs = run({ ...SV, actors: moved2 }, 20);
  const walker = legs.find((tr) => tr.length > 70 && Math.round(tr[tr.length - 1].y + C.y) === 96);
  if (!walker) problems.push('street life: lost the figure who walked off from the pair');
  else {
    checkTrack(walker, 'street life, leaving the ring', (r) => band(r.x));
    const first = walker[0], last = pair.length ? [pair[0], pair[1]].map((tr) => tr[tr.length - 1]) : [];
    const gap = Math.min(...last.map((r) => Math.hypot(r.x - first.x, r.y - first.y)));
    report(`street life: the walker set off ${gap.toFixed(4)} tiles from where they stood in the ring`);
    if (!(gap < 0.03)) problems.push(`street life: the walker started their leg ${gap.toFixed(3)} tiles from their spot in the ring`);
  }

  // A road three tiles wide has pavement only along its outer edges. Somebody on an edge tile who
  // would have taken its inner side, and two on the middle tile, all stand on the outer pavement.
  const wide = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
    if (Math.abs(x - R) <= 1) return { kind: 'land', biome: 'city', flr: 0, road: 1, rd: 'ns', pw: 1 };
    if (Math.abs(x - R) === 2) return { kind: 'land', biome: 'city', flr: 0, bt: 'shop', is_building: 1, floors: 3 };
    return { kind: 'land', biome: 'city', flr: 0 };
  }));
  const pw = 1.5 - (0.5 - G.VERGE);
  const wcast = [
    { t: pick((t) => hash(t, 1) >= 0.5, 9400), x: 99, y: 96 },   // west edge tile, east side: in the lane, as shipped
    { t: pick((t) => hash(t, 1) < 0.5, 9500), x: 101, y: 94 },   // east edge tile, west side
    { t: pick(() => true, 9600), x: 100, y: 95 }, { t: pick(() => true, 9700), x: 100, y: 93 },
  ];
  const WV = { ...VIEW, map: wide, roadside: null, actors: wcast };
  clear(WV);
  frame(WV);
  const wtracks = run(WV, 30);
  report(`street life, wide road: ${wtracks.length} tracks`);
  if (wtracks.filter((tr) => tr.length > 100).length !== 4) problems.push(`street life, wide road: followed ${wtracks.length} figures, not 4`);
  for (const tr of wtracks) {
    // An edge tile's people stand on its own outer pavement, inside the tile; a middle tile's on
    // either one, the width of the road away.
    const who = wcast.find((a) => a.y === Math.round(tr[0].y + C.y)), reach = who && who.x === 100 ? pw + G.WALK_HW : 0.5;
    checkTrack(tr, 'street life, wide road', (r) => Math.abs(Math.abs(r.x) - pw) <= G.WALK_HW + 1e-6 && !!who && Math.abs(r.x + C.x - who.x) <= reach + 1e-6);
  }
  clear(VIEW); settle(VIEW);
  ws.RENDER_TUNE.actorFarPx = farWas;
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
ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = floorWas; ws.RENDER_TUNE.actorMesh = meshWas; ws.RENDER_TUNE.actorFarPx = farWas; ws.RENDER_TUNE.actorLife = lifeWas;
globalThis.performance = clock;

if (problems.length) {
  console.error(`\n✗ actors — ${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ actors: ${nv}-vertex figure and a ${bk.far.nv}-vertex far one, ${frames} baked frames that loop and keep a foot down, varied outfits, and the sweep hands near figures to the mesh pass and nothing else, and people standing about stay on the pavement.`);
