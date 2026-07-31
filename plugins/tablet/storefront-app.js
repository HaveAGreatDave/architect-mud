// Tablet OS — Storefront app. The management console for shops you own.
//
// The storefront plugin was already mechanically complete — deed, till, staff,
// stock, buy orders, instalments, footfall income — but every one of those verbs
// is presence-gated through its own `here()` helper, which reads
// player.current_zone. So the numbers were only ever visible by standing in the
// shop and typing four different commands, and there was nowhere to see whether
// the place was actually making money.
//
// This app splits that in two, which is the honest split rather than a fabricated
// one (same call properties-app.js made about rent):
//
//   READING is remote. Takings, payroll, the next bill, stock value, outstanding
//   buy orders and a real profit line all read straight from the tables, so you
//   can check on the shop from a bar across the city.
//
//   ACTING is local. Hire/sack/till/shutters/stock all delegate to the REAL verb
//   handlers rather than reimplementing them — which means they inherit those
//   verbs' presence checks. Buttons are therefore only offered when you're
//   standing in that shop, and say so plainly when you aren't. Reimplementing
//   them here would have duplicated the mortgage/wage/vault logic, and the two
//   copies would have drifted the first time either changed.
//
// Read-tier note (docs/architecture.md): nothing here is on a hot path. Every
// query runs on an explicit tablet interaction, and the per-shop reads are
// batched with Promise.all rather than issued in a loop.
import { query } from '../../server/models/db.js';
import { getZone } from '../../server/engine/world.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { registerTabletApp, normScreen } from './registry.js';

// ── Reads ───────────────────────────────────────────────────────────────────

async function myShops(playerId) {
  const { rows } = await query(
    `SELECT zone_id, shop_name, till_credits, price, weekly_payment, payments_made,
            payments_total, upkeep, paid_off, missed, due_date
       FROM storefronts WHERE owner_id=$1 ORDER BY shop_name NULLS LAST, zone_id`,
    [playerId]
  );
  return rows;
}

// Listings are real player_inventory rows parked under a synthetic owner — the
// same shape the shop's own `wares` reads, so the tablet can never disagree with
// the counter about what's on the shelf.
async function stockOf(zoneId) {
  const { rows } = await query(
    `SELECT pi.quantity, i.name, pi.custom_data
       FROM player_inventory pi JOIN items i ON i.id=pi.item_id
      WHERE pi.player_id=$1`,
    [`_shopstock_${zoneId}`]
  );
  let value = 0, units = 0;
  const items = rows.map(r => {
    const price = Number(r.custom_data?.list_price) || 0;
    const qty = r.quantity || 1;
    const unpaid = !!r.custom_data?.shop_unpaid;
    value += price * qty; units += qty;
    return { name: r.name, qty, price, unpaid };
  }).sort((a, b) => b.price * b.qty - a.price * a.qty);
  return { items, value, units };
}

async function staffOf(zoneId) {
  const { rows } = await query(
    'SELECT role, name, wage FROM storefront_staff WHERE zone_id=$1 ORDER BY role',
    [zoneId]
  );
  return rows;
}

async function ordersOf(zoneId) {
  const { rows } = await query(
    `SELECT o.item_id, o.price, o.wanted, i.name
       FROM storefront_orders o LEFT JOIN items i ON i.id=o.item_id
      WHERE o.zone_id=$1 ORDER BY o.created_at`,
    [zoneId]
  );
  return rows;
}

// The P&L. Outgoings are the same arithmetic the mortgage tick bills on
// (instalment-or-upkeep + wages), deliberately mirrored rather than imported so
// this stays a read — but that means it must be kept honest if that changes, so
// the two are commented as a pair in plugins/storefront/index.js.
function economics(deed, staff, orders) {
  const wages = staff.reduce((s, m) => s + (m.wage || 0), 0);
  const instalment = deed.paid_off ? (deed.upkeep || 0) : (deed.weekly_payment || 0);
  const committed = orders.reduce((s, o) => s + (o.price || 0) * (o.wanted || 0), 0);
  return {
    wages, instalment, outgoings: instalment + wages, committed,
    // Can the till cover the next bill? This is the number that actually decides
    // whether you lose the place, so it gets its own line rather than being left
    // as mental arithmetic.
    shortfall: Math.max(0, (instalment + wages) - (deed.till_credits || 0)),
  };
}

