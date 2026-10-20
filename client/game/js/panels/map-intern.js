// map-intern: keep a map window's cell objects across a server resend.
//
// The server sends the whole window on every context push (the flight sim's every TICK_MS, 3 s), as
// fresh JSON. Everything GLASS keeps per building is keyed on the CELL OBJECT (kept arms, occluder
// geometry, ground tiles, sky reach) or on the window ARRAY (the GL cell list, the ground LUT, the
// flock search), so each push threw all of it away: about 150 buildings probed on one frame, three
// arm runs each, and again a dozen frames later. Measured headless at Halcyon in the cockpit
// (scripts/perf/movecost.mjs --resend 60): a 100-165 ms frame per push, p99 56 -> 99 ms.
//
// So a cell whose content hasn't changed keeps its old object, and a window whose centre and every
// cell are unchanged comes back as the old array itself. A cell that changed is the new object, so
// every cache keyed on it misses exactly when it should.
//
// ⚠ THE COMPARISON IS EXACT AND THE KEY SETS MUST MATCH. A cell some client code has written a field
// onto no longer matches its wire twin and simply isn't reused, which is the old behaviour, never a
// stale cell.

function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  let n = 0;
  for (const k in a) { if (!(k in b) || !same(a[k], b[k])) return false; n++; }
  for (const k in b) n--;
  return n === 0;
}

/**
 * The window to keep: `prev` itself when nothing changed, else `next` with every unchanged cell
 * swapped for its old object (in place: `next` is fresh off the wire).
 * @param {Array<Array>} prev  the window held now, or null
 * @param {number} px @param {number} py  its centre tile
 * @param {Array<Array>} next  the window just received
 * @param {number} nx @param {number} ny  its centre tile
 */
export function internMap(prev, px, py, next, nx, ny) {
  if (!Array.isArray(prev) || !Array.isArray(next) || !prev.length || !next.length) return next;
  if (px == null || py == null || nx == null || ny == null) return next;
  const pR = (prev.length - 1) >> 1, nR = (next.length - 1) >> 1;
  let all = prev.length === next.length && px === nx && py === ny;
  for (let j = 0; j < next.length; j++) {
    const row = next[j];
    if (!Array.isArray(row)) { all = false; continue; }
    const pj = ny + j - nR - py + pR, prow = prev[pj];
    if (!Array.isArray(prow)) { all = false; continue; }
    const pcR = (prow.length - 1) >> 1, ncR = (row.length - 1) >> 1;
    if (prow.length !== row.length) all = false;
    for (let i = 0; i < row.length; i++) {
      const old = prow[nx + i - ncR - px + pcR];
      if (old !== undefined && same(old, row[i])) row[i] = old;
      else all = false;
    }
  }
  return all ? prev : next;
}
