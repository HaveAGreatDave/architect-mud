# Unrest — dynamic faction conflict (as built)

**Status: Phases 1, 2 and 3 BUILT.** Phase 1's four steps (1a the ledger, 1b
perceivability, 1c incidents, 1d danger); **phase 2's SEAM** — `plugins/unrest/favours.js`
registers the `unrest_incident` condition shape, so an authored repeatable quest can be
offered and turned in only while there is something live to respond to, though the favour
QUESTS themselves are content and nobody has written one yet; and **phase 3**, the Null's
`vendetta` and the Wildblood's `incursion`, which add no scalar, no table and no verb.
The design record, including what is still outstanding, is
[proposals/unrest.md](proposals/unrest.md).

Implementation: [plugins/unrest/](../plugins/unrest/README.md). The design record,
including everything not yet built, is [proposals/unrest.md](proposals/unrest.md).

⚠ **It is called Unrest.** Grepping for "dynamic events", "world events" or "faction
events" finds nothing. `world_events` is an unrelated table this system uses only as
an audit log.

---

## What a player experiences

Nothing, most of the time, in most of the city. That is the design working.

When a block goes bad, the player finds out the way anybody in that city would. A line
in the room they walked into. A wall somebody has been at, with the paint still tacky.
An NPC saying *"don't go up the north end tonight."* A news bulletin, an hour later,
explaining that reports of disorder in the north end are unverified. Then a street with
marshals across both ends of it, and a scanner that wants to know who they are.

**There is no number anywhere.** No verb, no gauge, no tablet page, no colour on the
minimap. The ship test is: *can a player who has never opened a wiki tell you which
part of town is tense and who is doing it?* If answering that needs a number, the
feature is wrong.

The **dev panel is the exact opposite** and gets the complete numeric picture, because
an operator who cannot see the ledger cannot tune it. The line is the client boundary,
not the data: every scalar is at `/dev` → **Unrest**, and none of it crosses into
`client/game/`.

---

## The model

### Role decides which scalar an order writes

A symmetric tug-of-war is the wrong shape — *"the Long Watch controls 60% of the
Ashway"* is nonsense for a resistance. Role is **authored data** on `orgs.flags.role`
(JSONB, no schema change), never a switch statement in code.

| Order | Role | Writes | Driven by | Built? |
|---|---|---|---|---|
| Ascendants | `authority` | **grip ↑** | heat in its theatre. The only order that raises grip | ✅ |
| Long Watch | `insurgency` | **heat ↑** | grip + pressure. Resident, persistent, local | ✅ |
| Exodus | `withdrawn` | nothing | never. Encodes "not in this fight" as data | ✅ |
| Null | `vendetta` | Ascendant *assets*, not ground | grip anywhere | ✅ |
| Wildblood | `incursion` | heat ↑ in a burst, then nothing | an external clock | ✅ |

⚠ **Insurgency is "writes heat AND reads grip"**, not merely "writes heat". The
Wildblood also write heat and must stay outside the cycle: they are a driver *into* the
ledger, not a participant in it. Regress asserts a clock-driven order moves nothing.

The four expansion orders (Prometheans, Synthesis, Pioneers, Lucid) carry
`flags.expansion` and take no role at all.

### The cell is a derived block

A tile is too fine (a player crosses about twenty in a session, so per-tile heat is
noise). A region is too coarse (Coldwater is one region, so a region ledger is one
global number, which is weather). The cell is a **12×12 block of grid coordinates**,
derived at boot from the ~273 urban tiles of the built city — about ten of them.

⚠ **Nothing downstream knows what a cell is.** It is a key from one function and a
label from another. If [district-repair](proposals/district-repair.md) ever ships,
`blocks.js` swaps its key function for `districtFor` and no scalar, incident or regress
case changes. That is the reason to build on blocks now rather than wait: the district
painting is worth doing on its own merits and this system does not have to pay for it.

⚠ **grid 0,0 is an unset column, never a tile.** Interiors carry it, so an interior
resolves its cell by following `world_exit_zone` out to its facade. A coordinate read
that trusts 0,0 puts every interior in the game into one corner of the map.

### Three scalars

| Scalar | Half-life | What it is |
|---|---|---|
| `grip` | 3 h | how hard the authority is squeezing |
| `heat` | 20 min | dissident activity |
| `pressure` | 3 days | a slow integrator of *grip over time*, which raises heat's **baseline** |

