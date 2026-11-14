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

// Where a body stood under the head is, in the piece's frame (metres, x across and z out), or null: whoever's
// within reach of the water, you or anyone drawn (`bodies`, with `at` in the room's frame) on their feet.
function bodyUnder(L, p, h, k, bodies, you) {
  const [fu, fv] = facing(p.turn), su = -fv, sv = fu;
  let best = null, far = h.spread + 0.32;
  for (const bd of [...(you?.at ? [you] : []), ...(bodies || [])]) {
    if (!bd?.at || (bd.pose && bd.pose !== 'stand')) continue;
    const du = (bd.at[0] - p.u) / k, dv = (bd.at[1] - p.v) / k, x = du * su + dv * sv, z = du * fu + dv * fv;
    const d = Math.hypot(x - h.at[0], z - h.at[2]);
    if (d < far) { far = d; best = [x, z]; }
  }
  return best;
}
// How high the water meets somebody stood at `body`, at a point (x, z) of the spray: the crown over the middle,
// the shoulders round it, nothing past them.
const CROWN = 1.72, SHOULDER = 1.46;
function meetsAt(body, x, z) {
  if (!body) return null;
  const d = Math.hypot(x - body[0], z - body[1]);
  return d < 0.1 ? CROWN : d < 0.25 ? SHOULDER - (d - 0.1) * 0.6 : null;
}

// A running shower: streaks falling from the head, each one a short bright dash travelling down, and a
// splash ring where it lands. Somebody stood in it breaks the fall: it bursts off the crown and the shoulders and
// runs down them in sheets. A puddle spreads on the tray with rings going out across it, and steam climbs off
// the lot into `g`, the see-through layer (material 47 in gl/room.js), when there is one.
const STEAM = lin('#e4ebf0'), TAU = Math.PI * 2;
function showerWater(b, L, p, t, bodies, you, g) {
  const { P, k } = frameOf(L, p), h = headOf(p, L, k), fall = h.at[1] - h.floor, tub = h.spread < 0.05, N = tub ? 10 : 64;
  const body = tub ? null : bodyUnder(L, p, h, k, bodies, you);
  for (let i = 0; i < N; i++) {
    const a = hash(i, 1) * TAU, r0 = Math.sqrt(hash(i, 2)) * h.spread;
    // the jets fan out a little as they fall
    const speed = 3.2 + hash(i, 3) * 1.4, q = ((t * speed / fall) + hash(i, 4)) % 1;
    const y = h.at[1] - q * fall, r = r0 * (1 + q * 1.6);
    const x = h.at[0] + Math.sin(a) * r, z = h.at[2] + Math.cos(a) * r;
    const len = 0.09 + 0.08 * hash(i, 5);
    // broken on whoever's under it: the dash stops where it meets them
    const stop = Math.max(h.floor, meetsAt(body, x, z) ?? h.floor);
    if (y - len < stop) { if (y > stop) box(b, P(x, (y + stop) / 2, z), [0.0035 * k, ((y - stop) / 2) * k, 0.0035 * k], 0, SPRAY, MAT.GLOSS); continue; }
    box(b, P(x, y - len / 2, z), [0.0035 * k, (len / 2) * k, 0.0035 * k], 0, i % 3 ? WATER : SPRAY, MAT.GLOSS);
  }
  // beads hanging off the head before they go
  if (!tub) for (let i = 0; i < 8; i++) {
    const a = hash(i, 30) * TAU, r = h.spread * 0.8 * Math.sqrt(hash(i, 31)), q = ((t * 1.7) + hash(i, 32)) % 1;
    box(b, P(h.at[0] + Math.sin(a) * r, h.at[1] - 0.012 - q * 0.02, h.at[2] + Math.cos(a) * r), [0.004 * k, (0.004 + 0.004 * q) * k, 0.004 * k], 0, SPRAY, MAT.GLOSS);
  }
  if (body) {
    // thrown off the crown and the shoulders in short arcs
    for (let i = 0; i < 22; i++) {
      const q = ((t * 3.1) + hash(i, 33)) % 1, a = hash(i, 34) * TAU, top = i % 3 ? SHOULDER : CROWN, r0 = top === CROWN ? 0.05 : 0.17;
      const out = r0 + q * (0.1 + 0.12 * hash(i, 35)), y = top + 0.05 * Math.sin(q * Math.PI) - q * q * 0.35;
      box(b, P(body[0] + Math.sin(a) * out, y, body[1] + Math.cos(a) * out), [0.003 * k, 0.003 * k, 0.003 * k], 0, SPRAY, MAT.GLOSS);
    }
    // and running down them: slower, thinner streaks round the body from the shoulders to the tray
    for (let i = 0; i < 26; i++) {
      const a = hash(i, 36) * TAU, rr = 0.15 + 0.08 * hash(i, 37), q = ((t * (0.9 + 0.5 * hash(i, 38))) + hash(i, 39)) % 1;
      const y = SHOULDER - 0.05 - q * (SHOULDER - 0.05 - h.floor), len = 0.06 + 0.06 * hash(i, 40);
      box(b, P(body[0] + Math.sin(a) * rr * (1 - 0.35 * q * (1 - q)), Math.max(h.floor + len / 2, y), body[1] + Math.cos(a) * rr * 0.75), [0.0025 * k, (len / 2) * k, 0.0025 * k], 0, WATER, MAT.GLOSS);
    }
  }
  // where it lands: a puddle on the tray, rings going out across it, and flecks thrown up off it
  const land = body || [h.at[0], h.at[2]];
  if (!tub) {
    disc(b, P(land[0], h.floor + 0.003, land[1]), (h.spread * 1.8 + 0.1) * k, WATER, MAT.GLOSS, 20);
    for (let ring = 0; ring < 3; ring++) {
      const q = ((t * 0.9) + ring / 3) % 1, rr = (0.04 + q * (h.spread * 1.8 + 0.06));
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * TAU + ring;
        box(b, P(land[0] + Math.sin(a) * rr, h.floor + 0.005, land[1] + Math.cos(a) * rr), [0.012 * k * (1 - q * 0.5), 0.0012 * k, 0.003 * k], (a * 180) / Math.PI, SPRAY, MAT.GLOSS);
      }
    }
  }
  for (let i = 0; i < 18; i++) {
    const q = ((t * 2.4) + hash(i, 6)) % 1, a = hash(i, 7) * TAU, r = (body ? 0.22 : h.spread * 1.4) + q * 0.12;
    const y = h.floor + Math.sin(q * Math.PI) * 0.06;
    box(b, P(land[0] + Math.sin(a) * r, y, land[1] + Math.cos(a) * r), [0.004 * k, 0.004 * k, 0.004 * k], 0, SPRAY, MAT.GLOSS);
  }
  if (g) showerSteam(g, P, h, t, k, land);
}

