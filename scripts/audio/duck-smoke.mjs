// DUCK SMOKE: each bus has a duck gain the volume sliders never touch, and duck() schedules it.
//
//   node scripts/audio/duck-smoke.mjs
//
// Step 2 of docs/proposals/siren-fidelity.md. Pure: reads the AudioParam events duck() wrote on
// the recording context in stub-context.mjs.
//
// WHAT IT GUARDS:
//   • every bus is slider → duck → master, and the reverb send taps the duck, not the slider
//   • a volume change writes the sliders and never the ducks
//   • duck() goes down on the attack, holds, and comes back on the release, on the named buses only
//   • overlapping ducks sit at the deepest one and step back to the shallower one, not to unity
//   • an open-ended duck stays down until release()
//   • speak() with `duck` ducks the named buses for exactly its own duration
import { loadEngine, tally, downstream } from './stub-context.mjs';

const { check, done } = tally('audio:duck');
const { A, ctx } = loadEngine();
const G = A._graph();
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const db = (x) => Math.pow(10, x / 20);
const log = (bus) => G.buses[bus].duck[0].gain.log;
const targets = (bus) => log(bus).filter(e => e.type === 'target');

for (const [name, b] of Object.entries(G.buses)) {
  const s = b.slider[0], d = b.duck[0];
  check(`${name}: slider feeds the duck`, s.out.length === 1 && s.out[0].dst === d, s.out.map(e => e.dst.kind).join(','));
  check(`${name}: the duck feeds the master`, d.out.some(e => e.dst === G.master));
}
for (const name of ['sfx', 'ambient', 'tv']) {
  check(`${name}: the reverb send hangs off the duck`, downstream(G.buses[name].duck[0]).has(G.reverbSend));
}
check('ui: no reverb send', !downstream(G.buses.ui.duck[0]).has(G.reverbSend));
check('music: no reverb send', !downstream(G.buses.music.duck[0]).has(G.reverbSend));

// The sliders belong to the player; the ducks belong to duck().
const duckLogLen = Object.fromEntries(Object.keys(G.buses).map(n => [n, log(n).length]));
A.applyVolumeSettings({ sfxVolume: 0.5, musicVolume: 0.2, tvVolume: 0.1, ambientVolume: 0.9 });
for (const n of Object.keys(G.buses)) {
  check(`${n}: a volume change leaves the duck alone`, log(n).length === duckLogLen[n]);
}
check('sfx: a volume change writes the slider', G.buses.sfx.slider[0].gain.log.some(e => e.type === 'target' && near(e.value, 0.5)));

// A held duck.
ctx.currentTime = 10;
A.duck(['sfx', 'ambient'], -9, { attack: 0.06, hold: 1, release: 0.45 });
for (const n of ['sfx', 'ambient']) {
  const t = targets(n);
  check(`${n}: ducks to -9 dB at once`, t[0] && near(t[0].value, db(-9)) && near(t[0].time, 10), JSON.stringify(t[0]));
  check(`${n}: on the attack`, t[0] && near(t[0].tc, 0.06 / 3));
  check(`${n}: comes back to unity after attack + hold`, t[1] && near(t[1].value, 1) && near(t[1].time, 10 + 0.06 + 1), JSON.stringify(t[1]));
  check(`${n}: on the release`, t[1] && near(t[1].tc, 0.45 / 3));
}
for (const n of ['music', 'tv', 'ui']) check(`${n}: not named, not ducked`, targets(n).length === 0);

// Overlap: a deeper duck inside the first.
ctx.currentTime = 10.5;
A.duck('sfx', -15, { attack: 0.02, hold: 0.2, release: 0.1 });
{
  const evs = log('sfx');
  const lastCancel = evs.map(e => e.type).lastIndexOf('cancel');
  const t = evs.slice(lastCancel).filter(e => e.type === 'target');
  check('overlap: drops to the deeper duck', t[0] && near(t[0].value, db(-15)) && near(t[0].time, 10.5), JSON.stringify(t));
  check('overlap: steps back to the shallower one, not to unity', t[1] && near(t[1].value, db(-9)) && near(t[1].time, 10.5 + 0.02 + 0.2), JSON.stringify(t[1]));
  check('overlap: that step uses the deeper duck\'s release', t[1] && near(t[1].tc, 0.1 / 3));
  check('overlap: unity when the first duck ends', t[2] && near(t[2].value, 1) && near(t[2].time, 11.06), JSON.stringify(t[2]));
}

// Open-ended, then released.
ctx.currentTime = 20;
const h = A.duck('music', -6, { attack: 0.05, release: 0.3 });
check('open-ended: down, and no way back up yet', targets('music').length === 1 && near(targets('music')[0].value, db(-6)));
ctx.currentTime = 22;
h.release();
{
  const t = targets('music');
  check('released: back to unity from the release time', t.length >= 2 && near(t[t.length - 1].value, 1) && near(t[t.length - 1].time, 22), JSON.stringify(t));
  check('released: on the duck\'s own release', near(t[t.length - 1].tc, 0.3 / 3));
}

// speak() ducks for its own duration.
ctx.currentTime = 30;
const res = A.speak('The bed ducks under the voice and comes back.', { seed: 'announcer', duck: { buses: ['ambient'], dB: -10, attack: 0.05 } });
check('speak returns a duration', res && res.duration > 0, JSON.stringify(res));
if (res) {
  const t = targets('ambient').filter(e => e.time >= 30);
  const start = 30 + (res.delay ?? 0.05);
  check('speak: the bed goes down when the line starts', t[0] && near(t[0].value, db(-10)) && near(t[0].time, start, 1e-3), JSON.stringify(t[0]));
  check('speak: and comes back when it ends', t[1] && near(t[1].value, 1) && near(t[1].time, start + 0.05 + res.duration, 1e-3), JSON.stringify(t[1]));
}

done();
