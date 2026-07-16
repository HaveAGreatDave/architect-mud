import { query } from '../../server/models/db.js';
import { world, deleteFurnitureWhere } from '../../server/engine/world.js';
import { allExits, neighborZoneIds, addExit } from '../../server/engine/exits.js';

async function fetchAllZones() {
  const { rows } = await query('SELECT id, exits, flags FROM zones');
  return rows;
}

function buildSummary(issues, totalRepairs) {
  const byType = {};
  for (const issue of issues) byType[issue.type] = (byType[issue.type] || 0) + 1;
  return { totalIssues: issues.length, totalRepairs, byType };
}

// Returns { issues: [...], repairsMade, cleanedExits }
// Mutates neither the DB nor memory — caller decides whether to persist.
function auditExits(zone, allZoneIds) {
  const exits = zone.exits || {};
  const issues = [];
  const seen = new Map(); // destId → first direction that claimed it
  const cleanedExits = {};

  for (const { dir, target: destId } of allExits(zone)) {
    let issueType = null;

    if (!destId) {
      issueType = 'null_dest';
    } else if (destId === zone.id && !zone.flags?.allows_self_exit) {
      issueType = 'self_loop';
    } else if (!allZoneIds.has(destId)) {
      issueType = 'missing_dest';
    } else if (seen.has(destId)) {
      issueType = 'duplicate_dest';
    }

    if (issueType) {
      issues.push({ type: issueType, dir, destId: destId || null, firstDir: issueType === 'duplicate_dest' ? seen.get(destId) : undefined });
    } else {
      seen.set(destId, dir);
      addExit(cleanedExits, dir, destId);
    }
  }

  return { issues, cleanedExits, repairsMade: issues.length };
}

async function repairZone(zoneId, cleanedExits) {
  await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(cleanedExits), zoneId]);
  // Sync in-memory world cache
  const cached = world.zones.get(zoneId);
  if (cached) cached.exits = cleanedExits;
}

async function validateOne(zone, allZoneIds, autoRepair) {
  const { issues, cleanedExits, repairsMade } = auditExits(zone, allZoneIds);

  if (autoRepair && repairsMade > 0) {
    await repairZone(zone.id, cleanedExits);
  }

  return {
    zoneId: zone.id,
    issues: issues.map(i => ({ ...i, zoneId: zone.id, repaired: autoRepair })),
    repairsMade: autoRepair ? repairsMade : 0,
  };
}

async function runFull(opts = {}) {
  try { return await _runFull(opts); }
  catch (err) { return { _error: err.message, stack: err.stack }; }
}

