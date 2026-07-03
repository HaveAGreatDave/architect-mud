import { query } from '../models/db.js';
import { awardIp } from './ip.js';
import { sendToPlayer } from './messaging.js';

export const SKILLS = {
  brawling:    { id:'brawling',    name:'Brawling',    category:'combat',   stats:['stat_brawn','stat_reflexes'], desc:'Fists, boots, and improvised cudgels. The art of hurting things up close with whatever God gave you.' },
  bladed:      { id:'bladed',      name:'Bladed',      category:'combat',   stats:['stat_reflexes','stat_brawn'], desc:'Knives, machetes, and anything with an edge. Quiet, personal, and very hard to wash out of fabric.' },
  firearms:    { id:'firearms',    name:'Firearms',    category:'combat',   stats:['stat_reflexes','stat_cool'], desc:'Pistols, rifles, and whatever still chambers a round. Pointing the loud end at the problem.' },
  explosives:  { id:'explosives',  name:'Explosives',  category:'combat',   stats:['stat_brains'], desc:'Grenades, charges, and homemade bad ideas. Solves problems and several adjacent ones at once.' },
  dodge:       { id:'dodge',       name:'Dodge',       category:'combat',   stats:['stat_reflexes','stat_cool'], desc:'Not being where the bad thing is. Your single most important survival habit.' },
  scavenging:  { id:'scavenging',  name:'Scavenging',  category:'survival', stats:['stat_brains','stat_reflexes'], desc:'Finding the good stuff in the garbage. One survivor’s trash is your entire economy.' },
  cooking:     { id:'cooking',     name:'Cooking',     category:'survival', stats:['stat_brains'], desc:'Turning questionable ingredients into food that heals instead of kills. Usually.' },
  medicine:    { id:'medicine',    name:'Medicine',    category:'survival', stats:['stat_brains','stat_reflexes'], desc:'Patching wounds, treating sickness, and pretending you went to med school.' },
  navigation:  { id:'navigation',  name:'Navigation',  category:'survival', stats:['stat_brains','stat_reflexes'], desc:'Knowing where you are and where the exits went. Keeps you from dying lost.' },
  butchering:  { id:'butchering',  name:'Butchering',  category:'survival', stats:['stat_endurance','stat_cool'], desc:'Carving usable meat and parts off the dead. Strong stomach required, gloves optional.' },
  fishing:     { id:'fishing',     name:'Fishing',     category:'survival', stats:['stat_reflexes','stat_cool'], desc:'Coaxing something edible — or something with teeth — out of poisoned water. Patience with a hook on the end.' },
  hacking:     { id:'hacking',     name:'Hacking',     category:'tech',     stats:['stat_brains'], desc:'Talking computers into betraying their owners. Locks, terminals, and ATMs all listen eventually.' },
  electronics: { id:'electronics', name:'Electronics', category:'tech',     stats:['stat_brains'], desc:'Wiring, circuits, and salvaged tech. Making dead gadgets twitch back to life.' },
  fabrication: { id:'fabrication', name:'Fabrication', category:'tech',     stats:['stat_brains'], desc:'Crafting and repairing gear from raw parts. The backbone of building anything worth having.' },
  chemistry:   { id:'chemistry',   name:'Chemistry',   category:'tech',     stats:['stat_brains','stat_reflexes'], desc:'Cooking compounds and synthesizing drugs. Steady hands and a working knowledge of what not to mix. A good education, or a lot of scars.' },
  drone_ops:   { id:'drone_ops',   name:'Drone Ops',   category:'tech',     stats:['stat_reflexes','stat_brains'], desc:'Piloting and commanding drones. Doing your dirty work from a safe-ish distance.' },
  security:    { id:'security',    name:'Security',    category:'tech',     stats:['stat_brains','stat_reflexes'], desc:'Locks, alarms, and surveillance — cracking theirs and trusting none of your own.' },
  persuasion:  { id:'persuasion',  name:'Persuasion',  category:'social',   stats:['stat_cool','stat_brains'], desc:'Getting people to do what you want with words instead of violence. The expensive way is cheaper here.' },
  intimidate:  { id:'intimidate',  name:'Intimidate',  category:'social',   stats:['stat_brawn','stat_cool'], desc:'Getting people to do what you want by promising violence. Body language as a weapon.' },
  deception:   { id:'deception',   name:'Deception',   category:'social',   stats:['stat_cool','stat_brains'], desc:'Lying convincingly. Disguises, cons, and a straight face under pressure.' },
  faction_lore:{ id:'faction_lore',name:'Faction Lore',category:'social',   stats:['stat_brains'], desc:'Knowing who runs what, who hates whom, and which favors are worth calling in.' },
  architect_interface: { id:'architect_interface', name:'Architect Interface', category:'arcane', stats:['stat_brains','stat_cool'], desc:'Communing with the Architect’s systems. Touching the machine-god’s thoughts without losing your own.' },
};

// Floored average of a skill's governing stats — the bonus that stacks on top
// of the IP-derived level to form total (effective) skill.
export function skillStatBonus(player, skillId) {
  const skill = SKILLS[skillId];
  if (!skill) return 0;
  return Math.floor(skill.stats.reduce((sum, s) => sum + (player[s] || 0), 0) / skill.stats.length);
}

// skill level (floor(ip/100), 0–10) + floored average of governing stats. Can exceed 10.
export async function effectiveSkill(player, skillId) {
  const skill = SKILLS[skillId];
  if (!skill) return 0;
  const { rows } = await query(
    'SELECT ip FROM player_skills WHERE player_id=$1 AND skill_id=$2',
    [player.id, skillId]
  );
  const level = Math.floor((rows[0]?.ip || 0) / 100);
  return level + skillStatBonus(player, skillId);
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
