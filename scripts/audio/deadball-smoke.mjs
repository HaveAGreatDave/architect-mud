// DEADBALL SMOKE: the ballpark's soundset rendered and held to its brief, and the Grandstand's
// mixer driven through a world.
//
//   node scripts/audio/deadball-smoke.mjs
//
// Every patch in client/shared/deadball-sfx.js is rendered through the real audio-engine.js on
// scripts/audio/offline-audio.mjs, and so are the crowd bed and the park's air.
// client/game/js/panels/diamond/sound.js is driven against a recording engine: real clips playing
// on a real world (diamond/world.js), a ball on a path, fireworks and a crowd getting up.
// docs/systems-deadball-sound.md is the brief. Needs no browser, DB or network.
//
// WHAT IT GUARDS:
//   • every patch: finite samples, starting and ending in silence, no DC, a peak with headroom,
//     a length inside its family's range; on the TV's effects bus, in the 'deadball' group
//   • a seeded take renders the same samples twice, and two seeds differ
//   • every event the mixer can name has a patch, every umpire's call but 'ball' has words, and
//     every call is short enough for ORACLE to shout
//   • the 2-D view's nine names are all patches
//   • the busiest moment (a grand slam's crack, sparks, fanfare, roar, two shells and the organ)
//     stays under full scale at the mix's levels
//   • the crowd bed rises with its level, never steps, adds no nodes and is silent after stop();
//     the park's air is finite and silent after stop()
//   • the mixer: a clip's catch, tag, throw, footsteps, slide and umpire's call are heard at their
//     times, once; a catch the director names isn't played again off the clip; the ball's bounce,
//     the wall and the backstop; the fireworks' launch, burst (late, by distance) and crackle; the
//     crowd's cheer, roar and groan; the mix's levels and the duck under the booth; Sound Detail's
//     three tiers; the announcer's calls and the booth waiting for one
//   • SFXCatalog.addBank folds the bank in once
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OfflineContext, installAudioGlobals } from './offline-audio.mjs';
import { renderCue, measure, SR } from './hockey-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); } };

installAudioGlobals();
if (!globalThis.AudioEngine) new Function(readFileSync(join(ROOT, 'client/shared/audio-engine.js'), 'utf8'))();
const AE = globalThis.AudioEngine;
const B = await imp('client/shared/deadball-sfx.js');
const { createParkSound, callFor, onDirt, tension } = await imp('client/game/js/panels/diamond/sound.js');
const { createWorld, DT } = await imp('client/game/js/panels/diamond/world.js');
const { CALLS: UMP_CALLS, CLIP_EVENTS } = await imp('client/game/js/panels/diamond/clip-schema.js');
const byId = new Map(B.BUILTINS.map((d) => [d.id, d]));

