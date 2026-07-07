// One-shot audit: report per-player XP composition on whatever DB is targeted.
// Total XP (as the engine computes it) = SUM(player_skills.ip) + bonus_xp.
// The user's intent: Total XP should just be SUM(ip); bonus_xp is the starting
// stat-buy grant leaking into the XP display. This flags the drift.
import { query } from '../server/models/db.js';

const { rows } = await query(`
  SELECT p.handle,
         COALESCE(p.bonus_xp, 0) AS bonus_xp,
         COALESCE((SELECT SUM(ip) FROM player_skills WHERE player_id = p.id), 0) AS skill_ip,
         p.created_at
  FROM players p
  ORDER BY (COALESCE(p.bonus_xp,0) +
            COALESCE((SELECT SUM(ip) FROM player_skills WHERE player_id = p.id),0)) DESC
`);

let boosted = 0;
console.log('handle'.padEnd(20), 'total'.padStart(8), 'skillIP'.padStart(8), 'bonusXP'.padStart(8));
console.log('-'.repeat(48));
for (const r of rows) {
  const skill = Number(r.skill_ip), bonus = Number(r.bonus_xp);
  const total = skill + bonus;
  if (bonus > 0) boosted++;
  console.log(String(r.handle).padEnd(20), String(total).padStart(8), String(skill).padStart(8), String(bonus).padStart(8));
}
console.log('-'.repeat(48));
console.log(`${rows.length} players, ${boosted} carrying bonus_xp (starting-grant boost).`);
process.exit(0);
