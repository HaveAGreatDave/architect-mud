import { query } from '../models/db.js';
import { reloadZone, getAllZones, world, getAllLivePlayers, getZone, addPlayerToZone, removePlayerFromZone, getMinimapData, reloadGlobalAmbients } from '../engine/world.js';
import { describeZone, describeVoidTeleport } from '../engine/commands/index.js';
import { loadRecipes } from '../engine/crafting.js';
import { loadDrugs } from '../engine/drugs.js';
import { loadMutations } from '../engine/mutations.js';
import { randomUUID, createHash } from 'crypto';
import { handleEnvironmentApi } from './environment.routes.js';
import { handleWorldValidatorApi } from './worldvalidator.routes.js';
import { handleStagingApi } from './staging.routes.js';
import { fireRoutes, fireHook } from '../engine/plugins.js';
import { handlePlayerDeath } from '../engine/gameLoop.js';
import { reloadWindows as reloadWindowsEnv } from '../engine/environment.js';

const hashPassword = pw => createHash('sha256').update(pw).digest('hex');
const makeToken = (playerId, role) => Buffer.from(`${playerId}:${role}:${Date.now()}`).toString('base64');

// Short-lived one-time tokens for admin ↔ client switching (max 60 seconds).
const switchTokens = new Map(); // token → { playerId, username, role, handle, expires }
export function consumeSwitchToken(token) {
  const entry = switchTokens.get(token);
  if (!entry || Date.now() > entry.expires) { switchTokens.delete(token); return null; }
  switchTokens.delete(token);
  return entry;
}

