// GLASS 2 · A CHEM LAB, AS ROOM DRAWS IT. The bench, the hood and the glassware on them, by the lab's
// grade, drawn in a piece's own frame for the Room Stage (docs/proposals/chem-stage.md, phase 1).
//
// room-fittings.js `chemwall` calls drawLab with its context `c`: the frame `F` (x across the piece,
// y up off the floor, z out of its front, metres), the piece `p`, a seeded `r` and the helpers
// (`lat`, `rod`, `R`, `stain`). Everything here fits inside p.w × p.d × p.h, because that's what
// the walker collides with. The same pieces are what the Chem Stage's bench will be made of, so a
// vessel is a function of its own, not a line inside the bench.
//
// ⚠ THE LOOK COMES FROM DATA, NEVER FROM A NAME. `p.lab` is the station's grade (`flags
// .station_quality`: standard, refined or pristine) and the seed picks the reagents' colours. No
// drug, place or brand is named here.
//
// ⚠ GLASS IS ITS OUTLINE. gl/room.js draws the glass batch last, blended, from its highlights and
// Fresnel alone; the colour handed to it is ignored. So a vessel is clear glass, a solid liquid
// inside it and a solid lip on top, which is what the ink pass and the eye both catch.
//
// Pure: batches, no GL, no wall clock, no Math.random.

import { MAT } from './ballpark-mesh.js';
import { LAB_GRADES } from '../../../../shared/room-layout.js';

const { GLOSS, METAL, SATIN, MATTE } = MAT;
export const gradeOf = (q) => Math.max(0, LAB_GRADES.indexOf(q));
// the worktop's height, and what each grade's bench is made of
export const WORKTOP = 0.9;
const LOOK = [
  // standard: a scavenged bench, plywood doors gone grey, a steel sheet screwed over the top
  { carcass: '#4a4c48', door: '#5a5a52', top: '#8a8e90', topSurf: METAL, edge: '#6a6e70', hood: '#3a3e40', handle: '#8a8e92' },
  // refined: grey lab casework and a black epoxy top
  { carcass: '#5a6066', door: '#6e757c', top: '#1c1e20', topSurf: GLOSS, edge: '#2a2c2e', hood: '#4a5056', handle: '#b8bcc0' },
  // pristine: white casework, a black epoxy top, a stainless hood
  { carcass: '#d8dcdc', door: '#e8ecec', top: '#141618', topSurf: GLOSS, edge: '#202224', hood: '#b8bec2', handle: '#9aa0a6' },
];
// what a reagent can look like in the glass; the seed picks
const REAGENTS = ['#3a8a5a', '#c8a050', '#7a3a8a', '#c83a3a', '#5fb8e8', '#e8e0a0', '#e88a3a', '#d8e4e8'];
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];

