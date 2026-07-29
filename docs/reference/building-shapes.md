# Building Shapes — the flight sim's geometry, as data (as built)

**STATUS: BUILT.** Capture, distance LOD, occlusion culling, ground shadows, per-point
collision, the cold open's skyline, and the `shapes:smoke` / `shapes:bake` scripts all ship.
Remaining ideas are listed at the bottom and are marked as such.

A building's shape used to exist **only as code**: 72 imperative `case` arms inside
`drawTypeModel` ([client/game/js/panels/windshield.js](../../client/game/js/panels/windshield.js))
painting setback tiers, twisted shafts, domes and barrel roofs straight into the flight camera.
Nothing else could read a building's form, and three things were quietly wrong because of it:

- **Collision was a lie.** It tested one axis-aligned square with its roof at `floors × 12 ft`. The
  per-model height multipliers — office `1.7×`, Halcyon `2.9×`, Solenne `3.31×` — never reached the
  sim, so you flew through the top two thirds of the tallest towers in the city.
- **Shadows were a lie.** Every building cast the same rectangle.
- **The cold open couldn't show the real city.** It drew one wireframe box per tile, because it
  cannot import the ~8500-line renderer on a first login.

This doc is the map of what replaced that. **Read it before touching a building model, the CFIT
sweep, or the cold open's flythrough.**

## The one idea: the arms record themselves

Hand-porting 72 arms into data would have risked the best-looking thing in the codebase. Instead the
shipping arms are **instrumented, never rewritten**. Two properties make it exact:

1. Nothing paints during an arm — every primitive pushes a closure into the depth queue via
   `emitFace`, and `flushFaces` runs them later.
2. No arm uses `Math.random`; geometry is fully deterministic from `(fh, h, m, seed, E)`.

So a module-global `SHAPE_SINK` sits beside `FACE_SINK`. When it's set, each **mass** primitive
records its arguments and returns before doing anything else, and each **adornment** primitive
no-ops. `captureShape` runs the real `drawTypeModel` against a stub ctx/cam and collects the result.

**On a real frame `SHAPE_SINK` is null**, so every guard is `if (null) return;` and the arms are
byte-for-byte what they were. `drawWorldObjects` asserts it is null on entry and logs if it leaked.

### The three flags

| flag | when set | effect |
|---|---|---|
| `SHAPE_SINK` | capture only | mass primitives record and return; adornments no-op |
| `MASS_OFF` | distance LOD | mass primitives no-op; the arm still paints its **lights** |
| `ADORN_TIER` | distance LOD | `2` all adornments · `1` cheap only (beacons, masts, dishes) · `0` none |

`MASS_OFF` is what makes the LOD nearly lossless, and it is only viable because of a measurement:
**running an arm costs ~3.2 ms/frame while queueing its faces costs ~14.6 ms.** The arm's JS was
never the problem.

## The segment schema

Model-local, captured at the canonical entrance vector `E = [0,1]` (where `facePt` is the identity).
Every geometric scalar is an **affine triple `[a, b, c]` meaning `a·fh + b·h + c`**.

```js
{ kind: 'box'|'drum'|'barrel'|'sawtooth', cx, cy, z0, z1, pal, frontOnly,
  hwRaw, yaw, roof,     // box — hwRaw is PRE-clamp
  rb, rt, n, cap,       // drum
  cxL, hl, hw, archH, nf, base,          // barrel
  hx, hy, rh, teeth, roofc, glassc, edge // sawtooth
}
```

Three things here are load-bearing and easy to get wrong:

- **`hwRaw` is pre-clamp.** `draw3DBoxAt` clamps a half-width to `0.44`, an absolute world constant,
  while everything else is a multiple of `fh`. A post-clamp number would only be valid at the one
  footprint it was captured at. **Consumers re-apply `min(hwRaw·fh, 0.44)`**, and the data stays
  invariant to the `bldgFoot` / `bldgH` / `bldgStretch` sliders.
