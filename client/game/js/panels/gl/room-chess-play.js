// PLAYING ON A ROOM'S CHESSBOARD with the mouse, in the Room Stage and in a room walked in GLASS alike. The board
// and its men are the room's own mesh (gl/room-chess.js, off the position the server sends on the piece as `board`);
// this is only the hand: which square is under the pointer, the man you've picked up, and the move it makes.
//
// Two ways to move, both ending in the typed `chessmove e2e4`: press on one of your men and drag it to its square
// and let go, or click it (it lifts) and click where it goes. Clicking it again, or off the board, or Escape puts it
// back. The man you're holding is taken off the board in the mesh (`lift`), drawn in your hand over the square
// under the pointer, and the server's answer (room_board) puts the real position back either way.
//
// ⚠ IT DECIDES NOTHING. A move it sends that isn't legal is refused by the server like a typed one. It knows the
// board's frame (gl/room-decor.js `games`: the board is 0.66 of the top, a1 at +x +z, White at the front) and
// nothing about any table or any person.

import { vtx, lin, MAT } from './ballpark-mesh.js';
import { facing } from '../../../../shared/room-layout.js';
import { PROFILE } from './room-chess.js';

const FILES = 'abcdefgh';
const BOX = lin('#e6cf9f'), EBONY = lin('#1d1713'), FROM = [1.8, 1.4, 0.5], OVER = [0.6, 1.6, 0.9];
const LIFT = 0.05;   // how high a held man is carried over the board, metres

// The board's frame on a `games` piece: x across, z out of its front, y up from the board's face. `sq` a square's
// side, `half` half the board.
function boardFrame(L, p) {
  const [fu, fv] = facing(p.turn), su = -fv, sv = fu, top = (p.y0 || 0) + (p.rise || 0) + p.h + 0.005;
  const side = Math.min(p.w, p.d) * 0.66;
  const W = (x, y, z) => L.world(p.u + su * x + fu * z, p.v + sv * x + fv * z, top + y);
  return { W, sq: side / 8, half: side / 2 };
}
// a square's middle in the board's frame: file 0..7 from a, rank 0..7 from 1
const mid = (B, f, R) => [B.half - (f + 0.5) * B.sq, B.half - (R + 0.5) * B.sq];
const sqName = (f, R) => FILES[f] + (R + 1);
const charAt = (board, f, R) => board[(7 - R) * 8 + f];

// The tables in a room with a position on them: [{ p (the placed piece), st (its board) }].
function tables(L, pieces) {
  const out = [];
  for (const p of L?.placed || []) {
    if (p.form !== 'games') continue;
    const st = (pieces || []).find((q) => String(q.id) === String(p.id))?.board || p.board;
    if (st && typeof st.board === 'string' && st.board.length === 64) out.push({ p, st });
  }
  return out;
}

// The square under (x, y) in a w by h picture, or null. `project(point, w, h)` is the view's own ({ x, y } or null).
export function chessSquareAt(L, pieces, project, x, y, w, h) {
  for (const { p, st } of tables(L, pieces)) {
    const B = boardFrame(L, p);
    for (let f = 0; f < 8; f++) for (let R = 0; R < 8; R++) {
      const x1 = B.half - f * B.sq, x0 = x1 - B.sq, z1 = B.half - R * B.sq, z0 = z1 - B.sq;
      const q = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([a, c]) => project(B.W(a, 0, c), w, h));
      if (q.some((v) => !v)) continue;
      if (inQuad(q, x, y)) return { piece: p.id, sq: sqName(f, R), f, R, st };
    }
  }
  return null;
}
function inQuad(q, x, y) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (c === 0) continue;
    if (s && Math.sign(c) !== s) return false;
    s = Math.sign(c);
  }
  return true;
}

// Whether any table in the room has a game the player `you` is in.
export function chessPlaying(pieces, you) {
  return (pieces || []).some((q) => q.board?.board && !q.board.over && you != null && (q.board.white === you || q.board.black === you));
}

