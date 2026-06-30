# AMP Format — Architect Music Player Asset Specification

`.amp` files are plain JSON exports from the devpanel Audio tab. Each file contains either a single preset object or an array of preset objects. The format covers four asset types: **instruments**, **songs**, **sfx**, and **ambient**.

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
  "adsr": {
    "a": 0.01,
    "d": 0.05,
    "s": 0.7,
    "r": 0.15
  },
  "filter": {
    "type": "lowpass",
    "freq": 4000,
    "q": 1
  },
  "vibrato": {
    "rate": 0,
    "depth": 0
  },
  "tremolo": {
    "rate": 0,
    "depth": 0
  },
  "pitchBend": {
    "to": 880,
    "time": 0.25
  }
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `waveform` | string | `"square"` | `square` `sine` `triangle` `sawtooth` `noise` |
| `freq` | float | `440` | Base frequency in Hz. Overridden per-step in songs |
| `duration` | float | `0.4` | Seconds. SFX only — how long before the release phase |
| `gain` | float | `1.0` | Output level scalar (0–1) |
| `noiseMix` | float | `0.0` | 0 = pure oscillator, 1 = pure noise, fractional = blend |
| `detune` | float | `0` | Cents offset applied to the oscillator |
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
| `pitchBend.to` | float | — | Target frequency in Hz at end of bend |
| `pitchBend.time` | float | `0.2` | Bend duration in seconds |

### Layered configs

`config.layers` overrides the single-layer shape entirely. Any config with a `layers` array is treated as a multi-layer sound — each layer is its own independent synth voice with its own ADSR, filter, and waveform, all summed to the same output.

```json
{
  "layers": [
    { "waveform": "noise", "noiseMix": 1, "duration": 0.08, "adsr": { "a": 0.001, "d": 0.05, "s": 0, "r": 0.03 }, "filter": { "type": "highpass", "freq": 1500, "q": 1 } },
    { "waveform": "triangle", "freq": 150, "duration": 0.3, "gain": 0.5, "pitchBend": { "to": 60, "time": 0.25 }, "adsr": { "a": 0.001, "d": 0.15, "s": 0.2, "r": 0.15 }, "filter": { "type": "lowpass", "freq": 700, "q": 1 } }
  ]
}
```

Each element in `layers` is a full config object (minus a nested `layers`). Useful for mechanical sounds that need a noise burst + a pitched component (e.g. eject clicks, UI chimes).

---

## Import / Export

All four asset types export to `.amp` files from the devpanel Audio tab (⬇ button per row). The Load button (⬆) on each tab accepts `.amp` or `.json`.

- **Single preset:** the root object is a single asset.
- **Batch:** the root object is a JSON array of assets.
- Importing always creates new rows — source IDs are never carried over, so importing can't silently collide with an existing asset by ID.
- Only fields in the whitelist for that asset type are accepted; unknown fields are ignored.

---

## Voice budget

The engine runs a shared 16-voice pool across all asset types. When all voices are busy, incoming sounds steal the lowest-priority oldest voice. If the incoming sound's priority is lower than all active voices, it is dropped silently.

Priority scale: `1` (background ambience) → `10` (critical UI). Songs default to `5`, SFX default to `5`, ambient defaults to `1`.
