// Gym plugin (historically "weightbench" — the bench was the first station).
//
// A posture-based workout, sibling to scavenging (plugins/scavenging). The flow:
// get into position at a station, then run its verb to start grinding sets.
// `posture === "working_out"` is the authoritative activity flag — it inherits
// every engine force-stand interruption (moving, attacking, being attacked) for
// free, and a companion `player.workoutState` carries the rep bookkeeping.
//
// THREE STATIONS, ONE LOOP. Each converts XP into a different stat:
//   lift  — a weight bench (lie down first) → Brawn
//   spar  — a rebound wall (on your feet)   → Reflexes
//   drill — a conditioning circuit          → Endurance
// Everything that differs between them (tempo, stamina burn, prose, the furniture
// `flags.interactions` key that marks a usable one) is data in stations.js. This
// file is the loop, and it does not know or care how many stations exist.
//
// Gains model (HellMOO-flavoured): each tick is one "set" of reps. Completing
// `needed` sets grants +1 in that station's stat; `needed` rises with your current
// level, so it's quick at first and a longer grind near the top.
//
// The XP economy (HellMOO-faithful): the gym is where you *convert XP into stats*,
// not a free source of it. Raising the stat increases the implicit `statSpent`
// (see server/engine/ip.js), spending the point straight out of Net XP — the same
// cost as a `raise brawn`. Reps are the time-gate; XP is the real gate. If you
// can't afford the next point, the station racks itself and sends you out to earn
// more. No refund, no soft cap — your XP is the ceiling.

import { query } from '../../server/models/db.js';
import { getAllLivePlayers, getLivePlayer } from '../../server/engine/world.js';
import { schedule } from '../../server/engine/scheduler.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { getPosture, setPosture, forceStand } from '../../server/engine/posture.js';
import { ensureTunables } from '../../server/engine/tunables.js';
import { statCost, getNetXp, RAISABLE_STATS } from '../../server/engine/ip.js';
import { registerStatusEffect, applyEffect } from '../../server/engine/effects.js';
import { STATIONS, STATION_VERBS, repsFor, setFlavor } from './stations.js';

const EXHAUSTED_TICKS = 45;   // ~45s locked out of the gym after you gas out completely

// A player's current level in a station's stat. The column is `stat_<name>` —
// asserted against RAISABLE_STATS at load (see the sanity check below), so a typo
// in stations.js fails at boot rather than silently training nothing.
function levelOf(player, station) { return Number(player[`stat_${station.stat}`]) || 0; }
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
// unable to touch ANY station (see startWorkout) while you come back to life.
registerStatusEffect({ name: 'exhausted', label: 'Exhausted', onTick() {} });

// ── State (posture is authoritative — mutate the live object in place) ─────────

function stopWorkout(pid, handle, zoneId, playerLine, station) {
  const cur = getLivePlayer(pid);
  if (!cur || getPosture(cur) !== 'working_out') return;
  // The station is normally read off the live workout; callers that already have it
  // (the stop event) pass it in, since we delete the state on the way out.
  const st = station || STATIONS[cur.workoutState?.station] || STATIONS.lift;
  forceStand(cur, 'weightbench.stop');
  delete cur.workoutState;
  if (playerLine) out(pid, playerLine);
  if (zoneId) sendToZone(zoneId, { type: 'zone_event', message: st.stopZoneLine(handle) }, pid);
}

// ── One completed set ──────────────────────────────────────────────────────────