// ── the patches ──────────────────────────────────────────────────────────────
// [length ms lo, hi] by family; a long cue is rendered at 16 kHz, which is plenty to see its shape
const FAMILY = [
  [/^db-crack-screamer$/, [300, 700]],
  [/^db-dive-dirt$/, [150, 500]],
  [/^db-(airhorn|hype-boom)$/, [500, 1400]],
  [/^db-(drum-chant|stomp)$/, [1200, 2600]],
  [/^db-(crack|bunt|bat-break|foul-tip)/, [30, 300]],
  [/^db-(mitt|glove|stretch|tag|pickoff|hop|ball-dirt|hbp|cleat|throw|whiff|dive|collision)/, [20, 300]],
  [/^db-(roll|wall|net|backstop|seats|slide)/, [100, 450]],
  [/^db-pole$/, [500, 1200]],
  [/^db-(horn|lamp)$/, [200, 800]],
  [/^db-foghorn$/, [2000, 4000]],
  [/^db-clap$/, [30, 150]],
  [/^db-crowd|^db-towels$/, [300, 4500]],
  [/^db-(sting|click|beep|trail|sparks|rewind|sweep|table)/, [10, 1200]],
  [/^db-fw-/, [300, 1800]],
  [/^db-organ-dirge$/, [9000, 13000]],
  [/^db-organ-rally$/, [1000, 2000]],
  [/^db-organ-anthem$/, [11000, 17000]],
];
const M = new Map();
check('the bank has about fifty patches', B.BUILTINS.length >= 50, String(B.BUILTINS.length));
check('patch ids are unique', byId.size === B.BUILTINS.length);
for (const d of B.BUILTINS) {
  check(`${d.id}: in the deadball group, on the TV's effects`, d.group === 'deadball' && d.category === 'tv_fx', `${d.group}/${d.category}`);
  const long = (d.config.duration || 0) + Math.max(...d.config.layers.map((l) => (l.delay || 0) + l.adsr.a + l.adsr.d)) > 1.5;
  const buf = await renderCue(AE, d, long ? { sampleRate: 16000 } : {});
  const m = measure(buf.getChannelData(0), buf.sampleRate);
  M.set(d.id, m);
  check(`${d.id}: finite`, m.finite);
  check(`${d.id}: starts at silence`, m.first < 1e-3, m.first.toExponential(2));
  check(`${d.id}: ends in silence`, m.tail === 'ok', m.tail);
  check(`${d.id}: no DC (under 1% of the peak)`, m.dc < 0.01, m.dc.toFixed(4));
  check(`${d.id}: a peak with headroom`, m.peak > 0.02 && m.peak <= 0.6, m.peak.toFixed(3));
  const fam = FAMILY.find(([re]) => re.test(d.id));
  check(`${d.id}: has a family`, !!fam);
  if (fam) check(`${d.id}: ${fam[1][0]}-${fam[1][1]} ms long`, m.lenMs >= fam[1][0] && m.lenMs <= fam[1][1], `${m.lenMs} ms`);
}
check('the barrel is the loudest contact', ['db-crack-end', 'db-crack-jam', 'db-bunt'].every((id) => M.get(id).peak < M.get('db-crack').peak));
check('a footstep is quiet beside the ball into a glove', M.get('db-cleat-dirt').peak < M.get('db-glove').peak * 0.5);
check('a screamer is louder than the barrel', M.get('db-crack-screamer').peak > M.get('db-crack').peak * 0.95, `${M.get('db-crack-screamer').peak.toFixed(3)}`);
check('hit hard is a screamer, a pop-up is under the ball', B.eventFor('crack', { ev: 106 }).id === 'db-crack-screamer' && B.eventFor('crack', { ev: 90, t: 'pu' }).id === 'db-crack-pop' && B.eventFor('crack', { ev: 106, foul: true }).id !== 'db-crack-screamer');
check('a dive on the dirt is the dirt dive', B.eventFor('dive', { dirt: true }).id === 'db-dive-dirt' && B.eventFor('dive', {}).id === 'db-dive');
{
  const calm = tension({ inning: 2, homeScore: 5, awayScore: 0, outs: 0 }, {});
  const tight = tension({ inning: 9, homeScore: 3, awayScore: 3, outs: 2, basesBefore: [false, true, true] }, { pitch: { strikes: 2, balls: 3 } });
  const rout = tension({ inning: 9, homeScore: 12, awayScore: 3, outs: 2, basesBefore: [true, true, true] }, { pitch: { strikes: 2 } });
  check('tension: a tie in the ninth with men on matters more than the second inning', tight > 0.8 && calm < 0.2, `${calm.toFixed(2)} ${tight.toFixed(2)}`);
  check('tension: a blowout empties the park', rout < 0.4, rout.toFixed(2));
  check('tension: a half-inning break is nothing', tension({ phase: 'half', inning: 9 }, {}) === 0);
}

// a take
{
  const d = byId.get('db-crack');
  const a = (await renderCue(AE, B.variant(d, 7))).getChannelData(0), b = (await renderCue(AE, B.variant(d, 7))).getChannelData(0), c = (await renderCue(AE, B.variant(d, 8))).getChannelData(0);
  let same = a.length === b.length, diff = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) same = false; diff = Math.max(diff, Math.abs(a[i] - (c[i] || 0))); }
  check('a seed renders the same take twice', same);
  check('two seeds are two takes', diff > 1e-3, diff.toExponential(2));
  const soft = (await renderCue(AE, B.variant(d, 7, 1, 0.2))).getChannelData(0);
  check('a soft take is quieter', measure(soft, SR).peak < measure(a, SR).peak * 0.8);
}

