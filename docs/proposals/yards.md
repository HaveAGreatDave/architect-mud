# The Yards — a semi-industrial freight district (proposal)

> **Status: BUILT** (stamped 2026-07-24 by doc audit; was "SPEC — not yet built"). 81
> `zone_yard*` zones ship in `content/zones/` (the freight buildings plus the
> `zone_yards_tenement_*` block), with `npc_yardmaster`/`npc_yardmaster_barlow`/`npc_yard_teamster`,
> and the pooled Logistics Store is live as `corp warehouse list|deposit|withdraw`
> (`plugins/corps/ventures.js:149-163`, help line `plugins/corps/index.js:1072`). A new district on `map_world` south of
> Coldwater Regional airport, purpose-built as fertile ground for corporations. It reuses the shipped
> corp **venture** framework, adds one distinctive warehouse mechanic (a pooled Logistics Store), and
> gives every building type a bespoke flight-sim 3D model. Read [systems-corps.md](../systems-corps.md)
> + [proposals/corporate-assets.md](corporate-assets.md) (ventures), and
> [reference/world-rendering.md](../reference/world-rendering.md) (flight-sim models) first — this spec
> builds directly on both.

## The one idea

**A freight district wedged between the airport, the water, and the residential block — with no PvE
mobs but PvP on and cameras watching — where corps claim warehouses, run them for income, pool them
into a shared logistics backbone, and fight over the turf.** It is the content that finally exercises
the `warehouse` venture stub, and it reads unmistakably as an industrial district from the cockpit.

## Geography (as-authored, `map_world`, lower y = north)

The developable band is the placeholder "Grasslands" tiles between the airport (y ≤ 906) and the
residential/Precinct-9 block (y ≥ 910), bounded east by Coldwater Basin water. Kessler Street already
runs E–W through y908.

```
        x921    x922      x923    x924        x925     x926   x927
 y903            ...        Hangar          ┃Runway    #apron  ≈≈≈   AIRPORT (af_regional)
 y906                                        #apron            ≈≈≈
 ────────────────────────────────────────────────────────────────
 y907   Fwd.    Bonded WH  Fuel Yd  Container    #apron         ≈≈≈  ┐
 y908  Velk's ══════ Kessler Street ═══════════════ Wharf      ≈≈≈  ├─ THE YARDS
 y909            ...        Freight  General WH  Fab   Coldline      ┘
 ────────────────────────────────────────────────────────────────
 y910  NeonVig  HallRec                                              RESIDENTIAL / Precinct 9
 y911           P9(922)              PowerPlant→Watts(924)              (Watts stays here)
```

## Zone posture (all ~9 band tiles)

- `flags.district: "yards"` (new value alongside wasteland/water/residential/docks).
- **No enemy spawns** — the Yards has no `zone_spawns` (PvE-quiet by design).
- **PvP is on by default** — PvP is the law everywhere in Architect; the exception is the `sanctuary`
  flag, which the Yards does **not** carry. No PvP flag is needed (the old `pvp_enabled` column was
  dropped 2026-07; opt-out is `sanctuary`).
- **Camera-surveilled** — witnessing is furniture-driven, not a zone flag: a powered PD camera
  (`object_type: "security_device"` on a police `security_network`; `plugins/surveillance/index.js`
  `getPoliceCamZones`/`isWitnessed`) makes its zone camera-watched, so open violence there trips the
  witnessed-crime / wanted system. We place PD cameras on the warehouse rows.
- Danger tier `unsafe` (drives ambience/pacing; no mobs).

## Building roster

| Tile | Building | Fiction | `building_type` (→ 3D model) | Corp flags |
|---|---|---|---|---|
| 921,907 | Air Freight Forwarder | — | `freight_forwarder` | — |
| 922,907 | Bonded Warehouse | Customs Bonded Store 7 | `warehouse` | `claimable_asset:warehouse` + `claimable` |
| 923,907 | Pallet & Fuel Yard | — | `fuel_yard` | — |
| 924,907 | Container Yard | Interchange Stack | `container_yard` | `claimable_asset:warehouse` + `claimable` |
| 926,908 | Wharf Transfer Shed | — | `wharf` | — |
| 923,909 | Freight Office | Barlow's freight desk | `freight_office` | — |
| 924,909 | General Warehouse | Dry Store 12 | `warehouse` | `claimable_asset:warehouse` + `claimable` |
| 925,909 | Fabrication Shed | — | `fabrication` | — |
| 926,909 | Cold Storage | Coldline Reefer Depot | `cold_storage` | `claimable_asset:warehouse` + `claimable` |

