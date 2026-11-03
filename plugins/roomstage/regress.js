// Room Stage regression suite, run by tests/regress.js (never loaded in production). Covers the
// archetype each sold furniture item is drawn as, the spot stamped when a piece lands, the layout's
// seats and stations, the `room` verb's gating, the position relay and `arrange`. Every row it makes is in a
// throwaway zone and removed in the finally.
import { emit } from '../../server/engine/events.js';
import { world, setApartmentCache, getZoneFurniture, deleteFurnitureWhere, insertFurniture, deleteFurniture } from '../../server/engine/world.js';
import { getBroadcast, setBroadcast } from '../../server/engine/messaging.js';
import { getItem } from '../../server/engine/items-cache.js';
import { giveItemById } from '../../server/engine/inventory.js';
import { query } from '../../server/models/db.js';
import { archetypeOf, roomLayout, resolveSpot, dimsOf, roomFree } from '../../client/shared/room-layout.js';
import { _test } from './index.js';

// what each kind of sold piece should be drawn as
const EXPECT = {
  item_furn_barstool_wreck: 'seat', item_furn_corpcore_bench: 'bench', item_furn_busted_sofa: 'sofa', item_furn_sleep_pod: 'bed',
  item_furn_crt_relic: 'screen', item_furn_fridge_coldbox: 'cold', item_furn_stove_hobline: 'hob', item_furn_microwave_pulsebox: 'hob',
  item_furn_counter_slab: 'surface', item_space_heater: 'small', item_furn_payphone_husk: 'prop', item_furn_freezer_ironchill: 'cold',
};
const TV = 'item_furn_datavision_tv', SOFA = 'item_furn_busted_sofa', FRIDGE = 'item_furn_fridge_coldbox', STOOL = 'item_furn_barstool_wreck';

