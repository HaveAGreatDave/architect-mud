# Legacy Overworld Decommission — "Salvage + Abandon"

> **Status: EXECUTED** (stamped 2026-07-24 by doc audit; was "Plan, not built"). The legacy
> exterior is gone — `content/zones/` holds **zero** `zone_nc_*` / `zone_gov_*` / `zone_up_*`
> tiles, and the surface is the 888-tile `zone_district_*` grid. The gov-quarter security
> recipe survives only as a dormant config awaiting the rebuild
> (`plugins/checkpoint/plugin.json`, "the gov-quarter recipe is dormant for the North City
> rebuild"). ⚠ There is no rebuild spec any more — `north-city-under-rebuild.md` was retired on
> 2026-09-01 as a stale plan, so that dormant config is waiting on a design that no longer exists.
> Kept as the record of what was salvaged vs. abandoned. Approved direction was: *fully replace the old `map_world`
> exterior overworld with the generated 888-zone `bp_district`, salvaging only the
> load-bearing pieces and deleting the rest.* This doc is the reviewable safety gate
> before any destructive change (per [CLAUDE.md](../../CLAUDE.md) — deletions ship via
> git-diff through CODEX, so the diff **is** the gate).

---

## What we're deleting and what's already safe

The zone-planner conversion (commit `0f866e17`) added the district and **relocated the
18 building interiors** into district facades. It did **not** gut the old exterior
overworld — 224 `map_world` tiles remain, holding real content. This plan removes them.

**Already migrated — zero action needed:**
- **85 NPCs** — all homed inside relocated interiors. 0 reference a legacy exterior tile.
- **46 apartments / 47 residences** — all in relocated interiors.
- **18 building interiors** — reparented to district facades; enter/exit works in-game.
- **Player spawn** — clone facility `out` → `zone_district_918_903`. Fresh players already
  emerge in the district.

**Load-bearing content still stranded in the 224 legacy tiles — must salvage first:**

| # | Thing | Count | Salvage action |
|---|---|---|---|
| 1 | `quest_fs_*` job-board quests | 17 (of 43) | Repoint the **exterior** zone refs onto district tiles. Some refs are to interiors that already moved — leave those. |
| 2 | Unique / apex enemy spawns | 135 spawns, 18 types | Rehome the ones found nowhere else into district tiles; drop the rest (district has its own wave). |
| 3 | Safe hub | The Threshold (`no_spawn`) | District has **0** safe zones. Designate a `no_spawn` neutral anchor at the spawn landing. |
| 4 | 6 hangar seams | 6 tiles | These are the far exit of district hangar interiors. Repoint each hangar's outward exit to a district tile. |
| 5 | Functional furniture | ~20 of 58 | SPECTER PD street cameras, NPC schedule boards, scav/fishing tables. Rehome or accept loss. |
| 6 | Crossing doors | 24 | Delete alongside their zones. |

---

## Phase plan (each phase independently regress-gated)

### Phase 1 — Safe hub (non-destructive, additive)
The district has no neutral ground. Fresh players land at `zone_district_918_903` (Clone
Facility, "wasteland"). Its neighbour **`zone_district_918_904` (Ironside Street)** is the
natural hub tile.
- Add `flags.no_spawn: true` + safe/anchor semantics + artery/scav flags mirroring the old
  Threshold to `zone_district_918_904` (and optionally its immediate ring), and set it as the
  `respawnZone` anchor.
- **Recommended default:** promote Ironside Street to the new "Threshold"-equivalent safe hub.

### Phase 2 — Repoint the 17 `quest_fs_*` quests (non-destructive)
Rewrite only the **exterior** zone references. Interior refs (`zone_dock_fishmarket`,
`zone_mq_grocery`, `zone_mq_pigeon_bar`, `zone_mq_sump_bar`, etc.) already point at relocated
interiors — leave untouched. Exterior legacy refs to repoint:

| Legacy exterior ref | Appears in | → District target (recommended) |
|---|---|---|
| `zone_threshold` | haul, loop, meter, parcel, pipes | `zone_district_918_904` (new hub) |
| `zone_thresholdeast` | loop, parcel, pipes | hub-adjacent district street |
| `zone_city_west` / `_east` / `_north` / `_south` / `_sw` / `_ne` / `_se` | flyer, count, line, meter, sweep | nearest district street tiles by theme |
| `zone_velk_exterior` | haul, loop, lostcat, parcel | district street near Velk facade |
| `zone_mq_marquee` / `_cathode` / `_overpass` / `_battery` | flyer, haul, loop, pigeon, sample | district street tiles (docks/residential cluster) |
| `zone_outskirts` / `zone_slums` | count, lostcat, wake | wasteland-themed district tiles |
| `zone_meat_carrion` / `_offal` | mourn | wasteland-themed district tiles |
| `zone_yard_reefer` / `_container` / `_sidings` | ratcount | district tiles near the yard facade |
| `zone_civ_ledger` / `zone_gov_registry` | witness | district tiles near those facades |

*(Exact target tiles chosen at execution time by facade proximity; table above is the intent.)*

### Phase 3 — Rehome unique spawns (non-destructive)
Only enemies that spawn **exclusively** in legacy tiles are worth rescuing; the district's own
population wave already covers the common ones. Recommended rehomes into theme-matched district
tiles:
- `enemy_bay_leviathan` (2) → district water tiles
- `enemy_redline_horror` (1), `enemy_tar_horror` (3), `enemy_architect_drone` (2) → deep
  wasteland-frontier district tiles
- `enemy_slag_wight` (19), `enemy_wire_jackal` (17) — decide keep vs. drop (high count; the
  district may not want that density). **Default: rehome a handful, drop the bulk.**
- Everything already present in the district wave (harbor_lurker, rad_mutant, feral_dog,
  gutter_cat, ash_crawler, scav…): **drop.**

### Phase 4 — Fix the 6 hangar seams (non-destructive)
Each district hangar interior currently exits into a legacy perimeter tile. Repoint the outward
exit to a district tile (or dead-end it):
`zone_hangar_dock_slip → zone_dock_slip`, `…_slag_gate → zone_slag_gate`,
`…_waste_scald → zone_waste_scald`, `…_yard_marshalling → zone_yard_marshalling`,
`zone_surveillance_market → zone_media_plaza`, `zone_mq_cage_shop → zone_mq_cage`.

### Phase 5 — Salvage functional furniture (optional)
- **SPECTER PD street cameras** (16) — surveillance network nodes; rehome to district streets if
  the wanted-system camera coverage matters, else accept loss.
- **NPC schedule boards** (Watts's / Voss Iyaka's Schedule) — tied to those NPCs' routines;
  rehome near their relocated facades.
- Street lights / floodlights / posters — cosmetic; drop.

### Phase 6 — DELETE (destructive, the only irreversible step)
After Phases 1–5 land and `npm run test:regress` is green:
- `git rm` the 224 `content/zones/zone_*` legacy exterior files, their **135 `zone_spawns`**,
  **58 `furniture`**, and **24 `doors`**.
- CODEX deploy turns the git deletion into a prod deletion (git-diff-driven).
- **Gate:** regress green + a final grep proving no surviving zone/quest/door/spawn references a
  deleted id.

---

## Execution log (2026-07-11)

**Done + regress-green (786/786), non-destructive:**
- **Phase 1** — safe hub: `zone_district_918_904` (Ironside Street) given `no_spawn` + intro_lore.
- **Phase 2** — 17 `quest_fs_*` gigs repointed to district tiles (collision-free street names) with prose/emotes re-substituted. See `scripts/salvage-legacy-world.mjs`.
- **Phase 3** — 16 apex/unique spawns rehomed (leviathan, redline_horror, tar_horror, architect_drone, slag_wight, wire_jackal, rusted_sweeper, sprawl_ganger) into deep-frontier/water/residential district tiles. Trash tier dropped.
- **Phase 4 (mechanical)** — plugin constants repointed to district tiles + regress updated:
  - drugwar `NATURAL` + `POLICE/WATCH` + `scripts/seed-drugwar-turf.mjs` (⚠ re-run against prod to reseed `zone_control`)
  - gossip `TURF_DEALER_HOME`, corps `isStart`, flight `FENCE_ORIGIN` + smuggle `DROP_ZONE` → Coldwater Regional (`zone_district_925_903`)
  - **jail was a false alarm** — uses surviving interiors + the already-relocated `zone_district_922_911` facade.

**Decisions taken:** airfields → **consolidate to 2** (retire the 4 outlying; fence/smuggle moved to Coldwater Regional). Gov enclave + The Under → **full rebuild in district**.

**BLOCKING Phase 6 — the gov/North-City/Under rebuild.** The govgate seeds (`zone_civ_steps`/`zone_up_vellum`/`zone_gov_mezzanine`) sit inside a ~40-zone authored district — North City (`nc_*`), Uptown (`up_*`), the government enclave (`gov_*`), Civic (`civ_*`), Corp Row (`corp_*`) — **plus a `z-1` Undercity** (`zone_tunnels`, `zone_under_*`, `zone_surveillance_market`). "Full rebuild in district" of this is a district-sized content build (a wave of its own), then govgate must be repointed to the new zones. **The 224-tile deletion cannot proceed until this lands.** Scope it as its own project.

## Open sub-decisions (defaults chosen; override any)
1. **Safe hub tile** — default `zone_district_918_904` (Ironside St, at the spawn). OK?
2. **Slag-wight / wire-jackal density** — default rehome a few, drop the bulk. Or keep all 36?
3. **SPECTER cameras** — rehome for coverage, or accept loss?
4. **Named-district flavour** — Salvage+Abandon means Marquee/Redline/Bay/Slagworks *names* are
   gone; the district keeps its generic identities. Confirmed acceptable.
