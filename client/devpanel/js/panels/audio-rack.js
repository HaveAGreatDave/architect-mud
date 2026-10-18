// ── Rack: the Audio tab's patch editor for SIREN ─────────────────────────────
//
// A cue shown as a rack of units in SIREN's signal order, with a component
// browser to add and remove them and patch cables for modulation. The rack is a
// view of the row's own config: there is no patch format of its own, and saving
// writes the same row the forms write. docs/amp-format.md has the keys.
//
// Two halves. The MODEL (rackFromRow .. rackToRow) is pure: no DOM, no engine,
// so scripts/audio/rack-smoke.mjs runs it in Node. The VIEW (renderRack and
// below) draws it and plays it.
//
// What it can't do, because SIREN can't: reorder the chain. Osc -> FM -> amp ->
// drive -> filter -> tremolo -> echo -> pan is fixed in buildLayer, so chain
// units keep their place and only the motion units below it reorder.

// ── Model ────────────────────────────────────────────────────────────────────

// Keys that belong to the cue, not a layer. In a one-layer cue they sit flat
// beside the layer's own keys.
const RACK_CUE_KEYS = ['duration', 'send', 'retro', 'duck', 'sparkle', 'layers'];

// What a cable can be patched into: the label on the jack, the unit of `amount`,
// a sensible first amount and the knob's reach. The names are the engine's
// (AudioEngine.MOD_TARGETS); mod.<id>.rate and mod.<id>.amount are added per mod.
const RACK_TARGETS = {
  'pitch':         { label: 'Pitch',    unit: 'ct', amt: 50,   max: 2400 },
  'fm.index':      { label: 'FM Index', unit: '',   amt: 2,    max: 20 },
  'fm.ratio':      { label: 'FM Ratio', unit: 'ct', amt: 100,  max: 2400 },
  'op2.index':     { label: 'Op2 Index', unit: '',  amt: 1,    max: 20 },
  'op2.ratio':     { label: 'Op2 Ratio', unit: 'ct', amt: 100, max: 2400 },
  'filter.cutoff': { label: 'Cutoff',   unit: 'ct', amt: 1200, max: 4800 },
  'filter.q':      { label: 'Reso',     unit: '',   amt: 4,    max: 20 },
  'amp':           { label: 'Amp',      unit: '',   amt: 0.5,  max: 1 },
  'pan':           { label: 'Pan',      unit: '',   amt: 0.8,  max: 1 },
  'echo.time':     { label: 'Echo Time', unit: 's', amt: 0.02, max: 0.5 },
  'echo.feedback': { label: 'Echo Fdbk', unit: '',  amt: 0.5,  max: 1 },
  'noise.rate':    { label: 'Noise Rate', unit: '', amt: 0.3,  max: 2 },
};
function rackTargetInfo(param) {
  const m = /^mod\.(.+)\.(rate|amount)$/.exec(param);
  if (m) return m[2] === 'rate'
    ? { label: m[1] + ' Rate', unit: 'Hz', amt: 2, max: 40 }
    : { label: m[1] + ' Depth', unit: '', amt: 0.5, max: 1 };
  return RACK_TARGETS[param] || { label: param, unit: '', amt: 1, max: 10 };
}

const RACK_WAVES = ['sine', 'triangle', 'square', 'sawtooth'];
const RACK_FILTERS = ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking', 'lowshelf', 'highshelf'];

// A knob: p is the path inside its scope, jack the mod target it takes a cable on.
const K = (p, label, min, max, def, o = {}) => ({ p, label, min, max, def, ...o });

// The catalogue, in signal order. `owns` is what the unit adds, removes and
// stashes on bypass; `make` is what a fresh one starts as.
const RACK_UNITS = [
  { key: 'osc', label: 'Oscillator', fam: 'source', group: 'Sources',
    has: (l) => l.waveform !== 'noise' && !((l.noiseMix ?? 0) >= 1),
    knobs: [K('freq', 'Freq', 20, 8000, 440, { curve: 'log', unit: 'Hz' }), K('detune', 'Detune', -1200, 1200, 0, { unit: 'ct', jack: 'pitch' })],
    switches: [{ p: 'waveform', opts: RACK_WAVES }] },
  { key: 'noise', label: 'Noise', fam: 'source', group: 'Sources', owns: ['noiseMix', 'noise', 'noiseRate', 'width'],
    has: (l) => (l.noiseMix ?? 0) > 0 || l.waveform === 'noise',
    knobs: [K('noiseMix', 'Mix', 0, 1, 0.5), K('noiseRate', 'Rate', 0.1, 2, 1, { jack: 'noise.rate' }), K('width', 'Width', 0, 1, 0)],
    switches: [{ p: 'noise', opts: ['white', 'pink', 'brown'] }] },
  { key: 'fm', label: 'FM Operator 1', fam: 'fm', group: 'FM', owns: ['fm'], make: () => ({ fm: { ratio: 2, index: 1, wave: 'sine' } }),
    knobs: [K('fm.ratio', 'Ratio', 0.25, 16, 2, { curve: 'log', jack: 'fm.ratio' }), K('fm.index', 'Index', 0, 20, 1, { jack: 'fm.index' }),
      K('fm.indexEnd', 'Index End', 0, 20, 1), K('fm.time', 'Sweep', 0.01, 4, 0.2, { curve: 'log', unit: 's' }), K('fm.bright', 'Bright', 0, 4, 0)],
    switches: [{ p: 'fm.wave', opts: RACK_WAVES }] },
  { key: 'op2', label: 'FM Operator 2', fam: 'fm', group: 'FM', owns: ['fm.op2'], needs: 'fm', make: () => ({ 'fm.op2': { ratio: 3, index: 0.5, wave: 'sine' } }),
    knobs: [K('fm.op2.ratio', 'Ratio', 0.25, 16, 3, { curve: 'log', jack: 'op2.ratio' }), K('fm.op2.index', 'Index', 0, 20, 0.5, { jack: 'op2.index' }),
      K('fm.op2.indexEnd', 'Index End', 0, 20, 0.5)],
    switches: [{ p: 'fm.op2.wave', opts: RACK_WAVES }] },
  { key: 'bend', label: 'Pitch Bend', fam: 'shape', group: 'Shape', owns: ['pitchBend'], make: (l) => ({ pitchBend: { to: (l.freq || 440) * 2, time: 0.3 } }),
    knobs: [K('pitchBend.to', 'To', 20, 8000, 880, { curve: 'log', unit: 'Hz' }), K('pitchBend.time', 'Time', 0.01, 4, 0.3, { curve: 'log', unit: 's' })] },
  // the forms write a zero-rate vibrato and tremolo onto everything; SIREN skips those, and so does the rack
  { key: 'vibrato', label: 'Vibrato', fam: 'motion', group: 'Motion', owns: ['vibrato'], has: (l) => l.vibrato?.rate > 0, make: () => ({ vibrato: { rate: 5, depth: 10 } }),
    knobs: [K('vibrato.rate', 'Rate', 0.05, 40, 5, { curve: 'log', unit: 'Hz' }), K('vibrato.depth', 'Depth', 0, 200, 10, { unit: 'ct' })] },
  { key: 'amp', label: 'Amp Envelope', fam: 'amp', group: null, fixed: true, has: () => true,
    knobs: [K('adsr.a', 'Attack', 0.001, 4, 0.01, { curve: 'log', unit: 's' }), K('adsr.d', 'Decay', 0.001, 4, 0.05, { curve: 'log', unit: 's' }),
      K('adsr.s', 'Sustain', 0, 1, 0.7), K('adsr.r', 'Release', 0.005, 6, 0.15, { curve: 'log', unit: 's' }), K('gain', 'Level', 0, 1.5, 1, { jack: 'amp' })],
    switches: [{ p: 'adsr.curve', opts: ['lin', 'exp'] }] },
  { key: 'drive', label: 'Drive', fam: 'shape', group: 'Shape', owns: ['drive'], make: () => ({ drive: 0.3 }),
    knobs: [K('drive', 'Drive', 0, 1, 0.3)] },
  { key: 'filter', label: 'Filter', fam: 'shape', group: 'Shape', owns: ['filter'], clash: 'formants', make: () => ({ filter: { type: 'lowpass', freq: 2000, q: 1 } }),
    knobs: [K('filter.freq', 'Cutoff', 20, 18000, 2000, { curve: 'log', unit: 'Hz', jack: 'filter.cutoff' }), K('filter.q', 'Reso', 0.1, 30, 1, { curve: 'log', jack: 'filter.q' }),
      K('filter.to', 'Sweep To', 20, 18000, 2000, { curve: 'log', unit: 'Hz' }), K('filter.time', 'Sweep', 0.01, 4, 0.2, { curve: 'log', unit: 's' }), K('filter.gain', 'Gain', -24, 24, 0, { unit: 'dB' })],
    switches: [{ p: 'filter.type', opts: RACK_FILTERS }] },
  { key: 'formants', label: 'Formant Bank', fam: 'shape', group: 'Shape', owns: ['formants'], clash: 'filter', make: () => ({ formants: [700, 1220, 2600] }),
    knobs: (l) => (Array.isArray(l.formants) ? l.formants : []).slice(0, 5).map((f, i) =>
      K(typeof f === 'object' ? `formants.${i}.freq` : `formants.${i}`, `F${i + 1}`, 80, 6000, 1000, { curve: 'log', unit: 'Hz' })) },
  { key: 'tremolo', label: 'Tremolo', fam: 'motion', group: 'Motion', owns: ['tremolo'], has: (l) => l.tremolo?.rate > 0, make: () => ({ tremolo: { rate: 6, depth: 0.3 } }),
    knobs: [K('tremolo.rate', 'Rate', 0.05, 40, 6, { curve: 'log', unit: 'Hz' }), K('tremolo.depth', 'Depth', 0, 1, 0.3)] },
  { key: 'echo', label: 'Echo', fam: 'space', group: 'Space', owns: ['echo'], make: () => ({ echo: { mix: 0.3, delay: 0.18, feedback: 0.35 } }),
    knobs: [K('echo.mix', 'Mix', 0, 1, 0.3), K('echo.delay', 'Time', 0.01, 2, 0.18, { curve: 'log', unit: 's', jack: 'echo.time' }), K('echo.feedback', 'Feedback', 0, 0.95, 0.35, { jack: 'echo.feedback' })] },
  { key: 'pan', label: 'Pan', fam: 'space', group: 'Space', owns: ['pan'], make: () => ({ pan: 0 }),
    knobs: [K('pan', 'Pan', -1, 1, 0, { jack: 'pan' })] },
];
// Modulators: any number per layer, each an entry in layer.mods.
const RACK_MODS = {
  lfo:  { label: 'LFO', make: () => ({ wave: 'sine', rate: 2 }),
    knobs: [K('rate', 'Rate', 0.05, 40, 2, { curve: 'log', unit: 'Hz', jack: 'rate' }), K('fade', 'Fade In', 0, 4, 0, { unit: 's' })],
    switches: [{ p: 'wave', opts: RACK_WAVES }] },
  env:  { label: 'Envelope', make: () => ({ a: 0.005, d: 0.3, s: 0, r: 0.2 }),
    knobs: [K('a', 'Attack', 0.001, 4, 0.005, { curve: 'log', unit: 's' }), K('d', 'Decay', 0.001, 4, 0.3, { curve: 'log', unit: 's' }),
      K('s', 'Sustain', 0, 1, 0), K('r', 'Release', 0.005, 6, 0.2, { curve: 'log', unit: 's' })],
    switches: [{ p: 'curve', opts: ['lin', 'exp'] }] },
  rand: { label: 'Random', make: () => ({ rate: 6, seed: 1 }),
    knobs: [K('rate', 'Rate', 0.05, 60, 6, { curve: 'log', unit: 'Hz' }), K('seed', 'Seed', 1, 99, 1, { step: 1 })],
    switches: [{ p: 'smooth', opts: ['step', 'glide'], bool: true }] },
};
// Cue units: one each, on the cue rather than a layer.
const RACK_CUE_UNITS = [
  { key: 'master', label: 'Master', fixed: true, has: () => true,
    knobs: [K('duration', 'Length', 0.05, 20, 0.4, { curve: 'log', unit: 's' }), K('send', 'Reverb', 0, 1, 1)] },
  { key: 'retro', label: 'Retro Crusher', owns: ['retro'], make: () => ({ retro: { rate: 11025, bits: 8 } }),
    knobs: [K('retro.rate', 'Rate', 1000, 48000, 11025, { curve: 'log', unit: 'Hz', step: 1 }), K('retro.bits', 'Bits', 1, 16, 8, { step: 1 })] },
  { key: 'duck', label: 'Ducker', owns: ['duck'], make: () => ({ duck: { buses: ['ambient'], dB: -9, attack: 0.03, release: 0.5 } }),
    knobs: [K('duck.dB', 'Depth', -40, 0, -9, { unit: 'dB' }), K('duck.attack', 'Attack', 0.005, 2, 0.03, { curve: 'log', unit: 's' }), K('duck.release', 'Release', 0.01, 4, 0.5, { curve: 'log', unit: 's' })] },
];
const rackUnit = (key) => RACK_UNITS.find(u => u.key === key) || RACK_CUE_UNITS.find(u => u.key === key);
const rackKnobsOf = (u, obj) => (typeof u.knobs === 'function' ? u.knobs(obj) : u.knobs) || [];

