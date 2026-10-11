# The Slush Fund *(as built)*

**Status: BUILT.** The CPhL's own barn, on the old South Gate ground on the south-east edge of
Coldwater. Six tiles, one building, one door; four rooms and an ice plant; one vendor; three GLASS
arms over six building types; one map icon. No new mechanics.

Built 2026-10-11. The content is written by [scripts/content/slush-fund.mjs](../../scripts/content/slush-fund.mjs)
and the model is [glass/models/ashway.js](../../client/game/js/panels/glass/models/ashway.js).

## 1. What it is

Every club in the league plays at its own barn ([systems-broadcast.md](../systems-broadcast.md),
the clubs table and the `chatter.<club>` pools in `data/scripts/hockey.bsm`). The Slush Fund
belongs to the league: the final is played here, the scheduler's teleprinter is in the press box,
and KSAB has a gantry over the ice. The scoreboard is a television tuned to channel 7, so the
games that are played elsewhere come in here too.

The name is the ice and the money. The ice has been slush since the ownership change (a line the
booth already says), the building went up in a year on money nobody can account for, and the
scrapings the resurfacer tips out the back are a heap the staff call the fund.

The general `chatter` pool describes "this building" and is aired at every barn. Every fixture it
names is here: the goal judge's booth with the lamp that still works, the frank that is not
legally a hot dog, the man in section nine, the records door, the resurfacer whose fuel the league
won't disclose. ⚠ **The pool and the rooms describe one place.** Change a line in one and check
the other.

## 2. The site

The open block between Glacier Street and the south wall, inside the Curtain: the apron of the
old South Gate, where the weighbridge and the gate booth stood before the gate moved. It is a
block west of the Gate Road and the Shingles (Old Coldwater), on flat cheap ground at the edge of
town, with the cheap end of the entertainment quarter (Photo Finish, Pocket Money, Jolene's) on
the corners round it. Crowds walk in from Kerbstone Row and Foundry Way; coaches come off the Gate
Road.

The infill plan ([coldwater-infill.md](coldwater-infill.md)) kept footprints two or three tiles
across for an expansion, because the grid had no plot that size. This block is the exception: it
was open ground with no street through it, and building on it strands no tile (a flood fill from
Kerbstone Row reaches every tile round it).

| tile | was | is |
|---|---|---|
| 915,916 | grass | **The Slush Fund**: the front of the hall and the door (`ice_rink`, entrance north onto Glacier Street, marker `IC`) |
| 915,917 | scrub | the back of the hall (`ice_rink_hall`) |
| 914,916 / 916,916 | grass | the front stands (`ice_rink_stand_w`, `ice_rink_stand_e`) |
| 914,917 / 916,917 | scrub | the back stands (`ice_rink_plant_w`, `ice_rink_plant_e`) |
| 914,915 | grass | **The Forecourt** (`concrete`), where the queue forms at the box office |
| 914–916,918 | scrub | **The Yard** (`gravel`), behind it |
| 915–917,915 | pasture prose | **Glacier Street**, rewritten for the arena |
| 917,917 | the weighbridge pour | **Where the Weigh Was**, now the coach lay-by |

All of it is `district: ashway`, outside Old Coldwater, so `SLUM_DECLINE` doesn't apply and the
front can carry its name. ⚠ **913,915 is untouched**: it is Foundry Way's only way out.

## 3. Six tiles, one door

Only 915,916 is a facade. The other five are sealed the way The Dam's tiles are: a name, a
`building_type`, `entrance: north` and `floors`, empty exits, and **no `is_building`**, so they
take no map code and the map shows one building as `IC`. Every neighbour's exit into them is
stripped, and `mint-connections --write` landed the twelve walls as blocked connections.

The interior is ordinary `authorBuilding` (the Halcyon helper):

| room | from | what's in it |
|---|---|---|
| Concourse | the door | the concession counter, the trophy cabinet (the Cup's empty plinth), the records door, the cash drawer, Agnes Prowse |
| The Stands | south | the scoreboard (a channel 7 television), the rink organ (`instrument: organ`), the benches and the cushion in section nine |
| Rinkside | down | the goal judge's booth, the penalty box, the resurfacer |
| Press Box | up | KSAB's commentary desk (Brennan's chair), the scheduler's teleprinter |
| Ice Plant | down from the concourse | the utility room and the junction box |

Agnes Prowse runs the counter on the vendor graph: the rink frank (a new item), beer, coffee and a
steam bun. She is open Tuesday, Thursday and Sunday from 15:00 for the game, the other days for the
public skate, and shut on Mondays.

⚠ **Room names stay under 30 characters with the building's name in front**, because
`authorBuilding` writes `The Slush Fund — <room>` and `docs:prose` counts an em dash in any zone
string of 30 or more.

## 4. GLASS

A basilica: the hall is the middle column, two tiles long, under one barrel vault the length of
the rink, with a lower brick stand either side. The vault runs north to south so its arch spans one
tile, which is all `drawBarrelRoof` can draw; each half of it runs to its tile's edge and meets the
other there, profile to profile. The front gable is one great arched window in a steel grid over
the name in red channel letters, a canopy across the court between the stands with a lit board
(HOCKEY, and the three game nights) and a flag at each end. The back gable has louvres, the
resurfacer's roller door and the heap. The stands carry a box office (west front), posters (east
front), the ice plant's louvres and condensers (west back) and the players' door and loading bay
(east back); the two back stands have ICE painted along their outer walls, which is the `IC`.

- ⚠ **Every tile faces north and the whole building is in constants** (`RINK` in ashway.js), not
  `fh` and `h`, because both are rolled per tile and six tiles sized off them would step at every
  joint. Move or turn the building and the arms have to change with it.
- ⚠ **The four stands are one arm.** Their registry rows say which side the hall is on (`nave`,
  local x), which end they are (`end`) and what their outer face carries (`face`). The bake keys
  shapes by building type, so each row gets its own captured shape.
- ⚠ **Registered by type, never by name.** All six tiles carry the name; a `NAMED_MODELS` row would
  draw the front on every one of them.
- A box is never wider than 0.44 a side, so anything that runs to a tile edge goes through `span`.
- Lettering off the front asks `facing()` first, the way strokes do; flats never do.

Registrations: `TYPE_MODEL` (with `noKit`), `TYPE_FLOORS`, `BLDG_TYPE_3D`, `BUILDING_TYPE_ICON` and
`bldg_ice_rink.svg` (a rink from above), the baked shapes, the wildlands field and the flight-world
snapshot.

## 5. What isn't built

- **Games played here.** The rink on channel 7 is still the TV sub-screen, and nothing ties a
  broadcast to this building's stands. A game at the Slush Fund that a player could sit in is its
  own change (coldwater-infill.md keeps the venue and the event apart for the same reason).
- **Skating.** The ice is scenery. Public skating, if it comes, is a verb with a plugin.
- **The records room.** It is a line the booth says and a broom cupboard. It stays unfound.
