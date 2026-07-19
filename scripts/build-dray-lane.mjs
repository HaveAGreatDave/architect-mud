// One-shot content script: build Dray Lane + four freight buildings east of the
// Ironside strip, filling the empty grassland between the Embassy row and the
// Coldwater Basin (the "empty space next to the Embassy").
//
// Geometry (map_world grid):
//   x=921, y=903..906  →  Dray Lane   (grass → paved N–S freight service lane)
//   x=922, y=903..906  →  4 building facades facing WEST onto the lane
// The lane opens north to the grassland and feeds south past the Yards
// (921,906 → Airfreight forecourt) toward Kessler Street.
//
// Every building gets the FULL power-sim stack, modelled exactly on Ration Nine
// (the current clean template): facade + interior + map record + reachable
// below-grade utility room + junction box (generator + furniture) + power_zones
// for both rooms + a lit shop-floor overhead + a util worklight. Building types
// reuse the existing Yards freight types so their 3-D models + map icons +
// minimap glyphs already exist (container_yard / freight_office / cold_storage /
// fabrication).
//
// Idempotent (ON CONFLICT). Run once:
//   node scripts/build-dray-lane.mjs
//   then: node scripts/fix-facade-interior-exits.mjs   (correct interior→street dir)
//   then: npm run content:export → review diff → commit → push (CODEX)
import { query } from '../server/models/db.js';

const CITY_GEN = 'gen_zone_powerplantnew_1782069598190';   // Coldwater power plant
const NOW = 1784100000;                                     // fixed stamp (deterministic)

// ── The four freight buildings (x=922), north→south ──────────────────────────
const B = [
  {
    y: 903, slug: 'container', bt: 'container_yard', marker: 'CY',
    name: 'Coldwater Container Yard',
    facade: "The face of the Coldwater Container Yard — a chain-link gate on a rolling track, and behind it corroded shipping cans stacked four high in canyons that groan when the wind comes off the Basin. A tally board by the gate is scrawled with box numbers nobody has reconciled in years. Dray Lane runs off to the west.",
    intName: 'Coldwater Container Yard',
    interior: "Inside the gate: a gravel lot walled in by stacked containers, a rusted reach-stacker slumped on flat tyres, and a weighbridge office the size of a phone box. Half the cans are welded shut; the other half you really don't want opened.",
    light: { name: 'sodium floodmast', lm: 1500, desc: 'A single floodmast on a leaning pole washes the container canyons in dirty amber, throwing shadows deep enough to lose a body in — which, per the tally board, someone once did.' },
  },
  {
    y: 904, slug: 'freightoffice', bt: 'freight_office', marker: 'FO',
    name: 'Meltwater Freight Office',
    facade: "The face of the Meltwater Freight Office — a two-storey prefab with a lit dispatch window, a whiteboard of run times behind the glass, and a queue rail nobody queues at. A magnetic sign reads: LOADS BOOKED — NO CASH ON SITE. Dray Lane runs off to the west.",
    intName: 'Meltwater Freight Office',
    interior: "A cramped dispatch floor: a horseshoe of consoles, a wall of pigeonholes stuffed with airway bills, and a coffee machine that has achieved a kind of tar-based sentience. A dispatcher's headset crackles with runs to yards that may not exist anymore.",
    light: { name: 'drop-ceiling panels', lm: 1800, desc: 'Flat white LED panels in a water-stained drop ceiling, one corner buzzing where damp got into the ballast. Bright enough to read a manifest, harsh enough to make you not want to.' },
  },
  {
    y: 905, slug: 'coldstore', bt: 'cold_storage', marker: 'CS',
    name: 'Basin Cold Store',
    facade: "The face of the Basin Cold Store — a fat insulated box sheathed in frosted panelling, its roller door skinned with rime even in summer. Condensers the size of engines hammer away on the roof, dripping a permanent black puddle across the threshold. Dray Lane runs off to the west.",
    intName: 'Basin Cold Store',
    interior: "The chill room: breath-fogging cold, racks of shrouded pallets furred with frost, and a floor slick enough to teach you humility. Something hangs on the far hooks under a tarp; the tag, when you can read it through the ice, just says HOLD.",
    light: { name: 'vapour-proof battens', lm: 1600, desc: 'Sealed vapour-proof battens glow a cold blue-white behind frosted lenses, each haloed in the freezer fog. They never warm the room — they only make the cold easier to see.' },
  },
  {
    y: 906, slug: 'fab', bt: 'fabrication', marker: 'FB',
    name: 'Ferro Fabrication Works',
    facade: "The face of the Ferro Fabrication Works — an open-fronted steel shed spitting the blue strobe of an arc welder, the air tasting of hot metal and flux. Offcuts and I-beam stubs are stacked like cordwood along the frontage under a hand-painted board: WE MAKE IT, WE MEND IT, WE DON'T ASK. Dray Lane runs off to the west.",
    intName: 'Ferro Fabrication Works',
    interior: "The shop floor: a plate roller, a bank of gas bottles chained to the wall, and a bench scarred by ten thousand grinds. Sparks fan across the concrete in bright arcs and die. Whatever a district this hard needs bent, cut, or welded shut, it gets made here.",
    light: { name: 'caged work-lamps', lm: 1700, desc: 'Caged incandescent work-lamps on swing-arms hang over each station, their filaments trembling with the shed’s bad wiring. Between them the arc welder throws a second, whiter light that burns after-images onto your eyes.' },
  },
];

