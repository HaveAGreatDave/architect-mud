/**
 * AEGIS — the shield major, and ERGOKINESIS — the blast major.
 *
 * The two disciplines that are NOT telekinesis, though the obvious reading is
 * that all three are "force". Keeping them apart is a balance decision with teeth:
 * folded together, a telekinetic major would own the frontline kit AND the
 * artillery AND the shield and would be strictly the best major in the game.
 * Split, they are three different soldiers — the one who moves things, the one
 * who burns them, and the one who stops them.
 *
 * ── A forcefield is typed soak, never a damage-reduction special case ────────
 *
 * `registerStatusEffect` already carries `stats` and `acuity` contributions, and
 * `playerPartSoak` already nets contributed soak beside armor and mutations. So a
 * ward is a status effect with a soak contribution, which buys three things for
 * free and gets the arithmetic right by construction:
 *
 *   - It stacks WITH a coat by the same rules as everything else, so it never
 *     becomes a parallel defence model nobody can reason about.
 *   - Because soak is TYPED, a ward can be strong against kinetic and useless
 *     against edged. That is a real tactical choice rather than a flat number.
 *   - It obeys PSI_CAP by never being total. A field is cover, not immunity.
 *
 * ── Holding it is the cost ───────────────────────────────────────────────────
 *
 * A ward drains resonance every minute it stands and collapses the moment the
 * pool runs dry. That is the entire tension of the discipline: resonance spent
 * holding a shield is resonance not spent on anything else, and an Aegis major
 * who wards early has nothing left when it matters.
 */
import { registerStatusEffect, applyEffect, clearEffect } from '../../server/engine/effects.js';
import {
  registerArmorContributor, addSoakToSlot, recomputeArmor,
} from '../../server/engine/commands/inventory.js';
import { applyStrikeToEnemy } from '../../server/engine/combat.js';
import { getZoneEnemies, getZonePlayers, world } from '../../server/engine/world.js';
import { awardSkillUse } from '../../server/engine/skills.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
import { PART_LABELS } from '../../server/engine/body-parts.js';
import {
  abilityRefusal, abilityCost, psiCheck, spend, resonanceOf,
  UNKNOWN, addSignature,
} from '../../server/engine/psionics.js';
import { resolveStrain } from './strain.js';
import { voice } from './prose.js';

// How long one push holds it up before it needs paying for again.
const WARD_TICKS = 120;

/**
 * What a ward actually stops.
 *
 * Strong against kinetic (a shape in the air is very good at stopping a fast
 * heavy thing) and deliberately weak against edged and energy — a blade arrives
 * along a line the field is thinnest on, and energy does not care about pressure.
 * The asymmetry is the tactical content; a flat number across all types would
 * make this an armour upgrade with a resonance bill.
 */
export const WARD_SOAK = Object.freeze({ kinetic: 6, edged: 2, energy: 1 });

export function registerAegisEffects() {
  registerStatusEffect({
    name: 'psi_ward',
    label: 'Warded',
    onTick: () => undefined,
  });
}

/** Is this body currently warded? */
function isWarded(target) {
  return (target?.statuses || []).some(s => s.name === 'psi_ward');
}

/**
 * The soak contribution.
 *
 * Registered against `registerArmorContributor` — the SAME seam mutations uses
 * for carapace and scales, landing in `player.soak` exactly the way a worn coat
 * does. That is the whole reason a ward stacks correctly with armour: it is not
 * layered on top of the soak system, it is inside it.
 *
 * Like mutation armour, a ward is ON the body rather than in a garment slot, so
 * it lands on every slot — a shape in the air does not have a sleeve.
 *
 * ⚠ Contributors run at `recomputeArmor` time, not per hit. Anything that raises
 * or drops a ward MUST call `refreshWard`, or the field will not be felt until
 * the next time the player changes clothes.
 */
export function registerAegisSoak() {
  registerArmorContributor((player, bySlot) => {
    if (!isWarded(player)) return;
    for (const slot of ['head', 'torso', 'hands', 'legs', 'feet']) {
      addSoakToSlot(bySlot, slot, WARD_SOAK);
    }
  });
}

/** Recompute soak now. Called on every raise and every collapse. */
function refreshWard(target) {
  try { recomputeArmor(target); } catch { /* an NPC with no equipment model is fine */ }
}

