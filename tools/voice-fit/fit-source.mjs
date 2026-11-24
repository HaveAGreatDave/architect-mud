// fit-source.mjs: fit a fitted voice's source brightness to the speaker's average spectrum.
//
//   node tools/voice-fit/fit-source.mjs <voice.json> <speaker part1.wav>
//
// fit.mjs gets the vowels right, but where the formants are says nothing about how bright
// the voice is: that's the glottal source. The first fitted voice was 2-3 dB heavy from
// 200 to 635 Hz and 4-6 dB short from 2 to 4 kHz against the speaker, and sounded nasal.
// This renders a sample of Part 1 over a grid of `bright` (the tilt corner) and `oq` (the
// open quotient: lower is more pressed and brighter), takes each one's long-term average
// spectrum in third octaves from 126 Hz to 4 kHz, and keeps the one closest to the
// speaker's. The voice file gets the winner.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from './synth.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [, , VOICE, SPEAKER] = process.argv;
const file = JSON.parse(readFileSync(VOICE, 'utf8'));

function readWav(p) {
  const b = readFileSync(p); let o = 12, sr = 0, ch = 1, bits = 16, data = null;
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(o + 10); sr = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22); }
    if (id === 'data') data = b.subarray(o + 8, o + 8 + sz);
    o += 8 + sz + (sz & 1);
  }
  if (bits !== 16) throw new Error('16-bit WAV only');
  const n = data.length / 2 / ch, x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < ch; c++) s += data.readInt16LE((i * ch + c) * 2); x[i] = s / ch / 32768; }
  return { x, sr };
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
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
// Third-octave long-term spectrum of the louder 40% of frames, in dB under its top band.
const EDGES = Array.from({ length: 16 }, (_, i) => 126 * 2 ** (i / 3));
function ltas(x, sr) {
  const N = 2048, hop = 1024, frames = [];
  for (let s = 0; s + N <= x.length; s += hop) { let e = 0; for (let i = 0; i < N; i++) e += x[s + i] ** 2; frames.push([s, e]); }
  const cut = [...frames].map(f => f[1]).sort((a, b) => a - b)[Math.floor(frames.length * 0.6)];
  const S = new Float64Array(N / 2 + 1);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (const [s, e] of frames) {
    if (e <= cut) continue;
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= N / 2; k++) S[k] += re[k] ** 2 + im[k] ** 2;
  }
  const bands = [];
  for (let b = 0; b + 1 < EDGES.length; b++) {
    let s = 0;
    for (let k = 0; k <= N / 2; k++) { const f = k * sr / N; if (f >= EDGES[b] && f < EDGES[b + 1]) s += S[k]; }
    bands.push(10 * Math.log10(s + 1e-20));
  }
  const top = Math.max(...bands);
  return bands.map(v => v - top);
}

const sp = readWav(SPEAKER);
const target = ltas(sp.x, sp.sr);
const { render, SR } = await setup();
const SAMPLE = ['heed', 'hid', 'had', 'hod', 'hood', "who'd", 'hud', 'heard', 'hayed', 'hide', 'hoed', "how'd", 'hoyed', 'beat', 'bat', 'dock', 'book', 'gut', 'date', 'kite', 'goat', 'doubt', 'coin']
  .map(w => `Say ${w} aloud.`);
const gap = new Float32Array(Math.round(0.3 * SR));
function score(voice) {
  const parts = SAMPLE.map(t => render(t, voice));
  const n = parts.reduce((s, p) => s + p.length + gap.length, 0), x = new Float32Array(n);
  let at = 0; for (const p of parts) { x.set(p, at); at += p.length + gap.length; }
  const l = ltas(x, SR), d = l.map((v, i) => v - target[i]);
  const mean = d.reduce((s, v) => s + v, 0) / d.length;
  return { rms: Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / d.length), d: d.map(v => v - mean) };
}
const base = file.voice;
let best = null;
for (const bright of [1, 1.15, 1.3, 1.4]) for (const oq of [0.4, 0.48, 0.56, 0.64]) {
  const r = score({ ...base, bright, oq });
  console.log(`bright ${bright.toFixed(2)} oq ${oq.toFixed(2)}  rms ${r.rms.toFixed(2)} dB`);
  if (!best || r.rms < best.rms) best = { ...r, bright, oq };
}
const before = score(base);
console.log(`\nbefore: rms ${before.rms.toFixed(2)} dB; best: bright ${best.bright}, oq ${best.oq}, rms ${best.rms.toFixed(2)} dB`);
console.log('band Hz      before  after   (synth minus speaker, level-matched)');
for (let i = 0; i < best.d.length; i++) console.log(`${EDGES[i].toFixed(0).padStart(5)}-${EDGES[i + 1].toFixed(0).padEnd(5)} ${before.d[i].toFixed(1).padStart(6)} ${best.d[i].toFixed(1).padStart(6)}`);
file.voice = { ...base, bright: best.bright, oq: best.oq };
file.source = { bright: best.bright, oq: best.oq, rmsBefore: +before.rms.toFixed(2), rmsAfter: +best.rms.toFixed(2) };
writeFileSync(VOICE, JSON.stringify(file, null, 1));
