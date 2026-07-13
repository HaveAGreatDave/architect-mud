// One-shot data transform: move the in-world calendar to a fixed future anchor.
//
// The world's date lives in world_clock.game_date. We pin it to TARGET (the same
// anchor a fresh DB seeds to — see START_DATE in server/engine/environment.js).
// Anything stored as an absolute date rather than recomputed relative to
// game_date (today: apartments.rent_due_date) is moved by the SAME delta so it
// stays the right distance from "now" instead of reading decades out of sync.
//
// Idempotent: it computes the delta from the current game_date each run, so
// running it twice is a no-op the second time (delta 0). Safe on any DB whether
// it's currently at 2026 (never shifted) or already near the anchor.
//
//   Prod:  node --env-file=.env.prod scripts/set-calendar-date.mjs
//   Local: node scripts/set-calendar-date.mjs

import { query } from '../server/models/db.js';

const TARGET = '2076-07-13';

const cur = await query('SELECT game_date FROM world_clock WHERE id = 1');
if (!cur.rows.length) {
  console.error('✗ no world_clock row (id=1) — is the DB seeded? Nothing changed.');
  process.exit(1);
}
const from = new Date(cur.rows[0].game_date).toISOString().slice(0, 10);

// Move rent due dates by the same (TARGET − current) day delta first, while
// world_clock still holds the old date. `DATE − DATE` yields integer days in pg.
const rent = await query(
  `UPDATE apartments
      SET rent_due_date = rent_due_date + ($1::date - (SELECT game_date FROM world_clock WHERE id = 1))
    WHERE rent_due_date IS NOT NULL
    RETURNING zone_id`,
  [TARGET],
);

await query('UPDATE world_clock SET game_date = $1 WHERE id = 1', [TARGET]);

console.log(`✓ world_clock.game_date ${from} → ${TARGET}`);
console.log(`✓ shifted rent_due_date on ${rent.rows.length} apartment(s) by the same delta`);
process.exit(0);
