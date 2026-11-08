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
      if (!lists.has(sel)) lists.set(sel, []);
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
  ['phase', 'bearing', 'lineM', 'lx', 'ly', 'depthM', 'lean', 'pull', 'tension', 'stamina', 'pose', 'mode', 'wind', 'net', 'fish', 'follow', 'catch'].every((k) => k in st()));
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

// ── the take ─────────────────────────────────────────────────────────────────────────────────────
// A fixed script, so the test says exactly when the float moves.
const SCRIPT = { kind: 'slide', nibbles: [{ at: 900, size: 0.5 }, { at: 1700, size: 0.4 }], takeAt: 2600, windowMs: 900, sweetAt: 2900 };
const bite = (script = SCRIPT, species = 'carp') => {
  BF.boatFishCast(0, 18); msg('lure', { lx: 900, ly: 898, lineM: 18, depthM: 0 });
  const at = BF.serverNow();
  msg('bite', { school: '225_224_0', i: 3, species, script, biteAt: at });
  return at;
};
const nibbles = () => played.filter((p) => p === 'boatfish-nibble').length;
const n1 = nibbles();
let biteAt = bite();
check('bite: the state carries the fish and the float\'s pose', st().phase === 'bite' && st().fish?.school === '225_224_0' && st().fish?.i === 3 && st().pose?.dip === 0, JSON.stringify(st().pose));
const sAtBite = sent.length;
tap();
check('a tap as the bite arrives is the last twitch, not a strike', sent.length === sAtBite, last());
advance(SCRIPT.nibbles[0].at + R.NIBBLE_MS / 2);
check('a nibble moves the float and makes a sound', st().pose.dip > 0.3 && nibbles() === n1 + 1, `${st().pose?.dip} ${nibbles() - n1}`);
check('…but it hasn\'t gone', st().pose.under === false);
advance(SCRIPT.takeAt - (BF.serverNow() - biteAt) + 500);
check('the take: the float goes under', st().pose.under === true && st().pose.dip > 0.9, JSON.stringify(st().pose));
check('every nibble sounded once, and the take with it', nibbles() === n1 + 2 && played.includes('boatfish-take'));
const hit0 = BF.serverNow();
tap();
check('a strike sends fishstrike <serverMs> <token>', last() === `fishstrike ${Math.round(hit0)} ${TOK}`, last());
check('…stamped in server time, inside the window', R.judgeStrike(hit0 - biteAt, SCRIPT).ok, `${hit0 - biteAt}`);
const s1 = sent.length;
tap();
check('one strike: a second press sends nothing', sent.length === s1, last());

// The rules that judge it, here because the client draws them.
check('judge: on a nibble is early', R.judgeStrike(SCRIPT.nibbles[0].at + 50, SCRIPT).why === 'early');
check('judge: past the window is late', R.judgeStrike(SCRIPT.takeAt + SCRIPT.windowMs + 1, SCRIPT).why === 'late');
check('judge: the sweet spot is the best set', R.judgeStrike(SCRIPT.sweetAt, SCRIPT).set === 1, JSON.stringify(R.judgeStrike(SCRIPT.sweetAt, SCRIPT)));
check('judge: the edge of the window is a poorer set', R.judgeStrike(SCRIPT.takeAt + SCRIPT.windowMs, SCRIPT).set < 0.5);
{
  const a = R.takeScript(4242, 'carp', 2), b = R.takeScript(4242, 'carp', 2);
  check('takeScript is a pure function of its seed', JSON.stringify(a) === JSON.stringify(b));
  const kinds = new Set(Object.keys(R.TAKES).map((f) => R.TAKES[f].kind));
  check('there are four ways to take a lure', kinds.size === 4, [...kinds].join());
  check('a bigger fish gives you less time', R.takeScript(1, 'coldwater_sturgeon', 25).windowMs < R.takeScript(1, 'coldwater_sturgeon', 8).windowMs);
  check('a sturgeon lifts the float', (() => { const S = R.takeScript(9, 'coldwater_sturgeon', 12), p = R.floatPose(S, S.takeAt + 400); return p.lift > 0.5 && p.tilt > 1; })());
}