const rackClone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function rackGet(obj, path) {
  let o = obj;
  for (const k of String(path).split('.')) { if (o == null) return undefined; o = o[k]; }
  return o;
}
function rackSet(obj, path, v) {
  const ks = String(path).split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    o = o[ks[i]];
  }
  if (v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = v;
}

// A unit's presence on a layer (or the cue): its own test, or its first owned key.
function rackHas(obj, u) {
  if (u.has) return u.has(obj);
  return rackGet(obj, u.owns[0]) !== undefined;
}

// The rack: the row's other fields, the cue keys, and the layers.
function rackFromRow(tab, row) {
  const cfg = rackClone(row?.config) || {};
  const meta = {};
  for (const k of Object.keys(row || {})) if (k !== 'config') meta[k] = rackClone(row[k]);
  const r = { tab, id: row?.id || null, meta, cue: {}, layers: [], flat: true, cfgWave: 'waveform' in cfg, cueBypass: {} };
  if (Array.isArray(cfg.layers) && cfg.layers.length) {
    r.flat = false;
    r.layers = cfg.layers;
    for (const k of Object.keys(cfg)) if (k !== 'layers') r.cue[k] = cfg[k];
  } else {
    const layer = {};
    for (const k of Object.keys(cfg)) (RACK_CUE_KEYS.includes(k) ? r.cue : layer)[k] = cfg[k];
    r.layers = [layer];
  }
  // An instrument keeps its waveform on the row; the rack shows it on the layer.
  if (tab === 'instruments' && r.layers[0].waveform === undefined) r.layers[0].waveform = row?.waveform || 'square';
  return r;
}

// What the save sends: the row's own fields with the config rebuilt.
function rackToRow(r) {
  const layers = r.layers.map((l) => {
    const c = rackClone(l);
    // an editor key with nothing in it isn't worth shipping
    if (c.rack) {
      if (c.rack.bypass && !Object.keys(c.rack.bypass).length) delete c.rack.bypass;
      if (c.rack.colors && !Object.keys(c.rack.colors).length) delete c.rack.colors;
      if (!Object.keys(c.rack).length) delete c.rack;
    }
    if (Array.isArray(c.mods) && !c.mods.length) delete c.mods;
    return c;
  });
  let config;
  if (layers.length === 1 && (r.flat || r.tab !== 'sfx')) config = { ...layers[0], ...rackClone(r.cue) };
  else config = { ...rackClone(r.cue), layers };
  const out = { ...rackClone(r.meta), config };
  delete out.id;
  if (r.tab === 'instruments') {
    out.waveform = config.waveform || out.waveform || 'square';
    if (!r.cfgWave) delete config.waveform;
  }
  return out;
}

// The units a layer shows, in signal order, each marked on or bypassed.
function rackUnitsOf(layer) {
  const by = layer.rack?.bypass || {};
  return RACK_UNITS.filter(u => rackHas(layer, u) || by[u.key]).map(u => ({ key: u.key, on: rackHas(layer, u) }));
}
function rackCueUnitsOf(r) {
  return RACK_CUE_UNITS.filter(u => rackHas(r.cue, u) || r.cueBypass[u.key]).map(u => ({ key: u.key, on: rackHas(r.cue, u) }));
}

// Why a unit can't go in right now, or null when it can.
function rackCanAdd(r, li, key) {
  const layer = r.layers[li];
  if (RACK_MODS[key]) return null;
  const cu = RACK_CUE_UNITS.find(u => u.key === key);
  if (cu) return rackHas(r.cue, cu) || r.cueBypass[key] ? 'already in the rack' : null;
  const u = rackUnit(key);
  if (!u || u.key === 'amp') return 'always in the rack';
  if (rackHas(layer, u) || layer.rack?.bypass?.[key]) return 'one per layer';
  if (u.needs && !rackHas(layer, rackUnit(u.needs))) return `needs ${rackUnit(u.needs).label} first`;
  if (u.clash && rackHas(layer, rackUnit(u.clash))) return `shares a slot with ${rackUnit(u.clash).label}`;
  return null;
}

function rackNewModId(layer, type) {
  const used = new Set((layer.mods || []).map(m => m.id));
  for (const k of Object.keys(layer.rack?.bypass || {})) if (k.startsWith('mod:')) used.add(k.slice(4));
  let n = 1;
  while (used.has(type + n)) n++;
  return type + n;
}

// Add a unit. Returns the mod id for a modulator, true for anything else, or a
// reason string when it can't.
function rackAdd(r, li, key) {
  const why = rackCanAdd(r, li, key);
  if (why) return why;
  const layer = r.layers[li];
  if (RACK_MODS[key]) {
    const id = rackNewModId(layer, key);
    (layer.mods ||= []).push({ id, type: key, ...RACK_MODS[key].make(), to: [] });
    return id;
  }
  const cu = RACK_CUE_UNITS.find(u => u.key === key);
  if (cu) { for (const [p, v] of Object.entries(cu.make())) rackSet(r.cue, p, v); return true; }
  if (key === 'osc') {
    if (layer.waveform === 'noise') layer.waveform = 'sawtooth';
    if ((layer.noiseMix ?? 0) >= 1) layer.noiseMix = 0.5;
    return true;
  }
  if (key === 'noise') { layer.noiseMix = 0.5; return true; }
  for (const [p, v] of Object.entries(rackUnit(key).make(layer))) rackSet(layer, p, v);
  return true;
}

// Take a unit out. `stash` keeps it in layer.rack.bypass so the power LED can
// put it back as it was; without it the unit is gone.
function rackPull(r, li, key, stash) {
  const layer = r.layers[li];
  if (key.startsWith('mod:')) {
    const id = key.slice(4);
    const i = (layer.mods || []).findIndex(m => m.id === id);
    if (i < 0) return false;
    const [m] = layer.mods.splice(i, 1);
    if (stash) rackSet(layer, `rack.bypass.${key}`, m);
    if (!stash) {
      // nothing may keep a cable into a mod that no longer exists
      for (const o of layer.mods) o.to = (o.to || []).filter(c => !c.param.startsWith(`mod.${id}.`));
      if (layer.rack?.colors) delete layer.rack.colors[id];
    }
    return true;
  }
  const cu = RACK_CUE_UNITS.find(u => u.key === key);
  if (cu) {
    if (cu.fixed) return false;
    const saved = {};
    for (const p of cu.owns) { saved[p] = rackGet(r.cue, p); rackSet(r.cue, p, undefined); }
    if (stash) r.cueBypass[key] = saved;
    return true;
  }
  const u = rackUnit(key);
  if (!u || u.key === 'amp') return false;
  const saved = {};
  if (key === 'osc') {
    if (!rackHas(layer, rackUnit('noise'))) return false;   // a layer needs a source
    saved.noiseMix = layer.noiseMix;
    layer.noiseMix = 1;
  } else {
    if (key === 'noise' && !rackHas(layer, rackUnit('osc')) && layer.waveform !== 'noise') return false;
    if (key === 'noise' && layer.waveform === 'noise') { saved.waveform = 'noise'; layer.waveform = 'sawtooth'; }
    for (const p of u.owns) { saved[p] = rackClone(rackGet(layer, p)); rackSet(layer, p, undefined); }
  }
  if (stash) rackSet(layer, `rack.bypass.${key}`, saved);
  return true;
}
const rackRemove = (r, li, key) => {
  const layer = r.layers[li];
  if (layer.rack?.bypass?.[key]) { delete layer.rack.bypass[key]; return true; }
  if (r.cueBypass[key]) { delete r.cueBypass[key]; return true; }
  return rackPull(r, li, key, false);
};

// The power LED: bypass a unit, or bring it back.
function rackBypass(r, li, key) {
  const layer = r.layers[li];
  const held = layer.rack?.bypass?.[key];
  if (held) {
    delete layer.rack.bypass[key];
    if (key.startsWith('mod:')) (layer.mods ||= []).push(held);
    else for (const [p, v] of Object.entries(held)) rackSet(layer, p, v);
    return true;
  }
  if (r.cueBypass[key]) {
    for (const [p, v] of Object.entries(r.cueBypass[key])) rackSet(r.cue, p, v);
    delete r.cueBypass[key];
    return true;
  }
  return rackPull(r, li, key, true);
}

function rackMod(layer, id) { return (layer.mods || []).find(m => m.id === id); }

// A cable from mod `id` into `param`. One cable per pair: patching again sets its amount.
function rackPatch(r, li, id, param, amount) {
  const layer = r.layers[li];
  const m = rackMod(layer, id);
  if (!m) return 'no such mod';
  const mm = /^mod\.(.+)\.(rate|amount)$/.exec(param);
  if (mm) {
    if (mm[1] === id) return 'a mod can\'t patch itself';
    if (!rackMod(layer, mm[1])) return 'no such mod';
    if (mm[2] === 'rate' && rackMod(layer, mm[1]).type !== 'lfo') return 'only an LFO has a rate jack';
    // the engine drops a loop; the rack refuses it, so what you see is what plays
    const reaches = (from, to, seen = new Set()) => {
      if (from === to) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      return (rackMod(layer, from)?.to || []).some(c => { const x = /^mod\.(.+)\.(rate|amount)$/.exec(c.param); return x && reaches(x[1], to, seen); });
    };
    if (reaches(mm[1], id)) return 'that would close a loop';
  } else if (!RACK_TARGETS[param]) return 'no such jack';
  m.to ||= [];
  const c = m.to.find(x => x.param === param);
  const amt = Number.isFinite(amount) ? amount : rackTargetInfo(param).amt;
  if (c) c.amount = amt; else m.to.push({ param, amount: amt });
  return true;
}
function rackUnpatch(r, li, id, param) {
  const m = rackMod(r.layers[li], id);
  if (!m?.to) return false;
  const n = m.to.length;
  m.to = m.to.filter(c => c.param !== param);
  return m.to.length !== n;
}

// Which jacks in a layer are live: its stages decide what a cable can reach.
function rackLiveTargets(layer) {
  const live = new Set();
  const osc = rackHas(layer, rackUnit('osc'));
  if (osc) live.add('pitch');
  if (osc && layer.fm && (layer.fm.ratio || layer.fm.rate)) { live.add('fm.index'); live.add('fm.ratio'); }
  if (osc && layer.fm?.op2 && (layer.fm.op2.ratio || layer.fm.op2.rate)) { live.add('op2.index'); live.add('op2.ratio'); }
  if (layer.filter && !(Array.isArray(layer.formants) && layer.formants.length)) { live.add('filter.cutoff'); live.add('filter.q'); }
  if (layer.echo?.mix > 0) { live.add('echo.time'); live.add('echo.feedback'); }
  if (rackHas(layer, rackUnit('noise'))) live.add('noise.rate');
  live.add('amp'); live.add('pan');
  for (const m of layer.mods || []) { live.add(`mod.${m.id}.amount`); if (m.type === 'lfo') live.add(`mod.${m.id}.rate`); }
  return live;
}

