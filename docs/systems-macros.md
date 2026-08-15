# Smartbar Macros (as built)

Player-defined **macro buttons** on the game smartbar. A macro is a labelled
button bound to a saved command script — one command, a `;`-chained sequence, or a
small program with pauses, local echoes, live player values, and `if/else`
branching. Macros can call each other, and each can claim a key. All the *logic*
is client-side — nothing here touches the server beyond firing the same real
commands the player could type — but since 2026-08-15 the **list follows the
account** rather than the browser (see Storage model).

Owned by `client/game/js/panels/smartbar-macros.js`, rendered onto the bar by
`client/game/js/panels/smartbar.js`. Styling is `.smart-btn-macro` /
`.smart-macro-*` / `.smart-guide-*` in `client/game/styles.css`.

## Where it lives on the bar

The smartbar reads (left → right):

```
[＋]  [Tablet] [Inv]  ‹macro buttons›  ‹room context verbs›
```

- `＋` — a pinned add-chip (far left, `smart-btn-accent`) that opens the macro
  manager.
- Macro buttons are spliced in **after** the leading Tablet/Inv anchor run, each
  in its own colour (default cyan `#2ee6ff`, matching the `.smart-btn-macro` CSS
  default). Tapping one runs its script.
- **Drag-to-reorder** — long-press (~350 ms) lifts any button, drag repositions,
  drop persists a `architect_smartbar_order` key list that overrides all default
  positions. New/unknown buttons trail in natural order.

## Storage model

`localStorage` key `architect_smartbar_macros`, an array of
`{ id, label, cmds, color, key }` (mirrors the `custom/store.js` preference pattern).
`cmds` is the raw `;`/newline-separated script string.

### Following the account *(built 2026-08-15)*

Macros used to be per-browser only, so logging in on a phone or a second machine
lost the whole bar. They now sync through `player_macros` — **one row per player
holding the whole list**, not one row per macro, because the client has always
treated it as a list (it is reorderable, and macros call each other by label) and
per-macro rows would buy conflict resolution nobody asked for at the price of
syncing deletes and order. Deliberately **not** `player_flags`: flags hydrate into
an in-memory map that condition evaluation and hot paths read, and a few KB of
macro script per player is noise in there.

**`localStorage` is still the working copy** and every call site still reads it —
it is synchronous, the bar renders instantly on load, and macros keep working with
no connection. The server is a backing store the UI never waits on, and it never
parses or runs a macro; it stores strings.

Two ws routes: `macros_pull` (requested on `auth_success`, beside `verbs`) and
`macros_push` (debounced 800 ms, since the manager saves on every field commit).
The push is bounded at 100 macros / 64 KB and refused **silently** past that —
the local copy is intact and still works, only the sync is declined.

Conflict resolution is **last-writer-wins on the whole list**, arbitrated on the
client by comparing the server's `updated_at` against a local
`architect_smartbar_macros_at` stamp written on every local save. Server-always-
wins was the alternative and it silently destroys work done on a machine that was
offline — a worse failure than the one this fixes.

- ⚠ **The arrival test is the STAMP, never `remote.length`.** An empty list from a
  server that *has* a row is a real state — somebody deleted their macros on
  another device — and reading empty as "nothing up there yet" pushes the local
  copy back and resurrects every macro they just deleted, on every login, forever.
  Only stamp `0` means never-synced, which is the **migration** path: everybody
  using macros today has them in a browser only, and must not have to re-enter
  them.
- **Adopting does not re-push**, and stamps the local copy with the *server's*
  time. Stamping an adoption with `now` would make every login look like a local
  edit and let a stale device win the next comparison.
- ⚠ Two browsers open at once will clobber each other on the next edit. A
  deliberate ceiling, not an oversight: the alternative is a merge UI for a
  feature whose whole point is that you press a button.

**The smartbar's drag order (`architect_smartbar_order`) stays per-browser.** It
covers every button on the bar, not just macros — Tablet, Inv, room context verbs
— so it is a layout preference for a screen, not part of the macro list.

