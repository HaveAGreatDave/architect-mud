/**
 * Furniture shopping — buying furniture-type items delivers a placed furniture
 * piece into one of the player's owned apartments instead of adding an item to
 * inventory.
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
import { getFactionDiscount } from './factions.js';
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

// Random price factor. Most rolls sit within ±8%; ~1 in 6 widens to ±30% so a
// purchase can occasionally be a real bargain (or a rip-off).
function rollVariation() {
  const spread = Math.random() < 1 / 6 ? 0.30 : 0.08;
  return 1 + (Math.random() * 2 - 1) * spread;
}

async function ownedApartments(playerId) {
  const { rows } = await query(
    `SELECT a.zone_id, z.name, a.building_name FROM apartments a
     JOIN zones z ON z.id = a.zone_id
     WHERE a.owner_id = $1 ORDER BY z.name`,
    [playerId]
  );
  return rows;
}

// A varied, in-character line the vendor gives when a piece is on its way home.
// "<home> at <building>" when we know the building; just "<home>" otherwise.
function deliveryLine(npc, item, aptName, buildingName) {
  const where = buildingName ? `${aptName} at ${buildingName}` : aptName;
  const lines = [
    `"Good pick. I'll have the ${item.name} run over to ${where} soon as I can."`,
    `"Sold. The ${item.name}'ll be waiting at ${where} before you know it."`,
    `"Nice. My people will drop the ${item.name} off at ${where} — give it a little time."`,
    `"Done. Expect the ${item.name} at ${where} shortly; delivery's on me."`,
    `"${item.name}, coming right up. We'll get it over to ${where} as soon as possible."`,
  ];
  const line = lines[Math.floor(Math.random() * lines.length)];
  return `${npc.name || 'The vendor'} nods. ${line}`;
}

// Insert a placed furniture piece from an item definition into a zone.
async function placeFurniture(item, base, zoneId, ownerId) {
  const flags = { interactions: furnitureInteractions(item) };
  const id = `furn_${randomUUID().slice(0, 8)}`;
  await insertFurniture({
    id, zone_id: zoneId, name: item.name, description: item.description,
    flags: JSON.stringify(flags), object_type: 'furniture', price: base,
    origin: 'player', owner_id: ownerId ?? null,
  });
  return id;
}

// Charge the player, place the piece, credit the vendor.
async function finalizePurchase(player, npc, item, price, base, aptZone, aptName, buildingName) {
  if (!await adjustCredits(player, -price, undefined, 'furniture:buy')) {
    return { type: 'error', message: `You can't afford that. Need ${price} credits, have ${player.credits || 0}.\n${vendorBuyReaction(npc, 'poor')}` };
  }
  await placeFurniture(item, base, aptZone, player.id);
  if (npc?.id) {
    const { rows: vc } = await query('UPDATE npcs SET vendor_credits = vendor_credits + $1 WHERE id = $2 RETURNING vendor_credits', [price, npc.id]);
    if (vc.length) syncNpc(npc.id, { vendor_credits: vc[0].vendor_credits });
  }
  return {
    type: 'buy',
    message: `You buy the ${item.name} for ${price} credits. ${deliveryLine(npc, item, aptName, buildingName)} (${player.credits} credits remaining)`,
    player_update: { credits: player.credits },
  };
}

/**
 * Entry point from cmdBuy when the resolved item is consumer furniture.
 *   - 0 apartments  → the vendor refuses.
 *   - 1 apartment   → deliver there.
 *   - >1 apartments → prompt which unit, then deliver via furniture.deliver.
 */
export async function buyFurniture(player, npc, item, catalogueEntry) {
  if (isVendorClosed(npc)) return { type: 'error', message: vendorClosedLine(npc) };
  const apts = await ownedApartments(player.id);
  if (!apts.length) {
    return {
      type: 'error',
      message: `${npc.name} looks you over. "No fixed address? I don't sell furniture to people with nowhere to put it. Get yourself a place first."`,
    };
  }

  const discount = npc.faction ? await getFactionDiscount(player.id, npc.faction) : 0;
  const base = catalogueEntry?.price ?? item.value;
  const price = Math.max(1, Math.round(base * (1 - discount) * rollVariation()));

  if (apts.length === 1) {
    return finalizePurchase(player, npc, item, price, base, apts[0].zone_id, apts[0].name, apts[0].building_name);
  }

  // Own more than one place — ask where to deliver. The purchase (fixed price)
  // rides along on each candidate so the choice just picks a destination.
  const candidates = apts.map(a => ({
    name: a.name,
    zone_id: a.zone_id,
    building_name: a.building_name,
    _purchase: { npcId: npc.id, item, price, base },
  }));
  createSelectionState(player.id, candidates, {
    verb: 'deliver_furniture',
    dispatchType: 'furniture.deliver',
    dispatchParam: 'apartment',
  });
  return {
    type: 'output',
    message: `You own ${apts.length} places. Where should the ${item.name} (${price}c) be delivered?\n${formatSelectionPage({ allCandidates: candidates, visibleIndex: 0, pageSize: 5 })}`,
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
    return finalizePurchase(actor, npc, p.item, p.price, p.base, apt.zone_id, apt.name, apt.building_name);
  },
});
