// dev-tools plugin regression suite — run by tests/regress.js (never loaded in
// production). Both verbs are admin-gated and mutate live rows (players/furniture/
// power), so we exercise only the pure, no-mutation gate: a non-admin is refused
// before any DB write happens.
export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const savedRole = p.role;

  p.role = 'player';
  let r = await run('lettherebelight');
  check('lettherebelight refused for non-admin', /unknown command/i.test(r?.message || ''), r?.message);

  r = await run('dresscyd');
  check('dresscyd refused for non-admin', /unknown command/i.test(r?.message || ''), r?.message);

  p.role = savedRole;
}
