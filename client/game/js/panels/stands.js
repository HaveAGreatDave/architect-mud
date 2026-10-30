// Stands: a seat at the game (plugins/stands).
//
// Two screens. The chart (`stands_chart`) draws the venue from above with every section where
// its seat is, priced, and buying one sends `stands <id>`. The seat (`stands_open`) mounts the
// same 3-D view the TV's sub-screen uses (gameday-rink.js for hockey, gameday-grandstand.js for
// baseball) with the camera bolted to the seat: following the play, it turns to what the
// broadcast's director is looking at; free, it looks where you drag it, and the wheel zooms.
//
// The seat takes the channel's lines and overlays as one more TV view (tv.js addTvView), so the
// game is the broadcast's game and nothing here can change a score. The booth's words run under
// the picture as captions, read aloud only with Booth in the Stands on (standsBoothOn), as if
// you'd brought a radio. The voice goes through AudioEngine.speak on the tv channel, queued so a
// call never cuts the last one off; it never touches the room's sound.

import { sendCmd, sendRaw } from '../net.js';
import { loadCss } from '../../../shared/dom.js';
import { addTvView } from './tv.js';
import { wantClubs } from './club-crest.js';
import { wantVenue, venueOf } from './venue.js';
import { boothStep, boothSeatNear } from './gl/booth-mesh.js';
import { rinkSeats, SEAT_EYE } from './gl/arena-crowd.js';
import { standsBoothOn } from '../../../shared/settings.js';

