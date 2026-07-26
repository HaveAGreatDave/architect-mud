// dev-tools plugin regression suite — run by tests/regress.js (never loaded in
// production). These verbs are admin-gated and mutate live rows (players/furniture/
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

  r = await run('testaccolade');
  check('testaccolade refused for non-admin', /unknown command/i.test(r?.message || ''), r?.message);

  r = await run('heal');
  check('heal refused for non-admin', /unknown command/i.test(r?.message || ''), r?.message);

  // Admin path is safe to exercise: it only pushes a WS message to the caller
  // (a no-op for the fake player) and writes nothing.
  p.role = 'admin';
  r = await run('testaccolade 3');
  check('testaccolade fires for admin', /Fired <b>3<\/b>/.test(r?.message || ''), r?.message);
  check('testaccolade logs nothing', /no row, no XP/.test(r?.message || ''), r?.message);

  p.role = savedRole;
}
