// plugins/strays — Cathode, the stray with the bionic paw.
//
// A cat lives in Dray Lane. Most of the time it is not there. Every so often, if
// somebody is standing in the lane, it comes out for a minute or two and does
// cat things, and then it goes again. You can pet it. You can kill it. It
// remembers which of those you did, forever.
//
// ─── THE FOUR DECISIONS ────────────────────────────────────────────────────
//
// 1. HIDING IS ABSENCE, NOT SUPPRESSION. There is no "hidden NPC" concept in the
//    engine and this plugin does not invent one. While hidden, Cathode is in a
//    real zone with no exits (the den), which is unreachable by movement and not
//    on the map. So `look`, getZoneNpcs, SIFT, `attack` and `pet` all agree with
//    each other for free, because there is only ever one truth about where it is.
//    A `flags.hidden` that the room description filtered would have had to be
//    honoured by six other readers, and the first one anybody forgot would be an
//    invisible cat you could still stab.
//
// 2. THE DEN IS ALSO THE FAIL-SAFE. `home_zone` is the den, so the engine's own
//    respawn (gameLoop.js npcWanderTick) and its own boot placement (world.js)
//    both put the cat back into hiding without knowing this plugin exists. The
//    default state after any restart, crash or unanticipated code path is
//    "hidden", which is the safe one.
//
// 3. WE RETUNE THE ENGINE'S RESPAWN TIMER, WE DON'T REPLACE IT. Combat sets
//    `npc._respawnAt = now + 60s`. The 24-hour hide is that same field with a
//    bigger number in it, written synchronously the moment the kill event lands.
//    There is no respawn code in this plugin at all. The world flag is an
//    independent second mechanism covering the case the RAM field cannot: a
//    restart, which clears `_dead` entirely.
//
// 4. IT NEVER ARGUES. Nothing here explains the paw, and no NPC in the lane knows
//    who fitted it. The one authored line about the name is somebody misremembering
//    a joke. If you add lore that answers the question, the animal stops being a
//    stray and becomes a quest.

import { registerInputMatcher } from '../../server/engine/plugins.js';
import { schedule } from '../../server/engine/scheduler.js';
import { on, emit } from '../../server/engine/events.js';
import { world, getZone, getZoneNpcs, getZonePlayers, getZoneFurniture, moveNpcToZone } from '../../server/engine/world.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { adjustSanity } from '../../server/engine/condition.js';
import { adjustRelation } from '../../server/engine/relations.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { query } from '../../server/models/db.js';
import { BEHAVIOURS, pickBehaviour } from './behaviours.js';
import { moodToward, recordPet, recordKill, petsBy, killsBy, PET_COOLDOWN_MS, GIFT_PETS } from './memory.js';

// ─── Constants ─────────────────────────────────────────────────────────────

export const CAT_ID   = 'npc_stray_cathode';
export const DEN_ZONE = 'zone_dray_lane_den';

// The six contiguous Dray Lane tiles. A short north-south service lane with one
// dead-side pocket in the middle, which is where a cat would actually live.
export const LANE_ZONES = [
  'zone_district_921_903',
  'zone_district_921_904',
  'zone_district_921_905',
  'zone_district_921_906',
  'zone_district_921_907',
  'zone_district_921_908',
];
const LANE_SET = new Set(LANE_ZONES);

const HIDE_MS       = 24 * 60 * 60_000;  // the grief window after a kill
const HIDDEN_FLAG   = 'stray_cat_hidden_until';
const QUIET_MIN_MS  = 4 * 60_000;        // gap between appearances
const QUIET_MAX_MS  = 9 * 60_000;
const WINDOW_MIN_MS = 45_000;            // how long it stays out
const WINDOW_MAX_MS = 120_000;
const PET_EXTEND_MS = 30_000;            // petting buys you a little longer
const BEHAVE_CHANCE = 0.65;              // per 30s tick while surfaced
const RECENT_RING   = 6;

const PET_SANITY        = 6;
const KILL_SANITY       = -18;
const WITNESS_SANITY    = -6;
const WITNESS_WARMTH    = -12;

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ─── Runtime state (RAM only, and that is correct) ─────────────────────────
//
// Losing all of this on a restart costs one appearance window. The only fact
// that must survive a restart is the 24h hide, and that is a world flag.

