// SEA SMOKE — the only automated coverage `client/game/js/panels/sea-audio.js` has.
//
//   node scripts/audio/sea-smoke.mjs [--report]
//
// Same reason `scripts/voice/fm-smoke.mjs` and `scripts/shapes/smoke.mjs` exist: before this, the
// only thing that ever ran the surf bed was a player standing on a deck in the weather it needed.
// Every number here is arithmetic on the way to an AudioParam, and getting one wrong does not
// throw — it just sounds like a different sea, to whoever happened to be aboard.
//
// ⚠ IT ASSERTS WHAT WAS SCHEDULED, NEVER WHAT IT SOUNDS LIKE. There is no audio comparison here any
// more than shapes/smoke.mjs compares pixels. What it can prove is the thing the whole design rests
// on: that the sea's INTENSITY is a live function of the wind rather than a constant, that the
// numbers come from sea-swell.js rather than from a second copy of the curve, and that the parts
// which must be phase-locked are.
//
// WHAT IT GUARDS:
//   • the bed's LFOs run at the DRAWN swell's frequencies, derived from SEA_ROLL/SEA_WIND
//   • every bed level is monotonic in the wind — no band gets louder as it calms down
//   • a flat calm has NO crest layer and NO breakers at all (Monahan, not a floor)
//   • a gale schedules breakers orders of magnitude more often than a breeze
//   • the reservoir has inertia: a squall does not step the sea in one tick
//   • a crash is a different SOUND at each end of its range, not the same one louder
//   • bubbles land on their Minnaert frequency for the radius chosen
//   • the creak's slip train sweeps up and back down — the stick-slip, not a vibrato
//   • no wind provider is a flat calm, and stopSea() leaves nothing running

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPORT = process.argv.includes('--report');

// ── Recording AudioContext ───────────────────────────────────────────────────
// Lifted from scripts/voice/fm-smoke.mjs: every param write is kept as {type, value, time} and
// nodes are numbered so the graph can be walked afterwards.
let nodes = [];

// ⚠ THE STUB ENFORCES THE REAL API'S CONTRACT, which the one in fm-smoke.mjs does not need to and
// this one does. A real AudioParam THROWS on a non-finite value ("The provided float value is
// non-finite") and an exponential ramp additionally refuses a zero or negative target. A permissive
// stub records `NaN` without complaint, so a whole class of bug — one arithmetic slip anywhere
// upstream of a scheduler tick — passes headlessly and takes the cue out in a browser. Found
// exactly that way: `clamp` was `Math.max(lo, Math.min(hi, v))`, NaN sailed through it, and the
// gate was green while a real context threw.
function guard(name, method, v) {
  if (!Number.isFinite(v)) throw new Error(`${method} on '${name}': non-finite value (${v})`);
  if (method === 'exponentialRampToValueAtTime' && v <= 0) throw new Error(`${method} on '${name}': target must be > 0 (${v})`);
}
const mkParam = (owner, name, value = 0) => ({
  _owner: owner, _name: name, value, log: [],
  setValueAtTime(v, t) { guard(name, 'setValueAtTime', v); this.value = v; this.log.push({ type: 'set', value: v, time: t }); return this; },
  setTargetAtTime(v, t, c) { guard(name, 'setTargetAtTime', v); this.log.push({ type: 'target', value: v, time: t, tc: c }); return this; },
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
  constructor() { this.currentTime = 0; this.sampleRate = 48000; this.state = 'running'; this.destination = mkNode('destination'); }
  createGain() { const n = mkNode('gain'); n.gain = mkParam(n, 'gain', 1); return n; }
  createOscillator() { const n = mkNode('osc'); n.type = 'sine'; n.frequency = mkParam(n, 'frequency', 440); n.detune = mkParam(n, 'detune', 0); return n; }
  createBiquadFilter() { const n = mkNode('filter'); n.type = 'lowpass'; n.frequency = mkParam(n, 'frequency', 350); n.Q = mkParam(n, 'Q', 1); n.gain = mkParam(n, 'gain', 0); return n; }
  createBufferSource() { const n = mkNode('buffersrc'); n.buffer = null; n.loop = false; return n; }
  createStereoPanner() { const n = mkNode('panner'); n.pan = mkParam(n, 'pan', 0); return n; }
  createConvolver() { const n = mkNode('convolver'); n.buffer = null; return n; }
  createBuffer(ch, len) {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: 48000, getChannelData: (i) => data[i] };
  }
  resume() { return Promise.resolve(); }
}