const CSS = await loadCss(new URL('./stands.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('stands-css')) return;
  const s = document.createElement('style');
  s.id = 'stands-css'; s.textContent = CSS;
  document.head.appendChild(s);
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── the chart ─────────────────────────────────────────────────────────────────
// The venue from above, in the same feet as the seats' eyes. Hockey: the sheet is x along, y
// across, and the near stands (y < 0) are at the foot of the drawing. Baseball: x toward third,
// z to centre field, and home plate at the foot.
function plan(sport) {
  if (sport === 'hockey') {
    return {
      box: [-112, -78, 424, 326], at: ([x, y]) => [x, 85 - y],
      ice: '<rect x="-104" y="-70" width="408" height="310" rx="120" class="st-bowl"/><rect x="-52" y="-52" width="304" height="189" rx="80" class="st-bowl"/><rect x="0" y="0" width="200" height="85" rx="28" class="st-ice"/>'
        + '<line x1="100" y1="0" x2="100" y2="85" class="st-red"/><line x1="75" y1="0" x2="75" y2="85" class="st-blue"/><line x1="125" y1="0" x2="125" y2="85" class="st-blue"/>'
        + '<line x1="11" y1="8" x2="11" y2="77" class="st-red"/><line x1="189" y1="8" x2="189" y2="77" class="st-red"/>'
        + '<circle cx="100" cy="42.5" r="15" class="st-ring"/>',
    };
  }
  return {
    box: [-330, -470, 660, 600], at: ([x, , z]) => [-x, -z],
    ice: '<path d="M-110 0 L-110 120 L110 120 L110 0 L330 -220 A400 400 0 0 0 -330 -220 Z" class="st-bowl"/><path d="M0 0 L-235 -235 A332 332 0 0 1 235 -235 Z" class="st-grass"/>'
      + '<path d="M0 0 L-64 -64 L0 -128 L64 -64 Z" class="st-dirt"/>'
      + '<circle cx="0" cy="-60" r="9" class="st-dirt"/>',
  };
}

let chartEl = null;
export function openStandsChart(msg) {
  ensureStyles();
  closeStandsChart();
  const P = plan(msg.sport), [bx, by, bw, bh] = P.box;
  const marks = (msg.sections || []).map((c) => {
    const [x, y] = P.at(c.eye), r = msg.sport === 'hockey' ? 11 : 20, mine = c.id === msg.seated;
    return `<g class="st-sec${mine ? ' mine' : ''}" data-id="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.name)}, ₵${c.price}">`
      + `<circle cx="${x}" cy="${y}" r="${r}"/><text x="${x}" y="${y + r * 0.35}" font-size="${r}">₵${c.price}</text></g>`;
  }).join('');
  const rows = (msg.sections || []).map((c) => {
    const poor = (msg.credits | 0) < (c.price | 0), mine = c.id === msg.seated, full = c.free === 0;
    return `<li data-id="${esc(c.id)}"><span class="st-name">${esc(c.name)}</span><span class="st-note">${esc(c.note)}</span>`
      + `<button type="button" data-id="${esc(c.id)}" ${!msg.live || poor || mine || full ? 'disabled' : ''}>${mine ? 'Your seat' : full ? 'Sold out' : `₵${c.price}`}</button></li>`;
  }).join('');
  chartEl = document.createElement('div');
  chartEl.id = 'stands-chart';
  chartEl.setAttribute('role', 'dialog');
  chartEl.setAttribute('aria-label', `${msg.venue}: the seats`);
  chartEl.innerHTML = `<div class="st-card">
    <div class="st-head"><b>${esc(msg.venue)}</b><span>${msg.live ? 'Game on' : 'No game on'} · you have ₵${msg.credits | 0}</span><button type="button" class="st-x" aria-label="Close">✕</button></div>
    <svg viewBox="${bx} ${by} ${bw} ${bh}" class="st-plan" aria-hidden="true">${P.ice}${marks}</svg>
    <ul class="st-list">${rows}</ul></div>`;
  document.body.appendChild(chartEl);
  const buy = (id) => { const c = msg.sections.find((s) => s.id === id); if (!c || !msg.live || c.id === msg.seated || c.free === 0 || (msg.credits | 0) < (c.price | 0)) return; closeStandsChart(); sendCmd(`stands ${id}`); };
  chartEl.querySelector('.st-x').addEventListener('click', closeStandsChart);
  chartEl.addEventListener('click', (e) => { if (e.target === chartEl) closeStandsChart(); });
  chartEl.querySelectorAll('button[data-id]').forEach((b) => b.addEventListener('click', () => buy(b.dataset.id)));
  chartEl.querySelectorAll('.st-sec').forEach((g) => {
    g.addEventListener('click', () => buy(g.dataset.id));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); buy(g.dataset.id); } });
    // the chart and the list light each other's row
    const li = chartEl.querySelector(`li[data-id="${CSS_ESC(g.dataset.id)}"]`);
    g.addEventListener('pointerenter', () => li?.classList.add('hot'));
    g.addEventListener('pointerleave', () => li?.classList.remove('hot'));
  });
}
const CSS_ESC = (s) => (window.CSS?.escape ? window.CSS.escape(s) : String(s).replace(/"/g, '\\"'));
export function closeStandsChart() { chartEl?.remove(); chartEl = null; }

// ── the seat ──────────────────────────────────────────────────────────────────
// A rink ticket's eye moved onto the nearest seat in the bowl, SEAT_EYE over its tread, where a
// seated fan's eyes are; the bowl leaves the fan in that seat out (gl/arena-crowd.js nearR), so
// the men either side are at your shoulder. (The ballpark does the same in its renderer.)
function rinkSeatEye(e) {
  if (!Array.isArray(e)) return e;
  let best = null, bd = Infinity;
  for (const s of rinkSeats()) {
    const d = Math.hypot(s.x - e[0], s.y - e[1], s.z + SEAT_EYE - e[2]);
    if (d < bd) { bd = d; best = s; }
  }
  return best ? [best.x, best.y, best.z + SEAT_EYE] : e;
}
let seatUi = null;   // { root, view, seat, unview, channelId }

// how far a pixel of drag turns the head, radians
const TURN = 0.005;

export async function openStands(msg) {
  ensureStyles();
  closeStandsChart();
  closeStands();
  const root = document.createElement('div');
  root.id = 'stands-view';
  root.innerHTML = `<div class="st-bar">
      <span class="st-where"><b>${esc(msg.venue)}</b> · ${esc(msg.section?.name)}${msg.section?.seat ? ` · ${esc(msg.section.seat)}` : ''}</span>
      <button type="button" class="st-mode" aria-pressed="true" title="Follow the play (F)">Follow the play</button>
      <button type="button" class="st-tablet" title="Open your tablet">Tablet</button>
      <button type="button" class="st-settings" title="Settings" aria-label="Settings">⚙</button>
      <button type="button" class="st-sit" hidden title="Sit down or get up (E)">Get up</button>
      <button type="button" class="st-tv" hidden aria-pressed="false" title="The big screen, full size (T)">Big screen</button>
      <button type="button" class="st-seats">Change seat</button>
      <button type="button" class="st-leave">Leave the stands</button>
    </div>
    <div class="st-host"></div>
    <div class="st-tip">Drag to look around · wheel to zoom</div>`;
  document.body.appendChild(root);
  const host = root.querySelector('.st-host');
  // the eye the view reads every frame; the controls below turn it
  const seat = { eye: msg.sport === 'hockey' && !msg.screen ? rinkSeatEye(msg.section.eye) : msg.section.eye, mode: 'follow', fov: msg.sport === 'hockey' ? 64 : 50, yaw: null, pitch: null };
  const ui = { root, seat, view: null, unview: null, channelId: msg.channelId, sport: msg.sport, got: false };
  seatUi = ui;
  // A big screen (msg.screen) is the broadcast's own cameras: no seat, nothing to turn.
  if (msg.screen) {
    root.classList.add('st-screen');
    for (const c of ['.st-mode', '.st-seats', '.st-tip']) root.querySelector(c).hidden = true;
    root.querySelector('.st-leave').textContent = 'Look away';
  }
  // The city round the park comes with the venue, and only a game's first payload carries its
  // venueRev, so a seat taken mid-game would never ask and sit in a park with no skyline.
  if (!venueOf(msg.sport)) sendRaw({ type: 'tv_venue', sport: msg.sport });

  let view;
  const vs = msg.screen ? undefined : seat;
  // a box's suite (the section's 'room'): the Grandstand builds it round the seat and hands back its
  // layout, which the walker below moves the eye round
  const room = msg.sport === 'baseball' && !msg.screen ? msg.section?.room || null : null;
  let layout = null, startSuite = null;
  try {
    view = msg.sport === 'hockey'
      ? (await import('./gameday-rink.js')).createRinkView(host, { seat: vs, fly: false })
      : (await import('./gameday-grandstand.js')).createGrandstandView(host, { seat: vs, force: true, room, onRoom: (L) => { layout = L; startSuite?.(); } });
  } catch (err) {
    console.error('[stands] the view failed to load:', err);
    host.textContent = 'The view would not load.';
    return;
  }
  if (seatUi !== ui) { view.clear(); return; }   // left while it loaded
  ui.view = view;
  view.showIdle();
  // the weather cells over an open-air park, once; stands_sky brings a fresh copy if they change
  view.setSkyField?.(msg.field || null);

  const redraw = () => view.redraw?.();
  const modeBtn = root.querySelector('.st-mode'), tvBtn = root.querySelector('.st-tv');
  const setMode = (m) => {
    seat.mode = m;
    modeBtn.setAttribute('aria-pressed', String(m === 'follow'));
    modeBtn.textContent = m === 'follow' ? 'Follow the play' : 'Free look';
    tvBtn.setAttribute('aria-pressed', String(m === 'tv'));
    modeBtn.hidden = m === 'tv' || !!msg.screen;
    redraw();
  };
  // the room is built when the view mounts, which can be after this
  let suite = null;
  startSuite = () => {
    if (suite || !layout || seatUi !== ui) return;
    suite = walkSuite(ui, layout, msg, setMode, redraw);
    ui.onKeyUp = (e) => suite.key(e, false); document.addEventListener('keyup', ui.onKeyUp); ui.stopSuite = suite.stop;
  };
  modeBtn.addEventListener('click', () => setMode(seat.mode === 'follow' ? 'free' : 'follow'));
  root.querySelector('.st-seats').addEventListener('click', () => sendCmd('stands'));
  // The tablet draws above the seat (9200 over 8900); settings is one of its apps.
  root.querySelector('.st-tablet').addEventListener('click', () => sendCmd('tablet'));
  root.querySelector('.st-settings').addEventListener('click', () => sendCmd('tabletnav settings'));
  root.querySelector('.st-leave').addEventListener('click', () => sendCmd('stands leave'));

  // Free look: the mouse moves the head the way it moves (relative, held where you leave it).
  // Turning while following lets go of the play.
  const turn = (dx, dy) => {
    if (seat.mode !== 'free') setMode('free');
    if (msg.sport === 'hockey') { seat.yaw = (seat.yaw || 0) + dx * TURN; seat.pitch = Math.max(-1.2, Math.min(1.3, (seat.pitch || 0) + dy * TURN)); }
    else { seat.yaw = (seat.yaw || 0) - dx * TURN; seat.pitch = Math.max(-1.3, Math.min(1.2, (seat.pitch || 0) - dy * TURN)); }
    redraw();
  };
  let drag = null;
  host.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try { host.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  });
  host.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (dx || dy) turn(dx, dy);
  });
  const endDrag = () => { drag = null; };
  host.addEventListener('pointerup', endDrag);
  host.addEventListener('pointercancel', endDrag);
  host.addEventListener('wheel', (e) => {
    e.preventDefault();
    seat.fov = Math.max(15, Math.min(90, seat.fov * (e.deltaY > 0 ? 1.08 : 1 / 1.08)));
    redraw();
  }, { passive: false });
  ui.onKey = (e) => {
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;
    if (document.getElementById('tablet-os-overlay')) return;   // the tablet has the keys
    const k = e.key;
    if (suite?.key(e, true)) { e.preventDefault(); return; }
    if (k === 'f' || k === 'F') { setMode(seat.mode === 'follow' ? 'free' : 'follow'); e.preventDefault(); }
    else if (k === 'ArrowLeft') { turn(-24, 0); e.preventDefault(); }
    else if (k === 'ArrowRight') { turn(24, 0); e.preventDefault(); }
    else if (k === 'ArrowUp') { turn(0, -18); e.preventDefault(); }
    else if (k === 'ArrowDown') { turn(0, 18); e.preventDefault(); }
  };
  document.addEventListener('keydown', ui.onKey);
  startSuite();

  // the channel's lines and overlays, as a TV view tuned to it
  ui.unview = addTvView({
    isOpen: () => true,
    activeChannelId: () => ui.channelId,
    applyOverlay(ov) {
      if (!ov) return;
      if (ov.clubsRev && wantClubs(ov.sport || 'hockey', ov.clubsRev)) sendRaw({ type: 'tv_clubs', sport: ov.sport || 'hockey' });
      if (ov.venueRev && wantVenue(ov.sport || 'baseball', ov.venueRev)) sendRaw({ type: 'tv_venue', sport: ov.sport || 'baseball' });
      if (ov.overlayType === 'gameday') { ui.got = true; view.apply(ov); }
      else if (ov.overlayType === 'sportsfx' && ov.kind !== 'pregame' && ov.kind !== 'package') view.showCard(ov);
    },
    appendMessage(text, style, duration, hasGameday, catchUp, dl) {
      if (style === 'svg' || style === 'ticker') return;
      const plain = String(text || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
      // the line's voice starts when the view shows it (a call waits for its play to land); a
      // catch-up line is already part-way through airing, so it's shown and never said
      const speak = !catchUp && plain && standsBoothOn() ? () => sayBooth(plain, duration, dl) : null;
      if (plain) view.setCaption(plain, { who: dl?.speaker, held: !!hasGameday, ...(speak ? { speak } : {}), ...(hasGameday === 'call' ? { call: true } : {}) });
    },
    showOffAir() { if (ui.got) view.setCaption('That’s the game. The crowd heads for the doors.', {}); },
    showOnAir() {}, updateTicker() {}, speak() {}, setProgramName() {}, renderSchedule() {}, renderStandings() {},
  });
  // the catch-up sent when the seat was bought came before this view could take it
  sendRaw({ type: 'tv_catchup' });
}

