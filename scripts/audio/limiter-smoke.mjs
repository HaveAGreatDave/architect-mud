// LIMITER SMOKE: the master bus ends in a brickwall limiter, and nothing reaches the speakers
// around it.
//
//   node scripts/audio/limiter-smoke.mjs
//
// Step 1 of docs/proposals/siren-fidelity.md. Pure: the engine runs on the recording context in
// stub-context.mjs, and this reads the graph it built.
//
// WHAT IT GUARDS:
//   • master → limiter → trim → speakers, and the limiter is set as a brickwall
//   • the trim takes off exactly the makeup gain the spec's compressor adds, so below the
//     threshold the chain is unity and every existing cue keeps its level
//   • every bus reaches the master, and the only nodes feeding the speakers are the trim and
//     the mono downmix it feeds
//   • the mono switch and the echo send both stay behind the limiter
import { loadEngine, tally, downstream } from './stub-context.mjs';

const { check, done } = tally('audio:limiter');
const { A, ctx, nodes } = loadEngine();
const G = A._graph();

check('the limiter is a DynamicsCompressor', G.limiter?.kind === 'comp');
check('master feeds the limiter', G.master.out.some(e => e.dst === G.limiter));
check('the limiter feeds the trim', G.limiter.out.some(e => e.dst === G.limitTrim));
check('the trim feeds the speakers', G.limitTrim.out.some(e => e.dst === ctx.destination));

const L = G.limiter;
check('threshold is about -1 dB', L.threshold.value <= -0.5 && L.threshold.value >= -3, `threshold ${L.threshold.value}`);
check('ratio is a limiter\'s (20 or more)', L.ratio.value >= 20, `ratio ${L.ratio.value}`);
check('hard knee', L.knee.value === 0, `knee ${L.knee.value}`);
check('fast attack (3 ms or less)', L.attack.value <= 0.003, `attack ${L.attack.value}`);

// The makeup gain the Web Audio spec applies: (1 / fullRangeGain) ^ 0.6, fullRangeGain being the
// curve's output for a 0 dBFS input. Worked out here from the limiter's own params, not read
// back from the engine, so a change to one side can't agree with itself.
const fullRangeDb = L.threshold.value + (0 - L.threshold.value) / L.ratio.value;
const makeup = Math.pow(1 / Math.pow(10, fullRangeDb / 20), 0.6);
check('the trim cancels the makeup gain exactly', Math.abs(G.limitTrim.gain.value * makeup - 1) < 1e-9,
  `trim ${G.limitTrim.gain.value}, makeup ${makeup}`);

for (const [name, b] of Object.entries(G.buses)) {
  check(`bus ${name} reaches the master`, downstream(b.slider[0]).has(G.master));
}

const feeders = () => nodes.filter(n => n.out.some(e => e.dst === ctx.destination));
const mono = feeders().find(n => n !== G.limitTrim);
check('only the trim and the mono downmix feed the speakers', feeders().length <= 2,
  feeders().map(n => n.kind + '#' + n.id).join(', '));
check('the mono downmix is fed only by the trim',
  !mono || nodes.filter(n => n.out.some(e => e.dst === mono)).every(n => n === G.limitTrim));

A.setMonoAudio(true);
check('mono on: the trim feeds the downmix', mono && G.limitTrim.out.some(e => e.dst === mono));
check('mono on: the trim no longer feeds the speakers directly', !G.limitTrim.out.some(e => e.dst === ctx.destination));
A.setMonoAudio(false);
check('mono off: back to the speakers', G.limitTrim.out.some(e => e.dst === ctx.destination));

const before = nodes.length;
A.setEcho(true);
const delay = nodes.slice(before).find(n => n.kind === 'delay');
check('the echo builds a delay', !!delay);
check('the echo returns into the limiter, not past it',
  delay && delay.out.some(e => e.dst === G.limiter) && !delay.out.some(e => e.dst === ctx.destination));

check('still only the trim and the mono downmix feed the speakers', feeders().length <= 2,
  feeders().map(n => n.kind + '#' + n.id).join(', '));

done();
