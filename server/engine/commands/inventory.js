import { query } from '../../models/db.js';
import { useDrug } from '../drugs.js';
import { hasTag, tagValue, hasFlag, TAG_CATALOG } from '../tags.js';
import { foodLoad, drinkLoad } from '../bodily.js';
import { dispatchAction } from '../actions.js';
import { getZonePlayers } from '../world.js';

const INSTANCE_FLAGS = Object.keys(TAG_CATALOG).filter(n => TAG_CATALOG[n].scope === 'instance');

export const EQUIP_SLOTS = {
  head: 'Head', torso: 'Torso', hands: 'Hands', legs: 'Legs', feet: 'Feet',
  weapon_hand: 'Weapon Hand', accessory: 'Accessory',
};

// Build a per-slot typed-soak structure for the player from equipped armor.
// player.soak[slot] = { soak: { kinetic:4, ... }, flat: <legacy armor int> }.
// Combat routes the weapon's damage_type through the struck part's slot here.
export async function recomputeArmor(player) {
  const { rows } = await query(`SELECT i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1`, [player.id]);
  const bySlot = {};
  for (const r of rows) {
    const slot = tagValue(r, 'slot');
    if (!slot) continue;
    const entry = bySlot[slot] || (bySlot[slot] = { soak: {}, flat: 0 });
    const sm = tagValue(r, 'armor_soak');
    if (sm && typeof sm === 'object') {
      for (const [type, val] of Object.entries(sm)) entry.soak[type] = (entry.soak[type] || 0) + (Number(val) || 0);
    }
    entry.flat += tagValue(r, 'armor', 0) || 0;
  }
  player.soak = bySlot;
}

export async function recomputeInsulation(player) {
  const { rows } = await query(`SELECT i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1`, [player.id]);
  let total = 0;
  for (const r of rows) total += tagValue(r, 'insulation', 0) || 0;
  player.insulation = total;
}

async function cmdInventory(player) {
  const { rows } = await query(`SELECT pi.*,i.name,i.rarity,i.tags,i.weight FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL ORDER BY i.name`, [player.id]);
  if (!rows.length) return { type:'inventory', message:'Your inventory is empty.', items:[] };
  let msg = '<span class="inv-header">INVENTORY</span>\n';
  for (const item of rows) {
    const eq = item.is_equipped ? ' <span class="equipped">[equipped]</span>' : '';
    const quality = item.custom_data?.quality ? ` [${item.custom_data.quality}]` : '';
    const instFlags = INSTANCE_FLAGS.filter(n => hasFlag(item, n)).map(n => ` [${n}]`).join('');
    let container = '';
    if (hasTag(item, 'container')) {
      const used = await containerContentsWeight(item.id);
      container = ` <span class="equipped">[${round1(used)}/${tagValue(item, 'container', 0)}]</span>`;
    }
    msg += `  ${item.name}${item.quantity>1?` x${item.quantity}`:''}${quality}${instFlags}${container}${eq} — <span class="item-rarity-${item.rarity}">${item.rarity}</span>\n`;
  }
  const weight = await computeCarriedWeight(player);
  msg += `\nWeight: ${round1(weight)}`;
  msg += `\nCredits: ${player.credits||0}`;
  return { type:'inventory', message:msg, items:rows };
}

function round1(n) { return Math.round(n * 10) / 10; }

// Sum of weight*quantity for everything inside a given container row.
async function containerContentsWeight(containerRowId) {
  const { rows } = await query(`SELECT COALESCE(SUM(i.weight*pi.quantity),0) AS w FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.container_id=$1`, [containerRowId]);
  return Number(rows[0].w) || 0;
}

// Total carried weight: top-level items at full weight, contained items at 75%.
export async function computeCarriedWeight(player) {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(i.weight*pi.quantity) FILTER (WHERE pi.container_id IS NULL),0) AS top,
       COALESCE(SUM(i.weight*pi.quantity) FILTER (WHERE pi.container_id IS NOT NULL),0) AS contained
     FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1`,
    [player.id]
  );
  return (Number(rows[0].top) || 0) + (Number(rows[0].contained) || 0) * 0.75;
}

async function cmdTake(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Take what?' };
  if (targetStr.toLowerCase().includes(' from ')) return cmdPull(targetStr, player);

  if (targetStr.toLowerCase() === 'all') {
    const { rows: allGround } = await query(
      `SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL`,
      [`_ground_${player.current_zone}`]
    );
    if (!allGround.length) return { type:'error', message:'Nothing here to take.' };
    const messages = [];
    for (const ground of allGround) {
      const r = await dispatchAction({ type:'TAKE', actor: player, params: { row: ground }, context: { broadcast } });
      messages.push(r.message);
    }
    return { type:'take', message:messages.join('\n') };
  }

  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND i.name ILIKE $2 LIMIT 1`, [`_ground_${player.current_zone}`, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`Can't find "${targetStr}" here.` };
  return dispatchAction({ type:'TAKE', actor: player, params: { row: rows[0] }, context: { broadcast } });
}

