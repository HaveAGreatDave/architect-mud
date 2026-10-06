// STREET LIFE: what somebody on the pavement does between steps.
//
// NPCs move on a 15-second tick and then stand on one tile for minutes. windshield.js walks them from
// tile to tile (the street-actor pass); this decides what they do while they stand. The server ships
// who is on which tile and nothing else (server/engine/street-actors.js), so all of this is the same
// kind of fiction as the walk: invented business, never an invented person or a wrong tile. Somebody
// you see chatting outside a shop is on that tile, and so is whoever they're chatting to.
//
// What they do:
//   - Two or more on one stretch of pavement (one tile, one side of the street) stand in a ring and
//     talk. One talks and the rest listen, and the turn passes every few seconds. More than four
//     make a second ring further along the kerb.
//   - Somebody on their own picks from a short list: stand looking up or down the street, stroll to
//     another spot on the pavement, look in a shop window, lean on the wall with their arms folded
//     or a cigarette, check a phone, or wait at the kerb watching the traffic.
//   - Somebody who has just stopped walking stands still for a few seconds first, so nobody snaps
//     into a ring the moment they arrive. Somebody first seen standing (they came into view, or the
//     map window recentred onto them) is already doing whatever they're doing.
//
// Nobody leaves the pavement. Where it is comes from the numbers it's painted from (VERGE, WALK_HW
// and blockSpan in windshield.js), handed in as `geo`, so the paint and the people can't drift apart. On
// a road several tiles wide the pavement is only at the outer edges, so somebody on a middle tile
// stands on the nearer one rather than in a traffic lane. Nobody on a Curtain tile stands past the
// wall either (curtainSide, below).
//
// Nothing here is drawn or sent anywhere: it hands windshield.js an offset from the figure's tile, a
// clip and a heading, and the actor record carries no more than it did. This file imports nothing.
// RENDER_TUNE.actorLife at 0 skips all of it and everybody stands still at their kerb spot.

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Every number the planner uses. Distances are in tiles (a tile is about 18 m, so 0.01 is 18 cm),
// speeds in tiles a second and times in seconds. Exported so the console can change them live.
export const LIFE = {
  stroll: 0.045,      // an amble along the pavement, 0.8 m/s against the walk's 1.2
  shuffle: 0.035,     // stepping into a ring, or to the wall
  along: 0.44,        // how far from the tile's centre along the street somebody may stand
  kerbGap: 0.02,      // how far a body's centre keeps from the kerb edge of the band (WALK_HW in geo)
  wallGap: 0.017,     // and from the building edge of it
  curtainGap: 0.04,   // and from the Curtain's field, past its own half-width (CURTAIN_HALF_W in geo)
  pairR: 0.032,       // two people stand a little over a metre apart
  ringR: 0.045,       // three or four in a ring 1.6 m across, so a speaker's hand stays out of the next person
  ringMax: 4,         // more than this on one stretch splits into rings
  ringGap: 0.24,      // along the kerb between neighbouring rings
  turn: 4.2,          // seconds a speaker holds the floor
  settle: [1.5, 5],   // seconds somebody stands still after a walk before doing anything else
  social: 0.82,       // the share who join a ring when there's somebody to join
  smokers: 0.3,       // the share who smoke
};

// What somebody on their own may do, by the kind of ground they're on, with a weight each. `wall`
// needs a building on the far side of the pavement. The same kind never comes up twice running.
const PLANS = {
  walk: [['stand', 2], ['stroll', 3], ['phone', 2], ['kerb', 1], ['window', 2, 'wall'], ['lean', 2, 'wall']],
  corner: [['stand', 2], ['phone', 2], ['wait', 2], ['smoke', 1], ['kerb', 2]],
  open: [['stand', 2], ['stroll', 3], ['phone', 2], ['wait', 1], ['smoke', 1]],
  fixed: [['stand', 3], ['phone', 2], ['wait', 1], ['smoke', 1]],
};

