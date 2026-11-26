// GLASS 2 · A ROOM'S FINISH. What a room is finished with past its plain walls, ceiling and floor
// (client/shared/room-layout.js `spec.decor`, from a zone's `flags.room.decor`): stone or walnut on the
// walls, a coffered or slotted ceiling, a border and a medallion let into the floor, a runner down a
// hall, chandeliers and sconces, columns, planted trees, pictures, the doors that don't go anywhere you
// can, and the numbers on the ones that do; and the deco ones (a sunburst in the floor, a chevron frieze, fluted
// pilasters, fan sconces, tiered pendants, a dead lift's floor dial). Plus the few forms a hotel's furniture needs (`drawDecorForm`):
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
import { balconyDressOf, stairsOf, wellBoxes, cutRects, cellsOf, CELL_BAR } from '../../../../shared/room-layout.js';
import { glassLathe, liquidLathe } from './lab-mesh.js';
import { drawCatStatue } from './cat-statue.js';
import { drawSaloonDecor, dressCardTable, saloonCtx } from './room-saloon.js';
import { drawHotelDecor, drawHotelForm, twinSconce } from './room-hotel.js';
import { drawSquatDecor } from './room-squat.js';

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
  const kind = c.kind || 'stone', top = num(c.y1, H, 0.5, H), base = 0.12, hex = hex6(c.hex, kind === 'walnut' ? '#5a3a26' : kind === 'bronze' ? '#8a6a44' : kind === 'brick' ? '#9a5a40' : kind === 'tile' ? '#e8e6de' : '#efe9df');
  // 'brick': a run of brick in its own colour up to y1, with a soldier course and a painted cap on top (a stadium's
  // concourse, a warehouse); one face, so the bricks' own texture does the work
  // 'tile': glazed square tile to y1 under a bullnose cap in the trim colour (a restroom, a kitchen's back wall)
  if (kind === 'brick' || kind === 'tile') { brick(K, L, runs, c, { hex, top, H, accent, tex: kind === 'tile' ? 'roomTile' : 'roomBrick', surf: kind === 'tile' ? GLOSS : MATTE }); return; }
  // 'sheet': ribbed steel cladding, the inside of a GLASS shed's `ty_hangarmetal` walls: a flat sheet with a raised
  // rib every `pitch` metres, a darker girt across it at `girt` heights, and a kerb along the floor
  if (kind === 'sheet') { sheet(K, L, runs, c, { top }); return; }
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

function sheet(K, L, runs, c, { top }) {
  const hex = hex6(c.hex, '#78808a'), rib = hex6(c.rib, '#8a929c'), girt = hex6(c.trim, '#4a5056'), pitch = num(c.pitch, 0.5, 0.2, 2);
  const girts = Array.isArray(c.girts) ? c.girts.filter(Number.isFinite) : [top * 0.33, top * 0.66];
  for (const [wall, rs] of Object.entries(runs)) {
    if (c.on && !c.on.includes(wall)) continue;
    for (let [a, b] of rs) {
      if (wall === 'left' || wall === 'right') { a = Math.max(a, 0); b = Math.min(b, L.d); }
      if (b - a < 0.15) continue;
      onWall(K, L, wall, a, b, 0, 0.06, 0, 0.2, '#3a3d40', 1, null, MATTE);
      onWall(K, L, wall, a, b, 0, 0.012, 0.2, top, hex, 1, null, METAL);
      const n = Math.max(1, Math.round((b - a) / pitch));
      for (let i = 1; i < n; i++) { const p = a + i * (b - a) / n; onWall(K, L, wall, p - 0.03, p + 0.03, 0, 0.03, 0.2, top, rib, 1.06, null, METAL); }
      for (const y of girts) if (y > 0.3 && y < top - 0.1) onWall(K, L, wall, a, b, 0, 0.09, y - 0.06, y + 0.06, girt, 1, null, METAL);
    }
  }
}

// 'barrel': the underside of a GLASS shed's corrugated barrel roof (drawBarrelRoof). The vault springs from the side
// walls at `spring` and rises to just under H across the room's width; the room's own flat ceiling stays above it,
// out of sight. Corrugation is alternate strips a shade apart, an arched steel rib every `bay` metres, and the
// gable ends between the arch and H are closed in the wall sheet.
function barrel(K, L, c, { H }) {
  const hu = L.w / 2, D = L.d, S = num(c.spring, H * 0.6, 0.5, H - 0.5), R = H - 0.02 - S;
  const hex = hex6(c.hex, '#8a929c'), rib = hex6(c.trim, '#4a5056'), wall = hex6(c.gable, '#78808a'), bay = num(c.bay, 4, 1, 12), N = 48;
  const at = (i) => { const t = Math.PI * i / N, x = Math.cos(t), z = Math.sin(t); return { u: hu * x, y: S + R * z, nu: -x, ny: -z }; };
  for (let i = 0; i < N; i++) {
    const p = at(i), q = at(i + 1), m = Math.hypot(p.nu + q.nu, p.ny + q.ny) || 1;
    const n = K.nrmOf((p.nu + q.nu) / m, (p.ny + q.ny) / m, 0);
    K.quad(K.solid, [[p.u, 0, p.y], [p.u, D, p.y], [q.u, D, q.y], [q.u, 0, q.y]], n, K.C(hex, i % 2 ? 0.9 : 1.04), METAL, null, false);
    for (const [v, nz] of [[0.015, 1], [D - 0.015, -1]]) K.quad(K.solid, [[p.u, v, p.y], [q.u, v, q.y], [q.u, v, H], [p.u, v, H]], K.nrmOf(0, 0, nz), K.C(wall, 1), METAL, null, false);
  }
  const nb = Math.max(1, Math.round(D / bay));
  for (let j = 0; j <= nb; j++) {
    const v = Math.min(D - 0.1, Math.max(0.1, j * D / nb));
    for (let i = 0; i < N; i += 2) {
      const p = at(i), q = at(Math.min(N, i + 2));
      K.box(Math.min(p.u, q.u), Math.max(p.u, q.u), v - 0.07, v + 0.07, Math.min(p.y, q.y) - 0.18, Math.max(p.y, q.y) - 0.01, rib, 1, null, METAL);
    }
  }
}

// The brick run: the texture over each solid stretch of wall, a dark plinth, a soldier course and a cap
function brick(K, L, runs, c, { hex, top, H, accent, tex = 'roomBrick', surf = MATTE }) {
  const cap = hex6(c.trim, accent || '#2a2a2a');
  for (const [wall, rs] of Object.entries(runs)) {
    if (c.on && !c.on.includes(wall)) continue;
    for (let [a, b] of rs) {
      if (wall === 'left' || wall === 'right') { a = Math.max(a, 0); b = Math.min(b, L.d); }
      if (b - a < 0.15) continue;
      onWall(K, L, wall, a, b, 0, 0.024, 0, 0.14, '#1c1814', 1, null, MATTE);
      onWall(K, L, wall, a, b, 0, 0.012, 0.14, top, hex, 1, { t: tex, c: hex }, surf);
      if (top < H - 0.02) {
        if (tex === 'roomBrick') onWall(K, L, wall, a, b, 0, 0.02, top - 0.22, top, hex, 0.86, { t: tex, c: hex }, surf);
        onWall(K, L, wall, a, b, 0, 0.034, top, top + 0.05, cap, 1.05, null, SATIN);
      }
    }
  }
}

// ── the ceiling ───────────────────────────────────────────────────────────────────────────────────
// 'coffer': a lit cove round the edge and a grid of beams over the rest, each with a gold fillet;
// 'slot': a long light let into the ceiling down the room's length, the cove too; 'cove': the cove alone.
function ceiling(K, L, c, { H, accent, lampOn }) {
  if (c.kind === 'barrel') return barrel(K, L, c, { H });
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
    // a beam stops at the well of a flight going up through the ceiling, as the ceiling itself does (room-mesh.js)
    const wells = stairsOf(L.spec || {}).filter((o) => o.wall === 'ceiling').flatMap(wellBoxes);
    const beam = (u0, u1, v0, v1) => { for (const q of cutRects([u0 - 0.008, u1 + 0.008, v0 - 0.008, v1 + 0.008], wells)) { const r = [Math.max(q[0], u0), Math.min(q[1], u1), Math.max(q[2], v0), Math.min(q[3], v1)]; if (r[1] > r[0] && r[3] > r[2]) K.box(...r, H - bd, H - 0.001, hex, 1, null, MATTE); K.box(...q, H - bd - 0.012, H - bd, gold, 1.05, null, METAL); } };
    for (let i = 1; i < nu; i++) { const u = iu0 + i * (iu1 - iu0) / nu; beam(u - bw, u + bw, iv0, iv1); }
    for (let j = 1; j < nv; j++) { const v = iv0 + j * (iv1 - iv0) / nv; beam(iu0, iu1, v - bw, v + bw); }
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
    if (c.star === 'sunburst') { sunburst(K, cu, cv, R, c, y); return; }
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

// A runner down a hall's length: wool, a dark binding, two gold bands just in from its edges. `span` [from, to] lays
// it over only that stretch of the hall's length (u on a long room, v on a deep one), as a runner cut off partway.
function runner(K, L, c, { TEX }) {
  const hu = L.w / 2, D = L.d, long = c.along ? c.along === 'u' : L.w >= L.d, w = num(c.w, Math.min(1.2, (long ? D : L.w) * 0.5), 0.4, 4), end = num(c.end, 0.35, 0, 3);
  const hex = hex6(c.hex, '#1e2a3a'), band = hex6(c.border, '#a8823a'), t = TEX.roomWool, y = 0.012;
  const sp = Array.isArray(c.span) && c.span.length === 2 && c.span.every(Number.isFinite) ? [Math.min(...c.span), Math.max(...c.span)] : null;
  const [u0, u1, v0, v1] = long ? [sp ? Math.max(-hu + end, sp[0]) : -hu + end, sp ? Math.min(hu - end, sp[1]) : hu - end, D / 2 - w / 2, D / 2 + w / 2] : [-w / 2, w / 2, sp ? Math.max(end, sp[0]) : end, sp ? Math.min(D - end, sp[1]) : D - end];
  if (u1 - u0 < 0.2 || v1 - v0 < 0.2) return;
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
// A round bar from a to b ([u, v, y] each), `n` sides, capped at both ends unless `caps` is false: a barbell's sleeve,
// a plate on its side, a tube of the frame. `rod` is the six-sided one for runs of pipe nobody looks at up close.
function cyl(K, a, b, r, hex, k = 1, surf = METAL, n = 16, caps = true) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d) || 1, t = d.map((x) => x / l);
  const up = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const s = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]], sl = Math.hypot(...s);
  const e1 = s.map((x) => x / sl), e2 = [t[1] * e1[2] - t[2] * e1[1], t[2] * e1[0] - t[0] * e1[2], t[0] * e1[1] - t[1] * e1[0]];
  const P = (o, i) => { const g = i / n * Math.PI * 2, c = Math.cos(g) * r, q = Math.sin(g) * r; return [o[0] + e1[0] * c + e2[0] * q, o[1] + e1[1] * c + e2[1] * q, o[2] + e1[2] * c + e2[2] * q]; };
  const col = K.C(hex, k);
  for (let i = 0; i < n; i++) {
    const g = (i + 0.5) / n * Math.PI * 2, m = [e1[0] * Math.cos(g) + e2[0] * Math.sin(g), e1[1] * Math.cos(g) + e2[1] * Math.sin(g), e1[2] * Math.cos(g) + e2[2] * Math.sin(g)];
    K.quad(K.solid, [P(a, i), P(a, i + 1), P(b, i + 1), P(b, i)], K.nrmOf(m[0], m[2], m[1]), col, surf);
    if (!caps) continue;
    K.quad(K.solid, [a, P(a, i + 1), P(a, i), a], K.nrmOf(-t[0], -t[2], -t[1]), col, surf, null, true);
    K.quad(K.solid, [b, P(b, i), P(b, i + 1), b], K.nrmOf(t[0], t[2], t[1]), col, surf, null, true);
  }
}
// A cell's bars (room-layout.js cellsOf): round uprights floor to ceiling, painted and chipped to bare steel where hands
// go, flat bands across them, and a door of the same bars with its lock box. Grime collects at the foot of each.
function cells(K, L, { H }) {
  const PAINT = '#353d46', RAW = '#5e6368', RUST = '#3a2a20', top = H - 0.01;
  for (const c of cellsOf(L.spec)) {
    for (const [u, v] of c.bars) {
      K.lathe(u, v, [[0, 0], [CELL_BAR.r + 0.006, 0], [CELL_BAR.r + 0.006, 0.05], [CELL_BAR.r, 0.06], [CELL_BAR.r, 0.3]], RUST, 0.85, 12, SATIN);
      K.lathe(u, v, [[CELL_BAR.r, 0.3], [CELL_BAR.r, 1.02]], PAINT, 0.9, 12, SATIN);
      K.lathe(u, v, [[CELL_BAR.r, 1.02], [CELL_BAR.r * 0.96, 1.08], [CELL_BAR.r * 0.96, 1.28], [CELL_BAR.r, 1.34]], RAW, 0.95, 12, METAL);
      K.lathe(u, v, [[CELL_BAR.r, 1.34], [CELL_BAR.r, top - 0.06], [CELL_BAR.r + 0.008, top - 0.04], [CELL_BAR.r + 0.008, top], [0, top]], PAINT, 0.95, 12, SATIN);
    }
    for (const [p0, p1] of c.rails) {
      const alongU = Math.abs(p1[0] - p0[0]) > Math.abs(p1[1] - p0[1]), w = CELL_BAR.r + 0.012;
      for (const y of CELL_BAR.band) {
        if (alongU) K.box(Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), p0[1] - w, p0[1] + w, y, y + 0.05, PAINT, 0.9, null, SATIN);
        else K.box(p0[0] - w, p0[0] + w, Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1]), y, y + 0.05, PAINT, 0.9, null, SATIN);
      }
      // the floor's filth banked against the foot of the bars
      if (alongU) K.box(Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), p0[1] - 0.09, p0[1] + 0.09, 0, 0.006, '#2a241c', 0.7, null, MATTE);
      else K.box(p0[0] - 0.09, p0[0] + 0.09, Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1]), 0, 0.006, '#2a241c', 0.7, null, MATTE);
    }
    if (c.door) {
      const e = { front: 'u', back: 'u' }[c.door.side] || 'v', hw = (c.door.w || 0.8) / 2, at = c.door.at || 0;
      const line = c.rails.find(([p0, p1]) => (e === 'u' ? Math.abs(p1[0] - p0[0]) > 0.01 : Math.abs(p1[1] - p0[1]) > 0.01));
      if (line) {
        const fix = e === 'u' ? line[0][1] : line[0][0], pt = (s) => (e === 'u' ? [at + s, fix] : [fix, at + s]);
        for (const s of [-hw, hw]) { const [u, v] = pt(s); K.box(u - 0.03, u + 0.03, v - 0.03, v + 0.03, 0, top, PAINT, 0.85, null, SATIN); }
        const [lu, lv] = pt(hw - 0.09);
        K.box(lu - (e === 'u' ? 0.07 : 0.05), lu + (e === 'u' ? 0.07 : 0.05), lv - (e === 'u' ? 0.05 : 0.07), lv + (e === 'u' ? 0.05 : 0.07), 0.95, 1.2, '#2a2e33', 1, null, METAL);
        const [ku, kv] = pt(hw - 0.09);
        K.box(ku - 0.012, ku + 0.012, kv - 0.012, kv + 0.012, 1.04, 1.1, '#b89a4a', 1.1, null, METAL);
      }
    }
  }
}
// Standing water on a floor (`decor.puddles`: [{ at: [u, v], r: [ru, rv], seed }]): a dark glaze the room's lights slide
// on (the see-through layer only adds reflection here, so it can't darken the floor under the water). Its edge is a soft wobble off its seed (smoothed, so it rounds rather than spikes), and round it a wider, fainter
// film where the floor's still damp from it.
function puddles(K, list) {
  const n = 32;
  for (const c of list) {
    if (!Array.isArray(c?.at) || !c.at.every(Number.isFinite)) continue;
    const [u, v] = c.at, [ru, rv] = Array.isArray(c.r) ? c.r : [c.r || 0.4, c.r || 0.4], rr = mulberry(c.seed || Math.round(u * 97 + v * 31));
    const raw = Array.from({ length: n }, () => 0.86 + rr() * 0.22);
    const wob = raw.map((_, i) => (raw[(i + n - 2) % n] + 2 * raw[(i + n - 1) % n] + 3 * raw[i] + 2 * raw[(i + 1) % n] + raw[(i + 2) % n]) / 9);
    const ring = (k, y, tint) => {
      for (let i = 0; i < n; i++) {
        const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, w0 = wob[i] * k, w1 = wob[(i + 1) % n] * k;
        K.quad(K.solid, [[u, v, y], [u + Math.cos(a0) * ru * w0, v + Math.sin(a0) * rv * w0, y], [u + Math.cos(a1) * ru * w1, v + Math.sin(a1) * rv * w1, y], [u, v, y]], K.nrmOf(0, 1, 0), K.C(tint, 1), GLOSS, null, true);
      }
    };
    ring(1.15, 0.0015, '#a6a294');
    ring(1, 0.0025, '#86837a');
  }
}
// A ring of bronze round an upright axis: a torus, as a turned piece.
const torus = (K, u, v, R, r, y, hex, k = 1) => K.lathe(u, v, Array.from({ length: 9 }, (_, i) => { const a = -Math.PI / 2 + i / 8 * Math.PI * 2; return [R + Math.cos(a) * r, y + Math.sin(a) * r]; }), hex, k, Math.max(24, Math.round(R * 40)), METAL);