// ── the tables ───────────────────────────────────────────────────────────────
const SAMPLES = [{}, { ev: 100 }, { ev: 65 }, { ev: 50 }, { ev: 80, foul: true }, { broken: true }, { foulTip: true }, { tip: true }, { role: 'catcher' }, { stretch: true }, { pickoff: true }, { dirt: true }, { dirt: false }];
for (const key of Object.keys(B.EVENTS)) {
  const ids = new Set(SAMPLES.map((o) => B.eventFor(key, o)?.id).filter(Boolean));
  check(`event '${key}' has a sound`, ids.size > 0);
  for (const id of ids) check(`event '${key}': ${id} is a patch`, byId.has(id));
}
for (const c of UMP_CALLS) if (c !== 'ball') check(`the umpire has words for '${c}'`, !!B.CALLS.umpire[c]);
const shout = (s) => s === s.toUpperCase() && s.replace(/[^A-Z]/g, '').length <= 20;
for (const [k, s] of Object.entries({ ...B.CALLS.announcer, ...B.CALLS.umpire })) check(`'${k}' is a shout: ${s}`, shout(s));
for (const who of ['announcer', 'umpire', 'pa', 'vendor']) {
  const v = B.VOICES[who];
  check(`the ${who}'s voice is fully authored`, v && ['f0', 'fshift', 'speed', 'ring', 'oq', 'jitter', 'breath', 'lilt', 'decl', 'drive', 'growl'].every((k) => Number.isFinite(v[k])));
}
for (const k of ['mitt', 'crack', 'whiff', 'glove', 'base', 'run', 'homer', 'strikeout', 'out']) check(`the 2-D view's '${k}' is a patch`, !!B.DEADBALL_SFX[k] && byId.has(B.DEADBALL_SFX[k].id));
check('every clip event kind is known to the mixer', Object.keys(CLIP_EVENTS).every((k) => ['release', 'contact', 'catch', 'call', 'step', 'hit', 'tag'].includes(k)), Object.keys(CLIP_EVENTS).join(','));

// the busiest moment, at the mix's levels, before the TV slider
{
  const g = (id) => M.get(id).peak * Math.pow(10, B.MIX[B.layerOf(id)].db / 20);
  const worst = g('db-crack') + g('db-sparks') + g('db-sting-homer') + g('db-crowd-roar') + 2 * g('db-fw-burst') + g('db-organ-rally');
  check('a grand slam at its busiest stays under full scale', worst < 1, worst.toFixed(3));
}

// ── the beds ─────────────────────────────────────────────────────────────────
{
  const seconds = 12, off = new OfflineContext(1, SR * seconds, SR);
  const bed = B.crowdBed({ ctx: off, dest: off.destination, noise: AE.engineNodes().noise });
  bed.start(0); bed.setLevel(0.1, 0); bed.setLevel(0.5, 3); bed.setLevel(1, 6); bed.duck(4, 0.8, 7.5); bed.setLevel(0.15, 8);
  const n0 = bed._nodes();
  bed.stop(seconds - 2);
  const d = (await off.startRendering()).getChannelData(0);
  const rms = (a, b) => { let s = 0; for (let i = a * SR; i < b * SR; i++) s += d[i] * d[i]; return Math.sqrt(s / ((b - a) * SR)); };
  let finite = true, tail = 0;
  for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) finite = false;
  for (let i = d.length - SR * 0.1; i < d.length; i++) tail = Math.max(tail, Math.abs(d[i]));
  // a step is a 10 ms window more than 2.2 times the one before (hockey-smoke's measure), after the
  // fade-in and before the stop
  const w = SR / 100, win = [];
  for (let i = 0; i + w <= d.length; i += w) { let s = 0; for (let j = i; j < i + w; j++) s += d[j] * d[j]; win.push(Math.sqrt(s / w)); }
  let step = 0;
  for (let k = 51; k < win.length - 300; k++) { const r = Math.max(win[k], 1e-4) / Math.max(win[k - 1], 1e-4); step = Math.max(step, r, 1 / r); }
  const [q, mid, loud, back] = [rms(2, 3), rms(5, 6), rms(6.5, 7.4), rms(9.5, 10)];
  check('crowd: finite', finite);
  check('crowd: rises with its level', q < mid && mid < loud, `${q.toFixed(4)} ${mid.toFixed(4)} ${loud.toFixed(4)}`);
  check('crowd: comes back down', back < loud * 0.6, `${back.toFixed(4)} against ${loud.toFixed(4)}`);
  check('crowd: steered without a step', step < 2.2, `${step.toFixed(2)}×`);
  check('crowd: steering adds no nodes', bed._nodes() === n0);
  check('crowd: silent after stop()', tail < 1e-3, tail.toExponential(2));
}
{
  const seconds = 6, off = new OfflineContext(1, SR * seconds, SR);
  const park = B.parkBed({ ctx: off, dest: off.destination, noise: AE.engineNodes().noise });
  park.start(0); park.set({ night: 1, wind: 1, rain: 1 }, 0.5);
  park.stop(seconds - 2.2);
  const d = (await off.startRendering()).getChannelData(0);
  let finite = true, peak = 0, tail = 0;
  for (let i = 0; i < d.length; i++) { if (!Number.isFinite(d[i])) finite = false; peak = Math.max(peak, Math.abs(d[i])); }
  for (let i = d.length - SR * 0.1; i < d.length; i++) tail = Math.max(tail, Math.abs(d[i]));
  check('park: finite, and heard', finite && peak > 0.005, peak.toFixed(4));
  check('park: under the crowd at its loudest', peak < 0.3, peak.toFixed(4));
  check('park: silent after stop()', tail < 1e-3, tail.toExponential(2));
}

