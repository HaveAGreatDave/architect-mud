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
import { layRows, seatsClash, archetypeOf, roomLayout, resolveSpot, dimsOf, roomFree, rowDrawn, formOf, roomSpecOf, FLAT_ROOM } from '../../client/shared/room-layout.js';
import { _test } from './index.js';

// what each kind of sold piece should be drawn as
const EXPECT = {
  item_furn_barstool_wreck: 'seat', item_furn_corpcore_bench: 'bench', item_furn_busted_sofa: 'sofa', item_furn_sleep_pod: 'bed',
  item_furn_crt_relic: 'screen', item_furn_fridge_coldbox: 'cold', item_furn_stove_hobline: 'hob', item_furn_microwave_pulsebox: 'hob',
  item_furn_counter_slab: 'surface', item_space_heater: 'small', item_furn_payphone_husk: 'prop', item_furn_freezer_ironchill: 'cold',
};
const TV = 'item_furn_datavision_tv', SOFA = 'item_furn_busted_sofa', FRIDGE = 'item_furn_fridge_coldbox', STOOL = 'item_furn_barstool_wreck';

// A resident in a furnished flat: placed when the Stage opens, then walked round the furniture.
async function residents(check) {
  const Z = '__roomstage_test_home__', N = '__roomstage_test_npc__', G = '__roomstage_test_guest__';
  const zone = { id: Z, name: Z, flags: { is_apartment: true }, exits: {}, players: new Set(), npcs: new Set([N, G]), enemies: new Set(), corpses: new Set() };
  world.zones.set(Z, zone);
  const npc = { id: N, name: 'Test Resident', zone_id: Z, home_zone: Z, flags: {}, posture: 'standing' }, guest = { id: G, name: 'Test Guest', zone_id: Z, home_zone: 'elsewhere', flags: {}, posture: 'standing' };
  world.npcs.set(N, npc); world.npcs.set(G, guest);
  try {
    npc.sex = 'female'; npc.flags.figure = { head: 3 };
    const told = _test.peopleIn(Z, []).find((p) => p.id === N);
    check('the room tells the client an NPC\'s sex and settled figure', told?.sex === 'female' && told?.figure?.head === 3, JSON.stringify(told));
    delete npc.flags.figure;
    // asleep, as the room text tags them: on the bed rather than stood by the door, and the sofa or a chair after it
    {
      const bed = { id: 'p-bed', name: 'a bed', arche: 'bed' }, sofa = { id: 'p-sofa', name: 'a sofa', arche: 'sofa' }, chair = { id: 'p-chair', name: 'a chair', arche: 'seat' };
      npc._ai = { homeSleeping: true };
      const a = _test.peopleIn(Z, [chair, sofa, bed]).find((p) => p.id === N);
      check('a resident asleep is laid on the bed, and the room says asleep', a?.asleep === true && a.posture === 'lying' && a.on === 'p-bed', JSON.stringify(a));
      const b = _test.peopleIn(Z, [chair]).find((p) => p.id === N);
      check('asleep with no bed or sofa, they doze in a chair', b?.posture === 'sitting' && b.on === 'p-chair', JSON.stringify(b));
      npc._ai = { dosedOut: true };
      const c = _test.peopleIn(Z, [bed]).find((p) => p.id === N);
      check('out cold is said as out cold, not asleep', c?.out === true && !c.asleep && c.posture === 'lying', JSON.stringify(c));
      delete npc._ai;
      npc.flags.personality = 'guard';
      check('a guard idles as a guard', _test.peopleIn(Z, []).find((p) => p.id === N)?.manner === 'guard');
      npc.flags.personality = 'bartender';
      check('a barkeep off shift idles as anybody does', !_test.peopleIn(Z, []).find((p) => p.id === N)?.manner);
      delete npc.flags.personality;
    }
    await _test.life.settleIn(Z);
    const stood = _test.life.stageOf(npc, Z);
    check('a resident is somewhere in their flat when the Stage opens', !!stood && (Array.isArray(stood.at) || Number.isInteger(stood.seat)), JSON.stringify(stood));
    check('a visitor is left to the engine', !_test.life.stageOf(guest, Z));
    _test.viewers.set(Z, new Set(['__nobody__']));
    const life = _test.life.lives.get(N);
    _test.life.tvBy.set(Z, N); life.next = 999; _test.life.tvChanged(Z);
    check('a viewer joining does not get up the resident who put the set on', life.next === 999 && _test.life.tvOf(Z));
    _test.life.tvBy.delete(Z);
    _test.life.ritual({ npc, clip: 'snort' });
    const taking = _test.life.stageOf(npc, Z);
    check('a resident taking something stands and plays its clip', taking?.clip === 'snort' && !taking.posture, JSON.stringify(taking));
    _test.life.ritual({ npc, clip: null });
    check('and stops when the ritual ends', _test.life.stageOf(npc, Z)?.clip !== 'snort');
    life.next = 0;
    await _test.life.tick();
    const going = _test.life.stageOf(npc, Z);
    check('when one is due, a resident sets off on a route', going?.route?.path?.length >= 2 && going.route.ms > 0, JSON.stringify(going));
    {
      const spec = { w: 8, d: 10, h: 2.7 }, wall = { id: 'w', name: 'wall', object_type: 'furniture', flags: { conceal_brand: 'C', conceal_hides: 'l', look: { arche: 'surface', form: 'barwall' } } };
      const lab = (concealed) => ({ id: 'l', name: 'chem lab', object_type: 'container', flags: { conceal_hidden_by: 'w', ...(concealed ? { concealed: true } : {}) } });
      const shut = layRows([wall, lab(true)], spec).pieces, open = layRows([wall, lab(false)], spec).pieces;
      check('a sealed Cachet says nothing of what it hides', shut.length === 1 && !shut[0].turned && !JSON.stringify(shut).includes('chem lab'), JSON.stringify(shut));
      check('a turned Cachet shows the lab, with its bench and keypad to hand', open.length === 1 && open[0].form === 'chemwall' && roomLayout(spec, open).stations.map((s) => s.verb).join() === 'workspace,keypad', JSON.stringify(open));
    }
    check('a lie seat clashes with a sit seat on the same piece', seatsClash({ piece: 'a', lie: true }, { piece: 'a' }) && !seatsClash({ piece: 'a' }, { piece: 'a' }) && !seatsClash({ piece: 'a', lie: true }, { piece: 'b' }));
    const L = roomLayout(_test.specOf(Z), []);
    check('the route ends on free floor', !going?.route || roomFree(L, ...going.route.path.at(-1)), JSON.stringify(going?.route?.path));
    npc.posture = 'lying';
    check('asleep or lying, the engine has them again', !_test.life.stageOf(npc, Z));
  } finally {
    _test.viewers.delete(Z); _test.life.lives.delete(N); world.npcs.delete(N); world.npcs.delete(G); world.zones.delete(Z);
  }
}

