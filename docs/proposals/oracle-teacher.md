# ORACLE's controller trained on a teacher

Status: design only. Nothing downloaded, nothing generated. This is the data plan for phase 1 of [oracle-neural.md](oracle-neural.md).

The controller has 65 usable sentences of David to learn from, which is enough for per-vowel pitch and not much else. A neural TTS model can read thousands of sentences with clean audio and exact phone timing. The plan is to pre-train the controller on that, learning general English prosody and timing, then fine-tune it on David so it ends up sounding like him and not like the teacher.

The game ships no neural audio. What ships is the controller's weights, as now: a few hundred KB, int8, run in plain JavaScript. The teacher only ever runs offline, on David's machine.

## The licence question

The weights that ship are trained on the teacher's output. So the teacher's code, weights and training data all have to allow that output to train a model in a commercial game. Three things can block it:

- a non-commercial licence on the weights (common; it usually covers outputs too);
- training data under a research-only or non-commercial licence, which the weights' own licence doesn't wash out;
- terms that restrict using outputs to train another model.

The table below is what each project states. **I wrote it from memory of these pages, not a fresh read; every row must be re-checked at its source link before anything is downloaded**, and the check written into the row with a date.

| Teacher | Code | Weights | Training data | Durations? | Verdict |
|---|---|---|---|---|---|
| Matcha-TTS, LJSpeech checkpoint ([repo](https://github.com/shivammehta25/Matcha-TTS)) | MIT | Released with the repo; the licence for the checkpoint itself needs confirming | LJSpeech, public domain ([LJSpeech](https://keithito.com/LJ-Speech-Dataset/)) | Yes: monotonic alignment gives a duration per input phone | **Clean if the checkpoint's licence is confirmed.** One American woman's voice. |
| Parler-TTS Mini/Large ([repo](https://github.com/huggingface/parler-tts), [model card](https://huggingface.co/parler-tts/parler-tts-mini-v1)) | Apache-2.0 | Apache-2.0 | LibriTTS-R (CC BY 4.0) and English MLS (CC BY 4.0) | No | **Usable, with attribution** to the two datasets. Many speakers, steered by a text description. |
| StyleTTS 2, LJSpeech checkpoint ([repo](https://github.com/yl4579/StyleTTS2)) | MIT | Pre-trained models carry a condition: listeners must be told the speech is synthetic unless the speaker agreed | LJSpeech (public domain) for that checkpoint; LibriTTS for the multi-speaker one | Yes, internally | **Unclear.** The disclosure condition is aimed at playing its audio; whether it reaches a model trained on that audio needs reading closely. Second choice. |
| Kokoro-82M ([model card](https://huggingface.co/hexgrad/Kokoro-82M)) | Apache-2.0 | Apache-2.0 | Stated as permissive and synthetic, but not itemised; some of it is other TTS systems' output | Yes (it predicts durations) | **Unclear provenance.** Best sound of the permissive ones; don't use until the data is itemised. |
| Piper voices ([voices](https://huggingface.co/rhasspy/piper-voices)) | MIT (original repo); the current fork is GPL-3.0 | Per voice, in each voice's `MODEL_CARD` | Per voice. Many are fine-tuned from the `lessac` voice, trained on the Blizzard 2011 data, which is research-only | Yes (VITS) | **Avoid** unless a voice's card shows a clean chain all the way down. |
| Coqui XTTS-v2 ([licence](https://coqui.ai/cpml)) | MPL-2.0 | Coqui Public Model License: non-commercial | Not itemised | No | **Excluded.** Non-commercial. |
| F5-TTS ([repo](https://github.com/SWivid/F5-TTS)) | MIT | CC BY-NC 4.0 (the Emilia data is non-commercial) | Emilia | No | **Excluded.** Non-commercial. |

The aligner and the trackers are tools whose output is measurements, not voice, but they're checked too:

| Tool | Licence | Use |
|---|---|---|
| Montreal Forced Aligner ([repo](https://github.com/MontrealCorpusTools/Montreal-Forced-Aligner)) | MIT; the `english_us_arpa` acoustic model is trained on LibriSpeech (CC BY 4.0) | Phone boundaries where the teacher gives none |
| torchcrepe ([repo](https://github.com/maxrmorrison/torchcrepe)) | MIT | F0 |
| Praat via parselmouth ([repo](https://github.com/YannickJadoul/Parselmouth)) | GPL-3.0 | Formants, checking F0. GPL is fine for an offline tool whose code we don't ship. |

## Alignment onto ORACLE's phones

ORACLE's phones come from `phonemesFor` in `audio-engine.js`: CMUdict ARPAbet with stress, then its own rules (flaps, glottal stops, reduced vowels, the RP/GA split). The controller is trained on ORACLE's phone sequence, so every teacher phone has to land on one of ORACLE's.

1. **Feed the teacher ORACLE's phones where it can take them.** Matcha and StyleTTS take a phone string. Map ORACLE's phones to the teacher's phone set (both are IPA-like, via espeak for Matcha) with a fixed table, and read the durations straight back. This is the best case: the teacher says exactly the phones ORACLE would, and its durations need no aligner.
2. **Otherwise, force-align.** Feed the text, then run MFA with the ARPAbet model over the audio, using a dictionary built from `phonemesFor`'s output for each word (so MFA aligns ORACLE's pronunciation, not its own). MFA reports 10 ms frames; that's the same noise `align.py` has on David, so the short-phone limit stays.
3. **Mismatches.** Where ORACLE has a phone the teacher didn't say (a flap where the teacher said /t/, a dropped schwa), the table marks it. A line with more than a few unmapped phones is dropped, not patched. Count drops per phone: a phone that's always dropped is a gap in the table, not in the data.

The table is a small file in `tools/voice-fit/ddsp/`, with a check that every key of `PH` appears in it.

## What to measure

Per line, written in the shape `data.py` already reads for David's lines, so `syllable.py` and `prosody.py` run on it unchanged:

- **Durations per phone**, from the teacher or MFA.
- **F0 per 5 ms frame** with torchcrepe, then the vowel-centre values `syllable.py` uses. Teacher audio is clean, so tracker slips should be rare; log the voiced-frame rate per line and drop outliers.
- **Loudness per 5 ms frame** (A-weighted RMS in dB), and per vowel.
- **Formants, later and maybe never.** The formant cut smeared words when trained on David. Teacher formants are a different voice's tract, so they'd teach coarticulation shape at best. Measure F1 to F3 with Praat and keep them on disk, but train nothing on them until pitch and durations pass the gate.

Nothing here goes through the twin. Teacher targets are measured, like `syllable.py`'s, which is what made the gate pass.

## Normalising the teacher away

The controller must learn the shape of prosody, not the teacher's voice:

- F0 in cents relative to the line's own median, and the speaker's range scaled to David's (his semitone spread over the 65 lines).
- Durations as log ratios to ORACLE's rule durations, centred per line, so speaking rate comes out.
- Loudness relative to the line's mean.

A speaker embedding or a "teacher" flag as an input would let the network keep the two apart; the flag is dropped (set to David) at fine-tune and in the game.

## Data: how much, and what text

**Amount.** About 20,000 lines, roughly 20 to 25 hours of audio. The controller is about 200k weights; that's well over what it can memorise, and Matcha makes it in a few hours on one consumer GPU. Start with 2,000 lines to check the whole pipe, then scale.

**Text.** It must sound like the game, so the register in [story.md](../story.md) and [house-voice.md](../reference/house-voice.md) matters more than size:

- **The game's own lines**: NPC dialogue, broadcasts (`data/scripts/*.bsm`), examine texts, signs read aloud. Pulled from `content/` by a script; this is the core, maybe 5,000 lines.
- **Plain read sentences** for coverage: the Harvard sentences and the CMU ARCTIC prompts (public domain text, the prompts written for diphone coverage). Both are already familiar to the pipeline.
- **Questions, lists, interruptions, short barks** ("Hey.", "Out of my way."), shouted and quiet lines: the shapes `phonemesFor`'s prosody rules handle and David's 65 lines barely touch. Written by hand or templated, in the house voice.
- **Public domain prose** from the library's own books, sentence-split, for long sentences with real syntax.

Count phone pairs against ORACLE's set and fill the rare ones on purpose, the same aim as Part 6.

Lines that will be the held-out gate set are chosen first and never generated by the teacher, so the teacher can't leak into the test.

## Training

1. **Pre-train** `syllable.py`'s model (and the duration head, which teacher data may finally make worth having) on the teacher set, with the usual pull towards zero. A tenth held out.
2. **Fine-tune on David**: the 65 lines (and Part 6 once recorded), learning rate a tenth of pre-training, every layer but the last frozen at first, then all at once for a few epochs. The pull towards zero becomes a pull towards the pre-trained output, so ten minutes can't undo what twenty hours taught.
3. **Compare three models** on David's held-out lines: rules only, David only (today's `syllable.py`), teacher then David. If teacher-then-David doesn't beat David-only on the gate, the teacher taught nothing that transfers and the plan stops there.

## Evaluation

- **The word-error gate**, as now: Whisper base.en through the real worklet, word error may not rise over the rules'. Its known weakness is too few held-out words; build a fixed gate set of 200 lines (Harvard sentences plus game lines) that's never trained on, voiced by every candidate. 200 lines is about 1,600 words, enough that two words is noise and twenty isn't.
- **Pitch and duration error against David** on his held-out lines, in cents and log ratio, as now.
- **Listening.** David scores pairs blind (rules vs. candidate, order shuffled, same line) for naturalness and for "sounds like me". A short list of 30 pairs is enough to see a preference. A web page that plays them and records the choices would do; the Voice Lab could host it.
- **Accent check.** Play the same lines with the RP and GA accents: the controller must not drag RP towards an American teacher's tune.

## Risks

- **The teacher's accent and style leak in.** Matcha's only checkpoint is an American woman reading the news, the opposite of most of the cast. The normalising above, the speaker flag and the fine-tune are the guard; the accent check is how we'd notice. Parler can be steered to an English male speaker by its description, which is a reason to try it second.
- **Licence.** A row that turns out wrong after training taints the weights. Write each check's date and link into this doc before generating anything, and keep each training run's teacher named in the weights file's header.
- **Learning the teacher's mistakes.** A TTS model misreads some words and flattens long sentences. Drop lines where Whisper's transcript of the teacher doesn't match the text.
- **GPU time.** Generation is hours on one GPU; MFA is CPU and slow at 20 hours (a night). Torchcrepe on the full set is an hour or two. Training the controller is minutes. Disk: about 3 GB of 24 kHz audio.
- **It still might not transfer.** Synthetic prosody is smoother than a person's. If the gate shows no gain, the 200-line gate set and the phone-pair counts are still worth having for Part 6.

## Recommendation

Try **Matcha-TTS's LJSpeech checkpoint** first. Its data is public domain, its code is MIT, and it takes a phone string and gives back a duration for each phone, so ORACLE's own pronunciation goes in and exact timings come out with no aligner. Confirm the checkpoint's own licence before downloading. If its American newsreader voice leaks through, try **Parler-TTS** next: Apache weights, CC BY data with a clear attribution duty, and a describable speaker, at the cost of running MFA.
