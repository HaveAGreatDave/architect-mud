// ── Rack: the Audio tab's patch editor for SIREN ─────────────────────────────
//
// A cue shown as a rack of units in SIREN's signal order, with a component
// browser to add and remove them and patch cables for modulation. The rack is a
// view of the row's own config: there is no patch format of its own, and saving
// writes the same row the forms write. docs/amp-format.md has the keys.
//
// Two halves. The MODEL (rackFromRow .. rackLiveTargets) is pure: no DOM, no
// engine, so scripts/audio/rack-smoke.mjs runs it in Node. The VIEW (renderRack
// and below) draws it and plays it.
//
// What it can't do, because SIREN can't: reorder the chain. buildLayer fixes it
// (sources and FM, the envelope, drive, fold, ring, filter, EQ, compressor,
// tremolo, phaser, chorus, echo, pan), so chain units keep their place and only
// the modulators below it reorder.
//
// Every top-level name here starts rack, RACK_ or _rk: the devpanel's scripts
// share one global scope.

// ── Model ────────────────────────────────────────────────────────────────────

// Keys that belong to the cue, not a layer. In a one-layer cue they sit flat
// beside the layer's own keys.
const RACK_CUE_KEYS = ['duration', 'send', 'retro', 'duck', 'sparkle', 'layers'];

// What a cable can be patched into: the label on the jack, the unit of `amount`,
// a first amount you can plainly hear, the knob's reach, how the cable moves the
// knob it sits on (`live`, for the moving dot) and the unit that has to be in the
// rack and switched on for the jack to do anything. The names are the engine's
// (AudioEngine.MOD_TARGETS); mod.<id>.rate and mod.<id>.amount are added per mod.
const RACK_TARGETS = {
  'pitch':         { label: 'Pitch',        unit: 'ct', amt: 100,  max: 2400, live: 'add',   needs: 'osc' },
  'fm.index':      { label: 'FM Index',     unit: '',   amt: 2,    max: 20,   live: 'add',   needs: 'fm' },
  'fm.ratio':      { label: 'FM Ratio',     unit: 'ct', amt: 100,  max: 2400, live: 'cents', needs: 'fm' },
  'op2.index':     { label: 'Op2 Index',    unit: '',   amt: 1,    max: 20,   live: 'add',   needs: 'op2' },
  'op2.ratio':     { label: 'Op2 Ratio',    unit: 'ct', amt: 100,  max: 2400, live: 'cents', needs: 'op2' },
  'filter.cutoff': { label: 'Cutoff',       unit: 'ct', amt: 2400, max: 4800, live: 'cents', needs: 'filter' },
  'filter.q':      { label: 'Reso',         unit: '',   amt: 4,    max: 20,   live: 'add',   needs: 'filter' },
  'amp':           { label: 'Amp',          unit: '',   amt: 0.5,  max: 1,    live: 'mul' },
  'pan':           { label: 'Pan',          unit: '',   amt: 0.8,  max: 1,    live: 'add' },
  'echo.time':     { label: 'Echo Time',    unit: 's',  amt: 0.02, max: 0.5,  live: 'add',   needs: 'echo' },
  'echo.feedback': { label: 'Echo Fdbk',    unit: '',   amt: 0.5,  max: 1,    live: 'fb',    needs: 'echo' },
  'noise.rate':    { label: 'Noise Rate',   unit: '',   amt: 0.3,  max: 2,    live: 'add',   needs: 'noise' },
  'sub.level':     { label: 'Sub Level',    unit: '',   amt: 0.5,  max: 1,    live: 'add',   needs: 'sub' },
  'fold.amount':   { label: 'Folds',        unit: '',   amt: 1,    max: 3,    live: 'fold',  needs: 'fold' },
  'ring.freq':     { label: 'Ring Freq',    unit: 'ct', amt: 1200, max: 4800, live: 'cents', needs: 'ring' },
  'eq.freq':       { label: 'EQ Mid',       unit: 'ct', amt: 1200, max: 4800, live: 'cents', needs: 'eq' },
  'phaser.rate':   { label: 'Phase Rate',   unit: 'Hz', amt: 1,    max: 10,   live: 'add',   needs: 'phaser' },
  'phaser.freq':   { label: 'Phase Freq',   unit: 'ct', amt: 1200, max: 4800, live: 'cents', needs: 'phaser' },
  'chorus.rate':   { label: 'Chorus Rate',  unit: 'Hz', amt: 1,    max: 10,   live: 'add',   needs: 'chorus' },
  'chorus.depth':  { label: 'Chorus Depth', unit: '',   amt: 0.5,  max: 1,    live: 'add',   needs: 'chorus' },
};
function rackTargetInfo(param) {
  const m = /^mod\.(.+)\.(rate|amount)$/.exec(param);
  if (m) return m[2] === 'rate'
    ? { label: m[1] + ' Rate', unit: 'Hz', amt: 2, max: 40, live: 'add' }
    : { label: m[1] + ' Depth', unit: '', amt: 0.5, max: 1, live: 'add' };
  return RACK_TARGETS[param] || { label: param, unit: '', amt: 1, max: 10, live: 'add' };
}
// What a cable's sum does to the knob that owns its jack, in that knob's units:
// the same arithmetic buildLayer does with the cable's gain.
function rackLiveValue(kind, base, s) {
  if (kind === 'cents') return base * Math.pow(2, s / 1200);
  if (kind === 'mul') return base * (1 + s);
  if (kind === 'fb') return base + s * Math.max(0, 0.95 - base);
  if (kind === 'fold') return ((1 + 5 * base) * (1 + s) - 1) / 5;
  return base + s;
}

const RACK_WAVES = ['sine', 'triangle', 'square', 'sawtooth'];
const RACK_FILTERS = ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking', 'lowshelf', 'highshelf'];

// A knob: p is the path inside its scope, jack the mod target it takes a cable on.
const K = (p, label, min, max, def, o = {}) => ({ p, label, min, max, def, ...o });
// How much of a layer is noise, as the engine reads it.
const rackNoiseMix = (l) => l.noiseMix ?? (l.waveform === 'noise' ? 1 : 0);
const rackRingFixed = (l) => l.ring?.freq > 0 && !(l.ring?.ratio > 0);

