// SEABED SCENE — the CPU half of the underwater view (plugins/submersible).
//
// windshield.js calls `underwaterScene` from the GL branch of the floor pass and hangs the result on
// FLOOR_STATE; gl/seabed.js draws it. Everything here is geometry and arithmetic: no GL, so the
// windshield (which must never import gl/) can own it, and a headless harness can run it.
//
// Coordinates are MAP-WINDOW TILES, the frame every GL mesh in the world pass is built in: x/y
// relative to the window centre, z up, mean sea level at z = 0. A world tile is `mapCenter + wx`.
//
// ⚠ LAND COMES OFF THE FLOOR'S OWN LUT, the per-tile table the Mode-7 floor and both water
// shaders already sample (`[3]` is waterness). So the seabed meets the coast exactly where the
// water is painted meeting it, with no second idea of where the shore is.
//
// ⚠ THE TERRAIN IS CACHED ON THE TILE, NOT THE FRAME. It is rebuilt only when the camera crosses
// into another tile or the window recentres; props that MOVE (weed, bubbles, particles) are
// rebuilt every frame into their own small buffer.

import { seabedDepth, seabedMaterial, shoreField, wrecksNear, scatterAt, SCATTER_SLOTS, SHORE_SEARCH } from '../../../shared/seabed.js';
import { hn2h } from '../../../shared/landform.js';
import { SEA_TILE_M } from '../../../shared/sea-swell.js';

// ⚠ 7 WAS TOO LITTLE: in clear water 25 m down the far edge of the patch was in plain view as a hard
// line across the frame, and the floor read as a wall. gl/seabed.js fades the floor into the murk
// over the outer part of this radius, so the bottom slopes away into dark water instead of ending.
export const SEABED_R = 12;       // tiles of seabed built round the camera
export const SEABED_STEP = 0.25;  // tiles between samples
const M = SEA_TILE_M;

const MAT_RGB = {
  sand: [0.74, 0.66, 0.46], silt: [0.40, 0.37, 0.30], rock: [0.34, 0.36, 0.38], debris: [0.46, 0.33, 0.24],
};

let cache = { key: '', terrain: null, rocks: [], wrecks: [], field: null, isLand: null };

function landFromLUT(LUT, mh, Cx, Cy) {
  const R = (mh - 1) / 2;
  return (ix, iy) => {
    let r = iy - Cy + R, c = ix - Cx + R;
    if (r < 0) r = 0; else if (r >= mh) r = mh - 1;
    const row = LUT[r]; if (!row) return false;
    if (c < 0) c = 0; else if (c >= row.length) c = row.length - 1;
    const cell = row[c];
    return !!cell && cell[3] < 0.5;
  };
}

// Push one flat-shaded triangle: 3 × (x, y, z, r, g, b).
function tri(out, a, b, c, rgb, shade) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
  // Light comes down through the water from above, a little from the west.
  const k = shade * (0.45 + 0.55 * Math.max(0, nz * 0.9 - nx * 0.3));
  for (const p of [a, b, c]) out.push(p[0], p[1], p[2], rgb[0] * k, rgb[1] * k, rgb[2] * k);
}
function quad(out, a, b, c, d, rgb, shade = 1) { tri(out, a, b, c, rgb, shade); tri(out, a, c, d, rgb, shade); }

// A box on the seabed, yawed, for the wrecks.
function box(out, cx, cy, z0, hl, hw, h, yaw, rgb, tilt = 0) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const P = (l, w, z) => [cx + l * c - w * s, cy + l * s + w * c, z0 + z + w * tilt];
  const b = [P(-hl, -hw, 0), P(hl, -hw, 0), P(hl, hw, 0), P(-hl, hw, 0)];
  const t = [P(-hl, -hw, h), P(hl, -hw, h), P(hl, hw, h), P(-hl, hw, h)];
  quad(out, t[0], t[1], t[2], t[3], rgb, 1.05);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(out, b[i], b[j], t[j], t[i], rgb, 0.8); }
}

