// ORACLE worklet smoke: the only automated coverage the worklet back end has.
//
//   node scripts/voice/worklet-smoke.mjs
//
// The worklet (client/shared/oracle-worklet.js) is a prototype the Voice Lab A/Bs against
// the node graph. Its failures are all silent: a track list out of step between the two
// files shifts every control by one, a resonator that blows up is a burst of noise, and a
// recorder that samples setTargetAtTime wrong is a voice that is merely worse. None of
// them throws.
//
// Needs no browser, DB or network. The engine runs against a stub AudioContext and a stub
// AudioWorkletNode that keeps what speak() posts; the processor runs here on the main
// thread, block by block, over those tracks, as the audio thread would run it.
//
// WHAT IT GUARDS:
//   - the engine's WK_TRACK and the worklet's TRACK are the same list
//   - a worklet line falls back to the graph until the module has loaded, and says so
//   - the recorders sample a closed tract (the /b/ of "a bee") into the closure track
//   - a rendered line is finite, not silent, and never blows up
//   - vowel formants come out where the tracks put them
//   - cancel() stops a worklet line
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (p) => new Function(readFileSync(join(ROOT, p), 'utf8'))();
const SR = 48000;

// ── Stub context: enough graph for speak() to build and schedule into ─────────
const param = (v = 0) => ({ value: v, setValueAtTime() { return this; }, setTargetAtTime() { return this; },
  linearRampToValueAtTime() { return this; }, exponentialRampToValueAtTime() { return this; }, cancelScheduledValues() { return this; } });
const node = (extra = {}) => ({ connect: (d) => d, disconnect() {}, start() {}, stop() {}, ...extra });
class FakeContext {
  constructor() {
    this.currentTime = 0; this.sampleRate = SR; this.state = 'running'; this.destination = node();
    this.audioWorklet = { addModule: () => Promise.resolve() };
  }
  createGain() { return node({ gain: param(1) }); }
  createOscillator() { return node({ type: 'sine', frequency: param(440), detune: param(0), setPeriodicWave() {} }); }
  createBiquadFilter() { return node({ type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0), detune: param(0) }); }
  createBufferSource() { return node({ buffer: null, loop: false, playbackRate: param(1), detune: param(0) }); }
  createDelay() { return node({ delayTime: param(0) }); }
  createStereoPanner() { return node({ pan: param(0) }); }
  createDynamicsCompressor() { const n = node(); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = param(0); return n; }
  createWaveShaper() { return node({ curve: null, oversample: 'none' }); }
  createConvolver() { return node({ buffer: null }); }
  createPeriodicWave() { return {}; }
  createBuffer(ch, len) { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: SR, getChannelData: (i) => d[i] }; }
  resume() { return Promise.resolve(); }
}
// Every worklet node speak() makes, with what was posted to it.
const made = [];
class FakeWorkletNode {
  constructor(ctx, name, opts) {
    this.name = name; this.opts = opts; this.posted = []; this.connected = []; this.disconnected = false;
    this.port = { postMessage: (m) => this.posted.push(m), onmessage: null };
    made.push(this);
  }
  connect(d) { this.connected.push(d); return d; }
  disconnect() { this.disconnected = true; }
}
globalThis.window = globalThis;
globalThis.AudioContext = FakeContext;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);

load('client/shared/formant-cmudict.js');
load('client/shared/audio-engine.js');
const A = globalThis.AudioEngine;
if (!A?.loadVoiceWorklet) { console.error('x audio-engine has no worklet back end (loadVoiceWorklet)'); process.exit(1); }

// ── The processor, loaded as the audio thread would load it ────────────────────
let Proc = null;
globalThis.sampleRate = SR;
globalThis.currentTime = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => { this.port.last = m; }, onmessage: null }; } };
globalThis.registerProcessor = (name, cls) => { if (name === 'oracle-voice') Proc = cls; };
const TRACK = new Function(readFileSync(join(ROOT, 'client/shared/oracle-worklet.js'), 'utf8') + '\nreturn TRACK;')();

let fails = 0;
function check(label, cond, detail) {
  if (cond) return;
  fails++;
  console.error(`  x ${label}${detail ? `\n      ${detail}` : ''}`);
}

check('the worklet registers oracle-voice', typeof Proc === 'function');
A.applyVolumeSettings({ enabled: true, tv: true, master: 1, tvVolume: 1 });

// Before the module has loaded: the graph speaks, and says so.
globalThis.AudioWorkletNode = FakeWorkletNode;
A._setVoiceWorkletUrl('oracle-worklet.js');
const early = A.speak('Bean.', { seed: 'smoke', backend: 'worklet' });
check('a worklet line before the module loads falls back to the graph', early?.backend === 'graph', `got ${early?.backend}`);
check('the graph is the default', A.speak('Bean.', { seed: 'smoke' })?.backend === 'graph');
check('the module loads', await A.loadVoiceWorklet() === true);
A.cancelSpeech();