async function cmdDrop(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Drop what?' };
  const { rows } = await query(`SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 AND NOT jsonb_exists(i.tags,'quest_item') LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`You don't have "${targetStr}".` };
  return dispatchAction({ type:'DROP', actor: player, params: { row: rows[0] }, context: { broadcast } });
}

async function cmdDropById(inventoryId, player, broadcast, qty) {
  if (!inventoryId) return { type:'error', message:'Nothing to drop.' };
  const { rows } = await query(`SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1 AND pi.player_id=$2 AND NOT jsonb_exists(i.tags,'quest_item') LIMIT 1`, [inventoryId, player.id]);
  if (!rows.length) return { type:'error', message:`Can't drop that.` };
  return dispatchAction({ type:'DROP', actor: player, params: { row: rows[0], qty }, context: { broadcast } });
}

async function cmdGive(argStr, player, broadcast) {
  const [itemPart, who] = splitOn(argStr, ' to ');
  if (!itemPart || !who) return { type:'error', message:'Usage: give <item> to <player>.' };
  const target = getZonePlayers(player.current_zone).find(p => p.id !== player.id && p.handle.toLowerCase().includes(who.toLowerCase()));
  if (!target) return { type:'error', message:`There's no "${who}" here to give to.` };
  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND pi.is_equipped=0 AND i.name ILIKE $2 AND NOT jsonb_exists(i.tags,'quest_item') LIMIT 1`, [player.id, `%${itemPart}%`]);
  if (!rows.length) return { type:'error', message:`You don't have "${itemPart}".` };
  return dispatchAction({ type:'GIVE', actor: player, params: { row: rows[0], toPlayer: target }, context: { broadcast } });
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
  if (t.restore_hunger) {
    player.hunger = Math.min(100, player.hunger+t.restore_hunger);
    messages.push(`+${t.restore_hunger} Hunger.`);
    player.digestive_load = Math.min(120, (player.digestive_load || 0) + foodLoad(t.restore_hunger));
  }
  if (t.restore_thirst) {
    player.thirst = Math.min(100, player.thirst+t.restore_thirst);
    messages.push(`+${t.restore_thirst} Thirst.`);
    player.hydration_load = Math.min(120, (player.hydration_load || 0) + drinkLoad(t.restore_thirst));
  }
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
  await query('UPDATE players SET hp=$1,hunger=$2,thirst=$3,radiation=$4,sanity=$5,credits=$6,digestive_load=$7,hydration_load=$8 WHERE id=$9',
    [player.hp,player.hunger,player.thirst,player.radiation,player.sanity,player.credits,player.digestive_load||0,player.hydration_load||0,player.id]);
  if (item.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [item.id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
  return { type:'use', message:messages.join('\n'), player_update:{hp:player.hp,hunger:player.hunger,thirst:player.thirst,radiation:player.radiation,sanity:player.sanity,credits:player.credits} };
}

function resolveEquipLayer(item, requestedLayer) {
  return (requestedLayer && Number.isInteger(requestedLayer) && requestedLayer >= 1 && requestedLayer <= 5)
    ? requestedLayer
    : (tagValue(item, 'layer') || 1);
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
  const layer = resolveEquipLayer(item);
  return dispatchAction({ type:'EQUIP', actor: player, params: { row: item, slot, layer } });
}

async function cmdUnequip(targetStr, player) {
  if (!targetStr) return { type:'error', message:'Unequip what?' };
  const { rows } = await query(`SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1 AND i.name ILIKE $2 LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`You don't have "${targetStr}" equipped.` };
  return dispatchAction({ type:'UNEQUIP', actor: player, params: { row: rows[0] } });
}

async function cmdEquipById(inventoryId, player, requestedLayer) {
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
  const layer = resolveEquipLayer(item, requestedLayer);
  return dispatchAction({ type:'EQUIP', actor: player, params: { row: item, slot, layer } });
}

async function cmdUnequipById(inventoryId, player) {
  if (!inventoryId) return { type:'error', message:'Nothing selected to unequip.' };
  const { rows } = await query(`SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1 AND pi.player_id=$2 AND pi.is_equipped=1 LIMIT 1`, [inventoryId, player.id]);
  if (!rows.length) return { type:'error', message:`That isn't equipped.` };
  return dispatchAction({ type:'UNEQUIP', actor: player, params: { row: rows[0] } });
}

// Find a container the player can reach: their inventory first, then the ground.
async function resolveContainer(nameStr, player) {
  if (nameStr) {
    const { rows } = await query(
      `SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id
       WHERE pi.player_id IN ($1,$2) AND pi.container_id IS NULL
       AND jsonb_exists(i.tags,'container') AND i.name ILIKE $3
       ORDER BY (pi.player_id=$1) DESC LIMIT 1`,
      [player.id, `_ground_${player.current_zone}`, `%${nameStr}%`]
    );
    return rows[0] || null;
  }
  // No name given — default only if exactly one container is reachable.
  const { rows } = await query(
    `SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id
     WHERE pi.player_id IN ($1,$2) AND pi.container_id IS NULL AND jsonb_exists(i.tags,'container')`,
    [player.id, `_ground_${player.current_zone}`]
  );
  return rows.length === 1 ? rows[0] : (rows.length === 0 ? null : 'ambiguous');
}

async function cmdLookInContainer(nameStr, player) {
  const container = await resolveContainer(nameStr, player);
  if (container === 'ambiguous') return { type:'error', message:`Which container? Try "look in <name>".` };
  if (!container) return { type:'error', message:`You don't see a container${nameStr?` matching "${nameStr}"`:''} here.` };
  return { type:'examine', message: await describeContainer(container) };
}

async function describeContainer(container) {
  const cap = tagValue(container, 'container', 0);
  const { rows } = await query(`SELECT pi.quantity,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.container_id=$1 ORDER BY i.name`, [container.id]);
  const used = await containerContentsWeight(container.id);
  let msg = `${container.name} (Capacity: ${round1(used)}/${cap})`;
  if (!rows.length) { msg += `\n  It's empty.`; return msg; }
  for (const r of rows) msg += `\n  ${r.name}${r.quantity>1?` x${r.quantity}`:''}`;
  return msg;
}

async function buildContainerView(containerId, player) {
  const { rows: cRows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1`, [containerId]);
  if (!cRows.length) return { type:'error', message:'Container not found.' };
  const container = cRows[0];
  const cap = tagValue(container, 'container', 0);
  const used = await containerContentsWeight(container.id);
  const { rows: invItems } = await query(`SELECT pi.*,i.name,i.rarity,i.tags,i.weight FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND pi.is_equipped=0 ORDER BY i.name`, [player.id]);
  const { rows: containerItems } = await query(`SELECT pi.*,i.name,i.rarity,i.tags,i.weight FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.container_id=$1 ORDER BY i.name`, [container.id]);
  return { type:'container_view', containerId: container.id, containerName: container.name, capacity: cap, usedWeight: round1(used), invItems, containerItems };
}

async function cmdOpenContainer(nameStr, player) {
  if (!nameStr) return null;
  const container = await resolveContainer(nameStr, player);
  if (!container || container === 'ambiguous') return null;
  return buildContainerView(container.id, player);
}

async function cmdOpenContainerById(idStr, player) {
  const id = parseInt(idStr, 10);
  if (!id) return { type:'error', message:'Invalid container id.' };
  return buildContainerView(id, player);
}

async function cmdStowById(argStr, player) {
  const [invRowId, containerRowId] = argStr.trim().split(/\s+/);
  const { rows: itemRows } = await query(`SELECT pi.*,i.name,i.tags,i.weight FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1 AND pi.player_id=$2 AND pi.container_id IS NULL AND NOT jsonb_exists(i.tags,'quest_item')`, [invRowId, player.id]);
  if (!itemRows.length) return { type:'error', message:'Item not found in your inventory.' };
  const item = itemRows[0];

  const { rows: cRows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1 AND pi.player_id IN ($2,$3) AND pi.container_id IS NULL AND jsonb_exists(i.tags,'container')`, [containerRowId, player.id, `_ground_${player.current_zone}`]);
  if (!cRows.length) return { type:'error', message:'Container not found.' };
  const container = cRows[0];
  if (item.id === container.id) return { type:'error', message:`Can't put ${container.name} inside itself.` };
  if (hasTag(item, 'container')) return { type:'error', message:`Can't stow a container inside another container.` };

  const cap = tagValue(container, 'container', 0);
  const used = await containerContentsWeight(container.id);
  const adding = (item.weight || 0) * item.quantity;
  if (used + adding > cap) return { type:'error', message:`${container.name} is full (${round1(used)}/${cap}).` };

  if (hasTag(item, 'stackable')) {
    const { rows: existing } = await query('SELECT id FROM player_inventory WHERE container_id=$1 AND item_id=$2 LIMIT 1', [container.id, item.item_id]);
    if (existing.length) {
      await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [item.quantity, existing[0].id]);
      await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
      return buildContainerView(container.id, player);
    }
  }
  await query('UPDATE player_inventory SET container_id=$1, is_equipped=0, slot=NULL WHERE id=$2', [container.id, item.id]);
  return buildContainerView(container.id, player);
}

async function cmdPullById(idStr, player) {
  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1 AND pi.container_id IS NOT NULL`, [idStr]);
  if (!rows.length) return { type:'error', message:'Item not found.' };
  const item = rows[0];
  const containerId = item.container_id;

  const { rows: cRows } = await query(`SELECT player_id FROM player_inventory WHERE id=$1`, [containerId]);
  if (!cRows.length) return { type:'error', message:'Container not found.' };
  if (cRows[0].player_id !== player.id && cRows[0].player_id !== `_ground_${player.current_zone}`) return { type:'error', message:'Not your container.' };

  if (hasTag(item, 'stackable')) {
    const { rows: existing } = await query('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL AND is_equipped=0 LIMIT 1', [player.id, item.item_id]);
    if (existing.length) {
      await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [item.quantity, existing[0].id]);
      await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
      return buildContainerView(containerId, player);
    }
  }
  await query('UPDATE player_inventory SET container_id=NULL, player_id=$1 WHERE id=$2', [player.id, item.id]);
  return buildContainerView(containerId, player);
}

async function cmdStow(argStr, player) {
  if (!argStr) return { type:'error', message:'Stow what?' };
  const [itemPart, containerPart] = splitOn(argStr, ' in ');
  if (!itemPart) return { type:'error', message:'Stow what?' };

  // Check for trash bin furniture before normal container resolution.
  if (containerPart) {
    const { rows: trashRows } = await query(
      `SELECT id,name FROM furniture WHERE zone_id=$1 AND name ILIKE $2 AND flags->>'trash_bin'='true' LIMIT 1`,
      [player.current_zone, `%${containerPart}%`]
    );
    if (trashRows.length) {
      const { rows: itemRows } = await query(`SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND i.name ILIKE $2 AND NOT jsonb_exists(i.tags,'quest_item') LIMIT 1`, [player.id, `%${itemPart}%`]);
      if (!itemRows.length) return { type:'error', message:`You don't have "${itemPart}".` };
      await query('DELETE FROM player_inventory WHERE id=$1', [itemRows[0].id]);
      return { type:'stow', message:`You throw ${itemRows[0].name} in the ${trashRows[0].name}. It's gone.` };
    }
  }

  const container = await resolveContainer(containerPart, player);
  if (container === 'ambiguous') return { type:'error', message:`Which container? Try "stow <item> in <name>".` };
  if (!container) return { type:'error', message:`You don't see a container${containerPart?` matching "${containerPart}"`:''} here.` };

  const { rows } = await query(`SELECT pi.*,i.name,i.tags,i.weight FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND i.name ILIKE $2 AND NOT jsonb_exists(i.tags,'quest_item') LIMIT 1`, [player.id, `%${itemPart}%`]);
  if (!rows.length) return { type:'error', message:`You don't have "${itemPart}" to stow.` };
  const item = rows[0];
  if (item.id === container.id) return { type:'error', message:`You can't put ${container.name} inside itself.` };
  if (hasTag(item, 'container')) return { type:'error', message:`You can't stow a container inside another container.` };

  const cap = tagValue(container, 'container', 0);
  const used = await containerContentsWeight(container.id);
  const adding = (item.weight || 0) * item.quantity;
  if (used + adding > cap) return { type:'error', message:`${container.name} can't hold that — ${round1(used)}/${cap} used, ${item.name} weighs ${round1(adding)}.` };

  if (hasTag(item, 'stackable')) {
    const { rows: existing } = await query('SELECT id FROM player_inventory WHERE container_id=$1 AND item_id=$2 LIMIT 1', [container.id, item.item_id]);
    if (existing.length) {
      await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [item.quantity, existing[0].id]);
      await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
      return { type:'stow', message:`You stow ${item.name} in ${container.name}.` };
    }
  }
  await query('UPDATE player_inventory SET container_id=$1, is_equipped=0, slot=NULL WHERE id=$2', [container.id, item.id]);
  return { type:'stow', message:`You stow ${item.name} in ${container.name}.` };
}

