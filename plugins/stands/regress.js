// stands plugin regression — run by tests/regress.js, never in production.
//
// The view can't be checked headless. What can be is the chart's data (every section the two
// venues sell has a seat to put the eye on), the verb's refusals, and that getting up leaves no
// row behind in the seated map.
import { getZone, getZoneFurniture } from '../../server/engine/world.js';
import { runMoveGates } from '../../server/engine/movement-gates.js';
import { getBroadcast, setBroadcast } from '../../server/engine/messaging.js';
import { liveSportsChannel, lastSportsSlot, _test as bc } from '../broadcast/index.js';
import { standsOf, findSection, seatsOf, freeSeat, heldAs, concessionGroup, CONCESSION_GROUPS, _test } from './index.js';
import { getItem } from '../../server/engine/items-cache.js';
import { emit } from '../../server/engine/events.js';
import { query } from '../../server/models/db.js';
import { world } from '../../server/engine/world.js';
import { gatherHookSync } from '../../server/engine/plugins.js';
import { furnitureActs } from '../../server/engine/furnitureActions.js';
import { _test as tk, TICKET_ITEM } from './tickets.js';
import { _test as champ } from './champions.js';
import { _test as crew } from './crew.js';
import { CREW } from '../../client/shared/stadium.js';

export default async function regress({ run, check, getPlayer }) {
  // a collectable lighter is only a look for the hands' zippo (stands-hands.js lighterStyle): it needs a case and a trim
  for (const id of ['item_zippo_chrome', 'item_zippo_black_gold']) {
    const L = getItem(id)?.tags?.lighter;
    check(`stands: ${id} is a lighter with a case and trim`, !!L && /^#[0-9a-f]{6}$/i.test(L.case) && /^#[0-9a-f]{6}$/i.test(L.trim), JSON.stringify(L));
  }
  // the 30-B cigarette box hands out every smoke it holds for nothing, into your hands
  const smokes30b = getZoneFurniture('zone_solenne_apt_b').find((f) => f.id === 'furn_solenne_apt_b_smokes');
  const menu = smokes30b?.flags?.vend_menu || [];
  check('stands: the 30-B cigarette box is a free vend menu of smokes', menu.length >= 3 && menu.every((m) => m.price === 0 && heldAs(getItem(m.item) || {}) === 'smoke'), JSON.stringify(menu));
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
  // the concessions: both venues sell food, drinks, cigarettes and cigars from the cupholder, every
  // item exists and is priced, and every smoke is one the seat's hands can light
  for (const id of ['zone_hughson_stands', 'zone_slush_stands']) {
    const menu = (standsOf(getZone(id))?.menu || []).map((m) => ({ ...m, it: getItem(m.item) }));
    check(`stands: ${id} prices every concession`, menu.length >= 8 && menu.every((m) => m.it && m.price > 0), JSON.stringify(menu.filter((m) => !m.it || !(m.price > 0)).map((m) => m.item)));
    const groups = new Set(menu.filter((m) => m.it).map((m) => concessionGroup(m.it, m.group)));
    check(`stands: ${id} sells all four kinds`, CONCESSION_GROUPS.every((g) => groups.has(g)), [...groups].join());
    const smokes = menu.filter((m) => m.it && ['cigarettes', 'cigars'].includes(concessionGroup(m.it, m.group)));
    check(`stands: ${id} smokes are all held as a smoke`, smokes.every((m) => heldAs(m.it) === 'smoke'), smokes.filter((m) => heldAs(m.it) !== 'smoke').map((m) => m.item).join());
  }
  r = await run('stands order');
  check('stands: ordering when not sat refuses', r?.type === 'error' && /aren't in a seat/i.test(r.message || ''), r?.message);

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
  // the seat and the Tablet TV share a tuner: the tablet going off hands it back, and getting up doesn't
  _test.seated.set(me.id, { zoneId: 'zone_slush_stands', section: 'glass', seat: 0, channelId: 'x', tuned: 'x' });
  bc.tabletTuners.set(me.id, 'x');
  emit('tablet_tv.unwatch', { playerId: me.id });
  check('stands: shutting the tablet TV leaves the seat tuned', bc.tabletTuners.get(me.id) === 'x', bc.tabletTuners.get(me.id));
  _test.leave(me, true);
  check('stands: getting up drops the tuner', !bc.tabletTuners.has(me.id));

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

  // With nothing live, the box's screen plays the last ballgame again: a rerun on the player's own
  // channel, ticked to them alone, that carries the game's pictures and stops when they get up.
  const live = liveSportsChannel('baseball') || liveSportsChannel('hockey');
  const pick = _test.suiteChannels(me);
  if (live) check('stands: a live game beats the rerun', !pick.rerun && (pick.channelId || pick.tv) === live, JSON.stringify(pick));
  else if (lastSportsSlot('baseball') != null) {
    check('stands: nothing live puts the last ballgame on the box screen', pick.rerun && pick.tv === 'rerun:baseball' && !pick.channelId, JSON.stringify(pick));
    const r0 = bc._reruns.get(me.id);
    check('stands: the rerun is a past game', !!r0 && r0.endsMs > r0.startMs, JSON.stringify(r0 && { slot: r0.slot }));
    if (r0) {
      const sent = [], orig = getBroadcast();
      setBroadcast((zoneId, payload, exclude, toPlayer) => { if (toPlayer === me.id) sent.push(payload); });
      try { for (let t = 0; t < 60; t++) bc._rerunPass(r0.startMs + t * 10e3); } finally { setBroadcast(orig); }
      check("stands: the rerun sends the game's pictures to its viewer", sent.some((m) => m?.type === 'tv_overlay' && m.channelId === 'rerun:baseball' && m.overlay?.overlayType === 'gameday'), String(sent.length));
      sent.length = 0;
      setBroadcast((zoneId, payload, exclude, toPlayer) => { if (toPlayer === me.id) sent.push(payload); });
      try { bc._rerunPass(r0.endsMs + 1); } finally { setBroadcast(orig); }
      check('stands: a finished rerun holds on its last picture', sent.length === 0, String(sent.length));
    }
    _test.seated.set(me.id, { zoneId: 'zone_hughson_platinum_box', section: 'platinum', seat: 0, channelId: null, chair: true, suite: true });
    _test.leave(me, true);
    check('stands: getting up stops the rerun', !bc._reruns.has(me.id));
  }
  await stadiumKit({ run, check, getPlayer });
}

// THE STADIUM KIT (tickets.js, champions.js, crew.js): the Gardens' sellers, a ticket bought and sat on, the champions
// board's state, and the ice crew's routine through a staged break
async function stadiumKit({ run, check, getPlayer }) {
  const me = getPlayer(), home = me.current_zone, C = 'zone_slush_concourse';
  const sellers = _test.sellersIn(C);
  check('stands: the Concourse sells tickets at three seat doors and a window', sellers.filter((x) => x.door).length === 3 && sellers.some((x) => !x.door), String(sellers.length));
  const doors = sellers.filter((x) => x.door).flatMap((x) => x.sections.map((c) => c.id)).sort();
  check('stands: the seat doors between them cover every section once', JSON.stringify(doors) === JSON.stringify(standsOf(getZone('zone_slush_stands')).sections.map((c) => c.id).sort()), doors.join(','));
  check('stands: a seat door offers buyticket on its card', furnitureActs(getZoneFurniture(C).find((f) => f.id === 'furn_slush_door_ends') || { flags: {}, name: '' }).some((a) => a.verb === 'buyticket'));
  check('stands: a pack machine offers its league on its card', furnitureActs(getZoneFurniture(C).find((f) => f.id === 'furn_slush_puck_cards') || { flags: {}, name: '' }).some((a) => a.cmd === 'buypack puck'));
  check('stands: whenOf reads a game plainly', _test.whenOf({ now: true }) === 'on now' && _test.whenOf({ hour: 20, days: 1 }) === 'tomorrow at 20:00' && _test.whenOf({ hour: 15, days: 0 }) === 'today at 15:00');
  let r = await run('buyticket');
  check('stands: buyticket refuses where nothing is sold', r?.type === 'error', r?.message);
  me.current_zone = C;
  try {
    r = await run('buyticket');
    check('stands: buyticket at the Concourse answers (the picker, or no games)', r?.type === 'noop' || r?.type === 'output' || /no games/i.test(r?.message || ''), JSON.stringify(r)?.slice(0, 120));
    const { sportsGamesAhead } = await import('../broadcast/index.js');
    const ahead = sportsGamesAhead('hockey', 4), g = ahead[1] || ahead[0];
    if (g) {
      // the spend is a guarded UPDATE on the row (adjustCredits), so the row is funded, not only the live player
      const credits = me.credits;
      me.credits = Math.max(me.credits | 0, 500);
      await query('UPDATE players SET credits=$2 WHERE id=$1', [me.id, me.credits]);
      r = await run(`buyticket ends door home@${g.slot}`);
      const t = [...(tk.held.get(me.id)?.values() || [])].find((x) => x.slot === g.slot && x.section === 'home');
      check('stands: buyticket sells a seat at that door for that game', r?.type === 'output' && !!t, r?.message);
      if (t) {
        const { rows } = await query('SELECT custom_data FROM player_inventory WHERE id=$1 AND player_id=$2 AND item_id=$3', [t.id, me.id, TICKET_ITEM]);
        check('stands: the ticket is an item carrying its game and seat', rows[0]?.custom_data?.seat_ticket?.slot === g.slot && rows[0].custom_data.seat_ticket.section === 'home');
        r = await run(`buyticket ends door home@${g.slot}`);
        const t2 = [...tk.held.get(me.id).values()].find((x) => x.id !== t.id && x.slot === g.slot && x.section === 'home');
        check('stands: the next ticket in a section is the next seat, never the same one', !!t2 && t2.i !== t.i, JSON.stringify([t.i, t2?.i]));
        check('stands: the seat door card lists the ticket for its sections', _test.ticketsView(me.id).some((x) => x.id === t.id && x.cmd === `stands ticket ${t.id}`));
        const viewer = Object.assign({}, ...gatherHookSync('room.viewer', C, me));
        check('stands: room.viewer carries your tickets in a room that sells them', Array.isArray(viewer.tickets) && viewer.tickets.length >= 2);
        r = await run('stands ticket');
        check('stands: stands ticket lists what you hold', r?.type === 'output' && /Your tickets/.test(r.message || ''), r?.message);
        if (!g.now) {
          r = await run(`stands ticket ${t.id}`);
          check('stands: a ticket for a later game does not seat you now', r?.type === 'error' && !_test.seated.has(me.id), r?.message);
        }
        await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [me.id, TICKET_ITEM]).catch(() => {});
        tk.held.delete(me.id); tk.sold.clear();
      }
      me.credits = credits;
      await query('UPDATE players SET credits=$2 WHERE id=$1', [me.id, credits | 0]);
    }
  } finally { me.current_zone = home; }

  // the champions board: dark with nobody crowned, the club once there is one
  const had = champ.last.get('hockey');
  champ.last.delete('hockey');
  let st = champ.championPieces('zone_slush_cup');
  check('stands: the champions board is dark with no champion', !!st?.furn_slush_champions && st.furn_slush_champions.champ === null, JSON.stringify(st));
  champ.last.set('hockey', { name: 'Coldwater Highlanders', season: 3 });
  st = champ.championPieces('zone_slush_cup');
  check('stands: the champions board shows the last champion', st?.furn_slush_champions?.champ?.name === 'Coldwater Highlanders');
  if (had) champ.last.set('hockey', had); else champ.last.delete('hockey');

  // the ice crew through a staged break: off the stool, out on the ice, back
  const ken = world.npcs.get('npc_slush_raven');
  check('stands: Ken Raven is the Gardens ice crew, kept in the bay', ken?.flags?.ice_crew?.bay === 'zone_slush_bay' && ken.flags.ice_crew.machine === 'furn_slush_resurfacer');
  if (!ken) return;
  const was = ken.zone_id;
  const put = (z) => { world.zones.get(ken.zone_id)?.npcs.delete(ken.id); ken.zone_id = z; world.zones.get(z)?.npcs.add(ken.id); };
  if (ken.zone_id !== 'zone_slush_bay') put('zone_slush_bay');
  crew.reset();
  const brk = (left) => () => ({ inBreak: left > 0, msLeft: left, slot: 1 });
  let t = 1e12;
  crew.crewTick(t, brk(300000));
  check('stands: at a break Ken boards the machine', crew.state.get(ken.id)?.phase === 'board');
  t += CREW.walk + CREW.climb + 10; crew.crewTick(t, brk(290000));
  check('stands: then drives it out', crew.state.get(ken.id)?.phase === 'leave');
  t += CREW.drive + 10; crew.crewTick(t, brk(280000));
  check('stands: and is out on the ice, the bay empty', crew.state.get(ken.id)?.phase === 'away' && ken.zone_id === 'zone_slush_rinkside' && crew.crewVehicles('zone_slush_bay')?.machine?.phase === 'away');
  check('stands: the bay draws no Ken while he is out', crew.crewStage(ken, 'zone_slush_bay', [])?.hide === true);
  t += 1000; crew.crewTick(t, brk(CREW.lead - 1000));
  check('stands: near the end of the break he drives back in', crew.state.get(ken.id)?.phase === 'return' && ken.zone_id === 'zone_slush_bay');
  t += CREW.drive + 10; crew.crewTick(t, brk(0));
  t += CREW.alight + CREW.back + 10; crew.crewTick(t, brk(0));
  check('stands: and goes back to his post', crew.state.get(ken.id)?.phase === 'post');
  crew.crewTick(t + 10, () => ({ inBreak: true, msLeft: CREW.least - 1 }));
  check('stands: a break too short to do the ice in, he stays put', crew.state.get(ken.id)?.phase === 'post');
  crew.reset();
  if (was && was !== ken.zone_id) put(was);
}
