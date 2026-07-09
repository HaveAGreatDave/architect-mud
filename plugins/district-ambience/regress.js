// District-ambience regression suite — run by tests/regress.js (never in prod).
import { _test } from './index.js';
import { districtFor, DISTRICTS } from '../../server/engine/districts.js';

export default async function regress({ check }) {
  // Every district has a non-empty signature pool (the content contract).
  const missing = Object.values(DISTRICTS).filter(d => !d.signature?.length).map(d => d.key);
  check('every district has signature lines', missing.length === 0, `missing: ${missing.join(',') || 'none'}`);

  // Prefix classification lands where expected.
  check('slag_ → slaglands', districtFor({ id: 'zone_slag_yard' }).key === 'slaglands', districtFor({ id: 'zone_slag_yard' }).key);
  check('red_ → redline', districtFor({ id: 'zone_red_dreadfurnace' }).key === 'redline', districtFor({ id: 'zone_red_dreadfurnace' }).key);
  check('flags.district override wins', districtFor({ id: 'zone_slag_yard', flags: { district: 'docks' } }).key === 'docks', 'override');

  // Interiors never get a district line.
  const interior = { id: 'zone_slag_yard', flags: { is_interior: true } };
  let interiorEverFired = false;
  for (let i = 0; i < 200; i++) if (_test.describeAmbient(interior) !== undefined) interiorEverFired = true;
  check('interiors never emit a district line', !interiorEverFired, 'gated on is_interior');

  // Outdoor zones: over many rolls, every emitted line belongs to the zone's
  // district pool, and it abstains (undefined) at least sometimes.
  const outdoor = { id: 'zone_slag_yard', flags: {} };
  const pool = new Set(districtFor(outdoor).signature);
  let emitted = 0, abstained = 0, foreign = 0;
  for (let i = 0; i < 400; i++) {
    const r = _test.describeAmbient(outdoor);
    if (r === undefined) { abstained++; continue; }
    emitted++;
    if (!pool.has(r)) foreign++;
  }
  check('outdoor zones sometimes emit a district line', emitted > 0, `emitted ${emitted}/400`);
  check('outdoor zones sometimes abstain', abstained > 0, `abstained ${abstained}/400`);
  check('emitted lines are always from the district pool', foreign === 0, `foreign lines: ${foreign}`);
}
