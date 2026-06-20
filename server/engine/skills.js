import { query } from '../models/db.js';

export const SKILLS = {
  brawling:    { id:'brawling',    name:'Brawling',    category:'combat',   stat:'stat_str' },
  bladed:      { id:'bladed',      name:'Bladed',      category:'combat',   stat:'stat_agi' },
  firearms:    { id:'firearms',    name:'Firearms',    category:'combat',   stat:'stat_agi' },
  explosives:  { id:'explosives',  name:'Explosives',  category:'combat',   stat:'stat_int' },
  scavenging:  { id:'scavenging',  name:'Scavenging',  category:'survival', stat:'stat_int' },
  cooking:     { id:'cooking',     name:'Cooking',     category:'survival', stat:'stat_int' },
  medicine:    { id:'medicine',    name:'Medicine',    category:'survival', stat:'stat_int' },
  navigation:  { id:'navigation',  name:'Navigation',  category:'survival', stat:'stat_agi' },
  hacking:     { id:'hacking',     name:'Hacking',     category:'tech',     stat:'stat_int' },
  electronics: { id:'electronics', name:'Electronics', category:'tech',     stat:'stat_int' },
  fabrication: { id:'fabrication', name:'Fabrication', category:'tech',     stat:'stat_int' },
  drone_ops:   { id:'drone_ops',   name:'Drone Ops',   category:'tech',     stat:'stat_agi' },
  security:    { id:'security',    name:'Security',    category:'tech',     stat:'stat_agi' },
  persuasion:  { id:'persuasion',  name:'Persuasion',  category:'social',   stat:'stat_cha' },
  intimidate:  { id:'intimidate',  name:'Intimidate',  category:'social',   stat:'stat_str' },
  deception:   { id:'deception',   name:'Deception',   category:'social',   stat:'stat_cha' },
  faction_lore:{ id:'faction_lore',name:'Faction Lore',category:'social',   stat:'stat_int' },
  architect_interface: { id:'architect_interface', name:'Architect Interface', category:'arcane', stat:'stat_int' },
};

const RANK_XP = [0,100,250,500,900,1400,2100,3000,4200,5700,7500];
export function getSkillRank(xp) {
  for (let i = RANK_XP.length-1; i >= 0; i--) if (xp >= RANK_XP[i]) return i;
  return 0;
}

export async function awardSkillXp(playerId, skillId, xpAmount) {
  const { rows } = await query('SELECT * FROM player_skills WHERE player_id = $1 AND skill_id = $2', [playerId, skillId]);
  if (!rows.length) {
    await query('INSERT INTO player_skills (player_id, skill_id, rank, xp) VALUES ($1,$2,0,$3)', [playerId, skillId, xpAmount]);
    return { ranked_up: false };
  }
  const newXp = rows[0].xp + xpAmount;
  const newRank = getSkillRank(newXp);
  await query('UPDATE player_skills SET xp=$1, rank=$2 WHERE player_id=$3 AND skill_id=$4', [newXp, newRank, playerId, skillId]);
  if (newRank > rows[0].rank) return { ranked_up: true, skill: skillId, new_rank: newRank };
  return { ranked_up: false };
}

export async function getPlayerSkills(playerId) {
  const { rows } = await query('SELECT * FROM player_skills WHERE player_id = $1', [playerId]);
  const result = {};
  for (const row of rows) result[row.skill_id] = { rank: row.rank, xp: row.xp };
  return result;
}

export async function skillCheck(player, skillId, difficulty = 5) {
  const { rows } = await query('SELECT rank FROM player_skills WHERE player_id=$1 AND skill_id=$2', [player.id, skillId]);
  const rank = rows[0]?.rank || 0;
  const skill = SKILLS[skillId];
  const statBonus = skill ? Math.floor((player[skill.stat] || 5) / 2) : 0;
  const roll = Math.floor(Math.random() * 10) + 1;
  const total = roll + rank + statBonus;
  return { success: total >= difficulty, roll, total, difficulty, margin: total - difficulty };
}
