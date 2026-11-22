// THE GARROW BUSTARD'S BODY, GLASS AND DOORS, STATED ONCE.
//
// Two things are built off this: the exterior (scripts/shapes/concepts/bustard.mjs writes
// mesh_bustard.json from it) and the cockpit (interior-bustard.js derives the room from it). The
// arithmetic is cabin-hovercar.js.
//
// The Bustard is Garrow Motor Works' two-seat muscle car (docs/proposals/hover-cars.md): square and
// wide, a blunt upright nose that is all grille, a long flat bonnet, a high waist under a short strip
// of glass, a short deck and a flat tail. The fans are the biggest in the class. Scissor doors that
// lift on their front edge, because a door that swung out would foul the fan beside it.
import { makeCabin } from './cabin-hovercar.js';

export const BUSTARD = makeCabin({
  id: 'bustard',
  // Nose to tail, every section nearly square (`boxy` 0.8 and up). The nose is a flat face almost
  // the full width; the bonnet runs level to the cowl at 0.18; the screen climbs to a low roof at
  // -0.08; the rear screen falls from -0.36 to the deck at -0.56; the tail is cut off flat.
  stations: [
    [0.82, 0.236, 0.072, 0.070, -0.020, 0.85],
    [0.79, 0.262, 0.086, 0.082, -0.020, 0.85],
    [0.66, 0.270, 0.096, 0.090, -0.018, 0.85],
    [0.48, 0.272, 0.102, 0.094, -0.016, 0.85],
    [0.30, 0.272, 0.106, 0.096, -0.014, 0.85],
    [0.18, 0.272, 0.110, 0.098, -0.012, 0.85],
    [0.10, 0.272, 0.170, 0.098, -0.010, 0.8],
    [0.02, 0.270, 0.232, 0.100, -0.008, 0.78],
    [-0.08, 0.268, 0.262, 0.100, -0.006, 0.78],
    [-0.22, 0.268, 0.270, 0.100, -0.004, 0.78],
    [-0.36, 0.268, 0.258, 0.100, -0.002, 0.78],
    [-0.46, 0.270, 0.200, 0.100, 0.000, 0.8],
    [-0.56, 0.272, 0.136, 0.098, 0.002, 0.85],
    [-0.70, 0.270, 0.128, 0.096, 0.004, 0.85],
    [-0.79, 0.262, 0.120, 0.090, 0.006, 0.85],
    [-0.82, 0.240, 0.104, 0.080, 0.008, 0.85],
  ],
  // ⚠ The glass is whole faces of the loft (9 degrees a face), so changing this moves every pane.
  sides: 40,
  glass: {
    // The screen: the top of the box from the cowl to the roof's leading edge.
    windscreen: { f: [-0.08, 0.18], a: [45, 135] },
    // The door glass: a short strip over a high waist.
    side: { f: [-0.36, 0.10], a: [18, 36] },
    // The rear screen, behind the firewall: seen from outside only.
    rear: { f: [-0.56, -0.36], a: [45, 135] },
  },
  door: { f: [-0.40, 0.14], aLo: -40, aHi: 38, hinge: 'scissor', swing: 58 },
  inside: { floorH: -0.075, bulkheadF: -0.42, seatG: 0.11, eyeF: -0.22, eyeM: 0.80 },
  ducts: { at: [[0.52, 0.365], [-0.52, 0.365]], rOut: 0.142, rIn: 0.120, h0: -0.135, h1: -0.020, fanH: -0.07, fanR: 0.112 },
  groundH: -0.205,
  feet: [[0.54, 0], [-0.44, 0.16], [-0.44, -0.16]],
  pusher: { f: -0.82, h: 0.035, r: 0.055 },
  lengthM: 4.7,
});
