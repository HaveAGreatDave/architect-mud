# AMP Format — Architect Music Player Asset Specification

`.amp` files are plain JSON exports from the devpanel Audio tab. Each file contains either a single preset object or an array of preset objects. The format covers five asset types: **instruments**, **songs**, **sfx**, **ambient**, and **samples**.

---

## Instruments

An instrument is a reusable synth voice. Songs reference instruments by ID via `instrument_ids`; the step sequencer substitutes the instrument's config when rendering each note.

```json
{
  "name": "lead_square",
  "category": "cyberpunk",
  "waveform": "square",
  "enabled": 1,
  "config": {
    "adsr": { "a": 0.01, "d": 0.05, "s": 0.7, "r": 0.15 },
    "filter": { "type": "lowpass", "freq": 4000, "q": 1 },
    "vibrato": { "rate": 0, "depth": 0 },
    "tremolo": { "rate": 0, "depth": 0 },
    "noiseMix": 0,
    "gain": 1
  }
}
```

### Fields

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | required | Human label shown in AMP and devpanel |
| `category` | string | `"misc"` | `ui` `combat` `cyberpunk` `environment` `tv` `misc` |
| `waveform` | string | `"square"` | `square` `sine` `triangle` `sawtooth` `noise` |
| `enabled` | int | `1` | `0` = skipped during export/playback |
| `config` | object | `{}` | Synth recipe — see **Config shape** below |

---

## Songs

A song is a tracker-style pattern that sequences instrument notes across one or more channels. The step sequencer plays 16th notes at `tempo` BPM; each step is either `null` (rest) or a note object.

```json
{
  "name": "neon_crawl",
  "category": "cyberpunk",
  "tempo": 140,
  "loop_start": 0,
  "loop_end": 63,
  "instrument_ids": ["inst_abc123", "inst_def456"],
  "priority": 5,
  "enabled": 1,
  "channels": [
    [
      { "note": "C4", "instrument": "inst_abc123", "vol": 0.8 },
      null,
      { "note": "G4", "instrument": "inst_abc123", "vol": 0.6 },
      null
    ],
    [
      null,
      { "note": "C2", "instrument": "inst_def456", "vol": 1.0 },
      null,
      null
    ]
  ]
}
```

### Fields

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | required | |
| `category` | string | `"misc"` | |
| `tempo` | int | `120` | BPM. Steps are 16th notes (4 steps per beat) |
| `loop_start` | int | `0` | Step index where the loop restarts after `loop_end` |
| `loop_end` | int | `0` | Last step index (inclusive). `0` = play to end of pattern |
| `instrument_ids` | string[] | `[]` | IDs of `audio_instruments` rows used by this pattern |
| `priority` | int | `5` | Voice-stealing priority (1–10, higher wins) |
| `enabled` | int | `1` | |
| `channels` | array of arrays | `[]` | See **Channel / Step shape** below |
| `channel_pan` | float[] | `[]` | Optional per-channel stereo pan (`-1` left … `1` right), parallel to `channels`. Empty = mono. Set by the `.MOD` importer (Amiga L-R-R-L) |

### Channel / Step shape

`channels` is an array of channels. Each channel is an array of steps with length equal to the total number of steps in the pattern (`(loop_end + 1)` or however many steps you authored). Every step is either `null` (silence) or:

```json
{ "note": "C4", "instrument": "inst_abc123", "vol": 0.8 }
```

| Field | Type | Notes |
|---|---|---|
| `note` | string | Standard notation: note name + octave — `C4` `F#3` `Bb5` `Eb2`. `"R"` or `""` = rest |
| `instrument` | string | ID of the instrument row to use for this step |
| `vol` | float | Per-step velocity scalar (0–1). Multiplied against the instrument's `gain` |
| `fx` | object | Optional tracker effect on a sample-backed step (see **Step effects** below) |

### Step effects (`fx`)

Sample-backed notes may carry one tracker effect, imported from `.MOD` files. These are perceptual approximations, not a sample-accurate ProTracker replay, and are ignored by synth (oscillator) instruments. A step whose `note` is `null` but which has an `fx` is a *continuation* cell — it modulates the note still ringing on that channel without retriggering.

| `fx.t` | Fields | Effect |
|---|---|---|
| `arp` | `x`, `y` (semitones) | Arpeggio — cycles base / +x / +y once per tick across the row |
| `porta` | `dir` (`1`/`-1`), `speed` | Pitch slide up/down, continues on note-less rows |
| `toneporta` | `speed` | Slides the ringing voice toward the step's note without retriggering |
| `vib` | `rate`, `depth` | Vibrato — detune LFO for the note's duration |
| `volslide` | `up`, `down` | Ramps the ringing voice's volume up/down, continues on note-less rows |

