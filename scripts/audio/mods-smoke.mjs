// MODS SMOKE: a layer's `mods` patch LFO, envelope and random sources into the stages it built.
//
//   node scripts/audio/mods-smoke.mjs
//
// Pure: reads the graph a layer builds on the recording context in stub-context.mjs.
//
// WHAT IT GUARDS:
//   • a layer without mods, or with an empty list, builds the same graph as before
//   • each target lands on the right AudioParam, with the cable gain scaled to its unit
//   • `amp` and `pan` get a stage of their own only when something is patched into them
//   • one mod can modulate another's rate and depth
//   • a target the layer has no stage for is skipped, and a loop between mods is dropped
//   • every source stops on release, and an envelope mod releases with the layer
//   • a seeded random mod schedules the same steps every time
import { loadEngine, tally } from './stub-context.mjs';

const { check, done } = tally('audio:mods');
const { A, nodes, timers } = loadEngine();

function build(layer, opts) {
  // free the voices the last builds held, or the 32-voice pool drops the next cue
  for (const t of timers.splice(0)) if (t.ms > 50) t.fn();
  const from = nodes.length;
  const r = A.playSfx({ id: 'mods-smoke', category: 'sfx', priority: 9, config: { duration: 0.5, layers: [layer] } }, 1, opts);
  return { made: nodes.slice(from), handle: r };
}
// A graph as text: every node, its connections and its param schedules, by local index.
function trace(made) {
  const ix = new Map(made.map((n, i) => [n, i]));
  return made.map((n, i) => {
    const outs = n.out.map(o => o.dst?.kind ? `n${ix.get(o.dst) ?? 'ext'}` : `p:${ix.get(o.dst?._owner) ?? 'ext'}.${o.dst?._name}`);
    const params = Object.values(n).filter(v => v && v.log).map(p => `${p._name}=${JSON.stringify(p.log)}`);
    return `${i}:${n.kind}:${n.type || ''}>${outs.join(',')}|${params.join(';')}`;
  }).join('\n');
}
const cablesInto = (made, owner, name) => made.filter(n => n.kind === 'gain' && n.out.some(o => o.dst?._owner === owner && o.dst?._name === name));

const FULL = {
  waveform: 'sawtooth', freq: 220, detune: 4, noiseMix: 0.3, noiseRate: 0.8, drive: 0.3,
  fm: { ratio: 2, index: 1.5, op2: { ratio: 3, index: 0.5 } },
  filter: { type: 'lowpass', freq: 1200, q: 2 }, tremolo: { rate: 5, depth: 0.2 },
  echo: { mix: 0.3, delay: 0.2, feedback: 0.4 }, adsr: { a: 0.01, d: 0.1, s: 0.5, r: 0.2 }, gain: 0.5,
};

// ── No mods is the old graph ────────────────────────────────────────────────
const bare = trace(build(FULL).made);
check('an empty mods list builds the same graph as none', trace(build({ ...FULL, mods: [] }).made) === bare);
const bareMade = build(FULL).made;
check('no mods: no constant sources', !bareMade.some(n => n.kind === 'constant'));
check('no mods: no panner on an unpanned layer', !bareMade.some(n => n.kind === 'panner'));

