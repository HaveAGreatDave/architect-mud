// ROOM · THE SHED'S LIFT (docs/systems-trucking.md, "The lift in the shed"). In a truck depot's shed the Room
// Stage has a lift in the floor: call one of your trucks up from the garage underneath, walk round it while it
// stands there, and climb in.
//
// It decides nothing. Every key is a verb a player could type: `hoist <id>` brings a truck up, `hoist down`
// sends it back, `drive <id>` seats you (the counter's Deploy). The server says what stands on the lift and
// how long it's been moving (`vehicles` on `room_view`, then `room_vehicles`); this plays that clock.
//
// ⚠ THE MESH IS GLASS'S. The truck's faces and colours come from aircraftFaces and faceBaseRgb (aircraft3d.js),
// the same calls the street draws the rig with, scaled to metres and stood on the platform. Nothing here shapes
// a truck. They come into the beasts batch (gl/room-beasts.js), which carries its own glows for the beacons.
import { loadCss } from '../../../shared/dom.js';
import { loadAircraft3d, aircraftFaces, faceBaseRgb, liveryPalette, truckLivery } from './aircraft3d-lazy.js';
import { vtx, lin, MAT } from './gl/ballpark-mesh.js';

const CSS = await loadCss(new URL('./room-hoist.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('room-hoist-css')) return;
  const s = document.createElement('style');
  s.id = 'room-hoist-css'; s.textContent = CSS;
  document.head.appendChild(s);
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// how tall a rig stands, metres (the model is scaled to it), and the longest it may be on this floor
const TRUCK_H = 3.9, TRUCK_MAX_L = 11;
// how far down the garage is, metres: the platform starts this far under the floor
const SHAFT = 5.2;
// how close you must be to the truck's side to climb in, metres
const REACH = 2.2;
// the platform's margin round the truck, metres
const APRON = 0.6;

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// one truck's faces in model units (f fore, g right, h up) with their colours and extent, per variant and paint
const _model = new Map();
function modelOf(variant, paint, grime) {
  const key = variant + '|' + JSON.stringify(paint || {}) + '|' + (grime || 0).toFixed(2);
  if (_model.has(key)) return _model.get(key);
  const faces = aircraftFaces('truck', 1, false, variant || 'hauler') || [];
  const pal = liveryPalette(truckLivery(paint || null, grime || 0), 'truck');
  let f0 = Infinity, f1 = -Infinity, g0 = Infinity, g1 = -Infinity, h0 = Infinity, h1 = -Infinity;
  for (const fc of faces) for (const p of fc.p) { f0 = Math.min(f0, p[0]); f1 = Math.max(f1, p[0]); g0 = Math.min(g0, p[1]); g1 = Math.max(g1, p[1]); h0 = Math.min(h0, p[2]); h1 = Math.max(h1, p[2]); }
  const m = faces.length ? { faces: faces.map((fc) => ({ p: fc.p, col: lin(hex(faceBaseRgb(fc, pal) || [120, 120, 120])), glass: fc.role === 'glass' || fc.role === 'window' })),
    f0, f1, g0, g1, h0, h1, c: [(f0 + f1) / 2, (g0 + g1) / 2, (h0 + h1) / 2] } : null;
  if (_model.size > 12) _model.delete(_model.keys().next().value);
  _model.set(key, m);
  return m;
}

/**
 * The lift of one open Stage. `send(cmd)` sends a verb; `walker()` is where you stand, [u, v], or null.
 */
export function createRoomHoist({ host, send, walker }) {
  ensureStyles();
  const panel = document.createElement('div');
  panel.className = 'rh-panel'; panel.hidden = true;
  panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', 'The lift');
  const board = document.createElement('button');
  board.type = 'button'; board.className = 'rh-board'; board.hidden = true;
  host.append(panel, board);
  panel.addEventListener('click', (e) => { const b = e.target.closest('button[data-cmd]'); if (b) { send(b.dataset.cmd); b.blur(); } });
  board.addEventListener('click', () => { if (board.dataset.cmd) { send(board.dataset.cmd); board.blur(); } });

  let V = null, L = null, t0 = 0, tDown = 0, ready = false, box = null, shown = '', ver = 0;

  // where the lift is in the room: across the middle, a little back of halfway, the truck's nose to the front wall
  const spot = () => [0, (L?.spec?.d || 20) * 0.52];
  // the lift's state now: 0 down in the garage, 1 up on the floor
  function level(now = performance.now()) {
    const ms = V?.hoistMs || 9000, lf = V?.lift;
    if (!lf) return 0;
    if (lf.down != null) return 1 - ease((now - tDown) / ms);
    return ease((now - t0) / ms);
  }
  const moving = (now) => { const lf = V?.lift; if (!lf) return false; const k = level(now); return lf.down != null ? k > 0 : k < 1; };

  function paintPanel() {
    const lf = V?.lift, mine = V?.mine || [];
    const up = lf && lf.down == null && level() >= 1, rising = lf && lf.down == null && !up, sinking = lf && lf.down != null;
    const key = JSON.stringify([lf?.id, lf?.mine, up, rising, sinking, mine.map((t) => t.id)]);
    if (key === shown) return;
    shown = key;
    let body;
    if (sinking) body = `<p class="rh-note">Going down: the ${esc(lf.name)}.</p>`;
    else if (rising) body = `<p class="rh-note">Coming up: the ${esc(lf.name)}.</p>`;
    else if (up) body = `<p class="rh-note">On the floor: the ${esc(lf.name)}.</p>`
      + (lf.mine ? `<button type="button" data-cmd="drive ${esc(lf.id)}">Drive it out</button><button type="button" class="rh-down" data-cmd="hoist down">Send it down</button>` : '');
    else if (mine.length) body = `<p class="rh-note">Bring one up from the garage:</p>` + mine.map((t) => `<button type="button" data-cmd="hoist ${esc(t.id)}">${esc(t.name)}</button>`).join('');
    else body = `<p class="rh-note">Nothing of yours downstairs here.</p><button type="button" data-cmd="hoist">Ask the lift</button>`;
    panel.innerHTML = `<div class="rh-head"><b>LIFT</b><span>${up ? 'up' : rising ? 'rising' : sinking ? 'lowering' : 'down'}</span></div>${body}`;
  }

  // the truck as a box on the floor plan, [u0, u1, v0, v1], once its model is known; a walker goes round it
  function footprint(m) {
    const [u, v] = spot(), s = scaleOf(m);
    const hl = (m.f1 - m.f0) * s / 2 + APRON * 0.3, hw = (m.g1 - m.g0) * s / 2 + APRON * 0.3;
    return [u - hw, u + hw, v - hl, v + hl];
  }
  const scaleOf = (m) => Math.min(TRUCK_H / Math.max(1e-6, m.h1 - m.h0), TRUCK_MAX_L / Math.max(1e-6, m.f1 - m.f0));
  function setSolid(b) {
    if (!L?.solid) return;
    const i = L.solid.findIndex((q) => q._hoist);
    if (i >= 0) L.solid.splice(i, 1);
    if (b) { const q = b.slice(); q._hoist = true; L.solid.push(q); }
  }

  /** A room opened or rebuilt (`L` its layout), or the server said what's on the lift (`vehicles`). */
  function load(Lnew, vehicles) {
    if (Lnew) L = Lnew;
    if (vehicles !== undefined) {
      const was = V?.lift, now = performance.now();
      V = vehicles || null;
      const lf = V?.lift;
      if (lf) {
        // the same truck keeps its clock; a new one takes the server's age
        if (!was || was.id !== lf.id || was.down == null && lf.down == null && Math.abs((now - t0) - lf.age) > 1500) t0 = now - (lf.age || 0);
        if (lf.down != null && (was?.down == null || !was)) tDown = now - lf.down;
      }
    }
    panel.hidden = !V;
    if (!V) { board.hidden = true; setSolid(null); box = null; ver++; return; }
    shown = '';
    paintPanel();
    ver++;
    if (V.lift && !ready) loadAircraft3d().then(() => { ready = true; ver++; }).catch(() => {});
  }

  /** Into the beasts batch: the platform, the truck at its height, and the beacons while it moves. */
  function into(b, now = performance.now()) {
    if (!L || !V) return;
    const [u, v] = spot(), lf = V.lift;
    const m = lf && ready ? modelOf(lf.variant, lf.paint, lf.grime) : null;
    const k = level(now), y = -SHAFT * (1 - k), go = moving(now);
    // the platform's size: the truck's, plus an apron round it; a default before the model's in
    const s = m ? scaleOf(m) : 1;
    const hl = m ? (m.f1 - m.f0) * s / 2 + APRON : 4.5, hw = m ? (m.g1 - m.g0) * s / 2 + APRON : 1.9;
    const W = (a, c, h) => L.world(u + a, v + c, h);
    const up = [0, 1, 0], uv = [0, 0];
    const quad = (p, col, mat = MAT.PLATE) => { for (const i of [0, 1, 2, 0, 2, 3]) vtx(b, p[i], up, uv, col, mat); };
    // the frame round the opening: hazard stripes, flush with the floor, there whether the lift is up or down
    const fr = 0.28, stripe = lin('#d8a018'), dark = lin('#1b1b1d');
    const edge = (a0, a1, c0, c1) => {
      const along = Math.abs(a1 - a0) > Math.abs(c1 - c0), n = Math.max(1, Math.round((along ? a1 - a0 : c1 - c0) / 0.5));
      for (let i = 0; i < n; i++) {
        const s0 = i / n, s1 = (i + 1) / n;
        const [x0, x1, z0, z1] = along ? [a0 + (a1 - a0) * s0, a0 + (a1 - a0) * s1, c0, c1] : [a0, a1, c0 + (c1 - c0) * s0, c0 + (c1 - c0) * s1];
        quad([W(x0, z0, 0.006), W(x1, z0, 0.006), W(x1, z1, 0.006), W(x0, z1, 0.006)], i % 2 ? dark : stripe, MAT.MATTE);
      }
    };
    edge(-hw - fr, hw + fr, -hl - fr, -hl); edge(-hw - fr, hw + fr, hl, hl + fr);
    edge(-hw - fr, -hw, -hl, hl); edge(hw, hw + fr, -hl, hl);
    // the hole, while there's one: the plate is somewhere under the floor
    if (k < 0.999) quad([W(-hw, -hl, 0.004), W(hw, -hl, 0.004), W(hw, hl, 0.004), W(-hw, hl, 0.004)], lin('#050505'), MAT.MATTE);
    // the plate itself, chequered steel, riding with the truck; under the floor it's hidden by the floor
    const yp = Math.min(0.012, y + 0.012);
    if (k > 0.02) quad([W(-hw, -hl, yp), W(hw, -hl, yp), W(hw, hl, yp), W(-hw, hl, yp)], lin('#5d6166'));
    if (m) {
      // nose to the front wall (v falls), the cab's right-hand side to the room's +u
      const F = sub(L.world(u, v - 1, 0), L.world(u, v, 0)), R = sub(L.world(u + 1, v, 0), L.world(u, v, 0));
      const O = L.world(u, v, y + 0.012);
      const place = (p) => { const f = (p[0] - m.c[0]) * s, g = (p[1] - m.c[1]) * s, h = (p[2] - m.h0) * s; return [O[0] + F[0] * f + R[0] * g, O[1] + h, O[2] + F[2] * f + R[2] * g]; };
      const C = place(m.c);
      for (const fc of m.faces) {
        const q = fc.p.map(place);
        if (q.length < 3) continue;
        const a = sub(q[1], q[0]), c = sub(q[2], q[0]);
        let n = [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
        const nl = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / nl, n[1] / nl, n[2] / nl];
        const mid = q.reduce((acc, p) => [acc[0] + p[0] / q.length, acc[1] + p[1] / q.length, acc[2] + p[2] / q.length], [0, 0, 0]);
        if ((mid[0] - C[0]) * n[0] + (mid[1] - C[1]) * n[1] + (mid[2] - C[2]) * n[2] < 0) n = [-n[0], -n[1], -n[2]];
        const mat = fc.glass ? MAT.GLOSS : MAT.SATIN;
        for (let j = 1; j + 1 < q.length; j++) for (const p of [q[0], q[j], q[j + 1]]) vtx(b, p, n, uv, fc.col, mat);
      }
    }
    // the beacons at the corners of the opening, going round while it moves
    if (go) {
      const on = Math.floor(now / 350) % 2;
      b.lights = (b.lights || []).concat([[-1, -1], [1, 1], [1, -1], [-1, 1]].filter((_, i) => i % 2 === on)
        .map(([a, c]) => ({ p: W(a * (hw + fr), c * (hl + fr), 0.6), c: [1.0, 0.62, 0.12], r: 6 })));
    }
    // the walker goes round the truck once it's up, and round the hole while it's open
    box = m && k > 0.02 ? footprint(m) : k < 0.999 && lf ? [u - hw, u + hw, v - hl, v + hl] : null;
    setSolid(box);
  }

  /** Each frame: the panel's word, and the key to climb in when you're beside your own truck on the floor. */
  function frame(now = performance.now()) {
    if (!V) return;
    paintPanel();
    const lf = V.lift, at = walker();
    const near = lf?.mine && lf.down == null && level(now) >= 1 && box && at
      && at[0] > box[0] - REACH && at[0] < box[1] + REACH && at[1] > box[2] - REACH && at[1] < box[3] + REACH;
    board.hidden = !near;
    if (near && board.dataset.cmd !== `drive ${lf.id}`) {
      board.dataset.cmd = `drive ${lf.id}`;
      board.innerHTML = `Climb into the ${esc(lf.name)}`;
    }
  }

  return { load, into, frame, moving: (now) => moving(now ?? performance.now()), get active() { return !!V; }, get ver() { return ver; },
    dispose() { panel.remove(); board.remove(); setSolid(null); } };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
