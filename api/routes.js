import { getDb } from '../models/migrate.js';
import { reloadZone, getAllZones, world } from '../engine/world.js';
import { randomUUID, createHash } from 'crypto';

function hashPassword(pw) {
  return createHash('sha256').update(pw).digest('hex');
}

function verifyToken(req) {
  const auth = req.headers?.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  try {
    // Simple token: base64(playerId:role:timestamp)
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [playerId, role, ts] = decoded.split(':');
    if (Date.now() - parseInt(ts) > 24 * 60 * 60 * 1000) return null;
    return { playerId, role };
  } catch { return null; }
}

function makeToken(playerId, role) {
  return Buffer.from(`${playerId}:${role}:${Date.now()}`).toString('base64');
}

export async function handleApiRequest(url, method, body, headers) {
  const path = url.replace(/^\/api/, '').split('?')[0];
  const query = Object.fromEntries(new URLSearchParams(url.split('?')[1] || ''));

  // Auth endpoints (no token required)
  if (path === '/auth/register' && method === 'POST') return apiRegister(body);
  if (path === '/auth/login' && method === 'POST') return apiLogin(body);

  // All other endpoints require token
  const auth = verifyToken({ headers });

  if (path === '/zones' && method === 'GET') return apiGetZones();
  if (path.startsWith('/zones/') && method === 'GET') return apiGetZone(path.split('/')[2]);
  if (path === '/zones' && method === 'POST') return requireDev(auth, () => apiCreateZone(body, auth));
  if (path.startsWith('/zones/') && method === 'PUT') return requireDev(auth, () => apiUpdateZone(path.split('/')[2], body, auth));
  if (path.startsWith('/zones/') && method === 'DELETE') return requireAdmin(auth, () => apiDeleteZone(path.split('/')[2]));

  if (path === '/enemies' && method === 'GET') return requireDev(auth, apiGetEnemies);
  if (path === '/enemies' && method === 'POST') return requireDev(auth, () => apiCreateEnemy(body));
  if (path.startsWith('/enemies/') && method === 'PUT') return requireDev(auth, () => apiUpdateEnemy(path.split('/')[2], body));
  if (path.startsWith('/enemies/') && method === 'DELETE') return requireAdmin(auth, () => apiDeleteEnemy(path.split('/')[2]));

  if (path === '/items' && method === 'GET') return requireDev(auth, apiGetItems);
  if (path === '/items' && method === 'POST') return requireDev(auth, () => apiCreateItem(body));
  if (path.startsWith('/items/') && method === 'PUT') return requireDev(auth, () => apiUpdateItem(path.split('/')[2], body));

  if (path === '/npcs' && method === 'GET') return requireDev(auth, apiGetNpcs);
  if (path === '/npcs' && method === 'POST') return requireDev(auth, () => apiCreateNpc(body));
  if (path.startsWith('/npcs/') && method === 'PUT') return requireDev(auth, () => apiUpdateNpc(path.split('/')[2], body));

  if (path === '/factions' && method === 'GET') return { status: 200, body: getDb().prepare('SELECT * FROM factions').all() };

  if (path === '/world/state' && method === 'GET') return requireDev(auth, apiWorldState);
  if (path === '/world/reload' && method === 'POST') return requireDev(auth, () => apiReloadZone(body));

  if (path === '/players' && method === 'GET') return requireAdmin(auth, apiGetPlayers);

  return { status: 404, body: { error: 'Not found' } };
}

function requireDev(auth, fn) {
  if (!auth || !['dev', 'admin', 'builder', 'designer'].includes(auth.role)) {
    return { status: 403, body: { error: 'Dev access required' } };
  }
  return fn();
}

function requireAdmin(auth, fn) {
  if (!auth || auth.role !== 'admin') {
    return { status: 403, body: { error: 'Admin access required' } };
  }
  return fn();
}

