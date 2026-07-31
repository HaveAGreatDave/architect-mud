// residency regression suite — run by tests/regress.js (never loaded in production).
// The gate's residency lookup needs the live apartments cache, so here we lock down
// the pure branches: an ungated tile is never our business, a gated tile refuses by
// default, and the content's own refusal line wins when it's authored.
import { _test } from './index.js';

export default async function regress({ check }) {
  const nobody = { id: 'p_test', role: 'player' };

  check('ignores a tile with no residents_only', _test.residentsOnlyGate({ player: nobody, to: { flags: {} } }) === undefined, 'ungated tile passes');
  check('ignores a null destination', _test.residentsOnlyGate({ player: nobody, to: null }) === undefined, 'null zone passes');

  const gated = { flags: { residents_only: 'Solenne Residences' } };
  const blocked = _test.residentsOnlyGate({ player: nobody, to: gated });
  check('blocks a non-resident', blocked?.block === true, 'blocked');
  check('uses the default refusal line', blocked?.message === _test.DEFAULT_DENY, blocked?.message);

  const voiced = { flags: { residents_only: 'Solenne Residences', residents_only_deny: 'The concierge steps into your path.' } };
  check('authored refusal line wins', _test.residentsOnlyGate({ player: nobody, to: voiced })?.message === 'The concierge steps into your path.', 'content voice');

  check('staff walk through', _test.residentsOnlyGate({ player: { id: 'p_dev', role: 'dev' }, to: gated }) === undefined, 'dev bypass');
}
