// Player-to-player drug dealing — the priced counterpart to `give`. `peddle <drug>
// to <player> [for <price>]` opens an offer the buyer must `acceptdeal` (or
// `declinedeal`); nothing moves until they agree. The price is HARD-CLAMPED to a
// potency-based fair value ±25% — you can haggle inside the band but can't gouge a
// mark or dump below cost. Same-room, one dose per deal, offers expire after 60s.
//
// No escrow: the pay + hand-off happen atomically at accept time (one transaction),
// re-checking both the buyer's funds and that the seller still holds the goods.
// Handing a controlled substance is `drug_dealing` — we emit `item.given` on the
// SELLER at accept, so the surveillance witness-roll charges the dealer as usual.
import { adjustCredits } from '../../server/engine/economy.js';
import { withTransaction, query } from '../../server/models/db.js';
import { getZonePlayers, getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
import { on, emit } from '../../server/engine/events.js';
import { randomUUID } from 'crypto';

const OFFER_TTL_MS = 60000;
const BAND = 0.25;                 // ±25% around the potency-fair price
const pendingDeal = new Map();     // buyerId -> { sellerId, sellerHandle, invId, itemId, itemName, cd, price, timer }

function clearOffer(buyerId) {
  const o = pendingDeal.get(buyerId);
  if (o?.timer) clearTimeout(o.timer);
  pendingDeal.delete(buyerId);
}

// peddle <drug> to <player> [for <price>]
function parseDeal(args) {
  const toks = args.filter(Boolean);
  const toIdx = toks.findIndex(t => t.toLowerCase() === 'to');
  if (toIdx < 1) return null;                      // need a drug before "to"
  const drug = toks.slice(0, toIdx).join(' ').trim();
  let rest = toks.slice(toIdx + 1);
  let price = null;
  const forIdx = rest.findIndex(t => t.toLowerCase() === 'for');
  if (forIdx >= 0) { const m = rest.slice(forIdx + 1).join(' ').match(/\d+/); if (m) price = parseInt(m[0], 10); rest = rest.slice(0, forIdx); }
  const who = rest.join(' ').trim();
  if (!drug || !who) return null;
  return { drug, who, price };
}

// Fair unit price = base value scaled by potency; band = ±25% (hard clamp).
function fairPrice(value, potency) {
  const p = Math.max(0.3, Math.min(2.5, Number(potency) || 1));
  return Math.max(1, Math.round((Number(value) || 1) * p));
}
const bandOf = (fair) => ({ lo: Math.max(1, Math.ceil(fair * (1 - BAND))), hi: Math.max(1, Math.floor(fair * (1 + BAND))) });

async function cmdPeddle(args, raw, player) {
  const parsed = parseDeal(args);
  if (!parsed) return { type: 'error', message: 'Usage: peddle <drug> to <player> [for <price>].' };
  const { drug, who, price } = parsed;

  const pool = getZonePlayers(player.current_zone).filter(p => p.id !== player.id).map(p => ({ ...p, name: p.handle }));
  if (!pool.length) return { type: 'error', message: 'Nobody here to deal with.' };
  const r = siftResolve(who, pool);
  if (r.type === 'none') return { type: 'error', message: `There's no "${who}" here.` };
  if (r.type === 'ambiguous') return { type: 'error', message: `Who do you mean — ${r.candidates.map(c => c.handle).join(', ')}?` };
  const buyer = r.candidate;

  const { rows } = await query(
    `SELECT pi.id AS inv_id, pi.quantity, pi.custom_data, i.id AS item_id, i.name, i.value
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id JOIN drugs d ON d.item_id = i.id
      WHERE pi.player_id = $1 AND pi.container_id IS NULL AND pi.is_equipped = 0
        AND (i.name ILIKE $2 OR pi.custom_data->>'name' ILIKE $2)
      ORDER BY i.name LIMIT 1`,
    [player.id, `%${drug}%`]
  );
  const row = rows[0];
  if (!row) return { type: 'error', message: `You're not carrying a "${drug}" to deal.` };
  const cd = row.custom_data || {};
  const potency = Number(cd.potency) || 1;
  const fair = fairPrice(row.value, potency);
  const { lo, hi } = bandOf(fair);
  const px = price === null ? fair : price;
  if (px <= 0) return { type: 'error', message: 'Name a positive price.' };
  if (px < lo || px > hi) return { type: 'error', message: `A fair price for the ${row.name} (potency ${Math.round(potency * 100)}%) is <b>₵${lo}–₵${hi}</b>. No gouging, no dumping.` };

  clearOffer(buyer.id);
  const nm = cd.name || row.name;
  const timer = setTimeout(() => {
    const o = pendingDeal.get(buyer.id);
    if (!o || o.sellerId !== player.id) return;
    pendingDeal.delete(buyer.id);
    sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">${buyer.handle} never took the ${nm}. Deal's off.</span>` });
    sendToPlayer(buyer.id, { type: 'output', message: `<span class="msg-system">${player.handle}'s offer lapses.</span>` });
  }, OFFER_TTL_MS);
  pendingDeal.set(buyer.id, { sellerId: player.id, sellerHandle: player.handle, invId: row.inv_id, itemId: row.item_id, itemName: row.name, cd, price: px, timer });

  sendToPlayer(buyer.id, { type: 'output', message: `<span class="msg-system">${player.handle} slips you a look — <b>${nm}</b> for <b>₵${px}</b>. <b>acceptdeal</b> to buy, <b>declinedeal</b> to pass.</span>` });
  return { type: 'output', message: `You offer ${buyer.handle} the ${nm} for ₵${px} — waiting on them.` };
}

async function cmdAcceptDeal(args, raw, player) {
  const offer = pendingDeal.get(player.id);
  if (!offer) return { type: 'error', message: "Nobody's dealing you anything." };
  const seller = getLivePlayer(offer.sellerId);
  if (!seller) { clearOffer(player.id); return { type: 'error', message: 'Whoever offered that is gone.' }; }
  if ((player.credits || 0) < offer.price) return { type: 'error', message: `You can't cover ₵${offer.price}.` };
  clearOffer(player.id);

  let failed = null;
  try {
    await withTransaction(async (tx) => {
      const { rows } = await tx('SELECT quantity FROM player_inventory WHERE id=$1 AND player_id=$2', [offer.invId, seller.id]);
      if (!rows.length || rows[0].quantity < 1) { failed = 'gone'; throw new Error('rollback'); }
      if (!(await adjustCredits(player, -offer.price, tx, 'dealing:trade'))) { failed = 'funds'; throw new Error('rollback'); }
      await adjustCredits(seller, offer.price, tx, 'dealing:trade');
      if (rows[0].quantity <= 1) await tx('DELETE FROM player_inventory WHERE id=$1', [offer.invId]);
      else await tx('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [offer.invId]);
      await tx('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data) VALUES ($1,$2,$3,1,1.0,$4)',
        [randomUUID(), player.id, offer.itemId, JSON.stringify(offer.cd || {})]);
    });
  } catch {
    if (failed === 'gone') return { type: 'error', message: `${seller.handle} doesn't have it anymore.` };
    if (failed === 'funds') return { type: 'error', message: `You couldn't cover ₵${offer.price}.` };
    return { type: 'error', message: 'The deal glitched — nothing moved.' };
  }

  // The hand-off: charges the SELLER with dealing (witness-rolled by surveillance).
  emit('item.given', { actor: seller, item: { item_id: offer.itemId } });
  const nm = offer.cd?.name || offer.itemName;
  sendToPlayer(seller.id, { type: 'output', message: `<span class="msg-system">${player.handle} takes the ${nm} — ₵${offer.price} in your pocket. (Balance: ₵${seller.credits})</span>` });
  return { type: 'output', message: `You palm the ${nm} from ${seller.handle} for ₵${offer.price}. (Balance: ₵${player.credits})`, player_update: { credits: player.credits } };
}

async function cmdDeclineDeal(args, raw, player) {
  const offer = pendingDeal.get(player.id);
  if (!offer) return { type: 'error', message: "Nobody's dealing you anything." };
  clearOffer(player.id);
  const seller = getLivePlayer(offer.sellerId);
  if (seller) sendToPlayer(seller.id, { type: 'output', message: `<span class="msg-system">${player.handle} passes on your ${offer.cd?.name || offer.itemName}.</span>` });
  return { type: 'output', message: `You wave off ${offer.sellerHandle}'s offer.` };
}

async function cmdCancelDeal(args, raw, player) {
  for (const [bid, o] of pendingDeal) {
    if (o.sellerId === player.id) {
      clearOffer(bid);
      const buyer = getLivePlayer(bid);
      if (buyer) sendToPlayer(buyer.id, { type: 'output', message: `<span class="msg-system">${player.handle} pockets the ${o.cd?.name || o.itemName} again — deal's off.</span>` });
      return { type: 'output', message: `You pull the offer back.` };
    }
  }
  return { type: 'error', message: "You've no pending deal to cancel." };
}

on('player.logout', ({ id }) => {
  clearOffer(id);
  for (const [bid, o] of pendingDeal) if (o.sellerId === id) clearOffer(bid);
});

export const commands = {
  peddle: cmdPeddle,
  acceptdeal: cmdAcceptDeal,
  declinedeal: cmdDeclineDeal,
  canceldeal: cmdCancelDeal,
};

export const _test = { parseDeal, fairPrice, bandOf };

console.log('[dealing] Plugin loaded.');
