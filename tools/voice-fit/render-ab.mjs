// render-ab.mjs: say the same lines in a stock ORACLE voice and in a fitted one, to WAVs.
//
//   node tools/voice-fit/render-ab.mjs <voice.json> <out dir>
//
// Both use one rolled voice ('Vox Rime'), so the only difference is what fit.mjs measured:
// the fitted one adds its vowels, its locus equations, its F0 and fshift 1. The real
// worklet runs in Node through the same stub the worklet gate uses
// (scripts/voice/worklet-smoke.mjs), so this is what the game would play, minus the
// reverb and the bus.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (p) => new Function(readFileSync(join(ROOT, p), 'utf8'))();
const SR = 48000;
const [, , VOICE, OUTDIR] = process.argv;
const fitted = JSON.parse(readFileSync(VOICE, 'utf8')).voice;

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

function render(text, voice) {
  made.length = 0;
  A.speak(text, { seed: 'Vox Rime', backend: 'worklet', fresh: true, voice });
  const wn = made.filter(m => m.name === 'oracle-voice').pop();
  const line = wn?.posted.find(m => m.type === 'line');
  if (!line) throw new Error('no line rendered: ' + text);
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
  A.cancelSpeech();
  return out;
}
function wav(path, x) {
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  const k = peak > 0 ? 0.89 / peak : 1;                      // both files to the same peak
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * k * 32767))), 44 + i * 2);
  writeFileSync(path, b);
}
// Lines with every vowel in them, and the passage from the script.
const LINES = [
  'Heed, hid, head, had, hod, hawed, hood, who\'d, hud, heard, hayed, hide, hoed, how\'d, hoyed.',
  'The kettle boiled while we argued about the rent.',
  'Could you pass me the salt and the pepper?',
  'The storm came in the afternoon. At first it was only a darker strip of cloud over the hills, and nobody on the dock paid it much attention.',
  'Four fishermen came in, soaked through and laughing, and sat by the window to watch the waves.',
];
mkdirSync(OUTDIR, { recursive: true });
const gap = new Float32Array(Math.round(0.6 * SR));
const join2 = (parts) => { const n = parts.reduce((s, p) => s + p.length + gap.length, 0); const o = new Float32Array(n); let at = 0; for (const p of parts) { o.set(p, at); at += p.length + gap.length; } return o; };
const stock = join2(LINES.map(l => render(l, { f0: fitted.f0 })));
const fit = join2(LINES.map(l => render(l, fitted)));
wav(join(OUTDIR, 'a-stock.wav'), stock);
wav(join(OUTDIR, 'b-fitted.wav'), fit);
console.log(`wrote a-stock.wav and b-fitted.wav to ${OUTDIR} (${(stock.length / SR).toFixed(1)} s each; both at F0 ${fitted.f0} Hz, so only the vowels and loci differ)`);
