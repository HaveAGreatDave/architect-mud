/**
 * Active organs — the mutations you FIRE rather than carry.
 *
 * The rule that shapes this file: **a discharge you cannot choose to fire is
 * just a damage number with a story attached.** Chitinous Carapace can be a
 * passive soak contribution because armour is passive; an electric organ that
 * quietly added 12 damage to your punches would be indistinguishable, in play,
 * from a bigger fist. So the three organs that are ABOUT the moment of using
 * them are verbs, and the moment is the mechanic.
 *
 * All three route through `applyStrikeToEnemy` (engine/combat.js), which is the
 * same reason natural weapons route through `weaponStats`: the part roll, the
 * typed soak, the injury observers and the loot-on-death path all come for free,
 * and none of them can drift out of step with ordinary combat. Nothing in here
 * writes `enemy.hp` itself.
 *
 * Gated on EXPRESSION, not merely on carrying the mutation. A 12%-expressed
 * electric organ is a static shock, and offering a verb for it would promise
 * something the numbers cannot pay.
 */
import {
  getMutations, mutationNumber, mutationFlag, getMutationExpression,
} from '../../server/engine/mutations.js';
import { registerStatusEffect, applyEffect } from '../../server/engine/effects.js';
import { applyStrikeToEnemy } from '../../server/engine/combat.js';
import { getZoneEnemies, getZonePlayers } from '../../server/engine/world.js';
import { isTurning } from './onset.js';
import { awardSkillUse } from '../../server/engine/skills.js';

// The minimum expression at which an organ is worth a verb at all.
const ORGAN_FLOOR = 30;

// ── Venom ────────────────────────────────────────────────────────────────────
//
// Registered here rather than in engine/effects.js because the engine has no
// business knowing what a Wildblood venom gland does. It is an ordinary status
// effect, applied by the ordinary `status_chance` roll on an unarmed hit, so it
// lands, ticks and expires exactly like bleeding does.
registerStatusEffect({
  name: 'envenomed',
  label: 'Envenomed',
  // Deliberately weaker per tick than bleeding and much longer-lived. Venom is
  // not how you win the fight, it is how they lose the next ten minutes.
  stats: { stat_reflexes: -1, stat_brawn: -1 },
  onTick: (target) => {
    if (Math.random() > 0.25) return undefined;
    const before = target.hp ?? target.hp_max ?? 100;
    target.hp = Math.max(1, before - 1);
    target._resDirty = true;
    return `Your veins burn where the venom went in.`;
  },
});

// ── shock ────────────────────────────────────────────────────────────────────

async function cmdShock(args, raw, player, broadcast) {
  const notYet = tooRawToUse(player); if (notYet) return notYet;
  const power = mutationNumber(player, 'shock_attack');
  if (!power || organExpression(player, 'shock_attack') < ORGAN_FLOOR) {
    return { type: 'error', message: 'Unknown command.' };
  }

  const enemies = getZoneEnemies(player.current_zone).filter(e => e.hp > 0);
  if (!enemies.length) {
    return { type: 'error', message: 'You let the charge build and then let it go into the floor. Nothing was there to take it.' };
  }

  // Everything in the room, because that is what a discharge does. This is the
  // organ's whole identity: it is the only attack a player has that does not
  // choose a target, which makes it excellent in a crowd and a liability in a
  // room with someone you like in it.
  const hits = [];
  for (const enemy of enemies) {
    const res = await applyStrikeToEnemy(player, enemy, {
      min: Math.ceil(power * 0.6), max: power, damageType: 'energy',
    });
    if (res) hits.push({ name: enemy.name, ...res });
  }

  await awardSkillUse(player.id, 'fists', 4);

  const killed = hits.filter(h => h.killed).map(h => h.name);
  const hurt = hits.filter(h => !h.killed);
  let msg = `<span class="hit-part">You let it go.</span> The charge jumps out of you and finds everything in the room.`;
  if (hurt.length) msg += ` ${hurt.map(h => `${h.name} takes ${h.damage}`).join(', ')}.`;
  if (killed.length) msg += ` <span class="msg-error">${killed.join(' and ')} drops, smoking.</span>`;

  broadcast?.(player.current_zone, {
    type: 'zone_event',
    message: `${player.handle} arcs with light and the air cracks.`,
    refresh: true,
  }, player.id);

  return { type: 'combat', message: msg };
}

// ── screech ──────────────────────────────────────────────────────────────────

