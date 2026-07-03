# intoxication

**Purpose** — Owns the behavioural layer of drinking alcohol: a decaying,
BAC-style drunkenness meter (`player.intoxication`, 0–100, in-memory) fed by
alcoholic drinks and drained by coffee, which drives slurred speech, wobbly
movement, and heavy-drunk blackouts. Overdose (both beer and coffee are lethal at
their `overdose_threshold`) is pure content on the drug rows and handled by the
engine drug system — this plugin never touches it.

Nothing is hardcoded to a specific drink. Content decides via drug-row `flags`:

- `flags.alcoholic: true` + `flags.intox_per_dose` (default 22) — feeds the meter,
  scaled by synthesis potency.
- `flags.sobering: true` + `flags.sober_amount` (default 30) — drains the meter
  (coffee).

## Effects by level

| Level | Effect |
|---|---|
| ≥ 30 | **Slurred speech** — the `speech.transform` hook mangles the spoken line (stretched vowels, `sh` sibilants, `*hic*`), intensity scaling with level. NPC-name detection still keys off the real text. |
| ≥ 40 | **Wobbly movement** — a `zone.entered` listener sends the mover a stagger line and, with rising probability, broadcasts a stumble to the room. |
| ≥ 70 | **Blackout** — each 4s tick rolls (up to ~12% at 100) a 10–30s blackout: the client drops a black curtain (`blackout_start`/`blackout_end`) and the engine's `handleCommand` refuses every command via `player.blackedOutUntil`. |

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
