# The Studio

A map editor that edits **files**.

```bash
npm run dev        # game server on :3000 AND the Studio on :5180
npm run studio     # the Studio alone
```

→ <http://localhost:5180>. Local only; there is no auth and no reason to expose it.

`npm run dev` starts both because needing two terminals was the only real cost of
keeping them apart ([scripts/dev.mjs](../../scripts/dev.mjs) is the whole of that
integration — it spawns, it reports, it takes the other one down when one dies).
They remain two processes, and that is the point: this one has no database in it,
and its save path lints ~10k files synchronously, which inside the game server
would stall the tick loop on every save. `npm run dev -- --no-studio` opts out.

## What it is

The dev panel's Maps tab edits a live database and mirrors each edit into a file
afterwards. The Studio reads and writes `content/` and nothing else — **there is no
database in the process at all** — which removes a whole class of "it looked right
in the tool and shipped wrong". Two properties do that work, and both are pinned by
`npm run test:regress`:

**The preview is the ship.** Every fill, ink and glyph on the canvas comes from the
render spec produced by [`scripts/content/derive.mjs`](../../scripts/content/derive.mjs)
— the same module `content:import` runs. The server owns no palette, the client owns
no contrast function, so neither can draw a colour the build would not produce. That
matters more than it sounds: before the pipeline's step 3 there were **three**
disagreeing terrain palettes and two different contrast functions, so the same tile
was lettered differently depending on which tool you looked at it through.

You can watch it be true. Paint `grass` onto a wilderness tile and it stays dark
brown, because the palette entry sets `authored_bg_wins` and the tile's own
`bg_color` is its room-colour identity. A naive editor would have shown you green
and shipped you brown.

## What a tile looks like

The canvas draws what the **game** draws, tile for tile, because both read the same
spec — and since spec §7.7, the same *assets*. A tile is three layers, and which
layers it has is the whole answer to what may be drawn on it. None of these rules
lives in this tool:

| layer | comes from | when |
|---|---|---|
| ground | `spec.fill` + terrain texture | always |
| feature | `spec.feature` — one zone-icon SVG | iff something stands on the ground |
| label | `spec.label` — `{text, kind}` | iff a code means something there |

**Painted ground draws its art, not its lettering.** `zones.marker` carries ~870
hand-placed terrain decorations — `#` across the grasslands, `≈` on water, six
different textures on road — and derive keeps them authored on purpose (spec §7.4).
But the map has never drawn them: the game letters a **building** tile and paints the
tile's own art everywhere else. The Studio used to be the odd one out, lettering every
painted tile, so the grasslands read `# # # #` here and read as grass in the game. It
was not a bug in this tool — it was drawing the spec faithfully, and `spec` was
describing a tile the game had abandoned. `deriveLabel` now suppresses a label on any
tile with a terrain, so both screens get the rule from the same place.

**The feature is the game's own SVG, rasterised** — not a drawing of one. An earlier
pass hand-drew the road lanes on canvas to match the connector assets by eye. It
looked right, and it was still this tool holding an opinion about what a road looks
like, which is the one thing it is not allowed to do. Regress forbids naming a piece
in this file at all.

**Roads auto-tile.** `spec.auto_tile` is `{n,e,s,w}` — which sides this tile joins —
and `spec.feature` is the piece that falls out of it, so straights, bends, Ts and
crossroads need no piece list. **Paint a road tile next to another and both re-draw at
once**: the paint response carries the specs of the stroke *and* of everything one tile
around it, which is the entire blast radius of
[`deriveAutoTile`](../../scripts/content/derive.mjs). A road with nothing beside it
draws the lone dot — a road tile on its own should look like the mistake it is. Paved
and dirt lanes fuse into one network, because both auto-tile and the game has always
joined them at a proper junction.

**A tile can be overridden, and the override is ordinary content.** **Map Icon** in the
inspector is the top rung of `deriveFeature`, above the building rooftop and above
auto-tiling, so pinning a tile's art is a normal authored field that ships through the
normal deploy. It is a picker of the assets that actually exist — `—` clears it and the
tile goes back to deriving its own — and it is the catalog's standard `ref` control, not
a widget this tool wrote: `flags.icon` is simply described as a `ref` to `zone_icons`
now, so a name that doesn't resolve shows red here and fails `content:lint`.

**Every tile says who decided.** Under the derived line the inspector states the art and
the rung that produced it — *pinned by hand*, *derived from this building's type*,
*auto-tiled from the lanes beside it*, or none. A pinned tile is also **dotted on the
canvas**, because an override you cannot see is one you cannot review; 108 tiles carry
one today.

