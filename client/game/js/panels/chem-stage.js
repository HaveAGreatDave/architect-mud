// THE CHEM STAGE: a cook or a splice at a chem lab, played in 3D at the bench (docs/proposals/chem-stage.md,
// phases 2 and 3).
//
// The server arms a cook exactly as it always has (`synth_minigame`, plugins/synthesis), and this is
// the visual rung's way to play it when the drug's form has a chain (client/shared/chem-chain.js):
// a liquid is measured, heated, refluxed and evaporated; a powder weighed and ground; a pill pressed
// as well. Each stage is a short game at its own spot on the bench, and the chain's mean score goes
// back as the one `synthresolve <recipe> <score> <nonce>` the 2-D game sends. So the odds, the ±2 cap
// and the catastrophe roll are the server's, untouched.
//
// The picture is ROOM's: a small room round the lab (gl/lab-mesh.js, at the bench's grade), drawn by
// gl/room.js, with the stage's tools in the set and what moves (gl/lab-matter.js) as its props. The
// room is rebuilt once per stage, so a stage's glass is real glass.
//
// ⚠ NOTHING HERE DECIDES ANYTHING. chem-chain.js scores; this reads the pointer into a stage's input
// and draws its `view`. Closing the Stage resolves nothing, as closing the 2-D bench doesn't: the
// server's pending cook just runs out.
//
// openChemStage returns false when it can't run here (no chain for the form, no WebGL2), and the
// caller opens the 2-D game instead.

import { createRoomRenderer } from './gl/room.js';
import { buildRoom, paintRoomTexture, ROOM_RUG } from './gl/room-mesh.js';
import { roomLayout, roomSpecOf, layRows, facing } from '../../../shared/room-layout.js';
import { createBatch, lin } from './gl/ballpark-mesh.js';
import { benchOf, gradeOf } from './gl/lab-mesh.js';
import { drawStage, drawOutcome, lightStage, createSlosh, stepSlosh, createHeap, addToHeap, settleHeap, mixColour } from './gl/lab-matter.js';
import { chainFor, createChain, stepChain, stageDone, nextStage, chainScore, STAGES } from '../../../shared/chem-chain.js';
import { AX } from './lab-kit.js';
import { escapeHtml as esc, loadCss } from '../../../shared/dom.js';

const CSS = await loadCss(new URL('./chem-stage.css', import.meta.url));
// how long a stage's verdict stays up before the next stage; how long the card waits for the server's
// outcome before it closes anyway; how long an outcome plays
const VERDICT_S = 1.1, CARD_S = 2.2, WAIT_S = 5, OUTCOME_S = 3.2;
// What the server said happened (plugins/synthesis `chem_outcome`), in the card's words.
const OUTCOME_WORDS = {
  fire: 'It catches. A sheet of flame comes off the bench and you smell your own hair.',
  burst: 'The glass goes with a crack, and the bench is covered in it.',
  fumes: 'The hood can\'t keep up. Green fumes roll out over the bench.',
  flash: 'White light, then heat. The splice is gone, and so are your eyebrows.',
  spoiled: 'It goes cloudy and dead. A wasted run.',
  ok: 'It\'s done. The batch goes into the lab\'s store.',
};
// a powder's bulk density, g per cm³: how a weight on the scale becomes a heap on the boat
const BULK = 0.6;

let S = null;
export const isChemStageActive = () => !!S;

