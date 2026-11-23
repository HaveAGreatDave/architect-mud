// ROOM · THE VEHICLE STAND (docs/reference/depot-shell.md, "Call it up"; docs/systems-trucking.md, "The lift in
// the shed"). In a depot room the Room Stage has somewhere a vehicle is brought out onto the floor: a truck shed's
// lift, a hangar's far bay that the tug pulls an aircraft out of, a marina's covered slip that a boat is walked
// into through the water gate, the racer bay's back door that a racer is rolled out of on its dolly. Call one of
// yours out, walk round it while it stands there, and climb in.
//
// It decides nothing. Every key is a verb a player could type: `callup <id>` (in a shed, `hoist <id>`) brings one
// out, `callup back` sends it away, and the key beside it is the seat's own verb from the server (`drive <id>`,
// `hangaract launch <id>`, `boat take <id>`, `podracer take <id>`). The server says what stands on the floor and how
// long it's been moving (`vehicles` on `room_view`, then `room_vehicles`); this plays that clock.
//
// Where it stands is the room's `stand` (`flags.room.stand`, room-layout.js standSpecOf): the box it's scaled into,
// the wall its nose points at, and `from`, which is `below` (the lift) or the wall it comes in through, where a big
// door is drawn. A room with no stand is a truck shed's lift, across the middle and a little back of halfway.
//
// ⚠ THE MESH IS GLASS'S. A vehicle's faces and colours come from aircraftFaces (standFaces), liveryPalette and
// faceBaseRgb (aircraft3d.js), the calls the street and the counter's cards draw it with, scaled to metres and stood
// on the floor. Nothing here shapes a vehicle. They come into the beasts batch (gl/room-beasts.js), which carries its
// own glows for the beacons.
import { loadCss } from '../../../shared/dom.js';
import { loadAircraft3d, aircraftFaces, standFaces, faceBaseRgb, liveryPalette, truckLivery } from './aircraft3d-lazy.js';
import { podracerLook, podracerLivery } from './podracer-model.js';
import { vtx, lin, MAT } from './gl/ballpark-mesh.js';
import { bayOf } from '../../../shared/room-layout.js';
import { dealerBay, dealerCar } from '../../../shared/dealer-display.js';

const CSS = await loadCss(new URL('./room-hoist.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('room-hoist-css')) return;
  const s = document.createElement('style');
  s.id = 'room-hoist-css'; s.textContent = CSS;
  document.head.appendChild(s);
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// how tall a rig stands on a shed's lift, metres (the model is scaled to it), and the longest it may be on that floor
const TRUCK_H = 3.9, TRUCK_MAX_L = 11;
// how far down a lift's garage is, metres: the platform starts this far under the floor
const SHAFT = 5.2;
// how close you must be to the vehicle's side to climb in, metres
const REACH = 2.2;
// the platform's margin round the vehicle, metres
const APRON = 0.6;
// how long each kind is, nose to tail, in metres, so a small aircraft isn't blown up to fill a big hangar's stand.
// The stand's box is the most it can be; this is what it would be
const TRUE_LEN = { truck: 9.5, prop: 9, ultralight: 6.5, grasshopper: 7, locust: 8.5, heli: 12, gunship: 15, heavy: 21, divebomber: 11, podracer: 9, merlin: 4.6, pipit: 4, bustard: 4.7, lanner: 4.9,
  skiff: 5.5, hydro: 7, spur: 8, gamecock: 9 };
// the words for each kind: what's on the floor, the way out, the way in
const WORDS = {
  truck: { board: 'Climb into the', back: 'Send it down', ask: 'Ask the lift', bring: 'Bring one up from the garage:', none: 'Nothing of yours downstairs here.',
    state: ['down', 'rising', 'up', 'lowering'], coming: 'Coming up', going: 'Going down' },
  aircraft: { board: 'Climb aboard the', back: 'Tow her back', ask: 'Ask the tug', bring: 'Have one pulled out:', none: 'Nothing of yours parked at this field.',
    state: ['in the bay', 'towing out', 'out', 'towing back'], coming: 'Towing out', going: 'Towing back' },
  boat: { board: 'Step aboard the', back: 'Send her back', ask: 'Ask the yard', bring: 'Bring one into the slip:', none: 'Nothing of yours kept in this slip.',
    state: ['in the wet store', 'coming in', 'alongside', 'going out'], coming: 'Coming in', going: 'Going out' },
  podracer: { board: 'Climb into the', back: 'Roll it back', ask: 'Ask the yard', bring: 'Roll one out:', none: 'Nothing of yours kept in this bay.',
    state: ['in the yard', 'rolling out', 'out', 'rolling back'], coming: 'Rolling out', going: 'Rolling back' },
};
const wordsOf = (kind) => WORDS[kind] || WORDS.truck;

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
// the way each wall is from the middle of the room, in its u and v (left is -u, front is v = 0)
const OUT = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] };

