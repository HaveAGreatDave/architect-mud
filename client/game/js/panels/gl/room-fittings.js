// GLASS 2 · THE ROOM STAGE'S FITTINGS. What a flat is fitted with and what stands in it beyond the
// nine archetypes room-mesh.js started with: wardrobes and wall cabinets, kitchen runs and bathroom
// ware, a set's deck, a table, the things that stand on a worktop. Pure: batches, no GL.
//
// Each form is drawn in its piece's own frame (room-kit.js `frame`): x across it, z out of its front,
// y up off the floor. `c` is the context drawPiece hands over: the frame `F`, the piece `p`, a seeded
// `r`, the palette and the small helpers. A form here must fit inside p.w × p.d × p.h, because that's
// the footprint the walker collides with and placeSpot reserves.
//
// ⚠ THE LOOK COMES FROM DATA, NEVER FROM A NAME (home-stage.md rule 3). `c.fine` is the room's finish
// and `p.form` the row's flags; nothing here knows a wardrobe is called "Polaris".

import { MAT } from './ballpark-mesh.js';
import { HUNG_AT, LACQUER_BODY } from '../../../../shared/room-layout.js';
import { drawLab } from './lab-mesh.js';

const { GLOSS, METAL, LEATHER, SATIN, CLOTH, MATTE } = MAT;
// A sheet of flame: gl/room.js burns it and it's on no switch. No MAT code is 43.
const FIRE = 43;
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];

// A fire's dial, on a face that looks out along the piece's z: a black plate with a chamfered edge
// and a blue hairline, a raised collar, and the face itself, which gl/room-sky.js paints from the dial
// (FIRE, sheet 9): a ring of lit segments up to where it's set and a knurled knob whose lit pointer
// turns with it. So the knob moves the moment the setting does, with no rebuild. Its place goes on
// K.dials, in the world, which is what panels/room-stage.js reads to know a click or a scroll was on it.
// (x, y) is its middle on the face at z, and s its size, 1 for a plate 20 cm across.
export function fireDial(K, F, id, x, y, z, s = 1) {
  const { P, N, pbox } = F, pl = 0.1 * s, kr = 0.068 * s, z1 = z + 0.01, z2 = z1 + 0.022 * s;
  pbox(x - pl, x + pl, y - pl, y + pl, z, z1 - 0.003, '#141518', 1, null, METAL);
  pbox(x - pl + 0.006, x + pl - 0.006, y - pl + 0.006, y + pl - 0.006, z1 - 0.003, z1, '#1c1e22', 1, null, SATIN);
  // the hairline round the plate, lit by the fire's own colour
  for (const q of [[-1, 1, -1, -0.97], [-1, 1, 0.97, 1], [-1, -0.97, -1, 1], [0.97, 1, -1, 1]]) pbox(x + q[0] * (pl - 0.01), x + q[1] * (pl - 0.01), y + q[2] * (pl - 0.01), y + q[3] * (pl - 0.01), z1, z1 + 0.0015, '#3a8cff', 1, null, MATTE);
  // the collar: 24 sides, a step out to the bezel and up to the face
  const n = 24, at = (i, r, zz) => P(x + Math.cos(i * 2 * Math.PI / n) * r, y + Math.sin(i * 2 * Math.PI / n) * r, zz);
  for (let i = 0; i < n; i++) {
    const am = (i + 0.5) * 2 * Math.PI / n, nn = N(Math.cos(am), Math.sin(am), 0);
    K.quad(K.solid, [at(i, kr * 1.08, z1), at(i + 1, kr * 1.08, z1), at(i + 1, kr * 1.08, z2 - 0.004 * s), at(i, kr * 1.08, z2 - 0.004 * s)], nn, K.C('#1e2024', 1), METAL);
    K.quad(K.solid, [at(i, kr * 1.08, z2 - 0.004 * s), at(i + 1, kr * 1.08, z2 - 0.004 * s), at(i + 1, kr, z2), at(i, kr, z2)], N(Math.cos(am) * 0.6, Math.sin(am) * 0.6, 0.8), K.C('#3a3d43', 1), METAL);
  }
  // the face, painted by the shader
  K.quad(K.glass, [P(x - kr, y - kr, z2), P(x + kr, y - kr, z2), P(x + kr, y + kr, z2), P(x - kr, y + kr, z2)], N(0, 0, 1), [1, 1, 1], FIRE, [[18, 0], [19, 0], [19, 1], [18, 1]], true);
  (K.dials ||= []).push({ id, at: K.L.world(...P(x, y, z2)), r: pl });
}

// the stone a fine flat's worktops and bathrooms are cut from
export const STONE = { t: 'roomStone', c: '#9a9c9e' };
const BLACK = '#17181b';

// A hollow in a block: four walls round a floor set down into it, so a bath or a basin has an inside.
// `top` is the rim, `floor` the bottom of the hollow, `rim` how thick the walls are.
function hollow(c, x0, x1, z0, z1, top, floor, rim, mat, inner, k = 1, surf = GLOSS) {
  const { pbox } = c.F, tex = typeof mat === 'object' ? mat : null, hex = tex ? '#ffffff' : mat;
  pbox(x0, x0 + rim, floor, top, z0, z1, hex, k, tex, surf);
  pbox(x1 - rim, x1, floor, top, z0, z1, hex, k, tex, surf);
  pbox(x0 + rim, x1 - rim, floor, top, z0, z0 + rim, hex, k, tex, surf);
  pbox(x0 + rim, x1 - rim, floor, top, z1 - rim, z1, hex, k, tex, surf);
  pbox(x0 + rim, x1 - rim, floor - 0.02, floor, z0 + rim, z1 - rim, inner, k * 0.92, null, surf);
}

// A tap: a pillar, an arched spout and a lever. `x, z` is the pillar on a surface at `y`, and it
// reaches `reach` toward the front of the piece.
function tap(c, x, y, z, reach = 0.16, hex = '#c8ccd0') {
  const { P } = c.F;
  c.lat(x, z, [[0.022, y], [0.016, y + 0.02], [0.012, y + 0.04], [0.012, y + 0.18]], hex, 1.05, 10, METAL);
  c.rod(P(x, y + 0.18, z), P(x, y + 0.26, z + reach * 0.35), 0.011, hex, 1.05);
  c.rod(P(x, y + 0.26, z + reach * 0.35), P(x, y + 0.25, z + reach * 0.75), 0.011, hex, 1.05);
  c.rod(P(x, y + 0.25, z + reach * 0.75), P(x, y + 0.19, z + reach), 0.011, hex, 1.05);
  c.rod(P(x, y + 0.09, z), P(x + 0.07, y + 0.13, z - 0.01), 0.007, hex, 1.05);
}

// How good a kitchen is, 0 to 3: a fine flat's is 3; otherwise the piece's wear, which comes from
// what it cost, sets it. 0 is a slum flat's: doors hanging off, one gone, the laminate peeling. 1 is a
// cheap let's flat doors and plastic knobs; 2 a decent one's framed doors, drawers and a wooden top.
export const kitchenGrade = (c) => c.fine ? 3 : (c.wear ?? 0.3) >= 0.6 ? 0 : (c.wear ?? 0.3) >= 0.35 ? 1 : 2;
// the ink the fittings draw their own edges in: the line round a door, under a worktop's lip, round a
// sink. A run against a wall has no silhouette for the hull ink (gl/ink.js) to find, so it draws its own.
const INK = '#0c0b0d';

