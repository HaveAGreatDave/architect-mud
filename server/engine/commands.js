import { query } from '../models/db.js';
import { getZone, getZoneEnemies, getZoneNpcs, getZoneCorpses, getZonePlayers, getAllLivePlayers, addPlayerToZone, removePlayerFromZone, getMinimapData } from './world.js';
import { playerAttackEnemy, isOnCooldown, getCooldownRemaining } from './combat.js';
import { awardSkillXp, getPlayerSkills, SKILLS, skillCheck } from './skills.js';
import { getAvailableRecipes, attemptCraft } from './crafting.js';
import { getPlayerMutations, getCustodianOutcastResponse } from './mutations.js';
import { getPlayerFactionRep } from './factions.js';
import { getVendorStock, buyFromVendor, sellToVendor } from './vendor.js';
import { cmdRent, cmdLockDoor, cmdUpgradeLock, cmdPickLock, cmdSleep, describeApartmentStatus } from './apartments.js';
import { useDrug } from './drugs.js';
import { getZoneVisibility } from './environment.js';
import { randomUUID } from 'crypto';

// Per-player cooldown so Custodian turrets don't fire on every single look/move
const turretCooldowns = new Map();

// Flavor line describing how well-lit the zone currently is — driven by
// the environment system's ambient light + artificial light + weather/fog
// model (GDD §7). Falls back to "clear" automatically if the environment
// system never initialized, since getZoneVisibility() reads safe in-memory
// defaults rather than throwing.
function describeLightLevel(category) {
  if (category === 'dark') return `<span class="light-level light-dark">It's dark here — you can only make out shadows and shapes.</span>`;
  if (category === 'dim') return `<span class="light-level light-dim">Light is dim; details are hard to make out.</span>`;
  return `<span class="light-level light-clear">Visibility is clear.</span>`;
}

export async function describeZone(zone, player) {
  const exits = Object.keys(zone.exits || {});
  const enemies = getZoneEnemies(zone.id);
  const npcs = getZoneNpcs(zone.id);
  const corpses = getZoneCorpses(zone.id);
  const others = getZonePlayers(zone.id).filter(p => p.id !== player.id);

  // Items lying on the ground in this zone
  const { rows: groundItems } = await query(
    `SELECT pi.*, i.name, i.type, i.rarity FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id = $1`,
    [`_ground_${zone.id}`]
  );

  let desc = `\n<span class="zone-name">${zone.name}</span>\n`;
  desc += `<span class="zone-danger zone-danger-${zone.danger_rating}">[${zone.danger_rating.toUpperCase()}]</span>`;
  if (zone.radiation_level > 0) desc += ` <span class="rad-warning">☢ RAD:${zone.radiation_level}</span>`;
  if (zone.pvp_enabled) desc += ` <span class="pvp-warning">⚔ PVP</span>`;
  desc += `\n${describeLightLevel(getZoneVisibility(zone.id).category)}`;
  desc += `\n${zone.description}`;
  desc += await describeApartmentStatus(zone);

  const outcastResponse = getCustodianOutcastResponse(zone, player);
  if (outcastResponse) {
    desc += outcastResponse.message;
    if (outcastResponse.hostile) {
      const lastHit = turretCooldowns.get(player.id) || 0;
      if (Date.now() - lastHit > 8000) {
        turretCooldowns.set(player.id, Date.now());
        const dmg = Math.floor(Math.random() * 8) + 6;
        player.hp = Math.max(1, player.hp - dmg);
        await query('UPDATE players SET hp=$1 WHERE id=$2', [player.hp, player.id]);
        desc += `\n<span class="death-message">The turret fires. -${dmg} HP. (${player.hp}/${player.hp_max})</span>`;
      }
    }
  }

  // Weave notable ground items directly into the prose, underlined and
  // clickable, the way HellMOO highlights interactable nouns in room text.
  if (groundItems.length) {
    const itemMentions = groundItems.map(item => {
      const rarityClass = `item-rarity-${item.rarity}`;
      return `<span class="action-link room-item ${rarityClass}" data-action="take" data-target="${item.name}" title="Take ${item.name}">${item.name}</span>`;
    });
    desc += ` Lying here: ${itemMentions.join(', ')}.`;
  }

  desc += `\n`;
  if (exits.length) {
    const exitLinks = exits.map(dir => {
      const targetZone = getZone(zone.exits[dir]);
      // A building is just a zone with flags.is_building set — no separate
      // table. flags.building_name lets the exit label differ from the
      // zone's own name (e.g. zone "Embassy Hotel — Lobby" but exit tag
      // "Embassy Hotel & Bar"); falls back to the zone's name otherwise.
      const buildingName = targetZone?.flags?.is_building
        ? (targetZone.flags.building_name || targetZone.name)
        : null;
      const dirSpan = `<span class="action-link exit-link" data-action="go" data-target="${dir}" title="Go ${dir}">${dir}</span>`;
      const tagSpan = buildingName
        ? ` <span class="action-link exit-building-tag" data-action="go" data-target="${dir}" title="Enter ${buildingName}">(${buildingName})</span>`
        : '';
      return dirSpan + tagSpan;
    });
    desc += `\n<span class="exits-label">Exits:</span> ${exitLinks.join(', ')}`;
  }
  if (others.length) {
    const playerLinks = others.map(p =>
      `<span class="action-link player-link" data-action="examine" data-target="${p.handle}" title="Look at ${p.handle}">${p.handle}</span>`
    );
    desc += `\n<span class="players-label">Also here:</span> ${playerLinks.join(', ')}`;
  }
  if (npcs.length) {
    const npcLinks = npcs.map(n =>
      `<span class="action-link npc-link" data-action="talk" data-target="${n.name}" title="Talk to ${n.name}">${n.name}</span>`
    );
    desc += `\n<span class="npcs-label">NPCs here:</span> ${npcLinks.join(', ')}`;
  }
  if (enemies.length) {
    const enemyLinks = enemies.map(e =>
      `<span class="action-link enemy-link" data-action="attack" data-target="${e.name}" title="Attack ${e.name}">${e.name}</span> (${e.hp}/${e.hp_max}HP)`
    );
    desc += `\n<span class="enemies-label">Hostiles:</span> ${enemyLinks.join(', ')}`;
  }
  if (corpses.length) {
    const corpseLinks = corpses.map(c =>
      `<span class="action-link corpse-link" data-action="loot" data-target="${c.name}" title="Loot ${c.name}">${c.name}</span>`
    );
    desc += `\n<span class="corpses-label">Corpses:</span> ${corpseLinks.join(', ')}`;
  }
  return desc;
}

