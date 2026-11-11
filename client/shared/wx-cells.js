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
// ── THE DAY'S CLOUD FLOOR, AS CLOUDS ────────────────────────────────────────────────────────────
//
// The server's sky opens at a floor ('baseCloud', 0.4 on a cloudy day to 0.8 under a storm) and the
// cells only thicken it. The renderer drew the cells and nothing for the floor, so an overcast day
// was a grey tint with two or three clouds in it. These stand in for the floor: small cloud cells on
// a lattice, more of them as the floor rises, drifting on the day's wind. They are render only. The
// server never sees them and nothing samples them for rain, light or temperature; the floor they
// draw is already in every one of those numbers.
//
// A node is a pure function of its lattice coordinate, so the same cloud is there when you come
// back to it. The lattice drifts by a running offset kept on 'st', which is per view: two clients
// agree on how cloudy it is, not on where each small cloud sits.
// ⚠ THE FLOOR IS THE VIEWER'S OWN (the packet's 'baseCloud' is cut by the region's dryness on the
// server), so a dry region under the same day's weather gets a thinner sky.
const FLOOR_S = 14, FLOOR_REACH = 66, FLOOR_RIM = 8;
function latHash(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// How much of a continuous sheet the floor is: nothing on a broken-cloud day, all of it under a storm.
export function floorSheet(floor) {
  const t = Math.min(1, Math.max(0, ((floor || 0) - 0.45) / 0.25));   // 0.4 cloudy: none; 0.7 overcast and up: all
  return t * t * (3 - 2 * t);
}
export function stepFloorCells(st, field, ax, ay, dt) {
  const floor = field ? (field.baseCloud || 0) : 0;
  if (!(floor > 0.16) || ax == null || ay == null) { st.floorCells = null; st.floorKey = null; return; }
  const w = field.wind, kph = w ? (w.kph || 0) : 18, a = (w ? (w.dir || 0) : 0) * Math.PI / 180;
  // The cells' own drift (systemsForForecast), a little slower: low scud under the weather.
  const sp = (0.05 + Math.min(1, kph / 60) * 0.30) * 0.85 / (field.tick || 30);
  const ox = st.floorOx = (st.floorOx || 0) + Math.sin(a) * sp * dt;
  const oy = st.floorOy = (st.floorOy || 0) - Math.cos(a) * sp * dt;
  const i0 = Math.floor((ax - ox - FLOOR_REACH) / FLOOR_S), j0 = Math.floor((ay - oy - FLOOR_REACH) / FLOOR_S);
  const key = i0 + '|' + j0 + '|' + Math.round(floor * 50);
  if (st.floorKey !== key) {
    st.floorKey = key;
    const n = Math.ceil(FLOOR_REACH * 2 / FLOOR_S) + 1, p = Math.min(1, Math.max(0, (floor - 0.15) / 0.6));
    const out = [];
    for (let j = j0; j <= j0 + n; j++) for (let i = i0; i <= i0 + n; i++) {
      // Nodes come in one at a time as the floor rises, each fading up, so a ramping event doesn't pop.
      const on = Math.min(1, Math.max(0, (p * 1.18 - latHash(i, j, 1)) / 0.18));
      if (on <= 0.03) continue;
      out.push({
        bx: (i + 0.5 + (latHash(i, j, 2) - 0.5) * 0.7) * FLOOR_S, by: (j + 0.5 + (latHash(i, j, 3) - 0.5) * 0.7) * FLOOR_S,
        x: 0, y: 0, r: 8 + latHash(i, j, 4) * 5 + p * 2, vx: 0, vy: 0,
        type: 'cloud', i0: (0.5 + latHash(i, j, 5) * 0.35) * on, intensity: 0,
        seed: latHash(i, j, 6) * 997 + 1.7, floor: true,
      });
    }
    st.floorCells = out;
  }
  // In place every frame: where the drift has carried each one, and a fade at the rim of the window.
  for (const c of st.floorCells) {
    c.x = c.bx + ox; c.y = c.by + oy;
    const d = Math.hypot(c.x - ax, c.y - ay);
    c.intensity = c.i0 * Math.min(1, Math.max(0, (FLOOR_REACH - d) / FLOOR_RIM));
  }
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
