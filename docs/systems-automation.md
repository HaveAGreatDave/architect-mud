# Client Automation — triggers, timers, aliases, variables (as built)

*Built 2026-08-15.* The automation half of a MUD client, and the four things
[systems-macros.md](systems-macros.md) could not do. Entirely client-side: nothing
here reaches the server except the same commands the player could have typed.

| Verb | What it is |
| --- | --- |
| `trigger` | a line arrived matching a pattern → run a script, and/or `gag` it |
| `alias` | the player typed something matching a pattern → rewrite it |
| `timer` | an interval elapsed → run a script |
| `vars` | read/write the variables a script stores |

Files: [automation.js](../client/game/js/automation.js) (stores, verbs, wiring),
[automation-guards.js](../client/game/js/automation-guards.js) (the dangerous
half, pure and tested), [variables.js](../client/game/js/variables.js),
[varscommand.js](../client/game/js/varscommand.js). Coverage is
[scripts/client/automation-smoke.mjs](../scripts/client/automation-smoke.mjs),
in `client:smoke` and `pretest:regress`.

## The one architectural rule

**None of the three has a runner of its own.** Every one of them ends at
`runMacro()` in `smartbar-macros.js`, which already owns the step budget, loop
pacing, the abort flag, client-verb routing and `$value` interpolation. A second
executor would be a second place a runaway loop can live, and the first one took
real care to make safe.

That is also why an alias may expand to a `;`-chained script: a single command is
a one-segment script, so both go down one path and cannot drift apart in what they
support.

## Why triggers are the dangerous one

A trigger fires commands, commands produce lines, and lines fire triggers. That is
a loop with the server in the middle, and it is not hypothetical — the first
trigger anyone writes is on a combat message, and combat messages are what
attacking produces. **Three independent guards**, because each alone has a hole:

1. **Re-entrancy.** Lines printed while a trigger chain runs fire nothing
   (`_depth`). Kills the direct self-feeding loop, which is the common case.
2. **Per-trigger cooldown** (400 ms default). A burst of six matching lines is one
   action, not six.
3. **A global sliding-window budget** — 25 fires / 10 s across all triggers.
   Exceeded, and **every trigger is switched off** and the player is told, loudly.

⚠ Guard 3 **disables rather than throttles**, on purpose. A throttled runaway is
still a runaway: it spams the server slowly and forever, and the player has no idea
why the game is behaving strangely. Guard 1 does not catch a loop that goes out
through the server and comes back a tick later — that is what guard 3 is for.

⚠ The budget is a **sliding window, not a resetting counter**. A counter reset
every 10 s waves through 24 fires at 9.9 s and 24 more at 10.1 s — 48 in a fifth of
a second, which is precisely the burst it exists to catch. The smoke test asserts
this case by name.

## Gag — hiding the line that fired

`trigger <pattern> = gag` hides the line. `trigger <pattern> = gag;say I saw that`
hides it *and* acts.

⚠ **Gag is resolved at COMPILE, into a boolean plus the script with the `gag`
segment removed** (`splitGag()`), never discovered while the script runs. That is
the whole design of it: hiding a line has to be decided before the line is
mounted, and the runner is async — a `gag` found three segments into a script that
has already awaited a `delay` would be deciding to hide something the player read
two seconds ago. Gagging is a property of the TRIGGER; writing it as a segment is
only how you say so.

⚠ **The line is suppressed BEFORE it is mounted, never removed after.** So a gagged
line was never in the document: the find bar, the scrollback cap, Read Aloud and
the DOM all agree without any of them knowing gagging exists. Removing a mounted
node instead leaves four readers with four ideas of what the log contains, and Read
Aloud has already queued the line it can no longer see.

⚠ **`msg-system` can never be gagged**, whatever the pattern says. That class is the
client talking to the player — including the message saying every trigger just got
switched off for looping. A pattern broad enough to hide the game's own explanation
of what went wrong makes the client unsupportable.

**A gag-only trigger is exempt from the re-entrancy guard and the fire budget.** It
runs no commands, so it cannot loop — and without the exemption you could not gag
the output of your own triggers, which is much of what gagging is for.

**Gagged lines are still recorded in the transcript.** Not wanting to *read*
something is not wanting it unrecorded, and a log saved to work out what happened
should not have holes where your own filters were.

## Command stacking

`n;n;e` is three commands, typed at the box. It routes through `runMacro` — a
single command is a one-segment script — so stacking, aliases and macros cannot
drift apart in what they support.

⚠ **The trap is `say meet me at the bar; I'll be late`**, which is the commonest
thing anybody types with a semicolon in it; splitting it turns half of somebody's
sentence into a command. Free-text verbs are never split, and **the list is not
written in `input.js`** — it is `FREE_TEXT_VERBS` from `client/shared/dictation.js`,
which exists for exactly this judgement. Two copies would drift, and the drift
shows up as a player's chat message being eaten.

⚠ **`;;` is a LINE-LEVEL escape** — the line is not split at all and each `;;`
collapses to one `;`. Deliberately *not* a per-separator escape, which is what it
looks like it should be: the runner splits the script itself, so an escaped
semicolon smuggled inside a segment gets split by `runMacro` a moment later and the
escape silently does not work. A line-level switch is the version that is true.

