// GLASS 2 · A HAND OF HOLD'EM ON A ROOM'S CARD TABLE. What plugins/gametable says is on the felt (GameTable.roomState,
// sent on the table's piece as `board` through plugins/roomstage `room.boards` and `room_board`), drawn on the
// `poker` table gl/room-decor.js builds: two cards in front of each seat, a stack of chips by them and their bet
// pushed out over the line, the dealer's button, the board down the middle and the pot beside it. Your own two cards
// come from your pane (`mine`, data-p3d); anybody else's stay face down until a showdown turns them over.
//
// It moves. A new hand sends the cards off the top of the deck at the dealer's end round the table one at a time,
// spinning, two rounds; a new street flies its cards out and turns them over; the seat to act has a gold ring
// breathing on the felt in front of it, and a winner's chips glow. The clock is the frame's (`t`, seconds), and
// what started when is kept here per table, keyed on the hand number and the board's length.
//
// ⚠ IT DECIDES NOTHING. The state is the server's; this only lays it out. Posed every frame into the room's props
// layer after gl/room-held.js, into the same batch. Nothing here is in the room's own mesh.

import { vtx, lin, MAT } from './ballpark-mesh.js';
import { facing } from '../../../../shared/room-layout.js';
import { LEGEND_STROKES } from '../../../../shared/legend-font.js';

const TAU = Math.PI * 2;
const C = (h) => lin(h);
const FACE = C('#f6f2e8'), BACK = C('#9a1c22'), BACK_LINE = C('#e0c070'), RED = C('#c8202a'), BLACK = C('#16161a');
const SUIT_INK = { s: BLACK, h: RED, d: C('#1d5fc4'), c: C('#17803c') };
const CHIP = { 1: C('#ece6d8'), 5: C('#c22a2e'), 25: C('#2a7a3c'), 100: C('#1a1a1e'), 500: C('#6a2a8a') };
const STRIPE = C('#f2efe6'), BUTTON = C('#f4f0e2'), GOLD = [2.2, 1.5, 0.4], WIN = [2.4, 1.9, 0.6];
// a card, half its width and length, drawn a size up on life so it reads from across the room
const CW = 0.048, CD = 0.067, CT = 0.0014;
const DEAL_GAP = 0.13, FLY = 0.42, FLIP = 0.22;
// which way a propped card and a peeked card turn; a bench may change these to compare (tools/modelshop room-lab)
export const POKER_TUNE = { boardYaw: 0, lean: 1, peek: 1, peekYaw: Math.PI, bend: 1.45, bendFrom: 0.42, peekEnd: 1 };
// how many strips a bent card is drawn in along its length: enough that the curl reads as a curl
const BEND_STRIPS = 9;

// ── triangles, wound to face along `n` ───────────────────────────────────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function tri(b, a, c, d, n, col, mat) {
  const g = cross(sub(c, a), sub(d, a));
  if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0) [c, d] = [d, c];
  vtx(b, a, n, [0, 0], col, mat); vtx(b, c, n, [1, 0], col, mat); vtx(b, d, n, [1, 1], col, mat);
}
const quad = (b, a, c, d, e, n, col, mat) => { tri(b, a, c, d, n, col, mat); tri(b, a, d, e, n, col, mat); };

