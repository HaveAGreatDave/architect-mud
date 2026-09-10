/**
 * Ally plugin — an NPC that fights on your side.
 *
 * The engine grew one function for this (`npcAttackEnemy` in combat.js): the last
 * empty cell of the combat matrix. Everything ELSE about an ally is policy and
 * lives here — which enemy they swing at, who the kill counts for, and when they
 * decide the fight is going badly enough to leave.
 *
 * That split is the litmus in docs/proposals/engine-plugin-boundary.md read
 * straight off: "a blow soaks through carapace" is a law of this world and ships
 * byte-identical in any game on this engine; "an exterminator prioritises vermin
 * and backs out at 30%" is a rule about ONE game and gets rewritten.
 *
 * WHY A 1s PLUGIN TICK and not the obvious alternatives:
 *
 *  - An authored AI behaviour graph was the first idea and is a trap three ways.
 *    `npcWanderTick` runs at 15s against a 4s swing interval; the graph's ATTACK
 *    node reads `entity.hit`/`enemyWeaponComponents()`, which an NPC does not
 *    have (its numbers live in `flags.*`), so an authored ally would swing at the
 *    hardcoded 1-3 default ignoring everything written on it; and `_escorting`
 *    freezes the AI tick outright, so an ally walking with you would never tick
 *    at all.
 *  - A third branch in the gameLoop NPC retaliation loop (resolving
 *    `_combatTargetId` against world.enemies) is one Map lookup and very
 *    tempting. It is deliberately NOT done: the engine would then own kill
 *    credit, the corpse and the `enemy.killed` emit, and none of those can be
 *    answered without naming a plugin. Revisit if a second npc-vs-enemy user
 *    ever appears.
 *
 * `npcAttackEnemy` owns its own cooldown (the same `_lastAttack` field the
 * gameLoop retaliation loop uses), so ticking at 1s and swinging at 4s is free
 * and an ally can never swing at a player and an enemy in the same beat. The
 * scheduler idle-gates the tick, and it returns on an empty registry before it
 * touches the world.
 *
 * KILL CREDIT. `enemy.killed` is emitted with `actor: <the player>` even when the
 * ally lands the blow, because the alternative is that your own bounty quest
 * stops counting the moment you bring help. `via: <the npc>` rides along so the
 * seven other subscribers (accolades, corps territory, gossip, psionics residue,
 * audio, prologue) can tell the two apart later without a migration. None of them
 * were changed; today an ally kill reads to them as your kill, which is the
 * behaviour we want and the tradeoff we are choosing on purpose.
 *
 * Weapon-skill XP is deliberately NOT awarded: `awardSkillUse` fires on a swing,
 * and you didn't swing.
 *
 * State is RAM-only and dissolves on restart, like escort and parties. An ally is
 * something you have right now, not something you own.
 *
 * ⚠ NO `after` IN plugin.json, deliberately. The obvious `"after": ["weapon"]`
 * is wrong twice: nothing here needs weapon at LOAD time (getPlayerCombat() is
 * called per kill, long after boot), and forcing weapon to load early re-orders
 * every registry it writes to. It shifted `weapon:flee` ahead of `injury:grab`
 * in the move-gate list, which injury's own suite asserts on — a plugin this one
 * has nothing to do with, failing for a reason nothing about it would suggest.
 */
import { getNpc, getZone, getZoneNpcs, getZoneEnemies, getLivePlayer } from '../../server/engine/world.js';
import { npcAttackEnemy, getPlayerCombat } from '../../server/engine/combat.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { on, emit } from '../../server/engine/events.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { schedule } from '../../server/engine/scheduler.js';
import { pickTarget } from './targeting.js';
import { shouldWithdraw, withdraw, withdrawPct } from './downed.js';

// One ally per player, one player per ally — both directions, same as escort, so
// two players can't fight through the same body.
const byNpc = new Map();     // npcId    -> playerId
const byPlayer = new Map();  // playerId -> npcId

export function allyOf(playerId) {
  const npcId = byPlayer.get(playerId);
  return npcId ? getNpc(npcId) : null;
}
export function employerOf(npcId) { return byNpc.get(npcId) || null; }

function tell(playerId, text) {
  sendToPlayer(playerId, { type: 'output', message: `<span class="msg-system">${text}</span>` });
}

// --- Enlist / dismiss ------------------------------------------------------

