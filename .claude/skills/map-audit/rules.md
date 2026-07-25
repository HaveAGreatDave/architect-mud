# Map audit — criteria catalog

The rules the audit evaluates, why each one matters, and how to repair it.

**The `RULES` array in [`scripts/audit-map.mjs`](scripts/audit-map.mjs) is the
authority.** This file is its prose mirror — it carries the reasoning and the fix
playbook that don't fit in a code comment. `--list-rules` prints the live list; if it
disagrees with this file, the script wins and this file needs updating.

**`kind: mechanical`** — the script decides. The finding is a fact.
**`kind: judgement`** — the script only surfaces a candidate. A human decides, and the
call goes in [`map-audit-decisions.json`](../../../docs/audits/map-audit-decisions.json).

**`[auto]`** — has a fixer. Everything else is a hand edit.

---

## CRITICAL — the tile graph is broken

### GEO-1 · Zone id disagrees with its own grid coordinates · mechanical

`zone_district_921_907` sitting at `(924,910)`. The id encodes a position and so does
`grid_x/grid_y`; when they disagree, everything that reasons about adjacency — neighbour
lookups, the entrance bake, the minimap, pathfinding — computes from the wrong one.

Typically appears in **swapped pairs**, the signature of a botched move or rotate.

**Never auto-fix.** Moving the coords to match the id teleports the tile if the id was
the stale half; renaming the id to match the coords requires rewriting every inbound
reference across `exits`, `zone_spawns`, `doors`, `maps`, `npcs` and `quests`. Read both
tiles, look at their descriptions and their neighbours, work out which half is the lie,
and repair by hand.

**Fix this first.** GEO-1 tiles manufacture phantom BLD-1, BLD-2 and LINK findings on
themselves and their neighbours. The fixers refuse to touch them until it's resolved.

### EXIT-1 · Exit points at a zone that does not exist · mechanical

Dead reference. Walking that way dead-ends. Delete the exit or repoint it.

### EXIT-2 · Cardinal exit does not lead to the geometrically adjacent tile · mechanical

A `north` that lands you somewhere that isn't directly north. Breaks the minimap and
pathfinding, and quietly destroys the player's mental model of the map. Check GEO-1
first — a scrambled tile produces this as a symptom.

### EXIT-3 · One-way exit — the target has no return link · mechanical

Players walk in and can't walk back. Nearly always an authoring slip. Add the mirror
unless the one-way is deliberate (a drop, a chute, a jump down).

Facade links are excluded — a facade is entered by forwarding, so it legitimately has no
return exit.

### EXIT-4 · Zone has no exits at all · mechanical

Unreachable and unleavable. Anything spawned or teleported there is stranded. Wire it in
or delete it.

### BLD-1 · Building is enterable from a non-entrance side · mechanical · [auto]

**The walk-through-wall bug.** A facade is non-standable — stepping onto it forwards you
straight into the interior. So *any* neighbour with an inbound link is a working door,
regardless of what `flags.entrance` says. A building with four inbound links has four
doors and three walls you can walk through.

Checked from the **inbound** side, not just the facade's own exits — that's what
actually gates entry.

The fixer removes both halves of every non-entrance link: the facade's exit and the
neighbour's inbound exit. Sealing only one side leaves a one-way wall.

### BLD-2 · `flags.entrance` names a direction with no matching exit · mechanical

`facadeStreetTile()` resolves the exit-side street via `exits[entrance]`. With no exit
there it falls through to scanning whatever cardinal exit it finds first, so leaving the
building drops you on an arbitrary tile.

Either add the exit on the entrance side or correct the entrance flag to a side that has
one — the description and the surrounding road usually say which.

### BLD-3 · Facade has an interior map but no exit into it · mechanical

Works today only because the revolving-door seam forwards on arrival. But the
facade↔interior exit is the **authored record of the door**, and the front-door lookup
walks that link to find the `doors` row. Without it, the building's lock is unenforced.

Add the interior exit on the cardinal opposite of the entrance.

---

## HIGH — building metadata integrity

### BLD-4 · `building_type` set but `is_building` is not · mechanical · [auto]

`is_building` is what groups interior zones into one building for the power network and
junction-box scope. A typed building without it is invisible to those systems.

### BLD-5 · `is_building` true but no `building_type` · judgement

`building_type` drives the 2-D rooftop footprint and the 3-D windshield shape — untyped
buildings render as a generic office block on both.

A **new** type needs entries in *both* registries or it reads inconsistently: the
footprint map in `server/engine/world.js` and the 3-D shape map in
`client/game/js/panels/windshield.js`.

### BLD-6 · `is_building` on a tile with no `facade` tag · judgement

