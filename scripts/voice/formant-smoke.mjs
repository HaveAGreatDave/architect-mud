#!/usr/bin/env node
// formant-smoke.mjs: the formant controller (client/shared/oracle-formant.json, written by
// tools/voice-fit/ddsp/export-formant.py) computes in the engine what it computed in PyTorch,
// covers every phone the engine can say, and moves only F1 to F3, by no more than its cap.
// See docs/proposals/oracle-teacher.md, "Timbre: formants per phone".
//
//   node scripts/voice/formant-smoke.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from '../../tools/voice-fit/synth.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const doc = JSON.parse(readFileSync(join(ROOT, 'client/shared/oracle-formant.json'), 'utf8'));
let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) { fails++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); } };

const { render, A } = await setup();

// 1. The JavaScript matches PyTorch on the file's own check lines.
let worst = 0;
for (const c of doc.check) A._formantLogs(doc, c.codes, c.at, c.acc).forEach((row, i) =>
  row.forEach((v, j) => { worst = Math.max(worst, Math.abs(v - c.out[i][j])); }));
check('the engine computes what PyTorch did', worst < 2e-3, `worst difference ${worst.toExponential(2)} (log ratio)`);

// 2. Every phone the engine says reaches the network as one it was built with.
const known = new Set(doc.phones);
const missing = A._phones().filter(p => !known.has(doc.alias[p] || p));
check('every engine phone is in the controller\'s list', !missing.length, missing.join(' '));

// 3. On a real line: only F1 to F3 move, within the cap, and something does move.
const voice = JSON.parse(readFileSync(join(ROOT, 'data/voice/fitted-voice.json'), 'utf8')).voice;
const line = 'We waited by the harbour wall for hours, and nobody came.';
A.voiceTuning.formantNet = 0; A._setFormantNet(null);
render(line, voice); const off = render.last;
A.voiceTuning.formantNet = 1; A._setFormantNet(doc);
render(line, voice); const on = render.last;
check('both renders have the same frames', off.frames === on.frames, `${off.frames} vs ${on.frames}`);
const NP = off.names.length, moved = new Set();
let most = 0;
for (let f = 0; f < off.frames; f++) for (let k = 0; k < NP; k++) {
  const a = off.tracks[f * NP + k], b = on.tracks[f * NP + k];
  if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a))) {
    moved.add(off.names[k]);
    if (a > 0 && b > 0) most = Math.max(most, Math.abs(Math.log(b / a)));
  }
}
const extra = [...moved].filter(k => !['f1', 'f2', 'f3'].includes(k));
check('only F1 to F3 move', !extra.length, extra.join(' '));
check('the formants do move', moved.size > 0);
check('no correction is past the cap', most <= doc.flim + 1e-4, `${most.toFixed(4)} against ${doc.flim.toFixed(4)}`);

// 4. Off means off.
A.voiceTuning.formantNet = 0;
render(line, voice); const off2 = render.last;
check('formantNet 0 speaks the rules alone', off2.tracks.every((v, i) => v === off.tracks[i]));
A.voiceTuning.formantNet = 1; A._setFormantNet(null);

if (fails) { console.error(`formant smoke: ${fails} failed`); process.exit(1); }
console.log('formant smoke passed');
