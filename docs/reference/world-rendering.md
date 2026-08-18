# World Rendering (flight-sim 3D) — how the cockpit draws the world

This is the **implementation** map for the out-the-canopy 3D view: how a tile in the
DB becomes an extruded building on screen, where each kind of structure is drawn, and
how to add or edit one. It complements [Rendering_Implementation.md](Rendering_Implementation.md)
(the design *goals*) and [../systems-flight.md](../systems-flight.md) (flight mechanics).

**Read this before editing anything you see out the cockpit window** — especially before
"improving a model", because the same real-world object (e.g. an airport control tower)
can be drawn by more than one renderer depending on the view, and it's easy to edit the
wrong one.

> **A building model is now READ as well as drawn.** Its geometry is captured out of these same
> arms and drives the distance LOD, occlusion culling, ground shadows, CFIT collision and the cold
> open's skyline — see [building-shapes.md](building-shapes.md). Editing a model changes all of
> them, and `npm run shapes:smoke` (in `pretest:regress`) fails if the baked copy goes stale.

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
   (the surface-window builder, ~radius-36 tile block) turns each nearby zone into a lightweight
   cell. The fields the renderer reads:
   - `biome` — rendering biome (`airport`, `docks`, `citycore`, `water`, `park`, `scrub`, `redrock`,
     `ash`, `asphalt`, `concrete`, `pier`, …; from `plugins/flight/biomes.js`).
   - `kind` — `'field'` (airfield surface), `'nofly'`, or `'land'`.
   - `bt` — `building_type` flag (drives the **type** model).
   - `bn` — `building_name` flag (drives the **named** model).
   - `ent` — entrance door face (so the model can orient its frontage).
   - `mark` — bespoke standalone landmark channel: `'yacht'`, `'statue'`, or `'gate'` (the perimeter
     gate / South Gate) — drawn by their own renderers, independent of `bt`/`bn`.
   - `road`, `sub`, `wake`, `heading`, `rd`, `cur`, `pf`, `ft`, `flr`, `danger` — extras:
     road/water/movement, plus `rd` (the road-piece connector `ns`/`ne`/`nesw`…, parsed off the
     tile's `flags.icon` suffix or auto-tiled from neighbours), `cur` (the Curtain wall run axis,
     from `curtainRun()`, on `flags.curtain`/`perimeter_gate` tiles), `pf` (the park-feature
     dressing selector, from `flags.park_feature`), `ft` (field/surface theme) and `flr`
     (`flags.floors` → extrusion height). The authoritative shape is the `row.push({…})` at
     [`state.js:687`](../../plugins/flight/state.js).
   - Tile precedence when two zones share a grid tile: yacht > airfield/building > road (see
     `state.js` — a landmark must outrank a road or it gets clobbered).

2. **Client draws the world.** `drawWorldObjects(ctx, cam, v, sky, now, sun)` iterates the
   cells (depth-sorted), and for each building tile (`it.c.bt` present) calls:
   - `modelFor(cell)` → picks a model spec: **`NAMED_MODELS[bn]`** first, else **`TYPE_MODEL[bt]`**,
     else `null`.
   - If a spec exists → `drawTypeModel(...)` renders that dedicated model.
   - If `null` → `drawBuilding(...)` falls back to a biome archetype (generic warehouse/office/etc).
   - Non-building marks are handled earlier in the loop: `mark === 'statue'` → `drawStatue`,
     `mark === 'yacht'` → `drawYacht`, `mark === 'gate'` → `drawSouthGate`, `kind === 'nofly'` → a
     translucent box, parkland/badlands → tree/rock billboards, `biome === 'park'` → `drawParkTile`
     (manicured grove/pond/benches/flowerbeds/path, chosen by `pf` or a position-hash), and a tile
     carrying `cur` → `drawCurtainWall` (the shimmering energy wall).

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

### Text on surfaces — the standard for ALL 3D-world text (never billboard it)

Every 3D-world view — the cockpit ([windshield.js](../../client/game/js/panels/windshield.js)),
the **Helm chase cam** ([helm-view.js](../../client/game/js/panels/helm-view.js)) and the
**standalone flightsim** ([flightsim.html](../../client/game/flightsim.html)) — renders through the
same `paintWindshield` pipeline, so this rule is shared across all three by construction.