// ── the mixer ────────────────────────────────────────────────────────────────
// A recording engine: what's played and said, and a booth that speaks when told to.
function recorder() {
  const R = { played: [], said: [], booth: 0, scene: 0 };
  R.engine = {
    playSfx: (def, gain, opts) => { R.played.push({ id: def.id, gain, opts }); return {}; },
    speak: (text, opt) => { R.said.push({ text, opt }); return { duration: 1 }; },
    speechLeft: (ch) => (ch === 'scene' ? R.scene : R.booth),
    cancelSpeech: (ch) => R.said.push({ cancel: ch }),
  };
  return R;
}
function run(detail, script) {
  const R = recorder(), S = { pitch: null }, st = { p: { kind: 'single', half: 'top', inning: 3 }, S };
  const snd = createParkSound({ win: { AudioEngine: R.engine }, state: () => st, detail });
  const W = createWorld();
  snd.hear(W);
  const at = (t, fn) => W.at(t, fn);
  script({ W, at, snd, S, st, R });
  for (let k = 0; k < 6 * 60; k++) {
    for (let j = 0; j < 2; j++) W.step(DT);
    snd.hear(W, { fx: st.fx, roar: st.roar });
  }
  snd.dispose();
  return { R, log: snd._log };
}
const count = (log, key) => log.filter((e) => e[0] === key).length;

const full = run('full', ({ W, at, snd, st }) => {
  W.place('ss', { id: 'Home:SS', role: 'fielder', at: [40, 0, 110], yaw: 180 });
  W.play('ss', 'field_gb', { at: 0.1 });                         // catch at 0.9
  at(0.9, () => snd.cue('glove'));                                // the director names the same catch
  W.place('1b', { id: 'Home:1B', role: 'fielder', at: [-60, 0, 66], yaw: 135 });
  W.play('1b', 'tag_first', { at: 1.2 });                         // a catch at 1.45 and a tag at 1.62
  W.place('cf', { id: 'Home:CF', role: 'fielder', at: [0, 0, 300], yaw: 180 });
  W.play('cf', 'throw_over', { at: 2.0 });                        // a throw at 2.43
  W.place('r', { id: 'Away:runner', role: 'runner', at: [60, 0, 60], yaw: 0 });
  W.play('r', 'slide_feet', { at: 3.0 });                         // the slide at 3.29
  W.place('ump:plate', { id: 'ump:plate', role: 'ump', at: [1, 0, -5], yaw: 0 });
  W.play('ump:plate', 'ump_strike', { at: 0.5 });                 // the call at 1.12
  W.place('b', { id: 'Away:batter', role: 'batter', at: [-3, 0, 0], yaw: 90 });
  W.play('b', 'bat_hbp', { at: 4.0 });                            // hit at 4.22
  // a ball bouncing once on the grass, then one off the wall, then one at the backstop
  at(0.2, () => W.setBall((t) => { const u = Math.max(0, t - 0.2); return [0, Math.abs(10 * Math.sin(u * 2.4)) + 0.12, 140 + 60 * u]; }));
  at(2.0, () => W.setBall((t) => { const u = t - 2; return [0, 6, u < 1 ? 300 + 60 * u : 360 - 40 * (u - 1)]; }));
  at(4.5, () => W.setBall((t) => [0, 4, -40 - 50 * (t - 4.5)]));
  // fireworks, and the crowd getting up
  st.fx = [{ kind: 'burst', t: 2.5, at: [0, 100, 450] }, { kind: 'trail', from: 1.5, to: 2.5 }, { kind: 'sparks', t: 1.6 }];
  // createRoar's sides: [home, visitors]
  at(3.0, () => { st.roar = [0.5, 0]; }); at(3.4, () => { st.roar = [0.9, 0]; }); at(4.0, () => { st.roar = [0.1, 0]; });
  at(4.6, () => { st.roar = [0.1, 0.6]; });
});
const L = full.log, said = full.R.said.filter((s) => s.text);
check('mixer: the shortstop\'s catch, once though the director named it too', count(L, 'glove') === 2, `${count(L, 'glove')} gloves (want the shortstop's and the first baseman's)`);
check('mixer: the tag', count(L, 'tag') === 1);
check('mixer: the throw', count(L, 'release') >= 1);
check('mixer: the slide', count(L, 'slide') === 1);
check('mixer: the hit batter', count(L, 'hit') === 1);
check('mixer: footsteps at full', count(L, 'step') >= 4, String(count(L, 'step')));
check('mixer: the umpire\'s strike, on the scene channel at -3 dB', said.some((s) => s.text === 'STRIKE!' && s.opt.channel === 'scene' && Math.abs(s.opt.gain - Math.pow(10, -3 / 20)) < 1e-6), JSON.stringify(said[0]));
check('mixer: a bounce on the ball\'s path', count(L, 'hop') === 1, String(count(L, 'hop')));
check('mixer: the ball off the wall, once', count(L, 'wall') === 1, String(count(L, 'wall')));
check('mixer: the backstop', count(L, 'backstop') + count(L, 'net') === 1);
check('mixer: the fireworks go up, burst and crackle', count(L, 'launch') === 1 && count(L, 'burst') === 1 && count(L, 'crackle') === 1);
check('mixer: the trail and the sparks', count(L, 'trail') === 1 && count(L, 'sparks') === 1);
{
  const order = L.map((e) => e[0]);
  check('mixer: the burst is heard after it goes up', order.indexOf('launch') < order.indexOf('burst'));
}
check('mixer: the home crowd cheers, then roars', count(L, 'cheer') === 1 && count(L, 'roar') === 1);
check('mixer: the away side up alone is a groan', count(L, 'groan') === 1);
check('mixer: dispose stops the scene\'s voices', full.R.said.some((s) => s.cancel === 'scene'));