// One worklet line: what it posted, and the processor run over it.
function render(text) {
  made.length = 0;
  const trace = [];
  const res = A.speak(text, { seed: 'Dex Rime', backend: 'worklet', trace });
  const wn = made[made.length - 1];
  const line = wn?.posted.find(m => m.type === 'line');
  if (!line) return { res, wn };
  const p = new Proc({ processorOptions: wn.opts.processorOptions });
  p.port.onmessage({ data: { ...line, t0: 0 } });
  const n = Math.ceil(line.frames * line.frame * SR / 128) + 1;
  const out = new Float32Array(n * 128), blk = new Float32Array(128);
  for (let b = 0; b < n; b++) {
    globalThis.currentTime = (b * 128) / SR;
    blk.fill(0);
    if (!p.process([], [[blk]])) break;
    out.set(blk, b * 128);
  }
  globalThis.currentTime = 0;
  return { res, wn, line, out, trace, proc: p };
}
const col = (line, name, t) => line.tracks[Math.round(t / line.frame) * TRACK.length + TRACK.indexOf(name)];

// The harmonic envelope's local peaks under 4 kHz: each harmonic of F0, searched
// +-8% for its exact frequency, and kept where it beats both neighbours.
function peaks(out, t, f0) {
  const N = 4096, s = Math.floor(t * SR), x = new Float64Array(N);
  for (let i = 0; i < N; i++) x[i] = (out[s + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const amp = (f) => {
    let a = 0, b = 0;
    const w = (2 * Math.PI * f) / SR;
    for (let i = 0; i < N; i++) { a += x[i] * Math.cos(w * i); b -= x[i] * Math.sin(w * i); }
    return 10 * Math.log10(a * a + b * b + 1e-12);
  };
  const H = [];
  for (let k = 1; k * f0 < 4000; k++) {
    let best = -Infinity, bf = 0;
    for (let d = -0.08; d <= 0.0801; d += 0.04) { const f = k * f0 * (1 + d); const v = amp(f); if (v > best) { best = v; bf = f; } }
    H.push([bf, best]);
  }
  return H.filter((h, i) => i > 0 && i < H.length - 1 && h[1] > H[i - 1][1] && h[1] >= H[i + 1][1]);
}

// The track list, from the line itself.
{
  const r = render('Please select the word bean.');
  check('a worklet line uses the worklet', r.res?.backend === 'worklet', `got ${r.res?.backend}`);
  check('one oracle-voice node, connected', r.wn?.name === 'oracle-voice' && r.wn.connected.length === 1);
  check('the engine posts its track names', Array.isArray(r.line?.names));
  check("the engine's WK_TRACK matches the worklet's TRACK", r.line?.names?.join() === TRACK.join(),
    `engine  ${r.line?.names?.join()}\n      worklet ${TRACK.join()}`);
  check('tracks are frames x tracks long', r.line?.tracks?.length === r.line?.frames * TRACK.length);
  let bad = 0, peak = 0, sum = 0;
  for (const v of r.out || []) { if (!Number.isFinite(v)) bad++; else { peak = Math.max(peak, Math.abs(v)); sum += v * v; } }
  const rms = Math.sqrt(sum / Math.max(1, r.out?.length || 1));
  check('a rendered line is finite', bad === 0, `${bad} non-finite samples`);
  check('a rendered line never blows up', peak < 1.5, `peak ${peak.toFixed(3)}`);
  check('a rendered line is not silent', rms > 0.002, `rms ${rms.toFixed(5)}`);
  // A mismatched list is refused, not played shifted.
  const p = new Proc({ processorOptions: {} });
  p.port.onmessage({ data: { ...r.line, names: [...TRACK].reverse(), t0: 0 } });
  check('the worklet refuses a mismatched track list', p.port.last?.type === 'error' && p.process([], [[new Float32Array(128)]]) === false);
  // cancel() reaches the node.
  A.cancelSpeech();
  check('cancel() stops a worklet line', r.wn.posted.some(m => m.type === 'stop') && r.wn.disconnected);
}

// The recorders: a /b/ closes the tract, and the vowel after it opens it again.
{
  const r = render('A bee.');
  const b = r.trace.find(x => x.p === 'B'), iy = r.trace.find(x => x.p === 'IY');
  const shut = b ? col(r.line, 'closure', b.at + 0.03) : NaN, open = iy ? col(r.line, 'closure', iy.at + 0.06) : NaN;
  check('the closure track is up through a /b/', shut > 0.9, `closure ${shut}`);
  check('and down again in the vowel after it', open < 0.1, `closure ${open}`);
  check('voicing is on in the vowel', iy && col(r.line, 'av', iy.at + 0.06) > 0.3);
}

// Formants land where the tracks put them.
{
  const r = render('Ah. Ee. Oo.');
  const want = { AA: [0], IY: [0, 1], UW: [0, 1] };
  for (const [ph, ks] of Object.entries(want)) {
    const v = r.trace.find(x => x.p === ph);
    if (!v) { check(`${ph} is in the line`, false); continue; }
    const t = v.at + 0.03;                       // the 4096 window runs 85 ms from here
    const mid = t + 0.043;
    const f0 = col(r.line, 'f0', mid);
    const pk = peaks(r.out, t, f0);
    for (const k of ks) {
      const target = col(r.line, 'f' + (k + 1), mid);
      const hit = pk.some(([f]) => Math.abs(f - target) / target < 0.12);
      check(`${ph} F${k + 1} comes out near its track (${Math.round(target)} Hz)`, hit,
        `peaks ${pk.map(([f, a]) => Math.round(f) + ':' + Math.round(a)).join(' ')}`);
    }
  }
}

if (fails) { console.error(`x worklet smoke: ${fails} failed`); process.exit(1); }
console.log('worklet smoke passed');
