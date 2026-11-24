// render-segs.mjs: say a list of lines in a voice, one after another, with their times.
//
//   node tools/voice-fit/render-segs.mjs <voice.json> <segs.json> <out.wav> <out segs.json> [key=value ...]
//
// segs.json is a list of {id, text}. The output list has each line's t0/t1 in out.wav,
// for prosody.py. Extra key=value pairs override the voice (numbers), so a sweep can try
// speed=1.1 lilt=0.08 without editing the file.
import { readFileSync, writeFileSync } from 'node:fs';
import { setup } from './synth.mjs';

const [, , VOICE, SEGS, WAV, OUT, ...kv] = process.argv;
const voice = { ...JSON.parse(readFileSync(VOICE, 'utf8')).voice };
for (const p of kv) { const [k, v] = p.split('='); voice[k] = +v; }
const segs = JSON.parse(readFileSync(SEGS, 'utf8'));
const { render, wav, SR } = await setup();
const gap = Math.round(0.6 * SR), parts = [], meta = [];
let at = gap;
for (const s of segs) {
  const x = render(s.text, voice);
  parts.push([at, x]);
  meta.push({ id: s.id, text: s.text, t0: +(at / SR).toFixed(3), t1: +((at + x.length) / SR).toFixed(3) });
  at += x.length + gap;
}
const out = new Float32Array(at);
for (const [o, x] of parts) out.set(x, o);
wav(WAV, out);
writeFileSync(OUT, JSON.stringify(meta));