Not automatically wrong — `facade` is deliberately opt-in because plenty of real street
tiles *host* a building without *being* one, and inferring the tag would sever the
street network. This only matters when the tile also has an interior map, which means a
building that never became enterable.

### BLD-7 · Facade with no interior map — an unenterable building · judgement

`isEnterableFacade()` needs a `maps` row with `parent_zone_id` = this zone *and* a live
`entry_zone_id`. Without one the tile stays standable and the building is scenery.
Either build the interior or drop the tag.

### BLD-8 · Building has no `building_name` · mechanical

Used for map labels and for grouping interior rooms under one building.

### BLD-9 · Facade has no `entrance` flag, or a non-cardinal one · judgement

`entrance` is the **authored** door side. It is deliberately *not* inferred at runtime —
inference let unrelated terrain painting silently relocate doors (painting a track west
of a shop moved its door off the street it fronted). Absent, the map draws no entrance
arrow and the exit-side street is guessed.

Set it to the cardinal side the door actually faces — the side with the street link.

### WEZ-1 / WEZ-2 / WEZ-3 · `world_exit_zone` missing, dangling, or not the entrance neighbour · mechanical · [auto]

The declared "where you come out" tile. Players spill out via `exits[entrance]`, but NPC
walk-out routines read `world_exit_zone`. **When the two disagree, NPCs leave the
building onto a different tile than players do** — which is how an actor ends up walking
out of a studio into the wrong street.

The fixer points it at the entrance-direction neighbour so both paths agree.

### DOOR-1 · Building has no door record on its facade/interior seam · judgement

No `doors` row means no lock, no hololock, no breaking in, no closing time — the entire
security surface of the building is absent.

Add a `doors` row on the facade↔interior link. Decline for buildings that are genuinely
open-air or always-open, and log the decline.

### SPAWN-1 · Enemy spawn sits on a building facade tile · mechanical · [auto]

A facade is never stood on, so the spawn is unreachable — and anything that does resolve
there is inside a wall. The fixer relocates the `zone_spawns` row to the entrance-side
street tile, preserving the encounter rather than deleting it.

### SCAV-2 · Loot table id points at a table that does not exist · mechanical

The search/fish/mine verb resolves to nothing. Repoint or create the table.

---

## MEDIUM — convention drift

### DIR-1 · `in`/`out` used as a direction on a world-map tile · mechanical · [auto]

Two conventions coexist: older buildings link the interior with `in`, reworked ones use
the **cardinal opposite of the entrance** (`entrance:east` → `interior:west`).

Movement resolves both, so this is consistency rather than breakage — but
`interiorExitDirs()` only draws exit arrows for cardinal links, so an `in` link leaves
the interior map with no way-out arrow.

**Canonical: cardinal opposite of the entrance.** The fixer rewrites the facade link and
mirrors the interior side's way back.

`in`/`out` on a **non-facade** world tile is a different thing — that's not a building
seam at all, and needs a human look.

### LINK-1 · No link to an existing walkable neighbour · judgement

Two adjacent tiles with no connection. Usually **intentional** at a terrain boundary
(shore, cliff, region rim) and usually a **mistake** between two tiles of the same kind.

Grouped by terrain pair (`redrock → water`) so a whole boundary is one decision rather
than hundreds. Note that transient waste rooms off a region rim aren't in `content/` at
all — a rim tile with no outward link isn't necessarily orphaned.

### LINK-2 · Facade's door faces this tile but there is no link into it · mechanical

The inverse of BLD-1: the building declares its entrance on this side and yet can't be
entered from it. An unreachable building. Add the link on both sides.

### FLAG-1 · Tile has no `flags.terrain` · judgement

`terrain` is the ground-surface SSOT — it drives the minimap, the tablet bigmap and
movement pacing. It does **not** control passability and does **not** control flight.
Unset renders as undefined ground.

### FLAG-2 · Tile has no `flags.region_id` · mechanical

Region drives weather, the climate profile, and overland/void travel rim detection.

### FLAG-4 · Sub-surface water tile with no `flags.underwater` · mechanical

`isUnderwater()` in the swimming plugin and the water-temperature model both key off
`flags.underwater`. Without it a tile below the surface never arms the breath timer and
reads as surface-temperature water — you can stand on the basin floor and never drown.

Currently **no tile in the world sets this flag**, including all 82 `z-1` Basin Floor
tiles. Either the sub-surface layer was built before the swimming system landed, or the
flag was never backfilled.

### TABLE-1 · Loot table is defined but no tile references it · judgement

Dead content — someone wrote the items and the messages and it can never fire. Usually
means the table was authored ahead of the tiles meant to use it; the item flavour
normally names its intended home.

Only evaluated on a **full-map run** (a `--region`/`--bbox` run legitimately won't
reference most tables).

