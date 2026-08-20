// How tall and how wide a Coldwater building is — the SSOT for building mass.
//
// This used to live inside windshield.js, which was fine while the flight sim was
// the only thing that drew a building. It isn't any more: the cold open's closing
// flythrough (client/game/js/panels/intro-cinematic.js) renders the SAME skyline
// as a wireframe, and a first-login path must not import the ~8000-line flight
// renderer to find out how many storeys a hotel has. So the numbers moved here —
// a file with no imports and no side effects — and both renderers read them.
//
// Change a floor count here and BOTH the flight sim's solid tower and the cold
// open's wireframe of it change together, which is the entire point. Note that
// the flight sim's collision sweep (cockpit.js) keys off the same values via
// buildingHeightZ, so raising a type's floors raises what you can fly into.

// Floors by building type, when the tile carries no authored `flags.floors`.
// Nudged UP for the low-rise commercial/civic types: a 1-storey pancake in a
// dense ~50-year-future city reads wrong, so a corner shop is small-mixed-use, a
// soundstage a tall clear-span volume, a bar/club a couple of storeys.
//
// ⚠ A FORECOURT IS ONE STOREY, AND LEAVING IT OUT OF THIS TABLE IS WHAT MADE IT ENORMOUS.
// `fuel_yard` had no row, so it fell to `default: 4` and every fraction inside its model arm — the
// canopy clearance, the dispensers, the tank, the price pylon — was measured against a FOUR-STOREY
// building. The pumps came out about the height of a house and the canopy sat two storeys up, which
// is the "gas pumps are massive" report. Nothing was wrong with the model's proportions; the number
// they were proportional to was. A type whose whole mass is a roof over a truck belongs here
// explicitly, and the arm now spends multiples of `h` above 1.0 where it means to (a canopy is
// taller than a storey, a price pylon much taller) rather than fractions of a number four times
// too big.
export const TYPE_FLOORS = {
  corporate_office: 22, hotel: 6, apartment: 8, residential: 4, shop: 3, diner: 2,
  bar: 2, club: 3, studio: 4, police: 4, clinic: 4, power: 5, hangar: 1,
  // ⚠ CIVIC WAS 6, AND THE ⚠ ABOVE IS EXACTLY WHY THAT MATTERED. Seven of the eight buildings that
  // carry building_type 'civic' are in Terminus and the Thornwarren — a nursery, an assembly hall,
  // two checkpoints, a song house, a lookout and a birthing room — and every fraction inside their
  // model arms was being measured against a SIX-STOREY building.
  // The EIGHTH is Coldwater's own Paper Tomb, which this row would also have moved. It carries an
  // authored flags.floors instead, so it no longer depends on this default either way.
  civic: 2,
  // The three walls. `ruins` had no row, so 148 tiles of rampart, thorn and dam were four storeys
  // tall — which is the same failure the forecourt hit, on a bigger footprint.
  ruins: 2,
  // The other types that exist ONLY outside Coldwater and had no row, so every one of them was
  // being drawn against a four-storey number: a water store, a flywheel house, a vat room, a
  // cupola and a kiln. Checked before setting — no Coldwater building carries any of these.
  infra: 2, dynamo: 2, clone: 3, foundry: 3, industrial: 3,
  gun_shop: 2, casino: 3, fence: 2, chem_supply: 3, fuel_yard: 1, default: 4,
};

// World-z height of one storey, in tile units. Vertically stretched (taller
// storeys) so buildings stand up off the deck instead of reading flat — not more
// floors, just taller ones.
export const FLOOR_Z = 0.028;

// Building footprint half-width in tile units — a building fills most of its own
// tile, with a real setback (a sidewalk) so it doesn't touch its neighbour or
// spill onto the road on the next tile.
export const BUILDING_FOOT = 0.38;

// The one floor-count rule. `flr` is the authored `flags.floors` override.
export function floorsFor(type, flr) {
  if (flr > 0) return flr;
  return TYPE_FLOORS[type] || TYPE_FLOORS.default;
}