**World text (signage, a name on a wall, anything that belongs to a surface in the scene) is
painted INTO the surface, not billboarded.** The wrong way — the one that reads as text swivelling
to face you as you fly past — is `ctx.fillText` at a projected point: the glyph stays screen-upright
while the wall tilts. The right way is two helpers:

- `bakeSignText(label, color, dn, vertical)` → renders the label once to a memoised offscreen neon
  texture (keyed `label|color|day-night|vertical`; dark edge + white core + colour halo).
- `drawSurfaceText(ctx, TL, TR, BR, BL, tex, vertical, alpha)` → maps that texture onto the face's
  **real projected quad** by 8-strip affine subdivision (canvas has no perspective transform; thin
  strips along the text axis approximate one). Composed with `ctx.transform` (not `setTransform`, so
  DPR scale survives). **Call it inside an `emitFace` closure** — it is pure screen-space drawing and
  must sort with the rest of the face queue.

The signage helpers already route through this: `marqueeBand` (horizontal band), `verticalMarquee`
(vertical blade, e.g. EMBASSY), and `neonBlade`. `neonBlade`'s `label` defaults to `_bladeSign` — an
ambient var `drawTypeModel` sets from the building's `building_name` (`it.c.bn`, upper-cased) — so a
blade paints the real venue name for free; pass `''` to force the old abstract "letter rungs". **When
you add any new world sign, use `drawSurfaceText`; do not `fillText` onto the scene.**

**The one carve-out — HUD / instrument text STAYS billboarded.** Airfield ID + distance tags
(drawn inline off `v.airports` on the heading tape, windshield.js:1642), bogey reg/range labels,
ring numbers, the ⚠ weather band, heading tape and hull
readout are cockpit-*glass* overlays, not world objects — they are deliberately screen-space and
upright so they stay legible at any attitude. Those keep their `fillText`. The test: does the text
belong to a **surface in the world** (→ `drawSurfaceText`) or to the **instrument panel over the
world** (→ screen-space `fillText`)?

### Palettes
`WALL_COL` maps palette keys → base RGB. Named-building keys are prefixed `ty_` (`ty_lux`,
`ty_atc`, `ty_halcyon`, `ty_office`, `ty_door`, …). `wallTex(key,night)` bakes a windowed wall
texture (lit windows at night), `roofTex` a lighter roof. To give a model a distinct look, add a
`ty_*` entry and point the model at it.

## Occlusion / draw order — the depth-sorted face queue

A 2D canvas has **no depth buffer**, so order is painter's algorithm (back→front). It runs as **one
shared face queue for the whole world pass** — a per-building queue only orders a building against
itself, which lets two *adjacent* tall buildings whose footprints overlap in depth paint through each
other (the "overlapping buildings / bad culling" look on dense clusters):

- `drawWorldObjects` opens **one** sink with `beginFaces()` before the tile loop and paints it with a
  single `flushFaces()` after. While a sink is active the drawing primitives don't paint immediately —
  each face is queued via `emitFace(depth, fn)`; `flushFaces()` sorts **every** queued face (across all
  buildings) by depth and paints back→front. So a sub-part (a tower, a marquee) can't over-paint nearer
  geometry of the *same* building **or of a neighbour**.
- **Buildings** emit their faces straight into the shared sink (`drawTypeModel`/`drawBuilding` →
  `draw3DBoxAt` → `emitFace`) — no per-building begin/flush.
- **Point-like / atomic objects** drawn in the same loop (statue, yacht, park/tree/rock billboards,
  the Curtain wall, the `nofly` box) are wrapped as one closure at their tile-centre depth
  `od = it.f + cam.back` (the projected-`f` frame box faces use). At flush time the sink is already
  `null`, so the wrapped drawer's own internal `emitFace`s paint immediately — each object stays
  internally ordered as before, just positioned correctly among the buildings.
- The **shadow pre-pass** and ground decals draw *before* `beginFaces` / the flush, so they stay under
  everything.
- **Decorations carry real depth (`decoDepth`)**: glows, beacons, masts, signs, light-runners and holo
  ads emit at `decoDepth(...anchorF)` = `min(f) - DECO_LIFT` (0.6 tiles forward, windshield.js:3135) —
  still on top of their **own** host walls (which span ±~0.44 tile), but a building ≳1 tile closer
  correctly occludes them. **Never paint a decoration last-globally**: that's what makes a far tower's
  lights bleed through a nearer building in front of it. Add a new adornment with a shared helper
  (`glowPool`/`blinkLight`/`mast`/…) — they already call `decoDepth`. For a bespoke inline glow/line,
  pass `decoDepth(<anchor point>.f)` so it sorts against neighbours too.

