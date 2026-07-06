// One-shot: seed the full flight world — the six-aircraft roster, the six
// airfields (with per-field fuel/dealer/charter services), the Core no-fly
// airspace, a handful of ground AA sites, standing charter rentals, and one
// downed Carcass to salvage/rebuild. Run after `npm run db:schema`:
//   node scripts/seed-flight.js
// then reload the world (POST /api/world/reload) or restart so the zone flags load.
//
// Idempotent: types + airfield flags are upserted; AA sites / rentals / the wreck
// are keyed by stable ids and skipped if present.
import { query } from '../server/models/db.js';

// ── The six aircraft types (CONTENT) — blueprint relative values ──────────────
const TYPES = [
  { id: 'ac_mayfly',    name: 'Mayfly',    class: 'ultralight', takeoff_mode: 'stol', seats: 1, cargo_capacity: 0,   max_takeoff_weight: 90,   fuel_capacity: 170, fuel_burn_base: 1.0, fuel_type: 'avgas',   altitude_ceiling: 1, cruise_speed: 1, handling: 2,  hull_hp: 8,  hardpoints: 0, noise: 1, price_buy: 1200,  price_rent_hourly: 40,   engines: 1, data: { feel: 'Cheap trainer you\'ll wreck; the wind tosses it.' } },
  { id: 'ac_dragonfly', name: 'Dragonfly', class: 'heli',       takeoff_mode: 'vtol', seats: 2, cargo_capacity: 40,  max_takeoff_weight: 320,  fuel_capacity: 40,  fuel_burn_base: 1.8, fuel_type: 'avgas',   altitude_ceiling: 2, cruise_speed: 2, handling: -1, hull_hp: 18, hardpoints: 0, noise: 2, price_buy: 8000,  price_rent_hourly: 120,  engines: 1, data: { feel: 'Versatile early pick; thirsty; hovers, lands anywhere flat.' } },
  { id: 'ac_mule',      name: 'Mule',      class: 'prop',       takeoff_mode: 'stol', seats: 3, cargo_capacity: 180, max_takeoff_weight: 620,  fuel_capacity: 70,  fuel_burn_base: 1.3, fuel_type: 'avgas',   altitude_ceiling: 2, cruise_speed: 2, handling: 0,  hull_hp: 30, hardpoints: 0, noise: 2, price_buy: 14000, price_rent_hourly: 220,  engines: 2, data: { feel: 'Freight workhorse; rugged; rough-strip capable.' } },
  { id: 'ac_leviathan', name: 'Leviathan', class: 'heavy',      takeoff_mode: 'strip', seats: 6, cargo_capacity: 600, max_takeoff_weight: 1400, fuel_capacity: 160, fuel_burn_base: 2.6, fuel_type: 'jet',     altitude_ceiling: 3, cruise_speed: 2, handling: 3,  hull_hp: 55, hardpoints: 0, noise: 3, price_buy: 60000, price_rent_hourly: 900,  engines: 4, data: { feel: 'Economy endgame; an Antonov An-124 Ruslan — heavy and ponderous, but builds real speed once it has momentum behind it in a dive. Hungry; needs a real runway.' } },
  { id: 'ac_reaper',    name: 'Reaper',    class: 'gunship',    takeoff_mode: 'stol', seats: 2, cargo_capacity: 60,  max_takeoff_weight: 500,  fuel_capacity: 90,  fuel_burn_base: 2.2, fuel_type: 'jet',     altitude_ceiling: 2, cruise_speed: 2, handling: -1, hull_hp: 85, hardpoints: 4, noise: 3, price_buy: 90000, price_rent_hourly: 1500, engines: 2, data: { feel: 'Attack craft, a Fairchild A-10 Warthog — the gun IS the plane. Slow, draggy, armoured; it loiters over the target, shrugs off ground fire, and just keeps coming. Everyone hears the BRRRT.' } },
  { id: 'ac_carcass',   name: 'Carcass',   class: 'wreck',      takeoff_mode: 'stol', seats: 1, cargo_capacity: 0,   max_takeoff_weight: 300,  fuel_capacity: 30,  fuel_burn_base: 2.0, fuel_type: 'biofuel', altitude_ceiling: 1, cruise_speed: 1, handling: 4,  hull_hp: 10, hardpoints: 0, noise: 2, price_buy: 400,   price_rent_hourly: 0,    engines: 1, data: { feel: 'Found downed; rebuild rolls a random type.' } },
];

