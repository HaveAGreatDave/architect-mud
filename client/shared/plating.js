// PLATING: how well a plate is laid out, as a pure function of where things were put on it.
//
// The Kitchen Stage's pass (client/game/js/panels/kitchen-stage.js) lets a cook place each part of
// a dish on the plate and draw a line of sauce, then sends this score with `dressresolve`; the
// cooking plugin turns it into a presentation bonus at `plate` (docs/proposals/kitchen-stage.md).
//
// What it rewards, plainly:
//   balance  the food's weight sits on the middle of the plate or on a third of the way out
//   rim      nothing hangs over the rim, and the outer fifth stays clear
//   room     pieces don't sit on top of each other
//   together the parts are grouped, not scattered round the plate
//   sauce    a line of sauce, where the dish takes one, kept off the rim
//
// Positions are centimetres from the plate's middle. Each item is { x, y, r }: a circle the size of
// the piece seen from above. ⚠ NO WALL CLOCK, NO RANDOMNESS, NO DOM.

const W = { balance: 0.3, rim: 0.25, room: 0.2, together: 0.15, sauce: 0.1 };

export function presentation(items, { plateR = 13, sauce = null, wantsSauce = false } = {}) {
  const on = (items || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.r > 0);
  if (!on.length) return 0;
  const R = plateR;
  // balance: the area-weighted middle, against the nearer of the centre and the thirds ring
  let ax = 0, ay = 0, A = 0;
  for (const p of on) { const a = p.r * p.r; ax += p.x * a; ay += p.y * a; A += a; }
  const cx = ax / A, cy = ay / A, d = Math.hypot(cx, cy);
  const off = Math.min(d, Math.abs(d - R / 3));
  const balance = clamp01(1 - off / (R * 0.35));
  // rim: the share of pieces wholly inside 0.8 R
  const rim = on.filter((p) => Math.hypot(p.x, p.y) + p.r <= R * 0.8).length / on.length;
  // room: overlap between pieces, as a share of their area
  let over = 0;
  for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
    const a = on[i], b = on[j], g = a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y);
    if (g > 0) over += Math.min(g, 2 * Math.min(a.r, b.r)) / (2 * Math.min(a.r, b.r));
  }
  const pairs = (on.length * (on.length - 1)) / 2;
  const room = pairs ? clamp01(1 - over / pairs * 1.5) : 1;
  // together: how close the pieces sit to their own middle
  const spread = on.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / on.length;
  const together = on.length > 1 ? clamp01(1 - (spread - R * 0.25) / (R * 0.4)) : 1;
  // sauce: a line of at least a few points, all inside 0.85 R. A dish with no sauce asks for none,
  // and drawing one anyway costs the same as leaving one off a dish that wanted it.
  const line = (sauce || []).filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
  const drawn = line.length >= 4;
  const clean = drawn && line.every((q) => Math.hypot(q.x, q.y) <= R * 0.85);
  const sauceScore = wantsSauce ? (clean ? 1 : drawn ? 0.4 : 0) : (drawn ? 0 : 1);
  const s = W.balance * balance + W.rim * rim + W.room * room + W.together * together + W.sauce * sauceScore;
  return Math.round(clamp01(s) * 1000) / 1000;
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
