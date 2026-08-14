/**
 * Who an ally swings at.
 *
 * Isolated from index.js because it is the one piece of this plugin that is pure
 * policy — no world writes, no events, no clock — which makes it the piece worth
 * testing directly rather than through a tick.
 *
 * The rule: CONTENT names the targets, code never does. An exterminator's NPC
 * file lists `flags.ally_targets: ["enemy_sewer_roach", …]`, and an ally with no
 * list at all fights anything hostile in the room. Hard-coding "vermin" here
 * would mean the second ally anybody writes — a bodyguard, a faction gun — needs
 * a code change to be allowed to shoot the thing it was hired to shoot.
 */

/**
 * Is this enemy something the NPC is willing to attack?
 * Sync, allocation-free on the common path, safe to call per tick.
 */
export function allowedTarget(npc, enemy) {
  if (!enemy || (enemy.hp ?? 0) <= 0) return false;
  if (enemy.zoneId !== npc.zone_id) return false;
  const list = npc.flags?.ally_targets;
  if (!Array.isArray(list) || list.length === 0) return true;   // no list = anything hostile
  // `enemy.id` is the template id (enemy_sewer_roach); instanceId is the spawn.
  return list.includes(enemy.id);
}

/**
 * Pick the best target in the room.
 *
 * Ordered: whatever is already fighting MY player first (that is the entire
 * point of standing next to someone), then the weakest — an ally that spreads
 * damage evenly across three roaches kills none of them, and a fight is only
 * shorter when something in it stops swinging.
 */
export function pickTarget(npc, player, enemies) {
  const eligible = enemies.filter(e => allowedTarget(npc, e));
  if (!eligible.length) return null;
  const mine = player?.id;
  eligible.sort((a, b) => {
    const aMine = mine && a.targetId === mine ? 0 : 1;
    const bMine = mine && b.targetId === mine ? 0 : 1;
    if (aMine !== bMine) return aMine - bMine;
    return (a.hp ?? 0) - (b.hp ?? 0);
  });
  return eligible[0];
}
