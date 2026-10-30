// stands plugin regression — run by tests/regress.js, never in production.
//
// The view can't be checked headless. What can be is the chart's data (every section the two
// venues sell has a seat to put the eye on), the verb's refusals, and that getting up leaves no
// row behind in the seated map.
import { getZone, getZoneFurniture } from '../../server/engine/world.js';
import { runMoveGates } from '../../server/engine/movement-gates.js';
import { liveSportsChannel } from '../broadcast/index.js';
import { standsOf, findSection, seatsOf, freeSeat, _test } from './index.js';

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

  // A ticket is for a section: the first buyer gets its eye, the next the nearest free seat, and
  // a full section sells nothing.
  const sec = { id: 't', eye: [0, 10, -70], across: 3, rows: 2, pitch: 2 };
  const seats = seatsOf('baseball', sec);
  check('stands: a section is a block of seats', seats.length === 6, String(seats.length));
  check('stands: its best seat is its eye', seats[0].eye.join() === sec.eye.join() && seats[0].row === 0, JSON.stringify(seats[0]));
  check('stands: the back row is behind and above', seats.at(-1).row === 1 && seats.at(-1).eye[2] < -70 && seats.at(-1).eye[1] > 10, JSON.stringify(seats.at(-1)));
  check('stands: an empty section gives the best seat', freeSeat('zq', 'baseball', sec, me.id) === 0);
  _test.seated.set('ghost1', { zoneId: 'zq', section: 't', seat: 0, channelId: 'x' });
  const next = freeSeat('zq', 'baseball', sec, me.id);
  check('stands: a taken seat sends you to the nearest free one', next === 1 && Math.hypot(...seats[1].eye.map((v, i) => v - sec.eye[i])) <= 2.01, String(next));
  for (let i = 1; i < 6; i++) _test.seated.set('ghost' + (i + 1), { zoneId: 'zq', section: 't', seat: i, channelId: 'x' });
  check('stands: a full section has no seat', freeSeat('zq', 'baseball', sec, me.id) === -1);
  check('stands: the same section in another room is empty', freeSeat('zr', 'baseball', sec, me.id) === 0);
  for (let i = 0; i < 6; i++) _test.seated.delete('ghost' + (i + 1));

  _test.seated.set(me.id, { zoneId: 'zone_slush_stands', section: 'glass', seat: 0, channelId: 'x' });
  _test.leave(me, true);
  check('stands: leaving clears the seat', !_test.seated.has(me.id));

  // The Platinum Box: its chairs name a section the box sells, its screen and bar are there, and
  // standing up out of a chair seat leaves it.
  const box = standsOf(getZone('zone_hughson_platinum_box'));
  const chairs = getZoneFurniture('zone_hughson_platinum_box').find((f) => f.flags?.stands_section);
  check('stands: the box chairs name one of its sections', !!(box && chairs && findSection(box, chairs.flags.stands_section)), chairs?.flags?.stands_section);
  const lounge = getZoneFurniture('zone_hughson_platinum');
  check('stands: the box lounge has a big screen', lounge.some((f) => f.flags?.stands_screen));
  check('stands: the box bar and buffet are stocked', lounge.filter((f) => f.object_type === 'container' && f.flags?.restock_items?.length).length === 2);
  me.current_zone = 'zone_hughson_platinum';
  r = await run('watch tv');
  check('stands: watching the box screen answers from the screen', r?.type === 'output' && /big screen/.test(r.message || ''), r?.message);
  _test.leave(me, true);
  me.current_zone = home;
  // The box is ticketed at twice the dearest seat in the stands, and shut without a pass.
  const top = Math.max(...standsOf(getZone('zone_hughson_stands')).sections.map((c) => c.price | 0));
  check('stands: a box ticket is twice the dearest seat', box?.sections[0].price === top * 2, String(box?.sections[0].price));
  const gate = (to) => runMoveGates({ player: me, from: getZone('zone_hughson_club'), to: getZone(to), direction: 'east', door: null, opts: {} });
  _test.passes.delete(me.id);
  check('stands: no ticket, no box', (await gate('zone_hughson_platinum'))?.block === true);
  check('stands: the lounge leads into the box freely', !(await runMoveGates({ player: me, from: getZone('zone_hughson_platinum'), to: getZone('zone_hughson_platinum_box'), direction: 'north', door: null, opts: {} }))?.block);
  const ch = liveSportsChannel('baseball');
  if (ch) {
    _test.passes.set(me.id, { box: 'zone_hughson_platinum_box', channelId: ch, until: Date.now() + 60e3 });
    check('stands: a pass opens the box', !(await gate('zone_hughson_platinum'))?.block);
  }
  _test.passes.set(me.id, { box: 'zone_hughson_platinum_box', channelId: 'gone', until: Date.now() + 60e3 });
  check('stands: a pass for another game is no pass', (await gate('zone_hughson_platinum'))?.block === true);
  me.current_zone = 'zone_hughson_stands';
  r = await run('use ticket machine');
  check('stands: the ticket machine sells the box', /Platinum Box/.test(r?.message || ''), r?.message);
  me.current_zone = home;
  _test.passes.delete(me.id);
  _test.seated.set(me.id, { zoneId: 'zone_hughson_platinum_box', section: 'platinum', seat: 0, channelId: 'x', chair: true });
  await _test.onPosture({ player: me, to: 'standing' });
  check('stands: standing up out of a box chair leaves it', !_test.seated.has(me.id));
}
