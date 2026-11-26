# The Solenne on stacked plates

**Status: built (2026-11-25): the plate table, the GLASS arm, every room refitted and the private landings. Not yet
seen in the game on a running server; the east rooms and the floors up the stairs have only what was moved into them.**

The Solenne's spire tapered as it twisted, so its floors shrank as they rose: 12.5 m across at floor 8, 7.9 m at 24,
6.6 m at the top of the shaft. The rooms above floor 24 had been fitted to the 2 by 2 tower and stood outside the model
or above it (38-B's north door opened on the sky). This replaces the taper with the shape of One Richmond Row in
London, Ontario: a straight box of a building whose floor slabs and balconies jog from side to side in bands of a few
storeys, so the tower reads as twisting without getting any smaller.

## The idea: the glass stays put, the slabs move

Rooms in ROOM are square to the compass, and a room has to fit inside its model. A twisted floor plate loses its
corners to a square room, which is what cost the spire most of its room. So each storey is two things:

- **The glass box** is the same 13 by 14 m on every floor, never turned or shifted. Every room is fitted inside it.
- **The slab** (the floor's edge and its glass rail) jogs. Each band of four storeys turns it up to 5 degrees and
  shifts it a little, white and charcoal in turn.

`client/shared/solenne-plates.js` is the one table: the box, the bands, the storey height, the roof deck, the Lantern
and the pad. The GLASS arm (`solenne` in glass/models/downtown.js) draws from it and nothing else; the rooms were
fitted to it by `scripts/content/solenne-plates-fit.mjs`. Change a number there and refit, or the two part.

The flats have no balconies in ROOM. A slab's lip past the glass is 0.2 to 0.6 m on a turned band, too little to
stand on, so it's the model's alone.

## Sizes

In the tower tile's own frame (x east, n north, the tile's middle at 0), metres. The tile is 17.86 m. The Flute is
next door to the west, Marrow House to the east and Marrow Street to the south, so a slab stays inside the tile on
those sides and may hang over Solenne Gardens to the north. `plateProblems()` checks every band.

| Part | Size |
|---|---|
| Glass box | x -6.5 to 6.5, n -5.43 to 8.57 |
| Slab | 15.6 m square, 0.32 m thick, a 1.05 m glass rail round it |
| Storey | 3.6 m; lift floor n stands at (n - 1) × 3.6 m |
| Podium | floors 1 to 3, 0 to 10.8 m, half-width 7.6 m |
| Plates | floors 4 to 32, 10.8 to 114.5 m |
| Roof deck | 114.51 m, square: the Lantern, the sky deck west of it and the pad east of it |

The lift is in the middle (x -1.1 to 1.1, n -1.61 to 0.59), entered from the back of the lobby, which is now 6.5 m
deep instead of 11.5. Every landing is north of it.

## The floors

| Floor | What | Rooms, inside |
|---|---|---|
| 1 | the lobby | 15 × 6.5 m |
| 2, 3 | Sweat Equity, Bishop's Blend | 14.6 × 4.3 m each |
| 4, 5 | 4-A, B, C and 5-A, B, C, round a short landing | west 3.8 × 12.1 m (46 m²), south-east 5.1 × 5.8 m (30 m²), north 8.9 × 3.3 m (29 m²), each with an en-suite |
| 6, 8, 10 | 6-A and B, 8-A and B, 10-A and B, either side of a corridor | 5 × 12.1 m (61 m²) each, with an en-suite |
| 14 | the Aerie | 13 × 4.4 m |
| 16, 18 | Residence 16 and 18, one flat a floor | the flat 5 × 11.3 m with its en-suite, its east room 5.1 × 14 m: about 130 m² |
| 20 to 27 | Residence 20, 22, 24 (Cyd's) and 26, two storeys each | as 16, and a room 13 × 7.7 m up the stair: about 230 m² |
| 28 to 31 | the Penthouse | as 16, and three rooms 13 × 7.7 m up its stair: about 430 m² |
| 32 | the lift's top landing | the stair up to the Lantern |
| roof | the Lantern, the sky deck, the pad | 4.6 × 4.6 m, 4.8 × 14.6 m, 4.8 × 14.6 m |

Floors 7, 9, 11 to 13, 15, 17 and 19 are drawn but have no rooms; the lift doesn't stop there.

Every flat kept its zone id, so its lease, its residents, Cyd's cat and the Cachet went with it, and took its new
floor's label: 38-B is now Residence 24. A whole-floor flat's things were shared out between its rooms: the kitchen,
the table, the bar and the cat's bowls stay in the flat (whose zone holds the lease), the bed and desk went to the east
room, and the sitting room upstairs. The penthouse's bed is on its third floor.

## The private landings

A text exit holds one door a side, and a lock belongs to one zone. So a flat that's a whole floor can't be one locked
room: its east room is off the landing, not off the flat. The landing and every room of the flat but the flat itself
carry `flags.private_to` with the flat's zone id, and the residency plugin's gate lets in only whoever holds the flat
(anyone while it's unlet, so it can be seen and rented). The lift runs the same gate, so the floor is refused at the
panel. The flat's own front door keeps its hololock.

## The roof deck

The sky deck runs down the west side of the Lantern and the pad down the east, both open rooms with
`parapet: 1.1` (gl/room-mesh.js): a stone upstand, glass to 1.1 m and a bronze handrail round the deck,
clear of the doorways. The pool is 6 m and the south end is a terrace: a striped awning in cream and
cyan (the `awning` form, which things stand under), two teak and brass benches facing each other across a
smoking table that gives out cigars and cigarettes, and a set on the east rail. At the north rail the
observatory telescope is a vantage with `stars`: hold C for the constellations (plugins/freelook README).

## Building it again

1. `node scripts/content/solenne-plates-fit.mjs` lays every room out, checks each against the table (inside the box
   at its storey, its furniture placed and reachable) and writes nothing if one fails. It refuses to run twice.
2. `node scripts/content/solenne-plates-grid.mjs` sets the map grid so zone_edges agrees with the exits, and moves 16
   and 18's old connections and hololocks to their new landings.
3. `npm run shapes:bake`, `npm run lite:bake`, then shapes:smoke, the Lite smoke, perch, interiors-smoke, building-stage
   and content:lint.

## Still to do

- Furnish the east rooms and the upstairs rooms properly; most have only what was moved into them, and the penthouse's
  fourth floor is empty.
- Richmond Row's red corner block near the top, in the Solenne's champagne and gold, if wanted.
- A map icon for the new shape.