// ── glass ─────────────────────────────────────────────────────────────────────────────────────────
// A turned piece of glass round the upright at (x, z): `prof` is [radius, y] from the bottom up, as
// for `lat`. Into the glass batch, so it's drawn last and blended.
export function glassLathe(c, x, z, prof, n = 16) {
  const { P, N } = c.F, K = c.K;
  for (let i = 0; i + 1 < prof.length; i++) {
    const [r0, y0] = prof[i], [r1, y1] = prof[i + 1], dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy);
    if (l < 1e-5) continue;
    for (let j = 0; j < n; j++) {
      const a0 = (j / n) * Math.PI * 2, a1 = ((j + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
      const at = (r, a, y) => P(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
      K.quad(K.glass, [at(r0, a0, y0), at(r0, a1, y0), at(r1, a1, y1), at(r1, a0, y1)], N((Math.cos(am) * dy) / l, -dr / l, (Math.sin(am) * dy) / l), [1, 1, 1], GLOSS, null, true);
    }
  }
}

// A liquid turned round the upright at (x, z), into the glass batch as material 44 (gl/room.js): tinted,
// lit and see-through, so what's in a flask reads as liquid, not plastic. `prof` as for glassLathe.
export function liquidLathe(c, x, z, prof, hex, k = 1, n = 16) {
  const { P, N } = c.F, K = c.K, col = K.C(hex, k);
  for (let i = 0; i + 1 < prof.length; i++) {
    const [r0, y0] = prof[i], [r1, y1] = prof[i + 1], dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy);
    if (l < 1e-5) continue;
    for (let j = 0; j < n; j++) {
      const a0 = (j / n) * Math.PI * 2, a1 = ((j + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
      const at = (r, a, y) => P(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
      K.quad(K.glass, [at(r0, a0, y0), at(r0, a1, y0), at(r1, a1, y1), at(r1, a0, y1)], N((Math.cos(am) * dy) / l, -dr / l, (Math.sin(am) * dy) / l), col, LIQUID, null, true);
    }
  }
}
export const LIQUID = 44;

// The part of a profile below `top`, closed across at `top`, pulled in by `inset` so it sits inside
// the glass: the liquid a vessel holds.
export function fillOf(prof, top, inset = 0.9) {
  const out = [];
  for (let i = 0; i < prof.length; i++) {
    const [r, y] = prof[i];
    if (y <= top) { out.push([r * inset, y]); continue; }
    const [rp, yp] = prof[i - 1] || [r, y];
    if (yp < top) out.push([(rp + ((r - rp) * (top - yp)) / (y - yp)) * inset, top]);
    break;
  }
  if (out.length && out[out.length - 1][1] < top) out.push([out[out.length - 1][0], top]);
  out.push([0, top]);
  return out;
}

// A vessel: its glass, what's in it to `fill` (0..1 of its height) in `liquid`, and a solid lip.
// `y0` is what it stands on. Returns the height of its mouth.
export function vessel(c, x, z, y0, prof, fill, liquid, n = 16) {
  const p = prof.map(([r, y]) => [r, y + y0]), top = p[p.length - 1], h = top[1] - y0;
  glassLathe(c, x, z, p, n);
  if (fill > 0 && liquid) liquidLathe(c, x, z, fillOf(p, y0 + 0.003 + h * fill), liquid, 1, n);
  c.lat(x, z, [[top[0] * 0.96, top[1] - 0.003], [top[0] * 1.06, top[1] - 0.003], [top[0] * 1.06, top[1]], [top[0] * 0.96, top[1]]], '#e8f0f2', 1.05, n, GLOSS);
  return top[1];
}

// The shapes, each from its own base at y = 0.
export const SHAPES = {
  beaker: (r, h) => [[0, 0], [r * 0.96, 0], [r, 0.006], [r, h]],
  flask: (r, h) => [[0, 0], [r * 0.94, 0], [r, 0.008], [r * 0.32, h * 0.72], [r * 0.3, h * 0.78], [r * 0.3, h]],
  round: (r, neck) => [...Array.from({ length: 8 }, (_, i) => { const a = -Math.PI / 2 + (i / 8) * Math.PI * 0.86; return [Math.cos(a) * r, r + Math.sin(a) * r]; }), [r * 0.26, r * 1.9], [r * 0.26, r * 1.9 + neck]],
  cylinder: (r, h) => [[0, 0], [r, 0], [r, h]],
  bottle: (r, h) => [[0, 0], [r, 0], [r, h * 0.66], [r * 0.42, h * 0.8], [r * 0.36, h * 0.86], [r * 0.36, h]],
  dish: (r, h) => [[0, 0], [r, 0], [r, h]],
};

// ── where things stand ──────────────────────────────────────────────────────────────────────────────
// A bench's places, in piece p's own frame: the hood's reflux rig, and the spots on the open bench the
// Chem Stage works at. This file draws what stays put there and gl/lab-matter.js what moves, both from
// these numbers, so the liquid is always in the glass.
export function benchOf(p, grade = 0) {
  const hw = p.w / 2, hd = p.d / 2, h = p.h, top = WORKTOP + 0.03, split = -hw + p.w * 0.6, xo = (split + hw) / 2;
  // the reflux rig's sums are refluxRig's: the flask's seat, its mouth, the condenser's ends
  const seat = top + (grade > 0 ? 0.07 : 0.1), mouth = seat + 0.055 * 1.9 + 0.04;
  return {
    hw, hd, h, top, split, xo,
    reflux: { x: -hw + 0.28, z: -hd * 0.15, seat, mouth, r: 0.055, cy0: mouth + 0.01, cy1: Math.min(mouth + 0.42, h - 0.42), tap: { x: -hw + 0.45, y: top + 0.1, z: hd * 0.55 } },
    cyl: { x: xo + 0.05, z: 0.02, r: 0.026, h: 0.26 },
    bottle: { x: xo - 0.12, z: 0.02, r: 0.03, h: 0.17 },
    plate: { x: xo, z: 0, y: top + 0.075 },
    beaker: { r: 0.045, h: 0.11 },
    therm: { x: xo + 0.02, z: -0.01, y0: top + 0.088, y1: top + 0.42, stand: { x: xo - 0.13, z: -0.02 } },
    dish: { r: 0.065, h: 0.032 },
    scale: { x: xo, z: 0.03, pan: top + (grade === 0 ? 0.04 : 0.056) },
    jar: { x: xo + 0.2, z: -0.06 },
    mortar: { x: xo, z: 0.03 },
    press: { x: xo, z: -0.02 },
    // phase 3: the separatory funnel on its stand, the slurry's Buchner rig, the ice tray, the gas rig
    // (bottle and regulator, the line with its four joints, the trough with its jar), the drying screen,
    // the curing jar and its hygrometer, the splice's beaker and its flask
    sep: { x: xo - 0.02, z: -0.01, tap: top + 0.2 },
    filt: { x: xo + 0.04, z: 0, slurry: { x: xo - 0.1, z: 0.02 } },
    ice: { x: xo, z: 0.01 },
    gas: {
      bottle: { x: xo + 0.2, z: -0.06, h: 0.3 },
      gauge: { x: xo + 0.2, y: top + 0.36, z: -0.06 + 0.05 },
      joints: [0, 1, 2, 3].map((i) => ({ x: xo + 0.15 - i * 0.075, y: top + 0.03, z: 0.04 })),
      trough: { x: xo - 0.17, z: 0.0, w: 0.16, d: 0.12, h: 0.07 },
      jar: { x: xo - 0.17, z: 0.0, r: 0.03, h: 0.2 },
    },
    screen: { x: xo, z: 0 },
    jar: { x: xo - 0.04, z: 0, r: 0.055, h: 0.15 },
    hygro: { x: xo + 0.12, z: 0.04 },
    stir: { x: xo, z: 0.02, r: 0.05, h: 0.12 },
    flask: { x: xo, z: 0, r: 0.07 },
  };
}

// What a stage at the Chem Stage has out on the open bench and doesn't move: its glass, its hotplate,
// its scale. The bench is drawn `working` (the open bench cleared) and this is put on it.
export function workingSet(c, stage, grade = 0) {
  const B = benchOf(c.p, grade), { pbox, P } = c.F, top = B.top;
  const hotplate = (x, z) => {
    pbox(x - 0.085, x + 0.085, top, top + 0.07, z - 0.085, z + 0.095, grade === 2 ? '#e8ecec' : grade === 1 ? '#5a6066' : '#7a6a5a', 1, null, SATIN);
    pbox(x - 0.08, x + 0.08, top + 0.07, top + 0.075, z - 0.08, z + 0.075, grade === 0 ? '#4a4440' : '#f0eee8', 1, null, grade === 0 ? METAL : GLOSS);
    if (grade === 0) for (let i = 0; i < 3; i++) c.lat(x, z, [[0.025 + i * 0.02, top + 0.0752], [0.03 + i * 0.02, top + 0.0752]], '#2a2420', 1, 20, METAL);
  };
  switch (stage) {
    case 'measure': {
      const { x, z, r, h } = B.cyl;
      c.lat(x, z, [[0, top], [0.045, top], [0.045, top + 0.008], [r * 1.05, top + 0.012], [0, top + 0.012]], '#3a6a8a', 1, 6, SATIN);
      glassLathe(c, x, z, [[r, top + 0.012], [r, top + 0.012 + h]], 18);
      c.lat(x, z, [[r * 0.96, top + 0.012 + h], [r * 1.25, top + 0.016 + h], [r * 1.25, top + 0.019 + h], [r * 0.96, top + 0.019 + h]], '#e8f0f2', 1.05, 18, GLOSS);
      // the graduations: a long mark every tenth, painted on the front of the glass
      for (let i = 1; i < 10; i++) { const y = top + 0.012 + (h * i) / 10; pbox(x - (i % 5 ? 0.008 : 0.014), x + 0.002, y - 0.0007, y + 0.0007, z + r, z + r + 0.0012, '#f4f4f0', 1.2, null, MATTE); }
      return B;
    }
    case 'heat': {
      hotplate(B.plate.x, B.plate.z);
      const { x, z } = B.plate, { r, h } = B.beaker, T = B.therm;
      glassLathe(c, x, z, SHAPES.beaker(r, h).map(([rr, y]) => [rr, y + B.plate.y]), 18);
      c.lat(x, z, [[r * 0.96, B.plate.y + h - 0.003], [r * 1.06, B.plate.y + h - 0.003], [r * 1.06, B.plate.y + h], [r * 0.96, B.plate.y + h]], '#e8f0f2', 1.05, 18, GLOSS);
      // the thermometer: a glass stem in a clamp off its own stand, its bulb in the beaker
      const [ux, uz] = ringStand(c, T.stand.x, T.stand.z, top, T.y1 - top + 0.04, 0.08);
      glassLathe(c, T.x, T.z, [[0.0055, T.y0], [0.0055, T.y1], [0, T.y1 + 0.004]], 10);
      c.lat(T.x, T.z, [[0, T.y0 - 0.006], [0.006, T.y0], [0.0045, T.y0 + 0.014], [0, T.y0 + 0.016]], '#c8303a', 1.1, 10, GLOSS);
      clamp(c, ux, uz, T.x, T.z, T.y1 - 0.06, 0.007);
      for (let i = 0; i <= 10; i++) { const y = T.y0 + 0.03 + ((T.y1 - T.y0 - 0.05) * i) / 10; pbox(T.x - 0.004, T.x + 0.004, y - 0.0006, y + 0.0006, T.z + 0.0055, T.z + 0.0065, '#1c1e20', 1, null, MATTE); }
      return B;
    }
    case 'evaporate': {
      hotplate(B.plate.x, B.plate.z);
      const { x, z } = B.plate, { r, h } = B.dish, y0 = B.plate.y;
      c.lat(x, z, [[0, y0], [r * 0.55, y0], [r * 0.9, y0 + h * 0.5], [r, y0 + h], [r * 1.08, y0 + h], [r * 1.02, y0 + h * 0.96], [r * 0.92, y0 + h * 0.45], [r * 0.5, y0 + 0.004], [0, y0 + 0.004]], '#f2f0ea', 1, 22, GLOSS);
      return B;
    }
    case 'weigh': {
      scale(c, B.scale.x, B.scale.z, top, grade, false);
      // a weigh boat on the pan, and the stock jar beside it with its lid off
      const y = B.scale.pan, bx = B.scale.x, bz = B.scale.z - 0.012;
      pbox(bx - 0.035, bx + 0.035, y, y + 0.002, bz - 0.035, bz + 0.035, '#f4f4f0', 1, null, SATIN);
      for (const [x0, x1, z0, z1] of [[-0.035, 0.035, -0.035, -0.032], [-0.035, 0.035, 0.032, 0.035], [-0.035, -0.032, -0.035, 0.035], [0.032, 0.035, -0.035, 0.035]]) pbox(bx + x0, bx + x1, y, y + 0.012, bz + z0, bz + z1, '#f4f4f0', 1, null, SATIN);
      c.lat(B.jar.x, B.jar.z, [[0, top], [0.04, top], [0.042, top + 0.09], [0.034, top + 0.1], [0.034, top + 0.11], [0, top + 0.11]], '#6a3a14', 0.95, 16, GLOSS);
      c.lat(B.jar.x + 0.07, B.jar.z + 0.03, [[0, top], [0.036, top], [0.036, top + 0.018], [0, top + 0.018]], '#1c1e20', 1, 16, SATIN);
      return B;
    }
    case 'grind': {
      const { x, z } = B.mortar;
      c.lat(x, z, [[0, top], [0.05, top], [0.062, top + 0.012], [0.068, top + 0.06], [0.062, top + 0.066], [0.05, top + 0.026], [0, top + 0.022]], '#f0eee8', 1, 22, SATIN);
      return B;
    }
    case 'press': {
      pillPress(c, B.press.x, B.press.z, top, null, false);
      return B;
    }
    case 'separate': {
      const S = B.sep, prof = separatorProfile(S.tap);
      const [ux, uz] = ringStand(c, S.x - 0.1, S.z, top, 0.5);
      glassLathe(c, S.x, S.z, prof, 16);
      c.lat(S.x, S.z, [[0.011, S.tap + 0.27], [0.013, S.tap + 0.28], [0, S.tap + 0.29]], '#2a2c30', 1, 10, SATIN);
      c.rod(P(S.x, S.tap, S.z), P(S.x, S.tap - 0.05, S.z), 0.003, '#e8f0f2', 1, GLOSS);
      for (let i = 0; i < 16; i++) { const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2, rr = 0.052; c.rod(P(S.x + Math.cos(a0) * rr, S.tap + 0.13, S.z + Math.sin(a0) * rr), P(S.x + Math.cos(a1) * rr, S.tap + 0.13, S.z + Math.sin(a1) * rr), 0.003, '#3a3c40', 1, METAL, 4); }
      c.rod(P(ux, S.tap + 0.13, uz), P(S.x - 0.052, S.tap + 0.13, S.z), 0.004, '#3a3c40', 1, METAL);
      glassLathe(c, S.x, S.z, SHAPES.beaker(0.04, 0.09).map(([r, y]) => [r, y + top]), 16);
      return B;
    }
    case 'crystallise': {
      // an ice tray: a steel tray of cubes, and the crystallising dish sat in it
      const { x, z } = B.ice;
      pbox(x - 0.11, x + 0.11, top, top + 0.012, z - 0.08, z + 0.08, '#b8bcc0', 1, null, METAL);
      for (const [x0, x1, z0, z1] of [[-0.11, 0.11, -0.08, -0.074], [-0.11, 0.11, 0.074, 0.08], [-0.11, -0.104, -0.08, 0.08], [0.104, 0.11, -0.08, 0.08]]) pbox(x + x0, x + x1, top, top + 0.045, z + z0, z + z1, '#b8bcc0', 1, null, METAL);
      for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2 + c.r() * 0.2, d = 0.075 + c.r() * 0.018, cx = x + Math.cos(a) * d * 1.25, cz = z + Math.sin(a) * d * 0.85, s = 0.011 + c.r() * 0.005; if (Math.abs(cx - x) < 0.104 - s && Math.abs(cz - z) < 0.074 - s) pbox(cx - s, cx + s, top + 0.012, top + 0.012 + s * 1.6, cz - s, cz + s, '#d8eef8', 1.05, null, GLOSS); }
      glassLathe(c, x, z, SHAPES.dish(0.06, 0.04).map(([r, y]) => [r, y + top + 0.014]), 18);
      c.lat(x, z, [[0.058, top + 0.051], [0.064, top + 0.051], [0.064, top + 0.054], [0.058, top + 0.054]], '#e8f0f2', 1.05, 18, GLOSS);
      return B;
    }
    case 'filter': {
      const F = B.filt, y0 = top;
      glassLathe(c, F.x, F.z, SHAPES.flask(0.06, 0.17).map(([r, y]) => [r, y + y0]), 16);
      c.rod(P(F.x + 0.02, y0 + 0.14, F.z), P(F.x + 0.06, y0 + 0.13, F.z), 0.005, '#e8f0f2', 1, GLOSS);
      c.rod(P(F.x + 0.06, y0 + 0.13, F.z), P(F.x + 0.16, y0 + 0.02, F.z - 0.06), 0.007, '#5a3a2a', 0.9, SATIN);
      // the pump the hose runs to
      pbox(F.x + 0.12, F.x + 0.24, y0, y0 + 0.08, F.z - 0.12, F.z - 0.02, grade === 2 ? '#e8ecec' : '#3a4048', 1, null, SATIN);
      pbox(F.x + 0.2, F.x + 0.215, y0 + 0.05, y0 + 0.06, F.z - 0.02, F.z - 0.018, '#48ff8a', 1.6);
      const m = y0 + 0.17;
      c.lat(F.x, F.z, [[0.012, m - 0.01], [0.022, m], [0.022, m + 0.012], [0, m + 0.012]], '#2a2c30', 1, 12, SATIN);
      c.lat(F.x, F.z, [[0.008, m + 0.012], [0.008, m + 0.05], [0.055, m + 0.06], [0.06, m + 0.12], [0.054, m + 0.12], [0.05, m + 0.066], [0, m + 0.066]], '#f2f0ea', 1, 20, GLOSS);
      c.lat(F.x, F.z, [[0, m + 0.0665], [0.049, m + 0.0665], [0, m + 0.067]], '#fbfaf6', 1.05, 18, MATTE);
      return B;
    }
    case 'regulate': case 'leak': case 'collect': {
      const G = B.gas, b = G.bottle;
      // a lecture bottle standing in its stand, a regulator on its valve with the gauge to the front
      c.lat(b.x, b.z, [[0, top], [0.04, top], [0.042, top + 0.01], [0.042, top + b.h - 0.04], [0.03, top + b.h - 0.01], [0.012, top + b.h], [0, top + b.h]], grade === 2 ? '#3a6a8a' : '#6a7a3a', 1, 18, GLOSS);
      c.lat(b.x, b.z, [[0.044, top], [0.05, top], [0.05, top + 0.03], [0.044, top + 0.03]], '#2a2c30', 1, 18, METAL);
      c.lat(b.x, b.z, [[0.012, top + b.h], [0.012, top + b.h + 0.03], [0, top + b.h + 0.03]], '#c8a050', 1.05, 10, METAL);
      pbox(b.x - 0.025, b.x + 0.025, top + b.h + 0.02, top + b.h + 0.07, b.z - 0.02, b.z + 0.03, '#b8bcc0', 1.05, null, METAL);
      pbox(G.gauge.x - 0.035, G.gauge.x + 0.035, G.gauge.y - 0.035, G.gauge.y + 0.035, G.gauge.z, G.gauge.z + 0.008, '#f4f2ea', 1, null, MATTE);
      pbox(G.gauge.x - 0.039, G.gauge.x + 0.039, G.gauge.y - 0.039, G.gauge.y + 0.039, G.gauge.z - 0.004, G.gauge.z, '#2a2c30', 1, null, METAL);
      // the regulator's knob, which the stage turns (drawn moving), sits under the gauge
      // the line: down from the regulator's outlet to the bench, along it through the four joints, into the trough
      const out = [b.x - 0.03, top + b.h + 0.045, b.z + 0.005], J = G.joints;
      const side = b.x - 0.07;
      c.rod(P(...out), P(side, out[1], out[2]), 0.004, '#c86a3a', 0.95, SATIN);
      c.rod(P(side, out[1], out[2]), P(side, J[0].y, J[0].z), 0.004, '#c86a3a', 0.95, SATIN);
      c.rod(P(side, J[0].y, J[0].z), P(J[0].x + 0.012, J[0].y, J[0].z), 0.004, '#c86a3a', 0.95, SATIN);
      for (let i = 0; i < J.length; i++) {
        const j = J[i], nx = i + 1 < J.length ? J[i + 1].x : G.trough.x + G.trough.w / 2 - 0.01;
        c.rod(P(j.x - 0.012, j.y, j.z), P(nx + (i + 1 < J.length ? 0.012 : 0), j.y + (i + 1 < J.length ? 0 : 0.05), j.z), 0.004, '#c86a3a', 0.95, SATIN);
        c.rod(P(j.x - 0.012, j.y, j.z), P(j.x + 0.012, j.y, j.z), 0.008, '#c8a050', 1.05, METAL, 6);
      }
      // the trough: a glass tank of water, and the jar upside down in it
      const T = G.trough;
      glassLathe(c, T.x, T.z, [[T.w * 0.7, top], [T.w * 0.7, top + T.h]], 4);
      pbox(T.x - T.w * 0.48, T.x + T.w * 0.48, top + 0.002, top + T.h * 0.7, T.z - T.d * 0.48, T.z + T.d * 0.48, '#5a9ac8', 0.95, null, GLOSS);
      const jr = G.jar;
      glassLathe(c, jr.x, jr.z, [[jr.r, top + 0.012], [jr.r, top + 0.012 + jr.h], [0, top + 0.02 + jr.h]], 16);
      for (let i = 1; i < 10; i++) { const y = top + 0.012 + (jr.h * i) / 10; pbox(jr.x - 0.006, jr.x + 0.006, y - 0.0007, y + 0.0007, jr.z + jr.r, jr.z + jr.r + 0.0012, '#f4f4f0', 1.2, null, MATTE); }
      c.rod(P(G.trough.x + G.trough.w / 2 - 0.01, top + 0.08, T.z), P(jr.x + 0.01, top + 0.02, jr.z), 0.004, '#c86a3a', 0.95, SATIN);
      return B;
    }
    case 'dry': {
      const { x, z } = B.screen;
      pbox(x - 0.085, x + 0.085, top, top + 0.07, z - 0.085, z + 0.095, grade === 2 ? '#e8ecec' : '#5a6066', 1, null, SATIN);
      // the screen on four legs over the plate: a frame and a fine mesh
      const y = top + 0.11;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) c.rod(P(x + dx * 0.1, top, z + dz * 0.075), P(x + dx * 0.1, y, z + dz * 0.075), 0.003, '#8a8e92', 1, METAL, 4);
      for (const [x0, x1, z0, z1] of [[-0.11, 0.11, -0.085, -0.075], [-0.11, 0.11, 0.075, 0.085], [-0.11, -0.1, -0.085, 0.085], [0.1, 0.11, -0.085, 0.085]]) pbox(x + x0, x + x1, y, y + 0.008, z + z0, z + z1, '#7a6a52', 1, null, SATIN);
      pbox(x - 0.1, x + 0.1, y + 0.003, y + 0.004, z - 0.075, z + 0.075, '#5a5e62', 0.85, null, METAL);
      return B;
    }
    case 'cure': {
      const J = B.jar;
      glassLathe(c, J.x, J.z, [[J.r * 0.96, top], [J.r, top + 0.008], [J.r, top + J.h * 0.86], [J.r * 0.82, top + J.h * 0.95], [J.r * 0.82, top + J.h]], 20);
      // the hygrometer: a dial on a little easel beside the jar
      const H = B.hygro;
      pbox(H.x - 0.04, H.x + 0.04, top, top + 0.012, H.z - 0.03, H.z + 0.02, '#2a2c30', 1, null, SATIN);
      pbox(H.x - 0.036, H.x + 0.036, top + 0.012, top + 0.084, H.z, H.z + 0.008, '#f4f2ea', 1, null, MATTE);
      return B;
    }
    case 'stir': {
      const S = B.stir;
      glassLathe(c, S.x, S.z, SHAPES.beaker(S.r, S.h).map(([r, y]) => [r, y + top]), 20);
      c.lat(S.x, S.z, [[S.r * 0.96, top + S.h - 0.003], [S.r * 1.06, top + S.h - 0.003], [S.r * 1.06, top + S.h], [S.r * 0.96, top + S.h]], '#e8f0f2', 1.05, 20, GLOSS);
      return B;
    }
    case 'rhythm': {
      // the reaction flask on its mantle, its neck stoppered
      const Fk = B.flask;
      c.lat(Fk.x, Fk.z, [[0, top], [0.1, top], [0.105, top + 0.08], [0.07, top + 0.1], [0, top + 0.07]], '#3a3c40', 1, 20, SATIN);
      glassLathe(c, Fk.x, Fk.z, SHAPES.round(Fk.r, 0.05).map(([r, y]) => [r, y + top + 0.07]), 20);
      c.lat(Fk.x, Fk.z, [[0.02, top + 0.07 + Fk.r * 1.9 + 0.05], [0.022, top + 0.07 + Fk.r * 1.9 + 0.075], [0, top + 0.07 + Fk.r * 1.9 + 0.077]], '#8a3a2a', 1, 12, SATIN);
      return B;
    }
    default: return B;
  }
}

// ── the pieces ────────────────────────────────────────────────────────────────────────────────────
// A ring stand: a cast base, an upright and whatever clamps hang off it. Returns the upright's x, z.
export function ringStand(c, x, z, y0, h, base = 0.11) {
  const { pbox } = c.F;
  pbox(x - base * 0.6, x + base * 0.6, y0, y0 + 0.012, z - base, z + base * 0.4, '#2a2c30', 1, null, METAL);
  c.rod(c.F.P(x, y0 + 0.012, z - base * 0.7), c.F.P(x, y0 + h, z - base * 0.7), 0.006, '#b8bcc0', 1.05, METAL);
  return [x, z - base * 0.7];
}
// A clamp from the upright at (ux, uz) out to (x, z) at height y, its jaws round something r wide.
export function clamp(c, ux, uz, x, z, y, r) {
  c.rod(c.F.P(ux, y, uz), c.F.P(x, y, z), 0.004, '#9aa0a6', 1, METAL);
  c.lat(ux, uz, [[0.012, y - 0.012], [0.012, y + 0.012]], '#3a3c40', 1, 8, METAL);
  for (const s of [-1, 1]) c.rod(c.F.P(x - r * 1.1, y, z + s * r * 0.8), c.F.P(x + r * 1.1, y, z + s * r * 0.8), 0.003, '#c86a3a', 1, SATIN);
}
// A round-bottom flask on a heater with a reflux condenser up out of it, clamped to a stand.
export function refluxRig(c, x, z, y0, grade, liquid) {
  const { pbox, P } = c.F;
  // the heater: a mantle (a dimpled drum) on the good benches, a spirit burner on a tripod otherwise
  let seat = y0;
  if (grade > 0) {
    c.lat(x, z, [[0, y0], [0.085, y0], [0.09, y0 + 0.08], [0.06, y0 + 0.095], [0, y0 + 0.07]], '#3a3c40', 1, 18, SATIN);
    pbox(x - 0.03, x + 0.03, y0 + 0.02, y0 + 0.05, z + 0.07, z + 0.09, '#1c1e20', 1, null, SATIN);
    pbox(x - 0.012, x - 0.004, y0 + 0.032, y0 + 0.04, z + 0.09, z + 0.092, '#ff6a3a', 1.7);
    seat = y0 + 0.07;
  } else {
    c.lat(x, z, [[0, y0], [0.03, y0], [0.03, y0 + 0.04], [0.008, y0 + 0.05], [0, y0 + 0.05]], '#c8a050', 1, 12, METAL);
    c.lat(x, z, [[0, y0 + 0.05], [0.009, y0 + 0.062], [0, y0 + 0.09]], '#6aa8ff', 1.8, 8);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; c.rod(P(x + Math.cos(a) * 0.07, y0, z + Math.sin(a) * 0.07), P(x + Math.cos(a) * 0.06, y0 + 0.11, z + Math.sin(a) * 0.06), 0.003, '#2a2a2c', 1, METAL); }
    c.lat(x, z, [[0.06, y0 + 0.11], [0.07, y0 + 0.11], [0.07, y0 + 0.114], [0.06, y0 + 0.114]], '#2a2a2c', 1, 14, METAL);
    seat = y0 + 0.1;
  }
  const r = 0.055, mouth = vessel(c, x, z, seat, SHAPES.round(r, 0.04), 0.4, liquid);
  // the condenser: a glass jacket round an inner tube, water in at the bottom and out at the top
  const cy0 = mouth + 0.01, cy1 = Math.min(mouth + 0.42, c.p.h - 0.42);
  glassLathe(c, x, z, [[0.012, cy0 - 0.02], [0.012, cy0], [0.022, cy0 + 0.02], [0.022, cy1 - 0.02], [0.012, cy1], [0.012, cy1 + 0.02]], 12);
  c.rod(P(x, cy0 - 0.02, z), P(x, cy1 + 0.02, z), 0.005, '#d8e8ec', 1.02, GLOSS);
  for (const [y, s] of [[cy0 + 0.04, 1], [cy1 - 0.04, -1]]) {
    c.rod(P(x + 0.02, y, z), P(x + 0.06, y + s * 0.01, z), 0.005, '#e8f0f2', 1, GLOSS);
    c.rod(P(x + 0.06, y + s * 0.01, z), P(x + 0.12, y - 0.1 * s - 0.15, z - 0.04), 0.007, '#2a2c30', 0.9, SATIN);
  }
  const [ux, uz] = ringStand(c, x - 0.12, z, y0, cy1 - y0 + 0.05);
  clamp(c, ux, uz, x, z, seat + r * 1.9 + 0.02, 0.022);
  clamp(c, ux, uz, x, z, (cy0 + cy1) / 2, 0.024);
}
// A separatory funnel on a ring, two layers in it that don't mix, a beaker under its tap.
// A separatory funnel's glass, its tap at height `tap`: a pear from the stopcock up to a stoppered neck.
export const separatorProfile = (tap) => [[0.004, tap], [0.006, tap + 0.03], [0.05, tap + 0.13], [0.055, tap + 0.17], [0.03, tap + 0.22], [0.012, tap + 0.24], [0.012, tap + 0.27]];
export function separator(c, x, z, y0, liquid, under) {
  const { P } = c.F;
  const [ux, uz] = ringStand(c, x - 0.1, z, y0, 0.52);
  const tap = y0 + 0.22, prof = separatorProfile(tap);
  glassLathe(c, x, z, prof, 14);
  liquidLathe(c, x, z, fillOf(prof, tap + 0.1), under, 1, 14);
  liquidLathe(c, x, z, [[0, tap + 0.1], [0.042, tap + 0.1], [0.05, tap + 0.13], [0.053, tap + 0.15], [0, tap + 0.15]].map(([r, y]) => [r * 0.92, y]), liquid, 1, 14);
  c.lat(x, z, [[0.011, tap + 0.27], [0.013, tap + 0.28], [0, tap + 0.29]], '#2a2c30', 1, 10, SATIN);
  // the stopcock, and the ring it sits in
  c.rod(P(x - 0.018, tap - 0.004, z), P(x + 0.018, tap - 0.004, z), 0.005, '#e8e4dc', 1, GLOSS);
  c.rod(P(x, tap, z), P(x, tap - 0.05, z), 0.003, '#e8f0f2', 1, GLOSS);
  for (let i = 0; i < 16; i++) { const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2, rr = 0.05; c.rod(P(x + Math.cos(a0) * rr, tap + 0.13, z + Math.sin(a0) * rr), P(x + Math.cos(a1) * rr, tap + 0.13, z + Math.sin(a1) * rr), 0.003, '#3a3c40', 1, METAL, 4); }
  c.rod(P(ux, tap + 0.13, uz), P(x - 0.05, tap + 0.13, z), 0.004, '#3a3c40', 1, METAL);
  vessel(c, x, z, y0, SHAPES.beaker(0.035, 0.08), 0.3, under);
}
// A Büchner funnel on a side-arm flask, a cake of crystals on its paper and a hose off the arm.
export function filterRig(c, x, z, y0, product) {
  const { P } = c.F;
  const mouth = vessel(c, x, z, y0, SHAPES.flask(0.06, 0.17), 0.2, '#e8ecee');
  c.rod(P(x + 0.02, y0 + 0.14, z), P(x + 0.06, y0 + 0.13, z), 0.005, '#e8f0f2', 1, GLOSS);
  c.rod(P(x + 0.06, y0 + 0.13, z), P(x + 0.14, y0 + 0.01, z - 0.04), 0.007, '#5a3a2a', 0.9, SATIN);
  c.lat(x, z, [[0.012, mouth - 0.01], [0.022, mouth], [0.022, mouth + 0.012], [0, mouth + 0.012]], '#2a2c30', 1, 12, SATIN);
  c.lat(x, z, [[0.008, mouth + 0.012], [0.008, mouth + 0.05], [0.055, mouth + 0.06], [0.06, mouth + 0.12], [0.054, mouth + 0.12], [0.05, mouth + 0.066], [0, mouth + 0.066]], '#f2f0ea', 1, 18, GLOSS);
  c.lat(x, z, [[0, mouth + 0.066], [0.048, mouth + 0.066], [0.046, mouth + 0.078], [0, mouth + 0.082]], product, 1.05, 16, GLOSS);
}
// A crystallising dish with a crop of crystals grown in it: shards, leaning, in the seed's colour.
export function crystalDish(c, x, z, y0, product) {
  const { pbox, P } = c.F, r = c.r;
  vessel(c, x, z, y0, SHAPES.dish(0.065, 0.04), 0.15, '#dfe8ea');
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.048, cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d, s = 0.004 + r() * 0.006, hh = 0.008 + r() * 0.02;
    c.rod(P(cx, y0 + 0.006, cz), P(cx + (r() - 0.5) * hh, y0 + 0.006 + hh, cz + (r() - 0.5) * hh), s, product, 1.08, GLOSS, 4);
  }
  pbox(x - 0.07, x + 0.07, y0 - 0.002, y0, z - 0.07, z + 0.07, '#e8e4dc', 0.9, null, MATTE);
}
// A mortar and pestle, a scrape of powder in the bowl.
export function mortar(c, x, z, y0, product) {
  c.lat(x, z, [[0, y0], [0.04, y0], [0.05, y0 + 0.01], [0.055, y0 + 0.05], [0.05, y0 + 0.055], [0.04, y0 + 0.02], [0, y0 + 0.018]], '#f0eee8', 1, 18, SATIN);
  c.lat(x, z, [[0, y0 + 0.019], [0.03, y0 + 0.022], [0, y0 + 0.026]], product, 1, 14, MATTE);
  c.rod(c.F.P(x, y0 + 0.02, z), c.F.P(x + 0.05, y0 + 0.11, z + 0.02), 0.009, '#f0eee8', 1, SATIN);
}
// A bench scale: a body, a pan, a lit readout.
// `shield` false leaves a pristine balance's draught shield off, for the spatula to reach in.
export function scale(c, x, z, y0, grade, shield = true) {
  const { pbox } = c.F;
  if (grade === 0) {
    pbox(x - 0.07, x + 0.07, y0, y0 + 0.03, z - 0.07, z + 0.06, '#c8c4b8', 0.95, null, SATIN);
    c.lat(x, z - 0.005, [[0, y0 + 0.03], [0.06, y0 + 0.03], [0.065, y0 + 0.04], [0, y0 + 0.04]], '#b8bcc0', 1, 18, METAL);
    pbox(x - 0.03, x + 0.03, y0 + 0.008, y0 + 0.022, z + 0.06, z + 0.062, '#a8c8a0', 1.5);
    return;
  }
  pbox(x - 0.09, x + 0.09, y0, y0 + 0.05, z - 0.09, z + 0.08, grade === 2 ? '#e8ecec' : '#3a3e42', 1, null, SATIN);
  c.lat(x, z - 0.015, [[0, y0 + 0.05], [0.055, y0 + 0.05], [0.055, y0 + 0.056], [0, y0 + 0.056]], '#c8ccd0', 1.05, 20, METAL);
  pbox(x - 0.05, x + 0.05, y0 + 0.012, y0 + 0.04, z + 0.08, z + 0.082, '#0a1a10', 1, null, GLOSS);
  pbox(x - 0.04, x + 0.03, y0 + 0.018, y0 + 0.034, z + 0.082, z + 0.083, '#48ff8a', 1.6);
  // a pristine balance has its draught shield: four panes round the pan
  if (grade === 2 && shield) glassLathe(c, x, z - 0.015, [[0.075, y0 + 0.05], [0.075, y0 + 0.2]], 4);
}
// A hotplate stirrer: a ceramic top, two knobs, a lit dot, a beaker on it with its bar spinning.
export function stirrer(c, x, z, y0, grade, liquid) {
  const { pbox } = c.F;
  pbox(x - 0.08, x + 0.08, y0, y0 + 0.07, z - 0.08, z + 0.09, grade === 2 ? '#e8ecec' : '#5a6066', 1, null, SATIN);
  pbox(x - 0.075, x + 0.075, y0 + 0.07, y0 + 0.075, z - 0.08, z + 0.07, '#f0eee8', 1, null, GLOSS);
  for (const dx of [-0.04, 0.04]) c.rod(c.F.P(x + dx, y0 + 0.03, z + 0.09), c.F.P(x + dx, y0 + 0.03, z + 0.105), 0.012, '#1c1e20', 1, SATIN, 10);
  pbox(x - 0.004, x + 0.004, y0 + 0.052, y0 + 0.058, z + 0.09, z + 0.092, '#ff4a2a', 1.7);
  vessel(c, x, z - 0.005, y0 + 0.075, SHAPES.beaker(0.045, 0.11), 0.55, liquid);
  c.rod(c.F.P(x - 0.018, y0 + 0.081, z - 0.005), c.F.P(x + 0.018, y0 + 0.081, z - 0.005), 0.004, '#f8f8f8', 1, GLOSS, 6);
}
// A single-punch tablet press: a frame, a hopper, a handwheel, a tray of what it's made.
// `full` false leaves out the punch and the tablets, which the Chem Stage moves (gl/lab-matter.js).
export function pillPress(c, x, z, y0, product, full = true) {
  const { pbox, P } = c.F;
  pbox(x - 0.07, x + 0.07, y0, y0 + 0.04, z - 0.07, z + 0.07, '#3a4a5a', 1, null, SATIN);
  for (const s of [-1, 1]) pbox(x + s * 0.05 - 0.012, x + s * 0.05 + 0.012, y0 + 0.04, y0 + 0.3, z - 0.03, z + 0.01, '#3a4a5a', 1, null, SATIN);
  pbox(x - 0.07, x + 0.07, y0 + 0.28, y0 + 0.32, z - 0.04, z + 0.02, '#3a4a5a', 1, null, SATIN);
  // the hopper, beside the punch so the punch can be seen coming down
  c.lat(x - 0.03, z + 0.012, [[0.004, y0 + 0.11], [0.018, y0 + 0.15], [0.02, y0 + 0.21], [0, y0 + 0.21]], '#c8ccd0', 1, 12, METAL);
  if (full) c.rod(P(x, y0 + 0.32, z - 0.01), P(x, y0 + 0.2, z - 0.01), 0.008, '#c8ccd0', 1.05, METAL);
  for (let i = 0; i < 12; i++) { const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2, rr = 0.08; c.rod(P(x + 0.09, y0 + 0.2 + Math.cos(a0) * rr, z + Math.sin(a0) * rr), P(x + 0.09, y0 + 0.2 + Math.cos(a1) * rr, z + Math.sin(a1) * rr), 0.006, '#c83a2a', 1, GLOSS, 6); }
  pbox(x - 0.06, x + 0.06, y0 + 0.04, y0 + 0.05, z + 0.03, z + 0.08, '#c8ccd0', 1, null, METAL);
  if (full) for (let i = 0; i < 8; i++) c.lat(x - 0.045 + (i % 4) * 0.03, z + 0.045 + Math.floor(i / 4) * 0.022, [[0, y0 + 0.05], [0.007, y0 + 0.05], [0.007, y0 + 0.054], [0, y0 + 0.055]], product, 1, 8, SATIN);
}
// A row of reagent bottles at height y between x0 and x1: amber, clear and white, each with a label.
export function reagents(c, x0, x1, y, z, n, grade) {
  const glassCols = ['#5a2a10', '#7a3a14', '#d8e4e8', '#f0eee8'];
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) * (x1 - x0)) / n + (c.r() - 0.5) * 0.01, h = 0.12 + c.r() * 0.08, wd = 0.022 + c.r() * 0.01;
    const col = grade === 2 && i % 3 ? '#f0eee8' : pick(c.r, glassCols);
    c.lat(x, z, SHAPES.bottle(wd, h).map(([r, yy]) => [r, y + yy]), col, 0.95, 10, GLOSS);
    c.lat(x, z, [[wd * 1.02, y + h * 0.22], [wd * 1.02, y + h * 0.52]], grade === 0 && c.r() < 0.4 ? '#c8b890' : '#f4f2ea', 1, 10, MATTE);
    c.lat(x, z, [[wd * 0.4, y + h], [wd * 0.42, y + h + 0.02], [0, y + h + 0.022]], pick(c.r, ['#1c1e20', '#c83a2a', '#2a5a8a']), 1, 8, SATIN);
  }
}
// A gas bottle stood in the knee space, strapped, its regulator and a hose up through the worktop.
export function gasBottle(c, x, z, grade) {
  const top = WORKTOP - 0.12, col = grade === 2 ? '#3a6a8a' : '#6a7a3a';
  c.lat(x, z, [[0, 0], [0.09, 0], [0.095, 0.02], [0.095, top - 0.1], [0.07, top - 0.03], [0.03, top], [0, top]], col, 1, 18, GLOSS);
  c.lat(x, z, [[0.096, top * 0.5], [0.096, top * 0.5 + 0.03]], '#2a2a2c', 1, 18, SATIN);
  c.lat(x, z, [[0.016, top], [0.016, top + 0.05], [0, top + 0.05]], '#c8a050', 1.05, 10, METAL);
  c.lat(x + 0.035, z, [[0, top + 0.03], [0.026, top + 0.03], [0.026, top + 0.04], [0, top + 0.04]].map(([r, y]) => [r, y]), '#c8ccd0', 1.05, 14, METAL);
  c.rod(c.F.P(x + 0.04, top + 0.06, z), c.F.P(x + 0.04, WORKTOP + 0.01, z - 0.05), 0.006, '#c84a2a', 0.95, SATIN);
}
// A skull, which every scavenged bench seems to end up with.
export function skull(c, x, z, y0) {
  const [u, v] = c.F.P(x, 0, z);
  c.K.ball(u, v, y0 + 0.05, 0.05, '#e8dcc0', 0.95, 12, SATIN);
  c.F.pbox(x - 0.03, x + 0.03, y0, y0 + 0.025, z, z + 0.05, '#e0d4b8', 0.95, null, SATIN);
  for (const s of [-1, 1]) c.F.pbox(x + s * 0.02 - 0.01, x + s * 0.02 + 0.01, y0 + 0.045, y0 + 0.065, z + 0.045, z + 0.049, '#1a1410', 1, null, MATTE);
}

