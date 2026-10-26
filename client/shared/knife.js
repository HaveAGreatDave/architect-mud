// KNIFE: where a cut falls and how even the pieces are, as pure geometry.
//
// The Kitchen Stage's board and the cooking plugin's `chopresolve` both call these, so the pieces
// a player watched fall apart are the pieces the server grades. The client sends the cuts it drew;
// the server rebuilds the pieces from them and works out the evenness itself.
//
// A food on the board is its footprint seen from above: a convex polygon in centimetres, centred
// on the origin, its length along x (kitchen-matter.js `form.w`). A cut is a straight line across
// it: `at` is where it crosses the x axis, as a fraction 0..1 of the food's length, and `tilt` is
// how far it leans off square, in radians. Every piece of a convex food cut by straight lines is
// convex, so splitting is a half-plane clip and nothing needs triangulating.
//
// ⚠ NO WALL CLOCK, NO RANDOMNESS, NO DOM. scripts/shapes/kitchen-smoke.mjs runs it in node.

export const MAX_TILT = 0.6;          // radians; a stroke leaning more than this is clamped
export const SLIVER = 0.02;           // a piece under this share of the food is a scrap, not a piece
const CRUSH_COST = 0.08;              // evenness lost per crushed stroke (soft food, slow blade)
const SPREAD_COST = 2;                // evenness lost per unit of spread (coefficient of variation)

// ── the footprint ────────────────────────────────────────────────────────────

// A rounded rectangle w by d, its corners `round` of the way to an ellipse. `seg` points per
// corner. round 0 is a box, 1 an ellipse.
export function footprint(form, seg = 5) {
  const w = Math.max(0.5, Number(form?.w) || 8), d = Math.max(0.5, Number(form?.d) || 6);
  const round = Math.max(0, Math.min(1, form?.round ?? 0.5));
  const hw = w / 2, hd = d / 2, r = Math.min(hw, hd) * round;
  if (round >= 0.999) {
    const n = seg * 4, out = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([Math.cos(a) * hw, Math.sin(a) * hd]); }
    return out;
  }
  const out = [];
  const corners = [[hw - r, hd - r, 0], [-hw + r, hd - r, 1], [-hw + r, -hd + r, 2], [hw - r, -hd + r, 3]];
  for (const [cx, cy, q] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = (q + i / seg) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return dedupe(out);
}
function dedupe(p) {
  const out = [];
  for (const q of p) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 1e-6) out.push(q);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
  return out;
}

export function area(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

export function bounds(poly) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, x1, y0, y1 };
}

export function centroid(poly) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n], k = x0 * y1 - x1 * y0;
    a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
  }
  if (Math.abs(a) < 1e-9) return poly[0] ? [poly[0][0], poly[0][1]] : [0, 0];
  return [cx / (3 * a), cy / (3 * a)];
}

// ── cutting ──────────────────────────────────────────────────────────────────

// The line of a cut on a footprint: a point it passes through and its unit normal, which points
// towards +x. A cut square to the food has normal (1, 0).
export function cutLine(poly, cut) {
  const b = bounds(poly);
  const at = Math.max(0, Math.min(1, Number(cut.at)));
  const tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, Number(cut.tilt) || 0));
  return { px: b.x0 + (b.x1 - b.x0) * at, py: 0, nx: Math.cos(tilt), ny: Math.sin(tilt) };
}

// The part of a convex polygon on one side of a line (Sutherland-Hodgman, one edge). `side` 1
// keeps the +normal side, -1 the other.
export function clip(poly, L, side) {
  const out = [], n = poly.length;
  const f = (p) => side * ((p[0] - L.px) * L.nx + (p[1] - L.py) * L.ny);
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out.length >= 3 ? out : null;
}

// Every piece a set of cuts makes, in order along the food. Cuts are applied in turn to every
// piece they cross, so two strokes that cross each other make four pieces, as a real knife would.
export function cutPieces(poly, cuts) {
  let pieces = [poly];
  for (const cut of cuts) {
    const L = cutLine(poly, cut), next = [];
    for (const p of pieces) {
      const a = clip(p, L, -1), b = clip(p, L, 1);
      if (a && b) next.push(a, b); else next.push(p);
    }
    pieces = next;
  }
  return pieces.sort((p, q) => centroid(p)[0] - centroid(q)[0]);
}

// How even a cut came out, 0..1. 1 is pieces of equal size with nothing crushed. Scraps under
// SLIVER count as pieces, since a scrap is a piece that cooks in no time. A cut that makes fewer
// pieces than asked (a stroke that missed the food) is scored as if the missing pieces had no
// size at all.
export function evenness(poly, cuts, crush = 0, want = cuts.length + 1) {
  const total = area(poly);
  if (!(total > 0)) return 0;
  const shares = cutPieces(poly, cuts).map((p) => area(p) / total);
  while (shares.length < want) shares.push(0);
  const mean = shares.reduce((s, x) => s + x, 0) / shares.length;
  const sd = Math.sqrt(shares.reduce((s, x) => s + (x - mean) ** 2, 0) / shares.length);
  const cv = mean > 0 ? sd / mean : 1;
  const e = 1 - SPREAD_COST * cv - CRUSH_COST * Math.max(0, Math.floor(Number(crush) || 0));
  return Math.max(0, Math.min(1, Math.round(e * 1000) / 1000));
}

// Cuts at even LENGTHS: n pieces need n - 1 cuts. Even pieces only on a food as wide all along.
export const guides = (n) => Array.from({ length: Math.max(0, n - 1) }, (_, i) => (i + 1) / n);

// Where the cuts go for pieces of even SIZE, which is what the board draws as its guides. On a
// dome (a potato, an onion) the ends are narrow, so the end pieces have to be longer. Square cuts,
// each found by bisecting on the area to its left.
export function balancedGuides(poly, n) {
  const total = area(poly), out = [];
  for (let i = 1; i < n; i++) {
    const want = (total * i) / n;
    let lo = 0, hi = 1;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2, left = clip(poly, cutLine(poly, { at: mid }), -1);
      if ((left ? area(left) : 0) < want) lo = mid; else hi = mid;
    }
    out.push(Math.round(((lo + hi) / 2) * 1000) / 1000);
  }
  return out;
}

// ── the wire ─────────────────────────────────────────────────────────────────
// A cut travels as `at:tilt`, three decimals each: `0.334:-0.052`.
export const cutToken = (c) => `${(+c.at).toFixed(3)}:${(+(c.tilt || 0)).toFixed(3)}`;
export function parseCut(tok) {
  const m = /^(-?\d*\.?\d+)(?::(-?\d*\.?\d+))?$/.exec(String(tok || '').trim());
  if (!m) return null;
  const at = Number(m[1]), tilt = m[2] == null ? 0 : Number(m[2]);
  if (!Number.isFinite(at) || !Number.isFinite(tilt) || at < 0 || at > 1) return null;
  return { at, tilt: Math.max(-MAX_TILT, Math.min(MAX_TILT, tilt)) };
}
