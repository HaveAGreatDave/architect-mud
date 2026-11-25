// effort.mjs: the fitted voice at each effort level (docs/proposals/delivery.md, phase 0).
//
//   node tools/voice-fit/ddsp/effort.mjs <out dir> [--wav <file>]
//
// Renders the lines below at effort -1, -0.5, 0, 1 and 2 through the real worklet and
// writes each as raw float32 at 48 kHz (<id>-<effort>.raw, the delivery's line gain
// applied, which the worklet doesn't see), with jobs.json listing them and their text.
// Prints each level's loudness, median F0 and voiced share against effort 0, and checks
// that a delivery of effort 0 renders the very same samples as no delivery.
// --wav writes one listening file: every line at each level in turn.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from '../synth.mjs';
import { voiceEffort } from '../../../client/shared/delivery.js';

const LINES = [
  'Get out of my shop.', 'I told you, the door was already open.', 'Hey! Over here!',
  'Nobody goes down there after dark.', 'Keep your voice down, they can hear us.',
  'The boats were knocking against each other in the harbour.', 'Watch out, the roof is coming down!',
  'Fine. Take it and go.', 'Did you see where he went?', 'Bring a coat, because it gets cold after dark.',
];
const LEVELS = [-1, -0.5, 0, 1, 2];
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const voice = JSON.parse(readFileSync('data/voice/fitted-voice.json', 'utf8')).voice;
const { render } = await setup();
function trackF0() { const L = render.last, n = L.names.length, fi = L.names.indexOf('f0'), ai = L.names.indexOf('av'); const f = []; let v = 0; for (let t = 0; t < L.frames; t++) { if (L.tracks[t * n + ai] > 0.3) { v++; f.push(L.tracks[t * n + fi]); } } f.sort((a, b) => a - b); return { f0: f.length ? f[f.length >> 1] : 0, voiced: v / L.frames }; }
const SR = 48000;

const rms = (x) => { let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length + 1e-12); };

const jobs = [], wav = [], stats = {};
let same = true;
for (const [i, text] of LINES.entries()) {
  const plain = render(text, voice), zero = render(text, voice, null, { delivery: voiceEffort(0) });
  if (plain.length !== zero.length || plain.some((v, k) => v !== zero[k])) same = false;
  for (const e of LEVELS) {
    const b = voiceEffort(e);
    const y = render(text, voice, null, b ? { delivery: b } : null).map((v) => v * (b ? b.gain : 1));
    const f = join(out, `${i}-${e}.raw`);
    writeFileSync(f, Buffer.from(y.buffer));
    jobs.push({ id: String(i), effort: e, text, raw: f });
    const s = trackF0(); (stats[e] ||= []).push({ db: rms(y), ...s });
    wav.push(y, new Float32Array(SR * 0.35));
  }
  wav.push(new Float32Array(SR * 0.5));
}
writeFileSync(join(out, 'jobs.json'), JSON.stringify(jobs, null, 1));
const mean = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
const base = stats[0];
for (const e of LEVELS) {
  const a = stats[e];
  console.log(`effort ${String(e).padStart(4)}: level ${(mean(a, 'db') - mean(base, 'db')).toFixed(1)} dB, F0 ${(12 * Math.log2(mean(a, 'f0') / mean(base, 'f0'))).toFixed(1)} st, voiced ${(100 * mean(a, 'voiced')).toFixed(0)}%`);
}
console.log(same ? 'effort 0 renders the same samples as no delivery' : 'x effort 0 changed the render');
const wi = process.argv.indexOf('--wav');
if (wi > 0) {
  const n = wav.reduce((s, x) => s + x.length, 0), all = new Float32Array(n); let o = 0;
  for (const x of wav) { all.set(x, o); o += x.length; }
  let pk = 0; for (const v of all) pk = Math.max(pk, Math.abs(v));
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + n * 2, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(n * 2, 40);
  for (let k = 0; k < n; k++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, all[k] / pk * 0.9)) * 32767), 44 + 2 * k);
  writeFileSync(process.argv[wi + 1], pcm);
}
if (!same) process.exit(1);
