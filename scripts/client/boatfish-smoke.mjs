// THE BOAT REEL, HEADLESS: client/game/js/panels/boatfish.js driven through its whole loop with
// fake `boatfish` messages, fake keys, a fake clock and a fake send.
//
// It checks the reel against the contract in docs/proposals/boat-fishing.md §5b and the numbers in
// client/shared/boatfish-rules.js: open goes to ready; a cast sends the right verb; twitches send
// fishtwitch and respect TWITCH_MIN_MS; `reeled` comes back to ready; a bite's knocks fall at
// beatTimes and a hit on time sends fishstrike stamped in server time; leaning against the fish
// drains it and leaning with it builds tension; a snap resolves 0 and a landing resolves 1, never
// sooner than minFightMs; boatFishKey takes only its own keys. Then it renders the reel's SIREN
// cues offline and checks each one makes a finite sound under 0 dBFS.
//
// No browser, no DB, no network, no files written. net.js pulls in the socket and the rest of the
// client, so a resolve hook swaps it for a stub that records what's sent.
//
//   node scripts/client/boatfish-smoke.mjs

import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? `: ${detail}` : ''}`); }
};

// ── net.js stub ──────────────────────────────────────────────────────────────────────────────────
const NET = new URL('../../client/game/js/net.js', import.meta.url).href;
const sent = [];
globalThis.__boatfishSmokeSend = (cmd) => sent.push(cmd);
registerHooks({
  resolve(specifier, context, next) {
    const r = next(specifier, context);
    if (r.url === NET) return { url: 'data:text/javascript,export const sendCmdSilent = (c) => globalThis.__boatfishSmokeSend(c);', shortCircuit: true };
    return r;
  },
});

// ── DOM stub ─────────────────────────────────────────────────────────────────────────────────────
// The reel writes its markup with innerHTML and finds its parts with querySelector. Each selector
// answers the same element every time, so what the reel wrote to a part can be read back.
function makeEl(tag = 'div') {
  const kids = new Map(), lists = new Map(), cls = new Set();
  const el = {
    tagName: tag.toUpperCase(), id: '', className: '', textContent: '', innerHTML: '', style: {}, dataset: {},
    children: [], parentNode: null,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
      toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; } },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() { if (this.parentNode) { const p = this.parentNode; p.children = p.children.filter((x) => x !== this); this.parentNode = null; } },
    querySelector(sel) { if (!kids.has(sel)) kids.set(sel, makeEl()); return kids.get(sel); },
    querySelectorAll(sel) {
      if (!lists.has(sel)) lists.set(sel, sel === '.bf-ring' ? [makeEl('span'), makeEl('span'), makeEl('span'), makeEl('span')] : []);
      return lists.get(sel);
    },
  };
  return el;
}
const body = makeEl('body'), head = makeEl('head');
globalThis.document = { body, head, getElementById: () => null, createElement: (t) => makeEl(t), addEventListener() {}, removeEventListener() {}, hidden: false };
const played = [];
globalThis.window = {
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  SFXCatalog: { get: (id) => ({ id }) },
  AudioEngine: { playSfx: (def) => played.push(def.id), init() {} },
};

// ── the clock and the frame pump ─────────────────────────────────────────────────────────────────
let T = 1_000_000;
let pendingFrame = null;
const R = await import('../../client/shared/boatfish-rules.js');
const BF = await import('../../client/game/js/panels/boatfish.js');
BF.boatFishTestHooks({ now: () => T, raf: (fn) => { pendingFrame = fn; return 1; }, caf: () => { pendingFrame = null; } });
const advance = (ms, step = 16) => {
  for (let left = ms; left > 0; left -= step) {
    T += Math.min(step, left);
    const f = pendingFrame; pendingFrame = null;
    if (f) f(T);
  }
};
const key = (code, down, extra = {}) => BF.boatFishKey({ code, key: code === 'Space' ? ' ' : code, repeat: false, preventDefault() {}, ...extra }, down);
const tap = () => { const a = key('Space', true); key('Space', false); return a; };
const last = () => sent[sent.length - 1];
const st = () => BF.boatFishState();

const SKEW = 7_300;
const TOK = 'tk9';
const msg = (phase, m = {}) => BF.onBoatFishMessage({ type: 'boatfish', phase, token: TOK, ...m });

// ── closed ───────────────────────────────────────────────────────────────────────────────────────
check('shut: not active, no state', !BF.boatFishActive() && st() === null);
check('shut: takes no keys', key('Space', true) === false && key('KeyD', true) === false);
check('shut: a cast does nothing', BF.boatFishCast(10, 20) === false && sent.length === 0);

// ── open, on the seat's host ─────────────────────────────────────────────────────────────────────
const host = makeEl('div');
BF.attachBoatFishHost(host);
msg('open', { ax: 900, ay: 901, serverNow: T + SKEW, env: { hour: 6, doy: 120, weather: 'fog', rough: 0.1 }, castM: 25, skill: 4, holdKg: 3.5, holdCap: 40, thinned: {} });
check('open: active and ready', BF.boatFishActive() && st()?.phase === 'ready', st()?.phase);
check('open: the HUD mounts in the seat\'s host', host.children.length === 1 && /bf-hosted/.test(host.children[0].className));
check('open: castM, skill and the anchor in the state', st().castM === 25 && st().skill === 4 && st().ax === 900 && st().ay === 901);
check('open: serverNow is our clock plus the skew', BF.serverNow() === T + SKEW, `${BF.serverNow() - T}`);
check('open: the state has every field the seat reads',
  ['phase', 'bearing', 'lineM', 'lx', 'ly', 'depthM', 'lean', 'pull', 'tension', 'stamina', 'beat', 'follow', 'catch'].every((k) => k in st()));
check('ready on the seat: Space is the seat\'s aim, not ours', key('Space', true) === false && key('Space', false) === false);
check('ready on the seat: A and D are the seat\'s', key('KeyA', true) === false && key('ArrowRight', true) === false);

// ── casting ──────────────────────────────────────────────────────────────────────────────────────
check('a cast under CAST_MIN_M is refused', BF.boatFishCast(10, R.CAST_MIN_M - 1) === false && sent.length === 0, last());
check('a cast sends fishcast boat <bearing> <range> <token>', BF.boatFishCast(40, 22) === true && last() === `fishcast boat 40 22 ${TOK}`, last());
check('…and goes to flight', st().phase === 'flight' && st().bearing === 40);
check('a cast past the rod\'s reach is clamped to castM', (() => {
  msg('close'); BF.attachBoatFishHost(host);
  msg('open', { ax: 900, ay: 901, serverNow: T + SKEW, castM: 25, skill: 4 });
  BF.boatFishCast(-30, 99); return last() === `fishcast boat -30 25 ${TOK}`;
})(), last());
check('flight: Space is ours now', key('Space', true) === true && key('Space', false) === true);

// ── the lure and the twitch ──────────────────────────────────────────────────────────────────────
msg('lure', { lx: 903.2, ly: 898.6, lineM: 25, depthM: 0 });
check('lure: wait, with the line and position', st().phase === 'wait' && st().lineM === 25 && st().lx === 903.2 && st().ly === 898.6);
advance(2000);
check('lure: it sinks at SINK_MPS', Math.abs(st().depthM - R.SINK_MPS * 2) < 0.05, `${st().depthM}`);
const n0 = sent.length;
check('a tap twitches: fishtwitch <token>', tap() === true && last() === `fishtwitch ${TOK}` && sent.length === n0 + 1, last());
check('…drawing the line in TWITCH_M', Math.abs(st().lineM - (25 - R.TWITCH_M)) < 1e-9, `${st().lineM}`);
check('…and lifting it TWITCH_LIFT_M', Math.abs(st().depthM - (R.SINK_MPS * 2 - R.TWITCH_LIFT_M)) < 0.05, `${st().depthM}`);
advance(R.TWITCH_MIN_MS - 40);
tap();
check('a second tap inside TWITCH_MIN_MS is the same tap', sent.length === n0 + 1, `${sent.length - n0} sent`);
advance(60);
tap();
check('…and one after it is a new one', sent.length === n0 + 2 && last() === `fishtwitch ${TOK}`, `${sent.length - n0} sent`);
check('a held Space repeats nothing', (key('Space', true, { repeat: true }), sent.length === n0 + 2));
msg('twitch', { lx: 902.9, ly: 898.8, lineM: 23, depthM: 0.6, follow: [{ school: '225_224_0', i: 3 }, { school: '225_224_0', i: 5 }] });
check('the server\'s twitch sets the line and who follows', st().lineM === 23 && st().follow.length === 2 && st().follow[0].i === 3);
check('wait: the seat keeps A and D', key('KeyA', true) === false && key('KeyD', true) === false);
msg('twitch', { token: 'stale', lineM: 2 });
check('a message for another cast is ignored', st().lineM === 23);

// ── reeled ───────────────────────────────────────────────────────────────────────────────────────
msg('reeled');
check('reeled: the line winds in by itself', st().phase === 'reeling');
advance(4000);
check('…and comes back to ready', st().phase === 'ready' && st().lineM === 0 && st().follow.length === 0, st().phase);

// ── the bite ─────────────────────────────────────────────────────────────────────────────────────
BF.boatFishCast(0, 18); msg('lure', { lx: 900, ly: 898, lineM: 18, depthM: 0 });
const N = 3, times = R.beatTimes(N);
const biteAt = BF.serverNow() + 40;
msg('bite', { school: '225_224_0', i: 3, species: 'irontooth_bass', beats: N, biteAt });
check('bite: the beat the seat reads is beatTimes(n)[0] after biteAt',
  st().phase === 'bite' && st().beat?.i === 0 && st().beat?.n === N && st().beat?.nextAtServerMs === biteAt + times[0], JSON.stringify(st().beat));
const rings = host.children[0].querySelectorAll('.bf-ring');
const knocks = () => played.filter((p) => p === 'boatfish-knock').length;
const k0 = knocks();
// Up to just before the first knock: no knock yet, and the ring is still closing.
advance(biteAt + times[0] - BF.serverNow() - 30, 10);
check('no knock before its beat', knocks() === k0, `${knocks() - k0}`);
const scaleOf = (el) => Number(/scale\(([\d.]+)\)/.exec(el.style.transform || '')?.[1]);
check('…and its ring is still closing on the mark', scaleOf(rings[0]) > 1.02, rings[0].style.transform);
check('an early tap nowhere near a knock counts for nothing', (() => {
  const before = sent.length; T -= 1000; tap(); T += 1000; return sent.length === before;
})());
advance(40, 10);
check('the knock sounds on its beat', knocks() === k0 + 1, `${knocks() - k0}`);
check('…and its ring meets the mark', Math.abs(scaleOf(rings[0]) - 1) < 0.02, rings[0].style.transform);
check('…and the later beats\' rings are further out', scaleOf(rings[1]) > scaleOf(rings[0]) || Number(rings[1].style.opacity) === 0);
const hit0 = BF.serverNow();
tap();
check('a hit on time sends fishstrike 0 <serverMs> <token>', last() === `fishstrike 0 ${Math.round(hit0)} ${TOK}`, last());
check('…stamped in server time, on the beat', R.onBeat(hit0 - biteAt, 0, N), `${hit0 - biteAt} vs ${times[0]}`);
check('…and the next beat is up', st().beat.i === 1 && st().beat.nextAtServerMs === biteAt + times[1]);
for (const b of [1, 2]) {
  advance(biteAt + times[b] - BF.serverNow() + 15, 10);
  const h = BF.serverNow(); tap();
  check(`beat ${b} hit on time sends fishstrike ${b}`, last() === `fishstrike ${b} ${Math.round(h)} ${TOK}` && R.onBeat(h - biteAt, b, N), last());
}
check('every knock sounded once', knocks() === k0 + N, `${knocks() - k0}`);

// ── the fight ────────────────────────────────────────────────────────────────────────────────────
const fight1 = { species: 'irontooth_bass', name: 'irontooth bass', kg: 2.6, difficulty: 6, fight: 'jumper', lineM: 15, skill: 4 };
msg('fight', fight1);
check('fight: on the line, at the board\'s figures', st().phase === 'fight' && st().stamina === 1 && st().tension === R.fightBoard(fight1).tension && st().lineM === 15);
check('fight: the catch is in the state', st().catch?.species === 'irontooth_bass' && st().catch?.kg === 2.6);
// Lean against the pull (correct) or with it (wrong), checking the side every frame since it switches.
let heldCode = null;
const lean = (correct, ms) => {
  for (let left = ms; left > 0 && st()?.phase === 'fight'; left -= 16) {
    const side = Math.sign(st().pull) || 1;
    const want = (correct ? -side : side) < 0 ? 'KeyA' : 'KeyD';
    if (heldCode !== want) { if (heldCode) key(heldCode, false); key(want, true); heldCode = want; }
    advance(16);
  }
  if (heldCode) { key(heldCode, false); heldCode = null; }
};
advance(200);   // the pull builds from nothing
check('fight: the fish pulls to one side', Math.abs(st().pull) > 0.1, `${st().pull}`);
const s0 = st().stamina, t0 = st().tension;
lean(true, 1200);
check('leaning against it drains its stamina', st().stamina < s0 - 0.03, `${s0} -> ${st().stamina}`);
check('…and eases the tension', st().tension < t0, `${t0} -> ${st().tension}`);
check('fight: A, D and the arrows are ours', key('ArrowLeft', true) === true && key('ArrowLeft', false) === true && key('KeyD', true) === true && key('KeyD', false) === true);
check('fight: other keys are not', key('KeyW', true) === false && key('KeyR', true) === false && key('Escape', true) === false && key('KeyA', true, { ctrlKey: true }) === false);
const t1 = st().tension, l1 = st().lineM;
lean(false, 800);
check('leaning with it builds tension', st().phase !== 'fight' || st().tension > t1 + 0.05, `${t1} -> ${st().tension}`);
check('…and loses line', st().phase !== 'fight' || st().lineM > l1, `${l1} -> ${st().lineM}`);
const before = sent.length;
lean(false, 20000);
check('tension at 1 snaps the line: fishresolve boat 0', sent.slice(before).includes(`fishresolve boat 0 ${TOK}`), sent.slice(before).join(' | '));
check('…once', sent.slice(before).filter((c) => c.startsWith('fishresolve')).length === 1);
msg('lost', { snapped: false });
check('lost: back to ready, with a card', st().phase === 'ready' && host.children[0].dataset.card === '1');
check('…in plain words', host.children[0].querySelector('[data-r="ctitle"]').textContent === 'The line broke and it got away.',
  host.children[0].querySelector('[data-r="ctitle"]').textContent);

// ── a landing ────────────────────────────────────────────────────────────────────────────────────
BF.boatFishCast(-15, 12); msg('lure', { lx: 899, ly: 899, lineM: 12, depthM: 0 });
const bite2 = BF.serverNow();
msg('bite', { species: 'lamp_herring', beats: 1, biteAt: bite2 });
advance(bite2 + R.beatTimes(1)[0] - BF.serverNow(), 10);
tap();
const fight2 = { species: 'lamp_herring', name: 'lamp herring', kg: 0.28, difficulty: 2, fight: 'steady', lineM: 10, skill: 9 };
msg('fight', fight2);
const fightAt = T;
const b4 = sent.length;
lean(true, 60000);
let guard = 0;
while (st()?.phase === 'reeling' && !sent.slice(b4).some((c) => c.startsWith('fishresolve')) && guard++ < 1000) advance(16);
const res = sent.slice(b4).filter((c) => c.startsWith('fishresolve'));
check('tired and inside LAND_M, it winds in and resolves 1', res.length === 1 && res[0] === `fishresolve boat 1 ${TOK}`, res.join(' | ') || st()?.phase);
check('…never sooner than minFightMs', T - fightAt >= R.minFightMs(fight2), `${T - fightAt} < ${R.minFightMs(fight2)}`);
check('…with the line in', st().lineM < 0.01, `${st().lineM}`);
msg('landed', { species: 'lamp_herring', name: 'lamp herring', kg: 0.28, holdKg: 3.78, holdCap: 40 });
const ct = host.children[0].querySelector('[data-r="ctitle"]').textContent, cb = host.children[0].querySelector('[data-r="cbody"]').textContent;
check('landed: the card names it and weighs it to two places', st().phase === 'landed' && ct === 'Lamp herring, 0.28 kg.', ct);
check('…and says how full the box is', cb === 'In the box. It\'s carrying 3.78 of 40 kg.', cb);
check('…with no em dash', !(ct + cb).includes(String.fromCharCode(0x2014)));
check('landed: the catch splashes into the box', played.includes('boatfish-splash'));
key('Space', true); key('Space', false);
check('Space after the card is ready again', st().phase === 'ready' && st().catch === null, st().phase);

// ── a missed knock ───────────────────────────────────────────────────────────────────────────────
BF.boatFishCast(5, 15); msg('lure', { lineM: 15, depthM: 0 });
const bite3 = BF.serverNow();
msg('bite', { species: 'carp', beats: 2, biteAt: bite3 });
const s3 = sent.length;
advance(R.beatTimes(2)[0] + R.BEAT_WINDOW_MS + R.LATENCY_SLACK_MS + 100, 10);
check('a knock let go by sends nothing', sent.length === s3);
check('…and the beat is past', st().beat.nextAtServerMs === null);
msg('spat', { reason: 'missed' });
check('spat: back to ready', st().phase === 'ready');

// ── the overlay, when the seat goes ──────────────────────────────────────────────────────────────
BF.detachBoatFishHost();
check('detached while open: the HUD leaves the seat', host.children.length === 0);
check('…for an overlay of its own', body.children.some((c) => c.id === 'boatfish-overlay'));
check('overlay ready: Space charges our own cast', key('Space', true) === true);
advance(700);
check('…and letting go casts', key('Space', false) === true && /^fishcast boat 0 [\d.]+ tk9$/.test(last()), last());
msg('close');
check('close: shut, and the overlay is gone', !BF.boatFishActive() && !body.children.some((c) => c.id === 'boatfish-overlay'));
check('close: no keys taken', key('Space', true) === false);
check('nothing sent a stand on a server close', !sent.includes('stand'));

// ── the cues ─────────────────────────────────────────────────────────────────────────────────────
// Each one is in the catalog, and renders as a finite sound under 0 dBFS that isn't silent.
const CUES = ['boatfish-cast', 'boatfish-plop', 'boatfish-plip', 'boatfish-knock', 'boatfish-click', 'boatfish-zing', 'boatfish-snap', 'boatfish-splash'];
{
  const g = {};
  new Function('globalThis', 'window', readFileSync(join(ROOT, 'client/shared/sfx-catalog.js'), 'utf8'))(g, g);
  const { installAudioGlobals } = await import('../audio/offline-audio.mjs');
  const ag = { requestAnimationFrame: () => 0 };
  installAudioGlobals(ag);
  for (const k of ['OfflineAudioContext', 'AudioContext', 'AudioWorkletNode']) globalThis[k] = ag[k];
  const w = { OfflineAudioContext: ag.OfflineAudioContext, AudioContext: ag.AudioContext, AudioWorkletNode: ag.AudioWorkletNode };
  new Function('window', 'globalThis', readFileSync(join(ROOT, 'client/shared/audio-engine.js'), 'utf8'))(w, w);
  const AE = w.AudioEngine || globalThis.AudioEngine;
  AE?._setRetroUrl?.(join(ROOT, 'client/shared/audio-retro-worklet.js'));
  for (const id of CUES) {
    const def = g.SFXCatalog.get(id);
    check(`cue ${id} is in the catalog, under fishing`, !!def && def.group === 'fishing' && def.category === 'sfx');
    if (!def || !AE?.renderSfx) continue;
    const buf = await AE.renderSfx(def, { sampleRate: 24000 });
    const d = buf.getChannelData(0);
    let peak = 0, finite = true;
    for (const x of d) { if (!Number.isFinite(x)) finite = false; else if (Math.abs(x) > peak) peak = Math.abs(x); }
    check(`cue ${id} renders finite, audible and under 0 dBFS`, finite && peak > 0.005 && peak < 1, `peak ${peak.toFixed(3)}`);
  }
  check('the audio engine rendered offline', !!AE?.renderSfx);
}

if (failed) { console.error(`boatfish smoke: ${failed} failed, ${passed} passed`); process.exit(1); }
console.log(`boatfish smoke: ${passed}/${passed} passed`);
