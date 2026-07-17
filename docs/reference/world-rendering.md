# World Rendering (flight-sim 3D) — how the cockpit draws the world

This is the **implementation** map for the out-the-canopy 3D view: how a tile in the
DB becomes an extruded building on screen, where each kind of structure is drawn, and
how to add or edit one. It complements [Rendering_Implementation.md](Rendering_Implementation.md)
(the design *goals*) and [../systems-flight.md](../systems-flight.md) (flight mechanics).

**Read this before editing anything you see out the cockpit window** — especially before
"improving a model", because the same real-world object (e.g. an airport control tower)
can be drawn by more than one renderer depending on the view, and it's easy to edit the
wrong one.

## The one rule that would have saved three rounds of confusion

There is **no billboard/sprite system for buildings**. Everything solid you fly around is
**real 3D geometry** — axis-aligned (optionally yawed) boxes extruded and projected through
the Mode-7 camera by `draw3DBoxAt`. The only genuinely flat/billboard art is:

- **Trees & rocks** — `drawTreeBB` / `drawRockBB` (the `BB` suffix = billboard).
- **On-deck airport backdrop** — `drawAirportScenery` / `drawAirportFeature`, a 2D screen-space
  pass that paints distant silhouettes flanking the runway **only while you're parked/rolling**
  (it fades out via `reveal`/`worldBlend` as the real 3D world fades in). It is **not** the
  airport you taxi around, and editing it changes almost nothing a player notices.

If someone says "the tower still looks old", they are looking at the **3D world building**
(below), not the deck backdrop.

## The pipeline: DB tile → screen

All of this is client-side in [`client/game/js/panels/windshield.js`](../../client/game/js/panels/windshield.js)
unless noted.

1. **Server builds the map window.** [`plugins/flight/state.js`](../../plugins/flight/state.js)
   (the surface-window builder, ~radius-24 tile block) turns each nearby zone into a lightweight
   cell. The fields the renderer reads:
   - `biome` — rendering biome (`airport`, `docks`, `citycore`, `water`, …; from `plugins/flight/biomes.js`).
   - `kind` — `'field'` (airfield surface), `'nofly'`, or `'land'`.
   - `bt` — `building_type` flag (drives the **type** model).
   - `bn` — `building_name` flag (drives the **named** model).
   - `ent` — entrance door face (so the model can orient its frontage).
   - `mark` — bespoke standalone landmark channel: `'yacht'` or `'statue'` (drawn by their own
     renderers, independent of `bt`/`bn`).
   - `road`, `sub`, `wake`, `heading`, `icon` — road/water/movement extras.
   - Tile precedence when two zones share a grid tile: yacht > airfield/building > road (see
     `state.js` — a landmark must outrank a road or it gets clobbered).

2. **Client draws the world.** `drawWorldObjects(ctx, cam, v, sky, now, sun)` iterates the
   cells (depth-sorted), and for each building tile (`it.c.bt` present) calls:
   - `modelFor(cell)` → picks a model spec: **`NAMED_MODELS[bn]`** first, else **`TYPE_MODEL[bt]`**,
     else `null`.
   - If a spec exists → `drawTypeModel(...)` renders that dedicated model.
   - If `null` → `drawBuilding(...)` falls back to a biome archetype (generic warehouse/office/etc).
   - Non-building marks are handled earlier in the loop: `mark === 'statue'` → `drawStatue`,
     `mark === 'yacht'` → `drawYacht`, `kind === 'nofly'` → a translucent box, parkland/badlands
     → tree/rock billboards.

3. **`drawTypeModel`** is a big `switch (m.type)`. Each `case` composes a building out of
   `draw3DBoxAt` calls plus decoration helpers. This is where every landmark's look lives
   (`luxtower` = Halcyon Towers, `hangar` = airports, `power`, `clone`, `office`, …).

## The core primitive: `draw3DBoxAt`

```
draw3DBoxAt(ctx, cam, dx, dy, fh, wz0, wz1, biome, seed, night, alpha, roof, yaw)
```