export default async function regress({ run, check, getPlayer }) {
  for (const [id, want] of Object.entries(EXPECT)) {
    const it = getItem(id);
    if (!it) { check(`${id} exists`, false); continue; }
    check(`${it.name} is drawn as a ${want}`, archetypeOf(it.flags || {}, it.weight) === want, archetypeOf(it.flags || {}, it.weight));
  }

  const p = getPlayer();
  const APT = '__roomstage_test_apt__', PLAIN = '__roomstage_test_plain__';
  const savedZone = p.current_zone, savedPosture = p.posture, savedOn = p.sittingOn;
  const mk = (id, flags) => world.zones.set(id, { id, name: id, flags, exits: {}, players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set() });
  mk(APT, { is_apartment: true });
  mk(PLAIN, {});
  setApartmentCache(APT, { zone_id: APT, owner_id: p.id, owner_type: 'player' });
  try {
    p.current_zone = PLAIN;
    let r = await run('room');
    check('room refuses where there is no room to walk round', /no walking round/i.test(r?.message || ''), r?.message);

    p.current_zone = APT;
    world.zones.get(APT).players.add(p.id);
    const spec = _test.specOf(APT);
    check('a flat has a Stage at the default size', spec?.w === 4 && spec?.d === 5 && spec?.h === 2.6, JSON.stringify(spec));

    // furnish it the way a player would: carry four pieces in and place them
    for (const id of [TV, SOFA, FRIDGE, STOOL]) await giveItemById(p.id, id, 1);
    delete p._carriedWeight;
    for (const name of ['datavision', 'busted sofa', 'coldbox', 'barstool']) {
      r = await run(`place ${name}`);
      check(`place ${name}`, /set the .* down/i.test(r?.message || ''), r?.message);
    }
    // the stamp lands on the furniture.changed after place
    await new Promise((res) => setTimeout(res, 50));
    const rows = getZoneFurniture(APT).filter((f) => f.origin === 'player');
    check('every placed piece has its spot stamped on the row', rows.length === 4 && rows.every((f) => f.flags?.spot), JSON.stringify(rows.map((f) => [f.name, f.flags?.spot])));

    const view = await _test.viewPayload(p, APT, spec);
    check('room_view carries the spec, the pieces and the people', view.type === 'room_view' && view.pieces.length === 4 && view.people.some((x) => x.id === p.id), JSON.stringify(view).slice(0, 300));
    const again = await _test.viewPayload(p, APT, spec);
    check('a piece stays where it was stamped', JSON.stringify(again.pieces.map((x) => x.spot)) === JSON.stringify(view.pieces.map((x) => x.spot)));
    const tv = view.pieces.find((x) => x.arche === 'screen'), sofa = view.pieces.find((x) => x.arche === 'sofa');
    check('the screen hangs on a wall', !!tv?.spot?.wall, JSON.stringify(tv?.spot));

    // the layout the client will build: no two floor pieces overlap, the sofa faces the screen
    const L = roomLayout(spec, view.pieces);
    const fps = L.placed.filter((x) => !(x.arche === 'screen' && !x.crt)).map((x) => { const q = Math.round(((x.turn % 360) + 360) % 360 / 90) % 2; const hw = (q ? x.d : x.w) / 2, hd = (q ? x.w : x.d) / 2; return [x.u - hw, x.u + hw, x.v - hd, x.v + hd]; });
    let overlap = false;
    for (let i = 0; i < fps.length; i++) for (let j = i + 1; j < fps.length; j++) { const a = fps[i], b = fps[j]; if (a[0] < b[1] - 1e-6 && a[1] > b[0] + 1e-6 && a[2] < b[3] - 1e-6 && a[3] > b[2] + 1e-6) overlap = true; }
    check('no two pieces stand in each other', !overlap, JSON.stringify(fps));
    const sp = L.placed.find((x) => x.arche === 'sofa'), tp = L.placed.find((x) => x.arche === 'screen');
    const face = [Math.sin(sp.turn * Math.PI / 180), -Math.cos(sp.turn * Math.PI / 180)], toTv = [tp.u - sp.u, tp.v - sp.v];
    check('the sofa faces the screen', face[0] * toTv[0] + face[1] * toTv[1] > 0.5 * Math.hypot(...toTv), JSON.stringify({ sofa: sofa?.spot, tv: tv?.spot }));
    check('the sofa gives seats to sit in and one to lie on', L.seats.filter((s) => s.piece === sp.id && !s.lie).length >= 2 && L.seats.some((s) => s.piece === sp.id && s.lie));
    check('the fridge is a station that opens it', L.stations.some((st) => st.verb === 'open' && /coldbox/i.test(st.target)));
    check('the middle of the room is free to stand in', roomFree(L, 0, spec.d / 2) || roomFree(L, 0.6, spec.d * 0.65));
    check('a spot resolves inside the room', L.placed.every((x) => Math.abs(x.u) <= spec.w / 2 && x.v >= 0 && x.v <= spec.d));
    check('a sofa is longer than a stool is wide', dimsOf('sofa', 20000)[0] > dimsOf('seat', 3000)[0]);

    // room opens it; the position relay clamps to the room and records the seat
    r = await run('room');
    check('room opens the Stage in a flat', r?.type === 'noop' && _test.viewers.get(APT)?.has(p.id), JSON.stringify(r));
    emit('room.pos', { playerId: p.id, at: [99, -4], yaw: 1.2, seat: 2 });
    const w = _test.where.get(p.id);
    check('a settled position is clamped into the room', w?.at[0] === 2 && w?.at[1] === 0 && w?.seat === 2, JSON.stringify(w));

    // arrange: a placed piece to another wall, with the Stage open so the viewer is sent it
    const sent = [], prevBroadcast = getBroadcast();
    setBroadcast((z, msg, ex, to) => { if (to === p.id) sent.push(msg); return prevBroadcast?.(z, msg, ex, to); });
    try {
      const rowNamed = (re) => getZoneFurniture(APT).find((f) => f.origin === 'player' && re.test(f.name));
      const sofaRow = rowNamed(/sofa/i);
      const settle = () => new Promise((res) => setTimeout(res, 50));
      const overlapIn = async () => {
        const v = await _test.viewPayload(p, APT, spec);
        const fp = roomLayout(spec, v.pieces).placed.filter((x) => !(x.arche === 'screen' && !x.crt)).map((x) => { const q = Math.round(((x.turn % 360) + 360) % 360 / 90) % 2; const hw = (q ? x.d : x.w) / 2, hd = (q ? x.w : x.d) / 2; return [x.u - hw, x.u + hw, x.v - hd, x.v + hd]; });
        for (let i = 0; i < fp.length; i++) for (let j = i + 1; j < fp.length; j++) { const a = fp[i], b = fp[j]; if (a[0] < b[1] - 1e-6 && a[1] > b[0] + 1e-6 && a[2] < b[3] - 1e-6 && a[3] > b[2] + 1e-6) return JSON.stringify(v.pieces.map((x) => [x.name, x.spot])); }
        return '';
      };

      r = await run('arrange busted sofa left');
      await settle();
      check('arrange moves a placed piece against the named wall', /against the left wall/i.test(r?.message || '') && rowNamed(/sofa/i)?.flags?.spot?.wall === 'left', `${r?.message} ${JSON.stringify(rowNamed(/sofa/i)?.flags?.spot)}`);
      const moved = sent.filter((m) => m.type === 'room_piece' && m.piece?.id === sofaRow?.id).at(-1);
      check('a viewer gets room_piece with the new spot', moved?.piece?.spot?.wall === 'left', JSON.stringify(moved));
      let clash = await overlapIn();
      check('the moved piece stands in nothing', !clash, clash);
      r = await run('arrange busted sofa left');
      check('arrange to the wall a piece is on says so', /already against the left wall/i.test(r?.message || ''), r?.message);

      r = await run('arrange coldbox window');
      check('window is the front wall', rowNamed(/coldbox/i)?.flags?.spot?.wall === 'front', `${r?.message} ${JSON.stringify(rowNamed(/coldbox/i)?.flags?.spot)}`);
      r = await run('arrange busted sofa against the door wall');
      check('door is the back wall', rowNamed(/sofa/i)?.flags?.spot?.wall === 'back', `${r?.message} ${JSON.stringify(rowNamed(/sofa/i)?.flags?.spot)}`);
      check('arrange reads past filler words and "wall"', JSON.stringify(_test.parseArrange(['the', 'busted', 'sofa', 'by', 'the', 'window', 'wall'])) === JSON.stringify({ target: 'busted sofa', wall: 'front' }));

      // the sofa and the fridge take the back wall up to the doorway, so the stool has no room there
      r = await run('arrange coldbox door');
      check('the fridge fits beside the sofa on the back wall', rowNamed(/coldbox/i)?.flags?.spot?.wall === 'back', `${r?.message} ${JSON.stringify(rowNamed(/coldbox/i)?.flags?.spot)}`);
      const stoolBefore = JSON.stringify(rowNamed(/barstool/i)?.flags?.spot);
      r = await run('arrange barstool door');
      check('a full wall refuses', /no room for the .* against that wall/i.test(r?.message || '') && JSON.stringify(rowNamed(/barstool/i)?.flags?.spot) === stoolBefore, `${r?.message} ${JSON.stringify(rowNamed(/barstool/i)?.flags?.spot)}`);
      clash = await overlapIn();
      check('after the moves nothing stands in anything else', !clash, clash);

      // no wall: back to the spot place would pick now, facing the screen
      r = await run('arrange busted sofa');
      check('arrange with no wall puts the sofa back facing the screen', Array.isArray(rowNamed(/sofa/i)?.flags?.spot?.at) && /put the .* back/i.test(r?.message || ''), `${r?.message} ${JSON.stringify(rowNamed(/sofa/i)?.flags?.spot)}`);

      // refusals: somebody on it, somebody else's room, an authored piece, nothing by that name
      p.posture = 'sitting'; p.sittingOn = sofaRow?.name;
      r = await run('arrange busted sofa right');
      check('arrange refuses a piece someone is sitting on', /using the/i.test(r?.message || '') && Array.isArray(rowNamed(/sofa/i)?.flags?.spot?.at), r?.message);
      p.posture = savedPosture || 'standing'; p.sittingOn = null;

      setApartmentCache(APT, { zone_id: APT, owner_id: '__someone_else__', owner_type: 'player' });
      r = await run('arrange coldbox right');
      check('arrange refuses someone who does not control the room', /isn't your place/i.test(r?.message || '') && rowNamed(/coldbox/i)?.flags?.spot?.wall === 'back', r?.message);
      setApartmentCache(APT, { zone_id: APT, owner_id: p.id, owner_type: 'player' });

      await insertFurniture({ id: '__roomstage_fixed__', zone_id: APT, name: 'bolted shelf', description: 'A shelf bolted to the floor.', flags: JSON.stringify({ interactions: ['lean'] }), object_type: 'furniture' });
      r = await run('arrange bolted shelf left');
      check('arrange refuses an authored piece', /fixed in place/i.test(r?.message || ''), r?.message);
      await deleteFurniture('__roomstage_fixed__');

      r = await run('arrange grand piano left');
      check('arrange names a piece that is not there', /no "grand piano" in here/i.test(r?.message || ''), r?.message);
    } finally {
      setBroadcast(prevBroadcast);
    }

    r = await run('room close');
    check('room close shuts it', !_test.viewers.get(APT)?.has(p.id));

    // take a piece back: it leaves the room
    r = await run('take barstool');
    check('take still picks a piece up', /pick up the wobbly barstool/i.test(r?.message || ''), r?.message);
    check('resolveSpot reads a wall spot in metres', resolveSpot({ w: 4, d: 5, unit: 'm' }, { wall: 'left', along: 2 }, [1, 0.5, 1]).u === -2 + 0.27);
  } finally {
    p.current_zone = savedZone; p.posture = savedPosture; p.sittingOn = savedOn;
    delete p._carriedWeight;
    _test.viewers.delete(APT); _test.where.delete(p.id);
    await deleteFurnitureWhere('DELETE FROM furniture WHERE zone_id=$1', [APT]).catch(() => {});
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id = ANY($2)', [p.id, [TV, SOFA, FRIDGE, STOOL]]).catch(() => {});
    world.apartments.delete(APT);
    world.zones.delete(APT); world.zones.delete(PLAIN);
  }
}
