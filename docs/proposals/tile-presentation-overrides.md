# Tile Presentation Overrides — giving the per-tile override back its rung

**Status: BUILT 2026-08-01.** The body below is the design as approved; deltas from it
are recorded in *As built* at the foot of this doc. Read those before trusting a number
in the body — the migration's warranty changed shape once it was run.

**Supersedes:** the `authored_bg_wins` palette key ([map-pipeline-spec.md §1.2](map-pipeline-spec.md))
· **Touches:** `scripts/content/derive.mjs`, `content/map/terrain.json`, `content/zones/*.json`,
`client/shared/tagCatalog.js`, `tools/studio/studio.js`

## The complaint

The Studio inspector offers three fields under **Zone: Presentation** — Map Marker, Marker Colour,
Tile Colour — each described in the field catalog as *"An OVERRIDE of the terrain palette"*
([tagCatalog.js:735-740](../../client/shared/tagCatalog.js:735)). For two of the three that
sentence is false, and for the third the value is dropped by a separate rule. An author types a
value, it saves, it lints clean, it ships to prod, and it never reaches a pixel.

Measured over all 5,841 files in `content/zones/` by running `deriveColors` / `deriveLabel`
directly:

| field | authored on | **discarded** | reaches the map |
|---|---|---|---|
| `marker` | 1,146 | **860** | 286 |
| `color` | 5,109 | **150** | 4,959 |
| `bg_color` | 5,335 | **3,484** | 1,851 |

Discarded `bg_color` by resolved terrain: redrock 2,982 · road 118 · marsh 101 · sand 95 ·
scrub 70 · ash 44 · dirt_road 32 · asphalt 23 · concrete 10 · park 9.

## Why each one is discarded

**`bg_color`** — [`deriveColors`](../../scripts/content/derive.mjs:176) asks the palette first and
only consults the tile through an exception:

```js
const bg = entry
  ? ((entry.authored_bg_wins && zone?.bg_color) ? zone.bg_color : (entry.fill ?? null))
  : (zone?.bg_color ?? null);
```

`authored_bg_wins` is true on three terrains — grass, water, underwater. On the other 13 the
authored value is read and thrown away.

**`color`** — same function, `entry?.text ?? zone?.color ?? contrastText(bg)`. The palette's `text`
is non-null only on the road terrains, which is exactly the 150.

**`marker`** — not a precedence problem. [`deriveMarker`](../../scripts/content/derive.mjs:323)
honours the authored value correctly as rung 1; it is
[`deriveLabel`](../../scripts/content/derive.mjs:573) that drops it:

```js
if (resolveTerrain(zone)) return null;   // painted ground never carries a label
```

## The diagnosis: three guardrails, one cause

Each of those rules was correct when it landed, and each is defending against the same thing.

The override columns were **bulk-populated by pre-terrain tooling**. `bg_color` carries `#2a1c16` on
3,231 redrock tiles — a room-ambience brown that would black out the map if honoured. `marker`
carries a decorative texture on 860 tiles (`#` on grass ×363, `≈` on water ×256, road hatching ×111)
which, drawn, letters the grasslands `# # # #`. `color` carries road-marking colours on 111 road
tiles that fight the palette's own markings.

Derive cannot tell that bulk fill from a deliberate override, **because the data does not say**. So
each field grew a rule that suppresses the column wholesale. Every one of those rules is doing the
job of a data cleanup, and each now stands precisely where the deliberate override belongs.

That is the whole defect. The UI is honest about the intent and the pipeline is defending against
the data, and an author sits between the two.

### The clean argument for the migration

**Anything currently discarded cannot be a deliberate override, because no author has ever seen one
work.** Every one of the 3,484 fills, 860 markers and 150 marker colours has been inert for the
whole life of the derive pass. There is no authorship to preserve, so clearing them destroys
nothing — and once cleared, the guardrails have nothing left to guard.

The 1,851 fills and 286 markers that *do* render are untouched: they are the working set, and they
stay exactly as they are.

### A related correction

`bg_color` is sometimes described as also carrying "the room's colour identity". It does not carry a
second job in any live sense — **no renderer reads `zones.bg_color`.** Every consumer colours from
`spec.fill` ([minimap.js:727](../../client/game/js/panels/minimap.js:727),
[tablet-os.js:6659](../../client/game/js/panels/tablet-os.js:6659)); the column survives in the zone
payload only as a tooltip value and a fallback for transient zones, which have no derived row
([world.js:1151](../../server/engine/world.js:1151)). The redrock browns are stale data, not a second
meaning.

