/**
 * One-shot: destructible power infrastructure.
 *
 *   1. Ensures furniture.hp / hp_max columns exist (matches SCHEMA_SQL).
 *   2. Seeds two demolition tools (Sledgehammer, Thermal Lance) — the only
 *      things that can damage the main plant.
 *   3. Gives "Coldwater Power" (zone_powerplantnew) a building interior —
 *      "Coldwater Power Plant — Turbine Hall" — moves the city_plant generator
 *      inside, and spawns the destructible generator furniture there.
 *   4. Retrofits every existing junction_box with destructible furniture linked
 *      to its generator row.
 *
 * Idempotent: safe to re-run. After running, restart the server (or reload
 * zones) so the new building/furniture load into the live world.
 *
 * Run once:  node server/models/temp/setup-destructible-power.js
 */

import { query } from '../db.js';

const GEN_HP = 5000;   // Coldwater main generator — very tough (soak 25, demolition-only)
const JBOX_HP = 1200;  // junction boxes — smaller, meleeable (soak 4)

const TURBINE_ZONE = 'zone_coldwater_turbine_hall';
const TURBINE_MAP  = 'map_int_coldwater_power';

async function main() {
  // 1. Schema safety (idempotent) ------------------------------------------
  await query(`ALTER TABLE furniture ADD COLUMN IF NOT EXISTS hp INTEGER DEFAULT NULL`);
  await query(`ALTER TABLE furniture ADD COLUMN IF NOT EXISTS hp_max INTEGER DEFAULT NULL`);

  // 2. Demolition tools -----------------------------------------------------
  await query(
    `INSERT INTO items (id,name,description,type,subtype,weight,value,is_stackable,is_unique,tags)
     VALUES ($1,$2,$3,'weapon','melee',8000,650,0,1,$4)
     ON CONFLICT (id) DO UPDATE SET tags=$4, description=$3`,
    ['item_sledgehammer', 'Sledgehammer',
     'A brutal two-handed demolition hammer. Heavy enough to stove in armoured machinery — slowly.',
     JSON.stringify({ weapon: true, slot: 'weapon_hand', demolition: true,
       damage: { min: 40, max: 70 }, weapon_skill: 'blunt', damage_type: 'kinetic' })]
  );
  await query(
    `INSERT INTO items (id,name,description,type,subtype,weight,value,is_stackable,is_unique,tags)
     VALUES ($1,$2,$3,'weapon','tool',6000,1800,0,1,$4)
     ON CONFLICT (id) DO UPDATE SET tags=$4, description=$3`,
    ['item_thermal_lance', 'Thermal Lance',
     'An oxy-fuel cutting lance that spits a 3000°C jet. Chews through steel casing and busbars alike.',
     JSON.stringify({ weapon: true, slot: 'weapon_hand', demolition: true,
       damage: { min: 55, max: 100 }, weapon_skill: 'energy', damage_type: 'fire' })]
  );
  console.log('Seeded demolition tools: Sledgehammer, Thermal Lance.');

  // 3. Coldwater Power building ---------------------------------------------
  const { rows: plantRows } = await query(
    `SELECT * FROM generators WHERE generator_type='city_plant' ORDER BY id LIMIT 1`
  );
  if (!plantRows.length) { console.error('No city_plant generator found — aborting.'); process.exit(1); }
  const plant = plantRows[0];
  const worldZoneId = plant.zone_id; // zone_powerplantnew ("Coldwater Power")
  console.log(`City plant: ${plant.id} (${plant.name}) in ${worldZoneId}`);

  const { rows: wz } = await query('SELECT name, exits FROM zones WHERE id=$1', [worldZoneId]);
  const worldName = wz[0]?.name || 'Coldwater Power';
  const worldExits = wz[0]?.exits || {};

  // Interior map + turbine hall zone
  await query(
    `INSERT INTO maps (id,name,parent_zone_id,entry_zone_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET parent_zone_id=$3, entry_zone_id=$4`,
    [TURBINE_MAP, 'Coldwater Power Plant — Interior', worldZoneId, TURBINE_ZONE]
  );
  await query(
    `INSERT INTO zones (id,name,description,danger_rating,map_id,grid_x,grid_y,grid_z,parent_zone,flags,exits)
     VALUES ($1,$2,$3,'low',$4,0,0,0,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET map_id=$4, parent_zone=$5, flags=$6, exits=$7`,
    [TURBINE_ZONE, 'Coldwater Power Plant — Turbine Hall',
     'A cavernous hall of throbbing turbines and grimy conduit. The city plant squats at the centre, roaring, its casing scabbed with warning decals and oil. The whole room shudders with the low churn of megawatts.',
     TURBINE_MAP, worldZoneId,
     JSON.stringify({ is_interior: true, is_building: true, world_exit_zone: worldZoneId }),
     JSON.stringify({ out: worldZoneId })]
  );
  // Wire world tile → turbine hall (preserve existing exits)
  await query('UPDATE zones SET exits=$1 WHERE id=$2',
    [JSON.stringify({ ...worldExits, in: TURBINE_ZONE }), worldZoneId]);
  console.log(`Built "${worldName}" → in → Coldwater Power Plant — Turbine Hall`);

  // Move the generator physically inside
  await query(`UPDATE generators SET zone_id=$1, flags = COALESCE(flags,'{}'::jsonb) - 'destroyed' WHERE id=$2`,
    [TURBINE_ZONE, plant.id]);

  // Power the turbine hall from the plant + light it
  await query(
    `INSERT INTO power_zones (id,name,source_type,generator_id,capacity_kw,current_load_kw,status,available_kw,max_capacity_kw)
     VALUES ($1,$2,'city_plant',$3,500,0,'powered',500,500) ON CONFLICT (id) DO NOTHING`,
    [TURBINE_ZONE, 'Coldwater Turbine Hall', plant.id]
  );
  await query(
    `INSERT INTO furniture (id,zone_id,name,description,object_type,light_type,light_on,light_on_intended,power_draw_kw,lumen_output,flags)
     VALUES ($1,$2,'Overhead Floods','Caged sodium floodlights slung from the gantry.','light','overhead',1,1,0.02,1600,'{}')
     ON CONFLICT (id) DO NOTHING`,
    ['furn_light_coldwater_turbine', TURBINE_ZONE]
  );

  // The destructible generator furniture
  await query(
    `INSERT INTO furniture (id,zone_id,name,description,object_type,flags,hp,hp_max)
     VALUES ($1,$2,$3,$4,'generator',$5,$6,$6)
     ON CONFLICT (id) DO UPDATE SET zone_id=$2, flags=$5, hp_max=$6`,
    ['furn_generator_coldwater', TURBINE_ZONE, 'Coldwater Main Generator',
     'A colossal city-grade turbine generator, its armoured casing streaked with grime and hazard chevrons. Banks of indicator lights stutter across its control face; a heavy sealed hacking port is bolted shut beneath a cracked screen. It ROARS.',
     JSON.stringify({ destructible: true, generator_id: plant.id, requires_demolition: true }),
     GEN_HP]
  );
  console.log(`Placed destructible Coldwater Main Generator (${GEN_HP} HP) in the Turbine Hall.`);

  // lighting_states for turbine hall
  await query(
    `INSERT INTO lighting_states (zone_id,has_emergency_lighting,artificial_light_level,fixture_count,total_lumens)
     VALUES ($1,0,0,1,1600) ON CONFLICT (zone_id) DO UPDATE SET fixture_count=1, total_lumens=1600`,
    [TURBINE_ZONE]
  ).catch(() => {});

  // 4. Retrofit junction boxes ---------------------------------------------
  const { rows: jboxes } = await query(`SELECT id, zone_id, name FROM generators WHERE generator_type='junction_box'`);
  let jbCount = 0;
  for (const jb of jboxes) {
    const furnId = `furn_jbox_${jb.zone_id}`;
    const res = await query(
      `INSERT INTO furniture (id,zone_id,name,description,object_type,flags,hp,hp_max)
       VALUES ($1,$2,$3,$4,'junction_box',$5,$6,$6)
       ON CONFLICT (id) DO UPDATE SET flags=$5, hp_max=$6`,
      [furnId, jb.zone_id, jb.name || 'Junction Box',
       'A grey steel junction cabinet of breakers and humming busbars, feeding the building. A small sealed hacking port sits below the latch.',
       JSON.stringify({ destructible: true, generator_id: jb.id }), JBOX_HP]
    );
    if (res.rowCount) jbCount++;
    // clear any stale destroyed flag on retrofit
    await query(`UPDATE generators SET flags = COALESCE(flags,'{}'::jsonb) - 'destroyed' WHERE id=$1`, [jb.id]);
  }
  console.log(`Retrofitted ${jbCount}/${jboxes.length} junction boxes as destructible furniture (${JBOX_HP} HP each).`);

  console.log('\nDone. Restart the server (or reload zones) to load the new building + furniture.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
