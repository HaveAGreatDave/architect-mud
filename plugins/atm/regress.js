// ATM plugin regression suite — run by tests/regress.js (never loaded in
// production). Zone-independent paths only: the fake player's room contains no
// ATM furniture and no teller, so these cover verb routing plus the pure
// cap-arithmetic helpers rather than a real cash movement.
import { txnCap, overCapMessage, DEFAULT_TXN_CAP, networkKey, allowanceFor, fmtWindowWait, ALLOWANCE_WINDOW_SEC } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  let r = await run('atm');
  check('atm verb routed', /no ATM here/i.test(r?.message || ''), r?.message);

  r = await run('deposit 50');
  check('deposit verb routed', /no ATM here/i.test(r?.message || ''), r?.message);

  r = await run('withdraw 50');
  check('withdraw verb routed', /no ATM here/i.test(r?.message || ''), r?.message);

  // ── The 24h allowance ──────────────────────────────────────────────────────
  // The cap is the network's `withdrawal_limit`, applied to BOTH directions at a
  // physical machine, and it now covers a rolling 24 hours rather than a single
  // transaction. Standing at a teller lifts it entirely — that's the whole
  // "walk the big money into the bank" seam.
  const machine = { id: 'furn_atm_test', network_id: 'CitadelFinancial', withdrawal_limit: 2500, network_name: 'Citadel Financial' };
  const teller = { name: 'Robo Teller' };
  check('a machine caps at its network limit', txnCap(machine, null) === 2500, String(txnCap(machine, null)));
  check('an addressed teller lifts the cap', txnCap(machine, teller) === null, String(txnCap(machine, teller)));

  // An ATM on no network still has a ceiling — the fallback, not "unlimited".
  // Getting this wrong makes every unlinked terminal an uncapped one.
  check('an unlinked machine falls back to the default cap',
    txnCap({}, null) === DEFAULT_TXN_CAP, String(txnCap({}, null)));
  check('the default cap is a real number', Number.isFinite(DEFAULT_TXN_CAP) && DEFAULT_TXN_CAP > 0, String(DEFAULT_TXN_CAP));

  // ── Allowance scoping ──────────────────────────────────────────────────────
  // The window is per NETWORK, so two terminals on one network must share a key
  // and rival networks must not. An UNLINKED terminal keys off its own id rather
  // than collapsing to a shared null — otherwise every unlinked machine in the
  // world would pool into one allowance (or, worse, into none).
  check('two terminals on one network share an allowance key',
    networkKey({ id: 'a', network_id: 'CitadelFinancial' }) === networkKey({ id: 'b', network_id: 'CitadelFinancial' }),
    networkKey({ id: 'a', network_id: 'CitadelFinancial' }));
  check('rival networks do not share an allowance key',
    networkKey({ id: 'a', network_id: 'CitadelFinancial' }) !== networkKey({ id: 'a', network_id: 'Other' }));
  check('an unlinked terminal keys off itself, never null',
    networkKey({ id: 'lonely' }) === 'atm:lonely', networkKey({ id: 'lonely' }));
  check('unlinked terminals do not pool with each other',
    networkKey({ id: 'x' }) !== networkKey({ id: 'y' }));

  check('the window is 24 hours', ALLOWANCE_WINDOW_SEC === 86400, String(ALLOWANCE_WINDOW_SEC));

  // ── The live allowance read ────────────────────────────────────────────────
  // A real query against bank_transactions. The fake player has moved nothing, so
  // a fresh window must offer the whole allowance — if this comes back 0 the SUM
  // is broken and every terminal in the world is shut.
  const player = getPlayer();
  const fresh = await allowanceFor(player.id, machine, 'deposit');
  check('a fresh window offers the full allowance', fresh.remaining === 2500, JSON.stringify(fresh));
  check('a fresh window has nothing spent', fresh.spent === 0, JSON.stringify(fresh));
  check('a fresh window has no reset to wait for', fresh.resetsInSec === 0, String(fresh.resetsInSec));

  // Separate buckets: the two directions must not read each other's totals.
  const freshWd = await allowanceFor(player.id, machine, 'withdraw');
  check('deposit and withdraw are separate buckets', freshWd.remaining === 2500, JSON.stringify(freshWd));

  check('the wait formatter never says "0m"', !/\b0m\b/.test(fmtWindowWait(20)), fmtWindowWait(20));
  check('the wait formatter shows hours', /^3h /.test(fmtWindowWait(3 * 3600 + 600)), fmtWindowWait(3 * 3600 + 600));

  // The refusal has to name the cap, the amount asked, and point at the bank —
  // a bare "no" reads as a bug rather than a rule.
  const spentHalf = { cap: 2500, spent: 1500, remaining: 1000, resetsInSec: 3 * 3600 };
  const untouched = { cap: 2500, spent: 0, remaining: 2500, resetsInSec: 0 };
  const msg = overCapMessage('withdraw', 9000, untouched, machine);
  check('over-cap refusal quotes the limit', /2500₵/.test(msg), msg);
  check('over-cap refusal quotes the request', /9000₵/.test(msg), msg);
  check('over-cap refusal points at a teller', /teller/i.test(msg), msg);
  check('over-cap refusal says the limit is a window, not a transaction',
    /24 hours/.test(msg) && !/one transaction/.test(msg), msg);

  // Partway through the window the player needs the REMAINING figure — being told
  // only the ceiling after spending half of it is the actively misleading case.
  const partial = overCapMessage('withdraw', 9000, spentHalf, machine);
  check('a part-spent refusal quotes what is left', /1000₵/.test(partial), partial);
  check('a part-spent refusal quotes what was already moved', /1500₵/.test(partial), partial);
  check('a part-spent refusal names the wait', /3h/.test(partial), partial);

  const dep = overCapMessage('deposit', 9000, untouched, machine);
  check('the deposit refusal says accept, not dispense', /accept/.test(dep) && !/dispense/.test(dep), dep);

  // With a teller in the room the refusal must quote the phrasing that actually works,
  // or the player is told "go see a teller" while standing in front of one.
  const withTeller = overCapMessage('withdraw', 9000, untouched, machine, teller);
  check('the refusal quotes the working syntax when a teller is present',
    /withdraw 9000 from robo/.test(withTeller), withTeller);
}