## Related

Macros are the *script*; [systems-automation.md](systems-automation.md) is what
else can start one — triggers, timers and input aliases, plus the `set`/`unset`
variables the language gained at the same time. Everything there ends at
`runMacro()` here rather than growing a runner of its own.

## The script language

A script is split into **segments** on newline or `;`. Segments run top to bottom
with a short default stagger (`350 ms`) between real commands so movement chains
resolve room-by-room.

| Form | Meaning |
| --- | --- |
| `<command>` | Any real command — routed exactly as if typed in the command box |
| `delay <ms>` | Pause the macro for N milliseconds |
| `echo <text>` | Print a line **only you see** (local, never sent to the server) |
| `$value` | Interpolate a live player number/text into command or echo text |
| `if / elseif / else / endif` | Single-line conditional blocks, nestable |
| `while / endwhile` | Loop the body while the condition holds (re-tested each pass), nestable |
| `macro <name> [args…]` | Run another saved macro by its label; arguments bind `$1`–`$9` inside it |
| `set <name> <expr>` / `unset <name>` | Store / forget a user variable |
| `return [expr]` | End this macro, leaving the value in `$result` |
| `break` / `continue` | Leave / restart the innermost `while` |

### Expressions *(built 2026-08-15)*

Conditions and `set` values are **expressions**, evaluated by
[expr.js](../client/game/js/expr.js) — a small recursive-descent parser that is
pure by construction (no imports, no DOM, the world arrives through a resolver),
so the whole grammar is covered headlessly in
[automation-smoke.mjs](../scripts/client/automation-smoke.mjs).

It replaced `CMP_RE`, one regex matching exactly one shape — `<name> <op>
<number>`. **Every limit of the old grammar came from that line**: no boolean
operators at all, so `if $hp_pct < 30 and has bandage` was literally unwritable;
and a *number* on the right, so no trigger capture could ever be branched on,
because every capture is a string.

Operators, lowest precedence first: `or` · `and` · `not` · comparisons
(`< <= > >= == = != <>`, plus `contains` / `starts` / `ends`) · `+ -` · `* /` ·
unary `-` · `has` / `lacks` / `in` / `notin` · `( )`. Functions: `lower upper trim
len word num round abs min max`.

Four rules that are decisions, not mechanics:

- **A bare word is a variable if one exists, and otherwise its own text.** That is
  what makes `if $zone == bishops` work without anyone learning when to quote. The
  cost is that a mistyped name compares as a string rather than erroring — the
  same trade every shell makes, and the right one for a language typed into a
  textarea. A `$`-forced name that is unset resolves to `''`, never to its own
  text, so `$nothing == ""` is true.
- **Comparison is numeric when both sides look numeric, otherwise
  case-insensitive string.** Everything else in this DSL is already
  case-insensitive; a comparison that suddenly wasn't would be the surprise.
- **`+` concatenates when either side is not a number.** Two operators would be
  more correct and would mean explaining to a player which one they wanted.
- ⚠ **A malformed expression is `null` → the condition is FALSE. It never
  throws.** This is evaluated from inside the log's append path (a trigger's
  condition) and from inside a loop; an exception in either is far worse than a
  branch not being taken. It is also exactly what the old `parseCond` did by
  returning null, and that behaviour is load-bearing for every macro already
  written.

⚠ **The four legacy prefix forms are matched FIRST and deliberately kept** —
`has field bandage`, `lacks …`, `in <zone>`, `notin <zone>`, `in home`. Their
arguments are unquoted and may contain spaces, which an expression grammar cannot
read unambiguously. Inside an expression the same operators exist but take one
bare word or a quoted string. **Nothing already written changes meaning**, and the
smoke asserts the old numeric shapes still evaluate identically.

⚠ **`evalValue` returns the ORIGINAL text when the expression is malformed**, which
is what makes `set name Marsh Devlin` store the words. Most `set` values are prose,
not arithmetic.

