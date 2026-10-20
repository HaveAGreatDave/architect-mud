/**
 * sports-banter: the room watches the game.
 *
 * A sports line that calls a moment (a goal, a run, a home run, a double play, a
 * fight, a man carried off, the final) carries a `play` on `broadcast.message`:
 * the sport, the kind, the club it was good for and the club it hurt (see `say` in
 * the broadcast plugin's assembleSportsGraph). This plugin hears it in every room
 * with a set tuned to the game and, sometimes, has the people in that room react.
 *
 * Who reacts, and how, comes from who they back. Every NPC has a club in each league
 * they follow (fans.js; the same club gossip's favTeam names), so a play is good,
 * bad, a rival's misfortune or nothing at all to each of them. Then:
 *
 *   • two fans on opposite sides of it can have a short exchange (lines.js THREADS),
 *     and a pair whose clubs are rivals is the one most likely to;
 *   • otherwise one person reacts to the room: a cheer, a groan, a look at the
 *     fan on the other side who they aren't speaking to.
 *
 * The restraint is tv-reactions', loosened only because a goal is an event and a
 * line of commentary isn't: a player has to be in the room, one reaction per room
 * per ZONE_GAP_MS (less for the moments a room would never let pass), a chance per
 * kind, and nobody who spoke in the last SAY_GAP_MS. Eligibility is npc-banter's own
 * `eligibleNpcs()`, so a sleeper or a barman on shift stays out of it. tv-reactions
 * leaves any beat with a `play` to this plugin, so the two never answer one goal twice.
 */
import { on } from '../../server/engine/events.js';
import { world } from '../../server/engine/world.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { eligibleNpcs } from '../../server/engine/npc-banter.js';
import { formatChitchat } from '../../server/engine/ai-behaviour.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { randInt } from '../../server/engine/util.js';
import { makeLeague, clubFor, rivalOf, stanceOf, rankPairs, POSITIVE, NEGATIVE } from './fans.js';
import { SOLO, AT, THREADS, GROUP_OF } from './lines.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
const ZONE_GAP_MS     = 40_000;       // quiet per room after a reaction
const BIG_GAP_MS      = 12_000;       // ...unless the game just ended, or something like it
const SAY_GAP_MS      = 25_000;       // somebody who just spoke stays quiet (shared with banter)
const BIG_SAY_GAP_MS  = 10_000;
const REACT_DELAY_MS  = [1800, 4200]; // after the call, like a person hearing it
const TURN_GAP_MS     = [3000, 6000]; // between turns of a two-hander
const RECENT_LINES    = 8;            // a room doesn't hear the same line twice in this many

// The chance a room reacts at all, by kind. A run is the commonest thing on the set;
// a triple play happens once in four hundred games and nobody keeps quiet through it.
const CHANCE = {
  run: 0.35, goal: 0.55, homerun: 0.75, grandslam: 0.95, walkoff: 0.95, hattrick: 0.85,
  doubleplay: 0.45, tripleplay: 0.95, error: 0.4,
  fight: 0.7, injury: 0.5, death: 0.95,
  final: 0.75, champion: 0.95,
};
const NO_STAKE    = 0.4;   // nobody in the room backs either club, or either one's rival
const PAIR_CHANCE = { feud: 0.85, needle: 0.75, clash: 0.6, brag: 0.5, together_up: 0.4, together_down: 0.4 };
const AT_CHANCE   = 0.35;  // a lone reaction aimed at the fan on the other side
const BIG = new Set(['grandslam', 'walkoff', 'hattrick', 'tripleplay', 'death', 'final', 'champion']);
// A kind with no line for a stance tries this before its group.
const FALLBACK = { grandslam: 'homerun', champion: 'final' };

const rand0 = Math.random;
const pick = (arr, rand = rand0) => arr[Math.floor(rand() * arr.length)];
const shuffled = (arr, rand = rand0) => arr.map(v => [rand(), v]).sort((a, b) => a[0] - b[0]).map(p => p[1]);

// ── The league ────────────────────────────────────────────────────────────────
// Pinned from broadcast once its library has loaded. Until then (or in a bare world),
// clubs are learnt from the plays themselves, with no rivals.
let league = makeLeague();
let pinned = false;
const learnt = { teams: new Set(), sports: {} };

async function pinLeague(attempt = 0) {
  const res = await dispatchAction({ type: 'broadcast.getSportsTeams' }).catch(() => null);
  if (Array.isArray(res?.teams) && res.teams.length) {
    league = makeLeague(res);
    pinned = true;
    return;
  }
  if (attempt < 5) setTimeout(() => pinLeague(attempt + 1).catch(() => {}), 10_000).unref?.();
}
setTimeout(() => pinLeague().catch((e) => console.error('[sports-banter] league pin:', e.message)), 7000).unref?.();

