# The Echelon's decks

**Status:** phases 1 and 2 built (2026-11-22): her true size, the hull table, hull-shaped rooms in ROOM, the deck plan fitted to the model, the suite's hidden boudoir door, and her rooms walked in one-world on the moving ship (not yet seen in a live game). Phase 3, the model detail pass, is design.

Cyd's yacht was a 15 m model with ten box rooms on a made-up grid. You couldn't stand under her decks, the helipad was smaller than a helicopter, and the rooms had no relation to the hull. This makes her rooms sections of the ship you see from outside.

## Her size

`client/shared/yacht-hull.js` is the one table. GLASS draws her from it (`drawYacht`), the helicopter lands on it (cockpit.js) and her rooms are fitted to it (`scripts/content/echelon-fit.mjs`).

| | was | now |
|---|---|---|
| `YACHT_SCALE` | 0.4 | 1.5 |
| `YACHT_H` | 1.7 | 2.43 |
| length | 15 m | 55 m |
| beam | 3 m | 11 m |
| deck to deck | 0.9 m | 3.0 m |
| helipad | an ellipse, 4 by 2.4 m | a 9.6 m circle at `YACHT_PAD_OY` 0.37, clear of the deckhouse |

`metres()` and `local()` convert between her local frame and metres. The main deck (`YACHT_DECKZ`) is still frozen: every landing keys off it.

## The deck plan

Bow is north. Every room's size, the taper and lean of its walls, its raked screen and its stair spots come from the table.

| deck | floor | fore to aft |
|---|---|---|
| sun deck (tier 2's roof) | +9 m | Sun Deck, open, with a rail |
| bridge deck (tier 2) | +6 m | Bridge, raked screen, with a lounge aft |
| owner's deck (tier 1) | +3 m | Stair Landing |
| main deck (tier 0) | 0 | Cyd's suite (raked screen, head behind it), Boarding Foyer (gangway door to starboard), Stern Lounge, Helipad (the open aft deck) |
| lower deck (in the hull) | −3 m | Broadcast Complex, Engineering Corridor, Engine Room |

The stairs run up the centreline: corridor → foyer → landing → bridge → sun deck, the last by the companionway hatch the model draws on the sun deck.

To change a room, change `yacht-hull.js` or `echelon-fit.mjs` and run it; never edit the zone files' `flags.room` by hand. `node scripts/content/echelon-fit.mjs --check` fails if a file doesn't match.

## Rooms that aren't boxes

`flags.room.hull` (room-layout.js `hullSpecOf`, drawn by `gl/room-hull.js`) is generic ROOM, not Echelon code:

- `sides`: `[[v, floor, head], ...]`, the half-width at `v` metres back from the front wall, at the floor and at the ceiling. The side walls follow it and lean in or flare out.
- `rake`: metres the front wall's head stands back from its foot.
- `deck`: an open deck with a rail along the sides and ends, and gaps where its doorways are.

The walk follows the taper (`hullRects`). Doors go only in the front and back walls.

## The boudoir

The suite's mirrored wardrobe (`furn_echelon_suite_boudoir_door`) carries `opens_dark`. Its glass is two-way, and the boudoir's lamp behind it never goes right down. With any of the suite's lights on, `use wardrobe` gets your own reflection and a hint that one edge looks warmer. Turn them all off and a pink line shows round one panel, and the same `use` lets an approved guest through. The rest (the `teleporter` flag, the approval check) is unchanged in plugins/yacht.

## Walking her in one-world (phase 2)

She has no street door and doesn't stay put, so her rooms aren't placed off a tile edge as a building's are.

- **The server** (plugins/roomstage `buildingRoomsNear`) sends every room of a vessel within reach (`flags.vessel` on the facade) with `frame.vessel`: `sx` metres to starboard and `fz` forward of her middle, its `face` off her bow, its `floor` over her main deck, and `deck`, the main deck over the water. Her plan's middle and her deck height are `flags.vessel_plan` on her exterior, written by the fit script. The tile is her tile now, so a sailed ship's rooms go where she went.
- **The view** (freelook-view.js `owVesselTick`, first thing each frame) reads her cell's `heading` and `sub` and her ride (`seaRideAt`, the call her hull is drawn with) and puts every room on her (room-interiors.js `placeOnVessel`). A room rises and falls with her heave but doesn't tilt: the walk reads a matrix flat, and every room of a deck has to stay at one height or a doorway is a change of storey. Standing in one, you're carried with the floor: the spot under you in the room's frame stays put however she turns.
- **Her storey is cut out of her** (gl/solids.js `setVesselCut`): the hull and deckhouse are discarded across her whole plan between your storey's floor and ceiling, tilted with her roll and pitch, so her rooms stand in the gap as a building's do in its mass. The building cut (`insideCut`) doesn't run on her tile. The cut is module state and `closeFreelook` clears it, so no other view draws her with a storey missing.
- **One-world takes any of her rooms** however you got there (interiors-near.js `oneWorldTakes`). The way in is the room button (`room world`), which for a vessel puts the view up over her own tile.

`interiors:smoke` holds the placement, the carrying, the cut and the server's frame.

## Still to do

- **Seeing it live.** Nothing of phase 2 has run in a game yet: the cut's shader, the carry in a swell and boarding by the room button need a look on a running server.
- **Walking aboard from the pier** when she's docked, and stepping off a landed helicopter straight into GLASS. Both go through the room button for now.
- **Phase 3, model detail.** At 55 m she's seen close. Rails on every deck edge, the stairs between decks on the aft faces, lower-deck windows where the rooms are, the gangway door, and the pad's tie-down markings.
- The mirror's pink seam drawn in ROOM when the suite is dark.
