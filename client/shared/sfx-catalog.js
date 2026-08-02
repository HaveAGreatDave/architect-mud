/**
 * Interface / Game SFX catalog — the single source of truth for the procedural
 * one-shot sound effects the in-game minigames fire (poker table, the hacking
 * and lock minigames). These are synthesized in-browser through AudioEngine
 * (client/shared/audio-engine.js), wholly separate from the DB-driven world
 * "Sound" system and the DB audio library.
 *
 * Dual-mode like audio-engine.js / tagHelpers.js: attaches to window/globalThis
 * so it loads as a plain <script> in the devpanel (classic scripts) AND is
 * visible to the game client's ESM modules as a global.
 *
 * Each built-in cue has a stable `id` (e.g. 'poker-shuffle', 'hack-move'). The
 * dev panel (Sounds tab → Interface / Game SFX) edits these; edits are stored in
 * the `interface_sfx` table as *overrides* keyed by id, fetched at game boot and
 * layered on top of the built-ins via applyOverrides(). Callers resolve the
 * effective def with get(id) before handing it to AudioEngine.playSfx.
 */
(function (global) {

  // ── Poker helpers (mirror the originals in client/game/js/poker-sfx.js) ─────
  function knock(delay) {
    return [
      { waveform: 'triangle', freq: 170, delay, pitchBend: { to: 90, time: 0.05 },
        adsr: { a: 0.001, d: 0.07, s: 0, r: 0.04 }, gain: 0.5 },
      { waveform: 'noise', delay,
        filter: { type: 'lowpass', freq: 1600, q: 1 },
        adsr: { a: 0.001, d: 0.03, s: 0, r: 0.02 }, gain: 0.25 },
    ];
  }
  function chips(count, spread, gain) {
    return Array.from({ length: count }, (_, i) => ({
      waveform: 'sine', freq: 2400 + (i % 3) * 320, delay: (i / count) * spread,
      filter: { type: 'bandpass', freq: 2600, q: 3 },
      adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 }, gain,
    }));
  }

  // ── Built-in cues ───────────────────────────────────────────────────────────
  // group is a display bucket ('poker' | 'hack' | 'hololock' | 'vault'); category
  // routes the AudioEngine bus (all 'sfx' here so they answer the SFX volume).

  const BUILTINS = [
    // ── Poker table ──────────────────────────────────────────────────────────
    // Paper riffle — a soft low-passed swish bed under many gentle low-pitched
    // grains, deliberately quiet and un-clicky so it reads as cards fluttering
    // rather than a click train. Looped through the "SHUFFLING UP…" countdown.
    { id: 'poker-shuffle', name: 'Poker — shuffle', group: 'poker', category: 'sfx', priority: 6,
      config: {
        duration: 1.6,
        layers: [
          { waveform: 'noise', delay: 0, filter: { type: 'lowpass', freq: 1100, q: 0.6 },
            adsr: { a: 0.12, d: 0.5, s: 0.25, r: 0.4 }, gain: 0.05 },
          ...Array.from({ length: 22 }, (_, i) => ({
            waveform: 'noise', delay: 0.05 + i * 0.05,
            filter: { type: 'bandpass', freq: 760 + (i % 5) * 70, q: 0.8 },
            adsr: { a: 0.01, d: 0.045, s: 0, r: 0.05 }, gain: 0.055,
          })),
          { waveform: 'noise', delay: 1.15, filter: { type: 'lowpass', freq: 900, q: 0.6 },
            adsr: { a: 0.03, d: 0.2, s: 0, r: 0.14 }, gain: 0.06 },
        ],
      } },
    { id: 'poker-deal', name: 'Poker — deal', group: 'poker', category: 'sfx', priority: 6,
      config: {
        duration: 0.5,
        layers: [0, 0.13, 0.26, 0.39].map((d) => ({
          waveform: 'noise', delay: d,
          filter: { type: 'bandpass', freq: 3200, q: 1.4 },
          adsr: { a: 0.004, d: 0.06, s: 0, r: 0.03 }, gain: 0.35,
        })),
      } },
    { id: 'poker-check', name: 'Poker — check', group: 'poker', category: 'sfx', priority: 6,
      config: { duration: 0.1, layers: [...knock(0), ...knock(0.19)] } },
    { id: 'poker-call', name: 'Poker — call', group: 'poker', category: 'sfx', priority: 6,
      config: { duration: 0.25, layers: chips(4, 0.18, 0.28) } },
    { id: 'poker-raise', name: 'Poker — raise / bet', group: 'poker', category: 'sfx', priority: 6,
      config: { duration: 0.4, layers: chips(8, 0.34, 0.34) } },
    { id: 'poker-fold', name: 'Poker — fold', group: 'poker', category: 'sfx', priority: 5,
      config: {
        duration: 0.5,
        layers: [
          { waveform: 'triangle', freq: 330, delay: 0,
            adsr: { a: 0.02, d: 0.28, s: 0, r: 0.1 }, gain: 0.35 },
          { waveform: 'triangle', freq: 247, delay: 0.16,
            adsr: { a: 0.02, d: 0.34, s: 0, r: 0.12 }, gain: 0.32 },
        ],
      } },
    { id: 'poker-allin', name: 'Poker — all-in', group: 'poker', category: 'sfx', priority: 7,
      config: {
        duration: 0.6,
        layers: [
          { waveform: 'sine', freq: 120, delay: 0, pitchBend: { to: 60, time: 0.18 },
            adsr: { a: 0.002, d: 0.22, s: 0, r: 0.1 }, gain: 0.5 },
          { waveform: 'sawtooth', freq: 220, delay: 0.05, pitchBend: { to: 520, time: 0.4 },
            filter: { type: 'lowpass', freq: 1400, q: 3 },
            adsr: { a: 0.05, d: 0.4, s: 0.2, r: 0.15 }, gain: 0.11 },
          ...chips(14, 0.5, 0.32),
        ],
      } },
    { id: 'poker-turn', name: 'Poker — your turn', group: 'poker', category: 'sfx', priority: 6,
      config: {
        duration: 0.3,
        layers: [
          { waveform: 'sine', freq: 784, delay: 0,
            adsr: { a: 0.005, d: 0.12, s: 0, r: 0.08 }, gain: 0.2 },
          { waveform: 'sine', freq: 1046.5, delay: 0.09,
            adsr: { a: 0.005, d: 0.16, s: 0, r: 0.1 }, gain: 0.18 },
          { waveform: 'triangle', freq: 2093, delay: 0.09,
            adsr: { a: 0.005, d: 0.1, s: 0, r: 0.06 }, gain: 0.05 },
        ],
      } },
    { id: 'poker-win', name: 'Poker — win', group: 'poker', category: 'sfx', priority: 8,
      config: {
        duration: 1.0,
        layers: [
          [523.25, 0], [659.25, 0.09], [783.99, 0.18],
        ].flatMap(([freq, delay]) => ([
          { waveform: 'triangle', freq, delay,
            filter: { type: 'lowpass', freq: 2200, q: 0.5 },
            adsr: { a: 0.03, d: 0.18, s: 0.35, r: 0.55 }, gain: 0.2 },
          { waveform: 'sine', freq: freq * 2, delay: delay + 0.02,
            adsr: { a: 0.04, d: 0.2, s: 0.15, r: 0.45 }, gain: 0.07 },
        ])),
      } },
    { id: 'poker-broke', name: 'Poker — busted / broke', group: 'poker', category: 'sfx', priority: 7,
      config: {
        duration: 0.55,
        layers: [
          [262, 0], [247, 0.42], [233, 0.84], [196, 1.28],
        ].map(([freq, delay], i) => ({
          waveform: 'sawtooth', freq, delay,
          pitchBend: { to: freq * 0.94, time: 0.3 },
          filter: { type: 'lowpass', freq: 1100, q: 2 },
          vibrato: { rate: 6, depth: 8 },
          adsr: { a: 0.03, d: i === 3 ? 0.8 : 0.36, s: 0, r: 0.2 }, gain: 0.34,
        })),
      } },

    // ── Circuit Breach (hacking) ─────────────────────────────────────────────
    { id: 'hack-entry', name: 'Circuit Breach — jack in', group: 'hack', category: 'sfx', priority: 4,
      config: { duration: 0.5, layers: [
        { waveform: 'triangle', freq: 90, pitchBend: { to: 480, time: 0.4 }, filter: { type: 'lowpass', freq: 2400, q: 1 }, adsr: { a: 0.02, d: 0.25, s: 0.3, r: 0.15 }, gain: 0.2 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 3000, q: 0.8 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.04 }, gain: 0.12 },
      ] } },
    { id: 'hack-plug', name: 'Circuit Breach — connector seats', group: 'hack', category: 'sfx', priority: 4,
      config: { duration: 0.9, layers: [
        // Servo slide as the plug travels toward the port.
        { waveform: 'sawtooth', freq: 240, pitchBend: { to: 120, time: 0.5 }, filter: { type: 'lowpass', freq: 1400, q: 1 }, adsr: { a: 0.02, d: 0.5, s: 0.2, r: 0.1 }, gain: 0.1 },
        // Seat thunk — the prongs bottom out in the socket (~0.6s in, matching the visual).
        { waveform: 'triangle', freq: 130, delay: 0.6, pitchBend: { to: 55, time: 0.1 }, adsr: { a: 0.001, d: 0.12, s: 0, r: 0.09 }, gain: 0.42 },
        { waveform: 'noise', noiseMix: 1, delay: 0.6, filter: { type: 'bandpass', freq: 850, q: 1.2 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.05 }, gain: 0.32 },
        // Contact click — pins make.
        { waveform: 'square', freq: 1700, delay: 0.66, filter: { type: 'bandpass', freq: 1900, q: 5 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 }, gain: 0.13 },
      ] } },
    { id: 'hack-move', name: 'Circuit Breach — hop node', group: 'hack', category: 'sfx', priority: 5,
      config: { duration: 0.05, layers: [ { waveform: 'square', freq: 620, adsr: { a: 0.002, d: 0.04, s: 0, r: 0.03 }, filter: { type: 'bandpass', freq: 640, q: 4 }, gain: 0.16 } ] } },
    { id: 'hack-boost', name: 'Circuit Breach — boost', group: 'hack', category: 'sfx', priority: 5,
      config: { duration: 0.16, layers: [ { waveform: 'square', freq: 740, pitchBend: { to: 1180, time: 0.12 }, adsr: { a: 0.003, d: 0.12, s: 0.1, r: 0.05 }, filter: { type: 'bandpass', freq: 1000, q: 3 }, gain: 0.16 } ] } },
    { id: 'hack-alarm', name: 'Circuit Breach — alarm', group: 'hack', category: 'sfx', priority: 6,
      config: { duration: 0.4, layers: [
        { waveform: 'sawtooth', freq: 300, pitchBend: { to: 90, time: 0.35 }, filter: { type: 'lowpass', freq: 1400, q: 1 }, adsr: { a: 0.005, d: 0.2, s: 0.3, r: 0.3 }, gain: 0.22 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 220, q: 2 }, adsr: { a: 0.001, d: 0.09, s: 0, r: 0.06 }, gain: 0.5 },
      ] } },
    { id: 'hack-ping', name: 'Circuit Breach — sensor ping', group: 'hack', category: 'sfx', priority: 6,
      config: { duration: 0.5, layers: [
        { waveform: 'sine', freq: 520, pitchBend: { to: 1400, time: 0.22 }, adsr: { a: 0.01, d: 0.2, s: 0.2, r: 0.2 }, gain: 0.22 },
        { waveform: 'sine', freq: 1400, delay: 0.22, pitchBend: { to: 520, time: 0.24 }, adsr: { a: 0.01, d: 0.22, s: 0, r: 0.15 }, gain: 0.14 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2200, q: 3 }, adsr: { a: 0.002, d: 0.06, s: 0, r: 0.04 }, gain: 0.1 },
      ] } },
    { id: 'hack-force', name: 'Circuit Breach — force gate', group: 'hack', category: 'sfx', priority: 7,
      config: { duration: 0.5, layers: [
        { waveform: 'triangle', freq: 90, pitchBend: { to: 40, time: 0.2 }, adsr: { a: 0.001, d: 0.18, s: 0, r: 0.15 }, gain: 0.45 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 500, q: 1.5 }, adsr: { a: 0.001, d: 0.1, s: 0, r: 0.1 }, gain: 0.4 },
        { waveform: 'noise', noiseMix: 1, delay: 0.08, filter: { type: 'highpass', freq: 3500, q: 1 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.05 }, gain: 0.2 },
      ] } },
    { id: 'hack-win', name: 'Circuit Breach — access granted', group: 'hack', category: 'sfx', priority: 8,
      config: { duration: 0.65, layers: [
        { waveform: 'square', freq: 380, pitchBend: { to: 1600, time: 0.22 }, filter: { type: 'lowpass', freq: 5000, q: 1 }, adsr: { a: 0.005, d: 0.18, s: 0.1, r: 0.08 }, gain: 0.18 },
        { waveform: 'square', freq: 1800, delay: 0.24, adsr: { a: 0.003, d: 0.07, s: 0, r: 0.05 }, filter: { type: 'bandpass', freq: 1800, q: 4 }, gain: 0.22 },
        { waveform: 'square', freq: 2400, delay: 0.34, adsr: { a: 0.003, d: 0.09, s: 0, r: 0.08 }, filter: { type: 'bandpass', freq: 2400, q: 5 }, gain: 0.2 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 4000, q: 0.6 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.04 }, gain: 0.08 },
      ] } },
    { id: 'hack-lose', name: 'Circuit Breach — connection severed', group: 'hack', category: 'sfx', priority: 8,
      config: { duration: 0.6, layers: [
        { waveform: 'sawtooth', freq: 160, pitchBend: { to: 40, time: 0.45 }, filter: { type: 'lowpass', freq: 800, q: 1 }, adsr: { a: 0.01, d: 0.25, s: 0.3, r: 0.3 }, gain: 0.22 },
        { waveform: 'noise', noiseMix: 1, delay: 0.08, filter: { type: 'highpass', freq: 2800, q: 1 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 }, gain: 0.3 },
        { waveform: 'noise', noiseMix: 1, delay: 0.2, filter: { type: 'highpass', freq: 2000, q: 1 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.04 }, gain: 0.26 },
        { waveform: 'square', freq: 70, delay: 0.05, pitchBend: { to: 25, time: 0.4 }, adsr: { a: 0.01, d: 0.3, s: 0.2, r: 0.3 }, gain: 0.14 },
      ] } },

    // ── Hololock Bypass ──────────────────────────────────────────────────────
    { id: 'hololock-entry', name: 'Hololock — engage', group: 'hololock', category: 'sfx', priority: 4,
      config: { duration: 0.4, layers: [
        { waveform: 'triangle', freq: 120, pitchBend: { to: 520, time: 0.32 }, filter: { type: 'lowpass', freq: 2200, q: 1 }, adsr: { a: 0.02, d: 0.2, s: 0.2, r: 0.12 }, gain: 0.18 } ] } },
    { id: 'hololock-set', name: 'Hololock — pin set', group: 'hololock', category: 'sfx', priority: 6,
      config: { duration: 0.12, layers: [
        { waveform: 'square', freq: 880, pitchBend: { to: 1320, time: 0.08 }, adsr: { a: 0.002, d: 0.09, s: 0, r: 0.04 }, filter: { type: 'bandpass', freq: 1200, q: 4 }, gain: 0.18 } ] } },
    { id: 'hololock-miss', name: 'Hololock — miss', group: 'hololock', category: 'sfx', priority: 6,
      config: { duration: 0.18, layers: [
        { waveform: 'sawtooth', freq: 200, pitchBend: { to: 70, time: 0.16 }, filter: { type: 'lowpass', freq: 1000, q: 1 }, adsr: { a: 0.003, d: 0.12, s: 0, r: 0.06 }, gain: 0.2 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 300, q: 2 }, adsr: { a: 0.001, d: 0.07, s: 0, r: 0.05 }, gain: 0.28 } ] } },
    { id: 'hololock-win', name: 'Hololock — bypassed', group: 'hololock', category: 'sfx', priority: 8,
      config: { duration: 0.6, layers: [
        { waveform: 'square', freq: 420, pitchBend: { to: 1680, time: 0.22 }, filter: { type: 'lowpass', freq: 5000, q: 1 }, adsr: { a: 0.005, d: 0.16, s: 0.1, r: 0.08 }, gain: 0.16 },
        { waveform: 'square', freq: 2000, delay: 0.24, adsr: { a: 0.003, d: 0.08, s: 0, r: 0.06 }, filter: { type: 'bandpass', freq: 2000, q: 5 }, gain: 0.2 } ] } },
    { id: 'hololock-lose', name: 'Hololock — lockout', group: 'hololock', category: 'sfx', priority: 8,
      config: { duration: 0.55, layers: [
        { waveform: 'sawtooth', freq: 170, pitchBend: { to: 40, time: 0.42 }, filter: { type: 'lowpass', freq: 800, q: 1 }, adsr: { a: 0.01, d: 0.24, s: 0.3, r: 0.28 }, gain: 0.22 },
        { waveform: 'noise', noiseMix: 1, delay: 0.06, filter: { type: 'highpass', freq: 2600, q: 1 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 }, gain: 0.28 } ] } },

    // ── Vault Crack ──────────────────────────────────────────────────────────
    { id: 'vault-entry', name: 'Vault — approach', group: 'vault', category: 'sfx', priority: 4,
      config: { duration: 0.5, layers: [
        { waveform: 'triangle', freq: 70, pitchBend: { to: 300, time: 0.4 }, filter: { type: 'lowpass', freq: 1600, q: 1 }, adsr: { a: 0.02, d: 0.26, s: 0.2, r: 0.14 }, gain: 0.2 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 900, q: 1.2 }, adsr: { a: 0.001, d: 0.4, s: 0, r: 0.1 }, gain: 0.06 } ] } },
    { id: 'vault-tick', name: 'Vault — dial tick', group: 'vault', category: 'sfx', priority: 3,
      config: { duration: 0.04, layers: [
        { waveform: 'square', freq: 1500, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.01 }, filter: { type: 'bandpass', freq: 1800, q: 6 }, gain: 0.06 } ] } },
    { id: 'vault-set', name: 'Vault — tumbler drops', group: 'vault', category: 'sfx', priority: 6,
      config: { duration: 0.2, layers: [
        { waveform: 'triangle', freq: 220, pitchBend: { to: 90, time: 0.12 }, adsr: { a: 0.002, d: 0.16, s: 0, r: 0.05 }, filter: { type: 'lowpass', freq: 1400, q: 1 }, gain: 0.28 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 260, q: 2 }, adsr: { a: 0.001, d: 0.08, s: 0, r: 0.04 }, gain: 0.22 } ] } },
    { id: 'vault-slip', name: 'Vault — cam slips', group: 'vault', category: 'sfx', priority: 6,
      config: { duration: 0.24, layers: [
        { waveform: 'sawtooth', freq: 420, pitchBend: { to: 130, time: 0.2 }, filter: { type: 'bandpass', freq: 900, q: 2 }, adsr: { a: 0.002, d: 0.16, s: 0, r: 0.06 }, gain: 0.2 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 2200, q: 1 }, adsr: { a: 0.001, d: 0.1, s: 0, r: 0.05 }, gain: 0.24 } ] } },
    { id: 'vault-win', name: 'Vault — bolt retracts', group: 'vault', category: 'sfx', priority: 8,
      config: { duration: 0.7, layers: [
        { waveform: 'square', freq: 320, pitchBend: { to: 1200, time: 0.24 }, filter: { type: 'lowpass', freq: 4200, q: 1 }, adsr: { a: 0.005, d: 0.18, s: 0.1, r: 0.08 }, gain: 0.16 },
        { waveform: 'triangle', freq: 150, delay: 0.3, pitchBend: { to: 60, time: 0.22 }, adsr: { a: 0.002, d: 0.24, s: 0, r: 0.1 }, gain: 0.34 },
        { waveform: 'noise', noiseMix: 1, delay: 0.3, filter: { type: 'bandpass', freq: 220, q: 1.5 }, adsr: { a: 0.001, d: 0.12, s: 0, r: 0.06 }, gain: 0.2 } ] } },
    { id: 'vault-lose', name: 'Vault — tamper lockout', group: 'vault', category: 'sfx', priority: 8,
      config: { duration: 0.55, layers: [
        { waveform: 'sawtooth', freq: 180, pitchBend: { to: 44, time: 0.42 }, filter: { type: 'lowpass', freq: 800, q: 1 }, adsr: { a: 0.01, d: 0.24, s: 0.3, r: 0.26 }, gain: 0.22 },
        { waveform: 'noise', noiseMix: 1, delay: 0.05, filter: { type: 'highpass', freq: 2600, q: 1 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.04 }, gain: 0.28 } ] } },

    // ── Synth Lab (cook / splice) ────────────────────────────────────────────
    // The burner roar itself is a live loop (kept local in synthlab.js so its
    // gain can be ridden with the flame); these are the one-shot cues around it.
    { id: 'synth-entry', name: 'Synth Lab — chamber online', group: 'synth', category: 'sfx', priority: 4,
      config: { duration: 0.6, layers: [
        { waveform: 'triangle', freq: 80, pitchBend: { to: 360, time: 0.45 }, filter: { type: 'lowpass', freq: 2200, q: 1 }, adsr: { a: 0.03, d: 0.3, s: 0.25, r: 0.18 }, gain: 0.18 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1200, q: 0.8 }, adsr: { a: 0.08, d: 0.4, s: 0, r: 0.1 }, gain: 0.05 } ] } },
    { id: 'synth-ignite', name: 'Synth Lab — burner ignites', group: 'synth', category: 'sfx', priority: 5,
      config: { duration: 0.35, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 620, q: 1 }, adsr: { a: 0.015, d: 0.28, s: 0, r: 0.08 }, gain: 0.22 },
        { waveform: 'sine', freq: 130, pitchBend: { to: 60, time: 0.2 }, adsr: { a: 0.005, d: 0.2, s: 0, r: 0.08 }, gain: 0.2 } ] } },
    { id: 'synth-inband', name: 'Synth Lab — reaction stabilises', group: 'synth', category: 'sfx', priority: 6,
      config: { duration: 0.25, layers: [
        { waveform: 'sine', freq: 660, adsr: { a: 0.005, d: 0.14, s: 0, r: 0.08 }, gain: 0.13 },
        { waveform: 'sine', freq: 990, delay: 0.05, adsr: { a: 0.005, d: 0.16, s: 0, r: 0.1 }, gain: 0.09 } ] } },
    { id: 'synth-outband', name: 'Synth Lab — reaction drifts', group: 'synth', category: 'sfx', priority: 5,
      config: { duration: 0.18, layers: [
        { waveform: 'sine', freq: 300, pitchBend: { to: 175, time: 0.14 }, adsr: { a: 0.004, d: 0.12, s: 0, r: 0.05 }, gain: 0.09 } ] } },
    { id: 'synth-good', name: 'Synth Lab — clean cook', group: 'synth', category: 'sfx', priority: 8,
      config: { duration: 0.9, layers: [
        [523.25, 0], [659.25, 0.1], [783.99, 0.2], [1046.5, 0.32],
      ].flatMap(([freq, delay]) => ([
        { waveform: 'triangle', freq, delay, filter: { type: 'lowpass', freq: 2600, q: 0.5 }, adsr: { a: 0.02, d: 0.16, s: 0.3, r: 0.5 }, gain: 0.16 },
        { waveform: 'sine', freq: freq * 2, delay: delay + 0.02, adsr: { a: 0.03, d: 0.18, s: 0.12, r: 0.4 }, gain: 0.05 },
      ])) } },
    { id: 'synth-bad', name: 'Synth Lab — botched batch', group: 'synth', category: 'sfx', priority: 8,
      config: { duration: 0.75, layers: [
        { waveform: 'sawtooth', freq: 200, pitchBend: { to: 58, time: 0.5 }, filter: { type: 'lowpass', freq: 1000, q: 1 }, adsr: { a: 0.01, d: 0.3, s: 0.3, r: 0.25 }, gain: 0.2 },
        { waveform: 'noise', noiseMix: 1, delay: 0.06, filter: { type: 'bandpass', freq: 800, q: 1 }, adsr: { a: 0.02, d: 0.5, s: 0, r: 0.1 }, gain: 0.13 } ] } },

    // ── Flight (cockpit / takeoff / landing) ─────────────────────────────────
    // A grounded-real avionics register: engine spin-up, a takeoff-roll rumble,
    // a positive rotation chirp, a warning warble, a flare cue, tyre chirp on
    // touchdown, and the crash. The cockpit panel fires these by id.
    { id: 'flight-startup', name: 'Flight — engine start', group: 'flight', category: 'sfx', priority: 4,
      config: { duration: 0.8, layers: [
        { waveform: 'sawtooth', freq: 34, pitchBend: { to: 128, time: 0.7 }, filter: { type: 'lowpass', freq: 900, q: 1 }, adsr: { a: 0.06, d: 0.5, s: 0.4, r: 0.18 }, gain: 0.2 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 520, q: 0.7 }, adsr: { a: 0.1, d: 0.55, s: 0.2, r: 0.14 }, gain: 0.08 } ] } },
    { id: 'flight-roll', name: 'Flight — takeoff roll', group: 'flight', category: 'sfx', priority: 4,
      config: { duration: 0.6, layers: [
        { waveform: 'sawtooth', freq: 96, pitchBend: { to: 150, time: 0.5 }, filter: { type: 'lowpass', freq: 1100, q: 1 }, adsr: { a: 0.04, d: 0.4, s: 0.3, r: 0.14 }, gain: 0.16 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 760, q: 0.8 }, adsr: { a: 0.05, d: 0.45, s: 0.25, r: 0.1 }, gain: 0.1 } ] } },
    { id: 'flight-rotate', name: 'Flight — rotate / liftoff', group: 'flight', category: 'sfx', priority: 8,
      config: { duration: 0.55, layers: [
        { waveform: 'triangle', freq: 260, pitchBend: { to: 900, time: 0.34 }, filter: { type: 'lowpass', freq: 4200, q: 1 }, adsr: { a: 0.006, d: 0.18, s: 0.15, r: 0.12 }, gain: 0.16 },
        { waveform: 'sine', freq: 1500, delay: 0.24, adsr: { a: 0.004, d: 0.1, s: 0, r: 0.06 }, filter: { type: 'bandpass', freq: 1600, q: 4 }, gain: 0.14 } ] } },
    { id: 'flight-abort', name: 'Flight — abort / overrun', group: 'flight', category: 'sfx', priority: 6,
      config: { duration: 0.5, layers: [
        { waveform: 'sawtooth', freq: 240, pitchBend: { to: 70, time: 0.4 }, filter: { type: 'lowpass', freq: 1000, q: 1 }, adsr: { a: 0.004, d: 0.3, s: 0.1, r: 0.1 }, gain: 0.2 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 420, q: 1.5 }, adsr: { a: 0.002, d: 0.22, s: 0, r: 0.08 }, gain: 0.18 } ] } },
    { id: 'flight-warn', name: 'Flight — warning warble', group: 'flight', category: 'sfx', priority: 7,
      config: { duration: 0.3, layers: [
        { waveform: 'square', freq: 720, pitchBend: { to: 520, time: 0.12 }, adsr: { a: 0.003, d: 0.1, s: 0.2, r: 0.05 }, filter: { type: 'bandpass', freq: 900, q: 3 }, gain: 0.13 },
        { waveform: 'square', freq: 720, delay: 0.16, pitchBend: { to: 520, time: 0.12 }, adsr: { a: 0.003, d: 0.1, s: 0, r: 0.05 }, filter: { type: 'bandpass', freq: 900, q: 3 }, gain: 0.13 } ] } },
    { id: 'flight-approach', name: 'Flight — approach', group: 'flight', category: 'sfx', priority: 4,
      config: { duration: 0.5, layers: [
        { waveform: 'triangle', freq: 150, pitchBend: { to: 90, time: 0.4 }, filter: { type: 'lowpass', freq: 1400, q: 1 }, adsr: { a: 0.03, d: 0.28, s: 0.2, r: 0.14 }, gain: 0.16 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 700, q: 0.9 }, adsr: { a: 0.06, d: 0.4, s: 0, r: 0.1 }, gain: 0.05 } ] } },
    { id: 'flight-flare', name: 'Flight — flare cue', group: 'flight', category: 'sfx', priority: 6,
      config: { duration: 0.16, layers: [
        { waveform: 'sine', freq: 640, pitchBend: { to: 960, time: 0.1 }, adsr: { a: 0.003, d: 0.11, s: 0, r: 0.04 }, gain: 0.14 } ] } },
    { id: 'flight-touchdown', name: 'Flight — touchdown', group: 'flight', category: 'sfx', priority: 8,
      config: { duration: 0.4, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 320, q: 1.4 }, adsr: { a: 0.002, d: 0.12, s: 0, r: 0.06 }, gain: 0.2 },
        { waveform: 'sine', freq: 520, delay: 0.06, adsr: { a: 0.004, d: 0.12, s: 0, r: 0.06 }, gain: 0.1 },
        { waveform: 'sine', freq: 660, delay: 0.16, adsr: { a: 0.004, d: 0.12, s: 0, r: 0.06 }, gain: 0.09 } ] } },
    { id: 'flight-crash', name: 'Flight — crash', group: 'flight', category: 'sfx', priority: 8,
      config: { duration: 0.85, layers: [
        { waveform: 'sawtooth', freq: 150, pitchBend: { to: 34, time: 0.5 }, filter: { type: 'lowpass', freq: 700, q: 1 }, adsr: { a: 0.005, d: 0.4, s: 0.3, r: 0.3 }, gain: 0.24 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 480, q: 0.7 }, adsr: { a: 0.002, d: 0.5, s: 0.2, r: 0.2 }, gain: 0.2 } ] } },
    { id: 'flight-lock', name: 'Flight — target lock', group: 'flight', category: 'sfx', priority: 6,
      config: { duration: 0.35, layers: [
        { waveform: 'square', freq: 1320, adsr: { a: 0.002, d: 0.05, s: 0.6, r: 0.06 }, filter: { type: 'bandpass', freq: 1400, q: 5 }, gain: 0.08 },
        { waveform: 'square', freq: 1320, delay: 0.12, adsr: { a: 0.002, d: 0.05, s: 0.6, r: 0.06 }, filter: { type: 'bandpass', freq: 1400, q: 5 }, gain: 0.08 } ] } },
    { id: 'flight-guns', name: 'Flight — cannon burst', group: 'flight', category: 'sfx', priority: 8,
      config: { duration: 0.5, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 900, q: 1 }, adsr: { a: 0.001, d: 0.45, s: 0, r: 0.05 }, gain: 0.14 },
        { waveform: 'sawtooth', freq: 90, pitchBend: { to: 50, time: 0.4 }, adsr: { a: 0.001, d: 0.4, s: 0, r: 0.05 }, gain: 0.16 } ] } },

    // ── Fishing (cast / reel) ────────────────────────────────────────────────
    // The reel ratchet as you wind the power up (rising click density is faked
    // with a short bandpassed-noise burst under a climbing tone).
    { id: 'fishing-charge', name: 'Fishing — reel charge', group: 'fishing', category: 'sfx', priority: 5,
      config: { duration: 0.4, layers: [
        { waveform: 'square', freq: 240, pitchBend: { to: 620, time: 0.34 }, filter: { type: 'bandpass', freq: 1400, q: 3 }, adsr: { a: 0.01, d: 0.3, s: 0.2, r: 0.08 }, gain: 0.07 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2600, q: 1.4 }, adsr: { a: 0.02, d: 0.3, s: 0.1, r: 0.06 }, gain: 0.05 } ] } },
    // The cast release — line paying out off the reel: an airy whip that falls away.
    { id: 'fishing-cast', name: 'Fishing — cast away', group: 'fishing', category: 'sfx', priority: 6,
      config: { duration: 0.42, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 1700, q: 0.7 }, adsr: { a: 0.005, d: 0.3, s: 0, r: 0.08 }, gain: 0.13 },
        { waveform: 'triangle', freq: 900, pitchBend: { to: 280, time: 0.3 }, filter: { type: 'bandpass', freq: 1200, q: 1 }, adsr: { a: 0.004, d: 0.26, s: 0, r: 0.08 }, gain: 0.10 } ] } },
    // The float plops onto the water — a fast pitch-drop body under a soft splash.
    { id: 'fishing-splash', name: 'Fishing — float lands', group: 'fishing', category: 'sfx', priority: 5,
      config: { duration: 0.34, layers: [
        { waveform: 'sine', freq: 420, pitchBend: { to: 90, time: 0.06 }, adsr: { a: 0.001, d: 0.12, s: 0, r: 0.05 }, gain: 0.3 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 1400, q: 1 }, adsr: { a: 0.001, d: 0.18, s: 0, r: 0.08 }, gain: 0.16 },
        { waveform: 'noise', noiseMix: 1, delay: 0.05, filter: { type: 'highpass', freq: 3000, q: 0.8 }, adsr: { a: 0.001, d: 0.1, s: 0, r: 0.05 }, gain: 0.07 } ] } },
    // FISH ON — the take: a hard upward yank, a water burst, an alert ping.
    { id: 'fishing-bite', name: 'Fishing — the strike', group: 'fishing', category: 'sfx', priority: 8,
      config: { duration: 0.5, layers: [
        { waveform: 'sawtooth', freq: 150, pitchBend: { to: 520, time: 0.12 }, filter: { type: 'lowpass', freq: 2600, q: 1 }, adsr: { a: 0.002, d: 0.16, s: 0.1, r: 0.1 }, gain: 0.16 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 900, q: 1 }, adsr: { a: 0.001, d: 0.2, s: 0, r: 0.08 }, gain: 0.2 },
        { waveform: 'square', freq: 1200, delay: 0.14, filter: { type: 'bandpass', freq: 1400, q: 5 }, adsr: { a: 0.002, d: 0.08, s: 0, r: 0.05 }, gain: 0.11 } ] } },
    // A single reel click as you engage the drag and start winding in.
    { id: 'fishing-reel', name: 'Fishing — reel bite', group: 'fishing', category: 'sfx', priority: 4,
      config: { duration: 0.1, layers: [
        { waveform: 'square', freq: 620, pitchBend: { to: 900, time: 0.06 }, filter: { type: 'bandpass', freq: 1600, q: 5 }, adsr: { a: 0.002, d: 0.07, s: 0, r: 0.03 }, gain: 0.08 } ] } },
    // Landed — a rising resolve, then the slab slaps onto the dock.
    { id: 'fishing-land', name: 'Fishing — landed', group: 'fishing', category: 'sfx', priority: 8,
      config: { duration: 0.7, layers: [
        { waveform: 'square', freq: 440, pitchBend: { to: 1320, time: 0.22 }, filter: { type: 'lowpass', freq: 5000, q: 1 }, adsr: { a: 0.005, d: 0.16, s: 0.1, r: 0.08 }, gain: 0.13 },
        { waveform: 'triangle', freq: 180, delay: 0.28, pitchBend: { to: 70, time: 0.2 }, adsr: { a: 0.002, d: 0.22, s: 0, r: 0.1 }, gain: 0.3 },
        { waveform: 'noise', noiseMix: 1, delay: 0.28, filter: { type: 'lowpass', freq: 900, q: 1 }, adsr: { a: 0.001, d: 0.12, s: 0, r: 0.06 }, gain: 0.16 } ] } },
    // The line snaps — a sharp twang/crack, then a low sinking-away.
    { id: 'fishing-snap', name: 'Fishing — line snaps', group: 'fishing', category: 'sfx', priority: 8,
      config: { duration: 0.46, layers: [
        { waveform: 'sawtooth', freq: 800, pitchBend: { to: 120, time: 0.1 }, filter: { type: 'bandpass', freq: 1400, q: 3 }, adsr: { a: 0.001, d: 0.14, s: 0, r: 0.05 }, gain: 0.2 },
        { waveform: 'noise', noiseMix: 1, delay: 0.04, filter: { type: 'highpass', freq: 2400, q: 1 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.03 }, gain: 0.2 },
        { waveform: 'triangle', freq: 160, delay: 0.08, pitchBend: { to: 50, time: 0.3 }, adsr: { a: 0.005, d: 0.24, s: 0.2, r: 0.2 }, gain: 0.15 } ] } },

    // ── Dialogue panel ───────────────────────────────────────────────────────
    // Conversation furniture, all deliberately under the threshold of "an alert":
    // these fire on every talk and every option click, so they read as weight and
    // presence, never as notification. Gains are the lowest in the catalog on
    // purpose — see DIALOGUE_SFX_GAIN in client/game/js/panels/dialogue.js.
    //
    // open — a low body thunk (the conversation taking the floor) under a short
    // breathy swell. No pitch rise: rising = "menu opened", flat = "someone turned
    // to face you".
    { id: 'dialogue-open', name: 'Dialogue — engage', group: 'dialogue', category: 'sfx', priority: 5,
      config: { duration: 0.3, layers: [
        { waveform: 'triangle', freq: 120, pitchBend: { to: 84, time: 0.14 }, adsr: { a: 0.004, d: 0.2, s: 0, r: 0.09 }, gain: 0.3 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 700, q: 1.2 }, adsr: { a: 0.02, d: 0.12, s: 0, r: 0.07 }, gain: 0.1 } ] } },
    // line — the pip that lands as the speaker starts talking, timed with the
    // first characters of the typewriter reveal. One soft mid pip, nothing more.
    { id: 'dialogue-line', name: 'Dialogue — speaker begins', group: 'dialogue', category: 'sfx', priority: 4,
      config: { duration: 0.1, layers: [
        { waveform: 'sine', freq: 660, adsr: { a: 0.003, d: 0.07, s: 0, r: 0.04 }, gain: 0.11 },
        { waveform: 'sine', freq: 990, delay: 0.015, adsr: { a: 0.003, d: 0.05, s: 0, r: 0.03 }, gain: 0.05 } ] } },
    // opt — a dry key press. Short enough to spam through a fast conversation.
    { id: 'dialogue-opt', name: 'Dialogue — choose line', group: 'dialogue', category: 'sfx', priority: 5,
      config: { duration: 0.08, layers: [
        { waveform: 'square', freq: 380, pitchBend: { to: 300, time: 0.03 }, filter: { type: 'lowpass', freq: 2200, q: 1 }, adsr: { a: 0.001, d: 0.04, s: 0, r: 0.02 }, gain: 0.16 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 3000, q: 1 }, adsr: { a: 0.001, d: 0.02, s: 0, r: 0.015 }, gain: 0.07 } ] } },
    // close — the open thunk, inverted and shorter: the floor handed back.
    { id: 'dialogue-close', name: 'Dialogue — disengage', group: 'dialogue', category: 'sfx', priority: 5,
      config: { duration: 0.22, layers: [
        { waveform: 'triangle', freq: 150, pitchBend: { to: 62, time: 0.16 }, adsr: { a: 0.003, d: 0.16, s: 0, r: 0.07 }, gain: 0.24 } ] } },

    // ── Accolades ────────────────────────────────────────────────────────────
    // "Reach & relax": three glass bells, C5 → G5 → F5.
    //
    // The "glass" set is partials at x1, 2.00, 3.01 and 4.97 — pushed back toward
    // whole numbers, so it is sweeter and more consonant than a tubular bell
    // (whose x1.41/2.76 ratios clang). Nearer a glockenspiel. Higher partials get
    // proportionally shorter decays, which is what makes a struck thing sound
    // struck rather than merely played.
    //
    // The SHAPE is the joke: it overshoots up to the fifth and then settles back
    // onto the fourth. Effort, then a shrug — it never fully resolves, because the
    // entry copy underneath is never congratulating you. The first two notes are
    // short and quiet; the third lands 235ms in and rings for a second.
    //
    // CHORUS is on the third note only. Beating needs time to develop, and the
    // first two notes are ~0.34s — too short to hear it. Detuned twins at ±9 cents
    // on the two loudest partials give the ringing note a slow shimmer for two
    // extra oscillators instead of doubling the whole cue.
    //
    // SHIMMER is timed to the visual sparks (accolades-banner.js): a bright cluster
    // in the first 60ms under the spark burst, then single high twinkles at 300 /
    // 600 / 900ms matching the trickle interval, so each one lands with a fresh
    // glint on screen. All drawn from the F chord so they stay musical, and quiet
    // enough (0.010–0.016) to read as sparkle rather than melody.
    //
    // `duration` is the SUSTAIN HOLD, not the total: these partials have s:0 and
    // decay on their own, so the hold is near-zero deliberately and the voice frees
    // early while the tail rings out. Total audible length is ~1.3s.
    { id: 'accolade-unlock', name: 'Accolades — entry logged', group: 'accolades', category: 'sfx', priority: 9,
      config: { duration: 0.05, layers: [
        // Note 1 — C5. The reach begins. Carries the sub.
        { waveform: 'sine',     freq: 523,  adsr: { a: 0.003, d: 0.34,  s: 0,    r: 0.102 }, gain: 0.075 },
        { waveform: 'sine',     freq: 1047, adsr: { a: 0.005, d: 0.238, s: 0,    r: 0.071 }, gain: 0.041 },
        { waveform: 'triangle', freq: 1575, adsr: { a: 0.007, d: 0.177, s: 0,    r: 0.053 }, gain: 0.026 },
        { waveform: 'sine',     freq: 2601, adsr: { a: 0.009, d: 0.116, s: 0,    r: 0.035 }, gain: 0.011 },
        { waveform: 'sine',     freq: 262,  adsr: { a: 0.012, d: 0.204, s: 0.14, r: 0.153 }, gain: 0.032 },
        // Note 2 — G5 at 110ms. The overshoot.
        { waveform: 'sine',     freq: 784,  delay: 0.11, adsr: { a: 0.003, d: 0.36,  s: 0, r: 0.108 }, gain: 0.085 },
        { waveform: 'sine',     freq: 1568, delay: 0.11, adsr: { a: 0.005, d: 0.252, s: 0, r: 0.076 }, gain: 0.047 },
        { waveform: 'triangle', freq: 2360, delay: 0.11, adsr: { a: 0.007, d: 0.187, s: 0, r: 0.056 }, gain: 0.029 },
        { waveform: 'sine',     freq: 3896, delay: 0.11, adsr: { a: 0.009, d: 0.122, s: 0, r: 0.037 }, gain: 0.013 },
        // Note 3 — F5 at 235ms. Settles, and rings. Chorused twins on the two
        // loudest partials (±9 cents) so the long tail shimmers instead of sitting still.
        { waveform: 'sine',     freq: 698,  delay: 0.235, adsr: { a: 0.003, d: 1.05,  s: 0, r: 0.315 }, gain: 0.100 },
        { waveform: 'sine',     freq: 698,  delay: 0.235, detune: 9,  adsr: { a: 0.004, d: 1.05,  s: 0, r: 0.315 }, gain: 0.052 },
        { waveform: 'sine',     freq: 1397, delay: 0.235, adsr: { a: 0.005, d: 0.735, s: 0, r: 0.221 }, gain: 0.055 },
        { waveform: 'sine',     freq: 1397, delay: 0.235, detune: -9, adsr: { a: 0.006, d: 0.735, s: 0, r: 0.221 }, gain: 0.028 },
        { waveform: 'triangle', freq: 2102, delay: 0.235, adsr: { a: 0.007, d: 0.546, s: 0, r: 0.164 }, gain: 0.034 },
        { waveform: 'sine',     freq: 3471, delay: 0.235, adsr: { a: 0.009, d: 0.357, s: 0, r: 0.107 }, gain: 0.015 },
        // Shimmer — synced to the spark burst (0ms) and the trickle (300/600/900ms).
        { waveform: 'sine', freq: 2794, delay: 0.010, adsr: { a: 0.004, d: 0.20, s: 0, r: 0.09 }, gain: 0.016 },
        { waveform: 'sine', freq: 3520, delay: 0.032, adsr: { a: 0.004, d: 0.17, s: 0, r: 0.08 }, gain: 0.013 },
        { waveform: 'sine', freq: 4186, delay: 0.056, adsr: { a: 0.004, d: 0.14, s: 0, r: 0.07 }, gain: 0.010 },
        { waveform: 'sine', freq: 2794, delay: 0.300, adsr: { a: 0.004, d: 0.16, s: 0, r: 0.08 }, gain: 0.013 },
        { waveform: 'sine', freq: 3520, delay: 0.600, adsr: { a: 0.004, d: 0.15, s: 0, r: 0.07 }, gain: 0.011 },
        { waveform: 'sine', freq: 4186, delay: 0.900, adsr: { a: 0.004, d: 0.13, s: 0, r: 0.06 }, gain: 0.009 } ] } },

    // ── Trading cards (machine + pack opening) ───────────────────────────────
    // The whole point of this set is ESCALATION: a common flips with a dry paper
    // tick and nothing else, and every rung above it adds a layer rather than
    // swapping to a different sound. So the ear learns the ladder — you know
    // you've hit something before you can read the card, which is the only way
    // the reveal animation has anything to land on.
    { id: 'cards-vend', name: 'Cards — machine vends a sleeve', group: 'cards', category: 'sfx', priority: 6,
      config: { duration: 0.5, layers: [
        // Solenoid clunk, auger turn, then the sleeve hitting the tray flap.
        { waveform: 'square', freq: 120, pitchBend: { to: 54, time: 0.09 }, filter: { type: 'lowpass', freq: 900, q: 1 }, adsr: { a: 0.001, d: 0.1, s: 0, r: 0.06 }, gain: 0.36 },
        { waveform: 'noise', noiseMix: 1, delay: 0.06, filter: { type: 'bandpass', freq: 620, q: 1.2 }, adsr: { a: 0.02, d: 0.16, s: 0.2, r: 0.1 }, gain: 0.16 },
        { waveform: 'triangle', freq: 210, delay: 0.28, pitchBend: { to: 130, time: 0.07 }, adsr: { a: 0.001, d: 0.09, s: 0, r: 0.06 }, gain: 0.26 },
        { waveform: 'noise', noiseMix: 1, delay: 0.3, filter: { type: 'highpass', freq: 2600, q: 0.8 }, adsr: { a: 0.001, d: 0.07, s: 0, r: 0.05 }, gain: 0.14 } ] } },

    // ── The vend, as a MECHANISM ─────────────────────────────────────────────
    // The cabinet's four moving parts get four cues, played in sequence by the
    // panel as the sleeve travels: coil turns, sleeve is caught, belt carries it
    // across, chute drops it and the flap bangs. They are deliberately SHORT and
    // dry — this is machinery in a shop, not a fanfare — and they are sequenced
    // rather than mixed, so one set of four covers a vend of any length.
    //
    // `cards-vend` above stays exactly as it was and is now the ACCEPT: the thump
    // of the machine taking your money, before any of this runs.
    { id: 'cards-coil', name: 'Cards — the coil turns', group: 'cards', category: 'sfx', priority: 6,
      config: { duration: 0.8, layers: [
        // Motor: a low saw under a lowpass, spinning up and settling.
        { waveform: 'sawtooth', freq: 62, pitchBend: { to: 94, time: 0.14 }, filter: { type: 'lowpass', freq: 420, q: 3 }, adsr: { a: 0.03, d: 0.1, s: 0.7, r: 0.16 }, gain: 0.1 },
        // Ratchet — the auger's teeth passing. Eight clicks IS the turn; the ear
        // counts them, which is what makes the coil look like it moved.
        ...Array.from({ length: 8 }, (_, i) => ({
          waveform: 'noise', noiseMix: 1, delay: 0.05 + i * 0.062,
          filter: { type: 'bandpass', freq: 1500 + (i % 3) * 260, q: 6 },
          adsr: { a: 0.001, d: 0.024, s: 0, r: 0.018 }, gain: 0.075,
        })),
        { waveform: 'triangle', freq: 150, delay: 0.56, pitchBend: { to: 98, time: 0.06 }, adsr: { a: 0.001, d: 0.07, s: 0, r: 0.05 }, gain: 0.09 } ] } },

    // Caught. A soft foil slap on sprung metal — body first, then the paddle
    // ringing off it. Doubles as the sound of anything light landing in the
    // cabinet, which is why it is not named for the sleeve.
    { id: 'cards-catch', name: 'Cards — caught by the paddle', group: 'cards', category: 'sfx', priority: 5,
      config: { duration: 0.34, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 900, q: 1.1 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.05 }, gain: 0.16 },
        { waveform: 'triangle', freq: 320, pitchBend: { to: 210, time: 0.05 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.05 }, gain: 0.1 },
        { waveform: 'sine', freq: 1180, delay: 0.02, adsr: { a: 0.002, d: 0.16, s: 0, r: 0.1 }, gain: 0.035 } ] } },

    // The belt. Filtered noise with a slow tremolo-ish envelope and a rubber
    // seam ticking past twice — cheap, and unmistakably a conveyor.
    { id: 'cards-belt', name: 'Cards — the belt carries it across', group: 'cards', category: 'sfx', priority: 4,
      config: { duration: 0.9, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 700, q: 1.4 }, adsr: { a: 0.06, d: 0.1, s: 0.75, r: 0.2 }, gain: 0.09 },
        { waveform: 'sawtooth', freq: 84, filter: { type: 'lowpass', freq: 300, q: 2 }, adsr: { a: 0.05, d: 0.1, s: 0.6, r: 0.18 }, gain: 0.055 },
        { waveform: 'noise', noiseMix: 1, delay: 0.24, filter: { type: 'bandpass', freq: 1250, q: 5 }, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.02 }, gain: 0.055 },
        { waveform: 'noise', noiseMix: 1, delay: 0.56, filter: { type: 'bandpass', freq: 1250, q: 5 }, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.02 }, gain: 0.055 } ] } },

    // The chute and the flap. The tumble is a scrape, the flap is a sprung metal
    // BANG, and the two together are the payoff the whole cabinet exists for.
    { id: 'cards-chute', name: 'Cards — down the chute, flap bangs', group: 'cards', category: 'sfx', priority: 7,
      config: { duration: 0.7, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1700, q: 0.9 }, adsr: { a: 0.01, d: 0.16, s: 0.2, r: 0.1 }, gain: 0.12 },
        { waveform: 'square', freq: 190, delay: 0.2, pitchBend: { to: 76, time: 0.07 }, filter: { type: 'lowpass', freq: 1200, q: 1.2 }, adsr: { a: 0.001, d: 0.11, s: 0, r: 0.08 }, gain: 0.3 },
        { waveform: 'noise', noiseMix: 1, delay: 0.2, filter: { type: 'highpass', freq: 2800, q: 0.8 }, adsr: { a: 0.001, d: 0.07, s: 0, r: 0.05 }, gain: 0.13 },
        // The flap swinging back and settling.
        { waveform: 'triangle', freq: 240, delay: 0.36, pitchBend: { to: 160, time: 0.06 }, adsr: { a: 0.001, d: 0.08, s: 0, r: 0.06 }, gain: 0.1 },
        { waveform: 'triangle', freq: 200, delay: 0.5, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.05 }, gain: 0.05 } ] } },

    // ── panel interaction ────────────────────────────────────────────────────
    // ONE tick for every affordance in the cabinet — selecting a coil, pressing a
    // button, closing the panel. Deliberately generic and deliberately tiny: a
    // distinct sound per control would make the machine chatty, and a UI cue that
    // reuses itself is one a player stops hearing and starts feeling.
    { id: 'cards-ui', name: 'Cards — panel tick', group: 'cards', category: 'sfx', priority: 3,
      config: { duration: 0.1, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2600, q: 3.5 }, adsr: { a: 0.001, d: 0.025, s: 0, r: 0.02 }, gain: 0.09 },
        { waveform: 'sine', freq: 1046, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 }, gain: 0.045 } ] } },

    // Refused — an empty coil, a disabled button, not enough credit. A flat
    // detuned pair, the sound every vending machine in the world makes at you.
    { id: 'cards-deny', name: 'Cards — machine refuses', group: 'cards', category: 'sfx', priority: 5,
      config: { duration: 0.32, layers: [
        { waveform: 'square', freq: 196, filter: { type: 'lowpass', freq: 1400, q: 1 }, adsr: { a: 0.002, d: 0.1, s: 0.3, r: 0.08 }, gain: 0.07 },
        { waveform: 'square', freq: 185, filter: { type: 'lowpass', freq: 1400, q: 1 }, adsr: { a: 0.002, d: 0.1, s: 0.3, r: 0.08 }, gain: 0.07 } ] } },

    // The gold under the foil. Fires between the tear and the first card, so it
    // has to read as a REVALUATION rather than a win — a bright rising fifth
    // over a shimmer, deliberately shorter and less final than a legendary flip,
    // because it is a promise about the cards rather than one of them.
    { id: 'cards-hot', name: 'Cards — the sleeve runs hot', group: 'cards', category: 'sfx', priority: 9,
      config: { duration: 1.2, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 3200, q: 0.8 }, adsr: { a: 0.18, d: 0.3, s: 0, r: 0.2 }, gain: 0.08 },
        { waveform: 'sine', freq: 659, delay: 0.02, adsr: { a: 0.004, d: 0.4, s: 0, r: 0.2 }, gain: 0.09 },
        { waveform: 'sine', freq: 988, delay: 0.13, adsr: { a: 0.004, d: 0.5, s: 0, r: 0.26 }, gain: 0.09 },
        { waveform: 'sine', freq: 1319, delay: 0.24, adsr: { a: 0.004, d: 0.75, s: 0, r: 0.36 }, gain: 0.085 },
        { waveform: 'sine', freq: 1319, delay: 0.24, detune: 9, adsr: { a: 0.005, d: 0.75, s: 0, r: 0.36 }, gain: 0.044 },
        { waveform: 'triangle', freq: 2637, delay: 0.28, adsr: { a: 0.006, d: 0.5, s: 0, r: 0.24 }, gain: 0.022 },
        { waveform: 'sine', freq: 3951, delay: 0.42, adsr: { a: 0.004, d: 0.24, s: 0, r: 0.12 }, gain: 0.013 },
        { waveform: 'sine', freq: 3520, delay: 0.66, adsr: { a: 0.004, d: 0.2, s: 0, r: 0.1 }, gain: 0.011 } ] } },

    // Foil, not paper: a bright band-passed rip that CLIMBS as the seam runs,
    // with the crinkle grains riding on top rather than under it.
    { id: 'cards-tear', name: 'Cards — foil sleeve tears', group: 'cards', category: 'sfx', priority: 8,
      config: { duration: 0.66, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1800, q: 0.7 }, adsr: { a: 0.01, d: 0.34, s: 0.3, r: 0.2 }, gain: 0.3 },
        { waveform: 'noise', noiseMix: 1, delay: 0.02, filter: { type: 'highpass', freq: 4200, q: 0.9 }, adsr: { a: 0.02, d: 0.3, s: 0.25, r: 0.22 }, gain: 0.2 },
        ...Array.from({ length: 9 }, (_, i) => ({
          waveform: 'noise', noiseMix: 1, delay: 0.03 + i * 0.048,
          filter: { type: 'bandpass', freq: 3000 + i * 420, q: 4 },
          adsr: { a: 0.001, d: 0.035, s: 0, r: 0.025 }, gain: 0.11 - i * 0.007,
        })),
        // The foil finally giving and the stack shifting inside.
        { waveform: 'noise', noiseMix: 1, delay: 0.45, filter: { type: 'lowpass', freq: 1500, q: 0.7 }, adsr: { a: 0.005, d: 0.14, s: 0, r: 0.1 }, gain: 0.18 } ] } },

    { id: 'cards-slide', name: 'Cards — card slides off the stack', group: 'cards', category: 'sfx', priority: 4,
      config: { duration: 0.22, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1250, q: 1.1 }, adsr: { a: 0.012, d: 0.11, s: 0, r: 0.07 }, gain: 0.13 },
        { waveform: 'noise', noiseMix: 1, delay: 0.05, filter: { type: 'highpass', freq: 3400, q: 0.8 }, adsr: { a: 0.006, d: 0.07, s: 0, r: 0.05 }, gain: 0.07 } ] } },

    // Common — a dry tick and nothing more. This is the floor the ladder is
    // measured from, so it must be genuinely unexciting.
    { id: 'cards-flip-common', name: 'Cards — flip (common)', group: 'cards', category: 'sfx', priority: 4,
      config: { duration: 0.16, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2100, q: 2 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.035 }, gain: 0.15 },
        { waveform: 'triangle', freq: 300, pitchBend: { to: 190, time: 0.04 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 }, gain: 0.1 } ] } },

    // Uncommon — the same tick, plus one clean note. First rung.
    { id: 'cards-flip-uncommon', name: 'Cards — flip (uncommon)', group: 'cards', category: 'sfx', priority: 5,
      config: { duration: 0.34, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2200, q: 2 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.035 }, gain: 0.14 },
        { waveform: 'sine', freq: 784, delay: 0.03, adsr: { a: 0.004, d: 0.22, s: 0, r: 0.1 }, gain: 0.075 },
        { waveform: 'sine', freq: 1568, delay: 0.03, adsr: { a: 0.006, d: 0.15, s: 0, r: 0.08 }, gain: 0.03 } ] } },

    // Rare — a two-note lift with a bell partial over it.
    { id: 'cards-flip-rare', name: 'Cards — flip (rare)', group: 'cards', category: 'sfx', priority: 6,
      config: { duration: 0.6, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2400, q: 2 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.035 }, gain: 0.14 },
        { waveform: 'sine', freq: 784, delay: 0.02, adsr: { a: 0.004, d: 0.26, s: 0, r: 0.12 }, gain: 0.085 },
        { waveform: 'sine', freq: 1175, delay: 0.13, adsr: { a: 0.004, d: 0.42, s: 0, r: 0.2 }, gain: 0.085 },
        { waveform: 'sine', freq: 2350, delay: 0.13, adsr: { a: 0.006, d: 0.3, s: 0, r: 0.14 }, gain: 0.035 },
        { waveform: 'triangle', freq: 3520, delay: 0.15, adsr: { a: 0.005, d: 0.2, s: 0, r: 0.1 }, gain: 0.016 } ] } },

    // Epic — three notes, chorused tail, and a sub under it so it has weight.
    { id: 'cards-flip-epic', name: 'Cards — flip (epic)', group: 'cards', category: 'sfx', priority: 8,
      config: { duration: 1.0, layers: [
        { waveform: 'sine', freq: 196, adsr: { a: 0.006, d: 0.5, s: 0.12, r: 0.3 }, gain: 0.1 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2600, q: 2 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.04 }, gain: 0.13 },
        { waveform: 'sine', freq: 784, delay: 0.02, adsr: { a: 0.004, d: 0.3, s: 0, r: 0.14 }, gain: 0.085 },
        { waveform: 'sine', freq: 1175, delay: 0.12, adsr: { a: 0.004, d: 0.34, s: 0, r: 0.16 }, gain: 0.09 },
        { waveform: 'sine', freq: 1568, delay: 0.24, adsr: { a: 0.004, d: 0.8, s: 0, r: 0.36 }, gain: 0.095 },
        { waveform: 'sine', freq: 1568, delay: 0.24, detune: 11, adsr: { a: 0.005, d: 0.8, s: 0, r: 0.36 }, gain: 0.05 },
        { waveform: 'triangle', freq: 3136, delay: 0.26, adsr: { a: 0.006, d: 0.5, s: 0, r: 0.24 }, gain: 0.028 },
        { waveform: 'sine', freq: 4186, delay: 0.34, adsr: { a: 0.005, d: 0.3, s: 0, r: 0.14 }, gain: 0.013 } ] } },

    // Legendary — a riser that ARRIVES. The 0.42s ramp is the animation's cue to
    // hold the card back; the chord lands with the card, not before it.
    { id: 'cards-flip-legendary', name: 'Cards — flip (legendary)', group: 'cards', category: 'sfx', priority: 9,
      config: { duration: 1.5, layers: [
        // Riser.
        { waveform: 'sawtooth', freq: 90, pitchBend: { to: 700, time: 0.42 }, filter: { type: 'lowpass', freq: 2600, q: 2 }, adsr: { a: 0.1, d: 0.3, s: 0.5, r: 0.12 }, gain: 0.11 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 2000, q: 0.8 }, adsr: { a: 0.3, d: 0.14, s: 0, r: 0.1 }, gain: 0.09 },
        // Impact.
        { waveform: 'sine', freq: 98, delay: 0.44, adsr: { a: 0.004, d: 0.7, s: 0.1, r: 0.4 }, gain: 0.15 },
        { waveform: 'noise', noiseMix: 1, delay: 0.44, filter: { type: 'lowpass', freq: 700, q: 1 }, adsr: { a: 0.001, d: 0.16, s: 0, r: 0.12 }, gain: 0.16 },
        // Chord — root/fifth/octave, chorused, ringing well past the impact.
        { waveform: 'sine', freq: 587, delay: 0.46, adsr: { a: 0.005, d: 0.95, s: 0, r: 0.42 }, gain: 0.1 },
        { waveform: 'sine', freq: 880, delay: 0.46, adsr: { a: 0.005, d: 1.0, s: 0, r: 0.45 }, gain: 0.1 },
        { waveform: 'sine', freq: 880, delay: 0.46, detune: -10, adsr: { a: 0.006, d: 1.0, s: 0, r: 0.45 }, gain: 0.052 },
        { waveform: 'sine', freq: 1175, delay: 0.48, adsr: { a: 0.005, d: 1.1, s: 0, r: 0.5 }, gain: 0.09 },
        { waveform: 'triangle', freq: 1760, delay: 0.5, adsr: { a: 0.007, d: 0.7, s: 0, r: 0.34 }, gain: 0.03 },
        // Glints on the ray sweep.
        { waveform: 'sine', freq: 3520, delay: 0.62, adsr: { a: 0.004, d: 0.2, s: 0, r: 0.1 }, gain: 0.014 },
        { waveform: 'sine', freq: 4186, delay: 0.8, adsr: { a: 0.004, d: 0.18, s: 0, r: 0.09 }, gain: 0.012 },
        { waveform: 'sine', freq: 2794, delay: 1.0, adsr: { a: 0.004, d: 0.16, s: 0, r: 0.08 }, gain: 0.011 } ] } },

    // Architect — admin issue, off the ladder entirely. Reuses the legendary
    // shape one octave down so it reads as heavier rather than louder.
    { id: 'cards-flip-architect', name: 'Cards — flip (architect)', group: 'cards', category: 'sfx', priority: 9,
      config: { duration: 1.6, layers: [
        { waveform: 'sawtooth', freq: 60, pitchBend: { to: 420, time: 0.5 }, filter: { type: 'lowpass', freq: 1800, q: 2.4 }, adsr: { a: 0.12, d: 0.34, s: 0.5, r: 0.14 }, gain: 0.12 },
        { waveform: 'sine', freq: 65, delay: 0.52, adsr: { a: 0.004, d: 0.9, s: 0.12, r: 0.5 }, gain: 0.16 },
        { waveform: 'sine', freq: 294, delay: 0.54, adsr: { a: 0.006, d: 1.2, s: 0, r: 0.55 }, gain: 0.1 },
        { waveform: 'sine', freq: 440, delay: 0.54, detune: 8, adsr: { a: 0.006, d: 1.2, s: 0, r: 0.55 }, gain: 0.09 },
        { waveform: 'sine', freq: 587, delay: 0.58, adsr: { a: 0.006, d: 1.3, s: 0, r: 0.6 }, gain: 0.08 },
        { waveform: 'triangle', freq: 1175, delay: 0.6, adsr: { a: 0.008, d: 0.8, s: 0, r: 0.4 }, gain: 0.026 } ] } },

    // The PLAYER sting — layered ON TOP of whatever rarity flip just fired, never
    // instead of it. A card with somebody's real handle on it is the rarest thing
    // the system can hand you regardless of rank, so it gets its own signal.
    { id: 'cards-player-sting', name: 'Cards — it is a PLAYER card', group: 'cards', category: 'sfx', priority: 9,
      config: { duration: 0.9, layers: [
        { waveform: 'sine', freq: 1319, delay: 0.06, adsr: { a: 0.003, d: 0.5, s: 0, r: 0.24 }, gain: 0.055 },
        { waveform: 'sine', freq: 1976, delay: 0.14, adsr: { a: 0.003, d: 0.6, s: 0, r: 0.28 }, gain: 0.045 },
        { waveform: 'sine', freq: 2637, delay: 0.22, adsr: { a: 0.003, d: 0.7, s: 0, r: 0.32 }, gain: 0.035 },
        { waveform: 'triangle', freq: 3951, delay: 0.3, adsr: { a: 0.004, d: 0.4, s: 0, r: 0.2 }, gain: 0.014 } ] } },

    // Dupe — a flat, dead thunk. Deliberately the only unmusical cue in the set.
    { id: 'cards-dupe', name: 'Cards — duplicate', group: 'cards', category: 'sfx', priority: 4,
      config: { duration: 0.3, layers: [
        { waveform: 'sine', freq: 150, pitchBend: { to: 96, time: 0.12 }, adsr: { a: 0.002, d: 0.14, s: 0, r: 0.09 }, gain: 0.12 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 520, q: 0.8 }, adsr: { a: 0.002, d: 0.1, s: 0, r: 0.07 }, gain: 0.08 } ] } },

    { id: 'cards-stack', name: 'Cards — squared off at the end', group: 'cards', category: 'sfx', priority: 5,
      config: { duration: 0.36, layers: [
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 900, q: 1.2 }, adsr: { a: 0.002, d: 0.07, s: 0, r: 0.05 }, gain: 0.16 },
        { waveform: 'noise', noiseMix: 1, delay: 0.09, filter: { type: 'bandpass', freq: 800, q: 1.2 }, adsr: { a: 0.002, d: 0.07, s: 0, r: 0.05 }, gain: 0.13 },
        { waveform: 'triangle', freq: 170, delay: 0.09, pitchBend: { to: 110, time: 0.05 }, adsr: { a: 0.001, d: 0.08, s: 0, r: 0.05 }, gain: 0.11 } ] } },

    // ── Banks ────────────────────────────────────────────────────────────────
    // A BANK is a separate file that authors a themed set of presets in exactly this
    // shape and attaches it to the global. Folding them in here (rather than pasting
    // them into this list) is what makes them dev-panel editable and DB-overridable
    // via `interface_sfx` without this file growing another few hundred lines every
    // time a system gets a soundset.
    //
    // LOAD-ORDER CONTRACT: a bank's <script> must come BEFORE this one in both
    // client/game/index.html and client/devpanel/index.html. If it doesn't, the bank
    // still plays (its own `play()` is self-contained) but the dev panel can't see it
    // — a silent, confusing failure, so the tag order is commented at both sites.
    ...(global.HockeySfx?.BUILTINS || []),
  ];

  const GROUPS = { poker: 'Poker table', hack: 'Circuit Breach (hack)', hololock: 'Hololock Bypass', vault: 'Vault Crack', synth: 'Synth Lab (cook)', flight: 'Flight (cockpit)', fishing: 'Fishing (cast / reel)', dialogue: 'Dialogue (conversation)', accolades: 'Accolades (entry logged)', cards: 'Trading cards (machine / pack opening)', procedural: 'Procedural material/action tables', hockey: 'Hockey (Cluster Puck broadcast)' };

  const _builtinById = new Map(BUILTINS.map(d => [d.id, d]));
  let _overrides = new Map(); // id -> { config, priority, enabled, name }

  function _clone(x) { return JSON.parse(JSON.stringify(x)); }

  // Effective def for playback: built-in with any DB override layered on. Returns
  // null when an override disables the cue (enabled === 0) — a silenced sound.
  function get(id) {
    const base = _builtinById.get(id);
    const ov = _overrides.get(id);
    if (!base) {
      // A wholly custom override row with no built-in (rare) — play it as-is.
      if (ov && ov.enabled !== 0) return { id, name: ov.name || id, category: 'sfx', priority: ov.priority ?? 5, config: ov.config || {} };
      return null;
    }
    if (!ov) return base;
    if (ov.enabled === 0) return null;
    return {
      ...base,
      name: ov.name || base.name,
      priority: ov.priority ?? base.priority,
      config: ov.config || base.config,
    };
  }

  // Replace the override set from DB rows: [{ id, name, grp, config, priority, enabled }].
  function applyOverrides(rows) {
    _overrides = new Map();
    for (const r of (rows || [])) {
      if (!r || !r.id) continue;
      const config = typeof r.config === 'string' ? (() => { try { return JSON.parse(r.config); } catch { return {}; } })() : (r.config || {});
      _overrides.set(r.id, { name: r.name, priority: r.priority, enabled: r.enabled, config, grp: r.grp });
    }
  }

  // The built-in defs (deep-cloned so callers/editors can't mutate the source).
  function defaults() { return BUILTINS.map(_clone); }

  // Merged rows for the dev-panel list: built-in fields with the effective
  // (override or default) values, plus flags the editor uses.
  function list() {
    return BUILTINS.map(b => {
      const ov = _overrides.get(b.id);
      return {
        id: b.id, name: ov?.name || b.name, group: b.group,
        category: b.category, priority: ov?.priority ?? b.priority,
        config: ov?.config ? _clone(ov.config) : _clone(b.config),
        defaultConfig: _clone(b.config), defaultPriority: b.priority, defaultName: b.name,
        overridden: !!ov, enabled: ov ? ov.enabled !== 0 : true,
      };
    });
  }

  global.SFXCatalog = { get, applyOverrides, defaults, list, GROUPS };

})(typeof window !== 'undefined' ? window : globalThis);