// Where the camera stands for each stage, in the bench's own frame: what it looks at, and from where.
function shotOf(stage, B) {
  const t = B.top, hd = B.hd;
  switch (stage) {
    case 'measure': return { at: [B.cyl.x - 0.05, t + 0.15, B.cyl.z], eye: [B.cyl.x - 0.03, t + 0.32, hd + 0.5], fov: 32 };
    case 'heat': return { at: [B.plate.x - 0.02, t + 0.17, B.plate.z], eye: [B.plate.x + 0.04, t + 0.4, hd + 0.58] };
    case 'reflux': { const R = B.reflux, mid = (R.seat + R.cy1) / 2; return { at: [R.x + 0.04, mid, R.z], eye: [R.x + 0.18, mid + 0.06, hd + 0.95] }; }
    case 'evaporate': return { at: [B.plate.x, t + 0.1, B.plate.z], eye: [B.plate.x, t + 0.42, hd + 0.36] };
    case 'weigh': return { at: [B.scale.x + 0.03, t + 0.07, B.scale.z], eye: [B.scale.x + 0.02, t + 0.3, hd + 0.38], fov: 30 };
    case 'grind': return { at: [B.mortar.x, t + 0.04, B.mortar.z], eye: [B.mortar.x, t + 0.36, hd + 0.26], fov: 26 };
    case 'press': return { at: [B.press.x, t + 0.16, B.press.z], eye: [B.press.x + 0.04, t + 0.28, hd + 0.46], fov: 34 };
    case 'separate': return { at: [B.sep.x, B.sep.tap + 0.06, B.sep.z], eye: [B.sep.x + 0.02, B.sep.tap + 0.16, hd + 0.55], fov: 36 };
    case 'crystallise': return { at: [B.ice.x, t + 0.04, B.ice.z], eye: [B.ice.x, t + 0.34, hd + 0.3], fov: 30 };
    case 'filter': return { at: [B.filt.x - 0.03, t + 0.22, B.filt.z], eye: [B.filt.x - 0.02, t + 0.68, hd + 0.3], fov: 38 };
    case 'regulate': { const g = B.gas.gauge; return { at: [g.x - 0.02, g.y - 0.04, g.z], eye: [g.x - 0.04, g.y + 0.02, hd + 0.42], fov: 32 }; }
    case 'leak': { const J = B.gas.joints, mx = (J[0].x + J[3].x) / 2; return { at: [mx, t + 0.03, 0.04], eye: [mx, t + 0.28, hd + 0.36], fov: 34 }; }
    case 'collect': { const j = B.gas.jar; return { at: [j.x + 0.02, t + 0.1, j.z], eye: [j.x + 0.04, t + 0.26, hd + 0.46], fov: 32 }; }
    case 'dry': return { at: [B.screen.x, t + 0.11, B.screen.z], eye: [B.screen.x, t + 0.4, hd + 0.3], fov: 32 };
    case 'cure': return { at: [B.jar.x + 0.05, t + 0.08, B.jar.z], eye: [B.jar.x + 0.06, t + 0.28, hd + 0.46], fov: 32 };
    case 'stir': return { at: [B.stir.x, t + 0.07, B.stir.z], eye: [B.stir.x, t + 0.36, hd + 0.3], fov: 28 };
    case 'rhythm': return { at: [B.flask.x, t + 0.14, B.flask.z], eye: [B.flask.x, t + 0.32, hd + 0.5], fov: 34 };
    default: return { at: [B.xo, t + 0.1, 0], eye: [B.xo, t + 0.5, hd + 0.8] };
  }
}

// opts: { family, form, difficulty, recipeName, workspace, grade, color, seed, auto ({ stage: score }, the
// stages an automation rig handles), onResult({ score }), onClose }. onResult goes as soon as the last
// stage is done; the Stage then waits on the card for the server's outcome (chemOutcome) and plays it.
export function openChemStage(opts = {}) {
  const names = chainFor(opts.family, opts.form);
  if (!names || S) return false;
  const root = document.createElement('div');
  root.className = 'cs-root';
  root.innerHTML = `<style>${CSS}</style>
    <canvas class="cs-canvas"></canvas>
    <div class="cs-vig"></div><div class="cs-bar top"></div><div class="cs-bar bottom"></div>
    <div class="cs-top"><span class="cs-name">${esc(opts.recipeName || 'Cook')}</span><span class="cs-where">${esc(opts.workspace || 'the lab')}</span><button type="button" class="cs-x" aria-label="Stop and leave the bench">&#10005;</button></div>
    <ol class="cs-pips">${names.map((n) => `<li data-stage="${n}">${esc(STAGES[n].label)}</li>`).join('')}</ol>
    <div class="cs-hint" role="status" aria-live="polite"></div>
    <div class="cs-read" hidden></div>
    <div class="cs-verdict" hidden></div>
    <div class="cs-card" hidden></div>
    <div class="cs-fx" hidden></div>`;
  document.body.appendChild(root);
  const canvas = root.querySelector('.cs-canvas');
  const R = createRoomRenderer(canvas, { phone: matchMedia('(pointer: coarse)').matches });
  if (!R) { root.remove(); return false; }

  const grade = ['standard', 'refined', 'pristine'].includes(opts.grade) ? opts.grade : 'standard';
  const product = /^#[0-9a-f]{6}$/i.test(opts.color || '') ? opts.color : '#f0f0ea';
  const seed = opts.seed ?? ((Date.now() / 1000) | 0);
  S = {
    root, canvas, R, names, grade, g: gradeOf(grade), opts,
    chain: createChain(names, { seed, difficulty: opts.difficulty ?? 6, auto: opts.auto || {} }),
    colors: { product: lin(product), liquid: mixColour([lin(product), 1], [lin('#d8e4e8'), 1.5]) },
    input: { down: false, dial: 0, click: false, tap: false, angle: null, joint: -1 },
    slosh: createSlosh(), heap: null, props: createBatch(4096), glass: createBatch(2048), halos: createBatch(512), lastFlow: 0, lastMass: 0, shake: 0, dt: 1 / 60,
    t: 0, last: performance.now(), raf: 0, phase: 'play', wait: 0, cam: null, textures: new Map(),
  };
  setStage();
  bind();
  S.raf = requestAnimationFrame(frame);
  AX.click();
  return true;
}

