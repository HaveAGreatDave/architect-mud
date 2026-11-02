// COMPOSE LIB: the music theory and the score-writing a song build script needs, in one place.
//
//   import { Song, chord, scale, voiceLead, rng, ... } from '../audio/compose-lib.mjs';
//
// Every KSAB build script (scripts/content/build-*-theme.mjs) carries its own pitch helpers and
// its own Part class. This is those, plus what they did by hand each time: modes, chord symbols,
// voice leading, an arpeggiator, bass and drum patterns with accents, an echo channel, motif-based
// melody, and seeded humanising. The why behind each default (registers, echo rows, accent
// shapes, step-to-leap ratios) is in docs/reference/game-music-craft.md; song-lint.mjs checks a
// finished song against the same numbers.
//
// A song here is still a tracker song (docs/amp-format.md): 16th-note rows, one note at a time
// per channel. Nothing in this file plays sound.

// ── pitch ───────────────────────────────────────────────────────────────────
export const PC = { C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 };
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const midi = (n) => {
  if (typeof n === 'number') return n;
  const m = /^([A-G][#b]?)(-?\d)$/.exec(n);
  if (!m || PC[m[1]] == null) throw new Error(`bad note ${n}`);
  return (+m[2] + 1) * 12 + PC[m[1]];
};
// The engine reads C#4 and Db4 alike; flats read better in flat keys.
export const nameOf = (m, flats = false) => `${(flats ? FLAT : SHARP)[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
export const hz = (m) => 440 * Math.pow(2, (midi(m) - 69) / 12);

// ── scales and modes ────────────────────────────────────────────────────────
export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11], major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10], minor: [0, 2, 3, 5, 7, 8, 10], locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11], phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  minorPentatonic: [0, 3, 5, 7, 10], majorPentatonic: [0, 2, 4, 7, 9],
};
// { root, mode, pcs: Set of pitch classes, degree(n) → pitch class of the nth degree (0-based) }
export function scale(root, mode = 'minor') {
  const r = typeof root === 'number' ? root % 12 : PC[root];
  const steps = MODES[mode];
  if (r == null || !steps) throw new Error(`bad scale ${root} ${mode}`);
  const pcs = steps.map((s) => (r + s) % 12);
  return { root: r, mode, pcs: new Set(pcs), list: pcs, degree: (n) => pcs[((n % pcs.length) + pcs.length) % pcs.length] };
}
// The scale note nearest `m`, ties going down.
export const snap = (m, sc) => { for (let d = 0; d < 7; d++) { if (sc.pcs.has(((m - d) % 12 + 12) % 12)) return m - d; if (sc.pcs.has(((m + d) % 12 + 12) % 12)) return m + d; } return m; };
// Move `m` by `steps` scale degrees.
export function stepBy(m, steps, sc) {
  let n = snap(m, sc);
  const dir = Math.sign(steps);
  for (let i = 0; i < Math.abs(steps); i++) { n += dir; while (!sc.pcs.has(((n % 12) + 12) % 12)) n += dir; }
  return n;
}

// ── chords ──────────────────────────────────────────────────────────────────
// Symbols: C, Cm, C7, Cm7, Cmaj7, Cdim, Cdim7, Cm7b5, Caug, Csus2, Csus4, C6, Cm6, C9, Cadd9,
// C5 (a power chord), and a slash bass (C/E). Returns { root, bass, pcs: [root first], symbol }.
const QUALITY = {
  '': [0, 4, 7], m: [0, 3, 7], 5: [0, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
  dim: [0, 3, 6], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7],
  6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 9: [0, 4, 7, 10, 14], m9: [0, 3, 7, 10, 14], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
  mmaj7: [0, 3, 7, 11],
};
export function chord(symbol) {
  const m = /^([A-G][#b]?)([a-z0-9]*)(?:\/([A-G][#b]?))?$/.exec(symbol);
  if (!m || PC[m[1]] == null || !QUALITY[m[2]]) throw new Error(`bad chord ${symbol}`);
  const root = PC[m[1]];
  const pcs = QUALITY[m[2]].map((i) => (root + i) % 12);
  return { symbol, root, bass: m[3] ? PC[m[3]] : root, pcs, tones: new Set(pcs) };
}
// Roman numerals in a key: 'i', 'iv', 'bVI', 'bVII', 'V7', 'iiø7', 'bII' → a chord symbol.
const ROMAN = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };
export function roman(numeral, key) {
  const m = /^(b|#)?(i{1,3}|iv|v|vi{0,2}|I{1,3}|IV|V|VI{0,2})(°|ø|\+)?(7|maj7|9|sus4|sus2)?$/.exec(numeral);
  if (!m) throw new Error(`bad numeral ${numeral}`);
  const major = MODES.major, deg = ROMAN[m[2].toLowerCase()];
  const shift = m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0;
  const root = ((PC[key] ?? key) + major[deg] + shift + 12) % 12;
  const lower = m[2] === m[2].toLowerCase();
  let q = m[3] === '°' ? (m[4] === '7' ? 'dim7' : 'dim') : m[3] === 'ø' ? 'm7b5' : m[3] === '+' ? 'aug' : lower ? 'm' : '';
  if (m[4] && !m[3]) q = m[4] === '7' ? (lower ? 'm7' : '7') : m[4] === 'maj7' ? 'maj7' : m[4] === '9' ? (lower ? 'm9' : '9') : m[4];
  return chord(`${FLAT[root]}${q}`);
}

// Voice leading: the voicing of `ch` inside [lo, hi] with `n` notes whose total movement from
// `prev` is smallest (common tones held, the rest by step). Without `prev`, the closest
// root-position voicing around the middle of the range.
export function voiceLead(ch, prev, { lo = 'C3', hi = 'C5', n = 3 } = {}) {
  lo = midi(lo); hi = midi(hi);
  const pool = [];
  for (let m = lo; m <= hi; m++) if (ch.tones.has(m % 12)) pool.push(m);
  const want = Math.min(n, ch.pcs.length);
  let best = null, bestCost = Infinity;
  const pick = (from, chosen) => {
    if (chosen.length === want) {
      const pcs = new Set(chosen.map((m) => m % 12));
      // the root and third (the first two chord tones) must be there
      if (!pcs.has(ch.pcs[0]) || (ch.pcs.length > 2 && want > 2 && !pcs.has(ch.pcs[1]))) return;
      let cost;
      if (prev?.length) cost = chosen.reduce((s, m, i) => s + Math.abs(m - (prev[i] ?? prev[prev.length - 1])), 0);
      else { const mid = (lo + hi) / 2; cost = Math.abs(chosen.reduce((s, m) => s + m, 0) / want - mid) + (chosen[0] % 12 === ch.pcs[0] ? 0 : 2); }
      // spread no wider than an octave and a fifth, and no two voices a semitone apart
      if (chosen[chosen.length - 1] - chosen[0] > 19) return;
      for (let i = 1; i < chosen.length; i++) if (chosen[i] - chosen[i - 1] < 2) return;
      if (cost < bestCost) { bestCost = cost; best = [...chosen]; }
      return;
    }
    for (let i = from; i < pool.length; i++) pick(i + 1, [...chosen, pool[i]]);
  };
  pick(0, []);
  return best || pool.slice(0, want);
}

// ── randomness ──────────────────────────────────────────────────────────────
// mulberry32: the same seed is the same song, so a build script's --check stays meaningful.
export function rng(seed = 1) {
  let a = typeof seed === 'string' ? [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0 : seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.chance = (p) => next() < p;
  return next;
}

// ── accents ─────────────────────────────────────────────────────────────────
// A sixteenth's weight in 4/4 (1 the downbeat .. 0.25 an off-beat sixteenth). Accent shapes are
// read from it: loud on the beat, softer on the "and", softest on the "e" and "a".
export const METRIC = [1, 0.25, 0.5, 0.25, 0.75, 0.25, 0.5, 0.25, 0.9, 0.25, 0.5, 0.25, 0.75, 0.25, 0.5, 0.25];
// A sixteenth hi-hat line that breathes: the downbeats and "ands" lead, the rest step down.
export const HAT_ACCENT = [1, 0.55, 0.75, 0.55, 0.9, 0.55, 0.75, 0.6, 1, 0.55, 0.75, 0.55, 0.9, 0.55, 0.75, 0.65];

// ── the song ────────────────────────────────────────────────────────────────
// new Song({ name, tempo, bars, swing, master }) → parts, then .toSong(id, extra).
export class Song {
  constructor({ name, tempo = 120, bars = 8, rowsPerBar = 16, swing = null, master = 0.85, key = null }) {
    Object.assign(this, { name, tempo, bars, rowsPerBar, swing, master, key });
    this.rows = bars * rowsPerBar;
    this.parts = [];
  }
  part(key, instrument, { pan = 0 } = {}) { const p = new Part(this, key, instrument, pan); this.parts.push(p); return p; }
  // The song row, in the content shape. `instrumentId(key)` maps a part's instrument key to its id.
  toSong(id, { instrumentId = (k) => k, category = 'misc', priority = 5, loopStart = 0, loopEnd = null } = {}) {
    const parts = this.parts.filter((p) => p.rows.some(Boolean));
    const used = [...new Set(parts.flatMap((p) => p.rows.filter(Boolean).map((s) => s.instrument)))];
    return {
      id, name: this.name, category, tempo: this.tempo, priority, enabled: 1,
      loop_start: loopStart, loop_end: loopEnd ?? this.rows - 1,
      ...(this.swing && this.swing !== 0.5 ? { swing: this.swing } : {}),
      instrument_ids: used.map(instrumentId).filter((v, i, a) => a.indexOf(v) === i),
      channels: parts.map((p) => p.rows.map((s) => (s ? { ...s, instrument: instrumentId(s.instrument) } : null))),
      channel_pan: parts.map((p) => p.pan),
    };
  }
}

// One channel: one note at a time.
export class Part {
  constructor(song, key, instrument, pan) { this.song = song; this.key = key; this.instrument = instrument; this.pan = pan; this.rows = new Array(song.rows).fill(null); }
  at(bar, row) { return (bar - 1) * this.song.rowsPerBar + row; }
  // A note `len` rows long at bar (1-based) and row (0-based). Velocity scaled by the song's master.
  note(bar, row, note, len = 1, vol = 0.8, { nudge, instrument } = {}) {
    const i = this.at(bar, row);
    if (i < 0 || i >= this.rows.length) throw new Error(`${this.key}: bar ${bar} row ${row} is outside the song`);
    const n = typeof note === 'number' ? nameOf(note, this.song.key?.flats) : note;
    midi(n);
    const step = { note: n, instrument: instrument || this.instrument, vol: +(Math.min(1, vol) * this.song.master).toFixed(3) };
    if (len > 1) step.len = Math.min(len, this.rows.length - i);
    if (nudge) step.nudge = +nudge.toFixed(3);
    this.rows[i] = step;
    return this;
  }
  // The build scripts' bar notation: NOTE:LEN[@VOL], r:LEN a rest, -:LEN a tie, | a bar line.
  line(bar, text, vol = 0.8) {
    let at = 0, last = null;
    const R = this.song.rowsPerBar;
    for (const tok of text.trim().split(/\s+/)) {
      if (tok === '|') { if (at % R) throw new Error(`${this.key}: bar line at row ${at} in "${text}"`); continue; }
      const m = /^([A-G][#b]?-?\d|r|-):(\d+)(?:@([\d.]+))?$/.exec(tok);
      if (!m) throw new Error(`${this.key}: bad token ${tok}`);
      const len = +m[2];
      if (m[1] === '-') { if (!last) throw new Error(`${this.key}: tie with nothing`); last.len = (last.len || 1) + len; }
      else if (m[1] !== 'r') { this.note(bar + Math.floor(at / R), at % R, m[1], len, m[3] != null ? +m[3] : vol); last = this.rows[this.at(bar + Math.floor(at / R), at % R)]; }
      at += len;
    }
    return this;
  }
  // A drum bar: X accent, x normal, o ghost, . rest; 16 characters (spaces ignored).
  hits(bar, pattern, note, { scale = 1, accent = null, instrument } = {}) {
    const V = { X: 0.95, x: 0.7, o: 0.32 };
    [...pattern.replace(/\s/g, '')].forEach((c, row) => {
      if (!V[c]) return;
      const a = accent ? accent[row % accent.length] : 1;
      this.note(bar, row, note, 1, V[c] * scale * (c === 'x' ? a : 1), { instrument });
    });
    return this;
  }
  // Arpeggio over a chord for `rows` rows from (bar, row): `shape` up | down | updown | random,
  // a note every `rate` rows, across `octaves` from `lo`. Each note held `gate` of its slot.
  arp(bar, row, ch, { rows = 16, rate = 2, shape = 'up', lo = 'C4', octaves = 1, vol = 0.6, gate = 1, r = null } = {}) {
    const base = midi(lo), notes = [];
    for (let o = 0; o < octaves; o++) for (const pc of ch.pcs) { let m = base + o * 12 + ((pc - base % 12 + 12) % 12); notes.push(m); }
    notes.sort((a, b) => a - b);
    const seq = shape === 'down' ? [...notes].reverse() : shape === 'updown' ? [...notes, ...notes.slice(1, -1).reverse()] : notes;
    const len = Math.max(1, Math.round(rate * gate));
    for (let k = 0, i = 0; k < rows; k += rate, i++) {
      const m = shape === 'random' && r ? r.pick(notes) : seq[i % seq.length];
      const pos = this.at(bar, row) + k;
      this.note(bar + Math.floor((row + k) / this.song.rowsPerBar), (row + k) % this.song.rowsPerBar, m, len, vol * (0.8 + 0.2 * METRIC[pos % 16]));
    }
    return this;
  }
  // Copy another part's notes `rows` rows later, quieter and (optionally) moved: the tracker echo.
  // Notes that would land on one of this part's own notes, or past the end, are dropped.
  echoOf(src, { rows = 3, vol = 0.45, transpose = 0, wrap = true } = {}) {
    const N = this.rows.length;
    src.rows.forEach((s, i) => {
      if (!s) return;
      let j = i + rows;
      if (j >= N) { if (!wrap) return; j -= N; }
      if (this.rows[j]) return;
      const m = midi(s.note) + transpose;
      this.rows[j] = { ...s, note: nameOf(m), vol: +(s.vol * vol).toFixed(3), instrument: this.instrument };
      if (s.len) this.rows[j].len = Math.min(s.len, N - j);
    });
    return this;
  }
  // Velocity and timing variation, seeded: each note's vol moves by up to ±`vel` (scaled by how
  // weak its row is, so downbeats stay put), and off-beat notes may drift late by up to `late`
  // rows. Never touches beat 1.
  humanize(r, { vel = 0.08, late = 0 } = {}) {
    this.rows.forEach((s, i) => {
      if (!s) return;
      const row = i % this.song.rowsPerBar;
      const w = 1 - METRIC[row % 16] * 0.7;
      s.vol = +Math.max(0.02, Math.min(this.song.master, s.vol * (1 + (r() * 2 - 1) * vel * w))).toFixed(3);
      if (late && row !== 0 && METRIC[row % 16] < 0.75) { const n = +(r() * late).toFixed(3); if (n) s.nudge = +((s.nudge || 0) + n).toFixed(3); }
    });
    return this;
  }
  // Empty bars `from`..`to` (inclusive, 1-based).
  clear(from, to) { for (let i = this.at(from, 0); i < this.at(to + 1, 0) && i < this.rows.length; i++) this.rows[i] = null; return this; }
  // Every note's pitches as midi numbers, with their rows: [{ i, m, len, vol }].
  notes() { return this.rows.map((s, i) => (s ? { i, m: midi(s.note), len: s.len || 1, vol: s.vol } : null)).filter(Boolean); }
}

// ── melody ──────────────────────────────────────────────────────────────────
// A motif: a rhythm and a contour in scale degrees, `rows` long. The rhythm is built from
// half-bar cells (onsets in eighths of a half bar), chosen by `density` (notes per beat), and
// the motif's last cell is a long note so the phrase breathes. The contour moves mostly by step,
// leaps now and then and comes back after a leap (regression to the mean: von Hippel & Huron).
const CELLS = [
  { on: [0], d: 0.5 }, { on: [0, 6], d: 1 }, { on: [0, 4], d: 1 }, { on: [2, 4], d: 1 },
  { on: [0, 3, 6], d: 1.5 }, { on: [0, 4, 6], d: 1.5 }, { on: [0, 2, 4], d: 1.5 }, { on: [0, 2, 6], d: 1.5 },
  { on: [0, 2, 4, 6], d: 2 }, { on: [0, 1, 2, 4], d: 2 }, { on: [0, 3, 4, 6], d: 2 }, { on: [0, 2, 3, 6], d: 2 },
];
export function motif(r, { rows = 16, density = 1.5, leapChance = 0.2 } = {}) {
  const halves = Math.max(1, Math.round(rows / 8));
  const onsets = [];
  for (let h = 0; h < halves; h++) {
    const last = h === halves - 1;
    // the closing cell is one note or two; elsewhere, cells near the asked density
    const pool = last ? CELLS.filter((c) => c.on.length <= 2 && c.on[0] === 0) : CELLS.filter((c) => Math.abs(c.d - density) <= 0.6);
    const cell = r.pick(pool.length ? pool : CELLS);
    for (const o of cell.on) onsets.push(h * 8 + o);
  }
  if (onsets[0] !== 0 && r() < 0.7) onsets.unshift(0);
  let deg = 0, dir = r.chance(0.5) ? 1 : -1;
  const out = [];
  onsets.forEach((row, k) => {
    if (k > 0) {
      let step;
      if (Math.abs(deg) >= 4) step = -Math.sign(deg) * r.pick([1, 2]);           // come home
      else if (r() < leapChance) step = dir * r.pick([3, 4]);                      // a leap
      else { if (r() < 0.3) dir = -dir; step = dir * r.pick([1, 1, 1, 1, 2]); }    // a step
      deg += step;
    }
    out.push({ row, deg, len: (onsets[k + 1] ?? rows) - row });
  });
  return out;
}
// Sing a motif over a chord: each note becomes a scale note `deg` degrees from `anchor`; a note
// on a bar's downbeat (and, half the time, on its half bar) is pulled to the nearest chord tone.
// A pitch never repeats the one before it unless the motif asked for the same degree.
// Returns [{ row, m, len }].
export function realise(mo, sc, ch, anchor, { lo = 'A3', hi = 'E5' } = {}) {
  lo = midi(lo); hi = midi(hi);
  const out = [];
  let prev = null, prevDeg = null;
  for (const n of mo) {
    let m = stepBy(midi(anchor), n.deg, sc);
    if (n.row % 16 === 0 || (n.row % 8 === 0 && n.deg % 2 === 0)) {
      // a chord tone a scale step either way at most, the one nearest the last note: snapping by
      // semitones instead put leaps on every downbeat
      const opts = [m, stepBy(m, -1, sc), stepBy(m, 1, sc)].filter((k) => ch.tones.has(((k % 12) + 12) % 12));
      if (opts.length) m = opts.sort((a, b) => Math.abs(a - (prev ?? a)) - Math.abs(b - (prev ?? b)))[0];
    }
    // the octave nearest the note before, inside the range: wrapping each note on its own turns
    // a step at the top of the range into a seventh down
    const cands = [];
    for (let k = -3; k <= 3; k++) { const c = m + 12 * k; if (c >= lo && c <= hi) cands.push(c); }
    if (cands.length) m = cands.sort((a, b) => Math.abs(a - (prev ?? m)) - Math.abs(b - (prev ?? m)))[0];
    else { while (m < lo) m += 12; while (m > hi) m -= 12; }
    if (prev != null && m === prev && n.deg !== prevDeg) m = stepBy(m, n.deg > prevDeg ? 1 : -1, sc);
    out.push({ row: n.row, m, len: n.len });
    prev = m; prevDeg = n.deg;
  }
  return out;
}
// Vary a motif: keep the rhythm and move the last third (an answer), or shift it a degree.
export function vary(mo, r, kind = 'answer') {
  const c = mo.map((n) => ({ ...n }));
  if (kind === 'shift') { const s = r.pick([-1, 1, 2]); c.forEach((n) => { n.deg += s; }); }
  // (the answer bends its tail by one degree, more toward the end, so the seam is a step)
  else if (kind === 'answer') { const from = Math.floor(c.length * 2 / 3); const s = r.pick([-1, 1]); for (let k = from; k < c.length; k++) c[k].deg += k === c.length - 1 ? 2 * s : s; }
  else if (kind === 'invert') c.forEach((n) => { n.deg = -n.deg; });
  return c;
}
