// Job board plugin regression suite — run by tests/regress.js (never loaded in production).
// The fake player isn't guaranteed to stand in a job-board zone, so these assert the
// verbs/actions route and return the right shape; accept/turn-in is exercised by the
// quests plugin's own suite (jobboard just delegates to START_QUEST/TURN_IN).
import { dispatchAction } from '../../server/engine/actions.js';
import { getRegisteredMoveGates } from '../../server/engine/movement-gates.js';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();

  let r = await run('gigs');
  check('gigs verb routed', typeof (r?.message) === 'string', r?.message);

  r = await run('gigs take 1');
  check('gigs take routed', typeof (r?.message) === 'string', r?.message);

  r = await run('gigs claim 1');
  check('gigs claim routed', typeof (r?.message) === 'string', r?.message);

  r = await run('postings');
  check('postings alias routed', typeof (r?.message) === 'string', r?.message);

  // OPEN_JOBBOARD (Marta's dialogue) returns a dialogue_line — bare board when none here.
  r = await dispatchAction({ type: 'OPEN_JOBBOARD', actor: player, params: {} });
  check('OPEN_JOBBOARD returns a dialogue line', r?.type === 'dialogue_line' && typeof r.text === 'string', JSON.stringify(r));

  // The content-driven greeter move gate is wired.
  check('greeter move gate registered', getRegisteredMoveGates().includes('jobboard:greeter'), getRegisteredMoveGates().join(','));
}
