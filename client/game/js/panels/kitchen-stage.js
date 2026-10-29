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

import { sendCmdQuiet, sendCmdSilent } from '../net.js';
import { setAreaPane } from '../render.js';
import { escapeHtml as esc, loadCss } from '../../../shared/dom.js';
import { claimSeatKeyboard, endSeatKeyboard, seatHoldsKeyboard } from './seat-keys.js';
import { openWorkspacePanel } from './workspace.js';
import * as M from './gl/arena-mesh.js';
import * as KS from './gl/kitchen-mesh.js';
import { createKitchenRenderer, pickPlane, toScreen } from './gl/kitchen.js';
import { matterFor, beatOf } from '../../../shared/kitchen-matter.js';
import * as Lq from './gl/kitchen-liquid.js';
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
const LABEL = { board: 'Board', hob: 'Hob', pass: 'Pass' };
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
        <span class="ks-boxes"></span>
        <button class="ks-btn" data-ks="stock" title="Have food and kit delivered">Stock up</button>
        <button class="ks-btn" data-ks="list" title="The workspace list (L)">List</button>
        <button class="ks-btn" data-ks="close" aria-label="Close" title="Close (Esc)">✕</button>
      </div>
    </div>
    <div class="ks-beat" aria-live="polite"></div>
    <div class="ks-say" aria-live="polite"></div>
    <div class="ks-mix" hidden></div>
    <div class="ks-tray"></div>
    <div class="ks-chips"></div>
    <div class="ks-keys"></div>
    <div class="ks-rack"></div>
    <div class="ks-cold-bar" hidden></div>
    <div class="ks-tip" hidden></div>
    <div class="ks-menu" role="menu" hidden></div>
    <div class="ks-sheet" hidden></div>
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
    lastSizzle: 0, tick: null, raf: 0, drag: null, M: null, sent: 0, orbit: { yaw: 0, pitch: 0 }, menu: null, sheet: null, liq: null, spoon: null, lastStir: 0,
    cold: null, coldShots: [], vesselId: null, tool: 'hand', hover: null, liqByPan: new Map(),
  };
  root.addEventListener('click', onClick);
  gl.addEventListener('pointerdown', onDown);
  gl.addEventListener('auxclick', (e) => e.preventDefault());
  gl.addEventListener('contextmenu', (e) => e.preventDefault());
  gl.addEventListener('wheel', onWheel, { passive: false });
  gl.addEventListener('pointerleave', () => { if (S) { S.hover = null; hideTip(); } });
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
  syncLiquid();
  if (S.board && !foods().some((c) => c.id === S.board)) { S.board = null; S.boardBody = null; }
  // taken out of the fridge with Shift: onto the board once it's on you
  if (S.pendingBoard && !S.knife) {
    const p = S.pendingBoard, got = foods().find((c) => String(c.id) === p.id) || foods().find((c) => c.name === p.name);
    if (got) { S.board = got.id; S.pendingBoard = null; }
  }
  if (S.vesselId != null && !vesselsOf(data).some((v) => String(v.id) === String(S.vesselId))) S.vesselId = null;
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
// Every pan out in the kitchen (not one shut in a cupboard), the hot one first.
const vesselsOf = (d) => (d?.area || []).filter((v) => v.look?.vessel && v.look.vessel !== 'bread' && !v.idle && !/^in the /.test(v.place || ''));
// The pan you're working with: the one you picked, else the one on the heat, else the first.
function panOf(d) {
  const vs = vesselsOf(d);
  return vs.find((v) => S && String(v.id) === String(S.vesselId)) || vs.find((v) => v.hot) || vs[0] || null;
}
function dialOf(d) {
  const ds = d?.dials || [], pan = vesselsOf(d).find((v) => v.hot) || panOf(d);
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
  if (a.role === 'taste') startTaste();
  sendCmdQuiet(a.command);
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
      S.bodies.set(c.id, { p: [Math.cos(a) * r, Math.sin(a) * r, 30], v: [0, 0, 0], yaw: a * 2, roll: 0, vr: 0, seed: (hash(c.id) * 1e6) | 0, melt: 0 });
    }
  }
  for (const id of [...S.bodies.keys()]) if (!keep.has(id)) S.bodies.delete(id);
}

function step(dt) {
  const pan = panOf(S.data);
  if (!pan) return;
  const R = KS.vesselSpec(pan.look.vessel).r - 2.5;
  const bodies = [...S.bodies.values()];
  const L = S.liq?.L, wet = !!L?.filled, level = pan.hot ? dialOf(S.data)?.level || 0 : 0;
  if (L) Lq.step(L, dt);
  // In liquid a piece sits half under the surface and goes where the liquid goes.
  const floor = wet ? liquidDepth(pan) * 0.45 : 0;
  for (const [id, b] of S.bodies) {
    const c = (pan.contents || []).find((x) => x.id === id);
    const m = c?.look && matterFor(c.look.profile, c.look.matter);
    if (m && meltsOf(m) && level > 0 && b.melt < 1) {
      b.melt = Math.min(1, b.melt + dt * level * 0.012);
      // the first of it to go becomes a pool of its own colour, where the piece is
      if (b.melt > 0.12 && L) Lq.pour(L, `melt:${id}`, M.rgb(m.ramp.peak || m.ramp.raw), [b.p[0], b.p[1]]);
    }
  }
  for (const b of bodies) {
    b.v[2] += G * dt;
    if (wet && b.p[2] <= floor + 0.5) {
      const [fx, fy] = Lq.flowAt(L, b.p[0], b.p[1]), k = Math.min(1, dt * 4);
      b.v[0] += (fx - b.v[0]) * k; b.v[1] += (fy - b.v[1]) * k;
    }
    for (let i = 0; i < 3; i++) b.p[i] += b.v[i] * dt;
    b.roll += b.vr * dt;
    if (b.p[2] <= floor) {
      b.p[2] = floor;
      if (b.v[2] < -40) b.v[2] *= wet ? 0 : -0.2; else b.v[2] = 0;
      if (!wet) { b.v[0] *= 0.86; b.v[1] *= 0.86; }
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
  if (level > 0) agitate(pan, bodies, wet, floor, level, dt);
  // pieces push each other apart on the floor
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j], dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], d = Math.hypot(dx, dy) || 1e-3;
    if (d < 5) { const k = (5 - d) * 0.25; a.p[0] -= dx / d * k; a.p[1] -= dy / d * k; b.p[0] += dx / d * k; b.p[1] += dy / d * k; }
  }
}

// Food on a lit ring moves the way it would: in a dry pan it trembles and skips as it sizzles, and
// in its window (the server's phase) it sizzles harder; in liquid at a rolling boil it tumbles.
// It's set by the dial and the phase only, so it never speeds up as a beat comes: no countdown.
const SPECK = M.rgb('#f1e2b4');
function agitate(pan, bodies, wet, floor, level, dt) {
  const k = level / 10;
  for (const [id, b] of S.bodies) {
    if (b.p[2] > floor + 0.05) continue;
    const c = (pan.contents || []).find((x) => x.id === id);
    const m = c?.look && matterFor(c.look.profile, c.look.matter);
    if (!m || liquidish(m)) continue;
    const hot = c.cook?.phase === 'window' ? 1.7 : 1;
    if (wet) {
      if (level >= 6 && Math.random() < dt * (level - 4) * 0.9) {
        b.v[2] += 22 + Math.random() * 30 * k;
        b.v[0] += (Math.random() - 0.5) * 18; b.v[1] += (Math.random() - 0.5) * 18;
        b.vr += (Math.random() - 0.5) * 9;
      }
    } else if (Math.random() < dt * 4 * k * hot) {
      b.v[2] += 5 + Math.random() * 9 * k * hot;
      b.v[0] += (Math.random() - 0.5) * 7 * k; b.v[1] += (Math.random() - 0.5) * 7 * k;
    }
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
  const L = S.liq?.L;
  if (L) for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, r = L.R * 0.55;
    Lq.stirAt(L, Math.cos(a) * r, Math.sin(a) * r, -Math.sin(a) * 45, Math.cos(a) * 45, 4);
  }
  for (const b of S.bodies.values()) {
    const r = Math.hypot(b.p[0], b.p[1]) || 1;
    b.v[0] += (-b.p[1] / r) * 40; b.v[1] += (b.p[0] / r) * 40; b.v[2] += 20;
  }
}

// ── the liquid in the pan ───────────────────────────────────────────────────────────────────────
// gl/kitchen-liquid.js runs it; this keeps it in step with the payload. Each liquid in the pan
// pours in once, in its beat's colour; a beat that changes a liquid's colour shifts the whole pan by
// its share, so the colour still moves only on the server's beat. Butter and cheese pour in as they
// melt (step). The depth is how much liquid there is, held under the pan's rim.
const liquidish = (m) => m.form.kind === 'liquid';
const meltsOf = (m) => m.form.kind !== 'liquid' && (m.cook.browning === 'melt' || m.plate.stack === 'pool');

// How far each beat has taken a liquid towards a reduced sauce, and starch water towards cloudy.
const THICK_AT = { raw: 0, cook: 0.3, peak: 0.6, over: 0.85, burnt: 1 };
const CLOUD_AT = { raw: 0, cook: 0.25, peak: 0.45, over: 0.55, burnt: 0.55 };
const STARCH = M.rgb('#ece6d6');

function syncLiquid() {
  const pan = panOf(S.data), spec = pan && KS.vesselSpec(pan.look.vessel);
  if (!pan || !spec || spec.wall <= 0) { S.liq = null; return; }
  // each pan keeps its own liquid, so switching pans and back doesn't unmix the sauce
  if (S.liq?.panId !== pan.id) {
    S.liq = S.liqByPan.get(pan.id) || { panId: pan.id, L: Lq.createLiquid(spec.r * (spec.taper || 0.85) * 0.98), col: new Map() };
    S.liqByPan.set(pan.id, S.liq);
  }
  const { L, col } = S.liq, here = new Set();
  let thick = 0, cloud = 0;
  for (const c of pan.contents || []) {
    if (!c.look) continue;
    const m = matterFor(c.look.profile, c.look.matter), beat = beatOf(c.cook, c.state === 'cooked');
    // starch in the water clouds it as it cooks
    if (m.form.kind === 'grain') cloud = Math.max(cloud, CLOUD_AT[beat] || 0);
    if (!liquidish(m)) continue;
    here.add(c.id);
    thick = Math.max(thick, THICK_AT[beat] || 0);
    const rgb = M.rgb(m.ramp[beat] || m.ramp.raw);
    if (Lq.pour(L, c.id, rgb)) { col.set(c.id, rgb); continue; }
    const was = col.get(c.id);
    if (was && was !== rgb) {
      const share = 1 / Math.max(1, L.sources.size);
      for (let ch = 0; ch < 3; ch++) { const d = (rgb[ch] - was[ch]) * share; for (let k = 0; k < L.c[ch].length; k++) L.c[ch][k] += d; }
      col.set(c.id, rgb);
    }
  }
  L.thick = thick;
  L.cloud = cloud > 0 ? { rgb: STARCH, k: cloud } : null;
  for (const id of [...L.sources.keys()]) {
    const melted = id.startsWith('melt:') && S.bodies.has(id.slice(5));
    if (!here.has(id) && !melted) { Lq.drain(L, id); col.delete(id); }
  }
}

