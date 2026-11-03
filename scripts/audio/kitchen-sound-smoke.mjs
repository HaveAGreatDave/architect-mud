// KITCHEN SOUND SMOKE: the Kitchen Stage's cues stay clean, and the hob's sound follows the
// pan and the dial without reading a clock.
//
//   node scripts/audio/kitchen-sound-smoke.mjs
//
// WHAT IT GUARDS (docs/proposals/kitchen-stage.md, Next item 6):
//   • every kitchen-* cue in client/shared/sfx-catalog.js passes the critic (sfx-lint.mjs) with
//     no click, cut or peak over -1 dBFS; the cues added for item 6 pass it with no findings at
//     all, and sit in the loudness range of the kitchen cues around them
//   • hobSoundState (client/shared/kitchen-sound.js): dry, wet and boiling pans map to their
//     cues, the dial sets the level and 0 is silence, a food in its window steps it up once, and
//     nothing reads a stage count or the time (the countdown the workspace withholds)
//   • thockFor bands by firmness; only a fridge or a freezer hums
//   • the loop mixer crossfades a change of cue and stops what fell silent
//   • AudioEngine.loopSound's `whole` option: setLoopGain scales every layer, not the first
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tally, ROOT, loadEngine, downstream } from './stub-context.mjs';
import { measure, findings, render } from './sfx-lint.mjs';
import { momentaryMax } from './loudness-lib.mjs';

const { check, done } = tally('audio:kitchen');
const KS = await import(pathToFileURL(join(ROOT, 'client/shared/kitchen-sound.js')).href);
const { matterFor, MATTER } = await import(pathToFileURL(join(ROOT, 'client/shared/kitchen-matter.js')).href);

// ── the cues ─────────────────────────────────────────────────────────────────────────────────
new Function(readFileSync(join(ROOT, 'client/shared/sfx-catalog.js'), 'utf8'))();
const catalog = globalThis.SFXCatalog.defaults();
const kitchen = catalog.filter((d) => d.id.startsWith('kitchen-'));
const NEW = [...Object.values(KS.HOB_CUES), KS.HUM_CUE, KS.SEAL_OPEN, KS.SEAL_SHUT, ...KS.THOCKS.map((t) => t.cue)];
const byId = new Map(catalog.map((d) => [d.id, d]));
for (const id of NEW) check(`${id} is a built-in cue`, byId.has(id));
for (const id of Object.values(KS.HOB_CUES).concat(KS.HUM_CUE)) check(`${id} is marked as a loop for the critic`, !!byId.get(id)?.loop);

const BAD = new Set(['broken', 'click', 'cut', 'hot']);
for (const def of kitchen) {
  const fs = findings(def, await measure(def, { alias: false }));
  const fresh = NEW.includes(def.id);
  const bad = fresh ? fs : fs.filter((f) => BAD.has(f.code));
  check(`${def.id} passes the critic${fresh ? ' with no findings' : ' (click, cut, hot)'}`, !bad.length, bad.map((x) => `${x.code}: ${x.msg}`).join('; '));
  // levelled against the kitchen cues already there: the board's thock is about -27 LUFS, the
  // plate -28, the tap -33
  if (fresh) {
    const lu = momentaryMax(await render(def, 48000), 48000);
    check(`${def.id} sits with the other kitchen cues (-38 to -23 LUFS)`, lu > -38 && lu < -23, `${lu.toFixed(1)} LUFS`);
  }
}

// ── hobSoundState ────────────────────────────────────────────────────────────────────────────
const NOTCHES = [{ level: 2, name: 'low', from: 1, to: 3 }, { level: 5, name: 'mid', from: 4, to: 7 }, { level: 9, name: 'high', from: 8, to: 10 }];
let n = 0;
const food = (profile, extra = {}) => ({ id: `f${++n}`, kind: 'food', look: { profile, matter: null }, live: true, cook: { phase: null, stage: 1, stages: 4 }, ...extra });
const water = () => ({ ...food('liquid'), name: 'water', live: false, cook: null });
function payload(contents, { level = 5, hot = true, idle = false, pans = null } = {}) {
  return {
    area: pans || [{ id: 'p1', name: 'frying pan', place: 'on the stove', hot, look: { vessel: 'frying_pan' }, contents }],
    dials: [{ id: 's1', name: 'stove', level, max: 10, ceiling: 10, notches: NOTCHES, subjectId: 'p1', idle }],
    components: [], storage: [],
  };
}
const H = (p, o) => KS.hobSoundState(p, o);
const st = (p, o) => H(p, o).state;

