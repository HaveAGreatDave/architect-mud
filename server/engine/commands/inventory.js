import { randomUUID } from 'crypto';
import { query, withTransaction } from '../../models/db.js';
import { useDrug, getDrugCache } from '../drugs.js';
import { hasTag, tagValue, hasFlag, isStackable, TAG_CATALOG } from '../tags.js';
import { foodLoad, applyThirst } from '../bodily.js';
import { satiationLine, slakeLine, portionLine } from '../appetite.js';
import { dispatchAction, getRegisteredActions } from '../actions.js';
import { burnCharge, rowIsInstanced, NOT_INSTANCED_SQL } from '../inventory.js';
import { getZonePlayers, getZoneNpcs } from '../world.js';
import { emit, on } from '../events.js';
import { resolve as siftResolve, matchAll as siftMatchAll, createSelectionState, formatSelectionPage } from '../sift.js';
import { fireSpecializedAction, availableActions } from '../specializedActions.js';
import { computeSellUnitPrice } from '../vendor.js';
import { resolveCorpseOrPlayer, buildLootView } from './combat.js';
import { titleCaseName } from '../text.js';
import { getItem } from '../items-cache.js';
import { fireHook } from '../plugins.js';
import { applyEffect } from '../effects.js';
import { sendToPlayer } from '../messaging.js';

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

// Soak contributors: systems that add to a player's typed soak from a source
// other than equipped armor (e.g. subdermal-weave augments — armor under the
// skin). Each contributor mutates the per-slot map in place, mirroring the
// protection.js provider-chain contract. Called from recomputeArmor after the
// equipped pass, so player.soak always reflects both sources. Contributors may
// be async (recomputeArmor runs on equip/login, never on a per-swing hot path —
// combat reads the finished player.soak from memory), and a throwing one is
// skipped, never fatal.
const _armorContributors = [];
export function registerArmorContributor(fn) { _armorContributors.push(fn); }

// Merge a typed-soak map into a per-slot bySlot structure, additively.
// Shared by the equipped-armor pass and augment contributors so both stack the
// same way. `sm` is { type: value }; adds to bySlot[slot].soak.
export function addSoakToSlot(bySlot, slot, sm) {
  if (!slot || !sm || typeof sm !== 'object') return;
  const entry = bySlot[slot] || (bySlot[slot] = { soak: {} });
  for (const [type, val] of Object.entries(sm)) entry.soak[type] = (entry.soak[type] || 0) + (Number(val) || 0);
}

// Build a per-slot typed-soak structure for the player from equipped armor.
// player.soak[slot] = { soak: { kinetic:4, ... } }.
// Combat routes the weapon's damage_type through the struck part's slot here.
export async function recomputeArmor(player, rows = null) {
  if (!rows) ({ rows } = await query(`SELECT i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1`, [player.id]));
  const bySlot = {};
  for (const r of rows) {
    const slot = tagValue(r, 'slot');
    if (!slot) continue;
    // A `covers` garment (e.g. a jumpsuit) protects every slot it fills.
    const covers = tagValue(r, 'covers');
    const slots = Array.isArray(covers) ? [slot, ...covers] : [slot];
    const sm = tagValue(r, 'armor_soak');
    if (!sm || typeof sm !== 'object') continue;
    for (const s of slots) addSoakToSlot(bySlot, s, sm);
  }
  // Non-armor soak sources (augments, etc.) layer on after the equipped pass.
  for (const contribute of _armorContributors) {
    try { await contribute(player, bySlot); }
    catch (e) { console.error(`[armor] soak contributor error: ${e.message}`); }
  }
  player.soak = bySlot;
}

// The slots acid rain can actually land on. Hands are omitted deliberately —
// gloves are common enough that including them would make full cover trivial.
const ACID_SLOTS = ['head', 'torso', 'legs', 'feet'];

// How much of the wind chill each covered slot is worth giving back. Torso dominates for the
// same reason it dominates the exposure penalty — it's the surface the body defends hardest —
// and the two together are the whole of it, so a coat and trousers in a windproof shell
// cancel the chill entirely. Sums to 1.
const WINDPROOF_WEIGHTS = { torso: 0.65, legs: 0.35 };

// The extremities frostbite actually takes. Core slots are excluded on purpose: a frozen
// torso is hypothermia, which the core-temperature model already owns — this is the
// peripheral injury that happens to a body whose core is still being defended successfully.
const EXTREMITY_SLOTS = ['hands', 'feet', 'head'];

export async function recomputeInsulation(player, rows = null) {
  if (!rows) ({ rows } = await query(`SELECT i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1`, [player.id]));
  let total = 0;
  let wetKept = 0;
  let sealed = false;
  const covered = new Set();
  const shed = new Set();
  const blocked = new Set();
  for (const r of rows) {
    const ins = tagValue(r, 'insulation', 0) || 0;
    total += ins;
    // Wool, neoprene, sealed shells and wicking synthetics keep their warmth when soaked;
    // cotton, denim and padding do not. Tracked as a SECOND sum rather than a per-item
    // wetness because `player.wetness` is already an average over the whole outfit — this
    // is the share of your insulation that average can't touch.
    if (hasTag(r, 'hydrophobic')) wetKept += ins;
    if (hasTag(r, 'sealed')) sealed = true;   // respirator/mask — blocks ash choking
    const slot = tagValue(r, 'slot');
    if (slot) covered.add(slot);
    // A `covers` garment (e.g. a jumpsuit) counts its extra slots as clothed too.
    const covers = tagValue(r, 'covers');
    if (Array.isArray(covers)) for (const c of covers) covered.add(c);
    // Acid protection is COVERAGE-based, not any-one-item like `sealed`: a
    // waterproof garment only shields the skin it actually sits over.
    if (hasTag(r, 'waterproof')) {
      if (slot) shed.add(slot);
      if (Array.isArray(covers)) for (const c of covers) shed.add(c);
    }
    // Windproofing is coverage-based for the same reason, and deliberately a SEPARATE tag
    // from waterproof: oilskin sheds rain and flaps in a gale, a windbreaker does the
    // opposite. A garment that does both simply carries both tags.
    if (hasTag(r, 'windproof')) {
      if (slot) blocked.add(slot);
      if (Array.isArray(covers)) for (const c of covers) blocked.add(c);
    }
  }
  player.insulation = total;
  // The part of that total that survives a soaking. The body-temp tick interpolates between
  // the two on `player.wetness`, so a wet hoodie is nearly worthless and a wet wool scarf is
  // not. Never greater than the total.
  player.insulationWet = Math.min(total, wetKept);
  // Whether any equipped item seals the airway (gas mask / respirator). Read by the
  // ashfall breathing hazard in gameLoop's resourceTick. See systems-weather-extreme.md.
  player.sealed = sealed;
  // Fraction of the exposed body shielded from falling acid (0..1). Full cover is
  // immunity; anything less scales the burn. Read by the acid-rain hazard in
  // gameLoop's resourceTick. See systems-weather-extreme.md.
  player.acidCover = ACID_SLOTS.reduce((n, s) => n + (shed.has(s) ? 1 : 0), 0) / ACID_SLOTS.length;
  // Bare core skin sheds heat fast, so nakedness makes the cold genuinely bite.
  // Torso dominates (the body defends the core hardest); legs are secondary.
  // Applied only to the cooling side of the body-temp tick (see gameLoop.js) —
  // going shirtless in the heat is a relief, not a penalty.
  player.exposurePenalty = (covered.has('torso') ? 0 : 10) + (covered.has('legs') ? 0 : 5);
  // Fraction of the wind chill a shell keeps off you (0..1). Read by the body-temp tick,
  // which gives back that share of `windChillDelta`. Only counts a slot that is windproof
  // AND actually clothed — a shell you aren't wearing over anything is still a shell, but
  // the bookkeeping stays honest if a future garment is windproof without occupying a slot.
  player.windproof = Object.entries(WINDPROOF_WEIGHTS)
    .reduce((n, [slot, w]) => n + (blocked.has(slot) && covered.has(slot) ? w : 0), 0);
  // Fraction of the EXTREMITIES left bare (0..1) — hands, feet, head. Drives frostbite,
  // which is a peripheral injury and so cares about exactly the slots the core model
  // ignores. Owned here so the frostbite plugin needs no inventory read of its own.
  player.extremityExposure =
    EXTREMITY_SLOTS.reduce((n, s) => n + (covered.has(s) ? 0 : 1), 0) / EXTREMITY_SLOTS.length;
}