Decay is **lazy, on read** — the `decayRep` pattern. An idle-gated decay tick means you
log in to exactly the state you left; `runWhenEmpty` pins Neon compute awake billing for
nobody. Only the *forcing* tick is scheduled, and it is idle-gated.

⚠ **Pressure is not optional.** Without it the fast pair converges: decay pulls both
toward baseline and incidents gate on high heat, so a quiet cell could never generate
what would make it loud, and **dead cells would stay dead for ever**. Fast pair + slow
integrator is the minimal system that limit-cycles with no driver.

Everything downstream keys on the **band** — quiet / watchful / tense / flashpoint —
and never on the raw numbers. That is rule 2 holding inside the code as well as at the
client boundary.

---

## Perceivability (1b)

Three surfaces, all of them sentences.

**The room.** `zone.describeAmbient`, ⚠ with **hard abstention at baseline**. `fireHook`
keeps the LAST non-undefined result and load order is filesystem-alphabetical, so
`unrest` sorts after `district-ambience` and wins any beat it answers — so it returns
`undefined` on every quiet cell and on most ticks above one, and the manifest declares
`"after": ["district-ambience"]` to make the ordering a decision rather than an accident
of the alphabet.

**The crossing beat.** A line when a player walks into a block that is not quiet. ⚠ Hot
path: `zone.entered` fires on every move, so the handler is synchronous and does two Map
lookups. It fires on a real **block** change, never on a move — including every step
through a shop door, since an interior inherits its facade's cell — and holds a four
minute cooldown so pacing a boundary is not a beat.

**The two voices.** A band crossing plants one street rumour (`plugins/gossip`,
`capGroup: 'unrest'`, capped at three live citywide) and one news bulletin (dispatched
as `broadcast.newsWire`, an Action registered inside `plugins/broadcast` so nothing
imports across the boundary).

⚠ **They contradict each other and nothing ever reconciles them.** That single fact
communicates "an authority and a resistance" better than any scalar could. Per house
style the **em dash is the Ascendant voice tell**, so the wire takes them and the street
never does — the faction split is readable in the punctuation before a word of it is.
Regress asserts both halves.

⚠ **Place is spoken as a bearing, never as a name.** A cell has no name, so a part of
town is given by orientation from the centre of the built city — "the north end", "the
west side" — through the engine's own `bearing()` (`map-text.js`), which drops the minor
axis and already knows `grid_y` runs **southward**. This is not a consolation for
lacking districts: a named district invites a mental map with a status per name, which
is one step from the readout rule 2 bans. Regress sweeps every generated line against
every building and district name in the world.

---

## Incidents (1c)

An `incidents` row is a **thing that can happen** in a block, never a thing that is
happening.

⚠ **Rule 1 — signal before effect.** An incident may not stage in a cell unless that
cell carried a perceivable, attributable signal **from the same order** inside the
preceding six hours. Heat rises → the walls and the gossip and the wire say so → only
then does the grip response fire. The player who walked past the tag yesterday reads
today's checkpoint as consequence rather than as spawn noise. It also means a cell whose
mood belongs to the authority cannot host an insurgency incident until heat has actually
said something there, which is what makes every staging attributable to *somebody*.

⚠ **Rule 6 — persist the ledger, never the incidents.** A live staging holds instance
ids that do not survive a restart, and a persisted "checkpoint here" that outlives its
teardown is a permanent checkpoint nobody authored. Correct post-restart state: cell
still hot, checkpoint gone, next tick re-stages if still warranted.

One selection pass per 30-minute tick stages **at most one** incident; teardown runs on
the 5-minute cadence so an authored duration is not rounded up to the next half hour.
The cap is **three citywide, not per cell** — ten simultaneous incidents over ten blocks
is a city where the sim is the only thing happening.

`world_events` takes **exactly one** `unrest.incident` row per staging. It is the audit
log, not the ledger. (The table has existed since the beginning with zero writers; this
is its first.)

### The stage vocabulary is a registry

| Step | Phase | What it does | Torn down? |
|---|---|---|---|
| `gossip` | 1c | a street rumour in the cell | the item is removed |
| `news` | 1c | one bulletin on the wire | no — it aired |
| `graffiti` | 1c | a tag on a wall, by nobody | scrubbed |
| `ambient` | 1c | overrides the room lines while it stands | cleared |
| `sound` | 1c | a noise that carries off the block | no — it was heard |
| `hostile` | 1d | real enemies on the cell's streets | every instance removed |
| `checkpoint` | 1d | a real gate the checkpoint plugin reads | removed |
| `esp` | 1d | the citywide emergency protocol | deactivated |

