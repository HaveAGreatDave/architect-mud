# Unrest — dynamic faction-conflict events

**Status: DESIGN ONLY. Nothing here is implemented.** Designed 2026-08-23. The session it
came out of was lost to a client corruption; this is its plan file, recovered and committed
unchanged apart from this header so it cannot go missing again.

## Context

Architect has five orders with a full ideology substrate (`orgs`, `player_ideology_rep`,
stance/path, a 30-day rep half-life) and **nothing that makes the conflict between them
observable**. The 10 authored `org_relations` hostile edges are read by exactly one thing:
the CODEX tablet reader. 61 NPCs carry an ideology faction and no NPC behaviour reacts to
inter-order hostility. There is no autonomous "roll dice, run something" orchestrator
anywhere in the codebase.

The goal is a system that **demonstrates the flavour of the tension** — the Ascendants
running the Basin as the authority, the Long Watch working underneath it, later the
Wildblood coming in from outside and the Null going after Ascendant machinery — backed by
a real persistent ledger so the flavour is consequential rather than random.

Decided up front:
- A persistent ledger drives incidents (not stateless rolls, not pure ambience).
- **Fully independent** of player-corp `zone_control`. Corps are not touched.
- An incident **can** make ground genuinely dangerous to an unaligned player.
- Coldwater, Ascendants vs Long Watch, is the whole of phase 1's fiction.

This also closes a gap `docs/systems-ideologies.md` already documents: rep decays on a
30-day half-life but **no repeatable work pays ideology rep**, so an order cannot be lived
in. `docs/systems-faction-arcs.md` already carves out **favours** as the parallel
repeatable track. Incident response is that missing work.

---

## The model

A symmetric tug-of-war is the wrong shape. "The Long Watch controls 60% of the Ashway" is
nonsense for a resistance. The orders are asymmetric, so **role decides which scalar an
order writes**, and role is authored data on `orgs.flags.role` (JSONB, already there — no
schema change), never a switch statement in code.

| Order | Role | Writes | Driven by |
|---|---|---|---|
| Ascendants | `authority` | **grip ↑** | heat in its theatre. The only order that raises grip. |
| Long Watch | `insurgency` | **heat ↑** | grip + pressure in its theatre. Resident, persistent, local. |
| Null | `vendetta` | targets Ascendant *assets*, not ground | grip anywhere. Not territorial at all. |
| Wildblood | `incursion` | heat ↑ in a burst, then nothing | an external clock, **not** local state. |
| Exodus | `withdrawn` | nothing | never. Encodes "not in this fight" as data. |

**Only the Ascendant↔Long Watch pair needs a ledger.** Null and Wildblood are *drivers into*
it. That is a much smaller build and it matches the fiction exactly.

### Three scalars per district, not two

- **`grip`** — how hard the authority is squeezing. Fast, responds over hours.
- **`heat`** — dissident activity, attributed per order. Fastest, responds over tens of minutes.
- **`pressure`** — a slow integrator of *grip over time*, moving over days. It raises heat's
  **baseline**, not heat.

`pressure` is not optional. Without it the fast pair converges by default: decay-on-read
pulls both toward baseline, incidents gate on high heat, so a low-heat district can never
generate the events that would raise its heat and **dead districts stay dead forever**.
Fast pair + slow integrator is the minimal system that limit-cycles with no driver.

**State the period or it isn't designed.** Heat in tens of minutes, grip in hours, pressure
over days, a full cycle legible across roughly a week with a visible swing inside a 1–2
hour session. A cycle longer than a play session is invisible.

### Displacement is authored, not topological

There is no district adjacency graph in the codebase, and with a handful of real urban
cells "adjacent" means "all of them". A sweep pushes heat to the order's **next-preferred
theatre** from an authored ordered district list on `orgs.flags.role.theatre`. One JSON
field instead of a topology, reads as intent rather than diffusion, and it is the knob an
author turns as the map grows.

---

## The load-bearing rules

These are the ones that decide whether this ships as a system or as invisible noise.

1. **Signal before effect.** An incident may not stage in a district unless that district
   carried a *perceivable, attributable* signal from the same order inside the preceding
   window. Heat rises → graffiti, gossip, NPC mood **first**; only then does the grip
   response fire. The player who walked past the tag yesterday reads today's checkpoint as
   consequence rather than spawn noise. Asserted in regress.

