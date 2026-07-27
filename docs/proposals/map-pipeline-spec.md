# Map Pipeline — implementation spec

**Status:** step 2 of four ([map-pipeline-redesign.md §17](map-pipeline-redesign.md)). This is
the *what*; the redesign document is the *why*. Where they disagree, the redesign wins on intent
and this file wins on shape — but flag the disagreement rather than picking, because the two
disagreeing at all is fear #1.

**Who this is for:** an implementer with no memory of the investigation. Every number here was
measured, and the measurement is named so you can re-run it. Nothing below asks you to re-derive
a decision — where a decision was made, §-links point at the argument.

**What this spec does not cover:** the migration sequencing (redesign §14), the id rename
mechanics (§7.6), and the Studio's visual design. Those are step-3 concerns; this is the data
model, the contracts and the seams.

---

## 0. The shape of the thing, in one screen

```
content/                             ← authored. git is the SSOT. humans + Studio write here.
  zones/<id>.json                    one tile
  maps/<id>.json                     one grid container
  regions/<id>.json                  one region  ← gains `defaults`
  connections/<id>.json              only connections that SAY something (~238, not 10,633)
  map/terrain.json                   the palette — the only place a terrain's look is written
         │
         │  npm run content:import
         ▼
   [ upsert pass ]  → zones, maps, regions, connections   (unchanged, git-diff deletion pass)
         │
   [ DERIVE pass ]  ← pure function, NO DB HANDLE IN SCOPE
         │
         ├──→ TRUNCATE + INSERT  zone_render   every resolved presentation value
         ├──→ TRUNCATE + INSERT  zone_edges    the full connection graph, both directions
         └──→ write              content/map/index.json   coords ↔ id, generated
         │
         ▼
   [ boot ]  one SELECT each, merged onto world.zones as `zone.render` / `zone.edges`
             zero queries at play time
```

Two rules carry the whole design:

- **P1 — what a player is anchored to must be stable; everything else can be regenerated
  freely.** Zone ids are stable. Connection *geometry* is regenerated. Connection *fixtures*
  (doors, locks) are stable because a lock can hold a grant.
- **P4 — game logic may not read a derived value.** Derived data lives on a distinct shape
  (`zone.render.*`) precisely so a game-logic read is greppable.

---

## 1. Authored file formats

### 1.1 `content/zones/<id>.json` — the tile

Unchanged in mechanism (one JSON file per row, canonical key order, written by
`scripts/content/lib.mjs`). What changes is **which keys are allowed to appear.**

The `zones` table has 19 columns (`schema.js:105-121, 329, 725, 1345`); `stains` is
`excludeColumns` runtime residue, leaving **18 in a content file**. After this spec:

| column | class | notes |
|---|---|---|
| `id` | **authored, frozen** | §4. Never re-derived, never a function of position. |
| `name`, `description` | **authored** | prose. |
| `map_id`, `parent_zone`, `grid_x`, `grid_y`, `grid_z` | **authored** | geometry. |
| `flags` | **authored** | validated against the field catalog (§3). |
| `ambient_events` | **authored** | per-tile text ambience overrides. |
| `created_by` | **authored** | provenance. |
| `updated_at` | authored-ish | pinned by generators; see §6.4. |
| `marker` | **authored OVERRIDE, absent by default** | §2.2. Was four jobs; now one. |
| `color`, `bg_color` | **authored OVERRIDE, absent by default** | palette supplies the default. |
| `ambient_theme` | **authored OVERRIDE, absent by default** | 579 tiles keep a real override. |
| `audio_theme_id` | **authored OVERRIDE, absent by default** | §2.1. Default moves to the region. |
| `exits` | **DELETED from content** | §5. Replaced by geometry + `content/connections/`. |
| `stains` | runtime | already excluded. |

`flags.icon` becomes **derived only** and must not appear in a content file (redesign §5.4).
Lint enforces both deletions: an `exits` or `flags.icon` key in `content/zones/*.json` is an
**error**, not a warning, because a file carrying one means somebody's tool is still writing the
old model.

### 1.2 `content/map/terrain.json` — the palette

One entry per terrain. **The only place a terrain's look is written down.** `TERRAIN_FILL`,
`TOS_TERRAIN_FILL` and `TERRAIN_TYPES` are deleted (redesign §5.2).

```jsonc
{
  "version": 1,
  "default": "concrete",              // terrain assumed when flags.terrain is absent
  "terrains": {
    "road": {
      "label": "Road",
      "fill": "#3a3a3e",              // canvas / minimap fill
      "text": "#c8c8cc",              // glyph colour
      "glyph": null,                  // marker fallback; null = blank tile
      "minimap_class": "road",        // CSS class the game client applies
      "ambient_theme": "city",        // DEFAULT only — a tile may override
      "flight_biome": "urban",
      "auto_tile": true,              // adjacency-aware art (roads, water, sewer)
      "speed_mult": 1.25              // pacing reads this, NOT flags.icon (redesign §5.4)
    }
  }
}
```