export async function handleCommand(input, player, broadcast) {
  const raw = input.trim();
  if (!raw) return null;
  const parts = raw.toLowerCase().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  // Any command except sleep/rest itself wakes a sleeping player up early —
  // sleep is a state you opt into and can opt out of at any time, not a
  // lockout. The resource gains/losses already applied for whichever
  // minutes were slept are kept; nothing is reverted on early wake.
  if (player.sleeping && cmd !== 'sleep' && cmd !== 'rest') {
    player.sleeping = null;
    const result = await handleCommand(input, player, broadcast);
    if (result) result.message = `You wake up.\n\n${result.message}`;
    return result;
  }

  switch (cmd) {
    case 'look': case 'l': return args.length ? cmdLook(player, args.join(' ')) : cmdLook(player);
    case 'go': case 'move':
      return cmdMove(args[0], player, broadcast);
    case 'north': case 'n': return cmdMove('north', player, broadcast);
    case 'south': case 's': return cmdMove('south', player, broadcast);
    case 'east': case 'e': return cmdMove('east', player, broadcast);
    case 'west': case 'w': return cmdMove('west', player, broadcast);
    case 'up': case 'u': return cmdMove('up', player, broadcast);
    case 'down': case 'd': return cmdMove('down', player, broadcast);
    case 'attack': case 'kill': case 'k': return cmdAttack(args.join(' '), player, broadcast);
    case 'inventory': case 'inv': case 'i': return cmdInventory(player);
    case 'stats': case 'status': case 'st': return cmdStats(player);
    case 'skills': return cmdSkills(player);
    case 'take': case 'get': return cmdTake(args.join(' '), player, broadcast);
    case 'drop': return cmdDrop(args.join(' '), player, broadcast);
    case 'use': case 'eat': case 'drink': return cmdUse(args.join(' '), player);
    case 'equip': case 'wear': return cmdEquip(args.join(' '), player);
    case 'unequip': case 'remove': return cmdUnequip(args.join(' '), player);
    case 'equipid': return cmdEquipById(args[0], player);
    case 'unequipid': return cmdUnequipById(args[0], player);
    case 'talk': case 'speak': return cmdTalk(args.join(' '), player);
    case 'examine': case 'ex': case 'x': return cmdExamine(args.join(' '), player);
    case 'who': return cmdWho();
    case 'say': return cmdSay(raw.replace(/^say\s*/i,''), player, broadcast);
    case 'craft': return cmdCraft(args, player);
    case 'recipes': return cmdRecipes(player);
    case 'mutations': return cmdMutations(player);
    case 'factions': case 'rep': return cmdFactions(player);
    case 'shop': case 'browse': return cmdShop(args.join(' '), player);
    case 'buy': return cmdBuy(args, player);
    case 'sell': return cmdSell(args, player);
    case 'deposit': return cmdDeposit(args[0], player);
    case 'withdraw': return cmdWithdraw(args[0], player);
    case 'balance': return cmdBalance(player);
    case 'steal': return cmdSteal(args.join(' '), player, broadcast);
    case 'loot': return cmdLootCorpse(args.join(' '), player, broadcast);
    case 'rent': return cmdRent(player);
    case 'lock': return cmdLockDoor(player, true);
    case 'unlock': return cmdLockDoor(player, false);
    case 'pick': case 'picklock': return cmdPickLock(player);
    case 'sleep': case 'rest': return cmdSleep(player);
    case 'upgrade':
      if (args[0] === 'lock') return cmdUpgradeLock(player);
      return { type:'error', message:'Upgrade what? Try "upgrade lock".' };
    case 'help': case '?': return cmdHelp();
    case 'obama': return cmdObama(args.join(' '), player, broadcast);
    default: return { type:'error', message:`Unknown command: "${cmd}". Type HELP for commands.` };
  }
}

