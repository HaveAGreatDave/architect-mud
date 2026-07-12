// AA-sites plugin regression — the pure on-foot panel renderer + the describeRoom
// hook's "not an AA tile → stay out of the way" contract. Firing state and DB
// roster are runtime, so we test the render logic directly (no seeding needed).
import { _test, hooks } from './index.js';

export default async function regress({ check }) {
  const { panelFor } = _test;

  const manned = panelFor({ name: 'a wastes autocannon', faction: null, active: 1 }, false);
  check('aa-sites: manned panel names the battery', manned.includes('a wastes autocannon'), manned);
  check('aa-sites: manned panel reads MANNED', manned.includes('MANNED'), manned);

  const firing = panelFor({ name: 'the Redline SAM nest', faction: 'redline', active: 1 }, true);
  check('aa-sites: firing panel reads FIRING', firing.includes('FIRING'), firing);
  check('aa-sites: faction is tagged', firing.includes('redline'), firing);

  const dead = panelFor({ name: 'a Slagworks flak gun', faction: null, active: 0 }, false);
  check('aa-sites: silenced panel reads as a ruin', /ruin/i.test(dead), dead);
  check('aa-sites: silenced panel is not MANNED', !dead.includes('MANNED'), dead);

  // describeRoom stays out of the way on a tile that carries no AA site.
  const none = await hooks['zone.describeRoom']({ id: 'zone_aa_regress_nonexistent' });
  check('aa-sites: describeRoom returns undefined off an AA tile', none === undefined, String(none));
}