function liquidDepth(pan) {
  const spec = KS.vesselSpec(pan.look.vessel), L = S.liq?.L;
  if (!L?.filled) return 0;
  let n = 0;
  for (const id of L.sources.keys()) n += id.startsWith('melt:') ? 0.35 * (S.bodies.get(id.slice(5))?.melt || 0) : 1;
  // a reducing sauce sinks down the pan as it thickens
  return Math.min(spec.wall * 0.7, (0.6 + n * 1.4) * (1 - 0.45 * L.thick));
}

// ── the frame ────────────────────────────────────────────────────────────────────────────────────
function frame(now) {
  if (!S) return;
  const dt = Math.min(0.1, (now - S.last) / 1000);
  S.last = now; S.lastDt = dt; S.t += dt; S.acc += dt;
  while (S.acc >= STEP) { step(STEP); S.acc -= STEP; }
  moveCamera(now);
  stepCold(dt);
  stepFog(dt);
  S.flash =Math.max(0, S.flash - dt * 4);
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
  paintMix();
  sizzle(now);
  S.raf = requestAnimationFrame(frame);
}

// How mixed the pan is, once there are two liquids in it to mix.
function paintMix() {
  const el = S.root.querySelector('.ks-mix'), L = S.liq?.L;
  if (!L || L.sources.size < 2) { el.hidden = true; return; }
  if ((S.mixTick = (S.mixTick || 0) + 1) % 8) return;
  const e = Lq.evenness(L);
  el.hidden = false;
  el.textContent = e > 0.92 ? 'Mixed through' : `Mixed ${Math.round(e * 100)}%`;
  el.dataset.done = e > 0.92 ? '1' : '';
}

function moveCamera(now) {
  const want = S.cold ? 'cold' : S.station === 'hob' && windowOpen() ? 'push' : S.station;
  const target = S.cold ? coldShot(S.cold.i) : SHOTS[want];
  if (S.to !== target) { S.from = { ...S.cam }; S.to = target; S.tAt = now; }
  const k = Math.min(1, (now - S.tAt) / 260), e = k * k * (3 - 2 * k);
  const L = (a, b) => a + (b - a) * e, V3 = (a, b) => [L(a[0], b[0]), L(a[1], b[1]), L(a[2], b[2])];
  // A tall screen (a phone held upright) keeps the shot's width by opening the lens.
  const aspect = (S.gl.clientWidth || 1) / (S.gl.clientHeight || 1), fov = L(S.from.fov, S.to.fov);
  const wide = aspect < 1.3 ? Math.min(1.5, 2 * Math.atan(Math.tan(fov / 2) * 1.3 / aspect)) : fov;
  const eye = V3(S.from.eye, S.to.eye), at = V3(S.from.at, S.to.at);
  S.cam = { eye: orbitEye(eye, at), at, fov: wide, roll: L(S.from.roll, S.to.roll) };
  if (k < 1 && want !== 'push') S.lines = Math.max(S.lines, 0.6);
}

// Middle-drag looks round: the shot's eye swung round its target by the look offset, which holds
// where it was left (it's a delta, not a position).
function orbitEye(eye, at) {
  const v = [eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]], r = Math.hypot(...v);
  const az = Math.atan2(v[1], v[0]) + S.orbit.yaw;
  const el = Math.max(0.12, Math.min(1.45, Math.asin(v[2] / r) + S.orbit.pitch));
  return [at[0] + r * Math.cos(el) * Math.cos(az), at[1] + r * Math.cos(el) * Math.sin(az), at[2] + r * Math.sin(el)];
}

function build(dt) {
  const b = M.reset(S.dyn), d = S.data, pan = panOf(d), dial = dialOf(d);
  const level = S.wheel ? S.wheel.level : dial?.level || 0;
  const onHeat = !!pan?.hot, ringBusy = vesselsOf(d).some((v) => v.hot);
  KS.knob(b, level, KS.KNOB, KS.knobBase(S.hobKind));
  buildElement(b, level, dial?.ceiling ?? 10);
  embers(b, level, dial?.ceiling ?? 10, dt);
  buildFog(b);
  if (ringBusy || level > 0) KS.flames(b, ringBusy ? level : 0, S.t, KS.BURNER, KS.PAN_Z - 0.2);
  buildOtherPans(b);
  // the pan you're working with: on the ring, or on the rack beside it
  if (pan) {
    const at = PAN_AT(pan);
    at[2] += hopZ(pan.id);
    const P = KS.pose(at, 0);
    KS.vessel(b, pan.look.vessel, P);
    if (vesselsOf(d).length > 1) KS.ring(b, [0, 0, 0.4], KS.vesselSpec(pan.look.vessel).r + 2.4, 0.55 + 0.15 * Math.sin(S.t * 5), PICKED, 28, P);
    const L = S.liq?.L, depth = liquidDepth(pan);
    let oily = false;
    for (const c of pan.contents || []) {
      const body = S.bodies.get(c.id);
      if (!body || !c.look) continue;
      const m = matterFor(c.look.profile, c.look.matter), beat = beatOf(c.cook, c.state === 'cooked');
      const p = [at[0] + body.p[0], at[1] + body.p[1], at[2] + 1 + body.p[2]];
      if (onHeat && level > 0 && !S.liq?.L?.filled) p[2] += Math.sin(S.t * 47 + body.seed) * 0.07 * (level / 10) * (c.cook?.phase === 'window' ? 1.8 : 1);
      if (onHeat && level > 0) emit(m, c, p, dt);
      if (m.plate.stack === 'pool' && (m.cook.gloss || 0) > 0.8) oily = true;
      // a liquid is the surface below, not a piece; a melting one shrinks into it
      if (L && liquidish(m)) continue;
      const k = 1 - 0.85 * (body.melt || 0);
      if (k < 0.18) continue;
      // an egg in a dry pan is cracked into it; in water it boils in its shell
      if (c.look.profile === 'egg' && m.form.kind === 'sphere' && !L?.filled) KS.eggCracked(b, m, beat, KS.pose(p, body.yaw), body.seed);
      else KS.foodPiece(b, m, pieceOf(m, c), KS.piecesOf(m, []).whole, beat, KS.pose(p, body.yaw, body.roll, k), body.seed);
    }
    if (L?.filled) Lq.drawLiquid(M, b, L, KS.pose([at[0], at[1], at[2] + 0.6]), depth, oily ? 0.9 : 0.35 + 0.5 * L.thick);
    if (L?.filled && onHeat && level >= 4 && Math.random() < dt * level) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * L.R * 0.8;
      S.bubbles.push({ p: [at[0] + Math.cos(a) * r, at[1] + Math.sin(a) * r, at[2] + 0.6 + depth + 0.3], age: 0 });
    }
    // the spoon, while you stir
    if (S.drag?.kind === 'pan' && S.spoon && L?.filled) {
      const sp = [at[0] + S.spoon[0], at[1] + S.spoon[1], at[2] + 0.6 + depth * 0.5];
      M.ellipsoid(b, sp, [1, 0, 0], [0, 1, 0], [0, 0, 1], [1.6, 1.1, 0.5], KS.COLOURS.handle, 8, 5);
      M.tube(b, sp, [sp[0] + 3, sp[1] - 7, sp[2] + 18], 0.45, 0.55, KS.COLOURS.handle, 6);
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
  // what's on you, laid out along the back of the counter
  for (const [i, c] of shelf().entries()) {
    const m = matterFor(c.look.profile, c.look.matter);
    KS.shelfPiece(b, m, pieceOf(m, c), KS.piecesOf(m, []).whole, beatOf(c.cook), KS.pose(shelfSpot(i), 0.3 * i), 11 + i);
  }
  if (!S.knife && kit().blade) KS.knife(b, KS.pose([KS.STATIONS.board + 4, 10.5, KS.BOARD.h + 0.1], -0.2, Math.PI / 2));
  // the pass: a plate, with what is being laid out on it or the last dish served
  if (kit().plate) KS.plate(b, KS.pose([KS.STATIONS.pass, 0, 1.2]));
  // the fridge and freezer, standing at the left end of the counter
  buildTaste(b);
  buildBoxes(b, dt);
  buildTool(b);
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
  S.specks = (S.specks || []).filter((q) => (q.age += dt * 2.2) < 1 && q.p[2] > -1);
  for (const q of S.specks) {
    q.v[2] += G * 0.25 * dt;
    for (let i = 0; i < 3; i++) q.p[i] += q.v[i] * dt;
    M.sphere(b, q.p, 0.28, q.col, 5, 3);
  }
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
  const spits = (m.cook.emit || []).some((x) => x === 'spatter' || x === 'sizzle'), level = dialOf(S.data)?.level || 0;
  if (spits && !S.liq?.L?.filled && Math.random() < dt * level * (c.cook?.phase === 'window' ? 0.9 : 0.45)) {
    const a = Math.random() * Math.PI * 2, sp = 25 + Math.random() * 30;
    (S.specks ||= []).push({ p: [p[0], p[1], p[2] + 1.5], v: [Math.cos(a) * sp, Math.sin(a) * sp, 30 + Math.random() * 40], age: 0, col: SPECK });
  }
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
  paintPolish(x, w, h, S.lastDt || 0.016);
  if (S.flash > 0.05) { x.fillStyle = `rgba(255,252,240,${S.flash * 0.6})`; x.fillRect(0, 0, w, h); }
}

// ── the DOM round the picture ────────────────────────────────────────────────────────────────────
function paintDom() {
  const d = S.data, pan = panOf(d), dial = dialOf(d), r = S.root;
  r.querySelector('.ks-tabs').innerHTML = ORDER.map((k) => `<button class="ks-tab${S.station === k ? ' on' : ''}" role="tab" aria-selected="${S.station === k}" data-station="${k}">${LABEL[k]}</button>`).join('');
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
  const tray = [];
  r.querySelector('.ks-tray').innerHTML = tray.length
    ? `<span class="ks-label">On you</span>` + tray.map((c) => `<button class="ks-food${S.board === c.id ? ' on' : ''}" data-food="${esc(String(c.id))}">${esc(c.name)}${c.qty ? ` ×${c.qty}` : ''}</button>`).join('')
    : '';
  r.querySelector('.ks-chips').innerHTML = dressing
    ? `<button class="ks-chip ks-serve" data-dress="serve">Serve</button>`
      + (S.dress.wantsSauce ? `<button class="ks-chip${S.dress.sauce ? ' on' : ''}" data-dress="sauce" aria-pressed="${S.dress.sauce}">Sauce</button>` : '')
      + `<button class="ks-chip" data-dress="skip">Just plate it</button>`
    : [].map((a, i) => `<button class="ks-chip" data-chip="${i}" title="${esc(a.command)}${a.hint ? ` · ${esc(a.hint)}` : ''}">${esc(a.label)}</button>`).join('');
  r.querySelector('.ks-keys').textContent = S.cold ? KEYS.cold : cutting ? KEYS.knife : dressing ? KEYS.dress : KEYS[S.station];
  r.querySelector('.ks-boxes').innerHTML = coldBoxes().map((x) => `<button class="ks-btn${S.cold && String(S.cold.id) === String(x.id) ? ' on' : ''}" data-box="${esc(String(x.id))}" title="${esc(boxLabel(x))} (O)">${esc(boxLabel(x))}</button>`).join('');
  r.classList.toggle('ks-in-cold', !!S.cold);
  paintRack();
  paintColdBar();
  paintSheet();
}
const KEYS = {
  dress: 'Drag each piece onto the plate · Sauce, then drag across the plate for a line of it · Enter: serve · Esc: just plate it',
  knife: 'Drag down through the food to cut, or Space when the blue marker is on a red guide · Esc: put the knife down',
  cold: 'Click something to take it out · Shift-click: straight onto the board · click the door rack to put things in · arrows and Enter · Esc: shut it',
  board: 'Click anything to use it · drag food onto a pan · Q/E: utensil · O: fridge · middle button: look',
  hob: 'Drag the knob: heat · spoon: drag round the pan · spatula: click or flick the pan · [ ]: change pan · Q/E: utensil · O: fridge',
  pass: 'Click the plate to serve · hold the middle button to look round',
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
  if (t.dataset.menu != null) { const it = S.menu?.[Number(t.dataset.menu)]; closeMenu(); it?.fn?.(); return; }
  if (t.dataset.ks === 'close') return closeKitchenStage();
  if (t.dataset.ks === 'list') return toList();
  if (t.dataset.ks === 'stock') { sendCmdSilent('kitchenstock'); return; }
  if (t.dataset.box) return S.cold && String(S.cold.id) === t.dataset.box ? shutCold() : openCold(t.dataset.box);
  if (t.dataset.cold === 'shut') return shutCold();
  if (t.dataset.cold === 'board') { if (S.cold) S.cold.toBoard = !S.cold.toBoard; return paintColdBar(); }
  if (t.dataset.pan) return pickPan(t.dataset.pan, e);
  if (t.dataset.tool) return setTool(t.dataset.tool);
  if (t.dataset.sheet === 'close') return closeSheet();
  if (t.dataset.shelf && S.sheet?.kind === 'stock') { S.sheet.shelf = t.dataset.shelf; return paintSheet(); }
  if (t.dataset.buy) { sendCmdQuiet(`kitchenorder ${t.dataset.buy} 1`); sendCmdSilent('workspace'); sendCmdSilent('kitchenstock'); ksfx('kitchen-clink'); return; }
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
  if (!S) return;
  if (e.button === 1) {
    e.preventDefault();
    S.drag = { kind: 'look', x: e.clientX, y: e.clientY };
    try { S.gl.setPointerCapture(e.pointerId); } catch { /* fine */ }
    return;
  }
  if (e.button !== 0 || performance.now() - S.tAt < 280) return;
  closeMenu();
  if (S.cold) { e.preventDefault(); return coldClick(e); }
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
    S.drag = { kind: 'knob', x0: e.clientX, y0: e.clientY, l0: dial.level, level: dial.level };
  } else if (S.station === 'hob' && pan && near(e, PAN_AT(pan), 120) && otherPanAt(e) == null) {
    S.drag = { kind: 'pan', x0: e.clientX, y0: e.clientY, t0: performance.now(), ang: 0, last: null };
  } else if (S.station === 'board' && S.board && near(e, [KS.STATIONS.board, 0, KS.BOARD.h], 90)) {
    S.drag = { kind: 'food', x0: e.clientX, y0: e.clientY, at: [KS.STATIONS.board, 0, KS.BOARD.h + 3], moved: false };
  } else {
    const hit = hitObject(e);
    if (!hit) return;
    S.drag = { kind: 'tap', hit, x0: e.clientX, y0: e.clientY };
  }
  e.preventDefault();
  try { S.gl.setPointerCapture(e.pointerId); } catch { /* fine */ }
}

