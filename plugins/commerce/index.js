// Commerce plugin — the shop/browse/buy/sell/balance verbs. Extracted from
// server/engine/commands/economy.js (Phase 2, docs/proposals/engine-plugin-boundary.md).
// The vendor *services* (stock, pricing, trust, restock — vendor.js,
// furniture-shop.js, vendor-session.js, economy.js) stay engine, same pattern
// as combat math. SIFT ambiguous picks replay through the commerce.shop_vendor /
// commerce.buy_item Actions (builtin replay can't reach plugin verbs).
import { query, withTransaction } from '../../server/models/db.js';
import { getZoneNpcs, getZone, getAllLivePlayers, getMinimapData, world, syncNpc, streetExitFrom } from '../../server/engine/world.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { getIdeologyDiscount } from '../../server/engine/ideologies.js';
import { getItem } from '../../server/engine/items-cache.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { getVendorStock, getSellableInventory, buyFromVendor, sellToVendor, renderShopText, shopDialogPayload } from '../../server/engine/vendor.js';
import { prefersLoggedPanelsOrDefault } from '../../server/engine/presentation.js';
import { buyFurniture } from '../../server/engine/furniture-shop.js';
import { openShopSession, getNpcForShopper } from '../../server/engine/vendor-session.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { registerAction, getRegisteredActions } from '../../server/engine/actions.js';
import { on, emit } from '../../server/engine/events.js';
import { vendorGrudgeRemaining, holdVendorGrudge, grudgeRefusal } from '../../server/engine/vendor-grudge.js';
import { isVendorClosed, isVendorAbsent, isVendorOffHours, vendorClosedLine, openInPhrase, formatChitchat } from '../../server/engine/ai-behaviour.js';
import { registerMoveGate, registerShutProvider } from '../../server/engine/movement-gates.js';
import { schedule } from '../../server/engine/scheduler.js';
import { propagateSound } from '../../server/engine/sounds.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { getBroadcast, sendToPlayer } from '../../server/engine/messaging.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { isResidentOf, getBuildingName } from '../../server/engine/apartments.js';

// Resolve which vendor a bare buy/sell targets: the one the player is actively
// shopping with (if still in the zone), else the first vendor present. Without this,
// two vendors in a room would always route buy/sell to the first one regardless of
// which shop the player opened.
function resolveVendor(player, npcs) {
  const sessionNpcId = getNpcForShopper(player.id);
  if (sessionNpcId) {
    const sv = npcs.find(n => n.id === sessionNpcId && n.vendor_inventory?.length);
    if (sv) return sv;
  }
  return npcs.find(n => n.vendor_inventory?.length) || null;
}

async function openShopFor(npc, player, forceText = false) {
  if (!npc.vendor_inventory?.length) return { type:'error', message:`${npc.name} isn't a vendor.` };
  if (isVendorClosed(npc)) return { type:'error', message: vendorClosedLine(npc) };
  const grudge = await vendorGrudgeRemaining(player.id, npc.id);
  if (grudge > 0) return { type:'error', message: grudgeRefusal(npc, grudge) };
  const stock = await getVendorStock(npc, player.id);
  if (!stock.length) return { type:'error', message:`${npc.name} is out of stock.` };
  openShopSession(player.id, npc.id); // remember this vendor for bare buy/sell; pause its wandering
  // Bottom Display Mode rung: no panel at all, the log IS the shelf. The session
  // is open either way, so `buy`/`sell` behave identically from here.
  // `shop text <npc>` forces the written shelf at ANY rung — the same escape hatch
  // shape as `tablet verbs`, and the reason the dialog is allowed to replace the
  // dump: nothing is taken away, it is just no longer the thing you get by default.
  if (forceText) return { type: 'output', message: renderShopText(npc, stock, player.credits) };
  if (await prefersLoggedPanelsOrDefault(player)) {
    // ⚠ The dialog is the CONTROL; the log still gets the RECORD. A player
    // scrolling back has to be able to see that they went shopping, and the log
    // rung's own contract is that a system's record reaches `#output`. What it no
    // longer gets is 63 priced rows every time the shelf is re-read.
    sendToPlayer(player.id, {
      type: 'output',
      message: `<span class="msg-system">${npc.name}'s shelf is open — ${stock.length} thing${stock.length === 1 ? '' : 's'} for sale. `
        + `<span class="action-link" data-action="cmd" data-cmd="shop text ${npc.name}">shop text ${npc.name}</span> to read it here instead.</span>`,
    });
    return shopDialogPayload(npc, stock, player.credits);
  }
  // Open the GUI shop pane — same payload shape as the click-a-vendor dialogue path
  // (server/index.js sendShopPanel), so the `shop <npc>` command and clicking share one UI.
  const inventory = await getSellableInventory(player, npc);
  return {
    type: 'dialogue_shop',
    npcId: npc.id,
    npcName: npc.name,
    stock,
    inventory,
    credits: player.credits || 0,
  };
}

