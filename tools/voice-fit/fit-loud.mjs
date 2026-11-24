// fit-loud.mjs: fit a voice's fall in loudness across a sentence to the speaker's (Part 3).
//
//   node tools/voice-fit/fit-loud.mjs <voice.json> <segs.json> <speaker wav> <align.json> [rounds]
//
// measure-loud.py gives the slope of the accented vowels' level across a sentence and the
// drop after the nucleus, on the speaker (align.py's boundaries, the render's accents) and
// on a render. Each round moves the voice's `loudFall` by the slopes' difference and
// `postNuc` by the drops', in dB, and `unaccFall` (the share of the fall an unaccented
// vowel takes) by the ratio of the unaccented slopes, until the render measures as the
// speaker does. `unaccDb` (how far under the accents an unaccented vowel sits) moves by
// the difference in that contrast.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const [, , VOICE, SEGS, WAV, ALIGN, ROUNDS = '4'] = process.argv;
const PY = join(homedir(), 'Hunyuan3D-2/.venv/Scripts/python.exe');
const out = (f) => join(HERE, 'out', f);
const file = JSON.parse(readFileSync(VOICE, 'utf8'));
const py = (args) => JSON.parse(execFileSync(PY, ['measure-loud.py', ...args], { cwd: HERE, encoding: 'utf8' }).trim().split('\n').pop());
const render = (voice) => {
  writeFileSync(out('loud-voice.json'), JSON.stringify({ voice }));
  execFileSync('node', [join(HERE, 'render-trace.mjs'), out('loud-voice.json'), SEGS, out('loud-trace')], { stdio: 'ignore' });
  return py(['--trace', out('loud-trace')]);
};
// the speaker's accents are the render's, carried across: the first render's trace
let syn = render(file.voice);
const you = py([WAV, ALIGN, out('loud-trace/trace.json')]);
console.log('you  ', JSON.stringify(you));
const v = { ...file.voice, loudFall: file.voice.loudFall ?? 3, postNuc: file.voice.postNuc ?? 2, unaccFall: file.voice.unaccFall ?? 0.5, unaccDb: file.voice.unaccDb ?? 0 };
for (let r = 0; r < +ROUNDS; r++) {
  console.log(`round ${r}`, JSON.stringify(syn), `loudFall ${v.loudFall} postNuc ${v.postNuc} unaccFall ${v.unaccFall} unaccDb ${v.unaccDb}`);
  v.loudFall = +Math.max(0, v.loudFall + (syn.accented.slope_db - you.accented.slope_db)).toFixed(2);
  v.postNuc = +Math.max(0, v.postNuc + (syn.post_nuclear_db - you.post_nuclear_db)).toFixed(2);
  v.unaccFall = +Math.max(0, Math.min(1.5, v.unaccFall * you.unaccented.slope_db / Math.min(-0.1, syn.unaccented.slope_db))).toFixed(3);
  v.unaccDb = +Math.max(0, v.unaccDb + (syn.unaccented_vs_accented_db - you.unaccented_vs_accented_db)).toFixed(2);
  syn = render(v);
}
console.log('final', JSON.stringify(syn), `loudFall ${v.loudFall} postNuc ${v.postNuc} unaccFall ${v.unaccFall} unaccDb ${v.unaccDb}`);
file.voice.loudFall = v.loudFall; file.voice.postNuc = v.postNuc; file.voice.unaccFall = v.unaccFall; file.voice.unaccDb = v.unaccDb;
writeFileSync(VOICE, JSON.stringify(file, null, 1));
