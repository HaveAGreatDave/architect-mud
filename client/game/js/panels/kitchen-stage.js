// THE KITCHEN STAGE: cooking's 3-D rung, drawn cel-shaded in the room pane
// (docs/proposals/kitchen-stage.md).
//
// A counter in front of the stove with three stations: the board on the left, the hob in the
// middle, the pass on the right. It draws the same `workspace_view` payload the workspace HUD draws
// (workspace.js), and like the HUD it holds no cooking rules. Every gesture on an existing
// mechanic sends a command the payload already carries, found by its `role`: dragging food to the
// pan sends its `stow` action, turning the knob sends that position's `stove` command, flicking
// the pan sends the food's `handle` action. So the Stage can never do what a typed verb couldn't,
// and the server decides every outcome.
//
// What it adds is the picture: food coloured by the cook beat the server sends (never a clock;
// kitchen-matter.js says why), pieces that toss and settle, flames by the dial, steam from what
// the food emits, and a camera that cuts between stations.
//
// ⚠ IT ASKS, IT DOESN'T POLL. The payload is re-asked after every action and every five seconds
// while something cooks, as the HUD does, plus once on each `kitchen_beat` the server sends when a
// cook reaches a new beat (plugins/cooking/stage.js).
//
// ⚠ NO WEBGL2, NO STAGE. `createKitchenRenderer` returns null and this opens the HUD instead.

import { sendCmd, sendCmdSilent } from '../net.js';
import { setAreaPane } from '../render.js';
import { escapeHtml as esc, loadCss } from '../../../shared/dom.js';
import { claimSeatKeyboard, endSeatKeyboard, seatHoldsKeyboard } from './seat-keys.js';
import { openWorkspacePanel } from './workspace.js';
import * as M from './gl/arena-mesh.js';
import * as KS from './gl/kitchen-mesh.js';
import { createKitchenRenderer, pickPlane, toScreen } from './gl/kitchen.js';
import { matterFor, beatOf } from '../../../shared/kitchen-matter.js';
import { footprint, cutPieces, balancedGuides, bounds, cutToken, MAX_TILT } from '../../../shared/knife.js';
import { presentation } from '../../../shared/plating.js';

const STAGE_CSS = await loadCss(new URL('./kitchen-stage.css', import.meta.url));
const LIST_KEY = 'architect_kitchen_list';
const TICK_MS = 5000;
const STEP = 1 / 120;
const G = -980;                                   // cm/s²

// Where the camera stands for each station. `push` is the hob shot when the food is in its window.
const SHOTS = {
  board: { eye: [-55, -78, 66], at: [-55, 0, 0], fov: 0.6, roll: -0.05 },
  hob: { eye: [0, -100, 72], at: [0, 2, -2], fov: 0.6, roll: 0 },
  push: { eye: [0, -78, 58], at: [0, 2, 0], fov: 0.58, roll: 0.02 },
  pass: { eye: [55, -70, 60], at: [55, 0, 0], fov: 0.6, roll: 0.04 },
};
const ORDER = ['board', 'hob', 'pass'];
const LABEL = { board: ['切', 'Board'], hob: ['焼', 'Hob'], pass: ['盛', 'Pass'] };
const HOB_FOR_TIER = { low: 'camp', mid: 'domestic', high: 'range' };

let S = null;

export const isKitchenStageActive = () => !!S;

// The player chose the list. Kept for the session so the next `cook` doesn't throw them back.
export function kitchenStageDeclined() {
  try { return sessionStorage.getItem(LIST_KEY) === '1'; } catch { return false; }
}

export function openKitchenStage(data) {
  if (S) return refreshKitchenStage(data);
  ensureStyles();
  setAreaPane(`<div id="ks-root" class="ks-root" role="region" aria-label="Kitchen">
    <canvas class="ks-gl" aria-hidden="true"></canvas>
    <canvas class="ks-fx" aria-hidden="true"></canvas>
    <div class="ks-top">
      <div class="ks-tabs" role="tablist"></div>
      <div class="ks-tools">
        <button class="ks-btn" data-ks="list" title="The workspace list (L)">List</button>
        <button class="ks-btn" data-ks="close" aria-label="Close" title="Close (Esc)">✕</button>
      </div>
    </div>
    <div class="ks-beat" aria-live="polite"></div>
    <div class="ks-tray"></div>
    <div class="ks-chips"></div>
    <div class="ks-keys"></div>
  </div>`);
  const root = document.getElementById('ks-root');
  const gl = root.querySelector('.ks-gl'), fx = root.querySelector('.ks-fx');
  const phone = matchMedia?.('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
  const renderer = createKitchenRenderer(gl, { phone });
  if (!renderer) {
    root.remove();
    try { sessionStorage.setItem(LIST_KEY, '1'); } catch { /* private window */ }
    openWorkspacePanel(data);
    return;
  }
  S = {
    root, gl, fx, fxc: fx.getContext('2d'), renderer, phone,
    data: null, station: 'hob', cam: { ...SHOTS.hob }, from: null, to: null, tAt: 0,
    bodies: new Map(), board: null, boardBody: null, dish: null,
    stat: M.createBatch(1 << 14), dyn: M.createBatch(1 << 15), hobKind: null,
    flash: 0, impact: 0, shake: 0, lines: 0, puffs: [], bubbles: [], last: performance.now(), acc: 0, t: 0,
    lastSizzle: 0, tick: null, raf: 0, drag: null, M: null, sent: 0,
  };
  root.addEventListener('click', onClick);
  gl.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey);
  window.dispatchEvent(new Event('pane:claimed'));
  claimSeatKeyboard(root, { label: 'KITCHEN' });
  sendCmdSilent('kitchenstage on');
  refreshKitchenStage(data);
  S.raf = requestAnimationFrame(frame);
}

