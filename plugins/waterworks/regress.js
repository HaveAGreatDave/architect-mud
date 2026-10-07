// Waterworks regression: the engine's supply law (server/engine/water.js) driven through the real
// verbs, and the plant's state machine. Supply is memory only, so every check here is undone by
// resetWaterSupply at the end.
//
// What this guards:
//  - a dry mains tap refuses `drink` and `wash` and takes nothing, and the readers really do call
//    the law (the split-reader bug: one verb converted, one still reading the flag alone)
//  - low still works, with a line; foul water won't wash you
//  - off-network water never fails: a transient room has no region, and `water_local` opts out
//  - the tower clock starts when the pumps stop and survives a fault turning into a power cut, and
//    stations in series share it: the first one to stop starts it
//  - the market: the shelf and the till charge the same marked-up price, mains water is never marked
//    up, and stored water sells out partway through a dry spell and stays out until a delivery
//  - the water_supply condition, which is what posts the water run on the Halcyon Logistics board
//  - `gauges` needs a board; `waterworks` is staff only
import { world, getZone, getZoneFurniture, getNpc } from '../../server/engine/world.js';
import { vendorPriceRule, getVendorStock } from '../../server/engine/vendor.js';
import { evalCondition } from '../../server/engine/flags.js';
import { on } from '../../server/engine/events.js';
import { query } from '../../server/models/db.js';
import {
  waterNetworkOf, getWaterSupply, setWaterSupply, drawWater, resetWaterSupply, isDrinkingSource, isShower, isWaterSource,
} from '../../server/engine/water.js';
import { _internals, TOWER_MINUTES, FLUSH_MINUTES, STORED_MULT, RESTOCK_MINUTES } from './index.js';

