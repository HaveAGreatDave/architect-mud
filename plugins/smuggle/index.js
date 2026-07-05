/**
 * Smuggle plugin — the raw-drug supply loop (Phase 2 of the raw-supply chain).
 *
 * You can't buy raw over a counter. You place a black-market order **through a
 * fence NPC's dialogue** (Sully at the Pigeon Bar), a criminal MULE drone drops
 * a cipher-locked crate at a far lawless airstrip (the Scald), and you go crack
 * it open and smuggle the contents back past a checkpoint into the city.
 *
 * The pieces:
 *   • `PLACE_SMUGGLE_ORDER` action — fired from a dialogue option (params
 *     {itemId, qty}); debits credits and writes a `smuggle_orders` row. On
 *     insufficient funds it returns GOTO_NODE → a "you're short" dialogue node.
 *   • 1-minute delivery tick — once deliver_at passes, spawns a **MULE crate**
 *     (item_mule_crate, cipher-locked to the buyer via custom_data) on the ground
 *     at DROP_ZONE and pings the buyer.
 *   • `unpack` (tag-gated on `mule_crate`) — crack the crate: transfer the raw,
 *     ditch the shell, and **build trust** with the fence (`bm_trust` flag), which
 *     is what widens the fence's order menu (gated in his dialogue tree). This is
 *     the "order AND pickup" that earns standing.
 *   • Checkpoint move gate (`smuggle:checkpoint`) — carry raw into a
 *     flags.checkpoint zone → a Deception check scaled to cook_tier; fail =
 *     WANTED_RAISE manufacturing + bounced back + a 45s guard-heat cooldown. The
 *     scanner sees bagged raw too (unlike the street cameras). The sealed crate
 *     itself is tagged raw_drug at cook_tier 5, so hauling it whole is the *hardest*
 *     thing to sneak — you're meant to unpack at the Scald first.
 *
 * The unlock: reaching the Fixer's (the covert dealer's) inner circle sets the
 * `dealer_inner_circle` flag (engine vendor.js), which is what opens Sully's
 * black-market branch — so street dealing is the on-ramp to drug manufacture.
 */
