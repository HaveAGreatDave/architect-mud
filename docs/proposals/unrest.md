# Unrest — dynamic faction-conflict events

**Status: PHASES 1, 2 AND 3 BUILT** (1a–1d 2026-08-26; phase 2's seam 2026-09-01;
phase 3 2026-09-02). The favour QUESTS are the one outstanding piece and are content,
not code.

⚠ **Phase 2 is a seam, not a set of favours.** `plugins/unrest/favours.js` registers the
`unrest_incident` condition shape, which is the whole mechanism: an authored repeatable
quest can now be offered *and turned in* only while there is something live to respond to.
The favour QUESTS themselves are content and nobody has written one yet — the plugin
deliberately ships no reputation call at all, because rule 4 says the sim never moves
standing implicitly and the quest's own `ADJUST_REPUTATION` reward is what pays. Regress
asserts the absence: no `adjustReputation(` anywhere in the plugin, and no repeatable
quest in `content/` writing an `<order>_arc` flag.

What
actually ships is [docs/systems-unrest.md](../systems-unrest.md) and
[plugins/unrest/](../../plugins/unrest/README.md) — read those first and treat this file as
the design record, including everything below that has not been built.

Designed 2026-08-23. The session it came out of was lost to a client corruption; this is its
plan file, recovered and committed so it cannot go missing again. **Revised 2026-08-24** —
the ledger's cell moved from named districts to derived coordinate blocks, which removed the
phase 0 blocker; the district work was split out to [district-repair.md](district-repair.md),
where it stands on its own.

**Where the build departed from this plan**, all three deliberate and recorded in
[systems-unrest.md](../systems-unrest.md): the safe stage step "NPC mood" became `sound`,
because no seam in this codebase reads a mood field off an NPC and adding one would be an
authored key nothing consumes; the news seam is a `broadcast.newsWire` Action rather than a
raw `npc.broadcast_say` emit, because that event needs a `channel_id` a caller has no way to
choose and `enqueueNews` already fans a line out by category; and there is no `grip` hostile,
because the only Ascendant enforcement enemy in the world is the 100 HP Arbiter and the
authority's danger reads better as a checkpoint than as a mob.

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

**The four expansion orders take no role.** Prometheans, Synthesis, Pioneers and Lucid carry
`flags.expansion: true` and are preview-only, never winning the lean
(`docs/systems-ideologies.md`). They are excluded from the sim, and the regress assertion
reads *every non-expansion org declares a role* — not *every org*.

---

## The cell: a derived block, not a named district

The sim needs a spatial unit between tile and region. A tile is too fine — a player crosses
perhaps twenty in a session, so per-tile heat is noise nobody can read. A region is too
coarse — Coldwater is one region, so a region-level ledger is a single global number, which
is weather rather than faction conflict.

The first draft used the authored `flags.district`. That made the system depend on content
that does not exist: twelve of the twenty authored districts hold zero tiles and the whole
built city falls through to the `residential` fallback. Painting it is worth doing, but it
is [its own job](district-repair.md) and it must not stand in front of this one.

**The cell is a 12×12 block of grid coordinates, derived at boot.** Measured against the
tree on 2026-08-24, the built city is far smaller than it feels:

| Coldwater, as it exists today | |
|---|---|
| urban tiles (`terrain` in road/asphalt/concrete/park/dirt_road, or carrying a building) | **273** |
| of those, road surface | 168 |
| named buildings (facades) | 85 |
| interiors reaching a Coldwater facade through `world_exit_zone` | 187 |
| bounding box | 35 × 50 (x 892–926, y 898–947) |

Cut into blocks that gives **10 cells** at 12×12 (17 at 8×8, 7 at 16×16) — near enough the
number of districts the painting would have produced, for no authoring at all. 12 is the
default because it lands closest to that count while keeping a block walkable end to end in
well under a minute.

Three consequences worth stating:

- **The selector is a filter, not a list.** "Along roads" is
  `flags.terrain in (road, asphalt, dirt_road)` and it really is the street grid — the same
  one the GPS router prefers and `pacing`'s `ROAD_SPEEDUP` reads. "In businesses" is the 187
  interiors. Neither needs a tile enumerated by hand.
- ⚠ **Interiors inherit their facade's block.** Interior zones sit at `grid_x/grid_y` 0,0,
  which is an unset column and never a tile. An interior resolves its block by following
  `world_exit_zone` to its facade; a block index that reads 0,0 as a position collapses every
  interior in the game into one corner of the map.
- **Districts remain adoptable for free.** Nothing downstream knows what a cell *is* — it is
  a key. If the painting lands later, the block function is replaced by `districtFor` and no
  incident, scalar or regress case changes.

