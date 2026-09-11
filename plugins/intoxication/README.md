# intoxication

**Purpose** — The **alcohol system**: a decaying, BAC-style drunkenness meter
(`player.intoxication`, 0–100, in-memory) fed by *any* alcoholic drink and drained
by coffee, driving slurred speech, wobbly movement, mechanical impairment, and
heavy-drunk blackouts. Overdose (alcohol poisoning, lethal at `overdose_threshold`)
is content on the drug row and handled by the engine drug system.

**This plugin owns how drunk you are, not the whole arc.** The come-up, the warmth,
the hangover, tolerance and withdrawal are authored on `drug_alcohol` and run by the
engine's phase/withdrawal machinery — see
[systems-survival.md](../../docs/systems-survival.md#alcohol--two-clocks-and-which-owns-what).
The split matters in one direction especially: `phases.peak_mods` carries **no stat
the bands below already move**, or one drink would debuff a drinker twice.

**One shared alcohol drug, many drinks.** Alcohol is a single drug row —
`drug_alcohol` (`flags.alcoholic`) — and every served drink applies it:
- **Beer** is a drug item linked to `drug_alcohol` (drunk directly through the drug path).
- **Bar drinks** (rust whiskey, embassy reserve, glow cocktail) are consumables
  laced with it via the general `tags.laced_drug: "drug_alcohol"` + `tags.laced_potency`
  mechanism — per-drink strength scales `intox_per_dose`. They share ONE BAC pool,
  tolerance and alcohol-poisoning OD. (`laced_drug` is general — any consumable can
  carry any drug, so non-alcohol drugged drinks/food are possible too.)

Nothing is hardcoded to a specific drink. Content decides via drug-row `flags`:

- `flags.alcoholic: true` + `flags.intox_per_dose` (default 22) — feeds the meter,
  scaled by potency (synthesis or a drink's `laced_potency`).
- `flags.absorb_seconds` (default 0 = land whole) — bleeds the dose into the meter
  over that many seconds instead of all at once. See **Absorption** below.
- `flags.sobering: true` + `flags.sober_amount` (default 30) — drains the meter
  (coffee).

## Absorption — the reason it is possible to drink too much

A dose used to land on the meter whole, the instant it was swallowed, which made
over-drinking something you could only do **on purpose**: the feedback was immediate
and perfect, so you always knew exactly where you stood before deciding whether to
order another. Nobody has ever been caught out by a drink that told them the truth
straight away.

So a dose goes into a pending pool (`player._intoxPending` / `_intoxRate`, in memory
like the meter) and bleeds in over `flags.absorb_seconds` on the existing 4s tick.
A second drink while the first is still arriving **stacks** rather than replacing —
that is the case the whole mechanic is about. Sobering (coffee) drains what is still
in the pool *first*, or a drink you had before the coffee would undo it a minute
later. Death and logout clear the pool with the meter.

The pool is deliberately **not surfaced anywhere**. A read-out of what is still
coming would hand back the certainty this exists to take away.

⚠ **The window is bounded by the decay rate.** The meter sheds `DECAY_PER_TICK`
(0.15 per 4s = 0.0375/sec) the whole time a dose is arriving, so a dose arriving
more slowly than that is eaten on the way in and **the meter never moves** — you
drink, and nothing happens, with no error anywhere. The first draft of the alcohol
row used the honest real-world figure of fifteen minutes and did exactly that (22
points over 900s = 0.0244/sec against 0.0375/sec of decay). Alcohol is 31 points
over 240s, which **peaks at the same 22** the bands below were drawn around: the lag
is what is new, not how drunk a drink gets you. `regress.js` asserts the inequality
against the live drug row and this file's own constants, and asserts that
`phases.comeup_seconds` equals `absorb_seconds` — two clocks, one fact, or the
drug row announces the warmth long after the meter said you were drunk.

## Effects by level

| Level | Effect |
|---|---|
| ≥ 30 | **Slurred speech** — the `speech.transform` hook mangles the spoken line (stretched vowels, `sh` sibilants, `*hic*`), intensity scaling with level. NPC-name detection still keys off the real text. |
| ≥ 40 | **Wobbly movement** — a `zone.entered` listener sends the mover a stagger line and, with rising probability, broadcasts a stumble to the room. |
| ≥ 70 | **Blackout** — each 4s tick rolls (up to ~12% at 100) a 10–30s blackout: the client drops a black curtain (`blackout_start`/`blackout_end`) and the engine's `handleCommand` refuses every command via `player.blackedOutUntil`. |

**Mechanical impairment by band** — on top of the narration, each band applies a
reversible stat block through the modifier ledger (source `intox`), so it backs
out cleanly as you sober: tipsy = `stat_cool +1` (liquid confidence); drunk =
`+cool, reflexes −2, brains −1`; wasted = `reflexes −4, brains −3, endurance −2`.
Reversed on sober / death / logout.

## Events consumed

- `player.drugUsed` — reads the drug's `flags` to feed/drain the meter.
- `zone.entered` — staggers drunk arrivals.
- `player.death` / `player.logout` — clears the meter and any blackout (sober on respawn/reconnect).

## Hooks handled

- `speech.transform` — returns the slurred line when drunk, `undefined` otherwise.

## Tick usage

- Self-scheduled 4s `setInterval` (butchering/scavenging precedent): decays the
  meter (`DECAY_PER_TICK`), narrates band crossings (sober/tipsy/drunk/wasted),
  and runs the blackout roll + lifecycle.

## Engine seams it relies on

- `emit('player.drugUsed', { player, drug, potency, … })` in `drugs.js` — carries
  the drug object so flags are readable.
- `fireHook('speech.transform', { player, text })` in `cmdSay` (social.js).
- The `player.blackedOutUntil` gate in `handleCommand` (commands/index.js).
- Client `blackout_start`/`blackout_end` FX in `dispatch.js`.

## State

All in-memory on the live player object (`intoxication`, `_intoxPending`,
`_intoxRate`, `_intoxBand`, `blackedOutUntil`, `_blackoutActive`). No schema, no persistence — logging out or
dying sobers you up.
