# unrest

**Purpose** — the conflict between the orders, made observable. Architect has five
orders with a full ideology substrate and, before this, nothing that made the tension
between them visible: the ten authored `org_relations` hostile edges were read by
exactly one thing, the CODEX tablet reader, and no NPC behaviour reacted to any of it.

Design: [docs/proposals/unrest.md](../../docs/proposals/unrest.md). As built:
[docs/systems-unrest.md](../../docs/systems-unrest.md).

## Status

**Phases 1, 2 and 3 are built.** 1a the ledger, 1b perceivability, 1c incidents, 1d
danger; phase 2's favour seam (the `unrest_incident` condition shape — the favour
QUESTS themselves are content and nobody has written one yet); and phase 3, the Null's
`vendetta` and the Wildblood's `incursion`.

Phase 3 adds no scalar, no table and no verb. It makes ELIGIBILITY a registry, because
phase 1 had one rule and that rule is correct for exactly the two orders that fight over
ground. The Null do not want the block, they want what is bolted to it; the Wildblood do
not read the block at all. See `roles.js`.

## The files

| File | What it is |
|---|---|
| `blocks.js` | the cell — a derived 12×12 block of grid coordinates, built once at boot |
| `ledger.js` | the three scalars, decayed on read, and the only writer of the `unrest_ledger` world flag |
| `signals.js` | what a player can perceive, and the record rule 1 reads |
| `voice.js` | the two voices, and the one rule about place |
| `incidents.js` | the selector, the staging, the teardown, and the safe stage steps |
| `stage.js` | the dangerous stage steps: hostiles, checkpoints, the lockdown |
| `favours.js` | the `unrest_incident` condition shape, so a quest can gate on live trouble |
| `roles.js` | who is playing, and what their authored role lets them stage |

## The rules worth knowing before you touch it

**No player-facing readout, ever.** No verb, no tablet gauge, no number. The moment
there is a readout the sim becomes a dashboard to optimise and the flavour dies. The
dev panel is the exact opposite and gets the complete numeric picture, because an
operator who cannot see the ledger cannot tune it. The line is the client boundary,
not the data: every scalar is visible at `/dev` and none of it crosses into
`client/game/`.

**Signal before effect.** An incident may not stage in a cell unless that cell carried
a perceivable, attributable signal *from the same order* inside the preceding six
hours. Heat rises, the walls and the gossip and the wire say so, and only then does
the grip response fire — so the player who walked past the tag yesterday reads today's
checkpoint as consequence rather than as spawn noise. Enforced in `eligible()`.

**The cell is derived, never authored.** A 12×12 block of grid coordinates
(`blocks.js`), about ten of them over the built city. The first draft used
`flags.district` and that made the whole system wait on content that does not exist —
twelve of the twenty authored districts hold zero tiles. Nothing downstream knows what
a cell *is*, so if [district-repair](../../docs/proposals/district-repair.md) ever
ships, this file swaps its key function for `districtFor` and no scalar, incident or
regress case changes.

**Three scalars, not two.** `grip` (hours), `heat` (tens of minutes), and `pressure`,
a slow integrator of grip over days that raises heat's *baseline* rather than heat.
⚠ Pressure is not optional: without it the fast pair converges, because decay pulls
both toward baseline and incidents gate on high heat — so a quiet cell could never
generate what would make it loud, and dead cells would stay dead for ever.

**Persist the ledger, never the incidents.** A live staging holds instance ids that do
not survive a restart, and a persisted "checkpoint here" that outlives its teardown is
a permanent checkpoint nobody authored. Correct post-restart state is: cell still hot,
checkpoint gone, next tick re-stages it if it is still warranted. This is why the
checkpoint step writes `zone.flags.checkpoint_cfg` on the live RAM zone object and
nowhere else — `world.zones` is never written back, so it is restart-safe by
construction rather than by anybody remembering.

**The two voices disagree, and nothing reconciles them.** The wire carries the
Ascendant version, the street carries the street version, and they contradict each
other. Per house style the em dash is the Ascendant voice tell, so it belongs to
exactly one of the two — the faction split is readable in the punctuation before a
word of it is. Regress asserts both halves.

## Traps

- ⚠ **grid 0,0 is an unset column, never a tile.** Interiors carry it, so they resolve
  their cell by following `world_exit_zone` out to their facade. A coordinate read that
  trusts 0,0 puts every interior in the game into one corner of the map.
- ⚠ **`fireHook` keeps the LAST non-undefined result**, and load order is
  filesystem-alphabetical, so `unrest` sorts after `district-ambience` and wins any
  ambient beat it answers. `describeAmbient` therefore abstains hard at baseline and
  abstains on most ticks above it, and the manifest declares
  `"after": ["district-ambience"]` so the ordering is a decision rather than an
  accident of the alphabet.
- ⚠ **`script-triggers` normalises the zone as `payload.zone ?? payload.zoneId`.** Every
  event this plugin emits names the field `zone`, or an authored trigger row's `zone_id`
  filter silently never matches.
- ⚠ **The ESP is a singleton.** `plugins/emergency` keeps one module-level `espActive`
  beside one `espZones` set, so two incidents cannot each own a lockdown: the second
  `activate()` silently joins the first and the first `deactivate()` ends both. Exactly
  one incident may hold it (`espHeldBy()` in `stage.js`), and the second declines rather
  than joining. Regress asserts the cap.
- ⚠ **Insurgency is "writes heat AND reads grip"**, not merely "writes heat". The
  Wildblood also write heat and are deliberately outside the cycle — they fire off an
  external clock in a burst and leave no baseline behind, which is a driver *into* the
  ledger rather than a participant in it.
