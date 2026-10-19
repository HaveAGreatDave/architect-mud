// RACK SMOKE: the Audio tab's Rack gives back the row it was opened with, and its edits touch
// only what they say.
//
//   node scripts/audio/rack-smoke.mjs
//
// Pure: runs the model half of client/devpanel/js/panels/audio-rack.js in Node, with no DOM
// and no engine.
//
// WHAT IT GUARDS:
//   • a flat sfx, a layered sfx, an ambient bed and an instrument each load and save back to
//     the same row, keys the rack has no knob for included, and an instrument keeps its
//     waveform on the row
//   • every shipped audio_sfx, audio_ambient and audio_instruments row round-trips
//   • patching and unpatching a cable change only the layer's `mods`
//   • a mod can't patch itself or close a loop, and only an LFO has a rate jack
//   • bypass stashes a unit in layer.rack and brings it back as it was
//   • one-per-layer units refuse a second copy; Op 2 needs Op 1; Filter and Formants share a slot
//   • removing a mod unplugs every cable into it
//   • the rack's jacks are exactly the engine's MOD_TARGETS
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tally, ROOT, loadEngine } from './stub-context.mjs';

const { check, done } = tally('audio:rack');
const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
  return v;
}

const NAMES = ['rackFromRow', 'rackToRow', 'rackAdd', 'rackRemove', 'rackBypass', 'rackPatch', 'rackUnpatch', 'rackCanAdd',
  'rackUnitsOf', 'rackLiveTargets', 'rackAddLayer', 'rackDeleteLayer', 'RACK_TARGETS', 'RACK_UNITS', 'RACK_MODS'];
const R = new Function(readFileSync(join(ROOT, 'client/devpanel/js/panels/audio-rack.js'), 'utf8') + `\nreturn { ${NAMES.join(', ')} };`)();

// What the save sends, minus the id the URL carries.
const expectRow = (row) => { const o = structuredClone(row); delete o.id; return o; };

// ── Round trips ─────────────────────────────────────────────────────────────
const FLAT = { id: 'sfx_x', name: 'x', category: 'combat', priority: 4, enabled: 1,
  config: { duration: 0.3, send: 0.4, waveform: 'square', freq: 300, noiseSeed: 7, fm: { ratio: 2, index: 3, op2: { ratio: 5, index: 1 } }, adsr: { a: 0.001, d: 0.1, s: 0, r: 0.1 } } };
const LAYERED = { id: 'sfx_y', name: 'y', category: 'sfx', priority: 6, enabled: 1,
  config: { duration: 1, duck: { buses: ['ambient'], dB: -6 }, sparkle: [{ everyMin: 1 }], layers: [{ waveform: 'sine', freq: 80 }, { noiseMix: 1, noise: 'pink', mystery: { a: 1 } }] } };
const AMB = { id: 'amb_z', name: 'z', category: 'environment', priority: 1, loop: 1, enabled: 1,
  config: { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 600 }, gain: 0.4, sparkle: [{ prob: 0.5 }] } };
const INST = { id: 'aud_i', name: 'i', category: 'lead', waveform: 'sawtooth', sample_id: null, enabled: 1,
  config: { adsr: { a: 0.01, d: 0.2, s: 0.5, r: 0.3 }, fm: { ratio: 1, index: 2 } } };
for (const [tab, row] of [['sfx', FLAT], ['sfx', LAYERED], ['ambient', AMB], ['instruments', INST]]) {
  const out = R.rackToRow(R.rackFromRow(tab, row));
  check(`${tab} ${row.id}: round-trips`, same(out, expectRow(row)), `in  ${JSON.stringify(sortKeys(expectRow(row)))}\n      out ${JSON.stringify(sortKeys(out))}`);
}
{
  const r = R.rackFromRow('instruments', INST);
  check('instrument: the waveform shows on the layer', r.layers[0].waveform === 'sawtooth');
  r.layers[0].waveform = 'square';
  const out = R.rackToRow(r);
  check('instrument: a waveform change goes to the row, not the config', out.waveform === 'square' && !('waveform' in out.config));
}

// Every shipped row.
let shipped = 0, bad = [];
for (const [dir, tab] of [['audio_sfx', 'sfx'], ['audio_ambient', 'ambient'], ['audio_instruments', 'instruments']]) {
  for (const f of readdirSync(join(ROOT, 'content', dir))) {
    const row = JSON.parse(readFileSync(join(ROOT, 'content', dir, f), 'utf8'));
    if (row.category === 'voice') continue;
    shipped++;
    if (!same(R.rackToRow(R.rackFromRow(tab, row)), expectRow(row))) bad.push(`${dir}/${f}`);
  }
}
check(`all ${shipped} shipped rows round-trip`, bad.length === 0, bad.slice(0, 5).join(', '));