export default async function regress({ run, check, getPlayer }) {
  await residents(check);
  const flat = [...world.zones.values()].find((z) => z.flags?.is_apartment), probe = { id: '__room_avail' };
  _test.tellAvail({ ...probe, current_zone: flat?.id });
  check('the room button lights in a flat', _test.told.get(probe.id) === true, flat?.id);
  _test.tellAvail({ ...probe, current_zone: 'no_such_zone' });
  check('and goes dark where there is no Stage', _test.told.get(probe.id) === false);
  _test.told.delete(probe.id);
  for (const [id, want] of Object.entries(EXPECT)) {
    const it = getItem(id);
    if (!it) { check(`${id} exists`, false); continue; }
    check(`${it.name} is drawn as a ${want}`, archetypeOf(it.flags || {}, it.weight) === want, archetypeOf(it.flags || {}, it.weight));
  }

  // what a row's flags make it, for the rows a flat is fitted with
  check('a wardrobe is a wardrobe, not a fridge', archetypeOf({ container: 120000, wardrobe: true }, 0, 'container') === 'wardrobe');
  check('a shelf of a cabinet is not a second cabinet', !rowDrawn({ object_type: 'container', flags: { container: 20000, compartment_of: 'x' } }));
  check('a concealed piece is not drawn until it is found', !rowDrawn({ object_type: 'container', flags: { concealed: true } }));
  check('a sink, a toilet and a shower each have a shape', ['sink', 'toilet', 'shower'].every((t) => archetypeOf({}, 0, t) === t && rowDrawn({ object_type: t, flags: {} })));
  check('a hob fixture is drawn and a bare fixture is not', rowDrawn({ object_type: 'fixture', flags: { stove_tier: 'mid' } }) && !rowDrawn({ object_type: 'fixture', flags: {} }));
  check('a freezer paired with a fridge is a column', formOf('cold', { preserves: 'frozen', paired_container: 'x' }) === 'column');

  const p = getPlayer();
  const APT = '__roomstage_test_apt__', PLAIN = '__roomstage_test_plain__', BATH = '__roomstage_test_bath__', VACANT = '__roomstage_test_vacant__', DWELLING = '__roomstage_test_dwelling__';
  const savedZone = p.current_zone, savedPosture = p.posture, savedOn = p.sittingOn;
  const mk = (id, flags) => world.zones.set(id, { id, name: id, flags, exits: {}, players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set() });
  // a small room: no studio plan, so these checks read the plain wall-by-wall rules
  mk(APT, { is_apartment: true, room: [4, 5, 2.6] });
  mk(PLAIN, {});
  setApartmentCache(APT, { zone_id: APT, owner_id: p.id, owner_type: 'player' });
  try {
    p.current_zone = PLAIN;
    let r = await run('room');
    check('room refuses where there is no room to walk round', /no walking round/i.test(r?.message || ''), r?.message);

    // an `apartments` row only exists once a flat is let, so the flag is what makes it a flat
    mk(VACANT, { is_apartment: true });
    mk(DWELLING, { is_dwelling: true });
    check('a vacant flat has a Stage before anybody rents it', !!_test.specOf(VACANT));
    check('a dwelling that is not a flat needs its own flags.room', !_test.specOf(DWELLING), 'a bunkroom or a cistern is not a studio with a kitchen and a balcony');
    world.zones.delete(VACANT); world.zones.delete(DWELLING);
    const noStage = [...world.zones.values()].filter((z) => z.flags?.is_apartment && !_test.specOf(z.id)).map((z) => z.id);
    check('every flat in the world has a Stage', !noStage.length, noStage.slice(0, 5).join(' '));
    const crown = _test.specOf('zone_solenne_penthouse');
    check('the Solenne Penthouse has a Stage, with its spa behind it', crown?.w === 16 && crown?.annex?.zone === 'zone_solenne_penthouse_bath', JSON.stringify(crown)?.slice(0, 200));
    const lounge = await _test.roomPieces('zone_solenne_penthouse', crown), down = roomLayout(crown, lounge);
    check('its lounge is down in the pit and its bar and fire are on the floor', down.placed.find((x) => x.id === 'furn_penthouse_lounge')?.y0 === -crown.pit?.depth && !down.placed.find((x) => x.id === 'furn_penthouse_bar')?.y0 && down.placed.find((x) => x.id === 'furn_penthouse_fireplace')?.form === 'hearth', JSON.stringify(down.placed.map((x) => [x.id, x.y0])).slice(0, 300));

    p.current_zone = APT;
    world.zones.get(APT).players.add(p.id);
    const spec = _test.specOf(APT);
    check('a flat has a Stage at its own size', spec?.w === 4 && spec?.d === 5 && spec?.h === 2.6 && !spec.plan, JSON.stringify(spec));
    const studio = roomSpecOf({}, true);
    check('a flat with no size of its own is a studio', studio?.w === FLAT_ROOM.w && !!studio.plan?.counter, JSON.stringify(studio?.plan));
    check("a studio's way in is clear and its kitchen behind the counter", studio.plan.lobby[3] === studio.d && studio.plan.kitchen[3] <= studio.plan.lobby[2]);
    check('a flat upstairs has a balcony, and one on the ground floor has none', !!roomSpecOf({}, true, { storey: 3 }).balcony && !roomSpecOf({}, true, { storey: 1 }).balcony);

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

    // an en-suite: the zone `in` reaches, whose `out` comes back and whose parent is the flat, is drawn
    // on the flat's Stage, and going through its door doesn't close it
    {
      const here = [], was = getBroadcast();
      mk(BATH, {});
      world.zones.get(BATH).parent_zone = APT;
      world.zones.get(BATH).exits = { out: APT };
      world.zones.get(BATH).description = 'A bathroom.'; world.zones.get(APT).description = 'A flat.';
      world.zones.get(APT).exits = { in: BATH, south: PLAIN };
      check('annexOf finds the en-suite and mainOf the flat from it', _test.annexOf(APT)?.id === BATH && _test.mainOf(BATH) === APT && _test.mainOf(APT) === APT);
      check('a lift behind an in exit is not an en-suite', (() => { world.zones.get(BATH).parent_zone = PLAIN; const no = !_test.annexOf(APT); world.zones.get(BATH).parent_zone = APT; return no; })());
      const s2 = _test.specOf(APT);
      check('a flat with an en-suite says so in its spec', s2?.annex?.zone === BATH && s2.annex.u[1] <= s2.door[0], JSON.stringify(s2?.annex));
      const made = await insertFurniture({ id: '__roomstage_test_toilet__', zone_id: BATH, name: 'test pan', description: 'A test pan.', object_type: 'toilet', flags: {} });
      const all = await _test.roomPieces(APT, s2);
      const pan = all.find((x) => x.id === '__roomstage_test_toilet__');
      check("the en-suite's pieces come with the flat's, marked", pan?.annex === true && pan.arche === 'toilet', JSON.stringify(pan));
      check('a toilet offers what the bodily plugin can do with it', ['pee', 'poop', 'flush'].every((v) => pan?.acts?.some((x) => x.verb === v)), JSON.stringify(pan?.acts));
      const L2 = roomLayout(s2, all), door = (s2.annex.door[0] + s2.annex.door[1]) / 2;
      check('you can stand in the doorway to it, and in it', roomFree(L2, door, s2.d + 0.07) && roomFree(L2, door, L2.annex.v0 + 0.5));
      setBroadcast((z, msg, ex, to) => { if (to === p.id) here.push(msg); return was?.(z, msg, ex, to); });
      try {
        // the real verbs, through the real movement code
        r = await run('in');
        await new Promise((res) => setTimeout(res, 20));
        check('in walks into the en-suite', p.current_zone === BATH, p.current_zone);
        check('going through the door keeps the Stage open', _test.viewers.get(APT)?.has(p.id));
        check('and says which side you are on', here.some((m) => m.type === 'room_here' && m.here === BATH), JSON.stringify(here.map((m) => m.type)));
        r = await run('room');
        check('room opens from the en-suite too', r?.type === 'noop' && _test.viewers.get(APT)?.has(p.id), JSON.stringify(r));
        // a second step is paced, so it lands a beat later
        r = await run('out');
        for (let i = 0; i < 80 && p.current_zone !== APT; i++) await new Promise((res) => setTimeout(res, 50));
        check('and out walks back, with the Stage still open', p.current_zone === APT && _test.viewers.get(APT)?.has(p.id), p.current_zone);
      } finally {
        setBroadcast(was);
        if (made) await deleteFurniture(made.id ?? '__roomstage_test_toilet__').catch(() => {});
        world.zones.get(APT).exits = {};
        world.zones.delete(BATH);
      }
    }

    // a room's outlook: the tile its building stands on, and the bearing from its way in
    {
      const TILE = '__roomstage_test_tile__';
      world.zones.set(TILE, { id: TILE, name: TILE, flags: {}, exits: {}, map_id: 'map_world', grid_x: 914, grid_y: 908, players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set() });
      Object.assign(world.zones.get(APT), { parent_zone: TILE, marker: '30', exits: { west: PLAIN } });
      const o = _test.outlookOf(APT);
      check('a flat looks out from its building, its storey and away from its door', o?.gx === 914 && o.gy === 908 && o.storey === 30 && o.bearing === 90, JSON.stringify(o));
      const full = _test.outlookPayload(APT);
      check('room_outlook carries a map window', full?.type === 'room_outlook' && full.map?.length > 1);
      check('room_outlook carries the fields flights go between', Array.isArray(full?.fields) && full.fields.length > 0 && full.fields.every((f) => f.id && Number.isFinite(f.gx) && typeof f.pad === 'boolean'), JSON.stringify(full?.fields)?.slice(0, 160));
      check('room_outlook carries who is flying', Array.isArray(full?.contacts));

      // the sky: nothing to nobody, and to a viewer every sixth beat at the latest
      const heard = [], realSend = globalThis.__roomSkySink, wasOpen = [..._test.viewers];
      globalThis.__roomSkySink = (id, m) => heard.push([id, m]);
      _test.viewers.clear();
      _test.skyTick();
      check('with no room open the sky tick sends nothing', heard.length === 0);
      _test.viewers.set(APT, new Set([p.id]));
      for (let i = 0; i < 6; i++) _test.skyTick();
      const sky = heard.map(([, m]) => m).find((m) => m.weather !== undefined);
      check('a viewer is told the weather within six beats', sky?.type === 'room_sky' && sky.zone === APT && 'wind' in sky && 'here' in sky && Array.isArray(sky.contacts), JSON.stringify(heard.slice(0, 2)).slice(0, 200));
      check('nobody is told it twice in six beats when nobody is flying', heard.filter(([, m]) => m.weather !== undefined).length === 1, String(heard.length));
      _test.viewers.clear();
      for (const [z, set] of wasOpen) _test.viewers.set(z, set);
      globalThis.__roomSkySink = realSend;

      Object.assign(world.zones.get(APT), { parent_zone: null, marker: null, exits: {} });
      world.zones.delete(TILE);
      check('a room with no tile has no outlook', _test.outlookOf(APT) === null);
    }

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
    world.zones.delete(APT); world.zones.delete(PLAIN); world.zones.delete(BATH);
  }
}
