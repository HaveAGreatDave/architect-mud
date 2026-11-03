// GLASS 2 · A FLAT. The Room Stage's standalone room (docs/proposals/room-stage.md): the shell of a
// room round a roomLayout (client/shared/room-layout.js) and every piece in it drawn as its
// archetype's form, built from the same kit as the Platinum Box (room-kit.js). Pure: batches, no GL.
//
// The frame is the layout's, in metres: u across (right as you face the window), v back from the
// window wall, y up. The window is in the front wall, the door in the back wall.
//
// ⚠ THE LOOK COMES FROM DATA, NEVER FROM A NAME (home-stage.md rule 3). A piece arrives as
// { arche, form, dims, wear, seed }; its colours come from the seed and its wear from what it cost,
// so a second game on THOMAS draws its own catalogue with no edit here.
//
// ⚠ THE LIGHT IS SPLIT. Unlike the suite, whose light is all baked, a flat's vertex colour is the
// surface's colour times its baked ambient occlusion only; the lamp and the window light it in the
// shader (gl/room.js), so switching the lamp or the hour turning moves the light without a rebuild.
// A colour of 1.25 or over is a light itself (a bulb, a heater's element) and is drawn raw.

import { roomKit } from './room-kit.js';
import { createBatch, MAT } from './ballpark-mesh.js';
import { facing } from '../../../../shared/room-layout.js';

// How many metres one repeat of each painted material covers (paintRoomTexture). A rug is mapped
// once across itself, so it has no repeat.
export const ROOM_TEXTURES = Object.freeze({ roomBoards: 1.8, roomPlaster: 2.4, roomCeiling: 2.4, roomWeave: 0.45, roomSteel: 0.9,
  roomWood: 1.1, roomConcrete: 1.6, roomTile: 0.9, roomCanvas: 0.8, roomTicking: 0.6 });
export const ROOM_RUG = 'roomRug';

const { GLOSS, METAL, LEATHER, SATIN, CLOTH, MATTE, EMISSIVE } = MAT;
// A face that is a light (a bulb, a heater's element, a lamp on a panel): the kit's `glow` code, which
// gl/room.js draws unlit. No MAT code is 40.
export const GLOW = 40;

// The palettes a piece's seed picks from. Muted and secondhand, as a flat in Coldwater is furnished.
const FABRIC = ['#7a3b2e', '#3f5a4a', '#a8823a', '#3b4a6b', '#6a6a66', '#5a3f5e', '#86603e', '#2f4f5a', '#8a4a3a', '#55603a'];
const ENAMEL = ['#e6e2d6', '#d6cfbc', '#c4d4cb', '#2a2c30', '#b9bdc1', '#d9c6a2'];
const WOOD = ['#8a6038', '#5b3a22', '#a8805a', '#3e2a1c', '#7a6a52'];
const PLASTIC = ['#2b2d31', '#3a3c40', '#5a5d62', '#1c1d20'];
const WALLS = ['#d8d2c2', '#c9cfc6', '#d6c6b0', '#bfc6cc', '#d4c9b8', '#c2b8a4'];

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ── the occlusion ───────────────────────────────────────────────────────────────────────────────
// Dark where a wall meets the floor or the ceiling, in the corners, on the floor round and under
// every piece, and low down on a piece where it stands on the floor. Times the surface's colour.
function bakeAO(L) {
  const hu = L.w / 2, D = L.d, H = L.h;
  const boxes = [...L.solid, ...L.climb.map((c) => c.slice(0, 4)), ...L.placed.filter((p) => !(p.arche === 'screen' && p.form !== 'crt')).map((p) => {
    const q = Math.round(((p.turn % 360) + 360) % 360 / 90) % 2, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2;
    return [p.u - hw, p.u + hw, p.v - hd, p.v + hd];
  })];
  return ([u, v, y], [nu, ny, nv], col) => {
    let ao = 1;
    const dw = Math.min(u + hu, hu - u, v, D - v);
    if (ny > 0.9 && y < 0.03) {
      ao *= 0.66 + 0.34 * sstep(0, 0.55, dw);
      for (const [a, b, c, e] of boxes) {
        const ou = Math.max(a - u, 0, u - b), ov = Math.max(c - v, 0, v - e);
        ao *= 0.42 + 0.58 * sstep(0, 0.4, Math.hypot(ou, ov));
      }
    } else if (ny < -0.9 && y > H - 0.05) ao *= 0.72 + 0.28 * sstep(0, 0.7, dw);
    else if (Math.abs(ny) < 0.5) {
      // a wall low down and high up, and a vertical face near the floor
      ao *= (0.62 + 0.38 * sstep(0, 0.45, y)) * (0.86 + 0.14 * sstep(0, 0.35, H - y));
      const corner = Math.min(Math.min(u + hu, hu - u), Math.min(v, D - v) + 9 * Math.abs(nv)) ;
      if (Math.abs(nu) > 0.5 || Math.abs(nv) > 0.5) ao *= 0.8 + 0.2 * sstep(0, 0.5, corner);
    } else if (ny > 0.9) ao *= 0.92 + 0.08 * sstep(0, 0.5, y);
    return col.map((c) => Math.min(0.98, c * ao));
  };
}