const q = (sql, args) => query(sql, args);

// ── 1. Dray Lane: convert the four grassland tiles at x=921 into paved road ───
for (const b of B) {
  const laneId = `zone_district_921_${b.y}`;
  const exits = {
    north: `zone_district_921_${b.y - 1}`,
    south: `zone_district_921_${b.y + 1}`,
    east: `zone_district_922_${b.y}`,
  };
  await q(
    `UPDATE zones SET name=$2, description=$3, exits=$4::jsonb,
       flags = COALESCE(flags,'{}'::jsonb) || $5::jsonb, updated_at=$6
     WHERE id=$1`,
    [laneId, 'Dray Lane',
     'A cracked strip of oil-black hardstand running behind the Ironside shops, wide enough for a rigid to turn if the driver has faith. Faded loading bays are stencilled along the kerb; a bent sign reads DRAY LANE — DELIVERIES ONLY. The Basin glitters cold to the east.',
     JSON.stringify(exits),
     JSON.stringify({ terrain: 'road', district: 'yards' }),
     NOW]
  );
  console.log(`LANE  ${laneId}  Dray Lane`);
}

// ── 2. Per building: facade + interior + map + power stack ────────────────────
for (const b of B) {
  const facadeId = `zone_district_922_${b.y}`;
  const laneId = `zone_district_921_${b.y}`;
  const intId = `zone_dray_${b.slug}`;
  const utilId = `zone_util_${intId}`;
  const mapId = `map_interior_${intId}`;
  const genId = `gen_${utilId}`;

  // Facade: convert the x=922 grass tile into a west-facing enterable facade.
  const facadeExits = { west: laneId, in: intId };
  if (b.y > 903) facadeExits.north = `zone_district_922_${b.y - 1}`;   // chain the row
  facadeExits.south = `zone_district_922_${b.y + 1}`;                  // 906 → Customs (Yards)
  await q(
    `UPDATE zones SET name=$2, description=$3, exits=$4::jsonb,
       flags = COALESCE(flags,'{}'::jsonb) || $5::jsonb,
       ambient_theme='urban', updated_at=$6
     WHERE id=$1`,
    [facadeId, b.name, b.facade, JSON.stringify(facadeExits),
     JSON.stringify({
       building_name: b.name, building_type: b.bt, district: 'yards',
       facade: true, is_building: true, planner: 'bp_district',
       world_exit_zone: laneId,
     }), NOW]
  );
  await q('UPDATE zones SET marker=$2 WHERE id=$1', [facadeId, b.marker]);
  console.log(`FACADE ${facadeId}  ${b.name} (${b.bt})`);

  // Interior (own map). Provisional street exit = west; fix-facade-interior-exits
  // corrects it to buildingEntranceDir(facade). down→util is the reachable utility room.
  await q(
    `INSERT INTO zones (id, name, description, exits, flags, map_id, parent_zone,
                        grid_x, grid_y, grid_z, ambient_theme, created_by, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,0,0,0,'indoors','dray-lane-build',$8)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
       exits=EXCLUDED.exits, flags=EXCLUDED.flags, map_id=EXCLUDED.map_id,
       parent_zone=EXCLUDED.parent_zone`,
    [intId, b.intName, b.interior,
     JSON.stringify({ west: facadeId, down: utilId }),
     JSON.stringify({
       building_name: b.name, building_type: b.bt,
       is_building: true, is_interior: true, world_exit_zone: facadeId,
     }), mapId, facadeId, NOW]
  );

  // Interior map record (makes the facade enterable + gives it a map icon).
  await q(
    `INSERT INTO maps (id, name, parent_zone_id, entry_zone_id, created_by, updated_at)
     VALUES ($1,$2,$3,$4,'dray-lane-build',$5)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,
       parent_zone_id=EXCLUDED.parent_zone_id, entry_zone_id=EXCLUDED.entry_zone_id`,
    [mapId, `${b.name} — Interior`, facadeId, intId, NOW]
  );

  // Below-grade utility room (shares the building's interior map, grid_z −1).
  await q(
    `INSERT INTO zones (id, name, description, exits, flags, map_id, parent_zone,
                        grid_x, grid_y, grid_z, ambient_theme, created_by, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,0,0,-1,'indoors','dray-lane-build',$8)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
       exits=EXCLUDED.exits, flags=EXCLUDED.flags, map_id=EXCLUDED.map_id,
       parent_zone=EXCLUDED.parent_zone`,
    [utilId, `${b.name} — Utility Room`,
     'A cramped below-grade utility room: bare concrete, sweating pipes, and the building junction box humming in its steel cabinet.',
     JSON.stringify({ up: intId }),
     JSON.stringify({ is_interior: true, utility_room: true, world_exit_zone: facadeId }),
     mapId, facadeId, NOW]
  );
  console.log(`  INT  ${intId}  + util ${utilId}`);

  // Junction-box generator (draws from the city plant), like Ration Nine.
  await q(
    `INSERT INTO generators (id, zone_id, generator_type, capacity_kw, city_generator_id,
                             connection_range, fuel_type, fuel_remaining, fuel_burn_rate, name, flags)
     VALUES ($1,$2,'junction_box',5000,$3,0,NULL,0,0,$4,'{}'::jsonb)
     ON CONFLICT (id) DO UPDATE SET zone_id=EXCLUDED.zone_id,
       city_generator_id=EXCLUDED.city_generator_id, name=EXCLUDED.name`,
    [genId, utilId, CITY_GEN, `${b.name} Junction Box`]
  );

  // Power zones for both rooms (the sim recomputes derived load/available each cycle).
  for (const [zid, zname] of [[intId, b.name], [utilId, `${b.name} — Utility Room`]]) {
    await q(
      `INSERT INTO power_zones (id, name, source_type, generator_id, capacity_kw, max_capacity_kw)
       VALUES ($1,$2,'junction_box',$3,5000,1000)
       ON CONFLICT (id) DO UPDATE SET source_type='junction_box',
         generator_id=EXCLUDED.generator_id, capacity_kw=5000, max_capacity_kw=1000`,
      [zid, zname, genId]
    );
  }

  // Junction-box furniture (destructible, hackable), linked to the generator.
  await q(
    `INSERT INTO furniture (id, zone_id, name, description, flags, object_type,
                            light_type, hp, hp_max, price, origin)
     VALUES ($1,$2,'Junction Box',$3,$4::jsonb,'junction_box','lamp',1200,1200,0,'authored')
     ON CONFLICT (id) DO UPDATE SET zone_id=EXCLUDED.zone_id, flags=EXCLUDED.flags,
       hp_max=EXCLUDED.hp_max`,
    [`furn_jbox_${utilId}`, utilId,
     'A grey steel junction cabinet of breakers and humming busbars, feeding the building. A small sealed hacking port sits below the latch.',
     JSON.stringify({ destructible: true, generator_id: genId })]
  );

  // Shop-floor overhead light (lit) + util worklight (lit).
  await q(
    `INSERT INTO furniture (id, zone_id, name, description, flags, object_type, light_type,
                            light_on, light_on_intended, power_draw_kw, lumen_output, price, origin)
     VALUES ($1,$2,$3,$4,$5::jsonb,'light','overhead',1,1,0.02,$6,0,'authored')
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
       light_on=1, light_on_intended=1, lumen_output=EXCLUDED.lumen_output`,
    [`furn_light_${intId}`, intId, b.light.name, b.light.desc,
     JSON.stringify({ is_light: true, light_type: 'overhead' }), b.light.lm]
  );
  await q(
    `INSERT INTO furniture (id, zone_id, name, description, flags, object_type, light_type,
                            light_on, light_on_intended, power_draw_kw, lumen_output, price, origin)
     VALUES ($1,$2,'Caged Worklight',$3,'{}'::jsonb,'light','overhead',1,1,0.02,900,0,'authored')
     ON CONFLICT (id) DO UPDATE SET light_on=1, light_on_intended=1`,
    [`furn_light_${utilId}`, utilId, 'A dust-caked worklight in a wire cage, throwing hard shadows.']
  );
}

// ── 3. Resync lighting_states for the new rooms so they read lit immediately ──
const litZones = B.flatMap(b => [`zone_dray_${b.slug}`, `zone_util_zone_dray_${b.slug}`]);
for (const zone of litZones) {
  const { rows } = await q(
    `SELECT COUNT(*)::int AS cnt,
            COALESCE(SUM(CASE WHEN light_on=1 THEN COALESCE(lumen_output,0) ELSE 0 END),0)::int AS lm
       FROM furniture WHERE zone_id=$1 AND object_type='light'`, [zone]);
  await q(
    `INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count, total_lumens)
     VALUES ($1,0,0,$2,$3) ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2, total_lumens=$3`,
    [zone, rows[0]?.cnt || 0, rows[0]?.lm || 0]);
}

console.log('\nDone. Dray Lane + 4 freight buildings authored with full power stacks.');
console.log('Next: node scripts/fix-facade-interior-exits.mjs  → then npm run content:export → review → commit → push.');
process.exit(0);
