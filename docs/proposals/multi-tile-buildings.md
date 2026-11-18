# Multi-tile buildings

**Status: phase 0 built and the Solenne built at 2 by 2, model, footprint and rooms (2026-11-16, uncommitted): the column at x 914 is in, and the tower stands on its four tiles with its rooms inside it. Phases 1 to 3 and 5 to 6 are design.** One building on a group of map tiles, drawn,
collided with and walked through as one thing, with the Solenne Residences on 2 by 2 tiles as the first. Later,
whole blocks redrawn round the important towers (Halcyon Towers, the Ascendant Spire) at 2 by 2, with the towers
round them a mix of 2 by 2 and 1-tile needle towers. Nothing changes for a building that isn't an office or
residential tower.

## Why

A tile is 17.9 m. A model's boxes are clamped to a half-width of 0.44 tiles, so a one-tile tower is at most 15.7 m
square: a needle tower. Real residential towers are 25 to 35 m across and office towers wider. Since ROOM put
rooms inside the models (building-stage.md, one-world-interiors.md), a floor's rooms have to fit its plate, and a
tower's program doesn't fit on one tile: the Solenne's residence floors lay out 44 m wide.

The rule from here is that a building's rooms fit its model and the model doesn't move to fit the rooms. A tower
that needs more floor than a tile gives gets more tiles.

## What exists today

Every multi-tile building so far was built by hand, and none has a parent tile. Each tile carries its own
`building_type` and runs its own arm, and each arm draws only its own share:

| Building | Tiles | How it's drawn |
|---|---|---|
| Airport terminal | 2 facades | one helper sized from `TERM` constants, not `fh`/`h`, because both are rolled per tile and the halves wouldn't meet |
| Coldwater Palais | 2 facades and a doorless middle | `PAL` constants on a shared axis; each arm passes its offset and draws its own parts |
| Golden Goose Gardens | 1 facade and 5 sealed tiles | `RINK` constants; registered by type, because a name binding would draw the front on all six |
| Hughson Coliseum | 4 doors and 21 sealed tiles | one arm draws every tile in block coordinates and clips to the tile (`coliseum-plan.js`) |

Sealed tiles are walled by blocked connection files, because `is_building` doesn't stop the walk graph; only
`facade` does (`facadeBlocks` in scripts/content/derive.mjs). Each building's script seals its tiles itself; there's
no shared helper. The one general grouping is `deriveSpans` (derive.mjs), which groups tiles sharing a
`building_name` for the minimap only.

What assumes one building per tile:

- **Size:** `buildingScale` rolls `fh` and `h` from each tile's seed (client/shared/skyline-scale.js), and
  `draw3DBoxAt` clamps half-widths to 0.44. `tileFitBox` trims anything past the tile on the entrance side.
- **Model binding:** `modelFor` and `shapeFor` look a model up by name first, so a shared name repeats the model on
  every tile (windshield.js, client/shared/building-shapes.js).
- **Collision:** CFIT rounds to one cell and asks that cell's roof (cockpit.js, `modelTopAt`); on foot,
  freelook-view.js `solidAt` does the same. Mass drawn over a neighbour isn't hit there.
- **Culling, shadows, occlusion, LOD:** per-tile capture and per-tile corner tests (windshield.js world sweep).
- **GLASS 2 and Lite:** meshes keyed per tile (gl/world.js `tileKeyOf`); the Lite bake works per tile
  (scripts/lite/bake.mjs, gl/lite.js).
- **ROOM:** room-view.js `EDGE`, `anchorOf` and `onTile` hold a building's rooms to the facade tile, and
  `withoutOwnTower` hides only that tile's building; one-world interiors key rooms by the facade's tile.
- **Tools:** sitecheck.mjs checks one tile; the Studio's `planMove` moves a facade and its interior and leaves
  sealed tiles behind; `authorBuilding` makes one facade.

## The design

**One record names the footprint.** The facade tile carries `flags.footprint: { x0, y0, w, h }` in world tiles,
and every other tile in it carries `flags.part_of: <facade zone id>` and no `building_type`, so nothing draws there
on its own. Sealed tiles are walled by blocked connections, written by one shared `sealFootprint()` in
scripts/content/lib.mjs instead of by hand in each script. `deriveSpans` reads `footprint` instead of guessing from
names.

**The model is drawn once, by the facade tile, over the whole footprint.** `fh` and `h` come from the facade's
seed and the footprint's size, not each tile's. The 0.44 clamp and `tileFitBox` measure against the footprint's
edge. A model is authored in footprint units, so a 2 by 2 tower's arm sees a plot twice the width and draws to it.
The other tiles draw nothing but ground.

