// TV MIX SMOKE: the tv bus has a voice and an effects sub-gain under its one slider.
//
//   node scripts/audio/tvmix-smoke.mjs
//
// Step 4 of docs/proposals/siren-fidelity.md. Pure: reads the graph built on the recording
// context in stub-context.mjs.
//
// WHAT IT GUARDS:
//   • voice and effects each feed the tv slider, and both start at unity
//   • a 'tv_fx' cue goes through the effects sub-gain, TV speech through the voice one
//   • a plain 'tv' cue still goes straight to the tv bus, as every existing TV sound did
//   • setTvBalance sets the pair in dB, and the TV slider still scales both
import { loadEngine, tally, downstream } from './stub-context.mjs';

const { check, done } = tally('audio:tvmix');
const { A, ctx, nodes } = loadEngine();
const G = A._graph();
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const tvSlider = G.buses.tv.slider[0];

check('the voice sub-gain feeds the tv slider', G.tvVoice.out.some(e => e.dst === tvSlider));
check('the effects sub-gain feeds the tv slider', G.tvFx.out.some(e => e.dst === tvSlider));
check('voice starts at unity', G.tvVoice.gain.value === 1 && !G.tvVoice.gain.log.length);
check('effects start at unity', G.tvFx.gain.value === 1 && !G.tvFx.gain.log.length);

function cue(category) {
  const from = nodes.length;
  A.playSfx({ id: 'tvmix', category, priority: 5, config: { duration: 0.2, layers: [{ waveform: 'sine', freq: 300 }] } });
  return nodes.slice(from);
}
const fx = cue('tv_fx');
check("a 'tv_fx' cue lands on the effects sub-gain", fx.some(n => n.out.some(e => e.dst === G.tvFx)));
const plain = cue('tv');
check("a 'tv' cue still lands on the tv bus itself", plain.some(n => n.out.some(e => e.dst === tvSlider)));
check("a 'tv' cue skips both sub-gains", !plain.some(n => n.out.some(e => e.dst === G.tvFx || e.dst === G.tvVoice)));

const from = nodes.length;
A.speak('And now the weather.', { seed: 'newsreader' });
check('TV speech lands on the voice sub-gain', nodes.slice(from).some(n => n.out.some(e => e.dst === G.tvVoice)));

ctx.currentTime = 3;
A.setTvBalance({ fxDb: -8 });
{
  const f = G.tvFx.gain.log.at(-1), v = G.tvVoice.gain.log.at(-1);
  check('setTvBalance puts the effects 8 dB down', f && f.type === 'target' && near(f.value, Math.pow(10, -8 / 20)), JSON.stringify(f));
  check('and leaves the voice at unity', v && near(v.value, 1));
}
const sliderWrites = tvSlider.gain.log.length;
A.applyVolumeSettings({ tvVolume: 0.3 });
check('the TV slider still moves the tv bus', tvSlider.gain.log.length > sliderWrites && near(tvSlider.gain.log.at(-1).value, 0.3));
check('a slider change leaves the balance alone', near(G.tvFx.gain.log.at(-1).value, Math.pow(10, -8 / 20)));
check('both sub-gains sit under the slider', downstream(G.tvFx).has(tvSlider) && downstream(G.tvVoice).has(tvSlider));

// A tv_fx cue with its own reverb send keeps the balance on its dry and wet copies too.
const from2 = nodes.length;
A.playSfx({ id: 'tvmix-send', category: 'tv_fx', priority: 5, config: { duration: 0.2, send: 0.2, layers: [{ waveform: 'sine', freq: 300 }] } });
const subs = nodes.slice(from2).filter(n => n.kind === 'gain' && n.gain.value !== 1 && near(n.gain.value, Math.pow(10, -8 / 20)));
check('a tv_fx cue with a send gets the balance on its own paths', subs.length >= 1, `${subs.length} balanced sub-gain(s)`);

done();
