# Map Pipeline Redesign — authoring, deriving and shipping the world map

**Status: PROPOSAL. Nothing here is built.** Step 1 of 4 — investigate and plan. Steps 2
(design in detail), 3 (cut over) and 4 (ship) follow a decision on the shape below.

Written 2026-07-26 against the working tree on `claude/agitated-hermann-382b76`; revised twice
the same day after John's corrections. Every factual claim carries a `file:line` or a
reproducible census. Where the investigation contradicts an existing doc — or a figure handed
to it — the contradiction is called out rather than smoothed over.

**Decisions already taken — these are settled, not options:**

- **The Studio owns all authored per-tile data**, game-facing included — `floors` (Dave's
  building height), audio, scavenging tables, flight flags, feature anchors. Not a presentation
  editor (§1)
- **A brand-new standalone Map Studio**; both the dev-panel map editor *and*
  `tools/zone-planner` are retired entirely (§10)
- **Derived data lives in separate generated tables classed `runtime`** — `zone_render` and
  `zone_edges`, TRUNCATEd and rebuilt every import (§5.7)
- **Zone ids stop encoding coordinates** (§7)
- **Connections become their own table, in this cutover, not deferred** (§8)
- **Locks: the auto-minted keycard item is deleted; `lockable` is authored on the connection,
  the installed lock is runtime-only, and access is a per-side list of typed principals**
  (`player:` / `corp:` / `org:` / `item:`) (§8.4)
- `suggestBuildingMarker()` survives as a shared function and a greyed-out preview, never as a
  write path. **Shipped in `6a36f907`** — the render-time derivations are gone from both
  renderers and the authoring-time stamp was stripped, so `marker` is now purely authored
  (§10.5)