// ── Each target ─────────────────────────────────────────────────────────────
const lfoTo = (param, amount) => ({ ...FULL, mods: [{ id: 'l', type: 'lfo', wave: 'triangle', rate: 3, to: [{ param, amount }] }] });
function landing(param, amount, pick) {
  const { made } = build(lfoTo(param, amount));
  const lfo = made.find(n => n.kind === 'osc' && n.type === 'triangle');
  const [owner, name] = pick(made);
  const c = owner && cablesInto(made, owner, name)[0];
  return { lfo, c, made };
}
const oscs = (made) => made.filter(n => n.kind === 'osc');
const cases = [
  ['pitch', 50, 50, (m) => [oscs(m).find(n => n.type === 'sawtooth'), 'detune']],
  // fm.index: index units times the modulator, 220 Hz * ratio 2
  ['fm.index', 2, 2 * 440, (m) => [m.find(n => n.kind === 'gain' && n.out.some(o => o.dst?._name === 'frequency' && o.dst._owner.type === 'sawtooth')), 'gain']],
  ['fm.ratio', 100, 100, (m) => [oscs(m).find(n => n.type === 'sine' && n.out.some(o => o.dst?.kind === 'gain' && o.dst.out.some(p => p.dst?._owner?.type === 'sawtooth'))), 'detune']],
  ['op2.index', 1, 660, (m) => [m.find(n => n.kind === 'gain' && n.out.some(o => o.dst?._name === 'frequency' && o.dst._owner.type === 'sine')), 'gain']],
  ['filter.cutoff', 1200, 1200, (m) => [m.find(n => n.kind === 'filter'), 'detune']],
  ['filter.q', 3, 3, (m) => [m.find(n => n.kind === 'filter'), 'Q']],
  ['echo.time', 0.05, 0.05, (m) => [m.find(n => n.kind === 'delay'), 'delayTime']],
  ['echo.feedback', 1, 0.95 - 0.4, (m) => [m.find(n => n.kind === 'delay')?.out.map(o => o.dst).find(d => d.kind === 'gain'), 'gain']],
  ['noise.rate', 0.3, 0.3, (m) => [m.find(n => n.kind === 'buffersrc'), 'playbackRate']],
];
for (const [param, amount, want, pick] of cases) {
  const { lfo, c } = landing(param, amount, pick);
  check(`${param}: a cable reaches the param`, !!c, 'no gain feeding it');
  if (c) check(`${param}: cable gain is ${want}`, Math.abs(c.gain.value - want) < 1e-6, String(c.gain.value));
  check(`${param}: the LFO started`, lfo?.started != null);
}
// fm.index on a ratio-2 operator: amount in index units times the modulator's Hz.
{
  const { made } = build({ ...FULL, freq: 300, mods: [{ id: 'l', type: 'lfo', rate: 3, to: [{ param: 'fm.index', amount: 2 }] }] });
  const opGain = made.find(n => n.kind === 'gain' && n.out.some(o => o.dst?._name === 'frequency' && o.dst._owner.type === 'sawtooth'));
  const c = cablesInto(made, opGain, 'gain')[0];
  check('fm.index scales by the modulator rate (300 * 2 * 2)', c && Math.abs(c.gain.value - 1200) < 1e-6, String(c?.gain.value));
}

// ── amp and pan stages exist only when patched ──────────────────────────────
{
  const a = build(lfoTo('amp', 0.5)).made;
  check('amp: one more gain than the bare layer, plus the cable and the depth', a.filter(n => n.kind === 'gain').length === bareMade.filter(n => n.kind === 'gain').length + 3);
  const p = build(lfoTo('pan', 0.7)).made;
  const panner = p.find(n => n.kind === 'panner');
  check('pan: a centred panner is built for the mod', panner && panner.pan.value === 0);
  check('pan: the cable moves it', panner && cablesInto(p, panner, 'pan')[0]?.gain.value === 0.7);
}

// ── Mod into mod ────────────────────────────────────────────────────────────
{
  const { made } = build({ ...FULL, mods: [
    { id: 'slow', type: 'lfo', wave: 'square', rate: 0.5, to: [{ param: 'mod.fast.rate', amount: 4 }, { param: 'mod.fast.amount', amount: 0.5 }] },
    { id: 'fast', type: 'lfo', wave: 'triangle', rate: 6, to: [{ param: 'filter.cutoff', amount: 600 }] },
  ] });
  const fast = made.find(n => n.kind === 'osc' && n.type === 'triangle');
  check('mod.fast.rate: a cable into the fast LFO frequency', fast && cablesInto(made, fast, 'frequency')[0]?.gain.value === 4);
  const fastDepth = fast?.out.map(o => o.dst).find(d => d.kind === 'gain');
  check('mod.fast.amount: a cable into its depth gain', fastDepth && cablesInto(made, fastDepth, 'gain')[0]?.gain.value === 0.5);
}

