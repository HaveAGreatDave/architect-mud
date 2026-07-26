import { query } from '../models/db.js';
import { ensureTunables, getTunable } from './tunables.js';
import { emit, on } from './events.js';

// Per-skill IP cap. Skill level = floor(ip/100), so 1000 IP == level 10.
const SKILL_IP_CAP = 1000;

// Per-player skill-IP cache. Combat re-read player_skills (and stat_brains) on
// every swing — effectiveSkill for the attack, again for the dodge, again in
// awardIp — none of which changes mid-fight. One JOIN load per player per TTL
// carries all skills plus the stat_brains the award odds need; awardIp/
// grantSkillIp write through so the cache never lags its own mutations. The TTL
// bounds staleness from the out-of-band writers (prologue's chargen grant busts
// explicitly; temp scripts and char-delete run offline). `exists:false` keeps
// the FK guard: a transient/corpse actor or the regress fake player has no
// players row, and awarding it would violate the player_skills FK.
const SKILL_CACHE_TTL_MS = 30_000;
const _skillCache = new Map(); // playerId -> { at, exists, brains, ips: Map(skill_id -> ip) }
on('player.logout', ({ id }) => { if (id) _skillCache.delete(id); });

async function loadSkillCache(playerId) {
  const c = _skillCache.get(playerId);
  if (c && Date.now() - c.at < SKILL_CACHE_TTL_MS) return c;
  const { rows } = await query(
    `SELECT p.stat_brains, ps.skill_id, ps.ip
       FROM players p LEFT JOIN player_skills ps ON ps.player_id = p.id
      WHERE p.id = $1`,
    [playerId]
  );
  const entry = rows.length
    ? { at: Date.now(), exists: true, brains: Number(rows[0].stat_brains) || 1,
        ips: new Map(rows.filter(r => r.skill_id).map(r => [r.skill_id, r.ip || 0])) }
    : { at: Date.now(), exists: false, brains: 1, ips: new Map() };
  _skillCache.set(playerId, entry);
  return entry;
}

// Cached read of a player's IP in one skill (0 when untrained).
export async function getSkillIp(playerId, skillId) {
  return (await loadSkillCache(playerId)).ips.get(skillId) ?? 0;
}

// For callers that mutate player_skills outside this module (e.g. prologue's
// chargen grant) — bust so the next read reloads.
export function invalidateSkillCache(playerId) {
  if (playerId) _skillCache.delete(playerId);
  else _skillCache.clear();
}

// Base HP every survivor has, before endurance scaling.
export const BASE_HP_MAX = 40;
// Max HP = base + 2 per point of endurance. END 10 -> 60, END 1 -> 42.
export function maxHpForEndurance(endurance) {
  return BASE_HP_MAX + 2 * (Number(endurance) || 0);
}

