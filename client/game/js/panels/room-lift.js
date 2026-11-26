// ROOM · THE LIFT'S PANEL (docs/proposals/building-stage.md). A hologram hung off the reader on a lift car's
// right-hand wall: amber light off a brass emitter, in the car's own gold, with a read-out of the floor the car
// is at or passing, where it is in the shaft, and a key for every floor it stops at with that floor's name.
//
// It decides nothing. A button is `floor <n>`, the elevator plugin's verb, typeable in the log; `press` is the
// Stage's, which shuts the doors and sends it.
//
// The hologram is a page bent onto four points of the car each frame (`quadMatrix`), so its buttons are real
// buttons laid out by the browser's own grid.

import { liftButtons, liftPanelAt } from '../../../shared/room-layout.js';
import { quadMatrix, ensureStyles } from './room-lock.js';
import { comicOn } from './gl/house-style.js';
import { loadCss } from '../../../shared/dom.js';

// Its own sheet and faces, in before the module is: the panel is never drawn in a fallback face that swaps a
// moment later, or with no sheet. A face that fails or is slow (1.5 s) leaves the fallback rather than a hang.
const SHEET = await loadCss(new URL('./room-lift.css', import.meta.url));
const FACES = [['RLH Michroma', 'michroma'], ['RLH Digit14', 'digit-tech-14'], ['RLH Orbitron', 'orbitron']];
await Promise.race([
  Promise.all(FACES.map(([fam, file]) => {
    try {
      if (typeof FontFace === 'undefined' || !document.fonts) return null;
      return new FontFace(fam, `url(${new URL(`../../../shared/fonts/${file}.woff2`, import.meta.url)})`).load().then((f) => document.fonts.add(f), () => {});
    } catch { return null; }
  })),
  new Promise((r) => setTimeout(r, 1500)),
]);
function ensureSheet() {
  if (document.getElementById('room-lift-css')) return;
  const st = document.createElement('style');
  st.id = 'room-lift-css'; st.textContent = SHEET;
  document.head.appendChild(st);
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// the page's width, px, and how many metres one of its pixels is on the wall (a hololock's card is the same)
const PAGE_W = 400, M_PER_PX = 0.0015;
// how far the hologram hangs off the wall, metres
const HOLO_OFF = 0.17;

/**
 * The panel of one open Stage. `project(p, w, h)` is the renderer's; `press(n)` asks for floor n.
 */
export function createRoomLift({ host, project, press }) {
  ensureStyles();   // the hologram's base is room-lock.css; a car with no locked door in sight never had it
  ensureSheet();
  const layer = document.createElement('div');
  layer.className = 'rl-layer';
  host.appendChild(layer);
  const el = document.createElement('div');
  layer.appendChild(el);
  el.style.display = 'none';
  el.addEventListener('click', (e) => { const b = e.target.closest('.rlh-fl'); if (b) press(Number(b.dataset.n)); });
  let bs = [], brand = '', quad = null, size = [PAGE_W, 400], at = 1, comic = null, shown = null, hidden = true, card = null;

  function paint() {
    comic = comicOn();
    // every floor is a key with its name beside it, top floor first: one column for a short building, two, or
    // three for a tower; the page grows to fit and never cuts a row off
    const n = bs.length, cols = n <= 7 ? 1 : n <= 20 ? 2 : 3, rows = Math.ceil(n / cols);
    const btn = (b) => `<button type="button" class="rl-act rlh-fl${b.n === at ? ' rl-here' : ''}" data-n="${b.n}" title="${esc(b.label || '')}" aria-label="${esc(b.tag + (b.label ? ', ' + b.label : ''))}"><b>${esc(b.tag)}</b><span>${esc(b.label || (b.tag === 'L' ? 'Lobby' : 'Floor ' + b.tag))}</span></button>`;
    // padding 18 + head 30 + screen 104 + two gaps of 12 + rows of 34 with 6 between + 26 for the emitter
    size = [PAGE_W, 196 + rows * 40];
    // the building's mark: its initials in a ring, and its name beside it
    const mono = brand ? brand.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '';
    // the shaft rail's ticks, lowest at the foot
    const ticks = bs.map((_, i) => `<i style="top:${n > 1 ? (100 - (i / (n - 1)) * 100).toFixed(1) : 50}%"></i>`).join('');
    el.className = 'rl-holo rl-lift rlh';
    el.style.width = size[0] + 'px'; el.style.height = size[1] + 'px';
    el.innerHTML = `<div class="rlh-head"><span class="rlh-mono">${mono ? esc(mono) : '&#9650;'}</span><span class="rlh-brand">${esc(brand || 'Lift')}</span></div>
      <div class="rlh-screen"><div class="rlh-rail">${ticks}<span class="rlh-bead"></span></div><div class="rlh-read"><strong class="rlh-num"></strong><span class="rlh-name"></span></div><div class="rlh-dir"><i class="rlh-up">&#9650;</i><i class="rlh-dn">&#9660;</i></div></div>
      <div class="rlh-floors" style="--rl-cols:${cols}">${bs.slice().reverse().map(btn).join('')}</div>`;
    shown = null;
  }

  // The car's panel, new or on a new floor. A room with no lift has none. `S` is the car's spec with its `lift`;
  // `remote` when the car is the room next door (seen from its landing): drawn the same, but not yours to press.
  let away = false;
  function load(L, S = L?.spec, remote = false) {
    const p = S?.lift ? liftPanelAt(S) : null;
    bs = p ? liftButtons(S) : [];
    brand = String(S?.lift?.brand || '');
    card = null; away = remote;
    if (!p) { quad = null; el.style.display = 'none'; hidden = true; return; }
    at = S.lift.at;
    // a car clad in its own colours (spec.car.glow) lights its panel in that glow; the gold stays
    const g = /^#[0-9a-f]{6}$/i.test(S.car?.glow || '') ? S.car.glow : null;
    if (g) { const n = parseInt(g.slice(1), 16); el.style.setProperty('--glow', 'rgba(' + (n >> 16) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', 0.6)'); el.style.setProperty('--ink', g); }
    else { el.style.removeProperty('--glow'); el.style.removeProperty('--ink'); }
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
      // the number it's at or passing, and a name: the floor's own when it stops here, else where it's going
      const name = String((stop || bs.find((b) => b.n === ride?.to))?.label || '').toUpperCase();
      el.querySelector('.rlh-num').textContent = tagOf(floor);
      const nm = el.querySelector('.rlh-name');
      nm.textContent = name;
      // sized to fit the glass on one line (Digit Tech 14 is about 0.72 em a letter with its spacing), never cut off
      nm.style.fontSize = Math.max(9, Math.min(15, 210 / Math.max(1, name.length * 0.72))) + 'px';
      // the bead on the shaft rail: where this floor is among the stops
      const k = bs.findIndex((b) => b.n === floor), bead = el.querySelector('.rlh-bead');
      if (bead && k >= 0) bead.style.top = (bs.length > 1 ? 100 - (k / (bs.length - 1)) * 100 : 50) + '%';
      el.classList.toggle('rl-up', going > 0); el.classList.toggle('rl-down', going < 0);
      for (const b of el.querySelectorAll('.rlh-fl')) {
        b.classList.toggle('rl-going', !!ride && Number(b.dataset.n) === ride.to);
        b.classList.toggle('rl-here', !ride && Number(b.dataset.n) === floor);
      }
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
