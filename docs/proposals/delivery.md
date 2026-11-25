# Delivery: one emotion for the voice and the face

Status: phase 0 built (effort on the voice and the face, NPC yells, shouts and whispers voiced); the rest is design.

A person who's annoyed sounds annoyed and looks annoyed, and a person who yells is louder, opens their mouth wider and widens their eyes. Today those are two systems that don't talk to each other. NPC moods (`npcMoodOf`, [systems-expressions.md](../systems-expressions.md)) move the face and never reach the voice. ORACLE's one emotional setting, `excite` ([Selling a line](../systems-procedural-audio.md#selling-a-line-excite)), moves the voice and is only used by the hockey booth. A shout (a line in caps) is louder and longer but its face doesn't change.

This plan joins them. A line is spoken with a **delivery**, and the voice and the face both read it from one table. The game sets it from the NPC's mood and what they're saying. The Broadcast Studio sets it by hand per beat and per line, to direct a performance.

## The delivery

One small object, in a new engine file `client/shared/delivery.js` beside `expressions.js`:

```js
{ mood: 'annoyed', i: 0.7, effort: 0, casual: 0.4, excite: 0 }
```

Four separate axes, because they mix freely. An annoyed person can mutter or yell; a happy one can be casual or on air.

| axis | range | what it is |
|---|---|---|
| `mood`, `i` | a mood off `EXPRESSIONS`, 0 to 1 | how they feel. The same list the face already uses, so nothing new to keep in step |
| `effort` | -1 to 2 | how loud they're trying to be: -1 a whisper, -0.5 quiet, 0 normal, 1 raised, 2 a yell |
| `casual` | 0 to 1 | careful reading against relaxed talk |
| `excite` | -1 to 1 | the booth's selling, unchanged; kept so every hockey line sounds as it does now |

Zero on every axis is today's voice and today's face, exactly, which a gate holds.

## What the voice does

`deliveryFor` already turns `excite` into multipliers: register, range, declination, rate, pauses, nucleus hold, brightness, loudness, open quotient, breath, creak, F1, jitter. It becomes the one place every axis is summed, in log terms, so axes add instead of fighting. Each mood gets a row of those same multipliers in `delivery.js` (`VOICE`), next to its face row, plus a few the moods need that `excite` didn't:

- the **phrase end**: fall, rise or level (fear and confusion rise; annoyance falls hard)
- **tremor**: a slow wobble in pitch and level, 5 to 8 Hz (fear, crying)
- **smile**: every formant up a few per cent, as lips spread shorten the tract (happy, amused)
- **hesitation**: a chance of a pause or an "uh" before a content word (confused, afraid)

A starting table, from the literature (Murray and Arnott 1993; Cahn 1990) and to be tuned by ear:

| mood | pitch | range | rate | voice | end |
|---|---|---|---|---|---|
| annoyed | -1 st | 0.8 | 1.05, clipped vowels | pressed, crisp consonants | hard fall |
| angry | +2 st | 1.3 | 1.05 | pressed, louder (implies effort 0.6) | hard fall |
| afraid | +4 st | 0.8 | 1.15, broken phrases | breathy, tremor | rise |
| happy | +3 st | 1.5 | 1.05 | bright, smile | fall then lift |
| sad | -2 st | 0.6 | 0.85 | breathy, soft, creak | low fall |
| confused | +1 st | 1.0 | 0.9, held vowels, hesitations | slightly breathy | level or rise |
| tired | -2 st | 0.5 | 0.85 | lax, creak | low fall |

**The mood directs the intonation.** Words alone often don't say how a line goes: "Fine." can be agreement, a sulk or a threat. So the mood written with a line (a tag, [npc-speech.md](npc-speech.md)) directs its delivery, and where the words already settle it, the mood adds strength. The neutral reading is the intonation fitted against VCTK's North American speakers ([oracle-teacher.md](oracle-teacher.md), "Intonation and rhythm"): `glide` 1.5, `declFront` 1, `downstep` 0.6, `preHead` 0.5, `nucFall` 0.35, `stressLen` 1.8 in `TUNING`, with each voice's `lilt` and `final`. A mood bends that reading by scaling them per line, not by replacing it:

| mood | lilt | glide | downstep | nucFall | other |
|---|---|---|---|---|---|
| sad, tired | down | up (slower) | weaker | up | `final` up, slower |
| angry | up | down (faster) | stronger | up | `stressLen` up, quicker |
| excited (happy, surprised) | up | | | down | `preHead` up, declination down, quicker |
| unsure (confused, afraid) | down | | | about 0 or a small rise | more pausing |
| sarcastic | up | up (drawn out) | | a rise-fall | the key word stretched |