async function upsertType(t) {
  await query(
    `INSERT INTO aircraft_types
       (id,name,class,takeoff_mode,seats,cargo_capacity,max_takeoff_weight,fuel_capacity,fuel_burn_base,fuel_type,altitude_ceiling,cruise_speed,handling,hull_hp,hardpoints,noise,price_buy,price_rent_hourly,engines,data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,class=EXCLUDED.class,takeoff_mode=EXCLUDED.takeoff_mode,seats=EXCLUDED.seats,
       cargo_capacity=EXCLUDED.cargo_capacity,max_takeoff_weight=EXCLUDED.max_takeoff_weight,fuel_capacity=EXCLUDED.fuel_capacity,
       fuel_burn_base=EXCLUDED.fuel_burn_base,fuel_type=EXCLUDED.fuel_type,altitude_ceiling=EXCLUDED.altitude_ceiling,cruise_speed=EXCLUDED.cruise_speed,
       handling=EXCLUDED.handling,hull_hp=EXCLUDED.hull_hp,hardpoints=EXCLUDED.hardpoints,noise=EXCLUDED.noise,price_buy=EXCLUDED.price_buy,
       price_rent_hourly=EXCLUDED.price_rent_hourly,engines=EXCLUDED.engines,data=EXCLUDED.data`,
    [t.id, t.name, t.class, t.takeoff_mode, t.seats, t.cargo_capacity, t.max_takeoff_weight, t.fuel_capacity, t.fuel_burn_base,
     t.fuel_type, t.altitude_ceiling, t.cruise_speed, t.handling, t.hull_hp, t.hardpoints, t.noise, t.price_buy, t.price_rent_hourly, t.engines, JSON.stringify(t.data)]
  );
}

// ── The six airfields (flag existing thematically-fitting zones) ──────────────
const FIELDS = [
  { zone: 'zone_threshold',        id: 'af_helipad',    name: 'Threshold Helipad',   fuels: ['avgas', 'jet'],            dealer: false, charter: true,  lawless: false },
  { zone: 'zone_outskirts',        id: 'af_regional',   name: 'Coldwater Regional',  fuels: ['avgas', 'jet', 'biofuel'], dealer: true,  charter: true,  lawless: false },
  { zone: 'zone_yard_marshalling', id: 'af_marshalling',name: 'Marshalling Field',   fuels: ['avgas', 'jet'],            dealer: false, charter: true,  lawless: false },
  { zone: 'zone_slag_gate',        id: 'af_slagworks',  name: 'Slagworks Strip',     fuels: ['avgas', 'biofuel'],        dealer: false, charter: true,  lawless: true  },
  { zone: 'zone_waste_scald',      id: 'af_redline',    name: 'Redline Airstrip',    fuels: ['biofuel'],                 dealer: false, charter: false, lawless: true  },
  { zone: 'zone_dock_slip',        id: 'af_bay',        name: "Smuggler's Slip Pad", fuels: ['avgas', 'biofuel'],        dealer: false, charter: true,  lawless: true  },
];

// Core no-fly cluster (police airspace) — near, but not on, the helipad.
const NO_FLY = ['zone_city_north', 'zone_city_ne', 'zone_thresholdeast', 'zone_meridian'];

// Ground AA emplacements (contested/wastes).
const AA = [
  { id: 'aa_redline_sam',    zone_id: 'zone_red_killingfloor', name: 'the Redline SAM nest',   range: 1, damage: 0.28, accuracy: 7, faction: 'redline' },
  { id: 'aa_wastes_gun',     zone_id: 'zone_waste_ashreach',   name: 'a wastes autocannon',    range: 2, damage: 0.20, accuracy: 6, faction: null },
  { id: 'aa_slag_flak',      zone_id: 'zone_slag_flarestack',  name: 'a Slagworks flak gun',   range: 1, damage: 0.18, accuracy: 5, faction: null },
];

// Standing charter rentals + one downed Carcass.
const RENTALS = [
  { id: 'ac_rent_regional_mayfly',   type: 'ac_mayfly',    zone: 'zone_outskirts' },
  { id: 'ac_rent_regional_dragonfly',type: 'ac_dragonfly', zone: 'zone_outskirts' },
  { id: 'ac_rent_helipad_dragonfly', type: 'ac_dragonfly', zone: 'zone_threshold' },
  { id: 'ac_rent_yards_mule',        type: 'ac_mule',      zone: 'zone_yard_marshalling' },
];
const WRECK = { id: 'ac_wreck_cinderflat', type: 'ac_carcass', zone: 'zone_waste_cinderflat' };

