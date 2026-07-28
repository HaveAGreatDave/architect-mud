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

## See also
[docs/systems-procedural-audio.md](../../docs/systems-procedural-audio.md)