Rules for anyone adding to a building model:
- **Geometry** (`draw3DBoxAt`, `drawFacetDrum`, `drawBarrelRoof`, and the shared decoration helpers —
  `glowPool`, `blinkLight`, `mast`, `neonBlade`, `verticalMarquee`, `marqueeBand`, `drawSmoke`,
  `drawHoloAd`, `drawCityBloom`, …) already route through `emitFace`. Use them and you get correct
  ordering for free.
- **Any inline `ctx` draw inside a model `case`** (a bespoke gable, a dome disc, a door) MUST be wrapped
  in `emitFace(depth, () => { …ctx ops… })`, or it will paint *before* the flushed geometry (i.e. behind
  the building). Use the real camera depth (average projected `.f` of its points) for opaque parts so
  they sort correctly, and `decoDepth(...)` for glows/lights/thin overlays. Ground decals (apron paint
  at z≈0) can stay unwrapped — drawing them before the flush correctly puts them under the building.
- Outside the world pass (`FACE_SINK` null — the Helm chase yacht, deck backdrop, HUD) every `emitFace`
  paints immediately, so those paths are unaffected. Painter's order still can't resolve genuinely
  interpenetrating geometry, but buildings here don't interpenetrate.

## Vehicles are the exception — they get a real depth buffer

The rules above are for the **world** pass, where painter's algorithm is the right trade: thousands
of buildings, full screen, and none of them interpenetrating. A **vehicle mesh is the opposite
shape** — a pile of small convex boxes bolted onto bigger ones, where a big panel is behind a small
one over here and in front of it over there. No single depth per part can say so, which is why four
successive sort keys each fixed the case in front of them and left the class alone (grille bars
through the panel they are screwed to, one headlamp eaten, flanks flashing as the model turned).

So the truck mesh rasterises through a **per-pixel depth buffer** —
[`client/game/js/panels/model-raster.js`](../../client/game/js/panels/model-raster.js), sized to the
model's own screen box, never the canvas. Aircraft keep the mean-depth sort: one smooth hull is the
shape a sort *is* right for.

⚠ **There are four renderers of that mesh, and a fix has three times reached only one of them** —
the chase view you drive from (`paintWindshield`), the depot floor and hangar lot
(`drawHangarScene`), the walkaround/bench hero (`paintTurntable`), and the CRT schematic
(`drawWireframe3D`, deliberately x-ray and on no sort at all). The pass itself lives in **one
function**, `truckDepthPass` in
[`aircraft3d.js`](../../client/game/js/panels/aircraft3d.js) — add a renderer, call that, and don't
write the twenty lines again.

Three things worth knowing before touching it:

- **The part sort is not dead code.** `sortTruckFaces` is the live fallback for any frame the blit
  cannot land, so it is still gated (`truckOcclusionSmoke`, `truckSortStabilitySmoke`, and the
  headlamp smoke, which asks for it by name through `_setBlitEnabled`).
- **`RASTER_BUDGET_PX` is a frame time, not a taste.** In a panel the model fills the pane, so the
  supersample budget binds every frame — at ~30 ns per buffer pixel, a full-pane rig at a retina
  ratio is ~25 ms, which is not a slow frame but no frame at all. The sharpening gives way under
  load; the pass never does.
- **No outline over a depth-buffered model**, and detail passes (jazz splatter, hull texture, canopy
  art, glass sheen) run only for a face that still owns its own centre — otherwise a hidden face
  paints its decoration over the panel hiding it.

`scripts/shapes/smoke.mjs` asserts each renderer *reached* the buffer via `rasterCount()`, because
the failure mode here is silent: the work is real, verified in one view, and has no effect in the
others.

## Building mass is shared with the cold open

`TYPE_FLOORS`, `FLOOR_Z`, `BUILDING_FOOT` and `floorsFor()` live in
[`client/shared/skyline-scale.js`](../../client/shared/skyline-scale.js), **not**
in windshield.js. They moved there because the cold open's closing flythrough
([systems-codex.md](../systems-codex.md)) renders the same Coldwater skyline as a
wireframe, and a first-login path must not import the ~8000-line flight renderer
to find out how many storeys a hotel has.