export function refreshKitchenStage(data) {
  if (!S || !data) return;
  S.data = data;
  const dial = dialOf(data), hob = HOB_FOR_TIER[dial?.ceilingBand] || 'domestic';
  if (hob !== S.hobKind) {
    S.hobKind = hob;
    M.reset(S.stat);
    KS.buildSet(S.stat, { hob });
    S.renderer.setStatic(S.stat);
  }
  syncBodies();
  if (S.board && !foods().some((c) => c.id === S.board)) { S.board = null; S.boardBody = null; }
  paintDom();
  if (S.tick) clearTimeout(S.tick);
  if (cooking()) S.tick = setTimeout(() => { if (S) sendCmdSilent('workspace'); }, TICK_MS);
}

// The server says a cook just reached a new beat: ask for the view now rather than in five seconds.
export function kitchenBeat() { if (S) sendCmdSilent('workspace'); }

export function closeKitchenStage({ quiet = false } = {}) {
  if (!S) return;
  const s = S;
  S = null;
  cancelAnimationFrame(s.raf);
  if (s.tick) clearTimeout(s.tick);
  s.renderer.dispose();
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('keydown', onKey);
  endSeatKeyboard(s.root);
  s.root.remove();
  window.dispatchEvent(new Event('pane:released'));
  sendCmdSilent('kitchenstage off');
  if (!quiet) sendCmdSilent('look');
}

// ── reading the payload ──────────────────────────────────────────────────────────────────────────
const allComps = (d) => [...(d?.components || []), ...(d?.area || []).flatMap((v) => v.contents || [])];
const foods = () => (S.data?.components || []).filter((c) => c.kind === 'food' && c.look);
function panOf(d) {
  const vs = (d?.area || []).filter((v) => v.look?.vessel && v.look.vessel !== 'bread');
  return vs.find((v) => v.hot) || vs[0] || null;
}
function dialOf(d) {
  const ds = d?.dials || [], pan = panOf(d);
  return ds.find((x) => pan && String(x.subjectId) === String(pan.id)) || ds[0] || null;
}
const cooking = () => allComps(S.data).some((c) => c.live);
const actOf = (row, role, test = null) => (row?.actions || []).find((a) => a.role === role && (!test || test(a))) || null;
function windowOpen() {
  const pan = panOf(S.data);
  return (pan?.contents || []).some((c) => c.cook?.phase === 'window');
}

// Send a payload command as if typed, and re-ask. A prefix (it ends in a space) wants a second
// object only the player can name, so it goes to the command line, as the HUD does.
function run(a) {
  if (!a?.command) return;
  if (a.command.endsWith(' ')) {
    const input = document.getElementById('cmd-input');
    if (input) { input.value = a.command; input.focus(); }
    return;
  }
  sendCmd(a.command);
  sendCmdSilent('workspace');
}

// ── the pieces ───────────────────────────────────────────────────────────────────────────────────
// One body per food in the pan, kept across refreshes so a piece doesn't jump when the server
// answers. Position in the pan's frame; z is the floor the piece rests on.
function syncBodies() {
  const pan = panOf(S.data), keep = new Set();
  const R = pan ? KS.vesselSpec(pan.look.vessel).r - 3 : 0;
  for (const c of pan?.contents || []) {
    if (!c.look) continue;
    keep.add(c.id);
    if (!S.bodies.has(c.id)) {
      const a = hash(c.id) * Math.PI * 2, r = Math.sqrt(hash(c.id + 'r')) * R * 0.7;
      S.bodies.set(c.id, { p: [Math.cos(a) * r, Math.sin(a) * r, 30], v: [0, 0, 0], yaw: a * 2, roll: 0, vr: 0, seed: (hash(c.id) * 1e6) | 0 });
    }
  }
  for (const id of [...S.bodies.keys()]) if (!keep.has(id)) S.bodies.delete(id);
}

function step(dt) {
  const pan = panOf(S.data);
  if (!pan) return;
  const R = KS.vesselSpec(pan.look.vessel).r - 2.5;
  const bodies = [...S.bodies.values()];
  for (const b of bodies) {
    b.v[2] += G * dt;
    for (let i = 0; i < 3; i++) b.p[i] += b.v[i] * dt;
    b.roll += b.vr * dt;
    if (b.p[2] <= 0) {
      b.p[2] = 0;
      if (b.v[2] < -40) b.v[2] *= -0.2; else b.v[2] = 0;
      b.v[0] *= 0.86; b.v[1] *= 0.86;
      // land flat: the nearest half-turn wins
      const flat = Math.round(b.roll / Math.PI) * Math.PI;
      b.roll += (flat - b.roll) * 0.25; b.vr *= 0.5;
    }
    const r = Math.hypot(b.p[0], b.p[1]);
    if (r > R) {
      const nx = b.p[0] / r, ny = b.p[1] / r;
      b.p[0] = nx * R; b.p[1] = ny * R;
      const vn = b.v[0] * nx + b.v[1] * ny;
      if (vn > 0) { b.v[0] -= 1.5 * vn * nx; b.v[1] -= 1.5 * vn * ny; }
    }
  }
  // pieces push each other apart on the floor
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j], dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], d = Math.hypot(dx, dy) || 1e-3;
    if (d < 5) { const k = (5 - d) * 0.25; a.p[0] -= dx / d * k; a.p[1] -= dy / d * k; b.p[0] += dx / d * k; b.p[1] += dy / d * k; }
  }
}

