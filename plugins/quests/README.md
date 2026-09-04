# quests

**Purpose** — owns the Quest domain: goals with objectives that players accept, progress, and turn
in. Quests are authored as data (`quests` table) and started/turned-in through Actions, so an NPC
dialogue node or a script drives the same lifecycle a future command would. Objective progress is
never written by the kill/give/move code — this plugin subscribes to the Events those Actions emit
and advances objectives itself (ADR-0002).

## Registered actions

- `START_QUEST {quest_id}` — adds the quest to the player (or restarts a `repeatable` one); emits `quest.started`.
- `ADVANCE {quest_id, index?, amount?}` — manual objective bump (dialogue/script); emits `quest.advanced`.
- `COMPLETE {quest_id}` — flips a met quest to `completed` (tracking usually does this automatically); emits `quest.completed`.
- `TURN_IN {quest_id}` — pays out `rewards` (credits/items/flags) and marks `turned_in`; emits `quest.turned_in`.

All four are generic Actions (no required Tag), dispatchable from any Source. Registering them is what
un-stubs quest dialogue-actions — the dialogue handler already dispatches whatever Action a node names.

Each transition also mirrors the quest's status into a player Flag named after the quest id
(`<quest_id>` = `active` | `completed` | `turned_in`). Dialogue/Script Conditions gate options on it
through the normal Flag mechanism — e.g. show "Accept" only when the flag is `unset`, and "Turn in"
only when it equals `completed`:

```jsonc
{ "next": "accept", "label": "Accept",  "conditions": { "flag": "quest_pest_control", "op": "unset" } }
{ "next": "turnin", "label": "Turn in", "conditions": { "flag": "quest_pest_control", "op": "eq", "value": "completed" } }
```

## Events emitted

- `quest.started`   — `{actor, quest_id}` when a quest is accepted.
- `quest.advanced`  — `{actor, quest_id, progress}` when any objective counter changes.
- `quest.completed` — `{actor, quest_id}` when all objectives are met.
- `quest.turned_in` — `{actor, quest_id}` after rewards are paid.

## Events consumed

- `enemy.killed`  → advances `kill` objectives whose `target` substring-matches the enemy name.
- `item.given`    → advances `give` objectives on the **recipient** whose `item_id` matches.
- `zone.entered`  → advances `visit` objectives whose `zone` matches.

…and the rest of the table below. `augment.installed` is the only one of them this plugin caused to
exist; every other Event was already on the bus when its objective type was written.

## Tick usage

None.

## Dependencies

`economy` (`adjustCredits` for credit rewards); `server/engine/ideologies.js` (`adjustReputation`, for
both `rewards.rep` and `penalties.rep`) — the engine service, deliberately not a dispatched
`ADJUST_REPUTATION`, so standing is still paid when the ideologies plugin is absent; the core
graph-engine Actions `GRANT_ITEM` / `SET_FLAG` for item and flag rewards.

### `rewards.rep` — how faction work pays

The mirror of `penalties.rep`, and the newer half by a long way. Until it existed, failing a quest
could cost you standing and finishing one could not pay you any: `adjustReputation` had two callers
in the whole codebase, and one of them was a punishment. Nothing a player *did* moved an order's
opinion of them — standing was a conversation, authored on dialogue options.

That mattered because [standing is maintained, not banked](../../docs/systems-ideologies.md): it
decays toward a resting point on a 30-day half-life, by design, so that being Trusted is something
you keep being. An order you want players to stay inside therefore needs **repeatable** work that
pays `rep`; a one-off arc alone drifts back to nothing on its own.

The player is told only when a reward crosses them into a new **tier**. A move within one passes
without comment — raw standing is what `rep`/`ideologies` is for, and a repeatable that announced a
number every hand-in would be noise.

## Config

None.

## Data schema