**`speed_mult` is the fix for a live bug**, not a new feature: pacing currently keys off
`flags.icon` matching `/^road_/`, so a tile *painted* `road` with no authored icon gets no
speed-up ([pacing/index.js:74](../../plugins/pacing/index.js)). Moving the number into the
palette makes the painted fact and the mechanical fact the same fact.

**Validation:** every `flags.terrain` value in `content/zones/` must have a palette entry
(lint error), and every palette entry should be on ≥1 tile (lint warning — dead palette entries
are how a UI grows options nothing uses, same rule as §3.3).

### 1.3 `content/regions/<id>.json` — gains `defaults`

Add one JSONB column, `regions.defaults`:

```sql
ALTER TABLE regions ADD COLUMN IF NOT EXISTS defaults JSONB DEFAULT '{}';
```

It holds the region-level slot of the defaults-and-overrides mechanism (redesign §5.5). Today
that is exactly one key:

```json
{ "id": "region_coldwater", "name": "Coldwater",
  "defaults": { "audio_theme_id": "song_neon_rain" } }
```

**Measured, so you know the scale you are building for:** there are **2 regions**
(`region_coldwater`, `region_the_reach`), both have content files, and they cover **5,237 of
5,785 tiles** — 4,837 and 400 respectively. The remaining 548 tiles carry no `region_id` and
fall through to the palette/global default.

So `audio_theme_id` goes from *a column that is NULL 5,785 times* to **2 authored values plus a
handful of per-tile overrides.** That is the entire argument of §5.5 in one field, and it is why
§5.5 nominates it as the thing to build first.

### 1.4 `content/connections/<id>.json` — the authored connection

**A file exists only when there is something to say.** Contiguous walkable ground produces no
file and no diff (redesign §8.6). Today's ~10,633 connections would produce **~238 files** —
65 one-ways and 173 doors.

```jsonc
{
  "id": "conn_voltage_floor_north_k3f9",   // stable, authored, NEVER regenerated
  "a": "zone_voltage_floor_p2m1",
  "b": "zone_voltage_vip_x7q4",
  "dir": "north",                          // direction FROM a TO b
  "one_way": false,                        // true ⇒ no b→a edge is projected
  "name": "the VIP door",                  // optional, for prose and audit output
  "lockable": true,                        // a lock MAY be installed here. §6.
  "door": {                                // optional fixture
    "type": "door",
    "hp": 120,
    "closed_by_default": true
  }
}
```

**`dir` is authoritative, not adjacency.** A connection may join non-adjacent tiles or tiles on
different maps — that is the whole point of making warping legible (redesign §11). The build
projects `a --dir--> b` and, unless `one_way`, `b --opposite(dir)--> a`.

**What is deliberately NOT in this file:** the installed lock, its access list, its open/locked
state, and its current HP. Those are runtime (§6). The authored file declares the *socket*; the
DB holds the *fitting*. This is what keeps live security state out of git.

**Id stability is a hard requirement.** The lock row is keyed by `connection.id`. Re-deriving a
connection id from its endpoints would make a lock's grant evaporate when a tile is renamed —
the exact P1 failure the keycard model had. Generate the id once, at creation, with a random
suffix; never re-derive it. Lint fails on a duplicate id and on a file whose `a`/`b` do not
resolve.

---

## 2. Generated tables

Both are classed `runtime` in `content-registry.js`, which makes them **structurally unable** to
enter `content/` — `content:export` never emits a runtime table. That is the same protection
`furniture.origin` buys, applied by classification instead of by care.

Both are `TRUNCATE`d and rebuilt inside the import transaction, which makes idempotency free
and removes the stale-row class entirely.

### 2.1 `zone_render`

```sql
CREATE TABLE IF NOT EXISTS zone_render (
  zone_id        TEXT PRIMARY KEY REFERENCES zones(id) ON DELETE CASCADE,
  marker         TEXT,          -- resolved: override ?? derived ?? null
  color          TEXT,
  bg_color       TEXT,
  icon           TEXT,          -- derived ONLY. no authored slot.
  ambient_theme  TEXT NOT NULL, -- resolved, always present
  audio_theme_id TEXT,          -- resolved: tile override ?? region default ?? null
  minimap_class  TEXT,
  glyph          TEXT,
  spec           JSONB NOT NULL DEFAULT '{}'   -- the render spec (§2.3)
);
```

**Every column is always present after a build.** Renderers read *only* this table's values;
they never fall back to `zones.marker`. That is what makes "the map draws the authored marker,
not one it invents" (`36f1b8f3`) hold by construction instead of by vigilance.

The FK is safe: the deletion pass runs before the upsert pass, and the derive pass runs after
both, inside the same transaction with `SET CONSTRAINTS ALL DEFERRED` already in force.

### 2.2 `zone_edges`