function toss() {
  for (const b of S.bodies.values()) {
    b.v = [(Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30 + 10, 150 + Math.random() * 40];
    b.vr = (Math.random() < 0.5 ? -1 : 1) * (11 + Math.random() * 3);
  }
  S.shake = 0.6; S.lines = 1; S.flash = 0.25;
  ksfx('kitchen-whoosh');
}
function swirl() {
  for (const b of S.bodies.values()) {
    const r = Math.hypot(b.p[0], b.p[1]) || 1;
    b.v[0] += (-b.p[1] / r) * 40; b.v[1] += (b.p[0] / r) * 40; b.v[2] += 20;
  }
}

// ── the frame ────────────────────────────────────────────────────────────────────────────────────
function frame(now) {
  if (!S) return;
  const dt = Math.min(0.1, (now - S.last) / 1000);
  S.last = now; S.t += dt; S.acc += dt;
  while (S.acc >= STEP) { step(STEP); S.acc -= STEP; }
  moveCamera(now);
  S.flash = Math.max(0, S.flash - dt * 4);
  S.shake = Math.max(0, S.shake - dt * 3);
  S.lines = Math.max(0, S.lines - dt * 3);
  build(dt);
  const sh = S.shake * 0.004;
  // An impact frame is the picture inverted for two frames, as a manga panel cuts to white on black.
  const fx = { shake: [(Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh], flash: S.impact > 0 ? 1 : 0 };
  if (S.impact > 0) S.impact--;
  S.M = S.renderer.render(S.cam, S.dyn, fx);
  if (S.renderer.lost) { const d = S.data; closeKitchenStage({ quiet: true }); openWorkspacePanel(d); return; }
  paintFx();
  sizzle(now);
  S.raf = requestAnimationFrame(frame);
}

function moveCamera(now) {
  const want = S.station === 'hob' && windowOpen() ? 'push' : S.station;
  const target = SHOTS[want];
  if (S.to !== target) { S.from = { ...S.cam }; S.to = target; S.tAt = now; }
  const k = Math.min(1, (now - S.tAt) / 260), e = k * k * (3 - 2 * k);
  const L = (a, b) => a + (b - a) * e, V3 = (a, b) => [L(a[0], b[0]), L(a[1], b[1]), L(a[2], b[2])];
  // A tall screen (a phone held upright) keeps the shot's width by opening the lens.
  const aspect = (S.gl.clientWidth || 1) / (S.gl.clientHeight || 1), fov = L(S.from.fov, S.to.fov);
  const wide = aspect < 1.3 ? Math.min(1.5, 2 * Math.atan(Math.tan(fov / 2) * 1.3 / aspect)) : fov;
  S.cam = { eye: V3(S.from.eye, S.to.eye), at: V3(S.from.at, S.to.at), fov: wide, roll: L(S.from.roll, S.to.roll) };
  if (k < 1 && want !== 'push') S.lines = Math.max(S.lines, 0.6);
}

function build(dt) {
  const b = M.reset(S.dyn), d = S.data, pan = panOf(d), dial = dialOf(d);
  const level = dial?.level || 0;
  const onHeat = !!pan?.hot;
  KS.knob(b, level, KS.KNOB, KS.knobBase(S.hobKind));
  if (onHeat || level > 0) KS.flames(b, onHeat ? level : 0, S.t, KS.BURNER, KS.PAN_Z - 0.2);
  // the pan: on the ring, or resting beside the hob
  if (pan) {
    const at = onHeat ? [KS.STATIONS.hob, 0, KS.PAN_Z] : [KS.STATIONS.hob + 22, -4, 0];
    const P = KS.pose(at, 0);
    KS.vessel(b, pan.look.vessel, P);
    const base = KS.vesselSpec(pan.look.vessel).base;
    for (const c of pan.contents || []) {
      const body = S.bodies.get(c.id);
      if (!body || !c.look) continue;
      const m = matterFor(c.look.profile, c.look.matter), beat = beatOf(c.cook, c.state === 'cooked');
      const piece = pieceOf(m, c);
      const p = [at[0] + body.p[0], at[1] + body.p[1], at[2] + 1 + body.p[2]];
      KS.foodPiece(b, m, piece, KS.piecesOf(m, []).whole, beat, KS.pose(p, body.yaw, body.roll), body.seed);
      if (onHeat && level > 0) emit(m, c, p, dt);
    }
    if ((pan.contents || []).some((c) => c.look?.profile === 'liquid') && onHeat && level >= 4 && Math.random() < dt * level) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 8;
      S.bubbles.push({ p: [at[0] + Math.cos(a) * r, at[1] + Math.sin(a) * r, at[2] + base + 3], age: 0 });
    }
  }
  // the board: a cut in progress, or the food you picked
  const food = S.knife ? null : S.board ? foods().find((c) => c.id === S.board) : null;
  if (S.knife) buildKnife(b, dt);
  if (food) {
    const m = matterFor(food.look.profile, food.look.matter);
    const dr = S.drag?.kind === 'food' ? S.drag.at : null;
    const at = dr || [KS.STATIONS.board, 0, KS.BOARD.h];
    KS.foodPiece(b, m, pieceOf(m, food), KS.piecesOf(m, []).whole, beatOf(food.cook), KS.pose(at, 0.1), 7);
  }
  if (!S.knife) KS.knife(b, KS.pose([KS.STATIONS.board + 4, 10.5, KS.BOARD.h + 0.1], -0.2, Math.PI / 2));
  // the pass: a plate, with what is being laid out on it or the last dish served
  KS.plate(b, KS.pose([KS.STATIONS.pass, 0, 1.2]));
  const shown = S.dress ? S.dress.items : S.dish || [];
  for (const [i, it] of shown.entries()) {
    const at = it.placed ? [KS.STATIONS.pass + it.x, it.y, PLATE_TOP] : [KS.STATIONS.pass - 16 + i * 8, 13, 1.3];
    KS.foodPiece(b, it.m, it.piece, it.whole, it.beat, KS.pose(at, it.yaw, 0, DISH_SCALE), i + 3);
  }
  const line = S.dress ? S.dress.line : S.dishLine || [];
  for (const q of line) M.ellipsoid(b, [KS.STATIONS.pass + q.x, q.y, PLATE_TOP - 0.3], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.9, 0.9, 0.25], S.dress?.sauceCol || S.dishSauce || SAUCE, 8, 4);
  // steam and bubbles
  S.puffs = S.puffs.filter((p) => (p.age += dt / p.life) < 1);
  for (const p of S.puffs) KS.puff(b, p.p, p.age, p.c, p.size);
  S.bubbles = S.bubbles.filter((p) => (p.age += dt * 2.5) < 1);
  for (const p of S.bubbles) KS.bubble(b, p.p, p.age);
}

