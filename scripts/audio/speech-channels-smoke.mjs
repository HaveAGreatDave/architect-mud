// SPEECH CHANNELS SMOKE: the TV and Read Aloud are separate voices, and a typed command stops
// only Read Aloud.
//
//   node scripts/audio/speech-channels-smoke.mjs
//
// Step 3 of docs/proposals/siren-fidelity.md. Pure: the engine runs on the recording context in
// stub-context.mjs, and logreader.js runs against a stub speechSynthesis.
//
// WHAT IT GUARDS:
//   • a Read Aloud line doesn't stop a TV line, and a TV line doesn't stop Read Aloud
//   • a new line on a channel replaces the last one on that channel only
//   • `queue: true` waits behind the line speaking, and the queue is short
//   • cancelSpeech('ui') stops Read Aloud only; cancelSpeech() still stops everything
//   • a Read Aloud line ducks the tv bus for its own length
//   • TV speech rides the tv bus's voice sub-gain; Read Aloud rides the dry ui bus
//   • logreader: a typed command (shush) cancels only the 'ui' channel; natural Read Aloud takes
//     the TV duck on its utterance's start event and lets go on its end event
//   • tv.js and the library cancel only the 'tv' channel
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, tally, downstream, ROOT } from './stub-context.mjs';

const { check, done } = tally('audio:speech-channels');
const { A, ctx, nodes } = loadEngine();
const G = A._graph();
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// The sources a speak() started: oscillators and buffer sources built during the call.
function say(text, opt) {
  const from = nodes.length;
  const res = A.speak(text, opt);
  const made = nodes.slice(from);
  return { res, made, src: made.filter(n => (n.kind === 'osc' || n.kind === 'buffersrc') && n.started != null) };
}
// A source stopped by a cancel was stopped with no time; a live one keeps its scheduled stop.
const cancelled = (line) => line.src.length > 0 && line.src.every(n => n.stopped === 0);
const live = (line) => line.src.length > 0 && line.src.every(n => n.stopped > 0);

ctx.currentTime = 5;
const tv1 = say('Good evening, and welcome to the Coldwater evening report.', { seed: 'newsreader' });
check('a TV line speaks', tv1.res && tv1.res.duration > 0 && tv1.src.length > 0, JSON.stringify(tv1.res));
check('it reports its channel', tv1.res?.channel === 'tv');
check('TV speech reaches the tv voice sub-gain', tv1.made.some(n => n.out.some(e => e.dst === G.tvVoice)));
check('TV speech does not touch the ui bus', !tv1.made.some(n => downstream(n).has(G.buses.ui.slider[0])));

const ui1 = say('You see a rusted door to the north.', { seed: 'reader', channel: 'ui' });
check('a Read Aloud line speaks', ui1.res && ui1.res.duration > 0 && ui1.res.channel === 'ui');
check('Read Aloud does not stop the TV', live(tv1));
check('Read Aloud rides the ui bus', ui1.made.some(n => n.out.some(e => e.dst === G.buses.ui.slider[0])));
{
  const t = G.buses.tv.duck[0].gain.log.filter(e => e.type === 'target');
  const start = 5 + ui1.res.delay;
  check('Read Aloud ducks the tv bus when it starts', t[0] && t[0].value < 0.5 && near(t[0].time, start, 1e-3), JSON.stringify(t[0]));
  check('and lets it back up when it ends', t[1] && near(t[1].value, 1) && t[1].time >= start + ui1.res.duration, JSON.stringify(t[1]));
  check('Read Aloud ducks nothing else', ['music', 'sfx', 'ambient', 'ui'].every(n => !G.buses[n].duck[0].gain.log.some(e => e.type === 'target')));
}

const tv2 = say('In other news, the Curtain held.', { seed: 'newsreader' });
check('a new TV line replaces the last TV line', cancelled(tv1));
check('a new TV line leaves Read Aloud speaking', live(ui1));

