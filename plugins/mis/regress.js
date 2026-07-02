// MIS plugin regression suite — run by tests/regress.js (never loaded in production).
// The harness's fake player has mis_enabled=0, so these verify the consent gate
// and the multi-word input-matcher routing.
export default async function regress({ run, check }) {
  let r = await run('touch self');
  check('verb gated when opted out', r?.type === 'error' && /Unknown command/.test(r.message || ''), r?.message);

  r = await run('jerk off on somebody');
  check('multi-word matcher routes + gates', r?.type === 'error' && /Unknown command/.test(r.message || ''), r?.message);

  r = await run('mis');
  check('mis toggle verb reachable', r != null && !/Unknown command/.test(r?.message || ''), r?.message);
}
