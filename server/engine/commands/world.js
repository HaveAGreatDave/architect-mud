import { query } from '../../models/db.js';
import { getZone, getZoneEnemies, getZoneNpcs, getZonePlayers } from '../world.js';
import { getZonePowerStatus, recomputePower, recalcZoneLoad } from '../environment.js';
import { getPlayerSkills, SKILLS } from '../skills.js';
import { describeZone } from './describe.js';
import { getMinimapData, addPlayerToZone, removePlayerFromZone } from '../world.js';
import { statCost, raiseStat, RAISABLE_STATS } from '../ip.js';
import { ensureTunables } from '../tunables.js';

async function cmdStats(player) {
  const { rows } = await query('SELECT * FROM players WHERE id=$1', [player.id]);
  const p = rows[0];
  if (!p) return { type:'error', message:'Could not load stats.' };
  const radBar = `[${'█'.repeat(Math.floor(p.radiation/10))}${'░'.repeat(10-Math.floor(p.radiation/10))}]`;
  let msg = `<span class="stats-header">${p.handle}</span> — ${p.archetype||'unknown'}\n\n`;
  msg += `HP:     ${p.hp}/${p.hp_max}\nSanity: ${p.sanity}/${p.sanity_max}\nHunger: ${p.hunger}/100\nThirst: ${p.thirst}/100\nRAD:    ${radBar} ${p.radiation}/100\n\n`;
  msg += `BRAWN:${p.stat_brawn}  REFL:${p.stat_reflexes}  BRNS:${p.stat_brains}\nCOOL:${p.stat_cool}  END:${p.stat_endurance}  SENS:${p.stat_senses}\n\nIP: ${p.ip||0}  Credits: ${p.credits}`;

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
      const data = skills[skill.id] || { trained:0 };
      const bars = Math.min(10, Math.round(data.trained));
      msg += `  ${skill.name.padEnd(20)} [${'█'.repeat(bars)}${'░'.repeat(10-bars)}] ${data.trained.toFixed(2)}/10\n`;
    }
    msg += '\n';
  }
  return { type:'skills', message:msg };
}

const BODY_SLOTS = ['head','torso','hands','legs','feet'];
function article(name) { return /^[aeiou]/i.test(name) ? 'an' : 'a'; }

async function describePlayerAppearance(target, isSelf) {
  const { rows: equipped } = await query(
    `SELECT i.name, i.tags FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id=$1 AND pi.is_equipped=1`,
    [target.id]
  );

  // For each body slot, pick the outermost equipped item (highest allowed_layer_range.max).
  const bySlot = {};
  for (const row of equipped) {
    const slot = row.tags?.slot;
    if (!slot) continue;
    const lr = row.tags?.allowed_layer_range;
    const layerMax = (lr && typeof lr === 'object') ? (lr.max || 0) : 99;
    if (!bySlot[slot] || layerMax > bySlot[slot].layerMax) {
      bySlot[slot] = { name: row.name, layerMax };
    }
  }

  const handle = target.handle;
  const origin = target.origin_fragment || '';
  const mutated = target.visibly_mutated;

  const bodyPieces = BODY_SLOTS.filter(s => bySlot[s]).map(s =>
    `${article(bySlot[s].name)} ${bySlot[s].name} on ${isSelf ? 'your' : 'their'} ${s}`
  );
  const weapon = bySlot['weapon_hand'];
  const accessory = bySlot['accessory'];

  let msg = '';
  if (!isSelf) {
    if (origin) msg += `${origin}\n`;
    if (mutated) msg += `<span class="mutation-tag">Something about them isn't quite human anymore.</span>\n`;
  } else {
    if (mutated) msg += `<span class="mutation-tag">Something about you isn't quite human anymore.</span>\n`;
  }

  if (!bodyPieces.length && !weapon && !accessory) {
    const nakedLines = isSelf
      ? [
          `You have nothing on. Not a thread. You are, in the technical sense, naked.`,
          `You're wearing exactly nothing. It's a look. A bold one.`,
          `You are completely undressed. Whether that's a statement or an oversight isn't clear.`,
        ]
      : [
          `${handle} is wearing nothing. Absolutely nothing. You respect the commitment.`,
          `${handle} has nothing on. Not a stitch. You make a note of this and move on.`,
          `${handle} is completely undressed. They seem unbothered by it.`,
        ];
    msg += nakedLines[Math.floor(Math.random() * nakedLines.length)];
    return msg.trim();
  }

  const sentences = [];
  let namedUsed = false;

  function nameOrThey(nameForm, theyForm) {
    if (isSelf) return nameForm;
    if (!namedUsed) { namedUsed = true; return `${handle} ${nameForm}`; }
    return theyForm;
  }

  if (bodyPieces.length) {
    sentences.push(`${nameOrThey('are wearing', 'They are wearing')} ${bodyPieces.join(', ')}.`);
  }

  if (weapon) {
    sentences.push(`${nameOrThey('are carrying', 'They are carrying')} ${article(weapon.name)} ${weapon.name}.`);
  }

  if (accessory) {
    sentences.push(`${nameOrThey('have', 'They have')} ${article(accessory.name)} ${accessory.name} ${isSelf ? 'on you' : 'on them'}.`);
  }

  msg += sentences.join(' ');
  return msg.trim();
}

