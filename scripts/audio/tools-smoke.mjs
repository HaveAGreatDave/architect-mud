// TOOLS SMOKE: the Audio tab's layer editor round-trips a layer, and a Voice Lab voice saves and
// loads back.
//
//   node scripts/audio/tools-smoke.mjs
//
// Step 8 of docs/proposals/siren-fidelity.md. Pure: the dev panel's audio.js and voicelab.js
// run in Node against a stub document. The form HTML they render is parsed for its fields, the
// stub document hands those values back to the readers, and what comes out must be what went in.
//
// WHAT IT GUARDS:
//   • the SFX layer form, the instrument form and the ambient form each give back the layer they
//     were opened with: op2's wave and sweeps, pitchBend, detune, formants, filter gain, noise
//     colour, width and pan all survive, and so do keys the form has no field for
//   • editing a field in the form changes that field and only that field
//   • an op2 authored in Hz (rate/depth) survives a save
//   • previews play on the cue's own bus, and an instrument previews on music
//   • voice presets are kept out of the instrument list
//   • a Voice Lab voice becomes a 'voice' row holding only what differs from its seed, and loads
//     back to the same seed and overrides
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tally, ROOT } from './stub-context.mjs';

const { check, done } = tally('audio:tools');
const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
  return v;
}

// ── A stub document that holds the form fields a panel renders ────────────────
const fields = new Map();
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function parseFields(html) {
  for (const m of html.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const val = /\bvalue="([^"]*)"/.exec(m[0]);
    const checked = /\bchecked\b/.test(m[0]);
    fields.set(m[1], { value: val ? decode(val[1]) : '', checked, style: { display: '' }, addEventListener() {} });
  }
  for (const m of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const opts = [...m[2].matchAll(/<option\b[^>]*value="([^"]*)"([^>]*)>/g)];
    const sel = opts.find(o => /\bselected\b/.test(o[2])) || opts[0];
    fields.set(m[1], { value: sel ? decode(sel[1]) : '', style: { display: '' }, addEventListener() {} });
  }
  for (const m of html.matchAll(/<textarea\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) {
    fields.set(m[1], { value: decode(m[2]), style: { display: '' }, addEventListener() {} });
  }
}
const container = { set innerHTML(h) { parseFields(h); }, get innerHTML() { return ''; } };
globalThis.window = globalThis;
globalThis.document = {
  getElementById(id) {
    if (fields.has(id)) return fields.get(id);
    if (id === 'sfx-layers-container') return container;
    if (/-body$/.test(id)) return { style: { display: '' } };
    return null;
  },
  querySelector: () => null,
  addEventListener() {},
};
const played = [];
globalThis.AudioEngine = {
  init() {},
  playSfx: (def) => played.push({ kind: 'sfx', category: def.category }),
  loopSound: (def) => played.push({ kind: 'loop', category: def.category }),
  stopLoop() {}, stopMusic() {}, stop() {}, playSample() {},
};
globalThis.setTimeout = () => 0;
globalThis.toast = () => {};

const load = (p, names) => new Function(readFileSync(join(ROOT, p), 'utf8') + `\nreturn { ${names.join(', ')} };`)();
const AU = load('client/devpanel/js/panels/audio.js', [
  'instrumentLikeConfigFields', 'readInstrumentLikeConfig', '_sfxInitLayers', '_sfxRenderLayers', '_sfxReadAllLayers',
  '_sfxConfig', '_previewInstrumentForm', '_previewAmbientForm', '_previewSfxForm', '_previewCategory',
]);

// A layer that uses every field the brief named, plus keys no form field covers.
const LAYER = {
  waveform: 'sawtooth', freq: 220, noiseMix: 0.25, gain: 0.8,
  adsr: { a: 0.02, d: 0.1, s: 0.6, r: 0.3 },
  filter: { type: 'peaking', freq: 1800, q: 1.2, gain: 6 },
  vibrato: { rate: 5, depth: 8 }, tremolo: { rate: 0, depth: 0 },
  fm: { ratio: 2, index: 1.5, indexEnd: 0.2, time: 0.3, wave: 'triangle',
    op2: { ratio: 3.5, index: 0.4, indexEnd: 0.1, wave: 'square', ratioTo: 1.75, time: 0.12 } },
  pitchBend: { to: 110, time: 0.4 }, detune: -12,
  formants: [700, 1220, 2600],
  noise: 'pink', width: 0.6, pan: -0.4,
  noiseSeed: 7,           // no field for it: must survive
};

