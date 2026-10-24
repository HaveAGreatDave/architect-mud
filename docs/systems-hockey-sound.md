# CPhL Sound (as built)

The Cluster Puck League's sound: an FM-synthesised homage to a mid-1990s console hockey cartridge
(NHL '96 on the 16-bit machines). Hard, dry, immediate transients; short, crunchy, slightly metallic
impacts; a woody stick; a check that's a thud and a crack; brief scrapes; a plain piercing whistle; a
big blunt goal horn; a coarse crowd. It recreates none of the original's assets or hardware, only the
character, and it's tuned to read at low volume on cheap speakers in a busy mix.

Everything is procedural. There are no samples.

## Where it lives

| File | What |
|---|---|
| [client/shared/hockey-sfx.js](../client/shared/hockey-sfx.js) | The patches (data in SIREN's layer schema), the variation, the rink's event table, and the crowd bed |
| [client/shared/audio-engine.js](../client/shared/audio-engine.js) | SIREN, which plays them. The exponential envelope, seeded noise, the retro stage, `renderSfx` and `wavBytes` were added for this |
| [client/shared/audio-retro-worklet.js](../client/shared/audio-retro-worklet.js) | The retro stage's AudioWorklet: sample-and-hold and bit depth |
| [client/game/js/panels/gameday-rink.js](../client/game/js/panels/gameday-rink.js) | Plays the rink's events through the event table, steers the crowd, ducks it |
| `client/game/js/panels/rink/sim.js`, `director.js` | Fire the events, with what they know (the puck's speed, a long whistle) |
| [client/devpanel/js/panels/audio.js](../client/devpanel/js/panels/audio.js) | The sound board and the editor's envelope and retro fields |
| `scripts/audio/hockey-smoke.mjs` | The gate (below) |
| `scripts/audio/hockey-render.mjs` | Renders every patch, prints its measurements, writes WAVs |
| `scripts/audio/hockey-mix.mjs` | Plays a stretch of a real game through the rink and renders the mix as heard: the crowd against the effects, each effect's margin over the crowd, WAVs |
| `scripts/audio/offline-audio.mjs` | The Web Audio subset SIREN uses, rendered in Node, for the two above |

## How it plays

The soundset contains no synthesizer. A patch is a cue in the catalog's own shape (`{ id, name, group:
'hockey', category, priority, vary, config: { duration, layers, retro } }`), so `sfx-catalog.js` folds it
in, the dev panel lists and edits it, and an override saved there (`interface_sfx`) replaces the default
for every client. The game page doesn't load it at boot: the rink view injects it on its first mount and
hands it to `SFXCatalog.addBank`, so the dev panel's `<script>` tag is the only static one. A layer is an FM voice or a band of noise, exactly as [amp-format.md](amp-format.md)
describes: a carrier, a modulator ratio, a modulation index that falls as the sound dies (`index` to
`indexEnd`), a pitch envelope (`pitchBend`), a biquad, and an exponential envelope.

`AudioEngine.playSfx` plays it like any other cue: a slot in the 32-voice pool by priority, its layers
into the bus for its category, the bus into the master. Effects go to the **sfx** bus and the crowd to the
**ambient** bus, so master, effects and crowd have their own volumes (the game's existing sliders). The
engine's output rate never changes.

A cue with `retro: { rate, bits }` goes through the retro stage first: every sample is held for 1/rate of
a second (the steps are the grit of an 8–16 kHz cartridge sample), then rounded to `bits`, both relative
to the cue's own full scale, so a quiet tail gets grittier as it decays. It needs an AudioWorklet, loaded
from beside `audio-engine.js` once per context (the game's CSP allows scripts from its own origin). Where
there are no worklets, bits alone go through a WaveShaper staircase and the hold is skipped; a cue never
goes silent for want of it.

## The patches

Measured by `hockey-render.mjs` at 48 kHz: the peak before the bus, how long it stays within 50 dB of
that peak, and its spectral centroid around the peak. Priority is out of 10.

**A. Puck on stick.** A high inharmonic transient (2.9 kHz carrier, 1.41 modulator, index 1.6–2.6 gone
in 8 ms, falling 9% in pitch), a knock of body under it (520 Hz), and 6–9 ms of noise.

| Patch | Priority | Peak | Length | Centroid |
|---|---|---|---|---|
| `hk-puck-stick-light` | 3 | 0.25 | 30 ms | 3.6 kHz |
| `hk-puck-stick` | 4 | 0.37 | 37 ms | 3.0 kHz |
| `hk-puck-stick-hard` | 5 | 0.37 | 45 ms | 2.6 kHz |

**B. Puck on the boards.** A short low thump (160 to 115 Hz), a hollow knock (560 Hz with a 2:1
modulator, so odd harmonics), a wooden crack (1.85 kHz, ratio 1.73), a breath of noise. The resonance is
held short.

| Patch | Priority | Peak | Length | Centroid |
|---|---|---|---|---|
| `hk-boards-soft` | 4 | 0.32 | 60 ms | 700 Hz |
| `hk-boards` | 5 | 0.42 | 79 ms | 650 Hz |
| `hk-boards-hard` | 6 | 0.51 | 97 ms | 600 Hz |

**C. Puck on a man** (`hk-puck-body`, priority 6). A 28 ms crack (2.3 kHz) over a 60 ms thud (330 to
250 Hz) on their own envelopes, with a little noise. 0.32 peak, 80 ms, 520 Hz.

**D. Body check.** The low impact at once (130 to 88 Hz, high-passed at 60 Hz), the body (340 Hz, 2:1),
a noisy inharmonic crack 3 ms in (1.65 kHz, ratio 2.41, index 3–4), and a rough mid tail (noise at
950 Hz). The boards version adds the boards' own knock 12 ms later at about half level, not a second
full impact.

| Patch | Priority | Peak | Length | Centroid |
|---|---|---|---|---|
| `hk-check-light` | 7 | 0.32 | 102 ms | 760 Hz |
| `hk-check` | 7 | 0.46 | 118 ms | 665 Hz |
| `hk-check-boards` | 8 | 0.49 | 145 ms | 635 Hz |

**E. Skating.** Two bands of noise (around 1.8–2.9 kHz, Q 1.7 and 2.2) pulsed by two tremolos at rates
that never line up (12–21 Hz and 1.73 times that), a faint pitched hiss under them, and a 12.5 kHz hold.
The braking scrape sweeps down.

| Patch | Priority | Peak | Length |
|---|---|---|---|
| `hk-skate-scrape` | 2 | 0.08 | 97 ms |
| `hk-skate-turn` | 3 | 0.09 | 189 ms |
| `hk-skate-stop` | 4 | 0.14 | 234 ms |

The rink plays a scrape when a hard stop throws snow and on a hard turn at speed (each man no more than
once in 1.2 s), and the view spaces all of them out (`SFX_GAP`), so nothing scrapes on every step.

**F. Whistle.** 2,950 Hz with a quieter tone 45 Hz above it, so the two beat into a pea whistle's
flutter, a 3% rise into pitch at the start, 7 cents of vibrato and a breath of noise. No retro stage.
`hk-whistle-short` (206 ms) for an ordinary stoppage and `hk-whistle` (446 ms) for a penalty or a man
down. Both priority 9, centroid 2.96 kHz, nothing below 150 Hz.

**G. Signal.** `hk-signal`: one clean note (1,046 Hz) stepping up two semitones, a gentle 2:1
modulator, an 11 kHz hold at 8 bits for the coarseness, 183 ms. `hk-signal-two`: two notes a fourth
apart, 273 ms. Both priority 6, well under the whistle.

**H. Goal horn.** A fog horn, the air horn off a ship that an arena bolts under its roof. Two sawtooth
reeds at 116 Hz 0.9 Hz apart, so the blast wobbles slowly as two horns do, each scooping up 8% into
its pitch over 0.16–0.2 s as the air arrives, through 1.5–1.9 kHz lowpasses, with a 6 Hz flutter.
Over them a brassy 2:1 FM partial at 232 Hz (index 1.4 settling to 0.6), the 3rd and the 4th, which
is what a phone speaker plays of it, and a band of breath at 560 Hz. On the release it groans down
most of a fifth (668 cents) as it dies: each reed is pitched a fifth low and an envelope mod
(`GRUNT`) holds it up to the note, so the release takes the pitch down with the level. A late
layer for the grunt held its voice a second past the sound. 16 ms to half its peak, 420 ms releases
on the reeds, no reverb tail and no crowd in it. `hk-goal-horn-short` 1.1 s, `hk-goal-horn` 2.0 s;
one blast, never repeats. Priority 10, 0.57 peak, the loudest sustained sound in the bank (RMS 0.16),
centroid about 230 Hz with 42% of it under 150 Hz.

**I. Period end** (`hk-period-horn`). A buzzer: 330 Hz square, with 1.5×, 2× and 3× partials (the fifth
in it), a faint 7.5 Hz electric flutter. 1.6 s, priority 10, centroid 880 Hz against the horn's 230, so
the two are plainly different played back to back. The rink plays it when a period ends (the
intermission) and on the final card; a whistle before it is the game's sequencing.

**J. The crowd bed** (`crowdBed()`). A low-mid rumble (150–700 Hz), an airy band (around 1.15 kHz,
700–3,000 Hz), and three narrow resonant bands where distant voices sit (520, 930, 1,650 Hz), each pulsed
by LFOs at 0.29–2.3 Hz that never line up, all through a 2.4 kHz lowpass onto the ambient bus, with no
grit. Built once and steered: `setState(name)` eases every band to that state's levels (a 180 ms time
constant, 600 ms into quiet), and the moments move it and let it settle.

It's background, and kept there. The first bed sat at -32 dBFS through a game, louder than all the
effects together, and its hiss buried the clicks and seemed to grow (the rink also held it high for
every rush). Now, at the game's default volumes, the run of play sits at about -45 dBFS at the master
and a goal at about -36, centred near 1 kHz, under the clicks and the whistle rather than in their band.

| State | Rumble | Air | Voices | Pulse depth | Air band |
|---|---|---|---|---|---|
| quiet | 0.22 | 0.045 | 0.25 | 0.18 | ×0.85 |
| active | 0.32 | 0.07 | 0.35 | 0.25 | ×1 |
| chance | 0.40 | 0.10 | 0.45 | 0.30 | ×1.1 |
| shot | 0.48 | 0.13 | 0.55 | 0.32 | ×1.15 |
| goal | 0.70 | 0.20 | 0.80 | 0.38 | ×1.25 |
| penalty | 0.38 | 0.07 | 0.60 | 0.45 | ×0.85 |

`gasp()` holds the bed back an instant and plays `hk-crowd-gasp`; `cheer()` and `celebrate()` lift it
(1.3× and 1.5×) and play `hk-crowd-cheer` or `hk-crowd-goal`; `duck(db, secs)` drops it under a horn or
a whistle and brings it back; `stop()` fades it and lets its nodes go. All of it is automation on the
same nodes, so it can't pile up.

**K. Gasp and cheer.** `hk-crowd-gasp` (438 ms): a fast rise of bright noise and a vowel-ish resonant
band sweeping 620 to 860 Hz. `hk-crowd-cheer` (1.4 s) and `hk-crowd-goal` (3.3 s): dense bands of noise
with tremolos at 3.1–11.3 Hz for the irregular pulses. `hk-crowd-groan` and `hk-crowd-boo` are the away
goal and the penalty. They ride the ambient bus with the bed, lifted a little (1.2×) to sit with it.

**Secondary.** Shots (`hk-puck-slap`, `hk-shot-wrist`: a crack with a small fall in pitch), `hk-pass`,
`hk-puck-tick` (the dribble), the saves (`hk-pad-save`, `hk-glove-save`, `hk-chest-save`), `hk-stick-hit`
(a stick on a stick), `hk-stick-break`, `hk-post` (the one sound allowed to ring, 586 ms), `hk-net`,
`hk-glass`, `hk-puck-glass`, `hk-fall`, `hk-gloves-drop`, the fight (`hk-punch`, `hk-punch-big`,
`hk-punch-miss`, `hk-grapple`, `hk-knockout`), `hk-box-knock` (a stick rapped on the penalty box) and
`hk-faceoff-drop`. The fighter sandbox (`tools/sandbox/hockey-fighter-test.html`) plays these by id,
which is why every id the bank had before is still there.

## The rink's events

The rink names what happened and `HockeySfx.eventFor(key, data)` says which patch and how hard
(`EVENTS` in hockey-sfx.js). The main ones:

| Event | Patch |
|---|---|
| `receive`, `pass`, `tick`, `sweep` | `hk-puck-stick`, `hk-pass`, `hk-puck-tick`, `hk-puck-stick-light` |
| `shot` | a slapper or a one-timer `hk-puck-slap`, a tip `hk-puck-stick-hard`, otherwise `hk-shot-wrist` |
| `boards` | the puck by its speed: `hk-boards-soft` under 32 ft/s, `hk-boards` under 60, `hk-boards-hard`; a man, `hk-boards-hard` |
| `glass` | the puck `hk-puck-glass`; a man `hk-glass` |
| `check` | soft `hk-check-light`; into the glass `hk-glass`; from behind `hk-check-boards`; otherwise `hk-check` |
| `whistle` | `hk-whistle` when long (a penalty, a man down), otherwise `hk-whistle-short` |
| `horn`, `periodHorn` | `hk-goal-horn`, `hk-period-horn` |
| `wide` | nothing: a wide shot is heard when it hits the boards |

The crowd follows the plays and comes back to the run of play (`active`) after each moment: a rush on
its own doesn't move it, a shot lifts it to `shot` for 1.6 s, a breakaway to `chance` with a cheer for
3 s, a penalty to `penalty` for 4 s, a fight to `shot` with a cheer for 5 s, a home goal to `goal` for
6 s (ducked under the horn's onset, then a celebration 0.2 s later), and an empty net holds it at
`chance`. An injury, a death or an intermission take it to `quiet`. The iron gets a gasp; a home save
or a big hit a cheer; an away goal the groan.

The small sounds are spaced so they stay small: a dribble tick no more than one in 0.9 s, a skate stop
one in 0.9 s, a hard turn one in 1.4 s (and each man's no more than one in 3 s), all of them quiet.

## Mixing

- **Priority**, in the brief's order: horns 10, whistle 9, checks, saves and big collisions 7–8, puck
  impacts and shots 3–6, skating 2–4, crowd one-shots 1–3. A lower priority can't steal a higher one,
  and a stolen voice fades out over its own release rather than stopping.
- **Under a horn or a whistle** the contacts play at 0.6 and the crowd ducks (5 dB for 0.3 s under the
  horn, 3 dB under a whistle), so a scramble of pucks can't bury either.
- **Headroom by design**, not by a limiter: no patch peaks over 0.6 before its bus, and the busiest
  moment (horn, whistle, a check into the boards, the celebration and eight contacts in half a second)
  peaks at under full scale at the master. No limiter was added to the master bus.
- **Mono throughout.** A contact is panned at most halfway, by where it happened against the camera.

## Variation and determinism

`HockeySfx.variant(def, seed, amount, intensity)` is one take: a single pitch factor for the whole cue
(so partials keep their ratios), a level and a decay factor, all inside the patch's own `vary` (an
impact ±4% pitch, ±12% level, ±10% decay; a whistle or a horn ±0.4%, ±3% and none), and each noise layer
from its own place in the noise buffer. `intensity` (0–1) scales the level (to 0.45 at 0) and dulls the
index and the filters a little. The noise buffer is seeded, so a seed is the same take on every client
and in every render. The rink seeds a take from its own clock.

## Tuning

**In the dev panel** (Audio tab, the Hockey group). The sound board plays any patch at a given take
and intensity (three takes in a row to hear the variation), the moments of a game (a rush, a goal, a big
hit, the end of a period, and everything at once), and the live crowd through its states; ⬇ WAV renders
the take offline in the browser and saves it. ✏ on a patch is the layer editor: frequency, the FM block,
the envelope and its shape (linear or exponential), the filter, noise, drive, gain, and the cue's retro
rate and bits. ▶ Preview plays the unsaved edit; saving reaches every client; ↺ goes back to the default
here.

**Offline.** `node scripts/audio/hockey-render.mjs --wav <dir>` writes every patch (and the crowd
through every state) as WAVs and prints the measurements; `--only hk-check` narrows it, `--takes 4` adds
seeded takes. `node scripts/audio/hockey-mix.mjs 37 --seconds 120 --wav <dir>` plays two minutes of a
real game and renders what a player hears: how loud the crowd runs against the effects, and how far each
kind of effect stands above the crowd when it plays (a contact wants 15 dB or more), with the mix, the
crowd and the effects as WAVs. Use it after changing any level: a sound that's fine on its own can still
be lost in a game.

What the controls do:

- **The index and its fall** (`index`, `indexEnd`, `slide`) are the strike. A high index gone in 10 ms
  is a click; the same index left up is a buzz.
- **The modulator ratio** sets the material. 2 is hollow and woody (odd harmonics), 1.41, 1.73, 2.41 and
  2.76 are inharmonic (a collision, metal). Avoid 1 and 0.5 on anything that lasts: SIREN modulates the
  frequency, so those put a sideband at 0 Hz, a DC offset (the horn had 39% before it moved to 2).
- **Drive** normalises at full scale, so on a quiet layer it's mostly a boost (up to 25 times at drive 1).
  Nothing in the bank uses it now: driven, the fog horn's reeds came out at three times their peak.
- **Retro**: 16 kHz at 10 bits on impacts (a little), 12.5 kHz at 9 bits on scrapes, 11 kHz on the
  signals and the coarse crowd parts, none on the whistle.

## Tests

`scripts/audio/hockey-smoke.mjs` (the `audio` gate group, about 12 s of CPU) renders every patch and the
crowd through the real engine on the offline renderer and checks: finite samples starting and ending in
silence, no DC, a peak with headroom, each kind's length and attack inside the brief's range, where each
sits (a stick click over 1.5 kHz, a check under 40% below 150 Hz, the whistle at 2–3.5 kHz, the buzzer
well above the horn), the brief's priority order, that a seeded take renders the same samples twice and
stays within its variation, that the retro stage holds and rounds, that the busiest goal doesn't clip
and the horn stays over the contacts, that a flood of contacts never steals the horn or the whistle and
every voice comes free, that the crowd rises state by state with no step and no new nodes and is silent
after `stop()`, that the run of play sits at -40 dBFS or under at the master with a puck on a stick 18 dB
clear of it and the bed centred under 1.2 kHz, and that every event the rink fires has a sound. The rink
smoke checks the same last point while a game plays.

The offline renderer agrees with Chromium's own Web Audio to within a few percent (peak, length and
centroid, checked on nine patches; the board knock is 0.412 peak, 79 ms and 649 Hz in Chromium against
0.417, 79 ms and 648 Hz in Node), and Chromium's live path ran the retro worklet, the voice pool and the
crowd bed with nothing stolen, dropped or left playing.

## Limitations

- Nobody in the build has listened: the numbers say each sound is the length, pitch and shape the brief
  asks for, not that it sounds like NHL '96. That's the dev panel's job.
- An override saved in the dev panel before this replaces the new default for that id until it's reset.
- The crowd is noise and resonance, with no voices in it.
- Where there's no AudioWorklet the retro stage rounds bits but doesn't hold samples.
