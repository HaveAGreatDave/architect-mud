// HOCKEY SMOKE — the CPhL soundset rendered and held to its brief.
//
//   node scripts/audio/hockey-smoke.mjs
//
// Unlike the other audio checks, which read what a graph SCHEDULES, this one reads the
// SAMPLES: every patch in client/shared/hockey-sfx.js is rendered through the real
// audio-engine.js on scripts/audio/offline-audio.mjs (the Web Audio subset SIREN uses, in
// Node), and so is the crowd bed through every state. docs/systems-hockey-sound.md is the
// brief the numbers come from. Needs no browser, DB or network.
//
// WHAT IT GUARDS:
//   • every patch: finite samples, starting at silence and ending in it, no DC, a peak with
//     headroom, an attack and a length inside its kind's range
//   • the patches stay where they belong: a stick click is high, a check isn't sub-bass,
//     the whistle is where a phone speaker plays it, the period buzzer isn't the goal horn
//   • a seeded take renders the same samples twice; takes differ, but a whistle or a horn
//     barely, an impact more
//   • the retro stage really holds and rounds (sample-and-hold steps, a capped number of
//     levels), through the AudioWorklet a browser runs
//   • a goal at its busiest doesn't clip the master, and the horn stays on top of the contacts
//   • the voice pool: a flood of contacts never steals the horn or the whistle, and every
//     voice is free again once its sound has ended
//   • the crowd bed: rises state by state, never steps, adds no nodes as it's steered, and
//     is silent after stop()
//   • every event the rink fires has a sound in the event table, and every table entry is a patch
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHockey, renderCue, measure, spectrum, renderCrowd, SR } from './hockey-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); } };

const { AE, H } = loadHockey();
const byId = new Map(H.BUILTINS.map((d) => [d.id, d]));

// ── the brief, as ranges: [length ms lo, hi], attack ms max (to half the peak) ─────────
const KIND = [
  [/^hk-puck-stick|^hk-pass$|^hk-puck-tick$|^hk-faceoff-drop$/, [18, 60], 3],
  [/^hk-boards/, [45, 130], 3],
  [/^hk-puck-body$|^hk-chest-save$/, [45, 120], 3],
  [/^hk-check/, [90, 220], 4],
  [/^hk-skate/, [70, 250], 12],
  [/^hk-whistle-short$/, [150, 450], 12],
  [/^hk-whistle$/, [300, 600], 12],
  [/^hk-signal/, [80, 300], 6],
  [/^hk-goal-horn-short$/, [600, 1400], 40],
  [/^hk-goal-horn$/, [1500, 2400], 40],
  [/^hk-period-horn$/, [800, 2500], 40],
  [/^hk-crowd-gasp$/, [150, 500], 60],
  [/^hk-crowd-cheer$/, [500, 1500], 200],
  [/^hk-crowd-goal$/, [1500, 4000], 300],
];
const kindOf = (id) => KIND.find(([re]) => re.test(id));

const M = new Map();
for (const d of H.BUILTINS) {
  const buf = await renderCue(AE, d);
  const m = measure(buf.getChannelData(0), buf.sampleRate);
  M.set(d.id, { ...m, data: buf.getChannelData(0) });
  check(`${d.id}: finite`, m.finite);
  check(`${d.id}: starts at silence`, m.first < 1e-3, m.first.toExponential(2));
  check(`${d.id}: ends in silence`, m.tail === 'ok', m.tail);
  check(`${d.id}: no DC (under 1% of the peak)`, m.dc < 0.01, m.dc.toFixed(4));
  check(`${d.id}: a peak with headroom`, m.peak > 0.02 && m.peak <= 0.75, m.peak.toFixed(3));
  const k = kindOf(d.id);
  if (k) {
    const [, [lo, hi], atk] = k;
    check(`${d.id}: lasts ${lo}–${hi} ms`, m.lenMs >= lo && m.lenMs <= hi, `${m.lenMs} ms`);
    check(`${d.id}: reaches half its peak within ${atk} ms`, m.attackMs <= atk, `${m.attackMs.toFixed(2)} ms`);
  }
}