/** `ward` — a shape a handspan off your own skin. */
export async function ward(player, broadcast) {
  const refusal = abilityRefusal(player, 'ward', 'self');
  if (refusal === UNKNOWN) return { type: 'error', message: 'Unknown command.' };
  if (refusal) return { type: 'error', message: refusal };

  const cost = abilityCost(player, 'ward');
  const check = await psiCheck(player, 'ward');
  spend(player, cost.resonance, cost.strain + (check.success ? 0 : 1));
  await awardSkillUse(player.id, 'psionics', check.margin);
  addSignature(player.id, player.current_zone, 'aegis', 1);

  if (!check.success) {
    await resolveStrain(player, broadcast);
    return { type: 'output', message: voice(player, {
      low:  'Nothing settles. You are just standing there with your hands open.',
      high: 'The shape will not hold. It comes apart faster than you can put it up.',
    }) };
  }

  applyEffect(player, 'psi_ward', WARD_TICKS);
  refreshWard(player);
  await resolveStrain(player, broadcast);
  return { type: 'output', message: voice(player, {
    low:  'You set yourself. The air in front of you feels like it is paying attention.',
    high: 'The air a handspan off your skin goes hard and stays there.',
  }) };
}

/** `bulwark <person>` — the same shape, around somebody else. The crew verb. */
export async function bulwark(player, targetStr, broadcast) {
  const refusal = abilityRefusal(player, 'bulwark', 'person');
  if (refusal === UNKNOWN) return { type: 'error', message: 'Unknown command.' };
  if (refusal) return { type: 'error', message: refusal };

  const others = (getZonePlayers(player.current_zone) || []).filter(p => p.id !== player.id);
  if (!others.length) return { type: 'error', message: 'There is nobody here to cover.' };
  const target = targetStr
    ? siftResolve(targetStr, others, { verb: 'bulwark' })
    : others[0];
  if (!target || target === 'ambiguous') return { type: 'error', message: 'Cover who?' };

  const cost = abilityCost(player, 'bulwark');
  const check = await psiCheck(player, 'bulwark');
  spend(player, cost.resonance, cost.strain + (check.success ? 0 : 2));
  await awardSkillUse(player.id, 'psionics', check.margin);
  addSignature(player.id, player.current_zone, 'aegis', 1.5);

  if (!check.success) {
    await resolveStrain(player, broadcast);
    return { type: 'output', message: 'It will not reach that far.' };
  }

  applyEffect(target, 'psi_ward', WARD_TICKS);
  refreshWard(target);
  await resolveStrain(player, broadcast);
  if (broadcast) {
    broadcast(player.current_zone, {
      type: 'zone_event', refresh: true,
      message: `The air around ${target.handle} thickens.`,
    }, player.id);
  }
  return { type: 'output', message: voice(player, {
    low:  `You put yourself between ${target.handle} and whatever is coming, without moving.`,
    high: `You close the air around ${target.handle} like a hand around a candle.`,
  }) };
}

/**
 * `redoubt` — a shape across the whole room, over everyone in it.
 *
 * Master, focus-only, Stillhouse-gated. This is what an Aegis major exists for and
 * it should be the reason a crew brings one. Note it covers EVERYONE, including
 * people the psion did not choose, which is both generous and occasionally a
 * mistake, and is much more interesting than a friend-or-foe check would be.
 */
export async function redoubt(player, broadcast) {
  const refusal = abilityRefusal(player, 'redoubt', 'place');
  if (refusal === UNKNOWN) return { type: 'error', message: 'Unknown command.' };
  if (refusal) return { type: 'error', message: refusal };

  const cost = abilityCost(player, 'redoubt');
  const check = await psiCheck(player, 'redoubt');
  spend(player, cost.resonance, cost.strain + (check.success ? 0 : 4));
  await awardSkillUse(player.id, 'psionics', check.margin);
  addSignature(player.id, player.current_zone, 'aegis', 4);

  if (!check.success) {
    await resolveStrain(player, broadcast);
    return { type: 'output', message: 'The room is too big. It collapses inward and takes your breath with it.' };
  }

  for (const p of (getZonePlayers(player.current_zone) || [])) {
    applyEffect(p, 'psi_ward', WARD_TICKS);
    refreshWard(p);
  }
  if (broadcast) {
    broadcast(player.current_zone, {
      type: 'zone_event', refresh: true,
      message: 'The room changes pressure. Everything in it feels held.',
    }, player.id);
  }
  await resolveStrain(player, broadcast);
  return { type: 'output', message: voice(player, {
    low:  'You take hold of the whole room and the whole room lets you.',
    high: 'You put a shape over everyone here at once, and you will not be doing anything else while it stands.',
  }) };
}

/**
 * The ward's upkeep. Called from the minute tick.
 *
 * Drains while it stands and collapses at empty. Deliberately NOT a silent expiry
 * — a shield that vanishes without telling you is a shield you get killed behind.
 */
export function wardUpkeep(player) {
  const has = (player.statuses || []).some(s => s.name === 'psi_ward');
  if (!has) return;
  if (resonanceOf(player) < 2) {
    clearEffect(player, 'psi_ward');
    refreshWard(player);
    return 'The shape goes out of the air. There is nothing left to hold it up with.';
  }
  spend(player, 2, 1);
  return null;
}

