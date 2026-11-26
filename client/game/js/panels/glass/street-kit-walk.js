// ── THE STREET KIT'S PEOPLE: OVER THE BRIDGE OR ACROSS FOR A FEE, NEVER THROUGH THE LANE ──────────
//
// Coldwater Streets (docs/proposals/coldwater-streets.md). On a kit street nobody on foot walks across
// the lane. Somebody who needs the other side waits at the kerb, then walks to
// the block's footbridge, rides a lift up, crosses and rides down, or goes over the zebra at the
// crossing. Which they prefer is a fixed fact about the person (`frugal`, the ones who take the bridge).
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
// The mall down a two-wide street joins the inner sides of its two halves with no lane between them,
// and that street's footbridge comes down on the shared tower on the seam.
//
// Frame: absolute world tiles, x east, y south, z up. `win` is the map window: `at(rx, ry)` a cell
// by window index, `wide` (see kitPlace), `R`, `wcx`, `wcy`.
import { KIT, KIT_M, LEVEL, M, kitPlace, kitTowerV, kitLiftKey, kitLiftCall, kitLiftShow, kitCarZ } from './street-kit.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Speeds in tiles a second (a tile is about 18 m), the lift in tiles a second up, the sample step
// in tiles, and how many regions a search may open.
export const KIT_WALK = {
  pace: 0.07,       // walking the long way round, about 1.25 m/s
  brisk: 0.16,      // catching up with where the pass has them, nearly 3 m/s
  lift: 0.12,       // a lift car, 2 m/s
  step: 0.04,       // how finely a straight line is checked for a lane
  search: 120,      // regions a route may open before giving up
  frugal: 0.65,     // the share who prefer the bridge to the zebra
  bridgeCost: 1.4,  // what the lifts and the deck add to a route, in tiles of walking
  crossFee: 0.6,    // how far somebody who likes the zebra will walk to avoid the lifts, in tiles
  crossFrugal: 9,   // and how far somebody who prefers the bridge will walk to avoid the zebra
};

const { LANE_HW, KERB_H, LANE_Z, BRIDGE_U, CROSS_U, DECK_Z1, WALK_V } = KIT;

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
    // Across the mall to the other half of a two-wide street: no lane, so just walk over.
    if (r.place.inner === s) {
      const nb = regionOf(win, r.rx + V[0] * s, r.ry + V[1] * s, 's', -s);
      if (nb) out.push({ r: nb, pts: [W(0, s * 0.5)], cost: 0.7 });
    }
    const other = regionOf(win, r.rx, r.ry, 's', -s);
    if (other && r.place.bridge) {
      const here = kitTowerV(r.place, s), there = kitTowerV(r.place, -s);
      // One step that does the whole crossing with the real cars (bridgeStep below).
      out.push({ r: other, cost: 1 + KIT_WALK.bridgeCost, pts: [{
        op: 'bridge', cx: r.cx, cy: r.cy, ns, s, here, there, place: r.place,
        key: kitLiftKey(r.place, r.cx * 73 + r.cy * 149) }] });
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
  const seam = r.place.seam || '';
  if (armX) out1(r.rx + sx, r.ry, sy, -sx, sy, P2(sx * 0.5, sy * WALK_V));
  else if (seam.includes(sx > 0 ? 'e' : 'w')) out1(r.rx + sx, r.ry, -sx, -sx, sy, P2(sx * 0.5, sy * WALK_V));
  else { const nb = regionOf(win, r.rx, r.ry, 'q', sx, -sy); if (nb) out.push({ r: nb, pts: [P2(sx * WALK_V, 0)], cost: 0.5 }); }
  if (armY) out1(r.rx, r.ry + sy, sx, sx, -sy, P2(sx * WALK_V, sy * 0.5));
  else if (seam.includes(sy > 0 ? 's' : 'n')) out1(r.rx, r.ry + sy, -sy, sx, -sy, P2(sx * WALK_V, sy * 0.5));
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

  // A new goal while walking somewhere: plan again from here, unless they're on a bridge or a zebra, or
  // already through a lift's door (waiting outside one, they give up and go).
  const committed = s.br && s.br.stage > 1;
  if (s.path && rq && rq.key && rq.key !== s.goal && onGround && !committed) { s.path = null; s.br = null; }

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
  let face = null;
  if (s.path) {
    let left = dt;
    while (left > 0 && s.i < s.path.length) {
      const el = s.path[s.i];
      if (el.op === 'bridge') {
        const r = bridgeStep(s, el, left, now, s.path[s.i + 1]);
        if (!s.path) break;   // gave up on the lift
        left = r.left; face = r.face || null;
        if (r.done) { s.br = null; s.i++; continue; }
        break;
      }
      const [tx, ty, tz] = el;
      const d = Math.max(Math.hypot(tx - s.x, ty - s.y), Math.abs(tz - s.z)), speed = KIT_WALK.pace;
      if (d <= speed * left) { s.x = tx; s.y = ty; s.z = tz; left -= d / speed; s.i++; continue; }
      const k = speed * left / d;
      s.x += (tx - s.x) * k; s.y += (ty - s.y) * k; s.z += (tz - s.z) * k;
      left = 0;
    }
    if (s.path && s.i >= s.path.length) { s.path = null; s.br = null; }
  }
  // Moving is moving across the ground: somebody in a lift car or waiting at the kerb stands still, facing
  // `face` (the door they wait at, the rail, out of the car) rather than the way they last walked.
  const mx = s.x - x0, my = s.y - y0, moving = Math.hypot(mx, my) > 1e-5;
  const f = !moving && face ? face : [mx, my];
  return { x: s.x, y: s.y, z: s.z, moving, dx: f[0], dy: f[1] };
}