async function cmdExamine(targetStr, player) {
  if (!targetStr || targetStr === 'room') {
    const zone = getZone(player.current_zone);
    if (!zone) return { type:'error', message:'You are nowhere. This is a bug.' };
    return { type:'look', message: await describeZone(zone, player), minimap: getMinimapData(player.current_zone) };
  }

  const t = targetStr.toLowerCase();

  // Self-look
  if (t === 'me' || t === 'myself' || t === 'self') {
    return { type:'examine', message: await describePlayerAppearance(player, true) };
  }

  const { rows } = await query(`SELECT pi.id AS inv_id, i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.container_id IS NULL AND i.name ILIKE $2 LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (rows.length) {
    const it = rows[0];
    let msg = `${it.name}\n${it.description}`;
    if (it.tags && Object.prototype.hasOwnProperty.call(it.tags, 'container')) {
      const { describeContainer } = await import('./inventory.js');
      msg += `\n\n${await describeContainer({ id: it.inv_id, name: it.name, tags: it.tags })}`;
    }
    return { type:'examine', message: msg };
  }
  const { rows: furnitureRows } = await query(`SELECT * FROM furniture WHERE zone_id=$1 AND name ILIKE $2 LIMIT 1`, [player.current_zone, `%${targetStr}%`]);
  if (furnitureRows.length) {
    const f = furnitureRows[0];
    let msg = `${f.name}\n${f.description}`;
    if (f.is_light) {
      msg += f.light_type === 'streetlight'
        ? `\n<span class="light-state ${f.light_on ? 'light-on' : 'light-off'}">Currently ${f.light_on ? 'lit' : 'dark'} — city-grid controlled, no switch out here.</span>`
        : `\n<span class="light-state ${f.light_on ? 'light-on' : 'light-off'}">Currently ${f.light_on ? 'on' : 'off'}. There's a switch.</span>`;
    }
    return { type:'examine', message: msg };
  }
  const matchAnyGenerator = /generator/i.test(targetStr);
  const { rows: generatorRows } = await query(
    `SELECT * FROM generators WHERE zone_id=$1 AND ($2 OR name ILIKE $3) LIMIT 1`,
    [player.current_zone, matchAnyGenerator, `%${targetStr}%`]
  );
  if (generatorRows.length) {
    const gen = generatorRows[0];
    const { rows: loadRows } = await query(
      `SELECT COALESCE(SUM(current_load_kw),0)::float AS total_load, COUNT(*)::int AS zone_count FROM power_zones WHERE generator_id=$1`,
      [gen.id]
    );
    const totalLoad = loadRows[0]?.total_load || 0;
    const zoneCount = loadRows[0]?.zone_count || 0;
    const statusLabel = gen.status === 'online' ? 'RUNNING' : gen.status.toUpperCase();
    const typeLabel = gen.generator_type === 'city_plant' ? 'city power plant' : gen.generator_type === 'building' ? 'building generator' : 'portable generator';
    let msg = `${gen.name || 'Generator'}\nA permanent ${typeLabel}. No fuel required — it just runs.\n\n` +
      `STATUS: ${statusLabel}\nOUTPUT: ${gen.capacity_kw}kW capacity, ${totalLoad}kW current draw\n` +
      `SERVING: ${zoneCount} zone${zoneCount === 1 ? '' : 's'}`;
    if (totalLoad > gen.capacity_kw) msg += `\n<span class="generator-overload">⚠ OVERLOADED — drawing more than rated capacity.</span>`;
    return { type:'examine', message: msg };
  }
  const enemies = getZoneEnemies(player.current_zone);
  const enemy = enemies.find(e=>e.name.toLowerCase().includes(t));
  if (enemy) return { type:'examine', message:`${enemy.name}\n${enemy.description}\nHP: ${enemy.hp}/${enemy.hp_max}` };
  const npcs = getZoneNpcs(player.current_zone);
  const npc = npcs.find(n=>n.name.toLowerCase().includes(t));
  if (npc) return { type:'examine', message:`${npc.name}\n${npc.description}` };

  // Other players in zone + sleeping
  const others = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  const targetPlayer = others.find(p => p.handle.toLowerCase().includes(t));
  if (targetPlayer) {
    return { type:'examine', message: await describePlayerAppearance(targetPlayer, false) };
  }
  const { rows: sleepers } = await query(
    `SELECT * FROM players WHERE LOWER(handle) LIKE $1 AND current_zone=$2 AND offline_sleeping=TRUE LIMIT 1`,
    [`%${t}%`, player.current_zone]
  );
  if (sleepers.length) {
    const s = sleepers[0];
    const app = await describePlayerAppearance(s, false);
    return { type:'examine', message: app + `\n<span class="text-dim">(${s.handle} is asleep.)</span>` };
  }

  return { type:'error', message:`You don't see "${targetStr}" here.` };
}

