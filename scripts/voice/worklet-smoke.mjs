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
//   - natural 1 is the voice as it was; natural 0 holds F0 at one value, zeroes the jitter
//     tracks and draws the same pulse every period, and leaves the formants of /a i u/,
//     the bursts and the stop aspiration where natural 1 has them
//   - buzz stays finite and level-matched; crush builds the retro stage; Read Aloud gets
//     no character
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
function render(text, extra = {}) {
  made.length = 0;
  const trace = [];
  const res = A.speak(text, { seed: 'Dex Rime', backend: 'worklet', trace, fresh: true, ...extra });
  const wn = made.filter(m => m.name === 'oracle-voice').pop();
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

// ── Synthiness: the `natural` axis ─────────────────────────────────────────────
// natural 0 takes the human variation out and leaves every segmental cue. So the pitch
// track is one value, the jitter tracks are zero, every glottal period is the same pulse,
// and the formant tracks of a vowel are where natural 1 puts them.
const trackOf = (line, name) => {
  const k = TRACK.indexOf(name), out = [];
  for (let f = 0; f < line.frames; f++) out.push(line.tracks[f * TRACK.length + k]);
  return out;
};
const absMax = (a) => { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); return m; };
// Every period the processor draws, as [amp, te, period].
function cycles(text, extra) {
  const orig = Proc.prototype.cycle, seen = [];
  Proc.prototype.cycle = function (lt) { orig.call(this, lt); seen.push([this.amp, this.lf.te, this.period]); };
  try { return { ...render(text, extra), seen }; } finally { Proc.prototype.cycle = orig; }
}
{
  // Default and natural 1 are the same line, track for track.
  const a = render('Is the door closed? It is GONE.');
  const b = render('Is the door closed? It is GONE.', { voice: { natural: 1 } });
  check('natural 1 is the voice as it was (tracks identical to no setting)',
    a.line && b.line && a.line.tracks.length === b.line.tracks.length && a.line.tracks.every((v, i) => v === b.line.tracks[i]));
  const lines = [['Is the door closed? It is GONE.', {}], ['He shoots, he SCOOOOOORES!!!', { excite: 1 }], ["He's not moving. The building goes quiet.", { excite: -0.8 }]];
  for (const [text, opt] of lines) {
    const r = cycles(text, { ...opt, voice: { natural: 0 } });
    if (!r.line) { check(`natural 0 renders "${text}"`, false); continue; }
    const f0 = trackOf(r.line, 'f0');
    const lo = Math.min(...f0), hi = Math.max(...f0);
    check(`natural 0: F0 is one value through "${text}"`, hi - lo < 1e-3, `F0 ${lo.toFixed(2)}..${hi.toFixed(2)} Hz`);
    const jit = [...trackOf(r.line, 'jitA'), ...trackOf(r.line, 'jitB')];
    check(`natural 0: the jitter tracks are zero through "${text}"`, jit.every(v => v === 0), `max ${absMax(jit)}`);
    const amps = new Set(r.seen.map(c => c[0])), shapes = new Set(r.seen.map(c => c[1].toFixed(9) + '/' + c[2].toFixed(9)));
    check(`natural 0: every period is the same pulse in "${text}"`, amps.size === 1 && amps.has(1) && shapes.size === 1,
      `${amps.size} amplitudes, ${shapes.size} shapes over ${r.seen.length} periods`);
    check(`natural 0 renders "${text}" finite and audible`, r.out.every(Number.isFinite) && absMax(r.out) > 0.01);
  }
  // The other half of the contract: the vowels' formant tracks don't move. Each vowel is a
  // line of its own, so both settings glide in from the same state at the same moment:
  // in one line, natural 0's evened timing would move the vowels and the glides with them.
  for (const [ph, word] of [['AA', 'Ah.'], ['IY', 'Ee.'], ['UW', 'Oo.']]) {
    const n1 = render(word), n0 = render(word, { voice: { natural: 0 } });
    const v1 = n1.trace.find(x => x.p === ph), v0 = n0.trace.find(x => x.p === ph);
    if (!v1 || !v0) { check(`${ph} is in both lines`, false); continue; }
    for (const k of ['f1', 'f2', 'f3', 'q1', 'q2', 'q3']) {
      const a1 = col(n1.line, k, v1.at + 0.06), a0 = col(n0.line, k, v0.at + 0.06);
      check(`natural 0 leaves ${ph} ${k} where natural 1 has it`, Math.abs(a1 - a0) / a1 < 0.005, `${a1.toFixed(1)} vs ${a0.toFixed(1)}`);
    }
  }
  // Stops keep their bursts and aspiration: the frication and aspiration peaks of "a pot"
  // are the same height at both settings (natural moves breath, never a voicing cue). The
  // tracks are 5 ms frames and a burst lasts 20, so a peak reads a little differently as
  // the timing moves it against the frames; 2% allows that and nothing more.
  const p1 = render('A pot. A bed.'), p0 = render('A pot. A bed.', { voice: { natural: 0 } });
  const peak = (r, name) => absMax(trackOf(r.line, name));
  const near = (a, b) => Math.abs(a - b) / Math.max(1e-9, a) < 0.02;
  check('natural 0 keeps the bursts', near(peak(p1, 'af'), peak(p0, 'af')), `${peak(p1, 'af')} vs ${peak(p0, 'af')}`);
  check('natural 0 keeps the aspiration after /p t/', near(peak(p1, 'ah'), peak(p0, 'ah')), `${peak(p1, 'ah')} vs ${peak(p0, 'ah')}`);
  // And the timing evens out: stressed and unstressed vowels move toward one length.
  const spread = (r) => {
    const v = [];
    for (let i = 0; i + 1 < r.trace.length; i++) if (['AX', 'IY', 'EH', 'AA', 'IH', 'UW'].includes(r.trace[i].p)) v.push(r.trace[i + 1].at - r.trace[i].at);
    return Math.max(...v) / Math.min(...v);
  };
  const s1 = spread(render('The architecture of a television.')), s0 = spread(render('The architecture of a television.', { voice: { natural: 0 } }));
  check('natural 0 evens vowel lengths out', s0 < s1, `longest/shortest ${s1.toFixed(2)} at 1, ${s0.toFixed(2)} at 0`);
}