// A CHANDELIER: a canopy, a stem, tiers of bronze rings each hung with cut-glass drops and set with
// candle bulbs, and a cascade under the lowest. It lights the room as one of its six lamps.
function chandelier(K, L, c, { H, lampOn, lamps }) {
  if (c.kind === 'tiers') return tieredPendant(K, L, c, { H, lampOn, lamps });
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
function sconce(K, L, wall, a, y, { lampOn, hex, kind }) {
  if (kind === 'fan') return fanSconce(K, L, wall, a, y, { lampOn, hex });
  if (kind === 'twin') return twinSconce(K, L, wall, a, y, { lampOn, hex });
  onWall(K, L, wall, a - 0.045, a + 0.045, 0.016, 0.03, y - 0.17, y + 0.13, hex, 1.05, null, METAL);
  onWall(K, L, wall, a - 0.012, a + 0.012, 0.03, 0.1, y - 0.06, y - 0.03, hex, 1.05, null, METAL);
  const [su, sv] = wallPt(L, wall, a, 0.115);
  K.lathe(su, sv, [[0, y - 0.07], [0.012, y - 0.07], [0.012, y - 0.03], [0, y - 0.03]], hex, 1.05, 8, METAL);
  K.lathe(su, sv, [[0.045, y - 0.03], [0.07, y + 0.11], [0.066, y + 0.115], [0.04, y - 0.025]], lampOn ? '#ffe7c4' : '#d8cfc0', lampOn ? 1.55 : 0.85, 18, lampOn ? LAMP : undefined);
}
// Sconces along every solid run long enough for one, `gap` apart, clear of the run's ends.
// `points` ([[wall, a], ...]) puts them exactly where they go instead.
function sconces(K, L, runs, c, ctx) {
  const y = num(c.y, 1.75, 1, ctx.H - 0.3), gap = num(c.gap, 2.4, 0.8, 8), hex = hex6(c.hex, BRONZE), kind = c.kind;
  if (Array.isArray(c.points)) {
    for (const [wall, a] of c.points) if (['front', 'back', 'left', 'right'].includes(wall) && Number.isFinite(a)) sconce(K, L, wall, a, y, { lampOn: ctx.lampOn, hex, kind });
    return;
  }
  for (const [wall, rs] of Object.entries(runs)) {
    if (c.on && !c.on.includes(wall)) continue;
    for (let [a, b] of rs) {
      if (wall === 'left' || wall === 'right') { a = Math.max(a, 0); b = Math.min(b, L.d); }
      const len = b - a - 0.5;
      if (len < 0.4) continue;
      const n = Math.max(1, Math.floor(len / gap) + 1), step = n > 1 ? len / (n - 1) : 0;
      for (let i = 0; i < n; i++) sconce(K, L, wall, n > 1 ? a + 0.25 + i * step : (a + b) / 2, y, { lampOn: ctx.lampOn, hex, kind });
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
  const leaf = c.finish === 'steel' ? { hex: '#4a4e52', tex: null, surf: METAL } : c.finish === 'bronze' ? { hex: '#6e5236', tex: null, surf: METAL } : { hex: '#5a3a26', tex: WALNUT, surf: SATIN };
  for (const [p0, p1, q0, q1] of [[a0 - 0.06, a0, 0, DH + 0.06], [a1, a1 + 0.06, 0, DH + 0.06], [a0 - 0.06, a1 + 0.06, DH, DH + 0.06]]) onWall(K, L, wall, p0, p1, 0.02, 0.07, q0, q1, BRONZE, 1.05, null, METAL);
  onWall(K, L, wall, a0, a1, 0.02, 0.05, 0.004, DH, leaf.hex, 1, leaf.tex, leaf.surf);
  const s = toward(wall);
  if (c.pair) {
    // a lift's two leaves: a dark seam down the middle, each leaf with a chevron of gilt at eye height and nothing to push
    onWall(K, L, wall, a - 0.006, a + 0.006, 0.05, 0.056, 0.004, DH, '#120e0a', 1, null, METAL);
    for (const sg of [-1, 1]) chevron(K, L, wall, a + sg * w / 4, 1.55, Math.min(0.32, w / 2 - 0.12), 0.16, 0.057, hex6(c.trim, GOLD));
  } else {
    // a push plate and a kick plate, on the side away from the hinge
    const pa = a + s * (w / 2 - 0.12);
    onWall(K, L, wall, pa - 0.04, pa + 0.04, 0.05, 0.056, 0.95, 1.35, BRASS, 1.08, null, METAL);
  }
  onWall(K, L, wall, a0 + 0.03, a1 - 0.03, 0.05, 0.054, 0.02, 0.22, BRONZE, 1.02, null, METAL);
  if (c.dial !== undefined && c.dial !== false) liftDial(K, L, wall, a, DH + 0.1, Math.min(0.24, w * 0.2), Number.isFinite(c.dial) ? c.dial : 140);
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

// ── art deco ──────────────────────────────────────────────────────────────────────────────────────
// The pieces an old deco building finishes its lobby and halls with. Each is data like the rest:
//   floor.star 'sunburst'   the medallion as rays of two stones in a brass ring, `rays`, `ray`, `field`,
//                           and `half` (a wall) to fan it out from that wall instead of a full turn
//   frieze   { y, h, hex, line, on }               a dark band round the room with a gilt zigzag along it
//   pilasters { points: [[wall, a]], w, hex, y1 }   fluted, on a dark plinth, under a stepped capital
//   sconces.kind 'fan'                              a half shell of frosted glass on a stepped plate, lit up the wall
//   sconces.kind 'twin'                             two scrolled arms with candles in silk shades (gl/room-hotel.js)
//   lights[].kind 'tiers'                           a pendant of opal glass in tiers, widest at the top
//   doors[].finish 'bronze', .pair, .dial           a lift's two bronze leaves and the floor dial over them
// The along axis and the way out of a wall, in the room's frame, as [u, v].
const alongOf = (wall) => (wall === 'front' || wall === 'back' ? [1, 0] : [0, 1]);
const outVec = (wall) => (wall === 'front' ? [0, 1] : wall === 'back' ? [0, -1] : wall === 'left' ? [1, 0] : [-1, 0]);
// A flat face on a wall, `d` out from it, its corners given as [a along, y up].
function onFace(K, L, wall, d, pts, col, mat, raw = false) {
  K.quad(K.solid, pts.map(([a, y]) => [...wallPt(L, wall, a, d), y]), outOf(K, wall), col, mat, null, raw);
}
// Two chevrons, one over the other, pointing up: the mark on a lift's leaf.
function chevron(K, L, wall, a, y, w, h, d, hex) {
  const t = Math.max(0.018, h * 0.22), col = K.C(hex, 1.08);
  for (const dy of [0, -t * 1.9]) for (const sg of [-1, 1]) {
    const x0 = a + sg * w / 2, y0 = y - h / 2 + dy, y1 = y + h / 2 + dy;
    onFace(K, L, wall, d, [[x0, y0], [a, y1], [a, y1 + t], [x0, y0 + t]], col, METAL);
  }
}
// The angles a floor fan spans: a full turn, or the half facing into the room from `wall`.
function halfOf(wall) {
  const P = Math.PI;
  return wall === 'front' ? [0, P] : wall === 'back' ? [P, 2 * P] : wall === 'left' ? [-P / 2, P / 2] : wall === 'right' ? [P / 2, 1.5 * P] : [0, 2 * P];
}
// A SUNBURST let into the floor at [cu, cv]: rays of a warm stone between rays of a pale one, a brass strip
// between each pair, a black hub with a brass ring, a black ring round the whole and a brass line round that.
// A full one gets a square border of black and brass outside it, as a lobby floor sets its centrepiece.
function sunburst(K, cu, cv, R, c, y) {
  const n = Math.round(num(c.rays, 16, 4, 48)) * 2, A = hex6(c.ray, '#c49a52'), B = hex6(c.field, '#efe6d4'), dark = hex6(c.border, '#1c1916'), gold = hex6(c.line, GOLD);
  const [a0, a1] = halfOf(c.half), full = !c.half, P = (a, r, yy) => [cu + Math.cos(a) * r, cv + Math.sin(a) * r, yy], up = [0, 1, 0];
  const core = R * 0.16, arcN = Math.max(16, Math.round(64 * (a1 - a0) / (2 * Math.PI)));
  const arc = (r0, r1, col, k, surf, yy) => { for (let i = 0; i < arcN; i++) { const t0 = a0 + (a1 - a0) * i / arcN, t1 = a0 + (a1 - a0) * (i + 1) / arcN; K.quad(K.solid, [P(t0, r1, yy), P(t1, r1, yy), P(t1, r0, yy), P(t0, r0, yy)], up, K.C(col, k), surf); } };
  for (let i = 0; i < n; i++) {
    const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n, ray = i % 2 === 0;
    K.quad(K.solid, [P(t0, core, y + 0.0008), P(t0, R, y + 0.0008), P(t1, R, y + 0.0008), P(t1, core, y + 0.0008)], up, K.C(ray ? A : B, ray ? 1.02 : 1), GLOSS);
  }
  // the brass strips the terrazzo was poured between
  for (let i = 0; i <= n; i++) {
    if (full && i === n) break;
    const t = a0 + (a1 - a0) * i / n, s = [-Math.sin(t) * 0.007, Math.cos(t) * 0.007], p = P(t, core, 0), q = P(t, R, 0), yy = y + 0.0014;
    K.quad(K.solid, [[p[0] - s[0], p[1] - s[1], yy], [q[0] - s[0], q[1] - s[1], yy], [q[0] + s[0], q[1] + s[1], yy], [p[0] + s[0], p[1] + s[1], yy]], up, K.C(gold, 1.05), METAL);
  }
  arc(0, core, dark, 1, GLOSS, y + 0.001);
  arc(core - 0.018, core, gold, 1.05, METAL, y + 0.0016);
  arc(R, R + 0.14, dark, 1, GLOSS, y + 0.001);
  arc(R + 0.14, R + 0.16, gold, 1.05, METAL, y + 0.0016);
  if (!full) return;
  // the square round it: a black band and a brass line inside it, its corners stepped in twice
  const S = R + 0.42, b = 0.12, lay = (u0, u1, v0, v1, col, k, surf, yy) => K.quad(K.solid, [[u0, v0, yy], [u1, v0, yy], [u1, v1, yy], [u0, v1, yy]], up, K.C(col, k), surf);
  for (const [u0, u1, v0, v1] of [[-S, S, -S, -S + b], [-S, S, S - b, S], [-S, -S + b, -S + b, S - b], [S - b, S, -S + b, S - b]]) lay(cu + u0, cu + u1, cv + v0, cv + v1, dark, 1, GLOSS, y + 0.001);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) for (const k of [1, 2]) {
    const e = S - b - k * 0.14, f = e - 0.1;
    lay(cu + Math.min(sx * e, sx * f), cu + Math.max(sx * e, sx * f), cv + Math.min(sy * e, sy * f), cv + Math.max(sy * e, sy * f), k === 1 ? dark : gold, k === 1 ? 1 : 1.05, k === 1 ? GLOSS : METAL, y + 0.0012);
  }
}

// A FRIEZE round the room under the ceiling: a band of black glass on every solid run, a gilt line along its top
// and bottom, and a gilt zigzag between them.
function frieze(K, L, runs, c, { H, accent }) {
  const h = num(c.h, 0.24, 0.1, 0.8), y = num(c.y, H - 0.6, 0.5, H - h), band = hex6(c.hex, '#1e1c1a'), line = hex6(c.line, accent || GOLD);
  const t = Math.max(0.014, h * 0.12), m = h * 0.22, p = h * 1.25, col = K.C(line, 1.06);
  for (const [wall, rs] of Object.entries(runs)) {
    if (c.on && !c.on.includes(wall)) continue;
    for (let [a, b] of rs) {
      if (wall === 'left' || wall === 'right') { a = Math.max(a, 0); b = Math.min(b, L.d); }
      if (b - a < 0.3) continue;
      onWall(K, L, wall, a, b, 0.018, 0.03, y, y + h, band, 1, null, GLOSS);
      for (const y0 of [y, y + h - 0.016]) onWall(K, L, wall, a, b, 0.03, 0.034, y0, y0 + 0.016, line, 1.06, null, METAL);
      const n = Math.floor((b - a - 0.1) / (p / 2));
      if (n < 2) continue;
      const a0 = a + (b - a - n * p / 2) / 2;
      for (let i = 0; i < n; i++) {
        const x0 = a0 + i * p / 2, x1 = x0 + p / 2, lo = i % 2 === 0, y0 = lo ? y + m : y + h - m - t, y1 = lo ? y + h - m - t : y + m;
        onFace(K, L, wall, 0.031, [[x0, y0], [x1, y1], [x1, y1 + t], [x0, y0 + t]], col, METAL);
      }
    }
  }
}

// PILASTERS on the walls: a black plinth, a shaft with four flutes standing proud, and a capital of three steps,
// each wider and further out than the one under it.
function pilasters(K, L, c, { H }) {
  const w = num(c.w, 0.34, 0.15, 1), hex = hex6(c.hex, '#e8dfcc'), trim = hex6(c.trim, GOLD), top = num(c.y1, H - 0.3, 1.5, H) - 0.2, stone = { t: 'roomPlasterFine', c: hex };
  for (const pt of c.points || []) {
    if (!Array.isArray(pt) || !['front', 'back', 'left', 'right'].includes(pt[0]) || !Number.isFinite(pt[1])) continue;
    const [wall, a] = pt, hw = w / 2;
    onWall(K, L, wall, a - hw - 0.03, a + hw + 0.03, 0.016, 0.1, 0, 0.18, '#16120f', 1, null, GLOSS);
    onWall(K, L, wall, a - hw, a + hw, 0.016, 0.07, 0.18, top, hex, 1, stone, SATIN);
    const fw = w / 9;
    for (let i = 0; i < 4; i++) { const f0 = a - hw + fw * (1 + 2 * i); onWall(K, L, wall, f0, f0 + fw, 0.07, 0.085, 0.32, top - 0.14, hex, 1.07, stone, SATIN); }
    onWall(K, L, wall, a - hw - 0.01, a + hw + 0.01, 0.07, 0.074, top - 0.02, top, trim, 1.08, null, METAL);
    for (let i = 0; i < 3; i++) onWall(K, L, wall, a - hw - 0.025 * (i + 1), a + hw + 0.025 * (i + 1), 0.016, 0.085 + 0.015 * (i + 1), top + i * 0.065, top + (i + 1) * 0.065, hex, 1.03 + i * 0.02, stone, SATIN);
  }
}

// A FAN SCONCE: a stepped bronze plate, a half shell of frosted glass opening up the wall with three bronze ribs
// and a bronze lip, and the lamp showing through its open top.
function fanSconce(K, L, wall, a, y, { lampOn, hex }) {
  for (const [hw, y0, y1, d] of [[0.075, y - 0.2, y + 0.02, 0.026], [0.05, y + 0.02, y + 0.09, 0.024], [0.026, y + 0.09, y + 0.14, 0.022]]) onWall(K, L, wall, a - hw, a + hw, 0.014, d, y0, y1, hex, 1.05, null, METAL);
  const [au, av] = alongOf(wall), [ou, ov] = outVec(wall), N = 10, yb = y - 0.13, yt = y + 0.07, rb = 0.035, rt = 0.17, d0 = 0.026;
  const glow = lampOn ? '#ffe7c4' : '#d8cfc0', gk = lampOn ? 1.55 : 0.85;
  const P = (t, r, yy) => [...wallPt(L, wall, a + Math.cos(t) * r, d0 + Math.sin(t) * r), yy];
  for (let i = 0; i < N; i++) {
    const t0 = i / N * Math.PI, t1 = (i + 1) / N * Math.PI, tm = (t0 + t1) / 2, nu = au * Math.cos(tm) + ou * Math.sin(tm), nv = av * Math.cos(tm) + ov * Math.sin(tm);
    K.quad(K.solid, [P(t0, rb, yb), P(t1, rb, yb), P(t1, rt, yt), P(t0, rt, yt)], K.nrmOf(nu * 0.8, -0.6, nv * 0.8), K.C(glow, gk), lampOn ? LAMP : SATIN, null, lampOn);
    rod(K, P(t0, rt + 0.004, yt), P(t1, rt + 0.004, yt), 0.006, hex, 1.05);
    K.quad(K.solid, [P(t0, 0, yt - 0.01), P(t0, rt * 0.94, yt - 0.01), P(t1, rt * 0.94, yt - 0.01), P(t1, 0, yt - 0.01)], [0, 1, 0], K.C(lampOn ? '#fff1d6' : '#b8b0a2', lampOn ? 2.2 : 0.8), lampOn ? LAMP : SATIN, null, lampOn);
  }
  for (const t of [Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4]) rod(K, P(t, rb + 0.004, yb), P(t, rt + 0.004, yt), 0.005, hex, 1.05);
}

// A TIERED PENDANT: a stepped canopy, a stem, and tiers of opal glass under bronze bands, the smallest lowest,
// a ziggurat hung upside down. It lights the room as one of its lamps, as a chandelier does.
function tieredPendant(K, L, c, { H, lampOn, lamps }) {
  const [u, v] = c.at, R = num(c.r, 0.45, 0.2, 1.2), drop = num(c.drop, 1.1, 0.5, H - 1.9), n = Math.round(num(c.tiers, 3, 2, 4));
  const glass = lampOn ? '#ffe9c8' : '#d8d0c0', gk = lampOn ? 1.6 : 0.85, gm = lampOn ? LAMP : undefined, hex = hex6(c.hex, BRONZE);
  K.lathe(u, v, [[0, H - 0.1], [0.08, H - 0.1], [0.08, H - 0.07], [0.12, H - 0.07], [0.12, H - 0.04], [0.16, H - 0.04], [0.16, H], [0, H]], hex, 1.05, 24, METAL);
  const yb = H - drop, th = 0.13, gap = 0.035, top = yb + n * (th + gap);
  K.lathe(u, v, [[0.014, top], [0.014, H - 0.1]], hex, 1.05, 8, METAL);
  for (let i = 0; i < n; i++) {
    const r = R * (0.45 + 0.55 * i / Math.max(1, n - 1)), y0 = yb + i * (th + gap), y1 = y0 + th;
    K.lathe(u, v, [[0, y0], [r * 0.9, y0], [r, y1], [0, y1]], glass, gk, 28, gm);
    K.lathe(u, v, [[r + 0.012, y1], [r + 0.012, y1 + gap], [0, y1 + gap]], hex, 1.05, 28, METAL);
  }
  K.ball(u, v, yb - 0.03, 0.03, hex, 1.05, 10, METAL);
  lamps.push({ p: L.world(u, v, yb + (top - yb) * 0.5), annex: false, k: num(c.k, 1.3, 0.3, 3) });
}

// A LIFT'S FLOOR DIAL over its doors: a half disc of bronze with a black face, gilt marks for the floors and a
// needle at `deg` (0 is the right-hand end as you look at it, 180 the left), wherever the car last was.
function liftDial(K, L, wall, a, y, r, deg) {
  const s = toward(wall), N = 18, half = (rr, d, col, mat) => { for (let i = 0; i < N; i++) { const t0 = i / N * Math.PI, t1 = (i + 1) / N * Math.PI; onFace(K, L, wall, d, [[a, y], [a + s * Math.cos(t0) * rr, y + Math.sin(t0) * rr], [a + s * Math.cos(t1) * rr, y + Math.sin(t1) * rr], [a + s * Math.cos(t1) * rr, y + Math.sin(t1) * rr]], col, mat); } };
  onWall(K, L, wall, a - r - 0.05, a + r + 0.05, 0.016, 0.03, y - 0.03, y, BRONZE, 1.05, null, METAL);
  half(r + 0.04, 0.03, K.C(BRONZE, 1.05), METAL);
  half(r, 0.031, K.C('#0e0c0a', 1), GLOSS);
  const gilt = K.C(GOLD, 1.1);
  for (let k = 0; k <= 6; k++) {
    const t = k / 6 * Math.PI, c = s * Math.cos(t), q = Math.sin(t), w = 0.006;
    onFace(K, L, wall, 0.032, [[a + c * r * 0.72 - q * w * s, y + q * r * 0.72 + c * w * s], [a + c * r * 0.92 - q * w * s, y + q * r * 0.92 + c * w * s], [a + c * r * 0.92 + q * w * s, y + q * r * 0.92 - c * w * s], [a + c * r * 0.72 + q * w * s, y + q * r * 0.72 - c * w * s]], gilt, METAL);
  }
  const t = Math.max(0, Math.min(180, deg)) * Math.PI / 180, c = s * Math.cos(t), q = Math.sin(t), w = 0.005;
  onFace(K, L, wall, 0.033, [[a - q * w * s, y + c * w * s], [a + c * r * 0.86, y + q * r * 0.86], [a + c * r * 0.86, y + q * r * 0.86], [a + q * w * s, y - c * w * s]], gilt, METAL);
  onWall(K, L, wall, a - 0.018, a + 0.018, 0.031, 0.036, y - 0.004, y + 0.03, BRONZE, 1.1, null, METAL);
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
  if (dc.frieze && typeof dc.frieze === 'object') frieze(K, L, ctx.runs, dc.frieze, ctx);
  if (dc.pilasters && typeof dc.pilasters === 'object') pilasters(K, L, dc.pilasters, ctx);
  for (const c of dc.columns || []) if (Array.isArray(c) && c.length >= 2) column(K, c[0], c[1], c[2] || 0.3, { H: ctx.H, hex: hex6(dc.columnHex, '#f2ece2') });
  (dc.plants || []).forEach((c, i) => { if (Array.isArray(c) && c.length >= 2) plant(K, c[0], c[1], c[2] || 1, 0x51ed + i * 977); });
  (dc.art || []).forEach((c, i) => { if (c && typeof c === 'object') picture(K, L, c, i); });
  for (const c of dc.mirrors || []) if (c && typeof c === 'object') mirror(K, L, c, ctx);
  if (dc.pad && typeof dc.pad === 'object') landingPad(K, L, dc.pad, ctx);
  for (const c of dc.doors || []) if (c && typeof c === 'object') shutDoor(K, L, c, ctx);
  if (dc.plaques && typeof dc.plaques === 'object') plaques(K, L, dc.plaques);
  facility(K, L, dc, ctx);
  if (dc.cells) cells(K, L, ctx);
  if (dc.puddles) puddles(K, dc.puddles);
  // an old bar's: neon, pendants, fans, photographs, darts, a payphone, what's on the floor (gl/room-saloon.js)
  drawSaloonDecor(K, L, dc, ctx);
  // an old hotel's: raised letters, clocks, a directory board, standard lamps, picture lights (gl/room-hotel.js)
  drawHotelDecor(K, L, dc, ctx);
  // a room gone to seed: rubbish, magazines, damp, a leak and its bucket (gl/room-squat.js)
  drawSquatDecor(K, L, dc, ctx);
}

// ── A working building's dressing (a clone facility, a plant room) ───────────────────────────────────
// All of it is placed by the room's content file (flags.room.decor), none of it knows whose building it is:
//   strips  [{ at: [u, v], len, along: 'u'|'v', cage?, y? }] ceiling lights: a lit tube in a housing, or a caged bulkhead; y hangs it under a vault
//   pipes   [{ from, to, r, hex?, brackets? }]               a straight run of pipe [u, v, y] to [u, v, y], flanged; brackets: false hangs none to the ceiling
//   drops   [{ wall, along, n, r?, into? }]                   a bundle of cables down a wall from the ceiling, into the slab if `into`
//   paint   [{ kind: 'hazard'|'line'|'arrow'|'box', ... }]    floor markings: a striped band round a rect, a line, an arrow, an outline
//   grates  [[u, v, w, d]]                                    a drain or a walkway grating let into the floor
//   screens [{ wall, along, y, w, h, show }]                  a lit wall screen: 'vitals', 'ad' (with `text`), 'gauges' or 'status'
//   signs   [{ wall, along, y, text, ... }]                  lettering on a wall: painted by panels/room-signs.js as a decal, not drawn here
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
  const H0 = H;
  for (const s of dc.strips || []) {
    if (!Array.isArray(s?.at)) continue;
    const [u, v] = s.at, len = s.len || 1.2, U = s.along === 'u', hu = U ? len / 2 : 0.09, hv = U ? 0.09 : len / 2;
    // `y` hangs it lower than the flat ceiling: under a barrel vault, at the arch's own height there
    const H = Number.isFinite(s.y) ? s.y : H0;
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
    if (p.brackets !== false && Math.abs(p.from[2] - p.to[2]) < 0.01 && p.from[2] < H - 0.05) {
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
    // `y` sets a marking down on a lower floor (a pit's: spec.pit), its height under the room's
    K.lift(Number.isFinite(m.y) ? m.y : 0);
    const hex = m.hex || HAZ_A;
    if (m.kind === 'hazard' && Array.isArray(m.rect)) hazardBand(K, m.rect, m.t || 0.12);
    else if (m.kind === 'box' && Array.isArray(m.rect)) { const [u0, u1, v0, v1] = m.rect, t = m.t || 0.05; floorBox(K, u0, u1, v0, v0 + t, hex); floorBox(K, u0, u1, v1 - t, v1, hex); floorBox(K, u0, u0 + t, v0, v1, hex); floorBox(K, u1 - t, u1, v0, v1, hex); }
    else if (m.kind === 'line' && Array.isArray(m.from) && Array.isArray(m.to)) {
      const [a, b] = [m.from, m.to], t = (m.t || 0.06) / 2, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nu = -(b[1] - a[1]) / l * t, nv = (b[0] - a[0]) / l * t;
      K.quad(K.solid, [[a[0] - nu, a[1] - nv, 0.004], [b[0] - nu, b[1] - nv, 0.004], [b[0] + nu, b[1] + nv, 0.004], [a[0] + nu, a[1] + nv, 0.004]], K.nrmOf(0, 1, 0), K.C(hex, 1.05), SATIN, null, true);
      if (m.arrows) { const n = Math.max(1, Math.floor(l / 1.6)); for (let i = 1; i <= n; i++) { const t2 = i / (n + 1); floorArrow(K, [a[0] + (b[0] - a[0]) * t2, a[1] + (b[1] - a[1]) * t2], [b[0] - a[0], b[1] - a[1]], hex, 0.45); } }
    } else if (m.kind === 'arrow' && Array.isArray(m.at) && Array.isArray(m.dir)) floorArrow(K, m.at, m.dir, hex, m.s || 0.6);
  }
  K.lift(0);
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
  // signs aren't geometry: panels/room-signs.js paints them in the library's faces and lays them on as decals
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


// ── the vats' tubes (docs/proposals/clone-facility-depths.md) ───────────────────────────────────────
// Every vat recorded on the kit (K.vats, by the vat form) gets a big tube from its crown straight up to just under the
// ceiling, along the ceiling toward the middle of the room, and there up into one great trunk that goes on through
// the ceiling with all the others. The runs are set at three heights so crossing tubes pass over one another; the
// bends are swept round, cyan rings band them, and hangers hold the long runs.
// A tube's line is recorded on its vat (`path`, trunk end first, every bend as a run of points; `dropFrom`, how far
// along the straight drop into the vat starts) for gl/room-vat.js, which draws its windows and its bulge.
// a polyline with every corner swept round on a curve of up to `r`: [points, index where the last straight starts]
export function roundPath(pts, r) {
  const sub = (a, b) => a.map((x, i) => x - b[i]), len = (a) => Math.hypot(...a), unit = (a) => { const l = len(a) || 1; return a.map((x) => x / l); };
  const out = [pts[0]];
  let last = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], c = pts[i], b = pts[i + 1], li = len(sub(c, a)), lo = len(sub(b, c)), rr = Math.min(r, li * 0.45, lo * 0.45);
    if (rr < 0.02) { out.push(c); continue; }
    const din = unit(sub(c, a)), dout = unit(sub(b, c)), p0 = c.map((x, j) => x - din[j] * rr), p2 = c.map((x, j) => x + dout[j] * rr);
    for (let k = 0; k <= 10; k++) { const t = k / 10, u = 1 - t; out.push(p0.map((x, j) => u * u * x + 2 * u * t * c[j] + t * t * p2[j])); }
    last = out.length - 1;
  }
  out.push(pts[pts.length - 1]);
  return [out, last];
}
export function drawVatTubes(K, { H, D }) {
  const vs = (K.vats || []).filter((v) => v.ku != null);
  if (!vs.length) return;
  // the tubes are big enough for a body to come down (0.4 m round), dark and soft like a hose, with cyan rings round
  // them every 1.2 m; their windows, and the bulge as something goes down them, are gl/room-vat.js's
  const cu = 0, cv = D / 2, R = 0.4, trunkR = 1.1 + Math.min(0.6, vs.length * 0.05), bottom = Math.max(H - 2.7, Math.max(...vs.map((v) => v.crownTop)) + 1.2);
  // a ring of short rods round an axis: a collar you can see through the middle of
  const collar = (c, ax, r, rad, col, k = 1, mat = METAL) => {
    const a = Math.abs(ax[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1], b0 = [ax[1] * a[2] - ax[2] * a[1], ax[2] * a[0] - ax[0] * a[2], ax[0] * a[1] - ax[1] * a[0]], bl = Math.hypot(...b0), b = b0.map((x) => x / bl);
    const e = [ax[1] * b[2] - ax[2] * b[1], ax[2] * b[0] - ax[0] * b[2], ax[0] * b[1] - ax[1] * b[0]], N = 14;
    const P = (i) => { const t = i / N * Math.PI * 2; return c.map((x, j) => x + r * (b[j] * Math.cos(t) + e[j] * Math.sin(t))); };
    for (let i = 0; i < N; i++) rod(K, P(i), P(i + 1), rad, col, k, mat);
  };
  // a tube along a swept line: corrugated plastic hose, smoky grey and glossy so the vats' light runs along its ridges,
  // one skin round the bends (a frame carried along it), and a dim cyan ring every 1.2 m (they light up as something
  // passes: gl/room-vat.js)
  const HOSE = '#6a7c88', PITCH = 0.06, SIDES = 14;
  const tube = (pts) => {
    const segs = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) { const d = pts[i].map((x, j) => x - pts[i - 1][j]), l = Math.hypot(...d); if (l < 1e-4) continue; segs.push({ a: pts[i - 1], b: pts[i], l, ax: d.map((x) => x / l), s: total }); total += l; }
    if (!segs.length) return;
    const at = (s) => { const g = segs.find((q) => s <= q.s + q.l) || segs[segs.length - 1]; return { c: g.a.map((x, j) => x + g.ax[j] * (s - g.s)), ax: g.ax }; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
    // the rings of the skin, ridge and groove by turns
    const n = Math.max(2, Math.round(total / PITCH)), rings = [];
    let e1 = null;
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * total, { c, ax } = at(s);
      // the tangent eased across a bend's points, so the skin turns smoothly
      const t = unit(at(Math.max(0, s - 0.05)).ax.map((x, j) => x + at(Math.min(total, s + 0.05)).ax[j] + ax[j]));
      e1 = e1 ? unit(e1.map((x, j) => x - t[j] * (e1[0] * t[0] + e1[1] * t[1] + e1[2] * t[2]))) : unit(cross(t, Math.abs(t[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]));
      const e2 = cross(t, e1), r = i % 2 ? R * 0.955 : R;
      rings.push(Array.from({ length: SIDES }, (_, k) => { const g = (k / SIDES) * Math.PI * 2; return c.map((x, j) => x + (e1[j] * Math.cos(g) + e2[j] * Math.sin(g)) * r); }));
      rings[i].c = c;
    }
    for (let i = 0; i < n; i++) for (let k = 0; k < SIDES; k++) {
      const a = rings[i][k], b = rings[i][(k + 1) % SIDES], c = rings[i + 1][(k + 1) % SIDES], d = rings[i + 1][k];
      let nr = unit(cross(b.map((x, j) => x - a[j]), d.map((x, j) => x - a[j])));
      const out = a.map((x, j) => x - rings[i].c[j]);
      if (nr[0] * out[0] + nr[1] * out[1] + nr[2] * out[2] < 0) nr = nr.map((x) => -x);
      K.quad(K.solid, [a, b, c, d], K.nrmOf(nr[0], nr[2], nr[1]), K.C(HOSE, i % 2 ? 0.78 : 1.25), GLOSS);
    }
    for (let s = 0.6; s < total - 0.2; s += 1.2) { const g = at(s); collar(g.c, g.ax, R + 0.012, 0.016, '#4fe6ff', 1.15, GLOW); }
  };
  vs.forEach((v, i) => {
    const run = H - 0.5 - (i % 3) * 0.88, top = v.crownTop + 0.08;
    const dx = v.ku - cu, dz = v.kv - cv, dl = Math.hypot(dx, dz) || 1;
    const eu = cu + (dx / dl) * trunkR * 0.75, ev = cv + (dz / dl) * trunkR * 0.75;
    const A = [v.ku, v.kv, top], B = [v.ku, v.kv, run], C = [eu, ev, run], E = [eu, ev, bottom];
    const [line, lastBend] = roundPath(run > top + 0.1 ? [E, C, B, A] : [E, C, A], 0.95);
    if (K.at) {
      v.path = line.map((q) => K.at(q[0], q[1], q[2]));
      let total = 0, upTo = 0;
      for (let k = 1; k < line.length; k++) { total += Math.hypot(...line[k].map((x, j) => x - line[k - 1][j])); if (k === lastBend) upTo = total; }
      v.dropFrom = total ? upTo / total : 1;
      v.trunk = { c: K.at(cu, cv, bottom - 0.04), r: trunkR + 0.12, hub: K.at(cu, cv, bottom + 0.1) };
    }
    tube(line);
    // a hanger from the ceiling half way along the run
    const mu = (B[0] + C[0]) / 2, mv = (B[1] + C[1]) / 2;
    rod(K, [mu, mv, run + R], [mu, mv, H], 0.025, '#5a6266', 1, METAL);
  });
  // the trunk: a drum gathering them all, banded, a lit ring at its foot, going up through the ceiling
  // the underside is recessed: a pocket 0.7 m across and half a metre up, the gantry's hub hung in it, so the boom
  // swings under the rim instead of into the trunk (gl/room-vat.js armChain)
  K.lathe(cu, cv, [[0, bottom + 0.4], [0.5, bottom + 0.38], [0.68, bottom + 0.2], [0.72, bottom - 0.08], [0.8, bottom - 0.12], [trunkR * 0.6, bottom - 0.12], [trunkR + 0.1, bottom], [trunkR + 0.1, bottom + 0.08], [trunkR, bottom + 0.12], [trunkR, H + 0.02], [0, H + 0.02]], '#3a4248', 1, 40, METAL);
  for (let k = 0; k < 4; k++) torus(K, cu, cv, trunkR + 0.01, 0.025, bottom + 0.3 + k * ((H - bottom - 0.35) / 4), '#7d868c', 1);
  torus(K, cu, cv, trunkR + 0.1, 0.02, bottom - 0.02, '#4dffb0', 2);
  K.lathe(cu, cv, [[0, bottom + 0.399], [0.48, bottom + 0.379]], '#1a2a24', 1, 32, GLOW);
  K.lathe(cu, cv, [[0, bottom + 0.02], [0.18, bottom + 0.06], [0.24, bottom + 0.2], [0.34, bottom + 0.37], [0, bottom + 0.39]], '#2b3034', 1, 24, METAL);
}

// ── the forms a hotel's furniture needs ───────────────────────────────────────────────────────────
// Called from room-mesh.js drawPiece with the piece's own frame; true when it drew the piece.
export function drawDecorForm(K, F, p) {
  const { P, pbox } = F, w = p.w, d = p.d, h = p.h, hw = w / 2, hd = d / 2;
  const marble = { t: 'roomMarble', c: '#f4efe6' }, dress = p.dress || '';
  // an old hotel's key wall, sofa, wing chair, low table, luggage cart and desk (gl/room-hotel.js)
  if (drawHotelForm(K, F, p)) return true;
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
    case 'awning': {
      // a terrace awning: four slim bronze posts and a canvas over them in cream and the Solenne's cyan, striped
      // along its length, falling a little to the front, with a scalloped valance round three sides. Things stand
      // under it (room-layout.js treats it as overhead, as a rug is under), so nothing here reaches the floor but the posts.
      const BR = '#8a6a3c', CREAM = '#efe6d2', CYAN = '#26c4e2', back = h, front = h - 0.22, n = 8;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const top = sz < 0 ? back : front;
        rod(K, P(sx * (hw - 0.05), 0, sz * (hd - 0.05)), P(sx * (hw - 0.05), top, sz * (hd - 0.05)), 0.028, BR, 1.1, METAL);
        K.ball(...P(sx * (hw - 0.05), top + 0.02, sz * (hd - 0.05)), 0.04, BR, 1.1, 10, METAL);
      }
      // the canvas in strips, back to front, each a touch lower than the one behind it
      for (let i = 0; i < n; i++) {
        const z0 = -hd + (2 * hd) * (i / n), z1 = -hd + (2 * hd) * ((i + 1) / n), y = back + (front - back) * ((i + 0.5) / n);
        pbox(-hw, hw, y, y + 0.025, z0, z1 + 0.002, i % 2 ? CYAN : CREAM, 1, null, MATTE);
      }
      // the valance: a short drop of scallops along the front and down the two sides
      for (let i = 0; i < 12; i++) { const x0 = -hw + (2 * hw) * (i / 12), x1 = x0 + (2 * hw) / 12; pbox(x0, x1 - 0.01, front - 0.16 + (i % 2) * 0.03, front, hd - 0.01, hd + 0.005, i % 2 ? CYAN : CREAM, 1, null, MATTE); }
      for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
        const z0 = -hd + (2 * hd) * (i / 6), z1 = z0 + (2 * hd) / 6, y = back + (front - back) * ((i + 0.5) / 6);
        pbox(s < 0 ? -hw - 0.005 : hw - 0.01, s < 0 ? -hw + 0.01 : hw + 0.005, y - 0.15 + (i % 2) * 0.03, y, z0, z1 - 0.01, i % 2 ? CYAN : CREAM, 1, null, MATTE);
      }
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
    case 'petbowl': {
      // a pet's feeding station (plugins/pets): a rubber mat with a lip, a steel dish of biscuits on the left and a steel
      // bowl of water on the right. `food` and `water` are how full each is, 0 to 1 (the piece's state, room.pieceState),
      // so the biscuits go down as he eats and the water as he drinks
      const c = { F, K }, rr = rng(p.seed || 11), mat = '#34444c';
      pbox(-hw, hw, 0, 0.005, -hd, hd, mat, 1, null, MATTE);
      for (const s of [-1, 1]) { pbox(-hw, hw, 0.005, 0.011, s < 0 ? -hd : hd - 0.012, s < 0 ? -hd + 0.012 : hd, mat, 0.9, null, MATTE); pbox(s < 0 ? -hw : hw - 0.012, s < 0 ? -hw + 0.012 : hw, 0.005, 0.011, -hd, hd, mat, 0.9, null, MATTE); }
      const R = Math.min(hd - 0.03, hw / 2 - 0.02), H = Math.min(h - 0.008, 0.058), y0 = 0.005;
      // the bowl's wall, out and in, and the floor of it
      const wall = [[0, y0], [R * 0.66, y0], [R * 0.74, y0 + 0.006], [R, y0 + H], [R * 1.04, y0 + H + 0.003], [R * 0.97, y0 + H + 0.004], [R * 0.9, y0 + H * 0.5], [R * 0.66, y0 + 0.01], [0, y0 + 0.01]];
      const inner = (y) => R * 0.66 + (R * 0.94 - R * 0.66) * Math.max(0, Math.min(1, (y - y0 - 0.01) / (H - 0.006)));
      for (const [x, kind] of [[-hw / 2, 'food'], [hw / 2, 'water']]) {
        const [u, v] = P(x, 0, 0);
        K.lathe(u, v, wall, '#c9cfd4', 1.12, 28, METAL);
        const lvl = Math.max(0, Math.min(1, Number(p[kind]) || 0)), top = y0 + 0.01 + (H - 0.012) * lvl;
        if (lvl <= 0.01) continue;
        if (kind === 'water') { liquidLathe(c, x, 0, [[0, y0 + 0.01], [inner(top) * 0.97, y0 + 0.01], [inner(top) * 0.97, top], [0, top]], '#a8cfdc', 1.05, 24); continue; }
        // the biscuits: a low mound to the level, and loose ones on top of it, two browns
        const r = inner(top) * 0.96;
        K.lathe(u, v, [[0, y0 + 0.01], [r, y0 + 0.01], [r, top - 0.004], [r * 0.6, top + 0.002], [0, top + 0.004]], '#6e4626', 1, 18, MATTE);
        const n = Math.round(8 + 22 * lvl);
        for (let i = 0; i < n; i++) {
          const a = rr() * Math.PI * 2, d = Math.sqrt(rr()) * (r - 0.006), y = top + 0.002 * (1 - d / r) + rr() * 0.002;
          const [bu, bv] = P(x + Math.cos(a) * d, 0, Math.sin(a) * d);
          K.ball(bu, bv, y, 0.0045 + rr() * 0.0015, rr() < 0.5 ? '#8a5a30' : '#5e3a1c', 1, 6, SATIN);
        }
      }
      return true;
    }
    case 'littertray': {
      // a pet's litter tray (plugins/pets): a plastic tray with a high back and low front, grey litter in it, and what he's
      // left: `pee` clumps and `poo` (how many of each since it was scooped) half dug in, and `mess`, what he did on the
      // floor beside it once it was too dirty to get into (the piece's state, room.pieceState). A scoop leans on the back.
      const plastic = '#8fa7b3', lip = '#a9bec8', y0 = 0.004, back = h, front = Math.min(h, 0.1), t = 0.012;
      pbox(-hw, hw, 0, y0, -hd, hd, plastic, 0.9, null, SATIN);
      pbox(-hw, hw, y0, back, -hd, -hd + t, plastic, 1, null, SATIN);
      pbox(-hw, hw, y0, front, hd - t, hd, plastic, 1, null, SATIN);
      for (const s of [-1, 1]) {
        // the sides step down from the back to the front
        pbox(s < 0 ? -hw : hw - t, s < 0 ? -hw + t : hw, y0, front, -hd + t, hd - t, plastic, 1, null, SATIN);
        pbox(s < 0 ? -hw : hw - t, s < 0 ? -hw + t : hw, front, back, -hd + t, -hd + (hd * 2) * 0.35, plastic, 1, null, SATIN);
      }
      pbox(-hw - 0.006, hw + 0.006, back, back + 0.008, -hd - 0.006, -hd + t + 0.004, lip, 1.05, null, SATIN);
      pbox(-hw - 0.006, hw + 0.006, front, front + 0.008, hd - t - 0.004, hd + 0.006, lip, 1.05, null, SATIN);
      // the litter, a little humped and dug about
      const ly = 0.05, ir = (i, n) => rng((p.seed || 13) + i * 7919 + n * 104729);
      pbox(-hw + t, hw - t, y0, ly, -hd + t, hd - t, '#cfc8b8', 1, null, MATTE);
      for (let i = 0; i < 9; i++) { const r = ir(i, 0), x = (r() - 0.5) * (w - 0.1), z = (r() - 0.5) * (d - 0.1), [u, v] = P(x, 0, z); K.lathe(u, v, [[0, ly], [0.05 + r() * 0.03, ly], [0, ly + 0.006 + r() * 0.006]], '#d8d1c2', 1, 8, MATTE); }
      const pee = Math.max(0, Math.min(8, Number(p.pee) || 0)), poo = Math.max(0, Math.min(4, Number(p.poo) || 0));
      for (let i = 0; i < pee; i++) {
        const r = ir(i, 1), x = (r() - 0.5) * (w - 0.12), z = (r() - 0.5) * (d - 0.12), [u, v] = P(x, 0, z), s = 0.02 + r() * 0.012;
        K.lathe(u, v, [[0, ly - 0.004], [s, ly - 0.002], [s * 0.8, ly + s * 0.5], [0, ly + s * 0.6]], '#a4977c', 1, 9, MATTE);
      }
      for (let i = 0; i < poo; i++) {
        const r = ir(i, 2), x = (r() - 0.5) * (w - 0.14), z = (r() - 0.5) * (d - 0.14), a = r() * Math.PI;
        for (let j = 0; j < 2 + Math.round(r()); j++) {
          const o = (j - 0.8) * 0.032, b = a + (r() - 0.5) * 0.9;
          const c0 = P(x + Math.cos(a) * o, ly + 0.008, z + Math.sin(a) * o), c1 = P(x + Math.cos(a) * o + Math.cos(b) * 0.028, ly + 0.01, z + Math.sin(a) * o + Math.sin(b) * 0.028);
          rod(K, c0, c1, 0.0085, '#4a3020', 1, SATIN);
        }
      }
      // the scoop, leant on the back
      rod(K, P(hw - 0.08, back + 0.13, -hd - 0.035), P(hw - 0.1, 0.02, -hd - 0.07), 0.008, '#3a6a8a', 1, SATIN);
      pbox(hw - 0.15, hw - 0.05, 0.005, 0.012, -hd - 0.13, -hd - 0.04, '#3a6a8a', 1, null, SATIN);
      // what he did beside it: in front of the tray, a puddle or a pile on the floor
      (Array.isArray(p.mess) ? p.mess.slice(0, 6) : []).forEach((kind, i) => {
        const r = ir(i, 3), x = (r() - 0.5) * (w + 0.2), z = hd + 0.12 + r() * 0.25, [u, v] = P(x, 0, z);
        if (kind === 'poo') { for (let j = 0; j < 3; j++) { const a = r() * Math.PI; rod(K, P(x + (j - 1) * 0.03, 0.01, z), P(x + (j - 1) * 0.03 + Math.cos(a) * 0.03, 0.012, z + Math.sin(a) * 0.03), 0.009, '#4a3020', 1, SATIN); } }
        else K.lathe(u, v, [[0, 0.0016], [0.07 + r() * 0.05, 0.0016], [0.085 + r() * 0.05, 0.0006]], '#6e6232', 0.7, 18, GLOSS);
      });
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
    case 'pullup': {
      // a pull-up and dip frame, welded from square tube and bolted through the slab: two uprights at the back carrying
      // the pull-up bar across the top (knurled where the hands go, worn bright), braced back to the wall; out front a
      // pair of dip handles on a lower frame, their grips taped. Everything that could come off is welded on
      const FR = '#2a2d31', BOLT = '#8a8f94', top = Math.min(h - 0.04, 2.35), zb = -hd + 0.12, zf = hd - 0.18, dy = 1.22, gap = 0.27;
      const tube = (x0, x1, y0, y1, z0, z1) => pbox(x0, x1, y0, y1, z0, z1, FR, 1.02, null, SATIN);
      for (const s of [-1, 1]) {
        const x = s * (hw - 0.06);
        // the base plate and its bolts, the upright, and the brace back to the wall
        pbox(x - 0.08, x + 0.08, 0, 0.012, zb - 0.1, zb + 0.1, FR, 0.95, null, SATIN);
        for (const [dx, dz] of [[-0.05, -0.06], [0.05, -0.06], [-0.05, 0.06], [0.05, 0.06]]) cyl(K, P(x + dx, 0.012, zb + dz), P(x + dx, 0.024, zb + dz), 0.01, BOLT, 1, METAL, 6);
        tube(x - 0.035, x + 0.035, 0.012, top, zb - 0.035, zb + 0.035);
        pbox(x - 0.03, x + 0.03, top - 0.05, top, -hd, zb, FR, 1, null, SATIN);
        // the floor rail out to the dip frame, and the dip frame's upright
        tube(x - 0.03, x + 0.03, 0.012, 0.07, zb, zf);
        const xd = s * gap;
        pbox(xd - 0.07, xd + 0.07, 0, 0.012, zf - 0.08, zf + 0.08, FR, 0.95, null, SATIN);
        tube(xd - 0.03, xd + 0.03, 0.012, dy, zf - 0.03, zf + 0.03);
        tube(Math.min(x, xd) - 0.025, Math.max(x, xd) + 0.025, 0.04, 0.09, zf - 0.025, zf + 0.025);
        // the dip handle: a round bar from the upright back toward the frame, its grip wrapped in tape
        cyl(K, P(xd, dy, zf + 0.02), P(xd, dy, zb + 0.38), 0.019, '#b8bcc0', 1.05, METAL, 12);
        cyl(K, P(xd, dy, zf - 0.08), P(xd, dy, zb + 0.5), 0.022, '#3a3a38', 0.95, SATIN, 12);
        // a gusset at each weld that takes the load
        pbox(xd - 0.005, xd + 0.005, dy - 0.12, dy, zf - 0.1, zf, FR, 1, null, SATIN);
      }
      // the pull-up bar between the uprights, over the front of them, and its worn grips
      const yb = top - 0.03, zbar = zb + 0.06;
      cyl(K, P(-hw + 0.06, yb, zbar), P(hw - 0.06, yb, zbar), 0.016, '#b8bcc0', 1.05, METAL, 14);
      for (const s of [-1, 1]) for (let x = 0.18; x < 0.42; x += 0.03) cyl(K, P(s * x, yb, zbar), P(s * (x + 0.012), yb, zbar), 0.0166, '#d8dce0', 1.1, METAL, 14, false);
      // a cross tube at the top behind the bar, holding the uprights square
      tube(-hw + 0.06, hw - 0.06, top - 0.07, top - 0.02, zb - 0.06, zb - 0.02);
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
      // A flat bench press, welded and bolted down. The frame is square tube on two splayed feet with rubber caps,
      // the pad a crowned slab of cracked vinyl patched with tape, and the head end between two uprights drilled for
      // the J-hooks and the safety pins. The bar is racked on the hooks over where the eyes go, knurled where the hands
      // take it, with sleeves, collars and two plates a side: `look.dress` 'concrete' (the precinct's, poured from the
      // walls' own mix) or iron. While somebody is pressing (`racked: false`, plugins/roomstage) the hooks are empty and
      // the bar is drawn in their hands (gl/room-held.js).
      const FR = '#2a2d31', CAP = '#141416', BOLT = '#8a8f94', pad = 0.45, zr = -hd + 0.36, by = Math.min(h - 0.12, 1.08), px = Math.min(hw - 0.22, 0.56);
      const concrete = p.dress === 'concrete';
      const tube = (x0, x1, y0, y1, z0, z1) => pbox(x0, x1, y0, y1, z0, z1, FR, 1.02, null, SATIN);
      // the spine and its feet: a long tube under the pad, a post down at each end to a cross foot
      tube(-0.03, 0.03, 0.2, 0.26, -hd + 0.12, hd - 0.18);
      for (const z of [-hd + 0.2, hd - 0.26]) {
        tube(-0.025, 0.025, 0.04, 0.2, z - 0.025, z + 0.025);
        tube(-0.24, 0.24, 0, 0.05, z - 0.03, z + 0.03);
        for (const s of [-1, 1]) cyl(K, P(s * 0.24, 0.025, z), P(s * 0.27, 0.025, z), 0.032, CAP, 0.9, SATIN, 10);
      }
      // a gusset where each post meets the spine, and the bolts through the pad's board
      for (const z of [-hd + 0.2, hd - 0.26]) pbox(-0.006, 0.006, 0.14, 0.2, z - 0.07, z + 0.07, FR, 1, null, SATIN);
      tube(-0.12, 0.12, 0.26, 0.28, -hd + 0.1, hd - 0.16);
      // the pad: a board, the foam slab and its crown, piping down each side, a split patched with grey tape
      const z0 = -hd + 0.08, z1 = hd - 0.14, VIN = '#1b1c1f';
      pbox(-0.15, 0.15, 0.28, pad - 0.04, z0, z1, VIN, 0.95, null, LEATHER);
      pbox(-0.135, 0.135, pad - 0.04, pad - 0.012, z0 + 0.015, z1 - 0.015, VIN, 1, null, LEATHER);
      pbox(-0.11, 0.11, pad - 0.012, pad, z0 + 0.03, z1 - 0.03, '#222327', 1.02, null, LEATHER);
      for (const s of [-1, 1]) cyl(K, P(s * 0.15, pad - 0.04, z0), P(s * 0.15, pad - 0.04, z1), 0.008, '#0e0f11', 1, LEATHER, 6);
      // worn pale where shoulders and backsides go, and the tape over the split
      pbox(-0.08, 0.08, pad + 0.0005, pad + 0.001, z0 + 0.08, z0 + 0.38, '#3a3a3c', 1, null, LEATHER);
      pbox(-0.09, 0.09, pad + 0.0005, pad + 0.001, z1 - 0.4, z1 - 0.14, '#38383a', 1, null, LEATHER);
      pbox(-0.04, 0.06, pad + 0.001, pad + 0.002, z0 + 0.6, z0 + 0.72, '#8a8a84', 1.05, null, SATIN);
      pbox(0.02, 0.1, pad + 0.001, pad + 0.002, z0 + 0.66, z0 + 0.7, '#7a7a74', 1.05, null, SATIN);
      // the uprights: square tube on a base plate bolted through the slab, a row of holes, a J-hook and a safety pin
      for (const s of [-1, 1]) {
        const x = s * px;
        pbox(x - 0.09, x + 0.09, 0, 0.012, zr - 0.22, zr + 0.22, FR, 0.95, null, SATIN);
        for (const [dx, dz] of [[-0.06, -0.17], [0.06, -0.17], [-0.06, 0.17], [0.06, 0.17]]) cyl(K, P(x + dx, 0.012, zr + dz), P(x + dx, 0.024, zr + dz), 0.011, BOLT, 1, METAL, 6);
        tube(x - 0.035, x + 0.035, 0.012, by + 0.18, zr - 0.035, zr + 0.035);
        cyl(K, P(x, by + 0.18, zr), P(x, by + 0.19, zr), 0.02, CAP, 1, SATIN, 4);
        for (let y = 0.5; y < by + 0.14; y += 0.06) pbox(x - 0.012, x + 0.012, y, y + 0.022, zr + 0.0355, zr + 0.036, '#0a0b0c', 1, null, MATTE);
        // the J-hook: a back plate, the cup the bar sits in and its lip, lined with nylon
        pbox(x - 0.04, x + 0.04, by - 0.08, by + 0.03, zr + 0.035, zr + 0.05, FR, 1.05, null, SATIN);
        pbox(x - 0.04, x + 0.04, by - 0.08, by - 0.06, zr + 0.05, zr + 0.13, FR, 1.05, null, SATIN);
        pbox(x - 0.04, x + 0.04, by - 0.06, by - 0.01, zr + 0.12, zr + 0.135, FR, 1.05, null, SATIN);
        pbox(x - 0.036, x + 0.036, by - 0.061, by - 0.058, zr + 0.05, zr + 0.12, '#d8d2c0', 1, null, SATIN);
        // the safety pin, a hand lower, through the upright and out the front
        cyl(K, P(x, 0.62, zr - 0.05), P(x, 0.62, zr + 0.34), 0.013, '#b8bcc0', 1.08, METAL, 8);
        cyl(K, P(x, 0.62, zr + 0.34), P(x, 0.62, zr + 0.36), 0.022, CAP, 1, SATIN, 8);
      }
      // the bar on the hooks, unless somebody's got it
      if (p.racked !== false) {
        const yb = by - 0.06 + 0.014, zb = zr + 0.09, half = Math.max(hw + 0.18, px + 0.42), CHROME = '#d6dade';
        // the shaft: smooth in the middle, knurled where the hands go (darker rings), a sleeve stop, then the sleeve
        cyl(K, P(-px + 0.1, yb, zb), P(px - 0.1, yb, zb), 0.014, CHROME, 1.08, METAL, 12, false);
        for (const s of [-1, 1]) {
          for (let x = 0.12; x < px - 0.12; x += 0.03) cyl(K, P(s * x, yb, zb), P(s * (x + 0.012), yb, zb), 0.0146, '#8e9298', 1, METAL, 12, false);
          cyl(K, P(s * (px - 0.1), yb, zb), P(s * (px + 0.06), yb, zb), 0.014, CHROME, 1.08, METAL, 12, false);
          cyl(K, P(s * (px + 0.06), yb, zb), P(s * (px + 0.085), yb, zb), 0.03, CHROME, 1.08, METAL, 14);
          cyl(K, P(s * (px + 0.085), yb, zb), P(s * half, yb, zb), 0.025, '#c4c8cc', 1.05, METAL, 14);
          // two plates a side, the big one inside, and the spring collar holding them
          const PL = concrete ? '#8a8578' : '#1a1b1d', plate = (x0, x1, r) => {
            cyl(K, P(s * x0, yb, zb), P(s * x1, yb, zb), r, PL, concrete ? 0.95 : 1, concrete ? MATTE : SATIN, 20);
            cyl(K, P(s * (x0 - 0.002), yb, zb), P(s * (x1 + 0.002), yb, zb), 0.045, concrete ? '#6a665c' : '#2a2b2e', 1, SATIN, 12);
          };
          plate(px + 0.1, px + 0.16, 0.225);
          plate(px + 0.165, px + 0.21, 0.17);
          cyl(K, P(s * (px + 0.215), yb, zb), P(s * (px + 0.24), yb, zb), 0.034, '#9aa0a6', 1.1, METAL, 10);
          // a chip out of a concrete plate's rim, showing the rebar ring
          if (concrete) cyl(K, P(s * (px + 0.12), yb + 0.2, zb + 0.05), P(s * (px + 0.14), yb + 0.2, zb + 0.05), 0.02, '#6a4a32', 1, METAL, 6);
        }
      }
      // chalk on the floor under the hands, and a towel over the foot of the bench
      pbox(-0.5, 0.5, 0.001, 0.002, zr - 0.2, zr + 0.25, '#4a4844', 1, null, MATTE);
      pbox(-0.17, 0.17, pad - 0.06, pad + 0.012, z1 - 0.12, z1 + 0.01, '#8a8270', 0.9, null, CLOTH);
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
      // `look.level` how full it stands (the sleeper stays in it at any level), `look.sleeper: false` nobody in it
      // `look.state: 'release'` is a release vat: standing dry and empty, its front shut, waiting for a body to come
      // down its tube (docs/proposals/clone-facility-depths.md)
      const release = p.state === 'release';
      const fullTop = crown - 0.05, level = drained ? 1 : release ? 0 : Math.max(0, Math.min(1, p.level ?? 1)), sleeper = !drained && !release && p.sleeper !== false;
      const [u, v] = P(0, 0, 0), tube = R * 0.9, fluidTop = drained ? base + 0.06 : base + (fullTop - base) * level;
      // what gl/room-vat.js needs to fill it: the column, the sleeper as capsules (a, b, radius) and its mouth, all
      // in the room's world; and the static fluid's run in the glass, which the room skips once the layer draws it
      const W = (x, y, z) => { const [a, b] = P(x, 0, z); return K.at ? K.at(a, b, y) : null; };
      const vat = K.vats && K.at ? { c: K.at(u, v, base), r: tube - 0.012, h: (drained ? fluidTop : fullTop) - base, level, sleeper, fluid: p.fluid || (drained ? '#3a7a60' : '#46e0a8'), seed: p.seed || 7, state: p.state || 'full', caps: [], mouth: null, glass: null, id: p.id ?? null, top: fluidTop, release, ku: u, kv: v, crownTop: h + (p.y0 || 0), crown: crown - base, front: (() => { const a = K.at(...P(0, 0, 0)), b = K.at(...P(0, 0, 1)); return [b[0] - a[0], 0, b[2] - a[2]]; })() } : null;
      // the plinth, stepped, with a lit ring where the glass seats
      K.lathe(u, v, [[0, 0], [R + 0.06, 0], [R + 0.06, 0.08], [R + 0.02, 0.12], [R + 0.02, base - 0.05], [tube + 0.03, base], [0, base]], '#c9ced3', 1.05, 36, METAL);
      // the drain it empties into, in the floor round its foot: a dark sump under a ring of slats
      if (vat) {
        K.lathe(u, v, [[R + 0.07, 0.002], [R + 0.32, 0.002]], '#0c0e0f', 1, 40, MATTE);
        for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); rod(K, [u + c * (R + 0.08), v + s * (R + 0.08), 0.006], [u + c * (R + 0.31), v + s * (R + 0.31), 0.006], 0.009, '#7d868c', 1, METAL); }
        torus(K, u, v, R + 0.32, 0.012, 0.006, '#5a6266', 1);
      }
      const ring = drained ? '#ff8a3a' : release ? '#ffc86a' : '#5fffc0';
      torus(K, u, v, tube + 0.01, 0.018, base + 0.01, ring, 1.6);
      // a release vat's floor is a steel grille over the drain, lit from under; the others glow with their fluid
      if (release) {
        K.lathe(u, v, [[0, base + 0.002], [tube, base + 0.002]], '#2a2e30', 1, 32, METAL);
        for (let i = -4; i <= 4; i++) { const x = (i / 4.6) * tube, l = Math.sqrt(Math.max(0, tube * tube - x * x)); rod(K, [...P(x, 0, -l + 0.01)].slice(0, 2).concat(base + 0.006), [...P(x, 0, l - 0.01)].slice(0, 2).concat(base + 0.006), 0.006, '#ffd590', 1.8, GLOW); }
      } else K.lathe(u, v, [[0, base + 0.002], [tube, base + 0.002]], drained ? '#ff9a5a' : '#7affd0', drained ? 1.4 : 2.2, 32, GLOW);
      // the sleeper: upright in the fluid, a little off the floor, head bowed, arms loose, knees soft. Where the room's
      // renderer fills the vat (`vat`), the Room Stage puts a close-up figure in it instead (room-stage.js vatSleepers),
      // and these numbers are only the fluid's stand-in body until that figure's own capsules arrive.
      if (sleeper) {
        const skin = '#b8c9b4', lift = 0.12 + rr() * 0.06, y0 = base + lift, sx = (rr() - 0.5) * 0.04, [bu, bv] = P(sx, 0, 0.02);
        if (!vat) for (const s of [-1, 1]) {
          const [lu, lv] = P(sx + s * 0.075, 0, 0.02 + (s > 0 ? 0.03 : 0));
          K.lathe(lu, lv, [[0, y0], [0.045, y0 + 0.02], [0.05, y0 + 0.42], [0.062, y0 + 0.5], [0.078, y0 + 0.82], [0, y0 + 0.86]], skin, 1, 14, SATIN);
        }
        if (!vat) K.lathe(bu, bv, [[0, y0 + 0.8], [0.15, y0 + 0.84], [0.14, y0 + 1.0], [0.13, y0 + 1.12], [0.17, y0 + 1.3], [0.12, y0 + 1.38], [0.05, y0 + 1.42], [0, y0 + 1.42]], skin, 1, 18, SATIN);
        const [hu2, hv2] = P(sx, 0, 0.06);
        if (!vat) K.ball(hu2, hv2, y0 + 1.53, 0.1, skin, 1, 16, SATIN);
        if (!vat) for (const s of [-1, 1]) {
          const a = P(sx + s * 0.18, 0, 0.0), b = P(sx + s * 0.22, 0, 0.05), e = P(sx + s * 0.2, 0, 0.1);
          rod(K, [a[0], a[1], y0 + 1.33], [b[0], b[1], y0 + 1.06], 0.04, skin, 1, SATIN);
          rod(K, [b[0], b[1], y0 + 1.06], [e[0], e[1], y0 + 0.82], 0.035, skin, 1, SATIN);
        }
        // the mask and its line up to the crown
        const [mu, mv] = P(sx, 0, 0.15);
        if (!vat) { K.ball(mu, mv, y0 + 1.48, 0.05, '#2a3a36', 1, 12, GLOSS); rod(K, [mu, mv, y0 + 1.5], [u, v, crown], 0.012, '#1c2422', 1, SATIN); }
        // the same body as capsules, for the fluid to flow round and the march to stop at (the bubbles are the layer's)
        if (vat) {
          const cap = (a, b, r2) => vat.caps.push([...a, ...b, r2]);
          for (const s of [-1, 1]) { const x = sx + s * 0.075, z = 0.02 + (s > 0 ? 0.03 : 0); cap(W(x, y0 + 0.05, z), W(x, y0 + 0.78, z), 0.062); }
          cap(W(sx, y0 + 0.92, 0.02), W(sx, y0 + 1.3, 0.02), 0.14);
          cap(W(sx, y0 + 1.53, 0.06), W(sx, y0 + 1.53, 0.06), 0.1);
          for (const s of [-1, 1]) {
            cap(W(sx + s * 0.18, y0 + 1.33, 0), W(sx + s * 0.22, y0 + 1.06, 0.05), 0.042);
            cap(W(sx + s * 0.22, y0 + 1.06, 0.05), W(sx + s * 0.2, y0 + 0.82, 0.1), 0.037);
          }
          vat.mouth = W(sx, y0 + 1.47, 0.18);
        }
      } else if (drained) {
        // a puddle in front, and the drained fluid's scum line on the glass
        const [pu, pv] = P(0, 0, hd + 0.45);
        K.lathe(pu, pv, [[0, 0.004], [0.55, 0.004]], '#3a5a50', 1, 24, GLOSS);
        torus(K, u, v, tube - 0.005, 0.004, base + 0.9, '#6a8a74', 1);
      }
      // the fluid, then the glass round it, both see-through; drained, the front quarter of the glass is swung open
      const g0 = K.glass.n;
      if (!release) liquidLathe(c, 0, 0, [[0, base], [tube - 0.012, base], [tube - 0.012, fluidTop], [0, fluidTop]], drained ? '#3a7a60' : p.fluid || '#46e0a8', drained ? 0.9 : 1.25, 28);
      if (vat) { vat.glass = [g0, K.glass.n - g0]; K.vats.push(vat); }
      // (a release vat's glass is drawn by gl/room-vat.js, where it revolves open to let a body out)
      if (!drained && !(release && vat)) glassLathe(c, 0, 0, [[tube, base], [tube, crown]], 28);
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
      // a release vat fed by the room's tube has a hole right through its crown, the tube's bore: the fluid falls
      // through it to fill the vat, and then the body slides down through it
      const hole = release && vat ? Math.min(0.3, tube - 0.06) : 0;
      K.lathe(u, v, [[hole, crown], [tube + 0.03, crown], [R + 0.04, crown + 0.06], [R + 0.04, h - 0.1], [R * 0.7, h - 0.02], [hole, h]], '#c9ced3', 1.05, 36, METAL);
      if (hole) {
        // the bore's lining, dark, both faces so it reads from inside the vat and from above; a lit lip under it
        K.lathe(u, v, [[hole, h + 0.09], [hole, crown]], '#14191c', 1, 28, SATIN);
        K.lathe(u, v, [[hole, crown], [hole, h + 0.09]], '#14191c', 1, 28, SATIN);
        torus(K, u, v, hole + 0.01, 0.016, crown - 0.005, '#5fffc0', 1.8);
      }
      torus(K, u, v, tube + 0.01, 0.014, crown + 0.01, drained ? '#ff8a3a' : '#5fffc0', 1.5);
      // hoses up to the wall, or (in a room whose renderer fills its vats) the room's tubes from the crown (drawVatTubes)
      if (!vat) for (const s of [-1, 1]) rod(K, [...P(s * R * 0.4, 0, -R * 0.3)].slice(0, 2).concat(h - 0.04), [...P(s * R * 0.55, 0, -hd - 0.02)].slice(0, 2).concat(h + 0.35), 0.03, '#2b3034', 1, SATIN);
      else if (!hole) K.lathe(u, v, [[0.13, h - 0.02], [0.13, h + 0.06], [0.11, h + 0.08], [0, h + 0.08]], '#3a4248', 1, 20, METAL);
      // the plate on the plinth: a number in the legend face, and a status light
      const tag = String(p.tag || '').toUpperCase().slice(0, 6);
      pbox(-0.16, 0.16, 0.14, 0.26, R + 0.02, R + 0.035, '#1b1e22', 1, null, SATIN);
      if (tag) legend({ plate: (ps, col, emis) => K.quad(K.solid, ps.map(([a, b]) => P(-a, b, R + 0.037)), F.N(0, 0, 1), col, emis > 0.5 ? GLOW : MATTE, null, true) }, tag, 0.03, 0.2, 0.06, K.C(drained ? '#ffb070' : '#bfffe6', 2), 1);
      pbox(0.09, 0.13, 0.18, 0.22, R + 0.035, R + 0.045, drained ? '#ff7a2a' : release ? '#ffc86a' : '#4dff9a', 2.2, null, GLOW);
      return true;
    }
    // ── the machine room round the vats ─────────────────────────────────────────────────────────────
    case 'vatrack': {
      // a monitoring tower: a steel frame with three screens of vitals, a column of status lights, a shelf with a
      // keyboard sloped on it, and a harness of cable out of the top. `look.tag` letters the tower's number.
      const r = rng(p.seed || 3), steel = '#3a4046', dark = '#15181b';
      pbox(-hw, hw, 0, 0.08, -hd, hd, '#222629', 1, null, METAL);
      pbox(-hw + 0.02, hw - 0.02, 0.08, h - 0.05, -hd + 0.04, hd - 0.06, dark, 1, null, SATIN);
      for (const x of [-hw, hw - 0.04]) pbox(x, x + 0.04, 0, h, -hd, hd, steel, 1.05, null, METAL);
      pbox(-hw, hw, h - 0.05, h, -hd, hd, steel, 1.05, null, METAL);
      // three screens, each a trace or a bar chart, in the vat's own greens and a warning amber
      const scr = [[1.55, 2.1], [1.0, 1.5], [0.55, 0.95]], tints = ['#38e8a0', '#5ad8ff', '#ffb43a'];
      scr.forEach(([y0, y1], i) => {
        pbox(-hw + 0.06, hw - 0.06, y0, y1, hd - 0.07, hd - 0.05, '#05080a', 1, null, GLOSS);
        // (what's on them is live, painted over the glass by panels/room-vitals.js); a bezel round each
        const col = tints[(i + Math.floor(r() * 3)) % 3];
        for (const [x0, x1, a0, a1] of [[-hw + 0.04, hw - 0.04, y1, y1 + 0.02], [-hw + 0.04, hw - 0.04, y0 - 0.02, y0], [-hw + 0.04, -hw + 0.06, y0, y1], [hw - 0.06, hw - 0.04, y0, y1]]) pbox(x0, x1, a0, a1, hd - 0.075, hd - 0.04, '#2a3036', 1.05, null, METAL);
        pbox(hw - 0.1, hw - 0.075, y0 + 0.01, y0 + 0.03, hd - 0.04, hd - 0.035, col, 2, null, GLOW);
      });
      // the status column down one side
      for (let k = 0; k < 10; k++) { const y = 0.25 + k * 0.025, on = r() < 0.7; pbox(hw - 0.12, hw - 0.08, y, y + 0.014, hd - 0.06, hd - 0.05, on ? (r() < 0.15 ? '#ff4a3a' : '#5affb0') : '#203028', on ? 2.2 : 1, null, on ? GLOW : MATTE); }
      // the shelf and its keyboard
      pbox(-hw + 0.04, hw - 0.04, 0.9, 0.93, hd - 0.06, hd + 0.18, steel, 1, null, METAL);
      pbox(-hw + 0.12, hw - 0.12, 0.93, 0.95, hd + 0.0, hd + 0.15, '#202428', 1, null, SATIN);
      // the cable out of the top, looping off behind
      for (let k = 0; k < 4; k++) rod(K, [...P(-0.2 + k * 0.13, 0, -hd + 0.1)].slice(0, 2).concat(h), [...P(-0.25 + k * 0.17, 0, -hd - 0.15)].slice(0, 2).concat(h + 0.45 + k * 0.06), 0.018, ['#1e2a2a', '#2c2420', '#202838', '#1a1a1a'][k], 1, SATIN);
      const tag = String(p.tag || '').toUpperCase().slice(0, 8);
      if (tag) legend({ plate: (ps, col, emis) => K.quad(K.solid, ps.map(([a, b]) => P(-a, b, hd - 0.045)), F.N(0, 0, 1), col, GLOW, null, true) }, tag, 0, h - 0.13, 0.05, K.C('#9affd8', 1.6), 0);
      return true;
    }
    case 'manifold': {
      // the plant that feeds the vats: two pumps on a skid, a header of pipe across the top, risers with hand wheels,
      // pressure gauges, and drip trays under the joints
      const r = rng(p.seed || 5), pipe = '#56606a', paint = '#2f5a52';
      pbox(-hw, hw, 0, 0.12, -hd, hd, '#25292c', 1, null, METAL);
      for (const s of [-1, 1]) {
        const [mu, mv] = P(s * hw * 0.5, 0, -hd * 0.1);
        // a pump: motor body on its side, a fan cowl, a volute
        rod(K, [...P(s * hw * 0.5 - 0.32, 0, -hd * 0.1)].slice(0, 2).concat(0.38), [...P(s * hw * 0.5 + 0.18, 0, -hd * 0.1)].slice(0, 2).concat(0.38), 0.21, paint, 1, SATIN);
        K.ball(mu, mv, 0.38, 0.24, '#3b4448', 1, 14, METAL);
        for (let k = 0; k < 6; k++) { const x = s * hw * 0.5 - 0.3 + k * 0.08; pbox(x, x + 0.02, 0.17, 0.6, -hd * 0.1 - 0.23, -hd * 0.1 + 0.23, '#24484a', 1, null, METAL); }
        // its riser up to the header, a hand wheel half way, a gauge
        const ru = s * hw * 0.5 + 0.28;
        rod(K, [...P(ru, 0, -hd * 0.1)].slice(0, 2).concat(0.38), [...P(ru, 0, -hd * 0.1)].slice(0, 2).concat(h - 0.2), 0.07, pipe, 1, METAL);
        const [wu, wv] = P(ru, 0, -hd * 0.1 + 0.12);
        torus(K, wu, wv, 0.11, 0.012, 1.05, '#c0302a', 1);
        const [gu, gv] = P(ru, 0, hd * 0.2);
        K.lathe(gu, gv, [[0, 1.45], [0.07, 1.45], [0.07, 1.47], [0, 1.47]], '#e8e4d8', 1, 16, GLOSS);
        pbox(ru - 0.004, ru + 0.004, 1.47, 1.472, hd * 0.2 - 0.05 + r() * 0.04, hd * 0.2 + 0.03, '#c0302a', 1, null, MATTE);
      }
      // the header across the top, flanged
      rod(K, [...P(-hw + 0.05, 0, -hd * 0.1)].slice(0, 2).concat(h - 0.2), [...P(hw - 0.05, 0, -hd * 0.1)].slice(0, 2).concat(h - 0.2), 0.11, pipe, 1, METAL);
      for (let k = 0; k <= 4; k++) { const [fu2, fv2] = P(-hw + 0.1 + k * (hw * 2 - 0.2) / 4, 0, -hd * 0.1); K.ball(fu2, fv2, h - 0.2, 0.13, '#6c767e', 1, 10, METAL); }
      // tied into the wall: a bolted backplate, the header's three branches through it on flanged sleeves, the pumps'
      // discharges elbowing down and back into it low, a conduit and junction box for the motors, hazard banding
      const at = (x, z, y) => [...P(x, 0, z)].slice(0, 2).concat(y), back = -hd - 0.02;
      pbox(-hw + 0.02, hw - 0.02, 0.22, h + 0.3, -hd - 0.04, -hd - 0.01, '#2a3034', 1, null, METAL);
      for (let k = 0; k < 6; k++) for (const y of [0.3, h + 0.2]) { const [bu, bv] = P(-hw + 0.1 + k * (hw * 2 - 0.2) / 5, 0, -hd - 0.005); K.ball(bu, bv, y, 0.018, '#8a949c', 1.1, 6, METAL); }
      for (let k = 0; k < 10; k++) { const x = -hw + 0.04 + k * (hw * 2 - 0.08) / 10; pbox(x, x + (hw * 2 - 0.08) / 20, 0.22, 0.3, -hd - 0.009, -hd - 0.004, k % 2 ? '#111' : '#e8b820', 1, null, MATTE); }
      for (const x of [-hw * 0.6, 0, hw * 0.6]) {
        rod(K, at(x, -hd * 0.1, h - 0.2), at(x, back, h - 0.2), 0.08, pipe, 1, METAL);
        rod(K, at(x, back + 0.04, h - 0.2), at(x, back - 0.01, h - 0.2), 0.15, '#6c767e', 1, METAL);
        rod(K, at(x, -hd * 0.1 - 0.12, h - 0.2), at(x, -hd * 0.1 - 0.15, h - 0.2), 0.12, '#6c767e', 1, METAL);
        // a gate valve on each branch, its wheel spoked
        const [vu, vv] = P(x, 0, -hd * 0.55);
        K.lathe(vu, vv, [[0, h - 0.2], [0.05, h - 0.2], [0.05, h + 0.02], [0, h + 0.02]], '#3a4248', 1, 12, METAL);
        torus(K, vu, vv, 0.09, 0.01, h + 0.04, '#c0302a', 1);
        for (let sp = 0; sp < 4; sp++) { const an = sp * Math.PI / 2; rod(K, [vu, vv, h + 0.04], [vu + Math.cos(an) * 0.09, vv + Math.sin(an) * 0.09, h + 0.04], 0.006, '#c0302a', 1, METAL); }
      }
      for (const sx of [-1, 1]) {
        const x = sx * hw * 0.5 + 0.15;
        rod(K, at(x, -hd * 0.1, 0.62), at(x, back, 0.62), 0.065, '#2f5a52', 1, METAL);
        rod(K, at(x, back + 0.04, 0.62), at(x, back - 0.01, 0.62), 0.12, '#6c767e', 1, METAL);
        // the riser lagged in silver insulation, banded
        const ru = sx * hw * 0.5 + 0.28;
        rod(K, at(ru, -hd * 0.1, 1.15), at(ru, -hd * 0.1, h - 0.35), 0.095, '#c8ccd0', 0.95, SATIN);
        for (let y = 1.25; y < h - 0.4; y += 0.25) rod(K, at(ru, -hd * 0.1, y), at(ru, -hd * 0.1, y + 0.015), 0.1, '#7d868c', 1, METAL);
      }
      // the flow along the header, lit chevrons in the growth medium's green
      for (let k = 0; k < 7; k++) { const x = -hw + 0.25 + k * (hw * 2 - 0.5) / 6; pbox(x, x + 0.05, h - 0.1, h - 0.085, -hd * 0.1 - 0.02, -hd * 0.1 + 0.02, '#4dffb0', 1.8, null, GLOW); }
      // the conduit up the backplate to a junction box, and its lamp
      rod(K, at(-hw + 0.12, -hd + 0.02, 0.3), at(-hw + 0.12, -hd + 0.02, h + 0.3), 0.025, '#1e2226', 1, METAL);
      pbox(-hw + 0.05, -hw + 0.3, 1.5, 1.8, -hd, -hd + 0.1, '#3a4046', 1, null, METAL);
      pbox(-hw + 0.24, -hw + 0.27, 1.72, 1.75, -hd + 0.1, -hd + 0.105, '#5affb0', 2.2, null, GLOW);
      // the header's riser off to the ceiling, and a drip tray stained green
      rod(K, [...P(0, 0, -hd * 0.1)].slice(0, 2).concat(h - 0.2), [...P(0, 0, -hd * 0.1)].slice(0, 2).concat(h + 0.6), 0.09, pipe, 1, METAL);
      pbox(-hw * 0.6, hw * 0.6, 0.12, 0.16, hd * 0.25, hd - 0.04, '#3a4a3a', 1, null, GLOSS);
      return true;
    }
    case 'gantry': {
      // the dressing gantry: a column, a turret on its head, eight arms folded down round it like a resting spider
      const [u, v] = P(0, 0, 0), steel = '#9aa3aa', joint = '#2b3034', top = h - 0.25;
      // in a room whose renderer runs the vats, the arms are drawn and moved by it (gl/room-vat.js, panels/room-vatcycle.js)
      const live = !!(K.gantries && K.at);
      if (live) K.gantries.push({ id: p.id ?? null, c: K.at(u, v, 0), top, front: (() => { const a = K.at(...P(0, 0, 0)), b = K.at(...P(0, 0, 1)); return [b[0] - a[0], 0, b[2] - a[2]]; })() });
      // (where it runs live it hangs from the trunk's hub on a telescopic boom: only a parking mark on the floor)
      if (!live) {
        K.lathe(u, v, [[0, 0], [0.42, 0], [0.42, 0.06], [0.22, 0.12], [0.16, 0.2], [0.16, top - 0.3], [0.3, top - 0.2], [0.3, top], [0.12, top + 0.15], [0, top + 0.15]], steel, 1.05, 28, METAL);
        torus(K, u, v, 0.31, 0.018, top - 0.1, '#ffb43a', 1.8);
      } else torus(K, u, v, 0.6, 0.02, 0.005, '#ffb43a', 1.4);
      // eight arms off the turret, each a shoulder, an upper arm out and down, a forearm folded in, a three-finger grip
      for (let i = 0; i < (live ? 0 : 8); i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2, c = Math.cos(a), s = Math.sin(a), lift = i % 2 ? 0.1 : 0;
        const sh = [u + c * 0.3, v + s * 0.3, top - 0.12 - lift], el = [u + c * 0.95, v + s * 0.95, top - 0.75 - lift], wr = [u + c * 0.55, v + s * 0.55, top - 1.45 - lift];
        K.ball(sh[0], sh[1], sh[2], 0.07, joint, 1, 10, METAL);
        rod(K, sh, el, 0.045, steel, 1.05, METAL);
        K.ball(el[0], el[1], el[2], 0.06, joint, 1, 10, METAL);
        rod(K, el, wr, 0.035, steel, 1.05, METAL);
        K.ball(wr[0], wr[1], wr[2], 0.045, '#ffb43a', 1.4, 8, GLOW);
        for (let f = 0; f < 3; f++) { const b = a + (f - 1) * 0.5; rod(K, wr, [wr[0] + Math.cos(b) * 0.09, wr[1] + Math.sin(b) * 0.09, wr[2] - 0.12], 0.012, joint, 1, METAL); }
      }
      // (no bin: the clothing comes down a feed through the middle of the gantry and out of a nozzle under its turret,
      // drawn with the rig by gl/room-vat.js)
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
    case 'holosign': {
      // a floating slab of soft light on no stand, at eye height: a pale core, a brighter edge all round it, faint scan
      // lines across both faces and rows of glyphs off the seed. `look.fluid` ('#rrggbb') tints it; blue otherwise
      const col = p.fluid || '#6fc4ff', r = rng(p.seed || 11), sw = Math.min(w, 1.1) / 2, y0 = Math.max(1.2, h - 0.75), y1 = h - 0.1, t = 0.012;
      pbox(-sw, sw, y0, y1, -t, t, col, 1.05, null, GLOW);
      // the edge glow: a lit frame proud of the slab on every side
      const e = 0.022;
      pbox(-sw - e, sw + e, y1, y1 + e, -t - 0.004, t + 0.004, '#d8f0ff', 1.9, null, GLOW);
      pbox(-sw - e, sw + e, y0 - e, y0, -t - 0.004, t + 0.004, '#d8f0ff', 1.9, null, GLOW);
      for (const s of [-1, 1]) pbox(s < 0 ? -sw - e : sw, s < 0 ? -sw : sw + e, y0, y1, -t - 0.004, t + 0.004, '#d8f0ff', 1.9, null, GLOW);
      // scan lines, thin and faint, on both faces
      for (let y = y0 + 0.02; y < y1 - 0.01; y += 0.035) for (const z of [-1, 1]) pbox(-sw + 0.01, sw - 0.01, y, y + 0.004, z * t, z * (t + 0.002), '#a8dcff', 1.25, null, GLOW);
      // glyphs: short bright bars in rows, as if a page were written on the light
      for (let y = y1 - 0.08; y > y0 + 0.06; y -= 0.07) {
        let x = -sw + 0.06;
        while (x < sw - 0.08) { const g = 0.02 + r() * 0.07; if (r() < 0.8) for (const z of [-1, 1]) pbox(x, Math.min(x + g, sw - 0.06), y, y + 0.018, z * (t + 0.002), z * (t + 0.005), '#f0faff', 1.7, null, GLOW); x += g + 0.02 + r() * 0.03; }
      }
      // a faint pool of the same light on the floor under it, where nothing holds it up
      const [cu, cv] = P(0, 0, 0);
      K.lathe(cu, cv, [[0, 0.006], [sw * 0.8, 0.006]], col, 0.55, 28, GLOW);
      return true;
    }
    case 'morphex': {
      // the MORPHEX 9000 pod: an iron maiden in carbon fibre and dark metal, lit cyan. A dark metal plinth with a lit
      // ring to stand on, the maiden's back half, its crown with the scan ring parked in it. The two halves that close
      // on you, the ring that sweeps and the steam are the pod's sequence (panels/room-morphex.js), drawn as props.
      const [u, v] = P(0, 0, 0.05), R = Math.min(hw, hd) * 0.9, plinth = 0.16, top = h - 0.3;
      const CYAN = '#2fd8ff', ORANGE = '#ff6a1e', DARK = '#3a3f46', RIVET = '#6a727c';
      K.lathe(u, v, [[0, 0], [R + 0.05, 0], [R + 0.05, plinth - 0.03], [R, plinth], [0, plinth]], '#1a1c20', 1, 36, METAL);
      torus(K, u, v, R * 0.82, 0.016, plinth + 0.005, ORANGE, 1.8);
      K.lathe(u, v, [[0, plinth + 0.002], [R * 0.78, plinth + 0.002]], '#0e1013', 1, 32, GLOSS);
      // the maiden's back half, a coffin stood on end (its outline is room-morphex.js prof()). Outside, lacquered carbon
      // fibre: a fine twill, the weave in two blacks running on the diagonal, under dark metal straps riveted where
      // they cross the ribs. Inside, a black liner set with spikes, each with a point lit cyan. Its front halves stand open
      // below; the sequence hides this piece's and draws its own, which swing
      const prof = (y) => { const k = (y - plinth) / (top - plinth); return k < 0.74 ? 0.66 + 0.4 * (k / 0.74) : k < 0.86 ? 1.06 - 1.5 * (k - 0.74) : Math.max(0.05, 0.88 * Math.sqrt(Math.max(0, 1 - ((k - 0.86) / 0.16) ** 2))); };
      const ROWS = 18, COLS = 12, yAt = (i) => plinth + 0.02 + (i / ROWS) * (top - plinth - 0.02);
      const pt = (j, i, inset) => { const th = -Math.PI / 2 + (j / COLS) * Math.PI, y = yAt(i), w = R * prof(y) - inset, [pu, pv] = P(Math.sin(th) * w, 0, 0.05 - Math.cos(th) * w); return [pu, pv, y]; };
      const nOf = (j, i) => { const mc = pt(j, i, -0.03), dl = Math.hypot(mc[0] - u, mc[1] - v) || 1; return [(mc[0] - u) / dl, (mc[1] - v) / dl]; };
      // the twill: three cells to each of the liner's, a 2/2 weave (two over, two under, stepped one each row)
      const T = 3;
      for (let i = 0; i < ROWS * T; i++) for (let j = 0; j < COLS * T; j++) {
        const n = nOf((j + 0.5) / T, (i + 0.5) / T), lit = ((i + j) & 3) < 2;
        K.quad(K.solid, [pt(j / T, i / T, -0.03), pt((j + 1) / T, i / T, -0.03), pt((j + 1) / T, (i + 1) / T, -0.03), pt(j / T, (i + 1) / T, -0.03)], K.nrmOf(n[0], 0, n[1]), K.C(lit ? '#24272c' : '#121417', 1), GLOSS);
      }
      for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
        const n = nOf(j + 0.5, i + 0.5);
        // the straps, standing off the carbon, riveted at every other rib
        if (i % 5 === 0) {
          K.quad(K.solid, [pt(j, i, -0.042), pt(j + 1, i, -0.042), pt(j + 1, i + 0.6, -0.042), pt(j, i + 0.6, -0.042)], K.nrmOf(n[0], 0, n[1]), K.C(DARK, 1.05), METAL);
          if (j % 2 === 0) { const q = pt(j + 0.5, i + 0.3, -0.05); K.ball(q[0], q[1], q[2], 0.012, RIVET, 1.1, 6, METAL); }
        }
        K.quad(K.solid, [pt(j, i + 1, 0.015), pt(j + 1, i + 1, 0.015), pt(j + 1, i, 0.015), pt(j, i, 0.015)], K.nrmOf(-n[0], 0, -n[1]), K.C('#0b0d10', 1), SATIN);
        // the spikes inside, rows of them pointing in at whoever stands there, their points lit
        if (i % 2 === 0 && i > 1 && i < ROWS - 2 && j % 2 === 1) { const a = pt(j + 0.5, i, 0.02), b = pt(j + 0.5, i, 0.11); rod(K, a, b, 0.01, '#2c3036', 1, METAL); K.ball(b[0], b[1], b[2], 0.007, '#7ff0ff', 1.8, 5, GLOW); }
      }
      // a cyan light line up each front edge of the back half, where the doors meet it, following the outline
      for (const sx of [-1, 1]) for (let i = 0; i < ROWS; i++) {
        const w0 = R * prof(yAt(i)) + 0.035, w1 = R * prof(yAt(i + 1)) + 0.035, [a0, b0] = P(sx * w0, 0, 0.05), [a1, b1] = P(sx * w1, 0, 0.05);
        rod(K, [a0, b0, yAt(i)], [a1, b1, yAt(i + 1)], 0.008, ORANGE, 1.9, GLOW);
      }
      // the hinges down each side in dark metal, the scan ring parked in the crown, the crown's cap
      for (const sx of [-1, 1]) for (let i = 1; i < ROWS; i += 5) { const y = yAt(i), [hu, hv] = P(sx * (R * prof(y) + 0.02), 0, 0.05); K.lathe(hu, hv, [[0.03, y - 0.08], [0.03, y + 0.08]], DARK, 1.05, 10, METAL); }
      torus(K, u, v, R * 0.86, 0.016, top - 0.12, '#9be7ff', 1.3);
      K.lathe(u, v, [[0, top + 0.02], [R * 0.3, top + 0.02], [R * 0.32, top + 0.1], [0, top + 0.16]], '#1a1c20', 1, 24, METAL);
      torus(K, u, v, R * 0.31, 0.008, top + 0.06, ORANGE, 1.9);
      // a line of cyan round the plinth's foot
      torus(K, u, v, R + 0.06, 0.012, plinth + 0.04, ORANGE, 1.6);
      // the two front halves, standing swung right open on their hinges (room-morphex.js half() at k 0), so the pod
      // looks ready for you before you've used it: carbon outside, the spiked liner facing the room, a lit front edge
      const FR = 16, FC = 9, fy = (i) => plinth + 0.02 + (i / FR) * (top - plinth - 0.02);
      const fpt = (side, a, i, inset) => {
        const y = fy(i), w = R * prof(y) - inset, th = side * (Math.PI / 2) * (1 - a), x0 = Math.sin(th) * w, z0 = Math.cos(th) * w;
        const sw = -side * 1.83, hx = side * R * prof(y), dx = x0 - hx, [pu, pv] = P(hx + dx * Math.cos(sw) - z0 * Math.sin(sw), 0, 0.05 + z0 * Math.cos(sw) + dx * Math.sin(sw));
        return [pu, pv, y];
      };
      if (!p.busy) for (const side of [-1, 1]) {
        for (let i = 0; i < FR; i++) for (let j = 0; j < FC - 1; j++) {
          const a0 = j / (FC - 1), a1 = (j + 1) / (FC - 1);
          const o = [fpt(side, a0, i, -0.03), fpt(side, a1, i, -0.03), fpt(side, a1, i + 1, -0.03), fpt(side, a0, i + 1, -0.03)];
          const ex = o[1][0] - o[0][0], ey = o[1][1] - o[0][1], el = Math.hypot(ex, ey) || 1, nu = -ey / el * side, nv = ex / el * side;
          K.quad(K.solid, o, K.nrmOf(nu, 0, nv), K.C(j % 2 ? '#22252a' : '#16181b', 1), GLOSS);
          K.quad(K.solid, [fpt(side, a0, i + 1, 0.015), fpt(side, a1, i + 1, 0.015), fpt(side, a1, i, 0.015), fpt(side, a0, i, 0.015)], K.nrmOf(-nu, 0, -nv), K.C('#0b0d10', 1), SATIN);
          if (i % 4 === 1) K.quad(K.solid, [fpt(side, a0, i, -0.045), fpt(side, a1, i, -0.045), fpt(side, a1, i + 0.6, -0.045), fpt(side, a0, i + 0.6, -0.045)], K.nrmOf(nu, 0, nv), K.C(DARK, 1.05), METAL);
          if (i % 2 === 0 && i > 1 && i < FR - 1 && j % 2 === 1) { const a = fpt(side, a0, i, 0.02), b = fpt(side, a0, i, 0.12); rod(K, a, b, 0.01, '#2c3036', 1, METAL); K.ball(b[0], b[1], b[2], 0.007, '#7ff0ff', 1.8, 5, GLOW); }
        }
        for (let i = 0; i < FR; i++) rod(K, fpt(side, 0.985, i, -0.02), fpt(side, 0.985, i + 1, -0.02), 0.01, ORANGE, 1.9, GLOW);
      }
      return true;
    }
    case 'towelrail': {
      // a heated brass ladder rail on the wall, two stiles and four bars, with a thick white towel folded over the
      // top two and hanging down the front
      const zr = -hd + 0.07, bars = [0.42, 0.62, 0.82, h - 0.06];
      for (const s of [-1, 1]) {
        rod(K, P(s * (hw - 0.03), 0.3, zr), P(s * (hw - 0.03), h, zr), 0.016, BRASS, 1.1, METAL);
        for (const y of [0.4, h - 0.04]) rod(K, P(s * (hw - 0.03), y, -hd), P(s * (hw - 0.03), y, zr), 0.01, BRASS, 1.05, METAL);
      }
      for (const y of bars) rod(K, P(-hw + 0.03, y, zr), P(hw - 0.03, y, zr), 0.011, BRASS, 1.1, METAL);
      const tw = hw - 0.09, top = h - 0.06, weave = { t: 'roomWeave', c: '#f2efe8' };
      pbox(-tw, tw, top - 0.02, top + 0.035, zr - 0.035, zr + 0.035, '#f2efe8', 1, weave, CLOTH);
      pbox(-tw, tw, 0.5, top, zr + 0.015, zr + 0.05, '#f2efe8', 1, weave, CLOTH);
      pbox(-tw, tw, 0.66, top, zr - 0.05, zr - 0.015, '#e6e2da', 0.95, weave, CLOTH);
      pbox(-tw, tw, 0.54, 0.57, zr + 0.05, zr + 0.052, '#c9b78e', 1, null, CLOTH);
      return true;
    }
    case 'decor': case 'walldecor': {
      // one of the room's decor objects, sent as a piece so its owner can move it (plugins/roomstage/decor-pieces.js):
      // its own entry drawn by drawDecor, moved to where the piece stands. Wall kinds keep their own height.
      const k = p.decor?.key, c = p.decor?.entry;
      if (!k || c == null) return true;
      const L = K.L, wall = p.wall, along = wall === 'left' || wall === 'right' ? p.v : p.u;
      const ALONG = new Set(['screens', 'signs', 'lamps']);
      let e = c;
      if (p.form === 'walldecor') { if (wall) e = { ...c, wall, [ALONG.has(k) ? 'along' : 'at']: along }; }
      else if (Array.isArray(c)) { e = c.slice(); e[0] = p.u; e[1] = p.v; }
      else e = { ...c, at: [p.u, p.v] };
      const H = L.h || 2.6;
      drawDecor(K, { ...L, spec: { ...L.spec, decor: { [k]: [e] } } }, { H, D: L.d, hu: L.w / 2, T: 0.14, DH: 2.05, lampOn: K.lampOn !== false, lamps: K.lamps || [], runs: [], fine: !!K.fine, accent: null, TEX: {} });
      return true;
    }
    case 'planter': {
      // a room's potted plant, sent as a piece so its owner can move it (plugins/roomstage/plants.js); drawn as the
      // decor drew it, the same leaves for the same place in the list
      const [u, v] = P(0, 0, 0), i = +String(p.id).split(':')[1] || 0;
      plant(K, u, v, p.size || 1, 0x51ed + i * 977);
      return true;
    }
    case 'rug': {
      // a room's authored rug, sent as a piece so its owner can move it (plugins/roomstage/plants.js): flat on the
      // boards with its four edges, as room-mesh.js drew it from decor.rug
      const y = 0.008, c = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => { const [u, v] = P(x, 0, z); return [u, v, y]; });
      if (p.style === 'persian') K.quad(K.TB('roomPersian'), c, [0, 1, 0], K.C('#ffffff', 0.95), CLOTH, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      else K.quad(K.TB('roomWool'), c, [0, 1, 0], K.C('#cfc9bd', 0.95), CLOTH, c.map((q) => [q[0] / 1.2, q[1] / 1.2]));
      for (let i = 0; i < 4; i++) {
        const a = c[i], b = c[(i + 1) % 4], nu = b[1] - a[1], nv = -(b[0] - a[0]), l = Math.hypot(nu, nv) || 1;
        K.quad(K.solid, [[a[0], a[1], 0.001], [b[0], b[1], 0.001], [b[0], b[1], y], [a[0], a[1], y]], K.nrmOf(nu / l, 0, nv / l), K.C('#3a2a22', 0.8), CLOTH);
      }
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
    case 'easel': {
      // a studio easel: two splayed front legs and a back leg, a mast with a sliding clamp, a ledge, and a canvas
      // on it facing the room, painted in a few fields off the piece's seed, a palette and a jar of brushes below
      const W = (x, y, z) => { const q = P(x, 0, z); return [q[0], q[1], y]; }, oak = { t: 'roomOak', c: '#9a7a52' }, r = rng(p.seed || 7);
      const ledge = 0.78, cw = Math.min(0.72, w * 0.88), ch = 0.62 + r() * 0.34, cz = 0.04;
      for (const s of [-1, 1]) rod(K, W(s * hw * 0.8, 0, hd * 0.55), W(s * 0.05, h, cz - 0.02), 0.016, '#9a7a52', 1, SATIN);
      rod(K, W(0, 0, -hd * 0.9), W(0, h * 0.8, cz - 0.03), 0.014, '#9a7a52', 1, SATIN);
      rod(K, W(0, 0.25, cz - 0.02), W(0, h, cz - 0.02), 0.018, '#9a7a52', 1, SATIN);
      pbox(-hw * 0.62, hw * 0.62, ledge - 0.03, ledge, cz - 0.02, cz + 0.08, '#9a7a52', 1, oak, SATIN);
      pbox(-hw * 0.62, hw * 0.62, ledge, ledge + 0.025, cz + 0.06, cz + 0.08, '#9a7a52', 1, oak, SATIN);
      // the canvas: a stretcher's depth of primed cloth, then the picture on its face
      const cy0 = ledge, cy1 = Math.min(h - 0.06, ledge + ch);
      pbox(-cw / 2, cw / 2, cy0, cy1, cz, cz + 0.025, '#e8e2d2', 1, { t: 'roomCanvas', c: '#e8e2d2' }, MATTE);
      const PAL = [['#c46a2a', '#2a4a6a', '#e8c86a', '#1a1414'], ['#3a5a3a', '#a8c0a0', '#d8cdb8', '#6a2a2a'], ['#7a1f4a', '#e89a6a', '#2a1a3a', '#f0e0c8'], ['#1f3346', '#6a8aa0', '#c8a46a', '#e8dcc4'], ['#a8382a', '#f0c84a', '#2a6a8a', '#141414']][Math.floor(r() * 5)];
      const m = 0.03, ground = cy0 + m + (cy1 - cy0 - 2 * m) * (0.3 + r() * 0.3);
      pbox(-cw / 2 + m, cw / 2 - m, ground, cy1 - m, cz + 0.025, cz + 0.027, PAL[1], 1, { t: 'roomCanvas', c: PAL[1] }, MATTE);
      pbox(-cw / 2 + m, cw / 2 - m, cy0 + m, ground, cz + 0.025, cz + 0.027, PAL[0], 1, { t: 'roomCanvas', c: PAL[0] }, MATTE);
      // a few strokes and a shape over the fields, unfinished at one corner where the primer still shows
      for (let i = 0; i < 7; i++) {
        const x = (r() - 0.5) * (cw - 0.16), y = cy0 + m + r() * (cy1 - cy0 - 2 * m - 0.06), sw = 0.03 + r() * 0.14, sh = 0.012 + r() * 0.05;
        pbox(x - sw / 2, x + sw / 2, y, y + sh, cz + 0.027, cz + 0.029, PAL[2 + (i % 2)], 0.95 + r() * 0.15, { t: 'roomCanvas', c: PAL[2 + (i % 2)] }, MATTE);
      }
      pbox(cw / 2 - m - 0.16, cw / 2 - m, cy1 - m - 0.12, cy1 - m, cz + 0.0275, cz + 0.0295, '#e8e2d2', 1, { t: 'roomCanvas', c: '#e8e2d2' }, MATTE);
      // the clamp down on its top edge
      pbox(-0.05, 0.05, cy1, cy1 + 0.04, cz - 0.03, cz + 0.04, '#9a7a52', 1, oak, SATIN);
      // a palette on the ledge, crusted with colour, and a jar of brushes by the back leg
      const [pu, pv] = P(-hw * 0.32, 0, cz + 0.05);
      K.lathe(pu, pv, [[0, ledge + 0.025], [0.09, ledge + 0.025], [0.09, ledge + 0.03], [0, ledge + 0.03]], '#c8a878', 1, 16, SATIN);
      for (let i = 0; i < 5; i++) { const a = i * 1.1; K.ball(pu + Math.cos(a) * 0.06, pv + Math.sin(a) * 0.06, ledge + 0.034, 0.012, PAL[i % 4], 1.05, 6, GLOSS); }
      const [ju, jv] = P(hw * 0.25, 0, -hd * 0.5);
      K.lathe(ju, jv, [[0, 0], [0.045, 0], [0.045, 0.13], [0, 0.13]], '#cfe0e4', 1.05, 12, GLOSS);
      for (let i = 0; i < 5; i++) { const a = i * 1.3, l = 0.22 + r() * 0.08; rod(K, [ju + Math.cos(a) * 0.015, jv + Math.sin(a) * 0.015, 0.02], [ju + Math.cos(a) * 0.05, jv + Math.sin(a) * 0.05, l], 0.004, i % 2 ? '#c83a2a' : '#1a1a1a', 1, SATIN); }
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
