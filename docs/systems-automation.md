# Client Automation — triggers, timers, aliases, variables (as built)

*Built 2026-08-15.* The automation half of a MUD client, and the four things
[systems-macros.md](systems-macros.md) could not do. Entirely client-side: nothing
here reaches the server except the same commands the player could have typed.

| Verb | What it is |
| --- | --- |
| `trigger` | a line arrived matching a pattern → run a script, and/or `gag` it. Optional `@channel`, `#group`, `once`, `Nln` |
| `alias` | the player typed something matching a pattern → rewrite it |
| `timer` | an interval elapsed → run a script (repeating, or `after` for once) |
| `on` | a **vitals condition** became true → run a script |
| `vars` | read/write the variables a script stores |

Plus `wait for <pattern>` inside a macro script — see below.

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

## Following the account

Macros got this first (`player_macros`); everything else the client stores had the
same problem — set up your triggers, log in on a laptop, and they are all gone.
`player_client_config` is the general version: one row per player per **config
key**, each holding a whole JSONB document. Keys today: `triggers`, `aliases`,
`timers`, `state_rules`, `highlights`, `vars`.

Keyed rather than a column per feature, because the set of things a client stores
keeps growing and a column each means a schema change every time. Whole-document
per key rather than a row per trigger, for the same reason macros are one row: the
client edits these as lists, and per-item rows would buy conflict resolution
nobody asked for at the cost of syncing deletes and order.

**`player_macros` is deliberately not migrated onto it.** That table is deployed
and working; moving it would be churn against live rows for no behaviour a player
can see. `configsync.js` presents both through one interface, so the split stops
at `schema.js`.

⚠ **The conflict rule lives in `configsync.js` once.** Six stores each
implementing last-writer-wins is six chances to get the empty-list case wrong, and
getting it wrong silently resurrects things the player deleted. Nothing outside
that file compares a stamp. Three arrival states per key:

| Server state | Action |
| --- | --- |
| no row (stamp 0) | push what is local — the **migration** case |
| row, local stamp newer | push — an offline edit is not garbage |
| row, otherwise | **adopt, including an empty list** |

⚠ **The test is the stamp, never the payload's length**, exactly as for macros. An
empty list from a server that *has* a row is a deletion.

⚠ **`replace` writes the raw store and never goes through the save helper.**
Calling the helper would mark the key dirty and push the server's own list
straight back at it — a write on every login, and a stamp that moves for no edit.

⚠ **The transport is injected** (`setConfigTransport`), not imported. `net.js`
imports `/shared/ws.js`, a browser-absolute path Node cannot resolve, so importing
it here would take every module that touches config out of the smoke's reach.

Server-side the keys are an **allowlist** (`CLIENT_CONFIG_KEYS` in
`server/index.js`); without it this is per-player blob storage anybody with a
console can write anything into. Pushes over 64 KB are refused silently — the
local copy still works, only the sync declines.

**Not synced, deliberately**: the smartbar's drag order (a layout preference for
one screen, covering buttons that are not macros) and everything in
`client/shared/settings.js` (volume, theme, density — a phone and a desktop should
not agree about volume).

*Note: `variables.js` originally documented the opposite decision for `vars` — that
a counter should stay per-machine. That is reversed here on purpose, and the file
says why: under last-writer-wins nobody "fights", the loser is a counter reset,
and half a player's setup following them is the confusing outcome.*

## Multi-line triggers

`trigger 3ln /the door opens.+inside/ = look`. The row's `lines` is how many
recent lines are joined with newlines and handed to the pattern.

- Regexes on multi-line rows compile with **dotAll**, so `.` spans the joins.
  Without it every such pattern would have to be written with `[\s\S]`, which is
  how people conclude a feature does not work.
- ⚠ **Each row remembers the sequence number it last matched at** and will not
  fire again until the window has moved past it. Without that, a three-line
  pattern matches on the line that completes it *and* on the next two lines that
  still contain it — three fires for one event. The cooldown masks this at normal
  speed and not during a burst, which is the worst kind of half-working.
- ⚠ **The channel is tested against the last line in the window**, the one that
  just arrived. Requiring every line to share a channel would make `@say`
  multi-line patterns impossible the moment anything interleaved.
- ⚠ **A multi-line gag hides only the completing line.** The earlier ones are
  already mounted and the suppression seam decides before mounting; hiding some of
  them some of the time would be worse than the honest single line.

## Groups and one-shots

`trigger #combat you are hit = flee` puts a rule in a group; `trigger off #combat`
switches the whole set off and `trigger on #combat` brings it back. This is the
middle unit the surface was missing — before it the only choices were one row and
every row, and anybody with twenty rules wants to switch a set.

⚠ **A group switch DISABLES; it never deletes** — unlike `off <pattern>`, which
removes. Deleting is a reasonable reading of "off" for a thing you just named in
full and a terrible one for a set of eleven rules you cannot see.

`trigger once <pattern> = …` fires and retires. ⚠ It removes itself from the
**store**, same rule as a one-shot timer: one that survived would come back on the
next reload and fire on a line nobody connected to it.

