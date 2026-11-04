// ── THE STREET KIT'S PEOPLE: OVER THE BRIDGE OR ACROSS FOR A FEE, NEVER THROUGH THE LANE ──────────
//
// Coldwater Streets (docs/proposals/coldwater-streets.md). On a kit street the lane is licensed, so
// nobody on foot walks across it. Somebody who needs the other side waits at the kerb, then walks to
// the block's footbridge, rides a lift up, crosses and rides down, or pays at the crossing and goes
// over the zebra. Who pays and who walks is a fixed fact about the person (`frugal`).
//
// The street-actor pass still decides where everybody is (the server's tile, street life's spot on
// the pavement). This follows that spot: each frame the figure is where the pass put it, unless
// getting there would cross a lane, in which case it takes the long way round and catches up. It
// moves at a walking pace with a brisk catch-up, so a figure is never more than a crossing behind.
// Nothing here is sent anywhere or invents anybody: it only decides the way between two places the
// pass already chose.
//
// The way is found over the walkways as regions: one side of a straight tile, or one quadrant of a
// junction. Regions that touch without a lane between them are joined; a footbridge or a crossing
// joins the two sides of its tile. Where those stand is kitPlace's, the same answer the paint uses.
//
// Frame: absolute world tiles, x east, y south, z up. `win` is the map window: `at(rx, ry)` a cell
// by window index, `wide` (see kitPlace), `R`, `wcx`, `wcy`.
import { KIT, LEVEL, M, kitPlace } from './street-kit.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Speeds in tiles a second (a tile is about 18 m), the lift in tiles a second up, the sample step
// in tiles, and how many regions a search may open.
export const KIT_WALK = {
  pace: 0.07,       // walking the long way round, about 1.25 m/s
  brisk: 0.16,      // catching up with where the pass has them, nearly 3 m/s
  lift: 0.12,       // a lift car, 2 m/s
  step: 0.04,       // how finely a straight line is checked for a lane
  search: 120,      // regions a route may open before giving up
  frugal: 0.65,     // the share who walk to the bridge rather than pay to cross
  bridgeCost: 1.4,  // what the lifts and the deck add to a route, in tiles of walking
  crossFee: 0.6,    // what ₵2 is worth in tiles of walking to somebody who doesn't mind paying it
  crossFrugal: 9,   // and to somebody who does
};

const { LANE_HW, KERB_H, LANE_Z, TOWER_V, BRIDGE_U, CROSS_U, DECK_Z1, WALK_V } = KIT;

// A tile's place for walking. The dirt has no lane and no walkways, so it's off the kit here: people
// cross it where they like, as they cross any open ground.
const placeOf = (win, rx, ry) => {
  const place = kitPlace(win.at, rx, ry, win.wide);
  return place && !LEVEL[place.level].dirt ? place : null;
};

// The window index and the tile centre (world) of a world point.
function tileOf(win, X, Y) {
  const rx = Math.round(X - win.wcx) + win.R, ry = Math.round(Y - win.wcy) + win.R;
  return { rx, ry, cx: (rx - win.R) + win.wcx, cy: (ry - win.R) + win.wcy };
}
// Which walkway region a world point is in: { key, kind: 's' | 'q' | 'lane' } on a kit tile,
// or null off the kit.
function regionAt(win, X, Y) {
  const t = tileOf(win, X, Y);
  const place = placeOf(win, t.rx, t.ry);
  if (!place) return null;
  const lx = X - t.cx, ly = Y - t.cy;
  if (place.axis) {
    const lat = place.axis === 'ns' ? lx : ly;
    if (Math.abs(lat) < LANE_HW) return { ...t, place, kind: 'lane', key: null };
    const side = lat >= 0 ? 1 : -1;
    return { ...t, place, kind: 's', side, key: `${t.rx},${t.ry},s,${side}` };
  }
  const a = place.arms;
  const inX = Math.abs(lx) < LANE_HW, inY = Math.abs(ly) < LANE_HW;
  const lane = (inX && (inY || a.includes(ly < 0 ? 'n' : 's'))) || (inY && (inX || a.includes(lx < 0 ? 'w' : 'e')));
  if (lane) return { ...t, place, kind: 'lane', key: null };
  const sx = lx >= 0 ? 1 : -1, sy = ly >= 0 ? 1 : -1;
  return { ...t, place, kind: 'q', sx, sy, key: `${t.rx},${t.ry},q,${sx},${sy}` };
}
// A region by its tile and its side or quadrant, built the way regionAt builds one.
function regionOf(win, rx, ry, kind, a, b) {
  const place = placeOf(win, rx, ry);
  if (!place) return null;
  const cx = (rx - win.R) + win.wcx, cy = (ry - win.R) + win.wcy;
  if (kind === 's') return place.axis ? { rx, ry, cx, cy, place, kind, side: a, key: `${rx},${ry},s,${a}` } : null;
  return place.axis ? null : { rx, ry, cx, cy, place, kind, sx: a, sy: b, key: `${rx},${ry},q,${a},${b}` };
}

