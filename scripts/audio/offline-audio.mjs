// OFFLINE AUDIO — the part of the Web Audio API that SIREN's layers use, rendered in Node.
//
// A TEST DOUBLE, not a second synth: nothing here ships to a client. The other audio checks
// (scripts/voice/fm-smoke.mjs, scripts/audio/*-smoke.mjs) record what a graph SCHEDULES; this
// one renders the samples, so a check can ask what a cue actually puts out: is every sample
// finite, does it start and end at zero, does it sit on zero (no DC), how loud does it get,
// when does it fall silent, and is a seeded cue the same samples every time. It runs the real
// audio-engine.js against `OfflineContext`, the same way the browser's OfflineAudioContext
// runs it for AudioEngine.renderSfx, and it writes WAVs to listen to.
//
// It follows the spec where SIREN depends on it: AudioParam automation (set, linear and
// exponential ramps, setTarget, cancel; audio-rate inputs added on top), the biquad
// formulas (Q in dB for low/highpass), WaveShaper interpolation, looping buffer sources,
// delays (a feedback loop works, as the spec requires one to go through a delay), and the
// retro stage's AudioWorklet, run from its own file. What it leaves out can't change a check:
// no oversampling on a WaveShaper, no reverb (a panner and a convolver pass the signal
// through; the reverb is a bus send, never part of a cue), and a square or saw is band-limited
// with polyBLEP where a browser uses a wavetable. Mono throughout.
//
//   import { OfflineContext, installAudioGlobals, wav } from './offline-audio.mjs';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TAU = Math.PI * 2;

// ── AudioParam ───────────────────────────────────────────────────────────────
class Param {
  constructor(ctx, value, min = -3.4e38, max = 3.4e38) {
    this.ctx = ctx; this.def = value; this.events = []; this.inputs = []; this.min = min; this.max = max; this._compiled = null;
  }
  get value() { return this.events.length ? this._at(this.ctx.currentTime) : this.def; }
  set value(v) { if (!Number.isFinite(v)) throw new TypeError(`non-finite param value ${v}`); if (this.events.length) this.setValueAtTime(v, this.ctx.currentTime); else this.def = v; }
  _push(e) { if (!Number.isFinite(e.v) || !Number.isFinite(e.t)) throw new TypeError(`non-finite automation ${JSON.stringify(e)}`); this.events.push(e); this._compiled = null; return this; }
  setValueAtTime(v, t) { return this._push({ type: 'set', v, t }); }
  linearRampToValueAtTime(v, t) { return this._push({ type: 'lin', v, t }); }
  exponentialRampToValueAtTime(v, t) { if (v === 0) throw new RangeError('exponential ramp to 0'); return this._push({ type: 'exp', v, t }); }
  setTargetAtTime(v, t, tc) { if (!(tc >= 0) || !Number.isFinite(tc)) throw new TypeError('bad time constant'); return this._push({ type: 'tgt', v, t, tc }); }
  cancelScheduledValues(t) { this.events = this.events.filter((e) => e.t < t); this._compiled = null; return this; }
  cancelAndHoldAtTime(t) { const v = this._at(t); this.cancelScheduledValues(t); return this.setValueAtTime(v, t); }
  // Sorted by time, insertion order kept for equal times; each event gets the value the
  // timeline had just before it (a setTarget starts from there).
  _compile() {
    const ev = this.events.map((e, i) => ({ ...e, i })).sort((a, b) => a.t - b.t || a.i - b.i);
    for (let k = 0; k < ev.length; k++) ev[k].before = this._eval(ev, k, ev[k].t);
    this._compiled = ev;
    this._k = 0;
    return ev;
  }
  // The value at `t` using events[0..n) only.
  _eval(ev, n, t) {
    let k = -1;
    for (let j = 0; j < n; j++) if (ev[j].t <= t) k = j; else break;
    const next = k + 1 < n ? ev[k + 1] : null;
    const prevVal = k >= 0 ? this._endValue(ev, k) : this.def, prevT = k >= 0 ? ev[k].t : 0;
    if (next && (next.type === 'lin' || next.type === 'exp') && next.t > t) {
      const span = next.t - prevT, f = span > 0 ? (t - prevT) / span : 1;
      if (next.type === 'lin') return prevVal + (next.v - prevVal) * f;
      if (prevVal === 0 || prevVal * next.v < 0) return prevVal;
      return prevVal * Math.pow(next.v / prevVal, f);
    }
    if (k < 0) return this.def;
    const e = ev[k];
    if (e.type === 'tgt') return e.v + (e.before - e.v) * Math.exp(-(t - e.t) / Math.max(1e-9, e.tc));
    return e.v;
  }
  _endValue(ev, k) { const e = ev[k]; return e.type === 'tgt' ? e.before : e.v; }
  _at(t) { const ev = this._compiled || this._compile(); return this._eval(ev, ev.length, t); }
  // per sample, with the audio-rate inputs added
  at(i, t) {
    let v;
    if (!this.events.length) v = this.def;
    else {
      const ev = this._compiled || this._compile();
      // (a moving index: time only goes forward while rendering)
      while (this._k < ev.length && ev[this._k].t <= t) this._k++;
      v = this._evalFast(ev, this._k - 1, t);
    }
    for (const n of this.inputs) v += n.out(i);
    return v < this.min ? this.min : v > this.max ? this.max : v;
  }
  _evalFast(ev, k, t) {
    const next = k + 1 < ev.length ? ev[k + 1] : null;
    if (next && (next.type === 'lin' || next.type === 'exp')) {
      const prevVal = k >= 0 ? this._endValue(ev, k) : this.def, prevT = k >= 0 ? ev[k].t : 0;
      const span = next.t - prevT, f = span > 0 ? (t - prevT) / span : 1;
      if (next.type === 'lin') return prevVal + (next.v - prevVal) * f;
      if (prevVal === 0 || prevVal * next.v < 0) return prevVal;
      return prevVal * Math.pow(next.v / prevVal, f);
    }
    if (k < 0) return this.def;
    const e = ev[k];
    if (e.type === 'tgt') return e.v + (e.before - e.v) * Math.exp(-(t - e.t) / Math.max(1e-9, e.tc));
    return e.v;
  }
}