check('oil and a steak at 7: dry', st(payload([food('fat_or_oil'), food('dense_meat')], { level: 7 })) === 'dry');
check('a steak alone: dry (it sizzles)', st(payload([food('dense_meat')])) === 'dry');
check('batter in a pan fries: dry', st(payload([food('batter')], { level: 6 })) === 'dry');
check('dry cue is kitchen-sizzle-dry', H(payload([food('dense_meat')])).cue === 'kitchen-sizzle-dry');
check('cheese alone (it only bubbles): wet', st(payload([food('dairy')])) === 'wet');
check('pasta in water at a simmer (2): wet', st(payload([water(), food('dry_starch')], { level: 2 })) === 'wet');
check('stock and a steak at a simmer (3): wet', st(payload([food('liquid'), food('dense_meat')], { level: 3 })) === 'wet');
check('wet cue is kitchen-sizzle-wet', H(payload([food('dairy')])).cue === 'kitchen-sizzle-wet');
check('pasta in water past a simmer (7): boil', st(payload([water(), food('dry_starch')], { level: 7 })) === 'boil');
check('stock and a steak past a simmer (4): boil', st(payload([food('liquid'), food('dense_meat')], { level: 4 })) === 'boil');
check('boil cue is kitchen-boil', H(payload([water(), food('dry_starch')], { level: 9 })).cue === 'kitchen-boil');
check('oil with water in it boils, not fries', st(payload([water(), food('fat_or_oil'), food('dry_starch')], { level: 8 })) === 'boil');

const silent = (r) => r.cue === null && r.state === null && r.gain === 0;
check('dial 0 is silence', silent(H(payload([food('dense_meat')], { level: 0 }))));
check('the knob turned to 0 before it is sent is silence', silent(H(payload([food('dense_meat')], { level: 6 }), { level: 0 })));
check('the knob turned up before it is sent sets the state', st(payload([water(), food('dry_starch')], { level: 2 }), { level: 8 }) === 'boil');
check('a ring that is out is silence', silent(H(payload([food('dense_meat')], { idle: true }))));
check('a pan off the heat is silence', silent(H(payload([food('dense_meat')], { hot: false }))));
check('a pot of water alone (no cook) is silence', silent(H(payload([water()], { level: 9 }))));
check('a food nothing is cooking is silence', silent(H(payload([food('dense_meat', { live: false })]))));
check('no payload is silence', silent(H(null)) && silent(H({})));

const g = (lv, extra) => H(payload([food('dense_meat', extra)], { level: lv })).gain;
check('the level rises with the dial', g(1) < g(4) && g(4) < g(7) && g(7) < g(10), [1, 4, 7, 10].map((l) => g(l)).join(' '));
check('the level stays within the cue', g(10, { cook: { phase: 'window' } }) <= 1 && g(1) > 0);
const win = (lv) => H(payload([food('dense_meat', { cook: { phase: 'window', stage: null, stages: null } })], { level: lv }));
check('a food in its window steps the level up', win(5).gain > g(5) && win(5).window === true);
check('the window steps it once, the same step at any dial', Math.abs((win(3).gain - g(3)) - (win(6).gain - g(6))) < 1e-9);
check('the window keeps the state', win(5).state === 'dry');

// nothing reads how near the next beat is: a stage count, the water warning or the clock
const at = (stage, stages, more = {}) => H(payload([water(), food('dry_starch', { cook: { phase: null, stage, stages, ...more } })], { level: 7 }));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('the stage count changes nothing', same(at(1, 4), at(3, 4)) && same(at(1, 4), at(4, 4)) && same(at(1, 4), at(0, 9)));
check('the water and dry warnings change nothing', same(at(1, 4), at(1, 4, { water: 'low', dry: true })));
const src = KS.hobSoundState.toString();
check('hobSoundState reads no clock and no stage count', !/Date|performance|\.stage\b|stages|setTimeout/.test(src));
const p0 = payload([food('fat_or_oil'), food('dense_meat')], { level: 7 }), before = JSON.stringify(p0);
check('hobSoundState is pure: the same answer twice and the payload untouched', same(H(p0), H(p0)) && JSON.stringify(p0) === before);

// the active pan: the one you picked, else the one on the heat
const two = payload(null, { level: 7, pans: [
  { id: 'p1', place: 'on the stove', hot: true, look: { vessel: 'frying_pan' }, contents: [food('dense_meat')] },
  { id: 'p2', place: 'in hand', hot: false, look: { vessel: 'pot' }, contents: [water(), food('dry_starch')] },
] });
check('with nothing picked the pan on the heat sounds', st(two) === 'dry');
check('a picked pan off the heat is silence', silent(H(two, { panId: 'p2' })));
check('a picked pan on the heat sounds', st(two, { panId: 'p1' }) === 'dry');

