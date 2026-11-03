// The Charles B. Hughson Coliseum's plan, for the map, the broadcast and the skyline.
//
// The park is drawn in PARK UNITS: u east and v south of the block's centre, its bowl's outer face at
// OUT (1.47) and its cornice at 0.46 up. The numbers were drawn that way for the nine-tile park and
// every measured gap in the bowl and the roof was tuned in them, so they stay. What changed on
// 2026-11-02 is what a unit is (docs/proposals/coliseum-true-size.md): the park stands on the
// world's ruler now, 11 by 11 tiles, and is the size the broadcast always drew it.
//
//   across: one unit is UNIT_FT (208.5 ft), which is SH tiles on the ruler;
//   up:     one unit is UP_FT (226 ft), which is SV tiles.
//
// So the map's arm (client/game/js/panels/glass/models/coliseum.js) draws a unit as SH tiles across and SV up, and the
// broadcast's bowl (gl/ballpark-mesh.js) as UNIT_FT and UP_FT feet: the same park, by construction.
//
// Pure: no DOM and no GL, so the gates run it in Node.

// The world's ruler: 3.5 m a storey and 0.196 tiles a storey (docs/proposals/world-scale.md).
export const TILE_M = 3.5 / 0.196;
export const TILE_FT = TILE_M / 0.3048;

// The bowl, a square on the foul lines: its outer face `near` feet behind home on the two near
// sides (Sorrel Way and the east) and `far` feet out on the two far ones.
export const BOWL_FT = Object.freeze({ near: 168, far: 445 });
export const OUT = 1.47;
export const UNIT_FT = (BOWL_FT.near + BOWL_FT.far) / (2 * OUT);
export const UP_FT = 226;
export const SH = UNIT_FT / TILE_FT;
export const SV = UP_FT / TILE_FT;

// The block: 11 tiles a side, x 887-897 and y 910-920 (the Deadball row's sports_pools.venue.site
// says the same). A tile's centre in park units, from its column and row.
export const BLOCK = 11;
export const HALF = BLOCK / 2;
export const tileCentre = (bc, br) => [(bc - HALF + 0.5) / SH, (br - HALF + 0.5) / SH];

// Home plate, `near` feet in from Sorrel Way and the east face, and the field round it in the
// broadcast's feet (diamond/geo.js): ninety feet to first, the rubber 60 ft 6 in out, the fence 375
// feet on average, 44 feet of foul ground to the stands.
const ft = (f) => f / UNIT_FT;
export const HP = Object.freeze([OUT - ft(BOWL_FT.near), OUT - ft(BOWL_FT.near)]);
export const FIELD = Object.freeze({
  base: ft(90),
  mound: ft(60.5) / Math.SQRT2,
  wall: ft(375),
  track: ft(15),
  dirt: ft(140),
  foul: ft(44),
});

// The bowl, in park units: one wall round all four sides, its outer face at OUT and its inner at BACK,
// in five courses up (Z); the decks over the east and west concourse reach in to DECK under the
// dome's ring; a marble fin at every FIN_AT along each face; a stepped light tower at each corner,
// `at` out; the Guardians either side of the main gate; and the plain stone band his name is cut into.
export const BACK = 1.40;
export const DECK = 1.13;
export const Z = Object.freeze({ plinth: 0.04, wall: 0.34, frieze: 0.37, cler: 0.43, corn: 0.46 });

