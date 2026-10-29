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
// the picture as captions; nobody reads them aloud, because you're in the crowd, not the booth.

import { sendCmd, sendRaw } from '../net.js';
import { loadCss } from '../../../shared/dom.js';
import { addTvView } from './tv.js';
import { wantClubs } from './club-crest.js';
import { wantVenue, venueOf } from './venue.js';

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
      box: [-40, -35, 280, 180], at: ([x, y]) => [x, 85 - y],
      ice: '<rect x="-32" y="-24" width="264" height="158" rx="50" class="st-bowl"/><rect x="0" y="0" width="200" height="85" rx="28" class="st-ice"/>'
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
    const [x, y] = P.at(c.eye), r = msg.sport === 'hockey' ? 7.5 : 20, mine = c.id === msg.seated;
    return `<g class="st-sec${mine ? ' mine' : ''}" data-id="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.name)}, ₵${c.price}">`
      + `<circle cx="${x}" cy="${y}" r="${r}"/><text x="${x}" y="${y + r * 0.35}" font-size="${r}">₵${c.price}</text></g>`;
  }).join('');
  const rows = (msg.sections || []).map((c) => {
    const poor = (msg.credits | 0) < (c.price | 0), mine = c.id === msg.seated;
    return `<li data-id="${esc(c.id)}"><span class="st-name">${esc(c.name)}</span><span class="st-note">${esc(c.note)}</span>`
      + `<button type="button" data-id="${esc(c.id)}" ${!msg.live || poor || mine ? 'disabled' : ''}>${mine ? 'Your seat' : `₵${c.price}`}</button></li>`;
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
  const buy = (id) => { const c = msg.sections.find((s) => s.id === id); if (!c || !msg.live || c.id === msg.seated || (msg.credits | 0) < (c.price | 0)) return; closeStandsChart(); sendCmd(`stands ${id}`); };
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
      <span class="st-where"><b>${esc(msg.venue)}</b> · ${esc(msg.section?.name)}</span>
      <button type="button" class="st-mode" aria-pressed="true" title="Follow the play (F)">Follow the play</button>
      <button type="button" class="st-seats">Change seat</button>
      <button type="button" class="st-leave">Leave the stands</button>
    </div>
    <div class="st-host"></div>
    <div class="st-tip">Drag to look around · wheel to zoom</div>`;
  document.body.appendChild(root);
  const host = root.querySelector('.st-host');
  // the eye the view reads every frame; the controls below turn it
  const seat = { eye: msg.section.eye, mode: 'follow', fov: msg.sport === 'hockey' ? 64 : 50, yaw: null, pitch: null };
  const ui = { root, seat, view: null, unview: null, channelId: msg.channelId, sport: msg.sport, got: false };
  seatUi = ui;
  // The city round the park comes with the venue, and only a game's first payload carries its
  // venueRev, so a seat taken mid-game would never ask and sit in a park with no skyline.
  if (!venueOf(msg.sport)) sendRaw({ type: 'tv_venue', sport: msg.sport });

  let view;
  try {
    view = msg.sport === 'hockey'
      ? (await import('./gameday-rink.js')).createRinkView(host, { seat, fly: false })
      : (await import('./gameday-grandstand.js')).createGrandstandView(host, { seat, force: true });
  } catch (err) {
    console.error('[stands] the view failed to load:', err);
    host.textContent = 'The view would not load.';
    return;
  }
  if (seatUi !== ui) { view.clear(); return; }   // left while it loaded
  ui.view = view;
  view.showIdle();

  const redraw = () => view.redraw?.();
  const modeBtn = root.querySelector('.st-mode');
  const setMode = (m) => {
    seat.mode = m;
    modeBtn.setAttribute('aria-pressed', String(m === 'follow'));
    modeBtn.textContent = m === 'follow' ? 'Follow the play' : 'Free look';
    redraw();
  };
  modeBtn.addEventListener('click', () => setMode(seat.mode === 'follow' ? 'free' : 'follow'));
  root.querySelector('.st-seats').addEventListener('click', () => sendCmd('stands'));
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
    const k = e.key;
    if (k === 'f' || k === 'F') { setMode(seat.mode === 'follow' ? 'free' : 'follow'); e.preventDefault(); }
    else if (k === 'ArrowLeft') { turn(-24, 0); e.preventDefault(); }
    else if (k === 'ArrowRight') { turn(24, 0); e.preventDefault(); }
    else if (k === 'ArrowUp') { turn(0, -18); e.preventDefault(); }
    else if (k === 'ArrowDown') { turn(0, 18); e.preventDefault(); }
  };
  document.addEventListener('keydown', ui.onKey);

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
    appendMessage(text, style, duration, hasGameday) {
      if (style === 'svg' || style === 'ticker') return;
      const plain = String(text || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
      if (plain) view.setCaption(plain, { held: !!hasGameday, ...(hasGameday === 'call' ? { call: true } : {}) });
    },
    showOffAir() { if (ui.got) view.setCaption('That’s the game. The crowd heads for the doors.', {}); },
    showOnAir() {}, updateTicker() {}, speak() {}, setProgramName() {}, renderSchedule() {}, renderStandings() {},
  });
}

export function closeStands() {
  const ui = seatUi;
  if (!ui) return;
  seatUi = null;
  ui.unview?.();
  if (ui.onKey) document.removeEventListener('keydown', ui.onKey);
  try { ui.view?.clear(); } catch { /* already torn down */ }
  ui.root.remove();
}

export const standsOpen = () => !!seatUi;
