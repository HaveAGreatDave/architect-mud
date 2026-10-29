// stands plugin regression — run by tests/regress.js, never in production.
//
// The view can't be checked headless. What can be is the chart's data (every section the two
// venues sell has a seat to put the eye on), the verb's refusals, and that getting up leaves no
// row behind in the seated map.
import { getZone, getZoneFurniture } from '../../server/engine/world.js';
import { standsOf, findSection, _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  for (const [id, sport] of [['zone_slush_stands', 'hockey'], ['zone_hughson_stands', 'baseball']]) {
    const s = standsOf(getZone(id));
    check(`stands: ${id} sells ${sport} seats`, s?.sport === sport && s.sections.length >= 3, JSON.stringify(s?.sections?.length));
    if (!s) continue;
    check(`stands: ${id} sections all have a price and an eye`, s.sections.every((c) => Number.isFinite(c.price) && c.eye.length === 3));
    check(`stands: ${id} section ids are unique`, new Set(s.sections.map((c) => c.id)).size === s.sections.length);
    const first = s.sections[0];
    check(`stands: ${id} finds a section by id`, findSection(s, first.id) === first);
  }
  check('stands: a room with no flag sells nothing', standsOf({ flags: {} }) === null);
  check('stands: an unknown sport sells nothing', standsOf({ flags: { stands: { sport: 'cricket', sections: [{ id: 'a', eye: [0, 0, 0] }] } } }) === null);

  const me = getPlayer();
  let r = await run('stands');
  check('stands: refused outside the stands', r?.type === 'error' && /no seats/i.test(r.message || ''), r?.message);
  r = await run('stands leave');
  check('stands: getting up when not sat refuses', r?.type === 'error', r?.message);

  // Each venue's ticket machine is the chart: `use` on it answers as `stands` does.
  const home = me.current_zone;
  for (const id of ['zone_slush_stands', 'zone_hughson_stands']) {
    check(`stands: ${id} has a ticket machine`, getZoneFurniture(id).some((f) => f.flags?.ticket_machine));
    me.current_zone = id;
    r = await run('use ticket machine');
    check(`stands: using ${id}'s machine shows the chart`, r?.type === 'output' && /the seats/.test(r.message || ''), r?.message);
  }
  me.current_zone = home;

  _test.seated.set(me.id, { zoneId: 'zone_slush_stands', section: 'glass', channelId: 'x' });
  _test.leave(me, true);
  check('stands: leaving clears the seat', !_test.seated.has(me.id));
}