⚠ **The Check button validates conditions with `isWellFormed`, not "did parseCond
return something".** Since `parseCond` now returns an expression node for anything
it doesn't recognise as a prefix form, the old check stopped meaning anything — a
typo'd condition would pass Check and then silently never fire, which is the worst
thing a validator can do.

### Arguments and return

`macro heal 40` binds `$1` inside the callee — the same `$1`–`$9` a trigger
capture binds, through the same `applyCaptures`, because a macro taking an
argument and a trigger handing one over are the same act and would be baffling to
have to write two ways. `$0` is every argument joined.

⚠ **Arguments are substituted into the callee's script text before it runs**, not
pushed as a scope. Same reasoning as trigger captures: runs are async and
interleave, and a module-level "current arguments" that a second call made during
a `delay` could overwrite shows up as one macro acting on another's arguments.

The macro **name is matched greedily from the left**, so a macro called `go home`
is still callable and whatever is left over becomes the arguments.

`$result` is module-level, not a user variable: it is per-call, and persisting it
to `localStorage` would make a macro's return value survive a browser restart,
which is nobody's mental model of a return value.

### Client-only verbs work

Each command line is first offered to `input.js` `handleClientCommand` before
falling through to the server, so browser-side verbs (`auto`, `stop`, `music`, …)
work inside a macro instead of erroring server-side as "unknown".

### `$values`

`$`-prefixed (or bare, inside a condition) tokens resolve from live
`state.player` vitals: `$hp`, `$hp_max`, `$hp_pct`, `$stamina`/`$sta`,
`$stamina_pct`, `$sanity`, `$sanity_pct`, `$hunger`, `$thirst`,
`$radiation`/`$rad`, `$credits`, `$horniness`, `$body_temp`. Plus `$zone` (current
room name) / `$zone_id`, and `$home` (a friendly label for the bound home zone) /
`$home_id` (its raw zone id). Numeric vitals round to an integer when interpolated
into text.

> The client only holds the home **id** (`state.player.home_zone`), so `$home`
> derives a readable label from it (`zone_apt_6` → `apt 6`) — good for `echo`, not
> a precise destination. To *travel* home, use the `home` verb (below), which
> pathfinds by id server-side; don't try `gps $home` (GPS matches zone names, not
> ids).

### Conditions

An `if`/`elseif` condition is one of:

- **Comparison** — `<value> <op> <number>`, ops `< <= > >= == !=`
  (e.g. `if $hp_pct < 50`).
- **Inventory** — `has <item>` / `lacks <item>`. Matches by item **type** id
  (e.g. `item_field_bandage`) or a substring of the display name — a "do I have
  any of this" test, never keyed on a stack instance. A macro that branches on
  inventory silently pulls a fresh inventory copy **once per run** before
  evaluating, so `has`/`lacks` are reliable even if the player never opened Gear.
- **Zone** — `in <zone>` / `notin <zone>`. Matches the token against **both** the
  zone id (`state.currentZone`) and the room's display name, so either works.
- **Home** — `in home` / `notin home`. A dedicated test (not a name/id substring
  match) that's true when the current zone equals the player's bound home
  (`state.player.home_zone`). False when no home is set.

Blocks nest. `endif` is required for every `if`.

### Loops (`while` / `endwhile`)

`while <cond>` … `endwhile` repeats the body as long as the condition holds; the
condition is re-evaluated at the top of every pass and uses the exact same
condition grammar as `if`. Blocks nest (with each other and with `if`), and
`endwhile` is required for every `while`.

```
gps clone facility
delay 500
auto on
while notin clone facility
  delay 1500
endwhile
drink sink
```

Use **`auto on`** (not bare `auto`) in a macro: `auto` is a *toggle*, so its effect
depends on whether auto-walk was already armed — and it stays armed after arriving
at a waypoint until an explicit stop or reload, so a scripted `auto` can silently
turn walking *off*. `auto on` / `auto off` are the deterministic engage/disengage
forms. The `delay 500` after `gps` lets the plotted route reach the client before
`auto on` reads it (`gps` is a server round-trip).