Group membership is **not** part of a rule's identity (channel and pattern are), so
regrouping an existing rule moves it rather than leaving a duplicate behind under
the old name. `once` and `Nln` are word-flags rather than more sigils — there are
already two prefix characters, and a third and fourth would turn the front of
every rule into punctuation nobody can read back.

## State triggers — `on hp_pct < 30 = drink stim`

The condition is an ordinary macro expression (`expr.js`), evaluated against the
live player whenever vitals change. `updateVitals` in `render.js` is the single
funnel every `player_update` in dispatch goes through, so that is the seam
(`setStateObserver`, the sibling of `setLineObserver`).

**This is a separate feature rather than a trigger with a clever pattern, and the
reason is the point.** On a traditional MUD you get this by regex-matching a
prompt line, because a prompt is all a third-party client is given. Here the
vitals arrive as structured data. Reading numbers instead of scraping them is the
whole advantage of owning both ends.

⚠ **EDGE-TRIGGERED, NOT LEVEL-TRIGGERED.** It fires on the transition from false
to true and will not fire again until the condition has gone false in between.
Level-triggered would fire `drink stim` on every vitals update for as long as you
stayed under 30 — which is every swing of a fight, and is the difference between a
useful feature and an automatic way to drink your entire inventory.

The armed-state map is **cleared whenever the rules change**, so an edited rule
starts disarmed rather than inheriting the old one's idea of having already fired.
Conditions are checked with `isWellFormed` at authoring time: one that cannot parse
would silently never fire, which the player cannot tell from one that simply has
not happened yet.

## Channel matching — the local answer to colour triggers

`trigger @loot pipe = take pipe`. A leading `@channel` scopes a trigger (or alias)
to one message class; an empty pattern with a channel matches every line on it.

Other clients have **colour triggers** because ANSI colour is the only structured
signal a third-party client gets — it is a workaround for not knowing what the
server meant. This client has no ANSI and never will. It has ~30 semantic classes
(`msg-combat-incoming`, `msg-loot`, `msg-say`, `msg-death`), which is the thing
colour is a lossy proxy *for*. Note that `msg-combat` and `msg-combat-incoming` are
separate: a colour trigger would be guessing at "was this aimed at me", and this
knows.

**Colour triggers are therefore deliberately never coming.** Shipping a worse
duplicate of a mechanism we already have would be the mistake.

⚠ `@` leads because it is not a regex metacharacter and effectively never starts a
line of game prose — unlike `:`, the obvious separator, which appears in half the
room descriptions in the game (`You see: a rusted pipe`). An `@` in the *middle* of
a pattern is not a channel.

Row identity is the channel **and** the pattern, so `@say hello` and `@tell hello`
are two rules rather than one replacing the other.

## `wait for` — the primitive that makes scripts programs

```
attack enforcer
wait for /^(\w+) collapses/ 30s
loot $1
```

Without it a script can only fire commands and hope; it cannot say "swing, and
when the thing dies, loot it". That is most of what people reach for a real
scripting language to do, and it needs no scripting language — only somewhere for
a running script to park.

`linewait.js` is standalone and import-free: `automation.js` **feeds** it (it owns
the line observer) and `smartbar-macros.js` **awaits** it (it owns the runner), and
automation already imports the runner — so putting the registry in either would
close a cycle.

- ⚠ **A wait always has a timeout** (10 s default, 120 s cap) and there is no way
  to ask for one without. A script parked forever is indistinguishable from the
  client having hung, and `stop` cannot reach a runner that is not on a step
  boundary. `stop` also wakes every parked script with a miss — one left waiting
  fires its next command minutes later into a completely different situation.
- ⚠ **`offerLine` iterates a COPY of the waiter list.** A waiter's `resolve`
  removes it, and the continuation it wakes can register a new waiter
  synchronously — mutating the array being walked silently skips the next waiter
  in it. The smoke asserts this case.
- **Every waiter whose test matches is woken**, not just the first: two scripts
  waiting on "the door opens" are both waiting on it.
- Captures bind into the **rest of the script** through the same `applyCaptures` a
  trigger uses. A miss leaves `$result` empty, so a script can branch on whether it
  landed.
- **Parked scripts are woken before triggers are considered**, unconditionally: a
  wait is not a trigger, has no budget or cooldown, and waiting on the result of a
  command a trigger just fired is the ordinary case.
- It **costs a step and is paced like a delay**, so a `while` whose body is one
  `wait for` cannot spin.

## One-shot timers

`timer after 30s = look`. Half of what people want a timer for is "do this once,
in a minute"; a repeating timer used that way has to be remembered and turned off,
and it never is.

⚠ **A one-shot retires itself from the STORE when it fires**, not merely from the
schedule. One that survived in the list would come back on the next reload and
fire again half an hour later with nothing to explain it — the behaviour of a bug,
not a timer.

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
is — and `on` now covers the vitals half properly). No sharing or export of trigger
sets. **No colour triggers, ever** — see Channel matching:
we have the thing colour approximates, and a worse duplicate of it would be the
mistake. No continuous logging to disk (see The transcript for why).
