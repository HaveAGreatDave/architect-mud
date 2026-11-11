// GLASS 2 · A BROADCAST SET. A set document (client/shared/sequence.js) as the batches gl/room.js
// draws: a shell and its pieces, built from the room kit, in metres. u across, v back from the
// cameras, y up. Pure: batches of ballpark-mesh.js vertices, no GL.
//
// SET_PIECES is what the Broadcast Studio's set editor offers, so a new piece is a row here: its
// label, the fields it takes and a `draw`. Nothing in the kit knows what a show is.
//
// ⚠ L's `f` POINTS AT THE CAMERAS. room-kit.js builds normals as r·du - f·dv, so with v running back
// into the set `f` is -z. The figures read only `world`, which is why the Figure Lab's room can
// leave it +z and this one can't.
//
// ⚠ A SCREEN'S QUAD GOES IN K.screen, IN ORDER. gl/room.js shows the live picture on one stretch of
// that batch (`light.tvOn`), so `wall` records where the first video wall's six vertices are.

import { MAT, createBatch } from './ballpark-mesh.js';
import { roomKit } from './room-kit.js';
import { GLOW } from './room-mesh.js';
import { LEGEND_STROKES } from '../../../../shared/legend-font.js';
import { BANK_ATLAS, BANK_CELLS } from './screen-bank.js';
import { tonightPieces } from './set-tonight.js';
import { locationPieces } from './set-location.js';
import { courtPieces } from './set-court.js';
import { hallPieces } from './set-hall.js';
import { filmPieces } from './set-film.js';
import { churchPieces } from './set-church.js';
import { controlPieces } from './set-control.js';

const { GLOSS, METAL, SATIN, CLOTH, LEATHER } = MAT;

export const SET_FRAME = Object.freeze({ world: (u, v, y) => [u, y, v], r: [1, 0, 0], f: [0, 0, -1] });

// A light falls off toward the floor's edges and the top of a wall, which is most of what stops a
// studio reading as a box.
const bakeFor = (set) => {
  const w = set.room?.w || 10, d = set.room?.d || 8, h = set.room?.h || 4;
  return (p, n, col) => {
    const edge = Math.min(1, Math.min(w / 2 - Math.abs(p[0]), d - p[1], p[1] + 1) / 1.6 + 0.55), up = 1 - 0.3 * Math.max(0, p[2] / h - 0.55);
    const k = Math.max(0.5, edge) * up;
    return [col[0] * k, col[1] * k, col[2] * k];
  };
};

const num = (v, d) => (Number.isFinite(+v) && v !== '' && v != null ? +v : d);
const facingOf = (yaw) => { const a = (yaw || 0) * Math.PI / 180; return [Math.sin(a), Math.cos(a)]; };
const F = (k, label, type = 'number', opts) => ({ k, label, type, ...(opts ? { opts } : {}) });

// A strip of a circle's arc: `R` round (cu, cv) from a0 to a1, each segment a quad from `at(a, s)`.
function arc(n, a0, a1, fn) { for (let i = 0; i < n; i++) fn(a0 + (a1 - a0) * i / n, a0 + (a1 - a0) * (i + 1) / n); }

function chair(K, p, back = 0.98, pal) {
  const [fu, fv] = facingOf(p.yaw), { pbox, alongX } = K.frame(p.at[0], p.at[1], fu, fv), seat = num(p.seat, 0.5), col = p.colour || pal.chair || '#1c1d22';
  K.lathe(p.at[0], p.at[1], [[0.3, 0.02], [0.3, 0.05], [0.04, 0.06], [0.035, seat - 0.05], [0, seat - 0.05]], '#6f7278', 1, 14, METAL);
  K.rounded(...alongX(), -0.25, 0.25, -0.26, 0.24, seat - 0.05, seat + 0.05, 0.04, col, 1, LEATHER);
  pbox(-0.24, 0.24, seat, seat + back - 0.5, -0.34, -0.26, col, 1, null, LEATHER);
}

// ── Lettering ────────────────────────────────────────────────────────────────────────────────────
// A set's words (a network's name on the wall, a desk's front, a podium) in the legend face's strokes
// (client/shared/legend-font.js), lit. `{brand.name}` in a piece's text is the set's brand, so a
// template's sign reads whatever network a skin makes it.
//
// ⚠ A PIECE'S +x IS THE VIEWER'S LEFT when it faces the cameras (the video wall's picture is mapped
// x1 → u 0 for the same reason), so a line runs from +x to -x. `side` -1 letters the back face.
const ADV = 5.4, HALF = 0.62;
export const brandText = (text, set) => String(text ?? '').replace(/\{brand\.(\w+)\}/g, (m, k) => String(set?.brand?.[k] ?? '')).trim();
export const letterWidth = (str, h) => (str.length ? (str.length * ADV - (ADV - 4 - HALF * 2)) * h / 6 : 0);
// Each bar of `str` as a quad in the line's own plane: [[x, y] x4], x across from the middle, y up from the baseline.
function letterQuads(str, h) {
  const u = h / 6, W = letterWidth(str, h), out = [];
  let x0 = -W / 2 + HALF * u;
  for (const ch of str.toUpperCase()) {
    for (const s of LEGEND_STROKES[ch] || []) {
      let dx = s[2] - s[0], dy = s[3] - s[1];
      const L = Math.hypot(dx, dy) || 1;
      dx /= L; dy /= L;
      const ex = dx * HALF, ey = dy * HALF, nx = -dy * HALF, ny = dx * HALF, Q = (x, y) => [x0 + x * u, y * u];
      out.push([Q(s[0] - ex + nx, s[1] - ey + ny), Q(s[0] - ex - nx, s[1] - ey - ny), Q(s[2] + ex - nx, s[3] + ey - ny), Q(s[2] + ex + nx, s[3] + ey + ny)]);
    }
    x0 += ADV * u;
  }
  return out;
}
// A line of lit letters on a piece's face: `put(x, y)` → room point, `n` the face's normal. Shrinks to `maxW`.
function letter(K, str, h, maxW, put, n, hex, k = 1.8) {
  str = String(str || '').trim();
  if (!str) return;
  const W = letterWidth(str, h);
  if (maxW && W > maxW) h *= maxW / W;
  const col = K.C(hex, k);
  for (const q of letterQuads(str, h)) K.quad(K.solid, q.map(([x, y]) => put(x, y)), n, col, MAT.EMISSIVE, null, true);
}
// Lettering on a frame's face at depth z, centred on x = cx, baseline y.
function letterOn(K, fr, str, { cx = 0, y = 0, z = 0, h = 0.2, maxW = 0, side = 1, hex = '#ffffff', k = 1.8 }) {
  letter(K, str, h, maxW, (x, yy) => fr.P(cx - side * x, y + yy, z), fr.N(0, 0, side), hex, k);
}
const brandColour = (set, p) => p.colour || set.brand?.colour || set.palette?.accent || '#39a0ff';