// Armor and insulation derive from the same equipped-rows set and are always
// needed together — one fetch feeding both, instead of the identical query
// issued back-to-back at every equip/unequip/undress/login.
// Gear that DULLS a sense, cached on the live player the same way armor and
// insulation are. `smell` is a spammable verb and acuity is read on every use,
// so this can never be a query in that path — it's recomputed here, on the one
// funnel every equip/unequip already goes through.
//
// The trade is the entire point. A respirator can't be worn to be safe for free:
// it raises the strength something needs to blow your nose out, and it lowers
// what you can perceive by exactly the same amount. Protection and perception
// are the same dial turned opposite ways.
export function recomputeSenseDamp(player, rows) {
  const damp = {};
  for (const r of rows) {
    const map = r?.tags?.sense_damp;
    if (!map || typeof map !== 'object') continue;
    for (const [sense, v] of Object.entries(map)) {
      const n = Number(v);
      if (Number.isFinite(n) && n) damp[sense] = (damp[sense] || 0) + n;
    }
  }
  player._senseDamp = Object.keys(damp).length ? damp : null;
}

export async function recomputeEquipped(player) {
  // `pi.id`/`pi.slot`/`pi.condition` ride along on a query that already runs, so
  // combat can wear the struck piece from memory instead of looking it up per
  // hit (server/engine/durability.js — wear is on the hot path and cannot query).
  const { rows } = await query(
    `SELECT i.tags, i.value, i.name, pi.id AS inv_id, pi.slot, pi.condition, pi.item_id
       FROM player_inventory pi JOIN items i ON i.id=pi.item_id
      WHERE pi.player_id=$1 AND pi.is_equipped=1`, [player.id]);
  // Slot -> the worn row occupying it. Rebuilt on every equip/unequip, which is
  // the only way the set can change, so it can never go stale behind our back.
  player._wornRows = new Map(rows.filter(r => r.slot).map(r => [r.slot, r]));
  await recomputeArmor(player, rows);
  await recomputeInsulation(player, rows);
  recomputeSenseDamp(player, rows);
}

