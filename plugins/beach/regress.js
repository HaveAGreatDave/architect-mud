// Beach: the beach is the flags.beach tiles, the plan comes from the date and leaves out the slums,
// a trip holds its members through sun, wading, swimming and back, and lets them go at the end.
import { world } from '../../server/engine/world.js';
import { buildBeaches, planDay, weightOf, callBeachTrip, describeBeach, beachLook, _test } from './index.js';
import { friendsOf, buildNetwork } from '../outings/index.js';
import { setOutdoorTemp, summerLayers } from '../../client/shared/summer-wear.js';

export default async function ({ check }) {
  // the friends network is built on outings' first tick, which regress never runs (and beach runs before outings)
  buildNetwork();
  const beaches = buildBeaches();
  check('beach: Marina Beach is a decent size', beaches.length >= 10, `${beaches.length} tiles`);
  check('beach: every tile knows the way to the water', beaches.every(b => Math.hypot(b.sea.dx, b.sea.dy) > 0.9), '');

  const a = planDay('2076-07-14'), b = planDay('2076-07-14'), c = planDay('2076-07-15');
  check('beach: a day has trips planned', a.events.length > 0, `${a.events.length}`);
  check('beach: the same date plans the same day', JSON.stringify(a) === JSON.stringify(b), '');
  check('beach: another date plans another day', JSON.stringify(a.events) !== JSON.stringify(c.events), '');
  const goers = a.events.flatMap(e => e.members).map(id => world.npcs.get(id)).filter(Boolean);
  check('beach: nobody comes from the south-east slums', goers.every(n => weightOf(n) > 0), '');
  const seen = new Set(); let twice = false;
  for (const id of a.events.flatMap(e => e.members)) { if (seen.has(id)) twice = true; seen.add(id); }
  check('beach: nobody is booked twice in a day', !twice, '');
  check('beach: trips are spread along the beach', new Set(a.events.map(e => e.zone)).size >= Math.min(3, a.events.length), '');

  _test.reset();
  // a stripper keeps her own clothes at the beach (summer-wear.js), so she cannot show the swimwear
  const host = goers.find(n => n?._ai && friendsOf(n.id).length && !n.flags?.stripper);
  if (!host) { check('beach: found somebody to take to the beach', false, ''); return; }
  const home = host.zone_id;
  const t = callBeachTrip(host.id, { force: true });
  check('beach: a trip starts', !!t && host._beach?.trip === t.id, '');
  if (!t) return;
  const lines = [], broadcast = (_z, m) => lines.push(m.message), query = async () => ({ rows: [] });
  const move = (zone) => { world.zones.get(host.zone_id)?.npcs?.delete(host.id); host.zone_id = zone; world.zones.get(zone)?.npcs?.add(host.id); };
  try {
    move(t.zone);
    const drive = () => _test.drive(host, { broadcast, query, ai: host._ai, zoneId: host.zone_id });
    check('beach: the driver holds a beachgoer', drive() === true && host._beach.state === 'sun', host._beach?.state);
    check('beach: the first one there puts up the parasol', lines.some(l => /parasol/.test(l)), lines.at(-1));
    check('beach: the room says who is on the beach', /parasol/.test(describeBeach(world.zones.get(t.zone)) || ''), '');
    const look = beachLook(host);
    check('beach: GLASS is told what they are doing', look?.k === 'sun' && Number.isFinite(look.u) && Number.isFinite(look.sx), JSON.stringify(look));
    check('beach: on the beach they are in swimwear', /swim|bikini|vest/.test(summerLayers(host, host.flags?.clothing_layers || ['a coat']).join(' ')), '');
    for (const want of ['wade', 'swim', 'back', 'sun']) { host._beach.until = 0; drive(); check(`beach: then ${want}`, host._beach.state === want, host._beach.state); }
    host._beach.state = 'swim'; t.endsAt = Date.now() - 1; drive();
    check('beach: a swimmer comes in before going home', host._beach?.state === 'back', host._beach?.state);
    host._beach.until = 0; drive();
    check('beach: at the end they go home', !host._beach, '');
    setOutdoorTemp(5);
  } finally {
    move(home);
    if (host._ai) { host._ai.patrolPath = []; host._ai.patrolTarget = null; }
    _test.reset();
  }
}