// ── the knife ────────────────────────────────────────────────────────────────────────────────────
// The server armed a cut ('knife_game', plugins/cooking/index.js armKnife). The food lies along x
// on the board; each stroke is a straight line across it, and the pieces are knife.js's real
// pieces. A marker sweeps along the food for the keyboard: Space cuts where it is.
export function kitchenKnife(msg) {
  if (!S) return;
  const m = matterFor(msg.look?.profile, msg.look?.matter);
  const whole = footprint(m.form), bb = bounds(whole);
  S.knife = { ...msg, m, whole, bb, cuts: [], crush: 0, guides: balancedGuides(whole, msg.pieces), sweep: 0, dir: 1, blade: null, done: 0 };
  go('board');
  paintDom();
}
const BOARD_AT = () => [KS.STATIONS.board, 0, KS.BOARD.h];
// A board-plane x to a fraction along the food, 0 at its left end.
const alongFood = (x) => { const k = S.knife, o = BOARD_AT()[0]; return (x - o - k.bb.x0) / (k.bb.x1 - k.bb.x0); };

function buildKnife(b, dt) {
  const k = S.knife, o = BOARD_AT();
  // the marker sweeps faster on a harder cut
  k.sweep += k.dir * dt * (0.35 + 0.5 * (k.difficulty || 0.5));
  if (k.sweep > 1) { k.sweep = 1; k.dir = -1; }
  if (k.sweep < 0) { k.sweep = 0; k.dir = 1; }
  const pieces = cutPieces(k.whole, k.cuts), spread = k.cuts.length ? 0.9 : 0;
  pieces.forEach((p, i) => {
    const off = (i - (pieces.length - 1) / 2) * spread;
    KS.foodPiece(b, k.m, p, k.whole, 'raw', KS.pose([o[0] + off, o[1], o[2]]), i + 1);
  });
  // red tabs at the board's front edge where an even cut falls, and the blue marker below them
  const X = (f) => o[0] + k.bb.x0 + (k.bb.x1 - k.bb.x0) * f, edge = k.bb.y0 - 2.5;
  for (const g of k.guides) KS.slab(b, [X(g) - 0.25, edge - 1.2, o[2]], [X(g) + 0.25, edge, o[2] + 0.3], KS.COLOURS.guide, 0.05);
  KS.slab(b, [X(k.sweep) - 0.5, edge - 3.4, o[2]], [X(k.sweep) + 0.5, edge - 1.6, o[2] + 0.8], KS.COLOURS.marker, 0.1);
  // the knife, held over the food: where the stroke is when one is being drawn, else over the marker
  const bx = k.blade ? k.blade[0] : X(k.sweep), lift = k.blade ? 0.2 : 4;
  KS.knife(b, KS.pose([bx, k.bb.y1 + 4, o[2] + lift + k.m.form.h * 0.2], -Math.PI / 2, -0.35));
}

function cutAt(at, tilt, slow) {
  const k = S.knife;
  if (!k || k.done) return;
  if (!(at >= 0 && at <= 1)) { ksfx('kitchen-tap'); return; }        // missed the food: a tap on the board
  k.cuts.push({ at, tilt: Math.max(-MAX_TILT, Math.min(MAX_TILT, tilt)) });
  const soft = (k.m.cut.firmness ?? 0.5) < 0.4;
  if (soft && slow) { k.crush++; ksfx('kitchen-squash'); } else ksfx('kitchen-thock');
  const nearest = Math.min(...k.guides.map((g) => Math.abs(g - at)));
  // a clean stroke on a guide gets the impact frame; anything else a little shake
  if (nearest < 0.02 && Math.abs(tilt) < 0.05 && !(soft && slow)) { S.impact = 2; S.lines = 1; } else { S.flash = 0.2; S.shake = 0.3; }
  if (k.cuts.length >= k.pieces - 1) {
    k.done = 1;
    setTimeout(() => finishKnife(false), 450);
  }
}