// Steam off hot water: soft puffs climbing out of the spray, swelling and thinning as they go and drifting off,
// each three crossed fans so it reads as round from anywhere. How thick is vUv.x; the rim is vUv.y.
function puff(g, c, r, a) {
  for (const [A, B, N] of [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, 0, 1], [0, 1, 0], [1, 0, 0]], [[1, 0, 0], [0, 0, 1], [0, 1, 0]]]) {
    const e = (ang) => { const cs = Math.cos(ang) * r, sn = Math.sin(ang) * r; return [c[0] + A[0] * cs + B[0] * sn, c[1] + A[1] * cs + B[1] * sn, c[2] + A[2] * cs + B[2] * sn]; };
    for (let i = 0; i < 8; i++) {
      vtx(g, c, N, [a, 0], STEAM, 47); vtx(g, e(i / 8 * TAU), N, [a, 1], STEAM, 47); vtx(g, e((i + 1) / 8 * TAU), N, [a, 1], STEAM, 47);
    }
  }
}
// White steam on white tile barely shows, so it's thick in the middle of its life and there's a lot of it, with a
// slow haze gathering under the ceiling over the stall.
function showerSteam(g, P, h, t, k, land) {
  const top = Math.max(h.at[1] + 0.25, 2.2);
  for (let i = 0; i < 20; i++) {
    const life = 4 + hash(i, 41) * 3, q = ((t / life) + hash(i, 42)) % 1, a = hash(i, 43) * TAU + t * 0.15;
    const y0 = h.floor + 0.3 + hash(i, 44) * 1.2, y = y0 + q * (top - y0), drift = 0.08 + q * (0.25 + 0.2 * hash(i, 45));
    const c = P(land[0] + Math.sin(a) * drift, y, land[1] + Math.cos(a) * drift), r = (0.14 + 0.34 * q) * k;
    puff(g, c, r, 0.42 * Math.sin(Math.PI * q) * (0.6 + 0.4 * hash(i, 46)));
  }
  for (let i = 0; i < 5; i++) {
    const a = hash(i, 47) * TAU + t * 0.05, d = 0.2 + 0.3 * hash(i, 48), breathe = 0.85 + 0.15 * Math.sin(t * 0.4 + i);
    puff(g, P(land[0] + Math.sin(a) * d, top - 0.1 - 0.15 * hash(i, 49), land[1] + Math.cos(a) * d), (0.5 + 0.2 * hash(i, 50)) * k, 0.17 * breathe);
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
// spot ({ id, at: [u, v], yaw }) since you aren't one of the bodies. `glass`, when given, is a batch for the
// see-through layer (gl/room.js setPropsGlass): a running shower's steam goes there.
export function plumbingProps(b, L, plumb, bodies, you, t, now = Date.now(), glass = null) {
  if (!plumb || !L?.placed) return b;
  for (const p of L.placed) {
    const st = plumb[p.id];
    if (!st) continue;
    if (st.shower && p.arche === 'shower') showerWater(b, L, p, t, bodies, you, glass);
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