const WRECK_RGB = {
  skiff: [0.36, 0.30, 0.24], container_stack: [0.55, 0.28, 0.18], freighter: [0.30, 0.28, 0.27],
  server_farm: [0.26, 0.30, 0.32], hero: [0.22, 0.24, 0.26],
};
function wreckMesh(out, w, x, y, z) {
  const rgb = WRECK_RGB[w.kind] || [0.3, 0.3, 0.3];
  const yaw = w.heading * Math.PI / 180;
  const sink = 0.02;
  if (w.kind === 'skiff') { box(out, x, y, z - sink, 0.14, 0.05, 0.05, yaw, rgb, 0.3); return; }
  if (w.kind === 'container_stack') {
    const cols = [[0.55, 0.28, 0.18], [0.2, 0.36, 0.45], [0.5, 0.45, 0.2], [0.3, 0.42, 0.28]];
    for (let i = 0; i < 5; i++) {
      const h = hn2h(i * 13 + w.x | 0, w.y | 0);
      box(out, x + (i % 3 - 1) * 0.1 * Math.cos(yaw), y + (i % 3 - 1) * 0.1 * Math.sin(yaw), z - sink + (i >= 3 ? 0.06 : 0),
        0.12, 0.045, 0.058, yaw + (h - 0.5) * 0.4, cols[i % cols.length]);
    }
    return;
  }
  if (w.kind === 'freighter') {
    box(out, x, y, z - 0.08, 0.9, 0.16, 0.22, yaw, rgb, 0.55);           // the hull, on its side
    box(out, x - 0.55 * Math.cos(yaw), y - 0.55 * Math.sin(yaw), z + 0.05, 0.12, 0.1, 0.18, yaw, [0.42, 0.40, 0.36], 0.55);
    return;
  }
  if (w.kind === 'server_farm') {
    for (let r = -2; r <= 2; r++) for (let k = -1; k <= 1; k++) {
      const ox = r * 0.09, oy = k * 0.14, s = Math.sin(yaw), c = Math.cos(yaw);
      box(out, x + ox * c - oy * s, y + ox * s + oy * c, z - sink, 0.025, 0.05, 0.09, yaw, rgb);
    }
    return;
  }
  // hero: something enormous, nobody says what
  box(out, x, y, z - 0.2, 1.6, 0.35, 0.5, yaw, rgb, 0.2);
  box(out, x + 1.2 * Math.cos(yaw), y + 1.2 * Math.sin(yaw), z + 0.2, 0.3, 0.25, 0.7, yaw + 0.3, rgb, 0.2);
}

// A capped cylinder (n sides), axis tilted by `lean` toward `yaw` (0 standing, PI/2 lying down).
function cyl(out, x, y, z, r, len, yaw, lean, rgb, n = 7, cap = true) {
  const ax = [Math.cos(yaw) * Math.sin(lean), Math.sin(yaw) * Math.sin(lean), Math.cos(lean)];
  const u = Math.abs(ax[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  let v1 = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
  const l1 = Math.hypot(v1[0], v1[1], v1[2]); v1 = v1.map(q => q / l1);
  const v2 = [ax[1] * v1[2] - ax[2] * v1[1], ax[2] * v1[0] - ax[0] * v1[2], ax[0] * v1[1] - ax[1] * v1[0]];
  const ring = (o) => Array.from({ length: n }, (_, i) => {
    const a = i / n * Math.PI * 2, cc = Math.cos(a) * r, ss = Math.sin(a) * r;
    return [x + ax[0] * o + v1[0] * cc + v2[0] * ss, y + ax[1] * o + v1[1] * cc + v2[1] * ss, z + ax[2] * o + v1[2] * cc + v2[2] * ss];
  });
  const A = ring(-len / 2), B = ring(len / 2);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; quad(out, A[i], A[j], B[j], B[i], rgb, 0.85); }
  if (cap) {
    const ca = [x - ax[0] * len / 2, y - ax[1] * len / 2, z - ax[2] * len / 2];
    const cb = [x + ax[0] * len / 2, y + ax[1] * len / 2, z + ax[2] * len / 2];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; tri(out, A[i], A[j], ca, rgb, 0.7); tri(out, B[i], B[j], cb, rgb, 1.05); }
  }
}
// A low cone: a ring on the bed and a tip above it, optionally leaning.
function spike(out, x, y, z, r, h, rgb, n = 5, tipX = 0, tipY = 0) {
  const top = [x + tipX, y + tipY, z + h];
  const ring = Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; return [x + Math.cos(a) * r, y + Math.sin(a) * r, z - 0.004]; });
  for (let i = 0; i < n; i++) tri(out, ring[i], ring[(i + 1) % n], top, rgb, 1);
}

// Metres to tiles, so each object is authored at its real size.
const mt = (m) => m / M;
// Everything down here drifts toward the colour of the bottom.
const silted = (rgb, k = 0.7) => rgb.map(q => q * k + 0.12 * (1 - k));
const SCATTER_RING = (o, i, r0, r1, salt) => {
  const a = o.seed * 50 + i * 2.3, r = mt(r0 + r1 * hn2h(i * 7 + salt, (o.seed * 97) | 0));
  return [Math.cos(a) * r, Math.sin(a) * r, a];
};

