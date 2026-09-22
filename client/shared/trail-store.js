// A TRAIL: WHERE SOMETHING HAS BEEN, AND HOW FAR GONE THE MARK IS.
//
// Two things in GLASS remember where a moving object went and lay a mark along it — wheel tracks in
// snow, and the foam a hull leaves on water. They are the same data structure and they are NOT the
// same feature: a rut is buried by later snowfall and a wake disperses on its own, they are gated on
// different weather, and they draw at different widths. What they share is the part that is hard to
// get right, and this file is that part.
//
// ⚠ IT IS HERE BECAUSE A SECOND COPY WOULD GET THE SAME FIVE THINGS WRONG. Every one of the rules
// below was a visible defect in the snow tracks first, found on screen and fixed once; a wake
// written from scratch beside it would have re-earned all five. They are stated here so they are
// stated once.
//
// ⚠ AND IT IS PURE — no DOM, no GL, no clock of its own. Everything time-dependent arrives as an
// argument, which is what lets a headless gate drive it directly; before this the only way to test
// any of it was to render a frame, which no harness in this repo can do.

// ── THE RULES, AND WHY EACH ONE EXISTS ────────────────────────────────────────────────────────
//
// ⚠ THE LAST POINT IS PROVISIONAL AND FOLLOWS THE SOURCE EVERY FRAME. Committing only once the
// source has moved a whole step leaves the drawn path up to a step BEHIND the thing making it, and
// then growing by a step at a stroke — which reads as marks appearing in chunks rather than as
// something being dragged out from underneath. The head is dragged and committed against the point
// BEHIND it, so the stored cadence is unchanged and only the last segment moves.
//
// ⚠ AND A BEND COMMITS EARLY. A point every `step` is right for a straight and draws a corner in
// three straight lines — at ordinary spacing a vehicle takes a junction in about 25° a point, and a
// pair of rails kinking 25° at a time is a corner nobody would call smooth. A point is also
// committed once the run has TURNED more than `turn` since the last one, which costs exactly
// nothing on a straight because the angle is zero there.
//
// ⚠ `creep` IS THE FLOOR UNDER THAT AND IS NOT OPTIONAL. Without a minimum spacing, something
// shuffling on the spot swings its heading through a large angle over no distance at all and fills
// the entire buffer with points inside its own width.
//
// ⚠ THE SECOND POINT OPENS ON THE FIRST MOVEMENT, not at the first full step. With one point there
// is no segment and so nothing is drawn, so waiting would leave the first half-step of every run —
// every start, every return to range — with no mark at all.
//
// ⚠ AND A SPENT POINT LEAVES THE STORE, OLDEST FIRST. The list is in the order it was laid and
// `fill` only ever rises, so the front of it is always the most spent. Without this a session
// accumulates every path it has ever taken, all of it invisible and all of it walked by the
// upload's own loop.

