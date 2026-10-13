// HOCKEY RENDER — every CPhL sound rendered offline, measured, and optionally written as WAVs.
//
//   node scripts/audio/hockey-render.mjs                  a table: one row per patch
//   node scripts/audio/hockey-render.mjs --wav <dir>      ...and a WAV per patch (and the crowd)
//   node scripts/audio/hockey-render.mjs --only hk-check  just the patches whose id has that in it
//   node scripts/audio/hockey-render.mjs --takes 4        each patch's first four seeded takes too
//
// The listening half of tuning (docs/systems-hockey-sound.md): it renders through the real
// audio-engine.js and hockey-sfx.js on scripts/audio/offline-audio.mjs, at 48 kHz, so what
// it measures and writes is the samples a cue makes, and the numbers are the ones the gate
// (scripts/audio/hockey-smoke.mjs) holds the patches to. A WAV is for ears and other
// speakers: the dev panel's Audio tab plays the same patches live through the browser.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHockey, renderCue, measure, renderCrowd } from './hockey-lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg('--wav', null), only = arg('--only', ''), takes = +arg('--takes', 0);
const { AE, H, wav } = loadHockey();
if (out) mkdirSync(out, { recursive: true });

const rows = [];
for (const d of H.BUILTINS) {
  if (only && !d.id.includes(only)) continue;
  const list = [[d.id, d]];
  for (let k = 1; k <= takes; k++) list.push([`${d.id}~${k}`, H.variant(d, k * 7919)]);
  for (const [name, cue] of list) {
    const buf = await renderCue(AE, cue);
    const m = measure(buf.getChannelData(0), buf.sampleRate);
    rows.push({ name, pri: d.priority, ...m });
    if (out) writeFileSync(join(out, `${name}.wav`), wav(buf.getChannelData(0), buf.sampleRate));
  }
}
const f = (v, n = 3) => (typeof v === 'number' ? v.toFixed(n) : String(v));
console.log('patch'.padEnd(26), 'pri', 'peak ', 'rms  ', 'atk ms', 'len ms', 'centroid', '<150Hz', 'dc/pk ', 'tail');
for (const r of rows) {
  console.log(r.name.padEnd(26), String(r.pri).padStart(3), f(r.peak), f(r.rms), f(r.attackMs, 2).padStart(6), f(r.lenMs, 0).padStart(6),
    f(r.centroid, 0).padStart(8), f(r.low, 2).padStart(6), f(r.dc, 4).padStart(6), r.tail);
}

if (!only || 'crowd'.includes(only)) {
  const crowd = await renderCrowd(AE, H);
  console.log('\ncrowd bed (rms per state, through its own retro stage):');
  for (const s of crowd.states) console.log(' ', s.name.padEnd(8), 'rms', f(s.rms, 4), 'peak', f(s.peak, 3), 'centroid', f(s.centroid, 0));
  console.log('  worst step between samples', f(crowd.maxStep, 4), 'finite', crowd.finite);
  if (out) writeFileSync(join(out, 'crowd-states.wav'), wav(crowd.samples, crowd.sampleRate));
}