export function closeChemStage() {
  if (!S) return;
  const s = S;
  S = null;
  cancelAnimationFrame(s.raf);
  AX.pour(false);
  for (const [t, ev, fn, o] of s.listeners) t.removeEventListener(ev, fn, o);
  try { s.R.dispose(); } catch { /* the context may be gone already */ }
  s.root.remove();
  s.opts.onClose?.();
}

// The room round the bench, with this stage's tools out on it.
function setStage() {
  const stage = S.chain.names[S.chain.i];
  const spec = { ...roomSpecOf({ room: [5.2, 4.6, 2.8] }, true), windowless: true };
  const row = { id: 'chem_stage_lab', name: 'chem lab', object_type: 'container', flags: { crafting_station: 'chem_lab', station_quality: S.grade } };
  const pieces = layRows([row], spec).pieces.map((p) => ({ ...p, working: stage }));
  S.L = roomLayout(spec, pieces);
  S.p = S.L.placed[0];
  S.B = benchOf(S.p, S.g);
  S.mesh = buildRoom(S.L, { seed: 7, lampOn: true });
  const paint = (key) => { let c = S.textures.get(key); if (!c) { c = paintRoomTexture(document, key, key === ROOM_RUG ? 7 : 1); S.textures.set(key, c); } return c; };
  S.R.setRoom(S.mesh, paint);
  S.input.dial = 0; S.input.angle = null; S.input.click = false; S.input.tap = false; S.input.joint = -1;
  S.slosh = createSlosh();
  S.heap = stage === 'weigh' ? createHeap(0.03, 14) : null;
  S.lastMass = 0; S.lastFlow = 0;
  S.shot = shotOf(stage, S.B);
  const B = S.B;
  S.lamps = [
    { p: world([B.xo, B.top + 0.75, B.hd + 0.35]), k: 1.05 },
    { p: world([(-B.hw + B.split) / 2, B.h - 0.34, 0]), k: 0.6, tint: [0.72, 0.9, 1.18] },
    { p: world([B.xo + 1.2, 0.4, B.hd + 2.2]), k: 0.22, tint: [0.5, 0.62, 1.15] },
  ];
  // the first shot is wide, the whole bench, and the camera glides in to the stage from it
  if (!S.cam) S.cam = { at: [B.xo - 0.35, B.top + 0.35, 0], eye: [B.xo + 0.25, B.top + 0.95, B.hd + 2.3], fov: 46 };
  root$('.cs-hint').textContent = STAGES[stage].hint;
  S.root.querySelectorAll('.cs-pips li').forEach((li, i) => { li.className = i < S.chain.i ? 'done' : i === S.chain.i ? 'now' : ''; });
}
const root$ = (sel) => S.root.querySelector(sel);