// ── the room ────────────────────────────────────────────────────────────────────────────────────
// opts: { seed (the room's), lampOn }. Returns the kit's batches plus `view` (the street through the
// window, drawn raw with the view's own texture) and `lamps`: [{ at: host point, kind }] for the
// renderer's lights.
export function buildRoom(L, { seed = 1, lampOn = true } = {}) {
  const K = roomKit(L, bakeAO(L), { textures: ROOM_TEXTURES, cell: 0.4, glow: GLOW });
  const { solid, quad, box, lathe, ball, rounded, onU, onV, C, nrmOf, TB, E } = K;
  const view = createBatch(64);
  const hu = L.w / 2, D = L.d, H = L.h, T = 0.14, spec = L.spec;
  const R = rng(seed), wallC = pick(R, WALLS), trim = pick(R, ['#ece8de', '#e2dccd', '#d2cab8']);
  const win = spec.window || [-0.8, 0.8, 0.9, 2.2], door = spec.door || [hu - 1.3, hu - 0.4], DH = 2.05;
  const plaster = { t: 'roomPlaster', c: wallC };

  // the floor: boards, run from the window to the door
  {
    const ps = [[-hu, 0, 0], [hu, 0, 0], [hu, D, 0], [-hu, D, 0]], t = ROOM_TEXTURES.roomBoards;
    quad(TB('roomBoards'), ps, [0, 1, 0], C('#ffffff', 0.95), E, ps.map((q) => [q[1] / t, q[0] / t]));
    // the slab under the boards stops short of them, or the two fight over the same pixels
    box(-hu - T, hu + T, -T, D + T, -0.2, -0.01, '#2a2622');
  }
  // the ceiling, and a slab over it
  {
    const ps = [[-hu, D, H], [hu, D, H], [hu, 0, H], [-hu, 0, H]], t = ROOM_TEXTURES.roomCeiling;
    quad(TB('roomCeiling'), ps, [0, -1, 0], C('#f2efe8', 1), E, ps.map((q) => [q[0] / t, q[1] / t]));
    box(-hu - T, hu + T, -T, D + T, H + 0.01, H + 0.2, '#8a8680');
  }
  // the side walls whole; the front wall round the window, the back wall round the door
  box(-hu - T, -hu, -T, D + T, 0, H, wallC, 1, plaster);
  box(hu, hu + T, -T, D + T, 0, H, wallC, 1, plaster);
  box(-hu, win[0], -T, 0, 0, H, wallC, 1, plaster);
  box(win[1], hu, -T, 0, 0, H, wallC, 1, plaster);
  box(win[0], win[1], -T, 0, 0, win[2], wallC, 1, plaster);
  box(win[0], win[1], -T, 0, win[3], H, wallC, 1, plaster);
  box(-hu, door[0], D, D + T, 0, H, wallC, 1, plaster);
  box(door[1], hu, D, D + T, 0, H, wallC, 1, plaster);
  box(door[0], door[1], D, D + T, DH, H, wallC, 1, plaster);

  // the skirting and the coving round the walls, broken for the door
  for (const [u0, u1, v0, v1] of [[-hu, -hu + 0.016, 0, D], [hu - 0.016, hu, 0, D], [-hu, hu, 0, 0.016], [-hu, door[0] - 0.08, D - 0.016, D], [door[1] + 0.08, hu, D - 0.016, D]]) {
    box(u0, u1, v0, v1, 0, 0.11, trim, 0.95, null, SATIN);
    box(u0, u1, v0, v1, 0.11, 0.125, trim, 0.9, null, SATIN);
  }
  for (const [u0, u1, v0, v1] of [[-hu, -hu + 0.05, 0, D], [hu - 0.05, hu, 0, D], [-hu, hu, 0, 0.05], [-hu, hu, D - 0.05, D]]) box(u0, u1, v0, v1, H - 0.07, H, trim, 1);

  // THE WINDOW: a painted timber frame in the opening, a sill board, a cross of glazing bars, the
  // glass, a roller blind a quarter down, and the street behind it on its own far plane
  {
    const [w0, w1, y0, y1] = win, fw = 0.05, fv = [-0.09, -0.03];
    for (const [a, b, c, e] of [[w0, w0 + fw, y0, y1], [w1 - fw, w1, y0, y1], [w0, w1, y0, y0 + fw], [w0, w1, y1 - fw, y1]]) box(a, b, fv[0], fv[1], c, e, trim, 0.95, null, SATIN);
    const mu = (w0 + w1) / 2, my = y0 + (y1 - y0) * 0.62;
    box(mu - 0.02, mu + 0.02, fv[0] + 0.01, fv[1] - 0.005, y0, y1, trim, 0.95, null, SATIN);
    box(w0, w1, fv[0] + 0.01, fv[1] - 0.005, my - 0.02, my + 0.02, trim, 0.95, null, SATIN);
    box(w0 - 0.05, w1 + 0.05, -0.04, 0.14, y0 - 0.035, y0, trim, 1, null, SATIN);
    box(w0 - 0.07, w1 + 0.07, -0.005, 0.02, y0 - 0.12, y0 - 0.035, trim, 0.9);
    // the architrave round the opening on the room side
    for (const [a, b, c, e] of [[w0 - 0.07, w0, y0 - 0.035, y1 + 0.07], [w1, w1 + 0.07, y0 - 0.035, y1 + 0.07], [w0 - 0.07, w1 + 0.07, y1, y1 + 0.07]]) box(a, b, 0, 0.018, c, e, trim, 0.97, null, SATIN);
    quad(K.glass, [[w0, -0.06, y0], [w1, -0.06, y0], [w1, -0.06, y1], [w0, -0.06, y1]], nrmOf(0, 0, 1), [0.8, 0.86, 0.9], GLOSS, null, true);
    // the blind: a cassette at the head, the cloth down a quarter of the glass, a bar and a pull
    const bl = y1 - (y1 - y0) * 0.24;
    box(w0 - 0.02, w1 + 0.02, -0.01, 0.07, y1 + 0.07, y1 + 0.15, trim, 0.95, null, SATIN);
    box(w0 + 0.01, w1 - 0.01, 0.03, 0.036, bl, y1 + 0.07, '#e9e1cf', 0.95, { t: 'roomCanvas', c: '#efe6d2' }, CLOTH);
    box(w0, w1, 0.025, 0.045, bl - 0.03, bl, trim, 0.9, null, SATIN);
    lathe(mu, 0.04, [[0, bl - 0.25], [0.012, bl - 0.25], [0.012, bl - 0.21], [0.003, bl - 0.2], [0.003, bl - 0.03], [0, bl - 0.03]], trim, 0.9, 8);
    // the street, a few metres out, wider and taller than the opening so it holds as you move; it
    // reaches further down than up, so standing at the glass you see sky over the tower tops
    const out = -3.2, sw = (w1 - w0) / 2 + 2.6, mu0 = mu;
    quad(view, [[mu0 + sw, out, y0 - 3.0], [mu0 - sw, out, y0 - 3.0], [mu0 - sw, out, y1 + 1.2], [mu0 + sw, out, y1 + 1.2]], nrmOf(0, 0, 1), [1, 1, 1], EMISSIVE, [[1, 1], [0, 1], [0, 0], [1, 0]], true);
    // the radiator under the window: a row of columns on two pipes, gloss white
    const rr = [Math.max(-hu + 0.2, w0 + 0.05), Math.min(hu - 0.2, w1 - 0.05)], cols = Math.round((rr[1] - rr[0]) / 0.065);
    for (let i = 0; i < cols; i++) {
      const u = rr[0] + (i + 0.5) * (rr[1] - rr[0]) / cols;
      K.rounded(...onV, 0.05, 0.14, u - 0.024, u + 0.024, 0.16, 0.74, 0.02, '#e4e0d6', 0.95, GLOSS);
    }
    for (const y of [0.18, 0.72]) K.rounded(...onU, rr[0] - 0.04, rr[1] + 0.04, 0.08, 0.11, y - 0.015, y + 0.015, 0.012, '#d8d4ca', 0.95, GLOSS);
    lathe(rr[0] - 0.06, 0.09, [[0.012, 0], [0.012, 0.18]], '#c9c4b8', 0.9, 8, METAL);
    lathe(rr[1] + 0.06, 0.09, [[0.012, 0], [0.012, 0.18]], '#c9c4b8', 0.9, 8, METAL);
  }

  // THE DOOR in the back wall: a four-panel door shut in its frame, an architrave, a brass knob and a
  // finger plate; a light switch and a socket by it
  {
    const [d0, d1] = door, dv = D - 0.04;
    box(d0, d1, dv, D, 0, DH - 0.01, '#6a4a30', 0.92, { t: 'roomWood', c: '#9a7a5a' }, SATIN);
    for (const [a, b] of [[d0 + 0.09, (d0 + d1) / 2 - 0.04], [(d0 + d1) / 2 + 0.04, d1 - 0.09]]) for (const [c, e] of [[0.18, 0.92], [1.08, 1.9]]) {
      box(a, b, dv - 0.012, dv, c, e, '#6a4a30', 0.85, { t: 'roomWood', c: '#9a7a5a' }, SATIN);
      box(a + 0.04, b - 0.04, dv - 0.02, dv - 0.012, c + 0.04, e - 0.04, '#6a4a30', 0.97, { t: 'roomWood', c: '#9a7a5a' }, SATIN);
    }
    for (const [a, b, c, e] of [[d0 - 0.07, d0, 0, DH + 0.07], [d1, d1 + 0.07, 0, DH + 0.07], [d0 - 0.07, d1 + 0.07, DH, DH + 0.07]]) box(a, b, D - 0.02, D, c, e, trim, 0.97, null, SATIN);
    const ku = d0 + 0.07;
    K.rounded(...onU, ku - 0.02, ku + 0.02, dv - 0.06, dv, 0.98, 1.0, 0.008, '#b8923e', 1.05, METAL);
    ball(ku, dv - 0.065, 0.99, 0.028, '#c9a24a', 1.05, 12, METAL);
    box(ku - 0.03, ku + 0.03, dv - 0.004, dv, 1.06, 1.3, '#c9a24a', 1, null, METAL);
    const su = d0 - 0.22;
    box(su - 0.042, su + 0.042, D - 0.012, D, 1.16, 1.244, '#efece4', 1, null, SATIN);
    box(su - 0.012, su + 0.012, D - 0.022, D - 0.012, 1.19, 1.214, '#d8d4ca', 1, null, SATIN);
    box(su - 0.042, su + 0.042, D - 0.012, D, 0.28, 0.364, '#efece4', 1, null, SATIN);
  }

  // THE LAMP: a flex from a ceiling rose to a pleated paper shade over a bulb in the middle of the
  // room; the bulb is a light when the lamp is on
  const lamp = { u: 0, v: D * 0.5, y: H - 0.62 };
  {
    lathe(lamp.u, lamp.v, [[0, H - 0.03], [0.05, H - 0.03], [0.055, H - 0.01], [0.05, H]], '#efece4', 1, 16);
    lathe(lamp.u, lamp.v, [[0.004, lamp.y + 0.2], [0.004, H - 0.03]], '#202020', 0.9, 6);
    lathe(lamp.u, lamp.v, [[0.018, lamp.y + 0.12], [0.022, lamp.y + 0.2], [0, lamp.y + 0.2]], '#2a2a2a', 0.9, 10);
    // the shade, pleated: sixteen facets alternately a little in and out
    const shade = [], n = 32;
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, r0 = i % 2 ? 0.2 : 0.21, r1 = i % 2 ? 0.21 : 0.2;
      const P = (a, r, y) => [lamp.u + Math.cos(a) * r, lamp.v + Math.sin(a) * r, y];
      shade.push([P(a0, r0 * 0.6, lamp.y + 0.16), P(a1, r1 * 0.6, lamp.y + 0.16), P(a1, r1, lamp.y - 0.06), P(a0, r0, lamp.y - 0.06)]);
    }
    for (const q of shade) quad(solid, q, nrmOf(0, -1, 0), C('#f1dcb4', lampOn ? 1.3 : 0.85), E, null, lampOn);
    ball(lamp.u, lamp.v, lamp.y + 0.03, 0.045, lampOn ? '#fff4d8' : '#d8d4c8', lampOn ? 2.4 : 0.9, 12);
  }

  // A RUG on the boards, in front of the sofa if there is one, else in the middle
  {
    const sofa = L.placed.find((p) => p.arche === 'sofa' || p.arche === 'bench'), scr = L.placed.find((p) => p.arche === 'screen');
    let cu = 0, cv = D * 0.5;
    if (sofa && scr) { cu = (sofa.u + scr.u) / 2; cv = (sofa.v + scr.v) / 2; } else if (sofa) { const [fu, fv] = facing(sofa.turn); cu = sofa.u + fu * 0.9; cv = sofa.v + fv * 0.9; }
    const rw = Math.min(1.6, L.w - 1.0) / 2, rd = Math.min(1.1, D * 0.3) / 2;
    cu = Math.max(-hu + rw + 0.2, Math.min(hu - rw - 0.2, cu)); cv = Math.max(rd + 0.3, Math.min(D - rd - 0.3, cv));
    const y = 0.008, ps = [[cu - rw, cv - rd, y], [cu + rw, cv - rd, y], [cu + rw, cv + rd, y], [cu - rw, cv + rd, y]];
    quad(TB(ROOM_RUG), ps, [0, 1, 0], C('#ffffff', 0.95), CLOTH, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const side = (a, b, n) => quad(solid, [[a[0], a[1], 0.001], [b[0], b[1], 0.001], [b[0], b[1], y], [a[0], a[1], y]], n, C('#3a2a22', 0.8), CLOTH);
    side([cu - rw, cv - rd], [cu + rw, cv - rd], nrmOf(0, 0, -1)); side([cu + rw, cv + rd], [cu - rw, cv + rd], nrmOf(0, 0, 1));
    side([cu + rw, cv - rd], [cu + rw, cv + rd], nrmOf(1, 0, 0)); side([cu - rw, cv + rd], [cu - rw, cv - rd], nrmOf(-1, 0, 0));
  }

  for (const p of L.placed) drawPiece(K, p);
  return { ...K, view, lamp: L.world(lamp.u, lamp.v, lamp.y), window: { u: win, y: [win[2], win[3]] } };
}

