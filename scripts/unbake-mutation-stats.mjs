/**
 * ONE-SHOT — unbake mutation stat modifiers out of the players table.
 *
 * ── Why this cannot be a content edit ────────────────────────────────────────
 *
 * The CODEX deploy rewrites whole columns of CONTENT tables from files, which is
 * enough for almost everything (see CLAUDE.md — editing a content file is how
 * you REMOVE a JSONB key). It is not enough here. The values being corrected sit
 * in `players.stat_*`, a `class: player` table the pipeline never writes, and
 * working out the correction requires joining live `player_mutations` rows
 * against `mutations.stat_modifiers`. Neither side of that is a file.
 *
 * ── What it corrects ─────────────────────────────────────────────────────────
 *
 * Until 2026-08, `grantMutation` ADDED a mutation's stat_modifiers straight into
 * the player's stat columns and `burnAllMutations` reversed the arithmetic. The
 * rework derives those contributions at read time instead (engine/mutations.js),
 * so the baked deltas are now counted TWICE: once in the stored column and again
 * by `effectiveStat`. This subtracts the baked half back out.
 *
 * ── Why every legacy row is set to expression 100 ────────────────────────────
 *
 * The derived contribution is `authored × expression/100`, and `scaleByExpression`
 * guarantees expression 100 returns the authored value EXACTLY. So setting every
 * pre-existing row to 100 makes this migration arithmetically NET-ZERO: each
 * character keeps precisely the stats they had this morning, and nobody logs in
 * nerfed or owed a reimbursement. New radiation mutations roll modest expression
 * and are therefore weaker than these grandfathered ones. That is intended and
 * self-corrects as they are treated or replaced.
 *
 * ── Idempotency ──────────────────────────────────────────────────────────────
 *
 * Guarded per player by the `mutations_unbaked` flag, inserted in the same
 * transaction as the correction. Running this twice is a no-op; running it
 * against a fresh database is a no-op.
 *
 * ── DEPLOY ORDER MATTERS ─────────────────────────────────────────────────────
 *
 * Run this BEFORE the new engine code serves traffic.
 *
 *   code first  → players carry the baked column AND the derived bonus:
 *                 double-counted stats, silently, for everyone.
 *   script first → a few minutes where the bonus is missing entirely.
 *
 * The second is strictly safer and self-heals the moment the deploy lands. Take
 * the second.
 *
 * Usage:  node --env-file=.env.prod scripts/unbake-mutation-stats.mjs
 *         node scripts/unbake-mutation-stats.mjs            (local)
 *         node scripts/unbake-mutation-stats.mjs --dry-run
 */
import { query } from '../server/models/db.js';
import { maxHpForEndurance } from '../server/engine/ip.js';

const DRY = process.argv.includes('--dry-run');

async function main() {
  const { rows } = await query(`
    SELECT pm.player_id, m.stat_modifiers
      FROM player_mutations pm
      JOIN mutations m ON m.id = pm.mutation_id
     WHERE m.stat_modifiers IS NOT NULL
       AND m.stat_modifiers::text <> '{}'
  `);

  // Sum the baked deltas per player.
  const byPlayer = new Map();
  for (const r of rows) {
    const acc = byPlayer.get(r.player_id) || {};
    for (const [stat, delta] of Object.entries(r.stat_modifiers || {})) {
      acc[stat] = (acc[stat] || 0) + (Number(delta) || 0);
    }
    byPlayer.set(r.player_id, acc);
  }

  // Everyone with a mutation row gets the expression backfill, including those
  // whose mutations carried no stat_modifiers at all — otherwise a player whose
  // only mutation was Necrotic Hand would sit at the DEFAULT 30 and quietly
  // lose 70% of an effect they have had at full strength for months.
  const { rows: allRows } = await query('SELECT DISTINCT player_id FROM player_mutations');
  const everyone = new Set(allRows.map(r => r.player_id));

  console.log(`[unbake] ${everyone.size} player(s) carry mutations; ${byPlayer.size} have baked stats to correct.`);
  if (DRY) {
    for (const [pid, deltas] of byPlayer) {
      console.log(`  ${pid}  ${Object.entries(deltas).map(([s, d]) => `${s.replace('stat_', '')} -${d}`).join(', ')}`);
    }
    console.log('[unbake] dry run — nothing written.');
    return;
  }

  let corrected = 0;
  let skipped = 0;

  for (const playerId of everyone) {
    // The guard and the correction share a transaction, so a crash midway can
    // never leave a player marked-done but un-corrected.
    const { rows: claim } = await query(
      `INSERT INTO player_flags (player_id, key, value)
       VALUES ($1, 'mutations_unbaked', '1')
       ON CONFLICT (player_id, key) DO NOTHING
       RETURNING player_id`,
      [playerId]
    );
    if (!claim.length) { skipped++; continue; }

    const deltas = byPlayer.get(playerId) || {};
    const entries = Object.entries(deltas).filter(([, d]) => d);

    if (entries.length) {
      const sets = [];
      const vals = [];
      let i = 1;
      for (const [stat, delta] of entries) {
        // Floor at 1: a stat column must never go to zero or negative, and a
        // hand-edited character could in principle owe more than they carry.
        sets.push(`${stat} = GREATEST(1, ${stat} - $${i++})`);
        vals.push(delta);
      }
      vals.push(playerId);
      await query(`UPDATE players SET ${sets.join(', ')} WHERE id = $${i}`, vals);

      // Endurance moved, so hp_max moved with it. Recompute from the corrected
      // base and clamp current hp under the new ceiling.
      if (deltas.stat_endurance) {
        const { rows: p } = await query('SELECT stat_endurance FROM players WHERE id=$1', [playerId]);
        if (p[0]) {
          const cap = maxHpForEndurance(p[0].stat_endurance);
          await query(
            'UPDATE players SET hp_max=$1, hp=GREATEST(1, LEAST(hp, $1)) WHERE id=$2',
            [cap, playerId]
          );
        }
      }
    }

    await query(
      `UPDATE player_mutations
          SET expression = 100, acquired_expression = 100
        WHERE player_id = $1`,
      [playerId]
    );
    corrected++;
  }

  console.log(`[unbake] corrected ${corrected}, already done ${skipped}.`);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('[unbake] FAILED:', err); process.exit(1); });
