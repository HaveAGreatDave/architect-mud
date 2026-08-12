# Display Mode — the three-rung ladder (as built)

One ordered player preference covering every system that ships a graphical
presentation **and** a written one for the same thing. Tablet → Settings → General,
or the verb `displaymode visual|text|log`.

Lives in [server/engine/presentation.js](../server/engine/presentation.js). Stored as
the `display_mode` player flag.

## The rungs

| Rung | Minigames | Info panels | Who it's for |
|---|---|---|---|
| `visual` *(default)* | graphical | graphical | today's player |
| `textgames` | live character-drawn panels — real-time, reflex intact | still graphical | anyone who wants out of the graphical layer without giving up the games |
| `log` | text | written to the scrolling log | screen-reader players; anyone wanting a greppable transcript |

**The middle rung is not a downgrade and must never be built as one.** A text
minigame is a live, timed, character-drawn *equivalent* — same clock, same
difficulty curve, same win condition. [textcockpit.js](../client/game/js/panels/textcockpit.js)
is the worked example, and its own header puts it best: *"Deliberately NOT a
downgraded glass cockpit… it should read like an instrument panel someone built out
of a terminal."*

**Two rungs, two audiences, and conflating them ruins both.** `textgames` is for
players who *want* text — a character board repainting at frame rate is emphatically
not screen-reader friendly, and that's fine. `log` is for players who *need* a
screen reader: append-only, paced for a human, no modals.

## The two predicates

They deliberately share no words, so a call site cannot read as the wrong axis —
there is no `prefersTextPanels`, so a typo is a crash rather than a wrong answer.

```js
prefersTextMinigames(player)   // true at textgames AND log
prefersLoggedPanels(player)    // true at log only
```

Pick one by asking: **"if I delete this surface, is the player STUCK?"**
Yes → minigame. No → panel. A composite surface (the poker felt both shows the board
*and* is how you bet) is classified by its blocking half and ignores the panel rung.

Worked examples, both from flight, because it contains one of each:

- **Riding** as a passenger is a *panel*. Delete the cabin window and you are not
  stuck, just bored — so it survives to the bottom rung.
- **Flying** is a *minigame*. Delete the cockpit and the aircraft is unusable — so
  the text cockpit arrives one rung earlier.

A `textgames` player therefore flies by command **and keeps the view when they're
only a passenger**. That is the entire justification for the middle rung existing.

## Tri-state — keep the fourth state

`undefined` (never chosen) is a real answer and is **not** the same as `visual`.
Poker's `config.textTable` opens an old-school felt called-aloud for a player who
has never expressed a view, and can only do that if it can tell the difference.

## ⚠ The migration trap

Before the ladder, `display_mode='text'` meant what `log` means now: a text poker
player got the pane handed back to the room and everything narrated, and a text
passenger got no panel at all.

**So the middle rung is stored as `textgames`, never `text`.** If it reused the
word, every existing text player would be silently promoted a rung on deploy and
start receiving panels they had turned off. `'text'` still parses, and it still
means the bottom rung — including when typed at the verb, because a player who
types the word they have always typed must land where they have always landed.

### The legacy flags do NOT promote anybody

`flight_text_only` and `poker_text_mode` are **not consulted when deciding a rung.**

They used to be, and it was wrong. A player who had set either one landed on `log`
— the most aggressive rung, which strips *every* panel in the game. That is far
more than either flag ever meant: one turned off a cabin window, the other called a
card game out loud. Nobody consented to losing their map, their hangar and their
television by once ticking "text poker".

So a legacy-flagged player reads as **never chosen** and lands on `visual`. Two
things follow, both deliberate:

- **Nothing changes for them on deploy.** They opt in fresh from Settings.
- Reading as never-chosen rather than as an explicit `visual` **keeps poker's
  `config.textTable` alive for them** — an old-school felt still opens
  called-aloud, which is the closest thing to their original intent that costs them
  nothing.

The cost, stated plainly: somebody who deliberately turned graphics off gets them
back. That is why login tells them once, with the way back in the same breath
(`noticeLegacyDisplayChoice`, a one-shot flag, not a per-login nag). **Reverting
somebody's accessibility choice in silence is the thing not to do** — and if the
flag were simply deleted there would be nothing left to tell them with, which is
why it stays readable.

Nothing writes those flags. No data migration was needed.

## Falling back

**A rung with no implementation falls back to the rung ABOVE it**, never to
"nothing happens". Flight already did this by accident: `startTextPilot` returning
false (no physics profile for that airframe) drops the player back into the 3D sim.

## Cost, and the tick rule

`player_flags` is hydrated at login, so the predicates are awaited but are **not**
round trips. Safe on a board/sit/look path.

**Never call one from a tick.** Latch it at an entry moment the way flight latches
`player.textTravel` at boarding. The rung itself is latched onto the live player at
login (`hydrateDisplayRung`, called from `finishAuth`), and `loggedPanelsSync` /
`textMinigamesSync` read that latch for paths that genuinely cannot await.

## The `log` rung and the two panes

The client has an area pane that is **replaced wholesale** (`setAreaPane` sets
`innerHTML`) and a log that is **appended to**. Append-only is the shape assistive
tech wants; wholesale replacement is the shape it cannot follow. So:

- `#output` carries `role="log"` — polite announcement of additions only. It must be
  the only **continuous** live region: a second one that chatters interleaves with it
  and the listener can't tell which is speaking.

  *(This started life as a blanket "exactly one live region" and that was too strong.
  Writing the check found a second one — the tablet TV's channel readout — which is a
  perfectly legitimate pattern: one token, announced only when the player presses
  CH▲/▼, never continuous. The accurate rule is the one above, and
  `scripts/a11y/smoke.mjs` enforces it with an explicit justified-exceptions list so
  the next one is a decision rather than an accident.)*
- At the `log` rung **the pane goes away entirely** — `setPaneSilent` sets
  `aria-hidden` *and* puts a `log-rung` class on `#output-container` that collapses
  `#area-pane` and its resize handle. The log takes the whole window. Everything the
  pane would have shown already reaches `#output` at this rung, so the pane is a
  duplicate of what you just read; one chronological stream is the entire point.

  ⚠ **`setPaneSilent(true)` is only safe when the pane is free.** The text cockpit and
  all five character minigame boards mount in that same pane, so an unguarded hide
  would black out a pilot's instruments or a breach board mid-run. `dispatch.js` gates
  both call sites on `paneFreeForRoom()`, which is also what decides whether to paint
  the room at all — one predicate, two questions, so they cannot drift apart.

  The pane must never become a live region instead: it would re-read the whole thing
  on every move.

