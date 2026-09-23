// A MURMURATION IS THE GPU'S OR NOBODY'S — the route windshield.js takes for a starling cloud.
//
// Since 2026-09-23 a murmuration is simulated on the GPU (gl/murmur-gpu.js) and drawn straight out of
// its textures (gl/fauna.js), and there is no CPU flock at all. windshield.js hands the GPU ONE record
// per flock in place of its birds, and every way that goes wrong is silent: a field missing from the
// record is a NaN uniform, which draws nothing and throws nothing; a route that forgets to skip the
// per-bird loop draws every bird twice and pays the CPU for it anyway; a flock over the GPU's bird
// budget that is drawn anyway is a frame nobody budgeted for.
//
// No harness here reaches a GL draw call, so this checks what windshield.js HANDS the GL pass, on each
// of murmurRoute's two answers:
//   gpu   the real pass installed: one cloud record per flock, every number finite, not one of the
//         flock's birds as a record or a face, and a flock over RENDER_TUNE.murmurBirds not drawn
//   none  GLASS 1, and a harness's stub hook: no cloud and no airborne starling, since there is no
//         CPU flock to draw
// and, once the flock is down and off any ledge, that it is still the GPU flock with every bird in it
// (a landed flock with no GPU is still drawn bird by bird, which a harness checks).
// Each negative is paired with the gpu run of the same scene, which shows the flock was in view, so no
// check passes on an empty sky.
// Mutation-tested: the per-bird loop running for a GPU cloud, a field dropped from the record, GLASS 1
// no longer skipped, a harness hook sent down the GPU route, and the bird budget ignored.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const B = await import('../../client/shared/birds.js');

const fail = [];
const clock = globalThis.performance;
let T = 1e6;
globalThis.performance = { ...clock, now: () => T };
const realDateNow = Date.now;
Date.now = () => T;
const was = { ...ws.RENDER_TUNE };

// A starling flock over city ground, at the moment its cloud is widest, seen from a cab behind it.
const RR = 30, NN = RR * 2 + 1;
const habitat = (wx, wy) => B.speciesAt('citycore', wx, wy) || false;
let A = null;
for (const f of B.flocksNear(900, 900, RR, 1, habitat)) if (f.sp === 'songbird' && (!A || B.flockSize(f) > B.flockSize(A))) A = f;
if (!A) { console.error('✗ murmurgpu — no songbird flock near the seed tile'); process.exit(1); }
let T0 = 0, bestR = -1;
for (let i = 0; i < 40000; i++) { const t = 1e6 + i * 250, st = B.flockState(A, t); if (st.airborne && st.r > bestR) { bestR = st.r; T0 = t; } }
const c0 = B.flockState(A, T0);
const map = Array.from({ length: NN }, () => Array.from({ length: NN }, () => ({ kind: 'land', biome: 'citycore', flr: 0 })));
const view = { cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1,
  hour: 12, weather: 'clear', speed: 0, resFloor: 1, map, heading: 0,
  mapCenter: { x: Math.round(c0.cx), y: Math.round(c0.cy + 4) }, mapOffset: { x: 0.31, y: -0.17 } };

let seq = 0;
function paint({ gl = 1, inst = false, tune = {}, at = T0 }) {
  Object.assign(ws.RENDER_TUNE, was, { gl, glFloor: 1, geese: 1 }, tune);
  ws.installGLFaunaInstancing(inst);
  const id = '__mg' + (++seq);
  stubCanvas(id, 640, 360);
  let fauna = null, called = 0;
  ws.installGLWorld((cells, cam, o) => { called++; fauna = o.fauna || []; return { faces: 1, canvas: globalThis.document.createElement('canvas') }; });
  for (let k = 0; k < 3; k++) { T = at + k * 16.7; ws.paintWindshield(id, view); }
  ws.installGLWorld(null);
  ws.installGLFaunaInstancing(false);
  const list = fauna || [];
  return {
    called,
    clouds: list.filter((q) => q.cloud),
    // AIRBORNE starlings only: a flock on the ground or on a ledge is not a murmuration and is drawn per
    // bird on every route, which is right.
    songbirdRecords: list.filter((q) => (q.inst && q.sp === 'songbird' && q.state === 'air') || (q.bird && q.bird.sp === 'songbird' && q.bird.state === 'air')).length,
    groundStarlings: list.filter((q) => (q.inst && q.sp === 'songbird' && q.state !== 'air') || (q.bird && q.bird.sp === 'songbird' && q.bird.state !== 'air')).length,
  };
}

// ── gpu ──
const NUM = ['n', 'cx', 'cy', 'cz', 'heading', 'now', 'spread', 'show', 'showFade', 'ax', 'ay', 'fwdOff',
  'nearF', 'farF', 'alphaMul', 'FL', 'span', 'dpr', 'beatBase', 'pitch', 'flare', 'gear', 'waveW', 'flash', 'scale'];
