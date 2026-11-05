// The Charles B. Hughson Coliseum's plan, for the map, the broadcast and the skyline.
//
// The park is drawn in PARK UNITS: u east and v south of the block's centre, its bowl's outer face at
// OUT (1.47) and its cornice at 0.46 up. The numbers were drawn that way for the nine-tile park and
// every measured gap in the bowl and the roof was tuned in them, so they stay. What a unit is depends
// on who's drawing (docs/proposals/coliseum-five-tiles.md):
//
//   on TV:      one unit is UNIT_FT (208.5 ft) across and UP_FT (226 ft) up, the park's true size;
//   on the map: one unit is SH tiles across and SV tiles up, the park at five tiles.
//
// ⚠ THE MAP'S PARK IS THE TV'S DRAWN SMALLER, ON PURPOSE. Coldwater's towers are about 14 m across,
// a third of a real tower's width, so a park at true size stood 13 towers wide; at five tiles it's
// six. So the map's arm (client/game/js/panels/glass/models/coliseum.js) reads SH and SV, the
// broadcast (gl/ballpark-mesh.js, diamond/geo.js) reads UNIT_FT and UP_FT, and neither reads the
// other's. Height keeps the unit's proportion, so nothing round goes oval between the two.
//
// Pure: no DOM and no GL, so the gates run it in Node.

// The bowl, a square on the foul lines: its outer face `near` feet behind home on the two near
// sides (Sorrel Way and the east) and `far` feet out on the two far ones.
export const BOWL_FT = Object.freeze({ near: 168, far: 445 });
export const OUT = 1.47;
export const UNIT_FT = (BOWL_FT.near + BOWL_FT.far) / (2 * OUT);
export const UP_FT = 226;

// The block: 5 tiles a side, x 891-895 and y 914-918, on Sir Charles's lot with its home plate a
// quarter tile from the broadcast's (the Deadball row's sports_pools.venue.site says the same). A block is three park units across, as the
// nine-tile park's was, which is what leaves the gates their gap to the tile's edge.
export const BLOCK = 5;
export const HALF = BLOCK / 2;
export const SH = BLOCK / 3;
export const SV = SH * UP_FT / UNIT_FT;

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
// dome's girders; a marble fin at every FIN_AT along each face; a stepped light tower at each corner,
// `at` out; the Guardians either side of the main gate; and the plain stone band his name is cut into.
export const BACK = 1.40;
export const DECK = 1.13;
export const Z = Object.freeze({ plinth: 0.04, wall: 0.34, frieze: 0.37, cler: 0.43, corn: 0.46 });

