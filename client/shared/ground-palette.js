// The ground palette: what each biome's bare ground reads as from the air. Moved out of
// client/game/js/panels/windshield.js so the world map and the wildlands colouring use the same
// numbers as the flight floor; the comments below are the renderer's own.
export const BIOME_GROUND = {
  badlands: [150, 112, 72], water: [34, 62, 88], docks: [54, 90, 54],
  ruins: [78, 98, 56], oldcoldwater: [56, 94, 52], industrial: [52, 86, 48],
  infra: [54, 92, 50], freight: [54, 90, 50], marquee: [58, 96, 54],
  citycore: [56, 96, 52], parkland: [58, 92, 54], park: [52, 112, 50], uptown: [60, 104, 56], civic: [58, 98, 54],
  // Closed-canopy woodland: darker and bluer than parkland turf, so a forest reads as shade
  // from the air even before the tree stand on top of it resolves out of the fog.
  forest: [34, 66, 38],
  airport: [60, 64, 60],
  // Arid wildlands beyond the Curtain: dry olive scrub, rust-red mesa, burnt ash flats.
  scrub: [126, 120, 78], redrock: [150, 82, 54], ash: [84, 80, 74],
  // Badlands accents: pale cracked lakebed, near-white salt crust, dark canyon rim. Alkali is
  // deliberately the brightest ground in the game — from the air it should look like a hole
  // in the rust, which is exactly what a dry salt pan looks like.
  // cliff/plateau are ONE landform lit two ways: the caprock top takes the sun, the face
  // beneath it does not. Both sit deliberately in the redrock family ([150,82,54]) — the
  // massif rises out of the country around it, so a hue unrelated to that country would
  // read as a fence somebody built rather than as ground.
  // ⚠ AND THE CAPROCK HAD BEEN DARKER THAN THE PLAIN IT STANDS ON, which is the opposite of
  // both sentences above. A mesa top and the flat beside it are the same rock under the same sun
  // — what is dark on a butte is its FACE — and plateau sat at a luminance of 55 against
  // redrock’s 99, so a cliff tile’s cap resolved to 73: every massif in the world read as a dark
  // stain on a bright plain rather than as ground standing up out of it, top, face and apron all
  // at once. The cap is now a shade PALER than the plain, as a hard caprock bed is, and the drop
  // to the face tone below is what carries the landform.
  hardpan: [184, 171, 144], alkali: [217, 213, 200], cliff: [92, 50, 36], plateau: [164, 97, 65],
  // The volcanic set. basalt is the darkest ground in the game on purpose — fresh lava rock eats
  // light, and a volcanic flat that reads as merely "grey" is just ash again. sinter is the pale
  // mineral apron a vent lays down; hotspring is deliberately NOT the bay's blue (it is milky with
  // dissolved mineral, and the difference is the point).
  basalt: [51, 50, 58], deadwood: [74, 64, 52], sinter: [201, 184, 120], hotspring: [63, 139, 132],
  // Painted paved surfaces (flags.terrain): dark tarmac, pale concrete slab, weathered
  // dock planking. Deliberately NOT in GRASS_BIOMES, so they take the concrete-checker
  // material and read as pavement instead of turf.
  asphalt: [58, 60, 66], concrete: [108, 112, 116], pier: [96, 78, 54],
  // The wildlands (client/shared/wildlands.js). scarlet is the Scarletwastes' own red, deeper than
  // the rust mesa it spreads into; lava is Mount Cinder's crater and live flows, the one ground in
  // the game brighter in red than anything a sign paints.
  scarlet: [168, 70, 48], lava: [214, 92, 34],
};
