# voice-fit

Fits an ORACLE voice to one speaker's recording of [the recording script](../../data/voice/oracle-recording-script.txt): their vowel targets, how each vowel drifts, and their locus equations. The result is a voice (`opt.voice` for `speak()`) that carries its own `vowels` and `locus`. The shared tables in `audio-engine.js` don't change.

The recordings stay outside the repo, and so does everything in `out/`.

## Run it

The Python steps need numpy, torch and transformers. The Hunyuan3D venv has them. Whisper base.en is fetched into the Hugging Face cache the first time it's needed.

```bash
PY=~/Hunyuan3D-2/.venv/Scripts/python.exe
```

```bash
cd tools/voice-fit && $PY cut.py <dir with part1.wav..part5.wav> out/clips.json
```

```bash
node tools/voice-fit/match.mjs tools/voice-fit/out/clips.json tools/voice-fit/out/lines.json
```

```bash
cd tools/voice-fit && $PY analyze.py <dir with the wavs> out/lines.json out/measures.json
```

```bash
node tools/voice-fit/fit.mjs tools/voice-fit/out/measures.json tools/voice-fit/out/voice.json
```

```bash
node tools/voice-fit/render-ab.mjs tools/voice-fit/out/voice.json tools/voice-fit/out
```

## What each step does

| File | Does |
|---|---|
| `cut.py` | Cuts each part into one clip per line read, and transcribes each clip. Parts 1 and 2 are cut at the /s/ of every "Say", because the gaps between briskly read lines are as quiet as the closures inside words. Part 3 is cut at its pauses. Whisper gets one short clip at a time: given a whole part of this script, it loops. |
| `segment.py` | Shared WAV reading and energy, and an older whole-part transcriber kept for comparison. |
| `match.mjs` | Aligns clips to script lines, allowing a line split in two, false starts and retakes. A retake keeps the later reading. Parts 1 and 2 are matched on the test word alone. |
| `analyze.py` | Part 1 only. Finds each test vowel as the second loud voiced run in its clip (after "say" and the break before the word), then measures F1 to F3 at 20, 50 and 80% with Burg LPC, as Praat does. |
| `fit.mjs` | Pools each vowel's readings, drops outliers, and writes the targets, drift and locus equations. A locus equation is used only where it fits (r² 0.3 or better). |
| `render-lines.mjs` | Says Part 1 in a voice as a recording would be, with clip times, so `analyze.py` can measure the synth the way it measured the speaker. |
| `fit-source.mjs` | Fits `bright` and `oq` to the speaker's long-term spectrum (see below). |
| `synth.mjs` | The real worklet run in Node, shared by the renders. |
| `render-ab.mjs` | Says the same lines in a stock voice and in the fitted one, through the real worklet, to `a-stock.wav` and `b-fitted.wav`. |

## What a fitted voice keeps of the measurements

