// Procedural poker table sound effects. The server (plugins/gametable) decides
// *when* a sound plays and pushes a `poker_sfx` cue over the WS; this module
// holds the synthesized SFX defs and renders them through window.AudioEngine
// (client/shared/audio-engine.js) — no samples, same synth path as game SFX.

// Each def follows the AudioEngine SFX schema: { config: { duration, layers[] } }.
// Per-note length is controlled by adsr (s:0 = percussive, s>0 = sustained ring);
// `delay` staggers layers to sequence riffles, clinks, and melody notes.

// Riffle of filtered-noise clicks — cards shuffling.
const SHUFFLE = {
  id: 'poker-shuffle', name: 'poker shuffle', category: 'sfx', priority: 6,
  config: {
    duration: 0.45,
    layers: Array.from({ length: 11 }, (_, i) => ({
      waveform: 'noise', delay: i * 0.038,
      filter: { type: 'highpass', freq: 2400, q: 0.6 },
      adsr: { a: 0.001, d: 0.022, s: 0, r: 0.012 }, gain: 0.2,
    })),
  },
};

// A few quick "swish" flicks — cards dealt out to seats / onto the board.
const DEAL = {
  id: 'poker-deal', name: 'poker deal', category: 'sfx', priority: 6,
  config: {
    duration: 0.5,
    layers: [0, 0.13, 0.26, 0.39].map((d) => ({
      waveform: 'noise', delay: d,
      filter: { type: 'bandpass', freq: 3200, q: 1.4 },
      adsr: { a: 0.004, d: 0.06, s: 0, r: 0.03 }, gain: 0.35,
    })),
  },
};

// Two woody knocks on the felt — check.
function knock(delay) {
  return [
    { waveform: 'triangle', freq: 170, delay, pitchBend: { to: 90, time: 0.05 },
      adsr: { a: 0.001, d: 0.07, s: 0, r: 0.04 }, gain: 0.5 },
    { waveform: 'noise', delay,
      filter: { type: 'lowpass', freq: 1600, q: 1 },
      adsr: { a: 0.001, d: 0.03, s: 0, r: 0.02 }, gain: 0.25 },
  ];
}
const CHECK = {
  id: 'poker-check', name: 'poker check', category: 'sfx', priority: 6,
  config: { duration: 0.1, layers: [...knock(0), ...knock(0.19)] },
};

// Metallic chip clinks. `count` clinks over a spread — call vs. raise (more, louder).
function chips(count, spread, gain) {
  return Array.from({ length: count }, (_, i) => ({
    waveform: 'sine', freq: 2400 + (i % 3) * 320, delay: (i / count) * spread,
    filter: { type: 'bandpass', freq: 2600, q: 3 },
    adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 }, gain,
  }));
}
const CALL = {
  id: 'poker-call', name: 'poker call', category: 'sfx', priority: 6,
  config: { duration: 0.25, layers: chips(4, 0.18, 0.28) },
};
const RAISE = {
  id: 'poker-raise', name: 'poker raise', category: 'sfx', priority: 6,
  config: { duration: 0.4, layers: chips(8, 0.34, 0.34) },
};

// Soft descending two-note sigh — fold (slightly sad).
const FOLD = {
  id: 'poker-fold', name: 'poker fold', category: 'sfx', priority: 5,
  config: {
    duration: 0.5,
    layers: [
      { waveform: 'triangle', freq: 330, delay: 0,
        adsr: { a: 0.02, d: 0.28, s: 0, r: 0.1 }, gain: 0.35 },
      { waveform: 'triangle', freq: 247, delay: 0.16,
        adsr: { a: 0.02, d: 0.34, s: 0, r: 0.12 }, gain: 0.32 },
    ],
  },
};

