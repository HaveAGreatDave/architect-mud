// One-shot: seed a single test home-cargo-drop at the Slagworks airstrip. Run
// after `npm run db:schema`:
//   node scripts/seed-cargo-drop.js
// Idempotent — keyed by a stable id, skipped if already present.
import { query } from '../server/models/db.js';

await query(
  `INSERT INTO cargo_drops (id, label, weight_kg, reward, origin_zone, status, created_at)
   VALUES ($1, $2, $3, $4, $5, 'waiting', $6)
   ON CONFLICT (id) DO NOTHING`,
  ['cargo_test_slagworks', 'A sealed freight pallet', 60, 200, 'zone_slag_gate', Math.floor(Date.now() / 1000)]
);

console.log('[seed-cargo-drop] Test cargo drop seeded at zone_slag_gate (Slagworks Strip).');
process.exit(0);
