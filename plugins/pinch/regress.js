// Pinch plugin regression — exercises the unified `home` verb's routing without
// leaning on the walk-home scheduler. Two throwaway zones (an owned apartment
// and a disconnected "away" spot) are injected into the live world so the
// bind-vs-walk decision can be driven deterministically, then removed in finally.
import { world, setApartmentCache } from '../../server/engine/world.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const aptId = '__pinch_test_apt__';
  const awayId = '__pinch_test_away__';

  const savedZone = p.current_zone, savedHome = p.home_zone, savedGoing = p.goingHome;

  const hadApt = world.zones.get(aptId), hadAway = world.zones.get(awayId);
  world.zones.set(aptId, { id: aptId, name: 'Test Flat', flags: { is_apartment: true }, exits: {}, players: new Set(), npcs: new Set(), enemies: new Set() });
  world.zones.set(awayId, { id: awayId, name: 'Nowhere', flags: {}, exits: {}, players: new Set(), npcs: new Set(), enemies: new Set() });
  setApartmentCache(aptId, { owner_id: p.id });

  try {
    // No home + not in an apartment → the bind hint, not a walk.
    p.home_zone = null; p.goingHome = false; p.current_zone = awayId;
    let r = await run('home');
    check('home with no home set gives the bind hint', /home set/i.test(r?.message || '') && !p.goingHome, r?.message);

    // Standing in an apartment you own → binds home here.
    p.current_zone = aptId;
    r = await run('home');
    check('home in your own apartment binds it', p.home_zone === aptId, `home_zone=${p.home_zone}`);
    check("binding doesn't start a walk", !p.goingHome, `goingHome=${p.goingHome}`);

    // Home set, standing elsewhere → routes to the walk-home branch (no path
    // between the two disconnected test zones, so it reports that).
    p.current_zone = awayId;
    r = await run('home');
    check('home away from home routes to the walk, not a re-bind', p.home_zone === aptId && /path home/i.test(r?.message || ''), r?.message);

    // A walk that CAN find a path steps on the movement clock, not the 5s sleeper
    // tick it used to share — one room per five seconds was slower than walking the
    // same rooms by hand. Wire the two test zones together, start the walk, and
    // assert the armed step lands within a plausible cadence (walk 900ms, halved on
    // a road, faster still running) rather than five seconds away. Cancelled
    // immediately so no timer survives into later suites.
    world.zones.get(awayId).exits = { north: aptId };
    world.zones.get(aptId).exits = { south: awayId };
    p.goingHome = false; p.current_zone = awayId;
    r = await run('home');
    const armed = !!p._homeWalkTimer;
    const ms = armed ? Math.max(0, (p._homeWalkTimer._idleTimeout ?? 0)) : -1;
    check('home starts a walk when a path exists', p.goingHome === true && armed, `going=${p.goingHome} armed=${armed}`);
    check('the walk steps on the movement cadence, not the 5s sleeper tick', ms > 0 && ms <= 1000, `${ms}ms`);

    // A repeat press while walking cancels — the pinch-style toggle — and the armed
    // step must go with it, or the walk carries on after you called it off.
    r = await run('home');
    check('home again cancels the walk', /cancel/i.test(r?.message || '') && !p.goingHome, r?.message);
    check('cancelling disarms the pending step', !p._homeWalkTimer, 'a step timer outlived the walk');
  } finally {
    if (p._homeWalkTimer) { clearTimeout(p._homeWalkTimer); p._homeWalkTimer = null; }
    p.current_zone = savedZone; p.home_zone = savedHome; p.goingHome = savedGoing;
    world.apartments.delete(aptId);
    if (hadApt) world.zones.set(aptId, hadApt); else world.zones.delete(aptId);
    if (hadAway) world.zones.set(awayId, hadAway); else world.zones.delete(awayId);
  }
}