// ── THE HUGHSON DOME ─────────────────────────────────────────────────────────────────────────
// Eight leaves like the gores of an orange on a bronze ring, meeting under a glazed lantern. The two
// over the outfield (A and B, either side of centre field) are fixed; the other six turn on the ring
// and nest under them, three a side, so the dome opens from home plate outward. Each leaf steps: its
// profile sets back three times on the way up (`steps`, a riser each), and the rib along its
// trailing edge is a bronze fin that follows it, a ziggurat from the side.
//
// ⚠ A LEAF NESTS BY ITS LEVEL `k`. Leaf k is the top leaf's profile taken `dr` further out and set
// `g` lower: z_k(r) = z_0(r + k·dr) - k·g. The profile never rises outward, so each level clears the
// one over it by at least `g` everywhere, and its risers stand `dr` inside the ones over it. The rib
// stands `rib` proud, under `g`, and sits on the edge that trails as the leaf opens, so no rib ever
// passes through a leaf's edge: each one arrives at the edge over it as the dome finishes opening.
// ⚠ ANGLES ARE ATAN2(v, u): home plate is at 45 degrees (south-east) and centre field at 225.
// `a0`..`a1` is a leaf's span shut, `turn` how far it turns to open (radians, 0 fixed), and `rib`
// which edge carries a rib (0, 1, or both).
const DEG = Math.PI / 180;
export const DOME = Object.freeze({
  R0: 1.33, zs: 0.56, H: 0.40, rL: 0.15,
  steps: Object.freeze([1.06, 0.74, 0.44]), riser: 0.03, batter: 0.006,
  g: 0.03, dr: 0.03, rib: 0.012, ribW: 0.014,
  // a rib stands this far in from its edge, so nested under the leaf over it, its side never shares
  // the plane of that leaf's fascia
  ribIn: 0.002,
  // the glazing strip down the middle of each leaf, as a fraction of its width
  glaze: Object.freeze([0.4, 0.6]),
});
export const LEAVES = Object.freeze([
  { key: 'A', a0: 180, a1: 225, k: 0, turn: 0, rib: [true, true] },
  { key: 'B', a0: 225, a1: 270, k: 0, turn: 0, rib: [false, true] },
  { key: 'a1', a0: 135, a1: 180, k: 1, turn: 45, rib: [true, false] },
  { key: 'a2', a0: 90, a1: 135, k: 2, turn: 90, rib: [true, false] },
  { key: 'a3', a0: 45, a1: 90, k: 3, turn: 135, rib: [true, false] },
  { key: 'b1', a0: 270, a1: 315, k: 1, turn: -45, rib: [false, true] },
  { key: 'b2', a0: 315, a1: 360, k: 2, turn: -90, rib: [false, true] },
  { key: 'b3', a0: 360, a1: 405, k: 3, turn: -135, rib: [false, false] },
].map((L) => Object.freeze({ ...L, a0: L.a0 * DEG, a1: L.a1 * DEG, turn: L.turn * DEG, rib: Object.freeze(L.rib) })));
// How far leaf `i` has turned from shut at `p` (0 open, 1 shut), in radians about the block's centre.
export const leafTurn = (i, p) => (LEAVES[i] ? LEAVES[i].turn * (1 - Math.min(1, Math.max(0, +p || 0))) : 0);
// The top leaf's height at radius r: a quarter ellipse from the spring, plus a riser for every step
// the point is inside.
export function domeZ(r) {
  const D = DOME, e = D.zs + D.H * Math.sqrt(Math.max(0, 1 - (r / D.R0) ** 2));
  return e + D.riser * D.steps.filter((s) => s > r).length;
}
// Leaf level k's profile, spring to lantern: [r, z] points outer to inner, a riser at each step.
// Each tier is sampled evenly in the ellipse's angle, so the steep foot gets more points.
export function leafProfile(k = 0) {
  const D = DOME, o = k * D.dr, lo = k * D.g;
  const t = (rho) => Math.acos(Math.min(1, rho / D.R0));
  const edges = [D.R0, ...D.steps, D.rL + o];
  const out = [];
  for (let j = 0; j + 1 < edges.length; j++) {
    const a = t(edges[j]), b = t(edges[j + 1]), n = Math.max(2, Math.ceil((b - a) / (8 * DEG)));
    // a tier starts at the top of its riser, which leans back a little so it isn't a seam; the
    // tier under it ended at the riser's foot
    const r0 = j ? edges[j] - D.batter : edges[j];
    for (let i = 0; i <= n; i++) {
      const rho = i === 0 ? r0 : D.R0 * Math.cos(a + (b - a) * i / n);
      out.push([rho - o, domeZ(rho) - lo]);
    }
  }
  return out;
}
// The ring the leaves turn on: a bronze band from the cornice to `z1`, `r0` to `r1` out, a gilt
// chevron frieze round it between `frieze`, and inside it the rails stepping down and in, one for each
// level under the top (`rail(k)`: the step's outer radius, inner radius and top).
export const RING = Object.freeze({ r0: DOME.R0, r1: 1.37, z0: Z.corn, z1: 0.57, frieze: Object.freeze([0.50, 0.548]), n: 48 });
export const rail = (k) => [DOME.R0 - (k - 1) * DOME.dr, DOME.R0 - k * DOME.dr - 0.012, DOME.zs - k * DOME.g];
// The roof over the drum's corners, from the ring out to the wall, a hair over the decks' copper.
export const CORNER_Z = Z.corn + 0.006;
// The lantern at the crown: a bronze foot over the leaves' tips, two stepped drums of glass in bronze
// mullions, a fluted gilt cap, and the finial, a gilt sun with a baseball for its disc and the red
// beacon over it.
export const LANTERN = Object.freeze({
  foot: Object.freeze({ r: 0.19, z0: 0.95, z1: 1.06 }),
  glass: Object.freeze([Object.freeze({ r: 0.16, z0: 1.06, z1: 1.11 }), Object.freeze({ r: 0.12, z0: 1.118, z1: 1.148 })]),
  ledge: 0.008, mullions: 12,
  cap: Object.freeze({ r0: 0.135, r1: 0.025, z0: 1.148, z1: 1.19, flutes: 16 }),
  stem: Object.freeze({ r: 0.008, z1: 1.205 }),
  sun: Object.freeze({ z: 1.228, r: 0.022, rays: 12, ray: 0.02 }),
  beacon: 1.262,
});
export const FIN_AT = Object.freeze(Array.from({ length: 11 }, (_, k) => -1.225 + k * 0.245));
export const TOWER = Object.freeze({ at: 1.37, r0: 0.105, z0: 0.62, r1: 0.08, z1: 0.76, r2: 0.062, z2: 0.86, r3: 0.045, z3: 0.905 });
export const GUARD = Object.freeze({ hw: 0.055, top: 0.60 });
export const BAND = Object.freeze({ z0: 0.268, z1: Z.wall, d: 0.026 });