const S = {
  surfacedUntil: 0,
  lastSurfaceAt: 0,
  nextQuietMs: QUIET_MIN_MS,
  zoneId: null,          // where it currently is, while surfaced
  recent: [],            // behaviour keys, most recent last
  followedThisWindow: false,
  hiddenUntil: null,     // null = not yet loaded from the world flag
};

const cat = () => world.npcs.get(CAT_ID) || null;
const isSurfaced = () => !!S.zoneId;

// ─── The hide deadline ─────────────────────────────────────────────────────

async function hiddenUntil() {
  if (S.hiddenUntil === null) {
    S.hiddenUntil = Number(await getFlag('world', HIDDEN_FLAG)) || 0;
  }
  return S.hiddenUntil;
}

async function setHiddenUntil(ms) {
  S.hiddenUntil = ms;
  await setFlag('world', HIDDEN_FLAG, String(ms));
}

// ─── Surface / despawn ─────────────────────────────────────────────────────
//
// EVERY position change goes through moveNpcToZone and nothing else. A raw
// `zone.npcs.add/delete` that gets it wrong produces a cat that is in two rooms
// or in none. One funnel.
//
// There is now a reconcileNpcMembership() sweep on the 30s tick, so that is a
// bounded blip with a name in the log rather than permanent and silent — but it
// is a NET, not a licence. Up to 30 seconds of a cat in two lanes is still a cat
// in two lanes, and the sweep believes `npc.zone_id`, so a writer that sets the
// field wrongly gets its mistake made CONSISTENT rather than corrected.

const ARRIVALS = [
  "Something small comes out from between the crates, unhurried, and sits down like it owns the lane. One of its front paws isn't a paw.",
  'A grey cat picks its way out of the shadows at the side of the lane. It puts down three soft feet and one that clicks.',
  "There's a cat here. There wasn't a cat here a moment ago, and it isn't going to explain that.",
];

const DEPARTURES = [
  "The cat decides it's done with you, and is gone between one look and the next.",
  "The cat stretches, turns, and walks off into a gap you wouldn't have said was a gap.",
  "Somewhere behind the crates there's one small clink of metal on stone, and then nothing.",
];

function surface(zoneId, line) {
  const c = cat();
  if (!c || c._dead) return false;
  if (!moveNpcToZone(CAT_ID, zoneId)) return false;
  S.zoneId = zoneId;
  S.surfacedUntil = Date.now() + rand(WINDOW_MIN_MS, WINDOW_MAX_MS);
  S.lastSurfaceAt = Date.now();
  S.followedThisWindow = false;
  S.recent = [];
  sendToZone(zoneId, { type: 'zone_event', message: line || pick(ARRIVALS), refresh: true });
  return true;
}

function despawn(line, excludePlayerId) {
  const from = S.zoneId;
  S.zoneId = null;
  S.surfacedUntil = 0;
  S.lastSurfaceAt = Date.now();
  S.nextQuietMs = rand(QUIET_MIN_MS, QUIET_MAX_MS);
  const c = cat();
  if (!c) return;
  moveNpcToZone(CAT_ID, DEN_ZONE);
  if (from) {
    sendToZone(from, { type: 'zone_event', message: line || pick(DEPARTURES), refresh: true }, excludePlayerId);
  }
}

// ─── The behaviour beat ────────────────────────────────────────────────────

async function buildCtx(zoneId) {
  const c = cat();
  const zone = getZone(zoneId);
  const players = getZonePlayers(zoneId) || [];
  // The beat is ABOUT one player — whoever it has the strongest opinion of.
  // A room with a regular and a stranger in it should read as the cat greeting
  // the regular, not as the cat hedging.
  let focus = null, focusMood = 'wary', focusPets = 0;
  const RANK = { seek: 3, neutral: 2, wary: 1, flee: 0 };
  for (const p of players) {
    const mood = await moodToward(p, CAT_ID);
    if (!focus || RANK[mood] > RANK[focusMood]) { focus = p; focusMood = mood; }
  }
  if (focus && focusMood === 'seek') focusPets = await petsBy(focus);

  return {
    cat: c, name: c?.name || 'the cat',
    zone, zoneId, players, player: focus,
    mood: focusMood, pets: focusPets,
    furniture: getZoneFurniture(zoneId) || [],
    env: getEnvironmentState(),
  };
}