// A card's frame: `pos` [x, y, z] in the table's frame, `yaw` its turn on the felt, `flip` 0 back up to π face up,
// `tilt` a little lean while it flies. Gives a point (x across the card, h through it, z along it) in the room.
// `bend` { s, k }: the end of the card at z·s > 0 curled up off the felt, k 0 flat to 1 the most a thumb lifts it,
// as a player peeks at a hole card without picking it up. The far part stays flat on the baize.
function cardFrame(W, pos, yaw, flip, tilt = 0, bend = null) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cf = Math.cos(flip), sf = Math.sin(flip), ct = Math.cos(tilt), st = Math.sin(tilt);
  const curl = !!bend && bend.k > 0.001;
  const s0 = 2 * CD * POKER_TUNE.bendFrom, kap = curl ? (bend.k * POKER_TUNE.bend) / (2 * CD - s0) : 0;
  // how far the card has turned at z (0 on the flat part), and a point of the flat card moved onto the curl
  const angle = (z) => { const u = z * (bend?.s || 1) + CD; return curl && u > s0 ? kap * (u - s0) : 0; };
  const bent = (x, h, z) => {
    const a = angle(z);
    if (!a) return [x, h, z];
    const ua = s0 + Math.sin(a) / kap - h * Math.sin(a), ha = (1 - Math.cos(a)) / kap + h * Math.cos(a);
    return [x, ha, (ua - CD) * bend.s];
  };
  const loc0 = (x, h, z) => {
    // turned over about its own length, then leant along it, then turned on the felt
    let X = x * cf - h * sf, H = x * sf + h * cf, Z = z;
    const H2 = H * ct - Z * st; Z = H * st + Z * ct; H = H2;
    return [X * cy - Z * sy, H, X * sy + Z * cy];
  };
  const loc = (x, h, z) => loc0(...bent(x, h, z));
  const at = (x, h, z) => { const l = loc(x, h, z); return W(pos[0] + l[0], pos[1] + l[1], pos[2] + l[2]); };
  const dir = (x, h, z) => { const o = W(pos[0], pos[1], pos[2]), l = loc0(x, h, z), q = W(pos[0] + l[0], pos[1] + l[1], pos[2] + l[2]); return sub(q, o); };
  // the way the top (+h) faces at z along the card, turned with the curl
  const upAt = (z) => { const a = angle(z); return a ? dir(0, Math.cos(a), -bend.s * Math.sin(a)) : dir(0, 1, 0); };
  return { at, dir, upAt, curl };
}

// One card. Its back is on the top (+h), its face underneath, so turning it over (flip π) shows the face.
function drawCard(b, W, card, pos, yaw, flip, tilt = 0, glow = null, bend = null) {
  const { at, dir, upAt, curl } = cardFrame(W, pos, yaw, flip, tilt, bend);
  // a flat card has one normal each side; a bent one's turns with the curl, so each piece asks for its own
  const up = curl ? (z) => upAt(z) : dir(0, 1, 0);
  const dn = curl ? (z) => upAt(z).map((v) => -v) : dir(0, -1, 0);
  const N = (n, z) => (typeof n === 'function' ? n(z) : n);
  const box = (x0, x1, z0, z1, h, n, col, mat) => {
    // in strips along the card when it's bent, so the curl is a curve
    const k = curl && z1 - z0 > 0.01 ? BEND_STRIPS : 1;
    for (let i = 0; i < k; i++) {
      const za = z0 + (z1 - z0) * i / k, zb = z0 + (z1 - z0) * (i + 1) / k;
      quad(b, at(x0, h, za), at(x1, h, za), at(x1, h, zb), at(x0, h, zb), N(n, (za + zb) / 2), col, mat);
    }
  };
  // the back: oxblood with a gold line round it and a lozenge in the middle
  box(-CW, CW, -CD, CD, CT, up, BACK, MAT.GLOSS);
  const e = 0.004, l = 0.0013, hb = CT + 0.0002;
  for (const [x0, x1, z0, z1] of [[-CW + e, CW - e, -CD + e, -CD + e + l], [-CW + e, CW - e, CD - e - l, CD - e], [-CW + e, -CW + e + l, -CD + e, CD - e], [CW - e - l, CW - e, -CD + e, CD - e]]) box(x0, x1, z0, z1, hb, up, BACK_LINE, MAT.SATIN);
  quad(b, at(0, hb, -0.016), at(0.011, hb, 0), at(0, hb, 0.016), at(-0.011, hb, 0), N(up, 0), BACK_LINE, MAT.SATIN);
  // the edge, so a card lying flat has a thickness to catch the light
  for (const s of [-1, 1]) {
    const k = curl ? BEND_STRIPS : 1;
    for (let i = 0; i < k; i++) {
      const za = -CD + 2 * CD * i / k, zb = -CD + 2 * CD * (i + 1) / k;
      quad(b, at(s * CW, CT, za), at(s * CW, -CT, za), at(s * CW, -CT, zb), at(s * CW, CT, zb), dir(s, 0, 0), FACE, MAT.SATIN);
    }
    // the end: on a curled card it faces along the curl's last strip
    const zEnd = s * CD, endN = curl ? sub(at(0, 0, zEnd), at(0, 0, zEnd - s * 0.004)) : dir(0, 0, s);
    quad(b, at(-CW, CT, zEnd), at(CW, CT, zEnd), at(CW, -CT, zEnd), at(-CW, -CT, zEnd), endN, FACE, MAT.SATIN);
  }
  // the face
  box(-CW, CW, -CD, CD, -CT, dn, glow ? [FACE[0] * 1.15, FACE[1] * 1.1, FACE[2] * 0.95] : FACE, MAT.SATIN);
  if (!card) return;
  // a four-colour deck, so a suit reads by its colour from across the room before its shape does
  const ink = SUIT_INK[card.suit] || BLACK, hf = -CT - 0.0002, hl = -CT - 0.0001;
  // a thin frame in the suit's ink just inside the edge
  const fe = 0.0035, fl = 0.0009, frame = [ink[0] * 0.5 + FACE[0] * 0.5, ink[1] * 0.5 + FACE[1] * 0.5, ink[2] * 0.5 + FACE[2] * 0.5];
  for (const [x0, x1, z0, z1] of [[-CW + fe, CW - fe, -CD + fe, -CD + fe + fl], [-CW + fe, CW - fe, CD - fe - fl, CD - fe], [-CW + fe, -CW + fe + fl, -CD + fe, CD - fe], [CW - fe - fl, CW - fe, -CD + fe, CD - fe]]) box(x0, x1, z0, z1, hl, dn, frame, MAT.MATTE);
  // the face's own frame: x across it, z down it from the index corner (turning the card over carries it round)
  const P = (x, z) => at(x, hf, z);
  const rank = String(card.rank || '?').toUpperCase().replace('T', '10');
  // a big, heavy index: the rank is what you read first
  glyphs(b, P, rank, -CW + 0.0075, -CD + 0.0075, 0.027, ink, dn, 1.35);
  // the mirrored corner's own z runs the other way along the card
  const dnM = typeof dn === 'function' ? (z) => dn(-z) : dn;
  glyphs(b, (x, z) => P(-x, -z), rank, -CW + 0.0075, -CD + 0.0075, 0.027, ink, dnM, 1.35);
  pip(b, P, card.suit, -CW + 0.0075 + 0.0075, -CD + 0.045, 0.0075, ink, dn);
  // the suit in the other corner too, as a real deck has it: whichever end you lift, there's the rank and the suit
  pip(b, (x, z) => P(-x, -z), card.suit, -CW + 0.0075 + 0.0075, -CD + 0.045, 0.0075, ink, dnM);
  pip(b, P, card.suit, 0, 0.002, 0.02, ink, dn);
}

