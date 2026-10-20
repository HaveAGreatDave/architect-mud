/**
 * Furniture shopping. Buying a furniture-type item delivers a placed piece into
 * one of the player's apartments, or, when the piece is light enough to carry
 * without being encumbered, the player can carry it out as an item and 'place'
 * it themselves (plugins/furnishing).
 *
 * A furniture item is "consumer" (sellable + placeable) only if its
 * flags.interactions include something you can do with it: sit / lean / lie /
 * watch / lift. Anything else (infrastructure with no such interaction) is ignored by
 * vendors — see getVendorStock in vendor.js.
 *
 * Pricing mirrors the normal buy flow: base = catalogue price ?? item.value,
 * the faction-rep discount is applied to that same base, then a random
 * variation — usually small, occasionally significant (a real steal or a bad
 * day) — so the same piece rarely costs exactly the same twice.
 */
import { query } from '../models/db.js';
import { emit } from './events.js';
import { getItem, getItemCache } from './items-cache.js';
import { giveItemById } from './inventory.js';
import { carryCapacity, computeCarriedWeight } from './commands/inventory.js';
import { playerControlsApt } from './apartments.js';
import { getIdeologyDiscount } from './ideologies.js';
import { adjustCredits } from './economy.js';
import { registerAction } from './actions.js';
import { createSelectionState, formatSelectionPage } from './sift.js';
import { vendorBuyReaction } from './vendor-reactions.js';
import { isVendorClosed, vendorClosedLine } from './ai-behaviour.js';
import { world, syncNpc, insertFurniture } from './world.js';
import { randomUUID } from 'crypto';

const CONSUMER_INTERACTIONS = ['sit', 'lean', 'lie', 'watch', 'lift'];

export function furnitureInteractions(item) {
  const ix = item?.flags?.interactions;
  return Array.isArray(ix) ? ix : [];
}

// True for furniture items a vendor will actually sell (things you can use).
export function isConsumerFurniture(item) {
  return item?.type === 'furniture'
    && furnitureInteractions(item).some(v => CONSUMER_INTERACTIONS.includes(v));
}

// The `furniture.object_type` a placed piece is born as. A piece that HOLDS
// things has to be a `container`: `loadContainerById` and every `stow`/`open`
// path find a furniture container by `object_type='container'` and nothing
// else, so a bought fridge inserted as plain 'furniture' was a fridge you could
// never open — while the authored twin of the same appliance is a 'container'.
// Derived from the capacity flag, so no item declares its own row type.
export function furnitureObjectType(flags) {
  return Number(flags?.container) > 0 ? 'container' : 'furniture';
}

// Random price factor. Most rolls sit within ±8%; ~1 in 6 widens to ±30% so a
// purchase can occasionally be a real bargain (or a rip-off).
function rollVariation() {
  const spread = Math.random() < 1 / 6 ? 0.30 : 0.08;
  return 1 + (Math.random() * 2 - 1) * spread;
}

