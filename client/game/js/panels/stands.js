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

import { coverWithVeil } from './glass-veil.js';
import { sendCmd, sendRaw } from '../net.js';
import { loadCss } from '../../../shared/dom.js';
import { addTvView } from './tv.js';
import { wantClubs } from './club-crest.js';
import { wantVenue, venueOf } from './venue.js';
import { createRoomWalk } from './room-walk.js';
import { rinkSeats, SEAT_EYE } from './gl/arena-crowd.js';
import { standsBoothOn, boxAnnouncerOn, loadSettings, saveSettings, applySettings } from '../../../shared/settings.js';
import { createHands } from './stands-hands.js';
import { createCupholder } from './stands-cupholder.js';
import { createDrunk } from './stands-drunk.js';
import { getDrugFx } from './flight-drugfx.js';
import { seatLadderHTML, bindSeatLadder, releaseSeatLadder } from './seat-ladder.js';

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

// The marks pushed apart until none overlaps: two sections whose eyes are a few feet apart (the
// Diamond Club in front of Behind the Plate) would otherwise draw one circle on top of the other.
// Only the drawing moves; the seats stay where their eyes are.
function spread(pts, gap) {
  const out = pts.map(([x, y]) => [x, y]);
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const dx = out[j][0] - out[i][0], dy = out[j][1] - out[i][1], d = Math.hypot(dx, dy);
      if (d >= gap) continue;
      const ux = d > 1e-6 ? dx / d : 1, uy = d > 1e-6 ? dy / d : 0, push = (gap - d) / 2 + 0.01;
      out[i][0] -= ux * push; out[i][1] -= uy * push; out[j][0] += ux * push; out[j][1] += uy * push;
      moved = true;
    }
    if (!moved) break;
  }
  return out.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