// ── where they sit ─────────────────────────────────────────────────────────────
const mm = (id) => M.get(id);
for (const id of ['hk-puck-stick-light', 'hk-puck-stick', 'hk-puck-stick-hard']) check(`${id}: a high click (centroid over 1.5 kHz)`, mm(id).centroid > 1500, mm(id).centroid.toFixed(0));
for (const id of ['hk-boards-soft', 'hk-boards', 'hk-boards-hard']) check(`${id}: a knock, not a boom (centroid 400–1,500 Hz, under 15% below 150 Hz)`, mm(id).centroid > 400 && mm(id).centroid < 1500 && mm(id).low < 0.15, `${mm(id).centroid.toFixed(0)} Hz, ${(mm(id).low * 100).toFixed(0)}%`);
for (const id of ['hk-check-light', 'hk-check', 'hk-check-boards']) check(`${id}: contact first, not sub-bass (under 40% below 150 Hz)`, mm(id).low < 0.4, `${(mm(id).low * 100).toFixed(0)}%`);
for (const id of ['hk-whistle-short', 'hk-whistle']) check(`${id}: where a phone speaker plays it (centroid 2–3.5 kHz, nothing below 150 Hz)`, mm(id).centroid > 2000 && mm(id).centroid < 3500 && mm(id).low < 0.01, mm(id).centroid.toFixed(0));
check('the period buzzer sits well above the goal horn', mm('hk-period-horn').centroid > mm('hk-goal-horn').centroid * 1.6, `${mm('hk-period-horn').centroid.toFixed(0)} vs ${mm('hk-goal-horn').centroid.toFixed(0)} Hz`);
check('the signals sit below the whistle', mm('hk-signal').centroid < mm('hk-whistle').centroid * 0.75, `${mm('hk-signal').centroid.toFixed(0)} vs ${mm('hk-whistle').centroid.toFixed(0)} Hz`);
check('the goal horn is the loudest thing that sustains', mm('hk-goal-horn').rms >= Math.max(mm('hk-period-horn').rms, mm('hk-whistle').rms), `${mm('hk-goal-horn').rms.toFixed(3)}`);

// ── priorities, in the brief's order ────────────────────────────────────────────
const pri = (re) => H.BUILTINS.filter((d) => re.test(d.id)).map((d) => d.priority);
const minP = (re) => Math.min(...pri(re)), maxP = (re) => Math.max(...pri(re));
check('horns outrank the whistle', minP(/horn/) > maxP(/whistle/));
check('the whistle outranks checks and saves', minP(/whistle/) > maxP(/^hk-check|-save$|^hk-glass$/));
check('checks and saves outrank puck impacts and shots', minP(/^hk-check|-save$/) > maxP(/^hk-puck-stick|^hk-boards|^hk-pass$|^hk-puck-tick$|^hk-shot|^hk-puck-slap$/));
check('puck impacts outrank skating', minP(/^hk-puck-stick$|^hk-boards$|^hk-puck-slap$/) > maxP(/^hk-skate-scrape$/));
check('skating outranks the crowd bed', minP(/^hk-skate/) > maxP(/^hk-crowd-bed$/));

// ── takes ──────────────────────────────────────────────────────────────────────
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
for (const id of ['hk-check', 'hk-boards', 'hk-skate-stop', 'hk-whistle', 'hk-goal-horn-short']) {
  const d = byId.get(id);
  const a = (await renderCue(AE, H.variant(d, 4242))).getChannelData(0), b = (await renderCue(AE, H.variant(d, 4242))).getChannelData(0);
  const c = (await renderCue(AE, H.variant(d, 777))).getChannelData(0);
  check(`${id}: a seeded take renders the same samples twice`, same(a, b));
  check(`${id}: two seeds are two takes`, !same(a, c));
  const steady = (d.vary || {}).pitch < 0.01;
  const ca = spectrum(a, SR, 0, 4096).centroid, cb = spectrum(c, SR, 0, 4096).centroid, c0 = spectrum(mm(id).data, SR, 0, 4096).centroid;
  const spread = Math.max(Math.abs(ca - c0), Math.abs(cb - c0)) / c0;
  check(`${id}: takes stay ${steady ? 'within 2%' : 'within 20%'} of the patch`, spread < (steady ? 0.02 : 0.2), `${(spread * 100).toFixed(1)}%`);
}

