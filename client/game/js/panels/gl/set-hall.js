// GLASS 2 · PIECES FOR A SET THAT IS A PLAIN HALL. Rows for set-mesh.js's SET_PIECES, first for the
// Ashway Civic Hall (set_ashway_hall): rows of folding chairs facing a stage, and a cassette deck on a
// trestle. Each row is a label, its fields and a `draw(K, p, set)` built from the room kit (room-kit.js),
// in metres. Nothing here names a show.
//
// ⚠ A PIECE'S +x IS THE VIEWER'S LEFT when it faces the cameras (yaw 180), and K's points are [u, v, y].

import { MAT } from './ballpark-mesh.js';

const { METAL, SATIN, CLOTH, GLOSS } = MAT;

const num = (v, d) => (Number.isFinite(+v) && v !== '' && v != null ? +v : d);
const F = (k, label, type = 'number') => ({ k, label, type });
const facingOf = (yaw) => { const a = (yaw || 0) * Math.PI / 180; return [Math.sin(a), Math.cos(a)]; };
function rollOf(seed) { let s = ((Math.abs(Math.round(seed)) * 9301 + 49297) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// one folding chair in a frame, its front toward +z
function foldingChair(pbox, x, z, c, steel, skew = 0) {
  const s = 0.21;
  for (const sx of [-s, s]) {
    pbox(x + sx - 0.012, x + sx + 0.012, 0, 0.46, z + 0.17, z + 0.19, steel, 1, null, METAL);
    pbox(x + sx - 0.012, x + sx + 0.012, 0, 0.86, z - 0.2 + skew, z - 0.18 + skew, steel, 1, null, METAL);
  }
  pbox(x - s, x + s, 0.44, 0.47, z - 0.19, z + 0.19, c, 1, null, SATIN);
  pbox(x - s, x + s, 0.6, 0.84, z - 0.21 + skew, z - 0.19 + skew, c, 1, null, SATIN);
}

export function hallPieces() {
  return {
    chair_rows: {
      label: 'Rows of folding chairs',
      fields: [F('rows', 'Rows'), F('per', 'Chairs a row'), F('gap', 'Aisle width'), F('yaw', 'Facing (°)'), F('empty', 'Share left empty or knocked askew (0 to 1)'), F('colour', 'Seat colour', 'text')],
      make: { at: [0, 4], rows: 4, per: 8, gap: 1, yaw: 0, empty: 0.15 },
      draw(K, p, set) {
        const rows = Math.max(1, Math.min(12, num(p.rows, 4) | 0)), per = Math.max(1, Math.min(16, num(p.per, 8) | 0)), gap = num(p.gap, 1);
        const [fu, fv] = facingOf(p.yaw ?? 0), { pbox } = K.frame(p.at[0], p.at[1], fu, fv), c = p.colour || '#5a5448', steel = '#8a8c90';
        const roll = rollOf(p.at[0] * 13 + p.at[1] * 29 + rows * per), pitch = 0.52, depth = 0.95, half = per / 2;
        for (let r = 0; r < rows; r++) for (let i = 0; i < per; i++) {
          if (roll() < num(p.empty, 0.15) * 0.4) continue; // a chair somebody took to the back
          const side = i < half ? -1 : 1, k = i < half ? half - 1 - i : i - half;
          const x = side * (gap / 2 + 0.25 + k * pitch) + (roll() - 0.5) * 0.05;
          foldingChair(pbox, x, -r * depth, c, steel, roll() < num(p.empty, 0.15) * 0.5 ? 0.05 : 0);
        }
      },
    },
    tape_deck: {
      label: 'Cassette deck on a trestle',
      fields: [F('yaw', 'Facing (°)'), F('h', 'Trestle height')],
      make: { at: [0, 0], yaw: 180, h: 0.74 },
      draw(K, p) {
        const h = num(p.h, 0.74), [fu, fv] = facingOf(p.yaw ?? 180), { pbox } = K.frame(p.at[0], p.at[1], fu, fv), wood = '#6a5a40', steel = '#7a7c80';
        for (const x of [-0.42, 0.42]) for (const z of [-0.22, 0.22]) pbox(x - 0.02, x + 0.02, 0, h - 0.03, z - 0.02, z + 0.02, steel, 1, null, METAL);
        pbox(-0.5, 0.5, h - 0.03, h, -0.28, 0.28, wood, 1, null, SATIN);
        // the deck: a grey box, two reels in a smoked window, a row of keys and one red light
        pbox(-0.24, 0.24, h, h + 0.11, -0.15, 0.15, '#3a3a3e', 1, null, SATIN);
        pbox(-0.12, 0.12, h + 0.03, h + 0.09, 0.15, 0.152, '#1a1a1c', 1, null, GLOSS);
        for (const x of [-0.06, 0.06]) pbox(x - 0.022, x + 0.022, h + 0.04, h + 0.08, 0.152, 0.156, '#d8d0c0', 1.1);
        for (let i = 0; i < 5; i++) pbox(-0.2 + i * 0.05, -0.165 + i * 0.05, h + 0.11, h + 0.125, 0.04, 0.12, '#c8c4bc', 1, null, METAL);
        pbox(0.17, 0.19, h + 0.06, h + 0.075, 0.15, 0.156, '#ff3020', 2.2);
        // a lead to the floor and a battered speaker beside it
        pbox(0.55, 0.85, 0, 0.5, -0.15, 0.15, '#2a2622', 1, null, CLOTH);
        pbox(0.6, 0.8, 0.12, 0.38, 0.15, 0.156, '#141210', 1, null, CLOTH);
      },
    },
  };
}