- `dx,dy` tile-space centre; `fh` footprint half-width (clamped ≤ 0.48 so a box stays inside
  its own tile); `wz0..wz1` world-z bottom→top (extrusion height).
- `biome` is a **palette key** into `WALL_COL` (see below), *not* a real biome — that's how a
  box gets its wall/roof texture (`wallTex`/`roofTex`).
- `roof` draws the top quad; `yaw` (rad, optional) **spins the footprint** about its centre.
  Buildings normally omit it; pass it to make an angled/twisting tower (stack several boxes at
  increasing `yaw` — that's how Halcyon Towers spirals) or a heading-aware object (the Echelon).
- Handles near-plane clipping + backface culling internally, so you just describe boxes.

### `drawFacetDrum` — the rounded alternative to a box
`drawFacetDrum(ctx, cam, dx, dy, z0, z1, rb, rt, N, alpha, style, cap)` draws an **N-sided faceted
drum** (cylinder/cone) — use it instead of `draw3DBoxAt` when a tower/tank/terminal shouldn't read as
a blocky box (the airport control-tower shaft + glass cab, and the curved glass terminal). It takes a
`style(f, top, bot)` callback per facet: `f.nl` is the facet's key-light dot (0..1), `f.pts` its
projected corners, `top`/`bot` its screen-y span — so `style` can return a flat shaded colour **or a
procedural `createLinearGradient`** for glass (a vertical sky-reflection sheen with no window grid —
this is how a cab/terminal gets a real glass texture rather than the windowed `wallTex`). Back-facing
facets are culled; `cap` optionally fills the top disc. `drawRing(...)` draws a horizontal band/rail
ring around a drum. `drawBarrelRoof(ctx, cam, F, cxL, hl, hw, wallTop, archH, N, alpha, base)` draws a
**curved half-cylinder roof** (the shed roof a square box can't make) in the building's local frame —
roof panels painted far→near (convex ⇒ exact) plus backface-culled arched gable tympana; drop it on
top of a wall box. For a **non-window surface texture**, add the palette key to a material set in
`wallTex` (see `METAL_WALL` → corrugated ribbed steel for hangars) rather than the default lit-window
curtain wall.

### Decoration helpers (all project through `cam`)
`glowPool` (soft radial ground/roof glow), `blinkLight` (pulsing point light — beacons),
`mast` (antenna line + red tip light), `neonBlade` / `verticalMarquee` / `marqueeBand` (signage),
`drawSmoke`, `dish`, `crossMark`. `F(lx, ly)` (defined per-call in `drawTypeModel`) rotates a
model-local offset into world space using the building's entrance vector `E` — use it to place
sub-parts (a canopy, a wing, a tower) relative to the frontage.

### Palettes
`WALL_COL` maps palette keys → base RGB. Named-building keys are prefixed `ty_` (`ty_lux`,
`ty_atc`, `ty_halcyon`, `ty_office`, `ty_door`, …). `wallTex(key,night)` bakes a windowed wall
texture (lit windows at night), `roofTex` a lighter roof. To give a model a distinct look, add a
`ty_*` entry and point the model at it.

## Occlusion / draw order — the depth-sorted face queue

A 2D canvas has **no depth buffer**, so order is painter's algorithm (back→front). Two levels:

- **Between buildings**: `drawWorldObjects` sorts the tile list `items` by `b.f - a.f` (far→near).
- **Within one building**: a **per-building face queue**. `drawWorldObjects` wraps each building's draw
  in `beginFaces()` … `flushFaces()`. While a sink is active, the drawing primitives don't paint
  immediately — each face is queued via `emitFace(depth, fn)` and `flushFaces()` sorts them by depth and
  paints back→front. This is what stops a sub-part (a tower, a marquee) from over-painting nearer
  geometry of the same building (the "see-through" bug).

Rules for anyone adding to a building model:
- **Geometry** (`draw3DBoxAt`, `drawFacetDrum`, `drawBarrelRoof`, and the shared decoration helpers —
  `glowPool`, `blinkLight`, `mast`, `neonBlade`, `verticalMarquee`, `marqueeBand`, `drawSmoke`,
  `drawHoloAd`, `drawCityBloom`, …) already route through `emitFace`. Use them and you get correct
  ordering for free.
- **Any inline `ctx` draw inside a model `case`** (a bespoke gable, a dome disc, a door) MUST be wrapped
  in `emitFace(depth, () => { …ctx ops… })`, or it will paint *before* the flushed geometry (i.e. behind
  the building). Use the real camera depth (average projected `.f` of its points) for opaque parts so
  they sort correctly; use `ON_TOP` (−∞, drawn last) for glows/lights/thin overlays that should always
  sit on top of their own building. Ground decals (apron paint at z≈0) can stay unwrapped — drawing them
  before the flush correctly puts them under the building.
- Outside a sink (`FACE_SINK` null — the yacht, statue, trees, deck, HUD) every `emitFace` paints
  immediately, so those paths are unaffected. Painter's order still can't resolve genuinely
  interpenetrating geometry, but buildings here don't interpenetrate.

## The three "tower" renderers (do not confuse them)

| # | Renderer | File | When it draws | Is it the airport tower? |
|---|----------|------|---------------|--------------------------|
| 1 | `drawTypeModel` → `case 'hangar'`, **section 3** | windshield.js | The real 3D world building at an airfield | **YES** — this is the one players fly around |
| 2 | `drawAirportFeature` (`drawAirportScenery`) | windshield.js | Flat backdrop flanking the runway, on-deck only, fades out on climb-out | No — deck dressing |
| 3 | `drawATCTower` | [`aircraft3d.js`](../../client/game/js/panels/aircraft3d.js) | Through the open bay door in the **hangar-inspect diorama** | No — a separate scene |

The airport ATC tower is **built into the hangar model** (`case 'hangar'`, alongside the terminal
concourse + hangar shed), not a standalone model. Edit it there; do **not** add a separate tower
model or you'll get two.

## Recipe: add or edit a named building model

1. **Model code** (engine, git-only, no DB): add/extend a `case` in `drawTypeModel`, composing
   `draw3DBoxAt` boxes + helpers. Add a `ty_*` palette to `WALL_COL` if it needs its own colour.
2. **Register it**: add a `NAMED_MODELS[<bldgSlug(name)>] = { type, pal, … }` entry (bespoke,
   keyed by building name) **or** a `TYPE_MODEL[<building_type>]` entry (type default). `modelFor`
   prefers named over type.
3. **Place it** (content): the tile must carry the flag the model keys off — `building_name`
   (→ `bn`) for a named model, or `building_type` (→ `bt`) for a type model — on a `map_world`
   zone. That's a content edit (one zone JSON + local DB; prod via the CODEX deploy). Airfield
   *surface* tiles (`airfield_id`, `kind:'field'`) are runway, not buildings — a tower/terminal is
   a separate building tile or, as with the airport, folded into the `hangar` model that already
   sits on the field.

## Gotchas

- **No cache-busting on assets.** Scripts load as ES modules; the dev server (`server/index.js`)
  serves them `Cache-Control: no-cache` + `Last-Modified` (fresh `readFileSync` per request), so a
  correct browser never shows stale JS on localhost. Persistent "old build" symptoms usually mean:
  a leftover **service worker from another localhost app** (bypasses hard-refresh — check DevTools →
  Application → Service Workers), Opera Turbo/VPN proxying, or you're viewing the **deployed** URL
  not your local edits.
- **UTF-8 glyphs** — this file (like `index.html`) uses box-drawing/emoji; preserve UTF-8, no BOM.
- **What you see is what you can hit.** Building height comes from `floorHeight`/`bldgStyle`, the
  same value the CFIT collision sweep reads. Keep rooftop adornments visual-only; don't change the
  mass without meaning to change collisions.