// A string in the legend face (client/shared/legend-font.js), its foot along +z at (x0, z0), `h` tall.
function glyphs(b, P, str, x0, z0, h, col, n0, weight = 1) {
  const n = typeof n0 === 'function' ? n0(z0 + h / 2) : n0;
  const g = h / 6, w = 0.9 * g * weight, adv = (str.length > 1 ? 3.6 : 5) * g, narrow = str.length > 1 ? 0.7 : 1;
  [...str].forEach((ch, i) => {
    for (const [ax, ay, bx, by] of LEGEND_STROKES[ch] || []) {
      // grid x across, y up the letter; up the letter is toward -z, the card's top
      const x1 = x0 + i * adv + ax * g * narrow, z1 = z0 + (6 - ay) * g, x2 = x0 + i * adv + bx * g * narrow, z2 = z0 + (6 - by) * g;
      const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz) || 1, nx = -dz / L * w / 2, nz = dx / L * w / 2;
      const ex = dx / L * w / 2, ez = dz / L * w / 2;
      quad(b, P(x1 - ex + nx, z1 - ez + nz), P(x2 + ex + nx, z2 + ez + nz), P(x2 + ex - nx, z2 + ez - nz), P(x1 - ex - nx, z1 - ez - nz), n, col, MAT.MATTE);
    }
  });
}
// A suit's pip, `r` its half size, centred at (x, z), its point toward -z for a spade and +z for a heart.
function pip(b, P, suit, x, z, r, col, n0) {
  const n = typeof n0 === 'function' ? n0(z) : n0;
  const fan = (cx, cz, rr, from = 0, to = TAU, seg = 10) => {
    for (let i = 0; i < seg; i++) {
      const a0 = from + (to - from) * i / seg, a1 = from + (to - from) * (i + 1) / seg;
      tri(b, P(cx, cz), P(cx + Math.cos(a0) * rr, cz + Math.sin(a0) * rr), P(cx + Math.cos(a1) * rr, cz + Math.sin(a1) * rr), n, col, MAT.MATTE);
    }
  };
  if (suit === 'd') { quad(b, P(x, z - r * 1.2), P(x + r * 0.8, z), P(x, z + r * 1.2), P(x - r * 0.8, z), n, col, MAT.MATTE); return; }
  if (suit === 'h') {
    fan(x - r * 0.5, z - r * 0.25, r * 0.55); fan(x + r * 0.5, z - r * 0.25, r * 0.55);
    tri(b, P(x - r * 1.04, z - r * 0.1), P(x + r * 1.04, z - r * 0.1), P(x, z + r * 1.1), n, col, MAT.MATTE);
    return;
  }
  if (suit === 's') {
    fan(x - r * 0.5, z + r * 0.25, r * 0.55); fan(x + r * 0.5, z + r * 0.25, r * 0.55);
    tri(b, P(x - r * 1.04, z + r * 0.1), P(x + r * 1.04, z + r * 0.1), P(x, z - r * 1.1), n, col, MAT.MATTE);
  } else {
    fan(x, z - r * 0.5, r * 0.48); fan(x - r * 0.55, z + r * 0.2, r * 0.48); fan(x + r * 0.55, z + r * 0.2, r * 0.48);
  }
  // the stem and its foot
  quad(b, P(x - r * 0.12, z), P(x + r * 0.12, z), P(x + r * 0.12, z + r * 1.0), P(x - r * 0.12, z + r * 1.0), n, col, MAT.MATTE);
  quad(b, P(x - r * 0.45, z + r * 0.9), P(x + r * 0.45, z + r * 0.9), P(x + r * 0.45, z + r * 1.1), P(x - r * 0.45, z + r * 1.1), n, col, MAT.MATTE);
}

