// GLASS 2 · PLUMBING IN A ROOM. Water that moves: a shower that's running, the water in a toilet bowl and how
// much somebody has added to it, a stream going into it, and the swirl of a flush. Posed every frame into the
// room's props layer (gl/room.js setProps), like gl/room-meals.js.
//
// What it draws comes from plugins/bodily `room.plumbing`, keyed by furniture id (a piece's id is its furniture
// row's): { shower, level, tint, stream: { by, seated }, flushed }. Nothing here decides anything; the verbs do.

import { box, vtx, lin, MAT } from './ballpark-mesh.js';
import { facing } from '../../../../shared/room-layout.js';
import { FT_M } from '../../../../shared/world-scale.js';

const WATER = lin('#cfe4f2'), SPRAY = lin('#e8f2fa'), PEE = lin('#e8c84a'), CLEAR = lin('#9fb8c8'), MURK = lin('#b8a040'), DIRT = lin('#6a5230');
const UP = [0, 1, 0];
const M_PER_FT = FT_M;

const hash = (i, salt = 0) => { const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return s - Math.floor(s); };

// x across the piece, y up off the floor, z out of its front, all in metres, to the world
function frameOf(L, p) {
  const k = unitsPerM(L), [fu, fv] = facing(p.turn), su = -fv, sv = fu;
  const P = (x, y, z) => L.world(p.u + (su * x + fu * z) * k, p.v + (sv * x + fv * z) * k, (y + (p.y0 ? p.y0 / k : 0)) * k);
  return { P, k };
}
// units per metre in this layout: `L.ft` is a foot in its unit
function unitsPerM(L) { return (L.ft || M_PER_FT) / M_PER_FT; }

// a flat disc facing up
function disc(b, c, r, col, mat, segs = 18) {
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    vtx(b, c, UP, [0.5, 0.5], col, mat);
    vtx(b, [c[0] + Math.sin(a0) * r, c[1], c[2] + Math.cos(a0) * r], UP, [0, 0], col, mat);
    vtx(b, [c[0] + Math.sin(a1) * r, c[1], c[2] + Math.cos(a1) * r], UP, [1, 0], col, mat);
  }
}

// Where a shower's water comes from and how far it falls, in the piece's frame (metres): the forms in
// gl/room-fittings.js. A bath or a soak tub pours from its taps.
function headOf(p, L, k) {
  const hd = (p.d / k) / 2;
  switch (p.form) {
    case 'wetroom': return { at: [0, (L.h || 2.4 * k) / k - 0.02, 0], spread: 0.17, floor: 0.01 };
    case 'bath': case 'soak': return { at: [0, (p.h / k) + 0.2, -hd + 0.12], spread: 0.025, floor: (p.h / k) * 0.45 };
    default: return { at: [0, 2.02, -hd + 0.22], spread: 0.12, floor: 0.065 };
  }
}

// A running shower: streaks falling from the head, each one a short bright dash travelling down, and a
// splash ring where it lands.
function showerWater(b, L, p, t) {
  const { P, k } = frameOf(L, p), h = headOf(p, L, k), fall = h.at[1] - h.floor, N = h.spread < 0.05 ? 10 : 46;
  for (let i = 0; i < N; i++) {
    const a = hash(i, 1) * Math.PI * 2, r0 = Math.sqrt(hash(i, 2)) * h.spread;
    // the jets fan out a little as they fall
    const speed = 3.2 + hash(i, 3) * 1.4, q = ((t * speed / fall) + hash(i, 4)) % 1;
    const y = h.at[1] - q * fall, r = r0 * (1 + q * 1.6);
    const x = h.at[0] + Math.sin(a) * r, z = h.at[2] + Math.cos(a) * r;
    const len = 0.09 + 0.08 * hash(i, 5);
    box(b, P(x, Math.max(h.floor, y - len / 2), z), [0.0035 * k, (len / 2) * k, 0.0035 * k], 0, i % 3 ? WATER : SPRAY, MAT.GLOSS);
  }
  // where it lands: a few flecks thrown up off the tray
  for (let i = 0; i < 14; i++) {
    const q = ((t * 2.4) + hash(i, 6)) % 1, a = hash(i, 7) * Math.PI * 2, r = h.spread * 1.4 + q * 0.12;
    const y = h.floor + Math.sin(q * Math.PI) * 0.06;
    box(b, P(h.at[0] + Math.sin(a) * r, y, h.at[2] + Math.cos(a) * r), [0.004 * k, 0.004 * k, 0.004 * k], 0, SPRAY, MAT.GLOSS);
  }
}

// The bowl of a toilet in its own frame (gl/room-fittings.js pan and hung): where its water sits and how wide
function bowlOf(p, k) {
  const hd = (p.d / k) / 2;
  return p.form === 'hung' ? { c: [0, 0.32, -hd + 0.36], r: 0.11, rim: 0.4 } : { c: [0, 0.3, -hd + 0.42], r: 0.12, rim: 0.4 };
}

