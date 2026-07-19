// Elevator plugin regression suite (harness-only, never loaded in production).
import { _test } from './index.js';
import { getZone } from '../../server/engine/world.js';
import { moveEntity } from '../../server/engine/ai-behaviour.js';

export default async function regress({ run, check, getPlayer }) {
  // Verb routes and self-gates: pin the player to a definitely-non-elevator zone
  // (a bogus id → getZone() is undefined → not an elevator) so `floor` reaches the
  // plugin and refuses cleanly regardless of which zone the harness happened to
  // spawn into — otherwise a real elevator car in the world makes `floor 50` ride.
  const p = getPlayer();
  const savedZone = p.current_zone;
  p.current_zone = 'zone_regress_not_an_elevator';
  const r = await run('floor 50');
  p.current_zone = savedZone;
  check('floor routes to plugin', r?.type === 'error', r?.message);
  check('floor gates on being in a car', /elevator/i.test(r?.message || ''), r?.message);

  // Directory builder: display numbers survive, sorted high→low, buttons carry the raw cmd.
  const floors = _test.floorsOf({ flags: { elevator_floors: [
    { n: 50, zone: 'z_a', label: 'Arcade' },
    { n: 54, zone: 'z_b', label: 'Executive' },
    { n: 'x', zone: 'z_bad' },        // garbled — dropped
    { n: 52, zone: 'z_c', label: 'Claims' },
  ] } });
  check('floors parsed + garbage dropped', floors.length === 3, `got ${floors.length}`);
  check('floors sorted top-first', floors[0].n === 54 && floors[2].n === 50, floors.map(f => f.n).join(','));

  const panel = _test.buildPanel(floors);
  check('panel lists floor 50+', panel.includes('floor 54') && panel.includes('floor 50'), panel);
  check('panel buttons are clickable', panel.includes('data-raw-cmd="floor 54"'), panel);

  // Non-elevator zone gets no panel.
  check('non-elevator has no panel', !_test.describeRoom({ flags: {} }), 'panel leaked into a normal room');

  // ── Input matchers: they only bite inside a car ─────────────────────────────
  // Outside an elevator, a bare number and up/down must fall through untouched.
  p.current_zone = 'zone_regress_not_an_elevator';

  const bareOut = await _test.matchBareFloor([], '44', p, () => {});
  check('bare number falls through outside a car', bareOut === undefined, `got ${bareOut?.type}`);

  const dirOut = _test.matchElevatorDir([], 'up', p, () => {});
  check('up falls through outside a car', dirOut === undefined, `got ${dirOut?.type}`);

  // Confirm the driven pipeline agrees: `up` in a non-elevator is NOT claimed by
  // the elevator redirect — it falls through to normal movement handling.
  const upDriven = await run('up');
  check('up not claimed by elevator outside a car', upDriven?.type !== 'output' || !/Enter a number/i.test(upDriven?.message || ''), upDriven?.message);

  // Inside a real car, up/down reprint the panel instead of moving (no ride).
  // The zone may not exist in a minimal harness world — self-skip if absent.
  const car = getZone('zone_solenne_elevator');
  if (_test.isElevator(car)) {
    p.current_zone = car.id;
    const dirIn = _test.matchElevatorDir([], 'up', p, () => {});
    check('up in a car reprints the panel', dirIn?.type === 'output' && /floor/i.test(dirIn.message), dirIn?.message);
    check('panel redirect never rides', !p._elevator, 'a redirect started a ride');

    // A bare number routes to the floor picker; an off-panel number is refused
    // cleanly (no teleport), proving the number reached cmdFloor.
    const badFloor = await _test.matchBareFloor([], '999', p, () => {});
    check('off-panel number refused, no ride', badFloor?.type === 'error' && !p._elevator, badFloor?.message);

    // Ground floor is an implicit default: floorsOf injects Floor 1 riding to the
    // car's `out` target (the lobby), even though the content never lists it.
    const carFloors = _test.floorsOf(car);
    const ground = carFloors.find((f) => f.n === 1);
    const lobbyId = car.exits?.out;
    check('ground floor injected as Floor 1', !!ground && ground.zone === lobbyId, JSON.stringify(carFloors.map((f) => f.n)));

    // The graph stays intact for NPC pathfinding: hiding exits is display-only, so
    // the car keeps its real up/out targets.
    check('car keeps real up-exit (NPC pathing)', getZone(car.id).exits?.up?.length > 0 || typeof getZone(car.id).exits?.up === 'string', JSON.stringify(car.exits));
    check('car keeps real out-exit (NPC pathing)', !!car.exits?.out, JSON.stringify(car.exits));

    // hide_exits (display-only) suppresses the engine exit/room/building list, but
    // the floor panel (the real exit UI) still renders. Toggle it on the live zone
    // object so this holds whether or not the flag has been imported to the DB yet.
    const prevHide = car.flags.hide_exits;
    car.flags.hide_exits = true;
    const lookHidden = await run('look');
    check('hide_exits suppresses the exit list', !/(Exits|Buildings|Rooms):/.test(lookHidden?.message || ''), lookHidden?.message);
    check('floor panel survives the hide', /FLOOR SELECT/i.test(lookHidden?.message || ''), lookHidden?.message);
    car.flags.hide_exits = prevHide;

    // NPC arrival/departure flavour: a throwaway NPC into then out of the car
    // reads as riding the lift, never "the stairs" (every floor shares the `up`
    // exit). Capture the broadcast lines; scrub the fake NPC from the zone sets
    // afterward so it leaves no residue for later suites.
    const floorId = car.flags.elevator_floors?.[0]?.zone;
    if (floorId && getZone(floorId)) {
      const msgs = [];
      const bc = (_z, payload) => { if (payload?.message) msgs.push(payload.message); };
      const bot = { id: 'zzz_regress_liftbot', name: 'Liftbot', zone_id: floorId };
      moveEntity(bot, car.id, bc, () => {});    // floor → car (boarding)
      moveEntity(bot, floorId, bc, () => {});   // car → floor (stepping out)
      getZone(car.id)?.npcs?.delete(bot.id);
      getZone(floorId)?.npcs?.delete(bot.id);
      check('NPC boarding reads as the elevator', msgs.some((m) => /steps into the (elevator|car)/i.test(m)), msgs.join(' | '));
      check('NPC exit reads as the elevator', msgs.some((m) => /elevator chimes|steps out of the elevator/i.test(m)), msgs.join(' | '));
      check('no "stairs" wording on elevator moves', !msgs.some((m) => /the stairs/i.test(m)), msgs.join(' | '));
    }
  }

  p.current_zone = savedZone;
}