function learn(play) {
  if (pinned) return;
  let changed = false;
  for (const t of [play.away, play.home]) {
    if (t && !learnt.teams.has(t)) { learnt.teams.add(t); learnt.sports[t] = play.sport; changed = true; }
  }
  if (changed) league = makeLeague({ teams: [...learnt.teams], sports: learnt.sports });
}

// ── Words ─────────────────────────────────────────────────────────────────────
// A club as people say it: "the Crows". A plural that's an ordinary word keeps the
// word before it, so the two leagues' Birds and Rats stay apart.
const KEEP_TWO = new Set(['birds', 'rats']);
export function clubWord(team) {
  const w = String(team || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return null;
  const last = w[w.length - 1];
  return `the ${w.length > 1 && KEEP_TWO.has(last.toLowerCase()) ? w.slice(-2).join(' ') : last}`;
}
const surname = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).pop() || null;
// "Declan Mulcahy" is Declan; "the bartender" has no first name to call across a room.
function firstName(npc) {
  const w = String(npc?.name || '').trim().split(/\s+/)[0] || '';
  if (!/^[A-Z]/.test(w) || /^(The|A|An)$/.test(w)) return null;
  return w;
}

function tokensFor(me, other, play) {
  return {
    team: clubWord(play.for), opp: clubWord(play.against),
    player: surname(play.player), loser: surname(play.loser),
    mine: me?.club ? clubWord(me.club) : null, rival: me?.rival ? clubWord(me.rival) : null,
    to: other ? firstName(other.npc) : null, theirs: other?.club ? clubWord(other.club) : null,
  };
}

// Fill a line's tokens, or null when one has no value for this speaker. A club that
// opens a sentence opens it with a capital.
export function fill(line, tok) {
  let ok = true;
  const out = line.replace(/\{([a-z]+)\}/g, (m, key, at, src) => {
    const v = tok[key];
    if (!v) { ok = false; return m; }
    return /(^"|[.!?]\s+"?)$/.test(src.slice(0, at)) ? v.charAt(0).toUpperCase() + v.slice(1) : v;
  });
  return ok ? out : null;
}

const kindOf = (play) => (play.kind === 'homerun' && play.grand ? 'grandslam'
  : play.kind === 'final' && play.champion ? 'champion' : play.kind);
const isBig = (kind, play) => BIG.has(kind) || !!play.sudden;
const chainOf = (kind) => [...new Set([kind, FALLBACK[kind], GROUP_OF[kind]].filter(Boolean))];

// A pool without the lines this room just heard, unless that's all of it.
const fresh = (pool, avoid) => {
  if (!avoid?.size) return pool;
  const left = pool.filter(l => !avoid.has(l));
  return left.length ? left : pool;
};

// One line for one person to the room, as { text, key } (key: the line as written).
// The kind's own lines first, most of the time, then its group's; the group always has
// the stance, so this only comes back empty when every line wants a token this speaker
// can't fill.
export function pickSolo(kind, stance, tok, rand = rand0, avoid = null) {
  const pools = chainOf(kind).map(k => fresh(SOLO[k]?.[stance] || [], avoid)).filter(p => p.length);
  if (!pools.length) return null;
  for (let i = 0; i < 6; i++) {
    const pool = pools.find((p, n) => n === pools.length - 1 || rand() < 0.6);
    const key = pick(pool, rand), text = fill(key, tok);
    if (text) return { text, key };
  }
  for (const key of shuffled(pools.flat(), rand)) {
    const text = fill(key, tok);
    if (text) return { text, key };
  }
  return null;
}

// A two-hander for this pair as { turns, key }, turns filled for whoever says each one.
// A thread the room just heard goes to the back of the queue.
export function threadFor(type, kind, play, a, b, rand = rand0, avoid = null) {
  const keys = new Set([...chainOf(kind), play.kind]);
  const fits = (THREADS[type] || []).filter(t => t.on.some(k => keys.has(k)) && (!t.sport || t.sport === play.sport));
  const tokA = tokensFor(a, b, play), tokB = tokensFor(b, a, play);
  const heard = (t) => (avoid?.has(t.turns[0]) ? 1 : 0);
  for (const t of shuffled(fits, rand).sort((x, y) => heard(x) - heard(y))) {
    const turns = t.turns.map((line, i) => fill(line, i % 2 === 0 ? tokA : tokB));
    if (turns.every(Boolean)) return { turns, key: t.turns[0] };
  }
  return null;
}

