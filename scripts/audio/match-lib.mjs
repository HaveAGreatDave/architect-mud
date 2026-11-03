// MATCH LIB: the analysis, the distance and the search that sound-match.mjs uses to fit a SIREN
// cue to a recording. Nothing here ships to a client.
//
//   import { readWav, analyse, Distance, cmaes, ... } from './match-lib.mjs';
//
// The approach is analysis first, search second. A plain spectral distance over FM parameters has
// a landscape full of false valleys: move a ratio a little and every sideband moves to a bin the
// target doesn't have, so the distance gets worse before it gets better and a local search never
// finds the right ratio. So the discrete choices (carrier wave, operator ratios, which template)
// are read off the recording's partials and enumerated, and the search only moves the smooth
// parameters (index, its sweep, the envelope, the filter), where the distance is well behaved.
// That's the arrangement the sound-matching literature settles on: Horner, Beauchamp & Haken fixed
// the carrier from the harmonic analysis and let a GA search the rest; DDX7 keeps the ratios fixed
// for the same reason. See docs/reference/fm-sound-matching.md.
//
// The distance is multi-resolution: log-magnitude spectra at four window sizes (fine in time at
// 256, fine in frequency at 2048), plus spectral convergence and a loudness envelope. One window
// size alone either smears the attack or can't resolve the partials.

import { readFileSync } from 'node:fs';

// ── WAV in ───────────────────────────────────────────────────────────────────
// PCM 8/16/24/32-bit and float 32/64, any channel count, mixed down to mono.
export function readWav(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path}: not a RIFF WAVE file`);
  let fmt = null, data = null;
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') data = b.subarray(o + 8, Math.min(b.length, o + 8 + size));
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${path}: no fmt or data chunk`);
  let { tag, ch, sr, bits } = fmt;
  if (tag === 0xfffe) tag = bits >= 32 && data.length % (ch * 4) === 0 && bits === 32 ? 3 : 1;   // extensible: assume PCM unless float-sized
  const bps = bits / 8, n = Math.floor(data.length / (bps * ch)), out = new Float32Array(n);
  const read = (o) => {
    if (tag === 3) return bits === 64 ? data.readDoubleLE(o) : data.readFloatLE(o);
    if (bits === 8) return (data[o] - 128) / 128;
    if (bits === 16) return data.readInt16LE(o) / 32768;
    if (bits === 24) return (data[o] | (data[o + 1] << 8) | (data[o + 2] << 24 >> 8)) / 8388608;
    return data.readInt32LE(o) / 2147483648;
  };
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < ch; c++) s += read((i * ch + c) * bps); out[i] = s / ch; }
  return { samples: out, sampleRate: sr };
}

// Band-limited enough for analysis: a windowed-sinc low-pass before a linear-phase resample.
export function resample(x, from, to) {
  if (from === to) return Float32Array.from(x);
  const ratio = to / from, n = Math.floor(x.length * ratio), y = new Float32Array(n);
  const cut = Math.min(1, ratio) * 0.95, half = 16;
  for (let i = 0; i < n; i++) {
    const c = i / ratio, k0 = Math.floor(c);
    let s = 0, w = 0;
    for (let k = k0 - half + 1; k <= k0 + half; k++) {
      if (k < 0 || k >= x.length) continue;
      const t = c - k, sinc = t === 0 ? 1 : Math.sin(Math.PI * cut * t) / (Math.PI * cut * t);
      const win = 0.5 + 0.5 * Math.cos(Math.PI * t / half);
      s += x[k] * sinc * win; w += sinc * win;
    }
    y[i] = w ? s / w : 0;
  }
  return y;
}

// From the first sample within 40 dB of the peak to where the level stays 60 dB under it.
export function trim(x, sr) {
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  if (!peak) return x;
  const on = peak * 0.01, off = peak * 0.001, win = Math.round(sr * 0.005);
  let a = 0; while (a < x.length && Math.abs(x[a]) < on) a++;
  a = Math.max(0, a - win);
  let z = x.length - 1; while (z > a && Math.abs(x[z]) < off) z--;
  return x.subarray(a, Math.min(x.length, z + win));
}

