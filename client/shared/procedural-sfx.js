/**
 * Procedural material/action audio — SHARED between server and client.
 *
 * Dual-mode like tagCatalog.js / audio-engine.js: attaches to window/globalThis
 * so it loads as a plain <script> in the game client AND is importable by
 * server-side ESM (the regression suite builds cues here to validate them).
 *
 * WHY IT LIVES ON THE CLIENT SIDE OF THE TREE
 *
 * A sizzle at high heat is a field of ~32 randomised burst layers. Serialising
 * those and shipping them to every player in the zone cost 6 KB per cue, and a
 * deglaze fires three at once. So the server no longer sends layers at all — it
 * sends the SEMANTIC parameters plus a seed (~100 bytes), and the client builds
 * the identical field locally. Same sound, 60x less wire.
 *
 * That is also why every random draw below goes through the seeded generator
 * rather than Math.random: given the same seed, server and client must agree
 * exactly, and a cue must be reproducible when someone is trying to tune it.
 */
(function (global) {

  // Mulberry32 — small, fast, and identical in every JS engine, which is the
  // only property that matters here.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // The active draw. Swapped per build so the generators below stay plain
  // functions rather than threading an rng argument through every one of them.
  let rnd = Math.random;


  // ── Material profiles ────────────────────────────────────────────────────────
  //
  // Deliberately acoustic properties, not ingredient names. The cooking plugin
  // maps its own `food_profile` catalog onto these tokens, so this file never
  // learns what a potato is.
  //
  //   hardness   0..1  resistance under a blade — how bright and sharp the transient
  //   moisture   0..1  how much squelch rides under the impact
  //   density    0..1  body — low frequency weight and decay length
  //   viscosity  0..1  how irregular and clingy movement sounds
  //   fat        0..1  fine-grained crackle when it meets heat
  const MATERIALS = {
    hard_food:  { hardness: 0.9, moisture: 0.25, density: 0.6, viscosity: 0.05, fat: 0.05 },
    soft_food:  { hardness: 0.3, moisture: 0.6,  density: 0.35, viscosity: 0.2,  fat: 0.05 },
    wet_meat:   { hardness: 0.45, moisture: 0.9, density: 0.8, viscosity: 0.35, fat: 0.5 },
    bone:       { hardness: 1.0, moisture: 0.15, density: 0.9, viscosity: 0.0,  fat: 0.05 },
    dough:      { hardness: 0.15, moisture: 0.5, density: 0.5, viscosity: 0.8,  fat: 0.2 },
    fat:        { hardness: 0.1, moisture: 0.3,  density: 0.4, viscosity: 0.6,  fat: 1.0 },
    liquid:     { hardness: 0.0, moisture: 1.0,  density: 0.3, viscosity: 0.15, fat: 0.1 },
    thick_sauce:{ hardness: 0.0, moisture: 0.8,  density: 0.6, viscosity: 0.9,  fat: 0.3 },
    bread:      { hardness: 0.35, moisture: 0.2, density: 0.25, viscosity: 0.05, fat: 0.1 },
    dairy:      { hardness: 0.2, moisture: 0.7,  density: 0.5, viscosity: 0.7,  fat: 0.8 },
  };

  // Vessels and tools ring; food does not. Separate table because the same chop
  // can land on a board, and the same stir can knock a pot.
  const SURFACES = {
    wood:    { freq: 260,  decay: 0.13, q: 1.4, noise: 0.5,  bend: 0.82 },
    metal:   { freq: 1650, decay: 0.30, q: 7.0, noise: 0.15, bend: 0.93 },
    ceramic: { freq: 2600, decay: 0.45, q: 9.0, noise: 0.08, bend: 0.97 },
    none:    { freq: 400,  decay: 0.08, q: 1.0, noise: 0.7,  bend: 0.85 },
  };

  // ── State modifiers ──────────────────────────────────────────────────────────
  //
  // A material class is right about a carrot and a potato, and wrong about a
  // FROZEN carrot. States are the sparse escape hatch: rather than authoring five
  // acoustic numbers onto all 85 food items to capture differences nobody can
  // hear, a state overrides the handful of properties that genuinely change when
  // something is in an unusual condition.
  //
  // `frozen` is the one that earns it, and it costs nothing to know — the cooking
  // system already computes it from the thermal environment for cook timing.
  const STATES = {
    frozen: m => ({ ...m, hardness: Math.max(0.95, m.hardness), moisture: m.moisture * 0.15, density: Math.min(1, m.density + 0.2) }),
    // Cooked-through food has given up its water and softened; worth having for
    // anything that carves a finished roast.
    cooked: m => ({ ...m, hardness: m.hardness * 0.7, moisture: m.moisture * 0.6 }),
  };

  const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
  const lerp = (a, b, t) => a + (b - a) * clamp01(t);

  // Small constrained wobble so a repeated action never lands identically. The
  // bounds are the spec's: enough to stop it reading as a sample, not so much that
  // a chop stops sounding like the same knife.
  const vary = (v, pct) => v * (1 + (rnd() * 2 - 1) * pct);

  // Resolve a material, then let a state bend it. An unknown material falls back
  // rather than throwing, and an unknown state is simply ignored — both so a
  // content typo degrades to a plausible sound instead of silence.
  const material = (m, state) => {
    const base = MATERIALS[m] || MATERIALS.soft_food;
    const mod = state && STATES[state];
    return mod ? mod(base) : base;
  };
  const surface = s => SURFACES[s] || SURFACES.none;

  const def = (id, duration, layers, priority = 4) => ({
    id, name: id, category: 'sfx', priority,
    config: { duration, layers: layers.filter(Boolean) },
  });

  // ── IMPACT ───────────────────────────────────────────────────────────────────
  // Utensils on cookware, a plate set down, a mallet on meat. Heavy things are
  // lower and ring longer; small ones are brighter and shorter.
  function impact({ surface: surf = 'metal', intensity = 0.5, weight = 0.5 } = {}) {
    const s = surface(surf);
    const i = clamp01(intensity);
    const freq = vary(s.freq * lerp(1.25, 0.7, weight), 0.08);
    const decay = vary(s.decay * lerp(0.7, 1.5, weight), 0.12);
    return def('cook_impact', decay + 0.15, [
      { waveform: 'triangle', freq,
        pitchBend: { to: freq * s.bend, time: decay * 0.35 },
        fm: { rate: freq * vary(3, 0.15), depth: freq * lerp(0.4, 1.6, i) },
        filter: { type: 'bandpass', freq, q: s.q },
        adsr: { a: 0.001, d: decay, s: 0, r: decay * 0.5 },
        gain: vary(0.16 + 0.2 * i, 0.12) },
      s.noise > 0.05 && { noiseMix: 1,
        filter: { type: 'bandpass', freq: vary(freq * 1.6, 0.2), q: 1.1 },
        adsr: { a: 0.001, d: vary(0.03, 0.3), s: 0, r: 0.03 },
        gain: vary(0.1 * s.noise * (0.4 + i), 0.2) },
    ]);
  }

  // ── CHOP ─────────────────────────────────────────────────────────────────────
  // Impact + blade transient + optional wet squelch. The single most reused
  // generator: every chop, cut, mince and tenderise in the game is this function
  // with different numbers.
  function chop({ material: mat = 'soft_food', intensity = 0.6, board = 'wood', state = null } = {}) {
    const m = material(mat, state);
    const i = clamp01(intensity);
    const b = surface(board);
    // Hard things ring the board; soft things thud into it.
    const bodyFreq = vary(b.freq * lerp(0.8, 1.15, m.hardness), 0.1);
    const bodyDecay = vary(b.decay * lerp(1.2, 0.7, m.hardness), 0.15);
    // The blade itself — bright, brief, and only really present on firm food.
    const bladeFreq = vary(lerp(2000, 6000, m.hardness), 0.1);

    return def('cook_chop', 0.45, [
      { waveform: 'triangle', freq: bodyFreq,
        pitchBend: { to: bodyFreq * 0.8, time: bodyDecay * 0.4 },
        fm: { rate: bodyFreq * vary(2.5, 0.2), depth: bodyFreq * lerp(0.3, 1.2, i) },
        filter: { type: 'lowpass', freq: vary(1800, 0.15), q: 1.2 },
        adsr: { a: 0.001, d: bodyDecay, s: 0, r: bodyDecay * 0.4 },
        gain: vary(0.18 + 0.22 * i * lerp(0.6, 1, m.density), 0.12) },
      m.hardness > 0.2 && { waveform: 'square', freq: bladeFreq,
        fm: { rate: bladeFreq * vary(3.5, 0.2), depth: bladeFreq * lerp(0.8, 2.2, m.hardness) },
        filter: { type: 'highpass', freq: 1800, q: 0.9 },
        adsr: { a: 0, d: vary(lerp(0.02, 0.08, m.hardness), 0.25), s: 0, r: 0.02 },
        gain: vary(0.05 + 0.12 * m.hardness * i, 0.18) },
      // Squelch. Wet food only, and it sits under everything else.
      m.moisture > 0.4 && { noiseMix: 1, delay: 0.004,
        filter: { type: 'lowpass', freq: vary(lerp(400, 900, m.moisture), 0.2), q: 2.2 },
        adsr: { a: 0.002, d: vary(0.07, 0.3), s: 0, r: 0.05 },
        gain: vary(0.09 * m.moisture * (0.5 + i), 0.2) },
    ]);
  }

  // ── SLICE / SCRAPE ───────────────────────────────────────────────────────────
  // Spreading butter, scouring a pan, dragging a spatula. Filtered noise with a
  // moving cutoff; the surface decides where the energy sits.
  function scrape({ surface: surf = 'metal', intensity = 0.5, duration = 0.5 } = {}) {
    const s = surface(surf);
    const i = clamp01(intensity);
    const dur = vary(duration, 0.15);
    const centre = vary(surf === 'wood' ? 700 : 2200, 0.2);
    return def('cook_scrape', dur + 0.2, [
      { noiseMix: 1,
        filter: { type: 'bandpass', freq: centre, q: lerp(0.8, 2.4, i) },
        vibrato: { rate: vary(lerp(3, 14, i), 0.25), depth: centre * 0.2 },
        adsr: { a: vary(0.04, 0.3), d: dur * 0.6, s: 0.5, r: 0.14 },
        gain: vary(0.07 + 0.09 * i, 0.15) },
      surf === 'metal' && { waveform: 'sine', freq: vary(1900, 0.2),
        fm: { rate: vary(4200, 0.2), depth: vary(700, 0.25) },
        filter: { type: 'bandpass', freq: 2100, q: 6 },
        adsr: { a: 0.02, d: dur * 0.5, s: 0.25, r: 0.12 },
        gain: vary(0.035 * (0.5 + i), 0.2) },
    ], 3);
  }

  // ── STIR ─────────────────────────────────────────────────────────────────────
  // Movement through a medium, plus the odd knock against the vessel. Thick things
  // are irregular and cling; thin things are smooth.
  function stir({ material: mat = 'liquid', vessel = 'metal', intensity = 0.5, state = null } = {}) {
    const m = material(mat, state);
    const i = clamp01(intensity);
    const dur = vary(lerp(0.7, 0.45, i), 0.15);
    const base = vary(lerp(90, 260, m.viscosity), 0.15);
    return def('cook_stir', dur + 0.25, [
      // The medium moving.
      { waveform: 'sine', freq: base,
        fm: { rate: base * vary(2, 0.25), depth: base * lerp(0.5, 2.5, m.viscosity) },
        filter: { type: 'lowpass', freq: vary(lerp(600, 1400, m.moisture), 0.2), q: 1.1 },
        adsr: { a: 0.05, d: dur * 0.7, s: 0.4, r: 0.15 },
        gain: vary(0.06 + 0.07 * i, 0.15) },
      { noiseMix: 1,
        filter: { type: 'bandpass', freq: vary(lerp(500, 1800, m.moisture), 0.25), q: 1.4 },
        // Thick mixtures pull irregularly; thin ones swish evenly.
        vibrato: { rate: vary(lerp(2.5, 9, m.viscosity), 0.3), depth: 200 },
        adsr: { a: 0.06, d: dur * 0.6, s: 0.35, r: 0.18 },
        gain: vary(0.05 + 0.06 * i * lerp(1, 0.6, m.viscosity), 0.18) },
      // One knock against the pot, placed somewhere in the stroke.
      rnd() < 0.55 && {
        waveform: 'triangle', freq: vary(surface(vessel).freq, 0.12), delay: vary(dur * 0.6, 0.4),
        filter: { type: 'bandpass', freq: surface(vessel).freq, q: surface(vessel).q },
        adsr: { a: 0.001, d: vary(0.09, 0.3), s: 0, r: 0.05 },
        gain: vary(0.07, 0.25) },
    ], 3);
  }

  // ── POUR ─────────────────────────────────────────────────────────────────────
  // Liquid leaving a vessel. Flow widens the spectrum; thick liquids pulse.
  function pour({ material: mat = 'liquid', flow = 0.6, duration = 0.9, state = null } = {}) {
    const m = material(mat, state);
    const f = clamp01(flow);
    const dur = vary(duration, 0.12);
    return def('cook_pour', dur + 0.25, [
      { noiseMix: 1,
        filter: { type: 'lowpass', freq: vary(lerp(700, 4200, f), 0.15), q: 0.9 },
        vibrato: { rate: vary(lerp(2, 7, m.viscosity), 0.3), depth: lerp(60, 300, m.viscosity) },
        adsr: { a: vary(0.05, 0.3), d: dur * 0.6, s: 0.55, r: 0.18 },
        gain: vary(0.07 + 0.08 * f, 0.15) },
      { waveform: 'sine', freq: vary(lerp(140, 320, f), 0.2),
        filter: { type: 'lowpass', freq: 500, q: 1 },
        adsr: { a: 0.04, d: dur * 0.5, s: 0.4, r: 0.15 },
        gain: vary(0.04 + 0.05 * f, 0.2) },
    ], 3);
  }

  // ── SIZZLE ───────────────────────────────────────────────────────────────────
  // Food meeting heat. A noise bed plus a burst field — heat drives density and
  // brightness, fat drives fine crackle, moisture drives irregular pops.
  //
  // FRY_CRACKLE from the spec is this generator at high heat with more bursts,
  // which is why there is no second function for it.
  function sizzle({ material: mat = 'wet_meat', heat = 0.6, duration = 1.2, state = null } = {}) {
    const m = material(mat, state);
    const h = clamp01(heat);
    const dur = vary(duration, 0.1);
    // 4 bursts a second at a bare simmer, ~26 at a hard sear.
    const count = Math.round(lerp(4, 26, h * (0.4 + 0.6 * m.moisture)) * dur);
    const bursts = Array.from({ length: Math.min(40, Math.max(2, count)) }, () => ({
      noiseMix: 1,
      delay: rnd() * dur,
      filter: { type: 'bandpass',
        freq: vary(lerp(1400, 6500, h) * lerp(1, 1.4, m.fat), 0.3),
        q: lerp(1.2, 3.4, m.fat) },
      adsr: { a: 0.001, d: vary(lerp(0.02, 0.09, m.moisture), 0.4), s: 0, r: 0.02 },
      gain: vary(lerp(0.02, 0.05, h) * lerp(0.7, 1.3, m.fat), 0.35),
    }));
    return def('cook_sizzle', dur + 0.3, [
      { noiseMix: 1,
        filter: { type: 'bandpass', freq: vary(lerp(1800, 5200, h), 0.15), q: 0.8 },
        adsr: { a: 0.08, d: dur * 0.7, s: 0.5, r: 0.25 },
        gain: vary(0.03 + 0.05 * h, 0.2) },
      ...bursts,
    ], 3);
  }

  // ── BOIL ─────────────────────────────────────────────────────────────────────
  // A liquid bed with bubble events over it. Simmer is sparse and low; a violent
  // boil is dense with real low-frequency weight.
  function boil({ heat = 0.5, duration = 1.4, material: mat = 'liquid', state = null } = {}) {
    const m = material(mat, state);
    const h = clamp01(heat);
    const dur = vary(duration, 0.1);
    const count = Math.round(lerp(3, 18, h) * dur);
    const bubbles = Array.from({ length: Math.min(28, Math.max(2, count)) }, () => {
      const f = vary(lerp(240, 1300, rnd()), 0.15);
      return {
        waveform: 'sine', freq: f, delay: rnd() * dur,
        pitchBend: { to: f * vary(1.35, 0.1), time: 0.05 },
        fm: { rate: f * vary(2.5, 0.3), depth: f * vary(0.6, 0.3) },
        adsr: { a: 0.002, d: vary(lerp(0.05, 0.2, m.viscosity), 0.4), s: 0, r: 0.05 },
        gain: vary(0.03 + 0.04 * h, 0.3),
      };
    });
    return def('cook_boil', dur + 0.3, [
      { noiseMix: 1,
        filter: { type: 'lowpass', freq: vary(lerp(220, 520, h), 0.2), q: 1.2 },
        adsr: { a: 0.1, d: dur * 0.7, s: 0.55, r: 0.3 },
        gain: vary(0.05 + 0.06 * h, 0.2) },
      ...bubbles,
    ], 3);
  }

  // ── The event vocabulary ─────────────────────────────────────────────────────
  //
  // One place mapping a semantic cooking event onto a generator. Anything that
  // emits this vocabulary — smithing, chemistry, repair — gets sound without
  // touching the generators above.
  // ── STREAM ───────────────────────────────────────────────────────────────────
  // A jet of liquid hitting a surface, scaled by how much pressure is behind it.
  //
  // This is the generator that proves the system isn't cooking-specific. The old
  // hand-authored version sounded identical whether you were bursting or barely
  // needed to go, because the only inputs were the surface and a phase. Pressure
  // is the interesting variable and it was the one missing: a full bladder is a
  // hard, high, tight jet that splatters; an almost-empty one is a low, loose,
  // intermittent dribble that barely reaches.
  //
  //   phase: 'start' | 'steady' | 'fade' | 'dribble'
  const STREAM_SURFACES = {
    water:    { main: 700, high: 3400, splash: 2300, body: 150, hiGain: 0.10, splashGain: 0.13 },
    concrete: { main: 900, high: 4200, splash: 3100, body: 120, hiGain: 0.13, splashGain: 0.17 },
    soft:     { main: 520, high: 2400, splash: 1500, body: 110, hiGain: 0.06, splashGain: 0.07 },
    body:     { main: 620, high: 2800, splash: 1800, body: 130, hiGain: 0.08, splashGain: 0.10 },
  };

  function stream({ surface: surf = 'water', intensity = 0.6, phase = 'steady', duration = 1.1 } = {}) {
    const s = STREAM_SURFACES[surf] || STREAM_SURFACES.water;
    const i = clamp01(intensity);
    const start = phase === 'start', fade = phase === 'fade', dribbling = phase === 'dribble';

    // Pressure raises the pitch of the jet, tightens it, and drives the splash.
    // A weak stream is broader, lower and quieter, and barely splatters at all.
    const jet = vary(s.main * lerp(0.62, 1.25, i), 0.06);
    const flutter = vary(lerp(11, 5, i), 0.2);   // slack streams wobble; hard ones are steady
    const gain = lerp(0.07, 0.30, i);

    if (dribbling) {
      // The tail. A few discrete spurts rather than a jet — and the fuller you
      // were, the longer it takes to finish, which is the joke doing real work.
      const spurts = Math.max(1, Math.round(lerp(1, 5, i)));
      return def('sfx_stream_dribble', 0.35 + spurts * 0.22, Array.from({ length: spurts }, (_, n) => ({
        noiseMix: 1,
        delay: n * vary(0.2, 0.35),
        filter: { type: 'bandpass', freq: vary(s.main * lerp(0.5, 0.85, i), 0.2), q: 1.3 },
        adsr: { a: 0.01, d: vary(0.1, 0.3), s: 0, r: 0.08 },
        gain: vary(gain * 0.5 * (1 - n / (spurts + 1)), 0.2),
      })), 3);
    }

    const dur = fade ? 1.3 : duration;
    return def(fade ? 'sfx_stream_fade' : 'sfx_stream', dur, [
      // The body of the jet.
      { noiseMix: 1, filter: { type: 'bandpass', freq: jet, q: lerp(0.4, 0.75, i) },
        tremolo: { rate: start ? flutter * 1.5 : flutter, depth: start ? 0.18 : lerp(0.16, 0.05, i) },
        adsr: fade ? { a: 0.05, d: 0.5, s: 0.15, r: 0.7 }
                   : { a: start ? 0.2 : 0.12, d: 0.1, s: 0.95, r: 0.22 },
        gain: fade ? gain * 0.8 : gain },
      // Airy edge — only really present once there's pressure behind it.
      i > 0.25 && { noiseMix: 1, filter: { type: 'highpass', freq: vary(s.high * lerp(0.7, 1.15, i), 0.1), q: 0.5 },
        adsr: fade ? { a: 0.05, d: 0.5, s: 0.1, r: 0.7 } : { a: start ? 0.06 : 0.14, d: 0.1, s: 0.92, r: 0.22 },
        gain: s.hiGain * i },
      // Splatter where it lands. A dribble doesn't splash.
      !fade && i > 0.3 && { noiseMix: 1, filter: { type: 'bandpass', freq: vary(s.splash, 0.12), q: 0.9 },
        tremolo: { rate: flutter * 1.7, depth: 0.25 },
        adsr: { a: start ? 0.14 : 0.12, d: 0.1, s: 0.85, r: 0.2 },
        gain: s.splashGain * i },
      // Low body of it striking the surface.
      !fade && { waveform: 'sine', freq: start ? s.body * 1.5 : s.body,
        pitchBend: start ? { to: s.body, time: 0.4 } : undefined,
        fm: { rate: s.body * 0.25, depth: s.body * 0.15 },
        adsr: { a: start ? 0.08 : 0.12, d: 0.1, s: 0.9, r: 0.22 },
        gain: 0.05 * lerp(0.5, 1, i) },
    ], 3);
  }

  // ── MICROWAVE ────────────────────────────────────────────────────────────────
  //
  // Not a loop — the audio engine's one-shots are the cheap path, and a cooking
  // session has no tick to ride anyway. Instead it's a short cue built from a
  // small number of turntable REVOLUTIONS: a steady mains hum with a slow wobble
  // riding it, plus one soft mechanical knock per revolution where the cracked
  // plate goes past the same point. Three of those reads as "it's running"
  // without pretending to run for the whole cook.
  function microwave({ revolutions = 3, intensity = 0.6, duration = 1.1, phase = 'running' } = {}) {
    const i = clamp01(intensity);

    // THE BEEP. Three short, flat, identical tones — the one sound in this file
    // that must NOT vary much, because a microwave finishing is a machine
    // announcing itself, not a physical event. The tiny wobble is the cheap
    // piezo drifting, nothing more.
    if (phase === 'done') {
      const tone = vary(2050, 0.015);
      const gap = 0.19;
      return def('cook_microwave_done', gap * 3 + 0.25, Array.from({ length: 3 }, (_, n) => ({
        waveform: 'square', freq: tone, delay: n * gap,
        filter: { type: 'bandpass', freq: tone, q: 6 },
        adsr: { a: 0.002, d: 0.02, s: 0.9, r: 0.02 },
        gain: 0.075,
      })), 5);
    }

    const spin = vary(duration, 0.1);          // one revolution
    const total = spin * revolutions;
    // Mains hum. 50 Hz and its harmonic, because that is what a transformer does.
    const hum = vary(50, 0.04);
    const layers = [
      { waveform: 'sawtooth', freq: hum,
        fm: { rate: hum * 2, depth: hum * lerp(0.5, 1.4, i) },
        filter: { type: 'lowpass', freq: vary(340, 0.15), q: 1.6 },
        // The slow wobble IS the turntable — one cycle per revolution.
        tremolo: { rate: 1 / spin, depth: 0.22 },
        adsr: { a: 0.06, d: 0.2, s: 0.9, r: 0.25 },
        gain: vary(0.05 + 0.05 * i, 0.12) },
      { noiseMix: 1,
        filter: { type: 'bandpass', freq: vary(1100, 0.2), q: 0.7 },
        tremolo: { rate: 1 / spin, depth: 0.3 },
        adsr: { a: 0.08, d: 0.2, s: 0.75, r: 0.3 },
        gain: vary(0.022 + 0.02 * i, 0.15) },
    ];
    // One knock per revolution, at the same point each time — a cracked plate
    // catching. Slightly varied so it isn't a metronome.
    for (let n = 0; n < revolutions; n++) {
      layers.push({
        waveform: 'triangle', freq: vary(220, 0.1), delay: n * spin + spin * 0.82,
        filter: { type: 'bandpass', freq: vary(300, 0.15), q: 2.2 },
        adsr: { a: 0.002, d: vary(0.05, 0.3), s: 0, r: 0.04 },
        gain: vary(0.05, 0.2),
      });
    }
    return def('cook_microwave', total + 0.3, layers, 3);
  }

  // ── FLATUS ───────────────────────────────────────────────────────────────────
  //
  // Pressure alone was not enough. Scaling one shape by intensity made every fart
  // the same fart, just longer and lower — and the whole comic value of the thing
  // is that you never quite know which one you're going to get.
  //
  // So there are two axes. PRESSURE (how badly you needed it) sets the register
  // and the length; STYLE picks the shape, and the shape is what makes it a joke
  // rather than a parameter. Styles are multipliers over the same generator, not
  // bespoke sounds — adding one is a row in this table, not a new function.
  //
  //   pitch    ×  base frequency          pulses  discrete bursts (1 = one continuous note)
  //   dur      ×  length                  buzz    × tremolo rate (low = flappy, high = tight)
  //   depth    ×  tremolo depth           noise   × the airy/wet layer
  //   bend     ×  how far the pitch falls  gain   × loudness
  //   min/max  what pressure it can occur at, so an empty gut can't produce a drone
  const FLATUS_STYLES = {
    // The classic. Mid register, decisive, over quickly.
    brassy:   { pitch: 1.00, dur: 1.00, buzz: 1.00, depth: 1.00, bend: 1.00, noise: 1.0, gain: 1.00, pulses: 1, min: 0.2, max: 1 },
    // High, thin, deeply undignified. Only when there's barely anything there.
    squeak:   { pitch: 2.05, dur: 0.45, buzz: 1.55, depth: 0.75, bend: 1.35, noise: 0.5, gain: 0.70, pulses: 1, min: 0,   max: 0.55 },
    // Long, low, and far too confident.
    drone:    { pitch: 0.80, dur: 1.85, buzz: 0.62, depth: 1.10, bend: 0.70, noise: 1.1, gain: 1.05, pulses: 1, min: 0.5, max: 1 },
    // Loose and flappy — the low buzz rate is what makes it sound wet.
    flutter:  { pitch: 0.88, dur: 1.25, buzz: 0.42, depth: 1.35, bend: 0.85, noise: 1.5, gain: 0.95, pulses: 1, min: 0.3, max: 1 },
    // Several separate reports. Ridiculous, and the best one.
    staccato: { pitch: 1.15, dur: 0.30, buzz: 1.25, depth: 0.90, bend: 1.10, noise: 0.8, gain: 0.90, pulses: 4, min: 0.35, max: 1 },
    // Two goes: a short one, a pause, then the real one.
    falter:   { pitch: 1.05, dur: 0.55, buzz: 1.10, depth: 1.00, bend: 1.00, noise: 1.0, gain: 0.85, pulses: 2, min: 0.25, max: 0.9 },
    // Almost no tone at all. Quiet, long, and the room finds out later.
    silent:   { pitch: 0.70, dur: 1.50, buzz: 0.30, depth: 0.45, bend: 0.60, noise: 3.2, gain: 0.32, pulses: 1, min: 0.2, max: 1 },
    // Fast, hard, aggressive. Needs real pressure behind it.
    ripper:   { pitch: 0.95, dur: 0.85, buzz: 1.85, depth: 1.25, bend: 1.20, noise: 1.2, gain: 1.20, pulses: 1, min: 0.6, max: 1 },
  };

  // Pick a style the current pressure can actually produce. Seeded, so the client
  // rebuilds whatever the server rolled.
  function pickFlatusStyle(i) {
    const eligible = Object.keys(FLATUS_STYLES).filter(k => i >= FLATUS_STYLES[k].min && i <= FLATUS_STYLES[k].max);
    if (!eligible.length) return 'brassy';
    return eligible[Math.floor(rnd() * eligible.length)];
  }

  function flatus({ intensity = 0.5, style = null } = {}) {
    const i = clamp01(intensity);
    const name = (style && FLATUS_STYLES[style]) ? style : pickFlatusStyle(i);
    const st = FLATUS_STYLES[name];

    // Pressure sets the register and length; the style bends both.
    const base = vary(lerp(120, 68, i) * st.pitch, 0.12);
    const one = vary(lerp(0.35, 1.25, i) * st.dur, 0.15);
    const gap = one * vary(0.55, 0.3);
    const gain = lerp(0.22, 0.55, i) * st.gain;

    // A multi-pulse style is the same note fired more than once, each a little
    // different and a little smaller — not a separate generator.
    const layers = [];
    for (let n = 0; n < st.pulses; n++) {
      const at = n * (one + gap);
      const fall = n / Math.max(1, st.pulses);          // later pulses run out of steam
      const f = vary(base * (1 - fall * 0.18), 0.07);
      layers.push({
        waveform: 'sawtooth', freq: f, delay: at || undefined,
        pitchBend: { to: f * vary(lerp(0.85, 0.62, i) / st.bend, 0.08), time: one * 0.9 },
        tremolo: { rate: vary(lerp(26, 13, i) * st.buzz, 0.2), depth: clamp01(lerp(0.75, 0.95, i) * st.depth) },
        filter: { type: 'lowpass', freq: vary(lerp(780, 580, i) * st.pitch, 0.12), q: 1.3 },
        adsr: { a: 0.01, d: 0.15, s: 0.7, r: lerp(0.12, 0.32, i) },
        gain: gain * (1 - fall * 0.3),
      });
      layers.push({
        noiseMix: 1, delay: at || undefined,
        filter: { type: 'bandpass', freq: vary(lerp(450, 320, i) * st.pitch, 0.15), q: 1.4 },
        tremolo: { rate: vary(lerp(21, 12, i) * st.buzz, 0.2), depth: 0.7 },
        adsr: { a: 0.01, d: 0.15, s: 0.5, r: 0.15 },
        gain: lerp(0.08, 0.22, i) * st.noise * (1 - fall * 0.3),
      });
    }

    const total = st.pulses * one + (st.pulses - 1) * gap;
    const cue = def('sfx_fart', total + 0.25, layers, 4);
    cue.style = name;   // surfaced so callers can narrate what happened
    return cue;
  }

  // ── INSTRUMENTS ──────────────────────────────────────────────────────────────
  //
  // A struck/plucked musical note, as opposed to everything above it, which is
  // noise made by objects. Same machinery, same layer vocabulary, same "the
  // server sends semantics and the client builds the sound" contract — a note on
  // the wire is `{instrument, note, velocity}`, about 40 bytes, and every ear in
  // the room rebuilds the identical voice locally.
  //
  // DELIBERATELY FREE OF `vary()`. Every other generator here jitters itself so
  // the ninth chop doesn't sound machine-stamped. A note must not: two people
  // standing in the same room have to hear the SAME performance, and they build
  // it independently from the same three numbers. There is no seed on the wire
  // because there is nothing random to reproduce.
  //
  // The classic FM insight the whole table rests on: a modulation index that
  // COLLAPSES across the note is what reads as struck. High index at the attack
  // is the hammer/mallet — bright, inharmonic, metallic — and as it falls the
  // tone settles toward its carrier and rings. `fm.depthTo` in audio-engine.js
  // does exactly this, which is why a piano costs a table row and not a synth.
  //
  //   ratio      modulator frequency as a multiple of the note. Integer ratios
  //              are harmonic (piano, organ); non-integer go bell/metallic.
  //   index      modulation index at the attack, scaled by velocity
  //   indexEnd   where it collapses to — the sustained timbre
  //   bright     how much harder playing opens the index (velocity → timbre,
  //              which is the difference between a keyboard and a piano)
  //   decay      seconds at C4; scaled by `stretch` across the range
  //   stretch    how much longer low notes ring than high ones (1 = not at all)
  //   body       gain of a sub-octave layer under the fundamental
  //   hammer     gain of the noise transient at the attack
  //   wave       carrier waveform
  const INSTRUMENTS = {
    // Upright piano. Ratio 1 with a hard index collapse: the strike is bright
    // and complex, and a half-second later it is nearly a sine ringing out.
    piano:     { ratio: 1,    index: 2.6, indexEnd: 0.12, bright: 1.5, decay: 1.5, stretch: 2.4, body: 0.16, hammer: 0.05, wave: 'sine' },
    // Electric piano. Ratio 14:1 is the Rhodes trick — a high inharmonic
    // modulator over a sine gives the bell-in-the-attack that defines the sound.
    rhodes:    { ratio: 14,   index: 1.1, indexEnd: 0.04, bright: 2.2, decay: 1.9, stretch: 1.8, body: 0.10, hammer: 0.02, wave: 'sine' },
    // Music box / celeste. Non-integer ratio, very short bright attack, long
    // pure ring. Deliberately thin — no body layer.
    musicbox:  { ratio: 3.5,  index: 3.2, indexEnd: 0.02, bright: 1.2, decay: 2.6, stretch: 1.4, body: 0,    hammer: 0.08, wave: 'sine' },
    // Plucked string. Fast decay, index falls almost immediately, sawtooth
    // carrier for the buzz of a wound string.
    pluck:     { ratio: 2,    index: 1.8, indexEnd: 0.20, bright: 1.6, decay: 0.85, stretch: 1.9, body: 0.12, hammer: 0.06, wave: 'sawtooth' },
    // Tonewheel-ish organ. No collapse at all (index sits where it starts) and
    // a long flat sustain, which is what makes it read as blown rather than hit.
    organ:     { ratio: 1,    index: 0.5, indexEnd: 0.45, bright: 0.4, decay: 0.9, stretch: 1.1, body: 0.22, hammer: 0,    wave: 'sine' },
  };

  const SEMITONE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

  // Local copy rather than an import: this file is loaded as a plain <script> in
  // the client and as ESM on the server, and audio-engine.js is browser-only.
  // Same formula, same A440 reference — a disagreement here would be inaudible
  // to one listener and out of tune to another.
  function noteFreq(note) {
    if (typeof note === 'number') return Number.isFinite(note) ? note : null;
    const m = /^([A-G][#b]?)(-?\d+)$/.exec(String(note || '').trim());
    if (!m || SEMITONE[m[1]] === undefined) return null;
    return 440 * Math.pow(2, (((parseInt(m[2], 10) + 1) * 12 + SEMITONE[m[1]]) - 69) / 12);
  }

  function note({ instrument = 'piano', note: n = 'C4', velocity = 0.75 } = {}) {
    const ins = INSTRUMENTS[instrument] || INSTRUMENTS.piano;
    const freq = noteFreq(n);
    if (freq == null) return null;
    const v = clamp01(velocity);

    // Decay stretched across the range: a bass note rings, a treble note doesn't.
    // Measured in octaves either side of C4 so the curve is musical, not linear
    // in Hz — an octave down should always be the same amount longer.
    const octaves = Math.log2(freq / 261.63);
    const decay = ins.decay * Math.pow(ins.stretch, -octaves / 2);

    // Velocity opens the modulation index. This is the whole reason a piano
    // sounds different played hard rather than just louder, and it costs one
    // multiply — the layer builder already sweeps the index for us.
    const idx = ins.index * (1 + (v - 0.5) * ins.bright);

    return def(`note_${instrument}`, decay + 0.2, [
      // Carrier + collapsing modulator: the note itself.
      { waveform: ins.wave, freq,
        fm: { rate: freq * ins.ratio, depth: freq * idx, depthTo: freq * ins.indexEnd, time: decay * 0.25 },
        adsr: { a: 0.002, d: decay, s: 0, r: decay * 0.35 },
        gain: (0.10 + 0.20 * v) },
      // Sub-octave body. Not a second voice — it is the soundboard, and it is
      // why a low piano note has weight the carrier alone can't give it.
      ins.body > 0 && { waveform: 'sine', freq: freq / 2,
        adsr: { a: 0.004, d: decay * 0.8, s: 0, r: decay * 0.3 },
        gain: ins.body * (0.06 + 0.10 * v) },
      // Hammer/mechanism. A few milliseconds of filtered noise riding the
      // attack; inaudible on its own, and the note sounds synthetic without it.
      ins.hammer > 0 && { noiseMix: 1,
        filter: { type: 'bandpass', freq: Math.min(freq * 6, 7000), q: 1.2 },
        adsr: { a: 0.001, d: 0.02, s: 0, r: 0.02 },
        gain: ins.hammer * (0.3 + 0.7 * v) },
    ], 6);
  }

  // THE ENTRY POINT. Everything above is deterministic given `rnd`, so seeding
  // here is what makes the client's rebuild bit-identical to whatever the server
  // intended — and what makes a cue reproducible while someone is tuning it.
  //
  // No seed means "vary freely", which is what a purely client-side caller wants.
  function buildActionCue({ action, material: mat, intensity = 0.5, surface: surf, vessel, heat, flow, state, seed } = {}) {
    rnd = Number.isFinite(seed) ? mulberry32(seed) : Math.random;
    try {
      return _build({ action, material: mat, intensity, surface: surf, vessel, heat, flow, state });
    } finally {
      rnd = Math.random;   // never leave a seeded generator armed for the next caller
    }
  }

  function _build({ action, material: mat, intensity = 0.5, surface: surf, vessel, heat, flow, state } = {}) {
    switch (action) {
      case 'chop':    return chop({ material: mat, intensity, state });
      case 'impact':  return impact({ surface: surf || vessel || 'metal', intensity, weight: intensity });
      case 'scrape':  return scrape({ surface: surf || vessel || 'metal', intensity });
      case 'stir':    return stir({ material: mat, vessel, intensity, state });
      case 'pour':    return pour({ material: mat, flow: flow ?? intensity, state });
      case 'sizzle':  return sizzle({ material: mat, heat: heat ?? intensity, state });
      case 'boil':    return boil({ material: mat, heat: heat ?? intensity, state });
      case 'stream':  return stream({ surface: surf, intensity, phase: state, duration: flow });
      case 'flatus':  return flatus({ intensity, style: state });
      case 'microwave': return microwave({ intensity, revolutions: Math.max(1, Math.round(flow || 3)), phase: state || 'running' });
      // `state` carries the note name and `surface` the instrument, so a note
      // reaches the same one-argument entry point as everything else. Callers
      // that know they want a note should use buildNoteCue below instead.
      case 'note':    return note({ instrument: surf, note: state, velocity: intensity });
      default:        return null;
    }
  }



  // ── Dev-panel exposure ───────────────────────────────────────────────────────
  //
  // The tuning knobs of a procedural system are its TABLES, not its cues: there
  // is no single "chop" sound to edit, there is a hardness number that makes
  // every chop brighter. So the tables are surfaced as catalog entries and ride
  // the existing `interface_sfx` override plumbing — same fetch, same editor,
  // same persistence the poker cues already use. No new table, no new endpoint.
  //
  // Reserved ids, namespaced so they can never collide with a real cue.
  const TABLE_IDS = {
    'proc:materials': { name: 'Procedural — materials', ref: () => MATERIALS },
    'proc:surfaces': { name: 'Procedural — surfaces', ref: () => SURFACES },
    'proc:streams': { name: 'Procedural — stream surfaces', ref: () => STREAM_SURFACES },
    'proc:flatus': { name: 'Procedural — fart styles', ref: () => FLATUS_STYLES },
    'proc:instruments': { name: 'Procedural — instrument voices', ref: () => INSTRUMENTS },
  };

  function defaults() {
    return Object.entries(TABLE_IDS).map(([id, t]) => ({
      id, name: t.name, group: 'procedural', category: 'sfx', priority: 5,
      // The table IS the config. The panel's JSON editor edits it directly.
      config: JSON.parse(JSON.stringify(t.ref())),
    }));
  }

  // Merge saved overrides back over the live tables. Deliberately per-KEY rather
  // than wholesale replacement, so a builder who tunes one material doesn't have
  // to hand-maintain the other nine, and a new material added in code still
  // appears for someone carrying an old override.
  function applyOverrides(rows) {
    for (const r of Array.isArray(rows) ? rows : []) {
      const t = TABLE_IDS[r?.id];
      if (!t) continue;
      let cfg = r.config;
      if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch { continue; } }
      if (!cfg || typeof cfg !== 'object') continue;
      const table = t.ref();
      for (const [k, v] of Object.entries(cfg)) {
        if (v && typeof v === 'object') table[k] = { ...(table[k] || {}), ...v };
      }
    }
  }

  // A representative cue per action, so the panel's preview button can audition
  // the generators themselves rather than only the tables behind them.
  function previewCue(action, opts) {
    return buildActionCue({ action, intensity: 0.7, material: 'wet_meat', surface: 'metal', ...opts });
  }

  global.ProceduralSFX = {
    buildActionCue, defaults, applyOverrides, previewCue, TABLE_IDS,
    // Kept as an alias: the system started as cooking-only and the name is in
    // the regression suite and the docs. Same function.
    buildCookingCue: buildActionCue,
    MATERIALS, SURFACES, STATES, STREAM_SURFACES, FLATUS_STYLES, INSTRUMENTS,
    chop, impact, scrape, stir, pour, sizzle, boil, stream, flatus, microwave, note,
    // Musical notes have their own entry point rather than riding buildActionCue:
    // there is no seed (nothing is random) and the argument names are the ones a
    // caller actually has — instrument, note, velocity.
    buildNoteCue: (opts) => note(opts),
    noteFreq,
  };
})(typeof window !== 'undefined' ? window : globalThis);
