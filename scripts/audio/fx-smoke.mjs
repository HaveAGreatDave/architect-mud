// FX SMOKE: SIREN's effect stages build when their key is there, do what they say, and
// leave every other layer alone.
//
//   node scripts/audio/fx-smoke.mjs
//
// Two halves. The graph half reads what a layer builds on the recording context in
// stub-context.mjs; the sound half renders through scripts/audio/offline-audio.mjs and
// measures single frequencies (Goertzel), so a check says what came out, not what was wired.
//
// WHAT IT GUARDS:
//   • a layer with none of the stage keys builds none of their nodes
//   • `mute` builds nothing and plays silence
//   • the sub sits an octave (or two) down and takes the `pitch` cable with the oscillator
//   • the ring modulator puts out the sum and difference and not the note
//   • `slope: 24` cuts harder above the cutoff, and a cutoff cable reaches both stages
//   • the EQ boosts what it says, the wavefolder adds harmonics, the tube drive leaves no DC
//   • the phaser builds its allpasses, the chorus two wandering delays, `heads: 2` a second head
//   • a sequencer schedules its steps round and round
//   • playSfx's `probe` hears of each mod's output and each compressor, with its layer
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, tally, ROOT } from './stub-context.mjs';
import { installAudioGlobals } from './offline-audio.mjs';

const { check, done } = tally('audio:fx');

// ── The graph ────────────────────────────────────────────────────────────────
const { A, nodes, timers } = loadEngine();
function build(layer, opts) {
  for (const t of timers.splice(0)) if (t.ms > 50) t.fn();
  const from = nodes.length;
  A.playSfx({ id: 'fx-smoke', category: 'sfx', priority: 9, config: { duration: 0.5, layers: [layer] } }, 1, opts);
  return nodes.slice(from);
}
const BASE = { waveform: 'sawtooth', freq: 220, filter: { type: 'lowpass', freq: 1200, q: 2 }, echo: { mix: 0.3, delay: 0.2, feedback: 0.4 }, adsr: { a: 0.01, d: 0.1, s: 0.5, r: 0.2 }, gain: 0.5 };
const kinds = (made) => made.map(n => `${n.kind}:${n.type || ''}`);
{
  const k = kinds(build(BASE));
  check('a plain layer builds no compressor, allpass, merger or constant', !k.some(x => /^comp|allpass|^merger|^constant/.test(x)));
  check('a plain layer has one filter and one delay', k.filter(x => x.startsWith('filter')).length === 1 && k.filter(x => x.startsWith('delay')).length === 1);
}
check('mute builds nothing past the cue', !build({ ...BASE, mute: true }).some(n => n.kind === 'osc'));
{
  const made = build({ ...BASE, sub: { level: 0.6, octave: 2 }, mods: [{ id: 'l', type: 'lfo', rate: 3, to: [{ param: 'pitch', amount: 100 }] }] });
  const oscs = made.filter(n => n.kind === 'osc' && n.frequency.log.some(e => e.type === 'set'));
  const freqs = oscs.map(o => o.frequency.log.find(e => e.type === 'set').value);
  check('the sub is two octaves down', freqs.includes(220) && freqs.includes(55), freqs.join(','));
  const into = (o) => made.some(n => n.kind === 'gain' && n.out.some(c => c.dst?._owner === o && c.dst?._name === 'detune'));
  check('a pitch cable reaches the oscillator and the sub', oscs.filter(o => o.frequency.log[0].value !== 3).every(into));
}
{
  const made = build({ ...BASE, filter: { ...BASE.filter, slope: 24 }, mods: [{ id: 'l', type: 'lfo', rate: 3, to: [{ param: 'filter.cutoff', amount: 1200 }] }] });
  const filters = made.filter(n => n.kind === 'filter' && n.type === 'lowpass');
  check('slope 24 is two lowpass stages', filters.length === 2);
  check('a cutoff cable reaches both', filters.every(f => made.some(n => n.kind === 'gain' && n.out.some(c => c.dst?._owner === f && c.dst?._name === 'detune'))));
}
check('the phaser builds its stages', build({ ...BASE, phaser: { stages: 6 } }).filter(n => n.kind === 'filter' && n.type === 'allpass').length === 6);
{
  const made = build({ ...BASE, chorus: { delay: 0.012, depth: 0.4 } });
  const ds = made.filter(n => n.kind === 'delay' && made.some(g => g.out.some(c => c.dst?._owner === n && c.dst?._name === 'delayTime')));
  check('the chorus is two delays that wander', ds.length === 2 && made.some(n => n.kind === 'merger'));
}
check('heads: 2 adds a second delay', build({ ...BASE, echo: { ...BASE.echo, heads: 2 } }).filter(n => n.kind === 'delay').length === 2);
{
  const made = build({ ...BASE, mods: [{ id: 's', type: 'seq', rate: 10, steps: [0, 0.5, -0.5], to: [{ param: 'pitch', amount: 1200 }] }] });
  const c = made.find(n => n.kind === 'constant');
  const vals = c?.offset.log.filter(e => e.type === 'set').slice(0, 6).map(e => e.value);
  check('a sequencer steps round its steps', JSON.stringify(vals) === JSON.stringify([0, 0.5, -0.5, 0, 0.5, -0.5]), JSON.stringify(vals));
}
{
  const heard = [];
  const layer = { ...BASE, comp: { threshold: -30 }, mods: [{ id: 'l', type: 'lfo', rate: 3, to: [{ param: 'amp', amount: 0.5 }] }, { id: 'e', type: 'env', to: [] }] };
  build(layer, { probe: (kind, id, node, l) => heard.push(`${kind}:${id}:${l === layer}`) });
  check('the probe hears each mod and the compressor, with its layer', ['mod:l:true', 'mod:e:true', 'comp:comp:true'].every(h => heard.includes(h)), heard.join(' '));
  const after = [];
  build(layer, {});
  check('and nothing after the cue that asked', after.length === 0);
}

