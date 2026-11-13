// GLASS 2 · WHAT'S IN A HAND. Somebody in a room doing something with their hands that brought nothing of its own
// to draw: a player eating or dosing (plugins/roomstage sends their `act`), or a resident's habit taken standing
// (plugins/npc-drugs). gl/figure-reach.js says what's held in each hand and where it sits in the hand's frame
// (HELD), and has already bent the arm so its tip arrives; this draws it off the hand's bone of the figure
// gl/room-people.js posed. A meal (gl/room-meals.js) and a session at the table (gl/room-stash.js) draw their own.
//
// Posed every frame into the room's props layer after the meals and the stash, into the same batch.

import { grid, ellipsoid, box, lin, MAT } from './ballpark-mesh.js';
import { FIGURE_BONE } from '../figure.js';
import { heldFrame } from './figure-reach.js';
import { handScaleOf } from '../figure.js';

const UNLIT = 40;
const C = (h) => lin(h);
const GLASS_G = C('#2f5a2a'), GLASS_B = C('#6a3a14'), CAP = C('#c8a040'), PAPER = C('#ecebe4'), FILTER = C('#c8884a'), EMBER = [1.6, 0.5, 0.12];
const PILL = C('#eceef4'), BARREL = C('#dfe8ee'), PLUNGER = C('#2a2c30'), STEEL = C('#c4c8cc'), PIPE = C('#d8eaf0'), RAG = C('#b8a888');
const CAN = C('#b8342a'), CAN_TOP = C('#c8ccd0'), BREAD = C('#c89a5a'), FILL = C('#7a9a3a'), LIGHTER = C('#d84a2a');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
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

// ── A phone ──────────────────────────────────────────────────────────────────────────────────────────────────────
// A slab in a case, the screen on whichever face looks at the face (`eye`, set by heldProps). What's on it is
// picked per person and moves on every few seconds, so a room of people on their phones isn't one screen copied:
// a feed scrolling, a chat, a video, a map, a game, a call, a page of text, or the lock screen.
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
// a flat quad, its normal turned away from `behind`
function quad(b, o, U, V, w, h, behind, col, mat) {
  grid(b, 2, 2, (i, j) => [0, 1, 2].map((k) => o[k] + U[k] * (j - 0.5) * w + V[k] * (i - 0.5) * h), { wrap: false, col, mat, centre: behind });
}
function drawPhone(b, c, tip, end, seed, eye) {
  const V = unit(sub(tip, end)), H = 0.144, W = 0.07, T = 0.009;
  // the screen faces whoever's holding it: the slab's normal is the one with the eye on its side
  let N = unit(eye ? cross(V, cross(sub(eye, c), V)) : cross(V, [0, 1, 0]));
  const U = unit(cross(V, N));
  const caseCol = CASES[seed % CASES.length], back = c.map((v, k) => v - N[k] * T);
  quad(b, c, U, V, W, H, back, caseCol, MAT.SATIN);
  quad(b, back, U, V, W, H, c, caseCol, MAT.SATIN);
  for (const [s, AX, BX, a, bl] of [[1, U, V, W, H], [-1, U, V, W, H], [1, V, U, H, W], [-1, V, U, H, W]]) {
    const edge = c.map((v, k) => v + AX[k] * s * a * 0.5 - N[k] * T * 0.5);
    quad(b, edge, BX, N, bl, T, c.map((v, k) => v - N[k] * T * 0.5), caseCol, MAT.SATIN);
  }
  // what's on it now
  const tick = Math.floor(performance.now() / SCREEN_MS), h = hash(seed * 31 + tick), sc = SCREENS[(hash(seed) + (h % 5 === 0 ? tick : 0)) % SCREENS.length];
  const face = c.map((v, k) => v + N[k] * 0.0006), behind = c.map((v, k) => v - N[k] * 0.004);
  quad(b, face, U, V, W * 0.9, H * 0.9, behind, sc.bg, UNLIT);
  const lift = (d) => face.map((v, k) => v + N[k] * 0.0004 * d);
  const rows = sc.kind === 'lock' || sc.kind === 'call' ? 2 : sc.kind === 'video' || sc.kind === 'game' ? 3 : 6;
  for (let r = 0; r < rows; r++) {
    const g = hash(h + r * 7), y = 0.38 - (r + 0.5) * (0.76 / rows), wide = 0.35 + (g % 50) / 100;
    const left = sc.kind === 'chat' ? (g % 2 ? -0.18 : 0.18) : sc.kind === 'lock' ? 0 : -0.4 + wide / 2;
    const tall = sc.kind === 'video' || sc.kind === 'game' ? 0.18 : sc.kind === 'lock' && !r ? 0.12 : 0.05;
    const at = lift(1 + r % 2).map((v, k) => v + V[k] * y * H + U[k] * left * W);
    quad(b, at, U, V, W * 0.9 * (sc.kind === 'video' ? 0.9 : wide), H * tall, behind, sc.rows[r % 2], UNLIT);
  }
}