// ── FFT ──────────────────────────────────────────────────────────────────────
const fftCache = new Map();
function plan(n) {
  let p = fftCache.get(n);
  if (p) return p;
  const rev = new Uint32Array(n), bits = Math.log2(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = -Math.sin(2 * Math.PI * i / n); }
  const hann = new Float64Array(n);
  for (let i = 0; i < n; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  p = { rev, cos, sin, hann, re: new Float64Array(n), im: new Float64Array(n) };
  fftCache.set(n, p);
  return p;
}
// Magnitude spectrum (n/2+1 bins) of x[from..from+n), Hann-windowed, zero past the end.
export function magSpectrum(x, from, n, out = new Float64Array(n / 2 + 1), win = n) {
  const { rev, cos, sin, hann, re, im } = plan(n);
  const wh = win === n ? hann : null;
  for (let i = 0; i < n; i++) {
    const j = from + i;
    let w = 0;
    if (i < win) w = wh ? wh[i] : 0.5 - 0.5 * Math.cos(2 * Math.PI * i / win);
    re[rev[i]] = j >= 0 && j < x.length && i < win ? x[j] * w : 0;
    im[rev[i]] = 0;
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2, step = n / size;
    for (let s = 0; s < n; s += size) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * step], si = sin[k * step], a = s + k, b = a + half;
        const tr = re[b] * c - im[b] * si, ti = re[b] * si + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  for (let k = 0; k <= n / 2; k++) out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  return out;
}

// ── analysis ─────────────────────────────────────────────────────────────────
const rms = (x, a, n) => { let s = 0, c = 0; for (let i = a; i < a + n && i < x.length; i++) { s += x[i] * x[i]; c++; } return c ? Math.sqrt(s / c) : 0; };
const db = (v) => 20 * Math.log10(Math.max(1e-9, v));

// YIN (de Cheveigné & Kawahara 2002): the period with the lowest cumulative-mean difference
// under the threshold. Returns { f0, aperiodicity } or null.
export function yin(x, sr, from, n = 2048, fmin = 30, fmax = 5000) {
  const tauMin = Math.max(2, Math.floor(sr / fmax)), tauMax = Math.min(Math.floor(n / 2), Math.ceil(sr / fmin));
  if (from + n + tauMax > x.length) n = x.length - from - tauMax;
  if (n < 256) return null;
  const d = new Float64Array(tauMax + 1);
  for (let t = 1; t <= tauMax; t++) { let s = 0; for (let i = 0; i < n; i++) { const v = x[from + i] - x[from + i + t]; s += v * v; } d[t] = s; }
  let run = 0; const cm = new Float64Array(tauMax + 1); cm[0] = 1;
  for (let t = 1; t <= tauMax; t++) { run += d[t]; cm[t] = run ? d[t] * t / run : 1; }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cm[t] < 0.15) { while (t + 1 <= tauMax && cm[t + 1] < cm[t]) t++; tau = t; break; }
  }
  if (tau < 0) { let best = Infinity; for (let t = tauMin; t <= tauMax; t++) if (cm[t] < best) { best = cm[t]; tau = t; } }
  const a = cm[tau - 1] ?? cm[tau], b = cm[tau], c = cm[tau + 1] ?? cm[tau];
  const shift = (a - 2 * b + c) ? 0.5 * (a - c) / (a - 2 * b + c) : 0;
  return { f0: sr / (tau + shift), aperiodicity: b };
}

// Spectral peaks of one frame, parabolic-interpolated, strongest first. Peaks closer than 1.5%,
// or than the window's main lobe (`lobeHz`), are one partial: a short window's sidelobes are not.
function peaks(mag, sr, n, floorDb = -50, max = 12, lobeHz = 0) {
  let top = 0; for (const v of mag) top = Math.max(top, v);
  const floor = top * Math.pow(10, floorDb / 20), out = [];
  for (let k = 2; k < mag.length - 1; k++) {
    if (mag[k] > floor && mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) {
      const a = Math.log(mag[k - 1] + 1e-12), b = Math.log(mag[k] + 1e-12), c = Math.log(mag[k + 1] + 1e-12);
      const p = (a - 2 * b + c) ? 0.5 * (a - c) / (a - 2 * b + c) : 0;
      out.push({ freq: (k + p) * sr / n, amp: Math.exp(b - 0.25 * (a - c) * p) / top, bin: k });
    }
  }
  out.sort((x, y) => y.amp - x.amp);
  const merged = [];
  for (const p of out) if (!merged.some((m) => Math.abs(m.freq - p.freq) < Math.max(0.015 * m.freq, lobeHz))) merged.push(p);
  return merged.slice(0, max);
}