async function cmdLook(player, targetStr) {
  if (!targetStr || targetStr === 'room' || targetStr === 'around') {
    const zone = getZone(player.current_zone);
    if (!zone) return { type:'error', message:'You are nowhere. This is a bug.' };
    return { type:'look', message: await describeZone(zone, player), minimap: getMinimapData(zone.id) };
  }
  if (targetStr === 'me' || targetStr === 'self' || targetStr === 'myself') {
    let msg = `${player.handle}\n${player.origin_fragment || 'A survivor. Still standing, somehow.'}`;
    if (player.visibly_mutated) msg += `\n<span class="mutation-tag">Whatever's changed about you, it shows.</span>`;
    return { type:'examine', message: msg };
  }
  return cmdExamine(targetStr, player);
}

async function cmdMove(direction, player, broadcast) {
  if (!direction) return { type:'error', message:'Go where? (north, south, east, west, up, down)' };
  const zone = getZone(player.current_zone);
  if (!zone) return { type:'error', message:'Your zone is missing.' };
  const targetId = zone.exits[direction];
  if (!targetId) return { type:'error', message:`No exit to the ${direction}.` };
  const targetZone = getZone(targetId);
  if (!targetZone) return { type:'error', message:'That exit leads nowhere yet.' };

  removePlayerFromZone(player.id, player.current_zone);
  addPlayerToZone(player.id, targetId);
  player.current_zone = targetId;
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [targetId, player.id]);

  const OPPOSITE = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up' };
  const arrivalDir = OPPOSITE[direction] || null;

  broadcast(zone.id, { type:'zone_event', message:`${player.handle} heads ${direction}.` }, player.id);
  broadcast(targetId, { type:'zone_event', message: arrivalDir
    ? `${player.handle} arrives from the ${arrivalDir}.`
    : `${player.handle} arrives.` }, player.id);

  let radGain = 0;
  if (targetZone.radiation_level > 0) {
    radGain = Math.floor(targetZone.radiation_level * 0.1);
    if (radGain > 0) {
      player.radiation = Math.min(100, (player.radiation||0) + radGain);
      await query('UPDATE players SET radiation=$1 WHERE id=$2', [player.radiation, player.id]);
    }
  }
  return { type:'move', message:await describeZone(targetZone, player), zone:targetId, radiation_gain:radGain, minimap: getMinimapData(targetId) };
}

async function cmdAttack(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Attack what?' };
  const enemies = getZoneEnemies(player.current_zone);
  if (!enemies.length) return { type:'error', message:'Nothing to attack here.' };
  const target = enemies.find(e => e.name.toLowerCase().includes(targetStr));
  if (!target) return { type:'error', message:`Can't find "${targetStr}" here.` };
  return resolveAttack(player, target, broadcast);
}

// Shared by both the manual "attack" command and auto-retaliation when a
// player is hit by something they haven't engaged yet. Same weapon lookup,
// skill XP, loot drop, and broadcast behavior either way.
export async function resolveAttack(player, target, broadcast) {
  const { rows } = await query(`SELECT i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1 AND i.type='weapon' LIMIT 1`, [player.id]);
  const equipped = rows[0];
  const weaponStats = equipped ? (equipped.effects || {}) : { damage_min:2, damage_max:4 };
  const result = playerAttackEnemy(player, target.instanceId, weaponStats);
  if (!result.success) return { type:'error', message:result.message };

  if (result.hit) {
    const skillId = equipped?.subtype === 'bladed' ? 'bladed' : equipped?.subtype === 'energy' ? 'electronics' : 'brawling';
    await awardSkillXp(player.id, skillId, result.killed ? 15 : 5);
  }

  if (result.killed) {
    if (result.credit_reward > 0) {
      player.credits = (player.credits||0) + result.credit_reward;
      await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
    }
    // Drop loot as ground items
    if (result.loot?.length) {
      for (const drop of result.loot) {
        await query('INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,$4,0.8)',
          [randomUUID(), `_ground_${player.current_zone}`, drop.item_id, drop.quantity]);
      }
    }
    broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} kills ${target.name}.` }, player.id);
  } else {
    broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} attacks ${target.name}.` }, player.id);
  }
  return { type:'combat', message:result.message, killed:result.killed||false, loot:result.loot, xp_reward:result.xp_reward };
}

async function cmdInventory(player) {
  const { rows } = await query(`SELECT pi.*,i.name,i.type,i.subtype,i.weight,i.rarity,i.flags FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 ORDER BY i.type,i.name`, [player.id]);
  if (!rows.length) return { type:'inventory', message:'Your inventory is empty.', items:[] };
  let msg = '<span class="inv-header">INVENTORY</span>\n';
  for (const item of rows) {
    const eq = item.is_equipped ? ' <span class="equipped">[equipped]</span>' : '';
    const quality = item.custom_data?.quality ? ` [${item.custom_data.quality}]` : '';
    msg += `  ${item.name}${item.quantity>1?` x${item.quantity}`:''}${quality}${eq} — <span class="item-rarity-${item.rarity}">${item.rarity}</span>\n`;
  }
  msg += `\nCredits: ${player.credits||0}`;
  return { type:'inventory', message:msg, items:rows };
}