// ── The source as it speaks: tension (Rd) and creak ───────────────────────────
// The worklet's alone. Tension is set per syllable from stress, place in the phrase, pitch
// and delivery, so across a stressed line it moves; at natural 0 it is one value. Creak
// comes at the end of a statement where F0 has dropped, as periods alternating strong and
// weak; at natural 0 there is none.
{
  const text = 'The BIG one is over there, by the old fire station. It is gone.';
  const voicedRd = (r) => {
    const rd = trackOf(r.line, 'rd'), av = trackOf(r.line, 'av');
    return rd.filter((v, i) => av[i] > 0.3);
  };
  check("the engine's track list has a tension track", TRACK.includes('rd') && TRACK.includes('creak'));
  const n1 = cycles(text), n0 = cycles(text, { voice: { natural: 0 } });
  const v1 = voicedRd(n1), v0 = voicedRd(n0);
  const hi1 = Math.max(...v1), lo1 = Math.min(...v1);
  check('tension varies across a stressed line at natural 1', v1.length > 20 && hi1 / lo1 > 1.3, `Rd ${lo1.toFixed(2)}..${hi1.toFixed(2)}`);
  check('tension is one value at natural 0', v0.length > 20 && Math.max(...v0) - Math.min(...v0) < 1e-9,
    `Rd ${Math.min(...v0).toFixed(3)}..${Math.max(...v0).toFixed(3)}`);
  // an emphasised syllable is more pressed (lower Rd) than the unstressed one before it
  const big = n1.trace.find(x => x.p === 'IH' && x.acc === 2), the = n1.trace.find(x => x.p === 'AX');
  if (big && the) {
    const a = col(n1.line, 'rd', big.at + 0.04), b = col(n1.line, 'rd', the.at + 0.03);
    check('an emphasised syllable is pressed harder than an unstressed one', a < b, `Rd ${a.toFixed(2)} on BIG, ${b.toFixed(2)} on the`);
  } else check('the line has its emphasised and unstressed vowels', false, n1.trace.map(x => x.p + (x.acc || '')).join(' '));
  const cr1 = absMax(trackOf(n1.line, 'creak')), cr0 = absMax(trackOf(n0.line, 'creak'));
  check('a statement asks for creak at its end at natural 1', cr1 > 0.2, `creak ${cr1.toFixed(2)}`);
  check('and not at natural 0', cr0 === 0, `creak ${cr0}`);
  // Diplophonia: in the line's last 0.4 s, some pairs of periods differ in strength by a
  // third or more, which jitter and shimmer alone never do.
  const tail = n1.seen.slice(-Math.ceil(0.4 * 100));
  let pairs = 0;
  for (let i = 1; i < tail.length; i++) if (Math.abs(tail[i][0] - tail[i - 1][0]) > 0.33) pairs++;
  check('creak alternates strong and weak periods', pairs >= 3, `${pairs} strong/weak steps in the last ${tail.length} periods`);
  let pairs0 = 0;
  for (let i = 1; i < n0.seen.length; i++) if (n0.seen[i][0] !== n0.seen[i - 1][0]) pairs0++;
  check('and none at natural 0', pairs0 === 0);
  check('the creaky line is finite and stable', n1.out.every(Number.isFinite) && absMax(n1.out) < 1.5, `peak ${absMax(n1.out).toFixed(3)}`);
  // A question doesn't creak.
  const q = render('Is it over there?');
  check('a question asks for no creak', absMax(trackOf(q.line, 'creak')) === 0);
}