// A 0..1 from two integers. Groups and plans are keyed by numbers, not tokens.
function mixN(a, b) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(((b | 0) + 0x632be5ab) | 0, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// The pavement a figure stands on, in its tile's own frame (x east, y south, tile centre at 0, 0):
//
//   kind  'walk'    a straight paved street: a band along it, `cx, cy` its centre line at the middle
//                   of the tile, `ax, ay` along it, `wx, wy` across it toward the buildings
//         'corner'  a junction or a bend: the corner of it, `cx, cy`, with `wx, wy` pointing out
//         'open'    no road: a yard, a forecourt, open ground
//         'fixed'   a road with no pavement (worn, dirt, curved, a dead end): stay at the verge
//   base  where they stand when nothing says otherwise, which is where they always stood
//   code  which stretch of pavement, for grouping; 0 for none
//
// `base` for a one-tile street, a corner and open ground is exactly the spot vergeOffset gave before
// this file existed, so the walk between tiles is unchanged.
function kerbOf(geo, win, cell, rx, ry, side, t) {
  const { VERGE, blockSpan, hash } = geo;
  const at = (x, y) => { const row = win.map[y]; return row && row[x]; };
  const rd = cell.rd || '';
  const ns = rd.includes('n') || rd.includes('s'), ew = rd.includes('e') || rd.includes('w');
  const a0 = (hash(t, 2) - 0.5) * 0.5;
  if (ns !== ew) {
    const P = ns ? [1, 0] : [0, 1], A = ns ? [0, 1] : [1, 0];   // across the street, along it
    const paved = cell.road && !cell.bt && !cell.wr && cell.ft !== 'dust' && cell.rdeg == null
      && cell.kind !== 'field' && (rd === 'ns' || rd === 'ew');
    if (!paved) return { kind: 'fixed', base: [side * VERGE * P[0] + a0 * A[0], side * VERGE * P[1] + a0 * A[1]], code: 0 };
    // A road several tiles wide is one carriageway with a pavement at each outer edge (see blockSpan
    // and the marking pass). An edge tile's figures take its outer side, the only one with pavement
    // in it; a middle tile's take the nearer edge. `k` is how many tiles out the building line is.
    const blk = blockSpan(at, rx, ry, rd);
    let s = side, c = side * VERGE, k = side;
    if (blk.width > 1) {
      const u = blk.index - (blk.width - 1) / 2, pw = blk.width / 2 - (0.5 - VERGE);
      s = blk.index === 0 ? -1 : blk.index === blk.width - 1 ? 1 : u < 0 ? -1 : u > 0 ? 1 : side;
      c = s * pw - u;
      k = s < 0 ? -(blk.index + 1) : blk.width - blk.index;
    }
    const nb = at(rx + k * P[0], ry + k * P[1]), wall = !!(nb && nb.bt);
    const cx = c * P[0], cy = c * P[1];
    return {
      kind: 'walk', cx, cy, ax: A[0], ay: A[1], wx: s * P[0], wy: s * P[1], wall,
      door: wall && Math.abs(k) === 1 ? [s * P[0], s * P[1]] : null,
      base: [cx + a0 * A[0], cy + a0 * A[1]], code: s < 0 ? 1 : 2,
    };
  }
  if (ns && ew) {
    const cx = VERGE * side, cy = VERGE * (hash(t, 3) < 0.5 ? -1 : 1);
    return { kind: 'corner', cx, cy, wx: Math.SQRT1_2 * Math.sign(cx), wy: Math.SQRT1_2 * Math.sign(cy),
      base: [cx, cy], code: 3 + (cx > 0 ? 1 : 0) + (cy > 0 ? 2 : 0) };
  }
  return { kind: 'open', cx: 0, cy: 0, base: [(hash(t, 2) - 0.5) * 0.6, (hash(t, 3) - 0.5) * 0.6], code: 7 };
}

// The per-figure state, kept on the street-actor record as `h.life`. `sx, sy` is where they stand
// relative to their tile's centre, NaN while they're walking a leg; `r0x, r0y` is how far that spot
// was from the kerb spot when they set off, which the walk lets go of over the leg.
function lifeOf(h, geo, t) {
  return h.life || (h.life = {
    cell: null, k: null, sx: NaN, sy: NaN, r0x: 0, r0y: 0, arr: -Infinity, snap: false, seen: false,
    plan: null, n: 0, last: '', grp: null, t: 0, seed: Math.floor(geo.hash(t, 99) * 16777216),
    ox: 0, oy: 0, mv: false, dx: 0, dy: 0, clip: 'idle', face: null, cp: 0, ph0: geo.hash(t, 29),
  });
}
function frameFor(geo, win, h, t, L, cell, rx, ry) {
  if (L.cell !== cell) {
    const k = kerbOf(geo, win, cell, rx, ry, h.side, t);
    k.inn = geo.inward(win, cell, rx, ry);
    if (k.inn) k.base = curtainSide(geo, k.inn, k.base[0], k.base[1]);
    L.k = k; L.cell = cell;
  }
  return L.k;
}

// A spot on a Curtain tile, moved to the city side of the wall. The wall stands down the tile's middle
// (curtainSegs in windshield.js), and every spot in here is drawn from a square round the centre, so
// without this about half the people on a camp on the wall stood out in the wastes. `inn` is the
// inward unit vector for each axis the wall crosses (the server's `ci`). A spot on the far side is
// mirrored back rather than pushed to the wall, so people keep the spread they had, all of it inside.
// `pad` is extra clearance, for a ring's radius. Exported for windshield.js's no-street-life path.
export function curtainSide(geo, inn, x, y, pad = 0) {
  if (!inn) return [x, y];
  const m = geo.CURTAIN_HALF_W + LIFE.curtainGap + pad;
  for (const [ix, iy] of inn) {
    const s = x * ix + y * iy;
    if (s < m) { const d = Math.max(-s, m) - s; x += ix * d; y += iy * d; }
  }
  return [x, y];
}
const settleMs = (L) => 1000 * (LIFE.settle[0] + (LIFE.settle[1] - LIFE.settle[0]) * mixN(L.seed, 7));

// ── Who stands with whom ─────────────────────────────────────────────────────────────────────────
// Once a frame, before the draw loop. Everybody standing and settled on one stretch of pavement is
// one group, in token order so the same people take the same places every frame. Sets `life.grp` to
// { key, c, G, j, m }: the stretch, which of its G rings, and their place j of m in it.
const _buckets = new Map();
export function streetLifeGroups(geo, win, actors, now) {
  _buckets.clear();
  for (const [t, h] of actors) {
    const L = lifeOf(h, geo, t);
    const seen = L.seen;
    L.seen = true;
    L.grp = null;
    if (h.gone || now - h.t0 < h.ms) continue;   // leaving, or still walking a leg
    const rx = Math.round(h.bx - win.wcx) + win.R, ry = Math.round(h.by - win.wcy) + win.R;
    const row = win.map[ry], cell = row && row[rx];
    if (!cell || cell.kind === 'air') continue;
    const k = frameFor(geo, win, h, t, L, cell, rx, ry);
    if (!Number.isFinite(L.sx)) {
      if (seen) continue;   // they've just stopped; streetLifeStep starts them standing this frame
      // First seen standing: they're already where they'd have gone, so they take it on the first
      // frame rather than walking there from the kerb spot in front of you.
      L.sx = k.base[0] - (Math.round(h.bx) - h.bx); L.sy = k.base[1] - (Math.round(h.by) - h.by);
      L.arr = -Infinity; L.snap = true;
    }
    if (!k.code || now - L.arr < settleMs(L) || geo.hash(t, 60) >= LIFE.social) continue;
    const key = ((Math.round(h.bx) & 4095) * 4096 + (Math.round(h.by) & 4095)) * 8 + k.code;
    let b = _buckets.get(key);
    if (!b) _buckets.set(key, b = []);
    b.push(t);
  }
  for (const [key, ts] of _buckets) {
    const n = ts.length;
    if (n < 2) continue;
    ts.sort();
    const G = Math.ceil(n / LIFE.ringMax);
    for (let i = 0; i < n; i++) {
      const c = i % G;
      actors.get(ts[i]).life.grp = { key, c, G, j: Math.floor(i / G), m: Math.floor((n - 1 - c) / G) + 1 };
    }
  }
}

// A place in a ring: where to stand, which way to face and whether they're the one talking. The ring
// sits on the pavement's centre line, so at its widest it's still clear of the kerb and the wall.
function ringSpot(geo, L, k, t, now) {
  const g = L.grp, r = g.m === 2 ? LIFE.pairR : LIFE.ringR;
  const off = g.c - (g.G - 1) / 2;
  let mx, my;
  if (k.kind === 'walk') {
    const a = clamp((mixN(g.key, 1) - 0.5) * 0.5 + off * LIFE.ringGap, -LIFE.along + r, LIFE.along - r);
    mx = k.cx + k.ax * a; my = k.cy + k.ay * a;
  } else if (k.kind === 'corner') {
    mx = k.cx + k.wx * off * 0.08; my = k.cy + k.wy * off * 0.08;
  } else {
    mx = (mixN(g.key, 1) - 0.5) * 0.3 + off * 0.16; my = (mixN(g.key, 2) - 0.5) * 0.3;
  }
  // The whole ring goes inside, so nobody in it stands in the wall.
  if (k.inn) [mx, my] = curtainSide(geo, k.inn, mx, my, r);
  const th0 = mixN(g.key, 3 + g.c) * TAU;
  const spot = (j) => [mx + r * Math.cos(th0 + j * TAU / g.m), my + r * Math.sin(th0 + j * TAU / g.m)];
  const [sx, sy] = spot(g.j);
  // The turn: one speaker a slot, and now and then a slot where nobody is.
  const slot = Math.floor(now / (LIFE.turn * 1000) + mixN(g.key, 10 + g.c));
  const sp = Math.floor(mixN(g.key * 4 + g.c, slot) * (g.m + 0.5));
  let face;
  if (sp === g.j || sp >= g.m) face = Math.atan2(my - sy, mx - sx);
  else { const [qx, qy] = spot(sp); face = Math.atan2((qy + my) / 2 - sy, (qx + mx) / 2 - sx); }
  // How they listen is theirs: hands together, arms folded, or a cigarette going.
  const smoker = geo.hash(t, 61) < LIFE.smokers;
  const listen = smoker && geo.hash(t, 63) < 0.5 ? 'smoke' : geo.hash(t, 62) < 0.4 ? 'wait' : 'listen';
  return { tx: sx, ty: sy, face, clip: sp === g.j ? 'talk' : listen };
}

// The next thing somebody on their own does. Everything random comes off their seed and how many
// plans they've had, so it's the same on every client that has seen the same pushes.
function nextPlan(geo, L, k, t, now) {
  const n = L.n++, R = (i) => mixN(L.seed, n * 16 + i);
  const list = PLANS[k.kind].filter(([kind, , need]) => kind !== L.last && (!need || k[need]));
  let w = 0;
  for (const [, wt] of list) w += wt;
  let x = R(0) * w, kind = list[0][0];
  for (const [kd, wt] of list) if ((x -= wt) < 0) { kind = kd; break; }
  L.last = kind;
  const dur = (lo, hi) => 1000 * (lo + (hi - lo) * R(5));
  const smoker = geo.hash(t, 61) < LIFE.smokers;
  const plan = { kind, tx: L.sx, ty: L.sy, face: null, clip: 'idle', speed: LIFE.shuffle, until: now + dur(5, 12), t0: now, ph0: L.ph0 };
  if (k.kind === 'walk') {
    // In the street's own terms: `a` along it, `q` across it, positive toward the buildings.
    const dx = L.sx - k.cx, dy = L.sy - k.cy;
    const inner = geo.WALK_HW - LIFE.kerbGap, outer = geo.WALK_HW - LIFE.wallGap;
    const a0 = dx * k.ax + dy * k.ay, q0 = dx * k.wx + dy * k.wy;
    const put = (a, q) => {
      a = clamp(a, -LIFE.along, LIFE.along); q = clamp(q, -inner, outer);
      plan.tx = k.cx + k.ax * a + k.wx * q; plan.ty = k.cy + k.ay * a + k.wy * q;
    };
    const along = (s) => Math.atan2(s * k.ay, s * k.ax);
    const toWall = Math.atan2(k.wy, k.wx), toRoad = Math.atan2(-k.wy, -k.wx);
    if (kind === 'stand') { put(a0, q0); plan.face = along(R(2) < 0.5 ? -1 : 1); }
    else if (kind === 'stroll') {
      let a = a0 + (R(2) < 0.5 ? -1 : 1) * (0.12 + 0.3 * R(3));
      if (Math.abs(a) > LIFE.along) a = 2 * a0 - a;
      put(a, (R(4) - 0.5) * 0.06);
      plan.speed = LIFE.stroll;
      plan.until = now + 1000 * Math.hypot(plan.tx - L.sx, plan.ty - L.sy) / LIFE.stroll + dur(4, 10);
    } else if (kind === 'window') { put(a0 + (R(2) - 0.5) * 0.16, outer - 0.008); plan.face = toWall; plan.until = now + dur(8, 18); }
    else if (kind === 'lean') {
      put(a0 + (R(2) - 0.5) * 0.2, outer);
      plan.face = toRoad; plan.clip = smoker ? 'smoke' : 'wait'; plan.until = now + dur(14, 30);
    } else if (kind === 'kerb') { put(a0 + (R(2) - 0.5) * 0.12, 0.005 - inner); plan.face = toRoad; plan.until = now + dur(5, 10); }
    else put(a0, q0);   // phone, below: wherever they are, pulled back inside the band
  } else if (k.kind === 'corner') {
    const toJunction = Math.atan2(-k.cy, -k.cx);
    if (kind === 'kerb') { plan.tx = k.cx - k.wx * 0.025; plan.ty = k.cy - k.wy * 0.025; plan.face = toJunction; plan.until = now + dur(5, 10); }
    else if (kind === 'stand') { plan.tx = k.cx + (R(2) - 0.5) * 0.03; plan.ty = k.cy + (R(3) - 0.5) * 0.03; plan.face = toJunction + (R(4) - 0.5) * 2; }
  } else if (k.kind === 'open' && kind === 'stroll') {
    plan.tx = (R(2) - 0.5) * 0.56; plan.ty = (R(3) - 0.5) * 0.56;
    plan.speed = LIFE.stroll;
    plan.until = now + 1000 * Math.hypot(plan.tx - L.sx, plan.ty - L.sy) / LIFE.stroll + dur(4, 10);
  }
  // A stroll on a camp on the wall ends on the camp's side of it. The walk there is a straight line
  // between two spots inside, so it never crosses.
  if (k.inn) [plan.tx, plan.ty] = curtainSide(geo, k.inn, plan.tx, plan.ty);
  if (kind === 'phone') { plan.clip = 'phone'; plan.until = now + dur(8, 20); }
  else if (kind === 'wait') { plan.clip = 'wait'; plan.until = now + dur(10, 20); }
  else if (kind === 'smoke') { plan.clip = 'smoke'; plan.until = now + dur(12, 24); }
  // A cigarette starts with the hand down, not halfway to the mouth.
  if (plan.clip === 'smoke') plan.ph0 = 0;
  return plan;
}

// When a figure sets off on a new leg. `legT` is how far through the old one they were (1 if they
// were standing). Whatever offset they had from the kerb spot is let go over the new leg, so the walk
// starts from where they were standing and still ends at the kerb spot of the next tile.
export function streetLifeLeg(h, legT) {
  const L = h.life;
  if (!L || !L.k) return;
  if (Number.isFinite(L.sx)) {
    L.r0x = L.sx + (Math.round(h.bx) - h.bx) - L.k.base[0];
    L.r0y = L.sy + (Math.round(h.by) - h.by) - L.k.base[1];
  } else {
    L.r0x *= 1 - legT; L.r0y *= 1 - legT;
  }
  L.sx = L.sy = NaN;
}

// One figure, one frame. Returns the record with `ox, oy` (the offset from the figure's tile
// position to draw them at), `mv` (stepping), `dx, dy` (the way they're stepping), `clip` and `face`
// (a heading to turn to, or null to hold), and `cp, ph0` (the clip's phase origin in ms, and its
// phase there). `walking` and `legT` are the walk's own: on a leg between tiles, and how far along.
export function streetLifeStep(geo, win, h, t, cell, rx, ry, walking, legT, now) {
  const L = lifeOf(h, geo, t);
  const k = frameFor(geo, win, h, t, L, cell, rx, ry);
  const dt = L.t ? clamp((now - L.t) / 1000, 0, 0.25) : 0;
  L.t = now; L.seen = true;
  if (walking) {
    const r = 1 - legT;
    L.sx = L.sy = NaN; L.plan = null; L.grp = null;
    L.ox = k.base[0] + L.r0x * r; L.oy = k.base[1] + L.r0y * r;
    L.mv = true; L.dx = h.bx - h.ax - L.r0x; L.dy = h.by - h.ay - L.r0y;
    L.face = null; L.clip = 'walk';
    return L;
  }
  const fx = Math.round(h.bx) - h.bx, fy = Math.round(h.by) - h.by;
  if (!Number.isFinite(L.sx)) {
    L.sx = k.base[0] - fx; L.sy = k.base[1] - fy;
    L.r0x = L.r0y = 0; L.arr = now; L.plan = null;
  }
  let tx = L.sx, ty = L.sy, face = null, clip = 'idle', speed = LIFE.shuffle;
  L.cp = 0; L.ph0 = geo.hash(t, 29);
  if (h.gone) {
    // Leaving: they stay where they stood and windshield.js walks them to the door.
  } else if (L.grp) {
    ({ tx, ty, face, clip } = ringSpot(geo, L, k, t, now));
    L.plan = null;
  } else if (now - L.arr >= settleMs(L)) {
    if (!L.plan || now >= L.plan.until) L.plan = nextPlan(geo, L, k, t, now);
    const p = L.plan;
    tx = p.tx; ty = p.ty; face = p.face; clip = p.clip; speed = p.speed;
    L.cp = p.t0; L.ph0 = p.ph0;
  }
  if (L.snap) { L.sx = tx; L.sy = ty; L.snap = false; }
  const ddx = tx - L.sx, ddy = ty - L.sy, d = Math.hypot(ddx, ddy);
  if (d > 0.003) {
    const s = Math.min(d, speed * dt);
    L.sx += ddx / d * s; L.sy += ddy / d * s;
    L.mv = true; L.dx = ddx; L.dy = ddy;
  } else {
    L.sx = tx; L.sy = ty; L.mv = false;
  }
  L.ox = L.sx + fx; L.oy = L.sy + fy;
  L.face = face; L.clip = L.mv ? 'walk' : clip;
  return L;
}