So there are now **two renderers of the same city**, and changing a floor count
in that file moves both — plus the CFIT collision ceiling, since `buildingHeightZ`
keys off the same `floorsOf`. windshield.js imports them and re-exports
`BUILDING_FOOT` (cockpit.js's collision sweep imports it from windshield.js, and
that stays true). The cold open's own `STRETCH` and its 90° rotation of the city
are local art choices in intro-cinematic.js and do not belong here.

⚠ **A type missing from `TYPE_FLOORS` is not "unstyled", it is FOUR STOREYS.** `floorsFor` falls
through to `default: 4`, and since every fraction inside a model arm is a multiple of `h`, the whole
model silently inflates. `fuel_yard` shipped that way: a forecourt is one storey of occupancy, so
its dispensers came out over a storey tall and its canopy cleared two, which reads from the cab as
"the gas pumps are massive". Nothing was wrong with the arm. **When you add a building type, add its
row here in the same commit**, and read the arm's fractions as storeys afterwards.

## The three "tower" renderers (do not confuse them)

| # | Renderer | File | When it draws | Is it the airport tower? |
|---|----------|------|---------------|--------------------------|
| 1 | `drawTypeModel` → `case 'hangar'`, **section 3** | windshield.js | The real 3D world building at an airfield | **YES** — this is the one players fly around |
| 2 | `drawAirportFeature` (`drawAirportScenery`) | windshield.js | Flat backdrop flanking the runway, on-deck only, fades out on climb-out | No — deck dressing |
| 3 | `drawATCTower` | [`aircraft3d.js`](../../client/game/js/panels/aircraft3d.js) | Through the open bay door in the **hangar-inspect diorama** | No — a separate scene |

### The departure surface: strip vs. pad

Two mutually-exclusive drawers paint the ground you sit on at a field, both in
windshield.js and both using the same projection maths so they read as one world:

| Drawer | When | Look |
|---|---|---|
| `drawGroundRunway` | default | Long tapering strip, dashed centreline scrolling toward you, TDZ paint, edge lights. `dust=true` (wastes/slag theme) swaps tarmac + paint for a beaten-dirt strip with wheel ruts. |
| `drawGroundHelipad` | `v.helipad` | Square apron, perspective touchdown circle, a flat **H**, green perimeter lights. No centreline — a helipad is a spot, not a strip, so `roll` only nudges it rather than scrolling past. |

The switch is **data-driven, not per-field art**: `state.vtolOnlyField(zone)` (i.e.
`flags.airfield_vtol_only`, or the legacy `charter_vtol_only`) → `ground.helipad` in
the context payload → `v.helipad`. **Any future helipad gets the pad automatically
by carrying the flag** — there is nothing to author.

### Rooftop pads: a tile that is BOTH a field and a building

A pad on a tower's roof (the Solenne Sky Pad) puts `airfield_id` on the same
`map_world` tile that carries the building. `kind:'field'` used to mean "bare
ground": the world pass skipped the tile, `buildingHeightZ` returned 0, the ground
pass painted runway concrete over the block and `biomeOf` tinted it apron-grey — i.e.
flagging the pad would have *deleted the tower* from the sky and from the CFIT sweep.

The rule now is **a field tile carrying `bt` keeps its building**: `drawWorldObjects`
draws the model, `buildingHeightZ` keeps its mass, `drawGroundSurfaces`/`nearField`
leave the street alone, and `biomeOf` keeps the district biome. The pad itself is the
departure surface you sit on (`vtolOnlyField` → `v.helipad`), which is exactly right —
the pad is on the roof, not painted on the block. Any future rooftop pad inherits all
of this by carrying `airfield_vtol_only` on a building tile.

Note the H is drawn as three foreshortened bars lying ON the pad, not as canvas
text — same rule as the surface-text renderer: painted markings are never
billboarded.

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

## Street actors — the people on the pavement (as built)

The world pass draws a figure for every person actually standing on that tile. **1:1, and
deliberately so** — there is no procedural crowd and there must never be one. A filler figure is a
person you cannot walk up to, and the worth of the layer is that everything you can see is a thing
you could go and talk to. An empty street is drawn as an empty street; the fix for a quiet city is
more NPCs, not more sprites.

