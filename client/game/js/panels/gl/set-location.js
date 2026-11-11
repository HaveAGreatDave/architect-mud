// GLASS 2 · PIECES FOR A SET SHOT "ON LOCATION". Rows for set-mesh.js's SET_PIECES, first for the two
// adverts inside You're Not Gonna Believe This Shit (set_neil_ad_*): a painted sky with hills or sea,
// trees and palms, a park's swings, slide, bench and lamp, a cruiser motorcycle, a roadster with its top
// down, a coast road, a beach's umbrella, towels, board and lifeguard tower, and a sad man's kitchen.
// Each row is a label, its fields and a `draw(K, p, set)` built from the room kit (room-kit.js), in
// metres. Nothing here names a show or an advert.
//
// The kit here adds four things to K's boxes and lathes: a piece frame that can lean (a bike on its
// stand), a loft (rounded sections joined along an axis: a car's body, a tank, a seat), a spin (a
// profile turned round any of the frame's axes: a tyre, a lamp, a pipe's end) and a tube between two
// points. Faces aren't culled (gl/room.js), so winding never matters.
//
// ⚠ A PIECE'S +x IS THE VIEWER'S LEFT when it faces the cameras (yaw 180), and K's points are [u, v, y].

import { MAT } from './ballpark-mesh.js';

const { GLOSS, METAL, SATIN, CLOTH, LEATHER, EMISSIVE } = MAT;
const TAU = Math.PI * 2;

