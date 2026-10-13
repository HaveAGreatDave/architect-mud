// What hockey-render.mjs and hockey-smoke.mjs share: the real engine and soundset loaded on
// the offline renderer, a cue rendered, a render measured, and the crowd bed driven through
// every state.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OfflineContext, installAudioGlobals, wav } from './offline-audio.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SR = 48000;

export function loadHockey() {
  installAudioGlobals();
  if (!globalThis.AudioEngine) new Function(readFileSync(join(ROOT, 'client/shared/audio-engine.js'), 'utf8'))();
  if (!globalThis.HockeySfx) new Function(readFileSync(join(ROOT, 'client/shared/hockey-sfx.js'), 'utf8'))();
  const AE = globalThis.AudioEngine;
  AE._setRetroUrl(join(ROOT, 'client/shared/audio-retro-worklet.js'));
  return { AE, H: globalThis.HockeySfx, wav };
}

export const renderCue = (AE, cue, opts = {}) => AE.renderSfx(cue, { sampleRate: SR, ...opts });

// ── measuring ────────────────────────────────────────────────────────────────
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// Spectral centroid (Hz) and the share of energy under 150 Hz, over a Hann window of `n`
// samples starting at `from`.
export function spectrum(d, sr, from = 0, n = 4096) {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) { const x = d[from + i] || 0; re[i] = x * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1))); }
  fft(re, im);
  let e = 0, ef = 0, lo = 0;
  for (let k = 1; k < n / 2; k++) { const p = re[k] * re[k] + im[k] * im[k], hz = k * sr / n; e += p; ef += p * hz; if (hz < 150) lo += p; }
  return { centroid: e > 0 ? ef / e : 0, low: e > 0 ? lo / e : 0 };
}

export function measure(d, sr) {
  let peak = 0, sum = 0, finite = true, pkAt = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    if (!Number.isFinite(x)) { finite = false; continue; }
    const a = Math.abs(x);
    if (a > peak) { peak = a; pkAt = i; }
    sum += x;
  }
  const win = Math.round(sr / 1000);
  const env = [];
  for (let i = 0; i < d.length; i += win) { let m = 0; for (let j = i; j < Math.min(d.length, i + win); j++) m = Math.max(m, Math.abs(d[j]) || 0); env.push(m); }
  let attack = 0;
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) >= peak * 0.5) { attack = i; break; }
  // audible length: the last millisecond still within 50 dB of the peak
  const floor = peak * Math.pow(10, -50 / 20);
  let last = 0;
  for (let k = 0; k < env.length; k++) if (env[k] > floor) last = k;
  let ss = 0, cnt = 0;
  for (let i = 0; i < Math.min(d.length, (last + 1) * win); i++) { ss += d[i] * d[i]; cnt++; }
  // the render's last 2 ms: a cue that ends must have ended
  let tailMax = 0;
  for (let i = Math.max(0, d.length - 2 * win); i < d.length; i++) tailMax = Math.max(tailMax, Math.abs(d[i]) || 0);
  const from = Math.max(0, Math.min(d.length - 4096, pkAt - 512));
  const sp = spectrum(d, sr, from, 4096);
  return {
    finite, peak, rms: cnt ? Math.sqrt(ss / cnt) : 0, attackMs: attack / sr * 1000, lenMs: (last + 1), first: Math.abs(d[0] || 0),
    dc: peak > 0 ? Math.abs(sum / d.length) / peak : 0, tailMax, tail: tailMax < 1e-4 ? 'ok' : tailMax.toExponential(1),
    centroid: sp.centroid, low: sp.low,
  };
}

// ── the crowd bed, driven through every state ─────────────────────────────────
// Time-ordered, as a game drives it: each call acts at its own moment.
export const CROWD_SCRIPT = [
  [0, 'state', 'quiet'], [2.5, 'state', 'active'], [4.6, 'gasp'], [5, 'state', 'chance'], [6.2, 'state', 'shot'],
  [7, 'state', 'goal'], [7, 'duck'], [7.05, 'celebrate'], [11, 'state', 'penalty'], [13.5, 'state', 'quiet'],
];
export async function renderCrowd(AE, H, seconds = 16) {
  const off = new OfflineContext(1, Math.ceil(SR * seconds), SR);
  await AE.loadRetro(off);
  const eng = AE.engineNodes();
  const bed = H.crowdBed({ ctx: off, dest: off.destination, noise: eng.noise });
  bed.start(0);
  for (const [t, what, arg] of CROWD_SCRIPT) {
    if (what === 'state') bed.setState(arg, t);
    else if (what === 'duck') bed.duck(4, 0.8, t);
    else bed[what](t);
  }
  bed.stop(seconds - 1.8);
  const nodes0 = bed._nodes();
  const buf = await off.startRendering();
  const d = buf.getChannelData(0);
  let finite = true, maxStep = 0;
  for (let i = 1; i < d.length; i++) { if (!Number.isFinite(d[i])) finite = false; maxStep = Math.max(maxStep, Math.abs(d[i] - d[i - 1])); }
  // each state's level, over the second before the next one starts
  const marks = CROWD_SCRIPT.filter((s) => s[1] === 'state');
  const states = marks.map(([t, , name], k) => {
    const end = k + 1 < marks.length ? marks[k + 1][0] : seconds - 2;
    const a = Math.floor(Math.max(t, end - 1) * SR), b = Math.floor(end * SR);
    let ss = 0, pk = 0; for (let i = a; i < b; i++) { ss += d[i] * d[i]; pk = Math.max(pk, Math.abs(d[i])); }
    return { name, at: t, rms: Math.sqrt(ss / Math.max(1, b - a)), peak: pk, centroid: spectrum(d, SR, a, 8192).centroid };
  });
  let tail = 0; for (let i = d.length - SR * 0.1; i < d.length; i++) tail = Math.max(tail, Math.abs(d[i]));
  return { samples: d, sampleRate: SR, states, finite, maxStep, tail, nodes: nodes0, nodesAfter: bed._nodes() };
}
