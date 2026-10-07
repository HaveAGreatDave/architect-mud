// Waterworks regression: the engine's supply law (server/engine/water.js) driven through the real
// verbs, and the plant's state machine. Supply is memory only, so every check here is undone by
// resetWaterSupply at the end.
//
// What this guards:
//  - a dry mains tap refuses `drink` and `wash` and takes nothing, and the readers really do call
//    the law (the split-reader bug: one verb converted, one still reading the flag alone)
//  - low still works, with a line; foul water won't wash you
//  - off-network water never fails: a transient room has no region, and `water_local` opts out
//  - the tower clock starts when the pumps stop and survives a fault turning into a power cut
//  - `gauges` needs a board; `waterworks` is staff only
import { world, getZone, getZoneFurniture } from '../../server/engine/world.js';
import { on } from '../../server/engine/events.js';
import { query } from '../../server/models/db.js';
import {
  waterNetworkOf, getWaterSupply, setWaterSupply, drawWater, resetWaterSupply, isDrinkingSource, isShower, isWaterSource,
} from '../../server/engine/water.js';
import { _internals, TOWER_MINUTES, FLUSH_MINUTES } from './index.js';

const REGION = 'region_coldwater';
const MIN = 60_000;

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const saved = { zone: p.current_zone, role: p.role, thirst: p.thirst };
  const { step, supplyOf, enter, scan, plants, gaugeReport, pause } = _internals;

  // The plant's own tick may already have run (the harness boots the scheduler), so start clean.
  pause(true);
  resetWaterSupply();
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
    // A plant whose pump room has no power at all: the first minute stops it.
    const t0 = Date.now();
    const fake = { region: REGION, pumpId: 'furn_none', zoneId: 'zone_waterworks_regress_nowhere', intakeZoneId: 'zone_waterworks_regress_nowhere', state: 'running', since: t0, until: null, stopped: null };
    step(fake, t0);
    check('no power stops the plant', fake.state === 'unpowered', fake.state);
    check('...and the tower holds the city', getWaterSupply('zone_district_919_902').state === 'low');
    enter(fake, 'fault', 40, t0 + 10 * MIN);
    check('a fault keeps the tower clock', fake.stopped === t0, `${fake.stopped} vs ${t0}`);
    step(fake, t0 + (TOWER_MINUTES + 1) * MIN);
    check('the tower runs out', getWaterSupply('zone_district_919_902').state === 'dry');
    check('gauges say the city is dry', /dry/.test(gaugeReport(fake, t0 + (TOWER_MINUTES + 1) * MIN)));
    enter(fake, 'turbid', FLUSH_MINUTES, t0);
    check('turbid water runs cloudy', supplyOf(fake, t0).quality === 'cloudy' && supplyOf(fake, t0).state === 'flowing');

    // ── the verbs ──────────────────────────────────────────────────────────
    p.current_zone = 'zone_district_919_902';
    let r = await run('gauges');
    check('gauges with no board errors', r?.type === 'error', JSON.stringify(r));
    scan();
    const plant = plants.get(REGION);
    check('the Coldwater plant is found by its flag', !!plant, [...plants.keys()].join(','));
    if (plant) {
      const board = [...world.furniture.values()].find(f => f.flags?.water_gauges === REGION);
      check('the plant has a gauge board', !!board);
      if (board) {
        p.current_zone = board.zone_id;
        r = await run('gauges');
        check('gauges reads the plant', r?.type === 'output' && /tower gauge/.test(r?.message || ''), JSON.stringify(r));
      }
      check('the intake sees the sky', !!getZone(plant.intakeZoneId)?.flags?.open_sky, plant.intakeZoneId);
      check('the pumps are a real room', getZoneFurniture(plant.zoneId).some(f => f.flags?.waterworks === REGION));
      // The harness never starts the power sim, so this reads the rows: the pump room's junction box
      // must answer to a city plant in the same region (tools/lib/utility-room.mjs once picked
      // Terminus's for every new building, because interiors and two plants all sit at 0,0).
      const { rows: [feed] } = await query(
        `SELECT cg.zone_id FROM power_zones pz JOIN generators jb ON jb.id = pz.generator_id
           JOIN generators cg ON cg.id = jb.city_generator_id WHERE pz.id = $1`, [plant.zoneId]);
      check("the pump room is fed by its own region's plant", waterNetworkOf(feed?.zone_id) === REGION, JSON.stringify(feed));
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
    scan();
    p.current_zone = saved.zone;
    p.role = saved.role;
    p.thirst = saved.thirst;
  }
}