function onMove(e) {
  if (!S) return;
  if (!S.drag) return hoverAt(e);
  const g = S.drag;
  if (g.kind === 'cold') {
    const h = planeHit(e, g.z);
    if (h) g.at = [h[0], h[1], g.z + 3];
    g.moved = g.moved || Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 8;
    return;
  }
  if (g.kind === 'look') {
    S.orbit.yaw -= (e.clientX - g.x) * 0.006;
    S.orbit.pitch = Math.max(-0.9, Math.min(0.9, S.orbit.pitch + (e.clientY - g.y) * 0.004));
    g.x = e.clientX; g.y = e.clientY;
  } else if (g.kind === 'knife') {
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
    const pan = panOf(S.data), at = PAN_AT(pan);
    const r = S.gl.getBoundingClientRect(), c = screenOf(at);
    if (c) {
      const a = Math.atan2(e.clientY - (r.top + c[1] * r.height), e.clientX - (r.left + c[0] * r.width));
      if (g.last != null) { let da = a - g.last; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2; g.ang += da; }
      g.last = a;
    }
    // The spoon is where the pointer meets the liquid, and it pushes the liquid the way it moves.
    const L = S.liq?.L;
    if (L?.filled && pan) {
      const h = planeHit(e, at[2] + 0.6 + liquidDepth(pan)), now = performance.now();
      if (h) {
        const x = h[0] - at[0], y = h[1] - at[1], rr = Math.hypot(x, y), lim = L.R * 0.92;
        const sp = rr > lim ? [x / rr * lim, y / rr * lim] : [x, y];
        if (S.spoon && g.tMove) {
          const dts = Math.max(0.008, (now - g.tMove) / 1000), cap = 120;
          const vx = Math.max(-cap, Math.min(cap, (sp[0] - S.spoon[0]) / dts)), vy = Math.max(-cap, Math.min(cap, (sp[1] - S.spoon[1]) / dts));
          Lq.stirAt(L, sp[0], sp[1], vx * 0.5, vy * 0.5);
        }
        S.spoon = sp; g.tMove = now;
      }
      // every full turn of the spoon is a stir the server hears, no faster than one a second
      g.turns ||= 0;
      if (Math.abs(g.ang) >= (g.turns + 1) * Math.PI * 2) {
        g.turns++;
        if (now - S.lastStir > 1000) { S.lastStir = now; stirCommand(); }
      }
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
  const still = g.x0 != null && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 6;
  if (g.kind === 'cold') return dropCold(g);
  if (g.kind === 'tap') {
    if (!still) return;
    if (g.hit.kind === 'pan' && g.hit.id) return pickPan(g.hit.id);
    if (g.hit.kind === 'box') return openCold(g.hit.id);
    openMenu(menuFor(g.hit), e);
    return;
  }
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
    if (still) return openMenu(menuFor({ kind: 'knob' }), e);
    if (dial && g.level !== dial.level) run(dial.levels[g.level]);
  } else if (g.kind === 'pan') {
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0, dt = performance.now() - g.t0;
    S.spoon = null;
    if (still) return S.tool === 'spatula' ? flip() : openMenu(menuFor({ kind: 'pan' }), e);
    if (g.turns) return;                       // stirred as it went round
    // a utensil in hand means one thing: the spoon stirs, the spatula flips
    if (S.tool === 'spoon') { if (Math.abs(g.ang) > Math.PI) stir(); return; }
    if (S.tool === 'spatula') { if (dy < -30) flip(); return; }
    if (Math.abs(g.ang) > Math.PI * 1.5) return stir();
    if (dy < -50 && dt < 450 && Math.abs(dx) < Math.abs(dy)) return flip();
    if (dx > 140 && Math.abs(dy) < dx) { const fin = actOf(panOf(d), 'finish'); if (fin) plateIt(fin); }
  } else if (g.kind === 'food') {
    const food = foods().find((c) => c.id === S.board), pan = panOf(d);
    if (!g.moved) {
      const chop = chopOf(food);
      if (S.tool === 'knife' && chop && kit().blade) return pickKnife(chop);
      return openMenu(menuFor({ kind: 'board' }), e);
    }
    // dropped on a pan goes in that pan; anywhere else off the board goes in the one you're using
    const into = panNear(g.at) || (g.at[0] > KS.STATIONS.board + KS.BOARD.w / 2 ? pan : null);
    if (into) {
      const stow = actOf(food, 'stow', (a) => String(a.target) === String(into.id));
      if (stow) { S.vesselId = into.id; run(stow); ksfx('kitchen-tap'); S.board = null; go('hob'); }
    }
  }
}

// ── things you can click ─────────────────────────────────────────────────────────────────────────
// Every food on you that isn't on the board, along the back of the counter behind it.
const shelf = () => foods().filter((c) => c.id !== S.board || S.knife);
const shelfSpot = (i) => [KS.STATIONS.board - 30 + (i % 8) * 9, 22 + Math.floor(i / 8) * 9, 0];
const KNIFE_AT = () => [KS.STATIONS.board + 4, 10.5, KS.BOARD.h];
const PLATE_AT = () => [KS.STATIONS.pass, 0, 1.2];
// The pan on the heat sits on the ring; the rest wait on the rack: the spare rings behind, then
// the counter to the right of the hob.
const RACK = [[17, 21, 3.6], [-17, 21, 3.6], [24, -4, 0], [-26, -6, 0]];
function PAN_AT(pan) {
  if (!pan) return [KS.STATIONS.hob, 0, KS.PAN_Z];
  if (pan.hot) return [KS.STATIONS.hob, 0, KS.PAN_Z];
  const cold = vesselsOf(S.data).filter((v) => !v.hot), i = Math.max(0, cold.findIndex((v) => String(v.id) === String(pan.id)));
  const r = RACK[i % RACK.length], camp = S.hobKind === 'camp';
  return [KS.STATIONS.hob + r[0], r[1], camp ? 0 : r[2]];
}
// A pan that isn't the one you're using, under the pointer.
function otherPanAt(e) {
  const pan = panOf(S.data);
  for (const v of vesselsOf(S.data)) if (v !== pan && near(e, PAN_AT(v), 55)) return v;
  return null;
}
// The pan a dragged food was let go over, in the counter's plane.
function panNear(at) {
  let best = null, bd = Infinity;
  for (const v of vesselsOf(S.data)) {
    const p = PAN_AT(v), d = Math.hypot(at[0] - p[0], at[1] - p[1]);
    if (d < KS.vesselSpec(v.look.vessel).r + 6 && d < bd) { best = v; bd = d; }
  }
  return best;
}

function hitObject(e) {
  const pan = panOf(S.data), items = shelf();
  for (let i = 0; i < items.length; i++) if (near(e, shelfSpot(i), 26)) return { kind: 'shelf', id: items[i].id };
  if (!S.knife && kit().blade && near(e, KNIFE_AT(), 40)) return { kind: 'knife' };
  for (const [i, box] of coldBoxes().entries()) if (near(e, boxFront(i), 110)) return { kind: 'box', id: box.id };
  const other = otherPanAt(e);
  if (other) return { kind: 'pan', id: other.id };
  if (dialOf(S.data) && near(e, KS.KNOB, 50)) return { kind: 'knob' };
  if (pan && near(e, PAN_AT(pan), 100)) return { kind: 'pan' };
  if (near(e, PLATE_AT(), 70)) return { kind: 'plate' };
  if (S.board && near(e, BOARD_AT(), 90)) return { kind: 'board' };
  return null;
}

// A food's own actions as menu items. 'stow' only into the pan on the stove; a cut goes through
// the knife, so it's offered as picking the knife up.
function foodItems(c) {
  const pan = panOf(S.data), out = [];
  for (const a of c?.actions || []) {
    if (!['prep', 'stow', 'method', 'pour'].includes(a.role)) continue;
    if (a.role === 'stow' && !(pan && String(a.target) === String(pan.id))) continue;
    if (a.role === 'prep' && /^(chop|cut) /.test(a.command)) continue;
    out.push({ label: a.role === 'stow' ? 'Put it in the pan' : cap(a.label), fn: () => { run(a); if (a.role === 'stow') { S.board = null; go('hob'); } } });
  }
  return out;
}
const chopOf = (c) => actOf(c, 'prep', (a) => /^(chop|cut) /.test(a.command));
const cap = (t) => String(t || '').replace(/^./, (m) => m.toUpperCase());

function menuFor(hit) {
  const d = S.data, pan = panOf(d), dial = dialOf(d), out = [];
  const onBoard = S.board ? foods().find((c) => c.id === S.board) : null;
  if (hit.kind === 'box') {
    const box = (d?.storage || []).find((x) => String(x.id) === String(hit.id));
    out.push({ title: box?.name || 'Storage' });
    out.push({ label: 'Open it', fn: () => openCold(hit.id) });
  } else if (hit.kind === 'shelf') {
    const c = foods().find((x) => x.id === hit.id);
    if (!c) return out;
    out.push({ title: c.name });
    out.push({ label: 'Put it on the board', fn: () => { S.board = c.id; ksfx('kitchen-tap'); go('board'); paintDom(); } });
    out.push(...foodItems(c));
  } else if (hit.kind === 'board') {
    out.push({ title: onBoard?.name || 'The board' });
    const chop = chopOf(onBoard);
    if (chop && kit().blade) out.push({ label: 'Pick up the knife and cut it', fn: () => pickKnife(chop) });
    out.push(...foodItems(onBoard));
    if (onBoard) out.push({ label: 'Take it off the board', fn: () => { S.board = null; paintDom(); } });
  } else if (hit.kind === 'knife') {
    out.push({ title: 'The knife' });
    const chop = chopOf(onBoard);
    if (chop) out.push({ label: `Pick it up and cut the ${onBoard.name}`, fn: () => pickKnife(chop) });
    else out.push({ label: onBoard ? "That doesn't want cutting" : 'Nothing on the board to cut', off: true });
  } else if (hit.kind === 'knob') {
    out.push({ title: dial?.label ? `The knob: ${dial.label}` : 'The knob' });
    if (dial) {
      const max = dial.ceiling ?? 10;
      const set = (n, label) => { const a = dial.levels?.[n]; if (a && n !== dial.level) out.push({ label, fn: () => { ksfx('kitchen-knob'); run(a); } }); };
      set(0, 'Turn it off');
      set(Math.max(1, Math.round(max * 0.3)), 'Low');
      set(Math.max(1, Math.round(max * 0.6)), 'Medium');
      set(max, 'High');
      if (dial.level > 0) set(dial.level - 1, 'A bit lower');
      if (dial.level < max) set(dial.level + 1, 'A bit higher');
    }
    // any other ring or oven in the room
    for (const o of d?.dials || []) {
      if (o === dial || !o.levels) continue;
      const name = cap(o.subject || o.label || 'The other ring'), om = o.ceiling ?? 10;
      out.push(o.level > 0 ? { label: `${name}: off`, fn: () => run(o.levels[0]) }
        : { label: `${name}: on`, fn: () => run(o.levels[Math.max(1, Math.round(om * 0.6))]) });
    }
  } else if (hit.kind === 'pan') {
    out.push({ title: pan?.name || 'The pan' });
    for (const a of chipsFor('hob')) {
      if (a.role === 'finish') out.push({ label: 'Plate it', fn: () => plateIt(a) });
      else if (a.role === 'handle' && a.command.startsWith('flip ')) out.push({ label: cap(a.label), fn: flip });
      else if (a.role === 'handle' && a.command.startsWith('stir ')) out.push({ label: cap(a.label), fn: stir });
      else out.push({ label: cap(a.label), fn: () => run(a) });
    }
  } else if (hit.kind === 'plate') {
    out.push({ title: 'The plate' });
    const fin = actOf(pan, 'finish');
    out.push(fin ? { label: 'Plate up', fn: () => plateIt(fin) } : { label: 'Nothing ready to plate', off: true });
  }
  return out;
}

// ── the fridge and the freezer ───────────────────────────────────────────────────────────────────
// Each cold `storage` box stands left of the counter, the second further left again. Opening one
// cuts the camera to it and swings its door open on the hinge; what's inside stands on its shelves,
// drawn as itself, and what on you could go in waits in the door's racks. Click a thing to take it
// out (`pullid`), or a thing in the door to put it in (`stowid`): the same commands the HUD sends.
const kit = () => S.data?.kit || {};
const coldBoxes = () => (S.data?.storage || []).filter((x) => x.preserves);
const boxLabel = (x) => (x.preserves === 'frozen' ? 'Freezer' : x.preserves ? 'Fridge' : cap(x.name));
const BOX = { w: 56, d: 40, y0: -12, z0: -40, top: 118 };
const SHELVES = [-4, 26, 56, 86];               // the top of each shelf inside, the floor first
const PER_SHELF = 5;
const DOOR_BINS = [14, 46, 78];                  // the door racks' floors, up from the box's foot
const PER_BIN = 4;
const DOOR_OPEN = 1.95;                          // radians, a touch past square
const SHADOW = M.mix(M.rgb('#b9a888'), -0.25);
const PICKED = M.rgb('#c8323a');
const boxX = (i) => -132 - i * 72;
const boxFront = (i) => [boxX(i), BOX.y0, 50];
const coldBox = () => (S.cold ? coldBoxes().find((x) => String(x.id) === String(S.cold.id)) : null);

// The shot for a box: square on, far enough back to see every shelf and the open door.
function coldShot(i) {
  const x = boxX(i);
  return (S.coldShots[i] ||= { eye: [x + 30, -265, 78], at: [x - 6, 0, 44], fov: 0.62, roll: 0 });
}

function openCold(id) {
  const i = coldBoxes().findIndex((x) => String(x.id) === String(id));
  if (i < 0) return;
  closeMenu(); closeSheet(); hideTip();
  const was = S.cold && S.cold.i === i ? S.cold : null;
  S.cold = was || { id: String(id), i, open: 0, want: 1, hover: null, gone: new Set(), fly: [], toBoard: false };
  S.cold.want = 1;
  ksfx('kitchen-whoosh');
  paintDom();
}
function shutCold() {
  if (!S.cold) return;
  S.cold.want = 0;
  S.cold.hover = null;
  hideTip();
  ksfx('kitchen-thock');
}
// Cycle: shut → the first box → the next → shut.
function cycleCold() {
  const boxes = coldBoxes();
  if (!boxes.length) return;
  if (!S.cold || S.cold.want === 0) return openCold(boxes[0].id);
  const next = boxes[S.cold.i + 1];
  if (next) { S.cold = null; openCold(next.id); } else shutCold();
}

function stepCold(dt) {
  const c = S.cold;
  if (!c) return;
  c.open += Math.sign(c.want - c.open) * Math.min(Math.abs(c.want - c.open), dt * 3.2);
  c.fly = c.fly.filter((f) => (f.t += dt / f.life) < 1);
  if (c.want === 0 && c.open <= 0 && !c.fly.length) { S.cold = null; paintDom(); }
}
// The door's angle: eased out with a little overshoot, so it swings rather than slides.
function doorAngle(open) {
  const k = Math.max(0, Math.min(1, open)), s = 1.6;
  const e = 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
  return DOOR_OPEN * e;
}

// Where the k-th thing inside stands, and how small it has to be to fit the shelf.
function insideSpot(i, k) {
  const x = boxX(i), shelf = Math.floor(k / PER_SHELF), col = k % PER_SHELF;
  return [x - BOX.w / 2 + 7 + col * ((BOX.w - 14) / (PER_SHELF - 1)), BOX.y0 + 15 + (col % 2) * 5, SHELVES[shelf] + 0.2];
}
const PACK_H = { bottle: 24.5, jar: 9, tin: 10, carton: 20, box: 18, sack: 18, tub: 8, shaker: 11, tube: 4, pouch: 14, wrap: 4 };
function fitScale(m, roomH = 26) {
  const L = m.look || {}, k = L.size || 1;
  const w = L.pack ? 7.6 * k : Math.max(m.form.w || 8, m.form.d || 6);
  const h = L.pack ? (PACK_H[L.pack] || 12) * k : (m.form.h || 5);
  return Math.min(1.5, 9.5 / w, roomH / h);   // a touch larger than life, so a tin reads from the door
}
// The door's frame: the hinge at the box's front left, swung open by the door's angle.
function doorPose(i, ang, lift = 0) {
  return KS.pose([boxX(i) - BOX.w / 2, BOX.y0, BOX.z0 + lift], -ang);
}
function doorSpot(i, ang, k) {
  const bin = Math.floor(k / PER_BIN), col = k % PER_BIN;
  return doorPose(i, ang).p([9 + col * 12.5, 4, DOOR_BINS[bin] - BOX.z0 + 1.6]);
}

// What's on show: inside, the box's items; on the door, what on you could go in.
function coldInside(box) {
  const gone = S.cold?.gone || new Set();
  return (box?.items || []).filter((it) => it.look && !gone.has(String(it.id))).slice(0, SHELVES.length * PER_SHELF);
}
function coldDoor(box) {
  const gone = S.cold?.gone || new Set();
  const byId = new Map((S.data?.components || []).map((c) => [String(c.id), c]));
  return (box?.puts || []).filter((p) => !gone.has(String(p.id))).map((p) => ({ put: p, comp: byId.get(String(p.id)) }))
    .filter((x) => x.comp?.look).slice(0, DOOR_BINS.length * PER_BIN);
}

function buildBoxes(b) {
  const boxes = coldBoxes();
  if (!boxes.length) return;
  // a wall behind them, so the counter's wall carries on
  KS.slab(b, [boxX(boxes.length - 1) - 50, 30, BOX.z0], [-118, 34, 150], KS.COLOURS.wall, 0.2);
  for (const [i, box] of boxes.entries()) buildBox(b, box, i);
}

function buildBox(b, box, i) {
  const x = boxX(i), frozen = box.preserves === 'frozen', c = S.cold && S.cold.i === i ? S.cold : null;
  const body = M.rgb(frozen ? '#dfe8ef' : '#efeee9'), trim = M.rgb('#9aa3aa');
  const liner = M.rgb(frozen ? '#d3e6f6' : '#fbf6e6'), glass = M.rgb(frozen ? '#b8d4ea' : '#cfe3e6');
  const x0 = x - BOX.w / 2, x1 = x + BOX.w / 2, y0 = BOX.y0, y1 = BOX.y0 + BOX.d, z0 = BOX.z0, z1 = BOX.top;
  // the carcass, hollow so the shelves can be seen into
  KS.slab(b, [x0, y0, z0], [x0 + 2, y1, z1], body, 0.6);
  KS.slab(b, [x1 - 2, y0, z0], [x1, y1, z1], body, 0.6);
  KS.slab(b, [x0, y0, z1 - 3], [x1, y1, z1], body, 0.6);
  KS.slab(b, [x0, y0, z0], [x1, y1, SHELVES[0] - 0.4], body, 0.6);
  KS.slab(b, [x0, y1 - 2, z0], [x1, y1, z1], body, 0.3);
  // the lit inside, and the shelves: glass in a fridge, frosted wire in a freezer
  KS.slab(b, [x0 + 2, y1 - 2.4, SHELVES[0]], [x1 - 2, y1 - 2, z1 - 3], liner, 0.1);
  for (const [s, z] of SHELVES.entries()) {
    if (s === 0) KS.slab(b, [x0 + 2, y0 + 1, z - 0.4], [x1 - 2, y1 - 2.4, z], liner, 0.1);
    else KS.slab(b, [x0 + 2.2, y0 + 2, z - 0.8], [x1 - 2.2, y1 - 3, z], glass, 0.2);
  }
  // what's inside: standing on the shelves, the one under the pointer lifted
  const inside = c ? coldInside(box) : (box.items || []).filter((it) => it.look).slice(0, SHELVES.length * PER_SHELF);
  for (const [k, it] of inside.entries()) {
    const m = matterFor(it.look.profile, it.look.matter), carried = carriedFrom(c, 'in', k), at = carried || insideSpot(i, k);
    const hot = c?.hover?.where === 'in' && c.hover.k === k;
    if (hot) {
      at[2] += 1.6 + Math.sin(S.t * 6) * 0.6;
      M.disc(b, [at[0], at[1], SHELVES[Math.floor(k / PER_SHELF)] + 0.15], [0, 0, 1], 5.2, PICKED, 18, 0.1);
    }
    KS.shelfPiece(b, m, pieceOf(m, it), KS.piecesOf(m, []).whole, beatOf(it.cook), KS.pose(at, 0.35 + hash(it.id) * 0.6 + (hot ? Math.sin(S.t * 3) * 0.2 : 0), 0, fitScale(m)), 31 + k);
  }
  // the door: closed it sits across the front; open it swings out on the left hinge
  const ang = c ? doorAngle(c.open) : 0, P = doorPose(i, ang);
  KS.prism(b, [[0, -4], [BOX.w, -4], [BOX.w, 0], [0, 0]], z1 - z0, 0.8, body, P);
  KS.prism(b, [[2, 0], [BOX.w - 2, 0], [BOX.w - 2, 0.5], [2, 0.5]], z1 - z0 - 4, 0.1, liner, doorPose(i, ang, 2));
  // the freezer's door has a seam across it; the fridge's a long handle, the freezer's a short one
  if (frozen) KS.prism(b, [[0, -4.3], [BOX.w, -4.3], [BOX.w, -4], [0, -4]], 1, 0.05, trim, doorPose(i, ang, 100));
  const hz = frozen ? [60, 84] : [56, 104];
  M.tube(b, P.p([BOX.w - 6, -7, hz[0] - z0]), P.p([BOX.w - 6, -7, hz[1] - z0]), 0.9, 0.9, trim, 8);
  for (const z of hz) M.tube(b, P.p([BOX.w - 6, -4, z - z0]), P.p([BOX.w - 6, -7, z - z0]), 0.6, 0.6, trim, 6);
  if (!c || c.open < 0.05) return;
  // the door's racks, and what on you could go in standing in them
  for (const z of DOOR_BINS) {
    KS.prism(b, [[3, 0], [BOX.w - 3, 0], [BOX.w - 3, 8], [3, 8]], 1.2, 0.2, glass, doorPose(i, ang, z - z0));
    KS.prism(b, [[3, 7.4], [BOX.w - 3, 7.4], [BOX.w - 3, 8], [3, 8]], 2.2, 0.1, glass, doorPose(i, ang, z - z0));
  }
  for (const [k, { comp }] of coldDoor(box).entries()) {
    const m = matterFor(comp.look.profile, comp.look.matter), carried = carriedFrom(c, 'door', k), at = carried || doorSpot(i, ang, k);
    const hot = c.hover?.where === 'door' && c.hover.k === k;
    if (hot) at[2] += 1.6 + Math.sin(S.t * 6) * 0.6;
    KS.shelfPiece(b, m, pieceOf(m, comp), KS.piecesOf(m, []).whole, beatOf(comp.cook), KS.pose(at, -ang + 0.3, 0, fitScale(m, 22) * 0.9), 61 + k);
    if (hot) M.disc(b, [at[0], at[1], at[2] - 1.5], [0, 0, 1], 4.6, PICKED, 16, 0.1);
  }
  // things on their way: out to you, or into the box
  for (const f of c.fly) {
    const e = f.t * f.t * (3 - 2 * f.t), lift = Math.sin(f.t * Math.PI) * f.arc;
    const at = [f.from[0] + (f.to[0] - f.from[0]) * e, f.from[1] + (f.to[1] - f.from[1]) * e, f.from[2] + (f.to[2] - f.from[2]) * e + lift];
    KS.shelfPiece(b, f.m, f.piece, f.whole, f.beat, KS.pose(at, f.t * 5, f.t * 2, f.scale * (f.shrink ? 1 - 0.7 * e : 1)), 91);
  }
}

// The carried thing's place, if it's this one.
function carriedFrom(c, where, k) {
  const g = S.drag;
  return c && g?.kind === 'cold' && g.moved && g.hit.where === where && g.hit.k === k ? [...g.at] : null;
}

// What's under the pointer in an open box.
function coldHit(e) {
  const c = S.cold, box = coldBox();
  if (!c || !box || c.open < 0.6) return null;
  let best = null, bd = 34;
  const look = (where, k, p) => {
    const s = screenOf(p), r = S.gl.getBoundingClientRect();
    if (!s) return;
    const d = Math.hypot(e.clientX - (r.left + s[0] * r.width), e.clientY - (r.top + s[1] * r.height));
    if (d < bd) { bd = d; best = { where, k }; }
  };
  coldInside(box).forEach((it, k) => { const p = insideSpot(c.i, k); look('in', k, [p[0], p[1], p[2] + 5]); });
  const ang = doorAngle(c.open);
  coldDoor(box).forEach((x, k) => { const p = doorSpot(c.i, ang, k); look('door', k, [p[0], p[1], p[2] + 4]); });
  return best;
}

function coldClick(e) {
  const hit = coldHit(e);
  if (!hit) {
    // a click well away from the box shuts it, as you'd let go of the door
    if (!near(e, boxFront(S.cold.i), 260)) shutCold();
    return;
  }
  // a press picks it up: a click takes it as before, a drag carries it (onMove, onUp)
  const p = hit.where === 'in' ? insideSpot(S.cold.i, hit.k) : doorSpot(S.cold.i, doorAngle(S.cold.open), hit.k);
  S.drag = { kind: 'cold', hit, x0: e.clientX, y0: e.clientY, z: p[2], at: [...p], moved: false, shift: e.shiftKey };
  try { S.gl.setPointerCapture(e.pointerId); } catch { /* fine */ }
}

// Where a carried thing is let go. Out past the door: taken, the box shuts and it goes on the
// board. From the door rack into the box: put in. Anywhere else it goes back where it was.
function dropCold(g) {
  const c = S.cold;
  if (!c) return;
  hideTip();
  if (!g.moved) return coldUse(g.hit, g.shift || c.toBoard);
  const out = g.at[1] < BOX.y0 - 6, inside = g.at[1] > BOX.y0 + 2 && Math.abs(g.at[0] - boxX(c.i)) < BOX.w / 2;
  if (g.hit.where === 'in' && out) {
    coldUse(g.hit, true);
    c.fly = [];
    shutCold();
    go('board');
  } else if (g.hit.where === 'door' && inside) coldUse(g.hit);
  else ksfx('kitchen-tap');
}

// Take a thing out, or put a thing in, and send it flying the way it goes.
function coldUse(hit, toBoard = false) {
  const c = S.cold, box = coldBox();
  if (!c || !box) return;
  const camera = [S.cam.eye[0] * 0.6 + S.cam.at[0] * 0.4, S.cam.eye[1] * 0.6 + S.cam.at[1] * 0.4, S.cam.eye[2] * 0.6 + S.cam.at[2] * 0.4];
  if (hit.where === 'in') {
    const it = coldInside(box)[hit.k], take = actOf(it, 'take');
    if (!it || !take) return;
    const m = matterFor(it.look.profile, it.look.matter);
    c.fly.push({ m, piece: pieceOf(m, it), whole: KS.piecesOf(m, []).whole, beat: beatOf(it.cook), from: insideSpot(c.i, hit.k), to: camera, arc: 10, t: 0, life: 0.45, scale: fitScale(m), shrink: true });
    c.gone.add(String(it.id));
    if (toBoard) S.pendingBoard = { id: String(it.id), name: it.name };
    const sp = insideSpot(c.i, hit.k);
    pop([sp[0], sp[1], sp[2] + 5]);
    run(take);
    ksfx('kitchen-tap');
  } else {
    const x = coldDoor(box)[hit.k];
    if (!x) return;
    const m = matterFor(x.comp.look.profile, x.comp.look.matter);
    const to = insideSpot(c.i, Math.min(coldInside(box).length, SHELVES.length * PER_SHELF - 1));
    c.fly.push({ m, piece: pieceOf(m, x.comp), whole: KS.piecesOf(m, []).whole, beat: beatOf(x.comp.cook), from: doorSpot(c.i, doorAngle(c.open), hit.k), to, arc: 14, t: 0, life: 0.5, scale: fitScale(m), shrink: false });
    c.gone.add(String(x.put.id));
    pop(doorSpot(c.i, doorAngle(c.open), hit.k), '#2b3a63');
    run(x.put);
    ksfx('kitchen-clink');
  }
  c.hover = null;
  hideTip();
  paintColdBar();
}

// Arrow keys walk the shelves and the door; Enter uses what's picked.
function coldKey(k, shift) {
  const c = S.cold, box = coldBox();
  if (!c || !box) return false;
  const nIn = coldInside(box).length, nDoor = coldDoor(box).length;
  if (k === 'Enter') { if (c.hover) coldUse(c.hover, shift || c.toBoard); return true; }
  const all = [...Array.from({ length: nIn }, (_, i) => ({ where: 'in', k: i })), ...Array.from({ length: nDoor }, (_, i) => ({ where: 'door', k: i }))];
  if (!all.length) return false;
  let at = c.hover ? all.findIndex((h) => h.where === c.hover.where && h.k === c.hover.k) : -1;
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: PER_SHELF, ArrowUp: -PER_SHELF }[k];
  if (step == null) return false;
  at = at < 0 ? 0 : Math.max(0, Math.min(all.length - 1, at + step));
  c.hover = all[at];
  ksfx('kitchen-tap');
  showColdTip(c.hover);
  return true;
}

