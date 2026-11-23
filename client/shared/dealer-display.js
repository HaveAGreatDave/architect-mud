// THE HOVER CAR DEALERSHIP'S DISPLAY: which car stands on which bay.
//
// One table for every place a dealership shows its cars: the GLASS arm (`vtol_dealer` in
// client/game/js/panels/glass/models/dealership.js: four turntables behind the glass and the car
// on the pylon) and the showroom in ROOM (`flags.room.display`, drawn by panels/room-hoist.js). The makers
// and their cars are docs/proposals/hover-cars.md; the building is docs/proposals/vtol-dealership.md.
//
// Nothing here is a price or a stock list. What a dealership sells is every `aircraft_types` row
// marked as a hover car, read on the server (plugins/flight/state.js `acquirableTypes`). This file
// is only what's drawn.
//
// ── TO PUT A FINISHED CAR ON ITS BAY ─────────────────────────────────────────────────────────
// Change that car's row in DEALER_CARS: its own `cls` and `metres`, a livery of its own, and drop
// `standIn`. One line. A bay whose car has `standIn` holds a Merlin in the maker's colour.

import { HOVER_EMBLEMS } from './hover-car-emblems.js';

// A livery is what `liveryPalette` (panels/aircraft3d.js) takes: the row's `exterior`.
export const DEALER_CARS = {
  merlin:  { cls: 'merlin', metres: 4.6, livery: { base: '#b2162a', trim: '#ece8e0', finish: 'gloss', pattern: 'factory', variant: 'rosso' } },
  wraith:  { cls: 'wraith', metres: 4.9, livery: { base: '#163e2c', trim: '#ece2cc', finish: 'gloss', pattern: 'factory', variant: 'racing' } },
  wolverine: { cls: 'wolverine', metres: 4.7, livery: { base: '#e25c16', trim: '#101012', finish: 'gloss', pattern: 'factory', variant: 'orange' } },
  hornet:   { cls: 'hornet', metres: 4.0, livery: { base: '#96d6ba', trim: '#f0ece0', finish: 'gloss', pattern: 'factory', variant: 'mint' } },
};

// The four bays, one per maker, in the order the badges run along the roof edge. `line` is the
// maker's light line (its cabin's, hover-cars.md), which is the colour of its badge and of the ring
// round its turntable.
export const DEALER_BAYS = [
  { where: 'a', maker: 'Corvane', mark: 'C', line: [168, 150, 255], car: 'merlin' },
  { where: 'b', maker: 'Castellan', mark: 'C', line: [84, 226, 208],  car: 'wraith' },
  { where: 'c', maker: 'Brakk',  mark: 'B', line: [214, 232, 255], car: 'wolverine' },
  { where: 'd', maker: 'Vex',   mark: 'V', line: [255, 110, 214], car: 'hornet' },
];
// The car on the pylon outside: whichever the dealership is showing off.
export const DEALER_PYLON = 'merlin';

// THE SHOWROOM'S PLAN, in tile units (about 18 m), in the arm's own frame: +y is the street the door
// is on, +x the party wall. The arm builds its glass box from it, and scripts/content/vtol-dealership.mjs
// lays the room in ROOM out from the same numbers, so the turntables you see from the street are
// the plinths you walk round. `nose` is a unit vector, the way each car points.
export const DEALER_PLAN = {
  tileM: 18,
  x0: -0.40, x1: 0.40,           // the glazed side and the party wall's inner face
  yFront: 0.36, yBack: -0.20,    // the front glass and the core's face
  floor: 0.012, ceil: 0.290,
  doorX: 0.31, doorHalf: 0.045,
  tableR: 0.12,
  tables: {
    a: { at: [-0.255, 0.215], nose: [-0.50, 0.866] },
    b: { at: [0.020, 0.215], nose: [0.42, 0.908] },
    c: { at: [0.235, -0.050], nose: [-0.26, 0.966] },
    d: { at: [-0.250, -0.065], nose: [-0.866, 0.50] },
  },
};

// ── THE MAKERS' EMBLEMS ─────────────────────────────────────────────────────────────────────
// Castellan's, Brakk's and Vex's are the cars' own (client/shared/hover-car-emblems.js, the drawing on
// each car's nose and wheel): a tower on a shield, a beast's head with its jaw open, a V in a circle.
// Corvane's isn't in that table, so its wings are here: an aerospace firm's, swept either side of a
// kite. Every emblem is a list of convex pieces in a box from -1 to 1, back to front, each
// { p, tone }: 'field' is the ground it sits on and 'mark' the device.
const CORVANE_WINGS = [
  [[0, 0.62], [0.17, 0.02], [0, -0.62], [-0.17, 0.02]],
  ...[-1, 1].flatMap((side) => [0, 1, 2].map((i) => {
    const y0 = 0.30 - i * 0.27, xt = 1.0 - i * 0.22, yt = 0.66 - i * 0.30;
    return [[side * 0.24, y0], [side * xt, yt], [side * xt, yt - 0.11], [side * 0.24, y0 - 0.20]];
  })),
].map((q) => ({ p: q, tone: 'mark' }));
export const DEALER_EMBLEMS = {
  Corvane: CORVANE_WINGS,
  Castellan: HOVER_EMBLEMS.castellan,
  Brakk: HOVER_EMBLEMS.brakk,
  Vex: HOVER_EMBLEMS.vex,
};
export const dealerEmblem = (maker) => DEALER_EMBLEMS[maker] || [];

export const dealerBay = (where) => DEALER_BAYS.find((b) => b.where === where) || null;
export const dealerCar = (bay) => (bay && DEALER_CARS[bay.car]) || DEALER_CARS.merlin;
export const dealerPylonCar = () => DEALER_CARS[DEALER_PYLON] || DEALER_CARS.merlin;
// The makers whose bay still holds a stand-in, for the note in the doc and the gate.
export const dealerStandIns = () => DEALER_BAYS.filter((b) => dealerCar(b).standIn).map((b) => b.maker);