// ── the pieces ──────────────────────────────────────────────────────────────────────────────────
// A thin bar between two room points, six-sided, for legs, rails, pipes and aerials.
function rodOf(K) {
  return (a, b, r, hex, k = 1, surf = METAL, n = 6) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d) || 1, t = d.map((x) => x / l);
    const up = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const cx = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    let s = cx(t, up); const sl = Math.hypot(...s); s = s.map((x) => x / sl);
    const w = cx(t, s), col = K.C(hex, k);
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
      const o = (ang) => s.map((x, j) => (x * Math.cos(ang) + w[j] * Math.sin(ang)) * r);
      const o0 = o(a0), o1 = o(a1), nm = s.map((x, j) => x * Math.cos(am) + w[j] * Math.sin(am));
      K.quad(K.solid, [[a[0] + o0[0], a[1] + o0[1], a[2] + o0[2]], [a[0] + o1[0], a[1] + o1[1], a[2] + o1[2]], [b[0] + o1[0], b[1] + o1[1], b[2] + o1[2]], [b[0] + o0[0], b[1] + o0[1], b[2] + o0[2]]],
        K.nrmOf(nm[0], nm[2], nm[1]), col, surf, null, k >= 1.25);
    }
  };
}

function drawPiece(K, p) {
  const [fu, fv] = facing(p.turn), F = K.frame(p.u, p.v, fu, fv), { P, pbox, alongX, alongY, alongZ } = F;
  const r = rng(p.seed || 7), wear = Math.max(0, Math.min(1, p.wear || 0));
  const w = p.w, d = p.d, h = p.h, hw = w / 2, hd = d / 2, rod = rodOf(K);
  // worn things are darker and duller; a colour picked off the seed, tired by the wear
  const tired = (k) => k * (1 - wear * 0.22);
  const fab = { t: 'roomWeave', c: pick(r, FABRIC) }, wood = { t: 'roomWood', c: pick(r, WOOD) }, enamel = pick(r, ENAMEL), plastic = pick(r, PLASTIC);
  const steel = { t: 'roomSteel', c: '#c8ccd0' };
  const lat = (x, z, prof, mat, k = 1, n = 14, surf = E()) => { const [u, v] = P(x, 0, z); K.lathe(u, v, prof, mat, k, n, surf); };
  const R = (...a) => K.rounded(...a);
  // a stain or a patch on a worn piece: a darker square on a face, a little proud of it
  const stain = (x, y, z, s) => { if (wear > 0.45 && r() < wear) pbox(x - s, x + s, y - s * 0.7, y + s * 0.7, z, z + 0.003, '#2a2018', 0.55 + r() * 0.2, null, MATTE); };
  switch (p.form) {
    case 'stool': {
      lat(0, 0, [[0, 0], [0.19, 0], [0.19, 0.012], [0.14, 0.03], [0.03, 0.05], [0.022, 0.1], [0.022, 0.64], [0.05, 0.67], [0.05, 0.69], [0, 0.69]], '#9aa0a8', 1, 18, METAL);
      lat(0, 0, [[0.14, 0.27], [0.15, 0.275], [0.15, 0.29], [0.14, 0.295], [0.13, 0.29], [0.13, 0.275], [0.14, 0.27]], '#9aa0a8', 1, 18, METAL);
      lat(0, 0, [[0, 0.69], [0.19, 0.69], [0.215, 0.705], [0.225, 0.73], [0.21, 0.75], [0.17, 0.762], [0, 0.765]], pick(r, ['#7a2a24', '#2a2a2e', '#5a3a2a']), tired(0.95), 22, LEATHER);
      if (wear > 0.4) lat(0.06, 0.03, [[0, 0.763], [0.05, 0.763], [0, 0.767]], '#d8c8a8', 0.9, 8, CLOTH);
      break;
    }
    case 'chair': {
      // four tapered legs, a padded seat, a back that leans a little; steel or wood off the seed
      const metal = r() < 0.5, frame = metal ? '#8a9098' : null, legM = metal ? frame : wood, sy = 0.44, sd = hd - 0.03;
      for (const [x, z] of [[-hw + 0.05, -hd + 0.05], [hw - 0.05, -hd + 0.05], [-hw + 0.05, hd - 0.05], [hw - 0.05, hd - 0.05]]) lat(x, z, [[0.014, 0], [0.02, sy - 0.03]], legM, 0.9, 8, metal ? METAL : SATIN);
      pbox(-hw + 0.02, hw - 0.02, sy - 0.05, sy - 0.02, -sd, sd, frame || '#5a3a22', 0.85, metal ? null : wood, metal ? METAL : SATIN);
      R(...alongX(), -hw + 0.03, hw - 0.03, -sd, sd, sy - 0.02, sy + 0.06, 0.03, fab, tired(1), CLOTH);
      for (const x of [-hw + 0.05, hw - 0.05]) rod(P(x, sy - 0.02, -hd + 0.04), P(x, h - 0.02, -hd + 0.01 - 0.04 * 1), 0.016, metal ? frame : pick(r, WOOD), 0.9, metal ? METAL : SATIN);
      R(...alongX(0.12, sy + 0.12), -hw + 0.04, hw - 0.04, -hd + 0.02, -hd + 0.07, sy + 0.14, h, 0.03, fab, tired(0.97), CLOTH);
      stain(0, sy + 0.08, sd - 0.1, 0.05);
      break;
    }
    case 'bench': {
      // a slatted seat on two steel ends
      for (const x of [-hw + 0.08, hw - 0.08]) { pbox(x - 0.025, x + 0.025, 0, 0.42, -hd + 0.05, hd - 0.05, '#4a4e54', 0.9, null, METAL); pbox(x - 0.025, x + 0.025, 0.02, 0.06, -hd + 0.02, hd - 0.02, '#4a4e54', 0.9, null, METAL); }
      for (let i = 0; i < 5; i++) { const z = -hd + 0.06 + i * (d - 0.12) / 4.6; pbox(-hw, hw, 0.42, 0.455, z, z + (d - 0.12) / 5.4, '#7a6a52', 0.95, wood, SATIN); }
      if (h > 0.6) for (let i = 0; i < 2; i++) pbox(-hw, hw, 0.62 + i * 0.13, 0.72 + i * 0.13, -hd + 0.01, -hd + 0.04, '#7a6a52', 0.95, wood, SATIN);
      for (const x of [-hw + 0.08, hw - 0.08]) if (h > 0.6) rod(P(x, 0.42, -hd + 0.05), P(x, h - 0.05, -hd + 0.02), 0.02, '#4a4e54', 0.9);
      break;
    }
    case 'booth': {
      // a diner booth: a wooden plinth, a vinyl seat and a tall back in rolled channels
      const vinyl = pick(r, ['#8a2a2a', '#2a4a5a', '#6a2a3a', '#3a3a3a', '#a8742a']);
      pbox(-hw, hw, 0, 0.36, -hd + 0.02, hd - 0.05, '#5a3a22', 0.85, wood, SATIN);
      R(...alongX(), -hw + 0.02, hw - 0.02, -hd + 0.2, hd - 0.02, 0.36, 0.47, 0.05, vinyl, tired(1), LEATHER);
      pbox(-hw, hw, 0, h, -hd, -hd + 0.06, '#5a3a22', 0.85, wood, SATIN);
      const n = Math.max(4, Math.round(w / 0.16));
      for (let i = 0; i < n; i++) { const x0 = -hw + 0.03 + i * (w - 0.06) / n, x1 = x0 + (w - 0.06) / n; R(...alongY(), 0.47, h - 0.04, x0 + 0.003, x1 - 0.003, -hd + 0.06, -hd + 0.17, 0.035, vinyl, tired(0.97), LEATHER); }
      R(...alongX(), -hw, hw, -hd, -hd + 0.18, h - 0.06, h, 0.03, '#5a3a22', 0.9, SATIN);
      if (wear > 0.3) pbox(-0.08, 0.1, 0.47, 0.475, 0.0, 0.08, '#c8b890', 0.9, null, CLOTH);
      break;
    }
    case 'sofa': {
      // a deep base on turned feet, cushions in front of cushions, rolled arms; worn ones sag
      const n = Math.max(2, Math.min(3, Math.round(w / 0.62))), arm = 0.2, sy = 0.42 - wear * 0.04;
      for (const [x, z] of [[-hw + 0.08, -hd + 0.08], [hw - 0.08, -hd + 0.08], [-hw + 0.08, hd - 0.1], [hw - 0.08, hd - 0.1]]) lat(x, z, [[0, 0], [0.025, 0], [0.03, 0.02], [0.026, 0.09], [0.035, 0.11], [0, 0.11]], '#3a2818', 0.9, 10, SATIN);
      R(...alongX(), -hw + 0.02, hw - 0.02, -hd + 0.04, hd - 0.02, 0.11, 0.32, 0.05, fab, tired(0.85), CLOTH);
      R(...alongX(0.14, 0.32), -hw + 0.04, hw - 0.04, -hd + 0.01, -hd + 0.2, 0.3, h, 0.08, fab, tired(0.9), CLOTH);
      const inner = [-hw + arm, hw - arm], third = (inner[1] - inner[0]) / n;
      for (let i = 0; i < n; i++) {
        const a0 = inner[0] + i * third + 0.008, a1 = a0 + third - 0.016, sag = wear * (i === Math.floor(n / 2) ? 0.03 : 0.012);
        R(...alongX(0.14, 0.32), a0, a1, -hd + 0.18, -hd + 0.33, sy + 0.06, h - 0.06 - sag, 0.06, fab, tired(0.97), CLOTH);
        R(...alongX(), a0, a1, -hd + 0.26, hd + 0.01, 0.3, sy + 0.08 - sag, 0.06, fab, tired(1), CLOTH);
        stain(a0 + third / 2, sy + 0.08 - sag + 0.002, 0, 0.06);
      }
      for (const s of [-1, 1]) {
        const x0 = s < 0 ? -hw : hw - arm, x1 = s < 0 ? -hw + arm : hw;
        R(...alongZ(), -hd + 0.03, hd - 0.01, x0 + 0.01, x1 - 0.01, 0.11, 0.56, 0.05, fab, tired(0.9), CLOTH);
        R(...alongZ(), -hd + 0.02, hd + 0.02, s < 0 ? -hw - 0.02 : hw - arm + 0.02, s < 0 ? -hw + arm - 0.02 : hw + 0.02, 0.5, 0.64, 0.07, fab, tired(0.95), CLOTH);
      }
      // a blanket thrown over one arm on a lived-in sofa
      if (wear > 0.25 || r() < 0.4) {
        const s = r() < 0.5 ? -1 : 1, x0 = s < 0 ? -hw - 0.025 : hw - arm - 0.01, x1 = s < 0 ? -hw + arm + 0.01 : hw + 0.025, bc = pick(r, ['#c8b48a', '#7a8a6a', '#a85a4a', '#5a6a8a']);
        R(...alongZ(), -hd + 0.15, hd - 0.15, x0, x1, 0.6, 0.67, 0.03, { t: 'roomWeave', c: bc }, 0.95, CLOTH);
        pbox(s < 0 ? -hw - 0.035 : hw + 0.005, s < 0 ? -hw - 0.005 : hw + 0.035, 0.28, 0.66, -hd + 0.2, hd - 0.2, bc, 0.9, { t: 'roomWeave', c: bc }, CLOTH);
      }
      break;
    }
    case 'cot': {
      // a folding camp cot: a tube frame on crossed legs, an olive canvas sling, a folded blanket
      for (const z of [-hd + 0.04, hd - 0.04]) rod(P(-hw, 0.4, z), P(hw, 0.4, z), 0.014, '#5a5e4a', 0.9);
      for (const x of [-hw + 0.1, hw - 0.1]) { rod(P(x, 0.0, -hd + 0.04), P(x, 0.4, hd - 0.04), 0.012, '#5a5e4a', 0.9); rod(P(x, 0.0, hd - 0.04), P(x, 0.4, -hd + 0.04), 0.012, '#5a5e4a', 0.9); }
      R(...alongX(), -hw + 0.02, hw - 0.02, -hd + 0.04, hd - 0.04, 0.37, 0.41, 0.015, { t: 'roomCanvas', c: '#6a6e4a' }, tired(1), CLOTH);
      R(...alongX(), hw - 0.5, hw - 0.12, -hd + 0.1, hd - 0.1, 0.41, 0.48, 0.02, { t: 'roomWeave', c: '#7a6a5a' }, 0.95, CLOTH);
      break;
    }
    case 'bed': case 'pod': {
      // a frame, a mattress, a sheet, a duvet turned down, a pillow at the wall; a pod has a shell
      // hooped over it with a strip of light along the inside
      const top = p.form === 'pod' ? 0.42 : 0.38;
      pbox(-hw, hw, 0.05, 0.22, -hd, hd, '#5a3a22', 0.85, p.form === 'pod' ? null : wood, SATIN);
      for (const [x, z] of [[-hw + 0.05, -hd + 0.05], [hw - 0.05, -hd + 0.05], [-hw + 0.05, hd - 0.05], [hw - 0.05, hd - 0.05]]) pbox(x - 0.03, x + 0.03, 0, 0.05, z - 0.03, z + 0.03, '#2a2622', 0.9);
      R(...alongZ(), -hd + 0.02, hd - 0.02, -hw + 0.03, hw - 0.03, 0.22, top - 0.02, 0.06, { t: 'roomTicking', c: '#e8e4da' }, tired(1), CLOTH);
      const duv = { t: 'roomWeave', c: pick(r, FABRIC) };
      R(...alongZ(), -hd + 0.55, hd + 0.03, -hw + 0.01, hw - 0.01, top - 0.06, top + 0.05, 0.05, duv, tired(1), CLOTH);
      R(...alongZ(), -hd + 0.5, -hd + 0.62, -hw + 0.015, hw - 0.015, top - 0.04, top + 0.06, 0.04, { t: 'roomWeave', c: '#ece6da' }, 1, CLOTH);
      R(...alongX(), -hw + 0.12, hw - 0.12, -hd + 0.06, -hd + 0.4, top - 0.02, top + 0.1, 0.05, { t: 'roomTicking', c: '#f2efe8' }, 1, CLOTH);
      if (p.form === 'pod') {
        const shell = enamel, Rr = hw + 0.03, z0 = -hd - 0.01, z1 = hd - 0.5, cy = top - 0.02, n = 14;
        for (let i = 0; i < n; i++) {
          const a0 = i / n * Math.PI, a1 = (i + 1) / n * Math.PI;
          const at = (a, z, rr) => P(Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8, z);
          const nm = (a) => F.N(Math.cos(a), Math.sin(a), 0);
          K.quad(K.solid, [at(a0, z0, Rr), at(a1, z0, Rr), at(a1, z1, Rr), at(a0, z1, Rr)], nm((a0 + a1) / 2), K.C(shell, 0.95), GLOSS);
          K.quad(K.solid, [at(a0, z1, Rr), at(a1, z1, Rr), at(a1, z1, Rr - 0.05), at(a0, z1, Rr - 0.05)], F.N(0, 0, 1), K.C(shell, 0.85), GLOSS);
        }
        // the light strip along the inside of the hood, at its crown
        const sy = cy + (Rr - 0.04) * 0.8;
        K.quad(K.solid, [P(-0.03, sy, z0 + 0.05), P(0.03, sy, z0 + 0.05), P(0.03, sy, z1 - 0.05), P(-0.03, sy, z1 - 0.05)], F.N(0, -1, 0), K.C('#9fe8ff', 1.6), E(), null, true);
      }
      break;
    }
    case 'flat': case 'slab': {
      // a panel on a bracket, its picture on the screen batch; a slab is thinner, with a lit edge
      const cy = 1.25, ph = h, thick = p.form === 'slab' ? 0.018 : 0.045, z0 = -hd + 0.03;
      pbox(-0.12, 0.12, cy - 0.1, cy + 0.1, -hd, z0, '#1a1b1e', 0.9, null, METAL);
      pbox(-hw, hw, cy - ph / 2, cy + ph / 2, z0, z0 + thick, plastic, 0.9, null, SATIN);
      pbox(-hw + 0.012, hw - 0.012, cy - ph / 2 + 0.012, cy + ph / 2 - 0.012, z0 + thick, z0 + thick + 0.002, '#0a0b0d', 0.9, null, GLOSS);
      F.front(K.screen, -hw + 0.016, hw - 0.016, cy - ph / 2 + 0.016, cy + ph / 2 - 0.016, z0 + thick + 0.003, [1, 1, 1], E(), [[0, 1], [1, 1], [1, 0], [0, 0]]);
      if (p.form === 'slab') pbox(-hw, hw, cy - ph / 2 - 0.006, cy - ph / 2, z0, z0 + thick, '#ff4fb0', 1.7);
      else pbox(hw - 0.06, hw - 0.04, cy - ph / 2 + 0.004, cy - ph / 2 + 0.008, z0 + thick, z0 + thick + 0.002, '#ff3020', 1.5);
      // the cable down the wall to the socket
      rod(P(hw * 0.3, cy - ph / 2, -hd + 0.01), P(hw * 0.3, 0.3, -hd + 0.01), 0.005, '#1a1a1a', 0.9, SATIN, 4);
      break;
    }
    case 'crt': {
      // a cathode set on a low cabinet: a deep tapered body, a bezel, a bulging face, two knobs and
      // a pair of rabbit ears
      const ch = 0.5, bw = Math.min(w, 0.62), bh = Math.min(h, 0.5), bd = Math.max(0.42, Math.min(0.5, bw * 0.75));
      pbox(-hw, hw, 0, ch, -hd, hd, '#3a2a1e', 0.85, wood, SATIN);
      pbox(-hw + 0.02, hw - 0.02, 0.06, ch - 0.06, hd, hd + 0.004, '#2a1e16', 0.9, wood, SATIN);
      const zf = hd - 0.02, zb = zf - bd;
      pbox(-bw / 2, bw / 2, ch, ch + bh, zf - 0.22, zf, '#5a4a38', 0.95, wood, SATIN);
      pbox(-bw / 2 + 0.07, bw / 2 - 0.07, ch + 0.05, ch + bh - 0.06, zb, zf - 0.22, '#2a2622', 0.9, null, SATIN);
      pbox(-bw / 2 + 0.02, bw / 2 - 0.16, ch + 0.03, ch + bh - 0.03, zf, zf + 0.01, '#141414', 0.9, null, SATIN);
      // the face: a grid bulging out at its middle, on the screen batch
      const gx = 6, gy = 5, sx0 = -bw / 2 + 0.05, sx1 = bw / 2 - 0.19, sy0 = ch + 0.06, sy1 = ch + bh - 0.06;
      for (let i = 0; i < gx; i++) for (let j = 0; j < gy; j++) {
        const xa = sx0 + (sx1 - sx0) * i / gx, xb = sx0 + (sx1 - sx0) * (i + 1) / gx, ya = sy0 + (sy1 - sy0) * j / gy, yb = sy0 + (sy1 - sy0) * (j + 1) / gy;
        const bz = (x, y) => zf + 0.012 + 0.02 * (1 - ((x - (sx0 + sx1) / 2) / ((sx1 - sx0) / 2)) ** 2) * (1 - ((y - (sy0 + sy1) / 2) / ((sy1 - sy0) / 2)) ** 2);
        const uv = (x, y) => [(x - sx0) / (sx1 - sx0), 1 - (y - sy0) / (sy1 - sy0)];
        K.quad(K.screen, [P(xa, ya, bz(xa, ya)), P(xb, ya, bz(xb, ya)), P(xb, yb, bz(xb, yb)), P(xa, yb, bz(xa, yb))], F.N(0, 0, 1), [1, 1, 1], E(), [uv(xa, ya), uv(xb, ya), uv(xb, yb), uv(xa, yb)], true);
      }
      for (const y of [ch + bh * 0.7, ch + bh * 0.4]) { pbox(bw / 2 - 0.11, bw / 2 - 0.05, y - 0.03, y + 0.03, zf, zf + 0.03, '#c8c0a8', 0.95, null, SATIN); }
      pbox(bw / 2 - 0.12, bw / 2 - 0.04, ch + 0.06, ch + 0.16, zf, zf + 0.012, '#8a8070', 0.9, null, METAL);
      for (const s of [-1, 1]) rod(P(0, ch + bh, zb + 0.12), P(s * 0.28, ch + bh + 0.42, zb + 0.06), 0.004, '#c8ccd0', 1.05);
      lat(0, zb + 0.12, [[0, ch + bh], [0.04, ch + bh], [0.035, ch + bh + 0.03], [0, ch + bh + 0.035]], '#2a2a2a', 0.9, 10);
      break;
    }
    case 'fridge': case 'double': {
      // a tall cabinet with rounded corners, a freezer door over the fridge door (or two doors side by
      // side), steel handles, a black kick plate, and things stuck to the door
      const metal = p.form === 'double', body = metal ? '#c8ccd0' : enamel, tex = metal ? steel : null, surf = metal ? METAL : GLOSS;
      R(...alongY(), 0.06, h, -hw + 0.01, hw - 0.01, -hd, hd - 0.035, 0.05, tex || body, metal ? 1 : 0.96, surf);
      pbox(-hw + 0.03, hw - 0.03, 0, 0.06, -hd + 0.04, hd - 0.08, '#141414', 0.9);
      const zf = hd - 0.035;
      if (metal) {
        R(...alongY(), 0.07, h - 0.02, -hw + 0.01, -0.006, zf, zf + 0.035, 0.012, steel, 1.02, METAL);
        R(...alongY(), 0.07, h - 0.02, 0.006, hw - 0.01, zf, zf + 0.035, 0.012, steel, 1.02, METAL);
        for (const x of [-0.04, 0.04]) { rod(P(x, h * 0.35, zf + 0.06), P(x, h * 0.8, zf + 0.06), 0.012, '#e0e4e8', 1.1); for (const y of [h * 0.35, h * 0.8]) rod(P(x, y, zf + 0.035), P(x, y, zf + 0.06), 0.008, '#e0e4e8', 1.1); }
      } else {
        const split = h * 0.7;
        R(...alongY(), 0.07, split - 0.008, -hw + 0.01, hw - 0.01, zf, zf + 0.035, 0.014, body, 0.98, GLOSS);
        R(...alongY(), split + 0.008, h - 0.015, -hw + 0.01, hw - 0.01, zf, zf + 0.035, 0.014, body, 0.98, GLOSS);
        const hx = -hw + 0.07;
        for (const [y0, y1] of [[split - 0.42, split - 0.1], [split + 0.06, split + 0.24]]) { rod(P(hx, y0, zf + 0.06), P(hx, y1, zf + 0.06), 0.011, '#d8dce0', 1.1); for (const y of [y0, y1]) rod(P(hx, y, zf + 0.035), P(hx, y, zf + 0.06), 0.008, '#d8dce0', 1.1); }
        // a takeaway menu, a photo, a shopping list, each held by a magnet
        const notes = [['#f2ead2', 0.14, 0.2], ['#d8c8a0', 0.1, 0.14], ['#f4f2ec', 0.09, 0.16], ['#c86a4a', 0.07, 0.07]];
        for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
          const [c, nw, nh] = notes[i % notes.length], x = -hw * 0.2 + r() * hw * 0.8, y = split * (0.45 + r() * 0.4);
          pbox(x - nw / 2, x + nw / 2, y - nh / 2, y + nh / 2, zf + 0.035, zf + 0.037, c, 0.95, null, MATTE);
          pbox(x - 0.012, x + 0.012, y + nh / 2 - 0.03, y + nh / 2 - 0.006, zf + 0.037, zf + 0.047, pick(r, ['#d83a2a', '#2a6ad8', '#e8c02a', '#3aa84a']), 1, null, GLOSS);
        }
      }
      // whatever's kept on top
      if (r() < 0.7) pbox(-hw * 0.6, -hw * 0.6 + 0.2, h, h + 0.28, -hd * 0.4, -hd * 0.4 + 0.07, pick(r, ['#d8a83a', '#c83a2a', '#3a7ad8']), 0.95, null, SATIN);
      break;
    }
    case 'chest': {
      // a chest freezer: a white box with a rounded lid, a handle, a dial and a green lamp
      R(...alongX(), -hw, hw, -hd, hd, 0.06, h - 0.07, 0.04, enamel, 0.96, GLOSS);
      R(...alongX(), -hw - 0.01, hw + 0.01, -hd - 0.01, hd + 0.01, h - 0.07, h, 0.03, enamel, 0.99, GLOSS);
      pbox(-hw + 0.04, hw - 0.04, 0, 0.06, -hd + 0.04, hd - 0.04, '#141414', 0.9);
      R(...alongX(), -0.2, 0.2, hd + 0.01, hd + 0.04, h - 0.1, h - 0.07, 0.01, '#9aa0a8', 1, METAL);
      pbox(hw - 0.16, hw - 0.1, h - 0.2, h - 0.14, hd, hd + 0.015, '#d8d4c8', 1, null, SATIN);
      pbox(hw - 0.07, hw - 0.05, h - 0.18, h - 0.16, hd, hd + 0.012, '#5aff7a', 1.6);
      break;
    }
    case 'range': case 'cooktop': {
      // a range: an oven with a window in its door, four rings on top, knobs on a back panel, and a
      // run of tiles on the wall behind. A cooktop is two rings on a small cabinet
      const range = p.form === 'range', body = range ? enamel : '#ffffff', top = h;
      if (range) {
        R(...alongY(), 0.08, top - 0.03, -hw, hw, -hd, hd - 0.03, 0.02, body, 0.97, GLOSS);
        pbox(-hw + 0.02, hw - 0.02, 0, 0.08, -hd + 0.04, hd - 0.08, '#141414', 0.9);
        const zf = hd - 0.03;
        pbox(-hw + 0.04, hw - 0.04, 0.14, top - 0.2, zf, zf + 0.02, body, 0.94, null, GLOSS);
        pbox(-hw + 0.12, hw - 0.12, 0.3, top - 0.32, zf + 0.02, zf + 0.022, '#141618', 0.9, null, GLOSS);
        rod(P(-hw + 0.1, top - 0.24, zf + 0.06), P(hw - 0.1, top - 0.24, zf + 0.06), 0.012, '#c8ccd0', 1.1);
        for (const x of [-hw + 0.1, hw - 0.1]) rod(P(x, top - 0.24, zf + 0.02), P(x, top - 0.24, zf + 0.06), 0.008, '#c8ccd0', 1.1);
        pbox(-hw, hw, top, top + 0.16, -hd, -hd + 0.06, body, 0.92, null, GLOSS);
        for (let i = 0; i < 4; i++) { const x = -hw + 0.1 + i * (w - 0.2) / 3; const [u, v] = P(x, 0, -hd + 0.065); K.lathe(u, v, [[0, top + 0.06], [0.022, top + 0.06], [0.022, top + 0.09], [0, top + 0.095]], '#2a2a2a', 0.9, 10, SATIN); }
        // tiles up the wall behind it
        pbox(-hw - 0.15, hw + 0.15, top, top + 0.6, -hd - 0.004, -hd + 0.002, '#ffffff', 0.95, { t: 'roomTile', c: pick(r, ['#e8e4d8', '#c8d8d0', '#d8c8a8']) }, GLOSS);
      } else {
        pbox(-hw, hw, 0, top - 0.05, -hd, hd, '#6a5a48', 0.9, wood, SATIN);
        pbox(-hw + 0.02, hw - 0.02, 0.08, top - 0.12, hd, hd + 0.01, '#6a5a48', 0.95, wood, SATIN);
        rod(P(-0.08, top - 0.18, hd + 0.03), P(0.08, top - 0.18, hd + 0.03), 0.008, '#c8ccd0', 1.05);
      }
      // the hob plate and its rings
      pbox(-hw + 0.01, hw - 0.01, top - 0.05, top, -hd + 0.02, hd - 0.02, '#16171a', 0.9, null, GLOSS);
      const rings = range ? [[-0.15, -0.12, 0.09], [0.15, -0.12, 0.075], [-0.15, 0.14, 0.075], [0.15, 0.14, 0.09]] : [[-0.13, 0, 0.08], [0.13, 0, 0.07]];
      for (const [x, z, rr] of rings) {
        const [u, v] = P(x * w / 0.76, 0, z * d / 0.66);
        K.lathe(u, v, [[rr * 0.3, top + 0.003], [rr, top + 0.003], [rr, top + 0.012], [rr * 0.3, top + 0.012]], '#3a3a3e', 0.95, 20, METAL);
        K.lathe(u, v, [[0, top + 0.006], [rr * 0.32, top + 0.006]], '#2a2a2e', 0.9, 16, METAL);
      }
      break;
    }
    case 'microwave': {
      // a microwave on a little steel trolley: a box, a dark window in its door, a keypad, a handle
      const ty = 0.55;
      for (const [x, z] of [[-hw + 0.03, -hd + 0.03], [hw - 0.03, -hd + 0.03], [-hw + 0.03, hd - 0.03], [hw - 0.03, hd - 0.03]]) rod(P(x, 0.02, z), P(x, ty, z), 0.012, '#9aa0a8', 1);
      pbox(-hw, hw, ty - 0.02, ty, -hd, hd, '#b8bcc0', 1, steel, METAL);
      pbox(-hw, hw, 0.12, 0.14, -hd, hd, '#b8bcc0', 1, steel, METAL);
      R(...alongX(), -hw + 0.01, hw - 0.01, -hd + 0.02, hd - 0.02, ty, ty + 0.3, 0.02, enamel, 0.96, GLOSS);
      pbox(-hw + 0.04, hw * 0.35, ty + 0.04, ty + 0.26, hd - 0.02, hd - 0.012, '#121416', 0.9, null, GLOSS);
      pbox(hw * 0.45, hw - 0.04, ty + 0.16, ty + 0.25, hd - 0.02, hd - 0.014, '#0a1a10', 1, null, GLOSS);
      pbox(hw * 0.5, hw - 0.08, ty + 0.2, ty + 0.235, hd - 0.014, hd - 0.012, '#48ff8a', 1.5);
      for (let i = 0; i < 9; i++) pbox(hw * 0.5 + (i % 3) * 0.035, hw * 0.5 + (i % 3) * 0.035 + 0.025, ty + 0.05 + Math.floor(i / 3) * 0.03, ty + 0.07 + Math.floor(i / 3) * 0.03, hd - 0.02, hd - 0.012, '#d8d4c8', 1, null, SATIN);
      break;
    }
    case 'counter': case 'desk': {
      if (p.form === 'counter') {
        // base cupboards with doors and handles under a concrete slab with a little overhang; a kettle
        // and a couple of mugs on top
        const n = Math.max(1, Math.round(w / 0.6)), lam = pick(r, ['#d8d0c0', '#4a5a5a', '#8a6a4a', '#e8e4dc']);
        pbox(-hw, hw, 0, 0.1, -hd, hd - 0.06, '#1a1a1a', 0.9);
        pbox(-hw, hw, 0.1, h - 0.04, -hd, hd - 0.02, lam, 0.92, null, SATIN);
        for (let i = 0; i < n; i++) {
          const x0 = -hw + 0.004 + i * w / n, x1 = x0 + w / n - 0.008;
          pbox(x0, x1, 0.11, h - 0.06, hd - 0.02, hd, lam, 0.97, null, SATIN);
          rod(P(i % 2 ? x0 + 0.05 : x1 - 0.05, h - 0.22, hd + 0.02), P(i % 2 ? x0 + 0.05 : x1 - 0.05, h - 0.12, hd + 0.02), 0.007, '#c8ccd0', 1.05);
        }
        pbox(-hw - 0.01, hw + 0.01, h - 0.04, h, -hd, hd + 0.03, '#a8a49c', 1, { t: 'roomConcrete', c: '#b8b4ac' }, MATTE);
        lat(-hw * 0.5, 0, [[0, h], [0.08, h], [0.085, h + 0.02], [0.08, h + 0.16], [0.06, h + 0.2], [0, h + 0.21]], pick(r, ['#d8d4c8', '#2a2a2a', '#c83a2a']), 0.95, 16, GLOSS);
        for (const x of [hw * 0.25, hw * 0.45]) lat(x, -0.05 + r() * 0.1, [[0, h], [0.04, h], [0.042, h + 0.1], [0.038, h + 0.1], [0.036, h + 0.006], [0, h + 0.006]], pick(r, ['#f2efe8', '#3a6a8a', '#d8a83a']), 1, 14, GLOSS);
      } else {
        // a desk: a top on four legs with a drawer, a lamp, papers
        const top = { t: 'roomWood', c: pick(r, WOOD) };
        pbox(-hw, hw, h - 0.03, h, -hd, hd, '#7a5a3a', 1, top, SATIN);
        for (const [x, z] of [[-hw + 0.04, -hd + 0.04], [hw - 0.04, -hd + 0.04], [-hw + 0.04, hd - 0.04], [hw - 0.04, hd - 0.04]]) pbox(x - 0.022, x + 0.022, 0, h - 0.03, z - 0.022, z + 0.022, '#7a5a3a', 0.9, top, SATIN);
        pbox(-hw + 0.06, hw * 0.1, h - 0.14, h - 0.03, -hd + 0.06, hd - 0.02, '#7a5a3a', 0.95, top, SATIN);
        rod(P(-hw * 0.4 - 0.04, h - 0.085, hd + 0.005), P(-hw * 0.4 + 0.04, h - 0.085, hd + 0.005), 0.006, '#c8ccd0', 1.05);
        for (let i = 0; i < 3; i++) { const x = hw * 0.2 + r() * 0.1, z = -0.05 + r() * 0.1; pbox(x - 0.105, x + 0.105, h + i * 0.002, h + 0.002 + i * 0.002, z - 0.148, z + 0.148, '#f2efe6', 1, null, MATTE); }
        // the lamp: a weighted base, a jointed arm, a cone
        const [bu, bv] = P(hw - 0.15, 0, -hd + 0.12);
        K.lathe(bu, bv, [[0, h], [0.07, h], [0.07, h + 0.02], [0.02, h + 0.03], [0, h + 0.03]], '#2a2a2e', 0.9, 14, METAL);
        const j1 = P(hw - 0.15, h + 0.32, -hd + 0.18), j2 = P(hw - 0.3, h + 0.42, -hd + 0.3);
        rod(P(hw - 0.15, h + 0.03, -hd + 0.12), j1, 0.008, '#2a2a2e', 0.9); rod(j1, j2, 0.008, '#2a2a2e', 0.9);
        K.lathe(j2[0], j2[1], [[0.07, j2[2] - 0.12], [0.03, j2[2] - 0.02], [0, j2[2]]], '#2a5a4a', 0.95, 14, GLOSS);
        K.lathe(j2[0], j2[1], [[0, j2[2] - 0.08], [0.022, j2[2] - 0.08], [0, j2[2] - 0.05]], '#fff4d8', 1.8, 10);
      }
      break;
    }
    case 'rail': {
      for (const x of [-hw + 0.03, 0, hw - 0.03]) rod(P(x, 0, 0), P(x, h, 0), 0.022, '#7a7e84', 0.95);
      for (const y of [h, h * 0.5]) rod(P(-hw, y, 0), P(hw, y, 0), 0.022, '#7a7e84', 0.95);
      for (const x of [-hw + 0.03, hw - 0.03]) lat(x, 0, [[0, 0], [0.05, 0], [0.05, 0.01], [0, 0.012]], '#5a5e64', 0.9, 10, METAL);
      break;
    }
    case 'heater': case 'box': {
      // a heater: a box on feet, a grille across its front, the element glowing behind it, a handle
      // on top and a battery lamp
      const heater = p.form === 'heater', body = heater ? pick(r, ['#d8d4c8', '#3a3c40', '#c8a050']) : '#8a7a5a';
      R(...alongY(), 0.03, h, -hw, hw, -hd, hd, 0.03, body, 0.95, heater ? GLOSS : SATIN);
      for (const x of [-hw + 0.04, hw - 0.04]) pbox(x - 0.03, x + 0.03, 0, 0.03, -hd - 0.02, hd + 0.02, '#1a1a1a', 0.9);
      if (heater) {
        pbox(-hw + 0.04, hw - 0.04, 0.08, h - 0.12, hd - 0.006, hd + 0.001, '#ff7a2a', 1.7);
        for (let i = 0; i < 7; i++) { const y = 0.08 + (i + 0.5) * (h - 0.2) / 7; pbox(-hw + 0.035, hw - 0.035, y - 0.006, y + 0.006, hd, hd + 0.012, '#2a2a2a', 0.9, null, METAL); }
        R(...alongX(), -0.07, 0.07, -0.02, 0.02, h, h + 0.04, 0.012, '#2a2a2a', 0.9, SATIN);
        pbox(hw - 0.05, hw - 0.03, h - 0.08, h - 0.06, hd, hd + 0.006, '#5aff7a', 1.6);
      }
      break;
    }
    default: {
      // a cabinet: a tall steel box with a recessed face, a slot, a keypad and a handset hung off it
      pbox(-hw, hw, 0, h, -hd, hd, '#5a6068', 0.95, steel, METAL);
      pbox(-hw + 0.05, hw - 0.05, h * 0.3, h - 0.08, hd, hd + 0.006, '#3a3e44', 0.9, null, METAL);
      pbox(-0.06, 0.06, h - 0.25, h - 0.15, hd + 0.006, hd + 0.012, '#9ab0a0', 0.6, null, GLOSS);
      for (let i = 0; i < 12; i++) pbox(-0.05 + (i % 3) * 0.035, -0.025 + (i % 3) * 0.035, h * 0.45 + Math.floor(i / 3) * 0.04, h * 0.45 + 0.025 + Math.floor(i / 3) * 0.04, hd + 0.006, hd + 0.014, '#c8c4b8', 0.95, null, SATIN);
      rod(P(hw - 0.08, h * 0.75, hd + 0.03), P(hw - 0.06, h * 0.45, hd + 0.05), 0.02, '#1a1a1a', 0.9, SATIN);
      rod(P(hw - 0.06, h * 0.45, hd + 0.05), P(-0.02, h * 0.25, hd + 0.03), 0.004, '#1a1a1a', 0.9, SATIN, 4);
      if (wear > 0.3) stain(0, h * 0.6, hd + 0.013, 0.08);
    }
  }
}
// the emissive code, as a call so a case can't shadow it
function E() { return EMISSIVE; }