- **The basis is solved, not assumed.** "Widths scale with `fh`, heights with `h`" is *wrong* — nine
  models derive a vertical from the footprint (a barrel roof's rise is proportional to its span).
  Capture solves `a`, `b`, `c` from three passes at different scales and verifies against a fourth.
- **The constant term `c` is real.** The Layover's cone apex passes a literal `0.001` radius.
  Supporting `c` keeps that arm untouched; the bake **warns** on any non-negligible constant, since
  a constant is also what a modelling slip looks like.

### The `yaw` trap

Rotating a model to its entrance vector `θ(E) = atan2(-E[0], E[1])` must rotate the segment's
**centre** *and* add `θ(E)` to the segment's **`yaw`**. Miss the second and the three twisted towers
(Halcyon, Solenne, `asc_spire`) sit in the right place with their footprints turned the wrong way —
small enough to ship unnoticed. Where practical, transform the four corners individually instead and
the question disappears; that is what the cold open does.

### Spars (masts) — recorded, but never mass

`mast()` pushes `{ kind: 'spar' }` into the sink, and **`shapeForModel` hands spars back on the
returned array's `.spars` property rather than inside it**. So collision, footprint, shadow, roof
height and LOD are byte-for-byte unaffected — you still don't CFIT into an antenna — while a consumer
drawing the silhouette can ask for them.

They exist because a mast is *structural to the picture*: several arms hang a crown box, a finial or
(the Dead Pigeon) a stuffed bird off the top of one, and without the spar those pieces float in the
air over a gap. `shapeWireList` appends them **outside the `max` budget** (one line each, they can't
push a real piece off the list) as `kind: 'mast'` with zero `hx`/`hy`, and never flags one `tall` — a
consumer sizing a camera to clear the city should clear the roofs, not the antennas.

### The two hand-rolled shells

The bank's stone dome and the Meridian's ogee cupola are revolved out of `cam.proj`+`emitFace` rather
than through a mass primitive, so capture used to miss them. That cost nothing in collision or shadow
— each is subsumed by an adjacent box in both height envelope and footprint hull — but it cost the
wireframe its contour, and the stone lantern on each shell's apex was left standing over a hole. Both
now push a **tapered drum** into the sink beside their draw loop, which is what a revolved shell is at
cage resolution. Any future hand-rolled shell should do the same.

### Trimming a stack: keep it continuous

`shapeWireList(m, max)` ranks by **visual mass**, which for a stacked tower spends the budget from the
ground up. Solenne is 26 twisted slabs: the first eight kept pieces reached 1.1× the storey stack and
the ninth was the crown at 3.05× — a tower missing two thirds of its shaft with its hat in mid-air.
Hall of Records did the same. So after ranking, any **vertical gap under the tallest kept piece** is
filled with the dropped segment nearest the gap's midpoint, stretched to span it (a stack tapers
slowly, so a mid slab is a faithful footprint). Fillers come out of the **same budget** — it keeps one
fewer ranked piece until the whole thing fits — so per-frame stroke cost is unchanged. All 83 models
are now gap-free at `max = 9`.

## Consumers

| consumer | reads | notes |
|---|---|---|
| **Distance LOD** (`drawModelLOD`) | live capture | past `lodNear`, mass from segments + the arm's lights |
| **Occlusion culling** | live footprint hulls | skips buildings fully hidden behind a nearer one |
| **Ground shadows** (`drawBuildingShadow`) | live capture | real hull + real roof, not one square |
| **Collision** (`buildingRoofFtAt`) | live capture | per-POINT roof height in feet |
| **The cold open** | the **baked** file | must not import windshield on a first login |

Collision deliberately reads the **live** capture rather than the bake, so models whose shape varies
with the tile seed (rooftop clutter) collide as they are actually drawn on that tile.

## The bake

`client/shared/building-shapes.js` is generated — **never edit it by hand**.

```bash
npm run shapes:bake
```

