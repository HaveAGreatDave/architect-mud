// Room Stage regression suite, run by tests/regress.js (never loaded in production). Covers the
// archetype each sold furniture item is drawn as, the spot stamped when a piece lands, the layout's
// seats and stations, the `room` verb's gating, the position relay and `arrange`. Every row it makes is in a
// throwaway zone and removed in the finally.
import { emit } from '../../server/engine/events.js';
import { world, setApartmentCache, getZoneFurniture, deleteFurnitureWhere, insertFurniture, deleteFurniture, setDoorCache, deleteDoorCache, doorOnLink } from '../../server/engine/world.js';
import { getBroadcast, setBroadcast } from '../../server/engine/messaging.js';
import { getItem } from '../../server/engine/items-cache.js';
import { giveItemById } from '../../server/engine/inventory.js';
import { query } from '../../server/models/db.js';
import { layRows, seatsClash, archetypeOf, roomLayout, resolveSpot, dimsOf, roomFree, onFoot, roomNearFree, roomPath, seatApproach, rowDrawn, formOf, roomSpecOf, FLAT_ROOM, openingCrossed, openingInside } from '../../client/shared/room-layout.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { _test } from './index.js';
import { ritualOf, actOfDrug } from './acts.js';

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
    // an enemy with a fauna model is sent as a beast; one without, or dead, isn't
    {
      const E = '__roomstage_test_hound__', E2 = '__roomstage_test_rat__';
      world.enemies.set(E, { instanceId: E, name: 'gutter hound', zoneId: Z, flags: { fauna: 'quadruped/hound' } });
      world.enemies.set(E2, { instanceId: E2, name: 'rat', zoneId: Z, flags: {} });
      zone.enemies.add(E); zone.enemies.add(E2);
      try {
        const b = _test.beastsIn(Z);
        check('an enemy with a fauna model is sent to the Stage as a beast', b.length === 1 && b[0].id === E && b[0].fauna === 'quadruped/hound', JSON.stringify(b));
        world.enemies.get(E)._dead = true;
        check('a dead beast is not sent', _test.beastsIn(Z).length === 0);
      } finally { zone.enemies.delete(E); zone.enemies.delete(E2); world.enemies.delete(E); world.enemies.delete(E2); }
    }
    delete npc.flags.figure;
    // a mood: the base one from content, a transient one over it, and nothing asleep
    {
      const { setNpcMood } = await import('../../server/engine/npc-mood.js');
      npc.flags.mood = 'sad';
      check('an NPC\'s resting mood goes to the client', _test.peopleIn(Z, []).find((p) => p.id === N)?.mood?.m === 'sad');
      setNpcMood(npc, 'angry', { i: 1, secs: 30 });
      const m = _test.peopleIn(Z, []).find((p) => p.id === N)?.mood;
      check('a transient mood wins over the resting one, with its time left', m?.m === 'angry' && m.s > 0 && m.s <= 30, JSON.stringify(m));
      check('a weaker mood does not cut a stronger one short', !setNpcMood(npc, 'happy', { i: 0.3 }));
      npc._ai = { homeSleeping: true };
      check('asleep, no mood shows', !_test.peopleIn(Z, []).find((p) => p.id === N)?.mood);
      delete npc._ai; npc._mood = null; delete npc.flags.mood;
    }
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
    // what they're dressed for, and against: the occasion and the temperature band go to the client, unless a look
    // was authored for it, which goes over their own instead
    {
      const d = (asleep, feel, who = npc) => _test.dressedAs(who, Z, asleep, feel);
      check('a resident awake at home is dressed for home', d(false, 0).wear?.occasion === 'home' && !d(false, 0).wear.feel, JSON.stringify(d(false, 0)));
      check('asleep at home, for bed', d(true, 0).wear?.occasion === 'sleep');
      check('a visitor in the morning keeps the clothes they came in', !d(false, 0, guest).wear, JSON.stringify(d(false, 0, guest)));
      check('a cold room is a band to dress against, and a hot one', d(false, -0.8).wear?.feel === -2 && d(false, 0.2).wear?.feel === 1 && d(false, 0.2, guest).wear?.feel === 1);
      npc.flags.figure_sleep = { cut: 'slip' }; npc.flags.figure_cold = { cut: 'parka', hat: 'beanie' };
      const bed = d(true, 0), cold = d(false, -0.8);
      check('an authored look for bed goes over their own, and the client is told nothing to add', bed.figure?.cut === 'slip' && !bed.wear, JSON.stringify(bed));
      check('an authored look for the cold does too, and they are still dressed for home', cold.figure?.cut === 'parka' && cold.wear?.occasion === 'home' && !cold.wear.feel, JSON.stringify(cold));
      delete npc.flags.figure_sleep; delete npc.flags.figure_cold;
      const p = _test.peopleIn(Z, []).find((q) => q.id === N);
      check('the room sends what to dress them for', p?.wear?.occasion === 'home', JSON.stringify(p));
    }
    // a shower stall is somewhere you walk into: the middle of it is free floor with its station there; a bath isn't
    {
      const spec = { w: 4, d: 4, h: 2.6 };
      for (const [form, open] of [['stall', true], ['bath', false]]) {
        const rows = [{ id: 'sh_' + form, name: 'shower', object_type: 'shower', flags: { look: { arche: 'shower', form }, spot: { wall: 'back', along: 0.5 } } }];
        const L = roomLayout(spec, layRows(rows, spec).pieces), p = L.placed[0];
        check(`a ${form} you ${open ? 'can' : "can't"} stand in`, !!p && roomFree(L, p.u, p.v) === open, p ? [p.u, p.v, p.form] : 'not placed');
        if (open) check('...with its station under the head', L.stations.some((s) => s.piece === p.id && Math.hypot(s.u - p.u, s.v - p.v) < 0.01));
      }
    }
    // you can climb on a chair or a bed, but nobody else walks through one or stands in it (room-layout.js onFoot)
    {
      const spec = { w: 5, d: 6, h: 2.6 };
      const rows = [
        { id: 'ch', name: 'chair', object_type: 'furniture', flags: { interactions: ['sit'], look: { arche: 'seat', form: 'chair' }, spot: { at: [0, 3], turn: 0 } } },
        { id: 'bd', name: 'bed', object_type: 'furniture', flags: { interactions: ['lie'], look: { arche: 'bed' }, spot: { wall: 'back', along: 0.3 } } },
      ];
      const L = roomLayout(spec, layRows(rows, spec).pieces), F = onFoot(L);
      const inside = (p) => L.climb.some(([a, b, c, e]) => p[0] > a && p[0] < b && p[1] > c && p[1] < e);
      const ch = L.placed.find((p) => p.id === 'ch'), bd = L.placed.find((p) => p.id === 'bd');
      check('you can still step up on a chair', !!ch && roomFree(L, ch.u, ch.v) && !roomFree(F, ch.u, ch.v), JSON.stringify(ch && [ch.u, ch.v]));
      const near = [ch, bd].filter(Boolean).map((p) => roomNearFree(L, p.u, p.v, 1.8));
      check('a spot asked for on a chair or a bed is on the floor beside it', near.length === 2 && near.every((p) => p && !inside(p)), JSON.stringify(near));
      const seat = L.seats.find((s) => s.piece === 'ch'), go = seat && seatApproach(L, seat, 1.8);
      check('the spot to sit down from is off the chair', !!go && !inside(go), JSON.stringify(go));
      const path = ch && roomPath(L, [ch.u - 1.2, ch.v], [ch.u + 1.2, ch.v]), on = [];
      for (let i = 1; path && i < path.length; i++) for (let k = 0; k <= 20; k++) { const a = path[i - 1], b = path[i], p = [a[0] + (b[0] - a[0]) * k / 20, a[1] + (b[1] - a[1]) * k / 20]; if (inside(p)) on.push(p); }
      check('a way past a chair goes round it, not over it', !!path && !on.length, JSON.stringify({ path, on: on.slice(0, 3) }));
    }
    // somebody with a habit sits at a table to it (client/shared/table-stash.js): a chair pulled up to one, its
    // kit on the top in front of them, worked down one at a time; no table, or no habit, and there's no session
    {
      const { stashAt, kitOf } = await import('../../client/shared/table-stash.js');
      const spec = { w: 6, d: 7, h: 2.7 }, free = { seats: new Set(), pieces: new Set() };
      const rows = [
        { id: 't', name: 'kitchen table', object_type: 'furniture', flags: { look: { arche: 'table', form: 'dining' }, spot: { at: [0, 3.5], turn: 0 } } },
        { id: 'c', name: 'chair', object_type: 'furniture', flags: { interactions: ['sit'], look: { arche: 'seat', form: 'chair' }, spot: { at: [0, 4.3], turn: 0 } } },
      ];
      const L = roomLayout(spec, layRows(rows, spec).pieces), l = { main: Z, at: [2, 5], L };
      const habit = { id: '__habit', flags: { booze_habit: 'whisky' } }, none = { id: '__none', flags: {} };
      const job = _test.life.sessionJob(habit, l, L, free);
      check('somebody with a habit sits at the table to it', job?.kind === 'session' && job.on === 'c' && job.stash?.k === 'drink' && Math.abs(job.stash.at[2] - 0.76) < 0.01, JSON.stringify(job));
      check('...somebody without one does not', !_test.life.sessionJob(none, l, L, free));
      check('...and a room with no table has no session', !_test.life.sessionJob(habit, l, roomLayout(spec, layRows([rows[1]], spec).pieces), free));
      const s = { k: 'snort', of: 4, beat: kitOf('snort').beat };
      const first = stashAt(s, 1000), taking = stashAt(s, s.beat * 0.9), next = stashAt(s, s.beat * 1.1), over = stashAt(s, s.beat * 4 + 10);
      check('the kit goes down one at a time, on the clip that takes it', first.left === 4 && first.clip === 'sitCut' && taking.clip === 'sitLine' && taking.left === 3 && next.left === 3 && over.done && over.left === 0,
        JSON.stringify({ first, taking, next, over }));
    }
    // a meal is cooked at the hob; the camping stove on the floor is for a flat with no hob
    {
      const spec = { w: 6, d: 7, h: 2.7 }, row = (id, arche) => ({ id, name: id, object_type: 'furniture', flags: { look: { arche } } }), free = { seats: new Set(), pieces: new Set() };
      const cooks = (rows) => {
        const L = roomLayout(spec, layRows(rows, spec).pieces), how = new Set();
        for (let i = 0; i < 24; i++) {
          const l = { main: Z, at: [3, 3], L }, who = { id: '__cook_' + i };
          if (!_test.life.mealJob(who, l, L, free)) { how.add('none'); continue; }
          l.meal.stage = 'get';
          how.add(_test.life.mealJob(who, l, L, free)?.clip || 'stuck');
        }
        return [...how].join();
      };
      check('with a hob in the flat, everybody cooks at it', cooks([row('fridge', 'cold'), row('hob', 'hob')]) === 'stir', cooks([row('fridge', 'cold'), row('hob', 'hob')]));
      check('with none, they cook on the floor', cooks([row('fridge', 'cold')]) === 'squatStir', cooks([row('fridge', 'cold')]));
      const L = roomLayout(spec, layRows([row('fridge', 'cold'), row('hob', 'hob')], spec).pieces), kinds = (f, want = null) => _test.life.jobsIn(L, free, want, f).map((j) => j.kind);
      check('a room at room temperature has nothing to do about it', !kinds(0).some((k) => ['warm', 'heater', 'cool', 'air'].includes(k)));
      check('a cold room gives them something to do about the cold, and a hot one about the heat', kinds(-0.6).includes('warm') && kinds(0.6).includes('cool') && kinds(0.6).includes('air'));
      check('sent to warm up, that is all they choose from', kinds(-0.6, 'chill').join() === 'warm', kinds(-0.6, 'chill').join());
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
    // the lights are on unless the grid is down there: a room with no power_zones row is lit as it always was
    check('room_view says the mains are on in a room nobody wired', view.power === 'on' && _test.powerOf(APT) === 'on', String(view.power));
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

    // what they're doing with their hands (acts.js): a beat of their ritual, relayed to the room; a dose from the
    // log plays its route; an act that isn't one is refused
    {
      _test.acts.forget(p.id);
      emit('room.act', { playerId: p.id, act: 'drink', hold: 'can' });
      const me = _test.peopleIn(APT, []).find((x) => x.id === p.id);
      check("a ritual's beat shows the player drinking from a can", me?.act === 'drink' && me.hold === 'can' && me.beat === 1, JSON.stringify(me));
      _test.acts.forget(p.id);
      emit('room.act', { playerId: p.id, act: 'juggle', hold: 'can' });
      check('an act the room has no clip for is refused', !_test.acts.of(p.id));
      _test.acts.fromDose({ player: p, drug: { flags: { taken: 'inject' } } });
      check('a dose typed in the log plays its route', _test.acts.of(p.id)?.act === 'inject' && _test.acts.of(p.id)?.hold === 'syringe', JSON.stringify(_test.acts.of(p.id)));
      _test.acts.forget(p.id);
      check('pockets: food is eaten, a hydrating can is drunk, a drug goes by its route', ritualOf({ name: 'Bread roll', tags: { restore_hunger: 4 } }, 'x')?.act === 'eat'
        && ritualOf({ name: 'Can of cola', tags: { hydrating: 2 } }, 'y')?.hold === 'can' && actOfDrug({ flags: { taken: 'snort' } }) === 'snort' && actOfDrug({ flags: { alcoholic: true } }) === 'drink');
    }

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

    // a building's rooms are one walk (docs/proposals/building-stage.md): a doorway is the ordinary
    // `move <dir>`, the Stage stays open through it, and a door that won't let you through sends nothing
    {
      const MAP = '__roomstage_test_bmap__', T = '__roomstage_test_btile__', H1 = '__roomstage_test_b1__', H2 = '__roomstage_test_b2__', H3 = '__roomstage_test_b3__';
      const room = { w: 5, d: 4, h: 3, studio: false, balcony: false };
      const mkb = (id, map, flags, exits) => world.zones.set(id, { id, name: id, description: `Room ${id}.`, map_id: map, flags, exits, players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set() });
      mkb(T, 'map_world', {}, { north: H1 });
      mkb(H1, MAP, { room }, { south: T, north: H2 });
      mkb(H2, MAP, { room }, { south: H1, north: H3 });
      mkb(H3, MAP, { room }, { south: H2 });
      world.maps.set(MAP, { id: MAP, name: 'Test Block', parent_zone_id: T, entry_zone_id: H1 });
      const sent = [], was = getBroadcast(), savedZone2 = p.current_zone;
      let shut = false;
      registerMoveGate(({ to }) => (shut && to?.id === H3 ? { block: true, message: 'The door to the back is locked.' } : undefined), 'roomstage-regress');
      setBroadcast((z, msg, ex, to) => { if (to === p.id) sent.push(msg); return was?.(z, msg, ex, to); });
      const walkTo = async (dir, want) => { await run(dir); for (let i = 0; i < 80 && p.current_zone !== want; i++) await new Promise((res) => setTimeout(res, 50)); };
      // a piece in the first room and somebody in the last, seen from the middle one
      const NB = '__roomstage_test_bnpc__', PIECE = '__roomstage_test_bpiece__';
      world.npcs.set(NB, { id: NB, name: 'Test Neighbour', zone_id: H3, flags: {}, posture: 'standing' });
      world.zones.get(H3).npcs.add(NB);
      let made = null;
      try {
        made = await insertFurniture({ id: PIECE, zone_id: H1, name: 'test pan next door', description: 'A test pan.', object_type: 'toilet', flags: {} });
        _test.clearBuildings();
        const bld = _test.buildingOfRoom(H2);
        check('a building whose entry has a Stage is one walk', bld?.b.walk.length === 3 && _test.buildingOfRoom(H1) === bld && !bld.plan.problems.length, JSON.stringify(bld?.b.walk));
        const v2 = await _test.viewPayload(p, H2, _test.specOf(H2));
        const ops = v2.spec.openings || [];
        check('a middle room carries both its doorways, each with the way through', ops.filter((o) => o.kind === 'door').map((o) => o.dir).sort().join() === 'north,south' && v2.building?.id === MAP, JSON.stringify(ops));
        check('a doorway in the window wall takes the window', v2.spec.windowless === true, JSON.stringify(v2.spec.windows));
        const nb = Object.fromEntries((v2.building?.neighbours || []).map((n) => [n.zone, n.spec]));
        check('the rooms either side come with it, placed across a wall from it', Object.keys(nb).length === 2 && nb[H1]?.at?.join() === '0,-4.28' && nb[H3]?.at?.join() === '0,4.28' && nb[H1].face === 0 && nb[H1].floor === 0 && nb[H3].openings?.some((o) => o.to === H2), JSON.stringify(v2.building?.neighbours?.map((n) => [n.zone, n.spec.at, n.spec.face])));
        const nx = Object.fromEntries((v2.building?.neighbours || []).map((n) => [n.zone, n]));
        check('the room next door comes furnished', nx[H1]?.pieces?.some((x) => x.id === PIECE), JSON.stringify(nx[H1]?.pieces?.map((x) => x.id)));
        check('and with whoever is in it', nx[H3]?.people?.some((x) => x.id === NB && x.npc), JSON.stringify(nx[H3]?.people));
        check('a room next door is somebody in the middle one\'s business', _test.nextDoor(H2).sort().join() === [H1, H3].sort().join() && _test.nextDoor(H1).join() === H2);
        {
          // a piece laid out by the rules keeps out of a doorway: every rule-placed piece in a room with one
          const s1 = _test.stageSpec(H1), L1 = roomLayout(s1, await _test.roomPieces(H1, s1));
          check('stageSpec is the room with its doorways', _test.stageSpec(H2).openings?.length === 2 && !_test.specOf(H2).openings);
          const door1 = s1.openings.find((o) => o.to === H2);
          check('nothing in the room next door stands in its doorway', door1?.wall === 'front' && L1.placed.length && L1.placed.every((x) => !(x.v < 1.2 && x.u > door1.a - 0.3 && x.u < door1.b + 0.3)), JSON.stringify({ door1, at: L1.placed.map((x) => [x.u, x.v]) }));
        }
        const L = roomLayout(v2.spec, []), north = ops.find((o) => o.dir === 'north'), mid = (north.a + north.b) / 2;
        const past = north.wall === 'front' ? [mid, -0.3] : north.wall === 'back' ? [mid, v2.spec.d + 0.3] : north.wall === 'left' ? [-v2.spec.w / 2 - 0.3, mid] : [v2.spec.w / 2 + 0.3, mid];
        check('you can walk into a doorway, and past its wall is through it', roomFree(L, ...past) && openingCrossed(L, past)?.dir === 'north', JSON.stringify({ north, past }));
        check('just inside the doorway is in the room and not through it', (() => { const s = openingInside(L, north); return roomFree(L, ...s.at) && !openingCrossed(L, s.at); })());

        world.zones.get(p.current_zone)?.players.delete(p.id);
        p.current_zone = H1; world.zones.get(H1).players.add(p.id);
        let r = await run('room');
        check('room opens the Stage in a building\'s entry', r?.type === 'noop' && _test.viewers.get(H1)?.has(p.id), JSON.stringify(r));
        await new Promise((res) => setTimeout(res, 30));
        const ahead = sent.find((m) => m.type === 'room_ahead'), a2 = ahead?.rooms?.find((x) => x.zone === H2);
        const seen2 = sent.find((m) => m.type === 'room_view' && m.zone === H1)?.building?.neighbours?.find((x) => x.zone === H2);
        sent.length = 0;
        await walkTo('north', H2);
        await new Promise((res) => setTimeout(res, 30));
        const next = sent.find((m) => m.type === 'room_view');
        // what was sent ahead is what the crossing sends, or the client bakes a room nobody asks for (room-stage.js)
        {
          const same = (a, b) => JSON.stringify(a) === JSON.stringify(b), far = (v) => (v || []).find((x) => x.zone === H3), near = (v) => (v || []).find((x) => x.zone === H1);
          check('the next room is sent ahead of the doorway, after the room itself', ahead?.zone === H1 && ahead.rooms.length === 1 && !!a2, JSON.stringify(ahead)?.slice(0, 300));
          check('and is the room the crossing then sends: its spec, and the rooms past it with their pieces and people', !!next && same(a2?.spec, next.spec) && same(far(a2?.neighbours), far(next.building?.neighbours)) && same(near(a2?.neighbours)?.spec, near(next.building?.neighbours)?.spec), JSON.stringify([a2?.spec, next?.spec])?.slice(0, 400));
          check('without the room you are in, which the client has', near(a2?.neighbours) && !near(a2.neighbours).pieces && !near(a2.neighbours).people, JSON.stringify(near(a2?.neighbours))?.slice(0, 200));
          check('and its own pieces are the ones it had as the room next door', !!seen2 && same(seen2.pieces, next?.pieces), JSON.stringify([seen2?.pieces, next?.pieces])?.slice(0, 300));
          check('the crossing sends the rooms past the next one in turn', sent.some((m) => m.type === 'room_ahead' && m.zone === H2 && m.rooms.length === 2), JSON.stringify(sent.map((m) => [m.type, m.zone])));
        }
        check('walking through the doorway moves you into the next room', p.current_zone === H2, p.current_zone);
        check('and the Stage stays open there, standing you in the doorway you came through', _test.viewers.get(H2)?.has(p.id) && !_test.viewers.get(H1)?.has(p.id) && next?.zone === H2 && next.via === H1 && !sent.some((m) => m.type === 'room_close'), JSON.stringify(sent.map((m) => [m.type, m.zone, m.via])));
        shut = true; sent.length = 0;
        await walkTo('north', H3);
        check('a door that won\'t open leaves you where you were', p.current_zone === H2, p.current_zone);
        check('and sends no new room and closes nothing, so the client puts you back', _test.viewers.get(H2)?.has(p.id) && !sent.some((m) => m.type === 'room_view' || m.type === 'room_close'), JSON.stringify(sent.map((m) => m.type)));
        // from the middle room you see into both: a piece moved next door is sent to you
        check('somebody next door to a room sees into it', _test.watchersOf(H1).has(p.id) && _test.watchersOf(H3).has(p.id));
        sent.length = 0;
        emit('furniture.changed', { zoneId: H1, id: PIECE });
        for (let i = 0; i < 40 && !sent.some((m) => m.type === 'room_piece'); i++) await new Promise((res) => setTimeout(res, 25));
        check('a piece changed next door is sent to you, for that room', sent.some((m) => m.type === 'room_piece' && m.zone === H1 && m.piece?.id === PIECE), JSON.stringify(sent.map((m) => [m.type, m.zone])));
        // a lock on a doorway (docs/proposals/room-hololock.md): the room's view says how it stands for you, a hand
        // on it is sent at once, and a lock that changed with no event is caught by the sweep
        {
          const DOOR = '__roomstage_test_bdoor__', staff = ['admin', 'dev'].includes(p.role);
          const locksSent = async () => { for (let i = 0; i < 40 && !sent.some((m) => m.type === 'room_locks'); i++) await new Promise((res) => setTimeout(res, 25)); return sent.find((m) => m.type === 'room_locks'); };
          setDoorCache(DOOR, { id: DOOR, zone_id: H2, exit_dir: 'south', target_zone: H1, name: 'test door', hp: 10, max_hp: 10, is_open: 0, lock_state: 'locked', tags: { 'lock:hololock': { canHack: true, difficulty: 5 } } });
          try {
            const lv = await _test.viewPayload(p, H2, _test.specOf(H2)), k = lv.locks?.find((x) => x.to === H1);
            check('a room view says which doorways are locked, and how each stands for you', lv.locks?.length === 1 && k?.dir === 'south' && k.door === DOOR && k.locked === true && k.open === false && k.lock === true && k.pass === false && k.hack === true && k.yours === staff, JSON.stringify(lv.locks));
            check('a room sent ahead goes without its locks', !(await _test.viewPayload(p, H2, _test.specOf(H2), { stamp: false, locks: false })).locks);
            sent.length = 0;
            world.doors.get(DOOR).lock_state = 'unlocked';
            emit('door.sfx', { door: world.doors.get(DOOR), zoneId: H2, actorId: p.id, cue: 'unlock' });
            const gave = await locksSent();
            check('a lock worked by hand is sent to whoever has the room open', gave?.zone === H2 && gave.locks?.[0]?.locked === false && gave.locks[0].pass === true, JSON.stringify(gave));
            // a door is shut until somebody opens it, and the Stage is told when one does
            check('an unlocked door is still shut', gave?.locks?.[0]?.open === false, JSON.stringify(gave));
            sent.length = 0;
            world.doors.get(DOOR).is_open = 1;
            emit('door.sfx', { door: world.doors.get(DOOR), zoneId: H2, actorId: p.id, cue: 'open' });
            const opened = await locksSent();
            check('a door somebody opened is sent as standing open', opened?.locks?.[0]?.open === true, JSON.stringify(opened));
            world.doors.get(DOOR).is_open = 0;
            {
              // a door with no lock on it is a door all the same; an archway with no door row isn't in the list
              const tags = world.doors.get(DOOR).tags;
              world.doors.get(DOOR).tags = {}; world.doors.get(DOOR).lock_state = 'unlocked';
              const plain = (await _test.locksOf(p, H2, _test.stageSpec(H2)))[0];
              check('a door with no lock is sent too, shut, with nothing to unlock', plain?.lock === false && plain.open === false && plain.locked === false && plain.pass === true, JSON.stringify(plain));
              world.doors.get(DOOR).tags = tags;
            }
            sent.length = 0;
            world.doors.get(DOOR).lock_state = 'locked';
            _test.lockSweep();
            const took = await locksSent();
            check('and one that changed with no hand on it is caught by the sweep', took?.locks?.[0]?.locked === true && took.locks[0].pass === false, JSON.stringify(took));
            sent.length = 0;
            _test.lockSweep();
            await new Promise((res) => setTimeout(res, 80));
            check('which sends nothing when no lock has changed', !sent.some((m) => m.type === 'room_locks'), JSON.stringify(sent.map((m) => m.type)));
          } finally { deleteDoorCache(DOOR); }
        }
      } finally {
        shut = false;
        if (made) await deleteFurniture(made.id ?? PIECE).catch(() => {});
        world.npcs.delete(NB);
        setBroadcast(was);
        for (const id of [H1, H2, H3]) { world.zones.get(id)?.players.delete(p.id); _test.viewers.delete(id); world.zones.delete(id); }
        world.zones.delete(T); world.maps.delete(MAP); _test.clearBuildings();
        p.current_zone = savedZone2; world.zones.get(savedZone2)?.players.add(p.id);
      }
    }

    // a flight of stairs between two floors (docs/proposals/building-stage.md "Stairs"): both rooms get it, each sees
    // the other through the well, and going up it is the ordinary `up`, with the Stage kept open
    {
      const MAP = '__roomstage_test_smap__', T = '__roomstage_test_stile__', S1 = '__roomstage_test_s1__', S2 = '__roomstage_test_s2__';
      const mks = (id, map, flags, exits) => world.zones.set(id, { id, name: id, description: `Room ${id}.`, map_id: map, flags, exits, players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set() });
      mks(T, 'map_world', {}, { north: S1 });
      mks(S1, MAP, { room: { w: 6, d: 8, h: 3, face: 0, studio: false, balcony: false, stair: { at: [-2, 7.4], climb: 'front', w: 1 } } }, { south: T, up: S2 });
      mks(S2, MAP, { room: { w: 6, d: 8, h: 2.6, studio: false, balcony: false, doors: { down: [-2, 2.4] } } }, { down: S1 });
      world.maps.set(MAP, { id: MAP, name: 'Test Stairs', parent_zone_id: T, entry_zone_id: S1 });
      const sent = [], was = getBroadcast(), saved = p.current_zone;
      setBroadcast((z, msg, ex, to) => { if (to === p.id) sent.push(msg); return was?.(z, msg, ex, to); });
      try {
        _test.clearBuildings();
        const bld = _test.buildingOfRoom(S1);
        check('two floors joined by a flight are one walk, planned clean', bld?.b.walk.length === 2 && !bld.plan.problems.length && bld.plan.doors.some((d) => d.flight), JSON.stringify(bld?.plan.problems));
        const v1 = await _test.viewPayload(p, S1, _test.specOf(S1)), up = (v1.spec.openings || []).find((o) => o.kind === 'stair');
        check('the room below carries the flight up, standing on its floor', up?.dir === 'up' && up.to === S2 && up.wall === 'ceiling' && up.y0 === 0, JSON.stringify(up));
        const above = (v1.building?.neighbours || []).find((n) => n.zone === S2);
        check('and the room above comes with it, on its ceiling, its well cut', above?.spec.floor === 3 && above.spec.openings?.some((o) => o.kind === 'stair' && o.wall === 'floor' && o.dir === 'down' && o.y0 === -3), JSON.stringify(above?.spec));
        check('the floor above is somebody below\'s business, and back', _test.nextDoor(S1).includes(S2) && _test.nextDoor(S2).includes(S1));
        const L = roomLayout(v1.spec, []), at = (s) => [up.foot[0] + up.climb[0] * s, up.foot[1] + up.climb[1] * s];
        check('the flight climbs: its ground rises step by step to the floor above', L.groundAt(...at(0.1)) < 0.2 && Math.abs(L.groundAt(...at(up.len)) - 3) < 1e-6 && L.baseAt(...at(up.len / 2)) > 1, JSON.stringify([L.groundAt(...at(0.1)), L.groundAt(...at(up.len)), L.baseAt(...at(up.len / 2))]));
        // a body's width past the flight's edge is into the rail; further out is the floor beside it, free on the open side
        const off = up.w / 2 + 0.15;
        check('you can walk onto it from its foot but not step off its side', roomFree(L, ...at(0.3)) && !roomFree(L, at(2)[0] + off, at(2)[1]) && !roomFree(L, at(2)[0] - off, at(2)[1]), JSON.stringify(up));
        check('and past halfway up it you have gone up', openingCrossed(L, at(up.cross + 0.1))?.dir === 'up' && !openingCrossed(L, at(up.cross - 0.1)));
        world.zones.get(p.current_zone)?.players.delete(p.id);
        p.current_zone = S1; world.zones.get(S1).players.add(p.id);
        await run('room');
        sent.length = 0;
        await run('up');
        for (let i = 0; i < 80 && p.current_zone !== S2; i++) await new Promise((res) => setTimeout(res, 50));
        await new Promise((res) => setTimeout(res, 30));
        const next = sent.find((m) => m.type === 'room_view');
        check('going up the stairs moves you up, the Stage open on the floor above, come up by the flight', p.current_zone === S2 && next?.zone === S2 && next.via === S1 && !sent.some((m) => m.type === 'room_close'), JSON.stringify(sent.map((m) => [m.type, m.zone, m.via])));
        const Lh = roomLayout(next.spec, []), dn = next.spec.openings.find((o) => o.kind === 'stair'), arrive = openingInside(Lh, dn);
        check('typed, you arrive off its top step, facing on', roomFree(Lh, ...arrive.at) && !openingCrossed(Lh, arrive.at) && Lh.groundAt(...arrive.at) === 0, JSON.stringify(arrive));
      } finally {
        setBroadcast(was);
        for (const id of [S1, S2]) { world.zones.get(id)?.players.delete(p.id); _test.viewers.delete(id); world.zones.delete(id); }
        world.zones.delete(T); world.maps.delete(MAP); _test.clearBuildings();
        p.current_zone = saved; world.zones.get(saved)?.players.add(p.id);
      }
    }

    // a tower's lift (Solenne Residences, from content): every floor is on the walk, the car is one room
    // whose doors open on the floor it's parked at, and riding it is the elevator's own `floor <n>`
    if (world.zones.get('zone_solenne_elevator')?.flags?.room) {
      const LOBBY = 'zone_solenne_lobby', CAR = 'zone_solenne_elevator', F30 = 'zone_solenne_residences', A30 = 'zone_solenne_apt_a';
      const sent = [], was = getBroadcast(), saved = p.current_zone;
      setBroadcast((z, msg, ex, to) => { if (to === p.id) sent.push(msg); return was?.(z, msg, ex, to); });
      const wait = async (ok, ms = 8000) => { for (let i = 0; i < ms / 50 && !ok(); i++) await new Promise((res) => setTimeout(res, 50)); };
      try {
        _test.clearBuildings();
        const bld = _test.buildingOfRoom(LOBBY);
        check('Solenne is one walk, lobby to sky pad, with no problems', bld && !bld.plan.problems.length && [CAR, F30, A30, 'zone_solenne_penthouse', 'zone_solenne_helipad'].every((z) => bld.b.walk.includes(z)), JSON.stringify(bld?.plan.problems));
        const stops = bld?.plan.lifts?.[CAR]?.stops || [];
        check('the lift stops are stacked bottom to top, each above the last', stops.length === 8 && stops.every((s, i) => !i || s.y > stops[i - 1].y), JSON.stringify(stops.map((s) => [s.n, s.y])));
        world.zones.get(p.current_zone)?.players.delete(p.id);
        p.current_zone = LOBBY; world.zones.get(LOBBY).players.add(p.id); p._elevatorAt = null;
        await run('room');
        sent.length = 0;
        await run('in');
        await wait(() => sent.some((m) => m.type === 'room_view' && m.zone === CAR));
        const car = sent.find((m) => m.type === 'room_view' && m.zone === CAR);
        check('walking into the car keeps the Stage open, with its panel of real floors', car?.via === LOBBY && car.lift?.floors.map((f) => f.n).join() === '1,12,18,30,34,40,41,44,45' && car.lift.at === 1, JSON.stringify(car?.lift));
        check('parked at the lobby, the car is open on the lobby', car?.spec.openings?.some((o) => o.kind === 'door' && o.to === LOBBY && o.dir === 'out') && car.building?.neighbours?.map((n) => n.zone).join() === LOBBY, JSON.stringify(car?.spec.openings));
        sent.length = 0;
        await run('floor 30');
        await wait(() => sent.some((m) => m.type === 'room_view' && m.ride));
        const up = sent.find((m) => m.type === 'room_view' && m.ride);
        check('a ride opens the car\'s doors on that floor, the landing drawn level with it', up?.zone === CAR && up.lift?.at === 30 && up.spec.openings.some((o) => o.kind === 'door' && o.to === F30 && o.dir === 'out') && up.building?.neighbours?.[0]?.zone === F30 && up.building.neighbours[0].spec.floor === 0, JSON.stringify(up?.spec?.openings));
        sent.length = 0;
        await run('out');
        await wait(() => p.current_zone === F30 && sent.some((m) => m.type === 'room_view'));
        const hall = sent.find((m) => m.type === 'room_view' && m.zone === F30);
        check('stepping out walks onto the thirtieth floor, still in the Stage', p.current_zone === F30 && hall?.via === CAR && hall.building?.neighbours?.some((n) => n.zone === A30) && hall.building.neighbours.some((n) => n.zone === CAR && n.spec.floor === 0), JSON.stringify(hall?.building?.neighbours?.map((n) => [n.zone, n.spec.floor])));

        // the street door (building-stage.md step 5): out onto the pavement in GLASS on foot, and back in
        const FACADE = 'zone_district_914_908', STREET = 'zone_district_914_909';
        world.zones.get(p.current_zone)?.players.delete(p.id);
        p.current_zone = LOBBY; world.zones.get(LOBBY).players.add(p.id); p._elevatorAt = null;
        await run('room');
        await wait(() => sent.some((m) => m.type === 'room_view' && m.zone === LOBBY));
        const lobby = [...sent].reverse().find((m) => m.type === 'room_view' && m.zone === LOBBY);
        check("the lobby's street door is a doorway onto its facade", lobby?.spec.openings?.some((o) => o.kind === 'front' && o.dir === 'south' && o.to === FACADE), JSON.stringify(lobby?.spec?.openings));
        sent.length = 0;
        await run('south');
        await wait(() => sent.some((m) => m.type === 'freelook_open'));
        const street = sent.find((m) => m.type === 'freelook_open');
        check('out of the street door the room holds for the street, not the text', sent.some((m) => m.type === 'room_close' && m.street), JSON.stringify(sent.map((m) => m.type)));
        check('the street opens on foot in front of the door, facing away from it', p.current_zone === STREET && street?.stand?.foot && street.gx === 914 && street.gy === 909 && street.stand.yaw === 180 && street.stand.y < 0, JSON.stringify([p.current_zone, street?.stand]));
        check("the street comes with the building's door: its facade's tile, the edge it's on and its width", street?.doors?.some((d) => d.gx === 914 && d.gy === 908 && d.edge === 'south' && d.w > 1 && d.slide), JSON.stringify(street?.doors));
        sent.length = 0;
        await run('north');
        await wait(() => sent.some((m) => m.type === 'room_view' && m.zone === LOBBY));
        check('walking in tells the client a Stage is coming, so it keeps the street for the walk back out', sent.some((m) => m.type === 'freelook_close' && m.indoors), JSON.stringify(sent.filter((m) => m.type === 'freelook_close')));
        const back = sent.find((m) => m.type === 'room_view' && m.zone === LOBBY);
        check('walking back in closes the street and opens the lobby stood in its street door', back?.via === FACADE && sent.some((m) => m.type === 'freelook_close') && !p._onFoot, JSON.stringify(sent.map((m) => m.type)));
      } finally {
        setBroadcast(was);
        for (const id of [LOBBY, CAR, F30, 'zone_district_914_909']) { world.zones.get(id)?.players.delete(p.id); _test.viewers.delete(id); }
        p._onFoot = false;
        p._elevatorAt = null; p._elevator = null;
        p.current_zone = saved; world.zones.get(saved)?.players.add(p.id);
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
  // THE EN-SUITE'S PRIVACY DOOR is a lock in the Stage, worked from whichever side you're on (Solenne 30-B)
  {
    const FLAT = 'zone_solenne_apt_b', EN = 'zone_solenne_apt_b_bath', spec = world.zones.get(FLAT) && _test.stageSpec(FLAT);
    if (spec?.annex) {
      // the bolt as the content file has it, open: a fresh database had it shot, and from inside a shot bolt you
      // slide it back before you go, so `pass` is false
      const was = p.current_zone, bolt = doorOnLink(EN, 'out', FLAT), shot = bolt?.lock_state;
      if (bolt) bolt.lock_state = 'unlocked';
      try {
        p.current_zone = FLAT;
        const out = (await _test.locksOf(p, FLAT, spec)).find((k) => k.annex);
        check('a flat\'s en-suite door is sent as a lock, worked `in` from the flat', out?.to === EN && out.dir === 'in' && out.lock === true && out.inside === false, JSON.stringify(out));
        p.current_zone = EN;
        const inn = (await _test.locksOf(p, FLAT, spec)).find((k) => k.annex);
        check('and `out` from inside the en-suite', inn?.to === FLAT && inn.dir === 'out' && inn.inside === true && inn.pass === true, JSON.stringify(inn));
        check('a flat with an en-suite carries its locks with no building plan needed', !!(await _test.viewPayload(p, FLAT, spec)).locks?.some((k) => k.annex));
      } finally { p.current_zone = was; if (bolt) bolt.lock_state = shot; }
    }
  }
}
