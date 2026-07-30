/**
 * smuggle plugin regress.
 *
 * Two things are covered: the tag-gated `unpack` verb failing safe with no crate,
 * and the BACK-ROOM SHELF that replaced the fence's dialogue fan-out. That second
 * half matters because the sale and the delivery are now separate systems meeting
 * inside one transaction: the engine's vendor takes the money, and smuggle's
 * purchase-delivery handler books the MULE drop instead of handing anything over.
 * If those ever come apart, the player pays and nothing is ever delivered.
 *
 * The checkpoint gate and the 1-minute delivery tick still can't be driven from the
 * command harness, so the crate's arrival isn't exercised here — only the order.
 */
import { query } from '../../server/models/db.js';
import { buyFromVendor } from '../../server/engine/vendor.js';
import { setFlag, clearFlag } from '../../server/engine/flags.js';

export default async ({ run, check, getPlayer }) => {
  const r = await run('unpack');
  check('unpack with no crate is handled (no throw)', r && typeof r === 'object' && r.type,
    JSON.stringify(r)?.slice(0, 120));

  const p = getPlayer?.();
  if (!p?.id) return;

  // A cheap tier-1 raw — whatever the drug roster currently holds.
  const { rows: raws } = await query(
    `SELECT id, name, value FROM items WHERE jsonb_exists(tags,'raw_drug')
      AND NOT jsonb_exists(tags,'mule_crate') AND COALESCE((flags->>'cook_tier')::int,1) = 1
      ORDER BY value LIMIT 1`);
  if (!raws.length) { check('a tier-1 raw exists to order', false, 'no raw_drug items'); return; }
  const raw = raws[0];
  const price = Math.max(1, Math.round((raw.value || 1) * 2));

  // adjustCredits needs a real players row to debit; the harness player has none.
  const { rows: had } = await query('SELECT id FROM players WHERE id=$1', [p.id]);
  await query(
    `INSERT INTO players (id, username, password_hash, handle, credits) VALUES ($1,$1,'x',$1,$2)
     ON CONFLICT (id) DO UPDATE SET credits=$2`, [p.id, price * 10]);
  p.credits = price * 10;
  await query('DELETE FROM smuggle_orders WHERE player_id=$1', [p.id]);
  await setFlag('player', 'bm_trust', '50', p);

  const fence = {
    id: 'npc_regress_fence', name: 'a regress fence',
    flags: { mule_counter: true, trust_flag: 'bm_trust', trust_per_buy: 0, trust_max: 100 },
    vendor_inventory: [
      { item_id: raw.id, price, min_trust: 0, shelf: 'back_room' },
      { item_id: 'item_drug_beer', price: 6, min_trust: 0 },     // his front counter
    ],
    vendor_stock: [], vendor_credits: 0,
  };
  await query(
    `INSERT INTO npcs (id, name, description, vendor_inventory, vendor_stock, vendor_credits, flags)
     VALUES ($1,$2,'a regress fence',$3::jsonb,'[]'::jsonb,0,$4::jsonb)
     ON CONFLICT (id) DO UPDATE SET vendor_inventory=EXCLUDED.vendor_inventory, flags=EXCLUDED.flags`,
    [fence.id, fence.name, JSON.stringify(fence.vendor_inventory), JSON.stringify(fence.flags)]);

  // The back room is only reachable by a sale that names the shelf. Buying raw off
  // the FRONT counter must be refused, or the covert half leaks: the client sends an
  // item id, so without the shelf check a bar patron could buy precursor.
  const leak = await buyFromVendor(p, fence, raw.id, 1, null);
  check('raw is not buyable from the front counter (the back room stays shut)',
    leak.success === false, JSON.stringify(leak.message));
  let { rows: leaked } = await query("SELECT COUNT(*)::int n FROM smuggle_orders WHERE player_id=$1", [p.id]);
  check('a front-counter attempt books no order', leaked[0]?.n === 0, JSON.stringify(leaked[0]));

  // …and on the back-room shelf it books a MULE drop instead of handing anything over.
  const buy = await buyFromVendor(p, fence, raw.id, 2, 'back_room');
  check('the back-room shelf sells raw', buy.success === true, JSON.stringify(buy.message));
  check('the receipt says a MULE is dropping it, not that you were handed it',
    /MULE/i.test(buy.message || ''), buy.message);
  const { rows: orders } = await query(
    "SELECT qty, status, drop_zone FROM smuggle_orders WHERE player_id=$1", [p.id]);
  check('a back-room sale books exactly one pending order', orders.length === 1, JSON.stringify(orders));
  check('the order carries the quantity bought', orders[0]?.qty === 2, JSON.stringify(orders[0]));
  check('the order is pending, bound for the drop zone',
    orders[0]?.status === 'pending' && !!orders[0]?.drop_zone, JSON.stringify(orders[0]));
  const { rows: inInv } = await query(
    'SELECT COUNT(*)::int n FROM player_inventory WHERE player_id=$1 AND item_id=$2', [p.id, raw.id]);
  check('nothing is handed across the bar (the crate is out at the drop)', inInv[0]?.n === 0, JSON.stringify(inInv[0]));

  // Standing must NOT come from paying — it's earned running crates through a gate.
  await setFlag('player', 'bm_trust', '50', p);
  await buyFromVendor(p, fence, raw.id, 1, 'back_room');
  const { rows: tr } = await query(
    "SELECT flag_value FROM player_flags WHERE player_id=$1 AND flag_key='bm_trust'", [p.id]);
  check('buying does not buy standing (trust_per_buy 0)', Number(tr[0]?.flag_value) === 50, JSON.stringify(tr[0]));

  await query('DELETE FROM smuggle_orders WHERE player_id=$1', [p.id]);
  await query('DELETE FROM npcs WHERE id=$1', [fence.id]);
  await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [p.id, 'item_drug_beer']);
  await clearFlag('player', 'bm_trust', p);
  if (!had.length) await query('DELETE FROM players WHERE id=$1', [p.id]);
};
