# SIREN and ORACLE fidelity

**Status: design, 2026-10-11.** The audio engine's fidelity limits and the mixing it lacks, split off
from [deadball-glass2.md](deadball-glass2.md) so the work can go ahead on its own. Every view gains
from it: the city, the rink, the TV and the voice. Nothing here is built yet.

Deadball's 3-D view needs about 50 layered, synthesised cues that always sit under an announcer.
Today the engine can't hold that balance, and its noise, filters and space limit how real a cue can
sound. Read [systems-procedural-audio.md](../systems-procedural-audio.md),
[amp-format.md](../amp-format.md) and [systems-accessibility.md](../systems-accessibility.md)
first. Search SIREN by `buildLayer`, `layer.fm` and `voices`, and ORACLE by `Speech`,
`pronounceWord` and `voiceFromName`; grepping "siren" finds unrelated sirens.

## What the engine does today

All in [client/shared/audio-engine.js](../../client/shared/audio-engine.js) unless named.

- **Buses.** Five (music, sfx, ambient, tv, ui) feed a plain master gain; there's no compressor or
  limiter on the master (`ensureContext`, line 64). Any category that isn't tv, ambient, music or ui
  goes to sfx. Speech goes to tv; in-world Read Aloud goes to ui.
- **Sliders.** One per bus, stored in `architect_settings.audio`. Defaults are master 0.40, music
  0.40, sfx, ambient and tv 0.25 ([settings.js](../../client/shared/settings.js)). `_applyGains`
  (line 287) re-sets the bus gains, so anything else that moves them is overwritten.
- **Ducking.** Nothing ducks for speech. `duckLoop` (line 1531) dips one loop, and only the rain and
  wind beds use it, under thunder.
- **Noise.** `getNoiseBuffer` makes one 2-second mono buffer of white noise, and every noise layer
  plays it from the start. Layered noise is identical, and a long bed repeats every two seconds.
- **Filters.** `buildLayer` (line 500) never reads a filter's gain, so peaking and shelf filters do
  nothing.
- **Space.** There's no per-layer pan and no per-cue reverb send; `pan`, `muffle` and `swell` are
  `playSfx` options for the whole cue. The reverb is a generated impulse with seven rooms, picked by
  the listener's zone, with fixed sends per bus (sfx and ambient 1, tv 0.45, music and ui dry).
- **Voices.** A 32-slot pool with priority stealing; [amp-format.md](../amp-format.md) still says 16.
  Stealing a synth one-shot doesn't silence it, because its release is already scheduled.
- **Speech.** `speak()` (line 2873) returns `{duration}` and has no volume option. There's one
  global voice, so each `speak()` cancels the last, and the PA, the welcome, the library, Read Aloud
  and the TV cut each other off. Every typed command calls `shush()` in
  [logreader.js](../../client/game/js/logreader.js), which cancels all speech, even with Read Aloud
  off. Natural Read Aloud uses the browser's speech, outside Web Audio.
- **The sampler** reduces recorded clips to 16 kHz and 8 bits unless `snes_bits` is 0.
- **Tools.** The Voice Lab saves nothing; Copy puts JSON on the clipboard. The Audio tab's layer
  editor can't edit `pitchBend`, `detune` or `formants`, drops `op2`'s wave and sweeps on save, and
  always previews on the sfx bus.

## The work, in order

1. **A limiter on the master.** A `DynamicsCompressor` after the master gain, set as a brickwall
   limiter (threshold about -1 dB, fast attack, ratio 20). Nothing should clip when a roaring crowd,
   fireworks and a shout land together.
2. **Ducking.** One duck gain node per bus, created in `ensureContext` between the bus gain and the
   master, so `_applyGains` never touches it. An API, `duck(buses, dB, { attack, hold, release })`,
   that schedules gain ramps. `speak()` ducks the named buses for its own `{duration}`; natural Read
   Aloud drives the same duck from its utterance start and end events.
3. **Speech channels.** At least two: the TV and announcer channel, and the Read Aloud channel. Each
   has its own short queue. A typed command cancels only Read Aloud. A new line on one channel
   doesn't cancel the other; the TV channel ducks under Read Aloud instead.
4. **A sub-gain pair under the tv bus**, voice and effects, so a broadcast can keep its effects a
   fixed number of decibels under its voice inside one player slider.
5. **Noise.** Eight-second stereo buffers in three colours (white, pink, brown), made once. Each
   noise layer starts at a seeded random offset, which ends the identical-layer phasing for every
   existing cue. A new layer field, `noise: 'pink'`, picks the colour; the default stays white.
6. **Filter gain.** Read `filter.gain` (in dB) so `peaking`, `lowshelf` and `highshelf` work.
7. **Space.** A per-layer `pan` and `width`; a per-cue `send` that overrides the bus's reverb send;
   and rooms that can be picked by name as well as by zone, with a new open-air room for a ballpark:
   a slap-back off the stands at about 120 ms and a short tail.
8. **Tools.** Voice Lab presets saved to content as files, so a voice is tuned once and kept; the
   Audio tab's layer editor editing `pitchBend`, `detune` and `formants`, and keeping `op2`'s wave
   and sweeps; previews on the cue's own bus.
9. **Docs.** [amp-format.md](../amp-format.md) gets the 32-voice pool and the new layer fields;
   [systems-procedural-audio.md](../systems-procedural-audio.md) gets the noise, the filters, the
   sends and the rooms; [systems-accessibility.md](../systems-accessibility.md) gets the speech
   channels and what a typed command now cancels.

## Rules

- Client only. No server change and no query.
- Existing cues keep their sound, apart from the noise offsets, which only remove phasing. New fields
  are opt-in.
- Read Aloud keeps working exactly as its doc describes for the player: a command or Escape still
  stops it.
- Each step gets a check in the `audio` gate group ([manifest.mjs](../../scripts/gates/manifest.mjs),
  next to `scripts/audio/sea-smoke.mjs`). A gate is pure: no AudioContext exists under the gates, so
  each check reads the built node graph or the generated buffers through a stub.
- Run `npm run test:regress` before pushing, and never two at once.

## Done when

- A cue built with `noise: 'pink'`, a peaking filter, a pan and a send sounds as written, and the
  gate proves the graph it builds.
- A shout over a full crowd bed doesn't clip, and the bed ducks under it and comes back.
- Typing a command while the TV speaks leaves the TV speaking.
- The Voice Lab can save a voice and load it back.
