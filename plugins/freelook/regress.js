// freelook plugin regression — run by tests/regress.js, never in production.
//
// What is worth asserting here is NOT that the camera draws (nothing headless can see a canvas).
// It is the three things that are silent when they are wrong: the clearance gate, where the camera
// decides to open, and whether closing leaves a row behind in the viewer set — a leak there is a
// tick pushing sky at somebody who shut the view an hour ago, and nothing anywhere would say so.
import { getAllZones, getZone, getZoneFurniture } from '../../server/engine/world.js';
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

  // ⚠ AND THE CAMERA ASKS FOR THIS TOO. The view re-centres its own window as the camera flies out
  // of it — every 18 tiles, which at the fast ladder is a couple of seconds — so the confirmation
  // above would become a line in the log for something nobody did. `follow` is the camera saying
  // the move is its own; the window still moves, and the sky push follows it.
  const followed = freelook(['930', '911', 'follow'], 'freelook 930 911 follow', staff);
  check('freelook: a camera-driven re-centre says nothing', followed?.type === 'noop', JSON.stringify(followed));
  check('freelook: …and still moves the window', _test.viewers.get(staff.id)?.gx === 930
    && _test.viewers.get(staff.id)?.gy === 911, JSON.stringify(_test.viewers.get(staff.id)));

  const closed = freelook(['close'], 'freelook close', staff);
  check('freelook: close is a noop response', closed?.type === 'noop', JSON.stringify(closed));
  check('freelook: …and leaves no row behind', !_test.viewers.has(staff.id));

  // Closing must work for somebody with NO clearance — a role change underneath an open view must
  // never leave a pane that cannot be shut.
  _test.viewers.set(me.id, { gx: 1, gy: 1 });
  freelook(['close'], 'freelook close', { ...me, role: 'player' });
  check('freelook: close is not behind the clearance gate', !_test.viewers.has(me.id));

  // ── The vantage ──
  // A telescope is the same camera bolted down, and the two things that are silent when they are
  // wrong here are the gate (it must NOT be the staff one — a fitting in a room you already got
  // into is not a way to look at ground you have not walked to) and what the wire carries, because
  // a leash or a bearing that arrives as a string reaches the camera as NaN: it draws nothing,
  // throws nothing, and leaves a player standing in a frozen frame.
  const { telescope } = commands;
  // ⚠ THROUGH THE REAL DISPATCHER ONCE, because everything below calls the handler directly and a
  // verb that is never registered answers exactly the same way when you do that. `telescope` is a
  // new name in a game with several hundred of them; this is the check that it reaches a player.
  const dispatched = await run('telescope');
  check('telescope: the verb is reachable from the dispatcher',
    dispatched?.type !== 'error' || !/unknown command/i.test(dispatched.message || ''), JSON.stringify(dispatched));

  const nowhere = telescope([], 'telescope', { ...me, current_zone: '__no_such_zone__' });
  check('telescope: a room with no vantage in it refuses', nowhere?.type === 'error', JSON.stringify(nowhere));
  // ⚠ AND THE REFUSAL NAMES NOTHING. A message that said which flag, fitting or room would have
  // worked turns a verb anybody may type into a detector for vantages they have not found.
  check('telescope: …without naming what would have worked',
    !/telescope|flag|furniture|deck/i.test(nowhere?.message || ''), nowhere?.message);

  // Derived from the live world rather than hardcoded, so content moving does not fail this.
  const vroom = getAllZones().find((z) => getZoneFurniture(z.id).some((f) => f.flags?.telescope));
  if (vroom) {
    const furn = _test.vantageIn(vroom.id);
    const at = tileUnder({ current_zone: vroom.id });
    check('telescope: the vantage room resolves to a world tile', !!at, `${vroom.id}`);
    const stand = _test.standBlock(furn);
    check('telescope: the stand block carries a finite leash and yaw',
      Number.isFinite(stand.leash) && stand.leash > 0 && Number.isFinite(stand.yaw), JSON.stringify(stand));
    check('telescope: …and either a mount or an eye height, never neither',
      !!stand.mount || Number.isFinite(stand.eye), JSON.stringify(stand));

    _test.viewers.delete(me.id);
    // The ordinary suite player, with no role at all — that is the point of this check.
    const opened = telescope([], 'telescope', { ...me, role: 'player', current_zone: vroom.id });
    check('telescope: an ordinary player may use one', opened?.type === 'system', JSON.stringify(opened));
    check('telescope: …and is registered as a viewer, so the sky follows',
      _test.viewers.get(me.id)?.gx === at.gx, JSON.stringify(_test.viewers.get(me.id)));
    const shut = telescope(['close'], 'telescope close', { ...me, role: 'player', current_zone: vroom.id });
    check('telescope: close is a noop response', shut?.type === 'noop', JSON.stringify(shut));
    check('telescope: …and leaves no row behind', !_test.viewers.has(me.id));
    // ⚠ CLOSING MUST WORK FROM ANYWHERE. The client's ✕ fires this verb, and by then the player may
    // have been moved out of the room by anything at all — a pane you cannot shut because you are
    // no longer standing at the thing you opened it with is a pane nobody can get out of.
    _test.viewers.set(me.id, { gx: 1, gy: 1 });
    telescope(['close'], 'telescope close', { ...me, current_zone: '__no_such_zone__' });
    check('telescope: …from a room with no vantage in it', !_test.viewers.has(me.id));
  }

  // A malformed authored flag must not reach the wire. `telescope: true` is the likeliest way for
  // somebody to write one, and a bare boolean has no mount, no leash and no bearing in it.
  const bare = _test.standBlock({ name: 'spyglass', flags: { telescope: true } });
  check('telescope: a bare flag still yields a finite leash', Number.isFinite(bare.leash) && bare.leash > 0, JSON.stringify(bare));
  const junk = _test.standBlock({ name: 'spyglass', flags: { telescope: { leash: 'far', yaw: 'north', mount: 7 } } });
  check('telescope: a string leash does not reach the camera as NaN',
    Number.isFinite(junk.leash) && Number.isFinite(junk.yaw), JSON.stringify(junk));
  check('telescope: …and an unreasonable one is bounded',
    _test.standBlock({ name: 'x', flags: { telescope: { leash: 900 } } }).leash <= 4);
}
