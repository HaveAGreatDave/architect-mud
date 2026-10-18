// DISTANCE SMOKE: a sound from another room, by distance, by door and by the room it came from.
//
//   node scripts/audio/distance-smoke.mjs
//
// Pure: reads the graph playSfx builds on the recording context in stub-context.mjs and works out
// its frequency response from the filters' own parameters (the RBJ formulas Web Audio uses), along
// the direct path only. It asserts what was built, never what it sounds like.
//
// WHAT IT GUARDS:
//   • distance 0 builds exactly what a plain cue builds: a cue in your own room is untouched
//   • further away is quieter and darker, and darker again through a closed door than an open one
//   • further away is wetter: the reverb send rises as the direct path falls
//   • a cue from another room sends into that room's impulse, never the listener's
//   • a cue from a room like the listener's reuses the listener's reverb and builds no convolver
//   • the source-room convolvers are capped, oldest out first
//   • a distant cue costs a handful of nodes, not a graph
import { loadEngine, tally } from './stub-context.mjs';

const { check, done } = tally('audio:distance');
const { A, ctx, nodes, timers } = loadEngine();
const G = A._graph();
const sfx = G.buses.sfx;
const runTimers = () => { while (timers.length) timers.shift().fn(); };
A.setSpace('street');
runTimers();
check('the listener stands in the street', A._graph().space === 'street');

const CUE = { id: 'distance-smoke', category: 'sfx', priority: 5, config: { duration: 0.3, layers: [{ waveform: 'noise', gain: 0.5 }] } };
const TOP = 0.5;   // the cue's gain multiplier, which is how the walk finds the top of the chain

function play(opts = {}) {
  const from = nodes.length;
  A.playSfx(CUE, TOP, opts);
  const made = nodes.slice(from);
  const top = made.find(n => n.kind === 'gain' && n.gain.log[0]?.type === 'set' && n.gain.log[0].value === TOP);
  return { made, top };
}

// |H| of one biquad at f, for the two types this path uses.
function biquadMag(n, f) {
  const sr = ctx.sampleRate, w0 = 2 * Math.PI * n.frequency.value / sr, cw = Math.cos(w0), sw = Math.sin(w0);
  let b, a;
  if (n.type === 'lowpass') {
    const alpha = sw / (2 * Math.pow(10, n.Q.value / 20));
    b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]; a = [1 + alpha, -2 * cw, 1 - alpha];
  } else if (n.type === 'highshelf') {
    const A_ = Math.pow(10, n.gain.value / 40), alpha = sw / 2 * Math.SQRT2, s = 2 * Math.sqrt(A_) * alpha;
    b = [A_ * ((A_ + 1) + (A_ - 1) * cw + s), -2 * A_ * ((A_ - 1) + (A_ + 1) * cw), A_ * ((A_ + 1) + (A_ - 1) * cw - s)];
    a = [(A_ + 1) - (A_ - 1) * cw + s, 2 * ((A_ - 1) - (A_ + 1) * cw), (A_ + 1) - (A_ - 1) * cw - s];
  } else return 1;
  const w = 2 * Math.PI * f / sr;
  const mag = c => Math.hypot(c[0] + c[1] * Math.cos(w) + c[2] * Math.cos(2 * w), c[1] * Math.sin(w) + c[2] * Math.sin(2 * w));
  return mag(b) / mag(a);
}

// The direct path's level at f, from the cue's top gain to the sfx bus's entry. Anything through a
// convolver or a bus's wet copy is reverb, not the direct path, and is left out.
function direct(node, f) {
  if (node === sfx.slider[0]) return 1;
  if (node.kind === 'convolver' || node === sfx.paths.wet) return 0;
  const own = node.kind === 'gain' ? node.gain.value : node.kind === 'filter' ? biquadMag(node, f) : 1;
  let sum = 0;
  for (const { dst } of node.out) if (dst?.kind) sum += direct(dst, f);
  return own * sum;
}
const LOW = 200, HIGH = 6000;
const shape = (opts) => {
  const { top, made } = play(opts);
  const lo = direct(top, LOW), hi = direct(top, HIGH);
  return { lo, hi, tilt: hi / lo, made, top };
};