// ── Patching ────────────────────────────────────────────────────────────────
{
  const r = R.rackFromRow('sfx', structuredClone(FLAT));
  r.layers[0].filter = { type: 'lowpass', freq: 1000 };
  const before = structuredClone(r.layers[0]);
  const id = R.rackAdd(r, 0, 'lfo');
  check('adding an LFO gives it an id', id === 'lfo1');
  check('patch into cutoff', R.rackPatch(r, 0, id, 'filter.cutoff') === true);
  const m = r.layers[0].mods[0];
  check('the cable starts at the jack default', m.to[0].param === 'filter.cutoff' && m.to[0].amount === R.RACK_TARGETS['filter.cutoff'].amt);
  R.rackPatch(r, 0, id, 'filter.cutoff', 300);
  check('patching the same pair again sets its amount', m.to.length === 1 && m.to[0].amount === 300);
  const after = structuredClone(r.layers[0]);
  delete after.mods;
  check('a patch touches nothing but mods', same(after, before));
  check('unpatch removes the cable', R.rackUnpatch(r, 0, id, 'filter.cutoff') && m.to.length === 0);

  const id2 = R.rackAdd(r, 0, 'rand');
  const id3 = R.rackAdd(r, 0, 'env');
  check('a mod can\'t patch itself', R.rackPatch(r, 0, id, `mod.${id}.rate`) !== true);
  check('a random can modulate an LFO\'s rate', R.rackPatch(r, 0, id2, `mod.${id}.rate`) === true);
  check('only an LFO has a rate jack', R.rackPatch(r, 0, id, `mod.${id2}.rate`) !== true);
  check('the LFO into the random\'s depth closes a loop and is refused', R.rackPatch(r, 0, id, `mod.${id2}.amount`) !== true);
  check('an envelope into the LFO depth is fine', R.rackPatch(r, 0, id3, `mod.${id}.amount`) === true);
  check('an unknown jack is refused', R.rackPatch(r, 0, id, 'nonsense') !== true);
  R.rackRemove(r, 0, `mod:${id}`);
  check('removing a mod unplugs every cable into it', r.layers[0].mods.every(o => o.to.every(c => !c.param.startsWith(`mod.${id}.`))));
  const live = R.rackLiveTargets(r.layers[0]);
  check('live jacks follow the stages', live.has('filter.cutoff') && live.has('fm.index') && live.has('op2.ratio') && !live.has('echo.time'));
}

// ── Bypass and the slot rules ───────────────────────────────────────────────
{
  const r = R.rackFromRow('sfx', structuredClone(FLAT));
  r.layers[0].drive = 0.4;
  R.rackBypass(r, 0, 'fm');
  check('bypassed FM leaves the layer', !('fm' in r.layers[0]));
  check('and waits in layer.rack', r.layers[0].rack?.bypass?.fm?.fm?.op2?.ratio === 5);
  check('it still shows in the rack, switched off', R.rackUnitsOf(r.layers[0]).some(u => u.key === 'fm' && !u.on));
  R.rackBypass(r, 0, 'fm');
  check('switching it back on restores it exactly', same(r.layers[0].fm, FLAT.config.fm) && !Object.keys(r.layers[0].rack.bypass).length);
  check('a saved rack drops an empty layer.rack', !('rack' in R.rackToRow(r).config));
  R.rackBypass(r, 0, 'drive');
  const saved = R.rackToRow(r).config;
  check('a bypassed unit ships in layer.rack, out of the engine\'s way', saved.drive === undefined && saved.rack?.bypass?.drive?.drive === 0.4);

  check('a second filter is refused', (R.rackAdd(r, 0, 'filter'), typeof R.rackAdd(r, 0, 'filter') === 'string'));
  check('formants share the filter\'s slot', typeof R.rackCanAdd(r, 0, 'formants') === 'string');
  const bare = R.rackFromRow('sfx', { id: 'b', name: 'b', config: { waveform: 'sine' } });
  check('Op 2 needs Op 1', typeof R.rackAdd(bare, 0, 'op2') === 'string');
  R.rackAdd(bare, 0, 'fm');
  check('and goes in once it\'s there', R.rackAdd(bare, 0, 'op2') === true && bare.layers[0].fm.op2.ratio === 3);
  check('the last source can\'t be removed', R.rackRemove(bare, 0, 'osc') === false);
  check('the amp envelope can\'t be removed', R.rackRemove(bare, 0, 'amp') === false);
  R.rackAdd(bare, 0, 'retro');
  check('a cue unit goes on the cue', bare.cue.retro?.bits === 8 && !('retro' in bare.layers[0]));
  const li = R.rackAddLayer(bare, 0);
  check('duplicating a layer copies it after itself', li === 1 && same(bare.layers[1], bare.layers[0]));
  check('a two-layer sfx saves as layers', Array.isArray(R.rackToRow(bare).config.layers));
  R.rackDeleteLayer(bare, 1);
  check('the last layer can\'t be deleted', R.rackDeleteLayer(bare, 0) === false);
}