export function enlist(player, npc) {
  if (!player?.id) return { ok: false, message: 'Nobody to fight for.' };
  if (!npc) return { ok: false, message: "They aren't here." };
  if (npc._dead) return { ok: false, message: `${npc.name} is in no condition to fight anyone.` };
  const cooldown = npc._allyCooldownUntil || 0;
  if (cooldown > Date.now()) {
    const mins = Math.max(1, Math.ceil((cooldown - Date.now()) / 60_000));
    return { ok: false, message: `${npc.name} is still patching themselves up. Give it ${mins} minute${mins === 1 ? '' : 's'}.` };
  }
  const existing = byPlayer.get(player.id);
  if (existing === npc.id) return { ok: false, message: `${npc.name} is already fighting with you.` };
  if (existing) {
    const cur = getNpc(existing);
    return { ok: false, message: `${cur?.name || 'Someone'} is already working for you. One at a time.` };
  }
  if (byNpc.has(npc.id)) return { ok: false, message: `${npc.name} is already working for someone else.` };

  byNpc.set(npc.id, player.id);
  byPlayer.set(player.id, npc.id);
  emit('ally.enlisted', { actor: player, npc });
  return { ok: true, message: `${npc.name} will fight alongside you. Keep them out of the worst of it.` };
}

/** reason: dismissed | withdrawn | killed | player_gone */
export function dismiss(npcId, reason = 'dismissed') {
  const playerId = byNpc.get(npcId);
  if (!playerId) return false;
  byNpc.delete(npcId);
  byPlayer.delete(playerId);
  const npc = getNpc(npcId);
  // Leave nothing behind. A stale `_combatTargetId` is an instanceId the tick
  // would chase after the registry has forgotten the ally exists.
  if (npc) npc._combatTargetId = null;
  emit('ally.ended', { npc, playerId, reason });
  return true;
}

// --- The tick --------------------------------------------------------------

async function allyTick() {
  if (byNpc.size === 0) return;   // the common case, before anything touches the world
  for (const [npcId, playerId] of [...byNpc]) {
    const npc = getNpc(npcId);
    if (!npc || npc._dead) { dismiss(npcId, 'killed'); continue; }
    if (npc._aboard) continue;                       // riding in an aircraft

    if (shouldWithdraw(npc)) {
      withdraw(npc, { reason: 'hurt' });
      const actor = getLivePlayer(playerId);
      if (actor) tell(playerId, `${npc.name} has had enough. They're gone.`);
      emit('ally.withdrawn', { actor, npc, reason: 'hurt' });
      dismiss(npcId, 'withdrawn');
      // Walking out ends the escort too — over the bus, never by importing it.
      if (actor) await dispatchAction({ type: 'ESCORT_END', actor, params: { npc_id: npcId, reason: 'dismissed' } }).catch(() => {});
      continue;
    }

    const player = getLivePlayer(playerId);
    const enemies = getZoneEnemies(npc.zone_id);
    if (!enemies.length) { npc._combatTargetId = null; continue; }

    let target = enemies.find(e => e.instanceId === npc._combatTargetId);
    if (!target || (target.hp ?? 0) <= 0) {
      target = pickTarget(npc, player, enemies);
      if (!target) { npc._combatTargetId = null; continue; }
      npc._combatTargetId = target.instanceId;
      emit('ally.engaged', { actor: player, npc, enemy: target });
    }

    const result = await npcAttackEnemy(npc, target, { credit: player });
    if (!result) continue;   // on cooldown, or a forcefield zone
    sendToZone(npc.zone_id, { type: 'zone_event', message: result.message });
    if (result.killed) await handleKill(npc, target, result, player);
  }
}

async function handleKill(npc, enemy, result, player) {
  // actor is the PLAYER (see the header note on credit); via is who swung.
  emit('enemy.killed', { actor: player, enemy, via: npc });
  emit('ally.kill', { actor: player, npc, enemy });

  // The corpse comes from weapon through registerPlayerCombat, not an import —
  // and it lands where the KILL happened, which is the ally's tile.
  const combat = getPlayerCombat();
  let corpseLink = '';
  try {
    if (combat?.spawnEnemyCorpse) corpseLink = await combat.spawnEnemyCorpse(npc.zone_id, enemy.name, result);
  } catch (e) {
    console.error(`[ally] corpse failed: ${e.message}`);
  }
  sendToZone(npc.zone_id, {
    type: 'zone_event',
    message: `${enemy.name} has fallen. ${corpseLink}`.trim(),
    refresh: true,
  });
}