- `quests` — `id, name, description, objectives JSONB, rewards JSONB, repeatable, updated_at`.
  - `objectives`: `[{ type, target?, item_id?, zone?, count?, desc, requires?[], emotes?[], taskSeconds?, optional?, rewards? }]`
  - `available`: when the quest is on offer — see [Offer windows](#offer-windows--available)
  - `blocks`: quest ids this one closes for good when taken — see [Exclusivity](#exclusivity--blocks)
  - `resolutions`: alternate endings — see [Branching resolutions](#branching-resolutions)
  - `on_fail` / `on_turn_in`: `{ start_quest }` or null — see [What happens next](#what-happens-next--on_fail--on_turn_in)
  - `fail_on`: the same shapes, but each blows the quest — see [Failure](#failure)
  - `penalties`: what failing costs — `{ credits?, rep?:[{ideology,delta}], flags?:[…] }`
- `player_quests` also carries `progress_keys` (the objective ids `progress` was built against, so a
  quest can be edited without corrupting live progress), `spawned` (row ids of auto-spawned
  `retrieve` items, so they can be taken back out of the world) and `targets`
  ([rolled targets](#rolled-targets), frozen at start).
  - `rewards`: `{ credits?, xp?, advance?, items?:[{item_id,quantity}], flags?:[{scope,flag,value}], rep?:[{ideology,delta}] }`
- `player_quests` — `player_id, quest_id, status ('active'|'completed'|'turned_in'|'abandoned'|'failed'), progress JSONB (index-aligned counters), started_at, updated_at`.

Dev CRUD lives under `/api/quests` (GET/POST, PUT/DELETE by id) for devpanel authoring.

## Objective types

Every type is the same shape: subscribe to an Event the world already emits, and bump any objective
whose predicate matches it. The systems that fire those events do not know quests exist (ADR-0002).

| type | event | target field | notes |
|---|---|---|---|
| `kill` | `enemy.killed` | `target` (enemy name substring) | names a **species** — any three rats will do |
| `assassinate` | `npc.killed` | `target` (npc id, or name substring) | names a **person**. Ignores NPC-on-NPC kills with no player behind them |
| `give` | `item.given` | `item_id` | counted on the recipient |
| `retrieve` | `item.taken` | `item_id` + `zone` | auto-spawns `count` copies at `zone` on quest start unless `spawn:false` |
| `visit` | `zone.entered` | `zone` | `taskSeconds` turns arrival into timed work on the tile |
| `escort` | `escort.arrived` | `target` (npc) + `zone` | met when that NPC arrives with the player. Mechanic lives in [plugins/escort](../escort/README.md) |
| `deliver` | — | `zone` | flight verifies its own landings (`plugins/flight/contracts.js`) |
| `talk` | `npc.talked` | `target` (npc) | one conversation = one tick (fires on the dialogue ROOT node only) |
| `buy` | `vendor.purchase` | `target` (item id, optional) | |
| `sell` | `vendor.sale` | `target` (item id, optional) | |
| `craft` | `item.crafted` | `target` (output item id, optional) | counts the **stack** — a critical craft yielding two satisfies "craft 2" |
| `equip` | `item.equipped` | `item_id` | |
| `hack` | `hack.success` | `zone` (optional) | any successful hack: till, surveillance node, vendor safe |
| `spend` | `credits.changed` | `target` (reason substring, optional) | **counted in credits, not purchases** — `count: 5000` means ₵5000. Bank transfers excluded |
| `survive` | `weather.event` | `target` (storm type, optional) + `zone` | outdoors from the storm's peak through to the all-clear |
| `install` | `augment.installed` | `target` (augment id, optional) | chrome fitted in a theatre. **The one Event this plugin caused to exist** |
| `mutate` | `mutation.gained` | `target` (mutation id, optional) | one Event covers every grant path — radiation, flask, authored `GRANT_MUTATION` |
| `subdue` | `knockout.landed` | `target` (npc id, or name substring) | names a **person**, like `assassinate`. ⚠ Credits the hand that swung, never the body on the floor |
| `state` | — (polled) | `when` (a condition) | met by the WORLD, not by you — see [World-state objectives](#world-state-objectives--state--avert) |
| `restore` | `player.death` (`claimed`) | — | a death somebody arranged for in advance: the only kind that skips augment corruption |

`buy`/`sell`/`craft`/`hack`/`spend`/`survive`/`install`/`mutate` treat a blank target as "anything
counts". `kill`/`talk`/`assassinate`/`escort`/`subdue` require one, because they name a thing.
`restore` takes none at all — it either happened to you or it did not.

Only four of those Events ever had to be **added**, because the act was never announced at all:
`item.crafted` (`server/engine/crafting.js`), `vendor.sale` (`server/engine/vendor.js`),
`npc.talked` (`server/engine/dialogue.js`) and `augment.installed`
(`plugins/augments/install.js` — the augments plugin emitted nothing whatsoever before it).
Everything else was already on the bus, which is the point: `mutate`, `subdue`, `restore` and all
four constraint conditions below cost a predicate each and no change to the system they watch.

### A predicate may return a number

`trackEvent`'s predicate normally answers yes/no and the counter ticks by one. It may instead return
a **number**, which is the amount to add. That is what makes an objective measured in credits
(`spend`) or in output quantity (`craft`) expressible at all, rather than only ones measured in
repetitions.

## Optional objectives

`optional: true` on an objective takes it out of the finish line. It is still tracked, still listed
(marked `(optional)`), still gateable with `requires` — but `isComplete` ignores it, so the quest can
be handed in without it. That is the whole difference between a quest being done and being done
well, which is most of what makes a repeatable worth doing properly the fifth time.

An optional objective may carry `rewards` of its own, in the quest's `rewards` shape. Each one that
was actually met is paid at turn-in, after the quest's own rewards and through the same
`grantRewards` path (ledger reason `quest:bonus`, so a bonus is distinguishable from the fee).

Mandatory work is offered before optional work in every "Next:" hint — a bonus suggested ahead of
the thing that finishes the quest reads as the game misdirecting you.

⚠ **An optional objective must never be named in a MANDATORY objective's `requires`.** The
completion check ignores optional objectives, `requires` does not, so the mandatory one stays locked
forever and the quest is unfinishable for anyone who skipped the bonus. `content:lint` refuses that
shape; without the lint it is a defect that reads as the quest system being broken rather than as a
content bug.

## Branching resolutions

`quests.resolutions` is a list of endings. `TURN_IN` pays the **first** whose `when` passes;
`quests.rewards` is the fallback when none matches or none is authored, so an ordinary quest is
unaffected.

```jsonc
resolutions: [
  { id: 'told',  when: { flag: 'told_maresh', op: 'eq', value: 'true' }, rewards: { … },
    on_turn_in: { start_quest: 'quest_the_spire_calls' } },
  { id: 'kept',  when: { relation: 'trusted', target: 'npc_vale' },      rewards: { … } },
  { id: 'plain', rewards: { … } },        // no `when` — an unconditional catch-all, last
]
```

`when` goes through `evalCondition` ([server/engine/flags.js](../../server/engine/flags.js)) — the
same evaluator dialogue options and quest gating use — so every condition shape in the game (flags,
relations, `ideology_rep`, `mastery`) works here on day one and new ones arrive for free. A
resolution may name its own `on_turn_in`, which is what makes two endings two stories rather than
two payouts.

Until this existed a quest could only end one way, so "you can finish this two ways" had to be built
as two quests joined by hand-written flags — the crossover at slot 7 of
[the faction arc ladder](../../docs/systems-faction-arcs.md) is exactly this shape.

⚠ **Which ending paid is RECORDED, not re-derived**: on `player_quests.resolution`, and mirrored to
the player flag `<quest_id>_resolution`. Later content gates on that flag through the ordinary Flag
mechanism, with no new condition shape. Re-evaluating the `when` afterwards answers a different
question — the flag it read may have changed since.

## Rolled targets

Any of an objective's three target fields — `target`, `item_id`, `zone` — may hold a **selector**
instead of a fixed id. It is resolved once, when the quest is taken, and the answer is frozen onto
`player_quests.targets` (index-aligned to the objectives, `[{}, {target:'…'}]`).

```jsonc
{ type: 'kill',     target: '@enemy_in:coldwater', count: 3 }
{ type: 'retrieve', item_id: '@any_of:[item_a,item_b]', zone: '@zone_with:flags.terrain=marsh' }
```

| selector | resolves to |
|---|---|
| `@any_of:[a,b,c]` | one of the listed ids |
| `@zone_with:<key>=<value>` | a zone id — `key` is a column (`map_id`, `marker`) or `flags.<x>`. Reads the live world Maps, so it costs nothing and cannot disagree with what the player walks into |
| `@enemy_in:<map_id>` | the NAME of a species that actually spawns somewhere on that map, which is what a `kill` objective matches on |

`registerQuestSelector(name, fn)` adds more; `fn` may be async and may query, because resolution
happens once per quest taken and never on an event path. A plugin that owns a domain can teach
quests to roll over it without this file importing that domain.

Everything downstream reads the frozen value through `applyRolled`, so predicates, GPS routing,
`retrieve` auto-spawning, the quest log and the tablet needed no change. A quest that rolls nothing
stores `[]` and `applyRolled` returns the authored array unchanged, which is why this is free on
every read path.

This is what [the job board](../jobboard/README.md) had been waiting for: it rolls *which* quest is
posted and has never rolled anything inside one, so the same gig was byte-identical every rotation.

⚠ **A selector that matches nothing REFUSES the quest**, at `START_QUEST`, before the row is
written. Starting it anyway gives the player an objective nothing can satisfy — which presents as a
content bug for weeks rather than as the missing spawn table it is. The refusal to the player is
vague on purpose; the reason (naming the selector) goes to the console, because the author is the
only one who can act on it.

⚠ **Retaking a quest re-rolls it.** A second attempt at a rolling gig is a new gig.

## World-state objectives — `state` / `avert`

Every other objective type is driven by something the **player** did. `state` is the one driven by
the world: met when a condition holds. Its `fail_on` mirror `avert` blows the quest when one becomes
true. That is what lets a quest be about the city — the power staying on, a storm passing — rather
than only about you.

```jsonc
objectives: [{ type: 'state', when: { scope: 'world', flag: 'grid_stable', op: 'eq', value: 'true' },
               desc: 'The grid comes back' }]
fail_on:    [{ type: 'avert', when: { scope: 'world', flag: 'block_burned' }, desc: 'The block burned.' }]
```

`when` is an ordinary condition object, so a **world flag** needs nothing built — world flags are
already a cached in-memory map, which is what makes polling them affordable. Any registered
condition shape works too.

⚠ **These are POLLED, never subscribed.** There is no event to hang them on, so they settle at the
three points a quest is already being looked at: an event that touched this player, opening the
quest log, and hand-in. Same argument as [the lazy clock](#the-clock-is-lazy-and-thats-the-safe-choice),
and the same guarantee — a condition can be *noticed* late, but `TURN_IN` polls **before** it decides
whether the quest is finished, so it can never be missed at the moment it matters. A quest carrying
neither kind returns on the first line of the poll without evaluating anything.

## Offer windows — `available`

`available: { when, hours }` decides whether a quest is on offer at all. `hours` is an in-world
window and **may wrap midnight** (`[22, 4]`), which is the case a naive `from <= h <= to` gets wrong;
`withinHours` is a pure function for exactly that reason. `START_QUEST` refuses a closed window in
the world's voice, and [the job board](../jobboard/README.md) filters at the **roll**, so a lapsed
quest never takes one of the board's few slots and sits there unclickable.

A per-posting expiry is deliberately **not** built here: the board already rotates its postings on a
clock, and a second expiry beside it would be two answers to when a job stops being offered.

## The advance — `rewards.advance`

Money that moves when the job is **taken** rather than when it is finished, and **kept when the
quest is failed**. Before it, taking a job cost nothing and failing one lost nothing you were
holding, which is why `penalties` had to invent a debt out of nothing; with it, failing a job you
took an advance on is theft and `penalties` has something real to charge for.

⚠ **A retake of a FAILED or ABANDONED attempt pays nothing.** Paying it again makes take-fail-repeat
a faucet. A repeatable quest taken again after being turned in *is* a new job and pays. The rule is
`advanceFor(quest, existingStatus)`, a pure function, so it can be tested without a bank account.

⚠ **The advance and the penalty are stated separately, never netted.** An advance of 200 and a fine
of 200 reported as one number reads to a player as nothing having happened.

## Exclusivity — `blocks`

`blocks: [quest_id…]` on a quest permanently closes the named quests for that player the moment this
one is **taken**: the Null contract shuts the Watch's. Applied as a player flag per blocked id
(`quest_blocked_<id>`), so dialogue can gate on it through the ordinary Flag mechanism and no new
`player_quests` status was needed. `START_QUEST` refuses a blocked quest before writing anything.

⚠ **A closed quest stays closed even if the quest that closed it is failed.** A door that reopens
when you fumble the thing that shut it is not a decision.

⚠ **Blocking is permanent by construction and must be authored deliberately** — the same argument
`meta.failPermanent` already makes. Default to blocking nothing.

## What happens next — `on_fail` / `on_turn_in`

Two nullable columns, both `{ start_quest: <quest_id> }`, dispatched through the ordinary
`START_QUEST` action once the ending's own event has fired. The interesting answer to a failure is
rarely a fine — it is the cleanup job, or the person who now wants a word — and stating that as a
field retires the hand-written flag chains that used to link a quest to its sequel.

⚠ **A follow-up already live on that player is refused**, as is a quest naming itself. Two quests
each naming the other on failure is an authoring mistake, and without the guard it costs a loop at
runtime rather than a red in review. A follow-up that is *failed* or *abandoned* does restart —
`START_QUEST`'s own retry rule, unchanged.

## Where these are used

The first quests authored against the fields above, as worked examples:

| | quest |
|---|---|
| `resolutions` | `quest_asc_cross` — the Ascendant crossover, where lapsing at the press is one ending and carrying the address back is the other |
| `blocks` | `quest_asc_rite` closes `quest_lw_rite`. Deliberately not the reverse: standing a vigil welds nothing shut, while the Rite is a fitting |
| `available.hours` | `quest_fs_wake` (4–8), `quest_fs_seatfill` (19–2, wrapping), `quest_fs_pigeon` (6–18) |
| `optional` + a rolled `zone` | `quest_fs_pigeon`'s fourth stop — a bonus street, somewhere different every time |
| `rewards.advance` | `quest_hal_escort` (Halcyon pays retainers), `quest_under_apex` and `quest_under_salvage` (money to go in fed, lit and armed) |

Three of eighteen board gigs carry an hour window on purpose. A board whose whole
list is conditional is a board nobody can plan around.

## Extension points

New objective types are added by subscribing to the relevant Event beside the others at the bottom
of `index.js` and calling `trackEvent(actor, predicate)`. Gating (`requires`), auto-GPS routing (any
objective carrying a `zone`), progress UI and completion all come free. Add the kind to `_Q_KINDS` in
`client/devpanel/js/vine/vine-schema-quest.js` so it is authorable in the quest editor.

## Failure

`quests.fail_on` is the **mirror of `objectives`**: a list of the same condition shapes, judged by
the same predicates against the same events — each one *blows* the quest instead of advancing it.

That symmetry is the whole design. As an objective, `{type:'assassinate', target:'npc_vale'}` means
kill him; as a fail condition it means he must not die. Which is why failure cost no new per-event
code — every objective type in the table above was usable as a failure trigger the moment it existed.

```js
fail_on: [
  { type: 'assassinate', target: 'npc_witness', desc: 'The witness died.' },
  { type: 'sell',        target: 'the_package', desc: 'You sold what you were carrying.' },
  { type: 'timeout',     count: 600 },
]
```

Six shapes are **failure-only**, having no advancing counterpart:

| | |
|---|---|
| `{ type:'timeout', count:<seconds> }` | measured from `player_quests.started_at` |
| `{ type:'escort_lost', target:<npc> }` | the escortee died or was separated with no way back |
| `{ type:'spotted' }` | **"and nobody sees you"** — `stealth.noticed`, which is per observer, so the first NPC to clock you blows it |
| `{ type:'witnessed', target:<crime key> }` | the act reached a camera or a cop. Blank target = any charge |
| `{ type:'broke' }` | a piece of gear was destroyed under you. Untargeted: `item.broken` carries an inventory row id, not an item id |
| `{ type:'died' }` | an **ordinary** death. A `claimed` one — the `restore` objective's case — deliberately does not trip it |

The four new ones are what let a quest state a **constraint** rather than a task, which is the half
of an infiltration job that makes it one: the objective says get the thing, the condition says and
nobody sees you. ⚠ `restore` and `died` read the same Event with opposite predicates and share **one
subscription**, so the two can never drift on what `claimed` means — getting that pair backwards
would fail an Ascendant policy quest at the exact moment it was meant to succeed.

Authored in the VINE quest editor as a **Fails if** node. Fail nodes take no edges — a fail condition
is live for as long as the quest is, so there's nothing for a wire to say.

`FAIL_QUEST` (action) is the imperative route for a failure no event can express — "you told them,
didn't you" on a dialogue node.

### A failed quest is retryable by default

`START_QUEST` re-activates it, counters and clock reset. A permanent dead end in a living world should
be something an author **asks for**, not something they get by accident — `meta.failPermanent: true`
opts into the lock.

### The clock is lazy, and that's the safe choice

A timeout is never a stored timer. Timers die with the process, so a restart would quietly hand every
timed quest an extension; deriving the deadline from `started_at` survives anything.

Lazy isn't merely good enough here, it's airtight — **every path that could advance or hand in a
quest checks the clock first** (`trackEvent`, `finishObjectiveTick`, `ADVANCE`, `COMPLETE`, `TURN_IN`,
and opening the quest log). So an expired quest can be *noticed* late, but it can never be progressed
or paid out late. There is no window in which the deadline has passed and the reward is still
reachable. The regress suite tests that gate rather than the status flip, because a failure that
leaves `TURN_IN` reachable is worse than no failure at all.

The log shows `(4m left)` on a timed quest: a deadline the player can't see isn't a deadline, it's an
ambush.

### Penalties

`quests.penalties` is to failure what `rewards` is to turn-in — the same shape **minus items**:

```js
penalties: {
  credits: 200,                                     // stated POSITIVE, taken
  rep:    [{ ideology: 'ascendants', delta: -5 }],
  flags:  [{ scope: 'player', flag: 'vale_wont_talk', value: 'true' }],
}
```

Without this, failing cost you nothing you had, which made every failure condition cosmetic — you
simply took the quest again. Authored as a **Penalty** node in the quest editor.

Two deliberate limits. **Credits are floored at the player's balance**, never pushed negative: the
debt systems that would give a negative balance meaning don't exist, and a player who can't buy food
because a quest blew is a softlock, not a consequence. **No item confiscation**, because the package
being gone is usually *why* the quest failed, so taking it is a no-op that reads like a bug.

## Things that were wrong, and are now not

An audit of this plugin on 2026-08-04 found eight defects. They're listed here because most of them
are the kind that come back if someone edits the surrounding code without knowing why it's shaped
this way.

1. **`TURN_IN` paid out before marking the quest turned in**, with no transaction — every reward
   granted and the status written last, dozens of lines and a dozen awaits after the status was
   *read*. Two hand-ins racing (the Tablet button and a dialogue node, or one double-click) both
   passed the check and both paid; a throw mid-grant left the quest `completed` and re-handable. Now
   a **single conditional UPDATE claims the row first** — whoever flips it wins, everyone else gets
   zero rows and stops. The deliberate trade: a grant failing *after* the claim loses that reward
   rather than duplicating it. A player short one payout is a support ticket; a player with infinite
   payouts is an economy.
2. **`trackEvent` queried the DB on every player step.** It's subscribed to `zone.entered` and opened
   with an awaited `SELECT` whether or not the player held a quest — on a remote Postgres, one round
   trip per tile. `player._activeQuests` is now a live-object Set, hydrated at login and maintained
   through `setQuestFlag` (the single choke point, so a new transition can't half-maintain it). The
   common case costs zero queries. It's a cache of a cheap fact, not a source of truth: `trackEvent`
   re-derives it whenever it *does* query, so drift converges.
3. **A read-modify-write race.** `emit()` doesn't await subscribers, so two matching events in one
   tick both read the same progress and the second write discarded the first — three rats, one
   grenade, one kill counted. `trackEvent` now serialises **per player** (their events are inherently
   ordered anyway; different players never contend).
4. **`findTurnInNpc` ran an unindexed full-table `LIKE` over every NPC's dialogue tree, twice per
   completion.** Now memoised with a 60s TTL, misses cached too — a quest with no turn-in NPC (every
   flight contract) is exactly the case that would otherwise re-scan forever, having nothing to find.
5. **Editing a live quest silently corrupted every holder's progress.** The array is index-aligned to
   `objectives`, so reordering or deleting one repointed everybody's counters with no error anywhere.
   `player_quests.progress_keys` now records the objective ids the array was built against and
   everything **re-keys by id on read**. Objectives with no authored id fall back to their index —
   exactly the old behaviour — so a quest that never gets edited is unaffected.
6. **Auto-spawned `retrieve` items were never cleaned up.** Taking and dropping a retrieve quest
   littered the zone permanently, one copy per attempt. `player_quests.spawned` records the row ids
   created, and abandon / fail / turn-in / retake remove them. **By row id, never by (item_id, zone)**
   — the latter would also match an authored world item or another player's copy. Items somebody has
   already **picked up are theirs and are never reclaimed**; vanishing loot out of an inventory is a
   far worse bug than a stray item on a floor.
7. Failure had no teeth — see [Penalties](#penalties) above.
8. **The quest-status flag key comment was wrong.** It claimed a `quest_<id>` prefix the code has
   never applied. The code is correct and unchanged (breaking every existing dialogue Condition for a
   cosmetic namespace would be a bad trade); the comment now states reality. ⚠ **Author Conditions
   against the bare quest id.** The consequence to know is that quest state shares the flat
   `player_flags` namespace, so a quest id must not collide with an existing flag name.

And one found *by* the fixes, not by the audit: **abandoning a quest blacklisted it forever.**
`START_QUEST` only ever re-activated a `turned_in` + repeatable row, so a quest you bailed on could
never be retaken — the NPC kept offering it and accepting quietly did nothing. Abandoned rows are now
retryable. Changing your mind was never meant to be a punishment.