2. **No PLAYER-facing readout. Ever.** No verb, no tablet gauge, no number. The moment there
   is a readout the sim becomes a dashboard to optimise and the flavour dies. The player's
   instrument is an NPC saying *"don't go up the hill tonight."*
   **The dev panel is the opposite** — it gets the complete numeric picture, because an
   operator who cannot see the ledger cannot tune it (§Dev panel B). The line is the client
   boundary, not the data: every scalar is visible at `/dev` and none of it crosses into
   `client/game/`.
   **Ship test:** can a player who has never opened a wiki tell you which district is tense
   and who is doing it? If that needs a number, ship differently.

3. **The sim never moves ideology standing implicitly.** `plugins/drugwar/index.js`'s header
   records this decision being made once already ("the invisible alignment ledger was
   removed"). Rep moves only through an explicit favour turn-in via the existing
   `ADJUST_REPUTATION`. Regress asserts the plugin has no incidental `adjustReputation` caller.

4. **Danger must be audible from the tile you are standing on.** `propagateSound()` already
   reaches neighbours. That converts "ambushed by a sim I can't see" into "I heard that and
   walked in anyway" for about four lines of code.

5. **Persist the ledger, never the incidents.** A live incident holds `instanceId`s that do
   not survive a restart, and a persisted "checkpoint here" that outlives its teardown is a
   permanent checkpoint nobody authored. Correct post-restart state: district still hot,
   checkpoint gone, next tick re-stages if still warranted.

6. **The two voices disagree, and that is the whole expressive trick.** The news wire carries
   the Ascendant version; the gossip pool carries the street version; they contradict each
   other and nothing ever reconciles them. That single fact communicates "an authority and a
   resistance" better than any scalar could. Per house style the Ascendant copy takes em
   dashes and the street copy never does — the faction split is encoded in the punctuation.

---

## Dev panel

The system is authored and operated from `/dev`, and the design principle is that **each
surface reuses an interaction a builder already knows** rather than inventing one.

### A. District Painter — a new mode in the Maps editor *(phase 0)*

Phase 0 is 4,900 tiles of assignment. Done as a script it is a guess; done as a painter it
is an afternoon. Add a `district` mode to `client/devpanel/js/panels/maps.js` beside the
existing Terrain / Paint / Safe-Zone modes, with **the same four tools the terrain painter
already has** — brush, flood-fill, rectangle-marquee, and eyedropper (`terrainPaintStart` /
`terrainFill` / `terrainRectStart` / `terrainPick`, `maps.js:1367,1393,1417,1384`) — and the
same undo stack and draggable tool panel.

**The palette needs no new file.** `TERRAIN_TYPES` is loaded from `content/map/terrain.json`
because terrain had no content home; districts do — `content/districts/*.json` already carries
`id`, `name` and `color`, which is exactly a swatch. The painter writes `flags.district` and
nothing else, so it inherits the tile-save path terrain already uses.

Two rules specific to this painter: it must **show the resolved district, not just the
authored one** (mirroring `mapZoneTerrain`'s authored-wins-then-infer shape at `maps.js:1118`)
so a builder can see the `residential` fallback sinkhole and paint over it; and it must
**flag any tile whose resolved district sits outside `region_coldwater`**, which is how the
Deadwater/Terminus fallout gets caught by eye instead of in play.

### B. Unrest panel — the ledger *(phase 1)*

New nav section + `client/devpanel/js/panels/unrest.js` + a `PANELS` entry, following
`emergency` exactly (`core/panels.js:404` — `fetch: () => directAPI('/unrest/state')`, custom
`render`, live status dots, action buttons).

**The ledger is spatial, so the primary view is the map, not a table.** Reuse the region SVG
the world editor already draws (`panels/world-editor.js:70`), tinted by **band** rather than
terrain — one glance answers "where is it kicking off". Under it, one row per theatre district:
grip / heat / pressure as bars, the band chip, the dominant order, and time since last signal.

Operator controls, all `directAPI` (live world, never staged — the same call class as
emergency and power): force a district's scalars for testing, stage a named incident, and
tear a live one down. Live incidents list with a teardown button mirrors emergency's
activate/deactivate pair.

### C. Incidents editor *(phase 2)*

Incidents are authored content, so this rides the shared list/edit lifecycle in
`core/table.js` (`renderTable` / `openEdit` / `saveRecord`) with an `editForm`, and goes
through `API()` so it is **staged** like other content — unlike B, which is live state.
`panels/script-triggers.js` is the closest analogue (an authored table carrying conditions and
params) and is the file to copy the shape from.

### Dev-panel constraints

- `core/panels.js` **must load after every `panels/*` file** — the `PANELS` literal resolves
  function references at construction time. Add the `<script>` tag for `panels/unrest.js`
  above it in `index.html`, plus the nav-list entry (`core/panels.js:504`).
- Scripts are **plain classic scripts sharing one global scope** — no modules, no bundler,
  and inline `on*` handlers in `index.html` require handler functions to stay global.
- Floating panels use the shared `dp-float-panel` / `dp-float-drag` + `dpFloatAnchor`, never
  bespoke drag code.
- Use `dpConfirm` / `dpPrompt` / `dpAlert`, never the native browser dialogs.
- `directAPI` for live-world state, `API` for authored content — picking the wrong one either
  silently stages an operator action or bypasses review on authored content.

---

## ⚠ Phase 0 is a blocker: the district data does not exist

Verified against all 17,258 zone files. Authored `flags.district` values, in full:

```
wilds 3471 · wasteland 462 · water 257 · sewer 117 · residential 89 · docks 59 · yards 24 · longwatch 23
```

**Zero tiles** carry: `ashway`, `redline`, `northcity`, `government`, `slum`, `civic`,
`commercial`, `industrial`, `media`, `nightlife`, `slaglands`, `hazard` — twelve of the
twenty authored districts, including every one the fiction leans on. Coldwater's modern grid
is `zone_district_<x>_<y>`, which matches no entry in the legacy `DISTRICT_PREFIX` table, so
`flags.district` is its only identity (`server/engine/districts.js:46`) and unassigned tiles
fall through to the `residential` fallback. **Today the entire built city reads as one
district.**

Two related traps:
- **The fallback is a sinkhole.** Deadwater, Terminus and Scarletwastes tiles resolve to
  `residential`. Every incident must additionally gate on `flags.region_id === 'region_coldwater'`
  or a Long Watch flare fires 900 tiles into the wasteland.
- `zone_util_*` (116 tiles) is caught by the `util` prefix and classified `media`. "The Media
  District is under lockdown" would fire in utility corridors.

Building the ledger before fixing this means tuning a sim whose cells are `wilds` (3,471
tiles) and `civic` (0).

---

## Phases

| Phase | What ships | Key files | Regress |
|---|---|---|---|
| **0 — Ground truth** *(tool, then content)* | **Build the District Painter first** (§Dev panel A), then use it: assign `flags.district` across the Coldwater grid so the named districts have tiles. Fix the `util`→`media` prefix mis-class. Author a **theatre list** (which districts the sim may touch) and per-district `grip`/`heat` baselines. Add `flags.role` (`writes`/`reads`/`theatre`) to the five `content/orgs/ideology_*.json`. Ships via CODEX. | `client/devpanel/js/panels/maps.js`, `content/zones/**`, `content/districts/*.json`, `content/orgs/ideology_*.json` | `districtFor()` returns a non-fallback district for every Coldwater street tile; every theatre district has ≥N tiles and resolves inside `region_coldwater`; every canon org declares a role. Painter itself is covered by `client:smoke` (parse) — no headless UI test. |
| **1 — Ledger + perceivability** *(shippable alone)* | New `plugins/unrest/`. Boot-built district→zone index. `ledger.js`: grip/heat/pressure, lazy decay-on-read to authored baselines, band computation, batched write-behind. Forcing tick `schedule('30m')`, idle-gated. Perceivability: boundary-crossing beat off `zone.entered`, `zone.describeAmbient` (hard abstention at baseline), gossip via `pool.addItem({capGroup:'unrest'})`, news via `emit('npc.broadcast_say')`. Band-crossing events only. **Unrest dev panel** (§Dev panel B): band-tinted region map, per-district bars, force controls, all over `directAPI`. **No incidents, no spawns, no player verbs.** | `plugins/unrest/{index.js,ledger.js,plugin.json,README.md,regress.js}`, `client/devpanel/js/panels/unrest.js`, `client/devpanel/js/core/panels.js`, `client/devpanel/index.html`, `docs/plugins.md`, `docs/devpanel-js.md`, `docs/systems-unrest.md` | Decay is monotone toward baseline and never crosses it; the blob round-trips a simulated restart; a corrupt/absent blob rebuilds from baselines; band events fire once per crossing not per delta; the ambient hook abstains at baseline; the boundary line fires only on a real district-key change; gossip respects its cap. |
| **2 — Incidents as content** | `incidents` table + `content-registry.js` entry + `content/incidents/*.json`. Selector, staging, teardown, concurrency cap (~3 citywide), cooldowns. Stage set limited to safe Actions: gossip, graffiti, news, ambient override, NPC mood. One `world_events` audit row per staging. Signal-before-effect enforced. **Incidents editor** (§Dev panel C) over the shared table lifecycle, staged through `API()`. | `server/models/schema.js`, `server/models/content-registry.js`, `plugins/unrest/incidents.js`, `content/incidents/**`, `client/devpanel/js/panels/unrest.js` | An incident cannot stage without a prior signal in that district; teardown restores exact prior state; the cap holds under a forced storm; exactly one `world_events` row per staging; a `script_triggers` row binding `unrest.incident.staged` matches on `zone_id`. |
| **3 — Danger** | Dangerous stage Actions: `SPAWN_HOSTILE` (`spawnEnemySync` + behaviour graph + tracked instance ids), `SET_ZONE_FLAG` for a **RAM-only** `checkpoint_cfg`, and `ESP_ACTIVATE`/`ESP_DEACTIVATE` **registered as Actions inside `plugins/emergency`** so nothing imports across plugins. `propagateSound` warning to neighbours before anything hostile lands. | `plugins/emergency/index.js` (+ manifest, README status header), `plugins/unrest/stage.js` | Every spawned instance is removed on teardown (instance-count leak check); an incident-set `checkpoint_cfg` is gone after teardown *and* after a simulated restart; no hostile stages without a prior neighbour warning; ESP activate/deactivate is idempotent under double dispatch. |
| **4 — Participation** | Incident-response **favours**: repeatable quests keyed to live incidents, paying `rep` on turn-in through `ADJUST_REPUTATION`. Player-side resolution deltas. Closes the documented repeatable-work gap. | `content/quests/**`, `plugins/unrest/favours.js`, `docs/systems-ideologies.md` | Rep moves only through an explicit turn-in; a favour cannot be turned in for an already-resolved incident; repeated turn-ins never walk an `<order>_arc` flag backwards. |
| **5 — Null + Wildblood** | `vendetta` (reads grip, targets Ascendant assets not ground) and `incursion` (external clock, burst, no baseline). Both are drivers into the existing ledger — no new state. Exodus stays `withdrawn`. | `content/orgs/ideology_{null,wildblood}.json`, `content/incidents/**`, `plugins/unrest/roles.js` | A `vendetta` incident stages against high-grip districts regardless of heat; an `incursion` fires off the clock with no local-state precondition and leaves no residual baseline; `withdrawn` never stages anything. |

---

## Where the state lives

**One `world_flags` JSON blob, RAM-authoritative, write-behind.** Not a new table (the payload
is ~20 districts × 4 numbers — a Map's worth of data does not justify a schema change, a
registry entry, a boot load and a read-tier decision), and not pure RAM (this repo deploys on
every push to `main`; a ledger that resets every deploy *is* a stateless roll with extra steps).

`flags.js` already keeps world flags in a write-through Map, so reads are free and there is no
new cache tier. `plugins/jobboard/index.js:151` is the precedent — `jobboard_rot_<id>` holding
`{jobs, at}`.

Three conditions that make it honest:
1. **Version the blob** (`{v:1, at, districts:{…}}`); absent or unparseable rebuilds from
   authored baselines.
2. **Write-behind on a batched cadence** (the `flushDirtyPositions` dirty-flag pattern), with
   the module header stating this plugin is the key's only writer.
3. **`world_events` is the audit log, not the ledger** — one insert per staged incident
   (`event_type='unrest.incident'`). The table already exists (`schema.js:577`), is indexed on
   `zone_id`/`created_at`, is classed `runtime`, and has **zero writers today**.

---

## Reuse (do not rebuild)

| Need | Existing seam |
|---|---|
| Clock | `schedule(cadence, cb, {runWhenEmpty})` — `server/engine/scheduler.js:56`, idle-gated on `hasActivePlayers()`, phase-spread, boot-jittered |
| Authored fan-out | `script_triggers` binds **any** event-bus name to a VINE graph with `zone_id`/`conditions`/`chance`/`cooldown_seconds` — `server/engine/script-triggers.js` |
| Cross-plugin effects | `registerAction`/`dispatchAction` by **name**, never an import — `server/engine/actions.js:27` |
| Temporary hostiles | `spawnEnemySync(template, zoneId)` accepts a hand-built template, no DB row — `world.js:1614`; `plugins/emergency/index.js:340` is the working reference |
| Rumours | **exported** `plant()` / `addItem({capGroup, coalesceKey, reach})` — `plugins/gossip/pool.js:51,112` |
| News | `emit('npc.broadcast_say', {channel_id, text})` (`enqueueNews` is module-private) — `plugins/broadcast/index.js:5315` |
| Lockdown | the complete ESP: sirens, `esp_state` client messages, `setEspShelter` AI override, Arbiter spawns — `plugins/emergency/index.js` |
| Checkpoints | move gate reads `zone.flags.checkpoint_cfg` off the **live RAM zone object**; `world.zones` is never written back, so a temporary checkpoint is restart-safe by construction — `plugins/checkpoint/index.js:121` |
| Wall tags | `graffiti.tagged` already emitted, stateless 3-game-day expiry — `plugins/graffiti/index.js:268` |
| Vignettes | `ambient_routines` is already "authored scene selected by world state"; gate on band rather than building a parallel system — `plugins/ambient-life/` |
| Rep | `adjustReputation` / `ADJUST_REPUTATION` — `server/engine/ideologies.js`, `plugins/ideologies/index.js` |

### Traps confirmed in this codebase

- **`fireHook` keeps the LAST non-undefined result** (`server/engine/plugins.js:186-195`) and
  load order is filesystem-alphabetical, so `unrest` sorts *after* `district-ambience` and
  would silently outrank it on every beat it answers. Abstain aggressively (return `undefined`
  at baseline) **and** declare `"after": ["district-ambience"]` in `plugin.json` to make the
  order deliberate (`docs/plugin-standard.md:22`).
- **`script-triggers` normalises the zone as `payload.zone ?? payload.zoneId`** — name the
  field one of those or a trigger row's `zone_id` filter silently never matches.
- **`emit` is synchronous and swallows subscriber throws** — incident staging must not run
  inside an emit.
- **17,258 zones.** Build the district→zone index once at boot; never scan `world.zones` per
  tick, and exclude `world.transientZones` or a void-crossing room gets a checkpoint.
- **Neither idle-gate nor `runWhenEmpty` alone is right.** An idle-gated ledger means you log
  in to exactly the state you left; `runWhenEmpty` pins Neon compute awake billing for nobody.
  Use lazy decay-on-read (the `decayRep` pattern) **plus** an idle-gated tick that does only
  forcing.

---

## Verification

- `npm run test:regress` after every phase — mandatory (new plugin, new verbs if any, new
  manifest, engine seam in phase 3). Per-phase assertions are in the table above.
- `npm run content:lint` before any `content:import`; phase 0 and 2 are content-heavy.
- `docs:lint` gates all four checks — `docs/systems-unrest.md` needs an honest status header,
  every verb must be named in `docs/plugins.md`, and phase 3's edit to `plugins/emergency`
  must keep that README's status header consistent with its manifest.
- `npm run client:smoke` covers the new devpanel files for parse errors — the only automated
  coverage they get. ⚠ Devpanel panels are large HTML template literals: **quote identifiers
  inside them with 'single quotes', never backticks**, or the file ends its own string
  mid-comment and takes the panel down.
- **Manual end-to-end for phase 0:** open the District Painter, confirm it renders the
  resolved (not just authored) district so the `residential` sinkhole is visible, paint a
  block with each of the four tools, reload and confirm `flags.district` persisted, and
  confirm the out-of-region warning fires on a Deadwater tile.
- **Manual end-to-end for phase 1:** force a district's heat from the Unrest panel, walk the
  boundary and confirm the crossing beat fires exactly once, confirm the ambient layer still
  shows district signature lines at baseline, confirm the gossip cap holds, restart the server
  and confirm the ledger survives.
- **The real test is the ship test in rule 2** — walk a tense district cold and see whether it
  reads as tense without being told a number.
