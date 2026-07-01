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
| `fm.rate` | float | — | **FM modulation** — modulator frequency in Hz. Omit or `0` to disable |
| `fm.depth` | float | `100` | Frequency deviation in Hz (FM index = `depth ÷ carrier freq`) |
| `echo.mix` | float | — | **Echo** — wet/dry mix (0–1). Omit or `0` to disable |
| `echo.delay` | float | `0.18` | Delay line length in seconds (max 2.0) |
| `echo.feedback` | float | `0.35` | Feedback gain (0–0.95); values near 1 create long reverb tails |
| `pitchBend.to` | float | — | Target frequency in Hz at end of bend |
| `pitchBend.time` | float | `0.2` | Bend duration in seconds |

### FM modulation

`fm` wires an audio-rate modulator oscillator into the carrier's frequency input, producing classic FM synthesis timbres — bells, metallic clangour, bass stabs — depending on the ratio of `fm.rate` to `freq` and the `depth`.

```json
{ "waveform": "sine", "freq": 220, "fm": { "rate": 440, "depth": 300 },
  "adsr": { "a": 0.01, "d": 0.4, "s": 0, "r": 0.2 }, "gain": 0.7 }
```

Quick-reference ratios (ratio = `fm.rate ÷ freq`):

| Ratio | Character |
|---|---|
| 1:1 | Rich fundamental, organ-like |
| 2:1 | Bright, octave-enhanced |
| 3:1 | Metallic, bell-adjacent |
| 7:1 or non-integer | Inharmonic, clangorous, cyberpunk |

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
