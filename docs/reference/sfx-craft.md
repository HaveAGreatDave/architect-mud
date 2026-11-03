# Sound effects craft: what makes a SIREN effect sound like something happened

**Status: as built** (`scripts/audio/sfx-lib.mjs`, `scripts/audio/sfx-lint.mjs`,
`scripts/content/build-sfx.mjs`, `scripts/audio/sfx-smoke.mjs`, and `vary` and rand `density`
in [amp-format.md](../amp-format.md#vary)).

On 2026-11-02, 21 of the 26 preset effects were one oscillator through one envelope, ten of them a
single pure partial. Fifteen of the 38 presets and beds peaked over -1 dBFS on their own, every
ambient bed was a single layer, and footsteps on the hardest floors were 12 LU quieter through a
laptop's speaker than through headphones. None of that is taste: each is measurable, and
`sfx-lint.mjs` measures it. This doc is the rules it checks and the building blocks that meet
them.

## A sound is three things

A real sound is a **transient** (the first few milliseconds: a click, a crack, a snap), a **body**
(what it is: a thump, a ring, a buzz, a tone) and a **tail** (what it leaves: a rattle, a decay,
dust, the room). The old presets were a body alone, which is why they read as beeps. Build every
cue from all three, even a UI blip, whose transient is a 3 ms click and whose tail is its own
second partial.

`sfx-lib.mjs` has one function per layer, with defaults that already sound right:

| | | |
|---|---|---|
| **Transients** | `click`, `crack`, `tick` | band-passed noise, a few ms to tens of ms; a tiny pitched click |
| **Bodies** | `thump`, `knock`, `sub`, `ring`, `fmRing`, `buzz`, `servo`, `zap` | a sine dropping onto its pitch; its audible half; the low end; a struck object (`RATIOS`); FM metal and glass; mains hum; a motor; an arc |
| **Tails and movement** | `whoosh`, `tail`, `rumble`, `rattle` | a sweeping band; a decaying room; brown noise; scattered clicks |
| **Signals** | `blip`, `glitch`, `chime` | a UI tone with an edge; a burst of data; a few blips ringing longer |
| **Beds** | `air`, `crackle`, `hum` | moving filtered noise; noise gated into sparse bursts; a held hum with harmonics |

`cue({ id, category, duration, layers })` flattens the layers, names a waveform on each, renumbers
every seed from the cue's own id (so changing one cue never moves another), and gives the cue its
category's default `vary`. `build-sfx.mjs` is the worked example: every preset and bed, each with
a line saying what it is.

## The rules

- **Something above 250 Hz.** A thump alone is a sine a laptop or phone barely plays. Put a
  `knock`, a `crack` or a `click` over every low body. The critic flags a cue that loses over
  10 LU through a laptop-sized speaker (a 250 Hz fourth-order high-pass).
- **Never a bare tone.** A UI sound should sound designed, not like a test signal: give it a
  click on the front, a little FM, and a second partial (`blip` does all three).
- **Impacts have an attack.** A combat cue's peak should be well over the level of the 100 ms
  after it. A cue that leads in (a swing before the cut) is judged where it lands.
- **Release, don't chop.** A sound falls from -20 dB to -60 dB over tens of milliseconds. Three
  milliseconds or less is a cut the ear hears as a tick.
- **Don't step from silence.** A noise burst or a strike can start at full level, but a waveform
  that starts high and stays on one side of zero is a click. Give a square or a saw an attack.
- **Vary what repeats.** A cue that fires again and again (a hit, a step, a click) gets `vary`, so
  ten in a fight aren't ten copies of the same samples. `cue()` sets a default per category:
  combat ±70 cents, ±8% time, ±150 cents filter, ±1.5 dB; UI ±18 cents and ±0.8 dB; an
  announcement like `architect_notice` sets `vary: null`.
- **Level to a target, under a ceiling.** The build renders each cue and scales it to its
  category's loudness (`TARGETS` in `loudness-lib.mjs`) with its peak held under -1.5 dBFS. A
  one-shot that sounds for under a quarter of a second aims 4 LU lower: the loudest 400 ms window
  is mostly silence for it, and the only way such a cue reaches the full target is to peak over
  full scale. The shots and punches before this did, by up to 4 dB.
- **Drive a short transient rather than turning it up.** Noise peaks far above its level. When a
  crack or a swing can't reach its target under the ceiling, `drive` on its main layers (sfx-lib's
  build script has a `driven()` helper) rounds the peaks off and makes it denser at the same
  ceiling. That's what a designer does with a limiter.
- **Beds move.** A held bed with nothing changing in it is a tone. Use `air` (a slow smooth random
  on the cutoff and the level), `crackle` (a rand mod with `density`) and `sparkle` (one-shots the
  engine fires at random over the bed: drips, pops, clanks). Every bed needs something a laptop
  plays.

## The critic

```
npm run audio:sfxlint                                  every preset, bed and generator sweep
node scripts/audio/sfx-lint.mjs combat_hit --why       one cue, with the reasons
node scripts/audio/sfx-lint.mjs --module scripts/content/build-sfx.mjs
```

It renders each cue through the real engine at 48 kHz and reports, with the thresholds:

| | |
|---|---|
| `click` | the first millisecond starts over 25% of peak and stays to one side of zero, or a sample-to-sample step over 3x the local level on a steady signal |
| `cut` | falls from -20 to -60 dB in 3 ms or less at its end |
| `hot` | peaks over -1 dBFS on its own |
| `dc` | a mean over 1% of peak, on something that sounds for over 0.6 s |
| `alias` | its tonal layers' octave-band spectrum at 48 kHz is over 1.5 dB per octave off a 192 kHz render of them (noise is left out: pink and brown are filters tuned per rate) |
| `beep` | one tonal partial, nothing else, in one layer |
| `thin` | a single layer outside the ui category |
| `small` | over 10 LU quieter through a laptop-sized speaker |
| `soft` | a combat cue whose peak is under 1.5x the level after it |
| `same` | a procedural cue whose two seeds render the same samples |

A bit-crushed cue (`retro`) isn't checked for clicks or a cut: it steps and stops at its
quantisation floor on purpose. The checks were validated on cues built to fail each one before
they were trusted on the game's.

`sfx-smoke.mjs` (in the audio gate) holds every shipped preset and bed to no findings, without
the aliasing render, which costs four times the samples. It also checks `vary` and `density`.

### Measured

| | presets with findings | beds with findings | peaks over -1 dBFS |
|---|---|---|---|
| before | 21 of 26 | 12 of 12 | 15 |
| after | 0 | 0 | 0 |

The procedural generators went from 13 to 3 findings at the detail most players hear. The changes:
a heel on hard floors (stone, lino and boards now lose 7-10 LU through a laptop instead of 11-13),
the contact when a door meets its jamb, a contact layer on stone and wood impacts, and a low body
under the whiff. Footsteps and doors are within 1 LU of their old loudness. The heavy whiff is
7 LU louder; it had been -49 LUFS, nearly inaudible. The three left are borderline (`small` by
under 1.5 LU on one lino seed, the shutter close and the stone impact). A heavy-calibre gunshot
can still peak around -0.7 dBFS.

## Engine changes that came with it

- **`vary`** on a cue: a fresh draw of pitch, timing, filter and gain on every `playSfx`.
  `renderSfx` renders it as authored unless given a `vary` seed.
- **A held bed's random and sequenced mods keep moving.** They scheduled 30 seconds of steps and
  then froze; a bed now schedules the next stretch while the one before plays, until it's
  released or its voice is stolen.
- **`density` on a rand mod**: each step is +1 with that chance and -1 otherwise, so an `amp`
  cable gates a layer into sparse bursts. Fire, static, rain on a roof, a Geiger counter.
- **The Node renderer plays constant sources.** Before this, every env, rand and seq mod sat out
  of an offline render, so levelling, the loudness gate and the critic measured cues without
  their filter sweeps, gusts and gating. The music loops' mix was re-measured after the fix.
- **`critBoost` leaves a layered crit alone.** It added 4 dB and FM to every layer, which put the
  new `combat_hit` over full scale and turned its thump into a growl.