function rackAddLayer(r, from) {
  const l = from != null ? rackClone(r.layers[from]) : { waveform: 'sawtooth', freq: 220, adsr: { a: 0.01, d: 0.2, s: 0.6, r: 0.3 }, gain: 0.5 };
  r.layers.splice(from != null ? from + 1 : r.layers.length, 0, l);
  return from != null ? from + 1 : r.layers.length - 1;
}
function rackDeleteLayer(r, li) {
  if (r.layers.length <= 1) return false;
  r.layers.splice(li, 1);
  return true;
}
// Instruments are one layer: the tracker plays a single config at every pitch.
const rackLayersAllowed = (r) => r.tab !== 'instruments';

// ── View ─────────────────────────────────────────────────────────────────────

const _rk = {
  rack: null, li: 0, view: 'front', cables: true, loop: false, auto: true,
  mute: new Set(), solo: null, undo: [], redo: [], dirty: false, loopT: null, held: null, keys: new Map(),
  meter: null, raf: 0, sway: null,
};
const RACK_FAM_COLOR = { source: 'var(--cyan)', fm: 'var(--purple)', amp: 'var(--text-bright)', shape: 'var(--orange)', motion: 'var(--green)', space: 'var(--yellow)', cue: 'var(--accent)' };
const RACK_CABLE_COLORS = ['#ff3b5c', '#ffb020', '#3ddc84', '#29b6f6', '#c86bff', '#ff7ad9', '#f4f4f4', '#9be15d'];
const _rkEsc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function rackLayer() { return _rk.rack?.layers[_rk.li]; }
function rackCableColor(layer, id) {
  const set = layer.rack?.colors?.[id];
  if (set) return set;
  const i = Math.max(0, (layer.mods || []).findIndex(m => m.id === id));
  return RACK_CABLE_COLORS[i % RACK_CABLE_COLORS.length];
}

// Open a saved row in the rack. Called by the 🎛 buttons in the Audio tab.
function openInRack(tab, id) {
  const row = typeof findAudioAsset === 'function' ? findAudioAsset(tab, id) : null;
  if (!row) { toast?.('Row not found', true); return; }
  if (typeof closeModal === 'function' && document.getElementById('generic-modal')?.style.display !== 'none') closeModal();
  rackLoad(tab, row);
  if (typeof setAudioTab === 'function') setAudioTab('rack');
}
function rackLoad(tab, row) {
  _rk.rack = rackFromRow(tab, row);
  _rk.li = 0; _rk.undo = []; _rk.redo = []; _rk.dirty = false; _rk.mute = new Set(); _rk.solo = null;
}
function rackNewPatch(tab) {
  const base = tab === 'instruments'
    ? { name: 'new_instrument', category: 'misc', waveform: 'sawtooth', enabled: 1, config: { adsr: { a: 0.01, d: 0.3, s: 0.5, r: 0.4 }, gain: 0.5, fm: { ratio: 2, index: 1.5, indexEnd: 0.3, time: 0.4 } } }
    : tab === 'ambient'
      ? { name: 'new_ambient', category: 'ambient', priority: 1, loop: 1, enabled: 1, config: { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 800, q: 0.7 }, adsr: { a: 2, d: 0, s: 1, r: 2 }, gain: 0.4 } }
      : { name: 'new_sfx', category: 'sfx', priority: 5, enabled: 1, config: { duration: 0.6, waveform: 'sawtooth', freq: 220, fm: { ratio: 1.41, index: 4, indexEnd: 0.2, time: 0.3 }, filter: { type: 'lowpass', freq: 3000, q: 2 }, adsr: { a: 0.002, d: 0.3, s: 0.2, r: 0.3 }, gain: 0.6 } };
  rackLoad(tab, base);
  _rk.dirty = true;
  renderAudioTabBody();
}

// Every change goes through here: snapshot for undo, then re-render.
function rackEdit(fn, { render = true } = {}) {
  const before = JSON.stringify({ cue: _rk.rack.cue, layers: _rk.rack.layers, cb: _rk.rack.cueBypass });
  const res = fn();
  const after = JSON.stringify({ cue: _rk.rack.cue, layers: _rk.rack.layers, cb: _rk.rack.cueBypass });
  if (before !== after) {
    _rk.undo.push(before); if (_rk.undo.length > 200) _rk.undo.shift();
    _rk.redo = [];
    _rk.dirty = true;
  }
  if (render) rackRender();
  if (before !== after && _rk.auto) rackAudition();
  return res;
}
function rackRestore(snap) {
  const s = JSON.parse(snap);
  _rk.rack.cue = s.cue; _rk.rack.layers = s.layers; _rk.rack.cueBypass = s.cb || {};
  _rk.li = Math.min(_rk.li, _rk.rack.layers.length - 1);
  _rk.dirty = true;
  rackRender();
}
function rackUndo() { if (!_rk.undo.length) return; _rk.redo.push(JSON.stringify({ cue: _rk.rack.cue, layers: _rk.rack.layers, cb: _rk.rack.cueBypass })); rackRestore(_rk.undo.pop()); }
function rackRedo() { if (!_rk.redo.length) return; _rk.undo.push(JSON.stringify({ cue: _rk.rack.cue, layers: _rk.rack.layers, cb: _rk.rack.cueBypass })); rackRestore(_rk.redo.pop()); }

// ── Rendering ────────────────────────────────────────────────────────────────

function renderRack(body) {
  body.innerHTML = '<div id="rk-root" class="rk-root" tabindex="0"></div>';
  rackRender();
}

function rackRender() {
  const root = document.getElementById('rk-root');
  if (!root) return;
  if (!_rk.rack) { root.innerHTML = rackPickerHtml(); return; }
  const r = _rk.rack, layer = rackLayer();
  // a redraw keeps the rack scrolled where it was
  const keepTop = document.getElementById('rk-stack')?.scrollTop || 0;
  const keepBrowser = root.querySelector('.rk-browser')?.scrollTop || 0;
  root.innerHTML = RACK_KNOB_DEFS + `
    <aside class="rk-browser">${rackBrowserHtml()}</aside>
    <section class="rk-main">
      ${rackHeadHtml()}
      ${rackSplitHtml()}
      <div class="rk-stack rk-view-${_rk.view}${_rk.cables ? '' : ' rk-nocables'}${_rk.flipIn ? ' rk-flipin' : ''}" id="rk-stack">
        <div class="rk-rail-note">signal flows down &middot; SIREN fixes the chain order</div>
        ${rackUnitsOf(layer).map(u => rackUnitHtml(rackUnit(u.key), layer, u.on, 'layer')).join('')}
        <div class="rk-divider"><span>Modulation</span></div>
        ${(layer.mods || []).map(m => rackModHtml(layer, m, true)).join('')}
        ${Object.entries(layer.rack?.bypass || {}).filter(([k]) => k.startsWith('mod:')).map(([, m]) => rackModHtml(layer, m, false)).join('')}
        ${(layer.mods || []).length ? '' : '<div class="rk-empty">Drag an LFO, Envelope or Random in from the left, then patch its OUT jack into any knob with a jack.</div>'}
        <div class="rk-divider"><span>Cue</span></div>
        ${rackCueUnitsOf(r).map(u => rackUnitHtml(rackUnit(u.key), r.cue, u.on, 'cue')).join('')}
        <svg class="rk-cables" id="rk-cables"></svg>
      </div>
      ${rackTransportHtml()}
    </section>`;
  _rk.flipIn = false;
  const st = document.getElementById('rk-stack');
  if (st) st.scrollTop = keepTop;
  const br = root.querySelector('.rk-browser');
  if (br) br.scrollTop = keepBrowser;
  rackWire(root);
  requestAnimationFrame(() => { rackDrawCables(); rackDrawDisplays(); });
  rackStartMeter();
}

function rackPickerHtml() {
  const list = (tab, label) => {
    const rows = (typeof _audioData !== 'undefined' && _audioData[tab]) || [];
    return `<div class="rk-pick-col"><h4>${label}</h4>
      <button class="action-btn" onclick="rackNewPatch('${tab}')">+ New ${label.replace(/s$/, '')}</button>
      <div class="rk-pick-list">${rows.map(r => `<button class="rk-pick" onclick="openInRack('${tab}','${_rkEsc(r.id)}')">${_rkEsc(r.name)}</button>`).join('') || '<span class="rk-dim">none</span>'}</div></div>`;
  };
  return `<div class="rk-picker">
    <div class="rk-pick-head"><b>RACK</b> <span class="rk-dim">Open a sound to patch it, or start a new one. The 🎛 button on any row opens it here too.</span></div>
    <div class="rk-pick-cols">${list('sfx', 'Sound Effects')}${list('instruments', 'Instruments')}${list('ambient', 'Ambient')}</div>
  </div>`;
}

function rackBrowserHtml() {
  const r = _rk.rack;
  const groups = {};
  for (const u of RACK_UNITS) if (u.group) (groups[u.group] ||= []).push({ key: u.key, label: u.label, fam: u.fam });
  groups.Motion.push(...Object.entries(RACK_MODS).map(([k, m]) => ({ key: k, label: m.label, fam: 'motion', multi: true })));
  groups.Cue = RACK_CUE_UNITS.filter(u => !u.fixed).map(u => ({ key: u.key, label: u.label, fam: 'cue' }));
  return `<div class="rk-browser-head">COMPONENTS</div>` + Object.entries(groups).map(([g, items]) => `
    <div class="rk-group"><div class="rk-group-name">${g}</div>
      ${items.map(it => {
        const why = rackCanAdd(r, _rk.li, it.key);
        return `<div class="rk-comp${why ? ' rk-off' : ''}" draggable="${why ? 'false' : 'true'}" data-add="${it.key}" title="${_rkEsc(why || 'Drag into the rack, or double-click')}" style="--fam:${RACK_FAM_COLOR[it.fam]}">
          <span class="rk-comp-dot"></span><span class="rk-comp-name">${it.label}${it.multi ? ' +' : ''}<small>${_rkEsc(rackSkin(it.key).model)}</small></span></div>`;
      }).join('')}
    </div>`).join('');
}

function rackHeadHtml() {
  const r = _rk.rack;
  const tabs = [['sfx', 'SFX'], ['instruments', 'Instrument'], ['ambient', 'Ambient']];
  return `<div class="rk-head">
    <button class="action-btn" onclick="rackClose()" title="Back to the list of sounds">◂</button>
    <span class="rk-kind">${(tabs.find(t => t[0] === r.tab) || [0, r.tab])[1]}</span>
    <input class="rk-name" id="rk-name" value="${_rkEsc(r.meta.name || '')}" spellcheck="false">
    <span class="rk-dirty">${_rk.dirty ? '● unsaved' : ''}</span>
    <span class="rk-spacer"></span>
    <button class="action-btn" onclick="rackUndo()" ${_rk.undo.length ? '' : 'disabled'} title="Undo (Ctrl+Z)">↶</button>
    <button class="action-btn" onclick="rackRedo()" ${_rk.redo.length ? '' : 'disabled'} title="Redo (Ctrl+Y)">↷</button>
    <button class="action-btn${_rk.view === 'rear' ? ' selected' : ''}" onclick="rackFlip()" title="Turn the rack round to patch cables">⇄ ${_rk.view === 'rear' ? 'Front' : 'Rear'}</button>
    <button class="action-btn${_rk.cables ? ' selected' : ''}" onclick="_rk.cables=!_rk.cables;rackRender()" title="Show the cables over the front panels">⌇ Cables</button>
    <button class="action-btn" onclick="rackSave(false)" title="Save to this row">💾 Save</button>
    <button class="action-btn" onclick="rackSave(true)" title="Save as a new row">Save as new</button>
    <button class="action-btn" onclick="rackExport()" title="Download as .amp">⬇ .amp</button>
    <button class="action-btn danger" onclick="rackRevert()" ${r.id ? '' : 'disabled'} title="Throw away unsaved changes">Revert</button>
  </div>`;
}

