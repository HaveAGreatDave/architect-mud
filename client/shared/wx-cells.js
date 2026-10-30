// Advance the client's local copy of the weather cells one frame. The field is deterministic and
// each cell carries its own velocity (grid units per `tick` seconds), so the client extrapolates
// the moving fronts forward at 60fps on its own — it needn't be re-sent every frame; the next
// server snapshot just re-seats any accumulated drift. Torus-wrap mirrors the server's advectField.
//
// ⚠ A CELL IS NAMED BY WHAT IT IS, NOT WHERE IT SITS IN THE LIST. The server crops the list to the
// viewer (CLIENT_CELL_RANGE), so a cell's index shifts whenever another one comes into range. The
// seed used to be the index, and every cell after the newcomer re-scattered its puffs and dome
// sprites in the same frame. Radius, drift and strength are fixed for a cell's whole day
// (systemsForForecast), so together they name it.
//
// ⚠ AND A PACKET IS NOT WHERE THE CELL IS NOW. The server advects in whole 30 s steps and the client
// glides between them, so a packet lands up to one step behind the drawn cell. It arrives with every
// flight_ctx, and snapping to it hopped every cloud back by up to half a tile each time. A cell
// keeps its drawn position while that is within about a step of the packet's, and eases off a
// larger error over a second or two. Only a gap no drift explains (a wrap, a new day) snaps.

const cellKey = (c) => c.type + '|' + c.r + '|' + c.vx + '|' + c.vy + '|' + c.intensity;
function cellSeed(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296 * 997 + 1.7;
}
export function stepWeatherCells(st, field, dt) {
  if (!field || !field.cells || !field.cells.length) { st.cells = null; st.wxRef = field; return; }
  if (st.wxRef !== field) {   // new server snapshot → re-seat positions (keep drifting from here)
    const prev = new Map();
    for (const c of st.cells || []) { const k = cellKey(c); if (!prev.has(k)) prev.set(k, []); prev.get(k).push(c); }
    st.wxRef = field;
    st.cells = field.cells.map((c) => {
      const key = cellKey(c), old = prev.get(key)?.shift();
      const n = { ...c, seed: cellSeed(key), ex: 0, ey: 0 };
      if (old) {
        const gap = Math.hypot(old.x - c.x, old.y - c.y), step = Math.hypot(c.vx, c.vy);
        if (gap < 6) {
          n.x = old.x; n.y = old.y;
          if (gap > step * 1.25 + 0.05) { n.ex = c.x - old.x; n.ey = c.y - old.y; }
        }
      }
      return n;
    });
    st.wxBounds = field.bounds; st.wxTick = field.tick || 30;
  }
  const b = st.wxBounds, pad = 2, per = dt / (st.wxTick || 30), ease = Math.min(1, dt * 1.5);
  for (const c of st.cells) {
    c.x += c.vx * per; c.y += c.vy * per;
    if (c.ex || c.ey) {
      c.x += c.ex * ease; c.y += c.ey * ease; c.ex -= c.ex * ease; c.ey -= c.ey * ease;
      if (Math.abs(c.ex) + Math.abs(c.ey) < 1e-3) c.ex = c.ey = 0;
    }
    if (!b) continue;
    const lo = b.minX - c.r - pad, spanX = (b.maxX - b.minX) + c.r * 2 + pad * 2;
    const loY = b.minY - c.r - pad, spanY = (b.maxY - b.minY) + c.r * 2 + pad * 2;
    if (c.x < lo) c.x += spanX; else if (c.x > lo + spanX) c.x -= spanX;
    if (c.y < loY) c.y += spanY; else if (c.y > loY + spanY) c.y -= spanY;
  }
}
