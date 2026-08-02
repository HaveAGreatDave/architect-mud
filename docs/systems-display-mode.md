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

`flight_text_only` and `poker_text_mode` remain read-only fallbacks for choices made
before any of this. Nothing writes them. No data migration was needed.

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
- At the `log` rung the pane gets `aria-hidden` (`setPaneSilent`). It stays
  *visible* — a sighted player who chose this rung for the scrollback still wants to
  see the room — it simply stops being announced. It must never become a live
  region: it would re-read the whole pane on every move.

**The room description reaches the log at this rung.** A look normally goes to the
pane and never touches `#output`, so a player reading through the log alone would
walk from room to room hearing nothing about where they are. `server/index.js`
stamps `toLog` on outbound `look`/`move` payloads — one site, because the
description is built at half a dozen places (movement.js, world.js, the login look,
gametable's `paneOrLook`) and there is no single constructor to hook. The client
then appends it as well.

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

**Four families are done**, each by the same route — circuit hack, hololock, vault crack
and signal hijack. Between them they cover ATMs, the practice rig, surveillance
devices, hololock doors, vendor safes, storefront tills and media decks.

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

## What still has no text form

See the roadmap in the plan file for ordering. Done: circuit hack, hololock, vault crack, signal
hijack — and on the panel side, **trade**, the **card-pack reveal** and the
**workspace HUD**. Minigames: all families now RESOLVE at the log rung, so none is a dead end.
Still wanting a character board at : **splice/cook** (deeply
canvas-coupled — its update functions draw, so a skin seam there is a real
refactor rather than the five-line change it was elsewhere) and **fishing**
(two-stage: the cast chooses the catch server-side, so its log-rung path needs
plugin-side work rather than the shared fork). Outstanding panels: map/minimap, surveillance
feeds, and the TV score-bug/gameday/standings overlays (a degradation, not a
hole — the commentary carries the score in words). All five puzzle minigames
share one payload contract (`{skill, difficulty, deviceName, resolveCmd, id}` →
`<resolveCmd> <id> <0|1>`) and run entirely client-side once opened, so a text
equivalent needs **no new server protocol** — one fork helper and a second renderer
module per family.

Slots is the counter-example worth reading first
([plugins/slots/](../plugins/slots/)): it has no client panel at all, is identical at
every rung, and lost nothing by never having graphics.