function finishKnife(abort) {
  const k = S?.knife;
  if (!k) return;
  S.knife = null;
  sendCmdSilent(abort ? `chopresolve ${k.row} ${k.nonce} abort` : `chopresolve ${k.row} ${k.nonce} ${k.crush} ${k.cuts.map(cutToken).join(' ')}`);
  sendCmdSilent('workspace');
  paintDom();
}

// A whole food's footprint cut to its portion: a half is the same food, half as long.
function pieceOf(m, c) {
  const whole = KS.piecesOf(m, []).whole, k = c.look?.portion ? Math.max(0.15, Math.min(1, c.look.portion)) : 1;
  return k === 1 ? whole : whole.map(([x, y]) => [x * k, y]);
}

function emit(m, c, p, dt) {
  const smoke = c.cook?.phase === 'burnt' || c.cook?.phase === 'over';
  const rate = smoke ? 3 : m.cook.emit.includes('steam') ? 1.4 : 0.5;
  if (Math.random() < dt * rate) {
    S.puffs.push({ p: [p[0] + (Math.random() - 0.5) * 6, p[1] + (Math.random() - 0.5) * 6, p[2] + 3], age: 0, life: 1.6,
      size: smoke ? 1.3 : 0.9, c: smoke ? M.rgb('#5c5650') : KS.COLOURS.steam });
  }
}

function sizzle(now) {
  const dial = dialOf(S.data), pan = panOf(S.data);
  if (!pan?.hot || !(dial?.level > 0) || !(pan.contents || []).some((c) => c.live)) return;
  if (now - S.lastSizzle < 900) return;
  S.lastSizzle = now;
  try {
    const def = window.SFXCatalog?.get('kitchen-sizzle');
    if (def) window.AudioEngine?.playSfx(def, 0.25 + dial.level * 0.06);
  } catch { /* no audio */ }
}

// Speed lines while the camera cuts or the pan is tossed: radial ink strokes round the edge.
function paintFx() {
  const c = S.fx, x = S.fxc, w = c.clientWidth, h = c.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  if (S.lines > 0.02) {
    x.strokeStyle = `rgba(20,16,24,${0.5 * S.lines})`;
    x.lineCap = 'round';
    const cx = w / 2, cy = h * 0.55, R0 = Math.min(w, h) * 0.42;
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + Math.sin(i * 7.3 + S.t * 30) * 0.03;
      const r0 = R0 * (1 + 0.15 * Math.sin(i * 3.1 + S.t * 50)), r1 = Math.hypot(w, h);
      x.lineWidth = 1 + (i % 3);
      x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); x.stroke();
    }
  }
  if (S.flash > 0.05) { x.fillStyle = `rgba(255,252,240,${S.flash * 0.6})`; x.fillRect(0, 0, w, h); }
}

// ── the DOM round the picture ────────────────────────────────────────────────────────────────────
function paintDom() {
  const d = S.data, pan = panOf(d), dial = dialOf(d), r = S.root;
  r.querySelector('.ks-tabs').innerHTML = ORDER.map((k) => `<button class="ks-tab${S.station === k ? ' on' : ''}" role="tab" aria-label="${LABEL[k][1]}" aria-selected="${S.station === k}" data-station="${k}"><span class="ks-kanji" aria-hidden="true">${LABEL[k][0]}</span><span class="ks-word">${LABEL[k][1]}</span></button>`).join('');
  // The beat line: what the pan is doing and what the ring is doing, in the server's words. On the
  // board mid-cut, the cut.
  const live = (pan?.contents || []).find((c) => c.live);
  const cutting = S.knife && S.station === 'board';
  const dressing = S.dress && S.station === 'pass';
  const beat = cutting ? [`${S.knife.name}, into ${S.knife.pieces}`, 'Even pieces cook together.']
    : dressing ? ['Lay it out on the plate.', `It's still on the heat${dial?.level ? '' : ', but the ring is off'}.`]
    : [live ?`${live.name}: ${live.state || ''}` : pan ? `${pan.name}, ${pan.place}` : 'No pan out.',
      dial ? `${dial.label}${dial.verdict?.text ? ` · ${dial.verdict.text}` : ''}` : ''].filter(Boolean);
  r.querySelector('.ks-beat').innerHTML = beat.map((s) => `<div>${esc(s)}</div>`).join('');
  r.querySelector('.ks-beat').dataset.state = dial?.verdict?.state || '';
  // The tray: what's on you, at the board.
  const tray = S.station === 'board' && !cutting ? foods() : [];
  r.querySelector('.ks-tray').innerHTML = tray.length
    ? `<span class="ks-label">On you</span>` + tray.map((c) => `<button class="ks-food${S.board === c.id ? ' on' : ''}" data-food="${esc(String(c.id))}">${esc(c.name)}${c.qty ? ` ×${c.qty}` : ''}</button>`).join('')
    : '';
  r.querySelector('.ks-chips').innerHTML = dressing
    ? `<button class="ks-chip ks-serve" data-dress="serve">Serve</button>`
      + (S.dress.wantsSauce ? `<button class="ks-chip${S.dress.sauce ? ' on' : ''}" data-dress="sauce" aria-pressed="${S.dress.sauce}">Sauce</button>` : '')
      + `<button class="ks-chip" data-dress="skip">Just plate it</button>`
    : (cutting ? [] : chipsFor(S.station)).map((a, i) => `<button class="ks-chip" data-chip="${i}" title="${esc(a.command)}${a.hint ? ` · ${esc(a.hint)}` : ''}">${esc(a.label)}</button>`).join('');
  r.querySelector('.ks-keys').textContent = cutting ? KEYS.knife : dressing ? KEYS.dress : KEYS[S.station];
}
const KEYS = {
  dress: 'Drag each piece onto the plate · Sauce, then drag across the plate for a line of it · Enter: serve · Esc: just plate it',
  knife: 'Drag down through the food to cut, or Space when the blue marker is on a red guide · Esc: put the knife down',
  board: 'Drag the food to the hob to put it in the pan · tap it for its prep · Tab: next station',
  hob: '0-9 or drag the knob: heat · F or flick the pan up: flip · S or circle: stir · T: taste · P or drag right: plate',
  pass: 'Tab: next station · Esc: close',
};

