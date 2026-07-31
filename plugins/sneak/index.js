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
import { isSneaking, noticeSweep, clearNotices, hasNoticed, armSneakWindow, SNEAKING } from '../../server/engine/stealth.js';
import { knockOut, isOut, KO_MS } from '../../server/engine/unconscious.js';
import { skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { getZoneProtection } from '../../server/engine/protection.js';
import { panicNpc } from '../../server/engine/panic.js';
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
  armSneakWindow(player, player.current_zone);

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
  const others = (getZonePlayers(zoneId) || []).filter(p => p.id !== player.id);
  const caught = noticeSweep(player, zoneId, [...npcs, ...enemies, ...others]);
  if (!caught.length) return caught;

  for (const b of caught) {
    const isEnemy = enemies.includes(b);
    const isPlayer = others.includes(b);
    if (isPlayer) {
      // The reveal, and the reason the notice record is worth keeping: until
      // this line they had no idea you were in the room at all. `refresh` puts
      // you into their occupant list, since the arrival line never fired.
      sendToPlayer(b.id, {
        type: 'zone_event',
        message: `<span class="msg-combat">You catch ${player.handle} moving low along the edge of the room. They didn't want to be seen.</span>`,
        refresh: true,
      });
      sendToPlayer(player.id, { type: 'output', message: `<span class="text-dim">${b.handle} looks straight at you.</span>` });
    } else if (isEnemy) {
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
    armSneakWindow(actor, zone); // and a fresh clock in it
    actor.stamina = Math.max(0, (actor.stamina ?? 100) - SNEAK_STAMINA_PER_STEP);
    actor._resDirty = true;
    const bc = (z, m, ex) => emit('zone.broadcast', { zoneId: z, msg: m, exclude: ex });
    await sweepRoom(actor, (z, m, ex) => bc(z, m, ex));
  } catch (e) { console.error('[sneak] move sweep:', e.message); }
});

// THE CLOCK RUNS OUT. Loitering in a room you crept into gives everyone in it
// another look at you — the engine owns the timer (stealth.js, swept by the game
// loop), and this is the re-roll. It is what turns "am I hidden?" into "how long
// have I got?", which is the only version of the question with any tension in it.
on('stealth.window', async ({ player }) => {
  try {
    if (!player?.id || !isSneaking(player)) return;
    await sweepRoom(player, (z, m, ex) => emit('zone.broadcast', { zoneId: z, msg: m, exclude: ex }));
  } catch (e) { console.error('[sneak] window sweep:', e.message); }
});

// Standing up for any reason drops the record — you are not sneaking any more,
// so nobody is "failing to notice" you.
on('posture.changed', ({ player, to }) => {
  if (player?.id && to !== SNEAKING) clearNotices(player.id);
});
on('player.logout', ({ id }) => clearNotices(id));

// ── knockout ────────────────────────────────────────────────────────────────

/**
 * Everyone else in the room saw that.
 *
 * A landed knockout is not a stealth outcome for the BYSTANDERS — there is no
 * roll here and deliberately so: dropping a body in front of people is loud by
 * definition, and letting the dice hide it would make a full room no riskier
 * than an empty one, which is the opposite of what the whole system is for.
 *
 * Enemies turn on you, NPCs panic and shout (the same ai.alarm the failure path
 * uses), players get told plainly enough to act on it. The victim is skipped —
 * they are out cold and, by design, never knew.
 */
function witnessKnockout(player, victim, zoneId, broadcast) {
  const victimId = victim.id || victim.instanceId;
  const enemies = (getZoneEnemies(zoneId) || []).filter(e => (e.id || e.instanceId) !== victimId);
  const npcs = (getZoneNpcs(zoneId) || []).filter(n => (n.id || n.instanceId) !== victimId);
  const others = (getZonePlayers(zoneId) || []).filter(p => p.id !== player.id && p.id !== victimId);

  // Anyone out cold or asleep saw nothing — the same rule the notice roll uses,
  // and what makes clearing a room one body at a time actually work.
  const awake = b => !isOut(b) && !b.sleeping;

  for (const e of enemies.filter(awake)) {
    e.targetId = player.id;
    e.aggroedAt = Date.now();
    sendToPlayer(player.id, { type: 'combat', message: `<span class="msg-combat">${e.name} saw that, and comes for you.</span>` });
    broadcast(zoneId, { type: 'zone_event', message: `${e.name} sees ${player.handle} drop ${victim.name} and lunges.` }, player.id);
  }
  for (const n of npcs.filter(awake)) {
    broadcast(zoneId, { type: 'zone_event', message: `${n.name} sees the body go down.`, refresh: true }, player.id);
    // panicNpc, never a raw `_ai.alarm = true`: the flag only SUSPENDS the AI
    // graph and waits for a driver, so setting it by hand froze the NPC forever.
    panicNpc(n, { reason: 'witnessed_knockout', threat: player });
  }
  for (const p of others.filter(awake)) {
    sendToPlayer(p.id, {
      type: 'zone_event',
      message: `<span class="msg-combat">${player.handle} drops ${victim.name} with a blow to the back of the head. ${victim.name} is not getting up.</span>`,
      refresh: true,
    });
  }
  // Being seen doing it ends the pretence — you are not creeping any more, you
  // are the person standing over a body.
  if ([...enemies, ...npcs, ...others].some(awake)) {
    forceStand(player, 'knockout-witnessed');
    clearNotices(player.id);
    sendToPlayer(player.id, { type: 'output', message: `<span class="text-dim">You are not the only one in here. There is no creeping away from this.</span>` });
  }
}

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
    // No room-wide line here: witnessKnockout below tells each bystander in
    // their own terms, and a blanket broadcast would announce it to the people
    // it explicitly should not reach (anyone out cold or asleep in the room).
    if (target._kind === 'player') {
      sendToPlayer(targetId, { type: 'output', message: `<span class="msg-combat">Something takes you across the back of the head, and the floor arrives.</span>` });
    }
    emit('knockout.landed', { player, target: ref, kind: target._kind, zoneId });
    // A QUIET KNOCKOUT IS STILL A BODY HITTING THE FLOOR. "Quiet" only ever
    // meant the victim never saw it — everyone else in the room watched a person
    // fold up, and they react to that whatever the dice said about your creeping.
    witnessKnockout(player, ref, zoneId, broadcast);
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
    // panicNpc owns the flag AND drives them out of the room. Setting `_ai.alarm`
    // directly (as this used to) suspends the graph with nobody to resume it.
    panicNpc(ref, { reason: 'assault', threat: player });
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