// ── the materials ───────────────────────────────────────────────────────────────────────────────
// Each a tile that repeats, painted once per room renderer, seeded so it's the same flat every time.
export function paintRoomTexture(doc, key, seed = 1) {
  const N = key === ROOM_RUG ? 1024 : 512, c = doc.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), r = rng([...key].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261 ^ seed));
  const specks = (n, size, cols, a) => {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = a * (0.4 + r() * 0.6); g.fillStyle = cols[(r() * cols.length) | 0];
      const x = r() * N, y = r() * N, w = size * (0.5 + r()), h = size * (0.5 + r());
      for (const [ox, oy] of [[0, 0], [-N, 0], [0, -N], [-N, -N]]) g.fillRect(x + ox, y + oy, w, h);
    }
    g.globalAlpha = 1;
  };
  const blot = (cx, cy, rad, col) => {
    for (const [ox, oy] of [[0, 0], [-N, 0], [0, -N], [-N, -N], [N, 0], [0, N], [N, N], [N, -N], [-N, N]]) {
      const grd = g.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad);
      grd.addColorStop(0, col); grd.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
      g.fillStyle = grd; g.fillRect(cx + ox - rad, cy + oy - rad, rad * 2, rad * 2);
    }
  };
  if (key === 'roomBoards') {
    // oak boards, four across the tile, each its own shade, with grain, knots, the joints between
    // them and the polish worn off down the middle of the room
    const n = 4, bw = N / n;
    for (let i = 0; i < n; i++) {
      const base = 0.85 + r() * 0.3, x0 = i * bw;
      g.fillStyle = `rgb(${Math.round(150 * base)},${Math.round(108 * base)},${Math.round(70 * base)})`; g.fillRect(x0, 0, bw, N);
      for (let k = 0; k < 40; k++) {
        const x = x0 + r() * bw, amp = 1 + r() * 4, ph = r() * 6.28;
        g.strokeStyle = r() < 0.6 ? `rgba(70,42,20,${0.15 + r() * 0.25})` : `rgba(200,160,110,${0.1 + r() * 0.2})`;
        g.lineWidth = 0.5 + r() * 1.8; g.beginPath();
        for (let y = 0; y <= N; y += 8) { const xx = x + Math.sin(y / N * Math.PI * 2 * (1 + (k % 3)) + ph) * amp; if (y) g.lineTo(xx, y); else g.moveTo(xx, y); }
        g.stroke();
      }
      if (r() < 0.6) { const kx = x0 + bw * (0.2 + r() * 0.6), ky = r() * N; g.fillStyle = 'rgba(60,34,16,0.6)'; g.beginPath(); g.ellipse(kx, ky, 5 + r() * 4, 9 + r() * 6, 0, 0, Math.PI * 2); g.fill(); }
      // the board's end joint somewhere along it
      const jy = r() * N; g.fillStyle = 'rgba(40,24,12,0.7)'; g.fillRect(x0, jy, bw, 2);
      g.fillStyle = 'rgba(30,18,8,0.8)'; g.fillRect(x0, 0, 2, N);
    }
    specks(5000, 2, ['rgba(40,24,10,1)', 'rgba(220,190,150,1)'], 0.12);
    for (let i = 0; i < 6; i++) blot(r() * N, r() * N, 60 + r() * 120, `rgba(${r() < 0.5 ? '40,26,14' : '190,160,120'},0.12)`);
  } else if (key === 'roomPlaster' || key === 'roomCeiling') {
    // painted plaster: near white, a faint roller texture, and on the walls the marks of a flat that
    // has been lived in: a water stain, a scuff, a ghost where a picture hung
    g.fillStyle = '#f0ece4'; g.fillRect(0, 0, N, N);
    specks(30000, 2, ['#e4dfd4', '#f8f5ee', '#dcd6ca'], 0.5);
    for (let i = 0; i < 18; i++) blot(r() * N, r() * N, 40 + r() * 90, `rgba(${r() < 0.5 ? '200,192,176' : '255,252,246'},0.25)`);
    if (key === 'roomPlaster') {
      blot(r() * N, r() * N * 0.4, 70, 'rgba(160,130,80,0.22)');
      blot(r() * N, r() * N, 30, 'rgba(120,110,100,0.18)');
      const x = r() * N * 0.7, y = r() * N * 0.5; g.strokeStyle = 'rgba(180,170,150,0.35)'; g.lineWidth = 3; g.strokeRect(x, y, 90, 120);
    }
  } else if (key === 'roomWeave' || key === 'roomCanvas' || key === 'roomTicking') {
    // a woven cloth in grey, to be tinted: warp and weft, slubs, and pilling; ticking has its stripe
    const tick = key === 'roomTicking', coarse = key === 'roomCanvas';
    g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, N, N);
    const step = coarse ? 6 : 4;
    for (let i = 0; i < N; i += step) {
      g.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.1})`; g.fillRect(i, 0, step / 2, N);
      g.fillStyle = `rgba(0,0,0,${0.06 + r() * 0.08})`; g.fillRect(0, i, N, step / 2);
    }
    specks(coarse ? 3000 : 8000, coarse ? 4 : 2, ['#a8a8a8', '#e8e8e8'], 0.35);
    if (tick) { g.fillStyle = 'rgba(60,80,120,0.55)'; for (let x = 0; x < N; x += 64) { g.fillRect(x + 6, 0, 10, N); g.fillRect(x + 22, 0, 3, N); } }
    for (let i = 0; i < 6; i++) blot(r() * N, r() * N, 50 + r() * 80, 'rgba(90,90,90,0.12)');
  } else if (key === 'roomSteel') {
    // brushed steel: long horizontal strokes and a soft sheen
    g.fillStyle = '#c6cacf'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '90,96,104'},${0.04 + r() * 0.08})`; g.fillRect(0, r() * N, N, 1); }
    for (let i = 0; i < 5; i++) blot(r() * N, r() * N, 60 + r() * 80, 'rgba(120,110,90,0.08)');
  } else if (key === 'roomWood') {
    g.fillStyle = '#a8845e'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 120; i++) {
      const y0 = r() * N, amp = 2 + r() * 6, ph = r() * 6.28;
      g.strokeStyle = r() < 0.6 ? `rgba(70,44,22,${0.2 + r() * 0.3})` : `rgba(210,170,120,${0.12 + r() * 0.2})`;
      g.lineWidth = 0.6 + r() * 2;
      for (const oy of [-N, 0, N]) { g.beginPath(); for (let x = 0; x <= N; x += 8) { const y = oy + y0 + Math.sin(x / N * Math.PI * 4 + ph) * amp; if (x) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
    }
  } else if (key === 'roomConcrete') {
    g.fillStyle = '#b4b0a8'; g.fillRect(0, 0, N, N);
    specks(40000, 2, ['#9a968e', '#c8c4bc', '#8a867e'], 0.45);
    specks(600, 6, ['#7a766e', '#d8d4cc'], 0.3);
    for (let i = 0; i < 10; i++) blot(r() * N, r() * N, 50 + r() * 100, `rgba(${r() < 0.5 ? '120,116,108' : '210,206,198'},0.2)`);
  } else if (key === 'roomTile') {
    // square glazed tiles, four a tile, white grout, each tile a little off its neighbour
    g.fillStyle = '#d8d4cc'; g.fillRect(0, 0, N, N);
    const n = 4, s = N / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const k = 0.94 + r() * 0.08; g.fillStyle = `rgb(${Math.round(240 * k)},${Math.round(238 * k)},${Math.round(232 * k)})`;
      g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
      const grd = g.createLinearGradient(i * s, j * s, i * s + s, j * s + s); grd.addColorStop(0, 'rgba(255,255,255,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0.05)');
      g.fillStyle = grd; g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
    }
  } else {
    // a rug: a worn kilim of bands and stepped diamonds, its ends fringed
    const pal = [['#6a2a24', '#c8a050', '#2a3a4a', '#e8dcc0'], ['#2a4a4a', '#c86a3a', '#e8d8b0', '#3a2a24'], ['#4a3a5a', '#d8b060', '#8a2a2a', '#e0d4bc']][seed % 3];
    g.fillStyle = pal[3]; g.fillRect(0, 0, N, N);
    const fr = 30;
    for (let y = fr; y < N - fr; y += 64) {
      const band = Math.floor(y / 64) % 3;
      g.fillStyle = pal[band]; g.fillRect(fr, y, N - 2 * fr, 64);
      g.fillStyle = pal[(band + 1) % 3];
      for (let x = fr + 32; x < N - fr; x += 64) { g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x + 26, y + 32); g.lineTo(x, y + 58); g.lineTo(x - 26, y + 32); g.fill(); }
      g.fillStyle = pal[3]; for (let x = fr + 32; x < N - fr; x += 64) g.fillRect(x - 5, y + 27, 10, 10);
    }
    g.strokeStyle = '#efe6d2'; g.lineWidth = 2;
    for (let x = 4; x < N; x += 7) for (const [y0, y1] of [[0, fr], [N - fr, N]]) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x + (r() - 0.5) * 4, y1); g.stroke(); }
    g.globalAlpha = 0.16;
    for (let i = 0; i < 60000; i++) { g.fillStyle = r() < 0.5 ? '#000' : '#fff'; g.fillRect(fr + r() * (N - 2 * fr), fr + r() * (N - 2 * fr), 1, 1); }
    g.globalAlpha = 1;
    blot(N / 2, N / 2, N * 0.3, 'rgba(255,240,210,0.15)');
  }
  return c;
}

