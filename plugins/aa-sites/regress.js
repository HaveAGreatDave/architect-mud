// AA-sites plugin regression — the pure on-foot panel renderer (MANNED / FIRING /
// under-repair / cold-ruin) + the describeRoom hook's "not an AA tile → stay out of
// the way" contract. Firing/repair state and the DB roster are runtime, so we test the
// render logic directly (no seeding needed).
import { _test, hooks } from './index.js';

export default async function regress({ check }) {
  const { panelFor } = _test;

  const manned = panelFor({ name: 'a wastes autocannon', faction: null, active: 1 }, false, false);
  check('aa-sites: manned panel names the battery', manned.includes('a wastes autocannon'), manned);
  check('aa-sites: manned panel reads MANNED', manned.includes('MANNED'), manned);

  const firing = panelFor({ name: 'the Redline SAM nest', faction: 'redline', active: 1 }, true, false);
  check('aa-sites: firing panel reads FIRING', firing.includes('FIRING'), firing);
  check('aa-sites: faction is tagged', firing.includes('redline'), firing);

  // Strafed but a living engineer is on it → OFF-LINE, UNDER REPAIR (not a dead ruin).
  const repairing = panelFor({ name: 'a Slagworks flak gun', faction: null, active: 0 }, false, true);
  check('aa-sites: strafed-with-engineer reads UNDER REPAIR', /UNDER REPAIR/.test(repairing), repairing);
  check('aa-sites: under-repair panel is not a ruin', !/ruin/i.test(repairing), repairing);

  // Strafed with no engineer to fix it → the cold ruin.
  const dead = panelFor({ name: 'a Slagworks flak gun', faction: null, active: 0 }, false, false);
  check('aa-sites: silenced-with-no-engineer reads as a ruin', /ruin/i.test(dead), dead);
  check('aa-sites: ruin panel is not MANNED', !dead.includes('MANNED'), dead);

  // describeRoom stays out of the way on a tile that carries no AA site.
  const none = await hooks['zone.describeRoom']({ id: 'zone_aa_regress_nonexistent' });
  check('aa-sites: describeRoom returns undefined off an AA tile', none === undefined, String(none));
}
