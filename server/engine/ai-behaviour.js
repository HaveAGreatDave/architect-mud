import { world, getLivePlayer, doorOnLink, setDoorCache, getZone, getZonePlayers, getPlayerMembership, isEnterableFacade, frontDoorOf, getMapByParentZone, resolveLanding, updateNpc } from './world.js';
import { isSanctuary, isDwellingZone } from './zone-tags.js';
import { lockTypePassesWhileLocked } from './locks.js';
import { zoneDanger, DANGER_RANK } from './danger.js';
import { allExits, neighborZoneIds, exitTargets } from './exits.js';
import { findPath as findPathRaw, getZonesInRadius } from './pathfinding.js';
import { enemyAttackPlayer, enemyAttackNpc, enemyAttackEnemy, pressingAttacker, mobFleeRoll } from './combat.js';
import { getEnvironmentState } from './environment.js';
import { gameMsToReal } from './gametime.js';
import { dispatchAction } from './actions.js';
import { isNpcScheduledNow, getNpcStudioZone, isZoneWatched, npcNextShiftInMins } from './broadcast-bridge.js';
import { getShopperForNpc, closeShopSession, didBuyThisSession } from './vendor-session.js';
import { getNpcChitchat } from './npc-personality.js';
import { setPosture, forceStand } from './posture.js';
import { npcWashAtHome } from './hygiene.js';
import { on, emit } from './events.js';

// Breaking contact to flee is a competence check, not a given. An entity's flee
// skill (`flags.flee_skill`, else its combat `dodge`, else 1) is rolled against a
// 2d8−2d8 swing (−14..+14, mean 0); it gets away only if skill + swing clears
// this bar. Tuned so weak early enemies (dodge 1–2) usually botch the break and
// stay cornered, while nimbler things (higher dodge) slip away reliably.
const FLEE_DIFFICULTY = 6;
// A cornered enemy gets one break-away attempt per attack cycle, not one per AI
// tick — otherwise a failed roll spams "can't break away!" several times a second.
const FLEE_RETRY_MS = 4000;
const d8 = () => 1 + Math.floor(Math.random() * 8);

// ── The leash ────────────────────────────────────────────────────────────────
// ROAM is an unbiased random walk over the zone graph: it has no expected return,
// so given a few hours a wanderer ends up anywhere the exits reach. The leash is
// what makes a roaming mob a LOCAL problem, and it's also what makes CHASE safe
// to have at all — an unbounded pursuit is exactly the thing that drags a mob
// across the map.
//
// Deliberately NOT applied to two other movers:
//   PATROL is already bounded by its authored waypoints. A radius on top would
//          break legitimate long routes.
//   FLEE   has one job — break contact. Filtering its exits by leash corners a
//          fleeing mob against its own leash and hands the player a free kill on
//          something the design says should get away. It clears targetId, and the
//          next ROAM beat walks it home. Flee first, leash afterwards.
const LEASH_RADIUS = 12;

// Chebyshev tiles from the spawn tile. Three intents, three values — 0 must mean
// PINNED rather than disabled, because zero is the obvious way to write "never
// leaves its tile" and overloading it as the off-switch makes the tightest
// possible leash silently do the opposite:
//   undefined -> LEASH_RADIUS       (the default)
//   -1        -> unleashed          (an authored world-wanderer)
//   0         -> pinned to its tile
//   1..n      -> that many tiles
// Never write `Number(f) || LEASH_RADIUS` here: that maps both 0 and undefined to
// the default and makes pinning impossible to express.
function leashRadius(entity) {
  const f = entity?.flags?.leash_radius;
  if (f === undefined || f === null) return LEASH_RADIUS;
  const n = Number(f);
  return Number.isFinite(n) ? n : LEASH_RADIUS;
}

// O(1) distance from a mob's spawn tile. The leash runs on every roaming and
// chasing instance, and enemies tick at 1 Hz, so this must never BFS —
// getZonesInRadius is the right tool for CALL_BACKUP's rare event and the wrong
// one here. Chebyshev rather than Manhattan because the map is 8-connected, so
// Chebyshev IS hop count on open ground and a radius reads as "N tiles".
//
// Infinity means "definitively elsewhere" — a different map (an interior, the
// sewers, a dreamscape), a different floor, or a zone with no grid position at
// all. That's the answer we want: a mob that spawned outdoors and walked into a
// shop IS off its patch.
export function distanceFromSpawn(entity, zoneId) {
  const home = getZone(entity?.spawnZoneId);
  const here = getZone(zoneId);
  if (!home || !here) return Infinity;
  if ((home.map_id || null) !== (here.map_id || null)) return Infinity;
  if ((home.grid_z ?? 0) !== (here.grid_z ?? 0)) return Infinity;
  if (home.grid_x == null || here.grid_x == null) return Infinity;
  if (home.grid_y == null || here.grid_y == null) return Infinity;
  return Math.max(Math.abs(here.grid_x - home.grid_x), Math.abs(here.grid_y - home.grid_y));
}

// Which of these exits the leash actually permits. Same O(exits) the caller was
// already paying, plus a handful of integer ops.
//
// Note the Infinity arithmetic is load-bearing and must not be "cleaned up":
// `Infinity < Infinity` is false but `Infinity <= Infinity` is true, which is
// what makes a mob stranded somewhere ungridded (indoors, off-map) fall through
// to the non-increasing branch and take any exit rather than freezing.
export function leashCandidates(entity, zoneId, exits) {
  const radius = leashRadius(entity);
  if (radius < 0 || !entity?.spawnZoneId) return exits;   // unleashed
  if (radius === 0) return [];                            // pinned to its tile

  const here = distanceFromSpawn(entity, zoneId);
  if (here <= radius) {
    const inside = exits.filter(z => distanceFromSpawn(entity, z) <= radius);
    // Boxed in — every exit leaves the radius. Never freeze a mob over this; a
    // frozen spawn is indistinguishable from a broken one.
    return inside.length ? inside : exits;
  }
  // Outside: only steps that bring it home. Walks the grid gradient without a
  // single BFS. A flat gradient (a wall, a dead end) falls back to anything that
  // doesn't make it worse; if nothing qualifies it stands still this beat.
  const closer = exits.filter(z => distanceFromSpawn(entity, z) < here);
  if (closer.length) return closer;
  return exits.filter(z => distanceFromSpawn(entity, z) <= here);
}

// ── Pursuit ──────────────────────────────────────────────────────────────────
// How long a chaser will keep following without landing a hit. The leash bounds
// pursuit in SPACE; this bounds it in TIME, so a mob can't shadow a player around
// inside its own radius indefinitely.
const CHASE_TIMEOUT_MS = 20000;
// Enemies tick at 1 Hz, so an unthrottled chase steps once a second and outruns a
// walking player. At 2s a walk cannot break contact but run mode can — which is
// what makes running a decision rather than a formality. Per-enemy override:
// flags.chase_speed_s.
const CHASE_INTERVAL_MS = 2000;

function chaseIntervalMs(entity) {
  const s = Number(entity?.flags?.chase_speed_s);
  return Number.isFinite(s) && s > 0 ? s * 1000 : CHASE_INTERVAL_MS;
}

// Does this creature's graph pursue? Cached per instance because it's a property
// of the template, not of the moment — and because ATTACK consults it on the
// combat hot path. A creature with no CHASE node keeps the historical behaviour of
// dropping its target the instant the player leaves the room, so every enemy that
// shipped before pursuit existed is bit-for-bit unchanged.
export function canChase(entity) {
  if (entity._canChase === undefined) {
    const nodes = entity.behaviour_graph?.nodes;
    entity._canChase = !!nodes && Object.values(nodes).some(n => n?.action_type === 'CHASE');
  }
  return entity._canChase;
}

// Where the current target is standing, whatever kind of thing it is. Returns null
// if the target is gone, dead, or logged out — every caller treats that as "drop".
// ATTACK's "target isn't here any more" branch. A non-chaser forgets you the
// instant you leave the room, exactly as it always has. A chaser KEEPS the target
// so its CHASE node has something to follow — that one distinction is the whole
// difference between the world before pursuit and after it.
function forgetsAbsentTarget(entity) {
  return !canChase(entity);
}

function quarryZone(id) {
  if (!id) return null;
  const e = world.enemies.get(id);
  if (e) return e._dead ? null : e.zoneId;
  const n = world.npcs.get(id);
  if (n) return n._dead ? null : n.zone_id;
  const p = getLivePlayer(id);
  return p ? p.current_zone : null;
}

// ── NPC lock-up law ──────────────────────────────────────────────────────────
// An NPC securing a home or shutting up shop is the only lock in the game that
// engages with nobody's hand on it, which makes it the only one that can shut a
// door on a player who never touched it. Three rules keep that honest:
//
//   1. A MANUAL BOLT IS NEVER AUTO-ENGAGED. A privacy latch (passWhileLocked
//      false) has to be physically slid open to pass, from the inside, by the
//      person who set it — exactly the wrong lock to throw on a room somebody
//      might be standing in. It's also the bathroom lock: every ensuite and
//      washroom door in the world is `lock:privacylock`, so a resident walking
//      home past their own ensuite used to bolt the toilet shut behind them.
//   2. The lock records WHICH SIDE IS INSIDE (`_autoLockedInside`), so the move
//      gate can let a player walk out of a shop that closed around them. Out,
//      never in — the closed sign still means closed.
//   3. Residents come and go freely; that's handled on both sides — NPCs by the
//      ownsThisDoor/residentOfThisBuilding tests above, players by the same
//      `_autoLockedInside` marker in the engine:door-lock gate.
function lockTagsOf(door) {
  return Object.keys(door?.tags || {}).filter(k => k.startsWith('lock:'));
}
// A door an NPC may throw on their own: has a lock, and none of them is a bolt
// that would have to be undone by hand from the inside.
function npcAutoLockable(door) {
  const tags = lockTagsOf(door);
  return tags.length > 0 && tags.every(t => lockTypePassesWhileLocked(t));
}
// Mark/clear the "this lock was engaged by an NPC, and this side is indoors"
// note. Runtime-only, like every other field on a door.
function markAutoLock(door, insideZoneId) { door._autoLockedInside = insideZoneId || null; }

// Vendor closing-time farewells — picked when the vendor shuts up shop while a
// player is mid-session. Warm if they bought, needling if they didn't.
const VENDOR_CLOSE_HAPPY = [
  `Hope you're happy with your purchase. Come back soon, yeah?`,
  `Pleasure doing business. Enjoy it while it lasts.`,
  `Good doing business with you. Don't be a stranger.`,
  `That's me done for the day. Thanks for the custom.`,
];
const VENDOR_CLOSE_WHINE = [
  `All that browsing and you buy nothing? Get out, I'm closing.`,
  `Tch. Window shopper. My time's worth more than this.`,
  `Come in, poke around, buy nothing. Story of my life. We're closed.`,
  `Not even one credit? Don't let the door hit you.`,
];

// ── Vendor schedule helpers ──────────────────────────────────────────────────

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Zones an NPC advances toward its workplace per wander tick while commuting.
// >1 keeps far-flung workers from spending most of the morning in transit.
const COMMUTE_STEPS_PER_TICK = 4;

// The cadence npcWanderTick is registered at (gameLoop.js). Kept here as a
// number because the commute departure window has to convert a path length into
// game-minutes, and that conversion is meaningless without knowing how often a
// step actually happens. If you change the schedule() cadence, change this.
const NPC_TICK_SECONDS = 15;
// Tiles a commuter covers per REAL minute. The game clock runs at
// state.timeScale game-minutes per real minute, so the conversion to the
// game-minutes the schedule is written in happens at the call site.
const COMMUTE_TILES_PER_REAL_MIN = COMMUTE_STEPS_PER_TICK * (60 / NPC_TICK_SECONDS);

// How long after a missed arrival an NPC still bothers turning up, in GAME
// minutes. Only consulted for NPCs whose arrive_by params have no schedule
// behind them — where a schedule exists it answers "should I be there now?"
// directly and this constant is not used. 4 hours: long enough to cover a
// restart or a locked door during the morning, short enough that an NPC who
// missed a shift entirely doesn't wander in at midnight for it.
const LATE_CATCHUP_GRACE_MINUTES = 240;

/**
 * Check whether a vendor NPC should be working right now.
 * Returns { working, dayHasSchedule, referenceRange }
 *   working        — true if current hour falls in a scheduled block today
 *   dayHasSchedule — true if today has any scheduled blocks at all
 *   referenceRange — on a day-off, the first block of the most recent scheduled day
 *                    (used for HAVE_LIFE hours on off-days); null if none found
 */
export function isVendorWorkTime(npc, env) {
  const schedule = npc.vendor_schedule || {};
  const dayOfWeek = env.dayOfWeek; // 1=Mon … 7=Sun (ISO)
  const hour = env.hour ?? 0;

  // Convert ISO dayOfWeek (1=Mon…7=Sun) to our DAY_KEYS index (0=Sun…6=Sat)
  const todayIdx = dayOfWeek % 7; // 1→1(Mon)…6→6(Sat)…7→0(Sun)
  const todayKey = DAY_KEYS[todayIdx];
  const todayBlocks = schedule[todayKey] || [];

  const dayHasSchedule = todayBlocks.length > 0;

  const inBlock = (blocks, h) => blocks.some(b => h >= (b.from ?? 0) && h < (b.to ?? 24));

  if (dayHasSchedule) {
    return { working: inBlock(todayBlocks, hour), dayHasSchedule: true, referenceRange: null };
  }

  // Day off — look back up to 6 days for the most recent scheduled day
  for (let i = 1; i <= 6; i++) {
    const idx = ((todayIdx - i) + 7) % 7;
    const blocks = schedule[DAY_KEYS[idx]] || [];
    if (blocks.length) {
      return { working: false, dayHasSchedule: false, referenceRange: blocks[0] };
    }
  }

  return { working: false, dayHasSchedule: false, referenceRange: null };
}

// True when a scheduled vendor is currently off-shift and should refuse to trade.
// Vendors with no `vendor_schedule` trade around the clock (returns false).
// Covert dealers are exempt outright: their trading window is owned by the dealer
// plugin's deal_from/deal_to (which wraps midnight, unlike vendor_schedule), so a
// schedule left on one would silently close the shop mid-window. Reads the live
// game clock so a manual clock jump takes effect immediately.
export function isVendorClosed(npc) {
  if (npc?.flags?.covert) return false;
  if (isVendorAbsent(npc)) return true;
  return isVendorOffHours(npc);
}

// The CLOCK half of isVendorClosed, on its own: off the timetable, never mind
// where they're standing. Absence is deliberately not folded in — a shopkeeper
// walking home mid-shift is absent but not off duty, and the conversation paths
// (unlike the counter) care about the person, not the shutter.
export function isVendorOffHours(npc) {
  if (npc?.flags?.covert) return false;
  const schedule = npc?.vendor_schedule;
  if (!schedule || !Object.keys(schedule).length) return false;
  return !isVendorWorkTime(npc, getEnvironmentState()).working;
}

// Does this NPC actually SELL something? `vendor_schedule` is carried by every
// employed NPC (it's the commute timetable), so it alone can't be the test —
// gating dialogue on it would silence half the city after dark. A shop is stock
// or a shop name.
export function isVendorRole(npc) {
  return !!(npc?.vendor_shop_name || (npc?.vendor_inventory || []).length);
}

// A vendor who commutes is only open once they've actually WALKED IN. The clock
// says when they set off, not when the shutter goes up: a shopkeeper who is late,
// stuck behind a firefight, or has stepped out mid-shift leaves a shop that isn't
// trading, matching the door — which already unlocks on arrival and locks on the
// way out (see the shop-door block in the movement hook).
// Only applies to vendors with a work_zone_id; an immobile stallholder without one
// keeps the old pure-clock behaviour, so nothing that never commutes changes.
export function isVendorAbsent(npc) {
  if (!npc?.work_zone_id) return false;
  return entityZone(npc) !== npc.work_zone_id;
}

// Game-hours until this vendor's next scheduled block opens, or null (no schedule,
// or nothing scheduled in the coming week). Same clock + day-keying as
// isVendorWorkTime, so it agrees with whatever just told the player "closed".
export function hoursUntilOpen(npc) {
  const schedule = npc?.vendor_schedule;
  if (!schedule || !Object.keys(schedule).length) return null;
  const env = getEnvironmentState();
  const nowMinutes = env.minutes;
  const todayIdx = env.dayOfWeek % 7; // ISO 1=Mon…7=Sun → DAY_KEYS 0=Sun…6=Sat
  let best = null;
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    for (const block of schedule[DAY_KEYS[(todayIdx + dayOffset) % 7]] || []) {
      const gap = dayOffset * 1440 + (block.from ?? 0) * 60 - nowMinutes;
      if (gap > 0 && (best === null || gap < best)) best = gap;
    }
    if (best !== null) break; // the earliest block on the first day that has one wins
  }
  return best === null ? null : best / 60;
}