function scatterMesh(out, o, x, y, z) {
  const { yaw, seed } = o, c = Math.cos(yaw), s = Math.sin(yaw);
  switch (o.kind) {
    case 'tyre': {
      const n = seed < 0.3 ? 2 : 1;   // sometimes two, stacked
      for (let i = 0; i < n; i++) {
        const tx = x + i * mt(0.1), tz = z + mt(0.12 + i * 0.25);
        cyl(out, tx, y, tz, mt(0.35), mt(0.24), yaw, seed * 0.3, [0.07, 0.07, 0.08], 8, false);
        cyl(out, tx, y, tz, mt(0.18), mt(0.25), yaw, seed * 0.3, [0.03, 0.03, 0.04], 8, false);
      }
      return;
    }
    case 'cone':
      box(out, x, y, z, mt(0.2), mt(0.2), mt(0.04), yaw, silted([0.85, 0.35, 0.1]));
      spike(out, x, y, z + mt(0.04), mt(0.14), mt(0.6), silted([0.9, 0.4, 0.12]), 6, mt(0.12) * c, mt(0.12) * s);
      return;
    case 'trolley':   // on its side
      box(out, x, y, z, mt(0.45), mt(0.3), mt(0.5), yaw, silted([0.45, 0.47, 0.5], 0.6), 0.9);
      cyl(out, x + mt(0.4) * c, y + mt(0.4) * s, z + mt(0.1), mt(0.06), mt(0.04), yaw, 1.4, [0.1, 0.1, 0.1], 6);
      return;
    case 'bottles':
      for (let i = 0; i < 5; i++) {
        const [ox, oy, a] = SCATTER_RING(o, i, 0.2, 0.3, 1);
        cyl(out, x + ox, y + oy, z + mt(0.04), mt(0.04), mt(0.28), a, Math.PI / 2, i % 2 ? [0.12, 0.35, 0.18] : [0.35, 0.22, 0.1], 5);
      }
      return;
    case 'shells':
      for (let i = 0; i < 6; i++) {
        const [ox, oy] = SCATTER_RING(o, i, 0.15, 0.4, 2);
        spike(out, x + ox, y + oy, z, mt(0.07), mt(0.04), i % 3 ? [0.82, 0.78, 0.68] : [0.7, 0.5, 0.45], 5);
      }
      return;
    case 'barrel': {
      const down = seed < 0.6;   // most have gone over
      const rgb = seed < 0.3 ? [0.55, 0.45, 0.1] : seed < 0.7 ? [0.2, 0.3, 0.5] : [0.45, 0.2, 0.15];
      cyl(out, x, y, z + mt(down ? 0.28 : 0.45), mt(0.29), mt(0.88), yaw, down ? Math.PI / 2 : 0.1, silted(rgb, 0.65), 8);
      return;
    }
    case 'crate':
      box(out, x, y, z - mt(0.1), mt(0.55), mt(0.45), mt(0.8), yaw, silted([0.42, 0.32, 0.2]), 0.15 * (seed - 0.5));
      if (seed > 0.5) box(out, x + mt(0.2) * c, y + mt(0.2) * s, z + mt(0.7), mt(0.4), mt(0.35), mt(0.6), yaw + 0.5, silted([0.42, 0.32, 0.2]));
      return;
    case 'pipe':
      cyl(out, x, y, z + mt(0.35), mt(0.4), mt(4 + 3 * seed), yaw, Math.PI / 2 - 0.04, silted([0.4, 0.38, 0.34], 0.6), 9);
      return;
    case 'anchor': {
      const rgb = [0.18, 0.16, 0.15], hx = x + mt(1.05) * c, hy = y + mt(1.05) * s;
      cyl(out, x, y, z + mt(0.1), mt(0.08), mt(2.2), yaw, Math.PI / 2, rgb, 5);                   // shank
      cyl(out, hx, hy, z + mt(0.15), mt(0.07), mt(1.6), yaw + Math.PI / 2, Math.PI / 2, rgb, 5);   // arms
      spike(out, hx - mt(0.8) * s, hy + mt(0.8) * c, z, mt(0.2), mt(0.35), rgb, 4);
      spike(out, hx + mt(0.8) * s, hy - mt(0.8) * c, z, mt(0.2), mt(0.35), rgb, 4);
      return;
    }
    case 'car': {   // roof down, which is how they land
      const paint = [[0.5, 0.1, 0.1], [0.15, 0.25, 0.45], [0.6, 0.6, 0.55], [0.2, 0.35, 0.25]][Math.floor(seed * 4) % 4];
      box(out, x, y, z + mt(0.3), mt(2.1), mt(0.85), mt(0.7), yaw, silted(paint, 0.55));
      box(out, x, y, z - mt(0.05), mt(1.1), mt(0.75), mt(0.4), yaw, silted([0.15, 0.18, 0.2], 0.6));
      for (const [l, w] of [[1.4, 0.85], [-1.4, 0.85], [1.4, -0.85], [-1.4, -0.85]])
        cyl(out, x + mt(l) * c - mt(w) * s, y + mt(l) * s + mt(w) * c, z + mt(1.05), mt(0.32), mt(0.2), yaw + Math.PI / 2, Math.PI / 2, [0.06, 0.06, 0.07], 7);
      return;
    }
    case 'coral': {
      const pal = [[0.85, 0.45, 0.4], [0.9, 0.7, 0.35], [0.6, 0.35, 0.65], [0.95, 0.85, 0.75]];
      for (let i = 0; i < 7; i++) {
        const [ox, oy, a] = SCATTER_RING(o, i, 0.1, 0.5, 3);
        spike(out, x + ox, y + oy, z, mt(0.18), mt(0.4 + 0.8 * hn2h(i, 3)), pal[(i + Math.floor(seed * 4)) % 4], 5,
          Math.cos(a) * mt(0.15), Math.sin(a) * mt(0.15));
      }
      return;
    }
    case 'sponge':
      for (let i = 0; i < 3; i++) {
        const a = seed * 20 + i * 2.1, r = i ? mt(0.35) : 0, h = mt(i ? 0.9 : 1.4);
        cyl(out, x + Math.cos(a) * r, y + Math.sin(a) * r, z + h / 2, mt(0.22 - 0.04 * i), h, a, 0.1 * i,
          seed < 0.5 ? [0.75, 0.62, 0.3] : [0.55, 0.3, 0.2], 7);
      }
      return;
    case 'urchins':
      for (let i = 0; i < 8; i++) {
        const [ox, oy] = SCATTER_RING(o, i, 0.1, 0.6, 4);
        spike(out, x + ox, y + oy, z, mt(0.06), mt(0.09), [0.15, 0.08, 0.2], 5);
      }
      return;
    case 'monitor':   // a rack terminal, face up, still in its housing
      box(out, x, y, z - mt(0.02), mt(0.35), mt(0.25), mt(0.15), yaw, [0.14, 0.15, 0.17]);
      box(out, x, y, z + mt(0.13), mt(0.28), mt(0.19), mt(0.005), yaw, [0.05, 0.12, 0.14]);
      return;
    case 'tubeworms':
      for (let i = 0; i < 9; i++) {
        const [ox, oy, a] = SCATTER_RING(o, i, 0.05, 0.35, 5), h = mt(0.5 + 1.2 * hn2h(i, 9));
        cyl(out, x + ox, y + oy, z + h / 2, mt(0.035), h, a, 0.08, [0.85, 0.83, 0.78], 5, false);
        spike(out, x + ox, y + oy, z + h, mt(0.06), mt(0.12), [0.8, 0.12, 0.12], 5);   // the red plume
      }
      return;
    case 'glassrope':   // a glass sponge: a pale vase on a stalk
      cyl(out, x, y, z + mt(0.4), mt(0.05), mt(0.8), 0, 0, [0.7, 0.72, 0.68], 5);
      cyl(out, x, y, z + mt(1.3), mt(0.28), mt(1.0), 0, 0, [0.82, 0.86, 0.84], 8, false);
      return;
    case 'bike': {   // on its side: two wheels and a frame bar
      const rgb = silted([0.2, 0.3, 0.55], 0.6);
      for (const l of [-0.5, 0.5]) cyl(out, x + mt(l) * c, y + mt(l) * s, z + mt(0.03), mt(0.33), mt(0.04), yaw, 0, [0.08, 0.08, 0.09], 9, false);
      cyl(out, x, y, z + mt(0.06), mt(0.025), mt(1.0), yaw, Math.PI / 2, rgb, 4);
      cyl(out, x + mt(0.1) * c, y + mt(0.1) * s, z + mt(0.06), mt(0.025), mt(0.6), yaw + 0.9, Math.PI / 2, rgb, 4);
      return;
    }
    case 'fridge':   // lying on its back, door ajar
      box(out, x, y, z - mt(0.05), mt(0.9), mt(0.35), mt(0.6), yaw, silted([0.85, 0.85, 0.8], 0.6));
      box(out, x + mt(0.4) * s, y - mt(0.4) * c, z + mt(0.5), mt(0.85), mt(0.03), mt(0.3), yaw, silted([0.8, 0.8, 0.76], 0.6), 1.5);
      return;
    case 'mannequin': {   // lying down, one arm up; nobody says why it is here
      const rgb = silted([0.85, 0.72, 0.62], 0.6);
      cyl(out, x, y, z + mt(0.15), mt(0.16), mt(0.8), yaw, Math.PI / 2, rgb, 6);
      box(out, x + mt(0.55) * c, y + mt(0.55) * s, z + mt(0.05), mt(0.12), mt(0.1), mt(0.2), yaw, rgb);
      cyl(out, x - mt(0.7) * c + mt(0.1) * s, y - mt(0.7) * s - mt(0.1) * c, z + mt(0.08), mt(0.06), mt(0.8), yaw, Math.PI / 2, rgb, 5);
      cyl(out, x - mt(0.7) * c - mt(0.1) * s, y - mt(0.7) * s + mt(0.1) * c, z + mt(0.08), mt(0.06), mt(0.8), yaw, Math.PI / 2, rgb, 5);
      cyl(out, x + mt(0.2) * c + mt(0.2) * s, y + mt(0.2) * s - mt(0.2) * c, z + mt(0.35), mt(0.05), mt(0.6), yaw, 0.3, rgb, 5);
      return;
    }
    case 'pallet':
      for (let i = -2; i <= 2; i++) box(out, x + mt(i * 0.24) * c, y + mt(i * 0.24) * s, z + mt(0.1), mt(0.07), mt(0.6), mt(0.03), yaw, silted([0.55, 0.45, 0.3], 0.55));
      for (const w of [-0.5, 0, 0.5]) box(out, x - mt(w) * s, y + mt(w) * c, z - mt(0.02), mt(0.6), mt(0.05), mt(0.1), yaw, silted([0.5, 0.4, 0.26], 0.55));
      return;
    case 'lobsterpot':
      box(out, x, y, z - mt(0.02), mt(0.45), mt(0.3), mt(0.35), yaw, silted([0.3, 0.45, 0.35], 0.7));
      box(out, x, y, z + mt(0.33), mt(0.3), mt(0.2), mt(0.02), yaw, [0.1, 0.12, 0.1]);
      cyl(out, x + mt(0.6) * c, y + mt(0.6) * s, z + mt(0.03), mt(0.02), mt(0.9), yaw, Math.PI / 2, [0.7, 0.6, 0.3], 4);
      return;
    case 'starfish':
      for (let i = 0; i < 3; i++) {
        const [ox, oy] = SCATTER_RING(o, i, 0.1, 0.9, 6), a0 = seed * 9 + i;
        const col = [[0.9, 0.35, 0.15], [0.75, 0.2, 0.4], [0.95, 0.6, 0.2]][i];
        for (let j = 0; j < 5; j++) {
          const a = a0 + j / 5 * Math.PI * 2;
          cyl(out, x + ox + Math.cos(a) * mt(0.08), y + oy + Math.sin(a) * mt(0.08), z + mt(0.02), mt(0.03), mt(0.16), a, Math.PI / 2, col, 4);
        }
      }
      return;
    case 'anemones':
      for (let i = 0; i < 6; i++) {
        const [ox, oy] = SCATTER_RING(o, i, 0.05, 0.5, 7), col = i % 2 ? [0.95, 0.5, 0.6] : [0.6, 0.85, 0.7];
        cyl(out, x + ox, y + oy, z + mt(0.07), mt(0.07), mt(0.14), 0, 0, [0.5, 0.25, 0.3], 6);
        for (let j = 0; j < 6; j++) { const a = j / 6 * Math.PI * 2; spike(out, x + ox, y + oy, z + mt(0.14), mt(0.02), mt(0.12), col, 3, Math.cos(a) * mt(0.08), Math.sin(a) * mt(0.08)); }
      }
      return;
    case 'braincoral':
      for (let i = 0; i < 2; i++) {
        const [ox, oy] = SCATTER_RING(o, i, 0, 0.6, 8), r = mt(0.35 + 0.3 * hn2h(i, 12));
        cyl(out, x + ox, y + oy, z + r * 0.4, r, r * 0.8, 0, 0, [0.72, 0.68, 0.45], 9);
        spike(out, x + ox, y + oy, z + r * 0.8, r * 0.95, r * 0.35, [0.78, 0.74, 0.5], 9);
      }
      return;
    case 'chain':   // a run of heavy links, off something that sank
      for (let i = 0; i < 10; i++) {
        const a = yaw + Math.sin(seed * 9 + i * 0.6) * 0.5, px = x + mt(i * 0.35) * Math.cos(yaw), py = y + mt(i * 0.35) * Math.sin(yaw);
        cyl(out, px, py, z + mt(0.05), mt(0.1), mt(0.04), a, i % 2 ? Math.PI / 2 : 0, [0.3, 0.2, 0.14], 6, false);
      }
      return;
    case 'drone': {   // quadcopter, one arm snapped
      const rgb = [0.15, 0.16, 0.18];
      box(out, x, y, z, mt(0.15), mt(0.15), mt(0.08), yaw, rgb);
      for (let j = 0; j < 4; j++) {
        if (j === Math.floor(seed * 4)) continue;
        const a = yaw + Math.PI / 4 + j * Math.PI / 2, ex = x + Math.cos(a) * mt(0.3), ey = y + Math.sin(a) * mt(0.3);
        cyl(out, (x + ex) / 2, (y + ey) / 2, z + mt(0.05), mt(0.02), mt(0.3), a, Math.PI / 2, rgb, 4);
        cyl(out, ex, ey, z + mt(0.08), mt(0.12), mt(0.01), 0, 0, [0.3, 0.3, 0.32], 7);
      }
      return;
    }
    case 'dish':   // a relay dish face up on the bottom, the mast beside it
      spike(out, x, y, z + mt(0.5), mt(1.1), -mt(0.45), silted([0.75, 0.76, 0.78], 0.6), 10);
      cyl(out, x + mt(1.4) * c, y + mt(1.4) * s, z + mt(0.1), mt(0.08), mt(2.2), yaw, Math.PI / 2, silted([0.5, 0.5, 0.52], 0.6), 5);
      return;
    case 'mine': {   // a moored mine that parted its cable and settled, horns and all
      const rgb = [0.12, 0.13, 0.12], r = mt(0.5);
      cyl(out, x, y, z + r, r, r * 1.6, 0, 0, rgb, 9);
      for (let j = 0; j < 5; j++) { const a = j / 5 * Math.PI * 2; spike(out, x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, z + r * 1.6, mt(0.05), mt(0.18), rgb, 4, Math.cos(a) * mt(0.08), Math.sin(a) * mt(0.08)); }
      return;
    }
    case 'cablespool':
      for (const l of [-0.6, 0.6]) cyl(out, x + mt(l) * c, y + mt(l) * s, z + mt(1.1), mt(1.1), mt(0.08), yaw, Math.PI / 2, silted([0.45, 0.35, 0.22], 0.6), 10);
      cyl(out, x, y, z + mt(1.1), mt(0.75), mt(1.15), yaw, Math.PI / 2, [0.12, 0.12, 0.13], 10, false);
      cyl(out, x + mt(2.2) * s, y - mt(2.2) * c, z + mt(0.08), mt(0.08), mt(3.5), yaw + Math.PI / 2, Math.PI / 2, [0.12, 0.12, 0.13], 5);
      return;
    case 'whalefall': {   // a spine and ribs, long since picked clean
      const bone = [0.86, 0.84, 0.76];
      for (let i = 0; i < 14; i++) {
        const l = (i - 7) * 0.9, px = x + mt(l) * c, py = y + mt(l) * s;
        cyl(out, px, py, z + mt(0.15), mt(0.2), mt(0.5), yaw, Math.PI / 2, bone, 6);
        if (i > 2 && i < 11) for (const sd of [-1, 1])
          cyl(out, px - sd * mt(0.9) * s, py + sd * mt(0.9) * c, z + mt(0.5), mt(0.07), mt(2.0), yaw + sd * Math.PI / 2, 1.1, bone, 4);
      }
      box(out, x + mt(7.5) * c, y + mt(7.5) * s, z, mt(1.2), mt(0.8), mt(0.6), yaw, bone);   // the skull
      return;
    }
    case 'nodules':
      for (let i = 0; i < 14; i++) {
        const [ox, oy] = SCATTER_RING(o, i, 0.05, 1.1, 9);
        spike(out, x + ox, y + oy, z, mt(0.07), mt(0.07), [0.1, 0.09, 0.08], 5);
      }
      return;
    case 'chimney':   // a dead hydrothermal chimney, stepped and crusted
      for (let i = 0; i < 3; i++)
        cyl(out, x, y, z + mt(0.8 + i * 1.5), mt(0.7 - i * 0.18), mt(1.6), 0, 0.05 * i, i === 2 ? [0.55, 0.4, 0.2] : [0.2, 0.17, 0.15], 8);
      return;
  }
}