// Commit `x, y` onto source `id`'s polyline, or drag the live head to it.
//
//   fill(q, now)  0 the moment a point is laid, 1 once it is gone — the caller's own decay law,
//                 which is the whole of what makes a rut different from a wake.
//   stamp()       the per-point fields that decay reads back (a timestamp, a fall total, a width).
//   onSource(src) per-source fields refreshed each frame (a wheel gauge, a hull beam).
export function layTrailPoint(store, id, x, y, cfg) {
  const { now, fill, stamp, onSource, step, turn, creep, perSrc, srcMax } = cfg;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let src = store.get(id);
  if (!src) {
    if (store.size >= srcMax) {
      let old = null, oldT = Infinity;
      for (const [k, e] of store) if (e.seen < oldT) { oldT = e.seen; old = k; }
      if (old != null) store.delete(old);
    }
    src = { pts: [] }; store.set(id, src);
  }
  src.seen = now;
  if (onSource) onSource(src);

  while (src.pts.length && fill(src.pts[0], now) >= 1) src.pts.shift();

  const mk = () => Object.assign({ x, y }, stamp());
  const n = src.pts.length;
  if (!n) { src.pts.push(mk()); return src; }

  const head = src.pts[n - 1];
  const anchor = n > 1 ? src.pts[n - 2] : null;
  if (anchor) {
    const dx = x - anchor.x, dy = y - anchor.y, d = Math.hypot(dx, dy);
    // How far the run has turned since the point behind the anchor. Zero on a straight, which is
    // what makes this free everywhere except at the corner it exists for.
    const prev = n > 2 ? src.pts[n - 3] : null;
    let t = 0;
    if (prev && d > 1e-6) {
      const ax = anchor.x - prev.x, ay = anchor.y - prev.y;
      if (Math.hypot(ax, ay) > 1e-6) t = Math.abs(Math.atan2(ax * dy - ay * dx, ax * dx + ay * dy));
    }
    if (d < step && !(t > turn && d >= creep)) {
      Object.assign(head, mk());
      return src;
    }
  }
  if (!anchor && Math.hypot(x - head.x, y - head.y) < 1e-6) return src;
  src.pts.push(mk());
  if (src.pts.length > perSrc) src.pts.shift();
  return src;
}

// Pack the nearest runs into `buf` as (x, y, fade, joins-the-next) per point, window-relative.
// Returns null when there is nothing to draw, which is what keeps the uniform count at 0 and the
// shader's own loop unreachable.
//
// ⚠ RUNS STAY CONTIGUOUS, WHICH IS WHY THIS IS NOT THE NEAREST N POINTS. A segment is a PAIR, so a
// budget spent on the nearest points regardless of source interleaves two sources and draws a line
// from one to the other. Sources go in nearest-first, whole.
//
// ⚠ AND A JUMP BREAKS THE RUN AND KEEPS THE POINT. Skipping the point as well loses the FIRST one
// of every new run — and over a session of something leaving and re-entering range that is most of
// what it ever laid, so every return would start late and the trail would be a row of short dashes
// with their beginnings missing.
export function uploadTrail(store, cfg) {
  const { buf, maxPts, cx, cy, lim, now, fill, jump } = cfg;
  if (!store.size) return null;
  const near = [];
  for (const [, src] of store) {
    let best = Infinity;
    for (const q of src.pts) {
      const d = Math.max(Math.abs(q.x - cx), Math.abs(q.y - cy));
      if (d < best) best = d;
    }
    if (best <= lim) near.push({ src, d: best });
  }
  if (!near.length) return null;
  near.sort((A, B) => A.d - B.d);

  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const { src } of near) {
    if (n >= maxPts) break;
    let prev = null, lastO = -1;
    for (const q of src.pts) {
      if (n >= maxPts) break;
      const out = Math.max(Math.abs(q.x - cx), Math.abs(q.y - cy)) > lim;
      const fade = 1 - fill(q, now);
      if (out || fade <= 0.02) {
        if (lastO >= 0) { buf[lastO + 3] = 0; lastO = -1; }   // the run ends here
        prev = null;
        continue;
      }
      if (prev && Math.hypot(q.x - prev.x, q.y - prev.y) > jump && lastO >= 0) {
        buf[lastO + 3] = 0; lastO = -1;
      }
      const o = n * 4;
      buf[o] = q.x - cx; buf[o + 1] = q.y - cy;
      buf[o + 2] = Math.min(1, fade); buf[o + 3] = 1;
      if (q.x < x0) x0 = q.x; if (q.y < y0) y0 = q.y;
      if (q.x > x1) x1 = q.x; if (q.y > y1) y1 = q.y;
      lastO = o; n++; prev = q;
    }
    if (lastO >= 0) buf[lastO + 3] = 0;   // a source's last point joins nothing
  }
  if (n < 2) return null;
  return { n, near, minX: x0 - cx, minY: y0 - cy, maxX: x1 - cx, maxY: y1 - cy };
}
