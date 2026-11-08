// BOAT FISHING, the server half (docs/proposals/boat-fishing.md §5 and the contract in §5b).
//
// `fish` aboard an anchored boat with a rod opens the reel. It shares the shore registration in
// index.js (posture 'fishing', stateKey `fishState`), with `fishState.mode = 'boat'`, because
// registerActivity allows one registration per posture. The rules are client/shared/boatfish-rules.js
// and the fish are client/shared/fish.js; both are pure, and the seat runs the same arithmetic, so the
// take the client draws is the take judged here and the shadow it casts at is the fish that bites.
//
// The loop: cast from the anchor point, twitch the lure in, read the float and strike when the fish
// takes, fight, land into the fish box (`boat_hold`, plugins/powerboat/hold.js). One message type goes out, `boatfish`, with
// a `phase`.
//
// ⚠ THE ANCHOR POINT IS THE ORIGIN, NEVER THE REPORTED POSITION. The lure is worked out from
// `anchorOf` and the rig's heading, and the range is clamped to the rod's `cast_m`.
//
// ⚠ HALF A TILE. Wire coordinates are the boat's convention (a tile's centre on the integer);
// fish.js and seabed.js have tile i spanning [i, i+1). Every call into fish.js adds 0.5, and
// `depthUnder` (anchor.js) already does.
//
// ⚠ NOTHING ON THE TWITCH OR THE TICK AWAITS A QUERY. Gear, skill and the box's weight are read
// once when the reel opens and kept on the state; the box's total lives in RAM (hold.js). The only
// writes are on a landing, which is a command.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { emit } from '../../server/engine/events.js';
import { setPosture, forceStand } from '../../server/engine/posture.js';
import { effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { resolveForLogRung } from '../../server/engine/minigame.js';
import { prefersTextMinigamesOrDefault } from '../../server/engine/presentation.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { seaEnv, dayOfYear, taken, thinnedNow as seaThinned, takeFrom as seaTake } from './sea.js';
import {
  TWITCH_M, TWITCH_LIFT_M, TWITCH_MIN_MS, REEL_IN_M, SINK_MPS, CAST_MIN_M, NOTICE_M, BITE_AT,
  interestGain, decayInterest, LATENCY_SLACK_MS, takeScript, judgeStrike, setWords, minFightMs,
} from '../../client/shared/boatfish-rules.js';
import { SPECIES, habitatFor, fishNear, keenness, fishKg } from '../../client/shared/fish.js';
import { SEA_TILE_M } from '../../client/shared/sea-swell.js';
import { numberWords } from '../../client/shared/boat-anchor.js';
import { aboard } from '../powerboat/yard.js';
import { rigs } from '../powerboat/index.js';
import { conning } from '../powerboat/texthelm.js';
import { anchorOf, isLandTile, depthUnder } from '../powerboat/anchor.js';
import { holdCapOf, holdKgOf, loadHold, addHoldKg } from '../powerboat/hold.js';
import { TYPES } from '../../client/game/js/panels/flight-model.js';
import { maybeSnapRod, consumeBait, castGear } from './index.js';

const CAST_DEFAULT_M = 25;     // a rod without `cast_m` on its tags reaches this far
const SPOOK_MS = 20000;        // a missed strike scares the school off the lure this long
const FOLLOW_AT = 0.15;        // interest at which a fish shows as following the lure
const FLOOR_GAP_M = 0.2;       // the lure stops this far above the bottom
const STRIKE_YANK_M = 2;       // a strike at nothing pulls the lure this far back through the water
const STOW = 'You reel in and stow the rod.';

// A hull with rod holders (`rodHolders` in flight-model.js) comes with rods in them. They aren't
// items: they never go in your pack, never leave the boat and never snap. Your own rod, if you carry
// one, is used first, and it can still snap.
const BOAT_ROD = { tags: { fishing_rod: true }, boat: true };
const boatRodFor = (typeId) => (Number(TYPES[typeId]?.rodHolders) > 0 ? BOAT_ROD : null);

const D2R = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;

// ── SEAMS THE SUITE CAN SET ───────────────────────────────────────────────────
// The clock, the water and the messages. Production never sets any of them.
const seam = { now: null, habitat: null, floor: null, tap: null };
const now = () => (seam.now ? seam.now() : Date.now());
let realHabitat = null;
const habitat = () => seam.habitat || realHabitat || (realHabitat = habitatFor(isLandTile));
// The same clock and water for `look water` (water.js), so what you're told is what bites.
export const seaNow = now;
export const seaHabitat = habitat;
const floorAt = (x, y) => (seam.floor ? seam.floor(x, y) : depthUnder(x, y));

function send(pid, phase, fields = {}) {
  const msg = { type: 'boatfish', phase, ...fields };
  if (seam.tap) seam.tap(pid, msg);
  sendToPlayer(pid, msg);
}
const out = (pid, message) => sendToPlayer(pid, { type: 'output', message });
const noop = { type: 'noop' };

// ── THE MOMENT AT SEA AND THE TAKE ────────────────────────────────────────────
// fish.js's env (the hour, the day of the year, the weather word and how rough it is) and the RAM
// take live in sea.js, because the anchor push sends them too: the seat draws the fish before the
// reel opens. The env is taken again when the reel opens and sent with `open`, and the bites are
// rolled on that one, so the client and the server agree on the same fish.
const thinnedNow = (t = now()) => seaThinned(t);
const takeFrom = (schoolId, t = now()) => seaTake(schoolId, t);

// ── THE STATE ─────────────────────────────────────────────────────────────────
// fishState = { mode: 'boat', boatId, zoneId, token, anchor, env, castM, sinkMps, skill, textRung,
//   bait, holdCap, phase: 'aim' | 'line' | 'bite' | 'fight', lure, lastTapAt, interest, spooked,
//   thinned, bite, fight }
export function boatState(player) {
  const cur = getLivePlayer(player.id) || player;
  const st = cur?.fishState;
  return cur?.posture === 'fishing' && st?.mode === 'boat' ? st : null;
}

/** The boat's heading in degrees, 0 north and clockwise, from either rung. */
export function headingOf(pid) {
  const c = conning.get(pid);
  if (c?.s && Number.isFinite(c.s.heading)) return c.s.heading;
  return Number(rigs.get(pid)?.heading) || 0;
}

/** Why the reel has to close now, or null. All RAM: the tick asks this every second. */
function endReason(pid, st) {
  if (aboard.get(pid) !== st.boatId) return 'ashore';
  if (!anchorOf(pid)) return 'anchor';
  const rig = rigs.get(pid);
  if ((rig?.pedal || 0) > 0.08) return 'throttle';
  return null;
}

/** End boat fishing: the posture, the state, and the reel on the client. */
export function endBoatFishing(player, line = STOW) {
  const cur = getLivePlayer(player.id) || player;
  if (cur.posture === 'fishing') forceStand(cur, 'fishing.stop');
  delete cur.fishState;
  send(player.id, 'close');
  if (line) out(player.id, line);
}

/** The posture went out from under the reel (combat, death, a change of room). */
export function abandonBoatFishing(player) {
  const cur = getLivePlayer(player.id) || player;
  delete cur.fishState;
  send(player.id, 'close');
  out(player.id, STOW);
}

// ── OPEN ──────────────────────────────────────────────────────────────────────

/** `fish` aboard a boat. The caller has checked combat. */
export async function openBoatReel(player, boatId) {
  const a = anchorOf(player.id);
  if (!a) return { type: 'emote', message: "You'd drift off your own line. Drop the anchor first." };
  let [rod, lure, gear, skill, holdKg, textRung] = await Promise.all([
    resolveInventoryItem(player.id, { tag: 'fishing_rod' }),
    resolveInventoryItem(player.id, { tag: 'sink_mps' }),
    castGear(player.id),
    effectiveSkill(player, 'fishing'),
    loadHold(boatId),
    prefersTextMinigamesOrDefault(player),
  ]);
  const typeId = rigs.get(player.id)?.typeId || conning.get(player.id)?.typeId || null;
  rod = rod || boatRodFor(typeId);
  if (!rod) return { type: 'emote', message: 'You need a fishing rod to fish.' };
  const castM = Number(rod.tags?.cast_m) > 0 ? Number(rod.tags.cast_m) : CAST_DEFAULT_M;
  const sinkMps = Number(lure?.tags?.sink_mps) > 0 ? Number(lure.tags.sink_mps) : SINK_MPS;
  const env = seaEnv();
  const t = now();
  const st = {
    mode: 'boat', boatId, zoneId: player.current_zone, token: randomUUID(),
    anchor: { x: a.x, y: a.y }, env, castM, boatRod: !!rod.boat, typeId, sinkMps, skill, textRung,
    bait: gear.bait, holdCap: holdCapOf(typeId),
    phase: 'aim', lure: null, lastTapAt: null, interest: {}, spooked: {}, thinned: thinnedNow(t),
    bite: null, fight: null, lastAttempt: t,
  };
  setPosture(player, 'fishing');
  player.fishState = st;
  send(player.id, 'open', {
    token: st.token, ax: a.x, ay: a.y, serverNow: t, env, castM, skill,
    holdKg, holdCap: st.holdCap, thinned: st.thinned,
  });
  return { type: 'emote', message: (rod.boat ? 'You take a rod out of the holder, bait up and settle on the thwart.'
    : 'You bait up, settle on the thwart and lay the rod across your knees.')
    + (textRung ? ' <span class="text-dim">Cast with <b>fish &lt;bearing&gt; &lt;metres&gt;</b>, such as <b>fish 40 20</b>; port is negative.</span>' : '') };
}

// ── CAST ──────────────────────────────────────────────────────────────────────

function sideWords(b) {
  const m = Math.abs(b);
  if (m < 10) return 'over the bow';
  if (m > 170) return 'over the stern';
  return `off the ${b < 0 ? 'port' : 'starboard'} ${m < 60 ? 'bow' : m < 120 ? 'beam' : 'quarter'}`;
}

/** `fishcast boat <bearingDeg> <rangeM> <token>`. */
export function boatCast(player, bearingArg, rangeArg, token, { typed = false } = {}) {
  const st = boatState(player);
  if (!st || st.token !== token) return noop;
  if (st.phase === 'bite' || st.phase === 'fight') return typed ? { type: 'emote', message: "You've got one on." } : noop;
  const a = anchorOf(player.id);
  if (!a) { endBoatFishing(player); return noop; }
  let b = Number(bearingArg);
  if (!Number.isFinite(b)) b = 0;
  b = ((((b + 180) % 360) + 360) % 360) - 180;
  const want = Number(rangeArg);
  let range = clamp(Number.isFinite(want) ? want : st.castM, CAST_MIN_M, Math.max(CAST_MIN_M, st.castM));
  const wb = (headingOf(player.id) + b) * D2R;
  const at = (m) => ({ x: a.x + Math.sin(wb) * (m / SEA_TILE_M), y: a.y - Math.cos(wb) * (m / SEA_TILE_M) });
  // A cast that would land on the shingle comes up short, into the last water on that line.
  let p = at(range), floor = floorAt(p.x, p.y);
  while (!(floor > FLOOR_GAP_M * 2) && range > CAST_MIN_M) {
    range = Math.max(CAST_MIN_M, range - 1);
    p = at(range); floor = floorAt(p.x, p.y);
  }
  if (!(floor > FLOOR_GAP_M * 2)) {
    return typed ? { type: 'emote', message: "There's no water that way worth casting into." } : noop;
  }
  const t = now();
  st.lure = { x: p.x, y: p.y, depth: 0, floor, lineM: range, at: t };
  st.phase = 'line';
  st.lastTapAt = null;
  st.interest = {};
  st.bite = null; st.fight = null;
  st.thinned = thinnedNow(t);
  // The take as it stands at the cast, so a school somebody else fished down since `open` draws as
  // thin as the server rolls it.
  send(player.id, 'lure', { token, lx: +p.x.toFixed(3), ly: +p.y.toFixed(3), lineM: r2(range), depthM: 0, thinned: st.thinned });
  return typed
    ? { type: 'emote', message: `The lure goes out ${numberWords(Math.round(range))} metres ${sideWords(b)} and starts to sink.` }
    : noop;
}

// ── THE LINE ──────────────────────────────────────────────────────────────────

/** The lure sinks between taps, down to just above the floor. Sync and pure arithmetic. */
function settle(st, t) {
  const L = st.lure;
  if (!L) return;
  const dt = Math.max(0, t - L.at) / 1000;
  L.depth = Math.min(Math.max(0, L.floor - FLOOR_GAP_M), L.depth + st.sinkMps * dt);
  L.at = t;
}

/** The activity tick for a boat reel: one second, no query. */
export function boatTick(player, st) {
  const t = now();
  if (endReason(player.id, st)) { endBoatFishing(player); return; }
  if (st.phase === 'line') settle(st, t);
  if (st.phase === 'bite' && st.bite) {
    const b = st.bite, S = b.script;
    if (t - b.biteAt > S.takeAt + S.windowMs + LATENCY_SLACK_MS * 2) spit(player, st, 'late', t);
  }
}

function reelIn(player, st, typed) {
  st.phase = 'aim'; st.lure = null; st.interest = {};
  send(player.id, 'reeled', { token: st.token });
  return typed ? { type: 'emote', message: "The lure comes up under the boat. Cast again when you're ready." } : noop;
}

/** `fishtwitch <token> [reel]`: one tap, or with `reel`, wind the line all the way in. */
export async function boatTwitch(player, token, { typed = false, reel = false } = {}) {
  const st = boatState(player);
  if (!st || st.token !== token || st.phase !== 'line' || !st.lure) return typed ? { type: 'emote', message: 'Cast first.' } : noop;
  if (reel) return reelIn(player, st, typed);
  const t = now();
  if (st.lastTapAt != null && t - st.lastTapAt < TWITCH_MIN_MS) return noop;   // one tap, not two
  settle(st, t);
  const gap = st.lastTapAt == null ? null : t - st.lastTapAt;
  st.lastTapAt = t;
  const L = st.lure, a = st.anchor;
  // In towards the boat and up a little.
  const dx = a.x - L.x, dy = a.y - L.y, d = Math.hypot(dx, dy);
  const step = Math.min(d, TWITCH_M / SEA_TILE_M);
  if (d > 0) { L.x += (dx / d) * step; L.y += (dy / d) * step; }
  L.lineM = Math.max(0, L.lineM - TWITCH_M);
  L.depth = Math.max(0, L.depth - TWITCH_LIFT_M);
  const f = floorAt(L.x, L.y);
  if (f > 0) { L.floor = f; L.depth = Math.min(L.depth, Math.max(0, f - FLOOR_GAP_M)); }
  if (L.lineM <= REEL_IN_M) return reelIn(player, st, typed);

  // Interest: every fish near enough to notice, in 3D. A fish that loses the rhythm cools off.
  const follow = [];
  let best = null;
  for (const fish of fishNear(L.x + 0.5, L.y + 0.5, NOTICE_M / SEA_TILE_M, t, st.env, habitat(), st.thinned)) {
    const s = fish.school;
    if ((st.spooked[s.id] || 0) > t) continue;
    const sp = SPECIES[s.sp];
    if (!sp) continue;
    if (sp.bait && !st.bait?.tags?.has?.(sp.bait)) continue;      // a bait-gated fish wants its bait
    const dist3 = Math.hypot(fish.dist * SEA_TILE_M, fish.depth - L.depth);
    const gain = interestGain({
      dist3, gapMs: gap, spId: s.sp, keen: keenness(sp, st.env),
      bait: (sp.bait || st.bait?.hasBait) ? 1 : 0,
    });
    const key = `${s.id}:${fish.i}`;
    const prev = st.interest[key];
    const v = (prev ? decayInterest(prev.v, t - prev.at) : 0) + gain;
    st.interest[key] = { v, at: t };
    if (gain > 0 && v >= FOLLOW_AT) follow.push({ school: s.id, i: fish.i });
    if (v >= BITE_AT && (!best || v > best.v)) best = { v, fish };
  }
  // Forget the ones that have gone cold, so the map stays the size of the fish near the lure.
  for (const [k, e] of Object.entries(st.interest)) if (decayInterest(e.v, t - e.at) < 0.02) delete st.interest[k];

  send(player.id, 'twitch', { token, lx: +L.x.toFixed(3), ly: +L.y.toFixed(3), lineM: r2(L.lineM), depthM: r2(L.depth), follow });
  if (best) return bite(player, st, best.fish, t, typed);
  if (!typed) return noop;
  return { type: 'emote', message: `You twitch it in. ${numberWords(Math.round(L.lineM))} metres of line out, ${numberWords(Math.round(L.depth))} down.`
    + (follow.length ? ' A shadow turns after it.' : '') };
}

// ── THE STRIKE ────────────────────────────────────────────────────────────────

async function bite(player, st, fish, t, typed) {
  const s = fish.school, sp = SPECIES[s.sp];
  const kg = fishKg(s, fish.i);
  // What it'll do to the float. Made here and sent whole, so the strike is judged against the same
  // object the client draws. Not a secret worth keeping: the client plays the fight too.
  const script = takeScript(Math.floor(Math.random() * 2 ** 31), s.sp, kg);
  st.phase = 'bite';
  st.bite = { schoolId: s.id, i: fish.i, sp: s.sp, kg, difficulty: sp.difficulty, script, biteAt: t, set: 0,
    x: fish.x - 0.5, y: fish.y - 0.5, depth: fish.depth };
  send(player.id, 'bite', { token: st.token, school: s.id, i: fish.i, species: s.sp, script, biteAt: t });
  // ⚠ THE TEXT AND LOG RUNGS HAVE NO FLOAT TO WATCH. One fishing check against the fish settles
  // the strike and the fight together, as settleLogBite does on the shore; the landing is the
  // same code every rung runs.
  if (st.textRung) return settleBoatBite(player, st);
  return typed ? { type: 'emote', message: "Something's at the lure. Wait until the float goes, then <b>fish strike</b>." } : noop;
}

/** The log rung's bite, strike and fight in one check. */
export async function settleBoatBite(player, st = boatState(player)) {
  if (!st?.bite) return noop;
  const b = st.bite;
  out(player.id, '<span class="text-cyan">Something takes the lure. You strike and lean into it.</span>');
  startFight(player, st, now(), { settled: true });
  const { won } = await resolveForLogRung(player, { difficulty: b.difficulty }, { skill: 'fishing' });
  return boatResolve(player, won ? '1' : '0', st.token);
}

// The fish has gone and the lure is still in the water, so you fish on. A strike at nothing pulls
// the lure back through the water, so an early one costs line as well as the fish.
function spit(player, st, reason, t = now()) {
  const b = st.bite, L = st.lure;
  if (b) st.spooked[b.schoolId] = t + SPOOK_MS;
  st.bite = null; st.interest = {}; st.lastTapAt = null;
  if (reason === 'early' && L) {
    const a = st.anchor, dx = a.x - L.x, dy = a.y - L.y, d = Math.hypot(dx, dy), step = Math.min(d, STRIKE_YANK_M / SEA_TILE_M);
    if (d > 0) { L.x += (dx / d) * step; L.y += (dy / d) * step; }
    L.lineM = Math.max(0, L.lineM - STRIKE_YANK_M);
    L.depth = Math.max(0, L.depth - TWITCH_LIFT_M * 2);
  }
  out(player.id, reason === 'early' ? "Too soon. You pull it out of its mouth and it's gone." : "Too slow. It drops the lure and it's gone.");
  if (!L || L.lineM <= REEL_IN_M) {
    st.phase = 'aim'; st.lure = null;
    send(player.id, 'spat', { token: st.token, reason, reeled: true });
    return;
  }
  L.at = t;
  st.phase = 'line';
  send(player.id, 'spat', { token: st.token, reason, lx: +L.x.toFixed(3), ly: +L.y.toFixed(3), lineM: r2(L.lineM), depthM: r2(L.depth) });
}

function startFight(player, st, t, { settled = false } = {}) {
  const b = st.bite, sp = SPECIES[b.sp];
  const lineM = st.lure?.lineM ?? REEL_IN_M;
  st.phase = 'fight';
  st.fight = { ...b, lineM, startAt: t, settled };
  if (!settled) {
    send(player.id, 'fight', { token: st.token, species: b.sp, name: sp.name, kg: b.kg, difficulty: b.difficulty,
      fight: sp.fight, lineM: r2(lineM), skill: st.skill, set: b.set });
  }
}

/** `fishstrike <hitServerMs> <token>`: the strike, in server time. One, and it's judged. */
export function boatStrike(player, hitArg, token, { typed = false } = {}) {
  const st = boatState(player);
  if (!st || st.token !== token || st.phase !== 'bite' || !st.bite) return typed ? { type: 'emote', message: "Nothing's on." } : noop;
  const t = now(), b = st.bite, S = b.script;
  const hit = Number(hitArg) - b.biteAt, arrive = t - b.biteAt;
  // Late: the window has closed by the time the strike arrives, whatever time it claims.
  if (arrive > S.takeAt + S.windowMs + LATENCY_SLACK_MS * 2) { spit(player, st, 'late', t); return noop; }
  // A hit can't claim a moment that hasn't happened yet.
  const when = Number.isFinite(hit) && hit <= arrive + LATENCY_SLACK_MS ? hit : -Infinity;
  const j = judgeStrike(when, S, LATENCY_SLACK_MS);
  if (!j.ok) { spit(player, st, j.why, t); return noop; }
  b.set = j.set;
  startFight(player, st, t);
  if (!typed) return noop;
  const nm = SPECIES[b.sp].name;
  return { type: 'emote', message: `${setWords(j.set) === 'lip' ? "It's on, but only just." : "It's on."} ${nm[0].toUpperCase()}${nm.slice(1)}, by the way it pulls.` };
}

// ── LANDING ───────────────────────────────────────────────────────────────────

const kgWords = (kg) => (kg < 1 ? `${Math.round(kg * 1000)} grams` : `${+kg.toFixed(1)} kilos`);

/** `fishresolve boat <1|0> <token>`: the fight's result. */
export async function boatResolve(player, wonArg, token) {
  const st = boatState(player);
  if (!st || st.token !== token || st.phase !== 'fight' || !st.fight) return noop;
  const f = st.fight, sp = SPECIES[f.sp], t = now();
  let won = wonArg === '1';
  // The line comes back in either way; you cast again when you're ready.
  st.phase = 'aim'; st.fight = null; st.bite = null; st.lure = null; st.interest = {}; st.lastAttempt = t;

  // ⚠ A WIN FASTER THAN THE FISH COULD BE BEATEN IS REFUSED. It throws the hook.
  if (won && !f.settled && t - f.startAt < minFightMs({ kg: f.kg, difficulty: f.difficulty, skill: st.skill, lineM: f.lineM })) {
    send(player.id, 'lost', { token, snapped: false });
    out(player.id, '<span class="text-red">It throws the hook.</span>');
    return noop;
  }

  if (!won) {
    const snapMsg = st.boatRod ? '' : await maybeSnapRod(player.id);
    const snapped = snapMsg.includes('snaps clean');
    send(player.id, 'lost', { token, snapped });
    out(player.id, `<span class="text-red">The line goes slack: it's gone.</span>${snapMsg}`);
    if (snapped) endBoatFishing(player, null);
    return noop;
  }

  const [rod, skill] = await Promise.all([
    resolveInventoryItem(player.id, { tag: 'fishing_rod' }),
    effectiveSkill(player, 'fishing'),
  ]);
  if (!rod && !(st.boatRod && boatRodFor(st.typeId))) { endBoatFishing(player, "Your rod's gone: nothing to land it with."); return noop; }
  // The margin is skill against the fish: a hard fish pays more often (a bigger margin pays LESS).
  const margin = Math.max(0, skill - f.difficulty);

  // Room in the box, by the running total: no read.
  const have = holdKgOf(st.boatId) ?? await loadHold(st.boatId);
  if (have + f.kg > st.holdCap) {
    send(player.id, 'full', { token, species: f.sp, name: sp.name, kg: f.kg });
    out(player.id, "No room in the box. You ease it off the hook and it's gone.");
    if (Math.random() < 0.5) await awardSkillUse(player.id, 'fishing', margin);   // half the award
    return noop;
  }

  // The total moves before the write, so a second landing behind this one sees it.
  const holdKg = addHoldKg(st.boatId, f.kg);
  try {
    await query('INSERT INTO boat_hold (boat_id, item_id, kg, species, x, y, depth_m) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [st.boatId, sp.item, f.kg, f.sp, r2(f.x), r2(f.y), r2(f.depth)]);
  } catch (err) {
    addHoldKg(st.boatId, -f.kg);
    console.error('[fishing] boat_hold insert:', err.message);
    out(player.id, 'It slips the hook at the last second and is gone.');
    return noop;
  }
  takeFrom(f.schoolId, t);
  st.thinned = thinnedNow(t);
  emit('fish.caught', { player, item_id: sp.item, zoneId: st.zoneId, boat: true, kg: f.kg, species: f.sp });
  await Promise.all([consumeBait(player.id), awardSkillUse(player.id, 'fishing', margin)]);
  send(player.id, 'landed', { token, species: f.sp, name: sp.name, kg: f.kg, holdKg, holdCap: st.holdCap, thinned: st.thinned });
  out(player.id, `<span class="item-grant">You work it in and lift ${/^[aeiou]/.test(sp.name) ? "an" : "a"} ${sp.name} into the box: ${kgWords(f.kg)}.</span>`);
  return noop;
}

// ── TYPED ─────────────────────────────────────────────────────────────────────

// The sonar in words, for the rungs with no screen and anyone who'd rather read it: the depth under
// her and the nearest marks. It reads the sim straight, as the seat's screen does, so it works after
// dark, when `look water` can't. It doesn't name a fish: a sonar doesn't know what it's looking at.
function boatSonarText(player, st) {
  if (!(Number(TYPES[st.typeId]?.sonar) > 0)) return { type: 'emote', message: 'She has no sounder.' };
  const a = st.anchor, t = now();
  const under = Math.round(floorAt(a.x, a.y));
  const marks = fishNear(a.x + 0.5, a.y + 0.5, 70 / SEA_TILE_M, t, st.env, habitat(), st.thinned);
  if (!marks.length) return { type: 'emote', message: `The sounder gives ${numberWords(under)} metres under her and nothing on the screen.` };
  const seen = new Set(), lines = [], head = headingOf(player.id);
  for (const f of marks) {
    if (seen.has(f.school.id)) continue;
    seen.add(f.school.id);
    const b = ((Math.atan2(f.x - 0.5 - a.x, -(f.y - 0.5 - a.y)) / D2R - head + 540) % 360) - 180;
    const size = f.school.n > 6 ? 'A big cloud of marks' : f.school.n > 1 ? 'A few marks' : f.kg > 5 ? 'One heavy mark' : 'One mark';
    lines.push(`${size} ${numberWords(Math.round(f.dist * SEA_TILE_M))} metres ${sideWords(b)}, ${numberWords(Math.round(f.depth))} down.`);
    if (lines.length >= 3) break;
  }
  return { type: 'emote', message: `The sounder gives ${numberWords(under)} metres under her. ${lines.join(' ')}` };
}

/** `fish …` while the boat reel is open: a cast, a twitch, a strike or the sonar. Null when it's none. */
export async function boatTyped(args, player) {
  const st = boatState(player);
  if (!st) return null;
  const w = String(args[0] || '').toLowerCase();
  if (w === 'twitch' || w === 'tap') return boatTwitch(player, st.token, { typed: true });
  if (w === 'reel') return boatTwitch(player, st.token, { typed: true, reel: true });
  if (w === 'strike') return boatStrike(player, now(), st.token, { typed: true });
  if (w === 'sonar') return boatSonarText(player, st);
  if (args.length >= 2 && Number.isFinite(Number(args[0])) && Number.isFinite(Number(args[1]))) {
    return boatCast(player, args[0], args[1], st.token, { typed: true });
  }
  return null;
}

export const _test = {
  seam, taken, thinnedNow, takeFrom, settle, endReason, headingOf, seaEnv, dayOfYear,
  resetHabitat: () => { realHabitat = null; }, CAST_DEFAULT_M, SPOOK_MS,
};