// A switch is buttons for `opts`, each storing its `vals` entry (the opt itself
// when there are no vals). An undefined val deletes the key, so the engine's own
// default stays implicit; `def` is what lights when the key is absent or holds
// something the switch doesn't offer. `read`/`set` take over for a switch that
// isn't one key.
const RACK_UNITS = [
  { key: 'osc', label: 'Oscillator', fam: 'source', group: 'Sources', source: true, display: 'wave',
    has: (l) => rackNoiseMix(l) < 1,
    knobs: [K('freq', 'Freq', 20, 8000, 440, { curve: 'log', unit: 'Hz' }), K('detune', 'Detune', -1200, 1200, 0, { unit: 'ct', jack: 'pitch' })],
    switches: [{ p: 'waveform', opts: RACK_WAVES, def: 'square' }] },
  { key: 'sub', label: 'Sub Oscillator', fam: 'source', group: 'Sources', owns: ['sub'], needs: 'osc', display: 'sub',
    make: () => ({ sub: { level: 0.6, octave: 1, wave: 'sine' } }),
    knobs: [K('sub.level', 'Level', 0, 1, 0.5, { jack: 'sub.level' })],
    switches: [{ p: 'sub.octave', opts: ['-1 oct', '-2 oct'], vals: [1, 2], def: 1 }, { p: 'sub.wave', opts: ['sine', 'triangle', 'square'], def: 'sine' }] },
  { key: 'noise', label: 'Noise', fam: 'source', group: 'Sources', source: true, owns: ['noiseMix', 'noise', 'noiseRate', 'width'], display: 'noise',
    has: (l) => rackNoiseMix(l) > 0,
    knobs: [K('noiseMix', 'Mix', 0, 1, 0.5, { lock: true }), K('noiseRate', 'Rate', 0.1, 2, 1, { jack: 'noise.rate' }), K('width', 'Width', 0, 1, 0)],
    switches: [{ p: 'noise', opts: ['white', 'pink', 'brown'], def: 'white' }] },
  { key: 'fm', label: 'FM Operator 1', fam: 'fm', group: 'FM', owns: ['fm'], needs: 'osc', display: 'fmspec', make: () => ({ fm: { ratio: 2, index: 1, wave: 'sine' } }),
    knobs: [K('fm.ratio', 'Ratio', 0.25, 16, 2, { curve: 'log', jack: 'fm.ratio' }), K('fm.index', 'Index', 0, 20, 1, { jack: 'fm.index' }),
      K('fm.indexEnd', 'Index End', 0, 20, 1), K('fm.time', 'Sweep', 0.01, 4, 0.2, { curve: 'log', unit: 's' }), K('fm.bright', 'Bright', 0, 4, 0)],
    switches: [{ p: 'fm.wave', opts: RACK_WAVES, def: 'sine' }] },
  { key: 'op2', label: 'FM Operator 2', fam: 'fm', group: 'FM', owns: ['fm.op2'], needs: 'fm', display: 'fmspec2', make: () => ({ 'fm.op2': { ratio: 3, index: 0.5, wave: 'sine' } }),
    knobs: [K('fm.op2.ratio', 'Ratio', 0.25, 16, 3, { curve: 'log', jack: 'op2.ratio' }), K('fm.op2.index', 'Index', 0, 20, 0.5, { jack: 'op2.index' }),
      K('fm.op2.indexEnd', 'Index End', 0, 20, 0.5)],
    switches: [{ p: 'fm.op2.wave', opts: RACK_WAVES, def: 'sine' }] },
  { key: 'bend', label: 'Pitch Bend', fam: 'motion', group: 'Pitch', owns: ['pitchBend'], needs: 'osc', display: 'bend', make: (l) => ({ pitchBend: { to: (l.freq || 440) * 2, time: 0.3 } }),
    knobs: [K('pitchBend.to', 'To', 20, 8000, 880, { curve: 'log', unit: 'Hz' }), K('pitchBend.time', 'Time', 0.01, 4, 0.3, { curve: 'log', unit: 's' })] },
  // the forms write a zero-rate vibrato and tremolo onto everything; SIREN skips those, and so does the rack
  { key: 'vibrato', label: 'Vibrato', fam: 'motion', group: 'Pitch', owns: ['vibrato'], needs: 'osc', display: 'vib', has: (l) => l.vibrato?.rate > 0, make: () => ({ vibrato: { rate: 5, depth: 10 } }),
    knobs: [K('vibrato.rate', 'Rate', 0.05, 40, 5, { curve: 'log', unit: 'Hz' }), K('vibrato.depth', 'Depth', 0, 200, 10, { unit: 'ct' })] },
  { key: 'amp', label: 'Amp Envelope', fam: 'amp', group: null, fixed: true, display: 'adsr', has: () => true,
    knobs: [K('adsr.a', 'Attack', 0.001, 4, 0.01, { curve: 'log', unit: 's' }), K('adsr.d', 'Decay', 0.001, 4, 0.05, { curve: 'log', unit: 's' }),
      K('adsr.s', 'Sustain', 0, 1, 0.7), K('adsr.r', 'Release', 0.005, 6, 0.15, { curve: 'log', unit: 's' }), K('gain', 'Level', 0, 1.5, 1, { jack: 'amp' })],
    switches: [{ p: 'adsr.curve', opts: ['lin', 'exp'], vals: [undefined, 'exp'] }] },
  { key: 'drive', label: 'Drive', fam: 'shape', group: 'Tone', owns: ['drive', 'driveType'], display: 'xfer', make: () => ({ drive: 0.3 }),
    knobs: [K('drive', 'Drive', 0, 1, 0.3)],
    switches: [{ p: 'driveType', opts: ['soft', 'hard', 'tube', 'fuzz'], vals: [undefined, 'hard', 'tube', 'fuzz'] }] },
  { key: 'fold', label: 'Wavefolder', fam: 'shape', group: 'Tone', owns: ['fold'], display: 'xfer', make: () => ({ fold: { amount: 0.4 } }),
    knobs: [K('fold.amount', 'Folds', 0, 1, 0.5, { jack: 'fold.amount' })] },
  { key: 'ring', label: 'Ring Modulator', fam: 'shape', group: 'Tone', owns: ['ring'], display: 'ring', make: () => ({ ring: { ratio: 1.5, mix: 1 } }),
    knobs: (l) => [rackRingFixed(l)
      ? K('ring.freq', 'Freq', 1, 8000, 300, { curve: 'log', unit: 'Hz', jack: 'ring.freq' })
      : K('ring.ratio', 'Ratio', 0.1, 16, 1.5, { curve: 'log', unit: '×', jack: 'ring.freq' }), K('ring.mix', 'Mix', 0, 1, 1)],
    switches: [
      { p: 'ring.mode', opts: ['note', 'fixed'], read: (l) => (rackRingFixed(l) ? 'fixed' : 'note'),
        set: (l, v) => {
          const f0 = l.freq || 440, rc = (l.ring ||= {});
          if (v === 'fixed' && !rackRingFixed(l)) { rc.freq = Math.round((rc.ratio || 1.5) * f0); delete rc.ratio; }
          else if (v === 'note' && rackRingFixed(l)) { rc.ratio = +((rc.freq || 660) / f0).toFixed(3); delete rc.freq; }
        } },
      { p: 'ring.wave', opts: RACK_WAVES, def: 'sine' }] },
  { key: 'filter', label: 'Filter', fam: 'shape', group: 'Tone', owns: ['filter'], clash: 'formants', display: 'filter', make: () => ({ filter: { type: 'lowpass', freq: 2000, q: 1 } }),
    knobs: [K('filter.freq', 'Cutoff', 20, 18000, 2000, { curve: 'log', unit: 'Hz', jack: 'filter.cutoff' }), K('filter.q', 'Reso', 0.1, 30, 1, { curve: 'log', jack: 'filter.q' }),
      K('filter.to', 'Sweep To', 20, 18000, 2000, { curve: 'log', unit: 'Hz' }), K('filter.time', 'Sweep', 0.01, 4, 0.2, { curve: 'log', unit: 's' }), K('filter.gain', 'Gain', -24, 24, 0, { unit: 'dB' })],
    switches: [{ p: 'filter.type', opts: RACK_FILTERS, def: 'lowpass' }] },
  { key: 'formants', label: 'Formant Bank', fam: 'shape', group: 'Tone', owns: ['formants'], clash: 'filter', display: 'filter', make: () => ({ formants: [700, 1220, 2600] }),
    knobs: (l) => (Array.isArray(l.formants) ? l.formants : []).slice(0, 5).map((f, i) =>
      K(typeof f === 'object' ? `formants.${i}.freq` : `formants.${i}`, `F${i + 1}`, 80, 6000, 1000, { curve: 'log', unit: 'Hz' })) },
  { key: 'eq', label: '3-Band EQ', fam: 'shape', group: 'Tone', owns: ['eq'], display: 'eq', make: () => ({ eq: { low: 3, mid: -2, high: 2, midFreq: 1000 } }),
    knobs: [K('eq.low', 'Low', -24, 24, 0, { unit: 'dB' }), K('eq.mid', 'Mid', -24, 24, 0, { unit: 'dB' }), K('eq.midFreq', 'Mid Freq', 80, 12000, 1000, { curve: 'log', unit: 'Hz', jack: 'eq.freq' }),
      K('eq.q', 'Mid Q', 0.2, 8, 0.9, { curve: 'log' }), K('eq.high', 'High', -24, 24, 0, { unit: 'dB' })] },
  { key: 'comp', label: 'Compressor', fam: 'dyn', group: 'Dynamics', owns: ['comp'], display: 'comp', make: () => ({ comp: { threshold: -24, ratio: 4, attack: 0.005, release: 0.15, makeup: 6 } }),
    knobs: [K('comp.threshold', 'Thresh', -60, 0, -24, { unit: 'dB' }), K('comp.ratio', 'Ratio', 1, 20, 4, { curve: 'log' }), K('comp.attack', 'Attack', 0.0005, 1, 0.005, { curve: 'log', unit: 's' }),
      K('comp.release', 'Release', 0.01, 1, 0.15, { curve: 'log', unit: 's' }), K('comp.knee', 'Knee', 0, 40, 6, { unit: 'dB' }), K('comp.makeup', 'Makeup', -12, 24, 0, { unit: 'dB' })] },
  { key: 'tremolo', label: 'Tremolo', fam: 'motion', group: 'Motion', owns: ['tremolo'], display: 'trem', has: (l) => l.tremolo?.rate > 0, make: () => ({ tremolo: { rate: 6, depth: 0.3 } }),
    knobs: [K('tremolo.rate', 'Rate', 0.05, 40, 6, { curve: 'log', unit: 'Hz' }), K('tremolo.depth', 'Depth', 0, 1, 0.3)] },
  { key: 'phaser', label: 'Phaser', fam: 'fx', group: 'Motion', owns: ['phaser'], display: 'phaser', make: () => ({ phaser: { rate: 0.5, depth: 0.7, freq: 800, stages: 4, mix: 0.5 } }),
    knobs: [K('phaser.rate', 'Rate', 0.02, 10, 0.5, { curve: 'log', unit: 'Hz', jack: 'phaser.rate' }), K('phaser.depth', 'Depth', 0, 1, 0.7),
      K('phaser.freq', 'Center', 100, 8000, 800, { curve: 'log', unit: 'Hz', jack: 'phaser.freq' }), K('phaser.mix', 'Mix', 0, 1, 0.5)],
    switches: [{ p: 'phaser.stages', opts: ['2', '4', '6', '8', '12'], vals: [2, 4, 6, 8, 12], def: 4 }] },
  { key: 'chorus', label: 'Chorus / Flanger', fam: 'fx', group: 'Motion', owns: ['chorus'], display: 'chorus', make: () => ({ chorus: { rate: 0.8, depth: 0.3, delay: 0.015, mix: 0.5 } }),
    knobs: [K('chorus.rate', 'Rate', 0.02, 10, 0.8, { curve: 'log', unit: 'Hz', jack: 'chorus.rate' }), K('chorus.depth', 'Depth', 0, 1, 0.3, { jack: 'chorus.depth' }),
      K('chorus.delay', 'Delay', 0.0005, 0.05, 0.015, { curve: 'log', unit: 's' }), K('chorus.feedback', 'Feedback', 0, 0.9, 0), K('chorus.mix', 'Mix', 0, 1, 0.5)] },
  { key: 'echo', label: 'Echo', fam: 'space', group: 'Space', owns: ['echo'], display: 'echo', make: () => ({ echo: { mix: 0.3, delay: 0.18, feedback: 0.35 } }),
    knobs: [K('echo.mix', 'Mix', 0, 1, 0.3), K('echo.delay', 'Time', 0.01, 2, 0.18, { curve: 'log', unit: 's', jack: 'echo.time' }), K('echo.feedback', 'Feedback', 0, 0.95, 0.35, { jack: 'echo.feedback' })] },
  { key: 'pan', label: 'Pan', fam: 'space', group: 'Space', owns: ['pan'], display: 'pan', make: () => ({ pan: 0 }),
    knobs: [K('pan', 'Pan', -1, 1, 0, { jack: 'pan' })] },
];
// How long the cue sounds, for fitting a new modulator's rate to it.
function rackCueLength(r) {
  if (!r) return 0.4;
  if (r.tab === 'instruments') return 0.6;
  return r.cue?.duration ?? (r.tab === 'ambient' ? 3 : 0.4);
}
// A first rate that gets `cycles` round inside the cue, so a fresh modulator on a
// short hit is heard moving rather than caught a quarter of the way through.
function rackFitRate(r, cycles, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(cycles / Math.max(0.05, rackCueLength(r)))));
}
// Modulators: any number per layer, each an entry in layer.mods.
const RACK_MODS = {
  lfo:  { label: 'LFO', make: (r) => ({ wave: 'sine', rate: rackFitRate(r, 3, 2, 12) }),
    knobs: [K('rate', 'Rate', 0.05, 40, 2, { curve: 'log', unit: 'Hz', jack: 'rate' }), K('fade', 'Fade In', 0, 4, 0, { unit: 's' })],
    switches: [{ p: 'wave', opts: RACK_WAVES, def: 'sine' }] },
  env:  { label: 'Envelope', make: () => ({ a: 0.005, d: 0.3, s: 0, r: 0.2 }),
    knobs: [K('a', 'Attack', 0.001, 4, 0.005, { curve: 'log', unit: 's' }), K('d', 'Decay', 0.001, 4, 0.3, { curve: 'log', unit: 's' }),
      K('s', 'Sustain', 0, 1, 0), K('r', 'Release', 0.005, 6, 0.2, { curve: 'log', unit: 's' })],
    switches: [{ p: 'curve', opts: ['lin', 'exp'], vals: [undefined, 'exp'] }] },
  rand: { label: 'Random', make: (r) => ({ rate: rackFitRate(r, 6, 4, 24), seed: 1 }),
    knobs: [K('rate', 'Rate', 0.05, 60, 6, { curve: 'log', unit: 'Hz' }), K('seed', 'Seed', 1, 99, 1, { step: 1 })],
    switches: [{ p: 'smooth', opts: ['step', 'glide'], vals: [undefined, true] }] },
  seq:  { label: 'Sequencer', make: (r) => ({ rate: rackFitRate(r, 8, 4, 24), steps: [0, 0.5, 0.25, 0.75, 0, 0.5, -0.25, 0.25] }),
    knobs: [K('rate', 'Rate', 0.5, 40, 8, { curve: 'log', unit: '/s' })],
    switches: [
      { p: 'steps', opts: ['4', '8', '16'], vals: [4, 8, 16], read: (m) => (m.steps || []).length,
        set: (m, n) => { const s = (m.steps || []).slice(0, n); while (s.length < n) s.push(s[s.length % Math.max(1, (m.steps || []).length)] ?? 0); m.steps = s; } },
      { p: 'glide', opts: ['step', 'glide'], vals: [undefined, true] },
      { p: 'snap', opts: ['free', 'semi'], vals: [undefined, 12] }] },
};
// Cue units: one each, on the cue rather than a layer.
const RACK_CUE_UNITS = [
  { key: 'master', label: 'Master', fixed: true, has: () => true, display: 'vu',
    knobs: [K('duration', 'Length', 0.05, 20, 0.4, { curve: 'log', unit: 's' }), K('send', 'Reverb', 0, 1, 1)] },
  { key: 'retro', label: 'Retro Crusher', owns: ['retro'], display: 'crush', make: () => ({ retro: { rate: 11025, bits: 8 } }),
    knobs: [K('retro.rate', 'Rate', 1000, 48000, 11025, { curve: 'log', unit: 'Hz', step: 1 }), K('retro.bits', 'Bits', 1, 16, 8, { step: 1 })] },
  { key: 'duck', label: 'Ducker', owns: ['duck'], display: 'duck', make: () => ({ duck: { buses: ['ambient'], dB: -9, attack: 0.03, release: 0.5 } }),
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

// The units a layer shows, in signal order, each marked on or switched off.
function rackUnitsOf(layer) {
  const by = layer.rack?.bypass || {};
  return RACK_UNITS.filter(u => rackHas(layer, u) || by[u.key]).map(u => ({ key: u.key, on: rackHas(layer, u) && !by[u.key] }));
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
  if (!u || u.fixed) return 'always in the rack';
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

// ── The two sources' power switches ──
// The oscillator and the noise share one crossfade, `noiseMix`, so switching one
// off can't just take its keys away. The first one off keeps what was authored in
// rack.bypass._src; while either is off the crossfade is derived from which are
// on (all noise, no noise, or `mute` when neither), and with both back on the
// authored value returns exactly.
function rackSourceDerive(layer) {
  const by = layer.rack?.bypass, src = by?._src;
  if (!src) return;
  rackSet(layer, 'noiseMix', rackClone(src.noiseMix));
  rackSet(layer, 'mute', src.mute);
  if (!by.osc && !by.noise) { delete by._src; return; }
  const nm = rackNoiseMix(layer);
  const osc = nm < 1 && !by.osc, noise = nm > 0 && !by.noise;
  if (!osc && !noise) layer.mute = true;
  else if (!noise) layer.noiseMix = 0;
  else if (!osc) layer.noiseMix = 1;
}
function rackSourceToggle(layer, key) {
  const by = layer.rack?.bypass || {};
  if (!by[key] && !rackHas(layer, rackUnit(key))) return false;
  const b = ((layer.rack ||= {}).bypass ||= {});
  if (!b._src) b._src = { noiseMix: layer.noiseMix, mute: layer.mute };
  if (b[key]) delete b[key]; else b[key] = {};
  rackSourceDerive(layer);
  return true;
}
function rackSourcesOn(layer) {
  const b = layer.rack?.bypass;
  if (!b?._src) return;
  delete b.osc; delete b.noise;
  rackSourceDerive(layer);
}

// Add a unit. Returns the mod id for a modulator, true for anything else, or a
// reason string when it can't.
function rackAdd(r, li, key) {
  const why = rackCanAdd(r, li, key);
  if (why) return why;
  const layer = r.layers[li];
  if (RACK_MODS[key]) {
    const id = rackNewModId(layer, key);
    (layer.mods ||= []).push({ id, type: key, ...RACK_MODS[key].make(r), to: [] });
    return id;
  }
  const cu = RACK_CUE_UNITS.find(u => u.key === key);
  if (cu) { for (const [p, v] of Object.entries(cu.make())) rackSet(r.cue, p, v); return true; }
  if (key === 'osc' || key === 'noise') {
    rackSourcesOn(layer);
    if (key === 'osc' && layer.waveform === 'noise') layer.waveform = 'sawtooth';
    layer.noiseMix = 0.5;
    return true;
  }
  for (const [p, v] of Object.entries(rackUnit(key).make(layer))) rackSet(layer, p, v);
  return true;
}

// Take a unit out. `stash` keeps it in layer.rack.bypass so the power switch can
// put it back as it was; without it the unit is gone.
function rackPull(r, li, key, stash) {
  const layer = r.layers[li];
  if (key.startsWith('mod:')) {
    const id = key.slice(4);
    const i = (layer.mods || []).findIndex(m => m.id === id);
    if (i < 0) return false;
    const [m] = layer.mods.splice(i, 1);
    if (stash) rackSet(layer, `rack.bypass.${key}`, m);
    else rackForgetMod(layer, id);
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
  if (!u || u.fixed) return false;
  if (u.source) {
    if (stash) return rackSourceToggle(layer, key);
    // taken out for good: both sources back on first, then the crossfade decides
    rackSourcesOn(layer);
    const nm = rackNoiseMix(layer);
    if (key === 'osc') {
      if (nm <= 0) return false;                       // the last source stays
      layer.noiseMix = 1;
      return true;
    }
    if (nm >= 1) return false;
    for (const p of u.owns) rackSet(layer, p, undefined);
    if (layer.waveform === 'noise') layer.waveform = 'square';   // what the engine was playing for it
    return true;
  }
  const saved = {};
  for (const p of u.owns) { saved[p] = rackClone(rackGet(layer, p)); rackSet(layer, p, undefined); }
  if (stash) rackSet(layer, `rack.bypass.${key}`, saved);
  return true;
}
// Nothing may keep a cable into a mod that no longer exists, switched on or off.
function rackForgetMod(layer, id) {
  const all = [...(layer.mods || []), ...Object.entries(layer.rack?.bypass || {}).filter(([k]) => k.startsWith('mod:')).map(([, m]) => m)];
  for (const o of all) o.to = (o.to || []).filter(c => !c.param.startsWith(`mod.${id}.`));
  if (layer.rack?.colors) delete layer.rack.colors[id];
}
const rackRemove = (r, li, key) => {
  const layer = r.layers[li];
  if (rackUnit(key)?.source) return rackPull(r, li, key, false);
  if (layer.rack?.bypass?.[key]) {
    delete layer.rack.bypass[key];
    if (key.startsWith('mod:')) rackForgetMod(layer, key.slice(4));
    return true;
  }
  if (r.cueBypass[key]) { delete r.cueBypass[key]; return true; }
  return rackPull(r, li, key, false);
};

// The power switch: switch a unit off, or back on.
function rackBypass(r, li, key) {
  const layer = r.layers[li];
  if (rackUnit(key)?.source) return rackSourceToggle(layer, key);
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

// Why a jack does nothing right now, in words for the toast.
function rackDeadWhy(layer, param) {
  if (layer.mute) return 'this layer is switched off at its sources';
  const info = rackTargetInfo(param), u = info.needs && rackUnit(info.needs);
  if (!u) return `${info.label} isn't live on this layer`;
  if (layer.rack?.bypass?.[u.key]) return `${u.label} is switched off`;
  if (!rackHas(layer, u)) return `${info.label} needs ${u.label} in the rack`;
  if ((param === 'filter.cutoff' || param === 'filter.q') && Array.isArray(layer.formants) && layer.formants.length) return 'the Formant Bank is standing in for the filter';
  if (u.needs && !rackHas(layer, rackUnit(u.needs))) return `${u.label} has no ${rackUnit(u.needs).label} to work on`;
  return `${info.label} isn't live on this layer`;
}

// A cable from mod `id` into `param`. One cable per pair: patching again sets its amount.
function rackPatch(r, li, id, param, amount) {
  const layer = r.layers[li];
  const m = rackMod(layer, id);
  if (!m) return layer.rack?.bypass?.[`mod:${id}`] ? `${id} is switched off` : 'no such mod';
  const mm = /^mod\.(.+)\.(rate|amount)$/.exec(param);
  if (mm) {
    if (mm[1] === id) return 'a mod can\'t patch itself';
    if (!rackMod(layer, mm[1])) return layer.rack?.bypass?.[`mod:${mm[1]}`] ? `${mm[1]} is switched off` : 'no such mod';
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
  else if (!rackLiveTargets(layer).has(param)) return rackDeadWhy(layer, param);
  m.to ||= [];
  const c = m.to.find(x => x.param === param);
  const amt = Number.isFinite(amount) ? amount : rackTargetInfo(param).amt;
  if (c) c.amount = amt; else m.to.push({ param, amount: amt });
  return true;
}
function rackUnpatch(r, li, id, param) {
  const layer = r.layers[li];
  const m = rackMod(layer, id) || layer.rack?.bypass?.[`mod:${id}`];
  if (!m?.to) return false;
  const n = m.to.length;
  m.to = m.to.filter(c => c.param !== param);
  return m.to.length !== n;
}

// Which jacks in a layer are live: its stages decide what a cable can reach,
// the same tests buildLayer makes before it builds each one.
function rackLiveTargets(layer) {
  const live = new Set();
  if (layer.mute || (layer.modes && !layer.waveform)) return live;
  const nm = rackNoiseMix(layer), osc = nm < 1;
  if (osc) live.add('pitch');
  if (osc && layer.fm && (layer.fm.ratio || layer.fm.rate)) { live.add('fm.index'); live.add('fm.ratio'); }
  if (osc && layer.fm?.op2 && (layer.fm.op2.ratio || layer.fm.op2.rate)) { live.add('op2.index'); live.add('op2.ratio'); }
  if (osc && layer.sub?.level > 0) live.add('sub.level');
  if (nm > 0) live.add('noise.rate');
  if (layer.fold) live.add('fold.amount');
  if (layer.ring && (layer.ring.ratio > 0 || layer.ring.freq > 0)) live.add('ring.freq');
  if (layer.filter && !(Array.isArray(layer.formants) && layer.formants.length)) { live.add('filter.cutoff'); live.add('filter.q'); }
  if (layer.eq) live.add('eq.freq');
  if (layer.phaser) { live.add('phaser.rate'); live.add('phaser.freq'); }
  if (layer.chorus) { live.add('chorus.rate'); live.add('chorus.depth'); }
  if (layer.echo?.mix > 0) { live.add('echo.time'); live.add('echo.feedback'); }
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
  rack: null, li: 0, view: 'front', cables: true, loop: false, auto: true, mains: true, warm: false,
  mute: new Set(), solo: null, undo: [], redo: [], dirty: false, loopT: null, held: null, keys: new Map(),
  meter: null, raf: 0, sway: null,
  // what the probes heard this frame: each mod's output, each jack's sum, the compressor's reduction
  probes: [], live: { vals: {}, sums: {}, comp: null }, playing: false, busy: false, now: 0, t0: 0,
  vu: { v: 0, peak: 0 }, glow: 0, notes: new Set(),
};
const RACK_FAM_COLOR = { source: 'var(--cyan)', fm: 'var(--purple)', amp: 'var(--text-bright)', shape: 'var(--orange)', dyn: 'var(--red)',
  motion: 'var(--green)', fx: '#6ea8ff', space: 'var(--yellow)', cue: 'var(--accent)' };
const RACK_CABLE_COLORS = ['#ff3b5c', '#ffb020', '#3ddc84', '#29b6f6', '#c86bff', '#ff7ad9', '#f4f4f4', '#9be15d'];
const RACK_SHORT = { sawtooth: 'saw', triangle: 'tri', lowpass: 'LP', highpass: 'HP', bandpass: 'BP', notch: 'NT', peaking: 'PK', lowshelf: 'LS', highshelf: 'HS' };
const _rkEsc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rackClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rackSnap = () => JSON.stringify({ cue: _rk.rack.cue, layers: _rk.rack.layers, cb: _rk.rack.cueBypass });

function rackLayer() { return _rk.rack?.layers[_rk.li]; }
function rackCableColor(layer, id) {
  const set = layer.rack?.colors?.[id];
  if (set) return set;
  const all = [...(layer.mods || []).map(m => m.id), ...Object.keys(layer.rack?.bypass || {}).filter(k => k.startsWith('mod:')).map(k => k.slice(4))];
  const i = Math.max(0, all.indexOf(id));
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
  const before = rackSnap();
  const res = fn();
  const after = rackSnap();
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
function rackUndo() { if (!_rk.undo.length) return; _rk.redo.push(rackSnap()); rackRestore(_rk.undo.pop()); }
function rackRedo() { if (!_rk.redo.length) return; _rk.undo.push(rackSnap()); rackRestore(_rk.redo.pop()); }

// ── Rendering ────────────────────────────────────────────────────────────────

function renderRack(body) {
  body.innerHTML = '<div id="rk-root" class="rk-root" tabindex="0"></div>';
  rackRender();
}

function rackRender() {
  const root = document.getElementById('rk-root');
  if (!root) return;
  document.querySelectorAll('.rk-pop').forEach(p => p.remove());
  if (!_rk.rack) { root.innerHTML = rackPickerHtml(); return; }
  const r = _rk.rack, layer = rackLayer();
  // a redraw keeps the rack scrolled where it was
  const keepTop = document.getElementById('rk-stack')?.scrollTop || 0;
  const keepBrowser = root.querySelector('.rk-browser')?.scrollTop || 0;
  _rkSw.length = 0;
  const offMods = Object.entries(layer.rack?.bypass || {}).filter(([k]) => k.startsWith('mod:'));
  let i = 0;
  root.innerHTML = RACK_KNOB_DEFS + `
    <aside class="rk-browser">${rackBrowserHtml()}</aside>
    <section class="rk-main">
      ${rackHeadHtml()}
      ${rackSplitHtml()}
      <div class="rk-stack rk-view-${_rk.view}${_rk.cables ? '' : ' rk-nocables'}${_rk.flipIn ? ' rk-flipin' : ''}${_rk.mains ? '' : ' rk-mains-off'}${_rk.warm ? ' rk-warmup' : ''}" id="rk-stack">
        <div class="rk-rail-note">signal flows down &middot; drag between OUT and IN jacks, or click a jack for a list</div>
        ${rackUnitsOf(layer).map(u => rackUnitHtml(rackUnit(u.key), layer, u.on, 'layer', i++)).join('')}
        <div class="rk-divider"><span>Modulation</span></div>
        ${(layer.mods || []).map(m => rackModHtml(layer, m, true, i++)).join('')}
        ${offMods.map(([, m]) => rackModHtml(layer, m, false, i++)).join('')}
        ${(layer.mods || []).length || offMods.length ? '' : '<div class="rk-empty">Drag an LFO, Envelope, Random or Sequencer in from the left, then drag its OUT jack to any knob with a jack (or click OUT and pick from the list).</div>'}
        <div class="rk-divider"><span>Cue</span></div>
        ${rackCueUnitsOf(r).map(u => rackUnitHtml(rackUnit(u.key), r.cue, u.on, 'cue', i++)).join('')}
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
  requestAnimationFrame(() => { rackDrawCables(); rackDrawDisplays(); rackLiveKnobs(); });
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

const RACK_GROUPS = ['Sources', 'FM', 'Pitch', 'Tone', 'Dynamics', 'Motion', 'Space', 'Modulators', 'Cue'];
function rackBrowserHtml() {
  const r = _rk.rack;
  const groups = Object.fromEntries(RACK_GROUPS.map(g => [g, []]));
  for (const u of RACK_UNITS) if (u.group) groups[u.group].push({ key: u.key, label: u.label, fam: u.fam });
  groups.Modulators = Object.entries(RACK_MODS).map(([k, m]) => ({ key: k, label: m.label, fam: 'motion', multi: true }));
  groups.Cue = RACK_CUE_UNITS.filter(u => !u.fixed).map(u => ({ key: u.key, label: u.label, fam: 'cue' }));
  return `<div class="rk-browser-head">COMPONENTS</div>` + RACK_GROUPS.map(g => `
    <div class="rk-group"><div class="rk-group-name">${g}</div>
      ${groups[g].map(it => {
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
    const src = l.mute ? 'off' : rackNoiseMix(l) >= 1 ? `${l.noise || 'white'} noise` : `${RACK_SHORT[l.waveform] || l.waveform || 'square'} ${Math.round(l.freq || 440)}Hz`;
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
  sub:      { brand: 'ORBITAL FORGE', model: 'Floor Plan', code: 'SUB-2', finish: 'graphite', knob: 'chrome' },
  noise:    { brand: 'HISSWORKS', model: 'Static Cling', code: 'NG-2', finish: 'black', knob: 'cap' },
  fm:       { brand: 'DEVIATION LABS', model: 'Ratio Grande', code: 'FM-1', finish: 'cream', knob: 'bakelite' },
  op2:      { brand: 'DEVIATION LABS', model: 'Ratio Grande Expander', code: 'FM-2X', finish: 'cream', knob: 'bakelite' },
  bend:     { brand: 'SLIDE RULE', model: 'Whammy Clause', code: 'PB-7', finish: 'black', knob: 'cap' },
  vibrato:  { brand: 'MOTIONWORKS', model: 'Wobble Act', code: 'VB-5', finish: 'military', knob: 'chicken' },
  amp:      { brand: 'HOLLOWAY & SONS', model: 'Envelope Pusher', code: 'ADSR-4', finish: 'tolex', knob: 'chicken' },
  drive:    { brand: 'CLIPJOINT', model: 'Tube Strangler', code: 'OD-1', finish: 'red', knob: 'chicken' },
  fold:     { brand: 'ORIGAMI AUDIO', model: 'Crease Fire', code: 'WF-6', finish: 'seafoam', knob: 'bakelite' },
  ring:     { brand: 'BELL & HOWLER', model: 'Ring Leader', code: 'RM-1', finish: 'graphite', knob: 'chrome' },
  filter:   { brand: 'RESONANT CIVIC', model: 'Cutoff Point', code: 'Mk II', finish: 'brushed', knob: 'chrome' },
  formants: { brand: 'RESONANT CIVIC', model: 'Throat Clearer', code: 'FB-5', finish: 'cream', knob: 'bakelite' },
  eq:       { brand: 'RESONANT CIVIC', model: 'Level Headed', code: 'EQ-3', finish: 'brushed', knob: 'cap' },
  comp:     { brand: 'SQUEEZE PLAY', model: 'Peak Season', code: 'CL-76', finish: 'black', knob: 'chrome' },
  tremolo:  { brand: 'MOTIONWORKS', model: 'Shaky Grounds', code: 'TR-3', finish: 'military', knob: 'chicken' },
  phaser:   { brand: 'MOTIONWORKS', model: 'Phase Off', code: 'PH-90', finish: 'orange', knob: 'chicken' },
  chorus:   { brand: 'HARMONY HALL', model: 'Chorus Line', code: 'CF-2', finish: 'seafoam', knob: 'cap' },
  echo:     { brand: 'TAPE & DELAY', model: 'Return to Sender', code: 'DD-180', finish: 'wood', knob: 'bakelite' },
  pan:      { brand: 'SPLIT DECISION', model: 'Left Field', code: 'PN-1', finish: 'black', knob: 'cap' },
  lfo:      { brand: 'MOTIONWORKS', model: 'Swing Vote', code: 'LFO-6', finish: 'blue', knob: 'cap' },
  env:      { brand: 'HOLLOWAY & SONS', model: 'Rise & Fall', code: 'EG-2', finish: 'blue', knob: 'cap' },
  rand:     { brand: 'LOADED DICE', model: 'Snake Eyes', code: 'S&H-1', finish: 'blue', knob: 'cap' },
  seq:      { brand: 'COUNTING HOUSE', model: 'Step Function', code: 'SQ-16', finish: 'blue', knob: 'cap' },
  master:   { brand: 'ORBITAL FORGE', model: 'Last Word', code: 'MX-1', finish: 'brushed', knob: 'chrome' },
  retro:    { brand: 'BIT ROT', model: 'Crumble Ware', code: 'BC-8', finish: 'military', knob: 'chicken' },
  duck:     { brand: 'SPLIT DECISION', model: 'Duck & Cover', code: 'DK-2', finish: 'black', knob: 'cap' },
};
const rackSkin = (key) => RACK_SKINS[key] || { brand: 'NO BRAND', model: key, code: '', finish: 'black', knob: 'cap' };
// A serial that stays the same for a unit, so the plate doesn't change on every redraw.
function rackHash(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
const rackSerial = (s) => String(rackHash(s) % 900000 + 100000);
function rackPlateHtml(skin, label) {
  return `<span class="rk-badge">${_rkEsc(skin.brand)}</span>
    <span class="rk-model">${_rkEsc(skin.model)}</span>
    <span class="rk-code">${_rkEsc(skin.code)}</span>
    <span class="rk-uname">${label}</span>`;
}
const rackPlateTail = (serialKey) => `<span class="rk-vents"></span><span class="rk-serial">S/N ${rackSerial(serialKey)}</span>`;

// ── Decoration and switches ──────────────────────────────────────────────────
// What each unit carries besides its knobs. Every switch does something:
//   power    switches the unit off (and back on); its faceplate stays, dark
//   standby  the amp's: takes this layer out of the preview, saving nothing
//   mains    the master's: the whole rack off, silent and dark, saving nothing
//   roll     a push-button that throws the random's dice again (a new seed)
//   {p, vals, legend}  a two-way toggle bound to a real key (SLOPE, HEADS)
// and tubes glow with the output level, the lamp flashes at a modulator's rate.
const RACK_DECO = {
  osc:      { exhaust: true, switches: [['POWER', 'power']] },
  sub:      { switches: [['POWER', 'power']] },
  noise:    { grill: 'perf', switches: [['POWER', 'power']] },
  fm:       { grill: 'perf', switches: [['POWER', 'power']] },
  op2:      { switches: [['POWER', 'power']] },
  bend:     { switches: [['POWER', 'power']] },
  vibrato:  { exhaust: true, switches: [['POWER', 'power']] },
  amp:      { tubes: 3, grill: 'cloth', switches: [['STANDBY', 'standby']] },
  drive:    { tubes: 1, switches: [['POWER', 'power']] },
  fold:     { grill: 'perf', switches: [['POWER', 'power']] },
  ring:     { exhaust: true, switches: [['POWER', 'power']] },
  filter:   { exhaust: true, switches: [['POWER', 'power'], ['SLOPE', { p: 'filter.slope', vals: [undefined, 24], legend: ['24', '12'] }]] },
  formants: { grill: 'perf', switches: [['POWER', 'power']] },
  eq:       { switches: [['POWER', 'power']] },
  comp:     { tubes: 1, switches: [['POWER', 'power']] },
  tremolo:  { exhaust: true, switches: [['POWER', 'power']] },
  phaser:   { switches: [['POWER', 'power']] },
  chorus:   { switches: [['POWER', 'power']] },
  echo:     { tubes: 2, switches: [['POWER', 'power'], ['HEADS', { p: 'echo.heads', vals: [undefined, 2], legend: ['2', '1'] }]] },
  pan:      { switches: [['POWER', 'power']] },
  lfo:      { blink: true, switches: [['POWER', 'power']] },
  env:      { switches: [['POWER', 'power']] },
  rand:     { blink: true, switches: [['ROLL', 'roll'], ['POWER', 'power']] },
  seq:      { blink: true, switches: [['POWER', 'power']] },
  master:   { grill: 'perf', switches: [['MAINS', 'mains']] },
  retro:    { exhaust: true, switches: [['POWER', 'power']] },
  duck:     { switches: [['POWER', 'power']] },
};
// The switch specs of the last render, by index, for the click handler.
const _rkSw = [];
function rackToggleHtml(label, kind, unitKey, on, bypassKey, obj, scope) {
  if (kind === 'mains') {
    return `<span class="rk-rocker${_rk.mains ? ' on' : ''}" data-mains="1" title="Mains: the whole rack off. Nothing plays and nothing saved changes">
      <span class="rk-rocker-body"><i></i></span><label>${_rkEsc(label)}</label></span>`;
  }
  if (kind === 'roll') {
    return `<span class="rk-push" data-roll="${_rkEsc(unitKey)}" title="Roll the dice: a new seed"><i></i><label>${_rkEsc(label)}</label></span>`;
  }
  let up, attrs, legend;
  if (kind === 'power') { up = on; attrs = bypassKey ? `data-bypass="${bypassKey}"` : ''; legend = ['ON', 'OFF']; }
  else if (kind === 'standby') { up = !_rk.mute.has(_rk.li); attrs = 'data-standby="1"'; legend = ['PLAY', 'STBY']; }
  else {
    const id = _rkSw.push(kind) - 1;
    up = rackGet(obj, kind.p) === kind.vals[1];
    attrs = `data-bind="${id}" data-bscope="${scope}"`;
    legend = kind.legend;
  }
  return `<span class="rk-sw${up ? ' up' : ''}${kind === 'power' ? ' rk-sw-power' : ''}" ${attrs} title="${_rkEsc(label)}">
    <span class="rk-sw-leg">${_rkEsc(legend[0])}</span><span class="rk-sw-body"><i></i></span><span class="rk-sw-leg">${_rkEsc(legend[1])}</span>
    <label>${_rkEsc(label)}</label></span>`;
}
function rackDecoHtml(kind, unitKey, on, bypassKey, obj, scope) {
  const d = RACK_DECO[kind];
  if (!d) return '';
  let h = '';
  if (d.exhaust) h += '<span class="rk-exhaust"><i></i></span>';
  if (d.grill) h += `<span class="rk-grill rk-grill-${d.grill}"></span>`;
  if (d.tubes) h += `<span class="rk-tubes">${'<span class="rk-tube"><i></i></span>'.repeat(d.tubes)}</span>`;
  if (d.blink) h += `<span class="rk-lamp" style="animation-duration:${(1 / rackClamp(obj?.rate || 2, 0.05, 40)).toFixed(3)}s" title="flashes at the rate"></span>`;
  if (d.switches) h += `<span class="rk-switches">${d.switches.map(([l, k]) => rackToggleHtml(l, k, unitKey, on, bypassKey, obj, scope)).join('')}</span>`;
  return `<div class="rk-deco">${h}</div>`;
}
// A switch's click: a short tick and a snap, on the interface bus.
function rackClick() {
  window.AudioEngine?.playSfx({ id: '_rack_click', category: 'ui', priority: 2, config: { duration: 0.03, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 3800, q: 3 }, adsr: { a: 0.0005, d: 0.018, s: 0, r: 0.01 }, gain: 0.35 },
    { waveform: 'square', freq: 1900, adsr: { a: 0.0005, d: 0.006, s: 0, r: 0.004 }, gain: 0.12 },
  ] } });
}
// The mains: a heavier clunk, and on the way up the transformer's hum swelling in.
function rackThunk(up) {
  window.AudioEngine?.playSfx({ id: '_rack_mains', category: 'ui', priority: 2, config: { duration: up ? 0.5 : 0.08, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 900, q: 1 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 }, gain: 0.5 },
    ...(up ? [{ waveform: 'sine', freq: 50, adsr: { a: 0.25, d: 0.2, s: 0.4, r: 0.3 }, gain: 0.18, filter: { type: 'lowpass', freq: 400, q: 0.7 } }] : []),
  ] } });
}

// ── Knobs ────────────────────────────────────────────────────────────────────

// The knob style the next knobs are drawn in: set by the unit while it renders them.
let _rkKs = 'cap';

// A rotary in SVG: tick marks round a 270° scale, the value arc (from the
// centre on a bipolar knob), the reach of any cables patched into it, a dot that
// rides the cables while the patch plays, and a knob drawn in its unit's style.
function rackKnobSvg(n, bipolar, size = 46, style = 'cap', mod = null) {
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
      <circle cx="${c}" cy="${c}" r="${kr}" fill="url(#rk-g-cap)"/>
      <g transform="${rot}"><line x1="${c}" y1="${c - kr * 0.3}" x2="${c}" y2="${c - kr + 1.5}" class="rk-k-ptr"/></g>`;
  }
  let modded = '';
  if (mod) {
    const [dx, dy] = pt(a0, R - 5.5);
    modded = `<path class="rk-k-range" d="${arc(a0 + mod.lo * sweep, a0 + mod.hi * sweep, R + 0.6)}" style="stroke:${mod.color}"/>
      <circle class="rk-k-live" cx="${dx.toFixed(2)}" cy="${dy.toFixed(2)}" r="${big ? 3.2 : 2.5}" style="fill:${mod.color}" transform="rotate(${(n * sweep).toFixed(1)} ${c} ${c})"/>`;
  }
  return `<svg viewBox="-2 -2 ${size + 4} ${size + 4}" width="${size + 4}" height="${size + 4}" class="rk-ks-${style}">
    <path class="rk-k-ticks" d="${ticks}"/>
    <path class="rk-k-track" d="${arc(a0, a0 + sweep, R - 5.5)}"/>
    <path class="rk-k-val" d="${arc(from, at, R - 5.5)}"/>
    ${knob}${modded}
  </svg>`;
}
// The gradients the knobs fill with, defined once for the page.
const RACK_KNOB_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <radialGradient id="rk-g-chrome" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.35" stop-color="#c9ccd3"/><stop offset="0.7" stop-color="#6d7079"/><stop offset="1" stop-color="#2c2e33"/></radialGradient>
  <radialGradient id="rk-g-dome" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#fafbfd"/><stop offset="0.6" stop-color="#a9adb6"/><stop offset="1" stop-color="#5d6068"/></radialGradient>
  <radialGradient id="rk-g-cream" cx="40%" cy="30%" r="85%"><stop offset="0" stop-color="#fffaf0"/><stop offset="0.55" stop-color="#e6dcc3"/><stop offset="1" stop-color="#8d826a"/></radialGradient>
  <radialGradient id="rk-g-bake" cx="40%" cy="30%" r="85%"><stop offset="0" stop-color="#4a4a4f"/><stop offset="0.5" stop-color="#16161a"/><stop offset="1" stop-color="#000"/></radialGradient>
  <radialGradient id="rk-g-cap" cx="40%" cy="28%" r="80%"><stop offset="0" stop-color="rgba(255,255,255,0.22)"/><stop offset="0.5" stop-color="rgba(255,255,255,0.04)"/><stop offset="1" stop-color="rgba(0,0,0,0.35)"/></radialGradient>
</defs></svg>`;

// The reach of the cables in `jackParam`, in the knob's own 0..1: an LFO, random
// or sequencer swings both ways, an envelope only the way its amount points.
function rackKnobModRange(jackParam, k, v) {
  const layer = rackLayer();
  if (!jackParam || !layer) return null;
  const patched = rackCablesInto(layer, jackParam);
  if (!patched.length || !rackLiveTargets(layer).has(jackParam)) return null;
  let lo = 0, hi = 0;
  for (const { id, c } of patched) {
    const bi = rackMod(layer, id)?.type !== 'env', a = c.amount || 0;
    lo += bi ? -Math.abs(a) : Math.min(0, a);
    hi += bi ? Math.abs(a) : Math.max(0, a);
  }
  const kind = rackTargetInfo(jackParam).live;
  return { lo: rackNorm(k, rackLiveValue(kind, v, lo)), hi: rackNorm(k, rackLiveValue(kind, v, hi)), color: rackCableColor(layer, patched[0].id) };
}
function rackKnobHtml(k, obj, scope, jackParam, small, o = {}) {
  const layer = rackLayer();
  const v = rackKnobValue(obj, k);
  const n = rackNorm(k, v);
  const patched = jackParam ? rackCablesInto(layer, jackParam) : [];
  const live = jackParam ? rackLiveTargets(layer).has(jackParam) : false;
  const mod = o.off ? null : rackKnobModRange(jackParam, k, v);
  const ring = patched.length ? `style="--ring:${rackCableColor(layer, patched[0].id)}"` : '';
  const jack = jackParam ? `<span class="rk-jack rk-jack-in${patched.length ? ' rk-patched' : ''}${live ? '' : ' rk-dead'}" data-jack-in="${jackParam}" title="${_rkEsc(rackTargetInfo(jackParam).label)} IN: drag to an OUT, or click for a list"></span>` : '';
  const ks = small ? 'cap' : _rkKs;
  return `<div class="rk-knob${small ? ' rk-small' : ''}${patched.length ? ' rk-modded' : ''}${o.off ? ' rk-knob-off' : ''}" ${ring} data-scope="${scope}" data-path="${k.p}" data-ks="${ks}"
      data-min="${k.min}" data-max="${k.max}" data-def="${k.def}" data-curve="${k.curve || ''}" data-step="${k.step || ''}" data-unit="${k.unit || ''}"${jackParam ? ` data-live="${jackParam}" data-lk="${rackTargetInfo(jackParam).live}"` : ''}
      title="${_rkEsc(k.label)}: drag up or down, Shift for fine, double-click to reset">
    <div class="rk-k-svg">${rackKnobSvg(n, k.min < 0, small ? 34 : 50, ks, mod)}</div>
    <div class="rk-lcd">${rackFmt(v, k.unit)}</div>
    <label>${k.label}</label>${jack}
  </div>`;
}
function rackSwitchHtml(s, obj, scope, off) {
  const vals = s.vals || s.opts;
  const cur = s.read ? s.read(obj) : rackGet(obj, s.p);
  const same = (a, b) => a === b || (a != null && b != null && String(a) === String(b));
  let at = vals.findIndex(v => same(v, cur));
  if (at < 0) at = Math.max(0, vals.findIndex(v => same(v, s.def ?? vals[0])));
  const id = _rkSw.push(s) - 1;
  return `<div class="rk-switch${off ? ' rk-switch-off' : ''}" data-scope="${scope}" data-sw="${id}">
    ${s.opts.map((o, i) => `<button class="${i === at ? 'on' : ''}" data-i="${i}">${_rkEsc(RACK_SHORT[o] || o)}</button>`).join('')}
  </div>`;
}

// What a switched-off unit shows: the values it'll come back with.
function rackViewOf(scope, key, obj) {
  const v = rackClone(obj);
  const u = rackUnit(key);
  if (u?.source) {
    const src = obj.rack?.bypass?._src;
    if (src) { rackSet(v, 'noiseMix', rackClone(src.noiseMix)); rackSet(v, 'mute', src.mute); }
    return v;
  }
  const held = scope === 'cue' ? _rk.rack.cueBypass[key] : obj.rack?.bypass?.[key];
  if (held) for (const [p, val] of Object.entries(held)) rackSet(v, p, rackClone(val));
  return v;
}

function rackUnitHtml(u, obj, on, scope, i = 0) {
  const fam = scope === 'cue' ? 'cue' : u.fam;
  const view = on ? obj : rackViewOf(scope, u.key, obj);
  const knobs = rackKnobsOf(u, view);
  const inert = scope === 'layer' && on && u.needs === 'osc' && !(rackHas(obj, rackUnit('osc')) && !obj.rack?.bypass?.osc && !obj.mute);
  const skin = rackSkin(u.key);
  _rkKs = skin.knob;
  // while a source is off its crossfade belongs to the power switches
  const locked = u.source && obj.rack?.bypass?._src;
  const sw = (u.switches || []).map(s => rackSwitchHtml(s, view, scope, !on)).join('');
  const kn = knobs.map(k => rackKnobHtml(k, view, scope, scope === 'layer' ? k.jack : null, false, { off: !on || (k.lock && locked) })).join('');
  const rear = scope === 'layer' ? knobs.filter(k => k.jack).map(k => rackRearJack(k.jack)).join('') : '';
  const led = u.key === 'master' ? _rk.mains : on;
  return `<div class="rk-unit rk-fam-${fam} rk-fin-${skin.finish}${on ? '' : ' rk-unit-off'}${inert ? ' rk-inert' : ''}" style="--fam:${RACK_FAM_COLOR[fam]};--i:${i}" data-unit="${u.key}" data-uscope="${scope}">
    <div class="rk-ear"><i></i><i></i></div>
    <div class="rk-plate">
      <span class="rk-led${led ? ' on' : ''}" ${u.fixed ? '' : `data-bypass="${u.key}"`} title="${u.fixed ? 'always on' : on ? 'Switch off' : 'Switch on'}"></span>
      ${rackPlateHtml(skin, u.label)}
      ${inert ? '<span class="rk-tag">NO OSCILLATOR</span>' : ''}${on ? '' : '<span class="rk-tag rk-tag-off">POWER OFF</span>'}
      <span class="rk-spacer"></span>
      ${rackPlateTail(`${_rk.li}:${u.key}`)}
      ${u.fixed ? '' : `<span class="rk-x" data-remove="${u.key}" title="Remove">✕</span>`}
    </div>
    <div class="rk-face">${sw}${u.display ? rackScreenHtml(u.display) : ''}<div class="rk-knobs">${kn}</div>${rackDecoHtml(u.key, u.key, on, u.fixed ? null : u.key, view, scope)}</div>
    <div class="rk-rear">${rear || `<span class="rk-dim">${scope === 'cue' ? 'cue-wide: no inputs' : 'no inputs'}</span>`}</div>
    <div class="rk-ear"><i></i><i></i></div>
  </div>`;
}
function rackRearJack(param) {
  const layer = rackLayer();
  const patched = rackCablesInto(layer, param);
  return `<div class="rk-rear-jack"><span class="rk-jack rk-jack-in rk-big${patched.length ? ' rk-patched' : ''}${rackLiveTargets(layer).has(param) ? '' : ' rk-dead'}" data-jack-in="${param}" title="${_rkEsc(rackTargetInfo(param).label)} IN"></span><label>${_rkEsc(rackTargetInfo(param).label)}</label></div>`;
}
function rackCablesInto(layer, param) {
  const out = [];
  for (const m of layer?.mods || []) for (const c of m.to || []) if (c.param === param) out.push({ id: m.id, c });
  return out;
}

function rackModHtml(layer, m, on, i = 0) {
  const def = RACK_MODS[m.type];
  if (!def) return '';
  const key = `mod:${m.id}`, color = rackCableColor(layer, m.id), scope = `mod:${m.id}`;
  const skin = rackSkin(m.type);
  _rkKs = skin.knob;
  const knobs = def.knobs.map(k => rackKnobHtml(k, m, scope, k.jack === 'rate' ? `mod.${m.id}.rate` : null, false, { off: !on })).join('');
  const depthIn = `mod.${m.id}.amount`;
  const depthJack = `<span class="rk-jack rk-jack-in${rackCablesInto(layer, depthIn).length ? ' rk-patched' : ''}${on ? '' : ' rk-dead'}" data-jack-in="${depthIn}" title="Depth IN"></span>`;
  const outJack = (big) => `<span class="rk-jack rk-jack-out${big ? ' rk-big' : ''}${on ? '' : ' rk-dead'}" data-jack-out="${m.id}" style="--cc:${color}" title="OUT: drag to any IN jack, or click for a list"></span>`;
  const cables = (m.to || []).map((c) => {
    const info = rackTargetInfo(c.param);
    const k = K('amount', info.label, -info.max, info.max, info.amt, { unit: info.unit });
    return `<div class="rk-cable-row" data-cable="${m.id}|${c.param}">
      <span class="rk-cdot" style="background:${color}"></span>
      ${rackKnobHtml(k, c, `cable:${m.id}|${c.param}`, null, true, { off: !on })}
      <span class="rk-x" data-unpatch="${m.id}|${c.param}" title="Unplug">✕</span>
    </div>`;
  }).join('');
  return `<div class="rk-unit rk-fam-motion rk-mod rk-fin-${skin.finish}${on ? '' : ' rk-unit-off'}" style="--fam:${color};--i:${i}" data-unit="${key}" data-mod="${m.id}">
    <div class="rk-ear"><i></i><i></i></div>
    <div class="rk-plate">
      <span class="rk-grip" data-grip="${m.id}" title="Drag to reorder">⋮⋮</span>
      <span class="rk-led${on ? ' on' : ''}" data-bypass="${key}" title="${on ? 'Switch off' : 'Switch on'}"></span>
      ${rackPlateHtml(skin, `${def.label} <b>${_rkEsc(m.id)}</b>`)}
      ${on ? '' : '<span class="rk-tag rk-tag-off">POWER OFF</span>'}
      <span class="rk-spacer"></span>
      ${rackPlateTail(`${_rk.li}:${m.id}`)}
      <span class="rk-depth">DEPTH ${depthJack}</span>
      <span class="rk-out">OUT ${outJack(false)}</span>
      <span class="rk-x" data-remove="${key}" title="Remove">✕</span>
    </div>
    <div class="rk-face">
      ${(def.switches || []).map(s => rackSwitchHtml(s, m, scope, !on)).join('')}
      ${rackScreenHtml(m.type === 'seq' ? 'seq' : 'mod')}
      <div class="rk-knobs">${knobs}</div>
      <div class="rk-cablelist">${cables || '<span class="rk-dim">unpatched: drag OUT to a jack, or click OUT for a list</span>'}</div>
      ${rackDecoHtml(m.type, m.id, on, key, m, scope)}
    </div>
    <div class="rk-rear"><div class="rk-rear-jack">${outJack(true)}<label>OUT</label></div>
      ${m.type === 'lfo' ? rackRearJack(`mod.${m.id}.rate`) : ''}${rackRearJack(depthIn)}</div>
    <div class="rk-ear"><i></i><i></i></div>
  </div>`;
}

// ── The keyboard ─────────────────────────────────────────────────────────────
// Two octaves from C3, the same two the letter keys play: Z to M is the lower,
// Q to U the upper. A key goes down while it's held, by the mouse or the letter.
const RACK_KEYMAP = { KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24 };
const RACK_KEYCAP = {};
for (const [code, semi] of Object.entries(RACK_KEYMAP)) if (!RACK_KEYCAP[semi]) RACK_KEYCAP[semi] = code.replace(/^Key|^Digit/, '').replace('Comma', ',');
const rackNoteHz = (semi) => 130.81 * Math.pow(2, semi / 12);
function rackKeyboardHtml() {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const whites = [], blacks = [];
  let w = 0;
  for (let s = 0; s <= 24; s++) {
    const black = [1, 3, 6, 8, 10].includes(s % 12);
    const down = _rk.notes.has(s) ? ' down' : '';
    const cap = RACK_KEYCAP[s] ? `<em>${RACK_KEYCAP[s]}</em>` : '';
    const name = `${names[s % 12]}${3 + Math.floor(s / 12)}`;
    if (black) blacks.push(`<span class="rk-key rk-key-b${down}" data-semi="${s}" style="left:calc(${w} * var(--kw) - var(--bw) / 2)" title="${name}">${cap}</span>`);
    else { whites.push(`<span class="rk-key rk-key-w${down}" data-semi="${s}" title="${name}">${cap}${s % 12 === 0 ? `<b>${name}</b>` : ''}</span>`); w++; }
  }
  return `<div class="rk-keys" id="rk-keys" style="--whites:${w}">${whites.join('')}${blacks.join('')}</div>`;
}
// Show a key down or up without redrawing the rack.
function rackKeyLight(semi, down) {
  if (down) _rk.notes.add(semi); else _rk.notes.delete(semi);
  document.querySelector(`#rk-keys [data-semi="${semi}"]`)?.classList.toggle('down', down);
}

function rackTransportHtml() {
  const kb = _rk.rack.tab === 'instruments' ? 'plays the note' : 'transposes the patch';
  return `<div class="rk-transport">
    <div class="rk-tp-row">
      <button class="rk-tbtn rk-play" onclick="rackAudition(true)" title="Play (Space)">▶</button>
      <button class="rk-tbtn" id="rk-hold" title="Hold to sustain">HOLD</button>
      <button class="rk-tbtn${_rk.loop ? ' on' : ''}" onclick="rackToggleLoop()" title="Play over and over">⟲ LOOP</button>
      <button class="rk-tbtn${_rk.auto ? ' on' : ''}" onclick="_rk.auto=!_rk.auto;rackRender()" title="Play again after every edit">AUTO</button>
      <button class="rk-tbtn" onclick="rackStop()" title="Stop">■</button>
      <span class="rk-glass rk-screen"><canvas id="rk-scope" class="rk-scope" data-w="240" data-h="44" width="240" height="44" style="width:240px;height:44px"></canvas></span>
      <span class="rk-glass rk-screen"><canvas id="rk-spectrum" class="rk-scope" data-w="190" data-h="44" width="190" height="44" style="width:190px;height:44px"></canvas></span>
      <div class="rk-meter" title="Peak level"><i id="rk-meter-bar"></i></div>
      ${_rk.mains ? '' : '<span class="rk-mains-note">RACK OFF AT THE MAINS: switch it on on the Master</span>'}
    </div>
    <div class="rk-tp-row rk-tp-keys">
      ${rackKeyboardHtml()}
      <span class="rk-dim rk-keys-hint">Click or hold a key, or play Z–M and Q–U: the keyboard ${kb} · Shift plays harder</span>
    </div>
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
    if (t.closest('[data-mains]')) { rackMains(); return; }
    const by = t.closest('[data-bypass]');
    if (by) {
      const u = rackUnit(by.dataset.bypass);
      if (u?.fixed) return;
      rackClick();
      const ok = rackEdit(() => rackBypass(_rk.rack, _rk.li, by.dataset.bypass));
      if (ok === false) toast?.('Nothing to switch', true);
      return;
    }
    const rm = t.closest('[data-remove]');
    if (rm) { rackEdit(() => { const ok = rackRemove(_rk.rack, _rk.li, rm.dataset.remove); if (!ok) toast?.('A layer needs at least one source: switch it off instead', true); }); return; }
    const up = t.closest('[data-unpatch]');
    if (up) { const [id, p] = up.dataset.unpatch.split('|'); rackEdit(() => rackUnpatch(_rk.rack, _rk.li, id, p)); return; }
    const sw = t.closest('.rk-switch button');
    if (sw) {
      const box = sw.parentElement, s = _rkSw[+box.dataset.sw], obj = rackObj(box.dataset.scope);
      if (!s || !obj || box.classList.contains('rk-switch-off')) return;
      const v = (s.vals || s.opts)[+sw.dataset.i];
      rackEdit(() => (s.set ? s.set(obj, v) : rackSet(obj, s.p, rackClone(v))));
      return;
    }
    const bind = t.closest('[data-bind]');
    if (bind) {
      const s = _rkSw[+bind.dataset.bind], obj = rackObj(bind.dataset.bscope);
      if (!s || !obj || bind.closest('.rk-unit-off')) return;
      rackClick();
      rackEdit(() => rackSet(obj, s.p, rackGet(obj, s.p) === s.vals[1] ? s.vals[0] : s.vals[1]));
      return;
    }
    const roll = t.closest('[data-roll]');
    if (roll) {
      const m = rackMod(rackLayer(), roll.dataset.roll);
      if (!m) return;
      rackClick();
      rackEdit(() => { let s; do s = 1 + Math.floor(Math.random() * 99); while (s === m.seed); m.seed = s; });
      return;
    }
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
    if (knob && !knob.classList.contains('rk-knob-off')) {
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
    const key = e.target.closest('[data-semi]');
    if (key) { rackKeyPointer(e, key); return; }
    const out = under('[data-jack-out]');
    if (out) { rackCableDrag(e, { out: out.dataset.jackOut }); return; }
    const seq = e.target.closest('canvas[data-display="seq"]');
    if (seq) { rackSeqEdit(e, seq); return; }
    const inj = under('[data-jack-in]');
    if (inj && !inj.closest('.rk-knob-off')) {
      const into = rackCablesInto(rackLayer(), inj.dataset.jackIn);
      const last = into[into.length - 1];
      // a patched jack: pick up its newest cable and carry it elsewhere; an empty
      // one: draw a cable from it to an OUT
      if (last) rackCableDrag(e, { out: last.id, from: inj.dataset.jackIn });
      else rackCableDrag(e, { in: inj.dataset.jackIn });
      return;
    }
    const knob = e.target.closest('.rk-knob');
    if (knob && !knob.classList.contains('rk-knob-off')) { rackKnobDrag(e, knob); return; }
    const grip = e.target.closest('[data-grip]');
    if (grip) { rackModReorder(e, grip.dataset.grip); return; }
  };
  root.onwheel = (e) => {
    const knob = e.target.closest('.rk-knob');
    if (!knob || knob.classList.contains('rk-knob-off')) return;
    e.preventDefault();
    const k = rackKnobSpec(knob), obj = rackObj(knob.dataset.scope);
    if (!obj) return;
    const n = rackNorm(k, rackKnobValue(obj, k)) + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.002 : 0.02);
    rackEdit(() => rackSet(obj, k.p, rackDenorm(k, n)), { render: false });
    rackRefreshKnob(knob);
    rackDrawDisplays();
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
  el.querySelector('.rk-k-svg').innerHTML = rackKnobSvg(rackNorm(k, v), k.min < 0, el.classList.contains('rk-small') ? 34 : 50, el.dataset.ks, rackKnobModRange(el.dataset.live, k, v));
  el.querySelector('.rk-lcd').textContent = rackFmt(v, k.unit);
}
// Relative drag: the knob moves by how far the pointer moves, and stays where it was left.
function rackKnobDrag(e, el) {
  e.preventDefault();
  const k = rackKnobSpec(el), obj = rackObj(el.dataset.scope);
  if (!obj) return;
  const before = rackSnap();
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

// The mains. Off, the rack goes dark and silent and the notes held are let go;
// on, it warms up, top to bottom. It's the editor's switch: nothing saved changes.
function rackMains() {
  _rk.mains = !_rk.mains;
  rackThunk(_rk.mains);
  if (!_rk.mains) {
    _rk.loop = false; clearTimeout(_rk.loopT);
    for (const h of _rk.keys.values()) h?.release?.();
    _rk.keys.clear();
    _rk.held?.release?.(); _rk.held = null;
    _rk.notes.clear();
  } else {
    _rk.warm = true;
    clearTimeout(_rk.warmT);
    _rk.warmT = setTimeout(() => { _rk.warm = false; document.getElementById('rk-stack')?.classList.remove('rk-warmup'); }, 1800);
  }
  rackRender();
}

// ── Cables ───────────────────────────────────────────────────────────────────

function rackJackPos(stack, el) {
  const s = stack.getBoundingClientRect(), r = el.getBoundingClientRect();
  return [r.left + r.width / 2 - s.left + stack.scrollLeft, r.top + r.height / 2 - s.top + stack.scrollTop];
}
// The jack a cable draws to: the big one on the back, the small one on the front.
function rackJackEl(stack, dir, key) {
  const sel = dir === 'out' ? `[data-jack-out="${CSS.escape(key)}"]` : `[data-jack-in="${CSS.escape(key)}"]`;
  return stack.querySelector(_rk.view === 'rear' ? `${sel}.rk-big` : `${sel}:not(.rk-big)`) || stack.querySelector(sel);
}
// A cable hangs: both ends leave sideways and the middle droops by its span. Each
// cable's own weight (`seed`) varies the droop a little, so a bundle isn't one line.
function rackCablePath(a, b, sway = 0, seed = 0.5) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const span = Math.hypot(dx, dy);
  const sag = Math.min(170, 30 + span * 0.28) * (1 + sway) * (0.85 + seed * 0.3);
  const side = Math.max(30, Math.min(90, Math.abs(dx) * 0.4 + 30)) * (0.9 + seed * 0.2);
  const c1 = [a[0] + side, a[1] + sag], c2 = [b[0] + side, b[1] + sag * 0.6];
  return { d: `M${a[0].toFixed(1)} ${a[1].toFixed(1)} C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`, c1, c2 };
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
    const live = rackLiveTargets(layer);
    const all = [...(layer.mods || []).map(m => [m, true]),
      ...Object.entries(layer.rack?.bypass || {}).filter(([k]) => k.startsWith('mod:')).map(([, m]) => [m, false])];
    for (const [m, on] of all) {
      const from = rackJackEl(stack, 'out', m.id);
      if (!from) continue;
      for (const c of m.to || []) {
        if (extra?.skip && extra.skip.id === m.id && extra.skip.param === c.param) continue;
        const to = rackJackEl(stack, 'in', c.param);
        if (!to) continue;
        const a = rackJackPos(stack, from), b = rackJackPos(stack, to);
        const sway = _rk.sway && _rk.sway.id === m.id && _rk.sway.param === c.param ? _rk.sway.v : 0;
        html += rackCableSvg(a, b, rackCableColor(layer, m.id), `${m.id}|${c.param}`, !on || !live.has(c.param), false, sway, m.id);
      }
    }
  }
  if (extra?.temp) html += rackCableSvg(extra.temp.a, extra.temp.b, extra.temp.color, '', false, true, 0, '');
  svg.innerHTML = html;
  svg.querySelectorAll('[data-wire]').forEach(p => {
    p.onclick = (e) => rackCablePopover(e, p.dataset.wire);
    p.oncontextmenu = (e) => { e.preventDefault(); const [id, param] = p.dataset.wire.split('|'); rackEdit(() => rackUnpatch(_rk.rack, _rk.li, id, param)); };
  });
  rackLiveWires();
}
// A jack plug: the knurled nut, the coloured cap, a glint.
const rackPlugSvg = ([x, y]) => `<g class="rk-plug" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle class="rk-plug-nut" r="7.5"/><circle class="rk-plug-cap" r="5"/><circle class="rk-plug-hi" cx="-1.7" cy="-1.9" r="1.5"/></g>`;
function rackCableSvg(a, b, color, wire, dead, temp, sway = 0, src = '') {
  const { d, c1, c2 } = rackCablePath(a, b, sway, wire ? (rackHash(wire) % 1000) / 1000 : 0.5);
  // the boots: a stiff sleeve where the cable leaves each plug, along its first run
  const boot = (p, q) => { const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, k = 11 / L; return `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${(p[0] + (q[0] - p[0]) * k).toFixed(1)} ${(p[1] + (q[1] - p[1]) * k).toFixed(1)}`; };
  return `<g class="rk-wire${dead ? ' rk-wire-dead' : ''}${temp ? ' rk-wire-temp' : ''}"${src ? ` data-src="${_rkEsc(src)}"` : ''} style="--cc:${color}">
    <path class="rk-wire-shadow" d="${d}"/>
    <path class="rk-wire-edge" d="${d}"/>
    <path class="rk-wire-body" d="${d}"/>
    <path class="rk-wire-sig" d="${d}"/>
    <path class="rk-wire-shine" d="${d}"/>
    <path class="rk-wire-boot" d="${boot(a, c1)}${boot(b, c2)}"/>
    ${wire ? `<path class="rk-wire-hit" d="${d}" data-wire="${wire}"><title>${_rkEsc(rackTargetInfo(wire.split('|')[1]).label)}: click for the amount, right-click to unplug</title></path>` : ''}
    ${rackPlugSvg(a)}${rackPlugSvg(b)}
  </g>`;
}
// Drag a cable. `start` is { out } for a new cable from a mod's OUT, { in } for one
// from an empty IN to an OUT, or { out, from } to carry the cable already in `from`
// somewhere else (or nowhere: dropped on nothing, it's unplugged). A press that
// doesn't move is a click, and opens the jack's list instead. Near the top or
// bottom of the rack it scrolls, so any jack is in reach.
function rackCableDrag(e, start) {
  e.preventDefault();
  const stack = document.getElementById('rk-stack');
  const layer = rackLayer();
  const fromEl = start.out ? rackJackEl(stack, 'out', start.out) : rackJackEl(stack, 'in', start.in);
  if (!fromEl) return;
  const color = start.out ? rackCableColor(layer, start.out) : '#dfe3ea';
  const keep = start.from ? (rackMod(layer, start.out)?.to || []).find(c => c.param === start.from)?.amount : undefined;
  const skip = start.from ? { id: start.out, param: start.from } : null;
  const x0 = e.clientX, y0 = e.clientY;
  let px = x0, py = y0, moved = false, raf = 0;
  stack.classList.add('rk-patching');
  if (start.out) {
    const live = rackLiveTargets(layer);
    stack.querySelectorAll('[data-jack-in]').forEach(j => { const p = j.dataset.jackIn; if (live.has(p) && p !== `mod.${start.out}.rate` && p !== `mod.${start.out}.amount`) j.classList.add('rk-can'); });
  } else stack.querySelectorAll('[data-jack-out]').forEach(j => { if (rackMod(layer, j.dataset.jackOut)) j.classList.add('rk-can'); });
  const draw = () => {
    const s = stack.getBoundingClientRect();
    rackDrawCables({ skip, temp: { a: rackJackPos(stack, fromEl), b: [px - s.left + stack.scrollLeft, py - s.top + stack.scrollTop], color } });
  };
  const edge = () => {
    if (moved) {
      const s = stack.getBoundingClientRect(), zone = 48;
      const v = py < s.top + zone ? -(s.top + zone - py) : py > s.bottom - zone ? py - (s.bottom - zone) : 0;
      if (v) { stack.scrollTop += Math.sign(v) * Math.min(26, Math.abs(v) * 0.4); draw(); }
    }
    raf = requestAnimationFrame(edge);
  };
  const move = (ev) => { px = ev.clientX; py = ev.clientY; if (Math.hypot(px - x0, py - y0) > 4) moved = true; if (moved) draw(); };
  const up = (ev) => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    stack.classList.remove('rk-patching');
    stack.querySelectorAll('.rk-can').forEach(j => j.classList.remove('rk-can'));
    if (!moved) { rackDrawCables(); rackPatchMenu(ev.clientX, ev.clientY, start.from ? { in: start.from } : start); return; }
    const hits = document.elementsFromPoint(ev.clientX, ev.clientY);
    let id = start.out, param = null;
    if (start.out) param = hits.map(el => el.closest?.('[data-jack-in]')).find(Boolean)?.dataset.jackIn || null;
    else { id = hits.map(el => el.closest?.('[data-jack-out]')).find(Boolean)?.dataset.jackOut || null; param = id ? start.in : null; }
    if (start.from && param === start.from) { rackDrawCables(); return; }
    let msg = null;
    rackEdit(() => {
      if (start.from) rackUnpatch(_rk.rack, _rk.li, start.out, start.from);
      if (id && param) { const r = rackPatch(_rk.rack, _rk.li, id, param, keep); if (r !== true) msg = r; }
    });
    if (msg) toast?.(msg, true);
    else if (id && param) rackSway(id, param);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  raf = requestAnimationFrame(edge);
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
function rackPopAt(pop, x, y) {
  document.getElementById('rk-root').appendChild(pop);
  const r = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(6, Math.min(innerWidth - r.width - 6, x + 8))}px`;
  pop.style.top = `${Math.max(6, Math.min(innerHeight - r.height - 6, y - 20))}px`;
  const close = (ev) => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('pointerdown', close, true); } };
  setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
}
// A jack's list: from an OUT, every jack on the layer it can go to; from an IN,
// every modulator that can feed it. A ticked one is patched; a click toggles it.
function rackPatchMenu(x, y, start) {
  document.querySelectorAll('.rk-pop').forEach(p => p.remove());
  const layer = rackLayer(), live = rackLiveTargets(layer);
  const pop = document.createElement('div');
  pop.className = 'rk-pop rk-menu';
  let head, items = '';
  if (start.out) {
    const m = rackMod(layer, start.out);
    if (!m) { toast?.(`${start.out} is switched off`, true); return; }
    head = `<span class="rk-cdot" style="background:${rackCableColor(layer, m.id)}"></span>${_rkEsc(m.id)} OUT → patch into`;
    const groups = [];
    for (const u of rackUnitsOf(layer)) {
      const def = rackUnit(u.key);
      const jacks = rackKnobsOf(def, layer).filter(k => k.jack).map(k => k.jack);
      if (jacks.length) groups.push([def.label, jacks]);
    }
    for (const o of layer.mods || []) if (o.id !== m.id) groups.push([`${RACK_MODS[o.type]?.label || o.type} ${o.id}`, [...(o.type === 'lfo' ? [`mod.${o.id}.rate`] : []), `mod.${o.id}.amount`]]);
    items = groups.map(([g, js]) => `<div class="rk-menu-g">${_rkEsc(g)}</div>` + js.map(p => {
      const on = (m.to || []).some(c => c.param === p);
      return `<button class="rk-menu-i${on ? ' on' : ''}${live.has(p) ? '' : ' dead'}" data-mpatch="${m.id}|${p}">${on ? '●' : '○'} ${_rkEsc(rackTargetInfo(p).label)}</button>`;
    }).join('')).join('');
  } else {
    const p = start.in;
    head = `${_rkEsc(rackTargetInfo(p).label)} IN ← patch from`;
    items = (layer.mods || []).filter(m => `mod.${m.id}.rate` !== p && `mod.${m.id}.amount` !== p).map(m => {
      const on = (m.to || []).some(c => c.param === p);
      return `<button class="rk-menu-i${on ? ' on' : ''}" data-mpatch="${m.id}|${p}"><span class="rk-cdot" style="background:${rackCableColor(layer, m.id)}"></span> ${on ? '●' : '○'} ${_rkEsc(RACK_MODS[m.type]?.label || m.type)} ${_rkEsc(m.id)}</button>`;
    }).join('') || '<div class="rk-dim">no modulators yet: add an LFO, Envelope, Random or Sequencer from the left</div>';
    if (!live.has(p)) items = `<div class="rk-menu-warn">${_rkEsc(rackDeadWhy(layer, p))}</div>` + items;
  }
  pop.innerHTML = `<div class="rk-pop-h">${head}</div><div class="rk-menu-list">${items}</div>`;
  pop.onclick = (ev) => {
    const b = ev.target.closest('[data-mpatch]');
    if (!b) return;
    const [id, p] = b.dataset.mpatch.split('|');
    let msg = null;
    const on = (rackMod(layer, id)?.to || []).some(c => c.param === p);
    rackEdit(() => { if (on) rackUnpatch(_rk.rack, _rk.li, id, p); else { const r = rackPatch(_rk.rack, _rk.li, id, p); if (r !== true) msg = r; } });
    if (msg) toast?.(msg, true);
    else if (!on) rackSway(id, p);
  };
  rackPopAt(pop, x, y);
}
function rackCablePopover(e, wire) {
  document.querySelectorAll('.rk-pop').forEach(p => p.remove());
  const [id, param] = wire.split('|');
  const c = (rackMod(rackLayer(), id)?.to || []).find(x => x.param === param);
  if (!c) return;
  const info = rackTargetInfo(param);
  const pop = document.createElement('div');
  pop.className = 'rk-pop';
  _rkKs = 'chrome';
  pop.innerHTML = `<div class="rk-pop-h"><span class="rk-cdot" style="background:${rackCableColor(rackLayer(), id)}"></span>${_rkEsc(id)} → ${_rkEsc(info.label)}</div>
    ${rackKnobHtml(K('amount', 'Amount', -info.max, info.max, info.amt, { unit: info.unit }), c, `cable:${id}|${param}`, null)}
    <button class="action-btn danger" data-unpatch="${id}|${param}">Unplug</button>`;
  rackPopAt(pop, e.clientX, e.clientY);
}
// Motion units reorder by their grip: the order is the order of layer.mods.
function rackModReorder(e, id) {
  e.preventDefault();
  const stack = document.getElementById('rk-stack');
  const up = (ev) => {
    const over = document.elementsFromPoint(ev.clientX, ev.clientY).map(el => el.closest?.('[data-mod]')).find(Boolean);
    if (!over || over.dataset.mod === id) return;
    rackEdit(() => {
      const mods = rackLayer().mods || [];
      const from = mods.findIndex(m => m.id === id), to = mods.findIndex(m => m.id === over.dataset.mod);
      if (from < 0 || to < 0) return;
      const [m] = mods.splice(from, 1);
      mods.splice(to, 0, m);
    });
  };
  stack.classList.add('rk-reordering');
  window.addEventListener('pointerup', (ev) => { stack.classList.remove('rk-reordering'); up(ev); }, { once: true });
}
// The sequencer's screen is its editor: click or drag across it to set the steps.
// With SNAP on semi, a step lands on a twelfth, which is a semitone into a pitch
// cable at 1200 cents. Alt (or the right button) clears a step to zero.
function rackSeqEdit(e, cv) {
  const unit = cv.closest('[data-mod]');
  const m = rackMod(rackLayer(), unit?.dataset.mod);
  if (!m || unit.classList.contains('rk-unit-off')) return;
  e.preventDefault();
  const before = rackSnap();
  if (!Array.isArray(m.steps) || !m.steps.length) m.steps = [0];
  cv.setPointerCapture?.(e.pointerId);
  const set = (ev) => {
    const r = cv.getBoundingClientRect(), n = m.steps.length;
    const i = rackClamp(Math.floor(((ev.clientX - r.left) / r.width) * n), 0, n - 1);
    const mid = r.top + r.height / 2 + 4, amp = (r.height - 16) / 2;
    let v = rackClamp((mid - ev.clientY) / amp, -1, 1);
    v = m.snap ? Math.round(v * m.snap) / m.snap : Math.round(v * 100) / 100;
    if (ev.altKey || ev.buttons === 2) v = 0;
    m.steps[i] = v;
    rackDrawDisplays(false, unit);
  };
  set(e);
  const move = (ev) => set(ev);
  const up = () => {
    cv.removeEventListener('pointermove', move);
    cv.removeEventListener('pointerup', up);
    cv.removeEventListener('pointercancel', up);
    if (rackSnap() === before) return;
    _rk.undo.push(before); _rk.redo = []; _rk.dirty = true;
    rackRender();
    if (_rk.auto) rackAudition();
  };
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
}

// ── Screens ──────────────────────────────────────────────────────────────────
// Every unit has a screen: a canvas behind glass, drawn at the display's own pixel
// density in the unit's colour. A screen marked `live` redraws every frame while
// the patch sounds, off the probes, so a cable's work shows where it lands: the
// cutoff moving, the FM wave changing, the needle swinging.

const RACK_TAU = Math.PI * 2;
const RACK_MONO = "'Lucida Console', Consolas, monospace";
const RACK_SCREEN_SIZE = { vu: [128, 66], seq: [212, 66], adsr: [176, 62], filter: [176, 62], eq: [176, 62], comp: [150, 62], xfer: [164, 60], echo: [164, 60] };
function rackScreenHtml(kind) {
  const [w, h] = RACK_SCREEN_SIZE[kind] || [150, 60];
  return `<span class="rk-glass rk-screen${kind === 'vu' ? ' rk-screen-vu' : ''}${kind === 'seq' ? ' rk-screen-seq' : ''}"><canvas class="rk-display" data-display="${kind}" data-w="${w}" data-h="${h}" width="${w}" height="${h}" style="width:${w}px;height:${h}px"></canvas></span>`;
}
// Size a canvas's backing store to the screen's pixel density and return its context.
function rackHiDpi(cv) {
  if (!cv) return null;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = +cv.dataset.w || cv.width, h = +cv.dataset.h || cv.height;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  if (!g) return null;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}
function rackRgba(col, a) {
  const s = String(col || '').trim();
  let r = 61, g = 220, b = 132, m;
  if ((m = /^#([0-9a-f]{3})$/i.exec(s))) [r, g, b] = m[1].split('').map(h => parseInt(h + h, 16));
  else if ((m = /^#([0-9a-f]{6})/i.exec(s))) [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  else if ((m = /rgba?\(([^)]+)\)/.exec(s))) [r, g, b] = m[1].split(',').map(Number);
  return `rgba(${r},${g},${b},${a})`;
}
function rackRng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }
function rackWaveAt(w, p) {
  p -= Math.floor(p);
  return w === 'square' ? (p < 0.5 ? 1 : -1) : w === 'sawtooth' ? 2 * p - 1 : w === 'triangle' ? (p < 0.5 ? 4 * p - 1 : 3 - 4 * p) : Math.sin(RACK_TAU * p);
}
// 20 Hz to 20 kHz across the screen, and decibels up it.
const rackFx = (f, W) => (Math.log(Math.max(20, f) / 20) / Math.log(1000)) * W;
const rackDbY = (db, H, lo = -24, hi = 24) => H - 2 - ((rackClamp(db, lo, hi) - lo) / (hi - lo)) * (H - 4);

// The glass's back: near-black, a glow in the middle, a graticule. Returns false
// when the unit is off, after drawing the dark screen.
function rackScreen(g, W, H, I, gx = 6, gy = 4) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#020504';
  g.fillRect(0, 0, W, H);
  if (!I.off) {
    const glow = g.createRadialGradient(W / 2, H * 0.55, 2, W / 2, H * 0.55, W * 0.65);
    glow.addColorStop(0, rackRgba(I.col, 0.1));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
  }
  g.strokeStyle = rackRgba(I.col, I.off ? 0.03 : 0.09);
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 1; i < gx; i++) { const x = Math.round((i * W) / gx) + 0.5; g.moveTo(x, 0); g.lineTo(x, H); }
  for (let j = 1; j < gy; j++) { const y = Math.round((j * H) / gy) + 0.5; g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();
  if (I.off) {
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.font = `700 9px ${RACK_MONO}`;
    g.textAlign = 'center';
    g.fillText('OFF', W / 2, H / 2 + 3);
    return false;
  }
  return true;
}
function rackPath(g, pts) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); }
function rackStroke(g, I, pts, w = 1.6, a = 1, glow = 7) {
  if (pts.length < 2) return;
  g.save();
  rackPath(g, pts);
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = rackRgba(I.col, a);
  g.lineWidth = w;
  if (glow) { g.shadowColor = rackRgba(I.col, Math.min(1, a + 0.2)); g.shadowBlur = glow; }
  g.stroke();
  g.restore();
}
function rackShade(g, I, pts, base, a = 0.22) {
  if (pts.length < 2) return;
  g.save();
  rackPath(g, pts);
  g.lineTo(pts[pts.length - 1][0], base);
  g.lineTo(pts[0][0], base);
  g.closePath();
  const top = Math.min(...pts.map(p => p[1]), base - 1), bot = Math.max(...pts.map(p => p[1]), base + 1);
  const grad = g.createLinearGradient(0, top, 0, bot);
  grad.addColorStop(0, rackRgba(I.col, a));
  grad.addColorStop(1, rackRgba(I.col, a * 0.15));
  g.fillStyle = grad;
  g.fill();
  g.restore();
}
function rackText(g, I, s, x, y, align = 'left', a = 0.8) {
  g.save();
  g.font = `9px ${RACK_MONO}`;
  g.textAlign = align;
  g.fillStyle = rackRgba(I.col, a);
  g.shadowColor = rackRgba(I.col, 0.6);
  g.shadowBlur = 3;
  g.fillText(s, x, y);
  g.restore();
}
function rackDot(g, I, x, y, r = 2.6) {
  g.save();
  g.fillStyle = '#fff';
  g.shadowColor = I.col;
  g.shadowBlur = 10;
  g.beginPath();
  g.arc(x, y, r, 0, RACK_TAU);
  g.fill();
  g.restore();
}
function rackVline(g, I, x, a = 0.3, dash = [2, 3], y0 = 0, y1 = 9999) {
  g.save();
  g.setLineDash(dash);
  g.strokeStyle = rackRgba(I.col, a);
  g.beginPath();
  g.moveTo(Math.round(x) + 0.5, y0);
  g.lineTo(Math.round(x) + 0.5, Math.min(y1, g.canvas.height));
  g.stroke();
  g.restore();
}
// Where the patch is in a repeating window of `win` seconds, with the value on it.
function rackPlayhead(g, W, H, I, win, yAt) {
  if (!I.playing) return;
  const t = Math.max(0, I.t), x = ((t % win) / win) * W;
  rackVline(g, I, x, 0.35, []);
  if (yAt) rackDot(g, I, x, yAt(t));
}
function rackDecades(g, I, W, H) {
  for (const [f, s] of [[100, '100'], [1000, '1k'], [10000, '10k']]) {
    const x = rackFx(f, W);
    rackVline(g, I, x, 0.12, []);
    rackText(g, I, s, x + 2, H - 3, 'left', 0.35);
  }
}

// A biquad bank's response along the screen, from the browser's own filter maths.
let _rkProbe = null;
function rackResponse(stages, W, parallel) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return null;
  _rkProbe ||= new OAC(1, 1, 48000);
  const N = Math.max(2, Math.round(W)), freqs = new Float32Array(N), mag = new Float32Array(N), ph = new Float32Array(N);
  for (let i = 0; i < N; i++) freqs[i] = 20 * Math.pow(1000, i / (N - 1));
  const acc = new Float32Array(N).fill(parallel ? 0 : 1), phase = new Float32Array(N);
  for (const s of stages) {
    const bq = _rkProbe.createBiquadFilter();
    bq.type = s.type || 'lowpass';
    bq.frequency.value = rackClamp(s.freq || 1000, 10, 23999);
    bq.Q.value = s.q ?? 1;
    if (Number.isFinite(s.gain)) bq.gain.value = s.gain;
    bq.getFrequencyResponse(freqs, mag, ph);
    for (let i = 0; i < N; i++) {
      if (parallel) acc[i] += mag[i] * (s.level ?? 1);
      else { acc[i] *= mag[i]; phase[i] += ph[i]; }
    }
  }
  return { freqs, mag: acc, phase };
}
function rackFilterStages(f, cents) {
  const freq = (f.freq || 4000) * Math.pow(2, cents / 1200), type = f.type || 'lowpass';
  const s = [{ type, freq, q: f.q ?? 1, gain: f.gain }];
  if (f.slope === 24 && ['lowpass', 'highpass', 'bandpass', 'notch'].includes(type)) s.push({ type, freq, q: type === 'lowpass' || type === 'highpass' ? -3.01 : f.q ?? 1 });
  return s;
}
// Bessel's integral, J_n(x) = (1/π) ∫0..π cos(nτ − x sin τ) dτ, by Simpson's rule:
// the height of the nth sideband of an FM pair at index x.
function rackBessel(n, x) {
  if (!x) return n === 0 ? 1 : 0;
  const S = 240;
  let s = 0;
  for (let k = 0; k <= S; k++) {
    const t = (Math.PI * k) / S, w = k === 0 || k === S ? 1 : k % 2 ? 4 : 2;
    s += w * Math.cos(n * t - x * Math.sin(t));
  }
  return (s * (Math.PI / S)) / 3 / Math.PI;
}
function rackSidebands(g, W, H, I, fc, r, idx, maxF, ghost) {
  const N = Math.min(40, Math.ceil(Math.abs(idx) + 5)), bins = new Map();
  for (let n = -N; n <= N; n++) {
    const f = Math.abs(fc + n * r);
    if (f > maxF) continue;
    const k = Math.round(f * 40);
    bins.set(k, (bins.get(k) || 0) + Math.abs(rackBessel(n, idx)));
  }
  const top = 14, base = H - 3;
  g.save();
  for (const [k, a] of bins) {
    const x = 3 + (k / 40 / maxF) * (W - 6), h = Math.min(1, a) * (base - top);
    if (ghost) { g.strokeStyle = rackRgba(I.col, 0.35); g.lineWidth = 1; g.strokeRect(x - 1.5, base - h, 3, h); }
    else { g.fillStyle = rackRgba(I.col, 0.95); g.shadowColor = I.col; g.shadowBlur = 6; g.fillRect(x - 1.25, base - h, 2.5, h); }
  }
  g.restore();
}
function rackFmDraw(g, W, H, I, second) {
  if (!rackScreen(g, W, H, I, 9, 4)) return;
  const o = I.obj, f0 = o.freq || 440, fm = o.fm || {}, op = (second ? fm.op2 : fm) || {};
  const r1 = fm.ratio || (fm.rate ? fm.rate / f0 : 2);
  const r = op.ratio || (op.rate ? op.rate / f0 : 2);
  let i0 = op.index ?? (op.depth ?? 100) / Math.max(1, r * f0);
  if (I.playing) i0 = Math.max(0, i0 + (I.live.sums[second ? 'op2.index' : 'fm.index'] || 0));
  const i1 = op.indexEnd, maxF = 9;
  if (i1 != null && Math.abs(i1 - i0) > 0.01) rackSidebands(g, W, H, I, second ? r1 : 1, r, i1, maxF, true);
  rackSidebands(g, W, H, I, second ? r1 : 1, r, i0, maxF, false);
  rackText(g, I, second ? `OP2 ${+r.toFixed(2)} → OP1` : `C:M 1:${+r.toFixed(2)}`, 4, 10);
  rackText(g, I, `I ${i0.toFixed(1)}${i1 != null ? '→' + (+i1).toFixed(1) : ''}`, W - 4, 10, 'right', 0.65);
}
// A mod's shape over its window, in screen coordinates, and how long the window is.
function rackModPoints(m, W, H) {
  const pts = [], mid = H / 2 + 3, amp = H * 0.36;
  if (m.type === 'lfo') {
    const cyc = rackClamp(m.rate || 2, 0.5, 6);
    for (let x = 0; x <= W; x++) {
      const t = x / W, fade = m.fade > 0 ? Math.min(1, (t * cyc / (m.rate || 2)) / m.fade) : 1;
      pts.push([x, mid - rackWaveAt(m.wave || 'sine', t * cyc) * amp * fade]);
    }
    return { pts, win: cyc / (m.rate || 2), y: (v) => mid - v * amp };
  }
  if (m.type === 'env') {
    const a = m.a ?? 0.01, d = m.d ?? 0.2, s = m.s ?? 0, tot = Math.max(0.5, a + d + 0.3);
    const Y = (v) => H - 4 - v * (H - 16);
    for (let x = 0; x <= W; x++) {
      const t = (x / W) * tot;
      const v = t < a ? t / a : t < a + d ? (m.curve === 'exp' ? s + (1 - s) * Math.exp(-(t - a) / Math.max(0.001, d / 3)) : 1 + (s - 1) * ((t - a) / d)) : s;
      pts.push([x, Y(v)]);
    }
    return { pts, win: tot, y: Y, uni: true };
  }
  const rnd = rackRng(m.seed || 1), steps = rackClamp(Math.round(m.rate || 6), 2, 24);
  let prev = rnd() * 2 - 1;
  for (let s = 0; s < steps; s++) {
    const next = rnd() * 2 - 1, x0 = (s / steps) * W, x1 = ((s + 1) / steps) * W;
    pts.push([x0, mid - prev * amp], [x1, mid - (m.smooth ? next : prev) * amp]);
    prev = next;
  }
  return { pts, win: steps / (m.rate || 6), y: (v) => mid - v * amp };
}

const RACK_DRAW = {
  // the oscillator's wave; with FM on, the modulated wave over the plain one
  wave: { live: true, draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I)) return;
    const o = I.obj, wv = RACK_WAVES.includes(o.waveform) ? o.waveform : 'square', f0 = o.freq || 440;
    const fm = o.fm && (o.fm.ratio || o.fm.rate) ? o.fm : null;
    const mid = H / 2 + 3, amp = H * 0.34;
    const plain = [];
    for (let x = 0; x <= W; x++) plain.push([x, mid - rackWaveAt(wv, (x / W) * 2) * amp]);
    if (!fm) {
      rackShade(g, I, plain, mid, 0.14);
      rackStroke(g, I, plain);
      rackText(g, I, (RACK_SHORT[wv] || wv).toUpperCase(), 4, 10);
      rackText(g, I, rackFmt(f0, 'Hz'), W - 4, 10, 'right', 0.55);
      return;
    }
    const r1 = fm.ratio || fm.rate / f0;
    let i1 = fm.index ?? (fm.depth ?? 100) / Math.max(1, r1 * f0);
    if (I.playing) i1 = Math.max(0, i1 + (I.live.sums['fm.index'] || 0));
    const op = fm.op2 && (fm.op2.ratio || fm.op2.rate) ? fm.op2 : null;
    const r2 = op ? op.ratio || op.rate / f0 : 0, i2 = op ? op.index ?? (op.depth ?? 100) / Math.max(1, r2 * f0) : 0;
    const out = [];
    for (let x = 0; x <= W * 2; x++) {
      const ph = (x / (W * 2)) * 2;
      const mph = r1 * ph - (op ? (i2 / RACK_TAU) * Math.cos(RACK_TAU * r2 * ph) : 0);
      out.push([x / 2, mid - rackWaveAt(wv, ph - (i1 / RACK_TAU) * Math.cos(RACK_TAU * mph)) * amp]);
    }
    rackStroke(g, I, plain, 1, 0.22, 0);
    rackStroke(g, I, out, 1.3);
    rackText(g, I, `FM 1:${+r1.toFixed(2)}`, 4, 10);
    rackText(g, I, `I ${i1.toFixed(1)}`, W - 4, 10, 'right', 0.65);
  } },
  // the sub under the oscillator it follows
  sub: { draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I)) return;
    const o = I.obj, s = o.sub || {}, div = s.octave === 2 ? 4 : 2;
    const wv = RACK_WAVES.includes(o.waveform) ? o.waveform : 'square', sw = RACK_WAVES.includes(s.wave) ? s.wave : 'sine';
    const lvl = rackClamp(s.level ?? 0.5, 0, 1), mid = H / 2 + 3;
    const main = [], low = [];
    for (let x = 0; x <= W; x++) {
      const ph = (x / W) * div;
      main.push([x, mid - rackWaveAt(wv, ph) * H * 0.16]);
      low.push([x, mid - rackWaveAt(sw, ph / div) * H * 0.38 * Math.max(0.06, lvl)]);
    }
    rackStroke(g, I, main, 1, 0.3, 0);
    rackShade(g, I, low, mid, 0.16);
    rackStroke(g, I, low);
    rackText(g, I, `-${div === 4 ? 2 : 1} OCT`, 4, 10);
    rackText(g, I, rackFmt((o.freq || 440) / div, 'Hz'), W - 4, 10, 'right', 0.6);
  } },
  // the noise's colour across the spectrum; played slower, the top end goes
  noise: { live: true, draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I)) return;
    const o = I.obj, slope = { pink: -3, brown: -6 }[o.noise] || 0;
    let rate = o.noiseRate > 0 ? o.noiseRate : 1;
    if (I.playing) rate = Math.max(0.05, rate + (I.live.sums['noise.rate'] || 0));
    const rnd = rackRng(I.playing ? Math.floor(performance.now() / 50) : 11);
    const pts = [];
    for (let x = 0; x <= W; x += 2) {
      const src = (20 * Math.pow(1000, x / W)) / rate;
      const db = src > 24000 ? -60 : slope * Math.log2(src / 1000) + (rnd() - 0.5) * 8;
      pts.push([x, rackDbY(db, H, -42, 18)]);
    }
    rackShade(g, I, pts, H, 0.25);
    rackStroke(g, I, pts, 1.1);
    rackDecades(g, I, W, H);
    rackText(g, I, (o.noise || 'white').toUpperCase(), 4, 10);
    rackText(g, I, `×${rate.toFixed(2)}`, W - 4, 10, 'right', 0.6);
  } },
  fmspec: { live: true, draw(g, W, H, I) { rackFmDraw(g, W, H, I, false); } },
  fmspec2: { live: true, draw(g, W, H, I) { rackFmDraw(g, W, H, I, true); } },
  // the bend's pitch over time
  bend: { draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I)) return;
    const o = I.obj, f0 = o.freq || 440, to = o.pitchBend?.to || f0, T = Math.max(0.01, o.pitchBend?.time || 0.2);
    const span = T * 1.5, lo = Math.min(f0, to) / 1.3, hi = Math.max(f0, to) * 1.3;
    const Y = (f) => H - 5 - (Math.log(f / lo) / Math.log(hi / lo)) * (H - 18);
    const pts = [];
    for (let x = 0; x <= W; x++) { const t = (x / W) * span; pts.push([x, Y(to + (f0 - to) * Math.exp(-t / (T / 3)))]); }
    rackVline(g, I, (T / span) * W, 0.3, [2, 3], 12);
    rackStroke(g, I, pts);
    rackText(g, I, rackFmt(f0, 'Hz'), 4, 10);
    rackText(g, I, `→ ${rackFmt(to, 'Hz')}`, W - 4, 10, 'right');
  } },
  vib: { live: true, draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I)) return;
    const v = I.obj.vibrato || {}, rate = v.rate || 5, depth = v.depth ?? 10;
    const amp = Math.min(1, depth / 100) * H * 0.36 + 1, mid = H / 2 + 3, y = (t) => mid - Math.sin(RACK_TAU * rate * t) * amp;
    const pts = [];
    for (let x = 0; x <= W; x++) pts.push([x, y(x / W)]);
    rackStroke(g, I, pts);
    rackText(g, I, rackFmt(rate, 'Hz'), 4, 10);
    rackText(g, I, `±${Math.round(depth)} ct`, W - 4, 10, 'right', 0.65);
    rackPlayhead(g, W, H, I, 1, y);
  } },
  adsr: { draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I)) return;
    const e = I.obj.adsr || {}, a = e.a ?? 0.01, d = e.d ?? 0.05, s = e.s ?? 0.7, r = e.r ?? 0.15, exp = e.curve === 'exp';
    const hold = Math.max(0.1, (a + d + r) * 0.4), tot = a + d + hold + r;
    const X = (t) => (t / tot) * (W - 6) + 3, Y = (v) => H - 4 - v * (H - 16);
    const pts = [[X(0), Y(0)], [X(a), Y(1)]];
    for (let i = 1; i <= 24; i++) { const t = (i / 24) * d; pts.push([X(a + t), Y(exp ? s + (1 - s) * Math.exp(-t / Math.max(0.001, d / 3)) : 1 + (s - 1) * (i / 24))]); }
    pts.push([X(a + d + hold), Y(s)]);
    for (let i = 1; i <= 24; i++) { const t = i / 24; pts.push([X(a + d + hold + t * r), Y(exp ? s * Math.exp(-t * 5) : s * (1 - t))]); }
    for (const t of [a, a + d, a + d + hold]) rackVline(g, I, X(t), 0.16, [1, 3], 12);
    rackShade(g, I, pts, Y(0), 0.24);
    rackStroke(g, I, pts);
    for (const [l, t] of [['A', a / 2], ['D', a + d / 2], ['S', a + d + hold / 2], ['R', a + d + hold + r / 2]]) rackText(g, I, l, X(t), 10, 'center', 0.55);
  } },
  // a waveshaper: its curve on the left, a sine through it on the right
  xfer: { live: true, draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I, 1, 1)) return;
    const fold = I.key === 'fold', o = I.obj;
    let amount = fold ? o.fold?.amount ?? 0.5 : o.drive ?? 0.3;
    // a fold cable pushes the signal into the curve harder: show it as more folds
    const push = fold && I.playing ? Math.max(0, 1 + (I.live.sums['fold.amount'] || 0)) : 1;
    const curve = window.AudioEngine?.shaperCurve?.(fold ? 'fold' : 'drive', amount, o.driveType);
    if (!curve) return;
    const n = curve.length;
    const at = (x) => { const v = ((n - 1) / 2) * (rackClamp(x, -1, 1) + 1), k = Math.floor(v), f = v - k; return k >= n - 1 ? curve[n - 1] : curve[k] * (1 - f) + curve[k + 1] * f; };
    const pre = (fold ? 0.25 : 1) * push, S = H - 8;
    g.save(); g.strokeStyle = rackRgba(I.col, 0.14); g.strokeRect(4.5, 4.5, S, S);
    g.beginPath(); g.moveTo(4, 4 + S / 2 + 0.5); g.lineTo(4 + S, 4 + S / 2 + 0.5); g.moveTo(4 + S / 2 + 0.5, 4); g.lineTo(4 + S / 2 + 0.5, 4 + S); g.stroke(); g.restore();
    const xf = [];
    for (let i = 0; i <= S; i++) { const s = (i / S) * 2 - 1; xf.push([4 + i, 4 + S / 2 - at(s * pre) * (S / 2)]); }
    rackStroke(g, I, xf, 1.4);
    const x0 = S + 12, w = W - x0 - 4, mid = H / 2;
    const inp = [], outp = [];
    for (let i = 0; i <= w; i++) {
      const s = Math.sin(RACK_TAU * 1.5 * (i / w)) * 0.95;
      inp.push([x0 + i, mid - s * (H * 0.4)]);
      outp.push([x0 + i, mid - at(s * pre) * (H * 0.4)]);
    }
    rackStroke(g, I, inp, 1, 0.22, 0);
    rackStroke(g, I, outp, 1.4);
    rackText(g, I, fold ? 'FOLD' : (o.driveType || 'soft').toUpperCase(), x0, 10);
    rackText(g, I, `${Math.round(amount * 100)}%`, W - 4, 10, 'right', 0.6);
  } },
  // the oscillator times the ring's: the dry carrier faint underneath
  ring: { draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I)) return;
    const o = I.obj, rc = o.ring || {}, f0 = o.freq || 440;
    const ratio = rc.ratio > 0 ? rc.ratio : (rc.freq || 300) / f0, mix = rackClamp(rc.mix ?? 1, 0, 1);
    const wv = RACK_WAVES.includes(rc.wave) ? rc.wave : 'sine', mid = H / 2 + 3, amp = H * 0.36;
    const dry = [], wet = [];
    for (let x = 0; x <= W * 2; x++) {
      const ph = (x / (W * 2)) * 3, c = Math.sin(RACK_TAU * ph);
      dry.push([x / 2, mid - c * amp]);
      wet.push([x / 2, mid - ((1 - mix) * c + mix * c * rackWaveAt(wv, ph * ratio)) * amp]);
    }
    rackStroke(g, I, dry, 1, 0.2, 0);
    rackStroke(g, I, wet, 1.3);
    rackText(g, I, rc.ratio > 0 ? `×${(+ratio.toFixed(3))} NOTE` : rackFmt(rc.freq || 300, 'Hz'), 4, 10);
    rackText(g, I, `${Math.round(f0 * Math.abs(ratio - 1))}/${Math.round(f0 * (ratio + 1))} Hz`, W - 4, 10, 'right', 0.6);
  } },
  // the filter's response, and while it plays the response where the cables have put it
  filter: { live: true, draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I, 1, 4)) return;
    const o = I.obj, formants = I.key === 'formants';
    rackDecades(g, I, W, H);
    const pts = (resp) => Array.from(resp.mag, (m, i) => [i, rackDbY(20 * Math.log10(Math.max(1e-5, m)), H)]);
    if (formants) {
      const bands = (o.formants || []).map(f => (typeof f === 'object' ? { type: 'bandpass', freq: f.freq, q: f.q ?? 6, level: f.gain ?? 1 } : { type: 'bandpass', freq: f, q: 6 }));
      const resp = rackResponse(bands, W, true);
      if (!resp) return;
      const p = pts(resp);
      rackShade(g, I, p, H, 0.22);
      rackStroke(g, I, p);
      (o.formants || []).forEach((f, i) => { const fr = typeof f === 'object' ? f.freq : f; rackText(g, I, `F${i + 1}`, rackFx(fr, W), 10, 'center', 0.6); });
      return;
    }
    const f = o.filter || {};
    const cents = I.playing ? I.live.sums['filter.cutoff'] || 0 : 0;
    const base = rackResponse(rackFilterStages(f, 0), W, false);
    if (!base) return;
    if (cents) {
      rackStroke(g, I, pts(base), 1, 0.25, 0);
      const lv = pts(rackResponse(rackFilterStages(f, cents), W, false));
      rackShade(g, I, lv, H, 0.24);
      rackStroke(g, I, lv);
    } else {
      const p = pts(base);
      rackShade(g, I, p, H, 0.24);
      rackStroke(g, I, p);
    }
    if (f.to && f.to !== f.freq) rackVline(g, I, rackFx(f.to, W), 0.3, [2, 3], 12);
    const fc = (f.freq || 4000) * Math.pow(2, cents / 1200);
    rackDot(g, I, rackFx(fc, W), rackDbY(0, H) - (H * 0.04), 2);
    rackText(g, I, `${RACK_SHORT[f.type || 'lowpass'] || f.type}${f.slope === 24 ? ' 24dB' : ' 12dB'}`, 4, 10);
    rackText(g, I, rackFmt(fc, 'Hz'), W - 4, 10, 'right', 0.65);
  } },
  eq: { live: true, draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I, 1, 4)) return;
    const e = I.obj.eq || {}, cents = I.playing ? I.live.sums['eq.freq'] || 0 : 0;
    const mid = (e.midFreq || 1000) * Math.pow(2, cents / 1200);
    const bands = [{ type: 'lowshelf', freq: e.lowFreq || 200, gain: e.low || 0, l: 'L' }, { type: 'peaking', freq: mid, q: e.q ?? 0.9, gain: e.mid || 0, l: 'M' }, { type: 'highshelf', freq: e.highFreq || 4000, gain: e.high || 0, l: 'H' }];
    const resp = rackResponse(bands, W, false);
    if (!resp) return;
    rackDecades(g, I, W, H);
    g.save(); g.strokeStyle = rackRgba(I.col, 0.25); g.beginPath(); g.moveTo(0, rackDbY(0, H) + 0.5); g.lineTo(W, rackDbY(0, H) + 0.5); g.stroke(); g.restore();
    const p = Array.from(resp.mag, (m, i) => [i, rackDbY(20 * Math.log10(Math.max(1e-5, m)), H)]);
    rackShade(g, I, p, rackDbY(0, H), 0.28);
    rackStroke(g, I, p);
    for (const b of bands) { const x = rackFx(b.freq, W), y = rackDbY(b.gain, H); rackDot(g, I, x, y, 2.4); rackText(g, I, b.l, x, y < 16 ? y + 12 : y - 5, 'center', 0.7); }
  } },
  // the compressor's curve, and beside it the gain it's taking off now
  comp: { live: true, draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I, 1, 1)) return;
    const c = I.obj.comp || {}, T = c.threshold ?? -24, R = Math.max(1, c.ratio ?? 4), Kn = Math.max(0, c.knee ?? 6), lo = -60;
    const S = H - 8, X = (db) => 4 + ((db - lo) / -lo) * S, Y = (db) => 4 + S - ((rackClamp(db, lo, 0) - lo) / -lo) * S;
    const curve = (x) => (x < T - Kn / 2 ? x : x > T + Kn / 2 ? T + (x - T) / R : x + ((1 / R - 1) * (x - T + Kn / 2) ** 2) / (2 * Math.max(1e-6, Kn)));
    g.save(); g.strokeStyle = rackRgba(I.col, 0.14); g.strokeRect(4.5, 4.5, S, S); g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(lo), Y(lo)); g.lineTo(X(0), Y(0)); g.stroke(); g.restore();
    rackVline(g, I, X(T), 0.3, [2, 3], 4, 4 + S);
    const pts = [];
    for (let x = lo; x <= 0; x += 0.5) pts.push([X(x), Y(curve(x))]);
    rackStroke(g, I, pts, 1.5);
    const gr = I.playing && Number.isFinite(I.live.comp) ? rackClamp(I.live.comp, -24, 0) : 0;
    const mx = S + 14, mw = Math.max(10, W - mx - 26);
    g.save();
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(mx, 4, mw, S);
    const h = (-gr / 24) * S;
    const grad = g.createLinearGradient(0, 4, 0, 4 + S); grad.addColorStop(0, rackRgba(I.col, 0.95)); grad.addColorStop(1, rackRgba(I.col, 0.5));
    g.fillStyle = grad; g.shadowColor = I.col; g.shadowBlur = 8; g.fillRect(mx, 4, mw, h);
    g.restore();
    for (const db of [0, -6, -12, -18, -24]) rackText(g, I, String(db), mx + mw + 3, 4 + (-db / 24) * S + 3, 'left', 0.45);
    rackText(g, I, `${+R.toFixed(1)}:1`, 7, 14, 'left', 0.75);
    rackText(g, I, 'GR', mx + mw / 2, H - 2, 'center', 0.55);
  } },
  trem: { live: true, draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I)) return;
    const tr = I.obj.tremolo || {}, rate = tr.rate || 6, depth = rackClamp(tr.depth ?? 0.3, 0, 1);
    const Y = (v) => H - 4 - (v / 2) * (H - 16), y = (t) => Y(1 + depth * Math.sin(RACK_TAU * rate * t));
    const pts = [];
    for (let x = 0; x <= W; x++) pts.push([x, y(x / W)]);
    g.save(); g.setLineDash([2, 3]); g.strokeStyle = rackRgba(I.col, 0.22); g.beginPath(); g.moveTo(0, Y(1) + 0.5); g.lineTo(W, Y(1) + 0.5); g.stroke(); g.restore();
    rackShade(g, I, pts, H, 0.2);
    rackStroke(g, I, pts);
    rackText(g, I, rackFmt(rate, 'Hz'), 4, 10);
    rackText(g, I, `${Math.round(depth * 100)}%`, W - 4, 10, 'right', 0.65);
    rackPlayhead(g, W, H, I, 1, y);
  } },
  // the phaser's notches, sweeping with its LFO while it plays
  phaser: { live: true, draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I, 1, 4)) return;
    const p = I.obj.phaser || {}, n = [2, 4, 6, 8, 12].includes(p.stages) ? p.stages : 4, mix = rackClamp(p.mix ?? 0.5, 0, 1);
    const sweep = I.playing ? Math.sin(RACK_TAU * (p.rate ?? 0.5) * Math.max(0, I.t)) : 0;
    const cents = rackClamp(p.depth ?? 0.7, 0, 1) * 2400 * sweep + (I.playing ? I.live.sums['phaser.freq'] || 0 : 0);
    const fc = Math.max(20, p.freq || 800) * Math.pow(2, cents / 1200);
    const ap = rackResponse([{ type: 'allpass', freq: fc, q: 0.6 }], W, false);
    if (!ap) return;
    rackDecades(g, I, W, H);
    const pts = Array.from(ap.phase, (ph, i) => {
      const mag = Math.sqrt((1 - mix) ** 2 + mix ** 2 + 2 * mix * (1 - mix) * Math.cos(n * ph));
      return [i, rackDbY(20 * Math.log10(Math.max(1e-4, mag)), H, -30, 6)];
    });
    rackShade(g, I, pts, H, 0.22);
    rackStroke(g, I, pts);
    rackVline(g, I, rackFx(fc, W), 0.35, [2, 2], 12);
    rackText(g, I, `${n} STAGES`, 4, 10);
    rackText(g, I, rackFmt(p.rate ?? 0.5, 'Hz'), W - 4, 10, 'right', 0.6);
  } },
  // each voice's delay over two seconds, left bright and right faint
  chorus: { live: true, draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I)) return;
    const c = I.obj.chorus || {}, base = rackClamp(c.delay ?? 0.015, 0.0005, 0.05), rate = c.rate ?? 0.8;
    let depth = rackClamp(c.depth ?? 0.3, 0, 1);
    if (I.playing) depth = rackClamp(depth + (I.live.sums['chorus.depth'] || 0), 0, 1);
    const win = 2, Y = (d) => H - 4 - (d / (base * 2)) * (H - 16);
    const L = [], R = [];
    for (let x = 0; x <= W; x++) { const s = Math.sin(RACK_TAU * rate * (x / W) * win); L.push([x, Y(base * (1 + depth * s))]); R.push([x, Y(base * (1 - depth * s))]); }
    rackStroke(g, I, R, 1.1, 0.4, 0);
    rackStroke(g, I, L);
    rackText(g, I, base < 0.006 ? 'FLANGE' : 'CHORUS', 4, 10);
    rackText(g, I, `${(base * 1000).toFixed(1)} ms`, W - 4, 10, 'right', 0.6);
    rackPlayhead(g, W, H, I, win, null);
  } },
  // the echo's taps: the dry hit, each repeat down by the feedback, the second head between
  echo: { draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I)) return;
    const e = I.obj.echo || {}, d = rackClamp(e.delay ?? 0.18, 0.005, 2), fb = rackClamp(e.feedback ?? 0.35, 0, 0.95), mix = rackClamp(e.mix ?? 0.3, 0, 1);
    const span = Math.min(8, Math.max(d * 7, 0.4)), base = H - 4, top = 14, X = (t) => 5 + (t / span) * (W - 10);
    const tap = (t, a, faint) => {
      if (t > span || a < 0.004) return;
      const x = X(t);
      g.save();
      g.strokeStyle = rackRgba(I.col, faint ? 0.5 : 0.95); g.lineWidth = 2; g.shadowColor = I.col; g.shadowBlur = faint ? 0 : 7;
      g.beginPath(); g.moveTo(x, base); g.lineTo(x, base - a * (base - top)); g.stroke();
      g.restore();
    };
    tap(0, 1 - mix, true);
    for (let k = 1; k * d <= span; k++) { tap(k * d, mix * fb ** (k - 1)); if (e.heads === 2) tap((k + 0.5) * d, mix * fb ** (k - 1) * 0.7, true); }
    rackText(g, I, `${Math.round(d * 1000)} ms`, 4, 10);
    rackText(g, I, `${e.heads === 2 ? '2 HEADS ' : ''}FB ${Math.round(fb * 100)}%`, W - 4, 10, 'right', 0.65);
  } },
  pan: { live: true, draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I, 1, 1)) return;
    let p = rackClamp(I.obj.pan || 0, -1, 1);
    if (I.playing) p = rackClamp(p + (I.live.sums.pan || 0), -1, 1);
    const cx = W / 2, cy = H - 7, R = Math.min(W / 2 - 10, H - 14), ang = (v) => -Math.PI / 2 + v * 1.15;
    g.save();
    g.strokeStyle = rackRgba(I.col, 0.3); g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, R, ang(-1), ang(1)); g.stroke();
    for (const v of [-1, -0.5, 0, 0.5, 1]) { const a = ang(v); g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 4), cy + Math.sin(a) * (R - 4)); g.lineTo(cx + Math.cos(a) * (R + 2), cy + Math.sin(a) * (R + 2)); g.stroke(); }
    g.restore();
    const a = ang(p);
    rackStroke(g, I, [[cx, cy], [cx + Math.cos(a) * (R - 2), cy + Math.sin(a) * (R - 2)]], 1.8);
    rackDot(g, I, cx, cy, 2.4);
    rackText(g, I, 'L', 6, H - 4, 'left', 0.6);
    rackText(g, I, 'R', W - 6, H - 4, 'right', 0.6);
    rackText(g, I, p === 0 ? 'C' : `${p < 0 ? 'L' : 'R'}${Math.round(Math.abs(p) * 100)}`, W / 2, 10, 'center', 0.75);
  } },
  // a VU meter on the master: a cream face, a needle with a VU's weight, a peak lamp
  vu: { live: true, draw(g, W, H) {
    g.clearRect(0, 0, W, H);
    const lit = _rk.mains;
    const face = g.createLinearGradient(0, 0, 0, H);
    face.addColorStop(0, lit ? '#f8eecf' : '#7c7768');
    face.addColorStop(1, lit ? '#dccb97' : '#625e52');
    g.fillStyle = face;
    g.fillRect(0, 0, W, H);
    if (lit) {
      const lamp = g.createRadialGradient(W / 2, H * 1.1, 4, W / 2, H * 1.1, W * 0.8);
      lamp.addColorStop(0, 'rgba(255,180,80,0.35)');
      lamp.addColorStop(1, 'rgba(255,180,80,0)');
      g.fillStyle = lamp;
      g.fillRect(0, 0, W, H);
    }
    const cx = W / 2, cy = H + H * 0.42, R = H * 1.02;
    const pOf = (vu) => Math.pow(10, vu / 20) / 1.4125, ang = (p) => -Math.PI / 2 + (p - 0.5) * 1.55;
    g.save();
    g.lineWidth = 1.3;
    g.strokeStyle = '#1b160c';
    g.beginPath(); g.arc(cx, cy, R, ang(pOf(-20)), ang(pOf(0))); g.stroke();
    g.strokeStyle = '#c4231b'; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, R + 1, ang(pOf(0)), ang(pOf(3))); g.stroke();
    g.font = `8px ${RACK_MONO}`; g.textAlign = 'center';
    for (const vu of [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3]) {
      const a = ang(pOf(vu)), major = [-20, -10, -7, -5, -3, 0, 3].includes(vu);
      g.strokeStyle = vu > 0 ? '#c4231b' : '#1b160c'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - (major ? 6 : 4)), cy + Math.sin(a) * (R - (major ? 6 : 4))); g.lineTo(cx + Math.cos(a) * (R + 3), cy + Math.sin(a) * (R + 3)); g.stroke();
      if (major) { g.fillStyle = vu > 0 ? '#c4231b' : '#1b160c'; g.fillText(vu > 0 ? `+${vu}` : String(Math.abs(vu)), cx + Math.cos(a) * (R + 9), cy + Math.sin(a) * (R + 9) + 3); }
    }
    g.fillStyle = '#1b160c'; g.font = `700 11px Georgia, serif`; g.fillText('VU', cx, H - 10);
    const a = ang(Math.min(1.08, lit ? _rk.vu.v : 0));
    g.strokeStyle = '#111'; g.lineWidth = 1.2; g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 2; g.shadowOffsetY = 1;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * (R * 0.32), cy + Math.sin(a) * (R * 0.32)); g.lineTo(cx + Math.cos(a) * (R + 2), cy + Math.sin(a) * (R + 2)); g.stroke();
    g.restore();
    const pk = lit && performance.now() < _rk.vu.peak;
    g.save();
    g.fillStyle = pk ? '#ff3a24' : '#4a1410';
    if (pk) { g.shadowColor = '#ff3a24'; g.shadowBlur = 8; }
    g.beginPath(); g.arc(W - 9, 9, 3.2, 0, RACK_TAU); g.fill();
    g.restore();
    g.fillStyle = 'rgba(27,22,12,0.6)'; g.font = `7px ${RACK_MONO}`; g.textAlign = 'right'; g.fillText('PEAK', W - 15, 11);
  } },
  // the crusher: a sine through the sample-and-hold and the bit depth
  crush: { draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I)) return;
    const c = I.obj.retro || {}, rate = rackClamp(c.rate ?? 11025, 500, 48000), bits = Math.round(rackClamp(c.bits ?? 8, 1, 16));
    const holds = Math.round(rackClamp(rate / 700, 3, 64)), levels = Math.pow(2, Math.min(bits, 6)) / 2, mid = H / 2 + 3, amp = H * 0.36;
    const smooth = [], stair = [];
    for (let x = 0; x <= W; x++) smooth.push([x, mid - Math.sin(RACK_TAU * (x / W)) * amp]);
    for (let k = 0; k < holds; k++) {
      const v = Math.round(Math.sin(RACK_TAU * (k / holds)) * levels) / levels;
      stair.push([(k / holds) * W, mid - v * amp], [((k + 1) / holds) * W, mid - v * amp]);
    }
    rackStroke(g, I, smooth, 1, 0.22, 0);
    rackStroke(g, I, stair, 1.4);
    rackText(g, I, `${(rate / 1000).toFixed(1)}k`, 4, 10);
    rackText(g, I, `${bits} BIT`, W - 4, 10, 'right', 0.65);
  } },
  // what the ducker does to the other buses over the cue
  duck: { draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I)) return;
    const d = I.obj.duck || {}, dB = rackClamp(d.dB ?? -9, -40, 0), at = Math.max(0.001, d.attack ?? 0.03), rel = Math.max(0.01, d.release ?? 0.5), dur = I.cue.duration ?? 0.4;
    const span = at + dur + rel * 1.5, X = (t) => (t / span) * W, Y = (db) => 14 + (-db / 40) * (H - 18);
    const pts = [];
    for (let x = 0; x <= W; x++) {
      const t = (x / W) * span;
      const v = t < at ? dB * (t / at) : t < dur ? dB : dB * Math.exp(-(t - dur) / (rel / 3));
      pts.push([x, Y(v)]);
    }
    rackVline(g, I, X(dur), 0.25, [2, 3], 12);
    rackShade(g, I, pts, Y(0), 0.22);
    rackStroke(g, I, pts);
    rackText(g, I, (d.buses || ['ambient']).join(' ').toUpperCase(), 4, 10);
    rackText(g, I, `${dB} dB`, W - 4, 10, 'right', 0.65);
  } },
  // a modulator's shape, with where it is now while the patch plays
  mod: { live: true, draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I)) return;
    const m = I.mod;
    if (!m) return;
    const { pts, win, y, uni } = rackModPoints(m, W, H);
    if (uni) rackShade(g, I, pts, H - 4, 0.22);
    rackStroke(g, I, pts);
    const v = I.live.vals[m.id];
    if (I.playing && v != null) {
      const x = uni ? Math.min(1, Math.max(0, I.t) / win) * W : ((Math.max(0, I.t) % win) / win) * W;
      rackVline(g, I, x, 0.35, []);
      rackDot(g, I, x, rackClamp(y(v), 2, H - 2));
    }
    rackText(g, I, m.type === 'env' ? `A ${rackFmt(m.a ?? 0.01, 's')}` : m.type === 'rand' ? `SEED ${m.seed || 1}` : (m.wave || 'sine').toUpperCase(), 4, 10);
    rackText(g, I, m.type === 'env' ? `D ${rackFmt(m.d ?? 0.2, 's')}` : rackFmt(m.rate ?? 2, 'Hz'), W - 4, 10, 'right', 0.65);
  } },
  // the sequencer's steps; the one playing lit. It's also the editor: see rackSeqEdit
  seq: { live: true, draw(g, W, H, I) {
    if (!rackScreen(g, W, H, I, 1, 2)) return;
    const m = I.mod;
    if (!m) return;
    const steps = Array.isArray(m.steps) && m.steps.length ? m.steps : [0], n = steps.length, mid = H / 2 + 4, amp = (H - 16) / 2;
    const cur = I.playing && I.live.vals[m.id] != null ? Math.floor(Math.max(0, I.t) * (m.rate ?? 8)) % n : -1;
    const bw = W / n;
    g.save();
    for (let i = 0; i < n; i++) {
      const v = rackClamp(steps[i], -1, 1), x = i * bw + 1.5, y = mid - v * amp;
      const lit = i === cur;
      g.fillStyle = rackRgba(I.col, lit ? 1 : 0.6);
      if (lit) { g.shadowColor = I.col; g.shadowBlur = 10; } else g.shadowBlur = 0;
      g.fillRect(x, Math.min(mid, y), Math.max(1, bw - 3), Math.max(1.5, Math.abs(y - mid)));
      g.fillStyle = rackRgba(I.col, lit ? 1 : 0.85);
      g.fillRect(x, y - 1, Math.max(1, bw - 3), 2);
    }
    g.restore();
    if (m.glide) rackStroke(g, I, steps.map((v, i) => [i * bw + bw / 2, mid - rackClamp(v, -1, 1) * amp]), 1, 0.45, 0);
    rackText(g, I, `${n} STEPS${m.snap ? ' · SEMI' : ''}`, 4, 10);
    rackText(g, I, `${rackFmt(m.rate ?? 8, '/s')}`, W - 4, 10, 'right', 0.65);
  } },
};

