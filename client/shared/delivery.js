// How a line is delivered: one object the voice and the face both read
// (docs/proposals/delivery.md).
//
//   { mood, i, effort, casual }
//
// `effort`: -1 a whisper, -0.5 quiet, 0 normal, 1 raised, 2 a yell. `mood` and `i`: a mood off
// expressions.js, which the face already wears; VOICE_MOODS is how it sounds.
// Every function here returns exactly nothing-changed with no mood and effort 0.
//
// The voice side is a plain bundle of numbers that speak() applies (`opt.delivery`), so
// audio-engine.js (a classic script) needs no import and knows no table:
//   mul    factors on deliveryFor's multiplicative keys
//   add    amounts added to its additive keys (oq, breath)
//   gain   the line's level, as a factor
//   whisper 0 to 1: voicing taken out and put through breath instead
//   fshift every formant scaled (a smile)

export const EFFORT_MIN = -1, EFFORT_MAX = 2;

const clamp = (x, a, b) => Math.max(a, Math.min(b, +x || 0));

export function normDelivery(d) {
  if (!d || typeof d !== 'object') return { mood: null, i: 0, effort: 0, casual: 0 };
  return { mood: d.mood || null, i: clamp(d.i ?? 1, 0, 1), effort: clamp(d.effort, EFFORT_MIN, EFFORT_MAX), casual: clamp(d.casual, 0, 1) };
}

// Louder speech is more than gain (Lombard and shouted speech: Traunmüller and Eriksson
// 2000; Rostolland 1982): two to three semitones up per step of effort, F1 up as the jaw opens, a pressed
// source with more top end, and at the top of a yell, strain. Quiet speech is the reverse
// and breathier; under -0.5 it turns to whisper.
export function voiceEffort(effort) {
  const e = clamp(effort, EFFORT_MIN, EFFORT_MAX), u = Math.max(0, e), q = Math.max(0, -e);
  if (e === 0) return null;
  const w = clamp((q - 0.5) * 2, 0, 1);
  const db = 3.5 * u - 9 * q + 6 * w;   // a whisper is breath alone, which is quiet: bring it back up
  return {
    gain: 10 ** (db / 20),
    whisper: w,
    mul: {
      pitch: 2 ** ((2.5 * u - 0.8 * q) / 12),
      range: 1 + 0.15 * u - 0.3 * q,
      rate: 1 - 0.05 * u + 0.03 * q,
      loud: 1 + 0.12 * u,
      bright: 1 + 0.3 * u - 0.25 * q,
      f1: 1 + 0.055 * u - 0.03 * q,
      jitter: 1 + 0.6 * Math.max(0, u - 1),
      creak: Math.max(0, 1 - 0.6 * u),
      hold: 1 + 0.15 * u,
    },
    add: { oq: -0.08 * u + 0.07 * q, breath: 0.006 * q },
  };
}