schedule('1s', allyTick);

// --- Teardown --------------------------------------------------------------

on('npc.killed', ({ npc }) => {
  if (!npc?.id) return;
  const playerId = byNpc.get(npc.id);
  if (!playerId) return;
  tell(playerId, `${npc.name} is dead. You were supposed to keep them out of the worst of it.`);
  dismiss(npc.id, 'killed');
});

on('player.death', ({ player }) => {
  const npcId = player?.id && byPlayer.get(player.id);
  if (npcId) dismiss(npcId, 'player_gone');
});

on('player.logout', ({ id }) => {
  const npcId = id && byPlayer.get(id);
  if (npcId) dismiss(npcId, 'player_gone');
});

// Sending someone away stops them fighting for you as well. The reverse is NOT
// true: dismissing an ally leaves the escort running, because a body walking with
// you and a body swinging for you are two different arrangements.
on('escort.ended', ({ npc }) => {
  if (npc?.id) dismiss(npc.id, 'player_gone');
});

// --- Actions ---------------------------------------------------------------
//
// The intended authoring route, matching escort: a dialogue node on the NPC's own
// tree fires ALLY_ENLIST with no params — `context.npc` is the speaker, so "I'll
// come down with you, for a price" is the whole wiring.

registerAction({
  type: 'ALLY_ENLIST',
  handler: async ({ actor, params, context }) => {
    const npcId = params?.npc_id || params?.npc || context?.npc?.id;
    const npc = npcId ? getNpc(npcId) : null;
    if (!npc) return { type: 'error', message: "ALLY_ENLIST: no NPC resolved (pass npc_id, or fire it from that NPC's dialogue)." };
    const res = enlist(actor, npc);
    return res.ok ? { type: 'ally', npc_id: npc.id, message: res.message } : { type: 'error', message: res.message };
  },
});

registerAction({
  type: 'ALLY_DISMISS',
  handler: async ({ actor, params, context }) => {
    const npcId = params?.npc_id || params?.npc || context?.npc?.id || byPlayer.get(actor?.id);
    if (!npcId) return { type: 'error', message: 'ALLY_DISMISS: nobody is fighting for you.' };
    dismiss(npcId, 'dismissed');
    return { type: 'ally', npc_id: npcId };
  },
});

// --- Verb ------------------------------------------------------------------

function cmdAlly(args, raw, player, broadcast) {
  const sub = args.join(' ').trim().toLowerCase();
  const current = allyOf(player.id);

  if (!sub) {
    if (!current) return { type: 'output', message: 'Nobody is fighting for you. Type "ally <name>" to ask.' };
    const z = getZone(current.zone_id);
    const here = current.zone_id === player.current_zone;
    const hp = `${current.hp ?? current.hp_max}/${current.hp_max ?? 20}`;
    return {
      type: 'output',
      message: here
        ? `${current.name} is fighting alongside you (${hp}). They'll break off below ${withdrawPct(current)}%.`
        : `${current.name} is working for you, but they're back at ${z?.name || 'somewhere else'}.`,
    };
  }

  if (sub === 'stop' || sub === 'dismiss' || sub === 'stand down') {
    if (!current) return { type: 'output', message: 'Nobody is fighting for you.' };
    dismiss(current.id, 'dismissed');
    broadcast(player.current_zone, { type: 'zone_event', message: `${current.name} lowers their weapon.` }, player.id);
    return { type: 'output', message: `${current.name} stands down.` };
  }

  const npc = getZoneNpcs(player.current_zone).find(n =>
    n.name?.toLowerCase().includes(sub) || String(n.id).toLowerCase() === sub);
  if (!npc) return { type: 'error', message: `There's no "${args.join(' ')}" here to ask.` };

  // Consent, exactly as escort does it: something in the world has to have said
  // this person fights for you. The verb is how you re-collect an arrangement you
  // already made, not how you conscript a stranger.
  if (!npc.flags?.fights_for_you) {
    return { type: 'emote', message: `${npc.name} isn't fighting anybody's battles for them.` };
  }
  const res = enlist(player, npc);
  return { type: res.ok ? 'output' : 'error', message: res.message };
}

export const commands = {
  ally: cmdAlly,
};

export const _test = { byNpc, byPlayer, allyTick };

console.log('[ally] Plugin loaded.');
