// Commerce plugin regression suite — run by tests/regress.js (never loaded in
// production). Zone-independent paths only (the fake player's zone may or may
// not contain a vendor).
import { vendorGrudgeRemaining, grudgeRefusal } from '../../server/engine/vendor-grudge.js';
import { isVendorClosed, hoursUntilOpen, openInPhrase, vendorClosedLine } from '../../server/engine/ai-behaviour.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { getRegisteredMoveGates } from '../../server/engine/movement-gates.js';
import { rowIsInstanced, NOT_INSTANCED_SQL } from '../../server/engine/inventory.js';
import { getCrimeStars } from '../../server/engine/crimes.js';

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
}
