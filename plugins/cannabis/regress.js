// Cannabis plugin regression suite — run by tests/regress.js (never loaded in production).
import { _test } from './index.js';

export default async function regress({ check }) {
  // Red-eyes appearance hook: silent when not high, bloodshot line when high.
  const sober = { _cannabisHighUntil: 0 };
  check('no red-eyes note when sober', _test.redEyes(sober, false) === undefined, String(_test.redEyes(sober, false)));

  const stoned = { _cannabisHighUntil: Date.now() + 60_000 };
  check('red-eyes note when stoned (other)', /red and glassy/.test(_test.redEyes(stoned, false) || ''), _test.redEyes(stoned, false));
  check('red-eyes note when stoned (self)', /bloodshot/.test(_test.redEyes(stoned, true) || ''), _test.redEyes(stoned, true));

  // Expired high reads as sober.
  const expired = { _cannabisHighUntil: Date.now() - 1000 };
  check('expired high reads sober', _test.redEyes(expired, false) === undefined, String(_test.redEyes(expired, false)));
}
