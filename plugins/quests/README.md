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

## Tick usage

None.

## Dependencies

`economy` (`adjustCredits` for credit rewards); the core graph-engine Actions `GRANT_ITEM` / `SET_FLAG`
for item and flag rewards.

## Config

None.

## Data schema

- `quests` — `id, name, description, objectives JSONB, rewards JSONB, repeatable, updated_at`.
  - `objectives`: `[{ type, target?, item_id?, zone?, count?, desc, requires?[], emotes?[], taskSeconds? }]`
  - `fail_on`: the same shapes, but each blows the quest — see [Failure](#failure)
  - `penalties`: what failing costs — `{ credits?, rep?:[{ideology,delta}], flags?:[…] }`
- `player_quests` also carries `progress_keys` (the objective ids `progress` was built against, so a
  quest can be edited without corrupting live progress) and `spawned` (row ids of auto-spawned
  `retrieve` items, so they can be taken back out of the world).
  - `rewards`: `{ credits?, items?:[{item_id,quantity}], flags?:[{scope,flag,value}] }`
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

`buy`/`sell`/`craft`/`hack`/`spend`/`survive` treat a blank target as "anything counts".
`kill`/`talk`/`assassinate`/`escort` require one, because they name a thing.

Three of those Events had to be **added**, because the act was never announced at all:
`item.crafted` (`server/engine/crafting.js`), `vendor.sale` (`server/engine/vendor.js`) and
`npc.talked` (`server/engine/dialogue.js`). Everything else was already on the bus.

### A predicate may return a number

`trackEvent`'s predicate normally answers yes/no and the counter ticks by one. It may instead return
a **number**, which is the amount to add. That is what makes an objective measured in credits
(`spend`) or in output quantity (`craft`) expressible at all, rather than only ones measured in
repetitions.

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

Two shapes are **failure-only**, having no advancing counterpart:

| | |
|---|---|
| `{ type:'timeout', count:<seconds> }` | measured from `player_quests.started_at` |
| `{ type:'escort_lost', target:<npc> }` | the escortee died or was separated with no way back |

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
