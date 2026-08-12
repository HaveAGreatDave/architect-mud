# The Curtain & the Wildlands (map + wall built; perimeter plugin still design)

> **The Wildblood camp described below was never built here, and is not going to be.** The four
> Thornwarren shells at `zone_district_919_924/925`, `920_926`, `919_927` sat empty for a month
> promising an elder, a trader and a surgeon that existed nowhere in the world. On 2026-08-12 they
> were demoted to a **forward picket** and the Thornwarren was built for real as a walled town in a
> new region, **The Scarletwastes** — see [proposals/scarletwastes.md](proposals/scarletwastes.md).
> The gate, glacis and Curtain sections below are unaffected and still current; treat the "Wildblood
> badlands" and "The Wildblood camp" sections as superseded.

> **Status: map + wall BUILT (content), 2026-07-17.** The South Gate, the gate road, the glacis, the
> hot-marsh badlands, the Thornwarren camp shells (~12 new zones + retagged gate road), the full
> land-perimeter Curtain flags (63 edge tiles), and the client Curtain/gate minimap rendering are all
> in the working tree (lint-clean, regress-green). **Still pending:** the `perimeter` plugin (move-gate
> enforcement backstop + turret kill-zone) and all faction content (NPCs, vendor, recruitment quests —
> see [proposals/wildblood-stronghold.md](proposals/wildblood-stronghold.md)). This is the agreed
> plan for walling Coldwater Basin on its land sides and opening the frontier beyond it — the
> anti-Architect wilds where the `renounce`-stance ideologies live off-grid. Read
> [systems-world.md](systems-world.md) (zones, exits, scheduler, power), [systems-terrain.md](systems-terrain.md)
> (`flags.terrain`), [systems-ideologies.md](systems-ideologies.md) (Wildblood / Pioneers / Exodus,
> `player_ideology_rep`), [combat.md](combat.md) + [systems-flight.md](systems-flight.md) (the AA /
> Custodian turret behavior we reuse), and [systems-weather-extreme.md](systems-weather-extreme.md)
> (the wilds have no indoor safe-haven) first.

## The map we're building against (grounded)

- The city is **one district, 37×24 tiles**, `grid_x 891–927 / grid_y 896–919`, all on `map_world`,
  `grid_z 0`. Zone ids encode the grid: `zone_district_<grid_x>_<grid_y>`.
- **North (low `grid_y`) is water** — the Coldwater Basin bay, impassable without a boat, tapering
  into docks/shoreline. **South + east + west are land.**
- Water extent on the side columns (so we know where land begins): **west col `891` is water `y896–901`,
  land from `y902`; east col `927` is water `y896–908`, land from `y909`** (the bay hugs the east far
  further south). The **south row `919` is entirely land** — 37 grass tiles.
- **There is no wall today.** Exits simply cease at the grid edge (`server/engine/exits.js` —
  never read `zone.exits[dir]` raw).
- **There is no road network today either.** No `flags.artery`, no "Haul Road" — that's a *future*
  proposal, not built. Roads here are `flags.terrain` only, and the sole contiguous street is a short
  E–W track at **`grid_y 915`, `x915–920`**. **No road reaches any land edge.** So "the road into the
  city" is something *we build* (a stub from that track out to the gate), not an existing artery.
- **The west edge is already spoken for.** [systems-slagworks / project_slagworks_area] west frontier
  content and the [Ascendant Stronghold](proposals) far-west redeem campus (design) live off the west
  column, and AA emplacements already sit there (Redline SAM Nest `891_903`, Slagworks Flak Pit
  `891_905`, Wastes Gun Nest `891_907`). So **the west is busy and redeem-flavored; the renounce wilds
  go SOUTH.** The Curtain wraps the whole arc, but different gates open onto different worlds.

## The one idea

**The Curtain is the Architect's energy wall; the factions beyond it are the people who renounced the
Architect.** The wall that cages the wilds is the very thing its inhabitants reject — the three
frontier ideologies are all `renounce`-stance. Post-singularity, the wall is a shimmering vertical
*field*, not stone. It parts only at gates, and the ground outside each gate is a turret-swept
killing floor.

## Geography — a four-band ring, city outward

1. **The Curtain** — the energy wall along the land edges (south, east, west). Renders as a field on
   boundary tiles; impassable.
2. **The Gates** — the Curtain parts only at gates. **Phase 1 ships one Main Gate on the SOUTH edge at
   `zone_district_918_919`** (pinned — see below). Room for a future WEST gate (→ Ascendant) and minor
   gates later.