**The room description reaches the log at this rung.** A look normally goes to the
pane and never touches `#output`, so a player reading through the log alone would
walk from room to room hearing nothing about where they are. `server/index.js`
stamps `toLog` on outbound `look`/`move` payloads — one site, because the
description is built at half a dozen places (movement.js, world.js, the login look,
gametable's `paneOrLook`) and there is no single constructor to hook. The client
then appends it as well.

### ⚠ A pressed radio is an instruction; a remembered one is a seed

The auth screen's Display Mode choice was applied through `seedDisplayRungIfUnset`
— **never clobber**, so a library computer can't reset the rung you set on your
phone. Correct for the radio the screen *restored*, and wrong for one the player
just *pressed*: every account that has ever opened Settings has a stored rung, so
choosing `log` at the door did nothing at all for anybody but a brand-new
character. You pressed it, logged in, and got the graphical game with nothing to
tell you why.

So the client now says which it is. `watchDisplayRungChoice()` (net.js) sets a
flag when a radio actually fires a `change` in this visit, and that rides the auth
message as `displayRungExplicit`. `finishAuth` writes an explicit rung straight
through with `setDisplayRung` (validated against `RUNGS` first — `setDisplayRung`
coerces junk to `visual`, so an unchecked path would let a malformed message reset
somebody's accessibility choice); everything else stays seed-only. **Auto-login
with saved credentials never sends it** — nobody pressed anything.

### Arrival lines — walking is not reading

**A move logs where you are and what can hurt you. Nothing else.**
`arrivalRoom()` keeps `zone-name`, `light-level`, the ☢/safe/death warnings and
the enemies rows, and drops everything else — including the exits, the people and
the `Also here:` tally that a *brief* keeps. An explicit `look` is still always
full, so the contract is the same one, applied harder: **nothing is lost, only
deferred by one keystroke.**

The first-arrival exception is **gone**, and `markSeenZone`/`_logSeenZones` with
it. It existed because a move used to be a description; now a move is a line and
a description is something you ask for — and the room you have never seen is
precisely the room you would type `look` in.

`briefRoom` stays, as the fallback: an arrival that recognises nothing falls back
**up** a level (arrival → brief → full), which is the same rule the rungs
themselves follow, so a `describeZone` change can make an arrival too talkative
but never silent.

### Brief rooms — and the one property that makes them safe

Appending the full room on every move makes walking six rooms six paragraphs *read
aloud*. So the log copy of a room is abbreviated, by
[`server/engine/room-brief.js`](../server/engine/room-brief.js), and the rule is the
classic MUD `brief` contract:

> **Nothing is ever lost, only deferred by one keystroke.**

- An explicit `look` is **always** full. Always. This is what makes the whole thing
  safe rather than lossy — if `look` ever goes terse, information is genuinely gone.
- Your **first arrival** at a room is full: you have never read that prose, so
  abbreviating it would be hiding content rather than repeating it. Tracked in a
  `Set` on the live player object — per-session by design, so it costs no column, no
  flag and no query on the every-move path.
- Every arrival after that is brief.

#### Three tiers, not two

The first version kept **everything dynamic** and a brief still ran to eight or nine
lines. Read aloud, walking a street was still a wall of speech, and the two things
that matter — where you are and what can hurt you — were somewhere in the middle of
it. So a brief has three tiers:

| Tier | What | Example |
|---|---|---|
| **VITAL** | printed | zone name, light level, ☢/safe/death warnings, players, NPCs, enemies, exits |
| **TALLY** | *named*, not listed | items, corpses, vendors, furniture, buildings, sub-rooms → one closing `Also here: items, furniture.` |
| **DROP** | gone | the prose paragraph, the woven-furniture beat, `Installed:`, ambient flavour |

The split between the top two tiers is one question: **can this hurt you, or make
you decide something, between one step and the next?** An enemy can. A dumpster
cannot — you go looking for a dumpster.

⚠ **The TALLY tier is what keeps the contract honest.** Collapsing contents to a
label would be a DROP, and a `log`-rung player would walk over loot they were never
told existed. It is not "furniture is unimportant", it is "furniture is one keystroke
away and `look` is still always full". If you ever delete the `Also here:` line, you
have converted a defer into a loss.

Measured on spoken text (markup is free to a screen reader), a realistic room goes
from ~530 characters to ~130. That ratio is pinned by a regress case.

Two refinements on top of that rule, both about a log being *read* rather than
*scanned*:

- **Facet sections are FLATTENED, not dropped.** A room with enough furniture splits
  it into derived groups — `Seating:`, `Storage:`, `Tools:`
  ([item-facets.md](reference/item-facets.md)). Grouping is what makes a long list
  scannable, which is a property of a pane you *look at*; in a chronological log it
  is three labels and three line breaks carrying what one comma-separated row
  already carries. So brief collapses them to a single `Furniture:` line. Every
  object survives — only the grouping goes.

  ⚠ **It must be a flatten, never a drop.** describe.js emits the sections as a
  `<div>` with **no leading newline**, so they share a line with the prose
  paragraph — and a drop-by-class rule takes the furniture *and* the prose's line
  with it. That was a real bug; it is pinned by a regress case.

- **The `Installed:` row goes.** Utility fixtures bolted to the room — junction
  boxes, meters. Identical every visit, and every entry repeats the room's own name,
  which makes it the noisiest thing in a logged room. It shares the
  `furniture-label` class with `Furniture:`, so it is matched by its label **text**.

Relatedly: **KEEP beats DROP on a mixed line.** Several sections are appended with
no leading newline, so two of them routinely share one line. When they do, keeping
too much is a non-event while dropping too much loses a room's contents — the bias
is deliberate and must not be inverted.

*If you add a dynamic section to `describeZone`, put its class in `VITAL` or `TALLY`
— otherwise a `log`-rung player quietly stops being told about it. An unrecognised
class is KEPT, so the failure mode of forgetting is a slightly long brief, never a
missing room.*

### ⚠ A silent look is not a look

The client fires `sendCmdSilent('look')` from about fifteen places that have nothing
to do with the player asking to look: the 800 ms `zone_event` refresh (**somebody
else walked out of the room**), the post-swing combat refresh, `take`, and every
panel close (hangar, cockpit, poker, loot). All of them arrive at the server as
`type: 'look'` — which meant **full**.

The result was that at the bottom rung, a bystander heading east read the entire room
description aloud, and a fight repainted it every 300 ms. The `look`-is-always-full
rule was correct; the problem was that the server could not tell a player's look from
the client's own housekeeping.

`silent` was **already on the wire** (`sendCmdSilent` sets it, for idle-logoff
stamping), so the fix is to pass it into `stampToLog`. A silent look:

- is **never** full — it exists to repaint a pane that is `aria-hidden` at this rung;
- is **dropped entirely** when the zone is the same as the last room logged
  (`player._logLastRoom`), because the event that triggered it — *"Graham Mercer heads
  east"* — is its own log line and **is** the record.

The contract is untouched: a typed `look` is still always full.

## Ambience: `flavour`

The other half of the same problem. Idle NPC business, weather colour, district
texture and a stranger's television are atmosphere on a screen and a **torrent** read
aloud — and unlike a room description, there is no keystroke that gets them back,
because there was nothing in them.

So a message may carry `flavour: true`, and `broadcast()` in
[server/index.js](../server/index.js) drops it for a recipient on the `log` rung.
Two properties:

- **Both broadcast paths honour it.** `sendToPlayer` returns before the `deliver`
  filter ever runs, so the targeted path has its own guard. Pinned by `a11y:smoke`.
- **The check only runs on marked messages**, and reads the login-hydrated latch, so
  the ordinary broadcast path pays nothing and it is safe on a tick.

**The mark is deliberately narrow, and the default direction matters.**
`propagateSound(…, flavour = false)` treats an unmarked sound as *news*: over-speaking
is a nuisance, under-speaking is a player not being told somebody fired a gun next
door. Sound propagation carries both the periodic room ambient and the gunshot, so
only the caller knows which it is.

Marked today: the periodic zone ambient and the `zone.describeAmbient` plugin hook
(gameLoop), thunder, `ambient-life`'s scenery lines and `home-life`'s domestic beats.

**Not marked, on purpose:**

- **Everything in `engine/sounds.js` by default** — see above.
- **`ambient-life`'s interactive routines.** They carry a clickable opportunity
  (`Tip ₵…`, `Buy a skewer ₵…`), which makes them a decision rather than a mood.
- **Combat, dialogue, arrivals and departures.** Never flavour.

## Flavour on a verb's OWN output: the lock lines

A lock type authors its own sentence — *"The keycard reader flashes green. The
lock disengages."* That is the right thing to read and a paragraph to hear on a
door you use twenty times a day, where the only news is whether it locked. So at
the `log` rung `lock`/`unlock` answer **`Locked.` / `Unlocked.`** — the door-tag
verb (`terseLock` in [engine/commands/doors.js](../server/engine/commands/doors.js))
and your own front door (`cmdLockDoor` in
[engine/apartments.js](../server/engine/apartments.js)) alike.

**It is a rendering choice, not a state change**, and it has one deliberate
exception: a *refusal* still speaks the lock type's own `denied` line, because
that one explains **why** and is information rather than decoration. Both are
pinned by `a11y:smoke`.

*This is the pattern to copy when some other verb's flavour turns out to be a
paragraph where a word would do: collapse the OUTCOME line, keep every line that
carries a reason, and change nothing about what happened.*

### The overheard `[TV]` line

Handled at source rather than by the mark, because it is `sendToPlayer` inside the
broadcast tick and the rung was already being computed there. A set somebody *else*
is watching leaks one spoken line into the room every so often; read aloud it
interleaves a stranger's game show with the player's own game, in the same voice,
with nothing to tell them apart.

A player who wants the programme has `tv watch`, which reaches the log in full — the
deliberate act. So the bystander line is simply not sent at the `log` rung.

It works by transforming the **rendered markup**, not by threading a `brief` option
through `describeZone`: that function has ~20 call sites across the engine and eight
plugins, each building its own payload, and a new one would silently opt out. The
cost of that choice is that it is parsing another module's output, so it is written to
**bail out and return the description whole** whenever it doesn't recognise the shape.
A slightly long brief is a non-event; a missing room is not.

This is also the acceptance test for anything new: **if a system's record doesn't
reach the log, the `log` rung isn't done for it.**

### What is and isn't verified

`scripts/a11y/smoke.mjs` (`npm run a11y:smoke`, part of `pretest:regress`) pins the
mechanism: `role="log"` on `#output`, no `aria-live` on the pane, `setPaneSilent`
driven from **both** the look and move handlers, `toLog` stamped by the server and
honoured by both handlers, the input labelled, and no live region on any character
minigame (those repaint at frame rate and would drown everything).

It is **static**. It cannot tell you what a screen reader says, how it paces, or
whether listening to it is bearable. That still needs a human with NVDA, and the
checklist for that pass is below — the mechanism being present is necessary and
nowhere near sufficient.

**Verified once in a live browser (2026-08-02)** against Chrome's *computed*
accessibility state, not the DOM attributes: the log exposed with `role="log"`; the
pane not exposed at the `log` rung but still visually present; the input exposed and
named; exactly one exposed live region in-game; a move producing the room
description in the log **once**, not twice; and the ladder restoring the pane in
both directions. Ambient announcement rate measured ~6 lines/min at rest.

That pass also found and fixed a real bug: **changing rung didn't take effect until
the player's next look or move**, because `setPaneSilent` only runs on those two
handlers. Someone switching to `log` still had the pane announced until they walked
somewhere, and someone switching off it had a pane that stayed silent. The
`displaymode` verb now pushes the client's message-less `zone_event` re-look signal,
so the change lands immediately.

### The NVDA pass — what a machine cannot do

Everything here is a judgement about *listening*, which is why it is a human task:

1. **Does a move announce the room?** Set `displaymode log`, walk between two rooms.
   The description should arrive in the log, once, not twice.
2. **Is the pane silent?** Navigate the page with NVDA's object navigation. The room
   pane should be skipped entirely at the `log` rung and reachable at the others.
3. **Does combat become a torrent?** Take a fight. This is the most likely failure
   and the one no static check can see — polite announcements queue, so a busy fight
   can leave the reader minutes behind the game.
4. **Does anything interrupt?** Watch for the tablet TV readout colliding with the
   log (the one justified exception above).
5. **Is a text minigame usable or a wall?** Open the breach board at `textgames`.
   Expected answer: **not usable with a screen reader, by design** — it repaints at
   frame rate. `log` is the rung for screen readers; `textgames` is for people who
   want text. If this is bearable, that's a bonus, not a requirement.
6. **Can you get back out?** Confirm Settings → Display Mode is reachable and
   operable, and that `displaymode visual` works typed blind.

## The pre-login seam — choosing before you have a prompt

Display Mode is server state, and for a long time the only way to set it was the
tablet's Settings app or the `displaymode` verb. Both require a prompt. A brand-new
character does not have one: registration drops you into The Inbetween, and the
prologue's `player.login` handler pushes a **~50-second wordless cold open** as the
first thing that happens. The mitigation was a line of prose naming `displaymode log`
and the Escape key — which arrives *in the same tick as* the animation it's telling
you how to leave.

Worse, the prologue's own skip branch (`if (loggedPanelsSync(player))`) was dead by
construction: it is gated on a first-login flag, so it only ever ran for a character
who could not yet have chosen a rung. It read `undefined` every time.

That branch no longer skips anything: `loggedPanelsSync` now sets `mode: 'log'` on
the push, and the log rung gets the cold open as **text on its beats over the same
music** (`playIntroLog`, see [systems-codex.md](systems-codex.md#1-the-cold-open)).
The animation was the optional half; the twelve lines are the piece.

So the choice is now expressible **on the auth screen**, behind a collapsed
`<details>` reading *"Playing with a screen reader?"* — a native disclosure, announced
as one, keyboard-operable with no script, and invisible to everyone who doesn't need
it. It rides the auth message and is applied in `finishAuth` well ahead of the
`player.login` emit, which is what finally makes that skip branch load-bearing.

| Piece | Where |
| --- | --- |
| The disclosure + radios | `#auth-display-details` in [client/game/index.html](../client/game/index.html) |
| Read / persist / send | `pickedDisplayRung`, `restoreDisplayRungPref`, `rememberDisplayRung` in [client/game/js/net.js](../client/game/js/net.js) |
| Applied on login | `seedDisplayRungIfUnset` from [presentation.js](../server/engine/presentation.js), called in `finishAuth` |
| Applied at registration | `apiRegister` in [server/api/routes.js](../server/api/routes.js) — the path that actually matters, since the cold open fires on that account's first login |
| Guarded by | [scripts/a11y/smoke.mjs](../scripts/a11y/smoke.mjs) + the seed cases in [plugins/tablet/regress.js](../plugins/tablet/regress.js) |

### ⚠ Two rules, both load-bearing

**Never clobber.** The rung is server state precisely so it follows you between
machines. `seedDisplayRungIfUnset` applies the seed **only** when the stored value is
`undefined`, so a library computer whose auth screen remembers nothing cannot reset
somebody who chose `log` on their phone. An existing value always wins.

**Untouched sends nothing.** No radio on that disclosure is pre-checked, and the
client only ships a rung when one was actually selected. This is not cosmetic: seeding
an explicit `visual` for every new account would collapse the [never-chosen fourth
state](#tri-state--keep-the-fourth-state) that poker's called-aloud `textTable` felt
reads. The a11y smoke test fails the build if a `checked` attribute ever appears in
that block.

Note also which auth paths carry it: **login and register only**. A reconnect is
mid-session, where the server value is already authoritative.

The local memory is its own `localStorage` key (`architect_display_rung_pref`),
deliberately *not* part of `architect_settings` — that bag is per-character client
chrome, and this has to be readable before we know who is logging in. It is only ever
a seed and a memory; `auth_success` mirrors whatever the server settled on back into
it, so the direction of authority never inverts.

### Getting to the disclosure at all *(fixed 2026-08-11)*

The seam above was reachable and correct, and it was also the only part of the login
screen that was. An audit of what a blind player actually hears on arrival found four
defects in front of it, all in `client/game/index.html` and its auth JS:

- **The banner was read aloud.** `#auth-ascii` (13 lines of box-drawing) and
  `#auth-title` (ARCHITECT in `▄▀█ █▀█ █▀▀` block glyphs) carried no `aria-hidden`,
  so the first ~200 characters of the game were spoken as "box drawings light down
  and right…" — and because the wordmark is glyph art, **the game's name was never
  actually said**. Both are `aria-hidden="true"` now, with an `.sr-only` `<h1>`
  carrying the name. That `<h1>` is also the screen's only heading, so "list
  headings" lands on the login instead of nothing.
- **Register was unreachable by keyboard.** `#auth-toggle-link` was an `<a>` with no
  `href` — not focusable, not exposed as a control. Tabbing went username → password
  → remember → display mode → Enter and never touched it, so **registration was
  mouse-only**. `#auth-forgot-link` and `#verify-back-link` had the identical bug, so
  password recovery was too. All three are `<button type="button">` now, styled back
  down by `.auth-linkbtn` (which keeps a `:focus-visible` ring — a control that is
  reachable but shows no focus is only half fixed).
- **Mode changes and screen swaps were silent.** Flipping to register reveals two
  required fields *above* the current focus position; nothing announced them, and the
  first news of a required Handle was the form rejecting you for leaving it blank.
  There is a `#auth-mode-status` (`role="status"`) for that, and focus moves to the
  revealed field. Registration then hid the whole auth screen out from under the
  submit button — focus fell to `<body>` and nothing was said at all, leaving a
  player who had just made an account unable to tell whether it worked; `showVerifyScreen`
  focuses `#verify-message`, which holds the one instruction that matters.
  `#forgot-window` and `#reset-screen` opt into the existing focus manager with
  `data-a11y-modal` rather than growing their own handling.
- **`autocomplete` never flipped.** The password field was hardcoded
  `current-password`, so registering asked a password manager to fill an existing
  password that by definition did not exist yet — worst for exactly the players who
  lean hardest on a manager, since a generated password is the least dictatable
  string on the screen. It swaps to `new-password` with the mode.

⚠ **The toggle's focus move is gated on `e.isTrusted`.** The registrations-closed
check flips that same toggle with a synthetic `.click()` when a `fetch` resolves,
seconds after load with no gesture behind it; announcing and grabbing focus there
would yank the caret out of whatever the player had already started typing.

⚠ **`#auth-mode-status` uses `role="status"` and no explicit `aria-live`.** The a11y
smoke check polices the literal attribute, and it is right to — `role="status"` is
already a polite live region, so spelling it out as well declares a second continuous
one for nothing. See [the log rung and the two panes](#the-log-rung-and-the-two-panes).

## The type scale — text that actually enlarges *(built 2026-08-07)*

Display Mode serves the player who cannot see the screen. The Font Size setting
serves the much larger group who can see it *if it is bigger*, and until now it
mostly didn't.

`--font-size-base` sat on `body`. Meanwhile **629 font-sizes in `styles.css` were
hardcoded px**, so raising the setting enlarged the log and the room pane and left
the sidebar, the smartbar, every label, every button and every panel at 11px. It
looked like a working control and stopped helping at exactly the point it started
mattering.

**The scale is now one declaration.** `html { font-size: var(--font-size-base) }`,
and every font-size in `styles.css` and `index.html` is a `rem` measured against a
**16px reference root**. At the default rung the sheet renders pixel-identically to
before the conversion — the conversion is an identity transform, and the scale only
does anything once you move it.

Three rules keep a larger scale from tearing the layout apart:

- **Only type is in `rem`.** Borders, structural widths, scrollbars and canvas art
  stay px, so the boxes don't drift when the text inside them grows.
- **A text box's own metrics are in `em`.** 92 box metrics across 65 rules that set
  both a font-size and a px height/width were re-expressed against *that rule's own*
  font-size — a 28px square button whose glyph is 14px is `2em × 2em`. It grows with
  its own label instead of clipping it, and a circular button stays circular.
- **A touch target has a px floor.** `min-height`/`min-width` of 36px or more is a
  thumb, not typography: those became `max(36px, 2.77em)` so they may grow with the
  text and can never shrink below what a thumb needs at the Small rung. 21 of them.

### Two traps in the conversion

**iOS zooms the viewport when it focuses an input under 16px.** `#cmd-input` and the
auth fields therefore keep `max(1rem, 16px)` — a floor in *absolute* px, the one
place a bare rem is wrong. `a11y:smoke` matches bare `font-size: Npx` only, so these
pass deliberately.

**The phone auto-fit used to overrule the setting entirely.** `applyMobileScale`
(`client/game/js/main.js`) writes `--font-size-base` from viewport width on every
compact device. That was harmless when the var only drove the log; now that it is
the root, it silently overwrote the pills — so the Font Size setting did *nothing at
all* for the player most likely to need it. A size the player presses sets
`fontSizeChosen` and wins; the auto-fit only runs for a size nobody has chosen. Its
floor also went 10 → 12, because a 10px root now takes a 9px label to 5.6px.

The ladder reaches **32px = 200% of the reference root**, which is what WCAG 1.4.4
asks for. A shorter ladder is a setting that quits before the problem does.

### What is verified

`a11y:smoke` fails on: the `html` rule going missing, **any** bare px font-size
reappearing in `styles.css` or `index.html` (one px value is a piece of the
interface that can never grow again), the top rung dropping below 32, and
`fontSizeChosen` disappearing from either side of the mobile seam.

### The panels — and the line down the middle of them

About half the client's type lives in CSS template strings under
`client/game/js/panels/`. **554 of those are now rem across 14 files**; ~350 are
deliberately left in px, and the split is the point.

**A surface you READ scales. A surface you ACT through has a text rung instead.**
That is the Display Mode contract restated, not a second rule. The cockpit's 7px
instrument labels, the hangar bay, the splice lab, the card-pack reveal, the fishing
overlay, the four visual minigames and the corp map all stay px: they are positioned
art, enlarging their labels would overlap the gauge or the tile beside them, and the
accessible path off every one of them is `displaymode textgames` — a bigger cockpit
was never the answer. The reading surfaces — the tablet, Whisper, the corp console,
`who`, the keypad, the admin dialog, and the log path through `net`/`dispatch`/
`markup` — all scale.

`a11y:smoke` holds that list, so moving a file across it is a decision somebody makes
on purpose rather than a sweep nobody noticed.

**`textui.js` and `textcockpit.js` are on the scaling side, and that one matters
most.** They were hardcoded at 12px — the accessible presentation itself was the
surface you couldn't enlarge, which is the ladder bottoming out on its own bottom
rung.

### The tablet chassis grows with the type

`.tos-panel` was `width:min(760px,96vw); height:820px` — a fixed box. Doubling the
text inside a box that doesn't move is how you get a device that clips. It is now
`min(47.5rem,96vw)` × `min(51.25rem,94vh)`: exactly 760×820 at the default rung, and
at 200% it asks for twice that and the viewport clamps take over. Big text, big
device, with `.tos-scroll` absorbing whatever is still left over — which is how a
real handset behaves when you turn its text size up. `--tos-tile-h` went to rem with
it, so the home grid's rows grow with their own labels.

Whisper's private text-size control was `5pt/8pt/11pt`. Absolute units *override* the
global scale instead of composing with it, so the one panel with its own size knob
was the one panel that ignored the setting. Same rendered sizes, now in rem.

## The Accessibility surface *(built 2026-08-07)*

Display Mode and the type scale were two answers to two problems, kept in two
different places, next to a third thing in a fourth place. Text size was under
General, Motion under Layout, mono audio would have gone under Sound. A player who
needs any of it had to already know where all of it was.

There is now **one page and one verb**, and the important half is the verb.

### `accessibility` is not a convenience

The settings that make an interface usable must not be reachable *only through*
that interface. That is the oldest mistake in this field — the light switch inside
the dark room — and this codebase had it: to make the text bigger you had to
operate a simulated tablet, at the size you were already struggling with, through
tiles and pages and pill rows. `displaymode` had a bare verb for exactly this
reason. This is the rest of it.

`accessibility` (aliases `access`, `a11y`) is a **client-side** command in
`handleClientCommand` — these are localStorage preferences and never touch the
server. It prints into `#output`, so it lands in the log and is announced like any
other line, with no panel and no focus to manage. `accessibility reset` is the
escape hatch: somebody who has just turned on something that made things *worse*
needs one word, not a tour.

### One table, two surfaces

`A11Y_OPTIONS` in [client/shared/settings.js](../client/shared/settings.js) is the
list. The Tablet's Accessibility page renders from it; the verb lists and sets from
it. **Neither owns it**, so adding an option is one entry and it appears in both,
spelled and explained the same way. `a11y:smoke` fails if either surface starts
keeping its own copy, and if the Layout page stops excluding the keys Accessibility
owns — the same control on two pages with two states is worse than it being in
neither.

The `why` field is written for a player and is what the verb prints. Display Mode is
deliberately *not* in the table (it is server-side state, not a preference) but is
named first on both surfaces anyway, because it is the most consequential thing on
the list.

### What each one actually does

**Typeface** — swaps `--font-mono` wholesale rather than threading a second
variable through 159 call sites. What cannot move is anything whose meaning is in
its **columns**: the minimap, the tablet map, the character minigames, the ASCII
art. Those are re-pinned to monospace, because a proportional font shears every one
of them into nonsense. `readable` is not a font — we cannot ship one, since this
client never downloads a webfont. It is the part of the effect that is pure metric
and needs no new glyphs: a humanist sans with wider letter spacing, word spacing and
line height, which is most of what the research points at anyway.

**Motion** — was 21 CSS rules and nothing else. Every JS animation tested the OS-level
`prefers-reduced-motion` and stopped there, so the switch a player actually finds
moved a dozen transitions and left the flame, the accolades banner, the card-pack
reveal, the cold open and the flight-sim view warp running. `prefersReducedMotion()`
ORs the two, and **is a function**: three of those five read the media query into a
module-scope `const`, which meant even the OS preference only worked if you set it
before the page loaded. `a11y:smoke` fails on both regressions — reading the media
query directly, and caching the answer.

**Status Marks** — WCAG 1.4.1. The selectors were not invented: they came from
sweeping the stylesheet for rules whose *only* distinguishing property is
`color: var(--green)` or `var(--red)`. The one that matters most is `.enemy-link` —
a person and a thing that will kill you were told apart by hue alone in every room
description in the game. Marks are pseudo-elements, so no screen reader ever meets
one; this is for eyes that don't separate those two hues. **Off by default**,
because an accessibility feature that clutters the screen for people who don't need
it gets switched off by the people it was helping.

**Mono Audio** — a `GainNode` with `channelCount: 1` and `channelCountMode:
'explicit'` between the master bus and the destination. WebAudio sums L+R on the way
in and the destination spreads the one channel back to both outputs, so the mix is
*centred* rather than half-silent. On the master bus, so it catches every category
and every panner upstream. Remembered when set before the first user gesture, since
the context does not exist until then.

### ⚠ Why there is no "slow it down" option

**WCAG 2.2.1 is already satisfied, by the ladder itself.** `textRender` never opens
a board at the `log` rung — `resolveForLogRung` runs one 2d8−2d8 `skillCheck`
against the same difficulty and reports it through the same resolve verb. That
covers *every* minigame, the hololock included. The reflex demand is a property of
the top two rungs only, and `log` is a supported way out of it that costs no
content: same difficulty target, same authoritative verb, no timing.

(The `textgames` rung deliberately keeps the reflex — `texthololock.js` is the same
loop with the drawing swapped, and that is the point of the middle rung. It is not
where somebody goes to escape a clock.)

A **Reaction Time** option (Normal / Relaxed / Slowest, dividing `baseSpd`) was
built on 2026-08-07 and **reverted the same day**. Two reasons, and the second
outlives the first. It was a balance change wearing an accessibility label:

- The minigame's result *is* the outcome — `doors.js`: *"That outcome is
  authoritative (winning the minigame is the gate)."* It isn't theatre.
- Slowing the sweep multiplies the scanner's dwell time inside the sweet zone,
  which cuts **misses**. Misses cost `missPenalty` (0.08–0.40 each) and dominate;
  the longer run accrues more `trickle` (0.004–0.055/sec) but nowhere near enough
  to pay for the misses saved. The shipped code claimed "slower, not easier". That
  was simply wrong, and nobody had checked the arithmetic.
- Winning opens somebody else's apartment **and** pays hacking XP
  (`awardSkillUse` on the breach). In a shared economy a free, self-selected
  difficulty slider on a competitive skill is picked by everyone, so it stops
  reading as an accommodation and starts reading as the correct build.

**The rule this leaves behind:** an accessibility option may move the *interface*
freely. It may not move the *odds* on a contested outcome. Everything else on the
Accessibility page passes that test — text size, typeface, motion, marks and mono
audio change nothing about what happens in the world.

So the shape of any future help here is: reduce how hard the sweet zone is to
**perceive**, never how long you have to react — an audio tick as the scanner
crosses the zone edge would give a non-visual timing anchor and be **on for
everyone**, so there is nothing to min-max and the difficulty curve stays where it
was tuned. That is a game change rather than a setting.

What genuinely remains open is not a gap in coverage but a gap in *quality*:
`resolveForLogRung` says of itself that it is **an interim shape**, and that the
designed non-reflex equivalents — a turn-based breach, a paced cast — replace it
per family when somebody writes them. Until then the untimed hololock is a dice
roll rather than a game, and reaching it means dropping to the rung that also puts
away every graphical panel. Both are real costs; neither is a dead end, which is
the rule the ladder actually promises.

`hololock.js` carries this reasoning at the `baseSpd` line so it isn't re-tried.

### Keyboard focus

One rule, added last in the stylesheet: `:focus-visible { outline: 2px solid
var(--accent) }` plus a `--bg` halo so it stays visible against an accent-coloured
panel. About a dozen rules across the sheet set `outline: none` to kill the browser
ring, and did it on `:focus` — which also killed it for keyboard users, who then had
no way to tell where they were. `:focus-visible` only matches when the browser judges
a ring warranted, so this shows nothing to anyone using a mouse. `#cmd-input` opts
out: it is focused almost permanently and already shows focus in its border.

### What is verified

`a11y:smoke` now runs three scripts. The static one
([smoke.mjs](../scripts/a11y/smoke.mjs)) checks the arrangement: the shared table
exists and both surfaces read it, the Layout page still excludes what Accessibility
owns, the focus ring is present, the enemy/NPC mark is present, the character grids
are still pinned to monospace, the five JS animations read the predicate and none of
them caches it, hololock divides by the scalar, and mono audio is wired.

The second ([verb-smoke.mjs](../scripts/a11y/verb-smoke.mjs)) **actually runs the
verb** against a stub DOM — lists, sets by label / by raw value / by unique prefix,
checks the attributes reached the document and the engine, refuses an unknown
setting and an unknown value without half-applying either, and confirms `reset`
leaves nothing behind. That one exists because the verb is the *only* route to these
settings for a player who cannot use the tablet, and "the verb throws" is not
something to find out in production.

All three are static in the sense that matters: none of it tells you whether a screen
reader is bearable, or whether Readable actually reads better. That is still the
NVDA pass, plus a human who needs the setting.

### Focus management — observed, not wired

Open the trade window and press Tab. Focus used to walk straight out of the panel
into the page behind it — the smartbar, the sidebar, links in the room description
— while the panel still covered the screen. A mouse user never notices. Someone
navigating by keyboard is operating controls they cannot see, in a game where
several of those spend money or drop items. Escape did nothing in about half the
panels, and closing one left focus wherever it fell, so the next thing you typed
went nowhere.

There are ~40 panels: some built into `index.html` and revealed by flipping
`display`, 53 more appended to the body at runtime. Wiring a trap into each is
forty chances to forget, and every panel added afterwards starts broken again. So
[a11y-focus.js](../client/game/js/a11y-focus.js) **observes** instead — a
MutationObserver, coalesced to one evaluation per frame, that notices when
something modal is on screen whatever put it there. **A panel gets this by
existing.**

Three judgements are where it would go wrong quietly, so all three are tested with
plain objects in [focus-smoke.mjs](../scripts/a11y/focus-smoke.mjs):

- **Decorative overlays must not be trapped.** The sanity wash, the lightning
  flash, the blackout and the weather layer are all fixed and cover the screen.
  Trap one and the player is locked out of their own game by a visual effect, with
  no dialog on screen to explain why. They're separated by two properties they all
  happen to have — no focusable content, and/or `pointer-events: none` — rather
  than by a list of names that would go stale.
- **The top panel must win.** Highest z-index, DOM order breaking ties, and
  `z-index: auto` read as 0 rather than infinity. Otherwise focus lands in the
  panel underneath, which is invisible.
- **Escape must never confirm anything.** It clicks the panel's *own* close
  control so the panel runs its own teardown — timers, sockets, server
  notifications — and it never removes a node behind a panel's back. Explicit
  close attributes outrank a name, which outranks a text match, which only matches
  on a leaf (a wrapper's `textContent` contains its children, so a container round
  a Cancel button would otherwise swallow the click). `.shop-closed` is a *state*
  and is excluded. **No close control is a legitimate outcome** — some panels are a
  decision you have to actually make. The smoke test asserts Buy, Sell, Confirm and
  Delete are all left alone.

Two exemptions, in `NEVER_TRAP`: the **flight sim** and the **piano** own the raw
keyboard as a matter of gameplay. Neither is a dialog you tab through, and trapping
focus in a cockpit would break the controls.

Escape resolves on the *next frame* and acts only if the panel is still there.
Twenty panels already bind Escape and most never call `preventDefault`, so racing
their handlers was unwinnable — waiting a frame means whoever handled it, handled it.

**The same scan closes everything on disconnect.** A sign-out or a dropped
connection leaves every open dialog driving nothing — its buttons send commands
down a socket that isn't there, and its contents (a depot's fleet, an ATM balance,
a loot pile) describe a world you are no longer in. A handful of panels had wired
their own `game-disconnect` listener (the tablet, the CRT television, the map);
the other forty hadn't, and each new one started broken again — the same argument
that made the trap global in the first place. So `closeAllModals()` reuses
`modalEntries()` + `findCloseControl()` on `game-disconnect`, **topmost first**
(a dialog stacked over another is usually its child, and closing the parent out
from under it is how teardown gets skipped), and closes each one **by clicking its
own close control** — never by removing a node. A panel with no close control is
left alone, exactly as with Escape.

### Skip links and landmarks

Two skip links are now the first tab stops in the document, invisible until
focused. Without them a keyboard or screen-reader player lands at the top of the
page and walks the header, the room pane and the entire sidebar before reaching the
box they type into — on every page load. They point at the only two things anyone
is there to do: read what happened, and say what to do next.

They are positioned off-screen, never `display: none`, because that would take them
out of the tab order — which is the one thing a skip link cannot be. `a11y:smoke`
fails on both that and on them drifting away from the top of `<body>`.

`#main` is `role="main"`, `#sidebar` is `role="complementary"`, both labelled, so
landmark navigation has somewhere to go.

## Escape hatches

A rung is a default, never a lockout. A system may offer a per-moment override that
outranks it — a passenger's `window` mid-flight (`cabinWindowOpen`), poker's
`text`/`visual` at the felt. Those write the axis they belong to and nothing else:
poker's `text` moves the minigame rung and leaves your maps alone.

## Building a text minigame

Two pieces exist for this, and a new family should use both rather than starting over.

**Server: one line.** `textRender(player, payload)` in
[server/engine/minigame.js](../server/engine/minigame.js) stamps `render: 'text'` on a
minigame payload for a player on a text rung. Nothing else changes — same `skill`,
same `difficulty`, same `resolveCmd`. A client that has never heard of the field
behaves exactly as before, and **if a family has no character renderer yet the
client ignores the mark and opens the graphical one** (fall back up, never to
nothing).

```js
return textRender(player, { type: 'circuit_hack', deviceId, deviceName, skill, difficulty, resolveCmd });
```

**⚠ The bottom rung RESOLVES rather than renders.** A character board repaints at
frame rate — fine for `textgames`, whose audience *wants* text, and unreadable by a
screen reader, which is `log`'s entire audience. Opening one there would be a dead
end: a game you can tell is happening and cannot play. So at `log`, `textRender`
runs one 2d8−2d8 skill check against the same difficulty the board would have been
built from, narrates it, and marks the payload `render: 'resolve'`. The client fires
**the same resolve verb with the same arguments**, so the authoritative path is
identical however the game was played.

Two result shapes ride along, because the families genuinely differ: most report a
boolean `won`, but synth/splice reports a **0–100 score** (batch quality). A
resolution that only produced a boolean would silently score every log-rung cook as
zero. The score is derived from the same check's margin, so the two agree.

This is deliberately **interim** — the designed non-reflex equivalents (a
turn-based breach, a paced cast) replace it per family when someone writes them.
What it guarantees today is that **no minigame is ever a dead end**, which is the
rule the whole ladder rests on. It also covers families with no board at all
(splice, the cook game): they fall back *up* to the graphical version at
`textgames`, and resolve at `log`.

**Client: a skin, not a second game.** The drawing toolkit is
[textui.js](../client/game/js/panels/textui.js) — `paintRow`, `bar`, `centreBar`,
`heading`, `meter`, the monospace shell and the semantic colour classes.
`paintRow` is not an optimisation: a span per character is thousands of DOM nodes a
second at frame rate for a forty-column panel, and it is the difference between a
text panel and a slideshow.

**Five families are done**, each by the same route — circuit hack, hololock, vault
crack, signal hijack and fishing. Between them they cover ATMs, the practice rig,
surveillance devices, hololock doors, vendor safes, storefront tills, media decks
and the water.

Fishing is the only TWO-STAGE one: the server picks the catch from your cast and
arms the fight through a second message, so the skin has to stay mounted between
the two. Its column is drawn VERTICALLY, like the graphical board — depth is the
axis the whole game is about (deep water hides the better catches), and rotating
it to a horizontal bar to save lines would quietly throw that away.

**Circuit Breach is the worked example.** `circuithack.js` grew a *skin seam* rather
than a fork: `setBreachSkin({ board, hud, status, finish })` swaps the renderer while
the generator, the solvability proof, the difficulty scaling, movement, hazards,
PING/SCAN/BREACH and every fail state stay exactly where they were.
[textbreach.js](../client/game/js/panels/textbreach.js) installs a skin and plays the
identical puzzle in characters. **There is one game and two faces** — the same rule
that keeps the tablet from becoming a second implementation of cooking.

**The seam is regress-gated.** [scripts/shapes/textui-smoke.mjs](../scripts/shapes/textui-smoke.mjs)
(`npm run textui:smoke`, and part of `pretest:regress`) imports each base game for
real — so ESM linking proves its exports exist — then checks every skin's import
list against them. A rename on either side is otherwise invisible until somebody
tries to pick a lock, which is the same "only a player ever ran this code" problem
`shapes:smoke` exists for.

Two conventions worth copying from it:

- **Mount in the area pane, not a modal.** A modal that steals focus is what the
  text rungs exist to avoid. Hand the pane back on close, as the text cockpit does.
- **Clickable text.** A character panel stays playable with a mouse (`.pick` in
  textui.js). Slots is the proof that this is what stops a text mode feeling like a
  fallback. A text minigame also gets typed words via
  `setMinigameCommandHandler` in net.js — the same intercept `who` already uses,
  necessary because these games run entirely client-side and there is nothing on
  the far end to receive `ping` or `scan`.
- **Keyboard where the game is a timing game.** The hololock is played with SPACE,
  the vault with ← →, the hijack with ← → and SPACE. A timing game played by
  clicking a link is a worse game; the key handler releases on close and refuses
  to steal a keystroke while the command input has focus.

**Where an interface genuinely has to differ, differ in ergonomics and never in
numbers.** Two cases so far, both recorded in their files: the vault's dial becomes
a number you STEP rather than a wheel you drag (which also makes it playable with
no pointing device — the drag never was), and the hijack's OVERDRIVE becomes a
toggle rather than a hold (a hold is impossible from a command line). Neither
touches fill rates, tolerances or costs.

### Suppress, or re-render?

Two shapes of panel work, and picking the wrong one deletes information:

- **Suppress** (`logRender`) when the panel's record ALREADY reaches the log. The
  card-pack reveal qualifies because that file's own rule is *"the overlay is the
  show, never the record"* — every card is in `message` regardless, so hiding the
  cinematic loses nothing but the animation.
- **Re-render** when the panel AGGREGATES state that is nowhere else. The workspace
  HUD is the worked example: what's stored in reach, what's mid-cook and how far
  along, whether the stove is free. `look` shows you a room, not a working area. It
  renders the SAME payload the panel does — one builder, two presentations — so the
  two can never disagree about what's on the bench, and every action it prints stays
  a verb string a player could have typed.

**Trade needed a third thing.** Its record did not exist *at all* — not in the log,
not anywhere — because four of five state changes pushed no message and the panel's
buttons submit silently. So the fix was to write one, and that was a correctness fix
for every player rather than an accessibility one: the anti-scam rule ("any change
unlocks both sides") is worthless to someone who cannot see what the other side
staked.

Check which shape you have before reaching for `logRender`. Suppressing a panel
whose record doesn't reach the log is strictly worse than leaving the panel alone.

### ⚠ The map: where the two text rungs stop agreeing

Every other surface has ONE written form that serves both text rungs. The map is
the exception, and the reason is worth stating because it will come up again:

> **A character grid is still a visual-spatial artefact.**

Drawn as glyphs, the neighbourhood is genuinely good for someone who simply
prefers text — they read the shape at a glance, exactly as they read the text
cockpit's chart. Read the *same grid aloud* and it is close to useless: a screen
reader spells out rows of punctuation, and relationships obvious to an eye have to
be rebuilt in the listener's head. Long **and** uninformative.

So [map-text.js](../server/engine/map-text.js) renders two things:

- `textgames` → **a chart.** A 9×9 glyph window, you-are-here marked.
- `log` → **a briefing.** Where you are, what each exit leads to *by name*, and
  what's near with a bearing and a distance.

The briefing isn't a lesser map. For someone navigating by ear it is a better one:
*"Bodega Vu — north-east, 2 steps"* is directly actionable, and a grid is not,
however carefully drawn. It also gives what `look` structurally cannot — `look`
lists directions, not **where they go**.

Three rules the real output taught, none of which were obvious from the payload:

1. **A chart must earn its place.** An interior inherits its facade's coordinates,
   so it passes a naive "has a grid position" test and then draws a 9×9 box
   containing nothing but `@` — strictly less than the briefing, in more space. If
   there's no neighbourhood to draw, say so instead of drawing its absence.
2. **Drop landmarks at distance 0.** A facade tile sharing your coordinates is the
   building you're standing in; it's already the header. *"Grind House — here, 0
   steps"* is noise dressed as navigation.
3. **One entry per building, nearest face only.** A building spans several facade
   tiles, so without a dedupe the same block is listed once per tile it touches —
   reading as several different buildings and pushing the real ones off the list.

### Deliberately NOT written out: the gameday sub-screen

The animated per-at-bat sub-screen stays panel-only, and that is a decision rather
than an omission. The **commentary carries the game** — it is generated
play-by-play, not decoration over a simulation you can't see — and the score line
carries the state. A text gameday would restate, at length, what the listener has
already been told.

The test from the top of this doc still passes: *the record reaches the log.* A
sub-screen that re-presents the record more prettily is exactly the class of thing
the `log` rung is allowed to drop.

### A live panel becomes a SNAPSHOT, not a stream

The fourth shape, and the one most likely to be got wrong by translating a panel
literally. **A live panel and a scrolling log want opposite things from the same
data**: the panel wants to always be current, the log wants to be worth reading.

The SPECTER hub is the worked example. Its panel is fed by a 5-second tick — push
that to a log and you get twelve near-identical readouts a minute, forever, which
is exactly what the pacing rule forbids. So at the bottom rung `hub` prints the
network **once** and registers no viewer: no tick, no stream, type it again for a
fresh look. That is also how somebody would really use a deck — you check it, you
don't stare at it.

The same instinct is why the TV's score bug is sent **only when it changes** even
though it rides every line on screen, and why flight's narration runs on its own
45-second schedule rather than the 3-second physics tick.

**If a panel updates faster than a person reads, the log version is a thing you
ask for.** Anything else is a torrent that buries everything else the player needs
to hear — which for a screen-reader user means burying the game.

### The TV, now written out (was: the largest hole)

An earlier roadmap for this work listed broadcast panels as already fine —
*"the log already carries them"*. **It does not.** `tv_panel` and `tv_overlay` both
render exclusively into the TV panel ([dispatch.js](../client/game/js/dispatch.js));
no broadcast line, score bug, gameday overlay or standings snapshot ever reaches
`#output`.

So the gameday/sports sub-screens are **not** the small suppression they were
estimated as. They sit on top of a system that has no written form at all, and
giving them one means giving the whole broadcast surface one — five live-assembled
show modes, two sports pipelines, NPC hosts and camera feeds. A player on the `log`
rung currently cannot watch television in any sense.

**Now fixed, and it was far smaller than that framing suggested.** The whole thing
turned on one funnel: the broadcast tick sends one `type: 'broadcast'` per beat to
each viewer, and the client's handler returns early when no TV view is open. Three
changes:

- The tick stamps `toLog` for a viewer on the bottom rung — **sync by contract**,
  reading the login-hydrated latch (`loggedPanelsSync`), because this is a tick.
- The client appends that line to the log instead of requiring a panel.
- `buildTvPanel` opens no set at that rung, announces the tune-in in words, and
  **registers the viewer itself**.

That last point is the one that bit. `tv.watch` is emitted by the *client* when the
panel mounts, so suppressing the panel left the player unregistered — they silently
fell through to the rate-limited `[TV]` line a passer-by hears, which looks like the
feature half-working. Verified in a browser: a game show now plays out in the log,
camera cuts and all. A comment asserting the opposite sat here until the browser
disproved it.

Two consequences worth knowing:

- **`tv off`** now exists (stop watching). At this rung there is no panel ✕ to
  fire `tv.unwatch`, so there was otherwise no way to stop. Deliberately *not*
  `tune 0` — that switches the set off for the whole room, and wanting to stop
  reading is not wanting to take the television away from everyone present.
- **`tv.unwatch` is ignored at this rung** when a registration exists, because the
  panel close that fired it was the ladder's own doing (dropping to `log` shuts a
  set you can no longer read). The player's explicit stop is `tv off`, which deletes
  the registration directly rather than through the event.

Still on panels only: the score bug, gameday and standings overlays. The commentary
carries the score in words, so this is a degradation rather than a hole — but it is
the next thing to write.

## Dialogue at the log rung — the conversation you type *(built 2026-08-11)*

The dialogue panel was the last **blocking** surface with no written form, and by
this doc's own classification test it was the worst one to leave: *if I delete
this surface, is the player stuck?* — yes. Talking to an NPC opened a modal, and
at the bottom rung a player could neither read back what was said nor answer it.
The panel was never *silenced* (`#dialogue-panel` is its own element, not inside
the pane that goes `aria-hidden`), which is why this looked fine for so long: a
screen reader could still find the buttons by exploring. Nothing announced them,
nothing put focus there, and the record never reached `#output`.

So at the `log` rung the frame is written out with its options **numbered**, and
`reply <n>` walks it:

```
Marta Quill: "You look like you're after work rather than a drink."
  1) What kind of work?  [takes the job]
  2) Just the drink, thanks.  [ends it]
reply <number> · reply to hear it again · endtalk
```

Four decisions hold it up.

**One step, one function.** `advanceDialogue` ([engine/dialogue.js](../server/engine/dialogue.js))
was extracted out of `handleDialogue` when this was built, and both the click and
the typed number now go through it. It owns the option-level actions, the
GOTO_NODE override, the vendor-hours re-check and both shop doors; the caller owns
only what needs a socket. A click and a `1` cannot mean different things, because
by the time either reaches the tree they are the same call.

**A bare number works too, and only inside a conversation.** Typing `2` is the
whole interaction on this rung, and requiring a verb on every line is exactly the
tax the rung exists to remove. The intercept sits in `handleCommand` *after* the
SIFT one — a picker still owns numbers while it is open — and fires only when a
conversation is actually live, so `3` means nothing new to anybody else.

**What the panel shows in a glyph, the log says in a word.** An option's `_kind`
becomes `[turns ugly]`, `[shop]`, `[takes the job]`, `[ends it]` — a screen reader
cannot read an icon, and `hostile` is the one tag a player must never have to
infer from the wording. An unfinished turn-in is shown and refused in place, the
same way the panel disables it rather than hiding it.

**A conversation is face-to-face.** The state is in memory, per player, keyed to
the NPC *and* the zone it opened in, so walking out of the room ends it instead of
leaving a number that still works from the next street over. `reply` with no
argument re-reads the frame without advancing it, which on a rung where the
conversation lives in scrollback is most of the point.

### …which dragged the shop in with it

A vendor's dialogue tree *is* a door into the shop panel, so a conversation that
worked and then dropped the player into a modal they'd turned off would only have
moved the hole. `renderShopText` ([engine/vendor.js](../server/engine/vendor.js))
writes the shelf out — same stock, same order, same sections, because it renders
what `getVendorStock` already returned rather than asking a second question. Both
shop-open paths (`shop <npc>` in commerce, and the dialogue OPEN_SHOP/`__shop__`
door in `server/index.js`) take it. The shop **session** opens either way, so
`buy`/`sell` behave identically from there. Selling was already a verb.

## The tablet at the log rung — an index of verbs

The tablet is the one panel that could not simply be "written out": it is a
fullscreen graphical OS with thirty-odd apps, and — the part that made this urgent —
**the Display Mode switch itself lives inside it.** A player who reached `log` had no
readable route back except knowing the `displaymode` verb already.

So at the `log` rung `tablet`/`os` return a **typed index** instead of the shell
([plugins/tablet/text-index.js](../plugins/tablet/text-index.js)). Both doors land on
it: the verb, and the smartbar Tablet chip, which sends the literal verb rather than
opening the panel client-side. `tablet verbs` forces the index at any rung, so a
player in visual mode can read the same list to somebody who is not.

**It lists verbs, not screens.** Each line is a command that can be typed and have
something happen — `map`, `wanted`, `standings`, `library` — mixing verbs that OPEN
an app with verbs that do the app's job in prose, because from the prompt those are
the same thing. The verbs live on the appDef (`verbs: []`, see
[registry.js](../plugins/tablet/registry.js)) rather than in a table inside the
index, so an app registered from another plugin (flight's DEADHEAD, consort's BLISS)
declares its own, and there is one place to change when a verb is renamed. A regress
case sweeps every declared verb against the live registries — the index is the only
tablet surface a log-rung player has, so it must not quietly lie.

An app with **no** text route is still listed, marked `screen only` and dimmed at the
bottom of its category. Knowing a feature exists and is currently out of reach beats
it being invisible.

**Deep links are deliberately not rerouted.** `tabletnav bank` at the log rung still
returns the bank screen. Rendering every app's payload as text is a far bigger job
than an index, and swallowing the nav would be worse than a screen that reads badly.

## What still has no text form

See the roadmap in the plan file for ordering. Done: circuit hack, hololock, vault crack, signal
hijack — and on the panel side, **trade**, the **card-pack reveal** and the
**workspace HUD**. Minigames: all families now RESOLVE at the log rung, so none is a dead end.
Still wanting a character board at : **splice/cook** (deeply
canvas-coupled — its update functions draw, so a skin seam there is a real
refactor rather than the five-line change it was elsewhere) and **fishing**
(two-stage: the cast chooses the catch server-side, so its log-rung path needs
plugin-side work rather than the shared fork). Panels: **all done.** The TV gameday sub-screen is still
panel-only, which is a degradation rather than a hole — the commentary and the
score line carry the game. All five puzzle minigames
share one payload contract (`{skill, difficulty, deviceName, resolveCmd, id}` →
`<resolveCmd> <id> <0|1>`) and run entirely client-side once opened, so a text
equivalent needs **no new server protocol** — one fork helper and a second renderer
module per family.

Slots is the counter-example worth reading first
([plugins/slots/](../plugins/slots/)): it has no client panel at all, is identical at
every rung, and lost nothing by never having graphics.
