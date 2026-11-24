// render-lines.mjs: say Part 1 of the recording script in a voice, as a recording would be,
// so analyze.py can measure the synth the way it measured the speaker.
//
//   node tools/voice-fit/render-lines.mjs <voice.json> <out dir> [stock]
//
// Writes <out dir>/part1.wav and <out dir>/lines.json (clip times per line, in match.mjs's
// shape). With `stock`, the same rolled voice without the fitted tables.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from './synth.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [, , VOICE, OUTDIR, MODE] = process.argv;
const fitted = JSON.parse(readFileSync(VOICE, 'utf8')).voice;
const voice = MODE === 'stock' ? { f0: fitted.f0 } : fitted;
const { render, wav, SR } = await setup();
const lines = readFileSync(join(ROOT, 'data/voice/oracle-recording-script.txt'), 'utf8')
  .split(/\r?\n/).map(l => /^(\d{3})\t(.*?)(\s*\[.*\])?$/.exec(l)).filter(Boolean)
  .map(m => ({ n: +m[1], text: m[2] })).filter(l => l.n <= 135);
const gap = Math.round(0.5 * SR), parts = [], meta = [];
let at = gap;
for (const l of lines) {
  const x = render(l.text, voice);
  parts.push([at, x]);
  meta.push({ part: 'part1', n: l.n, text: l.text, t0: +(at / SR - 0.05).toFixed(3), t1: +((at + x.length) / SR).toFixed(3), heard: l.text, words: [] });
  at += x.length + gap;
}
const out = new Float32Array(at);
for (const [o, x] of parts) out.set(x, o);
mkdirSync(OUTDIR, { recursive: true });
wav(join(OUTDIR, 'part1.wav'), out, 44100);
writeFileSync(join(OUTDIR, 'lines.json'), JSON.stringify(meta));
console.log(`${meta.length} lines, ${(at / SR).toFixed(0)} s`);