// ── Apply ─────────────────────────────────────────────────────────────────────
for (const t of TYPES) { await upsertType(t); }
console.log(`Upserted ${TYPES.length} aircraft types.`);

for (const f of FIELDS) {
  const z = await query('SELECT id, grid_x, grid_y FROM zones WHERE id=$1', [f.zone]);
  if (!z.rows.length) { console.warn(`SKIP field ${f.id}: zone ${f.zone} missing`); continue; }
  await query(
    `UPDATE zones SET flags = COALESCE(flags,'{}'::jsonb) || jsonb_build_object(
       'airfield_id', $1::text, 'airfield_name', $2::text, 'airfield_fuel', true,
       'airfield_fuels', $3::jsonb, 'airfield_dealer', $4::boolean, 'airfield_charter', $5::boolean, 'airfield_lawless', $6::boolean)
     WHERE id=$7`,
    [f.id, f.name, JSON.stringify(f.fuels), f.dealer, f.charter, !!f.lawless, f.zone]
  );
  console.log(`Airfield ${f.name} @ ${f.zone} (fuels ${f.fuels.join('/')}${f.dealer ? ', dealer' : ''}${f.charter ? ', charter' : ''}${f.lawless ? ', LAWLESS' : ''}).`);
}

for (const zid of NO_FLY) {
  const r = await query(`UPDATE zones SET flags = COALESCE(flags,'{}'::jsonb) || jsonb_build_object('airspace_restricted', true) WHERE id=$1`, [zid]);
  if (r.rowCount) console.log(`No-fly airspace over ${zid}.`);
}

for (const s of AA) {
  const z = await query('SELECT id FROM zones WHERE id=$1', [s.zone_id]);
  if (!z.rows.length) { console.warn(`SKIP AA ${s.id}: zone ${s.zone_id} missing`); continue; }
  await query(
    `INSERT INTO aa_sites (id,zone_id,name,range,damage,accuracy,faction,active) VALUES ($1,$2,$3,$4,$5,$6,$7,1)
     ON CONFLICT (id) DO UPDATE SET range=EXCLUDED.range,damage=EXCLUDED.damage,accuracy=EXCLUDED.accuracy,active=1`,
    [s.id, s.zone_id, s.name, s.range, s.damage, s.accuracy, s.faction]
  );
  console.log(`AA site ${s.name} @ ${s.zone_id}.`);
}

for (const r of RENTALS) {
  const exists = await query('SELECT id FROM aircraft WHERE id=$1', [r.id]);
  if (exists.rows.length) { console.log(`SKIP rental ${r.id}`); continue; }
  const z = await query('SELECT grid_x, grid_y FROM zones WHERE id=$1', [r.zone]);
  if (!z.rows.length) { console.warn(`SKIP rental ${r.id}: zone ${r.zone} missing`); continue; }
  const cap = TYPES.find(t => t.id === r.type).fuel_capacity;
  await query(
    `INSERT INTO aircraft (id,type_id,name,owner_id,map_id,grid_x,grid_y,altitude_band,heading,parked_zone_id,fuel,engine_temp,rental)
     VALUES ($1,$2,$3,NULL,'map_world',$4,$5,'ground','n',$6,$7,20,1)`,
    [r.id, r.type, `Charter ${r.type.replace('ac_', '').toUpperCase()}`, z.rows[0].grid_x, z.rows[0].grid_y, r.zone, cap]
  );
  console.log(`Rental ${r.id} parked at ${r.zone}.`);
}

{
  const exists = await query('SELECT id FROM aircraft WHERE id=$1', [WRECK.id]);
  if (!exists.rows.length) {
    const z = await query('SELECT grid_x, grid_y FROM zones WHERE id=$1', [WRECK.zone]);
    if (z.rows.length) {
      await query(
        `INSERT INTO aircraft (id,type_id,name,owner_id,map_id,grid_x,grid_y,altitude_band,parked_zone_id,fuel,damage,is_wreck,rental)
         VALUES ($1,$2,$3,NULL,'map_world',$4,$5,'ground',$6,0,1,1,0)`,
        [WRECK.id, WRECK.type, 'a downed Carcass', z.rows[0].grid_x, z.rows[0].grid_y, WRECK.zone]
      );
      console.log(`Downed Carcass wreck placed at ${WRECK.zone} (salvage/rebuild).`);
    }
  } else console.log(`SKIP wreck ${WRECK.id}`);
}

console.log('\nFlight world seeded. Reload the world, then fly. Regional (The Rust Quarter) has the dealer + charter desk.');
process.exit(0);