Notes:
- The **4 claimable warehouses** (Bonded, Container, General, Cold Storage) are each both **territory**
  (`flags.claimable` → the `zone_control` contest layer) **and a venture** (`flags.claimable_asset:
  "warehouse"` → the `org_ventures` income layer). Venture `asset_type` is always `warehouse`; the
  independent `building_type` drives the visual model, so Cold Storage/Container Yard render bespoke
  while still claiming as warehouses.
- **Enterable buildings (facade + interior).** Each building is a non-standable `facade` tile that
  forwards into its own interior (`is_interior` zone + a `content/maps/map_int_yard_*.json` record with
  `parent_zone_id`/`entry_zone_id`). This is what unlocks the standard **map-icon** system (both the
  minimap and Tablet bigmap are `facade`-gated). Because a facade can't be stood on
  (`resolveFacadeTransit` — step on → forwarded inside), **the corp mechanics live INSIDE**:
  `flags.claimable_asset: "warehouse"` sits on the 4 warehouse **interiors**, so you `corp asset claim`
  and use the pooled Logistics Store from within. Building-tile territory (`claimable`) is dropped —
  buildings are *businesses* (ventures), streets are *territory* — so venture influence projects into
  the interior's `zone_control` (off the strategic map, an accepted trade for enterable buildings).
  **Barlow works inside** the Freight Office (`work_zone_id: zone_yard_freightoffice`). PD cameras +
  Barlow's gig remain follow-ups.
