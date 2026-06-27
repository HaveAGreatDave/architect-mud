import { query } from '../models/db.js';
import { ensureTunables, getTunable } from './tunables.js';
import { mintIp } from './ip.js';

export const SKILLS = {
  brawling:    { id:'brawling',    name:'Brawling',    category:'combat',   stats:['stat_brawn','stat_reflexes'] },
  bladed:      { id:'bladed',      name:'Bladed',      category:'combat',   stats:['stat_reflexes','stat_brawn'] },
  firearms:    { id:'firearms',    name:'Firearms',    category:'combat',   stats:['stat_reflexes','stat_cool'] },
  explosives:  { id:'explosives',  name:'Explosives',  category:'combat',   stats:['stat_brains'] },
  dodge:       { id:'dodge',       name:'Dodge',       category:'combat',   stats:['stat_reflexes','stat_cool'] },
  scavenging:  { id:'scavenging',  name:'Scavenging',  category:'survival', stats:['stat_brains','stat_reflexes'] },
  cooking:     { id:'cooking',     name:'Cooking',     category:'survival', stats:['stat_brains'] },
  medicine:    { id:'medicine',    name:'Medicine',    category:'survival', stats:['stat_brains','stat_reflexes'] },
  navigation:  { id:'navigation',  name:'Navigation',  category:'survival', stats:['stat_brains','stat_reflexes'] },
  butchering:  { id:'butchering',  name:'Butchering',  category:'survival', stats:['stat_endurance','stat_cool'] },
  hacking:     { id:'hacking',     name:'Hacking',     category:'tech',     stats:['stat_brains'] },
  electronics: { id:'electronics', name:'Electronics', category:'tech',     stats:['stat_brains'] },
  fabrication: { id:'fabrication', name:'Fabrication', category:'tech',     stats:['stat_brains'] },
  drone_ops:   { id:'drone_ops',   name:'Drone Ops',   category:'tech',     stats:['stat_reflexes','stat_brains'] },
  security:    { id:'security',    name:'Security',    category:'tech',     stats:['stat_brains','stat_reflexes'] },
  persuasion:  { id:'persuasion',  name:'Persuasion',  category:'social',   stats:['stat_cool','stat_brains'] },
  intimidate:  { id:'intimidate',  name:'Intimidate',  category:'social',   stats:['stat_brawn','stat_cool'] },
  deception:   { id:'deception',   name:'Deception',   category:'social',   stats:['stat_cool','stat_brains'] },
  faction_lore:{ id:'faction_lore',name:'Faction Lore',category:'social',   stats:['stat_brains'] },
  architect_interface: { id:'architect_interface', name:'Architect Interface', category:'arcane', stats:['stat_brains','stat_cool'] },
};

// trained (0–10) + average of governing stats. Can exceed 10.
export async function effectiveSkill(player, skillId) {
  const skill = SKILLS[skillId];
  if (!skill) return 0;
  const { rows } = await query(
    'SELECT trained FROM player_skills WHERE player_id=$1 AND skill_id=$2',
    [player.id, skillId]
  );
  const trained = rows[0]?.trained || 0;
  const avgStat = skill.stats.reduce((sum, s) => sum + (player[s] || 0), 0) / skill.stats.length;
  return trained + avgStat;
}

export async function skillCheck(player, skillId, difficulty = 5) {
  const effective = await effectiveSkill(player, skillId);
  const roll = Math.floor(Math.random() * 10) + 1;
  const total = roll + effective;
  const margin = total - difficulty;
  return { success: total >= difficulty, roll, total, difficulty, margin };
}

// Award skill growth on successful use. Gain is highest on a barely-won check
// (margin ≈ 0) and falls off as the margin grows. Returns { trained_delta }.
export async function awardSkillUse(playerId, skillId, margin = 0) {
  await ensureTunables();
  const maxGain = getTunable('learn_max_gain', 0.05);
  const marginScale = getTunable('learn_margin_scale', 2.0);
  const gain = maxGain / (1 + Math.max(0, margin) * marginScale);

  const { rows } = await query(
    'SELECT trained FROM player_skills WHERE player_id=$1 AND skill_id=$2',
    [playerId, skillId]
  );
  const current = rows[0]?.trained ?? 0;
  if (current >= 10) return { trained_delta: 0 };

  const newTrained = Math.min(10, current + gain);
  const delta = newTrained - current;

  if (!rows.length) {
    await query(
      'INSERT INTO player_skills (player_id, skill_id, trained) VALUES ($1,$2,$3)',
      [playerId, skillId, newTrained]
    );
  } else {
    await query(
      'UPDATE player_skills SET trained=$1 WHERE player_id=$2 AND skill_id=$3',
      [newTrained, playerId, skillId]
    );
  }

  const ip_minted = await mintIp(playerId, delta);
  return { trained_delta: delta, ip_minted };
}

export async function getPlayerSkills(playerId) {
  const { rows } = await query('SELECT skill_id, trained FROM player_skills WHERE player_id=$1', [playerId]);
  const result = {};
  for (const row of rows) result[row.skill_id] = { trained: row.trained || 0 };
  return result;
}
