// GLASS 2 · A ROOM'S FINISH. What a room is finished with past its plain walls, ceiling and floor
// (client/shared/room-layout.js `spec.decor`, from a zone's `flags.room.decor`): stone or walnut on the
// walls, a coffered or slotted ceiling, a border and a medallion let into the floor, a runner down a
// hall, chandeliers and sconces, columns, planted trees, pictures, the doors that don't go anywhere you
// can, and the numbers on the ones that do. Plus the few forms a hotel's furniture needs (`drawDecorForm`):
// a reception desk, a console table, a plinth, a stone bench. Pure: batches, no GL.
//
// ⚠ IT'S ALL DATA. A room says what it has; nothing here knows which room it is, so a second game on
// THOMAS finishes its own lobby with no edit here. Every key is optional and an unknown one is ignored.
//
// ⚠ EVERY LAYER STANDS CLEAR OF THE ONE UNDER IT. Cladding is 2 cm off the wall, a reveal 1 cm off the
// cladding, a plaque 1.5 cm off that: two faces nearer than a centimetre fight for the same pixels.
//
// The frame is the layout's: u across, v back from the front wall, y up, metres. Along a wall `a` is u
// on the front and back walls and v on the sides. Seen from the room, `a` runs right to left on the back
// and left walls (drawSign in room-mesh.js says the same), which `toward` and the lettering allow for.

import { MAT } from './ballpark-mesh.js';
import { readerAlong, CARD_TOP } from './room-lock.js';
import { fireDial } from './room-fittings.js';
import { drawChessBoard } from './room-chess.js';
import { legend, legendWidth } from '../../../../shared/legend-font.js';
import { balconyDressOf } from '../../../../shared/room-layout.js';
import { glassLathe, liquidLathe } from './lab-mesh.js';
import { drawCatStatue } from './cat-statue.js';
import { drawSaloonDecor, dressCardTable, saloonCtx } from './room-saloon.js';

const { GLOSS, METAL, SATIN, CLOTH, MATTE, LEATHER } = MAT;
// the codes gl/room.js reads for a light's own face, as room-mesh.js has them (GLOW, LAMP)
const GLOW = 40, LAMP = 42;
// a sheet of flame, as room-fittings.js has it: gl/room.js burns it
const FIRE = 43;
const BRONZE = '#8a6a44', BRONZE_DARK = '#3a2c1e', BRASS = '#c9a24a', GOLD = '#c9a14a';
const WALNUT = { t: 'roomOak', c: '#5a3a26' };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hex6 = (s, d) => (/^#[0-9a-f]{6}$/i.test(s || '') ? s : d);
const num = (x, d, lo = -Infinity, hi = Infinity) => (Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Number(x))) : d);

// ── walls ─────────────────────────────────────────────────────────────────────────────────────────
// A box against the inside face of a wall: a0..a1 along it, d0..d1 out from its face, y0..y1 up.
function onWall(K, L, wall, a0, a1, d0, d1, y0, y1, hex, k = 1, tex = null, surf) {
  const hu = L.w / 2, D = L.d;
  if (wall === 'front') K.box(a0, a1, d0, d1, y0, y1, hex, k, tex, surf);
  else if (wall === 'back') K.box(a0, a1, D - d1, D - d0, y0, y1, hex, k, tex, surf);
  else if (wall === 'left') K.box(-hu + d0, -hu + d1, a0, a1, y0, y1, hex, k, tex, surf);
  else K.box(hu - d1, hu - d0, a0, a1, y0, y1, hex, k, tex, surf);
}
// A point `d` out from a wall's face at `a` along it, as [u, v].
function wallPt(L, wall, a, d) {
  const hu = L.w / 2, D = L.d;
  return wall === 'front' ? [a, d] : wall === 'back' ? [a, D - d] : wall === 'left' ? [-hu + d, a] : [hu - d, a];
}
// +1 when `a` grows to the right as you face the wall, -1 when it grows to the left
const toward = (wall) => (wall === 'back' || wall === 'left' ? -1 : 1);
const outOf = (K, wall) => (wall === 'front' ? K.nrmOf(0, 0, 1) : wall === 'back' ? K.nrmOf(0, 0, -1) : wall === 'left' ? K.nrmOf(1, 0, 0) : K.nrmOf(-1, 0, 0));
// A face on a wall at depth d for the legend face to letter: (a, b) is reading-direction and up.
function wallPlate(K, L, wall, d) {
  const s = toward(wall), out = outOf(K, wall);
  return { plate: (ps, c, emis) => K.quad(K.solid, ps.map(([a, b]) => { const [u, v] = wallPt(L, wall, s * a, d); return [u, v, b]; }), out, c, emis > 0.5 ? GLOW : MATTE, null, true) };
}
// Letters on a wall, centred at `a` along it and `y` up, `h` tall.
function letter(K, L, wall, text, a, y, h, d, col, emis = 0) {
  legend(wallPlate(K, L, wall, d), String(text).toUpperCase(), toward(wall) * a, y, h, K.C(col, emis ? 2 : 1), emis);
}

// The cladding on a wall's solid runs. kind 'stone': book-matched marble slabs with a fine dark joint and a gold
// reveal every other one; 'limestone': the same in a plain honed stone, for a pale wall a vein would read as a crack; 'walnut': boards with a bronze inlay between them and a bronze rail at `rail`;
// 'bronze': brushed bronze panels, for a door wall that's meant to be looked at.
function clad(K, L, runs, c, { H, accent }) {
  const kind = c.kind || 'stone', top = num(c.y1, H, 0.5, H), base = 0.12, hex = hex6(c.hex, kind === 'walnut' ? '#5a3a26' : kind === 'bronze' ? '#8a6a44' : '#efe9df');
  const gold = hex6(c.trim, accent || GOLD), pitch = num(c.pitch, kind === 'walnut' ? 0.9 : 1.2, 0.3, 4);
  const mat = kind === 'walnut' ? { t: 'roomOak', c: hex } : kind === 'bronze' ? null : kind === 'limestone' ? { t: 'roomStone', c: hex } : { t: 'roomMarble', c: hex };
  const surf = kind === 'walnut' || kind === 'limestone' ? SATIN : kind === 'bronze' ? METAL : GLOSS;
  for (const [wall, rs] of Object.entries(runs)) {
    if (c.on && !c.on.includes(wall)) continue;
    for (let [a, b] of rs) {
      if (wall === 'left' || wall === 'right') { a = Math.max(a, 0); b = Math.min(b, L.d); }
      if (b - a < 0.15) continue;
      // a dark plinth along the floor, and the panels over it
      onWall(K, L, wall, a, b, 0, 0.026, 0, base, '#16120f', 1, null, GLOSS);
      const n = Math.max(1, Math.round((b - a) / pitch)), w = (b - a) / n;
      for (let i = 0; i < n; i++) {
        const stone = kind === 'stone' || kind === 'limestone', p0 = a + i * w, p1 = p0 + w, j = stone ? 0.004 : 0.006;
        // 1.5 cm proud, so a sign's backer (2 cm, room-mesh.js drawSign) stands clear of it
        onWall(K, L, wall, p0 + j, p1 - j, 0, 0.015, base, top, hex, stone ? 1.02 + (i % 2) * 0.04 : 1, mat, surf);
        // the joint: a gold reveal (every other one on stone) or a bronze inlay, 1 cm proud of the panels
        if (i > 0 && (!stone || i % 2 === 0)) onWall(K, L, wall, p0 - 0.006, p0 + 0.006, 0, 0.026, base, top, gold, 1.1, null, METAL);
      }
      // a rail: on walnut at dado height and at the top; on stone a cap under the ceiling
      if (kind === 'walnut') { for (const y of [num(c.rail, 0.95, 0.4, 2), top - 0.06]) onWall(K, L, wall, a, b, 0, 0.034, y, y + 0.035, gold, 1.08, null, METAL); }
      else if (top < H - 0.02) onWall(K, L, wall, a, b, 0, 0.032, top, top + 0.04, gold, 1.08, null, METAL);
    }
  }
}

// ── the ceiling ───────────────────────────────────────────────────────────────────────────────────
// 'coffer': a lit cove round the edge and a grid of beams over the rest, each with a gold fillet;
// 'slot': a long light let into the ceiling down the room's length, the cove too; 'cove': the cove alone.
function ceiling(K, L, c, { H, accent, lampOn }) {
  const hu = L.w / 2, D = L.d, hex = hex6(c.hex, '#2a2522'), gold = hex6(c.trim, accent || GOLD), band = num(c.band, 0.55, 0.2, 1.5), drop = num(c.drop, 0.3, 0.1, 0.8);
  const glow = lampOn ? '#ffe2b0' : '#8a7a60', gk = lampOn ? 1.7 : 0.9;
  // the cove: a soffit round the edge, its inner lip gold, a warm light washing up out of the gap behind it
  const yS = H - drop;
  for (const [u0, u1, v0, v1] of [[-hu, hu, 0, band], [-hu, hu, D - band, D], [-hu, -hu + band, band, D - band], [hu - band, hu, band, D - band]]) {
    K.box(u0, u1, v0, v1, yS, H - 0.001, hex, 1, null, MATTE);
  }
  const ring = [[-hu + band, hu - band, band - 0.03, band], [-hu + band, hu - band, D - band, D - band + 0.03], [-hu + band - 0.03, -hu + band, band, D - band], [hu - band, hu - band + 0.03, band, D - band]];
  for (const [u0, u1, v0, v1] of ring) K.box(u0, u1, v0, v1, yS - 0.05, yS + 0.005, gold, 1.08, null, METAL);
  // the light in the cove: a strip just above the lip, inside the soffit's line
  for (const [u0, u1, v0, v1] of [[-hu + band, hu - band, band + 0.01, band + 0.05], [-hu + band, hu - band, D - band - 0.05, D - band - 0.01], [-hu + band + 0.01, -hu + band + 0.05, band, D - band], [hu - band - 0.05, hu - band - 0.01, band, D - band]]) K.box(u0, u1, v0, v1, yS + 0.05, yS + 0.07, glow, gk, null, lampOn ? LAMP : undefined);
  const kind = c.kind || 'cove';
  if (kind === 'coffer') {
    const cell = num(c.cell, 2.0, 0.8, 5), iu0 = -hu + band, iu1 = hu - band, iv0 = band, iv1 = D - band;
    const nu = Math.max(1, Math.round((iu1 - iu0) / cell)), nv = Math.max(1, Math.round((iv1 - iv0) / cell)), bw = 0.09, bd = 0.2;
    for (let i = 1; i < nu; i++) { const u = iu0 + i * (iu1 - iu0) / nu; K.box(u - bw, u + bw, iv0, iv1, H - bd, H - 0.001, hex, 1, null, MATTE); K.box(u - bw - 0.008, u + bw + 0.008, iv0, iv1, H - bd - 0.012, H - bd, gold, 1.05, null, METAL); }
    for (let j = 1; j < nv; j++) { const v = iv0 + j * (iv1 - iv0) / nv; K.box(iu0, iu1, v - bw, v + bw, H - bd, H - 0.001, hex, 1, null, MATTE); K.box(iu0, iu1, v - bw - 0.008, v + bw + 0.008, H - bd - 0.012, H - bd, gold, 1.05, null, METAL); }
  } else if (kind === 'slot') {
    const long = L.w >= L.d, half = 0.05;
    if (long) { K.box(-hu + band, hu - band, D / 2 - half - 0.03, D / 2 + half + 0.03, H - 0.012, H - 0.001, '#0c0a08', 1); K.box(-hu + band + 0.05, hu - band - 0.05, D / 2 - half, D / 2 + half, H - 0.016, H - 0.012, glow, gk + 0.2, null, lampOn ? LAMP : undefined); }
    else { K.box(-half - 0.03, half + 0.03, band, D - band, H - 0.012, H - 0.001, '#0c0a08', 1); K.box(-half, half, band + 0.05, D - band - 0.05, H - 0.016, H - 0.012, glow, gk + 0.2, null, lampOn ? LAMP : undefined); }
  }
}

// ── the floor ─────────────────────────────────────────────────────────────────────────────────────
// A border of dark stone let into the floor `inset` in from the walls, and a medallion: a compass star in
// gold and black in two rings.
function floorInlay(K, L, c, { TEX }) {
  const hu = L.w / 2, D = L.d, y = 0.0025, ins = num(c.inset, 0.6, 0.1, 3), w = num(c.w, 0.24, 0.05, 1), dark = hex6(c.border, '#1c1916');
  const t = TEX.roomMarble, lay = (u0, u1, v0, v1, col, k, yy = y) => { const ps = [[u0, v0, yy], [u1, v0, yy], [u1, v1, yy], [u0, v1, yy]]; K.quad(K.TB('roomMarble'), ps, [0, 1, 0], K.C(col, k), GLOSS, ps.map((q) => [q[1] / t, q[0] / t])); };
  if (c.border !== false) {
    const a0 = -hu + ins, a1 = hu - ins, b0 = ins, b1 = D - ins;
    if (a1 - a0 > 2 * w && b1 - b0 > 2 * w) {
      lay(a0, a1, b0, b0 + w, dark, 1); lay(a0, a1, b1 - w, b1, dark, 1); lay(a0, a0 + w, b0 + w, b1 - w, dark, 1); lay(a1 - w, a1, b0 + w, b1 - w, dark, 1);
      // a gold line inside it
      const g = 0.02, gi = w + 0.06;
      for (const [u0, u1, v0, v1] of [[a0 + gi, a1 - gi, b0 + gi, b0 + gi + g], [a0 + gi, a1 - gi, b1 - gi - g, b1 - gi], [a0 + gi, a0 + gi + g, b0 + gi, b1 - gi], [a1 - gi - g, a1 - gi, b0 + gi, b1 - gi]]) K.box(u0, u1, v0, v1, 0.0005, y + 0.0015, hex6(c.line, GOLD), 1.05, null, METAL);
    }
  }
  const m = c.medallion;
  if (Array.isArray(m) && m.length >= 2) {
    const [cu, cv, R = 1.2] = m.map(Number), ring = (r0, r1, col, k, surf, yy) => {
      const n = 64;
      for (let i = 0; i < n; i++) {
        const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, P = (a, r) => [cu + Math.cos(a) * r, cv + Math.sin(a) * r, yy];
        K.quad(K.solid, [P(a0, r1), P(a1, r1), P(a1, r0), P(a0, r0)], [0, 1, 0], K.C(col, k), surf);
      }
    };
    ring(R - 0.06, R, hex6(c.line, GOLD), 1.05, METAL, y + 0.001);
    ring(R * 0.62, R - 0.06, dark, 1, GLOSS, y + 0.0006);
    ring(R * 0.58, R * 0.62, hex6(c.line, GOLD), 1.05, METAL, y + 0.001);
    // the star: sixteen points, the long ones gold and the short ones black
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, long = i % 2 === 0, r = long ? R * 0.92 : R * 0.55, side = 0.11 * R, c0 = [cu, cv];
      const tip = [cu + Math.cos(a) * r, cv + Math.sin(a) * r], l = [cu + Math.cos(a - Math.PI / 16) * side, cv + Math.sin(a - Math.PI / 16) * side], rr = [cu + Math.cos(a + Math.PI / 16) * side, cv + Math.sin(a + Math.PI / 16) * side];
      const yy = y + (long ? 0.0016 : 0.0013);
      K.quad(K.solid, [[...c0, yy], [...l, yy], [...tip, yy], [...rr, yy]], [0, 1, 0], K.C(long ? hex6(c.line, GOLD) : dark, long ? 1.05 : 1), long ? METAL : GLOSS);
    }
  }
}

