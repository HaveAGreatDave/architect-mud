# Accessibility Settings & Voice Input

**STATUS: BUILT.** The option table, the `accessibility` verb, voice input and Read Aloud all ship.

Not to be confused with [systems-display-mode.md](systems-display-mode.md), which owns the
three-rung visual/textgames/log ladder and the ARIA contract. That doc is about *how much of the
game is drawn rather than written*. This one is about the settings surface around it, and about
getting a command in.

---

## 1. One table, two surfaces

`A11Y_OPTIONS` in [client/shared/settings.js](../client/shared/settings.js) is the list. Both the
tablet's Accessibility page ([tablet-os.js](../client/game/js/panels/tablet-os.js)) and the
`accessibility` verb ([a11y-command.js](../client/game/js/a11y-command.js)) render *from* it, and
neither owns it. Add an entry and it appears in both, spelled the same way, explained the same way.

An entry is `{ key, label, verb, why, opts:[{v,t}] }`. `why` is written for a player, because the
verb prints it verbatim.

An entry may also carry **`resolve(settings, ctx)`**, which makes it *tri-state*: never-chosen is a
real state and the answer is DERIVED rather than stored. Exactly one option uses it today —
**Sound Detail** (`off` / `limited` / `full`), which defaults to `full` at the `log` rung and
`limited` everywhere else, because the player with no room pane is the one the dense sound tier was
built for. Both surfaces read `effectiveOptionValue(opt, settings, ctx)` rather than the raw key, so
neither renderer knows that row is special and neither prints *"currently undefined"*.