// Where a region joins its neighbours: [{ r, pts, cost }], `pts` the way from this region into that
// one as world points [x, y, z].
function links(win, r, frugal) {
  const out = [];
  const z = KERB_H;
  if (r.kind === 's') {
    const ns = r.place.axis === 'ns', U = ns ? [0, 1] : [1, 0], V = ns ? [1, 0] : [0, 1], s = r.side;
    const W = (u, v, zz = z) => [r.cx + U[0] * u + V[0] * v, r.cy + U[1] * u + V[1] * v, zz];
    for (const dir of [-1, 1]) {
      const nx = r.rx + U[0] * dir, ny = r.ry + U[1] * dir;
      const np = placeOf(win, nx, ny);
      if (!np) continue;
      const nb = np.axis === r.place.axis ? regionOf(win, nx, ny, 's', s)
        : !np.axis ? regionOf(win, nx, ny, 'q', U[0] * -dir + V[0] * s, U[1] * -dir + V[1] * s) : null;
      if (nb) out.push({ r: nb, pts: [W(dir * 0.5, s * WALK_V)], cost: 1 });
    }
    const other = regionOf(win, r.rx, r.ry, 's', -s);
    if (other && r.place.bridge) {
      out.push({ r: other, cost: 1 + KIT_WALK.bridgeCost, pts: [
        W(BRIDGE_U, s * TOWER_V), W(BRIDGE_U, s * TOWER_V, DECK_Z1), W(BRIDGE_U, -s * TOWER_V, DECK_Z1), W(BRIDGE_U, -s * TOWER_V)] });
    }
    if (other && r.place.cross) {
      const k = LANE_HW + M(0.6);
      out.push({ r: other, cost: 0.5 + (frugal ? KIT_WALK.crossFrugal : KIT_WALK.crossFee), pts: [
        W(CROSS_U, s * k), W(CROSS_U, s * (LANE_HW - M(0.1)), LANE_Z), W(CROSS_U, -s * (LANE_HW - M(0.1)), LANE_Z), W(CROSS_U, -s * k)] });
    }
    return out;
  }
  // A junction quadrant: out along an arm, or round to the next quadrant where there's no arm.
  const a = r.place.arms, sx = r.sx, sy = r.sy;
  const armX = a.includes(sx > 0 ? 'e' : 'w'), armY = a.includes(sy > 0 ? 's' : 'n');
  const P2 = (x, y) => [r.cx + x, r.cy + y, z];
  const out1 = (nx, ny, sideIfStraight, qx, qy, pt) => {
    const np = placeOf(win, nx, ny);
    if (!np) return;
    const nb = np.axis ? regionOf(win, nx, ny, 's', sideIfStraight) : regionOf(win, nx, ny, 'q', qx, qy);
    if (nb) out.push({ r: nb, pts: [pt], cost: 1 });
  };
  if (armX) out1(r.rx + sx, r.ry, sy, -sx, sy, P2(sx * 0.5, sy * WALK_V));
  else { const nb = regionOf(win, r.rx, r.ry, 'q', sx, -sy); if (nb) out.push({ r: nb, pts: [P2(sx * WALK_V, 0)], cost: 0.5 }); }
  if (armY) out1(r.rx, r.ry + sy, sx, sx, -sy, P2(sx * WALK_V, sy * 0.5));
  else { const nb = regionOf(win, r.rx, r.ry, 'q', -sx, sy); if (nb) out.push({ r: nb, pts: [P2(0, sy * WALK_V)], cost: 0.5 }); }
  return out;
}

