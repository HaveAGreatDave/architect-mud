// fit-prosody.mjs: fit a voice's speed, pitch, pitch range and declination to a speaker.
//
//   node tools/voice-fit/fit-prosody.mjs <voice.json> <segs.json> <speaker prosody.json> [rounds]
//
// Each round renders the lines (render-segs.mjs), measures them as the speaker was
// measured (prosody.py), and moves each setting by the ratio between the two:
//   speed  by the articulation rate
//   f0     by the median pitch (in semitones)
//   lilt   by the pitch range (10th to 90th percentile)
//   decl   by the declination slope
// The settings interact a little (a wider lilt moves the median), so it takes a few
// rounds. The voice file gets the result under `voice`, and the history under `prosody`.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const [, , VOICE, SEGS, YOU, ROUNDS = '4'] = process.argv;
const PY = process.env.PY || join(process.env.USERPROFILE || '', 'Hunyuan3D-2/.venv/Scripts/python.exe');
const file = JSON.parse(readFileSync(VOICE, 'utf8'));

globalThis.window = globalThis;
for (const f of ['formant-cmudict', 'audio-engine']) new Function(readFileSync(join(ROOT, `client/shared/${f}.js`), 'utf8'))();
// Where the voice starts: its own settings over the rolled voice it's built on.
const rolled = globalThis.AudioEngine._voiceFor('Vox Rime');
const v = { speed: rolled.speed, lilt: rolled.lilt, decl: rolled.decl, ...file.voice };

const tmp = (n) => join(HERE, 'out', n);
function measure() {
  writeFileSync(tmp('fp-voice.json'), JSON.stringify({ voice: v }));
  execFileSync('node', [join(HERE, 'render-segs.mjs'), tmp('fp-voice.json'), SEGS, tmp('fp.wav'), tmp('fp-seg.json')]);
  execFileSync(PY, [join(HERE, 'prosody.py'), tmp('fp.wav'), tmp('fp-seg.json'), tmp('fp.json')], { cwd: HERE });
  return JSON.parse(execFileSync('node', [join(HERE, 'compare-prosody.mjs'), YOU, tmp('fp.json'), SEGS, '--json']).toString());
}
const hist = [];
for (let r = 0; r <= +ROUNDS; r++) {
  const { you, voice: got } = measure();
  hist.push({ round: r, speed: +v.speed.toFixed(3), f0: +v.f0.toFixed(1), lilt: +v.lilt.toFixed(4), decl: +v.decl.toFixed(4),
    rate: +got.rate.toFixed(2), f0med: +got.f0med.toFixed(2), range: +got.range.toFixed(2), slope: +got.slope.toFixed(2), final: +got.final.toFixed(2) });
  const h = hist.at(-1);
  console.log(`round ${r}: speed ${h.speed} f0 ${h.f0} lilt ${h.lilt} decl ${h.decl} -> rate ${h.rate} (you ${you.rate.toFixed(2)}), median ${h.f0med} (${you.f0med.toFixed(2)}), range ${h.range} (${you.range.toFixed(2)}), slope ${h.slope} (${you.slope.toFixed(2)})`);
  if (r === +ROUNDS) { file.prosody = { you, rounds: hist }; break; }
  v.speed *= you.rate / got.rate;
  v.f0 *= 2 ** ((you.f0med - got.f0med) / 12);
  v.lilt *= Math.max(0.5, Math.min(2, you.range / got.range));
  v.decl *= Math.max(0.5, Math.min(2, you.slope / got.slope));
}
file.voice = { ...file.voice, speed: +v.speed.toFixed(3), f0: +v.f0.toFixed(1), lilt: +v.lilt.toFixed(4), decl: +v.decl.toFixed(4) };
writeFileSync(VOICE, JSON.stringify(file, null, 1));