**And it says when a pin has gone stale.** The cost of pinning is that the pin does not
move when the map around it does — paint a lane beside a frozen road piece and it stays
a dead end. That tile's dot turns **red** and the inspector says what adjacency now
implies, so it reads as the defect it is rather than the decision it was. 13 of the 91
hand-frozen road pieces are already in that state; `npm run test:regress` prints the
list. Runways are deliberately exempt — they auto-tile but draw a different piece set,
so they are a different choice, not a stale road.

**Art or Labels, never both.** 61 world tiles carry a rooftop SVG *and* a navigable
code, and this drew the letters over the middle of the rooftop — a combination no
screen in the game renders, because the graphic and the code are two ways of saying
the same tile. **Art** (the default) shows the footprint; **Labels** swaps it for the
code. It is the game's own switch under the game's own rule (`avenueOverlay` in
[minimap.js](../../client/game/js/panels/minimap.js)), with one deliberate departure:
a tile with a code and *no* art keeps its code in both modes. Most interiors are
exactly that — Chrome Court is 12 room designations and not one SVG — and the game can
afford to leave those bare because a player is standing in the room reading its name.
An editor cannot; the toggle exists to stop two layers fighting over one tile, and
there is nothing to fight with there.

**The overlay toggle cannot reach a road.** Not because anything checks — because a
road tile has no `label` key, so there is nothing there to toggle. `kind` says what the
game's Labels/Icons switch may do: `building` and `room` codes follow it, `art` (the
sewer corridors' connectivity pieces) is the tile's own drawing and survives every mode.

**Tiles touch.** There is no gutter between them: a bay is one body of water, not
945 blue squares. The grid returns as a hairline once you are zoomed past ~14px per
tile — far enough in to be editing rather than looking, which is the only time
counting tiles is what you are doing.