async function behave() {
  if (!S.zoneId) return;
  const ctx = await buildCtx(S.zoneId);
  const b = pickBehaviour(ctx, S.recent);
  if (!b) return;
  S.recent.push(b.key);
  if (S.recent.length > RECENT_RING) S.recent.shift();
  let line, you;
  try {
    line = b.line(ctx);
    // A behaviour aimed at somebody says it to them in the second person and to
    // the room in the third. `you` is optional and its absence is the normal
    // case; a throw in either half drops the whole beat rather than sending a
    // half of it, which would read as the room and the player disagreeing.
    if (b.you && ctx.player) you = b.you(ctx);
  } catch { return; }
  if (!line) return;
  if (you && ctx.player) {
    sendToPlayer(ctx.player.id, { type: 'output', message: you });
    sendToZone(S.zoneId, { type: 'zone_event', message: line }, ctx.player.id);
    return;
  }
  sendToZone(S.zoneId, { type: 'zone_event', message: line });
}

// ─── Walking in on a repeat killer ─────────────────────────────────────────
//
// The refusal ladder above is about somebody REACHING for her. This is the other
// half: her being in a room that a twice-over killer is also in, without anybody
// having done anything yet. She hisses once and goes.
//
// Why TWO kills and not one. One kill already costs you everything the ladder
// costs — she will not be found by you, will not come when called, will not be
// petted. But she still gets to exist in a room you are standing in, which is
// the difference between "you are not forgiven" and "you are weather". Twice is
// where she stops sharing air with you, and it matches the ladder's own top rung
// (`pet` at kills >= 2 bolts without a warning) rather than inventing a second
// threshold nobody could infer.
//
// The hiss is the exception to that rung's silence and it is deliberate: nobody
// reached for her here, so a bolt with no sound at all would read as the cat
// wandering off, and the room would learn nothing. It still never says WHY —
// same rule as every other refusal.

const REPEAT_KILLS = 2;

const SPOOK_YOU = [
  "She comes up off the ground the instant she registers you — sideways, hackles up, one long hiss — and then there's nothing in the lane but the noise of her leaving.",
  'The hiss starts before she has finished turning round. She holds it for exactly as long as it takes to get her feet under her, and then she is gone.',
  'She sees you. Whatever she was doing stops. She hisses, once, flat and ugly, and runs.',
];

const SPOOK_ROOM = [
  'The cat comes up hissing at $who, sideways and bristling, and bolts.',
  'The cat spots $who, makes a sound nothing in the lane wants to hear twice, and is gone.',
  'Something small goes past your ankles at speed, hissing. $who is standing where it was looking.',
];

async function repeatKillerIn(zoneId) {
  for (const p of getZonePlayers(zoneId) || []) {
    if ((await killsBy(p)) >= REPEAT_KILLS) return p;
  }
  return null;
}

/**
 * Hiss and go. The offender gets the second-person line WITH a refresh (their
 * room pane must stop listing her); everybody else gets the third person one on
 * the ordinary departure path, which refreshes them too.
 */
function spookedBy(player) {
  if (!isSurfaced()) return;
  sendToPlayer(player.id, { type: 'zone_event', message: pick(SPOOK_YOU), refresh: true });
  despawn(pick(SPOOK_ROOM).replace('$who', player.handle), player.id);
}

// ─── The tick ──────────────────────────────────────────────────────────────