const num = (v, d) => (Number.isFinite(+v) && v !== '' && v != null ? +v : d);
const F = (k, label, type = 'number') => ({ k, label, type });
function arc(n, a0, a1, fn) { for (let i = 0; i < n; i++) fn(a0 + (a1 - a0) * i / n, a0 + (a1 - a0) * (i + 1) / n); }
function rollOf(seed) { let s = ((Math.abs(Math.round(seed)) * 9301 + 49297) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function shade(hex, k) {
  const n = parseInt(String(hex).replace('#', ''), 16), c = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return '#' + [c(16), c(8), c(0)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function mixHex(a, b, t) {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16), ch = (s) => Math.round(((A >> s) & 255) * (1 - t) + ((B >> s) & 255) * t);
  return '#' + [ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// ── the kit ──
// A piece's frame: x across, y up, z out of its front, at p.at turned to p.yaw, standing p.y off the floor,
// and tipped `lean` radians round its own z (a bike resting on its stand leans to its left, +lean).
function rig(K, p, yaw = 180, lean = 0, at = null) {
  const a = (p.yaw ?? yaw) * Math.PI / 180, fu = Math.sin(a), fv = Math.cos(a), su = -fv, sv = fu;
  const c = Math.cos(lean), s = Math.sin(lean), [u0, v0] = at || p.at, y0 = num(p.y, 0);
  const T = (x, y, z) => [x * c - y * s, x * s + y * c, z];
  const P = (x, y, z) => { const [X, Y, Z] = T(x, y, z); return [u0 + su * X + fu * Z, v0 + sv * X + fv * Z, y0 + Y]; };
  const N = (x, y, z) => { const [X, Y, Z] = T(x, y, z); return K.nrmOf(su * X + fu * Z, Y, sv * X + fv * Z); };
  return { P, N };
}
const rawOf = (k) => k >= 1.25;
// a face in the rig's frame
function face(K, R, pts, n, hex, k = 1, mat = SATIN) { K.quad(K.solid, pts.map((q) => R.P(...q)), R.N(...n), K.C(hex, k), mat, null, mat === EMISSIVE || rawOf(k)); }
// a box in the rig's frame
function rbox(K, R, x0, x1, y0, y1, z0, z1, hex, k = 1, mat = SATIN) {
  face(K, R, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], hex, k, mat);
  face(K, R, [[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]], [0, -1, 0], hex, k * 0.7, mat);
  face(K, R, [[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]], [0, 0, 1], hex, k, mat);
  face(K, R, [[x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z0]], [0, 0, -1], hex, k, mat);
  face(K, R, [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [-1, 0, 0], hex, k * 0.92, mat);
  face(K, R, [[x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0]], [1, 0, 0], hex, k * 0.92, mat);
}
// a cylinder between two room points [u, v, y]
function tubeRoom(K, A, B, r0, hex, k = 1, n = 10, mat = METAL, caps = false, r1 = r0) {
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(d[0], d[1], d[2]) || 1, dn = d.map((c) => c / L);
  let e1 = Math.abs(dn[2]) > 0.95 ? [1, 0, 0] : [dn[1], -dn[0], 0];
  const l1 = Math.hypot(e1[0], e1[1], e1[2]); e1 = e1.map((c) => c / l1);
  const e2 = [dn[1] * e1[2] - dn[2] * e1[1], dn[2] * e1[0] - dn[0] * e1[2], dn[0] * e1[1] - dn[1] * e1[0]];
  const col = K.C(hex, k), raw = rawOf(k);
  const at = (P, a, r) => [P[0] + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * r, P[1] + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * r, P[2] + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * r];
  const nr = (a) => { const c = Math.cos(a), s = Math.sin(a); return K.nrmOf(e1[0] * c + e2[0] * s, e1[2] * c + e2[2] * s, e1[1] * c + e2[1] * s); };
  arc(n, 0, TAU, (a, b) => {
    K.quad(K.solid, [at(A, a, r0), at(B, a, r1), at(B, b, r1), at(A, b, r0)], nr((a + b) / 2), col, mat, null, raw);
    if (caps) {
      K.quad(K.solid, [A, at(A, b, r0), at(A, a, r0), at(A, a, r0)], K.nrmOf(-dn[0], -dn[2], -dn[1]), col, mat, null, raw);
      K.quad(K.solid, [B, at(B, a, r1), at(B, b, r1), at(B, b, r1)], K.nrmOf(dn[0], dn[2], dn[1]), col, mat, null, raw);
    }
  });
}
// a tube in the rig's frame, and a run of them through several points
const tube = (K, R, A, B, r, hex, k = 1, n = 10, mat = METAL, caps = false, r1 = r) => tubeRoom(K, R.P(...A), R.P(...B), r, hex, k, n, mat, caps, r1);
function path(K, R, pts, r, hex, k = 1, n = 8, mat = METAL) { for (let i = 0; i + 1 < pts.length; i++) tube(K, R, pts[i], pts[i + 1], r, hex, k, n, mat); for (let i = 1; i + 1 < pts.length; i++) K.ball(...ballAt(R, pts[i]), r, hex, k, n, mat); }
const ballAt = (R, q) => { const p = R.P(...q); return [p[0], p[1], p[2]]; };
const sphere = (K, R, q, r, hex, k = 1, n = 10, mat = SATIN) => { const p = R.P(...q); K.ball(p[0], p[1], p[2], r, hex, k, n, mat); };
// The frame's axes as (along, s, t): a section's plane and the axis it's swept down.
const AX = {
  z: { P: (a, s, t) => [s, t, a], N: (a, s, t) => [s, t, a] },
  x: { P: (a, s, t) => [a, t, s], N: (a, s, t) => [a, t, s] },
  y: { P: (a, s, t) => [s, a, t], N: (a, s, t) => [s, a, t] },
};
// A loft: sections joined along an axis. Each is { a, w, h } (half sizes) centred at (s, t), `sq` from
// 0 (an ellipse) to 1 (a box with its corners just rounded). Ends capped unless `open`.
function loft(K, R, secs, hex, k = 1, mat = GLOSS, { n = 16, axis = 'z', open = false } = {}) {
  const A = AX[axis];
  const ring = (S) => {
    const e = 1 - 0.85 * (S.sq ?? 0.4), out = [];
    for (let i = 0; i < n; i++) {
      const th = (i + 0.5) / n * TAU, c = Math.cos(th), s = Math.sin(th);
      const x = (S.s || 0) + S.w * Math.sign(c) * Math.abs(c) ** e, y = (S.t || 0) + S.h * Math.sign(s) * Math.abs(s) ** e;
      out.push({ p: A.P(S.a, x, y), n: [Math.sign(c) * Math.abs(c) ** (2 - e) / Math.max(1e-3, S.w), Math.sign(s) * Math.abs(s) ** (2 - e) / Math.max(1e-3, S.h)] });
    }
    return out;
  };
  const rings = secs.map(ring);
  for (let j = 0; j + 1 < secs.length; j++) {
    const r0 = rings[j], r1 = rings[j + 1], col = secs[j].hex || hex;
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n, ns = r0[i].n[0] + r0[i1].n[0], nt = r0[i].n[1] + r0[i1].n[1], l = Math.hypot(ns, nt) || 1;
      face(K, R, [r0[i].p, r1[i].p, r1[i1].p, r0[i1].p], A.N(0, ns / l, nt / l), col, secs[j].k ?? k, mat);
    }
  }
  if (open) return;
  for (const [j, sg] of [[0, -1], [secs.length - 1, 1]]) {
    const S = secs[j], c = A.P(S.a, S.s || 0, S.t || 0), r = rings[j];
    for (let i = 0; i < n; i++) face(K, R, [c, r[i].p, r[(i + 1) % n].p, r[(i + 1) % n].p], A.N(sg, 0, 0), S.hex || hex, S.k ?? k, mat);
  }
}
// A spin: a profile of [radius, along] turned round one of the frame's axes through point c.
function spin(K, R, axis, c, prof, hex, k = 1, n = 18, mat = METAL) {
  const A = AX[axis];
  const pt = (r, o, th) => { const q = A.P(o, Math.cos(th) * r, Math.sin(th) * r); return [c[0] + q[0], c[1] + q[1], c[2] + q[2]]; };
  for (let i = 0; i + 1 < prof.length; i++) {
    const [r0, o0] = prof[i], [r1, o1] = prof[i + 1], dr = r1 - r0, dl = o1 - o0, l = Math.hypot(dr, dl);
    if (l < 1e-5) continue;
    arc(n, 0, TAU, (a, b) => {
      const m = (a + b) / 2;
      face(K, R, [pt(r0, o0, a), pt(r0, o0, b), pt(r1, o1, b), pt(r1, o1, a)], A.N(-dr / l, Math.cos(m) * dl / l, Math.sin(m) * dl / l), hex, k, mat);
    });
  }
}
// a flat disc in the rig's frame, facing along the axis
function disc(K, R, axis, c, r, hex, k = 1, n = 18, mat = SATIN, sg = 1) {
  const A = AX[axis], ctr = c, pt = (th) => { const q = A.P(0, Math.cos(th) * r, Math.sin(th) * r); return [c[0] + q[0], c[1] + q[1], c[2] + q[2]]; };
  arc(n, 0, TAU, (a, b) => face(K, R, [ctr, pt(a), pt(b), pt(b)], A.N(sg, 0, 0), hex, k, mat));
}
// a ring of tubes, round one of the frame's axes (a steering wheel, a rim's lip)
function hoop(K, R, axis, c, rad, r, hex, k = 1, n = 20, mat = METAL, a0 = 0, a1 = TAU) {
  const A = AX[axis], pt = (th) => { const q = A.P(0, Math.cos(th) * rad, Math.sin(th) * rad); return [c[0] + q[0], c[1] + q[1], c[2] + q[2]]; };
  arc(n, a0, a1, (a, b) => tube(K, R, pt(a), pt(b), r, hex, k, 6, mat));
}
// A wheel on the frame's x axis: a tyre with rounded shoulders, a whitewall, a rim, wire spokes or a
// disc, and a hub cap. `side` is which way its face looks (+1 the frame's +x).
function wheel(K, R, c, r, w, { side = 1, rim = '#d8d8dc', spokes = 0, wall = '', tyre = '#141416', hub = '#e8e8ee', dish = 0.62 } = {}) {
  const h = w / 2, sh = Math.min(0.06, r * 0.18);
  spin(K, R, 'x', c, [[r - 0.11, -h], [r - sh, -h], [r - sh * 0.25, -h + sh * 0.55], [r, -h + sh], [r, h - sh], [r - sh * 0.25, h - sh * 0.55], [r - sh, h], [r - 0.11, h]], tyre, 1, 26, LEATHER);
  if (wall) for (const sg of [-1, 1]) spin(K, R, 'x', c, [[r - 0.105, sg * (h + 0.002)], [r - 0.045, sg * (h + 0.002)]], wall, 1.05, 26, SATIN);
  const ri = r - 0.11;
  for (const sg of [-1, 1]) {
    spin(K, R, 'x', c, [[ri + 0.005, sg * (h - 0.01)], [ri, sg * (h - 0.03)], [ri * 0.96, sg * (h - 0.035)]], rim, 1.1, 24, METAL);
    if (!spokes) spin(K, R, 'x', c, [[ri * 0.96, sg * (h - 0.035)], [ri * dish, sg * (h - 0.02)], [ri * 0.3, sg * (h + 0.005)]], rim, 1.05, 20, METAL);
  }
  // the hub, both faces
  spin(K, R, 'x', c, [[0, -h - 0.03], [0.06, -h - 0.03], [0.07, -h + 0.02], [0.07, h - 0.02], [0.06, h + 0.03], [0, h + 0.03]], hub, 1.15, 14, METAL);
  if (spokes) {
    for (let i = 0; i < spokes; i++) {
      const a = i / spokes * TAU, sx = (i % 2 ? 1 : -1) * (h - 0.04), hx = (i % 2 ? -1 : 1) * 0.05;
      tube(K, R, [c[0] + hx, c[1] + Math.sin(a + 0.2) * 0.06, c[2] + Math.cos(a + 0.2) * 0.06], [c[0] + sx * 0.6, c[1] + Math.sin(a) * ri * 0.97, c[2] + Math.cos(a) * ri * 0.97], 0.005, '#c8c8cc', 1, 4, METAL);
    }
  }
  void side;
}
// A shape on a vertical plane facing the cameras (for a painted backdrop): a fan from its first point.
function flat(K, R, pts, z, hex, k) { for (let i = 1; i + 1 < pts.length; i++) face(K, R, [[pts[0][0], pts[0][1], z], [pts[i][0], pts[i][1], z], [pts[i + 1][0], pts[i + 1][1], z], [pts[i + 1][0], pts[i + 1][1], z]], [0, 0, 1], hex, k, EMISSIVE); }
const flatDisc = (K, R, x, y, z, r, hex, k, n = 20, sy = 1) => flat(K, R, Array.from({ length: n + 1 }, (_, i) => [x + Math.cos(i / n * TAU) * r, y + Math.sin(i / n * TAU) * r * sy]), z, hex, k);
// a band whose top follows f(x): hills, a headland, a tree line
function ridge(K, R, x0, x1, y0, f, z, hex, k, steps = 40) {
  for (let i = 0; i < steps; i++) {
    const a = x0 + (x1 - x0) * i / steps, b = x0 + (x1 - x0) * (i + 1) / steps;
    face(K, R, [[a, y0, z], [b, y0, z], [b, f(b), z], [a, f(a), z]], [0, 0, 1], hex, k, EMISSIVE);
  }
}

// ── foliage ──
function canopy(K, cx, cv, cy, rx, ry, leaf, roll, n = 22) {
  const dark = shade(leaf, 0.72), lite = shade(leaf, 1.18);
  for (let i = 0; i < n; i++) {
    const th = roll() * TAU, ph = (roll() - 0.35) * Math.PI * 0.9, rr = 0.55 + roll() * 0.45;
    const u = cx + Math.cos(th) * Math.cos(ph) * rx * rr, v = cv + Math.sin(th) * Math.cos(ph) * rx * rr, y = cy + Math.sin(ph) * ry * rr;
    const col = y < cy - ry * 0.2 ? dark : roll() < 0.4 ? lite : leaf;
    K.ball(u, v, y, (0.22 + roll() * 0.18) * Math.max(rx, ry) / 1.1, col, 1, 9, CLOTH);
  }
  K.ball(cx, cv, cy, Math.min(rx, ry) * 0.85, dark, 1, 12, CLOTH);
}

export function locationPieces() {
  return {
    // ── the painted world round a location set ──
    sky_backdrop: {
      label: 'Painted daytime sky, with hills or sea', fields: [F('w', 'Width'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('sea', 'Horizon height (0 for land)'), F('hills', 'Hills (0/1)'), F('sun', 'Sun across (-1..1, 2 for none)'), F('headland', 'Headland (-1 left, 1 right, 0 none)'), F('seed', 'Seed'), F('colour', 'Sky colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 10, h: 4, sea: 0, hills: 1, sun: 0.5, headland: 0, seed: 1 },
      draw(K, p) {
        const w = num(p.w, 10), h = num(p.h, 4), sea = num(p.sea, 0), R = rig(K, p), roll = rollOf(num(p.seed, 1) + 3), x0 = -w / 2, x1 = w / 2;
        // the sky, a smooth fall from deep overhead to pale at the horizon
        const top = p.colour || '#2f7ad0', low = '#d8ecf6', B = 28;
        for (let i = 0; i < B; i++) { const t = i / B; face(K, R, [[x0, h * t, 0], [x1, h * t, 0], [x1, h * (t + 1 / B), 0], [x0, h * (t + 1 / B), 0]], [0, 0, 1], mixHex(low, top, Math.pow(t, 0.8)), 1.3, EMISSIVE); }
        // the sun, its glow first
        const sx = num(p.sun, 0.5);
        if (Math.abs(sx) <= 1) {
          const su = sx * w / 2 * 0.85, sy = h * 0.8;
          flatDisc(K, R, su, sy, 0.004, 0.95, mixHex('#fff6d0', top, 0.55), 1.4, 28);
          flatDisc(K, R, su, sy, 0.006, 0.6, mixHex('#fff6d0', top, 0.25), 1.6, 28);
          flatDisc(K, R, su, sy, 0.008, 0.34, '#fffbe8', 2.4, 28);
        }
        // clouds: puffs on a flat base, the undersides a touch grey
        for (let c = 0; c < Math.max(3, Math.round(w / 2.2)); c++) {
          const cx = x0 + (c + 0.3 + roll() * 0.5) * w / Math.max(3, Math.round(w / 2.2)), cy = h * (0.55 + roll() * 0.33), cw = 0.5 + roll() * 0.7;
          for (let i = 0; i < 6; i++) { const px = cx + (i / 5 - 0.5) * cw * 1.6, pr = cw * (0.22 + 0.2 * Math.sin(i / 5 * Math.PI)) * (0.8 + roll() * 0.4); flatDisc(K, R, px, cy + pr * 0.35, 0.01 + i * 0.0005, pr, '#ffffff', 1.45, 16); }
          face(K, R, [[cx - cw * 0.85, cy - 0.04, 0.0105], [cx + cw * 0.85, cy - 0.04, 0.0105], [cx + cw * 0.8, cy + 0.08, 0.0105], [cx - cw * 0.8, cy + 0.08, 0.0105]], [0, 0, 1], '#e4ecf4', 1.4, EMISSIVE);
        }
        if (sea > 0) {
          // the sea, deep at the foot and pale at the horizon, with lines of swell and a glitter under the sun
          for (let i = 0; i < 10; i++) { const t = i / 10; face(K, R, [[x0, sea * t, 0.014], [x1, sea * t, 0.014], [x1, sea * (t + 0.1), 0.014], [x0, sea * (t + 0.1), 0.014]], [0, 0, 1], mixHex('#14588e', '#5aa8d0', t), 1.2, EMISSIVE); }
          for (let i = 0; i < 14; i++) { const y = sea * (0.08 + roll() * 0.85), xa = x0 + roll() * w, len = (0.3 + roll() * 1.2) * (1 - y / sea + 0.3); face(K, R, [[xa, y, 0.016], [xa + len, y, 0.016], [xa + len, y + 0.018, 0.016], [xa, y + 0.018, 0.016]], [0, 0, 1], '#e8f6ff', 1.35, EMISSIVE); }
          if (Math.abs(sx) <= 1) for (let i = 0; i < 9; i++) { const xs = sx * w / 2 * 0.85 + (roll() - 0.5) * 0.9, y = sea * (0.2 + roll() * 0.75); face(K, R, [[xs - 0.08, y, 0.017], [xs + 0.08, y, 0.017], [xs + 0.08, y + 0.02, 0.017], [xs - 0.08, y + 0.02, 0.017]], [0, 0, 1], '#fffbe0', 1.9, EMISSIVE); }
          // a sail far out
          const bx = x0 + w * (0.3 + roll() * 0.25), by = sea * 0.88;
          flat(K, R, [[bx, by + 0.02], [bx + 0.16, by + 0.02], [bx + 0.03, by + 0.32]], 0.018, '#fbfbf4', 1.5);
          face(K, R, [[bx - 0.06, by - 0.02, 0.018], [bx + 0.2, by - 0.02, 0.018], [bx + 0.17, by + 0.03, 0.018], [bx - 0.03, by + 0.03, 0.018]], [0, 0, 1], '#3a3028', 1.3, EMISSIVE);
          // a headland running into the sea, its cliff face lit, a light on its point
          const hd = num(p.headland, 0);
          if (hd) {
            const xa = hd > 0 ? x1 - w * 0.38 : x0, xb = hd > 0 ? x1 : x0 + w * 0.38, f = (x) => { const t = hd > 0 ? (x - xa) / (xb - xa) : (xb - x) / (xb - xa); return sea + (0.15 + Math.pow(Math.max(0, t), 0.6) * 1.2) * (1 + 0.08 * Math.sin(x * 7)); };
            ridge(K, R, xa, xb, sea * 0.55, f, 0.02, '#8a7a5a', 1.3, 30);
            ridge(K, R, xa, xb, sea * 0.55, (x) => sea * 0.55 + (f(x) - sea * 0.55) * 0.55, 0.021, '#b09468', 1.3, 30);
            ridge(K, R, xa, xb, f(xa) - 0.01, (x) => f(x) + 0.08, 0.022, '#5a8a40', 1.25, 30);
            const lx = hd > 0 ? xa + 0.35 : xb - 0.35, ly = f(lx);
            face(K, R, [[lx - 0.05, ly, 0.023], [lx + 0.05, ly, 0.023], [lx + 0.035, ly + 0.42, 0.023], [lx - 0.035, ly + 0.42, 0.023]], [0, 0, 1], '#f4f0e8', 1.45, EMISSIVE);
            for (const yb of [0.12, 0.28]) face(K, R, [[lx - 0.048, ly + yb, 0.024], [lx + 0.048, ly + yb, 0.024], [lx + 0.045, ly + yb + 0.06, 0.024], [lx - 0.045, ly + yb + 0.06, 0.024]], [0, 0, 1], '#d03a2a', 1.4, EMISSIVE);
          }
        } else if (num(p.hills, 1)) {
          // three ranges of hills, the far ones blue with distance, a line of trees on the near crest
          const ph = [roll() * 6, roll() * 6, roll() * 6];
          ridge(K, R, x0, x1, 0, (x) => 1.25 + 0.35 * Math.sin(x * 0.55 + ph[0]) + 0.18 * Math.sin(x * 1.3 + ph[1]), 0.012, '#8ab4c4', 1.25);
          ridge(K, R, x0, x1, 0, (x) => 0.85 + 0.3 * Math.sin(x * 0.8 + ph[1]) + 0.1 * Math.sin(x * 2.1), 0.014, '#6aa060', 1.2);
          const near = (x) => 0.45 + 0.22 * Math.sin(x * 1.1 + ph[2]) + 0.06 * Math.sin(x * 3.3);
          for (let x = x0 + 0.1; x < x1; x += 0.12 + roll() * 0.25) if (roll() < 0.55) { const r = 0.07 + roll() * 0.08; flatDisc(K, R, x, near(x) + r * 0.6, 0.0155, r, '#3e7a34', 1.15, 10); }
          ridge(K, R, x0, x1, 0, near, 0.016, '#5a9a48', 1.18);
          // a farmhouse and a barn on the middle range
          const fx = x0 + w * (0.62 + roll() * 0.2), fy = 0.85 + 0.3 * Math.sin(fx * 0.8 + ph[1]) - 0.05;
          face(K, R, [[fx, fy, 0.0145], [fx + 0.22, fy, 0.0145], [fx + 0.22, fy + 0.13, 0.0145], [fx, fy + 0.13, 0.0145]], [0, 0, 1], '#b83a2a', 1.25, EMISSIVE);
          flat(K, R, [[fx - 0.02, fy + 0.13], [fx + 0.24, fy + 0.13], [fx + 0.11, fy + 0.22]], 0.0146, '#5a3a2a', 1.25);
        }
      },
    },
    sky_ceiling: {
      label: 'Painted sky overhead (hides the studio ceiling)', fields: [F('w', 'Width'), F('depth', 'Depth'), F('y', 'Height'), F('colour', 'Sky colour', 'text')],
      make: { at: [0, 5], w: 14, depth: 10, y: 4.98 },
      draw(K, p) {
        const w = num(p.w, 14), d = num(p.depth, 10), R = rig(K, p, 0), top = p.colour || '#2f7ad0', n = 8;
        // deepest straight overhead, paling toward the walls so it meets the backdrops' tops
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const x0 = -w / 2 + i * w / n, z0 = -d / 2 + j * d / n, cx = (x0 + w / (2 * n)) / (w / 2), cz = (z0 + d / (2 * n)) / (d / 2), e = Math.min(1, Math.hypot(cx, cz) / 1.2);
          face(K, R, [[x0, 0, z0], [x0 + w / n, 0, z0], [x0 + w / n, 0, z0 + d / n], [x0, 0, z0 + d / n]], [0, -1, 0], mixHex(shade(top, 0.85), top, e), 1.3, EMISSIVE);
        }
      },
    },
    tree: {
      label: 'Tree (a broadleaf)', fields: [F('h', 'Height'), F('seed', 'Seed'), F('colour', 'Leaf colour', 'text')],
      make: { at: [0, 0], h: 3.6, seed: 1 },
      draw(K, p) {
        const h = num(p.h, 3.6), [u, v] = p.at, roll = rollOf(num(p.seed, 1) + Math.round(u * 7 + v * 13)), leaf = p.colour || '#3e7a34', bark = '#5a4430';
        // a trunk that leans a little and forks
        const lean = (roll() - 0.5) * 0.3, top = [u + lean * 0.4, v + (roll() - 0.5) * 0.12, h * 0.48];
        tubeRoom(K, [u, v, 0], [u + lean * 0.15, v, h * 0.22], 0.17 * h / 3.6, bark, 1, 10, SATIN, false, 0.13 * h / 3.6);
        tubeRoom(K, [u + lean * 0.15, v, h * 0.22], top, 0.13 * h / 3.6, bark, 1, 10, SATIN, false, 0.09 * h / 3.6);
        for (let i = 0; i < 4; i++) { const a = i * 1.7 + roll(); tubeRoom(K, top, [top[0] + Math.cos(a) * h * 0.2, top[1] + Math.sin(a) * h * 0.2, top[2] + h * (0.12 + roll() * 0.12)], 0.06 * h / 3.6, bark, 1, 7, SATIN, false, 0.025); }
        // roots flaring at the foot
        for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + roll(); tubeRoom(K, [u, v, 0.18], [u + Math.cos(a) * 0.32, v + Math.sin(a) * 0.32, 0], 0.07, bark, 0.92, 6, SATIN, false, 0.02); }
        canopy(K, top[0], top[1], h * 0.72, h * 0.34, h * 0.26, leaf, roll, 26);
      },
    },
    palm_tree: {
      label: 'Palm tree', fields: [F('h', 'Height'), F('bend', 'Bend'), F('yaw', 'Bends toward (°)'), F('seed', 'Seed')],
      make: { at: [0, 0], h: 5, bend: 0.8, yaw: 90, seed: 1 },
      draw(K, p) {
        const h = num(p.h, 5), bend = num(p.bend, 0.8), R = rig(K, p, 90), roll = rollOf(num(p.seed, 1) + 5);
        // the trunk, ringed, curving over
        const pts = Array.from({ length: 13 }, (_, i) => { const t = i / 12; return [0, h * t, bend * t * t]; });
        for (let i = 0; i + 1 < pts.length; i++) tube(K, R, pts[i], pts[i + 1], 0.16 - i * 0.006, i % 2 ? '#8a6a48' : '#7a5c3e', 1, 10, SATIN, false, 0.155 - i * 0.006);
        for (let i = 1; i < pts.length - 1; i++) spin(K, R, 'y', pts[i], [[0.15 - i * 0.006, -0.02], [0.17 - i * 0.006, 0], [0.15 - i * 0.006, 0.02]], '#6a5036', 1, 10, SATIN);
        const crown = pts[pts.length - 1];
        // coconuts under the crown
        for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; sphere(K, R, [crown[0] + Math.cos(a) * 0.14, crown[1] - 0.12, crown[2] + Math.sin(a) * 0.14], 0.09, '#5a4020', 1, 8, SATIN); }
        // fronds: a midrib arching out and down, leaflets either side
        for (let f = 0; f < 10; f++) {
          const a = f / 10 * TAU + roll() * 0.3, len = h * (0.36 + roll() * 0.12), up = 0.35 + roll() * 0.4, ca = Math.cos(a), sa = Math.sin(a);
          let prev = crown;
          for (let s = 1; s <= 8; s++) {
            const t = s / 8, r = len * t, y = crown[1] + up * Math.sin(t * Math.PI * 0.8) * len * 0.5 - t * t * len * 0.55;
            const q = [crown[0] + ca * r, y, crown[2] + sa * r], wd = 0.32 * Math.sin(t * Math.PI) + 0.03, col = f % 2 ? '#3a8a34' : '#2f7a2c';
            tube(K, R, prev, q, 0.015, '#4a6a2a', 1, 4, SATIN);
            // leaflets droop either side of the rib
            for (const sg of [-1, 1]) face(K, R, [prev, q, [q[0] - sa * wd * sg, q[1] - wd * 0.6, q[2] + ca * wd * sg], [prev[0] - sa * wd * sg * 0.9, prev[1] - wd * 0.55, prev[2] + ca * wd * sg * 0.9]], [0, 1, 0], col, 1, CLOTH);
            prev = q;
          }
        }
      },
    },
    bush: {
      label: 'Bush', fields: [F('w', 'Width'), F('h', 'Height'), F('seed', 'Seed'), F('colour', 'Leaf colour', 'text'), F('flowers', 'Flower colour', 'text')],
      make: { at: [0, 0], w: 1, h: 0.8, seed: 1 },
      draw(K, p) {
        const w = num(p.w, 1), h = num(p.h, 0.8), roll = rollOf(num(p.seed, 1) + Math.round(p.at[0] * 11)), leaf = p.colour || '#3a7a34';
        canopy(K, p.at[0], p.at[1], h * 0.5, w * 0.5, h * 0.5, leaf, roll, 14);
        if (p.flowers) for (let i = 0; i < 14; i++) { const a = roll() * TAU, r = w * 0.45 * Math.sqrt(roll()); K.ball(p.at[0] + Math.cos(a) * r, p.at[1] + Math.sin(a) * r, h * (0.55 + roll() * 0.45), 0.045, p.flowers, 1.1, 6, CLOTH); }
      },
    },
    flower_bed: {
      label: 'Flower bed', fields: [F('w', 'Width'), F('depth', 'Depth'), F('yaw', 'Facing (°)'), F('seed', 'Seed')],
      make: { at: [0, 0], yaw: 180, w: 2, depth: 0.6, seed: 1 },
      draw(K, p) {
        const w = num(p.w, 2), d = num(p.depth, 0.6), R = rig(K, p), roll = rollOf(num(p.seed, 1) + 9), cols = ['#e83a5a', '#f4d03a', '#f08a2a', '#b85ad8', '#f4f4f0'];
        rbox(K, R, -w / 2, w / 2, 0, 0.12, -d / 2, d / 2, '#4a3424', 1, SATIN);
        for (const s of [-1, 1]) rbox(K, R, -w / 2 - 0.04, w / 2 + 0.04, 0, 0.16, s * d / 2 - 0.03, s * d / 2 + 0.03, '#b8b0a0', 1, SATIN);
        for (let i = 0; i < w * 14; i++) {
          const x = -w / 2 + 0.06 + roll() * (w - 0.12), z = -d / 2 + 0.06 + roll() * (d - 0.12), y = 0.12 + 0.1 + roll() * 0.12;
          tube(K, R, [x, 0.12, z], [x, y, z], 0.008, '#3a7a2a', 1, 4, SATIN);
          sphere(K, R, [x, y, z], 0.04 + roll() * 0.02, cols[Math.floor(roll() * cols.length)], 1.15, 7, CLOTH);
        }
      },
    },
    // ── a park ──
    swing_set: {
      label: 'Playground swing set', fields: [F('yaw', 'Facing (°)'), F('w', 'Width'), F('colour', 'Frame colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 2.6 },
      draw(K, p) {
        const w = num(p.w, 2.6), R = rig(K, p), H = 2.15, red = p.colour || '#c8342a', sp = 0.75;
        // the top beam and two A-frames, splayed, with a cross brace and a cap on each apex
        tube(K, R, [-w / 2 - 0.08, H, 0], [w / 2 + 0.08, H, 0], 0.045, red, 1, 12, GLOSS, true);
        for (const s of [-1, 1]) {
          for (const z of [-1, 1]) tube(K, R, [s * (w / 2 + 0.12), 0, z * sp], [s * w / 2, H, 0], 0.035, red, 1, 10, GLOSS);
          tube(K, R, [s * (w / 2 + 0.06), 0.75, -sp * 0.65], [s * (w / 2 + 0.06), 0.75, sp * 0.65], 0.025, red, 1, 8, GLOSS);
          sphere(K, R, [s * w / 2, H, 0], 0.07, red, 1, 10, GLOSS);
          for (const z of [-1, 1]) spin(K, R, 'y', [s * (w / 2 + 0.12), 0, z * sp], [[0.07, 0], [0.07, 0.03], [0, 0.03]], '#8a8a8a', 1, 10, METAL);
        }
        // two swings: chains, the hangers on the beam and a rubber belt seat that sags in the middle
        for (const x of [-w / 4, w / 4]) {
          for (const d of [-0.22, 0.22]) {
            spin(K, R, 'x', [x + d, H - 0.02, 0], [[0.05, -0.03], [0.055, 0], [0.05, 0.03]], '#8a8a8a', 1, 8, METAL);
            for (let i = 0; i < 18; i++) { const y0 = H - 0.06 - i * 0.09, y1 = y0 - 0.085; tube(K, R, [x + d, y0, 0], [x + d, y1, 0], 0.009, '#9a9aa0', 1, 4, METAL); }
          }
          loft(K, R, Array.from({ length: 7 }, (_, i) => { const t = i / 6, a = x - 0.24 + t * 0.48; return { a, w: 0.1, h: 0.015, t: 0.46 - Math.sin(t * Math.PI) * 0.05, sq: 0.7 }; }), '#1e1e22', 1, LEATHER, { axis: 'x', n: 10 });
        }
      },
    },
    slide: {
      label: 'Playground slide', fields: [F('yaw', 'Facing (°)'), F('colour', 'Chute colour', 'text')],
      make: { at: [0, 0], yaw: 180, colour: '#f0c030' },
      draw(K, p) {
        const R = rig(K, p), H = 1.6, chute = p.colour || '#f0c030', steel = '#b8bcc4';
        // the ladder behind, a little platform with rails, and the chute curving out to the front
        for (const s of [-1, 1]) tube(K, R, [s * 0.25, 0, -1.0], [s * 0.25, H + 0.6, -0.5], 0.025, steel, 1, 8, METAL);
        for (let i = 1; i <= 6; i++) { const t = i / 7; tube(K, R, [-0.25, t * (H + 0.6), -1.0 + t * 0.5], [0.25, t * (H + 0.6), -1.0 + t * 0.5], 0.018, steel, 1, 6, METAL); }
        rbox(K, R, -0.3, 0.3, H - 0.04, H, -0.62, -0.2, '#c83a2a', 1, GLOSS);
        for (const s of [-1, 1]) { tube(K, R, [s * 0.3, H, -0.2], [s * 0.3, H + 0.55, -0.2], 0.022, steel, 1, 8, METAL); tube(K, R, [s * 0.3, H + 0.55, -0.2], [s * 0.25, H + 0.6, -0.5], 0.022, steel, 1, 8, METAL); }
        const at = (t) => [0, H * (1 - t) ** 1.3 * (1 - 0.15 * t) + 0.25 * t, -0.2 + t * 2.4];
        for (let i = 0; i < 12; i++) {
          const a = at(i / 12), b = at((i + 1) / 12);
          face(K, R, [[-0.24, a[1], a[2]], [0.24, a[1], a[2]], [0.24, b[1], b[2]], [-0.24, b[1], b[2]]], [0, 1, 0], chute, 1.05, GLOSS);
          for (const s of [-1, 1]) face(K, R, [[s * 0.24, a[1], a[2]], [s * 0.28, a[1] + 0.14, a[2]], [s * 0.28, b[1] + 0.14, b[2]], [s * 0.24, b[1], b[2]]], [s, 0.3, 0], chute, 0.95, GLOSS);
        }
        const end = at(1);
        for (const s of [-1, 1]) tube(K, R, [s * 0.22, 0, end[2] - 0.1], [s * 0.22, end[1], end[2] - 0.1], 0.025, steel, 1, 8, METAL);
      },
    },
    park_bench: {
      label: 'Park bench', fields: [F('yaw', 'Facing (°)'), F('w', 'Width')],
      make: { at: [0, 0], yaw: 180, w: 1.8 },
      draw(K, p) {
        const w = num(p.w, 1.8), R = rig(K, p), wood = '#8a5a30', iron = '#1e2a22';
        for (let i = 0; i < 4; i++) rbox(K, R, -w / 2, w / 2, 0.43, 0.465, -0.2 + i * 0.105, -0.12 + i * 0.105, shade(wood, 0.92 + (i % 2) * 0.1), 1, SATIN);
        for (let i = 0; i < 3; i++) { const y = 0.58 + i * 0.13, z = -0.27 - i * 0.04; rbox(K, R, -w / 2, w / 2, y, y + 0.09, z - 0.03, z, shade(wood, 0.95 + (i % 2) * 0.08), 1, SATIN); }
        // cast iron ends: a leg front and back, an arm with a scroll
        for (const s of [-1, 1]) {
          const x = s * (w / 2 - 0.12);
          path(K, R, [[x, 0, 0.18], [x, 0.43, 0.12], [x, 0.43, -0.22], [x, 0, -0.26]], 0.022, iron, 1, 6, METAL);
          path(K, R, [[x, 0.43, -0.22], [x, 0.95, -0.36]], 0.022, iron, 1, 6, METAL);
          path(K, R, [[x, 0.43, 0.1], [x, 0.66, 0.12], [x, 0.66, -0.2]], 0.022, iron, 1, 6, METAL);
          sphere(K, R, [x, 0.66, 0.14], 0.035, iron, 1, 8, METAL);
        }
      },
    },
    lamp_post: {
      label: 'Park lamp post', fields: [F('h', 'Height')],
      make: { at: [0, 0], h: 3.2 },
      draw(K, p) {
        const h = num(p.h, 3.2), R = rig(K, p), iron = '#1c2420';
        spin(K, R, 'y', [0, 0, 0], [[0.16, 0], [0.16, 0.12], [0.1, 0.2], [0.07, 0.5], [0.055, 0.55], [0.045, h - 0.45], [0.06, h - 0.4], [0.06, h - 0.36], [0, h - 0.36]], iron, 1, 12, METAL);
        // a lantern: a cap, four glass panes lit from inside, a finial
        spin(K, R, 'y', [0, h - 0.36, 0], [[0.06, 0], [0.14, 0.02], [0.14, 0.05], [0, 0.05]], iron, 1, 8, METAL);
        for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + Math.PI / 4, b = a + TAU / 4, r0 = 0.12, r1 = 0.17; face(K, R, [[Math.cos(a) * r0, h - 0.31, Math.sin(a) * r0], [Math.cos(b) * r0, h - 0.31, Math.sin(b) * r0], [Math.cos(b) * r1, h - 0.02, Math.sin(b) * r1], [Math.cos(a) * r1, h - 0.02, Math.sin(a) * r1]], [Math.cos(a + TAU / 8), 0, Math.sin(a + TAU / 8)], '#fff2c8', 1.5, EMISSIVE); }
        spin(K, R, 'y', [0, h - 0.02, 0], [[0.2, 0], [0.12, 0.12], [0.02, 0.2], [0, 0.32]], iron, 1, 8, METAL);
      },
    },
    picnic_blanket: {
      label: 'Picnic blanket and basket', fields: [F('yaw', 'Facing (°)'), F('w', 'Width'), F('colour', 'Check colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 1.6, colour: '#d03a3a' },
      draw(K, p) {
        const w = num(p.w, 1.6), d = w * 0.8, R = rig(K, p), c = p.colour || '#d03a3a', n = 8;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const x0 = -w / 2 + i * w / n, z0 = -d / 2 + j * d / n, col = (i + j) % 2 ? '#f4f0e8' : (i % 2 && j % 2 ? shade(c, 0.8) : c);
          face(K, R, [[x0, 0.012, z0], [x0 + w / n, 0.012, z0], [x0 + w / n, 0.012, z0 + d / n], [x0, 0.012, z0 + d / n]], [0, 1, 0], col, 1, CLOTH);
        }
        // a wicker basket with its lid half open, a bottle and two plates
        const bx = w * 0.28, bz = -d * 0.2;
        rbox(K, R, bx - 0.22, bx + 0.22, 0.012, 0.26, bz - 0.15, bz + 0.15, '#b88a4a', 1, CLOTH);
        for (let i = 0; i < 5; i++) rbox(K, R, bx - 0.225, bx + 0.225, 0.04 + i * 0.05, 0.05 + i * 0.05, bz - 0.155, bz + 0.155, '#8a6030', 1, CLOTH);
        face(K, R, [[bx - 0.22, 0.26, bz - 0.15], [bx + 0.22, 0.26, bz - 0.15], [bx + 0.22, 0.42, bz - 0.28], [bx - 0.22, 0.42, bz - 0.28]], [0, 0.6, 0.8], '#a87a40', 1, CLOTH);
        tube(K, R, [bx - 0.15, 0.26, bz], [bx, 0.38, bz], 0.012, '#6a4a20', 1, 4, SATIN); tube(K, R, [bx, 0.38, bz], [bx + 0.15, 0.26, bz], 0.012, '#6a4a20', 1, 4, SATIN);
        spin(K, R, 'y', [-w * 0.15, 0.012, d * 0.12], [[0.035, 0], [0.036, 0.2], [0.014, 0.26], [0.013, 0.31], [0, 0.31]], '#4a1a2a', 1.05, 10, GLOSS);
        for (const [x, z] of [[-w * 0.3, -d * 0.15], [0.05, d * 0.2]]) spin(K, R, 'y', [x, 0.012, z], [[0.08, 0], [0.12, 0.012], [0.12, 0.018], [0, 0.018]], '#f8f8f4', 1.1, 16, GLOSS);
      },
    },
    picket_fence: {
      label: 'Picket fence', fields: [F('w', 'Length'), F('yaw', 'Facing (°)'), F('h', 'Height')],
      make: { at: [0, 0], yaw: 180, w: 4, h: 0.9 },
      draw(K, p) {
        const w = num(p.w, 4), h = num(p.h, 0.9), R = rig(K, p), white = '#f4f2ea';
        for (const y of [h * 0.25, h * 0.72]) rbox(K, R, -w / 2, w / 2, y, y + 0.07, -0.04, -0.01, white, 1, SATIN);
        for (let x = -w / 2 + 0.05; x <= w / 2; x += 0.14) {
          rbox(K, R, x - 0.04, x + 0.04, 0, h - 0.06, -0.01, 0.01, white, 1.02, SATIN);
          face(K, R, [[x - 0.04, h - 0.06, 0.01], [x + 0.04, h - 0.06, 0.01], [x, h, 0.01], [x, h, 0.01]], [0, 0, 1], white, 1.02, SATIN);
        }
        for (let x = -w / 2; x <= w / 2 + 0.01; x += 2) rbox(K, R, x - 0.05, x + 0.05, 0, h + 0.05, -0.1, 0, white, 0.96, SATIN);
      },
    },
    garden_path: {
      label: 'Gravel path with an edging', fields: [F('w', 'Width'), F('depth', 'Length'), F('yaw', 'Runs toward (°)'), F('colour', 'Gravel colour', 'text')],
      make: { at: [0, 0], yaw: 0, w: 1.4, depth: 6 },
      draw(K, p) {
        const w = num(p.w, 1.4), d = num(p.depth, 6), R = rig(K, p, 0), g = p.colour || '#c8b890', roll = rollOf(17);
        face(K, R, [[-w / 2, 0.008, -d / 2], [w / 2, 0.008, -d / 2], [w / 2, 0.008, d / 2], [-w / 2, 0.008, d / 2]], [0, 1, 0], g, 1, SATIN);
        for (let i = 0; i < d * 40; i++) { const x = (roll() - 0.5) * (w - 0.1), z = (roll() - 0.5) * d, s = 0.02 + roll() * 0.025; face(K, R, [[x, 0.011, z], [x + s, 0.011, z], [x + s, 0.011, z + s], [x, 0.011, z + s]], [0, 1, 0], shade(g, 0.75 + roll() * 0.4), 1, SATIN); }
        for (const s of [-1, 1]) for (let z = -d / 2; z < d / 2; z += 0.3) rbox(K, R, s * w / 2 - 0.04, s * w / 2 + 0.04, 0, 0.06, z, z + 0.28, '#9a5a3a', 1, SATIN);
      },
    },
    trash_bin: {
      label: 'Litter bin', fields: [F('colour', 'Colour', 'text')],
      make: { at: [0, 0], colour: '#2a5a3a' },
      draw(K, p) {
        const R = rig(K, p), c = p.colour || '#2a5a3a';
        spin(K, R, 'y', [0, 0, 0], [[0, 0], [0.2, 0], [0.22, 0.04], [0.24, 0.85], [0.26, 0.86], [0.26, 0.9], [0.2, 0.9], [0.2, 0.82], [0, 0.82]], c, 1, 16, GLOSS);
        for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; tube(K, R, [Math.cos(a) * 0.245, 0.1, Math.sin(a) * 0.245], [Math.cos(a) * 0.255, 0.8, Math.sin(a) * 0.255], 0.012, shade(c, 0.75), 1, 4, GLOSS); }
      },
    },
    // ── vehicles ──
    motorbike: {
      label: 'Motorcycle (a cruiser on its stand)', fields: [F('yaw', 'Points toward (°)'), F('colour', 'Tank colour', 'text'), F('lean', 'Lean (°)')],
      make: { at: [0, 0], yaw: 90, colour: '#1a1a1c', lean: 8 },
      draw(K, p) {
        const lean = num(p.lean, 8) * Math.PI / 180, R = rig(K, p, 90, lean), tank = p.colour || '#1a1a1c', chrome = '#dcdce2', black = '#141416', leather = '#2a1a10';
        const fA = [0, 0.33, 0.86], rA = [0, 0.34, -0.8], head = [0, 0.98, 0.58];
        wheel(K, R, fA, 0.33, 0.12, { spokes: 32, rim: chrome, wall: '#e8e6dc' });
        wheel(K, R, rA, 0.34, 0.2, { spokes: 32, rim: chrome, wall: '#e8e6dc' });
        // the frame: backbone, a cradle under the engine, the swingarm to the back axle, a shock each side
        path(K, R, [head, [0, 0.82, 0.05], [0, 0.72, -0.42]], 0.028, black, 1, 8, GLOSS);
        path(K, R, [head, [0, 0.28, 0.32], [0, 0.22, -0.2], [0, 0.4, -0.4]], 0.024, black, 1, 8, GLOSS);
        for (const s of [-1, 1]) { tube(K, R, [s * 0.1, 0.32, -0.25], [s * 0.1, rA[1], rA[2]], 0.022, black, 1, 8, GLOSS); tube(K, R, [s * 0.11, 0.7, -0.45], [s * 0.11, 0.38, -0.72], 0.028, chrome, 1, 8, METAL); }
        // forks raked out to the front axle, the triple clamps, headlight and the bars high and wide
        for (const s of [-1, 1]) { tube(K, R, [s * 0.075, 1.02, 0.56], [s * 0.075, 0.33, fA[2]], 0.026, chrome, 1.05, 10, METAL); tube(K, R, [s * 0.075, 0.6, 0.71], [s * 0.075, 0.36, fA[2]], 0.034, chrome, 1.05, 10, METAL); }
        for (const y of [0.92, 1.05]) rbox(K, R, -0.11, 0.11, y, y + 0.04, 0.5, 0.62, chrome, 1.05, METAL);
        spin(K, R, 'z', [0, 0.9, 0.7], [[0, -0.12], [0.09, -0.1], [0.11, -0.02], [0.115, 0.02], [0.105, 0.03]], chrome, 1.1, 18, METAL);
        disc(K, R, 'z', [0, 0.9, 0.735], 0.1, '#fff6d8', 1.7, 18, EMISSIVE);
        path(K, R, [[-0.06, 1.07, 0.56], [-0.12, 1.32, 0.5], [-0.42, 1.36, 0.42], [-0.46, 1.3, 0.36]], 0.014, chrome, 1.05, 8, METAL);
        path(K, R, [[0.06, 1.07, 0.56], [0.12, 1.32, 0.5], [0.42, 1.36, 0.42], [0.46, 1.3, 0.36]], 0.014, chrome, 1.05, 8, METAL);
        for (const s of [-1, 1]) { tube(K, R, [s * 0.42, 1.36, 0.42], [s * 0.52, 1.28, 0.32], 0.02, black, 1, 8, LEATHER, true); tube(K, R, [s * 0.3, 1.36, 0.45], [s * 0.36, 1.58, 0.42], 0.006, chrome, 1, 4, METAL); spin(K, R, 'z', [s * 0.36, 1.6, 0.42], [[0, -0.01], [0.045, 0], [0.04, 0.01], [0, 0.012]], chrome, 1.1, 10, METAL); }
        // a teardrop tank and the speedo on it
        loft(K, R, [{ a: 0.02, w: 0.08, h: 0.05, t: 0.84, sq: 0.2 }, { a: 0.14, w: 0.15, h: 0.1, t: 0.86, sq: 0.25 }, { a: 0.34, w: 0.16, h: 0.11, t: 0.9, sq: 0.25 }, { a: 0.5, w: 0.12, h: 0.08, t: 0.92, sq: 0.2 }, { a: 0.56, w: 0.06, h: 0.04, t: 0.93, sq: 0.1 }], tank, 1, GLOSS, { n: 18 });
        for (const s of [-1, 1]) loft(K, R, [{ a: 0.12, w: 0.005, h: 0.015, s: s * 0.152, t: 0.87 }, { a: 0.4, w: 0.005, h: 0.04, s: s * 0.15, t: 0.9 }, { a: 0.48, w: 0.004, h: 0.01, s: s * 0.12, t: 0.92 }], '#c8a040', 1.1, METAL, { n: 6 });
        spin(K, R, 'y', [0, 1.0, 0.24], [[0, 0], [0.045, 0], [0.045, 0.02], [0, 0.02]], chrome, 1.1, 12, METAL);
        disc(K, R, 'y', [0, 1.021, 0.24], 0.038, '#f4f0e0', 1.3, 12, EMISSIVE);
        // a low solo seat, deep in the middle
        loft(K, R, [{ a: -0.6, w: 0.08, h: 0.03, t: 0.78, sq: 0.5 }, { a: -0.48, w: 0.15, h: 0.05, t: 0.78, sq: 0.6 }, { a: -0.3, w: 0.18, h: 0.045, t: 0.72, sq: 0.6 }, { a: -0.05, w: 0.12, h: 0.04, t: 0.78, sq: 0.5 }, { a: 0.03, w: 0.06, h: 0.03, t: 0.8, sq: 0.4 }], leather, 1, LEATHER, { n: 14 });
        // the V-twin: crankcase, two finned barrels in a V, the air cleaner on the right
        loft(K, R, [{ a: -0.32, w: 0.11, h: 0.12, t: 0.36, sq: 0.5 }, { a: -0.1, w: 0.13, h: 0.14, t: 0.36, sq: 0.6 }, { a: 0.18, w: 0.11, h: 0.11, t: 0.34, sq: 0.5 }], chrome, 1, METAL, { n: 14 });
        for (const [dz, dy] of [[0.55, 1], [-0.55, 1]]) {
          const base = [0, 0.46, -0.05 + dz * 0.04], L = Math.hypot(dz, dy), d = [0, dy / L, dz / L];
          for (let i = 0; i < 9; i++) { const o = 0.03 + i * 0.03, c = [base[0], base[1] + d[1] * o, base[2] + d[2] * o]; tube(K, R, [c[0] - 0.1, c[1], c[2]], [c[0] + 0.1, c[1], c[2]], i % 2 ? 0.075 : 0.095, i % 2 ? '#5a5a60' : '#9a9aa2', 1, 12, METAL); }
          const tp = [base[0], base[1] + d[1] * 0.3, base[2] + d[2] * 0.3];
          tube(K, R, [tp[0] - 0.08, tp[1], tp[2]], [tp[0] + 0.08, tp[1], tp[2]], 0.08, chrome, 1.1, 12, METAL, true);
        }
        spin(K, R, 'x', [0.12, 0.62, 0.02], [[0, 0], [0.11, 0], [0.12, 0.02], [0.12, 0.05], [0.1, 0.07], [0, 0.07]], chrome, 1.15, 18, METAL);
        // the pipes: two staggered shotguns down the right side, flared at the ends
        for (const [y0, z0, y1] of [[0.62, 0.12, 0.3], [0.56, -0.2, 0.22]]) path(K, R, [[0.1, y0, z0], [0.2, y0 - 0.12, z0 + 0.04], [0.22, y1, -0.3], [0.22, y1 + 0.02, -1.05]], 0.03, chrome, 1.1, 10, METAL);
        for (const y of [0.3, 0.22]) spin(K, R, 'z', [0.22, y + 0.02, -1.05], [[0.03, 0], [0.04, -0.05], [0.042, -0.07], [0, -0.07]], chrome, 1.1, 12, METAL);
        // fenders, the back one long and bobbed, a taillight; saddlebags; the kickstand to the left
        loft(K, R, Array.from({ length: 10 }, (_, i) => { const a = 0.9 + i / 9 * (Math.PI - 0.95), r = 0.41; return { a: rA[2] + Math.cos(a) * r, w: 0.13, h: 0.012, t: rA[1] + Math.sin(a) * r, sq: 0.8 }; }).sort((x, y) => x.a - y.a), tank, 1, GLOSS, { n: 10 });
        loft(K, R, Array.from({ length: 8 }, (_, i) => { const a = 0.5 + i / 7 * 1.9, r = 0.39; return { a: fA[2] + Math.cos(a) * r, w: 0.085, h: 0.01, t: fA[1] + Math.sin(a) * r, sq: 0.8 }; }).sort((x, y) => x.a - y.a), tank, 1, GLOSS, { n: 10 });
        disc(K, R, 'z', [0, 0.7, -1.2], 0.04, '#ff2a1a', 1.7, 12, EMISSIVE, -1);
        for (const s of [-1, 1]) { loft(K, R, [{ a: -1.05, w: 0.07, h: 0.13, s: s * 0.24, t: 0.55, sq: 0.7 }, { a: -0.62, w: 0.08, h: 0.15, s: s * 0.24, t: 0.56, sq: 0.8 }], leather, 1, LEATHER, { n: 12 }); for (const z of [-0.95, -0.72]) rbox(K, R, s * 0.32 - 0.004, s * 0.32 + 0.004, 0.5, 0.68, z - 0.015, z + 0.015, chrome, 1.1, METAL); }
        tube(K, R, [-0.1, 0.25, -0.15], [-0.32, 0, -0.1], 0.015, black, 1, 6, METAL);
        // the footpegs and the plate
        for (const s of [-1, 1]) tube(K, R, [s * 0.1, 0.3, 0.28], [s * 0.3, 0.3, 0.3], 0.02, black, 1, 6, LEATHER, true);
        rbox(K, R, -0.08, 0.08, 0.5, 0.6, -1.17, -1.16, '#f0e8c8', 1.05, SATIN);
      },
    },
    convertible: {
      label: 'Roadster, top down', fields: [F('yaw', 'Points toward (°)'), F('colour', 'Paint', 'text'), F('trim', 'Interior colour', 'text')],
      make: { at: [0, 0], yaw: 90, colour: '#d82a2a', trim: '#efe4cc' },
      draw(K, p) {
        const R = rig(K, p, 90), paint = p.colour || '#d82a2a', hide = p.trim || '#efe4cc', chrome = '#e2e2e8', dark = '#121214';
        const WF = 1.32, WR = -1.38, WY = 0.34, WX = 0.82;
        // the lower body: long nose, short tail, a waist; full width over the wheels
        const body = [
          { a: -2.22, w: 0.7, h: 0.15, t: 0.5, sq: 0.55 }, { a: -2.12, w: 0.84, h: 0.23, t: 0.54, sq: 0.6 }, { a: -1.85, w: 0.9, h: 0.26, t: 0.56, sq: 0.62 },
          { a: -1.1, w: 0.88, h: 0.26, t: 0.55, sq: 0.62 }, { a: -0.2, w: 0.86, h: 0.25, t: 0.54, sq: 0.62 }, { a: 0.8, w: 0.88, h: 0.24, t: 0.53, sq: 0.62 },
          { a: 1.5, w: 0.89, h: 0.22, t: 0.52, sq: 0.6 }, { a: 2.0, w: 0.82, h: 0.18, t: 0.48, sq: 0.55 }, { a: 2.26, w: 0.6, h: 0.12, t: 0.44, sq: 0.45 },
        ];
        loft(K, R, body, paint, 1, GLOSS, { n: 22 });
        // the bonnet's long swell and the tail's deck over it
        loft(K, R, [{ a: 0.55, w: 0.8, h: 0.08, t: 0.78, sq: 0.5 }, { a: 1.2, w: 0.78, h: 0.07, t: 0.76, sq: 0.5 }, { a: 1.8, w: 0.7, h: 0.05, t: 0.72, sq: 0.45 }, { a: 2.15, w: 0.5, h: 0.03, t: 0.64, sq: 0.4 }], paint, 1.03, GLOSS, { n: 20 });
        loft(K, R, [{ a: -2.1, w: 0.62, h: 0.04, t: 0.76, sq: 0.45 }, { a: -1.75, w: 0.8, h: 0.09, t: 0.8, sq: 0.5 }, { a: -1.15, w: 0.8, h: 0.08, t: 0.8, sq: 0.5 }], paint, 1.03, GLOSS, { n: 20 });
        // a bonnet bulge, a chrome strip down its middle and two vents
        loft(K, R, [{ a: 0.7, w: 0.2, h: 0.03, t: 0.84, sq: 0.3 }, { a: 1.5, w: 0.22, h: 0.03, t: 0.82, sq: 0.3 }, { a: 1.9, w: 0.12, h: 0.015, t: 0.77, sq: 0.3 }], paint, 1.05, GLOSS, { n: 14 });
        tube(K, R, [0, 0.872, 0.62], [0, 0.85, 1.85], 0.008, chrome, 1.1, 6, METAL);
        for (const s of [-1, 1]) for (let i = 0; i < 4; i++) rbox(K, R, s * 0.45 - 0.08, s * 0.45 + 0.08, 0.83, 0.835, 1.1 + i * 0.07, 1.13 + i * 0.07, dark, 1, SATIN);
        // the cockpit: the tub's floor, its padded rim, two bucket seats and a folded top behind them
        rbox(K, R, -0.78, 0.78, 0.6, 0.78, -1.12, 0.52, '#2a1e18', 1, LEATHER);
        for (const s of [-1, 1]) tube(K, R, [s * 0.8, 0.8, -1.1], [s * 0.8, 0.8, 0.5], 0.035, '#3a2a20', 1, 10, LEATHER);
        tube(K, R, [-0.8, 0.8, -1.12], [0.8, 0.8, -1.12], 0.035, '#3a2a20', 1, 10, LEATHER);
        for (const s of [-1, 1]) {
          const x = s * 0.38;
          loft(K, R, [{ a: -0.72, w: 0.24, h: 0.06, s: x, t: 0.74, sq: 0.7 }, { a: -0.3, w: 0.25, h: 0.07, s: x, t: 0.76, sq: 0.75 }, { a: -0.18, w: 0.23, h: 0.06, s: x, t: 0.77, sq: 0.7 }], hide, 1, LEATHER, { n: 14 });
          loft(K, R, [{ a: 0.72, w: 0.24, h: 0.06, s: x, t: -0.82, sq: 0.7 }, { a: 1.0, w: 0.25, h: 0.07, s: x, t: -0.85, sq: 0.75 }, { a: 1.28, w: 0.2, h: 0.06, s: x, t: -0.88, sq: 0.6 }], hide, 1, LEATHER, { n: 14, axis: 'y' });
          loft(K, R, [{ a: 1.3, w: 0.13, h: 0.04, s: x, t: -0.89, sq: 0.6 }, { a: 1.46, w: 0.13, h: 0.05, s: x, t: -0.9, sq: 0.6 }], hide, 1, LEATHER, { n: 12, axis: 'y' });
        }
        loft(K, R, [{ a: -0.68, w: 0.08, h: 0.05, t: 0.82, sq: 0.6 }, { a: 0.3, w: 0.09, h: 0.08, t: 0.8, sq: 0.7 }], '#2a1e18', 1, LEATHER, { n: 10 });
        loft(K, R, [{ a: -0.72, w: 0.07, h: 0.06, s: -1.0, t: 0.86, sq: 0.6 }, { a: 0.72, w: 0.07, h: 0.06, s: -1.0, t: 0.86, sq: 0.6 }], '#c8b490', 1, CLOTH, { n: 12, axis: 'x' });
        // the dash and its dials, the wheel on a column
        loft(K, R, [{ a: -0.8, w: 0.1, h: 0.08, s: 0.42, t: 0.86, sq: 0.7 }, { a: 0.8, w: 0.1, h: 0.08, s: 0.42, t: 0.86, sq: 0.7 }], '#1e1612', 1, LEATHER, { n: 12, axis: 'x' });
        for (let i = 0; i < 5; i++) { const x = 0.52 - i * 0.11; spin(K, R, 'z', [x, 0.88, 0.3], [[0, 0], [0.04, 0], [0.042, -0.012], [0, -0.012]], chrome, 1.1, 12, METAL); disc(K, R, 'z', [x, 0.88, 0.288], 0.035, '#f4f0e0', 1.3, 12, EMISSIVE, -1); }
        tube(K, R, [0.38, 0.84, 0.36], [0.38, 0.97, 0.12], 0.02, dark, 1, 8, METAL);
        hoop(K, R, 'z', [0.38, 0.98, 0.1], 0.19, 0.016, '#d8c8a8', 1, 22, SATIN);
        for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + i * TAU / 3; tube(K, R, [0.38, 0.98, 0.1], [0.38 + Math.cos(a) * 0.18, 0.98 + Math.sin(a) * 0.18, 0.1], 0.008, chrome, 1, 4, METAL); }
        disc(K, R, 'z', [0.38, 0.98, 0.095], 0.04, chrome, 1.1, 12, METAL, -1);
        // a raked windscreen in a chrome frame
        const ws = (x, t) => [x, 0.86 + t * 0.4, 0.58 - t * 0.22];
        face(K, R, [ws(-0.78, 0), ws(0.78, 0), ws(0.74, 1), ws(-0.74, 1)], [0, 0.48, 0.88], '#9ec4dc', 0.7, GLOSS);
        path(K, R, [ws(-0.8, -0.02), ws(-0.76, 1.02), ws(0.76, 1.02), ws(0.8, -0.02)], 0.018, chrome, 1.1, 8, METAL);
        for (const s of [-1, 1]) { tube(K, R, [s * 0.86, 0.86, 0.5], [s * 0.96, 0.95, 0.48], 0.012, chrome, 1, 6, METAL); loft(K, R, [{ a: 0.43, w: 0.07, h: 0.045, s: s * 1.0, t: 0.97, sq: 0.4 }, { a: 0.5, w: 0.07, h: 0.045, s: s * 1.0, t: 0.97, sq: 0.4 }], chrome, 1.1, METAL, { n: 12 }); }
        // wheels in dark arches, wire wheels with white walls
        for (const [z, s] of [[WF, 1], [WF, -1], [WR, 1], [WR, -1]]) {
          wheel(K, R, [s * WX, WY, z], 0.34, 0.22, { spokes: 40, rim: chrome, wall: '#f2f0e6', side: s });
          spin(K, R, 'x', [s * (WX + 0.13), WY, z], [[0, 0], [0.05, 0], [0.04, s * 0.04], [0, s * 0.05]], chrome, 1.2, 8, METAL);
          for (let i = 0; i < 2; i++) { const a = i * Math.PI / 2 + Math.PI / 4; tube(K, R, [s * (WX + 0.15), WY, z], [s * (WX + 0.15), WY + Math.sin(a) * 0.09, z + Math.cos(a) * 0.09], 0.012, chrome, 1.15, 4, METAL); }
          const R2 = 0.4, X = s * 0.905;
          arc(14, 0, Math.PI, (a, b) => { face(K, R, [[X, WY, z], [X, WY + Math.sin(a) * R2, z + Math.cos(a) * R2], [X, WY + Math.sin(b) * R2, z + Math.cos(b) * R2], [X, WY + Math.sin(b) * R2, z + Math.cos(b) * R2]], [s, 0, 0], dark, 1, SATIN); tube(K, R, [X + s * 0.01, WY + Math.sin(a) * R2, z + Math.cos(a) * R2], [X + s * 0.01, WY + Math.sin(b) * R2, z + Math.cos(b) * R2], 0.012, chrome, 1.05, 4, METAL); });
        }
        // down each flank: the door's shut line, a handle, a chrome spear
        for (const s of [-1, 1]) {
          const X = s * 0.895;
          for (const z of [-0.95, 0.4]) face(K, R, [[X, 0.36, z], [X, 0.8, z], [X, 0.8, z + 0.012], [X, 0.36, z + 0.012]], [s, 0, 0], dark, 1, SATIN);
          rbox(K, R, X - 0.02, X + 0.02, 0.7, 0.72, -0.8, -0.65, chrome, 1.1, METAL);
          tube(K, R, [s * 0.9, 0.52, -1.9], [s * 0.905, 0.55, 1.75], 0.008, chrome, 1.1, 6, METAL);
        }
        // the nose: an oval grille with its bars, round lamps in nacelles, the badge
        const nz = 2.24;
        loft(K, R, [{ a: nz - 0.04, w: 0.3, h: 0.1, t: 0.44, sq: 0.3 }, { a: nz + 0.035, w: 0.33, h: 0.12, t: 0.44, sq: 0.3 }], chrome, 1.15, METAL, { n: 18, open: true });
        loft(K, R, [{ a: nz - 0.05, w: 0.29, h: 0.095, t: 0.44, sq: 0.3 }, { a: nz + 0.02, w: 0.29, h: 0.095, t: 0.44, sq: 0.3 }], dark, 1, SATIN, { n: 18 });
        for (let i = -6; i <= 6; i++) tube(K, R, [i * 0.04, 0.36, nz + 0.03], [i * 0.04, 0.52, nz + 0.03], 0.005, chrome, 1.1, 4, METAL);
        for (const s of [-1, 1]) {
          spin(K, R, 'z', [s * 0.58, 0.56, 1.96], [[0.085, 0], [0.09, 0.07], [0.082, 0.1], [0.07, 0.105]], chrome, 1.15, 18, METAL);
          disc(K, R, 'z', [s * 0.58, 0.56, 2.055], 0.07, '#fff8dc', 1.8, 18, EMISSIVE);
          spin(K, R, 'z', [s * 0.35, 0.36, 2.2], [[0.04, 0], [0.04, 0.04], [0, 0.045]], '#ffb030', 1.6, 10, EMISSIVE);
        }
        spin(K, R, 'z', [0, 0.62, 2.12], [[0.05, 0], [0.05, 0.02], [0, 0.025]], '#c8a040', 1.2, 14, METAL);
        // bumpers: a blade across each end, wrapping round the corners, with overriders
        path(K, R, [[-0.82, 0.3, 2.05], [-0.7, 0.3, 2.26], [0.7, 0.3, 2.26], [0.82, 0.3, 2.05]], 0.028, chrome, 1.15, 10, METAL);
        path(K, R, [[-0.86, 0.32, -2.0], [-0.72, 0.32, -2.27], [0.72, 0.32, -2.27], [0.86, 0.32, -2.0]], 0.028, chrome, 1.15, 10, METAL);
        for (const s of [-1, 1]) { tube(K, R, [s * 0.3, 0.24, 2.27], [s * 0.3, 0.42, 2.27], 0.03, chrome, 1.15, 8, METAL, true); tube(K, R, [s * 0.3, 0.26, -2.28], [s * 0.3, 0.44, -2.28], 0.03, chrome, 1.15, 8, METAL, true); }
        // the tail: lamps either side, a plate, twin pipes
        for (const s of [-1, 1]) { spin(K, R, 'z', [s * 0.6, 0.58, -2.12], [[0.07, 0], [0.065, -0.06], [0, -0.065]], '#e01a1a', 1.7, 14, EMISSIVE); spin(K, R, 'z', [s * 0.6, 0.58, -2.1], [[0.075, 0.01], [0.075, -0.02]], chrome, 1.1, 14, METAL); }
        rbox(K, R, -0.17, 0.17, 0.38, 0.5, -2.24, -2.22, '#f4f0e0', 1.1, SATIN);
        rbox(K, R, -0.14, 0.14, 0.42, 0.46, -2.245, -2.24, '#1a2a6a', 1, SATIN);
        for (const s of [-1, 1]) spin(K, R, 'z', [s * 0.45, 0.22, -2.1], [[0.035, 0], [0.04, -0.2], [0.03, -0.21], [0, -0.21]], chrome, 1.15, 12, METAL);
      },
    },
    coast_road: {
      label: 'Coast road (asphalt, lines and a crash barrier)', fields: [F('w', 'Width'), F('depth', 'Length'), F('yaw', 'Runs toward (°)'), F('rail', 'Barrier side (-1/0/1)')],
      make: { at: [0, 0], yaw: 0, w: 3.4, depth: 9, rail: -1 },
      draw(K, p) {
        const w = num(p.w, 3.4), d = num(p.depth, 9), R = rig(K, p, 0), roll = rollOf(23), rail = num(p.rail, -1);
        face(K, R, [[-w / 2, 0.012, -d / 2], [w / 2, 0.012, -d / 2], [w / 2, 0.012, d / 2], [-w / 2, 0.012, d / 2]], [0, 1, 0], '#4a4a50', 1, SATIN);
        for (let i = 0; i < d * 6; i++) { const x = (roll() - 0.5) * w, z = (roll() - 0.5) * d, s = 0.1 + roll() * 0.3; face(K, R, [[x, 0.013, z], [x + s, 0.013, z], [x + s, 0.013, z + s * 0.6], [x, 0.013, z + s * 0.6]], [0, 1, 0], roll() < 0.5 ? '#424248' : '#55555c', 1, SATIN); }
        for (let z = -d / 2; z < d / 2; z += 0.9) face(K, R, [[-0.05, 0.015, z], [0.05, 0.015, z], [0.05, 0.015, z + 0.5], [-0.05, 0.015, z + 0.5]], [0, 1, 0], '#f4c430', 1.1, SATIN);
        for (const s of [-1, 1]) face(K, R, [[s * (w / 2 - 0.12), 0.015, -d / 2], [s * (w / 2 - 0.06), 0.015, -d / 2], [s * (w / 2 - 0.06), 0.015, d / 2], [s * (w / 2 - 0.12), 0.015, d / 2]], [0, 1, 0], '#f4f4f0', 1.1, SATIN);
        if (rail) {
          const x = rail * (w / 2 + 0.25);
          for (let z = -d / 2 + 0.3; z < d / 2; z += 1.6) rbox(K, R, x - 0.05, x + 0.05, 0, 0.62, z - 0.05, z + 0.05, '#9a9aa0', 1, METAL);
          loft(K, R, [{ a: -d / 2, w: 0.04, h: 0.16, s: x - rail * 0.07, t: 0.52, sq: 0.9 }, { a: d / 2, w: 0.04, h: 0.16, s: x - rail * 0.07, t: 0.52, sq: 0.9 }], '#c8ccd2', 1.05, METAL, { n: 8, axis: 'z' });
          for (let z = -d / 2 + 0.3; z < d / 2; z += 3.2) face(K, R, [[x - rail * 0.115, 0.48, z - 0.06], [x - rail * 0.115, 0.48, z + 0.06], [x - rail * 0.115, 0.56, z + 0.06], [x - rail * 0.115, 0.56, z - 0.06]], [-rail, 0, 0], '#f0a020', 1.4, EMISSIVE);
        }
      },
    },
    // ── a beach ──
    beach_umbrella: {
      label: 'Beach umbrella', fields: [F('tilt', 'Tilt (°)'), F('yaw', 'Tilts toward (°)'), F('colour', 'Stripe colour', 'text')],
      make: { at: [0, 0], tilt: 12, yaw: 180, colour: '#e83a3a' },
      draw(K, p) {
        const R = rig(K, p, 180), t = num(p.tilt, 12) * Math.PI / 180, c = p.colour || '#e83a3a', H = 2.1, top = [0, H * Math.cos(t), H * Math.sin(t)];
        tube(K, R, [0, -0.2, 0], top, 0.022, '#e8e4d8', 1, 8, METAL);
        const ax = [0, Math.cos(t), Math.sin(t)], e1 = [1, 0, 0], e2 = [0, -Math.sin(t), Math.cos(t)], rad = 1.15, n = 16;
        const pt = (a, r, dy) => [top[0] + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * r + ax[0] * dy, top[1] + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * r + ax[1] * dy, top[2] + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * r + ax[2] * dy];
        for (let i = 0; i < n; i++) {
          const a = i / n * TAU, b = (i + 1) / n * TAU, col = i % 2 ? '#f8f6ee' : c, ah = (a + b) / 2;
          face(K, R, [pt(a, 0.02, 0.06), pt(a, rad, -0.32), pt(ah, rad * 0.97, -0.28), pt(ah, 0.02, 0.06)], ax, col, 1.05, CLOTH);
          face(K, R, [pt(ah, 0.02, 0.06), pt(ah, rad * 0.97, -0.28), pt(b, rad, -0.32), pt(b, 0.02, 0.06)], ax, col, 1.05, CLOTH);
          face(K, R, [pt(a, rad, -0.32), pt(b, rad, -0.32), pt(b, rad, -0.4), pt(a, rad, -0.4)], [Math.cos(ah), 0, Math.sin(ah)], col, 1, CLOTH);
        }
        sphere(K, R, pt(0, 0, 0.1), 0.035, '#e8e4d8', 1.1, 8, METAL);
      },
    },
    beach_towel: {
      label: 'Beach towel', fields: [F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text'), F('colour2', 'Stripe colour', 'text')],
      make: { at: [0, 0], yaw: 180, colour: '#2a8ad0', colour2: '#f4f0e0' },
      draw(K, p) {
        const R = rig(K, p), a = p.colour || '#2a8ad0', b = p.colour2 || '#f4f0e0', W = 0.4, L = 0.85, n = 9;
        for (let i = 0; i < n; i++) { const z0 = -L + i * 2 * L / n; face(K, R, [[-W, 0.014, z0], [W, 0.014, z0], [W, 0.014, z0 + 2 * L / n], [-W, 0.014, z0 + 2 * L / n]], [0, 1, 0], i % 2 ? b : a, 1, CLOTH); }
        for (const s of [-1, 1]) for (let x = -W; x <= W; x += 0.05) tube(K, R, [x, 0.014, s * L], [x, 0.014, s * (L + 0.05)], 0.004, b, 1, 3, CLOTH);
      },
    },
    surfboard: {
      label: 'Surfboard, stood in the sand', fields: [F('yaw', 'Facing (°)'), F('lean', 'Lean (°)'), F('colour', 'Colour', 'text')],
      make: { at: [0, 0], yaw: 180, lean: 6, colour: '#f4d040' },
      draw(K, p) {
        const R = rig(K, p, 180, num(p.lean, 6) * Math.PI / 180), c = p.colour || '#f4d040', L = 2.2;
        const secs = Array.from({ length: 11 }, (_, i) => { const t = i / 10, wd = 0.28 * Math.sin(Math.min(1, t * 1.15) * Math.PI) ** 0.6 + 0.01; return { a: -0.25 + t * L, w: wd, h: 0.03, sq: 0.5 }; });
        loft(K, R, secs, c, 1.05, GLOSS, { n: 14, axis: 'y' });
        loft(K, R, secs.map((s) => ({ ...s, w: 0.012, h: 0.032 })), '#f4f4f0', 1.1, GLOSS, { n: 6, axis: 'y' });
        loft(K, R, [{ a: 0.6, w: 0.2, h: 0.032, sq: 0.5, s: 0 }, { a: 0.72, w: 0.22, h: 0.032, sq: 0.5, s: 0 }], '#e83a3a', 1.1, GLOSS, { n: 12, axis: 'y' });
      },
    },
    lifeguard_tower: {
      label: 'Lifeguard tower', fields: [F('yaw', 'Facing (°)')],
      make: { at: [0, 0], yaw: 180 },
      draw(K, p) {
        const R = rig(K, p), wood = '#e8e0d0', blue = '#3a9ad8', red = '#d83a2a', H = 1.9;
        for (const x of [-0.8, 0.8]) for (const z of [-0.7, 0.7]) tube(K, R, [x * 1.08, 0, z * 1.08], [x, H, z], 0.06, wood, 1, 8, SATIN);
        rbox(K, R, -1.0, 1.0, H, H + 0.08, -0.85, 0.95, wood, 1, SATIN);
        // the hut: walls with a wide window to the sea, a pitched roof, a red cross
        rbox(K, R, -0.8, 0.8, H + 0.08, H + 1.3, -0.75, -0.65, blue, 1, SATIN);
        for (const s of [-1, 1]) rbox(K, R, s * 0.8 - 0.05, s * 0.8 + 0.05, H + 0.08, H + 1.3, -0.75, 0.55, blue, 0.95, SATIN);
        rbox(K, R, -0.8, 0.8, H + 0.08, H + 0.6, 0.5, 0.55, blue, 1, SATIN);
        rbox(K, R, -0.8, 0.8, H + 1.2, H + 1.3, 0.5, 0.55, blue, 1, SATIN);
        face(K, R, [[-0.75, H + 0.6, 0.5], [0.75, H + 0.6, 0.5], [0.75, H + 1.2, 0.5], [-0.75, H + 1.2, 0.5]], [0, 0, 1], '#6a90a8', 0.7, GLOSS);
        for (const s of [-1, 1]) face(K, R, [[-1.0, H + 1.3, s * 0.95], [1.0, H + 1.3, s * 0.95], [1.0, H + 1.7, 0], [-1.0, H + 1.7, 0]], [0, 0.9, s * 0.4], s > 0 ? '#e85a3a' : '#d84a2a', 1, SATIN);
        rbox(K, R, -0.2, 0.2, H + 0.28, H + 0.36, 0.555, 0.565, red, 1.2, SATIN); rbox(K, R, -0.04, 0.04, H + 0.12, H + 0.52, 0.555, 0.565, red, 1.2, SATIN);
        // a rail round the deck, a ramp down to the sand, a flag
        for (const x of [-1, 1]) tube(K, R, [x, H + 0.08, 0.95], [x, H + 0.95, 0.95], 0.025, wood, 1, 6, SATIN);
        tube(K, R, [-1, H + 0.95, 0.95], [1, H + 0.95, 0.95], 0.025, wood, 1, 6, SATIN);
        // the ramp: a sloped deck on two stringers, cleats across it, a handrail up one side
        const r0 = [-1.0, H], r1 = [-3.0, 0];
        face(K, R, [[r0[0], r0[1] + 0.04, -0.35], [r0[0], r0[1] + 0.04, 0.35], [r1[0], r1[1] + 0.04, 0.35], [r1[0], r1[1] + 0.04, -0.35]], [0.7, 0.7, 0], wood, 0.98, SATIN);
        for (const z of [-0.36, 0.36]) loft(K, R, [{ a: r1[0], w: 0.12, h: 0.03, s: r1[1] - 0.04, t: z, sq: 0.9 }, { a: r0[0], w: 0.12, h: 0.03, s: r0[1] - 0.04, t: z, sq: 0.9 }].map((q) => ({ a: q.a, w: 0.03, h: 0.12, s: q.t, t: q.s, sq: 0.9 })), shade(wood, 0.85), 1, SATIN, { n: 8, axis: 'x' });
        for (let i = 1; i < 10; i++) { const t = i / 10, x = r0[0] + (r1[0] - r0[0]) * t, y = r0[1] * (1 - t) + 0.05; rbox(K, R, x - 0.03, x + 0.03, y, y + 0.03, -0.33, 0.33, shade(wood, 0.8), 1, SATIN); }
        tube(K, R, [r1[0], 0.9, 0.36], [r0[0], H + 0.9, 0.36], 0.022, wood, 1, 6, SATIN);
        for (const t of [0, 0.5, 1]) { const x = r1[0] + (r0[0] - r1[0]) * t, y = H * t; tube(K, R, [x, y, 0.36], [x, y + 0.9, 0.36], 0.02, wood, 1, 6, SATIN); }
        tube(K, R, [0.75, H + 1.3, -0.7], [0.75, H + 2.5, -0.7], 0.02, '#c8c8cc', 1, 6, METAL);
        face(K, R, [[0.75, H + 2.45, -0.7], [0.75, H + 2.15, -0.7], [1.3, H + 2.25, -0.65], [1.3, H + 2.35, -0.65]], [0, 0, 1], red, 1.3, CLOTH);
      },
    },
    cooler: {
      label: 'Cool box', fields: [F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text')],
      make: { at: [0, 0], yaw: 180, colour: '#d83a2a' },
      draw(K, p) {
        const R = rig(K, p), c = p.colour || '#d83a2a';
        loft(K, R, [{ a: -0.3, w: 0.2, h: 0.17, t: 0.17, sq: 0.85 }, { a: 0.3, w: 0.2, h: 0.17, t: 0.17, sq: 0.85 }], c, 1, GLOSS, { n: 16, axis: 'x' });
        loft(K, R, [{ a: -0.31, w: 0.21, h: 0.04, t: 0.36, sq: 0.85 }, { a: 0.31, w: 0.21, h: 0.04, t: 0.36, sq: 0.85 }], '#f4f4f0', 1.05, GLOSS, { n: 16, axis: 'x' });
        path(K, R, [[-0.2, 0.4, 0], [-0.15, 0.48, 0], [0.15, 0.48, 0], [0.2, 0.4, 0]], 0.012, '#f4f4f0', 1, 6, SATIN);
      },
    },
    beach_ball: {
      label: 'Beach ball', fields: [F('r', 'Radius')],
      make: { at: [0, 0], r: 0.2 },
      draw(K, p) {
        const r = num(p.r, 0.2), R = rig(K, p), cols = ['#e83a3a', '#f8f6ee', '#3a8ad8', '#f8f6ee', '#f4c430', '#f8f6ee'];
        for (let i = 0; i < 6; i++) {
          const a0 = i / 6 * TAU, a1 = (i + 1) / 6 * TAU;
          arc(8, -Math.PI / 2, Math.PI / 2, (b0, b1) => {
            const pt = (a, b) => [Math.cos(a) * Math.cos(b) * r, r + Math.sin(b) * r, Math.sin(a) * Math.cos(b) * r];
            const am = (a0 + a1) / 2, bm = (b0 + b1) / 2;
            face(K, R, [pt(a0, b0), pt(a1, b0), pt(a1, b1), pt(a0, b1)], [Math.cos(am) * Math.cos(bm), Math.sin(bm), Math.sin(am) * Math.cos(bm)], cols[i], 1.05, GLOSS);
          });
        }
      },
    },
    rocks: {
      label: 'Rocks', fields: [F('w', 'Spread'), F('seed', 'Seed'), F('colour', 'Colour', 'text')],
      make: { at: [0, 0], w: 1.2, seed: 1 },
      draw(K, p) {
        const w = num(p.w, 1.2), roll = rollOf(num(p.seed, 1) + 31), c = p.colour || '#8a7e70';
        for (let i = 0; i < 6; i++) { const r = (0.12 + roll() * 0.3) * w; K.ball(p.at[0] + (roll() - 0.5) * w, p.at[1] + (roll() - 0.5) * w * 0.6, r * 0.45, r, shade(c, 0.8 + roll() * 0.35), 1, 6, SATIN); }
      },
    },
    // ── a kitchen ──
    checker_floor: {
      label: 'Lino tiles', fields: [F('w', 'Width'), F('depth', 'Depth'), F('tile', 'Tile size'), F('colour', 'Colour', 'text'), F('colour2', 'Second colour', 'text')],
      make: { at: [0, 0], w: 4, depth: 4, tile: 0.3, colour: '#e8e2d0', colour2: '#3a4a5a' },
      draw(K, p) {
        const w = num(p.w, 4), d = num(p.depth, 4), t = num(p.tile, 0.3), R = rig(K, p, 0), a = p.colour || '#e8e2d0', b = p.colour2 || '#3a4a5a', roll = rollOf(41);
        for (let i = 0; i * t < w - 1e-6; i++) for (let j = 0; j * t < d - 1e-6; j++) {
          const x0 = -w / 2 + i * t, z0 = -d / 2 + j * t, x1 = Math.min(w / 2, x0 + t), z1 = Math.min(d / 2, z0 + t), dirt = 0.85 + roll() * 0.15;
          face(K, R, [[x0, 0.004, z0], [x1, 0.004, z0], [x1, 0.004, z1], [x0, 0.004, z1]], [0, 1, 0], shade((i + j) % 2 ? a : b, dirt), 1, GLOSS);
        }
      },
    },
    wallpaper: {
      label: 'Wallpaper', fields: [F('w', 'Width'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text'), F('colour2', 'Stripe colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 4, h: 2.4, colour: '#c8b880', colour2: '#b0a068' },
      draw(K, p) {
        const w = num(p.w, 4), h = num(p.h, 2.4), R = rig(K, p), a = p.colour || '#c8b880', b = p.colour2 || '#b0a068';
        for (let x = -w / 2, i = 0; x < w / 2 - 1e-6; x += 0.12, i++) face(K, R, [[x, 0, 0], [Math.min(w / 2, x + 0.12), 0, 0], [Math.min(w / 2, x + 0.12), h, 0], [x, h, 0]], [0, 0, 1], i % 2 ? b : a, 1, SATIN);
        for (let x = -w / 2 + 0.06; x < w / 2; x += 0.24) for (let y = 0.2; y < h; y += 0.32) { const q = (y * 3) % 2 ? 0.12 : 0; flat(K, R, [[x + q, y + 0.04], [x + q + 0.035, y], [x + q, y - 0.04], [x + q - 0.035, y]], 0.002, shade(b, 0.8), 1); }
        rbox(K, R, -w / 2, w / 2, 0, 0.12, 0, 0.02, '#f0ece0', 1, SATIN);
      },
    },
    kitchen_counter: {
      label: 'Kitchen counter with a sink', fields: [F('w', 'Width'), F('yaw', 'Facing (°)'), F('colour', 'Cupboard colour', 'text'), F('mess', 'Dirty dishes (0/1)')],
      make: { at: [0, 0], yaw: 180, w: 2.4, colour: '#8a9a7a', mess: 1 },
      draw(K, p) {
        const w = num(p.w, 2.4), R = rig(K, p), cab = p.colour || '#8a9a7a', top = '#e8e0c8', chrome = '#d8d8dc', D = 0.6, H = 0.9;
        // the cupboards and drawers under, a kick board, handles
        rbox(K, R, -w / 2, w / 2, 0, 0.1, -D + 0.05, -0.06, '#2a2a28', 1, SATIN);
        const n = Math.max(2, Math.round(w / 0.6)), dw = w / n;
        for (let i = 0; i < n; i++) {
          const x0 = -w / 2 + i * dw;
          rbox(K, R, x0 + 0.01, x0 + dw - 0.01, 0.1, H - 0.22, -D, -0.0, cab, 1, SATIN);
          rbox(K, R, x0 + 0.01, x0 + dw - 0.01, H - 0.21, H - 0.04, -D, -0.0, shade(cab, 1.04), 1, SATIN);
          rbox(K, R, x0 + dw / 2 - 0.06, x0 + dw / 2 + 0.06, H - 0.14, H - 0.12, 0, 0.02, chrome, 1.1, METAL);
          rbox(K, R, i % 2 ? x0 + 0.05 : x0 + dw - 0.07, i % 2 ? x0 + 0.07 : x0 + dw - 0.05, 0.45, 0.6, 0, 0.02, chrome, 1.1, METAL);
        }
        rbox(K, R, -w / 2 - 0.02, w / 2 + 0.02, H - 0.04, H, -D - 0.02, 0.03, top, 1, GLOSS);
        // tiles up the wall behind
        for (let x = -w / 2, i = 0; x < w / 2 - 1e-6; x += 0.15, i++) for (let y = H, j = 0; y < H + 0.6 - 1e-6; y += 0.15, j++) face(K, R, [[x + 0.004, y + 0.004, -D + 0.002], [x + 0.146, y + 0.004, -D + 0.002], [x + 0.146, y + 0.146, -D + 0.002], [x + 0.004, y + 0.146, -D + 0.002]], [0, 0, 1], (i + j) % 2 ? '#f0ece0' : '#e4dcc8', 1, GLOSS);
        // the sink, a tap, a drainer
        const sx = -w * 0.15;
        rbox(K, R, sx - 0.3, sx + 0.3, H - 0.002, H + 0.004, -0.5, -0.08, chrome, 1.05, METAL);
        rbox(K, R, sx - 0.26, sx + 0.26, H - 0.18, H - 0.001, -0.47, -0.11, '#8a8a90', 0.8, METAL);
        path(K, R, [[sx, H, -0.52], [sx, H + 0.28, -0.52], [sx, H + 0.32, -0.45], [sx, H + 0.26, -0.36]], 0.016, chrome, 1.15, 8, METAL);
        for (const s of [-1, 1]) spin(K, R, 'y', [sx + s * 0.1, H, -0.52], [[0.02, 0], [0.02, 0.06], [0.035, 0.07], [0, 0.08]], chrome, 1.1, 8, METAL);
        if (num(p.mess, 1)) {
          // a pile in the sink and on the drainer: plates, a pan, mugs, a bottle
          for (let i = 0; i < 5; i++) spin(K, R, 'y', [sx + 0.04 * Math.sin(i), H - 0.17 + i * 0.03, -0.29], [[0.1, 0], [0.13, 0.01], [0.13, 0.016], [0, 0.016]], i % 2 ? '#f0ecdc' : '#d8d0c0', 1, 14, GLOSS);
          spin(K, R, 'y', [sx + 0.36, H, -0.3], [[0.12, 0], [0.12, 0.08], [0.125, 0.085], [0, 0.085]], '#2a2a2c', 1, 14, METAL);
          tube(K, R, [sx + 0.48, H + 0.06, -0.3], [sx + 0.72, H + 0.07, -0.3], 0.015, '#2a2a2c', 1, 6, METAL);
          for (const [x, z] of [[0.55, -0.48], [0.68, -0.4]]) { spin(K, R, 'y', [sx + x, H, z], [[0.04, 0], [0.045, 0.1], [0, 0.1]], '#e8e0d0', 1, 12, GLOSS); }
          spin(K, R, 'y', [w / 2 - 0.25, H, -0.45], [[0.035, 0], [0.036, 0.2], [0.014, 0.26], [0.013, 0.31], [0, 0.31]], '#2a5a20', 1.05, 10, GLOSS);
        }
        // a kettle and a toaster
        spin(K, R, 'y', [w / 2 - 0.5, H, -0.4], [[0.1, 0], [0.11, 0.12], [0.08, 0.2], [0.03, 0.22], [0, 0.23]], chrome, 1.1, 14, METAL);
        path(K, R, [[w / 2 - 0.58, H + 0.18, -0.4], [w / 2 - 0.5, H + 0.27, -0.4], [w / 2 - 0.42, H + 0.18, -0.4]], 0.012, '#1a1a1a', 1, 6, SATIN);
        rbox(K, R, -w / 2 + 0.15, -w / 2 + 0.45, H, H + 0.2, -0.5, -0.32, '#e8e4d8', 1.05, GLOSS);
        for (const x of [-w / 2 + 0.25, -w / 2 + 0.35]) rbox(K, R, x - 0.015, x + 0.015, H + 0.2, H + 0.201, -0.47, -0.35, '#1a1a1a', 1, SATIN);
      },
    },
    wall_cabinets: {
      label: 'Wall cupboards', fields: [F('w', 'Width'), F('yaw', 'Facing (°)'), F('y', 'Off the floor'), F('colour', 'Colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 2, y: 1.5, colour: '#8a9a7a' },
      draw(K, p) {
        const w = num(p.w, 2), R = rig(K, p), c = p.colour || '#8a9a7a', n = Math.max(2, Math.round(w / 0.5)), dw = w / n;
        rbox(K, R, -w / 2, w / 2, 0, 0.7, -0.34, -0.02, shade(c, 0.9), 1, SATIN);
        for (let i = 0; i < n; i++) {
          const x0 = -w / 2 + i * dw;
          rbox(K, R, x0 + 0.01, x0 + dw - 0.01, 0.02, 0.68, -0.02, 0, c, 1, SATIN);
          rbox(K, R, x0 + 0.05, x0 + dw - 0.05, 0.08, 0.62, 0, 0.008, shade(c, 1.06), 1, SATIN);
          rbox(K, R, i % 2 ? x0 + 0.06 : x0 + dw - 0.08, i % 2 ? x0 + 0.08 : x0 + dw - 0.06, 0.1, 0.22, 0.008, 0.025, '#d8d8dc', 1.1, METAL);
        }
      },
    },
    fridge: {
      label: 'Fridge (an old round-shouldered one)', fields: [F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text')],
      make: { at: [0, 0], yaw: 180, colour: '#ece6d4' },
      draw(K, p) {
        const R = rig(K, p), c = p.colour || '#ece6d4', chrome = '#dcdce2';
        loft(K, R, [{ a: 0.02, w: 0.38, h: 0.32, t: 0, sq: 0.8 }, { a: 1.55, w: 0.38, h: 0.32, t: 0, sq: 0.8 }, { a: 1.68, w: 0.34, h: 0.28, t: -0.01, sq: 0.6 }], c, 1.02, GLOSS, { n: 24, axis: 'y' });
        rbox(K, R, -0.36, 0.36, 0, 0.1, -0.28, 0.3, '#3a3a3a', 1, SATIN);
        face(K, R, [[-0.37, 1.2, 0.322], [0.37, 1.2, 0.322], [0.37, 1.21, 0.322], [-0.37, 1.21, 0.322]], [0, 0, 1], '#8a8478', 1, SATIN);
        // the lever handle, the badge, magnets and a couple of notes
        loft(K, R, [{ a: 0.95, w: 0.025, h: 0.03, s: -0.3, t: 0.34, sq: 0.6 }, { a: 1.45, w: 0.025, h: 0.03, s: -0.3, t: 0.34, sq: 0.6 }], chrome, 1.15, METAL, { n: 10, axis: 'y' });
        rbox(K, R, -0.08, 0.08, 1.45, 1.48, 0.32, 0.326, chrome, 1.15, METAL);
        for (const [x, y, col, w2] of [[0.1, 1.05, '#f4f0e0', 0.1], [-0.1, 0.8, '#f8e870', 0.08], [0.2, 0.6, '#f4f0e0', 0.12]]) { face(K, R, [[x - w2, y - w2 * 1.2, 0.324], [x + w2, y - w2 * 1.2, 0.324], [x + w2, y + w2 * 1.2, 0.324], [x - w2, y + w2 * 1.2, 0.324]], [0, 0, 1], col, 1.05, SATIN); spin(K, R, 'z', [x, y + w2 * 1.1, 0.325], [[0, 0], [0.018, 0], [0.018, 0.01], [0, 0.012]], '#e83a3a', 1.1, 8, GLOSS); }
      },
    },
    stove: {
      label: 'Cooker', fields: [F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text')],
      make: { at: [0, 0], yaw: 180, colour: '#ece6d4' },
      draw(K, p) {
        const R = rig(K, p), c = p.colour || '#ece6d4', chrome = '#dcdce2';
        rbox(K, R, -0.32, 0.32, 0, 0.9, -0.3, 0.3, c, 1.02, GLOSS);
        rbox(K, R, -0.32, 0.32, 0.9, 0.92, -0.3, 0.3, '#2a2a2c', 1, METAL);
        rbox(K, R, -0.33, 0.33, 0.92, 1.12, -0.32, -0.26, c, 1, GLOSS);
        for (let i = 0; i < 4; i++) spin(K, R, 'z', [-0.22 + i * 0.145, 1.02, -0.26], [[0, 0], [0.025, 0], [0.025, 0.025], [0, 0.03]], '#1a1a1a', 1, 10, GLOSS);
        // the door's window, the handle, four coil rings
        rbox(K, R, -0.24, 0.24, 0.3, 0.62, 0.3, 0.31, '#1a1612', 1, GLOSS);
        tube(K, R, [-0.25, 0.72, 0.34], [0.25, 0.72, 0.34], 0.012, chrome, 1.15, 8, METAL);
        for (const s of [-1, 1]) tube(K, R, [s * 0.22, 0.72, 0.34], [s * 0.22, 0.72, 0.3], 0.01, chrome, 1.1, 6, METAL);
        for (const [x, z] of [[-0.15, -0.12], [0.15, -0.12], [-0.15, 0.14], [0.15, 0.14]]) for (const rr of [0.04, 0.07, 0.1]) hoop(K, R, 'y', [x, 0.925, z], rr, 0.006, '#3a3a3a', 1, 14, METAL);
        // a pan left on the back ring
        spin(K, R, 'y', [0.15, 0.93, -0.12], [[0.1, 0], [0.11, 0.08], [0.115, 0.085], [0, 0.085]], '#6a6a70', 1, 14, METAL);
        tube(K, R, [0.25, 0.99, -0.12], [0.45, 1.0, -0.12], 0.012, '#1a1a1a', 1, 6, SATIN);
      },
    },
    kitchen_window: {
      label: 'Window with curtains and a view', fields: [F('w', 'Width'), F('h', 'Height'), F('y', 'Sill height'), F('yaw', 'Facing (°)'), F('colour', 'Curtain colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 1.2, h: 0.9, y: 1.05, colour: '#e8c860' },
      draw(K, p) {
        const w = num(p.w, 1.2), h = num(p.h, 0.9), R = rig(K, p), cur = p.colour || '#e8c860', frameC = '#f0ece0';
        // the view: a pale sky, a fence and the house next door
        for (let i = 0; i < 8; i++) { const t = i / 8; face(K, R, [[-w / 2, h * t, -0.02], [w / 2, h * t, -0.02], [w / 2, h * (t + 0.125), -0.02], [-w / 2, h * (t + 0.125), -0.02]], [0, 0, 1], mixHex('#e8f0f0', '#8ab8d8', t), 1.4, EMISSIVE); }
        face(K, R, [[-w / 2, 0, -0.019], [w * 0.15, 0, -0.019], [w * 0.15, h * 0.7, -0.019], [-w / 2, h * 0.7, -0.019]], [0, 0, 1], '#c8a888', 1.3, EMISSIVE);
        for (let i = 0; i < 3; i++) face(K, R, [[-w / 2 + 0.08 + i * 0.2, h * 0.3, -0.018], [-w / 2 + 0.2 + i * 0.2, h * 0.3, -0.018], [-w / 2 + 0.2 + i * 0.2, h * 0.5, -0.018], [-w / 2 + 0.08 + i * 0.2, h * 0.5, -0.018]], [0, 0, 1], '#5a6a78', 1.3, EMISSIVE);
        face(K, R, [[-w / 2, 0, -0.017], [w / 2, 0, -0.017], [w / 2, h * 0.2, -0.017], [-w / 2, h * 0.2, -0.017]], [0, 0, 1], '#8a6a48', 1.3, EMISSIVE);
        // the frame and its bars, the sill with a dead plant
        for (const [x0, x1, y0, y1] of [[-w / 2 - 0.06, w / 2 + 0.06, -0.06, 0], [-w / 2 - 0.06, w / 2 + 0.06, h, h + 0.06], [-w / 2 - 0.06, -w / 2, 0, h], [w / 2, w / 2 + 0.06, 0, h], [-0.02, 0.02, 0, h], [-w / 2, w / 2, h / 2 - 0.02, h / 2 + 0.02]]) rbox(K, R, x0, x1, y0, y1, -0.03, 0.03, frameC, 1, SATIN);
        rbox(K, R, -w / 2 - 0.1, w / 2 + 0.1, -0.08, -0.04, -0.03, 0.14, frameC, 1, SATIN);
        spin(K, R, 'y', [w * 0.3, -0.04, 0.06], [[0.05, 0], [0.065, 0.1], [0.07, 0.11], [0, 0.11]], '#b85a30', 1, 10, SATIN);
        for (let i = 0; i < 5; i++) { const a = i * 1.3; tube(K, R, [w * 0.3, 0.06, 0.06], [w * 0.3 + Math.cos(a) * 0.08, 0.16 + (i % 2) * 0.04, 0.06 + Math.sin(a) * 0.08], 0.006, '#7a6a3a', 1, 4, SATIN); }
        // curtains drawn to the sides in folds, a rod over them
        tube(K, R, [-w / 2 - 0.3, h + 0.15, 0.08], [w / 2 + 0.3, h + 0.15, 0.08], 0.014, '#a88a5a', 1, 8, METAL, true);
        for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { const x = s * (w / 2 + 0.25 - i * 0.07); face(K, R, [[x, -0.25, 0.06 + (i % 2) * 0.03], [x - s * 0.07, -0.25, 0.06 + ((i + 1) % 2) * 0.03], [x - s * 0.07, h + 0.15, 0.06 + ((i + 1) % 2) * 0.03], [x, h + 0.15, 0.06 + (i % 2) * 0.03]], [0, 0, 1], shade(cur, i % 2 ? 0.82 : 1), 1, CLOTH); }
      },
    },
    wall_clock: {
      label: 'Wall clock', fields: [F('yaw', 'Facing (°)'), F('y', 'Height'), F('r', 'Radius')],
      make: { at: [0, 0], yaw: 180, y: 1.9, r: 0.16 },
      draw(K, p) {
        const R = rig(K, p), r = num(p.r, 0.16);
        spin(K, R, 'z', [0, 0, 0], [[0, 0], [r, 0], [r + 0.01, 0.03], [r - 0.005, 0.045]], '#c83a2a', 1, 24, GLOSS);
        disc(K, R, 'z', [0, 0, 0.04], r - 0.01, '#f8f4e8', 1.2, 24, SATIN);
        for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; face(K, R, [[Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78, 0.042], [Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, 0.042], [Math.cos(a + 0.05) * r * 0.9, Math.sin(a + 0.05) * r * 0.9, 0.042], [Math.cos(a + 0.05) * r * 0.78, Math.sin(a + 0.05) * r * 0.78, 0.042]], [0, 0, 1], '#1a1a1a', 1, SATIN); }
        tube(K, R, [0, 0, 0.045], [r * 0.4, r * 0.35, 0.045], 0.006, '#1a1a1a', 1, 4, SATIN);
        tube(K, R, [0, 0, 0.046], [-r * 0.1, -r * 0.75, 0.046], 0.004, '#1a1a1a', 1, 4, SATIN);
      },
    },
    kitchen_chair: {
      label: 'Kitchen chair (wooden)', fields: [F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text')],
      make: { at: [0, 0], yaw: 180, colour: '#8a5a30' },
      draw(K, p) {
        const R = rig(K, p), c = p.colour || '#8a5a30', S = 0.46;
        loft(K, R, [{ a: -0.2, w: 0.21, h: 0.02, t: S, sq: 0.8 }, { a: 0.2, w: 0.2, h: 0.02, t: S, sq: 0.8 }], c, 1, SATIN, { n: 12 });
        for (const [x, z] of [[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]]) tube(K, R, [x * 1.08, 0, z * 1.1], [x, S - 0.02, z], 0.018, shade(c, 0.9), 1, 8, SATIN);
        for (const z of [-0.16, 0.16]) tube(K, R, [-0.17, 0.18, z], [0.17, 0.18, z], 0.01, shade(c, 0.9), 1, 6, SATIN);
        for (const x of [-0.17, 0.17]) tube(K, R, [x, S, -0.17], [x * 1.05, S + 0.5, -0.22], 0.02, c, 1, 8, SATIN);
        rbox(K, R, -0.2, 0.2, S + 0.44, S + 0.53, -0.24, -0.2, c, 1, SATIN);
        for (let i = 0; i < 4; i++) { const x = -0.12 + i * 0.08; tube(K, R, [x, S, -0.18], [x * 1.04, S + 0.46, -0.215], 0.009, c, 1, 6, SATIN); }
      },
    },
    kitchen_mess: {
      label: 'Table clutter: bills, a mug, an ashtray', fields: [F('y', 'Stood on (height)'), F('yaw', 'Facing (°)')],
      make: { at: [0, 0], y: 0.76, yaw: 180 },
      draw(K, p) {
        const R = rig(K, p), roll = rollOf(7);
        for (let i = 0; i < 7; i++) { const x = -0.25 + roll() * 0.15, z = -0.1 + roll() * 0.15, a = roll() * 0.6; const ca = Math.cos(a) * 0.1, sa = Math.sin(a) * 0.1; face(K, R, [[x - ca, 0.003 + i * 0.002, z - sa * 1.4], [x + ca, 0.003 + i * 0.002, z + sa * 0.6], [x + ca - sa, 0.003 + i * 0.002, z + sa * 0.6 + ca * 1.4], [x - ca - sa, 0.003 + i * 0.002, z - sa * 1.4 + ca * 1.4]], [0, 1, 0], i % 3 ? '#f4f0e4' : '#f0d0c8', 1.05, SATIN); }
        face(K, R, [[-0.22, 0.02, -0.02], [-0.12, 0.02, -0.02], [-0.12, 0.02, 0.0], [-0.22, 0.02, 0.0]], [0, 1, 0], '#d82a2a', 1.1, SATIN);
        spin(K, R, 'y', [0.25, 0, -0.05], [[0.04, 0], [0.042, 0.1], [0.038, 0.1], [0.036, 0.01], [0, 0.01]], '#e8e4dc', 1.05, 14, GLOSS);
        hoop(K, R, 'z', [0.29, 0.05, -0.05], 0.025, 0.006, '#e8e4dc', 1.05, 10, GLOSS, -Math.PI / 2, Math.PI / 2);
        disc(K, R, 'y', [0.25, 0.085, -0.05], 0.036, '#3a2010', 1, 12, GLOSS);
        spin(K, R, 'y', [0.05, 0, 0.18], [[0.07, 0], [0.075, 0.02], [0.06, 0.025], [0, 0.015]], '#6a7a8a', 1.1, 14, GLOSS);
        for (let i = 0; i < 5; i++) { const a = i * 1.2; tube(K, R, [0.05 + Math.cos(a) * 0.02, 0.02, 0.18 + Math.sin(a) * 0.02], [0.05 + Math.cos(a) * 0.06, 0.025, 0.18 + Math.sin(a) * 0.06], 0.005, i % 2 ? '#e8e0d0' : '#c8a070', 1, 4, SATIN); }
      },
    },
    tv_dinner: {
      label: 'TV dinner tray', fields: [F('y', 'Stood on (height)'), F('yaw', 'Facing (°)')],
      make: { at: [0, 0], y: 0.76, yaw: 180 },
      draw(K, p) {
        const R = rig(K, p), foil = '#c8c8d0';
        // a foil tray in compartments, every one of them meat: slabs with grill marks under gravy
        rbox(K, R, -0.2, 0.2, 0, 0.005, -0.14, 0.14, foil, 1.05, METAL);
        for (const s of [-1, 1]) { rbox(K, R, -0.2, 0.2, 0, 0.035, s * 0.14 - 0.006, s * 0.14 + 0.006, foil, 1.08, METAL); rbox(K, R, s * 0.2 - 0.006, s * 0.2 + 0.006, 0, 0.035, -0.14, 0.14, foil, 1.08, METAL); }
        rbox(K, R, -0.003, 0.003, 0, 0.032, -0.14, 0.14, foil, 1.05, METAL);
        rbox(K, R, 0.003, 0.2, 0, 0.032, -0.003, 0.003, foil, 1.05, METAL);
        loft(K, R, [{ a: -0.12, w: 0.08, h: 0.018, s: -0.1, t: 0.02, sq: 0.6 }, { a: 0.12, w: 0.085, h: 0.02, s: -0.1, t: 0.022, sq: 0.6 }], '#5a2e1a', 1, SATIN, { n: 12 });
        for (let i = 0; i < 4; i++) rbox(K, R, -0.17, -0.03, 0.041, 0.043, -0.09 + i * 0.055, -0.08 + i * 0.055, '#2a140a', 1, SATIN);
        for (const z of [-0.07, 0.07]) { loft(K, R, [{ a: 0.02, w: 0.04, h: 0.015, t: 0.018, s: z, sq: 0.4 }, { a: 0.18, w: 0.045, h: 0.017, t: 0.02, s: z, sq: 0.4 }].map((q) => ({ ...q })), '#7a3a20', 1, SATIN, { n: 10, axis: 'x' }); }
        for (let i = 0; i < 3; i++) sphere(K, R, [0.06 + i * 0.05, 0.035, 0.07], 0.018, '#6a3018', 1, 7, SATIN);
        for (let i = 0; i < 3; i++) sphere(K, R, [0.07 + i * 0.045, 0.03, -0.07], 0.02, '#4a2010', 1, 7, GLOSS);
        // a plastic fork beside it
        tube(K, R, [0.26, 0.004, -0.12], [0.26, 0.004, 0.06], 0.006, '#f4f4f0', 1.05, 4, GLOSS);
        for (const x of [-0.012, 0, 0.012]) tube(K, R, [0.26 + x, 0.004, 0.06], [0.26 + x, 0.004, 0.11], 0.003, '#f4f4f0', 1.05, 3, GLOSS);
      },
    },
    // ── costumes and bundles, worn or carried by somebody on a mark ──
    steak_costume: {
      label: 'Foam Salisbury steak costume (put it on a mark)', fields: [F('yaw', 'Facing (°)'), F('h', 'Wearer height')],
      make: { at: [0, 0], yaw: 180, h: 1.9 },
      draw(K, p) {
        const R = rig(K, p), hh = num(p.h, 1.9) / 1.9, roll = rollOf(3), meat = '#7a3e22';
        // a fat oval patty round the torso, the head and arms out through it
        const secs = Array.from({ length: 7 }, (_, i) => { const t = i / 6; return { a: (0.62 + t * 0.95) * hh, w: (0.36 + 0.14 * Math.sin(t * Math.PI)) * hh, h: (0.26 + 0.06 * Math.sin(t * Math.PI)) * hh, sq: 0.35 }; });
        loft(K, R, secs, meat, 1, SATIN, { n: 22, axis: 'y' });
        // lumps of the mince, gravy pooled over the top, grill marks across the front
        for (let i = 0; i < 26; i++) { const a = roll() * TAU, y = (0.7 + roll() * 0.8) * hh, t = (y / hh - 0.62) / 0.95, rw = (0.36 + 0.14 * Math.sin(t * Math.PI)) * hh, rh = (0.26 + 0.06 * Math.sin(t * Math.PI)) * hh; sphere(K, R, [Math.cos(a) * rw * 0.98, y, Math.sin(a) * rh * 0.98], 0.05 + roll() * 0.04, roll() < 0.5 ? '#6a3018' : '#8a4a2a', 1, 7, SATIN); }
        loft(K, R, [{ a: 1.5 * hh, w: 0.42 * hh, h: 0.3 * hh, sq: 0.3 }, { a: 1.58 * hh, w: 0.36 * hh, h: 0.26 * hh, sq: 0.3 }], '#3a1a0c', 1.05, GLOSS, { n: 22, axis: 'y' });
        for (let i = 0; i < 6; i++) { const a = -0.6 + i * 0.25; const x = Math.sin(a) * 0.36 * hh; tube(K, R, [x, 1.5 * hh, 0.3 * hh], [x * 1.05, (1.2 - i * 0.02) * hh, 0.34 * hh], 0.025, '#3a1a0c', 1.05, 6, GLOSS); }
        for (let i = 0; i < 4; i++) { const y = (0.85 + i * 0.16) * hh; for (let j = 0; j < 6; j++) { const a0 = -0.7 + j * 0.28, x = Math.sin(a0) * 0.45 * hh; face(K, R, [[x - 0.06, y - 0.02 + j * 0.01, 0.34 * hh], [x + 0.06, y + 0.02 + j * 0.01, 0.34 * hh], [x + 0.06, y + 0.045 + j * 0.01, 0.34 * hh], [x - 0.06, y + 0.005 + j * 0.01, 0.34 * hh]], [0, 0, 1], '#2a1208', 1, SATIN); } }
        // two cartoon eyes and a grin, sewn on
        for (const s of [-1, 1]) { disc(K, R, 'z', [s * 0.13 * hh, 1.32 * hh, 0.36 * hh], 0.065 * hh, '#f8f8f4', 1.1, 16, SATIN); disc(K, R, 'z', [s * 0.12 * hh, 1.31 * hh, 0.365 * hh], 0.03 * hh, '#1a1a1a', 1, 12, SATIN); }
        hoop(K, R, 'z', [0, 1.2 * hh, 0.35 * hh], 0.14 * hh, 0.015, '#f4e8d8', 1.05, 12, SATIN, Math.PI * 1.15, Math.PI * 1.85);
      },
    },
    baby_bundle: {
      label: 'A baby in a blanket (in somebody\'s arms)', fields: [F('y', 'Height'), F('yaw', 'Facing (°)'), F('colour', 'Blanket colour', 'text')],
      make: { at: [0, 0], y: 1.1, yaw: 180, colour: '#a8c8e8' },
      draw(K, p) {
        const R = rig(K, p), c = p.colour || '#a8c8e8';
        loft(K, R, [{ a: -0.2, w: 0.06, h: 0.06, sq: 0.2 }, { a: -0.12, w: 0.1, h: 0.09, sq: 0.25 }, { a: 0.08, w: 0.1, h: 0.09, sq: 0.25 }, { a: 0.16, w: 0.09, h: 0.09, sq: 0.25 }], c, 1.05, CLOTH, { n: 14, axis: 'x' });
        sphere(K, R, [0.2, 0.03, 0.01], 0.065, '#f0c8a8', 1.05, 10, SATIN);
        spin(K, R, 'x', [0.19, 0.03, 0.01], [[0.08, 0], [0.085, 0.04], [0.07, 0.06]], c, 1, 12, CLOTH);
      },
    },
  };
}