// The water in the bowl: higher and yellower the more's gone in unflushed, brown with anything solid, and while a
// flush runs, drawn down in a swirl and filling back clear.
function bowlWater(b, L, p, st, now) {
  const { P, k } = frameOf(L, p), bw = bowlOf(p, k);
  let level = Math.max(0, Math.min(1, st.level || 0)), tint = Math.max(0, Math.min(1, st.tint || 0)), solid = st.poop || 0;
  const since = st.flushed ? (now - st.flushed) / 1000 : 99;
  let swirl = 0;
  if (since < 3) {
    // a flush: the water drops in a turning funnel over the first second and a half, then refills clean
    swirl = since < 1.6 ? since / 1.6 : 0;
    level = since < 1.6 ? -0.5 * swirl : -0.5 + 0.5 * Math.min(1, (since - 1.6) / 1.4);
    tint = 0; solid = 0;
  }
  const y = bw.c[1] + 0.06 * level, r = bw.r * (1 + 0.35 * Math.max(0, level));
  const col = solid ? DIRT.map((v, i) => v * 0.6 + MURK[i] * 0.4) : CLEAR.map((v, i) => v + (PEE[i] - v) * tint * 0.8);
  disc(b, P(bw.c[0], y, bw.c[2]), Math.max(0.02, r) * k, col, MAT.GLOSS);
  if (swirl) {
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2 + since * 9, rr = r * (0.3 + 0.6 * hash(i, 8));
      box(b, P(bw.c[0] + Math.sin(a) * rr, y + 0.004, bw.c[2] + Math.cos(a) * rr), [0.012 * k, 0.002 * k, 0.003 * k], (a * 180) / Math.PI, SPRAY, MAT.GLOSS);
    }
  }
  for (let i = 0; i < Math.min(solid, 6); i++) {
    const a = hash(i, 9) * Math.PI * 2, rr = bw.r * 0.45 * hash(i, 10);
    box(b, P(bw.c[0] + Math.sin(a) * rr, y + 0.01, bw.c[2] + Math.cos(a) * rr), [0.03 * k, 0.012 * k, 0.014 * k], hash(i, 11) * 180, DIRT, MAT.SATIN);
  }
  return { P, k, bw, y };
}

// A stream from `from` (world) into the bowl: droplets along a falling arc, travelling, a ripple where it lands.
function stream(b, from, into, k, t, strength = 0.8) {
  const n = 26, dx = into[0] - from[0], dy = into[1] - from[1], dz = into[2] - from[2], lift = 0.12 * k * strength;
  for (let i = 0; i < n; i++) {
    const q = (i / n + t * 2.2) % 1, wob = (hash(i, 12) - 0.5) * 0.008 * k;
    // a parabola: out of the body, a little up, then down into the water
    const x = from[0] + dx * q + wob, z = from[2] + dz * q + wob, y = from[1] + dy * q + lift * 4 * q * (1 - q);
    box(b, [x, y, z], [0.005 * k, 0.005 * k, 0.005 * k], 0, PEE, MAT.GLOSS);
  }
  for (let i = 0; i < 6; i++) {
    const a = hash(i, 13) * Math.PI * 2 + t * 3, r = 0.02 * k * (1 + ((t * 3 + hash(i, 14)) % 1));
    box(b, [into[0] + Math.sin(a) * r, into[1] + 0.003 * k, into[2] + Math.cos(a) * r], [0.006 * k, 0.0015 * k, 0.006 * k], 0, PEE, MAT.GLOSS);
  }
}

// Whether there's anything to draw this frame: a running shower, a stream, a flush still settling, or a bowl that
// isn't clean (which stands still, but is drawn on the props layer all the same).
export function plumbingLive(plumb) {
  if (!plumb) return false;
  for (const k in plumb) { const s = plumb[k]; if (s && (s.shower || s.stream || s.level || s.poop || s.flushed)) return true; }
  return false;
}

// Into batch `b`. `plumb` is { [pieceId]: state }; `bodies` the people as drawn (at, yaw); `you` is your own
// spot ({ id, at: [u, v], yaw }) since you aren't one of the bodies.
export function plumbingProps(b, L, plumb, bodies, you, t, now = Date.now()) {
  if (!plumb || !L?.placed) return b;
  for (const p of L.placed) {
    const st = plumb[p.id];
    if (!st) continue;
    if (st.shower && p.arche === 'shower') showerWater(b, L, p, t);
    if (p.arche !== 'toilet') continue;
    const w = bowlWater(b, L, p, st, now);
    if (!st.stream) continue;
    const into = w.P(w.bw.c[0], w.y, w.bw.c[2]);
    const k = w.k;
    let from = null;
    if (st.stream.seated) from = w.P(0, w.bw.rim + 0.02, w.bw.c[2] + 0.06);
    else {
      // standing: from the hips of whoever it is, a hand's width in front of them
      const who = you && st.stream.by === you.id ? you : bodies?.find((bd) => bd.id === st.stream.by);
      if (who?.at) {
        const base = L.world(who.at[0], who.at[1], 0.9 * k);
        // out of the front of them, which is toward the bowl they're aiming at
        const ahead = 0.18 * k, toward = [into[0] - base[0], into[2] - base[2]], d = Math.hypot(toward[0], toward[1]) || 1;
        from = [base[0] + (toward[0] / d) * ahead, base[1], base[2] + (toward[1] / d) * ahead];
      }
      // nobody to aim it from (they're out of sight): from in front of the bowl at hip height
      if (!from) from = w.P(0, 0.9, (p.d / k) / 2 + 0.25);
    }
    stream(b, from, into, k, t, st.stream.strength ?? 0.8);
  }
  return b;
}
