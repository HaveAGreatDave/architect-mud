# Coldwater Expansion — World Map Plan (LOCKED)

**Status:** Concept LOCKED 2026-07-03. Design only — **nothing is built; no DB writes have been made.**
This doc is the source of truth for the next `map_world` expansion.

## At a glance

The live world is a long east–west spine of **41 surface tiles** (Slagworks · Ashway · Ruins/Badlands · City Core · Marquee). The expansion fills it out into a deliberate **20×11 rectangle** (grid x −11..8, y −7..3 = 220 surface cells) with organic, non-grid district borders, then adds a subterranean layer.

- **41** live tiles (unchanged)
- **179** proposed surface tiles (fills every remaining cell; water counts as a filled tile)
- **14** proposed underground tiles (z-1 metro + z-2 caverns)
- **193 new zones** total when built out.

## Maps (in this folder)

| File | What it shows |
|---|---|
| [coldwater-expansion-map.svg](coldwater-expansion-map.svg) | **Detailed tile map** — every tile as a labelled square, coloured by district |
| [coldwater-expansion-map.gen.mjs](coldwater-expansion-map.gen.mjs) | Deterministic generator for the tile map (`node coldwater-expansion-map.gen.mjs out.svg`) |
| [coldwater-style_terrain.svg](coldwater-style_terrain.svg) | **Terrain** lens — water / city / docks / slaglands / Redline |
| [coldwater-style_danger.svg](coldwater-style_danger.svg) | **Danger** heatmap — safe → lethal |
| [coldwater-style_function.svg](coldwater-style_function.svg) | **Land-use** — govt, port, freight, trade, industry, nightlife, hazard |
| [coldwater-style_faction.svg](coldwater-style_faction.svg) | **Faction control** — corp, police, independents, gangs, mutants, scavengers |
| [coldwater-style_existing.svg](coldwater-style_existing.svg) | **Existing vs Expansion** — two-colour overlay (built vs proposed) |
| [coldwater-style_phases.svg](coldwater-style_phases.svg) | **Build phases** — 12 balanced ~15-tile regions, ordered outward from the core |
| [coldwater-styles.gen.mjs](coldwater-styles.gen.mjs) | Generator for all six style lenses (imports the tile-map generator's data) |

Borders use a fixed sin-hash (no RNG), so the maps are reproducible. The style lenses import the tile-map generator's data, so editing the layout and re-running keeps everything in sync (`node coldwater-styles.gen.mjs`).

## Regions (surface)

| Region | Where | Tiles | Danger | What it is |
|---|---|---:|---|---|
| **North City** | north band, y −4..−7, east of the buffer | 27 | safe | Govt / corporate / residential heights above the Spire |
| **Uptown / Halcyon Spire** | y −2..−3, x 0..5 (minus docks) | 7 | safe | Elite / finance; the Spire tower interior |
| **Civic North** | y −1..−3, x −1..−3 | 6 | safe | Civic / institutional infill |
| **Coldwater Bay** *(water)* | north-central inlet, x 0..5, y −4..−7 | 16 | — | A harbour biting south into the city |
| **The Docks** | **bunched** on the bay's south shore, x 1..4, y −3..−4 | 6 | low | Waterfront: Wharf, Quays, Fishmarket Dock, Smuggler's Slip, Cold Storage, Boat Yard |
| **The Yards** | east block, x 6..8, y −1..2 | 22 | low–med | Freight / warehousing / rail (relabelled from the old east "docks") |
| **Undermarket / Deep Sprawl** | south band, y 2..3 | 16 | med–high | Black market, slum, gangs |
| **The Redline** ☢ | far NW block, x ≤ −8/−9, y −4..−7 | 18 | **LETHAL** | Irradiated / mutant / gang no-go zone |
| **Outer Wastes** | west + south fill, and the north buffer band | 61 | low–med | Industrial ruin & wasteland; mostly connective terrain |

Key geography choices (locked through live iteration):
- The **Redline** is a NW blob held **west of a wastes buffer** so it never abuts the city; you cross wasteland to reach it. It joins the **Slagworks** by a **single-column neck** (x=−11 down to the Reclaimer) — one link, no wrap-around.
- The **Docks** are a single bunched quarter on the water, **not** a ring around the whole shoreline. The old east waterfront is now **The Yards** (landlocked freight).
- The green-brown/rust-red seam (wastes↔Redline/north) **undulates** per column rather than running straight.

## The Under (z-1 / z-2) — 14 tiles

A subterranean layer, shown as an inset on the tile map:
- **z-1 metro line:** Slagworks Halt · Ashline Cut · Central Exchange (↑Threshold) · Marquee Platform · Dockside Terminus, with Uptown and Reservoir spurs.
- **z-1 branch:** Sprawl Platform · Sump Junction · The Nest.
- **z-2 caverns:** The Sunless Sea · Fungal Cavern · The Deep Line · Maintenance Vault.
- Walkable station-tunnels (pure content). A "ride the train" fast-travel verb would be a **future plugin**, not part of this content build.

## Build phases

Phasing is **geometric, not thematic**: the 179 new tiles are split by median-cut into **12 balanced regions of ~15 tiles each** (see [coldwater-style_phases.svg](coldwater-style_phases.svg)), ordered **outward from the existing core (0,0)**. Each phase is a compact block ≈15 tiles; some blocks straddle already-built tiles (shown grey on the phase map — you only build the new ones). Ship each phase playable and verified before the next; **The Under** (z-1/z-2, 14 tiles) is the final phase.

| Phase | Footprint (grid) | New | Mostly |
|---:|---|---:|---|
| 1 | x −2..4, y −2..3 | 15 | Undermarket foot (south) + Uptown approach (north) — flanks the plaza |
| 2 | x −5..−2, y −3..3 | 15 | West wastes + Civic edge + market fringe |
| 3 | x −1..4, y −5..−3 | 15 | Coldwater Bay + the Docks + spire/civic shoreline |
| 4 | x −8..−5, y −3..3 | 15 | Outer wastes (mid-west) |
| 5 | x −1..4, y −7..−5 | 15 | North City + upper Bay |
| 6 | x −5..−2, y −7..−4 | 15 | North buffer wastes + North City (west) |
| 7 | x 4..8, y 0..3 | 14 | The Yards (south) + undermarket edge |
| 8 | x 5..8, y −4..0 | 15 | The Yards (north) + spire east |
| 9 | x 5..8, y −7..−4 | 15 | North City (east) |
| 10 | x −8..−5, y −7..−3 | 15 | Upper-west wastes + Redline fringe |
| 11 | x −11..−8, y −2..3 | 15 | Far-west wastes + Redline neck |
| 12 | x −11..−9, y −7..−3 | 15 | **The Redline** core (lethal NW) |
| U | z-1 / z-2 | 14 | The Under — metro + caverns |

Every phase attaches to already-built tiles on at least one edge, so the world stays connected as it grows.

### Phase 1 — the core-adjacent square (build first)

Phase 1 is the ~6×5 block wrapping the existing central plaza (`grid x −2..4, y −2..3`). Its 15 new tiles fall in **two clusters** flanking the already-built core, each attaching to a live edge:

**A. Undermarket foot** — south of **The Sprawl** (10 tiles): The Warrens (−2,2), Cardboard Row (−1,2), Scab Alley (1,2), Gutter Market (2,2), Rot Row (−2,3), Wormtown (−1,3), The Maw (0,3), Bonepicker's End (1,3), Gasp Hollow (2,3), The Deep Maw (3,3).
- **Attach:** south exit from **The Sprawl** (`zone_slums`, 0,2) → Ash Market/The Maw; lateral links across the row.
- **Content:** medium→high danger shanty market; a **black-market vendor** (food/drug stalls) and a **ripperdoc**; a **sprawl-ganger enemy** on a new deep-sprawl scav table; ambient beggars/hustlers.

**B. Uptown approach** — north of the plaza (5 tiles): Aid Station (−2,−2), Uptown Gate (1,−2), Spire Approach (2,−2), Skyway Landing (3,−2), Chrome Heights (4,−2).
- **Attach:** north exits from **Custodian Row** (1,−1), **Halcyon Walk** (2,−1), **Cathode Row** (3,−1), **Foundry Cut** (4,−1).
- **Content:** safe but high-security; an **Uptown Gate checkpoint** (armed guard NPC, wanted-system tie-in), corporate-drone ambient NPCs, an **Aid Station** (civic — medic/heal vendor).

*Note: geometric phasing means Phase 1 mixes two themes (slum + corporate approach). If you'd rather build thematically-coherent districts, the phase map is only a suggested order — pick any single cluster to start.*

## Build method (when greenlit)

Per [reference-mud-content-build] practice: **direct-DB writes + `POST /api/world/reload`** (the dev API is flaky at scale and its exit auto-repair strips exits to not-yet-created zones). `tools/design-cli.mjs` needs `CLAUDE_MUD_USER/PASS` in `.env` (absent) — mint an unsigned admin token instead. Follow the **Marquee District** as the district exemplar. Pre-seed `vendor_stock` for any shop. ~100 of the wastes/Redline tiles are auto-named placeholders — give them real descriptions or accept them as thin connective terrain.
