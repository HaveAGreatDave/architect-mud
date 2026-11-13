// ROOM · THE LIFT'S PANEL (docs/proposals/building-stage.md). A hologram hung off the reader on a lift car's
// right-hand wall, drawn the way a door's hololock is (room-lock.js, and its sheet): the floor the car is at
// or passing, and a button for every floor it stops at.
//
// It decides nothing. A button is `floor <n>`, the elevator plugin's verb, typeable in the log; `press` is the
// Stage's, which shuts the doors and sends it.
//
// The hologram is a page bent onto four points of the car each frame (`quadMatrix`), so its buttons are real
// buttons laid out by the browser's own grid.

import { liftButtons, liftPanelAt } from '../../../shared/room-layout.js';
import { quadMatrix } from './room-lock.js';
import { comicOn } from './gl/house-style.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// the page's width, px, and how many metres one of its pixels is on the wall (a hololock's card is the same)
const PAGE_W = 300, M_PER_PX = 0.0015;
// how far the hologram hangs off the wall, metres, and its amber
const HOLO_OFF = 0.17, HUE = '#ffb040';

/**
 * The panel of one open Stage. `project(p, w, h)` is the renderer's; `press(n)` asks for floor n.
 */
export function createRoomLift({ host, project, press }) {
  const layer = document.createElement('div');
  layer.className = 'rl-layer';
  host.appendChild(layer);
  const el = document.createElement('div');
  layer.appendChild(el);
  el.style.display = 'none';
  el.addEventListener('click', (e) => { const b = e.target.closest('.rl-fl'); if (b) press(Number(b.dataset.n)); });
  let bs = [], quad = null, size = [PAGE_W, 400], at = 1, comic = null, shown = null, hidden = true, card = null;

  // the floors lowest first, as the keys count them; on the card the top floor is the top row
  function paint() {
    comic = comicOn();
    const n = bs.length, cols = n <= 5 ? 1 : n <= 10 ? 2 : 4, rows = [];
    for (let i = 0; i < n; i += cols) rows.unshift(bs.slice(i, i + cols).map((b, j) => ({ b, i: i + j })));
    const btn = ({ b, i }) => `<button type="button" class="rl-act rl-fl${b.n === at ? ' rl-here' : ''}" data-n="${b.n}" title="${esc(b.label || '')}">${cols < 4 && i < 9 ? `<kbd>${i ? i + 1 : 'F'}</kbd>` : ''}<b>${esc(b.tag)}</b>${cols === 1 ? `<span>${esc(b.label || '')}</span>` : ''}</button>`;
    size = [PAGE_W, Math.max(400, 222 + rows.length * 56)];
    el.className = `rl-holo rl-lift${comic ? ' rl-comic' : ''}`;
    el.style.setProperty('--rl-hue', HUE);
    el.style.width = size[0] + 'px'; el.style.height = size[1] + 'px';
    el.innerHTML = `<div class="rl-head"><b>LIFT</b><span></span></div>
      <div class="rl-state"><strong></strong></div>
      <p class="rl-note"></p>
      <div class="rl-acts rl-floors" style="--rl-cols:${cols}">${rows.flat().map(btn).join('')}</div>`;
    shown = null;
  }

  // The car's panel, new or on a new floor. A room with no lift has none. `S` is the car's spec with its `lift`;
  // `remote` when the car is the room next door (seen from its landing): drawn the same, but not yours to press.
  let away = false;
  function load(L, S = L?.spec, remote = false) {
    const p = S?.lift ? liftPanelAt(S) : null;
    bs = p ? liftButtons(S) : [];
    card = null; away = remote;
    if (!p) { quad = null; el.style.display = 'none'; hidden = true; return; }
    at = S.lift.at;
    paint();
    const wm = size[0] * M_PER_PX, hm = size[1] * M_PER_PX, y = Math.max(p.y, 0.45 + hm / 2), u = p.u - HOLO_OFF;
    quad = [L.world(u, p.v - wm / 2, y + hm / 2), L.world(u, p.v + wm / 2, y + hm / 2), L.world(u, p.v + wm / 2, y - hm / 2), L.world(u, p.v - wm / 2, y - hm / 2)];
  }

  const tagOf = (n) => bs.find((b) => b.n === n)?.tag ?? String(n);
  // Laid over its four points, every frame. `floor` is the one the read-out shows; `ride` is { from, to } while
  // the car moves, else null.
  function draw(w, h, floor, ride) {
    // the car next door: its panel is a page over the picture, so nothing in the picture hides it, and from the
    // landing it showed through the shaft wall. You press it from inside the car, so it shows only from there.
    if (!quad || away) { if (!hidden) { el.style.display = 'none'; hidden = true; } return; }
    if (comic !== comicOn()) paint();
    const going = ride ? Math.sign(ride.to - ride.from) : 0, key = `${floor}:${going}:${ride?.to ?? ''}`;
    if (key !== shown) {
      shown = key;
      const stop = bs.find((b) => b.n === floor);
      el.querySelector('.rl-state strong').textContent = tagOf(floor);
      el.querySelector('.rl-head span').textContent = ride ? `to ${tagOf(ride.to)}` : stop?.label || '';
      el.querySelector('.rl-note').textContent = going > 0 ? 'Going up.' : going < 0 ? 'Going down.' : 'Pick a floor.';
      el.classList.toggle('rl-up', going > 0); el.classList.toggle('rl-down', going < 0);
      for (const b of el.querySelectorAll('.rl-fl')) b.classList.toggle('rl-going', !!ride && Number(b.dataset.n) === ride.to);
    }
    const q = quad.map((p) => project(p, w, h));
    let m = null;
    if (q.every(Boolean)) {
      let pts = q.map((p) => [p.x, p.y]);
      // seen the other way round: turn it to read
      const area = pts.reduce((s, p, i) => { const n = pts[(i + 1) % 4]; return s + p[0] * n[1] - n[0] * p[1]; }, 0);
      if (area < 0) pts = [pts[1], pts[0], pts[3], pts[2]];
      if (Math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1]) > 22 && pts.every((p) => Math.abs(p[0]) < 6 * w + 2000 && Math.abs(p[1]) < 6 * h + 2000)) m = quadMatrix(size[0], size[1], pts);
    }
    if (!m) { if (!hidden) { el.style.display = 'none'; hidden = true; } return; }
    if (hidden) { el.style.display = ''; hidden = false; }
    el.style.transform = m;
  }

  // The panel as the Stage's card ({ id, name, lift, liftActs }), for F and the number keys, or null in a room
  // with no lift. A car is small enough that you're always at it.
  const aim = () => (quad && !away ? card || (card = { id: 'lift:panel', name: 'Lift', lift: true, liftActs: bs.map((b) => ({ verb: 'floor', label: b.tag, n: b.n })) }) : null);

  return { load, draw, aim, get on() { return !!quad; }, stop() { layer.remove(); } };
}