// The name, count and notes of what's under the pointer, beside it.
function showColdTip(hit, e = null) {
  const box = coldBox(), tip = S.root.querySelector('.ks-tip');
  if (!hit || !box) return hideTip();
  const it = hit.where === 'in' ? coldInside(box)[hit.k] : coldDoor(box)[hit.k]?.comp;
  if (!it) return hideTip();
  const qty = hit.where === 'in' ? it.qty : coldDoor(box)[hit.k]?.put.qty;
  const verb = hit.where === 'in' ? (S.cold.toBoard ? 'Click: onto the board' : 'Click: take it out · Shift: onto the board') : `Click: put it in the ${boxLabel(box).toLowerCase()}`;
  tip.innerHTML = `<b>${esc(it.name)}${qty > 1 ? ` ×${qty}` : ''}</b>${it.notes?.length ? `<span>${esc(it.notes.join(', '))}</span>` : ''}<i>${esc(verb)}</i>`;
  tip.hidden = false;
  const r = S.root.getBoundingClientRect(), gr = S.gl.getBoundingClientRect();
  let x, y;
  if (e) { x = e.clientX - r.left + 16; y = e.clientY - r.top + 12; } else {
    const p = hit.where === 'in' ? insideSpot(S.cold.i, hit.k) : doorSpot(S.cold.i, doorAngle(S.cold.open), hit.k), s = screenOf([p[0], p[1], p[2] + 8]);
    if (!s) return;
    x = gr.left - r.left + s[0] * gr.width + 12; y = gr.top - r.top + s[1] * gr.height - 10;
  }
  tip.style.left = `${Math.max(8, Math.min(r.width - tip.offsetWidth - 8, x))}px`;
  tip.style.top = `${Math.max(8, Math.min(r.height - tip.offsetHeight - 8, y))}px`;
}
function hideTip() { const t = S?.root.querySelector('.ks-tip'); if (t) t.hidden = true; }

