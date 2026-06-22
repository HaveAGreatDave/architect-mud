import { query } from '../../models/db.js';
import { getZoneEnemies, getZoneCorpses, getZonePlayers } from '../world.js';
import { playerAttackEnemy } from '../combat.js';
import { awardSkillUse, skillCheck } from '../skills.js';
import { hasTag, tagValue } from '../tags.js';
import { randomUUID } from 'crypto';

export async function resolveAttack(player, target, broadcast) {
  const { rows } = await query(`SELECT i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1 AND jsonb_exists(i.tags,'weapon') LIMIT 1`, [player.id]);
  const equipped = rows[0];
  const dmg = equipped ? (tagValue(equipped, 'damage', {}) || {}) : {};
  const wskill = equipped ? (tagValue(equipped, 'weapon_skill') || 'brawling') : 'brawling';
  const weaponStats = equipped
    ? { damage_min: dmg.min, damage_max: dmg.max, status_chance: tagValue(equipped, 'status_chance'), weapon_skill: wskill, damage_type: tagValue(equipped, 'damage_type') || 'kinetic' }
    : { damage_min:2, damage_max:4, weapon_skill:'brawling', damage_type:'kinetic' };
  const result = await playerAttackEnemy(player, target.instanceId, weaponStats);
  if (!result.success) return { type:'error', message:result.message };

  if (result.hit) {
    const skillId = wskill === 'bladed' ? 'bladed' : wskill === 'energy' ? 'electronics' : 'brawling';
    await awardSkillUse(player.id, skillId, result.margin ?? 1);
  }

  if (result.killed) {
    if (result.credit_reward > 0) {
      player.credits = (player.credits||0) + result.credit_reward;
      await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
    }
    if (result.loot?.length) {
      for (const drop of result.loot) {
        await query('INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,$4,0.8)',
          [randomUUID(), `_ground_${player.current_zone}`, drop.item_id, drop.quantity]);
      }
    }
    broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} kills ${target.name}.` }, player.id);
  } else {
    broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} attacks ${target.name}.` }, player.id);
  }
  return { type:'combat', message:result.message, killed:result.killed||false, loot:result.loot, xp_reward:result.xp_reward };
}

async function cmdAttack(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Attack what?' };
  const enemies = getZoneEnemies(player.current_zone);
  if (!enemies.length) return { type:'error', message:'Nothing to attack here.' };
  const target = enemies.find(e => e.name.toLowerCase().includes(targetStr));
  if (!target) return { type:'error', message:`Can't find "${targetStr}" here.` };
  return resolveAttack(player, target, broadcast);
}

async function cmdLootCorpse(targetStr, player, broadcast) {
  const corpses = getZoneCorpses(player.current_zone);
  if (!corpses.length) return { type:'error', message:'No corpses to loot here.' };
  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1`, [`_corpse_${player.current_zone}`]);
  if (!rows.length) return { type:'error', message:'Nothing left to loot.' };

  const looted = [];
  for (const item of rows) {
    if (hasTag(item, 'stackable')) {
      const { rows: existing } = await query(
        'SELECT id, quantity FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0',
        [player.id, item.item_id]
      );
      if (existing.length) {
        await query('UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2', [item.quantity, existing[0].id]);
        await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
        looted.push(item.name);
        continue;
      }
    }
    await query('UPDATE player_inventory SET player_id=$1 WHERE id=$2', [player.id, item.id]);
    looted.push(item.name);
  }
  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} loots a corpse.` }, player.id);
  return { type:'loot', message:`You loot the corpse: ${looted.join(', ')}.` };
}

const STEAL_COOLDOWN_MS = 60000;
const stealCooldowns = new Map();

async function cmdSteal(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Steal from whom?' };
  const { getZone } = await import('../world.js');
  const zone = getZone(player.current_zone);
  if (zone?.is_safe_zone) return { type:'error', message:'Too many witnesses. Not here.' };

  const last = stealCooldowns.get(player.id) || 0;
  if (Date.now() - last < STEAL_COOLDOWN_MS) {
    return { type:'error', message:`Too soon to try that again. (${Math.ceil((STEAL_COOLDOWN_MS-(Date.now()-last))/1000)}s)` };
  }

  const others = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  const target = others.find(p => p.handle.toLowerCase().includes(targetStr.toLowerCase()));
  if (!target) return { type:'error', message:`Can't find "${targetStr}" here.` };

  stealCooldowns.set(player.id, Date.now());
  if ((target.credits||0) <= 0) return { type:'error', message:`${target.handle} isn't carrying any credits.` };

  const result = await skillCheck(player, 'deception', 7);
  const caught = !result.success;

  if (caught) {
    broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} tries to pick ${target.handle}'s pocket and gets caught red-handed.` }, player.id);
    return { type:'error', message:`You go for ${target.handle}'s pocket. They notice immediately. Everyone noticed, actually.` };
  }

  const amount = Math.min(target.credits, Math.ceil(target.credits * (0.1 + Math.random()*0.2)));
  target.credits -= amount;
  player.credits = (player.credits||0) + amount;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [target.credits, target.id]);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await awardSkillUse(player.id, 'deception', result.margin);
  return { type:'steal', message:`You lift ${amount}c off ${target.handle} without them noticing a thing.`, player_update:{credits:player.credits} };
}

export const handlers = {
  attack: (args, raw, player, broadcast) => cmdAttack(args.join(' '), player, broadcast),
  kill:   (args, raw, player, broadcast) => cmdAttack(args.join(' '), player, broadcast),
  k:      (args, raw, player, broadcast) => cmdAttack(args.join(' '), player, broadcast),
  loot:   (args, raw, player, broadcast) => cmdLootCorpse(args.join(' '), player, broadcast),
  steal:  (args, raw, player, broadcast) => cmdSteal(args.join(' '), player, broadcast),
};