A.cancelSpeech('ui');
check("cancelSpeech('ui') stops Read Aloud", cancelled(ui1));
check("cancelSpeech('ui') leaves the TV speaking", live(tv2));
{
  // The line hadn't started (it was due 50 ms on), so its duck is withdrawn: every event from
  // now on is cancelled and nothing takes the TV down again.
  const log = G.buses.tv.duck[0].gain.log;
  const lastCancel = log.map(e => e.type).lastIndexOf('cancel');
  const after = log.slice(lastCancel + 1);
  check('cancelling Read Aloud withdraws its TV duck', lastCancel >= 0 && near(log[lastCancel].time, 5) && !after.some(e => e.value < 1),
    JSON.stringify(log.slice(lastCancel)));
}

// The queue.
const q1 = say('The first of four.', { seed: 'announcer', queue: true });
check('queue: a line queued behind a speaking line waits', q1.res && q1.res.delay > 0.05, JSON.stringify(q1.res));
check('queue: it doesn\'t cancel the line it waits behind', live(tv2));
check('queue: it starts after that line ends', q1.src.every(n => n.started >= 5 + tv2.res.delay + tv2.res.duration));
const q2 = say('The second.', { seed: 'announcer', queue: true });
const q3 = say('The third.', { seed: 'announcer', queue: true });
check('queue: each waits behind the one before', q3.res && q2.res && q3.res.delay > q2.res.delay && q2.res.delay > q1.res.delay);
const q4 = say('One too many.', { seed: 'announcer', queue: true });
check('queue: it holds three waiting lines and no more', q4.res === null && q4.src.length === 0, JSON.stringify(q4.res));

A.cancelSpeech();
check('cancelSpeech() with no channel stops everything', cancelled(tv2) && cancelled(q1) && cancelled(q3));

// ── logreader.js ──────────────────────────────────────────────────────────────
const calls = [];
let lastUtterance = null;
globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; lastUtterance = this; } };
globalThis.window.speechSynthesis = { speak() { calls.push('ss.speak'); }, cancel() { calls.push('ss.cancel'); } };
const realEngine = globalThis.AudioEngine;
let duckHeld = 0;
globalThis.AudioEngine = {
  ...realEngine,
  cancelSpeech: (ch) => calls.push('cancelSpeech:' + (ch ?? 'ALL')),
  readerDuck: () => { duckHeld++; calls.push('readerDuck'); return { release() { duckHeld--; calls.push('release'); } }; },
};
const LR = await import('file://' + join(ROOT, 'client/game/js/logreader.js').replace(/\\/g, '/'));

LR.setLogReaderMode('natural');
LR.enqueueForReading('A long room description that somebody wants to skip.');
check('natural: the reader speaks through speechSynthesis', calls.includes('ss.speak'));
check('natural: no duck before the voice starts', duckHeld === 0);
lastUtterance.onstart?.();
check('natural: the utterance start takes the TV duck', duckHeld === 1);
lastUtterance.onend?.();
check('natural: the utterance end lets it go', duckHeld === 0);

LR.enqueueForReading('Another line.');
lastUtterance.onstart?.();
calls.length = 0;
LR.shush();
check('a typed command cancels the Read Aloud channel', calls.includes('cancelSpeech:ui'), calls.join(', '));
check('a typed command never cancels every channel', !calls.includes('cancelSpeech:ALL') && !calls.includes('cancelSpeech:tv'), calls.join(', '));
check('a typed command stops the natural voice', calls.includes('ss.cancel'));
check('a typed command lets the TV duck go', duckHeld === 0);

LR.setLogReaderMode('off');
calls.length = 0;
LR.shush();
check('with Read Aloud off, a typed command still touches only the ui channel', calls.every(c => c !== 'cancelSpeech:ALL' && c !== 'cancelSpeech:tv'), calls.join(', '));
globalThis.AudioEngine = realEngine;

// ── The other callers ─────────────────────────────────────────────────────────
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
for (const p of ['client/game/js/panels/tv.js', 'client/game/js/panels/tablet-os.js']) {
  const bare = (src(p).match(/cancelSpeech\??\.?\(\s*\)/g) || []).length;
  check(`${p} cancels only the tv channel`, bare === 0, `${bare} bare cancelSpeech() call(s)`);
}
check('logreader.js has no bare cancelSpeech()', !/cancelSpeech\??\.?\(\s*\)/.test(src('client/game/js/logreader.js')));

done();