// ── the bench ─────────────────────────────────────────────────────────────────────────────────────
// The whole lab in p's footprint: casework to the worktop, a hood over the left of it, open bench and
// a reagent shelf on the right, and the glassware a lab of that grade has out.
export function drawLab(c, quality = 'standard') {
  const { F, p, r } = c, { pbox, P, N } = F, g = gradeOf(quality), L = LOOK[g];
  const hw = p.w / 2, hd = p.d / 2, h = p.h, T = WORKTOP;
  const liquid = pick(r, REAGENTS), second = pick(r, REAGENTS), product = pick(r, ['#f0f0ea', '#e8eaf0', '#c8e8f0', '#e8a050', '#f0d040']);
  const split = -hw + p.w * 0.6;            // where the hood ends and the open bench begins
  const knee = hw - 0.26;                   // the knee space at the right end, where the gas stands
  // the plinth, the casework and its doors, the worktop
  pbox(-hw + 0.02, knee, 0, 0.08, -hd, hd - 0.06, '#101012', 0.9);
  pbox(-hw, knee, 0.08, T - 0.03, -hd, hd - 0.02, L.carcass, 0.92, null, SATIN);
  const doors = Math.max(2, Math.round((knee + hw) / 0.5));
  for (let i = 0; i < doors; i++) {
    const x0 = -hw + 0.006 + (i * (knee + hw)) / doors, x1 = x0 + (knee + hw) / doors - 0.012;
    pbox(x0, x1, 0.09, T - 0.04, hd - 0.02, hd - 0.004, L.door, g === 0 ? 0.85 + r() * 0.12 : 1, null, SATIN);
    pbox((x0 + x1) / 2 - 0.05, (x0 + x1) / 2 + 0.05, T - 0.1, T - 0.088, hd - 0.004, hd + 0.012, L.handle, 1, null, METAL);
    if (g === 0) c.stain((x0 + x1) / 2, 0.3 + r() * 0.3, hd - 0.003, 0.05);
  }
  pbox(knee, hw, T - 0.03, T, -hd, hd - 0.02, L.carcass, 0.92, null, SATIN);
  pbox(hw - 0.02, hw, 0, T - 0.03, -hd, hd - 0.02, L.carcass, 0.9, null, SATIN);
  pbox(-hw - 0.01, hw + 0.01, T, T + 0.03, -hd, hd + 0.015, L.top, 1, null, L.topSurf);
  pbox(-hw - 0.01, hw + 0.01, T - 0.004, T, hd, hd + 0.015, L.edge, 1, null, SATIN);
  // a scavenged top is scarred; a scar stays on the top, never over its edge
  // (`c.stain` is for a front face; these lie flat on the top)
  if (g === 0) for (let i = 0; i < 4; i++) {
    const s = 0.04 + r() * 0.04, x = -hw + s + r() * (p.w - 2 * s), z = -hd + s + r() * Math.max(0, p.d - 2 * s);
    pbox(x - s, x + s, T + 0.03, T + 0.0312, z - s * 0.6, z + s * 0.6, pick(r, ['#2a2018', '#3a3a1a', '#4a1a14']), 0.6 + r() * 0.2, null, MATTE);
  }
  const top = T + 0.03;

  // the hood: its sides and back, a baffle, a lit roof, a sash half up, and the duct to the ceiling
  // a bench being worked at has its sash pushed up out of the way
  const hoodTop = h - 0.3, sashLo = p.working ? hoodTop - 0.16 : top + 0.36, sashHi = hoodTop - 0.04;
  pbox(-hw, split, top, h - 0.18, -hd, -hd + 0.025, L.hood, 0.85, null, SATIN);
  for (const x of [-hw, split - 0.04]) pbox(x, x + 0.04, top, hoodTop, -hd, hd - 0.02, L.hood, 1, null, g === 2 ? METAL : SATIN);
  pbox(-hw, split, hoodTop, h - 0.18, -hd, hd - 0.02, L.hood, 1, null, g === 2 ? METAL : SATIN);
  pbox(-hw + 0.05, split - 0.05, hoodTop - 0.03, hoodTop - 0.02, -hd + 0.04, hd - 0.08, '#e8f4f0', 1.6);
  pbox(-hw + 0.04, split - 0.04, top + 0.05, hoodTop - 0.08, -hd + 0.025, -hd + 0.04, L.hood, 0.75, null, SATIN);
  // the sash: a frame, a pane, a pull
  pbox(-hw + 0.04, split - 0.04, sashLo - 0.03, sashLo, hd - 0.04, hd - 0.02, L.handle, 1, null, METAL);
  pbox(-hw + 0.04, split - 0.04, sashHi, sashHi + 0.02, hd - 0.04, hd - 0.02, L.handle, 1, null, METAL);
  // its stiles, and a muntin up the middle: the pane only shows its highlights, so the frame says it's a window
  for (const x of [-hw + 0.04, (-hw + split) / 2 - 0.006, split - 0.052]) pbox(x, x + 0.012, sashLo - 0.03, sashHi + 0.02, hd - 0.04, hd - 0.02, L.handle, 1, null, METAL);
  c.K.quad(c.K.glass, [P(-hw + 0.04, sashLo, hd - 0.03), P(split - 0.04, sashLo, hd - 0.03), P(split - 0.04, sashHi, hd - 0.03), P(-hw + 0.04, sashHi, hd - 0.03)], N(0, 0, 1), [1, 1, 1], GLOSS, null, true);
  c.rod(P(-hw + 0.2, sashLo - 0.04, hd - 0.01), P(split - 0.2, sashLo - 0.04, hd - 0.01), 0.008, L.handle, 1.05, METAL);
  // the duct up from the hood's roof, and its fan: a grey can on a scavenged bench, its grille rusted
  const dx = (-hw + split) / 2;
  c.lat(dx, -hd * 0.2, [[0.1, h - 0.18], [0.1, h]], g === 0 ? '#7a6a5a' : '#b8bcc0', 0.95, 16, METAL);
  c.lat(dx, -hd * 0.2, [[0.13, h - 0.16], [0.13, h - 0.08], [0.1, h - 0.06]], g === 0 ? '#5a4a3a' : '#c8ccd0', 1, 16, METAL);
  // the airflow readout on the hood's post: a green bar on the good benches, a strip of tape on the bad
  if (g > 0) {
    pbox(split - 0.035, split - 0.005, top + 0.6, top + 0.72, hd - 0.02, hd - 0.012, '#1c1e20', 1, null, SATIN);
    pbox(split - 0.03, split - 0.01, top + 0.62, top + 0.68, hd - 0.012, hd - 0.01, '#48ff8a', 1.6);
  } else pbox(split - 0.035, split - 0.005, top + 0.5, top + 0.56, hd - 0.02, hd - 0.016, '#e8d040', 0.9, null, MATTE);

  // under the hood: the reflux rig, the separator and a couple of beakers
  const zIn = -hd * 0.15;
  refluxRig(c, -hw + 0.28, zIn, top, g, liquid);
  if (split + hw > 1.0) separator(c, -hw + 0.62, zIn, top, liquid, second);
  vessel(c, split - 0.18, zIn + 0.06, top, SHAPES.beaker(0.04, 0.1), 0.35 + r() * 0.3, second);
  vessel(c, split - 0.1, zIn - 0.02, top, SHAPES.flask(0.045, 0.13), 0.25, liquid);

  // the open bench, in two rows so nothing stands in anything else. At the front: the scale, the
  // mortar, and the crystal dish (the skull on a scavenged bench). At the back: the filter rig (a
  // measuring cylinder), the tablet press on a pristine bench, and the stirrer at the end.
  // A bench the Chem Stage is working at (`p.working`) has its open bench cleared, and the stage's own
  // tools put on it instead (workingSet).
  const front = hd * 0.3, back = -hd * 0.3;
  if (p.working) {
    // the wall behind a bench being worked at: tiled the whole width and up past the shelves, a darker grey-green
    // so the glass and what glows stand out against it
    pbox(-hw + 0.005, hw - 0.005, top, h - 0.02, -hd - 0.002, -hd + 0.004, '#ffffff', 1, { t: 'roomTile', c: g === 0 ? '#6a7268' : g === 1 ? '#5e6a66' : '#7a8682' }, GLOSS);
    if (typeof p.working === 'string') workingSet(c, p.working, g);
  }
  else {
  scale(c, split + 0.14, front, top, g);
  mortar(c, split + 0.36, front, top, product);
  if (g > 0) crystalDish(c, hw - 0.34, front, top, product);
  else skull(c, hw - 0.34, front - 0.03, top);
  if (g > 0) filterRig(c, split + 0.14, back, top, product);
  else vessel(c, split + 0.14, back, top, SHAPES.cylinder(0.022, 0.2), 0.5, second);
  if (g === 2) pillPress(c, split + 0.42, back, top, product);
  if (g > 0) stirrer(c, hw - 0.18, back, top, g, second);
  else vessel(c, hw - 0.18, back, top, SHAPES.beaker(0.04, 0.1), 0.45, second);
  }
  // the reagent shelf on the wall over the open bench, and its bottles
  const sh = Math.min(h - 0.5, top + 0.55);
  pbox(split + 0.02, hw - 0.02, sh, sh + 0.018, -hd, -hd + 0.15, g === 0 ? '#7a6a52' : '#b8bcc0', 1, null, g === 0 ? SATIN : METAL);
  for (const x of [split + 0.04, hw - 0.04]) pbox(x - 0.008, x + 0.008, sh - 0.12, sh, -hd, -hd + 0.012, '#5a5e62', 1, null, METAL);
  reagents(c, split + 0.06, hw - 0.06, sh + 0.018, -hd + 0.075, Math.max(4, Math.round((hw - split) / 0.075)), g);
  if (h - sh > 0.7) {
    const sh2 = sh + 0.36;
    pbox(split + 0.02, hw - 0.02, sh2, sh2 + 0.018, -hd, -hd + 0.15, g === 0 ? '#7a6a52' : '#b8bcc0', 1, null, g === 0 ? SATIN : METAL);
    reagents(c, split + 0.06, hw - 0.06, sh2 + 0.018, -hd + 0.075, Math.max(3, Math.round((hw - split) / 0.09)), g);
  }
  // the knee space: the gas, strapped to the end panel
  gasBottle(c, (knee + hw) / 2, -hd * 0.1, g);
  c.rod(P(knee + 0.01, 0.55, -hd * 0.1 + 0.1), P(hw - 0.03, 0.55, -hd * 0.1 + 0.1), 0.006, '#2a2a2c', 1, SATIN);
  // a pristine bench has its eyewash on the end post
  if (g === 2) {
    c.rod(P(hw - 0.05, top, hd - 0.1), P(hw - 0.05, top + 0.2, hd - 0.1), 0.01, '#3a8a3a', 1, GLOSS);
    c.lat(hw - 0.05, hd - 0.1, [[0, top + 0.2], [0.04, top + 0.2], [0.05, top + 0.23], [0, top + 0.22]], '#3a8a3a', 1, 14, GLOSS);
  }
}