3. **The Killing Ground** — a thin glacis of blasted no-man's-land the turrets sweep, facing
   *outward*. This is "eradicate anything that tries to invade." Sparse, cratered, deadly to the
   wrong people.
4. **The Wildlands** — open frontier. Three renounce factions, each in a biome that embodies its
   *path*, arranged safe→feral→transcendent with distance from the wall.

```
              ~~~~~~ COLDWATER BASIN (sea) ~~~~~~        north = water (self-walling)
        ┌───────────────────────────────────────┐
  west  │        THE CITY  (existing 888)        │  east wall
  wall  │        · · · road track y915 · · ·     │  (water to y908,
 (→Asc- │              │ 918 column │            │   land y909–919)
  endant│              ▼ gate stub  ▼            │
  later)└──────────────╥ 918_919 ╥──────────────┘      ← THE CURTAIN (forcefield wall)
        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓║  GATE   ║▓▓▓▓▓▓▓▓▓▓▓▓▓▓        + turret glacis (outward-facing kill-zone)
             918_920 ·  THE KILLING GROUND (glacis) · turrets sweep
             918_923+  WILDBLOOD badlands (Phase 1 — hot marsh/ash/rad)
                            THE EXODUS
              (Phase 2 — distant mesa/caravan, by air/road)
                   [Pioneers town — Phase 3]         south/inland = deep wilds
```

## The three factions — flesh / human / mind

They already exist (`content/orgs/ideology_wildblood|pioneers|exodus.json`, all `renounce`). Their
*paths* give a perfect triad; each home literally embodies its path.

| Faction | Path | Home | Feel |
|---|---|---|---|
| **Wildblood** | *flesh* | Hot badlands — glowing marsh, ash, radiation | "Mutation is our future; civilization is a cage." Feral, dangerous, recruitable only if you go feral with them. Ties into radiation/mutation systems. |
| **Exodus** | *mind* | Remote launch mesa / wandering signal-caravan | They want to *leave* — the Basin, the planet, maybe the sim. Transient, mysterious, hard to find. |
| **Pioneers** | *human* | Rebuilt frontier settlement (palisade, windmills, trading post) | Reject Architect *and* mutation; rebuilding humanity by hand. The eventual safe hub. |

**Joinable via ideology rep:** each camp is the physical home of its ideology. Rep unlocks turf,
vendors, quests, recruitment. Aligning with a renounce faction should make the city's own turrets
read you as an invader — joining the Wildblood can turn the Main Gate hostile.

## The wall / gate / turret mechanic (kill-zone tier)

New mechanic → **its own plugin** (working name `perimeter`), per the engine-vs-plugin rule. Not a
warfare layer. Every seam below is a real, current entry point (verified 2026-07-17):

- **The Curtain (impassable wall).** Register a move gate:
  `registerMoveGate(fn, 'perimeter:curtain')` from `server/engine/movement-gates.js` (callback
  `{ player, from, to, direction } → { block, message } | undefined`). Veto any move whose `to` tile
  carries `flags.curtain` and isn't a gate. Model on `plugins/yacht/index.js:34` (`yacht:board`).
  **Caveat:** TELEPORT and flight arrivals *bypass* move gates (`plugins/yacht/README.md:69`) — if the
  wall must be absolute, add a smite-on-arrival backstop like the yacht does.
- **Gates.** `flags.perimeter_gate` tiles are the only passable breaks; guarded by gate NPCs. The move
  gate lets these through (optionally checking wanted/alignment for a "papers, please" beat).
- **The glacis kill-zone.** `flags.glacis` tiles. On entry / on a turret tick, deal damage with
  `applyStrikeToPlayer(actor, { min, max, damageType: 'energy' })` (`server/engine/combat.js:392`) —
  the same primitive flight AA uses; **copy `rakeGroundBelow`** (`plugins/flight/combat.js:491–528`):
  it gathers `getZonePlayers(zone.id)`, strikes behind a cooldown (`GROUND_GUN_COOLDOWN_MS`), and
  routes `killed` through `handlePlayerDeath(victim, killer, { type, label })`. Do **not** reuse the
  Custodian `describe.js:568` turret loop — it clamps to 1 HP and never kills.