// The apartments this player can have a piece delivered to: their own flats and
// a corp HQ they manage. Read from world.apartments, so a purchase costs no query.
function deliverableApartments(player) {
  const out = [];
  for (const [zoneId, apt] of world.apartments) {
    if (!playerControlsApt(player, apt)) continue;
    out.push({ zone_id: zoneId, name: world.zones.get(zoneId)?.name || zoneId, building_name: apt.building_name || null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Can this player take on `grams` more without being too heavy to walk? The
// encumbrance move gate blocks at carried > capacity, so equal is still fine.
export async function canCarryExtra(player, grams) {
  const carried = await computeCarriedWeight(player);
  return carried + (Number(grams) || 0) <= carryCapacity(player);
}

// The item a placed piece turns back into (plugins/furnishing `take` and
// release boxing). Pieces placed since furnishing shipped carry flags.item_id;
// older bought pieces only have the item's name.
export function itemForPlacedPiece(row) {
  const byId = row?.flags?.item_id && getItem(row.flags.item_id);
  if (byId) return byId;
  const name = String(row?.name || '').toLowerCase();
  if (!name) return null;
  for (const item of getItemCache().values()) {
    if (item.type === 'furniture' && String(item.name).toLowerCase() === name) return item;
  }
  return null;
}

// A varied, in-character line the vendor gives when a piece is on its way home.
// "<home> at <building>" when we know the building; just "<home>" otherwise.
function deliveryLine(npc, item, aptName, buildingName) {
  const where = buildingName ? `${aptName} at ${buildingName}` : aptName;
  const lines = [
    `"Good pick. I'll have the ${item.name} run over to ${where} soon as I can."`,
    `"Sold. The ${item.name}'ll be waiting at ${where} before you know it."`,
    `"Nice. My people will drop the ${item.name} off at ${where}. Give it a little time."`,
    `"Done. Expect the ${item.name} at ${where} shortly; delivery's on me."`,
    `"${item.name}, coming right up. We'll get it over to ${where} as soon as possible."`,
  ];
  const line = lines[Math.floor(Math.random() * lines.length)];
  return `${npc.name || 'The vendor'} nods. ${line}`;
}

// Insert a placed furniture piece from an item definition into a zone. The id
// is `furn_<8hex>` and origin 'player' on purpose: the content export and the
// import's deletion pass both skip such rows, so a deploy never touches them.
export async function placeFurnitureFromItem(item, zoneId, ownerId, { price } = {}) {
  // Carry the item's own flags across, not just `interactions`. Only the latter used to
  // survive, which meant every functional furniture item — a kettle's `brew_tier`, a heater's
  // element — became an inert prop the moment somebody bought it rather than authoring it into
  // a room. `power_draw_kw` is promoted to its column so the appliance verbs can find it.
  const flags = { ...(item.flags || {}), interactions: furnitureInteractions(item), item_id: item.id };
  const draw = Number(flags.power_draw_kw);
  delete flags.power_draw_kw;
  const id = `furn_${randomUUID().slice(0, 8)}`;
  await insertFurniture({
    id, zone_id: zoneId, name: item.name, description: item.tags?.description ?? item.description,
    flags: JSON.stringify(flags), object_type: furnitureObjectType(flags), price: price ?? item.value ?? null,
    origin: 'player', owner_id: ownerId ?? null,
    ...(Number.isFinite(draw) ? { power_draw_kw: draw } : {}),
  });
  return id;
}

// What the vendor says when the player carries a piece out themselves.
function carryLine(npc, item) {
  const lines = [
    `"It's yours. Mind the door frame."`,
    `"Lift with your legs."`,
    `"No returns once it's out the door."`,
    `"Saves me a delivery. Go on."`,
  ];
  const line = lines[Math.floor(Math.random() * lines.length)];
  return `${npc?.name || 'The vendor'} pushes the ${item.name} across to you. ${line}`;
}

// Charge the player, then either place the piece in `dest` (an apartment) or,
// when dest.carry is set, hand it over as an item. Credits the vendor.
async function finalizePurchase(player, npc, item, price, base, dest) {
  if (!await adjustCredits(player, -price, undefined, 'furniture:buy')) {
    return { type: 'error', message: `You can't afford that. Need ${price} credits, have ${player.credits || 0}.\n${vendorBuyReaction(npc, 'poor')}` };
  }
  let line;
  if (dest.carry) {
    await giveItemById(player.id, item.id, 1);
    emit('inventory.changed', { actor: player });
    line = `${carryLine(npc, item)} <span class="text-dim">(Type 'place ${item.name}' in a room you own.)</span>`;
  } else {
    await placeFurnitureFromItem(item, dest.zone_id, player.id, { price: base });
    line = deliveryLine(npc, item, dest.name, dest.building_name);
  }
  if (npc?.id) {
    const { rows: vc } = await query('UPDATE npcs SET vendor_credits = vendor_credits + $1 WHERE id = $2 RETURNING vendor_credits', [price, npc.id]);
    if (vc.length) syncNpc(npc.id, { vendor_credits: vc[0].vendor_credits });
  }
  return {
    type: 'buy',
    message: `You buy the ${item.name} for ${price} credits. ${line} (${player.credits} credits remaining)`,
    player_update: { credits: player.credits },
  };
}

/**
 * Entry point from cmdBuy (and the shop window) when the item is consumer
 * furniture. Carrying is offered only when the piece wouldn't leave the player
 * too heavy to walk.
 *   - no apartment, can't carry   → the vendor refuses.
 *   - no apartment, can carry     → carry it out.
 *   - one apartment, can't carry  → deliver there.
 *   - otherwise                   → prompt: each apartment, plus carry if it fits.
 */
export async function buyFurniture(player, npc, item, catalogueEntry) {
  if (isVendorClosed(npc)) return { type: 'error', message: vendorClosedLine(npc) };
  const apts = deliverableApartments(player);
  const carryable = await canCarryExtra(player, item.weight);
  if (!apts.length && !carryable) {
    return {
      type: 'error',
      message: `${npc.name} looks you over. "You can't carry that, and I don't deliver to people with no fixed address. Get yourself a place first."`,
    };
  }

  const discount = npc.faction ? await getIdeologyDiscount(player.id, npc.faction) : 0;
  const base = catalogueEntry?.price ?? item.value;
  const price = Math.max(1, Math.round(base * (1 - discount) * rollVariation()));

  if (!apts.length) return finalizePurchase(player, npc, item, price, base, { carry: true });
  if (apts.length === 1 && !carryable) return finalizePurchase(player, npc, item, price, base, apts[0]);

  // A choice to make: which place, or carry it. The purchase (fixed price)
  // rides along on each candidate so the choice just picks a destination.
  const purchase = { npcId: npc.id, item, price, base };
  const candidates = apts.map(a => ({
    name: a.name,
    zone_id: a.zone_id,
    building_name: a.building_name,
    _purchase: purchase,
  }));
  if (carryable) candidates.push({ name: 'Carry it out yourself', carry: true, _purchase: purchase });
  createSelectionState(player.id, candidates, {
    verb: 'deliver_furniture',
    dispatchType: 'furniture.deliver',
    dispatchParam: 'apartment',
  });
  return {
    type: 'output',
    message: `Where should the ${item.name} (${price}₵) go?\n${formatSelectionPage({ allCandidates: candidates, visibleIndex: 0, pageSize: 5 })}`,
  };
}

// Fired when the player picks a unit from the delivery prompt.
registerAction({
  type: 'furniture.deliver',
  handler: async ({ actor, params }) => {
    const apt = params.apartment;
    const p = apt?._purchase;
    if (!apt || !p) return { type: 'error', message: 'That order slipped away. Try buying it again.' };
    const npc = world.npcs.get(p.npcId) || { id: p.npcId, name: 'the vendor' };
    // The player may have picked something up while the prompt was open.
    if (apt.carry && !await canCarryExtra(actor, p.item.weight)) {
      return { type: 'error', message: `You couldn't carry the ${p.item.name} as you are now. Buy it again and have it delivered.` };
    }
    return finalizePurchase(actor, npc, p.item, p.price, p.base, apt.carry ? { carry: true } : apt);
  },
});