// A runner down a hall's length: wool, a dark binding, two gold bands just in from its edges.
function runner(K, L, c, { TEX }) {
  const hu = L.w / 2, D = L.d, long = c.along ? c.along === 'u' : L.w >= L.d, w = num(c.w, Math.min(1.2, (long ? D : L.w) * 0.5), 0.4, 4), end = num(c.end, 0.35, 0, 3);
  const hex = hex6(c.hex, '#1e2a3a'), band = hex6(c.border, '#a8823a'), t = TEX.roomWool, y = 0.012;
  const [u0, u1, v0, v1] = long ? [-hu + end, hu - end, D / 2 - w / 2, D / 2 + w / 2] : [-w / 2, w / 2, end, D - end];
  const lay = (a0, a1, b0, b1, col, k, yy) => { const ps = [[a0, b0, yy], [a1, b0, yy], [a1, b1, yy], [a0, b1, yy]]; K.quad(K.TB('roomWool'), ps, [0, 1, 0], K.C(col, k), CLOTH, ps.map((q) => [q[0] / t, q[1] / t])); };
  lay(u0, u1, v0, v1, hex, 1, y);
  const e = 0.035, b = 0.03, g = 0.1;
  if (long) { for (const [s0, s1] of [[v0, v0 + e], [v1 - e, v1]]) lay(u0, u1, s0, s1, '#0e0c0a', 1, y + 0.001); for (const [s0, s1] of [[v0 + g, v0 + g + b], [v1 - g - b, v1 - g]]) lay(u0 + g, u1 - g, s0, s1, band, 1.05, y + 0.001); }
  else { for (const [s0, s1] of [[u0, u0 + e], [u1 - e, u1]]) lay(s0, s1, v0, v1, '#0e0c0a', 1, y + 0.001); for (const [s0, s1] of [[u0 + g, u0 + g + b], [u1 - g - b, u1 - g]]) lay(s0, s1, v0 + g, v1 - g, band, 1.05, y + 0.001); }
  // the pile's edge, so it reads as a thing lying on the floor
  for (const [a, bq, n] of long ? [[[u0, v0], [u1, v0], [0, 0, -1]], [[u1, v1], [u0, v1], [0, 0, 1]]] : [[[u0, v1], [u0, v0], [-1, 0, 0]], [[u1, v0], [u1, v1], [1, 0, 0]]]) K.quad(K.solid, [[a[0], a[1], 0.001], [bq[0], bq[1], 0.001], [bq[0], bq[1], y], [a[0], a[1], y]], K.nrmOf(...n), K.C('#0e0c0a', 0.8), CLOTH);
}

// ── lights ────────────────────────────────────────────────────────────────────────────────────────
// A bar between two room points, six-sided.
function rod(K, a, b, r, hex, k = 1, surf = METAL) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d) || 1, t = d.map((x) => x / l);
  const up = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const s = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]], sl = Math.hypot(...s);
  const e1 = s.map((x) => x / sl), e2 = [t[1] * e1[2] - t[2] * e1[1], t[2] * e1[0] - t[0] * e1[2], t[0] * e1[1] - t[1] * e1[0]];
  const P = (o, i) => { const g = i / 6 * Math.PI * 2, c = Math.cos(g) * r, q = Math.sin(g) * r; return [o[0] + e1[0] * c + e2[0] * q, o[1] + e1[1] * c + e2[1] * q, o[2] + e1[2] * c + e2[2] * q]; };
  for (let i = 0; i < 6; i++) {
    const g = (i + 0.5) / 6 * Math.PI * 2, n = [e1[0] * Math.cos(g) + e2[0] * Math.sin(g), e1[1] * Math.cos(g) + e2[1] * Math.sin(g), e1[2] * Math.cos(g) + e2[2] * Math.sin(g)];
    K.quad(K.solid, [P(a, i), P(a, i + 1), P(b, i + 1), P(b, i)], K.nrmOf(n[0], n[2], n[1]), K.C(hex, k), surf);
  }
}
// A ring of bronze round an upright axis: a torus, as a turned piece.
const torus = (K, u, v, R, r, y, hex, k = 1) => K.lathe(u, v, Array.from({ length: 9 }, (_, i) => { const a = -Math.PI / 2 + i / 8 * Math.PI * 2; return [R + Math.cos(a) * r, y + Math.sin(a) * r]; }), hex, k, Math.max(24, Math.round(R * 40)), METAL);

// A CHANDELIER: a canopy, a stem, tiers of bronze rings each hung with cut-glass drops and set with
// candle bulbs, and a cascade under the lowest. It lights the room as one of its six lamps.
function chandelier(K, L, c, { H, lampOn, lamps }) {
  const [u, v] = c.at, R = num(c.r, 0.8, 0.3, 2), drop = num(c.drop, 1.5, 0.6, H - 1.9), tiers = Math.round(num(c.tiers, 3, 1, 4));
  const bulb = lampOn ? '#fff1d6' : '#d8d2c4', bk = lampOn ? 2.4 : 0.9, dk = lampOn ? 1.05 : 0.7;
  K.lathe(u, v, [[0, H - 0.07], [0.18, H - 0.07], [0.2, H - 0.04], [0.14, H], [0, H]], BRONZE, 1.05, 24, METAL);
  K.lathe(u, v, [[0.016, H - drop * 0.92], [0.016, H - 0.07]], BRONZE, 1.05, 8, METAL);
  for (let t = 0; t < tiers; t++) {
    const kk = tiers > 1 ? t / (tiers - 1) : 0, r = R * (1 - 0.38 * kk), y = H - drop * (0.36 + 0.24 * t);
    torus(K, u, v, r, 0.016, y, BRONZE, 1.08);
    // the arms out to it from the stem
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + t * 0.4; rod(K, [u, v, y + 0.18], [u + Math.cos(a) * r, v + Math.sin(a) * r, y], 0.008, BRONZE, 1.05); }
    const n = Math.max(12, Math.round(2 * Math.PI * r / 0.085));
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; K.drop(u + Math.cos(a) * r, v + Math.sin(a) * r, y - 0.018, 0.02, i % 3 ? 0.1 : 0.16, dk); }
    const m = Math.max(6, Math.round(2 * Math.PI * r / 0.32));
    for (let i = 0; i < m; i++) {
      const a = (i + 0.5) / m * Math.PI * 2, bu = u + Math.cos(a) * r, bv = v + Math.sin(a) * r;
      K.lathe(bu, bv, [[0.018, y + 0.016], [0.018, y + 0.09], [0, y + 0.09]], '#efe9dc', 1, 8, SATIN);
      K.ball(bu, bv, y + 0.115, 0.022, bulb, bk, 8, lampOn ? LAMP : undefined);
    }
  }
  // the cascade: rings of drops narrowing to a glass ball
  const yb = H - drop;
  for (let j = 0; j < 4; j++) { const r = R * 0.34 * (1 - j / 4), n = Math.max(6, Math.round(2 * Math.PI * r / 0.07)); for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + j; K.drop(u + Math.cos(a) * r, v + Math.sin(a) * r, yb + 0.32 - j * 0.09, 0.016, 0.09, dk); } }
  K.ball(u, v, yb + 0.02, 0.05, '#e8f2ff', lampOn ? 1.4 : 0.9, 12, GLOSS);
  lamps.push({ p: L.world(u, v, H - drop * 0.55), annex: false, k: num(c.k, 1.5, 0.3, 3) });
}

// A SCONCE on a wall: a bronze backplate, a short arm and an alabaster shade lit from inside.
function sconce(K, L, wall, a, y, { lampOn, hex }) {
  onWall(K, L, wall, a - 0.045, a + 0.045, 0.016, 0.03, y - 0.17, y + 0.13, hex, 1.05, null, METAL);
  onWall(K, L, wall, a - 0.012, a + 0.012, 0.03, 0.1, y - 0.06, y - 0.03, hex, 1.05, null, METAL);
  const [su, sv] = wallPt(L, wall, a, 0.115);
  K.lathe(su, sv, [[0, y - 0.07], [0.012, y - 0.07], [0.012, y - 0.03], [0, y - 0.03]], hex, 1.05, 8, METAL);
  K.lathe(su, sv, [[0.045, y - 0.03], [0.07, y + 0.11], [0.066, y + 0.115], [0.04, y - 0.025]], lampOn ? '#ffe7c4' : '#d8cfc0', lampOn ? 1.55 : 0.85, 18, lampOn ? LAMP : undefined);
}
// Sconces along every solid run long enough for one, `gap` apart, clear of the run's ends.
// `points` ([[wall, a], ...]) puts them exactly where they go instead.
function sconces(K, L, runs, c, ctx) {
  const y = num(c.y, 1.75, 1, ctx.H - 0.3), gap = num(c.gap, 2.4, 0.8, 8), hex = hex6(c.hex, BRONZE);
  if (Array.isArray(c.points)) {
    for (const [wall, a] of c.points) if (['front', 'back', 'left', 'right'].includes(wall) && Number.isFinite(a)) sconce(K, L, wall, a, y, { lampOn: ctx.lampOn, hex });
    return;
  }
  for (const [wall, rs] of Object.entries(runs)) {
    if (c.on && !c.on.includes(wall)) continue;
    for (let [a, b] of rs) {
      if (wall === 'left' || wall === 'right') { a = Math.max(a, 0); b = Math.min(b, L.d); }
      const len = b - a - 0.5;
      if (len < 0.4) continue;
      const n = Math.max(1, Math.floor(len / gap) + 1), step = n > 1 ? len / (n - 1) : 0;
      for (let i = 0; i < n; i++) sconce(K, L, wall, n > 1 ? a + 0.25 + i * step : (a + b) / 2, y, { lampOn: ctx.lampOn, hex });
    }
  }
}

// ── on the floor ──────────────────────────────────────────────────────────────────────────────────
// A COLUMN: a bronze base, a marble shaft, a bronze capital ring under a square abacus, floor to ceiling.
function column(K, u, v, r, { H, hex }) {
  K.lathe(u, v, [[r + 0.06, 0], [r + 0.06, 0.12], [r + 0.02, 0.16], [0, 0.16]], BRONZE, 1.05, 24, METAL);
  K.lathe(u, v, [[r, 0.16], [r, H - 0.42], [0, H - 0.42]], { t: 'roomMarble', c: hex }, 1.04, 28, GLOSS);
  K.lathe(u, v, [[r, H - 0.42], [r + 0.04, H - 0.36], [r + 0.04, H - 0.3], [r + 0.02, H - 0.28], [0, H - 0.28]], BRONZE, 1.08, 24, METAL);
  K.box(u - r - 0.08, u + r + 0.08, v - r - 0.08, v + r + 0.08, H - 0.28, H, '#1c1916', 1, null, GLOSS);
}
// A LEAF: an outline from its stalk `b` along `d` (unit, [u, v, y]) to its tip, `len` long and `wid` at its
// widest, folded on the midrib so each half takes the light on its own face: the comic look's two tones.
// `side` is the leaf's breadth direction. `fat` moves the widest point toward the tip (a fiddle leaf).
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function leaf(K, b, d, side, len, wid, hex, k, fat = 0.5) {
  const at = (t, w, drop) => [b[0] + d[0] * len * t + side[0] * w, b[1] + d[1] * len * t + side[1] * w, b[2] + d[2] * len * t + side[2] * w - drop];
  const T = at(1, 0, len * 0.06);
  for (const sg of [1, -1]) {
    const p1 = at(fat * 0.55, sg * wid * 0.45, len * 0.06), p2 = at(Math.min(0.9, fat + 0.2), sg * wid * 0.5, len * 0.09);
    let n = cross3([p2[0] - b[0], p2[1] - b[1], p2[2] - b[2]], [T[0] - b[0], T[1] - b[1], T[2] - b[2]]);
    const l = Math.hypot(...n) || 1; if (n[2] < 0) n = n.map((x) => -x);
    K.quad(K.solid, [b, p1, p2, T], K.nrmOf(n[0] / l, n[2] / l, n[1] / l), K.C(hex, sg > 0 ? k : k * 0.74), SATIN);
  }
}
// A PLANT IN A GLAZED URN, for a good lobby: a black urn with a brass band and a pale pebble top, and either
// a fiddle-leaf fig (big leathery leaves spiralling up a slim trunk) or a kentia palm (arching fronds of
// fine leaflets), seeded so each one is its own.
function plant(K, u, v, s, seed) {
  const r = rng(seed), R = 0.3 * s, Hp = 0.58 * s;
  K.lathe(u, v, [[0, 0], [R * 0.62, 0], [R * 0.66, 0.05 * s], [R * 0.95, Hp * 0.45], [R, Hp * 0.7], [R * 0.88, Hp * 0.92], [R * 0.9, Hp], [R * 0.8, Hp], [R * 0.8, Hp - 0.05], [0, Hp - 0.05]], '#17171b', 1, 28, GLOSS);
  torus(K, u, v, R * 0.98, 0.012 * s, Hp * 0.7, BRASS, 1.1);
  K.lathe(u, v, [[0, Hp - 0.04], [R * 0.8, Hp - 0.04]], '#2a1e16', 0.9, 20);
  for (let i = 0; i < 14; i++) { const a = r() * Math.PI * 2, rr = r() * R * 0.68; K.ball(u + Math.cos(a) * rr, v + Math.sin(a) * rr, Hp - 0.035, (0.022 + r() * 0.014) * s, i % 3 ? '#d9d3c7' : '#b8b1a4', 1, 6, SATIN); }
  const base = Hp - 0.04;
  if (seed % 2) {
    // the fig: a slim, slightly leaning trunk, leaves on the golden angle from a third of the way up
    const top = base + 1.45 * s, lean = [(r() - 0.5) * 0.12 * s, (r() - 0.5) * 0.12 * s], bark = '#6b5a46';
    K.lathe(u, v, [[0.035 * s, base], [0.028 * s, base + 0.6 * s], [0, base + 0.6 * s]], bark, 0.95, 8, SATIN);
    rod(K, [u, v, base + 0.58 * s], [u + lean[0], v + lean[1], top], 0.022 * s, bark, 0.95, SATIN);
    const greens = ['#2f4a24', '#3a5a2a', '#466a30', '#355226'], n = 34;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), y = base + (0.45 + 0.55 * t) * 1.45 * s, a = i * 2.39996 + r() * 0.3;
      const cu = u + lean[0] * (y - base) / (1.45 * s), cv = v + lean[1] * (y - base) / (1.45 * s);
      const el = (0.75 - 0.95 * (1 - t)) + (r() - 0.5) * 0.3, len = (0.24 + 0.1 * (1 - t) + r() * 0.05) * s;
      const d = [Math.cos(a) * Math.cos(el), Math.sin(a) * Math.cos(el), Math.sin(el)], side = [-Math.sin(a), Math.cos(a), 0];
      const st = [cu + Math.cos(a) * 0.05 * s, cv + Math.sin(a) * 0.05 * s, y - 0.02 * s];
      rod(K, [cu, cv, y], st, 0.005 * s, '#4e6a32', 1, SATIN);
      leaf(K, st, d, side, len, len * 0.62, greens[i % greens.length], 0.95 + r() * 0.15, 0.62);
    }
  } else {
    // the palm: a clump of canes, each ending in a frond that arches out and down
    const greens = ['#3c5e2c', '#476b33', '#53783a'], n = 9;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + r() * 0.5, el = 0.75 + r() * 0.5, Lf = (0.95 + r() * 0.35) * s, cane = (0.45 + r() * 0.35) * s;
      const ca = [Math.cos(a), Math.sin(a)], c0 = [u + ca[0] * 0.03 * s, v + ca[1] * 0.03 * s, base];
      const c1 = [c0[0] + ca[0] * cane * 0.18, c0[1] + ca[1] * cane * 0.18, base + cane];
      rod(K, c0, c1, 0.011 * s, '#5d6e3a', 0.95, SATIN);
      const P = (t) => [c1[0] + ca[0] * Lf * t * Math.cos(el), c1[1] + ca[1] * Lf * t * Math.cos(el), c1[2] + Lf * t * Math.sin(el) - Lf * 0.95 * t * t];
      for (let j = 0; j < 8; j++) rod(K, P(j / 8), P((j + 1) / 8), 0.006 * s * (1 - j / 10), '#5d6e3a', 0.95, SATIN);
      const side = [-ca[1], ca[0], 0];
      for (let j = 1; j <= 14; j++) {
        const t = j / 15, p = P(t), q = P(t + 0.02), along = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], al = Math.hypot(...along) || 1;
        const lf = (0.26 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + 0.06) * s;
        for (const sg of [1, -1]) {
          const dd = [side[0] * sg * 0.8 + along[0] / al * 0.5, side[1] * sg * 0.8 + along[1] / al * 0.5, -0.35], dl = Math.hypot(...dd);
          const d = dd.map((x) => x / dl), sd = cross3(d, [0, 0, 1]), sl = Math.hypot(...sd) || 1;
          leaf(K, p, d, sd.map((x) => x / sl), lf, 0.035 * s, greens[(i + j) % 3], 0.95 + r() * 0.12, 0.4);
        }
      }
    }
  }
}