// "about 3 hours" / "about 20 minutes" — the wait an off-shift vendor quotes you.
// Empty string when they have no schedule to quote from.
export function openInPhrase(npc) {
  const h = hoursUntilOpen(npc);
  if (h == null) return '';
  if (h < 1) { const m = Math.max(1, Math.round(h * 60)); return `about ${m} minute${m === 1 ? '' : 's'}`; }
  const r = Math.round(h);
  return `about ${r} hour${r === 1 ? '' : 's'}`;
}

// The line an off-the-clock vendor gives when a player tries to shop/buy/sell.
// Covert sellers don't do customer service hours — they just stop knowing you.
export function vendorClosedLine(npc) {
  const name = npc?.name || 'The vendor';
  if (npc?.flags?.covert) return `${name} looks straight through you. "Wrong time. Walk on."`;
  // Absent rather than off-shift: nobody is behind the counter to say a line, and
  // quoting the next scheduled block would be a lie if they're merely running late.
  if (isVendorAbsent(npc)) {
    const working = !npc.vendor_schedule || isVendorWorkTime(npc, getEnvironmentState()).working;
    return working
      ? `The counter is empty — ${name} hasn't opened up yet.`
      : `The shutter is down. ${name} isn't in.`;
  }
  const when = openInPhrase(npc);
  return when
    ? `${name} shakes their head. "I'm off the clock right now — I open again in ${when}."`
    : `${name} shakes their head. "I'm off the clock right now — come back during business hours."`;
}

// The brush-off an off-the-clock vendor gives when a player tries to open their
// dialogue tree. Unlike vendorClosedLine this is said FACE TO FACE — you're
// standing in front of them, wherever they happen to be — so it never talks
// about empty counters or shutters.
export function vendorOffHoursLine(npc) {
  const name = npc?.name || 'The vendor';
  const when = openInPhrase(npc);
  return when
    ? `${name} waves you off. "Not now — I'm off the clock. Back in ${when}."`
    : `${name} waves you off. "Not now — I'm off the clock."`;
}

// ── Chitchat ────────────────────────────────────────────────────────────────

export const DEFAULT_CHITCHAT_LINES = [
  'mutters something about the radiation levels.',
  'checks a flickering wrist terminal.',
  'cracks their knuckles.',
  'hums an off-key tune.',
  'glances at the nearest exit.',
  'adjusts their collar.',
  'stares blankly at the wall for a moment.',
  'mumbles a complaint about the recycled air.',
  'taps a foot impatiently.',
  'sighs and checks the time.',
  'scratches at an old scar.',
  'cracks a thin, joyless smile.',
];

const DEFAULT_HOME_ACTIVITIES = [
  'putters around the apartment, tidying up.',
  'stares out the window at the neon-lit streets below.',
  'microwaves something that smells questionable.',
  'flips through channels on a battered holoscreen.',
  'does a few half-hearted push-ups.',
  'rummages through a cabinet looking for something.',
  'leans against the wall, staring at nothing.',
  'pours a drink and takes a long sip.',
  'stretches and cracks their neck.',
  'sits on the edge of the bed and checks their terminal.',
  'mutters to themselves and shuffles to the kitchen.',
  'taps at a broken light fixture without fixing it.',
];

// What a person is like in the first half-hour after somebody woke them up. Used
// by the passive home-life ticker instead of the NPC's own activities, so being
// woken has a visible tail rather than being one line and then business as usual.
const WOKEN_ACTIVITIES = {
  annoyed: [
    'bangs around the kitchen with unnecessary volume, making a point.',
    'glares at the bed like it personally let them down.',
    'mutters about people who have no consideration for anyone.',
    'pours something, drinks it standing up, and glares at nothing.',
    'rubs their face hard with both hands and audibly gives up on going back to sleep.',
  ],
  confused: [
    'stands in the middle of the room for a moment, working out which day this is.',
    'checks the time, checks it again, and looks no happier for it.',
    'blinks slowly, still mostly somewhere else.',
    'drifts toward the kitchen, forgets why, and stops.',
    'sits down heavily on the edge of the bed and stares at the floor.',
  ],
};

// Returns the real (wall-clock) ms timestamp to wake up before the next scheduled
// shift, or null. The shift schedule is keyed to GAME day-of-week + game hours —
// the same clock isVendorWorkTime reads — so the gap is computed in game-minutes
// and converted to real ms via the game-speed knob. (Previously it walked the real
// calendar, which desynced from the game clock at any speed ≠ 1×.)
function getNextShiftWakeMs(entity) {
  const schedule = entity.vendor_schedule;
  const env = getEnvironmentState();
  const nowMinutes = env.minutes;             // game minute-of-day, 0..1439
  const todayIdx = env.dayOfWeek % 7;         // ISO 1=Mon…7=Sun → 0=Sun…6=Sat (DAY_KEYS)
  const WAKE_LEAD_MIN = 60;                    // wake one game-hour before the shift
  // Mirrors STAFF_CALL_LEAD_REAL_MIN in plugins/broadcast — kept as a local rather than
  // imported, because the engine must not depend on a plugin. A few minutes more than the
  // plugin's own lead, so the cast are awake before they're called, not as they're called.
  const STUDIO_CALL_LEAD_REAL_MIN = 15;
  const MIN_GAP_MIN = 2;                       // ignore shifts essentially upon us

  // gap = game-minutes from now until the wake moment; convert to a real deadline.
  const realDeadline = (gapGameMin) => Date.now() + gameMsToReal(gapGameMin * 60_000);

  // Broadcast cast are not vendors and have no `vendor_schedule` — their timetable lives in
  // the channel playlist, reachable only through the broadcast bridge. Without this, a studio
  // NPC read as "no schedule" and fell through to the 07:00 default: the host of a 22:00 talk
  // show who dozed off at home in the evening was parked on waitUntil until the next MORNING
  // and slept through his own taping, while the show aired to an empty desk. Take whichever
  // wake-up comes first, so an NPC with both a counter shift and a studio call makes both.
  let soonestGap = null;
  const consider = (gapGameMin) => {
    if (gapGameMin > MIN_GAP_MIN && (soonestGap === null || gapGameMin < soonestGap)) soonestGap = gapGameMin;
  };

  if (schedule && Object.keys(schedule).length) {
    for (let dayOffset = 0; dayOffset <= 6; dayOffset++) {
      const blocks = schedule[DAY_KEYS[(todayIdx + dayOffset) % 7]] || [];
      for (const block of blocks) {
        const wakeMin = (block.from ?? 10) * 60 - WAKE_LEAD_MIN;
        consider(dayOffset * 1440 + wakeMin - nowMinutes);
      }
    }
  }

  // Minutes until this NPC is next due on air (0 = on shift right now, null = staffed on
  // nothing that airs). Sync + in-memory by the bridge's contract, safe on this path.
  // A STUDIO CALL IS NOT MEASURED IN THE SAME CURRENCY AS A COUNTER SHIFT. The vendor
  // lead above is one GAME hour, which is fine because a shop's opening time is a game
  // clock fact. An air call is not: the broadcast plugin books its cast in REAL minutes
  // (the walk is real — one hop per 15s tick), so at any brisk timeScale a flat 60 game
  // minutes shrinks to fewer real minutes than the call lead itself and the host wakes
  // up already late for a call that opened before their alarm. Convert the real lead
  // into game minutes at the live clock and take whichever is longer, so this can only
  // ever wake somebody earlier, never later.
  const airGap = npcNextShiftInMins(entity.id);
  if (airGap != null) {
    const airLeadMin = Math.max(WAKE_LEAD_MIN, STUDIO_CALL_LEAD_REAL_MIN * (env.timeScale || 1));
    consider(airGap - airLeadMin);
  }

  if (soonestGap !== null) return realDeadline(soonestGap);
  // Nothing scheduled at all — wake at 07:00 game time (today if still ahead, else tomorrow).
  let gap = 7 * 60 - nowMinutes;
  if (gap <= MIN_GAP_MIN) gap += 1440;
  return realDeadline(gap);
}

// ── Sleep, and being dragged out of it ────────────────────────────────────────
//
// `ai.homeSleeping` is the one flag that means "this NPC is unconscious in their
// own bed". AT_HOME_LIFE sets it; everything that DISTURBS a sleeper goes through
// disturbSleeper() below, so the roll, the wake-up state and the flavour can't
// drift apart across the half-dozen verbs that can reach a sleeping body.
//
// Two things shape the design:
//   • A sleeper is not a light switch. Talking at someone who is out is usually
//     an anticlimax — they mumble and stay under — and it says so, so the player
//     knows the interaction happened and failed rather than doing nothing.
//   • Persistence works. Each disturbance makes the next one likelier to land,
//     so nobody is trapped rolling `talk` at a snoring body forever.

// How long an NPC stays up doing home things before bed is even a consideration,
// and the longest stretch they'll sleep for. Both in GAME minutes: an NPC who
// walks in the door and immediately lies down never has a home life, and one who
// turns in at four in the afternoon because their shift is tomorrow reads as
// broken. Between them these carve the evening into a waking half and a sleeping
// half, which is the entire point.
const HOME_LIFE_MIN_MINS = 90;
const MAX_SLEEP_MINS     = 9 * 60;
// Grace after being woken, so a player who wakes someone gets to talk to them
// rather than watching them lie straight back down on the next tick.
const WOKEN_GRACE_MINS   = 45;

const STAY_ASLEEP_LINES = [
  (n) => `${n} mumbles something shapeless, rolls over, and stays fast asleep.`,
  (n) => `${n} swats vaguely at the air and does not wake up.`,
  (n) => `${n} keeps breathing slow and heavy, entirely untroubled by you.`,
  (n) => `${n} shifts, drags the blanket higher, and sleeps straight through it.`,
  (n) => `${n} frowns in their sleep, says one word of a conversation you aren't part of, and is gone again.`,
];
const WAKE_ANNOYED = [
  (n) => `${n} jolts awake. "What. WHAT. This had better be extremely good."`,
  (n) => `${n} sits up glaring, hair flattened on one side. "Do you have any idea what hour it is?"`,
  (n) => `${n} surfaces with a snarl. "I was ASLEEP. That was the good part of my day and you've had it."`,
  (n) => `${n} wakes all at once and looks at you with the flat, patient hatred of the recently unconscious.`,
];
const WAKE_CONFUSED = [
  (n) => `${n} blinks awake, focuses on nothing in particular, and asks the room who's there.`,
  (n) => `${n} half-sits up, staring at you like you might still be part of the dream.`,
  (n) => `${n} wakes with a start and looks around as if they've forgotten which room this is.`,
  (n) => `${n} comes up muzzy and slow, mouth working on a sentence that hasn't arrived yet.`,
];

export function isNpcAsleep(entity) {
  return !!entity?._ai?.homeSleeping;
}

// Odds the sleeper stays under. A skinful or a downer makes someone very hard to
// shift; a stimulant means they were barely asleep to begin with. Repeated
// disturbance wears it down, which is what stops this being a locked door.
function stayAsleepChance(entity) {
  const ai = entity._ai || {};
  const dose = ai.dose;
  let chance = 0.55;
  if (dose?.out || dose?.loose) chance = 0.9;    // drink and downers: dead to the world
  else if (dose?.wired) chance = 0.15;           // wired: sleeping badly anyway
  chance -= 0.2 * (ai.disturbCount || 0);
  return Math.max(0, Math.min(0.95, chance));
}

/**
 * Someone has interacted with a sleeping NPC.
 *
 * Returns null when the NPC isn't asleep (callers carry on as normal), otherwise
 * `{ woke, mood, message }` — `message` is already broadcast to the room; it is
 * returned so a verb can also answer the actor with it.
 *
 * `force` skips the roll: being hit wakes you up, no dice involved.
 */
export function disturbSleeper(entity, { broadcast = null, force = false } = {}) {
  if (!isNpcAsleep(entity)) return null;
  const ai = entity._ai;
  const zoneId = entityZone(entity);
  const say = (message) => {
    if (broadcast) broadcast(zoneId, { type: 'zone_event', message });
    return message;
  };

  ai.disturbCount = (ai.disturbCount || 0) + 1;
  if (!force && Math.random() < stayAsleepChance(entity)) {
    return { woke: false, mood: null, message: say(pickLine(STAY_ASLEEP_LINES, entity.name)) };
  }

  // Confused rather than annoyed when they were deep under (a dose, or barely
  // any sleep behind them) — you don't get straight to angry from there.
  const deep = !!(ai.dose?.loose || ai.dose?.out)
    || (Date.now() - (ai.sleepStartedAt || 0)) < gameMsToReal(60 * 60_000);
  const mood = deep || Math.random() < 0.35 ? 'confused' : 'annoyed';

  wakeNpc(entity, { mood });
  return {
    woke: true,
    mood,
    message: say(pickLine(mood === 'annoyed' ? WAKE_ANNOYED : WAKE_CONFUSED, entity.name)),
  };
}

function pickLine(pool, name) {
  return pool[Math.floor(Math.random() * pool.length)](name);
}

// The state half of waking up, shared by disturbSleeper and AT_HOME_LIFE's own
// scheduled wake. Clears the sleep, stands the body up, restarts the graph from
// _start, and holds the NPC awake for a while so they don't drop straight back
// down on the next tick.
export function wakeNpc(entity, { mood = null } = {}) {
  const ai = entity._ai;
  if (!ai) return;
  const now = Date.now();
  ai.homeSleeping = false;
  ai.waitUntil = null;
  ai.currentNode = null;
  ai.disturbCount = 0;
  ai.sleepStartedAt = 0;
  ai.homeAwakeSince = now;
  ai.wokenUntil = now + gameMsToReal(WOKEN_GRACE_MINS * 60_000);
  if (mood) ai.wokeMood = { mood, until: ai.wokenUntil };
  try { forceStand(entity, 'woken'); } catch { /* posture best-effort */ }
}

// An assault always wakes the victim — no roll. Lives here rather than in
// panic.js because this module owns the sleep flag, and panic.js deliberately
// skips sleepers when it picks WITNESSES (a different question entirely).
on('npc.attacked', ({ npc }) => {
  try { if (isNpcAsleep(npc)) wakeNpc(npc, { mood: 'annoyed' }); }
  catch (e) { console.error('[ai] wake-on-attack:', e.message); }
});

// Format a chitchat line the same way as enemy battlecries:
//   "quoted text"  → yellow say bubble    e.g. "You need something?"
//   unquoted text  → zone_event emote      e.g. drums fingers on the counter.
// A "says" line is ONLY a line that is a single quoted span end-to-end. A line
// with an action verb outside the quote — `mutters: "..."`, or the over-quoted
// `"mutters: "...""` — is an emote (`Name mutters: "..."`), not a says-bubble.
export function formatChitchat(name, line) {
  const t = line.trim();
  const wrapped = t.length >= 2 && t.startsWith('"') && t.endsWith('"');
  if (wrapped && !t.slice(1, -1).includes('"')) {
    return { type: 'output', message: `<span class="speech-line">${name} says, ${t}</span>` };
  }
  // Emote: prepend the name, VERBATIM.
  //
  // This used to strip an outer quote pair here, to tidy an "over-quoted action
  // line" — but the branch above already returns for every line that is a plain
  // quoted speech line, so the only way to reach this code WITH `wrapped` true is
  // a line that also contains quotes inside. That is not an over-quoted action,
  // it is a MIXED line: speech, a beat of action, speech again —
  //
  //   "Don't — " He stops himself, visibly, with effort. "Don't stack them face down."
  //
  // Stripping its outer pair deleted the opening quote and left the closing one,
  // which inverts the client's quote colouring for the whole rest of the line and
  // every line after it. The strip was unreachable in the case it was written for
  // and wrong in the only case it could actually run.
  return { type: 'zone_event', message: `${name} ${t}` };
}

// Whether an NPC is currently ON THE CLOCK at their workplace — the gate that
// decides work vs. life chitchat (and is exported for behaviours like the stripper
// dance). Per the design: "in the work zone AND on shift", no exceptions.
//   • Studio/broadcast actors: standing in their studio zone AND in an active slot.
//   • Vendors: at their (immobile) stall during their open hours.
//   • Anyone with an explicit work_zone_id: standing in it during open hours.
//   • Everyone else has no workplace → never "at work" (always life chitchat).
export function isNpcAtWork(entity) {
  if (!entity || isEnemy(entity)) return false;
  const hereId = entityZone(entity);
  const studioZone = entity.studio_zone_id || getNpcStudioZone(entity.id);
  if (studioZone) return hereId === studioZone && isNpcScheduledNow(entity.id);
  if (entity.npc_type === 'vendor' || entity.work_zone_id) {
    if (entity.work_zone_id && hereId !== entity.work_zone_id) return false;
    return !!isVendorWorkTime(entity, getEnvironmentState()).working;
  }
  return false;
}

