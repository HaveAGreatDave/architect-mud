// THE HALLARD LANNER'S BODY, GLASS AND DOORS, STATED ONCE.
//
// Two things are built off this: the exterior (scripts/shapes/concepts/lanner.mjs writes
// mesh_lanner.json from it) and the cockpit (interior-lanner.js derives the room from it), as the
// Merlin's are built off cabin-merlin.js. The arithmetic is cabin-hovercar.js.
//
// The Lanner is Hallard Coachbuilders' two-seat grand tourer (docs/proposals/hover-cars.md): a long
// bonnet, the cab two thirds of the way back under a short upright screen, and a fastback roof that
// runs down to a cut-off tail. The front fans sit well forward, so there is more bonnet than car
// behind them. Long doors hinged at the front, as a car's are.
import { makeCabin } from './cabin-hovercar.js';

export const LANNER = makeCabin({
  id: 'lanner',
  // Nose to tail. A small oval mouth, a bonnet that climbs gently for a metre and a half to the
  // cowl at 0.14, the screen up to the roof at -0.13, the peak over the seats at -0.24, then the
  // fastback falling to a tail cut off square.
  stations: [
    [0.87, 0.105, 0.032, 0.030, -0.045, 0.2],
    [0.84, 0.138, 0.046, 0.042, -0.045, 0.3],
    [0.78, 0.170, 0.058, 0.052, -0.044, 0.35],
    [0.68, 0.200, 0.074, 0.062, -0.042, 0.4],
    [0.54, 0.218, 0.088, 0.070, -0.038, 0.42],
    [0.40, 0.228, 0.098, 0.076, -0.034, 0.42],
    [0.26, 0.234, 0.106, 0.082, -0.030, 0.42],
    [0.14, 0.238, 0.114, 0.086, -0.026, 0.42],
    [0.05, 0.240, 0.170, 0.090, -0.022, 0.42],
    [-0.04, 0.242, 0.236, 0.094, -0.018, 0.42],
    [-0.13, 0.242, 0.286, 0.096, -0.014, 0.42],
    [-0.24, 0.242, 0.304, 0.098, -0.010, 0.42],
    [-0.36, 0.240, 0.290, 0.098, -0.006, 0.44],
    [-0.48, 0.234, 0.250, 0.098, -0.002, 0.46],
    [-0.60, 0.224, 0.198, 0.096, 0.004, 0.48],
    [-0.72, 0.206, 0.150, 0.090, 0.010, 0.5],
    [-0.80, 0.184, 0.118, 0.080, 0.016, 0.5],
    [-0.83, 0.160, 0.100, 0.070, 0.020, 0.5],
  ],
  // ⚠ The glass is whole faces of the loft (9 degrees a face), so changing this moves every pane.
  sides: 40,
  glass: {
    // The screen: the crown's faces from the cowl up to the roof's leading edge, an A-pillar's
    // width (one face) in from the side glass.
    windscreen: { f: [-0.13, 0.14], a: [45, 135] },
    // The door glass, from the screen pillar back to the B-pillar behind the seats.
    side: { f: [-0.36, 0.05], a: [9, 36] },
    // The fastback's rear window, behind the firewall: seen from outside only.
    rear: { f: [-0.60, -0.36], a: [54, 126] },
  },
  door: { f: [-0.40, 0.12], aLo: -40, aHi: 38, hinge: 'front', swing: 62 },
  inside: { floorH: -0.072, bulkheadF: -0.42, seatG: 0.10, eyeF: -0.24, eyeM: 0.80 },
  // The front pair well forward, the rear pair under the fastback's haunches.
  ducts: { at: [[0.56, 0.33], [-0.52, 0.335]], rOut: 0.125, rIn: 0.105, h0: -0.128, h1: -0.024, fanH: -0.07, fanR: 0.097 },
  groundH: -0.200,
  feet: [[0.58, 0], [-0.44, 0.15], [-0.44, -0.15]],
  pusher: { f: -0.83, h: 0.035, r: 0.045 },
  lengthM: 4.9,
});