// ── Distance 0 is the cue as it shipped ──────────────────────────────────────
const near = shape();
const nearCount = near.made.length;
check('a near cue reaches the bus at its own gain', Math.abs(near.lo - TOP) < 1e-9 && Math.abs(near.hi - TOP) < 1e-9, `${near.lo} / ${near.hi}`);
check('distance 0 builds nothing extra', shape({ distance: 0, room: 'stone', shut: 1 }).made.length === nearCount);

// ── Further is quieter, darker and wetter ────────────────────────────────────
const d1 = shape({ distance: 1 }), d3 = shape({ distance: 3 });
check('one room away is quieter', d1.lo < near.lo, `${d1.lo} vs ${near.lo}`);
check('three rooms away is quieter still', d3.lo < d1.lo, `${d3.lo} vs ${d1.lo}`);
check('one room away is darker', d1.tilt < near.tilt, `${d1.tilt} vs ${near.tilt}`);
check('three rooms away is darker still', d3.tilt < d1.tilt, `${d3.tilt} vs ${d1.tilt}`);
const sendOf = (made) => made.find(n => n.kind === 'gain' && n.out.some(e => e.dst === sfx.paths.wet));
const s1 = sendOf(d1.made), s3 = sendOf(d3.made);
check('with no room named, a distant cue sends to the listener\'s reverb', !!s1 && !!s3);
check('further away is wetter against the direct path',
  s1 && s3 && s3.gain.value / d3.lo > s1.gain.value / d1.lo, `${s1?.gain.value / d1.lo} -> ${s3?.gain.value / d3.lo}`);

// ── An open way keeps its top end; a door doesn't ────────────────────────────
const open = shape({ distance: 2 }), door = shape({ distance: 2, shut: 1 });
check('through a closed door is darker than through an open one', door.tilt < open.tilt, `${door.tilt} vs ${open.tilt}`);
check('an explicit muffle still wins', (() => {
  const m = play({ distance: 1, muffle: 5 }).made.find(n => n.kind === 'filter' && n.type === 'lowpass');
  return m && Math.abs(m.frequency.value - 400) < 1e-6;
})());

// ── The source room's reverb ─────────────────────────────────────────────────
{
  const before = G.sourceRooms.size;
  const { made } = play({ distance: 2, room: 'stone' });
  const entry = G.sourceRooms.get('sfx:stone');
  check('a cue from the church builds the church\'s convolver', !!entry && G.sourceRooms.size === before + 1);
  check('with the church\'s impulse', entry && entry.conv.buffer === A._impulse('stone'));
  check('which isn\'t the listener\'s impulse', entry && entry.conv.buffer !== G.reverbNode.buffer && G.reverbNode.buffer === A._impulse('street'));
  check('the cue sends into it', made.some(n => n.out.some(e => e.dst === entry?.input)));
  check('and not into the listener\'s wet path as well', !made.some(n => n.out.some(e => e.dst === sfx.paths.wet)));
  check('the church convolver feeds the sfx bus, not the master', entry && entry.conv.out.some(e => e.dst === sfx.slider[0]));
  const again = play({ distance: 1, room: 'stone' });
  check('a second cue from the church reuses its convolver', !again.made.some(n => n.kind === 'convolver') && G.sourceRooms.size === before + 1);
  check('a distant cue costs four nodes or fewer, panner aside', again.made.length - nearCount <= 4, `${again.made.length - nearCount} extra`);
}
{
  const before = G.sourceRooms.size;
  const { made } = play({ distance: 2, room: 'street' });
  check('a cue from a room like the listener\'s builds no convolver', G.sourceRooms.size === before && !made.some(n => n.kind === 'convolver'));
  check('and sends into the listener\'s reverb', made.some(n => n.out.some(e => e.dst === sfx.paths.wet)));
}
{
  for (const room of ['hall', 'metal', 'tunnel']) play({ distance: 1, room });
  check(`the source rooms are capped at ${G.sourceRoomCap}`, G.sourceRooms.size === G.sourceRoomCap, `${G.sourceRooms.size}`);
  check('the least recently used room went first', !G.sourceRooms.has('sfx:stone') && G.sourceRooms.has('sfx:tunnel'));
}
{
  // The interface bus never has a reverb, distance or not.
  const from = nodes.length;
  A.playSfx({ ...CUE, category: 'ui' }, TOP, { distance: 2, room: 'stone' });
  check('a ui cue gets no reverb send', !nodes.slice(from).some(n => n.out.some(e => e.dst === sfx.paths.wet || [...G.sourceRooms.values()].some(r => r.input === e.dst))));
}

done();