**Note range:** The engine supports octaves 2–6. Middle C is `C4`. Sharps use `#` (`C#4`), flats use `b` (`Bb4`).

---

## SFX

A one-shot sound effect. Self-contained — no instrument reference needed.

```json
{
  "name": "combat_hit",
  "category": "combat",
  "priority": 7,
  "enabled": 1,
  "config": {
    "waveform": "noise",
    "freq": 220,
    "duration": 0.15,
    "noiseMix": 0.7,
    "adsr": { "a": 0.001, "d": 0.08, "s": 0, "r": 0.06 },
    "filter": { "type": "highpass", "freq": 900, "q": 1 },
    "gain": 0.9
  }
}
```

### Fields

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | required | |
| `category` | string | `"misc"` | |
| `priority` | int | `5` | Voice-stealing priority |
| `enabled` | int | `1` | |
| `config` | object | `{}` | Synth recipe — see **Config shape** |

`config.duration` (seconds) determines how long the engine holds before releasing. Required for SFX; ignored for ambient loops.

---

## Ambient

A looping background sound, identical in shape to SFX except it loops continuously and has a `loop` flag.

```json
{
  "name": "reactor_hum",
  "category": "environment",
  "priority": 2,
  "loop": 1,
  "enabled": 1,
  "config": {
    "waveform": "sine",
    "freq": 60,
    "gain": 0.15,
    "noiseMix": 0.1,
    "filter": { "type": "lowpass", "freq": 400, "q": 0.7 },
    "adsr": { "a": 0.5, "d": 0.1, "s": 1, "r": 0.5 }
  }
}
```

### Extra field

| Field | Type | Default | Notes |
|---|---|---|---|
| `loop` | int | `1` | Always `1` for ambient — kept for DB consistency |

---

## Config shape (shared by instruments, SFX, ambient)

The `config` object is the synth recipe passed directly to the Web Audio layer builder.

```json
{
  "waveform": "square",
  "freq": 440,
  "duration": 0.4,
  "gain": 1.0,
  "noiseMix": 0.0,
  "detune": 0,
  "adsr": { "a": 0.01, "d": 0.05, "s": 0.7, "r": 0.15 },
  "filter": { "type": "lowpass", "freq": 4000, "q": 1 },
  "vibrato": { "rate": 0, "depth": 0 },
  "tremolo": { "rate": 0, "depth": 0 },
  "fm": { "rate": 60, "depth": 100 },
  "echo": { "mix": 0.3, "delay": 0.18, "feedback": 0.35 },
  "pitchBend": { "to": 880, "time": 0.25 }
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `waveform` | string | `"square"` | `square` `sine` `triangle` `sawtooth` `noise` |
| `freq` | float | `440` | Base frequency in Hz. Overridden per-step in songs |
| `duration` | float | `0.4` | Seconds. SFX only — how long before the release phase |
| `gain` | float | `1.0` | Output level scalar (0–1) |
| `noiseMix` | float | `0.0` | 0 = pure oscillator, 1 = pure noise, fractional = blend |
| `detune` | float | `0` | Cents offset applied to the oscillator (synth) or sample playback (sample-backed). Set by the `.MOD` importer to carry per-sample finetune |
| `adsr.a` | float | `0.01` | Attack time in seconds |
| `adsr.d` | float | `0.05` | Decay time in seconds |
| `adsr.s` | float | `0.7` | Sustain level (0–1, fraction of peak gain) |
| `adsr.r` | float | `0.15` | Release time in seconds |
| `filter.type` | string | `"lowpass"` | `lowpass` `highpass` `bandpass` `notch` |
| `filter.freq` | float | `4000` | Filter cutoff frequency in Hz |
| `filter.q` | float | `1` | Filter resonance / Q factor |
| `vibrato.rate` | float | `0` | LFO frequency in Hz (0 = off) |
| `vibrato.depth` | float | `0` | Pitch modulation depth in cents |
| `tremolo.rate` | float | `0` | Amplitude LFO frequency in Hz (0 = off) |
| `tremolo.depth` | float | `0` | Amplitude modulation depth (0–1) |
| `fm.ratio` | float | — | **FM modulation** — modulator frequency as a multiple of `freq`. The form to use for anything played at more than one pitch. Omit or `0` to disable |
| `fm.rate` | float | — | Modulator frequency in absolute Hz. Ignored when `fm.ratio` is set |
| `fm.index` | float | — | Modulation index (deviation ÷ modulator freq). Scale-free, so it holds across pitch |
| `fm.depth` | float | `100` | Frequency deviation in raw Hz. Ignored when `fm.index` is set |
| `fm.indexEnd` | float | — | Index travels here over `fm.time`. A collapsing index is what reads as struck |
| `fm.depthTo` | float | — | The same sweep in raw Hz. Ignored when `fm.indexEnd` is set |
| `fm.ratioTo` / `fm.rateTo` | float | — | Modulator pitch travels here (a multiple of `freq`, or absolute Hz) |
| `fm.time` | float | `0.2` | Seconds for the index and modulator pitch to reach their targets |
| `fm.wave` | string | `"sine"` | Modulator waveform: `sine` `square` `sawtooth` `triangle` |
| `fm.bright` | float | — | How far a note's velocity opens the index. `0`/absent = velocity moves the level only |
| `drive` | float | `0` | **Soft-clip distortion**, 0–1. Sits after the envelope and before the filter, so it behaves like an amplifier: a hard attack is dirtier than the tail |
| `fm.op2` | object | — | A second operator in series — takes the same keys again |
| `echo.mix` | float | — | **Echo** — wet/dry mix (0–1). Omit or `0` to disable |
| `echo.delay` | float | `0.18` | Delay line length in seconds (max 2.0) |
| `echo.feedback` | float | `0.35` | Feedback gain (0–0.95); values near 1 create long reverb tails |
| `pitchBend.to` | float | — | Target frequency in Hz at end of bend |
| `pitchBend.time` | float | `0.2` | Bend duration in seconds |

### FM modulation

`fm` wires an audio-rate modulator oscillator into the carrier's frequency input, producing classic FM synthesis timbres — bells, metallic clangour, bass stabs — depending on the modulator's frequency relative to `freq`, and on the depth.

```json
{ "waveform": "sine", "freq": 220, "fm": { "ratio": 2, "index": 1.4, "indexEnd": 0.1, "time": 0.3 },
  "adsr": { "a": 0.01, "d": 0.4, "s": 0, "r": 0.2 }, "gain": 0.7 }