**Runaway guard.** An unbounded loop is exactly what `MAX_STEPS` (1000 executed
actions per run) exists to catch. Every pass into a `while` body costs one step
against that budget on top of the commands it runs, so a loop that never
satisfies its exit condition aborts with the same "too many steps (possible
loop)" notice rather than hanging the browser.

**Auto-pacing guard (`MIN_LOOP_INTERVAL_MS`, 1 s).** The condition is evaluated
purely client-side (it reads state the server already pushed), so *polling costs
the server nothing* — the load is only whatever real commands the body fires, and
there is no server-side command rate limit. To stop a body that forgot to pace
itself from trickle-spamming, **any pass that ran no `delay` of its own is forced
to pause ~1 s before looping back.** A pass counts as paced if a `delay` executed
anywhere inside it (including in a nested loop), so an author who adds their own
`delay` keeps full control of the cadence and never sees the implicit pause. The
guard also stops an empty-body loop from busy-spinning through its whole step
budget in one synchronous burst — it now yields ~once a second, giving the
server-pushed state time to change so the exit condition can actually flip.

Still, prefer client-only movement (`auto on`) plus an explicit `delay` over
re-issuing a server command (`look`) that doesn't advance the exit condition — as
in the worked example above.

**Server-side backstop.** The client guards above are advisory — they live in the
browser and a modified client could ignore them. The authoritative protection is
a per-connection **command rate limit** on the server (`commandAllowed` in
`server/index.js`): a token bucket, **capacity 15, refill 5/sec**, which clears
every legitimate source (macros run at ~2.9 cmd/s behind the 350 ms stagger; a
person bursts to ~8–10/s in combat) while dropping a runaway's excess. Over-limit
commands are dropped, not queued, and the player gets a throttled `code:
"rate_limit"` error. The client's `error` handler reacts to that code by calling
`abortMacros()`, so a loop that outran the throttle stops itself instead of
grinding on. Note the bucket only sees real `command` messages — client-only
verbs (`auto`, `stop`, …) never reach the server, so a loop of purely client-side
verbs is bounded by the client pacing guard + `MAX_STEPS`, not the bucket.

### Stopping a running macro

A macro run can be halted mid-flight:

- While any macro is running, a red **"■ Stop"** chip is pinned to the left of the
  smartbar (`smart-btn-macro-stop`), shown only when there's something to stop —
  the discoverable escape hatch. Tapping it calls `abortMacros()`.
- The **`stop`** verb aborts running macros too (and still cancels auto-walk);
  only when neither is active does it fall through to the server's unified stop.
- `abortMacros()` sets the shared `aborted` flag every run checks at the top of
  each segment, so a run parked in a long `delay` unwinds once that sleep resolves.

The manager's **Check & Fix** also emits a non-blocking **lint** (`lintMacro`):
a `while` whose body has no `delay` of its own gets an amber advisory pointing at
the auto-pacing guard, teaching the author to set their own cadence — it never
blocks Save (only structural errors from `validateMacro` do).

### The `home` verb

The engine's `home` command (pinch plugin) is the robust way to travel: standing
in an apartment you own it **binds** that unit as home; anywhere else it
**auto-walks** you home by server-side pathfinding. Home is persisted on
`players.home_zone` and owned units live in the `apartments` table
(`owner_id`). See [systems-economy.md](systems-economy.md) for the housing side.

## Running macros

- **Tap the button**, or
- **Press its bound key** (see below), or
- **Type `macro <name>`** in the command box (case-insensitive label lookup), or
- **Call `macro <name>` from inside another macro**.

### Key bindings *(built 2026-08-15)*

A macro can claim one key: **F1–F9 or a numpad digit**, chosen in the manager and stored as `key` on
the macro (an `e.code` string — `F3`, `Numpad7`). `runMacroByKey()` fires it. A combat macro you have
to move a mouse to click is not a combat macro.