function apiRegister(body) {
  const { username, password, handle } = body || {};
  if (!username || !password || !handle) return { status: 400, body: { error: 'username, password, handle required' } };

  const db = getDb();
  try {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO players (id, username, password_hash, handle, role)
      VALUES (?, ?, ?, ?, 'player')
    `).run(id, username.toLowerCase(), hashPassword(password), handle);
    const token = makeToken(id, 'player');
    db.close();
    return { status: 201, body: { token, playerId: id, handle, role: 'player' } };
  } catch (e) {
    db.close();
    return { status: 409, body: { error: 'Username or handle already taken' } };
  }
}

function apiLogin(body) {
  const { username, password } = body || {};
  if (!username || !password) return { status: 400, body: { error: 'username and password required' } };

  const db = getDb();
  const player = db.prepare('SELECT * FROM players WHERE username = ?').get(username.toLowerCase());
  db.close();

  if (!player || player.password_hash !== hashPassword(password)) {
    return { status: 401, body: { error: 'Invalid credentials' } };
  }

  const token = makeToken(player.id, player.role);
  return { status: 200, body: { token, playerId: player.id, handle: player.handle, role: player.role } };
}

function apiGetZones() {
  return { status: 200, body: getAllZones() };
}

function apiGetZone(id) {
  const db = getDb();
  const zone = db.prepare('SELECT * FROM zones WHERE id = ?').get(id);
  db.close();
  if (!zone) return { status: 404, body: { error: 'Zone not found' } };
  return { status: 200, body: { ...zone, exits: JSON.parse(zone.exits || '{}'), ambient_events: JSON.parse(zone.ambient_events || '[]') } };
}

function apiCreateZone(body, auth) {
  const db = getDb();
  const id = body.id || `zone_${Date.now()}`;
  try {
    db.prepare(`
      INSERT INTO zones (id, name, description, danger_rating, pvp_enabled, radiation_level, is_safe_zone, exits, ambient_events, flags, created_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(
      id, body.name || 'Unnamed Zone', body.description || 'An empty place.',
      body.danger_rating || 'medium', body.pvp_enabled ? 1 : 0,
      body.radiation_level || 0, body.is_safe_zone ? 1 : 0,
      JSON.stringify(body.exits || {}), JSON.stringify(body.ambient_events || []),
      JSON.stringify(body.flags || {}), auth?.playerId
    );
    reloadZone(id);
    db.close();
    return { status: 201, body: { id, message: 'Zone created and live' } };
  } catch (e) {
    db.close();
    return { status: 400, body: { error: e.message } };
  }
}

function apiUpdateZone(id, body, auth) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM zones WHERE id = ?').get(id);
  if (!existing) { db.close(); return { status: 404, body: { error: 'Zone not found' } }; }

  const fields = [];
  const vals = [];
  const allowed = ['name', 'description', 'danger_rating', 'pvp_enabled', 'radiation_level', 'is_safe_zone'];
  for (const field of allowed) {
    if (body[field] !== undefined) { fields.push(`${field} = ?`); vals.push(body[field]); }
  }
  if (body.exits !== undefined) { fields.push('exits = ?'); vals.push(JSON.stringify(body.exits)); }
  if (body.ambient_events !== undefined) { fields.push('ambient_events = ?'); vals.push(JSON.stringify(body.ambient_events)); }
  if (body.flags !== undefined) { fields.push('flags = ?'); vals.push(JSON.stringify(body.flags)); }
  fields.push('updated_at = unixepoch()');
  vals.push(id);

  db.prepare(`UPDATE zones SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  reloadZone(id);
  db.close();
  return { status: 200, body: { id, message: 'Zone updated and live' } };
}

function apiDeleteZone(id) {
  if (id === 'zone_start') return { status: 400, body: { error: 'Cannot delete spawn zone' } };
  const db = getDb();
  db.prepare('DELETE FROM zones WHERE id = ?').run(id);
  world.zones.delete(id);
  db.close();
  return { status: 200, body: { message: 'Zone deleted' } };
}

function apiGetEnemies() {
  const db = getDb();
  const enemies = db.prepare('SELECT * FROM enemies').all();
  db.close();
  return { status: 200, body: enemies.map(e => ({ ...e, loot_table: JSON.parse(e.loot_table || '[]'), flags: JSON.parse(e.flags || '{}') })) };
}

function apiCreateEnemy(body) {
  const db = getDb();
  const id = body.id || `enemy_${Date.now()}`;
  try {
    db.prepare(`INSERT INTO enemies (id,name,description,stat_str,stat_agi,stat_end,hp_max,damage_min,damage_max,armor,xp_reward,credit_reward,loot_table,behavior,faction,death_message,flags)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, body.name, body.description,
      body.stat_str || 5, body.stat_agi || 5, body.stat_end || 5,
      body.hp_max || 30, body.damage_min || 3, body.damage_max || 7,
      body.armor || 0, body.xp_reward || 10, body.credit_reward || 0,
      JSON.stringify(body.loot_table || []), body.behavior || 'aggressive',
      body.faction || null, body.death_message || 'It dies.',
      JSON.stringify(body.flags || {})
    );
    db.close();
    return { status: 201, body: { id } };
  } catch(e) { db.close(); return { status: 400, body: { error: e.message } }; }
}

function apiUpdateEnemy(id, body) {
  const db = getDb();
  // Simplified: replace entire record
  const existing = db.prepare('SELECT * FROM enemies WHERE id = ?').get(id);
  if (!existing) { db.close(); return { status: 404, body: { error: 'Enemy not found' } }; }
  const merged = { ...existing, ...body,
    loot_table: JSON.stringify(body.loot_table || JSON.parse(existing.loot_table || '[]')),
    flags: JSON.stringify(body.flags || JSON.parse(existing.flags || '{}'))
  };
  db.prepare(`UPDATE enemies SET name=?,description=?,stat_str=?,stat_agi=?,stat_end=?,hp_max=?,damage_min=?,damage_max=?,armor=?,xp_reward=?,credit_reward=?,loot_table=?,behavior=?,faction=?,death_message=?,flags=? WHERE id=?`
  ).run(merged.name,merged.description,merged.stat_str,merged.stat_agi,merged.stat_end,merged.hp_max,merged.damage_min,merged.damage_max,merged.armor,merged.xp_reward,merged.credit_reward,merged.loot_table,merged.behavior,merged.faction,merged.death_message,merged.flags,id);
  db.close();
  return { status: 200, body: { id } };
}