// Everything the templates need, read off the recording:
//   env: 5 ms RMS frames in dB re the peak; attack (10%..90% of peak), the time to the peak,
//   a decay time constant fitted after the peak, a sustain estimate, and where it falls to -60 dB;
//   pitch: YIN frames, the f0 just after the attack and at the end (for a bend), its confidence;
//   partials: the strongest peaks just after the attack, each with its own T60;
//   harmonicity: the energy share of partials within 3% of a multiple of f0;
//   noisiness: mean spectral flatness 100 Hz..8 kHz; centroid: per frame, Hz.
export function analyse(x, sr) {
  const hop = Math.round(sr * 0.005), env = [];
  let peak = 0, peakAt = 0;
  for (let i = 0; i + hop <= x.length; i += hop) { const v = rms(x, i, hop); env.push(v); if (v > peak) { peak = v; peakAt = env.length - 1; } }
  const envDb = env.map((v) => db(v / (peak || 1)));
  const t = (k) => k * hop / sr;
  const i10 = envDb.findIndex((v) => v > -20), i90 = envDb.findIndex((v) => v > -0.9);
  const attack = Math.max(0.0005, t(Math.max(0, i90 - Math.max(0, i10))));
  // decay: least squares of dB on time over the stretch from the peak down to -40 dB
  let k1 = peakAt; while (k1 < envDb.length - 1 && envDb[k1] > -40) k1++;
  const fitSlope = (a, b) => {
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    for (let k = a; k <= b; k++) { const xx = t(k), yy = envDb[k]; sx += xx; sy += yy; sxx += xx * xx; sxy += xx * yy; n++; }
    return n > 2 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : 0;
  };
  const slope = fitSlope(peakAt, Math.max(peakAt + 3, k1));    // dB per second, negative
  const t60 = slope < -1 ? Math.min(20, -60 / slope) : 20;
  // sustain: the median level over the middle half of the body, re the peak
  const body = envDb.slice(peakAt, k1 > peakAt + 8 ? k1 : envDb.length).filter(Number.isFinite);
  const mid = body.slice(Math.floor(body.length * 0.25), Math.ceil(body.length * 0.75)).sort((a, b) => a - b);
  const sustainDb = mid.length ? mid[Math.floor(mid.length / 2)] : -60;
  const end60 = (() => { let k = envDb.length - 1; while (k > peakAt && envDb[k] < -60) k--; return t(k + 1); })();
  // a flat body that falls off at the end is a held sound: the hold is where it last sits above -6 dB of its median
  let holdEnd = peakAt; for (let k = peakAt; k < envDb.length; k++) if (envDb[k] > sustainDb - 6) holdEnd = k;

  // pitch
  const N = 2048, frames = [];
  for (let i = 0; i + N * 1.5 < x.length; i += Math.round(sr * 0.01)) {
    if (rms(x, i, N) < peak * 0.03) continue;
    const y = yin(x, sr, i, N);
    if (y) frames.push({ t: i / sr, ...y });
  }
  const good = frames.filter((f) => f.aperiodicity < 0.2);
  const after = good.filter((f) => f.t >= t(peakAt) - 0.005);
  const median = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const f0Raw = median(after.slice(0, 6).map((f) => f.f0)) ?? median(good.map((f) => f.f0));
  const f0Start = good.length ? median(good.slice(0, 3).map((f) => f.f0)) : f0Raw;
  const f0End = good.length ? median(good.slice(-3).map((f) => f.f0)) : f0Raw;
  const periodic = frames.length ? good.length / frames.length : 0;

  // partials: an 8192-point zero-padded spectrum of up to 200 ms, starting just past the peak so a
  // click or a noise burst on the onset doesn't put peaks where no partial rings
  const pFrom = Math.min(x.length - 512, peakAt * hop + Math.round(sr * 0.01));
  const PN = 8192, win = Math.max(256, Math.min(PN, Math.round(sr * 0.2), x.length - pFrom));
  const pmag = magSpectrum(x, pFrom, PN, undefined, win);
  const ps = peaks(pmag, sr, PN, -45, 12, 2.5 * sr / win);
  // each partial's decay: its bin tracked through 2048-point frames
  const TN = 2048, th = Math.round(sr * 0.01), tracks = ps.map(() => []), buf = new Float64Array(TN / 2 + 1);
  for (let i = peakAt * hop; i + TN <= x.length; i += th) {
    magSpectrum(x, i, TN, buf);
    ps.forEach((p, j) => { const b = Math.round(p.freq * TN / sr); tracks[j].push(Math.max(buf[b - 1] || 0, buf[b], buf[b + 1] || 0)); });
  }
  for (const [j, p] of ps.entries()) {
    const tr = tracks[j].map(db), top = Math.max(...tr);
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    for (let k = 0; k < tr.length; k++) { if (tr[k] < top - 45) break; const xx = k * th / sr; sx += xx; sy += tr[k]; sxx += xx * xx; sxy += xx * tr[k]; n++; }
    const s = n > 3 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : -60 / Math.max(0.05, t60);
    // a partial can't outlast the sound by much: one that never falls is room tone or hum
    p.t60 = Math.min(s < -1 ? -60 / s : 20, Math.max(2 * t60, x.length / sr));
  }
  // YIN can land an octave under a thin spectrum (a glass's one partial). If the strongest partial
  // sits on 2·f0 and nothing sits on the odd multiples, the strongest partial is the pitch.
  let f0 = f0Raw;
  if (f0 && ps.length) {
    const strong = ps[0].freq, k = Math.round(strong / f0);
    const odd = ps.some((p) => { const j = p.freq / f0; return Math.abs(j - Math.round(j)) < 0.03 && Math.round(j) % 2 === 1 && p.amp > 0.05; });
    if (k >= 2 && Math.abs(strong / (k * f0) - 1) < 0.03 && !odd) f0 = strong;
    // above ~1.5 kHz a YIN lag is a few samples and a peak bin is finer
    const near = ps.find((p) => Math.abs(p.freq / f0 - 1) < 0.05);
    if (f0 > 1500 && near) f0 = near.freq;
  }
  // octave errors at the ends aren't a bend: fold them to within half an octave of f0
  const fold = (v) => { if (!v || !f0) return v; while (v < f0 / 1.41) v *= 2; while (v > f0 * 1.41) v /= 2; return v; };
  // bursts: separate onsets in the first 150 ms (a clap is three or four hands, 10-20 ms apart)
  // (on a 2 ms envelope: at 5 ms the dips between hands are averaged away)
  const fh = Math.round(sr * 0.002), fine = [];
  for (let i = 0; i + fh <= x.length && i < sr * 0.15; i += fh) fine.push(db(rms(x, i, fh) / (peak || 1)));
  const bursts = [0];
  for (let k = 4; k < fine.length; k++) {
    const dip = Math.min(...fine.slice(Math.max(0, k - 4), k));
    const isPeak = fine[k] >= fine[k - 1] && fine[k] >= (fine[k + 1] ?? -99);
    if (k * fh / sr > 0.06 || bursts.length >= 4) break;
    if (isPeak && fine[k] > -10 && fine[k] - dip > 6 && k * fh / sr - bursts[bursts.length - 1] > 0.006) bursts.push(+(k * fh / sr - 0.002).toFixed(4));
  }
  let harmonicity = 0;
  if (f0) {
    let e = 0, h = 0;
    for (const p of ps) { const k = Math.max(1, Math.round(p.freq / f0)); e += p.amp * p.amp; if (Math.abs(p.freq - k * f0) / f0 < 0.03) h += p.amp * p.amp; }
    harmonicity = e ? h / e : 0;
  }

  // flatness and centroid on 1024-point frames
  const FN = 1024, fm = new Float64Array(FN / 2 + 1), centroid = [];
  let flatSum = 0, flatN = 0;
  const lo = Math.ceil(100 * FN / sr), hi = Math.min(FN / 2, Math.floor(8000 * FN / sr));
  for (let i = 0; i + FN <= x.length; i += FN / 2) {
    if (rms(x, i, FN) < peak * 0.03) continue;
    magSpectrum(x, i, FN, fm);
    let lg = 0, ar = 0, num = 0, den = 0;
    for (let k = lo; k <= hi; k++) { const p = fm[k] * fm[k] + 1e-20; lg += Math.log(p); ar += p; }
    for (let k = 1; k <= FN / 2; k++) { num += k * sr / FN * fm[k]; den += fm[k]; }
    const nb = hi - lo + 1;
    flatSum += Math.exp(lg / nb) / (ar / nb); flatN++;
    centroid.push({ t: i / sr, hz: den ? num / den : 0 });
  }
  return {
    sr, length: x.length / sr, peak: Math.max(...Array.from(x, Math.abs)),
    env: { hop: hop / sr, db: envDb, attack, peakAt: t(peakAt), t60, sustainDb, end60, holdEnd: t(holdEnd), bursts, held: t60 >= 6 },
    // (above 1.5 kHz YIN's ends are too coarse to call a bend)
    pitch: { f0, f0Start: f0 > 1500 ? f0 : fold(f0Start), f0End: f0 > 1500 ? f0 : fold(f0End), periodic, frames: good.length },
    partials: ps.map(({ freq, amp, t60 }) => ({ freq, amp, t60 })),
    harmonicity, noisiness: flatN ? flatSum / flatN : 1, centroid,
  };
}