// ── Every unit goes in, switches off and comes back exactly ─────────────────
{
  const r = R.rackFromRow('sfx', { id: 'u', name: 'u', config: { waveform: 'sawtooth', freq: 220 } });
  for (const u of R.RACK_UNITS) {
    if (u.fixed || u.source || u.key === 'formants') continue;
    const why = R.rackAdd(r, 0, u.key);
    check(`${u.key}: goes in`, why === true, String(why));
    // an emptied layer.rack is the editor's, and the save drops it
    const bare = (l) => { const o = structuredClone(l); if (o.rack && !Object.keys(o.rack.bypass || {}).length) delete o.rack; return o; };
    const before = bare(r.layers[0]);
    R.rackBypass(r, 0, u.key);
    check(`${u.key}: switched off, it leaves the layer`, R.rackUnitsOf(r.layers[0]).some(x => x.key === u.key && !x.on) && !u.owns.some(p => p in r.layers[0] && p.indexOf('.') < 0));
    R.rackBypass(r, 0, u.key);
    check(`${u.key}: switched back on, it's as it was`, same(bare(r.layers[0]), before));
  }
  const live = R.rackLiveTargets(r.layers[0]);
  check('every new stage\'s jacks are live once it\'s in', ['sub.level', 'fold.amount', 'ring.freq', 'eq.freq', 'phaser.rate', 'phaser.freq', 'chorus.rate', 'chorus.depth'].every(p => live.has(p)));
}

// ── The sources' power switches ─────────────────────────────────────────────
{
  const mix = R.rackFromRow('sfx', { id: 'm', name: 'm', config: { waveform: 'square', freq: 200, noiseMix: 0.3 } });
  const L = () => mix.layers[0];
  const orig = structuredClone(L());
  R.rackBypass(mix, 0, 'osc');
  check('oscillator off with noise on: all noise', L().noiseMix === 1 && !L().mute);
  R.rackBypass(mix, 0, 'noise');
  check('both off: the layer is muted', L().mute === true);
  R.rackBypass(mix, 0, 'osc');
  check('oscillator back on alone: no noise', L().noiseMix === 0 && !L().mute);
  R.rackBypass(mix, 0, 'noise');
  check('both back on: exactly as authored', same(L(), orig) || same({ ...L(), rack: undefined }, orig), JSON.stringify(L()));
  check('a saved rack carries no source stash once both are on', !('rack' in R.rackToRow(mix).config));

  const solo = R.rackFromRow('sfx', { id: 's', name: 's', config: { waveform: 'sine', freq: 300 } });
  R.rackBypass(solo, 0, 'osc');
  check('the only source off mutes the layer, and the save says so', R.rackToRow(solo).config.mute === true);
  check('a muted layer has no live jacks', R.rackLiveTargets(solo.layers[0]).size === 0);
  R.rackBypass(solo, 0, 'osc');
  check('and on again it plays as before', !('mute' in solo.layers[0]) && !('rack' in R.rackToRow(solo).config));

  const hiss = R.rackFromRow('sfx', { id: 'h', name: 'h', config: { waveform: 'noise' } });
  R.rackAdd(hiss, 0, 'osc');
  check('an oscillator added to pure noise keeps the noise', hiss.layers[0].waveform === 'sawtooth' && hiss.layers[0].noiseMix === 0.5);
}

// ── Patching into nothing is refused, with the reason ───────────────────────
{
  const r = R.rackFromRow('sfx', { id: 'p', name: 'p', config: { waveform: 'sine', freq: 300 } });
  const id = R.rackAdd(r, 0, 'lfo');
  const why = R.rackPatch(r, 0, id, 'filter.cutoff');
  check('a cable into a filter that isn\'t there is refused', typeof why === 'string' && /Filter/.test(why), String(why));
  R.rackAdd(r, 0, 'filter');
  R.rackBypass(r, 0, 'filter');
  check('and into one that\'s switched off', /switched off/.test(String(R.rackPatch(r, 0, id, 'filter.cutoff'))));
  R.rackBypass(r, 0, 'filter');
  check('and goes in once it\'s on', R.rackPatch(r, 0, id, 'filter.cutoff') === true);
  const seq = R.rackAdd(r, 0, 'seq');
  check('a sequencer patches like any mod', R.rackPatch(r, 0, seq, 'pitch', 1200) === true && Array.isArray(r.layers[0].mods.find(m => m.id === seq).steps));
  const short = R.rackFromRow('sfx', { id: 'q', name: 'q', config: { duration: 0.12, waveform: 'sine' } });
  const lfo = short.layers[0].mods?.[0] ?? (R.rackAdd(short, 0, 'lfo'), short.layers[0].mods[0]);
  check('a new LFO on a short hit is fast enough to be heard moving', lfo.rate >= 8, String(lfo.rate));
}

// ── The jacks are the engine's targets ──────────────────────────────────────
{
  const { A } = loadEngine();
  const eng = [...A.MOD_TARGETS].sort().join(','), rack = Object.keys(R.RACK_TARGETS).sort().join(',');
  check('RACK_TARGETS matches AudioEngine.MOD_TARGETS', eng === rack, `engine ${eng}\n      rack   ${rack}`);
}

done();