**Path.** `streetActors()` ([server/engine/street-actors.js](../../server/engine/street-actors.js))
→ `actors: [{ t, x, y }]` on `flight_ctx` ([contextPayload](../../plugins/flight/state.js)) and
`truck_ctx` ([cabContext](../../plugins/trucking/state.js)) → `F.actors` / `st.actors` → `v.actors`
→ `drawStreetActors` in [windshield.js](../../client/game/js/panels/windshield.js), run after the
tile loop and **before `flushFaces`** so each figure queues at its own depth and a building between
you and somebody hides them.

Four things worth knowing before touching it.

**Indoors is ABSENCE, not a flag.** An interior is its own map (`maps.parent_zone_id`) with
interior-local coordinates, so somebody inside a shop has no overworld tile and falls out of the
filter with nothing written to handle it. Two consequences: "went inside" needed no special case
anywhere, and we never ship a count of who is in a building — which would be a free occupancy read
on any premises in the city, from a street away, and is SPECTER's job
([systems-surveillance.md](../systems-surveillance.md)).

**⚠ The token is a correlator, not an identity.** NPCs move on a 15 s tick, one whole tile per
step, so the raw feed teleports; the client interpolates that into a walk, and to do it at all it
must know the figure at A is the figure at B. Ship the npc id and you have instead built a live
position tracker on every named NPC in the city, readable with no camera and no skill check. `t` is
a truncated hash under a boot-minted salt — stable within a session, meaningless across a restart,
and it never resolves back to a name. Regress asserts no token is ever an entity id.

**⚠ A pedestrian is drawn and is never geometry.** Nothing in this layer reaches
`groundObstructionAt`, the CFIT sweep or `SHAPE_SINK`, and it must stay that way: the trucking model
deliberately has *no* ground collision (the verge is slow, past the half-width you are bogged, never
blocked — see [systems-trucking.md](../systems-trucking.md)), so a collidable pedestrian would put a
wall into the one system whose whole design is that there isn't one. You drive through them. Kerb
placement comes from the cell's own `rd` connector letters, with the side held per-figure off the
token so nobody hops kerbs mid-block.

**The figure is an abstraction, not a small human.** A head on a body, no limbs. At the size this
draws, legs are a pixel wide and read as jitter; motion is carried entirely by the bob. Height-gated
(`v.height < 0.22`), so it really lives in the truck cab and on low passes.

**Going 1:1 made `zone.npcs` drift visible, and that is what finally got it swept.** The set had no
reconciler for years because drift in it showed as *nothing* — `getZoneNpcs` filters ids it cannot
hydrate. Drawing a figure per occupant turned the same drift into the same person on two street
corners, so `reconcileNpcMembership()` ([world.js](../../server/engine/world.js)) now rides the same
30 s tick as the player sweep and repairs **both** directions: stale memberships (the half that
duplicates somebody on screen) as well as missing ones. ⚠ It believes `npc.zone_id`, so it fixes a
drifted set and is blind to a wrongly-written field — `moveNpcToZone` is still the only funnel (see
[systems-strays.md](../systems-strays.md)).

Coverage: `shapes:smoke`'s view sweep cycles four actor frames (arrive → walk → vanish beside a
building → appear), and the flight regress suite asserts the 1:1 count, the opaque token, the square
window, the empty-is-a-real-answer case and the indoors exclusion.

## Street furniture — pavement, crossings, lamps, signals (as built)

All four are **derived from data the tile already carries**. Nothing was authored for any of it.

**Pavement and crossings** are painted in `drawGroundSurfaces` off the cell's `rd` connector letters
— the same field the lane markings read. ⚠ The band sits at **`VERGE`, the one constant the street
actors also stand on**; they must never become two numbers that agree by luck, or the figures walk
in the gutter and neither change looks like the cause. A junction is a *hole* in the pavement (arms
run corner-inward and stop short) so the box stays clear and the zebra ladders have somewhere to
sit. Curved (`rdeg`) and dust roads get neither, matching the existing kerb-stroke suppression.

**Street lamps** are the real thing: `sl` on the cell is a live `light_type:'streetlight'` furniture
row, lit or unlit by `environment.js` against ambient darkness **and** grid power. Nothing in the
renderer decides whether a lamp is on — it draws the answer the light system already published, so
a blackout darkens the street out the windscreen at the same instant it darkens the rooms, with no
second rule to keep in step. ⚠ `sl` is **three states** (1 lit / 0 dark / absent) because an unlit
post is still street furniture; collapsing "off" into "absent" would pop every lamp in the city out
of existence at dawn.