// How each mood moves the voice at full strength (Murray and Arnott 1993; Cahn 1990), on
// deliveryFor's keys. `st` is the register in semitones; `effort` is how much louder or
// softer the mood makes them, added to the line's own; `decl` below 0 turns the phrase's
// fall into a rise (fear, puzzlement); `fshift` scales every formant, as spread lips
// shorten the tract (a smile). A mood with no row (disgusted, skeptical, ...) is plain.
// The intonation keys bend the neutral reading fitted against VCTK (oracle-teacher.md,
// "Intonation and rhythm"), as factors on TUNING's: glide (how slowly pitch moves to a
// target), declFront and downstep (how fast a phrase falls, and each accent's step down),
// preHead (the lift before the first accent), nucFall (the fall on the last accent; below 0
// a small rise), stressLen (how much stress lengthens a vowel), finalK (the phrase-final
// lengthening). Directions from David, 2026-11-24 (delivery.md).
export const VOICE_MOODS = {
  annoyed:  { st: -1, effort: 0.3, mul: { range: 0.8, rate: 1.06, decl: 1.35, pause: 0.85, bright: 1.1, creak: 1.2, glide: 0.85, downstep: 1.2, nucFall: 1.2, stressLen: 1.15 }, add: { oq: -0.05 } },
  angry:    { st: 2, effort: 0.8, mul: { range: 1.3, rate: 1.05, decl: 1.4, pause: 0.8, bright: 1.2, loud: 1.12, jitter: 1.3, glide: 0.7, downstep: 1.4, nucFall: 1.3, stressLen: 1.3 }, add: { oq: -0.08 } },
  afraid:   { st: 4, effort: 0, mul: { range: 0.8, rate: 1.14, decl: -0.35, pause: 0.8, jitter: 2.2, creak: 0.3, nucFall: -0.2 }, add: { oq: 0.05, breath: 0.01 } },
  happy:    { st: 3, effort: 0.2, fshift: 1.04, mul: { range: 1.5, rate: 1.05, decl: 0.8, bright: 1.15, creak: 0.5, preHead: 1.6, declFront: 0.6, nucFall: 0.7 }, add: { oq: -0.02 } },
  amused:   { st: 2, effort: 0, fshift: 1.03, mul: { range: 1.3, rate: 1.03, decl: 0.85, creak: 0.6, preHead: 1.3, nucFall: 0.85 } },
  sad:      { st: -2, effort: -0.3, mul: { range: 0.6, rate: 0.86, decl: 1.1, pause: 1.3, bright: 0.85, loud: 0.92, creak: 1.5, glide: 1.4, downstep: 0.6, nucFall: 1.3, finalK: 1.3 }, add: { oq: 0.06, breath: 0.008 } },
  confused: { st: 1, effort: 0, mul: { range: 1.0, rate: 0.9, decl: -0.2, pause: 1.25, hold: 1.2, nucFall: 0.1 }, add: { breath: 0.004 } },
  tired:    { st: -2, effort: -0.3, mul: { range: 0.5, rate: 0.85, decl: 1.0, pause: 1.3, bright: 0.85, creak: 1.8, glide: 1.5, downstep: 0.6, nucFall: 1.2, finalK: 1.35 }, add: { oq: 0.07, breath: 0.006 } },
  // dry: a wide, drawn-out reading, the last accent's fall deep after a lift, the key word held
  sarcastic:{ st: 0, effort: 0, mul: { range: 1.4, rate: 0.94, glide: 1.5, preHead: 1.3, nucFall: 1.4, stressLen: 1.4, finalK: 1.2, creak: 1.2 } },
  surprised:{ st: 4, effort: 0.4, mul: { range: 1.6, rate: 1.0, decl: 0.6, preHead: 1.6, declFront: 0.5, nucFall: 0.7 }, add: { oq: -0.03 } },
};

// The voice bundle for a whole delivery: the mood's row at its strength `i` (a factor k
// becomes k^i, an amount a times i), then effort on top. null when nothing changes.
export function voiceDelivery(d) {
  const n = normDelivery(d), row = n.mood && VOICE_MOODS[n.mood], i = row ? n.i : 0;
  const ef = voiceEffort(n.effort + (row ? row.effort * i : 0));
  if (!row || i === 0) return ef;
  const mul = { pitch: 2 ** (row.st * i / 12) }, add = {};
  for (const k in row.mul) {
    const v = row.mul[k];
    // a negative decl is a rise: scale it linearly from 1, since a power can't cross zero
    mul[k] = v > 0 ? v ** i : 1 + (v - 1) * i;
  }
  for (const k in row.add || {}) add[k] = row.add[k] * i;
  const out = { gain: 1, whisper: 0, fshift: row.fshift ? row.fshift ** i : 1, mul, add };
  if (ef) {
    out.gain = ef.gain; out.whisper = ef.whisper;
    for (const k in ef.mul) out.mul[k] = (out.mul[k] ?? 1) * ef.mul[k];
    for (const k in ef.add) out.add[k] = (out.add[k] ?? 0) + ef.add[k];
  }
  return out;
}

// Effort on the face, added to the mood's channels (expressions.js names). `jawK` scales
// the speech jaw: a yell opens every vowel wider, a whisper hardly moves.
export function faceEffort(effort) {
  const e = clamp(effort, EFFORT_MIN, EFFORT_MAX), u = Math.max(0, e - 0.5) / 1.5, q = Math.max(0, -e);
  if (e === 0) return { ch: null, jawK: 1 };
  return {
    ch: u > 0 ? { lid: 0.7 * u, browUp: 0.6 * u, browIn: 0.25 * u, flare: 0.6 * u, cheek: 0.2 * u, headP: -0.25 * u, blink: 1 - 0.5 * u } : { lid: -0.15 * q, headP: 0.15 * q },
    jawK: 1 + 0.35 * Math.max(0, e) - 0.45 * q,
  };
}

// Effort a line implies on its own, when nothing set one: a yell verb 2, a whisper -1,
// a mutter -0.5, a short line in caps 1.5, a line ending in '!' 0.5.
export function effortFromLine(text, kind) {
  if (kind === 'yell') return 2;
  if (kind === 'whisper') return -1;
  if (kind === 'quiet') return -0.5;
  const t = String(text || '').trim(), letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 2 && letters === letters.toUpperCase() && letters.length <= 20) return 1.5;
  return /!\s*["']?$/.test(t) ? 0.5 : 0;
}
