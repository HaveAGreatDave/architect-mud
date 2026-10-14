// A recording AudioContext for the SIREN fidelity gates, and the engine loaded on it.
//
// Not a gate itself: scripts/audio/*-smoke.mjs import it. Every node is numbered and kept, every
// connect is kept with its output and input index, and every AudioParam write is kept as
// {type, value, time}, so a gate can walk the graph the engine built and read what it scheduled.
// It asserts what was scheduled, never what it sounds like.
//
// Like the stub in sea-smoke.mjs it enforces the real API where the real API throws: a
// non-finite param value, or an exponential ramp to zero, throws here too.
//
// The engine is loaded fresh on each loadEngine() call, with its own context, so one gate's
// ducks and rooms can't leak into another's.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function guard(name, method, v) {
  if (!Number.isFinite(v)) throw new Error(`${method} on '${name}': non-finite value (${v})`);
  if (method === 'exponentialRampToValueAtTime' && v <= 0) throw new Error(`${method} on '${name}': target must be > 0 (${v})`);
}

export function makeContext() {
  const nodes = [];
  const mkParam = (owner, name, value = 0) => ({
    _owner: owner, _name: name, value, log: [],
    setValueAtTime(v, t) { guard(name, 'setValueAtTime', v); this.value = v; this.log.push({ type: 'set', value: v, time: t }); return this; },
    setTargetAtTime(v, t, c) { guard(name, 'setTargetAtTime', v); this.log.push({ type: 'target', value: v, time: t, tc: c }); return this; },
    linearRampToValueAtTime(v, t) { guard(name, 'linearRampToValueAtTime', v); this.log.push({ type: 'ramp', value: v, time: t }); return this; },
    exponentialRampToValueAtTime(v, t) { guard(name, 'exponentialRampToValueAtTime', v); this.log.push({ type: 'exp', value: v, time: t }); return this; },
    cancelScheduledValues(t) { this.log.push({ type: 'cancel', time: t }); return this; },
  });
  function mkNode(kind) {
    const n = { kind, id: nodes.length, out: [], started: null, offset: null, stopped: null, channelCount: 2 };
    n.connect = (dst, output = 0, input = 0) => { n.out.push({ dst, output, input }); return dst; };
    n.disconnect = () => { n.out = []; };
    n.start = (t, offset) => { n.started = t ?? 0; n.offset = offset ?? 0; };
    n.stop = (t) => { n.stopped = t ?? 0; };
    nodes.push(n);
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
    createChannelSplitter(k = 6) { const n = mkNode('splitter'); n.outputs = k; return n; }
    createChannelMerger(k = 6) { const n = mkNode('merger'); n.inputs = k; return n; }
    createDynamicsCompressor() { const n = mkNode('comp'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = mkParam(n, k, 0); return n; }
    createWaveShaper() { const n = mkNode('shaper'); n.curve = null; n.oversample = 'none'; return n; }
    createConvolver() { const n = mkNode('convolver'); n.buffer = null; return n; }
    createPeriodicWave() { return { kind: 'wave' }; }
    createBuffer(ch, len, sr = 48000) {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => data[i] };
    }
    resume() { return Promise.resolve(); }
  }
  return { FakeContext, nodes };
}

// Load audio-engine.js against a fresh recording context. Returns the engine, the context the
// engine made (after init) and the node list. Timers are captured, not run: `timers` holds
// every setTimeout the engine asked for, and a gate runs them by hand if it needs to.
export function loadEngine({ settings } = {}) {
  const { FakeContext, nodes } = makeContext();
  const timers = [];
  let made = null;
  globalThis.window = globalThis;
  globalThis.AudioContext = class extends FakeContext { constructor() { super(); made = this; } };
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  globalThis.clearTimeout = () => {};
  delete globalThis.AudioEngine;
  for (const f of ['client/shared/formant-cmudict.js', 'client/shared/audio-engine.js']) {
    new Function(readFileSync(join(ROOT, f), 'utf8'))();
  }
  const A = globalThis.AudioEngine;
  if (!A?.playSfx) throw new Error('audio-engine did not load');
  if (settings) A.applyVolumeSettings(settings);
  A.init();
  return { A, ctx: made, nodes, timers };
}

// The gate's own tally, in the shape every audio gate prints.
export function tally(name) {
  let fails = 0;
  const check = (label, cond, detail) => {
    if (cond) return true;
    fails++;
    console.error(`  x ${label}${detail ? `\n      ${detail}` : ''}`);
    return false;
  };
  const done = () => {
    if (fails) { console.error(`\n✗ ${name} — ${fails} failure(s)`); process.exit(1); }
    console.log(`✓ ${name} clean.`);
  };
  return { check, done };
}

// Every node reachable downstream of `from`, following connects (into nodes, not params).
export function downstream(from) {
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const n = q.pop();
    for (const { dst } of n.out || []) {
      if (dst && dst.kind && !seen.has(dst)) { seen.add(dst); q.push(dst); }
    }
  }
  return seen;
}
