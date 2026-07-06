// Job board plugin regression suite — run by tests/regress.js (never loaded in production).
// The fake player isn't guaranteed to stand in a job-board zone, so these assert the
// verb routes and returns a string; the accept/turn-in paths are exercised by the
// quests plugin's own suite (jobboard just delegates to START_QUEST/TURN_IN).
export default async function regress({ run, check }) {
  let r = await run('gigs');
  check('gigs verb routed', typeof (r?.message) === 'string', r?.message);

  r = await run('gigs take 1');
  check('gigs take routed', typeof (r?.message) === 'string', r?.message);

  r = await run('gigs claim 1');
  check('gigs claim routed', typeof (r?.message) === 'string', r?.message);

  r = await run('postings');
  check('postings alias routed', typeof (r?.message) === 'string', r?.message);
}
