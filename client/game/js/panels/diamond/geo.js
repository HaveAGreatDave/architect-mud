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
// Foul ground: the lower bowl's rail stands this far off either line, and the backstop this far
// behind the plate, a straight wall across the back that meets the curve of the bowl either side
// (gl/ballpark-mesh.js bowlPath), so the Diamond Club sits close behind the catcher. The park's
// mesh builds them here and a foul pop comes down inside them.
export const FOUL_GROUND = Object.freeze({ line: 44, back: 44 });
// The dugouts: one each side, let into the lower bowl's front from `from` to `to` feet along the
// line, `deep` feet back under the stands. The bowl's first rows are lifted `raise` feet over it,
// eased back down over the rows behind (gl/ballpark-mesh.js stands), so the recess stands at field
// level with its roof `FOUL_GROUND`'s front wall height and `raise` over it. A side's men stand in
// it in a row `stand` feet in, from `first` along the line, `step` feet apart (bases.js
// dugoutSpot). The third-base side is +x.
export const DUGOUT = Object.freeze({ from: 70, to: 126, deep: 10.8, raise: 3.5, stand: 5.5, first: 74, step: 5 });
// A point `s` feet along a line from home and `off` feet out from the line, on `side` (+1 the
// third-base line, -1 the first).
export const offLine = (side, s, off) => [side * (s + off) / Math.SQRT2, 0, (s - off) / Math.SQRT2];
export const RUBBER = Object.freeze([0, 0.86, 60.75]);

// The mound: a ten-inch rise round the rubber falling off to the infield grass.
export function moundHeight(x, z) {
  const r = Math.hypot(x - MOUND[0], z - MOUND[1]);
  return 0.853 * Math.pow(Math.min(1, Math.max(0, (9 - r) / 6.2)), 1.15) - 0.02;
}
export const groundHeight = (x, z) => Math.max(0, moundHeight(x, z));

// ── THE BOWL ────────────────────────────────────────────────────────────────
// The Charles B. Hughson Coliseum as the map draws it (glass/models/coliseum.js), at the
// broadcast's size: one square wall along the foul lines, as the map's park stands on the tile
// grid, its outer face `near` feet behind home on the two near sides and `far` feet out on the two
// far ones. The map packs the park into nine tiles, so the broadcast takes its plan from the bowl,
// not from the field: the map's block coordinates (tiles from the block's centre, u east, v south)
// go to the bowl's feet by `fromBlock`, and its heights by `ftUp` (its cornice at 0.46 tiles is
// 104 ft). The field and the stands are the broadcast's own.
//
// The bowl's frame: `s3` feet along the third-base line, `s1` feet along the first-base line. The
// map's u (east) runs to -s3 and its v (south) to -s1, so Sorrel Way and the main gate are on the
// s1 = -near face, Halcyon Boulevard on the s1 = far one, and the roof's rails run along s1.
export const BOWL = Object.freeze({ near: 168, far: 445 });
export const sf = (s3, s1, y = 0) => [(s3 - s1) / Math.SQRT2, y, (s3 + s1) / Math.SQRT2];
export const sOf = (p) => [(p[0] + p[2]) / Math.SQRT2, (p[2] - p[0]) / Math.SQRT2];
export const fromBlock = (w) => -BOWL.near + ((1.47 - w) / 2.94) * (BOWL.near + BOWL.far);
export const ftUp = (z) => z * 226;
// The light towers at the corners (the map's TOWER.at, 1.37 tiles out) and the lamp rows under the
// two decks the roof's rails run along (its DECK, 1.13), at the height of the map's deck lamps.
const TOWER_AT = [fromBlock(1.37), fromBlock(-1.37)], DECK_AT = [fromBlock(1.13), fromBlock(-1.13)];
const LAMP_Y = ftUp(0.816), DECK_LAMP_Y = ftUp(0.415), DECK_MID = (fromBlock(1.26) + fromBlock(-1.26)) / 2;

// The venue's defaults: a fence 330 ft down the lines and 400 to centre, 9.5 ft high; the
// scoreboard behind right-centre; and the lights, four towers at the corners of the bowl and a lamp
// row under each deck. The four towers cast the night's shadows. With the roof shut they're outside
// it, so each tower's light moves to the lamps under a deck (`under`, ballpark-mesh.js roofLights).
export const VENUE_DEFAULTS = Object.freeze({
  fence: Object.freeze({ line: 330, centre: 400, curve: 1.6, height: 9.5 }),
  board: Object.freeze({ bearing: -31, r: 420 }),
  towers: Object.freeze([
    { kind: 'tower', base: sf(TOWER_AT[0], TOWER_AT[1]), h: LAMP_Y, aim: [0, 0, 120], under: sf(DECK_AT[0], 260, DECK_LAMP_Y) },
    { kind: 'tower', base: sf(TOWER_AT[1], TOWER_AT[0]), h: LAMP_Y, aim: [0, 0, 120], under: sf(DECK_AT[1], 40, DECK_LAMP_Y) },
    { kind: 'tower', base: sf(TOWER_AT[0], TOWER_AT[0]), h: LAMP_Y, aim: [0, 0, 110], under: sf(DECK_AT[0], 40, DECK_LAMP_Y) },
    { kind: 'tower', base: sf(TOWER_AT[1], TOWER_AT[1]), h: LAMP_Y, aim: [0, 0, 170], under: sf(DECK_AT[1], 260, DECK_LAMP_Y) },
    { kind: 'deck', base: sf(DECK_AT[0], DECK_MID), h: DECK_LAMP_Y, aim: [0, 0, 150] },
    { kind: 'deck', base: sf(DECK_AT[1], DECK_MID), h: DECK_LAMP_Y, aim: [0, 0, 150] },
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
    // where its light comes from with the roof shut, and which way it points from there
    let under = null;
    if (Array.isArray(t.under)) {
      const u = [t.aim[0] - t.under[0], t.aim[1] - t.under[1], t.aim[2] - t.under[2]], ul = Math.hypot(u[0], u[1], u[2]) || 1;
      under = { lamp: t.under.slice(), dir: [u[0] / ul, u[1] / ul, u[2] / ul] };
    }
    return { kind: t.kind || 'tower', base: t.base.slice(), h: t.h, aim: t.aim.slice(), lamp, dir: [d[0] / l, d[1] / l, d[2] / l], under, live, frac: live.filter(Boolean).length / live.length };
  });
}

// The park's outline on the ground: the bowl's outer face (BOWL), a square on the foul lines, from
// the corner behind home out along the first-base side, across the boulevard face past centre
// field, back down the third-base side and along Sorrel Way. Inside it is the park; the city set is
// cleared from it and the bowl's wall is built along it. A venue's own fence and board stand inside
// the same bowl, so `field` doesn't move it.
export function parkOutline(field = venueField()) {
  void field;
  const n = -BOWL.near, f = BOWL.far;
  return [sf(n, n), sf(n, f), sf(f, f), sf(f, n)];
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