// ── the hand ─────────────────────────────────────────────────────────────────────────────────────────────────────
// `send(cmd)` sends a typed verb; `lift(pieceId, boardString|null)` shows that table with this board (null: the
// server's own) by building the room again; `flash(text)` says something short. Returns the hand: press/move/up take
// the square under the pointer (chessSquareAt) and say whether they took the event; `hold` is what's held, for the
// props (chessHandProps).
export function createChessHand({ send, lift, flash = () => {} }) {
  const H = {
    hold: null,
    // a press: true when the hand took it (the view doesn't turn or click on it)
    press(hit, you, x, y) {
      if (H.hold) { H.hold.press = { hit, x, y }; return true; }
      if (!hit || you == null) return false;
      const st = hit.st, mine = st.white === you ? 'w' : st.black === you ? 'b' : null;
      if (!mine || st.over) return false;
      const ch = charAt(st.board, hit.f, hit.R);
      if (!ch || ch === '.') return false;
      const own = (ch === ch.toUpperCase()) === (mine === 'w');
      if (!own) return false;
      if (st.turn !== mine) { flash("It isn't your move."); return true; }
      const idx = (7 - hit.R) * 8 + hit.f;
      H.hold = { piece: hit.piece, from: hit.sq, f: hit.f, R: hit.R, ch, over: hit, x0: x, y0: y, dragged: false, fresh: true, ver: 0 };
      lift(hit.piece, st.board.slice(0, idx) + '.' + st.board.slice(idx + 1));
      return true;
    },
    move(hit, x, y) {
      const h = H.hold;
      if (!h) return false;
      if (Math.hypot(x - h.x0, y - h.y0) > 6) h.dragged = true;
      const was = h.over?.sq;
      h.over = hit && hit.piece === h.piece ? hit : null;
      if (h.over?.sq !== was) h.ver++;
      return true;
    },
    up(hit) {
      const h = H.hold;
      if (!h) return false;
      const to = hit && hit.piece === h.piece ? hit : null;
      if (h.fresh) {
        h.fresh = false;
        // dragged off its square and let go: the move. A click: it stays in your hand till the next click
        if (h.dragged) { if (to && to.sq !== h.from) H.drop(to); else H.cancel(); }
        return true;
      }
      if (!to || to.sq === h.from) H.cancel(); else H.drop(to);
      return true;
    },
    drop(to) {
      const h = H.hold;
      H.hold = null;
      lift(h.piece, null);
      // a pawn on the last rank becomes a queen; the typed verb takes the letter for anything else
      const promo = (h.ch === 'P' && to.R === 7) || (h.ch === 'p' && to.R === 0) ? 'q' : '';
      send(`chessmove ${h.from}${to.sq}${promo}`);
    },
    cancel() {
      const h = H.hold;
      if (!h) return false;
      H.hold = null;
      lift(h.piece, null);
      return true;
    },
  };
  return H;
}

// Into `b`: the man in your hand over the square under the pointer (or over his own), a ring on the square he came
// from and on the one under him. `t` the frame's clock in seconds, for a little sway.
export function chessHandProps(b, L, hand, t = 0) {
  const h = hand?.hold;
  if (!h) return b;
  const p = (L?.placed || []).find((q) => String(q.id) === String(h.piece));
  if (!p) return b;
  const B = boardFrame(L, p);
  ring(b, B, h.f, h.R, FROM);
  const at = h.over || h;
  if (h.over && h.over.sq !== h.from) ring(b, B, at.f, at.R, OVER);
  const [x, z] = mid(B, at.f, at.R);
  const prof = PROFILE[h.ch.toLowerCase()];
  if (prof) lathe(b, B, x, LIFT + Math.sin(t * 3) * 0.004, z, prof, B.sq, h.ch === h.ch.toUpperCase() ? BOX : EBONY);
  return b;
}

