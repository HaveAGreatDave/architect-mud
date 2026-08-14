/**
 * When an ally stops fighting.
 *
 * The engine's answer to an NPC losing a fight is `enemyAttackNpc`: dead, gone
 * from the room, respawned at home sixty seconds later at full HP. That is both
 * too permanent (your bodyguard evaporates mid-escort and the run is over) and
 * too cheap (they pop back like nothing happened, so nothing you did mattered).
 *
 * So an ally WITHDRAWS. Below a threshold they break contact, shed whatever is
 * chewing on them, walk home, and are unavailable for a cooldown. Three things
 * that model buys, none of which needed new engine code:
 *
 *  - He still dies if you get him killed. A burst from 40% to zero goes down the
 *    ordinary `enemyAttackNpc` path and he is a corpse like anyone else. This
 *    narrows the window; it does not close it. Nothing here protects an NPC —
 *    that is escort's rule too, and it is what keeps the stakes real.
 *  - The COOLDOWN is the cost. Without it he is a renewable meat shield you
 *    re-enlist at the door every ten seconds.
 *  - He stays hurt. There is deliberately no healing code here. If that plays
 *    badly, tune it with a slow regen in this plugin, never in the engine.
 *
 * `knockOut()` was the obvious alternative and is deliberately unused: an
 * unconscious body is killable where it lies (docs/systems-stealth.md), so a
 * KO'd ally in a room full of roaches is a corpse with a delay on it.
 *
 * Driven off the same 1s tick as the swing. There is no NPC damage-observer
 * registry (only player and enemy), and adding a third one for this would be
 * building a substrate to answer one question a per-second HP read already
 * answers for a handful of NPCs.
 */
import { getZoneEnemies, world } from '../../server/engine/world.js';
import { moveEntity } from '../../server/engine/ai-behaviour.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { query } from '../../server/models/db.js';

export const DEFAULT_WITHDRAW_PCT = 30;
export const DEFAULT_COOLDOWN_MINS = 10;

export function withdrawPct(npc) {
  const v = Number(npc?.flags?.ally_withdraw_pct);
  return Number.isFinite(v) ? v : DEFAULT_WITHDRAW_PCT;
}

/** Has this ally taken enough that it should break off? Sync, no side effects. */
export function shouldWithdraw(npc) {
  if (!npc || npc._dead) return false;
  const max = npc.hp_max || npc.hp || 1;
  const hp = npc.hp ?? max;
  return (hp / max) * 100 <= withdrawPct(npc);
}

/**
 * Break contact. Clears the ally's target, clears every enemy that is holding the
 * ally as ITS target (otherwise the room keeps swinging at a body that left),
 * walks them home through moveEntity — the single writer for NPC tile changes —
 * and stamps the re-enlist cooldown.
 *
 * Returns the flavour line so the caller can pair it with whatever else it says.
 */
export function withdraw(npc, { reason = 'hurt' } = {}) {
  const zoneId = npc.zone_id;
  npc._combatTargetId = null;
  for (const e of getZoneEnemies(zoneId)) {
    if (e.targetId === npc.id) e.targetId = null;
  }
  npc._allyCooldownUntil = Date.now()
    + (Number(npc.flags?.ally_cooldown_mins) || DEFAULT_COOLDOWN_MINS) * 60_000;

  const line = reason === 'hurt'
    ? `${npc.name} backs out of it, one hand pressed flat to their side, and goes.`
    : `${npc.name} calls it and goes.`;
  sendToZone(zoneId, { type: 'zone_event', message: line });

  if (npc.home_zone && npc.home_zone !== zoneId) {
    // Try to WALK it. moveEntity is the single writer for NPC tile changes and
    // it enforces adjacency, doors and facades, so a one-room retreat reads as a
    // real step with real broadcasts — which is the common case, because an ally
    // camps near where it works.
    //
    // It refuses a destination that isn't one step away, and pathing a wounded
    // NPC across a district at 1 Hz is a whole subsystem this does not need. So
    // the fallback is exactly what the engine's own NPC respawn does
    // (gameLoop.js): assign the zone and add to the room's set. Same placement,
    // same lack of ceremony — the difference is that they're still alive.
    if (!moveEntity(npc, npc.home_zone, sendToZone, query)) {
      world.zones.get(zoneId)?.npcs.delete(npc.id);
      npc.zone_id = npc.home_zone;
      world.zones.get(npc.home_zone)?.npcs.add(npc.id);
    }
  }
  return line;
}