// The cheapest way from region `a` to region `b` as a list of world points, or null.
export function kitRoute(win, a, b, frugal) {
  if (!a || !b || !a.key || !b.key) return null;
  if (a.key === b.key) return [];
  const best = new Map([[a.key, { cost: 0, prev: null, pts: null, r: a }]]);
  const open = [a.key];
  let opened = 0;
  while (open.length && opened < KIT_WALK.search) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (best.get(open[i]).cost < best.get(open[bi]).cost) bi = i;
    const key = open.splice(bi, 1)[0], cur = best.get(key);
    opened++;
    if (key === b.key) {
      const pts = [];
      for (let n = cur; n && n.prev; n = best.get(n.prev)) pts.unshift(...n.pts);
      return pts;
    }
    for (const l of links(win, cur.r, frugal)) {
      const c = cur.cost + l.cost, was = best.get(l.r.key);
      if (was && was.cost <= c) continue;
      best.set(l.r.key, { cost: c, prev: key, pts: l.pts, r: l.r });
      if (!open.includes(l.r.key)) open.push(l.r.key);
    }
  }
  return null;
}

// Does the straight line from (x0, y0) to (x1, y1) cross a kit lane?
function crossesLane(win, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / KIT_WALK.step);
  for (let i = 1; i < n; i++) {
    const r = regionAt(win, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
    if (r && r.kind === 'lane') return true;
  }
  return false;
}

// One figure, one frame. `h` is the actor's held record (its follower lives on it as `h.kw`),
// (X, Y) where the pass put them this frame and `zRaw` the height it would stand them at,
// `frugal` whether they walk to the bridge rather than pay. Returns { x, y, z, moving, dx, dy }.
export function kitWalk(h, X, Y, zRaw, now, win, frugal) {
  const rq = regionAt(win, X, Y);
  const zq = rq ? (rq.kind === 'lane' ? 0 : KERB_H) : zRaw;
  let s = h.kw;
  if (!s) {
    s = h.kw = { x: X, y: Y, z: zq, path: null, i: 0, goal: null, t: now };
    return { x: X, y: Y, z: zq, moving: false, dx: 0, dy: 0 };
  }
  const dt = clamp((now - s.t) / 1000, 0, 0.25);
  s.t = now;
  const x0 = s.x, y0 = s.y;
  const rd = regionAt(win, s.x, s.y);
  const onGround = s.z < KERB_H + M(0.5) && !(rd && rd.kind === 'lane');

  // A new goal while walking somewhere: plan again from here, unless they're on a bridge or a zebra.
  if (s.path && rq && rq.key && rq.key !== s.goal && onGround) s.path = null;

  if (!s.path) {
    if (rq && rq.kind === 'lane' && !(rd && rd.kind === 'lane')) {
      // The pass has them in the lane, crossing on its own straight line: they wait at the kerb
      // until it has them on the far side.
    } else if (rd && rq && rd.key && rq.key && rd.key !== rq.key && crossesLane(win, s.x, s.y, X, Y)) {
      const pts = kitRoute(win, rd, rq, frugal);
      if (pts) { s.path = [...pts, [X, Y, zq]]; s.i = 0; s.goal = rq.key; }
      else { s.x = X; s.y = Y; s.z = zq; }   // nowhere to cross in reach: as the pass has it
    } else {
      const d = Math.hypot(X - s.x, Y - s.y), step = KIT_WALK.brisk * dt;
      if (d <= Math.max(step, 1e-4)) { s.x = X; s.y = Y; }
      else { s.x += (X - s.x) / d * step; s.y += (Y - s.y) / d * step; }
      s.z = zq;
    }
  }
  if (s.path) {
    let left = dt;
    while (left > 0 && s.i < s.path.length) {
      const [tx, ty, tz] = s.path[s.i];
      const flat = Math.hypot(tx - s.x, ty - s.y), up = Math.abs(tz - s.z);
      // In a lift the car sets the pace; otherwise a walk, the height following along.
      const lift = flat < 1e-4 && up > 1e-4;
      const speed = lift ? KIT_WALK.lift : KIT_WALK.pace, d = lift ? up : flat;
      if (d <= speed * left) { s.x = tx; s.y = ty; s.z = tz; left -= d / speed; s.i++; continue; }
      const k = speed * left / d;
      s.x += (tx - s.x) * k; s.y += (ty - s.y) * k; s.z += (tz - s.z) * k;
      left = 0;
    }
    if (s.i >= s.path.length) s.path = null;
  }
  // Moving is moving across the ground: somebody in a lift car or waiting at the kerb stands still.
  const mx = s.x - x0, my = s.y - y0;
  return { x: s.x, y: s.y, z: s.z, moving: Math.hypot(mx, my) > 1e-5, dx: mx, dy: my };
}
