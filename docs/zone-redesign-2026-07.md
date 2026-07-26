# Zone System Redesign — 2026-07

Reference record of the zone re-imagining implemented 2026-07-09: what changed, why,
the decisions and discoveries behind it, and what remains. **Shipped to prod in
`e3e1b1b8` (2026-07-10)** — the four columns are dropped everywhere. Note that the
358-zone `map_world` measured below was retired the next day (`c1f964e5`, 2026-07-11)
and replaced by the district world; the substrate survived the swap, the zone counts
did not.

## The problem

The map felt disjointed — players GPS'd between tiles instead of inhabiting a place.
Zone properties were a split-brain of columns + an untyped `flags` grab-bag, buildings
were rooms you stood "outside the doors" of, and authoring a district was one-zone-at-a-time
busywork. Design goals: buildings as map tiles that teleport you inside, zone properties as
tags (like items/furniture), danger inferred from what actually spawns, and a planner that
seeds whole blocks.

## What was built (7 phases, each regress-gated)

### 1. Zone tag substrate
- `zones.flags` is THE zone tag bag: `scope: 'zone'` entries in `client/shared/tagCatalog.js`
  (all 38 pre-existing flag keys catalogued + new ones), `validateTags` enforced in
  `apiCreateZone`/`apiUpdateZone`, new atomic `PATCH /zones/:id/tag` (server-side jsonb merge —
  drag-paint safe), zone validation in `scripts/content/lint.mjs`, and a "Zone Tags" chip editor
  in the dev panel zone form (`client/devpanel/js/panels/zones.js`).
- `scripts/normalize-zone-flags.mjs` stripped 1,290 junk values (`false`/`null`/`""` packed by
  the old `saveZone`) from 264 zones; `saveZone` now omits instead of packing junk.
- Regress layer 1d sweeps every live zone bag through `validateTags` forever.

### 2. Sanctuary + radiation as tags
- `server/engine/zone-tags.js`: `getZoneRadiation(zone)` (0–100 tag), `isSanctuary(zone)` (tag only).
- **PvP law codified**: PvP is ON everywhere; the `sanctuary` tag registers zone protection
  through the protection substrate (`engine:sanctuary` provider in `world.js`) — the same seam
  housing forcefields use. Sanctuary also = safe sleep + AI safe-flee target + hostile-spawn
  suppression (`loadSpawnTemplates` + per-tick in `tickSpawns`).
- The old `⚔ PVP` describe chip (display-only column no law ever read) is gone; `⛨ SANCTUARY`
  shows instead.
- `doors.js` lock-hack gate scoped to `reason === 'forcefield'` so a sanctuary lobby doesn't make
  every unit door unhackable (burglary survives).

### 3. Inferred danger (`server/engine/danger.js`)
- `zoneDanger(zone)` precedence: `danger` tag override → sanctuary ⇒ safe → cached inference → safe.
- Inference = max `enemyThreat` over the zone's `zone_spawns` (`hp_max + 8 × avg weapon dmg`,
  buckets at 60/100/180 — calibrated against live content: slag rat ≈20, trooper ≈126, arbiter ≈220),
  **floored by radiation** (≥25 → high, ≥40 → lethal; the Redline is lethal because of the air).
- Cached as `zone._dangerInferred`: swept at boot, recomputed by `reloadSpawn`/`removeSpawn`,
  carried across `reloadZone`. Pure functions only in danger.js (no world.js import — no cycles).
- Free fix: NPC wanderers now actually avoid lethal zones (old `HIGH_DANGER` set checked
  `very_high`/`extreme`, values that never existed).

### 4. Column cutover
- `danger_rating`, `pvp_enabled`, `radiation_level`, `is_safe_zone` migrated into flags and
  DROPPED (idempotent `DROP COLUMN IF EXISTS` in `SCHEMA_SQL`; all readers/writers swapped:
  routes, environment utility-room INSERT, world payloads, dev panel forms, worldstate, maps
  paint tool, corps/flight plugins, client minimap/cockpit).
- One-shot: `scripts/migrate-zone-columns-to-tags.mjs` (idempotent; prints review lists).
- 358 content zone files regenerated without the dropped keys.

### 5. Non-standable facades (opt-in)
- `facade` zone tag + an interior map (`maps.parent_zone_id` = the tile, valid `entry_zone_id`)
  ⇒ `isEnterableFacade`. Stepping onto it auto-forwards into the entry zone; `out` from inside
  lands on `flags.world_exit_zone` (the front-door street tile).
- One seam in `cmdMove` (`resolveFacadeTransit`) covers typed directions, `go <name>`, SIFT picks,
  and follower-drag: the gate chain runs ONCE (from=origin, to=final, door=front door — no pacing
  double-charge, lock law on the real door); the facade never holds players or broadcasts.
- `moveEntity` mirrors it for NPCs/enemies (locked front doors block them; pathfinding self-heals);
  wander pools exclude facades. `resolveLanding()` wraps every direct landing: respawn, admin tp,
  VINE TELEPORT, `apiTeleportPlayer`, NPC boot placement. Spawn routes 400 on facade targets.
- `reloadMaps()` keeps facade detection live when the dev panel creates interior maps.

### 6. Minimap rework
- 9×9 room window (client `R=4` in `minimap.js`, server BFS `depth=8` / `WIN=4` in
  `getMinimapData`), CSS grid `repeat()` tracks with per-mount sizing (sidebar/HUD/mobile).
- Enterable facades render as clickable `▣` markers (`go <building>` via the delegated
  action-link handler), never danger-tinted; `◆` = sanctuary; danger tint from the inferred
  `danger` field; street names (artery) in tooltips.

