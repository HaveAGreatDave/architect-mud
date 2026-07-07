// One-shot data transform: zero every player's bonus_xp.
//
// bonus_xp used to be front-loaded at character creation (startingIp() → ~1800),
// which folded a starting stat-buy allowance into displayed Total XP. Registration
// no longer grants it, and the free +1-to-all chargen stats are now refunded flat
// in statSpent(). This clears the historical grant so Total XP == earned skill IP
// for existing players. bonus_xp stays as the accumulator for future non-skill
// XP grants — it just starts at 0 for everyone.
//
// Run against prod:  node --env-file=.env.prod scripts/zero-bonus-xp.mjs
// Run against local: node scripts/zero-bonus-xp.mjs
import { query } from '../server/models/db.js';

const before = await query(
  `SELECT COUNT(*)::int AS n, COALESCE(SUM(bonus_xp),0)::int AS total
   FROM players WHERE COALESCE(bonus_xp,0) <> 0`
);
console.log(`Players with non-zero bonus_xp: ${before.rows[0].n} (sum ${before.rows[0].total})`);

const res = await query(`UPDATE players SET bonus_xp = 0 WHERE COALESCE(bonus_xp,0) <> 0`);
console.log(`✓ Zeroed bonus_xp on ${res.rowCount} player(s).`);

const after = await query(`SELECT COUNT(*)::int AS n FROM players WHERE COALESCE(bonus_xp,0) <> 0`);
console.log(`Remaining non-zero: ${after.rows[0].n}`);
process.exit(0);
