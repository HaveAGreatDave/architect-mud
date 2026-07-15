// Author a building utility room + junction box + lights as EXPORTABLE CONTENT.
//
// This is the content-authoring cousin of environment.js's runtime self-heal
// `createUtilityRoomWithJunctionBox`. The two differ in ONE crucial way:
//
//   • The runtime path (dev-panel "Auto-Resolve Power") wires the lobby→down→
//     utility exit as a `zone_exit_overrides` row — a class:'runtime' table that
//     `npm run content:export` deliberately DOES NOT export. That's correct for a
//     live-DB self-heal, but it means a utility room born that way is
//     navigationally orphaned on a fresh prod import (power still works — power_
//     zones key off zone ids, not exits — but you can't walk `down` into it).
//   • THIS path is for authored content (the zone planner, backfills). It writes
//     the `down` exit straight into the anchor's `zones.exits` column so the
//     whole thing survives export → git → prod deploy intact.
//
// Everything is keyed on deterministic ids (`zone_util_<anchor>`, `gen_<util>`,
// `furn_jbox_<util>`, `furn_light_<util>`) so re-running is a safe upsert.
//
// deps-free: takes the `query` helper so both the planner (tools/) and one-shot
// scripts (scripts/) can call it without booting the engine's env deps.

// Junction-box furniture HP — matches environment.js UTILITY_JBOX_HP so authored
// boxes are as damageable as runtime-retrofitted ones.
const UTILITY_JBOX_HP = 1200;
// Default junction-box throughput (W) — matches installGenerator's junction_box
// default: enough for a multi-room building's lights.
const JB_CAPACITY_KW = 5000;

// BFS the interior network reachable from `startId` (mirrors environment.js
// getBuildingNetwork): walk exits both ways, keeping only interior/apartment
// zones. `startId` itself is always included even if it isn't interior.
async function buildingNetwork(query, startId) {
  const { rows: allZones } = await query('SELECT id, exits, flags FROM zones');
  const byId = new Map(allZones.map(z => [z.id, z]));
  const neighbors = (z) => {
    const out = [];
    for (const t of Object.values(z?.exits || {})) {
      if (Array.isArray(t)) out.push(...t); else if (t) out.push(t);
    }
    return out;
  };
  const isInterior = (z) => !!(z?.flags?.is_apartment || z?.flags?.is_interior);
  const visited = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    const zone = byId.get(id);
    const ns = new Set(neighbors(zone));
    for (const other of allZones) if (neighbors(other).includes(id)) ns.add(other.id);
    for (const nId of ns) {
      if (visited.has(nId)) continue;
      if (isInterior(byId.get(nId))) { visited.add(nId); queue.push(nId); }
    }
  }
  return [...visited];
}

// Does the building network anchored at `anchorId` already have its own power
// source (a junction box, or the city plant itself sitting in the network)?
export async function buildingHasPower(query, anchorId) {
  const network = await buildingNetwork(query, anchorId);
  const { rows } = await query(
    `SELECT 1 FROM generators WHERE zone_id = ANY($1::text[])
       AND generator_type IN ('junction_box','city_plant') LIMIT 1`,
    [network]
  );
  return rows.length > 0;
}

// Nearest online city plant to (gx,gy) by grid distance, or the first one found
// if the anchor has no grid coords. null when the world has no city plant yet.
async function nearestCityPlant(query, gx, gy) {
  const { rows: cps } = await query(
    `SELECT g.id, z.grid_x, z.grid_y FROM generators g
       LEFT JOIN zones z ON z.id = g.zone_id
      WHERE g.generator_type = 'city_plant'`
  );
  let best = null, minD = Infinity;
  for (const cp of cps) {
    if (gx != null && cp.grid_x != null) {
      const d = Math.hypot(cp.grid_x - gx, cp.grid_y - gy);
      if (d < minD) { minD = d; best = cp; }
    } else if (!best) best = cp;
  }
  return best?.id || null;
}