```sql
CREATE TABLE IF NOT EXISTS zone_edges (
  from_zone     TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL,
  to_zone       TEXT NOT NULL,
  connection_id TEXT,           -- the authored file, when one exists; NULL for pure geometry
  kind          TEXT NOT NULL,  -- 'grid' | 'portal' | 'authored'
  PRIMARY KEY (from_zone, direction)
);
CREATE INDEX IF NOT EXISTS idx_zone_edges_to ON zone_edges(to_zone);
```

`(from_zone, direction)` is the primary key because one direction leads exactly one place —
which is what makes the table a drop-in for the `exits` object. `kind` distinguishes a projected
grid step from a cross-map portal from a connection that exists only because a file says so.

**`zone_exit_overrides` is unchanged and still merges on top** (redesign §8.5). Its
one-sidedness is correct there: a generator's utility-room link genuinely is a one-way runtime
addition, not authored geometry.

### 2.3 The render spec (`zone_render.spec`)

The **only** channel between the derive module and any renderer. The Studio's canvas and the
game's DOM renderer both consume it; neither re-implements a palette lookup. A regress assertion
must pin this (§9), because the moment one renderer computes something the other doesn't, the
two-tool cost in redesign §16 becomes real.

```jsonc
{
  "fill": "#3a3a3e",
  "text": "#c8c8cc",
  "glyph": "═",              // resolved marker/glyph to paint
  "minimap_class": "road",
  "auto_tile": { "n": true, "e": true, "s": false, "w": true },  // present iff palette auto_tile
  "entrance": "north",        // facades only — mirrors flags.entrance, for the arrow
  "height": 4                 // buildings only — from flags.floors
}
```

### 2.4 `content/map/index.json` — the coordinate atlas

Written by the build, committed, `runtime`-equivalent in spirit but a file because its whole
purpose is to be greppable. Maps `map_id:x,y,z → zone_id` and back.

This exists to pay back the one honest loss in §4: `zone_district_920_911` is self-locating and
`zone_ochre_draw_k3f9` is not. The index makes `grep 920,911` work again, and unlike the old
scheme it works for **interiors**, which have coordinates but never had coordinate ids.

---

## 3. The field catalog

**Decision (redesign §9.2, Option 1): one catalog, extended — not a second registry.** Two
schemas describing one entity is fear #1 in miniature. The rename to `fieldCatalog.js` is honest
but touches every importer; **defer it to step 4.**

`client/shared/tagCatalog.js` today: 200 entries, 104 `scope: 'zone'`, every one carrying
`label`/`shape`/`group`/`help` with zero omissions. It already imports cleanly into Node (a
dual-mode IIFE assigning `globalThis.TAG_CATALOG`), and `zoneFlagsError()`
([routes.js:636](../../server/api/routes.js)) already rejects uncatalogued keys on save.

**The Studio renders its entire flag editor from this catalog.** A new system's flag becomes
editable with zero tool changes — one catalog entry and it appears, grouped, labelled, with help
text and the right widget.

### 3.1 Four additions

1. **`scope: 'zone_column'`** for the 11 columns that are not flags: `name`, `description`,
   `color`, `bg_color`, `marker`, `ambient_theme`, `audio_theme_id`, `map_id`, `parent_zone`,
   `grid_x/y/z`. Without this the Studio has no audio editor at all, silently.
2. **`shape: 'ref'`** with `refTable`. Applies to `scavenging_table_id` (1,330 tiles),
   `fishing_table_id` (8), `mining_table_id` (4), `audio_theme_id`, `world_exit_zone`,
   `hangar_interior_zone`, `region_id` (5,237) — all typed `text` today, all actually
   references. Buys a picker in the Studio and a resolution check in lint. **Highest-value
   single addition in this section.**
3. **Real shapes for the ~5 structured keys** — `checkpoint_cfg` is a JSON object declared
   `shape: 'text'`; `elevator_floors` is a `list` of objects. Until they have a shape they are a
   textarea you can typo into.
4. **Fix the stale shape list** at `tagCatalog.js:18-25` (documents `text/flag/int/enum/range/
   hot/statmap`; zone entries actually use `number` and `list`). Collapse `int` into `number`.
   Add `order` for within-group sorting.

### 3.2 `validateTags` gains a column-scope sibling

So the whole tile is validated by one mechanism rather than half of it.

### 3.3 Reconciliation becomes a lint gate

Measured today: **96 distinct flags keys across 5,785 zone files; 104 zone-scope catalog
entries; zero uncatalogued keys; eight catalogued-but-unused** (`airspace_restricted`,
`claimable`, `gov_checkpoint`, `gov_enclave`, `heading`, `vessel`, `water`, `water_temp_c`).

- **uncatalogued key in content → error.** Today's zero becomes enforced rather than lucky.
  This closes the one hole `zoneFlagsError()` cannot see: a key introduced by a hand edit or a
  content-file one-shot bypasses the HTTP validator entirely.
- **catalogued key on no tile → warning.**