// one vehicle's faces in model units (f fore, g right, h up) with their colours and extent, per look
const _model = new Map();
function modelOf(look) {
  const key = JSON.stringify(look || {});
  if (_model.has(key)) return _model.get(key);
  const cls = look?.cls || 'truck';
  let faces, pal;
  if (cls === 'truck') {
    faces = aircraftFaces('truck', 1, false, look.variant || 'hauler') || [];
    pal = liveryPalette(truckLivery(look.paint || null, look.grime || 0), 'truck');
  } else if (cls === 'podracer') {
    const kit = look.kit || null;
    faces = standFaces('podracer', false, look.variant || '', podracerLook(kit).anim) || [];
    pal = liveryPalette(podracerLivery(look.livery || null, kit) || {}, 'podracer');
  } else {
    const variant = look.livery?.variant && look.livery.variant !== 'stock' ? look.livery.variant : (look.variant || '');
    faces = standFaces(cls, !!look.armed, variant) || [];
    pal = liveryPalette(look.livery || {}, cls, !!look.armed);
  }
  let f0 = Infinity, f1 = -Infinity, g0 = Infinity, g1 = -Infinity, h0 = Infinity, h1 = -Infinity;
  for (const fc of faces) for (const p of fc.p) { f0 = Math.min(f0, p[0]); f1 = Math.max(f1, p[0]); g0 = Math.min(g0, p[1]); g1 = Math.max(g1, p[1]); h0 = Math.min(h0, p[2]); h1 = Math.max(h1, p[2]); }
  const m = faces.length ? { cls, faces: faces.map((fc) => ({ p: fc.p, col: lin(hex(faceBaseRgb(fc, pal) || [120, 120, 120])), glass: fc.role === 'glass' || fc.role === 'window' || fc.role === 'canopy' })),
    f0, f1, g0, g1, h0, h1, c: [(f0 + f1) / 2, (g0 + g1) / 2, (h0 + h1) / 2] } : null;
  if (_model.size > 12) _model.delete(_model.keys().next().value);
  _model.set(key, m);
  return m;
}

