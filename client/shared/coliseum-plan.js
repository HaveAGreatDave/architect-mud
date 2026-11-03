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
