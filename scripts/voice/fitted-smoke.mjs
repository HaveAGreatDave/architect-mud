// fitted-smoke.mjs: the fitted voice still sounds like its speaker.
//
//   node scripts/voice/fitted-smoke.mjs            check against the snapshot
//   node scripts/voice/fitted-smoke.mjs --update   write the snapshot
//
// data/voice/fitted-voice.json was fitted to one speaker's recording (tools/voice-fit):
// rate, pitch, pauses, durations, consonants, the r and l vowels, loudness and quality,
// and its per-vowel pitch controller.
// An engine change can move it away from him without any other gate noticing, since
// every other gate reads stock voices. This renders eight lines in it through the real
// worklet and compares each with the snapshot taken when the fit was last checked by ear:
// its length, its median pitch, and how its loudness falls from first half to second.
// A change that moves these on purpose re-takes the snapshot with --update, after
// listening (tools/voice-fit/README.md says how to re-measure against the recording).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tools/voice-fit/synth.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SNAP = join(ROOT, 'data/voice/fitted-voice-snapshot.json');
const voice = JSON.parse(readFileSync(join(ROOT, 'data/voice/fitted-voice.json'), 'utf8')).voice;
// Its pitch controller (docs/proposals/oracle-neural.md), with the outputs PyTorch gave for
// three lines: the engine's JavaScript must give the same, or the network isn't what was trained.
const pitchNet = JSON.parse(readFileSync(join(ROOT, 'data/voice/fitted-voice.pitch.json'), 'utf8'));
voice.pitchNet = pitchNet;
const LINES = [
  'She left her keys on the back seat of the cab.',
  'A thick fog rolled in off the water before dawn.',
  'Put the big box down by the garage door.',
  "It's cold out there, isn't it?",
  'Four girls pulled the real oil from the pool.',
  'And then, without a word, he was gone.',
  'We bought apples, pears, plums and grapes.',
  'The storm came in the afternoon. At first it was only a darker strip of cloud over the hills.',
];
const TOL = { len: 0.03, f0: 0.03, fall: 1.5 };   // share, share, dB

const { render, SR, A } = await setup();
let worst = 0;
for (const c of pitchNet.check) A._pitchCents(pitchNet, c.codes, c.at, c.acc).forEach((v, i) => { worst = Math.max(worst, Math.abs(v - c.cents[i])); });
if (!(worst < 0.5)) {
  console.log(`x fitted smoke: the pitch controller's JavaScript is ${worst.toFixed(2)} cents from PyTorch's (allowed 0.5)`);
  process.exit(1);
}
function stats(x) {
  // median F0 by autocorrelation over 40 ms frames that are loud and periodic
  const n = Math.round(0.04 * SR), hop = Math.round(0.02 * SR), lo = Math.round(SR / 300), hi = Math.round(SR / 55);
  const f0s = [], lev = [];
  let top = 0;
  for (let s = 0; s + n < x.length; s += hop) { let e = 0; for (let i = 0; i < n; i++) e += x[s + i] ** 2; lev.push(e / n); top = Math.max(top, e / n); }
  for (let f = 0, s = 0; s + n < x.length; s += hop, f++) {
    if (lev[f] < top * 0.05) continue;
    let best = 0, bk = 0;
    for (let k = lo; k <= hi; k += 2) { let c = 0; for (let i = 0; i < n - k; i += 2) c += x[s + i] * x[s + i + k]; if (c > best) { best = c; bk = k; } }
    if (best > 0.4 * lev[f] * n / 2) f0s.push(SR / bk);
  }
  f0s.sort((a, b) => a - b);
  const loud = lev.filter(e => e > top * 0.05), half = loud.length >> 1;
  const db = (a) => 10 * Math.log10(a.reduce((s, e) => s + e, 0) / a.length);
  return { len: +(x.length / SR).toFixed(3), f0: +(f0s[f0s.length >> 1] || 0).toFixed(1), fall: +(db(loud.slice(0, half)) - db(loud.slice(half))).toFixed(2) };
}
const got = LINES.map(t => stats(render(t, voice)));
if (process.argv.includes('--update')) {
  writeFileSync(SNAP, JSON.stringify(LINES.map((t, i) => ({ text: t, ...got[i] })), null, 1) + '\n');
  console.log('fitted-smoke: snapshot written');
  process.exit(0);
}
const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
let fails = 0;
got.forEach((g, i) => {
  const s = snap[i];
  const bad = [];
  if (Math.abs(g.len / s.len - 1) > TOL.len) bad.push(`length ${g.len}s against ${s.len}`);
  if (Math.abs(g.f0 / s.f0 - 1) > TOL.f0) bad.push(`pitch ${g.f0} Hz against ${s.f0}`);
  if (Math.abs(g.fall - s.fall) > TOL.fall) bad.push(`loudness fall ${g.fall} dB against ${s.fall}`);
  if (bad.length) { fails++; console.log(`  x "${s.text}": ${bad.join(', ')}`); }
});
if (fails) {
  console.log(`x fitted smoke: ${fails} of ${got.length} lines moved away from the fitted voice. If that's meant, listen, then --update.`);
  process.exit(1);
}