⚠ **An authored `do` that nothing has registered is a build failure.** Regress sweeps
every step in every `content/incidents/*.json` against the live registry, because an
authored key nothing reads is prose pretending to be behaviour — the failure that hid
inside `mutations.effects` for months.

The proposal's fifth safe step was "NPC mood". There is no seam in this codebase that
reads a mood field off an NPC, and inventing one would be exactly that authored-key
failure. `sound` is the same beat through `propagateSound`, which already existed.

`{place}` is the only token in an authored line. ⚠ Never write a district or a building
name into an incident.

---

## Danger (1d)

⚠ **Rule 5 — danger must be audible from the tile you are standing on.**
`propagateSound` already reaches neighbours, which turns "ambushed by a sim I cannot
see" into "I heard that and walked in anyway" for about four lines of code. The warning
fires from **inside** the `hostile` and `checkpoint` steps, before anything lands, and
again from each neighbouring cell's anchor — deliberately not an authored line, because
an author can forget one.

**Hostiles** are `spawnEnemySync` with tracked instance ids, spread over the cell's own
streets rather than stacked on one tile. ⚠ Every instance comes back down on teardown; a
leaked mob is a permanent hostile nobody authored, standing on a street that has been
quiet for a week.

**Checkpoints** write `zone.flags.checkpoint_cfg` on the **live RAM zone object** and
nowhere else. `world.zones` is never written back, so this is restart-safe by
construction — rule 6 holding without anybody having to remember it. The existing
`plugins/checkpoint` move gate reads it with no changes. ⚠ Never placed over an authored
gate: the South Gate's config is content and a ninety-minute incident must not be what
decides its behaviour, even with a restore afterwards.

**The lockdown** dispatches `ESP_ACTIVATE` / `ESP_DEACTIVATE`, registered as Actions
**inside `plugins/emergency`** so neither plugin imports the other.

⚠ **The ESP is a singleton.** `plugins/emergency` keeps one module-level `espActive`
beside one `espZones` set, so two concurrent incidents cannot each own a lockdown: the
second `activate()` silently joins the first and the first `deactivate()` ends both.
Exactly one incident may hold it and the second **declines rather than joining**.
Regress asserts the cap and asserts both Actions are idempotent under double dispatch.

---

## Where the state lives

| State | Where | Why |
|---|---|---|
| the ledger | one versioned `world_flags` blob, `unrest_ledger` | ~10 cells × 4 numbers does not justify a table, a registry entry, a boot load and a read-tier decision. Not pure RAM either: this repo deploys on every push, and a ledger that resets every deploy **is** a stateless roll with extra steps |
| incident definitions | `incidents` table, `readTier: boot` | authored content, one file per row under `content/incidents/` |
| band memory | RAM | ⚠ the first sweep after a restart **primes and fires nothing**, or a deploy announces the whole city at once |
| the signal record | RAM | rule 1's window is six hours; a restart correctly forgets |
| live stagings | RAM | rule 6 |
| the audit trail | `world_events` | one row per staging |

---

## Reuse — nothing here was rebuilt

| Need | Seam |
|---|---|
| clock | `schedule()` — idle-gated, phase-spread, boot-jittered |
| bearings | `bearing()` in `map-text.js` — knows `grid_y` runs southward |
| rumours | `plugins/gossip` `pool.addItem({capGroup, coalesceKey, reach})` |
| news | `broadcast.newsWire`, dispatched by name |
| wall tags | `plugins/graffiti` `tagFromWorld()` — ⚠ deliberately **not** a route into `applyTag`: there is no player, so no can to spend, no crime to charge, and `graffiti.tagged` must not fire (surveillance reads it as "a person did this", and a witnessed crime with no suspect is a wanted star nobody can be given) |
| warning sound | `propagateSound()` |
| temporary hostiles | `spawnEnemySync()` / `removeEnemyInstance()` |
| checkpoints | `plugins/checkpoint`'s move gate, reading `flags.checkpoint_cfg` off the live zone |
| lockdown | `plugins/emergency`'s complete ESP |
| authored fan-out | `script_triggers` binds any bus event to a VINE graph. ⚠ It normalises the zone as `payload.zone ?? payload.zoneId`, so every event here names the field `zone` |

---

## The two drivers (phase 3)

Phases 1 and 2 had **one** eligibility rule, in `eligible()`: a band high enough, plus a
perceivable signal from the same order inside the window. That rule is correct for exactly
the two orders that fight over ground, and wrong for both orders that do not.