### 7. Zone planner + lint (`tools/zone-planner/`)
- `apply.mjs`: ASCII blueprint (`.bp.json`: grid + glyph legend) → zones with deterministic ids
  (`zone_<prefix>_<x>_<y>`), two-way adjacency exits (**exits stay the law — the planner writes
  them**), and the full facade shape per building glyph (facade tile + interior map + lobby +
  front door). Dry-run by default; idempotent re-runs preserve hand-written prose (sentinel-guarded
  `[PLANNER STUB]` descriptions), hand-wired exits, and foreign zones. Local DB only → ships via
  `content:export` → push.
- `lint.mjs`: adjacent-but-unconnected walkable tiles (with paste-ready fixes), teleport-shaped
  cardinal exits, facade invariants, override/authored exit duplicates. Facade invariants also
  added to `scripts/content/lint.mjs` for CI.
- **First run on map_world: 112 adjacent-but-unconnected street pairs** — the measured cause of
  the "map looks connected but isn't" feel.

## Decisions & discoveries (the why)

| # | Discovery | Decision |
|---|---|---|
| 1 | `is_safe_zone` was stamped on **218/358 zones (61%)** — hostile wastes included — by builder defaults. It was a sleep marker, never "sanctuary". | **Dropped with NO conversion** (user call): sleep requires an owned apartment or a deliberately-tagged sanctuary. Sanctuary curation is a manual pass (former-safe-zone list in the runbook). `apiAddRoom` no longer stamps safety. |
| 2 | Zone radiation was **cosmetic**: legacy values 1–5 against a 0–100 formula ⇒ entry gain always 0. | **Rescaled ×10** in migration; radiation is real for the first time (Redline ≈ 4–5 rads/step) and drives the danger floor. |
| 3 | The world has **zero pure facade tiles** — every `is_building`+interior-map zone (Tin Lane, Muster Yard, Foundry Cut) is a real street hosting a building; inferring auto-forward would sever the street grid. | Auto-forward is **opt-in via the `facade` tag**, never inferred. Existing tiles unchanged; the planner stamps it on generated buildings. |
| 4 | `pvp_enabled` was never enforced — the only combat law was the protection substrate. | No `pvp` tag at all: PvP-on is the default law, sanctuary is the carve-out. |
| 5 | Enterable-facade danger/`caution` data drift, dead cockpit danger tint, `collateral.js` reading `flags.is_safe_zone` (a key that never existed). | All fixed in passing; inference self-heals rating drift by construction. |

Deferred by design: in/out functionality beyond the facade seam, multi-tile building footprints,
multiple entrances (1 tile = 1 building = 1 entrance), adjacency-implies-connection at runtime
(tooling closes the gaps instead).

## Verification

`npm run test:regress` → **743/743** (new suites: zone-bag validation sweep, sanctuary
protection/sleep/spawn-suppression, tag radiation gain through a real `cmdMove`, danger inference +
recompute hooks, and a synthetic street↔facade↔lobby transit suite incl. locked front door).
Live browser pass: 9×9 renders (289 cells), movement works, Foundry Cut standable (opt-in
confirmed), Redline shows `[LETHAL] ☢ RAD:50` with real rad gain. `content:lint` clean.

## Outstanding

1. **Sanctuary curation — never done, and the spawn point is the hole.** Decision 1 dropped
   `is_safe_zone` with no conversion on the promise of a manual curation pass. That pass has not
   happened: **10 zones carry `sanctuary`, and all 10 are interiors on two interior maps** —
   `map_int_longwatch` (`zone_lw_entry` "The Threshold", commons, bunkroom, ops, quartermaster) and
   `map_int_solenne` (Solenne lobby, elevator, residences, gym, sky deck). **Zero of the 5,439
   `map_world` tiles is a sanctuary**, and neither complex is where players arrive.

   The sharp end: **`zone_start` (Coldwater Clone Facility) — where every character is born and
   where every death respawns them — has neither `sanctuary` nor `allow_sleep`.** Since sanctuary
   is what publishes zone protection (`world.js:57`) and suppresses hostile spawns
   (`world.js:450,1093`), the respawn point is a legal PvP kill box that enemies may spawn into.
   Tagging `zone_start` is the one-tag fix and should precede any broader pass.

   Sleep is less starved than the count suggests — `getSleepEligibility`
   (`apartments.js:683-721`) grants safe-zone-rate rest in **any unowned apartment unit** (an
   unrented unit is always unlocked, so its lock never bars sleep), and 116 zones are
   `is_apartment`. The newer `allow_sleep` tag (`zone-tags.js:29`) grants rest *without* the
   protection bundle and is on exactly two zones (`zone_lw_bunk`, `zone_mq_precinct_holding`).

   Curate against the district world with the Maps "Paint Safe Zones" tool, which paints
   `sanctuary`. The 218-zone shortlist is moot — those zones are gone.
2. **Re-run the connectivity lint** (`node tools/zone-planner/lint.mjs`) — each line has a
   paste-ready exit fix. The measured 112 gaps were on the retired `map_world`; the district
   world's count is unmeasured.
3. Known-stale one-shot seeds still INSERT the dropped columns and would error if re-run:
   `scripts/seed-hangar-interiors.js`, `seed-surveillance-vendor.js`, `seed-furniture-store.js`,
   `seed-clothing-store.js`, `seed-wanted-police.js`, and everything under `server/models/temp/`.

## Doc trail

Updated alongside the code: [tags.md](tags.md) (zone scope), [flags-keys.md](flags-keys.md)
(new keys + validation note), [systems-world.md](systems-world.md) (inferred danger + sanctuary law),
[systems-survival.md](systems-survival.md) (radiation + sleep), [systems-economy.md](systems-economy.md)
(theft gate), [architecture.md](architecture.md) (schema sketch + zone editor),
[tools/zone-planner/README.md](../tools/zone-planner/README.md) (planner usage).
