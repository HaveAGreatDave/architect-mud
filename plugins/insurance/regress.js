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

  // ── Fault tiers: cause of loss decides how much (if anything) it pays ──────────
  const cl = (o) => _test.classifyLoss(o).verdict;
  check('shot down is a covered peril', cl({ reason: 'shotdown', ageSec: 9999 }) === 'covered');
  check('combat (any reason) is covered', cl({ reason: 'crash', combat: true, ageSec: 9999 }) === 'covered');
  check('weather/birdstrike/fire are covered', cl({ reason: 'weather', ageSec: 9999 }) === 'covered' && cl({ reason: 'fire', ageSec: 9999 }) === 'covered');
  check('flying it into the ground is pilot error', cl({ reason: 'crash', ageSec: 9999 }) === 'pilot_error');
  check('running out of fuel is pilot error', cl({ reason: 'fuel', ageSec: 9999 }) === 'pilot_error');
  check('pilot error pays reduced, not zero', _test.classifyLoss({ reason: 'stall', ageSec: 9999 }).mult === _test.PILOT_ERROR_MULT);
  check('a no-fly-zone loss is excluded outright', cl({ reason: 'shotdown', restricted: true, ageSec: 9999 }) === 'excluded_nofly');
  check('no-fly exclusion beats a covered peril', _test.classifyLoss({ reason: 'shotdown', combat: true, restricted: true, ageSec: 9999 }).mult === 0);
  check('crashing right after binding cover is denied as fraud', cl({ reason: 'weather', ageSec: 5 }) === 'excluded_fraud');
  check('flying impaired voids cover', cl({ reason: 'shotdown', impaired: true, ageSec: 9999 }) === 'excluded_impaired');
  check('impairment beats even a covered peril', _test.classifyLoss({ reason: 'shotdown', combat: true, impaired: true, ageSec: 9999 }).mult === 0);

  // ── Desk gate: the verbs only work at a Halcyon desk (fake player is elsewhere) ─
  const ins = await run('insure');
  check('insure away from the desk is refused', /Halcyon Assurance handles that/.test(ins?.message || ''), ins?.message);
  const clm = await run('claim');
  check('claim away from the desk is refused', /Halcyon Assurance handles that/.test(clm?.message || ''), clm?.message);
  const pol = await run('policies');
  check('policies readout runs anywhere without error', pol?.type === 'output', pol?.type);
}
