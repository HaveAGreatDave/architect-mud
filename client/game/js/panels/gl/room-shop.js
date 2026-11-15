// A SHOP'S FITTINGS for the Room Stage: the counter you're served over, the racking and the drawer wall the
// stock lives in, and the stock itself, by trade. Screw It (zone_chemsupply_interior) is the first shop drawn
// with them; docs/proposals/shop-interiors.md is the standard a shop's room meets.
//
// Each form is drawn in the piece's own frame, as every fitting is (gl/room-fittings.js): x along its width,
// y up from the floor, z from its back (-d/2) to its front (+d/2), the front being the way it faces.
//
//   tradecounter  a long counter of steel and ply with a till and the sign-out clipboard on it, open shelves of
//                 stock on the staff's side, and a hazard band along its kick plate
//   racking       pallet racking: orange frames, blue beams, a pallet on every beam with the trade's goods on it.
//                 Free-standing racking is open both sides, so goods face both aisles
//   drawers       a wall of small steel drawers, each with a label and a pull: fasteners, fittings, parts
//
// `look.stock` (rowLook's `stock`) is what a shop's shelves carry, so one form does for every trade: 'hardware'
// (boxes, tape, tins of paint, spray cans, coils), 'chem' (amber bottles, solvent cans, reagent boxes, carboys,
// drums on the racking), 'safety' (respirators, gloves, goggles, hard hats). Steel shelving and a vitrine with a
// `stock` carry it too, in place of a flat's tins and a bar's bottles (shopGoods). Nothing here is the vendor's
// real catalogue: the shelf says what kind of shop this is, and the shop panel says what's for sale.
import { MAT } from './ballpark-mesh.js';
import { stockOf, shelfKeep } from './room-fittings.js';   // a cycle: room-fittings spreads SHOP_FORMS, and nothing here reads either at load

const { GLOSS, METAL, SATIN, MATTE } = MAT;
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];

const CARD = ['#b08a5a', '#a07e52', '#c09a66', '#8e6e46'];
const TAPE = ['#c8ccd0', '#1c1c1e', '#e8c02a', '#c83a2a', '#3a6ad8'];
const PAINT = ['#d8d4c8', '#c83a2a', '#3a7ad8', '#e8c02a', '#3a8a4a', '#2a2a2e'];
const SPRAY = ['#c83a2a', '#e8c02a', '#2a2a2e', '#d8d4c8', '#e86a1a'];
const AMBER = '#6a3008', CAN = ['#c83a2a', '#3a6ad8', '#e8c02a', '#c8ccd0'], DRUM = ['#2a4e8a', '#1c1c1e', '#9a2a1e', '#2e6a3a', '#3a6ad8'];
const HAZ = '#e86a10';

