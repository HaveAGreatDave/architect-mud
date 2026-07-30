# injury

Wounds that outlive the fight. One injury per body part, three severities, named by the damage type
that caused them, healing on their own clock.

**Phases 1–5 of [docs/proposals/injury-system.md](../../docs/proposals/injury-system.md) are built.**
Wounds appear, penalise, heal on their own, and can be treated. Injuries on ENEMIES (§8b) are not
built and are gated on the proposal's kill criterion.

## The constraint

> An injury is something you **notice**, not something you administer.

No bar to watch, no upkeep, no consumable you are obliged to carry. Every wound heals on its own;
medicine (Phase 5) only makes it faster. If a change to this plugin would make a player open a
screen to manage something, it is the wrong change.

## How it works

- **Seven parts**, the ones combat already rolls (`combat.js:254`) — arms and legs lateralized.
- **Three severities.** Bruised is flavour only; Hurt and Maimed are where the (future) penalties live.
- **The part owns what an injury does; the type owns how likely, how bad, how long, and what it
  reads like.** Two independent lists, never a 7×5 grid. See `tables.js` — that file is the entire
  tunable surface.
- **A second wound deepens the existing one** rather than stacking, and a graze can never downgrade
  a fracture.

## Read tier

**Zero queries at runtime.** Injuries live on the live player object, parsed on first touch out of
the `injuries` player_flag (already in memory — `flags.js` hydrates the whole flag set at login),
and flushed coalesced from the minute tick.

`onDamage` is **synchronous by contract** — it runs on the combat hot path, every swing of every
fight. It must never await, and neither must anything it calls. Same rule as `wear()` and
`hygieneOf()` next door.

Decay is **lazy, with no tick of its own** (the `player_npc_relations` pattern): nothing heals until
someone reads it. A wound that healed while you were offline is already healed when you look, and a
restart cannot reset anyone's injuries. Sleeping heals faster by *backdating the stamp* rather than
via a second decay path, so there stays exactly one place that turns elapsed time into healing.

## Exports (the Phase 3 seam)

| | |
|---|---|
| `severityOf(player, part)` | integer 0–3, sync and query-free — the hot-path read for penalties |
| `injuryReport(player)` | injured parts only, worst first |
| `bodyReport(player)` | all seven parts with bands, for the Vitals paper doll |
| `severityFor(damage, hpMax, type, opts)` | pure — the function to poke when a type feels wrong |
| `clearInjuries(player, opts)` | the surgical tier; only `plugins/clinic` should call it |

## Gotchas

- **`tables.js` is the balance file**, and it has two traps, both of which have already been sprung
  once (see injury-system.md §11):
  1. **The character is a constraint, not an outcome.** `edged` must keep the lower threshold *and*
     the shallower climb (larger `step`); `kinetic` the higher bar and the steeper climb. Tuning both
     types against the same rate targets silently swaps their roles, because the weapons that carry
     them are not the same strength. Asserted by `kinetic climbs steeper than edged`.
  2. **Tune against every weapon that will use the curve.** `kinetic` was first tuned only up to the
     riot shotgun, which sent the SMG to 36% and the sledgehammer to 54% maim per hit.
- **The injury check scores `baseDamage`, not `damage`.** Crit and head hits lower the *threshold*
  and must never also inflate the number measured against it — that double-dip produced a 92% maim
  rate on head hits. If you add a damage source, pass `baseDamage` (pre-crit, pre-head, post-soak) or
  it will wound harder than everything else.
- **`enemy.js` is the §8b half and shares only `severityFor`.** No storage, no decay, no naming — an
  enemy instance is disposable, so wounds live on it and die with it. Never give this file a
  `query()`; it runs once per landed player swing.
- **Unauthored names are a valid state.** `injuryName` falls back
  `type.severity.part → type.severity → severity → generic`. Never feel obliged to fill the table.
- **The paper doll lives in the tablet plugin**, not here — `plugins/tablet/health-app.js` imports
  `bodyReport` (cross-plugin import is house style there; it already does the same for sanity and
  intoxication). The `body` payload is `null` when nothing is wrong, so an uninjured player sees the
  Vitals screen exactly as it was.

## Tests

`npm run test:regress` — 32 checks covering the type curves' *character* (blunt rarely-but-badly vs
edged often-but-mildly), armour preventing wounds outright, proportional decay over long absences,
and the naming fallback chain.
