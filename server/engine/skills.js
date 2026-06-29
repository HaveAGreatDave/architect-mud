import { query } from '../models/db.js';
import { awardIp } from './ip.js';
import { sendToPlayer } from './messaging.js';

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

// skill level (floor(ip/100), 0–10) + average of governing stats. Can exceed 10.
export async function effectiveSkill(player, skillId) {
  const skill = SKILLS[skillId];
  if (!skill) return 0;
  const { rows } = await query(
    'SELECT ip FROM player_skills WHERE player_id=$1 AND skill_id=$2',
    [player.id, skillId]
  );
  const level = Math.floor((rows[0]?.ip || 0) / 100);
  const avgStat = skill.stats.reduce((sum, s) => sum + (player[s] || 0), 0) / skill.stats.length;
  return level + avgStat;
}

// Opposed-style swing, matching combat to-hit (combat.js rollSwing): 2d8 − 2d8,
// range −14..+14, ~40% within ±2. `difficulty` plays the role of an opposing
// skill (like dodge), so close skill-vs-difficulty matchups are coin-flippy and
// big gaps decide. Success when (effective − difficulty) + swing >= 0.
function roll2d8() {
  return Math.floor(Math.random() * 8) + 1 + Math.floor(Math.random() * 8) + 1;
}

export async function skillCheck(player, skillId, difficulty = 5) {
  const effective = await effectiveSkill(player, skillId);
  const swing = roll2d8() - roll2d8();
  const margin = (effective - difficulty) + swing;
  return { success: margin >= 0, swing, effective, difficulty, margin };
}

// Roll for an IP award on a successful skill use (binary, barely-won = best odds).
// On a hit, award 1 IP to the skill and notify the player in the main pane.
export async function awardSkillUse(playerId, skillId, margin = 0) {
  const { awarded, leveledUp } = await awardIp(playerId, skillId, margin);
  if (!awarded) return { awarded: 0 };

  const name = SKILLS[skillId]?.name || skillId;
  sendToPlayer(playerId, { type: 'output', message: `<span class="ip-gain">+1 IP — ${name}</span>` });
  if (leveledUp) {
    const { rows } = await query(
      'SELECT ip FROM player_skills WHERE player_id=$1 AND skill_id=$2',
      [playerId, skillId]
    );
    const level = Math.floor((rows[0]?.ip || 0) / 100);
    sendToPlayer(playerId, { type: 'output', message: `<span class="ip-gain">Your ${name} skill rises to level ${level}.</span>` });
  }
  return { awarded };
}

export async function getPlayerSkills(playerId) {
  const { rows } = await query('SELECT skill_id, ip FROM player_skills WHERE player_id=$1', [playerId]);
  const result = {};
  for (const row of rows) result[row.skill_id] = { level: Math.floor((row.ip || 0) / 100), ip: row.ip || 0 };
  return result;
}
