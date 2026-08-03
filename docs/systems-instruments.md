# Musical Instruments (as built)

**Status: BUILT.** One instrument in the world (the black upright in Bishop's Blend), five voices,
one plugin, one panel.

An instrument is furniture you sit down at and **actually play**, on your own keyboard, in real time,
and the room hears it.

```
keydown → local voice (0 ms) → ws instrument_note → server validates → sendToZone(except self) → every other ear rebuilds it
```

## Where it lives

| File | Holds |
|---|---|
| [`plugins/instrument/index.js`](../plugins/instrument/index.js) | who is seated, the rate limit, the relay. No acoustics |
| [`client/game/js/panels/piano.js`](../client/game/js/panels/piano.js) | the keyboard: layout, focus, local playback |
| [`client/shared/procedural-sfx.js`](../client/shared/procedural-sfx.js) | the `INSTRUMENTS` table and the `note()` generator |
| [`server/index.js`](../server/index.js) | the `instrument_note` ws route — nine lines that only `emit` |
| `content/furniture/furn_solenne_piano.json` | the upright |

## The three decisions worth knowing

### 1. A note is not a command

Every other player-driven surface in this game routes back through `handleCommand`. That is right for
a surface whose unit of action is a **decision** — a bet, a chess move, a swing. It is wrong for a
surface whose unit of action is a **note**.

Somebody noodling produces eight to twelve inputs a second. Each of those through the dispatch
pipeline would run the blackout gate, the posture gate and SIFT, and each would print a line into the
log — which would make the log unreadable and the performance unlistenable.

So notes get their own thin ws route, `instrument_note`, which does nothing but `emit`. This is the
same shape `tv_watch`, `deck_watch` and `mis_toggle` already have: an engine line that routes a
client message to the plugin that owns the behaviour. The plugin owns every validation, and a
rejected note is rejected **silently** — there is nothing useful to tell somebody whose fifteenth
note in a second didn't make it.

### 2. Your own note never waits for the server

`strike()` in the panel builds the voice and plays it in the same tick as the keydown, and *then*
tells the server, which relays it to everyone else **excluding the player**.

This is the feature, not an optimisation. A round trip between pressing a key and hearing it is the
difference between an instrument and a website. The server remains authoritative over who may play,
from where, and how fast — but never over what a player hears from their own hands.

The direct consequence: two people in the same room genuinely hear the same performance, because
they build it from the same three numbers with the same deterministic generator. Which is why the
instrument voices are the one part of `procedural-sfx.js` that contains **no `vary()`** — everything
else in that file jitters itself so the ninth chop doesn't sound machine-stamped, and a note must not.

### 3. No skill roll, and no fumbles

`play` is the only verb in the game with no check behind it, deliberately.

The skill being exercised is the player's own hands on their own keyboard. Rolling dice over it would
mean punishing somebody for playing well, and there is nothing to award IP for. A fumble system here
would be a system that makes the game worse at the thing it just became good at.

## The voices

FM, from the synthesis `AudioEngine.buildLayer` already had. The load-bearing parameter is
`fm.depthTo` — a **modulation index that collapses across the note**, which is exactly what reads as
*struck*: bright and inharmonic at the hammer, settling toward the carrier as it rings. That one
existing sweep is why a piano cost a table row rather than a synthesiser.

**Velocity opens the index, not just the gain.** Playing harder changes the *timbre*, which is the
single thing that most separates a piano from a keyboard.

| voice | the trick |
|---|---|
| `piano` | ratio 1, hard index collapse — bright strike settling to nearly a sine |
| `rhodes` | ratio **14:1** — a high inharmonic modulator over a sine is the bell in a Rhodes attack |
| `musicbox` | non-integer ratio 3.5, very short attack, long pure ring, no body layer |
| `pluck` | sawtooth carrier, fast decay, index falls almost immediately |
| `organ` | index **doesn't** collapse and the sustain is flat — which is what reads as blown rather than hit |

**A piano note is one layer.** It shipped with two more — a sub-octave "soundboard" tone and a noise
transient at the attack — and both were wrong. The sub-octave was wrong on its own terms: resonance
sits at the note's own fundamental, and a tone at *half* the frequency is a different note, so what
it actually produced was a second lower thing ringing under every note and outlasting it, which is
heard as an echo. It's deleted rather than retuned, because the idea was wrong and not the number; if
a voice wants weight it belongs in the modulation index, not in a second pitch. The noise transient
survives only on `musicbox` and `pluck`, where the mechanism is something you're meant to hear — on
an upright it is grit on the front of every note.

Decay is **stretched across the range** —
measured in octaves from C4, so an octave down is always the same amount longer. A C2 rings 3.8 s and
a C6 rings 0.8 s.

The table rides the existing `interface_sfx` override plumbing as `proc:instruments`, so the voices
are tunable in the dev panel alongside the materials and surfaces. No new table, no new endpoint.

### Adding a voice

A row in `INSTRUMENTS` (what it sounds like) **and** a row in `VOICE_NOUN` in the plugin (what the
room calls it). The two files deliberately don't import each other — same shared-vocabulary
arrangement the flatus styles have — so the regress asserts the key sets agree.

## Rate limiting

A **token bucket** at 14 notes/sec sustained, burst 24 — not a minimum interval.

Real playing is bursty. A chord is four notes in the same millisecond, and an interval limiter would
thin it to one, which is worse than no limiter at all. The regress asserts a four-note chord passes
and that the bucket does eventually bite.

## Keyboard ownership

The command box grabs focus the moment you type a letter anywhere (`input.js`), which would turn a
performance into command spam.

So the panel takes focus explicitly, listens on **itself** rather than on `window`, and exports
`isPianoKeysLive()` for `input.js` to check — the same treatment the flight sim, the cockpit HUD and
the hangar walk-around already get. Escape or a click elsewhere hands the keyboard back.

**The state is always shown** (`KEYS LIVE — Esc to type`). A surface that silently owns every letter
you type is a bug report.

## Layout

The tracker layout every music tool has used for thirty years: bottom letter row is the lower octave,
the row above holds its black keys, QWERTY row is the octave above — `Z`…`M` and `Q`…`P`, 29
semitones, C(n) to E(n+2). `←`/`→` transpose. The keycaps are drawn on the keys, so somebody who has
never opened a DAW can read it off the screen.

Pointer play works too, with velocity from how far down the key you hit — the closest a mouse gets to
touch, and what makes the panel playable at all on a phone.

## Mobile

Every mobile decision hangs off **pointer capability** (`matchMedia('(pointer: coarse)')`, the test
`main.js` and `cockpit.js` already use), never viewport width. A tablet in landscape is wider than any
mobile breakpoint and still has no keys to label; a narrow desktop window has a keyboard.

Four things change on touch, and each fixes something that was actually broken:

- **No keycaps.** `Z`/`S`/`X` printed on the keys of a device with no keyboard is an instruction the
  player cannot follow.
- **A shorter keyboard** — 17 semitones instead of 29. Two octaves across a 360px phone is 20px per
  white key, about a fingernail; the short span gives 34px. The octave buttons cover the rest of the
  range, and they exist *because* `←`/`→` don't.
- **No keyboard ownership.** `setLive` is inert on touch: there is no letter row being swallowed and
  nothing to warn anybody about. Critically it must not focus anything — focusing `#cmd-input` on the
  way out throws the soft keyboard up over the instrument.
- **The dock sits above the command input**, at a *measured* offset rather than a constant, because
  the input area's height moves with the density setting and the mobile scale. Docked at `bottom: 0`
  the keyboard covered the only way to talk to the game.

Multi-touch chords work — `pointerdown` fires per touch, and `touch-action: none` on the keys keeps a
glissando from scrolling the page instead.

## Display Mode

`play c4 e4 g4` is the written route. The server tells the textgames rung about it instead of opening
a keyboard, and `openPianoPanel` refuses to open for a player who asked not to have visual surfaces —
opening one anyway is the exact thing that rung exists to prevent.

It isn't rung-gated, though. It is also how a macro plays a riff and how anybody tests a note.

## What ends a performance

Leaving the room, `play stop`, `stop`, standing up by any route (`posture.changed`), logging out. The
note path **re-validates the room on every single note** rather than trusting the seat it handed out —
a client that keeps sending after walking away is the ordinary case (the keyup lands after the move),
not an attack.

## Adding an instrument to the world

One furniture row:

```json
"flags": { "instrument": "rhodes", "interactions": ["examine", "play"] }
```

Nothing else. The verb, the panel, the room audio and the examine affordance all follow from the flag.

## Not built

- **No note-off.** A key release doesn't damp the string; notes decay on their own schedule. This is
  close to right for a piano and wrong for an organ, whose sustain currently ends on a timer rather
  than when you lift your finger.
- **NPCs don't play.** A house pianist in Bishop's Blend would be an obvious next thing and needs no
  new machinery — an ambient routine striking notes through the same relay.
- **Nothing is recorded.** You can't write a tune down, and a player can't teach one to another.
