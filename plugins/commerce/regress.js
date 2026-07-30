// Commerce plugin regression suite — run by tests/regress.js (never loaded in
// production). Zone-independent paths only (the fake player's zone may or may
// not contain a vendor).
import { vendorGrudgeRemaining, grudgeRefusal } from '../../server/engine/vendor-grudge.js';
import { isVendorClosed, hoursUntilOpen, openInPhrase, vendorClosedLine } from '../../server/engine/ai-behaviour.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { getRegisteredMoveGates } from '../../server/engine/movement-gates.js';
import { rowIsInstanced, NOT_INSTANCED_SQL } from '../../server/engine/inventory.js';
import { getCrimeStars } from '../../server/engine/crimes.js';
import { world, streetExitFrom, isStreetLanding, isEnterableFacade } from '../../server/engine/world.js';
import { getItem } from '../../server/engine/items-cache.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export default async function regress({ run, check, getPlayer }) {
  let r = await run('shop');
  check('shop verb routed', /Browse whose shop/.test(r?.message || ''), r?.message);

  r = await run('buy');
  check('buy verb routed', /Buy what/.test(r?.message || ''), r?.message);

  r = await run('sell');
  check('sell verb routed', /Sell what/.test(r?.message || ''), r?.message);

  r = await run('balance');
  check('balance verb routed', r?.type === 'balance' && /Carried:/.test(r?.message || ''), r?.message);

  // Vendor grudge: a player with no history reads clean (SELECT-only, safe on
  // the in-memory fake player), and the shared refusal is well-formed. The full
  // rob→refuse→lapse round-trip writes a persistent flag and is manual QA.
  const clean = await vendorGrudgeRemaining(getPlayer().id, 'npc_regress_no_grudge');
  check('no grudge by default', clean === 0, `remaining=${clean}`);
  const refusal = grudgeRefusal({ name: 'Testvendor' }, 3 * 24 * 60 * 60 * 1000);
  check('grudge refusal names the vendor + a cooldown', /Testvendor/.test(refusal) && /day/.test(refusal), refusal.slice(0, 80));

  // ── Shop hours ─────────────────────────────────────────────────────────────
  // Synthetic vendors keyed off the LIVE game clock, so the assertions hold at
  // any time of day (the world clock runs during regress).
  const env = getEnvironmentState();
  const today = DAY_KEYS[env.dayOfWeek % 7];
  const hour = env.hour ?? 0;

  const allDay = { name: 'Alltimes', vendor_schedule: { [today]: [{ from: 0, to: 24 }] } };
  check('a vendor scheduled all day reads open', !isVendorClosed(allDay));
  check('an unscheduled vendor never closes', !isVendorClosed({ name: 'Nohours' }));
  check('no schedule quotes no reopening time', hoursUntilOpen({ name: 'Nohours' }) === null && openInPhrase({ name: 'Nohours' }) === '');

  if (hour < 20) {
    const later = { name: 'Latevendor', vendor_schedule: { [today]: [{ from: hour + 2, to: hour + 3 }] } };
    check('a vendor whose block is still ahead reads closed', isVendorClosed(later));
    const h = hoursUntilOpen(later);
    check('hoursUntilOpen counts down to the next block', h > 1 && h <= 2, `h=${h}`);
    check('the closed line quotes the wait', /open again in about \d+ (hour|minute)/.test(vendorClosedLine(later)), vendorClosedLine(later));
  }

  // Covert dealers keep their own window and are exempt from both.
  const covert = { name: 'Shade', flags: { covert: true }, vendor_schedule: { [today]: [{ from: 0, to: 0 }] } };
  check('covert dealers ignore vendor hours', !isVendorClosed(covert));

  check('shop-hours move gate registered', getRegisteredMoveGates().includes('commerce:shop-hours'), getRegisteredMoveGates().join(','));

  // ── Self-service checkout ──────────────────────────────────────────────────
  // Verb routing only; the fake player carries nothing marked unpaid, so this
  // exercises the empty-basket branch (the full pull→checkout→walk-out round trip
  // writes real inventory rows and is manual QA).
  r = await run('checkout');
  check('checkout verb routed', /nothing to pay for/i.test(r?.message || ''), r?.message);

  // The unpaid mark has to be instance-keyed both ways, or an unpaid steak merges
  // into a paid one on the way to the door and launders itself clean.
  check('unpaid is an instance key (JS)', rowIsInstanced({ custom_data: { unpaid: 'npc_x' } }));
  check('unpaid is an instance key (SQL)', NOT_INSTANCED_SQL.includes("'unpaid'"), NOT_INSTANCED_SQL);

  check('shoplifting is a chargeable crime', getCrimeStars('shoplifting') > 0, String(getCrimeStars('shoplifting')));

  // ── Vendor purchase remarks ────────────────────────────────────────────────
  // The wiring is generic, so what can actually break is the AUTHORING: a remark
  // keyed to an item the vendor doesn't stock (or that doesn't exist) is silently
  // dead content — the listener just never fires and nobody finds out. Sweep
  // every vendor in the world rather than naming one, so this holds for whatever
  // gets authored next.
  let remarkCount = 0;
  for (const npc of world.npcs.values()) {
    const remarks = npc.flags?.purchase_remarks;
    if (!remarks || typeof remarks !== 'object') continue;
    const stocked = new Set((npc.vendor_inventory || []).map(r => r.item_id));
    for (const [itemId, remark] of Object.entries(remarks)) {
      remarkCount++;
      check(`purchase remark on ${npc.id} targets a real item (${itemId})`, !!getItem(itemId));
      check(`purchase remark on ${npc.id} targets an item they SELL (${itemId})`, stocked.has(itemId),
        `stocks: ${[...stocked].join(',') || 'nothing'}`);
      const text = typeof remark === 'string' ? remark : remark?.text;
      check(`purchase remark on ${npc.id} has text (${itemId})`, !!text && text.length > 10);
    }
  }
  check('at least one vendor purchase remark is authored', remarkCount > 0, String(remarkCount));

  // ── Being put out lands you on the STREET ───────────────────────────────────
  // Closing time and the club bouncer both eject through streetExitFrom, and the one
  // destination that must never be chosen is a FACADE tile: `resolveLanding` forwards
  // a landing on a facade into that building's interior, so an eject onto one puts
  // the player inside the shop next door instead of on the pavement. Water is out for
  // the same class of reason (an ejection is not a drowning).
  //
  // Asserted as an invariant over the LIVE world rather than a fixture, because the
  // failure mode is a content shape — one shop whose only exit is a facade — and a
  // hand-built fixture would never contain the case that breaks it.
  {
    const interiors = [...world.zones.values()].filter(z => z.flags?.is_interior).slice(0, 400);
    let checked = 0;
    let bad = null;
    for (const z of interiors) {
      const dest = streetExitFrom(z.id);
      if (!dest) continue;              // sealed room — the caller leaves them put
      checked++;
      if (!isStreetLanding(dest)) { bad = `${z.id} → ${dest}`; break; }
    }
    check('every interior that can eject ejects onto standable street', !bad, bad || `${checked} rooms`);
    check('the eject search actually found streets (not vacuously true)', checked > 0, String(checked));
    // A facade is never a landing, and the predicate is what every ejector shares.
    const facade = [...world.zones.values()].find(z => isEnterableFacade(z));
    if (facade) check('a facade is never a valid eject landing', isStreetLanding(facade.id) === false, facade.id);
  }
}