**Traffic signals** are one mast-arm per **axis** of a junction — not one head per arm — with the
boom cantilevered out over the carriageway and the street light on the same steel. Both directions
of a street already share a phase by construction, so the arms of an axis were never independent
decisions; a crossroads gets two masts instead of four kerbside posts. Three things to know:

- ⚠ **The phase lives in [client/shared/traffic.js](../../client/shared/traffic.js), not here**,
  because the text game prints a sentence about the same junction ([describe.js](../../server/engine/commands/describe.js)).
  A driver who reads "green north-south" and then sees red has been lied to by whichever copy
  drifted. It is derived from the wall clock plus a per-junction offset, so two players agree with
  no server state and no table.
- ⚠ **The text side derives junctions from EXITS, not from the `road_*` icon.** Exactly **one** tile
  in the whole world has an authored junction icon — every other junction is auto-tiled — so an
  icon-based test ships a feature that passes and is invisible forever. The engine's own exit graph
  is used instead (a road tile with ≥3 road neighbours), which also keeps the flight plugin's
  coordinate index out of the engine.
- ⚠ **A head is geometry, not a sprite.** The housing, its flank, its lens face and the three lenses
  are polygons laid out in a small world frame — `u` across the road, `v` up, `w` down the approach
  — whose screen basis is read out of the projection by `planeBasis` for three extra `cam.proj`
  calls. So a head foreshortens as you turn and goes edge-on when you cross it, and the junction on
  the cross street shows you the *side* of its heads, which is what says at a glance that those
  lights are not the ones talking to you. Which face carries the lenses falls out of the camera:
  `df/dw = w·(sinh, −cosh)`, negative meaning that face is the near one, and `|df/dw|` doubles as
  how square-on the head is — the halo is scaled by it so a signal you are passing does not blaze at
  you sideways. **Both** faces carry lenses, deliberately: one mast governs an axis, so the driver
  arriving the other way is looking at the far side of the same head. The bloom stays a screen-space
  gradient, which is not an oversight — a halo is what the atmosphere does with a bright source, not
  a surface the lamp has. It was the *fitting* that had to stop being a sprite.

⚠ **The steel is geometry too, and its width is a world measurement.** The pole, boom, brackets and
lamp standards are tapered polygons (`drawSteel`) sized by **radius in tiles**, projected through
`cam.FL`, with a narrow off-centre highlight strip that is the only thing separating a drawn pole
from a drawn rectangle at these sizes. They were strokes whose `lineWidth` came off `s`, the *head's*
on-screen size — `max(0.9, s * 0.13)`, which pins every mast in the city at about a pixel from seven
tiles out to the horizon: a hairline that reads as a scratch on the glass. Thicker is **not** fat:
the pole lands near 12:1 height-to-width against a real mast's ~25:1, because going to the real ratio
just puts the hairline back and going past this reads as a concrete plinth with a light on it.

**A signal is set dressing and the code says so in both files.** Nothing obeys it: no verb reads it,
the truck is not stopped by one, NPCs do not cross roads. It is deliberately never given a stop
line, a camera or a ticket, and it goes **dark** rather than flashing amber in a blackout — a
flashing signal is a real-world instruction to treat the junction as a stop, and this system
enforces nothing.

⚠ **Two sizing traps, both of which shipped silently in a first pass.** `signalHead`/
`drawStreetLamp` still gate on `s = K / p.f`, and **`p.f` is projection space, not tile distance** — a
junction two tiles ahead measures `s ≈ 2.5`, not `4.5`. A halo gated at `s > 3` therefore never drew
at any distance, which looked like "the lights aren't very bright" rather than a dead branch. And
calibrate `K` against the billboards already in the world (`drawTreeBB` 34, `drawActorFigure` 11)
rather than picking a number: a first pass used 9 for a signal head and it came out the size of a
pedestrian's head — plausible at a glance, and half what it should have been.

Coverage: the `shapes:smoke` view sweep includes a **`cab:blackout`** case (`pw: 0`) so the
power-cut branch is executed, and its map carries a crossroads placed **off the centre tile** — the
centre is the camera's own position and near-clips, so a junction at `(R,R)` exercises none of the
signal code while appearing to. The regress suite asserts the phase invariants (the two axes are
never both green, opposite arms agree, a full cycle shows all three) and that the **real world map
contains junctions by the exit rule**.

