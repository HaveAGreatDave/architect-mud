// THE SOLENNE ON STACKED PLATES (docs/proposals/solenne-plates.md): the one table the GLASS arm (`solenne` in
// glass/models/downtown.js) and the room fit (scripts/content/solenne-plates-fit.mjs) both read.
//
// Metres, in the tower tile's own frame: x east, n north, the tile's middle at 0. A storey is the lift's 3.6 m, and
// lift floor `n` stands at (n - 1) * 3.6 m, so floor 1 is the street.
//
// Each storey is two things. The GLASS BOX is the same on every floor, never turned or shifted, and every room is
// fitted inside it. The SLAB (the floor's edge and its rail) is what moves: each band of four storeys turns it a few
// degrees and shifts it a little, white or dark in turn, after One Richmond Row in London, Ontario.

export const STOREY = 3.6;
export const floorM = (n) => (n - 1) * STOREY;

export const PODIUM = { floors: 3, half: 7.6 };          // floors 1 to 3: the lobby, the gym and Bishop's Blend
export const FIRST_PLATE = 4, LAST_PLATE = 31;          // the storeys on plates
export const CROWN_FLOOR = 32;                           // the lift's top stop, under the roof deck
export const BOX = { x0: -6.5, x1: 6.5, n0: -5.43, n1: 8.57 };
export const BOX_MID = [(BOX.x0 + BOX.x1) / 2, (BOX.n0 + BOX.n1) / 2];
export const SLAB = { half: 7.8, t: 0.32, rail: 1.05 };
// the crown storey (floor 32, the lift's top landing) is a plate like the rest; the roof deck is over it, square, at
// the top of the landing's flight (zone_solenne_hall_45 is 2.91 m high)
export const CROWN = BOX;
export const ROOF_M = (32 - 1) * 3.6 + 2.91;
// on the roof deck, where the fit put them (scripts/content/solenne-plates-fit.mjs prints the plan): the Lantern the
// stair comes up into, and the middle of the pad, east of it, with the touchdown circle's radius
export const LANTERN = { x0: -2.3, x1: 2.3, n0: 1.57, n1: 6.17 };
export const PAD = [4.99, 1.89], PAD_R = 2.2;

// one row a band of four storeys, from floor 4 up: its turn in degrees (clockwise from above), its shift [x, n] in
// metres, and whether its slab is white or dark
export const BANDS = [
  { turn: 0, shift: [0, 0], tone: 'white' },
  { turn: 4, shift: [0.1, 0.2], tone: 'dark' },
  { turn: -2, shift: [-0.1, 0.1], tone: 'white' },
  { turn: 5, shift: [0.05, 0.1], tone: 'dark' },
  { turn: -4, shift: [-0.1, 0], tone: 'white' },
  { turn: 2, shift: [0.1, 0.25], tone: 'dark' },
  { turn: -5, shift: [0, 0.15], tone: 'white' },
];
export const bandOf = (n) => BANDS[Math.max(0, Math.min(BANDS.length - 1, Math.floor((n - FIRST_PLATE) / 4)))];
// the slab under floor n (the roof of floor n - 1): its middle [x, n] and turn in radians
export function slabOf(n) {
  const b = bandOf(Math.min(n, LAST_PLATE));
  return { x: BOX_MID[0] + b.shift[0], n: BOX_MID[1] + b.shift[1], yaw: b.turn * Math.PI / 180, tone: b.tone };
}

// A slab must hold the glass box with a lip all round and stay inside the tile on the street sides (east, west and
// south: The Flute, Marrow House and Marrow Street); it may hang over Solenne Gardens to the north. Returns a list of
// problems, empty when every band is good. The fit script and the shapes gate call it.
export const TILE_HALF = 8.93, SIDE_ROOM = 8.7;
export function plateProblems() {
  const out = [];
  BANDS.forEach((b, i) => {
    const t = b.turn * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), cx = BOX_MID[0] + b.shift[0], cn = BOX_MID[1] + b.shift[1];
    for (const [x, n] of [[BOX.x0, BOX.n0], [BOX.x1, BOX.n0], [BOX.x1, BOX.n1], [BOX.x0, BOX.n1]]) {
      const dx = x - cx, dn = n - cn, u = dx * c - dn * s, v = dx * s + dn * c;
      if (Math.abs(u) > SLAB.half - 0.1 || Math.abs(v) > SLAB.half - 0.1) out.push(`band ${i}: the glass box's corner ${x},${n} is past its slab`);
    }
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = cx + (u * c + v * s) * SLAB.half, n = cn + (-u * s + v * c) * SLAB.half;
      if (Math.abs(x) > SIDE_ROOM) out.push(`band ${i}: the slab reaches ${x.toFixed(2)} m east or west`);
      if (n < -SIDE_ROOM) out.push(`band ${i}: the slab reaches ${(-n).toFixed(2)} m south`);
    }
  });
  return out;
}

// THE CYAN CORNER, as One Richmond Row has its red one near the top: two fins framing the glass box's south-west corner
// (the one Marrow Street sees) from floor `from` to over the roof deck. `w` is how far along each face the frame reaches. It stands off the glass, so it hides no window.
export const ACCENT = { from: 22, w: 5.2, t: 0.45, over: 1.2, rgb: [38, 196, 226] };