async function cmdInventory(player) {
  // One un-joined fetch of the whole inventory (carried + contained) — item
  // template fields decorate from the boot-loaded items cache, and container
  // contents weights sum in JS from the same rows (was two round trips: a JOIN
  // plus a per-container GROUP BY aggregate).
  const { rows: all } = await query(`SELECT * FROM player_inventory WHERE player_id=$1`, [player.id]);
  for (const r of all) {
    const it = getItem(r.item_id);
    if (!it) continue;
    r.name = it.name; r.tags = it.tags; r.weight = it.weight; r.value = it.value;
  }
  // Rows whose template vanished are dropped, matching the old INNER JOIN.
  const rows = all
    .filter(r => !r.container_id && getItem(r.item_id))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (!rows.length) return { type:'inventory', message:'Your inventory is empty.', items:[] };
  // Per-instance name (custom_data.name) wins — e.g. a credit chip stamped with its
  // own denomination — otherwise Title Case the item-type name for list display.
  for (const r of rows) r.name = parseCustomData(r.custom_data)?.name || titleCaseName(r.name);
  const containerWeights = new Map();
  for (const r of all) {
    if (!r.container_id) continue;
    const w = (getItem(r.item_id)?.weight || 0) * (r.quantity || 1);
    containerWeights.set(r.container_id, (containerWeights.get(r.container_id) || 0) + w);
  }
  let msg = '<span class="inv-header">INVENTORY</span>\n';
  for (const item of rows) {
    const eq = item.is_equipped ? ' <span class="equipped">[equipped]</span>' : '';
    const instFlags = INSTANCE_FLAGS.filter(n => hasFlag(item, n)).map(n => ` [${n}]`).join('');
    let container = '';
    if (hasTag(item, 'container')) {
      const used = containerWeights.get(item.id) || 0;
      container = ` <span class="equipped">[${formatWeight(used)}/${formatWeight(tagValue(item, 'container', 0))}]</span>`;
    }
    msg += `  ${item.name}${item.quantity>1?` x${item.quantity}`:''}${instFlags}${container}${eq}\n`;
    // Derived fields for the client item-detail panel (see equipment.js showItemDetail).
    item.sell_value = computeSellUnitPrice(item.value, player.stat_cool);
    item.actions = availableActions(item);
    // A non-food usable — an explicit `use_message` but not `consumable` (e.g. a credit chip banked
    // with `use`, since currency isn't eaten) — surfaces `use` in the item menu, not the food `eat`.
    if (hasTag(item, 'use_message') && !hasTag(item, 'consumable') && !item.actions.includes('use')) item.actions.push('use');
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
  await recomputeEquipped(player);
  const effects = {
    insulation: player.insulation || 0,
    sealed: !!player.sealed,
    acidCover: player.acidCover || 0,
    exposurePenalty: player.exposurePenalty || 0,
    stat_bonus: {},
  };
  for (const item of rows) {
    item.sell_value = computeSellUnitPrice(item.value, player.stat_cool);
    item.actions = availableActions(item);
    // A non-food usable — an explicit `use_message` but not `consumable` (e.g. a credit chip banked
    // with `use`, since currency isn't eaten) — surfaces `use` in the item menu, not the food `eat`.
    if (hasTag(item, 'use_message') && !hasTag(item, 'consumable') && !item.actions.includes('use')) item.actions.push('use');
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
//
// Cached on the live player object: the encumbrance move-gate calls this on
// every step, so uncached it was a full inventory aggregate per move against a
// remote DB. `inventory.changed` busts the cache on the paths a player uses to
// fix "too heavy" (drop/give/take — instant), while the short TTL bounds
// staleness from the many plugin writers that mutate player_inventory without
// emitting (crafting outputs, fishing catches, ...). A few seconds of stale
// weight is benign: encumbrance is a soft gate, and the value self-corrects.
const CARRIED_WEIGHT_TTL_MS = 5000;
on('inventory.changed', ({ actor }) => { if (actor) delete actor._carriedWeight; });

// …and tell the client, so an open tablet Kit app isn't showing a pack you no longer
// have. `inventory.changed` is the canonical mutation signal (actions.js TAKE/DROP/
// GIVE/EQUIP/UNEQUIP, durability wear, and the plugins that emit it), and this is the
// one place it needs to leave the server. Deliberately a bare "it changed" ping and
// not a payload: the client refetches ONLY if the Kit app is actually on screen
// (refreshTabletGearIfOpen), so the common case — a closed tablet — costs one tiny
// frame and no query. Plugins that mutate player_inventory with raw SQL and never
// emit are still invisible to this; that's an argument for emitting, not for the
// client polling.
on('inventory.changed', ({ actor }) => {
  if (actor?.id) sendToPlayer(actor.id, { type: 'inventory_dirty' });
});
export async function computeCarriedWeight(player) {
  const cached = player._carriedWeight;
  if (cached && Date.now() - cached.at < CARRIED_WEIGHT_TTL_MS) return cached.value;
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(i.weight*pi.quantity) FILTER (WHERE pi.container_id IS NULL),0) AS top,
       COALESCE(SUM(i.weight*pi.quantity) FILTER (WHERE pi.container_id IS NOT NULL),0) AS contained
     FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1`,
    [player.id]
  );
  const value = (Number(rows[0].top) || 0) + (Number(rows[0].contained) || 0) * 0.75;
  player._carriedWeight = { value, at: Date.now() };
  return value;
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
    `SELECT pi.*,i.name,i.type,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND NOT jsonb_exists(i.tags,'quest_item')`,
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
    const matches = matchAllFilter(filter, rows);
    if (!matches.length) return { type:'error', message:`You don't have any "${filter}" to drop.` };
    return dropRows(matches, player, broadcast);
  }

  // Optional leading quantity: "drop 3 stimpaks" drops that many with no prompt.
  let work = targetStr.trim();
  let explicitQty = null;
  const qtyMatch = work.match(/^(\d+)\s+(.+)$/);
  if (qtyMatch) { explicitQty = parseInt(qtyMatch[1], 10); work = qtyMatch[2].trim(); }

  const sift = siftResolve(work, rows, { verb: 'drop' });
  if (sift.type === 'none') return { type:'error', message:`You don't have "${work}".` };
  if (sift.type === 'ambiguous') {
    createSelectionState(player.id, sift.candidates, { verb: 'drop', dispatchType: 'DROP', dispatchParam: 'row' });
    return { type:'output', message: formatSelectionPage({ allCandidates: sift.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  const row = sift.candidate;
  // A stack, with no quantity given — ask how many rather than dumping it all.
  if (explicitQty == null && row.quantity > 1) {
    return {
      type: 'qty_prompt',
      prompt: `How many ${row.name} do you want to drop?`,
      max: row.quantity,
      command: `dropid ${row.id}`,
      confirmLabel: 'Drop',
    };
  }
  return dispatchAction({ type:'DROP', actor: player, params: { row, qty: explicitQty ?? undefined }, context: { broadcast } });
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
    await recomputeEquipped(player);
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
// Every spliced compound rides the same carrier drug row (drug_compound), so a
// per-recipe key is what keeps their doses, tolerance and buffs from pooling
// together. Derived from what went into the splice, so the same recipe always
// resolves to the same key across sessions.
function compoundStateKey(drugId, cd) {
  const sources = Array.isArray(cd?.sources)
    ? cd.sources.map(s => s?.drug).filter(Boolean).sort()
    : [];
  return sources.length ? `${drugId}:${sources.join('+')}` : drugId;
}

function buildDrugOpts(cd, item, route) {
  const opts = { potencyMult: Number(cd?.potency) || 1, route };
  if (cd && cd.effects) {
    opts.inlineEffects = cd.effects;
    opts.stateKey = compoundStateKey(item.drug_id, cd);
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
  // A fatal dose still only burns ONE charge. Skipping burnCharge here dropped
  // through to the stack delete below, so dying on a drag would destroy the whole
  // 20-pack instead of leaving 19 on the corpse.
  const burn = await burnCharge(item, itemTags);
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
  const opts = { ...buildDrugOpts(cd, item, extraOpts.route), ...extraOpts };
  return applyDrugUse(player, item, cd, opts, broadcast);
}

// `route` is the verb that delivered the dose (use/inject/eat/drink/smoke). It rides
// into useDrug, which owns the route→onset/intensity law and degrades an unsupported
// route to neutral, so callers can pass their verb without checking the drug.
async function cmdUse(targetStr, player, broadcast, route = 'use') {
  if (!targetStr) return { type:'error', message:'Use what?' };

  // Match by display name (substring), the instance's custom name, or the item
  // TYPE id (exact, e.g. "item_stimpak") — the latter lets macros/scripts target
  // "any of that item" and grabs the first matching stack.
  const { rows: drugRows } = await query(
    `SELECT pi.*, i.name, i.tags, d.id as drug_id FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     JOIN drugs d ON d.item_id = i.id
     WHERE pi.player_id=$1 AND (i.name ILIKE $2 OR pi.custom_data->>'name' ILIKE $2 OR i.id ILIKE $3) LIMIT 1`,
    [player.id, `%${targetStr}%`, targetStr]
  );
  if (drugRows.length) {
    const item = drugRows[0];
    const cd = parseCustomData(item.custom_data);
    // Sealed in a climate crate — frozen and search-proof until you break the seal.
    if (cd && cd.packaged) return { type: 'error', message: `That's sealed in a climate crate. <span class="text-dim">unseal</span> it first.` };
    const opts = buildDrugOpts(cd, item, route);
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

  // `consumable` (food/drugs) OR an explicit `use_message` (a non-food usable, e.g. a credit chip
  // banked with `use` — currency isn't eaten). Both funnel through the same payout/effect path below.
  // Match the instance's custom name too (same as the drug lookup above): a credit chip is *shown*
  // as "credit chip (₵100)" from custom_data.name, so without this the displayed name never resolves.
  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND (i.name ILIKE $2 OR pi.custom_data->>'name' ILIKE $2 OR i.id ILIKE $3) AND (jsonb_exists(i.tags,'consumable') OR jsonb_exists(i.tags,'use_message')) LIMIT 1`, [player.id, `%${targetStr}%`, targetStr]);
  if (!rows.length) return cmdUseFurniture(targetStr, player, broadcast);
  const item = rows[0];
  const t = item.tags || {};
  // A laced *alcoholic* drink (the cocktails: martini, whiskey, …) drinks like a
  // beer — hand it to the timed consume plugin so its thirst pours out sip-by-sip
  // and the drug lands on the last swallow, same as the drug-item drinks. Only
  // alcohol-laced items qualify (a stim-laced energy drink stays an instant hit).
  if (isSlowDrinkItem(t) && getRegisteredActions().includes('consume.begin')) {
    const r = await dispatchAction({ type: 'consume.begin', actor: player, params: { item, itemKind: 'item' }, context: { broadcast } });
    if (r && !r.passthrough) return r;
  }
  return applyItemUse(player, item, broadcast);
}

// A consumable that should be *drunk over time* rather than downed instantly:
// an alcohol-laced drink. Mirrors the drug-drink category gate (flags.alcoholic).
function isSlowDrinkItem(tags) {
  return !!(tags?.laced_drug && getDrugCache()[tags.laced_drug]?.flags?.alcoholic);
}

// Apply a non-drug consumable's own restores (HP/hunger/thirst/…), consume it as
// one atomic unit, then land any laced drug it carries. Shared by the instant
// `use` path and the timed-drink finish. `opts.skipThirstRestore` lets the consume
// plugin credit a laced drink's thirst sip-by-sip without this double-counting it;
// `opts.takeLine` overrides the opening flavour line.
// Cooked-quality payoff. The cooking plugin stamps `custom_data.cook_quality`
// on a plated meal; this is the only place it is spent. Keep the middle band at
// exactly 1.0 — an ordinary cook must feel like the baseline, not a penalty.
const COOK_QUALITY_MULT = {
  poor: 0.5, grim: 0.75, acceptable: 1.0, decent: 1.08, good: 1.15,
  'very good': 1.25, excellent: 1.35, superb: 1.48, masterful: 1.6,
};

export async function applyItemUse(player, item, broadcast, opts = {}) {
  const t = item.tags || {};
  const cd = parseCustomData(item.custom_data);
  // An item can carry its own flavour line for the act of consuming it
  // (tags.use_message); otherwise fall back to the plain default.
  const messages = [opts.takeLine || t.use_message || `You use ${item.name}.`];

  // Undercooked takes priority over spoiled (both are checked lazily right
  // here, at the moment it matters most) — either one skips every normal
  // restore/buff below in favor of a food-poisoning debuff; the item is still
  // consumed, it just gives you nothing good.
  const undercooked = t.needs_cooking && !(item.custom_data || {}).cooked;
  let spoiled = false;
  if (!undercooked && t.perishable) {
    const fresh = await fireHook('item.checkFreshness', item, player);
    spoiled = fresh?.state === 'spoiled';
  }
  const sick = undercooked || spoiled;

  if (sick) {
    messages[0] = undercooked
      ? `${item.name} is still raw in the middle — you eat it anyway and immediately regret it.`
      : `${item.name} is spoiled — you eat it anyway and immediately regret it.`;
  } else {
  // How well it was cooked scales what it gives back. Absent (every item that
  // isn't a plated profiled meal) is 1.0, so nothing that existed before this
  // changes. Applies to the nourishment restores only — not credits, not radiation.
  // Portions conserve. Half an onion feeds you half an onion's worth, and a dish
  // made from halves feeds you proportionally less — otherwise a knife would be
  // a way to make four dinners out of one.
  const portion = (Number(cd?.portion) > 0 && Number(cd.portion) < 1) ? Number(cd.portion) : 1;
  const dishYield = (Number(cd?.yield) > 0 && Number(cd.yield) < 1) ? Number(cd.yield) : 1;
  // Carry-over: a plated cut eaten straight off the heat hasn't settled, and one
  // left to go cold has lost something. The cooking plugin owns the curve; this
  // is only where it's spent.
  const rest = cd?.rests ? (await fireHook('cooking.restMultiplier', cd, player)) || 1 : 1;
  const qm = (COOK_QUALITY_MULT[cd?.cook_quality] ?? 1) * portion * dishYield * rest;
  if (cd?.cook_quality) {
    // Nine quality bands are only worth having if a player can FEEL the
    // difference between two of them. The cooking plugin turns what's stamped on
    // the plate into what it's like in the mouth.
    const flavour = (await fireHook('cooking.flavour', cd, player)) || [];
    for (const line of flavour) messages.push(`<span class="text-dim">${line}</span>`);
    if (!flavour.length) {
      messages.push(`<span class="text-dim">${cd.cook_quality[0].toUpperCase()}${cd.cook_quality.slice(1)}, this one.</span>`);
    }
  }
  const hp = Math.round((t.restore_hp || 0) * qm);
  const hunger = Math.round((t.restore_hunger || 0) * qm);
  if (hp) { player.hp = Math.min(player.hp_max, player.hp+hp); messages.push(`+${hp} HP.`); }
  if (hunger) {
    const before = player.hunger;
    player.hunger = Math.min(100, player.hunger+hunger);
    player.digestive_load = Math.min(120, (player.digestive_load || 0) + foodLoad(hunger));
    // WHERE YOU ENDED UP, not what you ate. `+12 Hunger.` is a receipt for a number the
    // player can no longer see, and it never said the one thing a bar cannot: how FULL you
    // are. Read after the restore lands so it describes the body, not the item.
    //
    // The amount rides ALONGSIDE that, and it is the amount ACTUALLY ABSORBED, not
    // the number stamped on the tin — eat a banquet on a full stomach and most of
    // it is wasted. That gap is the whole lesson about portion sizes, and quoting
    // the tin instead would hide exactly the case worth learning from.
    messages.push(`${satiationLine(player)}${portionLine('hunger', player.hunger - before, hunger)}`);
  }
  if (t.restore_thirst && !opts.skipThirstRestore) {
    const before = player.thirst || 0;
    applyThirst(player, t.restore_thirst);
    // Same reasoning as the hunger line above: where you ended up, not what you poured.
    messages.push(`${slakeLine(player)}${portionLine('thirst', (player.thirst || 0) - before, t.restore_thirst)}`);
  }
  if (t.restore_radiation) { player.radiation = Math.max(0, player.radiation+t.restore_radiation); messages.push(`${t.restore_radiation} Radiation.`); }
  if (t.restore_sanity) { player.sanity = Math.min(player.sanity_max, Math.max(0, player.sanity+t.restore_sanity)); messages.push(`${t.restore_sanity>0?'+':''}${t.restore_sanity} Sanity.`); }
  // Credit chips pay out a per-instance amount (custom_data.credits, variable from
  // a loot roll or a dropped corpse) and fall back to a fixed item-type value.
  const creditGrant = cd?.credits ?? t.grants_credits;
  if (creditGrant) { player.credits = (player.credits||0)+creditGrant; messages.push(`+${creditGrant} credits.`); }
  if (t.heal_over_time) {
    const { amount, duration_seconds } = t.heal_over_time;
    const ticks = Math.max(1, Math.round(duration_seconds / 60));
    const perTick = Math.ceil(amount / ticks);
    player.healOverTime = player.healOverTime || [];
    player.healOverTime.push({ perTick, ticksRemaining: ticks });
    messages.push(`Bleeding slows. You'll recover ${amount} HP over the next ${Math.round(duration_seconds/60)} minute(s).`);
  }
  // Well-fed is GRADED by how well the thing was cooked, not a masterful-only
  // cliff — otherwise the eight rungs below the top change nothing that happens
  // to you. The duration table lives with the cooking system; this spends it.
  const wellFedMs = cd?.cook_quality
    ? ((await fireHook('cooking.wellFedMs', cd, player)) || 0)
    : (t.well_fed ? 10 * 60 * 1000 : 0);
  if (wellFedMs > 0) {
    player.wellFedUntil = Date.now() + wellFedMs;
    messages.push(`Well-fed: HP regen is faster for the next ${Math.round(wellFedMs / 60000)} minute(s).`);
  }
  if (t.hydrating) {
    player.hydratedUntil = Date.now() + 10 * 60 * 1000;
    messages.push(`Hydrated: radiation clears faster for a while.`);
  }
  // Anything else a consumable does that the engine has no business knowing
  // about. Injuries are the first user (a splint sets a fracture); the handler
  // reads whatever tag it owns off `t` and returns a line to show, or nothing.
  const consumedNote = await fireHook('item.consumed', player, t);
  if (consumedNote) messages.push(consumedNote);
  }

  let madeIll = false;
  if (sick) {
    applyEffect(player, 'food_poisoning', 90);
    messages.push('Your stomach churns immediately.');
    madeIll = true;
  } else if (cd?.doneness) {
    // Doneness has a consequence, or it's just a label. Food deliberately pulled
    // rare carries a real chance of making you ill — which is what stops "blue"
    // from being a free way to skip most of the cook. The risk lives on the
    // profile (plugins/cooking/profiles.js); this is only where it's paid.
    const risk = await fireHook('cooking.donenessRisk', cd, player);
    if (risk > 0 && Math.random() < risk) {
      applyEffect(player, 'food_poisoning', 60);
      messages.push('It was pinker in the middle than it should have been. You feel it almost at once.');
      madeIll = true;
    }
  }

  // AMBIENT RISK — the food's own chance of being off, independent of cooking.
  //
  // 66 items authored `status_chance` and nothing had ever read it, so a wheel of
  // vat cheese carried a documented 5% chance of turning on you that could never
  // fire. This is NOT a duplicate of the raw/doneness routes above: 35 of those
  // items are not `needs_cooking` at all — cheese, rub, vinegar — and "this might
  // simply be off" is a thing undercooking cannot express. For the ones that ARE
  // raw, the authored rate (0.9 on a measure of filth, 0.6 on raw meat) is finer
  // than the flat certainty the `sick` route applies.
  //
  // Skipped entirely when something already made you ill — being poisoned twice
  // by one mouthful is a bug, not a gradient.
  if (!madeIll && t.status_chance && typeof t.status_chance === 'object') {
    for (const [effect, chance] of Object.entries(t.status_chance)) {
      const p = Number(chance);
      if (!(p > 0) || Math.random() >= p) continue;
      applyEffect(player, effect, effect === 'food_poisoning' ? 60 : 30);
      messages.push(effect === 'food_poisoning'
        ? 'That was not right. You knew it going down, and you swallowed anyway.'
        : 'Something about that disagrees with you.');
      break;   // one affliction per mouthful
    }
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
    const laced = await useDrug(player, t.laced_drug, broadcast, { potencyMult: Number(t.laced_potency) || 1, skipInstant: true, takeLine: '', route: opts.route });
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

// Re-resolve a non-drug consumable row by id and apply it now. The consume
// plugin's timed-drink finish uses this for laced drinks (which have no drugs
// row, so finishConsume can't serve them) — re-queried fresh so a row dropped
// mid-drink isn't applied off a stale snapshot. Returns null if the row is gone.
export async function finishConsumeItem(player, itemRowId, broadcast, extraOpts = {}) {
  const { rows } = await query(
    `SELECT pi.*, i.name, i.tags FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     WHERE pi.id=$1 AND pi.player_id=$2 LIMIT 1`,
    [itemRowId, player.id]
  );
  if (!rows.length) return null;
  return applyItemUse(player, rows[0], broadcast, extraOpts);
}

// Equip/unequip changes the worn set, so refresh derived armor + insulation
// (the inventory.changed event handler doesn't). Keeps typed soak and the
// nakedness/cold penalty current the moment gear goes on or comes off.
async function dispatchEquip(action, player) {
  const result = await dispatchAction(action);
  await recomputeEquipped(player);
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

// undress — take off every layer of clothing/armor in one go: all worn pieces in
// the five body slots (underwear/outerwear/armor). The wielded weapon and any
// accessories stay on — those aren't clothing. A bulk sibling of `unequip <item>`;
// mirrors MIS `strip`'s DB shape but self-only and with no MIS/consent gate. Shed
// pieces drop to is_equipped=0 (carried in the pack), same as a normal unequip.
async function cmdUndress(player, broadcast) {
  const { rows } = await query(
    `SELECT i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id
      WHERE pi.player_id=$1 AND pi.is_equipped=1 AND pi.slot = ANY($2)`,
    [player.id, BODY_SLOTS]
  );
  if (!rows.length) return { type:'output', message:"You're not wearing anything to take off." };
  await query(
    `UPDATE player_inventory SET is_equipped=0, slot=NULL, layer=NULL, equipped_at=NULL
      WHERE player_id=$1 AND is_equipped=1 AND slot = ANY($2)`,
    [player.id, BODY_SLOTS]
  );
  await recomputeEquipped(player);
  emit('inventory.changed', { actor: player });
  broadcast?.(player.current_zone, { type:'zone_event', message:`${player.handle} strips down.` }, player.id);
  return { type:'output', message:`You take off everything you're wearing (${rows.length} item${rows.length === 1 ? '' : 's'}) and stash it in your pack.`, refresh:true };
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
export async function loadContainerById(id, player) {
  const { rows } = await query(
    `SELECT pi.id,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id
     WHERE pi.id=$1 AND pi.player_id IN ($2,$3) AND pi.container_id IS NULL AND jsonb_exists(i.tags,'container')`,
    [id, player.id, `_ground_${player.current_zone}`]
  );
  if (rows.length) return { id: rows[0].id, name: rows[0].name, tags: rows[0].tags, kind: 'item', isTrash: false };
  const { rows: fRows } = await query(
    `SELECT id,name,flags,power_draw_kw FROM furniture WHERE id=$1 AND zone_id=$2 AND object_type='container'`,
    [id, player.current_zone]
  );
  if (fRows.length) return { id: fRows[0].id, name: fRows[0].name, tags: fRows[0].flags, power_draw_kw: fRows[0].power_draw_kw, kind: 'furniture', isTrash: fRows[0].flags?.trash_bin === true };
  return null;
}

// ── Shop stock: unpaid goods ─────────────────────────────────────────────────
// A furniture container flagged `vendor_stock: <npcId>` is a shop's display unit —
// a cooler on the sales floor, not a private fridge. Its contents are the vendor's
// until you settle up, so anything lifted out leaves marked `custom_data.unpaid`
// with the owning vendor's id. `checkout` (commerce) clears the mark; carrying it
// out of the shop is shoplifting. Returns the vendor id, or null for a normal
// container (which behaves exactly as it always has).
const vendorStockOwner = container =>
  (container?.kind === 'furniture' && container?.tags?.vendor_stock) || null;

// SQL fragment stamping the mark; expects the vendor id as the LAST bound param.
const UNPAID_SET_SQL = `, custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('unpaid', $3::text)`;
// And the fragment that clears it, for putting stock back where it came from.
const UNPAID_CLEAR_SQL = `, custom_data = COALESCE(custom_data,'{}'::jsonb) - 'unpaid'`;
const unpaidNote = name =>
  `<span class="text-dim">The ${name} isn't yours yet — pay at the counter (<b>checkout</b>) before you leave.</span>`;

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

// Furniture containers flagged `restock_items` (a list of item ids) act as a
// bottomless dispenser: they keep exactly one of each listed item present.
// Run on every container view (open + the refresh a pull/stow returns), so
// taking an item makes a fresh copy reappear. player_id is a throwaway sentinel
// — container contents are keyed by container_id and reassigned on pull.
async function restockContainer(container) {
  if (container.kind !== 'furniture') return;
  const ids = container.tags?.restock_items;
  if (!Array.isArray(ids) || !ids.length) return;
  const { rows } = await query('SELECT DISTINCT item_id FROM player_inventory WHERE container_id=$1', [container.id]);
  const present = new Set(rows.map(r => r.item_id));
  for (const itemId of ids) {
    if (present.has(itemId)) continue;
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, container_id)
       SELECT $1,'_restock',id,1,1.0,$2 FROM items WHERE id=$3`,
      [randomUUID(), container.id, itemId]
    );
  }
}

// One box's { capacity, usedWeight, containerItems } — shared by the primary
// container and its optional paired one (e.g. a fridge's freezer box).
async function loadBoxContents(container) {
  await restockContainer(container);
  const cap = containerCapacity(container);
  const used = await containerContentsWeight(container.id);
  const { rows: containerItems } = await query(`SELECT pi.*,i.name,i.tags,i.weight FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.container_id=$1 ORDER BY i.name`, [container.id]);
  for (const r of containerItems) r.name = titleCaseName(r.name);
  return { capacity: cap, usedWeight: round1(used), containerItems, preserves: container.tags?.preserves ?? null, applianceGrade: container.tags?.appliance_grade ?? null };
}

async function buildContainerView(containerId, player) {
  const container = await loadContainerById(containerId, player);
  if (!container) return { type:'error', message:'Container not found.' };
  const { rows: invItems } = await query(`SELECT pi.*,i.name,i.tags,i.weight FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND pi.is_equipped=0 ORDER BY i.name`, [player.id]);
  for (const r of invItems) r.name = titleCaseName(r.name);       // list display — Title Case

  const box = await loadBoxContents(container);
  const view = { type:'container_view', containerId: container.id, containerName: titleCaseName(container.name), ...box, invItems };

  // Paired container (e.g. a fridge's separate freezer box, same appliance,
  // linked via flags.paired_container on each side): surface it as a second
  // box in the SAME view so opening one opens both — no second `open` needed.
  const pairedId = container.kind === 'furniture' ? container.tags?.paired_container : null;
  if (pairedId && pairedId !== container.id) {
    const paired = await loadContainerById(pairedId, player);
    if (paired) {
      const pairedBox = await loadBoxContents(paired);
      view.secondary = { containerId: paired.id, containerName: titleCaseName(paired.name), ...pairedBox };
    }
  }
  // A container furniture can be more than a box — a wardrobe layers saved
  // outfits over the same storage. Handlers mutate `view` in place (retyping it
  // and hanging their own block off it); an unhooked container is untouched.
  await fireHook('container.view', { view, container, player });
  return view;
}

async function cmdOpenContainer(nameStr, player, broadcast) {
  if (!nameStr) return null;
  let container = await resolveContainer(nameStr, player);
  if (container === 'ambiguous') return null;
  if (!container) {
    // No item container matched — try a furniture container in this zone.
    const { rows } = await query(
      `SELECT id FROM furniture WHERE zone_id=$1 AND object_type='container' AND (name ILIKE $2 OR flags->>'aliases' ILIKE $2) LIMIT 1`,
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
  if (item.tags?.perishable) await fireHook('item.checkFreshness', item, player);
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
  // Putting shop stock back clears the unpaid mark (see vendorStockOwner).
  await query(`UPDATE player_inventory SET container_id=$1, is_equipped=0, slot=NULL${vendorStockOwner(container) ? UNPAID_CLEAR_SQL : ''} WHERE id=$2`, [container.id, item.id]);
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
  if (item.tags?.perishable) await fireHook('item.checkFreshness', item, player);

  // Partial pull: only move the requested qty when less than the full stack
  const reqQty = qtyStr && /^\d+$/.test(qtyStr) ? parseInt(qtyStr, 10) : null;
  const takeQty = (reqQty && reqQty > 0 && reqQty < item.quantity) ? reqQty : null;
  // Shop stock keeps its own row (never merges into what you already carry) so the
  // unpaid mark survives the trip to the counter — see vendorStockOwner.
  const vendorId = vendorStockOwner(container);
  if (takeQty && isStackable(item) && !rowIsInstanced(item)) {
    const { rows: exPull } = vendorId ? { rows: [] }
      : await query(`SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL AND is_equipped=0 AND ${NOT_INSTANCED_SQL} LIMIT 1`, [player.id, item.item_id]);
    if (exPull.length) {
      await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [takeQty, exPull[0].id]);
    } else {
      await query('INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,custom_data) VALUES ($1,$2,$3,$4,1.0,$5)',
        [randomUUID(), player.id, item.item_id, takeQty, JSON.stringify(vendorId ? { unpaid: vendorId } : {})]);
    }
    await query('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [takeQty, item.id]);
    const pePart = throttledContainerBroadcast(player, broadcast, container.name);
    const pvPart = await buildContainerView(containerId, player);
    if (pePart) pvPart.mainMsg = `You rummage through ${withArticle(container.name)}.`;
    if (vendorId) pvPart.mainMsg = unpaidNote(item.name);
    return pvPart;
  }

  if (!vendorId && isStackable(item) && !rowIsInstanced(item)) {
    const { rows: existing } = await query(`SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL AND is_equipped=0 AND ${NOT_INSTANCED_SQL} LIMIT 1`, [player.id, item.item_id]);
    if (existing.length) {
      await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [item.quantity, existing[0].id]);
      await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
      const pe1 = throttledContainerBroadcast(player, broadcast, container.name);
      const pv1 = await buildContainerView(containerId, player);
      if (pe1) pv1.mainMsg = `You rummage through ${withArticle(container.name)}.`;
      return pv1;
    }
  }
  await query(`UPDATE player_inventory SET container_id=NULL, player_id=$1${vendorId ? UNPAID_SET_SQL : ''} WHERE id=$2`,
    vendorId ? [player.id, item.id, vendorId] : [player.id, item.id]);
  const pe2 = throttledContainerBroadcast(player, broadcast, container.name);
  const pv2 = await buildContainerView(containerId, player);
  if (pe2) pv2.mainMsg = `You rummage through ${withArticle(container.name)}.`;
  if (vendorId) pv2.mainMsg = unpaidNote(item.name);
  return pv2;
}

// "all" / "all <filter>" — the bulk form shared by drop and stow. Returns null
// when the argument isn't a bulk form at all.
function parseAllArg(argStr) {
  const lower = argStr.trim().toLowerCase();
  if (lower === 'all') return { filter: '' };
  if (lower.startsWith('all ')) return { filter: argStr.trim().slice(4).trim() };
  return null;
}

// SIFT matches on NAME only, which is right for a single target but too narrow
// for a bulk sweep: "drop all utensils" names a CATEGORY, not an item. Fall back
// to the item's type or one of its tags (singular or plural) when no name hits,
// so a player can clear a category without knowing every item in it.
function matchAllFilter(filter, rows) {
  const byName = siftMatchAll(filter, rows);
  if (byName.length) return byName;
  const f = filter.trim().toLowerCase().replace(/s$/, '');
  if (!f) return [];
  const norm = s => String(s || '').toLowerCase().replace(/s$/, '');
  return rows.filter(r =>
    norm(r.type) === f || Object.keys(r.tags || {}).some(t => norm(t) === f));
}

// Carried, unequipped, non-quest rows — the pool a bulk stow draws from.
// Equipped gear is deliberately excluded: unlike "drop all" (which prompts
// before stripping you), stowing shouldn't silently undress you.
async function bulkStowPool(player) {
  const { rows } = await query(
    `SELECT pi.*,i.name,i.type,i.tags,i.weight FROM player_inventory pi JOIN items i ON i.id=pi.item_id
     WHERE pi.player_id=$1 AND pi.container_id IS NULL AND pi.is_equipped=0 AND NOT jsonb_exists(i.tags,'quest_item')`,
    [player.id]
  );
  return rows;
}

async function cmdStow(argStr, player) {
  if (!argStr) return { type:'error', message:'Stow what?' };
  const [itemPart, containerPart] = splitOn(argStr, ' in ');
  if (!itemPart) return { type:'error', message:'Stow what?' };
  const bulk = parseAllArg(itemPart);

  // Check for trash bin furniture before normal container resolution.
  if (containerPart) {
    const { rows: trashRows } = await query(
      `SELECT id,name FROM furniture WHERE zone_id=$1 AND name ILIKE $2 AND flags->>'trash_bin'='true' LIMIT 1`,
      [player.current_zone, `%${containerPart}%`]
    );
    if (trashRows.length) {
      if (bulk) {
        const pool = await bulkStowPool(player);
        const doomed = bulk.filter ? matchAllFilter(bulk.filter, pool) : pool;
        if (!doomed.length) {
          return { type:'error', message: bulk.filter ? `You don't have any "${bulk.filter}".` : `You aren't carrying anything to throw out.` };
        }
        const ids = doomed.map(r => r.id);
        await query('DELETE FROM player_inventory WHERE container_id = ANY($1)', [ids]);
        await query('DELETE FROM player_inventory WHERE id = ANY($1)', [ids]);
        return { type:'stow', message:`You throw ${doomed.map(r => r.name).join(', ')} in the ${trashRows[0].name}. Gone.` };
      }
      const { rows: itemRows } = await query(`SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND i.name ILIKE $2 AND NOT jsonb_exists(i.tags,'quest_item') LIMIT 1`, [player.id, `%${itemPart}%`]);
      if (!itemRows.length) return { type:'error', message:`You don't have "${itemPart}".` };
      await query('DELETE FROM player_inventory WHERE container_id=$1', [itemRows[0].id]);
      await query('DELETE FROM player_inventory WHERE id=$1', [itemRows[0].id]);
      return { type:'stow', message:`You throw ${itemRows[0].name} in the ${trashRows[0].name}. It's gone.` };
    }
  }

  let container = await resolveContainer(containerPart, player);
  if (container === 'ambiguous') return { type:'error', message:`Which container? Try "stow <item> in <name>".` };
  if (!container && containerPart) {
    // No item/ground container matched — fall through to a furniture container in this zone.
    const { rows: fRows } = await query(
      `SELECT id FROM furniture WHERE zone_id=$1 AND object_type='container' AND (name ILIKE $2 OR flags->>'aliases' ILIKE $2) LIMIT 1`,
      [player.current_zone, `%${containerPart}%`]
    );
    if (fRows.length) container = await loadContainerById(fRows[0].id, player);
  }
  if (!container) return { type:'error', message:`You don't see a container${containerPart?` matching "${containerPart}"`:''} here.` };

  if (bulk) {
    const pool = await bulkStowPool(player);
    const matches = (bulk.filter ? matchAllFilter(bulk.filter, pool) : pool)
      .filter(r => r.id !== container.id);   // never the bag inside itself
    if (!matches.length) {
      return { type:'error', message: bulk.filter ? `You don't have any "${bulk.filter}" to stow.` : `You aren't carrying anything to stow.` };
    }
    const messages = [];
    for (const row of matches) {
      const r = await stowOne(row, container, player);
      messages.push(r.message);
    }
    return { type:'stow', message: messages.join('\n') };
  }

  const { rows } = await query(`SELECT pi.*,i.name,i.tags,i.weight FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND i.name ILIKE $2 AND NOT jsonb_exists(i.tags,'quest_item') LIMIT 1`, [player.id, `%${itemPart}%`]);
  if (!rows.length) return { type:'error', message:`You don't have "${itemPart}" to stow.` };
  return stowOne(rows[0], container, player);
}

// Move one carried row into an open container. Every failure is a per-item
// message rather than a throw, so a bulk stow can report "the bag filled up"
// against the item that didn't fit and keep going.
async function stowOne(item, container, player) {
  if (item.tags?.perishable) await fireHook('item.checkFreshness', item, player);
  if (item.id === container.id) return { type:'error', message:`You can't put ${container.name} inside itself.` };
  if (hasTag(item, 'container')) {
    const { rows: innerItems } = await query('SELECT 1 FROM player_inventory WHERE container_id=$1 LIMIT 1', [item.id]);
    if (innerItems.length) return { type:'error', message:`Empty the ${item.name} first.` };
  }

  const cap = containerCapacity(container);
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
  // Putting shop stock back on the shelf un-marks it — changing your mind at the
  // cooler is not a crime, and the row rejoins the vendor's sellable stock.
  await query(`UPDATE player_inventory SET container_id=$1, is_equipped=0, slot=NULL${vendorStockOwner(container) ? UNPAID_CLEAR_SQL : ''} WHERE id=$2`, [container.id, item.id]);
  return { type:'stow', message:`You stow ${item.name} in ${container.name}.` };
}

async function cmdPull(argStr, player) {
  if (!argStr) return { type:'error', message:'Pull what?' };
  const [itemPart, containerPart] = splitOn(argStr, ' from ');
  if (!itemPart) return { type:'error', message:'Pull what?' };
  let container = await resolveContainer(containerPart, player);
  if (container === 'ambiguous') return { type:'error', message:`Which container? Try "pull <item> from <name>".` };
  if (!container && containerPart) {
    // No item/ground container matched — fall through to a furniture container in
    // this zone, same as `stow` does. Without this the text path could never reach
    // a shop cooler or any other furniture container; only the GUI `pullid` could.
    const { rows: fRows } = await query(
      `SELECT id FROM furniture WHERE zone_id=$1 AND object_type='container' AND (name ILIKE $2 OR flags->>'aliases' ILIKE $2) LIMIT 1`,
      [player.current_zone, `%${containerPart}%`]
    );
    if (fRows.length) container = await loadContainerById(fRows[0].id, player);
  }
  if (!container) return { type:'error', message:`You don't see a container${containerPart?` matching "${containerPart}"`:''} here.` };

  const { rows } = await query(`SELECT pi.*,i.name,i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.container_id=$1 AND i.name ILIKE $2 LIMIT 1`, [container.id, `%${itemPart}%`]);
  if (!rows.length) return { type:'error', message:`There's no "${itemPart}" in ${container.name}.` };
  const item = rows[0];
  if (item.tags?.perishable) await fireHook('item.checkFreshness', item, player);

  const vendorId = vendorStockOwner(container);
  // Shop stock never merges into what you already carry — it has to stay a
  // distinct, markable row so the counter (and the door) can tell it apart.
  if (!vendorId && isStackable(item) && !rowIsInstanced(item)) {
    const { rows: existing } = await query(`SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL AND is_equipped=0 AND ${NOT_INSTANCED_SQL} LIMIT 1`, [player.id, item.item_id]);
    if (existing.length) {
      await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [item.quantity, existing[0].id]);
      await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
      return { type:'pull', message:`You pull ${item.name} from ${container.name}.` };
    }
  }
  await query(`UPDATE player_inventory SET container_id=NULL, player_id=$1${vendorId ? UNPAID_SET_SQL : ''} WHERE id=$2`, vendorId ? [player.id, item.id, vendorId] : [player.id, item.id]);
  if (vendorId) return { type:'pull', message:`You take ${item.name} from ${container.name}. ${unpaidNote(item.name)}` };
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
  use:   (args, raw, player, broadcast) => cmdUse(args.join(' '), player, broadcast, 'use'),
  eat:   (args, raw, player, broadcast) => cmdUse(args.join(' '), player, broadcast, 'eat'),
  drink: (args, raw, player, broadcast) => cmdUse(args.join(' '), player, broadcast, 'drink'),
  equip:    (args, raw, player, broadcast) => cmdEquip(args.join(' '), player, broadcast),
  unequip:  (args, raw, player) => cmdUnequip(args.join(' '), player),
  undress:  (args, raw, player, broadcast) => cmdUndress(player, broadcast),
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
  cmdInventory, cmdEquipById, cmdUnequipById, cmdDropById, buildContainerView,
  // Exported for the wardrobe plugin: it overrides `undress` to add a container
  // target and delegates the untargeted case straight back here, so the bulk-strip
  // behaviour can never drift between the two.
  cmdUndress, containerCapacity, containerContentsWeight };
