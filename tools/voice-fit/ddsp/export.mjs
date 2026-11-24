// export.mjs: what the worklet is given and what it plays, for the PyTorch twin.
//
//   node tools/voice-fit/ddsp/export.mjs <voice.json> <lines.json> <out dir> [max lines]
//
// For each line: <id>.f32 (the tracks, frames x NP, float32), <id>.wav (the worklet's
// render, presence peak included, as synth.mjs plays it), and an entry in index.json with
// the frame length, the track names, the per-line constants `k` and the phone trace.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from '../synth.mjs';

const [, , VOICE, LINES, OUT, MAX = '1e9'] = process.argv;
const voice = JSON.parse(readFileSync(VOICE, 'utf8')).voice;
const lines = JSON.parse(readFileSync(LINES, 'utf8')).slice(0, +MAX);
const { render, wav, SR, A } = await setup();
mkdirSync(OUT, { recursive: true });
const index = { sr: SR, presenceDb: A.voiceTuning.presenceDb, lines: {} };
for (const l of lines) {
  const id = String(l.id ?? l.n), trace = [];
  const x = render(l.text, voice, trace);
  const line = render.last;
  wav(join(OUT, `${id}.wav`), x);
  writeFileSync(join(OUT, `${id}.f32`), Buffer.from(new Float32Array(line.tracks).buffer));
  writeFileSync(join(OUT, `${id}.raw`), Buffer.from(x.buffer));   // unnormalised, for parity
  index.lines[id] = { text: l.text, frames: line.frames, frame: line.frame, names: line.names, k: line.k, po: line.processorOptions,
    trace: trace.map(t => ({ p: t.p, at: +t.at.toFixed(4), ...(t.acc ? { acc: 1 } : {}) })) };
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));
console.log(`${lines.length} lines to ${OUT}`);
