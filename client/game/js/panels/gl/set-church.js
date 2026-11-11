// GLASS 2 · PIECES FOR A SET THAT IS A CHURCH. Rows for set-mesh.js's SET_PIECES, first for a Sunday
// service shot in its own chapel: a rose window and lancets in stained glass, an altar on its footpace,
// candle stands, a rank of organ pipes, a choir in tiers, urns of flowers, a communion rail and stone
// pillars. Each row is a label, its fields and a `draw(K, p, set)` built from the room kit (room-kit.js),
// in metres. Nothing here names a show; a rose window's `centre` can be a plain boss or an eye.
//
// ⚠ A PIECE'S +x IS THE VIEWER'S LEFT when it faces the cameras (yaw 180), and K's points are [u, v, y].

import { MAT } from './ballpark-mesh.js';

const { GLOSS, METAL, SATIN, CLOTH, EMISSIVE } = MAT;
const TAU = Math.PI * 2;

const num = (v, d) => (Number.isFinite(+v) && v !== '' && v != null ? +v : d);
const F = (k, label, type = 'number') => ({ k, label, type });
const facingOf = (yaw) => { const a = (yaw || 0) * Math.PI / 180; return [Math.sin(a), Math.cos(a)]; };
const frameOf = (K, p, yaw = 180) => { const [fu, fv] = facingOf(p.yaw ?? yaw); return K.frame(p.at[0], p.at[1], fu, fv); };
function rollOf(seed) { let s = ((Math.abs(Math.round(seed)) * 9301 + 49297) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const listOf = (v, d) => { const l = String(v || '').split(',').map((s) => s.trim()).filter(Boolean); return l.length ? l : d; };
const GLASS_COLOURS = ['#2a5ad0', '#c02a2a', '#e0b030', '#2a8a4a', '#6a2aa0'];

// a flat polygon in the piece's frame at depth z, its points [x, y] counter-clockwise from the front
function flat(K, fr, pts, z, hex, k = 1, mat = SATIN) {
  K.quad(K.solid, pts.map(([x, y]) => fr.P(x, y, z)), fr.N(0, 0, 1), K.C(hex, k), mat, null, k >= 1.25);
}
// a ring segment between radii r0 and r1, angles a to b, round (cx, cy)
const wedge = (cx, cy, a, b, r0, r1) => [[cx + Math.cos(a) * r0, cy + Math.sin(a) * r0], [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1], [cx + Math.cos(b) * r1, cy + Math.sin(b) * r1], [cx + Math.cos(b) * r0, cy + Math.sin(b) * r0]];

export function churchPieces({ letterOn, brandText }) {
  return {
    rose_window: {
      label: 'Rose window (stained glass)',
      fields: [F('r', 'Radius'), F('y', 'Centre off the floor'), F('yaw', 'Facing (°)'), F('petals', 'Petals'), F('colours', 'Glass colours (comma list)', 'text'), F('centre', 'Centre: rose or eye', 'text'), F('glow', 'Brightness')],
      make: { at: [0, 0], yaw: 180, r: 1.4, y: 4.2, petals: 12 },
      draw(K, p, set) {
        const R = num(p.r, 1.4), cy = num(p.y, 4.2), n = Math.max(6, Math.min(24, num(p.petals, 12) | 0)), fr = frameOf(K, p), g = num(p.glow, 1.7);
        const cols = listOf(p.colours, GLASS_COLOURS), stone = set.palette?.trim || '#3a3228', lead = '#14100c', accent = set.palette?.accent || '#9ad0ff';
        const step = TAU / n, seg = 4;
        // the stone surround, proud of the wall
        for (let i = 0; i < n * seg; i++) { const a = (i * step) / seg, b = ((i + 1) * step) / seg; flat(K, fr, wedge(0, cy, a, b, R, R + 0.2), 0.05, stone); }
        // two rings of panes: the petals, and the outer lobes between them
        for (let i = 0; i < n; i++) {
          const a0 = i * step + step / 2;
          for (let s = 0; s < seg; s++) {
            const a = a0 + (s * step) / seg, b = a0 + ((s + 1) * step) / seg;
            flat(K, fr, wedge(0, cy, a, b, R * 0.36, R * 0.7), 0.01, cols[i % cols.length], g, EMISSIVE);
            flat(K, fr, wedge(0, cy, a, b, R * 0.72, R), 0.01, cols[(i + 2) % cols.length], g * 0.92, EMISSIVE);
          }
          // the tracery between petals
          const x = Math.cos(a0), y = Math.sin(a0), t = 0.025, nx = -y * t, ny = x * t;
          flat(K, fr, [[x * R * 0.34 - nx, cy + y * R * 0.34 - ny], [x * R - nx, cy + y * R - ny], [x * R + nx, cy + y * R + ny], [x * R * 0.34 + nx, cy + y * R * 0.34 + ny]], 0.025, stone);
        }
        for (const r of [0.36, 0.71]) for (let i = 0; i < n * seg; i++) { const a = (i * step) / seg, b = ((i + 1) * step) / seg; flat(K, fr, wedge(0, cy, a, b, R * r - 0.025, R * r + 0.025), 0.025, stone); }
        // the leading inside each petal
        for (let i = 0; i < n * seg; i++) { const a = (i * step) / seg, b = ((i + 1) * step) / seg; flat(K, fr, wedge(0, cy, a, b, R * 0.53 - 0.008, R * 0.53 + 0.008), 0.02, lead); }
        const ri = R * 0.34;
        if (String(p.centre || '').toLowerCase() !== 'eye') {
          for (let i = 0; i < 16; i++) flat(K, fr, wedge(0, cy, (i * TAU) / 16, ((i + 1) * TAU) / 16, 0, ri), 0.015, cols[2 % cols.length], g * 1.1, EMISSIVE);
          return;
        }
        // the eye: pale glass, an almond of white and an iris in the accent
        for (let i = 0; i < 16; i++) flat(K, fr, wedge(0, cy, (i * TAU) / 16, ((i + 1) * TAU) / 16, 0, ri), 0.015, '#1a2a3a', g * 0.8, EMISSIVE);
        const w = ri * 0.95, h = ri * 0.5, m = 12;
        for (let i = 0; i < m; i++) {
          const x0 = -w + (2 * w * i) / m, x1 = x0 + (2 * w) / m, f = (x) => h * (1 - (x / w) ** 2);
          flat(K, fr, [[x0, cy - f(x0)], [x1, cy - f(x1)], [x1, cy + f(x1)], [x0, cy + f(x0)]], 0.02, '#eef6ff', g * 1.2, EMISSIVE);
        }
        for (let i = 0; i < 16; i++) flat(K, fr, wedge(0, cy, (i * TAU) / 16, ((i + 1) * TAU) / 16, 0, h * 0.85), 0.025, accent, g * 1.3, EMISSIVE);
        for (let i = 0; i < 16; i++) flat(K, fr, wedge(0, cy, (i * TAU) / 16, ((i + 1) * TAU) / 16, 0, h * 0.34), 0.03, '#06121a');
      },
    },
    lancet: {
      label: 'Lancet window (stained glass)',
      fields: [F('w', 'Width'), F('h', 'Height to the springing'), F('y', 'Sill off the floor'), F('yaw', 'Facing (°)'), F('colours', 'Glass colours (comma list)', 'text'), F('glow', 'Brightness')],
      make: { at: [0, 0], yaw: 180, w: 0.9, h: 2.6, y: 1.6 },
      draw(K, p, set) {
        const w = num(p.w, 0.9), hw = w / 2, h = num(p.h, 2.6), y0 = num(p.y, 1.6), arch = w * 0.9, fr = frameOf(K, p), g = num(p.glow, 1.5);
        const cols = listOf(p.colours, GLASS_COLOURS), stone = set.palette?.trim || '#3a3228', lead = '#14100c', roll = rollOf(p.at[0] * 31 + p.at[1] * 17);
        const top = (x) => y0 + h + arch * Math.sqrt(Math.max(0, 1 - (Math.abs(x) / hw) ** 1.6));
        // panes in a grid, the pointed head cut by the arch
        const cw = w / 3, rh = 0.4;
        for (let c = 0; c < 3; c++) for (let y = y0; y < y0 + h + arch; y += rh) {
          const x0 = -hw + c * cw, x1 = x0 + cw, t0 = top(x0), t1 = top(x1), ya = y, yb = y + rh;
          if (ya >= Math.max(t0, t1)) continue;
          flat(K, fr, [[x0, ya], [x1, ya], [x1, Math.min(yb, t1)], [x0, Math.min(yb, t0)]], 0.01, cols[(roll() * cols.length) | 0], g * (0.85 + roll() * 0.3), EMISSIVE);
        }
        // the lead between them, and the stone round it
        for (let c = 1; c < 3; c++) { const x = -hw + c * cw; flat(K, fr, [[x - 0.012, y0], [x + 0.012, y0], [x + 0.012, top(x)], [x - 0.012, top(x)]], 0.02, lead); }
        for (let y = y0 + rh; y < y0 + h; y += rh) flat(K, fr, [[-hw, y - 0.01], [hw, y - 0.01], [hw, y + 0.01], [-hw, y + 0.01]], 0.02, lead);
        const sides = 10;
        for (let i = 0; i < sides; i++) {
          const xa = -hw + (w * i) / sides, xb = xa + w / sides;
          flat(K, fr, [[xa, top(xa)], [xb, top(xb)], [xb, top(xb) + 0.12], [xa, top(xa) + 0.12]], 0.04, stone);
        }
        for (const s of [-1, 1]) fr.pbox(s * hw - 0.08, s * hw + 0.08, y0, y0 + h + 0.08, -0.04, 0.06, stone, 1, null, SATIN);
        fr.pbox(-hw - 0.12, hw + 0.12, y0 - 0.1, y0, -0.04, 0.12, stone, 1, null, SATIN);
      },
    },
    altar: {
      label: 'Altar on a footpace',
      fields: [F('w', 'Width'), F('depth', 'Depth'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('text', 'Lettering on the frontal', 'text'), F('colour', 'Frontal colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 2.2, depth: 0.9, h: 1.0 },
      draw(K, p, set) {
        const w = num(p.w, 2.2), d = num(p.depth, 0.9), h = num(p.h, 1.0), fr = frameOf(K, p), pal = set.palette || {}, gold = '#c8a050', step = 0.18;
        fr.pbox(-w / 2 - 0.6, w / 2 + 0.6, 0, step, -d / 2 - 0.4, d / 2 + 0.7, pal.trim || '#3a3228', 1, null, SATIN);
        fr.pbox(-w / 2, w / 2, step, step + h - 0.04, -d / 2, d / 2, pal.desk || '#5a4a3a', 1, null, SATIN);
        // the fair linen over the top, hanging down the ends
        fr.pbox(-w / 2 - 0.08, w / 2 + 0.08, step + h - 0.04, step + h, -d / 2 - 0.02, d / 2 + 0.04, '#f0ece2', 1, null, CLOTH);
        for (const s of [-1, 1]) fr.pbox(s > 0 ? w / 2 : -w / 2 - 0.02, s > 0 ? w / 2 + 0.02 : -w / 2, step + h * 0.35, step + h, -d / 2, d / 2, '#f0ece2', 1, null, CLOTH);
        // the frontal, gold-edged
        const c = p.colour || pal.accent || '#7a1a2a';
        fr.pbox(-w * 0.4, w * 0.4, step + 0.06, step + h - 0.08, d / 2, d / 2 + 0.02, c, 1, null, CLOTH);
        fr.pbox(-w * 0.4, w * 0.4, step + h - 0.16, step + h - 0.12, d / 2 + 0.02, d / 2 + 0.03, gold, 1.2, null, METAL);
        fr.pbox(-w * 0.4, w * 0.4, step + 0.1, step + 0.14, d / 2 + 0.02, d / 2 + 0.03, gold, 1.2, null, METAL);
        letterOn(K, fr, brandText(p.text, set), { y: step + h * 0.42, z: d / 2 + 0.035, h: 0.12, maxW: w * 0.7, hex: gold });
      },
    },
    candles: {
      label: 'Candle stand',
      fields: [F('n', 'Candles'), F('h', 'Height'), F('w', 'Spread'), F('yaw', 'Facing (°)')],
      make: { at: [0, 0], yaw: 180, n: 3, h: 1.4, w: 0.5 },
      draw(K, p) {
        const n = Math.max(1, Math.min(9, num(p.n, 3) | 0)), h = num(p.h, 1.4), w = num(p.w, 0.5), fr = frameOf(K, p), brass = '#b8903a', [u, v] = p.at;
        K.lathe(u, v, [[0.18, 0], [0.18, 0.04], [0.05, 0.1], [0.03, h - 0.06], [0.05, h - 0.04], [0, h - 0.04]], brass, 1, 14, METAL);
        if (n > 1) fr.pbox(-w / 2, w / 2, h - 0.06, h - 0.03, -0.02, 0.02, brass, 1, null, METAL);
        for (let i = 0; i < n; i++) {
          const x = n > 1 ? -w / 2 + (w * i) / (n - 1) : 0, lift = n > 2 && i === (n - 1) / 2 ? 0.12 : 0, [cu, cv] = fr.P(x, 0, 0), y = h + lift;
          if (lift) fr.pbox(x - 0.015, x + 0.015, h - 0.03, y, -0.015, 0.015, brass, 1, null, METAL);
          K.lathe(cu, cv, [[0.05, y - 0.04], [0.05, y], [0, y]], brass, 1, 10, METAL);
          K.lathe(cu, cv, [[0.028, y], [0.028, y + 0.3], [0, y + 0.3]], '#f4eedc', 1, 10, SATIN);
          K.ball(cu, cv, y + 0.34, 0.022, '#ffd070', 3.2, 8, EMISSIVE);
        }
      },
    },
    organ_pipes: {
      label: 'Organ pipes',
      fields: [F('w', 'Width'), F('h', 'Tallest pipe'), F('y', 'Off the floor'), F('yaw', 'Facing (°)'), F('n', 'Pipes'), F('colour', 'Pipe colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 2.6, h: 3.6, y: 1.6, n: 13 },
      draw(K, p, set) {
        const w = num(p.w, 2.6), H = num(p.h, 3.6), y0 = num(p.y, 1.6), n = Math.max(3, Math.min(31, num(p.n, 13) | 0)), fr = frameOf(K, p), pipe = p.colour || '#c8ccd2', wood = set.palette?.desk || '#4a3424';
        // the case, its cornice and the shelf the pipes stand on
        fr.pbox(-w / 2 - 0.12, w / 2 + 0.12, 0, y0, -0.4, 0.1, wood, 1, null, SATIN);
        fr.pbox(-w / 2 - 0.16, w / 2 + 0.16, y0 - 0.08, y0, -0.42, 0.16, set.palette?.trim || '#2a221c', 1, null, SATIN);
        fr.pbox(-w / 2 - 0.12, w / 2 + 0.12, y0, y0 + H * 0.45, -0.4, -0.34, wood, 0.7, null, SATIN);
        const r = Math.min(0.09, (w / n) * 0.42);
        for (let i = 0; i < n; i++) {
          const t = n > 1 ? Math.abs(i - (n - 1) / 2) / ((n - 1) / 2) : 0, L = H * (1 - 0.55 * t * t), x = -w / 2 + (w * (i + 0.5)) / n, [cu, cv] = fr.P(x, 0, -0.12);
          // the foot, the body and the lip; the mouth a dark slot a third of the way up
          K.lathe(cu, cv, [[0.01, y0], [r, y0 + 0.22], [r, y0 + L], [r * 0.85, y0 + L], [r * 0.85, y0 + L - 0.02]], pipe, 1, 12, METAL);
          fr.pbox(x - r * 0.55, x + r * 0.55, y0 + 0.28, y0 + 0.36, -0.12 + r - 0.01, -0.12 + r + 0.004, '#101214', 1, null, SATIN);
        }
      },
    },
    choir: {
      label: 'Choir in tiers',
      fields: [F('w', 'Width'), F('rows', 'Tiers'), F('yaw', 'Facing (°)'), F('filled', 'Share of seats taken (0 to 1)'), F('colour', 'Robe colour', 'text'), F('stole', 'Stole colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 2.6, rows: 3, filled: 0.9 },
      draw(K, p, set) {
        const w = num(p.w, 2.6), rows = Math.max(1, Math.min(5, num(p.rows, 3) | 0)), fr = frameOf(K, p), pal = set.palette || {}, wood = pal.desk || '#4a3424';
        const robe = p.colour || '#e8e6e0', stole = p.stole || pal.accent || '#7a1a2a', roll = rollOf(p.at[0] * 41 + p.at[1] * 7 + rows), tier = 0.5, rise = 0.32;
        const skins = ['#e8c4a4', '#c89878', '#8a5a3c', '#5a3a28', '#f0d4b8', '#a87858'];
        // the front rail, waist-high, then the tiers stepping back
        fr.pbox(-w / 2, w / 2, 0, 0.95, 0.02, 0.08, wood, 1, null, SATIN);
        fr.pbox(-w / 2 - 0.02, w / 2 + 0.02, 0.95, 0.99, 0, 0.1, pal.deskTop || '#6a4a30', 1, null, GLOSS);
        for (let r = 0; r < rows; r++) {
          const y = r * rise, z1 = -r * tier, z0 = z1 - tier;
          if (r) fr.pbox(-w / 2, w / 2, 0, y, z0, z1, wood, 0.85, null, SATIN);
          const per = Math.max(1, Math.floor(w / 0.48)), gap = w / per;
          for (let i = 0; i < per; i++) {
            if (roll() > num(p.filled, 0.9)) continue;
            const x = -w / 2 + gap * (i + 0.5) + (r % 2 ? gap * 0.25 : 0), [cu, cv] = fr.P(x, 0, (z0 + z1) / 2), tall = 1.52 + roll() * 0.2;
            K.lathe(cu, cv, [[0.2, y], [0.19, y + tall * 0.5], [0.15, y + tall * 0.78], [0.08, y + tall * 0.84], [0, y + tall * 0.84]], robe, 1, 12, CLOTH);
            // the stole down the front, and the face over it
            fr.pbox(x - 0.07, x + 0.07, y + tall * 0.42, y + tall * 0.82, (z0 + z1) / 2 + 0.15, (z0 + z1) / 2 + 0.19, stole, 1, null, CLOTH);
            K.ball(cu, cv, y + tall * 0.91, 0.1, skins[(roll() * skins.length) | 0], 1, 10, SATIN);
          }
        }
      },
    },
    flowers: {
      label: 'Urn of flowers',
      fields: [F('h', 'Pedestal height'), F('colours', 'Bloom colours (comma list)', 'text')],
      make: { at: [0, 0], h: 0.9 },
      draw(K, p, set) {
        const h = num(p.h, 0.9), [u, v] = p.at, stone = set.palette?.trim || '#c8c0b0', roll = rollOf(u * 23 + v * 19), blooms = listOf(p.colours, ['#f4f0e8', '#e8d070', '#c83a4a']);
        K.lathe(u, v, [[0.22, 0], [0.22, 0.06], [0.12, 0.1], [0.1, h - 0.06], [0.2, h], [0, h]], stone, 1, 16, SATIN);
        K.lathe(u, v, [[0.08, h], [0.2, h + 0.12], [0.26, h + 0.3], [0.24, h + 0.34], [0, h + 0.34]], stone, 1, 16, SATIN);
        for (let i = 0; i < 26; i++) {
          const a = roll() * TAU, r = Math.sqrt(roll()) * 0.38, y = h + 0.38 + roll() * 0.5 - r * 0.4;
          K.ball(u + Math.cos(a) * r, v + Math.sin(a) * r, y, 0.07 + roll() * 0.03, i % 3 ? blooms[i % blooms.length] : '#2f5a30', 1, 6, CLOTH);
        }
      },
    },
    rail: {
      label: 'Communion rail',
      fields: [F('w', 'Width'), F('gap', 'Gap in the middle'), F('yaw', 'Facing (°)')],
      make: { at: [0, 0], yaw: 180, w: 8, gap: 1.4 },
      draw(K, p, set) {
        const w = num(p.w, 8), gap = num(p.gap, 1.4), fr = frameOf(K, p), wood = set.palette?.desk || '#4a3424', top = set.palette?.deskTop || '#6a4a30';
        for (const s of [-1, 1]) {
          const a = s > 0 ? gap / 2 : -w / 2, b = s > 0 ? w / 2 : -gap / 2;
          fr.pbox(a, b, 0.72, 0.8, -0.1, 0.1, top, 1, null, GLOSS);
          fr.pbox(a, b, 0, 0.08, -0.08, 0.08, wood, 1, null, SATIN);
          // the kneeler in front, red cloth
          fr.pbox(a, b, 0, 0.14, 0.22, 0.48, '#6a1a22', 1, null, CLOTH);
          for (let x = a + 0.08; x < b - 0.04; x += 0.18) fr.pbox(x - 0.025, x + 0.025, 0.08, 0.72, -0.025, 0.025, wood, 1, null, SATIN);
          for (const x of [a, b]) fr.pbox(x - 0.06, x + 0.06, 0, 0.9, -0.06, 0.06, wood, 1, null, SATIN);
        }
      },
    },
    pillar: {
      label: 'Stone pillar',
      fields: [F('h', 'Height'), F('r', 'Radius'), F('colour', 'Colour', 'text')],
      make: { at: [0, 0], h: 5, r: 0.28 },
      draw(K, p, set) {
        const h = num(p.h, 5), r = num(p.r, 0.28), [u, v] = p.at, c = p.colour || set.palette?.wall || '#8a8070';
        K.box(u - r - 0.1, u + r + 0.1, v - r - 0.1, v + r + 0.1, 0, 0.3, c, 0.9, null, SATIN);
        K.lathe(u, v, [[r + 0.04, 0.3], [r, 0.4], [r * 0.92, h - 0.5], [r + 0.12, h - 0.25], [r + 0.16, h - 0.2], [0, h - 0.2]], c, 1, 16, SATIN);
        K.box(u - r - 0.2, u + r + 0.2, v - r - 0.2, v + r + 0.2, h - 0.2, h, c, 0.9, null, SATIN);
      },
    },
  };
}