// The gates. The main gate on Sorrel Way stands straight across from home plate, the bleacher gate
// on Halcyon Boulevard where the nine-tile park had it, and GATE C and GATE D on the east and west
// faces, at the Cart Yard and on the river road. `face` is the frontispiece's front plane, a hair
// proud of the bowl; `top` its height.
export const GATE = Object.freeze({ u: HP[0], hw: 0.30, face: 1.48, top: 0.53 });
export const BGATE = Object.freeze({ u: -0.96, hw: 0.24, face: -1.48, top: 0.44 });
export const SIDE_GATES = Object.freeze([
  Object.freeze({ key: 'c', side: 1, v: tileCentre(10, 2)[1], hw: 0.17, top: 0.40, label: 'GATE C' }),
  Object.freeze({ key: 'd', side: -1, v: tileCentre(0, 2)[1], hw: 0.17, top: 0.40, label: 'GATE D' }),
]);

// The park's tiles, by column and row from the north-west. Four are doors; every other tile is a
// sealed slice of the same building. `type` is the building type GLASS draws it as, `facing` the
// way the slice is authored (a door faces its street), `floors` what the skyline and collision read.
export const DOORS = Object.freeze({
  '7,10': Object.freeze({ type: 'ballpark', facing: 'south', label: 'GRANDSTAND' }),
  '2,0': Object.freeze({ type: 'ballpark_bleachers', facing: 'north', label: 'BLEACHERS' }),
  '10,2': Object.freeze({ type: 'ballpark_gate_c', facing: 'east', label: 'GATE C' }),
  '0,2': Object.freeze({ type: 'ballpark_gate_d', facing: 'west', label: 'GATE D' }),
});
// How tall each tile stands, in storeys: the light towers at the corners, the bowl wall round the
// rim, and the roof over the rest, highest over the middle.
export function tileFloors(bc, br) {
  const edge = Math.min(bc, br, BLOCK - 1 - bc, BLOCK - 1 - br);
  const corner = (bc === 0 || bc === BLOCK - 1) && (br === 0 || br === BLOCK - 1);
  if (corner) return 18;
  if (edge === 0) return 10;
  return 17;
}
export function parkTiles() {
  const out = [];
  for (let br = 0; br < BLOCK; br++) for (let bc = 0; bc < BLOCK; bc++) {
    const d = DOORS[`${bc},${br}`];
    out.push({ bc, br, type: d ? d.type : `ballpark_${bc}_${br}`, facing: d ? d.facing : 'south', door: !!d, floors: tileFloors(bc, br) });
  }
  return out;
}