const ctx = new FakeContext();
globalThis.window = globalThis;
// sea-audio reaches the context through the documented engineNodes() seam and nothing else, so the
// whole of AudioEngine can be a three-line stand-in here.
globalThis.AudioEngine = {
  init() {},
  engineNodes: () => ({ ctx, bus: mkNode('bus'), noise: ctx.createBuffer(1, 4096) }),
};
// The module's clock. Every interval is cleared by stopSea, but a gate that leaves one running
// never exits, so they are stubbed and driven by hand.
const intervals = new Set();
globalThis.setInterval = (fn, ms) => { const h = { fn, ms }; intervals.add(h); return h; };
globalThis.clearInterval = (h) => { intervals.delete(h); };
const timeouts = [];
globalThis.setTimeout = (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; };
globalThis.clearTimeout = () => {};
let fakeNow = 0;
globalThis.performance = { now: () => fakeNow };

const S = await import('file://' + join(ROOT, 'client/game/js/panels/sea-audio.js').replace(/\\/g, '/'));
const SW = await import('file://' + join(ROOT, 'client/shared/sea-swell.js').replace(/\\/g, '/'));

let fails = 0;
function check(label, cond, detail) {
  if (cond) { if (REPORT) console.log(`  . ${label}`); return true; }
  fails++;
  console.error(`  x ${label}${detail ? `\n      ${detail}` : ''}`);
  return false;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ── Driving it ───────────────────────────────────────────────────────────────
// Put the sea at a wind and run the scheduler forward without waiting out a 20-second swell.
let windKt = 0;
function seaAt(kt, { seconds = 0 } = {}) {
  windKt = kt;
  S._test.seed(kt);          // skip SEA_RISE_S — the reservoir is tested separately, below
  fakeNow += 1000;
  ctx.currentTime += 1;
  S._test.tick();
  for (let i = 0; i < seconds * 4; i++) { fakeNow += 250; ctx.currentTime += 0.25; S._test.tick(); }
}
// Everything the bed's gains and cutoffs were last walked to.
function bedTargets() {
  const b = S._test.bedNodes();
  if (!b) return null;
  const last = (p) => { const l = p.log.filter(e => e.type === 'target'); return l.length ? l[l.length - 1].value : p.value; };
  return {
    body: last(b.bodyG.gain), swell: last(b.swG.gain), crest: last(b.crG.gain),
    bodyCut: last(b.bodyLP.frequency), swellCut: last(b.swBP.frequency), crestCut: last(b.crHP.frequency),
    rollAM: last(b.rollAM.gain), windAM: last(b.windAM.gain),
    rollHz: b.rollL.frequency.value, windHz: b.windL.frequency.value,
  };
}

console.log('sea-smoke');

// ── 1. It starts, and without a provider it is a flat calm ───────────────────
S.setSeaWindOverride(-1);
check('startSea builds', S.startSea() === true);
check('a bed exists', !!S._test.bedNodes());
S._test.tick();
check('no wind provider is a flat calm, not a crash', S.seaNow().kt === 0, `kt=${S.seaNow().kt}`);
S._test.setWind(() => windKt);

// ── 2. The LFOs are the DRAWN swell ──────────────────────────────────────────
// The one thing in this file a player can check against their own eyes, and the one number a
// well-meaning retune would replace with something rounder.
{
  const b = bedTargets();
  const wantRoll = SW.SEA_ROLL.w / (2 * Math.PI), wantWind = SW.SEA_WIND.w / (2 * Math.PI);
  check('the roll LFO runs at the drawn swell period', near(b.rollHz, wantRoll, 1e-9),
    `want ${wantRoll} Hz (${(1 / wantRoll).toFixed(1)}s), got ${b.rollHz}`);
  check('the wind-sea LFO runs at the drawn wind-sea period', near(b.windHz, wantWind, 1e-9),
    `want ${wantWind} Hz (${(1 / wantWind).toFixed(1)}s), got ${b.windHz}`);
}

// ── 3. Intensity is a live function of the wind ──────────────────────────────
// The heart of it. A sweep of the whole range, asserting every band only ever goes UP.
{
  const KTS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45];
  const rows = KTS.map((kt) => { seaAt(kt); return { kt, ...bedTargets() }; });
  if (REPORT) {
    console.log('    kt   body   swell   crest   bodyHz  swellHz  cap');
    for (const r of rows) {
      console.log(`   ${String(r.kt).padStart(3)}  ${r.body.toFixed(4)}  ${r.swell.toFixed(4)}  ${r.crest.toFixed(4)}   ` +
        `${r.bodyCut.toFixed(0).padStart(5)}   ${r.swellCut.toFixed(0).padStart(5)}   ${SW.whitecapFraction(r.kt).toFixed(4)}`);
    }
  }
  const mono = (key) => rows.every((r, i) => i === 0 || r[key] >= rows[i - 1][key] - 1e-9);
  for (const key of ['body', 'swell', 'crest', 'bodyCut', 'swellCut']) {
    check(`${key} never falls as the wind rises`, mono(key),
      rows.map(r => `${r.kt}kt:${r[key].toFixed(4)}`).join(' '));
  }
  // and it has to actually MOVE — a constant is monotonic too, which is exactly the bug this
  // whole change is about.
  const spread = (key) => rows[rows.length - 1][key] / Math.max(1e-9, rows[0][key]);
  check('the body more than doubles across the range', spread('body') > 2, `x${spread('body').toFixed(2)}`);
  check('the swell more than doubles across the range', spread('swell') > 2, `x${spread('swell').toFixed(2)}`);
  // The crest is keyed on the breaking fraction, so a glassy calm must have literally none of it.
  check('a flat calm has no crest layer at all', rows[0].crest === 0, `got ${rows[0].crest}`);
  check('a gale has a crest layer', rows[rows.length - 1].crest > 0.02, `got ${rows[rows.length - 1].crest}`);
  // The short sea only shows up in a blow — it is the term that makes a storm a storm.
  check('the wind-sea breath is absent in a calm', rows[0].windAM === 0, `got ${rows[0].windAM}`);
  check('the wind-sea breath is present in a gale', rows[rows.length - 1].windAM > 0);
}