// The booth's line in the TV's voice: a "Name says" line seeds off that name, as tv.js does, and
// anything else off whoever the broadcast says is on the mic.
function sayBooth(plain, duration, dl) {
  if (!standsBoothOn()) return;
  const said = /^(.+?) says, "([\s\S]*)"$/.exec(plain);
  const speech = said ? said[2] : plain;
  if (!speech) return;
  const { speaker, crowd, ...how } = dl || {};
  window.AudioEngine?.speak(speech, { seed: said ? said[1] : (speaker || 'broadcast'), queue: true, ...(duration > 0.5 ? { budget: duration } : {}), ...how });
}

// A fresh copy of the weather cells, when the day's field is reseeded or a cell moved
export function setStandsSky(field) { seatUi?.view?.setSkyField?.(field || null); }

export function closeStands() {
  const ui = seatUi;
  if (!ui) return;
  seatUi = null;
  ui.unview?.();
  if (ui.onKey) document.removeEventListener('keydown', ui.onKey);
  if (ui.onKeyUp) document.removeEventListener('keyup', ui.onKeyUp);
  ui.stopSuite?.();
  try { ui.view?.clear(); } catch { /* already torn down */ }
  ui.root.remove();
}

export const standsOpen = () => !!seatUi;

// ── the suite ─────────────────────────────────────────────────────────────────
// On your feet in a box (gl/booth-mesh.js): WASD walks where you're looking, sliding along what you
// meet; E sits in the nearest chair or sofa or gets you up; T puts the big screen up full size.
// In a chair you follow the play through the glass; on the sofa you face the screen. It's all the
// eye in your own client: the server has you in the box, and that's all it needs.
const WALK = 5.5;          // feet a second
const STAND = 5.4;         // eye height on your feet
function walkSuite(ui, L, msg, setMode, redraw) {
  const { seat, root } = ui;
  const sitBtn = root.querySelector('.st-sit'), tvBtn = root.querySelector('.st-tv');
  sitBtn.hidden = false; tvBtn.hidden = false;
  root.querySelector('.st-leave').textContent = 'Leave the box';
  root.querySelector('.st-tip').textContent = 'WASD to walk · E to sit or get up · T for the big screen · drag to look';
  seat.near = 0.3;
  let at = null, sat = null, raf = 0, last = 0;
  const held = new Set();
  const place = () => { seat.eye = L.world(at[0], at[1], L.groundAt(at[0], at[1]) + STAND); redraw(); };
  const sit = (s) => {
    sat = s; at = [s.u, s.v];
    seat.eye = s.eye.slice(); seat.yaw = s.yaw; seat.pitch = s.pitch;
    setMode(s.kind === 'chair' ? 'follow' : 'free');
    sitBtn.textContent = 'Get up';
  };
  const standUp = () => {
    if (!sat) return;
    // a step out from the seat the way it faces, wherever there's room
    const y = seat.yaw || 0, wx = Math.sin(y), wz = Math.cos(y);
    const fu = wx * L.r[0] + wz * L.r[2], fv = -(wx * L.f[0] + wz * L.f[2]);
    at = [sat.u, sat.v];
    for (const k of [1.6, 2.2, -1.6, 2.8]) { const n = boothStep(L, at, fu * k, fv * k); if (n !== at) { at = n; break; } }
    sat = null;
    if (seat.mode !== 'free') setMode('free');
    place();
    sitBtn.textContent = 'Sit down';
  };
  const toggleSit = () => {
    if (sat) { standUp(); return; }
    const s = boothSeatNear(L, at[0], at[1]);
    if (s) sit(s);
  };
  const toggleTv = () => setMode(seat.mode === 'tv' ? (sat?.kind === 'chair' ? 'follow' : 'free') : 'tv');
  sitBtn.addEventListener('click', toggleSit);
  tvBtn.addEventListener('click', toggleTv);
  // the seat you were given, or the sofa when you came in by the screen
  const dist = (s, e) => Math.hypot(s.eye[0] - e[0], s.eye[1] - e[1], s.eye[2] - e[2]);
  const given = msg.section.eye || L.seats[0].eye;
  sit(msg.section.spot === 'sofa' ? L.seats.find((s) => s.kind === 'sofa' && s.i === 1) : L.seats.reduce((b, s) => (dist(s, given) < dist(b, given) ? s : b)));
  const MOVES = { w: [0, 1], s: [0, -1], a: [-1, 0], d: [1, 0] };
  const tick = (now) => {
    raf = 0;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    if (!held.size) { last = 0; return; }
    if (sat) standUp();
    if (seat.mode !== 'free') setMode('free');
    let side = 0, ahead = 0;
    for (const k of held) { side += MOVES[k][0]; ahead += MOVES[k][1]; }
    const l = Math.hypot(side, ahead);
    if (l) {
      // ahead is where you're looking, flat; right is a quarter turn clockwise from it, seen from above
      const y = seat.yaw || 0, fx = Math.sin(y), fz = Math.cos(y), rx = -fz, rz = fx;
      const wx = (fx * ahead + rx * side) / l * WALK * dt, wz = (fz * ahead + rz * side) / l * WALK * dt;
      at = boothStep(L, at, wx * L.r[0] + wz * L.r[2], -(wx * L.f[0] + wz * L.f[2]));
      place();
    }
    raf = requestAnimationFrame(tick);
  };
  return {
    key(e, down) {
      const k = String(e.key || '').toLowerCase();
      if (MOVES[k]) {
        if (down) { held.add(k); if (!raf) raf = requestAnimationFrame(tick); } else held.delete(k);
        return true;
      }
      if (!down) return false;
      if (k === 'e') { toggleSit(); return true; }
      if (k === 't') { toggleTv(); return true; }
      return false;
    },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; held.clear(); },
  };
}