// ── Nodes ────────────────────────────────────────────────────────────────────
let _nodeId = 0;
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.id = _nodeId++; this.inputs = []; this._i = -1; this._v = 0; ctx._nodes.push(this); }
  connect(dst) {
    if (dst instanceof Param) dst.inputs.push(this);
    else dst.inputs.push(this);
    return dst;
  }
  disconnect() {}
  inSum(i) { let s = 0; for (const n of this.inputs) s += n.out(i); return s; }
  out(i) {
    if (this._i === i) return this._v;
    this._i = i;
    // (a cycle comes back here before the value is known: it can only legally go through a
    // delay, whose output never needs its own input for the same sample)
    this._v = 0;
    const v = this.compute(i, i / this.ctx.sampleRate);
    this._v = v;
    return v;
  }
}

class Gain extends Node {
  constructor(ctx) { super(ctx, 'gain'); this.gain = new Param(ctx, 1); }
  compute(i, t) { return this.inSum(i) * this.gain.at(i, t); }
}

class Source extends Node {
  constructor(ctx, kind) { super(ctx, kind); this.startT = null; this.stopT = Infinity; this.onended = null; }
  start(t = 0, offset = 0) { this.startT = Math.max(0, t); this.offset = offset || 0; }
  stop(t = 0) { this.stopT = Math.min(this.stopT, t); }
  live(t) { return this.startT != null && t >= this.startT && t < this.stopT; }
}

const polyblep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};
class Oscillator extends Source {
  constructor(ctx) { super(ctx, 'osc'); this.type = 'sine'; this.frequency = new Param(ctx, 440); this.detune = new Param(ctx, 0); this.phase = 0; this.tri = 0; }
  setPeriodicWave() { this.type = 'sine'; }
  compute(i, t) {
    // (the params are read every sample, playing or not, so their inputs keep time)
    const f0 = this.frequency.at(i, t), dc = this.detune.at(i, t);
    if (!this.live(t)) return 0;
    const f = dc ? f0 * Math.pow(2, dc / 1200) : f0;
    const dt = f / this.ctx.sampleRate;
    const p = this.phase;
    let v;
    switch (this.type) {
      case 'square': { const adt = Math.abs(dt); v = (p < 0.5 ? 1 : -1) + polyblep(p, adt) - polyblep((p + 0.5) % 1, adt); break; }
      case 'sawtooth': v = 2 * p - 1 - polyblep(p, Math.abs(dt)); break;
      case 'triangle': v = p < 0.5 ? 4 * p - 1 : 3 - 4 * p; break;
      default: v = Math.sin(TAU * p);
    }
    let np = p + dt;
    np -= Math.floor(np);
    this.phase = np;
    return v;
  }
}