// Warm ascending chord that blooms softly — round winner. Triangle/sine only
// (no square — that's what made the old fanfare buzzy/harsh), gentle attack
// and a long tail so it feels muted and pleasant rather than jumping out.
const WIN = {
  id: 'poker-win', name: 'poker win', category: 'sfx', priority: 8,
  config: {
    duration: 1.0,
    layers: [
      [523.25, 0],    // C5
      [659.25, 0.09], // E5
      [783.99, 0.18], // G5
    ].flatMap(([freq, delay]) => ([
      { waveform: 'triangle', freq, delay,
        filter: { type: 'lowpass', freq: 2200, q: 0.5 },
        adsr: { a: 0.03, d: 0.18, s: 0.35, r: 0.55 }, gain: 0.2 },
      { waveform: 'sine', freq: freq * 2, delay: delay + 0.02,
        adsr: { a: 0.04, d: 0.2, s: 0.15, r: 0.45 }, gain: 0.07 },
    ])),
  },
};

// Gentle two-note prompt — it's your turn to act. Fires often and privately, so
// it stays soft and unobtrusive (distinct from the chip/knock action sounds).
const TURN = {
  id: 'poker-turn', name: 'poker turn', category: 'sfx', priority: 6,
  config: {
    duration: 0.3,
    layers: [
      { waveform: 'sine', freq: 784, delay: 0,        // G5
        adsr: { a: 0.005, d: 0.12, s: 0, r: 0.08 }, gain: 0.2 },
      { waveform: 'sine', freq: 1046.5, delay: 0.09,  // C6
        adsr: { a: 0.005, d: 0.16, s: 0, r: 0.1 }, gain: 0.18 },
      { waveform: 'triangle', freq: 2093, delay: 0.09, // shimmer harmonic
        adsr: { a: 0.005, d: 0.1, s: 0, r: 0.06 }, gain: 0.05 },
    ],
  },
};

// The big shove — a low stack-impact thud, a rising tension swell, and a heavy
// chip cascade. The most dramatic action beat, distinct from a plain raise.
const ALLIN = {
  id: 'poker-allin', name: 'poker all-in', category: 'sfx', priority: 7,
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
  },
};

// Sad-trombone glissando descent — you're out of chips.
const BROKE = {
  id: 'poker-broke', name: 'poker broke', category: 'sfx', priority: 7,
  config: {
    duration: 0.55,
    layers: [
      [262, 0],     // C4
      [247, 0.42],  // B3
      [233, 0.84],  // Bb3
      [196, 1.28],  // G3 (longer, lower final "waaah")
    ].map(([freq, delay], i) => ({
      waveform: 'sawtooth', freq, delay,
      pitchBend: { to: freq * 0.94, time: 0.3 },
      filter: { type: 'lowpass', freq: 1100, q: 2 },
      vibrato: { rate: 6, depth: 8 },
      adsr: { a: 0.03, d: i === 3 ? 0.8 : 0.36, s: 0, r: 0.2 }, gain: 0.34,
    })),
  },
};

const CUES = {
  shuffle: SHUFFLE,
  deal: DEAL,
  check: CHECK,
  call: CALL,
  raise: RAISE,
  fold: FOLD,
  allin: ALLIN,
  turn: TURN,
  win: WIN,
  broke: BROKE,
};

// Keep the table sounds gentle — they fire often and should sit under speech and
// music, never jump out. This scales every cue's synth gain on the shared SFX bus.
const POKER_SFX_GAIN = 0.55;

// The server can occasionally deliver the same cue twice in quick succession
// (overlapping broadcast recipients, a rapid re-push). Swallow an identical cue
// fired within this window so it doesn't double up. Legitimate repeats of a cue
// (e.g. `deal` on each street) are seconds apart and unaffected.
const DEDUPE_MS = 120;
const _lastPlayed = {};

export function playPokerSfx(cue) {
  const def = CUES[cue];
  if (!def) return;
  const now = Date.now();
  if (now - (_lastPlayed[cue] || 0) < DEDUPE_MS) return;
  _lastPlayed[cue] = now;
  window.AudioEngine?.playSfx(def, POKER_SFX_GAIN);
}