function pickChitchatLine(entity, mode) {
  // Work vs. life pool, chosen by the NPC's current on-shift state unless a caller
  // forces a mode. NPC's own override wins, else the archetype default (getNpcChitchat).
  // Enemies have no personality archetype, so this falls through to their own
  // chitchat array or null.
  const m = mode || (isNpcAtWork(entity) ? 'work' : 'life');
  const lines = getNpcChitchat(entity, m) || (Array.isArray(entity.chitchat) ? entity.chitchat : []);
  if (lines.length) return pickFresh(entity, lines, m);
  return null; // SAY case falls back to the literal smoking line when this returns null
}

// ── A BAG, NOT A DIE ──────────────────────────────────────────────────────────
// A uniform random pick over five lines repeats one about every other draw, and
// the player is standing in the room for all of them — so the character reads as
// a machine with five buttons rather than as somebody with things on their mind.
// This is not a content problem and cannot be fixed by writing more lines: at any
// pool size, an independent roll will say the same thing twice in a row.
//
// So a line that has just been said is removed from the pool until most of the
// rest have had a turn. Deliberately MOST and not all: exhausting the whole bag
// before resetting turns the pool into a fixed cycle, which a player standing
// there long enough will hear as a loop — the one thing more mechanical than a
// repeat.
//
// Held in a WeakMap keyed by the entity rather than on the blackboard, because
// enemies say lines too and never get one; it costs no schema, survives no
// restart (correct — an NPC forgetting what they said last night is right), and
// releases with the entity.
const RECENT_FRACTION = 0.6;
const recentLines = new WeakMap();     // entity -> { [mode]: [line, …] }
export function pickFresh(entity, lines, key = 'line') {
  if (!Array.isArray(lines) || lines.length < 2) return lines?.[0] ?? null;
  if (!entity || typeof entity !== 'object') return lines[Math.floor(Math.random() * lines.length)];

  let bag = recentLines.get(entity);
  if (!bag) recentLines.set(entity, bag = {});
  const used = bag[key] || (bag[key] = []);

  let pool = lines.filter(l => !used.includes(l));
  if (!pool.length) { used.length = 0; pool = lines; }
  const pick = pool[Math.floor(Math.random() * pool.length)];

  used.push(pick);
  const cap = Math.max(1, Math.floor(lines.length * RECENT_FRACTION));
  while (used.length > cap) used.shift();
  return pick;
}

// ── Blackboard ────────────────────────────────────────────────────────────────

