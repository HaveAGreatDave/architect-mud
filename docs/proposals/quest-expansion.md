# Quest system expansion — seven additions

**Status: all seven are BUILT (2026-09-04).** The as-built system is
[plugins/quests/README.md](../../plugins/quests/README.md), which stays the authority on
everything that already ships.

## Why these seven

The objective table is in good shape: a type is an event subscription plus a predicate, and
`fail_on` reuses the same shapes to state a constraint instead of a task. Adding a nineteenth
objective type is cheap and adds little.

What is missing is structural. Every quest is a fixed list of mandatory tasks, against targets
written by hand, paying once at the end, with one ending. The seven below each remove one of those
words. They are ordered by payoff against cost, and each is independently shippable — none of them
requires another to land first.

None of them changes the shape of an existing authored quest. A quest with no `optional`, no
`resolutions` and no selectors behaves exactly as it does today, which is the migration plan.

---

## 1. Branching resolutions — BUILT

**The gap.** `rewards` is one object, so a quest has one ending. The crossover at slot 7 of
[the faction arc ladder](../systems-faction-arcs.md) — where the order you were sent against makes
you a counter-offer — is exactly a quest with two endings, and today it has to be built as two
quests joined by hand-written flags. Every author who writes one invents their own flag naming, and
the two halves drift.

**The shape.** `rewards` gains a sibling:

```jsonc
resolutions: [
  { when: { flag: 'told_maresh', op: 'eq', value: 'true' }, rewards: { } },
  { when: { relation: 'trusted', target: 'npc_vale' },      rewards: { } },
]
```

`TURN_IN` walks the list in order and pays the first whose `when` passes, falling back to `rewards`
when none does or none is authored. Conditions go through `evalCondition`
([server/engine/flags.js](../../server/engine/flags.js)), which is the same evaluator dialogue
options and quest gating already use, so every condition shape in the game — flags, relations,
`ideology_rep`, `mastery` — is available on day one and new shapes arrive for free.

⚠ **The resolution must be recorded, not just paid.** Write the chosen index onto `player_quests`
at turn-in. Later content needs to ask which way you went, and re-evaluating the condition
afterwards answers a different question — the flag it read may since have changed.

## 2. Optional objectives — BUILT

**The gap.** Every objective is mandatory, so a quest is binary. There is no way to author "done"
versus "done well", which is most of what makes a repeatable worth doing properly the fifth time.

**The shape.** `optional: true` on an objective. It is skipped by the completion check, still
tracked, still shown in the log (marked), and may carry its own `rewards` paid at turn-in alongside
the quest's. It composes with `requires` unchanged.

⚠ **An optional objective must never appear in `requires`** of a mandatory one, or the quest is
unfinishable by a player who ignored it. `content:lint` should refuse that rather than leaving it to
be discovered live.

## 3. Rolled targets — BUILT

**The gap.** [plugins/jobboard](../../plugins/jobboard/README.md) rolls *which* quest is posted; it
has never rolled anything *inside* one. The same gig is byte-identical every rotation, which is what
makes twenty authored jobs read as twenty jobs forever.

**The shape.** A target may be a selector, resolved once at `START_QUEST` and frozen onto
`player_quests` beside `progress_keys`:

```jsonc
{ type: 'kill',     target: '@enemy_in:region_coldwater', count: 3 }
{ type: 'retrieve', item_id: '@any_of:[item_a,item_b]', zone: '@zone_with:flags.terrain=marsh' }
```

Everything downstream reads the frozen value, so predicates, GPS routing, `retrieve` auto-spawning
and the log need no change at all. `progress_keys` already exists to keep live progress honest
across an edit; frozen targets are the same idea pointed at authoring-time variance.

⚠ **A selector that resolves to nothing must refuse the quest at START, loudly.** Silently starting
an unfinishable quest is the failure mode this feature is most likely to ship with, and it looks
like a content bug for weeks.

## 4. Payment structure — BUILT

**The gap.** Money moves once, at turn-in. So taking a job costs nothing and failing one loses
nothing you were holding — which is why `penalties` had to invent a debt out of nothing.

**The shape.** `rewards.advance`, paid at `START_QUEST`, and kept on failure. Failing a job you took
an advance on is now theft, and `penalties` has something real to charge for. Optionally,
per-objective payout for long chains, using the same payment path.

⚠ **Advance and penalty must not net out by accident.** An advance of 200 with a penalty of 200
reads to a player as nothing having happened; state the two separately in the log.

