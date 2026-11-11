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
import { legend, legendWidth } from '../../../../shared/legend-font.js';

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
}

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
      pbox(-hw, hw, h - 0.035, h, -hd, hd, '#ffffff', 1.05, marble, GLOSS);
      for (const s of [-1, 1]) {
        const x = s * (hw - 0.12);
        pbox(x - 0.015, x + 0.015, 0, h - 0.035, -hd + 0.04, -hd + 0.07, BRONZE, 1.06, null, METAL);
        pbox(x - 0.015, x + 0.015, 0, h - 0.035, hd - 0.07, hd - 0.04, BRONZE, 1.06, null, METAL);
        pbox(x - 0.015, x + 0.015, h - 0.07, h - 0.035, -hd + 0.04, hd - 0.04, BRONZE, 1.06, null, METAL);
        pbox(x - 0.04, x + 0.04, 0, 0.012, -hd + 0.03, hd - 0.03, BRONZE_DARK, 1, null, METAL);
      }
      pbox(-hw + 0.12, hw - 0.12, 0.16, 0.18, -hd + 0.06, hd - 0.06, BRONZE, 1.02, null, METAL);
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
      pbox(b0 - 0.015, -b0 + 0.015, h, h + 0.002, b0 - 0.015, -b0 + 0.015, BRASS, 1.05, null, METAL);
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) pbox(b0 + i * sq, b0 + (i + 1) * sq, h + 0.002, h + 0.004, b0 + j * sq, b0 + (j + 1) * sq, (i + j) % 2 ? '#1a1512' : '#eadfc6', 1, null, GLOSS);
      for (const [i, j, dark, tall] of [[4, 0, 0, 1], [3, 1, 0, 0], [5, 1, 0, 0], [2, 2, 0, 0], [6, 0, 0, 1], [4, 7, 1, 1], [4, 5, 1, 0], [3, 6, 1, 0], [1, 5, 1, 1], [6, 6, 1, 0]]) {
        const [pu, pv] = P(b0 + (i + 0.5) * sq, 0, b0 + (j + 0.5) * sq), r0 = sq * 0.32, ph = tall ? sq * 1.7 : sq * 1.1;
        K.lathe(pu, pv, [[r0, h + 0.004], [r0 * 0.5, h + 0.004 + ph * 0.5], [r0 * 0.7, h + 0.004 + ph * 0.8], [0, h + 0.004 + ph]], dark ? '#17120f' : '#f0e6cc', 1, 8, GLOSS);
      }
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
      fireDial(K, F, p.id, hw - 0.22, bed / 2, hd, Math.min(1, bed / 0.24));
      // four sheets of flame along the burner, staggered so it has a body from the side
      [[-0.06, 10], [-0.02, 0], [0.02, 2], [0.06, 16]].forEach(([z, i]) => {
        K.quad(K.glass, [P(-hw + 0.12, bed + 0.01, z), P(hw - 0.12, bed + 0.01, z), P(hw - 0.12, bed + 0.5, z), P(-hw + 0.12, bed + 0.5, z)], F.N(0, 0, 1), [1, 1, 1], FIRE, [[i, 0], [i + 1, 0], [i + 1, 1], [i, 1]], true);
      });
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
  // a tall vase, and stems with flower heads: white lilies, or something dried and blue
  const [u, v] = at(hw ? hw * 0.35 : 0), dried = dress === 'thistle', r = rng(dried ? 5 : 3);
  K.lathe(u, v, [[0, h], [0.06, h], [0.075, h + 0.12], [0.05, h + 0.32], [0.055, h + 0.36], [0, h + 0.35]], dried ? '#4a4038' : '#d8e4e6', dried ? 1 : 1.1, 20, GLOSS);
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2, s = 0.06 + r() * 0.16, top = h + 0.55 + r() * 0.3, fu = u + Math.cos(a) * s, fv = v + Math.sin(a) * s;
    rod(K, [u + Math.cos(a) * 0.02, v + Math.sin(a) * 0.02, h + 0.34], [fu, fv, top], 0.004, dried ? '#7a6a4a' : '#4a6a2a', 0.9, SATIN);
    if (dried) K.ball(fu, fv, top, 0.028, i % 2 ? '#5a6a9a' : '#8a7a9a', 1, 8, MATTE);
    else for (let j = 0; j < 5; j++) { const b = j / 5 * Math.PI * 2; rod(K, [fu, fv, top - 0.01], [fu + Math.cos(b) * 0.06, fv + Math.sin(b) * 0.06, top + 0.03], 0.012, '#fbf8f0', 1.12, SATIN); }
  }
}
