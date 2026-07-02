// Thievery plugin regression suite — run by tests/regress.js (never loaded in production).
export default async function regress({ run, check }) {
  let r = await run('steal');
  check('steal verb routed', /Steal from whom/.test(r?.message || ''), r?.message);

  r = await run('steal nobodyxyz');
  check('steal target resolution', /Can't find/.test(r?.message || ''), r?.message);
}