Two rules go with it, both pinned by `verb-smoke.mjs`: **`resolve` and `def` are mutually
exclusive** (a stored default would simply beat the derived one), and **`accessibility reset` must
leave a `resolve` key ABSENT** rather than writing the first pill — writing `off` there would have
the escape hatch silence the player it exists to rescue. The full reasoning is in
[systems-display-mode.md](systems-display-mode.md#sound-detail); the sounds themselves are in
[systems-procedural-audio.md](systems-procedural-audio.md#the-dense-tier--footsteps-doors-locks).

**Sound Detail is a preference, not an accessibility-only feature**, and `off` is not the volume
slider: volume answers *how loud*, this answers *how much*. It changes nothing about the game's
difficulty, which is the bar every row on this page has to clear.

**The verb is not a convenience.** The settings that make the interface usable must not be reachable
only *through* that interface — the light switch cannot be inside the dark room. `accessibility` is
therefore a plain client-side verb with no tablet gate, exactly like `displaymode`, and
`accessibility reset` exists so a change that made things worse can be undone without operating the
surface it just broke. `scripts/a11y/smoke.mjs` asserts this arrangement is still standing.

Everything in the table is a **localStorage preference** — per-device, never sent to the server,
never announced to anyone else, and it changes nothing about the game's difficulty. Display Mode is
the exception and is deliberately *not* in the table: it is server-side state. It is still listed
first on both surfaces, because it is the most consequential thing on either.

---

## 2. Voice input

**Off by default** (`dictation: 'off'`). A player who never asks for a microphone is never asked for
one. Turning it on puts a mic button beside the command box; `accessibility voice review` reaches it
without the tablet.

Three modes: **Off**, **Review** (fills the box, waits for Enter), **Auto-send** (runs it — except
guarded commands, below). Firefox has no `SpeechRecognition`, so there the button never mounts and
the option's `why` text says so; a button that cannot work is worse than no button.

Two files:

| file | what it is |
|---|---|
| [client/shared/dictation.js](../client/shared/dictation.js) | the normalizer — pure, DOM-free, import-free |
| [client/game/js/dictation.js](../client/game/js/dictation.js) | the recognizer, the button, the hotkey |

The split is not tidiness. The shared half is pure so `scripts/a11y/dictation-smoke.mjs` drives the
*real* module in Node rather than a copy of it — the same reasoning behind `a11y-command.js`'s
relative import. For the player who uses this, it is the only way to enter a command.

### Why a normalizer at all

General ASR is trained on English prose; this game's input is terse jargon. Nobody says "wield rusty
pipe" and gets it back — they get "field rusty pipe". A bare `n` comes back as "in", "and", "an" or
"en", never the letter. A mic button without this layer demos beautifully and is useless to the
person it was built for.

Three rules shape it, and each is a decision not to do the obvious thing:

- **Aggressive on one token, cautious on many.** A lone utterance is almost certainly a direction or
  a bare verb, so "in" can safely become `n`. The *same word* inside `put the coat in the locker`
  must be untouched. Nearly every mapping is gated on the utterance being a single token, and that
  gate is what stops the layer mangling the sentences it exists to help with.
- **The vocabulary is live, not listed.** Item and NPC names come from what is actually in the room
  and in your hands — the `data-cmd` attributes the room pane and smartbar already render, plus the
  inventory cache. A static noun list would be a second copy of the world's content and would be
  wrong the day after it was written. Nothing is fetched; no round trip is added.
- **Never invent.** Anything unmatched passes through verbatim, so the server answers
  `Unknown command` exactly as it would for a typo. A normalizer that guesses is worse than one that
  gives up, because a guess that lands on a real verb *runs* it.

**`scoreNoun` measures the candidate against what was HEARD, not what was heard against the
candidate** — so "pipe" scores 1.0 against "rusty pipe". Read the comment there before flipping it
back: a partial name is not this layer's problem, because `wield pipe` is already valid input that
the server's SIFT matcher resolves. This layer is only for words the recognizer got *wrong*. An
ambiguous match — two candidates tied — is left alone rather than resolved by coin-flip.

### The guard

`GUARDED_VERBS` is never auto-sent, whatever the mode says: `drop`, `give`, `sell`, `buy`, `pay`,
`attack`, `quit`, the consumables, and the rest. The asymmetry isn't close — the guard costs one
keypress, and a mishearing costs your rifle on the floor of the Under or your credits in a
stranger's account. `drop` and `give` in particular are one phoneme from words you would say in
ordinary conversation. The smoke test asserts both halves: that the costly verbs are guarded, and
that ordinary ones are *not* (or Auto-send would be pointless and nobody would leave it on).

`FREE_TEXT_VERBS` — `say`, `tell`, `whisper`, `emote` — keep their arguments exactly as spoken.
These are the one place ordinary English is the correct input, and the noun matcher would eat it.

### Contracts worth not breaking

- **One submit path.** A recognized command goes through `submitCommand()` in
  [input.js](../client/game/js/input.js) — the same function the Enter key calls. A second path is
  how a spoken command quietly stops answering the auto-walk prompt or stops being remembered by
  ArrowUp: divergences nobody notices until the person relying on them reports it.
- **Interim results never reach `#output`.** They stream into the input box, where you can watch
  them converge. `#output` is the one ARIA live region; streaming partials into it would make a
  screen reader unusable, which would be a remarkable thing for an accessibility feature to do.
- **Failure is announced.** A denied mic permission is the commonest way this "doesn't work", and it
  is invisible — the button just does nothing forever. Every recognizer error prints a plain line.
- **The listening indicator does not animate.** It is a solid fill, not a pulse, so it survives
  Motion Off. `aria-pressed` carries the same fact for a screen reader.

### Input routes

Tap the button, hold it to talk (release to stop), or **Ctrl/Cmd+Shift+M** from anywhere including
inside the command box. A chord rather than a single key, because the flight sim, the piano and WASD
movement each own the bare letter rows — see the owner list in `input.js`. The hotkey does nothing
while Voice Input is off.

---

## 3. Read Aloud — the log reader

**Off by default, and that default carries more weight here than anywhere else in the client.**
`#output` carries `role="log"` — a live region — which means **a screen reader is already reading
it**. Turning this on for someone running NVDA or VoiceOver speaks every line twice, in two voices,
slightly out of step. That is not an annoyance, it is unusable. So it ships off, the option text says
so in plain words, and nothing turns it on by itself. `scripts/a11y/speech-smoke.mjs` fails the build
if the default ever changes.

Who it *is* for: people who don't run a screen reader but still want the game spoken — low vision
without a reader, dyslexia, fatigue, a long session where the eyes go first, hands-busy play. A real
audience, and not the same one the ARIA work serves.

### Two voices, and why the default is the boring one

| mode | engine | when |
|---|---|---|
| **Natural** | the browser's `speechSynthesis` — the platform voices | recommended; intelligible for hours, rate-adjustable, doesn't depend on our synth being right about a word |
| **In-world** | the game's own formant synth | fits the fiction, harder work to listen to; after twenty minutes that effort *is* the experience |

Natural is listed first and recommended. In-world exists because wanting the game to sound like the
game is legitimate — but the option text doesn't pretend they're equivalent.

The reader rides `channel: 'ui'` in `speak()`, which **bypasses the TV audio toggle** and the TV
volume slider: a player who muted the television has not asked to be unable to read the game. The
master Sound switch still silences it, because that one means silence.

### The seam, and the rules

- **It observes the log, it doesn't hook the append helpers.** A `MutationObserver` on `#output`, so
  whatever reaches the log is read — including panels that append directly. Hooking
  `appendMsg`/`appendHtml`/`appendPre` would silently miss the fourth caller somebody adds later.
- **The queue is capped, and drops the OLDEST.** A combat round or a room look can dump a dozen lines
  at once; reading all of them puts the voice minutes behind the game, telling you about a fight that
  has finished. What is happening now matters more than what happened eight lines ago — the opposite
  of how a queue usually ages.
- **Glyph art is never read.** Any `<pre>`, anything containing one, and any line that is mostly
  box-drawing or block characters. The minimap, the chess board, the card faces and the bounty poster
  read aloud as a minute of punctuation names, and each already has a written record elsewhere. Both
  ways of getting this filter wrong are bad — too greedy and you get the punctuation, too strict and
  a message is silently never spoken — so `readableText` is exported and tested against both.
- **Barge-in.** Entering a command interrupts the voice, and Escape stops it dead. A reader you have
  to sit through is one you end up fighting.

---

## 4. Enunciation

Voice input and Read Aloud both landed alongside a pass on the formant synth's enunciation, driven by
sweeping the game's *own* vocabulary through `_phonemesFor` and reading what came back. What that
found, and what fixed it, is in [systems-broadcast.md](systems-broadcast.md) and the comments in
`client/shared/audio-engine.js`; the short version is that the four defects were **compounds**
(`voidwalking` → "void-WAH-lking"), **initialisms** (`NPC` → "M P K", three consonants and no vowel),
**the credit symbol** (`₵900` read as "nine hundred", the unit silently dropped), and
**abbreviations** (`Dr. Vale` read as "*drive* Vale", because CMUdict's `dr` is DRIVE). All four are
regression-tested in `scripts/voice/smoke.mjs`.

---

## 5. The status marks are for eyes only *(fixed 2026-08-11)*

The `statusGlyphs` option in `A11Y_OPTIONS` prepends a shape to state the game otherwise draws in hue
alone — `✕` before an enemy link, `▲` before a hazard, `✓` before an ingredient you have. It exists for
players who don't separate two hues, and the whole block lives at the bottom of `styles.css` under
`html[data-status-glyphs="on"]`.

It carried this comment, which was wrong:

> *The mark is a pseudo-element, so no screen reader ever meets it.*

**Chrome puts CSS generated content in the accessibility tree.** TalkBack on Android read all 18 marks
aloud by glyph name — "heavy multiplication x" before every enemy in every room description, before
every incoming combat line, before every error. An option that helps one group was taxing another,
which is the one thing an accessibility feature must never do.

⚠ **Every mark is now declared twice, and collapsing that to one line is a regression:**

```css
content: "✕\00a0";        /* the glyph, for any engine */
content: "✕\00a0" / "";   /* the same glyph, empty ALTERNATIVE TEXT */
```

The second wins where alt text is supported (Chrome 77+, Firefox 116+, Safari 17.4+) and takes the mark
out of the a11y tree. Where it isn't, the declaration is invalid and dropped and the first still draws.
A lone alt-text declaration would mean the colourblind player loses the mark entirely on an older engine
— which is why `a11y:smoke` asserts **both** halves, and fails if either goes missing.

The same reasoning silenced the always-on decoration that was never a status at all: the connection
dot (`●`/`◌`/`○` — `#conn-status` already carries a `title`), the shop-mode brackets `[ ]`, the shop-row
bullets `· ›`, and the locked-dialogue padlock (whose option already sets a `title` saying it's locked).

**Kept deliberately:** `content: "(empty)"` on an empty container list. That one is not decoration — it
is the only thing in the DOM that says the list is empty, so it must stay spoken.

### The same bug, in markup

`dialogue.js`'s `optionIconHtml` was announcing each conversation option three times: the emoji by name
("shopping trolley"), then the `title` that explains it ("Opens their shop"), then the button's own
label. The icon span is `aria-hidden="true"` now. The glyph is a sighted player's shortcut to where an
option leads; the label is how everyone else already knew.

---

## 6. The cold open's gate *(fixed 2026-08-11)*

For anyone who **didn't** set the log rung, the cinematic's start gate is the first screen of the game.
(A player on `log` never sees it at all — [prologue/index.js](../plugins/prologue/index.js) returns to
`beginArrival` *before* the `intro_cinematic` push, so this is not a client-side skip.)

The gate was already built well: `role="dialog"` with an `aria-label`, real `<button>`s, Escape/Space
skip, an auto-begin so nobody is stranded, and a server-side `INTRO_FALLBACK_MS` so a client that never
echoes `introdone` cannot stall the prologue. Three things were wrong at the edges:

- **It landed on the wrong control.** `a11y-focus.js` focuses the first focusable in a dialog, and in
  DOM order that is the sound toggle — so the opening line of the game, spoken, was a settings control.
  Fixed by claiming focus for `#intro-cine-begin` **synchronously on mount**: the manager only moves
  focus when the dialog doesn't already contain it, so claiming it first makes the manager agree rather
  than compete. Focus rather than a DOM reorder, so the toggle stays drawn above the button where it
  reads as a note about what's coming.
- **The sound toggle announced its own emoji.** `'🔊  Sound on'` was read as "speaker with three sound
  waves, Sound on". The glyph is in an `aria-hidden` span now, and `aria-pressed` was always carrying
  the state anyway.
- **The countdown was sighted-only.** The wait bar is `aria-hidden`, correctly — it is a drawing of a
  countdown. But that left nothing saying the sequence starts on its own, so it simply began. There is
  an `.sr-only` sentence now, and ⚠ **it derives its number from `AUTO_BEGIN_MS`** rather than spelling
  "twenty seconds" in the markup. The block right above it already warns that a duplicated duration
  "would make the terminal lie about when it's going to move"; that applies to the sentence exactly as
  much as to the bar.

All four properties are asserted in `scripts/a11y/smoke.mjs`.

### Still open

Two things in this path are known and **not** fixed:

- **The skip instruction races the dialog.** The prologue sends the "press Escape to skip it" line and
  the `intro_cinematic` push in the same tick. `#output` is `role="log"` (implicitly polite), and the
  overlay takes focus a frame later — and a polite announcement is interrupted by a focus change. So
  the sentence explaining the escape hatch is likely truncated by the thing it describes.
- **The sequence itself is silent.** Beat text is written with `lineEl.innerHTML` and is never
  announced. That is deliberate: a second continuous live region running the length of a cinematic is
  exactly what [the one-live-region rule](systems-display-mode.md#the-log-rung-and-the-two-panes)
  forbids, and CODEX Volume I carries the full text. What's missing is that nobody is *told* the next
  minute is visual only, so it cannot be told apart from a freeze.

---

## 7. The close buttons said "multiplication X" *(fixed 2026-08-11)*

Reported by a player on the log rung: every close button in the client was announced as
"multiplication X" (VoiceOver) or "times" (NVDA). They could hear that a panel had opened and not what
the button in its corner did.

Not the same bug as §5 — nothing here is a pseudo-element. **A button's own contents outrank its
`title` in the accessible-name algorithm**, so the ~30 buttons in this client written

```html
<button title="Close">✕</button>
```

are all named `✕`, and the `title` is a mouse tooltip that a screen reader never reaches. `aria-label`
is the only one of the three that wins, because it outranks contents.

Fixed as a **sweep**, `nameGlyphControls()` in [a11y-focus.js](../client/game/js/a11y-focus.js), for
the same reason the focus trap is a sweep: ~30 sites across `index.html` and fifty-odd panel modules,
hand-fixing each is thirty chances to forget, and the next panel written starts broken again. It rides
the MutationObserver that was already coalescing to one pass per frame, and marks each element
(`data-a11y-named`) so it is visited once.

⚠ **The name is the author's wherever there is one.** A `title` becomes the label verbatim; only a
glyph with nothing else to go on is called "Close". This is load-bearing, not politeness — several ✕
buttons in this client are not closes at all (*Remove panel*, *clear all waypoints*), and a sweep that
called them "Close" would be a worse lie than the glyph was. Two that had no title got a real
`aria-label` at source instead (the livery-scheme delete, the custom-panel builder's ✕).

Related, same pass: `hangar-bay.js`'s `tbtn()` now marks its icon `aria-hidden`, because a glyph
*beside* a word is decoration — "Cancel Rental" was being read as "multiplication X Cancel Rental" and
"Sell" as "credit Sell".

`a11y:focus` covers all four judgements, including the two that would do harm: an authored title is
never overwritten, and a wrapper holding the glyph is never named in the button's place.

## 8. The command box: Tab completion and scroll lock *(built 2026-08-15)*

Two staples the client had never had. Both are keyboard-first, which is why they live here.

**Tab completion** — `client/game/js/complete.js`, wired into the one keydown handler in
`input.js`. Two vocabularies, picked by where the caret is: the **first token** completes against
**verbs**, anything after it against the **live nouns of the room** (`vocabulary.js` — the same list
voice input matches against, moved out of `dictation.js` when completion became its second reader).

The verb list is **sent by the server**, once per session, over a `verbs` ws route requested on
`auth_success`. It is assembled there from the live registries — `builtinCommandNames()`,
`getRegisteredCommands()`, `getRegisteredSpecializedActions()`, `getAliasList()` — and never written
down in the client, for the same reason dictation scrapes its nouns off `data-cmd` rather than
shipping a list: a second copy of the verb table goes stale silently, and the symptom is Tab quietly
declining to complete a verb that works perfectly when typed out. It describes the build, not the
player, so nothing in it changes mid-session and one fetch is enough.

Three rules, and the first two are dictation's:

- **Never invent.** No match means nothing happens — no beep, no guess, no nearest thing.
- **Common prefix first, then cycle.** The first Tab extends as far as every candidate agrees; only
  when there is nothing left to agree on does further tabbing walk them one at a time (Shift+Tab
  walks back). Candidates sort **shortest first**, so `take` is reachable before `takeoff`.
- **The cycle dies the moment the line changes.** Any edit or caret move throws the candidate list
  away, or you end up replacing a finished word with a completion of the word before it.

⚠ **`preventDefault` only fires when something was completed.** An empty box, or a word nothing
matches, lets Tab move focus out. This box sits in front of every other control on the page; a Tab
that is swallowed unconditionally is a keyboard trap.

**Scroll lock** — `#output` used to jam itself to the bottom on every appended line
(`scrollOutput()`), so scrolling up to re-read what an NPC just said was impossible during a fight:
the next combat tick yanked you back down mid-sentence. Reading back is not an edge case in a game
that says everything in prose, and it is the whole interaction for anyone who reads slower than the
game talks. The rule is the terminal one — follow the tail only if the reader was **already** at the
tail — plus an "N new lines ↓" chip (`#scroll-resume`) that both returns you to the bottom and tells
you the game has not gone quiet. `submitCommand` releases the lock: acting says you are done reading
back, the same reasoning that already makes acting stop the Read Aloud queue.

Two traps, both of which make the fix look like the bug:

- ⚠ **The tail is measured in the SCROLL EVENT, never at append time.** By the time an append helper
  calls `scrollOutput()` the node is already in the document and `scrollHeight` has grown by its
  height, so a reader who was at the tail measures one long room description away from it and the
  lock engages on its own.
- ⚠ **`#output` is `scroll-behavior: smooth`**, so setting `scrollTop` *animates* and fires a run of
  scroll events on the way down, every one of them short of the tail. The `_auto` flag ignores the
  reader's position until a programmatic snap lands.

The lock is deliberately **not** reset by new lines, room changes or panels. A reader who has
scrolled up has said what they want, and the only thing worse than a log that will not hold still is
one that holds still until something interesting happens.

## 9. The log as a surface: highlights, find, transcript *(built 2026-08-15)*

`highlights.js` (store + painter) and `logtools.js` (panel, find bar, export). Split along that line
because `render.js` imports the painter on the append path and `logtools.js` imports `render.js` for
its own output — one file would be a cycle. All of it is client-only `localStorage`, the storage
model macros use; nothing reaches the server, and nothing here can change what the game does.

**Highlights** are not a cosmetic. The game says everything in prose, in one column, and during a
fight it says a lot of it per second — there was no way to make one line matter more than another.
That is a readability problem for everyone and an accessibility problem for anyone who cannot scan a
fast scroll. `highlight <word>` toggles one in the default colour (what you want mid-fight); bare
`highlight` / `hl` opens the manager for colours and pings; `highlight clear` drops the lot.

- **Plain substring, never a regex.** A regex box is a footgun in a text field with no error
  surface: one unbalanced bracket throws on every line appended thereafter.
- **Longest rule first**, so `reactor core` wins where `core` is also set.
- **One ping per LINE, never per match** — a rule matching six words in a room description must not
  fire six times — and muted by the game's own sound settings, because a notification you cannot
  turn off is worse than no notification.
- ⚠ **`<pre>` is skipped entirely.** Those are the glyph-art blocks (a poster, a card, a chess
  board), where a coloured span in the middle of a border character is a hole in the picture.
- **A rule change repaints the log that is already on screen** (`repaintHighlights()`, `silent:
  true`). Without it, setting a highlight does nothing until the game next speaks — which for a word
  you set *because* you are waiting for it looks exactly like the feature not working.

**Find** — `Ctrl+F`, or `find <text>`. Matches are marked in place, stepped with Enter /
Shift+Enter. Note the verb: **`search` was not free** (the strays plugin owns it), and `highlight`,
`hl` and `find` are bare client verbs, which shadow any server verb of that name **forever** — a
client verb never reaches dispatch. All three were checked against the live registries first.
⚠ Stepping scrolls the log, which is the thing §8's lock exists to prevent happening *on its own* —
here the reader asked, so the lock is left engaged, and closing the bar deliberately does **not**
snap them to the tail.

**Transcript** — `.savelog` writes the log to a `.txt`, dot-prefixed like `.markup`/`.status`
because it is client-only meta with no in-world meaning. `textContent`, not markup: a transcript is
for reading back or pasting into a bug report, and neither is helped by spans. It reads a **20,000
line session buffer in `render.js`**, not the DOM — reading the document meant the file began
wherever the scrollback cap had trimmed to, which is precisely the part you saved it to read. Its
limits are printed in its own header. See [systems-automation.md](systems-automation.md#the-transcript).

**The scrollback cap** (`MAX_LINES` in `render.js`) is what makes the other two affordable. Nothing
used to remove a log line, ever — and it was never only memory, since Read Aloud's observer, the find
bar and the export all walk that list. ⚠ It **only trims while following**: removing nodes above the
viewport shifts what the reader is looking at, which is indistinguishable from the log scrolling
itself while they read. A reader who has scrolled back gets an uncapped log until they come down.

## 10. Not in scope

Dictation still does not use the synced verb list — it normalizes against nouns only, and widening it
to verbs is its own change with its own mishearing risk. No per-player persistence — localStorage, like everything else in the table.
No heteronym disambiguation in the synth: `read`/`live`/`lead` still take one fixed pronunciation
each, because choosing between them needs part-of-speech tagging that nothing here has.
