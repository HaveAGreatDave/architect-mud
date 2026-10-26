// THE PODRACER SEAT: driving the Rasp Twinspool over the Scarletwastes.
//
// boat-view.js's shape: `stepPodracer` (podracer-model.js) integrated at the frame rate, the server
// streaming a window of the real map and reconciling four times a second. What differs:
//
//  · Two levers, one per turbine. W and S run both; A and D take thrust off one side to turn,
//    because more thrust on the left turbine turns the craft right. Each lever can be dragged too.
//  · The world pushes back. Cliffs, mesas, buildings and any tile with no ground under it are solid,
//    through `solid()` below; the model bounces off them and reports the hit. Past a road mouth on
//    the rim the server's window carries the void highway, so the road out is ground and the waste
//    beside it is not (plugins/podracer/seat.js, The highway in the README).
//  · Three cameras on V: the seat, and a near and a far chase. From the seat the pod is its own
//    interior (client/shared/interior-podracer.js) and the turbines and cables out ahead are the
//    craft's mesh, drawn from the seat (windshield.js `seatModel`). The levers, START and BRAKE in
//    the pod are hotspots: drag a lever, click START, hold BRAKE.
//
// The model's coordinates are the map window's, centred on (cx, cy), the boat's arrangement: the
// window recentres every six tiles and the bodies are shifted with it.

import { paintWindshield, windshieldHTML, ensureWindshieldStyles, disposeWindshield, lastViewState, interiorHotspots, ROAD_RIG_MUL, RENDER_TUNE } from './windshield.js';
import { tweenOrbit } from './camera-tween.js';
import { EYE_M } from '../../../shared/interior-shell.js';
import { updateEngineAudio, stopEngineAudio, spoolUp, spoolDown, hitFx, groundFx } from './engine-audio.js';
import { PODRACER_TYPES, CRANK_S, createPodracerState, stepPodracer, placePodracer, shiftPodracerOrigin, podracerPose, podracerParts, podracerBurn, tornBinder, mendBinder, podracerLook, podracerLivery } from './podracer-model.js';
import { claimSeatKeyboard, endSeatKeyboard } from './seat-keys.js';
import { ensureDepotStyles, jobsHtml, meterHtml, money } from './depot-shell.js';
import { makeContactTrack } from './world-feed.js';
import { seatHidePanel } from '../../../shared/compact-view.js';
import { bindBigScreenButton, exitBigScreen, BIGSCREEN_GLYPH, BIGSCREEN_TITLE } from './bigscreen.js';

const ID = 'podracer-sim';
const RAD = 20;                    // map window half-width; must match RADIUS in plugins/podracer/seat.js
const SYNC_MS = 250;
const LEVER_UP = 2.2, LEVER_DOWN = 1.8;    // lever travel per second: W pushes them up, letting go lets them back
const SPLIT_RATE = 5, SPLIT_BACK = 9;       // how fast A / D swing the vanes over, and back to centre
const CAM_FOLLOW = 4;                       // how fast the chase camera comes round after the turbines
const INNER_CUT = 0.25;
// Reverse: hold S at a standstill this long and the reversers take over from the air brakes; S then
// backs you up, slowly, until the racer is going forward again.
const REV_HOLD_S = 1.2, REV_STILL_MPH = 2, REV_CLEAR_MPH = 3;                     // what a full A / D takes off the inside turbine
const RECENTRE = 6;
// The hover: how far the craft rides off the ground with the turbines lit, in tiles, and how much
// the ground under it shakes it.
const HOVER = 0.02, HOVER_BUMP = 0.004;
// The chase camera's standoff as a share of the renderer's, which is sized for aircraft: the racer is
// under half a tile long and at the full standoff it is a speck.
const CHASE = [{ zoom: 0.24, pitch: 0.14 }, { zoom: 0.5, pitch: 0.28 }];
// The cameras V steps through: the seat first, then the two chases.
const CAMS = [{ seat: true, label: 'SEAT' }, { ...CHASE[0], label: 'NEAR' }, { ...CHASE[1], label: 'FAR' }];
// The seat's metre: the ground seats' own (windshield.js SEAT_EYE_TILES / EYE_M, 0.12 tiles is a
// 2.6 m eye), which is the scale interior-podracer.js and the pod in the mesh are built to.
const SEAT_METRE = 0.12 / EYE_M;
const EYE_M_POD = 1.2;                      // the eye over the ground, sat in the pod
const LOOK_YAW = 135, LOOK_PITCH = 55;