async function runSet(player, st, nowMs) {
  const station = STATIONS[st.station] || STATIONS.lift;
  st.lastSet = nowMs;
  st.reps += 1;

  // Every set costs stamina. The tank is the time-gate on a single session: a
  // full 100 buys ~8 sets on the bench, fewer on the heavier stations.
  const max = player.stamina_max ?? 100;
  const sta = drainStamina(player, station.staPerSet);

  // Earned a point this set? It's paid for out of Net XP, same as `raise <stat>`.
  // Do this before the exhaustion check so a last-gasp set still banks the point.
  if (st.reps >= st.needed) {
    st.reps = 0;
    const current = levelOf(player, station);
    const label = station.stat[0].toUpperCase() + station.stat.slice(1);
    await ensureTunables();
    const cost = statCost(current);
    const { net } = await getNetXp(player.id);
    if (net < cost) {
      stopWorkout(player.id, player.handle, player.current_zone,
        `You've hit the wall — raising ${label} to ${current + 1} costs ${cost} XP and you're ${cost - Math.floor(net)} short. Go earn it out in the world.`,
        station);
      return;
    }
    // Raising the stat implicitly spends `cost` off Net XP (see ip.js statSpent).
    // The column name comes from the station table, which is validated at load.
    await query(`UPDATE players SET stat_${station.stat} = stat_${station.stat} + 1 WHERE id=$1`, [player.id]);
    player[`stat_${station.stat}`] = current + 1;
    st.needed = repsFor(station, current + 1);
    out(player.id, `<span class="item-grant">${pick(station.gain)} <b>Your ${label} climbs to ${current + 1}.</b></span>`);
  } else {
    // A plain set — flavour scales with how much gas is left (progressive burn).
    out(player.id, setFlavor(station, sta / max));
  }

  // Tank's empty → you're done, and you're wrecked. Rack it and slap on the
  // exhausted lockout so you can't just flop back down and keep grinding.
  if (sta <= 0 && getPosture(player) === 'working_out') {
    applyEffect(player, 'exhausted', EXHAUSTED_TICKS);
    stopWorkout(player.id, player.handle, player.current_zone, station.gassedLine, station);
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
        if (nowMs - st.lastSet < (STATIONS[st.station] || STATIONS.lift).setMs) continue;
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

schedule('1s', () => workoutTick().catch(e => console.error('[weightbench] tick error:', e.message)));

// The unified STOP command halts the workout like any other repeating action.
on('player.stop', ({ player, stopped }) => {
  if (getPosture(player) !== 'working_out') return;
  const station = STATIONS[player.workoutState?.station] || STATIONS.lift;
  stopWorkout(player.id, player.handle, player.current_zone, station.stopLine, station);
  stopped.push('workout');
});

// ── Command ─────────────────────────────────────────────────────────────────────

// One command body for every station — the differences are all in the table.
async function startWorkout(station, player, broadcast) {
  if (getPosture(player) === 'working_out')
    return { type: 'emote', message: station.busyLine };
  if (player.combatTargetId || player.pvpTargetId || player.npcCombatTargetId)
    return { type: 'emote', message: station.combatLine };
  if (isExhausted(player))
    return { type: 'emote', message: station.exhaustedLine };
  if ((player.stamina ?? (player.stamina_max ?? 100)) < station.staPerSet)
    return { type: 'emote', message: station.windedLine };

  // Need a matching station in the room. The furniture `interactions` key is what
  // makes a piece of furniture a station — see stations.js.
  const { rows } = await query(
    `SELECT name FROM furniture WHERE zone_id=$1 AND flags @> $2::jsonb LIMIT 1`,
    [player.current_zone, JSON.stringify({ interactions: [station.interaction] })]
  );
  if (!rows.length) return { type: 'emote', message: station.missingLine };
  const gear = rows[0].name;

  // Get into position first (lie back on a bench; stay on your feet for the rest).
  if (station.posture && getPosture(player) !== station.posture)
    return { type: 'emote', message: station.postureLine(gear) };

  // HellMOO-style: the gym spends XP. Don't let them start if they can't even
  // afford the next point.
  const level = levelOf(player, station);
  const label = station.stat[0].toUpperCase() + station.stat.slice(1);
  await ensureTunables();
  const cost = statCost(level);
  const { net } = await getNetXp(player.id);
  if (net < cost)
    return { type: 'emote', message: `You size up the ${gear}, but raising ${label} costs ${cost} XP and you've only banked ${Math.floor(net)}. Come back when you've earned it.` };

  // lastSet is back-dated so the first set fires on the next tick — quick feedback.
  setPosture(player, 'working_out', { sittingOn: gear });
  player.workoutState = {
    station: station.verb, benchName: gear, reps: 0,
    needed: repsFor(station, level), lastSet: Date.now() - station.setMs,
  };
  broadcast(player.current_zone, { type: 'zone_event', message: station.startZoneLine(player.handle) }, player.id);
  return { type: 'emote', message: station.startLine(gear) };
}

// One thin command per station verb, all sharing the body above.
export const commands = Object.fromEntries(
  STATION_VERBS.map(v => [v, (args, raw, player, broadcast) => startWorkout(STATIONS[v], player, broadcast)])
);

// Boot-time sanity: every station must name a real raisable stat, or its UPDATE
// would target a column that doesn't exist and the grind would silently 500 on
// the set that finally earns the point — the worst possible moment to find out.
for (const [verb, s] of Object.entries(STATIONS)) {
  if (!RAISABLE_STATS.includes(s.stat)) {
    throw new Error(`[weightbench] station "${verb}" trains unknown stat "${s.stat}" (expected one of ${RAISABLE_STATS.join(', ')})`);
  }
}

export const _test = { STATIONS, repsFor, levelOf };

console.log('[weightbench] Plugin loaded.');