// The bench's frame: a point in it to the world, as gl/lab-matter.js and room-kit.js have it.
function world(p) {
  const [fu, fv] = facing(S.p.turn), su = -fv, sv = fu;
  return S.L.world(S.p.u + su * p[0] + fu * p[2], S.p.v + sv * p[0] + fv * p[2], p[1]);
}
function camOf(shot) {
  const e = world(shot.eye), a = world(shot.at), d = [a[0] - e[0], a[1] - e[1], a[2] - e[2]], l = Math.hypot(...d) || 1, f = d.map((x) => x / l);
  return { eye: e, yaw: Math.atan2(f[0], f[2]), pitch: Math.asin(Math.max(-1, Math.min(1, f[1]))), fov: shot.fov || 36 };
}

function bind() {
  const L = [];
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); L.push([t, ev, fn, o]); };
  S.listeners = L;
  let lastY = null, from = null;
  on(S.canvas, 'pointerdown', (e) => { S.input.down = true; S.input.click = true; lastY = e.clientY; from = [e.clientX, e.clientY, performance.now()]; aim(e); S.canvas.setPointerCapture?.(e.pointerId); });
  // a tap is a press that didn't drag: it takes the leaf off the heat without moving the dial
  on(S.canvas, 'pointerup', (e) => { S.input.down = false; lastY = null; if (from && Math.hypot(e.clientX - from[0], e.clientY - from[1]) < 8 && performance.now() - from[2] < 450) S.input.tap = true; from = null; });
  on(S.canvas, 'pointercancel', () => { S.input.down = false; lastY = null; });
  on(S.canvas, 'pointermove', (e) => {
    aim(e);
    // the dial and the tap follow the drag, from wherever they were left
    if (S.input.down && lastY !== null) { S.input.dial = Math.max(0, Math.min(1, S.input.dial - (e.clientY - lastY) / 260)); lastY = e.clientY; }
  });
  on(S.canvas, 'wheel', (e) => { e.preventDefault(); S.input.dial = Math.max(0, Math.min(1, S.input.dial - Math.sign(e.deltaY) * 0.05)); }, { passive: false });
  on(window, 'keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeChemStage(); return; }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) { S.input.down = true; S.input.click = true; S.input.tap = true; } }
    // the joints on a gas line by number
    if (/^[1-4]$/.test(e.key)) { e.preventDefault(); S.input.joint = Number(e.key) - 1; if (!e.repeat) S.input.down = true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); S.input.dial = Math.min(1, S.input.dial + 0.05); }
    if (e.key === 'ArrowDown') { e.preventDefault(); S.input.dial = Math.max(0, S.input.dial - 0.05); }
    // the pestle by keys: left and right walk it round the bowl
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); S.input.down = true; S.input.angle = (S.input.angle ?? 0) + (e.key === 'ArrowLeft' ? -0.2 : 0.2); }
  });
  on(window, 'keyup', (e) => { if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || /^[1-4]$/.test(e.key)) S.input.down = false; });
  on(root$('.cs-x'), 'click', () => closeChemStage());
}
// What the pointer is on: its angle round the mortar or the beaker, or the gas-line joint it's nearest.
function aim(e) {
  const stage = S.chain.names[S.chain.i], r = S.canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (stage === 'grind' || stage === 'stir') {
    const m = stage === 'grind' ? S.B.mortar : S.B.stir, c = S.R.project(world([m.x, S.B.top + 0.03, m.z]), r.width, r.height);
    // seen from the front the bench's +x is on your left, so the angle runs the other way across
    if (c) S.input.angle = Math.atan2(py - c.y, -(px - c.x));
  }
  if (stage === 'leak') {
    let best = -1, bd = 70;
    S.B.gas.joints.forEach((j, i) => { const c = S.R.project(world([j.x, j.y, j.z]), r.width, r.height); const d = c ? Math.hypot(px - c.x, py - c.y) : 1e9; if (d < bd) { bd = d; best = i; } });
    S.input.joint = best;
  }
}