function apiDeleteEnemy(id) {
  const db = getDb();
  db.prepare('DELETE FROM enemies WHERE id = ?').run(id);
  db.close();
  return { status: 200, body: { message: 'Enemy deleted' } };
}

function apiGetItems() {
  const db = getDb();
  const items = db.prepare('SELECT * FROM items').all();
  db.close();
  return { status: 200, body: items };
}

function apiCreateItem(body) {
  const db = getDb();
  const id = body.id || `item_${Date.now()}`;
  try {
    db.prepare(`INSERT INTO items (id,name,description,type,subtype,weight,value,rarity,is_stackable,is_unique,is_quest_item,effects,stat_modifiers,requirements,flags)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, body.name, body.description, body.type || 'misc', body.subtype || null,
      body.weight || 1.0, body.value || 0, body.rarity || 'common',
      body.is_stackable ? 1 : 0, body.is_unique ? 1 : 0, body.is_quest_item ? 1 : 0,
      JSON.stringify(body.effects || {}), JSON.stringify(body.stat_modifiers || {}),
      JSON.stringify(body.requirements || {}), JSON.stringify(body.flags || {})
    );
    db.close();
    return { status: 201, body: { id } };
  } catch(e) { db.close(); return { status: 400, body: { error: e.message } }; }
}

function apiUpdateItem(id, body) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!existing) { db.close(); return { status: 404, body: { error: 'Item not found' } }; }
  db.prepare(`UPDATE items SET name=?,description=?,type=?,subtype=?,weight=?,value=?,rarity=?,is_stackable=?,effects=?,stat_modifiers=?,requirements=?,flags=? WHERE id=?`
  ).run(body.name||existing.name,body.description||existing.description,body.type||existing.type,body.subtype||existing.subtype,body.weight??existing.weight,body.value??existing.value,body.rarity||existing.rarity,body.is_stackable??existing.is_stackable,JSON.stringify(body.effects||JSON.parse(existing.effects||'{}')),JSON.stringify(body.stat_modifiers||JSON.parse(existing.stat_modifiers||'{}')),JSON.stringify(body.requirements||JSON.parse(existing.requirements||'{}')),JSON.stringify(body.flags||JSON.parse(existing.flags||'{}')),id);
  db.close();
  return { status: 200, body: { id } };
}

function apiGetNpcs() {
  const db = getDb();
  const npcs = db.prepare('SELECT * FROM npcs').all();
  db.close();
  return { status: 200, body: npcs };
}

function apiCreateNpc(body) {
  const db = getDb();
  const id = body.id || `npc_${Date.now()}`;
  try {
    db.prepare(`INSERT INTO npcs (id,name,description,zone_id,faction,disposition,dialogue_tree,vendor_inventory,wanders,flags) VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(id, body.name, body.description, body.zone_id||null, body.faction||null, body.disposition||'neutral',
      JSON.stringify(body.dialogue_tree||{}), JSON.stringify(body.vendor_inventory||[]), body.wanders?1:0, JSON.stringify(body.flags||{}));
    db.close();
    return { status: 201, body: { id } };
  } catch(e) { db.close(); return { status: 400, body: { error: e.message } }; }
}

function apiUpdateNpc(id, body) {
  const db = getDb();
  db.prepare(`UPDATE npcs SET name=?,description=?,zone_id=?,faction=?,disposition=?,dialogue_tree=?,vendor_inventory=?,wanders=?,flags=? WHERE id=?`
  ).run(body.name,body.description,body.zone_id,body.faction,body.disposition,JSON.stringify(body.dialogue_tree||{}),JSON.stringify(body.vendor_inventory||[]),body.wanders?1:0,JSON.stringify(body.flags||{}),id);
  db.close();
  return { status: 200, body: { id } };
}

function apiWorldState() {
  const db = getDb();
  const onlinePlayers = db.prepare('SELECT handle, current_zone, last_seen FROM players WHERE last_seen > ?').all(Math.floor(Date.now()/1000) - 300);
  db.close();
  return {
    status: 200, body: {
      zones: getAllZones(),
      online_players: onlinePlayers,
      live_enemies: world.enemies.size,
      live_corpses: world.corpses.size,
    }
  };
}

function apiReloadZone(body) {
  const { zone_id } = body || {};
  if (!zone_id) return { status: 400, body: { error: 'zone_id required' } };
  reloadZone(zone_id);
  return { status: 200, body: { message: `Zone ${zone_id} reloaded` } };
}

function apiGetPlayers() {
  const db = getDb();
  const players = db.prepare('SELECT id, username, handle, role, current_zone, credits, created_at, last_seen FROM players').all();
  db.close();
  return { status: 200, body: players };
}