async function strayTick() {
  const c = cat();
  if (!c) return;

  // Belt and braces against trap #5 in the plan: somebody dragging the cat out
  // of the den in the dev panel writes a home override that beats the authored
  // home on the next boot, and hiding silently stops working forever. Warn once.
  if (c.home_zone !== DEN_ZONE && !S._warnedHome) {
    S._warnedHome = true;
    console.warn(`[strays] ${CAT_ID}.home_zone is "${c.home_zone}", expected "${DEN_ZONE}" — hiding won't work. See docs/systems-strays.md.`);
  }

  if (isSurfaced()) {
    // Checked before anything else, and on every beat rather than only on
    // arrival: `search`, `call` and a follow can all put her in a room she never
    // chose, and a twice-over killer can walk in at any point. This is the one
    // catch-all — the zone.entered handler below is the same rule fired early so
    // it doesn't take up to 30 seconds to notice.
    const spooker = await repeatKillerIn(S.zoneId);
    if (spooker) return spookedBy(spooker);

    const stillWatched = (getZonePlayers(S.zoneId) || []).length > 0;
    if (!stillWatched || Date.now() > S.surfacedUntil) return despawn();
    if (Math.random() < BEHAVE_CHANCE) await behave();
    return;
  }

  if (c._dead) return;
  if (Date.now() < await hiddenUntil()) return;
  if (Date.now() - S.lastSurfaceAt < S.nextQuietMs) return;

  // Candidate rooms: in the lane, and with somebody in them who it is willing to
  // be seen by. A room containing only people who have killed it is not a
  // candidate at all — surfacing there just to bolt would burn the whole quiet
  // timer on a non-event.
  // A room holding somebody she has already bolted from twice is not a candidate
  // at all — she would surface and immediately hiss and run, burning the quiet
  // timer to stage her own exit.
  const candidates = [];
  for (const zoneId of LANE_ZONES) {
    const players = getZonePlayers(zoneId) || [];
    if (!players.length) continue;
    if (await repeatKillerIn(zoneId)) continue;
    let willing = false;
    for (const p of players) {
      if (await moodToward(p, CAT_ID) !== 'flee') { willing = true; break; }
    }
    if (willing) candidates.push(zoneId);
  }
  if (!candidates.length) return;

  // Bias away from wherever it was last seen, so it moves around the lane.
  const fresh = candidates.filter((z) => z !== S.zoneIdLast);
  const pool = fresh.length ? fresh : candidates;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  S.zoneIdLast = pick;
  surface(pick);
}

// ─── `pet` ─────────────────────────────────────────────────────────────────
//
// This claims the pet (returns a response object) rather than letting the
// engine's wholesome default run, because the default line is generic and this
// is the one animal in the game the line is about. Claiming means the engine
// does NOT emit npc.petted, so we emit it ourselves — exactly once, on the same
// success condition. If you ever stop claiming, delete the emit or it doubles.

const PET_LINES = {
  wary: 'You crouch, slowly, and put a hand out. The cat considers it for a long moment, then walks under it and lets you scratch its ears. The purr starts up like a small badly-tuned engine.',
  neutral: 'The cat recognises you. It comes over without being coaxed, headbutts your palm, and settles into being scratched with its eyes shut.',
  seek: 'The cat is already on its way over before your hand is down. It leans its whole weight into your fingers, purring, tail up, entirely yours for as long as this lasts.',
};

const PET_PAW = [
  "The steel paw rests on your wrist. It's warmer than you expected.",
  "One paw kneads your sleeve. The other one just presses, evenly, over and over, because that's all it knows how to do.",
  'Somewhere under the fur a small motor is running in time with the purr.',
];

// ── The refusal ladder ─────────────────────────────────────────────────────
//
// A killer who keeps reaching for it gets a worse answer each time, and the
// ladder is the animal's, not the game's: warn, then defend, then leave. That
// order is the whole characterisation. A cat that bit you the first time would
// be vicious; a cat that never escalated would be scenery.
//
//   kills 1, attempt 1   -> hiss     a warning, and it is a real one
//   kills 1, attempt 2+  -> bite     you were warned; this is self-defence
//   kills 2+             -> bolt     it does not warn you and does not defend
//                                    itself, it simply stops being available
//
// Killing it twice is the point at which it stops treating you as a person it
// has a problem with and starts treating you as weather. There is no rung above
// this one, deliberately: the animal never becomes hostile, never hunts you,
// never gets a revenge arc. It just goes.
//
// A refusal must never NAME the thing. Not "you killed it", not "it remembers",
// not "after what you did". The player knows exactly why. The game saying it out
// loud turns a cold shoulder into a lecture, and the cold shoulder is worse.
// regress.js checks every line below, not just whichever one was rolled.

const HISS_LINES = [
  'The cat comes up off the ground in one motion, ears flat, and hisses at you. It holds it, without blinking, until you take your hand back.',
  "You get within a foot of it. The sound it makes isn't a noise a pet makes. Its whole body has gone hard and low and the steel paw is set flat against the ground.",
  "The cat hisses, once, and doesn't run. It's telling you something quite clearly and it's only going to tell you the once.",
];

