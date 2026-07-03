// Smoking plugin regression suite — run by tests/regress.js (never loaded in production).
import { _test } from './index.js';

export default async function regress({ run, check }) {
  // Verb routing: `smoke` with no arg prompts; nonexistent item is rejected — both
  // prove the specialized action is wired and gating before it delegates to cmdUse.
  let r = await run('smoke');
  check('smoke verb routed (no arg)', /Smoke what\?/.test(r?.message || ''), r?.message);

  r = await run('smoke nothingxyz');
  check('smoke rejects unknown item', /nothing like that to smoke/.test(r?.message || ''), r?.message);

  // Cough-chance curve: high right after a smoke, chronic in the smoker window, nil after.
  check('cough chance high just after smoking', _test.coughChance(1000) === 0.30, String(_test.coughChance(1000)));
  check('cough chance chronic mid-window', _test.coughChance(10 * 60 * 1000) === 0.05, String(_test.coughChance(10 * 60 * 1000)));
  check('cough chance nil past smoker window', _test.coughChance(60 * 60 * 1000) === 0, String(_test.coughChance(60 * 60 * 1000)));
}
