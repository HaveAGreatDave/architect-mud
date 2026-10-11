/**
 * DEADBALL — the field, in feet.
 *
 * Home plate at the origin, +z out to centre field, +x toward third base, y up. Every module
 * of the 3-D park (the Grandstand) shares this frame. What the rules fix is regulation:
 * ninety feet between the bags, the rubber 60 ft 6 in from the point of the plate. The rest
 * is the venue's (sports_pools.venue), with the defaults here until a venue says otherwise.
 *
 * Pure: no DOM and no GL, so the gates run it in Node.
 */

export const DEG = Math.PI / 180;
export const BASE_PATH = 90;
const D = BASE_PATH / Math.SQRT2;
// The bags' centres. +x is the third-base side, so first base is on -x.
export const BAGS = Object.freeze({ 1: [-D, 0, D], 2: [0, 0, 2 * D], 3: [D, 0, D] });
// The mound's centre on the ground (x, z), and the rubber's centre in 3-D.
export const MOUND = Object.freeze([0, 59.5]);
export const RUBBER = Object.freeze([0, 0.86, 60.75]);

// The mound: a ten-inch rise round the rubber falling off to the infield grass.
export function moundHeight(x, z) {
  const r = Math.hypot(x - MOUND[0], z - MOUND[1]);
  return 0.853 * Math.pow(Math.min(1, Math.max(0, (9 - r) / 6.2)), 1.15) - 0.02;
}
export const groundHeight = (x, z) => Math.max(0, moundHeight(x, z));

// The venue's defaults: a fence 330 ft down the lines and 400 to centre, 9.5 ft high; the
// scoreboard behind right-centre; six light towers, four of them casting the night's shadows.
export const VENUE_DEFAULTS = Object.freeze({
  fence: Object.freeze({ line: 330, centre: 400, curve: 1.6, height: 9.5 }),
  board: Object.freeze({ bearing: -31, r: 420 }),
  towers: Object.freeze([
    { base: [-190, 0, 20], h: 150, aim: [0, 0, 110] },
    { base: [190, 0, 20], h: 150, aim: [0, 0, 110] },
    { base: [-245, 0, 300], h: 155, aim: [0, 0, 150] },
    { base: [245, 0, 300], h: 155, aim: [0, 0, 150] },
    { base: [-110, 0, -150], h: 125, aim: [0, 0, 60] },
    { base: [110, 0, -150], h: 125, aim: [0, 0, 60] },
  ]),
  // The lamps that work. The booth says the lights work about sixty percent of the time,
  // so each tower's bank of 24 is dealt from this seed until a venue lists its own.
  lampSeed: 909,
  lampsLit: 0.62,
});

// A venue's field: the defaults with whatever the venue overrides.
export function venueField(venue) {
  const v = venue || {};
  return {
    fence: { ...VENUE_DEFAULTS.fence, ...(v.fence || {}) },
    board: { ...VENUE_DEFAULTS.board, ...(v.board || {}) },
    towers: towersOf(Array.isArray(v.towers) && v.towers.length ? v.towers : VENUE_DEFAULTS.towers, v),
  };
}

// The fence's distance from the plate at bearing `theta` (radians from straight-away centre,
// positive toward third), from the venue's line and centre distances.
export function fenceDistance(theta, fence = VENUE_DEFAULTS.fence) {
  const t = Math.min(1, Math.abs(theta) / (Math.PI / 4));
  return fence.centre - (fence.centre - fence.line) * Math.pow(t, fence.curve);
}

// A small seeded stream (mulberry32), so a park is the same on every TV.
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each tower's lamp bank: where it hangs, where it points, and which of its 24 lamps work.
function towersOf(list, v) {
  const r = seeded(v.lampSeed ?? VENUE_DEFAULTS.lampSeed);
  const lit = v.lampsLit ?? VENUE_DEFAULTS.lampsLit;
  return list.map((t) => {
    const lamp = [t.base[0], t.h, t.base[2]];
    const d = [t.aim[0] - lamp[0], t.aim[1] - lamp[1], t.aim[2] - lamp[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const live = Array.isArray(t.live) ? t.live.slice(0, 24) : Array.from({ length: 24 }, () => r() < lit);
    return { base: t.base.slice(), h: t.h, aim: t.aim.slice(), lamp, dir: [d[0] / l, d[1] / l, d[2] / l], live, frac: live.filter(Boolean).length / live.length };
  });
}

// The park's outline on the ground: the bowl and its upper deck along the lines, the
// bleachers, the board behind right-centre and the rear towers. Inside it is the park; the
// city set is cleared from it and the outer wall is built along it.
export function parkOutline(field = venueField()) {
  const P = [];
  const pol = (th, r) => [Math.sin(th) * r, 0, Math.cos(th) * r];
  const line = (side, s, d) => [side * (s + d) / Math.SQRT2, 0, (s - d) / Math.SQRT2];
  const boardTh = field.board.bearing, boardR = field.board.r;
  for (let k = 0; k <= 18; k++) P.push(pol((-112.5 - 135 * k / 18) * DEG, 192));
  P.push(line(1, 62, 150), line(1, 251, 150), line(1, 251, 112), line(1, 322, 112));
  for (let d = 44; d >= -44; d -= 1) {
    let r = fenceDistance(d * DEG, field.fence) + (Math.abs(d) < 8 ? 12 : 42);
    if (Math.abs(d - boardTh) <= 8) r = Math.max(r, boardR + 8);
    P.push(pol(d * DEG, r));
  }
  P.push(line(-1, 322, 112), line(-1, 251, 112), line(-1, 251, 150), line(-1, 62, 150));
  return P;
}

// Whether a ground point is inside the outline, or within `margin` feet of it.
export function insideOutline(outline, p, margin = 0) {
  const x = p[0], z = p[2];
  let c = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const xi = outline[i][0], zi = outline[i][2], xj = outline[j][0], zj = outline[j][2];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  if (c || margin <= 0) return c;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const abx = b[0] - a[0], abz = b[2] - a[2], apx = x - a[0], apz = z - a[2];
    const t = Math.min(1, Math.max(0, (apx * abx + apz * abz) / (abx * abx + abz * abz || 1)));
    if (Math.hypot(apx - abx * t, apz - abz * t) < margin) return true;
  }
  return false;
}