const BITE_LINES = [
  'You were told. The cat takes your hand hard enough to grate on bone, twists, and is gone before you have finished swearing.',
  "It doesn't hiss this time. It goes straight for the web of your thumb, and the steel paw braces on your wrist to get the leverage.",
  'The bite is quick, deep and entirely deliberate, and it lets go the instant it has made its point.',
];

const BOLT_LINES = [
  "The cat sees you and leaves. No hiss, no bristle, nothing to argue with. It's simply not in the lane any more.",
  "It's gone the moment you move toward it, at a flat unhurried run, without ever having looked directly at you.",
  "There's a scrabble of claws on hardstand going the other way, and then the lane is empty. It didn't stay to make a point.",
];

const BITE_DMG_MIN = 2;
const BITE_DMG_RANGE = 3;   // 2-4 HP. Enough to be a real answer, never a threat.

// Pet attempts by a killer, this session. RAM on purpose: forgetting the ladder
// on restart costs one extra hiss, and the durable fact (the kill count) is the
// flag that decides which ladder you are on in the first place.
const refusalAttempts = new Map(); // playerId -> count

async function onPetAttempt({ player, npc, zoneId, broadcast }) {
  if (npc?.id !== CAT_ID) return undefined;   // not our animal — fall through

  const mood = await moodToward(player, CAT_ID);

  if (mood === 'flee') {
    // It does not scold you and nobody comments. Never state why — the player
    // knows why. See the refusal-ladder comment above the line tables.
    const kills = await killsBy(player);

    // Twice. It stops treating you as a person it has a problem with.
    if (kills >= 2) {
      sendToZone(zoneId, { type: 'zone_event', message: `The cat leaves the moment ${player.handle} moves toward it.` }, player.id);
      if (isSurfaced()) despawn('The lane is empty. Whatever was here has gone.');
      return { type: 'output', message: pick(BOLT_LINES) };
    }

    const attempt = (refusalAttempts.get(player.id) || 0) + 1;
    refusalAttempts.set(player.id, attempt);

    // First time: a warning, and a real one.
    if (attempt === 1) {
      sendToZone(zoneId, { type: 'zone_event', message: `The cat hisses at ${player.handle}, flat to the ground.` }, player.id);
      return { type: 'output', message: pick(HISS_LINES) };
    }

    // You were warned. This is self-defence, not malice, and it is over at once.
    // FLOORED AT 1, NEVER 0. A cat must not be able to kill a player: that would
    // route a `pet` command into the whole death path (corpse, gear, respawn,
    // wanted-state) and it would be absurd besides. The bite is an answer, not a
    // threat. Do not "fix" this to match the ordinary damage helpers.
    const dmg = BITE_DMG_MIN + Math.floor(Math.random() * BITE_DMG_RANGE);
    const hp = Math.max(1, (player.hp || 1) - dmg);
    player.hp = hp;
    query('UPDATE players SET hp=$1 WHERE id=$2', [hp, player.id]).catch(() => {});

    sendToZone(zoneId, { type: 'zone_event', message: `The cat bites ${player.handle} and vanishes.` }, player.id);
    if (isSurfaced()) despawn("It doesn't stay to see what happens next.");

    return {
      type: 'output',
      message: pick(BITE_LINES),
      player_update: { hp },
    };
  }

  const { paid } = await recordPet(player, CAT_ID);

  if (paid) {
    const applied = adjustSanity(player, PET_SANITY, 'the stray in Dray Lane');
    if (applied) {
      query('UPDATE players SET sanity=$1 WHERE id=$2', [player.sanity, player.id]).catch(() => {});
    }
  }

  // Petting buys it a little longer above ground.
  if (isSurfaced()) S.surfacedUntil = Math.max(S.surfacedUntil, Date.now() + PET_EXTEND_MS);

  if (broadcast) {
    broadcast(zoneId, { type: 'zone_event', message: `${player.handle} crouches down and pets the cat.` }, player.id);
  }

  emit('npc.petted', { actor: player, npc, zoneId });

  const body = PET_LINES[mood] || PET_LINES.wary;
  const paw = pick(PET_PAW);
  return { type: 'output', message: `${body}\n${paw}` };
}

// ─── `attack` ──────────────────────────────────────────────────────────────
//
// Deliberately no gate. flags.no_attack would make this a statue with a
// personality, and the whole weight of the feature is that killing it is easy,
// permitted, and yours.