class BufferSource extends Source {
  constructor(ctx) { super(ctx, 'buffer'); this.buffer = null; this.loop = false; this.playbackRate = new Param(ctx, 1); this.detune = new Param(ctx, 0); this.pos = null; }
  compute(i, t) {
    const rate = this.playbackRate.at(i, t);
    this.detune.at(i, t);
    if (!this.live(t) || !this.buffer) return 0;
    const d = this.buffer.getChannelData(0), n = d.length;
    if (this.pos == null) this.pos = (this.offset || 0) * this.buffer.sampleRate;
    let p = this.pos;
    if (this.loop) p = ((p % n) + n) % n;
    else if (p >= n - 1) return 0;
    const k = Math.floor(p), f = p - k, v = d[k] * (1 - f) + d[(k + 1) % n] * f;
    this.pos = p + rate * this.buffer.sampleRate / this.ctx.sampleRate;
    return v;
  }
}

class Biquad extends Node {
  constructor(ctx) {
    super(ctx, 'biquad'); this.type = 'lowpass';
    this.frequency = new Param(ctx, 350, 0, ctx.sampleRate / 2); this.Q = new Param(ctx, 1); this.gain = new Param(ctx, 0); this.detune = new Param(ctx, 0);
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; this._key = null;
  }
  coeffs(f, Q, G) {
    const sr = this.ctx.sampleRate, nyq = sr / 2;
    f = Math.max(0, Math.min(nyq, f));
    const w0 = TAU * f / sr, cw = Math.cos(w0), sw = Math.sin(w0), A = Math.pow(10, G / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (this.type) {
      case 'highpass': { const a = sw / (2 * Math.pow(10, Q / 20)); b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + a; a1 = -2 * cw; a2 = 1 - a; break; }
      case 'bandpass': { const a = sw / (2 * Q); b0 = a; b1 = 0; b2 = -a; a0 = 1 + a; a1 = -2 * cw; a2 = 1 - a; break; }
      case 'notch': { const a = sw / (2 * Q); b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + a; a1 = -2 * cw; a2 = 1 - a; break; }
      case 'allpass': { const a = sw / (2 * Q); b0 = 1 - a; b1 = -2 * cw; b2 = 1 + a; a0 = 1 + a; a1 = -2 * cw; a2 = 1 - a; break; }
      case 'peaking': { const a = sw / (2 * Q); b0 = 1 + a * A; b1 = -2 * cw; b2 = 1 - a * A; a0 = 1 + a / A; a1 = -2 * cw; a2 = 1 - a / A; break; }
      case 'lowshelf': { const a = sw / 2 * Math.SQRT2, s = 2 * Math.sqrt(A) * a;
        b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
        a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
      case 'highshelf': { const a = sw / 2 * Math.SQRT2, s = 2 * Math.sqrt(A) * a;
        b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
        a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break; }
      default: { const a = sw / (2 * Math.pow(10, Q / 20)); b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + a; a1 = -2 * cw; a2 = 1 - a; }
    }
    this.c = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }
  compute(i, t) {
    const x = this.inSum(i);
    let f = this.frequency.at(i, t); const Q = this.Q.at(i, t), G = this.gain.at(i, t), dt = this.detune.at(i, t);
    if (dt) f *= Math.pow(2, dt / 1200);
    // (recomputed only when a parameter has moved)
    if (!this.c || f !== this._f || Q !== this._q || G !== this._g) { this._f = f; this._q = Q; this._g = G; this.coeffs(f, Q, G); }
    const [b0, b1, b2, a1, a2] = this.c;
    const y = b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = Number.isFinite(y) ? y : 0;
    return y;
  }
}

class Shaper extends Node {
  constructor(ctx) { super(ctx, 'shaper'); this.curve = null; this.oversample = 'none'; }
  compute(i) {
    const x = this.inSum(i), c = this.curve;
    if (!c || !c.length) return x;
    const n = c.length, v = (n - 1) / 2 * (x + 1);
    if (v <= 0) return c[0];
    if (v >= n - 1) return c[n - 1];
    const k = Math.floor(v), f = v - k;
    return c[k] * (1 - f) + c[k + 1] * f;
  }
}

class Delay extends Node {
  constructor(ctx, max = 1) {
    super(ctx, 'delay'); this.delayTime = new Param(ctx, 0, 0, max);
    this.buf = new Float32Array(Math.ceil(max * ctx.sampleRate) + 2); this.w = 0; ctx._delays.push(this);
  }
  // (the output comes from the past only; the input is written after the sample is done)
  compute(i, t) {
    const d = Math.max(1, this.delayTime.at(i, t) * this.ctx.sampleRate), n = this.buf.length;
    const r = this.w - d, k = Math.floor(r), f = r - k;
    const a = this.buf[((k % n) + n) % n], b = this.buf[(((k + 1) % n) + n) % n];
    return a * (1 - f) + b * f;
  }
  tick(i) { this.buf[this.w % this.buf.length] = this.inSum(i); this.w++; }
}

class Pass extends Node {
  constructor(ctx, kind) { super(ctx, kind); this.pan = new Param(ctx, 0); this.buffer = null; this.normalize = true; }
  compute(i, t) { this.pan.at(i, t); return this.inSum(i); }
}

class Compressor extends Pass {
  constructor(ctx) { super(ctx, 'comp'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) this[k] = new Param(ctx, 0); this.reduction = 0; }
}

class Destination extends Node {
  constructor(ctx) { super(ctx, 'destination'); this.channelCount = 1; }
  compute(i) { return this.inSum(i); }
}

// The retro stage's processor, run from its own file (client/shared/audio-retro-worklet.js),
// one sample at a time.
const _processors = new Map();
function loadWorklet(url) {
  const path = url.startsWith('file:') ? fileURLToPath(url) : url;
  const src = readFileSync(path, 'utf8');
  const reg = new Map();
  // eslint-disable-next-line no-new-func
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime', src)(class {}, (name, cls) => reg.set(name, cls), 48000, 0);
  for (const [k, v] of reg) _processors.set(k, { cls: v, src });
}
class Worklet extends Node {
  constructor(ctx, name, options = {}) {
    super(ctx, 'worklet');
    const p = _processors.get(name);
    if (!p) throw new Error(`AudioWorkletNode: no processor ${name}`);
    // re-evaluated with this context's rate, as an AudioWorkletGlobalScope's `sampleRate` is
    const reg = new Map();
    new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime', p.src)(class {}, (n, c) => reg.set(n, c), ctx.sampleRate, 0);
    this.proc = new (reg.get(name))(options);
    this.xin = [[new Float32Array(1)]]; this.yout = [[new Float32Array(1)]];
  }
  compute(i) {
    this.xin[0][0][0] = this.inSum(i);
    this.proc.process(this.xin, this.yout, {});
    return this.yout[0][0][0];
  }
}

export class OfflineContext {
  constructor(a, b, c) {
    // (numberOfChannels, length, sampleRate), or the options object
    const o = typeof a === 'object' ? a : { numberOfChannels: a, length: b, sampleRate: c };
    this.sampleRate = o.sampleRate || 48000; this.length = o.length; this.currentTime = 0; this.state = 'suspended';
    this._nodes = []; this._delays = [];
    this.destination = new Destination(this);
    this.audioWorklet = { addModule: async (url) => { loadWorklet(url); } };
  }
  createGain() { return new Gain(this); }
  createOscillator() { return new Oscillator(this); }
  createBufferSource() { return new BufferSource(this); }
  createBiquadFilter() { return new Biquad(this); }
  createWaveShaper() { return new Shaper(this); }
  createDelay(max) { return new Delay(this, max); }
  createStereoPanner() { return new Pass(this, 'panner'); }
  createConvolver() { return new Pass(this, 'convolver'); }
  createDynamicsCompressor() { return new Compressor(this); }
  createPeriodicWave() { return {}; }
  createBuffer(ch, len, sr) {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr || this.sampleRate, duration: len / (sr || this.sampleRate), getChannelData: (k) => data[k] };
  }
  resume() { return Promise.resolve(); }
  // Renders `length` samples: every node is pulled once per sample, in order.
  startRendering() {
    this.state = 'running';
    const out = new Float32Array(this.length), sr = this.sampleRate;
    for (let i = 0; i < this.length; i++) {
      this.currentTime = i / sr;
      out[i] = this.destination.out(i);
      for (const d of this._delays) d.tick(i);
    }
    this.state = 'closed';
    return Promise.resolve({ numberOfChannels: 1, length: this.length, sampleRate: sr, duration: this.length / sr, getChannelData: () => out });
  }
}

// What audio-engine.js reaches for as globals, pointed at this renderer.
export function installAudioGlobals(g = globalThis) {
  g.window = g.window || g;
  g.OfflineAudioContext = OfflineContext;
  g.AudioContext = g.AudioContext || class extends OfflineContext { constructor() { super(1, 48000 * 60, 48000); } };
  g.AudioWorkletNode = class { constructor(ctx, name, options) { return new Worklet(ctx, name, options); } };
  g.requestAnimationFrame = g.requestAnimationFrame || ((fn) => setTimeout(() => fn(0), 0));
}

// 16-bit mono WAV bytes.
export function wav(samples, sampleRate) {
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, samples[i])); buf.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), 44 + i * 2); }
  return buf;
}