async function cmdPull(argStr, player) {
  if (!argStr) return { type:'error', message:'Pull what?' };
  const [itemPart, containerPart] = splitOn(argStr, ' from ');
  if (!itemPart) return { type:'error', message:'Pull what?' };
  const container = await resolveContainer(containerPart, player);
  if (container === 'ambiguous') return { type:'error', message:`Which container? Try "pull <item> from <name>".` };
  if (!container) return { type:'error', message:`You don't see a container${containerPart?` matching "${containerPart}"`:''} here.` };

  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.container_id=$1 AND i.name ILIKE $2 LIMIT 1`, [container.id, `%${itemPart}%`]);
  if (!rows.length) return { type:'error', message:`There's no "${itemPart}" in ${container.name}.` };
  const item = rows[0];

  if (hasTag(item, 'stackable')) {
    const { rows: existing } = await query('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL AND is_equipped=0 LIMIT 1', [player.id, item.item_id]);
    if (existing.length) {
      await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [item.quantity, existing[0].id]);
      await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
      return { type:'pull', message:`You pull ${item.name} from ${container.name}.` };
    }
  }
  await query('UPDATE player_inventory SET container_id=NULL, player_id=$1 WHERE id=$2', [player.id, item.id]);
  return { type:'pull', message:`You pull ${item.name} from ${container.name}.` };
}

