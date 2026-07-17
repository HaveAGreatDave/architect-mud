// Drug-war plugin regression suite — run by tests/regress.js (never in production).
// The turf tick and the alignment ledger are both gone — drugwar is ambient-only
// now — so all that remains to test is the pure drug-district membership check.
import { isDrugWarZone, DRUGWAR_ZONES } from './index.js';

export default async function regress({ check }) {
  // Zone universe sanity — the drug districts are covered, spawn/hub stay neutral.
  check('drug-war zones cover all three districts',
    isDrugWarZone('zone_district_912_909') && isDrugWarZone('zone_mq_pigeon_bar') && isDrugWarZone('zone_district_908_908'));
  check('spawn + safe hub are NOT drug-war zones', !isDrugWarZone('zone_start') && !isDrugWarZone('zone_district_918_904'));
  check('drug-war zone list is non-empty', DRUGWAR_ZONES.length > 0);
}
