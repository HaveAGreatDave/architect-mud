// Commerce plugin regression suite — run by tests/regress.js (never loaded in
// production). Zone-independent paths only (the fake player's zone may or may
// not contain a vendor).
export default async function regress({ run, check }) {
  let r = await run('shop');
  check('shop verb routed', /Browse whose shop/.test(r?.message || ''), r?.message);

  r = await run('buy');
  check('buy verb routed', /Buy what/.test(r?.message || ''), r?.message);

  r = await run('sell');
  check('sell verb routed', /Sell what/.test(r?.message || ''), r?.message);

  r = await run('balance');
  check('balance verb routed', r?.type === 'balance' && /Carried:/.test(r?.message || ''), r?.message);
}
