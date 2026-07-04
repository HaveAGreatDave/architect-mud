// One-shot: seed Phase A flight content — the Dragonfly scout-heli TEMPLATE, one
// rentable Dragonfly parked at The Marshalling Yard, and the airfield flags on
// that zone. Run once (after `npm run db:schema` has created the aircraft tables):
//   node scripts/seed-flight.js
// Then reload the running world so the zone flags take effect:
//   POST /api/world/reload   (or restart the server)
//
// Re-runnable: the type + zone flags are upserted; the rental instance is created
// once and left alone (so an in-progress flight isn't reset).
//
// Phase A stands the airfield up on an existing freight yard (the zone-flag
// pattern from scavenging_table_id / fishing_table_id). Phase C authors the six
// real airfields as first-class content.
import { query } from '../server/models/db.js';

const AIRFIELD_ZONE = 'zone_yard_marshalling';   // The Marshalling Yard (city-edge freight, 7,-1)
const AIRFIELD_ID = 'af_marshalling';
const TYPE_ID = 'ac_dragonfly';
const RENTAL_ID = 'aircraft_rental_dragonfly_1';

// ── Aircraft type (CONTENT) — the Dragonfly scout heli, per systems-flight.md ──
const DRAGONFLY = {
  id: TYPE_ID, name: 'Dragonfly', class: 'heli', takeoff_mode: 'vtol',
  seats: 2, cargo_capacity: 40, max_takeoff_weight: 320,
  fuel_capacity: 40, fuel_burn_base: 1.8, fuel_type: 'avgas',
  altitude_ceiling: 2, cruise_speed: 2, handling: -1,
  hull_hp: 18, hardpoints: 0, noise: 2,
  price_buy: 8000, price_rent_hourly: 120,
  data: { feel: 'Versatile early pick; thirsty; hovers, lands anywhere flat.' },
};

const zoneRes = await query('SELECT id, grid_x, grid_y FROM zones WHERE id=$1', [AIRFIELD_ZONE]);
if (!zoneRes.rows.length) { console.error(`Zone ${AIRFIELD_ZONE} not found.`); process.exit(1); }
const zone = zoneRes.rows[0];

await query(
  `INSERT INTO aircraft_types
     (id,name,class,takeoff_mode,seats,cargo_capacity,max_takeoff_weight,fuel_capacity,fuel_burn_base,fuel_type,altitude_ceiling,cruise_speed,handling,hull_hp,hardpoints,noise,price_buy,price_rent_hourly,data)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
   ON CONFLICT (id) DO UPDATE SET
     name=EXCLUDED.name, class=EXCLUDED.class, takeoff_mode=EXCLUDED.takeoff_mode, seats=EXCLUDED.seats,
     cargo_capacity=EXCLUDED.cargo_capacity, max_takeoff_weight=EXCLUDED.max_takeoff_weight,
     fuel_capacity=EXCLUDED.fuel_capacity, fuel_burn_base=EXCLUDED.fuel_burn_base, fuel_type=EXCLUDED.fuel_type,
     altitude_ceiling=EXCLUDED.altitude_ceiling, cruise_speed=EXCLUDED.cruise_speed, handling=EXCLUDED.handling,
     hull_hp=EXCLUDED.hull_hp, hardpoints=EXCLUDED.hardpoints, noise=EXCLUDED.noise,
     price_buy=EXCLUDED.price_buy, price_rent_hourly=EXCLUDED.price_rent_hourly, data=EXCLUDED.data`,
  [DRAGONFLY.id, DRAGONFLY.name, DRAGONFLY.class, DRAGONFLY.takeoff_mode, DRAGONFLY.seats,
   DRAGONFLY.cargo_capacity, DRAGONFLY.max_takeoff_weight, DRAGONFLY.fuel_capacity, DRAGONFLY.fuel_burn_base,
   DRAGONFLY.fuel_type, DRAGONFLY.altitude_ceiling, DRAGONFLY.cruise_speed, DRAGONFLY.handling,
   DRAGONFLY.hull_hp, DRAGONFLY.hardpoints, DRAGONFLY.noise, DRAGONFLY.price_buy, DRAGONFLY.price_rent_hourly,
   JSON.stringify(DRAGONFLY.data)]
);
console.log(`UPSERT aircraft_type ${TYPE_ID} (Dragonfly)`);

// ── Airfield flags on the yard (zone-flag pattern) ────────────────────────────
await query(
  `UPDATE zones SET flags = COALESCE(flags,'{}'::jsonb)
     || jsonb_build_object('airfield_id', $1::text, 'airfield_name', 'Coldwater Regional (Marshalling Field)', 'airfield_fuel', true)
   WHERE id=$2`,
  [AIRFIELD_ID, AIRFIELD_ZONE]
);
console.log(`Flagged ${AIRFIELD_ZONE} as airfield ${AIRFIELD_ID} (with fuel service).`);

// ── Rental instance (RUNTIME) — created once, parked full at the field ────────
const exists = await query('SELECT id FROM aircraft WHERE id=$1', [RENTAL_ID]);
if (exists.rows.length) {
  console.log(`SKIP  rental aircraft ${RENTAL_ID} (already exists).`);
} else {
  await query(
    `INSERT INTO aircraft (id,type_id,name,owner_id,map_id,grid_x,grid_y,altitude_band,heading,parked_zone_id,fuel,throttle,engine_temp,damage,airborne,engine_on,is_wreck,rental)
     VALUES ($1,$2,$3,NULL,'map_world',$4,$5,'ground','n',$6,$7,0,20,0,0,0,0,1)`,
    [RENTAL_ID, TYPE_ID, 'Rental Dragonfly', zone.grid_x, zone.grid_y, AIRFIELD_ZONE, DRAGONFLY.fuel_capacity]
  );
  console.log(`CREATED rental aircraft ${RENTAL_ID} parked at ${AIRFIELD_ZONE}, full tank.`);
}

console.log(`\nDone. Reload the world, then stand in ${AIRFIELD_ZONE} and: board · startup · throttle 60 · takeoff`);
process.exit(0);