// ── the fight ────────────────────────────────────────────────────────────────────────────────────
const fight1 = { species: 'irontooth_bass', name: 'irontooth bass', kg: 2.6, difficulty: 6, fight: 'jumper', lineM: 15, skill: 4, set: 0.8 };
msg('fight', fight1);
check('fight: on the line, at the board\'s figures', st().phase === 'fight' && st().stamina === 1 && st().tension === R.fightBoard(fight1).tension && st().lineM === 15);
check('fight: the catch is in the state', st().catch?.species === 'irontooth_bass' && st().catch?.kg === 2.6 && st().set === 0.8);
// Lean against the pull (correct) or with it (wrong), checking the side every frame since it switches.
let heldCode = null;
const lean = (correct, ms, wind = true) => {
  if (wind) key('Space', true);
  for (let left = ms; left > 0 && st()?.phase === 'fight'; left -= 16) {
    const side = Math.sign(st().pull) || 1;
    const want = (correct ? -side : side) < 0 ? 'KeyA' : 'KeyD';
    if (heldCode !== want) { if (heldCode) key(heldCode, false); key(want, true); heldCode = want; }
    // A careful angler lets it run.
    if (correct && wind) key('Space', st().mode !== 'run' && st().mode !== 'jump' && st().tension < 0.85);
    advance(16);
  }
  if (heldCode) { key(heldCode, false); heldCode = null; }
  if (st()?.phase === 'fight') key('Space', false);
};
advance(200);   // the pull builds from nothing
check('fight: the fish pulls to one side', Math.abs(st().pull) > 0.1, `${st().pull}`);
const s0 = st().stamina;
lean(true, 1500);
check('leaning against it drains its stamina', st().stamina < s0 - 0.02, `${s0} -> ${st().stamina}`);
check('fight: holding Space winds the reel', (key('Space', true), st().wind === true) && (key('Space', false), st().wind === false));
check('fight: A, D and the arrows are ours', key('ArrowLeft', true) === true && key('ArrowLeft', false) === true && key('KeyD', true) === true && key('KeyD', false) === true);
check('fight: other keys are not', key('KeyW', true) === false && key('KeyR', true) === false && key('Escape', true) === false && key('KeyA', true, { ctrlKey: true }) === false);
const before = sent.length;
lean(false, 20000);
check('leaning with it and winding snaps the line: fishresolve boat 0', sent.slice(before).includes(`fishresolve boat 0 ${TOK}`), sent.slice(before).join(' | '));
check('…once', sent.slice(before).filter((c) => c.startsWith('fishresolve')).length === 1);
msg('lost', { snapped: false });
check('lost: back to ready, with a card', st().phase === 'ready' && host.children[0].dataset.card === '1');
check('…in plain words', host.children[0].querySelector('[data-r="ctitle"]').textContent === 'The line broke and it got away.',
  host.children[0].querySelector('[data-r="ctitle"]').textContent);

// The rules' four moods, straight, with no HUD in the way.
{
  const b = R.fightBoard({ kg: 3, difficulty: 6, fight: 'runner', skill: 4, lineM: 20, set: 0.3 });
  const F = R.fightState(b, () => 0.5);
  F.runLeft = 2000; F.runAge = 700;
  let end = null;
  for (let i = 0; i < 300 && !end; i++) { F.runLeft = 2000; F.side = 1; end = R.stepFight(F, b, { lean: -1, wind: true }, 1 / 60, () => 0.5); }
  check('winding through a run snaps the line', end === 'snap', String(end));
  const G = R.fightState(b, () => 0.5);
  end = null;
  for (let i = 0; i < 600 && !end; i++) { G.chargeLeft = 2000; G.runIn = 1e9; G.jumpIn = 1e9; end = R.stepFight(G, b, { lean: 0, wind: false }, 1 / 60, () => 0.5); }
  check('not winding when it swims at you lets the hook drop out', end === 'thrown', String(end));
  const Hs = R.fightBoard({ kg: 3, difficulty: 6, fight: 'runner', skill: 4, lineM: 20, set: 1 });
  check('a solid hook holds on slack line longer than a lip hook', Hs.slackHoldMs > b.slackHoldMs + 300);
  const H = R.fightState(b, () => 0.5);
  H.stamina = 0; H.lineM = R.LAND_M + 1;
  end = null;
  for (let i = 0; i < 600 && !end; i++) end = R.stepFight(H, b, { lean: 0, wind: true }, 1 / 60, () => 0.5);
  check('a spent fish wound inside LAND_M is ready for the net', end === 'tired', String(end));
}