function shopLabel(deed) {
  return deed.shop_name || getZone(deed.zone_id)?.name || deed.zone_id;
}

// ── Screens ─────────────────────────────────────────────────────────────────

async function buildHome(player) {
  const shops = await myShops(player.id);
  // The badge earns its place by warning, not by counting: a shop that can't make
  // its next payment is the thing you want to see from the home screen.
  const atRisk = [];
  await Promise.all(shops.map(async (d) => {
    const [staff, orders] = await Promise.all([staffOf(d.zone_id), ordersOf(d.zone_id)]);
    if (economics(d, staff, orders).shortfall > 0 || d.missed > 0) atRisk.push(d.zone_id);
  }));
  return { count: shops.length, badge: atRisk.length || undefined };
}

async function detailFor(player, deed) {
  const [stock, staff, orders] = await Promise.all([
    stockOf(deed.zone_id), staffOf(deed.zone_id), ordersOf(deed.zone_id),
  ]);
  const ec = economics(deed, staff, orders);
  const here = player.current_zone === deed.zone_id;

  const term = deed.paid_off
    ? 'Owned outright'
    : `${deed.payments_made}/${deed.payments_total} paid`;

  const rows = [
    { label: 'Till', value: `${deed.till_credits || 0}c` },
    { label: 'Stock', value: `${stock.units} item${stock.units === 1 ? '' : 's'} · ${stock.value}c listed` },
    { label: 'Payroll', value: staff.length ? `${staff.map(s => `${s.role} ${s.wage}c`).join(' · ')}` : 'No staff' },
    { label: deed.paid_off ? 'Upkeep' : 'Instalment', value: `${ec.instalment}c/cycle` },
    { label: 'Outgoings', value: `${ec.outgoings}c/cycle` },
    { label: 'Next bill', value: deed.due_date ? String(deed.due_date).slice(0, 10) : 'n/a' },
    { label: 'Term', value: term },
  ];
  if (ec.committed) rows.push({ label: 'Buy orders', value: `${orders.length} open · ${ec.committed}c committed` });
  // Warnings last, so the eye lands on them.
  if (ec.shortfall > 0) {
    rows.push({ label: '⚠ Shortfall', value: `${ec.shortfall}c short of the next bill` });
  }
  if (deed.missed > 0) {
    rows.push({ label: '⚠ Missed', value: `${deed.missed} payment${deed.missed === 1 ? '' : 's'} — two in a row loses the place` });
  }
  if (!here) {
    rows.push({ label: 'Management', value: 'Go to the shop to hire, collect or restock' });
  }

  // Only offer what will actually work from where the player is standing. A
  // button that always errors is worse than no button.
  const actions = [{ id: 'navigate', label: 'Navigate' }, { id: 'stock', label: 'Stock List' }];
  if (here) {
    actions.push({ id: 'till', label: 'Collect Till' });
    actions.push({ id: 'staff', label: 'Payroll' });
    if (!staff.some(s => s.role === 'clerk')) actions.push({ id: 'hireclerk', label: 'Hire Clerk' });
    if (!staff.some(s => s.role === 'guard')) actions.push({ id: 'hireguard', label: 'Hire Guard' });
    actions.push({ id: 'shutters', label: 'Shutters' });
  }

  return {
    view: 'detail',
    breadcrumb: [shopLabel(deed)],
    detail: { name: shopLabel(deed), desc: getZone(deed.zone_id)?.name || '', rows },
    actions,
  };
}

