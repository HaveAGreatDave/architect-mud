// Weapon plugin regression — the admin `kamehameha` verb's routing + role gate.
// (The core attack/kill/corpse mechanics are exercised by the main dispatch suite
// in tests/regress.js; this just guards the new admin insta-gib verb.)
export default async function regress({ run, check, getPlayer }) {
  // Non-admins get the generic unknown-command reply — the verb stays hidden.
  const denied = await run('kamehameha');
  check('kamehameha denied for non-admin', /Unknown command/.test(denied?.message || ''), denied?.message);

  // An admin passes the gate (the outcome is a blast or an empty-room notice,
  // never the unknown-command reply).
  const p = getPlayer();
  const prevRole = p.role;
  p.role = 'admin';
  const fired = await run('kamehameha');
  check('kamehameha runs for admin', !/Unknown command/.test(fired?.message || ''), fired?.message);
  p.role = prevRole;
}
