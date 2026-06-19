import { getDb } from '../models/migrate.js';
import { getZone, getZoneEnemies, getZoneNpcs, getZoneCorpses, addPlayerToZone, removePlayerFromZone, getLivePlayer } from './world.js';
import { playerAttackEnemy, isOnCooldown, tickStatuses } from './combat.js';
import { awardSkillXp, getPlayerSkills, SKILLS } from './skills.js';
import { randomUUID } from 'crypto';

// Build a full room description string
export function describeZone(zone, player) {
  const exits = Object.keys(zone.exits || {});
  const enemies = getZoneEnemies(zone.id);
  const npcs = getZoneNpcs(zone.id);
  const corpses = getZoneCorpses(zone.id);

  let desc = `\n<span class="zone-name">${zone.name}</span>\n`;
  desc += `<span class="zone-danger zone-danger-${zone.danger_rating}">[${zone.danger_rating.toUpperCase()}]</span>`;
  if (zone.radiation_level > 0) desc += ` <span class="rad-warning">☢ RAD:${zone.radiation_level}</span>`;
  if (zone.pvp_enabled) desc += ` <span class="pvp-warning">⚔ PVP</span>`;
  desc += `\n${zone.description}\n`;

  if (exits.length) {
    desc += `\n<span class="exits-label">Exits:</span> ${exits.join(', ')}`;
  }

  if (npcs.length) {
    desc += `\n<span class="npcs-label">NPCs here:</span> ${npcs.map(n => n.name).join(', ')}`;
  }

  if (enemies.length) {
    desc += `\n<span class="enemies-label">Hostiles:</span> ${enemies.map(e => `${e.name} (${e.hp}/${e.hp_max}HP)`).join(', ')}`;
  }

  if (corpses.length) {
    desc += `\n<span class="corpses-label">Corpses:</span> ${corpses.map(c => c.name).join(', ')}`;
  }

  return desc;
}

