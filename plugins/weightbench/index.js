// Weight bench plugin.
//
// A posture-based workout, sibling to scavenging (plugins/scavenging). The flow
// the design calls for: lie back on a bench, then `lift` to start pumping iron.
// `posture === "working_out"` is the authoritative activity flag — it inherits
// every engine force-stand interruption (moving, attacking, being attacked) for
// free, and a companion `player.workoutState` carries the rep bookkeeping.
//
// Gains model (HellMOO-flavoured): each tick is one "set" of reps. Completing
// `needed` sets grants +1 Brawn; `needed` rises with your current Brawn, so it's
// quick at first and brutal near the top, and a soft cap (BRAWN_SOFT_CAP) means a
// free bench can't take you all the way — the last stretch is bought with XP.
//
// The XP economy: raising a stat directly increases the implicit `statSpent`
// (see server/engine/ip.js), which would silently drain a player's Net XP and
// block future `raise`s. So each gym point is compensated back into bonus_xp,
// leaving Net XP flat — the bench is a genuinely *free* source of Brawn, earned
// with reps rather than XP.

import { query } from '../../server/models/db.js';
import { getAllLivePlayers, getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { getPosture, setPosture, forceStand } from '../../server/engine/posture.js';
import { ensureTunables } from '../../server/engine/tunables.js';
import { statCost, grantXp } from '../../server/engine/ip.js';

const SET_MS = 8000;          // one set of reps every 8s — a slow, deliberate grind
const BRAWN_SOFT_CAP = 10;    // the most Brawn a bench alone will build you to
const REPS_BASE = 4;          // sets for the very first point...
const REPS_PER_LEVEL = 2;     // ...plus this many more for each point you already have

// Sets required to earn the next Brawn point at your current level.
function repsForBrawn(brawn) { return REPS_BASE + Math.max(0, brawn) * REPS_PER_LEVEL; }
function brawnOf(player) { return Number(player.stat_brawn) || 0; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function out(pid, message) { sendToPlayer(pid, { type: 'output', message }); }

// ── Pumping-iron flavour ──────────────────────────────────────────────────────

const SET_FLAVOR = [
  'You grind out another set, veins standing up like cabling.',
  'The bar bends. You do not. Another rep bangs home.',
  'You punch out a set, breath hissing through your teeth. Somewhere, a shirt sleeve dies.',
  'Iron up, iron down. Your muscles file a formal complaint.',
  'You crank another rep, grunting loud enough to worry the neighbours.',
  'Rusted plates rattle as you press them skyward one more time.',
  'You squeeze out a set. Your future arms thank you; your present ones scream.',
  'Another rep. The bench creaks a small prayer.',
  'You heave the bar up, hold, and drop it with a clang that rolls off the concrete.',
  'Sweat, grit, and pure spite. You pound through another set.',
  'You stare at the ceiling and will the bar back up. It obeys, eventually.',
  'One more. Always one more. Your shoulders hate this and love it.',
];

const GAIN_LINES = [
  'Something in your shoulders shifts and settles heavier.',
  'The pump hits like a cheap drug — you are, measurably, more of a unit.',
  'New meat on old bone. The bar felt lighter that last set.',
  'You rack it, flex, and catch your reflection. Bigger. Meaner.',
  'A deep ache blooms and hardens into something useful.',
];

// ── State (posture is authoritative — mutate the live object in place) ─────────

function stopWorkout(pid, handle, zoneId, playerLine) {
  const cur = getLivePlayer(pid);
  if (!cur || getPosture(cur) !== 'working_out') return;
  forceStand(cur, 'weightbench.stop');
  delete cur.workoutState;
  if (playerLine) out(pid, playerLine);
  if (zoneId) sendToZone(zoneId, { type: 'zone_event', message: `${handle} racks the weights and stands up.` }, pid);
}

// ── One completed set ──────────────────────────────────────────────────────────

async function runSet(player, st, nowMs) {
  st.lastSet = nowMs;
  st.reps += 1;
  if (st.reps < st.needed) {
    out(player.id, pick(SET_FLAVOR));
    return;
  }

  // Earned a point. If the bench has already given all it can, bow out.
  st.reps = 0;
  const current = brawnOf(player);
  if (current >= BRAWN_SOFT_CAP) {
    stopWorkout(player.id, player.handle, player.current_zone,
      'You\'ve wrung every ounce of gains this bench has to give — the rest you earn out in the world.');
    return;
  }

  await ensureTunables();
  const cost = statCost(current);
  await query('UPDATE players SET stat_brawn = stat_brawn + 1 WHERE id=$1', [player.id]);
  await grantXp(player.id, cost); // keep Net XP flat — the point is free (see header)
  player.stat_brawn = current + 1;
  st.needed = repsForBrawn(current + 1);
  out(player.id, `<span class="item-grant">${pick(GAIN_LINES)} <b>Your Brawn climbs to ${current + 1}.</b></span>`);
  if (current + 1 >= BRAWN_SOFT_CAP)
    out(player.id, 'That\'s about all this old bench has left to teach your body.');
}

// ── Tick ───────────────────────────────────────────────────────────────────────

let ticking = false;
async function workoutTick() {
  if (ticking) return;
  ticking = true;
  try {
    const nowMs = Date.now();
    for (const player of getAllLivePlayers()) {
      const st = player.workoutState;
      if (getPosture(player) === 'working_out') {
        if (!st) continue;
        if (nowMs - st.lastSet < SET_MS) continue;
        await runSet(player, st, nowMs);
      } else if (st) {
        // Posture was cleared out from under us (moved / attacked / stood). Clean up.
        const cur = getLivePlayer(player.id);
        if (cur) delete cur.workoutState;
        out(player.id, 'You break off your workout.');
      }
    }
  } finally {
    ticking = false;
  }
}

setInterval(() => workoutTick().catch(e => console.error('[weightbench] tick error:', e.message)), 1000);

// The unified STOP command halts the workout like any other repeating action.
on('player.stop', ({ player, stopped }) => {
  if (getPosture(player) !== 'working_out') return;
  stopWorkout(player.id, player.handle, player.current_zone, 'You rack the weights and sit up, muscles humming.');
  stopped.push('workout');
});

// ── Command ─────────────────────────────────────────────────────────────────────

async function cmdLift(args, raw, player, broadcast) {
  if (getPosture(player) === 'working_out')
    return { type: 'emote', message: 'You\'re already mid-set. Grit your teeth and keep pushing.' };
  if (player.combatTargetId || player.pvpTargetId || player.npcCombatTargetId)
    return { type: 'emote', message: 'You\'re a little busy fighting to be lifting weights.' };

  // Need a bench in the room.
  const { rows } = await query(
    `SELECT name FROM furniture WHERE zone_id=$1 AND flags @> '{"interactions":["lift"]}'::jsonb LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length)
    return { type: 'emote', message: 'There\'s nothing here to lift on — you\'ll want a weight bench.' };
  const bench = rows[0].name;

  // The workout flow: lie back on the bench first, then lift.
  if (getPosture(player) !== 'lying')
    return { type: 'emote', message: `Lie back on the ${bench} first (try: lie on ${bench}).` };

  if (brawnOf(player) >= BRAWN_SOFT_CAP)
    return { type: 'emote', message: `You've already got all the muscle a ${bench} can build. Real gains are out in the world now.` };

  // lastSet is back-dated so the first set fires on the next tick — quick feedback.
  setPosture(player, 'working_out', { sittingOn: bench });
  player.workoutState = { benchName: bench, reps: 0, needed: repsForBrawn(brawnOf(player)), lastSet: Date.now() - SET_MS };
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} takes the bar and starts pumping iron.` }, player.id);
  return { type: 'emote', message: `You lie back, chalk your hands, and take the bar. Time to move some iron. (Type STOP to rack it.)` };
}

export const commands = {
  lift: cmdLift,
};

export const _test = { repsForBrawn, BRAWN_SOFT_CAP, REPS_BASE, REPS_PER_LEVEL };

console.log('[weightbench] Plugin loaded.');
