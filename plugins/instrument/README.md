# instrument — playable musical instruments

**Status: built.**

Furniture carrying `flags.instrument` can be sat down at and played, key by key, on the player's own
keyboard. Everyone else in the zone hears it.

| | |
|---|---|
| Verb | `play` (`play stop` to get up, `play c4 e4 g4` to write a phrase) |
| Gate | `flags.instrument` on furniture in the room |
| Client | [`client/game/js/panels/piano.js`](../../client/game/js/panels/piano.js) |
| Voices | the `INSTRUMENTS` table in [`client/shared/procedural-sfx.js`](../../client/shared/procedural-sfx.js) |
| State | in memory only — no table, no tick, no query on the note path |

## A note is not a command

Every other player-driven surface in this game routes back through `handleCommand`, and that is right
for a surface whose unit of action is a *decision* — a bet, a move, a swing. It is wrong here.
Somebody noodling produces eight to twelve inputs a second, and each of those through the dispatch
pipeline would run the blackout gate, the posture gate and SIFT, and would print a line into the log.

So notes arrive on their own thin ws route — `instrument_note` in `server/index.js`, which does
nothing but `emit`, the same shape `tv_watch` and `deck_watch` already have. Every validation lives
in this plugin, and a rejected note is rejected **silently**: there is no useful thing to tell
somebody whose fifteenth note in a second didn't make it.

## Your own note never waits for the server

`strike()` in the panel builds the voice and plays it in the same tick as the keydown, and *then*
tells the server, which relays it to everyone else. The server excludes the player from their own
broadcast.

This is not an optimisation, it is the feature. A round trip between pressing a key and hearing it is
the difference between an instrument and a website. The server stays authoritative over who may play,
from where, and how fast — never over what a player hears from their own hands.

## The voices are FM, and that's why they were nearly free

`AudioEngine.buildLayer` already did audio-rate FM with a **sweeping modulation index**
(`fm.depthTo`). A modulation index that collapses across the note is exactly what reads as *struck*:
bright and inharmonic at the hammer, settling toward the carrier as it rings. That one existing
parameter is why a piano cost a table row rather than a synthesiser.

Velocity opens the index, not just the gain — which is why playing harder changes the *timbre*, and
is the single thing that most separates a piano from a keyboard.

Five voices ship: `piano`, `rhodes` (the 14:1 ratio that makes the bell in a Rhodes attack),
`musicbox`, `pluck`, `organ`. Adding one is a row in `INSTRUMENTS` plus a noun in `VOICE_NOUN` here.
The regress asserts those two key sets agree, because the files deliberately don't import each other.

## No skill roll, no fumbles

Deliberate, and worth defending. The skill being exercised is the player's own hands on their own
keyboard. Rolling dice over it would mean punishing somebody for playing well, and there is nothing
to award IP for. `play` is the only verb in the game with no check behind it, on purpose.

## Rate limiting

A token bucket at 14 notes/sec with a burst of 24 — **not** a minimum interval. Real playing is
bursty: a chord is four notes in the same millisecond, and a limiter that thins it to one is worse
than no limiter at all. The regress asserts a four-note chord passes.

## Display Mode

`play c4 e4 g4` is the written route, and the server tells the textgames rung about it instead of
opening a keyboard. It isn't rung-gated, though — it's also how a macro plays a riff and how anybody
tests a note.

## Keyboard ownership

The command box grabs focus the moment you type a letter anywhere. The panel therefore takes focus
explicitly, listens on itself rather than on `window`, and exports `isPianoKeysLive()` for
`input.js` — the same treatment the flight sim and the hangar walk-around already have. Escape or a
click elsewhere hands the keyboard back, and the panel says which mode it is in at all times.

## Adding an instrument to the world

One furniture row:

```json
"flags": { "instrument": "rhodes", "interactions": ["examine", "play"] }
```

Nothing else. The verb, the panel, the room audio and the examine affordance all follow from the flag.