let chartEl = null;
export function openStandsChart(msg) {
  ensureStyles();
  closeStandsChart();
  const P = plan(msg.sport), [bx, by, bw, bh] = P.box, r = msg.sport === 'hockey' ? 11 : 20;
  const at = spread((msg.sections || []).map((c) => P.at(c.eye)), r * 2 + 3);
  const marks = (msg.sections || []).map((c, i) => {
    const [x, y] = at[i], mine = c.id === msg.seated || c.held;
    return `<g class="st-sec${mine ? ' mine' : ''}" data-id="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.name)}, ₵${c.price}">`
      + `<circle cx="${x}" cy="${y}" r="${r}"/><text x="${x}" y="${y + r * 0.35}" font-size="${r}">₵${c.price}</text></g>`;
  }).join('');
  const rows = (msg.sections || []).map((c) => {
    const poor = (msg.credits | 0) < (c.price | 0), mine = c.id === msg.seated || c.held, full = c.free === 0;
    return `<li data-id="${esc(c.id)}"><span class="st-name">${esc(c.name)}</span><span class="st-note">${esc(c.note)}</span>`
      + `<button type="button" data-id="${esc(c.id)}" ${!msg.live || poor || mine || full ? 'disabled' : ''}>${mine ? (c.box ? 'Your ticket' : 'Your seat') : full ? 'Sold out' : `₵${c.price}`}</button></li>`;
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
  const buy = (id) => { const c = msg.sections.find((s) => s.id === id); if (!c || !msg.live || c.id === msg.seated || c.held || c.free === 0 || (msg.credits | 0) < (c.price | 0)) return; closeStandsChart(); sendCmd(`stands ${id}`); };
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
  // a box's suite (the section's 'room'): the Grandstand builds it round the seat and hands back its
  // layout, which the walker below moves the eye round
  const room = msg.sport === 'baseball' && !msg.screen ? msg.section?.room || null : null;
  let layout = null, startSuite = null;
  // A box is a room you walk round, so it goes where the Room Stage goes: in the game pane, over the
  // room text, with the seat ladder in its bar (seat-ladder.js). A seat and a big screen keep the window.
  const pane = room ? document.getElementById('area-content') : null;
  // one view in the pane at a time
  if (pane && document.getElementById('room-stage')) { try { (await import('./room-stage.js')).closeRoomStage(); } catch { /* it wasn't up */ } }
  const root = document.createElement('div');
  root.id = 'stands-view';
  root.innerHTML = `<div class="st-bar">
      <span class="st-where"><b>${esc(msg.venue)}</b> · ${esc(msg.section?.name)}${msg.section?.seat ? ` · ${esc(msg.section.seat)}` : ''}</span>
      <button type="button" class="st-mode" aria-pressed="true" title="Follow the play (F)">Follow the play</button>
      <button type="button" class="st-tablet" title="Open your tablet">Tablet</button>
      <button type="button" class="st-settings" title="Settings" aria-label="Settings">⚙</button>
      <button type="button" class="st-sit" hidden title="Sit down or get up (F)">Get up</button>
      <button type="button" class="st-tv" hidden aria-pressed="false" title="The big screen, full size (T)">Big screen</button>
      <button type="button" class="st-announcer" hidden aria-pressed="true" title="The announcer's calls from the screen">Announcer</button>
      <button type="button" class="st-lights" hidden title="Turn the box's lights up or down">Lights: full</button>
      <button type="button" class="st-seats">Change seat</button>
      ${pane ? '<span class="st-ladder">' + seatLadderHTML('st-chip') + '</span>' : ''}
      <button type="button" class="st-leave">Leave the stands</button>
    </div>
    <div class="st-host"></div>
    <div class="st-tip">Drag to look around · wheel to zoom</div>`;
  if (pane) {
    // the pane's text is at size 0 while the box is up (stands.css), so the box takes its size first
    root.classList.add('st-pane');
    root.style.fontSize = getComputedStyle(pane).fontSize;
    pane.appendChild(root);
    document.body.classList.add('stands-pane-on');
    bindSeatLadder(root);
  } else document.body.appendChild(root);
  const host = root.querySelector('.st-host');
  // the eye the view reads every frame; the controls below turn it
  const seat = { eye: msg.sport === 'hockey' && !msg.screen ? rinkSeatEye(msg.section.eye) : msg.section.eye, mode: 'follow', fov: msg.sport === 'hockey' ? 64 : 50, yaw: null, pitch: null };
  const ui = { root, seat, view: null, unview: null, channelId: msg.channelId, sport: msg.sport, got: false, paned: !!pane };
  seatUi = ui;
  // over the root, not the host: the view takes the host for itself when it mounts. A box stays
  // covered until its room is built too, as a flat does.
  coverWithVeil(root, 'stands', { ready: () => !!ui.view && (!room || !!layout) });
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
  // no ballgame on: the suite's screen shows the hockey, from a rink view kept out of sight
  // (or with no hockey either, msg.rerun: the last ballgame again, from a grandstand kept out of sight)
  const onScreen = room && !msg.channelId && msg.tvChannelId ? await (msg.rerun ? rerunOnScreen : hockeyOnScreen)(ui, msg.tvChannelId) : null;
  if (seatUi !== ui) { onScreen?.stop(); return; }
  ui.stopScreen = onScreen?.stop;
  try {
    view = msg.sport === 'hockey'
      ? (await import('./gameday-rink.js')).createRinkView(host, { seat: vs, fly: false, commentary: BOOTH_SWITCH })
      : (await import('./gameday-grandstand.js')).createGrandstandView(host, { seat: vs, force: true, commentary: BOOTH_SWITCH, room, announcer: room ? boxAnnouncerOn : null, tvSource: onScreen?.frame || null, station: msg.station || '', onRoom: (L) => { layout = L; startSuite?.(); } });
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
  // where the park's roof stands now, and the tile a venue_roof push names it by when it moves
  if (msg.roof) { ui.roofTile = msg.roof.tile; view.setRoof?.(msg.roof.shut); }

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
    // what you take from the bar, the buffet or the smokes goes in your hands (stands-hands.js)
    ui.hands = createHands(root, host, { send: sendCmd });
    ui.onKeyUp = (e) => { if (!ui.hands?.key(e, false)) suite.key(e, false); }; document.addEventListener('keyup', ui.onKeyUp); ui.stopSuite = suite.stop;
    ui.drunk = createDrunk(root, host, { walking: suite.walking });
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
    // with food in hand a left click turns it (Space bites), and the middle button looks round instead
    if (e.button === 0 && !overStation(e) && ui.hands?.click?.()) { e.preventDefault(); return; }
    if (e.button === 1) e.preventDefault();   // no autoscroll; a middle drag turns your head
    drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, id: e.pointerId };
    try { host.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  });
  // what the pointer is over, shown as it moves so you know a click will take
  const overStation = (e) => {
    if (!suite?.hit) return null;
    const b = host.getBoundingClientRect();
    return suite.hit(e.clientX - b.left, e.clientY - b.top, b.width, b.height)?.station || null;
  };
  host.addEventListener('pointermove', (e) => {
    if (!drag && suite?.hit) {
      const b = host.getBoundingClientRect(), hit = suite.hit(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
      host.style.cursor = hit ? 'pointer' : '';
      hoverLabel(hit, e.clientX - b.left, e.clientY - b.top);
    }
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (dx || dy) turn(dx, dy);
  });
  const endDrag = () => { drag = null; };
  // a click that didn't turn the head: a seat in the suite under it is sat in
  host.addEventListener('pointerup', (e) => {
    const d = drag;
    endDrag();
    if (!d || !suite || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 14) return;
    const b = host.getBoundingClientRect();
    suite.click(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
  });
  host.addEventListener('pointercancel', endDrag);
  host.addEventListener('pointerleave', () => { host.style.cursor = ''; hoverLabel(null); });
  // the label by the pointer, and the line that says what a click did
  const hoverEl = document.createElement('div'); hoverEl.className = 'st-hover'; hoverEl.hidden = true; host.appendChild(hoverEl);
  const flashEl = document.createElement('div'); flashEl.className = 'st-flash'; host.appendChild(flashEl);
  function hoverLabel(hit, x, y) {
    const t = hit?.station ? (hit.far ? 'Fridge (go behind the bar)' : STATION_NAME[hit.station.target] || hit.station.target) : hit?.seat ? 'Sit here' : '';
    hoverEl.hidden = !t;
    if (t) { hoverEl.textContent = t; hoverEl.style.left = (x + 16) + 'px'; hoverEl.style.top = (y + 12) + 'px'; }
  }
  let flashT = 0;
  function flash(text, ok) {
    flashEl.textContent = text; flashEl.classList.toggle('st-flash-no', !ok);
    flashEl.classList.remove('on'); void flashEl.offsetWidth; flashEl.classList.add('on');
    clearTimeout(flashT); flashT = setTimeout(() => flashEl.classList.remove('on'), 1800);
  }
  ui.flash = flash;
  // the cupholder on your armrest (a seat, not a box or a big screen), in 3-D where the seat is, down
  // to your right: a click opens the concessions (plugins/stands `stands order`), and what you buy is
  // held in first person, as a box's is (stands-hands.js). The hands go in after it, so they're on top.
  if (!room && !msg.screen) {
    ui.cup = createCupholder(root, host, { sport: msg.sport, seat, onOpen: () => sendCmd('stands order') });
    root.querySelector('.st-tip').textContent = 'Drag to look around · wheel to zoom · the cupholder on your armrest, down to your right, has the concessions';
    ui.hands = createHands(root, host, { send: sendCmd });
    ui.onKeyUp = (e) => { ui.hands?.key(e, false); }; document.addEventListener('keyup', ui.onKeyUp);
  }
  // the view rewrites the picture's markup when it mounts (and again if it falls back), which takes
  // these with it, so they're put back whenever they go
  const ours = [...host.children].filter((el) => el.matches('.st-hover, .st-flash'));
  ui.keepOverlay = new MutationObserver(() => { for (const el of ours) if (!el.isConnected) host.appendChild(el); });
  ui.keepOverlay.observe(host, { childList: true });
  host.addEventListener('wheel', (e) => {
    e.preventDefault();
    seat.fov = Math.max(15, Math.min(90, seat.fov * (e.deltaY > 0 ? 1.08 : 1 / 1.08)));
    redraw();
  }, { passive: false });
  ui.onKey = (e) => {
    // a field on top of the seat (a container's count) keeps its keys; the command line under the
    // seat is out of sight but takes focus back on its own, so it lets go and the room walks. In a
    // plain seat the command line keeps its keys, except while something's in your hands: then
    // Space bites, drinks or drags, and the rest of the hands' keys work, wherever the focus was.
    const field = e.target.closest?.('input, textarea, [contenteditable]');
    // A box in the pane has the command box in sight under it, so typing there is typing, as in a flat;
    // a click on the picture takes the keys back (walkSuite's letGo).
    if (field && (ui.paned || field.closest('#stands-view, #container-panel') || (!suite && !ui.hands?.active?.()))) return;
    if (document.getElementById('tablet-os-overlay')) return;   // the tablet has the keys
    if (field) field.blur();
    const k = e.key;
    if (ui.hands?.key(e, true) || suite?.key(e, true)) { e.preventDefault(); return; }
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
// (`on` is the setting that lets him be heard where this is: the seats' radio by default)
// The Commentary toggle on the seat's picture (commentary-button.js) is Booth in the Stands: the
// same setting as Settings and the 'booth' verb. Off cuts the line being read.
const BOOTH_SWITCH = {
  on: standsBoothOn,
  toggle() {
    const st = loadSettings();
    st.standsBooth = standsBoothOn() ? 'off' : 'on';
    saveSettings(st); applySettings(st);
    if (st.standsBooth === 'off') window.AudioEngine?.cancelSpeech('tv');
  },
};

function sayBooth(plain, duration, dl, on = standsBoothOn) {
  if (!on()) return;
  const said = /^(.+?) says, "([\s\S]*)"$/.exec(plain);
  const speech = said ? said[2] : plain;
  if (!speech) return;
  const { speaker, crowd, ...how } = dl || {};
  window.AudioEngine?.speak(speech, { seed: said ? said[1] : (speaker || 'broadcast'), queue: true, ...(duration > 0.5 ? { budget: duration } : {}), ...how });
}

// What the pointer's label calls each thing a click helps you to, and the line once you've clicked it.
const STATION_NAME = { bar: 'Fridge', buffet: 'Buffet', smokes: 'Smokes' };
const STATION_SAY = { bar: 'You open the fridge.', buffet: 'You go over to the buffet.', smokes: 'You reach for the smokes.' };
// A fresh copy of the weather cells, when the day's field is reseeded or a cell moved
// What a runner brought up from the concessions (stands_hand): into your hands, if they're free for it.
export function standsHand(msg) { if (msg?.item) seatUi?.hands?.take?.(msg.item); }
export function setStandsSky(field) { seatUi?.view?.setSkyField?.(field || null); }
// A venue's roof has started to move (venue_roof): the seat's park rolls it if the push names its tile.
export function setStandsRoof(msg) {
  const t = seatUi?.roofTile;
  if (!t || !seatUi.view?.setRoof) return;
  const has = (list) => Array.isArray(list) && list.some((p) => p[0] === t[0] && p[1] === t[1]);
  if (has(msg.shut)) seatUi.view.setRoof(1); else if (has(msg.open)) seatUi.view.setRoof(0);
}

// What the bar, the buffet or the smokes in a box keep (stands_menu, plugins/stands `stands fetch`):
// a card over the picture, the way a host would show you what's going. Taking one sends
// `stands fetch <thing> <item>`; it's all on the house, so nothing has a price. A machine in a flat
// (plugins/vending, `vend <machine> menu`) sends the same card with `buy` and prices, over the Room
// Stage (`host`): a click sends `<buy> <item>` and the server says if you can't pay.
export function openStandsMenu(msg, host = seatUi) {
  const root = host?.root;
  if (!root) return;
  ensureStyles();
  root.querySelector('.st-menu')?.remove();
  const card = document.createElement('div');
  card.className = 'st-menu';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', String(msg.name || msg.target));
  // the concessions (target 'order') are paid for; everything in a box is on the house
  const paid = msg.target === 'order' || !!msg.buy;
  const row = (it) => `<li><button type="button" data-id="${esc(it.id)}"><b>${esc(it.name)}</b>${it.description ? `<span>${esc(it.description)}</span>` : ''}<i>${paid && (it.price | 0) > 0 ? `₵${it.price | 0}` : 'Take one'}</i></button></li>`;
  // a menu that files its items (the concessions: food, drinks, cigarettes, cigars) gets a heading
  // for each, and a strip of tabs along the top that jumps to one
  const groups = Array.isArray(msg.groups) ? msg.groups.filter((g) => (msg.items || []).some((it) => it.group === g)) : [];
  const title = (g) => g.charAt(0).toUpperCase() + g.slice(1);
  if (groups.length) card.classList.add('st-menu-wide');
  const list = groups.length
    ? `<nav class="st-menu-tabs">${groups.map((g) => `<button type="button" data-go="${esc(g)}">${esc(title(g))}</button>`).join('')}</nav>`
      + `<div class="st-menu-groups">${groups.map((g) => `<section data-group="${esc(g)}"><h3>${esc(title(g))}</h3><ul>${msg.items.filter((it) => it.group === g).map(row).join('')}</ul></section>`).join('')}</div>`
    : `<ul>${(msg.items || []).map(row).join('')}</ul>`;
  const credits = msg.credits != null ? `You have ₵${msg.credits | 0}.` : '';
  card.innerHTML = `<div class="st-menu-head"><b>${esc(msg.name || msg.target)}</b><button type="button" class="st-menu-x" aria-label="Close">✕</button></div>`
    + (msg.description ? `<p class="st-menu-desc">${esc(msg.description)}</p>` : '')
    + list
    + `<p class="st-menu-foot">${msg.buy ? ((msg.items || []).some((it) => (it.price | 0) > 0) ? credits : 'Help yourself.') : paid ? `${credits} A runner brings it to your seat.`.trim() : 'On the house.'}</p>`;
  const close = () => { card.remove(); document.removeEventListener('keydown', onEsc, true); };
  const onEsc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onEsc, true);
  card.querySelector('.st-menu-x').addEventListener('click', close);
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  card.addEventListener('click', (e) => {
    const go = e.target.closest('button[data-go]');
    if (go) { card.querySelector(`section[data-group="${CSS_ESC(go.dataset.go)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    // what your hands can't hold keeps the card up, and they say why; otherwise the card goes and
    // what you took is in your hand. A spirit with no glass to go in brings the bar's glass with it.
    const it = (msg.items || []).find((x) => x.id === b.dataset.id);
    if (msg.buy) {
      // too dear keeps the card up and says so; otherwise the machine is paid and the server hands it over
      if ((it?.price | 0) > (msg.credits | 0)) { const f = card.querySelector('.st-menu-foot'); f.textContent = `That's ₵${it.price | 0}, and you have ₵${msg.credits | 0}.`; f.classList.add('st-menu-no'); return; }
      sendCmd(`${msg.buy} ${b.dataset.id}`); close(); return;
    }
    if (paid) {
      // as at a box's buffet, the card stays up and says why when you can't have it: too dear, or
      // your hands already full; otherwise it's paid for, the card goes and it comes to your hands
      const no = (text) => { const f = card.querySelector('.st-menu-foot'); f.textContent = text; f.classList.add('st-menu-no'); };
      if (msg.credits != null && (it?.price | 0) > (msg.credits | 0)) { no(`That's ₵${it.price | 0}, and you have ₵${msg.credits | 0}.`); return; }
      if (it?.kind && seatUi?.hands?.busy?.(it)) { no('Your hands are full. Finish what you have first.'); return; }
      seatUi?.flash?.(`You order the ${it?.name || 'one'}. A runner brings it up.`, true); sendCmd(`stands order ${b.dataset.id}`); close(); return;
    }
    const hands = seatUi?.hands;
    if (!it?.kind || !hands) { sendCmd(`stands fetch ${msg.target} ${b.dataset.id}`); return; }
    const glass = hands.needsGlass?.(it) ? (msg.items || []).find((x) => x.kind === 'glass') : null;
    if (!hands.take(it, glass)) return;
    if (glass) sendCmd(`stands fetch ${msg.target} ${glass.id}`);
    sendCmd(`stands fetch ${msg.target} ${b.dataset.id}`);
    close();
  });
  root.appendChild(card);
  card.querySelector('button[data-id]')?.focus();
}

// The hockey on a box's screen when there's no ballgame: a rink view on the broadcast's cameras,
// tuned to the hockey channel like any TV and kept out of sight, its picture and its graphics
// copied into one 640 by 360 canvas that the suite puts on its screen (ballpark.js setTvImage).
async function hockeyOnScreen(ui, channelId) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;height:360px;pointer-events:none;display:flex;flex-direction:column';
  box.setAttribute('aria-hidden', 'true');
  document.body.appendChild(box);
  let rink = null;
  const out = document.createElement('canvas');
  out.width = 640; out.height = 360;
  const g = out.getContext('2d');
  // the picture, then its graphics over it, both scaled to the screen, copied as each rink frame is
  // drawn: read later from the suite's own frame, the off-screen WebGL canvas gives a stale picture
  // The canvases carry the play, the replays and the splashes; the score, clock, strip, caption,
  // lower third and intermission board are HTML over them, so they're read back as text and drawn
  // as the broadcast's graphics. The text is read a few times a second, not every frame.
  let gfx = null, gfxAt = 0;
  const txt = (sel) => { const el = box.querySelector(sel); return el && !el.hidden ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : ''; };
  const lines = (sel) => { const el = box.querySelector(sel); return el ? (el.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8) : []; };
  const bar = (x, y, w, h, text, o = {}) => {
    if (!text) return;
    g.fillStyle = o.bg || 'rgba(8,12,20,0.82)'; g.fillRect(x, y, w, h);
    if (o.accent) { g.fillStyle = o.accent; g.fillRect(x, y, 4, h); }
    g.fillStyle = o.fg || '#f2f5f8'; g.font = `${o.bold ? 'bold ' : ''}${o.size || 13}px system-ui, sans-serif`; g.textBaseline = 'middle';
    let s = text; while (s.length > 4 && g.measureText(s).width > w - 16) s = s.slice(0, -2);
    g.fillText(s === text ? s : `${s}…`, x + 10, y + h / 2);
  };
  // THE SCORE BUG, drawn from the payloads rather than read off the rink's header: each club's
  // short name and score in its own colour, the period and the running clock, and the strength
  // while it isn't even. Under it, while a man is in the box, who it was and what for, until the
  // strength is even again. The booth's words aren't on the screen: the suite hears them instead.
  let st = null, pen = null;
  const cols = {};
  const note = (p) => {
    if (!p || p.type === 'arrive') return;
    st = p;
    // (a payload names the colours of the side with the puck and the other; kept per club)
    if (p.attackingTeam && p.attackingColours) cols[p.attackingTeam] = p.attackingColours;
    if (p.defendingTeam && p.defendingColours) cols[p.defendingTeam] = p.defendingColours;
    if (p.type === 'penalty') pen = { desc: p.desc || `${p.player || p.shooter || ''} ${p.infraction || ''}`.trim(), team: p.teamName || '' };
    else if (!p.strength || p.strength === 'even') pen = null;
  };
  const colourOf = (team) => {
    const v = cols[team]?.[0];
    return typeof v === 'string' ? v : '#3a4658';
  };
  const chip = (x, y, w, h, fill, text, o = {}) => {
    g.fillStyle = fill; g.fillRect(x, y, w, h);
    g.fillStyle = o.fg || '#f2f5f8'; g.font = `bold ${o.size || 14}px system-ui, sans-serif`; g.textBaseline = 'middle'; g.textAlign = o.align || 'center';
    g.fillText(text, o.align === 'left' ? x + 8 : x + w / 2, y + h / 2); g.textAlign = 'left';
  };
  const scoreBug = (clock) => {
    if (!st) return;
    const x = 10, y = 10, h = 26;
    chip(x, y, 50, h, 'rgba(8,12,20,0.9)', 'CPhL', { fg: '#7fd4ff', size: 12 });
    let cx = x + 50;
    for (const [abbr, team, score] of [[st.awayAbbr, st.awayTeam, st.awayScore], [st.homeAbbr, st.homeTeam, st.homeScore]]) {
      chip(cx, y, 58, h, colourOf(team), String(abbr || team || '').slice(0, 4).toUpperCase(), { size: 13 });
      chip(cx + 58, y, 30, h, 'rgba(240,244,248,0.95)', String(score | 0), { fg: '#0a0e16', size: 15 });
      cx += 88;
    }
    const per = st.type === 'intermission' ? 'INT' : `${st.section || ''} ${clock || st.clock || ''}`.trim();
    chip(cx, y, 92, h, 'rgba(8,12,20,0.9)', per, { fg: '#9fe4ff', size: 13 });
    cx += 92;
    if (st.strength && st.strength !== 'even' && st.type !== 'intermission') { chip(cx, y, 38, h, st.strength === 'pp' ? '#c8a020' : '#a02030', st.strength.toUpperCase(), { size: 12 }); }
    if (pen && st.type !== 'intermission') bar(x, y + h + 2, 328, 22, `PENALTY · ${pen.desc}`, { size: 12, bold: true, accent: '#c8a020' });
  };
  const copy = () => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 640, 360);
    for (const c of box.querySelectorAll('canvas')) if (c.width > 1 && c.height > 1) { try { g.drawImage(c, 0, 0, 640, 360); } catch { /* not drawable yet */ } }
    const now = performance.now();
    if (!gfx || now - gfxAt > 250) {
      gfxAt = now;
      gfx = { clock: txt('.gdr-head-time'), strip: txt('.gdr-strip'), rush: txt('.gdr-rush'),
        l3: box.querySelector('.gdr-l3.in') ? txt('.gdr-l3') : '', board: lines('.gdri') };
    }
    scoreBug(gfx.clock);
    if (gfx.rush) bar(380, 10, 250, 26, gfx.rush, { bg: 'rgba(160,20,30,0.85)', bold: true });
    if (gfx.board.length) gfx.board.forEach((s, i) => bar(10, 62 + i * 22, 300, 22, s, { size: 12, bold: i === 0 }));
    if (gfx.l3) bar(10, 290, 520, 30, gfx.l3, { bold: true, accent: '#e3a72f' });
    bar(10, 328, 620, 22, gfx.strip, { size: 12 });
  };
  try { rink = (await import('./gameday-rink.js')).createRinkView(box, { fly: false, onFrame: copy }); } catch (err) { console.warn('[stands] the hockey for the screen would not load:', err); box.remove(); return null; }
  rink.showIdle?.();
  const unview = addTvView({
    isOpen: () => true,
    activeChannelId: () => channelId,
    applyOverlay(ov) {
      if (!ov) return;
      if (ov.clubsRev && wantClubs(ov.sport || 'hockey', ov.clubsRev)) sendRaw({ type: 'tv_clubs', sport: ov.sport || 'hockey' });
      if (ov.overlayType === 'gameday') { note(ov); rink.apply(ov); }
      else if (ov.overlayType === 'sportsfx' && ov.kind !== 'pregame' && ov.kind !== 'package') rink.showCard(ov);
    },
    // The booth's line isn't drawn on the screen, it's heard in the suite with Announcer in the
    // Box on (there's no ballgame for the park's own announcer to call). It still goes through the
    // rink, so its voice waits for the play to land, as on any TV.
    appendMessage(text, style, duration, hasGameday, catchUp, dl) {
      if (style === 'svg' || style === 'ticker') return;
      const plain = String(text || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
      const speak = !catchUp && plain && boxAnnouncerOn() ? () => sayBooth(plain, duration, dl, boxAnnouncerOn) : null;
      if (plain) rink.setCaption(plain, { held: !!hasGameday, ...(speak ? { speak } : {}), ...(hasGameday === 'call' ? { call: true } : {}) });
    },
    showOffAir() {}, showOnAir() {}, updateTicker() {}, speak() {}, setProgramName() {}, renderSchedule() {}, renderStandings() {},
  });
  sendRaw({ type: 'tv_catchup' });
  return {
    // the last picture the rink drew (copy, above)
    frame() { return out; },
    stop() { unview?.(); try { rink.clear(); } catch { /* gone */ } box.remove(); },
  };
}

// The last ballgame on a box's screen when nothing's live: plugins/broadcast startSportsRerun airs it
// to this player alone on 'rerun:baseball', and a grandstand view with no seat (so the broadcast's
// cameras) takes it like any TV, kept out of sight. Its park and its graphics are both canvases,
// copied into one 640 by 360 canvas for the suite's screen (ballpark.js setTvImage); `preserve` keeps
// the park's picture readable between its frames. Muted: the suite has the park's sound of its own.
async function rerunOnScreen(ui, channelId) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;height:360px;pointer-events:none;display:flex;flex-direction:column';
  box.setAttribute('aria-hidden', 'true');
  document.body.appendChild(box);
  let park = null;
  try { park = (await import('./gameday-grandstand.js')).createGrandstandView(box, { force: true, mute: true, preserve: true }); } catch (err) { console.warn('[stands] the rerun for the screen would not load:', err); box.remove(); return null; }
  park.showIdle?.();
  const out = document.createElement('canvas');
  out.width = 640; out.height = 360;
  const g = out.getContext('2d');
  const unview = addTvView({
    isOpen: () => true,
    activeChannelId: () => channelId,
    applyOverlay(ov) {
      if (!ov) return;
      if (ov.clubsRev && wantClubs(ov.sport || 'baseball', ov.clubsRev)) sendRaw({ type: 'tv_clubs', sport: ov.sport || 'baseball' });
      if (ov.venueRev && wantVenue(ov.sport || 'baseball', ov.venueRev)) sendRaw({ type: 'tv_venue', sport: ov.sport || 'baseball' });
      if (ov.overlayType === 'gameday') park.apply(ov);
      else if (ov.overlayType === 'sportsfx' && ov.kind !== 'pregame' && ov.kind !== 'package') park.showCard?.(ov);
    },
    appendMessage(text, style, duration, hasGameday) {
      if (style === 'svg' || style === 'ticker') return;
      const plain = String(text || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
      if (plain) park.setCaption(plain, { held: !!hasGameday });
    },
    showOffAir() {}, showOnAir() {}, updateTicker() {}, speak() {}, setProgramName() {}, renderSchedule() {}, renderStandings() {},
  });
  // the rerun's first payloads went out before this view could take them
  sendRaw({ type: 'tv_catchup' });
  return {
    frame() {
      g.fillStyle = '#000'; g.fillRect(0, 0, 640, 360);
      for (const c of box.querySelectorAll('canvas')) if (c.width > 1 && c.height > 1) { try { g.drawImage(c, 0, 0, 640, 360); } catch { /* not drawable yet */ } }
      return out;
    },
    stop() { unview?.(); try { park.clear(); } catch { /* gone */ } box.remove(); },
  };
}

export function closeStands() {
  const ui = seatUi;
  if (!ui) return;
  seatUi = null;
  ui.unview?.();
  if (ui.onKey) document.removeEventListener('keydown', ui.onKey);
  if (ui.onKeyUp) document.removeEventListener('keyup', ui.onKeyUp);
  ui.stopSuite?.();
  ui.hands?.stop();
  ui.cup?.stop();
  ui.keepOverlay?.disconnect();
  ui.drunk?.stop();
  ui.stopScreen?.();
  try { ui.view?.clear(); } catch { /* already torn down */ }
  ui.root.remove();
  // the pane and the page given back: the room text is underneath
  if (ui.paned) { document.body.classList.remove('stands-pane-on'); releaseSeatLadder(); }
}

export const standsOpen = () => !!seatUi;

// ── the suite ─────────────────────────────────────────────────────────────────
// On your feet in a box (gl/booth-mesh.js): the Room Stage's walker (room-walk.js), as a flat has it,
// with the box's own buttons round it. In a chair you follow the play through the glass; on the sofa
// you face the screen; T puts the big screen up full size. It's all the eye in your own client: the
// server has you in the box, and that's all it needs.
function walkSuite(ui, L, msg, setMode, redraw) {
  const { seat, root } = ui;
  const sitBtn = root.querySelector('.st-sit'), tvBtn = root.querySelector('.st-tv');
  // the big-screen button puts the ballgame up full size, so with none on there's nothing for it
  sitBtn.hidden = false; tvBtn.hidden = !msg.channelId;
  // the announcer's calls from the screen, on or off: the same setting as accessibility announcer
  const annBtn = root.querySelector('.st-announcer');
  const showAnn = () => annBtn.setAttribute('aria-pressed', String(boxAnnouncerOn()));
  annBtn.hidden = false; showAnn();
  annBtn.addEventListener('click', () => { const st = loadSettings(); st.boxAnnouncer = boxAnnouncerOn() ? 'off' : 'on'; saveSettings(st); applySettings(st); showAnn(); });
  // the lamps on a dimmer: full, low, dim, and round again. Remembered on this device only.
  const lightsBtn = root.querySelector('.st-lights');
  const LIGHTS = [['full', 1], ['low', 0.5], ['dim', 0.22]];
  let lightsAt = 0;
  try { lightsAt = Math.max(0, LIGHTS.findIndex(([n]) => n === localStorage.getItem('boxLights'))); } catch {}
  const setLights = (i) => {
    lightsAt = i % LIGHTS.length;
    const [name, k] = LIGHTS[lightsAt];
    ui.view?.renderer?.setRoomDim?.(k);
    lightsBtn.textContent = `Lights: ${name}`;
    try { localStorage.setItem('boxLights', name); } catch {}
    redraw?.();
  };
  lightsBtn.hidden = !ui.view?.renderer?.setRoomDim;
  setLights(lightsAt);
  lightsBtn.addEventListener('click', () => setLights(lightsAt + 1));
  root.querySelector('.st-leave').textContent = 'Leave the box';
  // F is the room's use key in here (room-walk.js), so the button says nothing of it
  root.querySelector('.st-mode').title = 'Follow the play';
  root.querySelector('.st-tip').textContent = 'WASD to walk, Shift to run, Ctrl or C to crouch · drag to look, Q and E to turn · click a chair or F to sit · click the buffet or the smokes, or F beside them, or go behind the bar to the fridge, to help yourself · Space to smoke, drink or bite and a click to turn food in your hand, any two of a drink, a smoke and food, Q to swap them · T for the big screen (middle-drag to look with food)';
  seat.near = 0.3;
  // the command line keeps the keys while it has focus, so WASD would type; let it go now
  // and whenever you click into the room
  const letGo = () => { const el = document.activeElement; if (el?.matches?.('input, textarea, [contenteditable]')) el.blur(); };
  letGo();
  root.addEventListener('pointerdown', letGo);
  // the bar or the buffet: help yourself (plugins/stands `stands fetch`, which opens it)
  const fetch = (st) => { ui.flash?.(STATION_SAY[st.target] || 'Helping yourself.', true); sendCmd(`stands fetch ${st.target}`); };
  // the seat you were given, or the sofa when you came in by the screen
  const dist = (s, e) => Math.hypot(s.eye[0] - e[0], s.eye[1] - e[1], s.eye[2] - e[2]);
  const given = msg.section.eye || L.seats[0].eye;
  const start = msg.section.spot === 'sofa' ? L.seats.find((s) => s.kind === 'sofa' && s.i === 1) : L.seats.reduce((b, s) => (dist(s, given) < dist(b, given) ? s : b));
  const walk = createRoomWalk({
    L, seat, pane: root, label: 'BOX', setMode, redraw, start,
    project: (p, w, h) => ui.view?.project?.(p, w, h),
    seatMode: (s) => (s.kind === 'chair' ? 'follow' : 'free'),
    onStation: fetch,
    onSit: () => { sitBtn.textContent = 'Get up'; },
    onStand: () => { sitBtn.textContent = 'Sit down'; },
  });
  const toggleTv = () => msg.channelId && setMode(seat.mode === 'tv' ? (walk.sat?.kind === 'chair' ? 'follow' : 'free') : 'tv');
  sitBtn.addEventListener('click', walk.toggleSit);
  tvBtn.addEventListener('click', toggleTv);
  return {
    key(e, down) {
      if (walk.key(e, down)) return true;
      if (down && String(e.key || '').toLowerCase() === 't') { toggleTv(); return true; }
      return false;
    },
    hit: (x, y, w, h) => walk.hit(x, y, w, h),
    // the fridge behind the bar is only opened from behind the bar
    click: (x, y, w, h) => walk.click(x, y, w, h, () => ui.flash?.('The fridge is behind the bar. Walk round to it.')),
    walking: walk.walking,
    stop: walk.stop,
  };
}
