// SFX SMOKE: the shipped sound effects stay clean, and the engine features they lean on work.
//
//   node scripts/audio/sfx-smoke.mjs
//
// WHAT IT GUARDS:
//   • every preset in content/audio_sfx and every bed in content/audio_ambient passes the critic
//     (sfx-lint.mjs) with no findings: no clicks, cuts, beeps, single thin layers, cues a laptop
//     can't play, transients with no attack, or peaks over -1 dBFS. The aliasing check is left to
//     `npm run audio:sfxlint`, which renders everything again at 192 kHz.
//   • `vary`: a render with a seed is one draw (two seeds differ), a render without one is the
//     cue as authored, and varying keeps the layers and the cue's shape
//   • a `rand` mod with `density` gates a layer into sparse bursts, mostly silent
// docs/reference/sfx-craft.md says why each of those matters.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tally, ROOT } from './stub-context.mjs';
import { measure, findings, engines, render } from './sfx-lint.mjs';

const { check, done } = tally('audio:sfx');
const { AE } = engines();

for (const dir of ['audio_sfx', 'audio_ambient']) {
  for (const f of readdirSync(join(ROOT, 'content', dir)).filter((n) => n.endsWith('.json')).sort()) {
    const def = JSON.parse(readFileSync(join(ROOT, 'content', dir, f), 'utf8'));
    if (!def.config || def.enabled === 0) continue;
    const fs = findings(def, await measure(def, { alias: false }));
    check(`${def.id} passes the critic`, !fs.length, fs.map((x) => `${x.code}: ${x.msg}`).join('; '));
  }
}

// vary
const hit = { id: 'v', category: 'combat', config: { duration: 0.05, vary: { pitch: 80, time: 0.1, filter: 200, gain: 2 }, layers: [
  { waveform: 'sine', freq: 200, pitchBend: { to: 80, time: 0.04 }, gain: 0.5, adsr: { a: 0.001, d: 0.15, s: 0, r: 0.05, curve: 'exp' } },
  { waveform: 'noise', noiseMix: 1, noiseSeed: 5, gain: 0.3, filter: { type: 'bandpass', freq: 2000, q: 1 }, adsr: { a: 0.001, d: 0.04, s: 0, r: 0.02, curve: 'exp' } },
] } };
const r = async (opts) => (await AE.renderSfx(hit, { sampleRate: 16000, seconds: 0.4, ...opts })).getChannelData(0);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const plain1 = await r({}), plain2 = await r({}), d1 = await r({ vary: 1 }), d2 = await r({ vary: 2 }), d1b = await r({ vary: 1 });
check('a cue renders as authored without a vary seed, the same samples each time', same(plain1, plain2));
check('two vary seeds are two different draws', !same(d1, d2));
check('one vary seed is the same draw each time', same(d1, d1b));
const v = AE.varyConfig(hit.config, () => 1);
check('varying keeps the layers and drops the vary key', v.config.layers.length === 2 && v.config.vary === undefined);
check('the most a draw moves pitch is the vary pitch', Math.abs(1200 * Math.log2(v.config.layers[0].freq / 200) - 80) < 1e-6);
check('time moves the envelope and the hold together', Math.abs(v.config.layers[0].adsr.d / 0.15 - v.config.duration / 0.05) < 1e-9);

// rand density
const crack = { id: 'c', config: { duration: 1, layers: [{ waveform: 'noise', noiseMix: 1, noiseSeed: 3, gain: 0.5, adsr: { a: 0.001, d: 0.01, s: 1, r: 0.01 },
  mods: [{ id: 'g', type: 'rand', rate: 50, density: 0.1, seed: 9, to: [{ param: 'amp', amount: 1 }] }] }] } };
const x = (await AE.renderSfx(crack, { sampleRate: 16000, seconds: 1 })).getChannelData(0);
let quiet = 0, loud = 0;
for (let i = 0; i + 320 <= 16000; i += 320) { let s = 0; for (let j = i; j < i + 320; j++) s += x[j] * x[j]; const v2 = Math.sqrt(s / 320); if (v2 < 0.01) quiet++; else if (v2 > 0.1) loud++; }
check('a rand mod with density 0.1 leaves most of a held layer silent and some of it loud', quiet > 35 && loud > 1, `${quiet} quiet, ${loud} loud of 50`);
done();