function paintColdBar() {
  const el = S.root.querySelector('.ks-cold-bar'), box = coldBox();
  if (!S.cold || !box) { el.hidden = true; el.innerHTML = ''; return; }
  const n = (box.items || []).length, shown = coldInside(box).length;
  const more = (n - shown - S.cold.gone.size > 0 ? n - shown : 0) + (box.other || 0);
  el.hidden = false;
  el.dataset.frozen = box.preserves === 'frozen' ? '1' : '';
  el.innerHTML = `<span class="ks-cold-name">${esc(box.name)}</span>
    <span class="ks-cold-count">${n ? `${n} thing${n === 1 ? '' : 's'}` : 'Empty'}${more ? ` · ${more} more at the back` : ''}</span>
    <button class="ks-chip${S.cold.toBoard ? ' on' : ''}" data-cold="board" aria-pressed="${S.cold.toBoard}" title="Whatever you take goes straight onto the board">To the board</button>
    <button class="ks-chip ks-serve" data-cold="shut">Shut it</button>`;
}

// ── what the server says ─────────────────────────────────────────────────────────────────────────
// With the Stage open the log stays quiet: every line the server prints comes here instead, as a
// caption over the kitchen that fades after a few seconds (dispatch.js output).
export function kitchenSays(html) {
  if (!S) return false;
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '');
  const text = tmp.textContent.replace(/\s+/g, ' ').trim();
  if (!text) return true;
  const box = S.root.querySelector('.ks-say'), line = document.createElement('div');
  line.textContent = text;
  box.appendChild(line);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => line.classList.add('gone'), 6000);
  setTimeout(() => line.remove(), 6600);
  return true;
}

