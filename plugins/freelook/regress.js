// freelook plugin regression — run by tests/regress.js, never in production.
//
// What is worth asserting here is NOT that the camera draws (nothing headless can see a canvas).
// It is the three things that are silent when they are wrong: the clearance gate, where the camera
// decides to open, and whether closing leaves a row behind in the viewer set — a leak there is a
// tick pushing sky at somebody who shut the view an hour ago, and nothing anywhere would say so.
import { getAllZones, getZone } from '../../server/engine/world.js';
import { commands, placedTile, tileUnder, _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const { freelook } = commands;
  const me = getPlayer();

  // ── The gate ──
  // `run` drives the real dispatcher with the suite's ordinary (non-staff) player.
  let r = await run('freelook');
  check('freelook: refused without clearance', r?.type === 'error' && /clearance/i.test(r.message || ''), r?.message);

  // ── Where it opens ──
  // 0,0 is how an interior zone spells "unset" (see the ⚠ in index.js). A placed test that only
  // checks for a non-null grid_x accepts it and opens the camera in the corner of the map.
  check('freelook: 0,0 is not a placed tile',
    placedTile({ map_id: 'map_world', grid_x: 0, grid_y: 0 }) === null);
  check('freelook: a real map_world tile is',
    placedTile({ map_id: 'map_world', grid_x: 918, grid_y: 903 })?.gx === 918);
  check('freelook: another map is not', placedTile({ map_id: 'map_aircraft_leviathan', grid_x: 4, grid_y: 4 }) === null);
  check('freelook: nothing is not', placedTile(null) === null);

  // An interior room resolves to the tile its building stands on, by following world_exit_zone.
  // Derived from the live world rather than hardcoded, so a retired shop does not fail this.
  const interior = getAllZones().find((z) => z.map_id !== 'map_world' && z.flags?.world_exit_zone
    && placedTile(getZone(z.flags.world_exit_zone)));
  if (interior) {
    const at = tileUnder({ current_zone: interior.id });
    const facade = placedTile(getZone(interior.flags.world_exit_zone));
    check('freelook: indoors resolves to the building\'s own tile',
      !!at && at.gx === facade.gx && at.gy === facade.gy, `${interior.id} → ${JSON.stringify(at)}`);
  }
  check('freelook: an unplaced room with nowhere to hop answers nothing',
    tileUnder({ current_zone: '__no_such_zone__' }) === null);

  // ── Usage ──
  // One coordinate is a typo, not a tile. It must not be read as an x with a missing y.
  const staff = { ...me, role: 'admin' };
  check('freelook: one coordinate is refused', freelook(['918'], 'freelook 918', staff)?.type === 'error');
  check('freelook: a non-numeric coordinate is refused',
    freelook(['banana', '3'], 'freelook banana 3', staff)?.type === 'error');

  // ── Open, re-centre, close ──
  _test.viewers.delete(staff.id);
  const opened = freelook(['918', '903'], 'freelook 918 903', staff);
  check('freelook: staff gets a typed response', opened?.type === 'system', JSON.stringify(opened));
  check('freelook: …and is registered as a viewer', _test.viewers.get(staff.id)?.gx === 918);
  const moved = freelook(['920', '905'], 'freelook 920 905', staff);
  check('freelook: re-centring moves the window', _test.viewers.get(staff.id)?.gy === 905, JSON.stringify(moved));
  check('freelook: …and says it re-centred rather than opening again', /re-centred/i.test(moved?.message || ''), moved?.message);

  const closed = freelook(['close'], 'freelook close', staff);
  check('freelook: close is a noop response', closed?.type === 'noop', JSON.stringify(closed));
  check('freelook: …and leaves no row behind', !_test.viewers.has(staff.id));

  // Closing must work for somebody with NO clearance — a role change underneath an open view must
  // never leave a pane that cannot be shut.
  _test.viewers.set(me.id, { gx: 1, gy: 1 });
  freelook(['close'], 'freelook close', { ...me, role: 'player' });
  check('freelook: close is not behind the clearance gate', !_test.viewers.has(me.id));
}
