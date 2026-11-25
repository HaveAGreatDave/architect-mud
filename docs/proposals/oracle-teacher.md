# ORACLE's controller pre-trained on other voices

Status: design only. Nothing downloaded, nothing trained. This is the data plan for phase 1 of [oracle-neural.md](oracle-neural.md).

The controller has 65 usable sentences of David to learn from, which is enough for per-vowel pitch and not much else. The plan is to pre-train it on many other people's speech, so it learns how English pitch and timing move in general, then fine-tune it on David so it ends up sounding like him.

The source is the **CSTR VCTK corpus**: real recordings, not a neural TTS teacher. A TTS model was the first idea, but VCTK already is what a teacher was for (hours of clean speech with transcripts), with real prosody instead of a model's smoothed copy, and only one licence to clear. A TTS teacher stays as an optional later step, for the one thing VCTK can't give: the game's own register.

The game ships no neural audio. What ships is the controller's weights, as now: a few hundred KB, int8, run in plain JavaScript.

## VCTK

- 110 English speakers, men and women, British, Irish and North American accents among others, about 400 sentences each: about 44 hours. Recorded in a studio at 48 kHz.
- The sentences are newspaper text, the rainbow passage and an elicitation paragraph, read in a flat neutral register.
- Version 0.92 (2019), about 11 GB, from the University of Edinburgh's DataShare ([record](https://datashare.ed.ac.uk/handle/10283/3443), DOI 10.7488/ds/2645).
- **Licence: CC BY 4.0**, stated in the corpus README. Commercial use is allowed; the condition is credit and a licence notice. The credit goes in [bibliography.md](../reference/bibliography.md) (which players can read on the tablet's Settings → Bibliography page) and in the header of every weights file trained on it: Yamagishi, Veaux and MacDonald 2019, CSTR VCTK Corpus, CC BY 4.0.
- Two known faults: p315 has no transcripts, and p280 and p315 have problems on one of the two microphones. Leave both out.
- From the per-speaker sheet (counted 2026-11-24): 63 women and 47 men. Accents: English 33 (and one listed as British), American 22, Scottish 19, Irish 9, Canadian 8, Northern Irish 6, South African 4, Indian 3, Australian 2, Welsh, New Zealand and one unknown. So there's a usable GA side, not only RP.
- As unpacked: `wav48_silence_trimmed/<speaker>/<line>_mic1.flac` and `_mic2.flac` (88,328 files, two microphones per line, silence already trimmed), and `txt/<speaker>/<line>.txt`. Use `mic1` only. Downloaded to `C:\Users\david\datasets\vctk` (MD5 checked against DataShare's), 23 GB with the zip.

## Tools

The aligner and the trackers make measurements, not voice, but they're checked too.

| Tool | Licence | Use |
|---|---|---|
| Montreal Forced Aligner ([repo](https://github.com/MontrealCorpusTools/Montreal-Forced-Aligner)) | MIT; the `english_us_arpa` acoustic model is trained on LibriSpeech (CC BY 4.0) | Phone boundaries |
| torchcrepe ([repo](https://github.com/maxrmorrison/torchcrepe)) | MIT | F0 |
| Praat via parselmouth ([repo](https://github.com/YannickJadoul/Parselmouth)) | GPL-3.0 | Formants, checking F0. GPL is fine for an offline tool whose code we don't ship. |

The MFA rows are from memory; check them at their links before installing.

## Alignment onto ORACLE's phones

ORACLE's phones come from `phonemesFor` in `audio-engine.js`: CMUdict ARPAbet with stress, then its own rules (flaps, glottal stops, reduced vowels, the RP/GA split). The controller is trained on ORACLE's phone sequence, so every measured phone has to land on one of ORACLE's.

1. **A dictionary from ORACLE.** A script runs `phonemesFor` over every word in the VCTK transcripts and writes MFA's dictionary format, one word per line with its phones. ORACLE's own extra phones map back to the nearest ARPAbet phone through a table that records each mapping, so MFA aligns ORACLE's pronunciation, not its own.
2. **Align.** MFA (`mfa validate`, then `mfa align`) over the whole corpus, overnight on the CPU. It writes one TextGrid per line with each phone's start and end on a 10 ms grid.
3. **Mismatches.** People don't always say a word the way the dictionary does, and MFA marks a poor fit. A line with more than a few phones that don't fit is dropped, not patched. Count drops per phone: a phone that's always dropped is a gap in the table, not in the data.

MFA's 10 ms grid is the same noise `align.py` has on David, so durations of short phones stay unreliable. That's the reason `syllable.py` dropped its duration head; with 44 hours it may be worth trying again.

The script and the table go in `tools/voice-fit/ddsp/`, with a check that every key of `PH` appears in the table.

## What to measure

Per line, written in the shape `data.py` already reads for David's lines, so `syllable.py` and `prosody.py` run on it unchanged:

- **Durations per phone**, from MFA.
- **F0 per 5 ms frame** with torchcrepe, then the vowel-centre values `syllable.py` uses. Real voices creak and breathe, so log the voiced-frame rate per line and drop outliers, as on David.
- **Loudness per 5 ms frame** (A-weighted RMS in dB), and per vowel.
- **Formants, later and maybe never.** The formant cut smeared words when trained on David. Measure F1 to F3 with Praat and keep them on disk, but train nothing on them until pitch and durations pass the gate.

Nothing here goes through the twin. The targets are measured, like `syllable.py`'s, which is what made the gate pass.

## Taking out who's speaking

The controller must learn the shape of prosody, not 108 people's voices:

- F0 in cents relative to each line's own median, and each speaker's range scaled to David's (his semitone spread over the 65 lines).
- Durations as log ratios to ORACLE's rule durations, centred per line, so speaking rate comes out.
- Loudness relative to the line's mean.

## Held out

Hold out whole speakers, not lines: about ten, men and women, with RP and non-RP accents among them. A controller that does well on speakers it never heard has learned English, not those speakers.

Separately, a fixed **gate set of 200 lines** (Harvard sentences plus game lines), never trained on, voiced by every candidate. That's about 1,600 words, enough that two words of Whisper error is noise and twenty isn't. Today's gate has 62 words.

## Training

1. **Pre-train** `syllable.py`'s model, and the duration head, on VCTK, with the usual pull towards zero. Its phone list is ORACLE's whole fixed list (`syllable.PHONES`, checked equal to `Speech.phones()`), so pre-training and fine-tuning number phones alike, and its vowel list now has the RP and Canadian vowels, which had no pitch target before (fixed 2026-11-24). The game reads both lists from the weights file. The script is [pretrain.py](../../tools/voice-fit/ddsp/pretrain.py): syllable.py's model, inputs, targets and loss unchanged, trained in padded batches of 64 on the GPU, the gate set's speakers held out and the best checkpoint by their loss written as `pretrain.pt` in syllable.pt's shape. No speaker id input after all: it would change the model the game runs, and the per-line centring already takes out register and rate. A first check (2026-11-24, 20 speakers, 1,000 steps, two minutes) on six held-out speakers: duration error 0.213 to 0.178, vowel pitch error 140 to 88 cents, vowel level 2.34 to 1.91 dB, against the rules.
2. **Fine-tune on David**: the 65 lines (and Part 6 once recorded), learning rate a tenth of pre-training, every layer but the last frozen at first, then all for a few epochs. The pull towards zero becomes a pull towards the pre-trained output, so ten minutes can't undo what 44 hours taught.
First results (2026-11-24). Pre-training on all 98 training speakers, 20,000 steps in 19 minutes: on the ten held-out speakers, vowel pitch error 140 to 68 cents, duration 0.213 to 0.167, level 2.39 to 1.76 dB, still falling at the last step. On David's seven held-out lines (vowel pitch error): rules 186 cents, David only 136, VCTK only 105, VCTK then David (`syllable.py --init`) 122. So pre-training alone is the best of them, and the fine-tune as first written loses ground: it picks its checkpoint by six validation lines. Whisper on those seven lines (62 words): rules 38.7%, VCTK then David 51.6% with pitch alone; too few words to trust either way, which is what the 200-line gate set is for. The gate set is scored by [gate.py](../../tools/voice-fit/ddsp/gate.py): it exports the 200 lines with the rules, applies each checkpoint (pitch only, and with durations), plays every version through the real worklet, transcribes it with Whisper on the GPU (about five minutes for seven versions), and gives each version's change in word error against the rules with a 95% interval from a paired bootstrap over lines. A version passes when the top of its interval is under 2 points. Two things it had to learn: Whisper loops on a line it can't make out (one gave 372 words for six), so its output is capped near the line's length and a line counts at most all its words; and a bar of zero, asking the interval to prove no harm, is one nothing near the rules can pass.

On the fitted voice (`out/voice.json`), 2026-11-24: the rules score 69.1% word error on the gate set, much worse than the 24 to 36% the station voices score on Harvard sentences, so the fitted voice itself is hard to make out. Against that, every version lands within about a point: VCTK only +0.7% pitch, +0.3% with durations; VCTK then David +2.1% and -0.8%; David only -1.4% and -1.3%. Intervals are about 3 points either side. By the 2-point margin, David only passes both ways, and every VCTK version fails narrowly (tops of 2.9 to 5.3 points). So the controllers don't change how well words come through, and the better pitch VCTK gives doesn't buy intelligibility. Whether it sounds better is now a question for the listening test. The test is built: [listen-build.py](../../tools/voice-fit/ddsp/listen-build.py) pairs a gate run's renders with the rules on the same line (12 lines for each of VCTK only, VCTK then David and David only, pitch only, 36 pairs), the side and the file names random; [listen.mjs](../../tools/voice-fit/ddsp/listen.mjs) serves [listen.html](../../tools/voice-fit/ddsp/listen.html) on port 5651 (`oracle-listen` in launch.json) and saves each answer, and `listen.mjs <dir> --score` tallies it with a sign test. The first set is in `C:\Users\david\datasets\vctk\listen1`.

3. **Compare three models** on David's held-out lines: rules only, David only (today's `syllable.py`), VCTK then David. If VCTK-then-David doesn't beat David-only on the gate, pre-training taught nothing that transfers and the plan stops there.

## Evaluation

- **The word-error gate**, as now: Whisper base.en through the real worklet, on the 200-line gate set; word error may not rise over the rules'.
- **Pitch and duration error against David** on his held-out lines, in cents and log ratio, as now.
- **Held-out VCTK speakers**: pitch and duration error on the ten speakers left out.
- **Listening.** David scores pairs blind (rules against candidate, order shuffled, same line) for naturalness and for "sounds like me". About 30 pairs is enough to see a preference.
- **Accent check.** Play the same lines with the RP and GA accents; neither should drift towards the other.

## Timbre: formants per phone (2026-11-24)

Pitch moved neither intelligibility nor, by ear, much else; the synthetic sound is timbre. So the second controller corrects formants, the way the pitch head corrects pitch: one step per phone, measured targets, VCTK. [formants.py](../../tools/voice-fit/ddsp/formants.py) takes F1 to F3 with Praat at 20, 50 and 80% through every vowel, liquid, glide and nasal of the 43,719 paired lines (7 minutes, 6 processes) against the rule formants at the same points; [formant_head.py](../../tools/voice-fit/ddsp/formant_head.py) trains a PhoneHead with nine outputs on them, each speaker's vocal-tract length (median log ratio per formant) taken out, capped at 25%, the gate set's speakers held out. Played, the nine numbers become a curve through each sonorant's points that returns to the rules at each obstruent's middle, so nothing wobbles inside a sound.

Held out, after 20,000 steps (18 minutes): median formant error against the rules F1 17.6 to 6.0%, F2 13.5 to 5.6%, F3 7.8 to 4.6%. On the gate set through the worklet, word error **68.9% to 54.4%** (-14.5 points, interval -18.4 to -10.6), and 52.2% with the VCTK pitch head as well. Every source gains: banter 66 to 47%, booth lines 65 to 49%, Harvard 72 to 59%. The per-frame formant controller trained on David alone smeared words; this one, on 44 hours of other people and one step per phone, makes them clearer.

**In the engine (2026-11-24).** Unlike the pitch head, which is fitted per voice (`pitchNet`), this one suits every voice, so it ships once: [export-formant.py](../../tools/voice-fit/ddsp/export-formant.py) writes `client/shared/oracle-formant.json` (154 KB, int8, 109,737 weights), the engine fetches it beside the worklet, and `applyFormantNet` runs after the pitch pass on the worklet's tracks. It only saw GA phones in training, so RP's and the Canadian vowels go in as their nearest GA phone (`alias` in the file). `TUNING.formantNet` 0 turns it off. [formant-smoke.mjs](../../scripts/voice/formant-smoke.mjs), in the voice gates, checks the JavaScript against PyTorch on the file's own lines, that every engine phone is covered, that only F1 to F3 move and by no more than the cap, and that 0 gives the rules back exactly.

**The voice source (2026-11-24).** ORACLE's source hardly changes from vowel to vowel: on VCTK's lines its H1-H2 spreads 0.7 dB (interquartile) where the speakers' spreads 6.1 dB. [source.py](../../tools/voice-fit/ddsp/source.py) measures H1-H2, H1-A3 and harmonics-to-noise mid-vowel on 2,156 lines (20 per speaker), on the speaker and on ORACLE's render of the same line; [sense.py](../../tools/voice-fit/ddsp/sense.py) measures how `rd`, `tilt` and `ah` move those (per log unit: `rd` +4.6 dB H1-H2 and +17.5 dB H1-A3; `tilt` -3.7 dB H1-A3; `ah` hardly moves any of them); [source_head.py](../../tools/voice-fit/ddsp/source_head.py) inverts that with a ridge, takes out each speaker's own voice quality, and trains a per-vowel head on the rest. It learns a little (held-out loss 0.444 to 0.383) and overfits after 500 steps: the per-vowel measures are noisy and 20 lines a speaker is thin. Whisper doesn't like it alone (+1.9 points, interval -0.1 to +4.0) and doesn't notice it on top of the formants (54.0% against 53.3%). That's to be expected of breathiness, which is about sounding human, not about which words come through, so it's judged by ear: listening test 4 (`oracle-listen-source`, port 5652) plays formants against formants plus source, 30 pairs, built with `listen-build.py --base`. It is not in the engine.

Also that day: the in-breath at a sentence break was 21 to 25 dB under the vowels on dead silence and came at nearly every full stop. `inhale` is now 0.35 (about 9 dB quieter) and `BREATH_GAP` keeps 3.5 s of speech between breaths; timing-smoke checks both.

**Source head, second pass.** With 100 lines a speaker (6,484 lines) and each measure the median of 35, 50 and 65% through the vowel, the head learns more and stops overfitting: held-out loss 0.454 to 0.364, best at step 5,000. Whisper still doesn't notice it (53.6% on top of the formants, against 52.7%). Listening test 5 had it behind 1 to 3 after four pairs; it stays off (`TUNING.sourceNet` 0, `applySourceNet` in the engine, `export-formant.py` exports a source head too).

## Consonants (2026-11-24)

[consonant.py](../../tools/voice-fit/ddsp/consonant.py) measures every fricative and affricate over its middle half and every stop over its last 40% (where MFA leaves the burst and aspiration), high-passed at 500 Hz: the noise's centre of gravity, its spread, and its level against the nearest vowel. Over 89,000 obstruents ORACLE's were 4 to 7 dB too loud (fricatives) and 8 to 11 dB too loud (stop bursts), /s/ and /sh/ sat about 1 kHz low, and the /k g/ burst was a 250 Hz whistle where the speakers' spread 1,300 Hz. The `PH` table took the averages: `ng` and `bg` down by the measured gap, `nf` up for /s sh ch jh/, the velar `bq` from 3.5 to 1.5, /h/ wider. A re-render puts every consonant within about 2 dB. Two numbers stay where gates hold them: /z/ keeps 5.6 kHz (a higher band weakens its buzz at F0 below worklet-smoke's bar) and /k/ stays more compact than /t/, as VCTK has it too. A voice's own `cons` (the fitted voice's /s z sh ch/) still overrides the table's centres. Word error with the formants: 54.0% against 52.7% before, within noise.

[consonant_head.py](../../tools/voice-fit/ddsp/consonant_head.py) then learns what the table can't: context. Each speaker's median per phone is taken out, and the head gives each obstruent a correction to `nf`, `af` and `nq`, held flat over the phone. Held out: loss 0.534 to 0.371, the most any head has learnt. Word error on top of the formants: 52.6% against 54.0%. It is judged by ear (listening test 7, port 5653) and not yet in the engine.

## Timbre: the top end (2026-11-24)

The buzz isn't clean harmonics. [bandnoise.py](../../tools/voice-fit/ddsp/bandnoise.py) reads harmonics against the noise between them per band, over six periods (a fixed 40 ms window blurs a 90 Hz voice's harmonics into their gaps and reads clean as noise); against VCTK's men, ORACLE's bands above 1 kHz are within 2 dB. What's wrong is the level: averaged over the vowels of 179 male lines, ORACLE fell 10 to 15 dB under the speakers from 3 kHz to 10 kHz. The cascade stops at F5 with nothing standing in for the poles above it (Klatt's higher-pole correction), and above 5 kHz a person's vowel is mostly breath, which ORACLE didn't have.

Two things in the worklet fix it. A high shelf on the voiced path (`hpcDb` 14 from `hpcHz` 3,200; 16 from 2,800 after the bandwidths below) and noise above 4.5 kHz riding on voicing, pulsed with the glottis as aspiration is (`hbK` 0.006). The spectral gap over 0 to 10 kHz goes from 9.0 to 2.5 dB (RMS over bands). A low shelf for the thin bottom (`lowDb`) is there but 0: it blurred /iy/'s F1 below worklet-smoke's check, and VCTK's close microphones lift the bass anyway. Word error went from 54.0% to **42.9%** with the formants, and the rules alone from 66.2% to 61.0%: the largest single gain yet, so the missing top was costing words as well as sounding synthetic. Listening test 8 (port 5652) is the old top end against the new.

**Bandwidths.** Measured the same way on both sides (Praat Burg, mid-vowel, 1,006 vowels from VCTK's men), F1 rang too wide (123 Hz against 85) and F3, sharpened by the new shelf, too narrow (176 against 261); F2 was close. `bwF` in the engine's WK scales each formant's bandwidth: [0.75, 1, 1.5, 1] puts B1 to B3 at 91, 142 and 252. The wider F3 took some level out of 2 to 4 kHz, so the shelf moved to 16 dB from 2.8 kHz. Spectral gap 2.9 dB, word error 45.3% (42.9% before, within noise; the rules moved as much). Listening test 9 (port 5653) is the new top end against it with the bandwidths too.

**Jitter and shimmer.** Praat on mid-line vowels against VCTK's men: shimmer matches (5.9% against 5.3%), jitter is about twice theirs (1.6% against 0.75% where both can be measured, 80 to 100 Hz). Switching off every random source in turn (`cycJitter`, the `jitA`/`jitB` tracks, creak, `natural`) doesn't lower it, so there is no knob that adds the missing steadiness, and more variation would make ORACLE rougher, not more human. The fitted voice spends 41% of its voiced time under 80 Hz and falls to 67 Hz, where pulses start to be heard one by one; that is David's register (the voice is based at 84 Hz) and is left alone.

**A line's first vowel.** The formant bank starts every formant at 500 Hz, and the first target of a line glided in from there. A line that opens on a vowel swept F2 up from 500 through it: the IH of "It's" came out as the AY of "eyet's". The first `setF` (or `murmur`) of a line now snaps to its target.

**Per-phone spectra.** [spectra.py](../../tools/voice-fit/ddsp/spectra.py) renders 20 lines per speaker with the current voice and measures each sonorant's and fricative's spectrum in 15 bands against the speaker's. With each speaker's average gap taken out, the phone medians still differ by 5.1 dB RMS, but most of it is accent: VCTK is mostly British and Scottish, so its GOOSE is fronted, its GOAT, NURSE and PRICE differ from GA, and a filter learnt per phone would carry those vowels into a GA voice. One finding is timbre and not accent: /h/ (breath through the vowel's formants, no voicing) was 20 to 30 dB short of the speakers above 5 kHz, because the breath band rode on voicing only. It now rides on `ah` too (`hbH` 0.035), so /h/ and the aspiration after /p t k/ get their top.

**The source and consonant heads, in the engine.** Both are exported by `export-formant.py` (`oracle-source.json`, `oracle-consonant.json`) and run after the formant pass; `TUNING.sourceNet` and `TUNING.consonantNet` are 1. [heads-smoke.mjs](../../scripts/voice/heads-smoke.mjs), in the voice gates, holds each to PyTorch, to its own tracks and caps, and to the rules when off. With the formants, the fitted voice's word error is 43.3% with all three, 43.1% without.

## Two voices (2026-11-24)

[group-voice.py](../../tools/voice-fit/ddsp/group-voice.py) measures a group of VCTK speakers' vowels (Praat F1 to F3 at 20% and 80%, each speaker's median, then the median over speakers) and pitch; [build-voices.mjs](../../tools/voice-fit/ddsp/build-voices.mjs) turns VCTK's North American men (7) and women (22) into `data/voice/natural-male.json` and `natural-female.json`. Only North American speakers, so the vowels stay GA. Timing, durations, intonation, loci and liquids come from the fitted voice; the woman's loci and liquids are scaled by the women's formants over the men's (F1 1.26, F2 1.17, F3 1.15), and both take their sibilant centres from their own group.

Three findings came out of building them:

- **The formant head double-corrects measured vowels.** It learnt to correct the fitted voice's rule vowels; on these voices it put word error up 8 points (man) and 5 (woman). A voice can now turn it off for itself (`formantNet: 0`), and both do. On their rules alone they're clearer than the fitted voice is (about 46% and 55% against 61%).
- **The buzz was the source.** The fitted voice's open quotient, 0.4, is the engine's floor, its most pressed source: rendered with the new top end, H1-A3 was 8.7 dB against VCTK's men's 17.4. The man is at `oq` 0.62, which puts H1-H2, H1-A3 and HNR on theirs, and his word error fell as well (47.7% to 45.6% on the rules). The fitted voice keeps 0.4; it's David's.
- **A woman's F3 sits on the men's shelf.** At 2.8 kHz the top-end shelf lifted her third formant directly. A voice can set its own `hpcHz` and `hpcDb`; hers are 3,300 Hz and 11 dB, with `oq` 0.75: H1-H2 0.8 against 1.1, HNR 14.9 against 14.4, H1-A3 14.5 against 16.7.

## Intonation and rhythm (2026-11-24)

With the timbre fixed, what still sounds robotic is how pitch moves and how syllables are timed. [intonation.py](../../tools/voice-fit/ddsp/intonation.py) measures both sides apart, each on its own timing: VCTK's North American speakers on MFA's phones and the autocorrelation tracker, ORACLE on its trace and f0 track, exported with `natural-male` (the 7 men, 60 lines each) and `natural-female` (the 22 women, 20 each). Pitch is in semitones against each line's vowel median. Medians over about 420 lines a side, men:

| | speakers | ORACLE before | ORACLE after |
|---|---|---|---|
| range, p10 to p90 (st) | 5.1 | 6.0 | 5.8 |
| first vowel (st) | +1.9 | +0.4 | +0.7 |
| last vowel (st) | -1.8 | -4.0 | -3.2 |
| fall inside the last vowel (st) | -0.5 | -1.5 | -0.8 |
| pitch movement inside a vowel (st) | 0.85 | 1.18 | 0.89 |
| fastest pitch movement inside a vowel (st/s) | 31 | 50 | 34 |
| vowel duration nPVI | 54 | 45 | 50 |
| vowel duration varco | 48 | 37 | 43 |
| final lengthening (last vowel over median) | 1.67 | 1.40 | 1.61 |

The women's numbers moved the same way: last vowel -4.1 to -3.2 against -1.9, nPVI 46 to 51 against 59, final lengthening 1.62 to 1.94 against 2.00.

What the numbers said:

- **Lines started low and ended in a hole.** Readers open about 2 st over the line and decline quickly, then level off about 1 st under it. ORACLE rose to its first accent, slid all the way down and dropped about 4 st at the end. Most of that end drop was the post-nuclear stretch (`postFall`, a full `lilt` under the line) and the nuclear fall.
- **Accent movements were too quick.** Pitch reached each target at about 1.6 times the readers' speed, which is the stepped, keyboard sound.
- **Vowel lengths were too even.** Stressed and unstressed vowels differed too little, and the last syllable was not stretched enough.
- **Contour variety was not the problem.** How far each line's shape strays from the average shape is about the same on both sides (r 0.74 against 0.76), so no randomness was added.
- **A bug.** A phrase's declination was spread over its estimated length *with the pause that ends it*, so the last vowel was pitched only about 0.8 of the way down. `phraseDur` now leaves the closing pause out.

The fixes are `TUNING` keys in the engine, and each has a value that gives back the old rules: `glide` 1.5 (pitch time constants), `declFront` 1 (declination follows 1 - (1 - x)², most of it in the first third), `downstep` 0.6 (each accent steps down 0.6 as far), `preHead` 0.5 (unstressed syllables before the first accent sit half a `lilt` higher, out of the trough), `nucFall` 0.35 (the nuclear fall and the post-nuclear stretch) and `stressLen` 1.8 (the stressed/unstressed vowel length contrast). The two VCTK voices take `final` 1.1 in place of the fitted voice's 0.35. The fitted voice keeps its own `final`. Stronger settings (`glide` 2, `downstep` 0.5, `stressLen` 2.3) came closer on the numbers but broke `contour-smoke`'s downstep check and `timing-smoke`'s aside check, which hold real cues.

Word gate (rules only, 200 lines, old against new): the man 47.3% to **44.6%**, the fitted voice 61.7% to **60.2%**. Not worse. The fitted voice's median pitch rises about 0.7 st, which `fitted-smoke` flags; the snapshot is retaken only after listening. Listening test 10 (`oracle-listen-prosody`, port 5654, `C:\Users\david\datasets\vctk\listen10`) plays the man's old rules against the new, 30 pairs.

Not done: the VCTK pitch head (`pretrain.pt`) was not refitted for these two voices. The rules now sit closer to the readers, so a head fitted on top would have less to correct. Measure it again with `intonation.py` before training one.

## The game's register: a teacher, later

VCTK is people reading newspaper sentences. Questions, barks ("Hey.", "Out of my way."), shouts, lists and the house voice of [story.md](../story.md) and [house-voice.md](../reference/house-voice.md) are thin or missing. David's recordings carry some of that at fine-tune. If the listening test says the game's lines still sound read, generate a few thousand lines of game text with a TTS teacher and add them to pre-training, aligned the same way.

The teacher's code, weights and training data all have to allow its output to train a model in a commercial game.

| Teacher | Code | Weights | Training data | Verdict |
|---|---|---|---|---|
| Parler-TTS Mini/Large ([repo](https://github.com/huggingface/parler-tts), [model card](https://huggingface.co/parler-tts/parler-tts-mini-v1)) | Apache-2.0 | Apache-2.0 | LibriTTS-R and English MLS, both CC BY 4.0 | **Usable, with credit** to both datasets. Men and women chosen by a text description. Gives no durations, so MFA again. |
| Matcha-TTS, LJSpeech and VCTK checkpoints ([repo](https://github.com/shivammehta25/Matcha-TTS), [checkpoints](https://github.com/shivammehta25/Matcha-TTS-checkpoints/releases)) | MIT | **No licence stated** for the checkpoints, nor for the HiFi-GAN vocoder weights it uses (checked 2026-11-23: release page, Drive folder and README) | LJSpeech (public domain); VCTK (CC BY 4.0) | **Blocked until the author licenses the checkpoints.** No licence means no permission. Otherwise the best fit: 108 VCTK speakers and a duration per phone with no aligner. |
| StyleTTS 2 ([repo](https://github.com/yl4579/StyleTTS2)) | MIT | Pre-trained models carry a condition that listeners be told the speech is synthetic | LJSpeech; LibriTTS | **Unclear.** Whether the condition reaches a model trained on its audio needs reading closely. |
| Kokoro-82M ([model card](https://huggingface.co/hexgrad/Kokoro-82M)) | Apache-2.0 | Apache-2.0 | Not itemised; partly other TTS systems' output | **Unclear provenance.** Don't use until the data is itemised. |
| Piper voices ([voices](https://huggingface.co/rhasspy/piper-voices)) | MIT, then GPL-3.0 for the current fork | Per voice | Per voice; many come from the `lessac` voice, on research-only Blizzard 2011 data | **Avoid** unless a voice's card shows a clean chain. |
| Coqui XTTS-v2 ([licence](https://coqui.ai/cpml)) | MPL-2.0 | Coqui Public Model License: non-commercial | Not itemised | **Excluded.** |
| F5-TTS ([repo](https://github.com/SWivid/F5-TTS)) | MIT | CC BY-NC 4.0 | Emilia (non-commercial) | **Excluded.** |

Only the Matcha row was checked at its source (2026-11-23). The others are from memory and must be checked at their links, with the date written in, before anything is downloaded. Training your own Matcha on VCTK would sidestep its missing licence (MIT code on CC BY data gives weights that are ours), but that's days of GPU time to make a teacher.

## Risks

- **It might not transfer.** Read newspaper prosody may not help a game voice. The three-way comparison is the test, and the gate set and phone-pair counts are worth having for Part 6 either way.
- **Accents mixing.** Scottish and Irish speakers are a third of the corpus. The accent check watches for it; the per-line normalising is the guard, and dropping accent groups from training is the fallback.
- **Alignment noise.** Real speakers drop and swap sounds. Dropping poorly fitting lines costs data, and there's plenty.
- **Licence.** CC BY needs the credit kept wherever the weights go. Each weights file names its training data in its header.
- **Time and disk.** 11 GB download, 23 GB with it unpacked. MFA overnight on the CPU; torchcrepe an hour or two on the GPU; training minutes.

## The steps, in order

1. Download VCTK 0.92 (about 11 GB) into a folder outside the repo. Done 2026-11-24.
2. Install MFA in its own conda environment; download `english_us_arpa`. Done: MFA 3.4.4 in micromamba environment `aligner` (`C:\Users\david\micromamba`, root prefix `root`). Run it as `micromamba run -n aligner mfa ...` with `MAMBA_ROOT_PREFIX` set to that root.
3. Write the dictionary script and the phone table; run `mfa validate` and fix what it reports. Done 2026-11-24: [vctk-dict.mjs](../../tools/voice-fit/ddsp/vctk-dict.mjs) holds the table and checks it covers every ORACLE phone. 43,873 lines (300 have no mic1 recording), 108 speakers, 5,840 words, each with its GA and RP pronunciation where they differ. Validate found no missing words and no unreadable audio.
4. Align; write the reader that turns TextGrids into `data.py`'s shape. Aligning done 2026-11-24, in 20 minutes with 8 jobs, not overnight: 43,864 lines aligned, 9 failed, TextGrids in `C:\Users\david\datasets\vctk\mfa\aligned` with MFA's per-line quality scores in `alignment_analysis.csv`. MFA picks the accent: an English speaker's "ask" came out as RP `AA1`. One thing for the reader: each word was looked up alone, so function words ("her", "to") carry a primary stress the sentence wouldn't give them. Take stress from `phonemesFor` over the whole line, not from the TextGrid. The reader is [vctk.py](../../tools/voice-fit/ddsp/vctk.py): it pairs each TextGrid with the trace `export.mjs --tracks-only` makes for the same text (by edit distance over the phone table, a line dropped past two inserted or deleted phones), gives each word gap the silence MFA found there, and warps the tracks with `data.item` (split out of `data.load`, which is otherwise unchanged).
5. Measure F0 and loudness; build the 200-line gate set. The measuring is `vctk.py` too: per-phone targets from `syllable.phone_targets`, one pickle per speaker. Pitch uses the same autocorrelation tracker as David's lines, not torchcrepe, so both sets are measured alike; its range is widened to 60 to 500 Hz for the women. Each line's pitch is scaled so its median matches the rules' (the register, `reg` in cents, is kept apart) and its durations are centred on the line's median (`rate`). On 50 of p225's lines, phone durations against the rules spread far past `syllable.py`'s 30% cap: the middle half within 31%, the outer tenth beyond 86%, partly MFA's 10 ms steps on short phones. So the uncapped value is kept as well (`dlog`), and the cap for pre-training is a training decision. The gate set is built (2026-11-24): [gate-set.mjs](../../tools/voice-fit/ddsp/gate-set.mjs) writes `gate-set.json` beside it, 200 lines and 1,585 words: 100 Harvard sentences, 60 NPC banter lines and 40 spoken lines from the broadcast scripts, picked by a fixed hash and skipping anything VCTK reads. The same file names the ten held-out speakers, a man and a woman from each of the five biggest accent groups: p225, p226 (English), p294, p311 (American), p234, p237 (Scottish), p266, p245 (Irish), p303, p302 (Canadian). The Harvard sentences were tuned against before (systems-procedural-audio.md), so the rules start with an advantage on them; the game lines are the fairer half.
6. Pre-train, fine-tune, compare three ways, listen.
