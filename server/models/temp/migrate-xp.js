/**
 * One-shot migration to the IP/XP rework.
 *
 *  - Renames player_skills.xp -> player_skills.ip (the per-skill IP pool) and
 *    converts existing skill levels from the old `trained` (0-10 REAL) metric:
 *    ip = ROUND(trained * 100), so level = floor(ip/100) preserves the old level.
 *  - Folds each player's old spendable `players.ip` into `players.bonus_xp` so
 *    Net XP after migration equals their old IP:
 *        bonus_xp = old_ip + statSpent(current stats) - SUM(skill ip)
 *    then drops the now-defunct `players.ip` column.
 *  - Audits: flags any player whose bonus_xp / skill ip is non-integer, whose
 *    Total XP isn't whole, or whose bonus_xp landed negative.
 *
 * Idempotent-ish: safe to re-run (guards on column existence). Run with:
 *   node server/models/temp/migrate-xp.js
 */
import { fileURLToPath } from 'url';
import { query } from '../db.js';
import { ensureTunables } from '../../engine/tunables.js';
import { statSpent } from '../../engine/ip.js';

async function columnExists(table, column) {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
    [table, column]
  );
  return rows.length > 0;
}

async function migrate() {
  await ensureTunables();

  // 1. player_skills: ensure an `ip` column, carrying over old skill levels.
  const skillHasIp = await columnExists('player_skills', 'ip');
  const skillHasXp = await columnExists('player_skills', 'xp');
  if (!skillHasIp && skillHasXp) {
    await query(`ALTER TABLE player_skills RENAME COLUMN xp TO ip`);
    console.log('✓ Renamed player_skills.xp -> ip');
  } else if (!skillHasIp) {
    await query(`ALTER TABLE player_skills ADD COLUMN ip INTEGER DEFAULT 0`);
    console.log('✓ Added player_skills.ip');
  }
  if (await columnExists('player_skills', 'trained')) {
    const { rowCount } = await query(`UPDATE player_skills SET ip = ROUND(trained * 100)`);
    console.log(`✓ Converted ${rowCount} skill row(s): ip = ROUND(trained * 100)`);
  }

  // 2. players: ensure bonus_xp exists.
  if (!(await columnExists('players', 'bonus_xp'))) {
    await query(`ALTER TABLE players ADD COLUMN bonus_xp INTEGER DEFAULT 0`);
    console.log('✓ Added players.bonus_xp');
  }

  // 3. Fold old spendable IP into bonus_xp, then drop players.ip.
  if (await columnExists('players', 'ip')) {
    const { rows } = await query(`
      SELECT p.id, COALESCE(p.ip,0) AS old_ip,
             p.stat_brawn, p.stat_reflexes, p.stat_endurance, p.stat_brains, p.stat_cool,
             COALESCE(s.sum_ip, 0) AS skill_ip
      FROM players p
      LEFT JOIN (SELECT player_id, SUM(ip) AS sum_ip FROM player_skills GROUP BY player_id) s
        ON s.player_id = p.id
    `);
    for (const p of rows) {
      const bonus = Math.round(Number(p.old_ip) + statSpent(p) - Number(p.skill_ip));
      await query(`UPDATE players SET bonus_xp = $1 WHERE id = $2`, [bonus, p.id]);
    }
    console.log(`✓ Set bonus_xp for ${rows.length} player(s) (Net XP preserved)`);
    await query(`ALTER TABLE players DROP COLUMN ip`);
    console.log('✓ Dropped players.ip');
  } else {
    console.log('• players.ip already gone — skipping fold/drop');
  }

  // 4. Audit. Every value should be a whole number; bonus_xp should be >= 0.
  const { rows: audit } = await query(`
    SELECT p.id, p.handle, COALESCE(p.bonus_xp,0) AS bonus_xp,
           COALESCE(s.sum_ip,0) AS skill_ip,
           COALESCE(s.bad_ip,0) AS bad_ip
    FROM players p
    LEFT JOIN (
      SELECT player_id, SUM(ip) AS sum_ip,
             COUNT(*) FILTER (WHERE ip <> ROUND(ip)) AS bad_ip
      FROM player_skills GROUP BY player_id
    ) s ON s.player_id = p.id
  `);
  const flagged = [];
  for (const a of audit) {
    const total = Number(a.skill_ip) + Number(a.bonus_xp);
    const reasons = [];
    if (Number(a.bad_ip) > 0) reasons.push(`${a.bad_ip} non-integer skill ip`);
    if (!Number.isInteger(Number(a.bonus_xp))) reasons.push('non-integer bonus_xp');
    if (!Number.isInteger(total)) reasons.push('non-integer Total XP');
    if (Number(a.bonus_xp) < 0) reasons.push(`negative bonus_xp (${a.bonus_xp})`);
    if (reasons.length) flagged.push(`  ⚠ ${a.handle} (${a.id}): ${reasons.join(', ')}`);
  }
  console.log(`\n— Audit: ${audit.length} account(s) checked —`);
  if (flagged.length) {
    console.log(`${flagged.length} deviating account(s):`);
    flagged.forEach(f => console.log(f));
  } else {
    console.log('✓ 0 deviating accounts — every Total XP is a round number.');
  }

  console.log('\n✅ XP migration complete.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