// Draw the screens: every one, only the live ones (each frame while it plays), or
// only those inside `within` (a unit whose knob is turning).
function rackDrawDisplays(onlyLive, within) {
  const root = document.getElementById('rk-root');
  if (!root || !_rk.rack) return;
  (within || root).querySelectorAll('canvas[data-display]').forEach(cv => {
    const D = RACK_DRAW[cv.dataset.display];
    if (!D || (onlyLive && !D.live)) return;
    const s = rackHiDpi(cv);
    if (!s) return;
    D.draw(s.g, s.w, s.h, rackScreenInfo(cv));
  });
}
function rackScreenInfo(cv) {
  const unit = cv.closest('[data-unit]');
  const key = unit?.dataset.unit || '', scope = unit?.dataset.uscope || 'layer';
  const layer = rackLayer(), off = !_rk.mains || unit?.classList.contains('rk-unit-off');
  let obj, mod = null;
  if (key.startsWith('mod:')) { mod = rackMod(layer, key.slice(4)) || layer.rack?.bypass?.[key]; obj = mod; }
  else {
    const base = scope === 'cue' ? _rk.rack.cue : layer;
    obj = unit?.classList.contains('rk-unit-off') ? rackViewOf(scope, key, base) : base;
  }
  cv._col ||= (unit ? getComputedStyle(unit).getPropertyValue('--fam').trim() : '') || '#3ddc84';
  return { key, obj, layer, cue: _rk.rack.cue, mod, col: cv._col, off, live: _rk.live, t: _rk.now - _rk.t0, playing: _rk.playing && !off };
}

