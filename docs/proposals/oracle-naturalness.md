# ORACLE: what would make it sound more natural

Status: all ten built. 9 is the letter-to-sound trees in `oracle-lts.js`, built by `scripts/voice/build-lts.mjs` from the lexicon the game already ships (no download), checked by `lts-smoke`: on held-out words 64.0% right against the rules' 22.7%, 91.6% of phones against 72.8%. A second set of trees in the same file places the stress on words the lexicon lacks: the right vowel on 85.8% of held-out words, against `guessStress`'s 81.5%. 8 was mostly there already (`coalesceYou`, `elideTD`, `glottalT`, weak vowels); unstressed word-final /d/ assimilation is new. 10 was mostly there (`fshift`, F5, burst spectra by place); the lip smack (`smack`) is new. 6 was mostly there already (`placeAccents`: given/new across a channel's recent lines, minor breaks, one nucleus, no final pronoun); the subject-verb break before an auxiliary (`AUX_BREAK`) is new. For 7 the Fujisaki rework wasn't done: Pierrehumbert's bridging was (`sagShape`), so two close prenuclear peaks hold the pitch up between them, never into the nucleus. 1 to 3 are the vowel drift `vs`, `LOCUS_EQ` and `MIN_SHARE` in `audio-engine.js`, each with a Voice Lab knob (`visc`, `locusEq`, `minDur`). For 4, F1's open-phase widening was already there (`f1Open`); the tracheal pairs are new (`trach`, worklet only). For 5, the flat `micro` was there; the onset bump that falls away and VOT by stress are new.

ORACLE is already a good rule-based formant synth. It has an LF source with Rd per syllable, per-cycle jitter and shimmer, a Klatt cascade with F1 following the glottis, a nasal pole-zero pair, a frication branch, creak, Lindblom undershoot, nasal assimilation, flapping, final lengthening that reaches back to the stress, declination with downstep, intrinsic F0, wh- vs yes/no questions, and breath intakes. This note lists what the rule-based literature and the open-source synths do that ORACLE doesn't, ordered by how much naturalness each buys for the work.

## What the others do

| System | Kind | What's worth taking |
|---|---|---|
| DECtalk / Klattalk (Klatt 1987) | rule-based formant | Duration rules with a minimum duration (incompressibility); context-dependent loci; F0 bumps after voiceless stops |
| KLSYN88 (Klatt & Klatt 1990) | formant synth | Tracheal pole-zero pair for breathy voice; full parallel branch with per-formant amplitudes A2F..A6F; bandwidths that widen with open glottis |
| eSpeak NG | formant + rules | Vowels as frame sequences (a start and end spectrum), not one target; per-place transition tables; intonation "tunes" per clause type |
| Festival / Flite | diphone, unit, HTS | CART letter-to-sound trained on CMUdict; POS-tagged homographs and phrase breaks; ToBI accent prediction |
| MBROLA | diphone PSOLA | Recorded transitions; shows that most of what's missing from formant speech is in the transitions |
| HTS / MaryTTS | HMM parametric | Trajectories learned from a corpus with delta features, so movement is smooth and statistically shaped |
| gnuspeech / VocalTractLab | articulatory | Gestural timing: consonant and vowel gestures overlap, coarticulation falls out of the model |
| Praat KlattGrid | formant synth | Reference implementation of KLSYN88 with time-varying bandwidths, handy to A/B against |

## Recommendations

### 1. Vowels that move (vowel-inherent spectral change)

Nearey & Assmann (1986) and Hillenbrand et al. (1995) showed that American English "monophthongs" aren't steady: /ɪ ɛ æ ʊ/ drift between 20% and 80% of the vowel, and listeners use that drift. Identification of Hillenbrand's vowels drops from about 92% to 74% when the formants are flattened. ORACLE gives a vowel one target (`p.f`), plus `df` for some. Give every vowel a two-point target (onset and offset) taken from Hillenbrand's tables. That's data, not code, and probably the biggest single gain. eSpeak does this with its per-vowel frame lists.

### 2. Locus equations instead of one locus per place

At the moment each obstruent has one `lf` locus that the formants glide toward. Real F2 onsets depend on the vowel: F2onset = k·F2vowel + c, with k and c per place (Sussman, McCaffrey & Matthews 1991; for example labial k ≈ 0.8, alveolar ≈ 0.45, velar splits front and back). Velars especially need two loci (front /ɡi/ vs back /ɡu/). This is a few lines where `lf` is read and fixes the stops' place cues.

### 3. Klatt's duration rule with a minimum

Klatt (1979) wrote every shortening rule as DUR = (INHDUR − MINDUR) × PRCNT/100 + MINDUR, so a segment never shrinks below its minimum however many rules apply. `segmentDuration` multiplies plainly, so stacked clusters, unstressed, fast-speech rules can crush a segment. Add a `min` per phoneme and apply the factors to the compressible part. Klatt's other rules worth checking against the list: vowels lengthen before voiced consonants (rule 7, up to 1.6×, the strongest voicing cue for final consonants: "bead" vs "beat"), and the polysyllabic shortening rule.

### 4. Time-varying bandwidths and the trachea

Within a glottal cycle the open glottis loads the tract and widens B1 (Fant's glottal damping; Childers & Lee 1991). ORACLE moves F1 with the glottis; widening B1 in the open phase as well is cheap in the worklet and takes the "ringing" off formant speech. For breathy voice, KLSYN88 adds a tracheal pole-zero pair near 550/1500 Hz that's switched in with Rd; without it, breathy voices sound like modal voice plus noise.

### 5. Microprosody at consonants

There's `intrinsicF0` per vowel. Add the consonant side (Lehiste & Peterson 1961, Hombert 1978): F0 starts 5 to 10% high after a voiceless obstruent and falls over about 50 ms, and dips slightly through voiced obstruents. Stress also lengthens VOT; an /s/-cluster stop (/sp st sk/) has none. Check the stop rows for both.

### 6. Phrasing and accent from the words, not the punctuation

Rule-based TTS gets most of its sense of meaning from where it breaks and what it accents:

- Phrase breaks inside long unpunctuated sentences by function/content-word chunking (Liberman & Church 1992, "chinks and chunks"; Bachenko & Fitzpatrick 1990). One rule: allow a minor break before a function word after a run of content words, preferring the middle of a long phrase.
- Deaccent given words (Hirschberg 1993): a content word repeated within a few sentences loses its pitch accent. Repeated accents on the same noun are one of the strongest "robot" tells.
- Nuclear accent on the last content word of the phrase, never on a pronoun or function word at the end ("I gave it to HIM" aside).

### 7. A smoother F0 model

The F0 is targets plus `setTargetAtTime`. Fujisaki's command-response model (Fujisaki 1983) builds F0 as a phrase component (slow decay from each phrase command) plus accent components (filtered step commands), in log F0. It gives declination, reset and accent shape from a handful of numbers and never produces the kinks that target chasing does. A cheaper step in the same direction: interpolate accent targets in log-Hz with a sagging transition between H* peaks (Pierrehumbert 1981), rather than independent approaches to each.

### 8. Connected speech the lexicon doesn't give

Assimilation is done for nasals and flapping exists. The rest of the common ones:

- Yod coalescence: "did you" /dɪdʒu/, "got you" /ɡɑtʃu/.
- Alveolar place assimilation for stops: "that boy" /ðæp bɔɪ/, "good girl" /ɡʊɡ ɡɝl/.
- Elision of /t d/ between consonants: "next day", "last chance".
- Weak forms for the common function words when unstressed ("and" /ən/, "for" /fɚ/, "can" /kən/, "of" /ə/ before a consonant). Check FUNC words get the weak vowel, not only reduced stress.

### 9. Letter-to-sound for the unknown words

28k words plus hand rules is decent. Flite's CART letter-to-sound trained on CMUdict gets about 96% words right on held-out words, and the trees are small enough to ship as a JSON table (a few hundred KB). Sequitur G2P (Bisani & Ney 2008, joint-sequence n-grams, not neural) does better still. Either could replace the spelling rules as the fallback after the lexicon. Lower priority than 1 to 8: errors here are occasional, while the items above are on every line.

### 10. Small things

- Speaker: F4 and F5 are fixed relative to F3; scaling all formants by vocal tract length per voice, and lifting F5 for children, is the classic speaker cue.
- Plosive bursts: per-place burst spectra after Stevens & Blumstein (1978): diffuse-rising alveolar, diffuse-falling labial, compact mid velar that follows the vowel's F2.
- Lip smacks and a little click at the start of a phrase after silence, at low level: unit-selection voices sound human partly because of them.

## Order of work

1, 2 and 3 are table and rule changes in `audio-engine.js` with no new tracks: do them first. 4 is worklet-only and needs a new bandwidth track (`q1` exists; make B1 vary within the cycle in `oracle-worklet.js`). 5 and 8 are rules in the phoneme pass. 6 and 7 are a rework of the prosody section in `speak()` and want their own Voice Lab A/B. 9 is a data build.

Each change should be judged in the Voice Lab against the current voice on the same lines, and add a row to [bibliography.md](../reference/bibliography.md) for every paper used.

## Papers

- Klatt, D. H. (1979). Synthesis by rule of segmental durations in English sentences.
- Klatt, D. H. (1980). Software for a cascade/parallel formant synthesizer. JASA 67.
- Klatt, D. H. (1987). Review of text-to-speech conversion for English. JASA 82.
- Klatt, D. H. & Klatt, L. C. (1990). Analysis, synthesis and perception of voice quality variations among female and male talkers. JASA 87.
- Fant, G., Liljencrants, J. & Lin, Q. (1985). A four-parameter model of glottal flow. Fant (1995), The LF-model revisited.
- Nearey, T. & Assmann, P. (1986). Modeling the role of inherent spectral change in vowel identification. JASA 80.
- Hillenbrand, J. et al. (1995). Acoustic characteristics of American English vowels. JASA 97.
- Sussman, H., McCaffrey, H. & Matthews, S. (1991). An investigation of locus equations as a source of relational invariance for stop place categorization. JASA 90.
- Stevens, K. & Blumstein, S. (1978). Invariant cues for place of articulation in stop consonants. JASA 64.
- Lehiste, I. & Peterson, G. (1961). Some basic considerations in the analysis of intonation. Hombert, J.-M. (1978). Consonant types, vowel quality and tone.
- Childers, D. & Lee, C. (1991). Vocal quality factors: analysis, synthesis and perception. JASA 90.
- Fujisaki, H. (1983). Dynamic characteristics of voice fundamental frequency in speech and singing.
- Pierrehumbert, J. (1981). Synthesizing intonation. JASA 70.
- Hirschberg, J. (1993). Pitch accent in context: predicting intonational prominence from text. Artificial Intelligence 63.
- Liberman, M. & Church, K. (1992). Text analysis and word pronunciation in text-to-speech synthesis.
- Bachenko, J. & Fitzpatrick, E. (1990). A computational grammar of discourse-neutral prosodic phrasing in English.
- Bisani, M. & Ney, H. (2008). Joint-sequence models for grapheme-to-phoneme conversion. Speech Communication 50.
