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
      // the network's panel on the front
      arc(8, -0.11 * 3.4 / R, 0.11 * 3.4 / R, (a, b) => K.quad(K.solid, [at(a, R + 0.045, 0.2), at(b, R + 0.045, 0.2), at(b, R + 0.045, h - 0.16), at(a, R + 0.045, h - 0.16)], out((a + b) / 2), glow, MAT.EMISSIVE, null, true));
    },
  },
  desk_straight: {
    label: 'Straight desk', fields: [F('w', 'Width'), F('depth', 'Depth'), F('h', 'Height')],
    make: { at: [0, 0], w: 2.2, depth: 0.8, h: 0.78, yaw: 0 },
    draw(K, p, set) {
      const w = num(p.w, 2.2), dp = num(p.depth, 0.8), h = num(p.h, 0.78), [fu, fv] = facingOf(p.yaw ?? 180), { pbox } = K.frame(p.at[0], p.at[1], fu, fv), pal = set.palette || {};
      pbox(-w / 2, w / 2, 0, h - 0.05, -dp / 2, dp / 2, pal.desk || '#3a2a20', 1, null, SATIN);
      pbox(-w / 2 - 0.05, w / 2 + 0.05, h - 0.05, h, -dp / 2 - 0.05, dp / 2 + 0.05, pal.deskTop || '#6a4a30', 1, null, GLOSS);
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
  stairs: {
    label: 'Stairs', fields: [F('w', 'Width'), F('n', 'Steps'), F('yaw', 'Facing (°)')],
    make: { at: [0, 0], w: 1.2, n: 6, yaw: 90 },
    draw(K, p, set) {
      const n = num(p.n, 6), w = num(p.w, 1.2), [fu, fv] = facingOf(p.yaw ?? 90), { pbox } = K.frame(p.at[0], p.at[1], fu, fv);
      for (let i = 0; i < n; i++) pbox(-w / 2, w / 2, 0, 0.19 * (i + 1), -0.28 * (i + 1), -0.28 * i, set.palette?.trim || '#14161c', 1, null, SATIN);
    },
  },
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
