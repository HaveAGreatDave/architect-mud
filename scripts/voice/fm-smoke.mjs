// FM smoke — the only automated coverage AudioEngine.buildLayer has.
//
//   node scripts/voice/fm-smoke.mjs
//
// Runs in pretest:regress alongside scripts/voice/smoke.mjs, and exists for the
// same reason scripts/shapes/smoke.mjs does: before this, the only thing that
// ever ran an FM voice was a player standing in the room where it plays. The
// numbers here are pure arithmetic on the way to an AudioParam — a modulator
// resolved to the wrong frequency does not throw, it just sounds like a
// different instrument, in one room, to whoever happened to be in it.
//
// Needs no browser, DB or network. audio-engine.js attaches to globalThis when
// `window` is absent; the AudioContext below is a RECORDING stub, so every
// setValueAtTime / setTargetAtTime the builder schedules is readable afterwards.
// It asserts what was SCHEDULED, never what it sounds like — there is no audio
// comparison here any more than shapes/smoke.mjs compares pixels.
//
// WHAT IT GUARDS:
//   • ratio ⇄ rate and index ⇄ depth are two spellings of ONE graph, and the
//     ratio spelling is the one that survives a change of pitch
//   • every sweep target lands on the right param with the right value
//   • a ratio-authored modulator follows its carrier through a pitch bend
//   • op2 is wired in SERIES (into the modulator), never in parallel
//   • back-compat: a cue authored before any of this builds the identical graph
//   • sustain hands back a release handle, and only for a blown voice
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (p) => new Function(readFileSync(join(ROOT, p), 'utf8'))();

// ── Recording AudioContext ───────────────────────────────────────────────────
// Every param write is kept as {type, value, time}. Nodes are numbered so the
// graph can be walked afterwards — which is the whole point, since "the second
// oscillator" is not a thing an audio API lets you ask for.
let nodes = [];
// Never cleared. The bus graph (and the convolver on it) is built ONCE at context
// creation, long before the first build(), so anything looking for it in the
// per-build list finds an empty array and reports a reverb that isn't there.
const allNodes = [];
const mkParam = (owner, name, value = 0) => ({
  _owner: owner, _name: name, value, log: [],
  setValueAtTime(v, t) { this.value = v; this.log.push({ type: 'set', value: v, time: t }); return this; },
  setTargetAtTime(v, t, c) { this.log.push({ type: 'target', value: v, time: t, tc: c }); return this; },
  linearRampToValueAtTime(v, t) { this.log.push({ type: 'ramp', value: v, time: t }); return this; },
  exponentialRampToValueAtTime(v, t) { this.log.push({ type: 'exp', value: v, time: t }); return this; },
  cancelScheduledValues() { return this; },
});
function mkNode(kind) {
  const n = { kind, id: nodes.length, out: [], started: null, stopped: null };
  n.connect = (dst) => { n.out.push(dst); return dst; };
  n.disconnect = () => {};
  n.start = (t) => { n.started = t ?? 0; };
  n.stop = (t) => { n.stopped = t ?? 0; };
  nodes.push(n);
  allNodes.push(n);
  return n;
}
class FakeContext {
  constructor() { this.currentTime = 0; this.sampleRate = 48000; this.state = 'running'; this.destination = mkNode('destination'); }
  createGain() { const n = mkNode('gain'); n.gain = mkParam(n, 'gain', 1); return n; }
  createOscillator() { const n = mkNode('osc'); n.type = 'sine'; n.frequency = mkParam(n, 'frequency', 440); n.detune = mkParam(n, 'detune', 0); n.setPeriodicWave = () => {}; return n; }
  createBiquadFilter() { const n = mkNode('filter'); n.type = 'lowpass'; n.frequency = mkParam(n, 'frequency', 350); n.Q = mkParam(n, 'Q', 1); n.gain = mkParam(n, 'gain', 0); n.detune = mkParam(n, 'detune', 0); return n; }
  createBufferSource() { const n = mkNode('buffersrc'); n.buffer = null; n.loop = false; n.playbackRate = mkParam(n, 'playbackRate', 1); n.detune = mkParam(n, 'detune', 0); return n; }
  createDelay() { const n = mkNode('delay'); n.delayTime = mkParam(n, 'delayTime', 0); return n; }
  createStereoPanner() { const n = mkNode('panner'); n.pan = mkParam(n, 'pan', 0); return n; }
  createDynamicsCompressor() { const n = mkNode('comp'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = mkParam(n, k, 0); return n; }
  createWaveShaper() { const n = mkNode('shaper'); n.curve = null; n.oversample = 'none'; return n; }
  createConvolver() { const n = mkNode('convolver'); n.buffer = null; return n; }
  createPeriodicWave() { return mkNode('wave'); }
  createBuffer(ch, len) {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: 48000, getChannelData: (i) => data[i] };
  }
  resume() { return Promise.resolve(); }
}
globalThis.window = globalThis;
globalThis.AudioContext = FakeContext;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);

load('client/shared/formant-cmudict.js');
load('client/shared/audio-engine.js');
load('client/shared/procedural-sfx.js');
load('client/shared/hockey-sfx.js');
const A = globalThis.AudioEngine;
const P = globalThis.ProceduralSFX;
if (!A?.playSfx) { console.error('x audio-engine did not load'); process.exit(1); }
if (!P?.buildNoteCue) { console.error('x procedural-sfx did not load'); process.exit(1); }

