# The Under — Proposal & Phased Build Plan

**Status:** SCOPED 2026-07-03. The full metro/cavern build below is **not built**. A separate,
**minimal "North City gate corridor" IS BUILT (2026-07-03)** — see the box below. Build order for
the full project: **this project first**, then the [Interior Pass](interior-pass.md).

> ## BUILT: The Under — North City gate corridor (minimal)
> A small, self-contained slice that repurposes The Under as *the northwest gate to North City*,
> built ahead of (and independent from) the full metro/cavern scope.
> - **Surface wall:** the 14-tile NW North City enclave (govt block + west North City + the uptown
>   finger `zone_up_vellum`) is sealed. All 14 surface crossings into the surrounding wastes/bay/civic
>   grid were severed **except one chokepoint** — **The Steps**, `zone_civ_steps` ↔ `zone_up_vellum`
>   (marked ⛩). That is the only surface way in.
> - **The Under corridor (3 new z-1 tiles):** `zone_under_commons` (−3,−3, `up`→`zone_civ_commons`) →
>   `zone_under_deep` (−3,−4) → `zone_under_landing` (−3,−5, `up`→`zone_gov_mezzanine`). Descend at the
>   Commons, walk the tunnel, resurface inside the government quarter. Free walkable tunnel; **no
>   express train** (that's the future `plugins/metro/`).
> - **Verified:** global BFS — all 223 tiles reachable, no orphans; enclave boundary seams are exactly
>   The Steps + the Under landing.
> - **Scope boundary:** North City's **east** half (x 5..8, across the bay, reached from The Yards) is
>   untouched — this gates the NW approach only.
> - **Live:** content is in Postgres and **confirmed present in production** as of 2026-07-04 (a prior
>   2026-07-03 apply run silently failed to write to prod despite reporting success — re-ran and
>   verified by direct query). **World reload/restart still PENDING** to go live in-game.
> - Not done here (still the scoped build below): z-1 station ring, z-2 caverns, bestiary/apex, the
>   express plugin.

A z-1 metro + z-2 cavern layer beneath the 220-tile surface map. Solves the biggest post-expansion
pain (traversal cost across a full 20×11 rectangle) *and* adds an explorable underworld biome with its
own bestiary and an apex. The surface map is `map_world` grid_z 0; the Under lives on the **same
`map_world` map at grid_z −1 (metro) and −2 (caverns)**, linked to the surface by `up`/`down` exits.

## Locked design decisions
| Decision | Choice |
|---|---|
| Primary role | **Explorable underworld dungeon** (travel is a strong secondary) |
| Movement | **Both** — walkable tunnels (free) **+** express trains |
| Bestiary | **New underworld bestiary + a cavern apex** (Redline-horror scale) |
| Express gating | **Credit fare + power-gated** — costs credits per ride AND stops during blackouts |
| Express reach | **Core + Docks + Yards only** — the wastes/Redline stay earned on foot |
| Size | **Medium** — z-1 metro ~14 tiles + z-2 caverns ~12 tiles (~26 total) |

## What already exists (the stub)
- `zone_tunnels` "The Under" — `map_world` z-1 at (0,2).
- `zone_city_sw` "The Under Entrance" and `zone_slums` "The Sprawl" (0,2) — the surface `down` seam.
- The extreme-weather/power system already models blackouts (the "power-stays-out" scar) — the express
  power-gate reads that state; no new power model needed.

## The model
- **Metro (z-1):** a walkable tunnel network on `map_world` z-1. Stations sit *directly under* their
  surface district (same grid_x/grid_y, z-1) with an `up`/`down` pair to the surface tile. Tunnels
  connect stations with cardinal exits. Free to walk.
- **Express (z-1):** a **new plugin** (`plugins/metro/`) adds `board` / `ride <destination>` /
  `disembark`. Board only at an **express hub** (a subset of stations: Downtown, Marquee, Docks, Yards).
  Ride = pick a hub via SIFT, pay a credit fare, teleport to it. **Power-gated:** if the grid is in
  blackout, trains don't run (falls back to walking). Reach is core/docks/yards only — no frontier hub.
- **Caverns (z-2):** a natural biome below the metro, reached by `down` shafts from a few z-1 nodes.
  Not on the transit network — you delve on foot. Home to the new bestiary and the apex.
- **Danger gradient:** z-1 metro = low/medium (muggers, tunnel vermin); z-2 caverns = high→lethal at the
  apex. Mirrors the surface's earned-danger shape.

> **Engine note:** walkable tunnels + caverns are **pure content** (zones + exits + spawns, built via
> the coldwater direct-DB pipeline). The **express is a new mechanic → a plugin**; before building
> Phase 3, run the engine-vs-plugin-vs-content gate (`plugin-builder` skill). It needs: a fare seam
> (credits debit), a destination picker (reuse SIFT), and a read of the blackout state. Add a
> `plugins/metro/regress.js`.

## Phases
| # | Phase | Layer | ~Tiles | Deliverable |
|---|---|---|---|---|
| 1 | **Spine & entrances** | z-1 | ~6 | The trunk tunnel + 3 surface stair-downs (extends the existing stub); walkable end-to-end |
| 2 | **Station ring** | z-1 | ~8 | A platform under each served district (Downtown, Marquee, Docks, Yards, N. City civic, Undermarket) with up-links; tunnels close the ring |
| 3 | **Express system** | — | 0 | `plugins/metro/` — board/ride/disembark, credit fare, power-gate, SIFT destination picker; hubs = Downtown/Marquee/Docks/Yards; regress suite |
| 4 | **z-2 caverns** | z-2 | ~10 | The deep biome (Sunless Sea, Fungal Cavern, the Deep Line, the Nest…) reached by down-shafts; atmospheric shells + scav |
| 5 | **Bestiary & apex** | z-2 | 0 | New underworld enemies (tunnel/fungal/deep-water) + a cavern apex + a trophy; spawns across z-1/z-2; a capstone quest hook on the surface |

**Phase-1 exit criterion:** you can descend at ≥1 surface tile, walk the trunk, and resurface — verified
by DB exit reciprocity + a regress pass. Each later phase ships walkable/playable on its own.

## Open items to resolve at build time (not blockers)
- Exact station grid coords under the new districts (finalize when Phase 2 starts).
- Fare amount + whether it scales by distance.
- Whether the apex trophy feeds an existing NPC's capstone (e.g. a downtown fixer) or a new one.
- Cavern biome theming (fungal vs flooded vs machine-tomb) — pick per z-2 tile in Phase 4.

## Build method
Same as the coldwater expansion: direct-DB upsert + minted admin token; coord-map auto-exit generation
with reciprocal attach-merges; `npm run test:regress` gate every phase; memory + this doc updated per
phase. Content is DB-only and goes live on `npm start`; the metro plugin hot-loads on restart.
