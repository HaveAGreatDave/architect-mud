// render-trace.mjs: render lines one file each, with ORACLE's phone trace, for align.py.
//
//   node tools/voice-fit/render-trace.mjs <voice.json> <segs.json> <out dir>
//
// Writes <id>.wav per line and trace.json: { id: [{ p, at, acc?, nuc? }] }, `at` in seconds into the
// line's own file (the worklet's time 0 is the line's start).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from './synth.mjs';

const [, , VOICE, SEGS, OUT] = process.argv;
const voice = JSON.parse(readFileSync(VOICE, 'utf8')).voice;
const segs = JSON.parse(readFileSync(SEGS, 'utf8'));
const { render, wav } = await setup();
mkdirSync(OUT, { recursive: true });
const traces = {};
for (const s of segs) {
  const trace = [];
  const x = render(s.text, voice, trace);
  wav(join(OUT, `${s.id}.wav`), x);
  traces[s.id] = trace.map(t => ({ p: t.p, at: +t.at.toFixed(4), ...(t.acc ? { acc: t.acc } : {}), ...(t.nuc ? { nuc: t.nuc } : {}) }));
}
writeFileSync(join(OUT, 'trace.json'), JSON.stringify(traces));
console.log(`${segs.length} lines`);
