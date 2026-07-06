// Dealing plugin regression suite — run by tests/regress.js (never in prod).
import { _test } from './index.js';

export default async function regress({ run, check }) {
  // ── Parse: peddle <drug> to <player> [for <price>] ──────────────────────────
  const a = _test.parseDeal(['blue', 'ice', 'to', 'Bob']);
  check('parse: drug + target, no price', a && a.drug === 'blue ice' && a.who === 'Bob' && a.price === null, JSON.stringify(a));
  const b = _test.parseDeal(['weed', 'to', 'Al', 'for', '120']);
  check('parse: with price', b && b.drug === 'weed' && b.who === 'Al' && b.price === 120, JSON.stringify(b));
  check('parse: no "to" → null', _test.parseDeal(['weed', 'Bob']) === null);

  // ── Fair price + band ───────────────────────────────────────────────────────
  check('fair price scales with potency', _test.fairPrice(100, 1.5) === 150, _test.fairPrice(100, 1.5));
  check('fair price floors at 1', _test.fairPrice(0, 1) === 1, _test.fairPrice(0, 1));
  const band = _test.bandOf(100);
  check('band is ±25%', band.lo === 75 && band.hi === 125, JSON.stringify(band));

  // ── Verbs fail safe with no offer ──────────────────────────────────────────
  const ad = await run('acceptdeal');
  check('acceptdeal with no offer errors cleanly', ad?.type === 'error', ad?.type);
  const dd = await run('declinedeal');
  check('declinedeal with no offer errors cleanly', dd?.type === 'error', dd?.type);
  const pk = await run('peddle');
  check('peddle with no args errors cleanly', pk?.type === 'error', pk?.type);
}
