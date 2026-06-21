import { query } from '../../models/db.js';
import { awardSkillXp } from '../skills.js';
import { useDrug } from '../drugs.js';
import { hasTag, tagValue, hasFlag, TAG_CATALOG } from '../tags.js';

const INSTANCE_FLAGS = Object.keys(TAG_CATALOG).filter(n => TAG_CATALOG[n].scope === 'instance');

export const EQUIP_SLOTS = {
  head: 'Head', torso: 'Torso', hands: 'Hands', legs: 'Legs', feet: 'Feet',
  weapon_hand: 'Weapon Hand', accessory: 'Accessory',
};

export async function recomputeArmor(player) {
  const { rows } = await query(`SELECT i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1`, [player.id]);
  player.armor = rows.reduce((sum, r) => sum + (tagValue(r, 'armor', 0) || 0), 0);
}

async function cmdInventory(player) {
  const { rows } = await query(`SELECT pi.*,i.name,i.rarity,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 ORDER BY i.name`, [player.id]);
  if (!rows.length) return { type:'inventory', message:'Your inventory is empty.', items:[] };
  let msg = '<span class="inv-header">INVENTORY</span>\n';
  for (const item of rows) {
    const eq = item.is_equipped ? ' <span class="equipped">[equipped]</span>' : '';
    const quality = item.custom_data?.quality ? ` [${item.custom_data.quality}]` : '';
    const instFlags = INSTANCE_FLAGS.filter(n => hasFlag(item, n)).map(n => ` [${n}]`).join('');
    msg += `  ${item.name}${item.quantity>1?` x${item.quantity}`:''}${quality}${instFlags}${eq} — <span class="item-rarity-${item.rarity}">${item.rarity}</span>\n`;
  }
  msg += `\nCredits: ${player.credits||0}`;
  return { type:'inventory', message:msg, items:rows };
}

async function cmdTake(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Take what?' };

  if (targetStr.toLowerCase() === 'all') {
    const { rows: allGround } = await query(
      `SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1`,
      [`_ground_${player.current_zone}`]
    );
    if (!allGround.length) return { type:'error', message:'Nothing here to take.' };
    const messages = [];
    for (const ground of allGround) {
      if (hasTag(ground, 'stackable')) {
        const { rows: existing } = await query(
          'SELECT id, quantity FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0',
          [player.id, ground.item_id]
        );
        if (existing.length) {
          await query('UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2', [ground.quantity, existing[0].id]);
          await query('DELETE FROM player_inventory WHERE id=$1', [ground.id]);
          await awardSkillXp(player.id, 'scavenging', 2);
          broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} picks up ${ground.name}.` }, player.id);
          messages.push(`You pick up ${ground.name}.`);
          continue;
        }
      }
      await query('UPDATE player_inventory SET player_id=$1 WHERE id=$2', [player.id, ground.id]);
      await awardSkillXp(player.id, 'scavenging', 2);
      broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} picks up ${ground.name}.` }, player.id);
      messages.push(`You pick up ${ground.name}.`);
    }
    return { type:'take', message:messages.join('\n') };
  }

  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 LIMIT 1`, [`_ground_${player.current_zone}`, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`Can't find "${targetStr}" here.` };
  const ground = rows[0];

  if (hasTag(ground, 'stackable')) {
    const { rows: existing } = await query(
      'SELECT id, quantity FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0',
      [player.id, ground.item_id]
    );
    if (existing.length) {
      await query('UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2', [ground.quantity, existing[0].id]);
      await query('DELETE FROM player_inventory WHERE id=$1', [ground.id]);
      await awardSkillXp(player.id, 'scavenging', 2);
      broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} picks up ${ground.name}.` }, player.id);
      return { type:'take', message:`You pick up ${ground.name}.` };
    }
  }

  await query('UPDATE player_inventory SET player_id=$1 WHERE id=$2', [player.id, ground.id]);
  await awardSkillXp(player.id, 'scavenging', 2);
  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} picks up ${ground.name}.` }, player.id);
  return { type:'take', message:`You pick up ${ground.name}.` };
}