- **"Invader" test** (who the turrets fire on): renounce-aligned **or** wanted.
  - renounce-aligned: `Number(getFlag('player', 'stance_axis', player)) < 0` (the redeem↔renounce
    axis; `plugins/ideologies/index.js:9`). For the *specific* org, `classifyLean(stance, pathAff, …)`
    (`server/engine/ideologies.js:71`) returns Wildblood/Exodus/Pioneers on negative stance.
  - wanted: `Math.floor(parseFloat(getFlag('player', 'wanted', player) || '0')) >= N`
    (`plugins/jail/index.js:226`).
  - **Hot-path cost:** `getFlag` at `player` scope is a DB round trip per call
    (`server/engine/flags.js:32`; only `world` scope is cached). The turret tick **must cache** both
    values per player-id with a short TTL — never read them raw every tick.
- **Power dependency (blackout = guns cold).** Guard every turret with
  `isZonePowered(zone.id)` — copy the helper from `plugins/atm/index.js:86` over
  `getPowerMap()` (`server/engine/environment.js:1933`, in-memory, no DB). Free EMP-storm synergy: the
  extreme-weather grid blackout flows through the same map.
- **Scheduler.** Register the turret tick via `scheduler.js`, idle-gated on `hasActivePlayers()`.

## Build order (respects the phasing decisions)

- **Phase 1 — Wildblood (contiguous).** Curtain arc + Main Gate + killing ground + the hot badlands,
  hung off `map_world` south/SE of the current edge (`grid_y ≥ 920`, sparse tiles — the wilds are
  empty by nature, which keeps tile count and build cost down). Perimeter plugin (kill-zone),
  gate NPCs, Wildblood camp + vendor + rep hooks, radiation/mutation-flavored hazards. No soft
  on-ramp by design: gate → glacis → badlands.
- **Phase 2 — Exodus (first distant district).** New `map_id`, reached by road/flight from the Main
  Gate (the "leave it all behind" faction is literally reached by leaving). Launch mesa / caravan,
  Exodus rep + content.
- **Phase 3 — Pioneers (further expansion).** The frontier settlement — the eventual safe hub, either
  mid-wilds contiguous or another distant district. Trading post, quests, the human-purist counterpoint.

## Pinned Phase-1 spec (Wildblood)

Everything below is on `map_world`, contiguous, so you walk city → gate → glacis → badlands with no
map-hop. Tile counts stay small — the wilds are *meant* to be sparse.

**1. The gate road (retag existing tiles — no new zones).** The E–W track already sits at
`grid_y 915`. Extend it straight south down the `918` column to the wall:

| Tile | Now | Change |
|---|---|---|
| `zone_district_918_915` | already `terrain: road` | add `flags.artery` (so it shows on Avenue View / pathfinding) |
| `zone_district_918_916` | grass, already exits S→`918_917` | `terrain: road` + `artery` |
| `zone_district_918_917` | grass | `terrain: road` + `artery` |
| `zone_district_918_918` | grass, already exits S→`918_919` | `terrain: road` + `artery` |
| `zone_district_918_919` | grass, edge tile (no S exit) | **becomes "The South Gate"**: `terrain: road` + `artery` + `flags.perimeter_gate`; add **new `south` exit → `zone_district_918_920`** |

The N–S exit chain `918_915→…→918_919` already exists — we only paint terrain and open the one new
south exit. Gate NPCs (guards) live in `918_919`.

**2. The Curtain (wall the rest of the south edge).** The other south-row tiles (`x891–917`,
`x919–927` at `y919`) get `flags.curtain` for description/render and stay exit-sealed (no new south
exit). The move gate blocks any attempt to cross a `curtain` tile southward. Phase 1 only physically
realizes the **south** band; the east/west Curtain is described-but-not-yet-walkable-through until
those gates open (west → Ascendant, later).

**3. The glacis / killing ground (new zones, `flags.glacis`).** A short sparse fan just outside the
gate, turret-swept:
- `zone_district_918_920` — "The Glacis" (immediately outside the gate; N exit back to `918_919`).
- `zone_district_918_921`, `918_922` — cratered no-man's-land, thinning.
- Optional wings `917_921` / `919_921` for width.

**4. The Wildblood badlands (new zones, `grid_y ≥ 923`, spreading SE).** Sparse hot-marsh/ash tiles,
painted with the dedicated wildlands terrains (`scrub`/`redrock`/`ash`/`marsh` — the Terrain-Painter
"paint into existence" flow conjures them as `district:'wilds'` ground; ~295 zones already do), radiation
+ no-safe-haven weather. Anchor the **Wildblood camp** ~6–8
tiles out (e.g. `918_926` or off to `921_926` SE), with the camp's rep hooks, a Wildblood vendor, and
a mutation-flavored encounter or two. Deeper tiles seed the path toward the Phase-2 Exodus road.