// the mix's levels, and the duck while the booth speaks
{
  const R = recorder(), st = { p: {}, S: {} };
  const snd = createParkSound({ win: { AudioEngine: R.engine }, state: () => st, detail: 'limited' });
  snd.cue('whiff');
  R.booth = 2; snd.cue('whiff'); R.booth = 0;
  const fx = Math.pow(10, -9 / 20);
  check('mix: an effect sits 9 dB under the booth', Math.abs(R.played[0]?.gain - fx) < 1e-6, String(R.played[0]?.gain));
  check('mix: and 6 dB further under while the booth speaks', Math.abs(R.played[1]?.gain - fx * Math.pow(10, -6 / 20)) < 1e-6, String(R.played[1]?.gain));
  // the bat and the glove stand out of the effects: 4 dB under the booth, 3 more while it speaks
  snd.cue('glove');
  R.booth = 2; snd.cue('glove'); R.booth = 0;
  const imp = Math.pow(10, -4 / 20);
  check('mix: the ball into a glove sits 4 dB under the booth', Math.abs(R.played[2]?.gain - imp) < 1e-6, String(R.played[2]?.gain));
  check('mix: and 3 dB further while it speaks', Math.abs(R.played[3]?.gain - imp * Math.pow(10, -3 / 20)) < 1e-6, String(R.played[3]?.gain));
  // a voice in the picture doesn't start over the booth
  R.booth = 2; snd.land({ kind: 'homerun', rbi: 1, half: 'bottom' }); R.booth = 0;
  check('mix: no call over the booth', !R.said.some((s) => s.text === 'HOME RUN!'));
  // the booth's call at the crack: on the pitch put in play, in the announcer's voice, beside the
  // booth's own channel; not on a foul
  // (the director names the crack before the pitch, so the nth crack is the nth pitch the bat touched)
  st.p = { kind: 'single', play: { t: 'gb', ev: 104 }, pitches: [{ result: 'ball' }, { result: 'foul' }, { result: 'inplay' }], contact: { text: 'Smoked on the ground toward third!', by: 'Chip Vega' } };
  snd.payload(st.p);
  snd.cue('crack');
  check('crack: no call on a foul', !R.said.some((s) => s.text === st.p.contact.text));
  snd.cue('crack');
  const call = R.said.find((s) => s.text === st.p.contact.text);
  check('crack: the booth calls the ball in play', !!call && call.opt.channel === 'scene' && call.opt.seed === 'Chip Vega', JSON.stringify(call?.opt));
  st.p = {}; st.S = {};
  // the landing: a home run's sting and its call; a called third strike is the umpire's
  snd.land({ kind: 'homerun', rbi: 1, half: 'bottom' });
  check('land: a home run\'s fanfare and its call', R.played.some((p) => p.id === 'db-sting-homer') && R.said.some((s) => s.text === 'HOME RUN!' && s.opt.channel === 'scene'));
  check('land: a grand slam is called as one', callFor({ kind: 'homerun', rbi: 4 }) === 'GRAND SLAM!');
  check('land: a walk-off is called as one', callFor({ kind: 'single', walkoff: true }) === 'WALK-OFF!');
  check('land: a swinging third strike is the announcer\'s', callFor({ kind: 'strikeout' }, { result: 'swinging' }) === 'STRIKE THREE!');
  check('land: a called third strike isn\'t', callFor({ kind: 'strikeout' }, { result: 'called' }) === null);
  // the booth waits for the call
  let spoke = 0;
  R.scene = 1; snd.afterCall(() => spoke++);
  check('the booth waits while the call is said', spoke === 0);
  R.scene = 0; snd.afterCall(() => spoke++);
  check('and speaks at once when nothing is', spoke === 1);
  snd.payload({ phase: 'half', inning: 4, half: 'top' });
  check('a half-inning break gets its sweep', R.played.some((p) => p.id === 'db-sweep'));
  snd.dispose();
}

