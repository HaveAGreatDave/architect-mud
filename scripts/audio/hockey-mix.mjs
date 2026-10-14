// HOCKEY MIX — a stretch of a real game as a player hears it, rendered, measured and written out.
//
//   node scripts/audio/hockey-mix.mjs [slot] [--seconds 120] [--wav <dir>]
//
// The rink plays a game (the same view, director and sim the browser runs, on the rink smoke's
// DOM stub) and every sound it asks for is recorded with its time: the effects, and every call
// it makes on the crowd bed. Then each effect is rendered through the real engine
// (hockey-lib.mjs) and the crowd bed is driven through the same calls at the same times, and
// all of it is summed the way the buses sum it at the game's default volumes (master 0.4,
// effects 0.9, crowd 0.3). Summing is exact: no cue's graph touches another's.
//
// It prints how loud the crowd and the effects are over the stretch, and for each kind of
// effect how far it stands above the crowd at the moment it plays (its peak against the
// crowd's level in the same 100 ms): the thing a player can't hear when it's too small.
// With --wav it writes the mix, and the crowd and the effects on their own.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHockey, renderCue, SR } from './hockey-lib.mjs';
import { OfflineContext } from './offline-audio.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const slot = +(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 37);
const SECONDS = +arg('--seconds', 120), out = arg('--wav', null);
const BUS = { master: 0.4, sfx: 0.9, ambient: 0.3 };

const { AE, H, wav } = loadHockey();
const { __install } = await import('../shapes/rink-dom-stub.mjs');
const stub = __install();
const { createRinkView } = await import('../../client/game/js/panels/gameday-rink.js');
const { DT } = await import('../../client/game/js/panels/rink/rig.js');
const { sportsRng, sportsHash, sportsPick, sportsFill } = await import('../../plugins/broadcast/rng.js');
const HOCKEY = (await import('../../plugins/broadcast/sports/hockey.js')).default;
const { paceCalls } = await import('../../plugins/broadcast/sports/hockey-pacing.js');

// ── the rink, with an engine that writes down what it's asked to play ─────────────
let W = null, t0 = 0;
const now = () => (W ? W.t - t0 : 0);
const cues = [], crowdCalls = [];
const win = globalThis.window;
win.AudioEngine = { playSfx: (def, gain = 1, opts = {}) => { if (def) cues.push({ t: now(), def, gain, pan: opts.pan || 0 }); return null; }, engineNodes: () => ({}) };
const bedRecorder = () => {
  const rec = (what) => (...a) => { crowdCalls.push({ t: now(), what, a }); return api; };
  const api = { start: rec('start'), setState: rec('setState'), gasp: rec('gasp'), cheer: rec('cheer'), celebrate: rec('celebrate'), duck: rec('duck'), stop: rec('stop') };
  return api;
};
win.HockeySfx = { ...H, crowdBed: bedRecorder };
win.SFXCatalog = { get: (id) => H.get(id) };