// ── on the walls ──────────────────────────────────────────────────────────────────────────────────
// A PICTURE: a slim black frame with a bronze sight edge round a primed canvas laid with two or three soft
// fields of colour, seeded, as a lobby buys its art.
function picture(K, L, c, i) {
  const wall = ['front', 'back', 'left', 'right'].includes(c.wall) ? c.wall : 'back', a = num(c.at, 0), w = num(c.w, 1.2, 0.3, 6), h = num(c.h, 1.5, 0.3, 4), y = num(c.y, 1.6, 0.4, 6);
  const r = rng(num(c.seed, 7 + i * 31)), pal = [['#7a1f1a', '#c46a2a', '#2a1a14'], ['#1f3346', '#6a8aa0', '#d8cdb8'], ['#3a2a1e', '#a8823a', '#e8dcc4'], ['#4a1e2e', '#c8a46a', '#1a1414'], ['#25322a', '#7d8a5a', '#cfc4a8']][Math.floor(r() * 5)];
  const a0 = a - w / 2, a1 = a + w / 2, y0 = y - h / 2, y1 = y + h / 2, f = 0.045;
  for (const [p0, p1, q0, q1] of [[a0 - f, a1 + f, y1, y1 + f], [a0 - f, a1 + f, y0 - f, y0], [a0 - f, a0, y0, y1], [a1, a1 + f, y0, y1]]) onWall(K, L, wall, p0, p1, 0.02, 0.07, q0, q1, '#0e0d0c', 1, null, SATIN);
  for (const [p0, p1, q0, q1] of [[a0, a1, y1 - 0.006, y1], [a0, a1, y0, y0 + 0.006], [a0, a0 + 0.006, y0, y1], [a1 - 0.006, a1, y0, y1]]) onWall(K, L, wall, p0, p1, 0.02, 0.064, q0, q1, BRASS, 1.05, null, METAL);
  onWall(K, L, wall, a0 + 0.006, a1 - 0.006, 0.02, 0.05, y0 + 0.006, y1 - 0.006, pal[2], 1, { t: 'roomCanvas', c: pal[2] }, MATTE);
  // the fields: stacked, soft-edged by a lighter margin, each a few millimetres proud of the last
  const m = 0.06 * Math.min(w, h), n = 2 + (r() < 0.5 ? 1 : 0);
  let yy = y1 - m;
  for (let k = 0; k < n; k++) {
    const hh = (h - 2 * m - (n - 1) * m * 0.6) * (k === n - 1 ? 1 : 0.3 + r() * 0.35), top = yy, bot = Math.max(y0 + m, yy - hh);
    const col = pal[k % 2];
    onWall(K, L, wall, a0 + m, a1 - m, 0.05, 0.052 + k * 0.001, bot, top, col, 0.96 + r() * 0.08, { t: 'roomCanvas', c: col }, MATTE);
    yy = bot - m * 0.6;
    if (yy <= y0 + m) break;
  }
}
// A RUN OF MIRROR on a wall: `at` along it, `w` wide, from `y0` to `y1`, in panels with a fine joint. It doesn't
// reflect the room; it's a pale polished sheet that takes the lamps' highlights, which is what a mirror does at a glance.
function mirror(K, L, c, { H }) {
  const wall = ['front', 'back', 'left', 'right'].includes(c.wall) ? c.wall : 'left', a = num(c.at, 0), w = num(c.w, 2, 0.4, 30), y0 = num(c.y0, 0.15, 0, H - 0.5), y1 = num(c.y1, H - 0.3, y0 + 0.3, H);
  const n = Math.max(1, Math.round(w / 1.2)), pw = w / n;
  onWall(K, L, wall, a - w / 2 - 0.02, a + w / 2 + 0.02, 0.018, 0.024, y0 - 0.02, y1 + 0.02, '#2a2d31', 1, null, METAL);
  for (let i = 0; i < n; i++) onWall(K, L, wall, a - w / 2 + i * pw + 0.004, a - w / 2 + (i + 1) * pw - 0.004, 0.024, 0.03, y0, y1, '#b9c6cf', 1.12, null, METAL);
}
// A LANDING PAD painted on a deck: a ring, a letter H inside it and a ring of lamps let into the deck round it.
// { at: [u, v], r, hex, lamp }
function landingPad(K, L, c, { lampOn }) {
  if (!Array.isArray(c.at) || c.at.length !== 2 || !c.at.every(Number.isFinite)) return;
  const [cu, cv] = c.at, R = num(c.r, 5, 1.5, 14), hex = hex6(c.hex, '#e8e2d2'), y = 0.003;
  const ring = (r0, r1, col, k, surf) => { const n = 72; for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, P = (a, r) => [cu + Math.cos(a) * r, cv + Math.sin(a) * r, y]; K.quad(K.solid, [P(a0, r1), P(a1, r1), P(a1, r0), P(a0, r0)], [0, 1, 0], K.C(col, k), surf); } };
  ring(R - 0.28, R, hex, 1, MATTE);
  ring(R * 0.62, R * 0.62 + 0.12, hex6(c.line, '#e0a020'), 1, MATTE);
  const s = R * 0.3, t = R * 0.07;
  for (const [u0, u1, v0, v1] of [[cu - s, cu - s + 2 * t, cv - s * 1.25, cv + s * 1.25], [cu + s - 2 * t, cu + s, cv - s * 1.25, cv + s * 1.25], [cu - s, cu + s, cv - t, cv + t]]) K.box(u0, u1, v0, v1, 0.0005, y + 0.001, hex, 1, null, MATTE);
  const n = 16, lit = lampOn ? hex6(c.lamp, '#7dffb0') : '#3a5a48';
  for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * Math.PI * 2; K.lathe(cu + Math.cos(a) * (R + 0.35), cv + Math.sin(a) * (R + 0.35), [[0, 0.012], [0.07, 0.012], [0.09, 0.001]], lit, lampOn ? 2 : 1, 10, lampOn ? GLOW : undefined); }
}
// A DOOR THAT DOESN'T GO ANYWHERE YOU CAN: a leaf shut in a bronze frame with a push plate, and a plaque
// beside it lettered with what's behind it (STAIRS, SERVICE). The room text says it's there and locked.
function shutDoor(K, L, c, { DH }) {
  const wall = ['front', 'back', 'left', 'right'].includes(c.wall) ? c.wall : 'back', a = num(c.at, 0), w = num(c.w, 0.95, 0.6, 2.4), a0 = a - w / 2, a1 = a + w / 2;
  const leaf = c.finish === 'steel' ? { hex: '#4a4e52', tex: null, surf: METAL } : { hex: '#5a3a26', tex: WALNUT, surf: SATIN };
  for (const [p0, p1, q0, q1] of [[a0 - 0.06, a0, 0, DH + 0.06], [a1, a1 + 0.06, 0, DH + 0.06], [a0 - 0.06, a1 + 0.06, DH, DH + 0.06]]) onWall(K, L, wall, p0, p1, 0.02, 0.07, q0, q1, BRONZE, 1.05, null, METAL);
  onWall(K, L, wall, a0, a1, 0.02, 0.05, 0.004, DH, leaf.hex, 1, leaf.tex, leaf.surf);
  // a push plate and a kick plate, on the side away from the hinge
  const s = toward(wall), pa = a + s * (w / 2 - 0.12);
  onWall(K, L, wall, pa - 0.04, pa + 0.04, 0.05, 0.056, 0.95, 1.35, BRASS, 1.08, null, METAL);
  onWall(K, L, wall, a0 + 0.03, a1 - 0.03, 0.05, 0.054, 0.02, 0.22, BRONZE, 1.02, null, METAL);
  if (c.label) {
    const txt = String(c.label).toUpperCase().slice(0, 14), h = 0.04, pw = legendWidth(txt, h) + 0.08, la = a + s * (w / 2 + 0.12 + pw / 2);
    onWall(K, L, wall, la - pw / 2, la + pw / 2, 0.02, 0.032, 1.5, 1.62, BRONZE, 1.05, null, METAL);
    letter(K, L, wall, txt, la, 1.56, h, 0.0335, '#120c06');
  }
}
// A NUMBER BESIDE A DOORWAY: a small bronze plate at eye height on the side a hand would reach for,
// lettered in dark relief. `plaques` maps the zone a doorway leads to onto what it says.
function plaques(K, L, map) {
  for (const o of L.spec.openings || []) {
    const txt = map?.[o.to];
    if (!txt || !o.wall) continue;
    // ⚠ OVER THE DOOR'S READER, CENTRED ON IT (gl/room-lock.js). Beside the doorway at eye height is where the
    // hololock's card hangs, and the card covered the name. A long name is set smaller, to stay clear of the doorway.
    const t = String(txt).toUpperCase().slice(0, 10), full = legendWidth(t, 0.05) + 0.1, k = Math.min(1, 0.5 / full);
    const h = 0.05 * k, pw = full * k, la = readerAlong(L, o), y = CARD_TOP + 0.06;
    onWall(K, L, o.wall, la - pw / 2, la + pw / 2, 0.02, 0.034, y, y + 0.14, BRASS, 1.05, null, METAL);
    letter(K, L, o.wall, t, la, y + 0.07, h, 0.0345, '#1c1206');
  }
}

// THE LIFT AT A LANDING (any doorway with `lift`): a bronze architrave round the doors, a black glass
// indicator over them with an amber arrow lit, and a call plate beside them with its button lit.
export function liftPortal(K, L, o, { DH, H, lampOn }) {
  const s = toward(o.wall), m = (o.a + o.b) / 2, top = Math.min(H - 0.12, DH + 0.24);
  for (const [p0, p1] of [[o.a - 0.16, o.a - 0.005], [o.b + 0.005, o.b + 0.16]]) onWall(K, L, o.wall, p0, p1, 0.005, 0.06, 0, top, BRONZE, 1.08, null, METAL);
  onWall(K, L, o.wall, o.a - 0.16, o.b + 0.16, 0.005, 0.06, DH + 0.005, top, BRONZE, 1.08, null, METAL);
  // a fine reeded line on the architrave's face
  for (const p of [o.a - 0.09, o.b + 0.09]) onWall(K, L, o.wall, p - 0.006, p + 0.006, 0.06, 0.066, 0.12, top - 0.04, '#c8a46a', 1.15, null, METAL);
  if (top + 0.3 < H) {
    onWall(K, L, o.wall, m - 0.32, m + 0.32, 0.005, 0.03, top + 0.08, top + 0.26, '#0b0a09', 1, null, GLOSS);
    const out = outOf(K, o.wall), y = top + 0.17, col = K.C(lampOn ? '#ffb040' : '#6a4a20', lampOn ? 2.2 : 1);
    // two arrows, the up one lit: drawn as flat triangles on the glass
    for (const [da, up] of [[-0.07, true], [0.07, false]]) {
      const [cu, cv] = wallPt(L, o.wall, m + s * da, 0.032), w = 0.035, h = up ? 0.045 : -0.045;
      const side = o.wall === 'front' || o.wall === 'back' ? [1, 0] : [0, 1];
      const p0 = [cu - side[0] * w, cv - side[1] * w, y - h / 2], p1 = [cu + side[0] * w, cv + side[1] * w, y - h / 2], tip = [cu, cv, y + h / 2];
      K.quad(K.solid, up ? [p0, p1, tip, tip] : [p1, p0, tip, tip], out, up ? col : K.C('#3a2a14', 1), up ? GLOW : MATTE, null, true);
    }
  }
  // the call plate on the reaching side, its button lit
  const pa = (s > 0 ? o.b : o.a) + s * 0.3;
  onWall(K, L, o.wall, pa - 0.05, pa + 0.05, 0.005, 0.016, 0.98, 1.32, '#9ea3a8', 1.1, null, METAL);
  for (const [y, lit] of [[1.21, true], [1.09, false]]) {
    onWall(K, L, o.wall, pa - 0.022, pa + 0.022, 0.016, 0.026, y - 0.022, y + 0.022, lit && lampOn ? '#ffcf70' : '#c9ccd0', lit && lampOn ? 1.6 : 1, null, lit && lampOn ? GLOW : METAL);
  }
}

// ── a tower flat's balcony (room-layout.js balconyDressOf) ────────────────────────────────────────
// A long charcoal planter of grasses and clipped box balls, a slatted oak bench on two black steel
// frames, and a fig in an urn past it.
function trough(K, [a, b, c, e], seed) {
  const r = rng(seed), H = 0.55;
  K.box(a, b, c, e, 0, H, '#2c2d30', 1, null, SATIN);
  K.box(a + 0.03, b - 0.03, c + 0.03, e - 0.03, H, H + 0.006, '#2a1e16', 0.9);
  const greens = ['#5f7a3a', '#6e8a44', '#8a9a52', '#b4a868'], vm = (c + e) / 2;
  for (let u = a + 0.16; u < b - 0.1; u += 0.26) {
    if (r() < 0.3) { K.ball(u, vm + (r() - 0.5) * 0.08, H + 0.12, 0.15 + r() * 0.03, '#34502a', 1, 12, SATIN); continue; }
    for (let i = 0; i < 12; i++) {
      const ang = r() * Math.PI * 2, el = 1.05 + r() * 0.4, len = 0.45 + r() * 0.3;
      const st = [u + (r() - 0.5) * 0.06, vm + (r() - 0.5) * 0.08, H + 0.004];
      leaf(K, st, [Math.cos(ang) * Math.cos(el), Math.sin(ang) * Math.cos(el), Math.sin(el)], [-Math.sin(ang), Math.cos(ang), 0], len, 0.03, greens[i % greens.length], 0.95 + r() * 0.15, 0.3);
    }
  }
}
function balconyBench(K, [a, b, c, e]) {
  const steel = '#141518', y0 = 0.41, y1 = 0.45, n = 5, g = 0.012, sw = (e - c - g * (n - 1)) / n;
  for (let i = 0; i < n; i++) { const v0 = c + i * (sw + g); K.box(a, b, v0, v0 + sw, y0, y1, '#c4955f', 1, { t: 'roomWood', c: '#c4955f' }, SATIN); }
  // each frame a flat bar bent into a closed rectangle, standing in from the ends
  for (const u of [a + 0.16, b - 0.22]) {
    K.box(u, u + 0.06, c + 0.02, e - 0.02, y0 - 0.025, y0, steel, 1, null, METAL);
    K.box(u, u + 0.06, c + 0.02, e - 0.02, 0, 0.02, steel, 1, null, METAL);
    for (const [v0, v1] of [[c + 0.02, c + 0.045], [e - 0.045, e - 0.02]]) K.box(u, u + 0.06, v0, v1, 0, y0, steel, 1, null, METAL);
  }
}
export function drawBalconyDress(K, L) {
  const bd = balconyDressOf(L.spec);
  if (!bd) return;
  bd.troughs.forEach((t, i) => trough(K, t, 0x7a11 + i * 313));
  if (bd.bench) balconyBench(K, bd.bench);
  if (bd.urn) plant(K, bd.urn[0], bd.urn[1], bd.urn[2], 0xba1d); // odd seed: the fig, whose crown stays off the glass (a palm's fronds went through it)
}