// ── THE GOODS ───────────────────────────────────────────────────────────────────────────────────────────────
// One thing of a trade's, standing at x on a shelf at y, no taller than `room`, in the middle of zb..zf: draws it
// and returns how wide it was, or 0 when nothing of this trade fits under `room`.
function goodsOf(c, stock, x, y, room, zb, zf) {
  const { F, r } = c, { pbox } = F, zm = (zb + zf) / 2, deep = zf - zb;
  const k = r();
  if (stock === 'chem') {
    if (k < 0.32 && room > 0.2) {
      // an amber bottle with a black cap
      const h = Math.min(room - 0.02, 0.17 + r() * 0.05), rad = 0.036;
      c.lat(x + rad, zm, [[0, y], [rad, y], [rad, y + h * 0.72], [rad * 0.45, y + h * 0.86], [rad * 0.45, y + h * 0.92], [0, y + h * 0.92]], AMBER, 1.05, 12, GLOSS);
      c.lat(x + rad, zm, [[0, y + h * 0.92], [rad * 0.5, y + h * 0.92], [rad * 0.5, y + h], [0, y + h]], '#141416', 1, 10, SATIN);
      pbox(x + 0.004, x + rad * 2 - 0.004, y + h * 0.3, y + h * 0.55, zm + rad - 0.003, zm + rad + 0.002, '#f2efe4', 1, null, MATTE);
      return rad * 2;
    }
    if (k < 0.58 && room > 0.24) {
      // a steel can of solvent: a flat-sided tin with a spout cap and a coloured label band
      const h = Math.min(room - 0.03, 0.22), w = 0.13, d = Math.min(deep * 0.6, 0.09), col = pick(r, CAN);
      pbox(x, x + w, y, y + h, zm - d / 2, zm + d / 2, '#a8acb0', 1, null, METAL);
      pbox(x - 0.002, x + w + 0.002, y + h * 0.3, y + h * 0.75, zm - d / 2 - 0.002, zm + d / 2 + 0.002, col, 0.95, null, SATIN);
      c.lat(x + w * 0.75, zm, [[0, y + h], [0.016, y + h], [0.016, y + h + 0.03], [0, y + h + 0.03]], '#2a2a2e', 1, 8, SATIN);
      return w;
    }
    if (k < 0.8 && room > 0.14) {
      // a white box of reagent with an orange hazard square on it
      const h = Math.min(room - 0.02, 0.12 + r() * 0.08), w = 0.12 + r() * 0.06, d = Math.min(deep * 0.7, 0.16);
      pbox(x, x + w, y, y + h, zm - d / 2, zm + d / 2, '#e8e6de', 0.95, null, MATTE);
      const s = Math.min(w, h) * 0.32, cx = x + w / 2, cy = y + h / 2;
      pbox(cx - s, cx + s, cy - s, cy + s, zm + d / 2, zm + d / 2 + 0.002, HAZ, 1.05, null, MATTE);
      return w;
    }
    if (room > 0.4) {
      // a carboy: a big squared bottle of white plastic with a blue cap
      const rad = 0.11, h = Math.min(room - 0.04, 0.38);
      c.lat(x + rad, zm, [[0, y], [rad, y], [rad, y + h * 0.78], [rad * 0.35, y + h * 0.9], [0, y + h * 0.9]], '#e4e2da', 0.98, 8, SATIN);
      c.lat(x + rad, zm, [[0, y + h * 0.9], [0.03, y + h * 0.9], [0.03, y + h], [0, y + h]], '#2a5ad8', 1, 10, SATIN);
      return rad * 2;
    }
    return 0;
  }
  if (stock === 'safety') {
    if (k < 0.3 && room > 0.14) {
      // a hard hat on its brim
      const col = pick(r, ['#e8c02a', '#f2efe8', '#e86a1a', '#3a6ad8']);
      c.lat(x + 0.12, zm, [[0, y + 0.13], [0.07, y + 0.12], [0.1, y + 0.07], [0.11, y + 0.015], [0.14, y + 0.012], [0.14, y], [0, y]], col, 1.05, 14, GLOSS);
      return 0.26;
    }
    if (k < 0.6 && room > 0.12) {
      // a boxed respirator: a grey box with a mask on its face
      const w = 0.16, h = Math.min(room - 0.02, 0.12), d = Math.min(deep * 0.7, 0.12);
      pbox(x, x + w, y, y + h, zm - d / 2, zm + d / 2, '#5a6068', 0.95, null, MATTE);
      pbox(x + 0.04, x + w - 0.04, y + 0.03, y + h - 0.03, zm + d / 2, zm + d / 2 + 0.003, '#d8c018', 1, null, MATTE);
      return w;
    }
    // gloves in a flat pack, stood on end
    const w = 0.05, h = Math.min(room - 0.02, 0.24);
    if (h < 0.1) return 0;
    pbox(x, x + w, y, y + h, zm - deep * 0.3, zm + deep * 0.3, pick(r, ['#e8c02a', '#3a6ad8', '#c83a2a', '#2a2a2e']), 0.95, null, SATIN);
    return w;
  }
  // hardware
  if (k < 0.3 && room > 0.1) {
    // a cardboard box of something, with its label
    const w = 0.12 + r() * 0.16, h = Math.min(room - 0.02, 0.08 + r() * 0.16), d = Math.min(deep * 0.85, 0.3);
    pbox(x, x + w, y, y + h, zm - d / 2, zm + d / 2, pick(r, CARD), 0.95, null, MATTE);
    pbox(x + w * 0.2, x + w * 0.8, y + h * 0.35, y + h * 0.7, zm + d / 2, zm + d / 2 + 0.002, '#f2efe4', 1, null, MATTE);
    return w;
  }
  if (k < 0.48 && room > 0.06) {
    // rolls of tape stacked on their sides
    const n = 1 + Math.floor(r() * Math.min(4, (room - 0.01) / 0.05)), col = pick(r, TAPE);
    for (let j = 0; j < n; j++) c.lat(x + 0.05, zm, [[0.025, y + j * 0.05], [0.05, y + j * 0.05], [0.05, y + j * 0.05 + 0.046], [0.025, y + j * 0.05 + 0.046]], col, 1, 12, SATIN);
    return 0.1;
  }
  if (k < 0.68 && room > 0.14) {
    // a tin of paint with its lid ring and a colour band
    const rad = 0.055, h = 0.12, col = pick(r, PAINT);
    c.lat(x + rad, zm, [[0, y], [rad, y], [rad, y + h], [rad * 0.85, y + h + 0.006], [0, y + h + 0.006]], '#b8bcc0', 1, 12, METAL);
    c.lat(x + rad, zm, [[rad + 0.001, y + h * 0.25], [rad + 0.002, y + h * 0.25], [rad + 0.002, y + h * 0.75], [rad + 0.001, y + h * 0.75]], col, 1, 12, SATIN);
    return rad * 2;
  }
  if (k < 0.86 && room > 0.22) {
    // a spray can and its cap
    const rad = 0.03, col = pick(r, SPRAY);
    c.lat(x + rad, zm, [[0, y], [rad, y], [rad, y + 0.17], [rad * 0.8, y + 0.19], [0, y + 0.19]], col, 1.05, 10, GLOSS);
    c.lat(x + rad, zm, [[0, y + 0.19], [rad * 0.8, y + 0.19], [rad * 0.8, y + 0.22], [0, y + 0.22]], '#2a2a2e', 1, 10, SATIN);
    return rad * 2;
  }
  if (room > 0.05) {
    // a coil of tubing or rope laid flat
    const col = pick(r, ['#d8d4c4', '#e86a1a', '#3a6ad8', '#2a2a2e']), rad = Math.min(0.12, deep * 0.4);
    c.lat(x + rad, zm, [[rad * 0.5, y], [rad, y], [rad, y + 0.045], [rad * 0.5, y + 0.045]], col, 1, 14, SATIN);
    return rad * 2;
  }
  return 0;
}