function buildStatic(Cx, Cy, cx, cy, isLand) {
  const n = Math.round(2 * SEABED_R / SEABED_STEP) + 1;
  const x0 = cx - SEABED_R, y0 = cy - SEABED_R;           // window tiles
  const pad = SHORE_SEARCH;
  const F = shoreField(Math.floor(x0 + Cx) - pad, Math.floor(y0 + Cy) - pad,
    Math.ceil(2 * SEABED_R) + 2 * pad + 2, Math.ceil(2 * SEABED_R) + 2 * pad + 2, isLand);
  const zAt = (wx, wy) => { const sx = wx + Cx, sy = wy + Cy; return -seabedDepth(sx, sy, isLand, F.at(sx, sy)) / M; };
  const Z = new Float32Array(n * n), C = new Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const wx = x0 + i * SEABED_STEP, wy = y0 + j * SEABED_STEP;
    const sx = wx + Cx, sy = wy + Cy, d = F.at(sx, sy);
    Z[j * n + i] = -seabedDepth(sx, sy, isLand, d) / M;
    const mat = 'sand'; // the whole bottom is sand; seabedMaterial still places rocks and wrecks
    const base = MAT_RGB[mat] || MAT_RGB.sand, v = 0.85 + 0.3 * hn2h(Math.floor(sx * 4), Math.floor(sy * 4));
    C[j * n + i] = [base[0] * v, base[1] * v, base[2] * v];
  }
  const out = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const P = (a, b) => [x0 + (i + a) * SEABED_STEP, y0 + (j + b) * SEABED_STEP, Z[(j + b) * n + i + a]];
    const rgb = C[j * n + i];
    quad(out, P(0, 0), P(1, 0), P(1, 1), P(0, 1), rgb);
  }
  // Rocks: a few boulders per rocky tile, hashed so they stay put.
  const rocks = [];
  for (let ty = Math.floor(y0 + Cy); ty <= Math.ceil(y0 + Cy + 2 * SEABED_R); ty++) {
    for (let tx = Math.floor(x0 + Cx); tx <= Math.ceil(x0 + Cx + 2 * SEABED_R); tx++) {
      for (let k = 0; k < 3; k++) {
        const h = hn2h(tx * 31 + k, ty * 17 - k);
        const sx = tx + hn2h(tx + k * 7, ty - 3), sy = ty + hn2h(tx - 5, ty + k * 11);
        const d = F.at(sx, sy); if (d <= 0) continue;
        const mat = seabedMaterial(sx, sy, isLand, d, F.at);
        if (h > (mat === 'rock' ? 0.55 : 0.08)) continue;
        const wx = sx - Cx, wy = sy - Cy, z = zAt(wx, wy), s = 0.04 + 0.12 * hn2h(tx - k, ty + 9);
        const top = [wx, wy, z + s * 1.2];
        const ring = [0, 1, 2, 3, 4].map((q) => { const a = q / 5 * Math.PI * 2 + h * 6; return [wx + Math.cos(a) * s, wy + Math.sin(a) * s, z - 0.01]; });
        for (let q = 0; q < 5; q++) tri(out, ring[q], ring[(q + 1) % 5], top, [0.33, 0.34, 0.36], 1);
      }
      // Scatter: tyres, barrels, coral and the rest, hashed per tile slot (shared/seabed.js).
      for (let k = 0; k < SCATTER_SLOTS; k++) {
        const o = scatterAt(tx, ty, k, isLand, F.at);
        if (o) scatterMesh(out, o, o.x - Cx, o.y - Cy, zAt(o.x - Cx, o.y - Cy));
      }
      // Weed: roots only here; the fronds move, so they are built per frame.
      const hw = hn2h(tx * 7 - 1, ty * 3 + 5);
      const sx = tx + hn2h(tx + 99, ty), sy = ty + hn2h(tx, ty + 99);
      const d = F.at(sx, sy);
      if (d > 0 && hw < 0.35) {
        const depthM = seabedDepth(sx, sy, isLand, d);
        if (depthM > 1.5 && depthM < 45) rocks.push({ x: sx - Cx, y: sy - Cy, z: -depthM / M, h: Math.min(depthM / M * 0.8, 0.25 + 0.5 * hw), seed: hw });
      }
    }
  }
  // Wrecks, hashed by seabed.js so every client puts them in the same place.
  const wrecks = wrecksNear(cx + Cx, cy + Cy, SEABED_R + 2, isLand);
  for (const w of wrecks) wreckMesh(out, w, w.x - Cx, w.y - Cy, zAt(w.x - Cx, w.y - Cy));
  return { terrain: new Float32Array(out), weed: rocks, wrecks };
}