**Everything that asks "what's on this cell" asks the footprint.** CFIT, on-foot collision and `modelTopAt` map a
`part_of` cell to its facade and test the one model. Culling, occlusion and shadows take the footprint's box. GLASS 2
keys the building's mesh on the facade and the Lite bake bakes it once.

**ROOM places rooms over the footprint.** `onTile` and the eye clamp hold rooms to the footprint, not the facade
tile, and `withoutOwnTower` takes the whole footprint off the window view. The fit gate (below) measures a room
against the model's plate at its height across the footprint.

**The fit gate.** A new gate, `scripts/content/building-fit.mjs`, lays every walkable building out with
`buildingLayout` and checks each room's box against the model's mass at its height (captured through the
shapes:smoke DOM stub), and the room storey count against `floorsFor`. This is what kept the Embassy accurate by
hand on 2026-11-16 (scripts/content/embassy-hotel-rooms.mjs); the gate makes it a rule.

**The lift's storey height comes from the building.** `LIFT_STOREY` (3.6 m) is one number for every building, and a
model's storeys are `h / floors`, which differs per tile. The lift reads the building's own storey height and ground
storey instead, so floor 30 stands on the model's 30th floor.

## Phases

0. **Room on the map** *(built 2026-11-16)*. `scripts/content/coldwater-column.mjs` puts a new column at x 914
   through the region and moves everything east of it one tile east, ids kept, so the Solenne can take 914 to 915 by
   907 to 908 with Kestrel Court and Marrow House still either side. 2,250 tiles move, 54 are new, 151 tiles get
   their exits rewritten. It landed together with:
   - every hard-coded tile coordinate east of 913 in code, tests, gates and tools moved too (plugins/flight,
     windshield.js, glass/models/ashway.js, scripts/shapes, the regress Media Lot checks and others).
     client/shared/neon-art.js has numbers in that range but they're artwork, not tiles, and
     scripts/shapes/lockwall.mjs measures the South Lock west of the cut, so neither moved;
   - the hockey venue's site block in content/media_broadcasts/bc_cluster_puck.json and Wrap Party's
     `set_aside_from`;
   - `snapshot-flight-world.mjs`, `npm run wildlands:bake`, `npm run lite:bake` and
     `scripts/map/world-map-dump.mjs`. The Lite bake has to be redone in a clean worktree at the commit;
   - on prod, nothing new: `scripts\oneshots.bat prod` already runs `repark-moved-pad-aircraft.mjs`, which stands
     every parked aircraft on its tile's new grid. A boat anchored east of the cut reads as unanchored until it
     drops anchor again, and `boat_hold.x` is a catch log, so neither needs moving;
   - the coordinates in the docs east of 913 (CLAUDE.md's among them).
1. **The record and the helpers.** `footprint` and `part_of`, `sealFootprint()`, `deriveSpans` reading the
   footprint, content:lint holding every footprint whole and sealed.
2. **GLASS draws once and collides once.** Facade-drawn models over the footprint, the clamp and tile fit against
   its edge, CFIT, on-foot collision, culling, occlusion and shadows through `part_of`, GLASS 2 and Lite keyed on the
   facade. shapes:smoke and the Lite smoke run a 2 by 2 test model.
3. **ROOM over the footprint**, and the fit gate, and the lift's storey height.
4. **The Solenne at 2 by 2** *(built 2026-11-16, then undone the same day)*. At 45 storeys on four tiles it dwarfed
   everything round it, so it went back to one tile: a 28-storey stem with a crown and terrace standing 3.6 m out
   over every side (`solenne-profile.js`), the pad on the tile's middle. The three sealed tiles are the Solenne's
   forecourt and gardens (`scripts/content/solenne-forecourt.mjs`). The rooms stay as they were fitted below and
   no longer match the outside, on purpose. What follows is the 2 by 2 build, kept as the record. Built ahead of phases 1 to 3
   the way the Coliseum was:
   - Every tile of the footprint runs the `solenne` arm (glass/models/downtown.js), and its registry row's `q` says
     where the block's centre is from that tile. A block-centred square turned by less than 45 degrees splits into
     four squares of half its size turned the same way, each with its middle on its own tile, so each tile draws
     one and every box stays under the 0.44 clamp. Sizes are constants and the storey is the lift's 3.6 m, never the
     per-tile `fh` and `h`.
   - The facade keeps its named row (the door, the pad, the mast); `solenne_sw`, `_nw` and `_ne` are type rows on
     three sealed tiles with no `building_name`, walled by `mint-connections` (`scripts/content/solenne-footprint.mjs`).
     All four rows carry `group: 'solenne'`, and `modelTopAt` and `buildLedges` ask the whole group's shapes,
     because a turned quarter reaches over the tile line. The sealed tiles' `part_of` reaches ROOM as the cell's
     `po`, so `withoutOwnTower` takes all four off the view out.
   - The tower is a champagne flute: a two-storey glass podium, the old Solenne's three tapering tiers turning 30
     degrees from floor 3 to 41, a flare of four corbelled rings that untwists to square, a two-storey bowl for the
     penthouse and the pad's hall (floors 44 and 45), and a stone rim terrace with the helipad over the facade
     tile's middle, a faceted lantern spire and mast, a glass pavilion, planters, corner pinnacles and a pool.
   - The way in is a stone portal on the facade tile's middle, with bronze jambs, a gold sunburst over sliding doors
     3.2 m across, lit glazed bays either side, and a porte-cochère with the name in brass on four bronze columns.
   - The rooms fit the plates (`scripts/content/solenne-rooms.mjs`, which checks every room against the arm's
     masses before it writes). The stem's usable square shrinks from 28.6 m at floor 3 to 11.1 m at floor 41, so
     the residences moved from floors 30 and 34 to 8 and 10, four flats a floor in a pinwheel round a 6 m landing
     (8-A, B, C and the new G; 10-D, E, F and the new H), each with glass on its two outside walls and no balcony.
     The stem is now an hourglass (`glass/models/solenne-profile.js`, which the arm and the room fit both read):
     28.6 m at floor 3, an 11 m waist at the Aerie on 19, then out again to 25 m at 40 and a 28.6 m bowl.
     `scripts/content/solenne-upper.mjs` put flats back up it: two long flats a floor on 24, 26 and 28 (west and
     east of a narrow landing), and whole-floor flats on 34, 36, 38 and 40, just under the penthouse. 38-B is
     Cyd's, back up from 8-B with every piece in it (the zone kept its id); 34-A, 36-A and 40-A are premium flats
     furnished like it, without his own things. Floor 8's east door is a new 8-B. The gym, Bishop's Blend and the
     Aerie shrank to the waist, and the penthouse grew to 27.4 m with the bowl.
     The gym (12), Bishop's Blend (18) and the Aerie (19) stand against the glass. The penthouse is floor 44, 25 m
     along the bowl's north glass. The lift's top stop is the forty-fifth floor's hall in the bowl, with a stair
     up into the lantern's foot, and the Sky Deck (the pool on the north parapet) and the pad (the south-east corner
     over the front door) are open rooms on the rim at 162.7 m. The lobby is 22 m across the podium; its street
     wall stands 1.6 m in front of the podium, the `EDGE` gap below, which the portal and the porte-cochère cover.