async function cmdDrop(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Drop what?' };
  const { rows } = await query(`SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 AND NOT jsonb_exists(i.tags,'quest_item') LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`You don't have "${targetStr}".` };
  await query('UPDATE player_inventory SET player_id=$1 WHERE id=$2', [`_ground_${player.current_zone}`, rows[0].id]);
  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} drops ${rows[0].name}.` }, player.id);
  return { type:'drop', message:`You drop ${rows[0].name}.` };
}

async function cmdUse(targetStr, player) {
  if (!targetStr) return { type:'error', message:'Use what?' };

  const { rows: drugRows } = await query(
    `SELECT pi.*, i.name, d.id as drug_id FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     JOIN drugs d ON d.item_id = i.id
     WHERE pi.player_id=$1 AND i.name ILIKE $2 LIMIT 1`,
    [player.id, `%${targetStr}%`]
  );
  if (drugRows.length) {
    const item = drugRows[0];
    const result = await useDrug(player, item.drug_id);
    if (!result.success) return { type:'error', message: result.message };
    if (item.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [item.id]);
    else await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
    return { type:'use', message: result.message, player_update: result.player_update };
  }

  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 AND jsonb_exists(i.tags,'consumable') LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`No usable item "${targetStr}" in inventory.` };
  const item = rows[0];
  const t = item.tags || {};
  const messages = [`You use ${item.name}.`];
  if (t.restore_hp) { player.hp = Math.min(player.hp_max, player.hp+t.restore_hp); messages.push(`+${t.restore_hp} HP.`); }
  if (t.restore_hunger) { player.hunger = Math.min(100, player.hunger+t.restore_hunger); messages.push(`+${t.restore_hunger} Hunger.`); }
  if (t.restore_thirst) { player.thirst = Math.min(100, player.thirst+t.restore_thirst); messages.push(`+${t.restore_thirst} Thirst.`); }
  if (t.restore_radiation) { player.radiation = Math.max(0, player.radiation+t.restore_radiation); messages.push(`${t.restore_radiation} Radiation.`); }
  if (t.restore_sanity) { player.sanity = Math.min(player.sanity_max, Math.max(0, player.sanity+t.restore_sanity)); messages.push(`${t.restore_sanity>0?'+':''}${t.restore_sanity} Sanity.`); }
  if (t.grants_credits) { player.credits = (player.credits||0)+t.grants_credits; messages.push(`+${t.grants_credits} credits.`); }
  if (t.heal_over_time) {
    const { amount, duration_seconds } = t.heal_over_time;
    const ticks = Math.max(1, Math.round(duration_seconds / 60));
    const perTick = Math.ceil(amount / ticks);
    player.healOverTime = player.healOverTime || [];
    player.healOverTime.push({ perTick, ticksRemaining: ticks });
    messages.push(`Bleeding slows. You'll recover ${amount} HP over the next ${Math.round(duration_seconds/60)} minute(s).`);
  }
  if (t.well_fed) {
    player.wellFedUntil = Date.now() + 10 * 60 * 1000;
    messages.push(`Well-fed: HP regen is faster for a while.`);
  }
  if (t.hydrating) {
    player.hydratedUntil = Date.now() + 10 * 60 * 1000;
    messages.push(`Hydrated: radiation clears faster for a while.`);
  }
  await query('UPDATE players SET hp=$1,hunger=$2,thirst=$3,radiation=$4,sanity=$5,credits=$6 WHERE id=$7', [player.hp,player.hunger,player.thirst,player.radiation,player.sanity,player.credits,player.id]);
  if (item.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [item.id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
  await awardSkillXp(player.id, 'medicine', 1);
  return { type:'use', message:messages.join('\n'), player_update:{hp:player.hp,hunger:player.hunger,thirst:player.thirst,radiation:player.radiation,sanity:player.sanity,credits:player.credits} };
}

async function cmdEquip(targetStr, player) {
  if (!targetStr) return { type:'error', message:'Equip what?' };
  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 AND jsonb_exists(i.tags,'slot') LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`Can't equip "${targetStr}".` };
  const item = rows[0];
  const reqs = tagValue(item, 'requires', {}) || {};
  for (const [stat,val] of Object.entries(reqs)) {
    if ((player[stat]||0) < val) return { type:'error', message:`Need ${stat.replace('stat_','')} ${val} to use this.` };
  }
  const slotName = tagValue(item, 'slot');
  const slot = EQUIP_SLOTS[slotName] ? slotName : null;
  if (!slot) return { type:'error', message:`${item.name} doesn't have a valid equip slot configured.` };
  await query('UPDATE player_inventory SET is_equipped=0 WHERE player_id=$1 AND slot=$2', [player.id, slot]);
  await query('UPDATE player_inventory SET is_equipped=1,slot=$1 WHERE id=$2', [slot, item.id]);
  return { type:'equip', message:`You equip ${item.name}.`, slot };
}