async function cmdScreech(args, raw, player, broadcast) {
  const notYet = tooRawToUse(player); if (notYet) return notYet;
  const power = mutationNumber(player, 'sonic_attack');
  if (!power || organExpression(player, 'sonic_attack') < ORGAN_FLOOR) {
    return { type: 'error', message: 'Unknown command.' };
  }

  const enemies = getZoneEnemies(player.current_zone).filter(e => e.hp > 0);

  const hits = [];
  for (const enemy of enemies) {
    const res = await applyStrikeToEnemy(player, enemy, {
      min: Math.ceil(power * 0.4), max: power, damageType: 'kinetic',
    });
    if (res) hits.push({ name: enemy.name, ...res });
    // The disorientation is the point; the damage is the smaller half.
    if (res && !res.killed) applyEffect(enemy, 'stunned', 3);
  }

  // It reaches PEOPLE too, and it does not distinguish. Nobody is damaged by it
  // — this is the deliberate difference from `shock` — but everyone in the room
  // knows you did it, which is its own consequence in a place with rules.
  const bystanders = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  for (const p of bystanders) applyEffect(p, 'sense_overload', 8);

  broadcast?.(player.current_zone, {
    type: 'zone_event',
    message: `${player.handle} opens their mouth and something comes out of it that is not a sound so much as a pressure. Your ears ring.`,
    refresh: true,
  }, player.id);

  if (!hits.length) {
    return { type: 'combat', message: 'You let it out. Glass hums, dust lifts off the floor, and nothing here was worth the headache you now have.' };
  }
  const killed = hits.filter(h => h.killed).map(h => h.name);
  let msg = `<span class="hit-part">You let it out.</span> ${hits.filter(h => !h.killed).map(h => `${h.name} reels`).join(', ') || 'The room shakes'}.`;
  if (killed.length) msg += ` <span class="msg-error">${killed.join(' and ')} goes down and does not get up.</span>`;
  return { type: 'combat', message: msg };
}

// ── morph ────────────────────────────────────────────────────────────────────
//
// The rarest mutation's verb. Deliberately NOT a combat power: it applies an
// ordinary, timed status effect, which is what keeps the rarest thing in the
// game from also having to be the strongest thing in the game. What you are
// buying is that you can decide, for a few minutes, what your body is for.
const MORPH_FORMS = {
  claws: {
    label: 'Clawed',
    blurb: 'Your fingers lengthen and harden. Bone comes through the tips and stays there.',
    stats: { stat_brawn: 2 },
  },
  hide: {
    label: 'Hardened',
    blurb: 'Your skin thickens and dulls, going grey and grainy as it sets.',
    stats: { stat_endurance: 2 },
  },
  eyes: {
    label: 'Wide-Eyed',
    blurb: 'Your pupils swallow the iris and keep going. The room gets brighter.',
    stats: { stat_senses: 2 },
  },
  legs: {
    label: 'Long-Limbed',
    blurb: 'Your legs lengthen at the knee, adding a joint that was not there.',
    stats: { stat_reflexes: 2 },
  },
};

for (const [form, def] of Object.entries(MORPH_FORMS)) {
  registerStatusEffect({
    name: `morph_${form}`,
    label: def.label,
    stats: def.stats,
    onTick: () => undefined,
  });
}

// Long enough to be worth doing, short enough that it is a decision rather than
// a permanent second sheet.
const MORPH_TICKS = 300;

async function cmdMorph(args, raw, player) {
  if (!mutationFlag(player, 'morph')) return { type: 'error', message: 'Unknown command.' };
  const notYet = tooRawToUse(player); if (notYet) return notYet;

  const want = String(args?.[0] || '').toLowerCase();
  if (!want || !MORPH_FORMS[want]) {
    return {
      type: 'info',
      message: `Your body will hold a shape for a while if you ask it to. Choose: ${Object.keys(MORPH_FORMS).join(', ')}.`,
    };
  }

  // One shape at a time. The body is doing one thing, and letting them stack
  // would turn the rarest mutation into every mutation.
  for (const form of Object.keys(MORPH_FORMS)) {
    player.statuses = (player.statuses || []).filter(s => s.name !== `morph_${form}`);
  }
  applyEffect(player, `morph_${want}`, MORPH_TICKS);

  return {
    type: 'info',
    message: `<span class="hit-part">You decide, and your body agrees.</span> ${MORPH_FORMS[want].blurb} It will not hold forever.`,
  };
}

