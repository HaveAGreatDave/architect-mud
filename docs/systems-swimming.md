# Swimming (as built)

Water is no longer a wall. Entering a water tile is a **swim**, not a boat-or-die gate — it costs stamina, soaks you, chills you toward hypothermia in cold water, and drowns you if you run dry. Diving takes you underwater on a breath timer.

Owner: **`plugins/swimming/`** (mechanics) + small engine seams. New **Swimming** skill (`server/engine/skills.js`), governed by **Endurance + Brawn**.

## What counts as water
`isSwimZone(zone)` = `zoneTerrain(zone)==='water'` (painted water, the SSOT) **or** `flags.water` (deep/open) **or** `flags.underwater` (a submerged tile below one). The old `engine:water` move gate (boat-or-block) is **retired** — `server/engine/commands/movement.js` no longer registers it, and the `gameLoop.js` insta-drown failsafe is gone; swimming governs water now.

## The swim (surface)
Driven by an `on('zone.entered', …)` handler (mirrors the pacing sprint spend):
- **Wade in / haul out** — land→water and water→land are **free** (flavour lines only).
- **Stroke** — water→water costs stamina over a wide skill band, `strokeCost(eff) = clamp(BASE_STROKE − effectiveSkill, MIN_STROKE, BASE_STROKE)` (18→4 across effective skill 0..14), so the Swimming skill keeps paying off instead of saturating at the floor immediately. Each stroke runs a Swimming `skillCheck` and `awardSkillUse`, so it trains.
- **Tread** — a 1s `setInterval` tick bleeds `treadCost(eff)` (min 1) every `TREAD_MS` (8s) while you stay on a water tile — a gentle, sustainable bleed (~6–13 min afloat), so *moving* is the real cost, not floating.
- **Drown** — at **0 stamina** while submerged you start drowning: the plugin applies the `drowning` **status effect** (registered in the plugin), and the engine's per-second effect tick (`gameLoop.js`) bleeds HP (`-6/s`), persists/broadcasts, and runs the death path at 0 HP. Reaching land clears it.

The single signal everything else reads is the runtime flag **`player._submerged`** (owned by the plugin; set on move, refreshed each tick).

## Boat perk
Carry an **uncontained `boat`-tagged item** and you're *riding*, not swimming: no stroke cost, no tread, no submersion (so no wetness/cold), no drowning. Underwater tiles ignore this — you're under the water regardless.

## Diving (vertical, z-1 and deeper)
A **dive spot** is a water tile with a `down` exit to an `flags.underwater` tile at z-1 (reciprocal `up`/`down`), and so on downward.
- Underwater tiles are **always submerged** (a boat doesn't help), read **dark** (unlit; bring a light) and **colder** (see below).
- Diving `down` costs a stroke plus a `DIVE_EXTRA` buoyancy surcharge.
- **Breath** — entering underwater arms `player._breath` (seconds = `BREATH_BASE + effectiveSkill·BREATH_PER`); the tick counts it down, and at 0 you drown **even with stamina left**. Surfacing to any non-underwater tile refills it.
- Occasional first-person **underwater ambience** lines fire from the tick.

## Wet
`plugins/clothing-wetness/` gained a **submersion** source: while `player._submerged` it soaks you to **wetness 100** — skin *and* every equipped `gets_wet` garment — overriding the precip model and running before its no-wettables early-return (so a naked swimmer still reads soaked). On climbing out, its normal drying takes over (garments drip-dry; bare skin dries at once).

## Cold-water hypothermia
Reuses the existing body-temperature path (`gameLoop.js` temp tick), no new hypothermia code:
- `environment.js` `waterTemperature(zoneId)` — the cold temp a submerged body drifts toward (default **12°C** surface / **7°C** underwater; per-tile override `flags.water_temp_c`, e.g. `26` for a warm lagoon).
- When `player._submerged`, the temp tick uses `waterTemperature` as the ambient and treats you as fully wet (2× cooling). Clothing **`insulation`** (summed over equipped items) and **torso/legs coverage** (nakedness adds an exposure penalty) still offset the pull via the existing body-temp math — a **wetsuit** is just a high-`insulation` garment. (`sealed` is unrelated — that's the ash-mask/choking tag, not cold.) A long cold swim drives `body_temp_c` down into the existing **`<30°C for 5 min → −10 HP/min`** hypothermia band.

## Gear
- **Wetsuit** (`item_wetsuit`, clothing, `insulation: 6`, covers torso+legs) — offsets the cold-water pull through the insulation math above; at the default temps it keeps you warm even underwater (7°C). Colder authored tiles (`flags.water_temp_c`) still bite through it.
- **Rebreather** (`item_rebreather`, gear, `tags.rebreather`) — carried or worn, it supplies air underwater: no breath timer, so you never drown from lack of air. Stamina still applies (you can still exhaust yourself), and it does nothing for the cold.
- Both stocked at **Brack the Fishmonger** (The Fishmarket). Checked like the `boat` item: uncontained inventory, cached on move (`player._hasRebreather`).

## Tuning (constants in `plugins/swimming/index.js`)
`BASE_STROKE 18 · MIN_STROKE 4 · DIVE_EXTRA 3 · TREAD_MS 8000 · TREAD_BASE 2 · DROWN_HP 6 · BREATH_BASE 30 · BREATH_PER 3`.
Rules of thumb: fresh char (eff ~3) pays ~15/stroke (~6 tiles on a full bar) and holds ~39s of breath; a strong, trained swimmer pays the ~4 floor and holds ~60s. Treading is a slow ~15/min (novice) → ~7.5/min (skilled) bleed. Drowning is −6 HP/s (~17s).

## Not yet built
- **Boat boarding from the water** (embark/disembark the Echelon & future boats via a `flags.vessel` marker) — designed, deferred. The `vessel` zone flag is registered in the tag catalog as groundwork.
- **Underwater content** — the diving *mechanic* is live, but underwater dive-spot tiles still need authoring (a `scripts/stamp-underwater.mjs` helper + a few spots).