// The payload's own actions for this station, in the order a cook wants them.
function chipsFor(station) {
  const d = S.data, pan = panOf(d), out = [];
  if (station === 'board') {
    const food = S.board ? foods().find((c) => c.id === S.board) : null;
    for (const a of food?.actions || []) if (a.role === 'prep' || (a.role === 'stow' && pan && String(a.target) === String(pan.id)) || a.role === 'method' || a.role === 'pour') out.push(a);
  } else if (station === 'hob') {
    for (const a of pan?.actions || []) if (['water', 'method', 'start', 'taste', 'finish', 'clean'].includes(a.role)) out.push(a);
    for (const c of pan?.contents || []) { const h = actOf(c, 'handle'); if (h) out.push(h); }
    for (const a of pan?.contents?.flatMap((c) => c.actions || []).filter((a) => a.role === 'take') || []) out.push(a);
  } else {
    const fin = actOf(pan, 'finish');
    if (fin) out.push(fin);
  }
  S.chips = out;
  return out;
}

function onClick(e) {
  const t = e.target.closest('button');
  if (!t || !S) return;
  if (t.dataset.ks === 'close') return closeKitchenStage();
  if (t.dataset.ks === 'list') return toList();
  if (t.dataset.station) return go(t.dataset.station);
  if (t.dataset.food) { S.board = S.board === t.dataset.food ? null : t.dataset.food; ksfx('kitchen-tap'); return paintDom(); }
  if (t.dataset.dress && S.dress) {
    if (t.dataset.dress === 'serve') return serve(scoreDress());
    if (t.dataset.dress === 'skip') return serve(null);
    if (t.dataset.dress === 'sauce') { S.dress.sauce = !S.dress.sauce; return paintDom(); }
  }
  if (t.dataset.chip != null) {
    const a = S.chips?.[Number(t.dataset.chip)];
    if (a?.role === 'finish') return plateIt(a);
    run(a);
  }
}

function toList() {
  try { sessionStorage.setItem(LIST_KEY, '1'); } catch { /* private window */ }
  const d = S.data;
  closeKitchenStage({ quiet: true });
  sendCmdSilent('look');
  openWorkspacePanel(d);
}

function go(station) {
  if (!ORDER.includes(station) || station === S.station) return;
  S.station = station;
  ksfx('kitchen-taiko');
  paintDom();
}

// The pan to the pass. With food in it the server is asked to dress it first ('dressplate'); its
// answer opens the layout ('plating_game'), and serving sends the score and then the plate command.
function plateIt(a) {
  const pan = panOf(S.data);
  S.finish = a;
  go('pass');
  if (pan && (pan.contents || []).some((c) => c.look)) sendCmdSilent(`dressplate ${pan.id}`);
  else serve(null);
}

// ── dressing the plate ───────────────────────────────────────────────────────────────────────────
const PLATE_TOP = 2.6;
const DISH_SCALE = 0.6;
const SAUCE = M.rgb('#7a3b20');

export function kitchenDress(msg) {
  if (!S) return;
  const items = (msg.components || []).map((c, i) => {
    const m = matterFor(c.look?.profile, c.look?.matter), whole = footprint(m.form);
    const piece = pieceOf(m, c), area = Math.abs(polyArea(piece));
    return { id: c.id, m, whole, piece, beat: beatOf(c.cook, true), yaw: i * 0.7, placed: false, x: 0, y: 0, r: Math.sqrt(area / Math.PI) * DISH_SCALE };
  });
  const pour = items.find((it) => it.m.plate.stack === 'pool' || it.m.plate.sauce);
  S.dress = { vessel: msg.vessel, nonce: msg.nonce, wantsSauce: !!msg.sauce, items, line: [], sauce: false,
    sauceCol: pour ? M.rgb(pour.m.ramp[pour.beat] || pour.m.ramp.peak) : SAUCE };
  go('pass');
  paintDom();
}