// Roll for an IP award on a skill check (success OR failure). Chance is highest
// when the margin is ≈ 0 (barely won *or* barely lost) and falls off as the
// absolute margin grows — you learn most at the edge of your ability, in either
// direction. On a hit, award exactly 1 IP to the skill. 1 IP silently = 1 XP.
// Returns { awarded, leveledUp } — leveledUp is true when this point crossed a
// 100-IP (skill-level) boundary.
export async function awardIp(playerId, skillId, margin = 0) {
  await ensureTunables();
  const cache = await loadSkillCache(playerId);
  // No such player (e.g. a transient/corpse actor, or the regress harness's fake
  // player): skip silently — the player_skills insert would violate the FK.
  if (!cache.exists) return { awarded: 0, leveledUp: false };
  const current = cache.ips.get(skillId) ?? 0;
  if (current >= SKILL_IP_CAP) return { awarded: 0, leveledUp: false };

  // Brains speeds skill-ups: +ip_brains_bonus_per_point per brain above 1, so at
  // the default 0.05 a survivor with 21 brains has double the per-roll odds, and
  // 1 brain (the starting value) gets the unmodified base rate.
  const perPoint = getTunable('ip_brains_bonus_per_point', 0.05);
  const brainsMult = 1 + Math.max(0, cache.brains - 1) * perPoint;

  const base = getTunable('ip_award_base_chance', 1.0);
  const scale = getTunable('ip_award_margin_scale', 2.0);
  const chance = (base / (1 + Math.abs(margin) * scale)) * brainsMult;
  const roll = Math.random();
  // Fire-and-forget notification so the debug plugin can reveal the hidden roll.
  emit('ip.roll', { playerId, skillId, margin, chance, roll, hit: roll < chance });
  if (roll >= chance) return { awarded: 0, leveledUp: false };

  const newIp = current + 1;
  // Upsert, not a presence-branched INSERT: a stale cache miss (row created by
  // an out-of-band writer inside the TTL) must bump, never PK-collide.
  await query(
    `INSERT INTO player_skills (player_id, skill_id, ip) VALUES ($1,$2,1)
     ON CONFLICT (player_id, skill_id) DO UPDATE SET ip = player_skills.ip + 1`,
    [playerId, skillId]
  );
  cache.ips.set(skillId, newIp);
  const leveledUp = Math.floor(newIp / 100) > Math.floor(current / 100);
  return { awarded: 1, leveledUp };
}

// Deterministically grant a fixed number of IP to a skill — for EARNED, structured rewards
// (a graded landing, a completed contract) as opposed to the probabilistic per-use roll above.
// Respects the same per-skill cap. Returns { awarded, leveledUp, level } — awarded is the IP
// actually added after the cap (0 if already maxed).
export async function grantSkillIp(playerId, skillId, amount) {
  const amt = Math.max(0, Math.round(amount || 0));
  if (!amt) return { awarded: 0, leveledUp: false, level: 0 };
  const cache = await loadSkillCache(playerId);
  if (!cache.exists) return { awarded: 0, leveledUp: false, level: 0 };
  const current = cache.ips.get(skillId) ?? 0;
  const gained = Math.min(SKILL_IP_CAP, current + amt) - current;
  if (gained <= 0) return { awarded: 0, leveledUp: false, level: Math.floor(current / 100) };
  await query(
    `INSERT INTO player_skills (player_id, skill_id, ip) VALUES ($1,$2,$3)
     ON CONFLICT (player_id, skill_id) DO UPDATE SET ip = player_skills.ip + $3`,
    [playerId, skillId, gained]
  );
  cache.ips.set(skillId, current + gained);
  const level = Math.floor((current + gained) / 100);
  return { awarded: gained, leveledUp: level > Math.floor(current / 100), level };
}

// Cost to raise a stat by one point. Flat for now: 100 XP = 1 stat point.
export function statCost(currentValue) {
  return getTunable('stat_cost_flat', 100);
}

export const RAISABLE_STATS = ['brawn', 'reflexes', 'endurance', 'brains', 'cool', 'senses'];

// Every survivor starts with chargen's free +1 to all six stats (the prologue
// holosign gift). Those six points cost no XP, so the "spent" side always refunds
// the six cheapest levels — universally, for everyone, not keyed off any per-row
// column. Six free points on the flat curve is exactly 6 × statCost(0) = 600 XP.
export const STARTING_FREE_STAT_POINTS = RAISABLE_STATS.length;

// Total XP cost to reach a player's current stat levels, on the current curve.
// This is the implicit "spent" side of Net XP — it grows when a stat is raised.
export function statSpent(p) {
  let total = 0;
  for (const stat of RAISABLE_STATS) {
    const cur = p[`stat_${stat}`] || 0;
    for (let v = 0; v < cur; v++) total += statCost(v);
  }
  // Refund the free starting stats so they touch neither Net nor Total XP. Clamp
  // at 0 so a survivor who hasn't raised past the free floor never goes negative.
  return Math.max(0, total - STARTING_FREE_STAT_POINTS * statCost(0));
}