// ── the heat ─────────────────────────────────────────────────────────────────────────────────────
// The wheel turns the knob: the picture moves at once, and the setting is sent once you stop.
function onWheel(e) {
  const dial = dialOf(S?.data);
  if (!dial?.levels || S.cold || S.dress || S.knife) return;
  e.preventDefault();
  const max = dial.ceiling ?? 10, from = S.wheel ? S.wheel.level : dial.level;
  const lv = Math.max(0, Math.min(max, from + (e.deltaY < 0 ? 1 : -1)));
  if (S.wheel?.timer) clearTimeout(S.wheel.timer);
  if (lv !== from) ksfx('kitchen-knob');
  S.wheel = { level: lv, timer: setTimeout(() => {
    if (!S?.wheel) return;
    const want = S.wheel.level, d = dialOf(S.data);
    S.wheel = null;
    if (d && want !== d.level) run(d.levels[want]);
  }, 280) };
  if (S.station !== 'hob') go('hob');
}

// The ring itself: dark when it's off, a dull red as it warms, orange and then yellow-white at
// the top of the dial, with a little shimmer so it reads as live.
const ELEMENT = [M.rgb('#3a3434'), M.rgb('#8a1d10'), M.rgb('#ff5a1f'), M.rgb('#ffd27a')];
function buildElement(b, level, max) {
  if (level <= 0) return;
  const k = Math.min(1, level / Math.max(1, max)) * (0.96 + 0.04 * Math.sin(S.t * 9)), seg = k * 3;
  const i = Math.min(2, Math.floor(seg)), f = seg - i, A = ELEMENT[i], B = ELEMENT[i + 1];
  const col = [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f, 1];
  const x = KS.STATIONS.hob, z = S.hobKind === 'camp' ? 3.05 : 2.95;
  for (const r of [2.2, 4.5, 6.8]) KS.ring(b, [x, 0, z], r, 0.55 + 0.25 * k, col, 20);
  // heat haze over a bare ring: a faint puff now and then, more as it climbs
  if (!vesselsOf(S.data).some((v) => v.hot) && Math.random() < k * 0.15) S.puffs.push({ p: [x + (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, 4], age: 0, life: 0.9, c: KS.COLOURS.steam, size: 0.5 });
}

// ── tasting ──────────────────────────────────────────────────────────────────────────────────────
// A taste lifts a spoonful out of the pan to the camera and holds it there until the server's
// answer comes; its 'kitchen_taste' carries a mood (plugins/cooking/taste.js tasteMood), drawn as a
// face beside the spoon, and the words follow as a caption. The face says no more than the words.
function startTaste() {
  const pan = panOf(S.data), c = (pan?.contents || []).find((x) => x.look);
  const m = c && matterFor(c.look.profile, c.look.matter);
  S.tasting = { t0: S.t, mood: null, tm: 0, col: m ? M.rgb(m.ramp[beatOf(c.cook, c.state === 'cooked')] || m.ramp.raw) : KS.COLOURS.steam, from: PAN_AT(pan) };
  ksfx('kitchen-tap');
}
export function kitchenTaste(msg) {
  if (!S) return;
  if (!S.tasting) startTaste();
  S.tasting.mood = msg.mood || 'plain';
  S.tasting.tm = S.t;
  ksfx(msg.mood === 'good' ? 'kitchen-clink' : 'kitchen-thock');
}
function tasteEnd() {
  const g = S.tasting;
  if (!g) return true;
  if ((g.mood && S.t - g.tm > 2.4) || (!g.mood && S.t - g.t0 > 4)) { S.tasting = null; return true; }
  return false;
}
// Where the spoon is: up from the pan to just under the camera, then down again as it ends.
function spoonAt() {
  const g = S.tasting, e = S.cam.eye, a = S.cam.at;
  const near = [e[0] + (a[0] - e[0]) * 0.22, e[1] + (a[1] - e[1]) * 0.22, e[2] + (a[2] - e[2]) * 0.22 - 7];
  const up = Math.min(1, (S.t - g.t0) / 0.5), down = g.mood ? Math.max(0, (S.t - g.tm - 1.9) / 0.5) : 0;
  const k = Math.max(0, up - down), q = k * k * (3 - 2 * k);
  const from = [g.from[0], g.from[1], g.from[2] + 4];
  return [from[0] + (near[0] - from[0]) * q, from[1] + (near[1] - from[1]) * q, from[2] + (near[2] - from[2]) * q + Math.sin(q * Math.PI) * 10];
}
function buildTaste(b) {
  if (tasteEnd() || S.cold) return;
  const p = spoonAt(), steel = KS.COLOURS.blade;
  M.ellipsoid(b, p, [1, 0, 0], [0, 1, 0], [0, 0, 1], [2.1, 1.5, 0.6], steel, 10, 5);
  M.ellipsoid(b, [p[0], p[1], p[2] + 0.35], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1.6, 1.1, 0.25], S.tasting.col, 10, 4);
  M.tube(b, [p[0] + 1.8, p[1] - 0.5, p[2] + 0.2], [p[0] + 12, p[1] - 4, p[2] - 3], 0.45, 0.55, KS.COLOURS.handle, 6);
}
// The face: an inked circle with eyes and a mouth for the mood, in a bubble by the spoon.
function paintFace(x, w, h) {
  const g = S.tasting;
  if (!g?.mood || S.cold) return;
  const s = screenOf(spoonAt());
  if (!s) return;
  const age = S.t - g.tm, k = Math.min(1, age / 0.18) * Math.min(1, Math.max(0, (2.3 - age) / 0.3));
  if (k <= 0) return;
  const R = 26 * (0.6 + 0.4 * k), cx = Math.min(w - R - 12, s[0] * w + 70), cy = Math.max(R + 12, s[1] * h - 60);
  x.save();
  x.globalAlpha = k;
  x.fillStyle = '#f6efe0'; x.strokeStyle = '#141018'; x.lineWidth = 3; x.lineCap = 'round'; x.lineJoin = 'round';
  x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.fill(); x.stroke();
  x.beginPath(); x.moveTo(cx - R * 0.55, cy + R * 0.8); x.lineTo(cx - R * 0.9, cy + R * 1.3); x.lineTo(cx - R * 0.15, cy + R * 0.95); x.fill(); x.stroke();
  const eye = (ex, kind) => {
    x.beginPath();
    if (kind === 'x') { x.moveTo(ex - 4, cy - 9); x.lineTo(ex + 4, cy - 1); x.moveTo(ex + 4, cy - 9); x.lineTo(ex - 4, cy - 1); }
    else if (kind === 'happy') { x.arc(ex, cy - 3, 4, Math.PI * 1.1, Math.PI * 1.9); }
    else if (kind === 'wide') { x.arc(ex, cy - 5, 4.5, 0, Math.PI * 2); }
    else if (kind === 'squint') { x.moveTo(ex - 5, cy - 7); x.lineTo(ex + 5, cy - 3); }
    else { x.arc(ex, cy - 5, 2, 0, Math.PI * 2); x.fillStyle = '#141018'; x.fill(); }
    x.stroke();
  };
  const L = cx - R * 0.35, Rr = cx + R * 0.35, my = cy + R * 0.35;
  const mood = g.mood;
  const eyes = { good: 'happy', raw: 'wide', over: 'squint', burnt: 'x', flat: 'dot', strong: 'squint', plain: 'dot' }[mood] || 'dot';
  eye(L, eyes); eye(Rr, mood === 'strong' ? 'wide' : eyes);
  x.beginPath();
  if (mood === 'good') x.arc(cx, my - 5, R * 0.42, Math.PI * 0.15, Math.PI * 0.85);
  else if (mood === 'raw') x.ellipse(cx, my, 4, 6, 0, 0, Math.PI * 2);
  else if (mood === 'over' || mood === 'burnt') x.arc(cx, my + 9, R * 0.38, Math.PI * 1.2, Math.PI * 1.8);
  else if (mood === 'strong') { for (let i = 0; i <= 6; i++) { const xx = cx - 10 + i * 3.4, yy = my + (i % 2 ? -3 : 3); i ? x.lineTo(xx, yy) : x.moveTo(xx, yy); } }
  else { x.moveTo(cx - 9, my); x.lineTo(cx + 9, my); }
  x.stroke();
  // a mark for the mood: a sparkle when it's right, a drop of sweat when it's strong, smoke when it's gone
  x.lineWidth = 2;
  if (mood === 'good') { const sx = cx + R + 6, sy = cy - R; x.beginPath(); x.moveTo(sx - 6, sy); x.lineTo(sx + 6, sy); x.moveTo(sx, sy - 6); x.lineTo(sx, sy + 6); x.stroke(); }
  if (mood === 'strong') { x.fillStyle = '#7fb6e0'; x.beginPath(); x.ellipse(cx + R * 0.75, cy - R * 0.45, 3, 5, 0, 0, Math.PI * 2); x.fill(); x.stroke(); }
  if (mood === 'burnt') { x.strokeStyle = 'rgba(60,55,50,0.8)'; for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(cx - 8 + i * 8, cy - R - 6 - Math.sin(S.t * 4 + i) * 3, 3 + i, 0, Math.PI * 2); x.stroke(); } }
  x.restore();
}