import { randomUUID } from 'crypto';
import { query, withTransaction } from '../../server/models/db.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { schedule } from '../../server/engine/scheduler.js';
import { skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { dispatchAction, registerAction } from '../../server/engine/actions.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getLivePlayer } from '../../server/engine/world.js';
import { getCrimeStars } from '../../server/engine/crimes.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';

const DROP_ZONE = 'zone_waste_scald';        // the Scald — lawless Redline airstrip, far off in the wastes
const DROP_NAME = 'the Scald airstrip';
const DELIVERY_MS = 3 * 60_000;              // MULE drop lands ~3 minutes after the order
const MARKUP = 2;                            // order cost = raw value × MARKUP × qty (must match the fence-menu prices)
const MAX_QTY = 10;
const HEAT_MS = 45_000;                      // a botched checkpoint keeps the guards watching you this long
const TRUST_FLAG = 'bm_trust';               // player's standing with the fence — gates his order menu (dialogue conditions)
const DELIVERY_COOLDOWN_MS = 2 * 60_000;     // standing/XP awarded at most once per this window — no back-and-forth checkpoint farming

const heat = new Map();                      // playerId → epoch ms the checkpoint stays hot (transient; fine to lose on restart)
const delivered = new Map();                 // playerId → epoch ms a successful raw run last paid out (anti-farm cooldown)

// ── placing an order (shared by the dialogue action) ──────────────────────────
// Debits credits and books a MULE drop. Server-authoritative: re-reads the raw's
// value rather than trusting anything the client sends.
async function placeOrder(player, itemId, qty, vendorId) {
  const { rows } = await query(
    `SELECT id, name, value FROM items WHERE id=$1 AND jsonb_exists(tags, 'raw_drug')`, [itemId]);
  if (!rows.length) return { ok: false, reason: 'noitem' };
  const item = rows[0];
  qty = Math.max(1, Math.min(MAX_QTY, Number(qty) || 1));
  const cost = Math.max(1, Math.round((item.value || 1) * MARKUP)) * qty;
  // Debit + book the order atomically: if the INSERT fails (e.g. the table isn't
  // migrated yet) the credit charge rolls back too — no eating the player's money
  // for an order that never lands.
  const before = player.credits;
  try {
    await withTransaction(async (q) => {
      if (!await adjustCredits(player, -cost, q)) throw new Error('broke');
      await q(
        `INSERT INTO smuggle_orders (id, player_id, item_id, item_name, qty, drop_zone, deliver_at, status, vendor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)`,
        [randomUUID(), player.id, item.id, item.name, qty, DROP_ZONE, Date.now() + DELIVERY_MS, vendorId || null]);
    });
  } catch (e) {
    player.credits = before; // tx rolled back — undo the in-memory debit adjustCredits applied
    if (e.message === 'broke') return { ok: false, reason: 'broke', cost };
    console.error('[smuggle] order failed, credits refunded:', e.message);
    return { ok: false, reason: 'error', cost };
  }
  return { ok: true, cost, name: item.name, qty };
}

// Dialogue option action: the fence takes an order. On success the receipt is
// pushed to the player and the dialogue proceeds to its `next` node; if they're
// short, redirect the conversation to the "you're broke" node (nothing charged).
registerAction({
  type: 'PLACE_SMUGGLE_ORDER',
  handler: async ({ actor, params, context }) => {
    const res = await placeOrder(actor, params?.itemId, params?.qty, context?.npc?.id);
    if (!res.ok) return { type: 'goto_node', node: 'bm_broke' };
    const mins = Math.round(DELIVERY_MS / 60000);
    sendToPlayer(actor.id, {
      type: 'output',
      message: `<span class="ambient">A word, a nod, credits gone. <b>${res.qty}× ${res.name}</b> for <b>${res.cost}₵</b> — a MULE drops it at ${DROP_NAME} in about ${mins} minute${mins === 1 ? '' : 's'}. (${actor.credits || 0}₵ left.)</span>`,
    });
    return { type: 'ok' };
  },
});

// ── delivery tick ─────────────────────────────────────────────────────────────
// Land any due MULE drops: spawn a cipher-locked crate on the ground at the drop
// zone and ping the buyer if online. Restart-safe — the order row carries deliver_at.
schedule('1m', async () => {
  const { rows } = await query(
    `SELECT id, player_id, item_id, item_name, qty, drop_zone, vendor_id FROM smuggle_orders
      WHERE status='pending' AND deliver_at <= $1`,
    [Date.now()]).catch(() => ({ rows: [] }));
  for (const o of rows) {
    const cd = JSON.stringify({ ownerId: o.player_id, itemId: o.item_id, itemName: o.item_name, qty: o.qty, orderId: o.id, vendorId: o.vendor_id });
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, custom_data)
       VALUES ($1,$2,'item_mule_crate',1,$3::jsonb)`,
      [`inv_mule_${randomUUID()}`, `_ground_${o.drop_zone}`, cd]);
    await query(`UPDATE smuggle_orders SET status='delivered' WHERE id=$1`, [o.id]);
    const p = getLivePlayer(o.player_id);
    if (p) sendToPlayer(p.id, {
      type: 'output',
      message: `<span class="ambient">Far out at ${DROP_NAME}, a MULE drone flares, thumps a crate onto the pad, and is gone into the haze. Your shipment (<b>${o.qty}× ${o.item_name}</b>) is out there — go and get it.</span>`,
    });
  }
});

// ── unpack (tag-gated on `mule_crate`) ────────────────────────────────────────
// Crack a delivered crate: transfer the raw, ditch the shell, and earn standing
// with the fence. The crate is cipher-locked to the buyer, so nobody can pinch
// your drop and cash the trust.
async function unpack(args, raw, player) {
  const { rows } = await query(
    `SELECT pi.id, pi.custom_data FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id=$1 AND pi.container_id IS NULL AND jsonb_exists(i.tags, 'mule_crate') LIMIT 1`,
    [player.id]);
  if (!rows.length) return undefined; // no crate on you → fall through
  const crate = rows[0], cd = crate.custom_data || {};
  if (cd.ownerId && cd.ownerId !== player.id)
    return { type: 'error', message: `The crate is cipher-locked to whoever ordered it — not you. It won't open.` };

  const rawId = cd.itemId, qty = Math.max(1, Number(cd.qty) || 1), rawName = cd.itemName || 'raw material';
  if (!rawId) return { type: 'error', message: `The crate is empty — a bad drop.` };

  // Transfer the raw (merge into an existing stack if you already carry some).
  const ex = await query(
    `SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL LIMIT 1`,
    [player.id, rawId]);
  if (ex.rows.length) await query(`UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2`, [qty, ex.rows[0].id]);
  else await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity) VALUES ($1,$2,$3,$4)`, [randomUUID(), player.id, rawId, qty]);

  await query(`DELETE FROM player_inventory WHERE id=$1`, [crate.id]);
  if (cd.orderId) await query(`UPDATE smuggle_orders SET status='collected' WHERE id=$1`, [cd.orderId]).catch(() => {});

  return {
    type: 'use',
    message: `<span class="ambient">You crack the MULE crate open, transfer <b>${qty}× ${rawName}</b> into your kit and boot the empty shell off the pad. Now get it home past the checkpoint — <b>that's</b> the run that earns your standing with the fence.</span>`,
  };
}

