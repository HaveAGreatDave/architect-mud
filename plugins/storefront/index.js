/**
 * storefront plugin — player-owned shops.
 *
 * A vacant unit is CONTENT: a zone carrying `flags.is_storefront` plus the terms
 * of the sale (`shop_price`, `shop_term`, `shop_upkeep`). Who holds the deed is
 * PLAYER DATA in the `storefronts` table — the same split as apartments, and for
 * the same reason (a deed must never round-trip through git).
 *
 * The arc:
 *   DEED       — read the board outside: asking price, instalment, term.
 *   BUYSHOP    — take on the mortgage. First instalment down, the keys are yours.
 *   RENAMESHOP — put your own name over the door.
 *   STOCK      — put something from your pack on the display, at your price.
 *   WARES/BUY  — anyone in the room buys off the display, online or not.
 *   TILL       — the takings sit in the shop's vault until you collect them.
 *   SELLSHOP   — walk away. No refund; this is not that kind of town.
 *
 * Payments run on the GAME calendar every RENT_PERIOD_DAYS, drafted from the till
 * first (a shop that trades pays for itself), then the bank, then your pocket.
 * Clear the term and the place is yours outright — only the smaller upkeep after
 * that, so an abandoned shop still eventually lapses instead of squatting a tile
 * forever. Miss two in a row and the lender repossesses, stock and all.
 *
 * Listed stock is NOT a table of its own. It stays as real `player_inventory`
 * rows re-owned by the synthetic handle `_shopstock_<zoneId>` (the same trick as
 * `_ground_<zone>`), so a cooked steak's quality, a weapon's condition and every
 * other custom_data instance key survive a trip across the counter. Nothing else
 * in the game can reach that owner id, so the shelf can't be looted — only bought.
 *
 * The vault is furniture flagged `shop_vault` and is crackable by anyone via the
 * same VAULT CRACK minigame vendor safes use. Leaving the takings in the till is
 * a real risk; that's the point.
 *
 * Risk and counterplay, in the order they were built:
 *   SHUTTERS  — a real door on the facade↔interior link carrying a `lock:shopshutter`
 *               tag, so the engine's lock/hack/bash/burglary machinery all apply for
 *               free. Closed shutters keep people off your vault; the deed holds the
 *               durable state and re-applies it at boot (door state is runtime-only).
 *   POCKET    — lifting off the display. Works like a vendor's self-service cooler:
 *               the goods leave marked, and walking out of the shop with the mark
 *               still on them is `shoplifting` (charged only if witnessed) — except
 *               the proprietor is ALWAYS pinged, because it's a player's property.
 *   HIRE      — a clerk or a guard. Deliberately NOT `npcs` rows: hiring is a player
 *               action, and `npcs`/`npc_residences` are CONTENT-class tables, so a
 *               hired NPC would put player-driven rows into the git content tree on
 *               the next export. Staff are a `storefront_staff` row plus presence in
 *               the room prose, and what they buy you is odds: a guard forces a
 *               witness on a lift or a crack, a clerk banks the till so there's less
 *               in it to steal. Wages come out of the till on the billing tick.
 *   FOOTFALL  — passing trade. NPCs occasionally buy off a stocked shelf, so a shop
 *               earns while its owner is logged off.
 *   BUYORDER  — standing offers to buy, funded from the till, so people can sell
 *               INTO the shop when nobody's home.
 */