// ── polish: fog, light, pops, hops, shimmer ──────────────────────────────────────────────────────
// All picture: nothing here reads or sends anything the server decides.

// Cold air spills out of an open box and sinks to the floor; a freezer spills more of it.
function stepFog(dt) {
  S.fog ||= [];
  const c = S.cold, box = coldBox();
  if (c && box && c.open > 0.3) {
    const frozen = box.preserves === 'frozen', rate = (frozen ? 7 : 3) * Math.min(1, c.open);
    if (Math.random() < dt * rate) {
      const x = boxX(c.i) + (Math.random() - 0.5) * (BOX.w - 8), z = SHELVES[Math.floor(Math.random() * 2)] + 1;   // from the bottom shelves, so it never hides the food
      S.fog.push({ p: [x, BOX.y0 - 3, z], v: [(Math.random() - 0.5) * 6, -18 - Math.random() * 10, -8 - Math.random() * 6], age: 0, life: 1.1 + Math.random() * 0.6, r: 1.2 + Math.random() * 1.2 });
    }
  }
  S.fog = S.fog.filter((f) => (f.age += dt / f.life) < 1);
  for (const f of S.fog) { for (let i = 0; i < 3; i++) f.p[i] += f.v[i] * dt; f.v[2] -= 4 * dt; f.v[1] *= 0.98; }
}
const FOG = M.rgb('#eef6fb');
function buildFog(b) {
  for (const f of S.fog || []) {
    const k = 1 - f.age, s = f.r * (0.6 + f.age * 1.8);
    if (k > 0.05) M.sphere(b, f.p, s * (0.5 + 0.5 * k), FOG, 7, 4);
  }
}

// A burst of ink lines and dots where something was picked, the manga "pop".
function pop(p3, col = '#c8323a') {
  const s = screenOf(p3);
  if (!s) return;
  (S.pops ||= []).push({ x: s[0], y: s[1], t: 0, col });
}
function hop(id) { (S.hops ||= new Map()).set(String(id), S.t); }
const hopZ = (id) => {
  const t0 = S.hops?.get(String(id));
  if (t0 == null) return 0;
  const k = (S.t - t0) / 0.45;
  if (k >= 1) { S.hops.delete(String(id)); return 0; }
  return Math.sin(k * Math.PI) * 5 * (1 - k * 0.5);
};

