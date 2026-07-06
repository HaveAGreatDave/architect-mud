# consume

Drinking and smoking as a **timed act**. Beer, cigarettes and joints aren't downed
in a single tick — the physical act plays out over ~12–18 seconds with varied
narration, and the drug **effect lands at the end**.

## How it hooks in

The engine's `cmdUse` ([server/engine/commands/inventory.js](../../server/engine/commands/inventory.js))
offers every non-inline drug to this plugin via the `consume.begin` Action
(`registerAction`/`dispatchAction` — no import coupling). This plugin decides by
drug **category** whether to defer:

| flag | category | duration |
|---|---|---|
| `flags.alcoholic` | drink | 12s |
| `flags.smokeable` | smoke | 15s |
| `flags.cannabis`  | joint | 18s |

Anything else returns `{ passthrough: true }` and `cmdUse` consumes it instantly,
exactly as before. **No drug-row edits are needed** — the categories key off the
same existing flags the `intoxication`, `smoking` and `cannabis` plugins already use.

## Flow

1. `use`/`drink`/`smoke` a beer/cig/joint → `consume.begin` returns a start line
   ("You crack the cap off the beer…") and holds the item.
2. `steps` intermediate lines dribble out evenly across the duration.
3. The finish timer calls the engine's `finishConsume`, which re-queries the row
   **fresh** and runs the real effect: `useDrug` (intox meter, cool-reaction,
   appetite suppression, tolerance/addiction, phased buffs) + burns the charge.
   The finish line ("You drain the last of the beer…") is passed as `takeLine`, so
   it replaces the generic "You take X."; the come-up line is suppressed (it would
   read as "you light up" *after* a 15s smoke).

## Interrupts & state

- **Moving** (`zone.entered`) breaks the moment and stops the consume (item intact).
- Starting a **second** slow consume is blocked ("still working on that").
- `player.death` / `player.logout` clear the timers.
- All state is the in-memory `player._consume`, cleared like other runtime fields.
- `player.appearanceNotes` hook adds an examine note while consuming ("They are
  smoking a cigarette").

Content authoring note: the narration pools live in `CONFIG` here (like the line
pools in `smoking`/`cannabis`), not on the drug row.