// Main command dispatcher
export async function handleCommand(input, player, broadcast) {
  const raw = input.trim();
  if (!raw) return null;

  const parts = raw.toLowerCase().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  const db = getDb();

  try {
    switch (cmd) {
      case 'look': case 'l': return cmdLook(player, db);
      case 'go': case 'move': case 'north': case 'south': case 'east': case 'west': case 'up': case 'down':
        return cmdMove(cmd === 'go' || cmd === 'move' ? args[0] : cmd, player, db, broadcast);
      case 'attack': case 'kill': case 'hit': case 'k':
        return cmdAttack(args.join(' '), player, db, broadcast);
      case 'inventory': case 'inv': case 'i':
        return cmdInventory(player, db);
      case 'stats': case 'status': case 'st':
        return cmdStats(player, db);
      case 'skills':
        return cmdSkills(player, db);
      case 'take': case 'get': case 'loot':
        return cmdTake(args.join(' '), player, db, broadcast);
      case 'drop':
        return cmdDrop(args.join(' '), player, db, broadcast);
      case 'use': case 'eat': case 'drink':
        return cmdUse(args.join(' '), player, db);
      case 'equip': case 'wear':
        return cmdEquip(args.join(' '), player, db);
      case 'talk': case 'speak':
        return cmdTalk(args.join(' '), player, db);
      case 'examine': case 'ex': case 'x':
        return cmdExamine(args.join(' '), player, db);
      case 'who':
        return cmdWho(player, db);
      case 'say': case '"':
        return cmdSay(raw.replace(/^(say|")\s*/i, ''), player, broadcast);
      case 'help': case '?':
        return cmdHelp();
      default:
        return { type: 'error', message: `Unknown command: "${cmd}". Type HELP for a list of commands.` };
    }
  } finally {
    db.close();
  }
}

function cmdLook(player, db) {
  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'error', message: 'You are nowhere. This is a bug.' };
  return { type: 'look', message: describeZone(zone, player) };
}

function cmdMove(direction, player, db, broadcast) {
  if (!direction) return { type: 'error', message: 'Go where? (north, south, east, west, up, down)' };

  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'error', message: 'Your current zone is missing. Please report this.' };

  const targetZoneId = zone.exits[direction];
  if (!targetZoneId) return { type: 'error', message: `There's no exit to the ${direction}.` };

  const targetZone = getZone(targetZoneId);
  if (!targetZone) return { type: 'error', message: `That exit leads nowhere yet.` };

  // Move player
  removePlayerFromZone(player.id, player.current_zone);
  addPlayerToZone(player.id, targetZoneId);
  player.current_zone = targetZoneId;

  // Persist
  db.prepare('UPDATE players SET current_zone = ? WHERE id = ?').run(targetZoneId, player.id);

  // Broadcast departure to old zone
  broadcast(zone.id, {
    type: 'zone_event',
    message: `${player.handle} heads ${direction}.`,
  }, player.id);

  // Broadcast arrival to new zone
  broadcast(targetZoneId, {
    type: 'zone_event',
    message: `${player.handle} arrives from the ${oppositeDir(direction)}.`,
  }, player.id);

  // Apply radiation passively
  if (targetZone.radiation_level > 0) {
    const radGain = Math.floor(targetZone.radiation_level * 0.1);
    if (radGain > 0) {
      player.radiation = Math.min(100, (player.radiation || 0) + radGain);
      db.prepare('UPDATE players SET radiation = ? WHERE id = ?').run(player.radiation, player.id);
    }
  }

  return {
    type: 'move',
    message: describeZone(targetZone, player),
    zone: targetZoneId,
    radiation_gain: targetZone.radiation_level > 0 ? Math.floor(targetZone.radiation_level * 0.1) : 0,
  };
}

function cmdAttack(targetStr, player, db, broadcast) {
  if (!targetStr) return { type: 'error', message: 'Attack what? (attack <target name>)' };

  const enemies = getZoneEnemies(player.current_zone);
  if (!enemies.length) return { type: 'error', message: 'Nothing to attack here.' };

  const target = enemies.find(e => e.name.toLowerCase().includes(targetStr));
  if (!target) return { type: 'error', message: `Can't find "${targetStr}" here.` };

  // Get equipped weapon
  const equippedWeapon = db.prepare(`
    SELECT i.* FROM player_inventory pi JOIN items i ON i.id = pi.item_id
    WHERE pi.player_id = ? AND pi.is_equipped = 1 AND i.type = 'weapon' LIMIT 1
  `).get(player.id);

  const weaponStats = equippedWeapon ? JSON.parse(equippedWeapon.effects || '{}') : { damage_min: 2, damage_max: 4 };
  const result = playerAttackEnemy(player, target.instanceId, weaponStats);

  if (!result.success) return { type: 'error', message: result.message };

  // Award skill XP
  if (result.hit) {
    const skillId = equippedWeapon?.subtype === 'bladed' ? 'bladed' : equippedWeapon?.subtype === 'blunt' ? 'brawling' : 'brawling';
    awardSkillXp(player.id, skillId, result.killed ? 15 : 5);
  }

  if (result.killed) {
    // Award credits
    if (result.credit_reward > 0) {
      player.credits = (player.credits || 0) + result.credit_reward;
      db.prepare('UPDATE players SET credits = ? WHERE id = ?').run(player.credits, player.id);
    }

    // Drop loot into zone (as ground items)
    if (result.loot?.length) {
      for (const drop of result.loot) {
        db.prepare(`
          INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, is_equipped)
          VALUES (?, '_ground_${player.current_zone}', ?, ?, 0.8, 0)
        `).run(randomUUID(), drop.item_id, drop.quantity);
      }
    }

    broadcast(player.current_zone, {
      type: 'zone_event',
      message: `${player.handle} kills ${target.name}.`,
    }, player.id);
  } else {
    broadcast(player.current_zone, {
      type: 'zone_event',
      message: `${player.handle} attacks ${target.name}.`,
    }, player.id);
  }

  return {
    type: 'combat',
    message: result.message,
    killed: result.killed || false,
    loot: result.loot,
    xp_reward: result.xp_reward,
  };
}

function cmdInventory(player, db) {
  const items = db.prepare(`
    SELECT pi.*, i.name, i.description, i.type, i.weight, i.value, i.rarity
    FROM player_inventory pi JOIN items i ON i.id = pi.item_id
    WHERE pi.player_id = ?
    ORDER BY i.type, i.name
  `).all(player.id);

  if (!items.length) return { type: 'inventory', message: 'Your inventory is empty.', items: [] };

  let msg = '<span class="inv-header">INVENTORY</span>\n';
  const totalWeight = items.reduce((sum, i) => sum + (i.weight * i.quantity), 0);

  for (const item of items) {
    const equipped = item.is_equipped ? ' <span class="equipped">[equipped]</span>' : '';
    msg += `  ${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ''}${equipped} — <span class="item-rarity-${item.rarity}">${item.rarity}</span>\n`;
  }
  msg += `\nWeight: ${totalWeight.toFixed(1)} | Credits: ${player.credits || 0}`;

  return { type: 'inventory', message: msg, items };
}

function cmdStats(player, db) {
  const p = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id);
  if (!p) return { type: 'error', message: 'Could not load your stats.' };

  const radBar = `[${'█'.repeat(Math.floor(p.radiation / 10))}${'░'.repeat(10 - Math.floor(p.radiation / 10))}]`;
  const hpPct = Math.floor((p.hp / p.hp_max) * 10);

  let msg = `<span class="stats-header">${p.handle}</span> — ${p.archetype || 'unknown'}\n\n`;
  msg += `HP:     ${p.hp}/${p.hp_max}\n`;
  msg += `Sanity: ${p.sanity}/${p.sanity_max}\n`;
  msg += `Hunger: ${p.hunger}/100\n`;
  msg += `Thirst: ${p.thirst}/100\n`;
  msg += `RAD:    ${radBar} ${p.radiation}/100\n\n`;
  msg += `STR:${p.stat_str}  AGI:${p.stat_agi}  INT:${p.stat_int}\n`;
  msg += `WIL:${p.stat_wil}  END:${p.stat_end}  CHA:${p.stat_cha}\n`;
  msg += `\nCredits: ${p.credits} | Zone: ${p.current_zone}`;

  return { type: 'stats', message: msg, player: p };
}

