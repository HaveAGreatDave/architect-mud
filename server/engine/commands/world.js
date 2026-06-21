import { query } from '../../models/db.js';
import { getZone, getZoneEnemies, getZoneNpcs, getZonePlayers } from '../world.js';
import { getZonePowerStatus, recomputePower } from '../environment.js';
import { getPlayerSkills, SKILLS } from '../skills.js';
import { describeZone } from './describe.js';
import { getMinimapData, addPlayerToZone, removePlayerFromZone } from '../world.js';

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

async function cmdExamine(targetStr, player) {
  if (!targetStr || targetStr === 'room') {
    const zone = getZone(player.current_zone);
    if (!zone) return { type:'error', message:'You are nowhere. This is a bug.' };
    return { type:'look', message: await describeZone(zone, player), minimap: getMinimapData(player.current_zone) };
  }
  const { rows } = await query(`SELECT i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND i.name ILIKE $2 LIMIT 1`, [player.id, `%${targetStr}%`]);
  if (rows.length) return { type:'examine', message:`${rows[0].name}\n${rows[0].description}` };
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

async function cmdSwitch(targetStr, player) {
  if (!targetStr) return { type:'error', message:'Switch what? Usage: switch <light name>' };
  const { rows } = await query(`SELECT * FROM furniture WHERE zone_id=$1 AND is_light=1 AND name ILIKE $2 LIMIT 1`, [player.current_zone, `%${targetStr}%`]);
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
    `SELECT COUNT(*)::int AS cnt FROM furniture WHERE zone_id=$1 AND is_light=1 AND light_on=1`,
    [player.current_zone]
  );
  await query(`UPDATE lighting_states SET fixture_count=$1 WHERE zone_id=$2`, [countRows[0]?.cnt || 0, player.current_zone]).catch(()=>{});
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
<span class="help-category">CRAFTING</span>    recipes  |  craft &lt;recipe_id&gt;
<span class="help-category">TRADING</span>     shop &lt;npc&gt;  |  buy &lt;item&gt;  |  sell &lt;item&gt;
<span class="help-category">ECONOMY</span>     balance  |  deposit &lt;amt/all&gt;  |  withdraw &lt;amt/all&gt;  (ATM required)  |  steal &lt;player&gt;
<span class="help-category">PROPERTY</span>    rent  |  lock  |  unlock  |  pick  |  upgrade lock  |  sleep
<span class="help-category">CHARACTER</span>   stats  skills  mutations  factions
<span class="help-category">SOCIAL</span>      talk &lt;npc&gt;  |  say &lt;message&gt;  |  who  |  whisper/tell &lt;player&gt; &lt;msg&gt;
<span class="help-category">WORLD</span>       map  |  switch &lt;light&gt;  (flip)
<span class="help-category">INFO</span>        look  |  look &lt;me/item/player&gt;  |  examine &lt;thing&gt;  help`;
  if (player?.role === 'admin') {
    msg += `\n<span class="help-category">ADMIN</span>      teleport &lt;zone id&gt;  (tp)`;
  }
  return { type:'help', message: msg };
}

export const handlers = {
  examine:  (args, raw, player) => cmdExamine(args.join(' '), player),
  ex:       (args, raw, player) => cmdExamine(args.join(' '), player),
  x:        (args, raw, player) => cmdExamine(args.join(' '), player),
  switch:   (args, raw, player) => cmdSwitch(args.join(' '), player),
  flip:     (args, raw, player) => cmdSwitch(args.join(' '), player),
  stats:    (args, raw, player) => cmdStats(player),
  status:   (args, raw, player) => cmdStats(player),
  st:       (args, raw, player) => cmdStats(player),
  skills:   (args, raw, player) => cmdSkills(player),
  help:     (args, raw, player) => cmdHelp(player),
  '?':      (args, raw, player) => cmdHelp(player),
  teleport: (args, raw, player, broadcast) => cmdTeleport(args.join(' '), player, broadcast),
  tp:       (args, raw, player, broadcast) => cmdTeleport(args.join(' '), player, broadcast),
};