// Weed fronds, bubbles and the particles in the water — rebuilt every frame.
function buildMoving(st, now, ship) {
  const t = now / 1000;
  const props = [];
  for (const w of st.weed) {
    for (let k = 0; k < 3; k++) {
      const ang = w.seed * 20 + k * 2.1, ox = Math.cos(ang) * 0.03, oy = Math.sin(ang) * 0.03;
      const sway = Math.sin(t * 0.8 + w.seed * 10 + k) * 0.06;
      const base = [w.x + ox, w.y + oy, w.z];
      const tip = [w.x + ox + sway, w.y + oy + sway * 0.5, w.z + w.h * (0.7 + 0.3 * k / 2)];
      const e = 0.012;
      quad(props, [base[0] - e, base[1], base[2]], [base[0] + e, base[1], base[2]], [tip[0] + e * 0.4, tip[1], tip[2]], [tip[0] - e * 0.4, tip[1], tip[2]], [0.18, 0.36, 0.16], 1);
    }
  }
  // Points: x, y, z, size (tiles), alpha, kind (0 bubble, 1 particle).
  const pts = [];
  if (ship) {
    // Engine bubbles off the stern. Each one is a pure function of its index and the clock: it was
    // let go `age` seconds ago from where the stern was then, which is where it is now less how far
    // she has come, and it rises and wobbles until it meets the surface.
    const N = 56, P = 3.4, fx = ship.sinh, fy = -ship.cosh;
    const spd = ship.speed || 0;
    for (let i = 0; i < N; i++) {
      const age = ((t + i * P / N) % P);
      const h = hn2h(i * 13, 7);
      const back = 0.1 + age * (spd + 0.05);
      const wob = Math.sin(t * 3 + i) * 0.015 * age;
      let x = ship.x - fx * back + fy * (h - 0.5) * 0.05 + wob;
      let y = ship.y - fy * back - fx * (h - 0.5) * 0.05;
      let z = ship.z + age * (0.2 + 0.1 * h);
      if (ship.z >= -0.001) { z = 0.004; if (age > 1.8) continue; }   // on the surface: froth, briefly
      else if (z > -0.005) continue;                                   // reached the surface: gone
      pts.push(x, y, z, 0.008 + 0.012 * h, 0.85 - age / P * 0.5, 0);
    }
    // THE BALLAST VENTS, a row along each flank. Flooding, the air the water displaces escapes out
    // of the TOP vents in fat, slow gulps; blowing, compressed air roars out of the bottom ones in a
    // dense fast sheet that boils the surface over her. Both are pure functions of the clock like
    // the engine stream, scaled by how hard the tanks are moving (`vent`, 0..1, from cockpit.js).
    const vent = ship.vent;
    const flood = vent ? vent.flood || 0 : 0, blow = vent ? vent.blow || 0 : 0;
    if (flood > 0.02 || blow > 0.02) {
      const blowing = blow > flood, k = Math.max(flood, blow);
      const V = blowing ? 90 : 48, VP = blowing ? 1.1 : 2.2;
      const sx = -fy, sy = fx;             // her starboard beam
      for (let i = 0; i < V; i++) {
        if (hn2h(i * 7, 11) > k) continue;   // fewer vents working as the tanks near full/empty
        const age = ((t + i * VP / V) % VP);
        const h = hn2h(i * 5, 9), side = i % 2 ? 1 : -1;
        const along = (hn2h(i, 21) - 0.5) * 0.16;        // spread down the length of the hull
        const out = 0.035 + age * (blowing ? 0.05 : 0.012);
        const wob = Math.sin(t * 5 + i) * 0.01 * age;
        const x = ship.x + fx * along + sx * side * out + wob;
        const y = ship.y + fy * along + sy * side * out;
        let z = ship.z + (blowing ? -0.01 : 0.01) + age * (blowing ? 0.35 : 0.14);
        if (z > -0.003) {
          // Breaking the surface: a boil of froth that lingers a moment where it came up.
          if (age > VP * 0.8) continue;
          z = 0.004;
        }
        pts.push(x, y, z, (blowing ? 0.006 : 0.013) + 0.012 * h, (blowing ? 0.95 : 0.8) - age / VP * 0.5, 0);
      }
    }
  }
  if (st.sub > 0 && st.cam) {
    // Particles hanging in the water: a lattice round the camera, each drifting slowly and wrapped
    // into the box, so there is always something passing the glass to say you are moving.
    const B = 2.4;
    for (let i = 0; i < 140; i++) {
      const hx = hn2h(i, 1), hy = hn2h(i, 2), hz = hn2h(i, 3);
      const wrap = (v) => ((v % (2 * B)) + 2 * B) % (2 * B) - B;
      const x = st.cam.x + wrap(hx * 2 * B + t * 0.02 - st.cam.x);
      const y = st.cam.y + wrap(hy * 2 * B + t * 0.013 - st.cam.y);
      const z = st.cam.z + wrap(hz * 2 * B - t * 0.01 - st.cam.z) * 0.5;
      if (z > -0.01) continue;
      pts.push(x, y, z, 0.004 + 0.004 * hn2h(i, 4), 0.5, 1);
    }
  }
  return { props: new Float32Array(props), points: new Float32Array(pts) };
}