function cmdSkills(player, db) {
  const skills = getPlayerSkills(player.id);
  let msg = '<span class="skills-header">SKILLS</span>\n\n';

  const categories = ['combat', 'survival', 'tech', 'social', 'arcane'];
  for (const cat of categories) {
    const catSkills = Object.values(SKILLS).filter(s => s.category === cat);
    msg += `<span class="skill-category">${cat.toUpperCase()}</span>\n`;
    for (const skill of catSkills) {
      const data = skills[skill.id] || { rank: 0, xp: 0 };
      const bar = '█'.repeat(data.rank) + '░'.repeat(10 - data.rank);
      msg += `  ${skill.name.padEnd(20)} [${bar}] ${data.rank}/10\n`;
    }
    msg += '\n';
  }

  return { type: 'skills', message: msg };
}

function cmdTake(targetStr, player, db, broadcast) {
  if (!targetStr) return { type: 'error', message: 'Take what?' };

  // Check ground loot for this zone
  const groundItems = db.prepare(`
    SELECT pi.*, i.name, i.description, i.type, i.is_stackable
    FROM player_inventory pi JOIN items i ON i.id = pi.item_id
    WHERE pi.player_id = ? AND i.name LIKE ?
    LIMIT 1
  `).get(`_ground_${player.current_zone}`, `%${targetStr}%`);

  if (!groundItems) return { type: 'error', message: `Can't find "${targetStr}" here.` };

  // Transfer to player
  db.prepare('UPDATE player_inventory SET player_id = ? WHERE id = ?').run(player.id, groundItems.id);

  broadcast(player.current_zone, {
    type: 'zone_event',
    message: `${player.handle} picks up ${groundItems.name}.`,
  }, player.id);

  awardSkillXp(player.id, 'scavenging', 2);

  return { type: 'take', message: `You pick up ${groundItems.name}.` };
}

