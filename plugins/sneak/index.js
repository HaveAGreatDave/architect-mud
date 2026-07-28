/**
 * Sneak — moving unnoticed, and what you can do from there.
 *
 * Two verbs over two engine substrates (engine/stealth.js, engine/unconscious.js):
 *
 *   sneak     drop into the `sneaking` posture. Everyone in the room rolls to
 *             notice you, and keeps rolling as you move.
 *   knockout  hit an unaware target on the head. Requires sneaking. Success puts
 *             them out cold; failure is loud and specific to what you hit.
 *
 * COMBAT IS UNTOUCHED. A fight in this game is to the death and stays that way —
 * there is no random knockout mid-brawl. A knockout is always a thing somebody
 * chose to attempt, from sneaking, on someone who had not clocked them. That is
 * the whole design: it keeps fights unambiguous and makes the interesting case
 * (taking someone alive) a decision rather than a dice roll.
 *
 * FAILURE DIFFERS BY WHAT YOU SWUNG AT, because they are different things:
 *   an NPC   panics and runs, calling for help (ai.alarm — the engine yields the
 *            behaviour graph and this drives them)
 *   an enemy simply turns round and attacks you
 *
 * SNEAKING IS SUSPICIOUS IN ITSELF. Getting spotted creeping is its own bad
 * outcome, separate from being spotted swinging — an NPC who notices you sneak
 * gets uneasy and eventually shouts, which is exactly what a person would do.
 *
 * See docs/systems-stealth.md.
 */
