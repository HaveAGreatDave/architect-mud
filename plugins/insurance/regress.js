// Insurance (Halcyon Assurance) regression suite — run by tests/regress.js (never
// loaded in production). Covers the settlement math (soften-not-erase invariants)
// and the desk gate. The full crash→claim→payout round-trip needs a live insured
// aircraft + crash event and is covered by manual QA.
import { _test } from './index.js';

export default async function regress({ run, check }) {
  // ── Settlement math: a payout must always leave the pilot down on a total loss ──
  const value = 10000;
  const { deductible, payout } = _test.settlement(value);
  check('deductible is the excess fraction', deductible === Math.round(value * _test.DEDUCTIBLE_FRAC), String(deductible));
  check('payout is partial (never the full value)', payout < value && payout > 0, String(payout));
  check('a total loss still costs the pilot (payout < value)', payout < value * 0.6, `${payout} vs ${value}`);
  check('payout never goes negative', _test.settlement(10).payout >= 0, String(_test.settlement(10).payout));

  // ── Bonus-malus: each prior paid claim surcharges the premium, capped ──────────
  const base = _test.quotePremium(value, 0);
  const oneClaim = _test.quotePremium(value, 1);
  const manyClaims = _test.quotePremium(value, 99);
  check('a prior claim raises the premium', oneClaim > base, `${oneClaim} vs ${base}`);
  check('surcharge is capped (repeat crashers plateau)', manyClaims === _test.quotePremium(value, 6), `${manyClaims}`);
  check('surcharge multiplier floors at 1.0', _test.surchargeMult(0) === 1, String(_test.surchargeMult(0)));

  // ── Desk gate: the verbs only work at a Halcyon desk (fake player is elsewhere) ─
  const ins = await run('insure');
  check('insure away from the desk is refused', /Halcyon Assurance handles that/.test(ins?.message || ''), ins?.message);
  const clm = await run('claim');
  check('claim away from the desk is refused', /Halcyon Assurance handles that/.test(clm?.message || ''), clm?.message);
  const pol = await run('policies');
  check('policies readout runs anywhere without error', pol?.type === 'output', pol?.type);
}