- **Map icons (bespoke).** Each `building_type` gets a 24×24 stroke SVG in
  `client/game/assets/zone-icons/bldg_*.svg` (warehouse/container/fuel/cold/fab/wharf/freightoffice/
  forwarder), registered in `BUILDING_TYPE_ICON` (`server/engine/world.js`). **Rule going forward:
  author a building's map icon in the same build as the building**, like its flight 3D model.
  *(Superseded detail: this shipped with a second glyph in `BUILDING_ICON`
  (`client/game/js/panels/minimap.js`) for the map's "icons" overlay mode, and treated `marker` as
  dead legacy. That mode and that table are gone — `marker` is now what the map's lettering draws.)*
- **Watts stays at the Coldwater Power Plant** (924,911, one block south) — adjacent, thematically the
  Yards' grid/repair mechanic. Not relocated.

## Anchor NPC — Sten Barlow, the Yardmaster

Weathered ex-hauler running the Freight Office (923,909). Vendor of salvage/haulage gear (crowbar,
load straps, hand truck, hi-vis, work gloves, freight manifest) + a starter gig **"Lost Consignment"**
(recover a misrouted crate). Fresh name (avoids the existing Voss NPCs). Built per the standard NPC
content flow (dev API / content JSON; clothing/sex/npc_type auto-handled).

## Workstream 1 — Content (CODEX, no engine)

- Convert the 9 placeholder Grasslands tiles into the facades above (edit the existing
  `content/zones/zone_district_92{1..6}_90{7,8,9}.json`), setting `district:"yards"`, `building_type`,
  `building_name`, `facade`/`is_building`, and — on the 4 warehouses — `claimable` +
  `claimable_asset:"warehouse"`. Existing cardinal exits are preserved (the street grid stays intact).
- Create **Sten Barlow** (vendor) at the Freight Office surface tile (`work_zone_id`), reusing
  salvage/haulage stock.
- **Deferred follow-ups:** walk-in interiors, PD cameras (SPECTER `security_devices` on a police
  network), and Barlow's "Lost Consignment" gig.
- Ships to prod via the normal CODEX push (git as source of truth); additive, regress-gated.

## Workstream 2 — Engine: warehouse venture + pooled Logistics Store (`plugins/corps/ventures.js`)

The generic venture framework already handles claim → passive income → influence projection →
dormancy/revive → console for any type; the `warehouse` entry is a stub. This workstream:

1. **Real numbers** in `CORP_ASSET_TYPES.warehouse`: `passiveFloor 45, activeShare 0, upkeep 12,
   influenceProjection 2` (starting values, tunable). No storefront vendor (warehouses aren't consumer
   shops), so income is the passive floor + territory influence, not a sale cut.
2. **Pooled corp Logistics Store** — the distinctive warehouse payoff:
   - One shared corp stash reachable from **inside any owned warehouse interior** via a `corp`
     subcommand (`corp warehouse deposit|withdraw|list`), corp-permissioned (reuse an existing perm bit).
   - **Reuses the generic container substrate** — items live in `player_inventory` with
     `container_id = "corp_store_<orgId>"` (the same plumbing furniture/ground containers use;
     `server/engine/commands/inventory.js` — `cmdStow`/`cmdPull`/`containerContentsWeight`). There is no
     separate vault table.
   - **Weight-based capacity** (the substrate is grams, not slots): **capacity = Σ(200 kg × level)**
     across every `warehouse` venture the corp owns — a scaling logistics backbone, far larger than a
     60 kg furniture container. The corp verb computes capacity from owned ventures and enforces it via
     the existing `containerContentsWeight` sum, adding the corp scope the plain container path lacks.
3. `regress.js` extends the existing asset loop to cover: claim a warehouse → assert venture row →
   run tick → assert floor − upkeep + influence → deposit/withdraw against the pooled store → assert
   capacity scales with owned warehouses. `npm run test:regress` is the gate.

## Workstream 3 — Engine: bespoke flight-sim models (`client/game/js/panels/windshield.js`)

Per [reference/world-rendering.md](../reference/world-rendering.md): each model is a `case` in
`drawTypeModel` (composed from `draw3DBoxAt` / `drawFacetDrum` / `drawBarrelRoof` + decoration
helpers, all routed through `emitFace`), a `ty_*` palette in `WALL_COL`, and a `TYPE_MODEL[<key>]`
registration; the tile carries the matching `building_type` flag (under `flags`). There is **no**
existing warehouse/industrial model today — warehouses fall back to the generic `drawFreight` shed — so
all 8 are net-new. The airport **`hangar`** case (ribbed-steel `draw3DBoxAt` walls under a
`drawBarrelRoof`, its palette key registered in the `METAL_WALL` set) is the reuse template for the shed
types; each new ribbed-steel `ty_*` key must be added to **both** `WALL_COL` and the `METAL_WALL` set.
**8 bespoke models:**

| `building_type` | 3D read | Primitive recipe |
|---|---|---|
| `warehouse` | Long low shed, corrugated steel, barrel roof, roller doors | `draw3DBoxAt` + `drawBarrelRoof`, `METAL_WALL`-style ribbed key |
| `container_yard` | Stacks of bright intermodal boxes | many small `draw3DBoxAt`, saturated per-box palette |
| `fuel_yard` | Cylindrical tank farm + pipe runs | `drawFacetDrum` drums + thin connecting boxes |
| `cold_storage` | Windowless insulated block, rooftop condenser units, frost-white | box + small roof boxes, pale `ty_cold` |
| `fabrication` | Shed + gantry crane + smoke | warehouse shed + `mast`/`drawSmoke` |
| `wharf` | Dock deck + loading crane over the water edge | low box + angled crane-arm boxes |
| `freight_office` | Small 2–3 storey office w/ signage | `draw3DBoxAt` + `marqueeBand`/`neonBlade` |
| `freight_forwarder` | Warehouse w/ open loading-dock front (canopy + bays) | shed + canopy boxes via `F()` frontage |

**Collision caveat:** building mass drives the CFIT sweep — keep heights realistic (low sheds, tallish
tanks) and rooftop adornments visual-only.

## Build order

1. **Content** (workstream 1) — the district as walkable content; most of the feature ships here with
   no code.
2. **Corps engine** (workstream 2) — warehouse numbers + pooled Logistics Store; regress green.
3. **Flight models** (workstream 3) — the 8 `drawTypeModel` cases + palettes.
4. **Wire & verify** — set the `claimable`/`claimable_asset`/`building_type` flags, then dogfood the
   full loop (claim → income → influence → shared store) and a flyover check for each model.

## Resolved seams (recon complete)

- **PvP** = default everywhere; `pvp_enabled` dropped 2026-07. Opt-out is the `sanctuary` flag; the
  Yards omits it. No PvP flag needed.
- **Cameras** = furniture, not a flag: a powered PD `security_device` on a police `security_network`
  (`plugins/surveillance/index.js` `isWitnessed`/`getPoliceCamZones`). Place cameras on the warehouse rows.
- **Storage** = generic container substrate (`player_inventory.container_id`, weight capacity via the
  `container` tag; `inventory.js` `cmdStow`/`cmdPull`/`containerContentsWeight`). Corp store = a
  `corp_store_<orgId>` synthetic container id + plugin-side capacity from owned ventures.
- **Flight** = no existing warehouse model; `modelFor` picks `NAMED_MODELS[bn]` then `TYPE_MODEL[bt]`
  (both from `flags.building_name`/`building_type`). Reuse the `hangar` shed recipe.

## Open (deferred, not required for v1)

- Flipping the district (or parts) to genuinely dangerous later (add mobs / raise danger) — the flags
  are structured so this is additive.
- Repurposing the vacated flavor buildings into further ventures (front office / security office) once
  those stub types are fleshed.
