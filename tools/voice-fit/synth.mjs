// synth.mjs: ORACLE's real worklet run in Node, for voice-fit's renders.
//
// The same stub context the worklet gate uses (scripts/voice/worklet-smoke.mjs): speak()
// builds and schedules into fake nodes, and the line it posts to the worklet is run through
// the processor sample by sample. What comes out is what the game would play, minus the
// reverb and the bus.
//
//   const { render, wav, SR } = await setup();
//   const x = render('Say heed aloud.', { f0: 84 });   // Float32Array at SR

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (p) => new Function(readFileSync(join(ROOT, p), 'utf8'))();
const SR = 48000;

export async function setup({ seed = 'Vox Rime' } = {}) {
  const param = (v = 0) => ({ value: v, setValueAtTime() { return this; }, setTargetAtTime() { return this; },
    linearRampToValueAtTime() { return this; }, exponentialRampToValueAtTime() { return this; }, cancelScheduledValues() { return this; } });
  const node = (extra = {}) => ({ connect: (d) => d, disconnect() {}, start() {}, stop() {}, ...extra });
  class FakeContext {
    constructor() { this.currentTime = 0; this.sampleRate = SR; this.state = 'running'; this.destination = node(); this.audioWorklet = { addModule: () => Promise.resolve() }; }
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
    constructor(ctx, name, opts) { this.name = name; this.opts = opts; this.posted = []; this.port = { postMessage: (m) => this.posted.push(m), onmessage: null }; made.push(this); }
    connect(d) { return d; }
    disconnect() {}
  }
  globalThis.window = globalThis;
  globalThis.AudioContext = FakeContext;
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
  load('client/shared/formant-cmudict.js');
  load('client/shared/oracle-lts.js');
  load('client/shared/audio-engine.js');
  const A = globalThis.AudioEngine;
  let Proc = null;
  globalThis.sampleRate = SR;
  globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: () => {}, onmessage: null }; } };
  globalThis.registerProcessor = (name, cls) => { if (name === 'oracle-voice') Proc = cls; };
  load('client/shared/oracle-worklet.js');
  A.applyVolumeSettings({ enabled: true, tv: true, master: 1, tvVolume: 1 });
  globalThis.AudioWorkletNode = FakeWorkletNode;
  A._setVoiceWorkletUrl('oracle-worklet.js');
  await A.loadVoiceWorklet();

  // `trace`: an array that receives each phone's start ({ p, at }, seconds into the render).
  function render(text, voice, trace = null) {
    made.length = 0;
    A.speak(text, { seed, backend: 'worklet', fresh: true, voice, ...(trace ? { trace } : {}) });
    const wn = made.filter(m => m.name === 'oracle-voice').pop();
    const line = wn?.posted.find(m => m.type === 'line');
    if (!line) throw new Error('no line rendered: ' + text);
    render.last = { ...line, processorOptions: wn.opts.processorOptions };   // the tracks and constants the worklet got (ddsp/export.mjs)
    const out = play(line, wn.opts.processorOptions);
    A.cancelSpeech();
    return out;
  }
  // The worklet on a line message as speak() posts it ({ tracks, frames, frame, k, names }),
  // raw, without the presence peak's caller having to know: ddsp/play.mjs gives it tracks
  // a network corrected.
  function play(line, processorOptions = {}) {
    const p = new Proc({ processorOptions });
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
    return presence(out, A.voiceTuning.presenceDb);
  }
  // The game's speech chain puts a 3 kHz presence peak after the worklet (speak()'s
  // `presence`, Q 0.9, TUNING.presenceDb on a plain line). Without it a render is ~4 dB
  // dull at 3 kHz against what a player hears. The compressor after it isn't modelled.
  function presence(x, db) {
    const A0 = 10 ** (db / 40), w = 2 * Math.PI * 3000 / SR, al = Math.sin(w) / (2 * 0.9), cw = Math.cos(w);
    const a0 = 1 + al / A0, b0 = (1 + al * A0) / a0, b1 = -2 * cw / a0, b2 = (1 - al * A0) / a0, a1 = -2 * cw / a0, a2 = (1 - al / A0) / a0;
    const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
    return y;
  }
  // 16-bit mono WAV, peak-normalised to -1 dBFS.
  function wav(path, x) {
    let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
    const k = peak > 0 ? 0.89 / peak : 1;
    const b = Buffer.alloc(44 + x.length * 2);
    b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8);
    b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24);
    b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
    for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * k * 32767))), 44 + i * 2);
    writeFileSync(path, b);
  }
  return { render, play, wav, SR, A };
}
