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
// quick at first and a longer grind near the top.
//
// The XP economy (HellMOO-faithful): the gym is where you *convert XP into Brawn*,
// not a free source of it. Raising the stat increases the implicit `statSpent`
// (see server/engine/ip.js), spending the point straight out of Net XP — the same
// cost as a `raise brawn`. Reps are the time-gate; XP is the real gate. If you
// can't afford the next point, the bench racks itself and sends you out to earn
// more. No refund, no soft cap — your XP is the ceiling.

import { query } from '../../server/models/db.js';
import { getAllLivePlayers, getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { getPosture, setPosture, forceStand } from '../../server/engine/posture.js';
import { ensureTunables } from '../../server/engine/tunables.js';
import { statCost, getNetXp } from '../../server/engine/ip.js';
import { registerStatusEffect, applyEffect } from '../../server/engine/effects.js';

const SET_MS = 8000;          // one set of reps every 8s — a slow, deliberate grind
const REPS_BASE = 4;          // sets for the very first point...
const REPS_PER_LEVEL = 2;     // ...plus this many more for each point you already have

const STA_PER_SET = 12;       // each set burns this much stamina — ~8 sets on a full tank
const EXHAUSTED_TICKS = 45;   // ~45s locked out of the bench after you gas out completely

// Sets required to earn the next Brawn point at your current level.
function repsForBrawn(brawn) { return REPS_BASE + Math.max(0, brawn) * REPS_PER_LEVEL; }
function brawnOf(player) { return Number(player.stat_brawn) || 0; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function out(pid, message) { sendToPlayer(pid, { type: 'output', message }); }
function isExhausted(player) { return (player.statuses || []).some(s => s.name === 'exhausted'); }

// Burn stamina for a set, persist + push it to the HUD. Returns the new value.
function drainStamina(player, amount) {
  const max = player.stamina_max ?? 100;
  const before = player.stamina ?? max;
  player.stamina = Math.max(0, before - amount);
  if (player.stamina !== before) {
    query('UPDATE players SET stamina=$1 WHERE id=$2', [player.stamina, player.id]).catch(() => {});
    sendToPlayer(player.id, { type: 'resource_tick', messages: [], player_update: { stamina: player.stamina } });
  }
  return player.stamina;
}

// "Exhausted" is a pure lockout timer — no per-tick bite, the penalty is being
// unable to touch the bench (see cmdLift) while your arms come back to life.
registerStatusEffect({ name: 'exhausted', label: 'Exhausted', onTick() {} });

// ── Pumping-iron flavour ──────────────────────────────────────────────────────

// Set flavour comes in three tiers of fatigue, chosen by how much gas is left in
// the tank (see setFlavor). Fresh and strong → laboured → gassed and shaking.
const SET_FLAVOR_STRONG = [
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

const SET_FLAVOR_LABORED = [
  'Your arms are getting heavy now — the bar comes up slower than it went down.',
  'Sweat sheets down your face. You blink it away and grind out another set.',
  'The burn is setting in deep. You push through it, jaw clenched.',
  'Breath coming ragged now, you muscle the bar up one more time.',
  'Your shirt is soaked through. The reps are getting ugly, but they still count.',
  'You blow out a hard breath and force another set. Legs starting to tremble.',
];

const SET_FLAVOR_GASSED = [
  'Your arms are shaking. Each rep is a small war now.',
  'You can barely lock out the bar. Lungs heaving, you claw for one more.',
  'Every rep feels like it might be the last. You gasp and grind on anyway.',
  'Spots swim at the edge of your vision. The bar wobbles up, barely.',
  "You're running on fumes and spite now. Mostly spite.",
  'Your whole body screams to quit. You spit, grit your teeth, and press.',
];

// Pick a set line by remaining stamina fraction — the emptier the tank, the
// more the reps visibly hurt. This is the progressive-exhaustion telegraph.
function setFlavor(staFrac) {
  if (staFrac > 0.6) return pick(SET_FLAVOR_STRONG);
  if (staFrac > 0.3) return pick(SET_FLAVOR_LABORED);
  return pick(SET_FLAVOR_GASSED);
}

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

  // Every set costs stamina. The tank is the time-gate on a single session: a
  // full 100 buys ~8 sets before you gas out entirely.
  const max = player.stamina_max ?? 100;
  const sta = drainStamina(player, STA_PER_SET);

  // Earned a point this set? It's paid for out of Net XP, same as `raise brawn`.
  // Do this before the exhaustion check so a last-gasp set still banks the point.
  if (st.reps >= st.needed) {
    st.reps = 0;
    const current = brawnOf(player);
    await ensureTunables();
    const cost = statCost(current);
    const { net } = await getNetXp(player.id);
    if (net < cost) {
      stopWorkout(player.id, player.handle, player.current_zone,
        `You've hit the wall — raising Brawn to ${current + 1} costs ${cost} XP and you're ${cost - Math.floor(net)} short. Go earn it out in the world.`);
      return;
    }
    // Raising the stat implicitly spends `cost` off Net XP (see ip.js statSpent).
    await query('UPDATE players SET stat_brawn = stat_brawn + 1 WHERE id=$1', [player.id]);
    player.stat_brawn = current + 1;
    st.needed = repsForBrawn(current + 1);
    out(player.id, `<span class="item-grant">${pick(GAIN_LINES)} <b>Your Brawn climbs to ${current + 1}.</b></span>`);
  } else {
    // A plain set — flavour scales with how much gas is left (progressive burn).
    out(player.id, setFlavor(sta / max));
  }

  // Tank's empty → you're done, and you're wrecked. Rack it and slap on the
  // exhausted lockout so you can't just flop back down and keep grinding.
  if (sta <= 0 && getPosture(player) === 'working_out') {
    applyEffect(player, 'exhausted', EXHAUSTED_TICKS);
    stopWorkout(player.id, player.handle, player.current_zone,
      "Your arms give out mid-press. The bar clatters back into the rack and you slump off the bench, utterly spent. <b>You're exhausted.</b>");
  }
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
  if (isExhausted(player))
    return { type: 'emote', message: 'You\'re still wrecked from your last set — give your arms a minute to come back before you touch the bar.' };
  if ((player.stamina ?? (player.stamina_max ?? 100)) < STA_PER_SET)
    return { type: 'emote', message: 'You\'re too winded to lift — you can barely make a fist right now. Catch your breath first.' };

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

  // HellMOO-style: the gym spends XP. Don't let them lie down if they can't even
  // afford the next point.
  await ensureTunables();
  const cost = statCost(brawnOf(player));
  const { net } = await getNetXp(player.id);
  if (net < cost)
    return { type: 'emote', message: `You size up the ${bench}, but raising Brawn costs ${cost} XP and you've only banked ${Math.floor(net)}. Come back when you've earned it.` };

  // lastSet is back-dated so the first set fires on the next tick — quick feedback.
  setPosture(player, 'working_out', { sittingOn: bench });
  player.workoutState = { benchName: bench, reps: 0, needed: repsForBrawn(brawnOf(player)), lastSet: Date.now() - SET_MS };
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} takes the bar and starts pumping iron.` }, player.id);
  return { type: 'emote', message: `You lie back, chalk your hands, and take the bar. Time to move some iron. (Type STOP to rack it.)` };
}

export const commands = {
  lift: cmdLift,
};

export const _test = { repsForBrawn, REPS_BASE, REPS_PER_LEVEL };

console.log('[weightbench] Plugin loaded.');
