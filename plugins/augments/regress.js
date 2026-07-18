// plugins/augments/regress.js — never loaded in production, only by the harness.
// Asserts routing + the clinic gate. The fake player is in an ordinary zone (no
// flags.augment_clinic), so install/remove must be refused; listing must work.
export default async function regress({ run, check }) {
  const list = await run('augments');
  check('augments lists', list?.type === 'augments', list?.type || 'no result');

  const bare = await run('augment');
  check('augment (bare) lists', bare?.type === 'augments', bare?.type || 'no result');

  const inst = await run('augment install dermal jack');
  check('install refused off-clinic',
    inst?.type === 'error' && /clinic/i.test(inst.message || ''),
    inst?.message || inst?.type);

  const rem = await run('augment remove dermal jack');
  check('remove refused off-clinic',
    rem?.type === 'error' && /clinic/i.test(rem.message || ''),
    rem?.message || rem?.type);

  const noarg = await run('augment install');
  check('install needs a name',
    noarg?.type === 'error' && /install what/i.test(noarg.message || ''),
    noarg?.message || noarg?.type);
}