import { getZoneNpcs, getZoneEnemies, getZonePlayers, getZone, getLivePlayer } from '../../server/engine/world.js';
import { setPosture, getPosture, forceStand } from '../../server/engine/posture.js';
import { isSneaking, noticeSweep, clearNotices, hasNoticed, SNEAKING } from '../../server/engine/stealth.js';
import { knockOut, isOut, KO_MS } from '../../server/engine/unconscious.js';
import { skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { getZoneProtection } from '../../server/engine/protection.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { emit, on } from '../../server/engine/events.js';

// A knockout swing is one committed effort. Costed heavily enough that you get
// one good attempt, not a stream of them.
const KO_STAMINA = 25;
const SNEAK_STAMINA_PER_STEP = 2;

// Weapons that can knock a head without opening it. Anything else is just an
// attack, and a lethal one — swinging a blade at somebody's skull is not a
// knockout attempt however quietly you crept up on them.
const BLUNT = /\b(bat|pipe|club|cudgel|sledge|wrench|crowbar|baton|truncheon|cosh|hammer|butt|stock)\b/i;

function weaponOk(player) {
  const w = player?.equipped?.weapon;
  if (!w) return { ok: true, unarmed: true };            // fists are fine
  if (BLUNT.test(w.name || '')) return { ok: true, unarmed: false };
  return { ok: false, name: w.name };
}

// ── sneak ───────────────────────────────────────────────────────────────────

async function cmdSneak(args, raw, player, broadcast) {
  if (isSneaking(player)) {
    setPosture(player, 'standing');
    clearNotices(player.id);
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} straightens up.` }, player.id);
    return { type: 'output', message: 'You straighten up and stop skulking.' };
  }
  if (player.pvpTargetId || player.combatTargetId) {
    return { type: 'error', message: "You're in a fight. Sneaking is for before the fight." };
  }
  setPosture(player, SNEAKING);
  clearNotices(player.id);

  // The room gets a chance to notice immediately — dropping into a crouch in
  // front of somebody is itself the conspicuous act.
  const caught = await sweepRoom(player, broadcast);
  const line = caught.length
    ? 'You drop low and move carefully. It does not go unnoticed.'
    : 'You drop low and move carefully. Nobody looks up.';
  return { type: 'output', message: `<span class="text-dim">${line}</span>` };
}

/**
 * Roll the room against a sneaking player and let each side react in character.
 * Returns the beings that noticed.
 */
async function sweepRoom(player, broadcast) {
  const zoneId = player.current_zone;
  const npcs = getZoneNpcs(zoneId) || [];
  const enemies = getZoneEnemies(zoneId) || [];
  const caught = noticeSweep(player, zoneId, [...npcs, ...enemies]);
  if (!caught.length) return caught;

  for (const b of caught) {
    const isEnemy = enemies.includes(b);
    if (isEnemy) {
      // An enemy that clocks something creeping does not wonder about it.
      b.targetId = player.id;
      b.aggroedAt = Date.now();
      broadcast(zoneId, { type: 'zone_event', message: `${b.name} snaps round toward ${player.handle}.` }, player.id);
      sendToPlayer(player.id, { type: 'combat', message: `<span class="msg-combat">${b.name} has seen you.</span>` });
    } else {
      // A person doesn't attack — they get uneasy about the fact that you are
      // creeping, which is a far stranger thing to be caught doing.
      sendToPlayer(player.id, { type: 'output', message: `<span class="text-dim">${b.name} watches you moving like that, and does not like it.</span>` });
      broadcast(zoneId, { type: 'zone_event', message: `${b.name} watches ${player.handle} skulking about, plainly unsettled.` }, player.id);
    }
  }
  return caught;
}

// Every step re-rolls: crossing a room is where you get caught, not standing in
// it. Costs a little stamina, so a long creep is a real decision.
on('zone.entered', async ({ actor, zone }) => {
  try {
    if (!actor?.id || !isSneaking(actor)) return;
    clearNotices(actor.id);      // a new room is a new set of eyes
    actor.stamina = Math.max(0, (actor.stamina ?? 100) - SNEAK_STAMINA_PER_STEP);
    actor._resDirty = true;
    const bc = (z, m, ex) => emit('zone.broadcast', { zoneId: z, msg: m, exclude: ex });
    await sweepRoom(actor, (z, m, ex) => bc(z, m, ex));
  } catch (e) { console.error('[sneak] move sweep:', e.message); }
});

// Standing up for any reason drops the record — you are not sneaking any more,
// so nobody is "failing to notice" you.
on('posture.changed', ({ player, to }) => {
  if (player?.id && to !== SNEAKING) clearNotices(player.id);
});
on('player.logout', ({ id }) => clearNotices(id));

// ── knockout ────────────────────────────────────────────────────────────────

async function cmdKnockout(args, raw, player, broadcast) {
  const targetStr = args.join(' ').trim();
  if (!targetStr) return { type: 'error', message: 'Knock out whom?' };
  if (!isSneaking(player)) {
    return { type: 'error', message: "You'd have to come at them a lot quieter than that. Try sneaking first." };
  }
  if (getZoneProtection(player.current_zone)) {
    return { type: 'error', message: 'A quantum forcefield hums between you and everyone else in here.' };
  }
  const w = weaponOk(player);
  if (!w.ok) {
    return { type: 'error', message: `You can't knock somebody out with ${w.name}. Something blunt, or your hands.` };
  }
  if ((player.stamina ?? 100) < KO_STAMINA) {
    return { type: 'error', message: "You haven't got the wind for it. Rest first." };
  }

  const zoneId = player.current_zone;
  const npcs = getZoneNpcs(zoneId) || [];
  const enemies = getZoneEnemies(zoneId) || [];
  const others = getZonePlayers(zoneId).filter(p => p.id !== player.id);
  const pool = [
    ...npcs.map(n => ({ ...n, _kind: 'npc', _ref: n })),
    ...enemies.map(e => ({ ...e, _kind: 'enemy', _ref: e })),
    ...others.map(p => ({ ...p, name: p.handle, _kind: 'player', _ref: p })),
  ];
  const r = siftResolve(targetStr, pool);
  if (r.type !== 'match') return { type: 'error', message: `You don't see "${targetStr}" here.` };
  const target = r.candidate;
  const ref = target._ref;
  const targetId = ref.id || ref.instanceId;

  if (isOut(ref)) return { type: 'error', message: `${target.name} is already out cold.` };

  player.stamina = Math.max(0, (player.stamina ?? 100) - KO_STAMINA);
  player._resDirty = true;

  // THE CONTEST. Their dodge is the difficulty; an unaware target is much easier.
  // "Unaware" is the stealth record — if they have already clocked you sneaking,
  // you are swinging at somebody who is watching your hands.
  const aware = hasNoticed(player.id, targetId) || ref.targetId === player.id || ref._combatTargetId === player.id;
  const difficulty = aware ? 9 : 4;
  const check = await skillCheck(player, 'deception', difficulty);
  await awardSkillUse(player.id, 'deception', check.margin);

  // The swing happens either way, and it is an assault either way — a camera
  // does not care whether you connected.
  emit('knockout.attempted', { player, target: ref, kind: target._kind, zoneId, success: check.success });

  if (check.success) {
    knockOut(ref, { ms: KO_MS, by: player });
    broadcast(zoneId, { type: 'zone_event', message: `${player.handle} clubs ${target.name} on the back of the head. ${target.name} folds up and does not get up.`, refresh: true }, player.id);
    if (target._kind === 'player') {
      sendToPlayer(targetId, { type: 'output', message: `<span class="msg-combat">Something takes you across the back of the head, and the floor arrives.</span>` });
    }
    emit('knockout.landed', { player, target: ref, kind: target._kind, zoneId });
    return { type: 'combat', message: `You put ${target.name} down quietly. They will not be up for a while.` };
  }

  // ── Failure, which differs by what you swung at ───────────────────────────
  forceStand(player, 'knockout-failed');
  clearNotices(player.id);

  if (target._kind === 'enemy') {
    ref.targetId = player.id;
    ref.aggroedAt = Date.now();
    broadcast(zoneId, { type: 'zone_event', message: `${player.handle} swings at ${target.name} and misses. ${target.name} turns on them.` }, player.id);
    return { type: 'combat', message: `The blow glances off. ${target.name} turns round, and it is a fight now.` };
  }

  if (target._kind === 'npc') {
    // ai.alarm is the engine's existing "the plugin is driving this NPC" flag —
    // it yields the behaviour graph, and the panic/cop-call sequence rides it.
    if (ref._ai) ref._ai.alarm = true;
    emit('npc.alarmed', { npc: ref, player, zoneId, reason: 'assault' });
    broadcast(zoneId, { type: 'zone_event', message: `${target.name} ducks the blow, sees who it was, and bolts — shouting.`, refresh: true }, player.id);
    return { type: 'error', message: `${target.name} feels it coming and twists away. They are running, and they are shouting your description as they go.` };
  }

  broadcast(zoneId, { type: 'zone_event', message: `${player.handle} takes a swing at ${target.name} and misses.` }, player.id);
  sendToPlayer(targetId, { type: 'output', message: `<span class="msg-combat">${player.handle} just swung at the back of your head and missed.</span>` });
  return { type: 'error', message: `You misjudge it. ${target.name} is very much awake, and knows exactly what you tried.` };
}

export const commands = {
  sneak: cmdSneak,
  knockout: cmdKnockout,
};

export const _test = { weaponOk, BLUNT };
