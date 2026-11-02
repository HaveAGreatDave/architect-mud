// The BS.1770 meter the loudness gates share: K-weighting, the 400 ms blocks and LUFS.
//
//   import { kWeight, blocks, lufs, momentaryMax } from './loudness-lib.mjs';
//
// loudness-smoke.mjs measures every cue preset with it, and modes-smoke.mjs measures a
// modal hit against the path it replaced with the same code, so the two can't disagree
// about what "as loud" means.

// The two BS.1770 stages (a +4 dB high shelf and a 38 Hz high-pass) designed from their analog
// prototypes, so the coefficients are right at any rate, not only 48 kHz.
export function kWeight(d, fs) {
  let K = Math.tan(Math.PI * 1681.974450955533 / fs), Q = 0.7071752369554196;
  const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  K = Math.tan(Math.PI * 38.13547087602444 / fs); Q = 0.5003270373238773; a0 = 1 + K / Q + K * K;
  const hp = [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  const y = Float64Array.from(d);
  for (const [b0, b1, b2, a1, a2] of [shelf, hp]) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const x = y[i], v = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = v; y[i] = v;
    }
  }
  return y;
}
export const lufs = (meanSquare) => -0.691 + 10 * Math.log10(meanSquare);
// Mean square of every 400 ms block, 100 ms apart, from sample `from`.
export function blocks(y, fs, from = 0) {
  const n = Math.round(0.4 * fs), hop = Math.round(0.1 * fs), out = [];
  for (let i = from; i + n <= y.length; i += hop) { let s = 0; for (let j = i; j < i + n; j++) s += y[j] * y[j]; out.push(s / n); }
  return out;
}
// A one-shot's maximum momentary loudness, padded to 400 ms as loudness-smoke pads it.
export function momentaryMax(d, fs) {
  if (d.length < 0.4 * fs) { const pad = new Float32Array(Math.ceil(0.4 * fs)); pad.set(d); d = pad; }
  const z = blocks(kWeight(d, fs), fs);
  return z.length ? lufs(Math.max(...z)) : -Infinity;
}

// Targets in LUFS, by `kind:category`, then by kind. Starting points: the median of each group as
// of 2026-10-18, rounded. They're a judgement, not a measurement; move one deliberately, then
// --update.
export const TARGETS = {
  'sfx:ui': -20,
  'sfx:combat': -16,
  'sfx:cyberpunk': -15,   // was -11, the median of one-oscillator beeps; the rebuilt cues sit just under combat
  'sfx:tv': -19,
  'loop:environment': -20,
  'loop:tv': -35,
  sfx: -16,
  loop: -20,
};
// A one-shot that sounds for under SHORT seconds is measured as the loudest 400 ms window with
// most of the window silent, so at the same peak it reads several LU quieter than a longer cue,
// as it sounds. Holding it to the full target meant peaking over full scale (the shots and
// punches before 2026-11-02 peaked at up to +4 dBFS and leaned on the master limiter). Its
// target is SHORT_LU lower instead.
export const SHORT = 0.25, SHORT_LU = 4;
export const targetOf = (kind, category, soundSeconds = Infinity) =>
  (TARGETS[`${kind}:${category}`] ?? TARGETS[kind]) - (kind === 'sfx' && soundSeconds < SHORT ? SHORT_LU : 0);
// How long a render sounds: to where it last sits within 60 dB of its peak.
export function soundLength(x, sr) {
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  const floor = peak * 1e-3, w = Math.round(sr * 0.001);
  for (let i = x.length - w; i > 0; i -= w) { let s = 0; for (let j = i; j < i + w; j++) s += x[j] * x[j]; if (Math.sqrt(s / w) > floor) return (i + w) / sr; }
  return 0;
}
