// Commerce plugin regression suite — run by tests/regress.js (never loaded in
// production). Zone-independent paths only (the fake player's zone may or may
// not contain a vendor).
import { vendorGrudgeRemaining, grudgeRefusal } from '../../server/engine/vendor-grudge.js';

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
}
