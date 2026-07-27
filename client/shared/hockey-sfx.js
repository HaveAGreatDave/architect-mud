/**
 * Hockey FM soundset — the sound language for CPhL broadcasts and anything else
 * that needs ice, impacts or a crowd.
 *
 * Target: a compressed 1990s sports cartridge. Bright digital transients, very
 * short envelopes, crunchy pitch drops, primitive synthesized crowd, metallic
 * impacts, arcade readability over realism.
 *
 * IT DOES NOT CONTAIN A SYNTHESIZER. Everything here is data in the existing
 * `layer` schema that AudioEngine.buildLayer already understands
 * (client/shared/audio-engine.js) — waveform / freq / pitchBend / fm / filter /
 * adsr / noiseMix / echo / delay / gain. The engine gained exactly one thing for
 * this: `fm.depthTo` + `fm.rateTo`, sweeping the modulation index and modulator
 * pitch on the same {to, time} contract pitchBend and filter already use. A
 * falling modulation index is what turns a tone into a struck object, and it is
 * the single most important control in the whole file.
 *
 * Dual-mode like audio-engine.js / sfx-catalog.js: attaches to window/globalThis
 * so it loads as a plain <script> AND is visible to ESM modules as a global.
 *
 * Preset shape matches sfx-catalog.js BUILTINS exactly — { id, name, group,
 * category, priority, config: { duration, layers } } — so these can be spread
 * into that catalog's BUILTINS and become dev-panel editable (and DB-overridable
 * via `interface_sfx`) with no further work.
 */