// ── the distance ─────────────────────────────────────────────────────────────
// Built once per target. `of(candidate)` returns { total, spec, conv, env }: 0 is identical.
// Both signals are scaled to the same RMS first, so the level is not part of the fit (the CLI sets
// the gain afterwards), and the target's log spectra are cached.
const FLOOR_DB = 55;
export class Distance {
  constructor(target, sr, { sizes = [2048, 1024, 512, 256], envWeight = 0.5, convWeight = 1 } = {}) {
    this.sr = sr; this.sizes = sizes; this.n = target.length; this.envWeight = envWeight; this.convWeight = convWeight;
    this.target = this.norm(target);
    this.ref = sizes.map((s) => this.stft(this.target, s));
    // The log floor is relative: FLOOR_DB under the loudest bin of the target at that window
    // size. A fixed tiny floor made a recording's room tone (40-60 dB down, in every bin) count
    // as a full-size error against a synth's digital silence, and that error swamped the partials.
    this.eps = this.ref.map((A) => { let m = 0; for (const a of A) for (const v of a) if (v > m) m = v; return Math.max(1e-9, m * Math.pow(10, -FLOOR_DB / 20)); });
    this.refLog = this.ref.map((A, j) => A.map((a) => a.map((v) => Math.log(v + this.eps[j]))));
    this.refEnv = this.envelope(this.target);
  }
  norm(x) {
    const y = new Float32Array(this.n); y.set(x.subarray(0, this.n));
    let s = 0; for (const v of y) s += v * v;
    const g = s ? 1 / Math.sqrt(s / this.n) : 0;
    for (let i = 0; i < y.length; i++) y[i] *= g;
    return y;
  }
  // Magnitudes smoothed over ±4% in frequency (at least two bins) and over three frames in time,
  // power-averaged. Unsmoothed, two takes of the same noise patch scored 1.03 apart, because a
  // noise spectrum's bins scatter randomly take to take; smoothed, they agree, and a sine's
  // position still reads to within a quarter-tone.
  stft(x, n) {
    const hop = n / 2, raw = [];
    // (50% overlap: Hann at 50% sums flat, and the distance costs half what 75% did)
    for (let i = -n / 2; i < x.length - n / 4; i += hop) {
      const m = magSpectrum(x, i, n), K = m.length, cum = new Float64Array(K + 1);
      for (let k = 0; k < K; k++) cum[k + 1] = cum[k] + m[k] * m[k];
      const p = new Float64Array(K);
      for (let k = 0; k < K; k++) {
        const w = Math.max(2, Math.round(0.04 * k)), a = Math.max(0, k - w), b = Math.min(K, k + w + 1);
        p[k] = (cum[b] - cum[a]) / (b - a);
      }
      raw.push(p);
    }
    return raw.map((p, f) => {
      const a = raw[f - 1], b = raw[f + 1], out = new Float64Array(p.length);
      for (let k = 0; k < p.length; k++) out[k] = Math.sqrt((p[k] * 2 + (a ? a[k] : p[k]) + (b ? b[k] : p[k])) / 4);
      return out;
    });
  }
  envelope(x) {
    const hop = Math.round(this.sr * 0.01), out = [];
    for (let i = 0; i < x.length; i += hop) out.push(Math.max(-60, db(rms(x, i, hop) + 1e-9)));
    return out;
  }
  of(cand) {
    const y = this.norm(cand);
    let spec = 0, conv = 0;
    for (const [j, n] of this.sizes.entries()) {
      const A = this.ref[j], L = this.refLog[j], B = this.stft(y, n), eps = this.eps[j];
      let l1 = 0, cnt = 0, dn = 0, dd = 0;
      for (let f = 0; f < A.length; f++) {
        const a = A[f], la = L[f], b = B[f];
        for (let k = 1; k < a.length; k++) {
          l1 += Math.abs(la[k] - Math.log(b[k] + eps)); cnt++;
          const d = a[k] - b[k]; dd += d * d; dn += a[k] * a[k];
        }
      }
      spec += l1 / cnt; conv += Math.sqrt(dd / (dn || 1));
    }
    spec /= this.sizes.length; conv /= this.sizes.length;
    const e = this.envelope(y);
    let env = 0; for (let k = 0; k < this.refEnv.length; k++) env += Math.abs(this.refEnv[k] - (e[k] ?? -60));
    env = env / this.refEnv.length / 20;
    return { total: spec + this.convWeight * conv + this.envWeight * env, spec, conv, env };
  }
}