// What the pointer means to this stage.
function inputFor(stage) {
  const i = S.input;
  switch (stage) {
    case 'measure': return { pour: i.down };
    case 'heat': return { dial: i.dial };
    case 'reflux': return { flow: i.dial };
    case 'evaporate': return { stop: i.click };
    case 'weigh': return { tip: i.down };
    case 'grind': return { press: i.down, angle: i.angle };
    case 'press': return { press: i.down };
    case 'separate': return { open: i.down };
    case 'crystallise': return { dial: i.dial };
    case 'filter': return { pour: i.down };
    case 'regulate': return { dial: i.dial };
    case 'leak': return { joint: i.joint, down: i.down };
    case 'collect': return { open: i.down };
    case 'dry': return { dial: i.dial, stop: i.tap };
    case 'cure': return { click: i.click };
    case 'stir': return { press: i.down, angle: i.angle };
    case 'rhythm': return { click: i.click };
    default: return {};
  }
}

function frame(now) {
  if (!S) return;
  // a frame's time can be earlier than the open's performance.now(), so never step backwards
  const dt = Math.max(0, Math.min(0.05, (now - S.last) / 1000));
  S.last = now; S.t += dt; S.dt = dt || S.dt;
  S.shake = Math.max(0, S.shake - dt * 1.6);
  const C = S.chain, stage = C.names[C.i];
  if (S.phase === 'play' && stage in C.auto) {
    // an automation rig's stage: it's done for you, at the rig's score
    verdict(C.auto[stage], 'The rig handles it.');
    S.phase = 'verdict'; S.wait = VERDICT_S;
  } else if (S.phase === 'play') {
    const before = stage === 'weigh' ? C.state.mass : 0;
    stepChain(C, inputFor(stage), dt);
    S.input.click = false; S.input.tap = false;
    matter(stage, dt, before);
    if (stageDone(C)) {
      const sc = Math.round(STAGES[stage].score(C.state));
      AX.pour(false);
      verdict(sc);
      S.phase = 'verdict'; S.wait = VERDICT_S;
    }
  } else if (S.phase === 'verdict') {
    S.wait -= dt;
    if (S.wait <= 0) {
      root$('.cs-verdict').hidden = true;
      if (nextStage(C)) {
        card(); S.phase = 'card'; S.wait = WAIT_S; S.shown = 0;
        // the score goes now, so the server's answer can come back while the card's up
        S.opts.onResult?.({ score: chainScore(C.scores) });
      } else { setStage(); S.phase = 'play'; AX.click(); }
    }
  } else if (S.phase === 'card') {
    S.wait -= dt; S.shown += dt;
    if (S.outcome && S.shown >= 0.8) startOutcome();
    else if (S.wait <= 0 || (S.opts.noOutcome && S.shown >= CARD_S)) { closeChemStage(); return; }
  } else if (S.phase === 'outcome') {
    S.wait -= dt; S.outT += dt;
    if (S.wait <= 0) { closeChemStage(); return; }
  }
  draw(C.i < C.names.length ? C.names[C.i] : C.names[C.names.length - 1]);
  S.raf = requestAnimationFrame(frame);
}

// The matter between frames: a knock to the liquid when the pour changes or it boils, the heap growing
// by what landed, the pour's sound.
function matter(stage, dt, massBefore) {
  const v = STAGES[stage].view(S.chain.state);
  let knock = [0, 0];
  if (stage === 'measure') { knock = [(v.flow - S.lastFlow) / Math.max(dt, 1e-3) * 0.4, 0]; S.lastFlow = v.flow; AX.pour(v.flow > 0.01); }
  if (stage === 'heat' && v.boiling) knock = [Math.sin(S.t * 13) * v.boiling * 0.25, Math.cos(S.t * 11) * v.boiling * 0.25];
  stepSlosh(S.slosh, knock, dt);
  if (stage === 'separate') AX.pour(v.open > 0.05);
  if (stage === 'filter') AX.pour(v.tip > 0.25 && v.poured < 1);
  if (stage === 'collect') AX.pour(v.flow > 0.01);
  if (stage === 'cure' && v.open > 0.55) AX.clink();
  if (stage === 'rhythm' && v.flash && !S.flashed) AX.tick();
  if (stage === 'rhythm') S.flashed = v.flash;
  if (stage === 'leak' && S.input.down && !S.leakWas && S.input.joint >= 0) AX.tick();
  S.leakWas = S.input.down;
  if (stage === 'weigh') {
    const landed = S.chain.state.mass - massBefore;
    if (landed > 0) { addToHeap(S.heap, (landed / BULK) * 1e-6, (Math.sin(S.t * 7) * 0.5 + 0.5) * 0.004); settleHeap(S.heap, 3); }
    AX.pour(v.falling > 0.01);
  }
}

