// ambient-life regression suite — run by tests/regress.js (never loaded in production).
import { _test } from './index.js';

export default async function regress({ run, check }) {
  // ── Verb routing ──
  // With no busker opportunity here, `tip` delegates to the strippers plugin (the
  // shared-verb router), so we get its dancer prompt — proof the fall-through works.
  let r = await run('tip');
  check('tip routes / delegates to strip club', /dancer/i.test(r?.message || ''), r?.message);
  r = await run('order');
  check('order verb routed / no cart', /no cart here taking orders/i.test(r?.message || ''), r?.message);

  // ── Gating: matches() honours every allowlist; empty = "any" ──
  const zone = { id: 'zone_x', ambient_theme: 'city', flags: { street_life: true } };
  const base = { zones: [], themes: [], phases: [], weather: [] };
  check('match: empty gates = any', _test.matches(base, zone, 'day', 'clear'), null);
  check('match: phase excludes',   !_test.matches({ ...base, phases: ['night'] }, zone, 'day', 'clear'), null);
  check('match: theme excludes',   !_test.matches({ ...base, themes: ['outdoors'] }, zone, 'day', 'clear'), null);
  check('match: zone excludes',    !_test.matches({ ...base, zones: ['zone_other'] }, zone, 'day', 'clear'), null);
  check('match: weather excludes', !_test.matches({ ...base, weather: ['rain'] }, zone, 'day', 'clear'), null);

  // ── Street-zone opt-in gate ──
  check('street: opted-in outdoor qualifies', _test.isStreetZone(zone), null);
  check('street: interior excluded', !_test.isStreetZone({ ...zone, is_interior: true }), null);
  check('street: unflagged excluded', !_test.isStreetZone({ id: 'z', flags: {} }), null);

  // ── Interactive opportunity lookup (kind + expiry) ──
  _test.opportunities.set('zone_opp_live', { kind: 'tip', expiresAt: Date.now() + 60_000, actedBy: new Set() });
  check('opp: live tip found', !!_test.liveOpportunity('zone_opp_live', 'tip'), null);
  check('opp: wrong kind ignored', !_test.liveOpportunity('zone_opp_live', 'order'), null);
  _test.opportunities.set('zone_opp_exp', { kind: 'tip', expiresAt: Date.now() - 1, actedBy: new Set() });
  check('opp: expired pruned', !_test.liveOpportunity('zone_opp_exp', 'tip'), null);
  _test.opportunities.delete('zone_opp_live');
  _test.opportunities.delete('zone_opp_exp');
}
