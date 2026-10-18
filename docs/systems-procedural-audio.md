# Procedural Material/Action Audio (as built)

Sound generated from **what happened**, not from a library of recordings.

There is no "chopping a carrot" sound and no "chopping a rat haunch" sound. There is one chop
generator, and the material tells it how hard, how wet and how dense the thing under the blade is.
85 food items across ten material classes therefore cost one generator, and a new ingredient is
audible the day it's tagged without anyone opening the audio code.

```
ACTION → MATERIAL → INTENSITY → (STATE) → layer parameters → sound
```

Cooking is the first implementation, not the owner. `stream` and `flatus` already prove the point —
they're the same machinery with nothing culinary about them.

## Where it lives

| File | Holds |
|---|---|
| [`client/shared/procedural-sfx.js`](../client/shared/procedural-sfx.js) | **everything acoustic** — tables, generators, the seeded RNG. Dual-mode (window + ESM import) |
| [`plugins/audio/index.js`](../plugins/audio/index.js) | the routing: semantic event → parameters + seed → the wire |
| [`client/game/js/dispatch.js`](../client/game/js/dispatch.js) | `audio_sfx_proc` — rebuilds the cue from the seed and plays it |
| [`client/shared/audio-engine.js`](../client/shared/audio-engine.js) | **SIREN**, the synth — and **ORACLE**, the voice, further down the same file |

**Almost no new synthesis.** `AudioEngine.buildLayer` already did audio-rate FM, filtered noise,
pitch bends, tremolo and ADSR; this system mostly just decides the numbers, and emits the same
`{ config: { duration, layers } }` def shape every other cue in the game uses.