`content:lint` needs no DB and runs in 1.97 s. Everything this spec adds to it must keep it
under five seconds; if it doesn't, the check is wrong, not the budget.

### 3.4 One-off feature anchors stay flags

~60 of the 96 keys appear on ≤6 tiles. **Do not build a `feature_anchors` table.** They
genuinely are properties of the tile (`echelon_bridge` means *this room is the bridge*); the
cost of a flag is already one catalog entry and one JSONB key; and a second place a tile's
identity lives, owned by a different system, is the coupling this whole exercise removes. The
long tail is an argument for **generating the UI**, which §3 does, not for restructuring the
data.

---

## 4. The id scheme

**`zone_ochre_draw_k3f9`** — a slug of the tile's name *at creation*, plus a short random
suffix. Not a ULID (unreadable in `ls`), not a pure name-slug (566 distinct names over 5,439
tiles collide, and renames tempt re-slugging).

**The suffix does the collision work so the slug never has to be re-derived — and re-deriving is
precisely what makes an id unstable.** `zone_ochre_draw_k3f9` stays that forever even if the
tile is renamed to "Ferric Wash". The name is a field; the id is a label.

Measured: **94.8%** of zone ids currently encode coordinates or position, and `zone_district_*`
alone is 4,836 of them. That is the coupling being removed.

The rename itself — alias table, three deploys, `content:dangling --strict` as the gate — is
redesign §7.6 and is **step-3 work**. Do not start it as part of this spec.

---

## 5. `exits` leaves content

**32 sites write `exits`** (`SET exits=` / `exits = $`) plus 19 `addExit`/`removeExit`/
`addExitOverride` calls. Most die with the dev-panel map editor and `tools/zone-planner/`. The
rest move to a connection API.

**Reads are already mediated**, which is why this is affordable: `exits.js` fronts
`exitTargets`, `allExits`, `neighborZoneIds`, `primaryExits`, and raw `zone.exits[...]` indexing
survives in only **18 sites across 4 files** (`exits.js`, `world.js`, `plugins/voidwalking`, one
`models/temp` script).

**The runtime shape does not change.** `world.zones` still presents an exits-shaped view, merged
at boot from `zone_edges` — the identical mechanism `zone_exit_overrides` already uses
([world.js:321-334](../../server/engine/world.js)). **No hot path gains a query.** This is the
read-tier constraint in [architecture.md](../architecture.md) satisfied by construction, not by
promise.

---

## 6. Locks

The auto-minted `keycard_<door.id>` item **is deleted as a mechanism**. It simultaneously
manufactures stray items and anchors a door id to a player's pocket, and the prod census says it
costs nothing to remove: **0 keycard items in the catalog, 0 held, 0 already orphaned**, across
198 doors / 9 players / 333 inventory rows. Re-run `scripts/keycard-census.mjs` immediately
before cutover to confirm it is still zero.

### 6.1 The runtime lock row

```sql
CREATE TABLE IF NOT EXISTS connection_locks (
  connection_id TEXT PRIMARY KEY,   -- the AUTHORED id. A zone_edges rebuild cannot reach this.
  side_a        JSONB NOT NULL DEFAULT '{}',
  side_b        JSONB NOT NULL DEFAULT '{}',
  installed_by  TEXT,
  installed_at  BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
);
```

Classed `runtime`. Keyed by the authored connection id **by construction, not by care** — a
`TRUNCATE zone_edges` cannot orphan it because it does not reference `zone_edges` at all.

Each side:

```jsonc
{ "open": false, "locked": true, "hp": 120,
  "access": ["player:p_cyd", "corp:corp_voltage", "org:ascendant", "item:item_voltage_vip_band"] }
```

**Per-side access lists mean one-way locks fall out with no extra machinery**: a door that opens
freely from inside and demands credentials from outside is an empty `access` on one side.

### 6.2 Typed principals

| principal | meaning | resolves via | queries |
|---|---|---|---|
| `player:` | one specific person | array test against `player.id` | **0** |
| `corp:` | the whole roster, one line | `getPlayerMembership()` → `world.orgMembers`, boot-loaded with a `reloadOrg()` write funnel ([world.js:657-700](../../server/engine/world.js)) | **0** |
| `org:` *(membership)* | NPC ideologies are `orgs` rows with `is_npc=1` | same Map | **0** |
| `org:` *(standing)* | reputation threshold | `player_ideology_rep`, uncached | **1** |
| `item:` | bearer key — stealable, sellable, losable | `player_inventory`, uncached | **1** |

**Two principals cost a query and both cost exactly one query today.** `keycardlock`'s `authFn`
already runs `SELECT 1 FROM player_inventory` ([doors/index.js:53-60](../../plugins/doors/index.js))
and `longwatch`'s already runs `SELECT reputation FROM player_ideology_rep` (`:81-88`). So this
is **neutral-to-better on the hot path** — it converts two principals from a query into a memory
test and leaves the other two where they are.

