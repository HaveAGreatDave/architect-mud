# audio

**Purpose** — the procedural SNES-style audio layer: music, SFX and ambience generated rather than shipped as per-thing assets. **Entirely separate from the text-based Sound system** (the one that propagates a gunshot through a wall) — this is what your speakers do, that is what the room tells you.

## Commands
- `.createsound` / `.playsound` — authoring and inspection aids.

## REST
- `/audio`

## Events emitted
- `audio.music.changed`
- `audio.sfx.triggered`

## Events consumed
The plugin listens broadly, because almost everything should make a noise:

`zone.entered` · `enemy.killed` · `enemy.attacked` · `player.death` · `item.taken` · `item.dropped` · `device.tuned` · `bodily.sfx` · `flight.strafeIncoming` · `flight.aaFired` · `cooking.sfx`

That list is the extension point: a new system makes sound by **emitting an event**, not by importing this plugin.

## The industrial ambient bed — what counts as a power device

A room with a live **generator** gets the power-station roar; one with a live
**junction box** gets the utility-room hum; a generator next door bleeds a
fainter version through. Anything else gets silence.

⚠ **The test is `object_type`, never "is it destructible".** It used to be
`hp_max != null`, which is a test for *breakable* — and a microwave is breakable.
So every Solenne apartment, the four Merrow units, the grocery and the
laundromat ran a machine-room drone off a kitchen appliance, a folding table and
a row of dryers: a permanent hum in a bedroom with nothing in the room to explain
it. `isPowerDevice` is now the one predicate, and `plugins/audio/regress.js`
pins each of those rows as NOT qualifying.

## See also
[docs/systems-procedural-audio.md](../../docs/systems-procedural-audio.md)