function rackSplitHtml() {
  const r = _rk.rack;
  const lanes = r.layers.map((l, i) => {
    const src = l.waveform === 'noise' || (l.noiseMix ?? 0) >= 1 ? `${l.noise || 'white'} noise` : `${l.waveform || 'square'} ${Math.round(l.freq || 440)}Hz`;
    const muted = _rk.mute.has(i), solo = _rk.solo === i;
    return `<div class="rk-lane${i === _rk.li ? ' rk-sel' : ''}${muted ? ' rk-muted' : ''}" data-lane="${i}">
      <span class="rk-lane-n">L${i + 1}</span><span class="rk-lane-src">${_rkEsc(src)}</span>
      <span class="rk-lane-btn${muted ? ' on' : ''}" data-mute="${i}" title="Mute this layer in the preview">M</span>
      <span class="rk-lane-btn${solo ? ' on' : ''}" data-solo="${i}" title="Solo this layer in the preview">S</span>
    </div>`;
  }).join('');
  const multi = rackLayersAllowed(r);
  return `<div class="rk-split"><span class="rk-split-label">SPLIT</span>${lanes}
    ${multi ? `<button class="action-btn" onclick="rackEdit(()=>{_rk.li=rackAddLayer(_rk.rack)})" title="Add a layer">+</button>
    <button class="action-btn" onclick="rackEdit(()=>{_rk.li=rackAddLayer(_rk.rack,_rk.li)})" title="Duplicate this layer">⧉</button>
    <button class="action-btn danger" onclick="rackEdit(()=>{if(rackDeleteLayer(_rk.rack,_rk.li))_rk.li=Math.max(0,_rk.li-1)})" ${r.layers.length > 1 ? '' : 'disabled'} title="Delete this layer">✕</button>`
    : '<span class="rk-dim">an instrument is one layer</span>'}
  </div>`;
}

// The value the knob shows when the key is absent: the engine's own default.
function rackKnobValue(obj, k) {
  const v = rackGet(obj, k.p);
  return Number.isFinite(v) ? v : k.def;
}
function rackNorm(k, v) {
  if (k.curve === 'log' && k.min > 0) return Math.log(Math.max(k.min, Math.min(k.max, v)) / k.min) / Math.log(k.max / k.min);
  return (Math.max(k.min, Math.min(k.max, v)) - k.min) / (k.max - k.min);
}
function rackDenorm(k, n) {
  n = Math.max(0, Math.min(1, n));
  let v = k.curve === 'log' && k.min > 0 ? k.min * Math.pow(k.max / k.min, n) : k.min + n * (k.max - k.min);
  if (k.step) v = Math.round(v / k.step) * k.step;
  return +v.toPrecision(4);
}
function rackFmt(v, unit) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = a >= 1000 ? (v / 1000).toFixed(a >= 10000 ? 1 : 2) + 'k' : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s + (unit ? ' ' + unit : '');
}
// ── Skins ────────────────────────────────────────────────────────────────────
// Every unit is a piece of gear from a maker that never existed: a brand, a
// model, a finish for the faceplate and a style of knob. Looks only; nothing
// here is saved. The names follow the house rule for shops: a pun, then what
// it is. Brands stay world-neutral, since the rack is THOMAS, not Architect.
const RACK_SKINS = {
  osc:      { brand: 'ORBITAL FORGE', model: 'Tuning Fork', code: 'VCO-9', finish: 'brushed', knob: 'chrome' },
  noise:    { brand: 'HISSWORKS', model: 'Static Cling', code: 'NG-2', finish: 'black', knob: 'cap' },
  fm:       { brand: 'DEVIATION LABS', model: 'Ratio Grande', code: 'FM-1', finish: 'cream', knob: 'bakelite' },
  op2:      { brand: 'DEVIATION LABS', model: 'Ratio Grande Expander', code: 'FM-2X', finish: 'cream', knob: 'bakelite' },
  bend:     { brand: 'SLIDE RULE', model: 'Whammy Clause', code: 'PB-7', finish: 'black', knob: 'cap' },
  vibrato:  { brand: 'MOTIONWORKS', model: 'Wobble Act', code: 'VB-5', finish: 'military', knob: 'chicken' },
  amp:      { brand: 'HOLLOWAY & SONS', model: 'Envelope Pusher', code: 'ADSR-4', finish: 'tolex', knob: 'chicken' },
  drive:    { brand: 'CLIPJOINT', model: 'Tube Strangler', code: 'OD-1', finish: 'red', knob: 'chicken' },
  filter:   { brand: 'RESONANT CIVIC', model: 'Cutoff Point', code: 'Mk II', finish: 'brushed', knob: 'chrome' },
  formants: { brand: 'RESONANT CIVIC', model: 'Throat Clearer', code: 'FB-5', finish: 'cream', knob: 'bakelite' },
  tremolo:  { brand: 'MOTIONWORKS', model: 'Shaky Grounds', code: 'TR-3', finish: 'military', knob: 'chicken' },
  echo:     { brand: 'TAPE & DELAY', model: 'Return to Sender', code: 'DD-180', finish: 'wood', knob: 'bakelite' },
  pan:      { brand: 'SPLIT DECISION', model: 'Left Field', code: 'PN-1', finish: 'black', knob: 'cap' },
  lfo:      { brand: 'MOTIONWORKS', model: 'Swing Vote', code: 'LFO-6', finish: 'blue', knob: 'cap' },
  env:      { brand: 'HOLLOWAY & SONS', model: 'Rise & Fall', code: 'EG-2', finish: 'blue', knob: 'cap' },
  rand:     { brand: 'LOADED DICE', model: 'Snake Eyes', code: 'S&H-1', finish: 'blue', knob: 'cap' },
  master:   { brand: 'ORBITAL FORGE', model: 'Last Word', code: 'MX-1', finish: 'brushed', knob: 'chrome' },
  retro:    { brand: 'BIT ROT', model: 'Crumble Ware', code: 'BC-8', finish: 'military', knob: 'chicken' },
  duck:     { brand: 'SPLIT DECISION', model: 'Duck & Cover', code: 'DK-2', finish: 'black', knob: 'cap' },
};
const rackSkin = (key) => RACK_SKINS[key] || { brand: 'NO BRAND', model: key, code: '', finish: 'black', knob: 'cap' };
// A serial that stays the same for a unit, so the plate doesn't change on every redraw.
function rackSerial(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return String((h >>> 0) % 900000 + 100000);
}
function rackPlateHtml(skin, label, serialKey) {
  return `<span class="rk-badge">${_rkEsc(skin.brand)}</span>
    <span class="rk-model">${_rkEsc(skin.model)}</span>
    <span class="rk-code">${_rkEsc(skin.code)}</span>
    <span class="rk-uname">${label}</span>`;
}
const rackPlateTail = (serialKey) => `<span class="rk-vents"></span><span class="rk-serial">S/N ${rackSerial(serialKey)}</span>`;

// ── Decoration: valves, grilles, louvres, toggles ────────────────────────────
// What each unit carries besides its controls. Mostly for looks, but the
// switches work: POWER bypasses the unit, STANDBY on the amp takes its layer
// out of the preview, and the rest flip and click and change nothing.
//   tubes:n   glass valves whose glow follows the output level
//   grill     speaker cloth; perf a punched-steel grille; exhaust louvres
//   blink     a lamp flashing at the LFO's rate
//   switches  [label, kind]: kind 'power' | 'standby' | a cosmetic pair 'A/B'
const RACK_DECO = {
  amp:      { tubes: 3, grill: 'cloth', switches: [['STANDBY', 'standby'], ['BRIGHT', 'OFF/ON']] },
  drive:    { tubes: 1, switches: [['POWER', 'power'], ['BOOST', 'OFF/ON']] },
  echo:     { tubes: 2, switches: [['POWER', 'power'], ['HEAD', '1/2']] },
  osc:      { exhaust: true, switches: [['POWER', 'power']] },
  noise:    { grill: 'perf', switches: [['POWER', 'power']] },
  fm:       { grill: 'perf', switches: [['POWER', 'power'], ['MAINS', '110/240']] },
  op2:      { switches: [['POWER', 'power']] },
  bend:     { switches: [['POWER', 'power']] },
  vibrato:  { exhaust: true, switches: [['POWER', 'power']] },
  filter:   { exhaust: true, switches: [['POWER', 'power'], ['SLOPE', 'LO/HI']] },
  formants: { grill: 'perf', switches: [['POWER', 'power']] },
  tremolo:  { exhaust: true, switches: [['POWER', 'power']] },
  pan:      { switches: [['POWER', 'power']] },
  lfo:      { blink: true, switches: [['POWER', 'power']] },
  env:      { switches: [['POWER', 'power']] },
  rand:     { switches: [['POWER', 'power'], ['LUCK', 'BAD/GOOD']] },
  master:   { grill: 'perf', switches: [['GROUND', 'LIFT/EARTH']] },
  retro:    { exhaust: true, switches: [['POWER', 'power']] },
  duck:     { switches: [['POWER', 'power']] },
};
// Cosmetic switch positions, for this session only: nothing reads them.
const _rkToggles = {};
function rackToggleHtml(label, kind, unitKey, on, bypassKey) {
  let up, attrs, legend;
  if (kind === 'power') { up = on; attrs = `data-bypass="${bypassKey}"`; legend = ['ON', 'OFF']; }
  else if (kind === 'standby') { up = !_rk.mute.has(_rk.li); attrs = 'data-standby="1"'; legend = ['PLAY', 'STBY']; }
  else {
    const id = `${_rk.li}:${unitKey}:${label}`;
    up = !!_rkToggles[id];
    attrs = `data-toggle="${_rkEsc(id)}"`;
    const [a, b] = kind.split('/');
    legend = [b, a];
  }
  return `<span class="rk-sw${up ? ' up' : ''}" ${attrs} title="${_rkEsc(label)}">
    <span class="rk-sw-leg">${_rkEsc(legend[0])}</span><span class="rk-sw-body"><i></i></span><span class="rk-sw-leg">${_rkEsc(legend[1])}</span>
    <label>${_rkEsc(label)}</label></span>`;
}
function rackDecoHtml(kind, unitKey, on, bypassKey, rate) {
  const d = RACK_DECO[kind];
  if (!d) return '';
  let h = '';
  if (d.exhaust) h += '<span class="rk-exhaust"><i></i></span>';
  if (d.grill) h += `<span class="rk-grill rk-grill-${d.grill}"></span>`;
  if (d.tubes) h += `<span class="rk-tubes">${'<span class="rk-tube"><i></i></span>'.repeat(d.tubes)}</span>`;
  if (d.blink) h += `<span class="rk-lamp" style="animation-duration:${(1 / Math.max(0.05, Math.min(40, rate || 2))).toFixed(3)}s" title="flashes at the rate"></span>`;
  if (d.switches) h += `<span class="rk-switches">${d.switches.map(([l, k]) => rackToggleHtml(l, k, unitKey, on, bypassKey)).join('')}</span>`;
  return `<div class="rk-deco">${h}</div>`;
}
// A switch's click: a short tick and a snap, on the interface bus.
function rackClick() {
  window.AudioEngine?.playSfx({ id: '_rack_click', category: 'ui', priority: 2, config: { duration: 0.03, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 3800, q: 3 }, adsr: { a: 0.0005, d: 0.018, s: 0, r: 0.01 }, gain: 0.35 },
    { waveform: 'square', freq: 1900, adsr: { a: 0.0005, d: 0.006, s: 0, r: 0.004 }, gain: 0.12 },
  ] } });
}