// ── 4. The crest is Monahan's, not a fader ───────────────────────────────────
// It must track whitecapFraction exactly, or the sound of breaking water and the sight of it are
// two different opinions.
{
  for (const kt of [8, 18, 30, 45]) {
    seaAt(kt);
    const got = bedTargets().crest, want = 0.55 * SW.whitecapFraction(kt);
    check(`crest at ${kt}kt is 0.55 x whitecapFraction`, near(got, want, 1e-9), `want ${want}, got ${got}`);
  }
}

// ── 5. The reservoir has inertia ─────────────────────────────────────────────
// A cell boundary steps the wind in one frame and the sea must not follow it in one frame.
{
  S.stopSea(); S.startSea({ wind: () => windKt });
  windKt = 0; S._test.seed(0);
  windKt = 45;
  fakeNow += 1000; ctx.currentTime += 1; S._test.tick();
  const after1s = S.seaNow().kt;
  check('a squall does not step the sea in one tick', after1s < 5, `${after1s.toFixed(2)}kt after 1s of 45kt`);
  for (let i = 0; i < 4 * 60 * 5; i++) { fakeNow += 250; ctx.currentTime += 0.25; S._test.tick(); }
  const after5m = S.seaNow().kt;
  check('but it does build, given minutes', after5m > 30, `${after5m.toFixed(2)}kt after 5 min`);
  // and it lies down more slowly than it gets up — SEA_FALL_S > SEA_RISE_S
  check('it falls slower than it rises', SW.SEA_FALL_S > SW.SEA_RISE_S);
}

// ── 6. Breakers: rate from the whitecaps, nothing at all in a calm ───────────
{
  const crashesOver = (kt, seconds) => {
    S.stopSea(); S.startSea({ wind: () => windKt });
    S._test.setWind(() => windKt);
    windKt = kt; S._test.seed(kt);
    let n = 0;
    for (let i = 0; i < seconds * 4; i++) {
      nodes = [];
      fakeNow += 250; ctx.currentTime += 0.25;
      S._test.tick();
      // A crash is the only thing here that sweeps a bandpass down over half a second; a lap is one
      // short chip. Counting the DOWNWARD exponential sweep is what tells them apart.
      if (nodes.some(x => x.kind === 'filter' && x.type === 'bandpass'
        && x.frequency.log.some(e => e.type === 'exp'))) n++;
    }
    return n;
  };
  const calm = crashesOver(4, 600);
  const breeze = crashesOver(18, 600);
  const gale = crashesOver(45, 600);
  if (REPORT) console.log(`    breakers in 10 min:  4kt=${calm}  18kt=${breeze}  45kt=${gale}`);
  check('nothing breaks in a calm', calm === 0, `${calm} breakers at 4kt`);
  check('a gale breaks often', gale > 20, `${gale} breakers in 10 min at 45kt`);
  check('a gale breaks far more often than a breeze', gale > breeze * 4, `breeze=${breeze} gale=${gale}`);
}