// ── the knife and the boxes ───────────────────────────────────────────────────────────────────
const firm = (p) => matterFor(p).cut.firmness;
check('a tomato is a soft stroke', KS.thockFor(firm('soft_vegetable')) === 'kitchen-thock-soft');
check('bread and egg are soft strokes', KS.thockFor(firm('bread')) === 'kitchen-thock-soft' && KS.thockFor(firm('egg')) === 'kitchen-thock-soft');
check('meat, fruit and onion are medium strokes', ['dense_meat', 'fruit', 'aromatic'].every((p) => KS.thockFor(firm(p)) === 'kitchen-thock-medium'));
check('a potato is a hard stroke', KS.thockFor(firm('starchy_vegetable')) === 'kitchen-thock-hard');
check('a food with no firmness is a medium stroke', KS.thockFor(undefined) === 'kitchen-thock-medium');
check('every matter class has a stroke', Object.keys(MATTER).every((p) => NEW.includes(KS.thockFor(firm(p)))));
check('a fridge and a freezer hum', KS.boxHums({ preserves: 'cold' }) && KS.boxHums({ preserves: 'frozen' }));
check('a cupboard and a bin do not', !KS.boxHums({ name: 'cupboard' }) && !KS.boxHums({ trash: true }) && !KS.boxHums(null));

// ── the loop mixer ────────────────────────────────────────────────────────────────────────────
{
  const calls = [], playing = new Set(), timers = new Map();
  let tid = 0;
  const engine = {
    isLooping: (id) => playing.has(id),
    loopSound: (def, o) => { calls.push(['loop', def.id, o.whole, o.gain]); playing.add(def.id); },
    setLoopGain: (id, f) => calls.push(['gain', id, f]),
    stopLoop: (id) => { calls.push(['stop', id]); playing.delete(id); },
  };
  const mix = KS.createLoopMixer({ engine, cueOf: (id) => ({ id }), later: (fn) => { timers.set(++tid, fn); return tid; }, cancel: (t) => timers.delete(t) });
  const flush = () => { for (const [k, fn] of [...timers]) { timers.delete(k); fn(); } };
  const take = () => calls.splice(0).map((c) => c.join(' ')).join(', ');
  mix.set({ a: 0.6 });
  check('a cue starts silent as a whole loop and fades to its level', take() === 'loop a true 0, gain a 0.6');
  mix.set({ a: 0.6 });
  check('the same level again sends nothing', take() === '');
  mix.set({ a: 0.8 });
  check('a new level is one gain change', take() === 'gain a 0.8');
  mix.set({ b: 0.7 });
  check('a change of cue fades the old out and the new in', take() === 'gain a 0, loop b true 0, gain b 0.7');
  flush();
  check('the old cue stops once it is silent', take() === 'stop a' && !playing.has('a') && playing.has('b'));
  mix.set({});
  mix.set({ b: 0.5 });
  flush();
  check('a cue wanted back before it stopped keeps playing', take() === 'gain b 0, gain b 0.5' && playing.has('b'));
  mix.set({});
  flush();
  check('nothing wanted stops everything', take() === 'gain b 0, stop b' && !playing.size && !mix.live.size);
  mix.set({ a: 0.4 }); mix.stopAll();
  check('stopAll stops what is playing', take() === 'loop a true 0, gain a 0.4, stop a' && !mix.live.size);
  const none = KS.createLoopMixer({ engine: () => undefined, cueOf: () => null });
  none.set({ a: 1 });
  check('no engine yet is no error', none.live.size === 0);
}

// ── loopSound's whole option (last: the stub engine replaces setTimeout) ──────────────────────
{
  const { A, nodes } = loadEngine();
  const def = { id: 'kt', category: 'sfx', config: { layers: [
    { waveform: 'sine', freq: 200, gain: 0.3, adsr: { a: 0.1, d: 0.1, s: 1, r: 0.2 } },
    { waveform: 'noise', noiseMix: 1, gain: 0.1, filter: { type: 'bandpass', freq: 2000, q: 1 }, adsr: { a: 0.1, d: 0.1, s: 1, r: 0.2 } },
  ] } };
  const from = nodes.length;
  A.loopSound(def, { whole: true, gain: 0 });
  check('isLooping says the loop is playing', A.isLooping('kt'));
  A.setLoopGain('kt', 0.5, 0.1);
  const made = nodes.slice(from);
  const whole = made.find((x) => x.kind === 'gain' && x.gain.log.some((e) => e.type === 'ramp' && e.value === 0.5));
  check('setLoopGain ramps one gain node', !!whole);
  check('it started at the gain asked for', whole?.gain.log[0]?.type === 'set' && whole.gain.log[0].value === 0);
  const sources = made.filter((x) => x.kind === 'osc' || x.kind === 'buffersrc');
  check('every layer goes through it', sources.length >= 2 && sources.every((s) => downstream(s).has(whole)), `${sources.length} sources`);
  A.stopLoop('kt');
  check('isLooping says it stopped', !A.isLooping('kt'));
}

done();
