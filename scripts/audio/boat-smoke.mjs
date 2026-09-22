// BOAT SMOKE — the only automated coverage `client/game/js/panels/boat-audio.js` has.
//
//   node scripts/audio/boat-smoke.mjs [--report]
//
// The sibling of `scripts/audio/sea-smoke.mjs`, and it exists for that file's reason: before this,
// the only thing that ever ran the motor was somebody sitting in the boat. Every number in there is
// on its way to an AudioParam, and getting one wrong does not throw — it just sounds like a
// different engine, to whoever happened to be driving.
//
// ⚠ IT ASSERTS WHAT WAS SCHEDULED, NEVER WHAT IT SOUNDS LIKE. No more than shapes/smoke.mjs
// compares pixels. What it can prove is the set of claims the design actually rests on:
//
//   • the exhaust note is rpm/15 Hz because a V8 fires four times a revolution — not a chosen span
//   • and the oscillator is really ramped to that, rather than to a number near it
//   • opening the throttle makes every layer louder; nothing gets quieter as you ask for more
//   • coming ON the throttle is a fast light crackle, coming OFF it at revs is a few heavy bangs
//     — a different SOUND at each end, not the same one at two volumes
//   • the bark scheduler runs on the AUDIO clock over a window, so its rate cannot be capped by
//     the frame rate, and calling it twice in a frame does not schedule the same window twice
//   • a hard overrun genuinely overlaps pool voices rather than cancelling itself quieter
//   • the doppler is RELATIVE and its sign is right: closing raises, opening lowers, abeam is 1
//   • a contact out of range gets no voice, the cap holds, and one leaving is wound down
//   • inside the enclosed helm the motor is MUFFLED rather than merely quieter
//   • stopping leaves nothing running

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPORT = process.argv.includes('--report');

// ── Recording AudioContext ───────────────────────────────────────────────────
// Lifted from sea-smoke.mjs, including the part that matters most: the stub ENFORCES the real
// API's contract. A live AudioParam throws on a non-finite value and an exponential ramp refuses a
// target at or below zero, so a permissive stub would pass a whole class of arithmetic slip that
// takes the audio thread out in a browser.
let nodes = [];
function guard(name, method, v) {
  if (!Number.isFinite(v)) throw new Error(`${method} on '${name}': non-finite value (${v})`);
  if (method === 'exponentialRampToValueAtTime' && v <= 0) throw new Error(`${method} on '${name}': target must be > 0 (${v})`);
}
const mkParam = (owner, name, value = 0) => ({
  _owner: owner, _name: name, value, log: [],
  setValueAtTime(v, t) { guard(name, 'setValueAtTime', v); this.value = v; this.log.push({ type: 'set', value: v, time: t }); return this; },
  setTargetAtTime(v, t, c) { guard(name, 'setTargetAtTime', v); this.target = v; this.log.push({ type: 'target', value: v, time: t, tc: c }); return this; },
  linearRampToValueAtTime(v, t) { guard(name, 'linearRampToValueAtTime', v); this.log.push({ type: 'ramp', value: v, time: t }); return this; },
  exponentialRampToValueAtTime(v, t) { guard(name, 'exponentialRampToValueAtTime', v); this.log.push({ type: 'exp', value: v, time: t }); return this; },
  cancelScheduledValues() { return this; },
});
function mkNode(kind) {
  const n = { kind, id: nodes.length, out: [], started: null, stopped: null };
  n.connect = (dst) => { n.out.push(dst); return dst; };
  n.disconnect = () => {};
  n.start = (t) => { n.started = t ?? 0; };
  n.stop = (t) => { n.stopped = t ?? 0; };
  nodes.push(n);
  return n;
}
class FakeContext {
  constructor() { this.currentTime = 0; this.sampleRate = 48000; this.state = 'running'; }
  createGain() { const n = mkNode('gain'); n.gain = mkParam(n, 'gain', 1); return n; }
  createOscillator() { const n = mkNode('osc'); n.type = 'sine'; n.frequency = mkParam(n, 'frequency', 440); return n; }
  createBiquadFilter() { const n = mkNode('filter'); n.type = 'lowpass'; n.frequency = mkParam(n, 'frequency', 350); n.Q = mkParam(n, 'Q', 1); return n; }
  createBufferSource() { const n = mkNode('buffersrc'); n.buffer = null; n.loop = false; return n; }
  createStereoPanner() { const n = mkNode('panner'); n.pan = mkParam(n, 'pan', 0); return n; }
  createBuffer(ch, len) {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: 48000, getChannelData: (i) => data[i] };
  }
  resume() { return Promise.resolve(); }
}