// ── 7. A crash is a different SOUND at each end, not the same one louder ─────
{
  S.stopSea(); S.startSea({ wind: () => windKt });
  const grab = (power) => {
    nodes = [];
    S.waveCrash(power, 0);
    const bps = nodes.filter(x => x.kind === 'filter' && x.type === 'bandpass' && x.frequency.log.some(e => e.type === 'exp'));
    const sweep = bps[0]?.frequency.log;
    const start = sweep?.find(e => e.type === 'set')?.value;
    const end = sweep?.find(e => e.type === 'exp')?.value;
    return {
      nodes: nodes.length,
      oscs: nodes.filter(x => x.kind === 'osc').length,
      start, end,
      // the low thump is a sine under ~80 Hz; only a real sea has one
      thump: nodes.some(x => x.kind === 'osc' && x.type === 'sine' && x.frequency.value > 0 && x.frequency.value < 80),
    };
  };
  const small = grab(0.1), big = grab(1);
  // Length is half of what makes a big wave a different EVENT rather than a loud one — a breaker
  // takes seconds to fall over and a slop against a hull does not. Asserted off the returned
  // duration because every other signal here (band, thump, bubble count) goes on varying correctly
  // with a duration nailed to a constant, which is exactly the mutant that got through first time.
  ctx.currentTime += 20;   // clear the concurrency window before asking for two more
  const dSmall = S.waveCrash(0.05, 0), dBig = S.waveCrash(1, 0);
  check('a big sea takes longer to break than a small one', dBig > dSmall * 2, `${dSmall}s vs ${dBig}s`);
  check('the break sweeps DOWNWARD', small.end < small.start, `${small.start} -> ${small.end}`);
  check('a big sea breaks lower than a small one', big.start > small.start, `small=${small.start} big=${big.start}`);
  check('a small lap-sized crash has no low thump', !small.thump);
  check('a big one does', big.thump);
  check('a big crash throws far more bubbles', big.oscs > small.oscs * 2, `small=${small.oscs} big=${big.oscs} oscillators`);
}

// ── 8. Bubbles are Minnaert ──────────────────────────────────────────────────
// f = 3.26/a with a in metres, so 3260/a_mm. The radii are drawn at random, so what is asserted is
// that every bubble in a crash lands in the band those radii imply — a carrier outside it means the
// formula was replaced by a pitch somebody liked.
{
  nodes = [];
  S.waveCrash(1, 0);
  // Carriers are the sines nothing modulates and whose set frequency is in the plink range.
  const modTargets = new Set();
  for (const g of nodes.filter(n => n.kind === 'gain'))
    for (const dst of g.out) if (dst && dst._name === 'frequency') modTargets.add(dst._owner);
  const carriers = nodes.filter(n => n.kind === 'osc' && n.type === 'sine' && n.frequency.log.some(e => e.type === 'set'))
    .filter(n => n.frequency.value > 200);
  const LO = 3260 / 9, HI = 3260 / 0.8;   // the radius clamp in bubble()
  const out = carriers.filter(n => {
    const f = n.frequency.log.find(e => e.type === 'set').value;
    return f < LO - 1 || f > HI + 1;
  });
  check('every bubble sits on a Minnaert frequency for a plausible radius', out.length === 0,
    `${out.length} of ${carriers.length} outside ${LO.toFixed(0)}-${HI.toFixed(0)} Hz`);
  check('a heavy break is made of many bubbles', carriers.length >= 4, `${carriers.length}`);
  if (REPORT && carriers.length) {
    const fs = carriers.map(n => n.frequency.log.find(e => e.type === 'set').value).sort((a, b) => a - b);
    console.log(`    bubbles: ${fs.length}, ${fs[0].toFixed(0)}-${fs[fs.length - 1].toFixed(0)} Hz ` +
      `(radii ${(3260 / fs[fs.length - 1]).toFixed(1)}-${(3260 / fs[0]).toFixed(1)} mm)`);
  }
}

