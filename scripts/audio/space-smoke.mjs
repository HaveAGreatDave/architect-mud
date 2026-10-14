// SPACE SMOKE: per-layer pan, a per-cue reverb send, and rooms picked by name, with the ballpark.
//
//   node scripts/audio/space-smoke.mjs
//
// Step 7 of docs/proposals/siren-fidelity.md. Pure: reads the graph and the impulse responses
// the engine builds on the recording context in stub-context.mjs.
//
// WHAT IT GUARDS:
//   • `pan` on a layer builds a panner at that layer's end; no pan, no panner
//   • a cue without `send` goes to its bus exactly as before; with one it goes into the bus's dry
//     copy plus a gain of `send` into the wet copy; `send: 0` is fully dry
//   • the dry copy never reaches the reverb and the wet copy reaches only the reverb
//   • the copies follow the volume sliders and the ducks like the bus itself
//   • the ballpark impulse has a slap-back about 120 ms in, later in the right ear, and a short tail
//   • setRoom picks a room by name over the zone's, and setRoom(null) gives it back
import { loadEngine, tally, downstream } from './stub-context.mjs';

const { check, done } = tally('audio:space');
const { A, ctx, nodes, timers } = loadEngine();
const G = A._graph();
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

function play(config, category = 'sfx') {
  const from = nodes.length;
  A.playSfx({ id: 'space-smoke', category, priority: 5, config: { duration: 0.3, ...config } });
  return nodes.slice(from);
}

// ── Pan ──────────────────────────────────────────────────────────────────────
{
  const made = play({ layers: [{ waveform: 'sine', freq: 400, pan: -0.6 }, { waveform: 'sine', freq: 500 }] });
  const pans = made.filter(n => n.kind === 'panner');
  check('one panner for the one panned layer', pans.length === 1, `${pans.length} panner(s)`);
  check('at the authored position', pans[0] && near(pans[0].pan.value, -0.6));
  check('feeding the bus', pans[0] && pans[0].out.some(e => e.dst === G.buses.sfx.slider[0]));
  const env = made.find(n => n.kind === 'gain' && n.out.some(e => e.dst === pans[0]));
  check('after the layer\'s own envelope', !!env);
  const clamp = play({ layers: [{ waveform: 'sine', freq: 400, pan: 3 }] }).find(n => n.kind === 'panner');
  check('pan clamps to the stereo field', clamp && near(clamp.pan.value, 1));
}

// ── Send ─────────────────────────────────────────────────────────────────────
const sfx = G.buses.sfx;
{
  const made = play({ layers: [{ waveform: 'sine', freq: 300 }] });
  check('no send: the cue goes to the bus as before', made.some(n => n.out.some(e => e.dst === sfx.slider[0])));
  check('no send: no dry or wet copy is made', !sfx.paths.dry && !sfx.paths.wet);
}
{
  const made = play({ send: 0.3, layers: [{ waveform: 'sine', freq: 300 }] });
  const dry = sfx.paths.dry, wet = sfx.paths.wet;
  check('send: the bus grows a dry and a wet copy', !!dry && !!wet);
  check('send: the cue doesn\'t touch the bus\'s own entry', !made.some(n => n.out.some(e => e.dst === sfx.slider[0])));
  const head = made.find(n => n.out.some(e => e.dst === dry));
  check('send: the cue feeds the dry copy', !!head);
  const sendGain = head && head.out.map(e => e.dst).find(d => d.kind === 'gain' && d.out.some(e => e.dst === wet));
  check('send: and the wet copy through a gain of 0.3', sendGain && near(sendGain.gain.value, 0.3));
  const dryDown = downstream(dry), wetDown = downstream(wet);
  check('the dry copy reaches the master', dryDown.has(G.master));
  check('the dry copy never reaches the reverb', !dryDown.has(G.reverbSend));
  check('the wet copy reaches the reverb', wetDown.has(G.reverbSend));
  check('the wet copy reaches the master only through the reverb',
    !wet.out.some(e => e.dst === G.master) && !sfx.duck.some(d => wetDown.has(d) && d.out.some(e => e.dst === G.master)));
  const zero = play({ send: 0, layers: [{ waveform: 'sine', freq: 300 }] });
  const zhead = zero.find(n => n.out.some(e => e.dst === dry));
  check('send 0: dry only', zhead && !zhead.out.some(e => e.dst?.kind === 'gain' && e.dst.out.some(f => f.dst === wet)));
  check('send 0: no wet gain built', !zero.some(n => n.out.some(e => e.dst === wet)));

  // The copies are part of the bus: they follow its slider and its duck.
  A.applyVolumeSettings({ sfxVolume: 0.42 });
  check('the copies follow the sfx slider', sfx.slider.length === 3 && sfx.slider.every(g => near(g.gain.log.at(-1)?.value, 0.42)));
  ctx.currentTime = 4;
  A.duck('sfx', -6, { hold: 1 });
  check('the copies duck with the bus', sfx.duck.length === 3 && sfx.duck.every(d => d.gain.log.some(e => e.type === 'target' && near(e.value, Math.pow(10, -6 / 20)))));
}
{
  // A loop can carry a send too.
  const from = nodes.length;
  A.loopSound({ id: 'space-loop', category: 'ambient', priority: 1, config: { send: 0.8, waveform: 'noise', gain: 0.2 } });
  const made = nodes.slice(from);
  check('a loop with a send uses the ambient dry copy', !!G.buses.ambient.paths.dry && made.some(n => n.out.some(e => e.dst === G.buses.ambient.paths.dry)));
  A.stopLoop('space-loop');
}