// A shelf of a trade's goods between x0 and x1, standing on y, no taller than `room`, from zb at the back to zf at
// the front; `keep` is the share of the shelf in use, as shelfKeep gives it. Steel shelving and a vitrine with a
// `stock` call this in place of a flat's things (gl/room-fittings.js).
export function shopGoods(c, stock, x0, x1, y, room, zb, zf, keep) {
  for (let x = x0 + 0.03; x < x1 - 0.12;) {
    const take = c.r() < keep || (keep > 0 && x === x0 + 0.03);
    let w = 0.06 + c.r() * 0.06;
    if (take) {
      const got = goodsOf(c, stock, x, y, room, zb, zf);
      if (got > 0 && x + got <= x1) w = got;
    }
    x += w + 0.018;
  }
}

// ── ON A PALLET ─────────────────────────────────────────────────────────────────────────────────────────────
// A pallet's deck between x0 and x1, z0 and z1, standing on y: three bearers and the top boards. Returns its top.
function pallet(c, x0, x1, z0, z1, y) {
  const { pbox } = c.F, wood = '#a07a4a', H = 0.13;
  for (const z of [z0 + 0.05, (z0 + z1) / 2, z1 - 0.05]) pbox(x0 + 0.02, x1 - 0.02, y, y + H - 0.025, z - 0.04, z + 0.04, '#8a6a3e', 0.9, null, MATTE);
  for (let x = x0; x < x1 - 0.06; x += 0.16) pbox(x, Math.min(x1, x + 0.12), y + H - 0.025, y + H, z0, z1, wood, 0.95, null, MATTE);
  return y + H;
}
// A 205-litre drum standing at (x, z) on y: rolled rims and a bung on the lid.
function drum(c, x, z, y, col, s = 1) {
  const R = 0.29 * s, H = 0.88 * s;
  c.lat(x, z, [[0, y], [R, y], [R, y + H], [0, y + H]], col, 1, 18, SATIN);
  for (const f of [0.32, 0.66]) c.lat(x, z, [[R, y + H * f - 0.012], [R + 0.008, y + H * f], [R, y + H * f + 0.012]], col, 0.85, 18, SATIN);
  c.lat(x, z, [[R - 0.01, y + H], [R + 0.006, y + H + 0.012], [R - 0.02, y + H + 0.012]], col, 0.9, 18, SATIN);
  c.lat(x + R * 0.55, z, [[0, y + H], [0.03, y + H], [0.03, y + H + 0.02], [0, y + H + 0.02]], '#c8ccd0', 1, 8, METAL);
}
// What's on a pallet on a beam, between x0 and x1 and z0 and z1, standing on y with `room` over it: drums, a
// stack of sacks, or boxes shrink-wrapped together. `full` is how much of it is there (0..1).
function palletLoad(c, stock, x0, x1, z0, z1, y, room, full) {
  const { F, r } = c, { pbox } = F, top = pallet(c, x0, x1, z0, z1, y), h = room - (top - y) - 0.06;
  if (full <= 0 || h < 0.25) return;
  const k = r();
  if ((stock === 'chem' && k < 0.6) || (stock !== 'chem' && k < 0.2)) {
    // drums, as many as fit and the level allows
    const s = Math.min(1, h / 0.92), R = 0.29 * s, col = pick(r, DRUM);
    const nx = Math.max(1, Math.floor((x1 - x0) / (2 * R + 0.04))), nz = Math.max(1, Math.floor((z1 - z0) / (2 * R + 0.04)));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      if (r() > full + 0.15) continue;
      drum(c, x0 + (i + 0.5) * (x1 - x0) / nx, z0 + (j + 0.5) * (z1 - z0) / nz, top, r() < 0.8 ? col : pick(r, DRUM), s);
    }
    return;
  }
  if (k < 0.75 && stock !== 'safety') {
    // sacks laid in a stack, each a soft block
    const n = Math.max(1, Math.round(Math.min(5, h / 0.13) * full)), col = stock === 'chem' ? pick(r, ['#ece8dc', '#d8d0bc']) : pick(r, ['#c8a870', '#ece8dc', '#a8a49a']);
    for (let i = 0; i < n; i++) {
      const lift = top + i * 0.13, inset = (i % 2) * 0.03;
      c.R(...F.alongX(), x0 + 0.03 + inset, x1 - 0.03 - inset, z0 + 0.04, z1 - 0.04, lift, lift + 0.12, 0.04, col, 0.95 - i * 0.01, MATTE);
      if (stock === 'chem') pbox(x0 + 0.2, x0 + 0.34, lift + 0.03, lift + 0.09, z1 - 0.04, z1 - 0.036, HAZ, 1.05, null, MATTE);
    }
    return;
  }
  // boxes, stacked in courses with a strap round each course, the top course short
  const hh = Math.max(0.25, h * (0.55 + 0.45 * full)), rows = Math.max(1, Math.round(hh / 0.26)), cols = Math.max(1, Math.round((x1 - x0) / 0.36));
  for (let i = 0; i < rows; i++) {
    const y0 = top + i * hh / rows, y1 = top + (i + 1) * hh / rows - 0.008;
    for (let j = 0; j < cols; j++) {
      if (i === rows - 1 && rows > 1 && r() > full) continue;
      const a = x0 + 0.03 + j * (x1 - x0 - 0.06) / cols, b = a + (x1 - x0 - 0.06) / cols - 0.01;
      pbox(a, b, y0, y1, z0 + 0.03, z1 - 0.03, pick(r, CARD), 0.92 + (i % 2) * 0.04, null, MATTE);
      pbox(a + (b - a) * 0.25, a + (b - a) * 0.75, y0 + (y1 - y0) * 0.4, y0 + (y1 - y0) * 0.7, z1 - 0.03, z1 - 0.027, '#f2efe4', 1, null, MATTE);
    }
  }
}

