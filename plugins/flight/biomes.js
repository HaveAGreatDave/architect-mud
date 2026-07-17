// BIOMES — the district/biome derivation service.
//
// The world has no `district`/`terrain`/`biome` field; this infers one per tile from
// the zone id-prefix + a few flags + the inferred danger, matching Coldwater's authored
// geography. It's a pure classifier (no imports, no state) shared by the flight
// renderer (what the ground looks like from the air) and, later, the audio ambience
// (what you hear over each district). Rendering-only — it must never affect gameplay.
//
// biomeOf(zone) where zone = { id, flags, danger } → a biome key (below).
//
// The map (west→east, north→south): Redline radioactive ruins in the NW; a desert
// badlands belt across the west/centre; the Slagworks/Ashway old-industrial in the
// SW; the civic government enclave up top; wealthy uptown North City along Coldwater
// Bay to the NE/E; the Yards freight warehouses on the far east; the sleaze Marquee
// east of centre; a thread of feral parkland through the middle; the rundown City
// Core below it; and old-Coldwater slum-ruins south of the Marquee.

export const BIOMES = [
  'water', 'docks', 'ruins', 'oldcoldwater', 'badlands', 'industrial', 'infra',
  'freight', 'marquee', 'citycore', 'parkland', 'uptown', 'civic', 'airport',
];

// An authored terrain type (flags.terrain, painted in the dev panel) maps to the
// nearest existing ground biome for the flight-sim tint. 'road' is drawn by the
// road channel (flags.icon/artery), not the biome, so it is intentionally absent.
const TERRAIN_BIOME = {
  water: 'water', dock: 'docks', grass: 'parkland',
  asphalt: 'citycore', concrete: 'citycore',
  dirt: 'badlands', sand: 'badlands', gravel: 'badlands',
};

// The tag used for the map/silhouettes — airfields read as 'airport'.
export function biomeOf(zone) {
  if (!zone) return null;
  // The Echelon's exterior tile carries an airfield_id (for her helipad / VTOL landing) but IS open
  // sea — so its ground must read as WATER, not dark tarmac. Check this before the airfield case, or
  // the floor paints a dark "oil slick" airport-apron square under the hull.
  if (zone.flags?.yacht) return 'water';
  if (zone.flags?.airfield_id) return 'airport';
  return districtBiome(zone);
}

// The underlying DISTRICT, ignoring the airfield flag — so a field's GROUND still
// looks like the district it sits in (Rust Quarter = industrial), with the runway
// drawn as an overlay on top. Used for the ground tint.
export function districtBiome(zone) {
  if (!zone) return null;
  const f = zone.flags || {};
  if (f.terrain && TERRAIN_BIOME[f.terrain]) return TERRAIN_BIOME[f.terrain]; // authored terrain wins the ground tint
  const id = (zone.id || '').toLowerCase();
  const dr = zone.danger;
  const pre = (/^zone_([a-z0-9]+)/.exec(id) || [])[1] || '';

  if (f.water || pre === 'bay') return 'water';                        // Coldwater Bay
  if (pre === 'dock') return 'docks';
  if (pre === 'red' || dr === 'lethal') return 'ruins';               // the Redline, radioactive
  if (id === 'zone_ruins' || pre === 'slums' || pre === 'velk') return 'oldcoldwater';  // rundown slum-ruins
  if (pre === 'powerplantnew') return 'infra';                        // power station
  if (/^(slag|ashway|meat|outskirts)$/.test(pre)) return 'industrial'; // ashen old industrial
  if (/^(waste|deep)$/.test(pre)) return 'badlands';                  // desert spoil / scrap flats
  if (/^(yard|warehouse)$/.test(pre)) return 'freight';               // the Yards — warehouses
  if (pre === 'mq' || pre === 'weapons') return 'marquee';           // sleaze downtown
  if (pre === 'gov') return 'civic';                                  // government enclave
  if (/^(nc|corp|meridian)$/.test(pre)) return 'uptown';             // wealthy North City / high-tech
  if (/^(badland|civ)$/.test(pre)) return 'parkland';                // deteriorated green
  if (/^(city|thresholdeast|drum|media|ext|up|threshold)$/.test(pre)) return 'citycore';
  return dr === 'safe' ? 'citycore' : 'badlands';                     // sensible fallback
}
