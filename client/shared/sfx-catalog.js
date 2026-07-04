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
  ];

  const GROUPS = { poker: 'Poker table', hack: 'Circuit Breach (hack)', hololock: 'Hololock Bypass', vault: 'Vault Crack', synth: 'Synth Lab (cook)', flight: 'Flight (cockpit)' };

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