// ── THE HUGHSON DOME ─────────────────────────────────────────────────────────────────────────
// Three shells on rails, a clamshell the way the SkyDome is: stepped barrel vaults from the east deck
// to the west, each smaller and lower than the one before. The first is fixed over the bleachers on
// the boulevard side; the other two ride the rails north and nest under it, so the roof opens from
// Sorrel Way and the field and the grandstand have the sky. Each vault steps: its arch sets back three
// times on the way up (`steps`, a riser each), so it's a ziggurat end on, and bronze ribs follow it.
//
// ⚠ A SHELL NESTS BY ITS LEVEL `k`. Shell k is the top shell's arch taken `dr` in and set `g` lower:
// z_k(r) = z_0(r + k·dr) - k·g. The profile never rises outward, so each level clears the one over it
// by at least `g` everywhere, and its risers stand `dr` inside the ones over it. A rib stands `rib`
// proud, under `g`, so it passes under the shell over it.
// ⚠ THE FOOT STAYS INSIDE THE TOWERS. R0 is 1.22 because a corner tower's inner side is 1.265 and the
// vaults run the whole length of the bowl, past all four.
// ⚠ THE CROWN STANDS AT 0.85 FOR THE SKYLINE. From the field the Halcyon and Ascendant towers stand over
// the roof and through its glass, and they're the picture this park is known for. At 1.05 the vault
// shut them out. Raise H or zs and look from home plate before anything else.
// `shut` and `open` are where a shell's north end stands, `len` how long it is. Shut they overlap by
// 0.05, and open they lie 0.02 apart.
const DEG = Math.PI / 180;
export const DOME = Object.freeze({
  R0: 1.22, zs: 0.53, H: 0.23,
  steps: Object.freeze([0.97, 0.68, 0.40]), riser: 0.03, batter: 0.006,
  g: 0.03, dr: 0.03, rib: 0.012, ribW: 0.018,
  // the glazing along each shell, this far either side of the ridge on the top shell: the two upper
  // tiers, so a level's glass ends at its riser and only the shoulders are copper
  glaze: 0.68,
  // the ribs across each shell, as fractions of its length
  ribs: Object.freeze([0.03, 0.265, 0.5, 0.735, 0.97]),
});
export const SHELLS = Object.freeze([
  { key: 'a', k: 0, shut: -1.47, open: -1.47, len: 1.00 },
  { key: 'b', k: 1, shut: -0.52, open: -1.45, len: 1.00 },
  { key: 'c', k: 2, shut: 0.43, open: -1.43, len: 1.04 },
].map((S) => Object.freeze(S)));
// Where shell `i`'s north end stands at `p` (0 open, 1 shut).
export const shellAt = (i, p) => { const S = SHELLS[i], k = Math.min(1, Math.max(0, +p || 0)); return S.open + (S.shut - S.open) * k; };
// Where shell level k springs from.
export const springZ = (k) => DOME.zs - k * DOME.g;
// The top shell's height at r from the ridge: a quarter ellipse from the spring, plus a riser for every
// step the point is inside.
export function domeZ(r) {
  const D = DOME, e = D.zs + D.H * Math.sqrt(Math.max(0, 1 - (r / D.R0) ** 2));
  return e + D.riser * D.steps.filter((s) => s > r).length;
}
// Shell level k's half arch, spring to ridge: [r, z] points outer to inner, a riser at each step. Each
// tier is sampled evenly in the ellipse's angle, so the steep foot gets more points.
export function shellProfile(k = 0) {
  const D = DOME, o = k * D.dr, lo = k * D.g;
  const t = (rho) => Math.acos(Math.min(1, rho / D.R0));
  const edges = [D.R0, ...D.steps, o];
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
// A half arch made whole, west spring to east: [u, z].
export const archOf = (P) => [...P.map(([r, z]) => [-r, z]), ...P.slice(0, -1).reverse()];
export const shellArch = (k = 0) => archOf(shellProfile(k));
// The girder along each deck: a bronze band from the cornice to `z1`, `u0` to `u1` out, with a gilt
// chevron frieze along it between `frieze` (and across the boulevard end). Inside it the rails step
// down and in, one for each level under the top (`rail(k)`: the step's outer edge, inner edge and top).
export const GIRDER = Object.freeze({ u0: DOME.R0, u1: 1.26, z0: Z.corn, z1: 0.54, frieze: Object.freeze([0.472, 0.528]) });
export const rail = (k) => [DOME.R0 - (k - 1) * DOME.dr, DOME.R0 - k * DOME.dr - 0.012, springZ(k)];
// The lantern on the fixed shell's crown, `v` from the block's centre: it can't stand over the middle
// of a roof that slides away. A bronze foot astride the ridge, two stepped drums of glass in bronze
// mullions, a fluted gilt cap, and the finial, a gilt sun with a baseball for its disc and the red
// beacon over it.
export const LANTERN = Object.freeze({
  v: -0.97,
  foot: Object.freeze({ r: 0.19, z0: 0.83, z1: 0.86 }),
  glass: Object.freeze([Object.freeze({ r: 0.16, z0: 0.86, z1: 0.91 }), Object.freeze({ r: 0.12, z0: 0.918, z1: 0.948 })]),
  ledge: 0.008, mullions: 12,
  cap: Object.freeze({ r0: 0.135, r1: 0.025, z0: 0.948, z1: 0.99, flutes: 16 }),
  stem: Object.freeze({ r: 0.008, z1: 1.005 }),
  sun: Object.freeze({ z: 1.028, r: 0.022, rays: 12, ray: 0.02 }),
  beacon: 1.062,
});
export const FIN_AT = Object.freeze(Array.from({ length: 11 }, (_, k) => -1.225 + k * 0.245));
export const TOWER = Object.freeze({ at: 1.37, r0: 0.105, z0: 0.62, r1: 0.08, z1: 0.76, r2: 0.062, z2: 0.86, r3: 0.045, z3: 0.905 });
export const GUARD = Object.freeze({ hw: 0.055, top: 0.60 });
export const BAND = Object.freeze({ z0: 0.268, z1: Z.wall, d: 0.026 });

// The gates. The main gate on Sorrel Way stands straight across from home plate, the bleacher gate
// on Hughson Way where the nine-tile park had it, and GATE C and GATE D on the east and west faces,
// C at the end of Kerbstone Row and D on Hughson Way. `face` is the frontispiece's front plane, a hair
// proud of the bowl; `top` its height. Each gate's `v` or `u` puts its middle on its door's tile
// in DOORS, and ballpark-smoke holds the two together.
export const GATE = Object.freeze({ u: HP[0], hw: 0.30, face: 1.48, top: 0.53 });
export const BGATE = Object.freeze({ u: -0.96, hw: 0.24, face: -1.48, top: 0.44 });
export const SIDE_GATES = Object.freeze([
  Object.freeze({ key: 'c', side: 1, v: -1.1025, hw: 0.17, top: 0.40, label: 'GATE C' }),
  Object.freeze({ key: 'd', side: -1, v: -0.843, hw: 0.17, top: 0.40, label: 'GATE D' }),
]);

// The park's tiles, by column and row from the north-west. Four are doors; every other tile is a
// sealed slice of the same building. `type` is the building type GLASS draws it as, `facing` the
// way the slice is authored (a door faces its street), `floors` what the skyline and collision read.
export const DOORS = Object.freeze({
  '3,4': Object.freeze({ type: 'ballpark', facing: 'south', label: 'GRANDSTAND' }),
  '0,0': Object.freeze({ type: 'ballpark_bleachers', facing: 'north', label: 'BLEACHERS' }),
  '4,0': Object.freeze({ type: 'ballpark_gate_c', facing: 'east', label: 'GATE C' }),
  '0,1': Object.freeze({ type: 'ballpark_gate_d', facing: 'west', label: 'GATE D' }),
});
// How tall each tile stands, in storeys: the light towers at the corners (29 m), and the roof over the
// rest, which runs the bowl's whole length: its shoulders on the two outer columns, and the crown
// (28 m) on the three between, with the towers standing over it as they should.
export function tileFloors(bc, br) {
  const corner = (bc === 0 || bc === BLOCK - 1) && (br === 0 || br === BLOCK - 1);
  if (corner) return 8;
  return bc === 0 || bc === BLOCK - 1 ? 7 : 8;
}
export function parkTiles() {
  const out = [];
  for (let br = 0; br < BLOCK; br++) for (let bc = 0; bc < BLOCK; bc++) {
    const d = DOORS[`${bc},${br}`];
    out.push({ bc, br, type: d ? d.type : `ballpark_${bc}_${br}`, facing: d ? d.facing : 'south', door: !!d, floors: tileFloors(bc, br) });
  }
  return out;
}