function cmdDrop(targetStr, player, db, broadcast) {
  if (!targetStr) return { type: 'error', message: 'Drop what?' };

  const item = db.prepare(`
    SELECT pi.*, i.name FROM player_inventory pi JOIN items i ON i.id = pi.item_id
    WHERE pi.player_id = ? AND i.name LIKE ? AND i.is_quest_item = 0
    LIMIT 1
  `).get(player.id, `%${targetStr}%`);

  if (!item) return { type: 'error', message: `You don't have "${targetStr}".` };

  db.prepare('UPDATE player_inventory SET player_id = ? WHERE id = ?').run(`_ground_${player.current_zone}`, item.id);

  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} drops ${item.name}.` }, player.id);
  return { type: 'drop', message: `You drop ${item.name}.` };
}

function cmdUse(targetStr, player, db) {
  if (!targetStr) return { type: 'error', message: 'Use what?' };

  const invItem = db.prepare(`
    SELECT pi.*, i.name, i.type, i.effects, i.flags
    FROM player_inventory pi JOIN items i ON i.id = pi.item_id
    WHERE pi.player_id = ? AND i.name LIKE ? AND i.type = 'consumable'
    LIMIT 1
  `).get(player.id, `%${targetStr}%`);

  if (!invItem) return { type: 'error', message: `You don't have a usable item called "${targetStr}".` };

  const effects = JSON.parse(invItem.effects || '{}');
  const messages = [`You use ${invItem.name}.`];

  if (effects.hp) {
    player.hp = Math.min(player.hp_max, player.hp + effects.hp);
    db.prepare('UPDATE players SET hp = ? WHERE id = ?').run(player.hp, player.id);
    messages.push(`+${effects.hp} HP. (${player.hp}/${player.hp_max})`);
  }
  if (effects.hunger) {
    player.hunger = Math.min(100, player.hunger + effects.hunger);
    db.prepare('UPDATE players SET hunger = ? WHERE id = ?').run(player.hunger, player.id);
    messages.push(`+${effects.hunger} Hunger.`);
  }
  if (effects.thirst) {
    player.thirst = Math.min(100, player.thirst + effects.thirst);
    db.prepare('UPDATE players SET thirst = ? WHERE id = ?').run(player.thirst, player.id);
    messages.push(`+${effects.thirst} Thirst.`);
  }
  if (effects.radiation) {
    player.radiation = Math.max(0, player.radiation + effects.radiation);
    db.prepare('UPDATE players SET radiation = ? WHERE id = ?').run(player.radiation, player.id);
    messages.push(`${effects.radiation > 0 ? '+' : ''}${effects.radiation} Radiation.`);
  }
  if (effects.credits) {
    player.credits = (player.credits || 0) + effects.credits;
    db.prepare('UPDATE players SET credits = ? WHERE id = ?').run(player.credits, player.id);
    messages.push(`+${effects.credits} credits.`);
  }

  // Remove one from stack
  if (invItem.quantity > 1) {
    db.prepare('UPDATE player_inventory SET quantity = quantity - 1 WHERE id = ?').run(invItem.id);
  } else {
    db.prepare('DELETE FROM player_inventory WHERE id = ?').run(invItem.id);
  }

  if (invItem.type === 'consumable') awardSkillXp(player.id, 'medicine', 1);

  return { type: 'use', message: messages.join('\n'), player_update: { hp: player.hp, hunger: player.hunger, thirst: player.thirst, radiation: player.radiation } };
}

function cmdEquip(targetStr, player, db) {
  if (!targetStr) return { type: 'error', message: 'Equip what?' };

  const item = db.prepare(`
    SELECT pi.*, i.name, i.type, i.subtype, i.flags, i.requirements, i.stat_modifiers
    FROM player_inventory pi JOIN items i ON i.id = pi.item_id
    WHERE pi.player_id = ? AND i.name LIKE ? AND (i.type = 'weapon' OR i.type = 'armor')
    LIMIT 1
  `).get(player.id, `%${targetStr}%`);

  if (!item) return { type: 'error', message: `Can't equip "${targetStr}".` };

  const requirements = JSON.parse(item.requirements || '{}');
  for (const [stat, val] of Object.entries(requirements)) {
    if ((player[stat] || 0) < val) return { type: 'error', message: `You need ${stat.replace('stat_', '').toUpperCase()} ${val} to use this.` };
  }

  // Unequip anything in same slot
  const flags = JSON.parse(item.flags || '{}');
  const slot = flags.slot || item.type;
  db.prepare('UPDATE player_inventory SET is_equipped = 0 WHERE player_id = ? AND slot = ?').run(player.id, slot);
  db.prepare('UPDATE player_inventory SET is_equipped = 1, slot = ? WHERE id = ?').run(slot, item.id);

  return { type: 'equip', message: `You equip ${item.name}.` };
}