### Three scalars per cell, not two

- **`grip`** — how hard the authority is squeezing. Fast, responds over hours.
- **`heat`** — dissident activity, attributed per order. Fastest, responds over tens of minutes.
- **`pressure`** — a slow integrator of *grip over time*, moving over days. It raises heat's
  **baseline**, not heat.

`pressure` is not optional. Without it the fast pair converges by default: decay-on-read
pulls both toward baseline, incidents gate on high heat, so a low-heat cell can never
generate the events that would raise its heat and **dead cells stay dead forever**.
Fast pair + slow integrator is the minimal system that limit-cycles with no driver.

> ⚠ **Corrected 2026-09-03 — that last sentence is false, and it shipped.** A fast pair
> plus a slow integrator does *not* limit-cycle, because as specified above every
> coupling is positive: grip drives pressure, pressure drives heat, heat drives grip.
> Three positive couplings give one fixed point and a tick that can only converge to it.
> It converged at band 10.7 — permanently quiet, in every cell — and no value of any rate
> changed that; scaling the insurgency rate up by 10 pinned the city at watchful and by
> 50 pinned it at flashpoint, with nothing in between. **Ten of the fourteen authored
> incidents were unreachable** for as long as this was live, and the only thing that ever
> moved a band was the Wildblood's nightly burst, which is a driver from outside.
>
> A cycle needs a **negative** term, and pressure raising heat's *baseline* is not one.
> As built, unrest now **vents** the grievance that produced it, and heat **ignites**
> past a threshold on pressure rather than rising proportionally — heat's half-life is
> shorter than the tick, so heat cannot integrate and the threshold cannot live on it.
> See [systems-unrest.md](../systems-unrest.md#three-scalars) for the as-built model.

**State the period or it isn't designed.** Heat in tens of minutes, grip in hours, pressure
over days, a full cycle legible across roughly a week with a visible swing inside a 1–2
hour session. A cycle longer than a play session is invisible.

### Displacement is a bearing, not a topology

A sweep pushes heat out of the cell it landed in. With derived blocks there is a real
adjacency for free — the 8 neighbouring blocks — so displacement goes to **the adjacent
block with the lowest heat**, ties broken by the order's authored `drift` bearing on
`flags.role`.

One compass direction per order replaces the first draft's ordered district list. It is a
single authored knob, it reads as intent rather than diffusion, and it survives the switch
to districts unchanged.

---

## The load-bearing rules

These are the ones that decide whether this ships as a system or as invisible noise.

1. **Signal before effect.** An incident may not stage in a cell unless that cell carried a
   *perceivable, attributable* signal from the same order inside the preceding window. Heat
   rises → graffiti, gossip, NPC mood **first**; only then does the grip response fire. The
   player who walked past the tag yesterday reads today's checkpoint as consequence rather
   than spawn noise. Asserted in regress.

2. **No PLAYER-facing readout. Ever.** No verb, no tablet gauge, no number. The moment there
   is a readout the sim becomes a dashboard to optimise and the flavour dies. The player's
   instrument is an NPC saying *"don't go up past the water tonight."*
   **The dev panel is the opposite** — it gets the complete numeric picture, because an
   operator who cannot see the ledger cannot tune it (§Dev panel A). The line is the client
   boundary, not the data: every scalar is visible at `/dev` and none of it crosses into
   `client/game/`.
   **Ship test:** can a player who has never opened a wiki tell you which part of town is
   tense and who is doing it? If that needs a number, ship differently.

3. **Place is spoken as a bearing, never as a name.** A cell has no name, so an NPC gives a
   direction from where they stand — *"up past the water"*, *"the north end"*. Use the
   existing `bearing(dx, dy)` (`server/engine/map-text.js:36`), which already drops the minor
   axis so a thing nearly due north reads "north" rather than "north-east". ⚠ `grid_y`
   increases **southward**, which `bearing` handles and hand-rolled direction code
   reliably does not.
   This is not a consolation for lacking districts. A named district invites a mental map
   with a status per name, which is one step from the readout rule 2 bans; a bearing from
   where you are standing stays felt.

4. **The sim never moves ideology standing implicitly.** `plugins/drugwar/index.js`'s header
   records this decision being made once already ("the invisible alignment ledger was
   removed"). Rep moves only through an explicit favour turn-in via the existing
   `ADJUST_REPUTATION`. Regress asserts the plugin has no incidental `adjustReputation` caller.

5. **Danger must be audible from the tile you are standing on.** `propagateSound()` already
   reaches neighbours. That converts "ambushed by a sim I can't see" into "I heard that and
   walked in anyway" for about four lines of code.

6. **Persist the ledger, never the incidents.** A live incident holds `instanceId`s that do
   not survive a restart, and a persisted "checkpoint here" that outlives its teardown is a
   permanent checkpoint nobody authored. Correct post-restart state: cell still hot,
   checkpoint gone, next tick re-stages if still warranted.

7. **The two voices disagree, and that is the whole expressive trick.** The news wire carries
   the Ascendant version; the gossip pool carries the street version; they contradict each
   other and nothing ever reconciles them. That single fact communicates "an authority and a
   resistance" better than any scalar could. Per house style the Ascendant copy takes em
   dashes and the street copy never does — the faction split is encoded in the punctuation.

---

## Dev panel

The system is operated and authored from `/dev`, and the design principle is that **each
surface reuses an interaction a builder already knows** rather than inventing one.

### A. Unrest panel — the ledger

New nav section + `client/devpanel/js/panels/unrest.js` + a `PANELS` entry, following
`emergency` exactly (`core/panels.js:404` — `fetch: () => directAPI('/unrest/state')`, custom
`render`, live status dots, action buttons).

**The ledger is spatial, so the primary view is the map, not a table.** Reuse the region SVG
the world editor already draws (`panels/world-editor.js:70`), tinted by **band** rather than
terrain, with the block grid overlaid — one glance answers "where is it kicking off". Under
it, one row per live cell: grip / heat / pressure as bars, the band chip, the dominant order,
and time since last signal. A cell is labelled by its block coordinate and its nearest named
building, which is an operator convenience and never reaches the client.

Operator controls, all `directAPI` (live world, never staged — the same call class as
emergency and power): force a cell's scalars for testing, stage a named incident, and tear a
live one down. Live incidents list with a teardown button mirrors emergency's
activate/deactivate pair.

### B. Incidents editor

Incidents are authored content, so this rides the shared list/edit lifecycle in
`core/table.js` (`renderTable` / `openEdit` / `saveRecord`) with an `editForm`, and goes
through `API()` so it is **staged** like other content — unlike A, which is live state.
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

## Phases

Phase 1 is the whole loop, ledger through hostiles, because a version whose only output is
mood cannot be told apart from the ambience that already ships. It is built in four steps and
each is a place to stop and look, but the milestone is a player walking into something.

| Phase | What ships | Key files | Regress |
|---|---|---|---|
| **1a — Ledger** | New `plugins/unrest/`. Boot-built block index over `world.zones` (blocks derived from `grid_x`/`grid_y`; interiors resolved through `world_exit_zone`). `ledger.js`: grip/heat/pressure, lazy decay-on-read to authored baselines, band computation, batched write-behind. Forcing tick `schedule('30m')`, idle-gated. Add `flags.role` (`writes`/`reads`/`drift`) to the five canon `content/orgs/ideology_*.json`. **Unrest dev panel** (§A) over `directAPI`. | `plugins/unrest/{index.js,ledger.js,blocks.js,plugin.json,README.md,regress.js}`, `content/orgs/ideology_*.json`, `client/devpanel/js/panels/unrest.js`, `client/devpanel/js/core/panels.js`, `client/devpanel/index.html` | Decay is monotone toward baseline and never crosses it; the blob round-trips a simulated restart; a corrupt/absent blob rebuilds from baselines; every non-expansion org declares a role; no interior resolves to block 0,0; transient zones are absent from the index. |
| **1b — Perceivability** | Boundary-crossing beat off `zone.entered`, `zone.describeAmbient` (hard abstention at baseline), gossip via `pool.addItem({capGroup:'unrest'})`, news via `emit('npc.broadcast_say')`. Band-crossing events only. NPC lines speak the bearing (rule 3). | `plugins/unrest/{signals.js,voice.js}`, `docs/plugins.md` | Band events fire once per crossing not per delta; the ambient hook abstains at baseline; the crossing line fires only on a real block change; gossip respects its cap; no signal line contains a district or place name. |
| **1c — Incidents** | `incidents` table + `content-registry.js` entry + `content/incidents/*.json`. Selector, staging, teardown, concurrency cap (~3 citywide), cooldowns. Safe stage Actions: gossip, graffiti, news, ambient override, NPC mood. One `world_events` audit row per staging. Signal-before-effect enforced. **Incidents editor** (§B), staged through `API()`. | `server/models/schema.js`, `server/models/content-registry.js`, `plugins/unrest/incidents.js`, `content/incidents/**`, `client/devpanel/js/panels/unrest.js` | An incident cannot stage without a prior signal in that cell; teardown restores exact prior state; the cap holds under a forced storm; exactly one `world_events` row per staging; a `script_triggers` row binding `unrest.incident.staged` matches on `zone_id`. |
| **1d — Danger** | Dangerous stage Actions: `SPAWN_HOSTILE` (`spawnEnemySync` + behaviour graph + tracked instance ids), `SET_ZONE_FLAG` for a **RAM-only** `checkpoint_cfg`, and `ESP_ACTIVATE`/`ESP_DEACTIVATE` **registered as Actions inside `plugins/emergency`** so nothing imports across plugins. `propagateSound` warning to neighbours before anything hostile lands. | `plugins/emergency/index.js` (+ manifest, README status header), `plugins/unrest/stage.js` | Every spawned instance is removed on teardown (instance-count leak check); an incident-set `checkpoint_cfg` is gone after teardown *and* after a simulated restart; no hostile stages without a prior neighbour warning; ESP activate/deactivate is idempotent under double dispatch; at most one ESP is live at a time. |
| **2 — Participation** | Incident-response **favours**: repeatable quests keyed to live incidents, paying `rep` on turn-in through `ADJUST_REPUTATION`. Player-side resolution deltas. Closes the documented repeatable-work gap. | `content/quests/**`, `plugins/unrest/favours.js`, `docs/systems-ideologies.md` | Rep moves only through an explicit turn-in; a favour cannot be turned in for an already-resolved incident; repeated turn-ins never walk an `<order>_arc` flag backwards. |
| **3 — Null + Wildblood** ✅ | `vendetta` (reads grip, targets Ascendant assets not ground) and `incursion` (external clock, burst, no baseline). Both are drivers into the existing ledger — no new state. Exodus stays `withdrawn`. | `content/orgs/ideology_{null,wildblood}.json`, `content/incidents/**`, `plugins/unrest/roles.js` | A `vendetta` incident stages against high-grip cells regardless of heat; an `incursion` fires off the clock with no local-state precondition and leaves no residual baseline; `withdrawn` never stages anything. |

**Where phase 3's build departed from this plan**, and it is one decision: the roles were
already authored on the orgs by 1a, so the file the plan names as `roles.js` is not a set
of two behaviours but a **registry**. Eligibility, not the tick, was the thing that needed
to stop being one rule — `ledger.step()` had correctly excluded both orders from its cycle
since 1a and needed no change at all. The incursion also gained one thing the plan does not
mention: the night's target cell is **derived from the night** rather than rolled, because a
clock-only gate makes every cell in the city eligible at once and the selector would have
staged raids in four places on the same night.

---

## Where the state lives

**One `world_flags` JSON blob, RAM-authoritative, write-behind.** Not a new table (the payload
is ~10 cells × 4 numbers — a Map's worth of data does not justify a schema change, a
registry entry, a boot load and a read-tier decision), and not pure RAM (this repo deploys on
every push to `main`; a ledger that resets every deploy *is* a stateless roll with extra steps).

World flags go through the ordinary scope-parameterised `getFlag('world', key)` /
`setFlag('world', key, value)` in `server/engine/flags.js`, which already keeps them in a
write-through Map, so reads are free and there is no new cache tier.
`plugins/jobboard/index.js:155` is the precedent — `jobboard_rot_<id>` holding `{jobs, at}`.

Three conditions that make it honest:
1. **Version the blob** (`{v:1, at, cells:{…}}`); absent or unparseable rebuilds from
   authored baselines. Version it from the start: the cell key changes if districts are
   adopted later, and a v1 blob keyed by block must be discarded rather than misread.
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
| Bearings | `bearing(dx, dy)` — `server/engine/map-text.js:36`; drops the minor axis, and knows `grid_y` runs southward |
| Authored fan-out | `script_triggers` binds **any** event-bus name to a VINE graph with `zone_id`/`conditions`/`chance`/`cooldown_seconds` — `server/engine/script-triggers.js` |
| Cross-plugin effects | `registerAction`/`dispatchAction` by **name**, never an import — `server/engine/actions.js:27` |
| Temporary hostiles | `spawnEnemySync(template, zoneId)` accepts a hand-built template, no DB row — `world.js:1614`; `plugins/emergency/index.js:340` is the working reference |
| Rumours | **exported** `plant()` / `addItem({capGroup, coalesceKey, reach})` — `plugins/gossip/pool.js:51,112` |
| News | `emit('npc.broadcast_say', {channel_id, text})` (`enqueueNews` is module-private) — `plugins/broadcast/index.js:5315` |
| Warning sound | `propagateSound(originZoneId, message, loudness, broadcastFn, flavour)` — `server/engine/sounds.js:131` |
| Lockdown | the complete ESP: sirens, `esp_state` client messages, `setEspShelter` AI override, Arbiter spawns — `plugins/emergency/index.js` |
| Checkpoints | move gate reads `zone.flags.checkpoint_cfg` off the **live RAM zone object**; `world.zones` is never written back, so a temporary checkpoint is restart-safe by construction — `plugins/checkpoint/index.js:121` |
| Wall tags | `graffiti.tagged` already emitted, stateless 3-game-day expiry — `plugins/graffiti/index.js:268` |
| Vignettes | `ambient_routines` is already "authored scene selected by world state"; gate on band rather than building a parallel system — `plugins/ambient-life/` |
| Rep | `adjustReputation` / `ADJUST_REPUTATION` — `server/engine/ideologies.js`, `plugins/ideologies/index.js` |

### Traps confirmed in this codebase

- ⚠ **ESP is a singleton.** `plugins/emergency/index.js` keeps a module-level `espActive`
  boolean alongside its `espZones` set, so two concurrent incidents cannot each own a
  lockdown — the second `activate()` silently joins the first and the first `deactivate()`
  ends both. Either cap live ESP incidents at one, or scope `espActive` per zone-set in the
  same commit that registers the Actions. Regress asserts the cap.
- **`fireHook` keeps the LAST non-undefined result** (`server/engine/plugins.js:186-195`) and
  load order is filesystem-alphabetical, so `unrest` sorts *after* `district-ambience` and
  would silently outrank it on every beat it answers. Abstain aggressively (return `undefined`
  at baseline) **and** declare `"after": ["district-ambience"]` in `plugin.json` to make the
  order deliberate (`docs/plugin-standard.md:22`).
- **`script-triggers` normalises the zone as `payload.zone ?? payload.zoneId`** — name the
  field one of those or a trigger row's `zone_id` filter silently never matches.
- **`emit` is synchronous and swallows subscriber throws** — incident staging must not run
  inside an emit.
- **17,259 zones.** Build the block index once at boot; never scan `world.zones` per tick, and
  exclude `world.transientZones` or a void-crossing room gets a checkpoint.
- ⚠ **`grid_x`/`grid_y` 0,0 is an unset column, never a tile.** Interiors carry it, so a block
  function that reads coordinates directly puts all 586 interiors in one cell. Resolve
  interiors through `world_exit_zone` and reject 0,0 explicitly.
- **The city is not the region.** `region_coldwater` is 4,838 tiles of which 2,865 are
  `redrock` waste; the built city is the 273 urban tiles inside a 35×50 box. Gate the block
  index on the urban filter, not on `region_id`, or the sim spends its heat on empty ground.
- **Neither idle-gate nor `runWhenEmpty` alone is right.** An idle-gated ledger means you log
  in to exactly the state you left; `runWhenEmpty` pins Neon compute awake billing for nobody.
  Use lazy decay-on-read (the `decayRep` pattern) **plus** an idle-gated tick that does only
  forcing.

---

## Verification

- `npm run test:regress` after every step — mandatory (new plugin, new manifest, engine seam
  in 1d). Per-step assertions are in the table above.
- `npm run content:lint` before any `content:import`; 1c and 3 are content-heavy.
- `docs:lint` gates all four checks — `docs/systems-unrest.md` needs an honest status header,
  every verb must be named in `docs/plugins.md`, and 1d's edit to `plugins/emergency` must
  keep that README's status header consistent with its manifest.
- `npm run client:smoke` covers the new devpanel file for parse errors — the only automated
  coverage it gets. ⚠ Devpanel panels are large HTML template literals: **quote identifiers
  inside them with 'single quotes', never backticks**, or the file ends its own string
  mid-comment and takes the panel down.
- **Manual end-to-end:** force a cell's heat from the Unrest panel, walk the block boundary
  and confirm the crossing beat fires exactly once, confirm an NPC gives the bearing and not
  a name, confirm the ambient layer still shows district signature lines at baseline, restart
  the server and confirm the ledger survives while the staged incident does not.
- **The real test is the ship test in rule 2** — walk a tense part of town cold and see
  whether it reads as tense without being told a number.

---

## Appendix — adopting districts later

Nothing above knows what a cell is; it is a key produced by one function and a label produced
by another. If [district-repair.md](district-repair.md) ships, `blocks.js` swaps its key
function for `districtFor`, rule 3's bearing gives way to the district's name, and the stored
blob is discarded on its version bump. No incident, scalar, hook or regress case changes.

That is the reason to build on blocks now rather than to wait: the painting is worth doing on
its own merits, and this system does not have to be the thing that pays for it.
