import { query } from '../models/db.js';
import { reloadZone, getAllZones, world, getAllLivePlayers } from '../engine/world.js';
import { loadRecipes } from '../engine/crafting.js';
import { loadDrugs } from '../engine/drugs.js';
import { loadMutations } from '../engine/mutations.js';
import { randomUUID, createHash } from 'crypto';
import { handleEnvironmentApi } from './environment.routes.js';

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

  const envResult = await handleEnvironmentApi(path, method, body, auth);
  if (envResult) return envResult;

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
  if (path==='/recipes' && method==='GET') return requireDev(auth, apiGetRecipes);
  if (path==='/recipes' && method==='POST') return requireDev(auth, ()=>apiCreateRecipe(body));
  if (path.startsWith('/recipes/') && method==='PUT') return requireDev(auth, ()=>apiUpdateRecipe(path.split('/')[2],body));
  if (path.startsWith('/recipes/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteRecipe(path.split('/')[2]));
  if (path==='/apartments' && method==='GET') return requireDev(auth, apiGetApartments);
  if (path==='/apartments/build' && method==='POST') return requireDev(auth, ()=>apiBuildApartmentBlock(body));
  if (path.startsWith('/apartments/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteApartment(path.split('/')[2]));
  if (path==='/drugs' && method==='GET') return requireDev(auth, apiGetDrugs);
  if (path==='/drugs' && method==='POST') return requireDev(auth, ()=>apiCreateDrug(body));
  if (path.startsWith('/drugs/') && method==='PUT') return requireDev(auth, ()=>apiUpdateDrug(path.split('/')[2],body));
  if (path.startsWith('/drugs/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteDrug(path.split('/')[2]));
  if (path==='/mutations' && method==='GET') return requireDev(auth, apiGetMutations);
  if (path==='/mutations' && method==='POST') return requireDev(auth, ()=>apiCreateMutation(body));
  if (path.startsWith('/mutations/') && method==='PUT') return requireDev(auth, ()=>apiUpdateMutation(path.split('/')[2],body));
  if (path.startsWith('/mutations/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteMutation(path.split('/')[2]));
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
    // Starting kit — every new survivor begins with field bandages, so
    // there's at least one source of healing before they've found or
    // crafted anything else.
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,'item_bandage',3,1.0)`, [randomUUID(), id]);
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
  const boolFields = ['pvp_enabled','is_safe_zone'];
  const simple=['name','description','danger_rating','pvp_enabled','radiation_level','is_safe_zone'];
  for (const f of simple) {
    if (body[f]!==undefined) {
      sets.push(`${f}=$${i++}`);
      // pvp_enabled / is_safe_zone are INTEGER columns (0/1) — coerce
      // booleans from the client instead of letting pg choke on "false"/"true"
      vals.push(boolFields.includes(f) ? (body[f] ? 1 : 0) : body[f]);
    }
  }
  if (body.exits!==undefined) { sets.push(`exits=$${i++}`); vals.push(JSON.stringify(body.exits)); }
  if (body.ambient_events!==undefined) { sets.push(`ambient_events=$${i++}`); vals.push(JSON.stringify(body.ambient_events)); }
  if (body.flags!==undefined) { sets.push(`flags=$${i++}`); vals.push(JSON.stringify(body.flags)); }
  sets.push(`updated_at=EXTRACT(EPOCH FROM NOW())`);
  vals.push(id);
  try {
    await query(`UPDATE zones SET ${sets.join(',')} WHERE id=$${i}`,vals);
    await reloadZone(id);
    return {status:200,body:{id,message:'Zone updated and live'}};
  } catch(e) {
    return {status:400,body:{error:e.message}};
  }
}
async function apiDeleteZone(id) {
  if (id==='zone_start') return {status:400,body:{error:'Cannot delete spawn zone'}};
  try {
    await query('DELETE FROM zones WHERE id=$1',[id]);
    world.zones.delete(id);
    return {status:200,body:{message:'Zone deleted'}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
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
  try {
    await query(`UPDATE enemies SET name=$1,description=$2,stat_str=$3,stat_agi=$4,stat_end=$5,hp_max=$6,damage_min=$7,damage_max=$8,armor=$9,xp_reward=$10,credit_reward=$11,loot_table=$12,behavior=$13,faction=$14,death_message=$15,flags=$16 WHERE id=$17`,
      [body.name,body.description,body.stat_str,body.stat_agi,body.stat_end,body.hp_max,body.damage_min,body.damage_max,body.armor,body.xp_reward,body.credit_reward,JSON.stringify(body.loot_table||[]),body.behavior,body.faction,body.death_message,JSON.stringify(body.flags||{}),id]);
    return {status:200,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiDeleteEnemy(id) {
  try {
    await query('DELETE FROM enemies WHERE id=$1',[id]);
    return {status:200,body:{message:'Deleted'}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
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
  try {
    await query(`UPDATE items SET name=$1,description=$2,type=$3,subtype=$4,weight=$5,value=$6,rarity=$7,is_stackable=$8,effects=$9,stat_modifiers=$10,requirements=$11,flags=$12 WHERE id=$13`,
      [body.name,body.description,body.type,body.subtype,body.weight,body.value,body.rarity,body.is_stackable?1:0,JSON.stringify(body.effects||{}),JSON.stringify(body.stat_modifiers||{}),JSON.stringify(body.requirements||{}),JSON.stringify(body.flags||{}),id]);
    return {status:200,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
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
  try {
    await query(`UPDATE npcs SET name=$1,description=$2,zone_id=$3,faction=$4,disposition=$5,dialogue_tree=$6,vendor_inventory=$7,wanders=$8,flags=$9 WHERE id=$10`,
      [body.name,body.description,body.zone_id,body.faction,body.disposition,JSON.stringify(body.dialogue_tree||{}),JSON.stringify(body.vendor_inventory||[]),body.wanders?1:0,JSON.stringify(body.flags||{}),id]);
    return {status:200,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiWorldState() {
  const players = getAllLivePlayers().map(p => ({ handle: p.handle, current_zone: p.current_zone }));
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
async function apiGetRecipes() { const {rows}=await query('SELECT * FROM recipes'); return {status:200,body:rows}; }

async function apiGetDrugs() { const {rows}=await query('SELECT * FROM drugs'); return {status:200,body:rows}; }
async function apiCreateDrug(body) {
  const id=body.id||`drug_${Date.now()}`;
  try {
    await query(`INSERT INTO drugs (id,name,description,item_id,duration_seconds,effects,addiction_chance,overdose_threshold,withdrawal_effects,flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id,body.name,body.description||'',body.item_id||null,body.duration_seconds||300,JSON.stringify(body.effects||{}),body.addiction_chance||0,body.overdose_threshold||3,JSON.stringify(body.withdrawal_effects||{}),JSON.stringify(body.flags||{})]);
    await loadDrugs();
    return {status:201,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiUpdateDrug(id,body) {
  try {
    await query(`UPDATE drugs SET name=$1,description=$2,item_id=$3,duration_seconds=$4,effects=$5,addiction_chance=$6,overdose_threshold=$7,withdrawal_effects=$8,flags=$9 WHERE id=$10`,
      [body.name,body.description||'',body.item_id||null,body.duration_seconds||300,JSON.stringify(body.effects||{}),body.addiction_chance||0,body.overdose_threshold||3,JSON.stringify(body.withdrawal_effects||{}),JSON.stringify(body.flags||{}),id]);
    await loadDrugs();
    return {status:200,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiDeleteDrug(id) {
  try { await query('DELETE FROM drugs WHERE id=$1',[id]); await loadDrugs(); return {status:200,body:{message:'Deleted'}}; }
  catch(e) { return {status:400,body:{error:e.message}}; }
}

async function apiGetMutations() { const {rows}=await query('SELECT * FROM mutations'); return {status:200,body:rows}; }
async function apiCreateMutation(body) {
  const id=body.id||`mut_${Date.now()}`;
  try {
    await query(`INSERT INTO mutations (id,name,description,polarity,visible,stat_modifiers,effects,drawbacks,rarity,radiation_threshold) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id,body.name,body.description||'',body.polarity||'mixed',body.visible?1:0,JSON.stringify(body.stat_modifiers||{}),JSON.stringify(body.effects||{}),JSON.stringify(body.drawbacks||[]),body.rarity||'uncommon',body.radiation_threshold||40]);
    await loadMutations();
    return {status:201,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiUpdateMutation(id,body) {
  try {
    await query(`UPDATE mutations SET name=$1,description=$2,polarity=$3,visible=$4,stat_modifiers=$5,effects=$6,drawbacks=$7,rarity=$8,radiation_threshold=$9 WHERE id=$10`,
      [body.name,body.description||'',body.polarity||'mixed',body.visible?1:0,JSON.stringify(body.stat_modifiers||{}),JSON.stringify(body.effects||{}),JSON.stringify(body.drawbacks||[]),body.rarity||'uncommon',body.radiation_threshold||40,id]);
    await loadMutations();
    return {status:200,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiDeleteMutation(id) {
  try { await query('DELETE FROM mutations WHERE id=$1',[id]); await loadMutations(); return {status:200,body:{message:'Deleted'}}; }
  catch(e) { return {status:400,body:{error:e.message}}; }
}

async function apiGetApartments() {
  const { rows } = await query(`
    SELECT a.*, z.name as zone_name, z.description as zone_description
    FROM apartments a JOIN zones z ON z.id = a.zone_id
    ORDER BY a.zone_id
  `);
  return { status:200, body: rows };
}

async function apiDeleteApartment(zoneId) {
  try {
    await query('DELETE FROM apartments WHERE zone_id=$1', [zoneId]);
    await query('DELETE FROM zones WHERE id=$1', [zoneId]);
    world.zones.delete(zoneId);
    return { status:200, body:{ message:'Apartment unit and its zone deleted' } };
  } catch(e) { return { status:400, body:{error:e.message} }; }
}

// Generates a whole apartment building in one action: a lobby attached to
// an existing zone (e.g. zone_start) via the given direction, plus N unit
// zones branching off the lobby — each pre-registered in the apartments
// table as unowned and ready to RENT. Saves builders from hand-wiring
// exit JSON for every unit, which is exactly the kind of busywork the dev
// panel exists to remove.
const UNIT_DIRECTIONS = ['north','south','east','west','up','down'];
async function apiBuildApartmentBlock(body) {
  const {
    attach_to_zone_id, attach_direction = 'down',
    building_name = 'Residential Block', lobby_description,
    unit_count = 4, unit_name_prefix = 'Unit', rent_cost = 100,
    danger_rating = 'safe',
  } = body || {};

  if (!attach_to_zone_id) return { status:400, body:{error:'attach_to_zone_id is required'} };
  if (unit_count < 1 || unit_count > 6) return { status:400, body:{error:'unit_count must be between 1 and 6 (one per compass direction, max)'} };

  const { rows: parentRows } = await query('SELECT * FROM zones WHERE id=$1', [attach_to_zone_id]);
  if (!parentRows.length) return { status:400, body:{error:`Zone ${attach_to_zone_id} does not exist`} };
  const parent = parentRows[0];
  const parentExits = parent.exits || {};
  if (parentExits[attach_direction]) {
    return { status:400, body:{error:`${attach_to_zone_id} already has an exit ${attach_direction} (to ${parentExits[attach_direction]}). Choose a different direction or parent zone.`} };
  }

  const OPPOSITE = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up' };
  const lobbyId = `zone_apt_lobby_${Date.now()}`;
  const unitDirs = UNIT_DIRECTIONS.filter(d => d !== OPPOSITE[attach_direction]).slice(0, unit_count);
  const unitIds = unitDirs.map((_, i) => `zone_apt_unit_${Date.now()}_${i}`);

  // Lobby exits: back to the parent zone, plus one per unit
  const lobbyExits = { [OPPOSITE[attach_direction]]: attach_to_zone_id };
  unitDirs.forEach((dir, i) => { lobbyExits[dir] = unitIds[i]; });

  try {
    // Create the lobby
    await query(
      `INSERT INTO zones (id,name,description,danger_rating,pvp_enabled,radiation_level,is_safe_zone,exits,ambient_events,flags) VALUES ($1,$2,$3,$4,0,0,1,$5,$6,'{}')`,
      [lobbyId, building_name, lobby_description || `A converted lobby. A corkboard by the door lists available units.`, danger_rating, JSON.stringify(lobbyExits), JSON.stringify([])]
    );

    // Create each unit, register it in apartments as unowned
    for (let i = 0; i < unitIds.length; i++) {
      const unitId = unitIds[i];
      const unitLabel = `${unit_name_prefix} ${i + 1}`;
      await query(
        `INSERT INTO zones (id,name,description,danger_rating,pvp_enabled,radiation_level,is_safe_zone,exits,ambient_events,flags) VALUES ($1,$2,$3,$4,0,0,1,$5,$6,$7)`,
        [unitId, unitLabel, 'A small, plain room. Yours, if you want it.', danger_rating, JSON.stringify({ [OPPOSITE[unitDirs[i]]]: lobbyId }), JSON.stringify([]), JSON.stringify({ is_apartment: true })]
      );
      await query(
        `INSERT INTO apartments (zone_id, owner_id, is_locked, lock_difficulty, rent_cost) VALUES ($1,NULL,0,4,$2)`,
        [unitId, rent_cost]
      );
    }

    // Wire the parent zone's new exit to the lobby
    const updatedParentExits = { ...parentExits, [attach_direction]: lobbyId };
    await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(updatedParentExits), attach_to_zone_id]);

    // Hot-reload everything that changed
    await reloadZone(attach_to_zone_id);
    await reloadZone(lobbyId);
    for (const unitId of unitIds) await reloadZone(unitId);

    return {
      status: 201,
      body: { lobby_id: lobbyId, unit_ids: unitIds, message: `Built ${building_name} with ${unitIds.length} unit(s), attached ${attach_direction} of ${attach_to_zone_id}.` },
    };
  } catch (e) {
    return { status:400, body:{error:e.message} };
  }
}
async function apiCreateRecipe(body) {
  const id=body.id||`recipe_${Date.now()}`;
  try {
    await query(`INSERT INTO recipes (id,name,description,category,requires_station,skill_req,ingredients,base_output,skill_id,base_difficulty,craft_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id,body.name,body.description||'',body.category||'misc',body.requires_station||null,JSON.stringify(body.skill_req||{}),JSON.stringify(body.ingredients||[]),JSON.stringify(body.base_output||{}),body.skill_id,body.base_difficulty||3,body.craft_time??3]);
    await loadRecipes();
    return {status:201,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiUpdateRecipe(id,body) {
  try {
    await query(`UPDATE recipes SET name=$1,description=$2,category=$3,requires_station=$4,skill_req=$5,ingredients=$6,base_output=$7,skill_id=$8,base_difficulty=$9,craft_time=$10 WHERE id=$11`,
      [body.name,body.description||'',body.category||'misc',body.requires_station||null,JSON.stringify(body.skill_req||{}),JSON.stringify(body.ingredients||[]),JSON.stringify(body.base_output||{}),body.skill_id,body.base_difficulty||3,body.craft_time??3,id]);
    await loadRecipes();
    return {status:200,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiDeleteRecipe(id) {
  try {
    await query('DELETE FROM recipes WHERE id=$1',[id]);
    await loadRecipes();
    return {status:200,body:{message:'Deleted'}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
