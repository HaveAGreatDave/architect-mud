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