// ── SFX layer form ────────────────────────────────────────────────────────────
fields.clear();
parseFields(`<input id="am-sfx-duration" value="0.8"><select id="am-cat"><option value="tv" selected></option></select><input id="am-send" value="">`);
AU._sfxInitLayers({ layers: [structuredClone(LAYER), { waveform: 'noise', noiseMix: 1, gain: 0.3 }] });
AU._sfxRenderLayers();
{
  const out = AU._sfxReadAllLayers();
  check('sfx form: a layer round-trips exactly', same(stripEmpty(out[0]), stripEmpty(LAYER)),
    `in  ${JSON.stringify(sortKeys(LAYER))}\n      out ${JSON.stringify(sortKeys(out[0]))}`);
  check("sfx form: op2 keeps its wave", out[0].fm?.op2?.wave === 'square');
  check("sfx form: op2 keeps its sweeps", out[0].fm?.op2?.ratioTo === 1.75 && out[0].fm?.op2?.time === 0.12 && out[0].fm?.op2?.indexEnd === 0.1);
  check('sfx form: pitchBend, detune and formants survive', same(out[0].pitchBend, LAYER.pitchBend) && out[0].detune === -12 && same(out[0].formants, LAYER.formants));
  check('sfx form: filter gain, noise colour, width and pan survive',
    out[0].filter.gain === 6 && out[0].noise === 'pink' && out[0].width === 0.6 && out[0].pan === -0.4);
  check('sfx form: a key with no field survives', out[0].noiseSeed === 7);
}
// Editing: change the bend and the op2 wave in the form.
fields.get('sfxl0-bendto').value = '330';
fields.get('sfxl0-op2wave').value = 'sine';
fields.get('sfxl0-formants').value = '[{"freq":500,"q":8,"gain":0.5}, 1500]';
fields.get('sfxl0-pan').value = '0';
{
  const out = AU._sfxReadAllLayers()[0];
  check('editing: the new bend lands', out.pitchBend?.to === 330 && out.pitchBend?.time === 0.4);
  check('editing: op2 back to sine drops the wave key', out.fm?.op2 && !('wave' in out.fm.op2) && out.fm.op2.ratioTo === 1.75);
  check('editing: formants take objects', same(out.formants, [{ freq: 500, q: 8, gain: 0.5 }, 1500]));
  check('editing: pan 0 removes the key', !('pan' in out));
  check('editing: nothing else moved', out.detune === -12 && out.noise === 'pink' && out.filter.gain === 6);
}
// The cue's own bus, and a cue-level send.
played.length = 0;
fields.get('am-send').value = '0.25';
AU._previewSfxForm();
check('sfx preview plays on the cue\'s bus (tv)', played[0]?.category === 'tv', JSON.stringify(played));
{
  const cfg = AU._sfxConfig(AU._sfxReadAllLayers(), 0.8);
  check('sfx form: the cue send is saved', cfg.send === 0.25 && Array.isArray(cfg.layers));
  fields.get('am-send').value = '';
  check('sfx form: a blank send leaves the bus to decide', !('send' in AU._sfxConfig(AU._sfxReadAllLayers(), 0.8)));
}

// An op2 written in Hz.
fields.clear();
parseFields(`<input id="am-sfx-duration" value="0.4"><select id="am-cat"><option value="combat" selected></option></select>`);
const HZ = { waveform: 'sine', freq: 180, gain: 1, adsr: { a: 0.01, d: 0.05, s: 0.7, r: 0.15 }, filter: { type: 'lowpass', freq: 4000, q: 1 },
  fm: { rate: 90, depth: 200, op2: { rate: 45, depth: 60, rateTo: 20, depthTo: 5 } } };
AU._sfxInitLayers(structuredClone(HZ));
AU._sfxRenderLayers();
{
  const out = AU._sfxReadAllLayers()[0];
  check('an op2 authored in Hz survives a save', same(out.fm?.op2, HZ.fm.op2), JSON.stringify(out.fm?.op2));
}