async function cmdSwitch(targetStr, player) {
  if (!targetStr) return { type:'error', message:'Switch what? Usage: switch <light name>' };
  const { rows } = await query(`SELECT * FROM furniture WHERE zone_id=$1 AND object_type='light' AND name ILIKE $2 LIMIT 1`, [player.current_zone, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`You don't see a light called "${targetStr}" here.` };
  const light = rows[0];
  if (light.light_type === 'streetlight') {
    return { type:'error', message:`${light.name} is city-grid infrastructure — it comes on by itself once it gets dark. There's no switch out here.` };
  }
  const powerStatus = getZonePowerStatus(player.current_zone);
  if (powerStatus === 'unpowered') {
    return { type:'error', message:`The switch clicks, but nothing happens. No power reaches this room.` };
  }
  const newState = light.light_on ? 0 : 1;
  await query(`UPDATE furniture SET light_on=$1 WHERE id=$2`, [newState, light.id]);
  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm FROM furniture WHERE zone_id=$1 AND object_type='light' AND light_on=1`,
    [player.current_zone]
  );
  await query(`UPDATE lighting_states SET fixture_count=$1, total_lumens=$2 WHERE zone_id=$3`, [countRows[0]?.cnt || 0, countRows[0]?.lm || 0, player.current_zone]).catch(()=>{});
  await recalcZoneLoad(query, player.current_zone).catch(()=>{});
  await recomputePower().catch(()=>{});
  return { type:'action', message: newState
    ? `You flip the switch. ${light.name} flickers on.`
    : `You flip the switch. ${light.name} goes dark.` };
}

async function cmdTurn(args, player) {
  const dir = args[args.length - 1]?.toLowerCase();
  if (dir !== 'on' && dir !== 'off') {
    return { type:'error', message:'Usage: turn <light name> on/off' };
  }
  const targetStr = args.slice(0, -1).join(' ');
  if (!targetStr) return { type:'error', message:'Turn what? Usage: turn <light name> on/off' };
  const { rows } = await query(`SELECT * FROM furniture WHERE zone_id=$1 AND object_type='light' AND name ILIKE $2 LIMIT 1`, [player.current_zone, `%${targetStr}%`]);
  if (!rows.length) return { type:'error', message:`You don't see a light called "${targetStr}" here.` };
  const light = rows[0];
  if (light.light_type === 'streetlight') {
    return { type:'error', message:`${light.name} is city-grid infrastructure — it comes on by itself. There's no switch out here.` };
  }
  const newState = dir === 'on' ? 1 : 0;
  if (light.light_on === newState) {
    return { type:'message', message:`${light.name} is already ${dir}.` };
  }
  const powerStatus = getZonePowerStatus(player.current_zone);
  if (powerStatus === 'unpowered' && newState === 1) {
    return { type:'error', message:`The switch clicks, but nothing happens. No power reaches this room.` };
  }
  await query(`UPDATE furniture SET light_on=$1 WHERE id=$2`, [newState, light.id]);
  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm FROM furniture WHERE zone_id=$1 AND object_type='light' AND light_on=1`,
    [player.current_zone]
  );
  await query(`UPDATE lighting_states SET fixture_count=$1, total_lumens=$2 WHERE zone_id=$3`, [countRows[0]?.cnt || 0, countRows[0]?.lm || 0, player.current_zone]).catch(()=>{});
  await recalcZoneLoad(query, player.current_zone).catch(()=>{});
  await recomputePower().catch(()=>{});
  return { type:'action', message: newState
    ? `You flip the switch. ${light.name} flickers on.`
    : `You flip the switch. ${light.name} goes dark.` };
}

async function cmdTeleport(targetZoneId, player, broadcast) {
  if (player.role !== 'admin') return { type:'error', message:"You don't have the clearance for that." };
  if (!targetZoneId) return { type:'error', message:'Teleport where? Usage: teleport <zone id>' };
  const targetZone = getZone(targetZoneId);
  if (!targetZone) return { type:'error', message:`No zone with id "${targetZoneId}" exists.` };

  const oldZoneId = player.current_zone;
  removePlayerFromZone(player.id, oldZoneId);
  addPlayerToZone(player.id, targetZoneId);
  player.current_zone = targetZoneId;
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [targetZoneId, player.id]);

  broadcast(oldZoneId, { type:'zone_event', message:`${player.handle} vanishes in a flicker of static.` }, player.id);
  broadcast(targetZoneId, { type:'zone_event', message:`${player.handle} flickers into existence out of nowhere.` }, player.id);

  return { type:'move', message: await describeZone(targetZone, player), zone: targetZoneId, minimap: getMinimapData(targetZoneId) };
}

function cmdHelp(player) {
  let msg = `<span class="help-header">COMMANDS</span>

<span class="help-category">MOVEMENT</span>    north south east west up down (n/s/e/w/u/d)  |  go &lt;dir&gt;
<span class="help-category">COMBAT</span>      attack &lt;target&gt;  |  loot &lt;corpse&gt;
<span class="help-category">ITEMS</span>       inventory  take &lt;item&gt;  drop  use  equip
<span class="help-category">CONTAINERS</span>  look in &lt;container&gt;  |  stow &lt;item&gt; in &lt;container&gt;  |  pull &lt;item&gt; from &lt;container&gt;
<span class="help-category">CRAFTING</span>    recipes  |  craft &lt;recipe_id&gt;
<span class="help-category">TRADING</span>     shop &lt;npc&gt;  |  buy &lt;item&gt;  |  sell &lt;item&gt;
<span class="help-category">ECONOMY</span>     balance  |  deposit &lt;amt/all&gt;  |  withdraw &lt;amt/all&gt;  (ATM required)  |  steal &lt;player&gt;
<span class="help-category">PROPERTY</span>    rent  |  lock  |  unlock  |  pick  |  upgrade lock  |  sleep
<span class="help-category">CHARACTER</span>   stats  skills  raise [stat]  mutations  factions
<span class="help-category">SOCIAL</span>      talk &lt;npc&gt;  |  say &lt;message&gt;  |  who  |  whisper/tell &lt;player&gt; &lt;msg&gt;
<span class="help-category">WORLD</span>       map  |  switch &lt;light&gt;  |  turn &lt;light&gt; on/off
<span class="help-category">INFO</span>        look  |  look &lt;me/item/player&gt;  |  examine &lt;thing&gt;  help`;
  if (player?.role === 'admin') {
    msg += `\n<span class="help-category">ADMIN</span>      teleport &lt;zone id&gt;  (tp)`;
  }
  return { type:'help', message: msg };
}

async function cmdRaise(args, player) {
  await ensureTunables();
  const statName = args[0]?.toLowerCase();

  const { rows } = await query(
    'SELECT ip, stat_brawn, stat_reflexes, stat_endurance, stat_brains, stat_senses, stat_cool FROM players WHERE id=$1',
    [player.id]
  );
  const p = rows[0];

  if (!statName) {
    const ip = p?.ip || 0;
    let msg = `<span class="help-header">IMPROVEMENT POINTS — ${Math.floor(ip)} IP</span>\n\n`;
    for (const stat of RAISABLE_STATS) {
      const cur = p[`stat_${stat}`] || 0;
      const cost = statCost(cur);
      msg += `  ${stat.padEnd(12)} ${String(cur).padStart(2)}  →  ${cost} IP\n`;
    }
    msg += `\nUsage: raise <stat>`;
    return { type: 'help', message: msg };
  }

  const result = await raiseStat(player.id, statName);
  if (result.error) return { type: 'error', message: result.error };

  player[result.col] = result.to;

  const msg = `You invest ${result.cost} IP improving your ${result.stat} (${result.from} → ${result.to}).\nIP remaining: ${Math.floor(result.ip_remaining)}`;
  return { type: 'raise', message: msg, player_update: { [result.col]: result.to, ip: result.ip_remaining } };
}

async function cmdOpenWindow(args, player, action) {
  // args: [handle, 'curtains'?] or [handle]
  if (!args.length) return { type:'error', message:`${action} what? Try: ${action} <window handle>` };
  const handle = args[0];
  const curtainsOnly = args[1] === 'curtains';
  const { rows } = await query('SELECT * FROM windows WHERE zone_interior=$1 AND (handle=$2 OR id=$2)', [player.current_zone, handle]);
  if (!rows.length) return { type:'error', message:`You don't see a window called "${handle}" here.` };
  const win = rows[0];
  if (action === 'open') {
    if (win.curtain_open && !curtainsOnly) return { type:'message', message:`The curtains on ${win.name} are already open.` };
    await query('UPDATE windows SET curtain_open=1 WHERE id=$1', [win.id]);
    return { type:'message', message:`You open the curtains on ${win.name}.` };
  } else {
    if (!win.curtain_open && !curtainsOnly) return { type:'message', message:`The curtains on ${win.name} are already closed.` };
    await query('UPDATE windows SET curtain_open=0 WHERE id=$1', [win.id]);
    return { type:'message', message:`You draw the curtains on ${win.name}.` };
  }
}

export const handlers = {
  examine:  (args, raw, player) => cmdExamine(args.join(' '), player),
  ex:       (args, raw, player) => cmdExamine(args.join(' '), player),
  x:        (args, raw, player) => cmdExamine(args.join(' '), player),
  switch:   (args, raw, player) => cmdSwitch(args.join(' '), player),
  flip:     (args, raw, player) => cmdSwitch(args.join(' '), player),
  turn:     (args, raw, player) => cmdTurn(args, player),
  stats:    (args, raw, player) => cmdStats(player),
  status:   (args, raw, player) => cmdStats(player),
  st:       (args, raw, player) => cmdStats(player),
  skills:   (args, raw, player) => cmdSkills(player),
  help:     (args, raw, player) => cmdHelp(player),
  '?':      (args, raw, player) => cmdHelp(player),
  teleport: (args, raw, player, broadcast) => cmdTeleport(args.join(' '), player, broadcast),
  tp:       (args, raw, player, broadcast) => cmdTeleport(args.join(' '), player, broadcast),
  open:     (args, raw, player) => cmdOpenWindow(args, player, 'open'),
  close:    (args, raw, player) => cmdOpenWindow(args, player, 'close'),
  raise:    (args, raw, player) => cmdRaise(args, player),
  ip:       (args, raw, player) => cmdRaise([], player),
};