Reference-counting spans **every zone**, not just the overworld tiles the rest of the
audit walks — interiors carry loot flags too (the Echelon's stern fishes its own table
from `map_echelon`).

**Caveat:** a table can also be referenced from outside content entirely — a plugin
default or a runtime writer. `fish_coldwater_bay` is credited automatically because the
fishing plugin assigns it to every water-adjacent tile. Check for a code reference before
concluding a table is dead.

### TABLE-2 · Loot table lists the same item more than once · mechanical

`weight` is a column, so a duplicate row is **not** a way to make an item commoner — it
silently doubles that item's share of both the per-attempt pick and the replenish pick,
*and* doubles the stock a zone initialises. Almost always an accidental double-insert.

Delete the extra rows; raise `weight` if the item really should be commoner.

### FLAG-3 · Tile has no `flags.district` · judgement

District is the naming/ambience grouping *under* a region. Legitimately absent on open
wilderness — this is a low-priority rule and a good candidate for a wide accepted
exception.

---

## JUDGEMENT — content quality

### SCAV-1 · Non-building tile with no scavenging / fishing / mining table · judgement

A tile with no loot table is a tile where `search`, `fish` and `mine` do nothing. Fine
for some terrain; a dead spot for the rest.

**Always work this grouped, and start with `--coarse`.**

`--groups` keys on `(terrain, name, region)` — ~520 groups. `--coarse` drops the name
and keys on `(terrain, region)` — **17 groups covering all 5,027 tiles.** The name is
decoration: "Ochre Draw", "Cinder Mesa" and "Ferric Wash" are the same redrock with the
same generated prose. Loot-worthiness follows the terrain.

So: decide at `--coarse` granularity, then use `--groups` only to carve out the
exceptions the user names. That is the difference between 17 decisions and 520.

Fishing and mining count as coverage. **So does the fishing plugin's automatic
fallback:** `fishingTableFor()` gives any tile orthogonally touching water the common bay
table for free, so a shoreline tile is already covered and is not reported. Water tiles
themselves are the inverse — the plugin returns `null` on them by design (you cast from
the bank, not while treading water), so scavenging is the only verb they can ever serve.

### PROSE-1 · Placeholder or thin description · judgement

Generated stubs shipping as final prose — `"The face of X."`, `"An empty place."`,
`"[PLANNER STUB]"`, `"A raw, undeveloped stretch of ground"`, or anything under 40
characters.

The `[PLANNER STUB]` pattern is the big one: an entire region (The Reach) is unwritten
and reads as boilerplate. Note that a stub is long enough to pass a naive length check —
match the patterns, not the length.

**Read [docs/story.md](../../../docs/story.md) before rewriting any of it.** It is the
tone authority, and tile prose is the single biggest surface the player reads.

### TERRAIN-1 · `flags.terrain` contradicts the tile description · judgement

`terrain` is the ground-surface SSOT for the minimap, tablet and movement pacing; the
description is what the player actually reads. When they disagree one of them is a lie —
usually a bulk terrain paint that missed a run, or prose copy-pasted across a boundary.

The description is normally the half a human wrote, so **repaint the terrain to match
it**. Check a few neighbours first; these come in runs.

Fires only when the prose names a surface the flag contradicts *and* the flag's own
surface is absent from the prose. **Water is excluded as the flagged terrain** — a water
tile's prose describes its margins by nature ("reeds have got a foothold", "cut deep into
the hardpan"), which is the bank, not the tile.

### NAME-1 · Placeholder zone name · judgement

The generator names a tile after its own grid position (`The Reach 863,1948`) or its raw
terrain (`Sand Ground`) when nobody has named it. The player reads that name on every
`look`, on the minimap and in the tablet — it's the most visible unfinished thing on the
map, and a whole region of it reads as a spreadsheet.

Don't name tiles one by one. **Name the area**: pick a handful of place names and paint
them across contiguous runs, which is how the rest of the world reads (Ochre Draw,
Slateback Rise, Ferric Wash). Read [docs/story.md](../../../docs/story.md) first.

### PROSE-2 · Zone name contradicts its terrain · judgement

Tiles repainted to road/asphalt/concrete keeping the name of whatever was there before —
a street still called Grasslands.

Rename to match the terrain, or repaint the terrain to match the name. **The description
decides which** — it's the half a human actually wrote.

### PAL-1 · Palette or `ambient_theme` left over from the previous terrain · judgement

The other half of the repaint problem: a road still carrying the grassland green
(`#8ba36a`) and `ambient_theme: forest`. It reads as grass on the map and sounds like
woodland underfoot.

Restyle to the terrain palette. Use the **`tile-palette`** skill to design the bg/text
colours rather than picking hex by hand.
