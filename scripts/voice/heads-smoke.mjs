#!/usr/bin/env node
// heads-smoke.mjs: the source and consonant controllers (client/shared/oracle-source.json and
// oracle-consonant.json, written by tools/voice-fit/ddsp/export-formant.py) compute in the
// engine what they computed in PyTorch, cover every phone the engine can say, move only their
// own tracks, by no more than their caps, and give the rules back when switched off.
// See docs/proposals/oracle-teacher.md, "The voice source" and "Consonants".
//
//   node scripts/voice/heads-smoke.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tools/voice-fit/synth.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) { fails++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); } };

const { render, A } = await setup();
const voice = JSON.parse(readFileSync(join(ROOT, 'tools/voice-fit/out/voice.json'), 'utf8')).voice;
const line = 'She kept the spare keys in a tin by the stove, just in case.';
A.voiceTuning.formantNet = 0;

for (const [kind, file, tune, set, logs] of [
  ['source', 'oracle-source.json', 'sourceNet', '_setSourceNet', '_sourceLogs'],
  ['consonant', 'oracle-consonant.json', 'consonantNet', '_setConsonantNet', '_consonantLogs'],
]) {
  const doc = JSON.parse(readFileSync(join(ROOT, 'client/shared', file), 'utf8'));
  check(`${kind}: the file says its kind`, doc.kind === kind, doc.kind);

  // 1. The JavaScript matches PyTorch on the file's own check lines.
  let worst = 0;
  for (const c of doc.check) A[logs](doc, c.codes, c.at, c.acc).forEach((row, i) =>
    row.forEach((v, j) => { worst = Math.max(worst, Math.abs(v - c.out[i][j])); }));
  check(`${kind}: the engine computes what PyTorch did`, worst < 2e-3, `worst difference ${worst.toExponential(2)} (log ratio)`);

  // 2. Every phone the engine says reaches the network as one it was built with.
  const known = new Set(doc.phones);
  const missing = A._phones().filter(p => !known.has(doc.alias[p] || p));
  check(`${kind}: every engine phone is in the controller's list`, !missing.length, missing.join(' '));

  // 3. On a real line, every other controller off: only its tracks move, within its caps.
  for (const t of ['sourceNet', 'consonantNet']) A.voiceTuning[t] = 0;
  A[set](null);
  render(line, voice); const off = render.last;
  A.voiceTuning[tune] = 1; A[set](doc);
  render(line, voice); const on = render.last;
  check(`${kind}: both renders have the same frames`, off.frames === on.frames, `${off.frames} vs ${on.frames}`);
  const NP = off.names.length, moved = new Set();
  const most = {};
  for (let f = 0; f < off.frames; f++) for (let k = 0; k < NP; k++) {
    const a = off.tracks[f * NP + k], b = on.tracks[f * NP + k], n = off.names[k];
    if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a))) {
      moved.add(n);
      if (a > 0 && b > 0) most[n] = Math.max(most[n] || 0, Math.abs(Math.log(b / a)));
    }
  }
  const extra = [...moved].filter(k => !doc.tracks.includes(k));
  check(`${kind}: only ${doc.tracks.join(', ')} move`, !extra.length, extra.join(' '));
  check(`${kind}: its tracks do move`, moved.size > 0);
  doc.tracks.forEach((k, i) => check(`${kind}: ${k} stays within its cap`, (most[k] || 0) <= doc.lim[i] + 1e-4, `${(most[k] || 0).toFixed(4)} against ${doc.lim[i].toFixed(4)}`));

  // 4. Off means off.
  A.voiceTuning[tune] = 0;
  render(line, voice); const off2 = render.last;
  check(`${kind}: ${tune} 0 speaks the rules alone`, off2.tracks.every((v, i) => v === off.tracks[i]));
  A[set](null);
}
for (const t of ['formantNet', 'sourceNet', 'consonantNet']) A.voiceTuning[t] = 1;

if (fails) { console.error(`heads smoke: ${fails} failed`); process.exit(1); }
console.log('heads smoke passed');