function draw(stage) {
  const C = S.chain, st = C.state, v = STAGES[stage].view(st);
  // the camera eases to the stage's shot
  // the camera: eases to the stage's shot (slowly off the opening wide shot), pulls back for the card, and
  // pushes in as the stage comes to its moment
  const card = S.phase === 'card' || S.phase === 'outcome';
  const want = card ? { at: S.shot.at, eye: [S.shot.eye[0], S.shot.eye[1] + 0.1, S.shot.eye[2] + 0.35], fov: (S.shot.fov || 36) + 6 } : S.shot;
  const k = 1 - Math.exp(-(S.t < 2 ? 1.8 : 3.5) * Math.min(0.05, S.dt));
  for (const key of ['at', 'eye']) for (let i = 0; i < 3; i++) S.cam[key][i] += (want[key][i] - S.cam[key][i]) * k;
  const push = card ? 0 : tensionOf(stage, v);
  S.cam.fov += ((want.fov || 36) * (1 - 0.14 * push) - S.cam.fov) * k;
  const look = { t: S.t, grade: S.g, liquid: S.colors.liquid, product: S.colors.product, slosh: S.slosh, heap: S.heap, glass: S.glass };
  drawStage(S.L, S.p, stage, v, look, S.props);
  const at = [S.shot.at[0], S.shot.at[2]];
  if (S.phase === 'outcome') drawOutcome(S.L, S.p, S.outcome, at, S.outT, look, S.props);
  const lit = lightStage(S.L, S.p, stage, v, { ...look, ...(S.phase === 'outcome' ? { outcome: S.outcome, age: S.outT, at } : {}) }, S.halos);
  S.R.setProps(S.props); S.R.setPropsGlass(S.glass); S.R.setStageHalos(lit.halos); S.R.setGlows(lit.glows);
  // a breathing camera, and a shake that dies away after a bang
  const cam = camOf(S.cam), sh = S.shake * S.shake * 0.02;
  cam.eye = [cam.eye[0] + Math.sin(S.t * 0.6) * 0.005, cam.eye[1] + Math.sin(S.t * 0.45) * 0.004, cam.eye[2] + Math.cos(S.t * 0.5) * 0.004];
  cam.fov = S.cam.fov;
  if (sh > 0) cam.shake = [Math.sin(S.t * 61) * sh, Math.cos(S.t * 53) * sh];
  S.R.render(cam, { lamps: S.lamps, lampOn: true, lampLevel: 0.78, day: 0, sky: [0.6, 0.7, 0.9], wins: [], annex: null });
  // letterboxed for the opening shot and the result
  S.root.classList.toggle('cs-cine', S.t < 1.6 || card);
  // a scale shows its weight: the readout over its display
  const read = root$('.cs-read');
  if (stage === 'weigh') {
    const r = S.canvas.getBoundingClientRect(), at = S.R.project(world([S.B.scale.x, S.B.top + 0.03, S.B.scale.z + 0.1]), r.width, r.height);
    read.hidden = !at;
    if (at) { read.style.left = `${at.x}px`; read.style.top = `${at.y}px`; read.innerHTML = `<b>${v.mass.toFixed(2)} g</b><small>${v.target.toFixed(2)} g wanted</small>`; }
  } else read.hidden = true;
}

