# Hololock at the log rung: a lock you play a move at a time

**Status:** built (as built) 2026-10-18, after approval of the decisions below. Not yet committed; the doors regress case (build step 8) is still to write.

## Why

At the `log` Display Mode rung, which is the rung screen-reader players use, a hololock isn't played. `resolveForLogRung` in [minigame.js](../../server/engine/minigame.js) rolls one 2d8-2d8 `skillCheck` against the lock's difficulty and reports it through `hackresolve`. Nobody gets stuck, but nobody plays either. The file calls itself an interim shape, and [systems-display-mode.md](../systems-display-mode.md#-why-there-is-no-slow-it-down-option) says the same.

This replaces the roll with a turn-based lock. The constraint comes from the Reaction Time revert in that same doc section: an accessibility rung may move the interface but never the odds on a contested outcome. Breaking a hololock opens somebody's flat and pays hacking XP, so the turn-based lock has to win exactly as often as the roll it replaces, at every skill and difficulty. Step one was checking that arithmetic before writing any of the game.

## The game

The same object as the reflex lock: a stack of pins, a hidden window on each, and a FEEDBACK meter that trips the lock and flags your deck if it fills.

- **Pins:** `clamp(3 + difficulty / 2.5, 3, 6)`, the reflex lock's own formula, so a harder lock has more pins in both versions.
- **Track:** ten cells, numbered 1 to 10. Each pin's window is one cell, placed at random. Ten keeps every cell one keystroke (1 to 9, and 0 for 10) and short enough to say aloud.
- **Two moves**, each aimed at a cell:
  - `set N` drops the pin at N. In the window, the pin locks and costs nothing. Outside it, the pin springs back, FEEDBACK goes up 3, and the lock tells you which side of N the window is on.
  - `probe N` tests N without committing. FEEDBACK goes up 1 whatever happens. If N is the window, the pin locks. If not, you learn which side.
- **The capacity:** you win by setting every pin before FEEDBACK reaches the lock's capacity. It's the only number that carries the gap between your skill and the lock.

So the decision, pin after pin, is when to gamble. Probing is cheap and safe; setting is free when it lands and costs three probes when it doesn't. You can't afford to probe your way through every pin, and you can't afford to guess wildly either.

### What the log says

It's all appended lines: no board to repaint, no clock. Each line carries everything you need to decide, so a player never has to remember an earlier line. Commands are typed words, or the number keys for the cell.

```
You jack into the hololock on the west door. Four pins, cells 1 to 10.
This lock takes 10 feedback before it trips.
Pin 1 of 4. The window is somewhere in cells 1 to 10. Feedback 0 of 10.
> probe 4
Nothing at 4. The window is above it: cells 5 to 10. Feedback 1 of 10.
> probe 8
Nothing at 8. The window is below it: cells 5 to 7. Feedback 2 of 10.
> probe 6
It's 6. The pin bites and holds. Pin 2 of 4: cells 1 to 10. Feedback 3 of 10.
...
Pin 4 of 4. The window is somewhere in cells 1 to 10. Feedback 8 of 10.
> probe 4
Nothing at 4. The window is above it: cells 5 to 10. Feedback 9 of 10.
> set 7
The pin bites at 7 and holds. All four pins set. The lock chirps green.
```

The finished game fires `hackresolve <doorId> <0|1>`, the same verb and arguments every rung sends today. The authoritative path in [doors.js](../../server/engine/commands/doors.js) (`cmdHackResolve`) doesn't change, and nor does the XP: it still comes from `awardSkillUse` with `breachMargin`, which reads skill against difficulty and never looks at how the lock was beaten.

## How the odds are matched

`skillCheck` wins when `gap + (2d8 - 2d8) >= 0`, where `gap = effective skill - difficulty`. So its chance depends on the gap alone. A fractional gap (a deck's `hack_penalty` can be fractional) acts as `floor(gap)`.

The script solves the turn-based lock exactly, by dynamic programming over every state a player can be in. A player's knowledge of the current pin is always an interval of cells, every cell in it equally likely, so that state is small. The solver finds the best possible win chance at each whole-number capacity.

A whole-number capacity can't hit the dice. The first draft tried, and missed by up to 25 points, because best play's win chance jumps in steps of 10 to 25 points from one capacity to the next. So **a lock's capacity is a real number**, rolled at jack-in. A lock rated 7.4 takes 7 on 60% of jacks and 8 on the other 40%, and the log announces the result before the first move. Best play then wins exactly `0.6·V(7) + 0.4·V(8)`, which can be any value between the two. Nothing is hidden, and the roll is the same kind of thing as the reflex lock's per-channel speed jitter.

The capacity for each pin count and gap comes from that interpolation. It runs from 0 (gap -15 or worse: the dice never win, and neither can you) up to the capacity at which best play can't lose (gap +14).

| pins | gap -10 | gap -5 | gap 0 | gap +5 | gap +10 |
|---|---|---|---|---|---|
| 3 | 3.45 | 5.71 | 7.39 | 8.79 | 9.89 |
| 4 | 5.52 | 7.98 | 9.79 | 11.40 | 12.77 |
| 5 | 7.65 | 10.19 | 12.20 | 13.90 | 15.54 |
| 6 | 9.81 | 12.42 | 14.60 | 16.50 | 18.09 |

`node scripts/a11y/hololock-odds.mjs --table` prints the full table, gaps -15 to +14, as a JS literal.

### Because the solver finds the best play, nobody beats the dice

This is the property the Reaction Time slider lacked. The capacity is calibrated to the best any strategy can do, so no strategy, written down or worked out, wins more often than the roll it replaces. Worse play wins less, as clumsy play does on the reflex lock.

## Results

20,000 games per row, 3 to 6 pins, gaps -12 to +12. The full table is in the script's output. Summary:

| Play | Against the dice |
|---|---|
| Best play, exact | matches at every one of 192 skill/difficulty inputs (by construction) |
| Best play, played game by game through the rules engine | worst 0.8 points, mean 0.0 (Monte Carlo noise is about 0.7) |
| The rule of thumb (below) | mean -0.5 points, worst -1.9 |
| Careful: probe the middle until sure, never guess | mean -11.9 points, worst -26.3 |

A slice, 4 pins:

| gap | dice | best play, played | rule of thumb | careful |
|---|---|---|---|---|
| -8 | 5.1% | 4.8% | 4.9% | 0.6% |
| -4 | 23.0% | 22.5% | 21.9% | 7.0% |
| 0 | 54.2% | 54.1% | 52.9% | 29.0% |
| +4 | 83.0% | 82.6% | 82.5% | 62.1% |
| +8 | 96.9% | 96.7% | 97.1% | 89.2% |

The played line is the real test. It runs the rules engine with random locks, not the solver's model of the game, and it lands on the dice within noise everywhere.

### The rule of thumb

The solver's own moves (`--explain`) have a simple shape:

> Probe the fourth cell of what's left (or just below the middle, if fewer than seven cells are left). Once the feedback you can still take is down to the number of pins left, stop probing and set.

Played that way, the lock is within 2 points of the dice everywhere. Careful play, which never guesses, runs out of feedback, and that's where its 12 points go. The second half of the rule is the game.

### Walking away from a lock is tripping it

The simulation can't see this one; building the board did. The capacity is announced before the first move, so a player free to abort a low roll and jack in again would only ever play the high one, and win more often than the dice. So at this rung, abandoning a started lock costs what losing it would:

- `abort` reports a loss.
- `hack` again while a turn-based lock is unresolved trips the old one first (`hackDoor`), expired or not, since waiting out the window is the same walk-away.
- A reported loss trips the lock even from another room or after the window (`cmdHackResolve`), where a reflex-rung loss would `noop`.

The reflex lock can still be closed and retried; that's untouched.

## What this costs, plainly

- **The game has a low ceiling, on purpose.** If its odds match the dice, a short rule has to get close to best play. Otherwise an expert beats the roll, or a newcomer does much worse than the roll they have today. A rule that fits in two sentences gets within 2 points. That means the lock is a real decision a few times per pin, not a deep puzzle. It's still more game than one roll, and it's the most game the odds rule allows.
- **The capacity roll is a dice element.** It moves best play by 12 points on average, 28 at most. The rest of the luck is in where the windows are, and the rest of the outcome is your decisions.
- **The target is `skillCheck`, not the reflex board.** Nobody has measured how often a typical player beats the graphical hololock at a given gap. This keeps the log rung at today's odds exactly; it says nothing about whether the reflex lock and the dice agree. That's a separate question for the top two rungs.

## Building it

1. ✅ **One rules module, shared:** [hololock-turns.js](../../client/shared/hololock-turns.js), pure (no DOM, no network). The board and the odds script both import it, so what's simulated is what ships.
2. ✅ **The capacity is a committed table** in that module, generated by `--table`. Nothing calibrates at runtime, and the script fails if the table drifts from a fresh calibration.
3. ✅ **The log-rung board:** [loghololock.js](../../client/game/js/panels/loghololock.js). It writes each line to the log with `appendHtml` and draws nothing, so it doesn't claim `#area-pane`. It takes `set 6`, `probe 6`, `p 6`, `s 6`, a bare number (a probe; a set needs the word, so one stray key never costs 3), `0` for cell 10, `status`, `help` and `abort`, and passes any other word to the server. Its replies are queued a microtask, because `net.js` prints the player's echo after the board's handler returns. Driven headlessly through 3,000 games with the rule of thumb read off its own lines, it won 52.6% at 5 pins, gap 0: the simulation says 52.8% and the dice 54.2%.
4. ✅ **Routing.** Checked on the real game page served statically: `handleServerMsg` with a `render: 'turns'` payload loads the board lazily, its lines land in `#output`, typed words reach it through `textRungCommand` (and `look` passes through), and `abort` hands `hackresolve` to `net.js`.
   - `textRender` in `minigame.js` takes a `turns` option and, at the log rung, returns `{ ...payload, render: 'turns' }` instead of rolling. `hackDoor` already passes `{ turns: true }`, which is ignored until then.
   - `lazy-views.js` gets a lazy `loghololock` panel, an `openLogHololock` via `openOr`, and the panel in `TEXT_RUNGS` so typed words reach its `command()`.
   - The `hololock_game` route in `dispatch.js` opens it when `msg.render === 'turns'`, falling back up to the graphical board.
   An old client that doesn't know `turns` opens the graphical board, which is the ladder's fall-back-up rule.
5. ✅ **The resolve window:** 20 minutes for a turn-based breach (`HACK_TURNS_TTL_MS`), 180 seconds as before for the other rungs. Walking away is covered above, so the longer window gives nothing to exploit.
6. ✅ **The gate:** `scripts/a11y/hololock-odds.mjs` is in the `a11y` group in `scripts/gates/manifest.mjs`. About 4 s of CPU, writes nothing, opens no port.
7. ✅ **Docs:** [systems-display-mode.md](../systems-display-mode.md) ("Why there is no slow it down option", and the interim note), and the comments in `hololock.js` and `minigame.js`.
8. **Regress:** a `plugins/doors/regress.js` case for the abandoned-lock trip and the turns TTL. Not written yet.

## Decisions (2026-10-18)

1. **Calibrated to best play**, so the dice are the ceiling and nobody beats them.
2. **The rule of thumb is taught in `help`.**
3. **The capacity roll stays.**
4. **The resolve window** is 20 minutes for a turn-based breach (build step 5).