It runs in plain node: windshield loads under [scripts/shapes/dom-stub.mjs](../../scripts/shapes/dom-stub.mjs),
so there is no browser step and no dev-panel button. The baked file holds the **~9 most defining
segments** per model (`MAX_SEGS`), in **rank order**, with the **tallest always kept and flagged
`tall`** — a spire has almost no bulk and would otherwise be trimmed first, which once reported
Halcyon's roof as `1.0×` its storey stack instead of `2.9×` and would have flown the cold open's
camera straight through it. It was 5, which buys the mass, one setback and the spire — enough for a
silhouette and not enough for a building.

Every segment carries a **bounding box** (`cx cy hx hy z0 z1 yaw?`), and a segment that is not a box
also carries its **`kind`**: `drum` adds `{ rb, rt, n }` (a faceted, possibly tapered cylinder) and
`arch` marks a barrel roof. A consumer may draw the real contour or just the cage — the cage is
always present, so this is a detail upgrade and never a dependency. It exists because boxing all 39
drums turned every tank, silo and round shaft in Coldwater into the same slab as the shop next door.

The prologue manifest ([plugins/prologue/index.js](../../plugins/prologue/index.js)) ships `n`
(building name) and `e` (entrance) alongside `{x,y,t,f}`. Both are load-bearing: the name resolves a
landmark to its own model, the entrance is the frame the geometry is laid out in. `regress.js`
asserts the city still carries them, so a rename or a lost `facade` tag can't silently downgrade
every landmark back to a box.

## Verification

```bash
npm run shapes:smoke     # also runs inside pretest:regress
```

Three gates, ~1 second, no browser/DB/network:

1. **PAINT** — every model runs through `drawTypeModel` + `flushFaces()`, night and day, both
   facings, plus the adornments-only and LOD paths. This is the **only** automated coverage the
   windshield has ever had. It exists because the Battery Acid roaster passed a palette *key* where
   `drawFacetDrum` wanted a style *function*, and since nothing but a passing player ever ran an arm,
   it sat there until it threw mid-frame and froze the sim.
2. **SHAPE** — geometry must be affine in `(fh, h)` and reproduce at a scale the decomposition never
   saw.
3. **STALE BAKE** — re-captures and compares against the committed file, naming the models that
   drifted. A direct comparison, not a hash, so it says *what* changed.

There is still **no pixel comparison**. These prove models run and geometry is sound, not that a
building looks right. Use the wireframe overlay for that.

## Tuning knobs (⚙ in the cockpit, or `__wsTune` in the console)

| knob | default | what it does |
|---|---|---|
| `shapeWire` | 0 | stroke captured shapes over the render — cyan mass, amber entrance-face, magenta core |
| `lodNear` / `lodFar` | 20 / 32 | where segments take over from the arm, and where detail bottoms out |
| `lodAdorn` | 1 | distant lights: 2 all · 1 cheap only · 0 none |
| `occlude` | 1 | skip fully-hidden buildings |
| `shapeShadow` | 1 | hull shadows (0 = the old square) |
| `glowFar` | 11 | distance within which neon earns a real `shadowBlur` |

**`lodNear = 0` and `shapeShadow = 0` together restore the pre-capture appearance**, which is worth
knowing when judging whether something looks wrong because of this system or in spite of it.

## What this bought, measured

- LOD: **33.9 → 5.9 faces per building** at range (83% fewer)
- Glow sprites: **141 → 3 gradients** per skyline, at *every* distance
- Neon blur gating: **81 → 24 blurs** beyond `glowFar`
- Collision: Halcyon's roof **264 ft → 766 ft**, and genuinely tapered — 766 ft at the centre,
  480 at 0.3 tiles out, 0 at 0.5

That last one is a **deliberate difficulty change**: collision now matches what is *drawn*, and the
renderer stretches storeys for drama (`bldgStretch = 5.0`), so tall landmarks are much bigger
obstacles than "22 floors" implies.

## Not built

- Pixel/visual regression of any kind.
- The remaining 24 inline `shadowBlur` sites in the arms (helix light-runners, holo ads).
- Content-authored shapes — models are still code; this only made them *readable*.
