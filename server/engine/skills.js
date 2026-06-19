import { getDb } from '../models/migrate.js';

export const SKILLS = {
  // Combat
  brawling:    { id: 'brawling',    name: 'Brawling',    category: 'combat',   stat: 'stat_str', description: 'Unarmed and improvised weapon fighting.' },
  bladed:      { id: 'bladed',      name: 'Bladed',      category: 'combat',   stat: 'stat_agi', description: 'Knives, swords, anything with an edge.' },
  firearms:    { id: 'firearms',    name: 'Firearms',    category: 'combat',   stat: 'stat_agi', description: 'Guns. Bang.' },
  explosives:  { id: 'explosives',  name: 'Explosives',  category: 'combat',   stat: 'stat_int', description: 'Things that explode on purpose.' },
  // Survival
  scavenging:  { id: 'scavenging',  name: 'Scavenging',  category: 'survival', stat: 'stat_int', description: 'Finding useful things in useless places.' },
  cooking:     { id: 'cooking',     name: 'Cooking',     category: 'survival', stat: 'stat_int', description: 'Turning raw ingredients into food. Mostly.' },
  medicine:    { id: 'medicine',    name: 'Medicine',    category: 'survival', stat: 'stat_int', description: 'Keeping yourself and others alive.' },
  navigation:  { id: 'navigation',  name: 'Navigation',  category: 'survival', stat: 'stat_per', description: 'Finding your way. Not getting lost. Usually.' },
  // Tech
  hacking:     { id: 'hacking',     name: 'Hacking',     category: 'tech',     stat: 'stat_int', description: 'Making machines do things they shouldn\'t.' },
  electronics: { id: 'electronics', name: 'Electronics', category: 'tech',     stat: 'stat_int', description: 'Building, repairing, and salvaging tech.' },
  fabrication: { id: 'fabrication', name: 'Fabrication', category: 'tech',     stat: 'stat_int', description: 'Crafting. Material quality matters.' },
  drone_ops:   { id: 'drone_ops',   name: 'Drone Ops',   category: 'tech',     stat: 'stat_agi', description: 'Operating autonomous systems.' },
  // Social
  persuasion:  { id: 'persuasion',  name: 'Persuasion',  category: 'social',   stat: 'stat_cha', description: 'Making people want to do what you want.' },
  intimidate:  { id: 'intimidate',  name: 'Intimidate',  category: 'social',   stat: 'stat_str', description: 'Making people afraid to do what they want.' },
  deception:   { id: 'deception',   name: 'Deception',   category: 'social',   stat: 'stat_cha', description: 'Lying well. A career skill.' },
  faction_lore:{ id: 'faction_lore',name: 'Faction Lore',category: 'social',   stat: 'stat_int', description: 'Knowing who everyone is and what they want.' },
  // Arcane-Tech
  architect_interface: { id: 'architect_interface', name: 'Architect Interface', category: 'arcane', stat: 'stat_int', description: 'Communicating with Architect infrastructure. Dangerous. Late-game.' },
};

// XP required to reach each rank (cumulative)
const RANK_XP = [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 5700, 7500];

export function getSkillRank(xp) {
  for (let i = RANK_XP.length - 1; i >= 0; i--) {
    if (xp >= RANK_XP[i]) return i;
  }
  return 0;
}

export function getXpToNextRank(currentXp) {
  const rank = getSkillRank(currentXp);
  if (rank >= 10) return 0;
  return RANK_XP[rank + 1] - currentXp;
}

export function awardSkillXp(playerId, skillId, xpAmount) {
  const db = getDb();
  try {
    const existing = db.prepare('SELECT * FROM player_skills WHERE player_id = ? AND skill_id = ?').get(playerId, skillId);
    if (!existing) {
      db.prepare('INSERT INTO player_skills (player_id, skill_id, rank, xp) VALUES (?, ?, 0, ?)').run(playerId, skillId, xpAmount);
    } else {
      const newXp = existing.xp + xpAmount;
      const newRank = getSkillRank(newXp);
      db.prepare('UPDATE player_skills SET xp = ?, rank = ? WHERE player_id = ? AND skill_id = ?').run(newXp, newRank, playerId, skillId);
      if (newRank > existing.rank) {
        db.close();
        return { ranked_up: true, skill: skillId, new_rank: newRank };
      }
    }
    db.close();
    return { ranked_up: false };
  } catch(e) {
    try { db.close(); } catch(_) {}
    return { ranked_up: false };
  }
}

export function getPlayerSkills(playerId) {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM player_skills WHERE player_id = ?').all(playerId);
  db.close();
  const result = {};
  for (const row of rows) {
    result[row.skill_id] = { rank: row.rank, xp: row.xp, xp_to_next: getXpToNextRank(row.xp) };
  }
  return result;
}

// Roll a skill check. Returns { success, margin, message }
export function skillCheck(player, skillId, difficulty = 5) {
  const db = getDb();
  const row = db.prepare('SELECT rank FROM player_skills WHERE player_id = ? AND skill_id = ?').get(player.id, skillId);
  db.close();

  const rank = row?.rank || 0;
  const skill = SKILLS[skillId];
  const statBonus = skill ? Math.floor((player[skill.stat] || 5) / 2) : 0;
  const roll = Math.floor(Math.random() * 10) + 1;
  const total = roll + rank + statBonus;
  const success = total >= difficulty;

  return {
    success,
    roll,
    total,
    difficulty,
    margin: total - difficulty,
  };
}