// ── THE BOTTOM, FOR A CAMERA THAT MIGHT GO THROUGH IT ─────────────────────────
// A free camera can fly under the sea, and must stop at the seabed rather than sink through it —
// and over land it must stop at the ground, which is where the old 0.05 floor put it. The floor
// pass notes the map window every frame; `floorZAt` answers from it in the same window tiles.
// Memoised to a quarter tile because the renderer asks it several times a frame.
let WIN = null;
export function noteSeabedWindow(LUT, mh, mapCenter) {
  if (!LUT || !mh || !mapCenter) return;
  const Cx = mapCenter.x | 0, Cy = mapCenter.y | 0;
  if (WIN && WIN.LUT === LUT && WIN.Cx === Cx && WIN.Cy === Cy) return;
  WIN = { LUT, Cx, Cy, isLand: landFromLUT(LUT, mh, Cx, Cy), memo: new Map() };
}
// Whether a seabed window has been noted yet. floorZAt answers 0 both on land AND when it does not
// know, and a caller that treats 0 as "on the sand" (the hull surf gain) has to tell them apart, or
// every hull goes flat until the first window is built.
export const seabedWindowReady = () => !!WIN;
// Metres of water under a WORLD position (0 on land), or null before any window has been noted.
// The Drake's SUB gate reads it; the server still makes the real call (plugins/submersible MIN_WATER).
export function depthMAt(x, y) {
  if (!WIN || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (WIN.isLand(Math.floor(x), Math.floor(y))) return 0;
  return seabedDepth(x, y, WIN.isLand);
}
// z (tiles, sea level 0) of the ground or seabed under a window position; 0 on land or unknown.
export function floorZAt(wx, wy) {
  if (!WIN || !Number.isFinite(wx) || !Number.isFinite(wy)) return 0;
  const k = Math.round(wx * 4) + ',' + Math.round(wy * 4);
  let z = WIN.memo.get(k);
  if (z === undefined) {
    const sx = wx + WIN.Cx, sy = wy + WIN.Cy;
    z = WIN.isLand(Math.floor(sx), Math.floor(sy)) ? 0 : -seabedDepth(sx, sy, WIN.isLand) / M;
    if (WIN.memo.size > 4000) WIN.memo.clear();
    WIN.memo.set(k, z);
  }
  return z;
}

// The whole scene for this frame, or null when there is nothing to draw.
// `sub` is the camera's depth in tiles below mean sea level (0 on the surface).
export function underwaterScene({ LUT, mh, mapCenter, cam, ship, sub, now, night }) {
  if (!LUT || !mh || !mapCenter) return null;
  const Cx = mapCenter.x | 0, Cy = mapCenter.y | 0;
  let st = null;
  if (sub > 0) {
    const cx = Math.floor(cam.x), cy = Math.floor(cam.y);
    const key = `${Cx},${Cy},${cx},${cy}`;
    if (cache.key !== key) {
      const isLand = landFromLUT(LUT, mh, Cx, Cy);
      cache = { key, ...buildStatic(Cx, Cy, cx, cy, isLand) };
    }
    st = { sub, cam: { x: cam.x, y: cam.y, z: -sub }, weed: cache.weed };
  } else if (!ship) return null;
  const moving = buildMoving(st || { sub: 0, weed: [] }, now, ship);
  // The colour of the water itself: blue-green by day, deeper and darker the further down she is.
  const depthM = sub * M, lit = (1 - 0.85 * (night || 0)) * Math.exp(-depthM / 90);
  return {
    sub, key: cache.key,
    terrain: sub > 0 ? cache.terrain : null,
    props: moving.props, points: moving.points,
    water: [0.03 + 0.05 * lit, 0.14 + 0.22 * lit, 0.19 + 0.25 * lit],
    lit,
  };
}
