// gatewarn regression suite — run by tests/regress.js (never loaded in
// production). The live one-time delivery needs a real zone.entered + player_flags
// round trip and is covered by manual QA; here we lock down the pure gating
// helpers so the trigger can't silently mis-fire or fire on the wrong tile.
import { _test } from './index.js';

export default async function regress({ check }) {
  // ── warningFor — only tiles carrying a non-empty gate_warning string qualify ──
  check('reads gate_warning prose', _test.warningFor({ flags: { gate_warning: '  brief  ' } }) === 'brief', 'trimmed');
  check('ignores a tile with no gate_warning', _test.warningFor({ flags: {} }) === null, 'no flag');
  check('ignores a blank gate_warning', _test.warningFor({ flags: { gate_warning: '   ' } }) === null, 'blank');
  check('ignores a null zone', _test.warningFor(null) === null, 'null zone');

  // ── seenKey — one suppression flag per gate tile ──────────────────────────────
  check('seenKey is namespaced per zone', _test.seenKey('zone_district_918_919') === 'gate_warned:zone_district_918_919', _test.seenKey('zone_district_918_919'));
}
