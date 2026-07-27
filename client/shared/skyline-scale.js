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
export const TYPE_FLOORS = {
  corporate_office: 22, hotel: 6, apartment: 8, residential: 4, shop: 3, diner: 2,
  bar: 2, club: 3, studio: 4, police: 4, clinic: 4, power: 5, hangar: 1, civic: 6,
  gun_shop: 2, casino: 3, fence: 2, chem_supply: 3, default: 4,
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
