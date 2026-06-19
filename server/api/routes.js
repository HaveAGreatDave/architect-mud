import { query } from '../models/db.js';
import { reloadZone, getAllZones, world } from '../engine/world.js';
import { randomUUID, createHash } from 'crypto';

const hashPassword = pw => createHash('sha256').update(pw).digest('hex');
const makeToken = (playerId, role) => Buffer.from(`${playerId}:${role}:${Date.now()}`).toString('base64');
function verifyToken(headers) {
  const token = (headers?.authorization||'').replace('Bearer ','');
  if (!token) return null;
  try {
    const [playerId, role, ts] = Buffer.from(token,'base64').toString().split(':');
    if (Date.now() - parseInt(ts) > 86400000) return null;
    return { playerId, role };
  } catch { return null; }
}
function requireDev(auth, fn) {
  if (!auth || !['dev','admin','builder','designer'].includes(auth.role)) return { status:403, body:{error:'Dev access required'} };
  return fn();
}
function requireAdmin(auth, fn) {
  if (!auth || auth.role !== 'admin') return { status:403, body:{error:'Admin access required'} };
  return fn();
}

export async function handleApiRequest(url, method, body, headers) {
  const path = url.replace(/^\/api/,'').split('?')[0];
  const auth = verifyToken(headers);

  if (path==='/auth/register' && method==='POST') return apiRegister(body);
  if (path==='/auth/login' && method==='POST') return apiLogin(body);
  if (path==='/zones' && method==='GET') return apiGetZones();
  if (path.startsWith('/zones/') && method==='GET') return apiGetZone(path.split('/')[2]);
  if (path==='/zones' && method==='POST') return requireDev(auth, ()=>apiCreateZone(body,auth));
  if (path.startsWith('/zones/') && method==='PUT') return requireDev(auth, ()=>apiUpdateZone(path.split('/')[2],body));
  if (path.startsWith('/zones/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteZone(path.split('/')[2]));
  if (path==='/enemies' && method==='GET') return requireDev(auth, apiGetEnemies);
  if (path==='/enemies' && method==='POST') return requireDev(auth, ()=>apiCreateEnemy(body));
  if (path.startsWith('/enemies/') && method==='PUT') return requireDev(auth, ()=>apiUpdateEnemy(path.split('/')[2],body));
  if (path.startsWith('/enemies/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteEnemy(path.split('/')[2]));
  if (path==='/items' && method==='GET') return requireDev(auth, apiGetItems);
  if (path==='/items' && method==='POST') return requireDev(auth, ()=>apiCreateItem(body));
  if (path.startsWith('/items/') && method==='PUT') return requireDev(auth, ()=>apiUpdateItem(path.split('/')[2],body));
  if (path==='/npcs' && method==='GET') return requireDev(auth, apiGetNpcs);
  if (path==='/npcs' && method==='POST') return requireDev(auth, ()=>apiCreateNpc(body));
  if (path.startsWith('/npcs/') && method==='PUT') return requireDev(auth, ()=>apiUpdateNpc(path.split('/')[2],body));
  if (path==='/factions' && method==='GET') { const {rows}=await query('SELECT * FROM factions'); return {status:200,body:rows}; }
  if (path==='/world/state' && method==='GET') return requireDev(auth, apiWorldState);
  if (path==='/world/reload' && method==='POST') return requireDev(auth, ()=>apiReloadZone(body));
  if (path==='/players' && method==='GET') return requireAdmin(auth, apiGetPlayers);
  return { status:404, body:{error:'Not found'} };
}

async function apiRegister(body) {
  const {username,password,handle} = body||{};
  if (!username||!password||!handle) return {status:400,body:{error:'username, password, handle required'}};
  try {
    const id = randomUUID();
    await query(`INSERT INTO players (id,username,password_hash,handle,role) VALUES ($1,$2,$3,$4,'player')`, [id,username.toLowerCase(),hashPassword(password),handle]);
    return {status:201,body:{token:makeToken(id,'player'),playerId:id,handle,role:'player'}};
  } catch { return {status:409,body:{error:'Username or handle already taken'}}; }
}

async function apiLogin(body) {
  const {username,password} = body||{};
  if (!username||!password) return {status:400,body:{error:'username and password required'}};
  const {rows} = await query('SELECT * FROM players WHERE username=$1',[username.toLowerCase()]);
  if (!rows.length||rows[0].password_hash!==hashPassword(password)) return {status:401,body:{error:'Invalid credentials'}};
  return {status:200,body:{token:makeToken(rows[0].id,rows[0].role),playerId:rows[0].id,handle:rows[0].handle,role:rows[0].role}};
}

async function apiGetZones() { return {status:200,body:getAllZones()}; }
async function apiGetZone(id) {
  const {rows} = await query('SELECT * FROM zones WHERE id=$1',[id]);
  if (!rows.length) return {status:404,body:{error:'Not found'}};
  return {status:200,body:rows[0]};
}
async function apiCreateZone(body,auth) {
  const id = body.id||`zone_${Date.now()}`;
  try {
    await query(`INSERT INTO zones (id,name,description,danger_rating,pvp_enabled,radiation_level,is_safe_zone,exits,ambient_events,flags,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id,body.name||'Unnamed Zone',body.description||'An empty place.',body.danger_rating||'medium',body.pvp_enabled?1:0,body.radiation_level||0,body.is_safe_zone?1:0,JSON.stringify(body.exits||{}),JSON.stringify(body.ambient_events||[]),JSON.stringify(body.flags||{}),auth?.playerId]);
    await reloadZone(id);
    return {status:201,body:{id,message:'Zone created and live'}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiUpdateZone(id,body) {
  const sets=[]; const vals=[];
  let i=1;
  const simple=['name','description','danger_rating','pvp_enabled','radiation_level','is_safe_zone'];
  for (const f of simple) if (body[f]!==undefined) { sets.push(`${f}=$${i++}`); vals.push(body[f]); }
  if (body.exits!==undefined) { sets.push(`exits=$${i++}`); vals.push(JSON.stringify(body.exits)); }
  if (body.ambient_events!==undefined) { sets.push(`ambient_events=$${i++}`); vals.push(JSON.stringify(body.ambient_events)); }
  if (body.flags!==undefined) { sets.push(`flags=$${i++}`); vals.push(JSON.stringify(body.flags)); }
  sets.push(`updated_at=EXTRACT(EPOCH FROM NOW())`);
  vals.push(id);
  await query(`UPDATE zones SET ${sets.join(',')} WHERE id=$${i}`,vals);
  await reloadZone(id);
  return {status:200,body:{id,message:'Zone updated and live'}};
}
async function apiDeleteZone(id) {
  if (id==='zone_start') return {status:400,body:{error:'Cannot delete spawn zone'}};
  await query('DELETE FROM zones WHERE id=$1',[id]);
  world.zones.delete(id);
  return {status:200,body:{message:'Zone deleted'}};
}
async function apiGetEnemies() { const {rows}=await query('SELECT * FROM enemies'); return {status:200,body:rows}; }
async function apiCreateEnemy(body) {
  const id=body.id||`enemy_${Date.now()}`;
  try {
    await query(`INSERT INTO enemies (id,name,description,stat_str,stat_agi,stat_end,hp_max,damage_min,damage_max,armor,xp_reward,credit_reward,loot_table,behavior,faction,death_message,flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [id,body.name,body.description,body.stat_str||5,body.stat_agi||5,body.stat_end||5,body.hp_max||30,body.damage_min||3,body.damage_max||7,body.armor||0,body.xp_reward||10,body.credit_reward||0,JSON.stringify(body.loot_table||[]),body.behavior||'aggressive',body.faction||null,body.death_message||'It dies.',JSON.stringify(body.flags||{})]);
    return {status:201,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiUpdateEnemy(id,body) {
  await query(`UPDATE enemies SET name=$1,description=$2,stat_str=$3,stat_agi=$4,stat_end=$5,hp_max=$6,damage_min=$7,damage_max=$8,armor=$9,xp_reward=$10,credit_reward=$11,loot_table=$12,behavior=$13,faction=$14,death_message=$15,flags=$16 WHERE id=$17`,
    [body.name,body.description,body.stat_str,body.stat_agi,body.stat_end,body.hp_max,body.damage_min,body.damage_max,body.armor,body.xp_reward,body.credit_reward,JSON.stringify(body.loot_table||[]),body.behavior,body.faction,body.death_message,JSON.stringify(body.flags||{}),id]);
  return {status:200,body:{id}};
}
async function apiDeleteEnemy(id) { await query('DELETE FROM enemies WHERE id=$1',[id]); return {status:200,body:{message:'Deleted'}}; }
async function apiGetItems() { const {rows}=await query('SELECT * FROM items'); return {status:200,body:rows}; }
async function apiCreateItem(body) {
  const id=body.id||`item_${Date.now()}`;
  try {
    await query(`INSERT INTO items (id,name,description,type,subtype,weight,value,rarity,is_stackable,is_unique,is_quest_item,effects,stat_modifiers,requirements,flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id,body.name,body.description,body.type||'misc',body.subtype||null,body.weight||1,body.value||0,body.rarity||'common',body.is_stackable?1:0,body.is_unique?1:0,body.is_quest_item?1:0,JSON.stringify(body.effects||{}),JSON.stringify(body.stat_modifiers||{}),JSON.stringify(body.requirements||{}),JSON.stringify(body.flags||{})]);
    return {status:201,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiUpdateItem(id,body) {
  await query(`UPDATE items SET name=$1,description=$2,type=$3,subtype=$4,weight=$5,value=$6,rarity=$7,is_stackable=$8,effects=$9,stat_modifiers=$10,requirements=$11,flags=$12 WHERE id=$13`,
    [body.name,body.description,body.type,body.subtype,body.weight,body.value,body.rarity,body.is_stackable?1:0,JSON.stringify(body.effects||{}),JSON.stringify(body.stat_modifiers||{}),JSON.stringify(body.requirements||{}),JSON.stringify(body.flags||{}),id]);
  return {status:200,body:{id}};
}
async function apiGetNpcs() { const {rows}=await query('SELECT * FROM npcs'); return {status:200,body:rows}; }
async function apiCreateNpc(body) {
  const id=body.id||`npc_${Date.now()}`;
  try {
    await query(`INSERT INTO npcs (id,name,description,zone_id,faction,disposition,dialogue_tree,vendor_inventory,wanders,flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id,body.name,body.description,body.zone_id||null,body.faction||null,body.disposition||'neutral',JSON.stringify(body.dialogue_tree||{}),JSON.stringify(body.vendor_inventory||[]),body.wanders?1:0,JSON.stringify(body.flags||{})]);
    return {status:201,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiUpdateNpc(id,body) {
  await query(`UPDATE npcs SET name=$1,description=$2,zone_id=$3,faction=$4,disposition=$5,dialogue_tree=$6,vendor_inventory=$7,wanders=$8,flags=$9 WHERE id=$10`,
    [body.name,body.description,body.zone_id,body.faction,body.disposition,JSON.stringify(body.dialogue_tree||{}),JSON.stringify(body.vendor_inventory||[]),body.wanders?1:0,JSON.stringify(body.flags||{}),id]);
  return {status:200,body:{id}};
}
async function apiWorldState() {
  const {rows:players} = await query(`SELECT handle,current_zone FROM players WHERE last_seen > $1`,[Math.floor(Date.now()/1000)-300]);
  return {status:200,body:{zones:getAllZones(),online_players:players,live_enemies:world.enemies.size,live_corpses:world.corpses.size}};
}
async function apiReloadZone(body) {
  if (!body?.zone_id) return {status:400,body:{error:'zone_id required'}};
  await reloadZone(body.zone_id);
  return {status:200,body:{message:`Zone ${body.zone_id} reloaded`}};
}
async function apiGetPlayers() {
  const {rows}=await query('SELECT id,username,handle,role,current_zone,credits,created_at,last_seen FROM players');
  return {status:200,body:rows};
}
