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

## 5. Not in scope

No server-side verb registry sync for dictation (the client has no verb list, and building a synced
one is its own feature). No per-player persistence — localStorage, like everything else in the table.
No heteronym disambiguation in the synth: `read`/`live`/`lead` still take one fixed pronunciation
each, because choosing between them needs part-of-speech tagging that nothing here has.