// Lifetime XP is never stored: it aggregates SUM(player_skills.ip) (which only
// ever grows) plus players.bonus_xp (starting XP + non-skill grants).
export async function getTotalXp(playerId) {
  const { rows } = await query(
    `SELECT COALESCE(bonus_xp, 0) AS bonus_xp,
            COALESCE((SELECT SUM(ip) FROM player_skills WHERE player_id=$1), 0) AS skill_ip
     FROM players WHERE id=$1`,
    [playerId]
  );
  if (!rows.length) return 0;
  return Math.max(0, Number(rows[0].skill_ip) + Number(rows[0].bonus_xp));
}

// Net XP = Total XP − statSpent, floored at 0. Returns { total, net }. Net is what
// the player spends on stats; a retune of the cost curve can push the raw figure
// below zero, but XP never displays or spends as a debt — the floor is the single
// source of truth for that, so every caller inherits it.
export async function getNetXp(playerId) {
  await ensureTunables();
  const { rows } = await query(
    `SELECT stat_brawn, stat_reflexes, stat_endurance, stat_brains, stat_cool, stat_senses,
            COALESCE(bonus_xp, 0) AS bonus_xp,
            COALESCE((SELECT SUM(ip) FROM player_skills WHERE player_id=$1), 0) AS skill_ip
     FROM players WHERE id=$1`,
    [playerId]
  );
  if (!rows.length) return { total: 0, net: 0 };
  const p = rows[0];
  const total = Math.max(0, Number(p.skill_ip) + Number(p.bonus_xp));
  return { total, net: Math.max(0, total - statSpent(p)) };
}

// Grant XP from a non-skill source (quests, etc.). Always an integer.
export async function grantXp(playerId, amount) {
  const amt = Math.round(amount);
  if (!amt) return;
  await query('UPDATE players SET bonus_xp = COALESCE(bonus_xp, 0) + $1 WHERE id=$2', [amt, playerId]);
}

// Total IP/XP needed to raise every stat from 0 to `target`, on the current cost
// curve. Granted (into bonus_xp) at character creation so a fresh survivor can buy
// themselves up to a baseline via `raise`. Reads the curve through statCost, so it
// stays correct if the tunables are retuned. Caller must ensureTunables() first.
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
    `SELECT stat_brawn, stat_reflexes, stat_endurance, stat_brains, stat_cool, stat_senses,
            COALESCE(bonus_xp, 0) AS bonus_xp,
            COALESCE((SELECT SUM(ip) FROM player_skills WHERE player_id=$1), 0) AS skill_ip
     FROM players WHERE id=$1`,
    [playerId]
  );
  if (!rows.length) return { error: 'Player not found.' };

  const p = rows[0];
  const current = p[col] || 0;
  const cost = statCost(current);
  const net = Math.max(0, (Number(p.skill_ip) + Number(p.bonus_xp)) - statSpent(p));

  if (net < cost) {
    return { error: `Not enough XP. Need ${cost} XP to raise ${statName} to ${current + 1} — you have ${Math.floor(net)}.` };
  }

  // Spending is implicit: raising the stat increases statSpent by `cost`, which
  // lowers Net XP. No pool is decremented; Total XP never changes.
  await query(`UPDATE players SET ${col} = ${col} + 1 WHERE id=$1`, [playerId]);

  const result = { stat: statName, col, from: current, to: current + 1, cost, net_remaining: net - cost };

  // Endurance drives max HP; raising it lifts the cap and heals the +2 delta.
  if (statName === 'endurance') {
    const newHpMax = maxHpForEndurance(current + 1);
    const { rows: hpRows } = await query(
      `UPDATE players SET hp_max=$1, hp=LEAST(hp+2,$1) WHERE id=$2 RETURNING hp, hp_max`,
      [newHpMax, playerId]
    );
    result.hp = hpRows[0].hp;
    result.hp_max = hpRows[0].hp_max;
  }

  return result;
}