async function _runFull(opts = {}) {
  const { autoRepair = true } = opts;
  const zones = await fetchAllZones();
  const allZoneIds = new Set(zones.map(z => z.id));

  let totalExits = 0;
  const allIssues = [];
  let totalRepairs = 0;
  const needsManualReview = [];

  for (const zone of zones) {
    totalExits += allExits(zone).length;
    const result = await validateOne(zone, allZoneIds, autoRepair);
    allIssues.push(...result.issues);
    totalRepairs += result.repairsMade;
    if (!autoRepair && result.issues.length > 0) needsManualReview.push(zone.id);
  }

  // Check building entry zones for world-map connection issues. We query via
  // the maps table (parent_zone_id IS NOT NULL) so we catch entry zones that
  // were never flagged is_building, as well as properly flagged ones.
  // Three cases per building:
  //   1. No world_exit_zone set at all
  //   2. world_exit_zone points to a zone that doesn't exist
  //   3. world_exit_zone is valid but that exterior zone has no exit back here
  const { rows: buildings } = await query(`
    SELECT z.id, z.name, z.flags->>'world_exit_zone' AS world_exit_zone
    FROM zones z
    WHERE z.id IN (SELECT entry_zone_id FROM maps WHERE parent_zone_id IS NOT NULL AND entry_zone_id IS NOT NULL)
       OR COALESCE((z.flags->>'is_building')::boolean, false) = true
  `).catch(() => ({ rows: [] }));

  const { rows: allExteriorZones } = await query(`
    SELECT z.id, z.exits FROM zones z
    JOIN maps m ON z.map_id = m.id
    WHERE m.parent_zone_id IS NULL
  `).catch(() => ({ rows: [] }));
  const exteriorById = new Map(allExteriorZones.map(z => [z.id, z]));

  for (const b of buildings) {
    if (!b.world_exit_zone) {
      allIssues.push({ type: 'building_no_entrance', zoneId: b.id, dir: null, destId: null, repaired: false });
      needsManualReview.push(b.id);
      continue;
    }
    const extZone = exteriorById.get(b.world_exit_zone);
    if (!extZone) {
      allIssues.push({ type: 'building_no_entrance', zoneId: b.id, dir: null, destId: b.world_exit_zone, repaired: false });
      needsManualReview.push(b.id);
      continue;
    }
    const hasLink = neighborZoneIds(extZone).includes(b.id);
    if (!hasLink) {
      allIssues.push({ type: 'building_entrance_broken', zoneId: b.id, dir: null, destId: b.world_exit_zone, repaired: false });
      needsManualReview.push(b.id);
    }
  }

  // Check for buildings sitting directly on an exterior/world map. A real building
  // is its own interior map (maps.parent_zone_id set) reached through an entrance;
  // an is_building zone whose map is exterior (parent_zone_id IS NULL) renders as a
  // clickable "Buildings:" link on the open street — the Custodian-Row→"Meridian"
  // pathology. Detection-only: the fix (unset the flag, or restructure into a real
  // interior with an in/out entrance) is a human decision, so no auto-repair.
  const { rows: buildingsOnWorldMap } = await query(`
    SELECT z.id, z.name
    FROM zones z
    JOIN maps m ON z.map_id = m.id
    WHERE m.parent_zone_id IS NULL
      AND COALESCE((z.flags->>'is_building')::boolean, false) = true
  `).catch(() => ({ rows: [] }));
  for (const b of buildingsOnWorldMap) {
    allIssues.push({ type: 'building_on_world_map', zoneId: b.id, zoneName: b.name, dir: null, destId: null, repaired: false });
    if (!needsManualReview.includes(b.id)) needsManualReview.push(b.id);
  }

  // Check for orphaned records in entity tables that reference non-existent zones.
  const orphanChecks = [
    { table: 'furniture',       col: 'zone_id',       label: 'furniture' },
    { table: 'npcs',            col: 'zone_id',       label: 'npc' },
    { table: 'zone_spawns',     col: 'zone_id',       label: 'zone_spawn' },
    { table: 'generators',      col: 'zone_id',       label: 'generator' },
    { table: 'power_zones',     col: 'id',            label: 'power_zone' },
    { table: 'lighting_states', col: 'zone_id',       label: 'lighting_state' },
    { table: 'windows',         col: 'zone_interior', label: 'window' },
    { table: 'items',           col: 'zone_id',       label: 'item' },
  ];
  for (const { table, col, label } of orphanChecks) {
    const { rows: orphans } = await query(
      `SELECT ${col} AS ref_id FROM ${table}
       WHERE ${col} IS NOT NULL AND ${col} NOT IN (SELECT id FROM zones)`
    ).catch(() => ({ rows: [] }));
    for (const row of orphans) {
      allIssues.push({ type: 'orphaned_entity', entityTable: table, entityLabel: label, refId: row.ref_id, repaired: false });
      if (!needsManualReview.includes(row.ref_id)) needsManualReview.push(row.ref_id);
    }
  }

  // Check for orphaned interior rooms — two cases:
  // 1. The map exists but its parent exterior zone doesn't.
  // 2. The zone has a map_id that doesn't exist at all (map was deleted).
  // Both leave dangling zones that can't be reached or deleted normally.
  const { rows: orphanedMaps } = await query(`
    SELECT m.id AS map_id, m.parent_zone_id
    FROM maps m
    WHERE m.parent_zone_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM zones WHERE id = m.parent_zone_id)
  `).catch(() => ({ rows: [] }));

  // Zones whose map_id points to a deleted map — collect as synthetic orphaned-map entries
  const { rows: ghostMapZones } = await query(`
    SELECT DISTINCT z.map_id
    FROM zones z
    WHERE z.map_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM maps WHERE id = z.map_id)
  `).catch(() => ({ rows: [] }));
  for (const { map_id } of ghostMapZones) {
    if (!orphanedMaps.find(m => m.map_id === map_id)) {
      orphanedMaps.push({ map_id, parent_zone_id: null });
    }
  }

  for (const om of orphanedMaps) {
    const { rows: orphanedZones } = await query(
      `SELECT id, name FROM zones WHERE map_id=$1`, [om.map_id]
    ).catch(() => ({ rows: [] }));

    for (const oz of orphanedZones) {
      allIssues.push({
        type: 'orphaned_room',
        zoneId: oz.id,
        zoneName: oz.name,
        mapId: om.map_id,
        missingExterior: om.parent_zone_id,
        repaired: autoRepair,
      });
      if (autoRepair) totalRepairs++;
    }

    if (autoRepair && orphanedZones.length) {
      const zoneIds = orphanedZones.map(z => z.id);
      for (const zid of zoneIds) {
        await query('DELETE FROM npcs             WHERE zone_id=$1', [zid]);
        await deleteFurnitureWhere('DELETE FROM furniture WHERE zone_id=$1', [zid]);
        await query('DELETE FROM zone_spawns      WHERE zone_id=$1', [zid]);
        await query('DELETE FROM lighting_states  WHERE zone_id=$1', [zid]);
        await query('DELETE FROM power_zones      WHERE id=$1',                                                   [zid]);
        await query('DELETE FROM power_zones      WHERE generator_id IN (SELECT id FROM generators WHERE zone_id=$1)', [zid]);
        await query('DELETE FROM generators       WHERE zone_id=$1', [zid]);
        await query('DELETE FROM player_corpses   WHERE zone_id=$1', [zid]);
        await query('DELETE FROM world_events     WHERE zone_id=$1', [zid]);
        await query('DELETE FROM windows          WHERE zone_interior=$1 OR zone_exterior=$1', [zid]);
        await query('DELETE FROM media_cameras    WHERE zone_id=$1', [zid]);
        await query('DELETE FROM player_inventory WHERE player_id=$1', [`_ground_${zid}`]);
        await query('UPDATE media_channels SET studio_zone_id=NULL WHERE studio_zone_id=$1', [zid]);
        await query("UPDATE players SET anchor_zone='zone_start' WHERE anchor_zone=$1", [zid]);
        await query('UPDATE players SET home_zone=NULL           WHERE home_zone=$1',   [zid]);
        world.zones.delete(zid);
      }
      await query(`DELETE FROM zones WHERE map_id=$1`, [om.map_id]);
      await query('DELETE FROM maps  WHERE id=$1',     [om.map_id]);
    }
  }

  return {
    zonesScanned: zones.length,
    exitsScanned: totalExits,
    issues: allIssues,
    totalRepairs,
    needsManualReview,
    summary: buildSummary(allIssues, totalRepairs),
  };
}

