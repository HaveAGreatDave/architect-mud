// Dealer plugin regression suite — run by tests/regress.js (never in production).
// Covers the wrong-passphrase trust math (pure fns, no DB): a wrong passphrase
// costs trust, can go negative (no sale), keeps dropping to a floor, and rebounds
// on its own back toward 0 over real time.
import { recoverTrust, penalize } from './index.js';

export default async function regress({ check }) {
  const now = 1_700_000_000_000;

  // Penalty: each wrong passphrase drops trust, stacks downward, floors, and a
  // genuine regular can lose standing yet stay positive (still sells, lower tier).
  check('wrong passphrase from 0 → -20', penalize(0) === -20);
  check('wrong passphrases stack downward', penalize(-20) === -40);
  check('penalty clamps at the floor', penalize(-55) === -60 && penalize(-60) === -60);
  check('a regular loses standing but may stay positive', penalize(30) === 10);

  // Rebound: only the negative part heals, toward 0, over real minutes.
  check('positive/earned trust is never auto-changed', recoverTrust(30, now - 999_999, now) === 30);
  check('no offence timestamp → no heal', recoverTrust(-20, 0, now) === -20);
  check('negative heals toward 0 over time (+10/min)', recoverTrust(-20, now - 60_000, now) === -10);
  check('healing never overshoots 0', recoverTrust(-40, now - 10 * 60_000, now) === 0);
  check('below-floor still rebounds fully to 0', recoverTrust(-60, now - 60 * 60_000, now) === 0);
}
