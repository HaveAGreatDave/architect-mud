// Cosmetic-machine plugin regression suite — run by tests/regress.js (never
// loaded in production). `morphex` returns null when the current zone has no
// machine, or a panel when it does — both prove the verb is routed.
export default async function regress({ run, check }) {
  let r = await run('morphex');
  check('morphex verb routed', r === null || r?.type === 'morphex_panel', `type=${r?.type ?? 'null'}`);

  r = await run('use somejunkitem');
  check('use falls through machine intercept', r?.type === 'error' && !/Unknown command/.test(r.message || ''), r?.message);
}
