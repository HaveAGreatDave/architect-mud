# District Editor → Game Map — Process Log

The District Editor (`tools/zone-planner/`, served on **port 5178**) turns a painted
`bp_district` blueprint into a real, self-contained slice of `map_world`: terrain,
named roads, a connected minimap network, and the city's buildings relocated into
the district.

---

## ✅ Built & verified

### Building audit (`serve.mjs`)
- `GET /api/buildings` derives the canonical building list from `content/maps` entry
  zones — **23 buildings**, one per interior map. Back rooms, floors, exterior
  frontages, and outdoor markets are all excluded automatically. Verified nothing
  with a building signal is left out (the exterior `The Threshold`/`map_world` entry
  is guarded out by requiring `is_interior`/`hangar_interior`).

### Editor (`editor.html`)
- 🔗 **Link mode** — per-tile 2-letter code + manual link to a real zone; matching by
  **name-initials** (Embassy Hotel & Bar → `EH`).
- **Buildings audit panel** — matched / unmatched / unplaced-bucket; lists show full
  zone names.
- **Place-from-bucket** — click a building → paint a linked marker tile.
- **Export audit dialog** — warns of homeless buildings *and* unlinked placed tiles
  before Apply.
- **Runway NS** is a permanent built-in palette tile (`ensureBuiltins`).

### Export (`apply.mjs`)
- **Road naming** — polyline model: one name along a road through bends and
  straight-through junctions; branches split into separate roads; ≥5 tiles to be
  named (short stubs absorb a neighbour's name); crossings show both names; roads
  **inherit an existing artery's name + membership** at the seam (Grand Avenue, The
  Haul Road, …).
- **Terrain naming + prose** — each non-road terrain is named for what it is, with 3
  varied descriptions and unique ids:
  - `Grass` → **Grasslands**
  - `Water` → **Cold Channel** (single desc; water is impassable)
  - `Hangar 2` / `Runway NS` → **Runway** (Runway NS carries the N-S yellow centreline)
  - `SH` → **Residential Area**
  - `DK` → **Pier** (parts of one large pier)
  - plaza tiles keep their given label (Embassy Hotel, Fisherman Statue, …)
- **Road connectivity SVGs** — 16 variants (`road_ns`, `road_ne`, `road_nes`,
  `road_nesw`, …) in `client/game/assets/zone-icons/`; each road tile gets the icon
  matching its road neighbours → a continuous dashed network with real
  T-junctions/intersections on the minimap.
- **Palette** tuned — Grass green `#33512a`, Water blue `#1f4e70`, Roads grey `#3a3a3e`.
- **Buildings** → on-map facade markers with 2-letter labels, forwarding `in` to the
  existing interior.
- **Auto-connect (second pass)** — buildings → nearest street tile; **hangars →
  runway on their east end** (detected by the linked zone's `hangar_interior` /
  `building_type: hangar`, so bucket-placed `BLD` hangars are caught too).
- **Full relocation** — for each linked building: repoint the interior **map's
  `parent_zone_id`** to the district facade, redirect the interior's **`out`** into
  the facade, and **sever the old exterior's** door. The building *moves* into the
  district.
- **Unknown tags stripped** (with a warning, not fatal) — a stray tag like `dock`
  can never block an export again. Bad *shapes* on real tags stay fatal.
- Gated behind `--manual-building-exits`, which the editor always sends; a plain CLI
  run keeps the original facade-adjacency behaviour for other blueprints.

---

## 📊 Latest dry-run (`bp_district`)

```
888 cells → 888 zones · 18 building markers · 17 auto-connected
RELOCATE: 18 buildings moved in · 17 old exteriors severed · 0 stranded
```

---

## ⚠️ Before shipping

1. **Verify enter/exit in-game after Apply** — the facade transit (`resolveFacadeTransit`)
   only runs in the live game; walk into 2-3 relocated buildings and back out. This
   is the one thing not verifiable from the tooling.
2. **`zone_start` (clone facility / spawn)** loses its `zone_city_west` door on the
   sever — respawn still works (it uses `respawnZone`), but confirm that's intended.
3. **Palette colors** apply cleanly only via **CLI export** — the editor's Apply
   button re-saves the current editor session over the blueprint file, overwriting
   file-side colour edits. Set them in the editor, or export via CLI.
4. Everything lands in the **local dev DB first** → `npm run content:export` →
   **review the git diff** (18 maps, 18 interiors, 17 exteriors edited) → commit →
   push (the CODEX deploy). That diff is the safety gate.

---

## 🚀 Export command

```
node tools/zone-planner/apply.mjs tools/zone-planner/blueprints/bp_district.bp.json --apply --manual-building-exits
```

(Drop `--apply` for a read-only dry-run — it prints every zone, connection, and
relocation without writing.)

---

## Files touched

- `tools/zone-planner/apply.mjs` — naming, prose, road icons, building markers,
  second-pass connect, relocation, tag-stripping.
- `tools/zone-planner/serve.mjs` — `/api/buildings` (map-entry based).
- `tools/zone-planner/editor.html` — link mode, buildings panel, place-from-bucket,
  export audit, Runway NS built-in.
- `client/game/assets/zone-icons/road_*.svg` — 16 road connectivity icons.

All tools-only — nothing the server or the regression harness loads at runtime.

---

## Type → kind reference (export interpretation)

| Palette tile | template | → kind | exported name | descriptions |
|---|---|---|---|---|
| Road 1/2/3, MS | street | street | street name (per-run / inherited artery) | 3 road |
| DK | street | **pier** | **Pier** | 3 pier |
| Grass | zone | grass | Grasslands | 3 grass |
| Water, RD | water | water | Cold Channel | 1 shoreline |
| Hangar 2 | zone | runway | Runway | 3 runway |
| Runway NS | zone | runway_ns | Runway | 3 N-S runway |
| SH | building | residential_street | Residential Area | 3 residential |
| Fisherman Statue, plaza landmarks | plaza | plaza | (their label) | 3 plaza |
| BLD / Hangar (linked) | building | facade marker | linked building's name | — |