// Split a string on the first occurrence of sep; returns [before, after].
function splitOn(str, sep) {
  const idx = str.toLowerCase().indexOf(sep);
  if (idx === -1) return [str.trim(), ''];
  return [str.slice(0, idx).trim(), str.slice(idx + sep.length).trim()];
}

export const handlers = {
  inventory: (args, raw, player) => cmdInventory(player),
  inv: (args, raw, player) => cmdInventory(player),
  i: (args, raw, player) => cmdInventory(player),
  take: (args, raw, player, broadcast) => cmdTake(args.join(' '), player, broadcast),
  get:  (args, raw, player, broadcast) => cmdTake(args.join(' '), player, broadcast),
  drop: (args, raw, player, broadcast) => cmdDrop(args.join(' '), player, broadcast),
  dropid: (args, raw, player, broadcast) => cmdDropById(args[0], player, broadcast, parseInt(args[1]) || 0),
  give: (args, raw, player, broadcast) => cmdGive(args.join(' '), player, broadcast),
  use:   (args, raw, player) => cmdUse(args.join(' '), player),
  eat:   (args, raw, player) => cmdUse(args.join(' '), player),
  drink: (args, raw, player) => cmdUse(args.join(' '), player),
  equip:    (args, raw, player) => cmdEquip(args.join(' '), player),
  wear:     (args, raw, player) => cmdEquip(args.join(' '), player),
  unequip:  (args, raw, player) => cmdUnequip(args.join(' '), player),
  remove:   (args, raw, player) => cmdUnequip(args.join(' '), player),
  equipid:   (args, raw, player) => cmdEquipById(args[0], player, parseInt(args[1]) || null),
  unequipid: (args, raw, player) => cmdUnequipById(args[0], player),
  stow:  (args, raw, player) => cmdStow(args.join(' '), player),
  put:   (args, raw, player) => cmdStow(args.join(' '), player),
  throw: (args, raw, player) => cmdStow(args.join(' '), player),
  pull:  (args, raw, player) => cmdPull(args.join(' '), player),
  stowid: (args, raw, player) => cmdStowById(args.join(' '), player),
  pullid: (args, raw, player) => cmdPullById(args[0], player),
  opencontainer: (args, raw, player) => cmdOpenContainerById(args[0], player),
};

export { cmdLookInContainer, describeContainer, cmdOpenContainer, cmdUse };
