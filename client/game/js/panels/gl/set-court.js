// GLASS 2 · PIECES FOR A SET THAT IS A PLAYING COURT. Rows for set-mesh.js's SET_PIECES, first for
// the Slagball arena (set_slagball_open): a painted court in two halves with its lines, a rack of
// glowing balls on the centre line, a cage fence on posts, and tiered bleachers with a crowd. Each row
// is a label, its fields and a `draw(K, p, set)` built from the room kit (room-kit.js), in metres.
// Nothing here names a show or a sport.
//
// ⚠ A PIECE'S +x IS THE VIEWER'S LEFT when it faces the cameras (yaw 180), and K's points are [u, v, y].

import { MAT } from './ballpark-mesh.js';

const { GLOSS, METAL, SATIN, CLOTH } = MAT;

const num = (v, d) => (Number.isFinite(+v) && v !== '' && v != null ? +v : d);
const F = (k, label, type = 'number') => ({ k, label, type });
const facingOf = (yaw) => { const a = (yaw || 0) * Math.PI / 180; return [Math.sin(a), Math.cos(a)]; };
function rollOf(seed) { let s = ((Math.abs(Math.round(seed)) * 9301 + 49297) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

export function courtPieces() {
  return {
    ball_court: {
      label: 'Playing court (two halves, painted lines)',
      fields: [F('w', 'Length (across)'), F('depth', 'Width (back)'), F('left', 'Left half colour', 'text'), F('right', 'Right half colour', 'text'), F('line', 'Line colour', 'text'), F('glow', 'Centre line brightness')],
      make: { at: [0, 6], w: 10, depth: 6, left: '#3a1c18', right: '#16263a', line: '#f2efe6', glow: 2.2 },
      draw(K, p, set) {
        const w = num(p.w, 10), d = num(p.depth, 6), [u, v] = p.at, y0 = 0.004, pal = set.palette || {};
        const line = p.line || pal.line || '#f2efe6', glow = num(p.glow, 2.2), accent = set.brand?.colour || pal.accent || '#ff5a3c';
        // the two halves, a hair off the floor so they never fight it
        K.box(u - w / 2, u, v - d / 2, v + d / 2, 0, y0, p.left || '#3a1c18', 1, null, GLOSS);
        K.box(u, u + w / 2, v - d / 2, v + d / 2, 0, y0, p.right || '#16263a', 1, null, GLOSS);
        const t = 0.06, y1 = y0 + 0.003;
        // the boundary
        K.box(u - w / 2, u + w / 2, v - d / 2, v - d / 2 + t, y0, y1, line, 1.1);
        K.box(u - w / 2, u + w / 2, v + d / 2 - t, v + d / 2, y0, y1, line, 1.1);
        K.box(u - w / 2, u - w / 2 + t, v - d / 2, v + d / 2, y0, y1, line, 1.1);
        K.box(u + w / 2 - t, u + w / 2, v - d / 2, v + d / 2, y0, y1, line, 1.1);
        // the attack lines, a third of the way into each half
        for (const s of [-1, 1]) K.box(u + s * w / 6 - t / 2, u + s * w / 6 + t / 2, v - d / 2, v + d / 2, y0, y1, line, 0.8);
        // the centre line glows, the one thing in the pit nobody may cross
        K.box(u - 0.07, u + 0.07, v - d / 2, v + d / 2, y0, y1 + 0.002, accent, glow);
        // a low kickboard round the whole court
        const kb = 0.32, kt = 0.08, kc = pal.trim || '#1a1a20';
        K.box(u - w / 2 - 0.4, u + w / 2 + 0.4, v + d / 2 + 0.4, v + d / 2 + 0.4 + kt, 0, kb, kc, 1, null, SATIN);
        for (const s of [-1, 1]) K.box(u + s * (w / 2 + 0.4) - kt / 2, u + s * (w / 2 + 0.4) + kt / 2, v - d / 2 - 0.4, v + d / 2 + 0.4, 0, kb, kc, 1, null, SATIN);
        // a strip of accent light along the kickboard's top
        K.box(u - w / 2 - 0.4, u + w / 2 + 0.4, v + d / 2 + 0.39, v + d / 2 + 0.41, kb, kb + 0.02, accent, 1.8);
      },
    },
    ball_rack: {
      label: 'Rack of balls',
      fields: [F('n', 'Balls'), F('r', 'Ball radius'), F('yaw', 'Facing (°)'), F('colour', 'Glow colour', 'text')],
      make: { at: [0, 6], n: 6, r: 0.13, yaw: 90 },
      draw(K, p, set) {
        const n = Math.max(1, Math.min(12, num(p.n, 6) | 0)), r = num(p.r, 0.13), [fu, fv] = facingOf(p.yaw ?? 90), fr = K.frame(p.at[0], p.at[1], fu, fv);
        const c = p.colour || set.brand?.colour || '#ff5a3c', L = n * r * 2.3, steel = '#6a6e76';
        // a low steel cradle: two rails on short legs
        for (const z of [-r * 0.7, r * 0.7]) fr.pbox(-L / 2, L / 2, 0.16, 0.2, z - 0.02, z + 0.02, steel, 1, null, METAL);
        for (const x of [-L / 2, L / 2]) for (const z of [-r * 0.7, r * 0.7]) fr.pbox(x - 0.02, x + 0.02, 0, 0.2, z - 0.02, z + 0.02, steel, 1, null, METAL);
        for (let i = 0; i < n; i++) {
          const [bu, bv] = fr.P(-L / 2 + r * 1.15 + i * r * 2.3, 0, 0);
          K.ball(bu, bv, 0.2 + r * 0.85, r, c, 1.6, 12, GLOSS);
        }
      },
    },
    fence_run: {
      label: 'Cage fence on posts',
      fields: [F('w', 'Length'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('posts', 'Posts'), F('colour', 'Colour', 'text')],
      make: { at: [0, 0], w: 8, h: 2.4, yaw: 180, posts: 5 },
      draw(K, p, set) {
        const w = num(p.w, 8), h = num(p.h, 2.4), n = Math.max(2, Math.min(16, num(p.posts, 5) | 0)), [fu, fv] = facingOf(p.yaw ?? 180), { pbox } = K.frame(p.at[0], p.at[1], fu, fv);
        const c = p.colour || '#7a7e86', s = 0.04;
        for (let i = 0; i < n; i++) { const x = -w / 2 + w * i / (n - 1); pbox(x - s, x + s, 0, h, -s, s, c, 1, null, METAL); }
        // rails, then the mesh as a lattice of thin wires
        for (const y of [0.05, h / 2, h - 0.03]) pbox(-w / 2, w / 2, y - 0.02, y + 0.02, -0.02, 0.02, c, 1, null, METAL);
        const step = 0.22;
        for (let x = -w / 2 + step; x < w / 2; x += step) pbox(x - 0.005, x + 0.005, 0.05, h - 0.03, -0.004, 0.004, c, 0.8, null, METAL);
        for (let y = 0.05 + step; y < h - 0.03; y += step) pbox(-w / 2, w / 2, y - 0.005, y + 0.005, -0.004, 0.004, c, 0.8, null, METAL);
      },
    },
    bleachers: {
      label: 'Bleachers with a crowd',
      fields: [F('w', 'Width'), F('rows', 'Rows'), F('yaw', 'Facing (°)'), F('full', 'How full (0 to 1)'), F('colour', 'Bench colour', 'text')],
      make: { at: [0, 10], w: 10, rows: 5, yaw: 180, full: 0.8 },
      draw(K, p, set) {
        const w = num(p.w, 10), rows = Math.max(1, Math.min(10, num(p.rows, 5) | 0)), full = Math.max(0, Math.min(1, num(p.full, 0.8)));
        const [fu, fv] = facingOf(p.yaw ?? 180), { pbox, P } = K.frame(p.at[0], p.at[1], fu, fv), c = p.colour || set.palette?.riser || '#26282e';
        const rise = 0.42, run = 0.75, roll = rollOf(p.at[0] * 31 + p.at[1] * 7 + w);
        const shirts = ['#8a2a22', '#2a4a7a', '#c8a050', '#3a5a3a', '#5a3a6a', '#b0b4ba', '#d0602a', '#202226'];
        for (let i = 0; i < rows; i++) {
          const z0 = -i * run, y = (i + 1) * rise;
          pbox(-w / 2, w / 2, 0, y, z0 - run, z0, c, 1 - i * 0.04, null, SATIN);
          pbox(-w / 2, w / 2, y, y + 0.03, z0 - run, z0 - run + 0.32, '#4a4c52', 1, null, METAL);
          // the crowd: a torso and a head, packed as tight as the night's sales
          for (let x = -w / 2 + 0.3; x < w / 2 - 0.2; x += 0.52) {
            if (roll() > full) continue;
            const jx = x + (roll() - 0.5) * 0.1, zc = z0 - run + 0.2, tall = 0.5 + roll() * 0.12, up = roll() < 0.18 ? 0.25 : 0;
            pbox(jx - 0.17, jx + 0.17, y + 0.03 + up, y + 0.03 + up + tall, zc - 0.11, zc + 0.11, shirts[(roll() * shirts.length) | 0], 0.9, null, CLOTH);
            const [hu, hv] = P(jx, 0, zc);
            K.ball(hu, hv, y + 0.03 + up + tall + 0.13, 0.11, roll() < 0.5 ? '#c89a78' : '#6a4a34', 0.95, 8, SATIN);
          }
        }
      },
    },
  };
}
