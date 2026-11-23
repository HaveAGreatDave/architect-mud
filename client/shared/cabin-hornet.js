// THE VEX HORNET'S BODY, GLASS AND DOORS, STATED ONCE.
//
// Two things are built off this: the exterior (scripts/shapes/concepts/hornet.mjs writes
// mesh_hornet.json from it) and the cockpit (interior-hornet.js derives the room from it). The
// arithmetic is cabin-hovercar.js.
//
// The Hornet is Vex Motors's two-seat city car (docs/proposals/hover-cars.md): one box, four
// metres long and taller than the other hover cars, the screen starting almost at the nose, glass
// most of the way round, a flat hatch at the back. Small fans tucked into the corners. Coach doors
// hinged at the back, so you step straight out forwards.
import { makeCabin } from './cabin-hovercar.js';

export const HORNET = makeCabin({
  id: 'hornet',
  // Nose to tail. A short rounded nose, the screen climbing from 0.50 to the roof at 0.14, a long
  // level roof, and the hatch dropping from -0.50 to a tail that is nearly upright.
  stations: [
    [0.70, 0.150, 0.060, 0.060, -0.010, 0.55],
    [0.67, 0.200, 0.090, 0.080, -0.008, 0.6],
    [0.60, 0.232, 0.116, 0.092, -0.006, 0.62],
    [0.50, 0.246, 0.140, 0.098, -0.004, 0.62],
    [0.38, 0.250, 0.230, 0.100, -0.002, 0.6],
    [0.26, 0.252, 0.310, 0.102, 0.000, 0.6],
    [0.14, 0.252, 0.360, 0.102, 0.002, 0.6],
    [0.00, 0.252, 0.376, 0.102, 0.004, 0.6],
    [-0.18, 0.252, 0.376, 0.102, 0.006, 0.6],
    [-0.36, 0.252, 0.366, 0.102, 0.008, 0.6],
    [-0.50, 0.250, 0.340, 0.100, 0.010, 0.62],
    [-0.60, 0.244, 0.270, 0.098, 0.012, 0.62],
    [-0.67, 0.230, 0.180, 0.092, 0.014, 0.62],
    [-0.70, 0.200, 0.120, 0.084, 0.016, 0.6],
  ],
  // ⚠ The glass is whole faces of the loft (9 degrees a face), so changing this moves every pane.
  sides: 40,
  glass: {
    // The screen: big, from just behind the nose up to the roof.
    windscreen: { f: [0.14, 0.50], a: [45, 135] },
    // The door glass: deep, and long enough to see the kerb.
    side: { f: [-0.36, 0.38], a: [9, 36] },
    // The hatch's window, behind the seats' wall: seen from outside only.
    rear: { f: [-0.67, -0.50], a: [45, 135] },
  },
  door: { f: [-0.34, 0.34], aLo: -40, aHi: 38, hinge: 'rear', swing: 64 },
  inside: { floorH: -0.07, bulkheadF: -0.44, seatG: 0.105, eyeF: -0.02, eyeM: 1.02 },
  ducts: { at: [[0.46, 0.33], [-0.46, 0.33]], rOut: 0.112, rIn: 0.094, h0: -0.125, h1: -0.030, fanH: -0.075, fanR: 0.087 },
  groundH: -0.195,
  feet: [[0.48, 0], [-0.40, 0.14], [-0.40, -0.14]],
  pusher: { f: -0.70, h: -0.005, r: 0.042 },
  lengthM: 4.0,
});