The listener lives in `input.js`, separate from the auto-focus one, because its guards differ in
**both** directions: a macro key **should** fire while the caret is in the command box — that is the
point, you are typing and you hit F3 — and must **not** fire while a panel owns the keyboard (flight
sim, cockpit HUD, hangar walk, truck depot, cab, piano — the same predicate list auto-focus checks).

Three decisions worth keeping:

- ⚠ **F10/F11/F12 are deliberately not offered.** The browser owns them (menu, fullscreen, devtools)
  and `preventDefault` does not reliably win, so binding one produces a macro that fires *sometimes*,
  which is worse than a key that isn't on the list.
- ⚠ **A Numpad code with a multi-character `e.key` is ignored.** With NumLock off the numpad sends
  `Numpad4` for ArrowLeft and `Numpad1` for End; honouring those fires a macro when somebody meant to
  move the caret.
- **One key, one macro.** Claiming a bound key releases it from whoever had it, rather than leaving
  two macros on F3 and letting load order decide. The manager shows the current holder's name beside
  a taken key instead of hiding the option — a missing option reads as a bug, and rebinding is a
  normal thing to want.

`preventDefault` fires only when a macro actually ran, so an unbound F-key still does whatever the
browser does with it.

A top-level run prints a start/finish banner tinted in the macro's own colour;
nested calls stay quiet.

### Loop & runaway guards

Nested macro calls carry a shared run context `{ depth, stack:[macroId…],
shared:{ steps, aborted } }`:

- **Cycle detection** — the stack of macro ids catches a macro that ends up
  calling itself (directly or through a chain); the whole run aborts with a
  notice.
- **`MAX_DEPTH = 20`** — deepest macro-calls-macro nesting.
- **`MAX_STEPS = 1000`** — total executed actions across one run; exceeding it
  aborts as a suspected loop.

## The editor

The manager modal (`openMacroManager`) lists existing macros (click to edit, ✕ to
delete) and a create/edit form: **Label**, **Commands** (textarea), and a
**Colour** wheel with quick-pick swatches (stock accent colours first, then
colours already used on other macros).

- **Check & Fix** — `autoFix()` applies safe, mechanical corrections (normalise to
  one segment per line, lowercase leading keywords, `else if`/`elif` → `elseif`,
  `=<`→`<=` / `=>`→`>=` on condition lines, append a missing `endif`, re-indent
  nested blocks) then runs `validateMacro()` (static structure check). `runCheck`
  applies the formatting **on open as well as on click** — regardless of whether any
  keyword/operator fixes were found — so existing macros display tidy the moment the
  editor opens and reformat on every click (the on-open pass is silent; the click
  pass reports what it fixed). A macro must pass before **Add/Save** unlocks; any
  subsequent edit re-locks it.
- **📖 Guide** — a layered reference window with five tabs, all read from what the
  client already holds; clicking any row inserts it into the commands box:
  - **Overview** — plain-language tour of every feature.
  - **Values** — every `$value` with its **current live reading**.
  - **Furniture** — the interactable furniture in your current room (from the room
    DOM `data-actions`), updates as you move.
  - **Items** — your live inventory as `has <id>` conditions and per-item action
    verbs.
  - **Commands** — a client-side quick reference of common verbs (admins get a
    pointer to the `@admin` panel for role-filtered admin verbs).

## Regress footprint

The macro language itself is **client-only** — nothing wires into the server
dispatch pipeline or plugin registries, so those parts are outside the
`npm run test:regress` gate. The custom sidebar panels use the same
localStorage-store pattern, in `client/game/js/panels/custom/store.js` — worth reading beside
this if you are adding a third client-only store.

The one server-side piece is the command **rate limit** in
`handleGameCommand` (`server/index.js`). It's an additive guard on the WebSocket
`command` entry and doesn't touch `handleCommand`, which is what the regress
suite drives directly — so the suite doesn't exercise it, and it doesn't affect
the suite. Still run `npm run test:regress` after touching that entry point (the
CLAUDE.md rule for the command path); it stays green.
