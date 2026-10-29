// Timing smoke: ORACLE's segment durations against Klatt's duration rules.
//
//   node scripts/voice/timing-smoke.mjs
//
// Speaks lines on the graph back end against a stub context and reads the phoneme trace
// speak() fills (each phoneme's scheduled start), so every length checked here is one the
// scheduler really scheduled. It guards:
//   - a vowel is longer before a voiced consonant than a voiceless one ("bead" over
//     "beat", "lose" over "loose"), mid-phrase as well as at the end of one
//   - the vowel and coda of a phrase-final word are longer than the same word's mid-phrase,
//     and a comma lengthens less than a full stop
//   - an unstressed vowel is shorter than the same vowel stressed
//   - estimateDuration agrees with what the scheduler laid down, since prosody and the
//     broadcast hold are fitted to the estimate
//   - natural 0 evens the phrase-final lengthening out and keeps the voicing cue
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
  constructor() { this.currentTime = 0; this.sampleRate = SR; this.state = 'running'; this.destination = node(); }
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
globalThis.window = globalThis;
globalThis.AudioContext = FakeContext;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);

load('client/shared/formant-cmudict.js');
load('client/shared/audio-engine.js');
const A = globalThis.AudioEngine;
A.applyVolumeSettings({ enabled: true, tv: true, master: 1, tvVolume: 1 });

let fails = 0;
function check(label, cond, detail) {
  if (cond) return;
  fails++;
  console.error(`  x ${label}${detail ? `\n      ${detail}` : ''}`);
}
const ms = (s) => `${(s * 1000).toFixed(0)} ms`;

// One line's trace, each phoneme with its scheduled length.
function speak(text, voice = {}) {
  const trace = [];
  A.speak(text, { seed: 'Dex Rime', backend: 'graph', trace, voice, fresh: true });
  A.cancelSpeech();
  const segs = trace.slice(0, -1).map((e, i) => ({ ...e, len: trace[i + 1].at - e.at }));
  return { segs, end: trace[trace.length - 1] };
}
// The length of the n-th vowel `code` in a line (the last one for n = -1).
const vowel = (r, code, n = 0) => { const v = r.segs.filter(s => s.p === code); return v.at(n)?.len ?? NaN; };

// ── Postvocalic voicing ─────────────────────────────────────────────────────────
{
  const d = vowel(speak('bead'), 'IY'), t = vowel(speak('beat'), 'IY');
  check('"bead" holds its vowel longer than "beat"', d > t * 1.25, `bead ${ms(d)}, beat ${ms(t)}`);
  const dm = vowel(speak('I said bead again.'), 'IY'), tm = vowel(speak('I said beat again.'), 'IY');
  check('...and mid-phrase too', dm > tm * 1.1, `bead ${ms(dm)}, beat ${ms(tm)}`);
  const z = vowel(speak('lose'), 'UW'), s = vowel(speak('loose'), 'UW');
  check('"lose" holds its vowel longer than "loose"', z > s * 1.2, `lose ${ms(z)}, loose ${ms(s)}`);
}

// ── Phrase-final lengthening ────────────────────────────────────────────────────
{
  // the vowel is not the last sound of its word, so only the rhyme rule can reach it
  const finR = speak('We took the road.'), midR = speak('The road was long.');
  const fin = vowel(finR, 'OW', -1), mid = vowel(midR, 'OW');
  check('a phrase-final "road" holds its vowel longer than a mid-phrase one', fin > mid * 1.15, `final ${ms(fin)}, mid ${ms(mid)}`);
  const finD = finR.segs.filter(x => x.p === 'D').pop()?.len, midD = midR.segs.find(x => x.p === 'D')?.len;
  check('...and its coda too', finD > midD, `final /d/ ${ms(finD)}, mid ${ms(midD)}`);
  const comma = vowel(speak('We took the road, and left.'), 'OW', -1);
  check('a comma lengthens less than a full stop', comma < fin && comma > mid, `stop ${ms(fin)}, comma ${ms(comma)}, mid ${ms(mid)}`);
}

// ── Clipping through a sonorant, and stress-timed feet ─────────────────────────
{
  const d = vowel(speak('bend'), 'EH'), t = vowel(speak('bent'), 'EH');
  check('"bend" holds its vowel longer than "bent"', d > t * 1.08, `bend ${ms(d)}, bent ${ms(t)}`);
  const nd = speak('bend').segs.find(s => s.p === 'N').len, nt = speak('bent').segs.find(s => s.p === 'N').len;
  check('...and its nasal too', nd > nt * 1.1, `bend /n/ ${ms(nd)}, bent ${ms(nt)}`);
  // "the" shares the foot from "Ask" with one unstressed vowel, then with three
  const short = speak('Ask the man.'), long = speak('Ask him of the man.');
  const th = (r) => vowel(r, 'AX', -1), ask = (r) => vowel(r, 'AE');
  check('an unstressed vowel is shorter in a longer foot', th(long) < th(short) * 0.95, `long foot ${ms(th(long))}, short ${ms(th(short))}`);
  check('...and so is the foot\'s stressed head', ask(long) < ask(short), `long foot ${ms(ask(long))}, short ${ms(ask(short))}`);
}