// A chip, its foot at (x, y, z) in the table's frame: a coloured edge with white stripes round it and a face on top.
const CHIP_R = 0.026, CHIP_H = 0.0055;
function chip(b, W, x, y, z, col, top = true, emis = null) {
  const seg = 12, ring = (yy, rr) => Array.from({ length: seg }, (_, j) => { const a = j / seg * TAU; return [x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr]; });
  const lo = ring(y, CHIP_R), hi = ring(y + CHIP_H, CHIP_R);
  for (let j = 0; j < seg; j++) {
    const k = (j + 1) % seg, a = (j + 0.5) / seg * TAU, n = sub(W(x + Math.cos(a), y, z + Math.sin(a)), W(x, y, z));
    quad(b, W(...lo[j]), W(...lo[k]), W(...hi[k]), W(...hi[j]), n, emis || (j % 3 === 0 ? STRIPE : col), emis ? MAT.EMISSIVE : MAT.SATIN);
  }
  if (!top) return;
  const up = sub(W(x, y + 1, z), W(x, y, z)), c = W(x, y + CHIP_H, z), inner = ring(y + CHIP_H, CHIP_R * 0.62);
  for (let j = 0; j < seg; j++) {
    const k = (j + 1) % seg;
    tri(b, c, W(...inner[j]), W(...inner[k]), up, col, MAT.GLOSS);
    quad(b, W(...inner[j]), W(...hi[j]), W(...hi[k]), W(...inner[k]), up, j % 2 ? STRIPE : col, MAT.GLOSS);
  }
}
// A sum of credits as stacks of chips side by side, the biggest denominations first, so a big stack looks big.
function stacks(b, W, x, y, z, amount, across = [1, 0], cap = 18, emis = null) {
  let left = Math.max(0, Math.round(amount)), s = 0;
  for (const d of [500, 100, 25, 5, 1]) {
    let n = Math.min(cap, Math.floor(left / d));
    if (!n) continue;
    left -= n * d;
    const sx = x + across[0] * s * CHIP_R * 2.2, sz = z + across[1] * s * CHIP_R * 2.2;
    for (let i = 0; i < n; i++) chip(b, W, sx + Math.sin(i * 2.3) * 0.0012, y + i * CHIP_H, sz + Math.cos(i * 1.7) * 0.0012, CHIP[d], i === n - 1, emis);
    if (++s >= 5) break;
  }
}
// a flat ring on the felt, glowing: the seat to act, a winner
function glowRing(b, W, x, y, z, r, col) {
  const seg = 24, up = sub(W(x, y + 1, z), W(x, y, z));
  for (let j = 0; j < seg; j++) {
    const a0 = j / seg * TAU, a1 = (j + 1) / seg * TAU, P = (a, rr) => W(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr * 0.8);
    quad(b, P(a0, r), P(a1, r), P(a1, r * 0.86), P(a0, r * 0.86), up, col, MAT.EMISSIVE);
  }
}