let fails = 0;
function check(label, cond, detail) {
  if (cond) return;
  fails++;
  console.error(`  x ${label}${detail ? `\n      ${detail}` : ''}`);
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
function eq(label, got, want, tol) {
  check(label, typeof got === 'number' && near(got, want, tol ?? 1e-6), `want ${want}, got ${got}`);
}

// Build one layer and hand back a readable view of the graph it made.
//   carrier    the tone oscillator (the one whose frequency the layer set)
//   mod        the oscillator connected into carrier.frequency
//   modGain    the gain between them — its value IS the deviation in Hz
//   op2 / op2Gain  the same one level down, connected into mod.frequency
function build(layer, { duration = 1, sustain = false } = {}) {
  nodes = [];
  const handle = A.playSfx({ id: 'fm-smoke', category: 'sfx', priority: 5, config: { duration, layers: [layer] } }, 1, { sustain });
  const oscs = nodes.filter(n => n.kind === 'osc');
  // The carrier is the oscillator nothing else in this layer feeds; a modulator
  // is by definition connected into some oscillator's frequency param.
  const feeds = new Map(); // target osc id -> {mod, gain}
  for (const g of nodes.filter(n => n.kind === 'gain')) {
    for (const dst of g.out) {
      if (dst && dst._name === 'frequency' && dst._owner?.kind === 'osc') {
        const src = oscs.find(o => o.out.includes(g));
        if (src) feeds.set(dst._owner.id, { mod: src, gain: g });
      }
    }
  }
  // The carrier is the one oscillator nothing modulates. Stated that way round
  // on purpose: "the first oscillator created" would also be right today and
  // would stop being right the moment the builder reorders anything.
  const carrier = oscs.find(o => !isModulator(o, feeds));
  const c1 = feeds.get(carrier?.id);
  const c2 = c1 ? feeds.get(c1.mod.id) : null;
  return {
    handle, oscs, carrier,
    mod: c1?.mod || null, modGain: c1?.gain || null,
    op2: c2?.mod || null, op2Gain: c2?.gain || null,
  };
}
function isModulator(osc, feeds) {
  for (const { mod } of feeds.values()) if (mod === osc) return true;
  return false;
}
const firstSet = (param) => param?.log.find(e => e.type === 'set')?.value;
const firstTarget = (param) => param?.log.find(e => e.type === 'target')?.value;

// ── ratio and index are the note-relative spellings ──────────────────────────
{
  const g = build({ waveform: 'sine', freq: 200, fm: { ratio: 3, index: 2 } });
  eq('ratio resolves the modulator against the carrier (200 x 3)', firstSet(g.mod?.frequency), 600);
  eq('index is deviation / MODULATOR freq (2 x 600)', firstSet(g.modGain?.gain), 1200);
}
{
  // The same graph, spelled in absolute Hz. Two spellings, one sound — this is
  // the assertion that stops the two forms drifting into two behaviours.
  const g = build({ waveform: 'sine', freq: 200, fm: { rate: 600, depth: 1200 } });
  eq('rate spelling reaches the same modulator frequency', firstSet(g.mod?.frequency), 600);
  eq('depth spelling reaches the same deviation', firstSet(g.modGain?.gain), 1200);
}

// ── the whole reason ratio exists: it survives a change of pitch ─────────────
{
  const lo = build({ waveform: 'sine', freq: 200, fm: { ratio: 3, index: 2 } });
  const hi = build({ waveform: 'sine', freq: 800, fm: { ratio: 3, index: 2 } });
  const rLo = firstSet(lo.mod.frequency) / 200, rHi = firstSet(hi.mod.frequency) / 800;
  eq('ratio form: modulator ratio is identical two octaves up', rHi, rLo);
  const iLo = firstSet(lo.modGain.gain) / firstSet(lo.mod.frequency);
  const iHi = firstSet(hi.modGain.gain) / firstSet(hi.mod.frequency);
  eq('ratio form: modulation index is identical two octaves up', iHi, iLo);

  // And the control: the absolute form does NOT, which is the bug that kept a
  // piano out of the instrument table. If this ever starts passing, `rate` has
  // silently become note-relative and every impact cue in the game has moved.
  const aLo = build({ waveform: 'sine', freq: 200, fm: { rate: 600, depth: 1200 } });
  const aHi = build({ waveform: 'sine', freq: 800, fm: { rate: 600, depth: 1200 } });
  check('rate form is absolute: the ratio CHANGES with pitch',
    !near(firstSet(aHi.mod.frequency) / 800, firstSet(aLo.mod.frequency) / 200),
    'rate: {…} became note-relative — every fixed-pitch impact cue just moved');
}

// ── sweeps land on the right param ───────────────────────────────────────────
{
  const g = build({ waveform: 'sine', freq: 400, fm: { ratio: 2, index: 3, indexEnd: 0.25, time: 0.4 } });
  eq('indexEnd sweeps the deviation (0.25 x 800)', firstTarget(g.modGain?.gain), 200);
  check('a static index schedules no sweep',
    build({ waveform: 'sine', freq: 400, fm: { ratio: 2, index: 3 } }).modGain.gain.log.every(e => e.type !== 'target'));
}
{
  const g = build({ waveform: 'sine', freq: 300, fm: { rate: 900, depth: 400, depthTo: 20, rateTo: 120, time: 0.2 } });
  eq('legacy depthTo still sweeps the deviation', firstTarget(g.modGain?.gain), 20);
  eq('legacy rateTo still sweeps the modulator pitch', firstTarget(g.mod?.frequency), 120);
}

// ── a ratio-authored modulator follows its carrier through a bend ────────────
{
  const g = build({ waveform: 'sine', freq: 400, pitchBend: { to: 100, time: 0.3 }, fm: { ratio: 2, index: 1 } });
  eq('modulator follows the pitch bend, holding the ratio (100 x 2)', firstTarget(g.mod?.frequency), 200);
  // Without this the bend is a DETUNE: the carrier drops and the modulator stays,
  // so the timbre arrives somewhere the author never chose.
  const noRatio = build({ waveform: 'sine', freq: 400, pitchBend: { to: 100, time: 0.3 }, fm: { rate: 800, depth: 300 } });
  check('an absolute modulator does NOT follow a bend (unchanged behaviour)',
    noRatio.mod.frequency.log.every(e => e.type !== 'target'));
  const explicit = build({ waveform: 'sine', freq: 400, pitchBend: { to: 100, time: 0.3 }, fm: { ratio: 2, index: 1, rateTo: 55 } });
  eq('an explicit rateTo still wins over the derived one', firstTarget(explicit.mod?.frequency), 55);
}

// ── velocity reaches the timbre, not only the level ──────────────────────────
{
  const at = (v) => firstSet(build({ waveform: 'sine', freq: 220, velocity: v, fm: { ratio: 1, index: 2, bright: 1.5 } }).modGain?.gain);
  check('playing harder opens the index', at(0.95) > at(0.2), `${at(0.2)} -> ${at(0.95)}`);
  eq('mid velocity is the authored index, so the table reads as written', at(0.5), 2 * 220);
  // Without `bright`, velocity must not touch the timbre at all — otherwise every
  // instrument authored before this quietly changed character.
  const noBright = (v) => firstSet(build({ waveform: 'sine', freq: 220, velocity: v, fm: { ratio: 1, index: 2 } }).modGain?.gain);
  check('velocity does nothing without bright', noBright(0.1) === noBright(1.0));
  // A cue with no velocity at all — every SFX in the game — is untouched.
  eq('no velocity is the authored index', firstSet(build({ waveform: 'sine', freq: 220, fm: { ratio: 1, index: 2, bright: 1.5 } }).modGain?.gain), 440);
  // The sweep target is where the note SETTLES, and a hard note settles in the
  // same place as a soft one — scaling it too would make loud notes ring bright.
  const hard = build({ waveform: 'sine', freq: 220, velocity: 1, fm: { ratio: 1, index: 2, indexEnd: 0.1, bright: 1.5 } });
  eq('velocity does not scale the sweep target', firstTarget(hard.modGain?.gain), 22);
}

// ── modulator waveform ───────────────────────────────────────────────────────
{
  check('modulator defaults to sine', build({ waveform: 'square', freq: 200, fm: { ratio: 1, index: 1 } }).mod.type === 'sine');
  check('modulator honours fm.wave', build({ waveform: 'sine', freq: 200, fm: { ratio: 1, index: 1, wave: 'square' } }).mod.type === 'square');
  check('a nonsense modulator wave falls back to sine, never throws',
    build({ waveform: 'sine', freq: 200, fm: { ratio: 1, index: 1, wave: 'bagpipe' } }).mod.type === 'sine');
}

// ── op2 is in SERIES ─────────────────────────────────────────────────────────
{
  const g = build({ waveform: 'sine', freq: 220, fm: { ratio: 1, index: 2, op2: { ratio: 4, index: 1.5 } } });
  check('op2 creates a third oscillator', g.oscs.length === 3, `got ${g.oscs.length}`);
  check('op2 feeds the MODULATOR, not the carrier', !!g.op2 && g.op2 !== g.mod && g.op2 !== g.carrier);
  eq('op2 ratio is against the NOTE, not against op1 (220 x 4)', firstSet(g.op2?.frequency), 880);
  eq('op2 index is deviation / its own freq (1.5 x 880)', firstSet(g.op2Gain?.gain), 1320);
  const swept = build({ waveform: 'sine', freq: 220, fm: { ratio: 1, index: 2, time: 0.3, op2: { ratio: 4, index: 1.5, indexEnd: 0.1 } } });
  eq('op2 inherits fm.time when it declares none', firstTarget(swept.op2Gain?.gain), 88);
}

// ── nothing authored before today changes ────────────────────────────────────
{
  const legacy = build({ waveform: 'sine', freq: 220, fm: { rate: 440, depth: 300 } });
  check('a legacy fm block builds exactly two oscillators', legacy.oscs.length === 2, `got ${legacy.oscs.length}`);
  check('a legacy modulator is a sine', legacy.mod.type === 'sine');
  eq('a legacy depth default is still 100', firstSet(build({ waveform: 'sine', freq: 220, fm: { rate: 440 } }).modGain?.gain), 100);
  check('no rate and no ratio means no modulator at all',
    build({ waveform: 'sine', freq: 220, fm: { depth: 400, wave: 'square' } }).oscs.length === 1);
  check('no fm block at all still builds', build({ waveform: 'sine', freq: 220 }).oscs.length === 1);
}

// ── sustain: the handle exists only for a voice that can be held ─────────────
{
  const struck = build({ waveform: 'sine', freq: 220, fm: { ratio: 1, index: 1 } });
  check('an ordinary cue returns no handle', struck.handle === null);
  const held = build({ waveform: 'sine', freq: 220, adsr: { a: 0.01, d: 0.1, s: 0.6, r: 0.1 }, fm: { ratio: 1, index: 1 } }, { sustain: true });
  check('a sustained cue returns a release handle', typeof held.handle?.release === 'function');
  // The latch is the trap this guards: buildLayer's release() fires once, and a
  // non-sustained cue has already spent it during build, so a keyup would be a
  // silent no-op. Releasing a sustained voice must actually schedule the ramp.
  const before = held.carrier ? nodes.filter(n => n.kind === 'osc' && n.stopped != null).length : 0;
  held.handle.release();
  const after = nodes.filter(n => n.kind === 'osc' && n.stopped != null).length;
  check('releasing a sustained voice stops its oscillators', after > before, `${before} -> ${after}`);
}

// ── the instrument table agrees with all of it ───────────────────────────────
{
  const piano = P.buildNoteCue({ instrument: 'piano', note: 'C4', velocity: 0.7 });
  const organ = P.buildNoteCue({ instrument: 'organ', note: 'C4', velocity: 0.7 });
  check('a struck voice is not marked sustained', !piano.sustained);
  check('the organ is marked sustained', organ.sustained === true);
  check('a struck voice decays to silence on its own (s = 0)', piano.config.layers[0].adsr.s === 0);
  check('a blown voice holds at a level above silence', organ.config.layers[0].adsr.s > 0);
  // Velocity has to reach the TIMBRE, not only the gain — it is the whole reason
  // a piano sounds different played hard rather than just louder.
  const soft = P.buildNoteCue({ instrument: 'piano', note: 'C4', velocity: 0.2 });
  const hard = P.buildNoteCue({ instrument: 'piano', note: 'C4', velocity: 0.95 });
  check('velocity opens the modulation index', hard.config.layers[0].fm.index > soft.config.layers[0].fm.index);

  // ⚠ THE MIGRATION INVARIANT. note() was rewritten from absolute Hz
  // (rate: freq*ratio, depth: freq*index) into the ratio/index spelling, which is
  // what let these five voices become ordinary instrument configs. The two forms
  // divide by `ratio` differently — the engine's index is against the MODULATOR
  // and the old depth was against the CARRIER — so the rewrite is either exactly
  // equal or it silently retuned every instrument in the game. Asserted, not
  // assumed, across the whole table and the range.
  //
  // `piano` is ratio 1 and would pass under a wrong conversion; `rhodes` at 14:1
  // is the case that actually proves it.
  {
    const TABLE = P.INSTRUMENTS;
    let drift = [];
    for (const [name, ins] of Object.entries(TABLE)) {
      for (const n of ['C2', 'C4', 'A5']) for (const vel of [0.2, 0.75, 1]) {
        const cue = P.buildNoteCue({ instrument: name, note: n, velocity: vel });
        const g = build(cue.config.layers[0]);
        const freq = cue.config.layers[0].freq;
        const idx = ins.index * (1 + (vel - 0.5) * ins.bright);
        const want = { rate: freq * ins.ratio, depth: freq * idx, to: freq * ins.indexEnd };
        const got = { rate: firstSet(g.mod?.frequency), depth: firstSet(g.modGain?.gain), to: firstTarget(g.modGain?.gain) };
        for (const k of ['rate', 'depth', 'to']) {
          if (!near(got[k], want[k], Math.abs(want[k]) * 1e-9 + 1e-9)) drift.push(`${name}/${n}/${vel} ${k}: ${want[k]} -> ${got[k]}`);
        }
      }
    }
    check('the ratio/index rewrite reproduces the old numbers exactly', drift.length === 0,
      `${drift.length} of 45 cases drifted, e.g. ${drift.slice(0, 3).join(' | ')}`);
  }

  // ── one kind of instrument ────────────────────────────────────────────────
  // Two systems that could not share a voice: this table, and audio_instruments
  // in the DB. Both directions now work, and both are asserted, because "it is
  // one system now" is exactly the kind of claim that quietly stops being true.
  for (const name of Object.keys(P.INSTRUMENTS)) {
    const cfg = P.voiceConfig(name);
    check(`${name} is expressible as an instrument config`, !!cfg?.fm?.ratio && !!cfg.adsr && !!cfg.waveform);
    // …and playing that config back produces a real note, which is the half a
    // tracker actually exercises.
    const fromCfg = P.buildNoteCue({ config: cfg, note: 'E4', velocity: 0.8 });
    check(`${name} plays back from its own config`, fromCfg?.config?.layers?.length > 0);
    const g = build(fromCfg.config.layers[0]);
    check(`${name} keeps its ratio through the round trip`,
      near(firstSet(g.mod?.frequency) / fromCfg.config.layers[0].freq, P.INSTRUMENTS[name].ratio, 1e-9));
  }
  check('an unknown voice name yields no config, rather than a wrong one', P.voiceConfig('harpsichord') === null);
  // A blown voice stays blown through the config route, or the organ silently
  // becomes a struck instrument the moment a song plays it.
  check('sustain survives the config route', P.buildNoteCue({ config: P.voiceConfig('organ'), note: 'C4' })?.sustained === true);
  check('…and a struck voice does not gain it', !P.buildNoteCue({ config: P.voiceConfig('piano'), note: 'C4' })?.sustained);
  // Two ears in one room build the performance independently; they must agree.
  const again = P.buildNoteCue({ instrument: 'piano', note: 'C4', velocity: 0.7 });
  check('a note is deterministic — no vary() in the instrument path',
    JSON.stringify(again.config) === JSON.stringify(piano.config));
}

// ── drive: harmonics without level ───────────────────────────────────────────
{
  const g = build({ waveform: 'sine', freq: 220, drive: 0.6, fm: { ratio: 1, index: 1 } });
  const shaper = nodes.find(n => n.kind === 'shaper');
  check('drive inserts a waveshaper', !!shaper);
  check('…oversampled, or the clipper aliases', shaper?.oversample === '4x');
  check('…with a real curve', shaper?.curve?.length > 0);
  // The whole reason for normalising: a drive control that is also a volume
  // control cannot be used. Full scale in must stay full scale out.
  const c = shaper.curve;
  check('the curve is normalised to unity at full scale', Math.abs(c[c.length - 1] - 1) < 1e-6, String(c[c.length - 1]));
  check('…and symmetric about zero', Math.abs(c[0] + 1) < 1e-6, String(c[0]));
  let monotonic = true;
  for (let i = 1; i < c.length; i++) if (c[i] < c[i - 1]) monotonic = false;
  check('…and monotonic, so it clips rather than folds', monotonic);
  // A gentle drive must actually differ from a hard one, or the control is inert.
  const soft = build({ waveform: 'sine', freq: 220, drive: 0.1 }).oscs;
  check('different drives build different curves',
    driveCurveOf(0.1) !== driveCurveOf(0.9) && soft.length === 1);
  // ⚠ The routing trap: the filter branch used to connect from `gain` by name,
  // which would route straight past the shaper and leave a driven layer sounding
  // identical to an undriven one.
  const withFilter = build({ waveform: 'sine', freq: 220, drive: 0.6, filter: { type: 'lowpass', freq: 900 } });
  const sh = nodes.find(n => n.kind === 'shaper');
  const filt = nodes.find(n => n.kind === 'filter');
  check('the filter is fed BY the shaper, not around it', sh?.out.includes(filt), 'drive is being bypassed');
  check('an undriven layer builds no shaper', !build({ waveform: 'sine', freq: 220 }).oscs.some(() => false)
    && !nodes.some(n => n.kind === 'shaper'));
  void g; void withFilter;
}
function driveCurveOf(d) {
  build({ waveform: 'sine', freq: 220, drive: d });
  return nodes.find(n => n.kind === 'shaper')?.curve;
}

// ── the room ─────────────────────────────────────────────────────────────────
{
  const names = A.spaceNames();
  check('the engine ships more than one room', names.length >= 5, names.join(','));
  check('outdoor is a space, not the absence of one', names.includes('outdoor'));
  for (const n of names) {
    A.setSpace(n, { instant: true });
    const conv = allNodes.filter(x => x.kind === 'convolver').pop();
    const buf = conv?.buffer;
    check(`${n}: has a generated impulse`, !!buf && buf.length > 0);
    check(`${n}: is stereo, or it is a mono reverb in a stereo buffer`, buf?.numberOfChannels === 2);
    // The two channels must not be the same noise — that is the whole point of a
    // room, and it is an easy thing to get wrong by generating once and copying.
    if (buf) {
      const a = buf.getChannelData(0), b = buf.getChannelData(1);
      let same = true;
      for (let i = 0; i < a.length; i += 97) if (a[i] !== b[i]) { same = false; break; }
      check(`${n}: the two ears hear different rooms`, !same);
      // ⚠ "They differ" is NOT enough on its own, and a mutation proved it: write
      // both passes into channel 0 and channel 1 stays silent, which differs
      // beautifully. Each channel has to carry actual energy.
      const energy = (d) => { let e = 0; for (let i = 0; i < d.length; i += 13) e += Math.abs(d[i]); return e; };
      check(`${n}: both channels carry a tail`, energy(a) > 0 && energy(b) > 0, `L=${energy(a).toFixed(2)} R=${energy(b).toFixed(2)}`);
      // Decaying, not a gate: the tail has to be quieter than the head.
      const head = Math.abs(a[Math.floor(a.length * 0.08)]);
      const tail = Math.abs(a[Math.floor(a.length * 0.95)]);
      check(`${n}: the tail decays`, tail < head || head === 0, `${head} -> ${tail}`);
      check(`${n}: nothing is NaN`, a.every(v => Number.isFinite(v)));
    }
  }
  A.setSpace('outdoor', { instant: true });
}

// ── the accessibility bus stays dry ──────────────────────────────────────────
// Read Aloud speaks through `channel: 'ui'`, which used to route to the sfx bus.
// The moment that bus grew a reverb send, a player relying on the log reader
// heard their reader reverberating in a stone church — room ambience is texture
// for the world and damage on the one voice whose job is to be understood.
//
// Walked from the graph rather than asserted about the source, because the way
// this breaks is a routing change somewhere else, not an edit to this rule.
{
  const gains = allNodes.filter(n => n.kind === 'gain');
  const conv = allNodes.find(n => n.kind === 'convolver');
  const send = gains.find(g => g.out.includes(conv));
  check('there is a reverb send', !!send && !!conv);
  // Every bus that feeds the send, by identity.
  const feedsSend = new Set(gains.filter(g => g.out.includes(send)));
  const speechOut = A._speechBus?.();
  check('speech exposes the bus it would use for Read Aloud', !!speechOut);
  check('the Read Aloud bus does NOT feed the reverb', !feedsSend.has(speechOut),
    'a screen reader is now reverberating');
  check('…and still reaches the master, so it is audible at all', speechOut?.out.length > 0);
  // The world buses SHOULD feed it, or the reverb is doing nothing.
  check('some bus does feed the reverb', feedsSend.size >= 1, 'reverb send has no inputs');
}

// ── the formant voice, as a graph ────────────────────────────────────────────
// scripts/voice/smoke.mjs covers what the voice SAYS (phonemes, stress, pacing)
// and deliberately never builds a context. This covers what it BUILDS, which had
// no coverage at all, and which is where drive and growl now live.
{
  const seeds = ['architect', 'raptor', 'kesh', 'vess', 'maresh', 'teague', 'pike', 'cyd'];
  let anyDrive = 0, anyGrowl = 0, unstarted = 0, unstopped = 0;
  for (const seed of seeds) {
    nodes = [];
    const res = A.speak('testing one two three', { seed });
    check(`${seed}: speaks and reports a duration`, res && res.duration > 0, JSON.stringify(res));
    const oscs = nodes.filter(n => n.kind === 'osc');
    // ⚠ EVERY SOURCE MUST BE STARTED AND STOPPED. The voice collects its
    // oscillators into one array and starts/stops them together; growl was
    // very nearly wired up by hand instead, which would have left a tone
    // running past a cancelled line with no reference left to stop it.
    unstarted += oscs.filter(o => o.started == null).length;
    unstopped += oscs.filter(o => o.stopped == null).length;
    if (nodes.some(n => n.kind === 'shaper')) anyDrive++;
    const v = A._voiceFor(seed);
    if (v.growl > 0) anyGrowl++;
    // Growl is exactly one extra oscillator, and only when it was rolled.
    check(`${seed}: growl adds a source only when present`,
      oscs.length === (v.growl > 0 ? 6 : 5), `${oscs.length} oscs, growl ${v.growl}`);
    check(`${seed}: drive builds a shaper only when present`,
      nodes.some(n => n.kind === 'shaper') === (v.drive > 0));
  }
  check('every oscillator the voice builds is started', unstarted === 0, `${unstarted} left unstarted`);
  check('…and stopped, so a cancelled line leaves nothing running', unstopped === 0, `${unstopped} left unstopped`);
  check('some voices are driven and some are clean', anyDrive > 0 && anyDrive < seeds.length, `${anyDrive}/${seeds.length}`);

  // The traits have to be RARE. A trait every voice has marks nobody out, which
  // is the same reason two thirds of the cast get no breath.
  let d = 0, g = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const v = A._voiceFor(`sample-voice-${i}`);
    if (v.drive > 0) d++;
    if (v.growl > 0) g++;
  }
  check('drive is a minority trait', d / N > 0.2 && d / N < 0.5, `${(d / N * 100).toFixed(0)}%`);
  check('growl is rarer still', g / N > 0.05 && g / N < 0.25, `${(g / N * 100).toFixed(0)}%`);

  // ⚠ THE DRAW-ORDER TRAP, guarded for the first time. voiceFromName pulls every
  // parameter from one seeded sequence, so inserting a field ABOVE an existing
  // one shifts every draw after it and silently recasts every narrator in the
  // game — a change with no error, no failing test and no way to notice except
  // by recognising that somebody sounds wrong. The file already carries a comment
  // saying so (see `oq`); nothing enforced it.
  //
  // Pinning two voices is enough: any insertion anywhere in the sequence moves at
  // least one of these.
  // ⚠ Pin an UNNAMED voice, and pin the END of the sequence. `architect` is in
  // NAMED_VOICES, so Object.assign overwrites most of its draws and it is immune
  // to exactly the shift this is guarding — a first cut pinned it, and a mutation
  // that inserted a draw mid-table sailed straight through. `growl` is the last
  // field, so any insertion ANYWHERE above it moves this number.
  const pin = A._voiceFor('pin-18');
  check('the voice draw order has not shifted',
    near(pin.f0, 137.5135407538619, 1e-9) && near(pin.jitter, 0.01332835440337658, 1e-12)
    && near(pin.drive, 0.24641117456369102, 1e-12) && near(pin.growl, 0.06218185827601701, 1e-12),
    `${JSON.stringify({ f0: pin.f0, jitter: pin.jitter, drive: pin.drive, growl: pin.growl })}
      — a field was inserted into voiceFromName above the bottom, which silently recasts every narrator`);
  check('a voice is deterministic', JSON.stringify(A._voiceFor('kesh')) === JSON.stringify(A._voiceFor('kesh')));

  // ⚠ NO CHARACTER ON THE ACCESSIBILITY CHANNEL. Drive and growl are texture, and
  // both trade intelligibility for interest — a fine trade for a narrator and the
  // wrong one for the log reader. `reader` genuinely rolled growl 0.084 the moment
  // these existed, so this is asserted on the SPEAKING path, not on the roll: the
  // seed cannot know what it is for, and the suppression is the caller's job.
  {
    const rolled = A._voiceFor('reader');
    check('the reader seed does roll a trait, so this test means something',
      (rolled.drive || 0) > 0 || (rolled.growl || 0) > 0,
      'reader now rolls clean by luck — repoint this at a seed that does not');
    nodes = [];
    A.speak('testing one two three', { channel: 'ui', seed: 'reader' });
    check('Read Aloud is never driven', !nodes.some(n => n.kind === 'shaper'));
    check('…and never growls', nodes.filter(n => n.kind === 'osc').length === 5,
      `${nodes.filter(n => n.kind === 'osc').length} oscillators`);
  }

  // ── the pitch contour ─────────────────────────────────────────────────────
  // The prosody layer had NO coverage at either end: voice/smoke.mjs asserts what
  // is said (phonemes, stress, reduction) and never builds a context, and nothing
  // here looked at pitch. Declination, the terminal rise and per-phrase contour
  // are all scheduled onto glot.frequency, so they are observable now — and this
  // is exactly the class of thing that breaks without erroring. A voice that stops
  // falling at a full stop does not throw; it just stops sounding like English.
  {
    const contour = (text) => {
      nodes = [];
      A.speak(text, { seed: 'contour' });
      const g = nodes.filter(n => n.kind === 'osc').find(o => o.frequency.log.length > 3);
      return (g?.frequency.log || []).map(e => e.value);
    };
    const stmt = contour('the door is closed.');
    const ques = contour('is the door closed?');
    check('a statement has a contour at all', stmt.length > 3, `${stmt.length} points`);
    check('a statement falls', stmt[stmt.length - 1] < stmt[0], `${stmt[0]} -> ${stmt[stmt.length - 1]}`);
    check('a question RISES', ques[ques.length - 1] > ques[0], `${ques[0]} -> ${ques[ques.length - 1]}`);
    // The one that matters most: the two must not be the same shape. A rise
    // detector that quietly stops matching leaves every question sounding like a
    // statement, which is both wrong and completely silent as a failure.
    check('a question does not end where a statement ends',
      ques[ques.length - 1] > stmt[stmt.length - 1] * 1.2,
      `question ${ques[ques.length - 1]}, statement ${stmt[stmt.length - 1]}`);
    // A LINE THAT TRAILS OFF ENDS LOWER THAN ONE THAT LANDS. This is asserted on
    // the FINAL point, which is the creak target — and it could not be asserted at
    // all until creak stopped erasing the distinction: the terminal contour set a
    // trail-dependent target at end-0.18 and creak overwrote it 110ms later at a
    // flat F0*cf on every statement.
    const trail = contour('the door is closed...');
    check('a line trailing off ends lower than one landing',
      trail[trail.length - 1] < stmt[stmt.length - 1],
      `trailing ${trail[trail.length - 1]}, full stop ${stmt[stmt.length - 1]}`);

    // ⚠ NOT ASSERTED HERE: per-phrase declination. A first cut compared the
    // penultimate contour point of "closed..." against "closed." and passed — but
    // it still passed with `phraseDecl` flattened to a constant, so it measured the
    // wrong thing: an `_E` pause is 430ms against `__`'s 250ms, which moves where
    // the contour gets sampled, and THAT was the difference. A test that passes for
    // the wrong reason is worse than none, because it reports coverage it lacks.
    // Asserting it properly means separating declination from phrase duration,
    // which this probe cannot do — it reads scheduled points, not a curve.
  }

  // ── a burst has a SHAPE, not just a frequency ─────────────────────────────
  // Every stop used to be released through one fixed band (Q 2, 20ms, one level)
  // with only the centre frequency moving — and shape is most of what the
  // classical place features describe. A velar is COMPACT (one sharp mid peak)
  // and the longest release; a labial is DIFFUSE and weak, because there is no
  // cavity in front of the lips to resonate it.
  //
  // Read off the scheduled Q on the noise bandpass, which is where a burst
  // actually lands. Speaking a nonsense word per place keeps each one isolated.
  {
    // ⚠ Follow the NOISE SOURCE to find it. "The first filter with a scheduled Q"
    // picks up a formant bandpass instead — the voiced path schedules Q too, and a
    // first cut read 7.89 off a vowel for all three places and reported no
    // difference where there was one.
    const burstQs = (word) => {
      nodes = [];
      A.speak(word, { seed: 'burst-probe' });
      const nz = nodes.find(n => n.kind === 'buffersrc');
      const nbp = nz?.out.find(o => o?.kind === 'filter');
      return (nbp?.Q.log || []).map(e => e.value);
    };
    const pa = burstQs('pa'), ta = burstQs('ta'), ka = burstQs('ka');
    const maxQ = (a) => Math.max(...a);
    check('a velar burst is the most compact', maxQ(ka) > maxQ(ta) && maxQ(ta) > maxQ(pa),
      `k ${maxQ(ka)}, t ${maxQ(ta)}, p ${maxQ(pa)}`);
    // And the three places must not all schedule the same shape, which is the
    // state this replaced — the failure mode is silent identity, not an error.
    check('the three places do not share one burst shape',
      new Set([maxQ(pa), maxQ(ta), maxQ(ka)]).size === 3);
  }

  // A named voice is fully authored, including the traits it does not have.
  // Anything absent falls through to the dice, so adding a parameter silently
  // recharacterises every hand-tuned voice in the game.
  const named = A._voiceFor('architect');
  check('a named voice picks up no rolled character', !named.drive && !named.growl,
    `drive ${named.drive}, growl ${named.growl} — add the new trait to NAMED_VOICES`);
}