// ── the whole finish ──────────────────────────────────────────────────────────────────────────────
// ctx: { H, D, hu, T, DH, lampOn, lamps, runs (each wall's solid runs), fine, accent, TEX (the textures' repeats) }
export function drawDecor(K, L, ctx) {
  const dc = L.spec.decor || {};
  for (const c of [].concat(dc.walls || [])) if (c && typeof c === 'object') clad(K, L, ctx.runs, c, ctx);
  if (dc.ceiling && typeof dc.ceiling === 'object') ceiling(K, L, dc.ceiling, ctx);
  if (dc.floor && typeof dc.floor === 'object') floorInlay(K, L, dc.floor, ctx);
  if (dc.runner && typeof dc.runner === 'object') runner(K, L, dc.runner, ctx);
  for (const c of dc.lights || []) if (Array.isArray(c?.at) && c.at.length === 2 && c.at.every(Number.isFinite)) chandelier(K, L, c, ctx);
  if (dc.sconces && typeof dc.sconces === 'object') sconces(K, L, ctx.runs, dc.sconces, ctx);
  for (const c of dc.columns || []) if (Array.isArray(c) && c.length >= 2) column(K, c[0], c[1], c[2] || 0.3, { H: ctx.H, hex: hex6(dc.columnHex, '#f2ece2') });
  (dc.plants || []).forEach((c, i) => { if (Array.isArray(c) && c.length >= 2) plant(K, c[0], c[1], c[2] || 1, 0x51ed + i * 977); });
  (dc.art || []).forEach((c, i) => { if (c && typeof c === 'object') picture(K, L, c, i); });
  for (const c of dc.mirrors || []) if (c && typeof c === 'object') mirror(K, L, c, ctx);
  if (dc.pad && typeof dc.pad === 'object') landingPad(K, L, dc.pad, ctx);
  for (const c of dc.doors || []) if (c && typeof c === 'object') shutDoor(K, L, c, ctx);
  if (dc.plaques && typeof dc.plaques === 'object') plaques(K, L, dc.plaques);
  facility(K, L, dc, ctx);
  // an old bar's: neon, pendants, fans, photographs, darts, a payphone, what's on the floor (gl/room-saloon.js)
  drawSaloonDecor(K, L, dc, ctx);
}

// ── A working building's dressing (a clone facility, a plant room) ───────────────────────────────────
// All of it is placed by the room's content file (flags.room.decor), none of it knows whose building it is:
//   strips  [{ at: [u, v], len, along: 'u'|'v', cage? }]     ceiling lights: a lit tube in a housing, or a caged bulkhead
//   pipes   [{ from: [u, v, y], to: [u, v, y], r, hex? }]     a straight run of pipe, flanged at each end
//   drops   [{ wall, along, n, r?, into? }]                   a bundle of cables down a wall from the ceiling, into the slab if `into`
//   paint   [{ kind: 'hazard'|'line'|'arrow'|'box', ... }]    floor markings: a striped band round a rect, a line, an arrow, an outline
//   grates  [[u, v, w, d]]                                    a drain or a walkway grating let into the floor
//   screens [{ wall, along, y, w, h, show }]                  a lit wall screen: 'vitals', 'ad' (with `text`), 'gauges' or 'status'
//   signs   [{ wall, along, y, text, h?, hex?, lit?, plate? }]  lettering on a wall, on its own plate or straight on the paint
//   pumps   [[u, v, turn?]]                                   a pump on a plinth, motor and volute
//   lamps   [{ wall, along, y, hex? }]                        a small warning lamp in a cage on a wall
const HAZ_A = '#e8b818', HAZ_B = '#1a1a1a';
function floorBox(K, u0, u1, v0, v1, hex, k = 1, surf = MATTE, y = 0.004) { K.box(Math.min(u0, u1), Math.max(u0, u1), Math.min(v0, v1), Math.max(v0, v1), 0.001, y, hex, k, null, surf); }
function hazardBand(K, [u0, u1, v0, v1], t = 0.12) {
  // diagonal stripes read as stripes from a standing eye if they're short dashes along the band
  const dash = (a0, a1, b0, b1, along) => {
    const len = along === 'u' ? a1 - a0 : b1 - b0, n = Math.max(2, Math.round(len / 0.14));
    for (let i = 0; i < n; i++) {
      const s0 = i / n, s1 = (i + 1) / n, hex = i % 2 ? HAZ_B : HAZ_A;
      if (along === 'u') floorBox(K, a0 + (a1 - a0) * s0, a0 + (a1 - a0) * s1, b0, b1, hex, hex === HAZ_A ? 1.05 : 1, SATIN);
      else floorBox(K, a0, a1, b0 + (b1 - b0) * s0, b0 + (b1 - b0) * s1, hex, hex === HAZ_A ? 1.05 : 1, SATIN);
    }
  };
  dash(u0, u1, v0, v0 + t, 'u'); dash(u0, u1, v1 - t, v1, 'u');
  dash(u0, u0 + t, v0 + t, v1 - t, 'v'); dash(u1 - t, u1, v0 + t, v1 - t, 'v');
}
function floorArrow(K, [u, v], [du, dv], hex, s = 0.5) {
  const l = Math.hypot(du, dv) || 1, fu = du / l, fv = dv / l, ru = -fv, rv = fu, w = 0.06 * s / 0.5;
  const pt = (a, b) => [u + fu * a + ru * b, v + fv * a + rv * b, 0.005];
  K.quad(K.solid, [pt(-s / 2, -w), pt(s * 0.15, -w), pt(s * 0.15, w), pt(-s / 2, w)], K.nrmOf(0, 1, 0), K.C(hex, 1.1), SATIN, null, true);
  K.quad(K.solid, [pt(s * 0.15, -w * 3), pt(s / 2, 0), pt(s / 2, 0), pt(s * 0.15, w * 3)], K.nrmOf(0, 1, 0), K.C(hex, 1.1), SATIN, null, true);
}
function screenOn(K, L, s, lampOn) {
  const { wall, along: a, y, w = 0.6, h = 0.36, show = 'status' } = s;
  // the bezel, the glass, then what's on it, all a hair proud of the wall
  onWall(K, L, wall, a - w / 2 - 0.03, a + w / 2 + 0.03, 0.005, 0.045, y - h / 2 - 0.03, y + h / 2 + 0.03, '#1b1e22', 1, null, SATIN);
  const bg = show === 'ad' ? '#2a0a24' : show === 'gauges' ? '#0d1410' : '#06120c';
  onWall(K, L, wall, a - w / 2, a + w / 2, 0.045, 0.05, y - h / 2, y + h / 2, bg, 1.4, null, GLOW);
  const lit = (a0, a1, y0, y1, hex, k = 2) => onWall(K, L, wall, a0, a1, 0.05, 0.054, y0, y1, hex, lampOn ? k : k * 0.8, null, GLOW);
  if (show === 'vitals') {
    // a trace across it with one beat in it, a number under it
    const n = 24;
    for (let i = 0; i < n; i++) {
      const t = i / n, x = a - w / 2 + 0.03 + t * (w - 0.06), beat = Math.abs(t - 0.55) < 0.04 ? (t < 0.55 ? 1 : -0.6) : 0;
      lit(x, x + (w - 0.06) / n, y + 0.02 + beat * h * 0.3 - 0.006, y + 0.02 + beat * h * 0.3 + 0.006, '#4dff9a');
    }
    lit(a - w / 2 + 0.04, a - w / 2 + 0.2, y - h / 2 + 0.04, y - h / 2 + 0.08, '#4dff9a', 1.6);
    lit(a + w / 2 - 0.12, a + w / 2 - 0.04, y + h / 2 - 0.08, y + h / 2 - 0.04, '#ffcf4a', 1.8);
  } else if (show === 'gauges') {
    for (let i = 0; i < 3; i++) {
      const x = a - w / 2 + (i + 0.5) * w / 3, k = [0.7, 0.45, 0.9][i];
      lit(x - 0.04, x + 0.04, y - h / 2 + 0.05, y - h / 2 + 0.05 + (h - 0.1) * k, k > 0.85 ? '#ff4a3a' : '#5ae08a', 1.8);
    }
  } else if (show === 'ad') {
    lit(a - w / 2 + 0.03, a + w / 2 - 0.03, y - h / 2 + 0.03, y - h / 2 + 0.05, '#ff4fd8', 2.2);
    // each line as big as fits across the glass
    const fit = (t, cap) => Math.min(cap, (w - 0.16) / Math.max(0.01, legendWidth(String(t).toUpperCase(), 1)));
    if (s.text) letter(K, L, wall, s.text, a, y + h * 0.08, fit(s.text, h * 0.3), 0.056, '#ffd6f6', 1);
    if (s.sub) letter(K, L, wall, s.sub, a, y - h * 0.24, fit(s.sub, h * 0.11), 0.056, '#9be7ff', 1);
  } else {
    for (let i = 0; i < 4; i++) lit(a - w / 2 + 0.04, a - w / 2 + 0.04 + (w - 0.08) * [0.8, 0.55, 0.7, 0.4][i], y + h / 2 - 0.07 - i * 0.07, y + h / 2 - 0.05 - i * 0.07, i === 0 ? '#9be7ff' : '#5fa8c0', 1.6);
  }
}
function facility(K, L, dc, { H, lampOn }) {
  for (const s of dc.strips || []) {
    if (!Array.isArray(s?.at)) continue;
    const [u, v] = s.at, len = s.len || 1.2, U = s.along === 'u', hu = U ? len / 2 : 0.09, hv = U ? 0.09 : len / 2;
    if (s.cage) {
      // a bulkhead: a cast body on the ceiling, a lit lens, a wire cage over it
      K.box(u - 0.14, u + 0.14, v - 0.09, v + 0.09, H - 0.08, H, '#3a3f44', 1, null, METAL);
      K.box(u - 0.11, u + 0.11, v - 0.065, v + 0.065, H - 0.1, H - 0.08, lampOn ? '#fff4d8' : '#bdb8a8', lampOn ? 2.2 : 0.8, null, lampOn ? LAMP : MATTE);
      for (const x of [-0.1, -0.035, 0.035, 0.1]) K.box(u + x - 0.004, u + x + 0.004, v - 0.075, v + 0.075, H - 0.13, H - 0.1, '#2a2d30', 1, null, METAL);
      continue;
    }
    K.box(u - hu - 0.02, u + hu + 0.02, v - hv - 0.02, v + hv + 0.02, H - 0.07, H, '#d6dade', 1.04, null, METAL);
    K.box(u - hu, u + hu, v - hv, v + hv, H - 0.075, H - 0.07, lampOn ? '#f4fbff' : '#c8ccd0', lampOn ? 2.4 : 0.8, null, lampOn ? LAMP : MATTE);
  }
  for (const p of dc.pipes || []) {
    if (!Array.isArray(p?.from) || !Array.isArray(p?.to)) continue;
    const r = p.r || 0.06, hex = p.hex || '#7d868e';
    rod(K, p.from, p.to, r, hex, 1.02, METAL);
    for (const e of [p.from, p.to]) K.lathe(e[0], e[1], [[0, e[2] - 0.02], [r + 0.03, e[2] - 0.02], [r + 0.03, e[2] + 0.02], [0, e[2] + 0.02]], '#5a6268', 1, 14, METAL);
    // brackets to the ceiling every two metres along a level run
    if (Math.abs(p.from[2] - p.to[2]) < 0.01 && p.from[2] < H - 0.05) {
      const len = Math.hypot(p.to[0] - p.from[0], p.to[1] - p.from[1]), n = Math.floor(len / 2);
      for (let i = 1; i <= n; i++) { const t = i / (n + 1), u = p.from[0] + (p.to[0] - p.from[0]) * t, v = p.from[1] + (p.to[1] - p.from[1]) * t; K.box(u - 0.015, u + 0.015, v - 0.015, v + 0.015, p.from[2] + r, H, '#3a3f44', 1, null, METAL); }
    }
  }
  for (const d of dc.drops || []) {
    if (!d?.wall) continue;
    const n = d.n || 5, r = d.r || 0.035, s = toward(d.wall), r0 = mulberry(Math.round((d.along || 0) * 100) + 7);
    for (let i = 0; i < n; i++) {
      const a = d.along + s * (i - (n - 1) / 2) * r * 2.1, off = r + 0.01 + (i % 2) * r * 0.6, sag = 0.02 + r0() * 0.03;
      const [u0, v0] = wallPt(L, d.wall, a, off), [u1, v1] = wallPt(L, d.wall, a + (r0() - 0.5) * 0.04, off + sag);
      const hex = ['#1c1c1e', '#2b2b2e', '#3a2a1c', '#202a20'][i % 4];
      rod(K, [u0, v0, H], [u1, v1, H * 0.55], r, hex, 1, SATIN);
      rod(K, [u1, v1, H * 0.55], [u0, v0, d.into ? -0.05 : 0.05], r, hex, 1, SATIN);
    }
    // the clamps holding the bundle to the wall
    for (const y of [H - 0.4, H * 0.55, 0.6]) onWall(K, L, d.wall, d.along - n * r * 1.15, d.along + n * r * 1.15, 0, r * 2.4 + 0.02, y - 0.025, y + 0.025, '#4a5056', 1, null, METAL);
    if (d.into) { const [cu, cv] = wallPt(L, d.wall, d.along, r * 1.3); K.box(cu - n * r * 1.2, cu + n * r * 1.2, cv - r * 1.6, cv + r * 1.6, 0, 0.03, '#565350', 1, null, MATTE); }
  }
  for (const m of dc.paint || []) {
    if (!m) continue;
    const hex = m.hex || HAZ_A;
    if (m.kind === 'hazard' && Array.isArray(m.rect)) hazardBand(K, m.rect, m.t || 0.12);
    else if (m.kind === 'box' && Array.isArray(m.rect)) { const [u0, u1, v0, v1] = m.rect, t = m.t || 0.05; floorBox(K, u0, u1, v0, v0 + t, hex); floorBox(K, u0, u1, v1 - t, v1, hex); floorBox(K, u0, u0 + t, v0, v1, hex); floorBox(K, u1 - t, u1, v0, v1, hex); }
    else if (m.kind === 'line' && Array.isArray(m.from) && Array.isArray(m.to)) {
      const [a, b] = [m.from, m.to], t = (m.t || 0.06) / 2, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nu = -(b[1] - a[1]) / l * t, nv = (b[0] - a[0]) / l * t;
      K.quad(K.solid, [[a[0] - nu, a[1] - nv, 0.004], [b[0] - nu, b[1] - nv, 0.004], [b[0] + nu, b[1] + nv, 0.004], [a[0] + nu, a[1] + nv, 0.004]], K.nrmOf(0, 1, 0), K.C(hex, 1.05), SATIN, null, true);
      if (m.arrows) { const n = Math.max(1, Math.floor(l / 1.6)); for (let i = 1; i <= n; i++) { const t2 = i / (n + 1); floorArrow(K, [a[0] + (b[0] - a[0]) * t2, a[1] + (b[1] - a[1]) * t2], [b[0] - a[0], b[1] - a[1]], hex, 0.45); } }
    } else if (m.kind === 'arrow' && Array.isArray(m.at) && Array.isArray(m.dir)) floorArrow(K, m.at, m.dir, hex, m.s || 0.6);
  }
  for (const g of dc.grates || []) {
    if (!Array.isArray(g) || g.length < 4) continue;
    const [u, v, w, d] = g;
    K.box(u - w / 2, u + w / 2, v - d / 2, v + d / 2, -0.02, 0.003, '#121314', 1, null, MATTE);
    const along = w >= d, n = Math.max(3, Math.round((along ? w : d) / 0.045));
    for (let i = 0; i <= n; i++) {
      const t = -0.5 + i / n;
      if (along) K.box(u + t * w - 0.008, u + t * w + 0.008, v - d / 2, v + d / 2, -0.005, 0.006, '#5d6266', 1, null, METAL);
      else K.box(u - w / 2, u + w / 2, v + t * d - 0.008, v + t * d + 0.008, -0.005, 0.006, '#5d6266', 1, null, METAL);
    }
    K.box(u - w / 2 - 0.02, u + w / 2 + 0.02, v - d / 2 - 0.02, v - d / 2, 0, 0.006, '#6d7276', 1, null, METAL);
    K.box(u - w / 2 - 0.02, u + w / 2 + 0.02, v + d / 2, v + d / 2 + 0.02, 0, 0.006, '#6d7276', 1, null, METAL);
  }
  for (const s of dc.screens || []) if (s?.wall) screenOn(K, L, s, lampOn);
  for (const s of dc.signs || []) {
    if (!s?.wall || !s.text) continue;
    const h = s.h || 0.12, t = String(s.text).toUpperCase(), wd = legendWidth(t, h);
    if (s.plate !== false) onWall(K, L, s.wall, s.along - wd / 2 - h * 0.6, s.along + wd / 2 + h * 0.6, 0.005, 0.03, s.y - h * 0.9, s.y + h * 0.9, s.plateHex || '#1b1e22', 1, null, SATIN);
    letter(K, L, s.wall, t, s.along, s.y, h, s.plate !== false ? 0.031 : 0.006, s.hex || '#e8eef2', s.lit ? 1 : 0);
  }
  for (const p of dc.pumps || []) {
    if (!Array.isArray(p)) continue;
    const [u, v] = p;
    K.box(u - 0.45, u + 0.45, v - 0.3, v + 0.3, 0, 0.12, '#4a4743', 1, null, MATTE);
    K.box(u - 0.4, u + 0.05, v - 0.18, v + 0.18, 0.12, 0.5, '#2f5a7a', 1, null, SATIN);
    for (let i = 0; i < 6; i++) K.box(u - 0.38 + i * 0.07, u - 0.35 + i * 0.07, v - 0.19, v + 0.19, 0.16, 0.46, '#284c68', 1, null, SATIN);
    K.lathe(u + 0.22, v, [[0, 0.12], [0.2, 0.12], [0.24, 0.3], [0.2, 0.5], [0, 0.52]], '#7d868e', 1, 20, METAL);
    rod(K, [u + 0.22, v, 0.5], [u + 0.22, v, H - 0.3], 0.06, '#7d868e', 1, METAL);
    K.box(u - 0.02, u + 0.08, v - 0.05, v + 0.05, 0.28, 0.34, '#1b1e22', 1, null, SATIN);
  }
  for (const l of dc.lamps || []) {
    if (!l?.wall) continue;
    const hex = l.hex || '#ff3a2a';
    onWall(K, L, l.wall, l.along - 0.06, l.along + 0.06, 0, 0.03, l.y - 0.06, l.y + 0.06, '#2a2d30', 1, null, METAL);
    onWall(K, L, l.wall, l.along - 0.04, l.along + 0.04, 0.03, 0.09, l.y - 0.04, l.y + 0.04, hex, lampOn ? 2.4 : 1.8, null, GLOW);
    for (const y of [-0.045, 0, 0.045]) onWall(K, L, l.wall, l.along - 0.05, l.along + 0.05, 0.09, 0.1, l.y + y - 0.004, l.y + y + 0.004, '#202224', 1, null, METAL);
  }
}
function mulberry(a) { return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }


