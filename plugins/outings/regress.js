// Outings: the network is built from the live world, venues are real bars and clubs, and a called
// night out holds its members, walks them in, and lets them go when it ends.
import { world } from '../../server/engine/world.js';
import { buildNetwork, buildVenues, friendsOf, callOuting, isSocialNpc, _test } from './index.js';

export default async function ({ check }) {
  const venues = buildVenues();
  check('outings: the city has bars and clubs to go to', venues.length > 0, `${venues.length} venues`);
  check('outings: every venue is a real room', venues.every(v => world.zones.has(v.id)), '');

  const net = buildNetwork();
  const social = [...world.npcs.values()].filter(isSocialNpc);
  check('outings: social NPCs get friends', net.size > 0 && net.size <= social.length, `${net.size} of ${social.length}`);
  let mutual = true;
  for (const [a, set] of net) for (const b of set) if (!net.get(b)?.has(a)) mutual = false;
  check('outings: friendship is mutual', mutual, '');
  const sizes = [...net.values()].map(s => s.size);
  check('outings: circles stay small', Math.max(0, ...sizes) <= 12, `max ${Math.max(0, ...sizes)}`);
  const again = buildNetwork();
  const same = [...again].every(([a, s]) => [...s].every(b => net.get(a)?.has(b)));
  check('outings: the network is the same every boot', same, '');

  // A forced night out: pick a caller whose friends exist, pretend everyone's off and awake.
  _test.reset();
  const env = { hour: 21, minutes: 21 * 60, dayOfWeek: 3, timeScale: 1 };
  const caller = [...net.keys()].map(id => world.npcs.get(id)).find(n => n?._ai && friendsOf(n.id).some(f => world.npcs.get(f)?._ai));
  if (!caller) { check('outings: found a caller to test with', false, 'no social NPC with an _ai'); return; }
  const saved = new Map();
  const people = [caller, ...friendsOf(caller.id).map(id => world.npcs.get(id))].filter(Boolean);
  for (const n of people) saved.set(n.id, { sched: n.vendor_schedule, zone: n.zone_id });
  for (const n of people) n.vendor_schedule = null; // free all night
  try {
    const o = callOuting(caller.id, { env, force: true });
    check('outings: a free NPC with free friends calls a night out', !!o && o.members.size >= 2, o ? `${o.members.size} going to ${o.venueName}` : 'none');
    if (!o) return;
    const lines = [];
    const broadcast = (_z, m) => lines.push(m.message);
    const noQuery = async () => ({ rows: [] });
    const held = _test.drive(caller, { broadcast, query: noQuery, ai: caller._ai, zoneId: caller.zone_id ?? caller.zoneId });
    check('outings: the driver holds a member', held === true, '');
    o.endsAt = Date.now() - 1;
    const after = _test.drive(caller, { broadcast, query: noQuery, ai: caller._ai, zoneId: caller.zone_id ?? caller.zoneId });
    check('outings: an ended night lets the member go', after === false && !_test.memberOf.has(caller.id), '');
    const stranger = social.find(n => !o.members.has(n.id));
    if (stranger?._ai) check('outings: the driver ignores NPCs who are not out', _test.drive(stranger, { broadcast, query: noQuery, ai: stranger._ai, zoneId: stranger.zone_id }) === false, '');
  } finally {
    for (const n of people) {
      const s = saved.get(n.id);
      n.vendor_schedule = s.sched;
      if ((n.zone_id ?? n.zoneId) !== s.zone) {
        world.zones.get(n.zone_id)?.npcs?.delete(n.id);
        n.zone_id = s.zone;
        world.zones.get(s.zone)?.npcs?.add(n.id);
      }
      if (n._ai) { n._ai.patrolPath = []; n._ai.patrolTarget = null; }
    }
    _test.reset();
  }
}