// ── Tempo arch, asides, given across lines ─────────────────────────────────────
{
  // the same "the" near the start of a long phrase and in its middle
  const r = speak('The dog ran over the long wet sand to the boats and back.');
  const ths = r.segs.filter(s => s.p === 'DH');
  check('a phrase runs quicker through its middle', ths[1].len < ths[0].len, `start ${ms(ths[0].len)}, middle ${ms(ths[1].len)}`);
  const er = (t) => vowel(speak(t), 'ER');
  const aside = er('The man (a sailor) was here.'), plain = er('The man, a sailor, was here.');
  check('an aside in parentheses reads quicker', aside < plain * 0.95, `aside ${ms(aside)}, commas ${ms(plain)}`);
  const accents = (text, opt) => { const tr = []; A.speak(text, { seed: 'Dex Rime', backend: 'graph', trace: tr, ...opt }); return tr.filter(e => e.acc).length; };
  A.cancelSpeech();
  accents('Rourke has the puck.');
  const given = accents('Rourke shoots it.', { queue: true }); A.cancelSpeech();
  const fresh = accents('Rourke shoots it.', { fresh: true }); A.cancelSpeech();
  check('a name said on the channel a line ago loses its accent', given < fresh, `after ${given} accents, fresh ${fresh}`);
}

// ── Connected speech across word gaps ──────────────────────────────────────────
{
  const ph = (t) => A._phonemesFor(t).filter(p => p !== '*' && p !== '!').join(' ');
  check('"did you" coalesces to /dʒ/, one word', ph('did you').startsWith('D IH JH U'), ph('did you'));
  check('"miss you" coalesces to /ʃ/', ph('miss you').includes('SH UW'), ph('miss you'));
  check('"last night" drops its /t/', ph('last night') === 'L AE S _ N AY T', ph('last night'));
  check('...but "left home" keeps it before /h/', ph('left home').includes('F T _'), ph('left home'));
  check('...and "hand over" keeps it before a vowel', ph('hand over').includes('N D _'), ph('hand over'));
  check('"ten boys" still goes to /m/', ph('ten boys').includes('EH M _ B'), ph('ten boys'));
}

// ── Breath in at a long break ──────────────────────────────────────────────────
{
  const say = (t) => { const r = A.speak(t, { seed: 'Dex Rime', backend: 'graph', fresh: true }); A.cancelSpeech(); return r; };
  const long = 'The tide came in. We waited by the harbour wall for hours.';
  const on = say(long);
  check('a sentence break mid-passage takes a breath in', on.inhales === 1, `inhales ${on.inhales}`);
  check('...but not with too little left to say', say('Go home. Now.').inhales === 0);
  const k = A.voiceTuning.inhale; A.voiceTuning.inhale = 0;
  const off = say(long); A.voiceTuning.inhale = k;
  check('inhale 0 turns it off without moving the timing', off.inhales === 0 && Math.abs(off.duration - on.duration) < 1e-6, `${off.inhales}, ${ms(off.duration)} vs ${ms(on.duration)}`);
}

// ── Stress ──────────────────────────────────────────────────────────────────────
{
  // the same run with and without the stress mark on its middle vowel, through the
  // estimate (the scheduler is held to the estimate below)
  const run = (mark) => ['S', '*', 'EH', 'D', '_', 'B', ...(mark ? ['*'] : []), 'IH', 'T', '_', 'AX', 'G', '*', 'EH', 'N', '__'];
  const stressed = A._estimateDuration(run(true), 1.3), plain = A._estimateDuration(run(false), 1.3);
  check('an unstressed vowel is shorter than the same vowel stressed', plain < stressed - 0.01, `stressed run ${ms(stressed)}, unstressed ${ms(plain)}`);
}

// ── The estimate matches the schedule ───────────────────────────────────────────
for (const text of [
  'bead', 'We took the road.',
  'The goalie made a save, and the forward carries the puck through the neutral zone.',
  'Is it done? It is. Stop that, architect!',
  'Scoooores! He shoots, he SCORES!',
]) {
  const { end } = speak(text);
  const err = Math.abs(end.est - end.at);
  check(`estimateDuration matches the schedule: "${text}"`, err < Math.max(0.02, end.at * 0.03), `scheduled ${ms(end.at)}, estimated ${ms(end.est)}`);
}

// ── natural 0 ───────────────────────────────────────────────────────────────────
{
  const v = { natural: 0 };
  const fin = vowel(speak('We took the road.', v), 'OW', -1), mid = vowel(speak('The road was long.', v), 'OW');
  check('natural 0: no phrase-final lengthening', Math.abs(fin - mid) < 0.004, `final ${ms(fin)}, mid ${ms(mid)}`);
  const d = vowel(speak('bead', v), 'IY'), t = vowel(speak('beat', v), 'IY');
  check('natural 0: the voicing cue stays', d > t * 1.25, `bead ${ms(d)}, beat ${ms(t)}`);
}

if (fails) { console.error(`x timing smoke: ${fails} failed`); process.exit(1); }
console.log('timing smoke passed');
