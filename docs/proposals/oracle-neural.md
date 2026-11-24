# ORACLE with a neural controller

Status: phase 0 built (the differentiable twin and its parity check, in `tools/voice-fit/ddsp/`); phase 1 trained offline: the formant cut smeared words and is shelved, and the per-vowel pitch controller (`syllable.py`) is the one being judged by ear; not yet in the engine; phases 2 to 4 are design.

ORACLE stays the instrument. A small network learns to play it: it reads what the rules already produce for a line and corrects the tracks before they reach the worklet. It's trained by comparing ORACLE's own sound against the speaker's recording, through a differentiable copy of the worklet (the DDSP approach: Engel et al. 2020). Nothing neural runs per sample, the game downloads a few hundred KB of weights, and a voice with no weights speaks exactly as it does now.

This continues [oracle-next.md](oracle-next.md): `tools/voice-fit` fits one setting at a time by analysis by synthesis, and this fits everything at once, frame by frame.

## Why the tracks, not the sound

What still sounds synthetic about the fitted voice is mostly control: where the pitch goes, how long each sound lasts, how the formants move between sounds, where the voice gets breathy. Those are the rules in `audio-engine.js`, and they're what this session has tuned by hand item by item. The source and the tract are close (CPP is still 2.5 dB clean; that's for later).

A network that outputs tracks keeps everything ORACLE has: the Voice Lab still edits the voice, `natural` and `buzz` still work, any seed still rolls a new voice, and the output is still a formant synth's, inspectable and gated.

## Phase 0: the twin (built)

`tools/voice-fit/ddsp/twin.py` makes the worklet's sound from the same 24 tracks and per-line constants `k`, in PyTorch:

- the LF pulse from Rd and the tilt track as `cycle()` derives them, solved per 5 ms frame instead of per period; the bisection for alpha runs without gradient and three Newton steps after it carry the gradient;
- aspiration and frication noise pulsed by the glottal phase;
- the cascade, nasal pair, tracheal pairs, closure crossfade, frication band, flat path and top cut as analytic frequency responses, applied per STFT frame (2048, hop 5 ms) and overlap-added;
- the 3 kHz presence peak `synth.mjs` adds.

