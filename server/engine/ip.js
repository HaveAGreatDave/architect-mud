import { query } from '../models/db.js';
import { ensureTunables, getTunable } from './tunables.js';

export async function mintIp(playerId, skillDelta) {
  if (skillDelta <= 0) return 0;
  await ensureTunables();
  const rate = getTunable('ip_per_skill_point', 1.0);
  const amount = skillDelta * 100 * rate;
  await query('UPDATE players SET ip = COALESCE(ip, 0) + $1 WHERE id=$2', [amount, playerId]);
  return amount;
}

// Cost to raise a stat from currentValue to currentValue+1.
export function statCost(currentValue) {
  const base = getTunable('stat_cost_base', 10);
  const exp = getTunable('stat_cost_exponent', 1.5);
  return Math.ceil(base * Math.pow(Math.max(1, currentValue), exp));
}

export const RAISABLE_STATS = ['brawn', 'reflexes', 'endurance', 'brains', 'senses', 'cool'];

// Total IP needed to raise every stat from 0 to `target`, on the current cost
// curve. Granted at character creation (and to wiped existing characters) so a
// fresh survivor can buy themselves up to a baseline via `raise`. Reads the
// curve through statCost, so it stays correct if the tunables are retuned.
// Caller must have run ensureTunables() first.
export function startingIp(target = getTunable('starting_stat_target', 3)) {
  let perStat = 0;
  for (let v = 0; v < target; v++) perStat += statCost(v);
  return perStat * RAISABLE_STATS.length;
}

export async function raiseStat(playerId, statName) {
  await ensureTunables();
  if (!RAISABLE_STATS.includes(statName)) {
    return { error: `Unknown stat. Valid stats: ${RAISABLE_STATS.join(', ')}` };
  }
  const col = `stat_${statName}`;
  const { rows } = await query(
    `SELECT ip, stat_brawn, stat_reflexes, stat_endurance, stat_brains, stat_senses, stat_cool FROM players WHERE id=$1`,
    [playerId]
  );
  if (!rows.length) return { error: 'Player not found.' };

  const p = rows[0];
  const current = p[col] || 0;
  const cost = statCost(current);
  const ip = p.ip || 0;

  if (ip < cost) {
    return { error: `Not enough IP. Need ${cost} IP to raise ${statName} to ${current + 1} — you have ${Math.floor(ip)}.` };
  }

  await query(`UPDATE players SET ip = ip - $1, ${col} = ${col} + 1 WHERE id=$2`, [cost, playerId]);
  return { stat: statName, col, from: current, to: current + 1, cost, ip_remaining: ip - cost };
}
