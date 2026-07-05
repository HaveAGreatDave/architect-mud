// Pay plugin regression suite — run by tests/regress.js (never loaded in
// production). Verb routing + the parse helper + fail-safe guard rails. The full
// offer→accept credit move needs two live players and is covered by manual QA.
import { _test } from './index.js';

export default async function regress({ run, check }) {
  const p1 = _test.parsePay(['Bob', '50']);
  check('parsePay reads name + amount', p1.who === 'Bob' && p1.amount === 50, JSON.stringify(p1));
  const p2 = _test.parsePay(['100', 'Alice', 'Jones']);
  check('parsePay finds the amount token anywhere', p2.amount === 100 && p2.who === 'Alice Jones', JSON.stringify(p2));
  const p3 = _test.parsePay(['Bob']);
  check('parsePay with no amount yields null', p3.amount === null, JSON.stringify(p3));

  const noArg = await run('pay');
  check('pay with no args prompts usage', noArg?.type === 'error', noArg?.type);
  const badAmt = await run('pay Bob 0');
  check('pay of zero is refused', badAmt?.type === 'error', badAmt?.type);
  const nobody = await run('pay ghost 10');
  check('pay with nobody here errors cleanly', nobody?.type === 'error', nobody?.type);

  const acc = await run('acceptpay');
  check('acceptpay with no offer errors', acc?.type === 'error', acc?.type);
  const dec = await run('declinepay');
  check('declinepay with no offer errors', dec?.type === 'error', dec?.type);
  const can = await run('cancelpay');
  check('cancelpay with nothing pending errors', can?.type === 'error', can?.type);
}