It leaves out jitter, shimmer, creak and growl (random per period, which a spectral loss can't see) and F1 following the glottis inside a period.

`export.mjs` dumps what the worklet is given and what it plays; `parity.py` measures the log-mel distance between the twin and the worklet on the same tracks. On 16 lines it's **2.22 dB**, where reseeding the noise alone moves the measure 1.29 dB. Descent through the twin recovers F1 and F2 to within 1.5% from a 10 to 15% error; Rd it recovers and then wanders, so the model needs a prior holding Rd near the rule value.

## Phase 1: the controller

Two heads over one small network (1-D convolutions and a GRU, about 200k weights):

- **Durations, per phone.** A log-ratio on each phone's rule duration. Trained directly on `align.py`'s boundaries; it needs no twin.
- **Corrections, per 5 ms frame.** Added to the rule tracks: F0 in cents, F1 to F3 and their Qs as log ratios, `av`, `ah`, `af` in dB, Rd and tilt as log ratios. Every other track passes through. Trained through the twin: render with the speaker's own durations (so frames line up with the recording), multi-resolution STFT loss against the recording, plus a penalty pulling every correction towards zero, harder on Rd.

Inputs per frame: the rule tracks themselves, the phone and its neighbours, stress and accent, the place in the word and the phrase, and the punctuation that ends the phrase. Starting from the rules means a zero output is today's voice, which is why it can learn from minutes of speech rather than hours.

**First cut (2026-11-23).** Trained on 58 Part 3 lines, 7 held out (every tenth). What it took to train at all:

- A fine log spectrum let the head cheat: F0 up 300 cents and the voicing down 12 dB everywhere, because harmonics dominate that loss. The loss is now 40 mel bands wide enough (60 Hz at the bottom) that no harmonic resolves, and F0 learns only from the speaker's measured pitch: its column is detached before the twin.
- Every correction was then a constant, because the recording's mic and room colour every frame alike. A learned channel filter (one gain per band, shared by every line, fitted first on the rules alone) takes that up. It came out 10 to 15 dB up above 5 kHz: the recording has breath and hiss the worklet's top cut takes off.
- The head has a constant per output (the voice's static difference) apart from its per-frame part, regularised separately, so the two can be read apart.

Held out, through the twin, the loss falls from 3.74 to 3.42. Through the **real worklet**, on the same seven lines, the envelope distance to the recording falls on every line, 14.65 to 13.13 dB on average (no channel filter on either), so the twin's gap isn't being exploited. Median F0 error goes from 207 to 188 cents, mixed line by line. The constants it settled on (F0 +54 cents, every formant Q about 20% lower, frication 5 dB down, tilt up) belong in the voice's static settings, not the network; the per-frame part moves F0 57 cents, F1 15% and voicing 3 dB about them. The duration head brings the held-out RMS log error of phone durations from 0.52 to 0.48, which is small: DTW boundaries at 10 ms are noisy for short phones.

Seven lines is too few to choose a checkpoint on and also report; Part 6 (phase 3) is what fixes that.

**By ear, the first cut smeared words**, and the rules sounded better. The envelope distance said otherwise: a spectral loss rewards blurring towards a room-coloured average and knows nothing about words. So the next attempts left the formants alone, trained on measured targets instead of through audio, and gained a gate: Whisper (base.en, on the CPU) transcribes the held-out lines through the real worklet, and the word error rate may not rise over the rules'.

- `prosody.py`: pitch and loudness per 5 ms frame, durations per phone, with the predicted durations played as the game would. The gate failed, 38.7% to 53.2%. Split apart, durations alone gave 45.2% and pitch alone 51.6%: per-frame pitch learned from noisy targets (the rules miss the speaker by a median 200 cents a frame, much of it tracker slips and alignment) wobbles inside words.
- `syllable.py`: one step per phone. Duration capped at 30%, and pitch and loudness read only on vowels and joined linearly between vowel centres, so nothing moves inside a vowel. Held out, the vowel pitch error falls from 186 to 136 cents. Word error: pitch alone 41.9% against the rules' 38.7% (two words in 62, inside Whisper's noise); durations still hurt (50.0%) for almost no gain (0.190 to 0.181), so they're dropped and the voice keeps its fitted durations.

The gate needs more held-out words than seven lines give before it can tell 2 words from chance.

## Phase 2: the engine

- `speak()` gains a pass between building the tracks and posting them: if the voice carries `nn` (a weights file, `data/voice/<name>.nn.json`), the controller runs over the line in plain JavaScript, a few milliseconds a line, no library.
- The duration head runs earlier, where `segCtx` sets each phone's length.
- The node graph back end reads the same corrected targets where it can and ignores the rest.

## Phase 3: more recording

A teacher TTS model could supply the hours of aligned speech the controller lacks; the plan, with each candidate's licence, is [oracle-teacher.md](oracle-teacher.md).

There are about 10 minutes of David now. A Part 6 of 150 to 200 plain sentences (about 15 minutes, read as Part 3 was) would cover the phone pairs the script misses. Hold out a tenth of the lines to check against.

## Phase 4: gates

- `fitted-smoke.mjs` already holds the fitted voice; it grows a second snapshot with the controller on.
- A parity gate over a fixed set of exported lines fails if the twin drifts from the worklet by more than 0.5 dB, since a worklet change the twin doesn't copy makes training wrong.
- The weights are checked as a file like any other content: a hash in the snapshot.

## Risks

- **The twin's gap.** A network can learn to use what the twin does and the worklet doesn't. Every trained voice is checked by rendering through the real worklet and measuring it against the recording, not the twin.
- **Overfitting ten minutes.** The pull towards zero and the held-out lines are the guard; the corrections are small next to the rules.
- **Alignment.** Duration targets are only as good as `align.py`. Its boundaries were checked by eye on Parts 1 to 3.

## Running phase 0

```bash
node tools/voice-fit/ddsp/export.mjs tools/voice-fit/out/voice.json tools/voice-fit/out/ddsp-lines.json tools/voice-fit/out/ddsp
```

```bash
cd tools/voice-fit && ~/Hunyuan3D-2/.venv/Scripts/python.exe ddsp/parity.py out/ddsp --wav out/ddsp-wav
```

`ddsp-lines.json` is a list of `{ id, text }`. `--wav` writes each line from the worklet and from the twin, to listen to side by side.
