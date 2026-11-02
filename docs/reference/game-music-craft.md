# Game music craft: what makes a tracker song sound written

**Status: as built** (`scripts/audio/compose-lib.mjs`, `scripts/audio/song-lint.mjs`, the
`swing` and `nudge` fields in [amp-format.md](../amp-format.md#groove),
`scripts/content/build-ambient-loops.mjs`).

The songs that sounded flat had the same faults: one velocity a channel, every note a row long,
the same bar repeated, two or three channels, a melody that hopped. None of that is taste; each is
measurable, and `song-lint.mjs` measures it. This doc is the rules it checks and the defaults
`compose-lib.mjs` writes, with the reasons.

## Arrangement

- **One role a channel, one octave a role.** Bass E1-C3, pads and arps around C4, lead C4-C6, and
  the lead at least an octave above the bass. Two moving parts in one octave blur.
- **The bass is a second melody**, not a held root: octave and fifth pickups, a figure that
  changes in B.
- **Arpeggios imply chords** and belong above middle C; below it they mud up.
- **The echo channel**: the lead copied three rows later (a dotted eighth), at about 0.4-0.5 of
  its velocity, panned to the other side. Never echo the bass. `Part.echoOf` does it.
- **Call and response**: the lead plays two bars and rests two while something answers.

## Form and loop fatigue

Make a loop at least as long as half the time a player usually spends in the place, and vary it
inside: players stop noticing a loop after two hearings and start minding it after three to five.
The build script's form is A A' B A'' at 8 bars a section:

- **A** the tune over pad, bass and a light kit; **A'** the same tune with its echo and the arp;
- **B** new chords and a second tune for half the section, then the arp alone, the drums in another feel;
- **A''** everything, the tune varied, a fill into the loop point.

Start the loop full, not thin, and end it on a chord that leans back into the first (V, ♭VII or
♭II into i), so the wrap sounds like a phrase rather than a splice.

## Harmony and melody

- **Minor-key loops that loop:** i-♭VI-iv-V, i-v-iv-♭VII, ♭VI-♭VII-i, and the Mario cadence
  ♭VI-♭VII-I for a lift.
- **Mode for mood:** Phrygian (the flat second, i-♭II) for dark and cyberpunk; Dorian (raised
  sixth) for a minor that isn't mournful; Lydian (raised fourth) for wonder with an edge; harmonic
  minor's V7 for menace.
- **Steps, mostly.** 60-75% of melodic moves by step, 10-20% repeated notes, leaps rare and
  followed by a step back the other way (von Hippel and Huron: after a leap away from the middle
  of the range, melodies tend to return).
- **Chord tones on the strong beats**, passing tones between. `realise` lands the bar's downbeat
  on a chord tone by moving at most one scale step, so the landing never makes a leap.
- **A phrase is a motif, its answer, a sequence and a cadence.** `motif`, `vary` and `realise`
  build that from rhythmic cells in half bars.

## Groove

- **Swing** (`song.swing`, 0.5 straight): 0.52-0.56 for driving or dark tracks, 0.58-0.62 for
  funk and noir, 0.66 a shuffle. It's the MPC convention: the share of each eighth the first
  sixteenth takes.
- **Velocity is the hands.** Hats about 0.9 on the beat and 0.65 off it; ghost notes 0.3-0.45;
  `HAT_ACCENT` is a sixteenth line that breathes. Leave beat one alone and vary the rest by up to
  ±10%. `Part.humanize` does that from a seed.
- **Timing:** a laid-back snare or hats a few milliseconds late (`nudge`, in rows), the bass a
  hair early; never move beat one.
- **Hold notes.** `len` on anything that should ring. A song where every note is one row long has
  nothing sustaining between attacks.
- **Velocity reaches timbre** on an FM instrument through `fm.bright`: a hard note is brighter,
  not only louder.

Groove is best at a medium level of syncopation (Witek et al. 2014: pleasure peaks in the middle
and drops off at both ends). `song-lint` reads groove consistency, 1 minus the mean Hamming
distance between consecutive bars' onsets: 1.0 is every bar the same; 0.75-0.95 is alive.

## Mix

- Bass and kick centred; lead near centre; echo, arp and hats spread, the arp opposite the hats.
- Relative levels to start from: kick 0 dB, bass -2, lead -4, snare -4, pad and arp -10,
  hats -12, echo -8 under the lead.
- Music sits under the game: about -16 to -20 LUFS for a browser game, true peak under -1 dBFS.
  The master limiter holds the peaks; don't rely on it for level.

## The critic

```
node scripts/audio/song-lint.mjs                       every synth song
node scripts/audio/song-lint.mjs --module scripts/content/build-ambient-loops.mjs
```

It reports scale fit (the best major-scale share; under 0.85 is stray notes, 0.85-0.9 is fine for
a theme that modulates), pitch-class entropy (over 3.3 bits is close to random), the lead's step
ratio and range, unrecovered leaps, repeated 4-bar blocks, one-velocity channels, groove
consistency, a bass off centre, a lead within an octave of the bass, no held notes, and loop
length. The lead is found as the most melodic upper channel that isn't a pad. It's report only.

`build-ambient-loops.mjs` uses it as an ear: it composes each song twelve times from seeds
derived from the song's own and keeps the take the critic grades best (a lead near 65% steps,
few hanging leaps, no warnings). The pick is deterministic, so `--check` holds.

## Sources

- Hugi 26, "Techniques of chipping"; OpenMPT's echoes.txt (echo rows and levels)
- NESdev wiki, Arpeggio
- Game Developer, "Rethinking the audio loop in games" (fatigue and loop length)
- Attack Magazine on DAW and drum-machine swing; Unison and MODE Audio on humanising
- Witek et al. (2014), PLoS ONE, syncopation and the pleasure of groove
- Hooktheory's minor-key chord statistics; Game Music Theory on the Mario cadence
- Shanahan on regression to the mean in melody (von Hippel and Huron)
- Yang and Lerch (2018), On the evaluation of generative models in music; MusPy metrics
- IESD mix reference levels; Audiokinetic on game loudness