F1, F2, the drift through each vowel, the labial locus equation and F0. Not F3: the measured F3s ran 2500 to 3300 Hz (a deep voice's F3 is weak, and LPC slides up to F4), and with them the voice sounded hollow and nasal. With the tables' F3 it didn't; that was the pick of four takes on 2026-11-23. A fitted voice also sets `trach: 0`: the tracheal pole-zero pairs put peaks at 600 and 1550 Hz the speaker doesn't have, and on a voice this low and lax they read as nasal.

`fit-source.mjs` fits the source's brightness (`bright`, `oq`) to the speaker's long-term spectrum. On the first voice it barely moved anything, so `fit.mjs` doesn't run it.

`synth.mjs` renders through the real worklet and adds the game's 3 kHz presence peak after it. Without the peak a render is about 4 dB dull at 3 kHz against what a player hears, and that alone sounds nasal.

## Timing and pitch (Parts 3 and 4)

```bash
cd tools/voice-fit && node fit-prosody.mjs out/voice.json out/p3seg.json out/p3you.json 4
```

`prosody.py` measures each line the same way for the speaker and for a render: articulation rate (syllables over speech time less pauses), pause time, and pitch median, range, declination and the fall at the end, in semitones. `fit-prosody.mjs` renders Part 3's single sentences, measures them, and moves `speed`, `f0`, `lilt` and `decl` by the ratio to the speaker, round after round; seven rounds brought all four within 0.1 of the speaker. `compare-prosody.mjs` prints the two side by side. `render-segs.mjs` renders a list of lines with their times.

Pauses come from Part 4, the passage, since Part 3's sentences have none inside them. ORACLE divides pauses by `speed` like every sound, so fitting the speed shrank them to a third of the speaker's. A voice's `pause` scales them on its own; 3.3 gave 5.2 s of pauses in the passage against the speaker's 5.5.

The passage, which the fit never saw, matches on rate, pauses and median pitch. Its pitch range doesn't: a speaker reading a passage narrows the range they use on single sentences, and the voice doesn't. The game's lines are mostly single sentences, so the range is fitted to those.

## Phone alignment

```bash
cd tools/voice-fit && node render-trace.mjs out/voice.json out/p3seg.json out/p3trace
```

```bash
cd tools/voice-fit && $PY align.py <dir>/part3.wav out/p3seg.json out/p3trace out/p3align.json
```

`render-trace.mjs` renders each line with ORACLE's trace, so the render's phone starts are known exactly. `align.py` warps the render onto the speaker's line with DTW and carries the starts across. The features are MFCCs plus three that mean the same in any voice (the share of energy that's hiss, the voicing, and the level under the line's peak), weighted 600.

There are no hand labels, so `check-align.py` scores an alignment against what its phones must sound like. On Part 3's 65 lines:

| | sibilants that are hiss | stops with a closure | vowels voiced | front over back vowels |
|---|---|---|---|---|
| render stretched evenly (`--linear`) | 0.18 | 0.51 | 0.49 | 0.969 |
| warp on MFCCs alone (`--class=0`) | 0.39 | 0.71 | 0.62 | 1.019 |
| warp, weight 600 (the default) | 0.53 | 0.74 | 0.67 | 1.011 |
| a render against its own trace (the ceiling) | 0.58 | 1.00 | 0.86 | 1.060 |

Weight 1500 scored the class checks a little higher but stopped telling vowels apart (0.976). Snapping each boundary to the biggest spectral change nearby (`--refine`) made every check worse, and is off. `draw-align.py` draws lines as spectrograms with their boundaries, to check by eye.

## Durations

```bash
cd tools/voice-fit && node fit-durations.mjs out/voice.json out/p3align.json out/p3trace/trace.json
```

With every phone aligned, each has ORACLE's length and the speaker's. `fit-durations.mjs` gives each phone a factor (the median ratio, shrunk toward 1 when it has few examples, and normalised so the lines' total doesn't move), written to the voice as `durs` and applied to the phone's inherent length before Klatt's rules.

It did little. Fitted on half of Part 3 and tested on the other half, the median error per phone went from 22% to 21%. Broken down by context, ORACLE's rules already matched the speaker within 1 or 2% almost everywhere: consonants, unstressed vowels, schwas, the start and middle of a sentence. The rest of the 20% is alignment noise. The one clear offset was the vowel in a sentence's last syllable, 11% longer than the speaker's: Klatt's phrase-final lengthening (×1.30) is more than he uses. A voice's `final` scales that lengthening (1 is Klatt's); 0.35 brought it to 4%.

Shorter phrase ends sped every line up, so `fit-prosody.mjs` was run again after (speed 1.81 to 1.62), and `pause` scaled by the same ratio, since pauses are divided by speed.

The passage shows a rate the voice can't follow: the speaker reads Part 4 at 5.41 syllables a second against 4.85 for single sentences, and the voice reads both alike. That and the narrower range are now `PASSAGE` in the engine, fitted to Part 4 ([oracle-next.md](../../docs/proposals/oracle-next.md) item 3): rate within 1.3% and range within 0.1 semitones.

## Consonants

```bash
cd tools/voice-fit && $PY measure-cons.py <dir>/part3.wav out/p3align.json out/cons-you.json
```

```bash
cd tools/voice-fit && node fit-consonants.mjs out/voice.json out/p3seg.json out/cons-you.json 4
```