function serve(score) {
  const a = S.finish, d = S.dress;
  S.finish = null;
  if (d) {
    sendCmdSilent(score == null ? `dressresolve ${d.vessel} ${d.nonce} abort` : `dressresolve ${d.vessel} ${d.nonce} ${score.toFixed(3)}`);
    // whatever wasn't laid out goes on in a heap in the middle
    d.items.forEach((it, i) => { if (!it.placed) Object.assign(it, { placed: true, x: Math.cos(i * 2.4) * 2, y: Math.sin(i * 2.4) * 2 }); });
    // keep the plate as laid out: the server's dish row has no look of its own
    S.dish = d.items; S.dishLine = d.line; S.dishSauce = d.sauceCol;
    S.dress = null;
  }
  if (a) run(a);
  ksfx('kitchen-clink');
  S.flash = 0.35;
  paintDom();
}

function scoreDress() {
  const d = S.dress;
  return presentation(d.items.filter((it) => it.placed), { plateR: KS.PLATE_R, sauce: d.line, wantsSauce: d.wantsSauce });
}

function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return a / 2;
}

// ── pointer and keys ─────────────────────────────────────────────────────────────────────────────
function screenOf(p) { return S.M ? toScreen(S.M, p) : null; }
function near(e, p, px) {
  const s = screenOf(p), r = S.gl.getBoundingClientRect();
  if (!s) return false;
  return Math.hypot(e.clientX - (r.left + s[0] * r.width), e.clientY - (r.top + s[1] * r.height)) < px;
}

function planeHit(e, h) {
  const r = S.gl.getBoundingClientRect();
  return S.M ? pickPlane(S.cam, S.M, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, h) : null;
}
const boardHit = (e) => planeHit(e, KS.BOARD.h);

function onDown(e) {
  // Not while the camera is still cutting to a station: the board would be picked through a moving lens.
  if (!S || performance.now() - S.tAt < 280) return;
  const pan = panOf(S.data), dial = dialOf(S.data);
  if (S.knife && S.station === 'board') {
    const h = boardHit(e);
    if (!h) return;
    S.drag = { kind: 'knife', a: h, b: h, t0: performance.now(), y0: e.clientY };
  } else if (S.dress && S.station === 'pass') {
    if (S.dress.sauce) { S.drag = { kind: 'sauce' }; S.dress.line = []; }
    else {
      const it = S.dress.items.find((q, i) => near(e, q.placed ? [KS.STATIONS.pass + q.x, q.y, PLATE_TOP] : [KS.STATIONS.pass - 16 + i * 8, 13, 1.3], 45));
      if (!it) return;
      S.drag = { kind: 'dish', it };
    }
  } else if (S.station === 'hob' && dial && near(e, KS.KNOB, 60)) {
    S.drag = { kind: 'knob', y0: e.clientY, l0: dial.level, level: dial.level };
  } else if (S.station === 'hob' && pan && near(e, [KS.STATIONS.hob, 0, KS.PAN_Z], 120)) {
    S.drag = { kind: 'pan', x0: e.clientX, y0: e.clientY, t0: performance.now(), ang: 0, last: null };
  } else if (S.station === 'board' && S.board && near(e, [KS.STATIONS.board, 0, KS.BOARD.h], 90)) {
    S.drag = { kind: 'food', x0: e.clientX, y0: e.clientY, at: [KS.STATIONS.board, 0, KS.BOARD.h + 3], moved: false };
  } else return;
  e.preventDefault();
  try { S.gl.setPointerCapture(e.pointerId); } catch { /* fine */ }
}

function onMove(e) {
  if (!S?.drag) return;
  const g = S.drag;
  if (g.kind === 'knife') {
    const h = boardHit(e);
    if (h) { g.b = h; if (S.knife) S.knife.blade = [h[0]]; }
  } else if (g.kind === 'dish' || g.kind === 'sauce') {
    const h = planeHit(e, PLATE_TOP);
    if (!h || !S.dress) return;
    const x = h[0] - KS.STATIONS.pass, y = h[1];
    if (g.kind === 'dish') Object.assign(g.it, { x, y, placed: true });
    else {
      // a blob every 0.7 cm along the stroke, however far the pointer jumped between events
      const line = S.dress.line, last = line[line.length - 1];
      if (!last) line.push({ x, y });
      else {
        const d = Math.hypot(x - last.x, y - last.y), n = Math.floor(d / 0.7);
        for (let i = 1; i <= n && line.length < 200; i++) line.push({ x: last.x + (x - last.x) * i / n, y: last.y + (y - last.y) * i / n });
      }
    }
  } else if (g.kind === 'knob') {
    const max = dialOf(S.data)?.ceiling ?? 10;
    const lv = Math.max(0, Math.min(max, Math.round(g.l0 + (g.y0 - e.clientY) / 18)));
    if (lv !== g.level) { g.level = lv; ksfx('kitchen-knob'); }
  } else if (g.kind === 'pan') {
    const r = S.gl.getBoundingClientRect(), c = screenOf([KS.STATIONS.hob, 0, KS.PAN_Z]);
    if (c) {
      const a = Math.atan2(e.clientY - (r.top + c[1] * r.height), e.clientX - (r.left + c[0] * r.width));
      if (g.last != null) { let da = a - g.last; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2; g.ang += da; }
      g.last = a;
    }
  } else if (g.kind === 'food') {
    const r = S.gl.getBoundingClientRect();
    const hit = pickPlane(S.cam, S.M, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, KS.BOARD.h);
    if (hit) { g.at = [hit[0], hit[1], KS.BOARD.h + 3]; g.moved = g.moved || Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 8; }
  }
}

