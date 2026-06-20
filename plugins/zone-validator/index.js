import { query } from '../../server/models/db.js';
import { world } from '../../server/engine/world.js';

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

  for (const [dir, destId] of Object.entries(exits)) {
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
      cleanedExits[dir] = destId;
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
  const { autoRepair = true } = opts;
  const zones = await fetchAllZones();
  const allZoneIds = new Set(zones.map(z => z.id));

  let totalExits = 0;
  const allIssues = [];
  let totalRepairs = 0;
  const needsManualReview = [];

  for (const zone of zones) {
    totalExits += Object.keys(zone.exits || {}).length;
    const result = await validateOne(zone, allZoneIds, autoRepair);
    allIssues.push(...result.issues);
    totalRepairs += result.repairsMade;
    if (!autoRepair && result.issues.length > 0) needsManualReview.push(zone.id);
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
    exitsScanned: Object.keys(zone.exits || {}).length,
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