// The table's frame, as gl/room-decor.js builds the `poker` form in: x along it, z across (−z the dealer's end), y up
// from the felt. `rel` is a point of the room in it.
function tableFrame(L, p) {
  const [fu, fv] = facing(p.turn), su = -fv, sv = fu, top = (p.y0 || 0) + (p.rise || 0) + p.h + 0.041;
  const W = (x, y, z) => L.world(p.u + su * x + fu * z, p.v + sv * x + fv * z, top + y);
  const rel = (u, v) => [(u - p.u) * su + (v - p.v) * sv, (u - p.u) * fu + (v - p.v) * fv];
  return { W, rel, hw: p.w / 2, hd: p.d / 2 };
}

const memo = new Map();
// Where your own two cards are in the room this frame, or null: the Stage pins its lens on them (gl/room-dof.js), so
// they're never the thing that's blurred.
let mineAt = null;
export const pokerMineAt = () => mineAt;
// Where the table's controls hang this frame (room-stage.js pins its hotspots there): your cards, your stack, the
// spot your bet goes out to and where you'd muck, the pot, the middle of the felt, and each empty seat. World points.
let anchors = null;
export const pokerAnchors = () => anchors;
// Into `b`: every poker felt in the room. `pieces` the room's pieces (each `board` the server's state), `mine` your
// own hole cards and how far you're peeking at them ({ id, cards, peek 0..1 }), `eye` where you are ([u, v]) so the
// board and a shown hand stand up toward you wherever you sit, `t` the frame's clock in seconds.
export function pokerProps(b, L, pieces, mine, t, eye = null) {
  mineAt = null; anchors = null;
  for (const p of L.placed || []) {
    if (p.form !== 'poker') continue;
    const st = pieces.find((q) => q.id === p.id)?.board;
    if (!st?.poker) continue;
    drawFelt(b, L, p, st, mine, t, eye);
  }
  return b;
}
// Whether any felt in the room has something on it, so the props layer is posed while it does.
export const pokerLive = (pieces) => pieces.some((q) => q.board?.poker);

