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

Borders use a fixed sin-hash (no RNG), so the maps are reproducible. The style lenses derive from the same data module, so editing the layout and re-running keeps everything in sync.

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

Ship each phase playable and verified before the next. Attach points are existing live tiles.

1. **The Yards** (east, ~22 tiles) — extends off the current Marquee edge (Muster Yard 5,0 → and Tin Lane 5,1 →). Self-contained, repetitive-but-simple, best pipeline shakedown. *See "Phase 1" below.*
2. **The North** — North City + Spire + Civic + Coldwater Bay + The Docks. Attaches to the north edge (Threshold Plaza N, Custodian Row, Limelight Lot, Foundry Cut).
3. **Undermarket / Deep Sprawl** (south) — attaches to The Sprawl (0,2).
4. **The Redline + Outer Wastes** (NW + west/south fill) — attaches to Slagworks/Ashway; the wastes are largely connective terrain built alongside.
5. **The Under** — metro + caverns (z-1/z-2), then optionally the train fast-travel plugin.

### Phase 1 — The Yards (build first)

Freight & warehousing quarter directly east of the Marquee.

- **Geography:** ~22 tiles at grid x 6..8, y −1..2. New exits east from **Muster Yard** (`zone_mq_precinct`) and **Tin Lane** (`zone_mq_cage`).
- **Zones:** container/warehouse streets, a **rail depot** (The Railhead / The Marshalling Yard / The Interchange), a loadout/weighbridge, a dock-worker **bar**, plus utility interiors.
- **NPCs:** teamsters / dockhands (ambient), a **freight-fence vendor** (buys bulk & hot goods, sells salvage and containers), a yard foreman.
- **Enemy + loot:** yard scrappers or junkyard dogs (low–med), on a new **industrial-salvage scav table** bound to the yard zones.
- **Ties forward:** establishes the smuggling/freight theme that later links to the bay **Docks** (Phase 2) and the **Dockside Terminus** metro station (Phase 5).

## Build method (when greenlit)

Per [reference-mud-content-build] practice: **direct-DB writes + `POST /api/world/reload`** (the dev API is flaky at scale and its exit auto-repair strips exits to not-yet-created zones). `tools/design-cli.mjs` needs `CLAUDE_MUD_USER/PASS` in `.env` (absent) — mint an unsigned admin token instead. Follow the **Marquee District** as the district exemplar. Pre-seed `vendor_stock` for any shop. ~100 of the wastes/Redline tiles are auto-named placeholders — give them real descriptions or accept them as thin connective terrain.
