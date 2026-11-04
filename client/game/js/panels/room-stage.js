// THE ROOM STAGE: a flat you walk round in first person (docs/proposals/room-stage.md,
// docs/proposals/home-stage.md; plugins/roomstage sends it).
//
// One payload builds the room (`room_view`): its spec, its pieces with their archetypes and spots,
// and everyone in it. The layout is client/shared/room-layout.js's, the walk is room-walk.js's (the
// Platinum Box suite walks the same way), the mesh is gl/room-mesh.js's and the picture gl/room.js's.
// After that, `room_piece` sends a piece that was placed or taken and `room_people` who's in the room
// now, and this sends `room_pos` when you settle so they see you where you are.
//
// ⚠ EVERY GESTURE IS A VERB. Sitting sends `sit <piece>`, lying `lie <piece>`, getting up `stand`, a
// fridge `open <piece>`, a set `watch <piece>`; nothing here changes the world. Typing them works the
// other way round: a `sit sofa` typed in the log puts you on the sofa here, because your own posture
// comes back in `room_people` and the walker follows it.

import { sendCmd, sendRaw } from '../net.js';
import { loadCss } from '../../../shared/dom.js';
import { roomLayout } from '../../../shared/room-layout.js';
import { createRoomWalk } from './room-walk.js';
import { createRoomRenderer } from './gl/room.js';
import { buildRoom, paintRoomTexture, paintView, paintScreen, ROOM_RUG } from './gl/room-mesh.js';
import { figurePeople, dressOf } from './gl/room-people.js';