// ── 9. The creak is stick-slip, not vibrato ──────────────────────────────────
// The defining assertion of the whole patch. A slip train is an AMPLITUDE modulator whose RATE
// sweeps up through the event and back down; a modulator on the carrier's PITCH at a steady rate is
// a moan, and it is what this would decay into if anyone "simplified" it.
{
  for (const load of [0.2, 1]) {
    nodes = [];
    S.hullCreak(load);
    const saws = nodes.filter(n => n.kind === 'osc' && n.type === 'sawtooth');
    check(`creak(${load}) has a slip oscillator`, saws.length === 1, `${saws.length} sawtooth oscillators`);
    const slip = saws[0];
    if (slip) {
      const ramps = slip.frequency.log.filter(e => e.type === 'ramp');
      const f0 = slip.frequency.log.find(e => e.type === 'set')?.value;
      check(`creak(${load}) slip rate sweeps up then back down`,
        ramps.length === 2 && ramps[0].value > f0 && ramps[1].value < ramps[0].value,
        `set=${f0} ramps=${ramps.map(r => r.value.toFixed(1)).join(' -> ')}`);
      // It must reach the carrier's GAIN. Into .frequency it is a vibrato and the creak is gone.
      const intoGain = slip.out.some(g => g.out?.some(d => d?._name === 'gain'));
      check(`creak(${load}) slip train is amplitude, not pitch`, intoGain);
    }
    // The body must be inharmonic or it reads as an instrument.
    const carrier = nodes.find(n => n.kind === 'osc' && n.type === 'triangle');
    const mod = nodes.find(n => n.kind === 'osc' && n.type === 'sine' && n.out.some(g => g.out?.some(d => d?._name === 'frequency')));
    if (carrier && mod) {
      const ratio = mod.frequency.value / carrier.frequency.value;
      check(`creak(${load}) modulator ratio is inharmonic`, Math.abs(ratio - Math.round(ratio)) > 0.15,
        `ratio ${ratio.toFixed(3)}`);
    }
  }
  // A hard-worked hull squeals; a settling one does not.
  const count = (load) => { nodes = []; S.hullCreak(load); return nodes.filter(n => n.kind === 'osc').length; };
  check('a hard load adds a squeal the light one has not', count(1) > count(0.2), `${count(0.2)} vs ${count(1)} oscillators`);
}

// ── 10. Junk in does not throw ───────────────────────────────────────────────
// Every voice here is called from a scheduler tick with a computed argument, and a real AudioParam
// answers a non-finite value by THROWING rather than by ignoring it — which from inside an interval
// is the whole sea stopping, silently, for the rest of the session. Found in a browser, kept here.
{
  S.stopSea(); S.startSea({ wind: () => windKt });
  for (const bad of [NaN, undefined, null, 'loud', Infinity, -Infinity, -5, 99]) {
    ctx.currentTime += 20;   // past the concurrency window, or the cap short-circuits the arithmetic
    let threw = null;
    try { S.waveCrash(bad, bad); S.lap(bad); S.hullCreak(bad); } catch (e) { threw = e.message; }
    check(`power=${String(bad)} does not throw`, !threw, threw);
  }
  // and a wind provider that returns junk is a calm, not a crash
  S._test.setWind(() => NaN);
  fakeNow += 1000; ctx.currentTime += 1;
  let tickThrew = null;
  try { S._test.tick(); } catch (e) { tickThrew = e.message; }
  check('a wind provider returning NaN does not throw', !tickThrew, tickThrew);
  check('and reads as a calm', Number.isFinite(S.seaNow().kt), `kt=${S.seaNow().kt}`);
  S._test.setWind(() => windKt);
}

// ── 11. It stops ─────────────────────────────────────────────────────────────
{
  S.stopSea();
  check('stopSea clears the tick', intervals.size === 0, `${intervals.size} intervals still armed`);
  check('stopSea drops the bed', !S._test.bedNodes());
  check('isSeaRunning goes false', S.isSeaRunning() === false);
}

// ── 12. Stepping off the deck and straight back on ───────────────────────────
// The teardown runs 1.6 s after stopSea and a player is faster than that. If it is not
// generation-checked it fires AFTER the restart and disconnects the chain the restarted sea is
// using — leaving a running scheduler with no path to the bus, `isSeaRunning()` true, and silence
// for the rest of the session. Nothing observable says so, which is why it is worth a gate.
{
  S.startSea({ wind: () => windKt });            // section 11 left it stopped; a stop needs a start
  timeouts.length = 0;
  S.stopSea();                                   // arms a teardown
  const pending = timeouts.length;
  check('stopSea arms a deferred teardown', pending > 0);
  S.startSea({ wind: () => windKt });             // ...and the player comes straight back out
  for (const { fn } of timeouts) { try { fn(); } catch {} }   // the old timer fires late
  const c = S._test.chain();
  check('a restart survives the previous teardown', !!c.out && !!c.verbIn,
    `out=${!!c.out} verbIn=${!!c.verbIn} — the chain was torn down under the running sea`);
  check('and the bed is still connected', !!S._test.bedNodes());
  S.stopSea();
}

if (fails) { console.error(`\nsea-smoke FAILED (${fails})`); process.exit(1); }
console.log('sea-smoke ok');
