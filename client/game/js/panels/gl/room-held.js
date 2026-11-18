// GLASS 2 · WHAT'S IN A HAND. Somebody in a room doing something with their hands that brought nothing of its own
// to draw: a player eating or dosing (plugins/roomstage sends their `act`), a resident's habit taken standing
// (plugins/npc-drugs), somebody on their phone, at a meal, writing, counting money, dealing. gl/figure-reach.js says
// what's held in each hand, and gl/figure-grips.js where it sits in the hand (its frame: x along it, y its face, z
// across), with the fingers already closed on it; this draws it there off the hand's bone of the figure
// gl/room-people.js posed. A meal's plate and pans (gl/room-meals.js) and a session at the table (gl/room-stash.js)
// draw their own.
//
// Posed every frame into the room's props layer after the meals and the stash, into the same batch.

import { grid, ellipsoid, lin, vtx, MAT } from './ballpark-mesh.js';
import { FIGURE_BONE } from '../figure.js';
import { heldFrame } from './figure-reach.js';
import { handScaleOf } from '../figure.js';
import { PHONE_SIZE } from './figure-grips.js';

const UNLIT = 40;
const C = (h) => lin(h);
// a cigarette's filter is the city's cyan for most people (gl/actor-smoke.js FILTERS, on the street), cork for the rest
const GLASS_G = C('#2f5a2a'), GLASS_B = C('#6a3a14'), PAPER = C('#ecebe4'), FILTER = C('#15c4d0'), CORK = C('#c8884a'), EMBER = [1.6, 0.5, 0.12];
const PILL = C('#eceef4'), BARREL = C('#dfe8ee'), PLUNGER = C('#2a2c30'), STEEL = C('#c4c8cc'), PIPE = C('#d8eaf0'), RAG = C('#b8a888');
const CAN = C('#b8342a'), CAN_TOP = C('#c8ccd0'), BREAD = C('#c89a5a'), FILL = C('#7a9a3a'), LIGHTER = C('#d84a2a');
const BUN = C('#d9a05c'), BUN_TOP = C('#b8743a'), FRANK = C('#9a3c1c'), MUSTARD = C('#e8c020'), PATTY = C('#4a2a18'), CHEESE = C('#f0b830'), LETTUCE = C('#6aa83a');
const CUTLERY = C('#b8bcc0'), KNIFE_H = C('#2a2420'), NOTE = C('#9ab48a'), NOTE_INK = C('#5a7a52'), CARD_BACK = C('#a0282a'), CARD_FACE = C('#f2f0ea');
const PAD_PAPER = C('#efe9c8'), PAD_BACK = C('#6a5a44'), PEN = C('#20304a'), PEN_TIP = C('#d8d8d8');
const MUGS = ['#e8e2d6', '#2a4a6a', '#a83a2a', '#3a3a3a', '#d8b040'].map(C);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
// a bind-space point carried into the room by a hand's bone (the record's 3×4 rows)
function onBone(rec, bone, p) {
  const m = rec.rows, o = bone * 12;
  return [0, 1, 2].map((r) => m[o + r * 4] * p[0] + m[o + r * 4 + 1] * p[1] + m[o + r * 4 + 2] * p[2] + m[o + r * 4 + 3]);
}
// A turned shape from A toward B: `prof` [[t, r]], t from 0 at A to 1 at B, r in metres.
function lathe(b, A, B, prof, col, mat, segs = 12) {
  const d = sub(B, A), ax = unit(d), U = unit(cross(ax, Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), V = cross(ax, U);
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
  grid(b, prof.length, segs, (i, j) => {
    const [t, r] = prof[i], a = (j / segs) * Math.PI * 2, c = Math.cos(a) * r, s = Math.sin(a) * r;
    return [A[0] + d[0] * t + U[0] * c + V[0] * s, A[1] + d[1] * t + U[1] * c + V[1] * s, A[2] + d[2] * t + U[2] * c + V[2] * s];
  }, { col, mat, centre: mid });
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// a point given in a frame's own terms (x along, y its face, z across)
const P = (F, x, y, z) => [F.o[0] + F.X[0] * x + F.Y[0] * y + F.Z[0] * z, F.o[1] + F.X[1] * x + F.Y[1] * y + F.Z[1] * z, F.o[2] + F.X[2] * x + F.Y[2] * y + F.Z[2] * z];
// One face, four corners in order round it, facing n.
function face(b, a, bb, c, d, n, col, mat) {
  for (const v of [a, bb, c, a, c, d]) vtx(b, v, n, [0, 0], col, mat);
}
// A box in a frame: its middle (x, y, z in the frame) and half sizes. `cols` colours its six faces, +x -x +y -y +z -z.
function obox(b, F, [x, y, z], [hx, hy, hz], cols, mat) {
  const c = (i) => (Array.isArray(cols[0]) ? cols[i] : cols);
  const q = (sx, sy, sz) => P(F, x + sx * hx, y + sy * hy, z + sz * hz);
  const nx = F.X, ny = F.Y, nz = F.Z, neg = (v) => mul(v, -1);
  face(b, q(1, -1, -1), q(1, 1, -1), q(1, 1, 1), q(1, -1, 1), nx, c(0), mat);
  face(b, q(-1, -1, 1), q(-1, 1, 1), q(-1, 1, -1), q(-1, -1, -1), neg(nx), c(1), mat);
  face(b, q(-1, 1, -1), q(-1, 1, 1), q(1, 1, 1), q(1, 1, -1), ny, c(2), mat);
  face(b, q(-1, -1, 1), q(-1, -1, -1), q(1, -1, -1), q(1, -1, 1), neg(ny), c(3), mat);
  face(b, q(-1, -1, 1), q(1, -1, 1), q(1, 1, 1), q(-1, 1, 1), nz, c(4), mat);
  face(b, q(1, -1, -1), q(-1, -1, -1), q(-1, 1, -1), q(1, 1, -1), neg(nz), c(5), mat);
}

// ── A phone ──────────────────────────────────────────────────────────────────────────────────────────────────────
// A slab in a case, the screen on its face (the grip's y), its top along x. What's on it is picked per person and
// moves on every few seconds, so a room of people on their phones isn't one screen copied: a feed scrolling, a chat,
// a video, a map, a game, a call, a page of text, or the lock screen.
const CASES = ['#1c1d22', '#2a3550', '#6a2a2a', '#d8d4cc', '#3a5a3a', '#c86a9a'].map(C);
const SCREENS = [
  { bg: [0.9, 0.92, 0.95], rows: [[0.35, 0.55, 0.95], [0.75, 0.75, 0.78]], kind: 'feed' },
  { bg: [0.08, 0.1, 0.12], rows: [[0.2, 0.75, 0.4], [0.5, 0.52, 0.56]], kind: 'chat' },
  { bg: [0.05, 0.05, 0.06], rows: [[1.3, 0.6, 0.25], [0.3, 0.55, 1.2]], kind: 'video' },
  { bg: [0.75, 0.82, 0.68], rows: [[0.95, 0.85, 0.55], [0.45, 0.6, 0.85]], kind: 'map' },
  { bg: [0.25, 0.08, 0.35], rows: [[1.4, 0.3, 0.8], [0.4, 1.3, 0.5]], kind: 'game' },
  { bg: [0.1, 0.35, 0.2], rows: [[0.9, 0.95, 0.9], [1.3, 0.3, 0.25]], kind: 'call' },
  { bg: [0.95, 0.93, 0.88], rows: [[0.25, 0.25, 0.28], [0.45, 0.45, 0.48]], kind: 'text' },
  { bg: [0.12, 0.16, 0.3], rows: [[0.9, 0.92, 1.0], [0.5, 0.55, 0.7]], kind: 'lock' },
];
const SCREEN_MS = 4200;
const hash = (n) => { let h = n * 2654435761 >>> 0; h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0; return (h ^ (h >>> 16)) >>> 0; };
// a flat rectangle in the frame's x-z plane at height y, `w` across and `h` along, facing +y
function plate(b, F, x, y, z, h, w, col, mat) {
  face(b, P(F, x - h / 2, y, z - w / 2), P(F, x - h / 2, y, z + w / 2), P(F, x + h / 2, y, z + w / 2), P(F, x + h / 2, y, z - w / 2), F.Y, col, mat);
}
function drawPhone(b, F, seed) {
  const { H, W, T } = PHONE_SIZE;
  obox(b, F, [0, 0, 0], [H / 2, T / 2, W / 2], CASES[seed % CASES.length], MAT.SATIN);
  // what's on it now: the glass, then rows of whatever the app shows, scrolling when it's a feed
  const tick = Math.floor(performance.now() / SCREEN_MS), h = hash(seed * 31 + tick), sc = SCREENS[(hash(seed) + (h % 5 === 0 ? tick : 0)) % SCREENS.length];
  const y0 = T / 2 + 0.0004;
  plate(b, F, 0, y0, 0, H * 0.92, W * 0.88, sc.bg, UNLIT);
  const rows = sc.kind === 'lock' || sc.kind === 'call' ? 2 : sc.kind === 'video' || sc.kind === 'game' ? 3 : 6;
  const scroll = sc.kind === 'feed' || sc.kind === 'text' ? ((performance.now() / 1000) * 0.4 + (seed % 7)) % 1 : 0;
  for (let r = 0; r < rows; r++) {
    const g = hash(h + r * 7), x = 0.38 - ((r + 0.5 + scroll) % rows) * (0.76 / rows), wide = 0.35 + (g % 50) / 100;
    const z = sc.kind === 'chat' ? (g % 2 ? -0.18 : 0.18) : sc.kind === 'lock' ? 0 : -0.4 + wide / 2;
    const tall = sc.kind === 'video' || sc.kind === 'game' ? 0.18 : sc.kind === 'lock' && !r ? 0.12 : 0.05;
    plate(b, F, x * H, y0 + 0.0004 * (1 + (r % 2)), z * W, H * tall, W * 0.88 * (sc.kind === 'video' ? 0.9 : wide), sc.rows[r % 2], UNLIT);
  }
}

// ── Knives and forks ──────────────────────────────────────────────────────────────────────────────────────────────
// From where the index presses (0) back to the handle's end (x < 0) and out to the business end (x > 0), the handle's
// top up (y). A fork's head bends a little toward its hollow: up for a fork eaten with (forkUp), down for one held
// tines down to pin (forkDown).
function drawCutlery(b, F, kind) {
  if (kind === 'knife') {
    obox(b, F, [-0.068, 0, 0], [0.0525, 0.0045, 0.0085], KNIFE_H, MAT.SATIN);
    obox(b, F, [-0.012, 0, 0], [0.004, 0.003, 0.005], STEEL, MAT.METAL);
    // the blade, its edge down, narrowing to the point
    for (let i = 0; i < 5; i++) {
      const x0 = -0.008 + i * 0.02, w = 0.0095 - i * 0.0013;
      obox(b, F, [x0 + 0.01, -0.0035 + (0.0095 - w) * 0.5, 0], [0.01, w, 0.0009], STEEL, MAT.METAL);
    }
    return;
  }
  const bend = kind === 'forkDown' ? -1 : 1;
  // the handle, wider toward its end, and the neck
  for (let i = 0; i < 4; i++) obox(b, F, [-0.11 + i * 0.026, 0, 0], [0.013, 0.0016, 0.0058 - i * 0.0008], CUTLERY, MAT.METAL);
  obox(b, F, [0.003, 0, 0], [0.012, 0.0014, 0.0026], CUTLERY, MAT.METAL);
  if (kind === 'spoon') {
    const c = P(F, 0.046, 0.003 * bend, 0);
    ellipsoid(b, c, [F.X, F.Y, F.Z], [0.024, 0.006, 0.017], 4, 10, CUTLERY, MAT.METAL);
    return;
  }
  // the fork's head, then its four tines out from it, rising toward the hollow
  obox(b, F, [0.026, 0.001 * bend, 0], [0.01, 0.0015, 0.011], CUTLERY, MAT.METAL);
  for (let t = 0; t < 4; t++) {
    const z = (t - 1.5) * 0.0062;
    obox(b, F, [0.052, 0.003 * bend, z], [0.017, 0.0012, 0.0013], CUTLERY, MAT.METAL);
  }
}

// One thing in one hand. `end` and `tip` are its two ends in the room, `c` where it's held, `F` its whole frame.
function draw(b, kind, { c, tip, end, F }, seed) {
  if (kind === 'bottle') {
    const brown = seed % 2 ? GLASS_B : GLASS_G;
    // the body from the base, the shoulder, the neck to the lip, and the cap's rim
    lathe(b, end, tip, [[0, 0.001], [0.004, 0.029], [0.02, 0.031], [0.6, 0.031], [0.7, 0.022], [0.78, 0.013], [0.97, 0.0115], [1, 0.0125]], brown, MAT.GLOSS, 14);
    lathe(b, lerp3(end, tip, 0.14), lerp3(end, tip, 0.42), [[0, 0.0318], [1, 0.0318]], C('#e8dcc0'), MAT.SATIN, 14);
  } else if (kind === 'liquor') {
    // a spirit bottle: the body, square-shouldered, a label round it, a long neck and a steel pour spout
    lathe(b, end, tip, [[0, 0.001], [0.004, 0.034], [0.58, 0.035], [0.66, 0.03], [0.72, 0.014], [0.86, 0.012], [0.87, 0.009], [1, 0.003]], seed % 2 ? GLASS_B : C('#c8d0cc'), MAT.GLOSS, 12);
    lathe(b, lerp3(end, tip, 0.12), lerp3(end, tip, 0.4), [[0, 0.0352], [1, 0.0352]], seed % 3 ? C('#efe6d2') : C('#1a1a1a'), MAT.SATIN, 12);
    lathe(b, lerp3(end, tip, 0.86), tip, [[0, 0.006], [0.3, 0.004], [1, 0.0025]], STEEL, MAT.METAL, 6);
  } else if (kind === 'glass') {
    // a rocks glass with a short pour in it
    lathe(b, end, tip, [[0, 0.001], [0.02, 0.037], [1, 0.039]], C('#d8e4e6'), MAT.GLOSS, 12);
    lathe(b, lerp3(end, tip, 0.22), lerp3(end, tip, 0.55), [[0, 0.0395], [1, 0.0395]], C('#b0601a'), MAT.GLOSS, 12);
  } else if (kind === 'pint') {
    lathe(b, end, tip, [[0, 0.001], [0.02, 0.031], [1, 0.039]], C('#d8e4e6'), MAT.GLOSS, 12);
    lathe(b, lerp3(end, tip, 0.05), lerp3(end, tip, 0.82), [[0, 0.033], [1, 0.0392]], C('#c8801a'), MAT.GLOSS, 12);
    lathe(b, lerp3(end, tip, 0.82), tip, [[0, 0.0393], [1, 0.0395]], C('#f2ead6'), MAT.SATIN, 12);
  } else if (kind === 'shaker') {
    // a Boston shaker: the big tin in the hand and the small one jammed into its mouth, upside down
    lathe(b, end, lerp3(end, tip, 0.62), [[0, 0.001], [0.03, 0.034], [1, 0.045]], STEEL, MAT.METAL, 14);
    lathe(b, lerp3(end, tip, 0.56), tip, [[0, 0.04], [0.9, 0.034], [1, 0.001]], STEEL, MAT.METAL, 14);
  } else if (kind === 'can') {
    lathe(b, end, tip, [[0, 0.026], [0.04, 0.033], [0.92, 0.033], [1, 0.028]], CAN, MAT.METAL, 14);
    lathe(b, lerp3(end, tip, 0.985), tip, [[0, 0.028], [1, 0.0005]], CAN_TOP, MAT.METAL, 14);
  } else if (kind === 'mug' && F) {
    // the body up its x, a ring of coffee at the top, and the handle out along y
    const col = MUGS[seed % MUGS.length], lo = P(F, -0.048, 0, 0), hi = P(F, 0.048, 0, 0);
    lathe(b, lo, hi, [[0, 0.001], [0.01, 0.039], [0.08, 0.041], [1, 0.042]], col, MAT.GLOSS, 16);
    lathe(b, P(F, 0.036, 0, 0), P(F, 0.038, 0, 0), [[0, 0.038], [1, 0.0005]], C('#2a1608'), MAT.GLOSS, 14);
    // the handle: the arc of a ring round (0, 0.058) in the x-y plane that's outside the body, joined to it at both ends
    const ring = (a) => P(F, Math.sin(a) * 0.026, 0.058 + Math.cos(a) * 0.026, 0), n = 10, a0 = -2.0, a1 = 2.0;
    for (let i = 0; i < n; i++) lathe(b, ring(a0 + ((a1 - a0) * i) / n), ring(a0 + ((a1 - a0) * (i + 1)) / n), [[0, 0.0055], [1, 0.0055]], col, MAT.GLOSS, 6);
  } else if (kind === 'cigarette' || kind === 'joint') {
    // the filter (a joint's roach is paper) at the mouth's end, the paper, and the ember out past the back of the hand
    const r = kind === 'joint' ? 0.0058 : 0.0045, filt = kind === 'joint' ? PAPER : seed % 6 === 5 ? CORK : FILTER;
    lathe(b, tip, lerp3(tip, end, 0.27), [[0, r], [1, r]], filt, MAT.MATTE, 8);
    lathe(b, lerp3(tip, end, 0.27), lerp3(tip, end, 0.95), [[0, r], [1, kind === 'joint' ? r * 1.25 : r]], PAPER, MAT.MATTE, 8);
    lathe(b, lerp3(tip, end, 0.95), end, [[0, kind === 'joint' ? r * 1.25 : r], [1, r * 0.6]], EMBER, UNLIT, 8);
  } else if (kind === 'pill') {
    ellipsoid(b, c, F ? [F.X, F.Y, F.Z] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.0055, 0.0034, 0.0042], 5, 8, PILL, MAT.GLOSS);
  } else if (kind === 'syringe') {
    // the plunger's thumb rest at the end, the barrel, and the needle out to the tip
    lathe(b, end, lerp3(end, tip, 0.06), [[0, 0.0001], [0.1, 0.009], [1, 0.009]], PLUNGER, MAT.SATIN, 10);
    lathe(b, lerp3(end, tip, 0.06), lerp3(end, tip, 0.2), [[0, 0.0025], [1, 0.0025]], PLUNGER, MAT.SATIN, 6);
    lathe(b, lerp3(end, tip, 0.2), lerp3(end, tip, 0.72), [[0, 0.0062], [1, 0.0062]], BARREL, MAT.GLOSS, 10);
    lathe(b, lerp3(end, tip, 0.72), lerp3(end, tip, 0.76), [[0, 0.0062], [1, 0.0016]], BARREL, MAT.GLOSS, 10);
    lathe(b, lerp3(end, tip, 0.76), tip, [[0, 0.0007], [1, 0.0003]], STEEL, MAT.METAL, 5);
  } else if (kind === 'pipe') {
    // a glass stem to the mouth, the bulb at the far end
    lathe(b, lerp3(end, tip, 0.12), tip, [[0, 0.0048], [1, 0.0042]], PIPE, MAT.GLOSS, 8);
    const d = unit(sub(tip, end)), U = unit(cross(d, [0, 1, 0]));
    ellipsoid(b, end, [U, cross(d, U), d], [0.013, 0.013, 0.015], 6, 10, PIPE, MAT.GLOSS);
  } else if (kind === 'food') {
    // something eaten from the hand: a roll with its filling showing at the bitten end
    const d = unit(sub(tip, end)), U = unit(cross(d, [0, 1, 0])), V = cross(d, U), m = lerp3(end, tip, 0.5);
    ellipsoid(b, m, [U, V, d], [0.028, 0.024, 0.05], 7, 12, BREAD, MAT.SATIN);
    ellipsoid(b, lerp3(m, tip, 0.15), [U, V, d], [0.03, 0.008, 0.045], 4, 10, FILL, MAT.SATIN);
  } else if (kind === 'hotdog') {
    // a frank in a split bun, the frank out past both ends and a line of mustard along it, both halves of the bun
    // either side of it so it shows from any side
    const d = unit(sub(tip, end)), U = unit(cross(d, [0, 1, 0])), V = cross(d, U), m = lerp3(end, tip, 0.5);
    for (const s of [-1, 1]) ellipsoid(b, add(m, mul(U, s * 0.014)), [U, V, d], [0.014, 0.02, 0.072], 6, 14, BUN, MAT.SATIN);
    ellipsoid(b, m, [U, V, d], [0.012, 0.012, 0.094], 6, 14, FRANK, MAT.GLOSS);
    for (const s of [-1, 1]) ellipsoid(b, add(m, mul(V, s * 0.011)), [U, V, d], [0.004, 0.003, 0.072], 4, 10, MUSTARD, MAT.SATIN);
  } else if (kind === 'burger') {
    // a burger stacked up the hand's face: the heel, the patty, cheese over its edge, lettuce, and the domed crown
    const d = unit(sub(tip, end)), U = unit(cross(d, [0, 1, 0])), V = cross(d, U), m = lerp3(end, tip, 0.5), ax = [U, V, d];
    const at = (y) => add(m, mul(V, y));
    ellipsoid(b, at(-0.022), ax, [0.048, 0.012, 0.048], 5, 14, BUN, MAT.SATIN);
    ellipsoid(b, at(-0.006), ax, [0.05, 0.011, 0.05], 5, 14, PATTY, MAT.SATIN);
    ellipsoid(b, at(0.004), ax, [0.052, 0.003, 0.052], 3, 12, CHEESE, MAT.SATIN);
    ellipsoid(b, at(0.008), ax, [0.054, 0.004, 0.054], 3, 12, LETTUCE, MAT.SATIN);
    ellipsoid(b, at(0.016), ax, [0.049, 0.024, 0.049], 6, 14, BUN_TOP, MAT.SATIN);
  } else if (kind === 'rag') {
    const d = unit(sub(tip, end)), U = unit(cross(d, [0, 1, 0]));
    ellipsoid(b, c, [U, cross(d, U), d], [0.045, 0.04, 0.014], 5, 9, RAG, MAT.CLOTH);
  } else if (kind === 'phone' && F) {
    drawPhone(b, F, seed);
  } else if (kind === 'lighter' && F) {
    obox(b, F, [0, 0, 0], [0.03, 0.006, 0.011], LIGHTER, MAT.GLOSS);
    obox(b, F, [0.033, 0, 0], [0.004, 0.005, 0.008], STEEL, MAT.METAL);
  } else if ((kind === 'forkUp' || kind === 'forkDown' || kind === 'spoon' || kind === 'knife') && F) {
    drawCutlery(b, F, kind);
  } else if (kind === 'pen' && F) {
    lathe(b, P(F, -0.115, 0, 0), P(F, 0.012, 0, 0), [[0, 0.003], [0.04, 0.0046], [1, 0.0046]], PEN, MAT.GLOSS, 8);
    lathe(b, P(F, 0.012, 0, 0), P(F, 0.026, 0, 0), [[0, 0.0046], [0.7, 0.0018], [1, 0.0006]], PEN_TIP, MAT.METAL, 8);
  } else if ((kind === 'note' || kind === 'wad') && F) {
    // a note folded long, its print showing; a wad is a few, fanned
    const n = kind === 'wad' ? 5 : 1;
    for (let i = 0; i < n; i++) {
      const y = (i - (n - 1) / 2) * 0.0013, z = (i - (n - 1) / 2) * 0.0025;
      obox(b, F, [0.02 + i * 0.002, y, z], [0.034, 0.0003, 0.0175], [NOTE, NOTE, NOTE_INK, NOTE_INK, NOTE, NOTE], MAT.MATTE);
    }
  } else if (kind === 'card' && F) {
    obox(b, F, [0.03, 0, 0], [0.044, 0.0003, 0.032], [CARD_FACE, CARD_FACE, CARD_BACK, CARD_FACE, CARD_FACE, CARD_FACE], MAT.SATIN);
  } else if (kind === 'deck' && F) {
    obox(b, F, [0, 0, 0], [0.044, 0.0075, 0.032], [CARD_FACE, CARD_FACE, CARD_BACK, CARD_FACE, CARD_FACE, CARD_FACE], MAT.SATIN);
  } else if (kind === 'pad' && F) {
    obox(b, F, [0, -0.0015, 0], [0.075, 0.0025, 0.052], PAD_BACK, MAT.MATTE);
    obox(b, F, [0, 0.0025, 0], [0.074, 0.0015, 0.051], PAD_PAPER, MAT.MATTE);
  }
}

// a frame in bind space on a bone, carried into the room
function frameOnBone(rec, bone, F) {
  const o = onBone(rec, bone, F.o), way = (v) => unit(sub(onBone(rec, bone, add(F.o, v)), o));
  return { o, X: way(F.X), Y: way(F.Y), Z: way(F.Z) };
}
const seedOf = (body) => [...String(body?.id || body?.name || '')].reduce((n, ch) => n * 31 + ch.charCodeAt(0) >>> 0, 7);

// Into `b`: what each body holds that nothing else draws. `bodies` as room-stage.js hands figurePeople and `recs`
// what that gave back, one for one; each record's `hold` (gl/figure-reach.js finishArms) names what's in each hand.
export function heldProps(b, bodies, recs) {
  recs.forEach((rec, i) => {
    const body = bodies[i];
    if (!rec?.hold || !rec.key?.sculpt || body?.stash) return;
    for (const [L, s] of [['L', 1], ['R', -1]]) {
      const kind = rec.hold[L];
      if (!kind) continue;
      const fr = heldFrame(kind, s, handScaleOf(rec.key, s), kind === 'pill' ? 'pinch' : 'cup');
      if (!fr) continue;
      const bone = FIGURE_BONE['hand' + L], Q = (p) => onBone(rec, bone, p);
      draw(b, kind, { c: Q(fr.c), tip: Q(fr.tip), end: Q(fr.end), F: fr.F ? frameOnBone(rec, bone, fr.F) : null }, seedOf(body));
    }
  });
  return b;
}