So the gate is now a **registry** keyed on an authored `flags.driver`, the same shape the
stage vocabulary already used for `do`. Phase 1's version is the `ground` driver and is
still the default, so every incident that already shipped is unchanged and un-reauthored.
The drivers live in [`plugins/unrest/roles.js`](../plugins/unrest/roles.js), which also
took over the role roster from `index.js`.

| Driver | Order | What makes a cell eligible | What it puts in the ledger |
|---|---|---|---|
| `ground` | Ascendants, Long Watch | band ≥ `min_band`, and a signal from the same order | nothing (the tick moves the scalars) |
| `vendetta` | Null | **grip ≥ 25**, and a signal from the **authority** | nothing at all |
| `incursion` | Wildblood | **the clock**, and nothing else | a heat burst, never pressure |

Each driver declares the authored role that backs it. Remove the Null from
`content/orgs/` and vendetta incidents stop staging rather than staging anonymously,
which is what keeps *roles are data, never a switch statement* true of the gate as well
as of the tick.

### The Null read grip, never the band

The band is `heat + grip/2`, so a block the authority has finished pacifying reads quiet
however heavy the hand still on it. That is precisely the block with the most licensed
machinery bolted to it and the fewest people left outside to notice it stop working, and
phase 1's gate would refuse it **for being quiet**. A vendetta is the reply to the
squeeze, arriving after the squeeze has worked.

⚠ **Rule 1 still holds, pointed at somebody else.** The signal a vendetta answers is the
authority's, not its own: the Null have no street voice and want none, so requiring a
signal from `assets` would make them announce themselves first. What must have happened
in that cell is that a player could *see* the grip they are being made to pay for.

⚠ **A vendetta puts nothing in the ledger.** Every other incident's order is fighting
over the ground the ledger measures. The Null are not. A sim that scored one would be
counting the wrong thing.

### The Wildblood read the clock, and nothing else

No band, no signal, no grip, no heat. The only question is what time it is, because the
one thing an incursion must never be is a consequence of what the city has been doing —
that is the whole difference between a fifth participant and something happening *to* the
participants. Their authored role is `{ writes: 'heat', reads: 'clock' }`, and
`reads: 'clock'` is exactly why `ledger.step()` already excluded them from the insurgency
loop: they push the same scalar the Long Watch do and are not doing the same thing with
it. The Long Watch live here and grind. The Wildblood arrive.

⚠ **One way in per night, DERIVED rather than rolled.** A stored roll would be RAM state
that does not survive a restart (rule 6), and a fresh roll per selection pass would let
them arrive in four parts of town in one night. The target cell is a function of the
night, so two players agree on where they came in and a restart cannot contradict it.

⚠ **A night spans midnight, and the small hours belong to the night before.** Key the
target on the calendar date and it moves at 00:00 — half a raid up the north end and half
down the south, on the one system whose entire promise is that it came from somewhere.
Regress pins this directly.

⚠ **The burst is heat and never pressure.** Pressure is the scalar that raises heat's own
baseline over days. Heat's half-life is twenty minutes, so the block is loud by morning
and back to exactly what it was by lunchtime, with nothing in the ledger to say they were
ever there. An incursion that moved pressure would make the Wildblood a permanent tenant
of a city they have no interest in holding.

The street gets the direction right and the wire gets it wrong. They come **up**, out of
the Under, which was theirs before the Basin was poured over it — so the wire's line that
the perimeter was not breached is true, and misses the point entirely. See
[lore-wildblood.md](lore-wildblood.md); nothing in the game ever settles it.

### The Exodus stage nothing, and that is data too

⚠ `writes: 'none'` is a **truthy string**, so an order that opted out of the fight sails
through every filter that merely tests for a role at all. `guard()` refuses it by name.

---

## Not built

- **Favour quests.** Phase 2 shipped the seam, not the content: no repeatable
  incident-response quest has been authored yet, so nothing currently pays ideology rep
  for turning up. ⚠ Rule 4 holds before and after: **the sim never moves ideology
  standing implicitly.** `plugins/drugwar` records this decision being made once already,
  when its invisible alignment ledger was removed.
- **A grip hostile.** The authority's danger is the checkpoint and the lockdown, not a
  mob. The only Ascendant enforcement enemy in the world is the Arbiter at 100 HP and
  10 hit, which on an ordinary street is an execution rather than an incident.
