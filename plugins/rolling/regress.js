// Rolling plugin regression suite — run by tests/regress.js (never in production).
// The fake player owns no inventory (DB writes against its id are no-ops), so we
// assert the routing + empty-handed gating.
export default async function regress({ run, check }) {
  let r = await run('roll');
  check('roll verb routed', /no loose cannabis or tobacco/i.test(r?.message || ''), r?.message);

  r = await run('roll 3 cannabis');
  check('roll cannabis with none is refused', /no loose cannabis/i.test(r?.message || ''), r?.message);

  r = await run('roll all tobacco');
  check('roll tobacco with none is refused', /no loose tobacco/i.test(r?.message || ''), r?.message);
}