**Evaluate zero-query principals first and short-circuit.** Most locks will be `player:` +
`corp:` only, so the common case becomes zero queries where today it is one. That ordering is
the lever; caching is not.

**Do not cache `player_inventory`.** It fails the cache-safety test in
[architecture.md](../architecture.md#read-tiers-where-data-lives-at-runtime) — writers are
scattered across the codebase and a stale inventory cache is strictly worse than a round trip.
If reputation ever becomes hot, cache `player_ideology_rep` specifically; `ideologies.js` owns
all four write sites, so it has a funnel-able writer set.

**`corp:`/`org:` is the reason this design does not rot.** A corp HQ is one line, not thirty, and
roster churn never touches the lock — which is exactly what a naive list-of-player-ids would get
wrong.

### 6.3 `getDoorForEdge(from, to)`

Returns the fixture **plus the side you are approaching from**, in one call. The both-sides
dance disappears from nine call sites, and **the 57-orphan bug becomes inexpressible** — one
fixture per connection means there is no far side to forget.

> **Live bug, independent of this work:** [describe.js:381](../../server/engine/commands/describe.js)
> and `:766` call `getDoorForExit(zone.id, p.direction)` with no far-side fallback, unlike
> [movement.js:397](../../server/engine/commands/movement.js). **57 doors read as open exits in
> `look` and then block on move.** This spec makes it unexpressible, but that is months out —
> fix it directly, now, in the current model.

### 6.4 Two costs, recorded so nobody rediscovers them

- **The reverse query gets worse.** *"Which doors can this player open?"* becomes a scan instead
  of an indexed lookup. At **198 doors held in memory** that is a filter over a few hundred
  entries and nothing asks it on a hot path. It stops being fine around **10⁴ locks**; the fix
  then is a boot-built reverse index (`principal → Set<connection_id>`, rebuilt by the same
  funnel that writes the lock) — in-memory, not a schema change.
- **The access list has no FK.** A deleted player leaves a dead `player:p_x` entry that never
  matches again. Harmless, accretes slowly, same shape as the orphans `content:dangling` already
  reports. A periodic sweep, not a constraint.

---

## 7. The derive module

`scripts/content/derive.mjs`. **The single most important contract in this spec.**

```js
/**
 * @param {object} input  plain parsed content. NO DB HANDLE. NO fs. NO clock. NO RNG.
 * @returns {{ render: Map<string, RenderRow>, edges: EdgeRow[], index: object }}
 */
export function deriveWorld({ zones, maps, regions, connections, palette }) { … }
```

### 7.1 Purity is enforced at the seam

**The import hands `deriveWorld` nothing but parsed content, and no DB handle is in scope.** A
`query()` added inside derive therefore **throws at build time, in CI, naming the call** — rather
than silently working in dev and producing a value that varies by database.

This is the whole enforcement mechanism and it is deliberately the *only* one. An earlier draft
argued that keeping the map audit DB-free would police derive's purity as a side effect; that is
a non-sequitur, and the audit now reads the DB precisely because auditing your own arithmetic
proves nothing (§8, redesign §17.1). One mechanism per job.

### 7.2 Determinism

A pure function of `(zones, maps, regions, connections, palette)`: no clock, no `Math.random`,
no environment reads, sorted iteration, and no dependence on which rows the upsert happened to
touch. **Whole-map, never incremental** — `roadConnector`, the sewer art, the Curtain run and
region membership all need adjacency, and a whole-map pass makes them trivially correct at no
cost.

**These conventions already exist in the tree and should simply be codified.**
`wildlands-expand.mjs:49-52` uses a sin-hash instead of `Math.random` so re-runs are identical;
`:34` and `build-sewer-grid.mjs:18` pin a fixed `updated_at` so re-runs produce no churn;
`build-sewer-grid.mjs:155-159` already re-derives its box-drawing markers from final
connectivity. Lift these into derive rather than reinventing them.

### 7.3 Function list

| function | in | out | notes |
|---|---|---|---|
| `resolveTerrain(zone, palette)` | tile | terrain key | `flags.terrain` wins; palette `default` otherwise. **Authored and dual-purpose — stays that way** (redesign §5.4). |
| `resolveDefault(key, zone, region, palette)` | — | value | The defaults-and-overrides primitive (§1.3). Order: tile override → region `defaults` → palette → global. **Build this first**; everything else calls it. |
| `deriveMarker(zone, ctx)` | tile + neighbours | string\|null | Four cases, see §7.4. |
| `deriveIcon(zone, ctx)` | tile | string\|null | **Derived only.** Nothing may read it as game logic. |
| `deriveColors(zone, palette)` | tile | `{color, bg_color}` | override → palette. |
| `deriveAutoTile(zone, ctx)` | tile + neighbours | `{n,e,s,w}` | only when the palette entry sets `auto_tile`. |
| `buildRenderSpec(...)` | all of the above | `spec` JSONB | §2.3. The only renderer channel. |
| `projectEdges(zones, connections)` | world | `EdgeRow[]` | §7.5. |
| `buildIndex(zones)` | world | index object | §2.4. |

### 7.4 `deriveMarker` — the four jobs, separated

`zones.marker` was doing four unrelated jobs (redesign §5.3). After the split it means exactly
one thing: *a human overrode this tile's map code.*

| job | tiles | after |
|---|---|---|
| building acronym | 61 | **authored override**, derived by default from `building_name` |
| apartment floor designation | 116 | **derived** — MARK-3 already computes it exactly |
| sewer corridor art (`║ ╠ ╬ ╝`) | 117 | **derived** — `build-sewer-grid.mjs:155-159` already does this |
| terrain glyph | ~800 | **derived** from the palette |

The building-acronym derivation is the shipped `twoLetterAbbrev()`/`nameDerivedMarkers()` logic
in `.claude/skills/map-audit/scripts/audit-map.mjs` — **move it into derive and have the audit
import it**, do not copy it. Because the build sees all 61 codes at once it can disambiguate
derived collisions deterministically and **fail the build** on colliding *authored* ones.

In the Studio the derived code shows **greyed out as a preview**; typing over it writes the
override into the file. That is the whole defaults-and-overrides UX, and `audio_theme_id` (§1.3)
is the same interaction with nothing derived in the middle — which is why it is the one to
build first.

### 7.5 `projectEdges`

```
for each zone, for each grid-adjacent walkable neighbour on the same map:
    emit (from, dir, to, connection_id=null, kind='grid')
for each connection file:
    emit (a, dir, b, connection_id=id, kind='authored'|'portal')
    unless one_way: emit (b, opposite(dir), a, …)
authored edges OVERRIDE grid edges on the same (from, dir) key.
```

**Adjacency never implies passability on its own** — the existing rule, preserved. A grid edge is
emitted only where the terrain and flags say the step is walkable; the palette and the
standability rules decide, not proximity.

**Lint check (redesign §8.2): the undeclared one-way.** A geometry pair that projects in one
direction only, with no connection file saying `one_way`, is an error — that is a warp the map
cannot draw and nobody chose.

---

## 8. The audit reads the resolved DB

**This is in step 2's scope and is not optional.**

After this redesign, half the facts the rules test are **derived and absent from `content/`
entirely**. An unchanged files-only audit would not merely miss them — it would keep reporting
green while looking at a world that no longer exists on disk.

### 8.1 The port is cheaper than it sounds

**No audit rule keys on a filename.** `__file` is used only to write fixes and print paths; the
pk↔filename check lives in `lint.mjs:80`, not the audit. **Rule bodies move over unchanged** —
only the loader changes.

**And the tool already reached this conclusion for one field.** `audit-map.mjs:40-47` imports
`zoneTerrain` from `server/engine/world.js` rather than mirroring its inference chain, with the
comment that mirroring *"would drift the moment someone adds a fallback to it — and an unnoticed
fallback is the entire defect this rule exists to catch."* That is the argument for reading the
resolved world, already written into the tool. Note also that `world.js:1` imports `db.js`, whose
line 42 constructs a Pool at module load — so the audit's "no DB" property was already only "no
queries issued."

### 8.2 Fixers: read-resolved, write-authored

The audit reads the DB; its fixers write **content files** via `writeEntity()`
(`audit-map.mjs:362-365`, `canonicalJson`). Effects of the port:

- **Four fixers become impossible and are deleted:** `setWez`, `setIsBuilding`, `clearMarker`,
  `setMarker` — their fields become derived, and you cannot hand-fix a value nothing authors.
  This is redesign §15's "impossible rather than fixed" showing up as code removal.
- **Two retarget** to `content/connections/`.
- **One is unchanged.**

**Fixers must be hard-disabled against a remote host** — not defaulted off. A fixer writing files
from a prod read produces a diff nobody authored.

### 8.3 The staleness guard is a hard stop

New failure mode created by this port: **the audit reports green against a stale local DB.**

`content:import` writes `server_settings['content_pipeline.last_imported_sha']` as the last step
of its transaction (`import.mjs:324-326`). The audit compares it to `git rev-parse HEAD` and
**refuses to run** on a mismatch, with `--allow-stale` as the deliberate override. On a fresh
clone with no marker it says *"import first"* rather than a confusing sha mismatch — the
deletion pass's skip-loudly-on-missing at `import.mjs:240-243` is the precedent to copy.

### 8.4 Two latencies, both labelled

The Studio wants to run the audit inline as you paint, but a DB-reading audit cannot see unsaved
edits. Rather than paper over that, split by what the audit can actually know:

- **authored-half rules** run **live**, against the Studio's working document;
- **derived-half rules** arrive **after an import**, as a dated second layer.

Two indicators, both honest, instead of one that quietly lies about freshness.

### 8.5 Prod auditing

Works with `--env-file` alone: six `SELECT`s, read-only by construction. Two conditions —
**approval per run**, and **fixers hard-disabled** as in §8.2.

---

## 9. The build step

`content:import` gains one step, after the upsert pass, inside the same transaction:

```
0. SCHEMA_SQL                        (unchanged)
BEGIN; SET CONSTRAINTS ALL DEFERRED
1. deletion pass (git-diff driven)   (unchanged)
2. upsert pass (registry order)      (unchanged)
3. DERIVE:  read the committed zones + regions + palette + connections
            → TRUNCATE zone_render;  INSERT the derived set
            → TRUNCATE zone_edges;   INSERT the projected graph
            → write content/map/index.json
COMMIT
```

**Deploy safety is free.** The pass writes only generated tables, never `zones` — so the drift
report and the git-diff deletion pass need no changes at all. Both tables are `runtime`, so
`content:export` never emits them. CI already runs `content:lint → content:import →
test:regress` against a **throwaway local Postgres**
([deploy-content.yml:92-97](../../.github/workflows/deploy-content.yml)), so derive runs on every
push at **zero Neon egress**.

**Hot-fix staleness.** A one-shot against prod that changes a tile's terrain leaves the generated
tables stale until the next deploy. **Expose `npm run map:derive` for one-shots to call.**
Rejected: accepting the staleness silently, and making `reloadZone` re-derive in memory (which
reintroduces runtime derivation, the thing this removes).

**Regress assertions to add** — each one pins a claim this spec makes:

1. Every `zones` row has a `zone_render` row after import.
2. `deriveWorld` called twice on the same input produces byte-identical output.
3. No `content/zones/*.json` carries `exits` or `flags.icon`.
4. Every `flags.terrain` value resolves in the palette.
5. The game renderer and the Studio renderer produce the same output for the same `spec` — the
   assertion that keeps two tools from drifting.

---

## 10. The Studio

**Not a live-DB tool.** It reads and writes `content/` directly, served locally the way
`tools/zone-planner/serve.mjs` already is, importing the *same* derive module the build uses —
so the preview **is** the ship.

It owns **all authored per-tile data**, including game-facing fields, and replaces: the dev-panel
Maps panel entirely (terrain painter, brushes, paint-into-existence, Move Building, New Building,
region planner), the Zones panel's per-zone flag and column editing, and `tools/zone-planner/`
entirely.

**The dev panel keeps** everything live-DB: player admin, weather and power ops, live spawns, ATM
cash, gametables, the crime log, live overlays — the whole prod ops console. **Its map view
becomes read-only for geometry and must say so on screen**, because "someone paints in the Studio
and wonders why the dev panel's map is stale" is the predictable failure.

### 10.1 The scope rule

**The Studio edits tiles and the connections between them. It does not create entities that
merely happen to be referenced by tiles.** Creating a loot table or an audio theme stays in the
dev panel / design-cli. The Studio's job ends at *"this tile points at that table"* — with a
picker from `refTable` (§3.1) and an inline complaint when a reference does not resolve, rather
than silently accepting a dead string.

### 10.2 Building placement writes only files

> **BUILT — `scripts/place-building.mjs` (`5b0da2fc`).** The proof is done and the section
> below is the reasoning that produced it, kept because the next reader needs the argument,
> not just the file. What changed against this section's expectations:
>
> - The `query`-shaped sink is real: [`tools/lib/content-store.mjs`](../../tools/lib/content-store.mjs)
>   knows a **closed** statement set and **throws, naming the SQL**, on anything else, so a
>   blueprint whose SQL is edited fails at author time instead of writing a wrong file.
>   `authorUtilityRoom` runs against it unmodified.
> - **The audit graded the output and found four defects, all now fixed at the source:**
>   BLD-1 (a converted ground tile keeps exits to every walkable neighbour — now replaced,
>   and inbound links from non-entrance tiles are sealed), DIR-1 (the facade→interior link
>   must be the cardinal opposite the entrance, not `in`), MARK-2 (nothing derives a marker
>   any more, so the placer must stamp one), DOOR-1 (a front door, on the facade pointing
>   inward — 52 of the 56 facade-anchored doors in `content/` are that shape).
> - **`nearestCityPlant` needed no decision after all.** It reads `generators` +
>   `zones`, both content tables, so it resolves against the file tree like everything
>   else. The open item below is withdrawn.
> - **`installRegionPlant` is the one thing that genuinely cannot move.** It repoints
>   existing buildings across a region — an operation on a running world, not an authored
>   fact. It stays in the dev panel and the CLI prints a pointer to it.
> - Determinism cost one engine fix: `pickClothingForPersonality` used `Math.random()`, so
>   every re-run produced a different outfit. It now takes an optional seed; live NPC
>   creation passes none and keeps the variety.

This is the step-2 **proof**, and the spike (redesign §16.1) turned it from a risk into a
straightforward port:

- `apiBuildBuilding` has **no transaction** — ~15 bare `query()` calls, so a mid-way failure
  already leaves a half-built building committed and live. **A git commit is strictly more
  atomic than what ships today.**
- Its six tables are **four content tables** (`zones`, `maps`, `furniture`, `generators`,
  `npcs`), **one that becomes derived** (the neighbour `exits` update → `zone_edges`), and **one
  that is runtime and already recomputed at boot** (`lighting_states`, power load).
- `POST /maps/build-building` syncs **zero** content files today — `contentTargetFor` resolves
  one entity per request and this route matches no arm. Same for `move-building`,
  `generate-region`, `move-region`, `link-interior`. **The dev panel cannot ship a building at
  all.**

So the port is: run the existing `templateForType` / `authorUtilityRoom` blueprints as a CLI that
emits files. `authorUtilityRoom` already takes `query` as its first parameter, so it is one
substitution away from writing through a different sink.

~~**One genuine open item:** `nearestCityPlant(query, gx, gy)`~~ — **withdrawn.** It reads
`generators` + `zones`, both content tables, so the file sink answers it exactly as a database
would. Nothing about it is a live-world read.

**The dev-panel builder's defect list, and where each one landed.** Two were fixed in
`2b6d0680` while spiking: it never authored `flags.entrance` (born failing BLD-9) and its
`backDir` fallback pointed opposite the door against 61-of-61 shipped buildings (DIR-2). Three
more surfaced when the audit graded the CLI's output, and all three are in the route too:

| | the route | the CLI |
|---|---|---|
| BLD-1 | gives *every* standable neighbour a reciprocal exit in ([routes.js:860-868](../../server/api/routes.js)) — walk-through-wall by construction | replaces the facade's exits with the entrance street + interior link, and seals inbound links from every other tile |
| DIR-1 | writes `in` for the facade→interior link, which draws no way-out arrow | writes the cardinal opposite the entrance |
| MARK-2 | sets `marker=NULL`, and nothing derives one since `36f1b8f3`, so the building draws no letters | stamps the derived acronym, avoiding codes already worn |

**The route is not being fixed.** It is the thing this pipeline replaces (§10), and patching a
writer that ships nothing — `POST /maps/build-building` syncs zero content files — buys a
correctness the world never sees. The answer to "fix the builder or make it unexpressible"
(recorded here as an open decision) is **unexpressible**: the CLI's placement model has no way
to say "this building has five doors", and when the Studio takes over the panel's Maps tab the
route goes with it. Until then the route stays as-is and the audit's BLD-1 fixer keeps cleaning
up after it.

---

## 11. Implementation order

Each step is shippable on its own and leaves the tree green. **Do not batch them** — the whole
point of the migration shape (redesign §14) is no flag day.

1. **`resolveDefault` + `regions.defaults` + `audio_theme_id`.** The smallest end-to-end slice of
   the defaults-and-overrides mechanism, with **nothing derived in the middle** — authored
   default → resolved value → Studio shows the inherited value greyed → typing writes an
   override. Two authored values replace 5,785 nulls. Get this right and every presentation case
   is the same shape with a derivation inserted.
2. **The field catalog extensions** (§3). Pure addition, no data migration, immediately useful to
   the dev panel as well.
3. **`content/map/terrain.json` + `zone_render` + the derive module** for colours, glyph and
   `ambient_theme`. Delete `TERRAIN_FILL`, `TOS_TERRAIN_FILL`, `TERRAIN_TYPES`.
4. **`deriveMarker`** (§7.4), importing the shipped `twoLetterAbbrev` logic rather than copying
   it.
5. **The audit port** (§8). Do it here, not later — from step 3 onward the files-only audit is
   reporting on a world that no longer exists.
6. **`zone_edges` + `content/connections/`** (§1.4, §7.5), with `exits` still authored in
   parallel and a regress assertion that the two agree. Cut over only when they do.
7. **Locks** (§6) once connections carry stable ids.
8. **The Studio**, incrementally, against whatever of the above has landed.
9. **The id rename** (§4, redesign §7.6) — last, alone, and rehearsed against a prod snapshot on
   a Neon predeploy branch.

---

## 12. What this makes impossible

The test of the design is not what it improves but what it stops being expressible. Recorded so
the next audit rule that *cannot* be written is understood as a win:

- **A renderer inventing a marker** — there is no code path from a name to a drawn glyph outside
  derive.
- **Two renderers disagreeing** — one `spec`, one channel, one regress assertion.
- **A door open in `look` and locked on move** — one fixture per connection, no far side.
- **A lock's grant evaporating on a rebuild** — the lock is keyed by an authored id that nothing
  regenerates.
- **A stray auto-minted keycard** — the minter is gone; `item:` keeps the bearer-key pattern.
- **Terrain paint relocating a door** — `entrance` is authored, and after `2b6d0680` the builder
  authors it too.
- **A derived value drifting from what ships** — the audit reads the resolved world, and derive
  cannot reach a database to make it vary.