/**
 * The stand of one open Stage. `send(cmd)` sends a verb; `walker()` is where you stand, [u, v], or null.
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

  let V = null, L = null, t0 = 0, tDown = 0, ready = false, box = null, near = null, shown = '', ver = 0;

  const kindOf = () => V?.kind || 'truck';
  // the room's stand, or a shed's lift across the middle, a little back of halfway, nose to the front wall
  const standOf = () => L?.spec?.stand || null;
  const spot = () => standOf()?.at || [0, (L?.spec?.d || 20) * 0.52];
  const faceOf = () => standOf()?.face || 'front';
  const fromOf = () => standOf()?.from || V?.from || 'below';
  // the state now: 0 put away, 1 out on the floor
  function level(now = performance.now()) {
    const ms = V?.moveMs || V?.hoistMs || 9000, lf = V?.lift;
    if (!lf) return 0;
    if (lf.down != null) return 1 - ease((now - tDown) / ms);
    return ease((now - t0) / ms);
  }
  const moving = (now) => { const lf = V?.lift; if (!lf) return false; const k = level(now); return lf.down != null ? k > 0 : k < 1; };

  function paintPanel() {
    const lf = V?.lift, mine = V?.mine || [], W = wordsOf(kindOf());
    const up = lf && lf.down == null && level() >= 1, rising = lf && lf.down == null && !up, sinking = lf && lf.down != null;
    const shop = V?.shop || [];
    const key = JSON.stringify([lf?.id, lf?.mine, up, rising, sinking, mine.map((t) => t.id), shop.map((t) => [t.id, t.afford])]);
    if (key === shown) return;
    shown = key;
    const call = V?.call || 'hoist', back = V?.back || 'hoist down';
    let body;
    if (sinking) body = `<p class="rh-note">${W.going}: the ${esc(lf.name)}.</p>`;
    else if (rising) body = `<p class="rh-note">${W.coming}: the ${esc(lf.name)}.</p>`;
    else if (up) body = `<p class="rh-note">On the floor: the ${esc(lf.name)}.</p>`
      + (lf.mine ? `<button type="button" data-cmd="${esc(boardCmd(lf))}">${esc(W.board)} ${esc(lf.name)}</button><button type="button" class="rh-down" data-cmd="${esc(back)}">${esc(W.back)}</button>` : '');
    else if (mine.length) body = `<p class="rh-note">${esc(W.bring)}</p>` + mine.map((t) => `<button type="button" data-cmd="${esc(call)} ${esc(t.id)}">${esc(t.name)}</button>`).join('');
    else body = `<p class="rh-note">${esc(W.none)}</p><button type="button" data-cmd="${esc(call)}">${esc(W.ask)}</button>`;
    // what this depot sells, when the lift's free: the counter's `yard buy`, one button a truck
    if (shop.length && !lf) body += `<p class="rh-note">For sale here:</p>` + shop.map((t) => `<button type="button" class="rh-buy"${t.afford ? '' : ' disabled'} data-cmd="${esc(t.cmd)}">${esc(t.name)} · ${esc(String(t.price))}₵</button>`).join('');
    const st = W.state[up ? 2 : rising ? 1 : sinking ? 3 : 0];
    panel.setAttribute('aria-label', 'The ' + String(V?.label || 'lift').toLowerCase());
    panel.innerHTML = `<div class="rh-head"><b>${esc(V?.label || 'LIFT')}</b><span>${esc(st)}</span></div>${body}`;
  }
  const boardCmd = (lf) => lf.board || `drive ${lf.id}`;

  // the model's scale to metres: the shed's lift stands a rig at its height; a stand fits its box, no bigger than true
  function scaleOf(m) {
    const S = standOf();
    if (!S) return Math.min(TRUCK_H / Math.max(1e-6, m.h1 - m.h0), TRUCK_MAX_L / Math.max(1e-6, m.f1 - m.f0));
    const len = m.f1 - m.f0, wid = m.g1 - m.g0, tall = m.h1 - m.h0;
    const fit = Math.min(S.len / Math.max(1e-6, len), S.wid / Math.max(1e-6, wid), Math.max(1, (L?.spec?.h || 8) - 0.5) / Math.max(1e-6, tall));
    return Math.min(fit, (TRUE_LEN[m.cls] || S.len) / Math.max(1e-6, len));
  }
  // the vehicle's nose and right-hand side in the room's u and v
  const axes = () => { const F = OUT[faceOf()] || OUT.front; return { F, R: [-F[1], F[0]] }; };
  // where its middle is now: on the stand, or on its way in from the wall it comes through
  function centreAt(k, m, s) {
    const [u, v] = spot(), from = fromOf();
    if (from === 'below') return [u, v];
    const D = OUT[from] || OUT.back, hu = (L?.spec?.w || 16) / 2, d = L?.spec?.d || 20;
    // how far it has to come: from just behind that wall, its far end out of sight
    const toWall = D[0] ? (D[0] > 0 ? hu - u : u + hu) : (D[1] > 0 ? d - v : v);
    const { F } = axes();
    const reach = m ? (Math.abs(F[0] * D[0] + F[1] * D[1]) > 0.5 ? (m.f1 - m.f0) : (m.g1 - m.g0)) * s / 2 : 4;
    const off = (toWall + reach + 0.4) * (1 - k);
    return [u + D[0] * off, v + D[1] * off];
  }
  // a box on the floor plan round a centre, [u0, u1, v0, v1], from half its length along the nose and half across
  function boxAt(c, hl, hw) {
    const { F } = axes(), alongU = Math.abs(F[0]) > 0.5;
    const au = alongU ? hl : hw, av = alongU ? hw : hl;
    return [c[0] - au, c[0] + au, c[1] - av, c[1] + av];
  }
  function setSolid(tag, b) {
    if (!L?.solid) return;
    const i = L.solid.findIndex((q) => q._hoist === tag);
    if (i >= 0) L.solid.splice(i, 1);
    if (b) { const q = b.slice(); q._hoist = tag; L.solid.push(q); }
  }

  /** A room opened or rebuilt (`L` its layout), or the server said what's on the floor (`vehicles`). */
  function load(Lnew, vehicles) {
    if (Lnew) L = Lnew;
    if (vehicles !== undefined) {
      const was = V?.lift, now = performance.now();
      V = vehicles || null;
      const lf = V?.lift;
      if (lf) {
        // the same vehicle keeps its clock; a new one takes the server's age
        if (!was || was.id !== lf.id || was.down == null && lf.down == null && Math.abs((now - t0) - lf.age) > 1500) t0 = now - (lf.age || 0);
        if (lf.down != null && (was?.down == null || !was)) tDown = now - lf.down;
      }
    }
    panel.hidden = !V;
    // a showroom's display cars (below): solid where they stand, and their meshes asked for once
    if (Lnew) {
      if (L.solid) for (let i = L.solid.length - 1; i >= 0; i--) if (L.solid[i]._hoist === 'display') L.solid.splice(i, 1);
      for (const d of L.spec?.display || []) if (L.solid) { const q = d.box.slice(); q._hoist = 'display'; L.solid.push(q); }
      if (L.spec?.display?.length && !ready) loadAircraft3d().then(() => { ready = true; ver++; }).catch(() => {});
    }
    // a slip is water whether or not there's a boat in it: you can't walk into it
    const S = standOf();
    setSolid('water', V && S?.water ? S.box : null);
    if (!V) { board.hidden = true; setSolid('body', null); box = null; near = null; ver++; return; }
    shown = '';
    paintPanel();
    ver++;
    if (V.lift && !ready) loadAircraft3d().then(() => { ready = true; ver++; }).catch(() => {});
  }

  // A TRUCK SHED'S OWN PLATFORM (room-layout.js bayOf): GLASS's chequer plate and its hazard edge, from the bake,
  // `k` of the way up its shaft. The shed itself is the room's mesh (gl/room-depot.js), the garage under it included.
  function shedPlate(b, B, k) {
    const rise = B.lift.rise * k, o = L.world(0, 0, 0);
    for (const f of B.faces) {
      if (f.part !== 'plate') continue;
      const q = f.p.map((p) => L.world(p[0], p[1], p[2] + rise)), w = L.world(f.n[0], f.n[2], f.n[1]);
      const n = [w[0] - o[0], w[1] - o[1], w[2] - o[2]], col = lin(f.c);
      for (let j = 1; j + 1 < q.length; j++) for (const p of [q[0], q[j], q[j + 1]]) vtx(b, p, n, [0, 0], col, MAT.PLATE);
    }
  }

  /** Into the beasts batch: the stand, the vehicle where it is, its door, and the beacons while it moves. */
  function into(b, now = performance.now()) {
    const B = bayOf(L?.spec);
    // a shed's platform is always somewhere: flush with the floor with nothing on it, else where the lift has it
    if (L && B) shedPlate(b, B, V?.lift ? level(now) : 1);
    if (L) displays(b);
    if (!L || !V) return;
    const S = standOf(), from = fromOf(), kind = kindOf(), lf = V.lift;
    const [u, v] = spot();
    const m = lf && ready ? modelOf(lf.look || { cls: 'truck', variant: lf.variant, paint: lf.paint, grime: lf.grime }) : null;
    const k = level(now), go = moving(now);
    const s = m ? scaleOf(m) : 1;
    const lift = from === 'below';
    const y = lift ? -(B ? B.lift.rise : SHAFT) * (1 - k) : 0;
    // the stand's size: the vehicle's, plus an apron round it; the box (or a default) before the model's in
    const hl = m ? (m.f1 - m.f0) * s / 2 + APRON : (S ? S.len / 2 : 4.5), hw = m ? (m.g1 - m.g0) * s / 2 + APRON : (S ? S.wid / 2 : 1.9);
    const W = (a, c, h) => L.world(a, c, h);
    const up = [0, 1, 0], uv = [0, 0];
    const quad = (p, col, mat = MAT.PLATE, n = up) => { for (const i of [0, 1, 2, 0, 2, 3]) vtx(b, p[i], n, uv, col, mat); };
    const flat = (q, h, col, mat) => quad([W(q[0], q[2], h), W(q[1], q[2], h), W(q[1], q[3], h), W(q[0], q[3], h)], col, mat);
    const pad = S ? S.box : boxAt([u, v], hl, hw);
    // the edge round the stand, flush with the floor: hazard stripes, or a timber kerb round a slip of water
    const fr = 0.28, stripe = lin(S?.water ? '#6b5236' : '#d8a018'), dark = lin(S?.water ? '#4a3824' : '#1b1b1d');
    const edge = (a0, a1, c0, c1) => {
      const along = Math.abs(a1 - a0) > Math.abs(c1 - c0), n = Math.max(1, Math.round((along ? a1 - a0 : c1 - c0) / 0.5));
      for (let i = 0; i < n; i++) {
        const s0 = i / n, s1 = (i + 1) / n;
        const q = along ? [a0 + (a1 - a0) * s0, a0 + (a1 - a0) * s1, c0, c1] : [a0, a1, c0 + (c1 - c0) * s0, c0 + (c1 - c0) * s1];
        flat(q, S?.water ? 0.03 : 0.006, i % 2 ? dark : stripe, MAT.MATTE);
      }
    };
    const [p0, p1, q0, q1] = pad;
    // (a truck shed has its own, painted round its well)
    if (!B) { edge(p0 - fr, p1 + fr, q0 - fr, q0); edge(p0 - fr, p1 + fr, q1, q1 + fr); edge(p0 - fr, p0, q0, q1); edge(p1, p1 + fr, q0, q1); }
    if (S?.water) {
      // the slip: dark water a hand under the quay, with bands of lighter sheen. Still: the batch is only
      // built again while something moves, and a ripple isn't worth a rebuild a frame
      flat(pad, 0.004, lin('#0c2a2e'), MAT.GLOSS);
      // the bands run across the slip, as a wake's ripples do, whichever way it lies
      const longU = p1 - p0 > q1 - q0;
      for (let i = 0; i < 5; i++) {
        const f = 0.1 + i * 0.2, wb = 0.35;
        const q = longU ? [p0 + (p1 - p0) * f, p0 + (p1 - p0) * f + wb, q0 + 0.25, q1 - 0.25] : [p0 + 0.25, p1 - 0.25, q0 + (q1 - q0) * f, q0 + (q1 - q0) * f + wb];
        flat(q, 0.005, lin('#143a40'), MAT.GLOSS);
      }
    } else if (lift && !B) {
      // the hole, while there's one: the plate is somewhere under the floor (a shed's is its own: shedPlate)
      if (k < 0.999) flat(boxAt([u, v], hl, hw), 0.004, lin('#050505'), MAT.MATTE);
      // the plate itself, chequered steel, riding with the truck; under the floor it's hidden by the floor
      if (k > 0.02) flat(boxAt([u, v], hl, hw), Math.min(0.012, y + 0.012), lin('#5d6166'));
    }
    // the big door in the wall it comes through: a dark opening while it moves, a shut steel door otherwise
    // its size is the stand's, so it's the same door open or shut, whatever is behind it
    if (!lift) {
      const D = OUT[from] || OUT.back, across = S ? (D[0] ? S.box[3] - S.box[2] : S.box[1] - S.box[0]) : 6;
      drawDoor(b, from, Math.max(4, across * 0.9), Math.min((L.spec.h || 6) - 0.6, Math.max(3.2, across * 0.4)), go, S?.water);
    }
    const c = centreAt(k, m, s);
    if (m && lf) {
      const { F, R } = axes();
      const WF = sub(W(c[0] + F[0], c[1] + F[1], 0), W(c[0], c[1], 0)), WR = sub(W(c[0] + R[0], c[1] + R[1], 0), W(c[0], c[1], 0));
      // afloat she sits down to her waterline and rides the slip; a racer floats a hand off its dolly
      const sink = S?.water ? -(m.h1 - m.h0) * s * 0.28 : kind === 'podracer' ? 0.35 : 0;
      const O = W(c[0], c[1], y + 0.012 + sink);
      const place = (p) => { const f = (p[0] - m.c[0]) * s, g = (p[1] - m.c[1]) * s, h = (p[2] - m.h0) * s; return [O[0] + WF[0] * f + WR[0] * g, O[1] + h, O[2] + WF[2] * f + WR[2] * g]; };
      const C = place(m.c);
      for (const fc of m.faces) {
        const q = fc.p.map(place);
        if (q.length < 3) continue;
        const a = sub(q[1], q[0]), e = sub(q[2], q[0]);
        let n = [a[1] * e[2] - a[2] * e[1], a[2] * e[0] - a[0] * e[2], a[0] * e[1] - a[1] * e[0]];
        const nl = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / nl, n[1] / nl, n[2] / nl];
        const mid = q.reduce((acc, p) => [acc[0] + p[0] / q.length, acc[1] + p[1] / q.length, acc[2] + p[2] / q.length], [0, 0, 0]);
        if ((mid[0] - C[0]) * n[0] + (mid[1] - C[1]) * n[1] + (mid[2] - C[2]) * n[2] < 0) n = [-n[0], -n[1], -n[2]];
        const mat = fc.glass ? MAT.GLOSS : MAT.SATIN;
        for (let j = 1; j + 1 < q.length; j++) for (const p of [q[0], q[j], q[j + 1]]) vtx(b, p, n, uv, fc.col, mat);
      }
      // the tug under an aircraft's nose and the dolly under a racer, while they're being moved
      if (go && kind === 'aircraft') block(b, [c[0] + F[0] * (hl + 0.9), c[1] + F[1] * (hl + 0.9)], 1.1, 0.7, 1.0, lin('#e0b020'));
      if (kind === 'podracer') block(b, c, Math.max(0.8, hw - APRON - 0.4), Math.max(1, hl - APRON - 0.6), 0.22, lin('#3a3d42'));
    }
    // the beacons at the corners of the stand, going round while it moves
    if (go) {
      const on = Math.floor(now / 350) % 2;
      b.lights = (b.lights || []).concat([[p0 - fr, q0 - fr], [p1 + fr, q1 + fr], [p1 + fr, q0 - fr], [p0 - fr, q1 + fr]].filter((_, i) => i % 2 === on)
        .map(([a, e]) => ({ p: W(a, e, 0.6), c: [1.0, 0.62, 0.12], r: 6 })));
    }
    // you go round it once it's out, and round a lift's hole while it's open. An aircraft is solid at its
    // fuselage only, so you can walk under a wing; a boat is in the water, which is already solid
    const body = m && lf ? boxAt(c, hl - APRON * 0.7, kind === 'aircraft' ? Math.min(hw - APRON * 0.7, Math.max(1.2, (hw - APRON) * 0.3)) : hw - APRON * 0.7) : null;
    near = m && lf ? boxAt(c, hl - APRON, hw - APRON) : null;
    // (a shed's well is open round the truck all the way up, so the whole plate is walled off until it's flush)
    box = (lift && B ? (lf && k < 0.999 ? pad : k > 0.02 ? body : null)
      : lift ? (k > 0.02 ? body : k < 0.999 && lf ? boxAt([u, v], hl, hw) : null) : (k > 0.05 && !S?.water ? body : null));
    setSolid('body', box);
  }

  // A SHOWROOM'S DISPLAY CARS (`flags.room.display`, room-layout.js displaysOf): each a round plinth with a ring in
  // its maker's colour and the car stood on it. Which car is on which bay is client/shared/dealer-display.js, the
  // table the dealership's GLASS arm reads, so the street and the room show the same cars. They're scenery: nothing
  // here is for sale, and the counter says what is.
  function displays(b) {
    const list = L.spec?.display;
    if (!list?.length) return;
    const up = [0, 1, 0], uv = [0, 0], N = 20, steel = lin('#aeb6be'), top = lin('#e6e4de');
    for (const d of list) {
      const bay = dealerBay(d.bay), car = dealerCar(bay), [u, v] = d.at, r = d.r, ph = d.h;
      const ring = lin(hex(bay ? bay.line : [200, 210, 220]));
      const at = (a, rr, y) => L.world(u + Math.cos(a) * rr, v + Math.sin(a) * rr, y);
      for (let i = 0; i < N; i++) {
        const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2, am = (a0 + a1) / 2;
        // the plinth's top, the ring let into it, and its steel edge
        for (const p of [L.world(u, v, ph), at(a0, r * 0.84, ph), at(a1, r * 0.84, ph)]) vtx(b, p, up, uv, top, MAT.SATIN);
        for (const [ra, rb, col, mat] of [[0.84, 0.9, ring, MAT.GLOSS], [0.9, 1, steel, MAT.SATIN]]) {
          const q = [at(a0, r * ra, ph), at(a0, r * rb, ph), at(a1, r * rb, ph), at(a1, r * ra, ph)];
          for (const k of [0, 1, 2, 0, 2, 3]) vtx(b, q[k], up, uv, col, mat);
        }
        const o = L.world(0, 0, 0), w = L.world(Math.cos(am), Math.sin(am), 0), n = [w[0] - o[0], 0, w[2] - o[2]];
        const q = [at(a0, r, 0), at(a1, r, 0), at(a1, r, ph), at(a0, r, ph)];
        for (const k of [0, 1, 2, 0, 2, 3]) vtx(b, q[k], n, uv, steel, MAT.PLATE);
      }
      if (!ready) continue;
      const m = modelOf({ cls: car.cls, livery: car.livery });
      if (!m) continue;
      const s = (car.metres || 4.6) / Math.max(1e-6, m.f1 - m.f0), t = d.turn * Math.PI / 180;
      // the nose's way on the floor: 0 is toward the front wall (v = 0), turning clockwise seen from above
      const F = [Math.sin(t), -Math.cos(t)], Rr = [-F[1], F[0]];
      const WF = sub(L.world(u + F[0], v + F[1], 0), L.world(u, v, 0)), WR = sub(L.world(u + Rr[0], v + Rr[1], 0), L.world(u, v, 0));
      const O = L.world(u, v, ph + 0.005);
      const place = (p) => { const f = (p[0] - m.c[0]) * s, g = (p[1] - m.c[1]) * s, h = (p[2] - m.h0) * s; return [O[0] + WF[0] * f + WR[0] * g, O[1] + h, O[2] + WF[2] * f + WR[2] * g]; };
      const C = place(m.c);
      for (const fc of m.faces) {
        const q = fc.p.map(place);
        if (q.length < 3) continue;
        const a = sub(q[1], q[0]), e = sub(q[2], q[0]);
        let n = [a[1] * e[2] - a[2] * e[1], a[2] * e[0] - a[0] * e[2], a[0] * e[1] - a[1] * e[0]];
        const nl = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / nl, n[1] / nl, n[2] / nl];
        const mid = q.reduce((acc, p) => [acc[0] + p[0] / q.length, acc[1] + p[1] / q.length, acc[2] + p[2] / q.length], [0, 0, 0]);
        if ((mid[0] - C[0]) * n[0] + (mid[1] - C[1]) * n[1] + (mid[2] - C[2]) * n[2] < 0) n = [-n[0], -n[1], -n[2]];
        const mat = fc.glass ? MAT.GLOSS : MAT.SATIN;
        for (let j = 1; j + 1 < q.length; j++) for (const p of [q[0], q[j], q[j + 1]]) vtx(b, p, n, uv, fc.col, mat);
      }
    }
  }

  // a big door in a wall: `go` it's open, a dark mouth; shut, ribbed steel (or a water gate over a slip)
  function drawDoor(b, wall, wide, tall, go, water) {
    const [u, v] = spot(), hu = (L.spec.w || 16) / 2, d = L.spec.d || 20, h = Math.min(L.spec.h - 0.2, tall);
    // stood off the wall past its signs and paint, which sit a few centimetres proud
    const D = OUT[wall] || OUT.back, inset = 0.09;
    // its middle along the wall, under the stand
    const along = D[0] ? v : u, half = Math.min(wide / 2, (D[0] ? d : 2 * hu) / 2 - 0.2);
    const at = (a, y) => D[0] ? L.world(D[0] > 0 ? hu - inset : -hu + inset, a, y) : L.world(a, D[1] > 0 ? d - inset : inset, y);
    const n = sub(L.world(0, 0, 0), L.world(D[0], D[1], 0));
    const nl = Math.hypot(n[0], n[1], n[2]) || 1, N = [n[0] / nl, n[1] / nl, n[2] / nl];
    const y0 = water ? -0.02 : 0;
    const panelQ = (a0, a1, ya, yb, col, mat) => { for (const p of [[a0, ya], [a1, ya], [a1, yb], [a0, ya], [a1, yb], [a0, yb]]) vtx(b, at(along + p[0], p[1]), N, [0, 0], col, mat); };
    if (go) panelQ(-half, half, y0, h, lin('#060606'), MAT.MATTE);
    else {
      // a roller door: slats with a dark line between each, and the guide rails either side
      const n = Math.max(4, Math.round(h / 0.35));
      for (let i = 0; i < n; i++) panelQ(-half, half, y0 + h * i / n, y0 + h * (i + 1) / n - 0.025, lin(i % 2 ? '#7b8187' : '#868c92'), MAT.PLATE);
    }
    const rail = lin('#2a2c30');
    panelQ(-half - 0.18, -half, y0, h + 0.15, rail, MAT.SATIN);
    panelQ(half, half + 0.18, y0, h + 0.15, rail, MAT.SATIN);
    panelQ(-half - 0.18, half + 0.18, h, h + 0.3, rail, MAT.SATIN);
  }

  // a plain box on the floor: a tug, a dolly
  function block(b, c, hu, hv, ht, col) {
    const q = boxAt(c, hv, hu);
    const corners = [[q[0], q[2]], [q[1], q[2]], [q[1], q[3]], [q[0], q[3]]];
    const top = corners.map(([a, e]) => L.world(a, e, ht)), bot = corners.map(([a, e]) => L.world(a, e, 0.01));
    const put = (p, n) => { for (const i of [0, 1, 2, 0, 2, 3]) vtx(b, p[i], n, [0, 0], col, MAT.SATIN); };
    put(top, [0, 1, 0]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, e = sub(bot[j], bot[i]), n = [e[2], 0, -e[0]], nl = Math.hypot(n[0], n[2]) || 1;
      put([bot[i], bot[j], top[j], top[i]], [n[0] / nl, 0, n[2] / nl]);
    }
  }

  /** Each frame: the panel's word, and the key to climb in when you're beside your own vehicle on the floor. */
  function frame(now = performance.now()) {
    if (!V) return;
    paintPanel();
    const lf = V.lift, at = walker();
    const by = lf?.mine && lf.down == null && level(now) >= 1 && near && at
      && at[0] > near[0] - REACH && at[0] < near[1] + REACH && at[1] > near[2] - REACH && at[1] < near[3] + REACH;
    board.hidden = !by;
    const cmd = lf ? boardCmd(lf) : '';
    if (by && board.dataset.cmd !== cmd) {
      board.dataset.cmd = cmd;
      board.innerHTML = `${esc(wordsOf(kindOf()).board)} ${esc(lf.name)}`;
    }
  }

  return { load, into, frame, moving: (now) => moving(now ?? performance.now()), get active() { return !!V; }, get ver() { return ver; },
    dispose() { panel.remove(); board.remove(); setSolid('body', null); setSolid('water', null); } };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