async function cmdUnequip(targetStr, player) {
  if (!targetStr) return { type:'error', message:'Unequip what?' };
  const { rows } = await query(`SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1 AND i.name ILIKE $2 LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`You don't have "${targetStr}" equipped.` };
  await query('UPDATE player_inventory SET is_equipped=0 WHERE id=$1', [rows[0].id]);
  return { type:'equip', message:`You unequip ${rows[0].name}.` };
}

async function cmdEquipById(inventoryId, player) {
  if (!inventoryId) return { type:'error', message:'Nothing selected to equip.' };
  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1 AND pi.player_id=$2 AND jsonb_exists(i.tags,'slot') LIMIT 1`, [inventoryId, player.id]);
  if (!rows.length) return { type:'error', message:`Can't equip that.` };
  const item = rows[0];
  const reqs = tagValue(item, 'requires', {}) || {};
  for (const [stat,val] of Object.entries(reqs)) {
    if ((player[stat]||0) < val) return { type:'error', message:`Need ${stat.replace('stat_','')} ${val} to use this.` };
  }
  const slotName = tagValue(item, 'slot');
  const slot = EQUIP_SLOTS[slotName] ? slotName : null;
  if (!slot) return { type:'error', message:`${item.name} doesn't have a valid equip slot configured.` };
  await query('UPDATE player_inventory SET is_equipped=0 WHERE player_id=$1 AND slot=$2', [player.id, slot]);
  await query('UPDATE player_inventory SET is_equipped=1,slot=$1 WHERE id=$2', [slot, item.id]);
  return { type:'equip', message:`You equip ${item.name}.`, slot };
}

async function cmdUnequipById(inventoryId, player) {
  if (!inventoryId) return { type:'error', message:'Nothing selected to unequip.' };
  const { rows } = await query(`SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1 AND pi.player_id=$2 AND pi.is_equipped=1 LIMIT 1`, [inventoryId, player.id]);
  if (!rows.length) return { type:'error', message:`That isn't equipped.` };
  await query('UPDATE player_inventory SET is_equipped=0 WHERE id=$1', [rows[0].id]);
  return { type:'equip', message:`You unequip ${rows[0].name}.` };
}

export const handlers = {
  inventory: (args, raw, player) => cmdInventory(player),
  inv: (args, raw, player) => cmdInventory(player),
  i: (args, raw, player) => cmdInventory(player),
  take: (args, raw, player, broadcast) => cmdTake(args.join(' '), player, broadcast),
  get:  (args, raw, player, broadcast) => cmdTake(args.join(' '), player, broadcast),
  drop: (args, raw, player, broadcast) => cmdDrop(args.join(' '), player, broadcast),
  use:   (args, raw, player) => cmdUse(args.join(' '), player),
  eat:   (args, raw, player) => cmdUse(args.join(' '), player),
  drink: (args, raw, player) => cmdUse(args.join(' '), player),
  equip:    (args, raw, player) => cmdEquip(args.join(' '), player),
  wear:     (args, raw, player) => cmdEquip(args.join(' '), player),
  unequip:  (args, raw, player) => cmdUnequip(args.join(' '), player),
  remove:   (args, raw, player) => cmdUnequip(args.join(' '), player),
  equipid:   (args, raw, player) => cmdEquipById(args[0], player),
  unequipid: (args, raw, player) => cmdUnequipById(args[0], player),
};