function cmdTalk(targetStr, player, db) {
  if (!targetStr) return { type: 'error', message: 'Talk to whom?' };

  const npcs = getZoneNpcs(player.current_zone);
  const npc = npcs.find(n => n.name.toLowerCase().includes(targetStr));
  if (!npc) return { type: 'error', message: `Can't find "${targetStr}" here.` };

  const tree = npc.dialogue_tree;
  const root = tree.root;
  if (!root) return { type: 'talk', message: `${npc.name} doesn't seem interested in talking.` };

  return {
    type: 'dialogue',
    npcId: npc.id,
    npcName: npc.name,
    node: 'root',
    text: root.text,
    options: root.options || [],
  };
}

function cmdExamine(targetStr, player, db) {
  if (!targetStr || targetStr === 'room') return cmdLook(player, db);

  // Check inventory
  const invItem = db.prepare(`
    SELECT i.* FROM player_inventory pi JOIN items i ON i.id = pi.item_id
    WHERE pi.player_id = ? AND i.name LIKE ? LIMIT 1
  `).get(player.id, `%${targetStr}%`);
  if (invItem) return { type: 'examine', message: `${invItem.name}\n${invItem.description}` };

  // Check enemies in zone
  const enemies = getZoneEnemies(player.current_zone);
  const enemy = enemies.find(e => e.name.toLowerCase().includes(targetStr));
  if (enemy) return { type: 'examine', message: `${enemy.name}\n${enemy.description}\nHP: ${enemy.hp}/${enemy.hp_max}` };

  // Check NPCs
  const npcs = getZoneNpcs(player.current_zone);
  const npc = npcs.find(n => n.name.toLowerCase().includes(targetStr));
  if (npc) return { type: 'examine', message: `${npc.name}\n${npc.description}` };

  return { type: 'error', message: `You don't see "${targetStr}" here.` };
}

function cmdWho(player, db) {
  const players = db.prepare('SELECT handle, current_zone, last_seen FROM players WHERE last_seen > ? AND role = ?').all(Date.now() / 1000 - 300, 'player');
  if (!players.length) return { type: 'who', message: 'No other survivors currently logged in.' };
  let msg = '<span class="who-header">SURVIVORS ONLINE</span>\n';
  for (const p of players) {
    msg += `  ${p.handle.padEnd(20)} ${p.current_zone}\n`;
  }
  return { type: 'who', message: msg };
}

function cmdSay(text, player, broadcast) {
  if (!text) return { type: 'error', message: 'Say what?' };
  broadcast(player.current_zone, {
    type: 'say',
    message: `${player.handle} says: "${text}"`,
    speaker: player.handle,
  }, null);
  return { type: 'say', message: `You say: "${text}"` };
}

function cmdHelp() {
  return {
    type: 'help',
    message: `<span class="help-header">COMMANDS</span>

<span class="help-category">MOVEMENT</span>
  north/south/east/west/up/down  Move in that direction
  go <direction>                 Same as above

<span class="help-category">COMBAT</span>
  attack <target>                Attack a hostile
  flee                           Attempt to escape combat

<span class="help-category">ITEMS</span>
  inventory / i                  Show your inventory
  take <item>                    Pick up an item
  drop <item>                    Drop an item
  use <item>                     Use a consumable
  equip <item>                   Equip a weapon or armor
  examine <target>               Inspect something closely

<span class="help-category">INFO</span>
  look / l                       Describe your surroundings
  stats / st                     Show your stats and vitals
  skills                         Show your skill levels
  who                            List online players

<span class="help-category">SOCIAL</span>
  talk <npc>                     Talk to an NPC
  say <message>                  Say something in the room
  `,
  };
}

function oppositeDir(dir) {
  const map = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'below', down: 'above' };
  return map[dir] || 'somewhere';
}