// What the room does about this play, or null. Pure apart from reading the room.
// `avoid` is the lines it heard lately, as written.
export function planReaction(zoneId, play, now = Date.now(), rand = rand0, avoid = null) {
  const kind = kindOf(play);
  const sayGap = isBig(kind, play) ? BIG_SAY_GAP_MS : SAY_GAP_MS;
  const cands = eligibleNpcs(zoneId)
    .filter(npc => now - (npc._ai?.lastSay || 0) >= sayGap)
    .map(npc => {
      const club = clubFor(npc, play.sport, league);
      const rival = rivalOf(club, league);
      return { npc, club, rival, stance: stanceOf(club, rival, play) };
    });
  if (!cands.length) return null;
  const stake = cands.filter(c => c.stance !== 'neutral');

  let chance = CHANCE[kind] ?? 0.4;
  if (!stake.length) chance *= NO_STAKE;
  if (rand() > chance) return null;

  // Two people, when the room has the right two and the best of them takes the chance.
  const pairs = rankPairs(stake, rand);
  if (pairs.length && rand() < PAIR_CHANCE[pairs[0].type]) {
    for (const p of pairs) {
      const t = threadFor(p.type, kind, play, p.a, p.b, rand, avoid);
      if (t) return { kind, type: 'pair', pairType: p.type, speakers: [p.a.npc, p.b.npc], turns: t.turns, key: t.key };
    }
  }

  // One person. Somebody with a stake, mostly.
  const me = pick(stake.length && rand() < 0.8 ? stake : cands, rand);
  if (me.stance !== 'neutral' && AT[me.stance] && rand() < AT_CHANCE) {
    const other = POSITIVE.has(me.stance) ? NEGATIVE : POSITIVE;
    const them = stake.filter(c => c !== me && other.has(c.stance));
    if (them.length) {
      const key = pick(fresh(AT[me.stance], avoid), rand);
      const line = fill(key, tokensFor(me, pick(them, rand), play));
      if (line) return { kind, type: 'at', speakers: [me.npc], turns: [line], key };
    }
  }
  const solo = pickSolo(kind, me.stance, tokensFor(me, null, play), rand, avoid);
  return solo ? { kind, type: 'solo', speakers: [me.npc], turns: [solo.text], key: solo.key } : null;
}

// ── Saying it ─────────────────────────────────────────────────────────────────
const lastReactAt = new Map();   // zoneId → timestamp
const scenes = new Map();        // zoneId → the pending turn's timer
const heardIn = new Map();       // zoneId → the last RECENT_LINES lines it heard, as written

function remember(zoneId, key) {
  if (!key) return;
  const list = (heardIn.get(zoneId) || []).filter(k => k !== key);
  list.push(key);
  heardIn.set(zoneId, list.slice(-RECENT_LINES));
}

function endScene(zoneId) {
  clearTimeout(scenes.get(zoneId));
  scenes.delete(zoneId);
}

function perform(zoneId, plan) {
  // Everybody in it is spoken for from now, so banter and tv-reactions leave them be.
  const stamp = () => { const t = Date.now(); for (const n of plan.speakers) if (n._ai) n._ai.lastSay = t; };
  stamp();
  let i = 0;
  const step = () => {
    // Re-validate every turn. Long enough to leave the room, clock on, or start a fight.
    const live = new Set(eligibleNpcs(zoneId).map(n => n.id));
    const z = world.zones.get(zoneId);
    if (!z || z.players.size === 0 || !plan.speakers.every(n => live.has(n.id))) return endScene(zoneId);
    const speaker = plan.speakers[i % plan.speakers.length];
    sendToZone(zoneId, formatChitchat(speaker.name, plan.turns[i]));
    stamp();
    if (++i >= plan.turns.length) return endScene(zoneId);
    scenes.set(zoneId, setTimeout(step, randInt(TURN_GAP_MS[0], TURN_GAP_MS[1])));
  };
  scenes.set(zoneId, setTimeout(step, randInt(REACT_DELAY_MS[0], REACT_DELAY_MS[1])));
}

function onBroadcastMessage(beat) {
  const play = beat?.play;
  if (!play?.kind || !play.sport || !beat.zoneId || beat.onStage) return;
  learn(play);

  const zone = world.zones.get(beat.zoneId);
  if (!zone || zone.players.size === 0) return;

  const now = Date.now();
  const kind = kindOf(play);
  const big = isBig(kind, play);
  if (now - (lastReactAt.get(beat.zoneId) || 0) < (big ? BIG_GAP_MS : ZONE_GAP_MS)) return;
  // A room already mid-argument finishes it, unless the game just ended under them.
  if (scenes.has(beat.zoneId) && !big) return;

  const plan = planReaction(beat.zoneId, play, now, rand0, new Set(heardIn.get(beat.zoneId) || []));
  if (!plan) return;
  remember(beat.zoneId, plan.key);

  // Claim the room before the delay, or a goal and its credit line queue two reactions.
  lastReactAt.set(beat.zoneId, now);
  endScene(beat.zoneId);
  perform(beat.zoneId, plan);
}

on('broadcast.message', onBroadcastMessage);

export const commands = {};

// Exposed for the regress suite.
export const _test = {
  onBroadcastMessage, planReaction, pickSolo, threadFor, fill, clubWord, kindOf,
  lastReactAt, scenes, endScene, heardIn, remember,
  setLeague: (l) => { league = l; pinned = true; },
  getLeague: () => league,
};