// ── Rooms ────────────────────────────────────────────────────────────────────
check('the ballpark is a room', A.spaceNames().includes('ballpark'));
{
  const ir = A._impulse('ballpark');
  const sr = ir.sampleRate;
  check('ballpark: a short tail (half a second or less)', ir.length / sr <= 0.5, `${ir.length / sr} s`);
  const energy = (d, a, b) => { let s = 0; for (let i = Math.floor(a * sr); i < Math.floor(b * sr); i++) s += d[i] * d[i]; return s / Math.max(1, (b - a) * sr); };
  const peakAt = (d, a, b) => { let best = 0, at = a; for (let i = Math.floor(a * sr); i < Math.floor(b * sr); i++) if (Math.abs(d[i]) > best) { best = Math.abs(d[i]); at = i / sr; } return at; };
  const L = ir.getChannelData(0), R = ir.getChannelData(1);
  for (const [ear, d] of [['left', L], ['right', R]]) {
    check(`ballpark ${ear}: a slap-back stands out of the tail around 120 ms`,
      energy(d, 0.115, 0.14) > 4 * energy(d, 0.08, 0.11), `slap ${energy(d, 0.115, 0.14)}, before ${energy(d, 0.08, 0.11)}`);
  }
  const l = peakAt(L, 0.1, 0.16), r = peakAt(R, 0.1, 0.16);
  check('ballpark: the slap starts about 120 ms in', l >= 0.118 && l <= 0.13, `left peak at ${l}`);
  check('ballpark: the right ear hears it later', r > l, `left ${l}, right ${r}`);
  check('the stone room has no slap-back', (() => { const s = A._impulse('stone').getChannelData(0); return energy(s, 0.115, 0.14) < 2 * energy(s, 0.08, 0.11); })());
}
const runTimers = () => { while (timers.length) timers.shift().fn(); };
A.setSpace('street');
runTimers();
check('the zone picks the room', A._graph().space === 'street');
A.setRoom('ballpark');
runTimers();
check('setRoom picks a room by name', A._graph().space === 'ballpark');
A.setSpace('stone');
runTimers();
check('a zone change doesn\'t override a named room', A._graph().space === 'ballpark');
check('but the zone\'s room is remembered', A._graph().zoneSpace === 'stone');
A.setRoom(null);
runTimers();
check('setRoom(null) gives the room back to the zone', A._graph().space === 'stone');
A.setRoom('nowhere');
runTimers();
check('an unknown room name is no override', A._graph().roomOverride === null && A._graph().space === 'stone');

done();