`measure-cons.py` measures each fricative's centre of gravity (the middle half, 1 to 11 kHz) and each /p t k/'s VOT before a vowel, on the speaker with the alignment's boundaries and on a render with its own trace. `fit-consonants.mjs` renders, measures and moves each sibilant's `nf` and each stop's `asp` by the ratio, written to the voice as `cons`. Four rounds put /s z ʃ tʃ/ within 0.1% and the VOTs within 1 ms. Only the sibilants' bands are fitted: /f v θ ð/ didn't respond to theirs.

## Velars (Part 5)

Part 5 is read like Part 1 ("Say keen again."), and `cut.py`, `match.mjs` and `analyze.py` treat it the same way. `fit.mjs` uses its words for the velar loci only, never the vowel targets, and drops a reading whose vowel is more than 400 Hz of F2 from that vowel's Part 1 middle. Its three closing sentences are matched but not measured.

## Vowels before r and l (Part 2)

```bash
cd tools/voice-fit && node fit-liquids.mjs out/voice.json out/lines.json <dir>/part2.wav
```

Renders Part 2 with its trace, aligns it onto the speaker with `align.py`, and measures F1 and F2 at 20% and 80% of each test vowel and the middle of its liquid (`measure-liquids.py`), on both. The speaker's three points go on the voice as `liquids` ({ 'AY|ER': { f, to, liq } }, F3 from the tables), and it renders again to print each point against the speaker before and after. The mean F2 error went from about 240 Hz to about 110. A point outside a vowel's range (F1 200 to 1000, F2 500 to 2800) falls back to the voice's own vowel: the start of "fire" measured the /f/.

## Loudness

```bash
cd tools/voice-fit && node fit-loud.mjs out/voice.json out/p3seg.json <dir>/part3.wav out/p3align.json 5
```

`measure-loud.py` takes each vowel's level (the RMS of its middle half, against the line's loudest vowel) and fits it against the vowel's place in the sentence, accented and unaccented apart (the render's trace says which, on both sides), with the drop after the last accent and the gap between accented and unaccented vowels. `fit-loud.mjs` moves `loudFall`, `unaccFall`, `postNuc` and `unaccDb` until a render measures as the speaker does. On the first voice, five rounds put all four within 0.1 dB.

## Voice quality

```bash
cd tools/voice-fit && $PY measure-quality.py <dir>/part3.wav out/p3align.json
```

```bash
cd tools/voice-fit && node render-trace.mjs out/voice.json out/p3seg.json out/q-trace && $PY measure-quality.py --trace out/q-trace
```

H1-H2 (breathiness), H1-A3 (tilt), CPP (periodicity) and period-to-period jitter over the vowels' middles. The speaker read -6.7, 14.5, 21.0 and 1.4%; the voice read +5.7, 29.8, 23.4 and 1.2 until `oq` went to 0.4, its floor, which gave -4.7, 16.0, 23.5 and 1.1. That was the only knob worth moving: `bright` barely moves the tilt, `jitter` barely moves period jitter, more `breath` lowers CPP but makes the other two worse, and `trach` moves none of them. There's no fitting script; one knob was set by a sweep.

## The gate

The voice this fit made is kept as `data/voice/fitted-voice.json`, and `scripts/voice/fitted-smoke.mjs` (in the voice gates) renders eight lines in it against `data/voice/fitted-voice-snapshot.json`. After refitting, or after an engine change that's meant to move it, listen, then run it with `--update`. Copy `out/voice.json`'s `voice` into the data file when a refit is kept.

## Traps

- **Low-pass before resampling.** Without it, the hiss of /s/ and /h/ folds into the formant band and every open vowel's F1 reads 200 Hz low.
- **Whisper's word times run up to 0.1 s early.** Taken as the vowel's span, they measured the /eɪ/ of "say" instead of the test word. `analyze.py` finds the vowel from the clip's own structure.
- **A deep, creaky voice needs a 40 ms voicing window.** A 25 ms window holds two periods of an 80 Hz voice and calls breathy vowels unvoiced. The whole-clip pitch detector also jumps an octave on this voice, so F0 is taken over the test vowels.