// Sound Detail: off keeps the calls; limited the events but no footsteps or park; full all of it
{
  const sc = ({ W, at, snd }) => {
    W.place('ss', { id: 'Home:SS', role: 'fielder', at: [40, 0, 110], yaw: 180 });
    W.play('ss', 'field_gb', { at: 0.1 });
    W.place('ump:plate', { id: 'ump:plate', role: 'ump', at: [1, 0, -5], yaw: 0 });
    W.play('ump:plate', 'ump_strike', { at: 0.5 });
    at(1.5, () => snd.land({ kind: 'homerun', rbi: 1, half: 'bottom' }));
  };
  const off = run('off', sc), lim = run('limited', sc);
  check('off: nothing played', off.R.played.length === 0, off.R.played.map((p) => p.id).join(','));
  check('off: the calls still said', off.R.said.some((s) => s.text === 'STRIKE!') && off.R.said.some((s) => s.text === 'HOME RUN!'));
  check('limited: the events', count(lim.log, 'glove') === 1 && count(lim.log, 'homer') === 1);
  check('limited: no footsteps', count(lim.log, 'step') === 0);
}

{
  const creep = run('full', ({ W }) => {
    for (const [slot, x] of [['2b', -40], ['3b', 60], ['lf', 120]]) { W.place(slot, { id: `Home:${slot}`, role: 'fielder', at: [x, 0, 150], yaw: 180 }); W.play(slot, 'field_ready_in', { at: 0.2 }); }
  });
  check('full: fielders creeping in as the pitch comes aren\'t heard', count(creep.log, 'step') === 0, String(count(creep.log, 'step')));
  const gone = run('limited', ({ W, at, st }) => {
    st.p = { kind: 'homerun', half: 'top', play: { hr: 'plain' } };
    const path = (t) => [0, 30, 300 + 100 * (t - 1)];
    path.land = 2.5;
    at(1, () => W.setBall(path));
  });
  check('a home run clatters into the seats where it comes down, once', count(gone.log, 'seats') === 1, String(count(gone.log, 'seats')));
}

check('the dirt is the infield\'s and the track\'s', onDirt(0, 60) && onDirt(60, 60) && !onDirt(0, 250) && onDirt(0, 395));

// ── the catalog ──────────────────────────────────────────────────────────────
{
  const g = {};
  new Function('globalThis', 'window', readFileSync(join(ROOT, 'client/shared/sfx-catalog.js'), 'utf8'))(g, g);
  const C = g.SFXCatalog, n0 = C.list().length;
  C.addBank(B.BUILTINS, 'deadball', 'Deadball (KSAB broadcast)');
  C.addBank(B.BUILTINS, 'deadball', 'Deadball (KSAB broadcast)');
  check('catalog: the bank folds in once', C.list().length === n0 + B.BUILTINS.length, `${C.list().length - n0}`);
  check('catalog: under its group', C.GROUPS.deadball === 'Deadball (KSAB broadcast)' && C.get('db-crack')?.id === 'db-crack');
}

console.log(`deadball smoke: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