**Still open:** one substantive question (`audio_theme_id`'s granularity, §16.3) plus five
step-2 design details (§16).

---

## 1. The axis

**The split is authored vs derived. It is not gameplay vs presentation.**

The problem *looks* like "presentation leaked into the content files", and the fix looks like
"pull presentation out". That is half the answer and it under-scopes the tool badly.

The real defect is that **nothing anywhere in the system distinguishes a value a human chose
from a value something computed.** Both live in the same JSON key, in the same column, written
by the same code path, read by the same renderer. Once that distinction exists, presentation
falls out for free — but so does everything else, and the tool that owns the authored side has
to own *all* of it.

> **The Studio owns every authored per-tile fact — geometry, gameplay, identity, audio, flight,
> feature anchors, the lot. The build owns everything implied by them. The goal is not to stop
> managing game data; it is to stop managing it against a live database.**

`flags.floors` — Dave's building height, the number an aircraft collides with
([tagCatalog.js:307](../../client/shared/tagCatalog.js), read at
[windshield.js:2869-2872](../../client/game/js/panels/windshield.js)) — is a first-class
Studio field. So is `ambient_theme`. So is `radiation`, on 3,468 tiles. So is
`scavenging_table_id`, on 1,330. **The Studio is a tile editor that happens to be spatial**,
not a paint program.

---

## 2. The problem, stated structurally

Every field is authored per-tile by whichever of nine writers touched it last, and every
renderer that needs a value the author didn't set invents its own.

### Fear #1 — systems contradicting each other

- `zones.marker` was doing four unrelated jobs, and the two player-facing renderers each
  derived their *own* two-letter building code at draw time from `flags.building_name` —
  "Hall of Records" read `HA` on the sidebar and `HO` on the tablet while its authored `HR`
  rendered nowhere. (Fixed and shipped in `6a36f907` — both renderers now read `zones.marker`
  and draw nothing when it is unset: [minimap.js:664](../../client/game/js/panels/minimap.js),
  [tablet-os.js:3081](../../client/game/js/panels/tablet-os.js).)
- **The same defect is still live one field over.** The terrain→fill palette exists in three
  copies: [minimap.js:903](../../client/game/js/panels/minimap.js),
  [tablet-os.js:3524](../../client/game/js/panels/tablet-os.js),
  [maps.js:1026](../../client/devpanel/js/panels/maps.js). Two disagree: `redrock` is `#9e4a30`
  in the dev-panel palette *and* in [systems-terrain.md:40](../systems-terrain.md), and
  `#6f3524` in both player renderers. **2,996 tiles — 55% of the world — are painted one colour
  by the authoring tool and drawn another to the player.**
- **`flags.entrance`, the one field documented as "not inferred at runtime", is baked by two
  scripts with two different rules.** [apply.mjs:425-428](../../tools/zone-planner/apply.mjs)
  takes the first non-building neighbour, preferring south; `bake-building-entrances.mjs:23-48`
  takes the road-icon side and refuses to guess when two qualify.
- **Five derivations of a two-letter building code have existed** — two render-time and
  `suggestBuildingMarker()`, all three now removed in `6a36f907`; **two remain live** in
  `apply.mjs:345-350` and [broadcast/index.js:6504](../../plugins/broadcast/index.js), and both
  die with §5.3's single derive module.
- Four copies of the terrain inference chain ([world.js:204](../../server/engine/world.js),
  `maps.js:1109`, `zones.js:79`, `backfill-terrain.mjs:29`) — the first two handle
  `flags.pier → dock`, the third doesn't.
- Two road-connector auto-tilers ([world.js:240](../../server/engine/world.js),
  `maps.js:1124`) plus variants in [flight/state.js:671](../../plugins/flight/state.js).
- Two divergent map payloads for the same tiles ([world.js:903](../../server/engine/world.js)
  vs [movement.js:752](../../server/engine/commands/movement.js)) — the tablet never learns a
  tile is an enterable facade, so it can't draw the door affordance the sidebar draws.
- Coldwater Bay's geometry is **two hardcoded lambdas in a client renderer**
  ([minimap.js:918](../../client/game/js/panels/minimap.js)).
- **A player-facing renderer recovers world coordinates by parsing a zone id**
  ([minimap.js:928-930](../../client/game/js/panels/minimap.js), `DISTRICT_ID_RE`). See §7.

### Fear #2 — the bookkeeping costs more than it saves

| terrain | tiles | distinct `(bg_color, color)` | notes |
|---|---|---|---|
| redrock | 2,996 | 4 | 2,923 identical; the canonical minimap fill ignores all of them |
| water | 945 | 7 | the one terrain whose authored `bg_color` is read |
| scrub | 442 | 7 | 372 carry **no** colour, 61 carry redrock's |
| marsh | 101 | 1 | all 101 wear **redrock's** palette |
| ash | 44 | 1 | all 44 wear **redrock's** palette |

Across 5,439 `map_world` tiles: **86 distinct `(terrain, bg, fg, theme)` combinations, 214
distinct descriptions, 10 distinct `ambient_theme` values.** 26 MB of zone JSON expresses 86
looks. PAL-1 can't see the marsh/ash problem because there is no canonical terrain→palette
table to check against ([audit-map.mjs:250](../../.claude/skills/map-audit/scripts/audit-map.mjs)
hardcodes one stale-green case instead).

The cost lands in review: commit `9f76f9d3` ("repaint the leftover road palettes") is **1,004
files changed**; `5e00127b` is 457. A palette in one file makes it a one-line diff.

---

## 3. Principles

Eight rules. Each is tied to a fear, and the first is new — it is the rule that decides §7 and
§8 in opposite directions.

**P1. What a player is anchored to must be stable. Everything else can be regenerated freely.**

This is the sharpest line in the whole design, and it is not the same line as authored/derived.
`players.current_zone`, `anchor_zone` and `home_zone` ([schema.js:37-38, :475](../../server/models/schema.js))
anchor a player to a **zone id**, so a zone id is *live game state*: renaming one disrupts
somebody who logged out there. A **connection** anchors nobody — no player is standing on an
edge — so the build can tear connections down and rebuild them with zero player impact.

Used in §7 (zone ids must be stable ⇒ stop encoding geography in them, so they never *need* to
change) and §8 (connections anchor nobody ⇒ rebuild them every deploy). And it produces the one
correction to John's framing that this pass found: **door identity turns out to be
player-anchored after all** (§8.5), which is why connections split into a rebuildable half and
a stable half.

**P2. One authored fact has exactly one home; everything implied by it is derived.** (#1)

**P3. Derivation happens once, in one module, at build time.** Any authoring preview and any
build-time derivation must be *the same imported function*. (#1)

**P4. Derived data is never readable by game logic.** A law reads the authored substrate
(`terrain`), never the derived artifact (`icon`, a colour). (#1)

**P5. The default is free and invisible; the override is explicit and shows in the diff.** (#2)

**P6. Whole-map, always. No incremental derivation, no dirty regions, no caches.** The audit
reads 5,785 files in **1.45 s**; `content:lint` in **1.97 s**. (#2)

**P7. The authoring tool reads and writes the same bytes git ships.** (#1, #2)

**P8. The editor is generated from a schema, never hand-built per field.** 96 live flag keys
plus 18 columns, growing with every system, is not a form anyone should maintain. (#2)

---

## 4. What we have today

### 4.1 Writers

| writer | writes | fields |
|---|---|---|
| **dev panel Maps/Zones** ([maps.js](../../client/devpanel/js/panels/maps.js) 2,556 ln, [zones.js](../../client/devpanel/js/panels/zones.js) 1,280 ln) → [routes.js](../../server/api/routes.js) | **DB**, *and transitively `content/`* | terrain paint (`maps.js:1188` PUTs the whole `flags` bag), tile conjuring (`:1258`), colour brushes (`:697, :708`), exits (`:1312, :2330`), grid coords (`:2320, :2534`), facade + new building (`:1720`), move-building (`:1653`), region plan |
| **`server/api/routes.js`** — 25 `INSERT/UPDATE zones` sites | **DB** | everything above |
| **`tools/zone-planner/apply.mjs`** (739 ln) | **DB** (`:666, :692, :699, :708, :717`) | whole grids incl. `entrance`, facade+interior+utility rooms |
| **`tools/zone-planner/editor.html`** + `serve.mjs` | **`blueprints/*.bp.json`** — *not* `content/` | a palette + a 2-D cell grid |
| **~43 DB one-shots** — `backfill-terrain`, `seal-wilds-boundary`, `wire-district-exits`, … | **DB** | anything |
| **~16 content-file one-shots** — `wildlands-expand.mjs`, `build-sewer-grid.mjs`, `bake-building-entrances.mjs`, … | **`content/`** | anything |
| **hand-edited `content/zones/*.json`** | **`content/`** | anything |
| **runtime/dev-gated server code** — `environment.js:2735`, `broadcast:6504+`, `zone-validator:49`, `voidwalking:215`, `yacht` | DB / transient | a documented seam at [content-registry.js:81-94](../../server/models/content-registry.js) |
| **`content:export`** | **`content/`** | verbatim column dump minus `stains` |

**The dev panel already writes `content/` — and that makes it worse, not better.**
[content-sync.js:31-45,105-111](../../server/api/content-sync.js) mirrors every successful
dev-API write on a **local** DB into `content/<table>/<pk>.json`, byte-identical to
`content:export`. A brush stroke lands in git immediately — as a *dump of the row*. So **every
derived value the DB happens to hold gets committed as though a human authored it.** The mirror
has no way to know `bg_color: "#2a1c16"` on a redrock tile was implied rather than chosen.

That is the entanglement, precisely. It is not "the dev panel can't reach the files". There is
no representation anywhere for chosen-vs-computed, so a serialiser cannot do the right thing.

Three smaller observations:

- **`apiMoveBuilding` (`routes.js:1193`), `apiGenerateRegion` (`:1354`), `apiMoveRegion`
  (`:1418`) are pure planners** — they compute a change list and mutate nothing. That is exactly
  the shape a build step wants, and it already exists.
- **`apiCreateMap` (`:1507`) and `apiSaveMapLayout` (`:1522`) are defined but not routed** —
  dead code to delete at cutover.
- **There is no terrain-painter endpoint.** A stroke is a `PUT /zones/:id` carrying the tile's
  **entire `flags` bag** (`maps.js:1188` → `routes.js:679`). The atomic single-key alternative
  exists and is used by exactly one brush (`apiPatchZoneTag`, `routes.js:696`). The whole-bag
  write is the channel the terrain-paint-deletes-the-statue bug travelled down: the client's
  `_setTileSurface` (`maps.js:1069-1082`) decides what to delete and the server has no say. A
  painter that could only say *"set terrain=park here"* could not have deleted a statue.

### 4.2 Readers — the fields that are both gameplay and presentation

| field | presentation | game logic |
|---|---|---|
| `flags.terrain` | minimap/tablet/devpanel fill, flight tint | fishing (`fishing/index.js:163,192`), swimming/drowning (`swimming/index.js:60,123-160`), voidwalk rim (`voidwalking/index.js:118`), placement veto (`routes.js:835-847,1225`), ditching (`flight/index.js:980`) |
| **`flags.building_type`** | rooftop SVG, glyph, 3-D model | **CFIT collision mass + roof altitude** (`windshield.js:2893,2910`), shared-cell precedence (`flight/state.js:170`), placement veto, power-plant host (`environment.js:2548`) |
| **`flags.icon`** — *a filename* | the zone-icon SVG everywhere | **pathfinding road cost** (`pathfinding.js:6-8`), **movement pacing ×2** (`pacing/index.js:74`), flight surface rank (`flight/state.js:171`) |
| **`flags.floors`** | 3-D skyline height | **CFIT collision ceiling** (`windshield.js:2869-2872,2912`) |

Two are worse than dual-purpose — they are **presentation fields that quietly became laws**.
`flags.icon` is the name of an SVG file, and it decides whether the GPS routes you down a street
and whether you move at double speed.

`zones.marker` is clean by contrast: **every reader is presentation.**

### 4.3 Three claims that need correcting

**(a) The additive deploy *can* touch existing rows.** CLAUDE.md says the deploy is
`INSERT … ON CONFLICT DO NOTHING` and "can never touch existing rows". The import uses
`ON CONFLICT (pk) DO UPDATE SET … WHERE (cols) IS DISTINCT FROM (EXCLUDED)` whenever a table has
non-pk columns ([import.mjs:306-315](../../scripts/content/import.mjs)); `DO NOTHING` is only the
pk-only fallback. What it genuinely cannot touch is a row **with no file**.

**(b) We already derive at build time — manually, once, and let it rot.** `flags.entrance` is
*"baked once from the road graph … not inferred at runtime"*
([flags-keys.md:101](../flags-keys.md)) — run by hand, never re-checked, implemented twice.
`client/game/flightsim-world.json` is 365 KB of derived tiles checked into git, re-baked by a
button someone must remember to press.

**(c) The audit's BLD-4 rationale is wrong, and FLAG-4's is stale.**
[rules.md § BLD-4](../../.claude/skills/map-audit/rules.md) says `is_building` "is what groups
interior zones into one building for the power network and junction-box scope". It isn't —
**the power sim groups by `map_id`**. `is_building` appears in `environment.js` only as an
`ORDER BY` tiebreak picking a representative entry room (`:2716-2721`) and a display name
(`:2811-2814`), plus one of three indoor markers (`:735`). And **FLAG-4 states "currently no
tile in the world sets `flags.underwater`"** — 82 tiles set it today. Both need updating in
step 4's doc sweep.

---

## 5. The proposed model

### 5.1 Authored vs derived

| | authored | derived |
|---|---|---|
| **owned by** | the Studio, and only the Studio | the build (`content:import`) |
| **lives in** | `content/zones`, `content/maps`, `content/map/*`, `content/connections` | `zone_render` + `zone_edges`, generated tables |
| **in a git diff** | yes — and *only* what someone chose | never |
| **readable by game logic** | yes | **no** (P4) |

Within *authored*, fields group for the editor's benefit. These are **UI structure, not scope** —
every group is the Studio's job: Geometry, Ground, Identity, Structure, Systems, Law & Hazard,
Flight, Audio & Ambience, Feature Anchors.

A fifth class already exists and is worth naming because it proves the model generalises:
**Computed** — geometry that is a deterministic function of a seed and stored nowhere (the void
crossings, [systems-overland-void-travel.md](../systems-overland-void-travel.md)). Derived is to
build time what Computed is to run time.

### 5.2 The palette is a content file

`content/map/terrain.json` carries one entry per terrain: fill, text colour, `ambient_theme`
default, minimap class, glyph, flight biome, whether it auto-tiles. It is the **only** place a
terrain's look is written down. `TERRAIN_FILL`, `TOS_TERRAIN_FILL` and `TERRAIN_TYPES` all die.

### 5.3 `zones.marker` splits along its four jobs

| job | tiles | verdict |
|---|---|---|
| building acronym | 61 | **authored, as the override**; derived by default from `building_name` |
| apartment floor designation | 116 | **derived** — MARK-3 already computes it exactly |
| sewer corridor art (`║ ╠ ╬ ╝`) | 117 | **derived** — `build-sewer-grid.mjs:155-159` already derives these from connectivity |
| terrain glyph | ~800 | **derived** from the palette |

After the split, `marker` means one thing: *a human overrode this tile's map code*.

### 5.4 The four dual-purpose fields

- **`flags.terrain`** stays authored and stays dual-purpose. "This tile is water" is
  simultaneously a fact about the world and the reason it draws blue. Terrain is **Ground**, and
  Ground is the layer both laws and presentation may read.
- **`flags.icon`** becomes **derived only** and **stops being readable by game logic**.
  Pathfinding ([pathfinding.js:6-8](../../server/engine/pathfinding.js)) and pacing
  ([pacing/index.js:74](../../plugins/pacing/index.js)) get rewritten onto
  `isRoadTerrain(zoneTerrain(zone))`. Required by P4, and it fixes a live bug: a tile painted
  `road` with no authored icon gets no speed-up today.
- **`flags.floors`** stays **authored Ground** — a physical fact and a collision parameter. Its
  catalog `help` ("for the flight-sim skyline") must be corrected.
- **`flags.building_type`** stays authored Ground.

### 5.5 Defaults and overrides — the mechanism

Every derivable presentation property has exactly two slots:

- **the authored override**, in the file, *absent by default*
- **the resolved value**, in the generated table, always present, rewritten every build

Renderers read only the resolved slot. Authors write only the override slot. A git diff shows
only overrides. `ambient_theme` is the model case: 10 distinct values over 5,785 tiles, and
terrain does *not* fully determine it (water carries 4 themes — `city`, `coast`, `wasteland`,
`waterfront` — all legitimate). So the palette supplies the default and **579 tiles keep a real
override**, which is exactly the shape P5 asks for.

*(`ambient_theme` selects a pool of **text** ambience lines — `world.js:1150` returns
`{message, loudness}`. It is not the audio field. Per-zone **music** is `audio_theme_id`, a
different column doing a different job; see §6.1 and §16.3.)*

**`audio_theme_id` is the first concrete use of this mechanism on a game-facing field, and it
is a good worked example to spec first in step 2.** It is the clean case: the default lives at
region/district level, the override lives on the tile, the tile stores nothing when it agrees,
and *nothing is derived at all* — no palette lookup, no adjacency, no computation. It exercises
the defaults-and-overrides plumbing end to end (authored default → resolved value → Studio
showing the inherited value greyed out → typing over it writing an override) without any of
derive's complexity riding along. Get this one right and the presentation cases are the same
shape with a derivation in the middle.

### 5.6 What content lives where

| file | holds | authored by |
|---|---|---|
| `content/zones/<id>.json` | one tile: geometry, ground, identity, gameplay flags, overrides | Studio |
| `content/maps/<id>.json` | one map container | Studio |
| `content/map/terrain.json` | the terrain palette | Studio palette editor |
| `content/connections/<id>.json` | **authored** connection facts — one-ways, doors, locks (§8) | Studio |
| `zone_render` (generated) | every derived presentation value + the render spec | the build |
| `zone_edges` (generated) | the full connection graph, both directions (§8) | the build |

### 5.7 Where derived values live — settled

Separate generated tables classed `runtime` in the content registry, `TRUNCATE`d and rebuilt
inside the import transaction. Boot loads each in one `SELECT` and merges onto the in-memory
`world.zones` objects — a `boot` read tier, one extra startup query, **zero at play time**.

A `runtime` class is never exported, so generated data is **structurally** unable to enter
`content/` — the protection `furniture.origin` buys
([content-pipeline.md § Furniture provenance](../content-pipeline.md)). TRUNCATE-and-rebuild
makes idempotency free, and `zones` rows stay untouched so the drift report and the git-diff
deletion pass need no changes.

---

## 6. The field-by-field pass — making "clean" a number

John: *"If we're re-writing this thing, I want it to be **clean**."* Clean should be measurable,
so here is the whole surface with a verdict each.

**Today: 18 columns + 96 distinct `flags` keys = 114 authored field types, and 67,782 authored
field-instances** across 5,785 zone files (counting every non-empty flag key and every non-empty
non-geometry column).

### 6.1 Verdicts

**PROVENANCE-DELETE — build residue that should never ship. 15,653 instances.**

| field | instances | evidence |
|---|---|---|
| `flags.planner` | **5,312 (92%)** | the blueprint id that generated the tile. [land-taxonomy.md:74-80](../reference/land-taxonomy.md) already says *"nothing reads it in the game loop"* |
| `created_by` (column) | 4,556 | values are tool names — `wildlands-expand` ×3,102, `zone-planner` ×877, `sewer-grid` ×85, `tenement-gen` ×72 — plus 7 rows carrying a raw player UUID |
| `updated_at` (column) | 5,785 | runtime residue; only **110 distinct values** across the tree because scripts pin it to avoid diff churn — which is the tell that it isn't authored |

`planner` and `created_by` overlap on 4,280 tiles: **two provenance fields, neither a superset
of the other.** Provenance belongs in git history, which records it better than either.

**DERIVED — computable from other authored facts. 11,995 instances.**

| field | instances | derivation | confidence |
|---|---|---|---|
| `flags.underwater` | 82 | `grid_z < 0 AND terrain = 'water'` | **exact** — the predicate matches **82 of 82**, no false positives, no misses |
| `flags.world_exit_zone` | 191 | see below | **187/191**, and 3 of the 4 exceptions are bugs |
| `flags.is_building` | 149 | split, then derived — see below | high |
| `flags.is_interior` | 384 | split, then derived — see below | high |
| `flags.icon` | 108 | already derived at runtime by `tileIconSvg()` for the common cases | exact |
| `marker` (non-building) | 1,081 | §5.3 | high |
| `bg_color` | 4,768 of 5,286 | terrain palette; 1,017 survive as overrides | measured |
| `color` | 4,691 of 5,089 | terrain palette; 1,094 survive | measured |
| `ambient_theme` | 5,206 of 5,778 | terrain palette; 579 survive | measured |

**`world_exit_zone` is overloaded and both halves derive.** On a **facade** (61 tiles) it equals
`exits[entrance]` — the street you spill onto — and it matches **61 of 61, exactly**. On an
**interior room** (130 tiles) it equals `maps.parent_zone_id` — the facade itself — matching
**126 of 130**. Same key, two different targets. The four exceptions are instructive: one is
`zone_echelon_suite_boudoir` (no `map_id` at all), and **three are `zone_util_*` rooms pointing
at the wrong street** — `zone_util_zone_meltwater_diner` sits under a facade at `906_910` but
declares its exit at `908_910`. The derivation doesn't just replace the field, **it fixes three
live defects nothing currently reports.**

**`is_building` is doing two jobs.** 149 tiles: 61 carry `facade`, 100 carry `building_type`,
and **49 carry neither — every one an interior room on a `map_int_*` map** (`zone_asc_clinic_consult`,
`zone_asc_shrine_nave`, the Ascendant set). So the flag means *"this tile IS a building"* on a
facade and *"this room BELONGS TO a building"* on an interior. Split it:

- facade identity ⇒ derive from `facade` / `building_type` (all 61 facade tiles already carry
  `is_building`, so nothing is lost)
- building membership ⇒ derive from `map_id` → `maps.parent_zone_id`

**And this is safe, because the power network does not key on it** (§4.3c): it groups by
`map_id` already. Also surfaced by the same census: **8 tiles carry `building_type` without
`is_building`** — all Halcyon interiors — which is a BLD-4 defect the audit misses because it
only walks `map_world`.

**`is_interior` is also two jobs, and is wrong in both directions today.** 384 tiles carry it;
**346 zones are off `map_world`; 120 of the flagged tiles are ON `map_world`** (the z<0 sewers);
and **82 off-world zones lack it entirely** — 60 Yards Tenement units, 13 MQ Chrome, 7
residential-lobby rooms, 1 Meridian. So the flag is ~30% wrong in each direction. Two concepts:

- *"room inside a building"* ⇒ `map_id !== 'map_world'` — exact, free
- *"enclosed / underground"* ⇒ `grid_z < 0` on `map_world`, or an authored `enclosed` flag for
  the handful that are neither

**OVERLOADED-SPLIT — one key, several meanings.** `marker` (§5.3), `world_exit_zone`,
`is_building`, `is_interior`, `flags.district` (§7.4). All resolve to derivations above except
`district`, which becomes **required authored** once ids go opaque.

**AUTHORED — stays, unchanged.** Everything else: `terrain`, `region_id`, `radiation`, `lawless`,
`building_name`, `building_type`, `floors`, `facade`, `entrance`, `street_life`, `artery`, the
loot-table refs, the flight set, the feature anchors (§9.4), `name`, `description`, `exits`
(re-homed by §8), `map_id`, `grid_*`, `parent_zone`, `ambient_events`.

**DEMOTE — `audio_theme_id`. Decided (§16.3).** A real column with a real FK
([schema.js:1345](../../server/models/schema.js)), **set on 0 of 5,785 zones**. It is *not* dead
code — the mechanism works ([audio/index.js:187-192, :245](../../plugins/audio/index.js)); it is
the **per-tile shape** that is wrong. A column NULL 5,785 times to express something that varies
by *area* moves to a **region/district-level default with a per-tile override** (§5.5), costing
~10 authored values. It leaves the per-tile surface entirely.

### 6.2 The number

| | before | after | change |
|---|---|---|---|
| authored field-instances | **67,782** | **~35,469** | **−32,313 (−48%)** |
| authored field *types* (cols + flag keys) | 114 | ~105 | −9 |
| region/district-level fields | 0 | 1 (`audio_theme_id`, ~10 values) | +1 |
| `content/zones` bytes | 26 MB | ~14 MB (est.) | ~−45% |
| files touched by a terrain repaint | 1,004 (`9f76f9d3`) | 1 | |

**Be honest about which number matters.** The field *type* count barely moves — 8 keys retire —
because the long tail of ~60 rare feature-anchor keys stays deliberately (§9.4). The win is
**48% of the authored values in the tree disappearing**, and with them the entire class of
"someone hand-set a value that should have been implied".

**One clarification on `audio_theme_id`, because it is easy to over-credit.** Demoting it to a
regional default removes a *field type* and a dead box from every tile's editor, but it removes
**zero instances** from the 67,782 — the column is NULL on all 5,785 tiles, and the count above
only ever counted non-empty values. The bloat it represented was schema surface and UI surface,
not stored data. Worth doing, worth not double-counting.

Not counted, and available later if wanted: **214 distinct descriptions across 5,439 tiles**
means terrain-default prose could retire several thousand more instances. That is a design
decision about voice, not a derivation, so it is left out of the number.

---

## 7. Zone ids stop encoding geography

John: *"I want to get away from zone ids being keyed to geographical locations… I'm worried
about the impact to the live game — if a player logged out on a tile that just changed ID, their
experience is disrupted."*

This is **P1** exactly. A zone id is player-anchored, therefore it must be stable, therefore it
must not encode anything that changes when the map is edited.

### 7.1 Scale

| pattern | count | share |
|---|---|---|
| `zone_district_<x>_<y>` | 4,836 | 83.6% |
| `zone_under_<x>_<y>` | 85 | 1.5% |
| `zone_bld_<x>_<y>_*` | 14 | 0.2% |
| **strict coordinate ids** | **4,935** | **85.3%** |
| other ids embedding a `<n>_<n>` pair | 550 | 9.5% — `zone_the_reach_<x>_<y>` ×400, `zone_district_<x>_<y>_z-<n>` ×82, `zone_yards_tenement_u<f>_<n>` ×60 |
| **any coordinate-bearing id** | **5,485** | **94.8%** |
| genuinely named | 300 | 5.2% |

*(A figure handed to this pass said 4,918 `zone_district_*` and 87% overall; the tree says 4,836
and 94.8% counting the looser forms. The named remainder is 300, not 763.)*

### 7.2 Blast radius — every column holding a zone id

**Player-anchoring (P1 — these are why ids must be stable):**
`players.current_zone` ([schema.js:37](../../server/models/schema.js)), `players.anchor_zone`
(`:38`), `players.home_zone` (`:475`), `aircraft.parked_zone_id` (`:1745`),
`apartments.zone_id`, jail `cell_zone`/`release_zone` (`:1575-1576`), corp `org_assets.zone_id`
(`:1538`) and `org_territory` (`:1554`), `player_corpses.zone_id`.

**Content-internal:** `zones.parent_zone` (`:115`), `maps.parent_zone_id`/`entry_zone_id`
(`:83-84`), `doors.zone_id`/`target_zone` (`:349, :372`), `zone_spawns.zone_id` (`:167`),
`npcs.home_zone`/`studio_zone_id`/`work_zone_id` (`:186-189`), `media_cameras.zone_id` (`:1104`),
`media_channels.studio_zone_id` (`:1145`), `security_devices.zone_id` (`:1277`),
`power_zones.zone_id` (`:1519`), `scavenging` zone links (`:1436-1445`), `generators.zone_id`,
`world_events.zone_id`, `zone_exit_overrides.zone_id` (`:1925`), plus every `exits` value in
every zone file.

**Thirty-plus columns.** Any rename must move all of them atomically.

### 7.3 The two code paths that must die — and four more

- **Minting from coordinates:** `_districtTileId()`
  ([maps.js:1272-1277, :1441](../../client/devpanel/js/panels/maps.js)),
  `routes.js:854` (`zone_district_${slug}`), `wildlands-expand.mjs:91,107,123`,
  `wildlands-curtain.mjs:20`.
- **Parsing coordinates out:** `diagnose-prod-exits.mjs:17`, `seal-wilds-boundary.mjs:28`, and —
  the serious one — **`minimap.js:928-930`**, where `DISTRICT_ID_RE` recovers absolute world
  coordinates from the id so the tablet map can place a tile. **A player-facing renderer depends
  on the id encoding geography.**
- **Parsing the id *prefix*:** `districts.js:278` and `zones.js:37` take
  `id.match(/^zone_([a-z0-9]+)/)` — see §7.4, which is the sharpest consequence of this change
  and was not on the original list.

### 7.4 The consequence nobody has flagged: districts are keyed off the id

`districtFor()` ([districts.js:273-281](../../server/engine/districts.js)) resolves a tile's
land-use district as: explicit `flags.district` override → **id prefix via `DISTRICT_PREFIX`**
→ lethal fallback → `residential`. So the zone id is not merely a key; **it is the default SSOT
input for district identity**, which drives district ambience, the district named on `look`, the
minimap colour and the regional map.

Making ids opaque destroys that default. The fix is mandatory and should be part of the same
change: **`flags.district` becomes required authored on every tile, `DISTRICT_PREFIX` is
deleted, and `districtFor()` reads the flag or the lethal fallback.** 4,484 tiles already carry
the flag; the build can backfill the remaining ~1,300 from today's prefix resolution *before*
the ids change, so the result is provably identical. Note [land-taxonomy.md:98](../reference/land-taxonomy.md)
already warns *"those are opaque ids… don't parse them"* — `districtFor` is the one sanctioned
violation, and this change makes the doc true.

### 7.5 The id scheme

**Recommendation: a slug of the tile's *name at creation*, disambiguated with a short random
suffix — `zone_ochre_draw_k3f9`.** Not a pure ULID, not a pure name-slug.

| scheme | collision-free | stable under rename | readable in `ls content/zones` | sorts usefully |
|---|---|---|---|---|
| coordinates (today) | yes | **no** — the whole problem | yes | by position |
| ULID / nanoid | yes | yes | **no** | by creation time |
| pure name-slug | **no** (566 distinct names over 5,439 tiles) | **no** (renames tempt re-slugging) | yes | alphabetical |
| **name-slug + random suffix** | yes | **yes** (the slug is frozen at creation and never re-derived) | yes | alphabetical by area |

The suffix does the collision work so the slug never has to be re-derived — which is the whole
point, because *re-deriving is what makes an id unstable*. `zone_ochre_draw_k3f9` stays that
forever even if the tile is renamed to "Ferric Wash"; the *name* is a field, the id is a label.

**What is lost, honestly.** `zone_district_920_911` is greppable and self-locating, and because
content filenames *are* the id, `content/zones/` currently reads as a coordinate atlas. Losing
that is a real cost against "easy to manage". Three mitigations, all recommended together:

1. **Coordinates become a first-class Studio search axis.** "Go to 920,911" and "what is at
   920,911" are tool features, not grep invocations. This is strictly better than grep — it
   works for interiors, which have coordinates but no coordinate ids.
2. **A generated index** — `content/map/index.json`, written by the build, mapping
   `map_id:x,y,z → zone id` and back. Greppable, diffable, and it is derived so it never rots.
3. **Sharded directories with human-readable segments** — `content/zones/map_world/ochre_draw/
   zone_ochre_draw_k3f9.json`. Deferred (see §15.3) because the deletion pass parses the table
   name out of `path.split('/')[1]` ([import.mjs:255](../../scripts/content/import.mjs)).

### 7.6 The migration — nobody points at a dead id

This is the hard part and it is exactly John's concern. 4,935+ renames while players are
anchored to those ids, including players logged out across the deploy.

**Recommendation: an alias table plus resolve-on-read, cut over in three deploys.**

- **Add `zone_aliases (old_id PRIMARY KEY, new_id)`** — content-classed, generated by the rename
  pass, shipped like any other content.
- **Deploy 1 — aliases exist, nothing renamed.** Add the table and a `resolveZoneId()` in
  `world.js` that returns `world.zones.get(id) ?? world.zones.get(aliasOf(id))`. Route every
  player-anchoring read through it: login landing, `anchor_zone`, `home_zone`, aircraft parking,
  jail release, corpse recovery. Ship and verify it is a no-op.
- **Deploy 2 — the rename.** One transaction: rewrite `zones.id` and every one of the 30+
  referencing columns, populate `zone_aliases` with all 4,935 old→new pairs. **Player rows are
  rewritten in the same transaction** — `current_zone`, `anchor_zone`, `home_zone`,
  `parked_zone_id`, jail and corp columns — so a logged-in player's id is updated under them and
  a logged-out player's row is already correct on next login. The alias table is the safety net
  for anything missed, not the primary mechanism.
- **Deploy 3 — verification, then a long soak.** `content:dangling` (which already exists for
  exactly this class of player→content orphan) runs strict against prod. Keep the alias table
  indefinitely: it is 4,935 rows, it costs nothing, and it makes any future rename cheap.

**Two things must be true before deploy 2**, and both are checkable:
`content:dangling --strict` must be clean, and a full `content:import` into a throwaway Postgres
built from the renamed tree must regress green. Both already run in CI.

**The one residual risk:** a player whose client is mid-session holds the old id in memory. The
Render restart at the end of every deploy already disconnects everyone, so this is bounded to
the reconnect, which resolves through `resolveZoneId()`. Worth stating rather than assuming.

---

## 8. Connections as their own table

**Decided: build it now.** John: *"connectors don't affect the player, so they can be fully
re-built on runtime without affecting the world… in the future it allows us to do more
interesting things (like making doors that only lock from one direction)."*

### 8.1 The case, measured

`zones.exits` is JSONB per-tile ([schema.js:65](../../server/models/schema.js)), so every
connection is stored twice with nothing enforcing agreement:

- **21,201 directed exit edges** across the tree. 21,136 are reciprocated pairs; 65 are one-way.
- **~10,568 undirected connections, each stored twice — 99.7% duplication.**
- Only **2** exits in the entire world use the polymorphic array form that
  [`exits.js`](../../server/engine/exits.js) exists to normalise.

**Five audit rules are symptoms of one cause**: EXIT-3 (the halves disagree about whether the
edge exists), EXIT-1 and EXIT-2 (one half points somewhere the other doesn't), LINK-2, and BLD-1
— the walk-through-wall bug, which is precisely *"an inbound edge the building never declared"*.

`doors` is worse. It carries `zone_id` + `exit_dir` ([schema.js:347-357](../../server/models/schema.js)),
**one arbitrarily-chosen side**, so every consumer must try both by hand:

```
getDoorForExit(a, dir, b) || getDoorForExit(b, OPPOSITE[dir], a)
```

That appears at [movement.js:397](../../server/engine/commands/movement.js), `movement.js:333-334`,
[doors.js:49](../../server/engine/commands/doors.js), and **six times** in `ai-behaviour.js`
(`:337, :358, :436, :455, :489`). `getDoorForExit` itself
([world.js:529-537](../../server/engine/world.js)) only matches the near side.

**Two readers forgot.** [describe.js:381](../../server/engine/commands/describe.js) and
`describe.js:766` call `getDoorForExit(zone.id, p.direction)` with **no far-side fallback**. So a
door authored on the far half of an edge is not listed in the room description — while
`movement.js:397` still blocks you when you walk into it. **A door you cannot see but cannot walk
through.** Of the 173 doors in `content/doors/` (prod carries 198 — the difference is
runtime-installed locks never exported), 166 are closed and **57 have no twin on the far side**; every Embassy
apartment door is one, so `zone_embassy_floor_2nd` describes plain exits where there are locks.

### 8.2 One-way travel is first-class

John is explicit that one-ways exist and must work. All 65 in the tree today, classified:

| class | count | example | verdict |
|---|---|---|---|
| vertical (elevator / stair) | 46 | `zone_halcyon_elevator -up-> zone_halcyon_concourse` (45 floors, no down mirror) | **declared** — an elevator car is one-way by nature |
| `in`/`out` interior seam | 11 | `zone_asc_spire_concourse -in-> zone_asc_spire_gallery` | **declared** |
| facade forwarding | 4 | `zone_district_920_910 -east-> zone_fence_interior` | **declared** — the revolving-door seam |
| cardinal one-way | 4 | `zone_the_broadcast -north-> zone_the_collapse`, `zone_the_collapse -north-> zone_start` | **declared** — the prologue chain; you cannot walk back into the intro |
| accidental (a forgotten mirror) | **0** | — | — |

Every one-way in the world today is deliberate. That is the strongest possible argument for
making direction an explicit authored property rather than an absence: the data says authors
*mean* it, and today they have no way to say so.

So the model carries **`direction: 'both' | 'a→b' | 'b→a'` per connection**, and **EXIT-3
survives in a better form**: it stops meaning "the halves disagree" (impossible) and starts
meaning "**this connection is one-way and nobody declared it**" — which, on today's data, would
be zero findings and would stay zero unless someone drew a link and skipped the declaration.

### 8.3 The split — and it is not the split John proposed

**P1 forces a refinement.** John's reasoning was *"connectors don't affect the player, so they
can be fully re-built"*. That is true of connection **geometry**. It is true of connection
**fixtures** only because of a seam that is live in code and has never fired:

**Installing a keycard lock mints an item whose id contains the door id, and puts it in a
player's pocket.** [doors.js:586-603](../../server/engine/commands/doors.js): `keycardId =
\`keycard_${door.id}\``, inserted into `items`, set as `lockData.keyItemId`, then inserted into
`player_inventory`. It is a documented runtime-insert seam
([content-registry.js:94](../../server/models/content-registry.js)), and `player_inventory` has
**no FK** by design — so a rebuilt door id would orphan the key silently, with no error and no
log line. `apiCreateKeycard` ([routes.js:3165](../../server/api/routes.js)) mints the same id
shape.

**A prod census settles the exposure — and it is zero.** (`scripts/keycard-census.mjs`,
read-only, re-runnable before cutover):

| measure | prod |
|---|---|
| `keycard_*` items in the catalog | **0** |
| held by any player | **0** |
| already orphaned (door gone) | **0** |
| doors naming a key item | **1** — `door_voltage_vip` (`zone_voltage_floor`, north) → `lock:keycardlock` → `item_voltage_vip_band`, an **authored** item, not a minted one |
| scale | 198 doors, 9 players, 333 inventory rows |

So the premise *"door ids are player-anchored"* is **true in code and false in current data**.
That changes the justification but not the conclusion: the split below is right because it
**removes a latent hazard** — the seam is live and could fire tomorrow — not because it rescues
existing player property. There is none to rescue, and **migration input is nothing**: no access
lists to seed, no keys to repoint, no reconciliation pass.

*(198 doors in prod vs 173 files in `content/doors/` — the difference is runtime-installed locks
that were never exported. Use 198 for any prod-facing count.)*

Hence:

| | `zone_edges` — **generated, rebuildable** | `content/connections/*.json` — **authored, stable** |
|---|---|---|
| holds | every connection, both directions, projected from authored geometry | only connections with something *said* about them |
| id | none needed — keyed `(zone_a, zone_b, dir)` | stable authored id, never regenerated |
| rebuilt each deploy | **yes**, `TRUNCATE` + rebuild | never |
| contents | adjacency, reciprocity, the exits-shaped view | one-way declaration, door + lock + hp + name, keycard binding |
| how many today | ~10,633 | ~238 (65 one-ways + 173 doors) |

This gives John exactly what he asked for — connectors invisible and freely rebuilt — while
keeping the ~2% of connections that carry an authored fact. The ratio is the argument:
**98% of connections are pure geometry with nothing to say about them.**

### 8.4 Locks — decided

**The auto-minted `keycard_<door.id>` item is deleted as a mechanism.** It is simultaneously
the thing that manufactures stray items and the thing that anchors a door id to a pocket.
Removing it is what makes fixture ids safely rebuildable, and the census above says it costs
nothing to remove. It is replaced by a three-part model.

**1 — `lockable: true`, authored, in git, on the connection.** The layout declares that a lock
*can* be installed here. A socket, nothing more. This is the **only** lock-related thing in
`content/connections/`, which keeps the authored tree free of live security state.

**2 — the installed lock, runtime, DB only, never exported.** Classed `runtime` in the content
registry, keyed by the **authored connection id** — so a `zone_edges` TRUNCATE-and-rebuild
cannot touch it, by construction rather than by care.

**3 — a typed-principal access list, per side.**

```
{ connection: <authored id>,
  side_a: { open, locked, hp, access: [ … ] },   // approaching from a
  side_b: { open, locked, hp, access: [ … ] } }  // approaching from b

access: [ "player:p_cyd", "corp:corp_voltage", "org:ascendant", "item:item_voltage_vip_band" ]
```

- **`player:`** — a specific person.
- **`corp:` / `org:`** — one entry covers the whole roster. A corp HQ is *one* line, not thirty,
  and **roster churn never touches the lock** — the thing that makes the naive
  "list of player ids" design rot.
- **`item:`** — preserves the bearer-key pattern: stealable, sellable, losable. This is what
  keeps `door_voltage_vip` working **unchanged**, and it is why deleting the keycard *minter*
  costs no capability — the pattern survives, only the auto-generated item goes.

Per-side access lists mean **one-way locks fall out with no extra machinery**: a door that
opens freely from inside and needs credentials from outside is an empty `access` on one side.

**Storage.** The access list is a JSON array on the lock row, following the pattern already in
use: lock config lives as JSON in `doors.tags[tagType]`
([doors.js:611-612](../../server/engine/commands/doors.js)) and `loadDoors()`
([world.js:516-525](../../server/engine/world.js)) pulls every door into `world.doors` once at
boot. So the open-check is an in-memory array test, and grant/revoke is one `UPDATE` plus
`setDoorCache()` — the same write funnel the boot-loaded Map already requires.

**`getDoorForEdge(from, to)`** returns the fixture **plus the side you are approaching from**,
in one call. The both-sides dance disappears from nine call sites, and **the 57-orphan bug is
not expressible** — one fixture per connection, so there is no far side to forget.

#### 8.4.1 The hot-path check — and it comes out ahead

The risk in a typed-principal list is that resolving a principal costs a query on every door
open, which is a per-move path. Verified, principal by principal:

| principal | resolves via | queries |
|---|---|---|
| `player:` | array test against `player.id` | **0** |
| `corp:` | `getPlayerMembership()` → `world.orgMembers`, a boot-loaded Map with a `reloadOrg()` write funnel ([world.js:657-700](../../server/engine/world.js)) | **0** |
| `org:` *(membership)* | same Map — NPC ideologies are `orgs` rows with `is_npc=1` | **0** |
| `org:` *(standing/reputation)* | `player_ideology_rep` — **query fresh**, no cache ([ideologies.js:98,118,148,159](../../server/engine/ideologies.js)) | **1** |
| `item:` | `player_inventory` — **query fresh**, no cache | **1** |

**Two principals cost a query, and both cost exactly one query today.** The two shipped lock
types they replace already do this: `keycardlock`'s `authFn` runs
`SELECT 1 FROM player_inventory …` ([doors/index.js:53-60](../../plugins/doors/index.js)) and
`longwatch`'s runs `SELECT reputation FROM player_ideology_rep …` (`:81-88`). **So the design is
neutral-to-better on the hot path, not a regression** — it converts the two cheap principals
from a query into a memory test and leaves the other two where they are.

**The lever is check ordering, not caching.** Evaluate `player:` and `corp:`/`org:`-membership
first and short-circuit; the query fires only when those miss *and* the list contains an
`item:` or reputation entry. Since most locks will be `player:` + `corp:` only, the common case
becomes zero queries where today it is one.

**Do not cache `player_inventory` to fix the rest.** It fails the cache-safety test in
[architecture.md](../architecture.md#read-tiers-where-data-lives-at-runtime) — writers are
scattered across the whole codebase, and a stale inventory cache is strictly worse than a round
trip. If the reputation read ever becomes hot, the right fix is a boot cache **for
`player_ideology_rep` specifically**, which has a small, funnel-able writer set
(`ideologies.js` owns all four sites).

#### 8.4.2 Two costs to record now, so nobody rediscovers them

**The reverse query gets worse.** *"Which doors can this player open?"* becomes a scan over all
locks instead of an indexed lookup. At **198 doors held in memory** that is a filter over a few
hundred entries — not a problem, and nothing in the game asks it on a hot path today. It stops
being fine somewhere around **10⁴ locks**, and the fix at that point is a **boot-built reverse
index** (`principal → Set<connection id>`, rebuilt by the same funnel that writes the lock) —
an in-memory structure, not a schema change. Recording it here so it is a known ceiling rather
than a surprise.

**The access list is denormalized, so it has no FK.** A deleted player leaves a dead
`player:p_x` entry that simply never matches again. Harmless, accretes slowly, and cheap to
sweep — the same shape as the orphans `content:dangling` already reports. Worth a periodic
sweep, not a constraint.

### 8.5 Runtime shape unchanged

The in-memory world still presents an exits-shaped view, so **no hot path gains a query** — this
satisfies the read tiers in [architecture.md](../architecture.md) by construction. Three things
carry it:

- **`exits.js` already mediates most reads** (`exitTargets`, `allExits`, `neighborZoneIds`,
  `primaryExits`). Raw `zone.exits[...]` indexing survives in only **18 sites across 4 files**
  (`exits.js`, `world.js`, `plugins/voidwalking`, one `models/temp` script).
- **The merge-at-load mechanism exists.** `zone_exit_overrides` is already loaded separately and
  merged onto the in-memory zone objects at boot
  ([world.js:321-334](../../server/engine/world.js)). `zone_edges` uses the identical path.
- **`zone_exit_overrides` is unchanged** — runtime wiring layered over generated edges instead of
  authored `exits`. Its one-sidedness is *correct* there: a generator's utility-room link
  genuinely is a one-way runtime addition.

The real cost is on the write side: **32 sites write `exits`** (`SET exits=` / `exits = $`) plus
19 `addExit`/`removeExit`/`addExitOverride` calls. Every authoring writer moves to a connection
API. Most of them die anyway with the dev-panel map editor and `apply.mjs`.

### 8.6 Invisible by default

Per John: connector bookkeeping is hidden. In the Studio, drawing contiguous ground creates
connections with no file and no diff. A file appears **only** when you say something: mark a
drop one-way, hang a door, set a lock. That is P5 applied to geometry — and it means
`content/connections/` starts at ~238 files, not 10,633.

---

## 9. The schema: how the Studio knows what a tile has

### 9.1 The flag catalog already exists and is in good shape

[`client/shared/tagCatalog.js`](../../client/shared/tagCatalog.js) carries **200 entries, 104
`scope: 'zone'`**. Verified by loading it:

- **Every zone entry has `label`, `shape`, `group` and `help`. Zero omissions.**
- Shapes: `flag`×63, `text`×27, `enum`×4, `number`×4, `list`×4, `int`×2. All four enums carry
  `options`.
- Nine groups: Structure (24), Flight (18), Law & Hazard (13), Echelon (12), Identity (10),
  Systems (9), Ascendant (8), Perimeter (5), Aircraft (5).
- **Node imports it cleanly** — a dual-mode IIFE assigning `globalThis.TAG_CATALOG`
  (`tagCatalog.js:10-13`), so `await import('./client/shared/tagCatalog.js')` works from a Node
  tool with no shim. Verified.
- Already **enforced**: `zoneFlagsError()` ([routes.js:636](../../server/api/routes.js))
  validates every zone save through `validateTags` and rejects uncatalogued keys.

**The Studio renders its flag editor entirely from the catalog.** A new system's flag becomes
editable with **zero tool changes** — one catalog entry and it appears, grouped, labelled, with
help text and the right widget. This is P8.

Four gaps to close in step 2:

1. **Stale shape docs.** `tagCatalog.js:18-25` lists `text/flag/int/enum/range/hot/statmap`;
   zone entries use `number` and `list`, which are undocumented. Fix the comment; collapse
   `int`/`number`.
2. **No `ref` shape.** `scavenging_table_id`, `fishing_table_id`, `world_exit_zone`,
   `hangar_interior_zone`, `region_id` are typed `text` but are *references*. A
   `shape: 'ref', refTable: 'scavenging_tables'` gives the Studio a picker and gives lint a
   resolution check. **The highest-value single addition.**
3. **Structured values typed as prose.** `checkpoint_cfg` is a JSON object declared
   `shape: 'text'`; `elevator_floors` is a `list` of objects. ~5 keys need a real shape or they
   stay a textarea you can typo into.
4. **No ordering within a group.** Cosmetic; add `order`.

### 9.2 The gap: columns have no catalog

`ambient_theme`, `audio_theme_id` and `ambient_events` are **columns**, not flags —
`audio_theme_id` is not in the catalog at all. So are `name`, `description`, `color`,
`bg_color`, `marker`, `parent_zone`, `map_id`, `grid_x/y/z`. A Studio driven purely by the
catalog would silently have no audio editor.

**Option 1 — extend the catalog with `scope: 'zone_column'`.** One registry, one loader, one
vocabulary; flags and columns render through the same code path. *Con:* a file called
`tagCatalog` describing non-tags — a rename to `fieldCatalog.js` is honest but touches every
importer.

**Option 2 — a separate `zoneColumnSchema.js`.** Cleaner naming, two registries to merge and two
places to forget. Rejected: two schemas describing one entity is fear #1 in miniature.

**Option 3 — derive from `content-registry.js` + `SCHEMA_SQL` types.** Types can't drift, but
SQL carries no label, help, grouping or enum options. Useful for *validation* under either option
above; never for the UI.

**Recommendation: Option 1**, rename deferred to step 4. `validateTags` gains a column-scope
sibling so the whole tile is validated by one mechanism instead of half of it.

### 9.3 Reconciliation — and it should be a gate

- **96 distinct `flags` keys across 5,785 zone files.**
- **104 zone-scope catalog entries.**
- **Zero uncatalogued keys in content** — the `zoneFlagsError()` gate is working, and the
  content-file one-shots have stayed inside it.
- **Eight catalogued-but-unused keys**: `airspace_restricted`, `claimable`, `gov_checkpoint`,
  `gov_enclave`, `heading`, `vessel`, `water`, `water_temp_c`. `water` is the legacy marker
  [systems-terrain.md:16-20](../systems-terrain.md) says is on no zone — confirmed.

**Yes, make it a lint and a deploy gate.** `content:lint` needs no DB and runs in 1.97 s, and it
closes the one hole the HTTP validator can't see: a key introduced by a hand edit or a
content-file script bypasses `zoneFlagsError()` entirely.

- **uncatalogued key in content → error.** Today's zero becomes enforced rather than lucky.
- **catalogued key on no tile → warning.** Eight today; dead entries are how a UI grows fields
  nothing reads.

### 9.4 The one-off feature anchors — a position

~60 of the 96 keys appear on ≤6 tiles: `airfield_*` (11), `echelon_*` (8), `hangar_*` (4),
`ascendant_*` (4), `aa_*` (3), plus singletons like `checkpoint_cfg`, `gate_warning`, `greeter`,
`perimeter_gate`.

**Position: leave them as flags. Do not build a feature-anchor table.**

1. **They genuinely are properties of the tile.** `echelon_bridge` means *this room is the
   bridge*; `perimeter_gate` means *this tile is the hole in the Curtain*. A
   `feature_anchors(feature, zone_id)` table converts a one-word local fact into a join.
2. **The cost of a flag is already zero.** One catalog entry, one JSONB key. No schema change,
   no migration, no FK. That is *why* the tail is 60 keys long — the length is the system
   working, not failing.
3. **The alternative reintroduces the coupling this proposal removes.** A second place a tile's
   identity lives, owned by a different system, edited in a different tool.

The tail is an argument for **generating the UI**, not for restructuring the data. The one
qualifier: the ~5 structured-config keys need a real shape (§9.1 gap 3).

---

## 10. The tool

### 10.1 John's claim about the dev panel

*"The devpanel reads the DB, not the JSON, so it'll be impossible to detangle"* — **correct, but
for a narrower reason than stated.**

It is not intrinsically DB-coupled and it already reaches the files. The map-audit script proves
reading `content/` is cheap — 5,439 tiles, 38 rules, **1.45 s**, no server boot
([SKILL.md](../../.claude/skills/map-audit/SKILL.md)) — and
[content-sync.js](../../server/api/content-sync.js) proves the panel can write them. Access is
not the problem. content-sync writes a **dump**, so the panel cannot express an
authored-vs-derived distinction even though it reaches the right file. Fixing that means a
second, semantic write path for zones — most of a new tool, built inside a 2,556-line file whose
other half is a live-DB ops console.

### 10.2 The Map Studio

A standalone tool reading and writing `content/` directly, served locally the way
`tools/zone-planner/serve.mjs` already is, importing the *same* derive module the build uses so
the preview is the ship.

It owns **all authored per-tile data** and replaces: the dev-panel Maps panel entirely (terrain
painter, brushes, paint-into-existence, Move Building, New Building, region planner), the Zones
panel's per-zone flag/column editing, and `tools/zone-planner/` entirely.

### 10.3 What stays in the dev panel, and what it costs to leave

**Stays** (all live-DB, none of it authored tile data): player admin, weather and power ops, live
spawns, ATM cash, gametables, the crime log, live overlays, the whole prod ops console. Its map
view becomes **read-only for geometry** and should say so on screen.

| lost | mitigation | residual |
|---|---|---|
| live `reloadZone` / instant preview | Studio POSTs a reload to a running local server after writing (dev-only, one-way) | small |
| ~~**cross-table wiring on building placement**~~ | **nothing is lost — it was never atomic, and the panel cannot ship a building at all today (§16.1)** | **none; this row is a benefit** |
| staging/publish review | the git diff *is* the review, and it is better | none |

**~~Fallback if the spike prices badly~~ — withdrawn.** The spike came back the other way
(§16.1): `apiBuildBuilding` has no transaction, half its writes are runtime or derived rather
than authored, and `POST /maps/build-building` syncs **zero** content files. A content-mode data
layer inside the dev panel would have been insurance against a cost that does not exist, and it
would have left two writers of the same fields — the exact thing fear #1 names. Recorded and
rejected.

### 10.4 References to other entities

`scavenging_table_id` (1,330 tiles), `fishing_table_id` (8), `mining_table_id` (4),
`audio_theme_id`, `hangar_interior_zone` (4), `region_id` (5,237).

**The Studio picks from a list of existing ids read from `content/`.** It has the tree in memory
already. With the `ref` shape (§9.1) this is one generic picker, and lint gets to check the
reference resolves — closing SCAV-2 as a deploy gate.

**Creating a new loot table or audio theme does not happen in the Studio** — those stay in the
dev panel / design-cli. The Studio's job ends at *"this tile points at that table"*. When a
reference doesn't resolve it says so inline rather than silently accepting a dead string.

**The rule: the Studio edits tiles and the connections between them. It does not create entities
that merely happen to be referenced by tiles.**

### 10.5 `suggestBuildingMarker()`

**Shipped as `6a36f907` ("the marker is authored or it is nothing").** Both render-time
derivations are gone, the authoring-time stamp was stripped, and facade conversion is back to
`marker=NULL` ([routes.js:847](../../server/api/routes.js)). So today `marker` is purely
authored, nothing invents one, and a building without one draws blank — a visible, auditable gap
instead of two screens quietly disagreeing. All 61 world buildings carry one, so nothing is blank
in practice.

That is the correct interim state and the right base to build on. Under the redesign the
*function* moves into the shared derive module, imported by both the build and the Studio. The
build then derives a code for every building, always, into `zone_render`; the Studio shows it
**greyed out as a preview** and typing over it writes an override into the file. Because the
build sees all 61 codes at once it disambiguates derived codes deterministically and **fails the
build** on colliding *authored* ones.

---

## 11. Making warping legible

John: *"It's really hard right now to follow how a player may 'warp around' the map."*

Every connection that is **not a step to a grid-adjacent neighbour** is invisible in every
current view. Concretely, in the tree today: **4 facade-forwarding seams** (a facade is
non-standable and forwards on arrival, so the player crosses two tiles in one move), **46
vertical links** including the Halcyon elevator's 45 floors, **11 `in`/`out` interior seams**,
**69 interior maps** hanging off single world tiles as separate coordinate spaces, **4 declared
cardinal one-ways**, and the transient void rooms that are in no file at all.

Four concrete features, in build order.

**1. The warp layer (a toggle, on by default while editing connections).** Non-adjacent
connections draw as **arcs over the grid**, not as tile decorations: a bezier from source tile to
target tile, colour-coded by class — vertical (z change), seam (facade/in-out), map-jump
(different `map_id`), one-way (arrowhead at one end only). Grid-adjacent steps draw nothing,
because they are the 98% and drawing them is noise. **A tile with an arc leaving it is a tile
that teleports you**, and that is the fact currently readable nowhere.

**2. The trace probe — "where does this actually take you".** Click a tile, pick a direction,
and the Studio walks the *real* resolution chain the engine walks — the exit, then the facade
forward, then the landing resolution — and highlights every tile the player would touch,
labelling the final one. This is the feature that answers John's question directly, because the
facade seam is precisely the case where "the exit says X" and "you end up at Y" differ, and no
current surface shows it.

**3. The entrance editor.** `flags.entrance` is the authored door side and the reason terrain
painting can no longer relocate doors ([flags-keys.md:101](../flags-keys.md)) — so setting it
must be a gesture, not a text field. Proposal: selecting a building tile draws **four door
handles on its four edges**; clicking one sets `entrance`. The chosen edge draws as a solid door
mark, the other three as walls. The derived consequences render live and read-only alongside it:
the street tile you spill onto (`exits[entrance]`), the interior's mirrored `out`, and the
`world_exit_zone` that used to be authored (§6.1). **You see the whole door in one picture**, and
the three fields that used to be able to disagree are one gesture.

**4. Interior inset panes.** An interior map is a separate coordinate space hanging off one world
tile. Draw it as an **inset pane docked to its facade** — a small grid, its own tiles, a drawn
tether to the parent — so the building and its inside are on screen together. Dive-in zooms the
inset to fill; the tether stays. This is also where MAP-1 becomes visible: two rooms at the same
coordinate render as one square, obviously wrong at a glance.

Two supporting behaviours:

- **Connections stay invisible until they carry meaning** (§8.6). Painting contiguous ground
  makes connections silently. The warp layer and the connection inspector are how you see the
  ~2% that say something.
- **Transient zones get a ghost marker.** Void/waste rooms are in no file
  ([systems-overland-void-travel.md](../systems-overland-void-travel.md)), so the Studio draws a
  hatched band along a region rim labelled "transient — generated at runtime", to stop a rim tile
  with no outward link reading as an orphan. This is the visual form of the caveat LINK-1 already
  carries in prose.

---

## 12. Rendering technology

### 12.1 Canvas, and the trap

The dev-panel map renders **one DOM element per tile**, which strains at 5,439 and fails at 10×.
Whole-map pan/zoom and drag-painting are what canvas is for. **Recommend canvas.**

**The trap is real: a second renderer is fear #1 inside the new tool.** "The preview is the ship"
only holds if the Studio and the game agree — and this document's whole evidence base is
renderers quietly disagreeing.

**The render-spec answer is correct and load-bearing.** The derive module emits, per tile, a
plain serialisable **render spec** — `{ fill, textColor, icon, glyph, label, classes, layers[] }`
— and that spec is what `zone_render` stores. The game's DOM renderer consumes it; the Studio's
canvas renderer consumes the same bytes. Neither computes anything. Divergence is bounded to
*how* a thing is drawn, never *what the tile is* — the right place for the line, because the
"what" has gone wrong four times in this codebase and the "how" never has.

Two caveats:

- **A render spec cannot make two renderers pixel-identical.** CSS textures (`.mm-dock`'s planks,
  [styles.css:2816](../../client/game/styles.css)) and SVG masks have no free canvas equivalent.
  The Studio will look *close*. Acceptable — its job is to show which tile you are editing. It is
  **not** acceptable for it to invent a colour the game doesn't use, and the spec prevents that.
- **The spec must be the only channel.** If the Studio ever reads `flags.terrain` and picks its
  own fill, we have rebuilt the problem. Worth a regress assertion.

### 12.2 Browser served locally, not a desktop app

**Recommend a local HTTP server serving a browser page** — what `tools/zone-planner/serve.mjs`
(155 lines) already does. Zero install, no build step, no native toolchain, consistent with the
project's whole posture. Node has the filesystem access; the browser is just the UI. A native app
buys file-watching we don't need and costs a toolchain and a second platform to keep working on
Windows.

### 12.3 What being non-live unlocks

1. **Whole-map view with pan/zoom.** Nothing in the game or dev panel can show 5,439 tiles at
   once, and most defects here are *cluster* defects — obvious at whole-map zoom, invisible tile
   by tile.
2. **The authored-vs-derived overlay.** A toggle dimming everything derived and lighting only
   what a human chose. The model made visible, and the best defence against it decaying: if a
   region lights up solid, someone has been overriding defaults by hand.
3. **The warp layer and trace probe** (§11).
4. **The map audit running inline — but only half of it, and the split is worth stating.** Once
   the audit reads the resolved DB (§17.1) it can no longer see the Studio's *unsaved* document,
   so "run the audit on every keystroke" is not available. What is: the **authored-half rules**
   (NAME-1, PROSE-1/2, TERRAIN-1, FLAG-3, SCAV-1, TABLE-1/2, NAME-2) test only fields the Studio
   already holds in memory, so they run live against the working document and paint onto the map
   as you edit. The **derived-half rules** need the build to have run, so they arrive after an
   import — the Studio surfaces the last full audit's findings as a second, dated layer. Two
   latencies, honestly labelled, rather than one that quietly lies about freshness.
5. **Git-diff preview before save.** The review step moved to the moment of authoring.
6. **Undo history.** Free once the tool owns an in-memory document; impossible in today's staged-
   PATCH model.

---

## 13. The build step

`content:import` gains one step, after the upsert pass and inside the same transaction:

```
0. SCHEMA_SQL                       (unchanged)
BEGIN; SET CONSTRAINTS ALL DEFERRED
1. deletion pass (git-diff driven)  (unchanged)
2. upsert pass (registry order)     (unchanged)
3. DERIVE:  read the committed zones + palette + connections
            → TRUNCATE zone_render;  INSERT the derived set
            → TRUNCATE zone_edges;   INSERT the projected graph
COMMIT
```

**Determinism.** A pure function of `(zones, maps, connections, palette)`: no clock, no RNG, no
environment reads, sorted iteration, no dependence on which rows the upsert touched.
`TRUNCATE`-then-rebuild makes idempotency trivial and removes the stale-row class.

**Purity is enforced at the build seam, not observed second-hand.** The import hands the derive
module nothing but parsed content — plain objects — and **no DB handle is in scope**. A `query()`
added to derive therefore throws at build time, in CI, naming the offending call, rather than
silently working in dev and producing a value that varies by database. This is the whole
enforcement mechanism, and it is deliberately the *only* one: an earlier draft argued that
keeping the map audit DB-free would police derive's purity as a side effect, which is a
non-sequitur (§17.1). One mechanism per job. Inspecting the seam directly is a stronger check
than inferring it from an unrelated tool's dependency list.

**These conventions already exist and should simply be codified.** `wildlands-expand.mjs:49-52`
uses a sin-hash rather than `Math.random` so re-runs are identical, and pins a fixed `updated_at`
(`:34`, `build-sewer-grid.mjs:18`) so re-runs produce no churn. `build-sewer-grid.mjs:155-159`
already re-derives its box-drawing markers from final connectivity.

**Whole-map, not incremental** (P6). `roadConnector`, the sewer art, the Curtain run and region
membership all need adjacency; a whole-map pass makes them trivially correct and costs nothing.

**Deploy safety.** The pass writes only generated tables, never `zones`, so the drift report and
the deletion pass are untouched. Both tables are classed `runtime`, so `content:export` never
emits them. CI already runs `content:lint → content:import → test:regress` against a **throwaway
local Postgres** ([deploy-content.yml:92-97](../../.github/workflows/deploy-content.yml)), so the
derive pass runs on every push with **zero Neon egress**.

`content:lint` gains: the flag/column reconciliation (§9.3), reference resolution (§10.4), a
DB-free dry run of the derive pass, and the undeclared-one-way check (§8.2). Lint is 1.97 s
today; this keeps it under five.

**One decision:** a hot-fix one-shot against prod that changes a tile's terrain leaves the
generated tables stale until the next deploy. Options: (a) accept it; (b) expose
`npm run map:derive` for one-shots to call; (c) make `reloadZone` re-derive in memory.
**Recommend (b)**; (c) reintroduces runtime derivation.

---

## 14. Migration — no flag day

Each step leaves the tree green and shippable.

1. **Palette as a content file, derived into `zone_render`, three renderers switched to read it.**
   No content changes; the redrock divergence fixes itself. *Gate:* regress + a visual check of
   the three map surfaces.
2. **Strip derived presentation out of `content/`** — null `color`/`bg_color`/`ambient_theme`
   where they equal the palette default (4,768 / 4,691 / 5,206 instances), keep the rest as
   overrides. A data transformation on existing rows, so a one-shot per CLAUDE.md. One large diff
   — the last one. *Gate:* `content:status` clean; audit unchanged except PAL-1.
3. **Delete provenance** — `flags.planner`, `created_by`, `updated_at` (15,653 instances).
   Register `updated_at` and `created_by` as `excludeColumns`. *Gate:* lint clean; export stable.
4. **Split `marker`** (§5.3) and **derive the structural fields** — `underwater`,
   `world_exit_zone`, `is_building`, `is_interior`, `icon`, facade↔interior links from
   `entrance`, interior grid coords from the connection graph. Unify the two `entrance` bakers
   and the five marker derivations into one module. *Gate:* MARK, WEZ, BLD and MAP-1 families
   clean without hand edits; the three mis-pointed `zone_util_*` exits fixed.
5. **Connections table** (§8) — `zone_edges` generated, `content/connections/` authored, doors
   re-homed with per-side state, `getDoorForEdge` replacing the nine both-sides call sites, and
   the **lock model** (§8.4): `lockable` authored, the lock row runtime-only, typed-principal
   access lists, the keycard minter deleted. *Prerequisite:* re-run the prod keycard census and
   confirm it is still zero (§16.2) — currently zero, so **migration input is nothing**.
   *Gate:* the 57 invisible doors become visible in `describe`; `door_voltage_vip` still opens
   for the bearer of `item_voltage_vip_band`; EXIT/LINK/BLD-1 families clean; regress green on
   movement, AI pathing and door verbs.
6. **Break the presentation→law reads** — pathfinding and pacing off `flags.icon`. *Gate:*
   regress + a GPS route check on a painted-road-without-icon tile.
7. **Catalog extended to columns** (§9.2) + reconciliation lint (§9.3). *Gate:* lint green with
   the new checks; the 8 dead entries triaged; `audio_theme_id` decided.
8. **Zone id rename** (§7.6) — three deploys: aliases, rename, verify. **`flags.district` becomes
   required and `DISTRICT_PREFIX` dies in the same change** (§7.4). *Gate:*
   `content:dangling --strict` clean against prod before and after; regress from a throwaway DB
   built from the renamed tree; GEO-1 structurally gone.
9. **Build the Map Studio** and retire the dev-panel Maps/Zones editing and
   `tools/zone-planner/` in the commit that proves the Studio can reproduce `bp_district`. Delete
   `apiCreateMap`/`apiSaveMapLayout`; narrow [content-sync.js](../../server/api/content-sync.js)
   so the panel no longer mirrors `zones` into `content/`.

Authoring surfaces retire only at step 9, so there is never a window with no way to edit the map.

**Ordering note:** step 8 (ids) deliberately lands *after* the field cleanup and *before* the
Studio, so the rename runs over the smallest possible tree and the Studio is built against final
ids. **Steps 5 and 8 are the two that touch live player state** and should not share a deploy.

**Migration-window hazard:** while both the dev panel and the Studio can write map data (steps
1–8), content-sync keeps dumping derived values back into files the previous step just cleaned.
Either suspend the mirror for `zones` at the start of step 2, or teach it to strip anything the
derive module would produce. The second is better and is a good early test of the derive module.

---

## 15. What this makes impossible

Four outcomes: **impossible** (no representation for the defect), **build gate** (authorable,
unshippable), **audit** (surviving human judgement), **obsolete** (concept gone).

| rule | outcome | why |
|---|---|---|
| **GEO-1** id vs coords | **impossible** | ids stop encoding coordinates (§7); there is no second position to disagree |
| EXIT-1 dangling exit | **impossible** | a connection references two zones that must exist |
| EXIT-2 non-adjacent cardinal | **impossible** | a cardinal connection is defined by adjacency |
| EXIT-3 one-way exit | **survives, better** | can no longer mean "the halves disagree"; now means "undeclared one-way" — **0 findings today** and stays 0 unless someone skips the declaration |
| EXIT-4 no exits | build gate | |
| BLD-1 walk-through-wall | **impossible** | facade connections derive from the one authored `entrance` |
| BLD-2 entrance with no exit | **impossible** | same derivation |
| BLD-3 interior map, no exit into it | **impossible** | same derivation |
| BLD-4 `building_type` without `is_building` | **obsolete** | `is_building` is derived (§6.1); also catches the 8 Halcyon tiles the audit misses today |
| BLD-5 `is_building` without a type | build gate | the palette can't produce an untyped building |
| BLD-6 `is_building` without `facade` | **obsolete** | collapsed into one authored concept |
| BLD-7 facade with no interior | audit | "scenery" is legitimate; the Studio makes it explicit |
| BLD-8 no `building_name` | build gate | |
| BLD-9 no/invalid `entrance` | **impossible** | placing a building requires a door side (§11.3) |
| WEZ-1/2/3 `world_exit_zone` | **impossible** | derived; 187/191 exact today and the derivation fixes 3 live defects |
| DOOR-1 no `doors` row | audit | but the 57 invisible closed doors stop existing — a bug this rule never caught |
| SPAWN-1 spawn on a facade | build gate | |
| SCAV-2 dangling loot table | **impossible** | the Studio picks from existing ids; lint checks the ref |
| DIR-1 `in`/`out` on a world tile | **impossible** | derived facade connections are cardinal |
| LINK-1 adjacent, unlinked | audit | a cliff is real. Contiguous painted ground connects by default, and the city↔wilds curtain becomes an **authored boundary object** instead of a rule replicated across four files |
| LINK-2 door faces an unlinked tile | **impossible** | derived |
| FLAG-1 no `terrain` | **impossible** | the Studio can't paint a tile with no surface |
| FLAG-2 no `region_id` | **impossible** | membership derives from the region rectangle |
| FLAG-3 unresolvable `district` | build gate | required authored + validated enum (§7.4) |
| FLAG-4 sub-surface water without `underwater` | **impossible** | it *means* `z<0 AND water`; 82 = 82 exactly. **The rule's text is also stale** — it claims no tile sets the flag |
| MAP-1 two zones on one coord | **impossible** for compass-linked rooms | interior coords derive from the connection graph; `in`/`out` rooms get deterministic placement instead of collision |
| MARK-1 marker on an interior | **obsolete** | interiors have no marker to carry |
| MARK-2 building has no marker | **obsolete** | always derived |
| MARK-3 apartment has no designation | **obsolete** | derived from the unit name |
| MARK-4 two buildings share a code | build gate | global derivation: auto-disambiguate derived, fail on colliding authored |
| MARK-5 code not derivable from name | report | means "an override exists" — a decision-log entry by construction |
| NAME-2 interior name repeats the building | audit | prose |
| GATE-1 nothing crosses the curtain | audit (cheaper) | the gate is an authored hole in an authored boundary; the build asserts ≥1 |
| TABLE-1 dead loot table | audit | |
| TABLE-2 duplicate item in a table | build gate | pure lint |
| SCAV-1 tile with no loot table | audit | **untouched** — a coverage backlog; no pipeline decides whether a tile deserves loot |
| PROSE-1 placeholder prose | reframed | an unauthored tile stores no description; 458 "defects" become a coverage number |
| NAME-1 placeholder name | reframed | same; 431 become coverage |
| PROSE-2 name contradicts terrain | audit (smaller) | only an authored override can contradict |
| TERRAIN-1 terrain contradicts prose | audit (smaller) | same |
| PAL-1 stale palette | **impossible** | there is no per-tile palette to leave behind |
| *(new)* uncatalogued flag/column | build gate | §9.3 |
| *(new)* dead catalog entry | lint warning | §9.3 |
| *(new)* undeclared one-way | audit (EXIT-3 reborn) | §8.2 |

**Score: 18 impossible, 5 obsolete, 10 build gates, 8 surviving judgement calls, 2 reframed to
coverage, 1 rule reborn in a better form.** Adopting connections and opaque ids together is what
moves EXIT-1/2, LINK-2 and GEO-1 into *impossible* — they were build gates in the previous draft.
Everything that survives is prose, loot coverage, or genuinely ambiguous geometry.

Also worth naming, same defect class, **reported not fixed**:

- **The you-are-here beacon replaces the tile instead of layering over it.**
  [minimap.js:709](../../client/game/js/panels/minimap.js) emits no content on `is_current`;
  [tablet-os.js:3084](../../client/game/js/panels/tablet-os.js) returns `'◉'` first;
  [cockpit.js:525](../../client/game/js/panels/cockpit.js) does `isC ? '◉' : (n.marker || '▪')`.
  The beacon is a `::before`/`::after` overlay ([styles.css:2408](../../client/game/styles.css))
  designed to sit *over* content. Standing on a road severs it; standing on the Fisherman Statue
  makes the statue vanish. Two lines, belongs in step 2.
- Coldwater Bay's geometry should move out of `minimap.js` into authored content.

---

## 16. Open questions and risks

**Decisions for step 2:**

1. ~~**The cross-table cost of leaving the dev panel**~~ — **RESOLVED, and the premise was
   false** (§16.1). `apiBuildBuilding` does **not** write atomically — it has no transaction, so
   the cost of leaving is negative. The fallback in §10.3 is withdrawn.
2. ~~**Live keycards in prod**~~ — **RESOLVED, exposure is zero.** The prod census
   (`scripts/keycard-census.mjs`) returns **0 `keycard_*` items in the catalog, 0 held by any
   player, 0 already orphaned**, across 198 doors / 9 players / 333 inventory rows. One door
   names a key item (`door_voltage_vip` → the authored `item_voltage_vip_band`), which the
   `item:` principal preserves unchanged. The minting seam is live code that has never fired.
   **Migration input is nothing** — no access lists to seed. Re-run the census immediately
   before step 5 to confirm it is still zero; it is read-only and cheap.
3. ~~**`audio_theme_id`**~~ — **RESOLVED: demote to a region/district default with a per-tile
   override** (§16.3). Spec it first in step 2 as the worked example for defaults-and-overrides
   (§5.5).
4. **Interior placement for `in`/`out`-linked rooms.** The build must pick something
   deterministic, and whatever it picks binds every in/out interior in the world.
5. **Sharding `content/zones/`** (§7.5). 5,785 flat files today; ~58,000 at 10×. The deletion
   pass parses the table out of `path.split('/')[1]`
   ([import.mjs:255](../../scripts/content/import.mjs)) and lint enforces pk↔filename agreement.
   Deferrable — step 2 of the migration shrinks the tree more than sharding would.
6. **Catalog rename** to `fieldCatalog.js` — honest, but touches every importer; step 4 work.
7. **Structured-value schemas** — `checkpoint_cfg`, `elevator_floors` and ~3 others.

### 16.1 The cross-table spike — resolved, and the question was malformed

This was the last blocking unknown and the reason step 2 was told to spike it first. The answer
is not "the Studio can match the dev panel." It is **the dev panel does not do the thing the
spike was worried about losing.**

**The premise: "`apiBuildBuilding` writes six tables atomically."** The first half is true, the
second is false.

**It has no transaction.** [routes.js:790-977](../../server/api/routes.js) issues ~15 bare
`await query(...)` calls. `db.js` exports a `withTransaction` helper
([db.js:104](../../server/models/db.js)) and four call sites use it — crafting, vendor,
inventory — all player-economy paths. `apiBuildBuilding` is not one of them; the only `BEGIN` in
`routes.js` is at :1509, in a different function. Each write commits on its own. The `try/catch`
at :832 returns a 400 string; it does not roll anything back. **A failure at step 5 leaves the
facade, the interior map, the lobby and every template room committed and live** — a half-built
building with no power, no lights and no way to finish it except doing it again by hand.

The comment at :788 — *"Commits directly (too many cross-table rows for zone staging)"* — reads
as a design note. It is an admission.

**So the comparison is not atomic-vs-files. It is unguarded-vs-git.** A commit is atomic across
all ~15 files; CI imports the whole tree or fails the deploy. **Writing files is strictly more
atomic than what ships today**, and this row of §10.3's cost table inverts: it is a benefit.

**Second: the six tables are not six tables of authored content.** Decomposed:

| written | what it really is | under the new model |
|---|---|---|
| `zones` — facade, lobby, rooms, utility room | authored content | files |
| `zones` — **neighbour `exits` UPDATE** ([:858-864](../../server/api/routes.js)) | geometry | **gone** — derived into `zone_edges` (§8.3) |
| `maps` | authored content | file |
| `furniture` — template pieces, room lights, worklight, junction box | authored content | files |
| `generators` — `gen_<utilId>`, deterministic id | authored content | file |
| `npcs` — inhabitant | authored content | file |
| `lighting_states`, `power_zones` load, `recomputePower()` | **runtime, recomputed on boot** | **not authored at all** |

Four content tables, one derived table, and a runtime recompute that already runs at boot. The
Studio writes files for the four. It never needed to write the other two — the current code only
does because it is mutating a live world in place.

**Third: `nearestCityPlant(query, gx, gy)`** ([utility-room.mjs](../../tools/lib/utility-room.mjs))
is the one genuine live-world *read* feeding an authored value. It picks the city plant the new
junction box hangs off. That becomes either an authored pick in the Studio's inspector or a
derive-time resolution — a decision for the connection/power spec, not a blocker.

**Fourth, found while spiking and worth fixing regardless: the reload-derive round trip at
[:866-871](../../server/api/routes.js) is dead ceremony.** It writes the facade, reloads it plus
every neighbour into the live world, then calls `buildingEntranceDir(getZone(facadeId))` to
learn the door side. But `buildingEntranceDir` is now a one-line read of `flags.entrance`
([world.js:176-179](../../server/engine/world.js)) — and the facade flags assembled at :839
**never set `entrance`**. It is always `null`, so the expression always falls through to
`OPPOSITE[front.dir]`. The reloads buy nothing.

Two consequences:

- The round trip that made this operation look impossible to do offline **is not doing any
  deriving**. Removing it is a prerequisite of nothing; it is just wrong today.
- **Every building created through "New Building" is born failing BLD-9** (facade with no
  `entrance` flag): no map entrance arrow, and `facadeStreetTile()` back to guessing. All 61
  facades in `content/` carry `entrance` — the one-shot bake
  (`scripts/bake-building-entrances.mjs`) plus hand-correction caught every existing one — so
  this is **latent, not live**. It fires the next time someone builds.
- **And it would fail DIR-2 as well, because the fallback points the wrong way.** The interior's
  way out must face the same direction as the door (audit DIR-2: *"interior must leave the way
  the door faces"*); only the facade's link *into* the interior is the mirror. `backDir` is
  meant to be the entrance side, but its fallback is `OPPOSITE[front.dir]` and the comment at
  :890 still describes the pre-fix convention. Measured across `content/`: **61 of 61 buildings
  have interior-out == entrance, zero use the opposite.** The builder would produce the 62nd as
  the only violation of a rule that currently holds without exception.

Both are one-line fixes in a function the redesign eventually deletes — `facadeFlags.entrance =
front.dir`, and drop the fallback's `OPPOSITE`. Worth doing now rather than at cutover, since
"don't build anything through the panel until the Studio lands" is not a real instruction.

**Fifth: the dev panel already cannot ship a building.** The save-hook
([content-sync.js](../../server/api/content-sync.js)) resolves each request to **one** entity.
`POST /maps/build-building` hits `contentTargetFor` with `seg0='maps'`, `segs.length===2` — the
`POST && segs.length===1` arm misses, the `PUT/DELETE && segs.length===2` arm misses, and it
**returns null. Zero files are written.** Same for `/maps/move-building`,
`/maps/generate-region`, `/maps/move-region` and `/maps/link-interior`, and for staged building
moves, which call `apiUpdateZone` in-process rather than over the `/zones/:id` route the hook
watches.

Single-entity edits sync. **Compound map operations do not.** So a building built in the panel
today exists only in the author's local database until somebody runs a full `content:export` —
which the `codex` skill correctly tells you almost never to run, because it drags the whole
played-in world back over the tree.

**That is fear #2 in its purest form.** The tool that exists to make building easy produces work
that the pipeline cannot ship, and the workaround for that is a command that creates a different
mess. The Studio does not have to *match* this seam. It has to *have* one.

**Verdict: no fallback needed. §10.3's "content-mode data layer inside the dev panel" is
withdrawn** — it was insurance against a cost that does not exist, and it would have left two
writers of the same fields, which is the thing this document exists to stop.

### 16.3 `audio_theme_id` — decided: demote to a regional default

**First, three corrections**, because this field has been mischaracterised twice during this
investigation and the record should be right:

- **It is not unused code.** [audio/index.js:187-192](../../plugins/audio/index.js) plays the
  zone's song on `zone.entered`, and `:245` re-establishes it after a clone-vat respawn. Both
  paths work.
- **`ambient_theme` is not its live alternative.** That column selects a pool of **text**
  ambience messages ([world.js:1150](../../server/engine/world.js) returns
  `{message, loudness}`). Different job, different output channel. They are not substitutes and
  the doc should never imply they are (§5.5 now says so explicitly).
- **`audio_event_routes` *can* shadow it** — `triggerEventRoute('zone.entered.<zoneId>')`
  returns early at [audio/index.js:185](../../plugins/audio/index.js) — but there are **5 routes
  in content and all 5 are weather** (`weather.rain`, `weather.thunder` ×3, `weather.storm`;
  the field is `event_name`). **No zone-music routes exist.**

So: **per-zone music has exactly one mechanism, it works, and it is used zero times.** Six songs
sit referenced by nothing — `song_neon_rain`, `song_dead_zone`, `song_explore_loop`,
`song_upper_deck`, `song_ghost_signal`, `song_data_heist` — and those are zone-ambience names,
not radio names. Somebody wrote the beds for this and never placed them.

**The reason it reads as bloat is the shape, not the wiring.** It is a per-tile column that is
NULL 5,785 times to express something that varies by *area*. Under §5.5 it should not be
per-tile at all.

**DECIDED: demote to a region/district-level default with a per-tile override.** A region or
district carries `audio_theme_id`; a tile overrides it only where a specific room wants its own
bed. ~10 authored values instead of 5,785 nulls, the six orphan songs become placeable in an
afternoon, and the Studio gets one field on the region inspector rather than a dead box on every
tile.

The alternative — dropping the column — was rejected: the mechanism is built and working and the
content exists unplaced. The only thing wrong is that it was modelled at the wrong granularity,
which is exactly the defect this proposal exists to fix. Deleting a working feature because it
was shaped badly would be the wrong lesson to take from this exercise.

Field-count effect is recorded in §6.2, including the caution not to over-credit it: it removes
a *type*, not instances.

**Risks:**

- **The id rename is the highest-risk change in this plan** and the only one that rewrites live
  player rows. Mitigated by the alias table, the three-deploy sequence, and `content:dangling`
  — but it deserves its own rehearsal against a prod snapshot, which the Neon predeploy branch
  makes cheap.
- **Migration step 2 produces one enormous diff.** Unavoidable — it is the diff that ends all the
  other enormous diffs. Ship it alone.
- **A derivation bug ships on 5,439 tiles at once.** Mitigated by the CI gate, by derive's purity
  being enforced at the build seam (§13), and by the audit reading the resolved DB — **a step-2
  deliverable, not a risk to watch** (§17.1).
- **The audit reports green on a stale local DB.** The new failure mode created by that port,
  and the reason the HEAD-marker refusal in §17.1 is a hard stop rather than a warning.
- **Two tools is a real cost.** Someone will paint in the Studio and wonder why the dev panel's
  map is stale. Mitigation: read-only geometry, and say so on screen.
- **Something reads a derived field as law and nobody notices.** This is how `flags.icon` became
  pathfinding. Mitigation: put derived data on a distinct shape (`zone.render.*`) so a
  game-logic read is grep-able, plus a regress assertion.
- **The Studio's canvas renderer drifts from the game's DOM renderer.** Mitigated by the render
  spec, but only if the spec is the *only* channel. Assert it.

---

## 17. The four steps

**Step 1 — investigate and plan.** This document. *Gate:* John resolves §16's open questions,
principally the prod-keycard check (§16.2) and the `audio_theme_id` call.

**Step 2 — design the system.** The concrete spec: palette schema, `zone_render` / `zone_edges` /
render-spec shapes, the connection file format with per-side door state and the typed-principal
access list, the derive module's function list, the column-catalog extension, the id scheme and
rename script, the Studio's document model and gestures. ~~Spike the cross-table cost first~~ —
**done, and it came back inverted (§16.1): nothing is lost by leaving the dev panel, because the
panel's building placement is neither atomic nor shippable today.** The building-placement CLI
is now the *proof* the step-2 gate asks for rather than a risk it has to price.

**Also in step 2's scope, and not optional: port the map audit to read the resolved DB.** See
§17.1 — this replaces an earlier proposal in this document that the audit re-run derive itself,
which was wrong.

*Gate:* a spec another agent could implement without re-deriving any of this; a working proof
that a building can be placed end-to-end writing only content files; and the audit reading
`zones` + `zone_render` + `zone_edges` from a local DB with its existing rule set green.

### 17.1 The audit reads the DB

After this redesign, half the facts the rules test are derived and **absent from `content/`
entirely**. An unchanged files-only audit would not merely miss them — it would keep reporting
green while looking at a world that no longer exists on disk.

**An earlier draft of this document proposed that the audit run the derive pass in-process, and
argued that keeping the audit DB-free enforced derive's purity. Both halves were wrong.**

The second half first, because it is the cleaner error: *"if the audit needs a DB, derive has
stopped being pure"* is a non-sequitur. An audit needing a DB says nothing whatever about
derive's purity — it says only that the audit reads the artifact rather than re-simulating it.
Two independent concerns were welded together, and the weld was load-bearing in the argument.

The first half is worse. **If the audit runs its own derive pass, it audits its own arithmetic.**
The moment the audit's derive and the build's derive diverge — a stale import, a different call
path, one updated without the other — the audit goes green while prod is wrong. That is exactly
the failure class this entire rebuild exists to eliminate, reintroduced inside the tool built to
catch it. It is the `HA`/`HO`/`HR` defect one level up.

**And a files-only audit is structurally blind to three things**, none of which re-simulation
fixes:

1. **Round-trip loss.** It only ever reads the input side, so anything export/import mangles is
   invisible to it by construction.
2. **Generated tables, entirely.** `zone_render` and the ~10,633 `zone_edges` rows are not in
   `content/` at all. **A files-only audit cannot check that generated connections are
   reciprocal, because it cannot see a single one.** This alone is disqualifying.
3. **Drift** — the thing CI's prod drift report exists to catch, one level up.

**So the audit reads the DB and audits the world that ships.**

#### What actually changes in the rules

Read from `audit-map.mjs` rather than assumed. The audit loads six tables through one helper,
`loadDir()` ([:356-361](../../.claude/skills/map-audit/scripts/audit-map.mjs)): `zones`, `maps`,
`zone_spawns`, `doors`, `scavenging_tables`, `scavenging_table_items`. Each becomes a `SELECT`.

- **No rule keys on the filename.** `__file` is attached at `:360` and used in exactly two
  places: `writeEntity()` (`:362-365`) and a path printout (`:932`). The pk↔filename agreement
  check the coordinating brief worried about lives in **`content:lint`**
  ([lint.mjs:80](../../scripts/content/lint.mjs)), not here. So the rule bodies port unchanged —
  they already operate on plain row objects.
- **The authored-half rules are untouched.** NAME-1, PROSE-1, PROSE-2, SCAV-1, TERRAIN-1, PAL-1,
  NAME-2, TABLE-1/2, FLAG-3 read columns that exist identically in the DB.
- **The derived-half rules become possible for the first time** — the reciprocity and
  connection-graph checks that today can only be inferred from two half-facts.
- **The audit already imports engine modules and already loads `db.js`.** It pulls `DISTRICTS`
  from `districts.js` (`:37-40`) and `zoneTerrain` from `world.js` (`:45-47`) — and
  `world.js:1` imports `query` from `models/db.js`, whose `new Pool(...)` runs at module load
  (`db.js:42`). The pool is lazy, so no connection is made, but **"no DB" was already only "no
  queries issued"**. The friction delta of this port is smaller than it looks.

#### The fixers split, and that is deliberate

Nine rules carry auto-fixers (BLD-1, BLD-4, WEZ-1/2/3, SPAWN-1, DIR-1, MARK-1, MARK-3), and they
**write files** — `writeEntity()` serialises through `content:export`'s own `canonicalJson` so a
fix is byte-identical to what the next export would produce (`:30-35`).

**That must not change.** The audit reads the resolved DB and writes authored `content/` files.
Writing the DB would be precisely the "authoring against the live database" this whole proposal
forbids. So the fixer path gains one mapping step — resolved row → authored file — which for
`zones` is pk → filename and is the *only* place file-tree structure legitimately enters.

Re-examined against the new model, most of these fixers stop existing rather than moving:

| fixer | fate |
|---|---|
| `setWez` (WEZ-1/2/3), `setIsBuilding` (BLD-4), `clearMarker` (MARK-1), `setMarker` (MARK-3) | **obsolete** — their fields become derived (§6.1), so the rules are impossible and the fixers have nothing to write |
| `sealFacade` (BLD-1), `cardinaliseInterior` (DIR-1) | **retarget** — they edit exits, which move to `content/connections/` (§8) |
| `moveSpawn` (SPAWN-1) | **unchanged** — `zone_spawns` is authored either way |

#### The real cost, and the trap it opens

**The audit stops being runnable cold.** It needs a local DB that has been imported. In practice
that is near-zero friction — `npm run test:regress` already requires a DB, and `content:import`
is already the standard loop — but it introduces the *inverse* failure: edit content files,
forget to import, audit yesterday's rows, get a clean report on work that was never loaded.

**The mechanism to prevent that already exists.** `content:import` records the imported commit in
the target DB: `server_settings` key `content_pipeline.last_imported_sha`, written at
[import.mjs:324-326](../../scripts/content/import.mjs) as the final step of the import
transaction (`MARKER_KEY`, from `lib.mjs`). The deletion pass already reads it (`:240-243`) and
**skips loudly when it is missing** — the precedent for treating a stale marker as a hard signal
rather than a warning.

So: **the audit reads that marker, compares it to `git rev-parse HEAD`, and refuses to run when
they differ** — printing the two shas and `npm run content:import`. Not a warning. A clean report
on stale rows is worse than no report, because it is trusted. Two accommodations: `--allow-stale`
for someone deliberately auditing a past state, and the check is skipped when the marker is
absent *and* the DB is empty (a fresh clone should say "import first", not "sha mismatch").

#### Auditing prod — a capability it has never had

Now that the audit speaks DB, pointing it at prod is nearly free: `db.js` selects SSL by
**hostname** (`db.js:33-35` — anything not `localhost`/`127.0.0.1`/`::1` gets TLS), which is the
same mechanism one-shots already use via `node --env-file=.env.prod`. The audit issues six
`SELECT`s and writes nothing, so read-only is structural, not a promise.

That is a genuine gain: **"what is wrong with the world that is live right now"** is a question
the audit has never been able to answer. It also catches the one thing neither files nor a local
DB can — prod drift from manual edits.

Two conditions, both firm. **It needs explicit approval each run**, per the prod-read rule in
[content-pipeline.md](../content-pipeline.md) — the auto-mode classifier blocks direct
`PROD_DATABASE_URL` reads unless the user has named prod as a target. And **the fixers must be
hard-disabled against a remote host**, not merely defaulted off: content reaches prod through git
only, and a fixer writing files from a prod read would produce a diff nobody authored. Six
`SELECT`s of six tables is also a real (if small) Neon egress cost — bounded and occasional,
unlike the per-push drift report that burned 5 GB, but worth running deliberately rather than in
a loop.

**Step 3 — cut over.** Migration steps 1–8, each its own commit, each green through
`npm run test:regress`, each leaving the audit no worse. The Studio is built here but not yet
load-bearing. *Gate:* every rule marked *impossible* or *obsolete* in §15 sits at zero findings
**without any hand edits** — the proof that the structure works rather than that someone tidied
up.

**Step 4 — ship and retire.** Migration step 9: the Studio becomes the authoring surface, the
dev-panel map editor and `tools/zone-planner/` are deleted, and the docs are rewritten to match
— [systems-terrain.md](../systems-terrain.md),
[land-taxonomy.md](../reference/land-taxonomy.md) (§7.4 makes its "don't parse ids" rule true),
[flags-keys.md](../flags-keys.md), [content-pipeline.md](../content-pipeline.md), and
[map-audit rules.md](../../.claude/skills/map-audit/rules.md) (including the BLD-4 and FLAG-4
corrections in §4.3c). *Gate:* `bp_district` — 888 tiles — reproducible from the Studio, a full
regress, and a real deploy.