// ── Live: the probes ─────────────────────────────────────────────────────────
// Each audition asks SIREN for its mods' outputs (opts.probe in playSfx), and an
// analyser on each reads the value every frame. That's what moves the dots on
// the patched knobs, lights the cables and drives the live screens: the mods as
// they really run, mod-into-mod and all.
function rackProbe(until, hold) {
  return (kind, id, node, layer) => {
    const li = layer?._rackLi;
    if (li == null) return;
    if (kind === 'mod') {
      try {
        const an = node.context.createAnalyser();
        an.fftSize = 32;
        node.connect(an);
        _rk.probes.push({ kind, li, id, src: node, an, buf: new Float32Array(32), until, hold });
      } catch { /* a context without analysers: no live view */ }
    } else if (kind === 'comp') _rk.probes.push({ kind, li, id, node, until, hold });
  };
}
// A held note's probes run until it's let go, then for its release.
function rackProbeEnd(hold) {
  const tail = Math.max(0.15, ...(_rk.rack?.layers || []).map(l => l.adsr?.r ?? 0.15)) + 0.1;
  for (const p of _rk.probes) if (p.hold === hold) p.until = _rk.now + tail;
}
function rackReadProbes(now) {
  _rk.now = now;
  const vals = {}, sums = {};
  let comp = null;
  _rk.probes = _rk.probes.filter(p => {
    if (now <= p.until) return true;
    try { p.src?.disconnect(p.an); } catch { /* the voice is already gone */ }
    return false;
  });
  for (const p of _rk.probes) {
    if (p.li !== _rk.li) continue;
    if (p.kind === 'mod') { p.an.getFloatTimeDomainData(p.buf); vals[p.id] = p.buf[p.buf.length - 1]; }
    else if (p.kind === 'comp') comp = p.node.reduction;
  }
  for (const m of rackLayer()?.mods || []) {
    const v = vals[m.id];
    if (v == null) continue;
    for (const c of m.to || []) sums[c.param] = (sums[c.param] || 0) + v * (c.amount || 0);
  }
  _rk.live = { vals, sums, comp };
  _rk.playing = _rk.probes.some(p => p.li === _rk.li) || _rk.keys.size > 0 || !!_rk.held;
}
// The dot on each patched knob, where the cables have it this frame.
function rackLiveKnobs() {
  const vals = _rk.live.vals, sums = _rk.live.sums, layer = rackLayer();
  if (!layer) return;
  document.querySelectorAll('#rk-stack .rk-knob[data-live]').forEach(el => {
    const dot = el.querySelector('.rk-k-live');
    if (!dot) return;
    const param = el.dataset.live;
    const on = _rk.mains && rackCablesInto(layer, param).some(x => vals[x.id] != null);
    el.classList.toggle('rk-moving', on);
    if (!on) return;
    const k = rackKnobSpec(el), obj = rackObj(el.dataset.scope);
    if (!obj) return;
    const n = rackNorm(k, rackLiveValue(el.dataset.lk, rackKnobValue(obj, k), sums[param] || 0));
    const c = (el.classList.contains('rk-small') ? 34 : 50) / 2;
    dot.setAttribute('transform', `rotate(${(n * 270).toFixed(1)} ${c} ${c})`);
  });
}
// Each cable glows with what its modulator is sending down it.
function rackLiveWires() {
  const svg = document.getElementById('rk-cables');
  if (!svg) return;
  const vals = _rk.live.vals;
  svg.querySelectorAll('g.rk-wire[data-src]').forEach(g => {
    const v = vals[g.dataset.src];
    g.style.setProperty('--sig', v == null || !_rk.mains ? '0' : Math.min(1, Math.abs(v)).toFixed(3));
  });
}

