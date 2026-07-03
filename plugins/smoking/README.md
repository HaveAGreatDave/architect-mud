# smoking

**Purpose** — the behavioural layer of lighting up. The stat side of a cigarette (Cool up, Stamina down) is pure content on the drug row's `phases.peak_mods`; this plugin owns the three effects that aren't a stat delta: **appetite suppression**, a random **hacking cough**, and onlooker **cool-reactions**. Nothing is hardcoded to "cigarettes" — a drug row flagged `flags.smokeable` drives all of it, so the drug editor stays the source of truth (mirrors how the intoxication plugin keys off `flags.alcoholic`).

## Registered actions

- `smoke <drug>` (specialized action, requires the `drug` tag) — flavour alias for `use`/`inject`; delegates to the engine drug path (`cmdUse`).

## Events consumed

- `player.drugUsed` — if the drug is `flags.smokeable`: set `player.appetiteSuppressedUntil` and broadcast a cool-reaction to the rest of the zone.
- `player.death` / `player.logout` — clear smoking runtime state (sober-on-respawn, like trips/intoxication).

## Tick usage

- Self-scheduled 8s `setInterval` — rolls a random hacking cough for anyone who smoked recently (30% chance/tick within 3 min) or is still a lingering smoker (5% chance/tick within 30 min). Narrated to the smoker and the room.

## Cross-system contract

- **`player.appetiteSuppressedUntil`** (ms epoch) — this plugin writes it on a smoke; the engine's hunger-decay tick (`server/engine/gameLoop.js`) reads it and skips hunger decay while it's in the future. Plugin owns the field, engine reacts (the posture pattern). Documented in [docs/systems-survival.md](../../docs/systems-survival.md).

## Content flags (on the drug row)

- `flags.smokeable: true` — gates every behaviour here.
- `flags.appetite_suppress_seconds` — how long one dose pauses hunger decay (default 900 = 15 min).