// ── somebody else's hand: a man moved by a player the server runs ───────────────────────────────────────────────────
// When a position comes in whose last move was a computer player's (`white`/`black` a `chessbot:<npc id>`), the move
// is played out by that person's hand before the board shows it: the arm goes out to the man (REACH), the fingers close
// on him and he comes up off his square (the board shown without him), he's carried over in a low arc (CARRY) and set
// down (the server's board shown), and the arm comes back (BACK). The hand's way is worked out every frame from the
// board's own frame and the clock, so it goes wherever the man is and whoever's reaching; the figure's arm gets there
// by its own reach (gl/figure-reach.js, through `body.reach`).
//
// `show(pieceId, board|null)`: draw that table with this board string, null for the server's. One move at a time per
// table; a new position while one's playing finishes it at once.
const REACH = 0.7, CARRY = 0.85, BACK = 0.6, ARC = 0.07;
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export function createChessActs({ show }) {
  const acts = new Map();   // piece id -> { npc, from: [f,R], to: [f,R], ch, prev, t0, lifted, placed }
  const sqOf = (a) => [FILES.indexOf(a[0]), Number(a[1]) - 1];
  const A = {
    // the server's new position for a table: true when it's being played out (the caller keeps showing `prev` till
    // show() says otherwise)
    board(pieceId, prev, next, now) {
      const was = acts.get(pieceId);
      if (was) { acts.delete(pieceId); show(pieceId, null); }
      if (!prev?.board || !next?.board || !Array.isArray(next.last) || prev.board === next.board || next.practice) return false;
      // who moved: the side that isn't to move now
      const who = next.turn === 'w' ? next.black : next.white;
      if (typeof who !== 'string' || !who.startsWith('chessbot:')) return false;
      const from = sqOf(next.last[0]), to = sqOf(next.last[1]);
      if (from[0] < 0 || to[0] < 0) return false;
      const ch = charAt(prev.board, from[0], from[1]);
      if (!ch || ch === '.') return false;
      acts.set(pieceId, { npc: who.slice(9), from, to, ch, prev: prev.board, t0: now, lifted: false, placed: false });
      show(pieceId, prev.board);
      return true;
    },
    // this frame: { reach: Map npc id -> { side, w, k }, carry: [{ piece, ch, x, y, z }] } (board-frame points for
    // chessCarryProps). Moves the shown board on at the grab and the set-down.
    frame(L, now) {
      const reach = new Map(), carry = [];
      for (const [id, a] of acts) {
        const p = (L?.placed || []).find((q) => String(q.id) === String(id));
        if (!p) { acts.delete(id); show(id, null); continue; }
        const B = boardFrame(L, p), t = (now - a.t0) / 1000;
        const [fx, fz] = mid(B, a.from[0], a.from[1]), [tx, tz] = mid(B, a.to[0], a.to[1]);
        const prof = PROFILE[a.ch.toLowerCase()], top = (prof ? prof[prof.length - 1][1] : 1) * B.sq * 0.85;
        let x = fx, z = fz, y = 0, k;
        if (t < REACH) k = ease(t / REACH);
        else if (t < REACH + CARRY) {
          if (!a.lifted) { a.lifted = true; const i = (7 - a.from[1]) * 8 + a.from[0]; show(id, a.prev.slice(0, i) + '.' + a.prev.slice(i + 1)); }
          const c = ease((t - REACH) / CARRY);
          x = fx + (tx - fx) * c; z = fz + (tz - fz) * c; y = Math.sin(c * Math.PI) * ARC; k = 1;
          carry.push({ piece: id, ch: a.ch, x, y, z });
        } else if (t < REACH + CARRY + BACK) {
          if (!a.placed) { a.placed = true; show(id, null); }
          x = tx; z = tz; k = 1 - ease((t - REACH - CARRY) / BACK);
        } else { acts.delete(id); if (!a.placed) show(id, null); continue; }
        // with the right hand, the pinch at the man's crown
        reach.set(a.npc, { side: 'R', w: B.W(x, y + top, z), k });
      }
      return { reach, carry };
    },
    busy: () => acts.size > 0,
    clear() { for (const id of acts.keys()) show(id, null); acts.clear(); },
  };
  return A;
}
// Into `b`: the men being carried this frame (createChessActs().frame's `carry`).
export function chessCarryProps(b, L, carry) {
  for (const c of carry || []) {
    const p = (L?.placed || []).find((q) => String(q.id) === String(c.piece));
    const prof = p && PROFILE[c.ch.toLowerCase()];
    if (!prof) continue;
    const B = boardFrame(L, p);
    lathe(b, B, c.x, c.y, c.z, prof, B.sq, c.ch === c.ch.toUpperCase() ? BOX : EBONY);
  }
  return b;
}