// ── THE LIFTS, RIDDEN ────────────────────────────────────────────────────────
//
// A walker takes the footbridge in the same cars a player rides (street-kit.js THE FOOTBRIDGE LIFTS): round
// the tower to its door, which faces the lane; press for the car if it isn't down; wait for it; step in and
// send it up; ride it on its floor; step out onto the deck; maybe stand at the rail a while; at the far tower
// press for the car if it's gone down and wait; step in and send it down; ride it; step out of the door and
// round the tower. Nobody steps into a moving car or out of one between floors, or walks through a tower wall.
const TW = M(KIT_M.TOWER_W / 2), TL = M(KIT_M.TOWER_L / 2), HU = M(KIT_M.DECK_W / 2);
const DOOR_OUT = M(0.45), ROUND = M(0.55), CAR_REST = KERB_H + M(0.12), EPS = 1e-4;
export const KIT_LIFT = {
  linger: 0.3,        // the share who stop at the rail up on the deck
  lingerS: [6, 22],   // and for how long, seconds
  giveUp: 60,         // seconds at the foot door before they give up and walk on
};
// The step's local frame, u along the street and v across, as kitPlace's; to and from world.
const toW = (b, u, v, z) => (b.ns ? [b.cx + v, b.cy + u, z] : [b.cx + u, b.cy + v, z]);
const toL = (b, x, y) => (b.ns ? [y - b.cy, x - b.cx] : [x - b.cx, y - b.cy]);
// A step out from the door of the tower at v = tv on side `side`; the door faces the lane.
const doorV = (tv, side) => tv - side * (TW + DOOR_OUT);
// The way between a tower's door and a point (pu, pv) at the foot: straight if the point is lane side of the
// door, otherwise out past the tower's end. `toDoor` from the point to the door, else from the door out.
function roundTower(b, tv, side, pu, pv, z, toDoor) {
  const dv = doorV(tv, side), door = toW(b, BRIDGE_U, dv, z);
  if (side * (pv - (tv - side * TW)) < -M(0.1)) return toDoor ? [door] : [];
  const uc = BRIDGE_U + (Math.sign(pu - BRIDGE_U) || 1) * (TL + ROUND);
  return toDoor ? [toW(b, uc, pv, z), toW(b, uc, dv, z), door] : [toW(b, uc, dv, z), toW(b, uc, pv, z)];
}
// Walk the queue at the walking pace for up to `left` seconds; the time left over.
function walkQ(s, q, left) {
  while (left > 0 && q.length) {
    const [tx, ty, tz] = q[0], d = Math.hypot(tx - s.x, ty - s.y);
    if (d <= KIT_WALK.pace * left) { s.x = tx; s.y = ty; s.z = tz; left -= d / KIT_WALK.pace; q.shift(); continue; }
    const k = KIT_WALK.pace * left / d;
    s.x += (tx - s.x) * k; s.y += (ty - s.y) * k; s.z = tz;
    return 0;
  }
  return left;
}
// One frame of the crossing: { left, done, face }. `next` is the path's point after it.
function bridgeStep(s, b, left, now, next) {
  let B = s.br;
  if (!B || B.b !== b) {
    const [pu, pv] = toL(b, s.x, s.y);
    B = s.br = { b, stage: 0, q: roundTower(b, b.here, b.s, pu, pv, KERB_H, true), t: now, called: -1e9, linger: Math.random() < KIT_LIFT.linger };
  }
  const carZ = () => kitCarZ(b.place, b.s, now, b.key);
  const toward = (u, v) => { const [lu, lv] = toL(b, s.x, s.y), p = toW(b, u, v, 0), q = toW(b, lu, lv, 0); return [p[0] - q[0], p[1] - q[1]]; };
  const nearDoor = doorV(b.here, b.s), farDoor = doorV(b.there, -b.s);
  const at = (u, v, z) => { const p = toW(b, u, v, z); s.x = p[0]; s.y = p[1]; s.z = z; };
  for (let guard = 0; guard < 12; guard++) {
    switch (B.stage) {
      case 0:   // round to the near door
        left = walkQ(s, B.q, left);
        if (B.q.length) return { left: 0 };
        B.stage = 1; B.t = now;
        continue;
      case 1: { // at the foot: the car down with its doors open, or press for it
        if (carZ() <= CAR_REST + EPS && kitLiftShow(b.key, now) === 'idle') { B.stage = 2; B.q = [toW(b, BRIDGE_U, b.here, CAR_REST)]; continue; }
        if (now - B.called > 4000) { kitLiftCall(b.key, 'call-bottom', now); B.called = now; }
        if (now - B.t > KIT_LIFT.giveUp * 1000) { s.br = null; s.path = null; return { left: 0 }; }
        return { left: 0, face: toward(BRIDGE_U, b.here) };
      }
      case 2:   // stepping in; if somebody else sends it first, back out and wait
        if (carZ() > CAR_REST + EPS) { at(BRIDGE_U, nearDoor, KERB_H); B.stage = 1; B.t = now; return { left: 0 }; }
        left = walkQ(s, B.q, left);
        if (B.q.length) return { left: 0 };
        kitLiftCall(b.key, 'board-bottom', now);
        B.stage = 3;
        continue;
      case 3: { // riding up on the car's floor
        const z = carZ();
        s.z = z;
        if (z >= DECK_Z1 - EPS) { B.stage = 4; B.q = [toW(b, BRIDGE_U, nearDoor, DECK_Z1)]; continue; }
        // sent back down from the foot before it got up: send it up again
        if (z <= CAR_REST + EPS && kitLiftShow(b.key, now) === 'idle') kitLiftCall(b.key, 'board-bottom', now);
        return { left: 0, face: toward(BRIDGE_U, nearDoor) };
      }
      case 4:   // out onto the deck, then the rail for a while or straight over
        left = walkQ(s, B.q, left);
        if (B.q.length) return { left: 0 };
        if (B.linger) {
          B.linger = false;
          const [lo, hi] = KIT_LIFT.lingerS, side = Math.random() < 0.5 ? -1 : 1;
          const v = nearDoor + (farDoor - nearDoor) * (0.25 + Math.random() * 0.5);
          B.rail = { side, v, until: 0, ms: (lo + Math.random() * (hi - lo)) * 1000 };
          B.q = [toW(b, BRIDGE_U, v, DECK_Z1), toW(b, BRIDGE_U + side * (HU - M(0.45)), v, DECK_Z1)];
          B.stage = 5;
          continue;
        }
        B.stage = 6; B.q = [toW(b, BRIDGE_U, farDoor, DECK_Z1)];
        continue;
      case 5:   // at the rail, looking out along the street
        left = walkQ(s, B.q, left);
        if (B.q.length) return { left: 0 };
        if (!B.rail.until) B.rail.until = now + B.rail.ms;
        if (now < B.rail.until) return { left: 0, face: toward(BRIDGE_U + B.rail.side, B.rail.v) };
        B.stage = 6; B.q = [toW(b, BRIDGE_U, B.rail.v, DECK_Z1), toW(b, BRIDGE_U, farDoor, DECK_Z1)];
        continue;
      case 6:   // over to the far door
        left = walkQ(s, B.q, left);
        if (B.q.length) return { left: 0 };
        B.stage = 7; B.called = -1e9;
        continue;
      case 7:   // at the top: hold the car up here or fetch it
        if (now - B.called > 2000) { kitLiftCall(b.key, 'call-top', now); B.called = now; }
        if (carZ() >= DECK_Z1 - EPS && kitLiftShow(b.key, now) === 'up') { B.stage = 8; B.q = [toW(b, BRIDGE_U, b.there, DECK_Z1)]; continue; }
        return { left: 0, face: toward(BRIDGE_U, b.there) };
      case 8:   // stepping in up top, holding the doors; if it goes first, back to the door
        if (carZ() < DECK_Z1 - EPS) { at(BRIDGE_U, farDoor, DECK_Z1); B.stage = 7; return { left: 0 }; }
        kitLiftCall(b.key, 'call-top', now);
        left = walkQ(s, B.q, left);
        if (B.q.length) return { left: 0 };
        kitLiftCall(b.key, 'board-top', now);
        B.stage = 9;
        continue;
      case 9: { // riding down
        const z = carZ();
        s.z = z;
        if (z <= CAR_REST + EPS && kitLiftShow(b.key, now) !== 'up') {
          const [nu, nv] = next && next.length ? toL(b, next[0], next[1]) : [BRIDGE_U, farDoor];
          B.stage = 10;
          B.q = [toW(b, BRIDGE_U, farDoor, KERB_H), ...roundTower(b, b.there, -b.s, nu, nv, KERB_H, false)];
          continue;
        }
        return { left: 0, face: toward(BRIDGE_U, farDoor) };
      }
      case 10:  // out of the door and round the tower
        left = walkQ(s, B.q, left);
        if (B.q.length) return { left: 0 };
        return { left, done: true };
    }
  }
  return { left: 0 };
}
