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
  { where: 'b', maker: 'Castellan', mark: 'H', line: [84, 226, 208],  car: 'wraith' },
  { where: 'c', maker: 'Brakk',  mark: 'G', line: [214, 232, 255], car: 'wolverine' },
  { where: 'd', maker: 'Vex',   mark: 'M', line: [255, 110, 214], car: 'hornet' },
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
// Each is a list of quads in a unit box, u right and v up, -1 to 1, drawn in the maker's line colour
// on a dark plate. A badge has to be told from its neighbour by its outline before anything inside
// it can be read, so the four have four outlines: wings, a lozenge, a hexagon and a roundel. The
// figures are the badges docs/proposals/hover-cars.md gives each maker; Corvane's is the wings an
// aerospace firm would wear.
const arc = (cx, cy, rx, ry, t, n, rot = 0, a0 = 0, a1 = Math.PI * 2) => {
  const cr = Math.cos(rot), sr = Math.sin(rot), out = [];
  const at = (a, k) => { const x = Math.cos(a) * rx * k, y = Math.sin(a) * ry * k; return [cx + x * cr - y * sr, cy + x * sr + y * cr]; };
  for (let i = 0; i < n; i++) { const p = a0 + (a1 - a0) * i / n, q = a0 + (a1 - a0) * (i + 1) / n; out.push([at(p, 1), at(q, 1), at(q, 1 - t), at(p, 1 - t)]); }
  return out;
};
const bar = (x0, y0, x1, y1) => [[x0, y1], [x1, y1], [x1, y0], [x0, y0]];
// a frame between a polygon and the same polygon shrunk by `k`
const frame = (pts, k) => pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; return [p, q, [q[0] * k, q[1] * k], [p[0] * k, p[1] * k]]; });
const HEX = [0, 1, 2, 3, 4, 5].map((i) => [Math.cos(i * Math.PI / 3) * 0.98, Math.sin(i * Math.PI / 3) * 0.98]);
export const DEALER_EMBLEMS = {
  // swept wings of three feathers either side of a kite
  Corvane: [
    [[0, 0.62], [0.17, 0.02], [0, -0.62], [-0.17, 0.02]],
    ...[-1, 1].flatMap((s) => [0, 1, 2].map((i) => {
      const y0 = 0.30 - i * 0.27, xt = 1.0 - i * 0.22, yt = 0.66 - i * 0.30;
      return [[s * 0.24, y0], [s * xt, yt], [s * xt, yt - 0.11], [s * 0.24, y0 - 0.20]];
    })),
  ],
  // an upright lozenge, a coachline inside it, and a bar across
  Castellan: [
    ...frame([[0, 1], [0.66, 0], [0, -1], [-0.66, 0]], 0.76),
    bar(-0.92, -0.085, 0.92, 0.085),
  ],
  // a hexagon nut holding three stacked bars, the longest on top
  Brakk: [
    ...frame(HEX, 0.82),
    bar(-0.56, 0.24, 0.56, 0.44), bar(-0.42, -0.10, 0.42, 0.10), bar(-0.27, -0.44, 0.27, -0.24),
  ],
  // a roundel holding a vex: an open note head on a stem
  Vex: [
    ...arc(0, 0, 1, 1, 0.13, 18),
    ...arc(-0.14, -0.36, 0.36, 0.25, 0.42, 12, 0.35),
    bar(0.15, -0.30, 0.25, 0.64),
  ],
};
export const dealerEmblem = (maker) => DEALER_EMBLEMS[maker] || [];

export const dealerBay = (where) => DEALER_BAYS.find((b) => b.where === where) || null;
export const dealerCar = (bay) => (bay && DEALER_CARS[bay.car]) || DEALER_CARS.merlin;
export const dealerPylonCar = () => DEALER_CARS[DEALER_PYLON] || DEALER_CARS.merlin;
// The makers whose bay still holds a stand-in, for the note in the doc and the gate.
export const dealerStandIns = () => DEALER_BAYS.filter((b) => dealerCar(b).standIn).map((b) => b.maker);
