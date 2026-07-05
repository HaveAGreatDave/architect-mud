// Trade plugin regression suite — run by tests/regress.js (never loaded in
// production). Verb routing + fail-safe guards + the escape helper. The full
// invite→stake→swap flow needs two live players and is covered by manual QA.
import { _test } from './index.js';

export default async function regress({ run, check }) {
  check('esc neutralizes angle brackets', _test.esc('<b>x</b>') === '&lt;b&gt;x&lt;/b&gt;');

  const off = await run('tradeoffer knife');
  check('tradeoffer outside a trade errors', off?.type === 'error', off?.type);
  const ready = await run('tradeready');
  check('tradeready outside a trade errors', ready?.type === 'error', ready?.type);
  const retract = await run('traderetract credits');
  check('traderetract outside a trade errors', retract?.type === 'error', retract?.type);
  const cancel = await run('tradecancel');
  check('tradecancel outside a trade errors', cancel?.type === 'error', cancel?.type);
  const noWho = await run('trade');
  check('trade with no target and no invite errors', noWho?.type === 'error', noWho?.type);
  const ghost = await run('trade ghost');
  check('trade with nobody here errors cleanly', ghost?.type === 'error', ghost?.type);
}
