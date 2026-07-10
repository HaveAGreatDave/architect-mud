# intoxication

**Purpose** — The **alcohol system**: a decaying, BAC-style drunkenness meter
(`player.intoxication`, 0–100, in-memory) fed by *any* alcoholic drink and drained
by coffee, driving slurred speech, wobbly movement, mechanical impairment, and
heavy-drunk blackouts. Overdose (alcohol poisoning, lethal at `overdose_threshold`)
is content on the drug row and handled by the engine drug system.

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
- `flags.sobering: true` + `flags.sober_amount` (default 30) — drains the meter
  (coffee).

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

All in-memory on the live player object (`intoxication`, `_intoxBand`,
`blackedOutUntil`, `_blackoutActive`). No schema, no persistence — logging out or
dying sobers you up.
