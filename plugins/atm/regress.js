// ATM plugin regression suite — run by tests/regress.js (never loaded in
// production). Zone-independent paths only: the fake player's room contains no
// ATM furniture and no teller, so these cover verb routing plus the pure
// cap-arithmetic helpers rather than a real cash movement.
import { txnCap, overCapMessage, DEFAULT_TXN_CAP } from './index.js';

export default async function regress({ run, check }) {
  let r = await run('atm');
  check('atm verb routed', /no ATM here/i.test(r?.message || ''), r?.message);

  r = await run('deposit 50');
  check('deposit verb routed', /no ATM here/i.test(r?.message || ''), r?.message);

  r = await run('withdraw 50');
  check('withdraw verb routed', /no ATM here/i.test(r?.message || ''), r?.message);

  // ── Per-transaction ceiling ────────────────────────────────────────────────
  // The cap is the network's `withdrawal_limit`, applied to BOTH directions at a
  // physical machine. Standing at a teller lifts it entirely — that's the whole
  // "walk the big money into the bank" seam.
  const machine = { withdrawal_limit: 2500, network_name: 'Citadel Financial' };
  const teller = { name: 'Robo Teller' };
  check('a machine caps at its network limit', txnCap(machine, null) === 2500, String(txnCap(machine, null)));
  check('an addressed teller lifts the cap', txnCap(machine, teller) === null, String(txnCap(machine, teller)));

  // An ATM on no network still has a ceiling — the fallback, not "unlimited".
  // Getting this wrong makes every unlinked terminal an uncapped one.
  check('an unlinked machine falls back to the default cap',
    txnCap({}, null) === DEFAULT_TXN_CAP, String(txnCap({}, null)));
  check('the default cap is a real number', Number.isFinite(DEFAULT_TXN_CAP) && DEFAULT_TXN_CAP > 0, String(DEFAULT_TXN_CAP));

  // The refusal has to name the cap, the amount asked, and point at the bank —
  // a bare "no" reads as a bug rather than a rule.
  const msg = overCapMessage('withdraw', 9000, 2500, machine);
  check('over-cap refusal quotes the limit', /2500c/.test(msg), msg);
  check('over-cap refusal quotes the request', /9000c/.test(msg), msg);
  check('over-cap refusal points at a teller', /teller/i.test(msg), msg);

  const dep = overCapMessage('deposit', 9000, 2500, machine);
  check('the deposit refusal says accept, not dispense', /accept/.test(dep) && !/dispense/.test(dep), dep);

  // With a teller in the room the refusal must quote the phrasing that actually works,
  // or the player is told "go see a teller" while standing in front of one.
  const withTeller = overCapMessage('withdraw', 9000, 2500, machine, teller);
  check('the refusal quotes the working syntax when a teller is present',
    /withdraw 9000 from robo/.test(withTeller), withTeller);
}