function onUp(e) {
  if (!S?.drag) return;
  const g = S.drag, d = S.data;
  S.drag = null;
  if (g.kind === 'dish') {
    // off the plate is back on the slate
    if (Math.hypot(g.it.x, g.it.y) > KS.PLATE_R) g.it.placed = false; else ksfx('kitchen-tap');
  } else if (g.kind === 'knife') {
    // A stroke is a drag down the screen through the food, and its line on the board is the cut.
    if (S.knife) S.knife.blade = null;
    const dy = e.clientY - g.y0, dx = g.b[0] - g.a[0], dyb = g.b[1] - g.a[1];
    if (dy < 30 || Math.hypot(dx, dyb) < 3) return;
    // where the line crosses the food's axis (y = 0), as a fraction along it
    const mx = (g.a[0] + g.b[0]) / 2, my = (g.a[1] + g.b[1]) / 2;
    const xAtAxis = Math.abs(dyb) > 1e-3 ? mx - (my * dx) / dyb : mx;
    const slow = (performance.now() - g.t0) / dy > 4;      // more than 4 ms a pixel
    // tilt as knife.js measures it: 0 square across the food, positive leaning to +x away from you
    cutAt(alongFood(xAtAxis), Math.atan2(dx, -dyb), slow);
  } else if (g.kind === 'knob') {
    const dial = dialOf(d);
    if (dial && g.level !== dial.level) run(dial.levels[g.level]);
  } else if (g.kind === 'pan') {
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0, dt = performance.now() - g.t0;
    if (Math.abs(g.ang) > Math.PI * 1.5) return stir();
    if (dy < -50 && dt < 450 && Math.abs(dx) < Math.abs(dy)) return flip();
    if (dx > 140 && Math.abs(dy) < dx) { const fin = actOf(panOf(d), 'finish'); if (fin) plateIt(fin); }
  } else if (g.kind === 'food') {
    const food = foods().find((c) => c.id === S.board), pan = panOf(d);
    if (!g.moved) { const prep = actOf(food, 'prep', (a) => /^(chop|cut) /.test(a.command)); if (prep) { ksfx('kitchen-thock'); S.flash = 0.2; run(prep); } return; }
    if (g.at[0] > KS.STATIONS.board + KS.BOARD.w / 2 && pan) {
      const stow = actOf(food, 'stow', (a) => String(a.target) === String(pan.id));
      if (stow) { run(stow); ksfx('kitchen-tap'); S.board = null; go('hob'); }
    }
  }
}

function flip() {
  const pan = panOf(S.data);
  const live = (pan?.contents || []).find((c) => actOf(c, 'handle', (a) => a.command.startsWith('flip ')));
  const h = live && actOf(live, 'handle');
  toss();
  if (h) run(h);
}
function stir() {
  const pan = panOf(S.data);
  const live = (pan?.contents || []).find((c) => actOf(c, 'handle', (a) => a.command.startsWith('stir ')));
  const h = live && actOf(live, 'handle');
  swirl();
  if (h) run(h);
}

function onKey(e) {
  if (!S || !seatHoldsKeyboard() || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key, d = S.data, dial = dialOf(d), pan = panOf(d);
  let done = true;
  if (S.dress && k === 'Enter') serve(scoreDress());
  else if (S.dress && k === 'Escape') serve(null);
  else if (S.knife && k === ' ') cutAt(S.knife.sweep, 0, false);
  else if (S.knife && k === 'Escape') finishKnife(true);
  else if (k === 'Escape') closeKitchenStage();
  else if (k === 'Tab' || k === 'ArrowRight') go(ORDER[(ORDER.indexOf(S.station) + (e.shiftKey ? 2 : 1)) % 3]);
  else if (k === 'ArrowLeft') go(ORDER[(ORDER.indexOf(S.station) + 2) % 3]);
  else if (/^[0-9]$/.test(k) && dial) { const n = Math.min(Number(k), dial.ceiling ?? 10); if (n !== dial.level) { ksfx('kitchen-knob'); run(dial.levels[n]); } }
  else if (k === 'f' || k === 'F') flip();
  else if (k === 's' || k === 'S') stir();
  else if (k === 't' || k === 'T') run(actOf(pan, 'taste'));
  else if (k === 'p' || k === 'P') { const fin = actOf(pan, 'finish'); if (fin) plateIt(fin); }
  else if (k === 'l' || k === 'L') toList();
  else done = false;
  if (done) e.preventDefault();
}

function ksfx(id) {
  try { const def = window.SFXCatalog?.get(id); if (def) window.AudioEngine?.playSfx(def); } catch { /* no audio */ }
}
function hash(s) {
  let x = 0x811c9dc5 >>> 0;
  for (const ch of String(s)) x = Math.imul(x ^ ch.charCodeAt(0), 16777619) >>> 0;
  return x / 4294967296;
}
function ensureStyles() {
  if (document.getElementById('ks-styles')) return;
  const st = document.createElement('style');
  st.id = 'ks-styles';
  st.textContent = STAGE_CSS;
  document.head.appendChild(st);
}

// For the harness and the smoke checks only.
export const _test = { state: () => S };