const ARR = { origin: 2, camO: 2, sc: 2, minPx: 2, bank: 2, flashK: 3, ink: 2, dot: 3, eye: 3, glide: 2 };
const TIERS = ['thr', 'glyphPx', 'glyphHi', 'coarseHi', 'farHi'];
const gpu = paint({ inst: true });
{
  if (!gpu.called) fail.push('gpu: the GL hook was never called — the scene is not drawing through the GL pass at all');
  if (!gpu.clouds.length) fail.push('gpu: no cloud record reached the GL pass — the murmuration is not being handed to the GPU');
  for (const q of gpu.clouds) {
    const bad = [];
    for (const k of NUM) if (!Number.isFinite(q[k])) bad.push(k);
    for (const [k, len] of Object.entries(ARR)) if (!Array.isArray(q[k]) || q[k].length !== len || !q[k].every(Number.isFinite)) bad.push(k);
    for (const k of TIERS) if (!q.tiers || !Number.isFinite(q.tiers[k])) bad.push('tiers.' + k);
    if (typeof q.key !== 'string' || !q.key) bad.push('key');
    if (typeof q.beatOff !== 'function' || !(q.beatOff(3) >= 0 && q.beatOff(3) < 1)) bad.push('beatOff');
    if (!(q.n > 0)) bad.push('n>0');
    if (bad.length) fail.push(`gpu: a cloud record carries bad or missing fields (${bad.join(', ')}) — each is a NaN uniform that draws nothing`);
  }
  if (gpu.songbirdRecords) fail.push(`gpu: ${gpu.songbirdRecords} starlings also went through as per-bird records — the per-bird loop ran for a GPU cloud`);
}
const inView = gpu.clouds.length > 0;

// ── the bird budget: a cloud that does not fit is not drawn, and one that does is ──
if (inView) {
  const n = gpu.clouds[0].n;
  const over = paint({ inst: true, tune: { murmurBirds: n - 1 } });
  const fits = paint({ inst: true, tune: { murmurBirds: n } });
  if (over.clouds.some((q) => q.key === gpu.clouds[0].key)) fail.push(`budget: a ${n}-bird cloud was handed to the GPU under a budget of ${n - 1} birds — murmurBirds is not being charged`);
  if (!fits.clouds.some((q) => q.key === gpu.clouds[0].key)) fail.push(`budget: a ${n}-bird cloud was refused under a budget of exactly ${n} birds — the budget is refusing what it should admit`);
  if (over.songbirdRecords) fail.push('budget: a cloud refused by the GPU budget was drawn per bird instead — there is no CPU flock to fall back to');
}

// ── on the ground: the same GPU flock, walking, and still every bird ──
// A moment in the ground phase, past the landing window, when this flock is on its patch. The scene
// has no buildings, so there is no ledge and the flock must stay the GPU's.
{
  let T1 = 0;
  for (let i = 0; i < 40000 && !T1; i++) {
    const t = T0 + i * 250, st = B.flockState(A, t);
    if (!st.airborne && st.u > 0.2 * B.SPECIES.songbird.uGround && st.u < 0.8 * B.SPECIES.songbird.uGround) T1 = t;
  }
  if (!T1) fail.push('ground: no moment found when the flock is down — the ground checks cannot run');
  else {
    const g = paint({ inst: true, at: T1 });
    const G = g.clouds.find((q) => q.key === 'songbird:' + A.ax + ',' + A.ay);
    if (!G) fail.push('ground: the landed flock reached the GL pass as no cloud record — it was handed back to the per-bird path, which draws it thinned to the face budget');
    else {
      const gr = G.ground, bad = [];
      if (!gr) bad.push('ground');
      else {
        for (const k of ['R', 'mill', 'landLeft', 'lift']) if (!Number.isFinite(gr[k])) bad.push('ground.' + k);
        for (const k of ['anchor', 'millA', 'bob']) if (!Array.isArray(gr[k]) || gr[k].length !== 2 || !gr[k].every(Number.isFinite)) bad.push('ground.' + k);
        if (gr.state !== 'walk' && gr.state !== 'raft') bad.push('ground.state');
      }
      if (typeof G.groundParts !== 'function' || !Number.isFinite(G.groundParts(3)?.q)) bad.push('groundParts');
      if (!Number.isFinite(G.spread)) bad.push('spread');
      if (bad.length) fail.push(`ground: the landed flock's record carries bad or missing fields (${bad.join(', ')}) — each is a NaN uniform that draws nothing`);
      if (G.n !== B.flockState(A, T1).n) fail.push(`ground: the landed flock went over as ${G.n} birds against the ${B.flockState(A, T1).n} it has — a roost must keep every bird it had in the air`);
    }
    if (g.groundStarlings) fail.push(`ground: ${g.groundStarlings} landed starlings also went through as per-bird records — the per-bird loop ran for a GPU flock`);
    const h = paint({ inst: false, at: T1 });
    if (!h.groundStarlings) fail.push('ground: under a harness hook the landed flock was not drawn at all — with no GPU a landed flock goes on being drawn bird by bird');
    if (h.clouds.length) fail.push('ground: a harness hook received a cloud record for the landed flock');
  }
}

// ── none: a harness's stub hook, and GLASS 1 ──
for (const [label, opts] of [['harness', { inst: false }], ['GLASS 1', { gl: 0, inst: true }]]) {
  const r = paint(opts);
  if (!inView) { fail.push(`${label}: the gpu run of this scene drew no cloud — the flock is not in view, so this proves nothing`); continue; }
  if (r.clouds.length) fail.push(`${label}: ${r.clouds.length} cloud record(s) were handed over — only the real GL pass may simulate a murmuration`);
  if (r.songbirdRecords) fail.push(`${label}: ${r.songbirdRecords} airborne starlings were drawn — there is no CPU flock since 2026-09-23, so the murmuration is not drawn at all`);
}

globalThis.performance = clock;
Date.now = realDateNow;
Object.assign(ws.RENDER_TUNE, was);

if (fail.length) {
  console.error('\n✗ murmurgpu — ' + fail.length + ' problem(s):');
  for (const f of fail) console.error('  ' + f);
  process.exit(1);
}
console.log(`✓ murmurgpu: a ${B.flockSize(A)}-bird murmuration goes to the GPU as one complete record with no bird left behind, stays the GPU's with every bird once it lands, is charged to the GPU's bird budget, and is not drawn in the air on GLASS 1 or under a harness hook.`);
