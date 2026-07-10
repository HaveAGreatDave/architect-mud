// One-shot: move the legacy zone property columns into the flags tag bag,
// ahead of dropping the columns (zone redesign Phase 4).
//
//   node scripts/migrate-zone-columns-to-tags.mjs                        (local)
//   node --env-file=.env.prod scripts/migrate-zone-columns-to-tags.mjs   (prod)
//   add --dry-run to report without writing
//
// Per zone row (idempotent — pure function of the current row):
//   • flags bag normalized (null/false/'' junk values stripped — same rule as
//     normalize-zone-flags.mjs)
//   • radiation_level → flags.radiation, RESCALED ×10 (legacy values were 1–5
//     against a 0–100 formula, so entry gain floor(v×0.1) was always 0 —
//     radiation has been cosmetic; after this it bites). Values already ≥10 are
//     assumed rescaled and carried as-is. An existing flags.radiation wins.
//   • is_safe_zone → DROPPED (user decision 2026-07-09): the column was a
//     builder-default sleep marker on 61% of the world, not sanctuary. Sleep
//     now requires an owned apartment or a deliberately-tagged sanctuary zone.
//     The list of former safe zones is printed for sanctuary curation.
//   • pvp_enabled → DROPPED (was display-only; the law is protection-substrate).
//   • danger_rating → dropped; danger is inferred from spawns + radiation
//     floor. Preserved as flags.danger ONLY for authored high/lethal zones
//     with no spawn rows and no radiation ≥25 (calibration 2026-07: zero such
//     zones — the rule is a safety net). Zones whose authored rating was ≥high
//     but infer ≤low are printed for review, not auto-preserved.
import { query } from '../server/models/db.js';
import { enemyThreat, bucketThreat, DANGER_RANK } from '../server/engine/danger.js';

const dryRun = process.argv.includes('--dry-run');
const isJunk = (v) => v === null || v === false || v === '';

const { rows: zones } = await query('SELECT id, name, danger_rating, pvp_enabled, radiation_level, is_safe_zone, flags FROM zones ORDER BY id');
const { rows: spawns } = await query('SELECT zs.zone_id, e.* FROM zone_spawns zs JOIN enemies e ON e.id = zs.enemy_id');
const maxThreat = new Map();
for (const s of spawns) {
  maxThreat.set(s.zone_id, Math.max(maxThreat.get(s.zone_id) ?? -1, enemyThreat(s)));
}

const formerSafe = [], dangerReview = [], dangerPreserved = [], pvpDropped = [];
let touched = 0;
for (const z of zones) {
  const flags = { ...(z.flags || {}) };
  for (const [k, v] of Object.entries(flags)) { if (isJunk(v)) delete flags[k]; }

  // radiation ×10 rescale
  if (!('radiation' in flags) && (z.radiation_level || 0) > 0) {
    const v = z.radiation_level;
    flags.radiation = v < 10 ? Math.min(100, v * 10) : Math.min(100, v);
  }

  if (z.is_safe_zone) formerSafe.push(`${z.id} — ${z.name}`);
  if (z.pvp_enabled) pvpDropped.push(z.id);

  // danger preservation / review
  const authored = z.danger_rating || 'safe';
  const authoredRank = DANGER_RANK[authored] ?? DANGER_RANK.medium; // invalid values (e.g. 'caution') → medium for comparison only
  const spawnRank = maxThreat.has(z.id) ? DANGER_RANK[bucketThreat(maxThreat.get(z.id))] : DANGER_RANK.safe;
  const rad = flags.radiation || 0;
  const radRank = rad >= 40 ? 4 : rad >= 25 ? 3 : rad >= 10 ? 2 : 0;
  const inferredRank = Math.max(spawnRank, radRank);
  if (!('danger' in flags)) {
    if (authoredRank >= DANGER_RANK.high && !maxThreat.has(z.id) && radRank < authoredRank) {
      flags.danger = authored;
      dangerPreserved.push(`${z.id} [${authored}]`);
    } else if (authoredRank >= DANGER_RANK.high && inferredRank <= DANGER_RANK.low) {
      dangerReview.push(`${z.id} authored=${authored} infers=${['safe','low','medium','high','lethal'][inferredRank]} (spawns too weak — beef spawns or add a danger tag)`);
    }
  }

  const changed = JSON.stringify(flags) !== JSON.stringify(z.flags || {});
  if (changed) {
    touched++;
    if (!dryRun) await query('UPDATE zones SET flags=$1 WHERE id=$2', [JSON.stringify(flags), z.id]);
  }
}

console.log(`${dryRun ? '[dry-run] would update' : 'updated'} ${touched}/${zones.length} zone flag bags\n`);
console.log(`— pvp_enabled dropped on ${pvpDropped.length} zone(s) (was display-only)`);
console.log(`\n— danger preserved as flags.danger (${dangerPreserved.length}):`);
dangerPreserved.forEach(l => console.log('  ' + l));
console.log(`\n— danger REVIEW list (${dangerReview.length}) — authored ≥high but infers ≤low:`);
dangerReview.forEach(l => console.log('  ' + l));
console.log(`\n— former is_safe_zone zones (${formerSafe.length}) — sleep-safety REMOVED; curate sanctuary tags from these:`);
formerSafe.forEach(l => console.log('  ' + l));
process.exit(0);
