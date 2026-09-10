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

`zone.entered` · `enemy.killed` · `enemy.attacked` · `player.death` · `item.taken` · `item.dropped` · `device.tuned` · `bodily.sfx` · `flight.strafeIncoming` · `flight.aaFired` · `cooking.sfx` · `movement.step` · `door.sfx` · `player.respawn`

That list is the extension point: a new system makes sound by **emitting an event**, not by importing this plugin.

One exception, and it earns it: **being hit** rides `registerDamageObserver` rather than an event,
because the enemy→player side runs inside `combat.js` and emits nothing a plugin can hear. That
observer is **sync and query-free by contract** — it fires on every incoming swing of every fight, so
everything in it is a table lookup and a socket write.

## Combat

Voiced off two axes that are already on every weapon and enemy: `weapon_skill` going out (it is the
only one that separates a pistol from a bat — both are `kinetic`), `damage_type` coming in (an
enemy's attack is a damage roll, not an item). Nothing new is authored, so a weapon is audible the
day it is tagged. `radiation` maps to `null` deliberately; see
[systems-procedural-audio.md](../../docs/systems-procedural-audio.md#combat).

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