// ── CMA-ES ───────────────────────────────────────────────────────────────────
// (μ/μw, λ)-CMA-ES (Hansen's tutorial, 2016), full covariance, on the unit box: a sample outside
// [0,1] is mirrored back in. `f` takes a Float64Array in [0,1]^n and returns a number (async ok).
// Returns { x, f, evals }.
export async function cmaes(f, x0, { sigma = 0.25, evals = 300, seed = 1, lambda } = {}) {
  const n = x0.length;
  let rnd = seed >>> 0 || 1;
  const uni = () => { rnd ^= rnd << 13; rnd >>>= 0; rnd ^= rnd >>> 17; rnd ^= rnd << 5; rnd >>>= 0; return rnd / 4294967296; };
  const gauss = () => { let u = 0; while (!u) u = uni(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uni()); };
  lambda = lambda || 4 + Math.floor(3 * Math.log(n));
  const mu = Math.floor(lambda / 2);
  let w = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const ws = w.reduce((a, b) => a + b, 0); w = w.map((v) => v / ws);
  const mueff = 1 / w.reduce((a, b) => a + b * b, 0);
  const cc = (4 + mueff / n) / (n + 4 + 2 * mueff / n), cs = (mueff + 2) / (n + mueff + 5);
  const c1 = 2 / ((n + 1.3) ** 2 + mueff), cmu = Math.min(1 - c1, 2 * (mueff - 2 + 1 / mueff) / ((n + 2) ** 2 + mueff));
  const damps = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs, chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
  let m = Float64Array.from(x0), pc = new Float64Array(n), ps = new Float64Array(n);
  let C = Array.from({ length: n }, (_, i) => Float64Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  let B = C.map((r) => Float64Array.from(r)), D = new Float64Array(n).fill(1);
  const mirror = (v) => { v = ((v % 2) + 2) % 2; return v > 1 ? 2 - v : v; };
  let best = { x: Float64Array.from(m), f: await f(Float64Array.from(m).map(mirror)) }, count = 1, gen = 0;
  while (count + lambda <= evals) {
    gen++;
    const pop = [];
    for (let k = 0; k < lambda; k++) {
      const z = Float64Array.from({ length: n }, gauss), y = new Float64Array(n);
      for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += B[i][j] * D[j] * z[j]; y[i] = s; }
      const x = m.map((v, i) => mirror(v + sigma * y[i]));
      pop.push({ x, y: x.map((v, i) => (v - m[i]) / sigma), f: await f(x) });
      count++;
    }
    pop.sort((a, b) => a.f - b.f);
    if (pop[0].f < best.f) best = { x: pop[0].x, f: pop[0].f };
    const old = m;
    const yw = new Float64Array(n);
    for (let k = 0; k < mu; k++) for (let i = 0; i < n; i++) yw[i] += w[k] * pop[k].y[i];
    m = m.map((v, i) => v + sigma * yw[i]);
    // C^-1/2 · yw
    const t1 = new Float64Array(n), cy = new Float64Array(n);
    for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < n; i++) s += B[i][j] * yw[i]; t1[j] = s / D[j]; }
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += B[i][j] * t1[j]; cy[i] = s; }
    ps = ps.map((v, i) => (1 - cs) * v + Math.sqrt(cs * (2 - cs) * mueff) * cy[i]);
    const psn = Math.hypot(...ps);
    const hsig = psn / Math.sqrt(1 - (1 - cs) ** (2 * gen)) / chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
    pc = pc.map((v, i) => (1 - cc) * v + hsig * Math.sqrt(cc * (2 - cc) * mueff) * yw[i]);
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let r = 0; for (let k = 0; k < mu; k++) r += w[k] * pop[k].y[i] * pop[k].y[j];
      const v = (1 - c1 - cmu) * C[i][j] + c1 * (pc[i] * pc[j] + (1 - hsig) * cc * (2 - cc) * C[i][j]) + cmu * r;
      C[i][j] = C[j][i] = v;
    }
    sigma = Math.min(0.6, sigma * Math.exp((cs / damps) * (psn / chiN - 1)));
    ({ B, D } = eigen(C));
    if (sigma * Math.max(...D) < 1e-4) break;
    void old;
  }
  return { x: best.x, f: best.f, evals: count };
}