## The design

### 1. Terrain keeps everything it has

This proposal touches presentation only. `flags.terrain` remains the ground-surface SSOT and keeps
supplying the fill and glyph **defaults**, the gameplay `props` block (`swimmable`, `speed_mult`,
`routable`, `frontage`…), ambience and pacing. Overriding a tile's look must never change what
terrain it is — that is the point of the split, and it is what makes the override safe to widen.

### 2. Authored beats derived, on all three channels

```js
// deriveColors
const bg    = zone?.bg_color ?? entry?.fill ?? null;
const color = zone?.color ?? entry?.text ?? contrastText(bg);

// deriveLabel — the terrain test goes; the building-tile rules stay
const text = deriveMarker(zone, palette, ctx);
if (!text) return null;
```

`authored_bg_wins` is deleted from `terrain.json` and from `deriveColors`, and the exception list
stops existing. This is the same shape `flags.icon` already has as rung 1 of `deriveFeature`, and
the same shape `marker` already has inside `deriveMarker` — two of the four override seams behave
this way today, which is why the other two read as broken.

Nullable columns are adequate here: there is no need to express "explicitly no fill", so the
absent-versus-null hole `resolveDefault` documents does not bite. No new flags, no new columns.

### 3. Decorative texture goes away

Clearing 860 markers removes the only expression of "grass looks stippled" the world has, and that
is **agreed and intended** — bare painted ground is the shipped look and stays the shipped look. The
860 are deleted outright, not migrated.

If the texture idea ever returns it belongs one level up, not back on the tile: the palette already
has a **`glyph` slot on every terrain, currently `null` on all 16**
([terrain.json](../../content/map/terrain.json)), and `deriveMarker`'s last rung already reads it.
That leaves a clean split, which is what the cleanup buys:

- **palette `glyph`** = what this *terrain* looks like — one decision, applied everywhere
- **`zones.marker`** = what this *tile* is — a deliberate, per-instance symbol

Nothing in this proposal fills in a palette glyph.

### 4. The Studio states the rung