import { randomUUID } from 'crypto';
import { textRender } from '../../server/engine/minigame.js';
import { query, withTransaction } from '../../server/models/db.js';
import { getZone, world, getLivePlayer, setDoorCache, getZoneFurniture } from '../../server/engine/world.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { getItem } from '../../server/engine/items-cache.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { on, emit } from '../../server/engine/events.js';
import { fireHook } from '../../server/engine/plugins.js';
import { sectionize } from '../../server/engine/classify.js';
import { effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { hackDifficulty, breachMargin, hasHackDeck, damageHackDeck } from '../../server/engine/hack-gear.js';
import { getBroadcast, sendToPlayer } from '../../server/engine/messaging.js';
import { registerLockType } from '../../server/engine/locks.js';
import { exitTargets } from '../../server/engine/exits.js';
import { schedule } from '../../server/engine/scheduler.js';
import { RENT_PERIOD_DAYS, gameToday, addGameDays, gameDaysBetween, ymd, MONTHS } from '../../server/engine/apartments.js';
import { registerOwnedZoneProvider } from '../../server/engine/zone-filth.js';

// ── Terms ────────────────────────────────────────────────────────────────────
const DEFAULT_PRICE = 6000;    // asking price when the zone doesn't name one
const DEFAULT_TERM = 8;        // instalments to clear the mortgage
const DEFAULT_UPKEEP = 40;     // per cycle once it's yours outright (rates, power, protection)
const MAX_MISSED = 2;          // consecutive misses before the lender takes it back
const MAX_LISTINGS = 20;       // display capacity, per shop
const VAULT_LOCKOUT_MS = 5 * 60 * 1000;
const VAULT_PENDING_TTL_MS = 180 * 1000;

const stockOwner = zoneId => `_shopstock_${zoneId}`;
const isStorefrontZone = zone => !!zone?.flags?.is_storefront;

// AUTHORED terms — content, read off the zone so they return identically after
// any rebuild. Mirrors authoredRentCost() in apartments.js.
export function authoredTerms(zone) {
  const f = zone?.flags || {};
  const price = (typeof f.shop_price === 'number' && f.shop_price > 0) ? f.shop_price : DEFAULT_PRICE;
  const term = (typeof f.shop_term === 'number' && f.shop_term > 0) ? Math.round(f.shop_term) : DEFAULT_TERM;
  const upkeep = (typeof f.shop_upkeep === 'number' && f.shop_upkeep >= 0) ? f.shop_upkeep : DEFAULT_UPKEEP;
  return { price, term, upkeep, weekly: Math.max(1, Math.ceil(price / term)) };
}

function formatGameDate(ymdStr) {
  if (!ymdStr) return '—';
  const d = new Date(`${ymdStr}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ── Deed cache ───────────────────────────────────────────────────────────────
// A handful of rows, read on every room description of a shop — held in RAM and
// written through, never queried on a look. Loaded lazily on first touch so the
// plugin doesn't care whether it imported before or after the DB was ready.
const deeds = new Map(); // zoneId -> storefronts row
let loaded = false;
async function loadDeeds() {
  if (loaded) return;
  loaded = true;
  try {
    const { rows } = await query('SELECT * FROM storefronts');
    for (const r of rows) deeds.set(r.zone_id, r);
    if (rows.length) console.log(`[storefront] ${rows.length} deed(s) loaded`);
  } catch (e) {
    loaded = false; // table not applied yet — retry on the next touch
    console.warn('[storefront] deed load failed (has db:schema been run?):', e.message);
  }
}
loadDeeds();

export function getDeed(zoneId) { return deeds.get(zoneId) || null; }

// A shop with an owner is that player's space, so it keeps its filth for a rent
// cycle like an apartment does rather than being swept nightly with the street.
// The engine can't import a plugin, so ownership is contributed, not assumed —
// sync and query-free, straight off the deed cache above.
// Returns the owner's id rather than a bare true, so the same seam also answers
// "owned by WHOM" for owner-gated affordances.
registerOwnedZoneProvider((zoneId) => deeds.get(zoneId)?.owner_id || null);

function setDeed(zoneId, row) { if (row) deeds.set(zoneId, row); else deeds.delete(zoneId); }

// Can this player act as the shop's owner? Deliberately not the apartments
// corp-HQ shape: a shop deed is personal. Corps get their own path or none.
export function ownsShop(player, deed) {
  return !!deed?.owner_id && deed.owner_id === player?.id;
}

// The shop the player is standing in, with its zone and deed — the preamble
// every verb below needs. Returns { error } instead of throwing.
async function here(player, { needOwner = false, needSold = false } = {}) {
  await loadDeeds();
  const zone = getZone(player.current_zone);
  if (!isStorefrontZone(zone)) return { error: 'There is no shop unit here.' };
  const deed = getDeed(zone.id);
  if (needSold && !deed?.owner_id) return { error: "Nobody owns this unit yet. Try DEED to see the asking price." };
  if (needOwner && !ownsShop(player, deed)) {
    return { error: deed?.owner_id ? `This is ${deed.owner_handle}'s shop, not yours.` : "You don't own this place." };
  }
  return { zone, deed };
}

export function shopDisplayName(zone, deed) {
  return deed?.shop_name || zone?.flags?.building_name || zone?.name || 'the unit';
}

// ── Listings ─────────────────────────────────────────────────────────────────
// Real inventory rows parked under the shop's synthetic owner. `list_price` on
// custom_data is the asking price; it also makes the row instanced, which keeps
// it from ever stack-merging into a buyer's identical item on the way out.
async function listingsFor(zoneId) {
  const { rows } = await query(
    `SELECT pi.id, pi.item_id, pi.quantity, pi.condition, pi.custom_data,
            (pi.custom_data->>'list_price')::int AS price, i.name, i.description, i.tags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1
      ORDER BY i.name`,
    [stockOwner(zoneId)],
  );
  return rows;
}

// ── DEED — read the board ────────────────────────────────────────────────────
async function cmdDeed(player) {
  const h = await here(player);
  if (h.error) return { type: 'error', message: h.error };
  const { zone, deed } = h;
  const t = authoredTerms(zone);

  if (!deed?.owner_id) {
    return { type: 'output', message:
      `<span style="color:var(--accent)">◈ UNIT FOR SALE — ${zone.name}</span>\n` +
      `<span class="text-dim">Asking price:</span> <span style="color:var(--yellow)">${t.price}₵</span>\n` +
      `<span class="text-dim">Instalment:</span> <span style="color:var(--yellow)">${t.weekly}₵</span> per ${RENT_PERIOD_DAYS}-day cycle × ${t.term}\n` +
      `<span class="text-dim">Upkeep once cleared:</span> ${t.upkeep}₵ per cycle\n\n` +
      `First instalment down and the keys are yours. Miss ${MAX_MISSED} in a row and the lender takes it back — stock included.\n` +
      `(<span class="action-link" data-raw-cmd="buyshop" title="Take on the mortgage">BUYSHOP</span> to sign)` };
  }

  const owned = ownsShop(player, deed);
  const left = Math.max(0, deed.payments_total - deed.payments_made);
  const lines = [
    `<span style="color:var(--accent)">◈ ${shopDisplayName(zone, deed)}</span>`,
    `<span class="text-dim">Proprietor:</span> ${deed.owner_handle}`,
  ];
  if (deed.paid_off) {
    lines.push(`<span class="text-dim">Mortgage:</span> <span style="color:var(--accent)">CLEARED</span> — owned outright.`);
    lines.push(`<span class="text-dim">Upkeep:</span> <span style="color:var(--yellow)">${deed.upkeep}₵</span> per cycle, due ${formatGameDate(ymd(deed.due_date))}`);
  } else {
    lines.push(`<span class="text-dim">Mortgage:</span> ${deed.payments_made}/${deed.payments_total} paid — ${left} instalment${left === 1 ? '' : 's'} to go`);
    lines.push(`<span class="text-dim">Next:</span> <span style="color:var(--yellow)">${deed.weekly_payment}₵</span> due ${formatGameDate(ymd(deed.due_date))}`);
  }
  if (deed.missed > 0) {
    lines.push(`<span style="color:var(--red)">⚠ ${deed.missed} missed payment${deed.missed === 1 ? '' : 's'} — ${MAX_MISSED - deed.missed} from repossession.</span>`);
  }
  if (owned) {
    lines.push(`<span class="text-dim">Till:</span> ${deed.till_credits}₵ waiting in the vault. (TILL to collect)`);
    const roster = await staffFor(zone.id);
    lines.push(`<span class="text-dim">Payroll:</span> ${roster.length
      ? `${roster.map(m => `${m.name} (${m.role}, ${m.wage}₵)`).join(', ')}`
      : 'nobody. (HIRE CLERK · HIRE GUARD)'}`);
    lines.push(`<span class="text-dim">Shutter:</span> ${deed.shutters_closed ? 'down — shut' : 'up — open'} (SHUTTERS to work it)`);
    // Cameras are the surveillance plugin's, not ours, and they already charge
    // anyone who cracks the vault. Say so here, because otherwise nobody finds out.
    const { rows: cams } = await query(
      `SELECT 1 FROM furniture WHERE zone_id=$1 AND flags @> '{"security_device":true}' LIMIT 1`, [zone.id]);
    lines.push(`<span class="text-dim">Cameras:</span> ${cams.length
      ? 'covered.'
      : 'none. <span class="text-dim">A planted camera makes a break-in chargeable — PLANT one.</span>'}`);
  }
  return { type: 'output', message: lines.join('\n') };
}

// ── BUYSHOP — sign the mortgage ──────────────────────────────────────────────
async function cmdBuyShop(player) {
  const h = await here(player);
  if (h.error) return { type: 'error', message: h.error };
  const { zone, deed } = h;
  if (deed?.owner_id) {
    return { type: 'error', message: ownsShop(player, deed)
      ? 'You already hold the deed here.'
      : `${deed.owner_handle} already holds the deed to this place.` };
  }

  const t = authoredTerms(zone);
  if (!(await adjustCredits(player, -t.weekly, undefined, 'storefront:deposit'))) {
    return { type: 'error', message: `The first instalment is ${t.weekly}₵ and you have ${player.credits || 0}₵. The agent shows you the door.` };
  }

  const now = Math.floor(Date.now() / 1000);
  const today = gameToday();
  const due = today ? addGameDays(today, RENT_PERIOD_DAYS) : null;
  // One instalment counts as paid the moment it's handed over — a term of 8 means
  // 8 payments total, of which this is the first.
  const { rows } = await query(
    `INSERT INTO storefronts (zone_id, owner_id, owner_handle, shop_name, purchased_at, price,
                              weekly_payment, payments_made, payments_total, upkeep, paid_off, missed, due_date, till_credits)
     VALUES ($1,$2,$3,NULL,$4,$5,$6,1,$7,$8,$9,0,$10,0)
     ON CONFLICT (zone_id) DO UPDATE SET owner_id=$2, owner_handle=$3, shop_name=NULL, purchased_at=$4,
       price=$5, weekly_payment=$6, payments_made=1, payments_total=$7, upkeep=$8,
       paid_off=$9, missed=0, due_date=$10, till_credits=0
     RETURNING *`,
    [zone.id, player.id, player.handle, now, t.price, t.weekly, t.term, t.upkeep,
     t.term <= 1 ? 1 : 0, due],
  );
  setDeed(zone.id, rows[0]);
  emit('storefront.bought', { player: { id: player.id, handle: player.handle }, zoneId: zone.id });

  return { type: 'output', player_update: { credits: player.credits }, message:
    `<span style="color:var(--accent)">◈ DEED TRANSFERRED — ${zone.name}</span>\n\n` +
    `The agent thumbs a slate, the lock re-keys to you, and that is the whole ceremony.\n\n` +
    `<span class="text-dim">Paid down:</span> ${t.weekly}₵\n` +
    `<span class="text-dim">Remaining:</span> ${t.term - 1} × ${t.weekly}₵ per ${RENT_PERIOD_DAYS}-day cycle\n` +
    `<span class="text-dim">Next due:</span> ${formatGameDate(due)}\n\n` +
    `<span class="text-dim">RENAMESHOP &lt;name&gt;</span> to put your own name up. ` +
    `<span class="text-dim">STOCK &lt;item&gt; FOR &lt;price&gt;</span> to put something on the display. ` +
    `<span class="text-dim">TILL</span> collects your takings.` };
}

// ── RENAMESHOP ───────────────────────────────────────────────────────────────
// The name lives on the DEED, not the zone: zones are content, and writing a
// player's shop name into one would drift git against prod on the next export.
// The room description and the wares board read it off the deed instead.
async function cmdRenameShop(args, player) {
  const h = await here(player, { needOwner: true, needSold: true });
  if (h.error) return { type: 'error', message: h.error };
  const name = args.join(' ').replace(/[<>]/g, '').trim().slice(0, 48);
  if (!name) return { type: 'error', message: 'Call it what? (renameshop <name>)' };

  await query('UPDATE storefronts SET shop_name=$1 WHERE zone_id=$2', [name, h.zone.id]);
  setDeed(h.zone.id, { ...h.deed, shop_name: name });
  const bc = getBroadcast();
  if (bc) bc(h.zone.id, { type: 'zone_event', message: `<span class="text-dim">The sign over the counter flickers, resets, and settles on <b>${name}</b>.</span>` }, player.id);
  return { type: 'output', message: `You reprogram the sign. It reads <span style="color:var(--accent)">${name}</span> now.` };
}

// ── STOCK / UNSTOCK ──────────────────────────────────────────────────────────
async function cmdStock(args, player) {
  const h = await here(player, { needOwner: true, needSold: true });
  if (h.error) return { type: 'error', message: h.error };

  // "stock the knife for 40" / "stock knife 40" — trailing number is the price.
  const raw = args.join(' ').trim();
  if (!raw) return { type: 'error', message: 'Stock what, and for how much? (stock <item> for <price>)' };
  // "…for 40 in the cooler" — perishable goods left on an open shelf go off, so
  // a shop that sells food needs somewhere cold to put it. The trailing
  // container is optional and only means anything for something that spoils.
  const m = raw.match(/^(.*?)(?:\s+for)?\s+(\d+)(?:\s+in\s+(.+))?$/i);
  if (!m) return { type: 'error', message: 'Name a price. (stock <item> for <price> [in <cooler>])' };
  const itemName = m[1].trim();
  const price = parseInt(m[2], 10);
  const coolerName = (m[3] || '').trim();
  if (!itemName) return { type: 'error', message: 'Stock what? (stock <item> for <price>)' };
  if (!(price > 0)) return { type: 'error', message: "You can't display something for nothing. Name a real price." };

  const existing = await listingsFor(h.zone.id);
  if (existing.length >= MAX_LISTINGS) {
    return { type: 'error', message: `The display is full (${MAX_LISTINGS} lines). Take something down first.` };
  }

  const row = await resolveInventoryItem(player, { name: itemName, topLevel: true, equipped: false });
  if (!row) return { type: 'error', message: `You aren't carrying "${itemName}".` };
  if (row.tags?.quest_item) return { type: 'error', message: `The ${row.name} isn't yours to sell.` };

  // A cold display, if one was named and the room has it. Anything perishable
  // left out will go off exactly as it would in your pack — the preservation
  // system reads the container off the row and doesn't care who owns it.
  let cooler = null;
  if (coolerName) {
    cooler = getZoneFurniture(h.zone.id).find(f =>
      f.name.toLowerCase().includes(coolerName.toLowerCase()) && (f.flags?.preserves || f.flags?.container));
    if (!cooler) return { type: 'error', message: `There's no "${coolerName}" here to put it in.` };
    if (!cooler.flags?.preserves) {
      return { type: 'error', message: `The ${cooler.name} won't keep anything cold. It's just furniture.` };
    }
  }

  // Re-own the whole row to the shop and stamp the asking price. The row keeps
  // its condition and custom_data, so what the buyer gets is this exact item.
  await query(
    `UPDATE player_inventory
        SET player_id=$1, is_equipped=0, slot=NULL, layer=NULL, container_id=$4,
            custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('list_price', $2::int)
      WHERE id=$3`,
    [stockOwner(h.zone.id), price, row.inv_id, cooler?.id || null],
  );

  const chilled = cooler ? ` in the ${cooler.name}` : '';
  const warning = !cooler && row.tags?.perishable
    ? `\n<span class="text-dim">It's out in the open. It will go off.</span>` : '';
  const qty = row.quantity > 1 ? ` (x${row.quantity})` : '';
  const bc = getBroadcast();
  if (bc) bc(h.zone.id, { type: 'zone_event', message: `${player.handle} sets ${row.name}${qty} out on the display.` }, player.id);
  return { type: 'output', message: `You set <b>${row.name}</b>${qty} on the display${chilled} at <span style="color:var(--yellow)">${price}₵</span>.${warning}` };
}

async function cmdUnstock(args, player) {
  const h = await here(player, { needOwner: true, needSold: true });
  if (h.error) return { type: 'error', message: h.error };
  const name = args.join(' ').trim();
  if (!name) return { type: 'error', message: 'Take what off the display? (unstock <item>)' };

  const listings = await listingsFor(h.zone.id);
  if (!listings.length) return { type: 'error', message: 'The display is empty.' };
  const r = siftResolve(name, listings);
  if (r.type === 'none') return { type: 'error', message: `Nothing on the display matches "${name}".` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { dispatchType: 'storefront.unstock', dispatchParam: 'target' });
    return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  return takeBackListing(r.candidate, player);
}

async function takeBackListing(listing, player) {
  await query(
    `UPDATE player_inventory
        SET player_id=$1, custom_data = custom_data - 'list_price'
      WHERE id=$2`,
    [player.id, listing.id],
  );
  return { type: 'output', message: `You take <b>${listing.name}</b> back off the display.` };
}

// ── WARES — the board anyone can read ────────────────────────────────────────
function waresBoard(zone, deed, listings) {
  const title = shopDisplayName(zone, deed);
  if (!listings.length) return `<span style="color:var(--accent)">${title}</span>\n<span class="text-dim">The display is bare.</span>`;
  const renderLine = (l) => {
    const cd = l.custom_data || {};
    // What the buyer is actually looking at: a plated meal carries its own name
    // ("beef and potato stew") and the band it was cooked to. Listing every one
    // as "plated dish" would hide the entire quality system at the only moment
    // it decides whether the price is fair.
    const shown = cd.name || l.name;
    const band = cd.cook_quality ? ` <span class="text-dim">(${cd.cook_quality})</span>` : '';
    const state = l.freshness ? ` <span class="text-dim">— ${l.freshness}</span>` : '';
    return `  <span class="action-link" data-raw-cmd="buyware ${shown}" title="Buy ${shown}">${shown}</span>${band}` +
      `${l.quantity > 1 ? ` <span class="text-dim">x${l.quantity}</span>` : ''}` +
      ` — <span style="color:var(--yellow)">${l.price}₵</span>${state}`;
  };
  // Same sectioning rule as an NPC vendor's shelf (server/engine/classify.js), so a
  // player shop that grows into a real grocery reads like one. A player has no
  // authored axis to override with — the stock they chose to put out IS the
  // configuration, which is rather the point of the whole approach. A small or
  // uniform display stays a flat list.
  const lines = sectionize(listings, { itemOf: (l) => ({ tags: l.tags }) })
    .flatMap(s => (s.group ? [`<span class="text-dim">${s.group}</span>`] : []).concat(s.items.map(renderLine)));
  return `<span style="color:var(--accent)">${title}</span>\n${lines.join('\n')}`;
}

// Anything perishable on the display gets its freshness resolved for the board.
// Lazy, like everywhere else — nothing is written, the state is derived from the
// row's own checkpoint and where it's sitting. A chilled listing reads "fresh"
// for days; one left out reads what it deserves.
async function withFreshness(listings, player) {
  return Promise.all(listings.map(async l => {
    if (!l.tags?.perishable) return l;
    const fresh = await fireHook('item.checkFreshness', { ...l, id: l.id }, player);
    return fresh?.state ? { ...l, freshness: fresh.state } : l;
  }));
}

async function cmdWares(player) {
  const h = await here(player);
  if (h.error) return { type: 'error', message: h.error };
  if (!h.deed?.owner_id) return { type: 'error', message: 'The unit is empty and unsold. Nothing on offer. (DEED)' };
  const listings = await withFreshness(await listingsFor(h.zone.id), player);
  return { type: 'output', message: waresBoard(h.zone, h.deed, listings) };
}

// ── BUYWARE — the sale ───────────────────────────────────────────────────────
async function cmdBuyWare(args, player) {
  const h = await here(player);
  if (h.error) return { type: 'error', message: h.error };
  if (!h.deed?.owner_id) return { type: 'error', message: 'Nothing here is for sale — the unit is vacant.' };
  const name = args.join(' ').trim();

  // Settle up for anything you've already lifted off the shelf before looking at
  // what's still on it — this is the honest way out of a POCKET, and the reason
  // walking straight to the door is a choice rather than the only option.
  const owing = await carriedUnpaid(player.id, h.zone.id);
  if (owing.length) {
    const match = name ? owing.find(o => o.name.toLowerCase().includes(name.toLowerCase())) : owing[0];
    if (match) return payForPocketed(match, player, h.deed);
  }

  const listings = await listingsFor(h.zone.id);
  if (!listings.length) return { type: 'error', message: 'The display is bare.' };
  if (!name) return { type: 'output', message: waresBoard(h.zone, h.deed, listings) };

  const r = siftResolve(name, listings);
  if (r.type === 'none') return { type: 'error', message: `Nothing on the display matches "${name}".` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { dispatchType: 'storefront.buy', dispatchParam: 'target' });
    return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  return purchaseListing(r.candidate, player);
}

// Paying for something already in your hands. Same money movement as a shelf
// purchase; the difference is the row is already yours, so all that changes is
// the marks coming off and the till going up.
async function payForPocketed(row, player, deed) {
  const price = row.price || 0;
  const paid = await withTransaction(async (q) => {
    if (!(await adjustCredits(player, -price, q, 'storefront:buy'))) return null;
    await q(`UPDATE player_inventory SET custom_data = (custom_data - '${SHOP_UNPAID}') - 'list_price' WHERE id=$1`, [row.id]);
    const { rows } = await q('UPDATE storefronts SET till_credits = till_credits + $1 WHERE zone_id=$2 RETURNING till_credits',
      [price, deed.zone_id]);
    return rows[0]?.till_credits ?? 0;
  });
  if (paid === null) return { type: 'error', message: `That's ${price}₵ and you have ${player.credits || 0}₵. Put it back or make a decision.` };
  setDeed(deed.zone_id, { ...deed, till_credits: paid });

  if (getLivePlayer(deed.owner_id)) sendToPlayer(deed.owner_id, { type: 'output', message:
    `<span style="color:var(--yellow)">₵ SETTLED — ${player.handle} paid ${price}₵ for the ${row.name} they'd picked up. Till: ${paid}₵.</span>` });
  return { type: 'buy', player_update: { credits: player.credits }, message:
    `You settle up for the <b>${row.name}</b>. <span style="color:var(--yellow)">-${price}₵</span>. It's yours, properly.` };
}

async function purchaseListing(listing, player) {
  const zone = getZone(player.current_zone);
  const deed = getDeed(zone?.id);
  if (!deed?.owner_id) return { type: 'error', message: 'Nothing here is for sale.' };
  if (ownsShop(player, deed)) return { type: 'error', message: "It's your own stock. UNSTOCK it instead." };

  const price = listing.price || 0;
  // Debit, hand over the goods and pay the till as one unit — a failure between
  // them must not take credits and leave the item on the shelf (or vice versa).
  // The row is re-checked inside the transaction so two buyers racing for the
  // last item can't both walk out with it.
  const outcome = await withTransaction(async (q) => {
    const { rows: still } = await q(
      `SELECT id FROM player_inventory WHERE id=$1 AND player_id=$2 FOR UPDATE`,
      [listing.id, stockOwner(zone.id)],
    );
    if (!still.length) return 'gone';
    if (!(await adjustCredits(player, -price, q, 'storefront:buy'))) return 'broke';
    await q(`UPDATE player_inventory SET player_id=$1, custom_data = custom_data - 'list_price' WHERE id=$2`,
      [player.id, listing.id]);
    const { rows: t } = await q('UPDATE storefronts SET till_credits = till_credits + $1 WHERE zone_id=$2 RETURNING till_credits',
      [price, zone.id]);
    return t[0]?.till_credits ?? 0;
  });

  if (outcome === 'gone') return { type: 'error', message: 'Someone got there first — it\'s already gone.' };
  if (outcome === 'broke') return { type: 'error', message: `That's ${price}₵ and you have ${player.credits || 0}₵.` };
  setDeed(zone.id, { ...deed, till_credits: outcome });

  // The bought row is already the buyer's; giveToPlayer would only be needed for
  // a merge, and a listed row is instanced by design, so it stays its own line.
  emit('storefront.sale', {
    player: { id: player.id, handle: player.handle }, zoneId: zone.id,
    ownerId: deed.owner_id, itemId: listing.item_id, price,
    tags: getItem(listing.item_id)?.tags || {},
  });

  const bc = getBroadcast();
  if (bc) bc(zone.id, { type: 'zone_event', message: `${player.handle} lifts ${listing.name} off the display and pays for it.` }, player.id);
  // The proprietor hears the till from wherever they are — the whole point of a
  // shop that trades while you're elsewhere.
  const owner = getLivePlayer(deed.owner_id);
  if (owner) sendToPlayer(deed.owner_id, { type: 'output', message:
    `<span style="color:var(--yellow)">₵ SALE — ${player.handle} bought ${listing.name} from ${shopDisplayName(zone, deed)} for ${price}₵. Till: ${outcome}₵.</span>` });

  return { type: 'buy', player_update: { credits: player.credits }, message:
    `You take <b>${listing.name}</b> off the display and settle up. <span style="color:var(--yellow)">-${price}₵</span>` };
}

// ── TILL — collect the takings ───────────────────────────────────────────────
async function cmdTill(player) {
  const h = await here(player, { needOwner: true, needSold: true });
  if (h.error) return { type: 'error', message: h.error };
  const amount = h.deed.till_credits || 0;
  if (amount <= 0) return { type: 'output', message: 'The till is empty. Nothing to collect.' };

  const { rows } = await query('UPDATE storefronts SET till_credits=0 WHERE zone_id=$1 AND till_credits=$2 RETURNING till_credits',
    [h.zone.id, amount]);
  if (!rows.length) return { type: 'error', message: 'The till count shifted under you. Try again.' };
  setDeed(h.zone.id, { ...h.deed, till_credits: 0 });
  await adjustCredits(player, amount, undefined, 'storefront:till');

  return { type: 'output', player_update: { credits: player.credits }, message:
    `You empty the vault and pocket <span style="color:var(--yellow)">${amount}₵</span>.` };
}

// ── SELLSHOP — hand the keys back ────────────────────────────────────────────
async function cmdSellShop(player) {
  const h = await here(player, { needOwner: true, needSold: true });
  if (h.error) return { type: 'error', message: h.error };
  const paid = h.deed.payments_made * h.deed.weekly_payment;
  const takings = h.deed.till_credits || 0;

  // Walking away hands back everything on the shelf and whatever's in the till —
  // you're giving up the deed, not being robbed. Repossession is the punitive path.
  await query(`UPDATE player_inventory SET player_id=$1, custom_data = custom_data - 'list_price' WHERE player_id=$2`,
    [player.id, stockOwner(h.zone.id)]);
  await releaseShop(h.zone.id);
  if (takings > 0) await adjustCredits(player, takings, undefined, 'storefront:surrender');

  return { type: 'output', player_update: { credits: player.credits }, message:
    `<span style="color:var(--accent)">You hand the keys back.</span> ${h.zone.name} goes back on the board.\n\n` +
    `<span class="text-dim">Paid in over the term:</span> ${paid}₵ <span class="text-dim">(not refunded)</span>\n` +
    `<span class="text-dim">Stock recovered:</span> everything off the display\n` +
    `<span class="text-dim">Till collected:</span> ${takings}₵` };
}

// Shared teardown: clears the deed back to vacant. Used by SELLSHOP and by
// repossession (which seizes the stock separately BEFORE calling this).
export async function releaseShop(zoneId) {
  await query(`DELETE FROM storefronts WHERE zone_id=$1`, [zoneId]);
  setDeed(zoneId, null);
}

// ── The room ─────────────────────────────────────────────────────────────────
// A storefront announces itself on LOOK: the board if it's vacant, the sign and
// the display if it isn't. Sync-read off the deed cache — no query on a look
// unless there's actually stock to list.
async function describeRoom(zone) {
  if (!isStorefrontZone(zone)) return undefined;
  await loadDeeds();
  const deed = getDeed(zone.id);
  if (!deed?.owner_id) {
    const t = authoredTerms(zone);
    return `<span style="color:var(--yellow)">◈ FOR SALE — ${t.price}₵, or ${t.weekly}₵ per ${RENT_PERIOD_DAYS}-day cycle over ${t.term} cycles.</span> ` +
      `<span class="text-dim">(<span class="action-link" data-raw-cmd="deed" title="Read the terms">DEED</span> for the terms, ` +
      `<span class="action-link" data-raw-cmd="buyshop" title="Take on the mortgage">BUYSHOP</span> to sign)</span>`;
  }
  const listings = await listingsFor(zone.id);
  const parts = [`<span class="text-dim">Proprietor: ${deed.owner_handle}.</span>`];

  // Whoever's on the payroll is standing right there — the deterrent only works
  // if a would-be thief can see it before they decide.
  for (const m of await staffFor(zone.id)) {
    const cfg = ROLES[m.role];
    if (cfg) parts.push(`<span class="text-dim">${cfg.prose(m.name)}</span>`);
  }
  if (deed.shutters_closed) {
    parts.push(`<span style="color:var(--yellow)">The shutter is down over the front. The shop is shut.</span>`);
  }
  parts.push(waresBoard(zone, deed, listings));
  const orders = ordersBoard(zone, deed, await ordersFor(zone.id));
  if (orders) parts.push(orders);
  return parts.join('\n');
}

// ── The vault ────────────────────────────────────────────────────────────────
// Furniture flagged `shop_vault: true` in a storefront holds the till. Same
// VAULT CRACK contract as a vendor safe (arm → client minigame → resolve), kept
// here rather than folded into vendor-safe because that plugin's whole model is
// keyed to a vendor NPC and a player shop has none.
const _vaultLockout = new Map();
const _vaultPending = new Map();

async function findVault(zoneId, nameHint) {
  let sql = `SELECT id, name, flags FROM furniture WHERE zone_id=$1 AND flags @> '{"shop_vault":true}'`;
  const params = [zoneId];
  if (nameHint) { sql += ` AND name ILIKE $2`; params.push(`%${nameHint}%`); }
  sql += ' LIMIT 1';
  const { rows } = await query(sql, params);
  return rows[0] || null;
}

async function cmdHackVault(args, raw, player, broadcast) {
  await loadDeeds();
  const zone = getZone(player.current_zone);
  const vault = await findVault(player.current_zone, args.join(' ') || null);
  // No shop vault here — fall through so `hack` still reaches a vendor safe, a
  // hololock door or an ATM in the same room.
  if (!vault) return undefined;

  const deed = getDeed(zone?.id);
  if (!deed?.owner_id) return { type: 'output', message: `The ${vault.name} hangs open and empty. Nobody's trading out of here yet.` };
  if (ownsShop(player, deed)) return { type: 'error', message: `It's your own vault. Use <b>TILL</b>.` };

  // A deck is required, as it is for the ATM, the hololock and the vendor safe. It
  // was missing here, which is doubly odd given the room-broadcast below announces
  // that you "jack a deck into the vault" — the fiction already assumed the hardware
  // the code never asked for. It also left `hack_difficulty` reading off a deck that
  // might not exist. After the `return undefined` self-gate so a bare-handed `hack`
  // still falls through to another target in the room, and before the lockout so a
  // failed attempt you were never allowed to make can't cost you five minutes.
  if (!(await hasHackDeck(player.id))) {
    return { type: 'error', message: `The ${vault.name} is a lump of ceramic and a comm port. You need a hacking device to talk to it.` };
  }

  const until = _vaultLockout.get(player.id) || 0;
  if (Date.now() < until) {
    return { type: 'error', message: `Your rig is still flagged from the last attempt. Lockout expires in ${Math.ceil((until - Date.now()) / 1000)}s.` };
  }
  if ((deed.till_credits || 0) <= 0) {
    return { type: 'output', message: `You spin the dial on the ${vault.name} and listen. Whatever's in there, it isn't money. ${deed.owner_handle} banks their takings.` };
  }

  // A hired body in the room is the whole reason to pay one: they catch you at it
  // and raise the alarm, which makes the crack a FORCED witness — you're doing it
  // brazenly, in front of staff. Same shape as vendor-safe's owner-present case.
  const guard = (await staffFor(zone.id)).find(m => m.role === 'guard') || (await staffFor(zone.id))[0];
  if (guard) {
    if (broadcast) broadcast(player.current_zone, { type: 'zone_event', message:
      `<span class="msg-danger">${guard.name} sees ${player.handle} jack a deck into the ${vault.name} and does not hesitate: "OI! Hands. HANDS!"</span>` });
    // Staff on the floor are a GUARANTEED witness — the same dedicated-event
    // convention vendor.safeHackWitnessed / burglary.reported use, rather than a
    // flag on the generic event (surveillance's raiseCrime takes `forced` only
    // from listeners that mean it).
    emit('storefront.staffWitnessed', { player, zoneId: player.current_zone, crime: 'hacking' });
  } else if (broadcast) {
    broadcast(player.current_zone, { type: 'zone_event',
      message: `${player.handle} jacks a deck into the ${vault.name} and starts working the dial.` }, player.id);
  }
  // The proprietor gets told their vault is being worked, wherever they are —
  // the counterplay to leaving the till full.
  if (getLivePlayer(deed.owner_id)) sendToPlayer(deed.owner_id, { type: 'output', message:
    `<span style="color:var(--red)">⚠ Your vault at ${shopDisplayName(zone, deed)} is reporting a tamper alarm.` +
    `${guard ? ` ${guard.name} is on the floor.` : ''}</span>` });

  _vaultPending.set(player.id, { vaultId: vault.id, expires: Date.now() + VAULT_PENDING_TTL_MS });
  return textRender(player, {
    type: 'vault_crack',
    safeId: vault.id,
    deviceName: vault.name,
    skill: await effectiveSkill(player, 'hacking'),
    difficulty: await hackDifficulty(player.id, vault.flags?.hack_difficulty, 6),
    resolveCmd: 'tillcrackresolve',
  });
}

// tillcrackresolve <vaultId> <1|0> — the overlay reports its own outcome; the
// credits are re-read here so the payout can't be spoofed.
async function cmdTillCrackResolve(args, raw, player) {
  const vaultId = args[0];
  const win = args[1] === '1';
  if (!vaultId) return { type: 'noop' };

  const pending = _vaultPending.get(player.id);
  _vaultPending.delete(player.id);
  if (!pending || pending.vaultId !== vaultId || Date.now() > pending.expires) return { type: 'noop' };

  const vault = await findVault(player.current_zone);
  if (!vault || vault.id !== vaultId) return { type: 'noop' };
  if (!win) {
    _vaultLockout.set(player.id, Date.now() + VAULT_LOCKOUT_MS);
    // A botched crack costs the deck condition, exactly as it does on the ATM and the
    // hololock. This path never did, which — now that a deck is required to be here at
    // all — was the last thing making a cheap Pry-Bar strictly better than no deck and
    // never worse: `hack_fail_damage` is the price of its higher `hack_penalty`.
    await damageHackDeck(player.id);
    return { type: 'error', message: 'The combination re-seats mid-spin and the tamper sensor logs the attempt. Your rig is flagged — five-minute lockout.' };
  }

  const zone = getZone(player.current_zone);
  const deed = getDeed(zone?.id);
  if (!deed?.owner_id) return { type: 'noop' };

  // Drain under a row lock so two crackers can't both empty the same till, and
  // read the amount server-side rather than trusting the cache or the client.
  const stolen = await withTransaction(async (q) => {
    const { rows: cur } = await q('SELECT till_credits FROM storefronts WHERE zone_id=$1 FOR UPDATE', [zone.id]);
    const amount = cur[0]?.till_credits || 0;
    if (amount <= 0) return 0;
    await q('UPDATE storefronts SET till_credits=0 WHERE zone_id=$1', [zone.id]);
    return amount;
  });
  setDeed(zone.id, { ...deed, till_credits: 0 });
  if (stolen <= 0) return { type: 'output', message: `The ${vault.name} swings open on an empty shelf. Someone beat you to it.` };

  await adjustCredits(player, stolen, undefined, 'storefront:vaultloot');
  await awardSkillUse(player.id, 'hacking', await breachMargin(player, vault.flags?.hack_difficulty, 6));
  emit('hack.success', { player, zoneId: player.current_zone });
  if (getLivePlayer(deed.owner_id)) sendToPlayer(deed.owner_id, { type: 'output', message:
    `<span style="color:var(--red)">₵ ROBBED — your vault at ${shopDisplayName(zone, deed)} has been emptied. ${stolen}₵ gone.</span>` });

  return { type: 'output', player_update: { credits: player.credits }, message:
    `The last tumbler drops and the bolt slides back. The ${vault.name} swings open.\n` +
    `You lift ${stolen}₵ of ${deed.owner_handle}'s takings and ease it shut behind you.\n` +
    `<span class="ip-gain">+${stolen} credits. Hacking improved.</span>` };
}

// ── Mortgage & upkeep ────────────────────────────────────────────────────────
// Billed on the GAME calendar, same cadence and same shape as apartment rent
// (gameLoop's rentCollectionTick) — so both scale with the game-speed knob.
// Drafted till → bank → pocket: a shop that trades pays for itself.
// `todayOverride` exists for the regress suite only: the test harness boots the
// world and plugins but not the environment, so gameToday() is null there and the
// whole billing path would silently no-op (the same reason apartment rent has no
// tick coverage). Production always calls this with no argument.
export async function mortgageTick(todayOverride = null) {
  const today = todayOverride || gameToday();
  if (!today) return;
  await loadDeeds();

  const { rows } = await query('SELECT * FROM storefronts WHERE owner_id IS NOT NULL');
  for (const deed of rows) {
    let due = ymd(deed.due_date);
    if (!due) {
      // Deed predates the due-date column (or the environment wasn't up at
      // purchase) — grant a fresh cycle rather than charging retroactively.
      const seeded = addGameDays(today, RENT_PERIOD_DAYS);
      await query('UPDATE storefronts SET due_date=$1 WHERE zone_id=$2', [seeded, deed.zone_id]).catch(() => {});
      setDeed(deed.zone_id, { ...deed, due_date: seeded });
      continue;
    }
    if (gameDaysBetween(today, due) > 0) continue;  // not due yet

    const zoneName = world.zones.get(deed.zone_id)?.name ?? deed.zone_id;
    // Staff are paid on the same cycle and out of the same pot as the bank. If the
    // shop can't cover everything, the staff walk BEFORE the lender forecloses —
    // losing your guard is the warning shot before losing the building.
    const staff = await staffFor(deed.zone_id);
    const wages = staff.reduce((s, m) => s + (m.wage || 0), 0);
    const owed = (deed.paid_off ? (deed.upkeep || 0) : (deed.weekly_payment || 0)) + wages;

    // Advance the due date by whole cycles until it's back in the future — one
    // normally, more if a dev date-jump skipped several (charge once, not once
    // per skipped day).
    let next = due;
    do { next = addGameDays(next, RENT_PERIOD_DAYS); } while (gameDaysBetween(today, next) <= 0);

    if (owed <= 0) {
      await query('UPDATE storefronts SET due_date=$1 WHERE zone_id=$2', [next, deed.zone_id]);
      setDeed(deed.zone_id, { ...deed, due_date: next });
      continue;
    }

    const { rows: pr } = await query('SELECT id, credits, bank_credits, handle FROM players WHERE id=$1', [deed.owner_id]);
    if (!pr.length) { await repossess(deed, zoneName, 'the proprietor is gone'); continue; }
    const p = pr[0];

    const fromTill = Math.min(deed.till_credits || 0, owed);
    let rest = owed - fromTill;
    const fromBank = Math.min(p.bank_credits || 0, rest);
    rest -= fromBank;
    const fromCarried = Math.min(p.credits || 0, rest);
    rest -= fromCarried;

    if (rest > 0) {
      // Can't cover the lot. Lay the staff off first and see if the bill alone
      // fits — a shop that can still pay its mortgage keeps its building, and the
      // owner finds out the hard way that payroll is the first thing to go.
      if (staff.length) {
        await query('DELETE FROM storefront_staff WHERE zone_id=$1', [deed.zone_id]);
        sendToPlayer(deed.owner_id, { type: 'output', message:
          `<span style="color:var(--red)">⚠ PAYROLL MISSED — ${staff.map(m => m.name).join(' and ')} ` +
          `${staff.length > 1 ? 'walk out of' : 'walks out of'} ${zoneName} without being asked twice.</span>` });
      }
      // Short. One miss is a warning; the second takes the shop.
      const missed = (deed.missed || 0) + 1;
      if (missed >= MAX_MISSED) { await repossess(deed, zoneName, `${missed} missed payments`); continue; }
      await query('UPDATE storefronts SET missed=$1, due_date=$2 WHERE zone_id=$3', [missed, next, deed.zone_id]);
      setDeed(deed.zone_id, { ...deed, missed, due_date: next });
      sendToPlayer(p.id, { type: 'output', message:
        `<span style="color:var(--red)">⚠ MISSED PAYMENT — ${owed}₵ was due on ${zoneName} and you couldn't cover it. ` +
        `One more and the lender takes the place, stock and all.</span>` });
      continue;
    }

    if (fromBank || fromCarried) {
      await query('UPDATE players SET bank_credits=bank_credits-$1, credits=credits-$2 WHERE id=$3', [fromBank, fromCarried, p.id]);
    }
    const paymentsMade = deed.paid_off ? deed.payments_made : deed.payments_made + 1;
    const nowPaidOff = deed.paid_off ? 1 : (paymentsMade >= deed.payments_total ? 1 : 0);
    await query(
      `UPDATE storefronts SET till_credits=till_credits-$1, payments_made=$2, paid_off=$3, missed=0, due_date=$4 WHERE zone_id=$5`,
      [fromTill, paymentsMade, nowPaidOff, next, deed.zone_id]);
    setDeed(deed.zone_id, { ...deed, till_credits: (deed.till_credits || 0) - fromTill,
      payments_made: paymentsMade, paid_off: nowPaidOff, missed: 0, due_date: next });

    const live = getLivePlayer(p.id);
    if (live) {
      live.bank_credits = Math.max(0, (live.bank_credits || 0) - fromBank);
      live.credits = Math.max(0, (live.credits || 0) - fromCarried);
    }
    const source = fromTill >= owed ? 'straight out of the till'
      : fromTill > 0 ? `${fromTill}₵ from the till, the rest from you`
      : 'from your accounts';
    const tail = nowPaidOff && !deed.paid_off
      ? `\n<span style="color:var(--accent)">◈ MORTGAGE CLEARED — ${zoneName} is yours outright. Upkeep from here is ${deed.upkeep}₵ per cycle.</span>`
      : deed.paid_off ? '' : ` (${paymentsMade}/${deed.payments_total})`;
    sendToPlayer(p.id, { type: 'output',
      message: `<span style="color:var(--yellow)">${deed.paid_off ? 'UPKEEP' : 'INSTALMENT'} PAID — ${owed}₵ on ${zoneName}, ${source}.${tail}</span>`,
      ...(live ? { player_update: { credits: live.credits, bank_credits: live.bank_credits } } : {}) });
  }
}

// The lender takes the place back AND the stock on the shelf — the debt has to
// come out of something. This is the difference between defaulting and SELLSHOP.
async function repossess(deed, zoneName, why) {
  await query('DELETE FROM player_inventory WHERE player_id=$1', [stockOwner(deed.zone_id)]);
  await releaseShop(deed.zone_id);
  emit('storefront.repossessed', { ownerId: deed.owner_id, zoneId: deed.zone_id });
  sendToPlayer(deed.owner_id, { type: 'output', message:
    `<span style="color:var(--red)">◈ REPOSSESSION — ${zoneName} has been taken back (${why}). ` +
    `The locks are re-keyed, the display is cleared, and the ${deed.payments_made * deed.weekly_payment}₵ you put in stays put in. ` +
    `The unit is back on the board.</span>` });
}

on('environment.dayRollover', () => { mortgageTick().catch(e => console.error('[storefront] mortgage tick failed:', e)); });

// ═══ SHUTTERS ═══════════════════════════════════════════════════════════════
// The shop's front door is a real `doors` row on the facade↔interior link tagged
// `lock:shopshutter`, so lock/unlock/hack/bash/burglary all reach it through the
// engine's existing machinery — nothing here re-implements a door. All this adds
// is the auth rule (the proprietor and their staff, nobody else) and durability:
// door state is runtime-only and resets to authored on reboot, so the DEED holds
// the truth and re-applies it at boot, exactly as apartments.is_locked does.
registerLockType('shopshutter', {
  tagType: 'lock:shopshutter',
  kitTag: 'lockkit:shopshutter',
  defaults: {
    difficulty: 5, canHack: true,
    messages: {
      lock: 'The shutter grinds down and the bolt drops into the floor plate.',
      unlock: 'The bolt lifts and the shutter rolls up.',
      denied: "The shutter's keypad doesn't know you. It doesn't care, either.",
      hackFail: 'The keypad relocks itself mid-sequence.',
      hackSuccess: 'The keypad concedes and the shutter jumps in its track.',
    },
  },
  // A door may be anchored on either side of the exit, so check both.
  authFn: async (lockTag, door, player) => {
    const far = door.target_zone ? [door.target_zone] : exitTargets(getZone(door.zone_id), door.exit_dir);
    for (const zid of [door.zone_id, ...far]) {
      const deed = getDeed(zid);
      if (deed && (ownsShop(player, deed) || await isStaffOf(zid, player))) return true;
    }
    return false;
  },
});

// Every door touching this shop that carries a shutter tag.
function shutterDoorsFor(zoneId) {
  const out = [];
  for (const door of world.doors.values()) {
    const far = door.target_zone ? [door.target_zone] : exitTargets(getZone(door.zone_id), door.exit_dir);
    if (door.zone_id !== zoneId && !far.includes(zoneId)) continue;
    if (Object.keys(door.tags || {}).some(k => k === 'lock:shopshutter')) out.push(door);
  }
  return out;
}

function applyShutterState(zoneId, closed) {
  for (const door of shutterDoorsFor(zoneId)) {
    door.lock_state = closed ? 'locked' : 'unlocked';
    door.is_open = closed ? 0 : 1;
    setDoorCache(door.id, door);
  }
}

// Boot reconcile — see the note on registerLockType above. Runs once when the
// plugin loads (after initWorld, so world.doors is populated).
async function reconcileShutters() {
  await loadDeeds();
  let closed = 0;
  for (const [zoneId, deed] of deeds) {
    if (!deed.shutters_closed) continue;
    applyShutterState(zoneId, true);
    closed++;
  }
  if (closed) console.log(`✓ Storefront shutters reconciled: ${closed} shop(s) re-secured`);
}
reconcileShutters().catch(() => {});

async function cmdShutters(args, player) {
  const h = await here(player, { needOwner: true, needSold: true });
  if (h.error) return { type: 'error', message: h.error };
  const want = args[0]?.toLowerCase();
  const closed = !!h.deed.shutters_closed;
  const target = want === 'down' || want === 'close' || want === 'closed' ? true
    : want === 'up' || want === 'open' ? false
    : !closed;   // bare `shutters` toggles

  if (target === closed) {
    return { type: 'output', message: closed
      ? 'The shutter is already down.'
      : 'The shutter is already up. The shop is open.' };
  }
  if (!shutterDoorsFor(h.zone.id).length) {
    return { type: 'error', message: 'This unit has no shutter fitted. Nothing to work.' };
  }

  await query('UPDATE storefronts SET shutters_closed=$1 WHERE zone_id=$2', [target ? 1 : 0, h.zone.id]);
  setDeed(h.zone.id, { ...h.deed, shutters_closed: target ? 1 : 0 });
  applyShutterState(h.zone.id, target);

  const bc = getBroadcast();
  if (bc) bc(h.zone.id, { type: 'zone_event', refresh: true, message: target
    ? `${player.handle} brings the shutter down. The bolt drops into the floor plate.`
    : `${player.handle} rolls the shutter up. Daylight, and whatever comes with it.` }, player.id);

  return { type: 'output', message: target
    ? 'You bring the shutter down and lock it off. Nobody reaches the till tonight without working for it.'
    : 'You roll the shutter up. The shop is open.' };
}

// ═══ STAFF ══════════════════════════════════════════════════════════════════
// Deliberately NOT `npcs` rows — see the file header. A hire is a storefront_staff
// row (player data) plus presence in the room prose; what it buys you is odds.
const ROLES = {
  clerk: {
    wage: 45,
    blurb: 'works the counter, watches the door, and walks the takings to the bank',
    hired: (n) => `${n} takes the apron off the hook without being asked and starts squaring the shelf.`,
    prose: (n) => `${n} is behind the counter, doing that thing shopkeepers do where they look busy and watch the door at the same time.`,
  },
  guard: {
    wage: 70,
    blurb: 'stands by the door and makes sure everyone knows they were seen',
    hired: (n) => `${n} looks the room over once, picks the corner with the best sightline, and stands in it.`,
    prose: (n) => `${n} stands by the door with the specific stillness of somebody being paid to notice things.`,
  },
};

// Names for hires. Not NPCs — just a face and a name so payroll reads like people.
const STAFF_NAMES = [
  'Meech', 'Corrin Vale', 'Dob', 'Ash Petrov', 'Wren', 'Sallow Kade', 'Tobin',
  'Mox', 'Del Arroway', 'Pim', 'Hester Quill', 'Nax', 'Rue Ferran', 'Ozzy Stell',
];

async function staffFor(zoneId) {
  const { rows } = await query('SELECT * FROM storefront_staff WHERE zone_id=$1 ORDER BY role', [zoneId]);
  return rows;
}
export async function staffRole(zoneId, role) {
  const { rows } = await query('SELECT * FROM storefront_staff WHERE zone_id=$1 AND role=$2', [zoneId, role]);
  return rows[0] || null;
}
// Staff auth for the shutter lock: the owner's employees can open up.
// Staff are virtual, so "being staff" is a property of the SHOP, not the player —
// only the owner can currently hold that. Kept as a seam for hired players later.
async function isStaffOf() { return false; }

async function cmdHire(args, player) {
  const h = await here(player, { needOwner: true, needSold: true });
  if (h.error) return { type: 'error', message: h.error };
  const role = (args[0] || '').toLowerCase();
  if (!ROLES[role]) {
    const menu = Object.entries(ROLES)
      .map(([r, c]) => `  <b>${r}</b> — ${c.blurb}. <span style="color:var(--yellow)">${c.wage}₵</span>/cycle`).join('\n');
    return { type: 'output', message: `Hire who?\n${menu}\n\n<span class="text-dim">(hire clerk · hire guard) — wages come out of the till on the same cycle as the mortgage.</span>` };
  }
  if (await staffRole(h.zone.id, role)) {
    return { type: 'error', message: `You already have a ${role} on the books here. SACK ${role.toUpperCase()} first.` };
  }

  const cfg = ROLES[role];
  const taken = new Set((await staffFor(h.zone.id)).map(m => m.name));
  const name = STAFF_NAMES.filter(n => !taken.has(n))[Math.floor(Math.random() * Math.max(1, STAFF_NAMES.length - taken.size))] || 'Meech';
  await query(
    `INSERT INTO storefront_staff (zone_id, role, npc_id, name, wage, hired_at)
     VALUES ($1,$2,NULL,$3,$4,$5) ON CONFLICT (zone_id, role) DO UPDATE SET name=$3, wage=$4, hired_at=$5`,
    [h.zone.id, role, name, cfg.wage, Math.floor(Date.now() / 1000)]);

  const bc = getBroadcast();
  if (bc) bc(h.zone.id, { type: 'zone_event', message: cfg.hired(name) }, player.id);
  return { type: 'output', message:
    `You put <b>${name}</b> on as ${role}. <span style="color:var(--yellow)">${cfg.wage}₵</span> per cycle, out of the till.\n` +
    `<span class="text-dim">${cfg.hired(name)}</span>` };
}

async function cmdSack(args, player) {
  const h = await here(player, { needOwner: true, needSold: true });
  if (h.error) return { type: 'error', message: h.error };
  const role = (args[0] || '').toLowerCase();
  const member = role ? await staffRole(h.zone.id, role) : (await staffFor(h.zone.id))[0];
  if (!member) return { type: 'error', message: role ? `You have no ${role} here.` : 'You have nobody on the books here.' };

  await query('DELETE FROM storefront_staff WHERE zone_id=$1 AND role=$2', [h.zone.id, member.role]);
  const bc = getBroadcast();
  if (bc) bc(h.zone.id, { type: 'zone_event', message: `${member.name} hands back the keys and goes, without comment.` }, player.id);
  return { type: 'output', message: `You let <b>${member.name}</b> go. That's ${member.wage}₵ a cycle back in the till.` };
}

async function cmdStaff(player) {
  const h = await here(player, { needSold: true });
  if (h.error) return { type: 'error', message: h.error };
  const roster = await staffFor(h.zone.id);
  if (!roster.length) return { type: 'output', message: 'Nobody works here. (HIRE CLERK · HIRE GUARD)' };
  const lines = roster.map(m => `  <b>${m.name}</b> — ${m.role}, <span style="color:var(--yellow)">${m.wage}₵</span>/cycle`);
  const total = roster.reduce((s, m) => s + m.wage, 0);
  return { type: 'output', message: `<span style="color:var(--accent)">Payroll — ${shopDisplayName(h.zone, h.deed)}</span>\n${lines.join('\n')}\n<span class="text-dim">Total: ${total}₵ per cycle, drawn from the till.</span>` };
}

// ═══ SHOPLIFTING ════════════════════════════════════════════════════════════
// The same shape as a vendor's self-service cooler (commerce): the goods leave
// marked, and carrying the mark out of the shop is the crime — charged only if a
// camera or a cop saw it, per the witness law in surveillance. The one difference,
// because this is a PLAYER's property: the proprietor is always told, witness or
// not. Staff don't stop a lift; they guarantee the crime is witnessed.
const SHOP_UNPAID = 'shop_unpaid';

async function carriedUnpaid(playerId, zoneId = null) {
  const { rows } = await query(
    `SELECT pi.id, pi.item_id, pi.quantity, pi.custom_data->>'${SHOP_UNPAID}' AS shop_zone,
            (pi.custom_data->>'list_price')::int AS price, i.name
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id=$1 AND jsonb_exists(pi.custom_data, '${SHOP_UNPAID}')`,
    [playerId]);
  return zoneId ? rows.filter(r => r.shop_zone === zoneId) : rows;
}

async function cmdPocket(args, player) {
  const h = await here(player);
  if (h.error) return { type: 'error', message: h.error };
  if (!h.deed?.owner_id) return { type: 'error', message: 'The unit is vacant. There is nothing on the shelf.' };
  if (ownsShop(player, h.deed)) return { type: 'error', message: "It's your own stock. UNSTOCK it." };

  const name = args.join(' ').trim();
  const listings = await listingsFor(h.zone.id);
  if (!listings.length) return { type: 'error', message: 'The display is bare.' };
  if (!name) return { type: 'error', message: 'Pocket what? (pocket <item>)' };

  const r = siftResolve(name, listings);
  if (r.type === 'none') return { type: 'error', message: `Nothing on the display matches "${name}".` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { dispatchType: 'storefront.pocket', dispatchParam: 'target' });
    return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  return pocketListing(r.candidate, player);
}

async function pocketListing(listing, player) {
  const zone = getZone(player.current_zone);
  const deed = getDeed(zone?.id);
  if (!deed?.owner_id) return { type: 'error', message: 'Nothing here is for sale.' };

  // Guarded so two people can't lift the same row.
  const taken = await withTransaction(async (q) => {
    const { rows } = await q('SELECT id FROM player_inventory WHERE id=$1 AND player_id=$2 FOR UPDATE',
      [listing.id, stockOwner(zone.id)]);
    if (!rows.length) return false;
    await q(`UPDATE player_inventory
                SET player_id=$1, custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('${SHOP_UNPAID}', $2::text)
              WHERE id=$3`, [player.id, zone.id, listing.id]);
    return true;
  });
  if (!taken) return { type: 'error', message: "It's gone — somebody beat you to it." };

  const staff = await staffFor(zone.id);
  const watcher = staff.find(m => m.role === 'guard') || staff.find(m => m.role === 'clerk');
  const bc = getBroadcast();
  if (bc) bc(zone.id, { type: 'zone_event', message:
    `${player.handle} lifts ${listing.name} off the display.` }, player.id);
  if (watcher && bc) {
    bc(zone.id, { type: 'zone_event', message:
      `<span class="msg-danger">${watcher.name} watches ${player.handle} do it, and makes a point of being seen watching.</span>` });
  }

  // The proprietor always finds out — it's their property, not a vendor's float.
  sendToPlayer(deed.owner_id, { type: 'output', message:
    `<span style="color:var(--red)">⚠ ${player.handle} has taken ${listing.name} off the display at ${shopDisplayName(zone, deed)} without paying.` +
    `${watcher ? ` ${watcher.name} is on it.` : ''}</span>` });

  return { type: 'output', message:
    `You lift <b>${listing.name}</b> off the display.\n` +
    `<span class="text-dim">It isn't yours yet — <b>buyware ${listing.name}</b> settles up at ${listing.price}₵. ` +
    `Walking out with it is another matter.</span>` };
}

// The door asks first, exactly as a vendor's does — one prompt, one pair of
// verbs, owned by commerce (`commerce.arm_door_prompt`), answered here through
// our own settle action because a player's till takes money differently from a
// vendor's counter. The gate charges nothing; the crime still fires on the
// committed step below.
registerAction({
  type: 'storefront.settle_unpaid',
  handler: async ({ actor }) => {
    const owing = await carriedUnpaid(actor.id);
    if (!owing.length) return { type: 'output', message: "You've nothing to settle." };
    const lines = [], putBack = [];
    for (const row of owing) {
      const deed = getDeed(row.shop_zone);
      const paid = deed?.owner_id ? await payForPocketed(row, actor, deed) : { type: 'error' };
      if (paid.type === 'error') putBack.push(row); else lines.push(paid.message);
    }
    // Short: back on the display it came off, which is the one thing `buyware`
    // tells you to do and never had a verb for.
    for (const row of putBack) {
      await query(`UPDATE player_inventory SET player_id=$1, custom_data = custom_data - '${SHOP_UNPAID}' WHERE id=$2`,
        [stockOwner(row.shop_zone), row.id]);
    }
    if (putBack.length) {
      lines.push(`<span class="text-dim">You can't cover ${putBack.map(r => r.name).join(', ')}. Back on the display ${putBack.length > 1 ? 'they go' : 'it goes'}, and you walk out with empty hands.</span>`);
    }
    return { type: 'buy', player_update: { credits: actor.credits }, message: lines.join('\n') };
  },
});

registerMoveGate(async ({ player, from, to, direction }) => {
  const deed = getDeed(from?.id);
  if (!deed?.owner_id || from?.id === to?.id) return;
  const owing = await carriedUnpaid(player.id, from.id);
  if (!owing.length) return;

  const armed = await dispatchAction({
    type: 'commerce.arm_door_prompt', actor: player,
    params: { owner: from.id, direction, settleAction: 'storefront.settle_unpaid' },
  });
  // Already asked (or the prompt isn't there to ask with): this step is the answer.
  if (armed?.type === 'error' || armed?.armed === false) return;

  const total = owing.reduce((s, r) => s + (r.price || 0), 0);
  const names = owing.map(r => r.name).join(', ');
  return { block: true, message:
    `You're at the door of ${shopDisplayName(getZone(from.id), deed)} still holding <b>${names}</b>${total ? `, ${total}₵ unpaid` : ', unpaid'}.\n` +
    `<span class="text-dim">Pay for ${owing.length > 1 ? 'them' : 'it'}? <b>yes</b> to settle up and go, <b>no</b> to walk out with ${owing.length > 1 ? 'them' : 'it'}.</span>` };
}, 'storefront:unpaid-door');

// Walking out still holding it. Fires on the committed step (not a move gate — a
// gate can be vetoed downstream, and charging for a step that never happened would
// be a phantom crime). Costs nothing on a normal move: the `from` lookup is an
// in-memory Map hit and only leaving a shop reaches the query.
on('zone.entered', async ({ actor: player, zone, from }) => {
  if (!player?.id || !from || from === zone?.id) return;
  const deed = getDeed(from);
  if (!deed?.owner_id) return;
  const lifted = await carriedUnpaid(player.id, from);
  if (!lifted.length) return;

  // Out the door, the mark comes off either way — whether anyone can prove it is
  // the witness roll's business, not the mark's.
  await query(`UPDATE player_inventory SET custom_data = custom_data - '${SHOP_UNPAID}' WHERE id = ANY($1::text[])`,
    [lifted.map(r => r.id)]);

  const fromZone = getZone(from);
  const staff = await staffFor(from);
  const names = lifted.map(r => r.name).join(', ');
  sendToPlayer(player.id, { type: 'output', message:
    `<span class="msg-danger">You walk out of ${shopDisplayName(fromZone, deed)} with ${names} unpaid for.` +
    `${staff.length ? ` ${staff[0].name} is already reaching for a handset.` : ''}</span>` });

  // No staff: the ordinary witness roll decides, exactly as it does walking out of
  // a vendor's shop. Staff on the floor: a guaranteed witness, routed through the
  // dedicated forced-witness event rather than the generic one.
  if (staff.length) {
    emit('storefront.staffWitnessed', { player: { id: player.id, handle: player.handle }, zoneId: from, crime: 'shoplifting' });
  } else {
    emit('shoplifting.caught', { player: { id: player.id, handle: player.handle }, zoneId: from });
  }
  sendToPlayer(deed.owner_id, { type: 'output', message:
    `<span style="color:var(--red)">₵ THEFT — ${player.handle} walked out of ${shopDisplayName(fromZone, deed)} with ${names}.` +
    `${staff.length ? ` ${staff[0].name} called it in.` : ' Nobody was on the door.'}</span>` });
});

// ═══ FOOTFALL ═══════════════════════════════════════════════════════════════
// Passing trade. A stocked shelf occasionally sells to somebody who was walking
// past, so a shop earns while its owner is logged off — the difference between a
// business and a mailbox. Idle-gated by the scheduler, and priced honestly: the
// street will pay over the odds for convenience, but not indefinitely, so a shelf
// of 10x-marked-up junk sits there gathering dust exactly as it should.
const FOOTFALL_CHANCE = 0.18;      // per shop, per tick
const FOOTFALL_MAX_MARKUP = 1.8;   // above this multiple of base value, nobody bites

const PASSERSBY = [
  'a courier with time to kill', 'someone in a wet coat', 'a shift worker on their way home',
  'a kid with somebody else\'s credits', 'a rig mechanic still in overalls', 'a woman who does not browse',
  'a man who has clearly been sent for it', 'somebody who came in to get out of the weather',
];

export async function footfallTick(force = false) {
  await loadDeeds();
  for (const [zoneId, deed] of deeds) {
    if (!deed.owner_id) continue;
    if (deed.shutters_closed) continue;          // shut is shut
    if (!force && Math.random() > FOOTFALL_CHANCE) continue;

    const listings = await listingsFor(zoneId);
    if (!listings.length) continue;
    // Only things priced within reach of what they're worth.
    const sane = listings.filter(l => {
      const base = getItem(l.item_id)?.value ?? 0;
      return base > 0 && (l.price || 0) <= Math.ceil(base * FOOTFALL_MAX_MARKUP);
    });
    if (!sane.length) continue;

    const pick = sane[Math.floor(Math.random() * sane.length)];
    const price = pick.price || 0;
    // The sale: the row leaves the world (a passer-by is not a real inventory),
    // and the credits land in the till like any other counter sale.
    const sold = await withTransaction(async (q) => {
      const { rows } = await q('SELECT id FROM player_inventory WHERE id=$1 AND player_id=$2 FOR UPDATE',
        [pick.id, stockOwner(zoneId)]);
      if (!rows.length) return null;
      await q('DELETE FROM player_inventory WHERE id=$1', [pick.id]);
      const { rows: t } = await q('UPDATE storefronts SET till_credits = till_credits + $1 WHERE zone_id=$2 RETURNING till_credits',
        [price, zoneId]);
      return t[0]?.till_credits ?? 0;
    });
    if (sold === null) continue;
    setDeed(zoneId, { ...deed, till_credits: sold });

    const who = PASSERSBY[Math.floor(Math.random() * PASSERSBY.length)];
    const bc = getBroadcast();
    if (bc) bc(zoneId, { type: 'zone_event', message:
      `${who[0].toUpperCase()}${who.slice(1)} comes in, picks up the ${pick.name}, pays without haggling, and leaves.` });
    if (getLivePlayer(deed.owner_id)) sendToPlayer(deed.owner_id, { type: 'output', message:
      `<span style="color:var(--yellow)">₵ PASSING TRADE — ${pick.name} sold for ${price}₵ at ${shopDisplayName(getZone(zoneId), deed)}. Till: ${sold}₵.</span>` });
    emit('storefront.sale', { zoneId, ownerId: deed.owner_id, itemId: pick.item_id, price, footfall: true });
  }
}
schedule('5m', () => footfallTick().catch(e => console.error('[storefront] footfall tick failed:', e)));

// ═══ BUY ORDERS ═════════════════════════════════════════════════════════════
// A standing offer to buy, funded from the till, so people can sell INTO the shop
// while nobody's home. The till is the wallet: an order the till can't cover
// simply doesn't fill, which is the honest failure mode and needs no escrow.
async function ordersFor(zoneId) {
  const { rows } = await query(
    `SELECT o.*, i.name, i.tags FROM storefront_orders o JOIN items i ON i.id=o.item_id
      WHERE o.zone_id=$1 AND o.wanted > 0 ORDER BY i.name`, [zoneId]);
  return rows;
}

function ordersBoard(zone, deed, orders) {
  if (!orders.length) return null;
  const lines = orders.map(o =>
    `  <span class="action-link" data-raw-cmd="supply ${o.name}" title="Sell ${o.name} to this shop">${o.name}</span>` +
    ` — <span style="color:var(--yellow)">${o.price}₵</span> each, wants ${o.wanted}`);
  return `<span class="text-dim">${shopDisplayName(zone, deed)} is buying:</span>\n${lines.join('\n')}`;
}

async function cmdBuyOrder(args, player) {
  const h = await here(player, { needOwner: true, needSold: true });
  if (h.error) return { type: 'error', message: h.error };
  const raw = args.join(' ').trim();

  if (!raw || raw.toLowerCase() === 'list') {
    const orders = await ordersFor(h.zone.id);
    return { type: 'output', message: ordersBoard(h.zone, h.deed, orders)
      || 'You have no standing orders. (buyorder <item> for <price> [x<qty>])' };
  }
  if (/^cancel\b/i.test(raw)) {
    const name = raw.replace(/^cancel\s*/i, '').trim();
    const orders = await ordersFor(h.zone.id);
    const r = name ? siftResolve(name, orders) : { type: 'none' };
    if (r.type !== 'one') return { type: 'error', message: `Cancel which order? ${orders.map(o => o.name).join(', ') || '(none)'}` };
    await query('DELETE FROM storefront_orders WHERE id=$1', [r.candidate.id]);
    return { type: 'output', message: `You withdraw the offer on ${r.candidate.name}.` };
  }

  // "buyorder scrap for 40 x5" / "buyorder scrap 40"
  const m = raw.match(/^(.*?)(?:\s+for)?\s+(\d+)(?:\s*x\s*(\d+))?$/i);
  if (!m) return { type: 'error', message: 'Name a price. (buyorder <item> for <price> [x<qty>])' };
  const itemName = m[1].trim();
  const price = parseInt(m[2], 10);
  const qty = m[3] ? parseInt(m[3], 10) : 1;
  if (!itemName) return { type: 'error', message: 'Buy what? (buyorder <item> for <price>)' };
  if (!(price > 0) || !(qty > 0)) return { type: 'error', message: 'A real price and a real quantity, please.' };

  const { rows: found } = await query('SELECT id, name FROM items WHERE name ILIKE $1 ORDER BY length(name) LIMIT 2', [`%${itemName}%`]);
  if (!found.length) return { type: 'error', message: `Nothing called "${itemName}" exists to buy.` };
  if (found.length > 1 && found[0].name.toLowerCase() !== itemName.toLowerCase()) {
    return { type: 'error', message: `Which one? ${found.map(f => f.name).join(' or ')}.` };
  }
  const item = found[0];

  await query(
    `INSERT INTO storefront_orders (id, zone_id, item_id, price, wanted, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), h.zone.id, item.id, price, qty, Math.floor(Date.now() / 1000)]);
  return { type: 'output', message:
    `Posted: <b>${item.name}</b>, <span style="color:var(--yellow)">${price}₵</span> each, up to ${qty}.\n` +
    `<span class="text-dim">Paid out of the till as people bring them in — keep it funded or the offer bounces.</span>` };
}

async function cmdBuyOrders(player) {
  const h = await here(player, { needSold: true });
  if (h.error) return { type: 'error', message: h.error };
  const orders = await ordersFor(h.zone.id);
  return { type: 'output', message: ordersBoard(h.zone, h.deed, orders) || 'This shop isn\'t buying anything right now.' };
}

async function cmdSupply(args, player) {
  const h = await here(player, { needSold: true });
  if (h.error) return { type: 'error', message: h.error };
  if (ownsShop(player, h.deed)) return { type: 'error', message: "It's your own shop. Just STOCK it." };
  const name = args.join(' ').trim();
  const orders = await ordersFor(h.zone.id);
  if (!orders.length) return { type: 'error', message: "This shop isn't buying anything right now." };
  if (!name) return { type: 'output', message: ordersBoard(h.zone, h.deed, orders) };

  const r = siftResolve(name, orders);
  if (r.type === 'none') return { type: 'error', message: `${shopDisplayName(h.zone, h.deed)} isn't buying "${name}".` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { dispatchType: 'storefront.supply', dispatchParam: 'target' });
    return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  return fillOrder(r.candidate, player);
}

async function fillOrder(order, player) {
  const zone = getZone(player.current_zone);
  const deed = getDeed(zone?.id);
  if (!deed?.owner_id) return { type: 'error', message: 'Nobody runs this place.' };

  const row = await resolveInventoryItem(player, { name: order.name, topLevel: true, equipped: false });
  if (!row || row.item_id !== order.item_id) return { type: 'error', message: `You aren't carrying a ${order.name}.` };
  if (row.tags?.quest_item) return { type: 'error', message: `The ${row.name} isn't yours to sell.` };

  // The till is the wallet. Debit it, move the goods onto the shelf as unlisted
  // stock, and decrement the order — one unit at a time, atomically.
  const paid = await withTransaction(async (q) => {
    const { rows: t } = await q('SELECT till_credits FROM storefronts WHERE zone_id=$1 FOR UPDATE', [zone.id]);
    if ((t[0]?.till_credits ?? 0) < order.price) return false;
    const { rows: o } = await q('SELECT wanted FROM storefront_orders WHERE id=$1 FOR UPDATE', [order.id]);
    if (!o.length || o[0].wanted < 1) return false;
    await q('UPDATE storefronts SET till_credits = till_credits - $1 WHERE zone_id=$2', [order.price, zone.id]);
    await q('UPDATE storefront_orders SET wanted = wanted - 1 WHERE id=$1', [order.id]);
    // One unit only: split the stack if they're carrying several.
    if ((row.quantity || 1) > 1) {
      await q('UPDATE player_inventory SET quantity = quantity - 1 WHERE id=$1', [row.inv_id]);
      await q(`INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data)
               VALUES ($1,$2,$3,1,$4,$5)`,
        [randomUUID(), stockOwner(zone.id), row.item_id, row.condition ?? 1.0, row.custom_data ?? null]);
    } else {
      await q(`UPDATE player_inventory SET player_id=$1, is_equipped=0, slot=NULL, layer=NULL, container_id=NULL WHERE id=$2`,
        [stockOwner(zone.id), row.inv_id]);
    }
    return true;
  });
  if (!paid) return { type: 'error', message: `The till can't cover ${order.price}₵. The offer's still up, but the money isn't there.` };

  await adjustCredits(player, order.price, undefined, 'storefront:supply');
  await query('DELETE FROM storefront_orders WHERE id=$1 AND wanted <= 0', [order.id]);
  const { rows: t } = await query('SELECT till_credits FROM storefronts WHERE zone_id=$1', [zone.id]);
  setDeed(zone.id, { ...deed, till_credits: t[0]?.till_credits ?? 0 });

  if (getLivePlayer(deed.owner_id)) sendToPlayer(deed.owner_id, { type: 'output', message:
    `<span style="color:var(--yellow)">₵ ORDER FILLED — ${player.handle} brought in a ${order.name}. Paid ${order.price}₵ from the till.</span>` });
  return { type: 'output', player_update: { credits: player.credits }, message:
    `You hand over the <b>${order.name}</b> and the till counts out <span style="color:var(--yellow)">${order.price}₵</span>.\n` +
    `<span class="text-dim">It goes on the shelf unpriced — the owner will set a price on it.</span>` };
}

// ── SIFT selection replays (builtin replay can't reach plugin verbs) ─────────
registerAction({ type: 'storefront.buy', handler: ({ actor, params }) => purchaseListing(params.target, actor) });
// Cross-plugin seam: plain `buy <item>` is commerce's verb, and it means the same
// thing over a player's counter as over a vendor's. When commerce finds no vendor
// in the room it re-dispatches here rather than saying "no vendor" in a shop that
// plainly has goods on the shelf. Registered by name so commerce never imports us.
registerAction({ type: 'storefront.buy_by_name', handler: ({ actor, params }) => cmdBuyWare(params.words || [], actor) });
registerAction({ type: 'storefront.unstock', handler: ({ actor, params }) => takeBackListing(params.target, actor) });
registerAction({ type: 'storefront.pocket', handler: ({ actor, params }) => pocketListing(params.target, actor) });
registerAction({ type: 'storefront.supply', handler: ({ actor, params }) => fillOrder(params.target, actor) });

export const commands = {
  deed:        (args, raw, player) => cmdDeed(player),
  buyshop:     (args, raw, player) => cmdBuyShop(player),
  renameshop:  (args, raw, player) => cmdRenameShop(args, player),
  sellshop:    (args, raw, player) => cmdSellShop(player),
  stock:       (args, raw, player) => cmdStock(args, player),
  unstock:     (args, raw, player) => cmdUnstock(args, player),
  wares:       (args, raw, player) => cmdWares(player),
  buyware:     (args, raw, player) => cmdBuyWare(args, player),
  till:        (args, raw, player) => cmdTill(player),
  tillcrackresolve: (args, raw, player) => cmdTillCrackResolve(args, raw, player),
  shutters:    (args, raw, player) => cmdShutters(args, player),
  hire:        (args, raw, player) => cmdHire(args, player),
  sack:        (args, raw, player) => cmdSack(args, player),
  staff:       (args, raw, player) => cmdStaff(player),
  pocket:      (args, raw, player) => cmdPocket(args, player),
  buyorder:    (args, raw, player) => cmdBuyOrder(args, player),
  buyorders:   (args, raw, player) => cmdBuyOrders(player),
  supply:      (args, raw, player) => cmdSupply(args, player),
};

export const hooks = {
  'zone.describeRoom': describeRoom,
};

// `hack` is tag-gated on the vault furniture so examining it advertises the verb.
// The handler self-gates (undefined when there's no shop vault here) so a vendor
// safe or a hololock door in the same room still claims `hack`.
export const specializedActions = [
  { verb: 'hack', requiredTag: 'shop_vault', handler: cmdHackVault },
];

// Internals the regress suite drives directly — it needs two real player rows to
// exercise a sale, which `run()` (one fake player, no DB row) can't give it.
export const _test = {
  cmdDeed, cmdBuyShop, cmdRenameShop, cmdSellShop, cmdStock, cmdUnstock,
  cmdWares, cmdBuyWare, cmdTill, listingsFor, stockOwner, describeRoom,
  cmdShutters, cmdHire, cmdSack, cmdStaff, cmdPocket, carriedUnpaid,
  cmdBuyOrder, cmdBuyOrders, cmdSupply, ordersFor, staffFor, footfallTick,
  shutterDoorsFor, FOOTFALL_MAX_MARKUP, ROLES,
  MAX_MISSED, MAX_LISTINGS, SHOP_UNPAID,
};

console.log('[storefront] Plugin loaded.');