**Where a tile is, is not a field.** The corner pill states `x,y,floor` and the canvas
is already showing you the tile in place, so the three coordinate columns are not
rendered as number boxes — the same fact typed twice, and *typed* was the problem: a
spinner invites a nudge, and a nudge moves a tile with none of what moving a tile needs
(the neighbours it auto-tiles with, the cell it might land on top of, the seams
pointing at it). Moving a building is a real operation now — see [Picking a building
up](#picking-a-building-up) — and it lives in the Geometry group where the fields
were, because that is the question this group is about. It is still not an arrow key.
This is the only place the inspector suppresses a catalogued column; the values still
round-trip untouched, so a save is still a byte-for-byte no-op.

**The form is the catalog.** The inspector is generated from
[`client/shared/tagCatalog.js`](../../client/shared/tagCatalog.js) — label, shape,
group, help text, enum options, `refTable`. There are no hand-written form fields, so
a column added to the catalog is editable here without touching this tool, and a
field that is *not* catalogued cannot be typed in by accident.

## What it refuses

Every save runs the same shape checks `content:lint` runs, plus the schema's own
column list, and **refuses on error**. The Studio must not be able to author
something the deploy gate will reject — finding that out at push time is the loop
this replaces. Proven against all five failure modes:

| you try to | it says |
|---|---|
| point `audio_theme_id` at a song that doesn't exist | `is not a row of audio_songs` |
| set `flags.radiation` to `"hot"` | `radiation (number: got "hot")` |
| invent a flag | `is not in the field catalog` |
| invent a column | `is not a column of zones` |
| set an out-of-range enum | `not in indoors/outdoors/city/…` |

A refused save leaves the file untouched, byte for byte.

Unresolvable references are also shown rather than hidden: a `ref` field whose value
names nothing renders red and says `NOT IN <table>`, instead of silently accepting a
dead string. Per spec §10.1 the Studio will **not** create the missing target — a
loot table or an audio theme is somebody else's entity, made in the dev panel or
`design-cli`. Its job ends at *"this tile points at that table."*

## The map owns what belongs to the map

Some things are facts about a whole map, not about each of its tiles, and the
tool used to ask for them per tile. **A map hangs off one world tile** — that is
`maps.parent_zone_id` — and every tile carries a copy in `parent_zone` so the
engine can read it off the tile it is standing on. When 331 tiles each hold their
own copy, they drift, and the drift is silent because a stale id still resolves:

- Halcyon's **Elevator** named its own Grand Lobby as its parent, not the tower's
  street tile. Half the world used `parent_zone` that way; every runtime reader
  uses it the other way.
- Three utility rooms — under Jitter, the Meltwater Diner and Ward Nine Permits —
  still named the world tile their building stood on **before it was moved**. A
  player leaving through one would have surfaced two blocks away.

So the anchor is edited on the map (**Map properties…**) and **pushed to every
tile in the same save**, and it is *locked* on the tile inspector with a note
saying where to change it. `content:lint` errors on any tile that disagrees, so
a drift reintroduced by hand or by an old script fails at the gate rather than
shipping. The repair for an existing tree is
[`scripts/content/sync-map-anchors.mjs`](../../scripts/content/sync-map-anchors.mjs),
which is idempotent.

Tiles on **no map** are untouched: there `parent_zone` is the dev panel's room
grouping, which is a different thing and stays editable.

**A map's name works the same way.** Leave it empty and an interior map is named
after the building it hangs off, so renaming the facade renames the map. 17 of 69
had already drifted apart — The Cherry Pit's interior was still filed under
"Cathode Row", Ampersand Electronics under "The Overpass", Ration Nine under
"Battery Square". Type a name only to override that; four maps do, because their
facade is named for a room rather than for the building. Nothing player-facing
reads `maps.name` — it is an authoring label in this list, the dev panel's, and
the audit — which is what makes deriving it safe.

**The map list fans down.** 71 entries held open is most of a 190px column spent on a
list you use once a session; folded, its summary still carries the one thing the open
list was telling you — which map you are on, and how many tiles it has. Following a
seam changes that summary too, because it is read from the open map rather than from
the click.

## The district view

**Tiles / Districts** at the top of the sidebar switches what you are asking about the
map in front of you. Nothing else changes — same canvas, same camera, same floor, same
open map — because a district is not a different place, it is a different question
about this one: *whose is this?*

A district is the land-use neighbourhood a tile reads as: its name with the room, the
line when you cross in, the smells outdoors, the colour on the tablet's regional map.
It is spread across thousands of tiles, which is exactly why it could not go on staying
a text box on one tile at a time — that box held a key that had to match a district
exactly, with nothing checking it did, so a typo read as "unclassified" and looked
identical to a blank. **The tile inspector no longer offers it.** It says which district
the tile is in, and how it got there, with a button through to it.

| on the canvas | means |
|---|---|
| coloured wash | the district's own authored colour — the selected one at full strength, everything else at half |
| pale outline | assigned by the **legacy id prefix**, not painted: it reads as that district only until the zone is renamed |
| dim centre dot | claims **no** district — 1,150 tiles, which in game means the engine's default neighbourhood, not silence |
| red outline | claims a district that does not exist, so it resolves to the default while looking assigned |

The ground keeps its own colour underneath, because assigning neighbourhoods to a map
you can no longer read is not editing. **Paint** assigns, **Pick** lifts the district
under the cursor, and **Erase** — the first entry in the list, carrying the count of
unclassified tiles — clears `flags.district` rather than painting a district of "none".

Selecting a district loads it as the brush *and* opens its fields, which is one action
because they are one thing: change a colour and the map you are painting redraws in it.
The form is generated from the field catalog like every other form here, so the prose
that used to be a 240-line literal in engine source — mood blurb, skyline phrase,
sensory pool — is now ordinary authored content in `content/districts/`.

Two things it shows rather than fixes: a **landmark naming no zone** (all 14 do, so no
district composes its "To the north, …" line today) renders red as any dead ref does
and `content:lint` warns — but the save is not refused, because it ships today and this
tool must not be stricter than the gate it stands in for.

## Following a door

A tile that leaves the map is **outlined**. **Double-click it** and the Studio opens
the map on the other side, centred on the tile you would land on, with **← Back** to
come home. The inspector says the same thing in words — *Leads to* on a tile,
*Leads off this map* on the map itself, which on the world map is the index of all
62 buildings you can walk into.

**The side you go through is a bar across that edge** — a threshold, the way a floor
plan draws a doorway. A street of shops reads as a row of bars facing the road, so a
door on the wrong side is visible from across the map instead of one tile at a time.

| | |
|---|---|
| **amber bar** | the authored door side, `flags.entrance` (62 tiles) |
| **blue bar** | the side the seam leaves by, where no door is authored (65) |
| **blue dot** | `up` / `down` / `in` / `out` — no side exists (23) |
| **blue outline** | this tile leaves the map at all |

**Never an arrow**, and that cost a version to learn. A seam's `direction` is a true
statement about *this tile's edge* — an authored connection **claims** its
`(from, direction)` and the grid edge there steps aside (spec §7.5), so nothing is
reachable that way except the seam. But an arrow reads as a vector **at the
neighbour**, and the neighbour is innocent: Pawn & Pity's seam direction is `east`,
and east on the world map is The Neon Vig, so the arrow pointed at the casino while
meaning *"step east into Pawn & Pity's own interior"*. A bar says the same thing
without pointing at anybody.

**Which edge, when a tile has two candidates: the authored one wins.** A facade
carries both a street-facing `flags.entrance` and a seam direction into the building,
and they are opposite by construction on 60 of the 62 — through a north door means
heading south. Two bars on two edges is one fact rendered twice, so the amber bar is
drawn *instead of* the blue one, never as well.

The marking is complete because the Studio does not decide what a warp is.
[`projectEdges`](../../scripts/content/derive.mjs) already labels every edge whose
two ends are on different maps `kind: 'portal'` — 150 of them — and that is the
list drawn. A facade, a bunker hatch, an elevator shaft and a connection authored
tomorrow all appear without this tool learning what any of those are.

Two things it shows rather than tidies away:

- **One-way** is labelled. Two of the 150 are, and a seam you can walk into but
  not out of is worth seeing before a player finds it.
- **12 seams land on a tile filed on no map** — the Echelon suite's bathroom,
  Solenne's apartments. The build calls those portals because they do cross a map
  boundary in the only sense it can measure. They are listed and say `on no map`,
  and the jump is disabled, because there is nothing to open.

**Floors are separate.** A map is a stack: 20 of the 71 have more than one `grid_z`
and the residential lobby has five, so the canvas draws one at a time and the floor
buttons appear when there is a choice. Before this they were painted on top of each
other and a click could only ever reach the ground floor — which also meant the
13 seams landing below ground had nowhere visible to land. Following one switches
floors for you.

## Picking a building up

A building is one facade tile on the world map plus a whole interior **map** hanging
off it, and about a dozen other rows naming that facade — the front door, the utility
generator, every interior tile's anchor. So neither of these is a coordinate edit, and
the rules for both live in
[`scripts/content/transform.mjs`](../../scripts/content/transform.mjs) rather than in
this tool, for the same reason the palette does: `npm run test:regress` drives them
with no server in the room.

**Turning it is about the door.** Select a building and the Geometry group offers the
four **door sides**, with the ones it cannot reach disabled and saying why. Not a
↺/↻ pair: 30 of the 62 buildings have exactly *one* alternative side their door can
open onto, and for some of those it is the opposite one — a half turn that a pair of
90° arrows could only reach through an illegal intermediate.

**It turns whole.** `flags.entrance`, the facade's exits, every interior tile's
coordinates (about `(0,0)` — all 68 interior maps put their entry zone there), every
exit key inside it including the diagonals, every connection direction, the front door
and any camera. Turning the door alone is the tempting version and it is wrong: the
interior's way-out faces the door by convention, so a quarter turn drops it on top of
whatever room holds that cardinal. Turning the interior with it is collision-free by
construction — the room that was north is now east. **Prose is not turned**, and a room
that says *"the north wall"* is listed for you to go and fix rather than silently
rewritten.

**Moving it is an identity swap, not a coordinate swap.** The **Move** tool picks a
building up, tints every cell it cannot land on, and drops it with a plan you confirm.
No `grid_x` ever changes: the destination row *becomes* the building and the old
facade row becomes ground. That is not squeamishness about writing a number — a
world-map zone id encodes its own position (`zone_district_<x>_<y>`, 58 of the 62), and
map-audit **GEO-1** calls a coord/id disagreement *"the signature of a botched move"*,
then refuses to run its other fixers over the tile. Swapping coordinates would brand
two tiles per move. `power_zones` is deliberately left alone throughout: its id **is**
the zone id and its row says which grid feeds that cell, so it belongs to the ground,
not to what is standing on it.

**The hole heals from a neighbour.** The vacated cell has to be *something* —
`name` and `description` are NOT NULL — and `content/map/terrain.json` refuses a
palette-wide default on purpose, so there is nothing to fall back to. It copies the
commonest plain ground beside it instead, and the plan names the donor with a picker
to choose another. A building in the grasslands leaves Grasslands behind and one on
Ironside Street leaves Ironside Street. No prose is invented, because inventing prose
is the one opinion about content this tool must not hold.

**The door does not move itself.** Move preserves `flags.entrance` and refuses a
destination with no street on that side, naming the sides that would work so you turn
it first. `flags.entrance` was made authored precisely to stop a door relocating as a
side effect — [world.js:190](../../server/engine/world.js) records that while it was
inferred, painting a dirt track west of Pawn & Pity moved its door off Marrow Street.
Both shipped tools that place buildings still auto-pick a door at the destination.
This one does not.

**What it refuses, and why each is a refusal rather than a warning:**

| it says | because |
|---|---|
| *…is already a building* | the swap would leave two interior maps on one facade — the dup-map state `test:regress` hard-fails, and which one is reachable is then down to a linear scan |
| *…has N thing(s) standing on it* | a facade is not standable, so a streetlight or a spawn point on that cell is sealed inside a building nobody can enter |
| *the door faces north and there is no street north of…* | a facade opens at `flags.entrance` and nowhere else, so a door pointed at a wall is a building with no way in that still looks enterable |
| *would open the city↔wilds curtain onto…* | the facade rule was excusing that frontier adjacency; as ground it needs an authored wall, and this tool does not create files — it hands you `mint-curtain-walls.mjs` |

Water and a consumed road lane are **warnings**: visible, recoverable, and sometimes
what you meant.

## Taking it back

**Ctrl+Z**, or the **Undo** button under History. Ctrl+Shift+Z (or Ctrl+Y) puts it
back. The log holds the last **20** actions and it is the *server's*, not the page's
— reload the tab and you can still take back what the session wrote, because the
files it would be reverting are still there.

The reason it lives on the server is that there is nothing else it could honestly
live on. Every edit here is a file on disk before the gesture is finished; there is
no unsaved buffer to close without saving. A client-side undo would also be
apologising for writes it never saw: saving a map pushes the anchor onto every tile
on it, and painting one road tile changes what the four around it draw.

**An action is one thing you did, whatever number of files it turned into.** A paint
stroke across 40 tiles is one entry. A map save that rewrites 331 is one entry. The
journal does not know what any of those *are* — it records at `writeRow`, the one
funnel every write goes through, and keeps the whole row from **both sides**. So
reverting is the same write in the other direction rather than a per-operation
inverse (un-paint, un-assign, un-anchor) with its own bugs to find.

**It re-derives, it does not un-draw.** After a revert the derive cache is dropped
and the map is re-read from the files that now exist — the same whole-map pass a
fresh paint gets, because a building's rooftop depends on every other building and a
road's connector on its neighbours. There is no undo path through the renderer to
disagree with the build.

**It undoes newest-first, and that is load-bearing.** The newest entry is, by
construction, the last writer of every file it touched, which is what makes a revert
safe without a dependency graph between actions. Clicking an entry in the log walks
back through everything above it one step at a time; it never reaches past them.

**Somebody else's write wins.** An undo runs the same `conflictOf` check a save
does, against every file it would rewrite — so a git pull, `sync-map-anchors`, or a
hand edit since the action stops it, whole, with nothing written. That is the same
refusal a save gives you and for the same reason: the bytes it is about to replace
must be the bytes it wrote.

The canvas follows the revert. If the action landed on a map you are not looking at,
the Studio opens it and centres on the tile — a write you cannot see is exactly what
this is here to stop.

## What it writes

`content/zones/<id>.json`, through the same `canonicalJson` writer `content:export`
uses — so a no-op save produces **no diff at all**, and a terrain paint produces a
one-line one. Review it with `git diff` like any other change and ship it with a
push.

## What it does not do yet

This is increment 4 of spec §11 step 8. It views any map, edits every authored field
of a tile, paints terrain, owns the map-level properties above, walks the map tree
through its seams, and moves and turns a building. It does **not** yet do New
Building, the region planner, connection editing, or structural operations on
anything that is not a building — those stay in the dev panel and in
[`scripts/place-building.mjs`](../../scripts/place-building.mjs) until the next
increment moves them.

Two known edges of Move and Turn, both shown rather than hidden:

- **A connection's id can go stale as a name.** `conn_asc_vats_registry_north_skyh`
  still says `north` after that door turns west. Ids are opaque to everything that
  reads them, and renaming one means creating and deleting a file, which this tool
  does not do.
- **The Echelon cannot be turned**, because she sails: `plugins/yacht/index.js`
  writes her `flags.entrance` as she docks, so an authored turn would be overwritten
  by the next docking. Neither can Halloran's Fix-It, whose interior has a second seam
  out to `zone_under_terminus` — turning it would swing a door whose far side does not
  turn. Both are computed from the tree, not listed, so a third one authored tomorrow
  is caught the same way.

The dev panel's Maps tab now carries a banner saying which side of the fence it is
on. Both tools work; what does not work is assuming they can see each other. Paint
in the Studio and the dev panel is stale until `npm run content:import`.

## Lint

The bottom-right badge runs `content:lint` over the working tree on every save, so
the authored-half rules answer **live** (spec §8.4). The derived-half rules — the
ones that read `zone_render` and `zone_edges` — need an import and the badge says so
rather than implying a freshness it doesn't have.