// Set once from index.js's boot() — lets route handlers (specifically zone
// deletion) push messages to live players without threading a broadcast
// function through every single handler call.
let broadcastFn = null;
export function setBroadcast(fn) { broadcastFn = fn; }
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

  const wvResult = await handleWorldValidatorApi(path, method, body, auth);
  if (wvResult) return wvResult;

  const stagingResult = await handleStagingApi(path, method, body, auth);
  if (stagingResult) return stagingResult;

  const pluginResult = await fireRoutes(path, method, body, auth);
  if (pluginResult) return pluginResult;

  if (path==='/auth/register' && method==='POST') return apiRegister(body);
  if (path==='/auth/login' && method==='POST') return apiLogin(body);
  if (path==='/auth/gen-switch-token' && method==='POST') {
    if (!auth || !['dev','admin','builder','designer'].includes(auth.role)) return { status:403, body:{error:'Dev access required'} };
    const { rows } = await query('SELECT id, username, handle, role FROM players WHERE id=$1', [auth.playerId]);
    if (!rows.length) return { status:404, body:{error:'Player not found'} };
    const p = rows[0];
    const token = randomUUID();
    switchTokens.set(token, { playerId: p.id, username: p.username, role: p.role, handle: p.handle, expires: Date.now() + 60_000 });
    return { status:200, body:{ token } };
  }
  if (path==='/zones' && method==='GET') return apiGetZones();
  if (path.startsWith('/zones/') && method==='GET') return apiGetZone(path.split('/')[2]);
  if (path==='/zones' && method==='POST') return requireDev(auth, ()=>apiCreateZone(body,auth));
  if (path==='/maps' && method==='GET') return requireDev(auth, apiGetMaps);
  if (path==='/maps/link-interior' && method==='POST') return requireDev(auth, ()=>apiLinkInterior(body, auth));
  if (path.startsWith('/maps/') && method==='GET') return requireDev(auth, ()=>apiGetMap(path.split('/')[2]));
  if (path.startsWith('/zones/') && method==='PUT') return requireDev(auth, ()=>apiUpdateZone(path.split('/')[2],body));
  if (path.startsWith('/zones/') && path.endsWith('/rooms') && method==='POST') return requireDev(auth, ()=>apiAddRoom(path.split('/')[2],body));
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
  if (path.startsWith('/npcs/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteNpc(path.split('/')[2]));
  if (path==='/furniture' && method==='GET') return requireDev(auth, ()=>apiGetFurniture(url));
  if (path==='/furniture' && method==='POST') return requireDev(auth, ()=>apiCreateFurniture(body));
  if (path.startsWith('/furniture/') && method==='PUT') return requireDev(auth, ()=>apiUpdateFurniture(path.split('/')[2],body));
  if (path.startsWith('/furniture/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteFurniture(path.split('/')[2]));
  if (path==='/factions' && method==='GET') { const {rows}=await query('SELECT * FROM factions'); return {status:200,body:rows}; }
  if (path==='/recipes' && method==='GET') return requireDev(auth, apiGetRecipes);
  if (path==='/recipes' && method==='POST') return requireDev(auth, ()=>apiCreateRecipe(body));
  if (path.startsWith('/recipes/') && method==='PUT') return requireDev(auth, ()=>apiUpdateRecipe(path.split('/')[2],body));
  if (path.startsWith('/recipes/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteRecipe(path.split('/')[2]));
  if (path==='/apartments' && method==='GET') return requireDev(auth, apiGetApartments);
  if (path==='/apartments/build' && method==='POST') return requireDev(auth, ()=>apiBuildApartmentBlock(body));
  if (path.startsWith('/apartments/') && method==='PUT') return requireDev(auth, ()=>apiUpdateApartment(path.split('/')[2],body));
  if (path.startsWith('/apartments/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteApartment(path.split('/')[2]));
  if (path==='/drugs' && method==='GET') return requireDev(auth, apiGetDrugs);
  if (path==='/drugs' && method==='POST') return requireDev(auth, ()=>apiCreateDrug(body));
  if (path.startsWith('/drugs/') && method==='PUT') return requireDev(auth, ()=>apiUpdateDrug(path.split('/')[2],body));
  if (path.startsWith('/drugs/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteDrug(path.split('/')[2]));
  if (path==='/mutations' && method==='GET') return requireDev(auth, apiGetMutations);
  if (path==='/mutations' && method==='POST') return requireDev(auth, ()=>apiCreateMutation(body));
  if (path.startsWith('/mutations/') && method==='PUT') return requireDev(auth, ()=>apiUpdateMutation(path.split('/')[2],body));
  if (path.startsWith('/mutations/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteMutation(path.split('/')[2]));
  if (path==='/windows' && method==='GET') return requireDev(auth, ()=>apiGetWindows(url));
  if (path==='/windows' && method==='POST') return requireDev(auth, ()=>apiCreateWindow(body));
  if (path.startsWith('/windows/') && method==='PUT') return requireDev(auth, ()=>apiUpdateWindow(path.split('/')[2],body));
  if (path.startsWith('/windows/') && method==='DELETE') return requireDev(auth, ()=>apiDeleteWindow(path.split('/')[2]));
  if (path==='/ambient-events' && method==='GET') return requireDev(auth, ()=>apiGetAmbientEvents(url));
  if (path==='/ambient-events' && method==='POST') return requireDev(auth, ()=>apiCreateAmbientEvent(body));
  if (path.startsWith('/ambient-events/') && method==='PUT') return requireDev(auth, ()=>apiUpdateAmbientEvent(path.split('/')[2],body));
  if (path.startsWith('/ambient-events/') && method==='DELETE') return requireDev(auth, ()=>apiDeleteAmbientEvent(path.split('/')[2]));
  if (path==='/sounds' && method==='GET') return requireDev(auth, ()=>apiGetSounds(url));
  if (path==='/sounds' && method==='POST') return requireDev(auth, ()=>apiCreateSound(body));
  if (path.startsWith('/sounds/') && method==='PUT') return requireDev(auth, ()=>apiUpdateSound(path.split('/')[2],body));
  if (path.startsWith('/sounds/') && method==='DELETE') return requireDev(auth, ()=>apiDeleteSound(path.split('/')[2]));
  if (path==='/world/state' && method==='GET') return requireDev(auth, apiWorldState);
  if (path==='/world/reload' && method==='POST') return requireDev(auth, ()=>apiReloadZone(body));
  if (path==='/players/online' && method==='GET') return { status:200, body: getAllLivePlayers().map(p=>({ id: p.id, handle: p.handle, role: p.role, current_zone: p.current_zone })) };
  if (path==='/players' && method==='GET') return requireAdmin(auth, apiGetPlayers);
  if (path.startsWith('/players/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeletePlayer(path.split('/')[2]));
  if (path.startsWith('/players/') && path.endsWith('/smite') && method==='POST') return requireAdmin(auth, ()=>apiSmitePlayer(path.split('/')[2]));
  if (path.startsWith('/players/') && path.endsWith('/whisper') && method==='POST') return requireAdmin(auth, ()=>apiWhisperPlayer(path.split('/')[2], body));
  if (path.startsWith('/players/') && path.endsWith('/role') && method==='PUT') return requireAdmin(auth, ()=>apiSetPlayerRole(path.split('/')[2], body));
  if (path.startsWith('/players/') && path.endsWith('/kick') && method==='POST') return requireAdmin(auth, ()=>apiKickPlayer(path.split('/')[2], body));
  if (path.startsWith('/players/') && path.endsWith('/teleport') && method==='POST') return requireAdmin(auth, ()=>apiTeleportPlayer(path.split('/')[2], body));
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
// Ensures a zone flagged is_apartment has a matching apartments table row
// (owner/lock/rent metadata) — the Zone Editor's checkbox is now the only
// way to flag a zone as a rentable apartment, replacing the old batch
// builder, so this is what keeps RENT/LOCK/SLEEP functional for it.
async function ensureApartmentRow(zoneId) {
  await query(
    `INSERT INTO apartments (zone_id, owner_id, is_locked, lock_difficulty, rent_cost)
     VALUES ($1, NULL, 0, 4, 50)
     ON CONFLICT (zone_id) DO NOTHING`,
    [zoneId]
  );
}

async function apiCreateZone(body,auth) {
  const id = body.id||`zone_${Date.now()}`;
  try {
    await query(`INSERT INTO zones (id,name,description,danger_rating,pvp_enabled,radiation_level,is_safe_zone,exits,ambient_events,ambient_theme,flags,created_by,map_id,grid_x,grid_y,grid_z,marker,color,bg_color) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [id,body.name||'Unnamed Zone',body.description||'An empty place.',body.danger_rating||'medium',body.pvp_enabled?1:0,body.radiation_level||0,body.is_safe_zone?1:0,JSON.stringify(body.exits||{}),JSON.stringify(body.ambient_events||[]),body.ambient_theme||'indoors',JSON.stringify(body.flags||{}),auth?.playerId,body.map_id||null,body.grid_x??null,body.grid_y??null,body.grid_z??0,body.marker||null,body.color||null,body.bg_color||null]);
    if (body.flags?.is_apartment) await ensureApartmentRow(id);
    await reloadZone(id);
    fireHook('zone.create', id, body).catch(() => {});
    return {status:201,body:{id,message:'Zone created and live'}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
export async function apiUpdateZone(id,body) {
  const sets=[]; const vals=[];
  let i=1;
  const boolFields = ['pvp_enabled','is_safe_zone'];
  const simple=['name','description','danger_rating','pvp_enabled','radiation_level','is_safe_zone','map_id','grid_x','grid_y','grid_z','marker','color','bg_color'];
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
  if (body.ambient_theme!==undefined) { sets.push(`ambient_theme=$${i++}`); vals.push(body.ambient_theme); }
  if (body.flags!==undefined) { sets.push(`flags=$${i++}`); vals.push(JSON.stringify(body.flags)); }
  sets.push(`updated_at=EXTRACT(EPOCH FROM NOW())`);
  vals.push(id);
  try {
    await query(`UPDATE zones SET ${sets.join(',')} WHERE id=$${i}`,vals);
    if (body.flags?.is_apartment) await ensureApartmentRow(id);
    await reloadZone(id);
    fireHook('zone.update', id, body).catch(() => {});
    return {status:200,body:{id,message:'Zone updated and live'}};
  } catch(e) {
    return {status:400,body:{error:e.message}};
  }
}
// Adds a single is_interior room branching off an existing zone — the
// single-room counterpart to apiBuildApartmentBlock's 4-unit version.
// Used by the Zone Editor's "+ Add Room" button.
async function apiAddRoom(parentZoneId, body) {
  const { direction, name, description } = body || {};
  if (!direction || !name) return { status:400, body:{error:'direction and name are required'} };
  const OPPOSITE = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up' };
  if (!OPPOSITE[direction]) return { status:400, body:{error:`Invalid direction "${direction}"`} };

  const { rows: parentRows } = await query('SELECT * FROM zones WHERE id=$1', [parentZoneId]);
  if (!parentRows.length) return { status:400, body:{error:`Zone ${parentZoneId} does not exist`} };
  const parent = parentRows[0];
  const parentExits = parent.exits || {};
  if (parentExits[direction]) {
    return { status:400, body:{error:`${parentZoneId} already has an exit ${direction} (to ${parentExits[direction]}). Choose a different direction.`} };
  }

  const roomId = `zone_room_${Date.now()}`;
  const roomExits = { [OPPOSITE[direction]]: parentZoneId };

  try {
    await query(
      `INSERT INTO zones (id,name,description,danger_rating,pvp_enabled,radiation_level,is_safe_zone,exits,ambient_events,flags) VALUES ($1,$2,$3,$4,0,0,1,$5,$6,$7)`,
      [roomId, name, description || 'A small room.', parent.danger_rating || 'safe', JSON.stringify(roomExits), JSON.stringify([]), JSON.stringify({ is_interior: true })]
    );
    const updatedParentExits = { ...parentExits, [direction]: roomId };
    await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(updatedParentExits), parentZoneId]);

    await reloadZone(parentZoneId);
    await reloadZone(roomId);

    return { status:201, body:{ id: roomId, message:`Room "${name}" added ${direction} of ${parent.name}` } };
  } catch(e) { return { status:400, body:{error:e.message} }; }
}

// ─── Maps (grid containers) ───────────────────────────────────────────────
async function apiGetMaps() {
  const { rows } = await query(`
    SELECT m.*, (SELECT COUNT(*)::int FROM zones z WHERE z.map_id = m.id) AS zone_count
    FROM maps m ORDER BY m.id
  `);
  return { status:200, body: rows };
}

async function apiGetMap(id) {
  const { rows: mapRows } = await query('SELECT * FROM maps WHERE id=$1', [id]);
  if (!mapRows.length) return { status:404, body:{error:'Not found'} };
  const { rows: zones } = await query(
    `SELECT id, name, danger_rating, grid_x, grid_y, grid_z, marker, color, bg_color, exits, flags, map_id
     FROM zones WHERE map_id=$1`, [id]
  );
  // Interior maps that hang off any of this map's zones, so the editor can
  // offer a "dive in" affordance per building tile.
  const { rows: children } = await query(
    'SELECT id, name, parent_zone_id, entry_zone_id FROM maps WHERE parent_zone_id = ANY($1::text[])',
    [zones.map(z => z.id)]
  );
  // Zones not yet placed on THIS map and not interior rooms — shown in the
  // overview's tray so they can be dragged onto this map by hand.
  // Includes: zones with no map_id, and zones assigned to other maps.
  // Excludes: is_interior and is_apartment zones (they live in sub-maps).
  const { rows: unplaced } = await query(
    `SELECT id, name, danger_rating, exits, flags FROM zones
     WHERE (map_id IS NULL OR map_id != $1)
       AND COALESCE((flags->>'is_interior')::boolean, false) = false
       AND COALESCE((flags->>'is_apartment')::boolean, false) = false
       AND COALESCE((flags->>'is_building')::boolean, false) = false
     ORDER BY name`,
    [id]
  );
  // Interior/apartment zones with no map assignment, PLUS any building zones
  // that have no exterior connection (no interior map with a parent_zone_id
  // pointing to an exterior zone). Both sets need to be linked before they're
  // reachable by players.
  const { rows: unplacedInterior } = await query(`
    SELECT id, name, danger_rating, exits, flags FROM zones
    WHERE map_id IS NULL
      AND (COALESCE((flags->>'is_interior')::boolean, false) = true
        OR COALESCE((flags->>'is_apartment')::boolean, false) = true)
    UNION
    -- Buildings with no interior map at all
    SELECT z.id, z.name, z.danger_rating, z.exits, z.flags FROM zones z
    WHERE COALESCE((z.flags->>'is_building')::boolean, false) = true
      AND NOT EXISTS (
        SELECT 1 FROM maps m
        WHERE m.entry_zone_id = z.id AND m.parent_zone_id IS NOT NULL
      )
    UNION
    -- Buildings that have an interior map but no valid world-map entrance
    -- (world_exit_zone missing, or the exterior zone has no exit back to this building)
    SELECT z.id, z.name, z.danger_rating, z.exits, z.flags FROM zones z
    WHERE COALESCE((z.flags->>'is_building')::boolean, false) = true
      AND EXISTS (
        SELECT 1 FROM maps m WHERE m.entry_zone_id = z.id AND m.parent_zone_id IS NOT NULL
      )
      AND (
        z.flags->>'world_exit_zone' IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM zones ext, jsonb_each_text(COALESCE(ext.exits, '{}')) kv
          WHERE ext.id = z.flags->>'world_exit_zone' AND kv.value = z.id
        )
      )
    ORDER BY name
  `);
  return { status:200, body:{ map: mapRows[0], zones, children, unplaced, unplacedInterior } };
}

// Links an interior zone to an exterior zone: adds the exit, finds or creates
// the interior map, and places the interior zone at 0,0,0 on that map.
// All done in one server call so the client doesn't chain multiple staged writes.
async function apiLinkInterior(body, auth) {
  const { exteriorZoneId, interiorZoneId, direction } = body || {};
  if (!exteriorZoneId || !interiorZoneId || !direction) {
    return { status: 400, body: { error: 'exteriorZoneId, interiorZoneId, and direction are required' } };
  }
  const { rows: extRows } = await query('SELECT * FROM zones WHERE id=$1', [exteriorZoneId]);
  if (!extRows.length) return { status: 404, body: { error: `Exterior zone ${exteriorZoneId} not found` } };
  const { rows: intRows } = await query('SELECT * FROM zones WHERE id=$1', [interiorZoneId]);
  if (!intRows.length) return { status: 404, body: { error: `Interior zone ${interiorZoneId} not found` } };
  const extZone = extRows[0];
  const exits = { ...(extZone.exits || {}), [direction]: interiorZoneId };

  // Find or create the interior map for this exterior zone
  const { rows: existingMaps } = await query('SELECT * FROM maps WHERE parent_zone_id=$1 LIMIT 1', [exteriorZoneId]);
  let interiorMap;
  if (existingMaps.length) {
    interiorMap = existingMaps[0];
    // Patch entry_zone_id if missing — old maps created before this field was standardized
    if (!interiorMap.entry_zone_id) {
      await query('UPDATE maps SET entry_zone_id=$1 WHERE id=$2', [interiorZoneId, interiorMap.id]);
      interiorMap = { ...interiorMap, entry_zone_id: interiorZoneId };
    }
  } else {
    const mapId = `map_int_${Date.now()}`;
    await query(
      `INSERT INTO maps (id, name, parent_zone_id, entry_zone_id, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [mapId, extZone.name + ' — Interior', exteriorZoneId, interiorZoneId, auth?.playerId]
    );
    const { rows } = await query('SELECT * FROM maps WHERE id=$1', [mapId]);
    interiorMap = rows[0];
  }

  // Mark the entry zone as a building and record which exterior zone it exits to.
  const intFlags = JSON.stringify({ ...(intRows[0].flags || {}), is_interior: true, is_building: true, world_exit_zone: exteriorZoneId });
  // Update exterior zone exits and interior zone map placement
  await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(exits), exteriorZoneId]);
  await query('UPDATE zones SET map_id=$1, grid_x=0, grid_y=0, grid_z=0, flags=$2 WHERE id=$3', [interiorMap.id, intFlags, interiorZoneId]);
  await Promise.all([reloadZone(exteriorZoneId), reloadZone(interiorZoneId)]);

  return { status: 200, body: { interiorMap } };
}

async function apiCreateMap(body, auth) {
  const id = body.id || `map_${Date.now()}`;
  if (!body.name) return { status:400, body:{error:'name is required'} };
  try {
    await query(
      `INSERT INTO maps (id,name,parent_zone_id,entry_zone_id,created_by) VALUES ($1,$2,$3,$4,$5)`,
      [id, body.name, body.parent_zone_id||null, body.entry_zone_id||null, auth?.playerId]
    );
    return { status:201, body:{ id, message:'Map created' } };
  } catch(e) { return { status:400, body:{error:e.message} }; }
}

// Batch save from the overview editor: zone positions + exit edits. Validates
// the PROPOSED full-world state first (so broken connections are caught even
// if the client's pre-check is bypassed) and writes nothing on error.
async function apiSaveMapLayout(mapId, body) {
  const positions = Array.isArray(body?.zones) ? body.zones : [];
  const exitEdits = (body && typeof body.exits === 'object' && body.exits) || {};

  const { rows: mapRows } = await query('SELECT id FROM maps WHERE id=$1', [mapId]);
  if (!mapRows.length) return { status:404, body:{error:'Map not found'} };

  // Whole-world context: dangling/reciprocal checks can cross maps, and a
  // cross-map portal's target must be resolvable.
  const { rows: allZones } = await query('SELECT id, map_id, grid_x, grid_y, grid_z, exits FROM zones');
  const posById = new Map(positions.map(p => [p.id, p]));
  const proposed = allZones.map(z => {
    const p = posById.get(z.id);
    return {
      id: z.id, map_id: (p && p.map_id) ? p.map_id : z.map_id,
      grid_x: p ? p.grid_x : z.grid_x,
      grid_y: p ? p.grid_y : z.grid_y,
      grid_z: p ? (p.grid_z ?? 0) : z.grid_z,
      exits: z.exits || {},
    };
  });

  const { errors, warnings } = validateMapLayout(proposed, exitEdits);
  if (errors.length) return { status:409, body:{ error:'Broken connections must be fixed before saving', broken: errors, warnings } };

  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const p of positions) {
      await client.query(
        `UPDATE zones SET grid_x=$2, grid_y=$3, grid_z=$4, map_id=COALESCE($5,map_id), updated_at=EXTRACT(EPOCH FROM NOW()) WHERE id=$1`,
        [p.id, p.grid_x ?? null, p.grid_y ?? null, p.grid_z ?? 0, p.map_id || mapId]
      );
    }
    for (const [zoneId, exits] of Object.entries(exitEdits)) {
      await client.query(
        `UPDATE zones SET exits=$2, updated_at=EXTRACT(EPOCH FROM NOW()) WHERE id=$1`,
        [zoneId, JSON.stringify(exits || {})]
      );
    }
    await client.query('COMMIT');
  } catch(e) {
    await client.query('ROLLBACK').catch(()=>{});
    client.release();
    return { status:400, body:{error:e.message} };
  }
  client.release();

  const touched = new Set([...positions.map(p => p.id), ...Object.keys(exitEdits)]);
  for (const zid of touched) await reloadZone(zid);
  return { status:200, body:{ message:'Layout saved', warnings } };
}

// Called after zone(s) are removed from the DB. Any currently-connected
// player whose current_zone was just deleted gets pulled back to
// zone_start immediately — DB row, in-memory zone membership, and their
// live client all updated — instead of being left pointed at a zone that
// no longer exists until their next reconnect (which the login-time check
// in index.js's handleAuth covers separately, for anyone offline right now).
async function rescueDisplacedPlayers(deletedZoneIds) {
  if (!deletedZoneIds.length) return;
  const deletedSet = new Set(deletedZoneIds);
  for (const player of getAllLivePlayers()) {
    if (!deletedSet.has(player.current_zone)) continue;
    removePlayerFromZone(player.id, player.current_zone);
    player.current_zone = 'zone_start';
    addPlayerToZone(player.id, 'zone_start');
    await query('UPDATE players SET current_zone=$1 WHERE id=$2', ['zone_start', player.id]).catch(()=>{});

    if (!broadcastFn) continue;
    const startZone = getZone('zone_start');
    const lookMessage = startZone ? await describeZone(startZone, player) : '';
    broadcastFn(null, { type:'move', message: describeVoidTeleport() + lookMessage, zone:'zone_start', minimap: getMinimapData('zone_start') }, null, player.id);
    broadcastFn('zone_start', { type:'zone_event', message:`${player.handle} flickers into existence out of nowhere.` }, player.id);
  }
}

async function apiDeleteZone(id) {
  if (id==='zone_start') return {status:400,body:{error:'Cannot delete spawn zone'}};
  try {
    // Cascade: any zone flagged is_apartment OR is_interior whose exits
    // lead back to this one is a room belonging to this building (same
    // linkage the dev panel uses to nest them under it, and the same
    // linkage the in-game Rooms: list uses) — delete those first so
    // deleting a building never leaves orphaned rooms behind.
    const { rows: children } = await query(
      `SELECT id FROM zones WHERE ((flags->>'is_apartment')::boolean IS TRUE OR (flags->>'is_interior')::boolean IS TRUE)
       AND EXISTS (SELECT 1 FROM jsonb_each_text(exits) e WHERE e.value = $1)`,
      [id]
    );
    const allDeletedIds = [id, ...children.map(c => c.id)];
    // Any NPC or furniture in the building itself or any of its cascaded
    // rooms would otherwise be orphaned (zone_id pointing at nothing).
    for (const zid of allDeletedIds) {
      await query('DELETE FROM npcs WHERE zone_id=$1', [zid]);
      await query('DELETE FROM furniture WHERE zone_id=$1', [zid]);
    }
    for (const child of children) {
      await query('DELETE FROM apartments WHERE zone_id=$1', [child.id]);
      await query('DELETE FROM zones WHERE id=$1', [child.id]);
      world.zones.delete(child.id);
    }
    await query('DELETE FROM zones WHERE id=$1',[id]);
    world.zones.delete(id);
    await rescueDisplacedPlayers(allDeletedIds);
    fireHook('zone.delete', id, allDeletedIds).catch(() => {});
    return {status:200,body:{message: children.length ? `Zone deleted (and ${children.length} attached room${children.length>1?'s':''})` : 'Zone deleted'}};
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
export async function apiUpdateEnemy(id,body) {
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
export async function apiUpdateItem(id,body) {
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
export async function apiUpdateNpc(id,body) {
  try {
    await query(`UPDATE npcs SET name=$1,description=$2,zone_id=$3,faction=$4,disposition=$5,dialogue_tree=$6,vendor_inventory=$7,wanders=$8,flags=$9 WHERE id=$10`,
      [body.name,body.description,body.zone_id,body.faction,body.disposition,JSON.stringify(body.dialogue_tree||{}),JSON.stringify(body.vendor_inventory||[]),body.wanders?1:0,JSON.stringify(body.flags||{}),id]);
    return {status:200,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiDeleteNpc(id) {
  try {
    await query('DELETE FROM npcs WHERE id=$1', [id]);
    return {status:200,body:{message:'NPC deleted'}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiGetFurniture(fullUrl) {
  const zoneId = fullUrl ? new URL('http://x'+fullUrl).searchParams.get('zone') : null;
  const { rows } = zoneId
    ? await query('SELECT * FROM furniture WHERE zone_id=$1', [zoneId])
    : await query('SELECT * FROM furniture');
  return {status:200,body:rows};
}
export async function apiCreateFurniture(body) {
  if (!body?.zone_id) return {status:400,body:{error:'zone_id is required'}};
  if (!body?.name) return {status:400,body:{error:'name is required'}};
  const id = body.id || `furniture_${Date.now()}`;
  try {
    await query(`INSERT INTO furniture (id,zone_id,name,description,is_light,light_on,light_type,flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, body.zone_id, body.name, body.description||'', body.is_light?1:0, body.light_on?1:0, body.light_type||'lamp', JSON.stringify(body.flags||{})]);
    return {status:201,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
export async function apiUpdateFurniture(id, body) {
  try {
    const sets = [], vals = [];
    let i = 1;
    const fields = ['zone_id','name','description','light_type'];
    for (const f of fields) if (body[f]!=null) { sets.push(`${f}=$${i++}`); vals.push(body[f]); }
    if (body.flags!=null) { sets.push(`flags=$${i++}`); vals.push(JSON.stringify(body.flags)); }
    if (body.is_light!=null) { sets.push(`is_light=$${i++}`); vals.push(body.is_light?1:0); }
    if (body.light_on!=null) { sets.push(`light_on=$${i++}`); vals.push(body.light_on?1:0); }
    if (!sets.length) return {status:400,body:{error:'nothing to update'}};
    vals.push(id);
    await query(`UPDATE furniture SET ${sets.join(',')} WHERE id=$${i}`, vals);
    return {status:200,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
export async function apiDeleteFurniture(id) {
  try {
    await query('DELETE FROM furniture WHERE id=$1', [id]);
    return {status:200,body:{message:'Furniture deleted'}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiWorldState() {
  const players = getAllLivePlayers().map(p => ({ handle: p.handle, role: p.role, current_zone: p.current_zone }));
  return {status:200,body:{zones:getAllZones(),online_players:players,live_enemies:world.enemies.size,live_corpses:world.corpses.size}};
}
async function apiReloadZone(body) {
  if (!body?.zone_id) return {status:400,body:{error:'zone_id required'}};
  await reloadZone(body.zone_id);
  return {status:200,body:{message:`Zone ${body.zone_id} reloaded`}};
}
async function apiGetPlayers() {
  const {rows}=await query('SELECT id,username,handle,role,current_zone,credits,created_at,last_seen FROM players');
  const online = new Set(getAllLivePlayers().map(p=>p.id));
  return {status:200,body:rows.map(r=>({...r,online:online.has(r.id)}))};
}

async function apiDeletePlayer(id) {
  const {rows}=await query('SELECT handle FROM players WHERE id=$1',[id]);
  if (!rows.length) return {status:404,body:{error:'Player not found'}};
  await query('DELETE FROM player_inventory WHERE player_id=$1',[id]);
  await query('DELETE FROM player_skills WHERE player_id=$1',[id]);
  await query('DELETE FROM player_faction_rep WHERE player_id=$1',[id]);
  await query('DELETE FROM player_mutations WHERE player_id=$1',[id]);
  await query('DELETE FROM player_drug_state WHERE player_id=$1',[id]);
  await query('DELETE FROM players WHERE id=$1',[id]);
  broadcastFn(null,{type:'kicked',message:'Your account has been deleted by an administrator.'},null,id);
  return {status:200,body:{deleted:true,handle:rows[0].handle}};
}

async function apiSmitePlayer(id) {
  const {rows}=await query('SELECT handle,current_zone FROM players WHERE id=$1',[id]);
  if (!rows.length) return {status:404,body:{error:'Player not found'}};
  const {handle,current_zone}=rows[0];
  const player = getAllLivePlayers().find(p=>p.id===id);
  if (!player) return {status:404,body:{error:'Player not online'}};

  const zoneMsg = `<span style="color:#f5e642">⚡ THE SKY TEARS OPEN.</span> A pillar of white fire descends from nowhere and detonates directly on top of <span style="color:#ff3b5c">${handle}</span>. The ground chars. The air smells like burned ambition. <span style="color:#f5e642">${handle} is annihilated.</span>`;
  const selfMsg = `<span style="color:#f5e642;font-weight:bold">⚡ ⚡ ⚡ THE ARCHITECT HAS NOTICED YOU. ⚡ ⚡ ⚡</span>\n<span style="color:#ff3b5c">A column of divine lightning the width of a building drops out of the sky and hits you so hard the universe briefly forgets you exist. You feel every atom in your body make a personal decision to stop cooperating.</span>\n<span style="color:#f5e642">You are dead. You have been very dead. This is perhaps the deadest anyone has ever been.</span>`;

  broadcastFn(current_zone, {type:'zone_event', message:zoneMsg}, id);
  broadcastFn(null, {type:'output', message:selfMsg}, null, id);

  handlePlayerDeath(player, null);
  return {status:200,body:{smited:true,handle}};
}

async function apiWhisperPlayer(id, body) {
  const {message}=body||{};
  if (!message) return {status:400,body:{error:'message required'}};
  const {rows}=await query('SELECT handle FROM players WHERE id=$1',[id]);
  if (!rows.length) return {status:404,body:{error:'Player not found'}};
  broadcastFn(null,{type:'whisper',from:'Admin',message},null,id);
  return {status:200,body:{sent:true,handle:rows[0].handle}};
}

async function apiKickPlayer(id, body) {
  const {rows}=await query('SELECT handle FROM players WHERE id=$1',[id]);
  if (!rows.length) return {status:404,body:{error:'Player not found'}};
  const adminHandle = body?.adminHandle || 'An administrator';
  const reason = body?.reason?.trim();
  const message = reason
    ? `You have been kicked by ${adminHandle}. [${reason}]`
    : `You have been kicked by ${adminHandle}.`;
  broadcastFn(null,{type:'kicked',message},null,id);
  return {status:200,body:{kicked:true,handle:rows[0].handle}};
}

async function apiTeleportPlayer(id, body) {
  const {zoneId}=body||{};
  if (!zoneId) return {status:400,body:{error:'zoneId required'}};
  const zone = getZone(zoneId);
  if (!zone) return {status:404,body:{error:'Zone not found'}};
  const {rows}=await query('SELECT handle,current_zone FROM players WHERE id=$1',[id]);
  if (!rows.length) return {status:404,body:{error:'Player not found'}};
  const {handle,current_zone}=rows[0];
  await query('UPDATE players SET current_zone=$1 WHERE id=$2',[zoneId,id]);
  // Update live player if online
  const live = getAllLivePlayers().find(p=>p.id===id);
  if (live) {
    removePlayerFromZone(id, current_zone);
    live.current_zone = zoneId;
    addPlayerToZone(id, zoneId);
  }
  const lookMsg = await describeZone(zone, live || {handle,current_zone:zoneId});
  broadcastFn(null,{type:'move',message:`<span style="color:var(--cyan)">An unseen force picks you up and deposits you elsewhere.</span>\n\n${lookMsg}`,zone:zoneId,minimap:getMinimapData(zoneId)},null,id);
  broadcastFn(zoneId,{type:'zone_event',message:`${handle} materialises out of thin air.`},id);
  return {status:200,body:{teleported:true,handle,zoneId}};
}

async function apiSetPlayerRole(id, body) {
  const VALID_ROLES = ['player','builder','designer','dev','admin'];
  const {role}=body||{};
  if (!VALID_ROLES.includes(role)) return {status:400,body:{error:'Invalid role'}};
  const {rows}=await query('SELECT handle FROM players WHERE id=$1',[id]);
  if (!rows.length) return {status:404,body:{error:'Player not found'}};
  await query('UPDATE players SET role=$1 WHERE id=$2',[role,id]);
  broadcastFn(null,{type:'output',message:`<span style="color:#7c3aed">Your account role has been updated to: ${role}.</span>`},null,id);
  return {status:200,body:{updated:true,handle:rows[0].handle,role}};
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
export async function apiUpdateDrug(id,body) {
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
export async function apiUpdateMutation(id,body) {
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
    SELECT a.*, z.name as zone_name, z.description as zone_description, p.handle as owner_handle
    FROM apartments a JOIN zones z ON z.id = a.zone_id
    LEFT JOIN players p ON p.id = a.owner_id
    ORDER BY a.zone_id
  `);
  return { status:200, body: rows };
}

async function apiUpdateApartment(zoneId, body) {
  const sets = []; const vals = []; let i = 1;
  if (body.is_locked !== undefined) { sets.push(`is_locked=$${i++}`); vals.push(body.is_locked ? 1 : 0); }
  if (body.lock_difficulty !== undefined) { sets.push(`lock_difficulty=$${i++}`); vals.push(parseInt(body.lock_difficulty) || 1); }
  if (body.rent_cost !== undefined) { sets.push(`rent_cost=$${i++}`); vals.push(parseInt(body.rent_cost) || 0); }
  if (!sets.length) return { status:400, body:{ error:'No fields to update' } };
  vals.push(zoneId);
  try {
    const result = await query(`UPDATE apartments SET ${sets.join(',')} WHERE zone_id=$${i}`, vals);
    if (!result.rowCount) return { status:404, body:{ error:'Apartment record not found for this zone' } };
    return { status:200, body:{ ok:true } };
  } catch (e) { return { status:400, body:{ error:e.message } }; }
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
    await query(`INSERT INTO recipes (id,name,description,category,requires_station,skill_req,ingredients,base_output,skill_id,base_difficulty) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id,body.name,body.description||'',body.category||'misc',body.requires_station||null,JSON.stringify(body.skill_req||{}),JSON.stringify(body.ingredients||[]),JSON.stringify(body.base_output||{}),body.skill_id,body.base_difficulty||3]);
    await loadRecipes();
    return {status:201,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
export async function apiUpdateRecipe(id,body) {
  try {
    await query(`UPDATE recipes SET name=$1,description=$2,category=$3,requires_station=$4,skill_req=$5,ingredients=$6,base_output=$7,skill_id=$8,base_difficulty=$9 WHERE id=$10`,
      [body.name,body.description||'',body.category||'misc',body.requires_station||null,JSON.stringify(body.skill_req||{}),JSON.stringify(body.ingredients||[]),JSON.stringify(body.base_output||{}),body.skill_id,body.base_difficulty||3,id]);
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

// --- Windows ---
async function apiGetWindows(fullUrl) {
  const zoneId = new URL('http://x' + fullUrl).searchParams.get('zone');
  const { rows } = zoneId
    ? await query('SELECT * FROM windows WHERE zone_interior=$1 OR zone_exterior=$1', [zoneId])
    : await query('SELECT * FROM windows');
  return { status:200, body:rows };
}
async function apiCreateWindow(body) {
  const id = randomUUID();
  const { name='window', description='A window.', zone_interior, zone_exterior=null, curtain_open=1, glass_state='intact', light_transmission=0.8, visibility_transmission=0.8 } = body||{};
  if (!zone_interior) return { status:400, body:{error:'zone_interior required'} };
  await query('INSERT INTO windows (id,name,description,zone_interior,zone_exterior,curtain_open,glass_state,light_transmission,visibility_transmission) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id,name,description,zone_interior,zone_exterior,curtain_open,glass_state,light_transmission,visibility_transmission]);
  await reloadWindowsEnv().catch(()=>{});
  return { status:201, body:{id} };
}
async function apiUpdateWindow(id, body) {
  const { name, description, zone_interior, zone_exterior, curtain_open, glass_state, light_transmission, visibility_transmission } = body||{};
  await query(`UPDATE windows SET
    name=COALESCE($1,name), description=COALESCE($2,description),
    zone_interior=COALESCE($3,zone_interior), zone_exterior=$4,
    curtain_open=COALESCE($5,curtain_open), glass_state=COALESCE($6,glass_state),
    light_transmission=COALESCE($7,light_transmission), visibility_transmission=COALESCE($8,visibility_transmission)
    WHERE id=$9`,
    [name,description,zone_interior,zone_exterior??null,curtain_open,glass_state,light_transmission,visibility_transmission,id]);
  await reloadWindowsEnv().catch(()=>{});
  return { status:200, body:{updated:true} };
}
async function apiDeleteWindow(id) {
  await query('DELETE FROM windows WHERE id=$1',[id]);
  await reloadWindowsEnv().catch(()=>{});
  return { status:200, body:{deleted:true} };
}

// --- Global Ambient Events ---
async function apiGetAmbientEvents(fullUrl) {
  const theme = new URL('http://x' + fullUrl).searchParams.get('theme');
  const { rows } = theme
    ? await query('SELECT * FROM global_ambient_events WHERE theme=$1 ORDER BY theme,message', [theme])
    : await query('SELECT * FROM global_ambient_events ORDER BY theme,message');
  return { status:200, body:rows };
}
async function apiCreateAmbientEvent(body) {
  const id = randomUUID();
  const { theme='indoors', message, enabled=1, loudness=1.0, weight=100 } = body||{};
  if (!message?.trim()) return { status:400, body:{error:'message required'} };
  await query('INSERT INTO global_ambient_events (id,theme,message,loudness,weight,enabled) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, theme, message.trim(), loudness, weight, enabled ? 1 : 0]);
  await reloadGlobalAmbients();
  return { status:201, body:{id} };
}
async function apiUpdateAmbientEvent(id, body) {
  const { theme, message, enabled, loudness, weight } = body||{};
  await query(`UPDATE global_ambient_events SET
    theme=COALESCE($1,theme),
    message=COALESCE($2,message),
    enabled=COALESCE($3,enabled),
    loudness=COALESCE($4,loudness),
    weight=COALESCE($5,weight)
    WHERE id=$6`,
    [theme, message?.trim()||null, enabled!=null?(enabled?1:0):null, loudness??null, weight??null, id]);
  await reloadGlobalAmbients();
  return { status:200, body:{updated:true} };
}
async function apiDeleteAmbientEvent(id) {
  await query('DELETE FROM global_ambient_events WHERE id=$1',[id]);
  await reloadGlobalAmbients();
  return { status:200, body:{deleted:true} };
}

// --- Sounds ---
async function apiGetSounds(fullUrl) {
  const category = new URL('http://x' + fullUrl).searchParams.get('category');
  const { rows } = category
    ? await query('SELECT * FROM sounds WHERE category=$1 ORDER BY category,name', [category])
    : await query('SELECT * FROM sounds ORDER BY category,name');
  return { status:200, body:rows };
}
async function apiCreateSound(body) {
  const id = randomUUID();
  const { name, category='misc', descriptions=[], loudness=3.0, tags={}, enabled=1 } = body||{};
  if (!name?.trim()) return { status:400, body:{error:'name required'} };
  await query('INSERT INTO sounds (id,name,category,descriptions,loudness,tags,enabled) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, name.trim(), category, JSON.stringify(descriptions), loudness, JSON.stringify(tags), enabled?1:0]);
  return { status:201, body:{id} };
}
async function apiUpdateSound(id, body) {
  const { name, category, descriptions, loudness, tags, enabled } = body||{};
  const sets = [], vals = [];
  let i = 1;
  if (name!=null)         { sets.push(`name=$${i++}`);         vals.push(name.trim()); }
  if (category!=null)     { sets.push(`category=$${i++}`);     vals.push(category); }
  if (descriptions!=null) { sets.push(`descriptions=$${i++}`); vals.push(JSON.stringify(descriptions)); }
  if (loudness!=null)     { sets.push(`loudness=$${i++}`);     vals.push(loudness); }
  if (tags!=null)         { sets.push(`tags=$${i++}`);         vals.push(JSON.stringify(tags)); }
  if (enabled!=null)      { sets.push(`enabled=$${i++}`);      vals.push(enabled?1:0); }
  if (!sets.length) return { status:400, body:{error:'nothing to update'} };
  vals.push(id);
  await query(`UPDATE sounds SET ${sets.join(',')} WHERE id=$${i}`, vals);
  return { status:200, body:{updated:true} };
}
async function apiDeleteSound(id) {
  await query('DELETE FROM sounds WHERE id=$1',[id]);
  return { status:200, body:{deleted:true} };
}