// The transport's scope, spectrum and level, the VU, the valves, and the live
// parts above, off an analyser tapped on the patch's bus.
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
  let last = performance.now();
  const draw = (ts) => {
    const sc = document.getElementById('rk-scope'), sp = document.getElementById('rk-spectrum'), bar = document.getElementById('rk-meter-bar');
    if (!sc) return;   // the rack closed: the loop ends with it
    const dt = Math.min(0.1, Math.max(0, (ts - last) / 1000));
    last = ts;
    const { an, t, f } = _rk.meter;
    an.getFloatTimeDomainData(t);
    an.getByteFrequencyData(f);
    const css = getComputedStyle(document.documentElement);
    const col = css.getPropertyValue('--green').trim() || '#3ddc84', acc = css.getPropertyValue('--accent').trim() || '#ff2ec4';
    let peak = 0, sq = 0;
    for (let i = 0; i < t.length; i++) { const v = t[i]; sq += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
    rackDrawScope(sc, t, col);
    rackDrawSpectrum(sp, f, acc);
    if (bar) bar.style.width = `${Math.min(100, peak * 100)}%`;
    // the valves glow with the level, rising fast and cooling slowly
    _rk.glow = Math.max(_rk.mains ? peak : 0, (_rk.glow || 0) * 0.94);
    document.getElementById('rk-root')?.style.setProperty('--level', Math.min(1, _rk.glow * 1.6).toFixed(3));
    // the VU needle, with a VU's weight: about 300 ms to settle; 0 VU is -14 dBFS RMS
    const vuDb = 20 * Math.log10(Math.max(1e-6, Math.sqrt(sq / t.length))) + 14;
    const pT = _rk.mains ? Math.min(1.08, Math.pow(10, vuDb / 20) / 1.4125) : 0;
    _rk.vu.v += (pT - _rk.vu.v) * (1 - Math.exp(-dt / 0.065));
    if (peak > 0.89) _rk.vu.peak = performance.now() + 450;
    rackReadProbes(an.context.currentTime);
    rackLiveKnobs();
    rackLiveWires();
    const busy = _rk.playing || _rk.vu.v > 0.003 || performance.now() < _rk.vu.peak;
    if (busy || _rk.busy) rackDrawDisplays(true);
    _rk.busy = busy;
    _rk.raf = requestAnimationFrame(draw);
  };
  _rk.raf = requestAnimationFrame(draw);
}
function rackDrawScope(cv, t, col) {
  const s = rackHiDpi(cv);
  if (!s) return;
  const { g, w: W, h: H } = s;
  const I = { col, off: !_rk.mains };
  rackScreen(g, W, H, I, 8, 4);
  if (I.off) return;
  // start on a rising zero crossing so the trace stands still
  let s0 = 0;
  for (let i = 1; i < t.length / 2; i++) if (t[i - 1] < 0 && t[i] >= 0) { s0 = i; break; }
  const pts = [];
  for (let x = 0; x <= W; x++) pts.push([x, H / 2 - (t[s0 + x * 2] || 0) * (H / 2 - 2)]);
  rackStroke(g, I, pts, 1.3);
}
function rackDrawSpectrum(cv, f, col) {
  const s = rackHiDpi(cv);
  if (!s) return;
  const { g, w: W, h: H } = s;
  const I = { col, off: !_rk.mains };
  rackScreen(g, W, H, I, 1, 4);
  if (I.off) return;
  const bins = f.length, bw = 3;
  g.save();
  const grad = g.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0, rackRgba(col, 0.55));
  grad.addColorStop(1, rackRgba(col, 1));
  g.fillStyle = grad;
  for (let x = 0; x < W; x += bw) {
    const bi = Math.min(bins - 1, Math.floor(Math.pow(bins, x / W)));
    const v = f[bi] / 255;
    g.fillRect(x, H - v * H, bw - 1, v * H);
  }
  g.restore();
}