const DEATH_LINE = "It doesn't make a sound. The bionic paw keeps twitching for a while after the rest of it stops.";

const BYSTANDER_LINES = [
  "Somebody further down the lane says, quietly, 'What the hell is wrong with you.'",
  'Nobody says anything. Somebody turns their back and keeps it turned.',
  'A shutter comes down somewhere behind you, earlier than it needed to.',
];

function onKilled(payload) {
  const npc = payload?.npc;
  if (npc?.id !== CAT_ID && npc?.flags?.stray_cat !== true) return;

  // ── SYNCHRONOUS, FIRST, BEFORE ANY await ─────────────────────────────────
  // combat.js has just set _respawnAt to now + 60s. If an await lands between
  // here and this line, npcWanderTick can fire in the gap and put the cat back
  // in the world a minute after it died, and the entire 24-hour grief window
  // silently becomes one minute. This is the single most fragile line in the
  // plugin. regress.js asserts it.
  const live = world.npcs.get(CAT_ID);
  if (live) {
    live._respawnAt = Date.now() + HIDE_MS;
    live.home_zone = DEN_ZONE;
  }
  S.zoneId = null;
  S.surfacedUntil = 0;

  // Everything else is best-effort. emit() is fire-and-forget, so a throw in
  // here is swallowed by the bus — the hide must never be lost because a sanity
  // write failed.
  finishKill(payload).catch((e) => console.error(`[strays] kill handler: ${e.message}`));
}

async function finishKill({ actor, npc }) {
  await setHiddenUntil(Date.now() + HIDE_MS);

  const zoneId = actor?.current_zone;
  if (zoneId) sendToZone(zoneId, { type: 'zone_event', message: DEATH_LINE });

  if (actor) {
    await recordKill(actor, CAT_ID);
    if (adjustSanity(actor, KILL_SANITY, 'you killed the stray')) {
      query('UPDATE players SET sanity=$1 WHERE id=$2', [actor.sanity, actor.id]).catch(() => {});
    }
  }

  if (!zoneId) return;

  const witnesses = (getZonePlayers(zoneId) || []).filter((p) => p.id !== actor?.id);
  for (const p of witnesses) {
    if (adjustSanity(p, WITNESS_SANITY, 'you watched that')) {
      query('UPDATE players SET sanity=$1 WHERE id=$2', [p.sanity, p.id]).catch(() => {});
    }
    sendToPlayer(p.id, { type: 'output', message: "You watch the whole thing. You'll be able to hear it again later, when you're trying to sleep." });
  }

  // The street's memory. Sync and query-free — flushed by the existing relations
  // path, so this adds no round trips no matter how busy the room is.
  const bystanders = (getZoneNpcs(zoneId) || []).filter((n) => n && n.id !== CAT_ID && !n._dead);
  if (bystanders.length) {
    const present = getZonePlayers(zoneId) || [];
    for (const p of present) {
      for (const n of bystanders) {
        adjustRelation(p, n.id, { warmth: WITNESS_WARMTH, reason: 'killed the stray' });
      }
    }
    sendToZone(zoneId, { type: 'zone_event', message: pick(BYSTANDER_LINES) });
  }
}

// ─── `search` ──────────────────────────────────────────────────────────────
//
// A player who has killed it ALWAYS gets the search plugin's ordinary failure
// prose. The cat is right there and will not be found by them. This is never
// stated anywhere, in any message, and no NPC ever explains it.

const perPlayerSearch = new Map(); // playerId -> epoch ms
const SEARCH_COOLDOWN_MS = 5 * 60_000;

async function searchForCat({ player, zoneId, margin }) {
  if (!LANE_SET.has(zoneId)) return null;
  if (isSurfaced()) return null;            // already out; nothing to find
  const c = cat();
  if (!c || c._dead) return null;
  if (Date.now() < await hiddenUntil()) return null;
  if (margin < 6) return null;
  if (Date.now() - (perPlayerSearch.get(player.id) || 0) < SEARCH_COOLDOWN_MS) return null;
  if (await moodToward(player, CAT_ID) === 'flee') return null;

  perPlayerSearch.set(player.id, Date.now());

  const found = surface(zoneId, `Behind the crates, something small and grey decides ${player.handle} isn't worth hiding from any more. It steps out into the lane. One of its front paws isn't a paw.`);
  if (!found) return null;

  emit('stray.found', { actor: player, npcId: CAT_ID, zoneId });
  return {
    found: true,
    priority: 50,
    message: 'You go through the gap behind the crates and find yourself being looked at, from about ankle height, by something that was already there.',
  };
}