// ── Instrument and ambient forms ──────────────────────────────────────────────
for (const [tab, prefix] of [['instrument', 'am'], ['ambient', 'am']]) {
  fields.clear();
  const cfg = { ...structuredClone(LAYER), sparkle: [{ everyMin: 3, layers: [{ waveform: 'sine', freq: 2000 }] }] };
  parseFields(AU.instrumentLikeConfigFields(cfg, prefix));
  parseFields(`<select id="am-cat"><option value="environment" selected></option></select><input id="am-wave" value="sawtooth"><input id="am-freq" value="220"><input id="am-sample" value="">`);
  const out = AU.readInstrumentLikeConfig(prefix, tab === 'ambient' ? { waveform: 'sawtooth', freq: 220 } : undefined);
  const want = tab === 'ambient' ? { ...cfg, waveform: 'sawtooth', freq: 220 } : cfg;
  check(`${tab} form: round-trips exactly, sparkles included`, same(stripEmpty(out), stripEmpty(want)),
    `in  ${JSON.stringify(sortKeys(want))}\n      out ${JSON.stringify(sortKeys(out))}`);
}
played.length = 0;
AU._previewInstrumentForm();
check('an instrument previews on the music bus', played[0]?.category === 'music', JSON.stringify(played));
played.length = 0;
AU._previewAmbientForm();
check('an ambient bed previews on its own category', played[0]?.kind === 'loop' && played[0]?.category === 'environment', JSON.stringify(played));

// ── Voice presets stay out of the instrument list ─────────────────────────────
{
  const src = readFileSync(join(ROOT, 'client/devpanel/js/panels/audio.js'), 'utf8');
  check('the Audio tab filters voice presets out of instruments', /instruments: Array\.isArray\(data\?\.instruments\) \? data\.instruments\.filter\(r => !_isVoicePreset\(r\)\)/.test(src));
  check('Verify filters them the same way', /instruments\.filter\(r => !_isVoicePreset\(r\)\)/.test(src.slice(src.indexOf('async function verifyAllAudio'))));
}

// ── Voice Lab ─────────────────────────────────────────────────────────────────
const VL = load('client/devpanel/js/panels/voicelab.js', ['vlPresetRow', 'vlPresetFromRow', 'vlPresetsFrom', 'vlPresetId']);
{
  const base = { f0: 120, fshift: 1.0, oq: 0.58, drive: 0, growlWave: 'sine' };
  const override = { f0: 150, fshift: 1.0, drive: 0.3, growlWave: 'square' };
  const row = VL.vlPresetRow('  Rink Announcer ', 'Deadball PA', override, base);
  check('a saved voice gets a voice_ id from its name', row?.id === 'voice_rink_announcer', row?.id);
  check('it is a voice row', row?.category === 'voice' && row?.name === 'Rink Announcer');
  check('it keeps only what differs from the seed', same(row?.config?.voice, { f0: 150, drive: 0.3, growlWave: 'square' }), JSON.stringify(row?.config));
  check('it keeps the seed', row?.config?.seed === 'Deadball PA');
  // Through JSON, as the content file and the API carry it.
  const back = VL.vlPresetFromRow(JSON.parse(JSON.stringify(row)));
  check('it loads back to the same seed', back.seed === 'Deadball PA');
  check('and the same overrides', same(back.voice, { f0: 150, drive: 0.3, growlWave: 'square' }));
  check('an empty name saves nothing', VL.vlPresetRow('  ', 'x', {}, {}) === null);
  const list = VL.vlPresetsFrom([{ id: 'a', name: 'B', category: 'voice' }, { id: 'i', name: 'piano', category: 'misc' }, { id: 'c', name: 'A', category: 'voice' }]);
  check('the Voice Lab lists only voice rows, by name', list.map(r => r.id).join(',') === 'c,a');
}
{
  const src = readFileSync(join(ROOT, 'client/devpanel/js/core/panels.js'), 'utf8');
  check('the Voice Lab fetches its saved voices', /voicelab:[\s\S]*?API\('\/audio\/instruments'\)[\s\S]*?vlPresetsFrom/.test(src));
}

// Empty sweeps the form shows as zero or blank aren't keys the engine reads, so a round trip
// may drop them. Everything else must match.
function stripEmpty(c) {
  const o = structuredClone(c);
  const walk = (x) => {
    if (!x || typeof x !== 'object') return;
    for (const k of Object.keys(x)) {
      if (x[k] === undefined) delete x[k];
      else if ((k === 'vibrato' || k === 'tremolo') && !x[k].rate) delete x[k];
      else walk(x[k]);
    }
  };
  walk(o);
  return o;
}

done();