// ── Synthiness: the character axis ─────────────────────────────────────────────
{
  // Buzz swaps the source for an impulse train: still finite, bounded and about as loud.
  const rms = (o) => Math.sqrt(o.reduce((s, v) => s + v * v, 0) / o.length);
  const plain = render('Please select the word bean.'), buzz = render('Please select the word bean.', { voice: { buzz: 1 } });
  const db = 20 * Math.log10(rms(buzz.out) / rms(plain.out));
  check('buzz 1 is finite and never blows up', buzz.out.every(Number.isFinite) && absMax(buzz.out) < 1.5);
  check('buzz 1 is within 6 dB of the pulse', Math.abs(db) < 6, `${db.toFixed(1)} dB`);
  check('buzz 1 changes the sound', buzz.out.some((v, i) => Math.abs(v - plain.out[i]) > 1e-3));
  check('buzz 0 posts no buzz', !(plain.line.k.buzz > 0) && buzz.line.k.buzz === 1);
  // Crush builds SIREN's retro stage on the voice; ring modulation builds its carrier;
  // the accessibility channel gets neither.
  A._setRetroUrl('audio-retro-worklet.js');
  check('the retro stage loads', await A.loadRetro(A.engineNodes().ctx) === true);
  made.length = 0;
  A.speak('Bean.', { seed: 'smoke', voice: { crush: 0.5, rmod: 0.5 } });
  const retro = made.find(m => m.name === 'siren-retro');
  const ro = retro?.opts?.processorOptions || {};
  check('crush puts the voice through the retro stage', !!retro && ro.bits === 10 && ro.rate > 9000 && ro.rate < 11000, JSON.stringify(ro));
  check("the retro stage outlives the line's start", ro.until > 1);
  made.length = 0;
  A.speak('Bean.', { seed: 'smoke', voice: { crush: 0.5 } });
  check('crush with no ring modulation still builds', made.some(m => m.name === 'siren-retro'));
  made.length = 0;
  A.speak('Bean.', { seed: 'smoke', channel: 'ui', voice: { crush: 1, rmod: 1, buzz: 1 } });
  check('Read Aloud gets no character', !made.some(m => m.name === 'siren-retro'));
  A.cancelSpeech();
}

if (fails) { console.error(`x worklet smoke: ${fails} failed`); process.exit(1); }
console.log('worklet smoke passed');