// Embers off a ring at the top of the dial.
function embers(b, level, max, dt) {
  S.embers ||= [];
  const k = level / Math.max(1, max);
  if (k > 0.7 && Math.random() < dt * 30 * (k - 0.6)) {
    const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 6;
    S.embers.push({ p: [KS.STATIONS.hob + Math.cos(a) * r, Math.sin(a) * r, 3.5], v: [(Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, 18 + Math.random() * 20], age: 0 });
  }
  S.embers = S.embers.filter((e) => (e.age += dt * 1.3) < 1);
  for (const e of S.embers) {
    for (let i = 0; i < 3; i++) e.p[i] += e.v[i] * dt;
    M.sphere(b, e.p, 0.35 * (1 - e.age), e.age < 0.5 ? ELEMENT[3] : ELEMENT[2], 5, 3);
  }
}

// The 2-D layer: the light inside an open box, frost glints in a freezer, heat shimmer over a
// hot ring, and the pops.
function paintPolish(x, w, h, dt) {
  const c = S.cold, box = coldBox();
  if (c && box && c.open > 0.05) {
    const s = screenOf([boxX(c.i), BOX.y0 + BOX.d * 0.6, 60]);
    if (s) {
      const frozen = box.preserves === 'frozen', k = Math.min(1, c.open) * (0.92 + 0.08 * Math.sin(S.t * 2));
      const g = x.createRadialGradient(s[0] * w, s[1] * h, 0, s[0] * w, s[1] * h, h * 0.55);
      g.addColorStop(0, frozen ? `rgba(200,230,255,${0.35 * k})` : `rgba(255,248,220,${0.38 * k})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      if (frozen) for (let i = 0; i < 14; i++) {
        const tw = Math.max(0, Math.sin(S.t * 3 + i * 2.7));
        if (tw < 0.85) continue;
        const px = (s[0] + (hash('f' + i) - 0.5) * 0.3) * w, py = (s[1] + (hash('g' + i) - 0.5) * 0.6) * h, r = 2 + 5 * (tw - 0.85) / 0.15;
        x.strokeStyle = `rgba(255,255,255,${tw})`; x.lineWidth = 1.5;
        x.beginPath(); x.moveTo(px - r, py); x.lineTo(px + r, py); x.moveTo(px, py - r); x.lineTo(px, py + r); x.stroke();
      }
    }
  }
  const dial = dialOf(S.data), level = S.wheel ? S.wheel.level : dial?.level || 0, max = dial?.ceiling ?? 10;
  if (!c && level > 0 && S.station === 'hob') {
    const s = screenOf([KS.STATIONS.hob, 0, KS.PAN_Z + 14]), k = level / max;
    if (s) {
      x.strokeStyle = `rgba(255,240,220,${0.12 + 0.25 * k})`; x.lineWidth = 2;
      for (let i = 0; i < 3 + Math.round(k * 4); i++) {
        const ox = s[0] * w + (i - 3) * 14, oy = s[1] * h;
        x.beginPath();
        for (let j = 0; j <= 10; j++) { const y = oy - j * 7, xx = ox + Math.sin(j * 0.9 + S.t * 6 + i) * 3 * k; j ? x.lineTo(xx, y) : x.moveTo(xx, y); }
        x.stroke();
      }
    }
  }
  if (S.wanted && S.tool === S.wanted && S.hover && !c) {
    const g = screenOf([S.hover[0] + 2, S.hover[1] - 3, S.hover[2] + 4]);
    if (g) {
      const tw = 0.5 + 0.5 * Math.sin(S.t * 8), px = g[0] * w, py = g[1] * h, rr = 6 + 8 * tw;
      x.strokeStyle = `rgba(255,250,220,${0.5 + 0.5 * tw})`; x.lineWidth = 2; x.lineCap = 'round';
      x.beginPath(); x.moveTo(px - rr, py); x.lineTo(px + rr, py); x.moveTo(px, py - rr); x.lineTo(px, py + rr);
      x.moveTo(px - rr * 0.5, py - rr * 0.5); x.lineTo(px + rr * 0.5, py + rr * 0.5); x.moveTo(px + rr * 0.5, py - rr * 0.5); x.lineTo(px - rr * 0.5, py + rr * 0.5); x.stroke();
    }
  }
  paintFace(x, w, h);
  S.pops = (S.pops || []).filter((p) => (p.t += dt * 2.8) < 1);
  for (const p of S.pops) {
    const px = p.x * w, py = p.y * h, e = 1 - (1 - p.t) * (1 - p.t);
    x.strokeStyle = p.col; x.fillStyle = p.col; x.globalAlpha = 1 - p.t; x.lineWidth = 3; x.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + 0.2, r0 = 10 + 22 * e, r1 = r0 + 10 * (1 - p.t);
      x.beginPath(); x.moveTo(px + Math.cos(a) * r0, py + Math.sin(a) * r0); x.lineTo(px + Math.cos(a) * r1, py + Math.sin(a) * r1); x.stroke();
    }
    x.beginPath(); x.arc(px, py, 26 * e, 0, Math.PI * 2); x.lineWidth = 2; x.stroke();
    x.globalAlpha = 1;
  }
}

// ── the pans and the utensils ────────────────────────────────────────────────────────────────────
// The rack down the right: every pan out in the kitchen, and the utensil in your hand. Picking a
// pan makes it the one food goes into and the one the hob gestures work on; picking a utensil
// makes a drag on the pan mean one thing.
const TOOLS = [
  { key: 'hand', label: 'Hand', need: null, hint: 'Pick things up and move them' },
  { key: 'spoon', label: 'Spoon', need: 'stir', hint: 'Drag round the pan to stir' },
  { key: 'spatula', label: 'Spatula', need: 'flip', hint: 'Click or flick the pan to flip' },
  { key: 'knife', label: 'Knife', need: 'blade', hint: 'Click food on the board to cut it' },
];
const ICON = {
  pan: '<circle cx="10" cy="13" r="7"/><path d="M17 13h6"/>',
  pot: '<path d="M4 8h14v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M2 10h2M18 10h2"/>',
  tray: '<rect x="2" y="9" width="20" height="8" rx="1"/>',
  bowl: '<path d="M3 10h18a9 7 0 0 1-18 0z"/>',
  hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6V4a1.5 1.5 0 0 1 3 0v7V6a1.5 1.5 0 0 1 3 0v8c0 4-3 7-6 7s-5-2-7-5l-2-3a1.5 1.5 0 0 1 2.5-1.5z"/>',
  spoon: '<ellipse cx="7" cy="7" rx="4" ry="5" transform="rotate(-45 7 7)"/><path d="M10 10l10 10"/>',
  spatula: '<rect x="3" y="3" width="8" height="9" rx="1" transform="rotate(-45 7 7.5)"/><path d="M11 11l10 10"/>',
  knife: '<path d="M3 21L17 7l3 1-11 11z"/><path d="M17 7l3-3"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ICON.pan}</svg>`;

// The utensil the pan wants now: a food in its window (the server's phase) whose handle action is
// a flip wants the spatula, a stir the spoon. Read from the payload only.
function wantedTool() {
  for (const c of panOf(S.data)?.contents || []) {
    if (c.cook?.phase !== 'window') continue;
    const h = actOf(c, 'handle');
    if (h?.command.startsWith('flip ')) return 'spatula';
    if (h?.command.startsWith('stir ')) return 'spoon';
  }
  return null;
}

function toolOk(t) { return !t.need || !!kit()[t.need]; }

function paintRack() {
  const el = S.root.querySelector('.ks-rack'), pans = vesselsOf(S.data), pan = panOf(S.data);
  if (S.cold || S.dress) { el.hidden = true; return; }
  el.hidden = false;
  const pansHtml = pans.length ? pans.map((v, i) => {
    const n = (v.contents || []).length;
    return `<button class="ks-rack-card${v === pan ? ' on' : ''}${S.popped === 'pan:' + v.id ? ' pop' : ''}" data-pan="${esc(String(v.id))}" aria-pressed="${v === pan}" title="${esc(v.name)}, ${esc(v.place || '')}">
      ${icon(v.look.vessel)}<span class="ks-rack-name">${esc(v.name)}</span>
      <span class="ks-rack-sub">${v.hot ? 'on the heat' : n ? `${n} in it` : 'empty'}</span></button>`;
  }).join('') : '<div class="ks-rack-none">No pan out</div>';
  const want = wantedTool();
  if (want && want !== S.wanted) ksfx('kitchen-tap');
  S.wanted = want;
  const toolsHtml = TOOLS.map((t) => {
    const ok = toolOk(t);
    return `<button class="ks-rack-tool${S.tool === t.key ? ' on' : ''}${S.popped === 'tool:' + t.key ? ' pop' : ''}${want === t.key && ok ? ' wants' : ''}" data-tool="${t.key}" aria-pressed="${S.tool === t.key}"${ok ? '' : ' disabled'} title="${esc(!ok ? `You've no ${t.label.toLowerCase()} to hand` : want === t.key ? `It wants the ${t.label.toLowerCase()} now` : t.hint)}">${icon(t.key)}<span>${t.label}</span></button>`;
  }).join('');
  S.popped = null;
  el.innerHTML = `<div class="ks-label">Pans <kbd>[ ]</kbd></div>${pansHtml}<div class="ks-label">In hand <kbd>Q E</kbd></div><div class="ks-rack-tools">${toolsHtml}</div>`;
}

// Click a pan once to work with it, again for what it does.
function pickPan(id, e = null) {
  const v = vesselsOf(S.data).find((x) => String(x.id) === String(id));
  if (!v) return;
  if (v === panOf(S.data) && e) {
    const card = e.target?.closest?.('button');
    const r = card?.getBoundingClientRect();
    return openMenu(menuFor({ kind: 'pan' }), r ? { clientX: r.left - 190, clientY: r.top } : e);
  }
  S.vesselId = v.id;
  hop(v.id);
  S.popped = 'pan:' + v.id;
  syncBodies(); syncLiquid();
  if (S.station !== 'hob') go('hob');
  ksfx('kitchen-clink');
  paintDom();
}
function cyclePan(dir) {
  const vs = vesselsOf(S.data);
  if (vs.length < 2) return;
  const i = vs.indexOf(panOf(S.data));
  pickPan(vs[(i + dir + vs.length) % vs.length].id);
}
function setTool(key) {
  const t = TOOLS.find((x) => x.key === key);
  if (!t || !toolOk(t)) return;
  S.tool = key;
  S.popped = 'tool:' + key;
  ksfx(key === 'knife' ? 'kitchen-thock' : 'kitchen-tap');
  paintRack();
}
function cycleTool(dir) {
  const ok = TOOLS.filter(toolOk), i = Math.max(0, ok.findIndex((t) => t.key === S.tool));
  setTool(ok[(i + dir + ok.length) % ok.length].key);
}

// The other pans on the rack, with what's in them sitting still: only the one you're using moves.
function buildOtherPans(b) {
  const pan = panOf(S.data);
  for (const v of vesselsOf(S.data)) {
    if (v === pan) continue;
    const at = PAN_AT(v);
    at[2] += hopZ(v.id);
    const P = KS.pose(at, 0), spec = KS.vesselSpec(v.look.vessel);
    KS.vessel(b, v.look.vessel, P);
    let k = 0;
    for (const c of v.contents || []) {
      if (!c.look) continue;
      const m = matterFor(c.look.profile, c.look.matter), beat = beatOf(c.cook, c.state === 'cooked');
      if (liquidish(m)) {
        M.disc(b, P.p([0, 0, Math.min(spec.wall * 0.6, 2)]), [0, 0, 1], spec.r * (spec.taper || 0.85) * 0.95, M.rgb(m.ramp[beat] || m.ramp.raw), 20, 0.2);
        continue;
      }
      const a = hash(c.id) * Math.PI * 2, r = Math.sqrt(hash(c.id + 'r')) * (spec.r - 4) * 0.7;
      KS.foodPiece(b, m, pieceOf(m, c), KS.piecesOf(m, []).whole, beat, KS.pose([at[0] + Math.cos(a) * r, at[1] + Math.sin(a) * r, at[2] + 1], a * 2), 41 + k++);
    }
  }
}

// The utensil in your hand, drawn where the pointer meets the counter, so you can see what a
// click will do before you do it.
function hoverAt(e) {
  if (S.cold) {
    const hit = coldHit(e), was = S.cold.hover;
    if (hit?.where !== was?.where || hit?.k !== was?.k) { S.cold.hover = hit; if (hit) ksfx('kitchen-tap'); }
    S.gl.style.cursor = hit ? 'pointer' : '';
    if (hit) showColdTip(hit, e); else hideTip();
    return;
  }
  if (S.tool === 'hand' || S.menu || S.knife || S.dress || e.target !== S.gl) { S.hover = null; S.gl.style.cursor = ''; return; }
  S.hover = planeHit(e, KS.PAN_Z + 7);
  S.gl.style.cursor = S.hover ? 'none' : '';
}
function buildTool(b) {
  const h = S.hover;
  if (!h || S.cold || S.drag?.kind === 'pan' && S.spoon || S.tool === 'hand') return;
  const at = [h[0], h[1], h[2]], col = KS.COLOURS.handle, steel = KS.COLOURS.blade;
  // a soft shadow on the counter under the utensil, so you can tell how high it is
  M.disc(b, [at[0], at[1], 0.3], [0, 0, 1], 3.2, SHADOW, 14, 0.05);
  if (S.tool === 'spoon') {
    M.ellipsoid(b, at, [1, 0, 0], [0, 1, 0], [0, 0, 1], [2, 1.4, 0.6], steel, 10, 5);
    M.tube(b, [at[0] + 1.5, at[1] - 1, at[2] + 0.3], [at[0] + 6, at[1] - 9, at[2] + 16], 0.45, 0.55, col, 6);
  } else if (S.tool === 'spatula') {
    KS.prism(b, [[-3.5, -3], [3.5, -3], [3, 3], [-3, 3]], 0.3, 0.05, steel, KS.pose(at, 0.5));
    M.tube(b, [at[0] + 1.2, at[1] - 3, at[2] + 0.2], [at[0] + 5, at[1] - 14, at[2] + 12], 0.5, 0.7, col, 6);
  } else if (S.tool === 'knife') {
    KS.knife(b, KS.pose([at[0] - 6, at[1] - 2, at[2] + 2], -0.6, Math.PI / 2));
  }
}

// ── the stock-up screen ─────────────────────────────────────────────────────────────────────────
function closeSheet() {
  if (!S.sheet) return;
  S.sheet = null;
  paintSheet();
}

// The server's catalogue arrived (plugins/cooking/stock.js).
export function kitchenStock(msg) {
  if (!S) return;
  const shelf = S.sheet?.kind === 'stock' ? S.sheet.shelf : 'food';
  S.sheet = { kind: 'stock', items: msg.items || [], credits: msg.credits ?? 0, shelf };
  paintSheet();
}

function paintSheet() {
  const el = S.root.querySelector('.ks-sheet'), sh = S.sheet;
  if (!sh) { el.hidden = true; el.innerHTML = ''; el.className = 'ks-sheet'; return; }
  el.hidden = false;
  el.className = 'ks-sheet ks-stock';
  const list = sh.items.filter((it) => it.shelf === sh.shelf);
  el.innerHTML = `<div class="ks-stock-box">
    <div class="ks-sheet-head"><span>Stock the kitchen</span><span class="ks-stock-cash">₵${sh.credits}</span><button class="ks-btn" data-sheet="close" aria-label="Close">Done</button></div>
    <div class="ks-stock-tabs">${[['food', 'Food'], ['kit', 'Pans and kit']].map(([k, l]) => `<button class="ks-tab${sh.shelf === k ? ' on' : ''}" data-shelf="${k}">${l}</button>`).join('')}</div>
    <div class="ks-stock-note">Delivered to you here. It costs more than walking to the shop.</div>
    <div class="ks-stock-grid">${list.length ? list.map((it) => `<div class="ks-stock-card">
      <div class="ks-stock-name">${esc(it.name)}</div>
      ${it.note ? `<div class="ks-stock-desc">${esc(it.note)}</div>` : ''}
      <button class="ks-chip ks-serve" data-buy="${esc(it.id)}"${it.price > sh.credits ? ' disabled' : ''}>Buy · ₵${it.price}</button>
    </div>`).join('') : '<div class="ks-cold-empty">Nobody in town delivers any.</div>'}</div>
  </div>`;
}

function pickKnife(chop) {
  ksfx('kitchen-thock');
  go('board');
  run(chop);
}

function openMenu(items, e) {
  const box = S.root.querySelector('.ks-menu');
  if (!items.some((it) => !it.title)) return closeMenu();
  S.menu = items;
  box.innerHTML = items.map((it, i) => it.title ? `<div class="ks-menu-title">${esc(it.title)}</div>`
    : `<button class="ks-menu-item" role="menuitem" data-menu="${i}"${it.off ? ' disabled' : ''}>${esc(it.label)}</button>`).join('');
  box.hidden = false;
  const r = S.root.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = `${Math.max(8, Math.min(r.width - w - 8, e.clientX - r.left + 6))}px`;
  box.style.top = `${Math.max(8, Math.min(r.height - h - 8, e.clientY - r.top + 6))}px`;
  ksfx('kitchen-tap');
}
function closeMenu() {
  if (!S) return;
  S.menu = null;
  const box = S.root.querySelector('.ks-menu');
  if (box) { box.hidden = true; box.innerHTML = ''; }
}

function flip() {
  const pan = panOf(S.data);
  const live = (pan?.contents || []).find((c) => actOf(c, 'handle', (a) => a.command.startsWith('flip ')));
  const h = live && actOf(live, 'handle');
  toss();
  if (h) run(h);
}
// The `stir` command alone, for a spoon already moving the liquid by hand.
function stirCommand() {
  const pan = panOf(S.data);
  const live = (pan?.contents || []).find((c) => actOf(c, 'handle', (a) => a.command.startsWith('stir ')));
  const h = live && actOf(live, 'handle');
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
  if (S.menu && k === 'Escape') closeMenu();
  else if (S.sheet && k === 'Escape') closeSheet();
  else if (S.cold && (k === 'Escape' || (S.cold.want === 0 && k === 'o'))) shutCold();
  else if (S.cold && coldKey(k, e.shiftKey)) { /* walked the shelves */ }
  else if (k === 'o' || k === 'O') cycleCold();
  else if (S.cold) done = false;
  else if (k === '[') cyclePan(-1);
  else if (k === ']') cyclePan(1);
  else if (k === 'q' || k === 'Q') cycleTool(-1);
  else if (k === 'e' || k === 'E') cycleTool(1);
  else if (S.dress && k === 'Enter') serve(scoreDress());
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