// ── Playing it ───────────────────────────────────────────────────────────────

function rackCategory() {
  const r = _rk.rack;
  if (!r) return 'sfx';
  return typeof _previewCategory === 'function' ? _previewCategory(r.tab, r.meta.category) : (r.tab === 'instruments' ? 'music' : r.meta.category || 'sfx');
}
// The def the preview plays: muted layers out, the keyboard's note applied, and
// each layer tagged with its place in the rack so the probes know whose it is.
function rackPreviewDef(noteHz, velocity) {
  const r = _rk.rack;
  const row = rackToRow(r);
  const cfg = row.config;
  const audible = (i) => (_rk.solo != null ? i === _rk.solo : !_rk.mute.has(i));
  if (r.tab === 'instruments') {
    if (!audible(0)) return null;
    const c = { ...cfg, waveform: row.waveform, freq: noteHz || 440, duration: 0.6, _rackLi: 0 };
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
  const layers = r.layers.map((l, i) => (audible(i) ? { ...rackClone(tune(l)), _rackLi: i } : null)).filter(Boolean)
    .map(l => { delete l.rack; return l; });
  if (!layers.length) return null;
  const cue = rackClone(r.cue);
  delete cue.sparkle;
  const config = { ...cue, layers };
  if (r.tab === 'ambient' && !(config.duration > 0)) config.duration = 3;
  return { id: '_rack', priority: 9, category: rackCategory(), config };
}
// How long a one-shot preview sounds, for how long its probes are read.
function rackPreviewSpan() {
  const r = _rk.rack;
  const dur = r.tab === 'instruments' ? 0.6 : r.cue.duration ?? (r.tab === 'ambient' ? 3 : 0.4);
  return dur + Math.max(0.15, ...r.layers.map(l => (l.delay ?? 0) + (l.adsr?.r ?? 0.15) + (l.echo?.mix > 0 ? (l.echo.delay ?? 0.18) * 4 : 0)));
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
  if (!AE || !_rk.rack) return;
  if (!_rk.mains) { if (force === true) toast?.('The rack is off at the mains: its switch is on the Master', true); return; }
  AE.init();
  if (_rk.held) return;   // a held note is sounding: the edit waits for the next trigger
  const def = rackPreviewDef();
  if (!def) return;
  const now = AE.engineNodes?.(def.category)?.ctx?.currentTime ?? 0;
  _rk.t0 = now;
  AE.playSfx(def, 1, { probe: rackProbe(now + rackPreviewSpan() + 0.15) });
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
  _rk.notes.clear();
  rackRender();
}
function rackHoldStart(code, vel, hz) {
  const AE = window.AudioEngine;
  if (!AE || !_rk.mains) return;
  AE.init();
  const def = rackPreviewDef(hz, vel);
  if (!def) return;
  const token = {};
  _rk.t0 = AE.engineNodes?.(def.category)?.ctx?.currentTime ?? 0;
  const h = AE.playSfx(def, 1, { sustain: true, probe: rackProbe(Infinity, token) });
  const handle = { release: () => { h?.release?.(); rackProbeEnd(token); } };
  if (code) { _rk.keys.get(code)?.release?.(); _rk.keys.set(code, handle); } else { _rk.held?.release?.(); _rk.held = handle; }
}
function rackHoldEnd(code) {
  if (code) { _rk.keys.get(code)?.release?.(); _rk.keys.delete(code); return; }
  _rk.held?.release?.(); _rk.held = null;
}
function rackKeyDown(e) {
  if (e.target.closest('input,textarea,select')) return;
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? rackRedo() : rackUndo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); rackRedo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); rackAudition(true); return; }
  const semi = RACK_KEYMAP[e.code];
  if (semi == null || e.repeat) return;
  e.preventDefault();
  rackKeyLight(semi, true);
  rackHoldStart(e.code, e.shiftKey ? 1 : 0.6, rackNoteHz(semi));
}
function rackKeyUp(e) {
  const semi = RACK_KEYMAP[e.code];
  if (semi == null) return;
  rackKeyLight(semi, false);
  rackHoldEnd(e.code);
}
// A key on the screen keyboard: down while the button's held, and a drag across
// the keys plays each in turn, the way a finger slides along a real one. Lower on
// the key plays harder.
function rackKeyPointer(e, keyEl) {
  e.preventDefault();
  document.getElementById('rk-root')?.focus({ preventScroll: true });
  let cur = null;
  const press = (el, ev) => {
    const semi = +el.dataset.semi;
    if (cur === semi) return;
    release();
    cur = semi;
    const r = el.getBoundingClientRect();
    rackKeyLight(semi, true);
    rackHoldStart(`mouse:${semi}`, rackClamp(0.35 + ((ev.clientY - r.top) / r.height) * 0.65, 0.3, 1), rackNoteHz(semi));
  };
  const release = () => {
    if (cur == null) return;
    rackKeyLight(cur, false);
    rackHoldEnd(`mouse:${cur}`);
    cur = null;
  };
  press(keyEl, e);
  const move = (ev) => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('#rk-keys [data-semi]');
    if (el) press(el, ev); else release();
  };
  const up = () => { release(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

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