```

**Reach for `ratio`, not `rate`.** They set the same oscillator, and the choice decides whether
the config is an instrument or one fixed sound. `rate` is absolute Hz, and a song overrides only
`freq` per step — so an instrument played at C2 and at C6 gets the same modulator frequency both
times, which means a different ratio, and a different timbre, at each end of the keyboard.
`ratio` resolves against the carrier, so the spectrum scales with pitch and the voice keeps its
identity. Absolute `rate` is right for a fixed-pitch impact and wrong for anything with notes.

`index` and `depth` are the same choice one level down: `depth` is deviation in raw Hz, `index`
is deviation ÷ modulator frequency — the quantity that stays put when the pitch moves. Set one
or the other; `index` wins.

Quick-reference ratios (`fm.ratio`, or `fm.rate ÷ freq`):

| Ratio | Character |
|---|---|
| 1:1 | Rich fundamental, organ-like |
| 2:1 | Bright, octave-enhanced |
| 3:1 | Metallic, bell-adjacent |
| 7:1 or non-integer | Inharmonic, clangorous, cyberpunk |

#### Sweeping the index

`indexEnd` (or `depthTo` in raw Hz) is the most expressive control in the format. An index that
**collapses** across the note is what reads as a struck object: bright and inharmonic at the
attack, settling toward the carrier as it rings. An index that sits still is a steady buzz, and
one that climbs reads as something being driven past its limits.

`ratioTo` / `rateTo` sweep the modulator's own pitch, which is what makes an impact read as
inharmonic rather than musical, and `time` is shared by both sweeps. A modulator authored with
`ratio` follows its own carrier through a `pitchBend` without being told to — holding the ratio
through a bend is what ratio means, and a modulator left behind turns the bend into a detune.

```json
{ "waveform": "sine", "freq": 261.6,
  "fm": { "ratio": 14, "index": 1.1, "indexEnd": 0.04, "time": 0.4 },
  "adsr": { "a": 0.002, "d": 1.9, "s": 0, "r": 0.6 }, "gain": 0.3 }
```

That is an electric piano. Ratio 14:1 is the Rhodes trick — a high inharmonic modulator over a
sine gives the bell-in-the-attack that defines the sound — and the collapse to 0.04 is the note
settling into a ring.

#### Velocity and timbre

A song step's `vol` is applied to the layer's gain **and** handed to the synth as a velocity. With
`fm.bright` set, that velocity opens the modulation index as well — so playing harder changes what
the note *sounds like*, not just how loud it is, which is most of what separates a piano from a
keyboard. It scales the attack index only; the sweep target is where the note settles, and a hard
note settles in the same place as a soft one.

`bright` is centred on velocity 0.5, so a mid-velocity note is exactly the authored index and the
config reads as written. Omit it and velocity behaves as it always has.

#### A second operator

`fm.op2` is one more operator in **series**: it modulates the modulator, not the carrier. Two
operators into a carrier are just two partials; a stack is where FM stops sounding like
oscillators and starts sounding like a material. It takes the same keys again, and its `ratio` is
against the **note**, not against the operator below it — that is how every FM instrument is
specified, and a ratio-of-a-ratio compounds into numbers nobody can author.

```json
{ "waveform": "sine", "freq": 110,
  "fm": { "ratio": 1, "index": 2, "time": 0.5, "op2": { "ratio": 7, "index": 0.8, "indexEnd": 0 } } }
