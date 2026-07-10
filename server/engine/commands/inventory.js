import { randomUUID } from 'crypto';
import { query, withTransaction } from '../../models/db.js';
import { useDrug } from '../drugs.js';
import { hasTag, tagValue, hasFlag, isStackable, TAG_CATALOG } from '../tags.js';
import { foodLoad, applyThirst } from '../bodily.js';
import { dispatchAction, getRegisteredActions } from '../actions.js';
import { burnCharge } from '../inventory.js';
import { getZonePlayers, getZoneNpcs } from '../world.js';
import { emit } from '../events.js';
import { resolve as siftResolve, matchAll as siftMatchAll, createSelectionState, formatSelectionPage } from '../sift.js';
import { fireSpecializedAction, availableActions } from '../specializedActions.js';
import { computeSellUnitPrice } from '../vendor.js';
import { resolveCorpseOrPlayer, buildLootView } from './combat.js';
import { titleCaseName } from '../text.js';

// Throttle: only broadcast "rummages in container" once per 30s per player.
const _ctrBroadcastTs = new Map();
// Returns true if the broadcast (and actor echo) should fire this call.
function throttledContainerBroadcast(player, broadcast, containerName) {
  const now = Date.now();
  if ((now - (_ctrBroadcastTs.get(player.id) || 0)) < 30000) return false;
  _ctrBroadcastTs.set(player.id, now);
  broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} rummages through ${withArticle(containerName)}.` }, player.id);
  return true;
}

const INSTANCE_FLAGS = Object.keys(TAG_CATALOG).filter(n => TAG_CATALOG[n].scope === 'instance');

export const EQUIP_SLOTS = {
  head: 'Head', torso: 'Torso', hands: 'Hands', legs: 'Legs', feet: 'Feet',
  weapon_hand: 'Weapon Hand', accessory: 'Accessory',
};

// The five body slots wear up to three stacked layers, one item per (slot, layer).
export const BODY_SLOTS = ['head', 'torso', 'hands', 'legs', 'feet'];
// Layer name <-> stored integer. Higher = more outward = what others see.
export const LAYERS = { underwear: 1, outerwear: 2, armor: 3 };
export const LAYER_NAMES = { 1: 'underwear', 2: 'outerwear', 3: 'armor' };
// Accessories: no layers, a fixed number of slots (index kept in `layer`).
export const ACCESSORY_MAX = 3;

// The layer an equipped body-slot item sits on, from its `layer` tag. Weapon and
// accessory slots ignore this. Defaults to outerwear when a piece has no tag.
function bodyLayer(item) {
  return LAYERS[tagValue(item, 'layer')] || LAYERS.outerwear;
}

// Room-facing verb for the equip broadcast, by slot.
const EQUIP_VERBS = {
  head: 'puts on', torso: 'pulls on', hands: 'pulls on', legs: 'pulls on',
  feet: 'pulls on', weapon_hand: 'readies', accessory: 'puts on',
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
    // A `covers` garment (e.g. a jumpsuit) protects every slot it fills.
    const covers = tagValue(r, 'covers');
    const slots = Array.isArray(covers) ? [slot, ...covers] : [slot];
    const sm = tagValue(r, 'armor_soak');
    const flat = tagValue(r, 'armor', 0) || 0;
    for (const s of slots) {
      const entry = bySlot[s] || (bySlot[s] = { soak: {}, flat: 0 });
      if (sm && typeof sm === 'object') {
        for (const [type, val] of Object.entries(sm)) entry.soak[type] = (entry.soak[type] || 0) + (Number(val) || 0);
      }
      entry.flat += flat;
    }
  }
  player.soak = bySlot;
}

export async function recomputeInsulation(player) {
  const { rows } = await query(`SELECT i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1`, [player.id]);
  let total = 0;
  let sealed = false;
  const covered = new Set();
  for (const r of rows) {
    total += tagValue(r, 'insulation', 0) || 0;
    if (hasTag(r, 'sealed')) sealed = true;   // respirator/mask — blocks ash choking
    const slot = tagValue(r, 'slot');
    if (slot) covered.add(slot);
    // A `covers` garment (e.g. a jumpsuit) counts its extra slots as clothed too.
    const covers = tagValue(r, 'covers');
    if (Array.isArray(covers)) for (const c of covers) covered.add(c);
  }
  player.insulation = total;
  // Whether any equipped item seals the airway (gas mask / respirator). Read by the
  // ashfall breathing hazard in gameLoop's resourceTick. See systems-weather-extreme.md.
  player.sealed = sealed;
  // Bare core skin sheds heat fast, so nakedness makes the cold genuinely bite.
  // Torso dominates (the body defends the core hardest); legs are secondary.
  // Applied only to the cooling side of the body-temp tick (see gameLoop.js) —
  // going shirtless in the heat is a relief, not a penalty.
  player.exposurePenalty = (covered.has('torso') ? 0 : 10) + (covered.has('legs') ? 0 : 5);
}

async function cmdInventory(player) {
  const { rows } = await query(`SELECT pi.*,i.name,i.tags,i.weight,i.value FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL ORDER BY i.name`, [player.id]);
  if (!rows.length) return { type:'inventory', message:'Your inventory is empty.', items:[] };
  for (const r of rows) r.name = titleCaseName(r.name); // list display — Title Case
  let msg = '<span class="inv-header">INVENTORY</span>\n';
  for (const item of rows) {
    const eq = item.is_equipped ? ' <span class="equipped">[equipped]</span>' : '';
    const instFlags = INSTANCE_FLAGS.filter(n => hasFlag(item, n)).map(n => ` [${n}]`).join('');
    let container = '';
    if (hasTag(item, 'container')) {
      const used = await containerContentsWeight(item.id);
      container = ` <span class="equipped">[${formatWeight(used)}/${formatWeight(tagValue(item, 'container', 0))}]</span>`;
    }
    msg += `  ${item.name}${item.quantity>1?` x${item.quantity}`:''}${instFlags}${container}${eq}\n`;
    // Derived fields for the client item-detail panel (see equipment.js showItemDetail).
    item.sell_value = computeSellUnitPrice(item.value, player.stat_cool);
    item.actions = availableActions(item);
  }
  const weight = await computeCarriedWeight(player);
  const cap = carryCapacity(player);
  msg += `\nWeight: ${formatWeight(weight)}/${formatWeight(cap)}`;
  msg += `\nCredits: ${player.credits||0}`;
  return { type:'inventory', message:msg, items:rows, weight, capacity:cap };
}

// The gear screen: the equippable subset of inventory (anything with a `slot` tag)
// plus derived per-region soak and the summed passive effects, so the client can
// render the layered layout, soak table, and effects block without re-deriving.
async function cmdGear(player) {
  const { rows } = await query(
    `SELECT pi.*,i.name,i.tags,i.weight,i.value FROM player_inventory pi JOIN items i ON i.id=pi.item_id
     WHERE pi.player_id=$1 AND pi.container_id IS NULL AND jsonb_exists(i.tags,'slot') ORDER BY i.name`,
    [player.id]
  );
  await recomputeArmor(player);
  await recomputeInsulation(player);
  const effects = {
    insulation: player.insulation || 0,
    sealed: !!player.sealed,
    exposurePenalty: player.exposurePenalty || 0,
    stat_bonus: {},
  };
  for (const item of rows) {
    item.sell_value = computeSellUnitPrice(item.value, player.stat_cool);
    item.actions = availableActions(item);
    if (item.is_equipped) {
      const sb = tagValue(item, 'stat_bonus');
      if (sb && typeof sb === 'object') for (const [k,v] of Object.entries(sb)) effects.stat_bonus[k] = (effects.stat_bonus[k]||0) + (Number(v)||0);
    }
  }
  const weight = await computeCarriedWeight(player);
  return { type:'gear', items:rows, soak:player.soak||{}, effects, weight, capacity:carryCapacity(player), credits:player.credits||0 };
}

function round1(n) { return Math.round(n * 10) / 10; }

// Format a weight given in grams: "750g" below 1000g, "1.5kg" at/above (trailing .0 trimmed).
export function formatWeight(g) {
  g = Number(g) || 0;
  if (g < 1000) return `${Math.round(g)}g`;
  return `${(Math.round(g / 100) / 10).toString()}kg`;
}

// Prepend "a"/"an" to a name, preserving its original casing. Skips the article
// when the name reads as plural (ends in s, but not ss).
function withArticle(name) {
  const lastWord = name.trim().split(/\s+/).pop();
  if (/s$/i.test(lastWord) && !/ss$/i.test(lastWord)) return name;
  return (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name;
}

// Sum of weight*quantity for everything inside a given container row.
async function containerContentsWeight(containerRowId) {
  const { rows } = await query(`SELECT COALESCE(SUM(i.weight*pi.quantity),0) AS w FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.container_id=$1`, [containerRowId]);
  return Number(rows[0].w) || 0;
}

// Carry capacity in grams: 14kg base + 1kg per brawn point.
export function carryCapacity(player) {
  return 14000 + (Number(player?.stat_brawn) || 0) * 1000;
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

  const { rows } = await query(
    `SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL`,
    [`_ground_${player.current_zone}`]
  );
  if (!rows.length) return { type:'error', message:`Nothing here to take.` };
  const sift = siftResolve(targetStr, rows, { verb: 'take' });
  if (sift.type === 'none') return { type:'error', message:`Can't find "${targetStr}" here.` };
  if (sift.type === 'ambiguous') {
    createSelectionState(player.id, sift.candidates, { verb: 'take', dispatchType: 'TAKE', dispatchParam: 'row' });
    return { type:'output', message: formatSelectionPage({ allCandidates: sift.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  return dispatchAction({ type:'TAKE', actor: player, params: { row: sift.candidate }, context: { broadcast } });
}

async function cmdDrop(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Drop what?' };
  const lower = targetStr.trim().toLowerCase();
  // Pool includes equipped gear (no is_equipped filter) so "drop all" can shed it.
  const { rows } = await query(
    `SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND NOT jsonb_exists(i.tags,'quest_item')`,
    [player.id]
  );
  if (!rows.length) return { type:'error', message:`You don't have anything to drop.` };

  // "drop all" — sheds everything you're carrying, equipped items included. Gated
  // behind an in-browser confirmation; the client echoes back "drop __allconfirm".
  if (lower === 'all') {
    return {
      type: 'confirm',
      prompt: `Drop all ${rows.length} item${rows.length === 1 ? '' : 's'} you're carrying, including everything you have equipped?`,
      confirmLabel: 'Drop Everything',
      command: 'drop __allconfirm',
    };
  }
  if (lower === '__allconfirm') return dropRows(rows, player, broadcast);

  // "drop all <filter>" — drop every SIFT match, no prompt.
  if (lower.startsWith('all ')) {
    const filter = targetStr.trim().slice(4).trim();
    const matches = siftMatchAll(filter, rows);
    if (!matches.length) return { type:'error', message:`You don't have any "${filter}" to drop.` };
    return dropRows(matches, player, broadcast);
  }

  const sift = siftResolve(targetStr, rows, { verb: 'drop' });
  if (sift.type === 'none') return { type:'error', message:`You don't have "${targetStr}".` };
  if (sift.type === 'ambiguous') {
    createSelectionState(player.id, sift.candidates, { verb: 'drop', dispatchType: 'DROP', dispatchParam: 'row' });
    return { type:'output', message: formatSelectionPage({ allCandidates: sift.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  return dispatchAction({ type:'DROP', actor: player, params: { row: sift.candidate }, context: { broadcast } });
}

// Drop a set of inventory rows, one DROP action each, joining the player-facing
// lines. Recomputes armor/insulation if any dropped item was equipped so soak
// doesn't linger after the gear hits the ground.
async function dropRows(rows, player, broadcast) {
  const messages = [];
  let hadEquipped = false;
  for (const row of rows) {
    if (row.is_equipped) hadEquipped = true;
    const r = await dispatchAction({ type:'DROP', actor: player, params: { row }, context: { broadcast } });
    messages.push(r.message);
  }
  if (hadEquipped) {
    await recomputeArmor(player);
    await recomputeInsulation(player);
  }
  return { type:'drop', message: messages.join('\n') };
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
  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND pi.is_equipped=0 AND i.name ILIKE $2 AND NOT jsonb_exists(i.tags,'quest_item') LIMIT 1`, [player.id, `%${itemPart}%`]);

  // Prefer a player recipient standing in the room…
  const givePool = getZonePlayers(player.current_zone).filter(p => p.id !== player.id).map(p => ({ ...p, name: p.handle }));
  const gr = siftResolve(who, givePool);
  if (gr.type === 'ambiguous') return { type:'error', message:`Multiple people match "${who}" — be more specific.` };
  if (gr.type !== 'none') {
    if (!rows.length) return { type:'error', message:`You don't have "${itemPart}".` };
    return dispatchAction({ type:'GIVE', actor: player, params: { row: rows[0], toPlayer: gr.candidate }, context: { broadcast } });
  }

  // …otherwise it may be an NPC. Giving to an NPC fires the npc.gift event;
  // interested plugins own the reaction and any item transfer. An unclaimed gift
  // just acknowledges the offer and leaves the item with the giver.
  const nr = siftResolve(who, getZoneNpcs(player.current_zone));
  if (nr.type === 'ambiguous') return { type:'error', message:`Multiple people match "${who}" — be more specific.` };
  if (nr.type !== 'none') {
    if (!rows.length) return { type:'error', message:`You don't have "${itemPart}".` };
    emit('npc.gift', { actor: player, npc: nr.candidate, item: rows[0], broadcast });
    return { type:'give', message:`You offer ${rows[0].name} to ${nr.candidate.name}.` };
  }

  return { type:'error', message:`There's no "${who}" here to give to.` };
}

// Flag → native verb for furniture types with dedicated handlers.
const FURNITURE_NATIVE_VERB = { atm: 'atm', tv: 'tv', water_source: 'drink' };

async function cmdUseFurniture(targetStr, player, broadcast) {
  const { rows } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND name ILIKE $2 LIMIT 1`,
    [player.current_zone, `%${targetStr}%`]
  );
  if (!rows.length) return { type:'error', message:`No usable item "${targetStr}" found.` };
  const f = rows[0];
  const flags = f.flags || {};

  // Delegate to the native verb for this furniture type so the plugin handler runs.
  for (const [flag, verb] of Object.entries(FURNITURE_NATIVE_VERB)) {
    if (flags[flag]) {
      const result = await fireSpecializedAction(verb, [f.name], `${verb} ${f.name}`, player, broadcast);
      if (result !== undefined) return result;
    }
  }

  // Cosmetic machines open via the plugin-registered Action (no import coupling).
  if (f.object_type === 'cosmetic_machine') {
    return dispatchAction({ type: 'cosmetic.open', actor: player, params: {}, context: { broadcast } });
  }

  return { type:'error', message:`You can't use ${f.name} like that.` };
}

const parseCustomData = (v) => typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return {}; } })() : (v || {});

// Build the useDrug opts for a resolved drug row: synthesized drugs carry a
// potency multiplier baked into the inventory row; spliced compounds also carry
// their whole composed effects blob inline.
function buildDrugOpts(cd, item) {
  const opts = { potencyMult: Number(cd?.potency) || 1 };
  if (cd && cd.effects) {
    opts.inlineEffects = cd.effects;
    opts.displayName = cd.name || item.name;
    opts.overdoseThreshold = cd.overdose_threshold;
    opts.durationSeconds = cd.duration_seconds;
    opts.doseWeight = cd.dose_weight;
  }
  return opts;
}

// Run the drug effect and consume the item as one step: apply useDrug, burn a
// pack charge (or decrement/delete the stack), and handle lethal overdose. Split
// out of cmdUse so the consume plugin can call it when a timed consumption
// finishes (effect lands at the end). `extraOpts` (takeLine, suppressComeupMessage)
// merges into the useDrug opts. Returns a { type:'use', message, player_update }.
export async function applyDrugUse(player, item, cd, opts, broadcast) {
  const result = await useDrug(player, item.drug_id, broadcast, opts);
  if (!result.success) return { type:'error', message: result.message };
  // A charged pack (item tag `pack_size` > 1, e.g. cigarettes) burns one dose
  // per use and is only destroyed once the last one is gone (burnCharge owns the
  // charge bookkeeping). Everything else keeps the one-item-per-dose behaviour.
  const itemTags = typeof item.tags === 'string' ? (() => { try { return JSON.parse(item.tags); } catch { return {}; } })() : (item.tags || {});
  const burn = result.overdose_death ? { charged: false } : await burnCharge(item, itemTags);
  if (burn.charged) {
    // A loose single (custom_data.loose — a hand-rolled or bummed cigarette) was
    // never a pack, so it gets its own end line and never "N left in the pack".
    if (cd.loose || burn.loose) {
      if (burn.destroyed) result.message += `\n<span class="msg-system">You take the last drag and grind out the butt.</span>`;
    }
    else if (burn.destroyed) result.message += `\n<span class="msg-system">That was the last one. You crush the empty pack and toss it.</span>`;
    else if (burn.opened)    result.message += `\n<span class="msg-system">That was the last one. You crush the empty pack and crack open a fresh one.</span>`;
    else                     result.message += `\n<span class="msg-system">${burn.remaining} left in the pack.</span>`;
  } else if (item.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [item.id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
  if (result.overdose_death) {
    // Lethal overdose: show the take message, then run the full death path.
    broadcast(null, { type: 'output', message: result.message }, null, player.id);
    const { handlePlayerDeath } = await import('../gameLoop.js');
    await handlePlayerDeath(player, null, { type: 'drug', label: 'Overdose' });
    return { type: 'use', message: '' };
  }
  return { type:'use', message: result.message, player_update: result.player_update };
}

// Re-resolve a drug inventory row by id and consume it now. Used by the consume
// plugin when a timed consumption's timer fires — re-queried fresh so a row that
// was dropped/traded during the ~15s consumption doesn't get applied off a stale
// snapshot. Returns null if the row is gone. `extraOpts` = { takeLine, suppressComeupMessage }.
export async function finishConsume(player, itemRowId, broadcast, extraOpts = {}) {
  const { rows } = await query(
    `SELECT pi.*, i.name, i.tags, d.id as drug_id FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     JOIN drugs d ON d.item_id = i.id
     WHERE pi.id=$1 AND pi.player_id=$2 LIMIT 1`,
    [itemRowId, player.id]
  );
  if (!rows.length) return null;
  const item = rows[0];
  const cd = parseCustomData(item.custom_data);
  const opts = { ...buildDrugOpts(cd, item), ...extraOpts };
  return applyDrugUse(player, item, cd, opts, broadcast);
}

async function cmdUse(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Use what?' };

  const { rows: drugRows } = await query(
    `SELECT pi.*, i.name, i.tags, d.id as drug_id FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     JOIN drugs d ON d.item_id = i.id
     WHERE pi.player_id=$1 AND (i.name ILIKE $2 OR pi.custom_data->>'name' ILIKE $2) LIMIT 1`,
    [player.id, `%${targetStr}%`]
  );
  if (drugRows.length) {
    const item = drugRows[0];
    const cd = parseCustomData(item.custom_data);
    // Sealed in a climate crate — frozen and search-proof until you break the seal.
    if (cd && cd.packaged) return { type: 'error', message: `That's sealed in a climate crate. <span class="text-dim">unseal</span> it first.` };
    const opts = buildDrugOpts(cd, item);
    // Timed consumption: beer/cigarettes/joints are consumed over several seconds
    // with the effect landing at the end. The consume plugin owns the sequencing —
    // it decides by drug category whether to defer, returning a "You crack it open…"
    // start message, or a { passthrough:true } sentinel to consume instantly here.
    // Inline-splice compounds (cd.effects) are always instant.
    if (!cd?.effects && getRegisteredActions().includes('consume.begin')) {
      const r = await dispatchAction({ type: 'consume.begin', actor: player, params: { item, cd, opts }, context: { broadcast } });
      if (r && !r.passthrough) return r;
    }
    return applyDrugUse(player, item, cd, opts, broadcast);
  }

  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 AND jsonb_exists(i.tags,'consumable') LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (!rows.length) return cmdUseFurniture(targetStr, player, broadcast);
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
    applyThirst(player, t.restore_thirst);
    messages.push(`+${t.restore_thirst} Thirst.`);
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
  // Apply the item's effects and consume it as one atomic unit, so a failure
  // between the two can't grant the effect (incl. credits) without spending the item.
  await withTransaction(async (q) => {
    await q('UPDATE players SET hp=$1,hunger=$2,thirst=$3,radiation=$4,sanity=$5,credits=$6,digestive_load=$7,hydration_load=$8 WHERE id=$9',
      [player.hp,player.hunger,player.thirst,player.radiation,player.sanity,player.credits,player.digestive_load||0,player.hydration_load||0,player.id]);
    if (item.quantity > 1) await q('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [item.id]);
    else await q('DELETE FROM player_inventory WHERE id=$1', [item.id]);
  });

  // Laced consumable: a drink or food that carries a drug (`tags.laced_drug`,
  // optional `tags.laced_potency`). The item's own restores are already applied
  // above; the drug adds its systemic effects (intox meter, phases, overdose) via
  // useDrug with skipInstant, so its resource block doesn't double the restores.
  // This is the general "drugged drink/food" path — alcohol is just its first user.
  if (t.laced_drug) {
    const laced = await useDrug(player, t.laced_drug, broadcast, { potencyMult: Number(t.laced_potency) || 1, skipInstant: true, takeLine: '' });
    if (laced?.overdose_death) {
      broadcast(null, { type: 'output', message: messages.join('\n') }, null, player.id);
      const { handlePlayerDeath } = await import('../gameLoop.js');
      await handlePlayerDeath(player, null, { type: 'drug', label: 'Overdose' });
      return { type: 'use', message: '' };
    }
    if (laced?.message) messages.push(laced.message);
  }

  return { type:'use', message:messages.join('\n'), player_update:{hp:player.hp,hunger:player.hunger,thirst:player.thirst,radiation:player.radiation,sanity:player.sanity,credits:player.credits} };
}

// Equip/unequip changes the worn set, so refresh derived armor + insulation
// (the inventory.changed event handler doesn't). Keeps typed soak and the
// nakedness/cold penalty current the moment gear goes on or comes off.
async function dispatchEquip(action, player) {
  const result = await dispatchAction(action);
  await recomputeArmor(player);
  await recomputeInsulation(player);
  return result;
}

// After equipping, is `item` the visible outermost piece in its slot — so the room
// should be told what it is? Weapon/accessory always show; a body-slot piece shows
// only when nothing sits on a higher layer over it.
async function isVisibleEquip(player, slot, layer) {
  if (slot === 'weapon_hand' || slot === 'accessory') return true;
  const { rows } = await query(
    `SELECT MAX(pi.layer) AS m FROM player_inventory pi WHERE pi.player_id=$1 AND pi.is_equipped=1 AND pi.slot=$2`,
    [player.id, slot]
  );
  return (rows[0]?.m ?? layer) <= layer;
}

// Equip an accessory into a free accessory index (kept in `layer`, 1..ACCESSORY_MAX).
// When all indices are full, evict the oldest-equipped accessory and reuse its index.
async function equipAccessory(item, player) {
  const { rows: worn } = await query(
    `SELECT id, layer FROM player_inventory
     WHERE player_id=$1 AND is_equipped=1 AND slot='accessory' AND id<>$2
     ORDER BY equipped_at ASC NULLS FIRST`,
    [player.id, item.id]
  );
  const used = new Set(worn.map(w => w.layer));
  let index = null;
  for (let i = 1; i <= ACCESSORY_MAX; i++) { if (!used.has(i)) { index = i; break; } }
  if (index === null) {
    const oldest = worn[0];   // ordered oldest-first
    await query('UPDATE player_inventory SET is_equipped=0, slot=NULL, layer=NULL, equipped_at=NULL WHERE id=$1', [oldest.id]);
    index = oldest.layer;
  }
  return dispatchEquip({ type:'EQUIP', actor: player, params: { row: item, slot: 'accessory', layer: index } }, player);
}

// Shared equip path: validate stat requirements + slot, route to the right slot
// discipline, then broadcast the piece to the room if it's now visibly outermost.
async function equipResolved(item, player, broadcast) {
  const reqs = tagValue(item, 'requires', {}) || {};
  for (const [stat,val] of Object.entries(reqs)) {
    if ((player[stat]||0) < val) return { type:'error', message:`Need ${stat.replace('stat_','')} ${val} to use this.` };
  }
  const slotName = tagValue(item, 'slot');
  const slot = EQUIP_SLOTS[slotName] ? slotName : null;
  if (!slot) return { type:'error', message:`${item.name} doesn't have a valid equip slot configured.` };

  let result;
  if (slot === 'accessory') {
    result = await equipAccessory(item, player);
  } else {
    const layer = slot === 'weapon_hand' ? 1 : bodyLayer(item);
    result = await dispatchEquip({ type:'EQUIP', actor: player, params: { row: item, slot, layer } }, player);
  }
  if (result?.type === 'equip' && broadcast) {
    const layer = slot === 'weapon_hand' ? 1 : bodyLayer(item);
    if (await isVisibleEquip(player, slot, layer)) {
      broadcast(player.current_zone, { type:'zone_event', message: `${player.handle} ${EQUIP_VERBS[slot] || 'puts on'} ${withArticle(item.name)}.` }, player.id);
    }
  }
  return result;
}

async function cmdEquip(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Equip what?' };
  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 AND jsonb_exists(i.tags,'slot') LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`Can't equip "${targetStr}".` };
  return equipResolved(rows[0], player, broadcast);
}

async function cmdUnequip(targetStr, player) {
  if (!targetStr) return { type:'error', message:'Unequip what?' };
  const { rows } = await query(`SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1 AND i.name ILIKE $2 LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`You don't have "${targetStr}" equipped.` };
  return dispatchEquip({ type:'UNEQUIP', actor: player, params: { row: rows[0] } }, player);
}

async function cmdEquipById(inventoryId, player, broadcast) {
  if (!inventoryId) return { type:'error', message:'Nothing selected to equip.' };
  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1 AND pi.player_id=$2 AND jsonb_exists(i.tags,'slot') LIMIT 1`, [inventoryId, player.id]);
  if (!rows.length) return { type:'error', message:`Can't equip that.` };
  return equipResolved(rows[0], player, broadcast);
}

async function cmdUnequipById(inventoryId, player) {
  if (!inventoryId) return { type:'error', message:'Nothing selected to unequip.' };
  const { rows } = await query(`SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1 AND pi.player_id=$2 AND pi.is_equipped=1 LIMIT 1`, [inventoryId, player.id]);
  if (!rows.length) return { type:'error', message:`That isn't equipped.` };
  return dispatchEquip({ type:'UNEQUIP', actor: player, params: { row: rows[0] } }, player);
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

// Resolve a container by id from either source: an item the player carries / on
// the ground, or a furniture container in the player's current zone. Returns a
// normalized { id, name, tags, kind, isTrash } (tags = item tags or furniture
// flags, so tagValue/hasTag work the same way), or null.
async function loadContainerById(id, player) {
  const { rows } = await query(
    `SELECT pi.id,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id
     WHERE pi.id=$1 AND pi.player_id IN ($2,$3) AND pi.container_id IS NULL AND jsonb_exists(i.tags,'container')`,
    [id, player.id, `_ground_${player.current_zone}`]
  );
  if (rows.length) return { id: rows[0].id, name: rows[0].name, tags: rows[0].tags, kind: 'item', isTrash: false };
  const { rows: fRows } = await query(
    `SELECT id,name,flags FROM furniture WHERE id=$1 AND zone_id=$2 AND object_type='container'`,
    [id, player.current_zone]
  );
  if (fRows.length) return { id: fRows[0].id, name: fRows[0].name, tags: fRows[0].flags, kind: 'furniture', isTrash: fRows[0].flags?.trash_bin === true };
  return null;
}

// Container capacity in grams. Furniture containers default to 60000 (60kg) when unset.
function containerCapacity(container) {
  return tagValue(container, 'container', container.kind === 'furniture' ? 60000 : 0);
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
  let msg = `${container.name} (Capacity: ${formatWeight(used)}/${formatWeight(cap)})`;
  if (!rows.length) { msg += `\n  It's empty.`; return msg; }
  for (const r of rows) msg += `\n  ${r.name}${r.quantity>1?` x${r.quantity}`:''}`;
  return msg;
}

async function buildContainerView(containerId, player) {
  const container = await loadContainerById(containerId, player);
  if (!container) return { type:'error', message:'Container not found.' };
  const cap = containerCapacity(container);
  const used = await containerContentsWeight(container.id);
  const { rows: invItems } = await query(`SELECT pi.*,i.name,i.tags,i.weight FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND pi.is_equipped=0 ORDER BY i.name`, [player.id]);
  const { rows: containerItems } = await query(`SELECT pi.*,i.name,i.tags,i.weight FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.container_id=$1 ORDER BY i.name`, [container.id]);
  for (const r of invItems) r.name = titleCaseName(r.name);       // list display — Title Case
  for (const r of containerItems) r.name = titleCaseName(r.name);
  return { type:'container_view', containerId: container.id, containerName: titleCaseName(container.name), capacity: cap, usedWeight: round1(used), invItems, containerItems };
}

async function cmdOpenContainer(nameStr, player, broadcast) {
  if (!nameStr) return null;
  let container = await resolveContainer(nameStr, player);
  if (container === 'ambiguous') return null;
  if (!container) {
    // No item container matched — try a furniture container in this zone.
    const { rows } = await query(
      `SELECT id FROM furniture WHERE zone_id=$1 AND object_type='container' AND name ILIKE $2 LIMIT 1`,
      [player.current_zone, `%${nameStr}%`]
    );
    if (!rows.length) return null;
    container = { id: rows[0].id };
  }
  const view = await buildContainerView(container.id, player);
  if (view.type === 'container_view') {
    view.mainMsg = `You open ${withArticle(view.containerName)}.`;
    broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} opens ${withArticle(view.containerName)}.` }, player.id);
  }
  return view;
}

async function cmdOpenContainerById(idStr, player) {
  if (!idStr) return { type:'error', message:'Invalid container id.' };
  return buildContainerView(idStr, player);
}

async function cmdCloseContainer(idStr, player, broadcast) {
  if (!idStr) return null;
  const container = await loadContainerById(idStr, player);
  if (!container) return null;
  const name = container.name;
  if (container.kind === 'furniture' && container.isTrash) {
    // Cascade: delete contents of any containers inside the trash bin before deleting the containers themselves
    await query('DELETE FROM player_inventory WHERE container_id IN (SELECT id FROM player_inventory WHERE container_id=$1)', [container.id]);
    await query('DELETE FROM player_inventory WHERE container_id=$1', [container.id]);
    broadcast?.(player.current_zone, { type: 'zone_event', message: `The ${name} grinds and swallows its contents with a wet CRUNCH.` });
    return { type: 'action', message: `You slam the ${name} shut. It grinds its contents into slurry — gone for good.` };
  }
  broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} closes ${withArticle(name)}.` }, player.id);
  return { type: 'action', message: `You close ${withArticle(name)}.` };
}

async function cmdStowById(argStr, player, broadcast) {
  const [invRowId, containerRowId, qtyStr] = argStr.trim().split(/\s+/);
  const { rows: itemRows } = await query(`SELECT pi.*,i.name,i.tags,i.weight FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1 AND pi.player_id=$2 AND pi.container_id IS NULL AND NOT jsonb_exists(i.tags,'quest_item')`, [invRowId, player.id]);
  if (!itemRows.length) return { type:'container_error', message:'Item not found in your inventory.' };
  const item = itemRows[0];

  const container = await loadContainerById(containerRowId, player);
  if (!container) {
    // Fall back to corpse stow: move item from player inv onto a corpse
    const corpse = await resolveCorpseOrPlayer(containerRowId, player);
    if (!corpse || corpse.zoneId !== player.current_zone) return { type:'container_error', message:'Container not found.' };
    if (corpse.capacity != null) {
      const { rows: usedRows } = await query(`SELECT COALESCE(SUM(i.weight*pi.quantity),0) AS w FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1`, [corpse.id]);
      const used = Number(usedRows[0].w) || 0;
      if (used + (item.weight || 0) > corpse.capacity) {
        return { type:'container_error', message:`${corpse.name} is full (${formatWeight(used)}/${formatWeight(corpse.capacity)}).` };
      }
    }
    const reqQty = qtyStr && /^\d+$/.test(qtyStr) ? parseInt(qtyStr, 10) : null;
    const moveQty = (reqQty && reqQty > 0 && reqQty < item.quantity && isStackable(item)) ? reqQty : null;
    if (moveQty) {
      const { rows: ex } = await query('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL LIMIT 1', [corpse.id, item.item_id]);
      if (ex.length) {
        await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [moveQty, ex[0].id]);
      } else {
        await query('INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,$4,1.0)', [randomUUID(), corpse.id, item.item_id, moveQty]);
      }
      await query('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [moveQty, item.id]);
    } else {
      if (isStackable(item)) {
        const { rows: ex } = await query('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL LIMIT 1', [corpse.id, item.item_id]);
        if (ex.length) {
          await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [item.quantity, ex[0].id]);
          await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
        } else {
          await query('UPDATE player_inventory SET player_id=$1, container_id=NULL, is_equipped=0, slot=NULL WHERE id=$2', [corpse.id, item.id]);
        }
      } else {
        await query('UPDATE player_inventory SET player_id=$1, container_id=NULL, is_equipped=0, slot=NULL WHERE id=$2', [corpse.id, item.id]);
      }
    }
    const view = await buildLootView(corpse, player);
    view.mainMsg = `You drop ${item.name} on ${corpse.name}.`;
    return view;
  }
  if (item.id === container.id) return { type:'container_error', message:`Can't put ${container.name} inside itself.` };
  if (hasTag(item, 'container') && !container.isTrash) {
    const { rows: innerItems } = await query('SELECT 1 FROM player_inventory WHERE container_id=$1 LIMIT 1', [item.id]);
    if (innerItems.length) return { type:'container_error', message:`Empty the ${item.name} first.` };
  }

  // Partial stow: only move the requested qty when less than the full stack
  const reqQty = qtyStr && /^\d+$/.test(qtyStr) ? parseInt(qtyStr, 10) : null;
  if (reqQty && reqQty > 0 && reqQty < item.quantity && isStackable(item)) {
    const cap0 = containerCapacity(container);
    const used0 = await containerContentsWeight(container.id);
    const iw = item.weight || 0;
    const canFit = iw > 0 ? Math.min(reqQty, Math.floor((cap0 - used0) / iw)) : reqQty;
    if (canFit <= 0) return { type:'container_error', message:`${container.name} is full.` };
    const { rows: ex0 } = await query('SELECT id FROM player_inventory WHERE container_id=$1 AND item_id=$2 LIMIT 1', [container.id, item.item_id]);
    if (ex0.length) {
      await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [canFit, ex0[0].id]);
      await query('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [canFit, item.id]);
    } else {
      await query('INSERT INTO player_inventory (id,player_id,item_id,quantity,container_id,condition) VALUES ($1,$2,$3,$4,$5,1.0)', [randomUUID(), player.id, item.item_id, canFit, container.id]);
      await query('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [canFit, item.id]);
    }
    const echoed0 = throttledContainerBroadcast(player, broadcast, container.name);
    const view0 = await buildContainerView(container.id, player);
    if (echoed0) view0.mainMsg = `You rummage through ${withArticle(container.name)}.`;
    return view0;
  }

  const cap = containerCapacity(container);
  const used = await containerContentsWeight(container.id);
  const itemWeight = item.weight || 0;
  const adding = itemWeight * item.quantity;

  if (used + adding > cap) {
    // Partial fill: for stackable multi-quantity items, stow as many as fit.
    if (isStackable(item) && itemWeight > 0 && item.quantity > 1) {
      const canFit = Math.floor((cap - used) / itemWeight);
      if (canFit > 0) {
        const { rows: existing } = await query('SELECT id FROM player_inventory WHERE container_id=$1 AND item_id=$2 LIMIT 1', [container.id, item.item_id]);
        if (existing.length) {
          await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [canFit, existing[0].id]);
          await query('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [canFit, item.id]);
        } else {
          await query('INSERT INTO player_inventory (id,player_id,item_id,quantity,container_id,condition) VALUES ($1,$2,$3,$4,$5,1.0)', [randomUUID(), player.id, item.item_id, canFit, container.id]);
          await query('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [canFit, item.id]);
        }
        const echoed = throttledContainerBroadcast(player, broadcast, container.name);
        const view = await buildContainerView(container.id, player);
        view.notify = `Stowed ${canFit}x ${item.name} — bag is now full.`;
        if (echoed) view.mainMsg = `You rummage through ${withArticle(container.name)}.`;
        return view;
      }
    }
    return { type:'container_error', message:`${container.name} is full (${formatWeight(used)}/${formatWeight(cap)}).` };
  }

  if (isStackable(item)) {
    const { rows: existing } = await query('SELECT id FROM player_inventory WHERE container_id=$1 AND item_id=$2 LIMIT 1', [container.id, item.item_id]);
    if (existing.length) {
      await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [item.quantity, existing[0].id]);
      await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
      const echoed1 = throttledContainerBroadcast(player, broadcast, container.name);
      const view1 = await buildContainerView(container.id, player);
      if (echoed1) view1.mainMsg = `You rummage through ${withArticle(container.name)}.`;
      return view1;
    }
  }
  await query('UPDATE player_inventory SET container_id=$1, is_equipped=0, slot=NULL WHERE id=$2', [container.id, item.id]);
  const echoed2 = throttledContainerBroadcast(player, broadcast, container.name);
  const view2 = await buildContainerView(container.id, player);
  if (echoed2) view2.mainMsg = `You rummage through ${withArticle(container.name)}.`;
  return view2;
}

async function cmdPullById(idStr, qtyStr, player, broadcast) {
  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1 AND pi.container_id IS NOT NULL`, [idStr]);
  if (!rows.length) return { type:'container_error', message:'Item not found.' };
  const item = rows[0];
  const containerId = item.container_id;

  const container = await loadContainerById(containerId, player);
  if (!container) return { type:'container_error', message:'Not your container.' };

  // Partial pull: only move the requested qty when less than the full stack
  const reqQty = qtyStr && /^\d+$/.test(qtyStr) ? parseInt(qtyStr, 10) : null;
  const takeQty = (reqQty && reqQty > 0 && reqQty < item.quantity) ? reqQty : null;
  if (takeQty && isStackable(item)) {
    const { rows: exPull } = await query('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL AND is_equipped=0 LIMIT 1', [player.id, item.item_id]);
    if (exPull.length) {
      await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [takeQty, exPull[0].id]);
    } else {
      await query('INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,$4,1.0)', [randomUUID(), player.id, item.item_id, takeQty]);
    }
    await query('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [takeQty, item.id]);
    const pePart = throttledContainerBroadcast(player, broadcast, container.name);
    const pvPart = await buildContainerView(containerId, player);
    if (pePart) pvPart.mainMsg = `You rummage through ${withArticle(container.name)}.`;
    return pvPart;
  }

  if (isStackable(item)) {
    const { rows: existing } = await query('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL AND is_equipped=0 LIMIT 1', [player.id, item.item_id]);
    if (existing.length) {
      await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [item.quantity, existing[0].id]);
      await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
      const pe1 = throttledContainerBroadcast(player, broadcast, container.name);
      const pv1 = await buildContainerView(containerId, player);
      if (pe1) pv1.mainMsg = `You rummage through ${withArticle(container.name)}.`;
      return pv1;
    }
  }
  await query('UPDATE player_inventory SET container_id=NULL, player_id=$1 WHERE id=$2', [player.id, item.id]);
  const pe2 = throttledContainerBroadcast(player, broadcast, container.name);
  const pv2 = await buildContainerView(containerId, player);
  if (pe2) pv2.mainMsg = `You rummage through ${withArticle(container.name)}.`;
  return pv2;
}

async function cmdStow(argStr, player) {
  if (!argStr) return { type:'error', message:'Stow what?' };
  const [itemPart, containerPart] = splitOn(argStr, ' in ');
  if (!itemPart) return { type:'error', message:'Stow what?' };

  // Check for trash bin furniture before normal container resolution.
  if (containerPart) {
    const { rows: trashRows } = await query(
      `SELECT id,name FROM furniture WHERE zone_id=$1 AND name ILIKE $2 AND (object_type='container' OR flags->>'trash_bin'='true') LIMIT 1`,
      [player.current_zone, `%${containerPart}%`]
    );
    if (trashRows.length) {
      const { rows: itemRows } = await query(`SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND i.name ILIKE $2 AND NOT jsonb_exists(i.tags,'quest_item') LIMIT 1`, [player.id, `%${itemPart}%`]);
      if (!itemRows.length) return { type:'error', message:`You don't have "${itemPart}".` };
      await query('DELETE FROM player_inventory WHERE container_id=$1', [itemRows[0].id]);
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
  if (hasTag(item, 'container')) {
    const { rows: innerItems } = await query('SELECT 1 FROM player_inventory WHERE container_id=$1 LIMIT 1', [item.id]);
    if (innerItems.length) return { type:'error', message:`Empty the ${item.name} first.` };
  }

  const cap = tagValue(container, 'container', 0);
  const used = await containerContentsWeight(container.id);
  const adding = (item.weight || 0) * item.quantity;
  if (used + adding > cap) return { type:'error', message:`${container.name} can't hold that — ${formatWeight(used)}/${formatWeight(cap)} used, ${item.name} weighs ${formatWeight(adding)}.` };

  if (isStackable(item)) {
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

  if (isStackable(item)) {
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
  gear: (args, raw, player) => cmdGear(player),
  take: (args, raw, player, broadcast) => cmdTake(args.join(' '), player, broadcast),
  drop: (args, raw, player, broadcast) => cmdDrop(args.join(' '), player, broadcast),
  dropid: (args, raw, player, broadcast) => cmdDropById(args[0], player, broadcast, parseInt(args[1]) || 0),
  give: (args, raw, player, broadcast) => cmdGive(args.join(' '), player, broadcast),
  use:   (args, raw, player, broadcast) => cmdUse(args.join(' '), player, broadcast),
  eat:   (args, raw, player, broadcast) => cmdUse(args.join(' '), player, broadcast),
  drink: (args, raw, player, broadcast) => cmdUse(args.join(' '), player, broadcast),
  equip:    (args, raw, player, broadcast) => cmdEquip(args.join(' '), player, broadcast),
  unequip:  (args, raw, player) => cmdUnequip(args.join(' '), player),
  equipid:   (args, raw, player, broadcast) => cmdEquipById(args[0], player, broadcast),
  unequipid: (args, raw, player) => cmdUnequipById(args[0], player),
  stow:  (args, raw, player) => cmdStow(args.join(' '), player),
  pull:  (args, raw, player) => cmdPull(args.join(' '), player),
  stowid: (args, raw, player, broadcast) => cmdStowById(args.join(' '), player, broadcast),
  pullid: (args, raw, player, broadcast) => cmdPullById(args[0], args[1], player, broadcast),
  opencontainer: (args, raw, player) => cmdOpenContainerById(args[0], player),
  closecontainer: (args, raw, player, broadcast) => cmdCloseContainer(args[0], player, broadcast),
};

export { cmdLookInContainer, describeContainer, cmdOpenContainer, cmdUse, cmdGear,
  cmdInventory, cmdEquipById, cmdUnequipById, cmdDropById };