// Base units along a run with a worktop: a plinth, door fronts, a slab, each the kitchen's grade.
// `doors` is how many fronts; `hole` ([x0, x1, z0, z1]) is cut out of the worktop for a sink, and the
// carcass stops short under it so the bowl can go down. Returns the top.
export function baseRun(c, y1, opts = {}) {
  const { F, p, r } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, g = opts.grade ?? kitchenGrade(c);
  const n = opts.doors || Math.max(1, Math.round(p.w / (g === 0 ? 0.5 : 0.6)));
  const front = opts.front || c.front || (g === 3 ? '#3b3d41' : pick(r, g === 0 ? ['#cfc6a8', '#b8b098', '#d8ccb0', '#a89c80']
    : g === 1 ? ['#e2dccc', '#e8e4dc', '#c4ccc4', '#d8d0c0'] : ['#4a5a5a', '#2f4a5a', '#e8e4dc', '#5a6a4a', '#8a6a4a']));
  const hole = opts.hole, tt = [0.028, 0.03, 0.038, 0.04][g], yc = hole ? y1 - 0.22 : y1 - tt, zf = hd - 0.03;
  const chip = '#9a7a4a';
  // the carcass, and its sides up to the worktop where the sink takes its top
  pbox(-hw, hw, 0.1, yc, -hd, zf, front, 0.8, null, SATIN);
  if (hole) for (const x of [-hw, hw - 0.018]) pbox(x, x + 0.018, yc, y1 - tt, -hd, zf, front, 0.8, null, SATIN);
  // the plinth: a slum's units stand on their bare legs, half the kick board long gone
  if (g === 0) {
    for (const x of [-hw + 0.05, hw - 0.05]) for (const z of [-hd + 0.05, zf - 0.05]) c.rod(F.P(x, 0, z), F.P(x, 0.1, z), 0.014, '#3a3a3a', 0.9);
    if (r() < 0.6) pbox(-hw, r() < 0.5 ? 0 : hw, 0, 0.095, zf - 0.07, zf - 0.055, '#5a5448', 0.8, null, MATTE);
  } else pbox(-hw, hw, 0, 0.1, -hd, hd - (g === 3 ? 0.09 : 0.06), '#141414', 0.9);
  // the fronts: drawers along the top on a decent kitchen, doors under them
  const top = y1 - tt - 0.012, dr = g >= 2 ? top - 0.15 : top;
  const face = (x0, x1, ya, yb, door, i) => {
    // the ink behind every front shows in the gaps round it: its outline
    pbox(x0 - 0.005, x1 + 0.005, ya - 0.005, yb + 0.005, zf, zf + 0.012, INK, 1);
    if (g === 0) {
      // gone: the inside, a shelf and whatever's on it
      if (door && n > 1 && r() < 0.28) {
        pbox(x0, x1, ya, yb, zf - 0.005, zf + 0.001, '#2a241c', 0.6, null, MATTE);
        pbox(x0, x1, (ya + yb) / 2, (ya + yb) / 2 + 0.016, -hd + 0.02, zf + 0.002, '#b8a888', 0.7, null, MATTE);
        c.lat((x0 + x1) / 2, -0.05, [[0, ya], [0.05, ya], [0.05, ya + 0.12], [0, ya + 0.12]], pick(r, ['#3a6aa8', '#c83a2a', '#d8c84a']), 0.8, 8, GLOSS);
        return;
      }
      // hanging off its top hinge, a replacement in the wrong colour, chipped at a corner, a knob or nothing
      const sag = door && r() < 0.4 ? 0.012 + r() * 0.015 : 0, col = r() < 0.2 ? pick(r, ['#8a6a4a', '#e8e4dc', '#4a5a5a']) : front;
      pbox(x0 + sag * 0.5, x1 + sag * 0.5, ya - sag, yb - sag, zf + 0.002, zf + 0.018, col, 0.78 + r() * 0.12, null, MATTE);
      if (r() < 0.6) { const cx = r() < 0.5 ? x0 : x1 - 0.05; pbox(cx, cx + 0.05, yb - sag - 0.04, yb - sag, zf + 0.0185, zf + 0.019, chip, 0.9, null, MATTE); }
      if (r() < 0.7) { const kx = i % 2 ? x0 + 0.05 : x1 - 0.05; pbox(kx - 0.012, kx + 0.012, yb - sag - 0.1, yb - sag - 0.076, zf + 0.018, zf + 0.034, '#d8d0b8', 0.9, null, GLOSS); }
      return;
    }
    if (g === 1) {
      pbox(x0, x1, ya, yb, zf + 0.002, zf + 0.02, front, 0.92, null, SATIN);
      const kx = i % 2 ? x0 + 0.05 : x1 - 0.05, ky = door ? yb - 0.08 : (ya + yb) / 2;
      c.rod(F.P(kx, ky - 0.04, zf + 0.034), F.P(kx, ky + 0.04, zf + 0.034), 0.008, '#c8c4bc', 1, GLOSS);
      for (const y of [ky - 0.04, ky + 0.04]) c.rod(F.P(kx, y, zf + 0.02), F.P(kx, y, zf + 0.034), 0.006, '#c8c4bc', 1, GLOSS);
      return;
    }
    if (g === 2) {
      // a framed (shaker) front: stiles and rails round a sunk panel, a fine ink line where they meet
      const s = Math.min(0.055, (x1 - x0) * 0.18, (yb - ya) * 0.3);
      pbox(x0, x1, ya, yb, zf + 0.002, zf + 0.012, front, 0.88, null, SATIN);
      pbox(x0 + s - 0.003, x1 - s + 0.003, ya + s - 0.003, yb - s + 0.003, zf + 0.012, zf + 0.0135, INK, 1);
      for (const [a, b, c0, d] of [[x0, x0 + s, ya, yb], [x1 - s, x1, ya, yb], [x0 + s, x1 - s, ya, ya + s], [x0 + s, x1 - s, yb - s, yb]]) pbox(a, b, c0, d, zf + 0.012, zf + 0.022, front, 0.98, null, SATIN);
      pbox(x0 + s, x1 - s, ya + s, yb - s, zf + 0.012, zf + 0.014, front, 0.93, null, SATIN);
      const hx = door ? (i % 2 ? x0 + s / 2 + 0.01 : x1 - s / 2 - 0.01) : (x0 + x1) / 2;
      if (door) c.rod(F.P(hx, yb - 0.2, zf + 0.04), F.P(hx, yb - 0.06, zf + 0.04), 0.007, '#b8a070', 1.05);
      else c.rod(F.P(hx - 0.06, (ya + yb) / 2, zf + 0.04), F.P(hx + 0.06, (ya + yb) / 2, zf + 0.04), 0.007, '#b8a070', 1.05);
      return;
    }
    // fine: flush, handleless, a hairline gap; a dark rail under the worktop to pull them by
    pbox(x0, x1, ya, yb - 0.035, zf + 0.002, zf + 0.022, front, 0.97, null, SATIN);
    pbox(x0, x1, yb - 0.035, yb, zf - 0.01, zf + 0.004, '#1c1d20', 0.9, null, METAL);
  };
  for (let i = 0; i < n; i++) {
    const x0 = -hw + 0.005 + i * p.w / n, x1 = x0 + p.w / n - 0.01;
    face(x0, x1, 0.11, dr - (dr < top ? 0.01 : 0), true, i);
    if (dr < top) face(x0, x1, dr, top, false, i);
  }
  // the worktop: worn laminate, cleaner laminate on an aluminium edge, oiled beech, stone
  const slab = g === 3 ? STONE : g === 2 ? { t: 'roomButcher', c: '#ffffff' } : { t: 'roomLaminate', c: g === 0 ? '#e0d4b8' : '#ffffff' };
  const k = g === 0 ? 0.86 : 1, surf = g === 3 ? SATIN : g === 2 ? SATIN : MATTE, zo = hd + 0.02;
  const slabBox = (a, b, z0, z1) => { if (b - a > 0.001 && z1 - z0 > 0.001) pbox(a, b, y1 - tt, y1, z0, z1, '#a8a49c', k, slab, surf); };
  if (hole) {
    const [hx0, hx1, hz0, hz1] = hole;
    slabBox(-hw, hx0, -hd, zo); slabBox(hx1, hw, -hd, zo); slabBox(hx0, hx1, -hd, hz0); slabBox(hx0, hx1, hz1, zo);
  } else slabBox(-hw, hw, -hd, zo);
  // the ink line under the lip, and the edge: chipboard where the band's peeled, aluminium, a lighter arris on stone
  pbox(-hw, hw, y1 - tt - 0.004, y1 - tt, zf, zo + 0.002, INK, 1);
  if (g === 0) { const a = -hw + r() * p.w * 0.5, b = Math.min(hw, a + 0.15 + r() * 0.35); pbox(a, b, y1 - tt + 0.002, y1 - 0.002, zo, zo + 0.002, chip, 0.95, null, MATTE); }
  else if (g === 1) pbox(-hw, hw, y1 - tt, y1, zo, zo + 0.004, '#a8acb0', 1, null, METAL);
  else if (g === 3) pbox(-hw, hw, y1 - 0.004, y1, zo - 0.004, zo + 0.001, '#c8cacc', 1, null, SATIN);
  // an upstand along the wall on a let flat's; a black line where a slum's worktop has come off the wall
  if (g === 1 || g === 2) pbox(-hw, hw, y1, y1 + 0.05, -hd, -hd + 0.015, '#a8a49c', k, slab, surf);
  else if (g === 0) pbox(-hw, hw, y1, y1 + 0.003, -hd, -hd + 0.01, INK, 1);
  return y1;
}

// A sink let into a worktop at `y`, through the hole baseRun cut at (x, z), bw by bd, of the kitchen's grade:
// chipped enamel with old pillar taps; steel with a drainer; deeper steel; a black undermounted bowl.
function sinkIn(c, g, x, z, bw, bd, y) {
  const { pbox } = c.F, x0 = x - bw / 2, x1 = x + bw / 2, z0 = z - bd / 2, z1 = z + bd / 2, depth = [0.15, 0.16, 0.19, 0.2][g];
  const body = ['#e2dccc', '#b8bcc0', '#c0c4c8', '#26282c'][g], inner = ['#a89e88', '#8e9298', '#9a9ea4', '#1c1d20'][g], surf = g === 0 ? GLOSS : g === 3 ? SATIN : METAL;
  hollow(c, x0, x1, z0, z1, y, y - depth, 0.014, body, inner, g === 0 ? 0.88 : 1, surf);
  // the drain, and a slum sink's rust ring round it and the stain down from the tap
  pbox(x - 0.03, x + 0.03, y - depth + 0.001, y - depth + 0.003, z - 0.03, z + 0.03, g === 3 ? '#8a8c8e' : '#2a2c30', 0.9, null, METAL);
  if (g === 0) {
    pbox(x - 0.06, x + 0.06, y - depth + 0.0005, y - depth + 0.0012, z - 0.06, z + 0.06, '#7a4a22', 0.7, null, MATTE);
    pbox(x - 0.012, x + 0.012, y - depth + 0.02, y - 0.01, z0 + 0.0142, z0 + 0.0146, '#8a5a2a', 0.7, null, MATTE);
  }
  // the rim over the cut, all but the undermounted bowl: a rolled enamel edge or a steel lip
  if (g < 3) for (const [a, b, c0, d] of [[x0 - 0.02, x1 + 0.02, z0 - 0.02, z0], [x0 - 0.02, x1 + 0.02, z1, z1 + 0.02], [x0 - 0.02, x0, z0, z1], [x1, x1 + 0.02, z0, z1]]) pbox(a, b, y, y + 0.006, c0, d, body, 1, null, surf);
  // the ink round it
  const e = g < 3 ? 0.02 : 0, o = 0.004;
  for (const [a, b, c0, d] of [[x0 - e - o, x1 + e + o, z0 - e - o, z0 - e], [x0 - e - o, x1 + e + o, z1 + e, z1 + e + o], [x0 - e - o, x0 - e, z0 - e, z1 + e], [x1 + e, x1 + e + o, z0 - e, z1 + e]]) pbox(a, b, y, y + 0.0015, c0, d, INK, 1);
  // a drainer to the right on the steel ones: a plate with grooves running into the bowl
  if (g === 1 || g === 2) {
    const d0 = x1 + 0.02, d1 = Math.min(x1 + 0.4, c.p.w / 2 - 0.05);
    if (d1 - d0 > 0.15) {
      pbox(d0, d1, y, y + 0.005, z0 - 0.02, z1 + 0.02, body, 1, null, METAL);
      for (let i = 1; i < 7; i++) { const zz = z0 + i * bd / 7; pbox(d0 + 0.02, d1 - 0.03, y + 0.005, y + 0.0058, zz - 0.003, zz + 0.003, '#6a6e74', 0.9, null, METAL); }
      pbox(d0, d1 + 0.004, y, y + 0.0015, z1 + 0.02, z1 + 0.024, INK, 1);
    }
  }
}

// a slum sink's taps: two pillars with cross heads, one dripping
function pillarTaps(c, x, y, z) {
  const { F } = c;
  for (const dx of [-0.08, 0.08]) {
    c.lat(x + dx, z, [[0.02, y], [0.016, y + 0.01], [0.012, y + 0.1], [0, y + 0.1]], '#b8b4a8', 0.95, 8, METAL);
    c.rod(F.P(x + dx, y + 0.08, z), F.P(x + dx, y + 0.07, z + 0.07), 0.009, '#b8b4a8', 0.95);
    c.rod(F.P(x + dx - 0.03, y + 0.11, z), F.P(x + dx + 0.03, y + 0.11, z), 0.006, '#d8d4c8', 1);
    c.rod(F.P(x + dx, y + 0.11, z - 0.03), F.P(x + dx, y + 0.11, z + 0.03), 0.006, '#d8d4c8', 1);
  }
}

// Bottles in a row on a shelf at `y`, from x0 to x1, each its own height and glass.
function bottles(c, x0, x1, y, z, n) {
  const cols = ['#5a2a1a', '#2a5a3a', '#c8a050', '#a84a2a', '#e0d8c0', '#2a3a5a', '#7a3a5a'];
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * (x1 - x0) / n + (c.r() - 0.5) * 0.02, h = 0.2 + c.r() * 0.1, wd = 0.03 + c.r() * 0.012, col = pick(c.r, cols);
    c.lat(x, z, [[0, y], [wd, y], [wd, y + h * 0.62], [wd * 0.4, y + h * 0.78], [wd * 0.34, y + h], [0, y + h]], col, 0.95, 10, GLOSS);
  }
}

// Clothes on a rail between x0 and x1 at height y: hangers, then a garment as a soft block.
function hanging(c, x0, x1, y, z) {
  const { F, r } = c, n = Math.max(3, Math.round((x1 - x0) / 0.1));
  const cols = c.fine ? ['#2a2c30', '#3a3e46', '#6a6e74', '#c8c4b8', '#4a3a30'] : ['#3a4a5a', '#6a3a2a', '#4a5a3a', '#8a7a5a', '#2a2a2e', '#7a2a2a'];
  for (let i = 0; i < n; i++) {
    if (r() < 0.16) continue;
    const x = x0 + (i + 0.5) * (x1 - x0) / n, l = 0.75 + r() * 0.4, col = pick(r, cols);
    c.rod(F.P(x, y, z), F.P(x, y - 0.06, z), 0.003, '#c8ccd0', 1, METAL, 4);
    c.R(...F.alongX(), x - 0.03, x + 0.03, z - 0.2, z + 0.2, y - 0.06 - l, y - 0.06, 0.025, { t: 'roomWeave', c: col }, 0.95, CLOTH);
  }
}