export function initBlackboard() {
  return {
    currentNode:  null,  // persistent execution cursor — resume point for next tick
    waitUntil:    null,  // timestamp — WAIT node suspend
    patrolTarget: null,  // zone_id currently walking toward
    patrolPath:   [],    // remaining BFS path steps
    patrolMode:   'walk',
    patrolIndex:  0,     // index into PATROL.waypoints
    alertCooldown: 0,    // timestamp — CALL_BACKUP debounce
    lastSay:      0,     // timestamp — SAY debounce
    flags:        {},    // SET_FLAG scope:self values
    _roamNextAt:  0,     // timestamp — ROAM cooldown
    _fleeNextAt:  0,     // timestamp — FLEE retry throttle (one attempt per attack cycle)
    vendor_was_working: false,  // true while vendor NPC is on a scheduled shift
    vendor_carrying:    0,      // credits extracted from safe, en route to ATM
    vendor_atm_zone:    null,   // cached nearest ATM zone for deposit run
    homeSleeping:       false,  // true while NPC is asleep at home (AT_HOME_LIFE)
    lastHomeSay:        0,      // timestamp — passive home activity cooldown
    homeAwakeSince:     0,      // timestamp — when this stretch of waking home life began
    wokenUntil:         0,      // timestamp — held awake after being disturbed
    sleepStartedAt:     0,      // timestamp — when they went under (sleep depth)
    disturbCount:       0,      // disturbances this sleep; each one makes the next likelier to land
    wokeMood:           null,   // { mood, until } — annoyed/confused after being woken
    _wasHome:           false,  // edge-detect for arriving home, to stamp homeAwakeSince
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function entityZone(entity) {
  return entity.zoneId ?? entity.zone_id;
}

function isEnemy(entity) {
  return entity.instanceId != null;
}

// May a hostile stand here? DESTINATION-ONLY, and that is not an accident: if this
// also inspected where the mob is coming FROM, anything that ever ended up inside a
// sanctuary (spawned before the tag, dropped there by a dev tool) could never leave
// again. Walking out is always allowed.
//
// The three rules are separate on purpose:
//   sanctuary   — already means "no hostile spawns, safe sleep, combat protection".
//                 A mob walking in breaks the same promise by a different verb.
//                 Blocking it is a bug fix, not a new rule.
//   no_spawn    — the weaker, author-painted version of the same statement.
//   enemy_barrier — the explicit "mobs stop here" paint. Deliberately NOT a blanket
//                 cross-district check: districtFor falls back to `residential` for
//                 any unclassified tile, so a blanket rule would freeze mobs at
//                 arbitrary boundaries all over the map. This is also the runtime
//                 backstop the Curtain has never had — today it holds only because
//                 no exit link crosses it, which one mis-authored exit would undo.
// The one exemption: a mob may ALWAYS return to where it came from. A tile can't
// be off-limits to a creature that originated there, and without this an enemy
// whose origin got tagged (or whose plugin spawns it somewhere protected) could
// never go home — which for the emergency plugin's Arbiters, who despawn by
// walking home via GO_HOME, would leak instances forever.
// The law does not apply to the law. Sanctuary means "safe from the wilds and
// from violence" — but SPECTER-PD is the institution that makes a room safe, and
// being arrested in a public safe zone is exactly what should happen there. Without
// this, ducking into any sanctuary stalled a manhunt permanently: huntStep calls
// moveEntity directly and does not re-route on a refusal, so the unit would stand
// at the threshold forever while the suspect sat inside.
//
// `flags.hunter` rather than the faction alone, because spawnHunter stamps it on
// every tier of a manhunt — including the ★5 Arbiters, whose template carries no
// faction at all. Wildlife, the Choir and the Ascendants stay bound by the law.
function isEnforcement(entity) {
  return !!entity?.flags?.hunter || entity?.faction === 'police';
}

function enemyMayEnter(to, entity) {
  if (!to) return false;
  if (to.id === entity?.spawnZoneId || to.id === entity?.home_zone) return true;
  if (isEnforcement(entity)) return true;
  if (to.flags?.no_spawn || to.flags?.enemy_barrier) return false;
  if (isSanctuary(to)) return false;
  return true;
}

// Entity pathing over the zone graph. NPCs walk the road grid (roads-preferring search) so
// they commute/patrol along streets instead of cutting through buildings; enemies keep the
// direct BFS line — a chase shouldn't take the scenic route. Falls through to plain BFS when
// the entity is unknown. Shadows the raw findPath import for every AI call site below.
function findPath(fromId, toId, entity) {
  if (entity && !isEnemy(entity)) return findPathRaw(fromId, toId, { roads: true });
  // Route around tiles this mob has already been refused (sanctuary, no_spawn, a
  // barrier). `avoid` never excludes the target itself, so a waypoint that IS a
  // forbidden tile still resolves a path and simply fails at the last step —
  // which is the honest outcome for a badly authored route.
  const avoid = entity?._ai?._leashAvoid;
  return findPathRaw(fromId, toId, avoid?.size ? { avoid } : {});
}

// Pick a random zone the talk-show guest can plausibly "appear" in unseen: within a short
// walk of the studio, but out on the public map (not inside the studio building), with no
// players present and no camera/planted device watching. Returns a zone id, or null if the
// area's too crowded/surveilled (caller falls back to the studio's exterior tile).
function pickUnobservedZoneNear(studioZone, entity) {
  const sz = getZone(studioZone);
  const studioMap = sz?.map_id ?? null;
  const reach = getZonesInRadius(studioZone, 8);    // Map<zone_id, distance> — kept tight so the
                                                     // guest has a SHORT commute and reaches the stage
                                                     // before the interview segment (it airs live).
  const cands = [];
  for (const [zid, dist] of reach) {
    if (zid === studioZone || dist < 2) continue;              // not on-stage; a few tiles out
    const z = getZone(zid);
    if (!z) continue;
    if (studioMap != null && z.map_id === studioMap) continue; // stay out of the studio building
    if (z.flags?.no_spawn) continue;
    if (getZonePlayers(zid).length) continue;                  // no player watching it arrive
    if (isZoneWatched(zid)) continue;                          // no camera / sticky-cam watching
    cands.push([zid, dist]);
  }
  if (!cands.length) return null;
  // Bias to the CLOSEST unobserved zones: with zero lead time (the show goes to air the moment
  // the guest starts walking), a distant origin left it still commuting when the interview began,
  // breaking the segment to technical difficulties. Pick randomly among the nearest few.
  cands.sort((a, b) => a[1] - b[1]);
  const nearest = cands.slice(0, Math.min(3, cands.length));
  return nearest[Math.floor(Math.random() * nearest.length)][0];
}

// Returns true if the move succeeded, false if blocked (locked door, or a
// failed break-away from a player who's actively attacking).
//
// `opts.deliberateFlee` marks a move the FLEE node asked for, which is the only
// kind that announces a failed break-away — see the gate below.
export function moveEntity(entity, newZoneId, broadcast, query, opts = {}) {
  const oldZoneId = entityZone(entity);
  if (oldZoneId === newZoneId) return true;

  // ── Contested break-away ────────────────────────────────────────────────────
  // A mob can't walk out of a fight a player is pressing without passing the
  // same contested roll the player has to. This lives HERE rather than in the
  // FLEE node because moveEntity is the single writer for every mob tile change:
  // gating only FLEE would leave ROAM, PATROL, and the commute paths free to
  // stroll a wounded enemy out of the room mid-swing.
  const pressed = pressingAttacker(entity);
  if (pressed) {
    // One attempt per attack cycle, not per AI tick — otherwise a roaming mob
    // rerolls several times a second.
    if (Date.now() < (entity._fleeNextAt || 0)) return false;
    entity._fleeNextAt = Date.now() + FLEE_RETRY_MS;
    if (!mobFleeRoll(entity, pressed.hit)) {
      // Only a DELIBERATE flee announces itself. An incidental roam/patrol step
      // that bounces off this gate stays silent — otherwise a mob you're fighting
      // spams the room every time its wander timer comes up.
      if (opts.deliberateFlee) {
        broadcast(oldZoneId, { type: 'output', message: `<span style="color:var(--yellow)">${entity.name} scrabbles for a way out but can't break away!</span>` });
      }
      return false;
    }
  }

  // ── Enemy destination law ───────────────────────────────────────────────────
  // A hostile may not walk into a place the world has already declared off-limits
  // to hostiles. Sanctuary and no_spawn have gated SPAWNING since they existed —
  // they never gated WALKING, so a mob could stroll into the one square the rules
  // promised was safe. moveEntity is the single writer for every mob tile change,
  // so this is the only place the law can't be routed around.
  if (isEnemy(entity) && !enemyMayEnter(getZone(newZoneId), entity)) {
    // Remember the refusal so PATROL stops re-routing through it. Without this,
    // findPath happily plots a course through a sanctuary, bounces off this line,
    // clears its path and recomputes the identical route — a BFS loop at 1 Hz.
    const ai = entity._ai;
    if (ai) {
      (ai._leashAvoid || (ai._leashAvoid = new Set())).add(newZoneId);
      ai.patrolPath = [];
    }
    return false;
  }

  // Facade pass-through (mirrors cmdMove's revolving door): NPCs/enemies never
  // stand on an enterable facade either — entering forwards to the interior
  // entry zone, exiting lands on the front-door street tile. The front door's
  // lock is checked HERE because after the swap the generic pair-lookup below
  // can't see it (there's no direct exit between origin and final zone).
  // Pathfinding self-heals: the path's next node after the facade is the entry
  // zone, which the entity now already occupies — a no-op step.
  // Set when the facade swap below rewrites the destination — the one legitimate
  // way an entity lands somewhere with no direct exit from where it started, and
  // therefore the one case the adjacency law after it must not refuse.
  let forwarded = false;

  // A destination one step PAST a facade. A player who walks into a building steps
  // onto the facade and is forwarded to the interior entry, so the room they ended
  // in isn't adjacent to the one they left — and anything following them (an
  // escortee) names that end room. Retarget to the facade itself so the swap below
  // does the forwarding, front-door lock and all; jumping straight to the interior
  // would skip the lock, and the adjacency law would refuse it anyway.
  if (!exitDirection(oldZoneId, newZoneId)) {
    for (const t of neighborZoneIds(getZone(oldZoneId))) {
      const z = getZone(t);
      if (!z || !isEnterableFacade(z)) continue;
      const interiorEntry = getMapByParentZone(z.id)?.entry_zone_id;
      if (interiorEntry === newZoneId || z.flags?.world_exit_zone === newZoneId) { newZoneId = t; break; }
    }
  }

  const facadeZone = getZone(newZoneId);
  if (facadeZone && isEnterableFacade(facadeZone)) {
    const interior = getMapByParentZone(facadeZone.id);
    const fromInside = getZone(oldZoneId)?.map_id === interior.id;
    const finalId = fromInside ? facadeZone.flags?.world_exit_zone : interior.entry_zone_id;
    if (finalId && finalId !== oldZoneId && getZone(finalId)) {
      // Was a hardcoded 'in'/'out' lookup, which only ever matched legacy buildings —
      // the 52 whose facade↔interior seam is labelled with a cardinal had NO front door
      // as far as this check was concerned, so a locked shop never stopped an NPC or a
      // chasing enemy. frontDoorOf reads the actual exit direction.
      const fd = frontDoorOf(facadeZone);
      if (fd && fd.hp > 0 && fd.lock_state === 'locked') {
        const ownsFrontDoor = !isEnemy(entity) &&
          [entity.home_zone, entity.work_zone_id].some(z => z && (z === oldZoneId || z === finalId || z === facadeZone.id));
        // Same out-not-in rule as the ordinary door gate below: an NPC already
        // inside the building can always get back out to the street, whether or
        // not the place belongs to them. Enemies still can't.
        const leavingBuilding = !isEnemy(entity) && fromInside;
        if (!ownsFrontDoor && !leavingBuilding) return false; // blocked — a locked front door stops NPCs and chasing enemies alike
      }
      newZoneId = finalId;
      forwarded = true;
      if (oldZoneId === newZoneId) return true;
    }
  }

  // ── Adjacency law ───────────────────────────────────────────────────────────
  // Every mob step follows a real exit. Nothing that walks intends otherwise —
  // patrol, commute, flee and roam all consume a findPath route one link at a
  // time. But a cached route goes STALE the moment something else moves the
  // entity, and the next shifted node is then somewhere across town. This used to
  // move them there anyway: a silent jump announcing itself to two unrelated rooms
  // as a directionless "X leaves." / "X arrives." — the wording is the tell,
  // because a step along an exit always names the direction. Charter pilots
  // produced exactly that at ~1 Hz while charter.js and their own graph fought
  // over where they stood, and it read to a player as pure spam.
  //
  // Refusing the step and dropping the dead route puts the fight in the log
  // instead of in the room, and the route recomputes from where the entity
  // actually is on the next tick.
  //
  // `opts.teleport` is for the callers that genuinely mean a jump (a consort
  // summoned to her keeper, the jail shift swap) — they narrate their own arrival.
  if (!forwarded && !opts.teleport && !exitDirection(oldZoneId, newZoneId)) {
    const ai = entity._ai;
    if (ai) { ai.patrolPath = []; ai.patrolTarget = null; }
    warnStaleStep(entity, oldZoneId, newZoneId);
    return false;
  }

  const departDir = exitDirection(oldZoneId, newZoneId);

  // ── Door handling ────────────────────────────────────────────────────────────
  let doorWasClosed = false;
  // Set once the home-lock or shop lock/unlock steps below have taken charge of
  // the door, so the generic "close behind them" step doesn't then clobber a
  // shop the NPC just opened for business or double-announce a home they secured.
  let doorHandled = false;
  if (departDir) {
    // One link, one fixture, one lookup (spec §6.3). This used to be written out
    // as a near-then-far dance four times in this file alone.
    const door = doorOnLink(oldZoneId, departDir, newZoneId);

    if (door && door.hp > 0) {
      if (door.lock_state === 'locked') {
        // An NPC carries the key to its own home or workplace, so it can pass its
        // own lock — e.g. a vendor returning to a shop that auto-locked while they
        // were away. Anyone else's lock still blocks it.
        const ownsThisDoor = !isEnemy(entity) &&
          (entity.home_zone === oldZoneId || entity.home_zone === newZoneId ||
           entity.work_zone_id === oldZoneId || entity.work_zone_id === newZoneId);
        // A LOCK ON A HOME KEEPS PEOPLE OUT, NOT IN. Ownership answers who may
        // come IN; anyone standing inside a dwelling may always walk out of it,
        // because a thumbturn on the inside is how a front door works.
        //
        // This is not a nicety. Without it an NPC whose home_zone is reassigned
        // while their body is left behind — an eviction, a relocation, a housing
        // rebuild — is sealed in a flat they no longer own. `ownsThisDoor` goes
        // false, moveEntity returns false, GO_TO_WORK clears its path and returns
        // RUNNING, and it retries that same blocked hop forever with no error.
        // Six NPCs (Lowry Cormack, Orion Thale, Prefect Aldous among them) were
        // found walled into old apartments this way on 2026-08-01, permanently
        // absent from their own shop counters.
        //
        // Keyed on the zone being LEFT being a dwelling, NOT on `door.zone_id`.
        // The door row's anchor side is not a reliable "protected side": an
        // apartment door is anchored inside the flat, while the regress hall door
        // is anchored in the hall with target_zone pointing at the flat. Testing
        // the anchor let a stranger walk IN through the second kind — which the
        // "NPC blocked by another's locked door" case caught. The zone's own
        // nature can't be got backwards. Enemies are excluded: a locked door is
        // still a wall to something chasing you, from either side.
        const leavingOwnDwelling = !isEnemy(entity) && isDwellingZone(getZone(oldZoneId));

        // ...and a door on the building you LIVE OR WORK IN opens for you, from
        // anywhere inside it. `ownsThisDoor` only knows the two zones either side
        // of this one doorway, which is too narrow for a door that isn't right
        // outside your own room: Halloran sleeps in the Long Watch bunkroom and
        // runs a shop on the surface, so his commute crosses the bunker's blast
        // door two rooms from his bed — and that door is `lock:longwatch`, whose
        // authFn reads a PLAYER's reputation and so can never answer for an NPC.
        // He was sealed in the safehouse he lives in. Same map = same building,
        // which is exactly the "you belong on this side" question being asked.
        //
        // Checked on BOTH sides — the building being left and the one being
        // entered. Halloran's commute crosses two of these locks in opposite
        // directions: out through the bunker blast door in the morning, then back
        // UP the drain hatch into his own shop's back room. The second is ingress,
        // and `ownsThisDoor` misses it for the same reason as the first — his
        // work_zone_id is the shop floor, not the back room the hatch opens into.
        //
        // Guarded on the map id being truthy: the synthetic zones in regress carry
        // no map_id, and `undefined === undefined` would wave every stranger in.
        const homeMap = getZone(entity.home_zone)?.map_id;
        const workMap = getZone(entity.work_zone_id)?.map_id;
        const belongsTo = (zid) => {
          const m = getZone(zid)?.map_id;
          return !!m && (m === homeMap || m === workMap);
        };
        const residentOfThisBuilding = !isEnemy(entity) &&
          (belongsTo(oldZoneId) || belongsTo(newZoneId));

        if (!ownsThisDoor && !leavingOwnDwelling && !residentOfThisBuilding) return false; // blocked — entity can't pass
      }

      if (!door.is_open) {
        doorWasClosed = true;
        door.is_open = 1;
        setDoorCache(door.id, door);
        broadcast(oldZoneId, { type: 'zone_event', message: `${entity.name} opens the door.`, refresh: true });
      }
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  const arriveDir = exitDirection(newZoneId, oldZoneId);
  const sourceZoneName = getZone(oldZoneId)?.name || 'inside';
  // Elevator flavour: stepping into or out of a car (flags.elevator) reads as
  // riding the lift, not "climbs the stairs" (every floor shares the `up`/`in`
  // exit, so the stairs wording lands wrong). The car is a single zone the NPC
  // pauses in between graph hops — a trip is two steps, into the car then out on
  // the destination floor — and each observer sees the doors from their own side.
  const toCar   = !!getZone(newZoneId)?.flags?.elevator;
  const fromCar = !!getZone(oldZoneId)?.flags?.elevator;
  let departMsg, arriveMsg;
  if (toCar) {
    departMsg = `${entity.name} steps into the elevator.`;                    // seen on the floor left behind
    arriveMsg = `The doors part and ${entity.name} steps into the car.`;      // seen by anyone already aboard
  } else if (fromCar) {
    departMsg = `${entity.name} steps out of the elevator.`;                  // seen by anyone still in the car
    arriveMsg = `The elevator chimes and ${entity.name} steps out.`;          // seen on the destination floor
  } else {
    departMsg = departDir ? `${entity.name} heads ${departDir}.` : `${entity.name} leaves.`;
    if (arriveDir === 'out')       arriveMsg = `${entity.name} arrives from outside.`;
    else if (arriveDir === 'in')   arriveMsg = `${entity.name} emerges from ${sourceZoneName}.`;
    else if (arriveDir === 'up')   arriveMsg = `${entity.name} descends the stairs.`;
    else if (arriveDir === 'down') arriveMsg = `${entity.name} climbs the stairs.`;
    else if (arriveDir)            arriveMsg = `${entity.name} arrives from the ${arriveDir}.`;
    else                           arriveMsg = `${entity.name} arrives.`;
  }

  // Captured before the shop session is torn down below; used by the shop-close
  // branch for the vendor's farewell line (happy if they bought, whiny if not).
  let shopperId = null, shopperBought = false;

  if (isEnemy(entity)) {
    world.zones.get(oldZoneId)?.enemies.delete(entity.instanceId);
    entity.zoneId = newZoneId;
    world.zones.get(newZoneId)?.enemies.add(entity.instanceId);
    broadcast(newZoneId, { type: 'zone_event', message: arriveMsg, refresh: true, _movement: true });
    broadcast(oldZoneId, { type: 'zone_event', message: departMsg, refresh: true, _movement: true });
  } else {
    // If a player has this NPC's shop open, close it before the NPC leaves.
    shopperId = getShopperForNpc(entity.id);
    if (shopperId) {
      shopperBought = didBuyThisSession(shopperId);
      closeShopSession(shopperId);
      broadcast(null, { type: 'dialogue_end', message: `${entity.name} has walked away.` }, null, shopperId);
    }
    world.zones.get(oldZoneId)?.npcs.delete(entity.id);
    entity.zone_id = newZoneId;
    world.zones.get(newZoneId)?.npcs.add(entity.id);
    broadcast(newZoneId, { type: 'zone_event', message: arriveMsg, refresh: true, _movement: true });
    broadcast(oldZoneId, { type: 'zone_event', message: departMsg, refresh: true, _movement: true });
  }

  // Lock the door when an NPC arrives at their home zone — but only if they were
  // actually OUT. Stepping back out of your own ensuite is not coming home, and
  // treating it as such bolted the bathroom's privacy lock behind the NPC every
  // time, quietly making the room unenterable for everyone else.
  const cameFromOwnSubZone = getZone(oldZoneId)?.parent_zone === entity.home_zone;
  if (!isEnemy(entity) && entity.home_zone && entity.home_zone === newZoneId && departDir
      && !cameFromOwnSubZone) {
    const homeDoor = doorOnLink(oldZoneId, departDir, newZoneId);
    if (homeDoor && npcAutoLockable(homeDoor)) {
      homeDoor.is_open = 0;
      homeDoor.lock_state = 'locked';
      markAutoLock(homeDoor, newZoneId);   // the home is the inside — you may always walk back out
      setDoorCache(homeDoor.id, homeDoor);
      broadcast(newZoneId, { type: 'zone_event', message: `The lock clicks as ${entity.name} secures the door.`, refresh: true });
      doorHandled = true;
      // Somebody who doesn't live here doesn't get locked in with the householder.
      // The eviction itself is a plugin's business (ambient-life/eviction.js) — the
      // engine only reports that a door was secured and which side is indoors.
      emit('npc.lockup', { npc: entity, reason: 'home', insideZoneId: newZoneId, outsideZoneId: oldZoneId, door: homeDoor });
    }
  }

  // Vendor shops lock up when the vendor leaves work and reopen when they return.
  // Keyed on the entrance door of the NPC's work_zone_id — so it only fires for
  // genuine storefronts (which have such a door), never public hubs that don't.
  if (!isEnemy(entity) && entity.work_zone_id && departDir) {
    const arrivingAtWork = newZoneId === entity.work_zone_id;
    const leavingWork    = oldZoneId === entity.work_zone_id;
    if (arrivingAtWork || leavingWork) {
      const shopDoor = doorOnLink(oldZoneId, departDir, newZoneId);
      if (shopDoor && shopDoor.hp > 0 && npcAutoLockable(shopDoor)) {
        if (arrivingAtWork && shopDoor.lock_state === 'locked') {
          shopDoor.lock_state = null;
          markAutoLock(shopDoor, null);
          setDoorCache(shopDoor.id, shopDoor);
          broadcast(newZoneId, { type: 'zone_event', message: `${entity.name} unlocks the shop and opens up for business.` });
          broadcast(oldZoneId, { type: 'zone_event', message: `${entity.name} unlocks the shop.` });
          doorHandled = true;   // leave it open for business — don't close behind them
        } else if (leavingWork && shopDoor.lock_state !== 'locked') {
          shopDoor.is_open = 0;
          shopDoor.lock_state = 'locked';
          markAutoLock(shopDoor, oldZoneId);   // the shop floor is the inside — a customer caught in it can still leave
          setDoorCache(shopDoor.id, shopDoor);
          emit('npc.lockup', { npc: entity, reason: 'shop', insideZoneId: oldZoneId, outsideZoneId: newZoneId, door: shopDoor });
          broadcast(oldZoneId, { type: 'zone_event', message: `${entity.name} pulls the shop door shut and locks it on the way out.`, refresh: true });
          broadcast(newZoneId, { type: 'zone_event', message: `${entity.name} locks up the shop.`, refresh: true });
          doorHandled = true;
          // If someone was shopping as the vendor closed up, send them off — warm
          // if they bought something, sour if they wasted the vendor's time.
          if (shopperId) {
            const lines = shopperBought ? VENDOR_CLOSE_HAPPY : VENDOR_CLOSE_WHINE;
            const line = lines[Math.floor(Math.random() * lines.length)];
            broadcast(oldZoneId, { type: 'output', message: `<span class="speech-line">${entity.name} says, "${line}"</span>` });
          }
        }
      }
    }
  }

  // Close the door behind them — but only a plain transit door. If the home-lock
  // or shop steps already took charge (secured home / opened shop / locked shop
  // up), leave their result alone.
  if (doorWasClosed && !doorHandled) {
    const door = doorOnLink(oldZoneId, departDir, newZoneId);
    if (door) {
      door.is_open = 0;
      setDoorCache(door.id, door);
      broadcast(newZoneId, { type: 'zone_event', message: 'The door closes behind them.', refresh: true });
    }
  }

  // Drag along any players following this entity. Fire-and-forget + dynamic
  // import to keep moveEntity synchronous and avoid a circular import.
  if (departDir) {
    import('./commands/movement.js')
      .then(({ dragFollowers }) => dragFollowers(entity.id, oldZoneId, departDir, broadcast))
      .catch(() => {});
  }

  return true;
}

// Find which exit direction connects fromZone → toZone, or null if none.
function exitDirection(fromZoneId, toZoneId) {
  const zone = world.zones.get(fromZoneId);
  return allExits(zone).find(e => e.target === toZoneId)?.dir || null;
}

// Resolve an edge from a node (looks up fromNode+fromPort in edges array).
function resolveEdge(edges, fromNode, fromPort) {
  return edges.find(e => e.fromNode === fromNode && e.fromPort === fromPort)?.toNode || null;
}

// Convert DB-format graph (inline connections + flat data) to runtime format
// (edges array + node.data). Called once per entity and cached on the object.
// DB format from toAiGraph: { _start, nodes: { id: { type, condition_type, next, ... } } }
// Runtime format:           { _start, nodes: { id: { type, data: {...} } }, edges: [...] }
function normalizeGraph(graph) {
  if (!graph || !graph.nodes) return graph;
  if (graph._normalized) return graph;

  const edges = [];
  const nodes = {};

  for (const [id, node] of Object.entries(graph.nodes)) {
    const { type, next, ifTrue, ifFalse, goToWork, haveLife, endShift, offWork, _vine, ...fields } = node;

    if (next)      edges.push({ fromNode: id, fromPort: 'next',      toNode: next });
    if (ifTrue)    edges.push({ fromNode: id, fromPort: 'ifTrue',    toNode: ifTrue });
    if (ifFalse)   edges.push({ fromNode: id, fromPort: 'ifFalse',   toNode: ifFalse });
    if (goToWork)  edges.push({ fromNode: id, fromPort: 'goToWork',  toNode: goToWork });
    if (haveLife)  edges.push({ fromNode: id, fromPort: 'haveLife',  toNode: haveLife });
    if (endShift)  edges.push({ fromNode: id, fromPort: 'endShift',  toNode: endShift });
    if (offWork)   edges.push({ fromNode: id, fromPort: 'offWork',   toNode: offWork });

    for (const k of Object.keys(fields)) {
      if (k.startsWith('branch_') && fields[k]) {
        edges.push({ fromNode: id, fromPort: k, toNode: fields[k] });
        delete fields[k];
      }
    }

    nodes[id] = { type: type || 'action', data: fields };
  }

  return { _start: graph._start, nodes, edges, _normalized: true };
}

// ── Plugin node registries ────────────────────────────────────────────────────
// Plugins add behaviour-tree node types without editing the switches below
// (docs/proposals/engine-plugin-boundary.md, E3). The broadcast plugin's
// schedule/viewer nodes are the first users.
//
// Conditions are SYNC by contract (the evaluator is synchronous — read caches,
// never the DB): fn(entity, params, { zone, zoneId }) → boolean.
// Actions may be async: fn(entity, params, ctx) → port-string | 'RUNNING' |
// undefined (undefined = continue to the node's default next edge). ctx
// carries { broadcast, query, ai, zone, zoneId, node }.

const pluginConditions = new Map();
const pluginActions = new Map();

export function registerAICondition(type, fn) {
  if (!type || typeof fn !== 'function') throw new Error('registerAICondition: type and fn required');
  pluginConditions.set(type, fn);
}

export function registerAIAction(type, fn) {
  if (!type || typeof fn !== 'function') throw new Error('registerAIAction: type and fn required');
  pluginActions.set(type, fn);
}

export function getRegisteredAINodes() {
  return { conditions: [...pluginConditions.keys()], actions: [...pluginActions.keys()] };
}

// ── Condition evaluation ──────────────────────────────────────────────────────

function evalCondition(node, entity) {
  const { condition_type: type, params = {} } = node.data;
  const zoneId = entityZone(entity);
  const zone = world.zones.get(zoneId);

  switch (type) {
    case 'HAS_TARGET':
      return !!entity.targetId;

    case 'HP_BELOW':
      return (entity.hp / entity.hp_max) * 100 < (params.pct ?? 30);

    case 'HP_ABOVE':
      return (entity.hp / entity.hp_max) * 100 > (params.pct ?? 70);

    case 'IN_ZONE':
      return zoneId === params.zone_id;

    case 'PLAYER_IN_ZONE':
      return (zone?.players.size ?? 0) >= (params.min ?? 1);

    // Like PLAYER_IN_ZONE but respects ignores_admins / attacks_npcs / attacks_enemies flags.
    // True only if at least one non-admin (or NPC/enemy) target is present.
    case 'TARGETABLE_IN_ZONE': {
      if (!zone) return false;
      let players = [...zone.players].map(id => getLivePlayer(id)).filter(Boolean);
      if (entity.flags?.ignores_admins) players = players.filter(p => p.role !== 'admin');
      if (players.length) return true;
      if (entity.flags?.attacks_npcs && [...zone.npcs].some(id => { const n = world.npcs.get(id); return n && !n._dead; })) return true;
      if (entity.flags?.attacks_enemies && [...zone.enemies].some(id => { const e = world.enemies.get(id); return e && !e._dead && e.instanceId !== entity.instanceId; })) return true;
      return false;
    }

    case 'TARGET_HP_BELOW': {
      const target = getLivePlayer(entity.targetId);
      if (!target) return false;
      return (target.hp / target.hp_max) * 100 < (params.pct ?? 30);
    }

    case 'FACTION_MATCH': {
      // True if the target player is a member of the org (corp or player-joinable
      // faction) named by params.faction. Members of NPC factions don't exist in
      // Phase 0, so this fires for player crews; NPC-faction-vs-player reactions
      // key off reputation instead (a future async REP condition).
      const target = getLivePlayer(entity.targetId);
      if (!target || !params.faction) return false;
      return getPlayerMembership(target.id)?.org_id === params.faction;
    }

    case 'FLAG_SET':
      if (params.scope === 'self') return !!entity._ai?.flags?.[params.flag];
      // world flag — checked via world_flags table; use blackboard as fallback
      return !!entity._ai?.flags?.[params.flag];

    case 'RANDOM_CHANCE':
      return Math.random() < (params.chance ?? 0.5);

    case 'IS_DAYTIME': {
      const { timePhase } = getEnvironmentState();
      return timePhase === 'day' || timePhase === 'dawn' || timePhase === 'dusk';
    }

    // CHANNEL_HAS_VIEWERS / IS_BROADCAST_SCHEDULED / AT_WORK_ZONE are
    // registered by the broadcast plugin via registerAICondition.

    case 'HOUR_RANGE': {
      const { hour } = getEnvironmentState();
      if (hour == null) return false;
      const from = params.from ?? 0, to = params.to ?? 23;
      return from <= to ? (hour >= from && hour <= to) : (hour >= from || hour <= to);
    }

    case 'IS_VENDOR_WORK_TIME': {
      const env = getEnvironmentState();
      return isVendorWorkTime(entity, env).working;
    }

    case 'AT_HOME':
      return !!(entity.home_zone && zoneId === entity.home_zone);

    default: {
      const fn = pluginConditions.get(type);
      if (fn) {
        try { return !!fn(entity, params, { zone, zoneId }); }
        catch (e) { console.error(`[ai:condition:${type}] ${e.message}`); return false; }
      }
      return false;
    }
  }
}

// ── Action execution ──────────────────────────────────────────────────────────

async function execAction(node, entity, ctx) {
  const { broadcast, query } = ctx;
  const { action_type: type, params = {} } = node.data;
  const ai = entity._ai;
  const zoneId = entityZone(entity);
  const zone = world.zones.get(zoneId);

  switch (type) {
    case 'ATTACK': {
      if (!entity.targetId) break;
      // Check if target is another enemy instance
      const enemyTarget = entity.flags?.attacks_enemies ? world.enemies.get(entity.targetId) : null;
      if (enemyTarget) {
        if (enemyTarget._dead || (enemyTarget.zoneId !== zoneId && forgetsAbsentTarget(entity))) {
          entity.targetId = null;
          if (ai) ai.patrolPath = [];
          break;
        }
        if (enemyTarget.zoneId !== zoneId) break; // held for CHASE; can't swing from here
        enemyAttackEnemy(entity, enemyTarget).then(result => {
          if (!result) return;
          broadcast(zoneId, { type: 'zone_event', message: result.message, refresh: result.killed });
          if (result.killed) {
            entity.targetId = null;
            if (ai) ai.patrolPath = [];
          }
        }).catch(() => {});
        break;
      }
      // Check if target is an NPC (when attacks_npcs flag is set)
      const npcTarget = entity.flags?.attacks_npcs ? world.npcs.get(entity.targetId) : null;
      if (npcTarget) {
        if (npcTarget._dead || (npcTarget.zone_id !== zoneId && forgetsAbsentTarget(entity))) {
          entity.targetId = null;
          if (ai) ai.patrolPath = [];
          break;
        }
        if (npcTarget.zone_id !== zoneId) break; // held for CHASE
        enemyAttackNpc(entity, npcTarget).then(result => {
          if (!result) return;
          if (result.hit) {
            broadcast(zoneId, { type: 'zone_event', message: result.message });
            if (result.npcSpeech) {
              const verb = result.npcSpeech.shout ? 'shouts' : 'says';
              broadcast(zoneId, { type: 'zone_event', message: `${npcTarget.name} ${verb}, "${result.npcSpeech.line}"` });
            }
          }
          if (result.killed) {
            entity.targetId = null;
            if (ai) ai.patrolPath = [];
            broadcast(zoneId, { type: 'zone_event', message: `${npcTarget.name} has been killed.`, refresh: true });
          }
        }).catch(() => {});
        break;
      }
      const target = getLivePlayer(entity.targetId);
      if (!target || (target.current_zone !== zoneId && forgetsAbsentTarget(entity))) {
        entity.targetId = null;
        if (ai) ai.patrolPath = [];
        break;
      }
      if (target.current_zone !== zoneId) break; // held for CHASE
      const firstStrikeDelay = entity.flags?.first_strike_delay_ms || 0;
      if (firstStrikeDelay > 0 && entity.lastAttack === 0) {
        const elapsed = Date.now() - (entity.aggroedAt || Date.now());
        if (elapsed < firstStrikeDelay) break;
      }
      enemyAttackPlayer(entity, target).then(async result => {
        if (!result) return;
        if (result.hit) {
          target.hp = Math.max(0, target.hp - result.damage);
          query('UPDATE players SET hp=$1 WHERE id=$2', [target.hp, target.id]).catch(() => {});
          broadcast(null, { type: 'combat_incoming', message: result.message, player_update: { hp: target.hp, hp_max: target.hp_max } }, null, target.id);
          if (target.hp <= 0) {
            const { handlePlayerDeath } = await import('./gameLoop.js');
            await handlePlayerDeath(target, entity);
          } else {
            if (!target.combatTargetId && !((target.disengagedUntil || 0) > Date.now())) target.combatTargetId = entity.instanceId;
          }
        } else {
          broadcast(null, { type: 'combat_miss', message: result.message }, null, entity.targetId);
        }
      }).catch(() => {});
      break;
    }

    case 'ACQUIRE_TARGET': {
      if (!zone) break;
      let players = [...zone.players].map(id => getLivePlayer(id)).filter(Boolean);
      if (entity.flags?.ignores_admins) players = players.filter(p => p.role !== 'admin');
      const npcs = entity.flags?.attacks_npcs
        ? [...zone.npcs].map(id => world.npcs.get(id)).filter(n => n && !n._dead)
        : [];
      const enemies = entity.flags?.attacks_enemies
        ? [...zone.enemies].map(id => world.enemies.get(id)).filter(e => e && !e._dead && e.instanceId !== entity.instanceId)
        : [];
      const pool = [...players, ...npcs, ...enemies];
      if (!pool.length) break;
      if (params.prefer === 'lowest_hp') {
        pool.sort((a, b) => (a.hp ?? 0) - (b.hp ?? 0));
        entity.targetId = pool[0].id;
      } else {
        entity.targetId = pool[Math.floor(Math.random() * pool.length)].id;
      }
      entity.aggroedAt = Date.now();
      break;
    }

    case 'DROP_TARGET':
      entity.targetId = null;
      entity.aggroedAt = null;
      if (ai) { ai.patrolPath = []; ai.patrolTarget = null; }
      break;

    case 'PATROL': {
      if (!ai) break;
      const waypoints = Array.isArray(params.waypoints) ? params.waypoints : [];
      if (!waypoints.length) break;

      const loop = params.loop !== false;
      const mode = params.mode || 'walk';

      // Advance waypoint index if we've arrived at the current target
      if (ai.patrolTarget && zoneId === ai.patrolTarget) {
        ai.patrolPath = [];
        ai.patrolTarget = null;
        if (loop) {
          ai.patrolIndex = (ai.patrolIndex + 1) % waypoints.length;
        } else {
          ai.patrolIndex = Math.min(ai.patrolIndex + 1, waypoints.length - 1);
        }
      }

      // Retarget a building facade to its interior entry zone so path, patrolTarget and the
      // arrival check above all agree on where the walker actually lands (no-op otherwise).
      const target = resolveLanding(waypoints[ai.patrolIndex % waypoints.length]);
      if (!target || zoneId === target) break;

      if (mode === 'teleport') {
        moveEntity(entity, target, broadcast); // teleport ignores doors
        ai.patrolTarget = null;
        ai.patrolPath = [];
        break;
      }

      // Walk mode: BFS path, step one zone per tick
      if (!ai.patrolPath.length || ai.patrolTarget !== target) {
        const path = findPath(zoneId, target, entity);
        if (!path || path.length < 2) break;
        ai.patrolPath = path.slice(1); // skip current zone
        ai.patrolTarget = target;
        ai.patrolMode = mode;
      }

      const nextZone = ai.patrolPath.shift();
      if (nextZone) {
        const moved = moveEntity(entity, nextZone, broadcast, query);
        if (!moved) {
          // Locked door blocking the path — abandon this route and recompute next tick
          ai.patrolPath = [];
          ai.patrolTarget = null;
          break;
        }
        return 'RUNNING'; // still en route — stay at PATROL node next tick
      }
      break;
    }

    case 'FLEE': {
      if (!ai) break;
      const targetPlayer = getLivePlayer(entity.targetId);
      const targetZoneId = targetPlayer?.current_zone;
      const exits = neighborZoneIds(zone);
      if (!exits.length) break;

      // When a PLAYER is pressing the attack, moveEntity owns the contest (it
      // gates every mob tile-exit, so ROAM and PATROL can't sneak out either) —
      // rolling here too would make the mob pass two checks for one escape.
      // Without one, fall back to the flat break-contact check that covers
      // mob-vs-mob and fleeing an aggro it can't reach.
      if (!pressingAttacker(entity)) {
        // One break-away attempt per attack cycle — not once per AI tick.
        if (Date.now() < ai._fleeNextAt) break;
        ai._fleeNextAt = Date.now() + FLEE_RETRY_MS;

        // Roll to actually break contact. Weak enemies routinely fail and stay
        // cornered (keeping aggro so they re-try next tick); tough ones get away.
        const fleeSkill = Number(entity.flags?.flee_skill ?? entity.dodge ?? 1);
        if (fleeSkill + (d8() + d8()) - (d8() + d8()) < FLEE_DIFFICULTY) {
          broadcast(zone.id, { type: 'output', message: `<span style="color:var(--yellow)">${entity.name} scrabbles for a way out but can't break away!</span>` });
          break;
        }
      }

      // Move to any adjacent zone that doesn't contain the target
      const safeExits = exits.filter(z => z !== targetZoneId);
      const dest = safeExits.length
        ? safeExits[Math.floor(Math.random() * safeExits.length)]
        : exits[Math.floor(Math.random() * exits.length)];

      // deliberateFlee: this is the one mob move that announces a failed
      // break-away — an incidental roam step bouncing off the gate stays silent.
      const moved = moveEntity(entity, dest, broadcast, query, { deliberateFlee: true });
      if (!moved) break; // locked door, or the contest went against it — stay put
      // Clear target after fleeing
      entity.targetId = null;
      entity.aggroedAt = null;
      break;
    }

    // CHASE: follow the current target between zones, bounded by the leash.
    // Sits between HAS_TARGET and ATTACK in the graph. Opt-in: a creature without
    // this node forgets you the moment you step out, which is how every enemy
    // behaved before pursuit existed.
    // Params: none — pacing is flags.chase_speed_s, range is flags.leash_radius.
    // CHASE: follow a quarry between zones, bounded by the leash.
    //
    // Params (all optional):
    //   quarry     'target' (default) — follow entity.targetId
    //              'flag'             — follow the player id in entity.flags[flag]
    //   flag       which flag holds the quarry id in 'flag' mode ('suspect_id')
    //   wander_pct 0..1 chance of stepping somewhere random instead of pathing
    //
    // The two modes exist because FOLLOWING and FIGHTING are different concerns,
    // and only for wildlife do they coincide. A manhunt unit under ~4 stars must
    // arrive and DETAIN rather than kill, so it is deliberately given no targetId
    // (targetId is what makes the graph swing) — it is chasing somebody it is
    // explicitly not targeting. Before this, that forced the police to carry their
    // own duplicate pursuit loop.
    case 'CHASE': {
      if (!ai) break;
      const hunting = params.quarry === 'flag';
      const quarryId = hunting ? entity.flags?.[params.flag || 'suspect_id'] : entity.targetId;
      if (!quarryId) break;

      // Only a combat chase drops the target when it ends. In flag mode the
      // quarry id belongs to whoever set the flag, and clearing it here would
      // stamp on their state.
      const giveUp = () => {
        if (!hunting) entity.targetId = null;
        ai.chasePath = []; ai._chaseSince = 0;
      };

      const targetZone = quarryZone(quarryId);
      // Quarry dead, logged out, or otherwise gone.
      if (!targetZone) { giveUp(); break; }
      // Already on it — do nothing and let the rest of the graph run this same
      // tick. This is the overwhelmingly common case and it must cost nothing.
      if (targetZone === zoneId) { ai._chaseSince = 0; ai.chasePath = []; break; }

      const nowMs = Date.now();
      if (!ai._chaseSince) ai._chaseSince = nowMs;
      // Give up in TIME as well as space, so a predator can't shadow someone
      // around inside its own radius forever. NOT applied to a hunt: a manhunt is
      // supposed to be relentless, and its lifecycle is owned by whatever declared
      // it (heat decay, an arrest, a despawn) rather than by a stopwatch here.
      if (!hunting && nowMs - ai._chaseSince > CHASE_TIMEOUT_MS) { giveUp(); break; }

      // Give up in SPACE: the leash radius is the pursuit range. One knob sets both
      // how far a thing wanders and how far it follows — a territorial mob with a
      // short leash defends a small patch and abandons the chase almost at once,
      // and a leash_radius of -1 pursues across the map.
      const radius = leashRadius(entity);
      if (radius >= 0 && entity.spawnZoneId && distanceFromSpawn(entity, targetZone) > radius) {
        giveUp(); break;
      }

      if (ai._chaseNextAt && nowMs < ai._chaseNextAt) break;
      ai._chaseNextAt = nowMs + chaseIntervalMs(entity);

      const curZone = world.zones.get(zoneId);
      // The imprecision of a search. A hunt that walks the shortest path every
      // single step reads as a cursor snapping to you rather than somebody looking.
      const wander = Number(params.wander_pct) || 0;
      if (wander > 0 && Math.random() < wander) {
        const nbrs = neighborZoneIds(curZone);
        if (nbrs.length) {
          ai.chasePath = [];
          moveEntity(entity, nbrs[Math.floor(Math.random() * nbrs.length)], broadcast, query);
        }
        break;
      }

      // Fast path: the quarry is next door. This is the common case in a running
      // chase and it takes no BFS at all.
      if (curZone && neighborZoneIds(curZone).includes(targetZone)) {
        ai.chasePath = [];
        moveEntity(entity, targetZone, broadcast, query);
        break;
      }
      // Further off — path to it, cached the same way PATROL caches its route.
      if (!ai.chasePath?.length || ai.chaseTarget !== targetZone) {
        ai.chaseTarget = targetZone;
        const path = findPath(zoneId, targetZone, entity);
        ai.chasePath = path ? path.slice(1) : [];
        // Unreachable (no route, or every route runs through somewhere it may not
        // go). A predator gives up; a hunt keeps casting about, because the map
        // changes and the suspect moves.
        if (!ai.chasePath.length) {
          if (!hunting) { giveUp(); break; }
          const nbrs = neighborZoneIds(curZone);
          if (nbrs.length) moveEntity(entity, nbrs[Math.floor(Math.random() * nbrs.length)], broadcast, query);
          break;
        }
      }
      const step = ai.chasePath.shift();
      // A refused step (locked door, sanctuary) invalidates the rest of the route;
      // recompute next beat, which will route around it via _leashAvoid.
      if (step && !moveEntity(entity, step, broadcast, query)) ai.chasePath = [];
      break;
    }

    // ROAM: move to a random adjacent zone every N seconds, looking for targets.
    // Used by enemies like Arbiters that hunt by wandering rather than fixed patrols.
    // Params: { interval_s: 10 }
    case 'ROAM': {
      if (!ai) break;
      const intervalMs = (params.interval_s ?? 10) * 1000;
      const now = Date.now();
      if (ai._roamNextAt && now < ai._roamNextAt) break; // still waiting

      // Check for targetable entities in current zone before moving.
      // Respects ignores_admins — admin-only zones are treated as empty.
      const curZone = world.zones.get(zoneId);
      let roamPlayers = curZone ? [...(curZone.players || [])].map(id => getLivePlayer(id)).filter(Boolean) : [];
      if (entity.flags?.ignores_admins) roamPlayers = roamPlayers.filter(p => p.role !== 'admin');
      const hasTarget = roamPlayers.length > 0 ||
        (entity.flags?.attacks_npcs && curZone && [...(curZone.npcs || [])].some(id => { const n = world.npcs.get(id); return n && !n._dead; })) ||
        (entity.flags?.attacks_enemies && curZone && [...(curZone.enemies || [])].some(id => { const e = world.enemies.get(id); return e && !e._dead && e.instanceId !== entity.instanceId; }));
      if (hasTarget) {
        // Found a target — don't move, let combat nodes handle aggro
        ai._roamNextAt = now + intervalMs;
        break;
      }

      // No target — step to a random adjacent zone, but not off its patch. Inside
      // the leash it wanders freely; outside, only steps that bring it back are on
      // the table, so it walks home along the grid gradient.
      const exits = leashCandidates(entity, zoneId, neighborZoneIds(curZone));
      if (exits.length) {
        const dest = exits[Math.floor(Math.random() * exits.length)];
        moveEntity(entity, dest, broadcast, query);
      }
      ai._roamNextAt = now + intervalMs;
      break;
    }

    case 'SAY': {
      if (!ai) break;
      const cooldown = (params.cooldown_s ?? 30) * 1000;
      if (params.once && ai.lastSay > 0) break;
      if (Date.now() - ai.lastSay < cooldown) break;

      // Studio NPCs away from their assigned studio never deliver authored lines —
      // they fall back to idle chitchat (or a generic smoking emote) instead.
      if (entity.studio_zone_id && zoneId !== entity.studio_zone_id) {
        const line = pickChitchatLine(entity);
        ai.lastSay = Date.now();
        broadcast(zoneId, line
          ? { type: 'output', message: `<span class="speech-line">${entity.name} says, "${line}"</span>` }
          : { type: 'output', message: `<span style="color:var(--text-dim);font-style:italic">${entity.name} smokes a cigarette.</span>` });
        break;
      }

      const msg = params.message || '';
      if (!msg) break;
      ai.lastSay = Date.now();
      broadcast(zoneId, {
        type: 'output',
        message: `<span class="speech-line">${entity.name} says, "${msg}"</span>`,
      });
      break;
    }

    case 'CALL_BACKUP': {
      if (!ai) break;
      const radius = params.radius ?? 2;
      const factionOnly = params.faction_only !== false;
      if (Date.now() - ai.alertCooldown < 30000) break; // 30s cooldown
      ai.alertCooldown = Date.now();

      const reach = getZonesInRadius(zoneId, radius);
      for (const [reachZoneId] of reach) {
        const rZone = world.zones.get(reachZoneId);
        if (!rZone) continue;
        for (const eid of rZone.enemies) {
          const ally = world.enemies.get(eid);
          if (!ally || ally.instanceId === entity.instanceId) continue;
          if (factionOnly && ally.faction !== entity.faction) continue;
          if (!ally.targetId && entity.targetId) {
            ally.targetId = entity.targetId;
            ally.aggroedAt = Date.now();
          }
        }
        for (const nid of rZone.npcs) {
          const ally = world.npcs.get(nid);
          if (!ally || ally.id === entity.id) continue;
          if (factionOnly && ally.faction !== entity.faction) continue;
          if (!ally.targetId && entity.targetId) {
            ally.targetId = entity.targetId;
          }
        }
      }
      break;
    }

    case 'TELEPORT': {
      const dest = params.zone_id;
      if (!dest) break;
      moveEntity(entity, dest, broadcast);
      if (ai) { ai.patrolPath = []; ai.patrolTarget = null; }
      break;
    }

    case 'IDLE':
      break;

    // GO_TO_STUDIO IS GO_TO_WORK WITH THE STUDIO PREFERRED. It used to be a separate
    // hand-rolled walker fifteen lines further down, and it was strictly the worse one:
    // one tile per 15s tick instead of four, no blocked-commute warning, no late-arrival
    // catch-up, and a silent `return 'RUNNING'` forever when no path existed. It is
    // offered in the VINE editor next to GO_TO_WORK with nothing to tell an author they
    // are picking the crippled one — and a cast walking at a quarter speed blows through
    // a call lead sized for the real walk. Same body, one difference: the studio wins the
    // zone lookup, since that's the whole reason an author reached for this verb.
    case 'GO_TO_STUDIO':
    case 'GO_TO_WORK': {
      if (!ai) break;
      const { zone_id, arrive_by, depart_early_minutes = 0 } = params;
      const workZoneRaw = type === 'GO_TO_STUDIO'
        ? (zone_id || entity.studio_zone_id || getNpcStudioZone(entity.id) || entity.work_zone_id)
        : (zone_id || entity.work_zone_id || entity.studio_zone_id || getNpcStudioZone(entity.id));
      if (!workZoneRaw) break;
      // Facade → interior entry zone, so path + arrival agree (no-op for non-buildings).
      const workZone = resolveLanding(workZoneRaw);

      // Already at work — let graph continue to work activity nodes
      if (zoneId === workZone) break;

      // Explicit timing params: hold off until the commute window opens.
      // No params (e.g. driven by CHECK_WORK, which already decided it's time): walk immediately.
      if (zone_id && arrive_by != null) {
        const path = findPath(zoneId, workZone, entity);
        if (!path || path.length < 2) return 'RUNNING'; // unreachable — hold and retry
        const env = getEnvironmentState();
        const { minutes, timeScale } = env;
        // How long the walk actually takes, in the GAME-minutes the schedule is
        // written in. The old form assumed one tile per game-minute, which was
        // never true and is 16x off now — a worker three tiles from their shop
        // was holding for three minutes to make a walk of about eleven seconds.
        const tiles = path.length - 1;
        const travelMinutes = Math.max(1, Math.ceil((tiles / COMMUTE_TILES_PER_REAL_MIN) * (timeScale || 1)));
        // Buffer so they're early rather than late: half the trip again, never
        // less than 5 game-minutes. A long cross-town commute gets proportionally
        // more slack, which is where a blocked door or a detour actually costs.
        const buffer = Math.max(5, Math.ceil(travelMinutes * 0.5));
        const arriveAtMinutes = ((arrive_by * 60) - depart_early_minutes + 1440) % 1440;
        const minutesUntilArrival = (arriveAtMinutes - minutes + 1440) % 1440;

        // ── Late-arrival catch-up ────────────────────────────────────────────
        // The window above is a forward countdown on a 24h ring, so an NPC who
        // MISSED their arrival reads as ~1439 minutes early and holds until
        // tomorrow — they'd sit at home through the entire shift they were late
        // for. Anything that eats the window causes this: a locked front door, a
        // path that opened late, a server restart mid-morning, a dev clock jump.
        //
        // "Are they late?" is not answered with a grace constant, because the
        // game already knows: their own schedule says whether they should be
        // standing at work RIGHT NOW. Ask that first, and only fall back to a
        // window for NPCs carrying bare arrive_by params with no schedule behind
        // them (nothing else can speak for those).
        const lateBy = (minutes - arriveAtMinutes + 1440) % 1440;
        const shiftSaysWorkNow = isNpcScheduledNow(entity.id) ||
          (entity.vendor_schedule ? isVendorWorkTime(entity, env).working : false);
        const late = shiftSaysWorkNow
          ? lateBy > 0                        // schedule is authoritative: on the clock and not there → go
          : lateBy > 0 && lateBy <= LATE_CATCHUP_GRACE_MINUTES;

        // Not time to leave yet — hold here so work activities don't start early.
        // A late NPC skips the hold entirely and leaves on this tick.
        if (!late && minutesUntilArrival > travelMinutes + buffer) return 'RUNNING';
      }

      // Time to commute — walk toward destination. Cover several zones per wander
      // tick (a brisk commute) rather than one-zone-per-game-minute, so a worker
      // far from their shop isn't stuck crossing town for half the day.
      if (!ai.patrolPath.length || ai.patrolTarget !== workZone) {
        const path = findPath(zoneId, workZone, entity);
        if (!path || path.length < 2) { warnCommuteBlocked(entity, zoneId, workZone, 'no path'); return 'RUNNING'; }
        ai.patrolPath = path.slice(1);
        ai.patrolTarget = workZone;
        ai.patrolMode = 'walk';
      }
      for (let step = 0; step < COMMUTE_STEPS_PER_TICK && ai.patrolPath.length; step++) {
        const nextZone = ai.patrolPath.shift();
        const moved = moveEntity(entity, nextZone, broadcast, query);
        if (!moved) { warnCommuteBlocked(entity, zoneId, workZone, `blocked at ${nextZone}`); ai.patrolPath = []; ai.patrolTarget = null; break; }
        if (entityZone(entity) === workZone) break; // arrived — let the graph advance
      }
      return 'RUNNING';
    }

    // CHECK_WORK: branch to goToWork or haveLife based on the NPC's current schedule.
    case 'CHECK_WORK': {
      const studioZone = entity.studio_zone_id || getNpcStudioZone(entity.id);
      if (!studioZone) return 'haveLife';
      return isNpcScheduledNow(entity.id) ? 'goToWork' : 'haveLife';
    }

    // BROADCAST_SAY is registered by the broadcast plugin via registerAIAction.

    case 'START_QUEST': {
      // Offer a quest to players sharing this entity's zone. Per-player, per-quest
      // cooldown (blackboard) so it fires once rather than every tick. The quests
      // plugin's START_QUEST handler is a no-op if the player already has it.
      if (!ai) break;
      const questId = params.quest_id;
      if (!questId || !zone) break;
      const cooldown = (params.cooldown_s ?? 60) * 1000;
      const offers = ai.questOffers || (ai.questOffers = {});
      const players = [...zone.players].map(id => getLivePlayer(id)).filter(Boolean);
      for (const p of players) {
        const key = `${questId}:${p.id}`;
        if (Date.now() - (offers[key] || 0) < cooldown) continue;
        offers[key] = Date.now();
        dispatchAction({ type: 'START_QUEST', actor: p, params: { quest_id: questId } }).catch(() => {});
      }
      break;
    }

    case 'GO_HOME': {
      if (!ai) break;
      const home = resolveLanding(entity.home_zone); // facade → interior entry (no-op otherwise)
      if (!home || zoneId === home) break; // already home

      if (!ai.patrolPath.length || ai.patrolTarget !== home) {
        const path = findPath(zoneId, home, entity);
        if (!path || path.length < 2) return 'RUNNING';
        ai.patrolPath = path.slice(1);
        ai.patrolTarget = home;
      }

      const nextZone = ai.patrolPath.shift();
      if (!nextZone) return 'RUNNING';
      const moved = moveEntity(entity, nextZone, broadcast, query);
      if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
      return 'RUNNING';
    }

    case 'SET_FLAG': {
      if (!ai) break;
      if (params.scope === 'self') {
        ai.flags[params.flag] = params.value ?? 'true';
      }
      // world scope: would need async world_flags DB write — skip for now
      break;
    }

    case 'EMOTE': {
      const msg = params.message || '';
      if (!msg) break;
      // Emit the same shape as every other emote (formatChitchat, home-life) so
      // it renders in the shared dim-italic .msg-zone-event colour — not a
      // one-off inline yellow that made VINE emotes stand out from the rest.
      broadcast(zoneId, { type: 'zone_event', message: `${entity.name} ${msg}` });
      break;
    }

    // HAVE_LIFE: do a life activity — skipped when NPC is scheduled to work
    case 'HAVE_LIFE': {
      if (!ai) break;
      if (isNpcScheduledNow(entity.id)) {
        ai._lifeActivity = null; // clear so next off-schedule period re-rolls
        break;
      }
      // Studio actors off-shift never linger in the building: if still inside
      // the studio (same interior map as their studio zone), walk out to the
      // exterior world tile first, one step per tick, before any random life
      // activity begins. Once outside, this block is skipped and the normal
      // wander below takes over. Studio zone resolves via the broadcast bridge
      // (same lookup CHECK_WORK/AT_WORK use); non-studio NPCs skip it entirely.
      const studioZone = entity.studio_zone_id || getNpcStudioZone(entity.id);
      if (studioZone) {
        const sz = world.zones.get(studioZone);
        const cur = world.zones.get(zoneId);
        if (sz && cur && sz.map_id && cur.map_id === sz.map_id) {
          const exit = sz.flags?.world_exit_zone || exitTargets(sz, 'out')[0] || null;
          if (exit) {
            if (!ai.patrolPath.length || ai.patrolTarget !== exit) {
              const path = findPath(zoneId, exit, entity);
              if (path && path.length >= 2) {
                ai.patrolPath = path.slice(1);
                ai.patrolTarget = exit;
              }
            }
            const exitNext = ai.patrolPath.shift();
            if (exitNext) {
              const moved = moveEntity(entity, exitNext, broadcast, query);
              if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
              ai._lifeActivity = null; // re-roll wander once clear of the building
              break; // still exiting — don't start a life activity this tick
            }
          }
        }
      }
      // Small per-tick chance to emote or say a chitchat line, independent of movement.
      if (Date.now() - ai.lastSay > 20000 && Math.random() < 0.05) {
        ai.lastSay = Date.now();
        const line = pickChitchatLine(entity, 'life'); // HAVE_LIFE only runs off-shift
        broadcast(zoneId, line
          ? formatChitchat(entity.name, line)
          : { type: 'zone_event', message: `${entity.name} smokes a cigarette.` });
      }
      // Roll a random activity if none is set or we've arrived at the destination
      if (!ai._lifeActivity || (!ai.patrolPath.length && zoneId === ai.patrolTarget)) {
        ai._lifeActivity = Math.random() < 0.5 ? 'patrol' : 'home';
        ai.patrolPath = [];
        ai.patrolTarget = null;
      }
      let hlife_dest = null;
      if (ai._lifeActivity === 'home') {
        hlife_dest = resolveLanding(entity.home_zone) || null; // facade → interior entry
      } else {
        // patrol: pick a destination zone.
        // Unemployed NPCs with a haunt_zone (or haunt_zones array) prefer their hang-out spot 70% of the time.
        if (!ai.patrolTarget) {
          const hauntZone = entity.npc_type === 'unemployed'
            ? (Array.isArray(entity.flags?.haunt_zones) && entity.flags.haunt_zones.length
                ? entity.flags.haunt_zones[Math.floor(Math.random() * entity.flags.haunt_zones.length)]
                : (entity.flags?.haunt_zone || null))
            : null;

          if (hauntZone && Math.random() < 0.7) {
            ai.patrolTarget = hauntZone;
          } else {
            const safe = [];
            const safeOnly = entity.flags?.safe_zones_only;
            for (const [sid, sz] of world.zones) {
              if (sz.map_id !== 'map_world') continue;
              if (sz.flags?.is_interior || sz.flags?.is_apartment) continue;
              // Never TARGET an enterable facade — forwarding would strand the
              // wanderer in the lobby with `zoneId === patrolTarget` never true
              // (walking through one mid-path is fine and self-heals).
              if (isEnterableFacade(sz)) continue;
              // Inferred danger. (The old set included 'very_high'/'extreme',
              // values that never existed — lethal zones were never avoided.)
              if (safeOnly ? !isSanctuary(sz) : DANGER_RANK[zoneDanger(sz)] >= DANGER_RANK.high) continue;
              safe.push(sid);
            }
            ai.patrolTarget = safe.length ? safe[Math.floor(Math.random() * safe.length)] : entity.home_zone;
          }
        }
        hlife_dest = ai.patrolTarget;
      }
      if (!hlife_dest || zoneId === hlife_dest) { ai._lifeActivity = null; break; }
      if (!ai.patrolPath.length || ai.patrolTarget !== hlife_dest) {
        const path = findPath(zoneId, hlife_dest, entity);
        if (!path || path.length < 2) { ai._lifeActivity = null; break; }
        ai.patrolPath = path.slice(1);
        ai.patrolTarget = hlife_dest;
      }
      const hlife_next = ai.patrolPath.shift();
      if (hlife_next) {
        const moved = moveEntity(entity, hlife_next, broadcast, query);
        if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; ai._lifeActivity = null; }
      }
      break; // does NOT return RUNNING — graph continues to GO_TO_WORK each tick
    }

    // AT_WORK: hold at studio while scheduled; fall through when shift ends so graph routes to GO_HOME.
    case 'AT_WORK': {
      if (isNpcScheduledNow(entity.id)) {
        // On the clock at the studio — occasional WORK chitchat (venue/job flavour).
        if (ai && Date.now() - ai.lastSay > 20000 && Math.random() < 0.05) {
          ai.lastSay = Date.now();
          const line = pickChitchatLine(entity, 'work');
          if (line) broadcast(zoneId, formatChitchat(entity.name, line));
        }
        return 'RUNNING';
      }
      // Shift ended — fall through to 'next' so the graph can route to GO_HOME
      break;
    }

    // ── Vendor-specific actions ──────────────────────────────────────────────

    // CHECK_VENDOR_WORK: 4-way branch for any scheduled NPC's daily routine
    // (vendors and other employed NPCs alike — driven by entity.vendor_schedule).
    // Ports: goToWork | haveLife | endShift | offWork
    case 'CHECK_VENDOR_WORK': {
      const env = getEnvironmentState();
      const { working, dayHasSchedule, referenceRange } = isVendorWorkTime(entity, env);
      const hour = env.hour ?? 0;

      if (working) {
        if (!entity.work_zone_id) return 'haveLife';
        ai.vendor_was_working = true;
        return 'goToWork';
      }

      // Shift just ended
      if (ai.vendor_was_working) {
        ai.vendor_was_working = false;
        return 'endShift';
      }

      // Day off — use reference range to decide have-life vs off-work hours
      if (!dayHasSchedule && referenceRange) {
        const { from = 0, to = 24 } = referenceRange;
        if (hour >= from && hour < to) return 'haveLife';
      }

      return 'offWork';
    }

    // VENDOR_CHITCHAT: say a chitchat line from entity.chitchat.
    //
    // A bare cooldown makes a vendor a METRONOME: the node runs every tick, so the
    // first tick past the cooldown always speaks and the shop talks at you on a
    // fixed beat you can set a watch by. The floor is now a floor, and past it the
    // line is a ROLL — so the gaps are uneven, which is what idle talk sounds like.
    // (The line itself is chosen by the no-repeat bag; see pickFresh.)
    case 'VENDOR_CHITCHAT': {
      if (!ai) break;
      if (Date.now() - ai.lastSay < 75000) break;
      if (Math.random() > 0.25) break;
      const line = pickChitchatLine(entity);
      if (!line) break;
      ai.lastSay = Date.now();
      broadcast(zoneId, formatChitchat(entity.name, line));
      break;
    }

    // AT_HOME_LIFE: NPC does home activities and can fall asleep until near their next shift.
    case 'AT_HOME_LIFE': {
      if (!ai) break;
      const zoneId = entityZone(entity);
      const now = Date.now();

      // Waking up from sleep — waitUntil was already cleared by the tick
      if (ai.homeSleeping) {
        wakeNpc(entity);
        broadcast(zoneId, { type: 'zone_event', message: `${entity.name} stirs and wakes up.` });
        break;
      }

      // Activities are handled by the passive home-life ticker in tickEntityAI.
      // This node only manages the sleep cycle so the graph can loop back to check_work.

      // ── Is it bedtime? ───────────────────────────────────────────────────────
      // Three gates, all of which exist because an NPC used to walk through their
      // own front door and be asleep within a couple of ticks, which meant the
      // home-life half of their day effectively never ran.
      //
      //  1. An evening first. HOME_LIFE_MIN_MINS of waking home life before bed
      //     is even considered.
      //  2. Not straight after being woken — a player who shakes someone awake
      //     gets to have the conversation.
      //  3. Nobody turns in nine-plus hours early. If the next shift is a long
      //     way off, they stay up and keep living instead.
      if (ai.wokenUntil && now < ai.wokenUntil) break;
      if (!ai.homeAwakeSince) ai.homeAwakeSince = now;
      if (now - ai.homeAwakeSince < gameMsToReal(HOME_LIFE_MIN_MINS * 60_000)) break;

      const wakeMs = getNextShiftWakeMs(entity);
      if (wakeMs === null || wakeMs <= now + 120000) break;
      if (wakeMs - now > gameMsToReal(MAX_SLEEP_MINS * 60_000)) break;

      // A stimulant comedown is the one thing that overrides all of the above
      // pacing: coming down off a jag, you go to bed and you go hard. Set by the
      // npc-drugs plugin (`ai.crashSleepy`), read here — the same "plugin owns
      // the state, engine reads one field" contract as ai.dosedOut.
      const crashing = ai.crashSleepy && now < ai.crashSleepy;
      if (Math.random() < (crashing ? 0.5 : 0.15)) {
        // Find something to sleep on in the zone (prefer furniture, floor fallback)
        let bedName = null;
        try {
          const BED_WORDS = /\b(bed|cot|couch|mattress|sofa|futon|bunk|hammock)\b/i;
          const { rows: furnRows } = await query(
            `SELECT name FROM furniture WHERE zone_id=$1 LIMIT 20`, [zoneId]
          );
          const bedFurn = furnRows.find(f => BED_WORDS.test(f.name));
          if (bedFurn) bedName = bedFurn.name;
        } catch (_) {}
        const sleepOn = bedName ? `the ${bedName}` : 'the floor';
        ai.homeSleeping = true;
        ai.waitUntil = wakeMs;
        ai.sleepStartedAt = now;
        ai.disturbCount = 0;
        ai.wokeMood = null;
        // Real posture, same substrate as players: lying, bound to the furniture
        // (sittingOn = furniture name, or null for the ground).
        setPosture(entity, 'lying', { sittingOn: bedName });
        broadcast(zoneId, { type: 'zone_event', message: crashing
          ? `${entity.name} folds onto ${sleepOn} mid-sentence, finally out of whatever was holding them up.`
          : `${entity.name} lies down on ${sleepOn} and falls asleep.` });
        return 'RUNNING';
      }
      break;
    }

    // VENDOR_COLLECT_SAFE: find linked safe in work zone, take 25% of vendor_credits.
    case 'VENDOR_COLLECT_SAFE': {
      if (!ai) break;

      try {
        // Find the safe by its LINK, not by the work zone.
        //
        // It used to require `work_zone_id` and search only there, which quietly
        // did nothing for any vendor whose safe lives somewhere else — a dealer
        // keeping the takings at home rather than behind a counter, say. Both
        // Coldwater dealers were in exactly that state: safes bolted down in one
        // district, owners living in another, and the collect step bailing on its
        // first line so the money never moved.
        //
        // Searching by link finds it wherever it is, and the zone check below
        // makes the physical journey the requirement instead of a config field.
        // Owner's own box, or a SHARED one they're named on the staff list of.
        //
        // A shop can be more than one person. Ration Nine has three — one of them
        // sells and two of them cut meat — and the till they all feed is one box
        // under one counter. So a safe names an owner (`vendor_npc_id`, whose
        // `vendor_credits` IS the till) and may name `vendor_staff`: other workers
        // who draw wages out of the same box. Without this a shop with staff
        // needed a safe each, and the two who never take money would stand at
        // empty boxes forever.
        const { rows: safeRows } = await query(
          `SELECT id, flags, zone_id FROM furniture
           WHERE flags @> '{"vendor_safe":true}'
             AND (flags->>'vendor_npc_id' = $1 OR jsonb_exists(flags->'vendor_staff', $1))
           LIMIT 1`,
          [entity.id]
        );
        if (!safeRows.length) break;
        // You have to actually be standing at it. This is what turns "collect the
        // takings" into a thing the player can witness, intercept, or beat you to.
        if (safeRows[0].zone_id && entity.zone_id !== safeRows[0].zone_id) break;

        // Whose money is in the box. For an owner that's their own live row (the
        // write funnel keeps `vendor_credits` in sync, so no fresh SELECT); for
        // staff it's the owner's, because the staff member never took any.
        const ownerId = safeRows[0].flags?.vendor_npc_id || entity.id;
        const till = ownerId === entity.id ? entity : world.npcs.get(ownerId);
        if (!till) break;

        const total = till.vendor_credits || 0;
        if (!total) break;
        // The owner takes an owner's quarter; a hired hand takes a wage.
        const amount = Math.floor(total * (ownerId === entity.id ? 0.25 : 0.1));
        if (amount <= 0) break;

        await updateNpc(till.id, { vendor_credits: total - amount });
        ai.vendor_carrying = amount;
        ai.vendor_atm_zone = null; // reset so VENDOR_GO_TO_ATM re-queries

        broadcast(workZone, {
          type: 'output',
          message: `<span style="color:var(--text-dim);font-style:italic">${entity.name} opens the safe, counts out ${ownerId === entity.id ? 'their cut' : 'their wages'}, and closes it again.</span>`,
        });
      } catch (e) {
        // Non-fatal — continue graph even if safe interaction fails
      }
      break;
    }

    // VENDOR_GO_TO_ATM: find nearest non-broken ATM and walk toward it. RUNNING until arrived.
    case 'VENDOR_GO_TO_ATM': {
      if (!ai) break;

      // Find nearest ATM zone if not already cached
      if (!ai.vendor_atm_zone) {
        try {
          const { rows: atmRows } = await query(
            `SELECT f.zone_id FROM furniture f
             JOIN atm_units a ON a.id = f.id
             WHERE f.flags @> '{"atm":true}' AND a.is_broken = 0`
          );
          const candidateZones = atmRows.map(r => r.zone_id).filter(Boolean);
          if (!candidateZones.length) break;

          // A day's takings go to the BANK, not to whatever lobby machine happens
          // to be closest — otherwise every employed NPC in the district queues at
          // the same hotel terminal and the place reads like a bank it isn't.
          // A bank is derived, never authored: it's a zone a `bank_teller` NPC is
          // posted in (home_zone, so an off-shift teller doesn't un-bank the hall).
          // No query — world.npcs is in memory. Falls back to any ATM if no bank
          // terminal is reachable.
          const bankZones = new Set();
          for (const n of world.npcs.values()) {
            if (n?.flags?.bank_teller) bankZones.add(n.home_zone || n.zone_id);
          }
          const preferred = candidateZones.filter(z => bankZones.has(z));

          // BFS to find closest — bank terminals first, any terminal only if no
          // bank hall is walkable from here.
          let bestZone = null, bestDist = Infinity;
          const pickNearest = (zones) => {
            for (const z of zones) {
              const path = findPath(zoneId, z, entity);
              if (path && path.length - 1 < bestDist) {
                bestDist = path.length - 1;
                bestZone = z;
              }
            }
          };
          if (preferred.length) pickNearest(preferred);
          if (!bestZone) pickNearest(candidateZones);
          if (!bestZone) break;
          ai.vendor_atm_zone = bestZone;
        } catch (e) {
          break;
        }
      }

      const atmZone = resolveLanding(ai.vendor_atm_zone); // facade → interior entry (no-op otherwise)
      if (!atmZone || zoneId === atmZone) {
        ai.vendor_atm_zone = null; // arrived — clear for next time
        break;
      }

      if (!ai.patrolPath.length || ai.patrolTarget !== atmZone) {
        const path = findPath(zoneId, atmZone, entity);
        if (!path || path.length < 2) return 'RUNNING';
        ai.patrolPath = path.slice(1);
        ai.patrolTarget = atmZone;
      }

      const nextZone = ai.patrolPath.shift();
      if (!nextZone) return 'RUNNING';
      const moved = moveEntity(entity, nextZone, broadcast, query);
      if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
      return 'RUNNING';
    }

    // VENDOR_DEPOSIT: add carried credits to vendor bank balance.
    case 'VENDOR_DEPOSIT': {
      if (!ai || ai.vendor_carrying <= 0) break;
      const amount = ai.vendor_carrying;
      try {
        await updateNpc(entity.id, { vendor_bank_credits: (entity.vendor_bank_credits || 0) + amount });
      } catch (e) {
        // Non-fatal
      }
      ai.vendor_carrying = 0;
      broadcast(zoneId, {
        type: 'output',
        message: `<span style="color:var(--text-dim);font-style:italic">${entity.name} finishes at the ATM terminal.</span>`,
      });
      break;
    }

    // (GO_TO_STUDIO is handled with GO_TO_WORK above — see the note there.)

    // ── Talk-show guest lifecycle ────────────────────────────────────────────
    // The reusable guest lives off-world in a hidden backstage zone (entity.home_zone)
    // between episodes. When the show is on the clock it MATERIALISES into a random
    // unobserved zone near the studio (no players, no camera/sticky-cam watching) — so a
    // player never witnesses it "appear" — and the stock GO_TO_WORK then walks it onstage.
    case 'TALKSHOW_APPEAR': {
      if (!ai) break;
      const home = entity.home_zone;
      const here = entityZone(entity);
      if (!home || here !== home) break;   // already out in the world — commute handles the rest
      const studioZone = entity.work_zone_id || entity.studio_zone_id || getNpcStudioZone(entity.id);
      if (!studioZone) break;
      const origin = pickUnobservedZoneNear(studioZone, entity)
        || getZone(studioZone)?.flags?.world_exit_zone
        || exitTargets(getZone(studioZone), 'out')[0]
        || null;
      if (origin && origin !== home) {
        moveEntity(entity, origin, broadcast, query, { teleport: true });   // non-adjacent by design: backstage has no exits
        ai.patrolPath = []; ai.patrolTarget = null;
      }
      break;   // next tick: GO_TO_WORK commutes it to the stage
    }

    // Off the clock: slip out and VANISH back to backstage the instant nobody's watching.
    // If standing somewhere unobserved, disappear now; otherwise walk one step toward the
    // studio's exterior (away from the on-camera stage) and re-check next tick.
    case 'TALKSHOW_HIDE': {
      if (!ai) break;
      const home = entity.home_zone;
      const here = entityZone(entity);
      if (!home || here === home) break;   // no backstage set, or already hidden
      if (!getZonePlayers(here).length && !isZoneWatched(here)) {
        moveEntity(entity, home, broadcast, query, { teleport: true });     // unobserved → vanish to backstage
        ai.patrolPath = []; ai.patrolTarget = null;
        break;
      }
      const studioZone = entity.work_zone_id || entity.studio_zone_id || getNpcStudioZone(entity.id);
      const sz = studioZone ? getZone(studioZone) : null;
      const target = sz?.flags?.world_exit_zone || (sz ? exitTargets(sz, 'out')[0] : null) || null;
      if (target && here !== target) {
        if (!ai.patrolPath.length || ai.patrolTarget !== target) {
          const path = findPath(here, target, entity);
          if (path && path.length >= 2) { ai.patrolPath = path.slice(1); ai.patrolTarget = target; }
        }
        const nextZone = ai.patrolPath.shift();
        if (nextZone) { const moved = moveEntity(entity, nextZone, broadcast, query); if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; } }
        break;
      }
      // At/near the exit but still watched — drift to a neighbour and try again next tick.
      const nbs = neighborZoneIds(getZone(here)).filter(z => getZone(z));
      if (nbs.length) moveEntity(entity, nbs[Math.floor(Math.random() * nbs.length)], broadcast, query);
      break;
    }

    default: {
      const fn = pluginActions.get(type);
      if (fn) {
        try { return await fn(entity, params, { broadcast, query, ai, zone, zoneId, node }); }
        catch (e) { console.error(`[ai:action:${type}] ${e.message}`); }
      }
      break;
    }
  }
}

// ── Default vendor/schedule behaviour graph ──────────────────────────────────

/**
 * Auto-generate a default VINE-compatible behaviour graph for any NPC that
 * respects a manual vendor_schedule (vendors and other employed NPCs alike).
 * The vendor-only steps (collect_safe/go_to_atm/deposit) no-op harmlessly for
 * non-selling jobs with no linked safe. Broadcast actors use
 * buildDefaultStudioGraph() instead — they follow the broadcast schedule, not
 * a manual one. Stored in npcs.behaviour_graph and editable in the VINE editor.
 */
export function buildDefaultVendorGraph() {
  return {
    _start: 'start',
    nodes: {
      start:          { type: 'start', next: 'check_work' },
      check_work:     { type: 'action', action_type: 'CHECK_VENDOR_WORK',
                        goToWork: 'go_to_work', haveLife: 'have_life',
                        endShift: 'cash_up', offWork: 'off_home_check' },
      // Closing up takes as long as it takes. Shifts end on shared clock hours, so
      // without this spread the whole district walks to the bank in one column.
      cash_up:        { type: 'wait', seconds: 20, jitter: 900, next: 'collect_safe' },
      go_to_work:     { type: 'action', action_type: 'GO_TO_WORK', next: 'work_wait' },
      work_wait:      { type: 'wait', seconds: 60, next: 'player_check' },
      player_check:   { type: 'condition', condition_type: 'PLAYER_IN_ZONE',
                        ifTrue: 'work_say', ifFalse: 'check_work' },
      work_say:       { type: 'action', action_type: 'VENDOR_CHITCHAT', next: 'check_work' },
      have_life:      { type: 'action', action_type: 'HAVE_LIFE', next: 'check_work' },
      collect_safe:   { type: 'action', action_type: 'VENDOR_COLLECT_SAFE', next: 'go_to_atm' },
      go_to_atm:      { type: 'action', action_type: 'VENDOR_GO_TO_ATM', next: 'atm_emote' },
      atm_emote:      { type: 'action', action_type: 'EMOTE',
                        params: { message: 'steps up to the ATM terminal and makes a deposit.' },
                        next: 'atm_wait' },
      atm_wait:       { type: 'wait', seconds: 10, jitter: 20, next: 'deposit' },
      deposit:        { type: 'action', action_type: 'VENDOR_DEPOSIT', next: 'post_shift' },
      post_shift:     { type: 'random', branches: [{ weight: 1 }, { weight: 5 }],
                        branch_0: 'have_life', branch_1: 'go_home_ps' },
      go_home_ps:     { type: 'action', action_type: 'GO_HOME', next: 'home_life_ps' },
      home_life_ps:   { type: 'action', action_type: 'AT_HOME_LIFE', next: 'check_work' },
      off_home_check: { type: 'condition', condition_type: 'AT_HOME',
                        ifTrue: 'home_idle', ifFalse: 'off_random' },
      home_idle:      { type: 'action', action_type: 'AT_HOME_LIFE', next: 'check_work' },
      off_random:     { type: 'random', branches: [{ weight: 1 }, { weight: 5 }],
                        branch_0: 'have_life', branch_1: 'go_home_off' },
      go_home_off:    { type: 'action', action_type: 'GO_HOME', next: 'check_work' },
    },
  };
}

/**
 * Default behaviour graph for studio NPCs (broadcast staff with no custom graph).
 * AT_WORK holds RUNNING while scheduled; when the shift ends it falls through to GO_HOME.
 */
export function buildDefaultStudioGraph() {
  return {
    _start: 'start',
    nodes: {
      start:      { type: 'start', next: 'have_life' },
      have_life:  { type: 'action', action_type: 'HAVE_LIFE',   next: 'go_to_work' },
      go_to_work: { type: 'action', action_type: 'GO_TO_WORK',  next: 'at_work' },
      at_work:    { type: 'action', action_type: 'AT_WORK',     next: 'go_home' },
      go_home:    { type: 'action', action_type: 'GO_HOME',     next: 'home_wait' },
      home_wait:  { type: 'wait', seconds: 60, next: 'start' },
    },
  };
}

/**
 * Default behaviour graph for unemployed NPCs.
 * Loops HAVE_LIFE indefinitely. When at home, AT_HOME_LIFE handles the sleep cycle.
 * Wandering destination is weighted toward flags.haunt_zone / flags.haunt_zones.
 */
export function buildDefaultUnemployedGraph() {
  return {
    _start: 'start',
    nodes: {
      start:      { type: 'start', next: 'have_life' },
      have_life:  { type: 'action', action_type: 'HAVE_LIFE', next: 'home_check' },
      home_check: { type: 'condition', condition_type: 'AT_HOME', ifTrue: 'home_idle', ifFalse: 'have_life' },
      home_idle:  { type: 'action', action_type: 'AT_HOME_LIFE', next: 'have_life' },
    },
  };
}

/**
 * Default combat behaviour graph for auto-aggressive enemies (behavior
 * 'aggressive' / 'territorial'). Target *acquisition* is deliberately left to the
 * engine substrate — the escalating-aggro + battlecry ramp in gameLoop still owns
 * "when the fight starts" (and keeps the telegraph). Once a target exists, the
 * graph owns the fight: attack, but break off and flee below 20% HP. This mirrors
 * the hardcoded fallback while adding the flee branch, and every part of it is now
 * editable per-enemy in the VINE editor.
 */
export function buildDefaultAggressiveEnemyGraph() {
  return {
    _start: 'start',
    nodes: {
      start:      { type: 'start', next: 'has_target' },
      has_target: { type: 'condition', condition_type: 'HAS_TARGET', ifTrue: 'low_hp', ifFalse: 'idle' },
      low_hp:     { type: 'condition', condition_type: 'HP_BELOW', params: { pct: 20 }, ifTrue: 'flee', ifFalse: 'attack' },
      flee:       { type: 'action', action_type: 'FLEE',   next: 'loop' },
      attack:     { type: 'action', action_type: 'ATTACK', next: 'loop' },
      idle:       { type: 'action', action_type: 'IDLE',   next: 'loop' },
      loop:       { type: 'loop', next: 'start' },
    },
  };
}

/**
 * Belt-and-suspenders: make sure an entity ticks through VINE rather than the
 * hardcoded fallback, by assigning a type-appropriate default graph when it has
 * none. Mirrors the auto-assign already done for NPCs at apiCreateNpc, extended to
 * cover enemies (which had no auto-assign) and to self-heal legacy graphless rows
 * at load. Returns true if a default was assigned.
 *
 * Intentionally conservative — leaves untouched:
 *   • entities that already carry a graph (authored or previously defaulted);
 *   • `_phantom` opt-outs (e.g. trip-plugin phantoms);
 *   • non-aggressive enemies (passive/defensive never auto-acquire — the benign
 *     fallback is correct for them);
 *   • plain untyped 'npc' extras / static set-pieces (only vendors, employed,
 *     unemployed and studio actors are meant to be autonomous).
 *
 * `kind` ('enemy' | 'npc') is inferred from instanceId when omitted, but callers
 * acting on template rows (pre-instance) should pass it explicitly.
 */
export function ensureBehaviourGraph(entity, kind) {
  if (!entity) return false;
  const g = entity.behaviour_graph;
  if (g && (g._start || Object.keys(g).length)) return false; // already has a graph
  if (entity.flags?._phantom) return false;                    // deliberately inert

  const isEnemyEntity = kind ? kind === 'enemy' : entity.instanceId != null;

  if (isEnemyEntity) {
    if (entity.behavior === 'aggressive' || entity.behavior === 'territorial') {
      entity.behaviour_graph = buildDefaultAggressiveEnemyGraph();
      return true;
    }
    return false;
  }

  const isActor = !!entity.studio_zone_id;
  const autonomous = isActor || entity.npc_type === 'unemployed'
    || entity.npc_type === 'vendor' || !!entity.work_zone_id;
  if (!autonomous) return false;
  entity.behaviour_graph = entity.npc_type === 'unemployed'
    ? buildDefaultUnemployedGraph()
    : isActor ? buildDefaultStudioGraph() : buildDefaultVendorGraph();
  return true;
}

// ── Main tick ────────────────────────────────────────────────────────────────

const MAX_STEPS = 50;

// A commute that can't complete used to be perfectly silent: GO_TO_WORK returns
// RUNNING and retries the same impossible hop on every tick, forever, while the
// shop it belongs to simply has nobody behind the counter. The only way to notice
// was for a player to walk in and wonder where the vendor went. One line per NPC
// per hour is enough to make a stranded worker findable in the log without a tick
// loop spamming it. In memory only — this is diagnostics, never state.
const _commuteWarned = new Map(); // npc id -> last warn ms
const COMMUTE_WARN_MS = 60 * 60 * 1000;
function warnCommuteBlocked(entity, fromZone, workZone, why) {
  const now = Date.now();
  if (now - (_commuteWarned.get(entity.id) || 0) < COMMUTE_WARN_MS) return;
  _commuteWarned.set(entity.id, now);
  console.warn(`[ai] ${entity.name} (${entity.id}) cannot reach work: ${fromZone} -> ${workZone} (${why}); home_zone=${entity.home_zone}`);
}

// A step the adjacency law refused. Same throttle and same reasoning as the
// commute warning: one line per entity per hour is enough to find whoever is
// fighting the AI over an entity's position, without a tick loop filling the log.
const _staleStepWarned = new Map(); // entity id -> last warn ms
function warnStaleStep(entity, fromZone, toZone) {
  const key = entity.instanceId || entity.id;
  const now = Date.now();
  if (now - (_staleStepWarned.get(key) || 0) < COMMUTE_WARN_MS) return;
  _staleStepWarned.set(key, now);
  console.warn(`[ai] ${entity.name} (${key}) stale step refused: ${fromZone} -> ${toZone} (no exit between them; route dropped)`);
}

let _espShelterActive = false;
export function setEspShelter(active) { _espShelterActive = !!active; }

export async function tickEntityAI(entity, ctx) {
  // Normalize DB format (inline connections + flat data) to runtime format on first tick
  if (entity.behaviour_graph && !entity.behaviour_graph._normalized) {
    entity.behaviour_graph = normalizeGraph(entity.behaviour_graph);
  }
  const graph = entity.behaviour_graph;
  if (!graph || !graph._start) return;

  const ai = entity._ai;
  if (!ai) return;

  // Not placed in any zone — an unplaced entity has no room to act in. Ticking it
  // anyway makes zone-scoped broadcasts (SAY/EMOTE/home-life) fall through to a
  // null zone, which the server treats as a global send — so its lines leak to
  // every connected player. Skip it until it's given a zone.
  if (!entityZone(entity)) return;

  // Something has taken this NPC over and is driving it directly — a break-in
  // alarm (burglary plugin) or ordinary fright (engine/panic.js). Suspend the
  // normal graph (and the passive home-life below) until the driver clears it.
  //
  // ⚠ THIS FLAG IS NOT A BEHAVIOUR. It only yields the graph; it makes the NPC
  // do nothing at all. Setting it without a driver to clear it freezes that NPC
  // permanently. Go through panicNpc() unless you own the whole sequence.
  if (ai.alarm) return;

  // Dosed unconscious or panicking (npc-drugs plugin) — the plugin drives the
  // slumped/fleeing NPC directly. Same contract as ai.alarm: while the flag is
  // set the engine yields the graph (and the passive home-life below).
  if (ai.dosedOut) return;

  // Don't tick while a player has this NPC's shop open — but VERIFY the session is
  // still real before yielding, rather than trusting the flag.
  //
  // `shopPaused` freezes an NPC COMPLETELY: no graph, no commute, no banter, no
  // wander. It's cleared from exactly three places — the client's `shop_close`, a
  // disconnect, and cmdMove (movement.js). A player's `current_zone` is rewritten in
  // a dozen places that never go near cmdMove: sleep (dreamscape), death/respawn,
  // jail, elevators, flight, apartment entry, VINE teleports. Leave a shop open and
  // exit by any of those and the flag stayed set FOREVER — the vendor stood at their
  // counter until the next restart. Brack the Fishmonger was found welded to the
  // Ration Nine fish slab this way, having never once walked home to Unit 305.
  //
  // Deriving the pause from "the shopper is still standing here" fixes every one of
  // those call sites at once, and can't be defeated by the next teleport somebody
  // adds. Both reads are in-memory, so this costs nothing on the tick.
  if (ai.shopPaused) {
    const shopperId = getShopperForNpc(entity.id);
    const shopper = shopperId ? getLivePlayer(shopperId) : null;
    if (shopper && shopper.current_zone === entityZone(entity)) return;
    if (shopperId) closeShopSession(shopperId);
    ai.shopPaused = false; // also clears a pause with no session behind it at all
  }

  // Passive home life — any NPC in their home zone does random activities when players are watching.
  // Skipped while homeSleeping (the NPC is visibly asleep; AT_HOME_LIFE owns that state).
  //
  // TWO questions, deliberately not one:
  //   atHomeZone — standing where home_zone points. Governs washing and the
  //                evening clock, both of which are true of anywhere you live,
  //                including a bunk behind the counter.
  //   atHome     — ...and that place is somewhere a person could actually LIVE.
  //                Governs the visible domestic activities. Most of the cast is
  //                registered as living at their own workplace, and without this
  //                test a shopkeeper tidies her apartment in front of customers
  //                and eleven studio actors microwave something questionable on a
  //                live set. A workplace passes neither dwelling flag, on purpose.
  const atHomeZone = !isEnemy(entity) && entity.home_zone && entityZone(entity) === entity.home_zone;
  const atHome = atHomeZone && isDwellingZone(getZone(entity.home_zone));
  // Edge-detect arriving home, so the "have an evening before bed" clock in
  // AT_HOME_LIFE measures THIS visit rather than a timestamp left over from
  // yesterday (which would let them go straight to bed on walking in).
  if (atHomeZone && !ai._wasHome) { ai._wasHome = true; ai.homeAwakeSince = Date.now(); }
  else if (!atHomeZone && !ai.homeSleeping) { ai._wasHome = false; ai.homeAwakeSince = 0; }

  // Being home means washing. Without this an NPC's grime clock starts the first
  // time anything asks and climbs forever, so given enough uptime every NPC in the
  // world ends up reeking. Keyed to atHomeZone, NOT atHome: someone who lives over
  // the shop still has a sink. In memory only — NPC hygiene is never persisted, so
  // this is a field reset, not a write.
  if (atHomeZone && !ai.homeSleeping) npcWashAtHome(entity);

  if (atHome && !ai.homeSleeping) {
    const now = Date.now();
    if ((now - (ai.lastHomeSay || 0)) > 30000) {
      const playersHere = getZonePlayers(entityZone(entity));
      if (playersHere.length && Math.random() < 0.3) {
        ai.lastHomeSay = now;
        // Freshly dragged out of bed, they act like it — for as long as the wake
        // grace runs, then it's back to ordinary home life.
        const woke = ai.wokeMood && now < ai.wokeMood.until ? ai.wokeMood.mood : null;
        const pool = woke ? WOKEN_ACTIVITIES[woke]
          : (Array.isArray(entity.home_activities) && entity.home_activities.length)
            ? entity.home_activities : DEFAULT_HOME_ACTIVITIES;
        // Same no-repeat bag as chitchat — a player watching somebody's evening
        // at home is standing in the room for every line of it.
        const act = pickFresh(entity, pool, 'home');
        const { type: actType, message: actMsg } = formatChitchat(entity.name, act);
        ctx.broadcast(entityZone(entity), { type: actType, message: actMsg });
      } else if (playersHere.length) {
        ai.lastHomeSay = now;
      }
    }
  }

  // ESP: override all NPC behaviour — route everyone home until stand-down.
  if (_espShelterActive && !isEnemy(entity) && entity.home_zone) {
    const zoneId = entityZone(entity);
    const homeTarget = resolveLanding(entity.home_zone); // facade → interior entry (no-op otherwise)
    if (zoneId !== homeTarget) {
      if (!ai.patrolPath.length || ai.patrolTarget !== homeTarget) {
        const path = findPath(zoneId, homeTarget, entity);
        if (path && path.length >= 2) { ai.patrolPath = path.slice(1); ai.patrolTarget = homeTarget; }
      }
      const next = ai.patrolPath.shift();
      if (next) {
        const moved = moveEntity(entity, next, ctx.broadcast, ctx.query);
        if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
      }
    }
    return;
  }

  // Studio actors NEVER linger in their workspace off-shift — enforced here, before
  // and independent of whatever behaviour graph the NPC carries, so there are no
  // exceptions: an active scheduled slot is the ONLY thing that keeps an actor in the
  // studio. Any actor sitting in (or anywhere inside) their studio while unscheduled is
  // walked out toward the exterior, one step per tick, and the graph is skipped until
  // they're clear of the building.
  if (!isEnemy(entity)) {
    const studioZone = entity.studio_zone_id || getNpcStudioZone(entity.id);
    if (studioZone && !isNpcScheduledNow(entity.id)) {
      const hereId = entityZone(entity);
      const cur = world.zones.get(hereId);
      const sz  = world.zones.get(studioZone);
      const insideStudio = hereId === studioZone
        || (cur && sz && sz.map_id && cur.map_id === sz.map_id && cur.flags?.is_interior);
      if (insideStudio && sz) {
        // Prefer the building's declared exterior seam, then an `out` exit, then home —
        // home_zone guarantees a reachable target so an actor is never trapped on set.
        const dest = sz.flags?.world_exit_zone || exitTargets(sz, 'out')[0] || entity.home_zone || null;
        if (dest && hereId !== dest) {
          if (!ai.patrolPath.length || ai.patrolTarget !== dest) {
            const path = findPath(hereId, dest, entity);
            if (path && path.length >= 2) { ai.patrolPath = path.slice(1); ai.patrolTarget = dest; }
          }
          const next = ai.patrolPath.shift();
          if (next) {
            const moved = moveEntity(entity, next, ctx.broadcast, ctx.query);
            if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
          }
          return; // evacuating — skip the graph this tick
        }
      }
    }
  }

  // Check if suspended in a WAIT — currentNode already points to the resume target
  if (ai.waitUntil && Date.now() < ai.waitUntil) return;
  ai.waitUntil = null;

  const nodes = graph.nodes;
  if (!nodes) return;
  const edges = graph.edges || [];

  // Resume from cursor if set, else restart from _start
  let nodeId = ai.currentNode || graph._start;
  ai.currentNode = null; // clear — will be re-set if execution suspends

  let steps = 0;

  while (nodeId && steps++ < MAX_STEPS) {
    const node = nodes[nodeId];
    if (!node) break;

    switch (node.type) {
      case 'start':
        nodeId = resolveEdge(edges, nodeId, 'next');
        break;

      case 'condition': {
        const result = evalCondition(node, entity);
        nodeId = resolveEdge(edges, nodeId, result ? 'ifTrue' : 'ifFalse');
        break;
      }

      case 'action': {
        const result = await execAction(node, entity, ctx);
        // RUNNING: stay at this node next tick. A string result (other than RUNNING) names
        // the outgoing port to follow (e.g. CHECK_WORK's 'goToWork'/'haveLife'). Anything
        // else (true/false/undefined from ordinary actions) falls back to the 'next' port.
        ai.currentNode = (result === 'RUNNING')
          ? nodeId
          : resolveEdge(edges, nodeId, typeof result === 'string' ? result : 'next');
        return;
      }

      case 'wait': {
        // `jitter` (optional, seconds) spreads a wait over [seconds, seconds+jitter).
        // Without it, every NPC that reaches the same node on the same tick — every
        // vendor whose shift ends at 18:00, say — leaves in lockstep and arrives as
        // a crowd. Rolled per visit, not cached, so a repeated wait re-spreads.
        const seconds = node.data?.seconds ?? 1;
        const jitter = Math.max(0, node.data?.jitter ?? 0);
        ai.waitUntil = Date.now() + (seconds + Math.random() * jitter) * 1000;
        ai.currentNode = resolveEdge(edges, nodeId, 'next'); // resume here after wait
        return;
      }

      case 'loop': {
        // Explicit jump — follow 'next' edge or fall back to _start
        nodeId = resolveEdge(edges, nodeId, 'next') || graph._start;
        break;
      }

      case 'random': {
        const branches = node.data?.branches || [];
        if (!branches.length) { nodeId = null; break; }
        const totalWeight = branches.reduce((s, b) => s + (b.weight ?? 1), 0);
        let roll = Math.random() * totalWeight;
        let chosen = 0;
        for (let i = 0; i < branches.length; i++) {
          roll -= branches[i].weight ?? 1;
          if (roll <= 0) { chosen = i; break; }
        }
        nodeId = resolveEdge(edges, nodeId, `branch_${chosen}`);
        break;
      }

      default:
        nodeId = null;
    }
  }
  // Natural end or MAX_STEPS — currentNode stays null, next tick restarts from _start
}