// ── the retro stage ──────────────────────────────────────────────────────────────
{
  const d = byId.get('hk-signal'), x = mm('hk-signal').data;
  const r = d.config.retro, held = x.slice(2000, 8000);
  let repeats = 0; const levels = new Set();
  for (let i = 1; i < held.length; i++) { if (held[i] === held[i - 1]) repeats++; levels.add(held[i].toFixed(7)); }
  const want = 1 - r.rate / SR;
  check(`retro: samples are held at ${r.rate} Hz`, Math.abs(repeats / held.length - want) < 0.05, `${(repeats / held.length).toFixed(3)} vs ${want.toFixed(3)}`);
  check(`retro: rounded to ${r.bits} bits`, levels.size <= Math.pow(2, r.bits) + 1, `${levels.size} levels`);
}

// ── a goal at its busiest ────────────────────────────────────────────────────────
// The horn, the whistle, a check into the boards, the crowd's celebration and a scramble of
// contacts within half a second, summed as the buses and master would (sfx 0.9, ambient 0.3,
// master 0.4: the defaults), with the rink's 0.6 on contacts under a horn.
{
  const N = Math.ceil(SR * 2.6), mix = new Float32Array(N), horn = new Float32Array(N), contacts = new Float32Array(N);
  const add = (into, x, at, g) => { const o = Math.floor(at * SR); for (let i = 0; i < x.length && o + i < N; i++) into[o + i] += x[i] * g; };
  add(horn, mm('hk-goal-horn').data, 0, 0.9);
  const cs = ['hk-puck-stick-hard', 'hk-boards-hard', 'hk-stick-hit', 'hk-puck-stick', 'hk-boards', 'hk-pass', 'hk-skate-stop', 'hk-puck-body'];
  cs.forEach((id, k) => add(contacts, mm(id).data, 0.05 + k * 0.05, 0.9 * 0.6));
  for (let i = 0; i < N; i++) mix[i] = horn[i] + contacts[i];
  add(mix, mm('hk-whistle-short').data, 0.02, 0.9);
  add(mix, mm('hk-check-boards').data, 0.1, 0.9);
  add(mix, mm('hk-crowd-goal').data, 0.2, 0.3);
  let pk = 0; for (const v of mix) pk = Math.max(pk, Math.abs(v) * 0.4);
  check('a goal at its busiest stays under full scale at the master', pk < 1, pk.toFixed(3));
  const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
  const w0 = Math.floor(0.05 * SR), w1 = Math.floor(0.5 * SR);
  check('the horn stays on top of the contacts under it', rms(horn, w0, w1) > rms(contacts, w0, w1) * 2, `${rms(horn, w0, w1).toFixed(3)} vs ${rms(contacts, w0, w1).toFixed(3)}`);
}

// ── the voice pool ───────────────────────────────────────────────────────────────
{
  AE.init();
  const before = AE._voiceStats().live;
  H.play('hk-goal-horn', { seed: 1 }); H.play('hk-whistle', { seed: 2 });
  for (let k = 0; k < 60; k++) H.play(['hk-puck-stick', 'hk-boards', 'hk-pass', 'hk-skate-scrape'][k % 4], { seed: k });
  const st = AE._voiceStats();
  check('a flood of contacts never steals the horn or the whistle', st.priorities.includes(10) && st.priorities.includes(9), JSON.stringify(st.priorities.filter((p) => p >= 9)));
  check('the pool never holds more than its size', st.live <= st.size, `${st.live}/${st.size}`);
  await new Promise((r) => setTimeout(r, 2700));
  check('every voice is free once its sound has ended', AE._voiceStats().live === before, `${AE._voiceStats().live} still held`);
}