let st = null;
const send = (cmd) => { try { st?.onSend?.(cmd); } catch { /* the pane can outlive the socket */ } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap180 = (d) => ((d + 540) % 360) - 180;

// ── The map window ─────────────────────────────────────────────────────────────
// An unknown tile is open ground: the window is finite and the craft reaches its edge between
// streams. A tile the server sends as `air` has no ground: outside every region and off the highway's
// band. It is solid.
const OPEN = { kind: 'land', road: 0 };
function cellAt(dx, dy) {
  const gx = Math.round(st.cx + dx), gy = Math.round(st.cy + dy);
  const row = st.tiles[gy - st.oy];
  return (row && row[gx - st.ox]) || OPEN;
}
function buildWindow() {
  const N = RAD * 2 + 1, map = [];
  for (let j = 0; j < N; j++) {
    const row = [];
    for (let i = 0; i < N; i++) row.push(cellAt(i - RAD, j - RAD));
    map.push(row);
  }
  return map;
}
// Solid: outside the region, high ground (mesa tops and their cliff rims both stand a tile up), and
// any building, except a building's drive-through bay door (`mark: 'bay'`, flags.vehicle_bay): the
// racer comes out of the Deadleg's shed through it, the truck's way.
function solid(x, y) {
  const c = cellAt(x, y);
  return c.kind === 'air' || !!c.hi || (!!c.bt && c.mark !== 'bay');
}
function surfaceAt(x, y) {
  const c = cellAt(x, y);
  if (c.biome === 'water' || c.sub) return 'water';
  if (c.road || c.ft === 'dust') return 'road';
  return 'redrock';
}

export function isPodracerActive() { return !!st; }
// Where the depot's bay overlay mounts: the seat's own root (podracer-depot.js openPodracerBay).
export function podracerServiceHost() { return st ? st.root : null; }

export function openPodracer(ctx = {}) {
  closePodracer();
  ensureWindshieldStyles();
  const host = ctx.mount || document.getElementById('area-content');
  if (!host) return;
  const p = ctx.params || PODRACER_TYPES[ctx.typeId] || PODRACER_TYPES.podracer;
  ensurePodStyles();
  host.innerHTML = '<div class="pod-root">'
    + `<div class="pod-view">${windshieldHTML(ID, (ctx.name || 'RACER').toUpperCase() + ' · SCARLETWASTES')}</div>`
    + '<div class="pod-chrome">'
    + '<canvas class="pod-lever" data-side="0" width="88" height="200" title="left turbine (W both, Q this one)"></canvas>'
    + '<canvas class="pod-lever" data-side="1" width="88" height="200" title="right turbine (W both, E this one)"></canvas>'
    + '<div class="pod-read"></div>'
    + '<div class="pod-keys"></div>'
    + '</div>'
    + '<div class="pod-panel">'
    + '<button class="pod-chip pod-ign" type="button" title="starters (hold K)">START · K</button>'
    + '<button class="pod-chip pod-hold" data-key="s" type="button" title="air brakes (hold B or S); held at a standstill, reverse">AIR BRAKE</button>'
    + '<button class="pod-chip pod-dock" type="button" title="Launch the turbines off the pod for full speed, or call them back in alongside (F)">⇈ LAUNCH · F</button>'
    + '<button class="pod-chip pod-park" type="button" title="Shut it down where it stands and climb out (Esc)">⏏ PARK &amp; CLIMB OUT</button>'
    + '</div>'
    + '<div class="pod-chips">'
    + '<button class="pod-chip pod-cam" type="button" title="seat / near / far (V)">◎ SEAT</button>'
    + '<button class="pod-chip pod-help-btn" type="button" title="controls (?)">?</button>'
    + '<button class="pod-chip pod-hidebtn" type="button" title="hide the text panel, keep the command bar">⊟</button>'
    + `<button class="pod-chip pod-big" type="button" title="${BIGSCREEN_TITLE}">${BIGSCREEN_GLYPH}</button>`
    + '<button class="pod-chip pod-x" type="button" title="climb out (ESC)">✕</button>'
    + '</div>'
    + '<div class="pod-out" hidden></div>'
    + '<div class="pod-broke" hidden></div>'
    + '<div class="pod-help" hidden></div>'
    + '</div>';
  const ownsPane = !ctx.mount;
  if (ownsPane) window.dispatchEvent(new Event('pane:claimed'));

  const sim = createPodracerState(p);
  if (Array.isArray(ctx.eng)) sim.engHp = [clamp(+ctx.eng[0] || 0, 0, 1), clamp(+ctx.eng[1] || 0, 0, 1)];
  if (Array.isArray(ctx.cables)) ctx.cables.forEach((ok, i) => { if (!ok) sim.cable[i].ok = false; });
  sim.hull = ctx.hull ?? 1;
  placePodracer(sim, p, 0, 0, ctx.heading ?? 0);
  if (ctx.binder === false) tornBinder(sim, p);

  st = {
    ownsPane, p, sim,
    name: ctx.name || 'racer',
    fuel: ctx.fuel ?? 1,
    recoverFee: ctx.recoverFee || 0,
    typeId: ctx.typeId || 'podracer',
    // The paint: the racer's own, and a scheme the booth is showing on it before it is bought.
    livery: ctx.livery || null, preview: null,
    // The fitted kit, and how it looks (the mesh channels for its bolt-ons, the arc and plume colours);
    // a kit the fitting shop is showing on it before it is bought (podracer-depot.js) wins.
    kit: ctx.kit || {}, kitPreview: null, kitLook: podracerLook(ctx.kit || {}),
    gLat: 0, gLong: 0, pv: null,
    cx: ctx.gx ?? 0, cy: ctx.gy ?? 0,
    ox: (ctx.gx ?? 0) - RAD, oy: (ctx.gy ?? 0) - RAD,
    tiles: ctx.map || [],
    lever: [0, 0], set: [0, 0], split: 0, leverHeld: [false, false],
    starter: false, keys: new Set(),
    camH: ctx.heading ?? 0, cam: 0, extYaw: 0, drag: null,
    look: { yaw: 0, pitch: 0 }, hover: null, press: null, lever3d: null, frame: null,
    first: !!ctx.first,
    hour: ctx.hour ?? 12, weather: (ctx.weather || 'clear').toLowerCase(),
    wxField: ctx.wxField || null, wxGround: ctx.wxGround || null,
    contacts: makeContactTrack(),
    skyline: ctx.skyline || null, roads: ctx.roads || null, regions: ctx.regions || null,
    actors: ctx.actors || [],
    lastSync: 0, last: performance.now(), alive: true, raf: 0, hitAt: 0,
    onSend: ctx.onSend || null,
  };
  if (ctx.contacts) st.contacts.update(ctx.contacts);

  const root = host.querySelector?.('.pod-root') || host;
  st.root = root;
  st.pane = document.getElementById(ID)?.closest?.('.ws-wrap') || root;
  st.helpEl = root.querySelector?.('.pod-help') || null;
  st.outEl = root.querySelector?.('.pod-out') || null;
  st.brokeEl = root.querySelector?.('.pod-broke') || null;
  bindBigScreenButton(root.querySelector?.('.pod-big'));
  const hideBtn = root.querySelector?.('.pod-hidebtn');
  hideBtn?.addEventListener('click', () => { hideBtn.classList.toggle('on', document.body.classList.toggle('pod-hidepanel')); });
  seatHidePanel('pod-hidepanel', hideBtn);
  root.querySelector?.('.pod-x')?.addEventListener('click', () => toggleOut());
  root.querySelector?.('.pod-cam')?.addEventListener('click', () => cycleCam());
  root.querySelector?.('.pod-help-btn')?.addEventListener('click', () => toggleHelp());
  root.querySelectorAll?.('.pod-hold')?.forEach?.((b) => {
    const k = b.dataset.key;
    const up = () => { st?.keys?.delete(k); b.classList.remove('on'); };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); st?.keys?.add(k); b.classList.add('on'); });
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  });
  // A click cannot hold a starter, so it holds it for the crank time and lets go.
  root.querySelector?.('.pod-dock')?.addEventListener('click', () => { if (st) st.dockToggle = true; });
  // Park and climb out: straight out when stopped; moving, the climb-out panel says to stop first.
  root.querySelector?.('.pod-park')?.addEventListener('click', () => {
    if (!st) return;
    if (st.sim.speed <= 4) send('podevent park'); else toggleOut(true);
  });
  root.querySelector?.('.pod-ign')?.addEventListener('click', () => {
    if (st.sim.running) { shutDown(); return; }
    st.starter = true; st.clickCrank = CRANK_S + 0.4;
  });
  st.levers = [...(root.querySelectorAll?.('.pod-lever') || [])].map((c) => createLever(c, +c.dataset.side));
  buildHelp();
  buildOut();
  bindKeys();
  if (st.first) toggleHelp(true);
  claimSeatKeyboard(st.pane, { label: 'RACER' });
  st.raf = requestAnimationFrame(frame);
}

export function closePodracer() {
  if (!st) return;
  st.alive = false;
  cancelAnimationFrame(st.raf);
  window.removeEventListener('keydown', st.kd, true);
  window.removeEventListener('keyup', st.ku, true);
  for (const l of st.levers || []) l?.destroy?.();
  stopEngineAudio();
  exitBigScreen();
  document.body.classList.remove('pod-hidepanel');
  disposeWindshield(ID);
  endSeatKeyboard(st.pane);
  if (st.ownsPane) window.dispatchEvent(new Event('pane:released'));
  st = null;
}

