# Terrain & the Terrain Painter (as built)

Terrain is the **ground surface** of a zone tile (road, concrete, grass, water,
dock…). It is authored per-zone in `flags.terrain` (a single string) and painted
through a dev-panel Maps mode. It is **presentation + pacing, not passability** —
passability is still governed by the separate `flags.water` boolean.

## `flags.terrain` — the SSOT

Canonical values (palette `TERRAIN_TYPES`, [maps.js:994](../client/devpanel/js/panels/maps.js)):

| key | label | fill |
|---|---|---|
| `road` | Road | `#4c5157` asphalt + yellow markings |
| `asphalt` | Asphalt | `#45484d` |
| `concrete` | Concrete | `#8a8d91` |
| `grass` | Grass | `#5a9e57` |
| `dirt` | Dirt | `#6b5138` |
| `sand` | Sand | `#c2b280` |
| `gravel` | Gravel | `#7d7a73` |
| `dock` | Dock | `#6e5636` wooden decking |
| `water` | Water | `#3f7fb0` |

Commit `37805fd1` painted `concrete` (one `road`) across 37
`content/zones/zone_district_*.json` cells with this tool.

### Server resolution — `zoneTerrain(zone)` ([world.js:222](../server/engine/world.js))

Authored value wins; otherwise the surface is **inferred** so un-backfilled DBs
(prod) still render sensibly:

1. `flags.terrain` (SSOT) →
2. `flags.water` → `water`
3. `flags.pier` → `dock` (added `b3a184ac`)
4. `flags.icon` matching `/^(road_|runway_)/` → `road`
5. a building footprint (`buildingIconSvg` truthy) → `null` (not terrain)
6. green-dominant `bg_color` → `grass`
7. else `null`

Companions in `world.js`: `roadConnector()` auto-tiles a road tile's connector
SVG from orthogonal road neighbours; `tileIconSvg()` returns an authored
icon/rooftop first, else the road connector for `terrain==='road'`. The `terrain`
string is emitted on every map/minimap node (`getMinimapData`,
`world.js:880`) and the movement/look payload (`movement.js:736`).

## Dev-panel Maps editor

All in [client/devpanel/js/panels/maps.js](../client/devpanel/js/panels/maps.js)
(staging via [core/staging.js](../client/devpanel/js/core/staging.js)). Terrain
block starts ~`:989`.

- **Terrain paint mode** — `toggleTerrainMode()` (`:1014`), floating top-right
  palette `terrainPanelHtml()` (`:1192`). State: `mapTerrainMode`,
  `mapTerrainType` (def `road`), `mapTerrainTool`. The four map modes
  (paint / safe-zone / terrain / move-building) are mutually exclusive.
- **Tools:** **Brush** `_terrainBrush()` (drag-paint; ctrl/right-click erases),
  **Flood-fill** `terrainFill()` (BFS over the *visible* surface),
  **Eyedropper** `terrainPick()`, **Rectangle-select**
  `terrainRectStart/Over/Commit` (marquee applies the brush to every covered cell).
- **Preview mirror** — `mapZoneTerrain()` (`:1025`) mirrors server `zoneTerrain`
  so the editor previews the true surface (incl. inference) even before backfill;
  road tiles preview their auto-tiled connector via `mapRoadConnector()`.
- **Staging** — every stroke stages a single-flag PATCH through the Changes
  panel; nothing goes live until Publish. `_mapPendingOverrides` merges `terrain`
  into `flags` on apply.
- **Tight grid + untyped tiles** (`28315361`) — the old interleaved
  `110px`/`16px` gap-connector template is gone; tiles now touch on a plain
  `110px × 76px` grid and connections auto-wire on drag. In terrain mode a tile
  with no known/inferred terrain falls back to its authored `bg_color` (via
  `zoneColorStyle`) instead of rendering as a blank hole.

### Move Building flow

`toggleMoveBuildingMode()` (`:1224`): click a building tile to arm, click an
empty destination cell → `moveBuildingPropose()` POSTs `/maps/move-building`
(server `apiMoveBuilding`, [routes.js:906](../server/api/routes.js) — validates
the destination is empty with an adjacent street, prefers a road-terrain
neighbour). Staged as one grouped `building_move` change that publishes
atomically; interior rooms + front door move with the facade.

## Runtime consumption

- **2D minimap** ([minimap.js](../client/game/js/panels/minimap.js)) — `TERRAIN`
  set + `terrainFill()` (water/grass prefer authored `bg_color`; others use the
  canonical fill). Textured types get `.mm-<terrain>`/`.map-<terrain>` classes;
  CSS textures (water/grass/dock plank) live in
  [styles.css](../client/game/styles.css) (`.mm-dock` ~`:2555`).
- **Tablet map** ([tablet-os.js](../client/game/js/panels/tablet-os.js)) —
  `TOS_TERRAIN_FILL` (`:2768`) + `terr-<type>` tile classes.
- **Pacing** — `minimap.js` uses `terrain === 'road'` (or a non-empty `artery`)
  to pick the run-vs-walk step animation timing. Not passability.
- **Flight** — `flags.terrain` does **not** flow into the aerial renderer
  directly. The flight Mode-7 world consumes a separate aerial window whose cells
  carry district-derived `biome` + road state; terrain edits reach flight only
  indirectly (roads/water via their own flags). See
  [reference/world-rendering.md](reference/world-rendering.md).