async function syncLighting(query, zoneId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm
       FROM furniture WHERE zone_id=$1 AND object_type='light'`, [zoneId]
  );
  await query(
    `INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count, total_lumens)
     VALUES ($1,0,0,$2,$3)
     ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2, total_lumens=$3`,
    [zoneId, rows[0]?.cnt || 0, rows[0]?.lm || 0]
  );
}

/**
 * Dig an authored below-grade utility room under `anchorId`, drop a junction box
 * + worklight in it, give the anchor an overhead light if it has none, wire a
 * junction_box generator that powers the whole building interior network, and
 * author the anchor→down→utility exit. Idempotent by deterministic id.
 *
 * @param query   the db.js query() helper
 * @param opts.anchorId       building interior zone to hang the room under (its "up")
 * @param opts.plannerId      when set, attributes created_by='zone-planner' (optional).
 *                            Deliberately NOT stamped into flags.planner: the planner's
 *                            orphan sweep keys off that flag, and utility rooms live
 *                            outside the blueprint grid, so it would false-flag them.
 * @param opts.capacityKw     junction-box throughput (default 5000)
 * @param opts.cityGeneratorId city plant to feed the box (default: nearest)
 * @returns { utilityRoomId, generatorId, anchorId } or null if anchor missing
 */
export async function authorUtilityRoom(query, { anchorId, plannerId = null, capacityKw = JB_CAPACITY_KW, cityGeneratorId = null }) {
  const { rows: aRows } = await query(
    `SELECT id, name, description, map_id, parent_zone, grid_x, grid_y, grid_z, flags, exits
       FROM zones WHERE id=$1`, [anchorId]
  );
  const anchor = aRows[0];
  if (!anchor) return null;

  const utilId = `zone_util_${anchor.id}`;
  const gx = anchor.grid_x ?? 0;
  const gy = anchor.grid_y ?? 0;
  const gz = (anchor.grid_z ?? 0) - 1;
  const worldExit = anchor.flags?.world_exit_zone || anchor.parent_zone || null;

  // 1. The utility room zone (up → anchor). Authored, exportable.
  await query(
    `INSERT INTO zones (id, name, description, map_id, parent_zone, grid_x, grid_y, grid_z, flags, exits, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET map_id=$4, parent_zone=$5, grid_x=$6, grid_y=$7, grid_z=$8, flags=$9`,
    [utilId, `${anchor.name} — Utility Room`,
     'A cramped below-grade utility room: bare concrete, sweating pipes, and the building junction box humming in its steel cabinet.',
     anchor.map_id || null, anchor.parent_zone || null, gx, gy, gz,
     JSON.stringify({ is_interior: true, utility_room: true, ...(worldExit ? { world_exit_zone: worldExit } : {}) }),
     JSON.stringify({ up: anchor.id }), plannerId ? 'zone-planner' : 'utility-room-author']
  );

  // 2. Author the anchor→down→utility exit into zones.exits (NOT a runtime
  //    override) so the wiring survives content:export. Preserve existing exits.
  const anchorExits = typeof anchor.exits === 'string'
    ? (JSON.parse(anchor.exits || '{}')) : (anchor.exits || {});
  if (anchorExits.down !== utilId) {
    anchorExits.down = utilId;
    await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(anchorExits), anchor.id]);
  }

  // 3. Worklight in the utility room (a load to power, and light to read by).
  await query(
    `INSERT INTO furniture (id,zone_id,name,description,object_type,light_type,light_on,light_on_intended,power_draw_kw,lumen_output,flags)
     VALUES ($1,$2,'Caged Worklight','A dust-caked worklight in a wire cage, throwing hard shadows.','light','overhead',1,1,0.02,900,'{}')
     ON CONFLICT (id) DO NOTHING`,
    [`furn_light_${utilId}`, utilId]
  );

  // 4. Overhead light in the anchor room — only if it has none yet (so a backfill
  //    of an already-lit shop doesn't add a second fixture).
  const { rows: existingLights } = await query(
    `SELECT 1 FROM furniture WHERE zone_id=$1 AND object_type='light' LIMIT 1`, [anchor.id]
  );
  if (!existingLights.length) {
    await query(
      `INSERT INTO furniture (id,zone_id,name,description,object_type,light_type,light_on,light_on_intended,power_draw_kw,lumen_output,flags)
       VALUES ($1,$2,'Overhead Light','A recessed ceiling fixture wired to the building panel below.','light','overhead',1,1,0.03,1200,'{}')
       ON CONFLICT (id) DO NOTHING`,
      [`furn_light_${anchor.id}`, anchor.id]
    );
  }

  // 5. Junction-box generator (deterministic id — safe to re-run).
  const genId = `gen_${utilId}`;
  const cityGenId = cityGeneratorId || await nearestCityPlant(query, gx, gy);
  await query(
    `INSERT INTO generators (id, zone_id, name, generator_type, capacity_kw, fuel_type, fuel_remaining, fuel_burn_rate, connection_range, status, city_generator_id)
     VALUES ($1,$2,$3,'junction_box',$4,NULL,0,0,0,'online',$5)
     ON CONFLICT (id) DO UPDATE SET zone_id=$2, capacity_kw=$4, city_generator_id=$5`,
    [genId, utilId, `${anchor.name} Junction Box`, capacityKw, cityGenId]
  );

  // 6. Destructible junction-box furniture linked to the generator row.
  await query(
    `INSERT INTO furniture (id,zone_id,name,description,object_type,flags,hp,hp_max)
     VALUES ($1,$2,'Junction Box',$3,'junction_box',$4,$5,$5)
     ON CONFLICT (id) DO UPDATE SET zone_id=$2, flags=$4, hp_max=$5`,
    [`furn_jbox_${utilId}`, utilId,
     'A grey steel junction cabinet of breakers and humming busbars, feeding the building. A small sealed hacking port sits below the latch.',
     JSON.stringify({ destructible: true, generator_id: genId }), UTILITY_JBOX_HP]
  );

  // 7. Power every interior zone in the building network off this box, and sync
  //    lighting_states. Network is recomputed AFTER the down-exit is authored so
  //    the fresh utility room is included.
  const network = await buildingNetwork(query, anchor.id);
  for (const zid of network) {
    const { rows: zRows } = await query('SELECT name FROM zones WHERE id=$1', [zid]);
    await query(
      `INSERT INTO power_zones (id, name, source_type, generator_id, capacity_kw, current_load_kw, status)
       VALUES ($1,$2,'junction_box',$3,$4,0,'powered')
       ON CONFLICT (id) DO UPDATE SET name=$2, source_type='junction_box', generator_id=$3, capacity_kw=$4`,
      [zid, zRows[0]?.name || zid, genId, capacityKw]
    );
    await syncLighting(query, zid);
  }

  return { utilityRoomId: utilId, generatorId: genId, anchorId: anchor.id };
}