async function buildScreen(player, screenId, params) {
  const shops = await myShops(player.id);
  const screen = normScreen(screenId);
  const id = (params || '').trim();

  if (!shops.length) {
    return { view: 'error', message: 'You do not own a shop. Find a vacant unit and BUYSHOP it.' };
  }

  if (screen === 'stock' && id) {
    const deed = shops.find(s => s.zone_id === id);
    if (!deed) return { view: 'error', message: 'Shop not found.' };
    const stock = await stockOf(deed.zone_id);
    if (!stock.items.length) {
      return { view: 'error', message: `Nothing on the shelves at ${shopLabel(deed)}. STOCK an item there to list it.` };
    }
    return {
      view: 'list',
      breadcrumb: [shopLabel(deed), 'Stock'],
      items: stock.items.map((it, n) => ({
        id: `${deed.zone_id}`,
        label: `${it.qty > 1 ? `${it.qty}x ` : ''}${it.name}`,
        sub: `${it.price}c each${it.unpaid ? ' · UNPAID (lifted)' : ''}`,
      })),
    };
  }

  if (id) {
    const deed = shops.find(s => s.zone_id === id);
    if (!deed) return { view: 'error', message: 'Shop not found.' };
    return detailFor(player, deed);
  }

  // One shop is the common case — skip the list and open it.
  if (shops.length === 1) return detailFor(player, shops[0]);

  const subs = await Promise.all(shops.map(async (d) => {
    const [staff, orders] = await Promise.all([staffOf(d.zone_id), ordersOf(d.zone_id)]);
    const ec = economics(d, staff, orders);
    return ec.shortfall > 0 ? `⚠ ${d.till_credits || 0}c till · ${ec.shortfall}c short`
                            : `${d.till_credits || 0}c till · ${ec.outgoings}c/cycle`;
  }));
  return {
    view: 'list',
    breadcrumb: [],
    items: shops.map((d, n) => ({ id: d.zone_id, label: shopLabel(d), sub: subs[n] })),
  };
}

// ── Actions ─────────────────────────────────────────────────────────────────

// Delegate to the real verb. Every storefront command resolves the shop from
// player.current_zone itself, so passing the player through is all that's needed —
// and the verb's own ownership/presence errors surface unchanged.
async function runShopVerb(player, verb, args = []) {
  const { commands } = await import('../storefront/index.js');
  const fn = commands[verb];
  if (!fn) return { error: `No such action.` };
  const res = await fn(args, [verb, ...args].join(' '), player, () => {});
  return { message: res?.message, error: res?.type === 'error' ? res.message : null };
}

async function handleAction(player, actionId, params) {
  const zoneId = (params || '').trim();
  const shops = await myShops(player.id);
  const deed = shops.find(s => s.zone_id === zoneId) || shops[0];
  if (!deed) return { view: 'error', message: 'Shop not found.' };

  if (actionId === 'navigate') {
    const destZone = getZone(deed.zone_id);
    if (destZone && deed.zone_id !== player.current_zone) {
      const path = findPath(player.current_zone, deed.zone_id);
      if (path && path.length >= 2) {
        sendToPlayer(player.id, {
          type: 'gps_route',
          message: `GPS locked: ${shopLabel(deed)}. Route plotted on the map.`,
          path, continueOnArrival: false,
        });
      }
    }
    return detailFor(player, deed);
  }

  if (actionId === 'stock') return buildScreen(player, 'stock', deed.zone_id);

  const VERBS = {
    till: ['till', []],
    staff: ['staff', []],
    hireclerk: ['hire', ['clerk']],
    hireguard: ['hire', ['guard']],
    shutters: ['shutters', []],
  };
  const spec = VERBS[actionId];
  if (spec) {
    const out = await runShopVerb(player, spec[0], spec[1]);
    const screen = await detailFor(player, (await myShops(player.id)).find(s => s.zone_id === deed.zone_id) || deed);
    // Surface the verb's own words — it knows why it refused better than we do.
    if (out.error) screen.notify = out.error;
    else if (out.message) screen.notify = String(out.message).replace(/<[^>]+>/g, '').slice(0, 160);
    return screen;
  }

  return detailFor(player, deed);
}

registerTabletApp({
  id: 'storefront', name: 'Storefront', icon: '🏪', category: 'Assets',
  buildHome, buildScreen, handleAction,
});