// ── the forms a hotel's furniture needs ───────────────────────────────────────────────────────────
// Called from room-mesh.js drawPiece with the piece's own frame; true when it drew the piece.
export function drawDecorForm(K, F, p) {
  const { P, pbox } = F, w = p.w, d = p.d, h = p.h, hw = w / 2, hd = d / 2;
  const marble = { t: 'roomMarble', c: '#f4efe6' }, dress = p.dress || '';
  switch (p.form) {
    case 'reception': {
      // a recessed dark plinth with a warm light along its toe, a fluted bronze front, marble ends and a
      // marble top on a gold band; behind, a lower walnut worktop for whoever's on the desk
      pbox(-hw + 0.06, hw - 0.06, 0, 0.09, -hd + 0.04, hd - 0.07, '#141110', 1, null, GLOSS);
      pbox(-hw + 0.08, hw - 0.08, 0.025, 0.04, hd - 0.075, hd - 0.066, '#ffd9a0', 1.7, null, GLOW);
      pbox(-hw + 0.06, hw - 0.06, 0.09, h - 0.07, -hd + 0.04, hd - 0.06, '#2a2420', 1, null, SATIN);
      const n = Math.max(8, Math.round((w - 0.2) / 0.05)), fw = (w - 0.2) / n;
      for (let i = 0; i < n; i++) { const x = -hw + 0.1 + i * fw; pbox(x + 0.003, x + fw - 0.003, 0.09, h - 0.08, hd - 0.06, hd - (i % 2 ? 0.045 : 0.035), i % 2 ? '#7a5a3a' : '#a07c52', i % 2 ? 0.92 : 1.12, null, METAL); }
      for (const s of [-1, 1]) pbox(s < 0 ? -hw : hw - 0.08, s < 0 ? -hw + 0.08 : hw, 0, h - 0.05, -hd, hd, '#ffffff', 1.04, marble, GLOSS);
      pbox(-hw, hw, h - 0.085, h - 0.05, -hd + 0.02, hd - 0.02, GOLD, 1.08, null, METAL);
      pbox(-hw - 0.03, hw + 0.03, h - 0.05, h, -hd - 0.02, hd + 0.05, '#ffffff', 1.06, marble, GLOSS);
      pbox(-hw + 0.1, hw - 0.1, 0.72, 0.76, -hd - 0.38, -hd + 0.02, '#5a3a26', 1, WALNUT, SATIN);
      // a brass desk lamp at one end and a bell at the other
      const [lu, lv] = P(hw - 0.35, 0, 0.05);
      K.lathe(lu, lv, [[0, h], [0.07, h], [0.07, h + 0.015], [0.012, h + 0.03], [0.012, h + 0.36], [0, h + 0.36]], BRASS, 1.08, 16, METAL);
      K.lathe(lu, lv, [[0.12, h + 0.3], [0.06, h + 0.44], [0, h + 0.45]], '#1d3a2c', 1, 18, GLOSS);
      K.lathe(lu, lv, [[0, h + 0.302], [0.118, h + 0.302]], '#fff0d0', 2, 16, LAMP);
      const [bu, bv] = P(-hw + 0.4, 0, 0.1);
      K.lathe(bu, bv, [[0, h], [0.045, h], [0.045, h + 0.008], [0, h + 0.008]], '#2a2420', 1, 14);
      K.ball(bu, bv, h + 0.02, 0.035, BRASS, 1.1, 12, METAL);
      return true;
    }
    case 'console': {
      // a slim marble top on two bronze trestles and a stretcher, dressed with what the row says
      const blk = p.tone === 'black', BR = blk ? '#1c1c1e' : BRONZE, BRD = blk ? '#0e0e10' : BRONZE_DARK; // tone 'black': nero marble on blackened steel
      pbox(-hw, hw, h - 0.035, h, -hd, hd, blk ? '#2a2a2c' : '#ffffff', 1.05, blk ? { t: 'roomMarble', c: '#1a1a1c' } : marble, GLOSS);
      for (const s of [-1, 1]) {
        const x = s * (hw - 0.12);
        pbox(x - 0.015, x + 0.015, 0, h - 0.035, -hd + 0.04, -hd + 0.07, BR, 1.06, null, METAL);
        pbox(x - 0.015, x + 0.015, 0, h - 0.035, hd - 0.07, hd - 0.04, BR, 1.06, null, METAL);
        pbox(x - 0.015, x + 0.015, h - 0.07, h - 0.035, -hd + 0.04, hd - 0.04, BR, 1.06, null, METAL);
        pbox(x - 0.04, x + 0.04, 0, 0.012, -hd + 0.03, hd - 0.03, BRD, 1, null, METAL);
      }
      pbox(-hw + 0.12, hw - 0.12, 0.16, 0.18, -hd + 0.06, hd - 0.06, BR, 1.02, null, METAL);
      dressTop(K, P, dress, h, hw);
      return true;
    }
    case 'plinth': {
      pbox(-hw, hw, 0, 0.05, -hd, hd, '#c8c2b6', 1, { t: 'roomStone', c: '#d8d2c6' }, SATIN);
      pbox(-hw + 0.03, hw - 0.03, 0.05, h - 0.04, -hd + 0.03, hd - 0.03, '#e8e2d6', 1.02, { t: 'roomStone', c: '#ece6da' }, SATIN);
      pbox(-hw, hw, h - 0.04, h, -hd, hd, '#c8c2b6', 1, { t: 'roomStone', c: '#d8d2c6' }, SATIN);
      dressTop(K, P, dress || 'orchid', h, 0);
      return true;
    }
    case 'slab': {
      // a stone seat on two bronze ends, a leather pad along it
      for (const s of [-1, 1]) pbox(s * (hw - 0.14) - 0.03, s * (hw - 0.14) + 0.03, 0, h - 0.07, -hd + 0.05, hd - 0.05, BRONZE, 1.05, null, METAL);
      pbox(-hw, hw, h - 0.07, h - 0.02, -hd, hd, '#ffffff', 1.02, { t: 'roomStone', c: '#d6d0c4' }, SATIN);
      K.rounded(...F.alongX(), -hw + 0.04, hw - 0.04, -hd + 0.04, hd - 0.04, h - 0.02, h + 0.05, 0.025, '#3a2a20', 1, LEATHER);
      return true;
    }
    // ── a club room's, a gym's and a roof deck's ─────────────────────────────────────────────────
    case 'piano': {
      // an upright in black lacquer: the case against the wall, a keybed on two legs, the fall open on its keys,
      // a music desk and three brass pedals
      const cz = -hd + Math.min(0.34, d * 0.52), black = '#0e0e10', ky = Math.min(0.72, h * 0.58);
      pbox(-hw, hw, 0, h - 0.03, -hd, cz, black, 1, null, GLOSS);
      pbox(-hw - 0.01, hw + 0.01, h - 0.03, h, -hd, cz + 0.02, black, 1.05, null, GLOSS);
      pbox(-hw, hw, ky - 0.1, ky, cz, hd - 0.04, black, 1, null, GLOSS);
      for (const s of [-1, 1]) pbox(s * (hw - 0.07) - 0.035, s * (hw - 0.07) + 0.035, 0, ky - 0.1, hd - 0.14, hd - 0.06, black, 1, null, GLOSS);
      // the keys: a white run with the blacks over it in twos and threes
      const k0 = -hw + 0.07, k1 = hw - 0.07, kz0 = cz + 0.03, kz1 = hd - 0.06, n = Math.max(14, Math.round((k1 - k0) / 0.024)), kw = (k1 - k0) / n;
      pbox(k0, k1, ky, ky + 0.012, kz0, kz1, '#f4f0e6', 1.04, null, GLOSS);
      for (let i = 0; i < n - 1; i++) { const o = i % 7; if (o === 2 || o === 6) continue; const x = k0 + (i + 1) * kw; pbox(x - kw * 0.3, x + kw * 0.3, ky + 0.012, ky + 0.024, kz0, kz0 + (kz1 - kz0) * 0.62, black, 1, null, SATIN); }
      pbox(-hw + 0.04, hw - 0.04, ky + 0.03, ky + 0.14, cz, cz + 0.012, black, 1.05, null, GLOSS);
      pbox(-0.32, 0.32, ky + 0.16, Math.min(h - 0.08, ky + 0.4), cz, cz + 0.014, '#17171a', 1, null, SATIN);
      for (const x of [-0.11, 0, 0.11]) pbox(x - 0.022, x + 0.022, 0.03, 0.045, cz, cz + 0.1, BRASS, 1.08, null, METAL);
      return true;
    }
    case 'boombox': {
      // a nineties twin-deck boombox done over in brushed titanium: a speaker each end behind a chrome
      // ring, a tape door between them under a strip of lit level bars, and a bent chrome handle on top
      const TI = '#9aa1a8', DARK = '#16181c', CH = '#e4e8ec', fz = hd;
      pbox(-hw, hw, 0.02, h - 0.05, -hd, hd, TI, 1.05, null, METAL);
      pbox(-hw + 0.02, hw - 0.02, 0, 0.02, -hd + 0.02, hd - 0.02, DARK, 1, null, SATIN);
      pbox(-hw - 0.006, hw + 0.006, h - 0.07, h - 0.05, -hd - 0.006, hd + 0.006, '#5ae0ff', 1.7, null, GLOW);
      pbox(-hw + 0.03, hw - 0.03, h - 0.05, h - 0.03, -hd + 0.03, hd - 0.03, DARK, 1, null, SATIN);
      const sr = Math.min(h * 0.36, w * 0.17);
      for (const s of [-1, 1]) {
        const x = s * (hw - sr - 0.035), y = 0.02 + (h - 0.07) * 0.48;
        rod(K, P(x, y, fz - 0.004), P(x, y, fz + 0.012), sr + 0.012, CH, 1.15, METAL);
        rod(K, P(x, y, fz + 0.004), P(x, y, fz + 0.014), sr, '#1c1e22', 1, MATTE);
        rod(K, P(x, y, fz + 0.006), P(x, y, fz + 0.02), sr * 0.55, '#2a2d33', 1, SATIN);
        rod(K, P(x, y, fz + 0.012), P(x, y, fz + 0.03), sr * 0.18, CH, 1.1, METAL);
      }
      // the tape doors, smoked glass with a cassette's two spools behind, and the transport keys under them
      const cw = hw - 2 * sr - 0.06;
      for (const s of [-1, 1]) {
        const x0 = s < 0 ? -cw : 0.006, x1 = s < 0 ? -0.006 : cw, ty = 0.02 + (h - 0.07) * 0.32;
        pbox(x0, x1, ty, ty + (h - 0.07) * 0.36, fz, fz + 0.006, '#20262c', 1, null, GLOSS);
        for (const t of [0.3, 0.7]) rod(K, P(x0 + (x1 - x0) * t, ty + (h - 0.07) * 0.18, fz + 0.002), P(x0 + (x1 - x0) * t, ty + (h - 0.07) * 0.18, fz + 0.008), 0.014, '#d8dcdf', 1.1, METAL);
        for (let i = 0; i < 4; i++) { const kx = x0 + (i + 0.5) * (x1 - x0) / 4; pbox(kx - 0.012, kx + 0.012, 0.035, 0.06, fz, fz + 0.014, i === 1 ? '#e8463a' : CH, 1.05, null, METAL); }
      }
      // the level meter: two rows of bars across the top of the face, lit
      const my = 0.02 + (h - 0.07) * 0.76;
      for (let i = 0; i < 14; i++) { const x = -cw + (i + 0.5) * (2 * cw) / 14, lit = i < 10; pbox(x - 0.006, x + 0.006, my, my + 0.012 + (i % 5) * 0.004, fz, fz + 0.004, i > 11 ? '#ff4f7a' : lit ? '#5ae0ff' : '#203038', lit ? 1.8 : 1, null, lit ? GLOW : MATTE); }
      // the handle, two posts and a bar
      for (const s of [-1, 1]) rod(K, P(s * (hw - 0.08), h - 0.03, 0), P(s * (hw - 0.1), h + 0.05, 0), 0.012, CH, 1.15, METAL);
      rod(K, P(-hw + 0.1, h + 0.05, 0), P(hw - 0.1, h + 0.05, 0), 0.014, CH, 1.15, METAL);
      return true;
    }
    case 'smoketable': {
      // a low drum table in black lacquer, set with a silver cigarette box open on a few smokes, a cedar
      // humidor, and a cut-glass ashtray with a cigar resting on its lip, still going
      const R = Math.min(hw, hd), top = h - 0.02, [u, v] = P(0, 0, 0);
      K.lathe(u, v, [[0, 0], [R * 0.9, 0], [R * 0.92, 0.03], [R * 0.86, top - 0.04], [R, top - 0.03], [R, top], [0, top]], '#141416', 1, 32, GLOSS);
      torus(K, u, v, R * 0.99, 0.008, top - 0.015, '#d8dcdf', 1.1);
      // the cigarette box, lid up at the back, filters showing
      const bx = -R * 0.45, bz = -R * 0.2;
      pbox(bx - 0.08, bx + 0.08, top, top + 0.04, bz - 0.05, bz + 0.05, '#d8dcdf', 1.15, null, METAL);
      pbox(bx - 0.08, bx + 0.08, top + 0.04, top + 0.13, bz - 0.058, bz - 0.05, '#d8dcdf', 1.15, null, METAL);
      for (let i = 0; i < 7; i++) { const x = bx - 0.066 + i * 0.022; rod(K, P(x, top + 0.042, bz - 0.04), P(x, top + 0.042, bz + 0.04), 0.0045, i % 2 ? '#d9a86a' : '#efe8dc', 1, MATTE); }
      // the humidor, a cedar box with a brass plate
      const hx = R * 0.35, hz = -R * 0.35;
      pbox(hx - 0.09, hx + 0.09, top, top + 0.07, hz - 0.06, hz + 0.06, '#8a4f2c', 1, WALNUT, GLOSS);
      pbox(hx - 0.025, hx + 0.025, top + 0.03, top + 0.045, hz + 0.06, hz + 0.062, BRASS, 1.1, null, METAL);
      // the ashtray, heavy glass, two butts in it and a cigar across one rest, its end lit
      const ax = R * 0.15, az = R * 0.35, [au, av] = P(ax, 0, az);
      K.lathe(au, av, [[0, top], [0.075, top], [0.08, top + 0.035], [0.06, top + 0.035], [0.055, top + 0.012], [0, top + 0.012]], '#cfe2ea', 1.25, 24, GLOSS);
      for (const [dx, dz, a] of [[-0.02, 0.01, 0.4], [0.015, -0.02, 2.1]]) rod(K, P(ax + dx, top + 0.016, az + dz), P(ax + dx + Math.cos(a) * 0.03, top + 0.018, az + dz + Math.sin(a) * 0.03), 0.004, '#d9a86a', 1, MATTE);
      const c0 = P(ax + 0.07, top + 0.04, az), c1 = P(ax - 0.06, top + 0.03, az + 0.02);
      rod(K, c0, c1, 0.009, '#5a3a22', 1, SATIN);
      rod(K, P(ax + 0.055, top + 0.039, az), P(ax + 0.068, top + 0.04, az), 0.0095, '#c9a24a', 1.05, METAL);
      K.ball(c1[0], c1[1], c1[2], 0.009, '#ff6a2a', 1.8, 8, GLOW);
      return true;
    }
    case 'telescope': {
      // a brass refractor on a wooden tripod, its tube tipped up at the far glass
      const top = h * 0.68, R = Math.min(hw, hd) - 0.04;
      for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 0.5; rod(K, P(0, top, 0), P(Math.sin(a) * R, 0, Math.cos(a) * R), 0.016, '#5a3a26', 1, SATIN); }
      const [cu, cv] = P(0, 0, 0);
      K.ball(cu, cv, top + 0.02, 0.045, BRASS, 1.08, 10, METAL);
      const e = P(0, top - 0.06, -hd + 0.04), o = P(0, Math.min(h - 0.05, top + 0.36), hd - 0.04);
      rod(K, e, o, 0.042, BRASS, 1.08, METAL);
      const m = (t) => e.map((x, i) => x + (o[i] - x) * t);
      rod(K, m(0.82), m(1), 0.052, BRASS, 1.12, METAL);
      rod(K, m(-0.12), m(0), 0.022, '#2a2420', 1, SATIN);
      rod(K, m(0.3), m(0.34), 0.05, BRONZE_DARK, 1, METAL);
      return true;
    }
    case 'games': {
      // a pedestal table with a chessboard let into its top, ebony and holly, and a game left on it
      const [cu, cv] = P(0, 0, 0), sq = Math.min(w, d) * 0.5 / 8, b0 = -sq * 4;
      K.lathe(cu, cv, [[0, 0], [0.24, 0], [0.24, 0.03], [0.07, 0.07], [0.045, 0.2], [0.045, h - 0.12], [0.1, h - 0.05], [0, h - 0.05]], WALNUT, 1, 18, SATIN);
      pbox(-hw, hw, h - 0.05, h, -hd, hd, '#5a3a26', 1, WALNUT, SATIN);
      // a game in play (plugins/gametable through plugins/roomstage): the real position, in Staunton pieces
      if (p.board) { drawChessBoard(K, F, h, Math.min(w, d) * 0.66, p.board); return true; }
      pbox(b0 - 0.015, -b0 + 0.015, h, h + 0.002, b0 - 0.015, -b0 + 0.015, BRASS, 1.05, null, METAL);
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) pbox(b0 + i * sq, b0 + (i + 1) * sq, h + 0.002, h + 0.004, b0 + j * sq, b0 + (j + 1) * sq, (i + j) % 2 ? '#1a1512' : '#eadfc6', 1, null, GLOSS);
      for (const [i, j, dark, tall] of [[4, 0, 0, 1], [3, 1, 0, 0], [5, 1, 0, 0], [2, 2, 0, 0], [6, 0, 0, 1], [4, 7, 1, 1], [4, 5, 1, 0], [3, 6, 1, 0], [1, 5, 1, 1], [6, 6, 1, 0]]) {
        const [pu, pv] = P(b0 + (i + 0.5) * sq, 0, b0 + (j + 0.5) * sq), r0 = sq * 0.32, ph = tall ? sq * 1.7 : sq * 1.1;
        K.lathe(pu, pv, [[r0, h + 0.004], [r0 * 0.5, h + 0.004 + ph * 0.5], [r0 * 0.7, h + 0.004 + ph * 0.8], [0, h + 0.004 + ph]], dark ? '#17120f' : '#f0e6cc', 1, 8, GLOSS);
      }
      return true;
    }
    case 'poker': {
      // a racetrack card table for six: two carved walnut pedestals on splayed brass-shod feet, a scalloped
      // apron, an oxblood padded rail round a walnut race with a brass line let in, green baize in the middle,
      // and the dealer's end dressed: a squared deck of cards beside a cut one, and a chip caddy
      const [x0, x1, z0, z1] = [-hw, hw, -hd, hd], R = hd, ALY = F.alongY();
      for (const s of [-1, 1]) {
        const [pu, pv] = P(s * (hw - hd * 0.95), 0, 0);
        K.lathe(pu, pv, [[0, 0.08], [0.16, 0.08], [0.17, 0.12], [0.1, 0.16], [0.075, 0.24], [0.11, 0.3], [0.06, 0.36], [0.055, h - 0.24], [0.09, h - 0.2], [0.07, h - 0.16], [0.16, h - 0.13], [0, h - 0.13]], '#5a3a26', 1, 20, SATIN);
        K.lathe(pu, pv, [[0.105, 0.29], [0.115, 0.3], [0.105, 0.31]], BRASS, 1.1, 20, METAL);
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + i * Math.PI / 2, [fu, fv] = P(s * (hw - hd * 0.95) + Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42);
          rod(K, [pu, pv, 0.14], [fu, fv, 0.05], 0.035, '#4a2e1e', 1, SATIN);
          K.ball(fu, fv, 0.04, 0.045, BRASS, 1.1, 10, METAL);
        }
      }
      // the apron, with a carved bead along its foot
      K.rounded(...ALY, h - 0.15, h - 0.05, x0 + 0.06, x1 - 0.06, z0 + 0.06, z1 - 0.06, R - 0.06, '#5a3a26', 1, SATIN);
      K.rounded(...ALY, h - 0.165, h - 0.145, x0 + 0.05, x1 - 0.05, z0 + 0.05, z1 - 0.05, R - 0.05, BRASS, 1.05, METAL);
      // the padded rail, then the race and its brass line, then the baize a hair below
      K.rounded(...ALY, h - 0.05, h + 0.03, x0, x1, z0, z1, R, '#5a1a1c', 1, LEATHER);
      K.rounded(...ALY, h + 0.03, h + 0.034, x0 + 0.13, x1 - 0.13, z0 + 0.13, z1 - 0.13, R - 0.13, '#6a4428', 1.05, GLOSS);
      K.rounded(...ALY, h + 0.034, h + 0.037, x0 + 0.2, x1 - 0.2, z0 + 0.2, z1 - 0.2, R - 0.2, BRASS, 1.1, METAL);
      K.rounded(...ALY, h + 0.037, h + 0.039, x0 + 0.215, x1 - 0.215, z0 + 0.215, z1 - 0.215, R - 0.215, '#1f5a34', 0.95, MATTE);
      // a gold betting line round the baize
      K.rounded(...ALY, h + 0.039, h + 0.0405, x0 + 0.42, x1 - 0.42, z0 + 0.42, z1 - 0.42, Math.max(0.05, R - 0.42), '#b8923e', 0.8, MATTE);
      K.rounded(...ALY, h + 0.0405, h + 0.041, x0 + 0.43, x1 - 0.43, z0 + 0.43, z1 - 0.43, Math.max(0.04, R - 0.43), '#1f5a34', 0.95, MATTE);
      // (rounded runs up the height here, so its rounding is the plan: a racetrack)
      // the dealer's end (the back): the deck, squared, with a cut beside it, red backs up, and the box they came
      // in lying open by them; the chip caddy along from it. Drawn half as big again as life so it reads across the room.
      const dz = z0 + 0.4, top = h + 0.041, cw = 0.048, cd = 0.068, ch = 0.0024;
      for (const [cx, n] of [[-0.2, 16], [-0.07, 7]]) {
        pbox(cx - cw, cx + cw, top, top + n * ch, dz - cd, dz + cd, '#f2eee4', 1.05, null, SATIN);
        pbox(cx - cw + 0.001, cx + cw - 0.001, top + n * ch, top + n * ch + 0.001, dz - cd + 0.001, dz + cd - 0.001, '#9a1c22', 1, null, GLOSS);
        pbox(cx - cw + 0.01, cx + cw - 0.01, top + n * ch + 0.001, top + n * ch + 0.0015, dz - cd + 0.01, dz + cd - 0.01, '#e8d3a0', 0.9, null, GLOSS);
      }
      // the card box: red board with a gold band, its tuck flap open toward the dealer
      const bx = -0.36, bh = 0.045;
      pbox(bx - cw - 0.004, bx + cw + 0.004, top, top + bh, dz - cd - 0.004, dz + cd + 0.004, '#8a1a20', 1, null, SATIN);
      pbox(bx - cw - 0.005, bx + cw + 0.005, top + bh * 0.4, top + bh * 0.6, dz - cd - 0.005, dz + cd + 0.005, '#c9a24a', 1.1, null, METAL);
      pbox(bx - cw + 0.004, bx + cw - 0.004, top + bh, top + bh + 0.002, dz - cd + 0.004, dz + cd - 0.004, '#f2eee4', 1, null, SATIN);
      pbox(bx - cw - 0.004, bx + cw + 0.004, top + bh, top + bh + 0.06, dz - cd - 0.006, dz - cd - 0.002, '#8a1a20', 0.9, null, SATIN);
      pbox(0.16, 0.42, top, top + 0.05, dz - 0.07, dz + 0.07, '#3a2418', 1, WALNUT, SATIN);
      ['#e9e4d8', '#b8262c', '#1d4a8a', '#1a1a1a', '#2e7a3a'].forEach((c, i) => {
        const [cu, cv] = P(0.185 + i * 0.05, 0, dz);
        K.lathe(cu, cv, [[0, top + 0.012], [0.019, top + 0.012], [0.019, top + 0.062], [0, top + 0.062]], c, 1.02, 10, SATIN);
      });
      // a regular game's table (`look.dress: 'saloon'`): nailheads round the rail, drinks in its cup holders, a cigar
      if (dress === 'saloon') dressCardTable(saloonCtx(K, F, p), { h, hw, hd, R });
      return true;
    }
    case 'treadmill': {
      // a deck and its belt, a motor hood at the front, two uprights to a console and a handrail back each side
      const zf = hd - 0.3, post = hw - 0.08, DARK = '#1c1e22', AL = '#aab0b6';
      pbox(-hw + 0.04, hw - 0.04, 0.06, 0.17, -hd, zf, DARK, 1, null, SATIN);
      pbox(-hw + 0.13, hw - 0.13, 0.17, 0.176, -hd + 0.04, zf - 0.03, '#0a0a0b', 1, null, MATTE);
      for (const s of [-1, 1]) pbox(s < 0 ? -hw + 0.04 : hw - 0.12, s < 0 ? -hw + 0.12 : hw - 0.04, 0.17, 0.19, -hd, zf, AL, 1.05, null, METAL);
      pbox(-hw + 0.04, hw - 0.04, 0, 0.3, zf, hd, DARK, 1.05, null, GLOSS);
      for (const s of [-1, 1]) {
        rod(K, P(s * post, 0.3, hd - 0.14), P(s * post, h - 0.14, hd - 0.1), 0.028, AL, 1.05, METAL);
        rod(K, P(s * post, h * 0.74, hd - 0.12), P(s * post, h * 0.7, hd - 0.85), 0.02, DARK, 1, SATIN);
      }
      pbox(-hw + 0.05, hw - 0.05, h - 0.22, h, hd - 0.16, hd - 0.05, DARK, 1.05, null, GLOSS);
      pbox(-hw + 0.2, hw - 0.2, h - 0.18, h - 0.04, hd - 0.166, hd - 0.16, '#37d6ff', 1.5, null, GLOW);
      return true;
    }
    case 'weights': {
      // a three-tier rack of chromed dumbbells, the heavy ones at the bottom
      const CH = '#d6dade', FR = '#1c1e22';
      for (const s of [-1, 1]) { pbox(s * (hw - 0.03) - 0.03, s * (hw - 0.03) + 0.03, 0, h, -hd + 0.04, -hd + 0.1, FR, 1, null, SATIN); pbox(s * (hw - 0.03) - 0.03, s * (hw - 0.03) + 0.03, 0, 0.05, -hd + 0.04, hd, FR, 1, null, SATIN); }
      for (let t = 0; t < 3; t++) {
        const y = 0.12 + t * (h - 0.2) / 3, z0 = -hd + 0.1 + (2 - t) * 0.06, z1 = Math.min(hd, z0 + 0.34), r0 = 0.06 - t * 0.008, n = Math.max(3, Math.floor((w - 0.16) / (r0 * 2 + 0.05)));
        pbox(-hw + 0.03, hw - 0.03, y, y + 0.025, z0, z1, FR, 1.05, null, SATIN);
        for (let i = 0; i < n; i++) {
          const x = -hw + 0.08 + (i + 0.5) * (w - 0.16) / n, a = P(x, y + 0.025 + r0, z0 + 0.04), b = P(x, y + 0.025 + r0, z1 - 0.04);
          rod(K, a, b, 0.013, CH, 1.1, METAL);
          for (const q of [a, b]) K.ball(q[0], q[1], q[2], r0, CH, 1.1, 8, METAL);
        }
      }
      return true;
    }
    case 'pressbench': {
      // a padded bench with its head between two uprights, and a loaded bar racked over where your eyes go
      const FR = '#2a2d31', zr = -hd + 0.38, by = Math.min(h - 0.2, 1.02), px = hw - 0.3;
      pbox(-0.16, 0.16, 0.34, 0.42, -hd + 0.08, hd - 0.15, '#17181b', 1, null, LEATHER);
      pbox(-0.04, 0.04, 0.06, 0.34, -hd + 0.14, hd - 0.2, FR, 1, null, SATIN);
      for (const z of [-hd + 0.2, hd - 0.3]) pbox(-0.26, 0.26, 0, 0.06, z - 0.04, z + 0.04, FR, 1, null, SATIN);
      for (const s of [-1, 1]) {
        pbox(s * px - 0.03, s * px + 0.03, 0, by + 0.12, zr - 0.03, zr + 0.03, FR, 1.05, null, SATIN);
        pbox(s * px - 0.03, s * px + 0.03, by - 0.04, by - 0.01, zr + 0.03, zr + 0.11, FR, 1.05, null, SATIN);
        pbox(s * px - 0.05, s * px + 0.05, 0, 0.04, zr - 0.3, zr + 0.3, FR, 1, null, SATIN);
        // the plates: two a side, the big one inside
        for (const [x0, r0] of [[px + 0.08, 0.2], [px + 0.13, 0.15]]) pbox(s * x0 - 0.02, s * x0 + 0.02, by + 0.012 - r0, by + 0.012 + r0, zr + 0.07 - r0, zr + 0.07 + r0, '#111214', 1, null, SATIN);
      }
      rod(K, P(-hw + 0.01, by + 0.012, zr + 0.07), P(hw - 0.01, by + 0.012, zr + 0.07), 0.014, '#d6dade', 1.1, METAL);
      return true;
    }
    case 'pool': {
      // a raised pool: a stone coping round still water, lit from under
      const rim = Math.min(0.3, w * 0.1, d * 0.2), stone = { t: 'roomStone', c: '#d8d2c6' };
      pbox(-hw, hw, 0, h, -hd, -hd + rim, '#ffffff', 1.05, stone, SATIN);
      pbox(-hw, hw, 0, h, hd - rim, hd, '#ffffff', 1.05, stone, SATIN);
      pbox(-hw, -hw + rim, 0, h, -hd + rim, hd - rim, '#ffffff', 1.05, stone, SATIN);
      pbox(hw - rim, hw, 0, h, -hd + rim, hd - rim, '#ffffff', 1.05, stone, SATIN);
      pbox(-hw + rim, hw - rim, 0, h - 0.07, -hd + rim, hd - rim, '#2aa3bd', 1.25, null, GLOSS);
      for (let x = -hw + rim + 0.8; x < hw - rim - 0.4; x += 1.6) pbox(x - 0.09, x + 0.09, h - 0.069, h - 0.066, -0.09, 0.09, '#d8fbff', 1.8, null, GLOW);
      return true;
    }
    case 'lounger': {
      // a teak sun lounger: slats on a low frame, the back raised at the head end, a cushion along it
      const TEAK = '#9a6a3e', sy = 0.3, hx = -hw + 0.62;
      for (const [x, z] of [[-hw + 0.1, -hd + 0.06], [-hw + 0.1, hd - 0.06], [hw - 0.12, -hd + 0.06], [hw - 0.12, hd - 0.06]]) pbox(x - 0.03, x + 0.03, 0, sy, z - 0.03, z + 0.03, TEAK, 0.9, WALNUT, SATIN);
      for (const z of [-hd + 0.03, hd - 0.03]) pbox(-hw, hw, sy - 0.07, sy, z - 0.03, z + 0.03, TEAK, 0.95, WALNUT, SATIN);
      for (let x = hx; x < hw - 0.06; x += 0.085) pbox(x, x + 0.06, sy, sy + 0.02, -hd + 0.03, hd - 0.03, TEAK, 1, WALNUT, SATIN);
      pbox(hx, hw - 0.03, sy + 0.02, sy + 0.1, -hd + 0.05, hd - 0.05, '#ece6d8', 1, { t: 'roomWeave', c: '#ece6d8' }, CLOTH);
      // the back: five steps of slat and cushion rising to the head
      const rise = Math.min(h - sy - 0.1, 0.4);
      for (let i = 0; i < 5; i++) { const x1 = hx - i * 0.12, y = sy + 0.02 + (i + 1) * rise / 5; pbox(x1 - 0.12, x1, y - 0.02, y, -hd + 0.03, hd - 0.03, TEAK, 1, WALNUT, SATIN); pbox(x1 - 0.12, x1 + 0.01, y, y + 0.08, -hd + 0.05, hd - 0.05, '#ece6d8', 0.97, { t: 'roomWeave', c: '#ece6d8' }, CLOTH); }
      return true;
    }
    case 'firetrough': {
      // a long stone trough with a burner down it: pebbles, and a line of flame the renderer burns (FIRE)
      const rock = { t: 'roomStone', c: '#62646a' }, top = h, bed = h - 0.06;
      pbox(-hw, hw, 0, bed, -hd, hd, '#ffffff', 1, rock, SATIN);
      for (const [x0, x1, z0, z1] of [[-hw, hw, -hd, -hd + 0.07], [-hw, hw, hd - 0.07, hd], [-hw, -hw + 0.07, -hd + 0.07, hd - 0.07], [hw - 0.07, hw, -hd + 0.07, hd - 0.07]]) pbox(x0, x1, bed, top, z0, z1, '#ffffff', 1, rock, SATIN);
      pbox(-hw + 0.07, hw - 0.07, bed, bed + 0.012, -hd + 0.07, hd - 0.07, '#0c0c0e', 0.9, null, MATTE);
      // a bed of coals the renderer heats with the dial (FIRE, sheet 8), and the dial on the trough's front
      K.quad(K.glass, [P(-hw + 0.08, bed + 0.014, hd - 0.08), P(hw - 0.08, bed + 0.014, hd - 0.08), P(hw - 0.08, bed + 0.014, -hd + 0.08), P(-hw + 0.08, bed + 0.014, -hd + 0.08)], F.N(0, 1, 0), [1, 1, 1], FIRE, [[8, 0], [9, 0], [9, 1], [8, 1]], true);
      fireDial(K, F, p.id, hw - 0.22, bed / 2, hd, Math.min(1, bed / 0.24));      // four sheets of flame along the burner, staggered so it has a body from the side
      [[-0.06, 10], [-0.02, 0], [0.02, 2], [0.06, 16]].forEach(([z, i]) => {
        K.quad(K.glass, [P(-hw + 0.12, bed + 0.01, z), P(hw - 0.12, bed + 0.01, z), P(hw - 0.12, bed + 0.5, z), P(-hw + 0.12, bed + 0.5, z)], F.N(0, 0, 1), [1, 1, 1], FIRE, [[i, 0], [i + 1, 0], [i + 1, 1], [i, 1]], true);
      });
      return true;
    }
    // ── a calm flat's: water by the way in, a lit paper lantern, a tree in a dish ─────────────────
    case 'fountain': {
      // a slate wall fountain: a stone trough of still water and river stones, a slate panel at the
      // back with a sheet of water running down its face from a copper lip, lit from the trough
      const stone = { t: 'roomStone', c: '#cfc8bb' }, slate = { t: 'roomStone', c: '#3a3d44' }, tb = 0.24, rim = 0.045;
      pbox(-hw, hw, 0, tb - 0.04, -hd, hd, '#ffffff', 1, stone, SATIN);
      pbox(-hw, hw, tb - 0.04, tb, -hd, -hd + rim, '#ffffff', 1.04, stone, SATIN);
      pbox(-hw, hw, tb - 0.04, tb, hd - rim, hd, '#ffffff', 1.04, stone, SATIN);
      for (const s of [-1, 1]) pbox(s < 0 ? -hw : hw - rim, s < 0 ? -hw + rim : hw, tb - 0.04, tb, -hd + rim, hd - rim, '#ffffff', 1.04, stone, SATIN);
      pbox(-hw + rim, hw - rim, tb - 0.04, tb - 0.025, -hd + rim, hd - rim, '#1f6f84', 1.2, null, GLOSS);
      pbox(-hw + 0.1, hw - 0.1, tb - 0.026, tb - 0.024, -0.02, 0.04, '#cff6ff', 1.6, null, GLOW);
      const r = rng(23);
      for (let i = 0; i < 11; i++) {
        const [u, v] = P(-hw + rim + 0.04 + r() * (w - 2 * rim - 0.08), 0, -hd + rim + 0.1 + r() * (d - 2 * rim - 0.14));
        K.ball(u, v, tb - 0.03, 0.022 + r() * 0.016, ['#8a857c', '#6e6a64', '#b5ada0', '#4f4c48'][i % 4], 1, 8, GLOSS);
      }
      // the panel, the water on it, and the lip it spills from
      pbox(-hw + 0.05, hw - 0.05, tb, h, -hd + rim, -hd + rim + 0.04, '#ffffff', 1, slate, SATIN);
      pbox(-hw + 0.1, hw - 0.1, tb - 0.025, h - 0.07, -hd + rim + 0.04, -hd + rim + 0.046, '#3f5f68', 1.05, null, GLOSS);
      // the run of the water: thin bright streaks down the sheet, uneven, as it catches the light
      for (let i = 0; i < 9; i++) { const x = -hw + 0.13 + (i + r() * 0.6) * (w - 0.26) / 9, y0 = tb + r() * 0.25; pbox(x, x + 0.006, y0, h - 0.07 - r() * 0.1, -hd + rim + 0.046, -hd + rim + 0.049, '#d8f4fa', 1.3, null, GLOSS); }
      pbox(-hw + 0.08, hw - 0.08, h - 0.07, h - 0.04, -hd + rim + 0.04, -hd + rim + 0.1, '#b0683a', 1.1, null, METAL);
      return true;
    }
    case 'catstatue': {
      // Scrappy (cat-statue.js) on a plain block of polished Statuario, its top edge bevelled, as on the design
      // sheet. `look.tag` is cut into the block's front, dark.
      const M = { t: 'roomMarble', c: '#f2efe9' }, ped = Math.min(0.56, h * 0.48), bev = 0.012;
      pbox(-hw + 0.005, hw - 0.005, 0, ped - bev, -hd + 0.005, hd - 0.005, '#ffffff', 1, M, GLOSS);
      pbox(-hw + 0.005 + bev, hw - 0.005 - bev, ped - bev, ped, -hd + 0.005 + bev, hd - 0.005 - bev, '#ffffff', 1.03, M, GLOSS);
      pbox(-hw + 0.005 + bev * 0.5, hw - 0.005 - bev * 0.5, ped - bev, ped - bev * 0.5, -hd + 0.005 + bev * 0.5, hd - 0.005 - bev * 0.5, '#ffffff', 1.015, M, GLOSS);
      const tag = String(p.tag || '').toUpperCase().slice(0, 12), fz = hd - 0.005;
      if (tag) legend({ plate: (ps, col, emis) => K.quad(K.solid, ps.map(([a, b]) => P(-a, b, fz + 0.002)), F.N(0, 0, 1), col, MATTE, null, true) }, tag, 0, ped * 0.45, 0.06, K.C('#4a443e', 1), 0);
      drawCatStatue(K, F, ped);
      return true;
    }
    // ── a clone facility's: the vats, the tanks under them, and the MORPHEX pod ─────────────────────
    case 'vat': {
      // a print vat: a steel plinth and crown, a glass tube of lit green fluid, and somebody standing asleep in it,
      // head bowed, a line into the mask over their face. `look.tag` letters a number plate on the plinth;
      // `look.state: 'drained'` is the one you came out of: the fluid down to a puddle, the front panel of glass
      // swung open, nobody inside, water on the floor.
      const c = { F, K }, R = Math.min(hw, hd) * 0.9, base = 0.34, crown = h - 0.32, rr = rng(p.seed || 7), drained = p.state === 'drained';
      const [u, v] = P(0, 0, 0), tube = R * 0.9, fluidTop = drained ? base + 0.06 : crown - 0.05;
      // the plinth, stepped, with a lit ring where the glass seats
      K.lathe(u, v, [[0, 0], [R + 0.06, 0], [R + 0.06, 0.08], [R + 0.02, 0.12], [R + 0.02, base - 0.05], [tube + 0.03, base], [0, base]], '#c9ced3', 1.05, 36, METAL);
      torus(K, u, v, tube + 0.01, 0.018, base + 0.01, drained ? '#ff8a3a' : '#5fffc0', 1.6);
      K.lathe(u, v, [[0, base + 0.002], [tube, base + 0.002]], drained ? '#ff9a5a' : '#7affd0', drained ? 1.4 : 2.2, 32, GLOW);
      // the sleeper: upright in the fluid, a little off the floor, head bowed, arms loose, knees soft
      if (!drained) {
        const skin = '#b8c9b4', lift = 0.12 + rr() * 0.06, y0 = base + lift, sx = (rr() - 0.5) * 0.04, [bu, bv] = P(sx, 0, 0.02);
        for (const s of [-1, 1]) {
          const [lu, lv] = P(sx + s * 0.075, 0, 0.02 + (s > 0 ? 0.03 : 0));
          K.lathe(lu, lv, [[0, y0], [0.045, y0 + 0.02], [0.05, y0 + 0.42], [0.062, y0 + 0.5], [0.078, y0 + 0.82], [0, y0 + 0.86]], skin, 1, 14, SATIN);
        }
        K.lathe(bu, bv, [[0, y0 + 0.8], [0.15, y0 + 0.84], [0.14, y0 + 1.0], [0.13, y0 + 1.12], [0.17, y0 + 1.3], [0.12, y0 + 1.38], [0.05, y0 + 1.42], [0, y0 + 1.42]], skin, 1, 18, SATIN);
        const [hu2, hv2] = P(sx, 0, 0.06);
        K.ball(hu2, hv2, y0 + 1.53, 0.1, skin, 1, 16, SATIN);
        for (const s of [-1, 1]) {
          const a = P(sx + s * 0.18, 0, 0.0), b = P(sx + s * 0.22, 0, 0.05), e = P(sx + s * 0.2, 0, 0.1);
          rod(K, [a[0], a[1], y0 + 1.33], [b[0], b[1], y0 + 1.06], 0.04, skin, 1, SATIN);
          rod(K, [b[0], b[1], y0 + 1.06], [e[0], e[1], y0 + 0.82], 0.035, skin, 1, SATIN);
        }
        // the mask and its line up to the crown
        const [mu, mv] = P(sx, 0, 0.15);
        K.ball(mu, mv, y0 + 1.48, 0.05, '#2a3a36', 1, 12, GLOSS);
        rod(K, [mu, mv, y0 + 1.5], [u, v, crown], 0.012, '#1c2422', 1, SATIN);
        // bubbles rising off them
        for (let i = 0; i < 14; i++) { const a = rr() * Math.PI * 2, d = rr() * tube * 0.75; K.ball(u + Math.cos(a) * d, v + Math.sin(a) * d, base + 0.1 + rr() * (crown - base - 0.2), 0.008 + rr() * 0.012, '#e8fff6', 1.8, 6, GLOW); }
      } else {
        // a puddle in front, and the drained fluid's scum line on the glass
        const [pu, pv] = P(0, 0, hd + 0.45);
        K.lathe(pu, pv, [[0, 0.004], [0.55, 0.004]], '#3a5a50', 1, 24, GLOSS);
        torus(K, u, v, tube - 0.005, 0.004, base + 0.9, '#6a8a74', 1);
      }
      // the fluid, then the glass round it, both see-through; drained, the front quarter of the glass is swung open
      liquidLathe(c, 0, 0, [[0, base], [tube - 0.012, base], [tube - 0.012, fluidTop], [0, fluidTop]], drained ? '#3a7a60' : '#46e0a8', drained ? 0.9 : 1.25, 28);
      if (!drained) glassLathe(c, 0, 0, [[tube, base], [tube, crown]], 28);
      else {
        // three quarters of the tube, and the open quarter swung out on its hinge at the left
        const seg = 28, at = (r2, a, y) => P(Math.cos(a) * r2, y, Math.sin(a) * r2);
        for (let j = 0; j < seg; j++) {
          const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
          if (Math.sin(am) > 0.7) continue;
          K.quad(K.glass, [at(tube, a0, base), at(tube, a1, base), at(tube, a1, crown), at(tube, a0, crown)], F.N(Math.cos(am), 0, Math.sin(am)), [1, 1, 1], GLOSS, null, true);
        }
        const h0 = Math.PI * 0.25, op = 1.9, door = (k) => { const a = h0 + k * Math.PI * 0.5; return [Math.cos(h0) * tube + Math.cos(a + op) * 0.0 + (Math.cos(a) - Math.cos(h0)) * tube * Math.cos(op) - (Math.sin(a) - Math.sin(h0)) * tube * Math.sin(op), Math.sin(h0) * tube + (Math.cos(a) - Math.cos(h0)) * tube * Math.sin(op) + (Math.sin(a) - Math.sin(h0)) * tube * Math.cos(op)]; };
        for (let j = 0; j < 7; j++) {
          const [x0, z0] = door(j / 7), [x1, z1] = door((j + 1) / 7);
          K.quad(K.glass, [P(x0, base + 0.01, z0), P(x1, base + 0.01, z1), P(x1, crown - 0.01, z1), P(x0, crown - 0.01, z0)], F.N((z1 - z0), 0, -(x1 - x0)), [1, 1, 1], GLOSS, null, true);
        }
        const [hx, hz] = door(0), [ex, ez] = door(1);
        rod(K, [...P(ex, 0, ez)].slice(0, 2).concat(base + 0.02), [...P(ex, 0, ez)].slice(0, 2).concat(crown - 0.02), 0.012, '#c9ced3', 1.05, METAL);
        rod(K, [...P(hx, 0, hz)].slice(0, 2).concat(base + 0.02), [...P(hx, 0, hz)].slice(0, 2).concat(crown - 0.02), 0.016, '#c9ced3', 1.05, METAL);
      }
      // the crown: a steel cap, a lit band under it, hoses up to the wall
      K.lathe(u, v, [[0, crown], [tube + 0.03, crown], [R + 0.04, crown + 0.06], [R + 0.04, h - 0.1], [R * 0.7, h - 0.02], [0, h]], '#c9ced3', 1.05, 36, METAL);
      torus(K, u, v, tube + 0.01, 0.014, crown + 0.01, drained ? '#ff8a3a' : '#5fffc0', 1.5);
      for (const s of [-1, 1]) rod(K, [...P(s * R * 0.4, 0, -R * 0.3)].slice(0, 2).concat(h - 0.04), [...P(s * R * 0.55, 0, -hd - 0.02)].slice(0, 2).concat(h + 0.35), 0.03, '#2b3034', 1, SATIN);
      // the plate on the plinth: a number in the legend face, and a status light
      const tag = String(p.tag || '').toUpperCase().slice(0, 6);
      pbox(-0.16, 0.16, 0.14, 0.26, R + 0.02, R + 0.035, '#1b1e22', 1, null, SATIN);
      if (tag) legend({ plate: (ps, col, emis) => K.quad(K.solid, ps.map(([a, b]) => P(-a, b, R + 0.037)), F.N(0, 0, 1), col, emis > 0.5 ? GLOW : MATTE, null, true) }, tag, 0.03, 0.2, 0.06, K.C(drained ? '#ffb070' : '#bfffe6', 2), 1);
      pbox(0.09, 0.13, 0.18, 0.22, R + 0.035, R + 0.045, drained ? '#ff7a2a' : '#4dff9a', 2.2, null, GLOW);
      return true;
    }
    case 'tank': {
      // a squat waste tank on four feet, its lid dogged shut by six clamps and a pipe out of the back
      const [u, v] = P(0, 0, 0), R = Math.min(hw, hd) * 0.95, foot = 0.14;
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pbox(x * R * 0.6 - 0.04, x * R * 0.6 + 0.04, 0, foot, z * R * 0.6 - 0.04, z * R * 0.6 + 0.04, '#3a3d40', 1, null, METAL);
      K.lathe(u, v, [[0, foot], [R * 0.8, foot], [R, foot + 0.12], [R, h - 0.14], [R * 0.9, h - 0.06], [0, h - 0.06]], '#4f6a5c', 0.9, 28, SATIN);
      K.lathe(u, v, [[0, h - 0.06], [R * 0.7, h - 0.06], [R * 0.66, h], [0, h]], '#5c6166', 1, 24, METAL);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, [cu, cv] = [u + Math.cos(a) * R * 0.72, v + Math.sin(a) * R * 0.72]; K.ball(cu, cv, h - 0.04, 0.03, '#2a2c2e', 1, 8, METAL); }
      for (const y of [foot + 0.3, h - 0.3]) torus(K, u, v, R + 0.006, 0.014, y, '#33363a', 1);
      pbox(-0.18, 0.18, h * 0.5, h * 0.5 + 0.12, hd - 0.03, hd - 0.02, '#d9c27a', 1.1, null, SATIN);
      rod(K, [u, v, h * 0.4], [...P(0, 0, -hd - 0.05)].slice(0, 2).concat(h * 0.4), 0.06, '#3a3d40', 1, METAL);
      return true;
    }
    case 'morphex': {
      // the MORPHEX 9000 pod: a round chrome plinth with a lit ring to stand on, a mirrored spine up the back, a
      // canopy with its scan ring parked in it, and the glass door slid round behind, out of the way. The door
      // that closes, the ring that sweeps and the steam are the pod's sequence (panels/room-morphex.js), drawn as props.
      const [u, v] = P(0, 0, 0.05), R = Math.min(hw, hd) * 0.9, plinth = 0.16, top = h - 0.3;
      K.lathe(u, v, [[0, 0], [R + 0.05, 0], [R + 0.05, plinth - 0.03], [R, plinth], [0, plinth]], '#d8dde3', 1.1, 36, METAL);
      torus(K, u, v, R * 0.82, 0.016, plinth + 0.005, '#ff4fd8', 1.4);
      K.lathe(u, v, [[0, plinth + 0.002], [R * 0.78, plinth + 0.002]], '#2b2f36', 1, 32, GLOSS);
      // the spine: a curved mirror panel, chrome-framed, the back third of the circle
      for (let i = 0; i < 9; i++) {
        const a0 = Math.PI * (1.17 + i * 0.074), a1 = a0 + Math.PI * 0.074, [x0, z0] = [Math.cos(a0) * R, Math.sin(a0) * R], [x1, z1] = [Math.cos(a1) * R, Math.sin(a1) * R];
        const s = Math.min(x0, x1), e = Math.max(x0, x1), zs = Math.min(z0, z1), ze = Math.max(z0, z1);
        pbox(s, e + 0.02, plinth, top, zs - 0.03 + 0.05, ze + 0.05, i % 4 === 0 ? '#c7cdd4' : '#9fb4c4', i % 4 === 0 ? 1.1 : 1.25, null, i % 4 === 0 ? METAL : GLOSS);
      }
      // the canopy and the parked ring, and its lit underside
      K.lathe(u, v, [[0, top], [R + 0.08, top], [R + 0.08, top + 0.14], [R * 0.7, h - 0.02], [0, h]], '#e6e9ed', 1.12, 36, METAL);
      torus(K, u, v, R * 0.86, 0.03, top - 0.04, '#9be7ff', 1.5);
      K.lathe(u, v, [[0, top - 0.001], [R * 0.84, top - 0.001]], '#ffffff', 1.8, 32, LAMP);
      // a ribbon of brand colour round the plinth's foot
      torus(K, u, v, R + 0.06, 0.012, plinth + 0.04, '#ff4fd8', 1.3);
      // the price board on a stalk at the front left, its screen a lit slab
      const [bu, bv] = P(-hw + 0.08, 0, hd - 0.1);
      rod(K, [bu, bv, 0], [bu, bv, 1.2], 0.02, '#c7cdd4', 1.05, METAL);
      pbox(-hw - 0.08, -hw + 0.28, 1.2, 1.5, hd - 0.14, hd - 0.1, '#ff63e0', 1.6, null, GLOW);
      return true;
    }
    case 'lantern': {
      // a paper floor lantern on four black feet: rice paper over bamboo ribs, lit from inside
      const R = Math.min(hw, hd) * 0.92, foot = 0.12, [u, v] = P(0, 0, 0);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const [fu, fv] = P(x * R * 0.6, 0, z * R * 0.6); rod(K, [fu, fv, 0], [fu * 0.7 + u * 0.3, fv * 0.7 + v * 0.3, foot + 0.02], 0.008, '#151515', 1, SATIN); }
      K.lathe(u, v, [[0, foot], [R * 0.82, foot], [R * 0.97, foot + (h - foot) * 0.25], [R, foot + (h - foot) * 0.55], [R * 0.95, foot + (h - foot) * 0.85], [R * 0.78, h - 0.01], [0, h - 0.01]], '#fff0d2', 1.9, 28, LAMP);
      for (let i = 1; i < 9; i++) { const t = i / 9, y = foot + (h - foot) * t, rr = R * (t < 0.55 ? 0.82 + 0.33 * t : 1 - 0.5 * (t - 0.55) ** 2 * 2.2); torus(K, u, v, rr + 0.003, 0.003, y, '#a8915e', 0.9); }
      return true;
    }
    case 'bonsai': {
      // a juniper in a shallow glazed dish on a low walnut stand: a twisting trunk and flat pads of green
      const top = Math.max(0.3, h - 0.42);
      pbox(-hw, hw, top - 0.04, top, -hd, hd, '#5a3a26', 1, WALNUT, SATIN);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pbox(x * (hw - 0.05) - 0.025, x * (hw - 0.05) + 0.025, 0, top - 0.04, z * (hd - 0.05) - 0.025, z * (hd - 0.05) + 0.025, '#5a3a26', 0.95, WALNUT, SATIN);
      pbox(-hw + 0.05, hw - 0.05, 0.08, 0.1, -hd + 0.05, hd - 0.05, '#5a3a26', 0.9, WALNUT, SATIN);
      const [u, v] = P(0, 0, 0), pr = Math.min(hw, hd) * 0.8;
      K.lathe(u, v, [[0, top], [pr * 0.8, top], [pr, top + 0.07], [pr * 0.96, top + 0.075], [0, top + 0.06]], '#2c4a72', 1.1, 28, GLOSS);
      K.lathe(u, v, [[0, top + 0.068], [pr * 0.94, top + 0.068]], '#3e5a2a', 0.9, 24, MATTE);
      // the trunk: a few bends, thinning as it goes
      const r = rng(41), pts = [[u, v, top + 0.06]];
      for (let i = 1; i <= 5; i++) { const t = i / 5; pts.push([u + Math.sin(t * 3.1) * 0.09 + (r() - 0.5) * 0.02, v + Math.cos(t * 2.3) * 0.03, top + 0.06 + t * 0.32]); }
      for (let i = 1; i < pts.length; i++) rod(K, pts[i - 1], pts[i], 0.028 * (1 - i / 7), '#6a4e3a', 0.95, SATIN);
      // pads off the bends, each a flat cluster of balls
      const greens = ['#2f5a2a', '#3a6a30', '#284c24'];
      for (const [k, du, dv] of [[2, -0.12, 0.02], [3, 0.13, -0.03], [4, -0.08, 0.05], [5, 0.04, 0]]) {
        const [bu, bv, by] = pts[k], cu = bu + du, cv = bv + dv, cy = by + (k === 5 ? 0.04 : 0);
        rod(K, pts[k], [cu, cv, cy], 0.008, '#6a4e3a', 0.95, SATIN);
        for (let j = 0; j < 14; j++) { const a = r() * Math.PI * 2, rr = r() * 0.08; K.ball(cu + Math.cos(a) * rr, cv + Math.sin(a) * rr * 0.8, cy + (r() - 0.3) * 0.025, 0.028 + r() * 0.012, greens[j % 3], 1, 7, MATTE); }
      }
      return true;
    }
    default: return false;
  }
}
// What stands on a console or a plinth: lilies in a tall glass vase, a bowl of green apples, dried thistle
// in stoneware, an orchid in a pot.
function dressTop(K, P, dress, h, hw) {
  const at = (x) => P(x, 0, 0);
  if (dress === 'apples') {
    const [u, v] = at(hw * 0.3);
    K.lathe(u, v, [[0, h], [0.1, h], [0.17, h + 0.06], [0.18, h + 0.09], [0.165, h + 0.09], [0.15, h + 0.06], [0, h + 0.02]], '#e8e2d6', 1.04, 24, GLOSS);
    const r = rng(11);
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + r(), rr = i < 6 ? 0.09 : 0.03; K.ball(u + Math.cos(a) * rr, v + Math.sin(a) * rr, h + (i < 6 ? 0.09 : 0.14), 0.042, i % 3 ? '#8ab03a' : '#a8c048', 1, 10, GLOSS); }
    return;
  }
  if (dress === 'bonsai') {
    // a juniper in a footed hexagonal pot: cobalt glaze with a gold rim and band on four gold feet, a moss
    // bed, and a trunk that twists up into flat pads of green. On a console it stands at one end.
    const [u, v] = at(hw ? -hw * 0.5 : 0), R = 0.15, r = rng(17);
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + Math.PI / 4; K.ball(u + Math.cos(a) * R * 0.75, v + Math.sin(a) * R * 0.75, h + 0.014, 0.022, GOLD, 1.1, 10, METAL); }
    K.lathe(u, v, [[0, h + 0.02], [R * 0.85, h + 0.02], [R, h + 0.05], [R * 1.04, h + 0.1], [R * 1.12, h + 0.11], [R * 1.12, h + 0.125], [0, h + 0.12]], '#1f3c78', 1.12, 6, GLOSS);
    torus(K, u, v, R * 1.12, 0.008, h + 0.125, GOLD, 1.1);
    torus(K, u, v, R * 1.02, 0.005, h + 0.07, GOLD, 1.1);
    K.lathe(u, v, [[0, h + 0.12], [R * 1.05, h + 0.12], [0, h + 0.135]], '#3e5a2a', 0.9, 18, MATTE);
    let pt = [u, v, h + 0.12];
    for (let k = 1; k <= 5; k++) { const nx = [u + Math.sin(k * 1.3) * 0.06, v + Math.cos(k * 1.7) * 0.03, h + 0.12 + k * 0.075]; rod(K, pt, nx, 0.03 - k * 0.004, '#5a4030', 0.95, SATIN); pt = nx; }
    for (const [dx, dz, dy, sp] of [[-0.14, 0.02, 0.25, 0.1], [0.12, -0.03, 0.31, 0.09], [-0.04, 0.04, 0.44, 0.1], [0.07, 0, 0.52, 0.07]]) {
      rod(K, [u + dx * 0.3, v, h + dy - 0.05], [u + dx, v + dz, h + dy], 0.01, '#5a4030', 0.95, SATIN);
      for (let n = 0; n < 12; n++) { const a = r() * Math.PI * 2, rr = r() * sp; K.ball(u + dx + Math.cos(a) * rr, v + dz + Math.sin(a) * rr * 0.7, h + dy + (r() - 0.3) * 0.03, 0.035 + r() * 0.015, ['#3e5a2a', '#4a6a30', '#34502a'][n % 3], 1, 7, MATTE); }
    }
    return;
  }
  if (dress === 'orchid') {
    const [u, v] = at(0);
    K.lathe(u, v, [[0, h], [0.07, h], [0.08, h + 0.12], [0, h + 0.11]], '#f2eee6', 1.04, 18, GLOSS);
    for (const [dx, dz, top] of [[0.02, 0.01, 0.42], [-0.03, 0.0, 0.36]]) {
      rod(K, [u + dx * 0.2, v + dz, h + 0.11], [u + dx, v + dz, h + top], 0.004, '#4a5a2a', 0.9, SATIN);
      for (let i = 0; i < 5; i++) K.ball(u + dx + 0.03 * Math.cos(i), v + dz + 0.03 * Math.sin(i), h + top - i * 0.035, 0.022, '#f4eef6', 1.15, 8, SATIN);
    }
    for (const a of [0.4, 2.2, 3.9]) K.ball(u + Math.cos(a) * 0.07, v + Math.sin(a) * 0.07, h + 0.13, 0.045, '#3e5a2a', 0.95, 8, SATIN);
    return;
  }
  // a tall vase, and stems with flower heads: white lilies, or something dried and blue. On a console it
  // stands at the end, its stems leaning outward, so a TV on the wall above the middle stays clear.
  const [u, v] = at(hw ? Math.max(0, hw - 0.09) : 0), dried = dress === 'thistle', r = rng(dried ? 5 : 3);
  K.lathe(u, v, [[0, h], [0.06, h], [0.075, h + 0.12], [0.05, h + 0.32], [0.055, h + 0.36], [0, h + 0.35]], dried ? '#4a4038' : '#d8e4e6', dried ? 1 : 1.1, 20, GLOSS);
  for (let i = 0; i < 9; i++) {
    const a = hw ? (r() - 0.5) * Math.PI * 0.5 : r() * Math.PI * 2, s = hw ? 0.1 + r() * 0.14 : 0.06 + r() * 0.16, top = h + 0.55 + r() * 0.3, fu = u + Math.cos(a) * s, fv = v + Math.sin(a) * s;
    rod(K, [u + Math.cos(a) * 0.02, v + Math.sin(a) * 0.02, h + 0.34], [fu, fv, top], 0.004, dried ? '#7a6a4a' : '#4a6a2a', 0.9, SATIN);
    if (dried) K.ball(fu, fv, top, 0.028, i % 2 ? '#5a6a9a' : '#8a7a9a', 1, 8, MATTE);
    else for (let j = 0; j < 5; j++) { const b = j / 5 * Math.PI * 2; rod(K, [fu, fv, top - 0.01], [fu + Math.cos(b) * 0.06, fv + Math.sin(b) * 0.06, top + 0.03], 0.012, '#fbf8f0', 1.12, SATIN); }
  }
}
