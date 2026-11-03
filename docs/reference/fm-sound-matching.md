# FM sound matching: getting a SIREN cue to sound like a recording

**Status: as built** (`scripts/audio/sound-match.mjs`, `match-lib.mjs`, `sound-match-bench.mjs`).

Writing a cue by hand to imitate a real sound was hit or miss, for the reason every paper on the
subject gives: FM parameters don't map smoothly to what you hear. A ratio a few percent off moves
every sideband, so a cue can be one number away from right and sound nothing like it. This doc
says how the matcher works around that and how to use it, and gives the recipes to start from
when you write a cue by hand.

## Using it

```
node scripts/audio/sound-match.mjs door-slam.wav --name door_slam
node scripts/audio/sound-match.mjs bell.wav --start my-bell.json     refine a cue you wrote
node scripts/audio/sound-match.mjs x.wav --analyse                   what it hears, then stop
node scripts/audio/sound-match-bench.mjs some/folder --budget 1000   a whole folder, tabled
```

It writes `sound-match-out/<name>/` (gitignored): the cue as an `.amp`-shaped JSON for
`content/audio_sfx/` or the Audio tab's Load button, `target.wav` and `match.wav` to listen to
side by side, and `report.txt`. A thousand renders take 10 to 60 seconds depending on length; it
crops to the first 2 seconds (`--seconds`).

The distance it reports, for scale: the same patch a quarter-tone off is 0.37, a semitone off
1.05, and two takes of one noise patch 0.47 (noise never agrees bin for bin, so a noisy sound
never scores near 0). Under 0.7 is close, under 1.2 recognisable, over that it's the nearest the
templates could get. Listen anyway: metrics and ears disagree about one time in five.

`--start` is the most useful mode once you have a cue that's nearly right. It keeps every
discrete choice you made (waves, ratios, filter types, partial frequencies) and moves only the
numbers within a factor of three, which is the part people get wrong by ear.

## How it works

1. **Analyse first.** Envelope (attack, T60, sustain, where it's held), pitch by YIN with an
   octave check against the strongest partial, the partials just after the attack with a decay
   each, harmonicity, spectral flatness, and separate onsets in the first 60 ms (a clap's hands).
2. **Read the discrete choices off the analysis; never search them.** FM puts lines at
   |c + k·m|, so a carrier/modulator pair is scored by how much measured energy sits on its
   lines, less a little for each line it predicts that isn't there. Every carrier on one lattice
   makes the same lines, so a lattice is tried at its lowest carrier. This is what fixed the
   worst miss: a 330 Hz carrier at ratio 3.5 makes a spectrum whose strongest line is 1980 Hz
   and whose f0 is 165 Hz, and neither is the carrier.
3. **Template per kind of sound:** `fm` (one or two operators in series), `modes` (the measured
   partials as a struck object: bells, glass, bars, cowbells), `drum` (a body dropping onto its
   pitch under noise: kicks, toms, snares), `sub` (saw or square through a swept low-pass),
   `noise` (filtered noise with an envelope on the cutoff) and `clap` (one burst per onset).
4. **Screen, then search.** Every template is scored at its analysed starting point and the best
   eight go on (the best of each kind kept). Each gets a short CMA-ES run; the best three share
   the rest of the budget. CMA-ES is what the 2026 "Instrumental" study found beat gradient
   methods on synth matching, and it needs no derivatives of the engine.
5. **The distance** is log-magnitude spectra at four window sizes (256 for the attack, 2048 for
   the partials), smoothed over ±4% in frequency and three frames in time, plus spectral
   convergence and the loudness envelope. The log floor sits 55 dB under the target's loudest
   bin. Two things in that sentence were bugs first: with a fixed tiny floor a recording's room
   tone counted as a full error against a synth's silence, and without smoothing two takes of
   the same noise patch scored 1.03 apart.

Every candidate renders through the real `audio-engine.js` on the Node renderer, so a match is
exactly what the game plays. Nothing is approximated by a second synth.

### Measured

Fifteen real one-shots (808 kick, snare and hats, acoustic kick and snare, claps, a cowbell,
glass taps, metal hits, bottles), 1,000 renders each, scored on the final distance:

| | median | close | recognisable | missed |
|---|---|---|---|---|
| first version | 1.10 | 5 | 4 | 6 |
| as built | 0.82 | 5 | 7 | 3 |

The three still missed are quiet glass and bottle taps with a slow-rising onset and a loud noise
floor: the struck-object template can't shape an onset, and the noise floor is most of what
there is to match. Synthetic targets (a known FM bell, a two-operator pluck) come back with their
carrier and ratio recovered.

## Writing a cue by hand

Start from these and refine with `--start`.

| Sound | Shape | Notes |
|---|---|---|
| Bell | sine, `fm` ratio 1.4 or 3.5, index 4 → 0.3 over ~1 s, `adsr.curve: "exp"`, long decay | Chowning's bell is 1:1.4. Index collapsing with the amplitude is the strike |
| Glass, bars, cowbell | `modes` with measured ratios | wood bar 1, 2.57, 4.64, 6.98; aluminium bar 1, 2.76, 5.42, 8.99; wine glass 1, 2.32, 4.25, 6.63 |
| Wood block | sine, `fm` rate fixed (80 Hz carrier, 55 Hz modulator), index 25 → 0 in 0.2 s | a burst that settles to a near-sine |
| Brass | saw or sine at ratio 1 with index rising with the attack, filter opening | not ratio 1 on anything held: a sideband lands on 0 Hz (use 2 and a sub) |
| Clarinet, reed | ratio 2 or 1.5 (odd harmonics), index falling as the note swells | Chowning's 3:2 |
| E-piano | carrier sine, modulator ratio 14, index 1.1 → 0.04, `bright` for velocity | the DX7 tine; a second pair at ratio 1-2 for the body |
| FM bass | ratio 2, index 1.8 → 0.35 in ~0.2 s, a sub an octave down, `bright` | 1:1 is the classic but holds a DC sideband |
| Kick | sine body, `pitch` env +24 semitones decaying in ~60 ms, a 10 ms noise click | the drop is most of a kick |
| Snare | bandpassed noise ~2.5 kHz with a short triangle body, pitch env on the body | |
| Hat | highpassed noise, plus a square at an inharmonic ratio (2.7) with high index for metal | |
| Clap | three or four noise bursts 8-12 ms apart (`delay` per layer), the last with a longer tail | |

Index guide: about I+1 sideband pairs are audible, bandwidth ≈ 2·m·(I+1) (Carson's rule), the
carrier disappears at I ≈ 2.4. Under I ≈ 1.8 brightness rises smoothly with index; above it,
sidebands come and go.

## Sources

- Horner, Beauchamp & Haken (1993), GA matching of FM to acoustic tones: the carrier fixed by
  analysis, the rest searched. Cited via Macret et al., core.ac.uk/download/56375047.pdf
- Mitchell & Creasey, on the multimodal FM error surface and clustering evolution strategies
- Caspe et al. (2022), DDX7: ratios frozen from patches, envelopes learned (arxiv.org/abs/2208.06169)
- "Instrumental" (2026): CMA-ES over gradient methods, analysis-seeded starts (arxiv.org/abs/2603.15905)
- Torres et al. (2023), spectral optimal transport for pitch-smooth losses (arxiv.org/abs/2312.14507)
- Chowning (1973), The Synthesis of Complex Audio Spectra by Means of Frequency Modulation
- Modal frequency tables: csounds.com/resources/modalFreqs.html