const src = readFileSync(new URL('../../data/scripts/hockey.bsm', import.meta.url), 'utf8');
const block = (k) => (src.split(`::${k}`)[1]?.split(`::end${k}`)[0] || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')).map((s) => s.replace(/"/g, ''));
const pools = {};
{ let key = null; for (const raw of src.split(/\r?\n/)) { const l = raw.trim(); if (l.startsWith('::lines ')) { key = l.slice(8).trim(); pools[key] = []; continue; } if (l.startsWith('::')) { key = null; continue; } if (key && l && !l.startsWith('#')) pools[key].push(l); } }
const teams = block('teams'), players = block('players');
const matchup = { away: teams[slot % teams.length], home: teams[(slot * 7 + 5) % teams.length], teams };
const seed = sportsHash(slot, 0);
const game = HOCKEY.simGame(matchup, players, sportsRng(seed));
const nrng = sportsRng(seed ^ 0x9e3779b9);
const lines = [];
HOCKEY.narrate({
  script: {}, game, gs: { seed, game }, slot, ws: false, announcer: 'Tug Brennan', pools, nrng, sport: HOCKEY, add: () => {},
  say: (line, tok, sb, fx, gd, meta) => { if (line) lines.push({ text: sportsFill(line, tok).trim(), graphic: fx || null, gameday: gd || null, _cue: meta && meta.cue, _opt: (meta && meta.opt) || false }); },
  pick: (...keys) => sportsPick(pools, nrng, ...keys),
  abbr: (n) => String(n).slice(0, 3).toUpperCase(), recordOf: () => '8-4-1', lastId: () => null,
});
const { holds, dropped } = paceCalls(lines, 3600 * 1000 * 0.85, 1000);
const aired = lines.filter((l) => !dropped.has(l));

const host = stub.makeHost();
const view = createRinkView(host);
await view.ready();
view.showIdle();
W = view.world;
const run = (secs) => { const a = W.t; while (W.t - a < secs) { W.step(DT); stub.runTimers(DT * 1000); } };
// from the first draw, for SECONDS of play, each line held as long as it airs
let started = false;
for (const l of aired) {
  const g = l.gameday;
  if (!started) { if (!g || g.type !== 'faceoff') continue; started = true; t0 = W.t; }
  if (now() > SECONDS) break;
  view.setCaption(l.text, { held: !!g });
  if (l.graphic) view.showCard(l.graphic);
  if (g) view.apply(g);
  run((holds.get(l) || 2400) / 1000);
}
const dur = Math.min(SECONDS, now()) + 4;
console.log(`slot ${slot}: ${dur.toFixed(0)} s, ${cues.length} effects, ${crowdCalls.length} crowd calls`);

// ── render ────────────────────────────────────────────────────────────────────────
const N = Math.ceil(dur * SR);
const fx = new Float32Array(N), crowd = new Float32Array(N);
const add = (into, x, at, g) => { const o = Math.floor(at * SR); for (let i = 0; i < x.length && o + i < N; i++) into[o + i] += x[i] * g; };
const cache = new Map();
const byKind = new Map();
for (const c of cues) {
  const key = JSON.stringify(c.def.config);
  let x = cache.get(key);
  if (!x) { x = (await renderCue(AE, c.def)).getChannelData(0); cache.set(key, x); }
  const bus = c.def.category === 'ambient' ? BUS.ambient : BUS.sfx;
  add(c.def.category === 'ambient' ? crowd : fx, x, c.t, c.gain * bus * BUS.master);
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
  const k = c.def.id;
  if (!byKind.has(k)) byKind.set(k, []);
  byKind.get(k).push({ t: c.t, peak: pk * c.gain * bus * BUS.master, ambient: c.def.category === 'ambient' });
}
// the bed, driven through the same calls at the same times; its one-shots are cues above
{
  const off = new OfflineContext(1, N, SR);
  await AE.loadRetro(off);
  const bus = off.createGain(); bus.gain.value = BUS.ambient * BUS.master; bus.connect(off.destination);
  const bed = H.crowdBed({ ctx: off, dest: bus, noise: AE.engineNodes().noise });
  for (const c of crowdCalls) {
    const at = Math.max(0, c.t);
    if (c.what === 'start') bed.start(at);
    else if (c.what === 'setState') bed.setState(c.a[0], at);
    else if (c.what === 'duck') bed.duck(c.a[0], c.a[1], at);
    else if (c.what === 'cheer') bed.cheer(at, c.a[0]);
    else bed[c.what](at);
    // the browser's bed plays its own one-shot for these
    const shot = { gasp: 'hk-crowd-gasp', cheer: c.a[0] ? 'hk-crowd-goal' : 'hk-crowd-cheer', celebrate: 'hk-crowd-goal' }[c.what];
    if (shot) { const x = (await renderCue(AE, H.variant(H.get(shot), (at * 1000) | 0))).getChannelData(0); add(crowd, x, at, BUS.ambient * BUS.master); }
  }
  const d = (await off.startRendering()).getChannelData(0);
  for (let i = 0; i < N; i++) crowd[i] += d[i];
}
const mix = new Float32Array(N);
for (let i = 0; i < N; i++) mix[i] = fx[i] + crowd[i];

// ── measure ───────────────────────────────────────────────────────────────────────
const db = (v) => (v > 0 ? 20 * Math.log10(v) : -120);
const rmsAt = (x, t, w = 0.1) => { const a = Math.max(0, Math.floor((t - w / 2) * SR)), b = Math.min(N, Math.floor((t + w / 2) * SR)); let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const rmsAll = (x) => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); };
let pk = 0; for (const v of mix) pk = Math.max(pk, Math.abs(v));
console.log(`mix peak ${db(pk).toFixed(1)} dBFS; crowd ${db(rmsAll(crowd)).toFixed(1)} dBFS RMS, effects ${db(rmsAll(fx)).toFixed(1)} dBFS RMS`);
// the crowd over time, in 10 s steps
const steps = [];
for (let t = 5; t < dur; t += 10) steps.push(`${t}s ${db(rmsAt(crowd, t, 10)).toFixed(0)}`);
console.log('crowd over time (dBFS RMS):', steps.join(' · '));
console.log('\neffect               n   peak dBFS   over the crowd (dB, median / worst)');
for (const [k, list] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
  if (list[0].ambient) continue;
  const over = list.map((e) => db(e.peak) - db(rmsAt(crowd, e.t + 0.02))).sort((a, b) => a - b);
  const med = over[Math.floor(over.length / 2)], worst = over[0];
  console.log(k.padEnd(20), String(list.length).padStart(3), db(Math.max(...list.map((e) => e.peak))).toFixed(1).padStart(10), `${med.toFixed(1).padStart(12)} / ${worst.toFixed(1)}`);
}
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `mix-${slot}.wav`), wav(mix, SR));
  writeFileSync(join(out, `mix-${slot}-crowd.wav`), wav(crowd, SR));
  writeFileSync(join(out, `mix-${slot}-effects.wav`), wav(fx, SR));
  console.log(`\nwrote mix-${slot}.wav, mix-${slot}-crowd.wav and mix-${slot}-effects.wav to ${out}`);
}