// a glowing square outline, just over the board's face
function ring(b, B, f, R, col) {
  const x1 = B.half - f * B.sq, x0 = x1 - B.sq, z1 = B.half - R * B.sq, z0 = z1 - B.sq, e = B.sq * 0.08, y = 0.0015;
  const up = sub(B.W(0, 1, 0), B.W(0, 0, 0));
  const bar = (a0, a1, c0, c1) => quad(b, B.W(a0, y, c0), B.W(a1, y, c0), B.W(a1, y, c1), B.W(a0, y, c1), up, col, MAT.EMISSIVE);
  bar(x0, x1, z0, z0 + e); bar(x0, x1, z1 - e, z1); bar(x0, x0 + e, z0 + e, z1 - e); bar(x1 - e, x1, z0 + e, z1 - e);
}
// a turned man from its profile ([radius, height] in squares), standing at (x, y, z) in the board's frame
function lathe(b, B, x, y, z, prof, sq, col) {
  const seg = 14;
  for (let i = 0; i + 1 < prof.length; i++) {
    const [r0, h0] = prof[i], [r1, h1] = prof[i + 1];
    for (let j = 0; j < seg; j++) {
      const a0 = j / seg * Math.PI * 2, a1 = (j + 1) / seg * Math.PI * 2, am = (a0 + a1) / 2;
      const P = (r, hh, a) => B.W(x + Math.cos(a) * r * sq, y + hh * sq, z + Math.sin(a) * r * sq);
      const n = sub(B.W(x + Math.cos(am) * (h1 - h0), (r0 - r1) * 1, z + Math.sin(am) * (h1 - h0)), B.W(x, 0, z));
      quad(b, P(r0, h0, a0), P(r0, h0, a1), P(r1, h1, a1), P(r1, h1, a0), n, col, MAT.SATIN);
    }
  }
  // the top shut
  const [rt, ht] = prof[prof.length - 1];
  if (rt > 0) for (let j = 0; j < seg; j++) {
    const a0 = j / seg * Math.PI * 2, a1 = (j + 1) / seg * Math.PI * 2, c = B.W(x, y + ht * sq, z);
    tri(b, c, B.W(x + Math.cos(a0) * rt * sq, y + ht * sq, z + Math.sin(a0) * rt * sq), B.W(x + Math.cos(a1) * rt * sq, y + ht * sq, z + Math.sin(a1) * rt * sq), sub(B.W(0, 1, 0), B.W(0, 0, 0)), col, MAT.SATIN);
  }
}

const sub = (a, c) => [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
const cross = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
function tri(b, a, c, d, n, col, mat) {
  const g = cross(sub(c, a), sub(d, a));
  if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0) [c, d] = [d, c];
  vtx(b, a, n, [0, 0], col, mat); vtx(b, c, n, [1, 0], col, mat); vtx(b, d, n, [1, 1], col, mat);
}
const quad = (b, a, c, d, e, n, col, mat) => { tri(b, a, c, d, n, col, mat); tri(b, a, d, e, n, col, mat); };

export const _test = { boardFrame, charAt, sqName, inQuad };