5. **Tools.** sitecheck for a footprint, the Studio moving a footprint whole, the Modelshop showing a multi-tile
   model.
6. **Blocks redrawn** round Halcyon Towers and the Ascendant Spire at 2 by 2, with a mix of 2 by 2 towers and
   1-tile needle towers round them.

## Open questions

- **A building's size is seeded by where it stands.** `buildingScale` jitters `fh` and `h` from `tileSeed(x, y)`, so
  moving a tile resizes its building. The column move changed every building east of 913 by a few percent: the
  Embassy is 20.0 m tall at 921,904 against 21.3 m at 920,904, so its rooms were re-fitted (embassy-rooms.mjs), and
  Second Amendment Superstore's side wall started clamping, so its side parts were pinned to the wall. Phase 1
  should seed from the facade's zone id instead, so a building keeps its size wherever it goes.

- Where the Solenne's rooms and the Embassy's sit in phase 3's fit gate: the Embassy's lobby stands 0.53 m in
  front of its model's wall because every building's street door stands at `EDGE` (0.47 tiles) and every model's
  wall at 0.44. The gate should allow an entry room's street wall that gap. On a 2 by 2 footprint it's 1.6 m (the Solenne's lobby): the street door is at EDGE from the facade tile's middle and the podium at 0.88 tiles from the block's.
- Whether the Halcyon Fields towers already authored on one tile (1 Halcyon Boulevard at 56 floors and the rest)
  move to 2 by 2 in phase 6 or stay as needle towers.