```

Small `op2` numbers go a long way, because the index compounds through the operator below it.
Each operator is another oscillator per voice against a 16-voice pool, so a stack on a cue that
fires thirty layers at once is not free — see the voice budget below.

### Echo

`echo` creates a parallel delay-feedback loop. It is applied per layer in multi-layer configs, so each layer can have its own echo character.

```json
{ "waveform": "square", "freq": 440, "echo": { "mix": 0.4, "delay": 0.25, "feedback": 0.5 } }
```

`echo.feedback` must stay below `1.0` — at or above 1 the loop diverges. The delay line is clamped to 2 seconds.

### Layered configs (SFX)

`config.layers` replaces the single-layer shape. Any config with a `layers` array is treated as a multi-layer sound — each layer is an independent synth voice summed to the same output bus.

The key addition over a flat config is **`delay`**: a per-layer start offset in seconds, relative to when the SFX fires. This lets one SFX asset produce rhythmic sequences — three door raps, a burst-fire shot, a UI chime cascade — without `setTimeout` chains or multiple server messages.

```json
{
  "duration": 1.0,
  "layers": [
    {
      "noiseMix": 0.8,
      "filter": { "type": "bandpass", "freq": 280, "q": 3.5 },
      "adsr": { "a": 0.001, "d": 0.06, "s": 0, "r": 0.18 },
      "gain": 0.85,
      "delay": 0
    },
    {
      "noiseMix": 0.8,
      "filter": { "type": "bandpass", "freq": 280, "q": 3.5 },
      "adsr": { "a": 0.001, "d": 0.06, "s": 0, "r": 0.18 },
      "gain": 0.85,
      "delay": 0.28
    },
    {
      "noiseMix": 0.8,
      "filter": { "type": "bandpass", "freq": 280, "q": 3.5 },
      "adsr": { "a": 0.001, "d": 0.06, "s": 0, "r": 0.18 },
      "gain": 0.85,
      "delay": 0.56
    }
  ]
}
```

**Per-layer fields** — all standard config keys apply plus:

| Field | Type | Default | Notes |
|---|---|---|---|
| `delay` | float | `0` | Seconds before this layer starts, relative to SFX fire time |

**Rules:**
- Each element in `layers` is a full config object; nested `layers` are not supported.
- `duration` lives at the top level of the config (not inside each layer) and controls the overall hold time before release.
- Layers with `echo` each maintain their own independent delay line.
- Single-layer SFX continue to save in the flat format (no `layers` array) for backward compatibility — existing assets are unaffected.
- The devpanel SFX editor exposes layers as collapsible cards; each card has a **Delay (s)** field alongside Waveform and Frequency in the header row.

---

## Samples

A sample is a stored PCM/WAV clip (base-64 in `data`) that instruments play back instead of synthesizing. Backed by `audio_samples` rows; instruments reference one via `sample_id`. Import/export fields: `name`, `category`, `priority`, `data`, `mime_type`, `base_note`, `loop_start`, `loop_end`, `snes_rate`, `snes_bits`, `echo_mix`, `config`, `enabled`. Finetune is carried in `config.detune`. The `.MOD` importer creates one sample (and a wrapping instrument) per used tracker sample.

---

## Import / Export

All five asset types export to `.amp` files from the devpanel Audio tab (⬇ button per row). The Load button (⬆) on each tab accepts `.amp` or `.json`.

- **Single preset:** the root object is a single asset.
- **Batch:** the root object is a JSON array of assets.
- Importing always creates new rows — source IDs are never carried over, so importing can't silently collide with an existing asset by ID.
- Only fields in the whitelist for that asset type are accepted; unknown fields are ignored.

### `.MOD` import

The Audio tab can import Amiga/ProTracker `.mod` modules (Songs tab → Import MOD). The importer renders one sample + wrapping instrument per used tracker sample and builds a song at the **module's own tempo**. It honors volume, arpeggio, portamento, tone-portamento, vibrato and volume-slide effects (into per-step `fx`), sample finetune (into `config.detune`), pattern break/jump (as the song loop point), and Amiga L-R-R-L stereo panning (into `channel_pan`).

---

## Voice budget

The engine runs a shared 16-voice pool across all asset types. When all voices are busy, incoming sounds steal the lowest-priority oldest voice. If the incoming sound's priority is lower than all active voices, it is dropped silently.

Priority scale: `1` (background ambience) → `10` (critical UI). Songs default to `5`, SFX default to `5`, ambient defaults to `1`.
