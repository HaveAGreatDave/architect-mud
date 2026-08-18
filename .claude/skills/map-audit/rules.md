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

**The audit reads the RESOLVED world** — your local database, zones plus the generated
`zone_render` rows — not the `content/` tree. Rules that ask "what does the map actually
draw here" (TERRAIN-2, the MARK-* family) read the build's answer instead of re-deriving
one that could differ from it. It refuses to run when the DB isn't at HEAD; fixers still
write `content/` files, and are hard-disabled against a remote host. See the skill doc.

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

**Two things this rule deliberately does NOT flag** (added 2026-07, when they were 279 of
its 283 findings):

- **The city↔wilds curtain.** Sealing it is code-enforced, not an oversight — the map
  editor refuses to wire across it (`_crossesWildsBoundary`), `routes.js` won't re-open
  it, and `seal-wilds-boundary.mjs` strips any crossing that appears. It is pierced in
  exactly one authored place, The South Gate ↔ The Glacis, which **[GATE-1](#gate-1)**
  guards.
- **Interiors and anything below z=0.** Hand-authored underground networks have authored
  topology, so grid adjacency is not connectivity: Rat Warren is a one-exit "drowned
  side-chamber", Silt Pocket is "a blind pocket", and Sealed Maintenance Door is a steel
  door with a dead keypad. Only open surface ground carries the "adjacent means walkable"
  expectation this rule tests.

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

### MAP-1 · Two zones share one grid coordinate on the same map · high

The tablet map lays a map out by raw grid coords — `cell[rowOf(t)][colOf(t)] = t` in
[tablet-os.js](../../../client/game/js/panels/tablet-os.js) — so colliding tiles
overwrite each other and **only the last one survives**. Every other room vanishes and
the you-are-here marker lands in whichever room won. This is why Halloran's Fix-It drew
its whole interior as a single square: the shop and its back room were both at `(0,0,0)`.

**The sidebar minimap hides this**, because it derives its layout by walking the exit
graph from where you stand rather than trusting coords. So the defect shows on one of
the two map renderers and not the other — which is exactly the kind of half-visible
breakage the audit exists to catch. Don't conclude a map is fine because the minimap
looks right.

Whole-tree check, like TABLE-1 — and it walks `zones`, not `targets`, because `targets`
is `map_world` only and this is overwhelmingly an **interior** defect.

Fix playbook, in order of how much the data tells you:

1. **Rooms linked by compass exits** — derivable exactly. A room whose single exit is
   `south` sits *north* of what it exits into; offset by the inverse of the exit
   direction. All 60 Yards Tenement units were placed this way, from the exit graph,
   with nothing hardcoded per unit.
2. **Rooms linked only by `in`/`out` or `up`/`down`** — no derivable answer. Placing
   them requires inventing a convention that would bind every in/out interior in the
   world, so it is a design decision, not a repair. The five Ascendant interiors are
   parked as `todo` in the decision log for this reason.
3. **A genuine overlay** — the Echelon moors on a Coldwater Basin tile and legitimately
   shares `(897,898,0)`. The script's own position index already knows about this one
   (it keeps the district tile as canonical so neighbour maths stays stable); it is
   `accepted` in the decision log.

### MARK-1 · Interior room carries a map marker · mechanical · [auto]

`zones.marker` is the ≤2-char glyph a tile draws **on a map**. Four readers, and they do
not agree on what they draw — worth knowing before you reason about any MARK rule:

| reader | draws marker on | mode |
|---|---|---|
| sidebar minimap ([minimap.js](../../../client/game/js/panels/minimap.js)) | building tiles only | Labels overlay only |
| tablet bigmap ([tablet-os.js](../../../client/game/js/panels/tablet-os.js)) | building tiles only | Labels toggle only |
| flight cockpit ground strip ([cockpit.js](../../../client/game/js/panels/cockpit.js)) | **every** tile (`marker \|\| '▪'`) | always |
| dev-panel map badge ([maps.js](../../../client/devpanel/js/panels/maps.js)) | **every** tile | always |

So a marker on a non-building tile renders in exactly two places, one of which is the dev
panel. The full-map popup is **retired** — `#map-grid` survives only as dead CSS; tapping
the minimap opens the tablet map.

An interior room is not a place you navigate the map *by*, **and it inherits
`flags.building_name` from its parent** for the directory and the exit links. So a marker on
one puts the building's acronym on a tile that is not the building — which is exactly how
"The Stacks" came to read `HA`. Every one of the 22 is a pre-convention hand-authored
interior (the early shop rooms, the Halcyon floors, the Records hall).

The dev panel already agrees: converting a tile into a facade explicitly writes
`marker=NULL` ([routes.js](../../../server/api/routes.js) `UPDATE zones SET … marker=NULL`).

**`map_world` is excluded, at every z.** A tile on the world map draws on the world map by
definition, however interior it feels — which covers the **117 `z<0` sewer tiles**
(`flags.is_interior`, `zone_under_*`) whose box-drawing markers (`║ ╠ ╬ ╝`) *are* the
underground level's corridor art. Flagging those would be 117 findings of pure noise.

**Apartments are excluded**, because [MARK-3](#mark-3) makes the opposite demand of them.

**Fix:** `marker: null` — the literal null, not a deleted key, which is how `content/`
represents "no marker" (see any `zone_util_*.json`).

### MARK-3 · Apartment has no floor designation as its marker · mechanical

The one interior that **is** a distinct place worth marking, and the exception that MARK-1
carves out. An apartment stack is dozens of near-identical rooms — 60 of them in the Yards
Tenement alone — whose only distinguishing feature is which floor they are on, and the
interior map is the only view that shows them all at once. `Halcyon Residence 41-A..E` each
carry `41` and read as a floor; the other 111 units carry nothing and read as an
undifferentiated grid.

The designation is already in the unit's own name, so `want` derives it:

| name | want | why |
|---|---|---|
| `Unit 2A` | `2A` | the whole designation fits the 2-glyph column |
| `Unit 1001` | `10` | too long → the floor, dropping the unit-within-floor digits |
| `Unit 203` | `2` | same rule, single-digit floor |
| `Halcyon Residence 41-A` | `41` | too long → the part before the separator |

Dropping to the **floor** rather than truncating is what makes units on one floor share a
marker, which is the only authored precedent there is (the five Halcyon 41s).

**Only absence is reported.** A marker that disagrees with the derived designation is the
author's call, not a defect — otherwise the rule would start fighting hand-numbered stacks.

**The BUILD derives this now** (`deriveMarker`, map-pipeline-spec §7.4), reading the same
`floorDesignation()` this table describes — the audit imports it from derive rather than
carrying a copy. So a finding here no longer means "somebody forgot to stamp a marker": it
means the unit's **name** carries no designation to derive one from, which is why the
`setMarker` fixer is gone. Rename the room.

**MARK-2 is in the same position**: the build assigns an acronym to any building that
didn't author one, seeing every building at once so the code is unique by construction.
An unmarked building is no longer possible; what MARK-4 (collisions) and MARK-5 (not
derivable from the name) ask about is the AUTHORED override, which is still a human's.

### MARK-2 · Building tile has no 2-character map marker · mechanical

The inverse. A building is the one thing on the map a player navigates *by*, and the marker
is what identifies it at a glance in the same two renderers. The convention across the 54
buildings that carry one is a **2-letter acronym of the building name** — `HR` Hall of
Records, `LB` The Lucky Bastard, `P9` Precinct 9.

A **1-glyph** marker is not a short acronym, it's a leftover: `#` is the glyph the district
planner stamped on grassland, and `🔧` is decoration that reads as an icon, not a label.
Note the check counts **glyphs, not UTF-16 units** — a single emoji is `.length === 2` and
passes a naive test.

Keyed on `facade` **or** `is_building` rather than facade alone, so a building whose facade
tag is missing (BLD-6) is still asked for its acronym. On today's map the two sets coincide
at 61 world tiles.

**Nothing derives one at render time any more.** Both player-facing renderers used to fall
back to their own acronym, and derived *different* ones from the same name — which is how
"Hall of Records" read `HA` on the sidebar and `HO` on the tablet while its authored `HR`
appeared on neither. The derivation now happens **once, at authoring time**:
`suggestBuildingMarker()` in [routes.js](../../../server/api/routes.js) stamps a suggested
acronym when the dev panel converts a tile into a facade, checked against the codes already
in use. So a marker is a value someone can see and edit, and a building authored *outside*
the panel wears no letters until someone sets one — a visible gap this rule reports, rather
than a plausible-looking code that differs per screen.

The finding carries `want` — an acronym derived the way the client's own Avenue-View label
does (initials of the significant words, possessives stripped). It is a **suggestion, not a
fix**, which is why this rule has no auto-fixer: `CC`, `CS`, `DS`, `FO` and `CY` are each
already on two buildings, so a derived acronym has to be checked against the ones in use
before it goes in.

### MARK-4 · Two buildings wear the same map marker · mechanical

The marker **is** the building's identity on the map now that no renderer derives one, and
the tablet bigmap shows many buildings at once. Two buildings sharing a code are
indistinguishable there.

This is only worth checking *because* the derivation is gone. The old sidebar fallback gave
61 buildings **33 distinct codes** — fifteen of them read `Th`, because it took the first
two letters without dropping the article — so collisions were the norm and there was
nothing to measure against.

13 buildings collide today, in 7 groups: `CS`×3, and `AG` `CC` `DS` `CY` `FO` `FB` ×2.

**Rename the less-established one**, and read the neighbours before picking: the authored
set namespaces deliberately (the Ascendant campus is `AV AS AR AC AG AW`), so the first
free pair of letters is often the wrong answer. Scoped to world building tiles — a terrain
glyph like `≈` is *supposed* to repeat across the whole bay.

### MARK-5 · Building marker is not derivable from its name · judgement

The marker and the name are the two things that identify a building to a player, and they
are authored in separate fields with nothing keeping them in step. So a rename can leave the
old code behind and nothing says so.

**This is a JUDGEMENT rule, and a thematic marker is frequently the better answer.**
`GN` on the gunshop *Ironside Arms* says what the shop **sells**, which is worth more on a
map than `IA`. The rule exists so that choice gets *made and recorded*, not so every marker
becomes initials. The normal outcome of a MARK-5 review is a
[decision-log](../../../docs/audits/map-audit-decisions.json) entry, not an edit.

Fires only on markers that are already the right shape — an absent or 1-glyph marker is
[MARK-2](#mark-2)'s business, so the two never both fire on one tile.

**"Derivable" is deliberately wider than the single `want` suggestion,** because more than
one honest acronym exists: any *ordered pair* of the significant words' initials ("Embassy
Hotel & Bar" → `EH`, `EB`, `HB`) plus the first two letters of any one of those words ("The
Stacks" → `ST`). Articles are dropped and possessives stripped, same as `twoLetterAbbrev`.

**Read the `group` before reading the tiles** — it is *why* the marker diverges, and each
class is one decision rather than one-per-building:

| group | means | today |
|---|---|---|
| `namespace prefix` | last glyph is a word's initial, first is not — a shared campus letter | 4 · the Ascendant set (`AV` The Vats, `AS` The Spire, `AC` Chrome Clinic, `AW` The Weave). **This is the grouping MARK-4 tells you to preserve** |
| `article kept` | the initials taken *without* dropping the article (`TC` The Cherry Pit) | 4 · an acronym under a different convention |
| `unrelated` | neither — the code encodes something outside the name, usually the trade | 25 · the only class worth reading building by building |

Counts are as of the 2026-08-17 sweep over all 115 buildings (82 read off the name). That sweep
changed four codes and left the other 30 divergences standing, because **the divergence was the
point in almost every case** — `AE` is the Ampersand Electronics on *Ohm Sweet Ohm*'s own fascia,
`JT` the JITTER stencilled on *Battery Acid Coffee Co.*'s glass, `CY`/`FY`/`WF`/`BW` the
container yard, fuel yard, wharf and bonded warehouse each building actually is. The four that moved
had nothing behind them in their own description: `BB`→`SI` *Screw It*, `MR`→`SN` *Stitch 'n'
Bitch*, `PP`→`SV` *Sentimental Value Pawn*, `LD`→`DL` *The Deadline*. **Read the description
before calling a code drift** — that is where the answer was every time it was not drift.

### NAME-2 · Interior room name repeats the building it is inside · judgement

"Hall of Records — The Stacks" spends half the room title on something the player
already knows: they walked through that door, the map is labelled with it, and
`flags.building_name` carries it for the directory and the exit links. It's the
most-repeated redundant text a player reads.

**Key the building off three records, in descending authority** — this is the part that
matters, and getting it wrong in either direction is easy:

1. the room's own `flags.building_name`
2. the facade at the map's `parent_zone_id` (its `building_name`, else its name)
3. the map's own name up to the first em-dash (`Halloran's Fix-It — Interior`)

Keying on (1) alone finds 18 rooms and **misses all ten Yards Tenement floors**, which
never carried the flag. Keying on (3) alone over-reaches to 99 and starts mangling
things.

Two classes are exempt and the check skips them:

- **`zone_util_*`** — power-sim utility rooms are named after their parent *room*, not
  the building ("Guardian Battery — Bunker — Utility Room"), so stripping the building
  yields a half-stripped "Bunker — Utility Room", and the ~40 survivors would all share
  one name.
- **single-room interiors** — where the one room IS the building, the prefix is the
  identity rather than a repetition. Four separate AA bunkers must not all become
  "Bunker".

### GATE-1 · Nothing crosses the city↔wilds curtain · critical

A whole-map assertion, not a per-tile check, and the deliberate counterweight to LINK-1
ignoring ~266 sealed curtain edges. That silence is only safe while at least one gate
survives. Today there is exactly one — **The South Gate** (`zone_district_918_919`) ↔
**The Glacis** (`zone_district_918_920`) — and if it were ever sealed too, 3,471
wilderness tiles would become unreachable on foot with nothing else in the audit to
report it.

Fires only when the crossing count reaches zero. Verified by cutting both directions of
the gate and confirming it trips, then restoring.

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

### FLAG-3 · `flags.district` names a district the engine cannot resolve · high

`districtFor()` honours an override **only if `DISTRICTS[value]` exists**. Anything else
is silently dropped and the tile falls back to the id-prefix table — in practice
`residential` (or `hazard` if the zone is lethal). That wrong district then drives the
district-ambience leitmotif lines, the district named on `look`, the minimap colour and
the regional map.

**Absence is not a defect.** `districtFor()` always returns a real entry, so a tile with
no `flags.district` is using the derived default, which is the normal case. This rule
checked absence until 2026-07 and produced 962 findings of pure noise while missing the
actual bug: 3,611 tiles carried an unresolvable override, 2,993 of them open wilderness
(`district: 'wilds'`) announcing itself as a residential neighbourhood.

**Fix in the engine, not the content.** Add the missing entry to `DISTRICTS` in
[server/engine/districts.js](../../../server/engine/districts.js). Do **not** remap the
content when the value is load-bearing elsewhere: `wilds` is read as a literal string by
the city↔wilds curtain (`maps.js`, `routes.js`, `seal-wilds-boundary.mjs`,
`wildlands-expand.mjs`), so renaming it would re-open the boundary.

A new entry needs a non-empty `signature` pool — `plugins/district-ambience/regress.js`
fails the build otherwise. `landmark`/`skyline` are optional (`null` is fine; `describe.js`
guards on both). The dev panel reads the table over `/districts`, so there is no
client-side mirror to update.

---

## JUDGEMENT — content quality

### SCAV-1 · Non-building tile with no scavenging / fishing / mining table · judgement

A tile with no loot table is a tile where `search`, `fish` and `mine` do nothing. Fine
for some terrain; a dead spot for the rest.

**This is a coverage backlog, not a defect list.** Only **6.5%** of world tiles carry a
table, and they are hand-placed on city, road and sewer ground — 4 of the 2,996 redrock
tiles have one. So the count measures *how far the search verbs currently reach*, never
*how many tiles are broken*. Work top-down and stop when coverage feels right; finishing
the list is not the goal, and a run that leaves thousands outstanding is not a failure.

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

**`park` is exempt.** It is built ground that is *supposed* to look natural — a green
with trees. All 8 Fisherman's Green tiles carry the same `#8fd08a` / `forest` palette
deliberately, so flagging them was 8 of the rule's 31 findings. PROSE-2 still covers the
related case (a natural *name* on built ground).