const FORMS = {
  // ── sitting and lying ─────────────────────────────────────────────────────────────────────────
  armchair(c) {
    // a deep chair: a rounded body on short legs, a cushion, wings; a throw on a worn one
    const { F, p, r } = c, { alongX, alongZ, alongY } = F, hw = p.w / 2, hd = p.d / 2, arm = 0.14, sy = 0.42 - c.wear * 0.04;
    const mat = c.fine ? { t: 'roomWeave', c: pick(r, ['#6a6e6c', '#8a7a64', '#3c4248', '#a39a88']) } : c.fab;
    for (const [x, z] of [[-hw + 0.07, -hd + 0.07], [hw - 0.07, -hd + 0.07], [-hw + 0.07, hd - 0.08], [hw - 0.07, hd - 0.08]]) c.lat(x, z, [[0.016, 0], [0.024, 0.14]], c.fine ? '#2a2018' : '#3a2818', 0.9, 8, SATIN);
    c.R(...alongX(), -hw + 0.02, hw - 0.02, -hd + 0.05, hd - 0.02, 0.14, 0.3, 0.05, mat, c.tired(0.86), CLOTH);
    c.R(...alongX(0.2, 0.3), -hw + 0.03, hw - 0.03, -hd + 0.01, -hd + 0.18, 0.28, p.h, 0.07, mat, c.tired(0.9), CLOTH);
    c.R(...alongX(), -hw + arm, hw - arm, -hd + 0.2, hd + 0.01, 0.3, sy + 0.08, 0.05, mat, c.tired(1), CLOTH);
    c.R(...alongX(0.14, 0.4), -hw + arm + 0.02, hw - arm - 0.02, -hd + 0.17, -hd + 0.3, sy + 0.08, p.h - 0.09, 0.06, mat, c.tired(0.97), CLOTH);
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? -hw : hw - arm, x1 = s < 0 ? -hw + arm : hw;
      c.R(...alongZ(), -hd + 0.04, hd - 0.01, x0 + 0.005, x1 - 0.005, 0.14, 0.6, 0.05, mat, c.tired(0.92), CLOTH);
    }
    void alongY;
  },
  platform(c) {
    // a low bed on a frame set back from the floor, so it floats on its shadow: a mattress, linen, a
    // tall headboard across the wall and a shelf either side with a lamp let into the wall over it
    const { F, p, r } = c, { pbox, alongZ, alongX } = F, hw = p.w / 2, hd = p.d / 2, mw = hw - 0.42, top = 0.5;
    const oak = { t: 'roomOak', c: c.fine ? '#b08a60' : '#8a6038' }, cloud = pick(r, ['#c9ccce', '#bfc3c6', '#d2d0ca']);
    pbox(-mw + 0.08, mw - 0.08, 0, 0.09, -hd + 0.1, hd - 0.14, '#0e0e10', 0.85);
    pbox(-mw - 0.05, mw + 0.05, 0.09, 0.26, -hd + 0.04, hd, '#7a5a3a', 1, oak, SATIN);
    c.R(...alongZ(), -hd + 0.08, hd - 0.05, -mw, mw, 0.26, top - 0.02, 0.05, { t: 'roomTicking', c: '#e8e4da' }, 1, CLOTH);
    c.R(...alongZ(), -hd + 0.75, hd + 0.0, -mw - 0.02, mw + 0.02, top - 0.07, top + 0.05, 0.05, { t: 'roomWeave', c: cloud }, 1, CLOTH);
    c.R(...alongZ(), -hd + 0.68, -hd + 0.84, -mw - 0.015, mw + 0.015, top - 0.04, top + 0.065, 0.04, { t: 'roomWeave', c: '#ece6da' }, 1, CLOTH);
    // a throw across the foot
    c.R(...alongZ(), hd - 0.62, hd - 0.14, -mw - 0.03, mw + 0.03, top + 0.03, top + 0.07, 0.02, { t: 'roomWeave', c: pick(r, ['#5a6068', '#7a6a5a', '#3a4a4a']) }, 1, CLOTH);
    for (const x of [-mw * 0.5, mw * 0.5]) c.R(...alongX(), x - mw * 0.46, x + mw * 0.46, -hd + 0.16, -hd + 0.6, top - 0.01, top + 0.12, 0.055, { t: 'roomTicking', c: '#f2efe8' }, 1, CLOTH);
    // the headboard: upholstered panels across the whole width, with a shelf and a lamp each side
    const n = 6;
    for (let i = 0; i < n; i++) { const x0 = -hw + i * p.w / n, x1 = x0 + p.w / n - 0.006; c.R(...alongX(), x0 + 0.003, x1, -hd, -hd + 0.07, 0.2, 1.12, 0.03, { t: 'roomWeave', c: '#7a7670' }, 0.92, CLOTH); }
    for (const s of [-1, 1]) {
      const x = s * (hw - 0.2);
      pbox(x - 0.19, x + 0.19, 0.42, 0.45, -hd + 0.07, -hd + 0.46, '#7a5a3a', 1, oak, SATIN);
      c.lat(x, -hd + 0.26, [[0, 0.45], [0.05, 0.45], [0.018, 0.47], [0.012, 0.56], [0, 0.56]], '#2a2c30', 0.95, 12, METAL);
      c.lat(x, -hd + 0.26, [[0.065, 0.56], [0.05, 0.68], [0, 0.68]], '#ffe6b8', 1.5, 12);
    }
  },
  mattress(c) {
    // a mattress on the floor: ticking gone grey, a pillow without a slip, a blanket kicked down
    const { F, p, r } = c, { alongZ, alongX } = F, hw = p.w / 2, hd = p.d / 2, top = 0.22;
    c.R(...alongZ(), -hd, hd, -hw, hw, 0, top, 0.05, { t: 'roomTicking', c: '#b8b4a8' }, c.tired(0.92), CLOTH);
    c.stain(-hw * 0.3, top + 0.002, hd * 0.2, 0.14); c.stain(hw * 0.3, top + 0.002, -hd * 0.3, 0.1);
    c.R(...alongX(), -hw + 0.12, hw - 0.12, -hd + 0.06, -hd + 0.42, top, top + 0.1, 0.05, { t: 'roomTicking', c: '#d8d4c8' }, 0.95, CLOTH);
    c.R(...alongZ(), hd * 0.1, hd - 0.1, -hw + 0.04, hw - 0.04, top, top + 0.06, 0.03, { t: 'roomWeave', c: pick(r, ['#6a5a4a', '#5a6a5a', '#7a4a3a']) }, 0.95, CLOTH);
  },

  // ── keeping things ────────────────────────────────────────────────────────────────────────────
  wardrobe(c) {
    // a timber wardrobe: a plinth, a cornice, two doors with sunk panels, and a pair of handles; on a
    // worn one a door has dropped a little
    const { F, p, r } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, wood = c.wood, n = p.w > 1.1 ? 3 : 2;
    pbox(-hw, hw, 0, 0.09, -hd, hd - 0.02, '#3a2a1e', 0.85, wood, SATIN);
    pbox(-hw + 0.01, hw - 0.01, 0.09, h - 0.08, -hd, hd - 0.04, '#5a3a22', 0.85, wood, SATIN);
    pbox(-hw - 0.012, hw + 0.012, h - 0.08, h, -hd - 0.0, hd + 0.01, '#5a3a22', 0.95, wood, SATIN);
    for (let i = 0; i < n; i++) {
      const x0 = -hw + 0.02 + i * (p.w - 0.04) / n, x1 = x0 + (p.w - 0.04) / n - 0.006, sag = c.wear > 0.5 && i === 1 ? 0.012 : 0;
      pbox(x0, x1, 0.1 - sag, h - 0.09 - sag, hd - 0.04, hd - 0.012, '#5a3a22', 0.97, wood, SATIN);
      pbox(x0 + 0.06, x1 - 0.06, 0.24, h * 0.5, hd - 0.012, hd - 0.008, '#5a3a22', 0.9, wood, SATIN);
      pbox(x0 + 0.06, x1 - 0.06, h * 0.5 + 0.08, h - 0.2, hd - 0.012, hd - 0.008, '#5a3a22', 0.9, wood, SATIN);
      c.lat(i % 2 ? x0 + 0.05 : x1 - 0.05, hd + 0.012, [[0, 1.08], [0.016, 1.09], [0.016, 1.11], [0, 1.12]], '#c9a24a', 1.05, 8, METAL);
    }
    // a suitcase on top of a lived-in one
    if (c.wear > 0.3 && r() < 0.7) pbox(-hw * 0.5, hw * 0.3, h, h + 0.18, -hd * 0.6, hd * 0.5, '#6a4a2a', 0.9, null, LEATHER);
  },
  valet(c) {
    // a fitted dressing wall: flush panels with a shadow gap and no handles, a light line along the
    // plinth, and one bay left open with a lit rail and shelves of folded things
    const { F, p, r } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, n = Math.max(3, Math.round(p.w / 0.55));
    const panel = { t: 'roomOak', c: c.fine ? '#a88862' : '#8a6a4a' }, open = 1 + Math.floor(r() * (n - 2)), bw = p.w / n;
    pbox(-hw, hw, 0, 0.06, -hd, hd - 0.05, '#101012', 0.9);
    pbox(-hw + 0.01, hw - 0.01, 0.002, 0.008, hd - 0.05, hd - 0.046, '#ffe9c4', 1.6);
    pbox(-hw, hw, h - 0.03, h, -hd, hd, '#7a5a3a', 1, panel, SATIN);
    pbox(-hw, hw, 0.06, h - 0.03, -hd, -hd + 0.03, '#26262a', 0.85, null, SATIN);
    for (let i = 0; i < n; i++) {
      const x0 = -hw + i * bw, x1 = x0 + bw;
      if (i === open) {
        // the open bay: a dark inside, a rail with a light over it, shelves below
        pbox(x0, x0 + 0.015, 0.06, h - 0.03, -hd + 0.03, hd - 0.02, '#2a2420', 0.9, null, SATIN);
        pbox(x1 - 0.015, x1, 0.06, h - 0.03, -hd + 0.03, hd - 0.02, '#2a2420', 0.9, null, SATIN);
        pbox(x0 + 0.02, x1 - 0.02, h - 0.05, h - 0.035, -0.02, 0.02, '#ffe9c4', 1.7);
        c.rod(F.P(x0 + 0.015, h - 0.2, 0), F.P(x1 - 0.015, h - 0.2, 0), 0.012, '#c9a24a', 1.05);
        hanging(c, x0 + 0.03, x1 - 0.03, h - 0.21, 0);
        for (const y of [0.3, 0.56]) {
          pbox(x0 + 0.015, x1 - 0.015, y - 0.015, y, -hd + 0.03, hd - 0.04, '#7a5a3a', 1, panel, SATIN);
          for (let k = 0; k < 3; k++) pbox(x0 + 0.05, x1 - 0.05, y + k * 0.04, y + k * 0.04 + 0.036, -hd + 0.1, hd - 0.14, pick(r, ['#3a3e46', '#c8c4b8', '#6a6e74', '#4a3a30']), 0.95, null, CLOTH);
        }
      } else {
        pbox(x0 + 0.003, x1 - 0.003, 0.065, h - 0.035, hd - 0.05, hd - 0.012, '#7a5a3a', 1, panel, SATIN);
      }
    }
  },
  cupboard(c) {
    // wall cupboards: a carcass hung on the wall, two or three doors, a light line under them
    const { F, p, r } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, y0 = HUNG_AT, y1 = y0 + p.h, n = Math.max(2, Math.round(p.w / 0.45));
    const front = c.fine ? '#3b3d41' : pick(r, ['#d8d0c0', '#c8d0c8', '#8a6a4a']);
    pbox(-hw, hw, y0, y1, -hd, hd - 0.02, front, 0.85, null, SATIN);
    for (let i = 0; i < n; i++) {
      const x0 = -hw + 0.004 + i * p.w / n, x1 = x0 + p.w / n - 0.008;
      pbox(x0, x1, y0 + 0.006, y1 - 0.006, hd - 0.02, hd - 0.002, front, 0.97, null, SATIN);
      if (!c.fine) { const x = i % 2 ? x0 + 0.04 : x1 - 0.04; c.rod(F.P(x, y0 + 0.06, hd + 0.012), F.P(x, y0 + 0.16, hd + 0.012), 0.006, '#c8ccd0', 1.05); }
    }
    if (c.fine) pbox(-hw + 0.03, hw - 0.03, y0 - 0.006, y0, -0.04, 0.04, '#ffe9c4', 1.7);
  },
  vitrine(c) {
    // a tall cabinet with a glass front and lit shelves, standing on the floor
    const { F, p, r } = c, { pbox, N, P } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, oak = c.wood;
    pbox(-hw, hw, 0, 0.1, -hd, hd, '#3a2a1e', 0.85, oak, SATIN);
    pbox(-hw, hw, h - 0.05, h, -hd, hd, '#3a2a1e', 0.9, oak, SATIN);
    pbox(-hw, -hw + 0.03, 0.1, h - 0.05, -hd, hd, '#3a2a1e', 0.9, oak, SATIN);
    pbox(hw - 0.03, hw, 0.1, h - 0.05, -hd, hd, '#3a2a1e', 0.9, oak, SATIN);
    pbox(-hw + 0.03, hw - 0.03, 0.1, h - 0.05, -hd, -hd + 0.015, '#2a2622', 0.8, null, SATIN);
    const shelves = 4;
    for (let i = 1; i <= shelves; i++) {
      const y = 0.1 + i * (h - 0.2) / (shelves + 0.6);
      pbox(-hw + 0.03, hw - 0.03, y - 0.008, y, -hd + 0.015, hd - 0.03, '#dfe6e8', 0.9, null, GLOSS);
      pbox(-hw + 0.04, hw - 0.04, y + 0.3, y + 0.303, -hd + 0.02, -hd + 0.03, '#ffe9c4', 1.6);
      bottles(c, -hw + 0.08, hw - 0.08, y, 0, 3 + Math.floor(r() * 3));
    }
    c.K.quad(c.K.glass, [P(-hw + 0.03, 0.1, hd - 0.012), P(hw - 0.03, 0.1, hd - 0.012), P(hw - 0.03, h - 0.05, hd - 0.012), P(-hw + 0.03, h - 0.05, hd - 0.012)], N(0, 0, 1), [0.8, 0.86, 0.9], GLOSS, null, true);
    c.rod(P(-0.04, 1.0, hd + 0.01), P(-0.04, 1.22, hd + 0.01), 0.006, '#c9a24a', 1.05);
  },
  humidor(c) {
    // a climate case: graphite frame, cedar inside, smoked glass, racks of cigars lying
    // nose-out under cool light strips, a lit hygrometer readout and a card slot by the handle
    const { F, p, r } = c, { pbox, N, P } = F, hw = p.w / 2, hd = p.d / 2, h = p.h;
    const frame = '#1e2024', cedar = '#9a5a34', slat = '#b06a3e';
    pbox(-hw, hw, 0, 0.12, -hd, hd, frame, 0.85, null, METAL);
    pbox(-hw, hw, h - 0.07, h, -hd, hd, frame, 0.9, null, METAL);
    pbox(-hw, -hw + 0.035, 0.12, h - 0.07, -hd, hd, frame, 0.9, null, METAL);
    pbox(hw - 0.035, hw, 0.12, h - 0.07, -hd, hd, frame, 0.9, null, METAL);
    pbox(-hw + 0.035, hw - 0.035, 0.12, h - 0.07, -hd, -hd + 0.02, cedar, 0.85, null, SATIN);
    pbox(-hw + 0.035, -hw + 0.05, 0.12, h - 0.07, -hd + 0.02, hd - 0.03, cedar, 0.85, null, SATIN);
    pbox(hw - 0.05, hw - 0.035, 0.12, h - 0.07, -hd + 0.02, hd - 0.03, cedar, 0.85, null, SATIN);
    const racks = 5, x0 = -hw + 0.07, x1 = hw - 0.07;
    for (let i = 0; i < racks; i++) {
      const y = 0.2 + i * (h - 0.36) / racks;
      pbox(-hw + 0.05, hw - 0.05, y - 0.012, y, -hd + 0.02, hd - 0.04, slat, 0.95, null, SATIN);
      pbox(-hw + 0.05, hw - 0.05, y + 0.17, y + 0.174, -hd + 0.03, hd - 0.05, '#cfe8ff', 1.7);
      const n = Math.max(6, Math.round((x1 - x0) / 0.032));
      for (let row = 0; row < 2; row++) {
        const cy = y + 0.012 + row * 0.022;
        for (let k = 0; k < n; k++) {
          if (r() < 0.08) continue;
          const x = x0 + (k + 0.5 + row * 0.5) * (x1 - x0) / (n + 0.5), col = pick(r, ['#4a2a18', '#5a3420', '#3a2014', '#6a3e22']);
          c.rod(P(x, cy, -hd + 0.06), P(x, cy, hd - 0.08), 0.0105, col, 1, MATTE, 6);
          c.rod(P(x, cy, hd - 0.14), P(x, cy, hd - 0.12), 0.0112, i % 2 ? '#c9a24a' : '#18181a', 1.05, METAL, 6);
        }
      }
    }
    c.K.quad(c.K.glass, [P(-hw + 0.035, 0.12, hd - 0.012), P(hw - 0.035, 0.12, hd - 0.012), P(hw - 0.035, h - 0.07, hd - 0.012), P(-hw + 0.035, h - 0.07, hd - 0.012)], N(0, 0, 1), [0.42, 0.46, 0.5], GLOSS, null, true);
    c.rod(P(hw - 0.08, 0.7, hd + 0.012), P(hw - 0.08, 1.12, hd + 0.012), 0.007, '#c8ccd0', 1.05, METAL);
    pbox(-hw + 0.1, -hw + 0.3, h - 0.06, h - 0.02, hd - 0.004, hd + 0.004, '#0a0c10', 1, null, GLOSS);
    pbox(-hw + 0.12, -hw + 0.22, h - 0.05, h - 0.03, hd + 0.004, hd + 0.006, '#7ad8ff', 1.9);
    pbox(hw - 0.06, hw - 0.01, 0.5, 0.62, hd - 0.004, hd + 0.01, '#101216', 1, null, METAL);
    pbox(hw - 0.05, hw - 0.02, 0.6, 0.605, hd + 0.01, hd + 0.012, '#5aff9a', 1.8);
  },
  rack(c) {
    // a wire plate rack on the wall: two rails of bars with plates stood in it
    const { F, p, r } = c, hw = p.w / 2, hd = p.d / 2, y0 = HUNG_AT, y1 = y0 + p.h;
    for (const y of [y0, y0 + 0.08, y1 - 0.06]) for (const z of [-hd + 0.02, hd - 0.03]) c.rod(F.P(-hw, y, z), F.P(hw, y, z), 0.005, '#b8bcc0', 1, METAL, 4);
    const n = Math.round(p.w / 0.05);
    for (let i = 0; i <= n; i++) { const x = -hw + i * p.w / n; c.rod(F.P(x, y0, hd - 0.03), F.P(x, y0 + 0.2, hd - 0.03), 0.003, '#b8bcc0', 1, METAL, 4); }
    for (let i = 0; i < 6; i++) {
      const x = -hw + 0.1 + i * (p.w - 0.2) / 5, [u, v] = F.P(x, 0, 0);
      void u; void v;
      c.R(...F.alongX(), x - 0.008, x + 0.008, -0.12, 0.12, y0 + 0.02, y0 + 0.26, 0.006, pick(r, ['#f2efe8', '#e4e0d4', '#c8d8d0']), 1, GLOSS);
    }
  },
  shelves(c) {
    // steel shelving: four uprights, shelves, and what's been put on them
    const { F, p, r } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, n = Math.max(3, Math.round(h / 0.45));
    for (const [x, z] of [[-hw + 0.02, -hd + 0.02], [hw - 0.02, -hd + 0.02], [-hw + 0.02, hd - 0.02], [hw - 0.02, hd - 0.02]]) pbox(x - 0.016, x + 0.016, 0, h, z - 0.016, z + 0.016, '#6a6e74', 0.95, null, METAL);
    for (let i = 0; i < n; i++) {
      const y = 0.12 + i * (h - 0.16) / (n - 1);
      pbox(-hw, hw, y - 0.02, y, -hd, hd, '#7a7e84', 0.95, null, METAL);
      if (i === n - 1) continue;
      for (let x = -hw + 0.06; x < hw - 0.14;) {
        const w = 0.1 + r() * 0.2, t = 0.1 + r() * 0.22;
        if (r() < 0.8) pbox(x, x + w, y, y + t, -hd + 0.05, hd - 0.06, pick(r, ['#8a7a5a', '#6a5a4a', '#3a4a5a', '#c8c0a8', '#5a6a5a']), 0.95, null, MATTE);
        x += w + 0.02;
      }
    }
  },
  locker(c) {
    // a steel locker: a door with louvres, a hasp and a number plate
    const { F, p, r } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, paint = pick(r, ['#5a6a6a', '#6a6a5a', '#4a5a6a', '#7a7468']);
    pbox(-hw, hw, 0, h, -hd, hd - 0.02, paint, 0.9, null, METAL);
    pbox(-hw + 0.02, hw - 0.02, 0.05, h - 0.03, hd - 0.02, hd - 0.004, paint, 0.97, null, METAL);
    for (let i = 0; i < 5; i++) { const y = h - 0.2 - i * 0.05; pbox(-hw + 0.12, hw - 0.12, y, y + 0.022, hd - 0.004, hd, '#1a1a1c', 0.9, null, METAL); }
    pbox(hw - 0.09, hw - 0.05, h * 0.5, h * 0.5 + 0.12, hd - 0.004, hd + 0.012, '#c8ccd0', 1.05, null, METAL);
    pbox(-0.06, 0.06, h - 0.1, h - 0.06, hd - 0.004, hd, '#d8d4c8', 1, null, SATIN);
    c.stain(0, h * 0.35, hd, 0.06);
  },
  crate(c) {
    // a crate: slats round a box, a lid sat on it
    const { F, p } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, n = 3;
    pbox(-hw + 0.02, hw - 0.02, 0.02, h - 0.04, -hd + 0.02, hd - 0.02, '#3a2a1e', 0.75);
    for (let i = 0; i < n; i++) {
      const y = 0.03 + i * (h - 0.08) / n, t = (h - 0.08) / n - 0.018;
      pbox(-hw, hw, y, y + t, hd - 0.02, hd, '#8a6a4a', 0.95, c.wood, SATIN);
      pbox(-hw, hw, y, y + t, -hd, -hd + 0.02, '#8a6a4a', 0.95, c.wood, SATIN);
      pbox(-hw, -hw + 0.02, y, y + t, -hd, hd, '#8a6a4a', 0.92, c.wood, SATIN);
      pbox(hw - 0.02, hw, y, y + t, -hd, hd, '#8a6a4a', 0.92, c.wood, SATIN);
    }
    pbox(-hw - 0.01, hw + 0.01, h - 0.03, h, -hd - 0.01, hd + 0.01, '#8a6a4a', 1, c.wood, SATIN);
  },
  column(c) {
    // a tall freezer to stand beside a fridge: one door, a bar handle, a lamp at the top
    const { F, p } = c, { pbox, alongY } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, zf = hd - 0.04, steel = { t: 'roomSteel', c: '#d0d4d8' };
    c.R(...alongY(), 0.06, h, -hw + 0.008, hw - 0.008, -hd, zf, 0.03, steel, 0.96, METAL);
    pbox(-hw + 0.02, hw - 0.02, 0, 0.06, -hd + 0.04, zf - 0.05, '#141414', 0.9);
    c.R(...alongY(), 0.07, h - 0.015, -hw + 0.01, hw - 0.01, zf, zf + 0.035, 0.012, steel, 1.02, METAL);
    const hx = hw - 0.07;
    c.rod(F.P(hx, h * 0.35, zf + 0.06), F.P(hx, h * 0.8, zf + 0.06), 0.012, '#e0e4e8', 1.1);
    for (const y of [h * 0.35, h * 0.8]) c.rod(F.P(hx, y, zf + 0.035), F.P(hx, y, zf + 0.06), 0.008, '#e0e4e8', 1.1);
    pbox(-0.05, 0.05, h - 0.12, h - 0.09, zf + 0.035, zf + 0.037, '#0a1a24', 1, null, GLOSS);
    pbox(-0.04, 0.0, h - 0.113, h - 0.097, zf + 0.037, zf + 0.0385, '#7ad8ff', 1.6);
  },

  // ── kitchen ───────────────────────────────────────────────────────────────────────────────────
  kitchen(c) {
    // a sink in a run of base units: a bowl at the left, a tap behind it, the worktop clear to the right
    const { p } = c, hw = p.w / 2, g = kitchenGrade(c), x = -hw + 0.34, bw = 0.42, bd = 0.36, z = 0.03;
    const top = baseRun(c, p.h, { grade: g, hole: [x - bw / 2, x + bw / 2, z - bd / 2, z + bd / 2] });
    sinkIn(c, g, x, z, bw, bd, top);
    if (g === 0) pillarTaps(c, x, top, -p.d / 2 + 0.06);
    else tap(c, x, top, -p.d / 2 + 0.07, g === 3 ? 0.22 : 0.17, g === 3 ? '#2a2c30' : '#c8ccd0');
    if (!c.fine) {
      // a cloth over the tap's neck and a bottle of washing-up liquid
      c.lat(x + 0.3, -p.d / 2 + 0.12, [[0, top], [0.03, top], [0.03, top + 0.15], [0.012, top + 0.19], [0, top + 0.19]], c.pick(['#3aa84a', '#d8a83a', '#2a6ad8']), 0.95, 10, GLOSS);
    }
  },
  trough(c) {
    // a long steel trough on legs, with two taps along its back
    const { F, p } = c, hw = p.w / 2, hd = p.d / 2, y = p.h;
    for (const [x, z] of [[-hw + 0.05, -hd + 0.05], [hw - 0.05, -hd + 0.05], [-hw + 0.05, hd - 0.05], [hw - 0.05, hd - 0.05]]) c.rod(F.P(x, 0, z), F.P(x, y - 0.2, z), 0.018, '#8a9098', 0.95);
    hollow(c, -hw, hw, -hd, hd, y, y - 0.18, 0.025, '#b8bcc0', '#8e9298', 1, METAL);
    for (const x of [-hw * 0.5, hw * 0.5]) tap(c, x, y, -hd + 0.015, 0.2);
  },
  basin(c) {
    // a bathroom basin on the wall with a mirror over it. Fine: a sculpted stone bowl on a floating
    // slab and a mirror lit from behind. Plain: a china basin on a pedestal and a bare mirror
    const { F, p } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, y = p.h;
    if (c.fine) {
      pbox(-hw, hw, y - 0.14, y - 0.1, -hd, hd, '#8a8c8e', 1, STONE, SATIN);
      hollow(c, -hw + 0.06, hw - 0.06, -hd + 0.1, hd - 0.04, y, y - 0.1, 0.03, STONE, '#6a6c70', 1, SATIN);
      tap(c, 0, y - 0.1, -hd + 0.05, 0.2, '#2a2c30');
      pbox(-hw + 0.02, hw - 0.02, 1.2, 1.95, -hd, -hd + 0.012, '#8ea2ae', 0.95, null, GLOSS);
      pbox(-hw - 0.012, hw + 0.012, 1.188, 1.2, -hd, -hd + 0.004, '#ffe9c4', 1.7);
      pbox(-hw - 0.012, hw + 0.012, 1.95, 1.962, -hd, -hd + 0.004, '#ffe9c4', 1.7);
    } else {
      c.lat(0, -hd + 0.14, [[0.12, 0], [0.09, 0.03], [0.07, 0.3], [0.09, y - 0.14], [0, y - 0.14]], '#e8e4da', 0.96, 16, GLOSS);
      c.R(...F.alongX(), -hw, hw, -hd, hd, y - 0.14, y, 0.05, '#e8e4da', 0.98, GLOSS);
      pbox(-hw + 0.08, hw - 0.08, y + 0.001, y + 0.0025, -hd + 0.1, hd - 0.08, '#9aa2a8', 0.5, null, GLOSS);
      for (const x of [-0.08, 0.08]) c.lat(x, -hd + 0.05, [[0.016, y], [0.012, y + 0.06], [0.022, y + 0.07], [0, y + 0.08]], '#c8ccd0', 1.05, 8, METAL);
      pbox(-hw + 0.04, hw - 0.04, 1.2, 1.75, -hd, -hd + 0.015, '#8ea2ae', 0.92, null, GLOSS);
    }
  },
  seam(c) {
    // an induction hob let into a stone worktop: a run of base units and a black glass strip with its
    // zones marked in fine light
    const { p } = c, { pbox } = c.F, hw = p.w / 2, hd = p.d / 2, top = baseRun(c, p.h, { doors: 2 });
    pbox(-hw + 0.1, hw - 0.1, top, top + 0.003, -hd + 0.07, hd - 0.08, '#0a0b0d', 0.9, null, GLOSS);
    const n = Math.max(2, Math.round(p.w / 0.32));
    for (let i = 0; i < n; i++) { const x = -hw + 0.16 + (i + 0.5) * (p.w - 0.32) / n; c.lat(x, 0, [[0.085, top + 0.0032], [0.09, top + 0.0032], [0.09, top + 0.0036], [0.085, top + 0.0036]], '#7a2a1a', 1.3, 24); }
    pbox(-0.06, 0.06, top + 0.003, top + 0.0036, hd - 0.14, hd - 0.12, '#ff6a2a', 1.6);
  },
  kettle(c) {
    // a kettle on its base, on a worktop or wherever it was left
    const y = c.p.rise || 0, { F } = c, col = c.fine ? '#2a2c30' : c.pick(['#c8ccd0', '#d8d4c8', '#c83a2a']);
    c.lat(0, 0, [[0, y], [0.085, y], [0.088, y + 0.02], [0, y + 0.022]], '#1a1a1c', 0.9, 16, SATIN);
    c.lat(0, 0, [[0, y + 0.022], [0.08, y + 0.022], [0.088, y + 0.05], [0.07, y + 0.17], [0.055, y + 0.2], [0.03, y + 0.21], [0, y + 0.215]], col, 1, 18, c.fine ? SATIN : METAL);
    c.rod(F.P(0, y + 0.19, -0.05), F.P(0, y + 0.2, -0.13), 0.011, '#1a1a1c', 0.9, SATIN);
    c.rod(F.P(0, y + 0.2, -0.13), F.P(0, y + 0.06, -0.12), 0.011, '#1a1a1c', 0.9, SATIN);
    c.rod(F.P(0, y + 0.15, 0.06), F.P(0, y + 0.2, 0.11), 0.012, col, 1, METAL);
  },
  press(c) {
    // a machine for coffee: a square body, a bean hopper, two spouts over a drip tray, a lit panel
    const y = c.p.rise || 0, { F, p } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, h = p.h;
    pbox(-hw, hw, y, y + h * 0.82, -hd, hd - 0.06, '#26282c', 0.92, null, SATIN);
    pbox(-hw, hw, y + h * 0.6, y + h * 0.82, hd - 0.06, hd, '#26282c', 0.96, null, SATIN);
    pbox(-hw + 0.02, hw - 0.02, y, y + 0.03, hd - 0.1, hd, '#c8ccd0', 1, null, METAL);
    c.lat(0, 0, [[0.05, y + h * 0.82], [0.07, y + h], [0, y + h]], '#4a3a2a', 0.8, 12, GLOSS);
    pbox(-hw + 0.03, hw - 0.03, y + h * 0.66, y + h * 0.78, hd, hd + 0.002, '#0a1a24', 1, null, GLOSS);
    pbox(-hw + 0.05, hw * 0.3, y + h * 0.7, y + h * 0.74, hd + 0.002, hd + 0.003, '#7ad8ff', 1.6);
    for (const x of [-0.03, 0.03]) c.rod(F.P(x, y + h * 0.6, hd - 0.03), F.P(x, y + h * 0.5, hd - 0.03), 0.008, '#c8ccd0', 1.05);
  },
  bar(c) {
    // a bar you stand at: a reeded oak front under a slab that comes down both ends to the floor, a
    // brass rail for your foot, a line of light under the lip. Its front faces whoever's drinking
    // In a club (spec.club) it's chipped black laminate with red light under the lip and a chrome rail
    const { F, p, r } = c, { pbox, P } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, club = !!c.L?.spec?.club;
    const oak = club ? null : { t: 'roomOak', c: '#6a4a30' }, front = club ? '#141216' : '#4a3020', slab = club ? null : c.fine ? { t: 'roomStone', c: '#e0dcd2' } : { t: 'roomConcrete', c: '#b8b4ac' }, slabC = club ? '#1c1a1e' : '#ffffff', brass = club ? '#c8ccd0' : '#b8923e';
    pbox(-hw + 0.08, hw - 0.08, 0, 0.1, -hd + 0.04, hd - 0.14, '#101012', 0.9);
    pbox(-hw + 0.06, hw - 0.06, 0.1, h - 0.05, -hd + 0.04, hd - 0.1, front, 0.9, oak, SATIN);
    const n = Math.round((p.w - 0.12) / 0.075);
    for (let i = 0; i < n; i++) { const x0 = -hw + 0.06 + i * (p.w - 0.12) / n, x1 = x0 + (p.w - 0.12) / n - 0.012; pbox(x0, x1, 0.1, h - 0.05, hd - 0.1, hd - 0.075, front, 1, oak, club ? GLOSS : SATIN); }
    for (const x of [-hw, hw - 0.06]) pbox(x, x + 0.06, 0, h - 0.05, -hd, hd, slabC, 1, slab, SATIN);
    pbox(-hw, hw, h - 0.05, h, -hd, hd, slabC, 1, slab, club ? GLOSS : SATIN);
    pbox(-hw + 0.08, hw - 0.08, h - 0.072, h - 0.056, hd - 0.075, hd - 0.05, club ? '#ff2a4a' : '#ffd9a0', club ? 1.8 : 1.5);
    if (club) for (let i = 0; i < 5; i++) { const x = -hw + 0.2 + r() * (p.w - 0.4); pbox(x - 0.06, x + 0.06, h - 0.04, h + 0.001, hd - 0.01, hd + 0.001, '#5a5660', 0.9, null, MATTE); }
    c.rod(P(-hw + 0.1, 0.2, hd - 0.03), P(hw - 0.1, 0.2, hd - 0.03), 0.015, brass, 1.05);
    for (const x of [-hw + 0.3, 0, hw - 0.3]) c.rod(P(x, 0.2, hd - 0.03), P(x, 0.2, hd - 0.09), 0.01, brass, 1.05);
    // a decanter of something amber and two tumblers
    const dx = -hw * 0.35;
    c.lat(dx, 0.02, [[0, h], [0.075, h], [0.085, h + 0.06], [0.07, h + 0.15], [0.026, h + 0.19], [0.024, h + 0.25], [0.032, h + 0.26], [0, h + 0.27]], '#a8641a', 1, 12, GLOSS);
    c.lat(dx, 0.02, [[0, h + 0.27], [0.024, h + 0.27], [0.024, h + 0.3], [0, h + 0.31]], '#dfe6e8', 1, 8, GLOSS);
    for (const [x, z] of [[dx + 0.26, 0.1], [dx + 0.44, -0.04]]) c.lat(x, z, [[0, h], [0.04, h], [0.044, h + 0.09], [0.04, h + 0.09], [0.036, h + 0.016], [0, h + 0.016]], '#dfe6e8', 1, 12, GLOSS);
  },
  // ── a club ─────────────────────────────────────────────────────────────────────────────────────
  stage(c) {
    // a dancer's stage: a block of scuffed acrylic lit red from inside, a black lip round its top, a
    // line of light along its front foot and one chrome pole at the middle of its front half
    const { F, p } = c, { pbox, P } = F, hw = p.w / 2, hd = p.d / 2, h = p.h;
    pbox(-hw, hw, 0, h - 0.05, -hd, hd, '#7a1022', 1.25, null, GLOSS);
    pbox(-hw, hw, h - 0.05, h, -hd, hd, '#c02038', 1.35, null, GLOSS);
    pbox(-hw, hw, h - 0.02, h + 0.01, hd - 0.05, hd, '#101012', 0.9, null, GLOSS);
    pbox(-hw, hw, 0, 0.03, hd, hd + 0.01, '#ff3a5a', 1.6);
    for (let i = 0; i < 9; i++) { const x = -hw + 0.3 + c.r() * (p.w - 0.6), z = -hd + 0.2 + c.r() * (p.d - 0.4); pbox(x - 0.25, x + 0.25, h + 0.001, h + 0.003, z - 0.004, z + 0.004, '#e8c8d0', 0.8, null, MATTE); }
    c.rod(P(0, h, hd * 0.2), P(0, h + 3.1, hd * 0.2), 0.024, '#dfe2e6', 1.2, METAL, 10);
  },
  runway(c) {
    // the stage carried on out into the room: where the floor's under it, a block like the stage;
    // where a pit's under it, a slab on chrome legs, so whoever's down there sits under the dancer.
    // A pole at its tip
    const { F, p } = c, { pbox, P } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, S = c.L?.spec, t = 0.14;
    const below = (z) => { const [u, v] = P(0, 0, z), q = S?.pit; if (!q?.round) return 0; const d = Math.hypot(u - q.cu, v - q.cv); return d >= q.r ? 0 : d < q.r - q.step ? -q.depth : -q.depth / 2; };
    const n = Math.max(2, Math.round(p.d / 0.25));
    for (let i = 0; i < n; i++) {
      const z0 = -hd + i * p.d / n, z1 = z0 + p.d / n, y = below((z0 + z1) / 2);
      if (y === 0) pbox(-hw, hw, 0, h - t, z0, z1, '#7a1022', 1.25, null, GLOSS);
      else if (i % 3 === 0) for (const x of [-hw + 0.1, hw - 0.1]) c.rod(P(x, y, (z0 + z1) / 2), P(x, h - t, (z0 + z1) / 2), 0.035, '#dfe2e6', 1.15, METAL, 8);
    }
    pbox(-hw, hw, h - t, h, -hd, hd, '#c02038', 1.35, null, GLOSS);
    pbox(-hw - 0.01, hw + 0.01, h - t - 0.02, h - t, -hd, hd, '#ff3a5a', 1.6);
    c.rod(P(0, h, hd - 0.35), P(0, h + 3.1, hd - 0.35), 0.024, '#dfe2e6', 1.2, METAL, 10);
  },
  banquette(c) {
    // a ring of red vinyl round the wall of a round pit, its back against the riser, open at the
    // front for the way in. Drawn round the piece's middle in short straight runs
    const { F, p, r } = c, { P, N } = F, R = p.w / 2, gap = 50 * Math.PI / 180, n = 48, seatD = 0.6, sy = 0.44, back = 0.95;
    const vinyl = pick(r, ['#8a1424', '#7a1a2a']);
    for (let i = 0; i < n; i++) {
      const a0 = gap / 2 + i * (2 * Math.PI - gap) / n, a1 = gap / 2 + (i + 1) * (2 * Math.PI - gap) / n;
      const ring = (rad, y, a) => P(Math.sin(a) * rad, y, Math.cos(a) * rad);
      const am = (a0 + a1) / 2, inward = N(-Math.sin(am), 0, -Math.cos(am)), lean = N(-Math.sin(am) * 0.95, 0.3, -Math.cos(am) * 0.95);
      const ps = (r0, r1, y) => [ring(r0, y, a0), ring(r0, y, a1), ring(r1, y, a1), ring(r1, y, a0)];
      // the seat's top, its front, and the back's face toward the pit
      c.K.quad(c.K.solid, ps(R - seatD, R, sy), N(0, 1, 0), c.K.C(vinyl, c.tired(1)), LEATHER);
      c.K.quad(c.K.solid, [ring(R - seatD, 0, a0), ring(R - seatD, 0, a1), ring(R - seatD, sy, a1), ring(R - seatD, sy, a0)], inward, c.K.C('#3a0a12', 0.9), LEATHER);
      c.K.quad(c.K.solid, [ring(R - 0.18, sy, a0), ring(R - 0.18, sy, a1), ring(R - 0.18, back, a1), ring(R - 0.18, back, a0)], lean, c.K.C(vinyl, c.tired(0.92)), LEATHER);
      if (i % 6 === 3 && c.wear > 0.3) c.K.quad(c.K.solid, ps(R - 0.42, R - 0.3, sy + 0.003), N(0, 1, 0), c.K.C('#c8b890', 0.9), CLOTH);
    }
  },
  hearth(c) {
    // a fireplace: a chimney breast of honed black stone up to the height of the piece, standing on its
    // own kerb, with a firebox let into it. The flames are two sheets (FIRE) that gl/room-sky.js burns
    const { F, p, r } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, kerb = 0.1, zf = hd - 0.2, ox = hw - 0.5, y0 = 0.42, y1 = Math.min(1.16, h - 0.3);
    const rock = { t: 'roomStone', c: c.fine ? '#62646a' : '#6a6864' }, back = -hd + 0.1;
    pbox(-hw, hw, 0, kerb, -hd, hd, '#ffffff', 1, rock, SATIN);
    pbox(-hw, -ox, kerb, y1, -hd, zf, '#ffffff', 1, rock, SATIN);
    pbox(ox, hw, kerb, y1, -hd, zf, '#ffffff', 1, rock, SATIN);
    pbox(-ox, ox, kerb, y0, -hd, zf, '#ffffff', 1, rock, SATIN);
    pbox(-hw, hw, y1, h, -hd, zf, '#ffffff', 1, rock, SATIN);
    // a gas firebox: black ribbed liner, a steel burner trough, a bed of coals with three logs on it
    pbox(-ox, ox, y0, y1, -hd, back, '#0c0c0e', 0.9, null, MATTE);
    pbox(-ox, ox, y1 - 0.02, y1, back, zf - 0.02, '#141416', 0.9, null, MATTE);
    for (let i = 1; i < 6; i++) { const y = y0 + (y1 - y0) * i / 6; pbox(-ox + 0.01, ox - 0.01, y - 0.006, y + 0.006, back, back + 0.008, '#1a1a1d', 0.9, null, SATIN); }
    pbox(-ox + 0.01, ox - 0.01, y0, y0 + 0.05, back, zf - 0.02, '#16161a', 0.9, null, METAL);
    const mid = (back + zf) / 2;
    pbox(-ox + 0.06, ox - 0.06, y0 + 0.05, y0 + 0.062, mid - 0.025, mid + 0.025, '#5a5c60', 1, null, METAL);
    // the coals: one flat sheet the renderer heats with the dial (FIRE, sheet 8), and no stones
    const { P, N } = F, bed = y0 + 0.05;
    c.K.quad(c.K.glass, [P(-ox + 0.05, bed + 0.014, mid + 0.13), P(ox - 0.05, bed + 0.014, mid + 0.13), P(ox - 0.05, bed + 0.014, mid - 0.13), P(-ox + 0.05, bed + 0.014, mid - 0.13)], N(0, 1, 0), [1, 1, 1], FIRE, [[8, 0], [9, 0], [9, 1], [8, 1]], true);
    // three charred logs, two along the burner and a shorter one across the top of them, each with
    // paler sawn ends and a split or two burnt red
    const CHAR = '#1c1410', END = '#4a3222', SPLIT = '#8a200a';
    for (const [x0, x1, ya, yb, z0, z1] of [[-ox + 0.08, ox - 0.12, bed + 0.014, bed + 0.1, mid - 0.115, mid - 0.03], [-ox + 0.13, ox - 0.07, bed + 0.014, bed + 0.09, mid + 0.04, mid + 0.115], [-ox + 0.2, ox - 0.24, bed + 0.092, bed + 0.165, mid - 0.05, mid + 0.03]]) {
      pbox(x0, x1, ya, yb, z0, z1, CHAR, 1, null, MATTE);
      pbox(x0 - 0.004, x0, ya + 0.008, yb - 0.008, z0 + 0.008, z1 - 0.008, END, 1, null, MATTE);
      pbox(x1, x1 + 0.004, ya + 0.008, yb - 0.008, z0 + 0.008, z1 - 0.008, END, 1, null, MATTE);
      for (let i = 0; i < 3; i++) { const x = x0 + (x1 - x0) * (0.15 + 0.3 * i + r() * 0.1), y = ya + (yb - ya) * (0.3 + r() * 0.4); pbox(x, x + 0.05 + r() * 0.06, y, y + 0.008, z1, z1 + 0.002, SPLIT, 1, null, MATTE); }
    }
    // a pilot hood at the left of the burner
    pbox(-ox + 0.04, -ox + 0.1, bed, bed + 0.035, mid - 0.02, mid + 0.02, '#8a8c90', 1, null, METAL);
    // the sheets of flame (FIRE), and a glow sheet on the liner behind them. Their uv is 0..1 up and
    // across plus twice the sheet: 4 is the glow; 0, 2 and 10 to 16 are flames (gl/room-sky.js). Six
    // flames at different depths, two of them crossed on the slant, so the fire has a body you can walk
    // round and the cels slide past each other as your head moves. Drawn back to front, since glass
    // writes no depth
    const base = bed + 0.01, top = y1 - 0.03, sheet = (pts, i) => c.K.quad(c.K.glass, pts, N(0, 0, 1), [1, 1, 1], FIRE, [[i, 0], [i + 1, 0], [i + 1, 1], [i, 1]], true);
    const flat = (z, i, b, xa = -ox + 0.04, xb = ox - 0.04) => sheet([P(xa, b, z), P(xb, b, z), P(xb, top, z), P(xa, top, z)], i);
    flat(back + 0.012, 4, base - 0.05);
    flat(mid - 0.1, 10, base, -ox + 0.06, ox - 0.06);
    sheet([P(-ox + 0.06, base, mid + 0.07), P(0.04, base, mid - 0.08), P(0.04, top, mid - 0.08), P(-ox + 0.06, top, mid + 0.07)], 12);
    sheet([P(-0.04, base, mid - 0.08), P(ox - 0.06, base, mid + 0.07), P(ox - 0.06, top, mid + 0.07), P(-0.04, top, mid - 0.08)], 14);
    flat(mid - 0.03, 0, base);
    flat(mid + 0.035, 2, base);
    flat(mid + 0.1, 16, base, -ox + 0.1, ox - 0.1);
    // the glass front, a faint pane in the reveal
    c.K.quad(c.K.glass, [P(-ox, y0, zf - 0.004), P(ox, y0, zf - 0.004), P(ox, y1, zf - 0.004), P(-ox, y1, zf - 0.004)], N(0, 0, 1), [0.06, 0.06, 0.07], FIRE, [[6, 0], [7, 0], [7, 1], [6, 1]], true);
    // a thin bronze reveal round the opening
    for (const q of [[-ox - 0.012, -ox, y0, y1], [ox, ox + 0.012, y0, y1], [-ox, ox, y1 - 0.012, y1], [-ox, ox, y0, y0 + 0.012]]) pbox(q[0], q[1], q[2], q[3], zf, zf + 0.006, '#8a6a3e', 1, null, METAL);
    // its dial, on the stone to the right of the opening
    fireDial(c.K, F, p.id, (ox + hw) / 2, Math.min(y1 - 0.14, 0.95), zf, Math.min(1.25, (hw - ox) / 0.24));
  },
  barwall(c) {
    // a bar wall: a walnut cabinet to the worktop, then glass shelves of bottles lit from behind.
    // What it hides is nobody's business here: a concealed piece isn't in the payload until it's found
    // In a club (spec.club) the cabinet's black, and the shelves are lit red from behind
    const { F, p, r } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, club = !!c.L?.spec?.club, wal = club ? null : { t: 'roomOak', c: '#6a4a30' }, cab = club ? '#16141a' : '#4a3020';
    pbox(-hw, hw, 0, 0.08, -hd, hd - 0.06, '#101012', 0.9);
    pbox(-hw, hw, 0.08, 0.92, -hd, hd - 0.02, cab, 0.9, wal, SATIN);
    const n = Math.max(2, Math.round(p.w / 0.55));
    for (let i = 0; i < n; i++) { const x0 = -hw + 0.006 + i * p.w / n, x1 = x0 + p.w / n - 0.012; pbox(x0, x1, 0.09, 0.91, hd - 0.02, hd - 0.004, cab, 1, wal, SATIN); }
    pbox(-hw - 0.01, hw + 0.01, 0.92, 0.96, -hd, hd + 0.01, club ? '#2a282c' : '#8a8c8e', 1, club ? null : STONE, GLOSS);
    pbox(-hw, hw, 0.96, h, -hd, -hd + 0.03, club ? '#1a0a10' : '#2a2018', 0.9, null, SATIN);
    pbox(-hw + 0.05, hw - 0.05, 1.0, h - 0.1, -hd + 0.03, -hd + 0.034, club ? '#ff3050' : '#e8b070', 1.5);
    pbox(-hw, -hw + 0.04, 0.96, h, -hd, hd - 0.1, cab, 1, wal, SATIN);
    pbox(hw - 0.04, hw, 0.96, h, -hd, hd - 0.1, cab, 1, wal, SATIN);
    pbox(-hw, hw, h - 0.06, h, -hd, hd - 0.1, cab, 1, wal, SATIN);
    for (const y of [1.22, 1.56, 1.9]) {
      pbox(-hw + 0.04, hw - 0.04, y - 0.01, y, -hd + 0.03, hd - 0.12, '#dfe6e8', 0.85, null, GLOSS);
      bottles(c, -hw + 0.1, hw - 0.1, y, -0.02, Math.round(p.w / 0.16 + r() * 3));
    }
    // a pair of glasses and a mixing tin on the top
    for (const x of [-0.3, -0.18]) c.lat(x, 0.05, [[0, 0.96], [0.03, 0.96], [0.012, 0.975], [0.012, 1.04], [0.042, 1.09], [0.042, 1.1], [0, 1.1]], '#dfe6e8', 1, 12, GLOSS);
    c.lat(0.25, 0.04, [[0, 0.96], [0.045, 0.96], [0.055, 1.14], [0, 1.14]], '#c8ccd0', 1.05, 14, METAL);
  },

  chemwall(c) {
    // a chem lab: the back of a Cachet's turntable, or a lab standing on its own. Its grade is the
    // station's (`p.lab`); the bench, the hood and the glassware are gl/lab-mesh.js's
    drawLab(c, c.p.lab || 'standard');
  },

  // ── bathroom ──────────────────────────────────────────────────────────────────────────────────
  pan(c) {
    // a toilet: a cistern against the wall, a bowl, a seat and lid, a chrome flush lever
    const { F, p } = c, { alongZ, alongX, pbox } = F, hd = p.d / 2, hw = p.w / 2, china = c.wear > 0.6 ? '#c8c4b4' : '#e8e4da';
    const steel = p.wear > 0.85;
    const col = steel ? '#9aa0a8' : china, surf = steel ? METAL : GLOSS;
    c.R(...alongX(), -hw + 0.01, hw - 0.01, -hd, -hd + 0.18, 0.42, 0.78, 0.03, col, 0.96, surf);
    pbox(-hw + 0.005, hw - 0.005, 0.78, 0.8, -hd - 0.005, -hd + 0.185, col, 1, null, surf);
    c.lat(0, -hd + 0.42, [[0.1, 0], [0.09, 0.03], [0.11, 0.2], [0.17, 0.38], [0.18, 0.4], [0, 0.4]], col, 0.96, 18, surf);
    c.R(...alongZ(), -hd + 0.15, -hd + 0.26, -0.09, 0.09, 0.1, 0.4, 0.04, col, 0.94, surf);
    c.lat(0, -hd + 0.42, [[0.165, 0.4], [0.185, 0.405], [0.185, 0.425], [0.12, 0.425], [0.12, 0.41]], '#f2efe8', 1, 18, GLOSS);
    c.lat(0, -hd + 0.42, [[0, 0.401], [0.12, 0.401]], '#9aa8b0', 0.55, 16, GLOSS);
    c.rod(F.P(hw - 0.08, 0.7, -hd + 0.19), F.P(hw - 0.18, 0.72, -hd + 0.2), 0.008, '#c8ccd0', 1.05);
  },
  hung(c) {
    // a wall-hung pan with its cistern in the wall: a boxed panel, a flush plate, a low egg of a bowl
    const { F, p } = c, { pbox, alongZ } = F, hd = p.d / 2, hw = p.w / 2, panel = c.fine ? STONE : '#d8d4cc';
    pbox(-hw - 0.08, hw + 0.08, 0, 1.08, -hd, -hd + 0.12, '#9a9c9e', 1, typeof panel === 'object' ? panel : null, SATIN);
    pbox(-0.1, 0.1, 0.84, 0.98, -hd + 0.12, -hd + 0.126, '#2a2c30', 1, null, METAL);
    pbox(-0.085, -0.005, 0.855, 0.965, -hd + 0.126, -hd + 0.13, '#c8ccd0', 1.05, null, METAL);
    pbox(0.005, 0.085, 0.855, 0.965, -hd + 0.126, -hd + 0.13, '#c8ccd0', 1.05, null, METAL);
    c.lat(0, -hd + 0.36, [[0.03, 0.16], [0.13, 0.2], [0.17, 0.3], [0.18, 0.38], [0, 0.38]], '#e8e4da', 0.97, 20, GLOSS);
    c.R(...alongZ(), -hd + 0.12, -hd + 0.26, -0.13, 0.13, 0.2, 0.38, 0.05, '#e8e4da', 0.95, GLOSS);
    c.lat(0, -hd + 0.36, [[0.16, 0.38], [0.185, 0.385], [0.185, 0.4], [0, 0.402]], '#f2efe8', 1, 20, GLOSS);
  },
  stall(c) {
    // a shower: a tray, a tiled back, a glass door and screen, a riser and a head
    const { F, p } = c, { pbox, P, N } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, tile = { t: 'roomTile', c: '#d8dcd8' };
    pbox(-hw, hw, 0, 0.06, -hd, hd, '#e4e0d6', 0.96, null, GLOSS);
    pbox(-hw + 0.05, hw - 0.05, 0.06, 0.062, -hd + 0.05, hd - 0.05, '#c8ccc8', 0.85, null, GLOSS);
    c.lat(0, 0, [[0, 0.0625], [0.04, 0.0625], [0.04, 0.064], [0, 0.064]], '#8a9098', 1, 12, METAL);
    pbox(-hw, hw, 0.06, h, -hd, -hd + 0.02, '#ffffff', 0.95, tile, GLOSS);
    pbox(-hw, -hw + 0.02, 0.06, h, -hd, hd, '#ffffff', 0.93, tile, GLOSS);
    const glass = (a, b) => c.K.quad(c.K.glass, [P(a[0], 0.06, a[1]), P(b[0], 0.06, b[1]), P(b[0], h - 0.1, b[1]), P(a[0], h - 0.1, a[1])], N(b[1] - a[1], 0, a[0] - b[0]), [0.8, 0.86, 0.9], GLOSS, null, true);
    glass([-hw, hd], [hw, hd]); glass([hw, hd], [hw, -hd]);
    for (const [a, b] of [[[-hw, hd], [hw, hd]], [[hw, hd], [hw, -hd]]]) c.rod(P(a[0], h - 0.1, a[1]), P(b[0], h - 0.1, b[1]), 0.012, '#c8ccd0', 1.05);
    c.rod(P(hw, 0.06, hd), P(hw, h - 0.1, hd), 0.012, '#c8ccd0', 1.05);
    c.rod(P(0, 1.1, -hd + 0.04), P(0, 2.0, -hd + 0.04), 0.012, '#c8ccd0', 1.05);
    c.rod(P(0, 2.0, -hd + 0.04), P(0, 2.05, -hd + 0.2), 0.01, '#c8ccd0', 1.05);
    c.lat(0, -hd + 0.22, [[0.02, 2.06], [0.09, 2.03], [0.09, 2.02], [0, 2.02]], '#c8ccd0', 1.05, 16, METAL);
    pbox(-0.1, 0.1, 1.0, 1.08, -hd + 0.02, -hd + 0.07, '#c8ccd0', 1.05, null, METAL);
  },
  wetroom(c) {
    // a shower with no tray: a fall to a slot drain, one frameless pane, a head let into the ceiling
    // and a niche in the stone with a few bottles
    const { F, p } = c, { pbox, P, N } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, H = c.L.h;
    pbox(-hw + 0.1, hw - 0.1, 0.002, 0.006, -hd + 0.08, -hd + 0.13, '#1a1b1e', 1, null, METAL);
    c.K.quad(c.K.glass, [P(hw, 0, -hd), P(hw, 0, hd), P(hw, h, hd), P(hw, h, -hd)], N(1, 0, 0), [0.8, 0.86, 0.9], GLOSS, null, true);
    pbox(hw - 0.004, hw + 0.004, 0, 0.02, -hd, hd, BLACK, 1, null, METAL);
    pbox(hw - 0.004, hw + 0.004, h - 0.02, h, -hd, hd, BLACK, 1, null, METAL);
    pbox(-0.2, 0.2, H - 0.012, H - 0.002, -0.2, 0.2, '#2a2c30', 1, null, METAL);
    for (let i = 0; i < 25; i++) pbox(-0.16 + (i % 5) * 0.08 - 0.008, -0.16 + (i % 5) * 0.08 + 0.008, H - 0.014, H - 0.012, -0.16 + Math.floor(i / 5) * 0.08 - 0.008, -0.16 + Math.floor(i / 5) * 0.08 + 0.008, '#c8ccd0', 1.05, null, METAL);
    pbox(-hw + 0.12, -hw + 0.62, 1.1, 1.12, -hd, -hd + 0.11, '#6a6c70', 0.95, null, SATIN);
    pbox(-hw + 0.12, -hw + 0.62, 1.42, 1.44, -hd, -hd + 0.11, '#6a6c70', 0.95, null, SATIN);
    pbox(-hw + 0.14, -hw + 0.6, 1.438, 1.44, -hd + 0.03, -hd + 0.09, '#ffe9c4', 1.6);
    for (const [x, t] of [[-hw + 0.22, 0.2], [-hw + 0.33, 0.17], [-hw + 0.46, 0.15]]) c.lat(x, -hd + 0.06, [[0, 1.12], [0.03, 1.12], [0.03, 1.12 + t * 0.8], [0.012, 1.12 + t], [0, 1.12 + t]], c.pick(['#d8d4c8', '#2a2c30', '#8a7a64']), 0.97, 10, GLOSS);
    pbox(-0.1, 0.1, 1.05, 1.1, -hd, -hd + 0.03, '#c8ccd0', 1.05, null, METAL);
  },
  bath(c) {
    // a roll-top bath on claw feet: enamel inside, a rolled rim, taps at the wall end, a rail and curtain
    const { F, p, r } = c, { alongZ, P } = F, hw = p.w / 2, hd = p.d / 2, y = p.h;
    for (const [x, z] of [[-hw + 0.1, -hd + 0.18], [hw - 0.1, -hd + 0.18], [-hw + 0.1, hd - 0.18], [hw - 0.1, hd - 0.18]]) c.lat(x, z, [[0.05, 0], [0.03, 0.04], [0.035, 0.12], [0, 0.13]], '#3a3a3a', 0.95, 8, METAL);
    hollow(c, -hw, hw, -hd, hd, y, 0.13, 0.055, '#ece8de', '#c8ccc8', 0.97, GLOSS);
    for (const s of [-1, 1]) c.R(...alongZ(), -hd, hd, s < 0 ? -hw - 0.012 : hw - 0.05, s < 0 ? -hw + 0.05 : hw + 0.012, y - 0.02, y + 0.022, 0.018, '#f2efe8', 1, GLOSS);
    for (const x of [-0.09, 0.09]) c.lat(x, -hd - 0.0, [[0.018, y], [0.014, y + 0.1], [0.03, y + 0.11], [0, y + 0.13]], '#c8ccd0', 1.05, 10, METAL);
    if (r() < 0.8) {
      const top = 2.0;
      for (const [a, b] of [[[hw + 0.02, -hd], [hw + 0.02, hd]], [[hw + 0.02, hd], [-hw - 0.02, hd]]]) c.rod(P(a[0], top, a[1]), P(b[0], top, b[1]), 0.012, '#c8ccd0', 1.05);
      c.rod(P(-hw - 0.02, top, hd), P(-hw - 0.02, top, -hd), 0.012, '#c8ccd0', 1.05);
      c.R(...alongZ(), -hd + 0.02, hd - 0.04, hw + 0.01, hw + 0.05, 0.3, top, 0.015, { t: 'roomCanvas', c: '#d8d0bc' }, 0.95, CLOTH);
    }
  },
  soak(c) {
    // a soaking tub cut from one block of stone: a sharp outside, a deep inside, a spout out of the
    // floor, and water standing in it
    const { F, p } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, y = p.h, rim = 0.09;
    pbox(-hw, hw, 0, 0.14, -hd, hd, '#8a8c8e', 1, STONE, SATIN);
    hollow(c, -hw, hw, -hd, hd, y, 0.14, rim, STONE, '#5a5c60', 0.92, SATIN);
    pbox(-hw + rim, hw - rim, y - 0.13, y - 0.125, -hd + rim, hd - rim, '#6a8a94', 0.55, null, GLOSS);
    c.rod(F.P(hw + 0.12, 0, -hd + 0.5), F.P(hw + 0.12, y + 0.26, -hd + 0.5), 0.018, BLACK, 1);
    c.rod(F.P(hw + 0.12, y + 0.26, -hd + 0.5), F.P(hw - 0.12, y + 0.26, -hd + 0.5), 0.016, BLACK, 1);
  },

  // ── the set, and a table ──────────────────────────────────────────────────────────────────────
  console(c) {
    // a low cabinet under a set: sliding doors, slim legs, and the deck on top with its lit readout
    const { F, p, r } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, y = p.h - 0.09, front = c.fine ? { t: 'roomOak', c: '#7a5a3a' } : c.wood;
    for (const [x, z] of [[-hw + 0.08, -hd + 0.06], [hw - 0.08, -hd + 0.06], [-hw + 0.08, hd - 0.06], [hw - 0.08, hd - 0.06]]) c.lat(x, z, [[0.012, 0], [0.018, 0.14]], '#2a2c30', 0.95, 8, METAL);
    pbox(-hw, hw, 0.14, y, -hd, hd - 0.012, '#3a2a1e', 0.9, front, SATIN);
    pbox(-hw + 0.01, 0, 0.15, y - 0.01, hd - 0.012, hd - 0.004, '#3a2a1e', 0.98, front, SATIN);
    pbox(0, hw - 0.01, 0.15, y - 0.01, hd - 0.02, hd - 0.012, '#3a2a1e', 0.95, front, SATIN);
    // the deck: a slab with a tape slot, a readout and a row of keys
    const dx = 0.3;
    pbox(-dx, dx, y, y + 0.09, -hd + 0.06, hd - 0.05, '#1a1b1e', 0.95, null, SATIN);
    pbox(-dx + 0.02, dx - 0.26, y + 0.03, y + 0.05, hd - 0.05, hd - 0.046, '#0a0a0c', 1, null, GLOSS);
    pbox(dx - 0.22, dx - 0.04, y + 0.045, y + 0.075, hd - 0.05, hd - 0.047, '#0a1a14', 1, null, GLOSS);
    pbox(dx - 0.2, dx - 0.09, y + 0.054, y + 0.066, hd - 0.047, hd - 0.046, '#48ff8a', 1.6);
    for (let i = 0; i < 5; i++) pbox(dx - 0.22 + i * 0.038, dx - 0.195 + i * 0.038, y + 0.016, y + 0.03, hd - 0.05, hd - 0.04, '#6a6e74', 1, null, METAL);
    // a few tapes in a stack
    for (let i = 0; i < 3; i++) pbox(hw - 0.3, hw - 0.1, y + i * 0.028, y + (i + 1) * 0.028 - 0.002, -0.08, 0.04, c.pick(['#2a2c30', '#3a3e46', '#7a2a24']), 0.95, null, SATIN);
    void r;
  },
  portable(c) {
    // a portable deck: a small case with a handle, a slot and a speaker grille
    const { F, p } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, h = p.h;
    c.R(...F.alongX(), -hw, hw, -hd, hd, 0.01, h, 0.02, '#2a2c30', 0.92, SATIN);
    pbox(-hw + 0.04, -0.02, 0.05, h - 0.05, hd, hd + 0.003, '#0a0a0c', 1, null, GLOSS);
    for (let i = 0; i < 6; i++) pbox(0.04, hw - 0.04, 0.04 + i * 0.022, 0.05 + i * 0.022, hd, hd + 0.003, '#6a6e74', 0.9, null, METAL);
    c.rod(F.P(-hw + 0.06, h, 0), F.P(hw - 0.06, h + 0.05, 0), 0.008, '#c8ccd0', 1.05);
  },
  coffee(c) {
    // a low table: a top on four legs and a shelf under it; a worn one has rings on it
    const { F, p, r } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, top = c.fine ? { t: 'roomOak', c: '#8a6a4a' } : c.wood;
    pbox(-hw, hw, h - 0.03, h, -hd, hd, '#7a5a3a', 1, top, SATIN);
    for (const [x, z] of [[-hw + 0.05, -hd + 0.05], [hw - 0.05, -hd + 0.05], [-hw + 0.05, hd - 0.05], [hw - 0.05, hd - 0.05]]) pbox(x - 0.02, x + 0.02, 0, h - 0.03, z - 0.02, z + 0.02, '#7a5a3a', 0.9, top, SATIN);
    pbox(-hw + 0.06, hw - 0.06, 0.12, 0.14, -hd + 0.06, hd - 0.06, '#7a5a3a', 0.9, top, SATIN);
    if (c.wear > 0.3) for (let i = 0; i < 3; i++) { const x = (r() - 0.5) * p.w * 0.7, z = (r() - 0.5) * p.d * 0.6; c.lat(x, z, [[0.035, h + 0.0006], [0.042, h + 0.0006]], '#2a2018', 0.7, 16, MATTE); }
    // a couple of books
    pbox(-hw * 0.5, -hw * 0.5 + 0.22, h, h + 0.03, -0.06, 0.1, c.pick(['#7a2a24', '#2a3a4a', '#c8b48a']), 0.95, null, MATTE);
  },
  lacquer(c) {
    // a lacquered stash box: a black gloss body with a brass line round its waist, grey foam inside cut
    // to four slots, and what's in them. The lid is gl/room-stash.js's, hinged at the back, so it can open.
    const y = c.p.rise || 0, { F, p } = c, { pbox, P } = F, hw = p.w / 2, hd = p.d / 2, h = p.h * LACQUER_BODY;
    const black = '#0c0b0d', wall = 0.012;
    pbox(-hw, hw, y, y + 0.006, -hd, hd, black, 1, null, GLOSS);
    pbox(-hw, hw, y + 0.006, y + h, -hd, -hd + wall, black, 1, null, GLOSS);
    pbox(-hw, hw, y + 0.006, y + h, hd - wall, hd, black, 1, null, GLOSS);
    pbox(-hw, -hw + wall, y + 0.006, y + h, -hd + wall, hd - wall, black, 1, null, GLOSS);
    pbox(hw - wall, hw, y + 0.006, y + h, -hd + wall, hd - wall, black, 1, null, GLOSS);
    pbox(-hw - 0.0008, hw + 0.0008, y + h * 0.5, y + h * 0.5 + 0.003, -hd - 0.0008, hd + 0.0008, '#b8924a', 1.05, null, METAL);
    // the foam, a little below the rim, and its four slots each with its own thing in
    const fy = y + h - 0.016;
    pbox(-hw + wall, hw - wall, y + 0.006, fy, -hd + wall, hd - wall, '#2e2f33', 0.9, null, MATTE);
    const slots = [['#e8e4f0', '#5a2a8a'], ['#d82a2a', '#2a2a2e'], ['#c8d8e0', '#2a8a9a'], ['#3a6ad8', '#e8e8f0']];
    slots.forEach(([glass, cap], i) => {
      const x = -hw + wall + (i + 0.5) * (p.w - 2 * wall) / 4;
      pbox(x - 0.03, x + 0.03, fy - 0.012, fy - 0.011, -hd + 0.03, hd - 0.03, '#141416', 1, null, MATTE);
      if (i === 3) { for (let k = 0; k < 5; k++) c.lat(x - 0.012 + (k % 2) * 0.024, -0.06 + k * 0.03, [[0, fy - 0.011], [0.008, fy - 0.011], [0.008, fy - 0.006], [0, fy - 0.005]], glass, 1.1, 10, GLOSS); return; }
      c.rod(P(x, fy - 0.004, -hd + 0.045), P(x, fy - 0.004, hd - 0.075), 0.011, glass, 1.15, GLOSS, 10);
      c.rod(P(x, fy - 0.004, hd - 0.075), P(x, fy - 0.004, hd - 0.045), 0.012, cap, 1, METAL, 10);
    });
  },
  dining(c) {
    // a table to eat at: a heavy top on two trestle ends
    const { F, p } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, top = c.fine ? { t: 'roomOak', c: '#8a6a4a' } : c.wood;
    pbox(-hw, hw, h - 0.04, h, -hd, hd, '#7a5a3a', 1, top, SATIN);
    for (const x of [-hw + 0.16, hw - 0.16]) {
      pbox(x - 0.03, x + 0.03, 0, h - 0.04, -0.05, 0.05, '#5a3a22', 0.92, top, SATIN);
      pbox(x - 0.03, x + 0.03, 0, 0.05, -hd + 0.08, hd - 0.08, '#5a3a22', 0.92, top, SATIN);
    }
    pbox(-hw + 0.16, hw - 0.16, h * 0.5, h * 0.5 + 0.06, -0.025, 0.025, '#5a3a22', 0.9, top, SATIN);
  },
};

// Draws a form this file owns, or returns false.
export function drawFitting(c) {
  const f = FORMS[c.p.form];
  if (!f) return false;
  f(c);
  return true;
}
export const FITTED_FORMS = Object.freeze(Object.keys(FORMS));