Colour and marker get the provenance line the feature rung already has (*pinned by hand* /
*derived from this building's type* / *auto-tiled from the lanes beside it*). After the flip an
override always wins, so the line is short — but it is what stops a discarded value ever again
looking identical to a live one. The two wrong help strings in
[tagCatalog.js:737-740](../../client/shared/tagCatalog.js:737) become true and stay checked.

### 5. Retire the green-background terrain inference

[`resolveTerrain`](../../scripts/content/derive.mjs:52) infers `grass` from a green-dominant
`bg_color`:

```js
if (g > r && g - b >= 15 && g >= 45) return 'grass';
```

**42 tiles** resolve their terrain this way and no other — no `flags.terrain`, no `pier`, no road
icon. They are mostly interiors whose *wall* colour is sage: `zone_meridian_floor_1/2/3`,
`zone_clone_facility_z-1_…`, 33 of the 42 carrying `#8f9a7e`.

**This is not a live gameplay bug.** The `grass` palette entry has no `props` block, so those tiles
resolve to `PROP_DEFAULTS` — identical to an unpainted tile. What it costs today is presentation and
labelling: they take the grass `minimap_class`, they can never carry a map label (`deriveLabel`
returns null for any tile with a terrain), and they classify as `parkland` to the flight renderer
([biomes.js:31](../../plugins/flight/biomes.js:31)) — the Meridian's interior floors read as
parkland from the air.

The hazard is latent and becomes reachable under this design. `flags.terrain` is the SSOT
`resolveProps` reads; grass has simply not been given a props block yet. Give it one — soft ground
at `speed_mult: 0.9`, say — and 42 rooms inherit it without any content file having said "grass".
And today the rung sits still because `bg_color` is a near-dead column nobody turns; after the flip
it is a knob the Studio invites you to turn, so a mapmaker tinting a room green would silently
reclassify the tile.

**Cosmetics should read from terrain and never write back to it.** Backfill the 42 into explicit
`flags.terrain` and delete the rung in the same pass. (The other legacy rungs — `flags.pier`, the
`road_`/`runway_` icon prefixes — read flags, not presentation, and are unaffected.)

## Migration

One-shot script under `scripts/content/`, run against the content tree, reviewed as a git diff, in
this order:

1. **Backfill** `flags.terrain` on every tile currently resolving via the green-bg inference, then
   delete that rung.
2. **Clear** `bg_color` where `deriveColors` discards it (3,484), `color` where it discards it (150),
   `marker` where `deriveLabel` drops it (860). All three columns are already `omitWhenNull`, so the
   keys leave the files rather than becoming `null` — [content:lint](../../scripts/content/lint.mjs)
   errors on a null override.
3. **Flip** the three precedence rules and delete `authored_bg_wins` from `terrain.json` and
   `deriveColors`.

### Verification

Derive output must be **byte-identical on all 5,841 tiles across steps 2–3** — that is the whole
claim, and it is mechanically checkable the way the original repaint was
([map-pipeline-spec.md §1.2](map-pipeline-spec.md): *0 fill differences, 0 text differences, 0
terrain-class differences*). Snapshot `deriveWorld` before step 1, again after step 3, and diff.
A non-empty diff means a value was cleared that was in fact rendering, and the run is wrong.

Step 1 is the exception and must be diffed separately: it changes `resolveTerrain` output by design,
so its expected delta is *"these N tiles now say in a flag what they used to say in a colour"* and
nothing else.

`npm run test:regress` covers the derive determinism and order-independence laws
([regress.js:2450](../../tests/regress.js:2450)) and the marker laws; `npm run shapes:smoke` is
unaffected.

## What this does not do

- **It does not widen what an override can say.** Three existing fields, same shapes, same catalog.
  A per-tile glyph beyond two characters, per-tile art, or a per-tile palette entry are all
  out of scope.
- **It does not touch the district or region layers.** See
  [land-taxonomy.md](../reference/land-taxonomy.md).
- **It does not fill in a single palette glyph.** §3 makes the slot the right place; using it is a
  separate call.

## As built

Shipped as designed, with five deltas worth knowing.

**1. The warranty was not zero delta. It was 24 tiles, and they were a bug being fixed.**
The design promised byte-identical derive output. What shipped is: **0 spec differences on
5,817 tiles, 24 spec differences, and an identical edge graph** (21,265 edges). The 24 are
Meridian apartment units, and every one of them GAINED the floor designation it should
always have had. They resolved to `grass` from the green-background inference, and the old
"painted ground carries no label" rule was suppressing their labels for that reason alone.
**95 of 119 apartment tiles carried a label before; 119 of 119 do now.** The 24 were the
only apartments in the world missing theirs. Fill, glyph colour and minimap class are
untouched on all 24.

A second, invisible delta: 836 rows changed their `marker` passthrough to null. That column
is not rendered by anything (`spec.label` is), so it moves no pixel.

**2. `color` and `bg_color` joined `omitWhenNull`.** Not in the design, and required: with
the keys cleared from 3,634 files, the next `content:export` would have written
`"bg_color": null` straight back into every one of them. They are overrides now, so they
belong on that list beside `marker` and `audio_theme_id`
([content-registry.js](../../server/models/content-registry.js)). 729 files were already
spelling out an explicit null and were swept by the existing
[strip-null-overrides.mjs](../../scripts/content/strip-null-overrides.mjs).

**3. Two regress laws were NARROWED, not deleted.** `painted ground carries no label` and
`an auto-tiled road wears no label` both encoded the rule this change removes. Deleting
them would have given up something real, because the accident they were catching is still
an accident: a *derived* code (building acronym, apartment floor, sewer art) landing on
painted ground still means a building got painted as a surface. They now read **a label on
painted ground is authored, never derived** and **an auto-tiled road derives no label** —
the human's two characters are permitted, the accident is not. Four new laws assert the
flipped precedence directly, on synthetic tiles rather than found ones so they cannot
silently pass when the world stops containing an example.

**4. The one-shot must freeze its own rules, and the first run proved it.** The script read
`entry.authored_bg_wins` live from `terrain.json` — the same file the commit deletes the key
from. Run after that edit, `!entry.authored_bg_wins` was true for every terrain and the pass
cleared **1,374 fills that were rendering perfectly well**, on exactly the water and grass
tiles the exception existed to protect. Caught by the snapshot diff, repaired by restoring
the three columns from HEAD and re-running. The exception list is a frozen literal now, and
the rule is written at the top of the script: **nothing in a one-shot may read a file the
same commit edits.**

**5. It runs on a branch whose gate is already red.** `content:lint` reports 11 problems and
`node tests/regress.js` 28 failures — both identical at HEAD (map anchors, `zone_edges`
drift, doors), so this change adds none and fixes none of them. Because `content:lint` is a
`pretest:regress` hook, `npm run test:regress` cannot run here at all; the suite was run
directly. Note that regress derives from the **DB**, which still holds the pre-cleanup
markers until `content:import` runs — the narrowed laws in delta 3 were written to hold in
both states, and do.

## The hole the warranty left — water, grass, underwater (BUILT 2026-08-01)

Delta 4 above is the whole story of this section: the one-shot spared 1,374 fills on
grass/water/underwater because those fills were *rendering*, and a value the map is currently
drawing cannot be cleared by a migration whose warranty is zero pixels. Correct — and it left
those 1,374 tiles as the tiles where **the terrain painter did nothing you could see.** Once
authored beat the palette everywhere, a tile's own fill answered before the terrain did.

Reported from the Studio's Terrain dropdown, which is where it bites hardest: selecting a new
terrain rewrote `flags.terrain` and therefore swimmability, GPS routing, movement pacing and the
minimap class, while the tile sat there looking identical. The brush had the same symptom — paint
sand across the bay and nothing moved. A knob that silently governs gameplay and visibly governs
nothing is worse than no knob. It is not a save or refresh bug: the canvas repaints correctly the
moment the fill actually changes, and the inspector's `painted:` line was reporting it honestly as
`fill #1d3b52 (yours)` the whole time.

**The fix is the palette file's own argument, applied a second time: the value players see is the
canonical one.** Every water tile in the world draws `#1d3b52` or a deliberate variant; not one has
ever drawn the palette's `#3f7fb0`. The palette was wrong about what water looks like, so the
palette moved:

| terrain | was | now | why |
|---|---|---|---|
| `water` | `#3f7fb0` | `#1d3b52` | 605 of 863 tiles, the open basin |
| `grass` | `#5a9e57` | `#2f3a26` | 363 of 429 tiles |
| `underwater` | `#3f7fb0` | `#14283a` | 70 of 82 tiles — depth, seen from above |

[tile-fill-to-palette.mjs](../../scripts/content/tile-fill-to-palette.mjs) then cleared `bg_color`
from the **1,038 tiles whose fill is exactly the value their terrain now states** — those are not
overrides of anything, they are the default written out longhand in a thousand places. **336 tiles
kept theirs** (258 water on a second blue, 66 grass on a paler strand, 12 deeper underwater): a
colour that differs from its terrain on purpose is what the column is *for*. Those tiles are still
fill-locked against the painter, which is now a decision somebody made rather than a rule nobody
could see.

**Warranty, and this time it held exactly: 0 spec differences across all 5,841 tiles** — full
render specs diffed before and after, not just fills. Zero by construction, since no tile on those
three terrains lacked a `bg_color` for the new palette value to newly reach.

Deliberately not folded in: **`color`, on every tile.** The glyph colours are real authorship and
they do not agree within a terrain — the same 605-tile fill carries *two* different glyph colours
(`#3f7fb0` and `#7fd3ff`) — so there is no single palette value to promote. `text` stays null for
all three and the renderer keeps picking by luminance where a tile says nothing. This is open
question 2 again, and the answer is the same: a deliberate variation should become a terrain, not a
palette entry that flattens it.

Also here: the Studio's terrain **dropdown** writes through `PUT /api/zone`, which does not carry
the guard `POST /api/paint` has against painting terrain onto a building facade
([serve.mjs:1075](../../tools/studio/serve.mjs:1075)). The brush refuses; the dropdown does the
silently-destructive thing. Not fixed here — noted so it is not rediscovered as a mystery.

## Open questions

1. **Should step 2 clear, or archive?** Clearing is a one-way git-reviewable diff. The alternative —
   moving the values to a `flags.legacy_bg` — keeps them readable but reintroduces exactly the kind
   of write-only provenance field [land-taxonomy.md](../reference/land-taxonomy.md#provenance--deleted-not-moved)
   says not to reintroduce. Recommendation: clear.
2. **Do the 111 road marker-colours want to survive as palette `text`?** They are close to the
   palette's own `#f2c53d` but not equal. If any of them is a deliberate variation it should be
   promoted to a terrain, not kept per-tile.