// How close a stage is to its moment, 0..1: the camera pushes in on it.
function tensionOf(stage, v) {
  const near = (d, w) => Math.max(0, 1 - Math.abs(d) / w);
  switch (stage) {
    case 'measure': return v.flow > 0 || v.level > 0.05 ? near(v.target - v.level, 0.15) : 0;
    case 'collect': return v.gas > 0.05 ? near(v.target - v.gas, 0.15) : 0;
    case 'separate': return v.open > 0 ? near(v.lower, 0.12) : 0;
    case 'weigh': return v.mass > 0 ? near((v.target - v.mass) / v.target, 0.3) : 0;
    case 'press': return v.force > 0 ? near(v.mark - v.force, 0.25) : 0;
    case 'rhythm': return Math.max(0, Math.min(1, (v.close - 0.6) / 0.4));
    case 'evaporate': return v.beat === 'dry' ? 1 : 0;
    case 'cure': return near(v.h - (v.win[0] + v.win[1]) / 2, 0.15);
    default: return 0;
  }
}

function verdict(score, said = null) {
  const el = root$('.cs-verdict');
  const word = said || (score >= 85 ? 'Clean.' : score >= 60 ? 'Near enough.' : score >= 30 ? 'Sloppy.' : 'Ruined.');
  el.textContent = word; el.className = `cs-verdict ${score >= 60 ? 'good' : 'bad'}`; el.hidden = false;
  (score >= 85 ? AX.perfect : score >= 60 ? AX.good : AX.bad)();
  if (score < 30) S.shake = Math.max(S.shake, 0.5);
}

function card() {
  const C = S.chain, total = chainScore(C.scores), el = root$('.cs-card');
  el.innerHTML = `<h3>${esc(S.opts.recipeName || 'The cook')}</h3><ul>${C.names.map((n, i) => `<li><span>${esc(STAGES[n].label)}</span><i style="--w:${C.scores[i]}%"></i></li>`).join('')}</ul><p>${total >= 70 ? 'A good batch, if the chemistry holds.' : total >= 40 ? 'It\'ll do, if the chemistry holds.' : 'That went badly. The chemistry had better be good.'}</p>`;
  el.hidden = false;
  root$('.cs-hint').textContent = '';
  S.root.querySelectorAll('.cs-pips li').forEach((li) => { li.className = 'done'; });
}

// The server's word on the cook (`chem_outcome`): played on the card if the Stage is still up, else nothing.
export function chemOutcome(msg) {
  if (!S || !OUTCOME_WORDS[msg?.outcome]) return;
  S.outcome = msg.outcome;
}
function startOutcome() {
  const kind = S.outcome;
  S.phase = 'outcome'; S.outT = 0; S.wait = OUTCOME_S;
  const card = root$('.cs-card'), line = document.createElement('p');
  line.className = 'cs-outcome ' + kind; line.textContent = OUTCOME_WORDS[kind];
  card.appendChild(line);
  if (kind === 'fire' || kind === 'burst' || kind === 'flash') S.shake = kind === 'flash' ? 1.4 : 1;
  const fx = root$('.cs-fx');
  fx.className = 'cs-fx ' + kind; fx.hidden = false;
  ({ fire: AX.klaxon, burst: AX.shatter, flash: AX.shatter, fumes: AX.alarm, spoiled: AX.bad, ok: AX.confirm }[kind] || AX.tick)();
}

// For the Room Lab with the pane hidden, where requestAnimationFrame doesn't run: step the Stage by hand
// with an input held (`{ down, dial, click, tap, angle, joint }`, or a function of the stage's own state that
// returns one), and read a frame back in the same task as it's
// drawn, since a GL canvas keeps nothing after that.
export const _chemTest = {
  get state() { return S && { stage: S.chain.names[S.chain.i], outcome: S.outcome || null, phase: S.phase, scores: S.chain.scores.slice(), view: S.chain.i < S.chain.names.length ? STAGES[S.chain.names[S.chain.i]].view(S.chain.state) : null }; },
  step(seconds = 1 / 30, input = null) {
    const n = Math.max(1, Math.round(seconds * 30));
    for (let i = 0; i < n && S; i++) { if (input) Object.assign(S.input, typeof input === 'function' ? input(S.chain.state, _chemTest.state) : input); frame(S.last + 1000 / 30); }
    return _chemTest.state;
  },
  shot() {
    if (!S) return null;
    if (!S.canvas.clientWidth) { S.root.style.width = '1280px'; S.root.style.height = '720px'; }
    draw(S.chain.names[Math.min(S.chain.i, S.chain.names.length - 1)]);
    return S.canvas.toDataURL('image/jpeg', 0.9);
  },
};
