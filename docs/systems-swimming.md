# Swimming (as built)

Water is no longer a wall. Entering a water tile is a **swim**, not a boat-or-die gate — it costs stamina, soaks you, chills you toward hypothermia in cold water, and drowns you if you run dry. Diving takes you underwater on a breath timer.

Owner: **`plugins/swimming/`** (mechanics) + small engine seams. New **Swimming** skill (`server/engine/skills.js`), governed by **Endurance + Brawn**.

## What counts as water
`isSwimZone(zone)` = `zoneTerrain(zone)==='water'` (painted water, the SSOT) **or** `flags.water` (deep/open) **or** `flags.underwater` (a submerged tile below one). The old `engine:water` move gate (boat-or-block) is **retired** — `server/engine/commands/movement.js` no longer registers it, and the `gameLoop.js` insta-drown failsafe is gone; swimming governs water now.

## The swim (surface)
Driven by an `on('zone.entered', …)` handler (mirrors the pacing sprint spend):
- **Wade in / haul out** — land→water and water→land are **free** (flavour lines only).
- **Stroke** — water→water costs stamina over a wide skill band, `strokeCost(eff) = clamp(BASE_STROKE − effectiveSkill, MIN_STROKE, BASE_STROKE)` (18→4 across effective skill 0..14), so the Swimming skill keeps paying off instead of saturating at the floor immediately. Each stroke runs a Swimming `skillCheck` and `awardSkillUse`, so it trains.
- **Tread** — a 1s scheduled tick bleeds `treadCost(eff)` (min 1) every `TREAD_MS` (8s) while you stay on a water tile — a gentle, sustainable bleed (~6–13 min afloat), so *moving* is the real cost, not floating.
- **Drown** — at **0 stamina** while submerged you start drowning: the plugin applies the `drowning` **status effect** (registered in the plugin), and the engine's per-second effect tick (`gameLoop.js`) bleeds HP (`-6/s`), persists/broadcasts, and runs the death path at 0 HP. Reaching land clears it.

The single signal everything else reads is the runtime flag **`player._submerged`** (owned by the plugin, maintained by **event**).

### The swimmer roster — why the 1s tick is cheap
The tick stays at **1 Hz because the breath timer is counted in ticks** (`_breath -= 1`), but it does **not** discover who is swimming. A module-level `Set` of player ids — the roster — is maintained by `syncSwimmer()`, and **`syncSwimmer` is the only writer**. Every path that moves a body calls it: `zone.entered`, `player.login`, `player.respawn`; `player.logout` and `player.death` call `dropSwimmer`. An empty sea costs one `.size` check.

Two consequences worth knowing before touching this:

- **A system/teleport move must still update submersion.** `zone.entered` used to return early on `opts.bypassEncumbrance` and let the next full sweep notice you were now in water. There is no full sweep any more, so the handler applies the physics on *every* move and skips only the **toll** (stamina, skill check, flavour prose) when the move was free. Teleporting someone into the sea and having them never drown is the failure mode this guards.
- **The roster self-heals, it isn't trusted.** The tick drops ids with no live player, and re-runs `syncSwimmer` per member, so a move path that somehow never fired `zone.entered` corrects itself on the next tick instead of stranding a body treading water on dry land.

A **sleeping** swimmer is skipped but **stays on the roster** — the mind is off in a dreamscape and the body isn't treading, but waking up out there should put you straight back in trouble.

## Boat perk
Carry an **uncontained `boat`-tagged item** and you're *riding*, not swimming: no stroke cost, no tread, no submersion (so no wetness/cold), no drowning. Underwater tiles ignore this — you're under the water regardless.

## Vessels — swimming up to a boat *(as built)*
A zone flagged **`flags.vessel`** is a boat sitting on the map: it shares its coordinates with the ordinary water zone beneath it, and the two are **not joined by an exit** — they can't be, because a vessel sails, so any link between hull and water would have to be re-derived from her position on every passage (which is exactly what the yacht plugin's `dockTo` gangway does for a *pier*). Boarding is therefore a **verb, not a step**:

- **Her tile is closed.** The `swimming:vessel-hull` move gate turns back any swim into the water zone sharing a vessel's coordinates — that water is under her keel. The refusal names the way up. Underwater tiles below her are unaffected (her draught doesn't reach them).
- **`embark` from alongside** — from any of the four orthogonally adjacent water tiles, you haul yourself over the side: one Swimming check (**skipped entirely if you're carrying a `boat` item** — you're already at deck height) and `BOARD_COST` stamina. It is **deliberately easy** — a boat has a ladder or a swim platform, and the rail is not meant to be a puzzle. What makes you slide back is arriving **spent**: below `BOARD_TIRED_AT` of your max stamina the difficulty jumps by `BOARD_TIRED_DIFF`, so the thing that strands you clawing at the hull is the long cold swim out, not a bad roll on arrival. Failing costs `BOARD_FAIL_COST` and leaves you treading; it never drowns you outright, though the drain can take you there.
- **`disembark`** — back over the rail into the water *alongside* her, never the closed tile under the hull.