**5. Content checklist for Phase 1:**
- `plugins/perimeter/` — move gate + turret tick + `regress.js` (run `npm run test:regress`).
- ~4 retagged district tiles + ~10–14 new wildland zones (glacis + badlands), `content/zones/`.
- Gate-guard NPC(s); Wildblood camp NPC(s) + vendor; wire `ideology_wildblood` rep/recruitment.
- New `flags`: `curtain`, `perimeter_gate`, `glacis` — register owners in
  [flags-keys.md](flags-keys.md).
- Ship via CODEX (`codex` skill); Curtain/gate/turret is a mechanic change → regress before push.

## The Wildblood camp

The faction stronghold beyond the south gate — **The Thornwarren** — has its own design doc:
[proposals/wildblood-stronghold.md](proposals/wildblood-stronghold.md) (camp footprint, the five NPCs,
the rep-tier + quest-flag recruitment arc, the Quickening mutation initiation, and the net-new
`GRANT_MUTATION` action). It's Phase 1's *faction content*, built after the wall/gate/turret work here.

## Resolved decisions

- **Main Gate = south, `zone_district_918_919`.** West reserved for Ascendant; south is the clean,
  road-alignable, renounce-flavored edge.
- **Turret damage** = `applyStrikeToPlayer(… damageType:'energy')`, copying flight's `rakeGroundBelow`;
  kills route through `handlePlayerDeath`. (Not the Custodian loop.)
- **Wall** = `registerMoveGate` on `flags.curtain`, gates = `flags.perimeter_gate`, plus a
  teleport/flight smite backstop.
- **Phase-1 realizes the south band only.** East/west Curtain is flavor until their gates ship.

## Answered: the three build-time questions

**1. Curtain rendering — described band + a distinct minimap edge, NOT a terrain value.** The Curtain
is a *vertical* energy wall, not a ground surface, so it does **not** go in `flags.terrain` (which is
the ground-surface SSOT). A `flags.curtain` tile keeps its real terrain and gains two things: (a) the
`perimeter` plugin appends a sensory band to the room description via a describe hook — *"South, the
Architect's curtain-wall stands: a floor-to-sky sheet of hard light, humming, cold. There is no way
through here."*; (b) a small new client rule in `minimap.js` draws a bright field-colored shimmer edge
on curtain tiles (reuse the artery/Avenue-View edge-drawing hooks) and a distinct **gate glyph** on
`perimeter_gate` tiles. No new terrain type; the Curtain is a wall overlay, the gate is a marked
opening. **Also rendered in the flight sim:** `state.js` emits a `cur` run-axis field (from
`curtainRun()`) on curtain/gate tiles and `mark: 'gate'` on the gate, and the windshield draws
`drawCurtainWall` (the 3-D energy wall) and `drawSouthGate` — so the barrier reads from the air too,
not just the minimap.

**2. Gates are a soft social gate; turrets are the hard lethal one — asymmetric by direction.**
*Leaving* is easy: a clean citizen passes the gate freely (guards give flavor/warning only — *"Nothing
out there but the feral and the dead. Your funeral."*); outbound movement never draws turret fire. The
danger is all on the way *back in*: the glacis turrets fire on **renounce-aligned or wanted** actors
moving cityward, and the gate guards **refuse entry** to the `visibly_mutated` or `wanted ≥ N`. So a
fresh player wanders out fine; once the Quickening marks you, the same gate is a gauntlet. That
asymmetry ("leaving is free, coming back dirty is deadly") is the whole tension — and it's cheap: one
outbound flavor path, one inbound refusal check, the turret tick already built.

**3. Camp = the Thornwarren cluster ~`919–922 / 924–926`** (table above), anchored at the Commons
`920_925`. The **badlands fan spreads ~4–5 rows deep** (glacis `y920–922` → marsh/camp `y923–926`)
before the reserved Phase-2 stub at `921_927` hands off to the Exodus road. Total Phase-1 footprint:
~4 retagged gate-road tiles + ~3 glacis + ~7 camp/badlands = **~14 new zones**, deliberately sparse.

## Still flexible at build time

- Exact mutagen/feral-gear/rad-med item list for Rindle's shop (all net-new).
- Whether the initiation mutation is the new `mut_thornhide` or reused `mut_bone_spurs`.
- The specific renouncing act for "The Proving" (salvage fetch vs. drone kill vs. rad-exposure).
