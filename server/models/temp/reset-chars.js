import { fileURLToPath } from 'url';
import { query } from '../db.js';
import { ensureTunables } from '../../engine/tunables.js';
import { startingIp } from '../../engine/ip.js';

// One-time character reset for the combat rework.
// Zeros the new stat columns, clears skill rows, restores HP to max, and grants
// each character a fresh pool of IP — enough to raise every stat to the baseline
// target via `raise`, mirroring what a newly-registered survivor receives. (The
// wipe left them at 0 stats, so this is what they spend to rebuild.)
// Old stat_str/agi/int/wil/end/cha columns are left alone (dropped at end of rollout).
// Guard: only runs when invoked directly (npm run db:reset-chars).
async function resetChars() {
  await ensureTunables();
  // Stats reset to 0, so bonus_xp is just startingIp (no baseline stats to cover).
  const bonusXp = startingIp();
  const { rowCount } = await query(`
    UPDATE players
    SET stat_brawn     = 0,
        stat_reflexes  = 0,
        stat_endurance = 0,
        stat_brains    = 0,
        stat_cool      = 0,
        bonus_xp       = $1,
        hp             = hp_max
    WHERE role != 'admin'
  `, [bonusXp]);
  console.log(`✓ Reset stats/hp and granted ${bonusXp} XP to ${rowCount} player(s)`);

  const { rowCount: skillCount } = await query(`
    DELETE FROM player_skills ps
    USING players p
    WHERE ps.player_id = p.id AND p.role != 'admin'
  `);
  console.log(`✓ Cleared ${skillCount} player_skill row(s)`);

  console.log('✅ Character reset complete.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  resetChars().catch(e => { console.error(e); process.exit(1); });
}
