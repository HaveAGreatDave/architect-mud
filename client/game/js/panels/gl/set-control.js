// GLASS 2 · PIECES FOR A TRANSMITTER'S CONTROL ROOM. Rows for set-mesh.js's SET_PIECES, first for the
// Quiet Hour (set_quiet_hour): a wall of night sky with a galaxy in it, oscilloscope cabinets, a
// reel-to-reel rack, an operator's console and rings of light on the floor. Each row is a label, its
// fields and a `draw(K, p, set)` built from the room kit (room-kit.js), in metres. Nothing here names
// a show.
//
// ⚠ A PIECE'S +x IS THE VIEWER'S LEFT when it faces the cameras (yaw 180), and K's points are [u, v, y].

import { MAT } from './ballpark-mesh.js';

const { GLOSS, METAL, SATIN } = MAT, LIT = MAT.EMISSIVE, TAU = Math.PI * 2;

const num = (v, d) => (Number.isFinite(+v) && v !== '' && v != null ? +v : d);
const F = (k, label, type = 'number') => ({ k, label, type });
const facingOf = (yaw) => { const a = (yaw || 0) * Math.PI / 180; return [Math.sin(a), Math.cos(a)]; };
function rollOf(seed) { let s = ((Math.abs(Math.round(seed)) * 9301 + 49297) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// A ring (or a disc, from r0 = 0) flat on a frame's face at depth z, round (cx, cy).
function ring(K, fr, cx, cy, z, r0, r1, col, mat = SATIN, n = 20, raw = false) {
  const nn = fr.N(0, 0, 1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, b = ((i + 1) / n) * TAU;
    K.quad(K.solid, [fr.P(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, z), fr.P(cx + Math.cos(b) * r0, cy + Math.sin(b) * r0, z), fr.P(cx + Math.cos(b) * r1, cy + Math.sin(b) * r1, z), fr.P(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, z)], nn, col, mat, null, raw);
  }
}
// A lit line through points [[x, y], ...] on a frame's face, `t` thick.
function trace(K, fr, pts, z, t, col) {
  const nn = fr.N(0, 0, 1);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    K.quad(K.solid, [fr.P(x0, y0 - t, z), fr.P(x1, y1 - t, z), fr.P(x1, y1 + t, z), fr.P(x0, y0 + t, z)], nn, col, LIT, null, true);
  }
}
// A round scope face: bezel, dark glass, a graticule and a sine trace that dies away at the rim.
function scope(K, fr, cx, cy, z, r, hex, wave, seedPhase = 0) {
  ring(K, fr, cx, cy, z, r, r * 1.16, K.C('#8a8e90'), METAL, 24);
  ring(K, fr, cx, cy, z + 0.003, 0, r, K.C('#050a08'), GLOSS, 24);
  const dim = K.C(hex, 0.35), g = r * 0.012;
  for (const k of [-0.5, 0, 0.5]) {
    const half = r * Math.sqrt(1 - k * k) * 0.96;
    fr.front(K.solid, cx - half, cx + half, cy + k * r - g, cy + k * r + g, z + 0.005, dim, LIT);
    fr.front(K.solid, cx + k * r - g, cx + k * r + g, cy - half, cy + half, z + 0.005, dim, LIT);
  }
  const pts = [], n = 28;
  for (let i = 0; i <= n; i++) {
    const x = (i / n * 2 - 1) * r * 0.94, env = Math.sqrt(Math.max(0, 1 - (x / r) ** 2));
    pts.push([cx + x, cy + (wave ? Math.sin((i / n) * TAU * wave + seedPhase) * r * 0.5 * env : 0)]);
  }
  trace(K, fr, pts, z + 0.007, r * 0.035, K.C(hex, 2.3));
}

export function controlPieces({ letterOn, brandText }) {
  return {
    starfield: {
      label: 'Night sky backdrop (stars and a galaxy)',
      fields: [F('w', 'Width'), F('h', 'Height'), F('y', 'Off the floor'), F('yaw', 'Facing (°)'), F('seed', 'Seed'), F('galaxy', 'Galaxy at (across, blank for none)'), F('colour', 'Star colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 9, h: 3.6, y: 0.2, seed: 7, galaxy: 2.4 },
      draw(K, p) {
        const w = num(p.w, 9), h = num(p.h, 3.6), y = num(p.y, 0.2), [fu, fv] = facingOf(p.yaw ?? 180), fr = K.frame(p.at[0], p.at[1], fu, fv), rnd = rollOf(num(p.seed, 7)), hex = p.colour || '#e8f0ff';
        fr.front(K.solid, -w / 2, w / 2, y, y + h, 0, K.C('#010204'), SATIN, null, false);
        const dot = (x, yy, s, k) => fr.front(K.solid, x - s, x + s, yy - s, yy + s, 0.004, K.C(hex, k), LIT);
        for (let i = 0; i < 170; i++) { const big = rnd() < 0.08; dot((rnd() - 0.5) * (w - 0.1), y + 0.05 + rnd() * (h - 0.1), big ? 0.02 : 0.007 + rnd() * 0.006, big ? 2.4 : 0.6 + rnd() * 1.2); }
        // the galaxy: two arms wound round a bright core, seen at a tilt
        if (p.galaxy === '' || p.galaxy == null || !Number.isFinite(+p.galaxy)) return;
        const gx = +p.galaxy, gy = y + h * 0.66, R = Math.min(1.25, h * 0.36);
        for (let arm = 0; arm < 2; arm++) for (let i = 0; i < 110; i++) {
          const t = i / 110, a = arm * Math.PI + t * 5.2, r = R * (0.08 + t * 0.92), jit = (rnd() - 0.5) * 0.16 * (0.4 + t);
          const x = gx + Math.cos(a) * r + jit, yy = gy + (Math.sin(a) * r + jit) * 0.42 + Math.cos(a) * r * 0.2;
          if (Math.abs(x) < w / 2 - 0.05 && yy > y + 0.05 && yy < y + h - 0.05) dot(x, yy, 0.009 + (1 - t) * 0.012, 2.2 - t * 1.5);
        }
        ring(K, fr, gx, gy, 0.005, 0, R * 0.09, K.C(hex, 2.6), LIT, 14, true);
        ring(K, fr, gx, gy, 0.0045, R * 0.09, R * 0.17, K.C(hex, 1.1), LIT, 14, true);
      },
    },
    oscilloscope: {
      label: 'Oscilloscope cabinet',
      fields: [F('yaw', 'Facing (°)'), F('h', 'Height'), F('w', 'Width'), F('wave', 'Cycles on the trace (0 is a flat line)'), F('colour', 'Trace colour', 'text')],
      make: { at: [0, 0], yaw: 180, h: 1.55, w: 0.72, wave: 2 },
      draw(K, p, set) {
        const h = num(p.h, 1.55), w = num(p.w, 0.72), wave = num(p.wave, 2), [fu, fv] = facingOf(p.yaw ?? 180), fr = K.frame(p.at[0], p.at[1], fu, fv), pal = set.palette || {};
        const hex = p.colour || set.brand?.colour || pal.accent || '#b8f0c8', body = pal.cabinet || '#2c3032', r = w * 0.33, cy = h - r * 1.16 - 0.1;
        fr.pbox(-w / 2 + 0.03, w / 2 - 0.03, 0, 0.08, -0.5, -0.04, '#0b0c0d', 1, null, SATIN);
        fr.pbox(-w / 2, w / 2, 0.08, h, -0.54, 0, body, 1, null, METAL);
        fr.pbox(-w / 2 + 0.03, w / 2 - 0.03, 0.12, h - 0.03, 0, 0.012, '#1a1d1e', 1, null, SATIN);
        scope(K, fr, 0, cy, 0.014, r, hex, wave, p.at[0] * 1.7);
        // the knobs under the glass, two lamps, a maker's plate and the vent
        const ky = cy - r * 1.16 - 0.12;
        for (let i = 0; i < 4; i++) { const x = (i - 1.5) * w * 0.2; ring(K, fr, x, ky, 0.03, 0, 0.034, K.C('#0c0d0e'), GLOSS, 10); ring(K, fr, x, ky, 0.014, 0.034, 0.046, K.C('#7a7e80'), METAL, 10); fr.pbox(x - 0.004, x + 0.004, ky, ky + 0.03, 0.03, 0.033, '#e8e8e0', 1.3); }
        fr.pbox(-w * 0.36, -w * 0.36 + 0.03, ky - 0.13, ky - 0.1, 0.012, 0.02, '#ff4a30', 2.2, null, LIT);
        fr.pbox(-w * 0.36 + 0.06, -w * 0.36 + 0.09, ky - 0.13, ky - 0.1, 0.012, 0.02, hex, 1.9, null, LIT);
        fr.pbox(w * 0.1, w * 0.36, ky - 0.135, ky - 0.095, 0.012, 0.016, '#9a9c98', 1, null, METAL);
        for (let yy = 0.2; yy < ky - 0.26; yy += 0.06) fr.pbox(-w * 0.34, w * 0.34, yy, yy + 0.025, 0.012, 0.018, '#090a0b', 1, null, SATIN);
      },
    },
    tape_deck: {
      label: 'Reel-to-reel rack',
      fields: [F('yaw', 'Facing (°)'), F('h', 'Height'), F('w', 'Width'), F('seed', 'Seed (which lamps are lit)'), F('colour', 'Lamp colour', 'text')],
      make: { at: [0, 0], yaw: 180, h: 1.95, w: 0.8, seed: 3 },
      draw(K, p, set) {
        const h = num(p.h, 1.95), w = num(p.w, 0.8), [fu, fv] = facingOf(p.yaw ?? 180), fr = K.frame(p.at[0], p.at[1], fu, fv), pal = set.palette || {}, rnd = rollOf(num(p.seed, 3));
        const hex = p.colour || set.brand?.colour || pal.accent || '#b8f0c8', r = w * 0.2, ry = h - r - 0.12;
        fr.pbox(-w / 2, w / 2, 0, h, -0.52, 0, pal.cabinet || '#2c3032', 1, null, METAL);
        fr.pbox(-w / 2 + 0.03, w / 2 - 0.03, ry - r - 0.2, h - 0.03, 0, 0.012, '#b8bab6', 1, null, METAL);
        // two reels, each a flange with three windows and a hub, and the tape between them over the heads
        for (const s of [-1, 1]) {
          const x = s * w * 0.23;
          ring(K, fr, x, ry, 0.02, r * 0.3, r, K.C('#d4d6d2'), METAL, 24);
          ring(K, fr, x, ry, 0.016, 0, r * 0.86, K.C('#3a2a1e'), SATIN, 24);
          for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + s * 0.5; ring(K, fr, x + Math.cos(a) * r * 0.62, ry + Math.sin(a) * r * 0.62, 0.022, 0, r * 0.2, K.C('#3a2a1e'), SATIN, 10); }
          ring(K, fr, x, ry, 0.026, 0, r * 0.2, K.C('#17181a'), GLOSS, 12);
        }
        fr.pbox(-w * 0.2, w * 0.2, ry - r - 0.07, ry - r - 0.055, 0.014, 0.018, '#3a2a1e', 1, null, SATIN);
        fr.pbox(-w * 0.09, w * 0.09, ry - r - 0.15, ry - r - 0.05, 0.012, 0.04, '#1c1e20', 1, null, GLOSS);
        // two meters with their needles, a row of keys, and a field of lamps
        const my = ry - r - 0.36;
        for (const s of [-1, 1]) {
          const x = s * w * 0.2;
          fr.pbox(x - w * 0.15, x + w * 0.15, my, my + 0.12, 0, 0.014, '#f0e2b0', 1.7, null, LIT);
          const a = Math.PI / 2 + (rnd() - 0.5) * 1.1;
          trace(K, fr, [[x, my + 0.01], [x + Math.cos(a) * 0.1, my + 0.01 + Math.sin(a) * 0.1]], 0.016, 0.004, K.C('#1a1208', 1));
        }
        for (let i = 0; i < 5; i++) { const x = (i - 2) * w * 0.15; fr.pbox(x - w * 0.055, x + w * 0.055, my - 0.11, my - 0.05, 0, 0.03, i === 4 ? '#b02a20' : '#e4e2da', 1, null, GLOSS); }
        for (let row = 0; row < 5; row++) for (let c = 0; c < 8; c++) {
          const x = (c - 3.5) * w * 0.1, yy = 0.22 + row * 0.1, on = rnd() < 0.42;
          fr.pbox(x - 0.014, x + 0.014, yy, yy + 0.028, 0, 0.012, on ? hex : '#16191a', on ? 1.5 + rnd() : 1, null, on ? LIT : SATIN);
        }
      },
    },
    control_desk: {
      label: 'Operator console',
      fields: [F('w', 'Width'), F('depth', 'Depth'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('text', 'Front lettering', 'text'), F('seed', 'Seed (which lamps are lit)'), F('colour', 'Lamp colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 2.6, depth: 0.62, h: 0.8, seed: 5 },
      draw(K, p, set) {
        const w = num(p.w, 2.6), dp = num(p.depth, 0.62), h = num(p.h, 0.8), [fu, fv] = facingOf(p.yaw ?? 180), fr = K.frame(p.at[0], p.at[1], fu, fv), pal = set.palette || {}, rnd = rollOf(num(p.seed, 5));
        const hex = p.colour || set.brand?.colour || pal.accent || '#b8f0c8', body = pal.desk || '#26292b', z = dp / 2;
        fr.pbox(-w / 2 + 0.06, w / 2 - 0.06, 0, 0.1, -z + 0.06, z - 0.06, '#0a0b0c', 1, null, SATIN);
        fr.pbox(-w / 2, w / 2, 0.1, h, -z, z, body, 1, null, METAL);
        // the worktop tips up toward the cameras into a hood, the way a console hides its operator's hands
        K.quad(K.solid, [fr.P(-w / 2, h, -z), fr.P(w / 2, h, -z), fr.P(w / 2, h + 0.12, z), fr.P(-w / 2, h + 0.12, z)], fr.N(0, 0.97, -0.25), K.C(pal.deskTop || '#3a3e40'), SATIN);
        fr.pbox(-w / 2, w / 2, h, h + 0.12, z - 0.03, z, body, 1, null, METAL);
        for (const s of [-1, 1]) K.quad(K.solid, [fr.P(s * w / 2, h, -z), fr.P(s * w / 2, h, z), fr.P(s * w / 2, h + 0.12, z), fr.P(s * w / 2, h, -z)], fr.N(s, 0, 0), K.C(body), METAL);
        // the fascia: a small scope at each end, the lettering between them, and rows of lamps underneath
        const text = brandText(p.text, set), sr = Math.min(0.13, h * 0.17), sy = h - sr * 1.16 - 0.03;
        fr.pbox(-w / 2 + 0.04, w / 2 - 0.04, 0.16, h + 0.12, z, z + 0.01, '#141617', 1, null, SATIN);
        for (const s of [-1, 1]) scope(K, fr, s * (w / 2 - sr * 1.16 - 0.1), sy, z + 0.012, sr, hex, s > 0 ? 3 : 1.5, s);
        letterOn(K, fr, text, { y: sy - 0.07, z: z + 0.014, h: 0.13, maxW: w - sr * 5.2 - 0.5, hex });
        for (let row = 0; row < 3; row++) for (let c = 0; c < Math.floor((w - 0.3) / 0.09); c++) {
          const x = -w / 2 + 0.2 + c * 0.09, yy = 0.22 + row * 0.085, kind = rnd();
          if (kind < 0.3) continue;
          const on = kind > 0.62, red = kind > 0.95;
          fr.pbox(x - 0.016, x + 0.016, yy, yy + 0.032, z + 0.01, z + 0.022, on ? (red ? '#ff4a30' : hex) : '#2a2e30', on ? 1.5 + rnd() * 0.8 : 1, null, on ? LIT : GLOSS);
        }
      },
    },
    signal_rings: {
      label: 'Rings of light on the floor',
      fields: [F('r', 'Outer radius'), F('n', 'Rings'), F('colour', 'Colour', 'text'), F('glow', 'Brightness')],
      make: { at: [0, 0], r: 2.4, n: 5, glow: 1.5 },
      draw(K, p, set) {
        const R = num(p.r, 2.4), n = Math.max(1, Math.min(12, num(p.n, 5) | 0)), hex = p.colour || set.brand?.colour || set.palette?.accent || '#b8f0c8', glow = num(p.glow, 1.5), [u, v] = p.at;
        // each ring a little thinner and dimmer than the one inside it, like a signal going out
        for (let i = 0; i < n; i++) { const r = R * (i + 1) / n, t = 0.05 * (1 - i / n * 0.6); K.lathe(u, v, [[r + t, 0.004], [r, 0.004]], hex, glow * (1 - i / n * 0.65), 48); }
        K.lathe(u, v, [[0.07, 0.005], [0, 0.005]], hex, glow * 1.3, 16);
      },
    },
  };
}