async function cmdStats(player) {
  const { rows } = await query('SELECT * FROM players WHERE id=$1', [player.id]);
  const p = rows[0];
  if (!p) return { type:'error', message:'Could not load stats.' };
  const radBar = `[${'█'.repeat(Math.floor(p.radiation/10))}${'░'.repeat(10-Math.floor(p.radiation/10))}]`;
  let msg = `<span class="stats-header">${p.handle}</span> — ${p.archetype||'unknown'}\n\n`;
  msg += `HP:     ${p.hp}/${p.hp_max}\nSanity: ${p.sanity}/${p.sanity_max}\nHunger: ${p.hunger}/100\nThirst: ${p.thirst}/100\nRAD:    ${radBar} ${p.radiation}/100\n\n`;
  msg += `STR:${p.stat_str}  AGI:${p.stat_agi}  INT:${p.stat_int}\nWIL:${p.stat_wil}  END:${p.stat_end}  CHA:${p.stat_cha}\n\nCredits: ${p.credits}`;

  const statusFlags = [];
  if (player.sleeping) statusFlags.push('Asleep');
  if (player.healOverTime?.length) statusFlags.push(`Healing (${player.healOverTime.reduce((s,h)=>s+h.perTick*h.ticksRemaining,0)} HP over ${Math.max(...player.healOverTime.map(h=>h.ticksRemaining))}m)`);
  if (player.wellFedUntil && Date.now() < player.wellFedUntil) statusFlags.push('Well-Fed');
  if (player.hydratedUntil && Date.now() < player.hydratedUntil) statusFlags.push('Hydrated');
  if (statusFlags.length) msg += `\n\n<span class="status-flags">${statusFlags.join(' · ')}</span>`;

  return { type:'stats', message:msg, player:p };
}

async function cmdSkills(player) {
  const skills = await getPlayerSkills(player.id);
  let msg = '<span class="skills-header">SKILLS</span>\n\n';
  for (const cat of ['combat','survival','tech','social','arcane']) {
    msg += `<span class="skill-category">${cat.toUpperCase()}</span>\n`;
    for (const skill of Object.values(SKILLS).filter(s=>s.category===cat)) {
      const data = skills[skill.id] || { rank:0 };
      msg += `  ${skill.name.padEnd(20)} [${'█'.repeat(data.rank)}${'░'.repeat(10-data.rank)}] ${data.rank}/10\n`;
    }
    msg += '\n';
  }
  return { type:'skills', message:msg };
}

async function cmdTake(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Take what?' };
  const { rows } = await query(`SELECT pi.*,i.name,i.is_stackable FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 LIMIT 1`, [`_ground_${player.current_zone}`, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`Can't find "${targetStr}" here.` };
  const ground = rows[0];

  if (ground.is_stackable) {
    const { rows: existing } = await query(
      'SELECT id, quantity FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0',
      [player.id, ground.item_id]
    );
    if (existing.length) {
      await query('UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2', [ground.quantity, existing[0].id]);
      await query('DELETE FROM player_inventory WHERE id=$1', [ground.id]);
      await awardSkillXp(player.id, 'scavenging', 2);
      broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} picks up ${ground.name}.` }, player.id);
      return { type:'take', message:`You pick up ${ground.name}.` };
    }
  }

  await query('UPDATE player_inventory SET player_id=$1 WHERE id=$2', [player.id, ground.id]);
  await awardSkillXp(player.id, 'scavenging', 2);
  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} picks up ${ground.name}.` }, player.id);
  return { type:'take', message:`You pick up ${ground.name}.` };
}