// ─── Calling her ───────────────────────────────────────────────────────────
//
// You do not type a verb. You shout her name: `Cathode!` or `Here Cathode!`.
// That is an INPUT MATCHER rather than a command because it isn't a command —
// there is no verb `cathode`, there is a person in a street saying a name out
// loud, and the game should understand that and nothing else.
//
// `call cathode`, `summon cathode` and `pspsps` work too, and the reason they
// can is worth writing down, because the obvious version of this is a bug.
//
// SIFT DOES NOT ARBITRATE VERBS. It resolves which TARGET you meant among
// several candidates; verb ownership is the plugin loader, one plugin per name,
// and a second claimant logs a collision and one of them silently loses. Bare
// `call` and `summon` belong to gametable (poker: check/call/raise/fold). If
// this plugin claimed either, poker would lose a verb at the table and nothing
// would tell the player why.
//
// So every pattern below except `pspsps` CARRIES HER NAME. `call cathode` is
// unambiguous and cannot be a poker action; bare `call` never reaches this file
// and still folds a hand. Input matchers run before command routing
// (commands/index.js — fireInputMatchers at :294, fireCommand at :297), which is
// what makes the named form win without taking the verb away from anybody.
// `pspsps` is claimed outright because nothing in the game owns it and nothing
// ever will.
//
// SPAMMING DOES NOT HELP, AND THE CODE HAS TO MEAN IT. There is deliberately no
// streak counter, no pity timer, no "you've called six times so she's due". The
// per-call chance is FLAT. If you add an escalating bonus here you have built a
// slot machine with a 60-second lever, and the correct strategy becomes standing
// in an alley shouting at nothing for an hour — which is both grim and exactly
// what the rarity is supposed to prevent.
//
// The 60s cooldown alone would not deliver "rare" against a patient player: an
// hour of shouting is ~60 rolls, and any workable chance turns that into a
// reliable summon. So there are TWO gates — the 60s between attempts (the ask),
// and a much longer cooldown after she ACTUALLY COMES. She is not a taxi.
//
// The relationship is the only thing that moves the number, which is the whole
// point of the feature: a stranger shouting a cat's name is ignored roughly as
// often as in life.

// "Cathode!" / "Here Cathode!!" / "call cathode" / "summon cathode" / "pspsps"
// (and psps, pspspsps, … — nobody types that the same way twice).
const CALL_RE = /^\s*(?:(?:here|call|summon)[,!\s]+)?cathode\s*[!.?]*\s*$|^\s*ps(?:ps)+s?\s*[!.?]*\s*$/i;

const CALL_COOLDOWN_MS  = 60_000;        // between attempts. The user's spec.
const CALL_ANSWERED_MS  = 45 * 60_000;   // after she actually turns up.

const CALL_CHANCE = { wary: 0.04, neutral: 0.09, seek: 0.20 };

const lastCall     = new Map(); // playerId -> epoch ms of last attempt
const lastAnswered = new Map(); // playerId -> epoch ms she last came

// The miss is the common case and must never hint. You cannot tell "she is three
// streets away" from "she is dead" from "she heard you and did not care", and
// that is correct: you are shouting a cat's name in a city.
const CALL_MISSES = [
  'You call her. A shutter rattles somewhere. Nothing with four legs takes any notice of you at all.',
  'Your voice goes off down the street and comes back slightly changed. No cat.',
  'Nothing. Somebody two doors down laughs at you, which is fair.',
  'You call. The city continues doing what it was doing.',
  "A pigeon leaves. That's the entire response.",
];

const CALL_HITS = [
  "It takes a moment. Then there's a click of metal on stone somewhere behind you, unhurried, getting closer, and she walks out into the open like she has been looking for you rather than the other way round.",
  'She comes round the corner at a trot with her tail up, as though you had an appointment and she is slightly late for it.',
  "Something drops off a wall you didn't know was climbable, lands wrong on one steel foot, recovers its dignity instantly, and sits down in front of you.",
];

function inTheCity(zone) {
  if (!zone) return false;
  if (world.transientZones.has(zone.id)) return false;   // void rooms, dreams
  return zone.flags?.region_id === 'region_coldwater';
}

