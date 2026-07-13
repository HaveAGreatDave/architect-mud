# The Under — The Sewer Layer (Proposal & Phased Build Plan)

**Status:** Reframed 2026-07-12 as a **sewer layer** — the municipal storm/waste network
beneath Coldwater Basin at `map_world` grid_z −1. This supersedes the earlier "metro-first"
framing of this doc: the walkable sewer tunnels **are** the canonical z-1 layer, and the old
transit/cavern ideas become **future overlays** on this same geometry (see
[Future overlays](#future-overlays)). **Phase 1 (the beginner pocket near the Clone Facility)
is the current deliverable.**

## What The Under is

A dark, explorable underground biome on the **same `map_world` map at grid_z −1**, linked to
the surface by `up`/`down` storm-drain seams (the `drum_shop`↔`drum_basement` pattern). It is
the player's **first dedicated PvE combat and exploration space** — entered immediately after
the tutorial, forgiving near the entrance, and designed to grow into a district-spanning
network that supports progression throughout the game (not a one-off dungeon).

Two things make the sewer read as *the sewer* and give the flashlight a real job:

- **It's pitch dark.** Sewer tiles are `is_interior` with no power and no windows, so
  `getZoneVisibility` resolves them to `pitch_dark`. Without a light you can only feel for
  exits; creatures and ground loot are hidden, and every swing you throw eats the −5 darkness
  to-hit penalty.
- **The flashlight is the key.** Grady's gift (`item_lucky_flashlight`, already the reward for
  `quest_first_hour`) floors the holder's *perceived* light to `clear` via the flashlight
  plugin's `visibility.perceive` hook — cancelling the penalty and revealing the room. Monsters
  still eat the raw zone darkness on their swings, so a lit player has a decisive edge and a
  dark one is in real trouble. This is the intended tension: **you do not go down without a
  charged flashlight.**

## Locked design decisions (2026-07-12)

| Decision | Choice |
|---|---|
| Primary role | **Beginner PvE combat + exploration**, growing into a district-wide biome |
| Fiction | **Sewer** is the z-1 layer; metro/express + z-2 caverns are future overlays on it |
| Target footprint | **District-wide** eventually (loose mirror of the surface streets) |
| Layout style | **Loose hand-authored** — roughly tracks the streets, but breaks 1:1 with junctions, floods, collapses, utility rooms, dead-ends |
| First slice | **Beginner pocket** (~11 tiles) under the Clone Facility corner — ships now |
| Bulk build method | **Deferred** — decide generator-vs-hand-authored after the pocket is live and proven |
| Bestiary (now) | **3 creatures** (sewer rat / roach / slime), expanded later |

## History (for context)

The `map_world` overworld that hosted the original hand-built "Under" (`zone_tunnels`,
`zone_under_commons/deep/landing`, the North-City gate corridor) was **retired** — those tiles
no longer exist in the content tree; they survive only in git history. The current surface is a
**procedurally generated 888-tile district** (`zone_district_<x>_<y>`, grid_x 891–927 /
grid_y 896–919, all grid_z 0), with **no `flags.artery` road network** — so "mirror the surface
roads" means loosely following the generated street grid, not recreating named avenues. **Zero
zones currently sit on `map_world` at grid_z −1**, so the sewer is the first occupant of that
layer — a clean slate.

## Phase 1 — Beginner pocket (current deliverable)

~11 new z-1 tiles under the Clone Facility corner (grid ~917–921 × 903–905), authored loose.

**Geometry & entrance.** One storm-drain `down` from **Ironside Street** (`zone_district_919_903`,
where the tutorial clonejacker fight happens) into the entry **Sump**, with a reciprocal `up`.
A short loop (Sump → Confluence / Flooded Run / Dripping Bend → Silt Gallery) plus dead-end
nooks (Rat Warren nest, Utility Alcove, Overflow Chamber) and **two future seams left visibly
blocked** — a **Collapsed Tunnel** and a **Sealed Maintenance Door** — telegraphing expansion.
All tiles `is_interior` + unpowered (⇒ pitch dark) + `district: "sewer"`.

**Bestiary (3, beginner band, a notch above clonejackers).** Names share the token **"sewer"**
so one kill objective counts them all (the quest matcher is a name-substring `includes`):
- `enemy_sewer_rat` — hp 10, hit 1, dodge 2, 1–3 kinetic (modeled on `enemy_slag_rat`).
- `enemy_sewer_roach` — hp 6, hit 2, dodge 4 (fast, evasive), 1–2 kinetic.
- `enemy_sewer_slime` — hp 22, hit 1, dodge 0 (slow, tanky, no-flee), 1–3 kinetic.

Spawned via `zone_spawns` rows across the interior tiles (the Sump is left spawn-free as a safe
landing/re-entry). Danger auto-infers low.

**Loot.** A new `scav_sewer` scavenging table on the pocket tiles reusing existing junk
(`item_scrap_metal`, `item_tangled_wire`, `item_depleted_battery`) plus one new `item_rusty_pipe`
and a rare **live `item_battery`** (difficulty-gated "cache" find that feeds the flashlight).
Enemy `loot_table`s drop scrap/wire/credits.

**Quest — "Down the Drain"** (`quest_down_the_drain`). Offered by Grady **after** `quest_first_hour`
turns in (gated on `grady_regular` set): descend the Ironside drain, cull **6 sewer creatures**,
return. Reward: ~100 credits + **3 batteries** (keeps the flashlight fed) + jerky + bandages.
Grady's dialogue gains the offer, the send-off pointing at the drain, and the `TURN_IN` node
(which is how the quest auto-discovers him as the turn-in NPC).

**Engine note:** Phase 1 is **pure content** — zones + exits + spawns + scav + quest + one item,
plus a dialogue edit. No plugin. Ships through `content/*.json` + `content:import` and a push to
`main` (CODEX); regress-gated.

## Future overlays (not built)

The same z-1 geometry is the substrate for later systems, layered on rather than replacing:
- **Express transit** — a `plugins/metro/` mechanic (board/ride/disembark, credit fare,
  power-gated so it stops in blackouts, SIFT destination picker) riding the sewer trunk between
  hub stations. This is the *only* piece that warrants a plugin; run the engine-vs-plugin gate
  before building and add `plugins/metro/regress.js`.
- **z-2 caverns** — a deeper natural biome reached by `down` shafts from a few z-1 nodes, home
  to a higher mutant tier and a cavern apex; delved on foot, off the transit network.
- **Set-pieces** — dungeon entrances, hidden laboratories, corporate facilities, mutant nests,
  utility networks, quest locations, and boss encounters hung off the expanding tunnel network.

## District expansion (Phases 2+)

Extend the loose network outward wing by wing (junction rings, flooded sections, utility rooms),
each wing gated by distance / collapsed tunnels / locked maintenance doors and shipped playable
on its own, growing the bestiary (possum, drain snake, sewer bat, then deeper mutants). The
**bulk build method** (a sewer planner à la `bp_district` vs. continued hand-authoring) is
decided once the Phase-1 pocket is live and proven — deliberately deferred.

## Build method

Git-as-source-of-truth content pipeline (per CLAUDE.md / `docs/content-pipeline.md`): one JSON
file per entity under `content/`, `npm run content:lint` → `npm run content:import` to a local
DB → `npm run test:regress` → push to `main` (CI import = deploy). The `codex` skill is the exit
gate. The legacy direct-DB upsert flow referenced in older revisions of this doc is retired.