## The transcript

`.savelog` reads a **session buffer in `render.js`**, not the DOM. Reading the
document was the original implementation and was quietly wrong: the scrollback cap
trims as you play, so the saved file began wherever trimming had reached — and the
one thing people save a log for is working out what happened *earlier*.

20,000 lines against the DOM's 1,500; includes gagged lines; does not survive a
refresh. Every one of those limits is printed in the saved file's own header,
including the exact count of lines that fell off the front, rather than being left
to be discovered. Streaming to disk would need the File System Access API —
Chromium-only, and it asks for a folder permission the first time — so it is
deliberately not done.

## Other decisions worth keeping

- ⚠ **A regex that does not compile marks its row broken; it never throws.** This
  code runs inside the log's append path — an exception there takes the whole log
  down, on every line, until a reload, caused by a player typing a bracket.
  `render.js` also wraps the observer in its own `try`, belt and braces.
- **Triggers arrive by registration, not import** (`setLineObserver` in
  `render.js`). `automation.js` needs `appendMsg` and the macro runner, and the
  runner needs `appendMsg`; importing it from `render.js` would put the smallest
  module at the bottom of a cycle with two much larger ones. Render does not know
  automation exists — it just says what it printed.
- **Rich lines are fed as `textContent`.** A pattern should match what the player
  read, not the span soup it arrived in.
- ⚠ **Captures are substituted into the script string before it reaches the
  runner**, not threaded through as a scope. Runs are async and interleave; a
  module-level "current captures" that a second trigger firing mid-`delay` could
  overwrite would show up as one trigger acting on another's match — rare, wrong,
  and near-impossible to reproduce from a report.
- ⚠ **An absent capture group becomes `''`, never the literal `$3`.** Otherwise a
  command built from an optional group reaches the server with a dollar sign in it
  and answers `Unknown command`, with nothing naming the trigger that did it.
- ⚠ **Aliases expand ONE PASS.** An alias whose output matches another does not
  expand again — that is how `k` → `attack $1` → … hangs a text box, and chaining
  is worth nearly nothing next to explaining why the client froze.
- ⚠ **History remembers what was TYPED, not what it expanded to.** ArrowUp handing
  back `attack the rusted enforcer` when you typed `k enf` makes the alias useless
  the second time.
- ⚠ **`stop` switches timers OFF, persisted** — not merely unscheduled. A `stop`
  that leaves the thing which *restarts* the automation running reads as broken:
  the commands come back three seconds later and nothing explains why. It also
  survives a reload, so a runaway can't be resurrected by refreshing.
- **`MIN_INTERVAL_MS` (1 s) is a floor, not a suggestion.** A one-second timer is
  already a request per second forever; below that is indistinguishable from an
  attack on your own server, and the player who set it would never know.

## Variables

`set <name> <value>` / `unset <name>` are **macro-script segments**, classified in
`smartbar-macros.js`, not client verbs — so `set` typed at the command box stays
free for the game to use one day. `vars` is the verb that reads and writes them by
hand.

- **Built-ins win name collisions.** `$hp` must always mean your hit points, or a
  macro written a year ago quietly starts reading a variable set last night.
- ⚠ **An unset variable fails every comparison rather than reading as 0.** Zero is
  a value somebody meant to store; "never set" is not, and collapsing the two makes
  a typo'd name behave like a working counter.
- ⚠ **`set`/`unset` skip the inter-command stagger** and touch no network. Paying
  350 ms for `set count $count + 1` would make a counting loop three times slower
  than the thing it counts.
- **One line of arithmetic** (`+ - * /` on two numbers) because a counter that
  cannot be incremented is not a counter. Anything more is an expression parser,
  which is a project rather than a feature. Divide-by-zero returns the text
  unchanged — a macro echoing `Infinity` has failed in a way nobody can debug.
- **Persisted per-browser and deliberately NOT synced to the account** the way
  macros are: a variable is state mid-script, and two machines fighting over a
  counter is worse than each keeping its own.

## Verb grammar

`trigger` and `alias` share one grammar, because three surfaces with three
grammars is three things to remember for one idea:

```
trigger                          list them
trigger <pattern> = <script>     add or replace
trigger off <pattern>            remove that one
trigger on|off all               enable / disable the lot
```

A pattern wrapped in `/ /` is a regex; anything else is a case-insensitive
substring — the convention every client in this genre already uses, and the
default that cannot be written wrongly. `timer` has no pattern (it has an
interval) so it keeps its own small parser rather than being forced through the
shared one.

⚠ `trigger`, `triggers`, `alias`, `aliases`, `timer`, `timers` and `vars` are
**bare client verbs**, which shadow any server verb of that name forever — a
client verb never reaches dispatch. All were checked against the live registries
(builtins, aliases, every plugin's command array) before being taken.

## Not in scope

No server-side awareness of any of it — the server cannot tell a triggered command
from a typed one, and nothing here proposes it should. No trigger on anything but
a printed line (no "on HP below X", which is what a timer plus a condition already
is). No sharing or export of trigger sets. No multi-line triggers, and no matching
on colour. No continuous logging to disk (see The transcript for why).