// One thing in one hand. `end` and `tip` are its two ends in the room, `c` where it's held.
function draw(b, kind, { c, tip, end, eye }, seed) {
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
  } else if (kind === 'cigarette' || kind === 'joint') {
    // the filter (a joint's roach is paper) at the mouth's end, the paper, and the ember out past the back of the hand
    const r = kind === 'joint' ? 0.0058 : 0.0045, filt = kind === 'joint' ? PAPER : FILTER;
    lathe(b, tip, lerp3(tip, end, 0.27), [[0, r], [1, r]], filt, MAT.MATTE, 8);
    lathe(b, lerp3(tip, end, 0.27), lerp3(tip, end, 0.95), [[0, r], [1, kind === 'joint' ? r * 1.25 : r]], PAPER, MAT.MATTE, 8);
    lathe(b, lerp3(tip, end, 0.95), end, [[0, kind === 'joint' ? r * 1.25 : r], [1, r * 0.6]], EMBER, UNLIT, 8);
  } else if (kind === 'pill') {
    ellipsoid(b, c, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.0055, 0.0034, 0.0042], 5, 8, PILL, MAT.GLOSS);
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
  } else if (kind === 'rag') {
    const d = unit(sub(tip, end)), U = unit(cross(d, [0, 1, 0]));
    ellipsoid(b, c, [U, cross(d, U), d], [0.045, 0.04, 0.014], 5, 9, RAG, MAT.CLOTH);
  } else if (kind === 'phone') {
    drawPhone(b, c, tip, end, seed, eye);
  } else if (kind === 'lighter') {
    const d = unit(sub(tip, end));
    box(b, c, [0.009, 0.022, 0.006], (Math.atan2(d[0], d[2]) * 180) / Math.PI, LIGHTER, MAT.GLOSS);
  }
}

// Into `b`: what each body holds that nothing else draws. `bodies` as room-stage.js hands figurePeople and `recs`
// what that gave back, one for one; each record's `hold` (gl/figure-reach.js finishArms) names what's in each hand.
export function heldProps(b, bodies, recs) {
  recs.forEach((rec, i) => {
    const body = bodies[i];
    if (!rec?.hold || !rec.key?.sculpt || body?.meal || body?.stash) return;
    for (const [L, s] of [['L', 1], ['R', -1]]) {
      const kind = rec.hold[L];
      if (!kind) continue;
      const shape = rec.hands ? null : 'cup', fr = heldFrame(kind, s, handScaleOf(rec.key, s), kind === 'pill' ? 'pinch' : shape || 'cup');
      if (!fr) continue;
      const bone = FIGURE_BONE['hand' + L], P = (p) => onBone(rec, bone, p);
      // a phone's screen turns to the eyes (bind space, between them), carried by the head's bone
      const eye = kind === 'phone' ? onBone(rec, FIGURE_BONE.head, [0, 1.62, 0.09]) : null;
      const seed = kind === 'phone' ? [...String(body?.id || body?.name || '')].reduce((n, ch) => n * 31 + ch.charCodeAt(0) >>> 0, 7) : String(body?.id || '').length;
      draw(b, kind, { c: P(fr.c), tip: P(fr.tip), end: P(fr.end), eye }, seed);
    }
  });
  return b;
}
