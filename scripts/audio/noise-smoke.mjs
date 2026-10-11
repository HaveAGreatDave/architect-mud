// NOISE SMOKE: noise layers get eight seconds of stereo noise in three colours, each from its
// own offset.
//
//   node scripts/audio/noise-smoke.mjs
//
// Step 5 of docs/proposals/siren-fidelity.md. Pure: reads the buffers the engine generates and
// the graph a noise layer builds on the recording context in stub-context.mjs.
//
// WHAT IT GUARDS:
//   • white, pink and brown are each 8 s, stereo, made once, and at white's level (RMS)
//   • the colours really are colours: high-frequency content falls white → pink → brown
//   • the two channels are different noise, and the loop point has no step in it
//   • two noise layers in one cue start at different offsets (the phasing fix), and
//     `noiseSeed` pins an offset
//   • an existing noise layer is still mono noise at its old level: the left channel only,
//     straight into its noise gain
//   • `noise: 'pink'` picks the pink buffer; `width` spreads it across the two channels with an
//     equal-power law
import { loadEngine, tally } from './stub-context.mjs';

const { check, done } = tally('audio:noise');
const { A, nodes } = loadEngine();
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const WHITE_RMS = 1 / Math.sqrt(3);

const rms = (d) => { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length); };
// Energy of the first difference against the signal's own: about 2 for white noise, and lower the
// more the spectrum leans to the bass. A one-line spectral tilt meter.
const hf = (d) => { let s = 0, e = 0; for (let i = 1; i < d.length; i++) { const x = d[i] - d[i - 1]; s += x * x; e += d[i] * d[i]; } return s / e; };
const corr = (a, b) => { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; } return ab / Math.sqrt(aa * bb); };

const tilt = {};
for (const colour of ['white', 'pink', 'brown']) {
  const buf = A._noiseBuffer(colour);
  check(`${colour}: stereo`, buf.numberOfChannels === 2);
  check(`${colour}: eight seconds`, near(buf.length / buf.sampleRate, 8, 1e-9), `${buf.length / buf.sampleRate} s`);
  check(`${colour}: made once`, A._noiseBuffer(colour) === buf);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (const [ch, d] of [['left', L], ['right', R]]) {
    check(`${colour} ${ch}: at white's level`, near(rms(d), WHITE_RMS, 1e-3), `rms ${rms(d)}`);
  }
  check(`${colour}: the channels are different noise`, Math.abs(corr(L, R)) < 0.05, `corr ${corr(L, R)}`);
  // The loop seam: the step from the last sample back to the first is an ordinary step.
  let steps = 0; for (let i = 1; i < L.length; i++) steps += (L[i] - L[i - 1]) ** 2;
  const stepRms = Math.sqrt(steps / (L.length - 1));
  check(`${colour}: no step at the loop point`, Math.abs(L[0] - L[L.length - 1]) < 5 * stepRms,
    `seam ${Math.abs(L[0] - L[L.length - 1])}, typical step ${stepRms}`);
  tilt[colour] = hf(L);
}
check('white is white (flat spectrum)', near(tilt.white, 2, 0.05), `tilt ${tilt.white}`);
check('pink is darker than white', tilt.pink < tilt.white * 0.6, `pink ${tilt.pink}, white ${tilt.white}`);
check('brown is darker than pink', tilt.brown < tilt.pink * 0.5, `brown ${tilt.brown}, pink ${tilt.pink}`);
check('an unknown colour falls back to white', A._noiseBuffer('mauve') === A._noiseBuffer('white'));

function build(layers) {
  const from = nodes.length;
  A.playSfx({ id: 'noise-smoke', category: 'sfx', priority: 5, config: { duration: 0.5, layers } });
  const made = nodes.slice(from);
  return { made, srcs: made.filter(n => n.kind === 'buffersrc') };
}

// The phasing fix: identical layers, different starting points.
{
  const { srcs } = build([{ waveform: 'noise', gain: 0.5 }, { waveform: 'noise', gain: 0.5 }]);
  check('two noise layers build two sources', srcs.length === 2);
  check('each starts at an offset inside the buffer', srcs.every(s => s.offset >= 0 && s.offset < 8), srcs.map(s => s.offset).join(', '));
  check('and not the same offset', srcs.length === 2 && Math.abs(srcs[0].offset - srcs[1].offset) > 1e-3);
  check('a plain noise layer plays white', srcs.every(s => s.buffer === A._noiseBuffer('white')));
  check('it loops', srcs.every(s => s.loop === true));
}
{
  const a = build([{ waveform: 'noise', noiseSeed: 42 }]).srcs[0];
  const b = build([{ waveform: 'noise', noiseSeed: 42 }]).srcs[0];
  const c = build([{ waveform: 'noise', noiseSeed: 43 }]).srcs[0];
  check('noiseSeed pins the offset', a && b && a.offset === b.offset);
  check('a different seed, a different offset', a && c && a.offset !== c.offset);
}

// Back-compat: mono, left channel, straight into the noise gain at noiseMix.
{
  const { made, srcs } = build([{ waveform: 'sine', freq: 200, noiseMix: 0.3 }]);
  const src = srcs[0];
  const split = src?.out[0]?.dst;
  check('the source feeds a channel splitter', split?.kind === 'splitter');
  check('only the left channel is taken', split && split.out.length === 1 && split.out[0].output === 0);
  const ng = split?.out[0]?.dst;
  check('straight into the noise gain, at noiseMix', ng?.kind === 'gain' && near(ng.gain.value, 0.3, 1e-9));
  check('no merger for a layer without width', !made.some(n => n.kind === 'merger'));
}

// Colour and width.
{
  const { made, srcs } = build([{ waveform: 'noise', noise: 'pink', width: 1 }]);
  check("noise: 'pink' plays the pink buffer", srcs[0]?.buffer === A._noiseBuffer('pink'));
  const merge = made.find(n => n.kind === 'merger');
  const split = made.find(n => n.kind === 'splitter');
  check('width builds a merger', !!merge);
  const toLeft = split?.out.filter(e => e.dst === merge && e.input === 0) || [];
  check('the left ear keeps the left channel', toLeft.length === 1 && toLeft[0].output === 0);
  const intoRight = made.filter(n => n.kind === 'gain' && n.out.some(e => e.dst === merge && e.input === 1));
  const fromCh = (g) => split.out.find(e => e.dst === g)?.output;
  const same = intoRight.find(g => fromCh(g) === 0), other = intoRight.find(g => fromCh(g) === 1);
  check('width 1: the right ear is all the other channel', same && other && near(same.gain.value, 0, 1e-9) && near(other.gain.value, 1, 1e-9),
    `same ${same?.gain.value}, other ${other?.gain.value}`);
  const half = build([{ waveform: 'noise', noise: 'brown', width: 0.5 }]);
  const gains = half.made.filter(n => n.kind === 'gain' && n.out.some(e => e.dst?.kind === 'merger' && e.input === 1)).map(g => g.gain.value);
  check('width 0.5: equal power into the right ear', gains.length === 2 && near(gains[0] ** 2 + gains[1] ** 2, 1, 1e-9), gains.join(', '));
  check("noise: 'brown' plays the brown buffer", half.srcs[0]?.buffer === A._noiseBuffer('brown'));
}

// engineNodes() keeps the buffer its custom synths were built on.
{
  const n = A.engineNodes().noise;
  check('engineNodes keeps its mono two-second buffer', n.numberOfChannels === 1 && near(n.length / n.sampleRate, 2, 1e-9));
}

done();