export const SET_PIECES = Object.freeze({
  video_wall: {
    label: 'Video wall', fields: [F('w', 'Width'), F('h', 'Height'), F('y', 'Off the floor')],
    make: { at: [0, 0], yaw: 180, w: 7, h: 2.6, y: 0.5 },
    draw(K, p, set, out) {
      const w = num(p.w, 7), h = num(p.h, 2.6), y = num(p.y, 0.5), [fu, fv] = facingOf(p.yaw ?? 180), { pbox, front } = K.frame(p.at[0], p.at[1], fu, fv), c = set.palette?.trim || '#14161c';
      pbox(-w / 2 - 0.12, w / 2 + 0.12, y - 0.12, y + h + 0.12, -0.2, 0.02, c, 1, null, SATIN);
      const first = K.screen.n, one = [1, 1, 1];
      front(K.screen, -w / 2, w / 2, y, y + h, 0.03, one, GLOW, [[1, 1], [0, 1], [0, 0], [1, 0]]);
      if (!out.wall) out.wall = { first, count: K.screen.n - first, aspect: w / h };
    },
  },
  desk_curve: {
    label: 'Curved desk', fields: [F('w', 'Width'), F('depth', 'Depth'), F('h', 'Height'), F('radius', 'Curve radius')],
    make: { at: [0, 0], w: 3.6, depth: 0.72, h: 0.78, radius: 3.4 },
    draw(K, p, set) {
      const w = num(p.w, 3.6), dp = num(p.depth, 0.72), h = num(p.h, 0.78), R = num(p.radius, 3.4), [cu, cv] = [p.at[0], p.at[1] + R];
      const pal = set.palette || {}, side = K.C(pal.desk || '#1b2433'), top = K.C(pal.deskTop || '#d8dde6'), glow = K.C(pal.accent || '#39a0ff', 1.3), half = Math.asin(Math.min(0.98, w / 2 / R));
      const at = (a, r, y) => [cu + Math.sin(a) * r, cv - Math.cos(a) * r, y];
      const out = (a) => K.nrmOf(Math.sin(a), 0, -Math.cos(a));
      const ri = R - dp;
      arc(20, -half, half, (a, b) => {
        const m = (a + b) / 2;
        K.quad(K.solid, [at(a, R + 0.02, 0.1), at(b, R + 0.02, 0.1), at(b, R + 0.02, h - 0.1), at(a, R + 0.02, h - 0.1)], out(m), side, SATIN);
        K.quad(K.solid, [at(a, R + 0.05, h - 0.06), at(b, R + 0.05, h - 0.06), at(b, ri, h - 0.06), at(a, ri, h - 0.06)], [0, -1, 0], side, SATIN);
        K.quad(K.solid, [at(a, R + 0.05, h), at(b, R + 0.05, h), at(b, ri, h), at(a, ri, h)], [0, 1, 0], top, GLOSS);
        K.quad(K.solid, [at(a, R + 0.05, h - 0.06), at(b, R + 0.05, h - 0.06), at(b, R + 0.05, h), at(a, R + 0.05, h)], out(m), top, GLOSS);
        K.quad(K.solid, [at(a, R + 0.03, 0.03), at(b, R + 0.03, 0.03), at(b, R + 0.03, 0.1), at(a, R + 0.03, 0.1)], out(m), glow, MAT.EMISSIVE, null, true);
        K.quad(K.solid, [at(a, ri + 0.04, 0), at(b, ri + 0.04, 0), at(b, ri + 0.04, h - 0.06), at(a, ri + 0.04, h - 0.06)], K.nrmOf(-Math.sin(m), 0, Math.cos(m)), K.C('#0d0f14'), SATIN);
      });
      for (const a of [-half, half]) K.quad(K.solid, [at(a, ri, 0), at(a, R + 0.03, 0), at(a, R + 0.03, h), at(a, ri, h)], K.nrmOf(Math.sign(a) * Math.cos(a), 0, Math.sign(a) * Math.sin(a)), side, SATIN);
      // the network's panel on the front, or its name bent round the curve
      const text = brandText(p.text, set);
      if (!text) arc(8, -0.11 * 3.4 / R, 0.11 * 3.4 / R, (a, b) => K.quad(K.solid, [at(a, R + 0.045, 0.2), at(b, R + 0.045, 0.2), at(b, R + 0.045, h - 0.16), at(a, R + 0.045, h - 0.16)], out((a + b) / 2), glow, MAT.EMISSIVE, null, true));
      else letter(K, text, Math.min(0.26, h * 0.34), w * 0.8, (x, y) => at(x / R, R + 0.055, h * 0.36 + y), out(0), brandColour(set, p));
    },
  },
  desk_straight: {
    label: 'Straight desk', fields: [F('w', 'Width'), F('depth', 'Depth'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('text', 'Front lettering', 'text'), F('panel', 'Front panel colour', 'text')],
    make: { at: [0, 0], w: 2.2, depth: 0.8, h: 0.78, yaw: 0 },
    draw(K, p, set) {
      const w = num(p.w, 2.2), dp = num(p.depth, 0.8), h = num(p.h, 0.78), [fu, fv] = facingOf(p.yaw ?? 180), fr = K.frame(p.at[0], p.at[1], fu, fv), { pbox } = fr, pal = set.palette || {};
      pbox(-w / 2, w / 2, 0, h - 0.05, -dp / 2, dp / 2, pal.desk || '#3a2a20', 1, null, SATIN);
      pbox(-w / 2 - 0.05, w / 2 + 0.05, h - 0.05, h, -dp / 2 - 0.05, dp / 2 + 0.05, pal.deskTop || '#6a4a30', 1, null, GLOSS);
      // the front is whichever long face looks at the cameras (low v)
      const side = fr.P(0, 0, 1)[1] < p.at[1] ? 1 : -1, z = side * (dp / 2 + 0.012);
      if (p.panel) pbox(-w * 0.42, w * 0.42, 0.12, h - 0.14, side > 0 ? dp / 2 : -dp / 2 - 0.012, side > 0 ? dp / 2 + 0.012 : -dp / 2, p.panel, 1, null, GLOSS);
      letterOn(K, fr, brandText(p.text, set), { y: h * 0.32, z: z + side * 0.004, h: Math.min(0.24, h * 0.3), maxW: w * 0.78, side, hex: brandColour(set, p) });
    },
  },
  sign: {
    label: 'Lit sign', fields: [F('text', 'Text ({brand.name} is the network)', 'text'), F('h', 'Letter height'), F('y', 'Off the floor'), F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text'), F('panel', 'Backing colour', 'text'), F('glow', 'Brightness')],
    make: { at: [0, 0], yaw: 180, text: '{brand.name}', h: 0.5, y: 2.6, glow: 1.9 },
    draw(K, p, set) {
      const text = brandText(p.text, set);
      if (!text) return;
      const h = num(p.h, 0.5), y = num(p.y, 2.6), [fu, fv] = facingOf(p.yaw ?? 180), fr = K.frame(p.at[0], p.at[1], fu, fv), W = letterWidth(text, h);
      if (p.panel) fr.pbox(-W / 2 - h * 0.45, W / 2 + h * 0.45, y - h * 0.4, y + h * 1.4, -0.08, 0, p.panel, 1, null, SATIN);
      letterOn(K, fr, text, { y, z: 0.012, h, hex: brandColour(set, p), k: num(p.glow, 1.9) });
    },
  },
  lectern: {
    label: 'Lectern', fields: [F('yaw', 'Facing (°)'), F('w', 'Width'), F('h', 'Height'), F('text', 'Front lettering', 'text'), F('colour', 'Colour', 'text')],
    make: { at: [0, 0], yaw: 180, w: 0.7, h: 1.12 },
    draw(K, p, set) {
      const w = num(p.w, 0.7), h = num(p.h, 1.12), [fu, fv] = facingOf(p.yaw ?? 180), fr = K.frame(p.at[0], p.at[1], fu, fv), pal = set.palette || {}, c = p.colour || pal.desk || '#3a2a20';
      fr.pbox(-w / 2, w / 2, 0, 0.06, -0.3, 0.3, pal.trim || '#14161c', 1, null, SATIN);
      fr.pbox(-w * 0.42, w * 0.42, 0.06, h - 0.08, -0.2, 0.2, c, 1, null, SATIN);
      // the slanted top, a reading desk
      K.quad(K.solid, [fr.P(-w / 2, h - 0.12, 0.26), fr.P(w / 2, h - 0.12, 0.26), fr.P(w / 2, h + 0.04, -0.26), fr.P(-w / 2, h + 0.04, -0.26)], fr.N(0, 0.95, 0.3), K.C(pal.deskTop || '#6a4a30'), GLOSS);
      fr.pbox(-w / 2, w / 2, h - 0.16, h - 0.08, -0.26, 0.26, pal.deskTop || '#6a4a30', 1, null, GLOSS);
      fr.pbox(-w * 0.36, w * 0.36, h * 0.5, h * 0.5 + 0.03, 0.2, 0.215, brandColour(set, p), 1.9);
      letterOn(K, fr, brandText(p.text, set), { y: h * 0.58, z: 0.21, h: 0.11, maxW: w * 0.72, hex: brandColour(set, p) });
    },
  },
  podium: {
    label: 'Contestant podium', fields: [F('yaw', 'Facing (°)'), F('text', 'Name or number', 'text'), F('colour', 'Colour', 'text')],
    make: { at: [0, 0], yaw: 180, text: '1' },
    draw(K, p, set) {
      const [fu, fv] = facingOf(p.yaw ?? 180), fr = K.frame(p.at[0], p.at[1], fu, fv), pal = set.palette || {}, c = brandColour(set, p);
      fr.pbox(-0.42, 0.42, 0, 0.08, -0.32, 0.32, pal.trim || '#14161c', 1, null, METAL);
      fr.pbox(-0.36, 0.36, 0.08, 1.0, -0.26, 0.26, pal.desk || '#1b2433', 1, null, GLOSS);
      fr.pbox(-0.4, 0.4, 1.0, 1.05, -0.3, 0.3, pal.deskTop || '#d8dde6', 1, null, GLOSS);
      // the score window, and a lit band at the foot
      fr.pbox(-0.28, 0.28, 0.62, 0.9, 0.26, 0.27, '#06070a', 1, null, GLOSS);
      fr.pbox(-0.37, 0.37, 0.12, 0.17, 0.26, 0.275, c, 2);
      letterOn(K, fr, brandText(p.text, set), { y: 0.68, z: 0.276, h: 0.16, maxW: 0.5, hex: c, k: 2 });
      // the buzzer
      K.lathe(...fr.P(0, 0, -0.12).slice(0, 2), [[0.07, 1.05], [0.07, 1.09], [0, 1.1]], '#d02020', 1.6, 12, GLOSS);
    },
  },
  counter: {
    label: 'Counter', fields: [F('w', 'Width'), F('depth', 'Depth'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('hob', 'Burners (0 for none)'), F('text', 'Front lettering', 'text'), F('colour', 'Colour', 'text')],
    make: { at: [0, 0], yaw: 180, w: 2.4, depth: 0.7, h: 0.92, hob: 0 },
    draw(K, p, set) {
      const w = num(p.w, 2.4), dp = num(p.depth, 0.7), h = num(p.h, 0.92), hob = Math.max(0, Math.min(6, num(p.hob, 0) | 0)), [fu, fv] = facingOf(p.yaw ?? 180), fr = K.frame(p.at[0], p.at[1], fu, fv), pal = set.palette || {};
      fr.pbox(-w / 2, w / 2, 0, 0.1, -dp / 2 + 0.06, dp / 2 - 0.06, '#0d0e11', 1, null, SATIN);
      fr.pbox(-w / 2, w / 2, 0.1, h - 0.05, -dp / 2, dp / 2, p.colour || pal.desk || '#5a4a3a', 1, null, SATIN);
      // cupboard doors on the front
      const n = Math.max(2, Math.round(w / 0.6));
      for (let i = 0; i < n; i++) { const x0 = -w / 2 + (w * i) / n + 0.03, x1 = -w / 2 + (w * (i + 1)) / n - 0.03; fr.pbox(x0, x1, 0.16, h - 0.11, dp / 2, dp / 2 + 0.015, p.colour || pal.desk || '#5a4a3a', 1.08, null, SATIN); fr.pbox(x0 + 0.04, x0 + 0.06, h - 0.3, h - 0.18, dp / 2 + 0.015, dp / 2 + 0.035, '#b0b4ba', 1, null, METAL); }
      fr.pbox(-w / 2 - 0.03, w / 2 + 0.03, h - 0.05, h, -dp / 2 - 0.03, dp / 2 + 0.03, pal.deskTop || '#c8c4bc', 1, null, GLOSS);
      for (let i = 0; i < hob; i++) {
        const x = (i % 2 ? -1 : 1) * 0.16 + (Math.floor(i / 2) - (Math.ceil(hob / 2) - 1) / 2) * 0.45, z = i % 2 ? 0.08 : -0.1, [u, v] = fr.P(x, 0, z);
        K.lathe(u, v, [[0.12, h + 0.002], [0.12, h + 0.012], [0, h + 0.012]], '#121314', 1, 16, METAL);
        K.lathe(u, v, [[0.07, h + 0.013], [0.075, h + 0.016], [0.065, h + 0.016]], '#ff5a20', 1.7, 16);
      }
      letterOn(K, fr, brandText(p.text, set), { y: h * 0.45, z: dp / 2 + 0.02, h: 0.14, maxW: w * 0.7, hex: brandColour(set, p) });
    },
  },
  wall: {
    label: 'Wall with a door or window', fields: [F('w', 'Width'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('door', 'Door at (across, blank for none)'), F('window', 'Window at (across, blank for none)'), F('open', 'Window open to a skyline behind (1)'), F('colour', 'Colour', 'text')],
    make: { at: [0, 0], yaw: 180, w: 4, h: 3, door: -1, window: 1 },
    draw(K, p, set) {
      const w = num(p.w, 4), h = num(p.h, 3), [fu, fv] = facingOf(p.yaw ?? 180), fr = K.frame(p.at[0], p.at[1], fu, fv), c = p.colour || set.palette?.wall || '#2a2d38', trim = set.palette?.trim || '#14161c';
      const holes = [];
      if (p.door !== '' && p.door != null && Number.isFinite(+p.door)) holes.push({ x: +p.door, w: 0.95, y0: 0, y1: 2.1, door: true });
      if (p.window !== '' && p.window != null && Number.isFinite(+p.window)) holes.push({ x: +p.window, w: 1.3, y0: 0.95, y1: 2.2 });
      holes.sort((a, b) => a.x - b.x);
      // the wall round its openings, in vertical strips
      let x = -w / 2;
      for (const o of holes) {
        const a = Math.max(-w / 2, o.x - o.w / 2), b = Math.min(w / 2, o.x + o.w / 2);
        if (a > x) fr.pbox(x, a, 0, h, -0.06, 0.06, c, 1, null, SATIN);
        if (o.y0 > 0) fr.pbox(a, b, 0, o.y0, -0.06, 0.06, c, 1, null, SATIN);
        fr.pbox(a, b, o.y1, h, -0.06, 0.06, c, 1, null, SATIN);
        // the frame round it
        fr.pbox(a - 0.06, a, o.y0, o.y1 + 0.06, -0.08, 0.08, trim, 1, null, SATIN);
        fr.pbox(b, b + 0.06, o.y0, o.y1 + 0.06, -0.08, 0.08, trim, 1, null, SATIN);
        fr.pbox(a - 0.06, b + 0.06, o.y1, o.y1 + 0.06, -0.08, 0.08, trim, 1, null, SATIN);
        if (o.door) {
          fr.pbox(a, b, 0, o.y1, -0.03, 0.0, set.palette?.door || '#4a3424', 1, null, SATIN);
          fr.pbox(a + 0.08, a + 0.14, 0.95, 1.0, 0, 0.05, '#b8a070', 1, null, METAL);
        } else {
          fr.pbox(a - 0.06, b + 0.06, o.y0 - 0.06, o.y0, -0.08, 0.12, trim, 1, null, SATIN);
          // what's outside: a lit night, through panes and a cross bar; `open` leaves the hole for a skyline behind
          if (!+p.open) fr.front(K.solid, a, b, o.y0, o.y1, -0.05, K.C(set.palette?.outside || '#20304a', 1.3), MAT.EMISSIVE);
          fr.pbox((a + b) / 2 - 0.02, (a + b) / 2 + 0.02, o.y0, o.y1, -0.04, 0.0, trim, 1, null, SATIN);
          fr.pbox(a, b, (o.y0 + o.y1) / 2 - 0.02, (o.y0 + o.y1) / 2 + 0.02, -0.04, 0.0, trim, 1, null, SATIN);
        }
        x = b;
      }
      if (x < w / 2) fr.pbox(x, w / 2, 0, h, -0.06, 0.06, c, 1, null, SATIN);
      fr.pbox(-w / 2, w / 2, 0, 0.12, 0.06, 0.08, trim, 1, null, SATIN);
    },
  },
  shelf: {
    label: 'Bookshelf', fields: [F('w', 'Width'), F('h', 'Height'), F('yaw', 'Facing (°)')],
    make: { at: [0, 0], yaw: 180, w: 1.2, h: 2 },
    draw(K, p, set) {
      const w = num(p.w, 1.2), h = num(p.h, 2), [fu, fv] = facingOf(p.yaw ?? 180), fr = K.frame(p.at[0], p.at[1], fu, fv), c = set.palette?.trim || '#3a2a1c';
      fr.pbox(-w / 2, w / 2, 0, h, -0.32, -0.28, c, 1, null, SATIN);
      for (const s of [-1, 1]) fr.pbox(s * w / 2 - 0.02, s * w / 2 + 0.02, 0, h, -0.32, 0, c, 1, null, SATIN);
      const rows = Math.max(2, Math.round(h / 0.42)), books = ['#6a2a24', '#2a3a5a', '#3a5a34', '#8a7a4a', '#4a2a4a', '#c0b090', '#2a2a2a'];
      for (let r = 0; r <= rows; r++) {
        const y = (h * r) / rows;
        fr.pbox(-w / 2, w / 2, y, y + 0.025, -0.3, 0, c, 1, null, SATIN);
        if (r === rows) break;
        for (let x = -w / 2 + 0.04, i = r * 7; x < w / 2 - 0.08; i++) {
          const bw = 0.03 + ((i * 37) % 5) * 0.008, bh = (h / rows) * (0.62 + ((i * 53) % 4) * 0.07);
          fr.pbox(x, x + bw, y + 0.025, y + 0.025 + bh, -0.26, -0.04, books[i % books.length], 1, null, CLOTH);
          x += bw + 0.004 + (i % 9 === 4 ? 0.12 : 0);
        }
      }
    },
  },
  bench: {
    label: 'Bench (a pew)', fields: [F('w', 'Width'), F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text')],
    make: { at: [0, 0], yaw: 180, w: 2.4 },
    draw(K, p, set) {
      const w = num(p.w, 2.4), [fu, fv] = facingOf(p.yaw ?? 180), fr = K.frame(p.at[0], p.at[1], fu, fv), c = p.colour || set.palette?.desk || '#4a3424';
      for (const s of [-1, 1]) fr.pbox(s * w / 2 - 0.05, s * w / 2 + 0.05, 0, 0.9, -0.24, 0.22, c, 0.9, null, SATIN);
      fr.pbox(-w / 2, w / 2, 0.42, 0.47, -0.2, 0.22, c, 1, null, SATIN);
      fr.pbox(-w / 2, w / 2, 0.47, 0.9, -0.24, -0.2, c, 1, null, SATIN);
    },
  },
  plinth: {
    label: 'Product plinth', fields: [F('h', 'Height'), F('r', 'Radius'), F('colour', 'Glow colour', 'text')],
    make: { at: [0, 0], h: 0.95, r: 0.36 },
    draw(K, p, set) {
      const h = num(p.h, 0.95), r = num(p.r, 0.36), c = brandColour(set, p), [u, v] = p.at;
      K.lathe(u, v, [[r + 0.04, 0], [r + 0.04, 0.06], [r * 0.8, 0.1], [r * 0.8, h - 0.06], [r, h - 0.03], [r, h], [0, h]], set.palette?.deskTop || '#e8e8ec', 1, 24, GLOSS);
      K.lathe(u, v, [[r + 0.005, h - 0.025], [r + 0.005, h - 0.01]], c, 2.2, 24);
      // the product itself, a can on a light
      K.lathe(u, v, [[0.07, h], [0.07, h + 0.22], [0.06, h + 0.235], [0, h + 0.235]], c, 1.15, 16, GLOSS);
    },
  },
  chair: {
    label: 'Anchor chair', fields: [F('yaw', 'Facing (°)'), F('seat', 'Seat height'), F('colour', 'Colour', 'text')],
    make: { at: [0, 0], yaw: 180, seat: 0.5 },
    draw(K, p, set) { chair(K, p, 0.98, set.palette || {}); },
  },
  sofa: {
    label: 'Sofa', fields: [F('yaw', 'Facing (°)'), F('w', 'Width'), F('colour', 'Colour', 'text')],
    make: { at: [0, 0], yaw: 180, w: 2.0 },
    draw(K, p, set) {
      const w = num(p.w, 2), [fu, fv] = facingOf(p.yaw ?? 180), { alongX, pbox } = K.frame(p.at[0], p.at[1], fu, fv), c = p.colour || set.palette?.sofa || '#5a2f38';
      pbox(-w / 2, w / 2, 0.06, 0.2, -0.42, 0.42, '#191512', 1, null, SATIN);
      K.rounded(...alongX(), -w / 2 + 0.1, w / 2 - 0.1, -0.4, 0.42, 0.2, 0.45, 0.07, c, 1, CLOTH);
      K.rounded(...alongX(0.1, 0.45), -w / 2 + 0.1, w / 2 - 0.1, -0.44, -0.2, 0.42, 0.92, 0.08, c, 1, CLOTH);
      for (const s of [-1, 1]) pbox(s * w / 2 - 0.13, s * w / 2 + 0.13, 0.2, 0.62, -0.44, 0.42, c, 1, null, CLOTH);
    },
  },
  armchair: {
    label: 'Armchair', fields: [F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text')],
    make: { at: [0, 0], yaw: 90 },
    draw(K, p, set) { SET_PIECES.sofa.draw(K, { ...p, w: 0.9 }, set); },
  },
  table: {
    label: 'Low table', fields: [F('r', 'Radius'), F('h', 'Height')],
    make: { at: [0, 0], r: 0.45, h: 0.42 },
    draw(K, p) { const r = num(p.r, 0.45), h = num(p.h, 0.42); K.lathe(p.at[0], p.at[1], [[0.2, 0], [0.04, 0.03], [0.04, h - 0.03], [r, h - 0.03], [r, h], [0, h]], '#26282e', 1, 24, GLOSS); },
  },
  riser: {
    label: 'Riser', fields: [F('r', 'Radius'), F('h', 'Height')],
    make: { at: [0, 0], r: 3, h: 0.16 },
    draw(K, p, set) {
      const r = num(p.r, 3), h = num(p.h, 0.16);
      K.lathe(p.at[0], p.at[1], [[r, 0], [r, h], [0, h]], set.palette?.riser || '#1a1d26', 1, 48, GLOSS);
      K.lathe(p.at[0], p.at[1], [[r + 0.015, h * 0.45], [r + 0.015, h * 0.7]], set.palette?.accent || '#39a0ff', 2.1, 48);
    },
  },
  flat: {
    label: 'Scenery flat', fields: [F('w', 'Width'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text')],
    make: { at: [0, 0], w: 3, h: 3, yaw: 180 },
    draw(K, p, set) {
      const w = num(p.w, 3), h = num(p.h, 3), [fu, fv] = facingOf(p.yaw ?? 180), { pbox } = K.frame(p.at[0], p.at[1], fu, fv);
      pbox(-w / 2, w / 2, 0, h, -0.06, 0.06, p.colour || set.palette?.wall || '#2a2d38', 1, null, SATIN);
    },
  },
  column: {
    label: 'Light column', fields: [F('h', 'Height')],
    make: { at: [0, 0], h: 3 },
    draw(K, p, set) {
      const h = num(p.h, 3), c = set.palette?.accent || '#39a0ff';
      K.box(p.at[0] - 0.12, p.at[0] + 0.12, p.at[1] - 0.12, p.at[1] + 0.12, 0, h, set.palette?.trim || '#14161c', 1, null, SATIN);
      K.box(p.at[0] - 0.04, p.at[0] + 0.04, p.at[1] - 0.13, p.at[1] - 0.12, 0.1, h - 0.1, c, 2.1);
    },
  },
  light_grid: {
    label: 'Lighting grid', fields: [F('y', 'Height'), F('w', 'Width'), F('depth', 'Depth')],
    make: { at: [0, 0], y: 3.6, w: 8, depth: 4 },
    draw(K, p) {
      const y = num(p.y, 3.6), w = num(p.w, 8), d = num(p.depth, 4), [u, v] = p.at, c = '#26282e';
      for (const dv of [-d / 2, 0, d / 2]) K.box(u - w / 2, u + w / 2, v + dv - 0.03, v + dv + 0.03, y, y + 0.06, c, 1, null, METAL);
      for (let du = -w / 2; du <= w / 2 + 0.01; du += w / 4) K.box(u + du - 0.03, u + du + 0.03, v - d / 2, v + d / 2, y, y + 0.06, c, 1, null, METAL);
      for (let du = -w / 2 + w / 8; du < w / 2; du += w / 4) for (const dv of [-d / 2, d / 2]) {
        K.lathe(u + du, v + dv, [[0.11, y - 0.3], [0.13, y - 0.1], [0, y - 0.04]], '#17181c', 1, 12, METAL);
        K.lathe(u + du, v + dv, [[0, y - 0.3], [0.1, y - 0.3]], '#ffeecc', 1.6, 12);
      }
    },
  },
  camera_ped: {
    label: 'Pedestal camera', fields: [F('yaw', 'Facing (°)')],
    make: { at: [0, 0], yaw: 0 },
    draw(K, p) {
      const [fu, fv] = facingOf(p.yaw), { pbox } = K.frame(p.at[0], p.at[1], fu, fv);
      K.lathe(p.at[0], p.at[1], [[0.34, 0.02], [0.34, 0.1], [0.07, 0.14], [0.05, 1.25], [0, 1.25]], '#2a2c32', 1, 16, METAL);
      pbox(-0.13, 0.13, 1.25, 1.5, -0.3, 0.25, '#17181c', 1, null, SATIN);
      pbox(-0.08, 0.08, 1.3, 1.45, 0.25, 0.45, '#0d0e11', 1, null, GLOSS);
      pbox(-0.04, 0.04, 1.51, 1.54, -0.02, 0.06, '#ff3030', 2);
    },
  },
  plant: {
    label: 'Plant', fields: [],
    make: { at: [0, 0] },
    draw(K, p) {
      K.lathe(p.at[0], p.at[1], [[0.16, 0], [0.2, 0.4], [0.17, 0.42], [0, 0.42]], '#2a2c30', 1, 14, SATIN);
      for (let i = 0; i < 5; i++) K.ball(p.at[0] + Math.sin(i * 2.4) * 0.14, p.at[1] + Math.cos(i * 2.4) * 0.14, 0.75 + i * 0.13, 0.2 - i * 0.015, '#2f5a38', 1, 8, CLOTH);
    },
  },
  skyline: {
    label: 'City skyline backdrop', fields: [F('w', 'Width'), F('h', 'Height'), F('y', 'Off the floor'), F('yaw', 'Facing (°)'), F('seed', 'Seed'), F('colour', 'Window colour', 'text')],
    make: { at: [0, 0], yaw: 180, w: 8, h: 3, y: 0.4, seed: 1 },
    draw(K, p, set) {
      const w = num(p.w, 8), h = num(p.h, 3), y = num(p.y, 0.4), [fu, fv] = facingOf(p.yaw ?? 180), fr = K.frame(p.at[0], p.at[1], fu, fv), pal = set.palette || {};
      const lit = p.colour || pal.windows || '#ffd890';
      let s = (num(p.seed, 1) * 9301 + 49297) | 0;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      // the night sky, then two rows of towers, the far row darker
      fr.front(K.solid, -w / 2, w / 2, y, y + h, 0, K.C(pal.sky || '#0c1830', 1.1), MAT.EMISSIVE);
      for (const [row, z, dim] of [[0, 0.02, 0.55], [1, 0.05, 1]]) {
        for (let x = -w / 2; x < w / 2 - 0.05;) {
          const bw = Math.min(w / 2 - x, 0.25 + rnd() * 0.55), bh = h * (row ? 0.18 + rnd() * 0.5 : 0.35 + rnd() * 0.55);
          fr.front(K.solid, x, x + bw, y, y + bh, z, K.C(pal.towers || '#05070c', dim), SATIN);
          for (let wy = y + 0.1; wy < y + bh - 0.08; wy += 0.11) for (let wx = x + 0.05; wx < x + bw - 0.06; wx += 0.09) {
            if (rnd() < (row ? 0.3 : 0.18)) fr.front(K.solid, wx, wx + 0.04, wy, wy + 0.05, z + 0.004, K.C(lit, row ? 1.7 : 1.2), MAT.EMISSIVE);
          }
          if (row && rnd() < 0.25) fr.front(K.solid, x + bw / 2 - 0.015, x + bw / 2 + 0.015, y + bh, y + bh + 0.18, z, K.C('#ff3030', 1.9), MAT.EMISSIVE);
          x += bw + (row ? 0.02 : 0);
        }
      }
      // the frame round it
      fr.pbox(-w / 2 - 0.08, w / 2 + 0.08, y - 0.08, y, -0.06, 0.08, pal.trim || '#14161c', 1, null, SATIN);
    },
  },
  monitors: {
    label: 'Monitor bank', fields: [F('cols', 'Across'), F('rows', 'High'), F('size', 'Screen width'), F('y', 'Off the floor'), F('yaw', 'Facing (°)')],
    make: { at: [0, 0], yaw: 180, cols: 3, rows: 2, size: 0.6, y: 0.9 },
    draw(K, p, set) {
      const cols = Math.max(1, Math.min(8, num(p.cols, 3) | 0)), rows = Math.max(1, Math.min(6, num(p.rows, 2) | 0)), sw = num(p.size, 0.6), sh = sw * 0.75, y = num(p.y, 0.9);
      const [fu, fv] = facingOf(p.yaw ?? 180), fr = K.frame(p.at[0], p.at[1], fu, fv), pal = set.palette || {}, W = cols * (sw + 0.04), tints = [brandColour(set, p), '#4a7ab0', '#2a3a5a', '#7ab0c0', '#1c2a40'];
      // the rack it stands on
      fr.pbox(-W / 2 - 0.05, W / 2 + 0.05, 0, y - 0.02, -0.3, 0.05, pal.trim || '#14161c', 1, null, METAL);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x0 = -W / 2 + c * (sw + 0.04) + 0.02, y0 = y + r * (sh + 0.04);
        fr.pbox(x0, x0 + sw, y0, y0 + sh, -0.28, 0, '#0b0c10', 1, null, GLOSS);
        fr.front(K.solid, x0 + 0.03, x0 + sw - 0.03, y0 + 0.03, y0 + sh - 0.03, 0.006, K.C(tints[(r * 3 + c * 2) % tints.length], 1.5), MAT.EMISSIVE);
        // a scan band across each picture
        fr.front(K.solid, x0 + 0.03, x0 + sw - 0.03, y0 + sh * 0.38, y0 + sh * 0.46, 0.008, K.C('#ffffff', 0.9), MAT.EMISSIVE);
      }
    },
  },
  curtain: {
    label: 'Curtain', fields: [F('w', 'Width'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text')],
    make: { at: [0, 0], yaw: 180, w: 2, h: 3.4 },
    draw(K, p, set) {
      const w = num(p.w, 2), h = num(p.h, 3.4), [fu, fv] = facingOf(p.yaw ?? 180), fr = K.frame(p.at[0], p.at[1], fu, fv), c = p.colour || set.palette?.curtain || '#4a1820';
      const n = Math.max(4, Math.round(w / 0.18));
      for (let i = 0; i < n; i++) {
        const x0 = -w / 2 + (w * i) / n, x1 = x0 + w / n, fold = i % 2;
        fr.pbox(x0, x1, 0.02, h, fold ? -0.02 : -0.1, fold ? 0.06 : -0.04, c, fold ? 1 : 0.72, null, CLOTH);
      }
      // the pelmet
      fr.pbox(-w / 2 - 0.05, w / 2 + 0.05, h, h + 0.22, -0.12, 0.1, set.palette?.trim || '#14161c', 1, null, SATIN);
    },
  },
  floor_lamp: {
    label: 'Floor lamp', fields: [F('h', 'Height'), F('colour', 'Shade colour', 'text')],
    make: { at: [0, 0], h: 1.6 },
    draw(K, p) {
      const h = num(p.h, 1.6), [u, v] = p.at;
      K.lathe(u, v, [[0.18, 0], [0.18, 0.03], [0.02, 0.05], [0.015, h - 0.25], [0, h - 0.25]], '#2a2a2e', 1, 14, METAL);
      K.lathe(u, v, [[0.24, h - 0.3], [0.13, h], [0, h]], p.colour || '#f0d8a0', 1.6, 18, CLOTH);
    },
  },
  rug: {
    label: 'Rug', fields: [F('w', 'Width'), F('depth', 'Depth'), F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text')],
    make: { at: [0, 0], yaw: 0, w: 3, depth: 2 },
    draw(K, p, set) {
      const w = num(p.w, 3), dp = num(p.depth, 2), [fu, fv] = facingOf(p.yaw ?? 0), { pbox } = K.frame(p.at[0], p.at[1], fu, fv), c = p.colour || set.palette?.rug || '#3a2430';
      pbox(-w / 2, w / 2, 0, 0.008, -dp / 2, dp / 2, set.palette?.accent || '#8a6a40', 0.8, null, CLOTH);
      pbox(-w / 2 + 0.1, w / 2 - 0.1, 0.008, 0.014, -dp / 2 + 0.1, dp / 2 - 0.1, c, 1, null, CLOTH);
    },
  },
  stairs: {
    label: 'Stairs', fields: [F('w', 'Width'), F('n', 'Steps'), F('yaw', 'Facing (°)')],
    make: { at: [0, 0], w: 1.2, n: 6, yaw: 90 },
    draw(K, p, set) {
      const n = num(p.n, 6), w = num(p.w, 1.2), [fu, fv] = facingOf(p.yaw ?? 90), { pbox } = K.frame(p.at[0], p.at[1], fu, fv);
      for (let i = 0; i < n; i++) pbox(-w / 2, w / 2, 0, 0.19 * (i + 1), -0.28 * (i + 1), -0.28 * i, set.palette?.trim || '#14161c', 1, null, SATIN);
    },
  },
  // ── The Tonight Show's pieces (set_tonight): their own file, set-tonight.js, given the lettering ──
  ...tonightPieces({ letterOn, brandText, letterWidth }),
  // ── A basement's pieces (first for You're Not Gonna Believe This Shit, set_neil_basement) ──
  dining_table: {
    label: 'Table', fields: [F('w', 'Width'), F('depth', 'Depth'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('colour', 'Top colour', 'text')],
    make: { at: [0, 0], yaw: 180, w: 1.3, depth: 0.8, h: 0.76 },
    draw(K, p, set) {
      const w = num(p.w, 1.3), dp = num(p.depth, 0.8), h = num(p.h, 0.76), [fu, fv] = facingOf(p.yaw ?? 180), { pbox } = K.frame(p.at[0], p.at[1], fu, fv);
      const top = p.colour || set.palette?.deskTop || '#6a5a44', leg = set.palette?.desk || '#3a2c20';
      pbox(-w / 2, w / 2, h - 0.04, h, -dp / 2, dp / 2, top, 1, null, SATIN);
      pbox(-w / 2 + 0.04, w / 2 - 0.04, h - 0.12, h - 0.04, -dp / 2 + 0.04, dp / 2 - 0.04, leg, 1, null, SATIN);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) pbox(sx * (w / 2 - 0.08) - 0.03, sx * (w / 2 - 0.08) + 0.03, 0, h - 0.04, sz * (dp / 2 - 0.08) - 0.03, sz * (dp / 2 - 0.08) + 0.03, leg, 1, null, SATIN);
    },
  },
  barstool: {
    label: 'Barstool', fields: [F('seat', 'Seat height'), F('colour', 'Seat colour', 'text')],
    make: { at: [0, 0], seat: 0.76 },
    draw(K, p) {
      const s = num(p.seat, 0.76), [u, v] = p.at;
      K.lathe(u, v, [[0.2, 0], [0.2, 0.025], [0.03, 0.04], [0.025, s - 0.06], [0, s - 0.06]], '#7a7c80', 1, 14, METAL);
      K.lathe(u, v, [[0.19, s * 0.4 - 0.012], [0.19, s * 0.4 + 0.012], [0.17, s * 0.4 + 0.012], [0.17, s * 0.4 - 0.012]], '#7a7c80', 1, 18, METAL);
      // the seat narrower than a hip, so it stays inside the coat of whoever's on it
      K.lathe(u, v, [[0.15, s - 0.07], [0.162, s - 0.02], [0.15, s], [0, s + 0.012]], p.colour || '#7a2a22', 1, 18, LEATHER);
    },
  },
  bulb: {
    label: 'Bare bulb on its cord', fields: [F('y', 'Bulb height'), F('top', 'Ceiling height')],
    make: { at: [0, 0], y: 2.0, top: 2.6 },
    draw(K, p) {
      const y = num(p.y, 2), top = num(p.top, 2.6), [u, v] = p.at;
      K.lathe(u, v, [[0.006, top], [0.006, y + 0.09], [0, y + 0.09]], '#1a1a1a', 1, 6, SATIN);
      K.lathe(u, v, [[0.022, y + 0.1], [0.022, y + 0.05], [0.016, y + 0.04], [0, y + 0.04]], '#3a3020', 1, 12, METAL);
      K.ball(u, v, y, 0.045, '#ffd890', 3.2, 12, MAT.EMISSIVE);
      // the pull-string, with its little bead
      K.lathe(u + 0.03, v, [[0.0025, y + 0.06], [0.0025, y - 0.32], [0, y - 0.32]], '#c8c0a8', 1, 4, CLOTH);
      K.ball(u + 0.03, v, y - 0.33, 0.009, '#c8c0a8', 1, 6, SATIN);
    },
  },
  joists: {
    label: 'Ceiling joists and a pipe', fields: [F('w', 'Width'), F('depth', 'Depth'), F('top', 'Ceiling height')],
    make: { at: [0, 4], w: 8, depth: 7, top: 2.6 },
    draw(K, p, set) {
      const w = num(p.w, 8), dp = num(p.depth, 7), top = num(p.top, 2.6), { pbox } = K.frame(p.at[0], p.at[1], 0, 1), c = set.palette?.trim || '#2a2420';
      for (let x = -w / 2 + 0.3; x < w / 2; x += 0.6) pbox(x - 0.04, x + 0.04, top - 0.22, top, -dp / 2, dp / 2, c, 1, null, SATIN);
      pbox(-w / 2, w / 2, top - 0.3, top - 0.24, 0.8 - 0.05, 0.8 + 0.05, '#4a4c4e', 1, null, METAL);
    },
  },
  payphone: {
    label: 'Payphone on the wall', fields: [F('yaw', 'Facing (°)'), F('y', 'Bottom off the floor')],
    make: { at: [0, 0], yaw: 180, y: 1.05 },
    draw(K, p) {
      const y = num(p.y, 1.05), [fu, fv] = facingOf(p.yaw ?? 180), { pbox } = K.frame(p.at[0], p.at[1], fu, fv);
      pbox(-0.17, 0.17, y, y + 0.56, -0.02, 0.1, '#8a9096', 1, null, METAL);
      pbox(-0.13, 0.13, y + 0.38, y + 0.5, 0.1, 0.105, '#1a2a3a', 1, null, GLOSS);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) pbox(-0.06 + c * 0.05 - 0.016, -0.06 + c * 0.05 + 0.016, y + 0.12 + r * 0.055, y + 0.15 + r * 0.055, 0.1, 0.112, '#d8d8d0', 1, null, METAL);
      pbox(0.09, 0.13, y + 0.28, y + 0.33, 0.1, 0.11, '#2a2a2a', 1, null, METAL);
      // the handset on its hook, and the steel cord
      pbox(-0.2, -0.15, y + 0.06, y + 0.5, 0.06, 0.13, '#1c1c1e', 1, null, GLOSS);
      pbox(-0.205, -0.145, y + 0.44, y + 0.52, 0.05, 0.14, '#1c1c1e', 1, null, GLOSS);
      pbox(-0.205, -0.145, y + 0.04, y + 0.12, 0.05, 0.14, '#1c1c1e', 1, null, GLOSS);
      pbox(-0.185, -0.17, y - 0.12, y + 0.06, 0.07, 0.085, '#9aa0a6', 1, null, METAL);
    },
  },
  corkboard: {
    label: 'Corkboard with yarn', fields: [F('w', 'Width'), F('h', 'Height'), F('y', 'Bottom off the floor'), F('yaw', 'Facing (°)')],
    make: { at: [0, 0], yaw: 180, w: 1.8, h: 1.1, y: 0.9 },
    draw(K, p) {
      const w = num(p.w, 1.8), h = num(p.h, 1.1), y = num(p.y, 0.9), [fu, fv] = facingOf(p.yaw ?? 180), { pbox, P, N } = K.frame(p.at[0], p.at[1], fu, fv);
      pbox(-w / 2 - 0.04, w / 2 + 0.04, y - 0.04, y + h + 0.04, -0.03, 0.02, '#4a3020', 1, null, SATIN);
      pbox(-w / 2, w / 2, y, y + h, 0.02, 0.025, '#b88a58', 1, null, CLOTH);
      // the clippings, photos and printouts, pinned up wherever they fitted; a few of them photos
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const pins = [];
      for (let i = 0; i < 18; i++) {
        const cx = (rnd() - 0.5) * (w - 0.24), cy = y + 0.12 + rnd() * (h - 0.26), pw = 0.07 + rnd() * 0.07, ph = 0.08 + rnd() * 0.07, photo = rnd() < 0.4;
        pbox(cx - pw, cx + pw, cy - ph, cy + ph, 0.025, 0.03 + i * 0.0004, photo ? (rnd() < 0.5 ? '#5a6a7a' : '#7a5a4a') : (rnd() < 0.3 ? '#e8d870' : '#e8e4d8'), 1, null, CLOTH);
        if (photo) pbox(cx - pw * 0.4, cx + pw * 0.4, cy - ph * 0.1, cy + ph * 0.6, 0.0305 + i * 0.0004, 0.031 + i * 0.0004, '#d8b898', 1, null, CLOTH);
        pins.push([cx, cy + ph - 0.015]);
        K.ball(...P(cx, cy + ph - 0.015, 0.04), 0.008, i % 3 ? '#c82020' : '#2040c8', 1.2, 6, GLOSS);
      }
      // the red yarn, pin to pin: a thin strip each, standing a hair off the paper
      const n = N(0, 0, 1);
      for (const [a, b] of [[0, 5], [5, 9], [9, 2], [2, 14], [14, 7], [7, 0], [3, 11], [11, 16], [16, 5], [6, 12], [12, 9], [1, 13], [13, 17], [17, 4], [8, 15], [15, 10]]) {
        const [x0, y0] = pins[a], [x1, y1] = pins[b], L = Math.hypot(x1 - x0, y1 - y0) || 1, ox = -(y1 - y0) / L * 0.0035, oy = (x1 - x0) / L * 0.0035;
        K.quad(K.solid, [P(x0 - ox, y0 - oy, 0.036), P(x1 - ox, y1 - oy, 0.036), P(x1 + ox, y1 + oy, 0.036), P(x0 + ox, y0 + oy, 0.036)], n, K.C('#c81818', 1.1), CLOTH);
      }
    },
  },
  red_button: {
    label: 'Big red button on the wall', fields: [F('yaw', 'Facing (°)'), F('y', 'Height off the floor')],
    make: { at: [0, 0], yaw: 90, y: 1.3 },
    draw(K, p) {
      const y = num(p.y, 1.3), [fu, fv] = facingOf(p.yaw ?? 90), { pbox, P } = K.frame(p.at[0], p.at[1], fu, fv);
      pbox(-0.13, 0.13, y - 0.13, y + 0.13, -0.01, 0.03, '#e8c020', 1, null, SATIN);
      for (let i = -3; i <= 3; i++) pbox(i * 0.036 - 0.009, i * 0.036 + 0.009, y - 0.13, y - 0.1, 0.03, 0.032, '#141414', 1, null, SATIN);
      for (let i = -3; i <= 3; i++) pbox(i * 0.036 - 0.009, i * 0.036 + 0.009, y + 0.1, y + 0.13, 0.03, 0.032, '#141414', 1, null, SATIN);
      pbox(-0.075, 0.075, y - 0.075, y + 0.075, 0.03, 0.05, '#2a2a2a', 1, null, METAL);
      const c = P(0, y, 0.05);
      K.ball(c[0], c[1], c[2], 0.058, '#d81818', 1.4, 14, GLOSS);
    },
  },
  can_wall: {
    label: 'Wall of empty cans and takeaway', fields: [F('w', 'Width'), F('h', 'Height'), F('yaw', 'Facing (°)')],
    make: { at: [0, 0], yaw: 180, w: 1.6, h: 1.2 },
    draw(K, p) {
      const w = num(p.w, 1.6), h = num(p.h, 1.2), [fu, fv] = facingOf(p.yaw ?? 180), { pbox, P } = K.frame(p.at[0], p.at[1], fu, fv);
      const cans = ['#c8c8cc', '#2a5aa8', '#c82820', '#e8c030', '#2a7a3a', '#d8d8d8', '#8a1a1a'];
      let seed = 3;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      // a heap: rows narrowing as they go up, with the takeaway boxes jammed in
      for (let row = 0, y = 0; y < h; row++, y += 0.125) {
        const half = (w / 2) * (1 - 0.55 * (y / h)) + (rnd() - 0.5) * 0.08;
        for (let x = -half + 0.04 + (row % 2) * 0.035; x < half - 0.04; x += 0.07) {
          const z = -0.15 + rnd() * 0.3 - y * 0.12;
          if (rnd() < 0.14) { pbox(x - 0.07, x + 0.07, y, y + 0.08, z - 0.06, z + 0.06, rnd() < 0.5 ? '#e8e0d0' : '#c84a2a', 1, null, CLOTH); x += 0.06; continue; }
          const q = P(x, 0, z), col = cans[Math.floor(rnd() * cans.length)];
          if (rnd() < 0.2) { pbox(x - 0.06, x + 0.06, y, y + 0.066, z - 0.033, z + 0.033, col, 1, null, METAL); continue; }   // one on its side
          K.lathe(q[0], q[1], [[0.031, y], [0.033, y + 0.01], [0.033, y + 0.11], [0.026, y + 0.122], [0, y + 0.122]], col, 1, 8, METAL);
        }
      }
    },
  },
  old_mic: {
    label: 'Old microphone on a stand', fields: [F('y', 'Stood on (height)'), F('yaw', 'Facing (°)')],
    make: { at: [0, 0], y: 0.76, yaw: 180 },
    draw(K, p) {
      const y = num(p.y, 0.76), [u, v] = p.at, [fu, fv] = facingOf(p.yaw ?? 180), { pbox } = K.frame(u, v, fu, fv);
      K.lathe(u, v, [[0.075, y], [0.075, y + 0.015], [0.02, y + 0.03], [0.01, y + 0.03], [0.01, y + 0.24], [0, y + 0.24]], '#2a2a2c', 1, 16, METAL);
      // the capsule in its ring, a 1930s ribbon mic: a rounded slab, grille on the face
      K.rounded(...K.frame(u, v, fu, fv).alongX(), -0.045, 0.045, -0.025, 0.025, y + 0.24, y + 0.38, 0.02, '#b8b8bc', 1.1, METAL);
      for (let i = 0; i < 6; i++) pbox(-0.035, 0.035, y + 0.26 + i * 0.019, y + 0.268 + i * 0.019, 0.025, 0.028, '#3a3a3c', 1, null, METAL);
    },
  },
  ashtray: {
    label: 'Ashtray', fields: [F('y', 'Stood on (height)')],
    make: { at: [0, 0], y: 0.76 },
    draw(K, p) {
      const y = num(p.y, 0.76), [u, v] = p.at;
      K.lathe(u, v, [[0.07, y], [0.08, y + 0.03], [0.07, y + 0.03], [0.055, y + 0.012], [0, y + 0.012]], '#8a7a58', 1, 16, GLOSS);
      for (let i = 0; i < 7; i++) { const a = i * 2.1, r = 0.03 + (i % 3) * 0.008; K.lathe(u + Math.cos(a) * r, v + Math.sin(a) * r, [[0.006, y + 0.012], [0.006, y + 0.02], [0, y + 0.02]], i % 2 ? '#e8e0c8' : '#c89060', 1, 6, CLOTH); }
    },
  },
  // ── An 80s den's pieces ──
  panelling: {
    label: 'Wood panelling on a wall', fields: [F('w', 'Width'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text')],
    make: { at: [0, 0], yaw: 180, w: 4, h: 2.4 },
    draw(K, p) {
      const w = num(p.w, 4), h = num(p.h, 2.4), [fu, fv] = facingOf(p.yaw ?? 180), { pbox } = K.frame(p.at[0], p.at[1], fu, fv), c = p.colour || '#6a4428';
      pbox(-w / 2, w / 2, 0, h, -0.02, 0, c, 1, null, SATIN);
      // the grooves between the boards, and the grain's darker streaks
      for (let x = -w / 2 + 0.2; x < w / 2; x += 0.2) pbox(x - 0.006, x + 0.006, 0, h, 0, 0.002, '#2a180c', 1, null, SATIN);
      for (let x = -w / 2 + 0.07, i = 0; x < w / 2; x += 0.2, i++) if (i % 3 !== 1) pbox(x - 0.012, x + 0.012, 0.1 + (i % 4) * 0.2, h - 0.15 - (i % 5) * 0.12, 0, 0.0015, '#553420', 1, null, SATIN);
      // the dado rail and the skirting
      pbox(-w / 2, w / 2, 0.9, 0.95, 0, 0.02, '#4a2c18', 1, null, SATIN);
      pbox(-w / 2, w / 2, 0, 0.1, 0, 0.018, '#3a2214', 1, null, SATIN);
    },
  },
  coffee_table: {
    label: 'Coffee table', fields: [F('w', 'Width'), F('depth', 'Depth'), F('h', 'Height'), F('yaw', 'Facing (°)')],
    make: { at: [0, 0], yaw: 180, w: 1.2, depth: 0.6, h: 0.42 },
    draw(K, p) {
      const w = num(p.w, 1.2), dp = num(p.depth, 0.6), h = num(p.h, 0.42), [fu, fv] = facingOf(p.yaw ?? 180), { pbox } = K.frame(p.at[0], p.at[1], fu, fv);
      pbox(-w / 2, w / 2, h - 0.05, h, -dp / 2, dp / 2, '#5a3a20', 1, null, GLOSS);
      pbox(-w / 2 + 0.06, w / 2 - 0.06, 0.08, 0.11, -dp / 2 + 0.06, dp / 2 - 0.06, '#4a2e18', 1, null, SATIN);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) pbox(sx * (w / 2 - 0.05) - 0.03, sx * (w / 2 - 0.05) + 0.03, 0, h - 0.05, sz * (dp / 2 - 0.05) - 0.03, sz * (dp / 2 - 0.05) + 0.03, '#3a2414', 1, null, SATIN);
      // ring stains, and a magazine
      pbox(-w / 2 + 0.1, -w / 2 + 0.36, h, h + 0.006, 0.02, 0.22, '#c8402a', 1, null, GLOSS);
    },
  },
  bong: {
    label: 'Bong', fields: [F('y', 'Stood on (height)'), F('h', 'Tall'), F('colour', 'Glass colour', 'text')],
    make: { at: [0, 0], y: 0.42, h: 0.42 },
    draw(K, p) {
      const y = num(p.y, 0.42), h = num(p.h, 0.42), [u, v] = p.at, c = p.colour || '#3aa878';
      // a beaker base, a long neck with a lip, half full of murky water
      K.lathe(u, v, [[0.06, y], [0.065, y + 0.02], [0.065, y + 0.07], [0.028, y + 0.13], [0.022, y + h - 0.02], [0.03, y + h], [0.026, y + h]], c, 1.2, 16, GLOSS);
      K.lathe(u, v, [[0.058, y + 0.005], [0.06, y + 0.055], [0, y + 0.055]], '#4a5a2a', 0.9, 14, GLOSS);
      // the downstem and bowl, off to one side
      const a = 0.6, du = Math.cos(a) * 0.06, dv = Math.sin(a) * 0.06;
      K.lathe(u + du, v + dv, [[0.008, y + 0.05], [0.008, y + 0.13], [0, y + 0.13]], '#c8c8c0', 1, 6, GLOSS);
      K.lathe(u + du * 1.25, v + dv * 1.25, [[0.006, y + 0.13], [0.018, y + 0.155], [0.02, y + 0.165], [0, y + 0.165]], '#c8c8c0', 1, 10, GLOSS);
    },
  },
  bottles: {
    label: 'Beer bottles', fields: [F('y', 'Stood on (height)'), F('n', 'How many'), F('r', 'Spread')],
    make: { at: [0, 0], y: 0.42, n: 7, r: 0.22 },
    draw(K, p) {
      const y = num(p.y, 0.42), n = Math.min(24, num(p.n, 7)), r = num(p.r, 0.22), [u, v] = p.at;
      let seed = 11 + n;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < n; i++) {
        const a = rnd() * 6.283, d = Math.sqrt(rnd()) * r, bu = u + Math.cos(a) * d, bv = v + Math.sin(a) * d, col = rnd() < 0.7 ? '#5a3010' : '#2a5a20';
        if (rnd() < 0.25) {   // one on its side
          const { pbox } = K.frame(bu, bv, Math.sin(a), Math.cos(a));
          pbox(-0.032, 0.032, y, y + 0.064, -0.1, 0.08, col, 1, null, GLOSS);
          pbox(-0.013, 0.013, y + 0.019, y + 0.045, 0.08, 0.15, col, 1, null, GLOSS);
          continue;
        }
        K.lathe(bu, bv, [[0.031, y], [0.033, y + 0.01], [0.033, y + 0.14], [0.014, y + 0.19], [0.013, y + 0.235], [0.016, y + 0.24], [0, y + 0.24]], col, 1.1, 10, GLOSS);
        K.lathe(bu, bv, [[0.0335, y + 0.05], [0.0335, y + 0.11], [0, y + 0.11]], rnd() < 0.5 ? '#e8d8a0' : '#d84030', 1, 10, CLOTH);
      }
    },
  },
  pizza_box: {
    label: 'Pizza box', fields: [F('y', 'Stood on (height)'), F('yaw', 'Turn (°)'), F('open', 'Open (1 or 0)')],
    make: { at: [0, 0], y: 0.42, yaw: 170, open: 1 },
    draw(K, p) {
      const y = num(p.y, 0.42), [fu, fv] = facingOf(p.yaw ?? 170), { pbox } = K.frame(p.at[0], p.at[1], fu, fv);
      pbox(-0.2, 0.2, y, y + 0.04, -0.2, 0.2, '#c8a878', 1, null, CLOTH);
      if (num(p.open, 1)) {
        pbox(-0.18, 0.18, y + 0.04, y + 0.045, -0.18, 0.18, '#d8a040', 1, null, CLOTH);
        // two slices left, and the lid stood up behind
        pbox(-0.16, -0.02, y + 0.045, y + 0.055, -0.16, -0.02, '#c84020', 1, null, CLOTH);
        pbox(0.02, 0.15, y + 0.045, y + 0.055, -0.15, -0.03, '#c84020', 1, null, CLOTH);
        pbox(-0.2, 0.2, y + 0.04, y + 0.44, -0.22, -0.2, '#c8a878', 1, null, CLOTH);
      }
    },
  },
  crt_tv: {
    label: 'Old television in a wood cabinet', fields: [F('yaw', 'Facing (°)'), F('w', 'Width')],
    make: { at: [0, 0], yaw: 180, w: 0.9 },
    draw(K, p) {
      const w = num(p.w, 0.9), [fu, fv] = facingOf(p.yaw ?? 180), { pbox } = K.frame(p.at[0], p.at[1], fu, fv), h = w * 0.9;
      pbox(-w / 2, w / 2, 0, h, -0.5, 0, '#6a4428', 1, null, SATIN);
      pbox(-w / 2 + 0.03, w / 2 - 0.03, 0.02, 0.1, -0.48, 0.005, '#3a2414', 1, null, SATIN);
      pbox(-w / 2 + 0.06, w / 2 - 0.2, 0.18, h - 0.08, 0, 0.012, '#1a1a1a', 1, null, GLOSS);
      // the picture: snow and a blue cast, faintly lit
      pbox(-w / 2 + 0.09, w / 2 - 0.23, 0.21, h - 0.11, 0.012, 0.016, '#3a5a8a', 1.6, null, MAT.EMISSIVE);
      // the knobs and the speaker grille down the right
      for (let i = 0; i < 2; i++) { const c = K.frame(p.at[0], p.at[1], fu, fv).P(w / 2 - 0.1, h - 0.2 - i * 0.12, 0.02); K.ball(c[0], c[1], c[2], 0.022, '#c8c0a8', 1, 8, METAL); }
      for (let i = 0; i < 8; i++) pbox(w / 2 - 0.17, w / 2 - 0.04, 0.2 + i * 0.03, 0.212 + i * 0.03, 0, 0.008, '#2a1a0c', 1, null, SATIN);
      // rabbit ears on top
      pbox(-0.05, 0.05, h, h + 0.04, -0.3, -0.2, '#2a2a2a', 1, null, METAL);
      for (const s of [-1, 1]) for (let k = 0; k < 6; k++) { const x = s * (0.03 + k * 0.025); pbox(x - 0.005, x + 0.005, h + 0.04 + k * 0.06, h + 0.1 + k * 0.06, -0.255, -0.245, '#c8c8c8', 1, null, METAL); }
    },
  },
  lava_lamp: {
    label: 'Lava lamp', fields: [F('y', 'Stood on (height)'), F('colour', 'Lava colour', 'text')],
    make: { at: [0, 0], y: 0 },
    draw(K, p) {
      const y = num(p.y, 0), [u, v] = p.at, c = p.colour || '#ff5a20';
      K.lathe(u, v, [[0.06, y], [0.07, y + 0.02], [0.04, y + 0.12], [0, y + 0.12]], '#c8c8cc', 1, 14, METAL);
      K.lathe(u, v, [[0.04, y + 0.12], [0.06, y + 0.28], [0.03, y + 0.42], [0, y + 0.42]], '#ffc070', 1.8, 14, GLOSS);
      K.lathe(u, v, [[0.03, y + 0.42], [0.022, y + 0.47], [0, y + 0.47]], '#c8c8cc', 1, 12, METAL);
      for (const [dy, r] of [[0.17, 0.028], [0.26, 0.02], [0.34, 0.016]]) K.ball(u, v, y + dy, r, c, 2.4, 10, MAT.EMISSIVE);
    },
  },
  dartboard: {
    label: 'Dartboard', fields: [F('yaw', 'Facing (°)'), F('y', 'Centre height')],
    make: { at: [0, 0], yaw: 90, y: 1.73 },
    draw(K, p) {
      const y = num(p.y, 1.73), [fu, fv] = facingOf(p.yaw ?? 90), { P, N } = K.frame(p.at[0], p.at[1], fu, fv), n = N(0, 0, 1);
      // rings of segments, black and cream, the doubles and trebles red and green
      const ring = (r0, r1, z, colOf) => arc(20, 0, Math.PI * 2, (a, b) => {
        const i = Math.round(a / (Math.PI / 10)), col = K.C(colOf(i));
        K.quad(K.solid, [P(Math.cos(a) * r0, y + Math.sin(a) * r0, z), P(Math.cos(b) * r0, y + Math.sin(b) * r0, z), P(Math.cos(b) * r1, y + Math.sin(b) * r1, z), P(Math.cos(a) * r1, y + Math.sin(a) * r1, z)], n, col, SATIN);
      });
      ring(0.2, 0.24, 0.01, () => '#1a1a1a');
      ring(0.17, 0.2, 0.012, (i) => (i % 2 ? '#c82020' : '#208a3a'));
      ring(0.11, 0.17, 0.012, (i) => (i % 2 ? '#1a1a1a' : '#e8dcc0'));
      ring(0.095, 0.11, 0.012, (i) => (i % 2 ? '#c82020' : '#208a3a'));
      ring(0.02, 0.095, 0.012, (i) => (i % 2 ? '#1a1a1a' : '#e8dcc0'));
      ring(0, 0.02, 0.013, () => '#c82020');
      // two darts in it, nowhere near the middle
      for (const [dx, dy] of [[0.13, 0.15], [-0.18, -0.07]]) { const a = P(dx, y + dy, 0.012), b = P(dx + 0.01, y + dy + 0.02, 0.12); K.lathe(a[0], a[1], [[0.003, a[2]], [0.003, b[2] + 0.02], [0, b[2] + 0.02]], '#e8c020', 1, 6, METAL); }
    },
  },
  poster: {
    label: 'Framed 80s poster', fields: [F('yaw', 'Facing (°)'), F('w', 'Width'), F('y', 'Bottom off the floor')],
    make: { at: [0, 0], yaw: 180, w: 0.8, y: 1.2 },
    draw(K, p) {
      const w = num(p.w, 0.8), h = w * 1.3, y = num(p.y, 1.2), [fu, fv] = facingOf(p.yaw ?? 180), { pbox } = K.frame(p.at[0], p.at[1], fu, fv);
      pbox(-w / 2 - 0.03, w / 2 + 0.03, y - 0.03, y + h + 0.03, -0.02, 0.01, '#141414', 1, null, GLOSS);
      // a sunset in bands over a grid, and a low wedge of a sports car in silhouette
      const bands = ['#2a1050', '#6a1a7a', '#c8306a', '#f06a40', '#f8b040'];
      bands.forEach((c, i) => pbox(-w / 2, w / 2, y + h * (0.45 + i * 0.11), y + h * (0.56 + i * 0.11), 0.01, 0.012, c, 1.3, null, SATIN));
      pbox(-w * 0.22, w * 0.22, y + h * 0.5, y + h * 0.72, 0.012, 0.014, '#ffd060', 1.4, null, SATIN);
      pbox(-w / 2, w / 2, y, y + h * 0.45, 0.01, 0.012, '#120820', 1, null, SATIN);
      for (let i = 1; i < 6; i++) pbox(-w / 2, w / 2, y + h * 0.45 * (i / 6) ** 1.6, y + h * 0.45 * (i / 6) ** 1.6 + 0.004, 0.012, 0.014, '#e040c0', 1.5, null, SATIN);
      pbox(-w * 0.36, w * 0.36, y + h * 0.2, y + h * 0.27, 0.014, 0.016, '#0a0a0a', 1, null, GLOSS);
      pbox(-w * 0.2, w * 0.12, y + h * 0.27, y + h * 0.32, 0.014, 0.016, '#0a0a0a', 1, null, GLOSS);
    },
  },
  // ── A booth's wall of screens (first for the KSAB booth: the weather, Raptor News) ──
  // A big main screen, a tall one either side, a ticker under the main one and the brand along the top, in a
  // truss with lit seams. All five show the live picture as one texture, each its cell of the atlas that
  // gl/screen-bank.js paints, so a show says what each screen shows (`screens` on the set, sequence or beat).
  screen_bank: {
    label: 'Bank of screens (booth)', fields: [F('w', 'Width'), F('y', 'Off the floor'), F('yaw', 'Facing (°)'), F('colour', 'Seam colour', 'text')],
    make: { at: [0, 0], yaw: 180, w: 8.4, y: 0.3 },
    draw(K, p, set, out) {
      const w = num(p.w, 8.4), s = w / 8.4, y0 = num(p.y, 0.3), [fu, fv] = facingOf(p.yaw ?? 180), { pbox, front } = K.frame(p.at[0], p.at[1], fu, fv);
      const seam = brandColour(set, p), frameC = set.palette?.trim || '#101218';
      const S = {
        main: [-2.6, 2.6, 0.5, 3.35], left: [2.75, 4.2, 0.6, 3.1], right: [-4.2, -2.75, 0.6, 3.1],
        ticker: [-2.6, 2.6, 0.12, 0.44], header: [-4.2, 4.2, 3.5, 3.8],
      };
      // the truss they hang in, and each screen's bezel standing proud of it
      pbox(-4.38 * s, 4.38 * s, y0 - 0.08 * s, y0 + 3.96 * s, -0.34, -0.16, frameC, 1, null, SATIN);
      for (const k of [-1, 1]) pbox(k * 4.38 * s - 0.08, k * 4.38 * s + 0.08, 0, y0 + 3.96 * s, -0.36, -0.12, frameC, 0.9, null, METAL);
      for (const [x0, x1, a, b] of Object.values(S)) pbox(x0 * s - 0.05, x1 * s + 0.05, y0 + a * s - 0.05, y0 + b * s + 0.05, -0.16, 0.006, '#07080b', 1, null, GLOSS);
      // the lit seams between them
      for (const x of [2.675, -2.675]) pbox(x * s - 0.012, x * s + 0.012, y0 + 0.5 * s, y0 + 3.35 * s, -0.15, 0.004, seam, 1.8, null, MAT.EMISSIVE);
      pbox(-4.2 * s, 4.2 * s, y0 + 3.42 * s - 0.01, y0 + 3.42 * s + 0.01, -0.15, 0.004, seam, 1.8, null, MAT.EMISSIVE);
      // the pictures: one stretch of the screen batch, each its own cell of the atlas
      const [AW, AH] = BANK_ATLAS, one = [1, 1, 1], first = K.screen.n;
      for (const [name, [x0, x1, a, b]] of Object.entries(S)) {
        const [cx, cy, cw, ch] = BANK_CELLS[name], u0 = cx / AW, v0 = cy / AH, u1 = (cx + cw) / AW, v1 = (cy + ch) / AH;
        front(K.screen, x0 * s, x1 * s, y0 + a * s, y0 + b * s, 0.008, one, GLOW, [[u1, v1], [u0, v1], [u0, v0], [u1, v0]]);
      }
      if (!out.wall) out.wall = { first, count: K.screen.n - first, aspect: AW / AH, bank: true };
    },
  },
  // ── Pieces for a set shot on location (the adverts inside Neil's show first): their own file, set-location.js ──
  ...locationPieces(),
  // ── Pieces for a set that is a playing court (the Slagball arena first): set-court.js ──
  ...courtPieces(),
  // ── Pieces for a plain hall (the Ashway Civic Hall first): set-hall.js ──
  ...hallPieces(),
  // ── Pieces for a film's stock sets (set_film_*): set-film.js ──
  ...filmPieces(),
  // ── Pieces for a transmitter's control room (the Quiet Hour first): set-control.js ──
  ...controlPieces({ letterOn, brandText }),
  // ── Pieces for a church (a Sunday service's chapel first): set-church.js ──
  ...churchPieces({ letterOn, brandText }),
});

// The batches for gl/room.js's setRoom, the lamps, and where the wall's picture is.
export function buildSet(set) {
  const K = roomKit(SET_FRAME, bakeFor(set), { textures: {}, cell: 0.5, glow: GLOW });
  const w = set.room?.w || 10, d = set.room?.d || 8, h = set.room?.h || 4, hu = w / 2, pal = set.palette || {}, T = 0.12;
  const out = { wall: null };
  K.box(-hu - T, hu + T, -2, d + T, -0.2, 0, pal.floor || '#1c2a24', 1, null, GLOSS);
  K.box(-hu - T, hu + T, d, d + T, 0, h, pal.wall || '#14161e', 1, null, SATIN);
  K.box(-hu - T, -hu, -2, d, 0, h, pal.wall || '#14161e', 1, null, SATIN);
  K.box(hu, hu + T, -2, d, 0, h, pal.wall || '#14161e', 1, null, SATIN);
  K.box(-hu - T, hu + T, -2, d + T, h, h + 0.1, pal.ceiling || '#0a0b0e');
  K.box(-hu - T, hu + T, -2.1, -2, 0, h, pal.wall || '#14161e', 1, null, SATIN);
  if (pal.line) K.box(-0.05, 0.05, -2, d, 0.001, 0.004, pal.line, 1);
  for (const p of set.pieces || []) {
    const row = SET_PIECES[p.type];
    if (row) row.draw(K, p, set, out);
  }
  const room = { solid: K.solid, screen: K.screen, glass: createBatch(1), view: createBatch(1), textured: K.textured };
  const lamps = (set.lamps?.length ? set.lamps : [{ p: [0, h - 0.4, d * 0.4] }]).slice(0, 6).map((l) => ({ p: SET_FRAME.world(l.p[0], l.p[2], l.p[1]), k: l.k ?? 1 }));
  return { room, lamps, wall: out.wall };
}