async function cmdShop(npcName, player, forceText = false) {
  if (!npcName) return { type:'error', message:'Browse whose shop? (shop <npc name>)' };
  const npcs = getZoneNpcs(player.current_zone);
  const r = siftResolve(npcName, npcs);
  if (r.type === 'none') return { type:'error', message:`Can't find "${npcName}" here.` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { dispatchType: 'commerce.shop_vendor', dispatchParam: 'target' });
    return { type:'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  return openShopFor(r.candidate, player, forceText);
}

async function buyStockItem(item, vendor, player) {
  const grudge = await vendorGrudgeRemaining(player.id, vendor.id);
  if (grudge > 0) return { type:'error', message: grudgeRefusal(vendor, grudge) };
  // Furniture is delivered to an owned apartment rather than carried in inventory.
  if (item.type === 'furniture') {
    const { rows } = await query('SELECT * FROM items WHERE id=$1', [item.item_id]);
    if (!rows.length) return { type:'error', message:'Item not found.' };
    const catalogueEntry = (vendor.vendor_inventory || []).find(e => e.item_id === item.item_id);
    return await buyFurniture(player, vendor, rows[0], catalogueEntry);
  }
  const result = await buyFromVendor(player, vendor, item.item_id, 1);
  return { type:result.success?'buy':'error', message:result.message, player_update:{credits:player.credits} };
}

async function cmdBuy(args, player) {
  const itemName = args.join(' ');
  if (!itemName) return { type:'error', message:'Buy what?' };
  const npcs = getZoneNpcs(player.current_zone);
  const vendor = resolveVendor(player, npcs);
  if (!vendor) {
    // No vendor NPC — but `buy` means the same thing over a player-owned shop's
    // display counter, so hand off to whoever claims that seam (the storefront
    // plugin) before refusing. Registered-by-name so commerce never imports it;
    // if that plugin isn't loaded the dispatch is unknown and we refuse as before.
    if (getRegisteredActions().includes('storefront.buy_by_name')) {
      const r = await dispatchAction({ type:'storefront.buy_by_name', actor: player, params:{ words: args } });
      if (r && r.message !== 'Unknown action: storefront.buy_by_name') return r;
    }
    return { type:'error', message:'No vendor here.' };
  }
  const stock = await getVendorStock(vendor, player.id);
  const br = siftResolve(itemName, stock);
  if (br.type === 'none') return { type:'error', message:`"${itemName}" isn't available here.` };
  if (br.type === 'ambiguous') {
    createSelectionState(player.id, br.candidates, { dispatchType: 'commerce.buy_item', dispatchParam: 'target' });
    return { type:'output', message: formatSelectionPage({ allCandidates: br.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  return buyStockItem(br.candidate, vendor, player);
}

async function cmdSell(args, player) {
  const itemName = args.join(' ');
  if (!itemName) return { type:'error', message:'Sell what?' };
  const npcs = getZoneNpcs(player.current_zone);
  const vendor = resolveVendor(player, npcs);
  if (!vendor) return { type:'error', message:'No vendor here.' };
  const row = await resolveInventoryItem(player, { name: itemName, topLevel: false });
  if (!row) return { type:'error', message:`You don't have "${itemName}".` };
  const result = await sellToVendor(player, vendor, row.inv_id, 1);
  return { type:result.success?'sell':'error', message:result.message, player_update:{credits:player.credits} };
}

async function cmdBalance(player) {
  return { type:'balance', message:`Carried: ${player.credits||0}₵\nBanked: ${player.bank_credits||0}₵` };
}

// SIFT selection replays.
registerAction({
  type: 'commerce.shop_vendor',
  handler: ({ actor, params }) => openShopFor(params.target, actor),
});
registerAction({
  type: 'commerce.buy_item',
  handler: ({ actor, params }) => {
    const vendor = resolveVendor(actor, getZoneNpcs(actor.current_zone));
    if (!vendor) return { type:'error', message:'No vendor here.' };
    return buyStockItem(params.target, vendor, actor);
  },
});

// Burgle an apartment an NPC vendor owns and they hold it against you — refusing
// to trade until the grudge lapses (7 in-game days). doors.js resolves the
// break-in to the apartment's real owner (ownerId/ownerType from the table), so
// this fires whether or not the owner was home. The safe-hack grudge is set
// directly by the vendor-safe plugin; this covers their hololocked residence.
on('hololock.breached', ({ player, ownerId }) => {
  if (!player?.id || !ownerId) return;
  // Attribute by resolving the owner id to an NPC vendor — player and NPC id
  // namespaces don't collide, so this catches NPC-owned apartments even when the
  // row's owner_type was never changed from the 'player' default.
  const npc = world.npcs.get(ownerId);
  if (npc?.vendor_inventory?.length) holdVendorGrudge(player, ownerId).catch(() => {});
});

// ── "You'll be wanting to know what to do with that" ─────────────────────────
//
// A vendor who says nothing when you buy the one item in their crates that needs
// explaining is a missed teaching moment. `flags.purchase_remarks` on an NPC maps
// item id → a line they deliver as you pocket it, in their own voice:
//
//   "purchase_remarks": {
//     "item_pry_deck": "\"That thing'll get you into trouble. Rig's on the wall.\""
//   }
//
// Same shape as the existing `inner_circle_line` seam (vendor.js): content-driven,
// no vendor or item hardcoded here. Fires ONCE per player per item by default —
// a sly aside lands the first time and is noise the fourth. Author
// `{ text, repeat: true }` for a line that should land every purchase.
//
// Read tier: one flag read per purchase, and only when the NPC actually authored
// a remark for the item bought — buying anything else costs nothing. Purchases
// are a deliberate player action, not a hot path.
on('vendor.purchase', async ({ player, npcId, itemId }) => {
  if (!player?.id || !npcId || !itemId) return;
  const npc = world.npcs.get(npcId);
  const remark = npc?.flags?.purchase_remarks?.[itemId];
  if (!remark) return;

  const text = typeof remark === 'string' ? remark : remark?.text;
  if (!text) return;

  if (!(typeof remark === 'object' && remark.repeat)) {
    const key = `remark_${npcId}_${itemId}`;
    if (await getFlag('player', key, player)) return;
    await setFlag('player', key, 'true', player);
  }

  sendToPlayer(player.id, { type: 'output',
    message: `\n<span class="msg-system">${npc.name} ${text}</span>` });
});

// ── Shop hours: a closed shop is a locked shop ───────────────────────────────
// Refusing to trade wasn't enough — you could still stand in a dark shop all
// night. A shop ROOM is now shut when every vendor who works it is off the clock:
// you can't walk in, and if you're inside when they close, they put you out.
//
// The index is presence-independent on purpose: a closed vendor has usually gone
// home, so reading the live zone occupancy would make the room stop looking like a
// shop the moment it closed. It's keyed off work_zone_id (where their shift IS),
// rebuilt lazily on a 60s TTL — NPCs are created/edited rarely and the world Maps
// are the read tier here, never a query.
const SHOP_IDX_TTL = 60_000;
let _shopIdx = null, _shopIdxAt = 0;
function shopVendorsFor(zoneId) {
  if (!_shopIdx || Date.now() - _shopIdxAt > SHOP_IDX_TTL) {
    _shopIdx = new Map();
    for (const n of world.npcs.values()) {
      if (!n?.work_zone_id || n.flags?.covert) continue;
      if (!n.vendor_inventory?.length) continue;
      if (!n.vendor_schedule || !Object.keys(n.vendor_schedule).length) continue;
      if (!_shopIdx.has(n.work_zone_id)) _shopIdx.set(n.work_zone_id, []);
      _shopIdx.get(n.work_zone_id).push(n);
    }
    _shopIdxAt = Date.now();
  }
  return _shopIdx.get(zoneId) || [];
}

// The vendor to quote when this room is shut, or null if it isn't a shop room /
// someone is still trading. Interiors only: a stallholder standing on a street
// tile must never lock the street.
function shopClosedFor(zone) {
  if (!zone?.flags?.is_interior) return null;
  const vendors = shopVendorsFor(zone.id);
  if (!vendors.length) return null;
  if (vendors.some(n => !isVendorClosed(n))) return null;
  return vendors[0];
}

function reopensPhrase(npc) {
  const when = openInPhrase(npc);
  return when ? `in ${when}` : 'during business hours';
}

// ── TWO REASONS A SHOP IS SHUT, AND ONLY ONE OF THEM HAS A TIME ──────────────
// `isVendorClosed` folds together the clock (off the timetable) and presence (on
// the timetable, but not behind the counter yet — walking in, stepped out, late).
// Both shut the door; only the first can be answered with a wait.
//
// Quoting one for the second is where "opens again in about 24 hours" came from:
// the shopkeeper's block had already started, so the next START was tomorrow's.
// A player read that as a shop closed round the clock and reported it as such.
// `vendorClosedLine` has refused to quote a time for an absent vendor since it
// was written ("nobody is behind the counter to say a line, and quoting the next
// scheduled block would be a lie if they're merely running late"); the door and
// the closing sweep were the two surfaces that never got the same rule.
//
// Belt and braces with hoursUntilOpen's own 0: this decides WHICH SENTENCE, and
// that stops the number being wrong in the first place.
const shutOnPresenceOnly = (npc) => isVendorAbsent(npc) && !isVendorOffHours(npc);

// ── WHOSE DOOR IS THIS? ──────────────────────────────────────────────────────
// The refusal named the SHOPKEEPER and not the SHOP: "Angus Malcolm opens again in
// about six hours" is a sentence about a stranger unless you already knew what he
// keeps, which is exactly the knowledge a player standing at a locked door does not
// have yet. The building's own name is the fact they can act on — it is on the sign
// they are looking at, it is what they will call the place, and it is what makes the
// line a direction rather than a rebuff.
//
// Nothing is authored for this: `getBuildingName` already walks the parent chain to
// the building root, which is where a shop interior's name lives. A room with no
// building over it (a stall, a room whose parent chain is bare) simply falls back to
// the sentence as it was, so nothing that reads correctly today changes.
const shopPlaceName = (zone) => {
  const name = getBuildingName(zone);
  return name && name !== zone?.name ? name : null;
};

// ── Does this player LIVE here? ───────────────────────────────────────────────
// Coldwater is mixed-use: shops sit on the ground floor of buildings people live in,
// and the closing-time law must never trump the housing one. Someone who owns a unit
// in this building is a resident of it — closing time locks the door to CUSTOMERS,
// not to the person who lives upstairs, and they are never swept out onto the street
// at closing. After hours the building simply belongs to its residents.
//
// Building-level, not unit-level, deliberately: your own front door isn't the only
// room you're entitled to be in at night — the stairwell, the lobby and the corridor
// are the way home.
const livesHere = (player, zone) => isResidentOf(player, getBuildingName(zone));

registerMoveGate(({ player, to }) => {
  const shut = shopClosedFor(to);
  if (!shut) return;
  if (livesHere(player, to)) return;   // you live here; the hours aren't about you
  const place = shopPlaceName(to);
  if (shutOnPresenceOnly(shut)) {
    return { block: true, message: `The door won't give. ${place || 'The shop'} keeps these hours, but ${shut.name} isn't behind the counter yet.` };
  }
  return { block: true, message: `The door won't give — shutters down, lights off. ${shut.name} opens ${place ? `${place} ` : ''}again ${reopensPhrase(shut)}.` };
}, 'commerce:shop-hours');

// The same fact, told BEFORE the step. The gate above owns the refusal and every
// word of its reason; this only says "shut", so the room description can tag the
// door and the minimap can paint the tile. Both read the identical predicate pair
// (shopClosedFor + livesHere), so a surface can never disagree with the door.
//
// Sync and query-free, as the seam requires: shopVendorsFor is a 60s-TTL index over
// the world Maps, and livesHere walks the in-memory apartments Map.
registerShutProvider((player, zone) => {
  const shut = shopClosedFor(zone);
  if (!shut) return null;
  if (livesHere(player, zone)) return null;   // you live here; the hours aren't about you
  return { shut: true, label: 'closed' };
}, 'commerce:shop-hours');

// Closing time: put anyone still inside out the front. Runs on the shared 30s
// cadence (idle-gated by the scheduler), which also self-corrects anyone who got
// inside by a teleport — move gates only see walked steps.
async function closingSweep() {
  for (const player of getAllLivePlayers()) {
    const zone = getZone(player.current_zone);
    const shut = shopClosedFor(zone);
    if (!shut) continue;
    if (livesHere(player, zone)) continue;   // never sweep someone out of their own building

    // Out to the STREET — see streetExitFrom (server/engine/world.js). This used to
    // prefer a non-interior exit and fall back to "any exit at all", which had two
    // teeth: a facade tile counts as non-interior, and a landing on a facade forwards
    // into that building, so closing time could put you inside the shop next door;
    // and the any-exit fallback could shove you into a back office or a walk-in
    // freezer. No street, no sweep: leaving someone inside a closed shop is a
    // nuisance, and dropping them somewhere impossible is a bug report.
    const dest = streetExitFrom(zone.id);
    if (!dest) continue;

    // …and he says the name too, for the same reason: it is the one word that tells a
    // customer standing on the pavement what they will be coming back to.
    const place = shopPlaceName(zone);
    // Presence-only: there is nobody in the room to say a line, so it is narrated
    // rather than quoted — and it quotes no time, for the reason above.
    sendToPlayer(player.id, shutOnPresenceOnly(shut)
      ? { type: 'output', message: `<span class="text-dim">With ${shut.name} out, ${place ? `${place} isn't` : "the shop isn't"} open to browse. You see yourself out.</span>` }
      : formatChitchat(shut.name, `"That's us. Out you go — ${place ? `${place} opens` : 'we open'} again ${reopensPhrase(shut)}."`));
    await dispatchAction({ type: 'TELEPORT', actor: player, params: { zone_id: dest }, context: { broadcast: getBroadcast() } });
    const dz = getZone(dest);
    if (dz) sendToPlayer(player.id, { type: 'move', message: await describeZone(dz, player), zone: dest, minimap: getMinimapData(dest, 8, player) });
    sendToPlayer(player.id, { type: 'output', message: `<span class="text-dim">The door locks behind you.</span>` });
  }
}
schedule('30s', closingSweep);

// ── Self-service: unpaid goods, the counter, and the door ────────────────────
// Some shops let you handle the stock yourself — a cooler on the sales floor
// flagged `vendor_stock: <npcId>`. Pulling from one marks the row
// `custom_data.unpaid` (engine, commands/inventory.js); this is the other half:
// `checkout` settles the mark at the counter, and walking out with it still set
// is shoplifting.

const UNPAID_SQL = `SELECT pi.id, pi.item_id, pi.quantity, pi.custom_data->>'unpaid' AS vendor_id, i.name, i.value
  FROM player_inventory pi JOIN items i ON i.id = pi.item_id
  WHERE pi.player_id = $1 AND jsonb_exists(pi.custom_data, 'unpaid')`;

const carriedUnpaid = async (playerId, vendorId = null) => {
  const { rows } = await query(UNPAID_SQL, [playerId]);
  return vendorId ? rows.filter(r => r.vendor_id === vendorId) : rows;
};

// Which zones count as "inside the shop" — the vendor's work zone plus every
// interior room behind it (stockroom, cold store), so stepping into the back
// isn't walking out. Zone id → owning vendor id, rebuilt on the same 60s TTL as
// the shop-hours index and read from the world Maps, never a query.
let _shopZoneIdx = null, _shopZoneIdxAt = 0;
function shopZoneOwner(zoneId) {
  if (!zoneId) return null;
  if (!_shopZoneIdx || Date.now() - _shopZoneIdxAt > SHOP_IDX_TTL) {
    _shopZoneIdx = new Map();
    for (const n of world.npcs.values()) {
      if (n?.work_zone_id && n.vendor_inventory?.length) _shopZoneIdx.set(n.work_zone_id, n.id);
    }
    // Walk each interior room's parent chain up to a shop floor (depth-capped —
    // a malformed parent loop must not hang the move path).
    for (const z of world.zones.values()) {
      if (!z?.flags?.is_interior || _shopZoneIdx.has(z.id)) continue;
      let p = z.parent_zone;
      for (let i = 0; i < 6 && p; i++) {
        const owner = _shopZoneIdx.get(p);
        if (owner) { _shopZoneIdx.set(z.id, owner); break; }
        p = world.zones.get(p)?.parent_zone;
      }
    }
    _shopZoneIdxAt = Date.now();
  }
  return _shopZoneIdx.get(zoneId) || null;
}

// Price the vendor would charge for one unit right now — the same catalogue
// price + ideology discount buyFromVendor applies, so paying at the counter and
// buying over it never disagree.
function unpaidPrice(vendor, row, discount) {
  const entry = (vendor.vendor_inventory || []).find(e => e.item_id === row.item_id);
  const base = entry?.price ?? row.value ?? 0;
  return Math.max(1, Math.round(base * (1 - discount))) * (row.quantity || 1);
}

async function cmdCheckout(player) {
  const unpaid = await carriedUnpaid(player.id);
  if (!unpaid.length) return { type:'error', message:"You've nothing to pay for." };

  // The counter is the till: furniture in this room flagged `checkout: <npcId>`.
  const { rows: counters } = await query(
    `SELECT id, name, flags->>'checkout' AS vendor_id FROM furniture WHERE zone_id=$1 AND jsonb_exists(flags,'checkout')`,
    [player.current_zone]
  );

  // Failing that, the person is the till. You should be able to hand a shopkeeper
  // money while standing in front of them, and a counter is furniture that may not
  // exist (a stall, a market barrow) or may not be the room you cornered them in.
  // Only a vendor who is owed something here counts, so this can't turn a passing
  // NPC into somebody else's cashier.
  const zoneNpcs = counters.length ? [] : getZoneNpcs(player.current_zone)
    .filter(n => unpaid.some(u => u.vendor_id === n.id));
  if (!counters.length && !zoneNpcs.length) {
    return { type:'error', message:'There\'s nobody here to pay, and no counter to pay at. Take it to the till.' };
  }

  const counter = counters.length
    ? (counters.find(c => unpaid.some(u => u.vendor_id === c.vendor_id)) || counters[0])
    : { name: zoneNpcs[0].name, vendor_id: zoneNpcs[0].id, _isPerson: true };
  const vendor = world.npcs.get(counter.vendor_id);
  if (!vendor) return { type:'error', message:`Nobody's working the ${counter.name}.` };
  if (isVendorClosed(vendor)) return { type:'error', message: vendorClosedLine(vendor) };
  const grudge = await vendorGrudgeRemaining(player.id, vendor.id);
  if (grudge > 0) return { type:'error', message: grudgeRefusal(vendor, grudge) };

  const mine = unpaid.filter(u => u.vendor_id === vendor.id);
  if (!mine.length) return { type:'error', message:`Nothing you're carrying is ${vendor.name}'s to sell.` };

  const discount = vendor.faction ? await getIdeologyDiscount(player.id, vendor.faction) : 0;
  const priced = mine.map(r => ({ ...r, price: unpaidPrice(vendor, r, discount) }));
  const total = priced.reduce((s, r) => s + r.price, 0);

  // Debit, clear the marks and pay the till as one unit — a failure between them
  // must not take credits and leave the goods still flagged stolen.
  const paid = await withTransaction(async (q) => {
    if (!await adjustCredits(player, -total, q, 'vendor:checkout')) return false;
    await q(`UPDATE player_inventory SET custom_data = custom_data - 'unpaid' WHERE id = ANY($1::text[])`, [priced.map(r => r.id)]);
    const { rows: vc } = await q('UPDATE npcs SET vendor_credits = vendor_credits + $1 WHERE id = $2 RETURNING vendor_credits', [total, vendor.id]);
    if (vc.length) syncNpc(vendor.id, { vendor_credits: vc[0].vendor_credits });
    return true;
  });
  if (!paid) {
    return { type:'error', message:`That comes to ${total}₵ and you have ${player.credits || 0}₵. ${vendor.name} waits, unimpressed.` };
  }

  // Same seam a shelf purchase fires, one event per line — anything watching what
  // players buy (heat on bulk reagents, gossip) sees a self-serve run identically.
  for (const r of priced) {
    emit('vendor.purchase', {
      player: { id: player.id, handle: player.handle }, npcId: vendor.id, itemId: r.item_id,
      tags: getItem(r.item_id)?.tags || {}, quantity: r.quantity || 1, price: r.price, zoneId: player.current_zone,
    });
  }

  const lines = priced.map(r => `  ${r.quantity > 1 ? `${r.quantity}x ` : ''}${r.name} — ${r.price}₵`).join('\n');
  return {
    type: 'buy',
    message: `${vendor.name} ${counter._isPerson ? 'takes the lot off you and totals it up' : `rings you up at the ${counter.name}`}.\n${lines}\n<b>Total: ${total}₵</b>`,
    player_update: { credits: player.credits },
  };
}

// ── The door asks first ──────────────────────────────────────────────────────
// Nobody shoplifts by accident. Stepping out of a shop still holding unpaid
// goods stops you ONCE, names what you're carrying and what it comes to, and
// asks: `yes` settles at the counter and walks you out, `no` walks you out
// anyway. Taking the same step again is `no` by another name — the warning is
// spent, not a wall.
//
// The prompt is armed by a move gate but charges nothing: the crime still fires
// on the committed step (zone.entered, below), because a gate can be vetoed
// downstream and a theft charged for a step that never happened is a phantom.
// Being asked plainly and walking anyway is what makes shoplifting a deliberate
// 3-star act rather than the 1-star slip it used to be.
const DOOR_TTL_MS = 120_000;
const doorPrompt = new Map(); // playerId → { owner, direction, expires, settleAction, label }

export function armDoorPrompt(player, prompt) {
  doorPrompt.set(player.id, { ...prompt, expires: Date.now() + DOOR_TTL_MS });
}
const liveDoorPrompt = (playerId) => {
  const p = doorPrompt.get(playerId);
  if (!p) return null;
  if (p.expires <= Date.now()) { doorPrompt.delete(playerId); return null; }
  return p;
};
on('player.logout', ({ id }) => doorPrompt.delete(id));

// Armed from another plugin's door (storefront's player-owned shops use the same
// prompt with its own settle action) — the cross-plugin seam, so there is exactly
// one yes/no at exactly one door.
// Answers `armed: false` when this player has already been asked about this same
// door — that is the caller's signal to let the step through rather than block
// it again, so one warning stays one warning.
registerAction({
  type: 'commerce.arm_door_prompt',
  handler: ({ actor, params }) => {
    if (liveDoorPrompt(actor.id)?.owner === params.owner) return { type: 'noop', armed: false };
    armDoorPrompt(actor, params);
    return { type: 'noop', armed: true };
  },
});

// Spent the moment the step it was asking about is taken — a `yes` answered after
// you're already out on the street must never quietly walk you somewhere.
registerAction({
  type: 'commerce.clear_door_prompt',
  handler: ({ actor }) => { doorPrompt.delete(actor.id); return { type: 'noop' }; },
});

// Settling a vendor's unpaid goods on the way out: the counter if you can reach
// one, and if you simply haven't got the money, the goods go back on the shelf
// rather than stranding you in the shop. Either way you leave clean.
registerAction({
  type: 'commerce.settle_unpaid',
  handler: async ({ actor }) => {
    const paid = await cmdCheckout(actor);
    if (paid.type !== 'error') return paid;
    const lifted = await carriedUnpaid(actor.id);
    if (!lifted.length) return paid;
    // Back on the shelf it came off, if the shelf is in this room — the same
    // put-back the engine does for `put <thing> in <cooler>`. No cooler here
    // (you're at the door of a back room, or it was a barrow) and the goods
    // simply revert to the vendor's stock.
    const { rows: shelves } = await query(
      `SELECT id FROM furniture WHERE zone_id=$1 AND flags->>'vendor_stock' IS NOT NULL LIMIT 1`, [actor.current_zone]);
    if (shelves.length) {
      await query(`UPDATE player_inventory SET container_id=$1, is_equipped=0, slot=NULL, custom_data = custom_data - 'unpaid'
                    WHERE id = ANY($2::text[])`, [shelves[0].id, lifted.map(r => r.id)]);
    } else {
      await query(`DELETE FROM player_inventory WHERE id = ANY($1::text[])`, [lifted.map(r => r.id)]);
    }
    return { type: 'output', message:
      `<span class="text-dim">You can't cover it. You put ${lifted.map(r => r.name).join(', ')} back where you found ${lifted.length > 1 ? 'them' : 'it'} and walk out with empty hands.</span>` };
  },
});

registerMoveGate(async ({ player, from, to, direction }) => {
  const owner = shopZoneOwner(from?.id);
  if (!owner || shopZoneOwner(to?.id) === owner) return;   // not leaving a shop
  const warned = liveDoorPrompt(player.id);
  if (warned?.owner === owner) return;                     // already asked; this is the answer

  const lifted = await carriedUnpaid(player.id, owner);
  if (!lifted.length) return;

  const vendor = world.npcs.get(owner);
  const discount = vendor?.faction ? await getIdeologyDiscount(player.id, vendor.faction) : 0;
  const total = vendor ? lifted.reduce((s, r) => s + unpaidPrice(vendor, r, discount), 0) : 0;
  const names = lifted.map(r => `${r.quantity > 1 ? `${r.quantity}x ` : ''}${r.name}`).join(', ');
  armDoorPrompt(player, { owner, direction, settleAction: 'commerce.settle_unpaid' });
  return { block: true, message:
    `You're at the door still holding <b>${names}</b>${total ? `, ${total}₵ unpaid` : ', unpaid'}.\n` +
    `<span class="text-dim">Pay for ${lifted.length > 1 ? 'them' : 'it'}? <b>yes</b> to settle up and go, <b>no</b> to walk out with ${lifted.length > 1 ? 'them' : 'it'}.</span>` };
}, 'commerce:unpaid-door');

const walkOut = (player, direction) => dispatchAction({
  type: 'MOVE', actor: player, params: { direction }, context: { broadcast: getBroadcast() },
});

async function cmdDoorAnswer(player, pay) {
  const p = liveDoorPrompt(player.id);
  if (!p) return { type: 'error', message: 'Nothing is waiting on an answer.' };
  if (!pay) return walkOut(player, p.direction);   // the prompt stays armed — the gate reads it and lets you through

  doorPrompt.delete(player.id);
  // Whoever armed the prompt owns settling it — a vendor's counter and a player
  // shop's till take money in quite different ways.
  const settled = await dispatchAction({
    type: p.settleAction || 'commerce.settle_unpaid', actor: player, params: {},
    context: { broadcast: getBroadcast() },
  });
  if (settled?.message) {
    sendToPlayer(player.id, { type: settled.type === 'error' ? 'output' : settled.type, message: settled.message, player_update: settled.player_update });
  }
  return walkOut(player, p.direction);
}

// What a robbed shopkeeper shouts at your back. Deliberately plain, and every
// line NAMES you: the street hearing which door it came out of is half the point,
// hearing WHO it came out after is the other half. Anyone within earshot gets your
// handle whether or not the witness roll ever charges you.
const SHOPLIFT_YELLS = [
  (h) => `Hey! HEY! ${h}! Put that back!`,
  (h) => `${h}, you little rat, that's MY stock!`,
  (h) => `Thief! Somebody stop ${h}!`,
  (h) => `I know your name, ${h}! ${h}!`,
  (h) => `That's coming out of my till, ${h}, you piece of filth!`,
  (h) => `Don't you ever come back in here, ${h}!`,
  (h) => `Somebody grab ${h}! They just walked out with my stock!`,
];

// Walking out with the mark still on it. Fires on the committed step (not a move
// gate — a gate can still be vetoed downstream, and charging for a step that
// never happened would be a phantom crime). Costs nothing on a normal move: the
// `from` zone lookup is an in-memory Map hit, and only leaving a shop building
// with somewhere else to be reaches the query.
on('zone.entered', async ({ actor: player, zone, from }) => {
  if (!player?.id || !from) return;
  doorPrompt.delete(player.id);   // the step it was about has been taken
  const shopOwner = shopZoneOwner(from);
  if (!shopOwner || shopZoneOwner(zone) === shopOwner) return; // still inside

  const lifted = await carriedUnpaid(player.id, shopOwner);
  if (!lifted.length) return;

  // Out the door, it's theirs no longer — clear the mark either way. Whether the
  // clerk or the ceiling camera actually made you is surveillance's witness roll;
  // it's charged at the SHOP's zone, where the witnesses are.
  await query(`UPDATE player_inventory SET custom_data = custom_data - 'unpaid' WHERE id = ANY($1::text[])`, [lifted.map(r => r.id)]);
  const vendor = world.npcs.get(shopOwner);
  sendToPlayer(player.id, { type:'output', message:
    `<span class="msg-danger">You walk out with ${lifted.map(r => r.name).join(', ')} unpaid for.${vendor ? ` Behind you, ${vendor.name} looks up.` : ''}</span>` });
  emit('shoplifting.caught', { player: { id: player.id, handle: player.handle }, zoneId: from });
  if (vendor) {
    holdVendorGrudge(player, vendor.id).catch(() => {});
    // The shout is thrown from INSIDE the shop, at the shop's zone, so it travels
    // the ordinary sound graph: the street tile you just stepped onto hears it
    // ("Nearby, ..."), a shut door behind you muffles it, and anyone else within
    // earshot hears it too. It is flavour in the strict sense — the charge is the
    // witness roll's business and fired above regardless of who heard this.
    const yell = SHOPLIFT_YELLS[Math.floor(Math.random() * SHOPLIFT_YELLS.length)](player.handle);
    propagateSound(from, `${vendor.name} yells: "${yell}"`, 8, getBroadcast());
  }
});

export const commands = {
  // `shop text <npc>` — leading keyword, the `tablet verbs` shape. Stripped here
  // rather than inside cmdShop so SIFT never sees it as part of the vendor's name.
  shop:   (args, raw, player) => {
    const text = (args[0] || '').toLowerCase() === 'text';
    return cmdShop((text ? args.slice(1) : args).join(' '), player, text);
  },
  browse:  (args, raw, player) => cmdShop(args.join(' '), player),
  buy:     (args, raw, player) => cmdBuy(args, player),
  sell:    (args, raw, player) => cmdSell(args, player),
  balance: (args, raw, player) => cmdBalance(player),
  checkout: (args, raw, player) => cmdCheckout(player),
  // Only ever meaningful with the door prompt armed; otherwise they say so.
  yes:     (args, raw, player) => cmdDoorAnswer(player, true),
  no:      (args, raw, player) => cmdDoorAnswer(player, false),
};

// Examining the counter offers Checkout — the verb is the counter's affordance,
// so it's discoverable without having to already know the word.
export const specializedActions = [
  { verb: 'checkout', requiredTag: 'checkout', handler: (args, raw, player) => cmdCheckout(player) },
];

console.log('[commerce] Plugin loaded.');
