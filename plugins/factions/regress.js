// Factions plugin regression suite — run by tests/regress.js (never loaded in production).
import { dispatchAction } from '../../server/engine/actions.js';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();

  let r = await run('rep');
  check('rep verb routed', /FACTION STANDING/.test(r?.message || ''), r?.message);

  // Standing-shift Actions: assert they're registered and guard bad input (no DB write).
  r = await dispatchAction({ type: 'ADJUST_REPUTATION', actor: player, params: { delta: 5 } });
  check('ADJUST_REPUTATION guards missing faction', r?.type === 'error', JSON.stringify(r));

  r = await dispatchAction({ type: 'ADJUST_ARCHITECT', actor: null, params: { delta: 5 } });
  check('ADJUST_ARCHITECT guards missing actor', r?.type === 'error', JSON.stringify(r));
}
