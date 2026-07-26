# Overland Void Travel — crossing the waste between regions on foot

**STATUS: BUILT** (`plugins/voidwalking/`). Sections marked **BUILT** describe live behaviour;
everything else is the design intent behind it. The system lets players travel *on foot* between
[regions](reference/land-taxonomy.md#region--the-spatial-place-renamed-2026-07-19-from-district)
that are otherwise only reachable by air, reusing the survival, weather, danger, and perimeter
systems already shipped.

Related: [[project_wildlands_curtain]] (the near leg), [[project_the_reach]] (first destination),
[docs/systems-survival.md](systems-survival.md), [docs/systems-weather-extreme.md](systems-weather-extreme.md),
[docs/reference/land-taxonomy.md](reference/land-taxonomy.md).

---

## The pitch

Regions are islands. Between Coldwater and The Reach there is no road, no bridge, no authored grid —
just **the void**: a killing waste you cross on foot when you can't afford wings. A crossing is a
**branching roguelike gauntlet** generated on demand, thrown away when you arrive. Water is the
currency of distance; the void's wildlife and its feral people are the tax on every extra step. You
either come out the far side, or you die out there and leave your pack for the next fool to find.

Flight stays the *fast, expensive* way in. The void is the *slow, brutal, cheap* way in — and because
its salvage exists nowhere else, even pilots walk it on purpose.

---

## Core model: regions as islands, the crossing as the bridge

There is **no authored corridor** between regions. The space between them is genuinely empty on the
grid. A crossing **is** the connective tissue — a generated instance you enter at a region's edge and
exit at the destination's edge. This is what lets "The Reach is ~1,000 tiles south of Coldwater" stop
mattering: you never traverse the grid, you traverse an *instance*.

### The crossing is a deterministic, seeded generator — not stored geometry

The void is a **formula, not DB rows.** A crossing's map is a pure function of its seed; the engine
persists almost nothing:

- **Geometry** (rooms, branches, terrain, rad bands, rest sites, loot detours) is derived from the
  **route + window seed** (see below). Given the seed and your position, the current room is
  reconstructable at any time.
- **Per-player state** is five scalars in `player_flags` (written/cleared in one batched
  upsert/DELETE): `crossing_void`, `crossing_window`, `crossing_origin`, `crossing_instance`, and
  `crossing_room` — the current room id, flushed lazily on logout, not per step.
- **Relog-safe by construction:** log out mid-void, log back in, the plugin re-derives the instance
  from `crossing_instance` and replaces you at `crossing_room` (the deterministic graph regenerates
  identical room ids). Nothing about the void geometry is stored, so nothing can desync.
- **Death** clears the five flags → normal clone-vat respawn. The run simply evaporates.

This honors the project rule against new content in the DB and against per-tick DB writes: the void is
computed, not queried.

### The linchpin: seed by **route + rotating window**, not per-player

The geometry seed is a function of **(route, current window)** — *not* of the individual player or
run. Everyone crossing `Coldwater→Reach` during the same window walks the **same generated map.** This
single decision makes the whole social layer fall out for free:

| Consequence | Why it works |
|---|---|
| **Party crossings** | You're together because you're on the same route in the same window — same seed, same rooms. No party-instance coordination hack; shared geometry is automatic. |
| **Ghost-traces are real** | A death at "node 5, left branch" is at node 5, left branch *for everyone this window*. Corpse-packs and ash-scrawls pin to actual rooms, not vibes. |
| **Not permanently memorizable** | The window rotates. Next window's `Coldwater→Reach` void is a different map. |
| **No stored geometry** | The void is `f(route, window, node)`. Only a small **traces** table (deaths) and four player flags persist. |

**Window cadence: weekly (slow).** This is deliberate and gives the system its signature rhythm:

- **Window opens:** fresh geometry. Blind gambles, unknown rad/raider placement. Max terror, high
  death count.
- **Midweek:** ghost-traces have accumulated — *the graves are the map.* Veterans chart the safe
  branches and the loot detours; knowledge spreads. A "known bad crossing" becomes lore.
- **Window closes:** the community has largely tamed this week's void… then it resets and the fear
  returns.

So "slow window" doesn't fight the blind-gamble feel — it makes the void a thing players collectively
**solve and re-lose every week**, with the trace system as shared memory.

### Geometry shared, threat private

Clean split that keeps repeat runs fresh even on a known map:

- **Geometry** comes from the route+window seed → shared, stable for the window (so party + ghosts
  work).
- **Encounters / ambushes** roll **live, per party, per step** (off the carried salt + real time) →
  private, fresh. Two parties can walk the identical layout this window and get jumped completely
  differently. *Same map, different war.*

---

## Topology & destination — how you pick where you're going

### Regions form an adjacency graph

Void-routes are **edges between neighboring region-islands**, not links from anywhere to anywhere. A
crossing takes you to an *adjacent* island; distant regions are reached by **chaining crossings**
(region-hop through intermediates), or stay air-only until a route is authored in. The graph grows
one edge at a time — `Coldwater—Reach` first (via the Wildlands leg), then `Coldwater—Exodus`, then
e.g. `Reach—Exodus` as a lawless-frontier shortcut. No combinatorial explosion: you only build edges
that make fictional sense, and each edge is independent content (its own seed namespace, its own
traces set).

### Destination = declared heading at the gate, mastery inside the void

You **declare intent when you depart** (an adjacent region — the adjacency graph gates what's a legal
heading), then the void is about **how well you hold that heading versus getting pulled off it.** The
crossing is *not* a labeled hallway to your chosen region — it's a **braided multi-destination map**:
routes to different adjacent regions **share early nodes and diverge deep.** The first stretch out of
a region is directionless waste common to every southern destination; the forks are where it splits.

A fork is a **read, not a label.** Landmarks telegraph direction — a mountain silhouette, a leaning
radio mast, the sun's angle, which way the rad-haze thickens — but nothing is signposted. Read the
signs well and you hold course (and skilled readers can *deliberately divert* toward a different
adjacent region or a loot pocket); read them badly and you **drift**, and drift can surface you
somewhere you didn't intend, or deeper into nowhere. Misrouting isn't a failure state — it's an
adjacent place with its own content, and a story.

This is the destination layer of the **weekly-solve loop**: early in a window nobody knows which fork
goes where; ghost-traces and shared knowledge chart the braid by midweek ("second left past the
overpass for the Reach; the mast fork is a raider trap"); Monday it reshuffles and the signs mean
something new. **Navigation itself becomes a mastered-and-re-lost skill, not just survival.**

> The **declared heading** is the guardrail that keeps this from being pure "where the hell am I"
> griefing: you always leave *aiming* at a legal neighbor, so drift is a risk you took, not a random
> mugging. Intent at the gate, mystery in the void.

**Generator cost:** this is the more expensive shape — one braided graph per region-void (shared trunk,
diverging limbs keyed to each adjacent destination) rather than independent per-route maps. It buys the
only version where the *destination* is part of the unknowable void the community charts weekly.

**BUILT:** a void is a **`VOIDS[regionId] = { origin, trunk, dests[] }`** graph owned by a region — a
shared **trunk** (config room count) that forks toward each destination in that dest's `dir` (n/s/e/w),
then a distance-derived **limb** per region down to its real edge tile. The fork is the real choice —
hold your heading down one limb, or **divert** down another to a different region. Detours hang off
shared-trunk rooms. Void `region_coldwater` forks to **The Reach** (south) and **Exodus** (east).
Regress proves both limbs reach their region and that you can divert at the fork. Still N/S/E/W only
(the engine has no diagonals) and single-fork (no nested forks).

### Where the graph lives — authoring vs. seeing

The adjacency graph has two surfaces, and they are different things (SSOT vs. view):

- **Authored in the dev-panel World Editor.** Regions already live there (`regions` table, New Region /
  Region Maps / drag-to-move — see [land-taxonomy.md](reference/land-taxonomy.md#region--the-spatial-place-renamed-2026-07-19-from-district)).
  The graph is **edges layered on that existing region set** — a mode where you wire a void-edge between
  two regions. Small authored config (which pairs connect), and it keeps the **one-SSOT** rule: the graph
  is region-editor data, *not* inferred from zone-id prefixes or scattered flags. *(As built, there is no
  departure-gate tile at all — the whole region edge is the gate: `VOIDS` is keyed by `flags.region_id`,
  the region SSOT, so any tile in the region can strike out and any unexited region edge is porous to the
  void.)*
- **Seen by players as an abstract *frontier map*, not the grid.** You can't draw this to scale — the
  Reach is ~1,000 tiles from Coldwater and the void between has no real geometry. So the player view is
  a **topology diagram** (region-islands as nodes, void-routes as edges — a subway/travel-network read),
  *not* the tile-grid [Map app](systems-map.md) bigmap. It surfaces in **two places (both):**
  - **At the gate** (diegetic, in-world): standing at a departure threshold reads out the reachable
    neighbours — *"from here you can strike out toward: The Reach, Exodus."* The local slice, at the
    point of decision.
  - **On the Tablet** (persistent planning): a **Frontier** view/mode showing the whole known topology.
    This is where the weekly-solve knowledge is drawn — which routes you've survived, and the window's
    ghost-trace intel ("3 died on the Reach road this window").

**Fog model: fogged / earned.** You only see regions and routes you've **discovered** — heard of at a
gate, or survived. The frontier map fills in as you explore; a route's current-window danger/trace
intel is likewise earned by scouting or asking, not handed over. Discovery is a real progression layer.

**BUILT:** each void carries an `origin` region, and the adjacency graph is player-visible two ways:
**(1) the frontier readout** — the `frontier` verb anywhere in a void-region reads out the reachable
regions (*"the trail splits toward The Reach, Exodus"*); **(2) the Tablet Frontier app**
([`plugins/tablet/frontier-app.js`](../plugins/tablet/frontier-app.js), 🧭) — an abstract topology
(origin regions → routes), *not* the grid, rendered from `frontierView(player)`. **Fog is per-player
state** in a `frontier_log` flag (`routeId → charted|survived`): reading a gate or striking out
**charts** a route; arriving at a region **upgrades** it to *survived*. Written only on
discovery/arrival (rare). Still a **list**, not a graphical node-and-edge diagram; the window
ghost-trace intel overlay is not built.

---

## The survival gauntlet

### Primary clock: water + attrition

The meter most likely to kill a dawdler is **thirst**, compounded by **combat attrition**. There are no
natural water sources in the void; water is what you carried in, and it's the literal currency of
distance. Every extra step — every wrong branch, every retreat — costs water *and* exposes you to
another fight that chips HP you may not get back. Length compounds both. (Rad and cold/heat still tick
via the existing systems as secondary pressures, but water + fights are the spine.)

### The map: a branching roguelike graph

Movement is through a **branching graph**, forward-biased, with meaningful forks. The decision texture:

- **Risk-for-loot detours** — a branch leads to a wreck / ruin / mutagen cache with real salvage, but
  it's guarded, irradiated, or both. Greed vs. survival.
- **Blind gambles** — you often *can't tell what a branch holds* until you commit. The void is
  unknowable within a fresh window; that's where the dread lives. (Ghost-traces are how the community
  gradually converts blind gambles into informed ones over the week.)

**BUILT:** a **safe spine** (the distance-derived chain) plus seeded **risk-for-loot detours** — off
interior rooms, a lateral `west` exit into a dead-end gamble room (a half-buried wreck, a collapsed
bunker; `east` is the only way back out). Detours carry a **higher encounter chance**
(`DETOUR_ENCOUNTER_CHANCE 0.7` vs `ENCOUNTER_CHANCE 0.45`; a seeded hard node runs
`HARD_ENCOUNTER_CHANCE 0.85`) and hold the richer salvage tiers; their description is a **blind
gamble** ("salvage, maybe; a grave, maybe; both, maybe"). Seeded per `(route, window, node)` so the
forks are the same for everyone this window; **guaranteed ≥1 per crossing** so the choice always shows
up. Entering a detour is *not* progress (no node advance) and the instance reference-counts + tears
down detour rooms too.

### Risky rest sites

No safe haven, but not pure attrition either. Rare rooms (a cave, a wreck, a dead turret's shadow) let
you **rest and heal** — at a price: resting **burns water** and **risks an ambush interrupt**.
Recovery is a gamble you choose to take, not a given. HP otherwise does not passively regenerate in the
void (posture regen suppressed — consistent with "no indoor haven").

### Retreat costs

You can turn back, but the void doesn't care which way you face: re-walking rooms re-rolls their
encounters hot, and the return is as far and as dangerous as going forward. No free abort — a bad run
is a commitment, not a mistake you can casually undo.

### The encounter roster (live-rolled)

The full bestiary, rolled per step:

- **Wildblood raiders** — the renounce-faction mutants from [[project_wildlands_curtain]]; fight, flee,
  or maybe parley.
- **Mutant beasts** — irradiated fauna, territorial, no negotiation. Pure combat.
- **Desperate scavengers** — other broke crossers gone feral; might trade, might rob. Sometimes a
  resupply, sometimes a knife.
- **The void itself** — environmental set-pieces as "encounters": sinkholes, chem pools, a collapsed
  overpass, a turret-ghost still tracking. *(Not yet built — creature encounters are.)*

**BUILT:** on **first arrival** at a non-threshold room a **live roll**
(`ENCOUNTER_CHANCE 0.45`) spawns a **real enemy** from the void roster (`spawnEnemySync` → the normal
combat/AI systems take over — actual fights, real loot on the corpse). The roster is a curated pool of
committed wasteland foes (ash crawlers, rad/bloated mutants, feral dogs, wire jackals, scavengers,
scrap pickers, sprawl gangers, slag wretches), loaded once from the `enemies` table at boot; live-rolled
per step (private/fresh over the shared geometry — "same map, different war"). The crossing
reference-counts what it spawned and **despawns on teardown** (no foe leaks into a torn-down instance);
a room already holding an enemy never stacks another. Environmental "the void itself" hazards + the
retreat-re-rolls-hot rule are **not built**.

### Death and the trace it leaves

Death in the void is **real death** — clone-vat respawn, the run gone. But your **pack is left behind
as a ghost-trace**: because geometry is shared for the window, your corpse-pack sits at a real node
that *other crossers this window can find and loot*. You die for keeps; your gear becomes someone
else's fortune and a marker on the community's slowly-drawn map. (A small **traces** table keyed to
`(route, window, node)` is the only persistent void state besides player flags.)

**BUILT:** the dead are your map. Two trace kinds, keyed by
`(void_key, window, room_salt)` — the salt (`t2`/`reach1`/`d_t2`, carried on `flags.void_salt`) pins a
trace to the same room across **every private instance this window** (async presence, no live
collision — the bloodstain model):
- **Corpses** — dying in the void writes a corpse trace (`handle` + cause) at the death room. *(This is
  also where a void crossing gets torn down — respawn is an in-memory move, not a `cmdMove`, so
  `zone.entered` never fires; the `player.death` handler cleans up the dangling crossing.)* Lootable
  corpse-**packs** (the dead's dropped gear) land with Slice 5's loot economy — for now the corpse is a
  *clue* (where people died = danger intel).
- **Scrawls** — `scrawl <text>` leaves a **four-letter** mark (RUN, GAS, COLD, HELP…) at your room for
  whoever crosses here this window.
Both surface on room entry ("*Scratched into the ground, four letters: RUN*" / "*A body half-buried in
the dust — what's left of Kaz, killed by a rad-mutant.*"). **Near-zero DB** exactly as specced: one
INSERT per scrawl/death (rare), reads served from a per-`(void, window)` **RAM cache**, stale windows
purged on load. Void rooms are `flags.lawless` (die out here → clone-vat, never jail). Table:
`void_traces` (runtime-classified).

### Departure: free to die

Entering is **passive** — the threshold gives a warning read ("you carry 1 water; the far gate is
far") and then **lets you walk in and perish.** No hard supply gate. The player's funeral. Agency over
hand-holding.

**BUILT:** the void is owned by a whole **region**, keyed by `flags.region_id` — `VOIDS` is indexed by
region (`region_coldwater`), not a bespoke per-tile flag. **One way in: walk out of the world.** A
cardinal step off a boundary tile fires the generic engine hook **`movement.edge`** (from `cmdMove`'s
no-exit branch), which the plugin answers by opening the muster. The whole rim of a region is porous —
there is no gate tile, and no `flags.void_gate`. The `movement.edge` seam is a law that names no
system: any edge-of-map transition can use it.

**The rim is missing TILES, not missing exits.** `isMapRim(zone, direction)` resolves the neighbouring
**coordinate** on the same `map_id`/`grid_z` and counts it as rim only when no tile exists there at
all. Do not equate "no exit that way" with "edge of the world" — 483 world tiles sit beside a
neighbour they simply don't connect to (building facades, water margins), and treating those as rim
opens the muster when you bump a wall downtown. Both landmasses are hole-free rectangles
(Coldwater 863-955 × 896-947, The Reach 903-922 × 976-995) → 362 boundary tiles.

**Water is not the rim.** You cross the waste on foot, so a tile whose `zoneTerrain` reads `water` has no
rim in any direction — no line, and no way in. The *entire* northern edge of Coldwater (all 93 tiles of
row y=896) is Coldwater Basin, plus 16 more down the east and west water margins. **109 of the 362
boundary tiles are open water, leaving 253 real land rim tiles.** Whatever is past the far shore belongs
to boats and the leviathan, not to the void.

**Salvage pays for the walk (rebalanced 2026-07-21).** `loot` fires once per room against a
three-tier `LOOT` table (spine rolls tiers 1–2, detours 2–3). The first cut was 4/4/3 items with
`item_scrap_metal` — which vendors buy for **₵0** — on tier 1, so a place that spawns enemy packs and
eats your corpse frequently paid nothing, and when it paid, it paid the same roadside junk you can
scavenge free on the spawn tile. Now:

| tier | diff | pool |
|---|---|---|
| 1 staples | 4 | 11 items, ~₵7.9 |
| 2 salvage | 8 | 20 items, ~₵16.1 |
| 3 rare | 12 | 6 items, ~₵75.1 |

Entries are `[itemId, maxQty]` and the quantity rolls `1..maxQty`, so staples and bulk materials can
come up as a real haul. A **near miss** (`margin >= NEAR_MISS`, −4) yields a tier-1 scrap rather than
nothing — a flat miss is a dead 3.5s in a room that can kill you. The regress `setSalvage` override
stays a hard pass/fail so the dud path is still testable.

**Two balance rules that bind when editing `LOOT`:** nothing worth ₵0 (e.g. `item_scrap_metal`, which
vendors won't buy) goes in a tier the spine can roll, or the void pays nothing for the risk it charges;
and **widen tiers 1–2, never tier 3** — adding ₵20-ish odds and ends to tier 3 dilutes the scrap-pistol
roll and *lowers* the payoff for the hardest check while looking like a reward increase.

**There is no entry verb.** You cannot decide to cross, only walk until the world runs out. `voidwalk`
stays registered solely because the muster overlay's buttons send `voidwalk cancel` /
`voidwalk say <text>` ([`client/game/js/panels/voidwalk-staging.js`](../client/game/js/panels/voidwalk-staging.js));
bare `voidwalk` returns an in-fiction refusal that points at the rim. The muster is a ready-check:
**every member of the cohort must `ready`** before the crossing launches.

**The muster screen is "VOIDWALKING" (renamed 2026-07-25).** It used to be titled *The Crossing* and
badged `ARCHITECT OS`; it now reads as the **VOIDLINK** firmware, matching the tablet out past the rim —
cold slate, scanline haze, survey brackets at the corners, a chromatic-split wordmark, and a rule
stamped `NO ROADS · NO RESCUE · NO RECORD` (`.vwstage-*` in `client/game/styles.css`). Stepping off the
edge also prints a ruled **ENTERING THE VOID** stamp in the message pane (`VOID_ENTRY_BANNER`, sent to
the leader and every follower) — deliberately ruled rather than boxed so no glyph has to line up with a
closing edge.

---

## The social layer

- **Party crossings** — depart and cross as a group. Full model in [Parties](#parties) below.
- **Ghost-traces** — corpse-packs and scrawled messages from the window's dead, pinned to real nodes.
  The accumulating record that turns a fresh-window death-trap into a midweek charted route.
- **The weekly solve-and-reset loop** — see window cadence above. This is the beating heart of the
  system's replayability.

---

## Parties

Parties **reuse the existing follow primitive** ([server/engine/commands/movement.js](../server/engine/commands/movement.js)
`player.following` + `dragFollowers`) — there is no new party object. `dragFollowers` already mirrors a
leader's *exact move* to same-zone followers; the void just extends that into the instance.

- **Formation = `follow` at the gate.** The **leader** declares the heading and departs; followers
  `follow` the leader and are dragged into the void with them. `dragFollowers` mirrors the leader's
  exact direction, so **only the leader reads the forks** — followers ride the leader's navigation node
  by node. Followers inherit the leader's heading; they don't declare their own.
- **Co-presence → one cohort → one shared fight.** The drag keeps everyone at the same node, and
  shared-seed geometry means it's literally the same room. The party is a single **cohort**, so the
  live encounter rolls **once for the group** — you meet the raiders together, more guns on one threat.
  That's the mechanical reason to party. A member who breaks off becomes their own cohort with their
  own rolls.
- **Fork behaviour: auto-drag + a leader "hold" call.** Followers auto-drag through forks by default
  (as follow works everywhere), but the leader can call a **halt at a branch** to regroup/discuss
  before committing. Trust by default, deliberation when the read matters.
- **Survival is pooled, not shared.** Everyone keeps their own water / HP / rad. Depth comes from
  logistics via existing `give`/`trade`: a strong member hauls extra water for the one running dry,
  someone carries the stims. The weakest link (or a leader's bad fork-read draining everyone's water on
  a detour) is the party's real enemy.
- **Death = losing a member for real.** A dead member is real-death'd → clone-vat respawn at the origin
  region, out of the run, follow-link auto-broken. Their **pack drops as a ghost-trace at that node**,
  so the survivors can loot their fallen friend's water and gear on the spot (and another party finds
  it next week).
- **Splitting & regrouping.** Unfollow to peel off (scout a blind loot detour) while the party waits at
  a rest site. Shared-seed geometry lets you navigate back, but retreat re-walks rooms and re-rolls
  their encounters hot — separation is a real gamble. Rest sites are the natural rally points.

### The void, on the Tablet

**BUILT, reworked 2026-07-22, polished 2026-07-25** (`client/game/js/panels/tablet-os.js`): the tablet
used to gate almost every app behind a live "pan the tablet to find a signal pocket" hunt, with apps
flickering out to a "D/C" badge and booting you back to the home screen if reception dropped mid-app —
it read as broken more than atmospheric. It's now a one-shot ritual in two beats, and **no app is ever
gated**:

1. **Void firmware boot** (`runVoidFirmwareBoot`). The first tablet open of a crossing gets the harsher
   voidwalking power-on into the device's *own* firmware terminal instead of the ArchitectOS logo:
   `VOIDLINK FIRMWARE 3.1.7-w` cold-starts line by line, fails the ArchitectOS uplink three times
   (`NO CARRIER`), gives up on grid services and boots into **VOIDLINK LOCAL — NO GRID**. Off-grid the
   chassis header renames itself `VOIDLINK / Local Firmware · Off Grid` for the whole crossing.
2. **Searching → weak lock.** The OS comes up in a **SEARCHING** state: the header reads
   `NO SIGNAL · SEARCHING`, a footer hint says *move the tablet*, and the screen's **text** flickers
   (`.tos-void-searching` animates `.tos-scroll` opacity — the panel itself never strobes; the old
   whole-screen brightness crush is gone). Actually dragging the tablet ≥60px finds the position: one
   soft brightness swell, and the badge locks to `WEAK SIGNAL · OFF GRID` **permanently for that
   crossing** — moving it again afterwards changes nothing.

Off-grid theming (`.tos-void-mode`: scanline haze, a slow drifting interference band, an accent
vignette pulse) persists as long as `isOnCrossing()` holds, purely cosmetic. The **TV app shows dead
air** out here — colour bars + a flickering `NO SIGNAL`, short-circuited in `renderTv` before the
shared tuner view is built, so no portable tuner is opened in the void. Entering a fresh crossing
re-arms both the firmware boot and the signal hunt.

Split-party comms across nodes without co-presence, and a gear-gated radio item to bridge that, remain
**unbuilt design** (not wired to anything today) — see [[project_tablet_chat_app]] for the chat app
itself, which is one of the apps that now Just Works once the tablet's signal locks.

### Party seam note

`dragFollowers` currently passes `bypassEncumbrance` (dragged moves skip the run-stamina toll). In the
void, each follower must still pay their **own per-step water** — a deliberate deviation, or a party
crosses on one member's navigation for free.

---

## Instancing — one void per party

**Each party gets its own instance of the void. Parties never run into each other live.** This is *the
reason the shared `(origin, window)` seed exists*: it makes every party's private instance the **same
map layout**, so cross-party contact happens **asynchronously, through the dead** —

- Party A dies at "overpass-left, node 5" → a ghost-trace pins there.
- Party B, later that week in *their own* instance, walks up to overpass-left node 5 and **finds A's
  corpse-pack and scrawl** — same node, same map.

This is the **Dark Souls bloodstain model**: instanced world, no live collision, shared
messages/ghosts stitched across instances by a common seed. Live co-presence was never the goal — the
shared geometry exists to make *asynchronous* presence geometrically real. (Live co-presence would make
the whole trace system redundant.)

Why instanced is the right default:

- **Grief-proof by construction** — no spawn-camping a broke newbie at the gate.
- **Clean encounter rolls** — "per party per step" only holds if a party's void is theirs alone.
- **Cheap** — no live-occupancy tracking of synthetic rooms, no crowd netcode in generated space; a
  party instance is just its follow-cohort over the memoized geometry. Preserves the near-zero-DB story.
- **Tone** — lonely and haunted, not crowded. You're alone out there except for the dead. Scarier, and
  it matches the "off-grid / NO SIGNAL" mood.

**BUILT:** a crossing is a per-crossing **instance** in the `crossings` registry,
keyed by a unique instance id; room IDs are namespaced by the instance (`xing_<leader>_<n>_<node>`) while
room *content* is seeded by `(route, window, node)` — shared geometry, private instance. A **party shares
one instance**: the cohort is the leader + everyone **following** them (the follow substrate — no party
import) co-present at the origin, all placed into room 0 together and reference-counted, so the transient
rooms tear down only when the **last** member leaves. The current room is RAM-only, flushed to
`crossing_room` on `player.logout` (not per step). Relog re-derives the instance from
`crossing_instance`; the first member back rebuilds it, the rest join.

**Decision: strictly instanced + async for v1.** But leave the door open — architect the instance
seam so **opt-in live overlap can bolt on later** without a rewrite:

- *Later — co-op summon:* a beacon/flare item lets a friend's party deliberately join **your** instance
  (cross-party co-op); random strangers still never appear.
- *Later — PvP invasion:* a hostile player can invade your crossing (full Souls). Maximum tension, but
  opens griefing and needs PvP rules — a deliberate future layer, not v1.

The practical seam requirement: an instance is keyed by an **owning cohort id**, not hard-bound to a
single party — so "admit another cohort into this instance" is later a permission change, not a
re-architecture.

---

## Payoff — why anyone crosses

- **The only cheap way in.** The reward is *access*: you reached The Reach without affording flight +
  licence + fuel. The journey is its own gate. (Foot's primary niche: the broke early-game player.)
- **Salvage that exists nowhere else.** The void's loot — pre-war wrecks, mutagens, contraband — makes
  crossing worthwhile *even for pilots*. This is what widens the audience beyond newbies: the equipped
  walk the void on purpose for the detour caches. Full model in [Loot & scavenging](#loot--scavenging).

---

## Loot & scavenging

The void is where the [Scavenging system](systems-scavenging.md) finally has a frontier to justify it.
**Reuse the Scavenging skill + posture-search UX + the 2D8−2D8 check** — but since the void has no DB
zones, the **generator assigns each room a scavenge table + richness tier deterministically**
(`f(origin, window, node)`), and the check runs **live in RAM**. Same skill, same feel, zero DB, and
"good scav ability" is directly rewarded: a high-Scavenging character finds more, and finds the *rare*
tier a low-scav one walks past. This gives parties a genuine **role split** — navigator (leader),
water-mule, and **scavenger** (turns a deadly detour into a payday).

**BUILT (Slice 5a — ambient scavenging, branch `void-travel`):** the **`loot`** verb reuses
`effectiveSkill(player,'scavenging')` + the 2d8−2d8 check + `awardSkillUse` (a near-miss still trains
you). Loot is generated in RAM — a 3-tier table (`LOOT`: staples `diff 4` → salvage `diff 8` → rare
`diff 12`), drawn from committed items (water/rations up top, wiring/circuits/ore mid, mystery-component/
glowing-scrap/scrap-pistol rare). A room offers a **richness tier** — spine rooms `[1,2]`, **detours
`[2,3]`** (the branching finally pays) — and your Scavenging skill decides whether you reach the good
stuff. **Once per room per crossing.**

**BUILT (Slice 5b — corpse-packs + claim-ledger):** `loot` now resolves in three tiers — **big score →
corpse-pack → ambient scavenging**:
- **Lootable corpse-packs** — the engine's `spawnPlayerCorpse` already strips the dead's gear into a
  `player_corpses` row at the death room; the `player.death` handler **re-homes** those item ids onto the
  shared void trace (`void_traces.pack`) and deletes the orphaned corpse. Another crosser, in their *own*
  instance, sees the corpse at the same `room_salt` and `loot`s it — granted the gear, and the trace's
  `claimed` flag flips **globally first-come** (the async race).
- **Weekly big score** — one telegraphed prize per `(void, window)` at a seeded shared-trunk room ("*The
  hulk of a downed gunship dominates this stretch*"), kept globally scarce by a `bigscore_claim` trace:
  the **first** crosser to `loot` it takes it; everyone after finds it stripped. Same async-scarcity
  mechanic, same cached `void_traces`.
Not built: depth-scaling + the rare-loot-is-heavy extraction tension. Carried *credits* are lost on
void death (not re-homed).

### Loot tiers, scaled to risk

- **Survival staples** (water, rations, scrap) — the *self-sustaining* reward: good scav extends your
  crossing range, so scavenging is a survival tactic, not just greed.
- **Salvage & contraband** — mutagens, components, `contraband`-tagged goods for the Reach fence.
- **Rare void-unique** — pre-war wrecks, prototype gear; the stuff that pulls *pilots* out of the sky.

Rarity scales with **depth** (deeper nodes pay better — the water-gamble of pushing on has a return),
**detour risk** (guarded/irradiated branches hide the best), **node danger**, and **Scavenging skill**.
And it feeds the greed-kills tension: **rare loot is heavy** — extracting it means hauling it back out
(retreat costs) or pushing to the far side, sometimes trading water capacity for salvage. Finding it is
the easy part.

### Two loot classes (because instances aren't naturally scarce)

Each party crosses its **own instance**, so a node's loot exists in *everyone's* run — "rare" would
otherwise mean only "hard to reach," not "few exist." So loot splits:

1. **Ambient scavenging** — per-instance, unlimited, skill-gated. Your run, your finds. (Staples +
   common salvage.) No scarcity needed; everyone scavs their own crossing.
2. **Weekly "big scores"** — a few genuine uniques per window, kept **globally scarce by a claim
   ledger** (see below). The frontier's real prizes, and they *run out*.

### Big scores: telegraphed **and** hidden, gated by a weekly claim ledger

Both kinds coexist:

- **Headline prize** — a telegraphed weekly objective the frontier *knows about and hunts* (e.g. "a
  downed gunship went down on the Reach road this window"). Drives the weekly-solve: everyone races
  (asynchronously) to reach and strip it before the window resets.
- **Hidden finds** — unadvertised rares that reward thorough scavengers who search every corner. No
  hype, pure exploration payoff.

Both are kept scarce by a **claim ledger**: a tiny global counter per `(void_origin, window, prize)`
tracks how many have been extracted. Under the [instancing](#instancing--one-void-per-party) model this
is the *async race* — you never fight another party live, but when you reach the node the prize may be
**already claimed this window** ("someone stripped the gunship before you"). That's real, felt scarcity
without live collision, and ghost-traces cluster around the prize nodes ("people died reaching for
this"). Cost: **one small write on extraction** (rare event) + a per-window claim-state read served
from the same process cache as traces — stays within the near-zero-DB budget.

---

## First build: The Reach, via the Wildlands as the near leg

The Reach is locked as air-only by identity ("the only way in/out is Buzzard Field," Cass Renner
decides who lands). Foot access is a **deliberate identity evolution**: The Reach becomes reachable
**by air OR by the gauntlet** — the brutal poor-person's smuggler trail into the haven. This *fits* the
fiction (lawless contraband haven where the "wrong kind" are welcome) rather than betraying it.

The geography makes The Reach the natural first destination:

- The Reach is **south** (`grid_y ~1948`). The Wildlands are **south** (`grid_y ≥ 920`), with a
  "Deeper Wild" stub already at `919_927` pointing further south.
- So the road to The Reach **runs through the Wildblood badlands and keeps going.** The Wildlands
  aren't a separate project — they're the **near leg** of the Reach crossing. Finishing them *is*
  building the first half of the trail.
- Route: `Coldwater → South Gate (918_919) → the Thornwarren → [the void] → Buzzard Field's back door`.

Because The Reach is `flags.lawless`, dying in the void while wanted-elsewhere does not jail you
(consistent with the existing lawless-respawn gate) — you just clone-vat respawn.

**Then:** the Exodus road (path-mind renounce faction) as the second route, proving the generator
generalizes to a second region pair.

---

## Reuse ledger (what already exists)

| Need | Existing system |
|---|---|
| Thirst/hunger clock | [systems-survival.md](systems-survival.md) hunger/thirst |
| Radiation secondary pressure | survival radiation/mutations |
| Cold/heat exposure | [[project_body_temperature_system]] |
| Weather with no safe haven | [systems-weather-extreme.md](systems-weather-extreme.md) severity |
| Stamina / movement cost | [[project_run_mode_gps_walk]] run/walk + winded |
| Lethality tiers | `server/engine/danger.js` `zoneDanger` |
| Turret hazards (if used) | perimeter turret design in [[project_wildlands_curtain]] |
| Lawless respawn (no jail) | [[project_the_reach]] jail gate |
| Combat / flee / loot | existing combat + [[project_turnin_flee_creditchip_batch]] flee roll |
| Scavenging (skill + search UX + 2D8−2D8 check) | [systems-scavenging.md](systems-scavenging.md) [[project_fishing_system]]-adjacent |
| Renounce-faction NPCs | [[project_wildlands_curtain]] Wildblood roster |
| Party grouping | `follow` / `dragFollowers` in `server/engine/commands/movement.js` |
| Resource pooling in a party | existing `give` / `trade` ([[project_trade_window]]) |
| Party comms (signal-loss + radio) | [[project_tablet_chat_app]] chat app (goes NO SIGNAL) + a radio gear item |
| Region authoring surface | dev-panel **World Editor** ([[project_world_editor_districts]]) — add void-edge mode |
| Player map surface | [[project_tablet_map_app]] Tablet (new **Frontier** topology view) |

---

## Server / DB cost

The seed-based model was chosen precisely so the void is **near-zero DB**, and it scales linearly with
the number of routes. Against the [read/write tiers](architecture.md#read-tiers-where-data-lives-at-runtime):

| Event | Cost | Why |
|---|---|---|
| **Move through the void** (hot path) | **0 DB round trips** | Geometry is computed in memory; the live instance is `player._crossing` and the current room is flushed to the `crossing_room` flag only on `player.logout` (**not per step**); encounters roll from in-RAM tables. Nothing awaits a query per step. |
| **Depart** | ~1 write (deferrable) | Set the crossing `player_flags`; coalesces with the zone-move persistence already happening. |
| **Arrive** | ~1 write | Clear the flags — piggybacks the normal destination-zone move write. |
| **Death** | 1 insert (rare) | Write the ghost-trace. Death is not a hot path. |
| **Scavenge a room** | **0 DB round trips** | Table + tier are generator-derived in RAM; the 2D8−2D8 check + roll run in memory. Per-instance depletion held in the instance object. |
| **Extract a big-score unique** | 1 write (rare) | Increment the `(void_origin, window, prize)` claim ledger. Claim-state reads served from the same process cache as traces. |
| **Read ghost-traces** | **0 per move** | Loaded once per `(voidOrigin, window)` into a process-level cache; served from RAM, shared across all crossers that window. |
| **Window rotate / purge** | 1 scheduled delete / week / void | Idle-gated via `scheduler.js`, weekly. Trivial. |

Two consequences worth stating:

- **Void movement is cheaper than normal grid movement** — no destination-zone lookup at all, just a
  pure function. The instance is CPU, not I/O; and because the seed is shared per `(voidOrigin, window)`
  the geometry is memoized once per window, so even the CPU is amortized across everyone crossing.
- **Multi-region scaling is linear and cheap** — N voids = N independent small trace sets + N memoized
  geometries, none of it touching the DB on the hot path. Growing the adjacency graph adds authored
  config, not runtime load.

---

## The engine work, and what's left

The generator, adjacency graph + its two surfaces, fog state, traces table, and loot/claim-ledger are
covered in the sections above. Two engine-side contracts and the honest remainder:

**Transient-zone substrate (`server/engine/world.js`).** `registerTransientZone(zone)` /
`removeTransientZone(id)` / `isTransientZone(id)` — the engine-owned write API for the zone store. A
transient zone lives in `world.zones` like any zone (movement, `describeZone`, per-player minimap all
read it), is normalized to the full loaded-zone shape (occupant Sets + `exits`/`flags`/`description`
defaults), and is **never persisted**: nothing writes `world.zones`→DB, export queries the DB
directly, and `getAllZones()` (the bulk corps/gps/work scan) excludes it via the `world.transientZones`
marker Set. `removeTransientZone` refuses to evict a real DB zone. **Give a transient room a
non-`map_world` `map_id`** so flag/map-filtered iterators skip it.

**Minimap crossing mode.** `getMinimapData` flags void rooms (`void_crossing` / `void_detour`) on each
node; when the current node is `void_crossing` the client
([client/game/js/panels/minimap.js](../client/game/js/panels/minimap.js) `renderCrossing`) drops the
city grid for a stylized **ashen trail view** — the walked trail behind you (dim, following the
`north`/back exits room to room), a pulsing **◎ you** beacon, and the trail continuing into **fog**
(`⋯`) ahead or onto the **far gate** (`⌂`, when `south` leaves the void map onto a region). Fork/detour
options off your *current* room show as branch ticks (**⋔** divert / **?** gamble). It charts only what
you'd honestly know — the layout **ahead stays fogged**; no per-room "seen" state is needed since
`north` is always "back". All three minimaps (sidebar/HUD/mobile) share the render.

**Not built:** the flight off-world read (a crosser should be invisible from the air, or a deliberate
"specks in the waste"); the party-coordination extras (leader "hold" at forks, per-follower water toll
on drag — `dragFollowers` still passes `bypassEncumbrance` — and the radio gear item for a split-party
channel); environmental "the void itself" hazards; the retreat-re-rolls-hot rule; loot depth-scaling.

---

## Open questions (not yet decided)

- **Water math** — exact drain rate vs. carry capacity vs. crossing length. The core tuning lever;
  needs a pass once the generator exists.
- **Crossing length** — **BUILT (distance-relative):** the room count is derived from the grid distance
  between the entry tile and the destination — one room per ~`TILES_PER_ROOM` (90) tiles, clamped to
  `[MIN_ROOMS 5, MAX_ROOMS 15]`, deterministic so a relog regenerates the same length. Far regions are
  longer, thirstier crossings; near ones a quick dash; new routes auto-scale with no hand-tuning. A
  route's explicit `length` overrides it. (Coldwater→Reach ≈ 1040 tiles → ~12 rooms.) `TILES_PER_ROOM`
  is the one knob. Remaining open: whether to weight by danger/terrain rather than pure Euclidean.
- **Rest-site frequency** and how much they heal vs. cost.
- **Loot-detour value curve** — how good does the salvage need to be to pull pilots off their aircraft?
- **Trace purge / griefing** — can a corpse-pack be camped? Does looting a ghost cost anything?
- **Cross-region generality** — does the same generator serve Exodus, future routes, and eventually
  procedural sewers/dungeons (the instancing seam's stretch payoff)?