const CSS = await loadCss(new URL('./room-stage.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('room-stage-css')) return;
  const s = document.createElement('style');
  s.id = 'room-stage-css'; s.textContent = CSS;
  document.head.appendChild(s);
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// how far a pixel of drag turns the head, radians
const TURN = 0.0045;
const hashOf = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

let ui = null;

export const roomStageOpen = () => !!ui;

export function openRoomStage(msg) {
  ensureStyles();
  closeRoomStage(true);
  const root = document.createElement('div');
  root.id = 'room-stage';
  root.innerHTML = `<div class="rs-bar">
      <span class="rs-where"><b>${esc(msg.name)}</b>${msg.mine ? '' : ' · visiting'}</span>
      <button type="button" class="rs-sit" title="Sit down or get up (E)">Sit down</button>
      <button type="button" class="rs-lamp" title="The lamp, on or off (L)">Lamp: on</button>
      <button type="button" class="rs-tablet" title="Open your tablet">Tablet</button>
      <button type="button" class="rs-leave" title="Back to the room text (Esc)">Close</button>
    </div>
    <div class="rs-host"><canvas class="rs-canvas"></canvas><div class="rs-tags"></div>
      <div class="rs-hover" hidden></div><div class="rs-flash"></div>
      <div class="rs-tip">WASD to walk, Shift to run, C to crouch · drag to look · E or a click to sit, lie down or use what's in front of you · L for the lamp</div>
    </div>`;
  document.body.appendChild(root);
  const host = root.querySelector('.rs-host'), canvas = root.querySelector('.rs-canvas');
  const phone = matchMedia('(pointer: coarse)').matches;
  const R = createRoomRenderer(canvas, { phone });
  if (!R) {
    host.innerHTML = '<p class="rs-none">This device can\'t draw the room in 3-D (no WebGL2). Everything in it is in the room text.</p>';
    root.querySelector('.rs-leave').addEventListener('click', () => closeRoomStage());
    ui = { root, stop() {} };
    return;
  }
  const seed = hashOf(msg.zone);
  const textures = new Map();
  const paint = (key) => { let c = textures.get(key); if (!c) { c = paintRoomTexture(document, key, key === ROOM_RUG ? seed : 1); textures.set(key, c); } return c; };
  let lampOn = true;
  try { lampOn = localStorage.getItem('roomLamp') !== 'off'; } catch { /* private window */ }

  const S = { msg, spec: msg.spec, pieces: msg.pieces || [], people: msg.people || [], L: null, mesh: null, walk: null, screenOn: new Set(), you: msg.you };
  const seat = { eye: [0, 1.6, 0], yaw: Math.PI, pitch: 0, fov: 72, mode: 'free' };
  let syncing = false, raf = 0, lastHour = -1;
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 256; screenCanvas.height = 192;

  // the room's light from the server's clock: the hour now, and how much day comes through the glass
  const hourNow = () => { const c = msg.clock; if (!c) return 13; return ((c.hour + (Date.now() - c.hourMs) / 3.6e6 * (c.rate || 1)) % 24 + 24) % 24; };
  const dayOf = (h) => Math.max(0, Math.min(1, (Math.sin((h - 6) / 12 * Math.PI) + 0.15) / 0.75));
  const skyOf = (h) => {
    const d = dayOf(h), dusk = Math.exp(-(((h - 19) / 1.2) ** 2)) + Math.exp(-(((h - 6.3) / 1.0) ** 2));
    return [0.55 + 0.4 * d + 0.4 * dusk, 0.6 + 0.35 * d + 0.1 * dusk, 0.85 + 0.15 * d - 0.2 * dusk];
  };

  // the layout and the mesh, from the spec and the pieces; again whenever a piece comes or goes
  function rebuild(keepPlace = true) {
    const L = roomLayout(S.spec, S.pieces);
    const was = S.walk ? { at: S.walk.at, sat: S.walk.sat } : null;
    S.L = L;
    S.mesh = buildRoom(L, { seed, lampOn });
    R.setRoom(S.mesh, paint);
    S.walk?.stop();
    S.walk = createRoomWalk({
      L, seat, pane: root, label: 'ROOM',
      project: (p, w, h) => R.project(p, w, h),
      setMode: (m) => { seat.mode = m; },
      onStation: useStation,
      canSit: (s) => !takenBy(s),
      onSit: (s) => {
        sitBtn.textContent = 'Get up';
        if (syncing) return;
        const piece = S.pieces.find((p) => p.id === s.piece);
        if (piece) sendCmd(`${s.lie ? 'lie' : 'sit'} ${piece.name}`);
        sendRaw({ type: 'room_pos', at: [s.u, s.v], yaw: s.yaw, seat: L.seats.indexOf(s) });
      },
      onStand: () => { sitBtn.textContent = 'Sit down'; if (!syncing) sendCmd('stand'); },
      onSettle: (at, yaw) => sendRaw({ type: 'room_pos', at, yaw, seat: S.walk?.sat ? L.seats.indexOf(S.walk.sat) : null }),
      // in by the door, facing into the room
      start: keepPlace && was?.at ? { at: was.at, yaw: seat.yaw } : { at: [((S.spec.door?.[0] ?? 0.7) + (S.spec.door?.[1] ?? 1.6)) / 2, S.spec.d - 0.6], yaw: Math.atan2(L.f[0], L.f[2]) },
    });
    followSelf();
  }

  // who is sat in a seat, other than you
  function takenBy(s) {
    for (const p of S.people) if (p.id !== S.you && placeOf(p)?.seat === s) return p;
    return null;
  }
  // where a person is drawn: a seat on the piece they're on (the one they said, or the first free),
  // where they settled, or by the door
  function placeOf(p) {
    const L = S.L;
    if (!L) return null;
    if ((p.posture === 'sitting' || p.posture === 'lying') && p.on) {
      const want = p.posture === 'lying';
      const mine = L.seats.filter((s) => s.piece === p.on && !!s.lie === want);
      const pick = (Number.isInteger(p.seat) && L.seats[p.seat]?.piece === p.on && L.seats[p.seat]) || mine[0] || L.seats.find((s) => s.piece === p.on);
      if (pick) return { seat: pick, at: [pick.u, pick.v], yaw: pick.yaw, pose: pick.lie ? 'lie' : 'sit', head: pick.head, top: pick.top };
    }
    if (p.at) return { at: p.at, yaw: p.yaw || 0, pose: 'stand' };
    // nobody has said where: by the door, a step apart from the next
    const i = S.people.indexOf(p), d = S.spec.door || [0.7, 1.6];
    return { at: [d[0] + 0.3 + (i % 3) * 0.45, S.spec.d - 0.5 - Math.floor(i / 3) * 0.5], yaw: Math.atan2(L.f[0], L.f[2]), pose: 'stand' };
  }
  // your own posture, from the server: a `sit` typed in the log seats you here too
  function followSelf() {
    const me = S.people.find((p) => p.id === S.you), w = S.walk;
    if (!me || !w) return;
    syncing = true;
    try {
      const down = (me.posture === 'sitting' || me.posture === 'lying') && me.on;
      if (down && w.sat?.piece !== me.on) { const pl = placeOf(me); if (pl?.seat) w.sit(pl.seat); }
      else if (!down && w.sat) w.standUp();
    } finally { syncing = false; }
  }

  // a station: the verb the piece answers to. A set's picture comes on here while you watch it.
  function useStation(st) {
    const piece = S.pieces.find((p) => p.id === st.piece);
    if (!piece) return;
    if (st.verb === 'watch') { if (S.screenOn.has(piece.id)) S.screenOn.delete(piece.id); else S.screenOn.add(piece.id); }
    flash(st.verb === 'open' ? `You open the ${piece.name}.` : st.verb === 'watch' ? `You turn to the ${piece.name}.` : `You look at the ${piece.name}.`, true);
    sendCmd(`${st.verb} ${piece.name}`);
  }

  const sitBtn = root.querySelector('.rs-sit'), lampBtn = root.querySelector('.rs-lamp');
  const showLamp = () => { lampBtn.textContent = `Lamp: ${lampOn ? 'on' : 'off'}`; lampBtn.setAttribute('aria-pressed', String(lampOn)); };
  const toggleLamp = () => {
    lampOn = !lampOn; showLamp();
    try { localStorage.setItem('roomLamp', lampOn ? 'on' : 'off'); } catch { /* private window */ }
    rebuild();
  };
  showLamp();
  sitBtn.addEventListener('click', () => { if (S.walk && !S.walk.sitOrStand()) flash('Nowhere free to sit.', false); });
  lampBtn.addEventListener('click', toggleLamp);
  root.querySelector('.rs-tablet').addEventListener('click', () => sendCmd('tablet'));
  root.querySelector('.rs-leave').addEventListener('click', () => closeRoomStage());

  // looking round: a drag turns the head the way the mouse moves, held where you leave it
  const turn = (dx, dy) => { seat.yaw -= dx * TURN; seat.pitch = Math.max(-1.35, Math.min(1.35, seat.pitch - dy * TURN)); };
  let drag = null;
  host.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (e.button === 1) e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, id: e.pointerId };
    try { host.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  });
  const hoverEl = root.querySelector('.rs-hover'), flashEl = root.querySelector('.rs-flash');
  const label = (hit) => {
    if (!hit) return '';
    if (hit.station) { const p = S.pieces.find((x) => x.id === hit.station.piece); return p ? `${hit.station.verb === 'open' ? 'Open' : hit.station.verb === 'watch' ? 'Watch' : 'Look at'} the ${p.name}` : ''; }
    const p = S.pieces.find((x) => x.id === hit.seat.piece), who = takenBy(hit.seat);
    return who ? `${who.name} is there` : p ? `${hit.seat.lie ? 'Lie on' : 'Sit on'} the ${p.name}` : '';
  };
  host.addEventListener('pointermove', (e) => {
    const b = host.getBoundingClientRect();
    if (!drag && S.walk) {
      const hit = S.walk.hit(e.clientX - b.left, e.clientY - b.top, b.width, b.height), t = label(hit);
      host.style.cursor = t ? 'pointer' : '';
      hoverEl.hidden = !t;
      if (t) { hoverEl.textContent = t; hoverEl.style.left = (e.clientX - b.left + 16) + 'px'; hoverEl.style.top = (e.clientY - b.top + 12) + 'px'; }
    }
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (dx || dy) turn(dx, dy);
  });
  host.addEventListener('pointerup', (e) => {
    const d = drag; drag = null;
    if (!d || !S.walk || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 14) return;
    const b = host.getBoundingClientRect(), hit = S.walk.hit(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
    if (hit?.seat && takenBy(hit.seat)) { flash(`${takenBy(hit.seat).name} is sitting there.`, false); return; }
    S.walk.click(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
  });
  host.addEventListener('pointercancel', () => { drag = null; });
  host.addEventListener('pointerleave', () => { hoverEl.hidden = true; host.style.cursor = ''; });
  host.addEventListener('wheel', (e) => { e.preventDefault(); seat.fov = Math.max(30, Math.min(95, seat.fov * (e.deltaY > 0 ? 1.06 : 1 / 1.06))); }, { passive: false });
  let flashT = 0;
  function flash(text, ok) {
    flashEl.textContent = text; flashEl.classList.toggle('rs-flash-no', !ok);
    flashEl.classList.remove('on'); void flashEl.offsetWidth; flashEl.classList.add('on');
    clearTimeout(flashT); flashT = setTimeout(() => flashEl.classList.remove('on'), 1800);
  }

  const onKey = (e) => {
    // a field over the room (a container's count) keeps its keys, and the tablet has them when it's up
    const field = e.target.closest?.('input, textarea, [contenteditable]');
    if (field && field.closest('#room-stage, #container-panel')) return;
    if (document.getElementById('tablet-os-overlay')) return;
    if (field) return;
    const k = String(e.key || '');
    if (S.walk?.key(e, true)) { e.preventDefault(); return; }
    if (k === 'Escape') { closeRoomStage(); e.preventDefault(); }
    else if (k === 'l' || k === 'L') { toggleLamp(); e.preventDefault(); }
    else if (k === 'ArrowLeft') { turn(-26, 0); e.preventDefault(); }
    else if (k === 'ArrowRight') { turn(26, 0); e.preventDefault(); }
    else if (k === 'ArrowUp') { turn(0, -20); e.preventDefault(); }
    else if (k === 'ArrowDown') { turn(0, 20); e.preventDefault(); }
  };
  const onKeyUp = (e) => { S.walk?.key(e, false); };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);

  // the people, as the close-up figure (gl/figure-hd.js), a phone's at the lighter level. Their
  // meshes are built a beat after the room is up, so the room shows first; somebody who walks in
  // later builds theirs on the frame they first appear.
  const tagsEl = root.querySelector('.rs-tags'), figLevel = phone ? 'lite' : 'hd';
  let peopleOn = false;
  const bodiesNow = () => {
    const bodies = [];
    for (const p of S.people) {
      if (p.id === S.you) continue;
      const pl = placeOf(p);
      if (pl) bodies.push({ id: p.id, ...pl, dress: dressOf(p.order) });
    }
    return bodies;
  };
  setTimeout(() => {
    if (ui?.S !== S) return;
    try { for (const r of figurePeople(S.L, bodiesNow(), 0, { level: figLevel })) R.prepareFigure(r.key); } catch (err) { console.warn('[room] people:', err); }
    peopleOn = true;
  }, 60);
  function drawPeople(t) {
    const bodies = bodiesNow();
    R.setFigures(figurePeople(S.L, bodies, t, { level: figLevel }));
    // a name over each head
    const b = host.getBoundingClientRect();
    tagsEl.innerHTML = bodies.map((bd) => {
      const p = S.people.find((x) => x.id === bd.id), y = bd.pose === 'lie' ? (bd.top || 0.4) + 0.5 : bd.pose === 'sit' ? 1.45 : 1.95;
      const q = R.project(S.L.world(bd.at[0], bd.at[1], y), b.width, b.height);
      return q && q.x > -50 && q.x < b.width + 50 && q.y > -20 && q.y < b.height ? `<span class="rs-tag${p?.npc ? ' npc' : ''}" style="left:${q.x.toFixed(0)}px;top:${q.y.toFixed(0)}px">${esc(p?.name)}</span>` : '';
    }).join('');
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!S.L) return;
    const h = hourNow();
    // the street out of the window, repainted as the hour turns
    if (Math.abs(h - lastHour) > 0.08) { lastHour = h; R.setView(paintView(document, h, seed)); }
    // a set that's on shows snow; the others are dark glass
    paintScreen(screenCanvas, S.screenOn.size > 0, now / 1000, seed);
    R.setScreen(screenCanvas);
    if (peopleOn) drawPeople(now / 1000);
    const win = S.mesh.window, Lr = S.L, mu = (win.u[0] + win.u[1]) / 2, my = (win.y[0] + win.y[1]) / 2;
    const toW = (du, dv) => [Lr.r[0] * du - Lr.f[0] * dv, 0, Lr.r[2] * du - Lr.f[2] * dv];
    const ru = toW(win.u[1] - win.u[0], 0), inward = toW(0, 1);
    R.render(seat, { lamp: S.mesh.lamp, lampOn, day: dayOf(h), sky: skyOf(h), win: { p: Lr.world(mu, 0.02, my), n: inward, a: ru, b: [0, win.y[1] - win.y[0], 0] } });
  }

  ui = { root, S, seat, stop() {
    cancelAnimationFrame(raf);
    S.walk?.stop();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keyup', onKeyUp);
    clearTimeout(flashT);
    R.dispose();
  } };
  ui.rebuild = rebuild; ui.followSelf = followSelf;
  rebuild(false);
  raf = requestAnimationFrame(frame);
  // the room keeps the keyboard from the command line while it's up
  const el = document.activeElement; if (el?.matches?.('input, textarea')) el.blur();
}

// For the gate and a harness: the eye and the room's state while it's open.
export const _test = () => (ui?.S ? { seat: ui.seat, S: ui.S } : null);

// A piece placed or taken while the room is open (or, with `pieces`, the whole room after a move-out).
export function roomPiece(msg) {
  if (!ui?.S || msg.zone !== ui.S.msg.zone) return;
  const S = ui.S;
  if (Array.isArray(msg.pieces)) S.pieces = msg.pieces;
  else if (msg.gone) S.pieces = S.pieces.filter((p) => p.id !== msg.id);
  else if (msg.piece) S.pieces = [...S.pieces.filter((p) => p.id !== msg.piece.id), msg.piece];
  ui.rebuild();
}

// Who's in the room now, and where.
export function roomPeople(msg) {
  if (!ui?.S || msg.zone !== ui.S.msg.zone) return;
  ui.S.people = msg.people || [];
  ui.followSelf();
}

export function closeRoomStage(quiet = false) {
  const u = ui;
  if (!u) return;
  ui = null;
  u.stop();
  u.root.remove();
  if (!quiet) sendCmd('room close');
}