// ── the crowd bed ────────────────────────────────────────────────────────────────
{
  const cr = await renderCrowd(AE, H);
  check('crowd: finite', cr.finite);
  const lvl = Object.fromEntries(cr.states.map((s) => [s.name + (s.name === 'quiet' && s.at > 1 ? '2' : ''), s.rms]));
  check('crowd: each state louder than the one before (quiet, active, chance, shot, goal)', lvl.quiet < lvl.active && lvl.active < lvl.chance && lvl.chance < lvl.shot && lvl.shot < lvl.goal,
    ['quiet', 'active', 'chance', 'shot', 'goal'].map((k) => `${k} ${lvl[k].toFixed(3)}`).join(', '));
  check('crowd: a penalty is louder than quiet and under a goal', lvl.penalty > lvl.quiet && lvl.penalty < lvl.goal, `${lvl.penalty.toFixed(3)}`);
  // UNDER THE PLAY, NOT OVER IT. The first bed sat at -32 dBFS through a game, louder than all
  // the effects together, and buried the clicks under a hiss that seemed to grow. At the
  // master, at the game's default volumes (crowd 0.3, effects 0.9, master 0.4), the run of
  // play is no louder than -40 dBFS, and a puck on a stick stands 18 dB clear of it.
  const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));
  const playDb = db(lvl.active * 0.3 * 0.4), stickDb = db(mm('hk-puck-stick').peak * 0.9 * 0.4);
  check('crowd: the run of play sits at -40 dBFS or under at the master', playDb <= -40, `${playDb.toFixed(1)} dBFS`);
  check('crowd: a puck on a stick stands 18 dB clear of it', stickDb - playDb >= 18, `${(stickDb - playDb).toFixed(1)} dB`);
  check('crowd: dark, under the clicks (centroid at play under 1.2 kHz)', cr.states.find((st) => st.name === 'active').centroid < 1200, `${cr.states.find((st) => st.name === 'active').centroid.toFixed(0)} Hz`);
  // no steps: 10 ms windows never jump by more than 2.2× (after the first half-second's fade-in)
  const w = SR / 100, d = cr.samples, win = [];
  for (let i = 0; i + w <= d.length; i += w) { let s = 0; for (let j = i; j < i + w; j++) s += d[j] * d[j]; win.push(Math.sqrt(s / w)); }
  let worst = 0, at = 0;
  for (let k = 51; k < win.length - 300; k++) { const r = Math.max(win[k], 1e-4) / Math.max(win[k - 1], 1e-4); const q = Math.max(r, 1 / r); if (q > worst) { worst = q; at = k / 100; } }
  check('crowd: steered without a step (10 ms windows within 2.2× of the one before)', worst < 2.2, `${worst.toFixed(2)}× at ${at.toFixed(2)} s`);
  check('crowd: steering it adds no nodes', cr.nodes === cr.nodesAfter, `${cr.nodes} → ${cr.nodesAfter}`);
  check('crowd: silent after stop()', cr.tail < 1e-3, cr.tail.toExponential(2));
}

// ── the rink's events ────────────────────────────────────────────────────────────
{
  const ids = new Set(H.ids());
  const bad = [];
  const probes = [{}, { puck: true, speed: 10 }, { puck: true, speed: 40 }, { puck: true, speed: 80 }, { soft: true }, { type: 'slap' }, { type: 'tip' },
    { long: true }, { short: true }, { style: 'glass' }, { style: 'behind' }, { big: true }];
  for (const k of Object.keys(H.EVENTS)) for (const o of probes) { const e = H.eventFor(k, o); if (e && !ids.has(e.id)) bad.push(`${k} → ${e.id}`); }
  check('every event in the table plays a patch that exists', bad.length === 0, bad.join(', '));
  // every key the rink fires, read off its sources
  const dir = join(ROOT, 'client/game/js/panels/rink');
  const src = [...readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dir, f), 'utf8')), readFileSync(join(ROOT, 'client/game/js/panels/gameday-rink.js'), 'utf8')].join('\n');
  const fired = new Set([...src.matchAll(/(?:W\.sfx|_sfx)\(\s*'([a-zA-Z]+)'/g)].map((m) => m[1]));
  for (const m of src.matchAll(/W\.sfx\([^'()]*\?\s*'([a-zA-Z]+)'\s*:\s*'([a-zA-Z]+)'/g)) { fired.add(m[1]); fired.add(m[2]); }
  const missing = [...fired].filter((k) => !(k in H.EVENTS));
  check(`every event the rink fires has a sound (${fired.size} events)`, missing.length === 0, missing.join(', '));
}

console.log(`hockey smoke: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