The verbs are the **flight plugin's** (`docs/plugins.md` — it owns `embark`/`board`/`disembark`). It falls through to the actions **`VESSEL_EMBARK` / `VESSEL_DISEMBARK`** registered here whenever there's no aircraft in play, via `tryVesselAction` — which treats the registry's `Unknown action` reply as "not applicable" so a world booted without this plugin still gets flight's own message. A null from either action means "nothing alongside", and flight carries on to its aircraft answer (and, for `board`, the poker community-board delegate).

**Nothing here knows what a yacht is.** Whether a deck defends itself is the vessel's own business — see [systems-helm.md](systems-helm.md) for the Echelon, where the waterline is now a deliberate hole in an otherwise invite-only boat: an uninvited swimmer can reach the **weather deck** and is *not* smitten for standing on it, but the gangway hatch into her rooms still refuses them, and walking aboard from the pier is refused exactly as before.

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
- `environment.js` `waterTemperature(zoneId)` — the cold temp a submerged body drifts toward. **Seasonal, and lagging:** derived from the climate month, `clamp(4 + monthlyMean × 0.5, 2, 24)`, with underwater tiles 5°C colder (capped 12°C). Roughly **5°C in January, 15°C in July**. Per-tile override `flags.water_temp_c` (e.g. `26` for a warm lagoon) wins outright. It was a flat 12/7 year-round until 2026-07-29, which made a midsummer swim as lethal as a January one — and because it read flags out of the environment's power-graph snapshot rather than `world.zones`, **the underwater branch had never once fired on any of the 82 underwater tiles**. Both fixed together, so diving is now genuinely colder than the surface for the first time.
- When `player._submerged`, the temp tick uses `waterTemperature` as the ambient and treats you as fully wet (2× cooling). Clothing **`insulation`** (summed over equipped items) and **torso/legs coverage** (nakedness adds an exposure penalty) still offset the pull via the existing body-temp math — a **wetsuit** is just a high-`insulation` garment. (`sealed` is unrelated — that's the ash-mask/choking tag, not cold.) A long cold swim drives `body_temp_c` down into the existing **`<30°C for 5 min → −10 HP/min`** hypothermia band.

## Gear
- **Wetsuit** (`item_wetsuit`, clothing, `insulation: 6`, covers torso+legs) — offsets the cold-water pull through the insulation math above. Comfortably enough for a summer swim at any depth; a **winter** dive (deep water at ~2°C) now bites through it, which it never used to. Colder authored tiles (`flags.water_temp_c`) bite harder still.
- **Rebreather** (`item_rebreather`, gear, `tags.rebreather`) — carried or worn, it supplies air underwater: no breath timer, so you never drown from lack of air. Stamina still applies (you can still exhaust yourself), and it does nothing for the cold.
- Both stocked at **Brack the Fishmonger** (The Fishmarket). Checked like the `boat` item: uncontained inventory, cached on move (`player._hasRebreather`).

## Tuning (constants in `plugins/swimming/index.js`)
`BASE_STROKE 18 · MIN_STROKE 4 · DIVE_EXTRA 3 · TREAD_MS 8000 · TREAD_BASE 2 · DROWN_HP 6 · BREATH_BASE 30 · BREATH_PER 3`.
Rules of thumb: fresh char (eff ~3) pays ~15/stroke (~6 tiles on a full bar) and holds ~39s of breath; a strong, trained swimmer pays the ~4 floor and holds ~60s. Treading is a slow ~15/min (novice) → ~7.5/min (skilled) bleed. Drowning is −6 HP/s (~17s).

## Tuning — boarding
`BOARD_DIFF 2 · BOARD_COST 6 · BOARD_FAIL_COST 3 · BOARD_TIRED_AT 0.3 · BOARD_TIRED_DIFF 5`. A fresh char (eff ~3) gets aboard nearly every attempt with stamina in hand; arrive under 30% and the same character is at difficulty 7 and will often fail — which is the intended failure story (swam too far, too cold, too late).

## Not yet built
- **Underwater content** — the diving *mechanic* is live, but underwater dive-spot tiles still need authoring (a `scripts/stamp-underwater.mjs` helper + a few spots).