- ⚠ **The region is not the city.** `region_coldwater` is 4,838 tiles of which 2,865
  are redrock waste. The index gates on the urban filter, not on `region_id`, or the
  sim spends its heat on empty ground.
- ⚠ **An authored `do` that nothing has registered is a build failure.** Regress sweeps
  every step in every `content/incidents/*.json` against the live registry, because an
  authored key nothing reads is prose pretending to be behaviour.
- **Decay is monotone toward baseline and never crosses it.** An exponential approach
  can only close the gap. An overshoot would read as the sim spontaneously producing
  tension in a quiet city, so regress asserts it.

## The stage vocabulary

Safe (1c, `incidents.js`): `gossip`, `news`, `graffiti`, `ambient`, `sound`.
Dangerous (1d, `stage.js`): `hostile`, `checkpoint`, `esp`.

`{place}` is the only token in an authored line, and it resolves to a part of town
given by orientation — "the north end", "the west side". ⚠ Never write a district or a
building into an incident line: a named place invites a mental map with a status per
name, which is one step from the readout rule 2 bans.

The proposal's fifth safe step was "NPC mood". There is no seam in this codebase that
reads a mood field off an NPC, and inventing one would be an authored key nothing
consumes. `sound` is the same beat through `propagateSound`, which already exists —
and it is the identical call 1d's hostile warning makes.

## What the sim does to a player

Nothing, at `quiet`. Above it, in order of how much it costs them: a line in the room
they walked into, a wall somebody has been at, an NPC telling them where not to go, a
bulletin contradicting that NPC, a street with a checkpoint on it, three people
fighting in it, and — rarely — the whole Basin under emergency protocol.

⚠ Rule 5: **danger is audible from the tile you are standing on.** The warning fires
from inside the hostile and checkpoint steps, before anything lands, and again from
each neighbouring cell's anchor. It is not an authored line, because an author can
forget one.

## REST

- `/unrest/state` (GET) — cells, bands, the role roster, per-order signal timestamps.
- `/unrest/force` (POST) — set a cell's scalars for testing.
- `/unrest/step` (POST) — run one forcing tick and sweep now.
- `/unrest/speak` (POST) — say a cell's two voices without waiting for a band crossing.
- `/unrest/incidents` (GET) — live stagings, the catalogue, and **why each definition is
  refused in each cell**. An operator who cannot see the refusal reason concludes the
  sim is broken.
- `/unrest/incidents/stage` (POST) — stage one now (`force: true` overrules rule 1, and
  says so in the response).
- `/unrest/incidents/teardown` (POST) — take one down.
- `/unrest/reload` (POST) — re-read the incident catalogue after a content import.
- `/unrest/reindex` (POST) — drop the memoised block index after a world reload.

All dev-gated, all `directAPI` (live world, never staged). The incident **definitions**
are authored content and go through the ordinary staged content API instead.

## Commands

None, and there never will be. That is rule 2.

## Hooks

`zone.describeAmbient` — abstains at baseline, and on most ticks above it.

## Events

Emits `unrest.band.changed`, `unrest.incident.staged`, `unrest.incident.ended`.
Consumes `zone.entered`.

## Tick usage

`30m` — force the ledger, sweep for band crossings, then run one selection pass.
Idle-gated by the scheduler's default.
`5m` — tear down anything whose time is up, and flush the ledger write-behind.

## Data schema

`incidents` — the authored catalogue, `readTier: boot`.

The **ledger** has no table. It is one versioned `world_flags` blob, `unrest_ledger`,
and this plugin is its only writer. ~10 cells × 4 numbers does not justify a schema
change, a registry entry, a boot load and a read-tier decision. Band memory, the signal
record and every live staging are RAM only, deliberately.

`world_events` takes exactly one `unrest.incident` row per staging. It is the audit
log, never the ledger.

## Favours (phase 2, the seam)

Ideology rep decays on a 30-day half-life and, until this, **nothing repeatable paid it** —
so an order could be climbed once through the forty-slot arc and then only watched drain.
`docs/systems-faction-arcs.md` carves favours out as the parallel track: a job you can do
again for standing, never a rung. Incident response is that missing work.

What ships is the **seam**, not the jobs. `favours.js` registers one condition shape:

```
{ unrest_incident: 'here' | 'nearby' | 'anywhere', writes?: <orgId>, incident?: <defId> }
```

Author it on **both** the offer node and the turn-in node of a repeatable quest. On the
offer so the job only exists while there is a job; on the turn-in because a favour that can
be handed in after the incident is over is a farm, not a response.

Three rules, and two of them are about what this must not do:

⚠ **The plugin never moves reputation.** There is no `adjustReputation` call in it, and
regress asserts there never is one. Rep moves only through the quest's own authored
`ADJUST_REPUTATION` reward — the moment the sim pays standing by itself it becomes the
invisible alignment ledger `plugins/drugwar` records being removed once already.

⚠ **A favour is never a slot.** The forty arc slots are non-repeatable, always: turn one in
twice and it writes an older arc number over a newer one, walking the player backwards. So
no favour may write an `<order>_arc` flag, and regress sweeps `content/quests/` to prove
no repeatable quest does.

⚠ **The gate is a live lookup, never a flag set at staging time.** An incident's
`instanceId` does not survive a restart — rule 6 persists the ledger and never the
incidents — so anything remembered about a specific staging is a thing that can outlive it.
Asking "is one live here, now" cannot. That is also why favours add no state of their own.

Sync and query-free: `liveIncidents()` is a RAM Map and `blockOf` is an index lookup, so
the shape is safe on the dialogue path, which gates every option of every node an NPC
renders. An unknown scope fails **closed**, the same direction every other shape fails.