The exceptions are worth naming rather than glossing, because "it is all reuse" stopped being true:
**`whiff`** and **`gunshot`** are genuinely new generators (a miss and a shock front are neither a
chop nor an impact), and the engine itself gained **drive** and a **reverb send** — see
[the room, the wall and the drive](#the-room-the-wall-and-the-drive) below.

## The contract

A system that makes noise **emits semantics and never a sound**:

```js
emit('cooking.sfx', { zoneId, playerId, action: 'chop', material: 'wet_meat', intensity: 0.8 })
```

It must not know what that sounds like. The one thing a caller owns is the translation from its own
vocabulary to the shared one — cooking maps its `food_profile` catalog to material tokens, because
the profiles are cooking's property.

That separation is what lets smithing, chemistry, repair or industrial machinery emit
`{ action: 'impact', surface: 'metal', intensity }` and get audio for nothing.

## Parameters, not layers

**The server never sends layers.** It sends the semantic parameters plus a seed; the client rebuilds
the identical sound locally.

| cue | rendered | on the wire | |
|---|---|---|---|
| sizzle (high heat) | 5,958 B | **78 B** | 76× |
| boil (rolling) | 6,910 B | **74 B** | 93× |
| chop | 675 B | 68 B | 10× |

This matters because a sizzle is a *particle field* — ~32 randomised burst layers — and it goes to
every player in the room, and `deglaze` fires three cues at once. The first version shipped the
rendered layers and cost 6 KB a sniff.

Every random draw goes through **mulberry32**, seeded per cue. Server and client must agree exactly,
and a cue has to be reproducible while someone is tuning it. `buildActionCue` seeds on entry and
restores `Math.random` in a `finally` — leaving a seeded generator armed would make every subsequent
cue in that tab deterministic.

> Only generators with a **generated layer field** need this. All 33 other server-sent cues in the
> game are hand-authored with a handful of fixed layers and are already cheap; the 22-layer poker
> shuffle lives client-side and never crosses the wire.

## Generators

| | for | driven by |
|---|---|---|
| `impact` | utensils, cookware, a mallet, a plate | surface, weight, intensity |
| `chop` | chop / cut / mince / score | material hardness, moisture, density |
| `scrape` | spreading, scouring, dragging | surface, intensity |
| `stir` | stirring | viscosity, moisture, vessel |
| `pour` | liquid leaving a vessel | flow, viscosity |
| `sizzle` | food meeting heat | heat, moisture, fat |
| `boil` | liquid at temperature | heat, viscosity |
| `stream` | a jet of liquid on a surface | **pressure**, surface, phase |
| `flatus` | exactly what you think | **pressure** |
| `note` | a struck/plucked musical note | instrument voice, note, **velocity** |
| `footstep` | one step, per tile entered | footing class, intensity, **wet**, **foot** |
| `door` | a door leaf opening or closing | `door_type`, open/close, powered |
| `lock` | the mechanism, not the leaf | lock family, lock/unlock/**denied** |
| `whiff` | a swing that hits nothing | **weight**, intensity |
| `gunshot` | a firearm discharging | **calibre**, intensity, suppressed |

One generator is not like the others: **`note`** makes a *musical* sound rather than noise made by an
object, and it is the only one here with **no `vary()` in it at all**. Everything above jitters itself
so the ninth chop doesn't sound machine-stamped; a note must not, because two people standing in the
same room build the performance independently and have to arrive at the same sound. There is no seed
on its wire format for the same reason — there is nothing random to reproduce. Its table is
`INSTRUMENTS`, and the parameter the whole thing rests on is `fm.indexEnd`: a modulation index that
**collapses across the note** is what reads as *struck*. See [systems-instruments.md](systems-instruments.md).

## The room, the wall and the drive

Three things the engine could not do at all, added together because they are one
idea: a sound should carry where it happened, not just what happened.

**Reverb.** There was none. A stone church, a storm drain, a shipping container and
the open waste all sounded identical, because `echo` is a delay line — a repeat,
not a space. There are now eight rooms: seven chosen per zone and crossfaded on entry,
and an open-air ballpark a view picks by name (see [the mix](#the-mix-limiter-ducks-noise-filters-sends-and-rooms)).

The impulse responses are **generated, not sampled**: decaying noise through a
one-pole damping filter, per channel, which is a crude reverb and an entirely
convincing one at this scale. It keeps the promise the rest of the engine makes —
no assets, nothing to download. It is a **send**, so the dry path is untouched. Music
stays out of it — a song is not in the room with you — and **UI speech has its own dry
bus**, because Read Aloud is the one voice whose entire job is to be understood, and room
ambience on a screen reader is damage rather than texture.

⚠ **A television is a speaker standing in your room**, and this doc said the opposite for
one afternoon. The reasoning was that a broadcast's own room reverb is already baked into
what it plays — half right, and the wrong half to act on: the studio ambience is baked in,
and then the speaker is still in a room with you. The TV bus feeds the send at a reduced
level, because it is one box against a wall rather than a sound filling the room, and
because doubling the baked-in half reads as a cathedral.

Nothing new is authored. `flags.floor` was already seeded for all 591 interiors for
footsteps, and outdoors is whatever `zoneTerrain` already answers; two regexes cover
the shapes a floor cannot tell you (a church, a sewer). Seven spaces, not one per
room — no player can hear the difference between two rooms that disagree by 200ms of
tail, and it is the same argument that keeps 85 food items on ten material classes.

**The wall.** `propagateAudio` walks the exits, so it always knew which doorway a
sound came through and how many walls were in the way; it threw both away, and every
distant sound arrived dead centre at full bandwidth, which is the one thing a wall
never does. It now carries `from` and `hops`, and the client pans and lowpasses.

⚠ Both are omitted entirely at the origin, so a cue in your own room is byte-for-byte
the message that shipped before any of this. And **pan/muffle are send options, not
layer keys** — they are a property of the listener's position, not of the sound, and
the same cue is muffled for one player and not for another.

North and south pan **dead centre**, deliberately: this is a headphone pan, it carries
left/right and cannot carry front/back, so a sound from ahead and one from behind are
honestly the same thing here.

**Distance, doors and the room it came from.** The message also carries `shut`, how
many of the `hops` crossed a closed, intact door (the same `doorOnLink` test the walk
already makes, so no new reads), and `room`, the source room's space as `spaceFor`
names it. The audio plugin hands `spaceFor` to the engine with `setRoomSpaceResolver`;
the walk calls it once, for the origin. Both are left out when they'd be 0 or unknown.

The client takes `distance` (the hops), `shut` and `room` as send options to `playSfx`:

- **Walls.** A lowpass of 0.4 octave per open way through and 1.6 per closed door,
  floored at 400 Hz. An open doorway keeps most of its top end; a door doesn't.
  An explicit `muffle` (octaves) still overrides this.
- **Air.** A high shelf at 2.5 kHz, 3 dB down per room, at most 15. Separate from
  the walls, so far through open rooms is duller without sounding behind anything.
- **Wet against dry.** The direct path falls to `1/(1 + 0.45·rooms)` and a reverb send
  of the difference is added, so the reverb doesn't fall with it. The level drop itself
  is still the server's third per room; this is the part gain can't say.
- **The source room.** The send goes to a convolver holding the source room's impulse,
  shared by every cue from that room and fed into the bus, so the listener's room
  still hears it arrive. The pan and wall filters sit before the send, which is why
  one convolver can serve every cue. At most three are kept, least recently used out
  first. When the source room's space is the listener's own, or unknown, the send
  goes into the listener's reverb through the bus's wet copy and no convolver is
  made. It never calls `setRoom`: the listener's room stays the listener's. The `ui`
  bus never gets a send.

The constants are `DIST` in `audio-engine.js`. A distant cue costs four nodes over a
near one (air, dry, send, lowpass) plus the panner, and distance 0 builds nothing
extra. [scripts/audio/distance-smoke.mjs](../scripts/audio/distance-smoke.mjs) checks
that further is quieter, darker and wetter, that a door is darker than an open way,
that a source-room send uses that room's impulse and not the listener's, and the cap.

**Drive.** Soft-clipping distortion per layer. Nothing in a game built out of failing
hardware could sound *broken* before. It sits after the envelope and before the
filter, which is what makes it behave like an amplifier rather than an effect: the
ADSR drives the clipper, so a hard attack is dirtier than the tail by itself. The
curve is normalised through tanh's own output, because a distortion control that is
also a volume control is one nobody can use.

⚠ The filter branch used to connect from `gain` **by name**. Left that way it routes
straight past the shaper and a driven layer sounds exactly like an undriven one; the
smoke asserts the filter is fed *by* the shaper.

## The voice, driven

The formant synth got two things out of the same work, both per-narrator and both seeded
from the name like every other voice parameter.

**Drive** is transmission grit, and it sits **after** the compressor — the order a real
transmitter has, where level is controlled first and then the stage that cannot pass more
than it can pass clips what is left. Driving before the compressor would let the
compressor pull the distortion back down and mostly undo it. It reuses the same normalised
tanh curve `buildLayer` uses, so a driven voice and a driven cue distort identically
rather than being two people's idea of overdrive, and the level is trimmed back so a
gritty narrator is not also a louder one.

**Growl** is audio-rate FM on the glottal source at half F0 — period doubling, which is the
actual mechanism behind creak and vocal fry. It costs one oscillator, because the
modulation path into `glot.frequency` already existed for jitter; this is that same wire at
a thousand times the rate. Deliberately *not* the same axis as jitter: jitter is aperiodic
roughness a few Hz wide, this is a second pitch an octave down inside the source. Scaled by
F0, so a low voice and a high one growl by the same musical interval.

Both are minority traits (about a third, and about a seventh), for the same reason two
thirds of the cast get no breath: a trait everybody has marks nobody out.

### The synth was doubling consonants

English has no geminate inside a word, and the voice produced one wherever two phoneme
sequences were **joined** — a compound's two halves, or a stem and its suffix.

| said | was | is |
|---|---|---|
| `tableland` **287×** | "table-**l**-and" | `T EY B AX L AE N D` |
| `rubbly` **157×** | "rub-**b**-ly" | `R AH B L AY` |

Those two are terrain words in hundreds of room descriptions, so Read Aloud said them
wrong in most of the map. **126 words** in the game's own vocabulary carried the fault —
`flattest`, `funnelled`, `stencilled`, `panelling`, `whippet`, `hand-drawn`, and every
invented name with a written double letter (`marrick`, `sarraf`). The `merrin` entry in
`DICT` is the same bug, found by ear and patched one word at a time.

⚠ **The fix belongs at pronounceWord's EXIT, not in the letter rules.** A first attempt
put it in `g2p` and changed nothing whatsoever, which is the useful part: none of these
words reach the letter rules. `tableland` is the dictionary's `table` plus its `land`;
`funnelled` is `funnel` plus a suffix rule. A word can arrive by a dictionary hit, a
compound, a suffix rule or a guess, and **only the exit is common to all four**.

⚠ **Consonants only.** An adjacent identical vowel pair has a different cause (the -ia/-ya
spellings) and collapsing it here would hide that family rather than fix it. Note that only
*some* vowel runs even reach this filter — `fascia`, `cassius`, `aurelia` are produced
downstream of `pronounceWord` and are unaffected either way, so a guard written on one of
those passes regardless of what the filter does. The smoke uses `priya`, which does reach it.

#### Finding the rest

`npm run voice:suspects` ranks the words the synth is most likely saying wrong. It cannot
tell whether a pronunciation is *right* — that needs an ear — so it looks for output that is
wrong on its face, using the signatures the `DICT` comments already describe: doubled
consonants, a reduced vowel butted against another vowel ("pure noise", per the `kiyo`
entry), a polysyllable with no stress, and syllable counts far off the spelling.

Ranked by how often the word is actually spoken, because that is what made `auggie` — 236
occurrences — matter and a name in one room's description not. It went 126 → 73 with the
degemination fix. The remainder is a shortlist for the voice lab; a confirmed bad one gets
a line in `DICT`.

### The dictionary did not contain the game

32% of the words in the game's own names and descriptions — **663 of 2,041**, including
essentially every character and place name — were absent from the shipped CMUdict subset
and fell through to the letter-to-sound guesser.

The cause is in the generator's own header, and it was not a mistake at the time: the
subset was curated as common English minus junk, "upstream is ~134k entries, **most of
them proper nouns** the narrator will never say". True for a generic narrator, false for
one who says *Delacroix* and *Coldwater* all day.

Sweeping the whole content tree against upstream splits the gap cleanly:

| | |
|---|---|
| **1,634** | real words upstream carries — simply curated out |
| 1,722 | true coinages (*marrick*, *kesh*, *slagworks*) that no dictionary can help |

The 1,634 are now added by `gameWords()` in the build script, alongside the existing
`EXTRA` contractions list and for the same stated reason. **Names *and* descriptions**,
because Read Aloud speaks the whole log — the words most likely to be mispronounced are in
room prose, to the player who most depends on the voice working.

The guesser was decent and still plainly wrong on a good share of them: `waders` came out
"wadders", `odell` as "oddle", `canteen` stressed on the first syllable, `vestibule`
without its /j/. Five are pinned in the smoke, and all five fail against the old file.

⚠ **The curation is never re-derived, only added to**, and the regeneration is verified as
additive: 0 words removed and **0 existing pronunciations changed**. Cost is 410 → 436 KB,
which is **+13 KB on the wire** after gzip, against a file every client loads once.

### Glottal FM, and being able to hear it

⚠ **The FM work went into `buildLayer`, and the voice does not use it.** The formant synth
builds its own oscillator graph; the only thing genuinely shared is `driveCurve`. What
transferred was the technique, not the code, and it transferred once: `growl` was a single
hardcoded modulator at F0/2.

`growlRatio`, `growlWave` and a second parallel modulator turn that into a family:

| ratio | what it is |
|---|---|
| 0.5 | sub-harmonic — creak, fry (the original, still the default) |
| 1 | harmonic — brightens rather than roughens |
| 1.414, 2.41 | **inharmonic** — machine, wrong, not-a-person |

**This is not the ring modulator already present**, and the difference is where it sits.
`ring` is amplitude modulation on the **output**, after the formant bank — it modulates a
finished voice and reads as a voice with a box on it. Glottal FM is on the **source**,
before the tract, so the formants still shape it correctly: it reads as a throat producing
something a throat should not.

⚠ **The second modulator is PARALLEL where `buildLayer`'s `op2` is series**, and that is
the goal rather than an inconsistency. Series compounds into one richer spectrum; parallel
puts two competing periodicities into the source, which is what diplophonia — two pitches
from one throat — actually is.

#### You could not hear any of this

Character is hashed from a **name**, so before the override existed the only way to hear
what `drive` or `growl` sounded like was to type seeds until one rolled them. That is
fishing, not tuning — and two character parameters had already shipped that way.

`speak(text, { voice: {…} })` overrides individual parameters on top of the seed. Nothing
in the game passes it; it exists for the dev panel's **voice lab**, which now carries a
per-voice panel beside the global tuning knobs and prints only what differs from the seed,
in the shape a `NAMED_VOICES` entry takes. Ranges there are deliberately wider than the
roll, because the point is to hear the edges.

### RP grew a linking-r and a GOAT

Non-rhotic RP drops the /r/ of "far" — but not in "far away", where the next word begins
with a vowel and the /r/ comes back to bridge them. That was a named deferral in the code
and is now built, along with the RP GOAT diphthong (central onset, /əʊ/ against GA's
back-rounded /oʊ/) via the same phoneme-substitution route `ER` → `ERR` already used.

⚠ **Linking-r looks past a WORD GAP, never past a pause** — which is why it cannot use
`isGap`, that being every pause there is. "far. Away" and "far, away" have no link across
them; the juncture kills the bridge, not the silence.

⚠ **That distinction is only observable on UNSPACED punctuation**, and a first set of tests
missed it entirely. Spaced punctuation emits its pause *and* a word gap — "far. Away" is
`AA R __ _ AX` — so a buggy `isGap` check lands on the second gap rather than a vowel and
refuses the link by luck. Unspaced punctuation emits the pause alone: "far—away" is
`AA R _D AX`, vowel directly after, and a rule that skipped any pause would link straight
across a dash. The mutation passes clean without those two cases.

⚠ **This gives linking-r and cannot give intrusive-r** ("lawr and order"), because it only
ever KEEPS an /r/ the dictionary supplied. That is the right side to err on — intrusive-r
is variable and stigmatised in exactly the register this voice reads in — and it is
asserted, so that an "improvement" that inserts rather than preserves fails.

**LOT/CLOTH is blocked, not skipped.** RP wants /ɒ/ in "lot" where GA has /ɑː/, but CMU
gives `AA` for *lot*, *father* and *palm* alike, so LOT cannot be told from PALM without a
lexical word list — which would have to be invented rather than derived. CLOTH words are
already `AO` in both accents. Accent support is therefore three rules deep: rhoticity
(with linking), flapping, BATH, plus GOAT.

### Creak was erasing the terminal contour

A line ending in an ellipsis is supposed to sag rather than land, and the terminal target
carried a `trail ? 0.88 : 0.94` factor to say so. It was scheduled at `end − 0.18` — and
then **creak overwrote `glot.frequency` 110 ms later at a flat `F0 × cf`**, lower than
either branch. So the distinction was computed, was briefly audible, and was wiped on
every statement. Nothing failed; a trailing line simply ended exactly like a full stop.

Creak now carries the factor through. Not by rebasing creak on the terminal target, which
would be more physically honest — fry falls from wherever the pitch *is*, not from F0 —
but would drop a full stop from `F0 × 0.70` to about `F0 × 0.57`, past the floor that
keeps it from becoming a growl. Retuning that needs an ear. **A full stop is left exactly
where it was (98.3 Hz on the probe voice, unchanged); only the case that was being erased
moves** (to 92.4).

The distinction is only testable *because* of the fix, which is the tell that it was dead:
the smoke asserts a trailing line ends below a landing one, and reverting the fix goes red.

### The burst had a frequency but no shape

Every stop was released through one fixed band — Q 2, 20ms, one level — with only the
centre frequency moving. Shape is most of what the classical place features actually
describe, so three columns were added to the phoneme table:

| | | |
|---|---|---|
| `bq` | burst Q | low = **diffuse** (energy spread), high = **compact** (one sharp mid peak) |
| `bd` | burst duration, ms | a velar release is genuinely the longest; an alveolar is a tap |
| `bg` | burst level | a labial burst is weak — no cavity in front of the lips to resonate it |

Velars are the compact ones and that is their most identifiable property; labials are the
diffuse, weak, short ones. The defaults reproduce the old fixed values exactly, so the flap
(which declares no shape) releases precisely as it did before.

⚠ Testing this means finding the **noise** bandpass, not just "the first filter with a
scheduled Q" — the voiced formant path schedules Q as well, and a first cut read 7.89 off a
vowel for all three places and cheerfully reported no difference where there was one. Follow
the noise buffer source to its filter.

⚠ **Everything new goes at the BOTTOM of `voiceFromName`.** Every parameter draws from one
seeded sequence, so a field inserted above an existing one shifts every draw after it and
silently recasts every narrator in the game — no error, no failing test, and no way to
notice except recognising that somebody sounds wrong. The file has carried a comment saying
so for a long time and nothing enforced it. The smoke now pins an **unnamed** voice at the
**end** of the sequence, and both halves of that matter: a first cut pinned `architect`,
which is in `NAMED_VOICES` and has most of its draws overwritten, so a mutation inserting a
draw mid-table sailed straight through it.

⚠ **A source built by hand is a source nobody can stop.** Growl is created where `glot` is
in scope but started with everything else, from the `src` array — that array is what starts
the voice on one clock and what `cancel()` stops. Starting it inline would leave a tone
running past a cancelled line with no reference left to reach it.

### Selling a line (`excite`)

`speak(text, { excite })` says how hard a line is being sold, from -1 (grave: a death on the
ice, the injury list) through 0 (the narrator's own voice) to 1 (a goal call). It's the
hockey booth's: the narrator tags every line with a value off the pool it came from
(`EXCITE` in [hockey-narrator.js](../plugins/broadcast/sports/hockey-narrator.js)), the line
carries it as `excite` through the broadcast message, and tv.js hands it to `speak()`.
Nothing else sends one, and at 0 every factor below is exactly 1, so every other voice in the
game is untouched. The reading voice (`channel: 'ui'`) ignores it.

`deliveryFor` turns the number into the measured correlates of arousal in sports commentary:

| | excited (1) | grave (-1) |
|---|---|---|
| register | up 9 semitones | down 3 |
| pitch range (lilt) | doubled | 0.6 |
| declination | 0.45, so the voice holds its height | 1.25 |
| rate | 1.1 | 0.88 |
| phrase pauses | 0.65 | 1.3 |
| effort | pressed source (OQ -0.16), tilt cutoffs 1.45, presence +2dB, F1 +6%, stressed vowels +25% | breathy (OQ +0.06), darker, softer |
| creak at the end | none | 1.6 |

Three things go beyond scaling. A line sold at 0.35 or more gets a **nucleus**: the last
emphatic vowel of each phrase (a word in caps) or, failing that, the last stressed one, is
marked with a third phoneme marker `^` and held up to 2.2 times as long, climbing through the
vowel to its peak instead of stepping to it ("he SCOOORES"). The marker sits in the phoneme
run, so `estimateDuration` and the scheduler count the same held vowel. At 0.6 or more there's
a **breath in** before the first word. And a line peaks on its **exclamation**: "He shoots.
He SCORES!" builds through the first phrase and goes two semitones higher on the second.

Measured on the KSAB-TV voice (base 84Hz), "He shoots. He SCORES!" goes from about 95Hz
with the caps word at 100 to about 140 on "shoots" and 233 at the held peak at 1, and sits
around 79Hz at -0.7, 14% slower. `TUNING.excitement` scales every line's value, so the Voice
Lab can turn the whole booth up or down by ear; its excite slider and the goal, shot and
death presets audition one line. The FM smoke pins the shape: 0 is identical to no value, a
goal call peaks over 1.6 times the plain line and runs longer, a grave one sits lower and
slower, and the reading voice never moves.

### Measured against a recogniser

Until October 2026 the only judge of the voice was a person listening. Its consonants are now
tuned against two offline speech recognisers run on rendered audio: Whisper base.en, which has
a strong language model (roughly "would a listener who knows English follow it"), and a NeMo
Conformer-CTC with none ("are the sounds right"). The material is the Harvard sentences, a
rhyme-test word list said as "Please say ___ now." and 65 real booth lines. Whisper's word
error rate on the Harvard sentences:

| voice | before | after |
|---|---|---|
| KSAB-TV, the station voice | 79% | 24% |
| the Architect | 88% | 36% |
| Tug Brennan, a gritty seeded voice | 72% | 28% |
| eSpeak NG, for scale | | 25% |

On booth lines it went from 70% to about 28%. On single words with no context, scored by the
recogniser with no language model, it went from 6% to 21%, where eSpeak gets 10%. The scripts
and models live outside the repo; the findings are below, and the voice gates pin what can be
pinned. What was wrong, most costly first:

- **The bank's level was pinned.** The cascade-derived formant gains were normalised to F1 = 1
  for every sound, which kept each vowel's balance and threw away its level. The glottal source
  is strongest low down, so anything with a low F1 came out loud: /m/ measured louder than the
  /a/ after it, and the voice bar of a /b/ nearly a vowel. The gains are now measured against one
  reference, the neutral vowel through the voice's own tract, as a tube's are.
- **Noise could not reach the tract.** Voicing gated the formant bank's output, so aspiration and
  /h/ were a fixed band beside the formants. Voicing now sits at the source, and a second noise
  path (`aspG`) feeds the tract: /h/, the puff after /p t k/ and breath all carry the vowel that
  follows. The frication path for fricatives and bursts is unchanged in shape.
- **A shut mouth sounded open.** The voice bar of /b d g/ and the voicing under /v z/ went through
  the full bank and read as a nasal or a /w/ ("bee" as "me"). `murmur()` drops F1 to about 220 Hz
  and the bands above it nearly to nothing, while F2 and F3 still head for the locus.
- **The consonants sat at the wrong levels for one another.** /s/ and /ʃ/ were under /f/ and /θ/,
  the reverse of speech. They are fitted to real-speech levels against the vowel after them: /s/
  about -8 dB, /ʃ/ -5, /f/ and /θ/ about -20, /h/ and aspiration -15, bursts -6 to -12 and shaped
  by place (/t/ high, /k/ compact just above the next vowel's F2, /p/ low and diffuse). The voice
  bar is held near -16 dB, louder than careful speech has it, because clear speech voices through
  a closure and it measured better that way.
- **Glides let go too fast.** A vowel after /w r j/ now glides out over 40 to 45 ms and one after
  /l/ snaps in 12, and /l/ gets a mild lateral zero near 2.3 kHz.
- **/r/ after a vowel was a consonant** and was heard as /l/ ("four" as "full"). It is now an
  r-colouring (`RHOTIC`), held longer, with the vowel's F3 starting down in its back half.
- **Diphthongs closed off.** Their glides went all the way to /i/ or /u/, so "no" came back "num".
  They stop where real ones end, and /oʊ/ starts at /o/ rather than /ɔ/.
- Smaller: "he" keeps /i/ ("his scores"), "on" isn't reduced, a final dark /l/ is a little longer,
  a vowel-less abbreviation is spelled ("CPhL" was "K F L"), "St" before a name is Saint with or
  without its full stop, and a game clock before "left", "to go" or "remaining" is a length
  ("10:00 left" was "ten o'clock left").

Tried and dropped: a slower rate (worse), narrower formant bandwidths, a brighter unstressed
tilt and a more pressed source (no change), and swallowing word-final releases (worse; clear
speech releases them). Ring modulation and drive both cost words. The hockey booth turns them
off with `@voice`; every other voice keeps its own.

A voice with `vs` among its parameters (the hockey booth's `@voice` sets `vs=1`) reads an en
dash between two names as "versus": "Wharf Rats–Warlords" is "Wharf Rats versus Warlords"
(`readMatchups`). For every other voice the dash stays a pause, since in a book "the
London–Paris express" is a route, and a hyphen or a dash between figures never changes.

`speak(text, { trace: [] })` fills the array with each phoneme's scheduled start, which is how
the measurements found the segments, and `TUNING.compRatio` is the compressor's ratio.

### Drawn-out words

"He SCOOOOORES!!!" is how a goal call is written, so it is how the voice holds one. Three or more
of one letter is a held sound. `elongation()` collapses each run to the word the dictionary knows,
one letter or two ("SCOOOORES" is scores, "SHOOOOTS" shoots, and a run at the end of a word is the
short word, so "Sooooo" is so). `markLong()` puts a `~n` marker before the sound the run spelled:
the vowel of the run's vowel group, the stressed vowel when spelling and sounds don't line up, or
a consonant's own sound in "Yesss". `segmentDuration` holds it 0.14 s plus 0.16 s a letter after
the first (a consonant 0.10 plus 0.11), up to 2.6 s and a quarter longer when sold, so the
estimate and the scheduler agree.

Sold, a held vowel climbs over its first fifth to a peak a few semitones above its accent, wavers
with a 6 Hz vibrato (the second jitter oscillator's depth turned up), swells and brightens, then
eases into the rest of the word; a diphthong turns at the very end. Not sold ("Noooo..."), it
sags. "!!" or more is one bigger break, `_XX`, which lifts its phrase. A phrase with a drawn-out
word gets no `^` nucleus, because the writer has already chosen the sound.

On the booth, "He SCOOOOOOORES!!!" holds its vowel 1.38 s and tops out near 280 Hz, and Whisper
hears "He scores!". The pacer gives each held letter after the first 60 ms of air on top of its
95 (see [systems-broadcast.md](systems-broadcast.md)). The voice smoke pins the reading and the
length, and the FM smoke the climb, the vibrato and the sag.

## The mix: limiter, ducks, noise, filters, sends and rooms

What the engine gained so that about fifty layered cues can sit under an announcer. All of it is
in `client/shared/audio-engine.js`, and each part has a gate in the `audio` group (named below).
Every new layer and cue key is opt-in: a cue that doesn't use one builds the graph it always did,
apart from the noise offsets.

**The limiter** (`limiter-smoke`). A DynamicsCompressor after the master gain, set as a
brickwall: threshold -1 dB, hard knee, ratio 20, 1 ms attack. The spec's compressor adds its
own makeup gain, about 0.6 dB here, and a trim after it takes that back off, so below the
threshold nothing changes level. The mono downmix and the echo send both sit behind it.

**Ducks** (`duck-smoke`). Each bus is a slider gain (the player's volume) then a duck gain, and
`_applyGains` only ever writes the sliders. `duck(buses, dB, { attack, hold, release, at })`
pulls buses down and brings them back; without `hold` it stays down until the handle's
`release()`. A cue's `config.duck` and `speak({ duck })` use it for their own length. Ducks overlap and a bus sits at the deepest one. The schedule is written as
AudioParam events from the list of holds, not run off timers. The reverb send taps the duck,
not the slider, so a ducked bus ducks its reverb too. `duckLoop` still exists for the rain and
wind beds under thunder; it rides one loop, not a bus.

**The TV's voice and effects** (`tvmix-smoke`). Two sub-gains under the tv bus.
`setTvBalance({ voiceDb, fxDb })` keeps a broadcast's effects a fixed distance under its voice
inside the one TV slider. TV speech rides the voice sub-gain; category `tv_fx` rides the
effects one; category `tv` still goes straight to the bus. Both start at unity.

**Noise** (`noise-smoke`). A noise layer used to play one two-second mono buffer from its first
sample, so two noise layers in a cue were the same noise and phased, and a long bed repeated
every two seconds. Layers now get eight seconds of stereo noise in `white`, `pink` or `brown`
(the layer's `noise` key), each made once and normalised to white's level, with the loop point
crossfaded. Every noise layer starts at its own offset from a seeded generator, which is what
ends the phasing; `noiseSeed` pins one. A layer takes the left channel alone, which is mono
noise at the old level; `width` blends the right ear over to the other channel with an
equal-power law. `engineNodes()` keeps the old buffer for the custom synths built on it.

**Filter gain** (`filter-smoke`). `filter.gain` in dB is read for `peaking`, `lowshelf` and
`highshelf`. It never was, so a peaking filter was a flat line. The other types never have
their gain written.

**Space** (`space-smoke`). A layer's `pan` puts a panner at the end of that layer, after its
echo. A cue's `send` (0–1) overrides its bus's reverb send: the cue enters a dry copy of the
bus and, through a gain of `send`, a wet copy that feeds only the reverb. The copies are made
on first use and follow the bus's slider and duck. `setRoom(name)` picks a room by name over
the one the zone picked (the server's `audio_space`), until `setRoom(null)` hands it back. The
`ballpark` room is open air: a short 0.18 s tail and a slap-back off the stands 120 ms in, 7 ms
later in the right ear. Room impulses are seeded from the room's name, so a room is the same
every load.

The speech side of this (two channels, and Read Aloud ducking the TV) is in
[systems-accessibility.md](systems-accessibility.md#speech-channels-what-a-typed-command-stops).

## Position and doppler in a seat

A GLASS seat (the cockpit, the cab, the boats, the podracer) draws its world in 3D, and its
sound was stereo at best: an aircraft crossing the nose or a rig overtaking on the left made no
sound. The MUD rooms don't use any of this; they keep `pan`, `muffle` and `distance` from the
server's propagation.

**The API.** `position` is a send option on `playSfx`, `playSample` and `loopSound` (its second
argument), like `pan`: it's where the sound is for this listener, so a cue never carries it.
With it come `velocity` (units a second; left out, it's worked out from successive moves),
`ref` (the distance at full level, default 1), `rolloff` (inverse-distance, default 1; 0 leaves
the level to the caller) and `doppler` (0 to 1, or false). A cue can turn doppler off with its
own `config.doppler: false`. A positioned `playSfx` returns `{ move(pos, vel), state() }`;
`moveLoop(id, pos, vel)` moves a loop and `loopState(id)` reads one. `setListenerPose({ pos, fwd,
up, right, vel, metresPerUnit })` is the seat's camera, once a frame; null resets it. `right`
defaults to fwd × up, which is right for a right-handed frame. The map's y runs south, so a seat
passes `right` itself.

**The panner** is a PannerNode at the listener-relative position, with the context's own
listener left at the origin facing -z: the rotation is done in the engine, not through
AudioListener, so there's one path on every browser (Safari's listener has no AudioParams) and a
gate can read the position. Positions move with a 30 ms `setTargetAtTime`, so a frame-rate step
doesn't zipper. It takes the place of `pan` in the cue's chain, after the cue's gain and before
any muffle or distance stage.

**Doppler.** Web Audio dropped PannerNode's, so the engine works it out: the source's and the
listener's speeds along the line between them give `(c + vListener) / (c + vSource)`, with `c`
343 m/s in the seat's units, clamped to 0.5–2. It goes out as cents from one ConstantSource per
voice into every detune the cue built: the carrier, both FM operators (so a ratio stays a
ratio), the noise source and the filter, and a sample's source. It's smoothed over 60 ms. A
cue's build collects those params through `_dopSink`, which is null for every unpositioned cue.

**The budget.** HRTF costs a convolution per voice, so only six positioned voices get it (two
on a coarse-pointer device) and the rest are equal-power. A positioned voice adds two nodes (the
panner and the doppler source) and still takes a slot in the 32-voice pool. The player's
choice is `spatialAudio` (the tablet's Sound page, **3D Sound**): `auto`, `hrtf` (no phone
cap), `equalpower`, or `stereo`, which is a stereo pan and an inverse-distance gain from the same
position, with no doppler. Mono audio turns HRTF off.

**The seats** ([seat-audio.js](../client/game/js/panels/seat-audio.js)). `paintWindshieldFrame`
calls `seatAudioFrame(id, view)` once a paint, so every seat that paints contacts is covered by
one call. The frame's origin is the player's own vehicle (`acX`/`acY`), in tiles (about 17.9 m),
x east, y south, z up. A contact's `dx`/`dy` are already in it, so the listener's velocity is
zero and a contact's is the closing speed. The nearest three contacts within 30 tiles get an
engine loop on the ambient bus at priority 1, voiced by class (prop, ultralight, helicopter,
jet, truck, boat), and the pose and positions are sent at most every 33 ms. A mirror (`bare`)
never drives the listener, and a second view id can't take over until the first has been quiet
for half a second. When the seat stops painting for 0.7 s (closed, or a hidden tab that froze
rAF), the watchdog stops every voice and resets the pose.

`seatSpot(x, y)` turns an absolute tile into a `position` in that frame, or null when no seat is
painting, so a caller falls back to the old stereo cue. Placed that way: a near lightning
strike's clap and the storm thunder (from the nearest storm cell's edge, `stormNearest` in
engine-audio.js), an AA battery's report, and a fireworks burst. Those callers already set the
level from the distance, so they pass `rolloff: 0` and `doppler: false`.

**Gate** (`spatial-smoke`): no position builds no panner and no doppler source; a source
passing in front goes left to right and from sharp to flat through 1 at the closest point;
doppler reaches every detune; turning the listener east, west and south moves the panner
correctly; a left-handed frame with `right` given keeps east on the right; a listener closing
on a still source hears it sharp; HRTF stops at the cap; `equalpower` and `stereo` build what
they say; `doppler: false` on the send or the cue builds no doppler source.

## Cue loudness

The limiter stops peaks, but nothing compared one preset with the next: each was set by ear on
its own. [`scripts/audio/loudness-smoke.mjs`](../scripts/audio/loudness-smoke.mjs), in the
`audio` gate group, renders every row under `content/audio_sfx` and `content/audio_ambient`
through the real engine on the offline renderer at 48 kHz and measures it. It takes about 3 s
of CPU.

**The measure** is ITU-R BS.1770 K-weighted loudness, mono, channel weight 1:

- A one-shot is its maximum momentary loudness: the loudest 400 ms window, 100 ms apart.
  Integrated loudness means nothing on a 30 ms click. A cue shorter than 400 ms is padded with
  silence, so a short tick reads quieter than a long tone at the same amplitude, which is how
  it sounds.
- A loop is its integrated loudness (gated at -70 LUFS and -10 LU) over 3 s of sustain after
  its attack and decay. Sparkles aren't rendered. A loop with an LFO slower than about 0.3 Hz
  (the emergency siren's 0.1 Hz sweep) is measured over part of a cycle.
- Peak is the sample peak in dBFS, not true peak.

Everything is the cue alone at gain 1: no bus, limiter, reverb or distance gain.

**Targets** are in `TARGETS` at the top of the script, keyed `kind:category` (`sfx:ui`,
`loop:environment`) with a fallback per kind. They started as each group's median on
2026-10-18. A cue more than 4 LU from its target, or peaking over 0 dBFS, is an outlier. On
that date 23 of 38 cues were, and none has been rebalanced: that's a separate decision.

**The baseline**, [`scripts/audio/loudness-baseline.json`](../scripts/audio/loudness-baseline.json),
holds every cue's loudness and peak. The gate fails on a new outlier, or on any cue whose
loudness moved more than 1 LU from its recorded value, including a cue that got better. It
writes nothing.

```bash
node scripts/audio/loudness-smoke.mjs --report   # every cue, outliers marked
node scripts/audio/loudness-smoke.mjs --update   # rewrite the baseline
```

After changing a cue's level, or a target, on purpose, run `--update` and say why in the commit.
An engine change that moves many cues at once fails the gate too; that's meant, since it changed
the mix.

## The voice pool

⚠ **The pool and the tracker's channel count were the same number, and that is a bug,
not a budget.** A tracker step allocates a voice per channel, so a 16-channel song
could hold every slot in a 16-slot pool — and since songs and SFX both default to
priority 5, and stealing is allowed at equal priority, a dense song and a fight spent
the whole time evicting each other. Nothing reported it, because a stolen voice is not
an error: it is a sound that did not happen.

The pool is 32. That is not an aesthetic choice — 16 was, borrowed from a console whose
voices were hardware, and this is a pool of Web Audio node graphs whose real constraint
is CPU. `_voiceStats()` now counts played/stolen/dropped/peak, because "is the pool big
enough?" was not a question anybody could answer from outside a system whose failure
mode is silence.

## Combat

Combat was the largest silent surface in the game. `combat_hit` fired **on crits only** and
`combat_death` on kills, so the thing a player spends most of their time doing made no sound at all
between one lucky roll and a corpse.

Almost all of it is reuse. A blade in a body **is** `chop` on wet meat — the generator was written for
a kitchen and the physics didn't change on the way out. A club is `impact` on the soft surface; an
energy weapon on flesh is `sizzle`, which is grim and also right.

**Two axes, both already authored.** `weapon_skill` and `damage_type` are on every weapon and enemy in
`tagCatalog.js`, so nothing new is written down anywhere and a weapon added tomorrow is audible the
day it's tagged.

Both are needed. `damage_type` can't tell a pistol from a baseball bat — they're both `kinetic` — so
the **outgoing** side keys on the weapon's skill class, which is exactly the acoustic distinction. The
**incoming** side has no weapon to read (an enemy's attack is a damage roll, not an item), so it keys
on the type.

| | outgoing (`weapon_skill`) | incoming (`damage_type`) |
|---|---|---|
| edge | `blades` → chop / wet meat | `edged` → chop / wet meat |
| blunt | `clubs`, `fists` → impact / none | `kinetic` → impact / none |
| gun | `firearms` → gunshot | — |
| burning | `science` → sizzle | `energy`, `fire`, `chemical` → sizzle |
| — | — | `radiation` → **silent, on purpose** |

`radiation` maps to `null` rather than being absent, and regress checks membership with `in` rather
than truthiness: silence there is a decision somebody recorded, and a *new* damage type must fail the
build rather than inherit it.

Two things genuinely had no generator and are new rather than faked. **`whiff`** is a miss — the most
common event in any fight, and what made the layer feel broken when it was silent; it is not a quiet
impact, because nothing was struck, so there's no body and no ring, only moving air falling in pitch.
**`gunshot`** is a shock front rather than a struck object: a crack with no attack, a body that falls
hard, and one delayed slap of street.

⚠ **A combat cue is not a kitchen cue.** `sizzle` at its own default is a pan of frying food — 1.5
seconds and two dozen randomised burst layers — and a fight lands a hit every couple of seconds. Every
combat row that routes through a continuous generator states its own duration, and regress caps both
the length and the layer count.

Two smaller decisions: a crit keeps its authored flourish **on top of** the material sound rather than
instead of it (the swing still landed on the same body), and the incoming side is filtered to
`enemy`/`npc`/`pvp` — `strike` is excluded because it's the shared `applyStrikeToPlayer` path that
demolition, psionics and mutation organs all route through, and each of those already makes its own
noise.

Deliberately **not** separate generators: `fry_crackle` is `sizzle` at high heat; `whisk` is `stir`
with high-frequency movement; metal/ceramic/wood resonance are `impact` with a surface. Reuse over
proliferation is the whole design.

### Styles

Pressure alone made every fart the same fart, just longer and lower. `flatus` therefore has a second
axis: **style** — brassy, squeak, drone, flutter, staccato, falter, silent, ripper — expressed as
multipliers over the same generator (pitch, duration, buzz rate, tremolo depth, noise, pulse count).
Adding one is a row in a table, not a new function, and multi-pulse styles reuse the same burst-field
technique `sizzle` uses.

The style is rolled from the **seed**, so the client reproduces whatever the server picked, and
eligibility is gated by pressure — a nearly-empty gut can only squeak, and a drone needs real
commitment.

The style NAME is a shared vocabulary, like a material token. The **caller** owns when each style can
occur and what the room reads; the **generator** owns what it sounds like. Neither imports the other,
so a new style needs a line in both — which is honest, because it genuinely needs a sound and
something for the room to read. A regress case asserts the two key sets match.

### Tables

**Materials** are acoustic, not culinary — `hardness`, `moisture`, `density`, `viscosity`, `fat`.
**Surfaces** ring: wood, metal, ceramic. **States** bend a material for an unusual condition
(`frozen`, `cooked`).

States are the *sparse* alternative to per-item authoring. Putting five acoustic numbers on all 85
food items would be 425 hand-tuned values expressing differences nobody can hear — a carrot and a
potato chop identically at any resolution a game client reproduces. An item can override its class
with `tags.sound_material` for genuine outliers (a bone, a husk, a shell), and `frozen` costs nothing
because the cooking system already computes it for thaw timing.

> The tag is `sound_material`, **not** `material` — that name is long since taken by the crafting
> flag, and a duplicate key in the tag catalog silently overwrites rather than erroring.

## Tuning

The knobs of a procedural system are its **tables**, not its cues: there is no single "chop" to edit,
there is a hardness number that makes every chop brighter.

So the tables are surfaced in the dev panel (**Sounds → Sound Effects → Procedural material/action
tables**) as four entries — `proc:materials`, `proc:surfaces`, `proc:streams`, `proc:flatus` — riding the existing
`interface_sfx` override plumbing. Same fetch, same editor, same persistence the poker cues use. No
new table and no new endpoint.

Overrides merge **per key**, so tuning one material doesn't require hand-maintaining the other nine,
and a material added in code later still appears for someone carrying an old override.

## Intensity

Every generator takes normalised 0..1 values, and intensity is expected to mean something real rather
than being a constant someone picked:

- **cooking** — burner tier drives `heat`; piece count drives chop intensity
- **bodily** — `digestive_load` / `hydration_load` over 110 drives stream and flatus pressure

That last one is the clearest example of the design paying off. The old hand-authored pee stream
sounded identical whether the character was bursting or barely needed to go, because the only inputs
were the surface and a phase. Now a full bladder is a hard, high, tight jet that splatters and takes
several spurts to finish; a nearly-empty one is a loose dribble that doesn't splash at all.

## The dense tier — footsteps, doors, locks

Everything above fires when a player *does* something. This tier is the world
running continuously underneath that, and it exists for the `log` rung: a room
description is abbreviated there, so the ground under your feet and the door
behind you arrive as sound rather than as lines you have to read.

It is gated by **Sound Detail** (`off` / `limited` / `full`) — one row in
`A11Y_OPTIONS`, defaulting to `full` only at the `log` rung. See
[systems-display-mode.md](systems-display-mode.md#sound-detail).

**The gate is a stamp on the NEW cues, never a category on all of them.** The
server sets `tier: 'full'` and the client drops those below the top rung; an
unmarked cue is untouched. That is what makes `limited` — what everybody who has
never chosen gets — a *provable* no-op against every cue that shipped before this,
and it is the property that made the tier safe to turn on for the whole game.

### A crossing is a walk, not a click

A room transition is not an instant. `stepCadenceMs(player)` — the game's one step
clock, in [plugins/pacing/index.js](../plugins/pacing/index.js), the same number
the pacing throttle uses and `plugins/pinch`'s walker paces off — says a crossing
takes 900ms walking, 700 running, 350 sprinting, road-scaled. One 130ms cue across
that span is a tap, not a footstep, and no amount of gain fixes it.

So `movement.step` sends **one message describing a cadence**, not one footfall:
`series: {count: 4, interval: cadence/2, key: 'step'}`. The client schedules it
([dispatch.js](../client/game/js/dispatch.js) — `playSeries`), alternating `foot`
per footfall and deriving a per-footfall seed from the base one, so the copy the
room hears is the same performance the walker hears.

One message, not four, for the reason the tier is affordable at all: a step is
~70 bytes, and quadrupling the message count on the per-move path to say something
the client can schedule itself gives that back for nothing.

⚠ **The tail is the arrival, and it falls out of cancellation rather than being a
special case.** Four footfalls at half-cadence span 1.5× a crossing, and a new step
*replaces* the pending remainder. So walking continuously is one unbroken cadence,
and the last two footfalls only ever play when you actually **stopped** — which is
precisely when a listener needs to know they have arrived. Two consequences: the
server no longer flips `foot` per move (the client advances it within the series,
so flipping too would land the same foot twice at every room boundary), and any new
repeating cue must carry a `key` or it will pile up on itself.

### The level, and why it is in the generator

The tier shipped **inaudible**, and the cause was two defensible decisions
multiplying. The generators write quiet layers because these sounds are the floor
of the mix; the transport then applies its own sub-1 gain (`OWN_STEP_GAIN`, the
door's `0.6`) for the same reason. Together they put footsteps 13–20 dB under a cue
like `chop` — under the noise floor of a rain bed.

The correction is `STEP_LEVEL` / `DOOR_LEVEL` / `LOCK_LEVEL` in
[procedural-sfx.js](../client/shared/procedural-sfx.js), which put the family at
**~6 dB under `chop`**. They live in the generator, not the transport, because the
transport numbers each say something true — your own feet against someone else's, a
refusal against an open — and raising them past 1 would destroy that reading to fix
a problem in the source material. **The three constants differ only to cancel three
different transport gains; they are not three opinions about loudness.** Retune by
moving the 6 dB target, never one family on its own.

### Nothing is authored twice

| The sound of | comes from | authored |
|---|---|---|
| outdoor ground | `flags.terrain` | already the ground-surface SSOT |
| indoor floor | `flags.floor` | **new** — 591 interiors, seeded then hand-corrected |
| a door leaf | `doors.door_type` | already on every door |
| a lock | the door's `lock:<family>` tag | already on every locked door |

Three of those four cost nothing. `flags.floor` is the exception and it has to
be: `resolveTerrain` returns `null` indoors **by design** — an interior has no
ground surface — so the indoor half of the question genuinely had no answer in the
world yet. [`scripts/content/seed-floors.mjs`](../scripts/content/seed-floors.mjs)
proposes one per room from the zone name and `building_type`; it writes only where
the key is absent, so it is re-runnable and can never overwrite a hand-made call.

Footing classes are **coarse on purpose**. Redrock, hardpan, alkali, basalt and a
plateau are one sound under a boot — the same argument that keeps 85 food items on
ten material classes. A regress case walks the terrain enum in `tagCatalog.js` and
fails if any value is unmapped, because a terrain added later is otherwise the
wrong ground under a whole region with nothing to notice it.

### Bearable for ten thousand repetitions

A footstep fires on nearly every input for as long as somebody plays, which makes
it the only cue in the game where listening *fatigue* is the design problem. Volume
is not the answer — **a quiet sound repeated identically is more irritating than a
loud one that varies.** Four things carry it:

- **Alternating feet.** `foot` is 0/1 from a per-player RAM counter; the trailing
  foot is fractionally lighter and lower. `vary()` alone cannot do this — random
  jitter is heard as *noise*, an alternating pair is heard as *walking*. Regress
  pins that the two feet differ at the same seed.
- **A cadence floor.** Auto-walk, run mode and a held key deliver moves faster than
  a person walks. Under `MIN_STEP_MS` the step is **dropped, never queued** — a
  queue turns a sprint into a machine-gun that runs on after you stop.
- **Under the mix.** Own steps at 0.55, other people's at 0.3. A footstep is the
  floor of the mix, not an event in it.
- **Steps get out of the way of speech.** Anything that carries information —
  a refused lock, combat, dialogue — sits above this tier deliberately.

### Blending with the weather

A step does not merely duck under rain, it **gets wet**. `wet` (0–1, from
`getZonePrecip`, and only outdoors) moves the step toward the rain's own spectrum:
the strike is deadened, the top end fills in, a splash layer appears. Then it ducks
as well. The two together are the difference between *"quieter"* and *"in the
rain"* — which is the whole point, since a cue that only drops in volume still cuts
through the bed with the wrong timbre.

⚠ **Only the DELTA does anything.** `wet` is applied as
`max(0, wet − surface.wetness)`, so rain changes nothing about standing water or a
marsh. The first version scaled by `wet` directly and went on softening a surface
that could not get any softer; regress pins it.

### `denied` is information, not decoration

`lock` has three cues and the third is the one that earns its place. At the `log`
rung a lock that opens and a lock that turns you away must not be the same sound,
or the player is reading the log to find out whether the door in front of them just
worked. It is the one cue in this tier deliberately mixed **above** the others.

## History

- Shipped rendering layers server-side, at 6 KB per sizzle to every player in the zone. Replaced with
  parameters + seed; the generator moved to `client/shared/` so one implementation serves both sides.
- The dev-panel tag `material` collided with the existing crafting-material flag. Because both were
  keys in the same object literal, the new one **silently overwrote** the old rather than erroring —
  caught only by `content:lint` failing on 21 unrelated items. Renamed `sound_material`.
- The pee stream was `sendToPlayer` only, so a character relieving themselves in a crowded room was
  silent to the room. Both it and `flatus` are zone-audible now.