(function (global) {

  // ── FM primitive ───────────────────────────────────────────────────────────
  // One voice. Classic FM: peak frequency deviation = index × modulator_freq,
  // so `index` here is the real modulation index, not a raw Hz depth.
  //   ratio  — carrier  = freq × ratio
  //   mod    — modulator = freq × mod   (1:1 buzzy · 1:2 hollow · 2:1 bright
  //            3:1 metallic · 1.414 inharmonic/collision · 2.41 machinery)
  //   index / indexEnd — the money control. High = harsh/metallic/complex,
  //            low = clean/tonal/bell. Collapsing high→low = a struck object.
  //   to     — pitch envelope target for BOTH carrier and modulator, so the
  //            whole timbre falls together instead of detuning apart.
  // TAMING FACTOR. Every modulation index in this file was authored from the spec's
  // ranges, and at those values almost everything came out harsh and buzzy — a
  // high index is a LOT of sidebands, and stacking three of them per impact turned
  // the whole bank to sandpaper. Scaling the index globally fixes the character of
  // every cue at once without re-tuning 29 presets by hand. Raise it if you ever
  // want the old sound back.
  const INDEX_SCALE = 0.42;
  // A gentle lowpass on every voice unless one is given explicitly. FM sidebands run
  // all the way up the spectrum; without this the top end is pure fizz.
  const SOFTEN = { type: 'lowpass', freq: 5200, q: 0.6 };

  function fm(o) {
    const dur = o.dur ?? 0.2;
    const slide = o.slide ?? dur * 0.55;
    const ratio = o.ratio ?? 1, mratio = o.mod ?? 1.414;
    const modRate = o.freq * mratio;
    const idx = (o.index ?? 4) * INDEX_SCALE;
    const layer = {
      waveform: o.wave || 'sine',
      freq: o.freq * ratio,
      noiseMix: o.noise ?? 0,
      adsr: o.adsr || { a: o.attack ?? 0.0005, d: dur * 0.7, s: o.sustain ?? 0, r: dur * 0.35 },
      gain: (o.gain ?? 0.3) * 0.72,
      fm: { rate: modRate, depth: idx * modRate, time: slide },
      filter: SOFTEN,
    };
    if (o.indexEnd != null) layer.fm.depthTo = o.indexEnd * INDEX_SCALE * (o.to ? o.to * mratio : modRate);
    if (o.to) {
      layer.pitchBend = { to: o.to * ratio, time: slide };
      layer.fm.rateTo = o.to * mratio;
    }
    if (o.delay) layer.delay = o.delay;
    if (o.filter) layer.filter = o.filter;     // explicit filter wins over SOFTEN
    if (o.vibrato) layer.vibrato = o.vibrato;
    if (o.echo) layer.echo = o.echo;
    return layer;
  }
  // Pure noise transient — the "air" on top of an impact.
  function hiss(o) {
    return { waveform: 'noise', noiseMix: 1, delay: o.delay,
      filter: o.filter || { type: 'bandpass', freq: o.freq ?? 1800, q: o.q ?? 0.7, to: o.to, time: o.slide },
      adsr: o.adsr || { a: 0.0005, d: (o.dur ?? 0.09) * 0.7, s: 0, r: (o.dur ?? 0.09) * 0.4 },
      gain: o.gain ?? 0.12 };
  }
  const def = (id, name, priority, duration, layers, category) =>
    ({ id, name, group: 'hockey', category: category || 'sfx', priority, config: { duration, layers } });

  // ── seeded rng, so a given event always sounds the same on every client ────
  function rngFrom(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ── crowd ──────────────────────────────────────────────────────────────────
  // REWRITTEN. The first version built a crowd out of 20–40 detuned FM oscillators,
  // following the spec literally. It sounded like a swarm of wasps, because that is
  // what a pile of pitched oscillators at random frequencies actually is.
  //
  // A crowd is NOISE, not notes. Thousands of overlapping voices average out to
  // broadband noise with a couple of vocal formant bumps around 500Hz and 1.2kHz.
  // So: filtered noise beds for the body, a handful of quiet band-passed swells for
  // movement, and only two or three pitched voices right at the top for the odd
  // shout. Far fewer layers, far less gain, and it actually sounds like people.
  //
  // `slide` still does the emotional work — the filter sweeps UP for a gasp or a
  // cheer and DOWN for a groan or a boo, which is exactly how a real crowd reads.
  function crowd(o) {
    const r = rngFrom(o.seed || 7);
    const dur = o.dur, g = o.gain ?? 0.3;
    const rise = (o.slide ?? 1) >= 1;
    const layers = [];
    // Body: low broadband roar. Two beds, slightly offset, so it breathes.
    for (let i = 0; i < 2; i++) {
      const base = (o.bodyLo ?? 260) * (1 + i * 0.55);
      layers.push({
        waveform: 'noise', noiseMix: 1, delay: i * 0.06,
        filter: { type: 'lowpass', freq: base, q: 0.6, to: base * (rise ? 1.9 : 0.55), time: dur * 0.5 },
        adsr: { a: o.attack ?? 0.18, d: dur * 0.35, s: 0.72, r: o.release ?? 0.6 },
        gain: g * (0.5 - i * 0.14),
      });
    }
    // Vocal formants: two band-passed noise swells where human voices actually sit.
    for (const [hz, q, amt] of [[520, 1.6, 0.30], [1250, 2.2, 0.16]]) {
      layers.push({
        waveform: 'noise', noiseMix: 1, delay: 0.02 + r() * 0.05,
        filter: { type: 'bandpass', freq: hz, q, to: hz * (rise ? 1.5 : 0.7), time: dur * 0.55 },
        adsr: { a: (o.attack ?? 0.18) * 1.3, d: dur * 0.4, s: 0.6, r: (o.release ?? 0.6) * 1.1 },
        gain: g * amt,
      });
    }
    // A couple of individual shouts riding on top — three, not thirty. These are the
    // only pitched voices, they sit quiet, and they're low-passed so they don't bite.
    const shouts = o.shouts ?? 3;
    for (let i = 0; i < shouts; i++) {
      const f = (o.lo ?? 380) + r() * ((o.hi ?? 900) - (o.lo ?? 380));
      const d = 0.22 + r() * 0.4;
      layers.push(fm({
        freq: f, to: f * ((o.slide ?? 1) * (0.95 + r() * 0.1)), dur: d,
        mod: 1, index: 0.8 + r() * 1.2, indexEnd: 0.3, wave: 'triangle',
        delay: 0.05 + (o.spread ?? 0.5) * r(),
        gain: g * (0.05 + r() * 0.06),
        filter: { type: 'lowpass', freq: 1900, q: 0.7 },
        adsr: { a: 0.05 + r() * 0.08, d: d * 0.5, s: 0.3, r: d * 0.7 },
      }));
    }
    return layers;
  }

  // ── the bank ───────────────────────────────────────────────────────────────
  const BUILTINS = [

    // ═══ ICE & SKATING ═══════════════════════════════════════════════════════
    def('hk-skate-scrape', 'Hockey — skate scrape', 3, 0.16, [
      fm({ freq: 1400, to: 1050, dur: 0.13, mod: 1.414, index: 5, indexEnd: 1.5, noise: 0.28, gain: 0.1,
           filter: { type: 'bandpass', freq: 1700, q: 0.9 } }),
    ]),
    def('hk-skate-stop', 'Hockey — hard stop', 5, 0.55, [
      fm({ freq: 1800, to: 500, dur: 0.5, slide: 0.34, mod: 1.414, index: 8, indexEnd: 1,
           noise: 0.4, gain: 0.22, filter: { type: 'bandpass', freq: 2000, q: 0.8, to: 700, time: 0.35 } }),
      hiss({ freq: 2600, to: 800, slide: 0.34, dur: 0.45, gain: 0.1 }),
    ]),

    // ═══ PUCK & STICK ════════════════════════════════════════════════════════
    def('hk-puck-tick', 'Hockey — puck tick', 4, 0.07, [
      fm({ freq: 820, dur: 0.055, mod: 2.41, index: 6, indexEnd: 0.8, gain: 0.24, wave: 'square' }),
      hiss({ freq: 3200, dur: 0.03, gain: 0.07 }),
    ]),
    def('hk-puck-slap', 'Hockey — slapshot', 6, 0.22, [
      fm({ freq: 150, to: 60, dur: 0.19, slide: 0.09, mod: 1.414, index: 10, indexEnd: 1.2,
           noise: 0.18, gain: 0.34, wave: 'square' }),
      hiss({ freq: 2400, to: 500, slide: 0.07, dur: 0.09, gain: 0.16 }),
    ]),
    def('hk-stick-hit', 'Hockey — stick crack', 5, 0.15, [
      fm({ freq: 250, to: 100, dur: 0.12, slide: 0.05, mod: 2.41, index: 9, indexEnd: 1, gain: 0.3, wave: 'square' }),
      hiss({ freq: 3400, to: 900, slide: 0.04, dur: 0.05, gain: 0.13 }),
    ]),
    def('hk-stick-break', 'Hockey — stick snap', 7, 0.3, [
      fm({ freq: 1800, to: 400, dur: 0.1, slide: 0.05, mod: 2.41, index: 12, indexEnd: 1, gain: 0.2, wave: 'square' }),
      fm({ freq: 700, to: 180, dur: 0.18, slide: 0.08, mod: 1.414, index: 10, indexEnd: 2, gain: 0.24 }),
      fm({ freq: 100, to: 45, dur: 0.26, slide: 0.12, mod: 1.414, index: 8, indexEnd: 1, gain: 0.3, wave: 'square' }),
      hiss({ freq: 2800, to: 600, slide: 0.06, dur: 0.1, gain: 0.16 }),
    ]),
    def('hk-post', 'Hockey — iron (post)', 8, 0.85, [
      // The best sound in the sport. Low index and a long tail = a ringing bar,
      // not an impact; the 2:1 ratio keeps it harmonic enough to actually sing.
      fm({ freq: 600, dur: 0.8, mod: 2, index: 3, indexEnd: 0.3, slide: 0.25, gain: 0.3,
           adsr: { a: 0.0005, d: 0.1, s: 0.62, r: 0.5 },
           echo: { mix: 0.16, delay: 0.14, feedback: 0.22 } }),
      fm({ freq: 903, dur: 0.7, mod: 2, index: 2, indexEnd: 0.1, slide: 0.2, gain: 0.16, delay: 0.006,
           adsr: { a: 0.0005, d: 0.12, s: 0.5, r: 0.45 } }),
    ]),
    def('hk-net', 'Hockey — net bulge', 6, 0.42, [
      fm({ freq: 180, to: 60, dur: 0.4, slide: 0.16, mod: 2.41, index: 8, indexEnd: 1, noise: 0.22, gain: 0.28 }),
      fm({ freq: 900, to: 300, dur: 0.2, slide: 0.09, mod: 1.414, index: 5, indexEnd: 0.5, gain: 0.12 }),
    ]),
    def('hk-pad-save', 'Hockey — pad save', 5, 0.16, [
      fm({ freq: 220, to: 110, dur: 0.14, slide: 0.06, mod: 1.414, index: 6, indexEnd: 1, noise: 0.3, gain: 0.26,
           filter: { type: 'lowpass', freq: 1500, q: 0.8 } }),
    ]),
    def('hk-glove-save', 'Hockey — glove snag', 5, 0.11, [
      fm({ freq: 480, to: 240, dur: 0.09, slide: 0.04, mod: 2.41, index: 7, indexEnd: 0.6, noise: 0.4, gain: 0.22,
           filter: { type: 'bandpass', freq: 1600, q: 1.1 } }),
    ]),

    // ═══ CONTACT ═════════════════════════════════════════════════════════════
    def('hk-check', 'Hockey — body check', 7, 0.34, [
      fm({ freq: 100, to: 45, dur: 0.3, slide: 0.13, mod: 1.414, index: 12, indexEnd: 1, noise: 0.28, gain: 0.36, wave: 'square' }),
      hiss({ freq: 1400, to: 350, slide: 0.1, dur: 0.13, gain: 0.14 }),
    ]),
    def('hk-glass', 'Hockey — into the glass', 7, 0.5, [
      fm({ freq: 140, to: 62, dur: 0.28, slide: 0.11, mod: 1.414, index: 11, indexEnd: 1.2, noise: 0.24, gain: 0.3, wave: 'square' }),
      // the glass itself: a bright inharmonic shiver on top
      fm({ freq: 2100, dur: 0.44, mod: 2.41, index: 4, indexEnd: 0.4, slide: 0.2, gain: 0.13, delay: 0.01,
           adsr: { a: 0.001, d: 0.14, s: 0.3, r: 0.3 } }),
      hiss({ freq: 4200, to: 1600, slide: 0.14, dur: 0.3, gain: 0.09 }),
    ]),
    def('hk-fall', 'Hockey — down on the ice', 6, 0.75, [
      fm({ freq: 140, to: 60, dur: 0.2, slide: 0.08, mod: 1.414, index: 8, indexEnd: 1, gain: 0.32, wave: 'square' }),
      fm({ freq: 1200, to: 300, dur: 0.5, slide: 0.3, delay: 0.1, mod: 1.414, index: 5, indexEnd: 1, noise: 0.34, gain: 0.14 }),
      fm({ freq: 700, to: 150, dur: 0.26, slide: 0.16, delay: 0.42, mod: 1.414, index: 4, indexEnd: 0.6, noise: 0.3, gain: 0.09 }),
    ]),
    def('hk-gloves-drop', 'Hockey — gloves hit the ice', 4, 0.2, [
      fm({ freq: 200, to: 95, dur: 0.11, slide: 0.05, mod: 1.414, index: 5, indexEnd: 0.8, noise: 0.3, gain: 0.16,
           filter: { type: 'lowpass', freq: 1100, q: 0.7 } }),
      fm({ freq: 175, to: 85, dur: 0.11, slide: 0.05, delay: 0.075, mod: 1.414, index: 5, indexEnd: 0.8, noise: 0.3, gain: 0.14,
           filter: { type: 'lowpass', freq: 1000, q: 0.7 } }),
    ]),

    // ═══ THE FIGHT ═══════════════════════════════════════════════════════════
    // Punches are the most-repeated sound in the centerpiece, so they get the
    // widest variation treatment (see variant() below) — the same hit twice in
    // a row is what makes a fight sound cheap.
    def('hk-punch', 'Fight — punch', 7, 0.2, [
      fm({ freq: 170, to: 78, dur: 0.16, slide: 0.07, mod: 1.414, index: 10, indexEnd: 1.4, noise: 0.2, gain: 0.32, wave: 'square' }),
      hiss({ freq: 1900, to: 500, slide: 0.05, dur: 0.07, gain: 0.12 }),
    ]),
    def('hk-punch-miss', 'Fight — whiff', 4, 0.16, [
      hiss({ freq: 900, to: 2400, slide: 0.09, dur: 0.15, q: 1.4, gain: 0.1 }),
    ]),
    def('hk-punch-big', 'Fight — big impact', 9, 0.55, [
      fm({ freq: 1000, to: 250, dur: 0.18, slide: 0.07, mod: 2.41, index: 8, indexEnd: 0.8, gain: 0.2, wave: 'square' }),
      fm({ freq: 200, to: 80, dur: 0.34, slide: 0.13, mod: 1.414, index: 10, indexEnd: 1.2, noise: 0.3, gain: 0.34, wave: 'square' }),
      fm({ freq: 70, to: 30, dur: 0.5, slide: 0.2, mod: 1.414, index: 12, indexEnd: 0.8, noise: 0.2, gain: 0.4, wave: 'square' }),
      hiss({ freq: 2600, to: 400, slide: 0.06, dur: 0.12, gain: 0.18 }),
    ]),
    def('hk-grapple', 'Fight — jersey grab', 3, 0.3, [
      hiss({ freq: 700, to: 1500, slide: 0.16, dur: 0.28, q: 0.6, gain: 0.07 }),
      fm({ freq: 260, to: 190, dur: 0.22, mod: 1.414, index: 3, indexEnd: 0.5, noise: 0.5, gain: 0.08 }),
    ]),
    def('hk-knockout', 'Fight — knockout', 10, 1.6, [
      // The whole event: the landing shot, the body, and the arena reacting.
      fm({ freq: 1100, to: 260, dur: 0.2, slide: 0.07, mod: 2.41, index: 9, indexEnd: 0.7, gain: 0.22, wave: 'square' }),
      fm({ freq: 190, to: 74, dur: 0.4, slide: 0.15, mod: 1.414, index: 12, indexEnd: 1, noise: 0.32, gain: 0.38, wave: 'square' }),
      fm({ freq: 64, to: 28, dur: 0.62, slide: 0.26, mod: 1.414, index: 13, indexEnd: 0.7, noise: 0.22, gain: 0.44, wave: 'square' }),
      hiss({ freq: 3000, to: 380, slide: 0.06, dur: 0.14, gain: 0.2 }),
      // body hits the ice a beat later
      fm({ freq: 130, to: 55, dur: 0.26, slide: 0.11, delay: 0.3, mod: 1.414, index: 8, indexEnd: 1, gain: 0.26, wave: 'square' }),
      ...crowd({ seed: 991, dur: 1.1, voices: 26, lo: 420, hi: 1700, slide: 1.35, idxLo: 2, idxHi: 5,
        spread: 0.4, attack: 0.05, gain: 0.3, bodies: 3, bodyLo: 110, bodyHi: 240 }).map(l => ({ ...l, delay: (l.delay || 0) + 0.16 })),
    ]),

    // ═══ OFFICIALS & HORNS ═══════════════════════════════════════════════════
    def('hk-whistle', 'Hockey — whistle', 8, 0.7, [
      fm({ freq: 2200, dur: 0.65, mod: 1, index: 0.4, indexEnd: 0.25, gain: 0.16, wave: 'sine',
           vibrato: { rate: 6, depth: 22 }, adsr: { a: 0.006, d: 0.05, s: 0.8, r: 0.1 } }),
      fm({ freq: 3300, dur: 0.6, mod: 1, index: 0.3, gain: 0.06, wave: 'sine',
           vibrato: { rate: 6.4, depth: 18 }, adsr: { a: 0.008, d: 0.05, s: 0.7, r: 0.1 } }),
    ]),
    def('hk-whistle-short', 'Hockey — short blast', 8, 0.24, [
      fm({ freq: 2400, dur: 0.2, mod: 1, index: 0.35, gain: 0.16, wave: 'sine',
           vibrato: { rate: 7, depth: 20 }, adsr: { a: 0.002, d: 0.09, s: 0.4, r: 0.05 } }),
    ]),
    def('hk-goal-horn', 'Hockey — goal horn', 10, 2.2, [
      fm({ freq: 110, dur: 2.1, mod: 1, index: 1.5, gain: 0.3, wave: 'sawtooth',
           adsr: { a: 0.035, d: 0.2, s: 0.85, r: 0.28 }, echo: { mix: 0.2, delay: 0.22, feedback: 0.24 } }),
      fm({ freq: 220, dur: 2.0, mod: 1, index: 2, gain: 0.22, wave: 'sawtooth',
           adsr: { a: 0.045, d: 0.2, s: 0.8, r: 0.28 }, vibrato: { rate: 4.5, depth: 6 } }),
      fm({ freq: 440, dur: 1.9, mod: 1, index: 2.5, indexEnd: 1.4, slide: 1.2, gain: 0.14, wave: 'sawtooth',
           adsr: { a: 0.05, d: 0.22, s: 0.7, r: 0.3 } }),
    ], 'tv'),
    def('hk-period-horn', 'Hockey — period end', 9, 2.0, [
      fm({ freq: 440, to: 110, dur: 1.9, slide: 1.1, mod: 1, index: 2, indexEnd: 0.5, gain: 0.3, wave: 'sawtooth',
           adsr: { a: 0.03, d: 0.3, s: 0.75, r: 0.4 }, echo: { mix: 0.18, delay: 0.2, feedback: 0.2 } }),
      fm({ freq: 220, to: 55, dur: 1.9, slide: 1.1, mod: 1, index: 1.5, indexEnd: 0.4, gain: 0.2, wave: 'sawtooth',
           adsr: { a: 0.04, d: 0.3, s: 0.7, r: 0.4 } }),
    ], 'tv'),

    // ═══ CROWD ═══════════════════════════════════════════════════════════════
    def('hk-crowd-gasp', 'Crowd — gasp', 6, 0.7, [
      ...crowd({ seed: 11, dur: 0.55, voices: 20, lo: 520, hi: 1900, slide: 1.45, idxLo: 2, idxHi: 5,
        spread: 0.14, attack: 0.03, gain: 0.26 }),
    ], 'ambient'),
    def('hk-crowd-groan', 'Crowd — groan', 5, 1.5, [
      ...crowd({ seed: 23, dur: 1.2, voices: 18, lo: 110, hi: 520, slide: 0.72, idxLo: 2, idxHi: 7,
        spread: 0.4, attack: 0.2, release: 0.7, gain: 0.24, bodyLo: 80, bodyHi: 150 }),
    ], 'ambient'),
    def('hk-crowd-cheer', 'Crowd — cheer', 7, 2.6, [
      ...crowd({ seed: 37, dur: 2.2, voices: 30, lo: 320, hi: 1400, slide: 1.12, idxLo: 2, idxHi: 7,
        spread: 0.7, front: 0.7, attack: 0.35, release: 1.1, gain: 0.3, bodies: 4 }),
    ], 'ambient'),
    def('hk-crowd-roar', 'Crowd — roar', 8, 3.4, [
      ...crowd({ seed: 53, dur: 3.0, voices: 40, lo: 280, hi: 1600, slide: 1.18, idxLo: 3, idxHi: 8,
        spread: 0.8, front: 0.6, attack: 0.3, release: 1.4, gain: 0.36, bodies: 5, bodyLo: 70, bodyHi: 210 }),
    ], 'ambient'),
    def('hk-crowd-boo', 'Crowd — boo', 6, 2.4, [
      ...crowd({ seed: 71, dur: 2.0, voices: 26, lo: 150, hi: 700, slide: 0.84, idxLo: 3, idxHi: 8,
        spread: 0.6, attack: 0.25, release: 1.0, gain: 0.3, bodies: 5, bodyLo: 70, bodyHi: 160 }),
    ], 'ambient'),
    def('hk-crowd-bed', 'Crowd — arena bed', 2, 4.0, [
      fm({ freq: 60, dur: 3.9, mod: 1, index: 0.5, gain: 0.07, wave: 'sine',
           adsr: { a: 0.8, d: 1, s: 0.8, r: 1.2 } }),
      fm({ freq: 170, dur: 3.9, mod: 1.414, index: 1.4, indexEnd: 0.8, slide: 2, gain: 0.05, wave: 'sine',
           adsr: { a: 1, d: 1, s: 0.7, r: 1.2 }, vibrato: { rate: 0.24, depth: 4 } }),
      ...crowd({ seed: 89, dur: 3.4, voices: 16, lo: 200, hi: 900, slide: 1, idxLo: 1, idxHi: 4,
        spread: 3.2, attack: 0.4, release: 1.2, gain: 0.09, bodies: 0 }),
    ], 'ambient'),
  ];

  const BY_ID = new Map(BUILTINS.map(d => [d.id, d]));

  // ── variation ──────────────────────────────────────────────────────────────
  // Same sound family, different individual event. Never wide enough to lose the
  // identity — the point is that a punch is recognisably a punch but never the
  // exact same punch twice, which is what separates this from a sample bank.
  const SPREAD = { freq: 0.11, dur: 0.18, index: 0.2, gain: 0.1 };
  function variant(d, seed, amount) {
    if (!d) return null;
    const k = amount ?? 1, r = rngFrom(seed);
    const j = (v, s) => v * (1 + (r() * 2 - 1) * s * k);
    return { ...d, config: { ...d.config,
      layers: d.config.layers.map((L) => {
        const o = { ...L };
        if (o.freq) o.freq = j(o.freq, SPREAD.freq);
        if (o.pitchBend?.to) o.pitchBend = { ...o.pitchBend, to: j(o.pitchBend.to, SPREAD.freq) };
        if (o.fm) {
          o.fm = { ...o.fm, rate: j(o.fm.rate, SPREAD.freq), depth: j(o.fm.depth, SPREAD.index) };
          if (o.fm.rateTo) o.fm.rateTo = j(o.fm.rateTo, SPREAD.freq);
          if (o.fm.depthTo != null) o.fm.depthTo = j(o.fm.depthTo, SPREAD.index);
        }
        if (o.filter?.freq) o.filter = { ...o.filter, freq: j(o.filter.freq, SPREAD.freq) };
        if (o.adsr) o.adsr = { ...o.adsr, d: j(o.adsr.d, SPREAD.dur), r: j(o.adsr.r, SPREAD.dur) };
        o.gain = j(o.gain ?? 0.3, SPREAD.gain);
        return o;
      }) } };
  }

  let _n = 0;
  function get(id, seed) { const d = BY_ID.get(id); return seed == null ? d : variant(d, seed); }
  // Fire and forget. Omitting `seed` still varies — repeated punches must not
  // be identical, and callers shouldn't have to remember to make that happen.
  function play(id, seed, amount) {
    const d = BY_ID.get(id); if (!d) return null;
    const AE = global.AudioEngine; if (!AE?.playSfx) return null;
    return AE.playSfx(variant(d, seed == null ? (_n = (_n * 1664525 + 1013904223) >>> 0) : seed, amount));
  }

  // Global-only, matching audio-engine.js and sfx-catalog.js. The repo is
  // "type": "module", so a CJS `module.exports` branch here would be dead code.
  global.HockeySfx = { BUILTINS, get, play, variant, fm, hiss, crowd, ids: () => [...BY_ID.keys()] };

})(typeof globalThis !== 'undefined' ? globalThis : window);