async function cmdDrop(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Drop what?' };
  const { rows } = await query(`SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 AND i.is_quest_item=0 LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`You don't have "${targetStr}".` };
  await query('UPDATE player_inventory SET player_id=$1 WHERE id=$2', [`_ground_${player.current_zone}`, rows[0].id]);
  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} drops ${rows[0].name}.` }, player.id);
  return { type:'drop', message:`You drop ${rows[0].name}.` };
}

async function cmdUse(targetStr, player) {
  if (!targetStr) return { type:'error', message:'Use what?' };

  // Drugs are a distinct item type — route through the drugs engine for
  // addiction/overdose/duration handling instead of the plain consumable path.
  const { rows: drugRows } = await query(
    `SELECT pi.*, i.name, i.type, d.id as drug_id FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     JOIN drugs d ON d.item_id = i.id
     WHERE pi.player_id=$1 AND i.name ILIKE $2 LIMIT 1`,
    [player.id, `%${targetStr}%`]
  );
  if (drugRows.length) {
    const item = drugRows[0];
    const result = await useDrug(player, item.drug_id);
    if (!result.success) return { type:'error', message: result.message };
    if (item.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [item.id]);
    else await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
    return { type:'use', message: result.message, player_update: result.player_update };
  }

  const { rows } = await query(`SELECT pi.*,i.name,i.subtype,i.effects FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 AND i.type='consumable' LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`No usable item "${targetStr}" in inventory.` };
  const item = rows[0];
  const effects = item.effects || {};
  const messages = [`You use ${item.name}.`];
  if (effects.hp) { player.hp = Math.min(player.hp_max, player.hp+effects.hp); messages.push(`+${effects.hp} HP.`); }
  if (effects.hunger) { player.hunger = Math.min(100, player.hunger+effects.hunger); messages.push(`+${effects.hunger} Hunger.`); }
  if (effects.thirst) { player.thirst = Math.min(100, player.thirst+effects.thirst); messages.push(`+${effects.thirst} Thirst.`); }
  if (effects.radiation) { player.radiation = Math.max(0, player.radiation+effects.radiation); messages.push(`${effects.radiation} Radiation.`); }
  if (effects.credits) { player.credits = (player.credits||0)+effects.credits; messages.push(`+${effects.credits} credits.`); }
  if (effects.hp_over_time) {
    // Heal-over-time effects stack rather than overwrite — using a second
    // bandage while one is already working just adds another HoT tick to
    // the queue, same as it would in practice.
    const { amount, duration_seconds } = effects.hp_over_time;
    const ticks = Math.max(1, Math.round(duration_seconds / 60));
    const perTick = Math.ceil(amount / ticks);
    player.healOverTime = player.healOverTime || [];
    player.healOverTime.push({ perTick, ticksRemaining: ticks });
    messages.push(`Bleeding slows. You'll recover ${amount} HP over the next ${Math.round(duration_seconds/60)} minute(s).`);
  }
  // Food speeds up natural HP regen for a while; water speeds up radiation
  // removal — any item of that subtype grants the buff, not just specific
  // named items, so this scales automatically as more food/drink is added.
  if (item.subtype === 'food') {
    player.wellFedUntil = Date.now() + 10 * 60 * 1000; // 10 minutes
    messages.push(`Well-fed: HP regen is faster for a while.`);
  }
  if (item.subtype === 'drink') {
    player.hydratedUntil = Date.now() + 10 * 60 * 1000; // 10 minutes
    messages.push(`Hydrated: radiation clears faster for a while.`);
  }
  await query('UPDATE players SET hp=$1,hunger=$2,thirst=$3,radiation=$4,credits=$5 WHERE id=$6', [player.hp,player.hunger,player.thirst,player.radiation,player.credits,player.id]);
  if (item.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [item.id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
  await awardSkillXp(player.id, 'medicine', 1);
  return { type:'use', message:messages.join('\n'), player_update:{hp:player.hp,hunger:player.hunger,thirst:player.thirst,radiation:player.radiation,credits:player.credits} };
}

// Canonical body-slot taxonomy. An item's flags.slot must be one of these
// for it to be equippable in a specific location; anything else falls back
// to a generic slot named after its item type (rare — only legacy/unflagged
// items should ever hit that fallback).
export const EQUIP_SLOTS = {
  head: 'Head', torso: 'Torso', hands: 'Hands', legs: 'Legs', feet: 'Feet',
  weapon_hand: 'Weapon Hand', accessory: 'Accessory',
};

async function cmdEquip(targetStr, player) {
  if (!targetStr) return { type:'error', message:'Equip what?' };
  const { rows } = await query(`SELECT pi.*,i.name,i.type,i.subtype,i.flags,i.requirements FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 AND (i.type='weapon' OR i.type='armor') LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`Can't equip "${targetStr}".` };
  const item = rows[0];
  const reqs = item.requirements || {};
  for (const [stat,val] of Object.entries(reqs)) {
    if ((player[stat]||0) < val) return { type:'error', message:`Need ${stat.replace('stat_','')} ${val} to use this.` };
  }
  const flags = item.flags || {};
  const slot = flags.slot && EQUIP_SLOTS[flags.slot] ? flags.slot : (item.type === 'weapon' ? 'weapon_hand' : null);
  if (!slot) return { type:'error', message:`${item.name} doesn't have a valid equip slot configured.` };
  await query('UPDATE player_inventory SET is_equipped=0 WHERE player_id=$1 AND slot=$2', [player.id, slot]);
  await query('UPDATE player_inventory SET is_equipped=1,slot=$1 WHERE id=$2', [slot, item.id]);
  return { type:'equip', message:`You equip ${item.name}.`, slot };
}

async function cmdUnequip(targetStr, player) {
  if (!targetStr) return { type:'error', message:'Unequip what?' };
  const { rows } = await query(`SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1 AND i.name ILIKE $2 LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`You don't have "${targetStr}" equipped.` };
  await query('UPDATE player_inventory SET is_equipped=0 WHERE id=$1', [rows[0].id]);
  return { type:'equip', message:`You unequip ${rows[0].name}.` };
}

// Deterministic id-targeted variants for the visual equipment panel — the
// click/drag UI knows exactly which inventory row it's acting on and
// shouldn't rely on fuzzy name matching the way a typed command does.
async function cmdEquipById(inventoryId, player) {
  if (!inventoryId) return { type:'error', message:'Nothing selected to equip.' };
  const { rows } = await query(`SELECT pi.*,i.name,i.type,i.flags,i.requirements FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1 AND pi.player_id=$2 AND (i.type='weapon' OR i.type='armor') LIMIT 1`, [inventoryId, player.id]);
  if (!rows.length) return { type:'error', message:`Can't equip that.` };
  const item = rows[0];
  const reqs = item.requirements || {};
  for (const [stat,val] of Object.entries(reqs)) {
    if ((player[stat]||0) < val) return { type:'error', message:`Need ${stat.replace('stat_','')} ${val} to use this.` };
  }
  const flags = item.flags || {};
  const slot = flags.slot && EQUIP_SLOTS[flags.slot] ? flags.slot : (item.type === 'weapon' ? 'weapon_hand' : null);
  if (!slot) return { type:'error', message:`${item.name} doesn't have a valid equip slot configured.` };
  await query('UPDATE player_inventory SET is_equipped=0 WHERE player_id=$1 AND slot=$2', [player.id, slot]);
  await query('UPDATE player_inventory SET is_equipped=1,slot=$1 WHERE id=$2', [slot, item.id]);
  return { type:'equip', message:`You equip ${item.name}.`, slot };
}

async function cmdUnequipById(inventoryId, player) {
  if (!inventoryId) return { type:'error', message:'Nothing selected to unequip.' };
  const { rows } = await query(`SELECT pi.*,i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.id=$1 AND pi.player_id=$2 AND pi.is_equipped=1 LIMIT 1`, [inventoryId, player.id]);
  if (!rows.length) return { type:'error', message:`That isn't equipped.` };
  await query('UPDATE player_inventory SET is_equipped=0 WHERE id=$1', [rows[0].id]);
  return { type:'equip', message:`You unequip ${rows[0].name}.` };
}

function cmdTalk(targetStr, player) {
  if (!targetStr) return { type:'error', message:'Talk to whom?' };
  const npcs = getZoneNpcs(player.current_zone);
  const npc = npcs.find(n => n.name.toLowerCase().includes(targetStr));
  if (!npc) return { type:'error', message:`Can't find "${targetStr}" here.` };
  const root = npc.dialogue_tree?.root;
  if (!root) return { type:'talk', message:`${npc.name} doesn't want to talk.` };
  return { type:'dialogue', npcId:npc.id, npcName:npc.name, node:'root', text:root.text, options:root.options||[] };
}

async function cmdExamine(targetStr, player) {
  if (!targetStr || targetStr === 'room') return cmdLook(player);
  const { rows } = await query(`SELECT i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (rows.length) return { type:'examine', message:`${rows[0].name}\n${rows[0].description}` };
  const enemies = getZoneEnemies(player.current_zone);
  const enemy = enemies.find(e=>e.name.toLowerCase().includes(targetStr));
  if (enemy) return { type:'examine', message:`${enemy.name}\n${enemy.description}\nHP: ${enemy.hp}/${enemy.hp_max}` };
  const npcs = getZoneNpcs(player.current_zone);
  const npc = npcs.find(n=>n.name.toLowerCase().includes(targetStr));
  if (npc) return { type:'examine', message:`${npc.name}\n${npc.description}` };
  const others = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  const target = others.find(p => p.handle.toLowerCase().includes(targetStr));
  if (target) {
    let msg = `${target.handle}\n${target.origin_fragment || 'A survivor. They give nothing else away.'}`;
    if (target.visibly_mutated) msg += `\n<span class="mutation-tag">Something about them isn't quite human anymore.</span>`;
    return { type:'examine', message: msg };
  }
  return { type:'error', message:`You don't see "${targetStr}" here.` };
}

async function cmdWho() {
  // The DB's last_seen column only updates on login/disconnect, not on every
  // command — using it as a presence check meant idle-but-connected players
  // silently vanished from WHO after 5 minutes. world.players is the actual
  // live connection map and reflects who's online right now, regardless of
  // how long they've been idle or which zone they're in.
  const online = getAllLivePlayers().filter(p => p.role !== 'admin' && p.role !== 'ghost');
  if (!online.length) return { type:'who', message:'No other survivors currently online.' };
  let msg = '<span class="who-header">SURVIVORS ONLINE</span>\n';
  for (const p of online) msg += `  ${p.handle.padEnd(20)} ${p.current_zone}\n`;
  return { type:'who', message:msg };
}

function cmdSay(text, player, broadcast) {
  if (!text) return { type:'error', message:'Say what?' };
  broadcast(player.current_zone, { type:'say', message:`${player.handle} says: "${text}"` }, null);
  return { type:'say', message:`You say: "${text}"` };
}

// Hidden command. No further commentary necessary.
function cmdObama(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Fist bump whom?' };
  const others = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  const target = others.find(p => p.handle.toLowerCase().includes(targetStr));
  if (!target) return { type:'error', message:`Can't find "${targetStr}" here to fist bump.` };
  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} fist bumps ${target.handle}. Yes, we can.` }, null);
  return { type:'emote', message:`You fist bump ${target.handle}.` };
}

async function cmdRecipes(player) {
  const { rows: skillRows } = await query('SELECT skill_id, rank FROM player_skills WHERE player_id = $1', [player.id]);
  const skills = {};
  for (const r of skillRows) skills[r.skill_id] = r.rank;
  const available = getAvailableRecipes(skills);
  if (!available.length) return { type:'recipes', message:'You don\'t know any recipes yet.' };
  let msg = '<span class="skills-header">KNOWN RECIPES</span>\n\n';
  const byCategory = {};
  for (const r of available) { if (!byCategory[r.category]) byCategory[r.category]=[]; byCategory[r.category].push(r); }
  for (const [cat, recipes] of Object.entries(byCategory)) {
    msg += `<span class="skill-category">${cat.toUpperCase()}</span>\n`;
    for (const r of recipes) {
      const station = r.requires_station ? ` [needs: ${r.requires_station.replace(/_/g,' ')}]` : '';
      msg += `  <span class="exits-label">${r.id}</span> — ${r.name}${station}\n    ${r.description}\n`;
    }
    msg += '\n';
  }
  msg += 'Use: <span class="equipped">craft &lt;recipe_id&gt;</span>';
  return { type:'recipes', message:msg };
}

async function cmdCraft(args, player) {
  const recipeId = args.join('_');
  if (!recipeId) return { type:'error', message:'Craft what? Use RECIPES to see available recipes.' };
  const result = await attemptCraft(player, recipeId);
  return { type:result.success ? 'craft' : 'error', message:result.message };
}

async function cmdMutations(player) {
  const muts = await getPlayerMutations(player.id);
  if (!muts.length) return { type:'mutations', message:'No mutations yet. Keep absorbing radiation. Or don\'t. Your call.' };
  let msg = '<span class="skills-header">YOUR MUTATIONS</span>\n\n';
  for (const m of muts) {
    msg += `<span class="zone-name">${m.name}</span>\n${m.description}\n`;
    if (Object.keys(m.stat_modifiers||{}).length) {
      msg += `  Stats: ${Object.entries(m.stat_modifiers).map(([k,v])=>`${k.replace('stat_','')}${v>0?'+':''}${v}`).join(', ')}\n`;
    }
    if (m.drawbacks?.length) msg += `  <span class="msg-error">Drawbacks: ${m.drawbacks.join(', ')}</span>\n`;
    msg += '\n';
  }
  return { type:'mutations', message:msg };
}

async function cmdFactions(player) {
  const reps = await getPlayerFactionRep(player.id);
  let msg = '<span class="skills-header">FACTION STANDING</span>\n\n';
  for (const f of reps) {
    msg += `<span style="color:${f.tier_color}">${f.name.padEnd(24)}</span> ${f.tier_label} (${f.reputation})\n`;
  }
  return { type:'factions', message:msg };
}

async function cmdShop(npcName, player) {
  if (!npcName) return { type:'error', message:'Browse whose shop? (shop <npc name>)' };
  const npcs = getZoneNpcs(player.current_zone);
  const npc = npcs.find(n => n.name.toLowerCase().includes(npcName));
  if (!npc) return { type:'error', message:`Can't find "${npcName}" here.` };
  if (!npc.vendor_inventory?.length) return { type:'error', message:`${npc.name} isn't a vendor.` };
  const stock = await getVendorStock(npc, player.id);
  if (!stock.length) return { type:'error', message:`${npc.name} is out of stock.` };
  let msg = `<span class="inv-header">${npc.name.toUpperCase()} — SHOP</span>\nCredits: ${player.credits||0}\n\n`;
  for (const item of stock) {
    const disc = item.discounted ? ' <span class="equipped">(rep discount)</span>' : '';
    msg += `  [<span class="item-rarity-${item.rarity}">${item.name}</span>] ${item.price}cr${disc}\n    ${item.description}\n`;
  }
  msg += `\nUse: <span class="equipped">buy &lt;item name&gt;</span> or <span class="equipped">sell &lt;item name&gt;</span>`;
  return { type:'shop', message:msg, npc_id:npc.id, stock };
}

async function cmdBuy(args, player) {
  const itemName = args.join(' ');
  if (!itemName) return { type:'error', message:'Buy what?' };
  const npcs = getZoneNpcs(player.current_zone);
  const vendor = npcs.find(n => n.vendor_inventory?.length);
  if (!vendor) return { type:'error', message:'No vendor here.' };
  const stock = await getVendorStock(vendor, player.id);
  const item = stock.find(s => s.name.toLowerCase().includes(itemName));
  if (!item) return { type:'error', message:`"${itemName}" isn't available here.` };
  const result = await buyFromVendor(player, vendor, item.item_id, 1);
  return { type:result.success?'buy':'error', message:result.message, player_update:{credits:player.credits} };
}

async function cmdSell(args, player) {
  const itemName = args.join(' ');
  if (!itemName) return { type:'error', message:'Sell what?' };
  const npcs = getZoneNpcs(player.current_zone);
  const vendor = npcs.find(n => n.vendor_inventory?.length);
  if (!vendor) return { type:'error', message:'No vendor here.' };
  const { rows } = await query(`SELECT pi.id FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 LIMIT 1`, [player.id, `%${itemName}%`]);
  if (!rows.length) return { type:'error', message:`You don't have "${itemName}".` };
  const result = await sellToVendor(player, vendor, rows[0].id, 1);
  return { type:result.success?'sell':'error', message:result.message, player_update:{credits:player.credits} };
}

function zoneHasAtm(zone) {
  return !!(zone?.flags?.has_atm);
}

async function cmdBalance(player) {
  return { type:'balance', message:`Carried: ${player.credits||0}c\nBanked: ${player.bank_credits||0}c` };
}

async function cmdDeposit(amountStr, player) {
  const zone = getZone(player.current_zone);
  if (!zoneHasAtm(zone)) return { type:'error', message:'There\'s no ATM here.' };
  const amount = amountStr === 'all' ? (player.credits||0) : parseInt(amountStr, 10);
  if (!amount || amount <= 0) return { type:'error', message:'Deposit how much? Try "deposit 50" or "deposit all".' };
  if (amount > (player.credits||0)) return { type:'error', message:`You only have ${player.credits||0} credits on you.` };
  player.credits -= amount;
  player.bank_credits = (player.bank_credits||0) + amount;
  await query('UPDATE players SET credits=$1, bank_credits=$2 WHERE id=$3', [player.credits, player.bank_credits, player.id]);
  return { type:'deposit', message:`You deposit ${amount}c. Carried: ${player.credits}c · Banked: ${player.bank_credits}c`, player_update:{credits:player.credits, bank_credits:player.bank_credits} };
}

async function cmdWithdraw(amountStr, player) {
  const zone = getZone(player.current_zone);
  if (!zoneHasAtm(zone)) return { type:'error', message:'There\'s no ATM here.' };
  const amount = amountStr === 'all' ? (player.bank_credits||0) : parseInt(amountStr, 10);
  if (!amount || amount <= 0) return { type:'error', message:'Withdraw how much? Try "withdraw 50" or "withdraw all".' };
  if (amount > (player.bank_credits||0)) return { type:'error', message:`You only have ${player.bank_credits||0} credits banked.` };
  player.bank_credits -= amount;
  player.credits = (player.credits||0) + amount;
  await query('UPDATE players SET credits=$1, bank_credits=$2 WHERE id=$3', [player.credits, player.bank_credits, player.id]);
  return { type:'withdraw', message:`You withdraw ${amount}c. Carried: ${player.credits}c · Banked: ${player.bank_credits}c`, player_update:{credits:player.credits, bank_credits:player.bank_credits} };
}

// Stealing only ever touches carried credits — banked credits are
// explicitly theft-proof per design, that's the entire point of a bank.
const STEAL_COOLDOWN_MS = 60000;
const stealCooldowns = new Map();

async function cmdSteal(targetStr, player, broadcast) {
  if (!targetStr) return { type:'error', message:'Steal from whom?' };
  const zone = getZone(player.current_zone);
  if (zone?.is_safe_zone) return { type:'error', message:'Too many witnesses. Not here.' };

  const last = stealCooldowns.get(player.id) || 0;
  if (Date.now() - last < STEAL_COOLDOWN_MS) {
    return { type:'error', message:`Too soon to try that again. (${Math.ceil((STEAL_COOLDOWN_MS-(Date.now()-last))/1000)}s)` };
  }

  const others = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  const target = others.find(p => p.handle.toLowerCase().includes(targetStr.toLowerCase()));
  if (!target) return { type:'error', message:`Can't find "${targetStr}" here.` };

  stealCooldowns.set(player.id, Date.now());

  if ((target.credits||0) <= 0) return { type:'error', message:`${target.handle} isn't carrying any credits.` };

  // Skill-checked via the same shared roll used for lockpicking elsewhere —
  // Deception, against a flat difficulty. Caught = the whole zone finds
  // out; succeed quietly = nobody's the wiser.
  const result = await skillCheck(player, 'deception', 7);
  const caught = !result.success;
  await awardSkillXp(player.id, 'deception', 2);

  if (caught) {
    broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} tries to pick ${target.handle}'s pocket and gets caught red-handed.` }, player.id);
    return { type:'error', message:`You go for ${target.handle}'s pocket. They notice immediately. Everyone noticed, actually.` };
  }

  const amount = Math.min(target.credits, Math.ceil(target.credits * (0.1 + Math.random()*0.2)));
  target.credits -= amount;
  player.credits = (player.credits||0) + amount;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [target.credits, target.id]);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);

  return { type:'steal', message:`You lift ${amount}c off ${target.handle} without them noticing a thing.`, player_update:{credits:player.credits} };
}