// ── THE FORMS ───────────────────────────────────────────────────────────────────────────────────────────────
export const SHOP_FORMS = Object.freeze({
  tradecounter(c) {
    const { F, p, r } = c, { pbox, P } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, stock = p.stock || 'hardware';
    const steel = '#5c636a', dark = '#2e3236', ply = { t: 'roomWood', c: '#c8a878' };
    // the top: ply on a steel frame, with a steel nosing along the customer's edge
    pbox(-hw, hw, h - 0.035, h, -hd, hd, '#c8a878', 1, ply, SATIN);
    pbox(-hw, hw, h - 0.05, h, hd - 0.02, hd + 0.01, '#9aa0a6', 1.05, null, METAL);
    // the customer's side: ribbed steel over a hazard-taped kick plate
    pbox(-hw + 0.02, hw - 0.02, 0.12, h - 0.035, hd - 0.03, hd - 0.012, steel, 0.95, null, METAL);
    for (let x = -hw + 0.12; x < hw - 0.08; x += 0.16) pbox(x - 0.012, x + 0.012, 0.14, h - 0.06, hd - 0.012, hd, '#6c737a', 1, null, METAL);
    pbox(-hw + 0.02, hw - 0.02, 0, 0.12, hd - 0.05, hd - 0.03, dark, 0.9, null, METAL);
    const n = Math.max(4, Math.round(p.w / 0.12));
    for (let i = 0; i < n; i++) {
      const a = -hw + 0.02 + i * (p.w - 0.04) / n, b = a + (p.w - 0.04) / n * 0.5;
      pbox(a, b, 0.03, 0.1, hd - 0.03, hd - 0.026, '#e8b818', 1.05, null, MATTE);
    }
    // the ends, steel, and a middle post holding up the long top
    for (const x of [-hw, hw - 0.03, -0.015]) pbox(x, x + 0.03, 0, h - 0.035, -hd, hd - 0.03, steel, 0.9, null, METAL);
    // the staff's side: open, with two shelves of stock under the top
    for (const y of [0.08, 0.5]) {
      pbox(-hw + 0.03, hw - 0.03, y - 0.02, y, -hd + 0.02, hd - 0.05, '#7a7e84', 0.95, null, METAL);
      for (const [a, b] of [[-hw + 0.03, -0.02], [0.02, hw - 0.03]]) shopGoods(c, stock, a, b, y, y < 0.3 ? 0.38 : h - 0.08 - y, -hd + 0.04, hd - 0.08, 0.75);
    }
    // the till at the right-hand end as the staff stand: a cash drawer, a keypad and a screen on a stalk
    const tx = -hw + 0.55;
    pbox(tx - 0.2, tx + 0.2, h, h + 0.1, -hd + 0.06, -hd + 0.42, '#24272b', 1, null, SATIN);
    pbox(tx - 0.16, tx + 0.08, h + 0.1, h + 0.115, -hd + 0.1, -hd + 0.3, '#3a3e44', 1, null, SATIN);
    c.rod(P(tx + 0.12, h + 0.1, -hd + 0.2), P(tx + 0.12, h + 0.3, -hd + 0.2), 0.012, '#24272b', 1, METAL, 6);
    pbox(tx + 0.02, tx + 0.22, h + 0.27, h + 0.41, -hd + 0.19, -hd + 0.21, '#18191c', 1, null, SATIN);
    pbox(tx + 0.035, tx + 0.205, h + 0.282, h + 0.398, -hd + 0.21, -hd + 0.212, '#6ae8b0', 1.7, null, MATTE);
    // a card reader on the customer's side
    pbox(tx - 0.42, tx - 0.32, h, h + 0.02, hd - 0.28, hd - 0.12, '#18191c', 1, null, SATIN);
    pbox(tx - 0.41, tx - 0.33, h + 0.02, h + 0.022, hd - 0.26, hd - 0.2, '#3ad87a', 1.6, null, MATTE);
    // the sign-out sheet: a clipboard chained to the far end, and the pen on its string
    const cx = hw - 0.4;
    pbox(cx - 0.12, cx + 0.12, h, h + 0.008, hd - 0.42, hd - 0.1, '#8a6a3a', 1, null, SATIN);
    pbox(cx - 0.105, cx + 0.105, h + 0.008, h + 0.01, hd - 0.4, hd - 0.13, '#f2efe4', 1, null, MATTE);
    for (let i = 0; i < 6; i++) pbox(cx - 0.08, cx + 0.06 - r() * 0.04, h + 0.0102, h + 0.0108, hd - 0.36 + i * 0.035, hd - 0.355 + i * 0.035, '#3a4a6a', 1, null, MATTE);
    pbox(cx - 0.04, cx + 0.04, h + 0.008, h + 0.022, hd - 0.42, hd - 0.39, '#b8bcc0', 1.05, null, METAL);
    c.rod(P(cx + 0.12, h + 0.01, hd - 0.4), P(hw - 0.04, h + 0.003, hd - 0.44), 0.003, '#b8bcc0', 1, METAL, 4);
    c.rod(P(cx + 0.14, h + 0.006, hd - 0.2), P(cx + 0.25, h + 0.006, hd - 0.16), 0.004, '#1c1c1e', 1, SATIN, 6);
    // a roll of tape and a box of something left out on the top
    c.lat(0.4, -0.05, [[0.025, h], [0.05, h], [0.05, h + 0.046], [0.025, h + 0.046]], pick(r, TAPE), 1, 12, SATIN);
    pbox(0.7, 0.92, h, h + 0.1, -0.2, 0.05, pick(r, CARD), 0.95, null, MATTE);
  },

  racking(c) {
    const { F, p, r } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, stock = p.stock || 'hardware', lvl = stockOf(p);
    const frame = '#d8661a', beam = '#2a5a9a';
    // the frames: two posts at each end and every bay, braced, on base plates
    const bays = Math.max(1, Math.round(p.w / 2.7)), bx = (i) => -hw + i * p.w / bays;
    for (let i = 0; i <= bays; i++) {
      const x = Math.max(-hw + 0.04, Math.min(hw - 0.04, bx(i)));
      for (const z of [-hd + 0.04, hd - 0.04]) {
        pbox(x - 0.04, x + 0.04, 0, h, z - 0.035, z + 0.035, frame, 1, null, METAL);
        pbox(x - 0.07, x + 0.07, 0, 0.008, z - 0.06, z + 0.06, '#8a8e92', 1, null, METAL);
      }
      for (let y = 0.3; y < h - 0.3; y += 0.6) c.rod(F.P(x, y, -hd + 0.06), F.P(x, y + 0.6, hd - 0.06), 0.012, frame, 0.95, METAL, 4);
    }
    // the beams, and a pallet on each bay of each level; the floor level stands its pallet on the slab
    const levels = h > 2.4 ? [0, h * 0.4, h * 0.76] : [0, h * 0.55];
    levels.forEach((y, li) => {
      if (li) for (const z of [-hd + 0.04, hd - 0.04]) pbox(-hw + 0.04, hw - 0.04, y - 0.11, y, z - 0.03, z + 0.03, beam, 1, null, METAL);
      const room = (levels[li + 1] ?? h + 0.3) - y - 0.15;
      const keep = shelfKeep(lvl, li, levels.length);
      for (let i = 0; i < bays; i++) {
        const a = bx(i) + 0.1, b = bx(i + 1) - 0.1, half = (b - a) / 2 - 0.05;
        // two pallets to a bay, side by side
        for (const [x0, x1] of [[a, a + half], [b - half, b]]) if (r() < 0.25 + keep * 0.8) palletLoad(c, stock, x0, x1, -hd + 0.08, hd - 0.08, y, room, keep);
      }
    });
    // a load notice on the end frame
    pbox(-hw - 0.002, -hw + 0.002, 1.3, 1.6, -0.18, 0.18, '#f2efe4', 1, null, MATTE);
    pbox(-hw - 0.003, -hw + 0.003, 1.52, 1.58, -0.16, 0.16, '#c83a2a', 1, null, MATTE);
  },

  drawers(c) {
    const { F, p, r } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, h = p.h;
    const body = '#5e6a62', face = '#7a867c', t = 0.03;
    // the carcass, on a plinth
    pbox(-hw, hw, 0, 0.1, -hd, hd - 0.03, '#2e3236', 0.9, null, METAL);
    pbox(-hw, hw, 0.1, h, -hd, -hd + t, body, 0.85, null, METAL);
    for (const x of [-hw, hw - t]) pbox(x, x + t, 0.1, h, -hd, hd, body, 0.9, null, METAL);
    pbox(-hw, hw, h - t, h, -hd, hd, body, 0.95, null, METAL);
    // the drawers, in banks of three columns
    const cols = Math.max(2, Math.round((p.w - 2 * t) / 0.3)), rows = Math.max(3, Math.round((h - 0.14) / 0.17));
    const cw = (p.w - 2 * t) / cols, rh = (h - 0.12 - t) / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x0 = -hw + t + i * cw + 0.006, x1 = x0 + cw - 0.012, y0 = 0.1 + j * rh + 0.006, y1 = y0 + rh - 0.012, xm = (x0 + x1) / 2;
      // now and then one left pulled out
      const out = r() < 0.03 ? 0.12 : 0;
      pbox(x0, x1, y0, y1, hd - 0.04 + out, hd - 0.012 + out, i % 3 === 1 ? '#727e74' : face, 0.95, null, METAL);
      pbox(xm - cw * 0.3, xm + cw * 0.3, y1 - rh * 0.42, y1 - rh * 0.12, hd - 0.012 + out, hd - 0.009 + out, '#f2efe4', 1, null, MATTE);
      pbox(xm - cw * 0.18, xm + cw * 0.18, y0 + rh * 0.1, y0 + rh * 0.24, hd - 0.012 + out, hd + 0.006 + out, '#b8bcc0', 1.05, null, METAL);
    }
  },
});