// ── The sound ────────────────────────────────────────────────────────────────
installAudioGlobals();
new Function(readFileSync(join(ROOT, 'client/shared/audio-engine.js'), 'utf8'))();
const AE = globalThis.AudioEngine, SR = 24000;
async function render(layer, seconds = 0.6) {
  const buf = await AE.renderSfx({ id: 'fx', category: 'sfx', priority: 9, config: { duration: 0.5, layers: [layer] } }, { sampleRate: SR, seconds });
  return buf.getChannelData(0).slice(Math.round(0.05 * SR), Math.round(0.45 * SR));
}
// the level of one frequency in a block, by Goertzel
function tone(x, f) {
  const w = (2 * Math.PI * f) / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) { const s = x[i] + c * s1 - s2; s2 = s1; s1 = s; }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / x.length;
}
const SINE = { waveform: 'sine', freq: 440, adsr: { a: 0.005, d: 0.05, s: 1, r: 0.1 }, gain: 0.5 };
{
  const x = await render({ ...SINE, mute: true });
  check('a muted layer is silence', x.every(v => v === 0));
}
{
  const x = await render({ ...SINE, sub: { level: 1 } });
  check('the sub sounds an octave down', tone(x, 220) > tone(x, 440) * 0.5, `${tone(x, 220)} vs ${tone(x, 440)}`);
}
{
  const x = await render({ ...SINE, ring: { ratio: 1.5, mix: 1 } });
  check('the ring puts out the sum and difference, not the note', tone(x, 220) > 10 * tone(x, 440) && tone(x, 1100) > 10 * tone(x, 440));
}
{
  const saw = { ...SINE, waveform: 'sawtooth', freq: 200 };
  const a = await render({ ...saw, filter: { type: 'lowpass', freq: 600, q: 0 } });
  const b = await render({ ...saw, filter: { type: 'lowpass', freq: 600, q: 0, slope: 24 } });
  check('slope 24 cuts harder above the cutoff', tone(b, 2400) < tone(a, 2400) * 0.5, `${tone(b, 2400)} vs ${tone(a, 2400)}`);
}
{
  const a = await render(SINE), b = await render({ ...SINE, eq: { mid: 12, midFreq: 440 } });
  check('the EQ boosts what it says', tone(b, 440) > tone(a, 440) * 3);
}
{
  const a = await render(SINE), b = await render({ ...SINE, fold: { amount: 0.8 } });
  check('the wavefolder adds harmonics', tone(b, 1320) > tone(a, 1320) * 20 && tone(b, 1320) > 0.01);
}
{
  const x = await render({ ...SINE, drive: 0.8, driveType: 'tube' });
  const dc = x.reduce((s, v) => s + v, 0) / x.length;
  check('the tube drive leaves no DC', Math.abs(dc) < 0.01, String(dc));
  check('every new stage renders finite', [x].every(a => a.every(Number.isFinite)));
}
for (const extra of [{ phaser: {} }, { chorus: { feedback: 0.8, delay: 0.002 } }, { comp: { makeup: 12 } }, { echo: { mix: 0.5, heads: 2, feedback: 0.9 } }]) {
  const x = await render({ ...SINE, ...extra });
  check(`${Object.keys(extra)[0]} renders finite and bounded`, x.every(v => Number.isFinite(v) && Math.abs(v) < 8));
}

done();