async function onCalled(args, raw, player, broadcast) {
  const zoneId = player.current_zone;
  const zone = getZone(zoneId);

  // Everyone hears you do it, wherever you are and whatever happens next.
  broadcast(zoneId, { type: 'zone_event', message: `${player.handle} calls for a cat.` }, player.id);

  if (Date.now() - (lastCall.get(player.id) || 0) < CALL_COOLDOWN_MS) {
    return { type: 'output', message: "You just called. Give it a minute; she isn't deaf, she is ignoring you." };
  }
  lastCall.set(player.id, Date.now());

  const miss = { type: 'output', message: pick(CALL_MISSES) };

  if (!inTheCity(zone)) return miss;      // she has never left Coldwater
  if (isSurfaced()) return miss;          // already out; not a teleport
  const c = cat();
  if (!c || c._dead) return miss;
  if (Date.now() < await hiddenUntil()) return miss;
  if (Date.now() - (lastAnswered.get(player.id) || 0) < CALL_ANSWERED_MS) return miss;

  const mood = await moodToward(player, CAT_ID);
  if (mood === 'flee') return miss;       // she is there. she will not come. never said.

  // FLAT. See the header.
  if (Math.random() >= (CALL_CHANCE[mood] ?? 0.04)) return miss;

  lastAnswered.set(player.id, Date.now());
  if (!surface(zoneId, pick(CALL_HITS))) return miss;
  emit('stray.called', { actor: player, npcId: CAT_ID, zoneId });
  return { type: 'output', message: 'She came.' };
}

// ─── Following a regular ───────────────────────────────────────────────────

async function onZoneEntered({ actor, zone }) {
  if (!isSurfaced() || !actor) return;

  // Walked in on her. Fired here as well as on the tick so the answer lands in
  // the same breath as the arrival rather than up to 30 seconds later.
  if (zone === S.zoneId && (await killsBy(actor)) >= REPEAT_KILLS) return spookedBy(actor);

  if (S.followedThisWindow) return;
  if (!LANE_SET.has(zone)) return;
  if (zone === S.zoneId) return;
  if (await moodToward(actor, CAT_ID) !== 'seek') return;

  S.followedThisWindow = true;
  const from = S.zoneId;
  if (!moveNpcToZone(CAT_ID, zone)) return;
  S.zoneId = zone;
  S.zoneIdLast = zone;
  if (from) sendToZone(from, { type: 'zone_event', message: 'The cat gets up and follows them out.', refresh: true });
  sendToZone(zone, { type: 'zone_event', message: `The cat trots in after ${actor.handle}, tail up, entirely unbothered about being seen doing it.`, refresh: true });
}

// ─── Wiring ────────────────────────────────────────────────────────────────

on('npc.killed', onKilled);
on('zone.entered', (p) => { onZoneEntered(p).catch(() => {}); });

registerInputMatcher(CALL_RE, (args, raw, player, broadcast) => onCalled(args, raw, player, broadcast), 'strays');

schedule('30s', () => { strayTick().catch((e) => console.error(`[strays] tick: ${e.message}`)); });

export const hooks = {
  'npc.petAttempt': onPetAttempt,
  'search.provider': searchForCat,
};

export const _test = {
  S, cat, surface, despawn, strayTick, behave, buildCtx,
  onKilled, finishKill, onPetAttempt, searchForCat, onZoneEntered,
  hiddenUntil, setHiddenUntil, isSurfaced,
  BEHAVIOURS, pickBehaviour,
  HISS_LINES, BITE_LINES, BOLT_LINES, refusalAttempts,
  repeatKillerIn, spookedBy, REPEAT_KILLS, SPOOK_YOU, SPOOK_ROOM,
  onCalled, CALL_RE, CALL_MISSES, CALL_HITS, CALL_CHANCE, CALL_COOLDOWN_MS,
  CALL_ANSWERED_MS, lastCall, lastAnswered, inTheCity,
  HIDE_MS, HIDDEN_FLAG, PET_SANITY, KILL_SANITY, WITNESS_SANITY, WITNESS_WARMTH,
  PET_COOLDOWN_MS, GIFT_PETS, SEARCH_COOLDOWN_MS, perPlayerSearch,
};

console.log('[strays] Plugin loaded.');