// ── a landing ────────────────────────────────────────────────────────────────────────────────────
const smallBite = () => {
  const S = { kind: 'slam', nibbles: [], takeAt: 900, windowMs: 600, sweetAt: 1050 };
  bite(S, 'lamp_herring');
  advance(1000, 10);
  tap();
};
smallBite();
const fight2 = { species: 'lamp_herring', name: 'lamp herring', kg: 0.28, difficulty: 2, fight: 'steady', lineM: 10, skill: 9, set: 0.9 };
msg('fight', fight2);
const fightAt = T;
lean(true, 60000);
check('tired and inside LAND_M, it comes alongside for the net', st().phase === 'net', st()?.phase);
const b4 = sent.length;
const netPlayed = () => played.filter((p) => p === 'boatfish-net').length;
// Press Space when the fish is well outside the net's window: it kicks off the rim.
const swingTo = (test) => { for (let i = 0; i < 4000 && st()?.phase === 'net'; i++) { advance(16); if (test(Math.abs(st().net))) return true; } return false; };
advance(1200);
check('a miss at the net sends it off for another short run', swingTo((p) => p > 0.8) && (tap(), st().phase === 'fight' && st().lineM > R.LAND_M), st()?.phase);
lean(true, 60000);
check('…and it comes back', st().phase === 'net', st()?.phase);
const nets0 = netPlayed();
advance(1200);
check('timed right, the net takes it: fishresolve boat 1', swingTo((p) => p < 0.05) && (tap(), sent.slice(b4).includes(`fishresolve boat 1 ${TOK}`)), sent.slice(b4).join(' | ') || st()?.phase);
check('…with a sound', netPlayed() === nets0 + 1);
check('…never sooner than minFightMs', T - fightAt >= R.minFightMs(fight2), `${T - fightAt} < ${R.minFightMs(fight2)}`);
advance(800);
msg('landed', { species: 'lamp_herring', name: 'lamp herring', kg: 0.28, holdKg: 3.78, holdCap: 40 });
const ct = host.children[0].querySelector('[data-r="ctitle"]').textContent, cb = host.children[0].querySelector('[data-r="cbody"]').textContent;
check('landed: the card names it and weighs it to two places', st().phase === 'landed' && ct === 'Lamp herring, 0.28 kg.', ct);
check('…and says how full the box is', cb === 'In the box. It\'s carrying 3.78 of 40 kg.', cb);
check('…with no em dash', !(ct + cb).includes(String.fromCharCode(0x2014)));
check('landed: the catch splashes into the box', played.includes('boatfish-splash'));
key('Space', true); key('Space', false);
check('Space after the card is ready again', st().phase === 'ready' && st().catch === null, st().phase);

// ── a strike at the wrong moment ─────────────────────────────────────────────────────────────────
biteAt = bite();
advance(1000);
const s3 = sent.length;
tap();
check('a strike on a nibble goes to the server', sent.length === s3 + 1 && last().startsWith('fishstrike '), last());
msg('spat', { reason: 'early', lx: 900.1, ly: 898.2, lineM: 16, depthM: 1 });
check('spat: the lure\'s still out, with less line', st().phase === 'wait' && st().lineM === 16, st().phase);
check('…and the card says what happened', host.children[0].querySelector('[data-r="ctitle"]').textContent === 'Too soon.');
msg('reeled');
advance(4000);

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
const CUES = ['boatfish-cast', 'boatfish-plop', 'boatfish-plip', 'boatfish-nibble', 'boatfish-take', 'boatfish-strike', 'boatfish-click', 'boatfish-drag', 'boatfish-jump', 'boatfish-zing', 'boatfish-snap', 'boatfish-net', 'boatfish-splash'];
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
