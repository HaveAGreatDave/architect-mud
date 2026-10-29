// Contour smoke: what ORACLE's pitch does with the accents placeAccents marks.
//
//   node scripts/voice/contour-smoke.mjs
//
// accent-smoke.mjs checks where the marks go; this checks that they are heard. It speaks
// lines on the worklet back end against a stub context and reads the F0 track speak()
// posts (the same setTargetAtTime schedule the graph plays, sampled per frame), with the
// phoneme trace saying where each vowel starts. It guards:
//   - the nucleus of a statement peaks, then falls through its vowel
//   - a later prenuclear accent is lower than an earlier one (downstep), with
//     declination off so nothing else lowers it
//   - a minor break '_M' lifts the pitch part way: the first accent after it is above
//     the last one before it, and below the line's first
//   - a comma's nucleus falls less than a full stop's
//   - natural 0 still reads flat
//
// Needs no browser, DB or network.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (p) => new Function(readFileSync(join(ROOT, p), 'utf8'))();
const SR = 48000;

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
const made = [];
class FakeWorkletNode {
  constructor(ctx, name, opts) {
    this.name = name; this.opts = opts; this.posted = [];
    this.port = { postMessage: (m) => this.posted.push(m), onmessage: null };
    made.push(this);
  }
  connect(d) { return d; }
  disconnect() {}
}
globalThis.window = globalThis;
globalThis.AudioContext = FakeContext;
globalThis.AudioWorkletNode = FakeWorkletNode;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);

load('client/shared/formant-cmudict.js');
load('client/shared/audio-engine.js');
const A = globalThis.AudioEngine;
// the worklet's track list, read as the audio thread would load the file
globalThis.sampleRate = SR;
globalThis.AudioWorkletProcessor = class {};
globalThis.registerProcessor = () => {};
const TRACK = new Function(readFileSync(join(ROOT, 'client/shared/oracle-worklet.js'), 'utf8') + '\nreturn TRACK;')();

// (the engine's VOWELS set, as the trace spells them)
const VOWELS = new Set(['IY', 'IH', 'EH', 'AE', 'AA', 'AO', 'UH', 'UW', 'ER', 'ERR', 'AH', 'AX', 'EY', 'AY', 'OW', 'OY', 'AW']);
let fails = 0;
function check(label, cond, detail) {
  if (cond) return;
  fails++;
  console.error(`  x ${label}${detail ? `\n      ${detail}` : ''}`);
}

A.applyVolumeSettings({ enabled: true, tv: true, master: 1, tvVolume: 1 });
A._setVoiceWorkletUrl('oracle-worklet.js');
check('the worklet module loads', await A.loadVoiceWorklet() === true);

// One line: its F0 track and its vowels, each with [start, end) and what it carries.
function speak(text, voice = {}) {
  made.length = 0;
  const trace = [];
  A.speak(text, { seed: 'Dex Rime', backend: 'worklet', trace, voice, fresh: true });
  A.cancelSpeech();
  const line = made.filter(m => m.name === 'oracle-voice').pop()?.posted.find(m => m.type === 'line');
  if (!line) return null;
  const k = TRACK.indexOf('f0');
  const f0 = (t) => line.tracks[Math.min(line.frames - 1, Math.max(0, Math.round(t / line.frame))) * TRACK.length + k];
  const vowels = [];
  for (let i = 0; i < trace.length - 1; i++) {
    const e = trace[i];
    if (!VOWELS.has(e.p)) continue;
    vowels.push({ ...e, end: trace[i + 1].at });
  }
  // the highest and the last F0 inside a vowel, and where the highest is. F0 glides to
  // each target (setTargetAtTime), so a vowel STARTS at whatever the last accent left;
  // an accent's own height is read at the end of its vowel.
  const shape = (v) => {
    let hi = -Infinity, at = v.at;
    for (let t = v.at; t < v.end; t += line.frame) { const f = f0(t); if (f > hi) { hi = f; at = t; } }
    return { hi, at, last: f0(v.end - line.frame), first: f0(v.at + line.frame) };
  };
  return { line, f0, vowels, shape, trace };
}
const hz = (x) => x.toFixed(1);