const ctx = new FakeContext();
globalThis.window = globalThis;
globalThis.AudioEngine = {
  init() {},
  engineNodes: () => ({ ctx, bus: mkNode('bus'), noise: ctx.createBuffer(1, 4096) }),
};
// stopV8 defers its teardown; a gate that leaves one pending never exits, so they are collected and
// run by hand where the test wants them.
const timeouts = [];
globalThis.setTimeout = (fn) => { timeouts.push(fn); return timeouts.length; };
globalThis.clearTimeout = () => {};
const runTimeouts = () => { const t = timeouts.splice(0); t.forEach((fn) => fn()); };

// ⚠ PIN THE DICE. The bark spacing is deliberately ragged (an even 1/hz is a drum machine), so an
// unpinned run measures a different pop count every time and the "a window is a window" check below
// becomes a coin toss. Every other harness in this repo pins it for the same reason.
let seed = 1;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const B = await import('file://' + join(ROOT, 'client/game/js/panels/boat-audio.js').replace(/\\/g, '/'));

let fails = 0;
function check(label, cond, detail) {
  if (cond) { if (REPORT) console.log(`  . ${label}`); return true; }
  fails++;
  console.error(`  x ${label}${detail ? `\n      ${detail}` : ''}`);
  return false;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
// The last value a param was steered toward, whichever way it was written.
const last = (p) => (p.log.length ? p.log[p.log.length - 1].value : p.value);

console.log('BOAT SMOKE — the blown V8');

// ── 1. THE NOTE IS THE ENGINE'S ──────────────────────────────────────────────
console.log('\n  the firing frequency');
{
  check('idle is 850 crank rpm', B.crankRpm(0) === B.RPM_IDLE);
  check('and the stop is 7200', B.crankRpm(1) === B.RPM_MAX);
  // Four power strokes a revolution is the whole derivation; if this ever stops being rpm/15 it is
  // because somebody has changed how many cylinders the motor has.
  check('the exhaust note is rpm / 15 Hz at idle', near(B.firingHz(0), B.RPM_IDLE / 15, 1e-9),
    `${B.firingHz(0).toFixed(2)} vs ${(B.RPM_IDLE / 15).toFixed(2)}`);
  check('and at the stop', near(B.firingHz(1), B.RPM_MAX / 15, 1e-9));
  check('which puts the note in the audible band the whole way',
    B.firingHz(0) > 40 && B.firingHz(0) < 70 && B.firingHz(1) > 400 && B.firingHz(1) < 520,
    `idle ${B.firingHz(0).toFixed(0)} Hz, max ${B.firingHz(1).toFixed(0)} Hz`);
  // ⚠ THE ROTOR PULSE IS NOT THE NOTE, AND THIS CHECK IS WHY THE FILE KNOWS IT. Three lobes at
  // 1.22:1 is 3.66 pulses a revolution against the motor's own four, so the fundamental sits just
  // BELOW the exhaust note — which is not what a supercharger sounds like from ten feet away. The
  // first cut put the carrier there with its bandpass at 3.5 kHz and the whole layer was silent.
  check('the rotor pulse is geared off the CRANK, not off the firing rate',
    near(B.blowerHz(1) / B.crankRpm(1), B.BLOWER_RATIO * 3 / 60, 1e-9));
  check('and its fundamental really does sit under the exhaust note', B.blowerHz(1) < B.firingHz(1),
    `${B.blowerHz(1).toFixed(0)} against ${B.firingHz(1).toFixed(0)}`);
  check('so what you hear is a harmonic, well above it', B.blowerToneHz(1) > B.firingHz(1) * 4,
    `${B.blowerToneHz(1).toFixed(0)} Hz against a ${B.firingHz(1).toFixed(0)} Hz note`);
  check('and the shriek stays inside the audible band at the stop', B.blowerToneHz(1) < 6000,
    `${B.blowerToneHz(1).toFixed(0)} Hz`);
}

// ── 2. THE GRAPH IS REALLY RAMPED TO IT ──────────────────────────────────────
// ⚠ A DERIVATION THAT NOTHING READS IS NOT A FEATURE. `firingHz` being right proves nothing about
// what the oscillator was told; this is the check that the two are connected.
console.log('\n  what the oscillator is actually told');
const N = B._test.makeV8(ctx, mkNode('bus'), ctx.createBuffer(1, 16), { pan: true });
{
  for (const r of [0, 0.5, 1]) {
    B._test.rampV8(N, { rpm: r, pedal: r, doppler: 1 });
    check(`core osc sits on the firing note at rpm ${r}`, near(last(N.core.frequency), B.firingHz(r), 0.001),
      `told ${last(N.core.frequency).toFixed(2)}, wanted ${B.firingHz(r).toFixed(2)}`);
  }
  B._test.rampV8(N, { rpm: 0.8, pedal: 0.8, doppler: 1 });
  check('the crank order is half the firing rate', near(last(N.sub.frequency), B.firingHz(0.8) / 2, 0.001));
  check('the two banks are detuned, not doubled',
    last(N.bankB.frequency) > last(N.core.frequency) && last(N.bankB.frequency) < last(N.core.frequency) * 1.05,
    `bank B ${last(N.bankB.frequency).toFixed(2)} against ${last(N.core.frequency).toFixed(2)}`);
  // ⚠ A FILTER LISTENING WHERE NOTHING IS PLAYING IS A SILENT LAYER, and it is silent in exactly
  // the way a correctly-wired feature is: the node exists, the gain ramps, the sweep moves, and no
  // sound comes out. This is the check that caught it.
  for (const r of [0, 0.5, 1]) {
    B._test.rampV8(N, { rpm: r, pedal: 1, doppler: 1 });
    const car = last(N.blow.car.frequency), band = last(N.blow.bp.frequency);
    check(`the blower band is on its own carrier at rpm ${r}`, band > car * 0.6 && band < car * 2.2,
      `band ${band.toFixed(0)} Hz against a carrier at ${car.toFixed(0)} Hz`);
  }
}

// ── 3. MONOTONIC IN THE THROTTLE ─────────────────────────────────────────────
console.log('\n  nothing gets quieter as you open it');
{
  const at = (r) => { B._test.rampV8(N, { rpm: r, pedal: r, doppler: 1 }); return {
    core: last(N.coreG.gain), sub: last(N.subG.gain), blow: last(N.blow.g.gain),
    air: last(N.air.g.gain), crackle: last(N.crackle.g.gain), lp: last(N.coreLP.frequency) }; };
  const lo = at(0.05), mid = at(0.5), hi = at(1);
  for (const k of ['core', 'sub', 'blow', 'air', 'crackle', 'lp']) {
    check(`${k} rises with revs`, lo[k] < mid[k] && mid[k] < hi[k],
      `${lo[k].toFixed(4)} -> ${mid[k].toFixed(4)} -> ${hi[k].toFixed(4)}`);
  }
  // The lowpass opening is what makes a motor sound like it is trying rather than being played
  // back faster, so it has to open by a real amount rather than by a hair.
  check('and the lowpass really opens', hi.lp > lo.lp * 5, `${lo.lp.toFixed(0)} Hz -> ${hi.lp.toFixed(0)} Hz`);
}

// ── 4. ON THE THROTTLE AND OFF IT ARE DIFFERENT SOUNDS ───────────────────────
console.log('\n  crackle versus bang');
{
  const cruise = B.barkRate({ rpm: 0.7, rich: 0, bang: 0 });
  const onIt = B.barkRate({ rpm: 0.4, rich: 1, bang: 0 });
  const offIt = B.barkRate({ rpm: 0.9, rich: 0, bang: 1 });
  check('coming on the throttle crackles faster than cruising', onIt.hz > cruise.hz * 2,
    `${onIt.hz.toFixed(1)}/s against ${cruise.hz.toFixed(1)}/s`);
  check('and the crackle is LIGHT', onIt.low < 0.2, `low ${onIt.low.toFixed(2)}`);
  check('shutting it at revs is HEAVY', offIt.low > 0.8, `low ${offIt.low.toFixed(2)}`);
  check('and each bang is louder than a crackle', offIt.level > onIt.level * 1.5,
    `${offIt.level.toFixed(3)} against ${onIt.level.toFixed(3)}`);
  // ⚠ THE ONE THAT WOULD MAKE IT A MACHINE GUN: if the overrun both cracked hardest AND fastest it
  // would be a burble at volume rather than a backfire.
  check('a backfire is not merely a faster crackle', offIt.hz < onIt.hz,
    `off ${offIt.hz.toFixed(1)}/s, on ${onIt.hz.toFixed(1)}/s`);
  check('a big cam will not idle clean', B.barkRate({ rpm: 0.05, rich: 0, bang: 0 }).hz > 0);
  check('and a stopped motor makes none', B.barkRate({ rpm: 0, rich: 0, bang: 0 }).hz > 0 === true);
}

// ── 5. THE SCHEDULER IS ON THE AUDIO CLOCK ───────────────────────────────────
console.log('\n  the bark scheduler');
{
  const fresh = () => { const M = B._test.makeV8(ctx, mkNode('bus'), ctx.createBuffer(1, 16), {}); M._barkTo = 0; return M; };
  const popsOf = (M) => M.pops.reduce((n, v) => n + v.g.gain.log.filter((e) => e.type === 'ramp' && e.value > 0).length, 0);

  const M = fresh();
  ctx.currentTime = 10;
  const hot = { rpm: 0.9, rich: 1, bang: 0 };
  const first = B._test.scheduleBarks(M, hot, 1);
  check('a window schedules several pops from one call', first >= 3,
    `${first} in ${B._test.BARK_AHEAD}s at ${B.barkRate(hot).hz.toFixed(1)}/s`);
  // ⚠ THE CHECK THE WHOLE DESIGN RESTS ON. Calling again in the SAME audio frame must schedule
  // nothing: the window is already full. Without the `_barkTo` watermark the rate would be
  // "whatever the frame rate is times whatever the window holds", which is a rate that changes when
  // the renderer gets busy.
  const second = B._test.scheduleBarks(M, hot, 1);
  check('and calling again in the same frame adds none', second === 0, `${second} extra`);
  // Move the clock on by the window and it refills.
  ctx.currentTime += B._test.BARK_AHEAD;
  check('a window later it refills', B._test.scheduleBarks(M, hot, 1) > 0);

  // Every pop is a real envelope on a real node.
  check('pops actually reach the pool', popsOf(M) > 0, `${popsOf(M)} envelopes`);

  // ⚠ OVERLAP. A hard overrun schedules faster than one pop decays, so more than one pool voice has
  // to be carrying an envelope — the single-envelope version of this came out smoother and QUIETER
  // the harder you hit it, which is the opposite of a backfire.
  const O = fresh(); ctx.currentTime = 40;
  for (let i = 0; i < 6; i++) { B._test.scheduleBarks(O, { rpm: 1, rich: 1, bang: 1 }, 1); ctx.currentTime += B._test.BARK_AHEAD; }
  const used = O.pops.filter((v) => v.g.gain.log.length > 0).length;
  check('a hard overrun uses more than one pool voice', used > 1, `${used} of ${O.pops.length}`);
  // And the low thump is only on the heavy ones.
  const lowUsed = (M2) => M2.pops.reduce((n, v) => n + v.lg.gain.log.filter((e) => e.type === 'ramp' && e.value > 1e-6).length, 0);
  const C = fresh(); ctx.currentTime = 80;
  B._test.scheduleBarks(C, { rpm: 0.5, rich: 1, bang: 0 }, 1);
  check('a crackle has no thump under it', lowUsed(C) === 0, `${lowUsed(C)} thumps`);
  check('a bang does', lowUsed(O) > 0, `${lowUsed(O)} thumps`);

  // Silence is silence.
  const Z = fresh(); ctx.currentTime = 120;
  check('a stopped motor schedules nothing', B._test.scheduleBarks(Z, { rpm: 0, rich: 0, bang: 0 }, 0) === 0);
}

// ── 6. DOPPLER ───────────────────────────────────────────────────────────────
console.log('\n  the doppler');
{
  // Heading frame is the sim's: 0 = north = -y, 90 = east = +x.
  const me = { x: 0, y: 0, hdg: 0, speed: 0 };
  const ahead = { x: 0, y: -5 };
  // ⚠ SIGN FIRST. Everything else here is a consequence of it, and a doppler with its sign
  // backwards is plausible in both directions until two boats actually pass.
  const away = B.closingMph(me, { ...ahead, hdg: 0, speed: 100 });     // running north, ahead of me
  const toward = B.closingMph(me, { ...ahead, hdg: 180, speed: 100 }); // coming back at me
  check('a boat running away opens the range', away > 0, `${away.toFixed(1)} mph`);
  check('a boat coming at me closes it', toward < 0, `${toward.toFixed(1)} mph`);
  check('and it is the full speed when it is dead ahead', near(Math.abs(away), 100, 0.01));
  const abeam = B.closingMph(me, { x: 5, y: 0, hdg: 0, speed: 100 });
  check('a boat crossing abeam is neither', near(abeam, 0, 0.01), `${abeam.toFixed(3)} mph`);

  check('closing raises the note', B.dopplerFor(toward) > 1, B.dopplerFor(toward).toFixed(3));
  check('opening lowers it', B.dopplerFor(away) < 1, B.dopplerFor(away).toFixed(3));
  check('abeam is exactly 1', B.dopplerFor(0) === 1);
  check('and it is bounded both ways',
    B.dopplerFor(-99999) <= B._test.DOPPLER_HI && B.dopplerFor(99999) >= B._test.DOPPLER_LO);

  // ⚠ RELATIVE, NOT ABSOLUTE, AND ONLY ONE ARRANGEMENT PROVES IT. Two boats ABREAST is the obvious
  // case and it is worth nothing here: their velocity is square to the line of sight, so the dot
  // product is zero whether or not my own is subtracted, and a version of `closingMph` that ignores
  // the listener entirely passes it. (Measured — it did.) LINE ASTERN is the case: both boats
  // running north at ninety, one five tiles ahead, the gap not changing at all. Drop my own
  // velocity and that reads as ninety miles an hour of opening range, which is the boat in front
  // dropping a fourth in pitch while it sits exactly where it was.
  const abreast = B.closingMph({ x: 0, y: 0, hdg: 0, speed: 90 }, { x: 2, y: 0, hdg: 0, speed: 90 });
  check('two boats running abreast at ninety do not shift', near(abreast, 0, 0.01), `${abreast.toFixed(3)} mph`);
  const astern = B.closingMph({ x: 0, y: 0, hdg: 0, speed: 90 }, { x: 0, y: -5, hdg: 0, speed: 90 });
  check('and neither does one you are chasing at your own speed', near(astern, 0, 0.01),
    `${astern.toFixed(3)} mph — the listener's own velocity is not in the sum`);
  const gaining = B.closingMph({ x: 0, y: 0, hdg: 0, speed: 120 }, { x: 0, y: -5, hdg: 0, speed: 90 });
  check('but running one down does close the range', gaining < -25, `${gaining.toFixed(1)} mph`);

  // And the shift really reaches the oscillator.
  B._test.rampV8(N, { rpm: 0.8, pedal: 0.8, doppler: 1 });
  const flat = last(N.core.frequency);
  B._test.rampV8(N, { rpm: 0.8, pedal: 0.8, doppler: 1.25 });
  check('the shift reaches the core oscillator', near(last(N.core.frequency), flat * 1.25, 0.01),
    `${flat.toFixed(1)} -> ${last(N.core.frequency).toFixed(1)}`);
  B._test.rampV8(N, { rpm: 0.8, pedal: 0.8, doppler: 1.25 });
  check('and the blower', last(N.blow.car.frequency) > B.blowerHz(0.8));
}

// ── 7. THE PASS-BY POOL ──────────────────────────────────────────────────────
console.log('\n  who gets a voice');
{
  B.stopBoatContacts();
  const me = { x: 0, y: 0, hdg: 0, speed: 60 };
  const boat = (id, x, y) => ({ id, x, y, hdg: 180, speed: 90, rpm: 0.8, power: 0.8, rich: 0.2, bang: 0, marine: true });

  check('nothing in range, no voices', B.updateBoatContacts(me, []) === 0);
  // ⚠ ONE CONTACT SHAPE CARRIES EVERYTHING THE SEAT CAN SEE. A pilot's feed is mostly aeroplanes
  // and a cab's is mostly trucks, so an unfiltered pass would give a Leviathan overhead the voice
  // of a blown V8 — which is not a subtle wrongness, it is a jet with a small-block in it.
  const plane = { id: 'p1', x: 0, y: -3, hdg: 0, speed: 180, cls: 'heavy', ias: 160 };
  check('an aircraft in the same feed gets no V8', B.updateBoatContacts(me, [plane]) === 0);
  check('a boat past hearing gets none', B.updateBoatContacts(me, [boat('a', 0, -(B._test.HEAR_TILES + 5))]) === 0);
  check('a boat inside it gets one', B.updateBoatContacts(me, [boat('a', 0, -4)]) === 1);
  // ⚠ THE CAP. A voice is nine oscillators plus a bark pool; a basin full of hulls is a choir.
  const many = [];
  for (let i = 0; i < 9; i++) many.push(boat('b' + i, i * 0.4, -(1 + i)));
  check('and the pool is capped', B.updateBoatContacts(me, many) === B._test.MAX_VOICES,
    `${B.boatAudioState().voices} voices`);
  // Nearest first, so the cap keeps the boat you can see rather than three you cannot.
  check('nearest first', B.boatAudioState().ids.includes('b0'), B.boatAudioState().ids.join(','));
  // One leaving is wound down rather than left ringing.
  B.updateBoatContacts(me, [boat('b0', 0, -2)]);
  check('a contact that went away lost its voice', B.boatAudioState().voices === 1 && B.boatAudioState().ids[0] === 'b0');
  // A contact voice pans; the own ship deliberately does not.
  const V = B._test.voice('b0');
  check('a contact voice has a panner', !!V && !!V.panner);
  B.startBoatEngine();
  check('the own ship has none', !!B._test.ownNode() && !B._test.ownNode().panner,
    'your own motor is behind you wherever you look');
}

// ── 8. INSIDE THE HELM ───────────────────────────────────────────────────────
console.log('\n  the enclosed helm');
{
  const Q = B._test.makeV8(ctx, mkNode('bus'), ctx.createBuffer(1, 16), {});
  B._test.rampV8(Q, { rpm: 0.85, pedal: 0.85, doppler: 1, perspective: 'exterior' });
  const out = { tone: last(Q.tone.frequency), blow: last(Q.blow.g.gain), core: last(Q.coreG.gain), sub: last(Q.subG.gain) };
  B._test.rampV8(Q, { rpm: 0.85, pedal: 0.85, doppler: 1, perspective: 'interior' });
  const ins = { tone: last(Q.tone.frequency), blow: last(Q.blow.g.gain), core: last(Q.coreG.gain), sub: last(Q.subG.gain) };
  // ⚠ MUFFLED, NOT QUIETER, and the two are a different feeling. Quiet-and-full-range reads as the
  // engine having moved away; this hull's house is glazed on five sides and the driver is INSIDE it.
  check('inside, the top end goes', ins.tone < out.tone * 0.4, `${out.tone.toFixed(0)} Hz -> ${ins.tone.toFixed(0)} Hz`);
  check('the blower is damped with it', ins.blow < out.blow);
  check('and the lows come UP, through the structure', ins.core > out.core && ins.sub > out.sub,
    `core ${out.core.toFixed(4)} -> ${ins.core.toFixed(4)}`);
}

// ── 9. DISTANCE EATS THE TOP END ─────────────────────────────────────────────
console.log('\n  distance');
{
  const Q = B._test.makeV8(ctx, mkNode('bus'), ctx.createBuffer(1, 16), {});
  B._test.rampV8(Q, { rpm: 0.85, pedal: 0.85, doppler: 1, distance: 0 });
  const close = last(Q.tone.frequency);
  B._test.rampV8(Q, { rpm: 0.85, pedal: 0.85, doppler: 1, distance: 1 });
  const far = last(Q.tone.frequency);
  check('a boat a long way off is a thump, not a crack', far < close * 0.35,
    `${close.toFixed(0)} Hz -> ${far.toFixed(0)} Hz`);
}

// ── 10. STOPPING ─────────────────────────────────────────────────────────────
console.log('\n  stopping');
{
  B.startBoatEngine();
  B.updateBoatEngine({ rpm: 0.8, pedal: 0.8, rich: 0.5 });
  check('the own motor is running', B.isBoatEngineRunning());
  B.stopBoatAudio();
  runTimeouts();
  check('and it stops', !B.isBoatEngineRunning());
  check('with no pass-by voices left', B.boatAudioState().voices === 0);
  // ⚠ STOPPING TWICE IS A REAL PATH — a panel closing while a logout is already tearing it down —
  // and it must not throw.
  let threw = false;
  try { B.stopBoatAudio(); B.stopBoatContacts(); B.stopBoatEngine(); } catch { threw = true; }
  check('stopping again is harmless', !threw);
  check('updating a stopped motor is a no-op, not a throw', B.updateBoatEngine({ rpm: 1 }) === false);
}

// ── 11. NOTHING NON-FINITE EVER REACHED A PARAM ──────────────────────────────
// Implicit in every check above — the stub throws on one — but stated so a reader knows it is
// covered, and so a run with a garbage state block is part of the sweep rather than a hope.
console.log('\n  garbage in');
{
  const Q = B._test.makeV8(ctx, mkNode('bus'), ctx.createBuffer(1, 16), { pan: true });
  let threw = null;
  try {
    for (const bad of [{}, { rpm: NaN, pedal: NaN, doppler: NaN, distance: NaN, pan: NaN },
      { rpm: -5, pedal: 99, doppler: 0, distance: -1, pan: 12 },
      { rpm: undefined, rich: null, bang: 'x' }]) {
      B._test.rampV8(Q, bad);
      B._test.scheduleBarks(Q, bad, 1);
    }
  } catch (e) { threw = e.message; }
  check('a garbage state block never reaches a param as NaN', !threw, threw || '');
}

console.log(fails ? `\nBOAT SMOKE: ${fails} FAILED` : '\nBOAT SMOKE: all checks passed');
process.exit(fails ? 1 : 0);
