// One-shot: give every airfield a walk-in HANGAR — an enterable interior room off
// the exterior ramp tile. Players step `in` from the field to find the services
// (hangar/refuel/buy/rent/charter all resolve to the ramp via fieldFor) and, at the
// three staffed fields, the charter pilot sitting at the ops desk. The aircraft
// themselves always stay on the exterior ramp (the flight sim flies the map_world
// grid); only the pilot + the transactions live inside.
//
// Idempotent: interiors/maps/chairs are skip-if-exists; the ramp's flag+exit are
// re-asserted every run. Run once, then reload the world (or restart):
//   node scripts/seed-hangar-interiors.js   →   restart / POST /api/world/reload
//
// The chair `name` MUST match DESK_CHAIR in plugins/flight/charter.js.
import { query } from '../server/models/db.js';

const DESK_CHAIR = 'the flight-ops desk chair';

// Every airfield ramp → its new hangar interior. `pilot` is the charter_pilot NPC
// stationed there (null for the three unstaffed fields — still an enterable hangar).
const FIELDS = [
  { ramp: 'zone_threshold',        pilot: null },
  { ramp: 'zone_outskirts',        pilot: 'npc_charter_doyle' },
  { ramp: 'zone_yard_marshalling', pilot: 'npc_charter_soto' },
  { ramp: 'zone_slag_gate',        pilot: null },
  { ramp: 'zone_waste_scald',      pilot: null },
  { ramp: 'zone_dock_slip',        pilot: 'npc_charter_kessler' },
];

const interiorDesc = (name) =>
  `The ${name} hangar: a cavernous prefab of corrugated steel, its floor a map of old oil stains and tyre scuffs. ` +
  `Tool racks and a battered workbench line one wall; a wheeled ops desk with a bank of flight monitors faces the other. ` +
  `The big bay doors stand open to the west, framing the ramp and the aircraft parked out on it. ` +
  `Beyond the apron a taxiway peels off and runs dead-straight to a long runway — a broad grey ribbon stretched to the horizon, ` +
  `its dashed centreline dwindling to a pale seam, threshold numbers shimmering in the heat off the tarmac, a lone windsock snapping at the far end. ` +
  `It smells of avgas, hot metal and cold coffee.`;

for (const { ramp, pilot } of FIELDS) {
  const rz = await query("SELECT id, flags, exits FROM zones WHERE id=$1", [ramp]);
  if (!rz.rows.length) { console.warn(`SKIP ${ramp}: ramp zone missing`); continue; }
  const rampFlags = rz.rows[0].flags || {};
  const rampExits = rz.rows[0].exits || {};
  // The field's name now lives on the airfields row, reached through the ramp's
  // membership pointer. The interior deliberately does NOT get a copy — carrying one
  // is what made two hangar interiors read as airports on the map.
  const afRow = rampFlags.airfield_id
    ? (await query('SELECT name FROM airfields WHERE id=$1', [rampFlags.airfield_id])).rows[0]
    : null;
  const afName = afRow?.name || ramp;

  const suffix = ramp.replace(/^zone_/, '');
  const interiorId = `zone_hangar_${suffix}`;
  const mapId = `map_int_hangar_${suffix}`;
  const chairId = `furn_hangar_chair_${suffix}`;
  const benchId = `furn_hangar_bench_${suffix}`;

  // 1. Interior map (grid container for this hangar's own room[s]).
  await query(
    `INSERT INTO maps (id, name, parent_zone_id, entry_zone_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO NOTHING`,
    [mapId, `${afName} — Hangar`, ramp, interiorId]
  );

  // 2. The interior zone. `hangar_interior` is our discriminator; `is_interior` is
  //    the engine's indoor contract (no weather/temp, no NPC wander-in). Deliberately
  //    NO `airfield_id`, so no airfield scan ever treats it as a flyable field.
  const flags = { hangar_interior: true, is_interior: true, hangar_ramp: ramp };
  const exists = await query('SELECT id FROM zones WHERE id=$1', [interiorId]);
  if (exists.rows.length) {
    // Zone already built — re-assert the description so prose edits (e.g. the
    // taxiway/runway view) land on existing hangars without a rebuild.
    await query('UPDATE zones SET description=$1 WHERE id=$2', [interiorDesc(afName), interiorId]);
    console.log(`UPDATED ${interiorId} description`);
  } else {
    await query(
      `INSERT INTO zones (id, name, description, danger_rating, pvp_enabled, is_safe_zone, exits, flags, map_id, grid_x, grid_y, grid_z)
       VALUES ($1,$2,$3,'safe',0,1,$4,$5,$6,0,0,0)`,
      [interiorId, `${afName} Hangar`, interiorDesc(afName),
       JSON.stringify({ out: ramp }), JSON.stringify(flags), mapId]
    );
    console.log(`CREATED ${interiorId} (${afName} Hangar) on ${mapId}`);
  }

  // 3. The ops-desk chair (pilots sit here) + a flavour workbench.
  await query(
    `INSERT INTO furniture (id, zone_id, name, description, flags, object_type)
     VALUES ($1,$2,$3,$4,$5,'furniture') ON CONFLICT (id) DO NOTHING`,
    [chairId, interiorId, DESK_CHAIR, 'A wheeled ops chair, one armrest wrapped in duct tape, parked at a desk of flight monitors.',
     JSON.stringify({ interactions: ['sit'] })]
  );
  await query(
    `INSERT INTO furniture (id, zone_id, name, description, flags, object_type)
     VALUES ($1,$2,$3,$4,$5,'fixture') ON CONFLICT (id) DO NOTHING`,
    [benchId, interiorId, 'a cluttered workbench', 'A steel workbench strewn with torque wrenches, a part-gutted avionics box and a coffee ring or ten.',
     JSON.stringify({})]
  );

  // 4. Wire the ramp → hangar (re-assert every run; never clobber airfield flags).
  rampFlags.hangar_interior_zone = interiorId;
  rampExits.in = interiorId;
  await query('UPDATE zones SET flags=$1, exits=$2 WHERE id=$3',
    [JSON.stringify(rampFlags), JSON.stringify(rampExits), ramp]);

  // 5. Move a staffed pilot inside so they start at the desk (syncPilots keeps them
  //    seated on shift; sitting posture is a runtime concern, set by the plugin).
  if (pilot) {
    const upd = await query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [interiorId, pilot]);
    console.log(`  pilot ${pilot} → ${interiorId}${upd.rowCount ? '' : ' (not found — seed pilots first)'}`);
  }
}

console.log('\nWalk-in hangars seeded. Restart the server (plugin code changed too), then `look` at any airfield and `in` to the hangar.');
process.exit(0);