## 5. Consequences instead of penalties — BUILT

**The gap.** `penalties` only subtracts. The interesting answer to a failure is rarely a fine — it is
the cleanup job, or the person who now wants a word.

**The shape.** `on_fail: { start_quest: 'quest_make_it_right' }` and `on_turn_in`, both
dispatching the `START_QUEST` action that already exists. Roughly ten lines, and it retires most of
the hand-written flag chains that currently link a quest to its sequel.

⚠ **Guard the cycle.** A quest whose `on_fail` starts a quest whose `on_fail` starts the first is an
authoring mistake that costs a loop at runtime; refuse a chain that reaches back to a quest already
active on that player.

## 6. World-state objectives and offer windows — BUILT

**The gap.** Every objective is driven by a player act. The simulation the game spends its tick
budget on — [unrest](../systems-unrest.md) bands, [weather](../systems-weather-extreme.md), power,
[corp](../systems-corps.md) influence — is invisible to quests, so no quest can be about the city.
Relatedly, every quest is on offer permanently, which makes a board a menu rather than an event.

**The shape.** Two types. `state`, met when a world condition holds, and its `fail_on` mirror
`avert`, tripped when one becomes true. Both are polled at the existing check points rather than
ticked — the same lazy-clock argument the timeout uses, and for the same reason.

Plus `available: { when, expires: <seconds> }` on the quest, read by the board and by the dialogue
gate, so a posting can lapse.

⚠ **`state` needs a floor on how it is checked.** A condition polled per event on a busy bus is a
hot path; it belongs behind the same funnel as the timeout check, never in a subscriber of its own.

## 7. Exclusivity — BUILT

**The gap.** "Taking the Null contract closes the Watch's" is expressible today only as a web of
flags maintained by hand across two quests written by two people.

**The shape.** `blocks: [quest_id]` on the quest, applied at `START_QUEST`: the named quests become
permanently unavailable to that player. It is the structural version of what
[systems-faction-arcs.md](../systems-faction-arcs.md) describes in prose, and the flags it replaces
are the ones most likely to be authored wrong.

⚠ **Blocking is permanent by construction and must be authored deliberately** — the same argument
`meta.failPermanent` already makes. Default to blocking nothing.

---

## Build order

Cheapest first, since none blocks another:

1. ~~**Optional objectives** (2) and **`on_fail` chaining** (5)~~ — built 2026-09-04. The field is
   `on_turn_in`, not `on_complete`: it fires at hand-in, and a quest can sit `completed` for a long
   walk before that. Naming it after the status it does not fire on would have been the first thing
   an author got wrong.
2. ~~**Rolled targets** (3)~~ — built 2026-09-04, as a selector registry
   (`registerQuestSelector`) rather than a fixed grammar. Building it turned up a defect from the
   previous item: the tablet's Quests app and the job board each carried their own copy of the
   completion check, and both said NOT finished for a quest whose only outstanding objective was
   optional. Both now import `isComplete` from the plugin.
3. ~~**Branching resolutions** (1)~~ — built 2026-09-04. Two additions the design did not have: a
   resolution with no `when` is an unconditional catch-all, so an author can end the list with "and
   otherwise, this"; and a resolution may name its own `on_turn_in`, which is what makes two endings
   two stories rather than two payouts. Recorded as an `id` on `player_quests.resolution` and
   mirrored to the flag `<quest_id>_resolution`, so later dialogue gates on it with no new condition
   shape.
4. ~~**Payment structure** (4) and **exclusivity** (7)~~ — built 2026-09-04. The advance needed one
   guard the design did not name: a retake of a FAILED or ABANDONED attempt pays nothing, or
   take-fail-repeat is a faucet. Exclusivity needed no new player_quests status — a
   `quest_blocked_<id>` flag per closed quest, which dialogue can already gate on.
5. ~~**World-state objectives and offer windows** (6)~~ — built 2026-09-04. `state`/`avert` take a
   `when` condition rather than a target, so a world flag needs nothing built. The design's
   `expires` was dropped on purpose: the job board already rotates postings on a clock, and a second
   expiry beside it would be two answers to the same question. What replaced it is `hours`, an
   in-world window that may wrap midnight.

Each lands with cases in [plugins/quests/regress.js](../../plugins/quests/regress.js) and, where it
is authorable, an entry in `_Q_KINDS` in
[client/devpanel/js/vine/vine-schema-quest.js](../../client/devpanel/js/vine/vine-schema-quest.js).
