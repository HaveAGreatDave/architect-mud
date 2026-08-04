// storefront regression suite — run by tests/regress.js (never loaded in production).
//
// Verb routing goes through `run` on the harness player (who is not standing in a
// shop, so those are the refusal branches). The interesting half — deed → stock →
// a second player buys → till → mortgage → surrender — needs two REAL `players`
// rows, because adjustCredits only moves credits that exist in the table. Those
// are created here against a scratch storefront zone and torn down in `finally`,
// the same pattern the vendor-stock suite in tests/regress.js uses.
import { query } from '../../server/models/db.js';
import { world, getZone } from '../../server/engine/world.js';
import { getRegisteredActions } from '../../server/engine/actions.js';
import { getRegisteredMoveGates } from '../../server/engine/movement-gates.js';
import { getAllLockTypes } from '../../server/engine/locks.js';
import { reloadItem } from '../../server/engine/items-cache.js';
import { authoredTerms, getDeed, releaseShop, mortgageTick, ownsShop, shopDisplayName, _test } from './index.js';

export default async function regress({ run, check }) {
  // The door asks before you shoplift out of a player's shop too — the gate that
  // asks, and the settle action commerce's `yes` reaches back for.
  check('unpaid-door move gate registered',
    getRegisteredMoveGates().includes('storefront:unpaid-door'), getRegisteredMoveGates().join(','));
  check('the door prompt has something to settle with',
    getRegisteredActions().includes('storefront.settle_unpaid'), 'storefront.settle_unpaid missing');

  // ── Pure: authored terms are content, with defaults ────────────────────────
  const bare = authoredTerms({ flags: {} });
  check('unpriced unit falls back to the default terms', bare.price === 6000 && bare.term === 8 && bare.upkeep === 40, JSON.stringify(bare));
  check('the instalment is price ÷ term, rounded up', authoredTerms({ flags: { shop_price: 9000, shop_term: 10 } }).weekly === 900);
  check('a price that does not divide evenly rounds the instalment up',
    authoredTerms({ flags: { shop_price: 4500, shop_term: 8 } }).weekly === 563);
  check('a zero/nonsense price falls back rather than dividing by nothing',
    authoredTerms({ flags: { shop_price: 0, shop_term: 0 } }).price === 6000 && authoredTerms({ flags: { shop_term: 0 } }).term === 8);
  check('upkeep of exactly 0 is honoured (free to hold), not defaulted',
    authoredTerms({ flags: { shop_upkeep: 0 } }).upkeep === 0);

  check('ownsShop rejects an unowned deed', !ownsShop({ id: 'p1' }, { owner_id: null }));
  check('ownsShop rejects someone else\'s deed', !ownsShop({ id: 'p1' }, { owner_id: 'p2' }));
  check('ownsShop accepts the holder', ownsShop({ id: 'p1' }, { owner_id: 'p1' }));
  check('an unnamed shop falls back to the building name',
    shopDisplayName({ name: 'Unit 4', flags: { building_name: 'Unit 4, Marrow Street' } }, {}) === 'Unit 4, Marrow Street');
  check('a renamed shop wins over the building name',
    shopDisplayName({ name: 'Unit 4', flags: { building_name: 'Unit 4, Marrow Street' } }, { shop_name: 'Cheap Ammo' }) === 'Cheap Ammo');

  // ── Verb routing (harness player is not in a shop) ─────────────────────────
  for (const verb of ['deed', 'buyshop', 'wares', 'till', 'sellshop', 'stock', 'unstock', 'buyware',
                      'renameshop', 'shutters', 'hire', 'sack', 'staff', 'pocket', 'buyorder', 'buyorders', 'supply']) {
    const r = await run(verb);
    check(`${verb} routed and refuses outside a shop`, /no shop unit here/i.test(r?.message || ''), `${verb}: ${r?.message}`);
  }

  check('the cross-plugin buy seam is registered for commerce',
    getRegisteredActions().includes('storefront.buy_by_name'), getRegisteredActions().filter(a => a.startsWith('storefront')).join(','));
  check('SIFT replays are registered', ['storefront.buy', 'storefront.unstock', 'storefront.pocket', 'storefront.supply']
    .every(a => getRegisteredActions().includes(a)));

  // The shutter lock type has to be registered or every shutter door in content is
  // an unauthable slab nobody — including the owner — can work.
  check('the shopshutter lock type is registered',
    getAllLockTypes().some(t => t.name === 'shopshutter' && t.tagType === 'lock:shopshutter'),
    getAllLockTypes().map(t => t.name).join(','));

  // ── The shipped content is actually claimable ──────────────────────────────
  const units = [...world.zones.values()].filter(z => z.flags?.is_storefront);
  check('vacant shopfronts ship in content', units.length >= 4, `${units.length} unit(s)`);
  for (const u of units) {
    const t = authoredTerms(u);
    check(`${u.id} is priced and reachable`, t.price > 0 && t.weekly > 0 && Object.keys(u.exits || {}).length > 0,
      `price=${t.price} weekly=${t.weekly} exits=${JSON.stringify(u.exits)}`);
    // A shop with no vault has takings nobody can steal — the risk half of the
    // design silently missing. Content bug, caught here rather than in play.
    const { rows } = await query(`SELECT 1 FROM furniture WHERE zone_id=$1 AND flags @> '{"shop_vault":true}' LIMIT 1`, [u.id]);
    check(`${u.id} has a vault to hold the till`, rows.length === 1);
    // And a shutter, or the shop can never be closed and the vault is a 24h target.
    check(`${u.id} has a shutter door fitted`, _test.shutterDoorsFor(u.id).length === 1,
      `${_test.shutterDoorsFor(u.id).length} shutter door(s)`);
    // A VACANT unit must never ship sealed — same law as an unrented apartment.
    check(`${u.id} ships with the shutter open`,
      _test.shutterDoorsFor(u.id).every(d => d.lock_state !== 'locked'));
  }

  // ── End-to-end: deed → stock → sale → till → instalment → surrender ────────
  const ZONE = 'zone_sf_regress';
  const OWNER = `sf_owner_${process.pid}`;
  const BUYER = `sf_buyer_${process.pid}`;
  const ITEM = 'item_sf_regress';
  let created = false;
  try {
    await query(
      `INSERT INTO zones (id,name,description,map_id,grid_x,grid_y,grid_z,exits,flags)
       VALUES ($1,'Regress Unit','A scratch unit.','map_world',-90,-90,0,'{}'::jsonb,$2::jsonb)
       ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags`,
      [ZONE, JSON.stringify({ is_storefront: true, shop_price: 800, shop_term: 4, shop_upkeep: 10 })]);
    created = true;
    world.zones.set(ZONE, { id: ZONE, name: 'Regress Unit', exits: {}, players: new Set(),
      flags: { is_storefront: true, shop_price: 800, shop_term: 4, shop_upkeep: 10 } });

    for (const [id, credits] of [[OWNER, 5000], [BUYER, 5000]]) {
      await query(
        `INSERT INTO players (id, username, password_hash, handle, credits) VALUES ($1,$2,'x',$3,$4)
         ON CONFLICT (id) DO UPDATE SET credits=$4, bank_credits=0`, [id, id, id, credits]);
    }
    await query(
      `INSERT INTO items (id,name,description,type,value,weight,tags)
       VALUES ($1,'regress trinket','a regress trinket','misc',10,100,'{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`, [ITEM]);
    await reloadItem(ITEM);

    const owner = { id: OWNER, handle: 'ShopOwner', credits: 5000, current_zone: ZONE };
    const buyer = { id: BUYER, handle: 'ShopBuyer', credits: 5000, current_zone: ZONE };

    // The board reads as for-sale before anyone signs.
    let r = await _test.cmdDeed(owner);
    check('a vacant unit advertises its price', /UNIT FOR SALE/.test(r.message) && /800c/.test(r.message), r.message);
    check('the room description advertises it too', /FOR SALE/.test(await _test.describeRoom(getZone(ZONE)) || ''));

    // Sign. 800 over 4 cycles = 200 down.
    r = await _test.cmdBuyShop(owner);
    check('buyshop takes the first instalment', owner.credits === 4800, `credits=${owner.credits}`);
    let deed = getDeed(ZONE);
    check('the deed records the buyer', deed?.owner_id === OWNER && deed.payments_made === 1 && deed.payments_total === 4, JSON.stringify(deed));
    check('a fresh mortgage is not paid off', deed.paid_off === 0);

    r = await _test.cmdBuyShop(buyer);
    check('a second buyer is refused once it is sold', /already holds the deed/.test(r.message), r.message);

    // Name over the door lives on the deed, never on the zone (content drift).
    await _test.cmdRenameShop(['Cheap', 'Ammo'], owner);
    check('renameshop writes the deed, not the zone',
      getDeed(ZONE).shop_name === 'Cheap Ammo' && getZone(ZONE).name === 'Regress Unit');

    // Stock something. The item has to be in the owner's inventory first.
    const invId = `inv_sf_${process.pid}`;
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,is_equipped) VALUES ($1,$2,$3,1,0)
                 ON CONFLICT (id) DO UPDATE SET player_id=$2`, [invId, OWNER, ITEM]);

    r = await _test.cmdStock(['regress', 'trinket', 'for', '250'], owner);
    check('stock puts the item on the display at the asking price', /250c/.test(r.message), r.message);
    let listings = await _test.listingsFor(ZONE);
    check('the listing is the SAME inventory row, re-owned', listings.length === 1 && listings[0].id === invId, JSON.stringify(listings));
    check('the asking price rides on the row', listings[0].price === 250);

    r = await _test.cmdStock(['regress trinket'], owner);
    check('stock without a price is refused', /Name a price/.test(r.message), r.message);

    // Anyone in the room can buy it. This is the whole point: the owner does not
    // have to be online, and nothing here consults their session.
    r = await _test.cmdBuyWare(['trinket'], buyer);
    check('a second player buys off the display', r.type === 'buy' && buyer.credits === 4750, `${r.type} credits=${buyer.credits}`);
    const { rows: owned } = await query('SELECT player_id, custom_data FROM player_inventory WHERE id=$1', [invId]);
    check('the bought row transfers to the buyer', owned[0]?.player_id === BUYER, owned[0]?.player_id);
    check('the asking price is stripped on sale', !(owned[0]?.custom_data || {}).list_price, JSON.stringify(owned[0]?.custom_data));
    check('the takings land in the till, not the owner\'s pocket',
      getDeed(ZONE).till_credits === 250 && owner.credits === 4800, `till=${getDeed(ZONE).till_credits} credits=${owner.credits}`);
    check('the display is empty again', (await _test.listingsFor(ZONE)).length === 0);

    r = await _test.cmdBuyWare(['trinket'], owner);
    check('the owner cannot buy from their own bare display', /display is bare/i.test(r.message), r.message);

    // ── Staff ────────────────────────────────────────────────────────────────
    // Hiring must never touch `npcs` — that's a CONTENT-class table, and a
    // player-created row there would land in the git content tree on the next
    // export. This assertion is the whole reason staff are virtual.
    const npcsBefore = (await query('SELECT COUNT(*)::int AS n FROM npcs')).rows[0].n;
    r = await _test.cmdHire(['guard'], owner);
    check('hire puts someone on the payroll', /per cycle/.test(r.message), r.message);
    const npcsAfter = (await query('SELECT COUNT(*)::int AS n FROM npcs')).rows[0].n;
    check('hiring writes NO npcs row (content-class table)', npcsBefore === npcsAfter, `${npcsBefore} → ${npcsAfter}`);
    check('the guard is on the books', (await _test.staffFor(ZONE)).some(m => m.role === 'guard'));
    r = await _test.cmdHire(['guard'], owner);
    check('you cannot hire two of the same role', /already have a guard/.test(r.message), r.message);
    r = await _test.cmdHire([], owner);
    check('bare hire lists the roles and their wages', /clerk/.test(r.message) && /guard/.test(r.message), r.message);
    check('staff show in the room description', /stands by the door/.test(await _test.describeRoom(getZone(ZONE)) || ''));

    // ── Shoplifting ──────────────────────────────────────────────────────────
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,is_equipped) VALUES ($1,$2,$3,1,0)
                 ON CONFLICT (id) DO UPDATE SET player_id=$2, custom_data=NULL`, [invId, OWNER, ITEM]);
    await _test.cmdStock(['regress trinket for 250'], owner);

    r = await _test.cmdPocket(['trinket'], buyer);
    check('pocket lifts the item off the display', /isn't yours yet/.test(r.message), r.message);
    let unpaid = await _test.carriedUnpaid(BUYER, ZONE);
    check('the lifted row is marked unpaid against this shop', unpaid.length === 1 && unpaid[0].id === invId, JSON.stringify(unpaid));
    check('the display no longer holds it', (await _test.listingsFor(ZONE)).length === 0);
    r = await _test.cmdPocket(['trinket'], owner);
    check('the owner cannot pocket their own stock', /your own stock/i.test(r.message), r.message);

    // Settling up is the honest way out, and it pays the till like any sale.
    const creditsBeforeSettle = buyer.credits;
    r = await _test.cmdBuyWare(['trinket'], buyer);
    check('buyware settles something already pocketed', r.type === 'buy' && buyer.credits === creditsBeforeSettle - 250,
      `${r.type} credits=${buyer.credits}`);
    check('settling clears the unpaid mark', (await _test.carriedUnpaid(BUYER, ZONE)).length === 0);
    check('settling pays the till', getDeed(ZONE).till_credits === 500, `till=${getDeed(ZONE).till_credits}`);

    // ── Shutters ─────────────────────────────────────────────────────────────
    // No shutter door exists on the scratch zone, so this is the refusal branch —
    // the shipped units' real doors are asserted above.
    r = await _test.cmdShutters([], owner);
    check('a unit with no shutter fitted says so', /no shutter fitted/.test(r.message), r.message);

    // ── Buy orders ───────────────────────────────────────────────────────────
    r = await _test.cmdBuyOrder(['regress', 'trinket', 'for', '30'], owner);
    check('buyorder posts a standing offer', /30c/.test(r.message), r.message);
    let orders = await _test.ordersFor(ZONE);
    check('the order is live', orders.length === 1 && orders[0].price === 30, JSON.stringify(orders));
    check('the orders board shows on LOOK', /is buying/.test(await _test.describeRoom(getZone(ZONE)) || ''));

    // Supplying pays out of the TILL, not thin air.
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,is_equipped) VALUES ($1,$2,$3,1,0)`,
      [`${invId}_b`, BUYER, ITEM]);
    const tillBefore = getDeed(ZONE).till_credits;
    const buyerBefore = buyer.credits;
    r = await _test.cmdSupply(['regress trinket'], buyer);
    check('supply pays the seller from the till', buyer.credits === buyerBefore + 30, `credits=${buyer.credits}`);
    check('the till is debited', getDeed(ZONE).till_credits === tillBefore - 30, `till=${getDeed(ZONE).till_credits}`);
    check('the supplied goods land on the shelf', (await _test.listingsFor(ZONE)).length === 1);
    check('a filled order closes', (await _test.ordersFor(ZONE)).length === 0);

    r = await _test.cmdSupply(['regress trinket'], owner);
    check('the owner cannot supply their own shop', /your own shop/i.test(r.message), r.message);

    // An order the till can't fund must refuse rather than mint credits.
    await _test.cmdBuyOrder(['regress trinket for 999999'], owner);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,is_equipped) VALUES ($1,$2,$3,1,0)`,
      [`${invId}_c`, BUYER, ITEM]);
    const brokeBefore = buyer.credits;
    r = await _test.cmdSupply(['regress trinket'], buyer);
    check('an unfundable order refuses instead of minting credits',
      /can't cover/.test(r.message) && buyer.credits === brokeBefore, `${r.message} credits=${buyer.credits}`);
    await query('DELETE FROM storefront_orders WHERE zone_id=$1', [ZONE]);

    // ── Footfall ─────────────────────────────────────────────────────────────
    // Forced (no dice) so the assertion is about the RULES, not a coin flip. The
    // shelf currently holds the supplied trinket, unpriced — worth 10, so an
    // absurd price must be ignored and a fair one must sell.
    const shelf = (await _test.listingsFor(ZONE))[0];
    await query(`UPDATE player_inventory SET custom_data = jsonb_build_object('list_price', 9999) WHERE id=$1`, [shelf.id]);
    await _test.footfallTick(true);
    check('passers-by will not pay an absurd markup', (await _test.listingsFor(ZONE)).length === 1);

    await query(`UPDATE player_inventory SET custom_data = jsonb_build_object('list_price', 12) WHERE id=$1`, [shelf.id]);
    const tillPreFootfall = getDeed(ZONE).till_credits;
    await _test.footfallTick(true);
    check('a fairly-priced shelf sells to passing trade', (await _test.listingsFor(ZONE)).length === 0);
    check('footfall pays into the till', getDeed(ZONE).till_credits === tillPreFootfall + 12,
      `till=${getDeed(ZONE).till_credits}`);

    // A shut shop takes no passing trade — that's the cost of closing.
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,custom_data) VALUES ($1,$2,$3,1,$4)`,
      [`${invId}_d`, _test.stockOwner(ZONE), ITEM, JSON.stringify({ list_price: 12 })]);
    await query('UPDATE storefronts SET shutters_closed=1 WHERE zone_id=$1', [ZONE]);
    setDeedShutters(ZONE, 1);
    await _test.footfallTick(true);
    check('a shuttered shop takes no passing trade', (await _test.listingsFor(ZONE)).length === 1);
    await query('UPDATE storefronts SET shutters_closed=0 WHERE zone_id=$1', [ZONE]);
    setDeedShutters(ZONE, 0);
    await query('DELETE FROM player_inventory WHERE player_id=$1', [_test.stockOwner(ZONE)]);

    // Payroll rides the billing cycle, so reset the till to a known figure and
    // clear the guard before the mortgage assertions below (which assume no wages).
    await _test.cmdSack(['guard'], owner);
    check('sack clears the role', (await _test.staffFor(ZONE)).length === 0);
    await query('UPDATE storefronts SET till_credits=250 WHERE zone_id=$1', [ZONE]);
    setDeedTill(ZONE, 250);
    await query('UPDATE players SET credits=4800, bank_credits=0 WHERE id=$1', [OWNER]);
    owner.credits = 4800;

    // ── The instalment drafts from the till first ────────────────────────────
    // The harness never boots the environment, so gameToday() is null here and
    // the tick would no-op — drive it on a fixed in-world date instead, and stage
    // each bill by back-dating due_date behind it.
    const TODAY = '2087-06-10';
    const bill = async () => {
      await query(`UPDATE storefronts SET due_date=$1 WHERE zone_id=$2`, ['2087-06-01', ZONE]);
      await mortgageTick(TODAY);
    };

    await bill();
    deed = getDeed(ZONE);
    check('the instalment is drafted from the till', deed.till_credits === 50 && deed.payments_made === 2,
      `till=${deed.till_credits} made=${deed.payments_made}`);
    check('paying from the till does not touch the owner\'s credits',
      (await query('SELECT credits FROM players WHERE id=$1', [OWNER])).rows[0].credits === 4800);
    check('the due date rolls forward past today',
      String(deed.due_date ?? '').slice(0, 10) > TODAY, String(deed.due_date));

    // ── Clearing the term buys it outright ──────────────────────────────────
    for (let i = 0; i < 2; i++) await bill();
    deed = getDeed(ZONE);
    check('clearing the term pays the shop off', deed.paid_off === 1 && deed.payments_made === 4,
      `paid_off=${deed.paid_off} made=${deed.payments_made}`);

    // Once paid off it is upkeep only — payments_made must stop climbing.
    await bill();
    deed = getDeed(ZONE);
    check('a paid-off shop is charged upkeep, not another instalment',
      deed.paid_off === 1 && deed.payments_made === 4, `made=${deed.payments_made}`);

    // ── Default → repossession ──────────────────────────────────────────────
    // Strand the owner: no till, no bank, no credits, and an upkeep bill.
    await query('UPDATE players SET credits=0, bank_credits=0 WHERE id=$1', [OWNER]);
    await query(`UPDATE storefronts SET till_credits=0 WHERE zone_id=$1`, [ZONE]);
    await bill();
    check('the first miss is a warning, not an eviction', getDeed(ZONE)?.missed === 1, JSON.stringify(getDeed(ZONE)));

    await bill();
    check(`missing ${_test.MAX_MISSED} in a row loses the shop`, getDeed(ZONE) === null, JSON.stringify(getDeed(ZONE)));
    const { rows: after } = await query('SELECT 1 FROM storefronts WHERE zone_id=$1', [ZONE]);
    check('repossession clears the deed row, re-listing the unit', after.length === 0);

    // ── Surrender returns the stock and the till ────────────────────────────
    await query('UPDATE players SET credits=5000 WHERE id=$1', [OWNER]);
    owner.credits = 5000;
    await _test.cmdBuyShop(owner);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,is_equipped) VALUES ($1,$2,$3,1,0)
                 ON CONFLICT (id) DO UPDATE SET player_id=$2, custom_data=NULL`, [invId, OWNER, ITEM]);
    await _test.cmdStock(['regress trinket for 99'], owner);
    await query('UPDATE storefronts SET till_credits=120 WHERE zone_id=$1', [ZONE]);
    setDeedTill(ZONE, 120);
    r = await _test.cmdSellShop(owner);
    check('sellshop hands the unit back', getDeed(ZONE) === null, r.message);
    const { rows: back } = await query('SELECT player_id FROM player_inventory WHERE id=$1', [invId]);
    check('surrendering returns the stock to the owner', back[0]?.player_id === OWNER, back[0]?.player_id);
    check('surrendering pays out the till', owner.credits >= 5000 - 200 + 120, `credits=${owner.credits}`);
  } finally {
    await releaseShop(ZONE).catch(() => {});
    await query('DELETE FROM player_inventory WHERE player_id = ANY($1) OR player_id=$2',
      [[OWNER, BUYER], `_shopstock_${ZONE}`]).catch(() => {});
    await query('DELETE FROM players WHERE id = ANY($1)', [[OWNER, BUYER]]).catch(() => {});
    await query('DELETE FROM items WHERE id=$1', [ITEM]).catch(() => {});
    if (created) await query('DELETE FROM zones WHERE id=$1', [ZONE]).catch(() => {});
    world.zones.delete(ZONE);
  }
}

// The deed cache is written through by the plugin's own paths; the suite pokes
// till_credits directly in one place (to stage a surrender payout) and has to keep
// the cache honest with it.
function setDeedTill(zoneId, amount) {
  const d = getDeed(zoneId);
  if (d) d.till_credits = amount;
}
function setDeedShutters(zoneId, closed) {
  const d = getDeed(zoneId);
  if (d) d.shutters_closed = closed;
}