// ── Skips and loops ─────────────────────────────────────────────────────────
{
  const noFilter = { ...FULL, filter: undefined, formants: [700, 1200] };
  const { made } = build({ ...noFilter, mods: [{ id: 'l', type: 'lfo', rate: 3, to: [{ param: 'filter.cutoff', amount: 1200 }] }] });
  check('cutoff with formants and no filter: no cable built', !made.some(n => n.kind === 'gain' && n.out.some(o => o.dst?._name === 'detune' && o.dst._owner.kind === 'filter')));
  const self = build({ ...FULL, mods: [{ id: 'l', type: 'lfo', rate: 3, to: [{ param: 'mod.l.rate', amount: 1 }] }] }).made;
  const lo = self.find(n => n.kind === 'osc' && n.type === 'sine' && n.frequency.log[0]?.value === 3);
  check('a self-patch is dropped', lo && cablesInto(self, lo, 'frequency').length === 0);
  const loop = build({ ...FULL, mods: [
    { id: 'a', type: 'lfo', wave: 'square', rate: 1, to: [{ param: 'mod.b.rate', amount: 1 }] },
    { id: 'b', type: 'lfo', wave: 'triangle', rate: 2, to: [{ param: 'mod.a.rate', amount: 1 }] },
  ] }).made;
  const la = loop.find(n => n.kind === 'osc' && n.type === 'square'), lb = loop.find(n => n.kind === 'osc' && n.type === 'triangle');
  check('a loop keeps its first patch', lb && cablesInto(loop, lb, 'frequency').length === 1);
  check('and drops the one that closes it', la && cablesInto(loop, la, 'frequency').length === 0);
  const junk = build({ ...FULL, mods: [{ id: 'x', type: 'banana', to: [{ param: 'pitch', amount: 1 }] }, { type: 'lfo', to: [{ param: 'pitch', amount: 1 }] }] }).made;
  check('an unknown type or a mod with no id builds nothing', trace(junk) === bare);
}

// ── Release ─────────────────────────────────────────────────────────────────
{
  const { made } = build({ ...FULL, mods: [
    { id: 'e', type: 'env', a: 0.01, d: 0.2, s: 0.3, r: 0.4, to: [{ param: 'filter.cutoff', amount: 2400 }] },
    { id: 'r', type: 'rand', rate: 10, to: [{ param: 'pitch', amount: 30 }] },
  ] });
  const cs = made.filter(n => n.kind === 'constant');
  check('env and rand are constant sources', cs.length === 2);
  check('every source stops on release', cs.every(n => n.stopped != null));
  const env = cs[0];
  check('the envelope ramps up to 1', env.offset.log.some(e => e.type === 'ramp' && e.value === 1));
  check('the envelope releases toward 0', env.offset.log.some(e => e.type === 'target' && e.value === 0));
  const held = build({ ...FULL, mods: [{ id: 'e', type: 'env', a: 0.01, d: 0.2, s: 0.3, to: [{ param: 'pitch', amount: 10 }] }] }, { sustain: true });
  const henv = held.made.find(n => n.kind === 'constant');
  check('a held note leaves its envelope open', henv && !henv.offset.log.some(e => e.type === 'target' && e.value === 0) && henv.stopped == null);
  held.handle?.release();
  check('and closes it on release', henv && henv.offset.log.some(e => e.type === 'target' && e.value === 0) && henv.stopped != null);
}

// ── Seeded random ───────────────────────────────────────────────────────────
{
  const steps = (seed) => build({ ...FULL, mods: [{ id: 'r', type: 'rand', rate: 20, seed, to: [{ param: 'pitch', amount: 30 }] }] })
    .made.find(n => n.kind === 'constant').offset.log.map(e => e.value.toFixed(6)).join(',');
  check('the same seed gives the same steps', steps(7) === steps(7));
  check('a different seed gives different steps', steps(7) !== steps(8));
  const s = steps(7).split(',').map(Number);
  check('steps stay within -1..1', s.every(v => v >= -1 && v <= 1));
  check('steps cover the note (0.5 s + tail at 20 Hz)', s.length >= 10 && s.length < 40, String(s.length));
}

done();
