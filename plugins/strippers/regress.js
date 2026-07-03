// Strippers plugin regression suite — run by tests/regress.js (never in production).
// The fake player is in a plain zone with no dancers, so these assert the tip
// verb routes and gates cleanly without needing credits or content rows.
export default async function regress({ run, check }) {
  let r = await run('tip');
  check('tip with no args prompts usage', r?.type === 'error' && /how much|who/i.test(r.message || ''), r?.message);

  r = await run('tip candy 200');
  check('tip with nobody dancing is refused', r?.type === 'error' && /working the rail|dancing here/i.test(r.message || ''), r?.message);

  r = await run('tip candy');
  check('tip with no amount prompts for credits', r?.type === 'error' && /how much/i.test(r.message || ''), r?.message);
}