async function cmdLootCorpse(targetStr, player, broadcast) {
  const corpses = getZoneCorpses(player.current_zone);
  if (!corpses.length) return { type:'error', message:'No corpses to loot here.' };

  // Check if it's a player corpse (full loot PvP)
  const { rows } = await query(`SELECT pi.*,i.name,i.is_stackable FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1`, [`_corpse_${player.current_zone}`]);
  if (!rows.length) return { type:'error', message:'Nothing left to loot.' };

  const looted = [];
  for (const item of rows) {
    if (item.is_stackable) {
      const { rows: existing } = await query(
        'SELECT id, quantity FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND is_equipped=0',
        [player.id, item.item_id]
      );
      if (existing.length) {
        await query('UPDATE player_inventory SET quantity = quantity + $1 WHERE id = $2', [item.quantity, existing[0].id]);
        await query('DELETE FROM player_inventory WHERE id=$1', [item.id]);
        looted.push(item.name);
        continue;
      }
    }
    await query('UPDATE player_inventory SET player_id=$1 WHERE id=$2', [player.id, item.id]);
    looted.push(item.name);
  }

  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} loots a corpse.` }, player.id);
  return { type:'loot', message:`You loot the corpse: ${looted.join(', ')}.` };
}

function cmdHelp() {
  return { type:'help', message:`<span class="help-header">COMMANDS</span>

<span class="help-category">MOVEMENT</span>    north south east west up down (n/s/e/w/u/d)  |  go &lt;dir&gt;
<span class="help-category">COMBAT</span>      attack &lt;target&gt;  |  loot &lt;corpse&gt;
<span class="help-category">ITEMS</span>       inventory  take &lt;item&gt;  drop  use  equip
<span class="help-category">CRAFTING</span>    recipes  |  craft &lt;recipe_id&gt;
<span class="help-category">TRADING</span>     shop &lt;npc&gt;  |  buy &lt;item&gt;  |  sell &lt;item&gt;
<span class="help-category">ECONOMY</span>     balance  |  deposit &lt;amt/all&gt;  |  withdraw &lt;amt/all&gt;  (ATM required)  |  steal &lt;player&gt;
<span class="help-category">PROPERTY</span>    rent  |  lock  |  unlock  |  pick  |  upgrade lock  |  sleep
<span class="help-category">CHARACTER</span>   stats  skills  mutations  factions
<span class="help-category">SOCIAL</span>      talk &lt;npc&gt;  |  say &lt;message&gt;  |  who
<span class="help-category">INFO</span>        look  |  look &lt;me/item/player&gt;  |  examine &lt;thing&gt;  help` };
}