// ── the voice pool ───────────────────────────────────────────────────────────
{
  const before = A._voiceStats();
  // ⚠ The pool and the tracker's channel count were the same number, so a dense
  // song could hold every slot and a fight would spend the whole time evicting
  // it. Whatever the pool is, it must be bigger than one song.
  check('the voice pool is larger than a full tracker song', before.size > 16, `size ${before.size}`);
  check('the pool reports what it is doing', typeof before.played === 'number' && typeof before.dropped === 'number');
  for (let i = 0; i < before.size + 6; i++) build({ waveform: 'sine', freq: 300 + i });
  const after = A._voiceStats();
  check('playing counts as playing', after.played > before.played);
  check('a full pool steals rather than silently doing nothing', after.stolen > before.stolen, JSON.stringify(after));
  check('peak never exceeds the pool', after.peak <= after.size, `${after.peak}/${after.size}`);
}

// ── the dev panel can reach every key the engine reads ───────────────────────
// This is the gap the whole exercise started from, generalised so it cannot come
// back: the panel shipped for months exposing `rate` and `depth` and nothing
// else, so the sweep — the most expressive control in the file — was authorable
// only by editing JS. Adding a key to buildLayer and not to the form recreates
// that silently.
//
// Worse than unreachable: a form that RENDERS a layer it cannot read is a
// deletion tool. `depthTo` was briefly in exactly that state, and 57 of the 102
// hockey layers carry one, all of them editable through HockeySfx.BUILTINS —
// opening any of those presets and pressing save would have quietly turned a
// struck impact into a steady buzz.
//
// Textual on purpose. audio.js is a devpanel classic script with the whole panel
// behind it; importing it here to ask the DOM would drag in more than this check
// is worth, and the question — "is there a field for this key?" — is answerable
// from the source.
{
  const src = readFileSync(join(ROOT, 'client/devpanel/js/panels/audio.js'), 'utf8');
  const fieldIds = new Set([...src.matchAll(/\$\{(?:prefix|p)\}-([a-z0-9]+)/g)].map(m => m[1]));
  // engine key -> the field id that carries it.
  //
  // ⚠ op2 is DELIBERATELY PARTIAL, and this list is why that needs saying out
  // loud: `op2.rate`, `.depth`, `.depthTo`, `.rateTo`, `.ratioTo`, `.time` and
  // `.wave` all work in the engine and are JSON-only. Three fields is the useful
  // shape of a second operator and thirteen would swamp the form — but a guard
  // that only checks the keys somebody chose to expose reads as complete when it
  // is not, so: if you expose more of op2, add it here; if you add a key to the
  // FIRST operator, this list is not optional.
  const WANT = {
    ratio: 'fmratio', rate: 'fmrate', index: 'fmindex', depth: 'fmdepth',
    indexEnd: 'fmindexend', depthTo: 'fmdepthto',
    ratioTo: 'fmratioto', rateTo: 'fmrateto',
    time: 'fmtime', wave: 'fmwave', bright: 'fmbright',
    'op2.ratio': 'op2ratio', 'op2.index': 'op2index', 'op2.indexEnd': 'op2indexend',
  };
  for (const [key, id] of Object.entries(WANT)) {
    check(`the dev panel has a field for fm.${key}`, fieldIds.has(id), `no #\${prefix}-${id} in audio.js`);
  }
  // ── and the form ROUND-TRIPS, which is a different question ────────────────
  // "Is the id mentioned in the reader?" is not the check that matters: the id
  // can be read into a local and then never emitted, which is exactly the shape
  // the depthTo bug had. So render a layer through the real field builder, parse
  // the values back out of the HTML it produced, and read them with the real
  // reader. If anything is lost between the two, that is a save that silently
  // edits somebody's cue.
  const bodies = ['function instrumentLikeConfigFields', 'function _readFmBlock']
    .map(sig => src.slice(src.indexOf(sig)).match(/^[\s\S]*?\n}/)[0]);
  let fakeDoc = null;
  const fns = new Function('_help', 'document', `${bodies.join('\n')}
    return { render: instrumentLikeConfigFields, read: _readFmBlock };`)(
    () => '', { getElementById: (id) => fakeDoc?.[id] ?? null });

  function roundTrip(layer) {
    const html = fns.render(layer, 'am');
    fakeDoc = {};
    for (const m of html.matchAll(/id="am-([a-z0-9]+)"[^>]*value="([^"]*)"/g)) fakeDoc[`am-${m[1]}`] = { value: m[2] };
    const sel = /<select id="am-fmwave">([\s\S]*?)<\/select>/.exec(html);
    fakeDoc['am-fmwave'] = { value: /value="([a-z]+)" selected/.exec(sel?.[1] || '')?.[1] || 'sine' };
    return fns.read('am');
  }

  // Real data, not a fixture: these are the layers that would actually have been
  // damaged, and 57 of them carry the sweep.
  const hockey = (globalThis.HockeySfx?.BUILTINS || []).flatMap(p => p.config?.layers || []).filter(l => l.fm);
  check('hockey presets loaded for the round-trip', hockey.length > 0, 'HockeySfx.BUILTINS empty');
  let lost = [];
  for (const layer of hockey) {
    const back = roundTrip(layer);
    for (const [k, v] of Object.entries(layer.fm)) {
      if (typeof v !== 'number') continue;
      if (!(k in (back || {})) || Math.abs(back[k] - v) > 1e-9) lost.push(`${k} (${v} -> ${back?.[k]})`);
    }
  }
  check('every hockey fm layer survives a dev-panel round-trip', lost.length === 0,
    `${lost.length} value(s) lost, e.g. ${[...new Set(lost)].slice(0, 4).join(', ')}`);

  // The new spellings too, and the off case.
  const r = roundTrip({ waveform: 'sine', freq: 220, fm: { ratio: 3, index: 2, indexEnd: 0.1, ratioTo: 1.5, time: 0.4, wave: 'square', op2: { ratio: 4, index: 1.2, indexEnd: 0 } } });
  check('ratio/index/op2 survive the round-trip',
    r?.ratio === 3 && r?.index === 2 && r?.indexEnd === 0.1 && r?.ratioTo === 1.5 && r?.wave === 'square'
    && r?.op2?.ratio === 4 && r?.op2?.index === 1.2 && r?.op2?.indexEnd === 0, JSON.stringify(r));
  check('a layer with no fm reads back as none', roundTrip({ waveform: 'sine', freq: 220 }) === null);
}

if (fails) { console.error(`\nFM smoke FAILED (${fails})`); process.exit(1); }
console.log('FM smoke passed');