// The knob style the next knobs are drawn in: set by the unit while it renders them.
let _rkKs = 'cap';

// A rotary in SVG: tick marks round a 270° scale, the value arc (from the
// centre on a bipolar knob) and a knob drawn in its unit's style.
function rackKnobSvg(n, bipolar, size = 46, style = 'cap') {
  const c = size / 2, R = c - 3, a0 = 135, sweep = 270;
  const pt = (deg, rr) => { const t = (deg * Math.PI) / 180; return [c + rr * Math.cos(t), c + rr * Math.sin(t)]; };
  const arc = (d0, d1, rr) => {
    if (Math.abs(d1 - d0) < 0.5) return '';
    const [x0, y0] = pt(Math.min(d0, d1), rr), [x1, y1] = pt(Math.max(d0, d1), rr);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${rr} ${rr} 0 ${Math.abs(d1 - d0) > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const at = a0 + n * sweep, from = bipolar ? a0 + sweep / 2 : a0;
  let ticks = '';
  const big = size >= 40;
  for (let i = 0; i <= 10; i++) {
    const d = a0 + (i / 10) * sweep, major = i % 5 === 0;
    const [x0, y0] = pt(d, R), [x1, y1] = pt(d, R - (major ? 3 : 1.8));
    ticks += `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  const kr = R - (big ? 9 : 7);   // the knob's own radius, inside the scale
  const rot = `rotate(${(at + 90).toFixed(1)} ${c} ${c})`;   // turns a shape drawn pointing up
  let knob;
  if (style === 'chrome') {
    // a skirted chrome knob: knurled edge, domed top, an engraved line
    knob = `<circle cx="${c}" cy="${c + 1.2}" r="${kr + 1}" class="rk-k-shadow"/>
      <circle cx="${c}" cy="${c}" r="${kr}" fill="url(#rk-g-chrome)" class="rk-k-edge"/>
      <circle cx="${c}" cy="${c}" r="${kr}" class="rk-k-knurl" stroke-dasharray="1 1.4"/>
      <circle cx="${c}" cy="${c}" r="${kr * 0.66}" fill="url(#rk-g-dome)"/>
      <g transform="${rot}"><line x1="${c}" y1="${c - kr * 0.62}" x2="${c}" y2="${c - kr + 0.5}" class="rk-k-engrave"/></g>`;
  } else if (style === 'chicken') {
    // a chicken-head pointer over a round base, the amp-head classic
    const w = kr * 0.42, L = kr + 2;
    knob = `<circle cx="${c}" cy="${c + 1.2}" r="${kr * 0.8 + 1}" class="rk-k-shadow"/>
      <circle cx="${c}" cy="${c}" r="${kr * 0.8}" fill="url(#rk-g-cream)" class="rk-k-edge"/>
      <g transform="${rot}"><path d="M${c - w} ${c + kr * 0.55} Q${c} ${c + kr * 0.85} ${c + w} ${c + kr * 0.55} L${c + w * 0.45} ${c - L} Q${c} ${c - L - 2} ${c - w * 0.45} ${c - L} Z" fill="url(#rk-g-cream)" class="rk-k-edge"/>
      <line x1="${c}" y1="${c - L + 1.5}" x2="${c}" y2="${c - kr * 0.25}" class="rk-k-ptr-dark"/></g>`;
  } else if (style === 'bakelite') {
    // glossy black bakelite with a white index line and a highlight
    knob = `<circle cx="${c}" cy="${c + 1.2}" r="${kr + 1}" class="rk-k-shadow"/>
      <circle cx="${c}" cy="${c}" r="${kr}" fill="url(#rk-g-bake)" class="rk-k-edge"/>
      <ellipse cx="${c - kr * 0.25}" cy="${c - kr * 0.4}" rx="${kr * 0.45}" ry="${kr * 0.22}" class="rk-k-gloss"/>
      <g transform="${rot}"><line x1="${c}" y1="${c - kr * 0.2}" x2="${c}" y2="${c - kr + 1}" class="rk-k-ptr"/></g>`;
  } else {
    knob = `<circle cx="${c}" cy="${c + 1}" r="${kr + 0.5}" class="rk-k-shadow"/>
      <circle class="rk-k-cap" cx="${c}" cy="${c}" r="${kr}"/>
      <g transform="${rot}"><line x1="${c}" y1="${c - kr * 0.3}" x2="${c}" y2="${c - kr + 1.5}" class="rk-k-ptr"/></g>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="rk-ks-${style}">
    <path class="rk-k-ticks" d="${ticks}"/>
    <path class="rk-k-track" d="${arc(a0, a0 + sweep, R - 5.5)}"/>
    <path class="rk-k-val" d="${arc(from, at, R - 5.5)}"/>
    ${knob}
  </svg>`;
}
// The gradients the knobs fill with, defined once for the page.
const RACK_KNOB_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <radialGradient id="rk-g-chrome" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.35" stop-color="#c9ccd3"/><stop offset="0.7" stop-color="#6d7079"/><stop offset="1" stop-color="#2c2e33"/></radialGradient>
  <radialGradient id="rk-g-dome" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#fafbfd"/><stop offset="0.6" stop-color="#a9adb6"/><stop offset="1" stop-color="#5d6068"/></radialGradient>
  <radialGradient id="rk-g-cream" cx="40%" cy="30%" r="85%"><stop offset="0" stop-color="#fffaf0"/><stop offset="0.55" stop-color="#e6dcc3"/><stop offset="1" stop-color="#8d826a"/></radialGradient>
  <radialGradient id="rk-g-bake" cx="40%" cy="30%" r="85%"><stop offset="0" stop-color="#4a4a4f"/><stop offset="0.5" stop-color="#16161a"/><stop offset="1" stop-color="#000"/></radialGradient>
</defs></svg>`;
function rackKnobHtml(k, obj, scope, jackParam, small) {
  const v = rackKnobValue(obj, k);
  const n = rackNorm(k, v);
  const patched = jackParam ? rackCablesInto(rackLayer(), jackParam) : [];
  const ring = patched.length ? `style="--ring:${rackCableColor(rackLayer(), patched[0].id)}"` : '';
  const jack = jackParam ? `<span class="rk-jack rk-jack-in${patched.length ? ' rk-patched' : ''}${rackLiveTargets(rackLayer()).has(jackParam) ? '' : ' rk-dead'}" data-jack-in="${jackParam}" title="${_rkEsc(rackTargetInfo(jackParam).label)} in"></span>` : '';
  const ks = small ? 'cap' : _rkKs;
  return `<div class="rk-knob${small ? ' rk-small' : ''}${patched.length ? ' rk-modded' : ''}" ${ring} data-scope="${scope}" data-path="${k.p}" data-ks="${ks}"
      data-min="${k.min}" data-max="${k.max}" data-def="${k.def}" data-curve="${k.curve || ''}" data-step="${k.step || ''}" data-unit="${k.unit || ''}"
      title="${_rkEsc(k.label)}: drag up or down, Shift for fine, double-click to reset">
    <div class="rk-k-svg">${rackKnobSvg(n, k.min < 0, small ? 34 : 50, ks)}</div>
    <div class="rk-lcd">${rackFmt(v, k.unit)}</div>
    <label>${k.label}</label>${jack}
  </div>`;
}
function rackSwitchHtml(s, obj, scope) {
  const cur = rackGet(obj, s.p);
  const val = s.bool ? (cur ? s.opts[1] : s.opts[0]) : (cur ?? (s.p.endsWith('curve') ? 'lin' : s.opts[0]));
  return `<div class="rk-switch" data-scope="${scope}" data-path="${s.p}" data-bool="${s.bool ? 1 : ''}">
    ${s.opts.map(o => `<button class="${o === val ? 'on' : ''}" data-val="${o}">${o.replace('sawtooth', 'saw').replace('triangle', 'tri').replace('lowpass', 'LP').replace('highpass', 'HP').replace('bandpass', 'BP').replace('lowshelf', 'LS').replace('highshelf', 'HS').replace('peaking', 'PK').replace('notch', 'NT')}</button>`).join('')}
  </div>`;
}

const RACK_DISPLAY = { amp: 'adsr', filter: 'filter', formants: 'filter' };
function rackUnitHtml(u, obj, on, scope) {
  const fam = scope === 'cue' ? 'cue' : u.fam;
  const knobs = rackKnobsOf(u, obj);
  const inert = scope === 'layer' && on && (u.key === 'fm' || u.key === 'op2' || u.key === 'bend' || u.key === 'vibrato') && !rackHas(obj, rackUnit('osc'));
  const skin = rackSkin(u.key);
  _rkKs = skin.knob;
  const body = on ? `
      ${(u.switches || []).map(s => rackSwitchHtml(s, obj, scope)).join('')}
      <div class="rk-knobs">${knobs.map(k => rackKnobHtml(k, obj, scope, scope === 'layer' ? k.jack : null)).join('')}</div>
      ${RACK_DISPLAY[u.key] ? `<span class="rk-glass"><canvas class="rk-display" data-display="${RACK_DISPLAY[u.key]}" width="180" height="64"></canvas></span>` : ''}`
    : '<div class="rk-bypassed">BYPASSED</div>';
  const rear = scope === 'layer' && on ? `<div class="rk-rear">${knobs.filter(k => k.jack).map(k => rackRearJack(k.jack)).join('') || '<span class="rk-dim">no inputs</span>'}</div>` : '';
  return `<div class="rk-unit rk-fam-${fam} rk-fin-${skin.finish}${on ? '' : ' rk-unit-off'}${inert ? ' rk-inert' : ''}" style="--fam:${RACK_FAM_COLOR[fam]}" data-unit="${u.key}" data-uscope="${scope}">
    <div class="rk-ear"><i></i><i></i></div>
    <div class="rk-plate">
      <span class="rk-led${on ? ' on' : ''}" data-bypass="${u.key}" title="${u.fixed ? 'always on' : on ? 'Bypass' : 'Switch back on'}"></span>
      ${rackPlateHtml(skin, u.label)}
      ${inert ? '<span class="rk-dim">no oscillator</span>' : ''}
      <span class="rk-spacer"></span>
      ${rackPlateTail(`${_rk.li}:${u.key}`)}
      ${u.fixed ? '' : `<span class="rk-x" data-remove="${u.key}" title="Remove">✕</span>`}
    </div>
    <div class="rk-face">${body}${rackDecoHtml(u.key, u.key, on, u.fixed ? null : u.key)}</div>${rear}
    <div class="rk-ear"><i></i><i></i></div>
  </div>`;
}
function rackRearJack(param) {
  const layer = rackLayer();
  const patched = rackCablesInto(layer, param);
  return `<div class="rk-rear-jack"><span class="rk-jack rk-jack-in rk-big${patched.length ? ' rk-patched' : ''}${rackLiveTargets(layer).has(param) ? '' : ' rk-dead'}" data-jack-in="${param}"></span><label>${_rkEsc(rackTargetInfo(param).label)}</label></div>`;
}
function rackCablesInto(layer, param) {
  const out = [];
  for (const m of layer?.mods || []) for (const c of m.to || []) if (c.param === param) out.push({ id: m.id, c });
  return out;
}

function rackModHtml(layer, m, on) {
  const def = RACK_MODS[m.type];
  if (!def) return '';
  const key = `mod:${m.id}`, color = rackCableColor(layer, m.id), scope = `mod:${m.id}`;
  const skin = rackSkin(m.type);
  _rkKs = skin.knob;
  const knobs =def.knobs.map(k => rackKnobHtml(k, m, scope, k.jack === 'rate' ? `mod.${m.id}.rate` : null)).join('');
  const depthJack = `<span class="rk-jack rk-jack-in${rackCablesInto(layer, `mod.${m.id}.amount`).length ? ' rk-patched' : ''}" data-jack-in="mod.${m.id}.amount" title="Depth in"></span>`;
  const cables = (m.to || []).map((c) => {
    const info = rackTargetInfo(c.param);
    const k = K('amount', info.label, -info.max, info.max, info.amt, { unit: info.unit });
    return `<div class="rk-cable-row" data-cable="${m.id}|${c.param}">
      <span class="rk-cdot" style="background:${color}"></span>
      ${rackKnobHtml(k, c, `cable:${m.id}|${c.param}`, null, true)}
      <span class="rk-x" data-unpatch="${m.id}|${c.param}" title="Unplug">✕</span>
    </div>`;
  }).join('');
  return `<div class="rk-unit rk-fam-motion rk-mod rk-fin-${skin.finish}${on ? '' : ' rk-unit-off'}" style="--fam:${color}" data-unit="${key}" data-mod="${m.id}" draggable="false">
    <div class="rk-ear"><i></i><i></i></div>
    <div class="rk-plate">
      <span class="rk-grip" data-grip="${m.id}" title="Drag to reorder">⋮⋮</span>
      <span class="rk-led${on ? ' on' : ''}" data-bypass="${key}" title="${on ? 'Bypass' : 'Switch back on'}"></span>
      ${rackPlateHtml(skin, `${def.label} <b>${_rkEsc(m.id)}</b>`)}
      <span class="rk-spacer"></span>
      ${rackPlateTail(`${_rk.li}:${m.id}`)}
      ${on ? `<span class="rk-depth">DEPTH ${depthJack}</span>` : ''}
      ${on ? `<span class="rk-out">OUT <span class="rk-jack rk-jack-out" data-jack-out="${m.id}" style="--cc:${color}" title="Drag a cable from here"></span></span>` : ''}
      <span class="rk-x" data-remove="${key}" title="Remove">✕</span>
    </div>
    <div class="rk-face">${rackDecoHtml(m.type, m.id, on, key, m.rate)}${on ? `
      ${(def.switches || []).map(s => rackSwitchHtml(s, m, scope)).join('')}
      <span class="rk-glass"><svg class="rk-shape" viewBox="0 0 80 30" width="80" height="30"><path d="${rackModShape(m)}"/></svg></span>
      <div class="rk-knobs">${knobs}</div>
      <div class="rk-cablelist">${cables || '<span class="rk-dim">unpatched: drag from OUT to a jack</span>'}</div>` : '<div class="rk-bypassed">BYPASSED</div>'}
    </div>
    <div class="rk-rear">${on ? `<div class="rk-rear-jack"><span class="rk-jack rk-jack-out rk-big" data-jack-out="${m.id}" style="--cc:${color}"></span><label>OUT</label></div>
      ${m.type === 'lfo' ? rackRearJack(`mod.${m.id}.rate`) : ''}${rackRearJack(`mod.${m.id}.amount`)}` : ''}</div>
    <div class="rk-ear"><i></i><i></i></div>
  </div>`;
}
// A small picture of what the modulator does over one second.
function rackModShape(m) {
  const pts = [];
  if (m.type === 'lfo') {
    const cyc = Math.max(0.5, Math.min(6, m.rate || 2));
    for (let i = 0; i <= 80; i++) {
      const ph = (i / 80) * cyc % 1;
      const v = m.wave === 'square' ? (ph < 0.5 ? 1 : -1) : m.wave === 'sawtooth' ? ph * 2 - 1 : m.wave === 'triangle' ? 1 - 4 * Math.abs(ph - 0.5) : Math.sin(ph * Math.PI * 2);
      const fade = m.fade > 0 ? Math.min(1, (i / 80) / m.fade) : 1;
      pts.push([i, 15 - v * 12 * fade]);
    }
  } else if (m.type === 'env') {
    const a = m.a ?? 0.01, d = m.d ?? 0.2, s = m.s ?? 0, tot = Math.max(0.5, a + d + 0.3);
    for (let i = 0; i <= 80; i++) {
      const t = (i / 80) * tot;
      const v = t < a ? t / a : t < a + d ? 1 + (s - 1) * ((t - a) / d) : s;
      pts.push([i, 27 - v * 24]);
    }
  } else {
    const rnd = (() => { let a = (m.seed || 1) >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
    const steps = Math.max(2, Math.min(24, Math.round(m.rate || 6)));
    let prev = rnd() * 2 - 1;
    for (let s = 0; s < steps; s++) {
      const next = rnd() * 2 - 1, x0 = (s / steps) * 80, x1 = ((s + 1) / steps) * 80;
      pts.push([x0, 15 - prev * 12]);
      pts.push([x1, 15 - (m.smooth ? next : prev) * 12]);
      prev = next;
    }
  }
  return 'M' + pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L');
}

function rackTransportHtml() {
  const kb = _rk.rack.tab === 'instruments' ? 'plays the note' : 'transposes the patch';
  return `<div class="rk-transport">
    <button class="rk-tbtn rk-play" onclick="rackAudition(true)" title="Play (Space)">▶</button>
    <button class="rk-tbtn" id="rk-hold" title="Hold to sustain">HOLD</button>
    <button class="rk-tbtn${_rk.loop ? ' on' : ''}" onclick="rackToggleLoop()" title="Play over and over">⟲ LOOP</button>
    <button class="rk-tbtn${_rk.auto ? ' on' : ''}" onclick="_rk.auto=!_rk.auto;rackRender()" title="Play again after every edit">AUTO</button>
    <button class="rk-tbtn" onclick="rackStop()" title="Stop">■</button>
    <span class="rk-glass"><canvas id="rk-scope" class="rk-scope" width="260" height="48"></canvas></span>
    <span class="rk-glass"><canvas id="rk-spectrum" class="rk-scope" width="200" height="48"></canvas></span>
    <div class="rk-meter"><i id="rk-meter-bar"></i></div>
    <span class="rk-dim rk-keys-hint">Keys Z–M and Q–U: the keyboard ${kb} · Shift plays harder</span>
  </div>`;
}

// ── Events ───────────────────────────────────────────────────────────────────

function rackObj(scope) {
  const layer = rackLayer();
  if (scope === 'layer') return layer;
  if (scope === 'cue') return _rk.rack.cue;
  if (scope.startsWith('mod:')) return rackMod(layer, scope.slice(4));
  if (scope.startsWith('cable:')) {
    const [id, param] = scope.slice(6).split('|');
    return (rackMod(layer, id)?.to || []).find(c => c.param === param);
  }
  return null;
}

function rackWire(root) {
  const name = root.querySelector('#rk-name');
  if (name) name.onchange = () => { _rk.rack.meta.name = name.value.trim() || _rk.rack.meta.name; _rk.dirty = true; rackRender(); };

  root.onclick = (e) => {
    const t = e.target;
    const by = t.closest('[data-bypass]');
    if (by) { const u = rackUnit(by.dataset.bypass); if (u?.fixed) return; if (by.classList.contains('rk-sw')) rackClick(); rackEdit(() => rackBypass(_rk.rack, _rk.li, by.dataset.bypass)); return; }
    const rm = t.closest('[data-remove]');
    if (rm) { rackEdit(() => { const ok = rackRemove(_rk.rack, _rk.li, rm.dataset.remove); if (!ok) toast?.('A layer needs at least one source', true); }); return; }
    const up = t.closest('[data-unpatch]');
    if (up) { const [id, p] = up.dataset.unpatch.split('|'); rackEdit(() => rackUnpatch(_rk.rack, _rk.li, id, p)); return; }
    const sw = t.closest('.rk-switch button');
    if (sw) {
      const box = sw.parentElement, obj = rackObj(box.dataset.scope);
      if (!obj) return;
      rackEdit(() => {
        if (box.dataset.bool) rackSet(obj, box.dataset.path, sw.dataset.val === 'glide' ? true : undefined);
        else if (box.dataset.path.endsWith('curve')) rackSet(obj, box.dataset.path, sw.dataset.val === 'exp' ? 'exp' : undefined);
        else rackSet(obj, box.dataset.path, sw.dataset.val);
      });
      return;
    }
    const tog = t.closest('[data-toggle]');
    if (tog) { _rkToggles[tog.dataset.toggle] = !_rkToggles[tog.dataset.toggle]; tog.classList.toggle('up'); rackClick(); return; }
    if (t.closest('[data-standby]')) { _rk.mute.has(_rk.li) ? _rk.mute.delete(_rk.li) : _rk.mute.add(_rk.li); rackClick(); rackRender(); return; }
    const mute = t.closest('[data-mute]');
    if (mute) { const i = +mute.dataset.mute; _rk.mute.has(i) ? _rk.mute.delete(i) : _rk.mute.add(i); rackRender(); return; }
    const solo = t.closest('[data-solo]');
    if (solo) { const i = +solo.dataset.solo; _rk.solo = _rk.solo === i ? null : i; rackRender(); return; }
    const lane = t.closest('[data-lane]');
    if (lane) { _rk.li = +lane.dataset.lane; rackRender(); return; }
  };
  root.ondblclick = (e) => {
    const comp = e.target.closest('[data-add]');
    if (comp && !comp.classList.contains('rk-off')) { rackAddUnit(comp.dataset.add); return; }
    const knob = e.target.closest('.rk-knob');
    if (knob) {
      const obj = rackObj(knob.dataset.scope);
      if (obj) rackEdit(() => rackSet(obj, knob.dataset.path, +knob.dataset.def));
    }
  };

  // Components drag into the rack.
  root.querySelectorAll('[data-add][draggable="true"]').forEach(el => {
    el.ondragstart = (e) => { e.dataTransfer.setData('text/rack-unit', el.dataset.add); e.dataTransfer.effectAllowed = 'copy'; };
  });
  const stack = root.querySelector('#rk-stack');
  if (stack) {
    stack.ondragover = (e) => { if ([...e.dataTransfer.types].includes('text/rack-unit')) { e.preventDefault(); stack.classList.add('rk-drop'); } };
    stack.ondragleave = (e) => { if (e.target === stack) stack.classList.remove('rk-drop'); };
    stack.ondrop = (e) => { e.preventDefault(); stack.classList.remove('rk-drop'); const k = e.dataTransfer.getData('text/rack-unit'); if (k) rackAddUnit(k); };
    stack.onscroll = () => rackDrawCables();
  }

  root.onpointerdown = (e) => {
    if (e.button !== 0) return;
    // a cable lies over the jacks it plugs into, so a jack is found through it
    const under = (sel) => document.elementsFromPoint(e.clientX, e.clientY).map(el => el.closest?.(sel)).find(Boolean);
    const out = under('[data-jack-out]');
    if (out) { rackCableDrag(e, out.dataset.jackOut, null); return; }
    const knob = e.target.closest('.rk-knob');
    if (knob && !e.target.closest('[data-jack-in]')) { rackKnobDrag(e, knob); return; }
    const inj = under('[data-jack-in].rk-patched');
    if (inj) {
      // pick up the newest cable in this jack and carry it somewhere else
      const into = rackCablesInto(rackLayer(), inj.dataset.jackIn);
      const last = into[into.length - 1];
      if (last) rackCableDrag(e, last.id, inj.dataset.jackIn);
      return;
    }
    const grip = e.target.closest('[data-grip]');
    if (grip) { rackModReorder(e, grip.dataset.grip); return; }
  };
  root.onwheel = (e) => {
    const knob = e.target.closest('.rk-knob');
    if (!knob) return;
    e.preventDefault();
    const k = rackKnobSpec(knob), obj = rackObj(knob.dataset.scope);
    if (!obj) return;
    const n = rackNorm(k, rackKnobValue(obj, k)) + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.002 : 0.02);
    rackEdit(() => rackSet(obj, k.p, rackDenorm(k, n)), { render: false });
    rackRefreshKnob(knob);
  };

  const hold = root.querySelector('#rk-hold');
  if (hold) {
    hold.onpointerdown = (e) => { e.preventDefault(); hold.classList.add('on'); rackHoldStart(null, 0.7); };
    const up = () => { hold.classList.remove('on'); rackHoldEnd(null); };
    hold.onpointerup = up; hold.onpointerleave = up;
  }
  root.onkeydown = rackKeyDown;
  root.onkeyup = rackKeyUp;
}

function rackKnobSpec(el) {
  const d = el.dataset;
  return { p: d.path, min: +d.min, max: +d.max, def: +d.def, curve: d.curve || null, step: d.step ? +d.step : null, unit: d.unit };
}
function rackRefreshKnob(el) {
  const k = rackKnobSpec(el), obj = rackObj(el.dataset.scope);
  if (!obj) return;
  const v = rackKnobValue(obj, k);
  el.querySelector('.rk-k-svg').innerHTML = rackKnobSvg(rackNorm(k, v), k.min < 0, el.classList.contains('rk-small') ? 34 : 50, el.dataset.ks);
  el.querySelector('.rk-lcd').textContent = rackFmt(v, k.unit);
}
// Relative drag: the knob moves by how far the pointer moves, and stays where it was left.
function rackKnobDrag(e, el) {
  e.preventDefault();
  const k = rackKnobSpec(el), obj = rackObj(el.dataset.scope);
  if (!obj) return;
  const before = JSON.stringify({ cue: _rk.rack.cue, layers: _rk.rack.layers, cb: _rk.rack.cueBypass });
  let n = rackNorm(k, rackKnobValue(obj, k)), lastY = e.clientY, moved = false;
  el.setPointerCapture?.(e.pointerId);
  el.classList.add('rk-turning');
  const move = (ev) => {
    const dy = lastY - ev.clientY;
    lastY = ev.clientY;
    if (!dy) return;
    moved = true;
    n = Math.max(0, Math.min(1, n + dy / (ev.shiftKey ? 900 : 180)));
    rackSet(obj, k.p, rackDenorm(k, n));
    rackRefreshKnob(el);
    rackDrawDisplays();
  };
  const up = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.classList.remove('rk-turning');
    if (!moved) return;
    _rk.undo.push(before); _rk.redo = []; _rk.dirty = true;
    rackRender();
    if (_rk.auto) rackAudition();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

function rackAddUnit(key) {
  const res = rackEdit(() => rackAdd(_rk.rack, _rk.li, key));
  if (typeof res === 'string' && !RACK_MODS[key]) toast?.(res, true);
  else if (RACK_MODS[key] && typeof res === 'string' && rackMod(rackLayer(), res)) {
    // a fresh modulator: open the back so it can be patched straight away
    requestAnimationFrame(() => document.querySelector(`[data-unit="mod:${res}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }
}

function rackFlip() {
  const stack = document.getElementById('rk-stack');
  _rk.view = _rk.view === 'front' ? 'rear' : 'front';
  if (stack) {
    stack.classList.add('rk-flipping');
    setTimeout(() => { _rk.flipIn = true; rackRender(); }, 150);
  } else rackRender();
}

// ── Cables ───────────────────────────────────────────────────────────────────

function rackJackPos(stack, el) {
  const s = stack.getBoundingClientRect(), r = el.getBoundingClientRect();
  return [r.left + r.width / 2 - s.left + stack.scrollLeft, r.top + r.height / 2 - s.top + stack.scrollTop];
}
// A cable hangs: both ends leave sideways and the middle droops by its span.
function rackCablePath(a, b, sway = 0) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const span = Math.hypot(dx, dy);
  const sag = Math.min(160, 30 + span * 0.28) * (1 + sway);
  const side = Math.max(30, Math.min(90, Math.abs(dx) * 0.4 + 30));
  const c1 = [a[0] + side, a[1] + sag], c2 = [b[0] + side, b[1] + sag * 0.6];
  return `M${a[0].toFixed(1)} ${a[1].toFixed(1)} C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
}
function rackDrawCables(extra) {
  const stack = document.getElementById('rk-stack'), svg = document.getElementById('rk-cables');
  if (!stack || !svg) return;
  svg.setAttribute('width', stack.scrollWidth);
  svg.setAttribute('height', stack.scrollHeight);
  const layer = rackLayer();
  const show = _rk.cables || _rk.view === 'rear';
  let html = '';
  if (show) {
    for (const m of layer.mods || []) {
      const from = stack.querySelector(`[data-jack-out="${CSS.escape(m.id)}"]${_rk.view === 'rear' ? '.rk-big' : ':not(.rk-big)'}`) || stack.querySelector(`[data-jack-out="${CSS.escape(m.id)}"]`);
      if (!from) continue;
      for (const c of m.to || []) {
        if (extra?.skip && extra.skip.id === m.id && extra.skip.param === c.param) continue;
        const sel = `[data-jack-in="${CSS.escape(c.param)}"]`;
        const to = stack.querySelector(_rk.view === 'rear' ? `${sel}.rk-big` : `${sel}:not(.rk-big)`) || stack.querySelector(sel);
        if (!to) continue;
        const a = rackJackPos(stack, from), b = rackJackPos(stack, to);
        const sway = _rk.sway && _rk.sway.id === m.id && _rk.sway.param === c.param ? _rk.sway.v : 0;
        html += rackCableSvg(rackCablePath(a, b, sway), a, b, rackCableColor(layer, m.id), `${m.id}|${c.param}`, !rackLiveTargets(layer).has(c.param));
      }
    }
  }
  if (extra?.temp) html += rackCableSvg(rackCablePath(extra.temp.a, extra.temp.b), extra.temp.a, extra.temp.b, extra.temp.color, '', false, true);
  svg.innerHTML = html;
  svg.querySelectorAll('[data-wire]').forEach(p => {
    p.onclick = (e) => rackCablePopover(e, p.dataset.wire);
    p.oncontextmenu = (e) => { e.preventDefault(); const [id, param] = p.dataset.wire.split('|'); rackEdit(() => rackUnpatch(_rk.rack, _rk.li, id, param)); };
  });
}
function rackCableSvg(d, a, b, color, wire, dead, temp) {
  return `<g class="rk-wire${dead ? ' rk-wire-dead' : ''}${temp ? ' rk-wire-temp' : ''}">
    <path class="rk-wire-shadow" d="${d}"/>
    <path class="rk-wire-body" d="${d}" style="stroke:${color}"/>
    <path class="rk-wire-shine" d="${d}"/>
    ${wire ? `<path class="rk-wire-hit" d="${d}" data-wire="${wire}"><title>${_rkEsc(rackTargetInfo(wire.split('|')[1]).label)}: click for amount, right-click to unplug</title></path>` : ''}
    <circle class="rk-plug" cx="${a[0]}" cy="${a[1]}" r="6" style="fill:${color}"/><circle class="rk-plug" cx="${b[0]}" cy="${b[1]}" r="6" style="fill:${color}"/>
  </g>`;
}
// Drag a cable from a mod's OUT (or pick one up out of an IN with `from`).
function rackCableDrag(e, id, from) {
  e.preventDefault();
  const stack = document.getElementById('rk-stack');
  const layer = rackLayer();
  const outEl = stack.querySelector(`[data-jack-out="${CSS.escape(id)}"]${_rk.view === 'rear' ? '.rk-big' : ':not(.rk-big)'}`) || stack.querySelector(`[data-jack-out="${CSS.escape(id)}"]`);
  if (!outEl) return;
  const a = rackJackPos(stack, outEl), color = rackCableColor(layer, id);
  const keep = from ? (rackMod(layer, id).to || []).find(c => c.param === from)?.amount : undefined;
  const skip = from ? { id, param: from } : null;
  stack.classList.add('rk-patching');
  const live = rackLiveTargets(layer);
  stack.querySelectorAll('[data-jack-in]').forEach(j => { if (live.has(j.dataset.jackIn) && j.dataset.jackIn !== `mod.${id}.rate` && j.dataset.jackIn !== `mod.${id}.amount`) j.classList.add('rk-can'); });
  const move = (ev) => {
    const s = stack.getBoundingClientRect();
    rackDrawCables({ skip, temp: { a, b: [ev.clientX - s.left + stack.scrollLeft, ev.clientY - s.top + stack.scrollTop], color } });
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    stack.classList.remove('rk-patching');
    stack.querySelectorAll('.rk-can').forEach(j => j.classList.remove('rk-can'));
    // look through the cables to the jack under them
    const hit = document.elementsFromPoint(ev.clientX, ev.clientY).map(el => el.closest?.('[data-jack-in]')).find(Boolean);
    const to = hit?.dataset.jackIn;
    if (to === from) { rackDrawCables(); return; }
    let msg = null;
    rackEdit(() => {
      if (from) rackUnpatch(_rk.rack, _rk.li, id, from);
      if (to) { const r = rackPatch(_rk.rack, _rk.li, id, to, keep); if (r !== true) msg = r; }
    });
    if (msg) toast?.(msg, true);
    else if (to) rackSway(id, to);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  move(e);
}
// The cable bounces once when it's plugged in.
function rackSway(id, param) {
  const t0 = performance.now();
  const step = (t) => {
    const k = (t - t0) / 650;
    if (k >= 1 || !document.getElementById('rk-cables')) { _rk.sway = null; rackDrawCables(); return; }
    _rk.sway = { id, param, v: Math.sin(k * Math.PI * 3) * (1 - k) * 0.35 };
    rackDrawCables();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function rackCablePopover(e, wire) {
  document.querySelector('.rk-pop')?.remove();
  const [id, param] = wire.split('|');
  const c = (rackMod(rackLayer(), id)?.to || []).find(x => x.param === param);
  if (!c) return;
  const info = rackTargetInfo(param);
  const pop = document.createElement('div');
  pop.className = 'rk-pop';
  pop.style.left = `${e.clientX + 8}px`; pop.style.top = `${e.clientY - 40}px`;
  _rkKs = 'chrome';
  pop.innerHTML = `<div class="rk-pop-h"><span class="rk-cdot" style="background:${rackCableColor(rackLayer(), id)}"></span>${_rkEsc(id)} → ${_rkEsc(info.label)}</div>
    ${rackKnobHtml(K('amount', 'Amount', -info.max, info.max, info.amt, { unit: info.unit }), c, `cable:${id}|${param}`, null)}
    <button class="action-btn danger" data-unpatch="${id}|${param}">Unplug</button>`;
  document.getElementById('rk-root').appendChild(pop);
  const close = (ev) => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('pointerdown', close, true); } };
  setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
}
// Motion units reorder by their grip: the order is the order of layer.mods.
function rackModReorder(e, id) {
  e.preventDefault();
  const stack = document.getElementById('rk-stack');
  const up = (ev) => {
    const over = document.elementsFromPoint(ev.clientX, ev.clientY).map(el => el.closest?.('[data-mod]')).find(Boolean);
    if (!over || over.dataset.mod === id) return;
    rackEdit(() => {
      const mods = rackLayer().mods;
      const from = mods.findIndex(m => m.id === id), to = mods.findIndex(m => m.id === over.dataset.mod);
      if (from < 0 || to < 0) return;
      const [m] = mods.splice(from, 1);
      mods.splice(to, 0, m);
    });
  };
  stack.classList.add('rk-reordering');
  window.addEventListener('pointerup', (ev) => { stack.classList.remove('rk-reordering'); up(ev); }, { once: true });
}

// ── Displays ─────────────────────────────────────────────────────────────────

let _rkProbe = null;
function rackDrawDisplays() {
  const layer = rackLayer();
  if (!layer) return;
  const css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue('--accent').trim() || '#ff2ec4', dim = css.getPropertyValue('--border').trim() || '#333';
  document.querySelectorAll('#rk-root canvas[data-display]').forEach(cv => {
    const g = cv.getContext('2d');
    if (!g) return;
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = dim; g.lineWidth = 1;
    for (let x = 0; x <= W; x += W / 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    g.strokeStyle = cv.closest('.rk-unit') ? getComputedStyle(cv.closest('.rk-unit')).getPropertyValue('--fam').trim() || fg : fg;
    g.lineWidth = 2; g.beginPath();
    if (cv.dataset.display === 'adsr') {
      const a = layer.adsr?.a ?? 0.01, d = layer.adsr?.d ?? 0.05, s = layer.adsr?.s ?? 0.7, r = layer.adsr?.r ?? 0.15;
      const hold = Math.max(0.1, (a + d + r) * 0.4), tot = a + d + hold + r, X = (t) => (t / tot) * (W - 4) + 2, Y = (v) => H - 3 - v * (H - 8);
      const exp = layer.adsr?.curve === 'exp';
      g.moveTo(X(0), Y(0)); g.lineTo(X(a), Y(1));
      for (let i = 1; i <= 20; i++) { const t = (i / 20) * d; g.lineTo(X(a + t), Y(exp ? s + (1 - s) * Math.exp(-t / Math.max(0.001, d / 3)) : 1 + (s - 1) * (i / 20))); }
      g.lineTo(X(a + d + hold), Y(s));
      for (let i = 1; i <= 20; i++) { const t = (i / 20); g.lineTo(X(a + d + hold + t * r), Y(exp ? s * Math.exp(-t * 5) : s * (1 - t))); }
    } else {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) return;
      _rkProbe ||= new OAC(1, 1, 48000);
      const N = W, freqs = new Float32Array(N), mag = new Float32Array(N), ph = new Float32Array(N);
      for (let i = 0; i < N; i++) freqs[i] = 20 * Math.pow(1000, i / (N - 1));
      const acc = new Float32Array(N);
      const bank = Array.isArray(layer.formants) && layer.formants.length
        ? layer.formants.map(f => (typeof f === 'object' ? { type: 'bandpass', freq: f.freq, q: f.q ?? 8, gain: 0 } : { type: 'bandpass', freq: f, q: 8 }))
        : [layer.filter || { type: 'lowpass', freq: 4000, q: 1 }];
      for (const f of bank) {
        const bq = _rkProbe.createBiquadFilter();
        bq.type = f.type || 'lowpass'; bq.frequency.value = f.freq || 4000; bq.Q.value = f.q ?? 1; if (Number.isFinite(f.gain)) bq.gain.value = f.gain;
        bq.getFrequencyResponse(freqs, mag, ph);
        for (let i = 0; i < N; i++) acc[i] += mag[i];
      }
      for (let i = 0; i < N; i++) {
        const db = 20 * Math.log10(Math.max(1e-4, acc[i]));
        const y = H / 2 - (db / 24) * (H / 2);
        if (i) g.lineTo(i, Math.max(1, Math.min(H - 1, y))); else g.moveTo(i, y);
      }
    }
    g.stroke();
  });
}

// The scope, spectrum and level, off an analyser tapped on the patch's bus.
function rackStartMeter() {
  cancelAnimationFrame(_rk.raf);
  const AE = window.AudioEngine;
  if (!AE?.engineNodes) return;
  const cat = rackCategory();
  if (!_rk.meter || _rk.meter.cat !== cat) {
    try { _rk.meter?.bus.disconnect(_rk.meter.an); } catch { /* already gone */ }
    const n = AE.engineNodes(cat);
    if (!n?.ctx || !n.bus) return;
    const an = n.ctx.createAnalyser();
    an.fftSize = 2048; an.smoothingTimeConstant = 0.6;
    n.bus.connect(an);
    _rk.meter = { cat, an, bus: n.bus, t: new Float32Array(an.fftSize), f: new Uint8Array(an.frequencyBinCount) };
  }
  const draw = () => {
    const sc = document.getElementById('rk-scope'), sp = document.getElementById('rk-spectrum'), bar = document.getElementById('rk-meter-bar');
    if (!sc) return;   // the rack closed: the loop ends with it
    const { an, t, f } = _rk.meter;
    an.getFloatTimeDomainData(t);
    an.getByteFrequencyData(f);
    const css = getComputedStyle(document.documentElement);
    const col = css.getPropertyValue('--green').trim() || '#3ddc84', acc = css.getPropertyValue('--accent').trim() || '#ff2ec4';
    const g = sc.getContext('2d');
    g.clearRect(0, 0, sc.width, sc.height);
    g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath();
    // start on a rising zero crossing so the trace stands still
    let s0 = 0;
    for (let i = 1; i < t.length / 2; i++) if (t[i - 1] < 0 && t[i] >= 0) { s0 = i; break; }
    let peak = 0;
    for (let x = 0; x < sc.width; x++) {
      const v = t[s0 + x * 2] || 0;
      peak = Math.max(peak, Math.abs(v));
      const y = sc.height / 2 - v * (sc.height / 2 - 2);
      if (x) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    const h = sp.getContext('2d');
    h.clearRect(0, 0, sp.width, sp.height);
    h.fillStyle = acc;
    const bins = f.length;
    for (let x = 0; x < sp.width; x++) {
      const bi = Math.min(bins - 1, Math.floor(Math.pow(bins, x / sp.width)));
      const v = f[bi] / 255;
      h.fillRect(x, sp.height - v * sp.height, 1, v * sp.height);
    }
    if (bar) bar.style.width = `${Math.min(100, peak * 100)}%`;
    // the valves glow with the level, rising fast and cooling slowly
    _rk.glow = Math.max(peak, (_rk.glow || 0) * 0.94);
    document.getElementById('rk-root')?.style.setProperty('--level', Math.min(1, _rk.glow * 1.6).toFixed(3));
    _rk.raf = requestAnimationFrame(draw);
  };
  _rk.raf = requestAnimationFrame(draw);
}

// ── Playing it ───────────────────────────────────────────────────────────────

function rackCategory() {
  const r = _rk.rack;
  if (!r) return 'sfx';
  return typeof _previewCategory === 'function' ? _previewCategory(r.tab, r.meta.category) : (r.tab === 'instruments' ? 'music' : r.meta.category || 'sfx');
}
// The def the preview plays: muted layers out, the keyboard's note applied.
function rackPreviewDef(noteHz, velocity) {
  const r = _rk.rack;
  const row = rackToRow(r);
  const cfg = row.config;
  const audible = (i) => (_rk.solo != null ? i === _rk.solo : !_rk.mute.has(i));
  if (r.tab === 'instruments') {
    const c = { ...cfg, waveform: row.waveform, freq: noteHz || 440, duration: 0.6 };
    if (velocity != null) c.velocity = velocity;
    return { id: '_rack', priority: 9, category: rackCategory(), config: c };
  }
  const ratio = noteHz ? noteHz / 261.63 : 1;
  const tune = (l) => {
    if (ratio === 1 && velocity == null) return l;
    const c = rackClone(l);
    if (c.freq || c.waveform !== 'noise') c.freq = (c.freq || 440) * ratio;
    if (c.pitchBend?.to) c.pitchBend.to *= ratio;
    if (c.fm?.rate) c.fm.rate *= ratio;
    if (velocity != null) c.velocity = velocity;
    return c;
  };
  const layers = r.layers.map((l, i) => (audible(i) ? tune(l) : null)).filter(Boolean)
    .map(l => { const c = rackClone(l); delete c.rack; return c; });
  if (!layers.length) return null;
  const cue = rackClone(r.cue);
  delete cue.sparkle;
  const config = { ...cue, layers };
  if (r.tab === 'ambient' && !(config.duration > 0)) config.duration = 3;
  return { id: '_rack', priority: 9, category: rackCategory(), config };
}
// An edit replays the patch, but a run of edits (a wheel spun) plays it once.
let _rkAuditionT = null;
function rackAudition(force) {
  if (!force) {
    if (!_rk.auto) return;
    clearTimeout(_rkAuditionT);
    _rkAuditionT = setTimeout(() => rackAudition(true), 140);
    return;
  }
  const AE = window.AudioEngine;
  if (!AE) return;
  AE.init();
  if (_rk.held) return;   // a held note is sounding: the edit waits for the next trigger
  const def = rackPreviewDef();
  if (def) AE.playSfx(def);
  if (_rk.loop) rackArmLoop();
}
function rackArmLoop() {
  clearTimeout(_rk.loopT);
  if (!_rk.loop || !_rk.rack) return;
  const r = _rk.rack;
  const dur = r.tab === 'instruments' ? 0.6 : r.cue.duration ?? (r.tab === 'ambient' ? 3 : 0.4);
  const tail = Math.max(0.15, ...r.layers.map(l => (l.delay ?? 0) + (l.adsr?.r ?? 0.15)));
  _rk.loopT = setTimeout(() => { if (_rk.loop && document.getElementById('rk-root')) rackAudition(true); }, (dur + tail + 0.15) * 1000);
}
function rackToggleLoop() { _rk.loop = !_rk.loop; if (_rk.loop) rackAudition(true); else clearTimeout(_rk.loopT); rackRender(); }
function rackStop() {
  _rk.loop = false; clearTimeout(_rk.loopT);
  for (const h of _rk.keys.values()) h?.release?.();
  _rk.keys.clear();
  _rk.held?.release?.(); _rk.held = null;
  rackRender();
}
function rackHoldStart(code, vel, hz) {
  const AE = window.AudioEngine;
  if (!AE) return;
  AE.init();
  const def = rackPreviewDef(hz, vel);
  if (!def) return;
  const h = AE.playSfx(def, 1, { sustain: true });
  if (code) _rk.keys.set(code, h); else { _rk.held?.release?.(); _rk.held = h; }
}
function rackHoldEnd(code) {
  if (code) { _rk.keys.get(code)?.release?.(); _rk.keys.delete(code); return; }
  _rk.held?.release?.(); _rk.held = null;
}
// Two octaves on the letters, from C3 on Z and C4 on Q.
const RACK_KEYMAP = { KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24 };
function rackKeyDown(e) {
  if (e.target.closest('input,textarea,select')) return;
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? rackRedo() : rackUndo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); rackRedo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); rackAudition(true); return; }
  const semi = RACK_KEYMAP[e.code];
  if (semi == null || e.repeat) return;
  e.preventDefault();
  const hz = 130.81 * Math.pow(2, semi / 12);
  rackHoldStart(e.code, e.shiftKey ? 1 : 0.6, hz);
}
function rackKeyUp(e) { if (RACK_KEYMAP[e.code] != null) rackHoldEnd(e.code); }

// ── Saving ───────────────────────────────────────────────────────────────────

async function rackSave(asNew) {
  const r = _rk.rack;
  const body = rackToRow(r);
  if (!body.name) { toast?.('Name is required', true); return; }
  const isNew = asNew || !r.id;
  if (isNew && asNew) body.name = body.name + '_copy';
  const res = isNew ? await API(`/audio/${r.tab}`, 'POST', body) : await API(`/audio/${r.tab}/${r.id}`, 'PUT', body);
  if (res?.error) { toast?.(res.error, true); return; }
  if (isNew && res?.id) { r.id = res.id; r.meta.id = res.id; }
  r.meta.name = body.name;
  _rk.dirty = false;
  toast?.(isNew ? 'Saved as a new row' : 'Saved');
  if (typeof loadPanel === 'function') loadPanel('audio'); else rackRender();
}
function rackExport() {
  const r = _rk.rack, row = rackToRow(r);
  const fields = (typeof AUDIO_IMPORT_FIELDS !== 'undefined' && AUDIO_IMPORT_FIELDS[r.tab]) || Object.keys(row);
  const data = {};
  for (const f of fields) if (row[f] !== undefined) data[f] = row[f];
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${r.tab}_${String(row.name || 'patch').replace(/[^a-z0-9_-]/gi, '_')}.amp`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function rackRevert() {
  const r = _rk.rack;
  if (!r?.id) return;
  if (_rk.dirty && !confirm('Throw away the unsaved changes?')) return;
  const row = findAudioAsset(r.tab, r.id);
  if (row) rackLoad(r.tab, row);
  rackRender();
}
function rackClose() {
  if (_rk.dirty && !confirm('Leave the rack? Unsaved changes are lost.')) return;
  rackStop();
  _rk.rack = null;
  rackRender();
}