function drawFelt(b, L, p, st, mine, t, eye) {
  const { W, rel, hw, hd } = tableFrame(L, p);
  // which way you look at the table from: the board turns to you, and is laid left to right as you see it
  const ev = eye ? rel(eye[0], eye[1]) : [0, hd + 1];
  const vYaw = Math.atan2(ev[0], ev[1]), vAcross = [Math.cos(vYaw), -Math.sin(vYaw)];
  // a card stood up toward you on its near edge, `lean` radians off the felt, as a dealer props a board to read
  const propped = (card, x, z, yaw, lean, flip = Math.PI, glow = null) => {
    const hz = CD * (1 - Math.cos(lean)), hy = CD * Math.sin(lean);
    const y2 = yaw + POKER_TUNE.boardYaw;
    drawCard(b, W, card, [x - hz * Math.sin(yaw), 0.0012 + hy, z + hz * Math.cos(yaw)], y2, flip, -lean * POKER_TUNE.lean, glow);
  };
  // each seat's place on the felt: toward its chair, inside the rail
  const spot = (i) => {
    const chair = st.chairs?.[i] && L.placed.find((q) => q.id === st.chairs[i]);
    let [x, z] = chair ? rel(chair.u, chair.v) : [Math.cos(i / 6 * TAU) * hw, Math.sin(i / 6 * TAU) * hd];
    const k = Math.hypot(x, z) || 1, dx = x / k, dz = z / k;
    x = Math.max(-(hw - 0.36), Math.min(hw - 0.36, x)); z = Math.max(-(hd - 0.32), Math.min(hd - 0.32, z));
    return { x, z, dx, dz, yaw: Math.atan2(dx, dz) };
  };
  const deck = [-0.2, 0.04, -hd + 0.4];
  // what started when, this table: the hand's deal, and each board card's arrival
  let m = memo.get(p.id);
  if (!m || m.hand !== st.hand) {
    // a fresh page (or first sight of a hand already dealt) shows it as it is, without dealing it again
    const fresh = !!m && st.hand > 0;
    m = { hand: st.hand, dealt: fresh ? t : -1e9, board: [], boardN: (st.board || []).length, win: -1e9 };
    if (!fresh) m.board = (st.board || []).map(() => -1e9);
    memo.set(p.id, m);
  }
  while (m.board.length < (st.board || []).length) m.board.push(t + (m.board.length - m.boardN >= 0 ? (m.board.length - m.boardN) * 0.18 : 0));
  if (m.board.length > (st.board || []).length) m.board.length = (st.board || []).length;
  m.boardN = m.board.length;
  if (st.phase === 'HandComplete' && m.winHand !== st.hand) { m.winHand = st.hand; m.win = t; }

  const seated = (st.seats || []).map((s, i) => (s ? { s, i } : null)).filter(Boolean);
  if (!anchors) {
    anchors = { pot: W(-0.02, 0.03, -0.17), mid: W(0, 0.02, 0.02), open: [], me: null };
    (st.seats || []).forEach((s, i) => { if (!s) { const q = spot(i); anchors.open.push(W(q.x, 0.05, q.z)); } });
    const mi = mine ? (st.seats || []).findIndex((s) => s && s.id === mine.id) : -1;
    if (mi >= 0) {
      const q = spot(mi), across = [Math.cos(q.yaw), -Math.sin(q.yaw)];
      anchors.me = {
        cards: W(q.x, 0.02, q.z),
        stack: W(q.x + across[0] * 0.13 - q.dx * 0.02, 0.05, q.z + across[1] * 0.13 - q.dz * 0.02),
        bet: W(q.x - q.dx * 0.24, 0.02, q.z - q.dz * 0.24),
        muck: W(q.x - across[0] * 0.17, 0.02, q.z - across[1] * 0.17),
      };
    }
  }
  // who was dealt in, in the order the cards went round (the deck itself is the decor's, at the dealer's end)
  const order = seated.filter(({ s }) => s.holding || s.folded);

  seated.forEach(({ s, i }) => {
    const q = spot(i), me = mine && s.id === mine.id;
    const across = [Math.cos(q.yaw), -Math.sin(q.yaw)];
    // the stack beside the cards, the bet pushed out toward the middle
    const sx = q.x + across[0] * 0.13 - q.dx * 0.02, sz = q.z + across[1] * 0.13 - q.dz * 0.02;
    const won = s.won && st.phase === 'HandComplete', pulse = won ? 0.6 + 0.4 * Math.sin((t - m.win) * 6) : 0;
    stacks(b, W, sx, 0, sz, s.chips, [-q.dx, -q.dz], 14, won && t - m.win < 4 ? WIN.map((c) => c * pulse) : null);
    if (s.bet) stacks(b, W, q.x - q.dx * 0.24, 0, q.z - q.dz * 0.24, s.bet, across, 8);
    // the button
    if (s.button) {
      const bx = q.x - across[0] * 0.14 - q.dx * 0.06, bz = q.z - across[1] * 0.14 - q.dz * 0.06;
      chip(b, W, bx, 0, bz, BUTTON, true);
      glyphs(b, (x, z) => W(bx + x, CHIP_H + 0.0004, bz + z), 'D', -0.006, -0.009, 0.018, BLACK, sub(W(bx, 1, bz), W(bx, 0, bz)));
    }
    // the seat to act: a ring breathing on the felt in front of them
    if (s.acting) glowRing(b, W, q.x - q.dx * 0.05, 0.0006, q.z - q.dz * 0.05, 0.13, GOLD.map((c) => c * (0.55 + 0.45 * Math.sin(t * 5))));
    if (won && t - m.win < 6) glowRing(b, W, q.x, 0.0006, q.z, 0.17, WIN.map((c) => c * pulse));
    // their two cards: off the deck in turn round the table, two rounds, then lying in front of them
    const n = s.holding;
    const k = order.findIndex((o) => o.i === i);
    for (let c = 0; c < n; c++) {
      const start = m.dealt + (c * order.length + k) * DEAL_GAP, u = (t - start) / FLY;
      if (u < 0) continue;
      const rest = [q.x + (c - 0.5) * CW * 1.5 * Math.cos(q.yaw), 0.0012 + c * 0.0025, q.z - (c - 0.5) * CW * 1.5 * Math.sin(q.yaw)];
      const face = me ? mine.cards?.[c] : s.shown?.[c];
      if (me && c === 0) mineAt = W(rest[0], rest[1] + 0.03 * (mine.peek || 0), rest[2]);
      if (u < 1) {
        const e = u * u * (3 - 2 * u), arc = Math.sin(Math.PI * u) * 0.12;
        const pos = [deck[0] + (rest[0] - deck[0]) * e, deck[1] + (rest[1] - deck[1]) * e + arc, deck[2] + (rest[2] - deck[2]) * e];
        drawCard(b, W, null, pos, q.yaw + (1 - e) * TAU * 1.5, 0, 0.3 * Math.sin(Math.PI * u));
        continue;
      }
      // a shown hand turns over and stands up toward you, so you can read it from any seat
      const shown = s.shown?.[c];
      if (shown) {
        const fu = Math.min(1, (t - m.win) / FLIP), e = fu * fu * (3 - 2 * fu);
        propped(shown, rest[0], rest[2], vYaw + (c - 0.5) * 0.12, 0.55 * e, Math.PI * e, won ? 1 : null);
        continue;
      }
      // yours, face down until you peek: then, as a player does, the near end of each is thumbed up off the baize
      // and curls back toward you, its far end still on the felt, so you see the index in its corner and the rest
      // of the table sees a card back. The second lifts a beat after the first.
      const pk = me ? Math.max(0, Math.min(1, mine.peek || 0)) : 0;
      const yaw = q.yaw + (c - 0.5) * 0.18;
      if (pk > 0.001 && face) {
        const kc = Math.max(0, Math.min(1, pk * 1.25 - c * 0.25)), e = kc * kc * (3 - 2 * kc);
        // which end is yours: the card's +z or its −z, whichever points at your chair
        const sgn = -Math.sin(yaw) * q.dx + Math.cos(yaw) * q.dz >= 0 ? 1 : -1;
        drawCard(b, W, face, rest, yaw, 0, 0, null, { s: sgn * POKER_TUNE.peekEnd, k: e * POKER_TUNE.peek });
      } else drawCard(b, W, null, rest, yaw, 0, 0, won ? 1 : null);
    }
  });

  // the board down the middle, from the dealer's side, each card flying out and turning over
  (st.board || []).forEach((card, j) => {
    const off = (j - 2) * CW * 2.35, rest = [off * vAcross[0], 0.0012, 0.02 + off * vAcross[1]], start = m.board[j] ?? -1e9, u = (t - start) / FLY;
    if (u < 0) return;
    if (u < 1) {
      const e = u * u * (3 - 2 * u), pos = [deck[0] + (rest[0] - deck[0]) * e, deck[1] + (rest[1] - deck[1]) * e + Math.sin(Math.PI * u) * 0.1, deck[2] + (rest[2] - deck[2]) * e];
      drawCard(b, W, card, pos, Math.PI + (1 - e) * 2, 0, 0.2 * Math.sin(Math.PI * u));
      return;
    }
    const f = Math.min(1, (t - start - FLY) / FLIP), e = f * f * (3 - 2 * f);
    // turned over, then propped up toward you; a winning board card glows at the showdown
    propped(card, rest[0], rest[2] + Math.sin(Math.PI * f) * 0.0, vYaw, 0.42 * e, Math.PI * e);
  });
  // the pot, beside the board on the dealer's side
  // (the pot counts this street's bets, which are still out in front of each seat)
  const inPot = (st.pot || 0) - (st.seats || []).reduce((n, s) => n + (s?.bet || 0), 0);
  if (inPot > 0) stacks(b, W, -0.02, 0, -0.17, inPot, [1, 0], 16);
}