// ── swoop ────────────────────────────────────────────────────────────────────
//
// Flight's power move, and the reason wings are worth a torso slot.
//
// It is deliberately NOT a better attack. It is a POSITIONAL one: you are only
// in the air for the moment you spend coming out of it, so the swoop hits once,
// hard, from above, and then you are on the ground in the middle of them. The
// stamina cost and the cooldown are what stop it being an opener you spam.
//
// Aimed at the HEAD by default because that is what dropping on something means,
// and routed through applyStrikeToEnemy so the head multiplier, the typed soak,
// the injury observers and the loot-on-death path all apply exactly as they do
// to a swing. Nothing here is a special case downstream.
const SWOOP_COOLDOWN_MS = 45_000;
const SWOOP_STAMINA = 25;

async function cmdSwoop(args, raw, player, broadcast) {
  if (!mutationFlag(player, 'flight')) return { type: 'error', message: 'Unknown command.' };
  const notYet = tooRawToUse(player); if (notYet) return notYet;

  const now = Date.now();
  if (player._swoopUntil && now < player._swoopUntil) {
    const secs = Math.ceil((player._swoopUntil - now) / 1000);
    return { type: 'error', message: `Your wings are still shaking. ${secs}s.` };
  }
  if ((player.stamina ?? 100) < SWOOP_STAMINA) {
    return { type: 'error', message: 'You do not have the wind in you to get up, let alone come back down like that.' };
  }

  const enemies = getZoneEnemies(player.current_zone).filter(e => e.hp > 0);
  if (!enemies.length) return { type: 'error', message: 'Nothing here is worth leaving the ground for.' };

  // The one you are already fighting, else the healthiest thing in the room —
  // you pick the target on the way down, and you pick the big one.
  const target = enemies.find(e => e.instanceId === player.combatTargetId)
    || enemies.sort((a, b) => (b.hp || 0) - (a.hp || 0))[0];

  const wingPower = getMutationExpression(player, 'mut_wb_wings')
    || Math.max(...getMutations(player).filter(m => m.mutation.effects?.flight).map(m => m.expression), 0);
  const base = 10 + Math.round(wingPower / 4);

  const res = await applyStrikeToEnemy(player, target, {
    min: base, max: base * 2, damageType: 'kinetic',
  });

  player.stamina = Math.max(0, (player.stamina ?? 100) - SWOOP_STAMINA);
  player._resDirty = true;
  player._swoopUntil = now + SWOOP_COOLDOWN_MS;
  player.combatTargetId = res?.killed ? null : target.instanceId;

  // Landing on something staggers it. The stun is most of the value: the swoop
  // buys you the next two swings, not the damage on this one.
  if (res && !res.killed) applyEffect(target, 'stunned', 4);
  await awardSkillUse(player.id, 'fists', 3);

  broadcast?.(player.current_zone, {
    type: 'zone_event',
    message: `${player.handle} goes up, hangs there for a half-second that lasts longer than it should, and comes down on ${target.name}.`,
    refresh: true,
  }, player.id);

  if (!res) return { type: 'error', message: 'You come down on nothing. It moved.' };
  if (res.killed) {
    return { type: 'combat', message: `<span class="hit-part">You drop out of the air onto ${target.name}</span> and it does not get up. <span class="msg-error">Nothing does, after that.</span>` };
  }
  return {
    type: 'combat',
    message: `<span class="hit-part">You drop out of the air onto ${target.name}</span>, ${res.damage} to the ${res.partLabel}. It reels. You are on the ground now, in the middle of them, and that was the trade.`,
  };
}

/**
 * You cannot use a new organ while you are still growing it.
 *
 * The stat penalties on `turning` already make you bad at everything; this makes
 * the ACTIVE half honest as well. An electric organ that could be fired while
 * the body building it has you on your knees would undercut the entire point of
 * the turn costing something.
 */
function tooRawToUse(player) {
  if (!isTurning(player)) return null;
  return {
    type: 'error',
    message: 'Not while you are like this. Whatever is being built in you is not finished, and it does not take instruction yet.',
  };
}

/** The expression of whichever carried mutation supplies this effect key. */
function organExpression(player, key) {
  let best = 0;
  for (const entry of getMutations(player)) {
    if (entry.mutation.effects?.[key] != null) best = Math.max(best, entry.expression);
  }
  return best;
}

export const organCommands = {
  shock: cmdShock,
  screech: cmdScreech,
  morph: cmdMorph,
  swoop: cmdSwoop,
};