// ── the view and the screen ─────────────────────────────────────────────────────────────────────
// The street out of the window at a fractional hour: the sky, the sun or the moon, towers in three
// rows fading into the haze, their windows lit as the evening comes on.
export function paintView(doc, hour, seed = 1) {
  const W = 1024, Hh = 512, c = doc.createElement('canvas');
  c.width = W; c.height = Hh;
  const g = c.getContext('2d'), r = rng(seed * 7919 + 13);
  const day = Math.max(0, Math.min(1, (Math.sin((hour - 6) / 12 * Math.PI) + 0.15) / 0.75)), dusk = Math.exp(-(((hour - 19) / 1.2) ** 2)) + Math.exp(-(((hour - 6.3) / 1.0) ** 2));
  const mixc = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
  const top = mixc([10, 14, 32], [86, 140, 204], day), low = mixc(mixc([24, 30, 56], [196, 214, 226], day), [236, 140, 90], Math.min(1, dusk * 0.8));
  const sky = g.createLinearGradient(0, 0, 0, Hh * 0.75);
  sky.addColorStop(0, `rgb(${top})`); sky.addColorStop(1, `rgb(${low})`);
  g.fillStyle = sky; g.fillRect(0, 0, W, Hh);
  if (day > 0.15) { const sx = W * (0.15 + ((hour - 6) / 12) * 0.7), sy = Hh * (0.6 - Math.sin((hour - 6) / 12 * Math.PI) * 0.45); const s = g.createRadialGradient(sx, sy, 0, sx, sy, 90); s.addColorStop(0, 'rgba(255,248,220,0.95)'); s.addColorStop(0.15, 'rgba(255,236,190,0.5)'); s.addColorStop(1, 'rgba(255,230,180,0)'); g.fillStyle = s; g.fillRect(0, 0, W, Hh); }
  else { g.fillStyle = 'rgba(230,232,240,0.9)'; g.beginPath(); g.arc(W * 0.7, Hh * 0.18, 14, 0, Math.PI * 2); g.fill(); for (let i = 0; i < 140; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.6})`; g.fillRect(r() * W, r() * Hh * 0.45, 1.5, 1.5); } }
  // the towers, far row to near: darker and sharper as they come nearer
  for (const [row, base, hmin, hmax, shade] of [[0, Hh * 0.62, 60, 200, 0.55], [1, Hh * 0.7, 90, 260, 0.75], [2, Hh * 0.82, 120, 330, 1]]) {
    let x = -20;
    while (x < W + 20) {
      const bw = 40 + r() * 90, bh = hmin + r() * (hmax - hmin), y0 = base - bh;
      const lit = mixc(mixc([16, 18, 26], [96, 104, 118], day), low, (1 - shade) * 0.6);
      g.fillStyle = `rgb(${lit.map((v) => Math.round(v * (0.7 + 0.3 * (1 - shade))))})`;
      g.fillRect(x, y0, bw, Hh - y0);
      if (r() < 0.3) g.fillRect(x + bw * 0.4, y0 - 20 - r() * 30, 3, 20 + r() * 30);
      // its windows: lit at night, glinting by day
      for (let wy = y0 + 8; wy < Hh; wy += 11) for (let wx = x + 5; wx < x + bw - 6; wx += 9) {
        const on = r() < (1 - day) * 0.45 * shade + 0.04;
        if (on) { g.fillStyle = r() < 0.8 ? `rgba(255,214,140,${0.6 + r() * 0.4})` : `rgba(160,220,255,${0.6 + r() * 0.4})`; g.fillRect(wx, wy, 5, 6); }
        else if (day > 0.4 && r() < 0.15) { g.fillStyle = `rgba(220,236,255,${0.15 + r() * 0.2})`; g.fillRect(wx, wy, 5, 6); }
      }
      x += bw + 4 + r() * 16;
    }
    // the haze between the rows
    const hz = g.createLinearGradient(0, base - 120, 0, base); hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(1, `rgba(${low},${0.25 * (1 - row * 0.3)})`);
    g.fillStyle = hz; g.fillRect(0, base - 120, W, 120);
  }
  // the street's own glow coming up from below, at night
  const glow = g.createLinearGradient(0, Hh * 0.75, 0, Hh); glow.addColorStop(0, 'rgba(255,170,90,0)'); glow.addColorStop(1, `rgba(255,170,90,${0.35 * (1 - day)})`);
  g.fillStyle = glow; g.fillRect(0, Hh * 0.75, W, Hh * 0.25);
  return c;
}

// A set's picture: snow and a rolling bar when it's on, a dark curved glass with the room in it when
// it's off. `t` moves the snow.
export function paintScreen(canvas, on, t = 0, seed = 1) {
  const g = canvas.getContext('2d'), W = canvas.width, Hh = canvas.height;
  if (!on) {
    const grd = g.createLinearGradient(0, 0, W, Hh);
    grd.addColorStop(0, '#16181c'); grd.addColorStop(0.45, '#0b0c0e'); grd.addColorStop(0.55, '#121418'); grd.addColorStop(1, '#08090a');
    g.fillStyle = grd; g.fillRect(0, 0, W, Hh);
    return canvas;
  }
  const img = g.createImageData(W, Hh), d = img.data, r = rng(((t * 30) | 0) * 2654435761 + seed);
  const bar = ((t * 0.35) % 1) * Hh;
  for (let y = 0; y < Hh; y++) {
    const roll = Math.exp(-(((y - bar) / 18) ** 2)) * 60;
    for (let x = 0; x < W; x++) {
      const v = Math.min(255, r() * 200 + 20 + roll), i = (y * W + x) * 4;
      d[i] = v * 0.92; d[i + 1] = v * 0.96; d[i + 2] = v; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}