async function runZone(zoneId, opts = {}) {
  const { autoRepair = true } = opts;
  const { rows } = await query('SELECT id, exits, flags FROM zones WHERE id=$1', [zoneId]);
  if (!rows.length) return { error: `Zone not found: ${zoneId}` };

  const { rows: all } = await query('SELECT id FROM zones');
  const allZoneIds = new Set(all.map(z => z.id));

  const zone = rows[0];
  const result = await validateOne(zone, allZoneIds, autoRepair);
  return {
    zonesScanned: 1,
    exitsScanned: allExits(zone).length,
    issues: result.issues,
    totalRepairs: result.repairsMade,
    needsManualReview: !autoRepair && result.issues.length > 0 ? [zoneId] : [],
    summary: buildSummary(result.issues, result.repairsMade),
  };
}

export const hooks = {
  'worldValidator.runFull': (opts) => runFull(opts),

  'worldValidator.runZone': (zoneId, opts) => runZone(zoneId, opts),

  // Silent auto-validate on zone save — logs to console if issues found/repaired.
  'zone.create': async (zoneId) => {
    const result = await runZone(zoneId, { autoRepair: true }).catch(() => null);
    if (result?.summary?.totalIssues > 0) {
      console.log(`[zone-validator] zone.create ${zoneId}: ${result.summary.totalIssues} issue(s), ${result.totalRepairs} repaired`);
    }
  },

  'zone.update': async (zoneId) => {
    const result = await runZone(zoneId, { autoRepair: true }).catch(() => null);
    if (result?.summary?.totalIssues > 0) {
      console.log(`[zone-validator] zone.update ${zoneId}: ${result.summary.totalIssues} issue(s), ${result.totalRepairs} repaired`);
    }
  },
};
