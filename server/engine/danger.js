// Inferred zone danger — replaces the authored danger_rating column.
//
// Danger is derived from what actually spawns in a zone (zone_spawns × enemy
// stats), so the map can't drift from the content the way a hand-set rating
// did. Precedence in zoneDanger():
//   1. `danger` tag override (hazard-flavor zones with no spawn rows)
//   2. sanctuary ⇒ 'safe'
//   3. cached inference (zone._dangerInferred, computed in world.js from
//      world.spawnTimers at boot and on every spawn edit)
//   4. 'safe' (no spawns, no override)
//
// Pure functions over plain objects only — NO world.js import. world.js sits
// above this module (it computes and writes the _dangerInferred cache);
// districts.js and describe.js import from here freely without cycles.
import { tagValue } from './tags.js';
import { isSanctuary, getZoneRadiation } from './zone-tags.js';

export const DANGER_RANK = { safe: 0, low: 1, medium: 2, high: 3, lethal: 4 };
const RANK_NAME = ['safe', 'low', 'medium', 'high', 'lethal'];

// Threat score = staying power + hurting power. Calibrated against live
// content (2026-07): slag rat ≈ 20, wire jackal ≈ 42, custodian enforcer ≈ 67,
// SPECTER trooper ≈ 126, arbiter-class unit ≈ 220. Re-run the calibration
// sweep (scratchpad danger-calibration.mjs pattern) if enemy stats rebalance.
const WEAPON_WEIGHT = 8;
const T_LOW = 60;     // below: low (jackals, scavengers, lurkers)
const T_MEDIUM = 100; // below: medium (enforcers, rad mutants, tar-pit horrors)
const T_HIGH = 180;   // below: high; at/above: lethal (arbiters, horrors)

// Environmental hazard floor: heavy radiation makes a zone dangerous no matter
// how weak its spawns are (the Redline is lethal because of the air, not the
// mutants). Thresholds on the 0-100 radiation tag scale.
function radiationFloor(zone) {
  const rad = getZoneRadiation(zone);
  if (rad >= 40) return DANGER_RANK.lethal;
  if (rad >= 25) return DANGER_RANK.high;
  if (rad >= 10) return DANGER_RANK.medium;
  return DANGER_RANK.safe;
}

export function enemyThreat(template) {
  const hp = Number(template?.hp_max) || 0;
  const weapons = Array.isArray(template?.weapon) ? template.weapon : [];
  const avgDmg = weapons.reduce((best, w) => {
    const avg = ((Number(w?.min) || 0) + (Number(w?.max) || 0)) / 2;
    return Math.max(best, avg);
  }, 0);
  return hp + WEAPON_WEIGHT * avgDmg;
}

export function bucketThreat(score) {
  if (score < T_LOW) return 'low';
  if (score < T_MEDIUM) return 'medium';
  if (score < T_HIGH) return 'high';
  return 'lethal';
}

const VALID = new Set(Object.keys(DANGER_RANK));

export function zoneDanger(zone) {
  if (!zone) return 'safe';
  const override = tagValue(zone, 'danger');
  if (VALID.has(override)) return override;
  if (isSanctuary(zone)) return 'safe';
  const inferred = VALID.has(zone._dangerInferred) ? zone._dangerInferred : 'safe';
  return RANK_NAME[Math.max(DANGER_RANK[inferred], radiationFloor(zone))];
}
