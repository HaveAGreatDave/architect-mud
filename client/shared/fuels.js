// WHAT AN AIRCRAFT RUNS ON, AND WHAT THE PUMPS CALL IT.
//
// An aircraft type's `fuel_type` and an airfield's `fuels` list are these ids. The fleet is 2070s
// equipment (docs/story.md): light craft and the Dragonfly run on battery charge, the freighters and
// the Drake on hydrogen, the military on jet fuel, and the edge of the map on biofuel. Avgas is the
// old world's: nothing flying burns it any more, and a cache of it is a relic.
//
// Read by the server (the pumps and their messages) and the client (the hangar), so one word for each.
export const FUEL_NAMES = { charge: 'charge', hydrogen: 'hydrogen', jet: 'jet fuel', biofuel: 'biofuel', avgas: 'avgas' };
export const fuelName = (id) => FUEL_NAMES[id] || String(id || 'fuel');
// A list of fuels as a field would say it: "charge, hydrogen and jet fuel".
export function fuelList(ids) {
  const n = (ids || []).map(fuelName);
  return n.length <= 1 ? (n[0] || 'nothing') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
}