const REGION = 'region_coldwater';
const MIN = 60_000;

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const saved = { zone: p.current_zone, role: p.role, thirst: p.thirst };
  const { stepStation, supplyOf, enter, scan, stations, spells, stationsOf, gaugeReport, selloutMinutes, pause } = _internals;

  // The plant's own tick may already have run (the harness boots the scheduler), so start clean.
  pause(true);
  resetWaterSupply();
  spells.clear();
  try {
    // ── the substrate ──────────────────────────────────────────────────────
    check('an unknown region is refused', (() => { try { setWaterSupply('region_nowhere', {}); return false; } catch { return true; } })());
    check('a bad state is refused', (() => { try { setWaterSupply(REGION, { state: 'trickle' }); return false; } catch { return true; } })());
    check('a zone with no region is off-network', waterNetworkOf('zone_waterworks_regress_nowhere') === null);
    check('every network starts flowing', getWaterSupply('zone_district_919_902').state === 'flowing');

    let seen = null;
    on('water.supply.changed', (e) => { if (e.network === REGION) seen = e; });
    setWaterSupply(REGION, { state: 'low' });
    check('a change emits water.supply.changed', seen?.from?.state === 'flowing' && seen?.to?.state === 'low', JSON.stringify(seen));
    seen = null;
    setWaterSupply(REGION, { state: 'low' });
    check('a non-change emits nothing', seen === null);

    // ── the law ────────────────────────────────────────────────────────────
    setWaterSupply(REGION, { state: 'dry' });
    check('dry refuses with a line', drawWater(null, 'zone_district_919_902').ok === false);
    check('water_local always runs', drawWater({ flags: { water_local: true } }, 'zone_district_919_902').ok === true);
    setWaterSupply(REGION, { state: 'flowing', quality: 'foul' });
    check('foul water still fills', drawWater(null, 'zone_district_919_902').ok === true);
    check("foul water won't wash you", drawWater(null, 'zone_district_919_902', { use: 'wash' }).ok === false);
    check('a shower is a wash source but not a tap', isWaterSource({ object_type: 'shower' }) && !isDrinkingSource({ object_type: 'shower' }) && isShower({ name: 'rain shower' }));

    // ── through the verbs ──────────────────────────────────────────────────
    // A mains tap in Coldwater that isn't a toilet (bodily has its own say about those).
    const tap = [...world.furniture.values()].find(f => isDrinkingSource(f) && !/toilet/i.test(f.name || '')
      && f.object_type !== 'toilet' && waterNetworkOf(f.zone_id) === REGION);
    check('Coldwater has a mains tap', !!tap);
    if (tap) {
      p.current_zone = tap.zone_id;
      setWaterSupply(REGION, { state: 'dry' });
      p.thirst = 10;
      let r = await run(`drink ${tap.name}`);
      check('drink at a dry tap refuses', r?.type === 'error' && /tap|pipe|nothing/i.test(r?.message || ''), JSON.stringify(r));
      check('...and slakes nothing', getPlayer().thirst === 10, String(getPlayer().thirst));
      r = await run('wash hands');
      check('wash hands at a dry tap refuses', r?.type === 'error', JSON.stringify(r));

      setWaterSupply(REGION, { state: 'low' });
      r = await run(`drink ${tap.name}`);
      check('drink at a low tap works, and says so', r?.type === 'use' && /thin and stuttering/.test(r?.message || ''), JSON.stringify(r));

      setWaterSupply(REGION, { state: 'flowing', quality: 'foul' });
      r = await run('wash hands');
      check('wash hands in foul water refuses', r?.type === 'error' && /dirtier/.test(r?.message || ''), JSON.stringify(r));
    }

    // ── the plant ──────────────────────────────────────────────────────────
    // ── the stations ───────────────────────────────────────────────────────
    // Two stations in series whose pump rooms have no power at all: the first minute stops them.
    const t0 = Date.now();
    const NOWHERE = 'zone_waterworks_regress_nowhere';
    const mk = (id) => ({ id, region: REGION, zoneId: NOWHERE, tileId: null, name: id, intakeZoneId: null, weatherZoneId: NOWHERE, state: 'running', since: t0, until: null, stopped: null });
    const a = mk('Station A'), b = mk('Station B');
    stepStation(a, false, t0, () => 1);
    check('no power stops a station', a.state === 'unpowered', a.state);
    check('one station stopped puts the region on the tower', supplyOf([a, b], t0).state === 'low');
    enter(a, 'fault', 40, t0 + 10 * MIN);
    check('a fault keeps the tower clock', a.stopped === t0, `${a.stopped} vs ${t0}`);
    enter(b, 'fault', 40, t0 + 60 * MIN);
    const late = t0 + (TOWER_MINUTES + 1) * MIN;
    check('the tower clock is the first station to stop', supplyOf([a, b], late).state === 'dry');
    check('gauges say the city is dry, naming each station', /dry/.test(gaugeReport([a, b], late)) && /Station A:/.test(gaugeReport([a, b], late)) && /Station B:/.test(gaugeReport([a, b], late)));
    enter(a, 'running', null, t0); enter(b, 'turbid', FLUSH_MINUTES, t0);
    check('a turbid station runs the region cloudy', supplyOf([a, b], t0).quality === 'cloudy' && supplyOf([a, b], t0).state === 'flowing');

    // ── the market ─────────────────────────────────────────────────────────
    resetWaterSupply(); spells.clear();
    const stored = { id: 'item_water_bottle', tags: { drinking_water: 'stored' } };
    const mains = { id: 'item_mains_water', tags: { drinking_water: 'mains' } };
    const seller = { id: 'npc_waterworks_regress_seller', name: 'Seller', work_zone_id: 'zone_district_919_902', flags: {} };
    const rule = (npc, item) => vendorPriceRule(npc, item, item.id);
    check('flowing water sells at list', rule(seller, stored).mult === 1 && !rule(seller, stored).soldOut);
    setWaterSupply(REGION, { state: 'low' });
    check('thin taps mark stored water up', rule(seller, stored).mult === STORED_MULT.low, JSON.stringify(rule(seller, stored)));
    check('a vendor flagged holds_water_price holds it', rule({ ...seller, flags: { holds_water_price: true } }, stored).mult === 1);
    check('mains water is never marked up', rule(seller, mains).mult === 1);
    check('water with no tag is left alone', rule(seller, { id: 'x', tags: {} }).mult === 1);
    // The shelf charges what the rule says. Sef at the Arcade kiosk sells nothing but bottled water.
    const sef = getNpc('npc_halcyon_kiosk');
    check('the kiosk vendor is loaded', !!sef);
    if (sef) {
      const list = (sef.vendor_inventory || []).find(e => e.item_id === 'item_water_bottle')?.price;
      const shelf = (await getVendorStock(sef, p.id)).find(e => e.item_id === 'item_water_bottle');
      check('the shelf shows the marked-up price', shelf && shelf.base_price === Math.max(1, Math.round(list * STORED_MULT.low)), JSON.stringify({ list, shelf: shelf?.base_price }));
    }
    setWaterSupply(REGION, { state: 'dry' });
    check('mains water is gone while the main is dry', rule(seller, mains).soldOut === true && /main/.test(rule(seller, mains).line || ''));
    check('stored water still sells early in a dry spell', !rule(seller, stored).soldOut);
    spells.get(REGION).dryAt = Date.now() - (selloutMinutes(seller.id) + 1) * MIN;
    check('...and sells out later on', rule(seller, stored).soldOut === true);
    const spread = new Set(['npc_a', 'npc_b', 'npc_c', 'npc_d', 'npc_e'].map(selloutMinutes));
    check('vendors sell out at different times', spread.size > 1, [...spread].join(','));
    setWaterSupply(REGION, { state: 'flowing' });
    check('a sold-out vendor stays out until a delivery', rule(seller, stored).soldOut === true);
    spells.get(REGION).lastDryEnd = Date.now() - (RESTOCK_MINUTES + 1) * MIN;
    check('...then restocks', !rule(seller, stored).soldOut);

    // ── the condition, and the water run ───────────────────────────────────
    resetWaterSupply(); spells.clear();
    const outage = { water_supply: REGION, state: ['low', 'dry'] };
    check('no outage, no water run', (await evalCondition(outage, p)) === false);
    setWaterSupply(REGION, { state: 'low' });
    check('an outage posts it', (await evalCondition(outage, p)) === true);
    p.current_zone = 'zone_district_919_902';
    check("'here' reads the player's own region", (await evalCondition({ water_supply: 'here', state: 'low' }, p)) === true);
    const { rows: [wr] } = await query(`SELECT available FROM quests WHERE id = 'quest_hal_water_run'`);
    const when = wr?.available?.when || {};
    check('the water run is gated on the outage', when.water_supply === REGION && [...(when.state || [])].sort().join() === 'dry,low', JSON.stringify(wr));
    resetWaterSupply(); spells.clear();

    // ── the verbs ──────────────────────────────────────────────────────────
    p.current_zone = 'zone_district_919_902';
    let r = await run('gauges');
    check('gauges with no board errors', r?.type === 'error', JSON.stringify(r));
    scan();
    const coldwater = stationsOf(REGION);
    check('Coldwater has two stations in series', coldwater.length === 2, coldwater.map(st => st.name).join(', '));
    const works = coldwater.find(st => st.intakeZoneId);
    check('one of them owns the intake, and it sees the sky', !!works && !!getZone(works.intakeZoneId)?.flags?.open_sky, works?.intakeZoneId);
    check('the other has no intake to silt', coldwater.filter(st => !st.intakeZoneId).length === 1);
    const board = [...world.furniture.values()].find(f => f.flags?.water_gauges === REGION);
    check('the plant has a gauge board', !!board);
    if (board) {
      p.current_zone = board.zone_id;
      r = await run('gauges');
      check('gauges reads every station', r?.type === 'output' && /tower gauge/.test(r?.message || '') && coldwater.every(st => r.message.includes(st.name)), r?.message);
    }
    for (const st of coldwater) {
      check(`${st.name}: the pumps are a real room`, getZoneFurniture(st.zoneId).some(f => f.flags?.waterworks === REGION));
      // The harness never starts the power sim, so this reads the rows: the pump room's junction box
      // must answer to a city plant in the same region (tools/lib/utility-room.mjs once picked
      // Terminus's for every new building, because interiors and two plants all sit at 0,0).
      const { rows: [feed] } = await query(
        `SELECT cg.zone_id FROM power_zones pz JOIN generators jb ON jb.id = pz.generator_id
           JOIN generators cg ON cg.id = jb.city_generator_id WHERE pz.id = $1`, [st.zoneId]);
      check(`${st.name}: fed by its own region's plant`, waterNetworkOf(feed?.zone_id) === REGION, JSON.stringify(feed));
    }

    p.role = 'player';
    r = await run('waterworks status');
    check('waterworks refused for a player', /unknown command/i.test(r?.message || ''), r?.message);
    p.role = 'admin';
    r = await run('waterworks status');
    check('waterworks status reports the region', r?.message?.includes(REGION), r?.message);
    r = await run('waterworks set sideways');
    check('waterworks set refuses a bad state', r?.type === 'error');
  } finally {
    pause(false);
    resetWaterSupply();
    spells.clear();
    for (const st of stations.values()) enter(st, 'running');
    p.current_zone = saved.zone;
    p.role = saved.role;
    p.thirst = saved.thirst;
  }
}