*Built (2026-11-24).* `deliveryFor` carries a factor for each (`glide`, `declFront`, `downstep`, `preHead`, `nucFall`, `stressLen`, and `finalK` on the voice's `final`), 1 unless a delivery changes it, and the engine reads `TUNING.x * D.x` where it read `TUNING.x`; `segmentDuration` and `estimateDuration` get `stressLen` through their context. `VOICE_MOODS` has the directions above as numbers, and **sarcastic** is a new mood with a face (a smirk, the left brow up) and a look line. A `nucFall` below 0 (afraid) is a small rise. (Directions from David, through the intonation session, 2026-11-24.)

The first blind test (before these) went badly: 11 clips answered, none right, chance one in ten. On neutral sentences in a formant voice the moods weren't telling apart. The second test (`mood2`, port 5654, 66 clips with sarcastic) has the intonation in it. In the game a line also has its words and the face, which the test leaves out on purpose.

**Effort** is mostly physics, and it's the clearest one to build first. Louder speech is more than gain: pitch rises about a semitone for every 3 dB of effort, F1 rises because the jaw opens, the source is pressed so the spectrum's top end comes up, vowels lengthen, and consonants get stronger bursts. Whispering turns voicing off and puts everything through aspiration. At 2 the yell also pushes the pitch into strain: more jitter and a rougher source.

**Casual** pushes past the passage mode Part 4 measured: faster weak syllables and function words, joined-up words (the word-gap shrinks), fewer and smaller accents, shorter pauses, a laxer source, more of the reductions the rules already make. The prosody tests in [oracle-neural.md](oracle-neural.md) measured what it costs: speaking at David's pace cost Whisper words. So casual defaults to about half, and the cost of each level is measured on the 200-line gate set before anything ships.

## What the face does

The face already wears a mood. Two things are new.

**Effort on the face.** `effort` gets a row of face channels in `delivery.js` (`FACE_EFFORT`), added to the mood's: at 2, eyes wide (`lid`), brows up (`browUp`), nostrils flared, head forward and chin up, and the jaw's speech opening scaled up, so every open vowel opens wider. At -1 the mouth barely opens. So a yell looks like one whatever mood is under it.

**The voice drives the face.** `speak()` already hands the Stage a trace (each phone, when it starts, and which are accented) on `npc:voice`. With the delivery in it as well, the face can follow the speech, not just the mood:

- the jaw's opening per phone scaled by effort and by the vowel's own loudness;
- an **eyebrow flash** and a small head nod on each accented syllable, sized by `range`, the way people mark the word they're stressing;
- the head dropping a little at a falling phrase end, rising at a question;
- the mood's mouth shape kept under speech instead of dropped: today "speech wins", so a happy person's smile disappears while they talk. The corners stay up and the lips still move.

A whisper, a mutter and a yell are now three different faces on the same line.

## Where it's set: the game

This is the main case. Everything is worked out from what's already known, and nobody has to author anything for a line to come out right.

1. **The mood**, from `npcMoodOf` at the moment of speaking. The server puts it on the speech line it sends (a `data-mood` attribute on `.speech-line`), so the log rung and the Stage get the same value and a line spoken angry is played angry even if the mood has worn off by the time it reaches the client. `npc-bubbles.js` reads it and passes it into `speak()`.
2. **Effort**, from the verb and the text: `yell` (today a yell line isn't voiced at all) is 2; `whisper` -1; a line in caps 1.5, as the shout is now; a line ending in `!` 0.5; an angry mood adds 0.6.
3. **Casual**, from the speaker: `flags.voice.casual` on the NPC's content file for the regulars who always talk that way, and a default for the `npc` channel (about 0.4). Broadcast and the reading voice default to 0.
4. **A dialogue node** can override any axis for its own line: `"delivery": { "mood": "afraid", "effort": -0.5 }`, the same way `SET_MOOD` sets a face. A node's delivery doesn't change the NPC's mood; `SET_MOOD` still does that.

The player's own lines can use the same thing later; nothing voices them now.

## Where it's set: the Broadcast Studio

A show is directed, so here it's set by hand, with what the game would pick as the default.

- **Per beat, per person.** The beat's Face (`beat.face[role]`, in [sequence.js](../../client/shared/sequence.js)) becomes a Delivery: the mood and its strength, plus effort and casual sliders. A host can be "annoyed, 0.4, casual" for the whole beat, and the voice and face both follow.
- **Per line.** A line in a script can override the beat: a small inline mark at the start of the line, e.g. `[afraid 0.8, quiet]`, read and stripped before the text is spoken or shown. The `.bsm` format gets the same mark, so a scripted show and a sequence use one syntax. A word in caps keeps meaning emphasis.
- **Within a line, later.** A mark mid-line changes the delivery from that word on ("Fine. [angry] FINE."). That needs `speak()` to change settings inside a line; phase 4.
- **Preview.** The Studio plays the line with the face on its set, so a director hears and sees the change together, with the sliders live.

`excite` stays where it is for the hockey booth, which sets it per line from its pools. A beat's delivery adds to it.

## Phases

0. **`delivery.js` and effort.** The table, the summing in `deliveryFor`, and effort on the voice and face. Yell lines get voiced. Gate: every axis at 0 gives today's tracks and today's face exactly (an extension of the FM smoke and `fitted-smoke`), and the effort levels are checked with Whisper on the gate set so a yell is still understood.
   **Built (2026-11-24).** [delivery.js](../../client/shared/delivery.js) holds `voiceEffort`, `faceEffort` and `effortFromLine`. The voice side is a plain bundle of numbers passed as `speak(text, { delivery })`, since audio-engine.js is a classic script and can't import the table: factors on `deliveryFor`'s keys, amounts added to `oq` and `breath`, a line gain, and `whisper` (voicing out, breath in). [npc-bubbles.js](../../client/game/js/panels/npc-bubbles.js) picks the effort from the verb (yells, shouts, screams 2; whispers -1; mutters -0.5) or the line (caps 1.5, a closing `!` 0.5), and sends it on `npc:voice`. The Room Stage puts it on the speaker's mouth, and `room-people.js` widens the jaw by `jawK` and adds the effort's face channels on top of the mood, only while the line is said. A player's own yell (`.yell`) still isn't voiced, and a shout sent as a `zone_event` with no `speech-line` isn't either.

   Measured with [effort.mjs](../../tools/voice-fit/ddsp/effort.mjs) on the fitted voice over ten lines: whisper -14 dB with voicing in 4% of frames, quiet -4.5 dB, raised +5 dB and 2.6 semitones up, a yell +11 dB and 5 semitones up; a delivery of effort 0 renders the same samples as none. Whisper word error ([effort-wer.py](../../tools/voice-fit/ddsp/effort-wer.py), 67 words): whisper 60%, quiet 40%, normal 37%, raised 27%, yell 39%. A whisper costs words as a real one does; a yell doesn't. David approved the five levels by ear the same day.

1. **Moods on the voice.** *Built (2026-11-24), being judged by ear.* `VOICE_MOODS` in delivery.js has rows for annoyed, angry, afraid, happy, amused, sad, confused, tired and surprised; a mood's factors are raised to its strength (`k^i`), a negative `decl` turns the fall into a rise, and `fshift` scales every formant for a smile (the one engine change this phase). On the Stage and in one-world the voice takes the mood the face is showing, answered on `npc:place`; on the text rungs there's no mood yet, which the server attribute below fixes. Measured on six neutral sentences ([mood-test.mjs](../../tools/voice-fit/ddsp/mood-test.mjs)): sad and tired 3 semitones down and 22% slower, afraid 5 up and 14% faster, angry 4 up and 5 dB louder. No mood raised Whisper's word error over plain (46%; every mood 33 to 46%). The blind test (`mood-test.mjs serve`, port 5654) plays each of the 60 clips at one loudness and asks which mood it was; `score` prints the hit rate and the confusions.

   Still to do in this phase: rows for the moods without one (disgusted and the show moods); the server attaching the mood to speech lines, so the text rungs and a line spoken before the mood wore off get it too; tremor and hesitation.
2. **The face from the voice.** Effort on the face, accent flashes and nods, the mood's mouth kept under speech.
3. **Casual.** As above, with its word-error cost measured per level.
4. **The Studio.** Delivery per beat and per line, the inline marks, the `.bsm` mark, the live preview. Then the change inside a line.
5. **Fitting to David.** A recording session: 20 sentences read neutral, annoyed, angry, afraid, happy, sad, confused, and once each quiet and yelled. Paired against his neutral reading, that measures how far each of his own settings moves, the way Part 3 fitted pitch. It replaces the literature's numbers in the table with his.

## How it's checked

- **Nothing changes at zero**, checked exactly, as above.
- **Still understood.** Whisper on the 200-line gate set per mood and per effort level, so the cost of each is known. A yell and a whisper may cost some words; a mood at 0.5 shouldn't.
- **Recognised.** The listening page ([listen.html](../../tools/voice-fit/ddsp/listen.html)) gains a test that plays a line, voice only, and asks which mood it was. Above one in seven, the mood comes through; the confusions say which rows to change. Then again with the face, on the Stage, to check the two agree.
- **A bench.** The Modelshop gets a delivery bench: a face, a line, a slider per axis, play. The expressions doc already lists a slider bench as missing.

## Risks

- **Caricature.** Formant voices pushed this far tend to sound like a cartoon, and happiness is the hardest. Defaults stay mild and strength is turned up only where a director or a script asks.
- **The face's channels fighting speech.** A mood's `press` or `round` can stop the mouth moving. Speech keeps the jaw and the lip opening; a mood keeps the corners, the brows and the eyes.
- **Two sessions on one file.** All of the voice side is in `audio-engine.js`, which other sessions are editing. The table lives in `delivery.js` so the engine change is one call into it.
