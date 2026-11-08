// THOMAS · LIP SYNC. What ORACLE says, as mouth shapes. A shape is six numbers, 0 to 1, that the close-up
// figure's mouth is drawn from (gl/figure-hd.js): how far the jaw has dropped, how far the corners are
// drawn out or the lips rounded, how hard the lips are pressed, how much of the teeth shows, and how far
// up the tongue is. See docs/proposals/sculpted-figure.md.
//
// ORACLE's speak() fills `opt.trace` with each phoneme and when it starts (the END row says when the
// line stops), so a track follows the voice's own timing, pauses and stretches included. With the sound
// off there's no trace, and textTrack reads the letters at speaking pace instead.

const S = (open, wide, round, press, teeth, tongue) => ({ open, wide, round, press, teeth, tongue });
export const MOUTHS = {
  rest: S(0, 0, 0, 0, 0, 0),
  mbp: S(0, 0, 0, 1, 0, 0),       // lips shut and pressed: M B P
  fv: S(0.14, 0.15, 0, 0, 1, 0),  // the lower lip up to the top teeth: F V
  th: S(0.22, 0.1, 0, 0, 0.7, 1), // the tongue at the teeth
  ss: S(0.1, 0.55, 0, 0, 1, 0),   // teeth nearly together: S Z T D N
  sh: S(0.2, 0, 0.5, 0, 1, 0),    // teeth together, lips forward: SH CH J
  ee: S(0.2, 1, 0, 0, 1, 0),      // drawn wide
  ih: S(0.32, 0.6, 0, 0, 0.8, 0),
  ah: S(0.58, 0.15, 0, 0, 0.6, 0.15),
  aa: S(1, 0.2, 0, 0, 0.6, 0.15), // the jaw right down
  oh: S(0.62, 0, 0.7, 0, 0.2, 0),
  oo: S(0.24, 0, 1, 0, 0, 0),     // small and round: OO W
  er: S(0.3, 0, 0.35, 0, 0.5, 0),
  ll: S(0.42, 0.1, 0, 0, 0.5, 1), // the tongue up behind the teeth
  kg: S(0.36, 0.1, 0, 0, 0.4, 0.3),
};
// ORACLE's phonemes (audio-engine.js PH) to shapes. A diphthong is two, split at 55%.
const PHONE = {
  IY: 'ee', IH: 'ih', EH: 'ih', AE: 'ah', AA: 'aa', AO: 'oh', UH: 'er', UW: 'oo', ER: 'er', ERR: 'er', AH: 'ah', AX: 'ah',
  EY: ['ih', 'ee'], AY: ['aa', 'ee'], OY: ['oh', 'ee'], OW: ['oh', 'oo'], OWR: ['oh', 'oo'], AW: ['aa', 'oo'],
  M: 'mbp', B: 'mbp', P: 'mbp', F: 'fv', V: 'fv', TH: 'th', DH: 'th',
  T: 'ss', D: 'ss', DX: 'ss', S: 'ss', Z: 'ss', N: 'ss', SH: 'sh', ZH: 'sh', CH: 'sh', JH: 'sh',
  K: 'kg', G: 'kg', NG: 'kg', HH: 'ah', L: 'll', R: 'er', W: 'oo', Y: 'ee',
};
// The mouth moves a shade before the sound, as a real one has to, and takes this long between shapes.
const LEAD = 0.04, EASE = 0.085;

// A track is [{ t, m }], a shape from each time on.
export function mouthTrack(trace) {
  const out = [];
  for (let i = 0; i < trace.length; i++) {
    const { p, at } = trace[i], next = trace[i + 1]?.at ?? at + 0.1, m = PHONE[p];
    if (Array.isArray(m)) { out.push({ t: at - LEAD, m: m[0] }, { t: at + (next - at) * 0.55 - LEAD, m: m[1] }); continue; }
    out.push({ t: at - LEAD, m: m || 'rest' });
  }
  return out;
}
// The same from the letters, for when nothing is sounding.
const LETTER = { a: 'ah', e: 'ih', i: 'ih', o: 'oh', u: 'er', y: 'ee', b: 'mbp', m: 'mbp', p: 'mbp', f: 'fv', v: 'fv', w: 'oo', l: 'll', r: 'er', s: 'ss', z: 'ss', t: 'ss', d: 'ss', n: 'ss', c: 'kg', k: 'kg', g: 'kg', q: 'kg', x: 'ss', h: 'ah', j: 'sh' };
export function textTrack(text, perLetter = 0.072) {
  const out = []; let t = 0;
  for (const ch of String(text).toLowerCase()) {
    if (LETTER[ch]) { out.push({ t, m: LETTER[ch] }); t += perLetter; continue; }
    if (ch === ' ') { t += perLetter * 0.5; continue; }
    if (/[.,;:!?]/.test(ch)) { out.push({ t, m: 'rest' }); t += perLetter * 3; }
  }
  out.push({ t, m: 'rest' });
  return out;
}
const ease = (x) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
// The mouth at `t` seconds into a track, or null once it's over. Each shape eases in from the last.
export function mouthAt(track, t) {
  if (!track.length || t < track[0].t - EASE) return null;
  const end = track[track.length - 1].t;
  if (t > end + EASE) return null;
  let lo = 0, hi = track.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (track[mid].t <= t) lo = mid; else hi = mid - 1; }
  const a = MOUTHS[(track[lo - 1] || { m: 'rest' }).m], b = MOUTHS[track[lo].m], k = ease((t - track[lo].t) / EASE), out = {};
  for (const key of Object.keys(b)) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
}
