// play.mjs: the real worklet on tracks written by another tool (a network's corrections).
//
//   node tools/voice-fit/ddsp/play.mjs <jobs.json>
//
// jobs.json: [{ f32, frames, frame, k, names, po, out }]: the tracks as float32 frames x NP,
// the line's constants, the processor options (the noise seed), and where to write the
// render as raw float32 at 48 kHz, presence peak included, as synth.mjs's render() gives it.
import { readFileSync, writeFileSync } from 'node:fs';
import { setup } from '../synth.mjs';

const jobs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { play } = await setup();
for (const j of jobs) {
  const b = readFileSync(j.f32);
  const tracks = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  const x = play({ type: 'line', tracks, frames: j.frames, frame: j.frame, k: j.k, names: j.names, t0: 0 }, j.po || {});
  writeFileSync(j.out, Buffer.from(x.buffer, x.byteOffset, x.byteLength));
}
console.log(`${jobs.length} played`);