// ── Keys ───────────────────────────────────────────────────────────────────────
function bindKeys() {
  st.kd = (e) => {
    if (!st || e.target?.closest?.('input, textarea, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (!st.helpEl?.hidden) { toggleHelp(false); return; }
      toggleOut(); return;
    }
    if (!e.repeat) {
      if (k === 'k') { e.preventDefault(); if (st.sim.running) shutDown(); else st.starter = true; return; }
      if (k === 'v') { e.preventDefault(); cycleCam(); return; }
      if (k === 'f') { e.preventDefault(); st.dockToggle = true; return; }
      if (k === '?' || k === '/') { e.preventDefault(); toggleHelp(); return; }
    }
    if (k.startsWith('arrow') || k === ' ') e.preventDefault();
    st.keys.add(k);
  };
  st.ku = (e) => {
    if (!st) return;
    const k = e.key.toLowerCase();
    if (k === 'k' && !st.clickCrank) st.starter = false;
    st.keys.delete(k);
  };
  window.addEventListener('keydown', st.kd, true);
  window.addEventListener('keyup', st.ku, true);

  const glass = document.getElementById(ID);
  if (!glass?.addEventListener) return;
  glass.addEventListener('contextmenu', (e) => e.preventDefault());
  // The control under the pointer, from where the renderer last put each one on screen.
  const hotAt = (e) => {
    if (!st || !CAMS[st.cam].seat) return null;
    const hs = interiorHotspots();
    if (!hs || !hs.list?.length) return null;
    const r = glass.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = (e.clientX - r.left) * (hs.W / r.width), y = (e.clientY - r.top) * (hs.H / r.height);
    let best = null, bd = Infinity;
    for (const h of hs.list) { const d = Math.hypot(x - h.x, y - h.y); if (d <= h.r && d < bd) { bd = d; best = h; } }
    return best;
  };
  glass.addEventListener('pointerdown', (e) => {
    if (!st) return;
    glass.setPointerCapture?.(e.pointerId);
    const h = e.button === 0 ? hotAt(e) : null;
    if (h) {
      e.preventDefault();
      st.press = h.id;
      if (h.id === 'ign') { if (st.sim.running) shutDown(); else { st.starter = true; st.clickCrank = CRANK_S + 0.4; } }
      else if (h.id === 'brake') st.keys.add('s');
      else if (h.id === 'boost') st.keys.add(' ');
      // The screen's soft-keys.
      else if (h.id === 'gui:cam') cycleCam();
      else if (h.id === 'gui:dock') st.dockToggle = true;
      else if (h.id === 'gui:help') toggleHelp();
      else if (h.id === 'gui:tow') send('podracer recover');
      else if (h.id === 'gui:exit') toggleOut(true);
      else if (h.id === 'levL' || h.id === 'levR') { const i = h.id === 'levL' ? 0 : 1; st.lever3d = { i, y: e.clientY }; st.leverHeld[i] = true; }
      return;
    }
    st.drag = { x: e.clientX, y: e.clientY };
  });
  glass.addEventListener('pointermove', (e) => {
    if (!st) return;
    if (st.lever3d) {
      // Up the screen is forward on the lever: about two hundred pixels end to end.
      const L = st.lever3d;
      st.lever[L.i] = st.set[L.i] = clamp(st.lever[L.i] - (e.clientY - L.y) / 200, 0, 1);
      L.y = e.clientY;
      return;
    }
    if (!st.drag) {
      const h = hotAt(e);
      st.hover = h ? h.id : null;
      glass.style.cursor = h ? (h.kind === 'drag' ? 'ns-resize' : 'pointer') : '';
      glass.title = h ? (HOT_TIP[h.id] || '') : '';
      return;
    }
    const dx = e.clientX - st.drag.x, dy = e.clientY - st.drag.y;
    st.drag = { x: e.clientX, y: e.clientY };
    if (CAMS[st.cam].seat) {
      st.look.yaw = clamp(st.look.yaw + dx * 0.35, -LOOK_YAW, LOOK_YAW);
      st.look.pitch = clamp(st.look.pitch - dy * 0.30, -LOOK_PITCH, LOOK_PITCH);
    } else st.extYaw = (st.extYaw + dx * 0.4) % 360;
  });
  const drop = () => {
    if (!st) return;
    st.drag = null;
    if (st.press === 'brake') st.keys.delete('s');
    if (st.press === 'boost') st.keys.delete(' ');
    if (st.lever3d) { st.leverHeld[st.lever3d.i] = false; st.lever3d = null; }
    st.press = null;
  };
  glass.addEventListener('pointerup', drop);
  glass.addEventListener('pointercancel', drop);
  glass.addEventListener('pointerleave', () => { if (st) st.hover = null; });
  glass.addEventListener('dblclick', () => { if (st) { st.extYaw = 0; st.look.yaw = 0; st.look.pitch = 0; } });
}

function shutDown() {
  st.sim.running = false;
  st.starter = false; st.clickCrank = 0;
  st.lever = [0, 0]; st.set = [0, 0];
  spoolDown('gunship');
  send('podevent stopped');
}
const HOT_TIP = { ign: 'START / STOP: the turbines (K)', brake: 'BRAKE: air brakes, hold (B or S)', boost: 'BOOST: hold, both levers near full; the turbines heat (Space)', 'gui:cam': 'CAM: the seat, then the near and far chase (V)', 'gui:dock': 'LAUNCH / DOCK: the turbines off the pod on their cables, or back in alongside (F)', 'gui:help': 'HELP: the controls (?)', 'gui:tow': 'TOW: the yard sends the flatbed for you and the racer (stopped)', 'gui:exit': 'EXIT: climb out (Esc)', levL: 'LEFT LEVER: drag up for thrust (W, Q)', levR: 'RIGHT LEVER: drag up for thrust (W, E)' };
function cycleCam() {
  st.cam = (st.cam + 1) % CAMS.length;
  st.look.yaw = 0; st.look.pitch = 0;
  st.frame = null;   // the driver picked a camera: the bay's shot is off
  camLabel();
}
function camLabel() {
  const b = st.root?.querySelector?.('.pod-cam');
  if (b) b.textContent = '◎ ' + CAMS[st.cam].label;
}
/**
 * The bay's shot (camera-tween.js SHOTS): while the yard works on it, the camera stands off the racer
 * at a named angle, the way the other seats' bays do (cab-view.js cabFrame). It takes the near chase
 * and keeps its own pitch and standoff in `st.frame`; `null` hands back the camera the driver had.
 * A drag mid-move takes the yaw back, and V drops the shot.
 */
export function podracerFrame(shot, ms = 700) {
  if (!st) return;
  if (!shot) { if (st.frame) { st.cam = st.frame.cam; st.frame = null; camLabel(); } return; }
  if (!st.frame) st.frame = { cam: st.cam, pitch: CHASE[0].pitch, zoom: CHASE[0].zoom };
  if (CAMS[st.cam].seat) { st.cam = 1; camLabel(); }
  tweenOrbit(st, { yaw: 'extYaw' }, { yaw: shot.yaw - (RENDER_TUNE.chaseYaw || 0) }, ms);
  tweenOrbit(st.frame, { pitch: 'pitch', zoom: 'zoom' }, { pitch: shot.pitch, zoom: CHASE[0].zoom * shot.zoom }, ms);
}

// The controls play like the arcade racer: hold W for thrust and let go to coast, A / D steer, S or
// Space brakes, Shift slides, E boosts. Under that the levers are real: W pushes both up and they
// fall back to wherever a hand left them, so a lever dragged up is a cruise setting, and a split
// between them steers. Braking takes the hand setting off as well.
function readInput(dt) {
  const k = st.keys;
  const thr = k.has('w') || k.has('arrowup');
  // Q and E are one turbine each: the left and the right lever, on their own.
  const one = [k.has('q'), k.has('e')];
  // The air brakes: B, or S / down.
  const brakeKey = k.has('b') || k.has('s') || k.has('arrowdown');
  // Reverse: S (or B) held at a standstill for REV_HOLD_S engages it; it stays engaged, S backing
  // you up, until the racer is going forward again. Forward is along the pod's nose.
  const fwdMph = (st.sim.pod.vx * Math.sin(st.sim.pod.a) - st.sim.pod.vy * Math.cos(st.sim.pod.a)) * st.p.tileMph;
  if (!st.reversing) {
    st.revHeld = brakeKey && Math.abs(fwdMph) < REV_STILL_MPH && st.sim.running ? (st.revHeld || 0) + dt : 0;
    if (st.revHeld >= REV_HOLD_S) { st.reversing = true; st.flash = { text: 'REVERSE: S BACKS YOU UP · W TO GO', until: performance.now() + 2500 }; }
  } else if (fwdMph > REV_CLEAR_MPH || !st.sim.running) { st.reversing = false; st.revHeld = 0; }
  const brake = brakeKey && !st.reversing;
  if (brake) st.set = [0, 0];
  for (let i = 0; i < 2; i++) {
    if (st.leverHeld[i]) continue;
    const to = thr || one[i] ? 1 : st.set[i];
    st.lever[i] = clamp(st.lever[i] + clamp(to - st.lever[i], -LEVER_DOWN * dt, LEVER_UP * dt), 0, 1);
  }
  const want = ((k.has('d') || k.has('arrowright')) ? 1 : 0) - ((k.has('a') || k.has('arrowleft')) ? 1 : 0);
  // The vanes swing over at SPLIT_RATE and come back to centre faster, so a tap is a clean nudge.
  const rate = want === 0 || Math.sign(want) !== Math.sign(st.split) ? SPLIT_BACK : SPLIT_RATE;
  st.split += clamp(want - st.split, -rate * dt, rate * dt);
  // D (split > 0) steers right and eases the right turbine a little, which helps it round.
  const left = st.lever[0] * (1 - INNER_CUT * Math.max(0, -st.split));
  const right = st.lever[1] * (1 - INNER_CUT * Math.max(0, st.split));
  return {
    left, right, steer: st.split,
    brake: brake ? 1 : 0,
    reverse: st.reversing && brakeKey ? 1 : 0,
    dockToggle: !!st.dockToggle,
    slide: k.has('shift'),
    boost: k.has(' '),
    // The starters will not turn with the levers open.
    starter: st.starter && st.lever[0] < 0.05 && st.lever[1] < 0.05,
    fuel: st.fuel,
    solid, surface: surfaceAt(st.sim.x, st.sim.y),
  };
}

// ── The frame ──────────────────────────────────────────────────────────────────
function frame(now) {
  if (!st || !st.alive) return;
  const dt = Math.min(0.05, (now - st.last) / 1000);
  st.last = now;
  try {
    const input = readInput(dt);
    st.dockToggle = false;
    if (st.fuel <= 0) { st.lever = [0, 0]; input.left = input.right = 0; }
    else st.fuel = Math.max(0, st.fuel - podracerBurn(st.sim, st.p, dt));
    stepPodracer(st.sim, input, st.p, dt);
    gMeter(dt);
    // The petals open in a quarter of a second and fold away a little slower.
    st.brakeAnim = clamp((st.brakeAnim || 0) + (input.brake || input.reverse ? dt / 0.25 : -dt / 0.4), 0, 1);
    // The latch blades: out of the pod into the turbines' sockets once both are home (a fifth of a
    // second, with the thunk), and back in faster than the turbines leave on a launch.
    st.podStow = clamp((st.podStow ?? (st.sim.mode === 'docked' ? 0 : 1)) + (st.sim.mode === 'docked' ? -dt / 0.2 : dt / 0.12), 0, 1);
    for (const ev of st.sim.events) onEvent(ev);
    if (st.clickCrank) { st.clickCrank -= dt; if (st.sim.running || st.clickCrank <= 0) { st.clickCrank = 0; st.starter = false; } }

    if (Math.abs(st.sim.x) > RECENTRE || Math.abs(st.sim.y) > RECENTRE) {
      const dx = Math.round(st.sim.x), dy = Math.round(st.sim.y);
      st.cx += dx; st.cy += dy;
      shiftPodracerOrigin(st.sim, -dx, -dy);
    }

    // The camera follows the pod's heading, eased, so the chase does not whip with the pod.
    // The chase camera follows the turbines, which are what you steer; following the pod, every swing
    // of it on its cables swung the whole view.
    const engH = Math.atan2(Math.sin(st.sim.eng[0].a) + Math.sin(st.sim.eng[1].a), Math.cos(st.sim.eng[0].a) + Math.cos(st.sim.eng[1].a)) * 180 / Math.PI;
    st.camH = (st.camH + wrap180(engH - st.camH) * (1 - Math.exp(-dt * CAM_FOLLOW)) + 360) % 360;
    const spd01 = clamp(st.sim.speed / st.p.topSpeed, 0, 1);
    updateEngineAudio({
      class: 'gunship', engineOn: !!st.sim.running, airborne: true,
      throttle: Math.round((st.sim.pedal[0] + st.sim.pedal[1]) * 50), spd: st.sim.speed,
    });
    const lit = st.sim.running ? 1 : 0;
    st.ride = (st.ride ?? 0) + (lit - (st.ride ?? 0)) * (1 - Math.exp(-dt / 1.2));
    const bump = Math.sin(now / 90 + st.sim.x * 7) * Math.sin(now / 143 + st.sim.y * 5) * HOVER_BUMP * spd01;
    const cam = CAMS[st.cam];
    const lv = lastViewState();
    const rideZ = (HOVER + bump) * st.ride;
    // The seat: the driver's eye over the ground, the pod as its interior and the cockpit's live
    // values. The chase: the orbit, with the camera's lag riding on it.
    const view = cam.seat
      ? { external: false, seatModel: true, height: 0, eyeH: EYE_M_POD * SEAT_METRE + rideZ,
          lookYaw: st.look.yaw, lookPitch: st.look.pitch, instr: seatLive() }
      : { external: true, extYaw: st.extYaw + wrap180(st.camH - st.sim.heading), extPitch: st.frame ? st.frame.pitch : cam.pitch,
          extZoom: Math.max(st.frame ? st.frame.zoom : cam.zoom, lv && lv.chaseZoomFloor > 0 ? lv.chaseZoomFloor : 0) };
    paintWindshield(ID, {
      cls: 'podracer', phase: 'cruise', worldBlend: 1,
      map: buildWindow(), mapCenter: { x: st.cx, y: st.cy },
      mapOffset: { x: st.sim.x, y: st.sim.y },
      // The craft's own heading. The chase camera's lag rides on the orbit, because with any orbit
      // the renderer takes `heading` as the craft's and sets `ownHdg` from it.
      heading: st.sim.heading,
      pitch: 0, bank: 0, roll: 0,
      rideZ,
      ...view,
      speed: st.sim.speed, powered: !!st.sim.running,
      hour: st.hour, weather: st.weather, wxField: st.wxField, wxGround: st.wxGround,
      actors: st.actors,
      acX: st.cx + st.sim.x, acY: st.cy + st.sim.y,
      contacts: st.contacts.size ? st.contacts.frame(st.cx + st.sim.x, st.cy + st.sim.y, { roadRig: ROAD_RIG_MUL }) : null,
      skyline: st.skyline, roads: st.roads, regions: st.regions,
      podracer: { ...podracerPose(st.sim, st.p), arc: st.kitLook.arc, flame: st.kitLook.flame, pipes: !!st.kitLook.anim.kit_pipes },
      variant: st.typeId,
      ...((st.preview || st.livery || st.kitLook.casing) ? { livery: podracerLivery(st.preview || st.livery, st.kitPreview || st.kit) } : {}),
      // The air brake petals on the turbines (mesh channel airbrake), easing out and back, and the
      // kit's bolt-on parts on theirs.
      anim: { airbrake: st.brakeAnim, podStow: st.podStow, ...st.kitLook.anim },
    });
    drawRead();

    if (now - st.lastSync >= SYNC_MS) {
      st.lastSync = now;
      const parts = podracerParts(st.sim, st.p);
      const ex = (parts.L.x + parts.R.x) / 2, ey = (parts.L.y + parts.R.y) / 2;
      const s = st.sim;
      // x y heading speed hull engL engR fuel leverL leverR cables binder ex ey eh (seat.js unpacks)
      send('podsync '
        + (st.cx + s.x).toFixed(3) + ' ' + (st.cy + s.y).toFixed(3) + ' '
        + Math.round(s.heading) + ' ' + Math.round(s.speed) + ' '
        + s.hull.toFixed(4) + ' ' + s.engHp[0].toFixed(4) + ' ' + s.engHp[1].toFixed(4) + ' ' + st.fuel.toFixed(4) + ' '
        + s.lever[0].toFixed(2) + ' ' + s.lever[1].toFixed(2) + ' '
        + ((s.cable[0].ok ? 1 : 0) | (s.cable[1].ok ? 2 : 0)) + ' ' + (s.binder ? 1 : 0) + ' '
        + (st.cx + ex).toFixed(3) + ' ' + (st.cy + ey).toFixed(3) + ' ' + Math.round(parts.L.h));
    }
  } catch (e) {
    if (!st._errLogged) { console.error('[podracer] frame error (view kept alive, report this stack):', e); st._errLogged = true; }
  }
  st.raf = requestAnimationFrame(frame);
}

// What the pod's dash and levers show (interior-podracer.js reads these keys).
function seatLive() {
  const s = st.sim;
  return {
    running: !!s.running, lever: st.lever, rpm: s.rpm, eng: s.engHp,
    tension: s.cable.map((c) => c.gauge), cable: s.cable.map((c) => c.ok), binder: s.binder, binderStrain: s.binderStrain,
    speed: s.speed, fuel: st.fuel, hull: s.hull, brake: st.keys.has('b') || st.keys.has('s') || st.keys.has('arrowdown'),
    whip: s.whip || 0, whipping: (s.whipT || 0) > 0, reversing: !!st.reversing, mode: s.mode, binderPower: s.binderPower || 0,
    heat: s.heat, boosting: s.boosting, sliding: s.sliding, steer: st.split, t: performance.now(),
    inside: (st.preview || st.livery)?.inside || null, typeName: st.p.name, typeId: st.typeId,
    heading: s.heading, gLat: st.gLat, gLong: st.gLong, kit: st.kitPreview || st.kit, arcRgb: st.kitLook.arc || undefined,
    hover: st.hover, press: st.press,
  };
}

// The pod's acceleration in g, along its nose and across it (right positive), smoothed over a fifth
// of a second: the cockpit's G-meter. The model's own rule for g (mph/s over 22).
function gMeter(dt) {
  const P = st.sim.pod, v = [P.vx, P.vy];
  if (st.pv && dt > 0) {
    const ax = (v[0] - st.pv[0]) / dt, ay = (v[1] - st.pv[1]) / dt, k = st.p.tileMph / 22;
    const fx = Math.sin(P.a), fy = -Math.cos(P.a);
    const lon = (ax * fx + ay * fy) * k, lat = (ax * -fy + ay * fx) * k;
    const e = 1 - Math.exp(-dt / 0.2);
    st.gLong += (clamp(lon, -6, 6) - st.gLong) * e; st.gLat += (clamp(lat, -6, 6) - st.gLat) * e;
  }
  st.pv = v;
}

function onEvent(ev) {
  const type = typeof ev === 'string' ? ev : ev?.type;
  if (type === 'started') { spoolUp('gunship'); send('podevent started'); }
  else if (type === 'cutout') { spoolDown('gunship'); }
  else if (type === 'snap') { hitFx(); send('podevent snap'); }
  else if (type === 'launch') { groundFx('touchdown'); st.flash = { text: 'LAUNCHED: CABLES OUT, BINDER UP', until: performance.now() + 2000 }; }
  else if (type === 'docking') { st.flash = { text: 'DOCKING: TURBINES COMING IN', until: performance.now() + 1600 }; }
  else if (type === 'docked') { groundFx('latch'); st.flash = { text: 'DOCKED ALONGSIDE: LATCHED', until: performance.now() + 1500 }; }
  else if (type === 'whip') { groundFx('touchdown'); st.flash = { text: 'WHIP ' + Math.round(ev.k * 100) + '%', until: performance.now() + 1200 }; }
  else if (type === 'overheat') { groundFx('touchdown'); st.flash = { text: (ev.eng ? 'RIGHT' : 'LEFT') + ' TURBINE BURNING: LET THE BOOST OFF', until: performance.now() + 2500 }; }
  else if (type === 'binder') { groundFx('touchdownHard'); spoolDown('gunship'); send('podevent binder'); st.flash = { text: 'BINDER TORN OUT: TURBINES CUT', until: performance.now() + 4000 }; }
  else if (type === 'nobinder') { st.flash = { text: 'NO BINDER: THE TURBINES WILL NOT LIGHT', until: performance.now() + 2500 }; }
  else if (type === 'wrecked') { groundFx('touchdownHard'); send('podevent wrecked'); }
  else if (type === 'hit' && ev.mph > 15 && performance.now() - st.hitAt > 300) { st.hitAt = performance.now(); groundFx(ev.mph > 60 ? 'touchdownHard' : 'touchdown'); }
}

function drawRead() {
  const el = st.root?.querySelector?.('.pod-read');
  if (el) {
    const s = st.sim;
    const head = s.running ? Math.round(s.speed) + ' MPH'
      : (s.crank > 0 ? 'STARTERS TURNING…' : st.fuel <= 0 ? 'DRY: NO START' : (st.starter && (st.lever[0] >= 0.05 || st.lever[1] >= 0.05)) ? 'LEVERS TO IDLE TO START' : 'TURBINES COLD · K');
    const cab = (i) => (s.cable[i].ok ? String(Math.round(s.cable[i].gauge)).padStart(4, ' ') : ' CUT');
    el.textContent = head + '   CABLES ' + cab(0) + ' /' + cab(1)
      + '   TURBINES ' + Math.round(s.engHp[0] * 100) + '/' + Math.round(s.engHp[1] * 100) + '%'
      + '   POD ' + Math.round(s.hull * 100) + '%   FUEL ' + Math.round(st.fuel * 100) + '%'
      + '   HEAT ' + Math.round((s.heat?.[0] || 0) * 100) + '/' + Math.round((s.heat?.[1] || 0) * 100) + '%'
      + (s.mode === 'launched' ? '   LAUNCHED' : s.mode === 'docking' ? '   DOCKING' : '   DOCKED')
      + (st.reversing ? '   REVERSE' : '')
      + (s.boosting ? '   BOOST' : '')
      + (s.sliding ? '   SLIDE ' + '▮'.repeat(Math.round((s.whip || 0) * 5)) + '▯'.repeat(5 - Math.round((s.whip || 0) * 5)) : '')
      + ((s.whipT || 0) > 0 ? '   WHIP' : '')
      + (s.binder ? '' : '   BINDER GONE')
      + (st.flash && performance.now() < st.flash.until ? '   ' + st.flash.text : '');
    el.classList.toggle('pod-hot', (s.heat?.[0] || 0) > 0.8 || (s.heat?.[1] || 0) > 0.8);
    el.classList.toggle('pod-dead', !s.running);
  }
  const keys = st.root?.querySelector?.('.pod-keys');
  if (keys) keys.textContent = st.sim.running
    ? 'F launch / dock · W thrust · Q/E one turbine · A/D steer · B or S air brakes (hold still: reverse) · SHIFT slide, let go to whip · SPACE boost · K shut down · V camera · ? controls · ESC'
    : 'TURBINES COLD: hold K or click START · ? controls · ESC climb out';
  for (const l of st.levers || []) l?.draw?.();
  drawBroke();
  const dk = st.root?.querySelector?.('.pod-dock');
  if (dk) { const t = st.sim.mode === 'launched' ? '⇊ DOCK · F' : '⇈ LAUNCH · F'; if (dk.textContent !== t) dk.textContent = t; dk.disabled = !st.sim.running || !st.sim.binder; }
  const ign = st.root?.querySelector?.('.pod-ign');
  if (ign) { ign.textContent = st.sim.running ? 'SHUT DOWN · K' : 'START · K'; ign.classList.toggle('on', !!st.sim.running); }
}

// ── The levers, as things you can grab ─────────────────────────────────────────
const LEVER_PAD = 22;
function createLever(canvas, side) {
  if (!canvas) return null;
  let dragging = false;
  const set = (e) => {
    const r = canvas.getBoundingClientRect();
    if (!r.height) return;
    const pad = LEVER_PAD * (r.height / canvas.height);
    st.lever[side] = st.set[side] = clamp(1 - (e.clientY - r.top - pad) / Math.max(1, r.height - pad * 2), 0, 1);
  };
  const down = (e) => { dragging = true; st.leverHeld[side] = true; canvas.setPointerCapture?.(e.pointerId); set(e); e.preventDefault(); };
  const move = (e) => { if (dragging) set(e); };
  const up = () => { dragging = false; if (st) st.leverHeld[side] = false; };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';
  return {
    draw() {
      const g = canvas.getContext?.('2d');
      if (!g) return;
      const W = canvas.width, H = canvas.height, pad = LEVER_PAD, x = W * 0.5, y0 = H - pad, y1 = pad;
      g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(14,10,8,.72)'; g.strokeStyle = 'rgba(190,140,100,.45)'; g.lineWidth = 2;
      g.beginPath(); g.roundRect?.(x - 20, 4, 40, H - 8, 10); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(230,190,150,.5)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x, y1); g.lineTo(x, y0); g.stroke();
      for (let i = 0; i <= 4; i++) {
        const yy = y0 + (y1 - y0) * (i / 4);
        g.lineWidth = 2; g.beginPath(); g.moveTo(x - 13, yy); g.lineTo(x + 13, yy); g.stroke();
      }
      // The knob sits at the lever; a ghost shows what the split has taken off it.
      const eff = st.sim.lever[side];
      const ky = y0 + (y1 - y0) * clamp(st.lever[side], 0, 1), ey = y0 + (y1 - y0) * clamp(eff, 0, 1);
      if (Math.abs(ky - ey) > 2) { g.fillStyle = 'rgba(255,170,90,.35)'; g.beginPath(); g.arc(x, ey, 9, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = st.sim.running ? 'rgba(255,226,196,.95)' : 'rgba(255,120,104,.8)';
      g.lineWidth = 6; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, ky); g.stroke();
      g.fillStyle = st.sim.running ? '#ffd9b0' : '#ff8a78';
      g.beginPath(); g.arc(x, ky, 13, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(18,10,6,.85)'; g.beginPath(); g.arc(x, ky, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(230,200,170,.8)'; g.font = '600 13px ui-monospace,monospace'; g.textAlign = 'center';
      g.fillText(side ? 'RIGHT' : 'LEFT', x, 16); g.fillText('IDLE', x, H - 5);
    },
    destroy() {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
    },
  };
}

// ── Flaps ──────────────────────────────────────────────────────────────────────
function toggleHelp(show) {
  if (!st?.helpEl) return;
  st.helpEl.hidden = show == null ? !st.helpEl.hidden : !show;
  if (!st.helpEl.hidden && st.first) { st.first = false; send('podevent learned'); }
}
function buildHelp() {
  if (!st?.helpEl) return;
  st.helpEl.innerHTML = '<h4>THE RACER</h4><dl>'
    + '<dt>K</dt><dd>starters: hold to turn both turbines over, press again to shut down. They will not start with the levers open.</dd>'
    + '<dt>F</dt><dd>launch and dock. It starts docked: the turbines locked alongside the pod, the cables reeled in, one compact craft good for about 150 mph. Launched, they are kicked off forward on the cables and the binder comes up, stronger the faster you go and the harder you turn: the full 300. F again and they fall back in alongside.</dd>'
    + '<dt>W</dt><dd>thrust: hold it and both levers go up; let go and they come back to where your hand left them.</dd>'
    + '<dt>Q / E</dt><dd>one turbine each, left and right. Q alone pulls you round to the right, E to the left; both is W.</dd>'
    + '<dt>A / D</dt><dd>steer. The split vanes turn the turbines and the pod follows on its cables. A tap is a nudge; sharper slow, gentler flat out.</dd>'
    + '<dt>B / S</dt><dd>air brakes: four petals swing out of each turbine while you hold it, and the pod has its own. Held at a standstill for a second, the petals go into the exhaust as reversers and it backs up, slowly, until you open the throttle again. Braking also takes any lever you set by hand back to idle.</dd>'
    + '<dt>SHIFT</dt><dd>power slide: the vanes turn harder and the pod hangs out wide. The longer it hangs out the more it charges; let go and it whips back on its cables and the turbines kick.</dd>'
    + '<dt>SPACE</dt><dd>boost, with both levers near full. The turbines heat while it is lit and cool off it; past the red they burn.</dd>'
    + '<dt>THE LEVERS</dt><dd>drag either one, here or on the quadrant in the pod, to set a cruise. Pull them apart and the craft turns toward the low one.</dd>'
    + '<dt>V</dt><dd>the seat, then a near and a far chase camera. In the seat, drag to look round; in a chase, drag to swing round. Double-click to come back.</dd>'
    + '<dt>IN THE POD</dt><dd>drag either lever on the quadrant, click START, hold BRAKE, hold BOOST under its cover. The scope in the middle of the dash draws the craft from above: the cables in their load colours and the binder arcing between the turbines.</dd>'
    + '<dt>ESC</dt><dd>climb out. Stop first.</dd>'
    + '</dl><p class="pod-help-foot">The pod swings wide in a hard turn. A yank on a cable snaps it, and hitting rock at speed tears the binder out. Press <b>?</b> or <b>Esc</b> to close.</p>';
  st.helpEl.addEventListener('click', () => toggleHelp(false));
}
function buildOut() {
  if (!st?.outEl) return;
  st.outEl.innerHTML = '<h4>CLIMB OUT</h4><p class="pod-out-note"></p>'
    + '<button class="pod-chip pod-out-go" type="button">climb out</button>'
    + '<button class="pod-chip pod-out-no" type="button">stay in</button>';
  st.outEl.querySelector('.pod-out-go')?.addEventListener('click', () => { toggleOut(false); send('podevent park'); });
  st.outEl.querySelector('.pod-out-no')?.addEventListener('click', () => toggleOut(false));
}
// The breakdown: once the binder has gone and the racer has stopped, a panel in the depot's own
// look (depot-shell.js: the job tiles, the meters) says what is wrong and offers the ways out as
// tiles, each a verb: the flatbed (podracer recover), climbing out (podevent park), or staying put.
// Dismissed, it stays away until the racer is mended.
const BROKE_TILES = { tow: 'podracer recover', out: 'podevent park' };
function drawBroke() {
  const el = st?.brokeEl;
  if (!el) return;
  const want = !st.sim.binder && st.sim.speed < 6 && !st.brokeDismissed;
  if (el.hidden === !want) return;
  el.hidden = !want;
  if (!want) return;
  ensureDepotStyles();
  el.className = 'pod-broke ds-root';
  const sim = st.sim, fee = Math.round(st.recoverFee || 0);
  const cut = sim.cable.map((c, i) => (c.ok ? '' : (i ? 'right' : 'left'))).filter(Boolean);
  el.innerHTML = '<header class="ds-bay-head"><div class="ds-title"><span class="ds-title-ico" aria-hidden="true">⚡</span>'
    + '<b>Binder torn out</b><span class="ds-dim"> · the turbines will not light</span></div></header>'
    + jobsHtml([
      { id: 'tow', ico: '🚚', label: 'Flatbed', sub: fee ? money(fee) : 'free', tone: 'warn' },
      { id: 'out', ico: '⏏', label: 'Climb out', sub: 'leave it here' },
      { id: 'stay', ico: '✕', label: 'Stay in', sub: 'look round' },
    ], '', 'data-pb')
    + '<div class="ds-bay-body"><div class="ds-panel">'
    + meterHtml('binder', 0) + meterHtml('left turbine', sim.engHp[0]) + meterHtml('right turbine', sim.engHp[1]) + meterHtml('pod', sim.hull)
    + '<div class="ds-dim ds-small">Cables: ' + (cut.length ? '<b>' + cut.join(' and ') + ' cut</b>' : 'both whole') + '</div>'
    + '</div></div>'
    + '<div class="ds-bay-foot ds-dim">The flatbed takes you and the racer to the bay at the Deadleg, where <b>podracer service</b> welds a new binder in.</div>';
  el.onclick = (e) => {
    const b = e.target.closest?.('[data-pb]');
    if (!b) return;
    const id = b.dataset.pb;
    if (BROKE_TILES[id]) send(BROKE_TILES[id]);
    else { st.brokeDismissed = true; el.hidden = true; }
  };
}

function toggleOut(show) {
  if (!st?.outEl) return;
  st.outEl.hidden = show == null ? !st.outEl.hidden : !show;
  if (st.outEl.hidden) return;
  const note = st.outEl.querySelector('.pod-out-note');
  if (note) note.textContent = st.sim.speed > 4
    ? 'Not at this speed. Take the levers off and let it stop.'
    : 'You leave it parked where it stands. podracer climbs back in.';
}

// The booth shows a livery on the racer before it is bought (podracer-depot.js); null takes it off.
export function podracerPreview(livery) { if (st) st.preview = livery || null; }
// The fitting shop shows a kit's looks on the racer before it is bought; null takes it off.
export function podracerKitPreview(kit) { if (!st) return; st.kitPreview = kit || null; st.kitLook = podracerLook(kit || st.kit); }

// ── What the server pushes ─────────────────────────────────────────────────────
export function podracerSetWorld(msg = {}) {
  if (!st) return;
  if (msg.map) { st.tiles = msg.map; st.ox = (msg.gx ?? st.cx) - RAD; st.oy = (msg.gy ?? st.cy) - RAD; }
  if (msg.hour != null) st.hour = msg.hour;
  if (msg.weather) st.weather = String(msg.weather).toLowerCase();
  if (msg.wxField !== undefined) st.wxField = msg.wxField || null;
  if (msg.wxGround) st.wxGround = msg.wxGround;
  if (msg.contacts) st.contacts.update(msg.contacts);
  if (msg.skyline) st.skyline = msg.skyline;
  if (msg.roads !== undefined) st.roads = msg.roads || null;
  if (msg.regions) st.regions = msg.regions;
  if (msg.actors !== undefined) st.actors = msg.actors || [];
  // The yard put it right (podracer service in the shed door): the live racer takes the repair, or
  // the next report would send the old wear back.
  if (msg.hull != null) st.sim.hull = msg.hull;
  if (msg.fuel != null) st.fuel = msg.fuel;
  if (Array.isArray(msg.eng)) st.sim.engHp = msg.eng.slice(0, 2);
  if (Array.isArray(msg.cables)) msg.cables.forEach((ok, i) => { if (ok && st.sim.cable[i]) st.sim.cable[i].ok = true; });
  if ('livery' in msg) { st.livery = msg.livery || null; st.preview = null; }
  // The fitting shop refitted it in the door: the seat steps the new row from the next frame.
  if (msg.params) st.p = msg.params;
  if (msg.kit) { st.kit = msg.kit; st.kitPreview = null; st.kitLook = podracerLook(st.kit); }
  if (msg.binder === true && !st.sim.binder) { mendBinder(st.sim, st.p); st.brokeDismissed = false; }
  // The server refused a report: put the racer back where it last believed it was, stopped.
  if (msg.snap) placePodracer(st.sim, st.p, msg.snap.x - st.cx, msg.snap.y - st.cy, msg.snap.heading || 0);
}

function ensurePodStyles() {
  const el = document.getElementById('pod-styles') || document.createElement('style');
  el.id = 'pod-styles';
  el.textContent = `
    body.pod-hidepanel #area-pane{max-height:none !important;height:auto !important;flex:1 1 auto}
    body.pod-hidepanel #area-content{flex:1 1 auto;display:flex;min-height:0}
    body.pod-hidepanel #output, body.pod-hidepanel #look-resize-handle{display:none}
    .pod-hidebtn.on{ color:#ffc890; }
    #area-content:has(.pod-root){ height:100%; overflow:hidden; overscroll-behavior:contain; touch-action:none; }
    .pod-root{ position:relative; width:100%; height:100%; min-height:380px; overflow:hidden;
      overscroll-behavior:contain; touch-action:none; background:#0b0605; }
    .pod-view, .pod-view .ws-wrap{ position:absolute; inset:0; }
    .pod-chrome{ position:absolute; left:10px; bottom:30px; display:flex; align-items:flex-end; gap:8px; pointer-events:none; }
    .pod-lever{ width:54px; height:132px; pointer-events:auto; }
    .pod-read{ font:600 14px/1.5 ui-monospace,monospace; color:#ffe2c4; letter-spacing:.05em;
      text-shadow:0 1px 3px #000; padding:0 0 6px 6px; white-space:pre; }
    .pod-read.pod-dead{ color:#ff9c8c; }
    .pod-read.pod-hot{ color:#ffb36b; text-shadow:0 0 8px rgba(255,120,40,.6); }
    .pod-keys{ position:absolute; left:0; bottom:-18px; white-space:nowrap;
      font:500 11px/1.4 ui-monospace,monospace; color:#a88f7d; letter-spacing:.04em; }
    .pod-chips{ position:absolute; right:10px; top:10px; display:flex; gap:6px; }
    .pod-panel{ position:absolute; right:10px; bottom:30px; display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
    .pod-chip{ background:rgba(16,10,8,.74); border:1px solid #3d2a20; color:#ccb19f;
      font:600 13px/1 ui-monospace,monospace; padding:6px 9px; border-radius:4px; cursor:pointer; }
    .pod-chip:hover{ color:#fff0e2; border-color:#5c4030; }
    .pod-chip.on{ color:#ffe2c4; border-color:#8c5a3a; background:rgba(64,34,20,.82); }
    .pod-hold{ touch-action:none; user-select:none; min-width:96px; }
    .pod-dock{ min-width:120px; padding:8px 12px; border-color:#ff6a2b; color:#ffd2b8; }
    .pod-dock:disabled{ opacity:.45; }
    .pod-park{ min-width:120px; padding:8px 12px; border-color:#3a8fb0; color:#bfe8ff; }
    .pod-ign{ min-width:120px; padding:10px 12px; border-color:#b0703a; color:#ffc890; }
    .pod-help, .pod-out{ position:absolute; z-index:6; background:rgba(14,8,6,.94);
      border:1px solid #46302a; border-radius:6px; padding:14px 16px; color:#cbb8aa;
      font:500 12px/1.5 ui-monospace,monospace; }
    .pod-help{ inset:10px 10px auto 10px; max-height:calc(100% - 92px); overflow:auto; cursor:pointer; }
    .pod-out{ left:50%; top:50%; transform:translate(-50%,-50%); width:min(420px,86%); }
    .pod-broke{ position:absolute; z-index:40; right:10px; top:46px; width:min(380px,46%);
      display:flex; flex-direction:column; gap:8px; padding:12px 14px; border-radius:10px; font-size:13px;
      background:var(--ds-surf-lo); border:1px solid var(--ds-bad); box-shadow:0 0 28px rgba(210,104,92,.35); }
    .pod-broke .ds-title-ico{ color:var(--ds-bad); }
    .pod-broke .ds-jobs{ grid-template-columns:repeat(3,1fr); }
    .pod-broke .ds-job{ padding:10px 6px; }
    .pod-broke .ds-job-ico{ font-size:24px; }
    .pod-help[hidden], .pod-out[hidden]{ display:none; }
    .pod-help h4, .pod-out h4{ margin:0 0 10px; font-size:11px; letter-spacing:.18em; color:#ffb070; }
    .pod-help dl{ display:grid; grid-template-columns:max-content 1fr; gap:5px 14px; margin:0; }
    .pod-help dt{ color:#ffb070; font-weight:600; white-space:nowrap; }
    .pod-help dd{ margin:0; }
    .pod-help-foot{ margin:12px 0 0; color:#8e7b6e; font-size:11px; }
    .pod-out-note{ margin:0 0 12px; }
    .pod-out .pod-chip{ margin-right:8px; }
    @media (max-width:720px){ .pod-read{ white-space:normal; max-width:60vw; } }
    body.bigscreen .pod-root > *:not(.pod-view){ display:none !important; }
    /* The yard's garage (depot-shell.js bayHtml) is its own screen: the seat's chrome steps out of it. */
    .pod-root:has(> .ds-bay.open) > :is(.pod-chrome, .pod-panel, .pod-chips){ visibility:hidden; }
    body.bigscreen .pod-root .ws-label,
    body.bigscreen .pod-root .ws-frame::after{ display:none; }`;
  if (!el.parentNode) document.head.appendChild(el);
}
