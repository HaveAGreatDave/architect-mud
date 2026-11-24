# ORACLE: what to do next

Status: items 1 to 8 and 10 built (phone alignment, fitted durations, consonants, the front velar locus, the vowels before r and l, loudness and voice quality in `tools/voice-fit`; the passage effect, hard onsets, the fall in loudness, lists, tags, laughs and vowel-to-vowel coarticulation in the engine; a gate for the fitted voice). Item 9 waits on a second reader.

This follows [oracle-naturalness.md](oracle-naturalness.md), whose ten items are built, and the first fitted voice ([tools/voice-fit](../../tools/voice-fit/README.md)): one speaker's vowels, drift, lip locus, rate, pitch and pauses, measured from a 15-minute recording of [the script](../../data/voice/oracle-recording-script.txt). The fitted vowels are now the base for GA and Canadian voices.

What changed since the first survey is that we can now measure ORACLE against a real voice, line by line, with the same scripts on both. Most of what follows uses that: the recording is already on disk, so several items need no new recording at all.

The list is ranked by how much natural sound each buys for the work. Each says what it needs and how we'd know it worked.

## 1. Align the recording phone by phone

Everything below that touches consonants or timing needs to know where each sound starts and ends in the recording. We don't have that: we know where each line and each test vowel is, not where the /t/ in "kettle" is.