export const specializedActions = [
  { verb: 'unpack', requiredTag: 'mule_crate', handler: unpack },
];

// ── checkpoint move gate ──────────────────────────────────────────────────────
// Entering a flags.checkpoint zone with raw on you → a scanner run. Unlike the
// street cameras, the scanner sees bagged raw too (no container filter). The
// sealed MULE crate is tagged raw_drug at cook_tier 5, so hauling it whole is the
// hardest thing to sneak — unpack at the Scald first.
registerMoveGate(async ({ player, to }) => {
  if (!to?.flags?.checkpoint) return;                      // cheap: only the border zones pay for the query
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n, MAX((i.flags->>'cook_tier')::int) AS tier
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id=$1 AND jsonb_exists(i.tags, 'raw_drug')`,
    [player.id]).catch(() => ({ rows: [{ n: 0 }] }));
  const n = Number(rows[0]?.n || 0);
  if (!n) return;                                          // clean → walk through

  if (Date.now() < (heat.get(player.id) || 0))
    return { block: true, message: 'The checkpoint guards are still eyeing you from the last pass — hang back a moment, or find another way in.' };

  const tier = Math.max(1, Number(rows[0]?.tier || 1));
  const diff = 3 + tier;                                   // tier 1 → 4 (easy), tier 5 → 8 (hard)
  const chk = await skillCheck(player, 'deception', diff);
  if (chk.success) {
    const now = Date.now();
    if (now >= (delivered.get(player.id) || 0)) {
      // A genuine run into the city — pay standing (weighted by the raw's tier) +
      // Deception XP, then start a cooldown so pacing back and forth can't farm it.
      delivered.set(player.id, now + DELIVERY_COOLDOWN_MS);
      await awardSkillUse(player.id, 'deception', chk.margin);
      const gain = tier;
      const next = (Number(await getFlag('player', TRUST_FLAG, player)) || 0) + gain;
      await setFlag('player', TRUST_FLAG, String(next), player);
      sendToPlayer(player.id, { type: 'output', message: `<span class="ambient">You keep your hands loose and your face bored. The scanner blinks green; the guard waves you through — and you're in with the goods.</span>\n<span class="text-dim">A clean delivery. Your fence hears about it. (standing +${gain} → ${next})</span>` });
    } else {
      sendToPlayer(player.id, { type: 'output', message: `<span class="ambient">You keep your hands loose and your face bored. The scanner blinks green; the guard waves you through.</span>` });
    }
    return;                                                // pass
  }

  heat.set(player.id, Date.now() + HEAT_MS);
  await dispatchAction({ type: 'WANTED_RAISE', actor: player, params: { amount: getCrimeStars('manufacturing'), reason: 'manufacturing a controlled substance' } });
  return { block: true, message: `The scanner shrills — <b>raw material</b>. You spin on your heel and bolt back before they can box you in. Word’s already out: you’re wanted for manufacturing.` };
}, 'smuggle:checkpoint');