// ── Ergokinesis ──────────────────────────────────────────────────────────────
//
// `damageType: 'energy'` is already first-class in the typed-soak table and
// plugins/mutations/organs.js already fires energy through applyStrikeToEnemy for
// the shock organ. So a discharge is that call with a bigger range, a chosen part
// and a real price: it inherits part rolls, typed soak, damage observers, injury
// and loot-on-death, and there is no second combat path anywhere.
//
// This is the discipline that ENDS deniability. It leaves the loudest signature in
// the game and it cannot be mistaken for anything except what it is.

async function discharge(player, abilityId, args, broadcast, { min, max, sigStrength }) {
  const refusal = abilityRefusal(player, abilityId, 'person');
  if (refusal === UNKNOWN) return { type: 'error', message: 'Unknown command.' };
  if (refusal) return { type: 'error', message: refusal };

  const enemies = (getZoneEnemies(player.current_zone) || []).filter(e => e.hp > 0);
  if (!enemies.length) return { type: 'error', message: 'There is nothing here to burn.' };

  const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
  let calledPart = null;
  if (parts.length > 1 && PART_LABELS[parts[parts.length - 1].toLowerCase()]) {
    calledPart = parts.pop().toLowerCase();
  }
  const target = parts.length ? siftResolve(parts.join(' '), enemies, { verb: 'burn' }) : enemies[0];
  if (!target || target === 'ambiguous') return { type: 'error', message: 'Burn what?' };

  const cost = abilityCost(player, abilityId);
  const check = await psiCheck(player, abilityId, calledPart ? 3 : 0);
  spend(player, cost.resonance, cost.strain + (check.success ? 0 : 3));
  await awardSkillUse(player.id, 'psionics', check.margin);
  addSignature(player.id, player.current_zone, 'ergokinesis', sigStrength);

  if (!check.success) {
    await resolveStrain(player, broadcast);
    return { type: 'combat', message: 'The charge goes nowhere and comes back through your teeth.' };
  }

  const scale = Math.max(0, Math.min(8, check.margin));
  const hit = await applyStrikeToEnemy(player, target, {
    min: min + scale, max: max + scale, damageType: 'energy',
  });
  if (!hit) {
    await resolveStrain(player, broadcast);
    return { type: 'combat', message: 'It is already down.' };
  }

  if (broadcast) {
    broadcast(player.current_zone, {
      type: 'zone_event', refresh: true,
      message: `The air cracks. ${target.name} is burning and nobody struck a light.`,
    }, player.id);
  }
  await resolveStrain(player, broadcast);
  const line = voice(player, {
    low:  `Something arcs. ${target.name} takes it across the ${hit.partLabel}. (${hit.damage})`,
    high: `You put it through ${target.name}'s ${hit.partLabel} and the room goes white for a moment. (${hit.damage})`,
  });
  return { type: 'combat', message: hit.killed ? `${line}<br>${target.name} stops.` : line };
}

export const spark = (player, args, broadcast) =>
  discharge(player, 'spark', args, broadcast, { min: 3, max: 7, sigStrength: 2 });

export const burn = (player, args, broadcast) =>
  discharge(player, 'burn', args, broadcast, { min: 8, max: 16, sigStrength: 4 });

/** `cascade` — the room, all of it. Master, focus-only, Stillhouse-gated. */
export async function cascade(player, broadcast) {
  const refusal = abilityRefusal(player, 'cascade', 'place');
  if (refusal === UNKNOWN) return { type: 'error', message: 'Unknown command.' };
  if (refusal) return { type: 'error', message: refusal };

  const enemies = (getZoneEnemies(player.current_zone) || []).filter(e => e.hp > 0);
  if (!enemies.length) return { type: 'error', message: 'There is nothing here worth it.' };

  const cost = abilityCost(player, 'cascade');
  const check = await psiCheck(player, 'cascade');
  spend(player, cost.resonance, cost.strain + (check.success ? 0 : 6));
  await awardSkillUse(player.id, 'psionics', check.margin);
  addSignature(player.id, player.current_zone, 'ergokinesis', 8);

  const lines = [];
  if (check.success) {
    const scale = Math.max(0, Math.min(6, check.margin));
    for (const e of enemies) {
      const hit = await applyStrikeToEnemy(player, e, {
        min: 7 + scale, max: 15 + scale, damageType: 'energy',
      });
      if (hit) lines.push(`${e.name}: ${hit.damage}${hit.killed ? ' (down)' : ''}`);
    }
    if (broadcast) {
      broadcast(player.current_zone, {
        type: 'zone_event', refresh: true,
        message: 'Every surface in the room goes bright at once.',
      }, player.id);
    }
  } else {
    lines.push('It gets away from you before it leaves your hands.');
  }

  // Cascade routinely lands the caster in Critical or Overload, and that is the
  // design. The most powerful thing in the arsenal should reliably put you on the
  // floor afterwards; the seizure IS the balance.
  await resolveStrain(player, broadcast);
  return { type: 'combat', message: lines.join('<br>') };
}