⚠ That sweep asks one question — *did the frame throw* — and **a sprite and a box answer it the
same way**, so a head that quietly went back to facing the camera would leave every gate green.
`signalGeomSmoke` measures the two properties that ARE the change: a head's lens face at full width
square-on and all but gone from the side (a billboard's never moves), and the pole's width halving
as the distance doubles (the old stroke sat on a `max(0.9, …)` floor). ⚠ It builds its own
**windscreen-sized** canvas rather than the 640px view stub — steel is sized off `cam.FL`, a
fraction of the canvas *width*, so a pixel threshold asserted at 640 is asserting something about a
panel nobody plays on.

## Gotchas

- **No cache-busting on assets.** Scripts load as ES modules; asset URLs never change. `server/index.js`
  (line 254) serves `.html` as `Cache-Control: no-cache` but **every JS/CSS asset as
  `public, max-age=60`** — so an already-open page can be up to a minute stale after an edit. Beyond
  that minute, persistent "old build" symptoms usually mean: a leftover **service worker from another
  localhost app** (bypasses hard-refresh — check DevTools → Application → Service Workers), Opera
  Turbo/VPN proxying, or you're viewing the **deployed** URL not your local edits.
- **UTF-8 glyphs** — this file (like `index.html`) uses box-drawing/emoji; preserve UTF-8, no BOM.
- **What you see is what you can hit.** Building height comes from `floorHeight`/`bldgStyle`, the
  same value the CFIT collision sweep reads. Keep rooftop adornments visual-only; don't change the
  mass without meaning to change collisions.
- **Ground paint sorts by its FAR corner, and it is the one face that does.** `groundPaint` (aprons,
  bay boxes, hazard hatching, lane chevrons) does **not** go through `decoDepth`. It used to, and
  the two biases compounded: `decoDepth` takes the nearest corner and lifts it another 0.6 tiles,
  so a near-tile-wide apron sorted a full tile in front of itself and painted straight over the
  neighbouring building — "the floor can be seen through other buildings". A flat quad on the deck
  has an exact answer instead of a tuned one: **everything standing on it is nearer than its far
  edge, and anything beyond its far edge projects above it**. The corollary is that you can no
  longer paint a stripe *under* a raised object and expect it to appear *on* it — colour the object.
- **A ground vehicle rides over anything under `TRUCK_STEP_Z`.** `groundObstructionAt` gates on the
  segment's underside (`z0` vs the cab roof) *and* its top (`z1` vs the step height, opt-in and 0 by
  default). Without the second gate a kerb — underside on the ground, top at ankle height — collides
  as a full wall, which is what made the forecourt islands impassable. If you draw a kerb, keep it
  under that height; if you draw something that must stop a rig, give it real mass **from `z0 = 0`**
  (a plinth modelled as standing *on* a kerb has its underside above the clearance probe and becomes
  a thing you drive through).

## Twin audit — buildings that share a model

Two buildings of the same `building_type` with no `NAMED_MODELS` entry render as the
**same silhouette**, which reads as a bug from the air ("didn't I just fly over this?").
Audit it with:

```sql
SELECT flags->>'building_type' bt, array_agg(DISTINCT flags->>'building_name')
  FROM zones
 WHERE flags->>'building_type' IS NOT NULL
   AND flags->>'building_name' IS NOT NULL
   AND COALESCE(flags->>'is_interior','false') <> 'true'
 GROUP BY 1 HAVING count(DISTINCT flags->>'building_name') > 1;
```

The fix is to promote the more characterful half of a pair to a `NAMED_MODELS` entry
with its own `drawTypeModel` case, leaving the twin on the generic type model — as with
**Coldline Reefer Depot** (`reefer`), **Interchange Stack** (`interstack`), **Ferro
Fabrication Works** (`foundry`), **Meltwater Freight Office** (`oldoffice`), **Customs
Bonded Store 7** (`bonded`) and **The Lucky Bastard** (`neonvig`, promoted off `casino` so a
future casino still has a generic to fall back on).

**A weaker tier still exists and is deliberate:** several `NAMED_MODELS` entries share a
`type` and differ only by `pal`/`neon` — same silhouette, different colours. Today that's
`diner` (Ration Nine / Meltwater Diner), `hangar` (Coldwater Regional / Threshold
Helipad), `office` (Coldwater Sentinel / Ward Nine Permits) and `divebar` (The Green Room
/ The Dead Pigeon / Sump). Fine at altitude; the obvious next candidates if you want
another pass.