// Jacobi eigen-decomposition of a small symmetric matrix: C = B diag(D²) Bᵀ, D the square roots.
function eigen(C) {
  const n = C.length, A = C.map((r) => Float64Array.from(r));
  const V = Array.from({ length: n }, (_, i) => Float64Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-15) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const a = A[k][p], b = A[k][q]; A[k][p] = c * a - s * b; A[k][q] = s * a + c * b; }
      for (let k = 0; k < n; k++) { const a = A[p][k], b = A[q][k]; A[p][k] = c * a - s * b; A[q][k] = s * a + c * b; }
      for (let k = 0; k < n; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = c * a - s * b; V[k][q] = s * a + c * b; }
    }
  }
  return { B: V, D: Float64Array.from({ length: n }, (_, i) => Math.sqrt(Math.max(1e-20, A[i][i]))) };
}

// ── parameter spaces ─────────────────────────────────────────────────────────
// A space is a list of { path, lo, hi, log } over a cue config. `decode(space, z)` maps a point in
// the unit box to values; `apply(config, space, values)` writes them into a deep copy.
export const decode = (space, z) => space.map((p, i) => (p.log ? p.lo * Math.pow(p.hi / p.lo, z[i]) : p.lo + (p.hi - p.lo) * z[i]));
export const encode = (space, v) => space.map((p, i) => {
  const x = Math.min(p.hi, Math.max(p.lo, v[i]));
  return p.log ? Math.log(x / p.lo) / Math.log(p.hi / p.lo) : (x - p.lo) / (p.hi - p.lo);
});
export function apply(config, space, values) {
  const c = structuredClone(config);
  space.forEach((p, i) => {
    // a path list moves several values together (one filter shared by three claps)
    for (const path of Array.isArray(p.path) ? p.path : [p.path]) {
      const keys = path.split('.');
      let o = c;
      for (let k = 0; k < keys.length - 1; k++) { const key = /^\d+$/.test(keys[k]) ? +keys[k] : keys[k]; o[key] ??= {}; o = o[key]; }
      const last = keys[keys.length - 1];
      o[/^\d+$/.test(last) ? +last : last] = p.round ? Math.round(values[i] / p.round) * p.round : +values[i].toPrecision(4);
    }
  });
  return c;
}
