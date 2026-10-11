// FILTER SMOKE: a layer's filter gain is read, so peaking and shelf filters do something.
//
//   node scripts/audio/filter-smoke.mjs
//
// Step 6 of docs/proposals/siren-fidelity.md. Pure: reads the biquad a layer builds on the
// recording context in stub-context.mjs.
//
// WHAT IT GUARDS:
//   • `filter.gain` (dB) lands on the biquad's gain for peaking, lowshelf and highshelf
//   • the other types never have their gain written, so their graphs are as they were
//   • a peaking or shelf filter without a gain is left alone too
import { loadEngine, tally } from './stub-context.mjs';

const { check, done } = tally('audio:filter');
const { A, nodes } = loadEngine();

function filterOf(filter) {
  const from = nodes.length;
  A.playSfx({ id: 'filter-smoke', category: 'sfx', priority: 5, config: { duration: 0.3, layers: [{ waveform: 'sawtooth', freq: 220, filter }] } });
  return nodes.slice(from).find(n => n.kind === 'filter');
}

for (const [type, gain] of [['peaking', 6], ['lowshelf', -4.5], ['highshelf', 9]]) {
  const f = filterOf({ type, freq: 1200, q: 0.9, gain });
  check(`${type}: built as ${type}`, f?.type === type);
  const w = f?.gain.log.filter(e => e.type === 'set') || [];
  check(`${type}: gain ${gain} dB lands on the biquad`, w.length === 1 && w[0].value === gain, JSON.stringify(f?.gain.log));
}
for (const type of ['lowpass', 'highpass', 'bandpass', 'notch']) {
  const f = filterOf({ type, freq: 900, q: 1, gain: 12 });
  check(`${type}: gain never written`, f && f.gain.log.length === 0, JSON.stringify(f?.gain.log));
}
const bare = filterOf({ type: 'peaking', freq: 900, q: 1 });
check('peaking without a gain is left alone', bare && bare.gain.log.length === 0);

// A filter sweep still sweeps with a gain on it: the two don't interfere.
const swept = filterOf({ type: 'highshelf', freq: 2000, to: 6000, time: 0.3, gain: 5 });
check('a swept shelf still sweeps', swept?.frequency.log.some(e => e.type === 'target' && e.value === 6000));
check('and keeps its gain', swept?.gain.log.some(e => e.value === 5));

done();
