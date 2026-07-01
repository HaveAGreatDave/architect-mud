// Destructible power infrastructure — generators and junction boxes.
//
// These are `furniture` rows carrying hp/hp_max (see schema) plus a
// flags.generator_id link to the `generators` row they physically embody.
// Smashing the furniture to 0 hp flips that generator to destroyed/offline,
// and the environment power sim (Phase 1) then cuts power downstream — a
// junction box darkens its building; the Coldwater city plant blacks out the
// whole grid.
//
// Toughness knobs live in DEVICE_SPECS. `soak` is flat damage absorbed per hit
// (so weak weapons/fists do nothing); `requiresDemolition` gates the unit to
// items tagged `demolition` (sledgehammer, cutting torch, breaching charge).

import { query } from '../../models/db.js';
import { propagateSound } from '../sounds.js';
import { isOnCooldown, setCooldown, getCooldownRemaining } from '../combat.js';
import { hasTag, tagValue } from '../tags.js';
import { recomputePower } from '../environment.js';

// Tunable per object_type. Playtest and adjust freely — HP lives on the row,
// soak/gate live here.
const DEVICE_SPECS = {
  generator:    { requiresDemolition: true,  soak: 25 }, // Coldwater plant: demolition-only, brutal wall
  junction_box: { requiresDemolition: false, soak: 4  }, // melee allowed but heavily resisted
};

async function findDestructible(zoneId, targetStr) {
  const { rows } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND hp_max IS NOT NULL AND name ILIKE $2
     ORDER BY length(name) LIMIT 1`,
    [zoneId, `%${targetStr}%`]
  );
  return rows[0] || null;
}

// Returns a command result, or null when there's no destructible unit matching
// `targetStr` here (so cmdAttack can fall through to players / "can't find").
export async function cmdAttackDestructible(targetStr, player, broadcast) {
  const f = await findDestructible(player.current_zone, targetStr);
  if (!f) return null;
  const spec = DEVICE_SPECS[f.object_type];
  if (!spec) return null;

  if ((f.hp ?? 0) <= 0)
    return { type: 'error', message: `The ${f.name} is already wrecked — a dead, scorched hulk.` };

  const { rows } = await query(
    `SELECT i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id
      WHERE pi.player_id=$1 AND pi.is_equipped=1 AND jsonb_exists(i.tags,'weapon') LIMIT 1`,
    [player.id]
  );
  const equipped = rows[0] || null;
  const isDemo = equipped ? hasTag(equipped, 'demolition') : false;

  if (spec.requiresDemolition && !isDemo) {
    return { type: 'error', message:
      `Your blows barely scuff the ${f.name}'s armoured casing. You'd need real demolition gear — a sledgehammer, a cutting torch, something with bite.` };
  }

  if (isOnCooldown(player.id, 'attack'))
    return { type: 'error', message: `You're still recovering. (${(getCooldownRemaining(player.id, 'attack') / 1000).toFixed(1)}s)` };
  setCooldown(player.id, 'attack');

  const dmg  = equipped ? (tagValue(equipped, 'damage', {}) || {}) : {};
  const dmin = dmg.min ?? (equipped ? 3 : 2);
  const dmax = dmg.max ?? (equipped ? 8 : 4);
  const raw  = Math.floor(Math.random() * (dmax - dmin + 1)) + dmin;
  const damage = Math.max(0, raw - spec.soak);

  if (damage <= 0) {
    propagateSound(player.current_zone, 'You hear a dull clang of metal on metal nearby.', 1.5, broadcast);
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} strikes the ${f.name}, to little effect.` }, player.id);
    return { type: 'combat', message: `You strike the ${f.name}, but its casing shrugs it off. (0 damage — ${f.hp}/${f.hp_max} HP)` };
  }

  const newHp = Math.max(0, (f.hp ?? f.hp_max) - damage);
  await query('UPDATE furniture SET hp=$1 WHERE id=$2', [newHp, f.id]);
  propagateSound(player.current_zone, 'You hear someone battering heavy machinery nearby.', 2.5, broadcast);
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} attacks the ${f.name}!` }, player.id);

  if (newHp <= 0) return destroyDevice(f, player, broadcast, damage);
  return { type: 'combat', message: `You hit the ${f.name} for ${damage} damage. (${newHp}/${f.hp_max} HP remaining)` };
}

async function destroyDevice(f, player, broadcast, damage) {
  const genId = f.flags?.generator_id || null;
  if (genId) {
    await query(
      `UPDATE generators SET status='offline', flags = COALESCE(flags,'{}'::jsonb) || '{"destroyed":true}'::jsonb WHERE id=$1`,
      [genId]
    );
  }
  const destroyMsg = f.object_type === 'generator'
    ? `The ${f.name} erupts in a geyser of sparks; its turbine screams down to a dead stop.`
    : `The ${f.name} bursts open in a shower of sparks and shorts out.`;
  broadcast(player.current_zone, { type: 'zone_event', message: destroyMsg, refresh: true }, player.id);
  propagateSound(player.current_zone, 'You hear a violent electrical BANG and machinery dying nearby.', 3.5, broadcast);

  // Recompute power now so dependent zones go dark immediately (not next tick).
  await recomputePower().catch(() => {});

  return { type: 'combat', message:
    `You smash the ${f.name} apart! (${damage} damage) It sparks, dies, and the power drops.` };
}

// `repair <unit>` — bring a wrecked generator / junction box back online. Needs
// heavy tools (a cutting torch doubles as a welding rig), restores full hp,
// clears the linked generator's destroyed flag, and recomputes power — which
// fires the power-up sound + flash + ambience via the environment reconcile.
export async function cmdRepairDevice(targetStr, player, broadcast) {
  if (!targetStr) return { type: 'error', message: 'Repair what?' };
  const f = await findDestructible(player.current_zone, targetStr);
  if (!f || !DEVICE_SPECS[f.object_type])
    return { type: 'error', message: `There's no repairable machinery here matching "${targetStr}".` };
  if ((f.hp ?? 0) >= (f.hp_max ?? 0))
    return { type: 'output', message: `The ${f.name} is intact — nothing to repair.` };

  const { rows } = await query(
    `SELECT i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id
      WHERE pi.player_id=$1 AND pi.container_id IS NULL AND jsonb_exists(i.tags,'demolition') LIMIT 1`,
    [player.id]
  );
  if (!rows.length)
    return { type: 'error', message: `You need heavy tools to work on the ${f.name} — a cutting torch or similar.` };

  if (isOnCooldown(player.id, 'attack'))
    return { type: 'error', message: `You're still working. (${(getCooldownRemaining(player.id, 'attack') / 1000).toFixed(1)}s)` };
  setCooldown(player.id, 'attack');

  await query('UPDATE furniture SET hp=hp_max WHERE id=$1', [f.id]);
  const genId = f.flags?.generator_id || null;
  if (genId) {
    await query(`UPDATE generators SET status='online', flags = COALESCE(flags,'{}'::jsonb) - 'destroyed' WHERE id=$1`, [genId]);
  }
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} finishes repairs on the ${f.name}. It shudders back to life.`, refresh: true }, player.id);
  propagateSound(player.current_zone, 'You hear machinery grinding back into motion nearby.', 2.5, broadcast);

  await recomputePower().catch(() => {});
  return { type: 'combat', message: `You bring the ${f.name} back online. Power surges through the grid.` };
}
