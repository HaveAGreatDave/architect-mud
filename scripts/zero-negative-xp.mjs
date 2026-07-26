// One-shot data transform: lift every player whose XP is negative up to exactly 0.
//
// Net XP = (SUM(player_skills.ip) + players.bonus_xp) − statSpent(stats). A stat-cost
// retune could leave that figure below zero, i.e. a survivor carrying an XP debt they
// have to grind off before a single point is spendable. That debt is REAL and visible —
// engine/ip.js deliberately applies no floor to Net or Total. This script is therefore an
// act of forgiveness, not a repair: run it when a retune's debt should be written off
// rather than ground off. It tops bonus_xp up by exactly the shortfall, leaving those
// players at 0 and everyone else untouched. Re-running it is a no-op.
//
// Run against prod:  node --env-file=.env.prod scripts/zero-negative-xp.mjs
// Run against local: node scripts/zero-negative-xp.mjs
import { query } from '../server/models/db.js';
import { ensureTunables } from '../server/engine/tunables.js';
import { statSpent } from '../server/engine/ip.js';

await ensureTunables();

const { rows } = await query(
  `SELECT id, handle, stat_brawn, stat_reflexes, stat_endurance, stat_brains, stat_cool, stat_senses,
          COALESCE(bonus_xp, 0) AS bonus_xp,
          COALESCE((SELECT SUM(ip) FROM player_skills WHERE player_id = p.id), 0) AS skill_ip
     FROM players p`
);

const negatives = [];
for (const p of rows) {
  const total = Number(p.skill_ip) + Number(p.bonus_xp);
  const net = total - statSpent(p);
  // Total below 0 is the deeper hole of the two — settle whichever is worse.
  const deficit = Math.max(0, -net, -total);
  if (deficit > 0) negatives.push({ ...p, net, total, deficit });
}

console.log(`Players scanned: ${rows.length} — negative XP: ${negatives.length}`);
for (const p of negatives) {
  await query('UPDATE players SET bonus_xp = COALESCE(bonus_xp,0) + $1 WHERE id = $2', [p.deficit, p.id]);
  console.log(`  ${p.handle}: net ${p.net} / total ${p.total} → +${p.deficit} bonus_xp → 0`);
}
console.log(`✓ Zeroed ${negatives.length} negative XP balance(s).`);
process.exit(0);
