// GLASS 2 · PIECES FOR A FILM'S STOCK SETS. Rows for set-mesh.js's SET_PIECES, first for the backlot
// a film is shot on when its scene has no set of its own (set_film_*): an office's desk, cabinets and
// blinds, a corridor's doors and strip lights, a stairwell, a bar's back bar and booths, a street's
// fronts, road and bins, a bed, a works floor's machines, pipes, catwalk and furnace, a workbench and a
// pegboard, a brick tunnel, a pool and its loungers, a flag, and a flight of grand steps under columns.
// Each row is a label, its fields and a `draw(K, p, set)` built from the room kit (room-kit.js), in
// metres. Nothing here names a film.
//
// ⚠ A PIECE'S +x IS THE VIEWER'S LEFT when it faces the cameras (yaw 180), and K's points are [u, v, y].

import { MAT } from './ballpark-mesh.js';

const { GLOSS, METAL, SATIN, CLOTH, LEATHER, EMISSIVE } = MAT;
const TAU = Math.PI * 2;

const num = (v, d) => (Number.isFinite(+v) && v !== '' && v != null ? +v : d);
const F = (k, label, type = 'number') => ({ k, label, type });
const facingOf = (yaw) => { const a = (yaw || 0) * Math.PI / 180; return [Math.sin(a), Math.cos(a)]; };
const frameOf = (K, p, yaw = 180) => { const [fu, fv] = facingOf(p.yaw ?? yaw); return K.frame(p.at[0], p.at[1], fu, fv); };
function rollOf(seed) { let s = ((Math.abs(Math.round(seed)) * 9301 + 49297) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function shade(hex, k) {
  const n = parseInt(String(hex).replace('#', ''), 16), c = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return '#' + [c(16), c(8), c(0)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function arc(n, a0, a1, fn) { for (let i = 0; i < n; i++) fn(a0 + (a1 - a0) * i / n, a0 + (a1 - a0) * (i + 1) / n); }

// a cylinder between two room points [u, v, y]
function tube(K, A, B, r, hex, k = 1, n = 8, mat = METAL) {
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(d[0], d[1], d[2]) || 1, dn = d.map((c) => c / L);
  let e1 = Math.abs(dn[2]) > 0.95 ? [1, 0, 0] : [dn[1], -dn[0], 0];
  const l1 = Math.hypot(e1[0], e1[1], e1[2]); e1 = e1.map((c) => c / l1);
  const e2 = [dn[1] * e1[2] - dn[2] * e1[1], dn[2] * e1[0] - dn[0] * e1[2], dn[0] * e1[1] - dn[1] * e1[0]];
  const col = K.C(hex, k), raw = k >= 1.25;
  const at = (P, a) => [P[0] + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * r, P[1] + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * r, P[2] + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * r];
  const nr = (a) => { const c = Math.cos(a), s = Math.sin(a); return K.nrmOf(e1[0] * c + e2[0] * s, e1[2] * c + e2[2] * s, e1[1] * c + e2[1] * s); };
  arc(n, 0, TAU, (a, b) => K.quad(K.solid, [at(A, a), at(B, a), at(B, b), at(A, b)], nr((a + b) / 2), col, mat, null, raw));
}
// a tube between two points in a piece's frame
const ftube = (K, fr, a, b, r, hex, k = 1, n = 8, mat = METAL) => tube(K, fr.P(...a), fr.P(...b), r, hex, k, n, mat);
// a wheel standing in the frame's x/y plane (it turns round the frame's z): a rim of tubes and its spokes
function wheelZ(K, fr, cx, cy, cz, R, r, hex, spokes = 6, k = 1) {
  const pt = (a, rad) => [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, cz];
  arc(24, 0, TAU, (a, b) => ftube(K, fr, pt(a, R), pt(b, R), r, hex, k, 6));
  for (let i = 0; i < spokes; i++) { const a = i / spokes * TAU; ftube(K, fr, pt(a, r * 1.6), pt(a, R), r * 0.45, hex, k, 5); }
  ftube(K, fr, [cx, cy, cz - r * 2.2], [cx, cy, cz + r * 2.2], r * 1.7, shade(hex, 0.8), k, 10);
}
// a lit pane on a frame's face, glowing
const glow = (K, fr, x0, x1, y0, y1, z, hex, k = 1.7) => fr.front(K.solid, x0, x1, y0, y1, z, K.C(hex, k), EMISSIVE);

export function filmPieces() {
  return {
    // ── an office ──
    office_desk: {
      label: 'Office desk (blotter, lamp, phone, papers)',
      fields: [F('w', 'Width'), F('depth', 'Depth'), F('yaw', 'Facing (°)'), F('lamp', 'Desk lamp (1)'), F('mess', 'Papers (0 to 1)'), F('colour', 'Wood', 'text')],
      make: { at: [0, 0], yaw: 180, w: 1.6, depth: 0.8, lamp: 1, mess: 0.6 },
      draw(K, p, set) {
        const w = num(p.w, 1.6), dp = num(p.depth, 0.8), h = 0.76, fr = frameOf(K, p), wood = p.colour || set.palette?.desk || '#5a3e26', top = shade(wood, 1.12);
        const roll = rollOf(p.at[0] * 31 + p.at[1] * 17 + w * 7);
        fr.pbox(-w / 2, w / 2, h - 0.04, h, -dp / 2, dp / 2, top, 1, null, SATIN);
        // a pedestal of drawers on each side and a modesty panel facing whoever sits across it
        for (const sx of [-1, 1]) {
          const x0 = sx > 0 ? w / 2 - 0.44 : -w / 2, x1 = x0 + 0.44;
          fr.pbox(x0, x1, 0, h - 0.04, -dp / 2 + 0.02, dp / 2 - 0.02, wood, 1, null, SATIN);
          for (let i = 0; i < 3; i++) {
            const y0 = 0.06 + i * 0.22;
            fr.pbox(x0 + 0.03, x1 - 0.03, y0, y0 + 0.19, -dp / 2 - 0.004, -dp / 2 + 0.02, shade(wood, 1.06), 1, null, SATIN);
            fr.pbox(-0.04 + (x0 + x1) / 2, 0.04 + (x0 + x1) / 2, y0 + 0.12, y0 + 0.14, -dp / 2 - 0.02, -dp / 2, '#b8a070', 1, null, METAL);
          }
        }
        fr.pbox(-w / 2 + 0.44, w / 2 - 0.44, 0.25, h - 0.04, dp / 2 - 0.06, dp / 2 - 0.03, wood, 0.92, null, SATIN);
        // the blotter, a phone, a mug, a stack of files and loose sheets
        fr.pbox(-0.34, 0.34, h, h + 0.006, -0.28, 0.06, '#2a3a2a', 1, null, LEATHER);
        fr.pbox(w / 2 - 0.42, w / 2 - 0.18, h, h + 0.07, -0.18, 0.04, '#1a1a1c', 1, null, GLOSS);
        fr.pbox(w / 2 - 0.4, w / 2 - 0.2, h + 0.07, h + 0.1, -0.16, -0.1, '#222224', 1, null, GLOSS);
        const [mu, mv] = fr.P(-w / 2 + 0.55, 0, -0.2);
        K.lathe(mu, mv, [[0.04, h], [0.042, h + 0.1], [0.036, h + 0.1], [0, h + 0.08]], '#e8e0d0', 1, 12, GLOSS);
        const mess = Math.max(0, Math.min(1, num(p.mess, 0.6)));
        for (let i = 0; i < Math.round(mess * 6); i++) {
          const x = (roll() - 0.5) * (w - 0.6), z = (roll() - 0.5) * dp * 0.6, y = h + 0.006 + i * 0.012;
          fr.pbox(x - 0.11, x + 0.11, y, y + 0.006, z - 0.15, z + 0.15, i % 3 ? '#e8e4d8' : '#c8a868', 1, null, CLOTH);
        }
        if (+(p.lamp ?? 1)) {
          // a banker's lamp: a brass stem and a green shade, lit
          const [lu, lv] = fr.P(-w / 2 + 0.25, 0, 0.12);
          K.lathe(lu, lv, [[0.08, h], [0.08, h + 0.02], [0.012, h + 0.03], [0.012, h + 0.36], [0, h + 0.36]], '#b8943c', 1, 12, METAL);
          ftube(K, fr, [-w / 2 + 0.12, h + 0.38, 0.12], [-w / 2 + 0.42, h + 0.38, 0.12], 0.06, '#1e5a34', 1, 10, GLOSS);
          ftube(K, fr, [-w / 2 + 0.14, h + 0.33, 0.12], [-w / 2 + 0.4, h + 0.33, 0.12], 0.02, '#ffe0a0', 2.4, 8, EMISSIVE);
        }
      },
    },
    filing_cabinet: {
      label: 'Filing cabinets (steel, four drawers)',
      fields: [F('n', 'How many side by side'), F('drawers', 'Drawers each'), F('yaw', 'Facing (°)'), F('open', 'One drawer left open (1)'), F('colour', 'Colour', 'text')],
      make: { at: [0, 0], yaw: 180, n: 2, drawers: 4, open: 1 },
      draw(K, p) {
        const n = Math.max(1, Math.min(8, num(p.n, 2) | 0)), dr = Math.max(2, Math.min(5, num(p.drawers, 4) | 0)), fr = frameOf(K, p), c = p.colour || '#6a7068';
        const cw = 0.47, H = 0.33 * dr + 0.04, x0 = -n * cw / 2;
        for (let i = 0; i < n; i++) {
          const a = x0 + i * cw, b = a + cw - 0.01;
          fr.pbox(a, b, 0, H, -0.6, 0, c, 1, null, METAL);
          for (let j = 0; j < dr; j++) {
            const y0 = 0.04 + j * 0.33, out = +p.open && i === n - 1 && j === dr - 2 ? 0.34 : 0;
            fr.pbox(a + 0.02, b - 0.02, y0, y0 + 0.3, -0.02 + out, 0.01 + out, shade(c, 1.08), 1, null, METAL);
            fr.pbox((a + b) / 2 - 0.07, (a + b) / 2 + 0.07, y0 + 0.2, y0 + 0.23, 0.01 + out, 0.03 + out, '#c8ccd0', 1, null, METAL);
            fr.pbox((a + b) / 2 - 0.05, (a + b) / 2 + 0.05, y0 + 0.24, y0 + 0.27, 0.01 + out, 0.012 + out, '#e8e4d8', 1, null, CLOTH);
            if (out) for (let f = 0; f < 6; f++) fr.pbox(a + 0.05, b - 0.05, y0 + 0.05, y0 + 0.27 - (f % 2) * 0.03, -0.3 + f * 0.05 + out, -0.29 + f * 0.05 + out, f % 2 ? '#c8a868' : '#e0d8c4', 1, null, CLOTH);
          }
        }
      },
    },
    blinds_window: {
      label: 'Window with venetian blinds (bars of light)',
      fields: [F('w', 'Width'), F('h', 'Height'), F('y', 'Sill height'), F('yaw', 'Facing (°)'), F('shut', 'Slats shut (0 to 1)'), F('colour', 'Light outside', 'text')],
      make: { at: [0, 0], yaw: 180, w: 1.6, h: 1.5, y: 0.9, shut: 0.35 },
      draw(K, p, set) {
        const w = num(p.w, 1.6), h = num(p.h, 1.5), y = num(p.y, 0.9), fr = frameOf(K, p), trim = set.palette?.trim || '#2a241e', out = p.colour || set.palette?.outside || '#e8d8a8';
        glow(K, fr, -w / 2, w / 2, y, y + h, -0.05, out, 1.5);
        for (const [a, b, c, d] of [[-w / 2 - 0.07, -w / 2, y - 0.05, y + h + 0.07], [w / 2, w / 2 + 0.07, y - 0.05, y + h + 0.07], [-w / 2 - 0.07, w / 2 + 0.07, y + h, y + h + 0.07]]) fr.pbox(a, b, c, d, -0.08, 0.05, trim, 1, null, SATIN);
        fr.pbox(-w / 2 - 0.1, w / 2 + 0.1, y - 0.06, y, -0.08, 0.12, trim, 1, null, SATIN);
        // the slats: tipped part shut, so the light comes through in bars
        const n = Math.round(h / 0.06), shut = Math.max(0, Math.min(1, num(p.shut, 0.35))), t = 0.012 + shut * 0.03;
        for (let i = 0; i < n; i++) { const yy = y + h - (i + 0.5) * h / n; fr.pbox(-w / 2 + 0.01, w / 2 - 0.01, yy - t / 2, yy + t / 2, -0.01, 0.02 + shut * 0.015, '#d8d0bc', 1, null, SATIN); }
        fr.pbox(-w / 2, w / 2, y + h - 0.06, y + h, -0.02, 0.05, '#c8c0aa', 1, null, SATIN);
        for (const x of [-w / 3, w / 3]) ftube(K, fr, [x, y + 0.02, 0.03], [x, y + h - 0.04, 0.03], 0.003, '#c8c0a8', 1, 4, CLOTH);
      },
    },
    // ── a corridor and a stairwell ──
    door_row: {
      label: 'Wall with a row of doors (a corridor)',
      fields: [F('w', 'Length'), F('h', 'Height'), F('doors', 'Doors'), F('yaw', 'Facing (°)'), F('dado', 'Dado rail and lower paint (1)'), F('colour', 'Wall colour', 'text'), F('door', 'Door colour', 'text')],
      make: { at: [0, 0], yaw: 90, w: 10, h: 2.8, doors: 3, dado: 1 },
      draw(K, p, set) {
        const w = num(p.w, 10), h = num(p.h, 2.8), n = Math.max(0, Math.min(10, num(p.doors, 3) | 0)), fr = frameOf(K, p, 90);
        const c = p.colour || set.palette?.wall || '#8a8a78', low = shade(c, 0.72), dc = p.door || set.palette?.door || '#4a5a5a', trim = set.palette?.trim || '#3a3a34';
        const at = Array.from({ length: n }, (_, i) => -w / 2 + (i + 0.5) * w / n), dw = 0.92;
        let x = -w / 2;
        for (const cx of at) {
          const a = cx - dw / 2, b = cx + dw / 2;
          if (a > x) { fr.pbox(x, a, 0, h, -0.08, 0, c, 1, null, SATIN); if (+(p.dado ?? 1)) fr.pbox(x, a, 0, 1, -0.08, 0.004, low, 1, null, SATIN); }
          fr.pbox(a, b, 2.1, h, -0.08, 0, c, 1, null, SATIN);
          fr.pbox(a, b, 0, 2.1, -0.12, -0.08, dc, 1, null, SATIN);
          // the frame, a kick plate, a handle and a little number plate
          for (const [x0, x1, y0, y1] of [[a - 0.06, a, 0, 2.16], [b, b + 0.06, 0, 2.16], [a - 0.06, b + 0.06, 2.1, 2.16]]) fr.pbox(x0, x1, y0, y1, -0.1, 0.02, trim, 1, null, SATIN);
          fr.pbox(a + 0.05, b - 0.05, 0.02, 0.25, -0.08, -0.07, '#9a9c9a', 1, null, METAL);
          fr.pbox(b - 0.14, b - 0.06, 0.98, 1.02, -0.08, -0.04, '#c8c0a0', 1, null, METAL);
          fr.pbox(cx - 0.08, cx + 0.08, 1.62, 1.72, -0.08, -0.07, '#e0dccc', 1, null, METAL);
          x = b;
        }
        if (x < w / 2) { fr.pbox(x, w / 2, 0, h, -0.08, 0, c, 1, null, SATIN); if (+(p.dado ?? 1)) fr.pbox(x, w / 2, 0, 1, -0.08, 0.004, low, 1, null, SATIN); }
        if (+(p.dado ?? 1)) fr.pbox(-w / 2, w / 2, 0.98, 1.03, 0, 0.025, trim, 1, null, SATIN);
        fr.pbox(-w / 2, w / 2, 0, 0.1, 0, 0.02, trim, 1, null, SATIN);
      },
    },
    strip_light: {
      label: 'Strip lights down a ceiling',
      fields: [F('n', 'Fittings'), F('depth', 'Spread along'), F('y', 'Ceiling height'), F('yaw', 'Running (°)'), F('dead', 'Which one is dead (0 for none)')],
      make: { at: [0, 4], n: 4, depth: 10, y: 2.8, yaw: 0, dead: 3 },
      draw(K, p) {
        const n = Math.max(1, Math.min(12, num(p.n, 4) | 0)), d = num(p.depth, 10), y = num(p.y, 2.8), fr = frameOf(K, p, 0), dead = num(p.dead, 0) | 0;
        for (let i = 0; i < n; i++) {
          const z = n === 1 ? 0 : -d / 2 + i * d / (n - 1);
          fr.pbox(-0.16, 0.16, y - 0.07, y, z - 0.62, z + 0.62, '#d8d8d0', 1, null, METAL);
          for (const x of [-0.07, 0.07]) ftube(K, fr, [x, y - 0.09, z - 0.58], [x, y - 0.09, z + 0.58], 0.016, i + 1 === dead ? '#8a8c88' : '#f4f8ff', i + 1 === dead ? 1 : 2.6, 6, i + 1 === dead ? GLOSS : EMISSIVE);
        }
      },
    },
    stair_flight: {
      label: 'Flight of stairs with a rail and a landing',
      fields: [F('w', 'Width'), F('n', 'Steps'), F('landing', 'Landing depth'), F('yaw', 'Facing (°)'), F('rail', 'Rail on which side (1, -1, 0 for none)'), F('colour', 'Step colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 1.3, n: 9, landing: 1.3, rail: 1 },
      draw(K, p, set) {
        // it climbs away from its front: the first step at z 0, rising toward -z
        const w = num(p.w, 1.3), n = Math.max(2, Math.min(18, num(p.n, 9) | 0)), L = num(p.landing, 1.3), fr = frameOf(K, p), rise = 0.18, run = 0.27;
        const c = p.colour || set.palette?.trim || '#5a5a56', nose = shade(c, 1.25), steel = '#2a2c2e';
        for (let i = 0; i < n; i++) {
          fr.pbox(-w / 2, w / 2, 0, rise * (i + 1), -run * (i + 1), -run * i, c, 1, null, SATIN);
          fr.pbox(-w / 2, w / 2, rise * (i + 1) - 0.01, rise * (i + 1) + 0.006, -run * i - 0.05, -run * i + 0.01, nose, 1, null, METAL);
        }
        fr.pbox(-w / 2, w / 2, 0, rise * n, -run * n - L, -run * n, c, 0.95, null, SATIN);
        const side = num(p.rail, 1);
        if (side) {
          const x = side * (w / 2 - 0.04), top = 0.9;
          for (let i = 0; i <= n; i += 2) ftube(K, fr, [x, rise * i, -run * i - 0.12], [x, rise * i + top, -run * i - 0.12], 0.014, steel);
          ftube(K, fr, [x, top, 0.1], [x, rise * n + top, -run * n], 0.025, steel, 1, 8);
          ftube(K, fr, [x, rise * n + top, -run * n], [x, rise * n + top, -run * n - L], 0.025, steel, 1, 8);
          ftube(K, fr, [x, rise * n, -run * n - L], [x, rise * n + top, -run * n - L], 0.014, steel);
        }
      },
    },
    // ── a bar ──
    back_bar: {
      label: 'Back bar: mirror, shelves of bottles, a till',
      fields: [F('w', 'Width'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('seed', 'Seed'), F('colour', 'Wood', 'text')],
      make: { at: [0, 0], yaw: 180, w: 4, h: 2.6, seed: 1 },
      draw(K, p, set) {
        const w = num(p.w, 4), h = num(p.h, 2.6), fr = frameOf(K, p), wood = p.colour || set.palette?.desk || '#4a2e1c', roll = rollOf(num(p.seed, 1) * 101);
        fr.pbox(-w / 2, w / 2, 0, 0.95, -0.55, -0.05, wood, 1, null, SATIN);
        fr.pbox(-w / 2 - 0.02, w / 2 + 0.02, 0.95, 0.99, -0.58, -0.02, shade(wood, 1.2), 1, null, GLOSS);
        fr.pbox(-w / 2, w / 2, 0.99, h, -0.6, -0.55, wood, 0.85, null, SATIN);
        // the mirror behind the bottles, catching the room
        fr.pbox(-w / 2 + 0.15, w / 2 - 0.15, 1.15, h - 0.3, -0.55, -0.545, '#8a96a0', 1.05, null, GLOSS);
        for (const sx of [-1, 1]) fr.pbox(sx * w / 2 - 0.08, sx * w / 2 + 0.08, 0.99, h, -0.6, -0.4, shade(wood, 1.1), 1, null, SATIN);
        fr.pbox(-w / 2 - 0.1, w / 2 + 0.1, h - 0.16, h, -0.62, -0.32, shade(wood, 1.1), 1, null, SATIN);
        const glassC = ['#2a6a3a', '#8a5a20', '#c8b070', '#5a1a1a', '#d8d8d0', '#2a3a6a', '#a06a2a'];
        for (const [y, z] of [[0.99, -0.42], [1.5, -0.47], [1.98, -0.47]]) {
          if (y > 1) fr.pbox(-w / 2 + 0.15, w / 2 - 0.15, y - 0.02, y, -0.55, -0.38, '#c8ccd0', 1, null, GLOSS);
          for (let x = -w / 2 + 0.25; x < w / 2 - 0.25; x += 0.09 + roll() * 0.07) {
            if (roll() < 0.12) continue;
            const [u, v] = fr.P(x, 0, z), tall = 0.22 + roll() * 0.12, col = glassC[(roll() * glassC.length) | 0];
            K.lathe(u, v, [[0.035, y], [0.036, y + tall * 0.65], [0.012, y + tall * 0.8], [0.011, y + tall], [0, y + tall]], col, 1.05, 8, GLOSS);
          }
        }
        // a till at one end and a row of upturned glasses at the other
        fr.pbox(w / 2 - 0.7, w / 2 - 0.25, 0.99, 1.2, -0.45, -0.12, '#3a3a3c', 1, null, METAL);
        fr.pbox(w / 2 - 0.66, w / 2 - 0.29, 1.2, 1.32, -0.4, -0.3, '#2a2a2c', 1, null, METAL);
        glow(K, fr, w / 2 - 0.6, w / 2 - 0.35, 1.24, 1.3, -0.299, '#80ff90', 1.6);
        for (let i = 0; i < 6; i++) { const [u, v] = fr.P(-w / 2 + 0.35 + i * 0.12, 0, -0.2); K.lathe(u, v, [[0.035, 0.99], [0.04, 1.1], [0, 1.1]], '#c8d8e0', 1.1, 8, GLOSS); }
      },
    },
    beer_taps: {
      label: 'Beer taps (stand them on a counter)',
      fields: [F('n', 'Taps'), F('y', 'Counter height'), F('yaw', 'Facing (°)')],
      make: { at: [0, 0], yaw: 180, n: 4, y: 0.92 },
      draw(K, p) {
        const n = Math.max(1, Math.min(8, num(p.n, 4) | 0)), y = num(p.y, 0.92), fr = frameOf(K, p), cols = ['#c83a2a', '#e8c040', '#2a5aa8', '#3a8a3a', '#e8e8e0'];
        fr.pbox(-n * 0.09, n * 0.09, y, y + 0.02, -0.08, 0.08, '#8a8c90', 1, null, METAL);
        for (let i = 0; i < n; i++) {
          const x = -n * 0.09 + 0.09 + i * 0.18;
          ftube(K, fr, [x, y, 0], [x, y + 0.28, 0], 0.018, '#c8ccd0', 1, 8);
          ftube(K, fr, [x, y + 0.26, 0], [x, y + 0.26, 0.09], 0.012, '#c8ccd0', 1, 6);
          fr.pbox(x - 0.022, x + 0.022, y + 0.3, y + 0.46, -0.01, 0.03, cols[i % cols.length], 1, null, GLOSS);
        }
      },
    },
    booth: {
      label: 'Booth: two high-backed benches and a table',
      fields: [F('w', 'Width'), F('yaw', 'Facing (°)'), F('colour', 'Upholstery', 'text')],
      make: { at: [0, 0], yaw: 90, w: 1.3, colour: '#7a2a24' },
      draw(K, p, set) {
        // the table's long side runs across the frame's z, the benches either side of it in z
        const w = num(p.w, 1.3), fr = frameOf(K, p, 90), up = p.colour || '#7a2a24', wood = set.palette?.desk || '#4a2e1c';
        for (const sz of [-1, 1]) {
          const z0 = sz * 0.55, z1 = sz * 1.05, zb = sz * 1.05;
          fr.pbox(-w / 2, w / 2, 0, 0.42, Math.min(z0, z1), Math.max(z0, z1), wood, 1, null, SATIN);
          fr.pbox(-w / 2 + 0.03, w / 2 - 0.03, 0.42, 0.5, Math.min(z0, z1) + 0.02, Math.max(z0, z1) - 0.02, up, 1, null, LEATHER);
          fr.pbox(-w / 2, w / 2, 0, 1.25, Math.min(zb, zb + sz * 0.12), Math.max(zb, zb + sz * 0.12), wood, 1, null, SATIN);
          fr.pbox(-w / 2 + 0.04, w / 2 - 0.04, 0.5, 1.15, Math.min(zb - sz * 0.08, zb), Math.max(zb - sz * 0.08, zb), up, 1.04, null, LEATHER);
        }
        fr.pbox(-w / 2 + 0.05, w / 2 - 0.05, 0.72, 0.76, -0.4, 0.4, shade(wood, 1.2), 1, null, GLOSS);
        ftube(K, fr, [0, 0, 0], [0, 0.72, 0], 0.05, '#2a2a2c');
        const [u, v] = fr.P(0, 0, 0);
        K.lathe(u, v, [[0.24, 0], [0.24, 0.02], [0, 0.03]], '#2a2a2c', 1, 14, METAL);
      },
    },
    // ── a street ──
    facade: {
      label: 'Building front (storeys of windows, a shop or a door)',
      fields: [F('w', 'Width'), F('floors', 'Storeys'), F('yaw', 'Facing (°)'), F('shop', 'Shopfront at street level (1)'), F('lit', 'Share of windows lit (0 to 1)'), F('escape', 'Fire escape on which side (1, -1, 0)'), F('seed', 'Seed'), F('colour', 'Brick', 'text'), F('glow', 'Window light', 'text')],
      make: { at: [0, 0], yaw: 180, w: 6, floors: 3, shop: 1, lit: 0.4, escape: 0, seed: 1, colour: '#6a3a2c' },
      draw(K, p, set) {
        const w = num(p.w, 6), fl = Math.max(1, Math.min(8, num(p.floors, 3) | 0)), fh = 3, H = fl * fh + 0.6, fr = frameOf(K, p), roll = rollOf(num(p.seed, 1) * 977 + w * 13);
        const brick = p.colour || '#6a3a2c', trim = shade(brick, 0.6), sill = '#9a9488', light = p.glow || '#ffc870', lit = num(p.lit, 0.4);
        fr.pbox(-w / 2, w / 2, 0, H, -0.4, 0, brick, 1, null, SATIN);
        // courses of brick, picked out darker every so often, and a cornice on top
        for (let y = 0.5; y < H - 0.5; y += 0.5) if (roll() < 0.5) fr.pbox(-w / 2, w / 2, y, y + 0.03, 0, 0.004, shade(brick, 0.85), 1, null, SATIN);
        fr.pbox(-w / 2 - 0.08, w / 2 + 0.08, H - 0.3, H, -0.4, 0.18, trim, 1, null, SATIN);
        fr.pbox(-w / 2 - 0.04, w / 2 + 0.04, fh - 0.12, fh, -0.4, 0.08, trim, 1, null, SATIN);
        const per = Math.max(1, Math.floor(w / 1.6));
        for (let f = +(+(p.shop ?? 1) ? 1 : 0); f < fl; f++) for (let i = 0; i < per; i++) {
          const cx = -w / 2 + (i + 0.5) * w / per, y0 = f * fh + 0.9;
          if (f === 0 && i === Math.floor(per / 2)) {
            // the street door
            fr.pbox(cx - 0.5, cx + 0.5, 0, 2.2, -0.2, 0.004, '#1c1a18', 1, null, SATIN);
            fr.pbox(cx - 0.45, cx + 0.45, 0, 2.15, 0.004, 0.02, '#3a2a1e', 1, null, SATIN);
            glow(K, fr, cx - 0.3, cx + 0.3, 1.75, 2.05, 0.021, light, 1.4);
            continue;
          }
          const on = roll() < lit;
          fr.pbox(cx - 0.5, cx + 0.5, y0, y0 + 1.4, -0.2, 0.004, '#0c0e12', 1, null, GLOSS);
          if (on) glow(K, fr, cx - 0.46, cx + 0.46, y0 + 0.04, y0 + 1.36, 0.006, roll() < 0.3 ? '#a8c8ff' : light, 1.3 + roll() * 0.6);
          fr.pbox(cx - 0.02, cx + 0.02, y0, y0 + 1.4, 0.004, 0.03, trim, 1, null, SATIN);
          fr.pbox(cx - 0.5, cx + 0.5, y0 + 0.86, y0 + 0.9, 0.004, 0.03, trim, 1, null, SATIN);
          fr.pbox(cx - 0.58, cx + 0.58, y0 - 0.08, y0, 0, 0.1, sill, 1, null, SATIN);
          if (on && roll() < 0.4) fr.pbox(cx - 0.46, cx - 0.1, y0 + 0.04, y0 + 1.36, 0.008, 0.012, '#8a5a3a', 1.05, null, CLOTH);
        }
        if (+(p.shop ?? 1)) {
          // a shopfront: a wide lit window, a door to one side and a striped awning over both
          const sx = -w / 2 + 0.4, ex = w / 2 - 1.5;
          fr.pbox(sx, ex, 0, 0.5, 0, 0.05, trim, 1, null, SATIN);
          fr.pbox(sx, ex, 0.5, 2.5, -0.15, 0.004, '#0c0e12', 1, null, GLOSS);
          glow(K, fr, sx + 0.05, ex - 0.05, 0.55, 2.45, 0.006, light, 1.5);
          for (let x = sx; x <= ex; x += (ex - sx) / 3) fr.pbox(x - 0.03, x + 0.03, 0.5, 2.5, 0, 0.04, trim, 1, null, SATIN);
          fr.pbox(ex + 0.2, ex + 1.1, 0, 2.3, -0.2, 0.004, '#1c1a18', 1, null, SATIN);
          glow(K, fr, ex + 0.3, ex + 1.0, 1.1, 2.2, 0.006, light, 1.2);
          fr.pbox(-w / 2, w / 2, 2.55, 2.85, 0, 0.06, trim, 1, null, SATIN);
          const stripes = Math.max(4, Math.round(w / 0.4)), A = p.awning || '#2a5a4a';
          for (let i = 0; i < stripes; i++) {
            const x0 = -w / 2 + i * w / stripes, x1 = x0 + w / stripes;
            K.quad(K.solid, [fr.P(x0, 2.9, 0.05), fr.P(x1, 2.9, 0.05), fr.P(x1, 2.45, 1.1), fr.P(x0, 2.45, 1.1)], fr.N(0, 0.92, 0.4), K.C(i % 2 ? '#d8d0c0' : A, 1), CLOTH);
          }
        }
        const es = num(p.escape, 0);
        if (es && fl > 1) {
          // a fire escape: a platform at each storey, a rail, and a ladder between
          const x0 = es > 0 ? w / 2 - 2.4 : -w / 2 + 0.4, x1 = x0 + 2, steel = '#1e2022';
          for (let f = 1; f < fl; f++) {
            const y = f * fh + 0.85;
            fr.pbox(x0, x1, y - 0.04, y, 0, 0.9, steel, 1, null, METAL);
            ftube(K, fr, [x0, y + 0.9, 0.9], [x1, y + 0.9, 0.9], 0.015, steel);
            for (let x = x0; x <= x1 + 1e-3; x += 0.5) ftube(K, fr, [x, y, 0.9], [x, y + 0.9, 0.9], 0.01, steel, 1, 5);
            ftube(K, fr, [x0, y + 0.9, 0], [x0, y + 0.9, 0.9], 0.015, steel);
            ftube(K, fr, [x1, y + 0.9, 0], [x1, y + 0.9, 0.9], 0.015, steel);
            const [a, b] = f % 2 ? [x0 + 0.2, x1 - 0.3] : [x1 - 0.2, x0 + 0.3];
            ftube(K, fr, [a, y, 0.35], [b, y - fh, 0.35], 0.02, steel);
            ftube(K, fr, [a, y, 0.75], [b, y - fh, 0.75], 0.02, steel);
          }
        }
      },
    },
    street: {
      label: 'Street: wet road, kerbs and pavements',
      fields: [F('w', 'Road width'), F('depth', 'Length'), F('walk', 'Pavement width'), F('yaw', 'Running (°)'), F('wet', 'Puddles (0 to 1)'), F('line', 'Centre line (1)'), F('colour', 'Road', 'text')],
      make: { at: [0, 4], yaw: 90, w: 5, depth: 14, walk: 1.6, wet: 0.6, line: 1 },
      draw(K, p) {
        // the road runs along the frame's z; yaw 90 runs it across the picture
        const w = num(p.w, 5), d = num(p.depth, 14), wk = num(p.walk, 1.6), fr = frameOf(K, p, 90), road = p.colour || '#24262a', roll = rollOf(p.at[0] * 7 + p.at[1] * 19 + d);
        fr.pbox(-w / 2, w / 2, 0, 0.006, -d / 2, d / 2, road, 1, null, GLOSS);
        for (const s of [-1, 1]) if (wk > 0) {
          const a = s * w / 2, b = s * (w / 2 + wk);
          fr.pbox(Math.min(a, b), Math.max(a, b), 0, 0.14, -d / 2, d / 2, '#6a6a66', 1, null, SATIN);
          fr.pbox(Math.min(a, a + s * 0.18), Math.max(a, a + s * 0.18), 0, 0.145, -d / 2, d / 2, '#8a8a84', 1, null, SATIN);
          for (let z = -d / 2 + 0.9; z < d / 2; z += 0.9) fr.pbox(Math.min(a, b), Math.max(a, b), 0.14, 0.142, z - 0.01, z + 0.01, '#4a4a46', 1, null, SATIN);
        }
        if (+(p.line ?? 1)) for (let z = -d / 2 + 0.5; z < d / 2 - 0.5; z += 2) fr.pbox(-0.06, 0.06, 0.006, 0.01, z, z + 1.1, '#d8c870', 1, null, SATIN);
        const wet = Math.max(0, Math.min(1, num(p.wet, 0.6)));
        for (let i = 0; i < Math.round(wet * 8); i++) {
          const x = (roll() - 0.5) * (w - 0.8), z = (roll() - 0.5) * (d - 1), rx = 0.3 + roll() * 0.7, rz = 0.4 + roll() * 1.1;
          fr.pbox(x - rx, x + rx, 0.006, 0.009, z - rz, z + rz, '#4a5262', 1.15, null, GLOSS);
        }
        // a drain grate at each kerb
        for (const s of [-1, 1]) fr.pbox(s * (w / 2 - 0.45) - 0.25, s * (w / 2 - 0.45) + 0.25, 0.006, 0.012, -d / 4 - 0.18, -d / 4 + 0.18, '#141416', 1, null, METAL);
      },
    },
    street_lamp: {
      label: 'Street lamp (a city one, on a swan neck)',
      fields: [F('h', 'Height'), F('yaw', 'Facing (°)'), F('dead', 'Out (1)')],
      make: { at: [0, 0], yaw: 180, h: 4.6, dead: 0 },
      draw(K, p) {
        const h = num(p.h, 4.6), fr = frameOf(K, p), steel = '#2a2c30', out = +p.dead;
        const [u, v] = p.at;
        K.lathe(u, v, [[0.16, 0], [0.16, 0.5], [0.08, 0.62], [0.06, h], [0, h]], steel, 1, 12, METAL);
        const pts = [[0, h, 0], [0, h + 0.3, 0.2], [0, h + 0.36, 0.6], [0, h + 0.3, 1]];
        for (let i = 0; i + 1 < pts.length; i++) ftube(K, fr, pts[i], pts[i + 1], 0.05, steel);
        fr.pbox(-0.2, 0.2, h + 0.12, h + 0.3, 0.8, 1.3, steel, 1, null, METAL);
        fr.pbox(-0.16, 0.16, h + 0.08, h + 0.12, 0.84, 1.26, out ? '#6a6a60' : '#ffe0a0', out ? 1 : 2.8, null, out ? GLOSS : EMISSIVE);
        // the pool of light it throws on the ground
        if (!out) { const [gu, gv] = fr.P(0, 0, 1.05); K.quad(K.solid, [[gu - 1.1, gv - 1.1, 0.012], [gu + 1.1, gv - 1.1, 0.012], [gu + 1.1, gv + 1.1, 0.012], [gu - 1.1, gv + 1.1, 0.012]], K.nrmOf(0, 1, 0), K.C('#5a4a30', 1.25), EMISSIVE, null, true); }
      },
    },
    dumpster: {
      label: 'Dumpster (lid half up, bags round it)',
      fields: [F('yaw', 'Facing (°)'), F('colour', 'Colour', 'text')],
      make: { at: [0, 0], yaw: 180, colour: '#2a4a3a' },
      draw(K, p) {
        const fr = frameOf(K, p), c = p.colour || '#2a4a3a', roll = rollOf(p.at[0] * 41 + p.at[1] * 23);
        fr.pbox(-0.95, 0.95, 0.12, 1.2, -0.55, 0.5, c, 1, null, METAL);
        fr.pbox(-1, 1, 1.12, 1.2, -0.6, 0.56, shade(c, 0.85), 1, null, METAL);
        for (const x of [-0.6, 0.6]) fr.pbox(x - 0.1, x + 0.1, 0.4, 0.9, 0.5, 0.56, shade(c, 1.15), 1, null, METAL);
        for (const x of [-0.8, 0.8]) for (const z of [-0.4, 0.35]) { const [u, v] = fr.P(x, 0, z); K.ball(u, v, 0.06, 0.06, '#1a1a1a', 1, 8); }
        // the lid propped open on the bags inside
        K.quad(K.solid, [fr.P(-0.98, 1.2, -0.58), fr.P(0.98, 1.2, -0.58), fr.P(0.98, 1.75, -0.2), fr.P(-0.98, 1.75, -0.2)], fr.N(0, 0.6, 0.8), K.C('#1a1a1c', 1), GLOSS);
        for (let i = 0; i < 4; i++) { const [u, v] = fr.P((roll() - 0.5) * 2.4, 0, 0.7 + roll() * 0.4); K.ball(u, v, 0.22, 0.24 + roll() * 0.08, i % 2 ? '#141416' : '#2a2a24', 1, 9, GLOSS); }
      },
    },
    drums: {
      label: 'Oil drums (one can burn)',
      fields: [F('n', 'How many'), F('seed', 'Seed'), F('fire', 'The first one burning (1)'), F('colour', 'Colour', 'text')],
      make: { at: [0, 0], n: 3, seed: 1, fire: 0, colour: '#4a3a2a' },
      draw(K, p) {
        const n = Math.max(1, Math.min(10, num(p.n, 3) | 0)), roll = rollOf(num(p.seed, 1) * 59 + 3), cols = [p.colour || '#4a3a2a', '#2a4a6a', '#8a2a1e', '#5a5a52'];
        for (let i = 0; i < n; i++) {
          const a = i * 2.4 + roll(), r = i ? 0.55 + roll() * 0.25 : 0, u = p.at[0] + Math.cos(a) * r, v = p.at[1] + Math.sin(a) * r, c = cols[(i + (roll() * 2 | 0)) % cols.length];
          K.lathe(u, v, [[0.28, 0], [0.29, 0.02], [0.29, 0.3], [0.3, 0.31], [0.29, 0.32], [0.29, 0.58], [0.3, 0.59], [0.29, 0.6], [0.29, 0.88], [0.27, 0.89], [0, 0.89]], c, 1, 16, METAL);
          if (i === 0 && +p.fire) {
            for (let f = 0; f < 5; f++) { const fa = f * 1.3, fr = 0.1 + (f % 2) * 0.06; K.ball(u + Math.cos(fa) * fr, v + Math.sin(fa) * fr, 0.98 + (f % 3) * 0.1, 0.12 - f * 0.012, f % 2 ? '#ffb040' : '#ff6a20', 2.6, 8, EMISSIVE); }
            K.quad(K.solid, [[u - 1.4, v - 1.4, 0.01], [u + 1.4, v - 1.4, 0.01], [u + 1.4, v + 1.4, 0.01], [u - 1.4, v + 1.4, 0.01]], K.nrmOf(0, 1, 0), K.C('#5a3018', 1.25), EMISSIVE, null, true);
          }
        }
      },
    },
    crates: {
      label: 'Stacked crates',
      fields: [F('n', 'How many'), F('seed', 'Seed'), F('yaw', 'Facing (°)'), F('colour', 'Wood', 'text')],
      make: { at: [0, 0], n: 4, seed: 1, yaw: 180, colour: '#8a6a40' },
      draw(K, p) {
        const n = Math.max(1, Math.min(10, num(p.n, 4) | 0)), fr = frameOf(K, p), roll = rollOf(num(p.seed, 1) * 71), c = p.colour || '#8a6a40';
        const at = [[0, 0, 0], [0.62, 0, 0.05], [0.3, 0.6, 0.02], [-0.62, 0, -0.08], [-0.3, 0.6, -0.04], [0.05, 1.2, 0.03], [1.24, 0, -0.1], [-1.24, 0, 0.08], [0.92, 0.6, 0], [-0.92, 0.6, -0.06]];
        for (let i = 0; i < n; i++) {
          const [x, y, z] = at[i], s = 0.29, k = 0.85 + roll() * 0.3, cc = shade(c, k);
          fr.pbox(x - s, x + s, y, y + 0.58, z - s, z + s, cc, 1, null, SATIN);
          for (const yy of [y + 0.04, y + 0.5]) fr.pbox(x - s - 0.008, x + s + 0.008, yy, yy + 0.05, z - s - 0.008, z + s + 0.008, shade(cc, 0.8), 1, null, SATIN);
          K.quad(K.solid, [fr.P(x - s, y + 0.05, z + s + 0.01), fr.P(x + s, y + 0.5, z + s + 0.01), fr.P(x + s - 0.06, y + 0.5, z + s + 0.01), fr.P(x - s, y + 0.11, z + s + 0.01)], fr.N(0, 0, 1), K.C(shade(cc, 0.8), 1), SATIN);
        }
      },
    },
    // ── a room somebody lives in ──
    bed: {
      label: 'Bed (an iron frame, a blanket)',
      fields: [F('w', 'Width (0.9 a single, 1.4 a double)'), F('yaw', 'Facing (°)'), F('made', 'Made (1) or slept in (0)'), F('colour', 'Blanket', 'text')],
      make: { at: [0, 0], yaw: 90, w: 1.4, made: 0, colour: '#5a4a6a' },
      draw(K, p) {
        // its head is at the frame's -z, against the wall
        const w = num(p.w, 1.4), L = 2, fr = frameOf(K, p, 90), iron = '#2a2a2e', c = p.colour || '#5a4a6a', made = +p.made;
        for (const sx of [-1, 1]) {
          ftube(K, fr, [sx * w / 2, 0, -L / 2], [sx * w / 2, 1.05, -L / 2], 0.022, iron);
          ftube(K, fr, [sx * w / 2, 0, L / 2], [sx * w / 2, 0.7, L / 2], 0.022, iron);
        }
        ftube(K, fr, [-w / 2, 1.02, -L / 2], [w / 2, 1.02, -L / 2], 0.022, iron);
        ftube(K, fr, [-w / 2, 0.68, L / 2], [w / 2, 0.68, L / 2], 0.022, iron);
        for (let x = -w / 2 + 0.15; x < w / 2; x += 0.15) { ftube(K, fr, [x, 0.5, -L / 2], [x, 1.02, -L / 2], 0.01, iron, 1, 5); ftube(K, fr, [x, 0.4, L / 2], [x, 0.68, L / 2], 0.01, iron, 1, 5); }
        fr.pbox(-w / 2, w / 2, 0.3, 0.36, -L / 2, L / 2, '#3a3a3c', 1, null, METAL);
        fr.pbox(-w / 2 + 0.02, w / 2 - 0.02, 0.36, 0.52, -L / 2 + 0.02, L / 2 - 0.02, '#d8d4c8', 1, null, CLOTH);
        // pillows, and the blanket: tucked flat, or thrown back in a heap
        for (const x of w > 1.1 ? [-w / 4, w / 4] : [0]) fr.pbox(x - 0.3, x + 0.3, 0.52, 0.64, -L / 2 + 0.08, -L / 2 + 0.48, '#ece8dc', 1, null, CLOTH);
        if (made) fr.pbox(-w / 2 - 0.03, w / 2 + 0.03, 0.4, 0.56, -L / 2 + 0.55, L / 2 + 0.02, c, 1, null, CLOTH);
        else {
          fr.pbox(-w / 2 + 0.03, w / 2 - 0.03, 0.52, 0.6, -L / 2 + 0.8, L / 2 - 0.05, c, 1, null, CLOTH);
          const [u, v] = fr.P(w / 6, 0, 0.1); K.ball(u, v, 0.62, 0.3, shade(c, 1.1), 1, 10, CLOTH);
        }
      },
    },
    // ── a works floor ──
    machine: {
      label: 'Machine (a flywheel, pistons and gauges)',
      fields: [F('w', 'Width'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('wheel', 'Flywheel (1)'), F('colour', 'Paint', 'text')],
      make: { at: [0, 0], yaw: 180, w: 3, h: 2.6, wheel: 1, colour: '#3a4a3e' },
      draw(K, p) {
        const w = num(p.w, 3), h = num(p.h, 2.6), fr = frameOf(K, p), c = p.colour || '#3a4a3e', steel = '#5a5c60', brass = '#b8943c';
        // a plinth, the housing, rivets along its seams and a lit panel of gauges
        fr.pbox(-w / 2 - 0.15, w / 2 + 0.15, 0, 0.3, -1.1, 0.35, '#4a4a46', 1, null, SATIN);
        fr.pbox(-w / 2, w / 2 - (+(p.wheel ?? 1) ? 0.9 : 0), 0.3, h * 0.72, -1, 0.1, c, 1, null, METAL);
        fr.pbox(-w / 2 + 0.1, w / 2 - (+(p.wheel ?? 1) ? 1 : 0.1), h * 0.72, h * 0.76, -0.95, 0.05, shade(c, 0.8), 1, null, METAL);
        for (let x = -w / 2 + 0.1; x < w / 2 - 1; x += 0.2) for (const y of [0.4, h * 0.7]) fr.pbox(x - 0.015, x + 0.015, y - 0.015, y + 0.015, 0.1, 0.12, steel, 1, null, METAL);
        for (let i = 0; i < 3; i++) {
          const x = -w / 2 + 0.4 + i * 0.36, y = h * 0.5;
          fr.pbox(x - 0.14, x + 0.14, y - 0.14, y + 0.14, 0.1, 0.14, brass, 1, null, METAL);
          glow(K, fr, x - 0.11, x + 0.11, y - 0.11, y + 0.11, 0.141, '#e8e0c0', 1.3);
          fr.pbox(x - 0.008, x + 0.008, y - 0.02, y + 0.09, 0.142, 0.146, '#1a1a1a', 1, null, SATIN);
        }
        glow(K, fr, -w / 2 + 0.3, -w / 2 + 0.36, h * 0.35, h * 0.35 + 0.06, 0.101, '#ff4020', 2.2);
        glow(K, fr, -w / 2 + 0.46, -w / 2 + 0.52, h * 0.35, h * 0.35 + 0.06, 0.101, '#40ff60', 2);
        // two pistons on top in their cylinders
        for (const x of [-w / 4, w / 10 - 0.4]) {
          const [u, v] = fr.P(x, 0, -0.45);
          K.lathe(u, v, [[0.22, h * 0.76], [0.22, h * 0.76 + 0.6], [0.25, h * 0.76 + 0.62], [0.25, h * 0.76 + 0.66], [0, h * 0.76 + 0.66]], steel, 1, 14, METAL);
          K.lathe(u, v, [[0.06, h * 0.76 + 0.66], [0.06, h * 0.76 + 1.1], [0, h * 0.76 + 1.1]], '#c8ccd0', 1, 10, METAL);
        }
        if (+(p.wheel ?? 1)) {
          const R = Math.min(h * 0.45, 1.3), cx = w / 2 - 0.45, cy = R + 0.35;
          fr.pbox(cx - 0.12, cx + 0.12, 0.3, cy, -0.6, -0.3, steel, 1, null, METAL);
          wheelZ(K, fr, cx, cy, -0.2, R, 0.07, '#2a2a2c', 6);
          ftube(K, fr, [cx, cy, -0.2], [-w / 4, h * 0.76 + 1.05, -0.45], 0.04, '#c8ccd0', 1, 8);
        }
      },
    },
    pipe_run: {
      label: 'Run of pipes along a wall (valves, a gauge)',
      fields: [F('w', 'Length'), F('y', 'Height'), F('n', 'Pipes'), F('yaw', 'Facing (°)'), F('drop', 'Drop to the floor at the ends (1)'), F('colour', 'Colour', 'text')],
      make: { at: [0, 0], yaw: 180, w: 8, y: 2.2, n: 3, drop: 1 },
      draw(K, p) {
        const w = num(p.w, 8), y = num(p.y, 2.2), n = Math.max(1, Math.min(6, num(p.n, 3) | 0)), fr = frameOf(K, p), cols = [p.colour || '#6a5a3a', '#4a5a6a', '#8a3a2a', '#5a5a52'];
        for (let i = 0; i < n; i++) {
          const yy = y + i * 0.24, z = 0.16 + (i % 2) * 0.08, r = 0.06 + (i % 3) * 0.025, c = cols[i % cols.length];
          ftube(K, fr, [-w / 2, yy, z], [w / 2, yy, z], r, c, 1, 10);
          for (let x = -w / 2 + 0.8; x < w / 2; x += 1.6) { ftube(K, fr, [x - 0.04, yy, z], [x + 0.04, yy, z], r * 1.35, shade(c, 0.8), 1, 10); fr.pbox(x - 0.02, x + 0.02, yy, yy + 0.04, 0, z, '#2a2a2a', 1, null, METAL); }
          if (+(p.drop ?? 1) && i === 0) for (const s of [-1, 1]) ftube(K, fr, [s * w / 2, 0, z], [s * w / 2, yy, z], r, c, 1, 10);
        }
        // a wheel valve and a gauge on the lowest pipe
        const [vu, vv] = fr.P(w / 5, 0, 0.16);
        K.lathe(vu, vv, [[0.02, y], [0.02, y + 0.16], [0, y + 0.16]], '#5a5c60', 1, 8, METAL);
        ftube(K, fr, [w / 5 - 0.14, y + 0.17, 0.16], [w / 5 + 0.14, y + 0.17, 0.16], 0.015, '#a82a1e', 1, 6);
        ftube(K, fr, [w / 5, y + 0.17, 0.02], [w / 5, y + 0.17, 0.3], 0.015, '#a82a1e', 1, 6);
        fr.pbox(-w / 4 - 0.1, -w / 4 + 0.1, y - 0.3, y - 0.1, 0.18, 0.22, '#b8943c', 1, null, METAL);
        glow(K, fr, -w / 4 - 0.08, -w / 4 + 0.08, y - 0.28, y - 0.12, 0.221, '#e8e0c0', 1.3);
      },
    },
    catwalk: {
      label: 'Catwalk on posts (a grated deck, rails, a ladder)',
      fields: [F('w', 'Length'), F('depth', 'Width'), F('y', 'Deck height'), F('yaw', 'Facing (°)'), F('ladder', 'Ladder at which end (1, -1, 0)')],
      make: { at: [0, 0], yaw: 180, w: 8, depth: 1, y: 2.6, ladder: 1 },
      draw(K, p) {
        const w = num(p.w, 8), d = num(p.depth, 1), y = num(p.y, 2.6), fr = frameOf(K, p), steel = '#2a2c2e', rail = '#c8a020';
        fr.pbox(-w / 2, w / 2, y - 0.04, y, -d / 2, d / 2, '#3a3c3e', 1, null, METAL);
        for (let x = -w / 2; x < w / 2; x += 0.08) fr.pbox(x, x + 0.03, y, y + 0.006, -d / 2, d / 2, '#4a4c4e', 1, null, METAL);
        for (const s of [-1, 1]) fr.pbox(-w / 2, w / 2, y - 0.18, y, s * d / 2 - 0.03, s * d / 2 + 0.03, steel, 1, null, METAL);
        for (let x = -w / 2 + 0.2; x <= w / 2; x += 2) for (const s of [-1, 1]) ftube(K, fr, [x, 0, s * d / 2], [x, y - 0.18, s * d / 2], 0.05, steel, 1, 8);
        for (const s of [-1, 1]) {
          ftube(K, fr, [-w / 2, y + 1, s * d / 2], [w / 2, y + 1, s * d / 2], 0.025, rail);
          ftube(K, fr, [-w / 2, y + 0.5, s * d / 2], [w / 2, y + 0.5, s * d / 2], 0.018, rail);
          for (let x = -w / 2; x <= w / 2 + 1e-3; x += 1) ftube(K, fr, [x, y, s * d / 2], [x, y + 1, s * d / 2], 0.02, rail, 1, 6);
        }
        const L = num(p.ladder, 1);
        if (L) {
          const x = L * (w / 2 + 0.25);
          for (const s of [-0.22, 0.22]) ftube(K, fr, [x, 0, s], [x, y + 1, s], 0.025, steel);
          for (let yy = 0.3; yy < y; yy += 0.3) ftube(K, fr, [x, yy, -0.22], [x, yy, 0.22], 0.015, steel, 1, 6);
        }
      },
    },
    furnace: {
      label: 'Furnace (its mouth alight, a crucible, a channel of metal)',
      fields: [F('w', 'Width'), F('h', 'Height'), F('yaw', 'Facing (°)'), F('pour', 'Molten channel out the front (1)'), F('colour', 'Brick', 'text')],
      make: { at: [0, 0], yaw: 180, w: 3, h: 3.2, pour: 1, colour: '#5a3428' },
      draw(K, p) {
        const w = num(p.w, 3), h = num(p.h, 3.2), fr = frameOf(K, p), brick = p.colour || '#5a3428', steel = '#3a3c3e', hot = '#ff7a20';
        fr.pbox(-w / 2, w / 2, 0, h, -1.6, 0, brick, 1, null, SATIN);
        for (let y = 0.25; y < h; y += 0.25) fr.pbox(-w / 2, w / 2, y, y + 0.02, 0, 0.004, shade(brick, 0.75), 1, null, SATIN);
        for (const s of [-1, 1]) fr.pbox(s * w / 2 - 0.12, s * w / 2 + 0.12, 0, h + 0.1, -1.65, 0.08, steel, 1, null, METAL);
        fr.pbox(-w / 2 - 0.15, w / 2 + 0.15, h - 0.2, h, -1.65, 0.1, steel, 1, null, METAL);
        // the mouth, white-hot in the middle, and the hood and flue over it
        fr.pbox(-0.75, 0.75, 0.7, 1.75, -0.3, 0.004, '#1a0c06', 1, null, SATIN);
        glow(K, fr, -0.7, 0.7, 0.75, 1.7, 0.006, hot, 2.4);
        glow(K, fr, -0.4, 0.4, 0.9, 1.45, 0.008, '#ffe080', 3);
        fr.pbox(-0.9, 0.9, 1.75, 1.95, -0.1, 0.25, steel, 1, null, METAL);
        const [fu, fv] = fr.P(0.6, 0, -0.8);
        K.lathe(fu, fv, [[0.3, h], [0.3, h + 2.4], [0, h + 2.4]], '#2a2a2c', 1, 12, METAL);
        K.quad(K.solid, [fr.P(-1.6, 0.012, 0), fr.P(1.6, 0.012, 0), fr.P(1.6, 0.012, 2.4), fr.P(-1.6, 0.012, 2.4)], K.nrmOf(0, 1, 0), K.C('#6a3014', 1.3), EMISSIVE, null, true);
        if (+(p.pour ?? 1)) {
          fr.pbox(-0.18, 0.18, 0, 0.2, 0, 3.2, '#3a3028', 1, null, SATIN);
          K.quad(K.solid, [fr.P(-0.12, 0.201, 0), fr.P(0.12, 0.201, 0), fr.P(0.12, 0.201, 3.1), fr.P(-0.12, 0.201, 3.1)], K.nrmOf(0, 1, 0), K.C(hot, 2.4), EMISSIVE, null, true);
        }
        // a crucible on its stand beside it, its top glowing
        const [cu, cv] = fr.P(w / 2 + 0.9, 0, 0.6);
        K.lathe(cu, cv, [[0.06, 0], [0.06, 0.6], [0, 0.6]], steel, 1, 8, METAL);
        K.lathe(cu, cv, [[0.2, 0.6], [0.36, 0.75], [0.4, 1.05], [0.38, 1.08]], '#4a4a48', 1, 16, METAL);
        K.lathe(cu, cv, [[0.36, 1.04], [0, 1.04]], hot, 2.6, 16, EMISSIVE);
      },
    },
    // ── a workshop ──
    workbench: {
      label: 'Workbench (a vice, tools, a lamp)',
      fields: [F('w', 'Width'), F('yaw', 'Facing (°)'), F('seed', 'Seed'), F('colour', 'Wood', 'text')],
      make: { at: [0, 0], yaw: 180, w: 2.2, seed: 1 },
      draw(K, p) {
        // its working edge faces the frame's +z: stand it against a wall and face it out
        const w = num(p.w, 2.2), fr = frameOf(K, p), wood = p.colour || '#7a5a36', h = 0.9, roll = rollOf(num(p.seed, 1) * 37);
        fr.pbox(-w / 2, w / 2, h - 0.07, h, -0.4, 0.35, wood, 1, null, SATIN);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) fr.pbox(sx * (w / 2 - 0.08) - 0.04, sx * (w / 2 - 0.08) + 0.04, 0, h - 0.07, sz * 0.3 - 0.04, sz * 0.3 + 0.04, shade(wood, 0.8), 1, null, SATIN);
        fr.pbox(-w / 2 + 0.05, w / 2 - 0.05, 0.15, 0.19, -0.36, 0.3, shade(wood, 0.8), 1, null, SATIN);
        // a vice bolted to one corner
        fr.pbox(w / 2 - 0.35, w / 2 - 0.1, h, h + 0.14, 0.15, 0.32, '#3a5a8a', 1, null, METAL);
        fr.pbox(w / 2 - 0.35, w / 2 - 0.1, h + 0.02, h + 0.14, 0.36, 0.42, '#3a5a8a', 1, null, METAL);
        ftube(K, fr, [w / 2 - 0.22, h + 0.06, 0.32], [w / 2 - 0.22, h + 0.06, 0.6], 0.012, '#c8ccd0', 1, 6);
        // tools left lying: a hammer, a wrench, a soldering iron, a box of bits, a lit lamp on an arm
        const tools = [['#5a3a22', 0.3, 0.035], ['#9a9ca0', 0.25, 0.02], ['#2a2a2a', 0.22, 0.025], ['#a82a1e', 0.2, 0.03]];
        for (const [c, L, r] of tools) {
          const x = (roll() - 0.6) * (w - 0.8), z = (roll() - 0.5) * 0.4, a = roll() * Math.PI;
          ftube(K, fr, [x - Math.cos(a) * L / 2, h + r, z - Math.sin(a) * L / 2], [x + Math.cos(a) * L / 2, h + r, z + Math.sin(a) * L / 2], r, c, 1, 6, SATIN);
        }
        fr.pbox(-w / 2 + 0.2, -w / 2 + 0.55, h, h + 0.1, -0.3, -0.1, '#8a2a1e', 1, null, METAL);
        ftube(K, fr, [-w / 2 + 0.7, h, -0.32], [-w / 2 + 0.7, h + 0.5, -0.32], 0.015, '#2a2a2a');
        ftube(K, fr, [-w / 2 + 0.7, h + 0.5, -0.32], [-w / 2 + 0.9, h + 0.62, 0], 0.015, '#2a2a2a');
        const [lu, lv] = fr.P(-w / 2 + 0.9, 0, 0);
        K.lathe(lu, lv, [[0.02, h + 0.62], [0.11, h + 0.5], [0, h + 0.5]], '#c8c8c0', 1, 12, METAL);
        K.ball(lu, lv, h + 0.53, 0.035, '#fff0c0', 3, 8, EMISSIVE);
      },
    },
    tool_wall: {
      label: 'Pegboard of tools',
      fields: [F('w', 'Width'), F('h', 'Height'), F('y', 'Off the floor'), F('yaw', 'Facing (°)'), F('seed', 'Seed')],
      make: { at: [0, 0], yaw: 180, w: 2, h: 1, y: 1.15, seed: 1 },
      draw(K, p) {
        const w = num(p.w, 2), h = num(p.h, 1), y = num(p.y, 1.15), fr = frameOf(K, p), roll = rollOf(num(p.seed, 1) * 53);
        fr.pbox(-w / 2, w / 2, y, y + h, -0.03, 0, '#b89a6a', 1, null, SATIN);
        for (let x = -w / 2 + 0.1; x < w / 2; x += 0.1) for (let yy = y + 0.1; yy < y + h; yy += 0.1) fr.pbox(x - 0.006, x + 0.006, yy - 0.006, yy + 0.006, 0, 0.001, '#5a4a30', 1, null, SATIN);
        const cols = ['#9a9ca0', '#a82a1e', '#2a2a2a', '#c89a20', '#3a5a8a'];
        for (let x = -w / 2 + 0.15; x < w / 2 - 0.1; x += 0.14 + roll() * 0.1) {
          const L = 0.2 + roll() * 0.3, top = y + h - 0.12 - roll() * 0.2, c = cols[(roll() * cols.length) | 0];
          ftube(K, fr, [x, top, 0.03], [x, top - L, 0.03], 0.014 + roll() * 0.012, c, 1, 6, SATIN);
          if (roll() < 0.5) fr.pbox(x - 0.04, x + 0.04, top - L - 0.03, top - L + 0.02, 0.01, 0.05, c, 1, null, METAL);
        }
      },
    },
    // ── under the city ──
    tunnel: {
      label: 'Brick tunnel (a barrel vault, a channel of water)',
      fields: [F('w', 'Width'), F('depth', 'Length'), F('h', 'Wall height before the arch'), F('water', 'Water channel width (0 for none)'), F('colour', 'Brick', 'text'), F('wet', 'Water colour', 'text')],
      make: { at: [0, 4], w: 5, depth: 9, h: 1.6, water: 1.6, colour: '#5a3a2e', wet: '#1e3a3a' },
      draw(K, p) {
        // the vault runs along v (yaw 0): stand it at the room's middle and it is the whole room
        const w = num(p.w, 5), d = num(p.depth, 9), sp = num(p.h, 1.6), fr = frameOf(K, p, 0), brick = p.colour || '#5a3a2e', R = w / 2, roll = rollOf(w * 31 + d);
        const rings = Math.max(4, Math.round(d / 0.5)), segs = 14;
        for (let j = 0; j < rings; j++) {
          const z0 = -d / 2 + j * d / rings, z1 = z0 + d / rings, k = 0.85 + roll() * 0.25 - (j % 2) * 0.05;
          for (const s of [-1, 1]) K.quad(K.solid, [fr.P(s * R, 0, z0), fr.P(s * R, sp, z0), fr.P(s * R, sp, z1), fr.P(s * R, 0, z1)], fr.N(-s, 0, 0), K.C(brick, k), SATIN);
          arc(segs, 0, Math.PI, (a, b) => {
            const P = (t, z) => [Math.cos(t) * R, sp + Math.sin(t) * R, z];
            K.quad(K.solid, [fr.P(...P(a, z0)), fr.P(...P(b, z0)), fr.P(...P(b, z1)), fr.P(...P(a, z1))], fr.N(-Math.cos((a + b) / 2), -Math.sin((a + b) / 2), 0), K.C(brick, k * (0.9 + 0.1 * Math.sin(a))), SATIN);
          });
        }
        // a stain where the water's been higher, a ledge either side and the channel down the middle
        for (const s of [-1, 1]) fr.pbox(s * R - s * 0.01 - 0.005, s * R - s * 0.01 + 0.005, 0.5, 0.62, -d / 2, d / 2, shade(brick, 0.6), 1, null, SATIN);
        const cw = num(p.water, 1.6);
        if (cw > 0) {
          for (const s of [-1, 1]) fr.pbox(s * cw / 2 - 0.08, s * cw / 2 + 0.08, 0, 0.12, -d / 2, d / 2, '#4a4a44', 1, null, SATIN);
          fr.pbox(-cw / 2 + 0.08, cw / 2 - 0.08, 0, 0.04, -d / 2, d / 2, p.wet || '#1e3a3a', 1.1, null, GLOSS);
        }
        // caged bulbs along the crown
        for (let z = -d / 2 + 1.2; z < d / 2; z += 2.6) { const [u, v] = fr.P(0, 0, z); K.ball(u, v, sp + R - 0.25, 0.06, '#ffd890', 2.8, 10, EMISSIVE); K.lathe(u, v, [[0.012, sp + R], [0.012, sp + R - 0.18], [0, sp + R - 0.18]], '#1a1a1a', 1, 6, METAL); }
      },
    },
    // ── outside a rich man's house ──
    pool: {
      label: 'Swimming pool (full or drained)',
      fields: [F('w', 'Width'), F('depth', 'Length'), F('yaw', 'Facing (°)'), F('drained', 'Drained (1)'), F('colour', 'Water', 'text')],
      make: { at: [0, 4], yaw: 0, w: 4, depth: 6, drained: 0, colour: '#2a9ad0' },
      draw(K, p) {
        const w = num(p.w, 4), d = num(p.depth, 6), fr = frameOf(K, p, 0), dry = +p.drained, roll = rollOf(w * 13 + d * 7);
        // the coping round it, a hand's height proud of the deck, and a tiled lip inside
        for (const [x0, x1, z0, z1] of [[-w / 2 - 0.35, w / 2 + 0.35, -d / 2 - 0.35, -d / 2], [-w / 2 - 0.35, w / 2 + 0.35, d / 2, d / 2 + 0.35], [-w / 2 - 0.35, -w / 2, -d / 2, d / 2], [w / 2, w / 2 + 0.35, -d / 2, d / 2]]) fr.pbox(x0, x1, 0, 0.08, z0, z1, '#e8e2d4', 1, null, SATIN);
        if (dry) {
          fr.pbox(-w / 2, w / 2, 0, 0.012, -d / 2, d / 2, '#8aa8b0', 1, null, SATIN);
          for (let i = 0; i < 4; i++) fr.pbox(-0.02 + (i - 1.5) * w / 4, 0.02 + (i - 1.5) * w / 4, 0.012, 0.014, -d / 2, d / 2, '#2a4a6a', 1, null, SATIN);
          fr.pbox(-w / 2 + 0.3, -w / 2 + 1.4, 0.012, 0.02, d / 2 - 1.2, d / 2 - 0.2, '#3a4a3a', 1.05, null, GLOSS);
          for (let i = 0; i < 14; i++) { const x = (roll() - 0.5) * w, z = (roll() - 0.5) * d; fr.pbox(x - 0.05, x + 0.05, 0.012, 0.018, z - 0.03, z + 0.03, roll() < 0.5 ? '#8a6a2a' : '#5a4a2a', 1, null, CLOTH); }
        } else {
          fr.pbox(-w / 2, w / 2, 0, 0.05, -d / 2, d / 2, p.colour || '#2a9ad0', 1.15, null, GLOSS);
          for (let i = 0; i < 6; i++) { const x = (roll() - 0.5) * (w - 0.6), z = (roll() - 0.5) * (d - 0.6); fr.pbox(x - 0.4, x + 0.4, 0.051, 0.053, z - 0.03, z + 0.03, '#c8f0ff', 1.6, null, EMISSIVE); }
        }
        // a ladder at the deep end
        for (const x of [-0.25, 0.25]) { ftube(K, fr, [x, 0, d / 2 - 0.1], [x, 0.85, d / 2 - 0.1], 0.02, '#d8dce0'); ftube(K, fr, [x, 0.85, d / 2 - 0.1], [x, 0.85, d / 2 + 0.25], 0.02, '#d8dce0'); ftube(K, fr, [x, 0.85, d / 2 + 0.25], [x, 0.08, d / 2 + 0.25], 0.02, '#d8dce0'); }
      },
    },
    lounger: {
      label: 'Sun lounger',
      fields: [F('yaw', 'Facing (°)'), F('colour', 'Cushion', 'text')],
      make: { at: [0, 0], yaw: 180, colour: '#e8e0c8' },
      draw(K, p) {
        const fr = frameOf(K, p), c = p.colour || '#e8e0c8', steel = '#d8dcdf';
        // the foot toward the frame's +z, the back raised at -z
        for (const sx of [-0.3, 0.3]) { ftube(K, fr, [sx, 0.3, -0.2], [sx, 0.3, 1], 0.02, steel); ftube(K, fr, [sx, 0, 0.9], [sx, 0.3, 0.9], 0.02, steel); ftube(K, fr, [sx, 0, -0.1], [sx, 0.3, -0.1], 0.02, steel); ftube(K, fr, [sx, 0.3, -0.2], [sx, 0.9, -0.75], 0.02, steel); }
        fr.pbox(-0.3, 0.3, 0.3, 0.38, -0.2, 1, c, 1, null, CLOTH);
        K.quad(K.solid, [fr.P(-0.3, 0.36, -0.2), fr.P(0.3, 0.36, -0.2), fr.P(0.3, 0.93, -0.72), fr.P(-0.3, 0.93, -0.72)], fr.N(0, 0.68, 0.74), K.C(c, 1), CLOTH);
      },
    },
    // ── a civic building ──
    flag_stand: {
      label: 'Flag on a pole in a stand',
      fields: [F('h', 'Pole height'), F('yaw', 'Facing (°)'), F('colour', 'Flag', 'text'), F('colour2', 'Band', 'text')],
      make: { at: [0, 0], yaw: 180, h: 2.4, colour: '#2a3a6a', colour2: '#c8a040' },
      draw(K, p) {
        const h = num(p.h, 2.4), fr = frameOf(K, p), [u, v] = p.at, c = p.colour || '#2a3a6a', c2 = p.colour2 || '#c8a040';
        K.lathe(u, v, [[0.2, 0], [0.18, 0.08], [0.03, 0.1], [0.018, h], [0.03, h + 0.02], [0.03, h + 0.07], [0, h + 0.09]], '#b8943c', 1, 12, METAL);
        // the flag hanging in folds off the pole
        for (let i = 0; i < 6; i++) {
          const x0 = 0.03 + i * 0.13, x1 = x0 + 0.13, z0 = (i % 2) * 0.07, z1 = ((i + 1) % 2) * 0.07, col = i === 2 || i === 3 ? c2 : c;
          K.quad(K.solid, [fr.P(-x0, h - 0.05, z0), fr.P(-x1, h - 0.05, z1), fr.P(-x1, h - 1.1, z1), fr.P(-x0, h - 1.1, z0)], fr.N(0, 0, 1), K.C(col, i % 2 ? 0.85 : 1), CLOTH);
        }
      },
    },
    grand_steps: {
      label: 'Grand steps up to a portico of columns',
      fields: [F('w', 'Width'), F('n', 'Steps'), F('cols', 'Columns'), F('h', 'Column height'), F('yaw', 'Facing (°)'), F('colour', 'Stone', 'text')],
      make: { at: [0, 6], yaw: 180, w: 10, n: 6, cols: 6, h: 4.5, colour: '#c8c0ac' },
      draw(K, p) {
        // the steps come down toward the frame's +z; the portico stands on the top step
        const w = num(p.w, 10), n = Math.max(1, Math.min(14, num(p.n, 6) | 0)), cols = Math.max(0, Math.min(12, num(p.cols, 6) | 0)), ch = num(p.h, 4.5), fr = frameOf(K, p), stone = p.colour || '#c8c0ac', rise = 0.16, run = 0.36;
        // each step a block from the back, the lowest reaching furthest forward
        for (let i = 0; i < n; i++) fr.pbox(-w / 2 + i * 0.05, w / 2 - i * 0.05, 0, rise * (i + 1), -1.4, run * (n - i), shade(stone, 1 - i * 0.015), 1, null, SATIN);
        const top = rise * n, zc = -0.9;
        for (let i = 0; i < cols; i++) {
          const x = cols === 1 ? 0 : -w / 2 + 0.7 + i * (w - 1.4) / (cols - 1), [u, v] = fr.P(x, 0, zc);
          K.lathe(u, v, [[0.42, top], [0.42, top + 0.18], [0.32, top + 0.24], [0.3, top + ch - 0.3], [0.26, top + ch - 0.28], [0.4, top + ch - 0.12], [0.44, top + ch], [0, top + ch]], stone, 1, 16, SATIN);
          for (let f = 0; f < 8; f++) { const a = f / 8 * TAU; ftube(K, fr, [x + Math.cos(a) * 0.305, top + 0.3, zc + Math.sin(a) * 0.305], [x + Math.cos(a) * 0.29, top + ch - 0.32, zc + Math.sin(a) * 0.29], 0.025, shade(stone, 0.85), 1, 4, SATIN); }
        }
        // the entablature over them, and a dark doorway behind
        if (cols) {
          fr.pbox(-w / 2 + 0.2, w / 2 - 0.2, top + ch, top + ch + 0.6, -1.4, -0.4, stone, 1, null, SATIN);
          fr.pbox(-w / 2 + 0.1, w / 2 - 0.1, top + ch + 0.6, top + ch + 0.8, -1.45, -0.35, shade(stone, 1.08), 1, null, SATIN);
        }
        fr.pbox(-1.2, 1.2, top, top + 3, -1.42, -1.38, '#1a1614', 1, null, SATIN);
        glow(K, fr, -1.1, 1.1, top + 0.02, top + 2.9, -1.379, '#ffb860', 0.9);
      },
    },
  };
}