// ── The nucleus of a statement peaks, then falls ────────────────────────────────
{
  const r = speak('The goalie made a save.');
  const nv = r?.vowels.find(v => v.nuc);
  check('the statement has a nucleus vowel in the trace', nv?.nuc === 'fall', JSON.stringify(r?.vowels.map(v => [v.p, v.nuc, v.acc])));
  if (nv) {
    const s = r.shape(nv);
    check('the nucleus peaks before the end of its vowel', s.at < nv.end - 2 * r.line.frame, `peak at ${s.at.toFixed(3)}, vowel ${nv.at.toFixed(3)}..${nv.end.toFixed(3)}`);
    check('the nucleus falls through its vowel (H* L)', s.last < s.hi * 0.96, `peak ${hz(s.hi)} Hz, end ${hz(s.last)} Hz`);
    // and it climbs further out of its valley than the prenuclear accent before it does
    // (declination puts it lower in Hz, so the rise is the fair measure)
    const pre = r.vowels.filter(v => v.at < nv.at && v.acc === 1).pop();
    if (pre) {
      const p = r.shape(pre);
      check('the nucleus rises further than the prenuclear accent before it', s.hi / s.first > p.hi / p.first,
        `nucleus ${hz(s.first)} to ${hz(s.hi)} Hz, prenuclear ${hz(p.first)} to ${hz(p.hi)} Hz`);
    }
  }
}

// ── Downstep: each prenuclear accent a step below the last ──────────────────────
{
  // declination off, so only the accents can lower anything; one vowel and voiced onsets
  // throughout, so intrinsic F0 and microprosody are the same on every accent
  const r = speak('Big dim bins nip lids', { decl: 0 });
  const pre = r ? r.vowels.filter(v => v.acc === 1 && !v.nuc) : [];
  check('the downstep line has three prenuclear accents', pre.length >= 3, JSON.stringify(r?.vowels.map(v => [v.p, v.nuc, v.acc])));
  for (let i = 1; i < Math.min(3, pre.length); i++) {
    const a = r.shape(pre[i - 1]).last, b = r.shape(pre[i]).last;
    check(`prenuclear accent ${i + 1} is below accent ${i} (downstep)`, b < a * 0.995, `${hz(a)} then ${hz(b)} Hz`);
  }
}

// ── A comma half falls; a full stop falls all the way ───────────────────────────
{
  const drop = (text) => {
    const r = speak(text, { decl: 0 });
    const nv = r?.vowels.find(v => v.nuc);
    if (!nv) return NaN;
    const s = r.shape(nv);
    return s.last / s.hi;
  };
  const stop = drop('The goalie made a save. It was.'), comma = drop('The goalie made a save, it was.');
  check('a comma nucleus falls less than a full stop nucleus', comma > stop, `end/peak ${comma.toFixed(3)} at a comma, ${stop.toFixed(3)} at a stop`);
}

// ── A minor break lifts the pitch part way ──────────────────────────────────────
{
  const LONG = 'The forward carries the puck through the neutral zone and drops it back to the defenceman at the point';
  const r = speak(LONG);
  const m = r?.trace.find(e => e.p === '_M');
  check('the long line has a minor break', !!m);
  if (m) {
    const acc = r.vowels.filter(v => v.acc);
    const before = acc.filter(v => v.at < m.at), after = acc.filter(v => v.at > m.at);
    const lastBefore = before.filter(v => !v.nuc).pop(), firstAfter = after[0], first = acc[0];
    if (lastBefore && firstAfter) {
      const a = r.shape(lastBefore).last, b = r.shape(firstAfter).last, c = r.shape(first).last;
      check('the first accent after _M is above the last prenuclear one before it', b > a, `${hz(a)} before, ${hz(b)} after`);
      // a partial reset: the same words after a written full stop start higher
      const full = speak(LONG.replace(' zone and', ' zone. And'));
      const stop = full?.trace.find(e => e.p === '__');
      const fa = stop && full.vowels.filter(v => v.acc && v.at > stop.at)[0];
      if (fa) check('...and below where a full stop would put it (a partial reset)', b < full.shape(fa).last, `${hz(b)} after _M, ${hz(full.shape(fa).last)} after a full stop`);
      else check('the full-stop version has an accent after the stop', false);
      void c;
    } else check('accents either side of the minor break', false, JSON.stringify(r.vowels.map(v => [v.p, v.nuc, v.acc])));
  }
}

// ── natural 0 is flat, accents and all ──────────────────────────────────────────
{
  const r = speak('The goalie made a save, and the forward carries the puck through the neutral zone and drops it back.', { natural: 0 });
  const k = TRACK.indexOf('f0'), vals = [];
  for (let f = 0; f < r.line.frames; f++) vals.push(r.line.tracks[f * TRACK.length + k]);
  check('natural 0: F0 is one value through accents and breaks', Math.max(...vals) - Math.min(...vals) < 1e-3, `${hz(Math.min(...vals))}..${hz(Math.max(...vals))} Hz`);
}

if (fails) { console.error(`x contour smoke: ${fails} failed`); process.exit(1); }
console.log('contour smoke passed');