The classic non-neural way is analysis by synthesis with dynamic time warping. ORACLE already knows exactly where every phone is in its own render of a line (`speak`'s `trace`). Render the line, take MFCCs of the render and of the recording, warp one onto the other with DTW, and carry the render's phone boundaries across. Boundaries land within about 20 ms of hand labels for a voice that's close to the speaker's, and the fitted voice is close now.

**Built:** `render-trace.mjs` and `align.py`, with `check-align.py` scoring the result against what each phone must sound like, since there are no hand labels. On Part 3 the warp scores 0.53, 0.74 and 0.67 on hiss, closures and voicing, against 0.18, 0.51 and 0.49 for an even stretch and a ceiling of 0.58, 1.00 and 0.86. The scores are in the [voice-fit README](../../tools/voice-fit/README.md#phone-alignment).

## 2. Fit durations to the speaker

With item 1, Part 3 gives about 4,000 phones with their durations. Klatt's rule system has two numbers per phone, an inherent duration and a minimum (`d` in `PH` and `MIN_SHARE`), plus a dozen multipliers. Fit them by least squares on the log durations: the rules stay the same, and only the numbers become this speaker's. Van Santen (1994) did exactly this for American English and cut the error by about a third against Klatt's hand-set table.

Today the fitted voice matches the speaker's syllable rate, but only as an average: a vowel and a stop are sped up by the same factor. Real speech compresses vowels far more than stops.

**Built, and it mattered less than expected.** Per-phone factors (`durs` on a voice) took the held-out median error from 22% to 21%: ORACLE's rules already matched this speaker within 1 or 2% in almost every context, and most of the 20% left is alignment noise. The one clear offset was phrase-final lengthening, which this speaker uses about a third as much as Klatt's ×1.30. A voice's `final` now scales it. The detail is in the [voice-fit README](../../tools/voice-fit/README.md#durations).

## 3. Pitch over a passage, not just a sentence

Part 4 showed the clearest gap left: reading a passage, the speaker used 4.3 semitones of range against 5.15 on single sentences, and the voice used its sentence range throughout. Readers also reset pitch higher at the start of a new topic (a paratone), drop it at the end of a paragraph, and narrow the range for asides.

The model for this is Fujisaki's: a phrase command per sentence whose size depends on the sentence's place in the passage, and accent commands on top. ORACLE's per-phrase declination already resembles the phrase component. What it lacks is any memory across sentences beyond the `phraseK` downstep. Add a paragraph position (first sentence, middle, last) and scale range and starting pitch by it.

Part 4 also shows a rate effect: the speaker reads the passage about 11% faster than single sentences (5.41 syllables a second against 4.85), and the voice reads both alike.

**Built.** The start higher and the step down were already there (a new paragraph starts 1.5 semitones up, and each sentence after the first in it 0.3 lower, two steps at most). What was missing was the passage itself: `PASSAGE` in `audio-engine.js` speeds a line up by 11% and narrows its accents' range by 35%, growing from nothing on a one-sentence line to the full effect at four sentences. Pauses aren't sped up with it. On Part 4 the voice now reads at 5.34 syllables a second against the speaker's 5.41, with a range of 4.22 semitones against 4.28 (it was 4.85 and 5.15). Its median sits 0.6 semitones under his, since narrowing the accents takes their peaks off; the rest of the passage matches.

## 4. Consonants measured, not guessed

Each consonant's numbers in `PH` (the frication band `nf`, its width `nq`, the level `ng`, the burst `bq` and `bg`, the breath `asp`) were set by ear. With item 1 they can be measured from the recording: the spectral centre of gravity and spread of each /s/, /ʃ/, /f/ and /θ/, the burst spectrum of each stop (Stevens and Blumstein's diffuse-rising, diffuse-falling and compact shapes), and the VOT of every /p t k/. Fit ORACLE's numbers to them the way `fit-source.mjs` fits brightness: render, measure the same way, adjust.

**Built, for the sibilants and the stops.** `measure-cons.py` takes each fricative's centre of gravity and each /p t k/'s VOT, and `fit-consonants.mjs` moves a voice's `cons` (its own `nf` and `asp` per phone) until a render measures the same. /s z ʃ tʃ/ landed within 0.1% and the VOTs within 1 ms. The stock voice had /p/ at 53 ms against the speaker's 23, and /k/ at 79 against 63; /s/ was 7% low. The weak fricatives /f v θ ð/ wouldn't fit: their centre of gravity follows the voicing and the vowels round them, not the band, and moving `nf` only drove it to its limits. They stay stock, and the burst spectra are still by ear.

## 5. The velar and alveolar loci, and r and l

Two pieces of the recording are unused:

- **Velar loci, front and back.** Part 1 has "keen" and "kid" against "cool", "good" and "goat". Fitting two velar lines (before front vowels, before back ones) instead of one should give the r² the single line missed (0.64).
- **Vowels before r and l.** Part 2's 40 lines (fire, hour, pool, feel, girl...) are recorded and matched to the script but never measured. These are where rule voices sound worst. They need three-point trajectories, a start, middle and end, instead of a target and a drift. eSpeak stores these as frame sequences per vowel and liquid. The measuring code needs a vowel finder for words with no break before them (war, owl, real).

**Built: the r and l vowels.** `fit-liquids.mjs` aligns Part 2 the way Part 3 was aligned, measures F1 and F2 at 20% and 80% of each vowel and at the middle of the liquid after it (`measure-liquids.py`), and writes them to the voice as `liquids`, keyed by the pair (`'AY|ER'`, `'IY|L'`). The engine uses a pair's start and end for the vowel and its third point for the liquid, so "fire" and "feel" glide the way the speaker's do. Across the 17 pairs the mean F2 error went from about 240 Hz to about 110. A point no vowel could have (the start of "fire", where the alignment caught the /f/) falls back to the voice's own vowel.

**Built: the front velar line.** Part 5 of the recording script ("Say keen again.", 17 words with K and G before front and back vowels) added the readings Part 1 lacked. Each reading is set against its vowel's pooled middle from Part 1, and one more than 400 Hz off it is dropped ("gap" and "gone" caught the start of "again"). `VEL_F` fits at k 0.824, c 437 (r² 0.58, 16 readings) and the single `VEL` line at k 0.868, c 332 (r² 0.56, 43). `VEL_B` still doesn't fit (r² 0.1): back vowels span only about 600 Hz of F2. So the voice carries `VEL_F` and `VEL`, and `locusEq` falls back to `VEL` before a back vowel.

## 6. Hard vowel onsets

A vowel-initial word after a pause, or a stressed one ("I *am*", "*and* then"), usually starts with a glottal stop or creaky onset in English. ORACLE has no such thing: its vowels after silence fade in. A short glottal closure (a few ms of silence, then a pulse of creak through the `creak` track) on phrase-initial and emphasised vowel-initial words would sharpen every line that starts with "I", "and", "on" or "it". Pierrehumbert and Talkin (1992) give the conditions: phrase-initial, accented, and after a vowel-final word.

**Built.** `hardOnset` in the scheduler: a word-initial vowel starts with its voicing snapped on instead of faded in, after 25 ms of closure mid-phrase, with about 40 ms of creak through the worklet's `creak` track. Full strength at a phrase start or under an accent, half after a word that ended on a vowel, none otherwise. It comes out of the vowel's own time, so no timing moves; `natural 0` has none, and a question's onset is sharp without the creak, since a question carries no creak. `TUNING.hardOnset` scales it, and the worklet gate checks it.

## 7. Loudness across the phrase

ORACLE varies pitch with stress and phrase position, but loudness only by stress. Real speech also falls in intensity across a phrase, by 3 to 6 dB from first accent to last syllable, and the syllables after the nucleus are quieter still. The recording gives the numbers directly: the RMS of each syllable against its position, measured with item 1's alignment or roughly with the vowel runs already found.

**Built.** Every voice now falls in loudness across a sentence (`LOUD` in `audio-engine.js`: 3 dB first to last, half that on unaccented sounds, and 2 dB more after the nucleus), where before it fell well under 1 dB. `measure-loud.py` measures each vowel's level against its place in the sentence, accented and unaccented apart, and the drop after the nucleus. The speaker fell 6.8 dB on accents and 2.8 on the rest, dropped 10.5 dB after the nucleus, and kept his unaccented vowels 4.2 dB under his accents; the stock voice measured 0.6, 0.8, 3.4 and 3.3. `fit-loud.mjs` fits a voice's `loudFall`, `unaccFall`, `postNuc` and `unaccDb` until a render measures within 0.1 dB of him on all four. The worklet gate checks the fall.

## 8. Voice quality measured

The fitted voice's breathiness, tension and creak come from the rolled voice it's built on, not from the speaker. The standard measures are H1-H2 (how breathy), H1-A1 and H1-A3 (spectral tilt), and cepstral peak prominence (how periodic). All can be taken from the test vowels already found. Fit `oq`, `breath`, `jitter` and `creak` to them as brightness was fitted.

This also settles the open question about the tracheal pairs. They sounded nasal on this voice, and the measures say how breathy a voice must be before they help.

**Built.** `measure-quality.py` takes H1-H2, H1-A3, CPP and period-to-period jitter over the vowels, on the speaker and on a render. The rolled voice the first fit sat on was far too open: H1-H2 +5.7 dB against the speaker's -6.7, and a tilt of 29.8 dB against 14.5. `oq` moves both, and at its floor (0.4, a pressed voice) gives -4.7 and 16.0, which is as close as the source goes. Jitter, measured per period, was already close (1.1% against 1.4%), and the `jitter` knob barely moves it next to intonation. CPP sits 2.5 dB over the speaker's (23.5 against 21.0), and more breath moves CPP a little but breathiness and tilt the wrong way; the recording's room noise may account for part of it. The tracheal pairs move none of the four measures, so the question about them stays answered by ear: off on this voice.

## 9. A second base voice

The base vowels are one speaker's accent. A second speaker, a woman ideally, recorded with the same script, would give a second base. A voice could then sit anywhere between the two: a continuum of real vowel systems, not one system scaled by `fshift`. Vocal tract length differences between men and women aren't uniform across vowels (Fant 1966), so scaling one speaker's table by a single factor is the thing a second base fixes.

**Needs:** a second reader, and their agreement to their voice being used. Everything else is built.

## 10. Smaller things

- **Vowel-to-vowel coarticulation across a consonant** (Öhman 1966): in "a pit" against "a pat", the first schwa already leans toward the stressed vowel. ORACLE's undershoot only looks at the neighbouring sounds.
- **List intonation:** a rise on each item and a fall on the last ("apples, pears, plums and grapes"). The comma rule half-rises, but doesn't know the last item.
- **Tag questions:** "isn't it?" falls when it asks for agreement and rises when it really asks. ORACLE can't tell which, so it should at least use the fall, which is far more common.
- **Laughs and other sounds without words:** the game's characters laugh in text; ORACLE reads the word "ha". A breathy pulsed vowel on an aspirated onset, a few cycles, would do.
- **A gate for the fitted voice:** `compare-prosody.mjs` and `fit.mjs`'s numbers, checked against a stored copy, so an engine change that moves the fitted voice away from its speaker shows up.

**Built, all five.** `markLists` turns the commas of a list (two commas or more, each item four words or fewer, the last chunk joined by "and" or "or") into `_L`, which rises further than a comma, and puts a short `_LA` before the "and", so every item rises and the last falls. `tagQuestion` gives a tag ("isn't it", "do you", "right", "eh" after a comma, with two words or more before it) the wh-question's fall. A written laugh ("ha", "hahaha", "heh", "hee"; never "he") is one pulse per syllable: /h/ and `HA` or `HE`, a short vowel at 70% voice with breath and open folds. An unstressed vowel leans toward the stressed vowel after it across one consonant, a word gap allowed: a schwa a fifth of the way, other vowels a tenth (`TUNING.vvCoart`). The fitted voice is kept as `data/voice/fitted-voice.json`, and `scripts/voice/fitted-smoke.mjs` renders eight lines in it against a snapshot (length within 3%, pitch within 3%, loudness fall within 1.5 dB); slowing the voice 7% failed all eight. The worklet gate checks the other four.

## Order

1 first: 2 and 4 need it, and 5 shares its vowel finder. Then 2, which changes every line. 3, 6 and 7 are engine work that needs no new data. 8 is cheap once the measuring is in place. 9 waits on a reader.

## Papers

- Van Santen, J. (1994). Assignment of segmental duration in text-to-speech synthesis. Computer Speech and Language 8.
- Fujisaki, H. and Hirose, K. (1984). Analysis of voice fundamental frequency contours for declarative sentences of Japanese. Journal of the Acoustical Society of Japan 5.
- Pierrehumbert, J. and Talkin, D. (1992). Lenition of /h/ and glottal stop. Papers in Laboratory Phonology II.
- Stevens, K. and Blumstein, S. (1978). Invariant cues for place of articulation in stop consonants. JASA 64.
- Hillenbrand, J., Cleveland, R. and Erickson, R. (1994). Acoustic correlates of breathy vocal quality. Journal of Speech and Hearing Research 37.
- Fant, G. (1966). A note on vocal tract size factors and non-uniform F-pattern scalings. STL-QPSR 7.
- Öhman, S. (1966). Coarticulation in VCV utterances: spectrographic measurements. JASA 39.
- Sakoe, H. and Chiba, S. (1978). Dynamic programming algorithm optimization for spoken word recognition. IEEE Transactions on Acoustics, Speech and Signal Processing 26.
