import { query, logActivity } from '../models/db.js';
import { reloadZone, getAllZones, world, getAllLivePlayers, getZone, addPlayerToZone, removePlayerFromZone, getMinimapData, reloadGlobalAmbients, spawnEnemySync, setDoorCache, deleteDoorCache, getZoneDoors } from '../engine/world.js';
import { describeZone, describeVoidTeleport } from '../engine/commands/index.js';
import { allExits } from '../engine/exits.js';
import { detectBathroomSide } from '../engine/commands/doors.js';
import { loadRecipes } from '../engine/crafting.js';
import { loadDrugs } from '../engine/drugs.js';
import { getCrimeList, reloadCrimes, CRIME_DEFAULTS } from '../engine/crimes.js';
import { getAliasList, reloadAliases, ALIAS_DEFAULTS } from '../engine/commands/aliases.js';
import { loadMutations } from '../engine/mutations.js';
import { randomUUID, createHash, randomBytes } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFileP = promisify(execFile);
import vm from 'vm';
import { sendPasswordResetEmail, sendVerificationEmail } from '../mailer.js';
import { isEmailVerificationEnabled, setEmailVerificationEnabled } from '../engine/emailVerification.js';
import { randomAppearance } from '../engine/appearance.js';
import { DEFAULT_CHITCHAT_LINES, isVendorWorkTime } from '../engine/ai-behaviour.js';
import { npcTypeForPersonality, listPersonalityMeta, pickClothingForPersonality } from '../engine/npc-personality.js';
import { decideSex } from '../engine/npc-sex.js';
import { loadBanterLibrary } from '../engine/npc-banter.js';
import { OPPOSITE } from '../engine/directions.js';

const DEFAULT_VENDOR_SCHEDULE = {
  mon:[{from:10,to:22}], tue:[{from:10,to:22}], wed:[{from:10,to:22}],
  thu:[{from:10,to:22}], fri:[{from:10,to:22}], sat:[{from:10,to:22}], sun:[{from:10,to:22}],
};

function formatScheduleBoard(npc) {
  const LABELS = { mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat', sun:'Sun' };
  const days = ['mon','tue','wed','thu','fri','sat','sun'];
  const lines = days.map(d => {
    const blocks = (npc.vendor_schedule?.[d] || []);
    if (!blocks.length) return `${LABELS[d]}: Closed`;
    return `${LABELS[d]}: ${blocks.map(b => `${b.from}:00-${b.to}:00`).join(', ')}`;
  });
  const shopLine = npc.vendor_shop_name ? `${npc.vendor_shop_name}\n` : '';
  return `${npc.name}'s Schedule\n${shopLine}\n${lines.join('\n')}`;
}
import { handleEnvironmentApi } from './environment.routes.js';
import { handleWorldValidatorApi } from './worldvalidator.routes.js';
import { handleStagingApi } from './staging.routes.js';
import { handleBackupApi } from './backup.routes.js';
import { fireRoutes, fireHook } from '../engine/plugins.js';
import { handlePlayerDeath } from '../engine/gameLoop.js';
import { reloadWindows as reloadWindowsEnv, recomputePower, getEnvironmentState } from '../engine/environment.js';
import { ensureTunables } from '../engine/tunables.js';
import { startingIp, statCost, RAISABLE_STATS, getNetXp, statSpent, maxHpForEndurance } from '../engine/ip.js';
import { SKILLS } from '../engine/skills.js';
import { materializeItemTags, ownTags, superKeys } from '../engine/supertags.js';
import { getMotd, saveMotd } from '../engine/motd.js';
import { isMisServerEnabled, setServerMisEnabled } from '../engine/mis.js';
import { canAccessChannel, sendToChatChannel, getChannelMessagesSince } from '../engine/channels.js';
import { schedule } from '../engine/scheduler.js';

// Devpanel admin presence: playerId → { handle, role, ts }
const devPresence = new Map();
const DEV_PRESENCE_TTL = 5 * 60 * 1000; // 5 minutes

export function updateDevPresence(playerId, handle, role) {
  devPresence.set(playerId, { handle, role, ts: Date.now() });
}

function getActiveDevAdmins() {
  const now = Date.now();
  const active = [];
  for (const [id, entry] of devPresence) {
    if (now - entry.ts < DEV_PRESENCE_TTL) active.push({ id, handle: entry.handle, role: entry.role });
    else devPresence.delete(id);
  }
  return active;
}

const hashPassword = pw => createHash('sha256').update(pw).digest('hex');
const makeToken = (playerId, role) => Buffer.from(`${playerId}:${role}:${Date.now()}`).toString('base64');
const CATALOG_PATH = fileURLToPath(new URL('../../client/shared/tagCatalog.js', import.meta.url));
const SUPERTAGS_PATH = fileURLToPath(new URL('../../client/shared/tagSupertags.js', import.meta.url));

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

let storeGhostTokenFn = null;
export function setGhostTokenStore(fn) { storeGhostTokenFn = fn; }

// Record active player count every minute for the dashboard graph.
// Deduplicate by email so multi-account users only count once.
schedule('1m', async () => {
  const liveIds = getAllLivePlayers().map(p => p.id);
  let count = 0;
  if (liveIds.length > 0) {
    const { rows } = await query(
      `SELECT COUNT(DISTINCT COALESCE(email, id::text)) AS n FROM players WHERE id = ANY($1)`,
      [liveIds]
    );
    count = parseInt(rows[0].n, 10);
  }
  await query(`INSERT INTO player_count_log (count) VALUES ($1)`, [count]);
  // Retain ~1 year so the dashboard's 30-day / All-Time ranges have data to show.
  await query(`DELETE FROM player_count_log WHERE recorded_at < NOW() - INTERVAL '1 year'`);
});

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

  const backupResult = await handleBackupApi(path, method, body, auth);
  if (backupResult) return backupResult;

  const pluginResult = await fireRoutes(path, method, body, auth);
  if (pluginResult) return pluginResult;

  if (path==='/mis/status' && method==='GET') {
    if (!auth || !['dev','admin','builder','designer'].includes(auth.role)) return { status:403, body:{error:'Dev access required'} };
    return { status:200, body:{ enabled: isMisServerEnabled() } };
  }
  if (path==='/mis/toggle' && method==='POST') {
    if (!auth || !['dev','admin','builder','designer'].includes(auth.role)) return { status:403, body:{error:'Dev access required'} };
    const enable = !!body?.enable;
    await setServerMisEnabled(enable);
    return { status:200, body:{ enabled: enable } };
  }
  if (path==='/email-verification/status' && method==='GET') {
    if (!auth || !['dev','admin','builder','designer'].includes(auth.role)) return { status:403, body:{error:'Dev access required'} };
    return { status:200, body:{ enabled: isEmailVerificationEnabled() } };
  }
  if (path==='/email-verification/toggle' && method==='POST') {
    if (!auth || !['dev','admin','builder','designer'].includes(auth.role)) return { status:403, body:{error:'Dev access required'} };
    const enable = !!body?.enable;
    await setEmailVerificationEnabled(enable);
    return { status:200, body:{ enabled: enable } };
  }

  if (path==='/auth/register' && method==='POST') return apiRegister(body);
  if (path==='/auth/login' && method==='POST') return apiLogin(body);
  if (path==='/auth/verify-email' && method==='POST') return apiVerifyEmail(body);
  if (path==='/auth/resend-verification' && method==='POST') return apiResendVerification(body);
  if (path==='/auth/forgot-password' && method==='POST') return apiForgotPassword(body);
  if (path==='/auth/reset-password'  && method==='POST') return apiResetPassword(body);
  if (path.startsWith('/auth/email-hint') && method==='GET') return apiEmailHint(new URL('http://x'+url).searchParams.get('username'));
  if (path==='/auth/gen-switch-token' && method==='POST') {
    if (!auth || !['dev','admin','builder','designer'].includes(auth.role)) return { status:403, body:{error:'Dev access required'} };
    const { rows } = await query('SELECT id, username, handle, role FROM players WHERE id=$1', [auth.playerId]);
    if (!rows.length) return { status:404, body:{error:'Player not found'} };
    const p = rows[0];
    const token = randomUUID();
    switchTokens.set(token, { playerId: p.id, username: p.username, role: p.role, handle: p.handle, expires: Date.now() + 60_000 });
    return { status:200, body:{ token } };
  }
  if (path==='/ghost/token' && method==='POST') {
    return requireAdmin(auth, async () => {
      const { zoneId: requestedZoneId } = body || {};
      if (!requestedZoneId) return { status:400, body:{ error:'zoneId required' } };
      if (!storeGhostTokenFn) return { status:503, body:{ error:'Ghost token store not ready' } };
      // If this admin has a home set, teleport their ghost there instead.
      const { rows: pRows } = await query('SELECT home_zone FROM players WHERE id=$1', [auth.playerId]);
      const zoneId = pRows[0]?.home_zone || requestedZoneId;
      const token = randomUUID();
      storeGhostTokenFn(token, auth.playerId, zoneId);
      return { status:200, body:{ token } };
    });
  }
  if (path==='/zones' && method==='GET') return apiGetZones();
  if (path==='/zones' && method==='POST') return requireDev(auth, ()=>apiCreateZone(body,auth));
  if (path==='/maps' && method==='GET') return requireDev(auth, apiGetMaps);
  if (path==='/maps/link-interior' && method==='POST') return requireDev(auth, ()=>apiLinkInterior(body, auth));
  if (path.startsWith('/maps/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteMap(path.split('/')[2]));
  if (path.startsWith('/maps/') && method==='GET') return requireDev(auth, ()=>apiGetMap(path.split('/')[2]));
  // Zone IDs may contain '/' — extract with slice, not split, to handle them correctly
  const _zoneId    = (p) => p.slice('/zones/'.length);
  const _zoneIdSub = (p) => p.slice('/zones/'.length, p.lastIndexOf('/'));
  if (path.startsWith('/zones/') && path.endsWith('/rooms')        && method==='POST') return requireDev(auth,   ()=>apiAddRoom(_zoneIdSub(path),body));
  if (path.startsWith('/zones/') && path.endsWith('/spawns')       && method==='GET')  return requireDev(auth,   ()=>apiGetZoneSpawns(_zoneIdSub(path)));
  if (path.startsWith('/zones/') && path.endsWith('/spawns')       && method==='POST') return requireDev(auth,   ()=>apiAddZoneSpawn(_zoneIdSub(path),body));
  if (path.startsWith('/zones/') && path.endsWith('/live-enemies') && method==='GET')  return requireDev(auth,   ()=>apiGetZoneLiveEnemies(_zoneIdSub(path)));
  if (path.startsWith('/zones/') && path.endsWith('/live-enemies') && method==='POST') return requireDev(auth,   ()=>apiSpawnLiveEnemy(_zoneIdSub(path), body));
  if (path.startsWith('/zones/') && path.endsWith('/doors')        && method==='GET')  return requireDev(auth,   ()=>apiGetZoneDoors(_zoneIdSub(path)));
  if (path.startsWith('/zones/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteZone(_zoneId(path)));
  if (path.startsWith('/zones/') && method==='PUT')    return requireDev(auth,   ()=>apiUpdateZone(_zoneId(path),body));
  if (path.startsWith('/zones/') && method==='GET')    return apiGetZone(_zoneId(path));
  if (path==='/spawns' && method==='POST') return requireDev(auth, ()=>apiCreateSpawn(body));
  if (path.startsWith('/spawns/') && method==='PUT')    return requireDev(auth, ()=>apiUpdateSpawn(path.split('/')[2],body));
  if (path.startsWith('/spawns/') && method==='DELETE') return requireDev(auth, ()=>apiDeleteZoneSpawn(path.split('/')[2]));
  if (path==='/live-enemies/despawn-all' && method==='POST') return requireAdmin(auth, ()=>apiDespawnAllEnemies());
  if (path.startsWith('/live-enemies/') && method==='DELETE') return requireDev(auth, ()=>apiDespawnEnemy(path.split('/')[2]));
  if (path==='/enemies' && method==='GET') return requireDev(auth, apiGetEnemies);
  if (path==='/enemies' && method==='POST') return requireDev(auth, ()=>apiCreateEnemy(body));
  if (path.startsWith('/enemies/') && method==='PUT') return requireDev(auth, ()=>apiUpdateEnemy(path.split('/')[2],body));
  if (path.startsWith('/enemies/') && path.endsWith('/graph') && method==='PATCH') return requireDev(auth, ()=>apiPatchGraph('enemies',path.split('/')[2],body));
  if (path.startsWith('/enemies/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteEnemy(path.split('/')[2]));
  if (path==='/items' && method==='GET') return requireDev(auth, apiGetItems);
  if (path==='/items' && method==='POST') return requireDev(auth, ()=>apiCreateItem(body));
  if (path.startsWith('/items/') && method==='PUT') return requireDev(auth, ()=>apiUpdateItem(path.split('/')[2],body));
  if (path.startsWith('/items/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteItem(path.split('/')[2]));
  if (path==='/npc-personalities' && method==='GET') return requireDev(auth, async () => ({ status:200, body: listPersonalityMeta() }));
  if (path==='/npc-banter' && method==='GET') return requireDev(auth, apiListBanter);
  if (path==='/npc-banter' && method==='PUT') return requireDev(auth, ()=>apiReplaceBanter(body));
  if (path==='/npcs' && method==='GET') return requireDev(auth, apiGetNpcs);
  if (path==='/npcs' && method==='POST') return requireDev(auth, ()=>apiCreateNpc(body));
  if (path==='/npcs/send-to-work' && method==='POST') return requireDev(auth, apiSendLateNpcsToWork);
  if (path==='/npcs/house-unhoused' && method==='POST') return requireDev(auth, apiHouseUnhousedNpcs);
  if (path.startsWith('/npcs/') && method==='PUT') return requireDev(auth, ()=>apiUpdateNpc(path.split('/')[2],body));
  if (path.startsWith('/npcs/') && path.endsWith('/graph') && method==='PATCH') return requireDev(auth, ()=>apiPatchGraph('npcs',path.split('/')[2],body));
  if (path.startsWith('/broadcasts/') && path.endsWith('/graph') && method==='PATCH') return requireDev(auth, ()=>apiPatchGraph('media_broadcasts',path.split('/')[2],body));
  if (path.startsWith('/npcs/') && path.endsWith('/restock') && method==='POST') return requireDev(auth, ()=>apiRestockVendor(path.split('/')[2]));
  if (path.startsWith('/npcs/') && path.endsWith('/place-safe') && method==='POST') return requireDev(auth, ()=>apiPlaceSafe(path.split('/')[2]));
  if (path.startsWith('/npcs/') && path.endsWith('/safe-status') && method==='GET') return requireDev(auth, ()=>apiGetSafeStatus(path.split('/')[2]));
  if (path.startsWith('/npcs/') && path.endsWith('/broadcast-schedule') && method==='GET') return requireDev(auth, ()=>apiGetNpcBroadcastSchedule(path.split('/')[2]));
  if (path.startsWith('/npcs/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteNpc(path.split('/')[2]));
  if (path==='/furniture' && method==='GET') return requireDev(auth, ()=>apiGetFurniture(url));
  if (path==='/furniture/bulk/streetlights' && method==='POST') return requireDev(auth, ()=>apiBulkAddStreetlights(auth));
  if (path==='/furniture' && method==='POST') return requireDev(auth, ()=>apiCreateFurniture(body));
  if (path.startsWith('/furniture/') && method==='PUT') return requireDev(auth, ()=>apiUpdateFurniture(path.split('/')[2],body));
  if (path.startsWith('/furniture/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteFurniture(path.split('/')[2]));
  if (path==='/factions' && method==='GET') {
    // NPC factions now live in the unified orgs table (is_npc=1). Reconstruct the
    // legacy shape (incl. hostile_to/friendly_to) from orgs + org_relations.
    const { rows } = await query(`
      SELECT o.id, o.name, o.description, o.color,
        COALESCE((SELECT jsonb_agg(r.other_org_id) FROM org_relations r WHERE r.org_id=o.id AND r.stance='hostile'), '[]'::jsonb) AS hostile_to,
        COALESCE((SELECT jsonb_agg(r.other_org_id) FROM org_relations r WHERE r.org_id=o.id AND r.stance='friendly'), '[]'::jsonb) AS friendly_to
      FROM orgs o WHERE o.is_npc = 1 ORDER BY o.name`);
    return { status:200, body:rows };
  }
  if (path==='/recipes' && method==='GET') return requireDev(auth, apiGetRecipes);
  if (path==='/recipes' && method==='POST') return requireDev(auth, ()=>apiCreateRecipe(body));
  if (path.startsWith('/recipes/') && method==='PUT') return requireDev(auth, ()=>apiUpdateRecipe(path.split('/')[2],body));
  if (path.startsWith('/recipes/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteRecipe(path.split('/')[2]));
  if (path==='/scavenging-tables' && method==='GET') return requireDev(auth, apiGetScavengingTables);
  if (path==='/scavenging-tables' && method==='POST') return requireDev(auth, ()=>apiCreateScavengingTable(body));
  if (path.startsWith('/scavenging-tables/') && path.endsWith('/zone-stock') && method==='GET') return requireDev(auth, ()=>apiGetScavengingZoneStock(path.split('/')[2]));
  if (path.startsWith('/scavenging-tables/') && method==='GET') return requireDev(auth, ()=>apiGetScavengingTable(path.split('/')[2]));
  if (path.startsWith('/scavenging-tables/') && method==='PUT') return requireDev(auth, ()=>apiUpdateScavengingTable(path.split('/')[2],body));
  if (path.startsWith('/scavenging-tables/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteScavengingTable(path.split('/')[2]));
  if (path==='/scripts' && method==='GET') return requireDev(auth, apiGetScripts);
  if (path==='/scripts' && method==='POST') return requireDev(auth, ()=>apiCreateScript(body));
  if (path.startsWith('/scripts/') && method==='PUT') return requireDev(auth, ()=>apiUpdateScript(path.split('/')[2],body));
  if (path.startsWith('/scripts/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteScript(path.split('/')[2]));
  if (path==='/apartments' && method==='GET') return requireDev(auth, apiGetApartments);
  if (path==='/apartments/build' && method==='POST') return requireDev(auth, ()=>apiBuildApartmentBlock(body));
  if (path.startsWith('/apartments/') && method==='PUT') return requireDev(auth, ()=>apiUpdateApartment(path.split('/')[2],body));
  if (path.startsWith('/apartments/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteApartment(path.split('/')[2]));
  if (path==='/drugs' && method==='GET') return requireDev(auth, apiGetDrugs);
  if (path==='/drugs' && method==='POST') return requireDev(auth, ()=>apiCreateDrug(body));
  if (path.startsWith('/drugs/') && method==='PUT') return requireDev(auth, ()=>apiUpdateDrug(path.split('/')[2],body));
  if (path.startsWith('/drugs/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteDrug(path.split('/')[2]));
  if (path==='/crimes' && method==='GET') return requireDev(auth, apiGetCrimes);
  if (path.startsWith('/crimes/') && method==='PUT') return requireDev(auth, ()=>apiUpdateCrime(path.split('/')[2],body));
  if (path==='/command-aliases' && method==='GET') return requireDev(auth, apiGetAliases);
  if (path==='/command-aliases' && method==='POST') return requireDev(auth, ()=>apiUpsertAlias(body));
  if (path.startsWith('/command-aliases/') && method==='DELETE') return requireDev(auth, ()=>apiDeleteAlias(decodeURIComponent(path.split('/')[2])));
  if (path==='/mutations' && method==='GET') return requireDev(auth, apiGetMutations);
  if (path==='/mutations' && method==='POST') return requireDev(auth, ()=>apiCreateMutation(body));
  if (path.startsWith('/mutations/') && method==='PUT') return requireDev(auth, ()=>apiUpdateMutation(path.split('/')[2],body));
  if (path.startsWith('/mutations/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteMutation(path.split('/')[2]));
  if (path==='/windows' && method==='GET') return requireDev(auth, ()=>apiGetWindows(url));
  if (path==='/windows' && method==='POST') return requireDev(auth, ()=>apiCreateWindow(body));
  if (path.startsWith('/windows/') && method==='PUT') return requireDev(auth, ()=>apiUpdateWindow(path.split('/')[2],body));
  if (path.startsWith('/windows/') && method==='DELETE') return requireDev(auth, ()=>apiDeleteWindow(path.split('/')[2]));
  if (path==='/doors' && method==='GET') return requireDev(auth, apiGetDoors);
  if (path==='/doors' && method==='POST') return requireDev(auth, ()=>apiCreateDoor(body));
  if (path.startsWith('/doors/') && path.endsWith('/keycard') && method==='POST') return requireDev(auth, ()=>apiCreateKeycard(path.split('/')[2], body));
  if (path.startsWith('/doors/') && method==='PUT') return requireDev(auth, ()=>apiUpdateDoor(path.split('/')[2],body));
  if (path.startsWith('/doors/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeleteDoor(path.split('/')[2]));
  if (path==='/ambient-events' && method==='GET') return requireDev(auth, ()=>apiGetAmbientEvents(url));
  if (path==='/ambient-events' && method==='POST') return requireDev(auth, ()=>apiCreateAmbientEvent(body));
  if (path.startsWith('/ambient-events/') && method==='PUT') return requireDev(auth, ()=>apiUpdateAmbientEvent(path.split('/')[2],body));
  if (path.startsWith('/ambient-events/') && method==='DELETE') return requireDev(auth, ()=>apiDeleteAmbientEvent(path.split('/')[2]));
  if (path==='/sounds' && method==='GET') return requireDev(auth, ()=>apiGetSounds(url));
  if (path==='/sounds' && method==='POST') return requireDev(auth, ()=>apiCreateSound(body));
  if (path.startsWith('/sounds/') && method==='PUT') return requireDev(auth, ()=>apiUpdateSound(path.split('/')[2],body));
  if (path.startsWith('/sounds/') && method==='DELETE') return requireDev(auth, ()=>apiDeleteSound(path.split('/')[2]));
  if (path==='/server-activity-log' && method==='GET') return requireDev(auth, apiGetActivityLog);
  if (path==='/player-count-log' && method==='GET') return requireDev(auth, ()=>apiGetPlayerCountLog(url));
  if (path==='/dev/activity' && method==='GET') return requireDev(auth, ()=>apiGetDevActivity(url));
  if (path==='/dev/notes' && method==='GET') return requireDev(auth, apiGetDevNotes);
  if (path==='/dev/notes' && method==='POST') return requireDev(auth, ()=>apiCreateDevNote(body, auth));
  if (path.startsWith('/dev/notes/') && method==='PATCH') return requireDev(auth, ()=>apiUpdateDevNote(path.split('/')[3], body));
  if (path.startsWith('/dev/notes/') && method==='DELETE') return requireDev(auth, ()=>apiDeleteDevNote(path.split('/')[3]));
  if (path==='/world/state' && method==='GET') return requireDev(auth, apiWorldState);
  if (path==='/world/reload' && method==='POST') return requireDev(auth, ()=>apiReloadZone(body));
  if (path==='/players/online' && method==='GET') {
    const live = getAllLivePlayers().map(p => ({ id: p.id, handle: p.handle, role: p.role, current_zone: p.current_zone }));
    const liveIds = new Set(live.map(p => p.id));
    const devAdmins = getActiveDevAdmins().filter(a => !liveIds.has(a.id)).map(a => ({ id: a.id, handle: a.handle, role: a.role, current_zone: null }));
    return { status: 200, body: [...live, ...devAdmins] };
  }
  if (path==='/admin/presence' && method==='POST') {
    if (!auth) return { status:401, body:{error:'Unauthorized'} };
    const { handle } = body || {};
    if (handle) updateDevPresence(auth.playerId, handle, auth.role);
    return { status:200, body:{ok:true} };
  }
  if (path==='/channels/messages' && method==='GET') {
    if (!auth || !['admin','dev','builder','designer'].includes(auth.role)) return { status:403, body:{error:'Forbidden'} };
    const params = new URLSearchParams(url.replace(/^[^?]*\??/,''));
    const since = parseFloat(params.get('since') || '0') / 1000;
    const fakePlayer = { role: auth.role };
    const msgs = await getChannelMessagesSince(fakePlayer, since);
    return { status:200, body: msgs };
  }
  if (path.startsWith('/channels/') && path.endsWith('/message') && method==='POST') {
    if (!auth || !['admin','dev','builder','designer'].includes(auth.role)) return { status:403, body:{error:'Forbidden'} };
    const channelId = '#' + path.split('/')[2].replace(/^#/,'');
    const { message, handle } = body || {};
    if (!message || !handle) return { status:400, body:{error:'Missing message or handle'} };
    const fakePlayer = { role: auth.role };
    if (!canAccessChannel(channelId, fakePlayer)) return { status:403, body:{error:'No access to channel'} };
    if (!broadcastFn) return { status:503, body:{error:'Server not ready'} };
    sendToChatChannel(channelId, { type:'channel_msg', channel: channelId, from: handle, message }, broadcastFn);
    return { status:200, body:{ok:true} };
  }
  if (path==='/players/me/profile' && method==='PUT') return apiUpdateOwnProfile(auth, body);
  if (path==='/players' && method==='GET') return requireAdmin(auth, apiGetPlayers);
  if (path.startsWith('/players/') && method==='PUT' && !path.endsWith('/role') && !path.endsWith('/kick') && !path.endsWith('/teleport')) return requireAdmin(auth, ()=>apiUpdatePlayer(path.split('/')[2], body));
  if (path.startsWith('/players/') && method==='DELETE') return requireAdmin(auth, ()=>apiDeletePlayer(path.split('/')[2]));
  if (path.startsWith('/players/') && path.endsWith('/progression') && method==='GET') return requireAdmin(auth, ()=>apiGetPlayerProgression(path.split('/')[2]));
  if (path.startsWith('/players/') && path.endsWith('/smite') && method==='POST') return requireAdmin(auth, ()=>apiSmitePlayer(path.split('/')[2]));
  if (path.startsWith('/players/') && path.endsWith('/whisper') && method==='POST') return requireAdmin(auth, ()=>apiWhisperPlayer(path.split('/')[2], body));
  if (path.startsWith('/players/') && path.endsWith('/role') && method==='PUT') return requireAdmin(auth, ()=>apiSetPlayerRole(path.split('/')[2], body));
  if (path.startsWith('/players/') && path.endsWith('/kick') && method==='POST') return requireAdmin(auth, ()=>apiKickPlayer(path.split('/')[2], body));
  if (path.startsWith('/players/') && path.endsWith('/teleport') && method==='POST') return requireAdmin(auth, ()=>apiTeleportPlayer(path.split('/')[2], body));
  if (path.startsWith('/players/') && path.endsWith('/goto') && method==='POST') return requireAdmin(auth, ()=>apiGotoPlayer(path.split('/')[2], auth));
  if (path==='/tag-catalog' && method==='GET') return requireDev(auth, apiGetTagCatalog);
  if (path==='/tag-catalog' && method==='PUT') return requireDev(auth, ()=>apiPutTagCatalog(body));
  if (path==='/tag-supertags' && method==='GET') return requireDev(auth, apiGetSupertags);
  if (path==='/tag-supertags' && method==='PUT') return requireDev(auth, ()=>apiPutSupertags(body));
  if (path==='/spawn' && method==='POST') return requireDev(auth, ()=>apiSpawnItem(body));
  if (path==='/motd' && method==='GET') return requireDev(auth, apiGetMotd);
  if (path==='/motd' && method==='PUT') return requireDev(auth, ()=>apiSetMotd(body));
  if (path==='/motd/push' && method==='POST') return requireDev(auth, () => apiPushMotd(body));
  return { status:404, body:{error:'Not found'} };
}

async function apiRegister(body) {
  const {username,password,handle,email} = body||{};
  if (!username||!password||!handle||!email) return {status:400,body:{error:'username, password, handle, email required'}};
  const biological_sex = (body.biological_sex === 'female') ? 'female' : 'male';
  try {
    const id = randomUUID();
    await ensureTunables();
    // Starting XP into bonus_xp: enough to raise all stats to the baseline target
    // (startingIp), plus the cost of the five stats that begin at 1 — so Net XP
    // after creation equals startingIp (the same spendable as the old IP grant).
    const bonusXp = startingIp() + RAISABLE_STATS.length * statCost(0);
    const app = randomAppearance(biological_sex);
    // hp/hp_max derive from the starting endurance of 1 (see maxHpForEndurance).
    const startHp = maxHpForEndurance(1);
    await query(
      `INSERT INTO players
        (id,username,password_hash,handle,role,bonus_xp,hp,hp_max,stat_brawn,stat_reflexes,stat_endurance,stat_brains,stat_cool,stat_senses,
         biological_sex,hair_style,hair_length,hair_color,eye_color,height_cm,weight_kg,appearance_data,email,sexuality)
       VALUES ($1,$2,$3,$4,'player',$5,${startHp},${startHp},1,1,1,1,1,1,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, username.toLowerCase(), hashPassword(password), handle, bonusXp,
       biological_sex, app.hair_style, app.hair_length, app.hair_color, app.eye_color,
       app.height_cm, app.weight_kg, JSON.stringify(app.appearance_data), email.toLowerCase().trim(),
       body.sexuality || (biological_sex === 'male' ? 'Female' : 'Male')]
    );
    // Starting kit — bandages always
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,'item_bandage',3,1.0)`, [randomUUID(), id]);
    // Underwear by sex
    if (biological_sex === 'male') {
      await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,is_equipped,slot,layer) SELECT $1,$2,i.id,1,1.0,1,'legs',1 FROM items i WHERE i.id='item_underwear_male'`, [randomUUID(), id]);
    } else {
      await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,is_equipped,slot,layer) SELECT $1,$2,i.id,1,1.0,1,'torso',1 FROM items i WHERE i.id='item_underwear_female_top'`, [randomUUID(), id]);
      await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,is_equipped,slot,layer) SELECT $1,$2,i.id,1,1.0,1,'legs',1  FROM items i WHERE i.id='item_underwear_female_bottom'`, [randomUUID(), id]);
    }
    // T-shirt, pants, shoes for everyone — layer 2 over underwear
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,is_equipped,slot,layer) SELECT $1,$2,i.id,1,1.0,1,'torso',2 FROM items i WHERE i.id='item_basic_shirt'`, [randomUUID(), id]);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,is_equipped,slot,layer) SELECT $1,$2,i.id,1,1.0,1,'legs',2  FROM items i WHERE i.id='item_basic_pants'`, [randomUUID(), id]);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,is_equipped,slot,layer) SELECT $1,$2,i.id,1,1.0,1,'feet',2  FROM items i WHERE i.id='item_basic_shoes'`, [randomUUID(), id]);
    logActivity('char_created', handle);
    fireHook('player.create', { id, handle, username: username.toLowerCase(), role: 'player' }).catch(() => {});
    if (isEmailVerificationEnabled()) {
      const verifyToken = randomBytes(32).toString('hex');
      await query(
        'INSERT INTO email_verification_tokens (player_id, token, expires_at) VALUES ($1,$2,$3)',
        [id, verifyToken, Date.now() + 24 * 60 * 60 * 1000]
      );
      const verifyUrl = `${process.env.CLIENT_BASE_URL || 'http://localhost:3000'}/game?verify_token=${verifyToken}`;
      sendVerificationEmail(email.toLowerCase().trim(), verifyUrl).catch(e => console.error('[register] verification email failed:', e.message));
      return {status:201,body:{needsVerification:true}};
    }
    await query('UPDATE players SET email_verified=TRUE WHERE id=$1', [id]);
    return {status:201,body:{token:makeToken(id,'player'),playerId:id,handle,role:'player'}};
  } catch(e) {
    if (e.code === '23505') return {status:409,body:{error:'Username or handle already taken'}};
    console.error('[register] unexpected error:', e.message);
    return {status:500,body:{error:'Registration failed. Please try again.'}};
  }
}

async function apiLogin(body) {
  const {username,password} = body||{};
  if (!username||!password) return {status:400,body:{error:'username and password required'}};
  const {rows} = await query('SELECT * FROM players WHERE username=$1',[username.toLowerCase()]);
  if (!rows.length||rows[0].password_hash!==hashPassword(password)) return {status:401,body:{error:'Invalid credentials'}};
  const p = rows[0];
  if (isEmailVerificationEnabled() && !p.email_verified) return {status:403,body:{error:'Please verify your email before logging in.',needsVerification:true}};
  fireHook('player.login', { id: p.id, handle: p.handle, role: p.role }).catch(() => {});
  return {status:200,body:{token:makeToken(p.id,p.role),playerId:p.id,handle:p.handle,role:p.role}};
}

async function apiVerifyEmail(body) {
  const { token } = body||{};
  if (!token) return { status:400, body:{ error:'token required' } };
  const { rows } = await query('SELECT * FROM email_verification_tokens WHERE token=$1', [token]);
  if (!rows.length) return { status:404, body:{ error:'Invalid or expired verification link.' } };
  const row = rows[0];
  if (row.used) return { status:400, body:{ error:'This verification link has already been used.' } };
  if (Date.now() > row.expires_at) return { status:400, body:{ error:'Verification link has expired. Request a new one.' } };
  await query('UPDATE players SET email_verified=TRUE WHERE id=$1', [row.player_id]);
  await query('UPDATE email_verification_tokens SET used=TRUE WHERE id=$1', [row.id]);
  const { rows: pRows } = await query('SELECT id, handle, role FROM players WHERE id=$1', [row.player_id]);
  const p = pRows[0];
  return { status:200, body:{ token:makeToken(p.id,p.role), playerId:p.id, handle:p.handle, role:p.role } };
}

async function apiResendVerification(body) {
  const { email } = body||{};
  if (!email) return { status:400, body:{ error:'email required' } };
  const { rows } = await query('SELECT id, email, email_verified FROM players WHERE email=$1', [email.toLowerCase().trim()]);
  if (!rows.length) return { status:200, body:{ sent:true } }; // don't reveal if account exists
  const p = rows[0];
  if (p.email_verified) return { status:400, body:{ error:'This account is already verified.' } };
  await query('UPDATE email_verification_tokens SET used=TRUE WHERE player_id=$1 AND used=FALSE', [p.id]);
  const token = randomBytes(32).toString('hex');
  await query('INSERT INTO email_verification_tokens (player_id, token, expires_at) VALUES ($1,$2,$3)', [p.id, token, Date.now() + 24 * 60 * 60 * 1000]);
  const verifyUrl = `${process.env.CLIENT_BASE_URL || 'http://localhost:3000'}/game?verify_token=${token}`;
  sendVerificationEmail(p.email, verifyUrl).catch(e => console.error('[resend-verification] email failed:', e.message));
  return { status:200, body:{ sent:true } };
}

async function apiEmailHint(username) {
  if (!username) return { status:200, body:{ email: '' } };
  const { rows } = await query('SELECT email FROM players WHERE username=$1', [username.toLowerCase().trim()]);
  if (!rows.length || !rows[0].email) return { status:200, body:{ hint: '', email: '' } };
  const real = rows[0].email;
  const [local, domain] = real.split('@');
  const hint = local.length <= 4 ? '*'.repeat(local.length) : local.slice(0,2) + '*'.repeat(local.length - 4) + local.slice(-2);
  return { status:200, body:{ hint: `${hint}@${domain}`, email: real } };
}

async function apiForgotPassword(body) {
  const { email } = body||{};
  console.log('[forgot-password] request for email:', email);
  if (!email) return { status:400, body:{ error:'email required' } };
  const { rows } = await query('SELECT id FROM players WHERE email=$1', [email.toLowerCase().trim()]);
  console.log('[forgot-password] db lookup rows:', rows.length);
  if (!rows.length) return { status:404, body:{ error:'No account found with that email address.' } };
  const playerId = rows[0].id;
  await query('UPDATE password_reset_tokens SET used=TRUE WHERE player_id=$1 AND used=FALSE', [playerId]);
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 60 * 60 * 1000;
  await query(
    'INSERT INTO password_reset_tokens (player_id, token, expires_at, used) VALUES ($1,$2,$3,FALSE)',
    [playerId, token, expiresAt]
  );
  const resetUrl = `${process.env.CLIENT_BASE_URL || 'http://localhost:3000'}/game?reset_token=${token}`;
  sendPasswordResetEmail(email.toLowerCase().trim(), resetUrl).then(() => {
    console.log('[forgot-password] email sent OK to:', email.toLowerCase().trim());
  }).catch(e => {
    console.error('[forgot-password] email send failed:', e.message, JSON.stringify(e.response || e.responseCode || ''));
  });
  return { status:200, body:{ message:'Reset link sent. Check your email.' } };
}

async function apiResetPassword(body) {
  const { token, password } = body||{};
  if (!token || !password) return { status:400, body:{ error:'token and password required' } };
  if (password.length < 8) return { status:400, body:{ error:'Password must be at least 8 characters.' } };
  const { rows } = await query('SELECT * FROM password_reset_tokens WHERE token=$1', [token]);
  if (!rows.length) return { status:400, body:{ error:'Invalid or expired reset link.' } };
  const row = rows[0];
  if (row.used)                    return { status:400, body:{ error:'This reset link has already been used.' } };
  if (Date.now() > row.expires_at) return { status:400, body:{ error:'This reset link has expired.' } };
  await query('UPDATE players SET password_hash=$1 WHERE id=$2', [hashPassword(password), row.player_id]);
  await query('UPDATE password_reset_tokens SET used=TRUE WHERE id=$1', [row.id]);
  return { status:200, body:{ message:'Password updated. You can now log in.' } };
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

export async function apiCreateZone(body,auth) {
  const id = body.id||`zone_${Date.now()}`;
  try {
    await query(`INSERT INTO zones (id,name,description,danger_rating,pvp_enabled,radiation_level,is_safe_zone,exits,ambient_events,ambient_theme,flags,created_by,map_id,grid_x,grid_y,grid_z,marker,color,bg_color,audio_theme_id,parent_zone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [id,body.name||'Unnamed Zone',body.description||'An empty place.',body.danger_rating||'medium',body.pvp_enabled?1:0,body.radiation_level||0,body.is_safe_zone?1:0,JSON.stringify(body.exits||{}),JSON.stringify(body.ambient_events||[]),body.ambient_theme||'indoors',JSON.stringify(body.flags||{}),auth?.playerId,body.map_id||null,body.grid_x??null,body.grid_y??null,body.grid_z??0,body.marker||null,body.color||null,body.bg_color||null,body.audio_theme_id||null,body.parent_zone||null]);
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
  const simple=['name','description','danger_rating','pvp_enabled','radiation_level','is_safe_zone','map_id','grid_x','grid_y','grid_z','marker','color','bg_color','audio_theme_id','parent_zone'];
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
  const { direction, name, description, is_building } = body || {};
  if (!direction || !name) return { status:400, body:{error:'direction and name are required'} };
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
    // Find or create the interior map for the parent zone.
    // The first room placed on a new map gets coordinates (0,0,0) — it's the entry point.
    // Additional rooms are left unplaced so the dev can drag them into position manually.
    const { rows: existingMaps } = await query(
      'SELECT id FROM maps WHERE parent_zone_id=$1 LIMIT 1', [parentZoneId]
    );
    let mapId, isFirstRoom;
    if (existingMaps.length) {
      mapId = existingMaps[0].id;
      const { rows: placedRooms } = await query(
        'SELECT 1 FROM zones WHERE map_id=$1 AND grid_x IS NOT NULL LIMIT 1', [mapId]
      );
      isFirstRoom = placedRooms.length === 0;
    } else {
      mapId = `map_int_${Date.now()}`;
      await query(
        `INSERT INTO maps (id, name, parent_zone_id, entry_zone_id) VALUES ($1,$2,$3,$4)`,
        [mapId, parent.name + ' — Interior', parentZoneId, roomId]
      );
      isFirstRoom = true;
    }

    await query(
      `INSERT INTO zones (id,name,description,danger_rating,pvp_enabled,radiation_level,is_safe_zone,exits,ambient_events,flags,map_id,grid_x,grid_y,grid_z)
       VALUES ($1,$2,$3,$4,0,0,1,$5,$6,$7,$8,$9,$10,$11)`,
      [roomId, name, description || 'A small room.', parent.danger_rating || 'safe',
       JSON.stringify(roomExits), JSON.stringify([]), JSON.stringify(is_building ? { is_building: true } : { is_interior: true }),
       mapId, isFirstRoom ? 0 : null, isFirstRoom ? 0 : null, 0]
    );
    const updatedParentExits = { ...parentExits, [direction]: roomId };
    await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(updatedParentExits), parentZoneId]);

    await reloadZone(parentZoneId);
    await reloadZone(roomId);

    return { status:201, body:{ id: roomId, message:`${is_building ? 'Building' : 'Room'} "${name}" added ${direction} of ${parent.name}` } };
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

async function apiDeleteMap(id) {
  try {
    const { rows: mapRows } = await query('SELECT id FROM maps WHERE id=$1', [id]);
    if (!mapRows.length) return { status: 404, body: { error: 'Map not found' } };
    // Get all zone IDs on this map — delete them using the full cascade logic
    const { rows: zoneRows } = await query('SELECT id FROM zones WHERE map_id=$1', [id]);
    // Delete each zone through the full cascade (handles npcs, furniture, exits, etc.)
    for (const { id: zid } of zoneRows) await apiDeleteZone(zid).catch(() => {});
    // Delete the map itself in case it wasn't caught by entry/parent zone cleanup
    await query('DELETE FROM maps WHERE id=$1', [id]);
    return { status: 200, body: { message: `Map deleted (${zoneRows.length} zone${zoneRows.length !== 1 ? 's' : ''} removed)` } };
  } catch (e) {
    return { status: 400, body: { error: e.message } };
  }
}

async function apiGetMap(id) {
  const { rows: mapRows } = await query('SELECT * FROM maps WHERE id=$1', [id]);
  if (!mapRows.length) return { status:404, body:{error:'Not found'} };
  const { rows: zones } = await query(
    `SELECT id, name, danger_rating, grid_x, grid_y, grid_z, marker, color, bg_color, exits, flags, map_id, is_safe_zone
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
  // Excludes: is_interior, is_apartment, is_building flags AND zones that are
  // children of another zone (parent_zone IS NOT NULL) or building roots
  // (have children referencing them via parent_zone — those go to unplacedInterior).
  const { rows: unplaced } = await query(
    `SELECT id, name, danger_rating, exits, flags FROM zones
     WHERE (map_id IS NULL OR map_id != $1)
       AND COALESCE((flags->>'is_interior')::boolean, false) = false
       AND COALESCE((flags->>'is_apartment')::boolean, false) = false
       AND parent_zone IS NULL
     ORDER BY name`,
    [id]
  );
  // Interior/apartment zones with no map assignment, plus zones that are
  // children of another zone (parent_zone IS NOT NULL), plus building roots
  // (zones whose children reference them via parent_zone, or is_building flag)
  // that are not yet reachable from any exterior zone.
  const { rows: unplacedInterior } = await query(`
    SELECT z.id, z.name, z.danger_rating, z.exits, z.flags,
           z.parent_zone,
           p.name AS parent_zone_name,
           CASE WHEN COALESCE((z.flags->>'is_building')::boolean, false) = true
                  OR EXISTS (SELECT 1 FROM zones c WHERE c.parent_zone = z.id)
                THEN true ELSE false END AS is_building_root
    FROM zones z
    LEFT JOIN zones p ON p.id = z.parent_zone
    WHERE z.map_id IS NULL
      AND (COALESCE((z.flags->>'is_interior')::boolean, false) = true
        OR COALESCE((z.flags->>'is_apartment')::boolean, false) = true
        OR z.parent_zone IS NOT NULL)
    UNION
    -- Building roots (have children or is_building) that no exterior zone exits to
    SELECT z.id, z.name, z.danger_rating, z.exits, z.flags,
           NULL AS parent_zone, NULL AS parent_zone_name, true AS is_building_root
    FROM zones z
    WHERE z.map_id IS NULL
      AND z.parent_zone IS NULL
      AND (COALESCE((z.flags->>'is_building')::boolean, false) = true
        OR EXISTS (SELECT 1 FROM zones c WHERE c.parent_zone = z.id))
      AND NOT EXISTS (
        SELECT 1 FROM zones ext, jsonb_each_text(COALESCE(ext.exits, '{}')) kv
        WHERE kv.value = z.id
      )
    ORDER BY name
  `);
  const { rows: buildingZoneRows } = await query(
    `SELECT id FROM zones WHERE COALESCE((flags->>'is_building')::boolean, false) = true`
  );
  return { status:200, body:{ map: mapRows[0], zones, children, unplaced, unplacedInterior, buildingZoneIds: buildingZoneRows.map(z => z.id) } };
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
  // Add the return exit on the interior zone (opposite direction back to the exterior zone).
  const returnDir = OPPOSITE[direction] || 'out';
  const intExits = JSON.stringify({ ...(intRows[0].exits || {}), [returnDir]: exteriorZoneId });
  // Update exterior zone exits and interior zone map placement + return exit.
  await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(exits), exteriorZoneId]);
  await query('UPDATE zones SET map_id=$1, grid_x=0, grid_y=0, grid_z=0, flags=$2, exits=$3 WHERE id=$4', [interiorMap.id, intFlags, intExits, interiorZoneId]);
  await Promise.all([reloadZone(exteriorZoneId), reloadZone(interiorZoneId)]);

  // Auto-layout children if a hallway stacking direction was provided.
  const { hallwayDir } = body || {};
  let layoutCount = 0;
  if (hallwayDir) {
    layoutCount = await autoLayoutInteriorChildren(interiorMap.id, interiorZoneId, hallwayDir);
  }

  return { status: 200, body: { interiorMap, layoutCount } };
}

// Given a placed building root zone at 0,0,0, traverse the exit chain in
// hallwayDir to order hallways, then place each hallway's children (units)
// at the exit-direction offset from the hallway cell.
const LAYOUT_DIR_OFFSET = { north:[0,-1,0], south:[0,1,0], east:[1,0,0], west:[-1,0,0], up:[0,0,1], down:[0,0,-1] };
const UNIT_DIR_OFFSET   = { north:[0,-1,0], south:[0,1,0], east:[1,0,0], west:[-1,0,0] };

async function autoLayoutInteriorChildren(mapId, rootZoneId, hallwayDir) {
  const { rows: rootRows } = await query('SELECT * FROM zones WHERE id=$1', [rootZoneId]);
  if (!rootRows.length) return 0;
  const rootZone = rootRows[0];

  // Load all direct children (hallways) of the root
  const { rows: hallways } = await query('SELECT * FROM zones WHERE parent_zone=$1', [rootZoneId]);
  if (!hallways.length) return 0;

  // Order hallways by following the exit chain from root in hallwayDir
  const hallwayById = new Map(hallways.map(h => [h.id, h]));
  const ordered = [];
  const seen = new Set([rootZoneId]);
  let cur = rootZone;
  while (cur) {
    const nextId = (cur.exits || {})[hallwayDir];
    if (!nextId || seen.has(nextId)) break;
    seen.add(nextId);
    const next = hallwayById.get(nextId);
    if (!next) break;
    ordered.push(next);
    cur = next;
  }
  // Any hallways not reached by the chain (e.g. roof off a different direction)
  for (const h of hallways) {
    if (!seen.has(h.id)) ordered.push(h);
  }

  const off = LAYOUT_DIR_OFFSET[hallwayDir] || [0, 0, 1];
  let count = 0;

  for (let i = 0; i < ordered.length; i++) {
    const hallway = ordered[i];
    const hx = (i + 1) * off[0];
    const hy = (i + 1) * off[1];
    const hz = (i + 1) * off[2];
    await query('UPDATE zones SET map_id=$1, grid_x=$2, grid_y=$3, grid_z=$4 WHERE id=$5',
      [mapId, hx, hy, hz, hallway.id]);
    reloadZone(hallway.id).catch(() => {});
    count++;

    // Place this hallway's children (units) at their exit offsets
    const { rows: units } = await query('SELECT * FROM zones WHERE parent_zone=$1', [hallway.id]);
    for (const unit of units) {
      const exitDir = allExits(hallway).find(e => e.target === unit.id)?.dir;
      const ud = exitDir && UNIT_DIR_OFFSET[exitDir];
      if (!ud) continue;
      await query('UPDATE zones SET map_id=$1, grid_x=$2, grid_y=$3, grid_z=$4 WHERE id=$5',
        [mapId, hx + ud[0], hy + ud[1], hz + ud[2], unit.id]);
      reloadZone(unit.id).catch(() => {});
      count++;
    }
  }
  return count;
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

export async function apiDeleteZone(id) {
  if (id==='zone_start') return {status:400,body:{error:'Cannot delete spawn zone'}};
  try {
    // If deleting an individual interior/apartment room, track its parent so we
    // can clean up the interior map if no rooms remain after deletion.
    const { rows: deletedRows } = await query('SELECT flags, exits FROM zones WHERE id=$1', [id]);
    const deletedFlags = deletedRows[0]?.flags || {};
    let roomParentId = null;
    if (deletedFlags.is_interior || deletedFlags.is_apartment) {
      const { rows: parentRows } = await query(
        `SELECT id FROM zones WHERE EXISTS (SELECT 1 FROM jsonb_each_text(exits) e WHERE e.value = $1)
         AND NOT COALESCE((flags->>'is_interior')::boolean, false)
         AND NOT COALESCE((flags->>'is_apartment')::boolean, false)`,
        [id]
      );
      roomParentId = parentRows[0]?.id || null;
    }

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
    // If any zone being deleted is on an interior map, pull in all sibling zones
    // on that same map. This ensures studio rooms (utility, production, stage) are
    // all deleted together regardless of which entry point the user deleted.
    {
      const { rows: mapRows } = await query(
        `SELECT DISTINCT z.map_id FROM zones z
         JOIN maps m ON m.id = z.map_id
         WHERE z.id = ANY($1) AND z.map_id IS NOT NULL AND m.parent_zone_id IS NOT NULL`,
        [allDeletedIds]
      );
      for (const { map_id } of mapRows) {
        const { rows: siblings } = await query(
          `SELECT id FROM zones WHERE map_id=$1 AND NOT (id = ANY($2))`,
          [map_id, allDeletedIds]
        );
        for (const s of siblings) allDeletedIds.push(s.id);
      }
    }
    // Cascade-delete everything tied to these zone IDs so nothing is left orphaned.
    for (const zid of allDeletedIds) {
      await query('DELETE FROM npcs             WHERE zone_id=$1', [zid]);
      await query('DELETE FROM furniture        WHERE zone_id=$1', [zid]);
      await query('DELETE FROM zone_spawns      WHERE zone_id=$1', [zid]);
      await query('DELETE FROM lighting_states  WHERE zone_id=$1', [zid]);
      await query('DELETE FROM power_zones      WHERE id=$1',                                                   [zid]);
      await query('DELETE FROM power_zones      WHERE generator_id IN (SELECT id FROM generators WHERE zone_id=$1)', [zid]);
      await query('DELETE FROM generators       WHERE zone_id=$1', [zid]);
      await query('DELETE FROM player_corpses   WHERE zone_id=$1', [zid]);
      await query('DELETE FROM world_events     WHERE zone_id=$1', [zid]);
      await query('DELETE FROM windows          WHERE zone_interior=$1 OR zone_exterior=$1', [zid]);
      await query('DELETE FROM media_cameras    WHERE zone_id=$1', [zid]);
      await query('DELETE FROM player_inventory WHERE player_id=$1', [`_ground_${zid}`]);
      // Delete NPCs homed in this zone, null out remaining references
      await query('DELETE FROM npcs             WHERE home_zone=$1',   [zid]);
      await query('UPDATE npcs SET home_zone=NULL   WHERE home_zone=$1', [zid]);
      await query(`UPDATE npcs SET wander_zones=(
        SELECT jsonb_agg(v) FROM jsonb_array_elements_text(wander_zones) t(v) WHERE v <> $1
      ) WHERE wander_zones @> to_jsonb($1::text)`, [zid]);
      // Null out broadcast studio references
      await query('UPDATE media_channels SET studio_zone_id=NULL WHERE studio_zone_id=$1', [zid]);
      // Fix player anchor/home zone references
      await query("UPDATE players SET anchor_zone='zone_start' WHERE anchor_zone=$1", [zid]);
      await query('UPDATE players SET home_zone=NULL           WHERE home_zone=$1',   [zid]);
      // Remove dangling exit links from any zone pointing at this one
      await query(`UPDATE zones SET exits=(
        SELECT jsonb_object_agg(key, value) FROM jsonb_each_text(exits) WHERE value <> $1
      ) WHERE exits IS NOT NULL AND exits::text LIKE '%' || $1 || '%'`, [zid]);
    }
    for (const zid of allDeletedIds) {
      await query('DELETE FROM apartments WHERE zone_id=$1', [zid]);
      await query('DELETE FROM zones WHERE id=$1', [zid]);
      world.zones.delete(zid);
    }
    // Clean up any interior maps whose entry zone or parent zone is among the deleted set.
    await query(
      `DELETE FROM maps WHERE entry_zone_id = ANY($1) OR parent_zone_id = ANY($1)`,
      [allDeletedIds]
    );
    // If we deleted an individual room, clean up the parent's interior map if no rooms remain.
    if (roomParentId) {
      const { rows: remaining } = await query(
        `SELECT 1 FROM zones
         WHERE (COALESCE((flags->>'is_interior')::boolean,false) OR COALESCE((flags->>'is_apartment')::boolean,false))
           AND EXISTS (SELECT 1 FROM jsonb_each_text(exits) e WHERE e.value = $1)
         LIMIT 1`,
        [roomParentId]
      );
      if (!remaining.length) {
        await query('DELETE FROM maps WHERE parent_zone_id=$1', [roomParentId]);
      }
    }
    await rescueDisplacedPlayers(allDeletedIds);
    fireHook('zone.delete', id, allDeletedIds).catch(() => {});
    return {status:200,body:{message: children.length ? `Zone deleted (and ${children.length} attached room${children.length>1?'s':''})` : 'Zone deleted'}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiGetZoneSpawns(zoneId) {
  const { rows } = await query(
    `SELECT zs.*, e.name AS enemy_name FROM zone_spawns zs JOIN enemies e ON e.id = zs.enemy_id WHERE zs.zone_id=$1 ORDER BY e.name`,
    [zoneId]
  );
  return { status:200, body:rows };
}
async function apiAddZoneSpawn(zoneId, body) {
  if (!body?.enemy_id) return { status:400, body:{ error:'enemy_id is required' } };
  const id = `spawn_${zoneId}_${body.enemy_id}_${Date.now()}`;
  try {
    await query(
      `INSERT INTO zone_spawns (id,zone_id,enemy_id,max_count,spawn_weight,respawn_seconds) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, zoneId, body.enemy_id, body.max_count??1, body.spawn_weight??100, body.respawn_seconds??300]
    );
    return { status:201, body:{ id } };
  } catch(e) { return { status:400, body:{ error:e.message } }; }
}
export async function apiCreateSpawn(body) {
  if (!body?.enemy_id || !body?.zone_id) return { status:400, body:{ error:'enemy_id and zone_id are required' } };
  const { zone_id, enemy_id, max_count=1, spawn_weight=100, respawn_seconds=300 } = body;
  const id = `spawn_${zone_id}_${enemy_id}_${Date.now()}`;
  try {
    await query(
      `INSERT INTO zone_spawns (id,zone_id,enemy_id,max_count,spawn_weight,respawn_seconds) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, zone_id, enemy_id, max_count, spawn_weight, respawn_seconds]
    );
    // Register in world spawn timers so the enemy respawns without a server restart
    world.spawnTimers.set(id, { id, zone_id, enemy_id, max_count, spawn_weight, respawn_seconds, nextSpawn: Date.now() });
    const { rows } = await query(`SELECT zs.*, e.name AS enemy_name FROM zone_spawns zs JOIN enemies e ON e.id=zs.enemy_id WHERE zs.id=$1`, [id]);
    return { status:201, body: rows[0] || { id } };
  } catch(e) { return { status:400, body:{ error:e.message } }; }
}
async function apiUpdateSpawn(id, body) {
  const max_count = parseInt(body.max_count);
  const respawn_seconds = parseInt(body.respawn_seconds);
  if (isNaN(max_count) || max_count < 1) return { status:400, body:{ error:'max_count must be >= 1' } };
  if (isNaN(respawn_seconds) || respawn_seconds < 1) return { status:400, body:{ error:'respawn_seconds must be >= 1' } };
  try {
    const { rows } = await query(
      'UPDATE zone_spawns SET max_count=$1, respawn_seconds=$2 WHERE id=$3 RETURNING *',
      [max_count, respawn_seconds, id]
    );
    if (!rows.length) return { status:404, body:{ error:'Spawn not found' } };
    const timer = world.spawnTimers.get(id);
    if (timer) world.spawnTimers.set(id, { ...timer, max_count, respawn_seconds });
    return { status:200, body: rows[0] };
  } catch(e) { return { status:400, body:{ error:e.message } }; }
}
export async function apiDeleteZoneSpawn(id) {
  try {
    await query('DELETE FROM zone_spawns WHERE id=$1', [id]);
    world.spawnTimers.delete(id);
    return { status:200, body:{ message:'Spawn removed' } };
  } catch(e) { return { status:400, body:{ error:e.message } }; }
}
async function apiSpawnLiveEnemy(zoneId, body) {
  if (!body?.enemy_id) return { status:400, body:{ error:'enemy_id is required' } };
  const { rows } = await query('SELECT * FROM enemies WHERE id=$1', [body.enemy_id]);
  if (!rows.length) return { status:404, body:{ error:'Enemy template not found' } };
  const zone = world.zones.get(zoneId);
  if (!zone) return { status:404, body:{ error:'Zone not loaded' } };
  // Respect max_count — look up the spawn record for this template in this zone
  const { rows: spawnRows } = await query(
    'SELECT max_count FROM zone_spawns WHERE zone_id=$1 AND enemy_id=$2 ORDER BY max_count DESC LIMIT 1',
    [zoneId, body.enemy_id]
  );
  const maxCount = spawnRows[0]?.max_count ?? 1;
  const currentCount = [...zone.enemies].filter(id => world.enemies.get(id)?.templateId === body.enemy_id).length;
  if (currentCount >= maxCount) {
    return { status:200, body:{ skipped: true, message: `Already at max_count (${maxCount}) for this zone` } };
  }
  const instance = spawnEnemySync(rows[0], zoneId);
  if (broadcastFn && zone.players.size > 0) {
    broadcastFn(zoneId, { type:'zone_event', message:`A ${instance.name} appears.`, refresh: true });
  }
  return { status:201, body:{ instanceId: instance.instanceId, name: instance.name, hp: instance.hp, hp_max: instance.hp_max } };
}
function apiGetZoneLiveEnemies(zoneId) {
  const zone = world.zones.get(zoneId);
  if (!zone) return { status:404, body:{ error:'Zone not found' } };
  const instances = [...zone.enemies]
    .map(id => world.enemies.get(id))
    .filter(Boolean)
    .map(e => ({ instanceId: e.instanceId, templateId: e.templateId, name: e.name, hp: e.hp, hp_max: e.hp_max, zoneId: e.zoneId }));
  return { status:200, body: instances };
}
function apiDespawnEnemy(instanceId) {
  const enemy = world.enemies.get(instanceId);
  if (!enemy) return { status:404, body:{ error:'Instance not found' } };
  world.zones.get(enemy.zoneId)?.enemies.delete(instanceId);
  world.enemies.delete(instanceId);
  return { status:200, body:{ message:'Enemy despawned' } };
}
function apiDespawnAllEnemies() {
  let count = 0;
  for (const [instanceId, enemy] of world.enemies) {
    world.zones.get(enemy.zoneId)?.enemies.delete(instanceId);
    world.enemies.delete(instanceId);
    count++;
  }
  return { status:200, body:{ message:`Despawned ${count} enemies` } };
}
async function apiGetEnemies() { const {rows}=await query('SELECT * FROM enemies'); return {status:200,body:rows}; }
export async function apiCreateEnemy(body) {
  const id=body.id||`enemy_${Date.now()}`;
  try {
    await query(`INSERT INTO enemies (id,name,description,hit,dodge,hp_max,weapon,body_parts,loot_table,butcher_table,butcher_difficulty,behavior,faction,death_message,flags,behaviour_graph) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [id,body.name,body.description,body.hit??1,body.dodge??1,body.hp_max||30,JSON.stringify(body.weapon||[]),JSON.stringify(body.body_parts||[]),JSON.stringify(body.loot_table||[]),JSON.stringify(body.butcher_table||[]),body.butcher_difficulty??5,body.behavior||'aggressive',body.faction||null,body.death_message||'It dies.',JSON.stringify(body.flags||{}),JSON.stringify(body.behaviour_graph||{})]);
    return {status:201,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
export async function apiUpdateEnemy(id,body) {
  try {
    await query(`UPDATE enemies SET name=$1,description=$2,hit=$3,dodge=$4,hp_max=$5,weapon=$6,body_parts=$7,loot_table=$8,butcher_table=$9,butcher_difficulty=$10,behavior=$11,faction=$12,death_message=$13,flags=$14,behaviour_graph=$15 WHERE id=$16`,
      [body.name,body.description,body.hit??1,body.dodge??1,body.hp_max,JSON.stringify(body.weapon||[]),JSON.stringify(body.body_parts||[]),JSON.stringify(body.loot_table||[]),JSON.stringify(body.butcher_table||[]),body.butcher_difficulty??5,body.behavior,body.faction,body.death_message,JSON.stringify(body.flags||{}),JSON.stringify(body.behaviour_graph||{}),id]);
    return {status:200,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
export async function apiDeleteEnemy(id) {
  try {
    await query('DELETE FROM enemies WHERE id=$1',[id]);
    return {status:200,body:{message:'Deleted'}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiGetItems() { const {rows}=await query('SELECT * FROM items'); return {status:200,body:rows}; }
// Flatten authored tags + applied supertags into the stored `tags` object. The
// client sends authored tags in `body.tags` and applied supertag keys in
// `body.supertags`; replayed/legacy bodies are handled via the bookkeeping keys.
function itemTagsFor(body) {
  const keys = Array.isArray(body.supertags) ? body.supertags : superKeys(body.tags);
  return materializeItemTags(ownTags(body.tags), keys);
}
export async function apiCreateItem(body) {
  const id=body.id||`item_${Date.now()}`;
  try {
    await query(`INSERT INTO items (id,name,type,weight,value,tags) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id,body.name,body.type||null,body.weight||1000,body.value||0,JSON.stringify(itemTagsFor(body))]);
    return {status:201,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
export async function apiUpdateItem(id,body) {
  try {
    await query(`UPDATE items SET name=$1,type=$2,weight=$3,value=$4,tags=$5 WHERE id=$6`,
      [body.name,body.type||null,body.weight,body.value,JSON.stringify(itemTagsFor(body)),id]);
    return {status:200,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
export async function apiDeleteItem(id) {
  try {
    await query('DELETE FROM items WHERE id=$1', [id]);
    return {status:200,body:{deleted:id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiGetNpcs() { const {rows}=await query('SELECT * FROM npcs'); return {status:200,body:rows}; }

// Derive an NPC's work hours from the broadcast schedule (daily-mode channels only).
// A studio/broadcast NPC's real "at work" state is driven by whether it appears in a
// playlist item's conditions.npc_staff during that item's game-time window (see the
// broadcast plugin's isNpcScheduledNow). This surfaces that same source, read-only,
// for the NPC editor's Work Schedule grid — the vendor_schedule column is never used
// for these NPCs, so it stays untouched. Broadcasts loop daily, so the same hour
// blocks apply to every weekday.
async function apiGetNpcBroadcastSchedule(id) {
  const { rows } = await query(`
    SELECT p.start_time, p.duration_override, p.conditions,
           b.name AS broadcast_name, b.messages, b.message_interval, b.override_duration,
           c.name AS channel_name, c.schedule_mode
    FROM media_channel_playlist p
    JOIN media_broadcasts b ON b.id = p.broadcast_id
    LEFT JOIN media_channels c ON c.id = p.channel_id
  `);
  const hours = new Array(24).fill(false);
  const slots = [];
  for (const r of rows) {
    if ((r.schedule_mode || 'loop') !== 'daily') continue; // only daily maps to hours-of-day
    let cond = r.conditions;
    if (typeof cond === 'string') { try { cond = JSON.parse(cond); } catch { cond = {}; } }
    const staff = Array.isArray(cond?.npc_staff) ? cond.npc_staff : [];
    if (!staff.includes(id)) continue;
    const msgs = Array.isArray(r.messages) ? r.messages.length : 0;
    const dur = r.duration_override || r.override_duration || (msgs * (r.message_interval || 5)) || 3600;
    const start = r.start_time || 0;
    const end = start + dur;
    for (let h = Math.floor(start / 3600); h < Math.min(24, Math.ceil(end / 3600)); h++) {
      if (h >= 0 && h < 24) hours[h] = true;
    }
    slots.push({ channel: r.channel_name || null, broadcast: r.broadcast_name || null, from: start, to: end });
  }
  // Coalesce lit hours into contiguous blocks, apply to every day (daily loop).
  const blocks = [];
  for (let h = 0; h < 24; ) {
    if (!hours[h]) { h++; continue; }
    let to = h + 1;
    while (to < 24 && hours[to]) to++;
    blocks.push({ from: h, to });
    h = to;
  }
  const schedule = {};
  for (const d of ['mon','tue','wed','thu','fri','sat','sun']) schedule[d] = blocks;
  return { status: 200, body: { staffed: slots.length > 0, schedule, slots } };
}

// ── Shared ambient-banter library ─────────────────────────────────────────────
async function apiListBanter() {
  const {rows}=await query('SELECT id,personality,lines,enabled,sort_order FROM npc_banter_threads ORDER BY sort_order, id');
  return {status:200,body:rows};
}
// Bulk-replace the whole library (the dev-panel editor sends the full list).
async function apiReplaceBanter(body) {
  const threads = Array.isArray(body.threads) ? body.threads : [];
  try {
    await query('DELETE FROM npc_banter_threads');
    let i = 0;
    for (const t of threads) {
      const lines = Array.isArray(t.lines) ? t.lines.map(l=>String(l).trim()).filter(Boolean) : [];
      if (!lines.length) continue;
      const id = t.id && /^bt_/.test(t.id) ? t.id : `bt_${Date.now().toString(36)}_${i}`;
      await query('INSERT INTO npc_banter_threads (id,personality,lines,enabled,sort_order) VALUES ($1,$2,$3,$4,$5)',
        [id, (t.personality||'').trim()||null, JSON.stringify(lines), t.enabled===false?false:true, i]);
      i++;
    }
    await loadBanterLibrary();
    return {status:200,body:{ok:true,count:i}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
// Apartment units (flags.is_apartment) that no player owns and no other NPC
// already calls home — the pool of places an NPC can be housed in. Ordered by
// id so assignment is stable/repeatable. Excludes the generic residential lobby
// implicitly (it isn't an apartment).
async function listVacantApartmentZones() {
  const { rows } = await query(
    `SELECT z.id FROM zones z
       LEFT JOIN apartments a ON a.zone_id = z.id
      WHERE COALESCE((z.flags->>'is_apartment')::boolean, false) = true
        AND a.owner_id IS NULL
        AND z.id NOT IN (SELECT home_zone FROM npcs WHERE home_zone IS NOT NULL)
      ORDER BY z.id`);
  return rows.map(r => r.id);
}

export async function apiCreateNpc(body) {
  const id=body.id||`npc_${Date.now()}`;
  // Auto-house new NPCs in a vacant apartment when the caller didn't pick a home;
  // fall back to the generic residential lobby if none is free (a home is a nicety,
  // not a requirement).
  const homeZone = body.home_zone
    || (await listVacantApartmentZones())[0]
    || 'zone_residential_lobby';
  // Chitchat is now optional — empty means "use the archetype default" (resolved
  // at runtime via getNpcChitchat), so store exactly what the editor sent.
  const chitchat = Array.isArray(body.chitchat) ? body.chitchat : [];
  // npc_type is derived from the archetype (flags.personality); fall back to any
  // explicitly-provided type for seeds/callers that set it directly.
  const npcType = npcTypeForPersonality(body.flags?.personality) || body.npc_type || 'npc';
  try {
    const hpMax = body.hp_max || 20;
    const { buildDefaultVendorGraph, buildDefaultStudioGraph, buildDefaultUnemployedGraph } = await import('../engine/ai-behaviour.js');
    // Broadcast actors follow their studio's broadcast schedule instead of a manual
    // work schedule — everyone else with a job (vendor or not) gets the generic
    // schedule-respecting graph (CHECK_VENDOR_WORK branches on vendor_schedule).
    const isActor = !!body.studio_zone_id;
    const rawGraph = body.behaviour_graph && Object.keys(body.behaviour_graph).length
      ? body.behaviour_graph
      : (npcType === 'unemployed' ? buildDefaultUnemployedGraph() : isActor ? buildDefaultStudioGraph() : buildDefaultVendorGraph());
    const vendorSchedule = (npcType !== 'unemployed' && !isActor && !Object.keys(body.vendor_schedule||{}).length)
      ? DEFAULT_VENDOR_SCHEDULE : (body.vendor_schedule || {});
    const homeActivities = Array.isArray(body.home_activities) ? body.home_activities : [];
    const banter = Array.isArray(body.banter) ? body.banter : [];
    // Decide the NPC's sex once (caller value → inferred from the description →
    // coin flip) and persist it, so clothing, pronouns and the naked-look lines
    // all agree. The dev-panel editor doesn't send sex, so this is where it's set.
    const sex = decideSex(body.sex, body.name, body.description, id);
    // Give the NPC a sex-appropriate outfit unless the caller authored one
    // (e.g. strippers set their own clothing_layers). Descriptive text only.
    const flags = body.flags || {};
    if (flags.personality && !Array.isArray(flags.clothing_layers)) {
      const outfit = pickClothingForPersonality(flags.personality, sex);
      if (outfit) flags.clothing_layers = outfit;
    }
    await query(`INSERT INTO npcs (id,name,description,zone_id,home_zone,faction,dialogue_tree,vendor_inventory,wanders,wander_zones,flags,behaviour_graph,chitchat,studio_zone_id,work_zone_id,hp,hp_max,npc_type,vendor_schedule,vendor_shop_name,home_activities,banter,sex) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [id,body.name,body.description,body.zone_id||null,homeZone,body.faction||null,JSON.stringify(body.dialogue_tree||{}),JSON.stringify(body.vendor_inventory||[]),body.wanders?1:0,JSON.stringify(body.wander_zones||[]),JSON.stringify(flags),JSON.stringify(rawGraph),JSON.stringify(chitchat),body.studio_zone_id||null,body.work_zone_id||null,hpMax,hpMax,npcType,JSON.stringify(vendorSchedule),body.vendor_shop_name||null,JSON.stringify(homeActivities),JSON.stringify(banter),sex]);
    // Register in world memory so the NPC is immediately visible
    const { world: w } = await import('../engine/world.js');
    const { initBlackboard } = await import('../engine/ai-behaviour.js');
    w.npcs.set(id, { id, name:body.name, description:body.description, sex, zone_id:body.zone_id||null, home_zone:homeZone, faction:body.faction||null, dialogue_tree:body.dialogue_tree||{}, vendor_inventory:body.vendor_inventory||[], wanders:body.wanders?1:0, wander_zones:body.wander_zones||[], flags, behaviour_graph:rawGraph, chitchat, studio_zone_id:body.studio_zone_id||null, work_zone_id:body.work_zone_id||null, hp:hpMax, hp_max:hpMax, npc_type:npcType, vendor_schedule:vendorSchedule, vendor_bank_credits:0, vendor_shop_name:body.vendor_shop_name||null, home_activities:homeActivities, banter, _ai:initBlackboard() });
    if (body.zone_id) w.zones.get(body.zone_id)?.npcs.add(id);
    if (npcType === 'vendor' && body.work_zone_id) {
      const npcForBoard = { name: body.name, vendor_schedule: vendorSchedule, vendor_shop_name: body.vendor_shop_name||null };
      await query(`INSERT INTO furniture (id,zone_id,name,description,flags,object_type) VALUES ($1,$2,$3,$4,$5,'decoration') ON CONFLICT (id) DO NOTHING`,
        [`furn_schd_${id}`, body.work_zone_id, `${body.name}'s Schedule`, formatScheduleBoard(npcForBoard), JSON.stringify({ vendor_schedule_board: true, vendor_npc_id: id })]);
    }
    return {status:201,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
export async function apiUpdateNpc(id,body) {
  try {
    const npcType = npcTypeForPersonality(body.flags?.personality) || body.npc_type || 'npc';
    const { buildDefaultVendorGraph, buildDefaultStudioGraph, buildDefaultUnemployedGraph } = await import('../engine/ai-behaviour.js');
    // studio_zone_id isn't editable from this form — it's assigned via the Broadcast
    // panel — so fall back to the existing in-memory/DB value to detect actors.
    const { world: w } = await import('../engine/world.js');
    const existing = w.npcs.get(id);
    const isActor = !!(body.studio_zone_id || existing?.studio_zone_id);
    const rawGraph = body.behaviour_graph && Object.keys(body.behaviour_graph).length
      ? body.behaviour_graph
      : (npcType === 'unemployed' ? buildDefaultUnemployedGraph() : isActor ? buildDefaultStudioGraph() : buildDefaultVendorGraph());
    await query(`UPDATE npcs SET name=$1,description=$2,zone_id=$3,home_zone=$4,faction=$5,dialogue_tree=$6,vendor_inventory=$7,wanders=$8,wander_zones=$9,flags=$10,behaviour_graph=$11,work_zone_id=$12,chitchat=$13,hp_max=$14,hp=LEAST(hp,$14),vendor_stock_size=$16,vendor_restock_rate=$17,npc_type=$18,vendor_schedule=$19,vendor_shop_name=$20,home_activities=$21,banter=$22 WHERE id=$15`,
      [body.name,body.description,body.zone_id,body.home_zone||null,body.faction,JSON.stringify(body.dialogue_tree||{}),JSON.stringify(body.vendor_inventory||[]),body.wanders?1:0,JSON.stringify(body.wander_zones||[]),JSON.stringify(body.flags||{}),JSON.stringify(rawGraph),body.work_zone_id||null,JSON.stringify(body.chitchat||[]),body.hp_max||20,id,body.vendor_stock_size||10,body.vendor_restock_rate||1,npcType,JSON.stringify(body.vendor_schedule||{}),body.vendor_shop_name||null,JSON.stringify(body.home_activities||[]),JSON.stringify(Array.isArray(body.banter)?body.banter:[])]);
    // Update in-memory NPC and sync zone.npcs sets
    const oldZone = existing?.zone_id;
    const newZone = body.zone_id || null;
    const newHpMax = body.hp_max || 20;
    if (existing) Object.assign(existing, { name:body.name, description:body.description, zone_id:newZone, home_zone:body.home_zone||null, faction:body.faction, dialogue_tree:body.dialogue_tree||{}, vendor_inventory:body.vendor_inventory||[], wanders:body.wanders?1:0, wander_zones:body.wander_zones||[], flags:body.flags||{}, behaviour_graph:rawGraph, work_zone_id:body.work_zone_id||null, chitchat:body.chitchat||[], hp_max:newHpMax, hp:Math.min(existing.hp??newHpMax, newHpMax), vendor_stock_size:body.vendor_stock_size||10, vendor_restock_rate:body.vendor_restock_rate||1, npc_type:npcType, vendor_schedule:body.vendor_schedule||{}, vendor_shop_name:body.vendor_shop_name||null, home_activities:body.home_activities||[], banter:Array.isArray(body.banter)?body.banter:[] });
    // Upsert/remove schedule board furniture based on current work zone
    if (npcType === 'vendor') {
      const boardId = `furn_schd_${id}`;
      const boardFlags = JSON.stringify({ vendor_schedule_board: true, vendor_npc_id: id });
      if (body.work_zone_id) {
        const npcForBoard = { name: body.name, vendor_schedule: body.vendor_schedule||{}, vendor_shop_name: body.vendor_shop_name||null };
        const boardDesc = formatScheduleBoard(npcForBoard);
        await query(
          `INSERT INTO furniture (id,zone_id,name,description,flags,object_type) VALUES ($1,$2,$3,$4,$5,'decoration')
           ON CONFLICT (id) DO UPDATE SET zone_id=$2, name=$3, description=$4`,
          [boardId, body.work_zone_id, `${body.name}'s Schedule`, boardDesc, boardFlags]
        );
      } else {
        await query(`DELETE FROM furniture WHERE id=$1`, [boardId]);
      }
    }
    if (oldZone !== newZone) {
      if (oldZone) w.zones.get(oldZone)?.npcs.delete(id);
      if (newZone) w.zones.get(newZone)?.npcs.add(id);
    }
    return {status:200,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
const NPC_GRAPH_FIELDS = new Set(['behaviour_graph', 'dialogue_tree']);
const ENEMY_GRAPH_FIELDS = new Set(['behaviour_graph']);
const BROADCAST_GRAPH_FIELDS = new Set(['broadcast_graph']);
async function apiPatchGraph(table, id, body) {
  const allowed = table === 'npcs' ? NPC_GRAPH_FIELDS
    : table === 'media_broadcasts' ? BROADCAST_GRAPH_FIELDS
    : ENEMY_GRAPH_FIELDS;
  const field = body.field;
  if (!allowed.has(field)) return { status: 400, body: { error: `Invalid field '${field}' for ${table}` } };
  if (!body.graph || typeof body.graph !== 'object') return { status: 400, body: { error: 'graph must be an object' } };
  try {
    const { rowCount } = await query(
      `UPDATE ${table} SET ${field}=$1 WHERE id=$2`,
      [JSON.stringify(body.graph), id]
    );
    if (!rowCount) return { status: 404, body: { error: 'Not found' } };
    return { status: 200, body: { ok: true } };
  } catch (e) { return { status: 400, body: { error: e.message } }; }
}

async function apiRestockVendor(id) {
  try {
    const { rows } = await query(
      'SELECT id, vendor_inventory, vendor_stock, vendor_stock_size, vendor_restock_rate FROM npcs WHERE id=$1',
      [id]
    );
    if (!rows.length) return { status: 404, body: { error: 'NPC not found' } };
    const { restockVendor } = await import('../engine/vendor.js');
    await restockVendor(rows[0]);
    const { rows: updated } = await query('SELECT vendor_stock FROM npcs WHERE id=$1', [id]);
    // Sync world memory
    const { world: w } = await import('../engine/world.js');
    const live = w.npcs.get(id);
    if (live) live.vendor_stock = updated[0]?.vendor_stock || [];
    return { status: 200, body: { vendor_stock: updated[0]?.vendor_stock || [] } };
  } catch (e) { return { status: 400, body: { error: e.message } }; }
}
async function apiSendLateNpcsToWork() {
  try {
    const { world: w } = await import('../engine/world.js');
    const env = getEnvironmentState();
    const moved = [];
    for (const npc of w.npcs.values()) {
      const target = npc.work_zone_id;
      if (!target || npc.zone_id === target) continue;
      if (npc.npc_type === 'unemployed' || npc.studio_zone_id) continue;
      if (!isVendorWorkTime(npc, env).working) continue; // not scheduled right now — leave them be
      const oldZone = npc.zone_id;
      await query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [target, npc.id]);
      if (oldZone) w.zones.get(oldZone)?.npcs.delete(npc.id);
      npc.zone_id = target;
      w.zones.get(target)?.npcs.add(npc.id);
      moved.push({ id: npc.id, name: npc.name, from: oldZone, to: target });
    }
    return { status: 200, body: { moved, count: moved.length } };
  } catch (e) { return { status: 400, body: { error: e.message } }; }
}

// House every "unhoused" NPC — home_zone null/empty or still on the generic
// zone_residential_lobby default — by handing each a distinct vacant apartment
// unit. Stops when the vacant pool runs dry; unhoused NPCs left over are
// reported so the dev knows to build more units.
async function apiHouseUnhousedNpcs() {
  try {
    const { world: w } = await import('../engine/world.js');
    const { rows: unhoused } = await query(
      `SELECT id, name FROM npcs
        WHERE home_zone IS NULL OR home_zone = '' OR home_zone = 'zone_residential_lobby'
        ORDER BY id`);
    if (!unhoused.length) return { status: 200, body: { housed: [], count: 0, remaining: 0 } };

    const pool = await listVacantApartmentZones();
    const housed = [];
    for (const npc of unhoused) {
      const zoneId = pool.shift();
      if (!zoneId) break; // no more vacant apartments
      await query('UPDATE npcs SET home_zone=$1 WHERE id=$2', [zoneId, npc.id]);
      const live = w.npcs.get(npc.id);
      if (live) live.home_zone = zoneId;
      housed.push({ id: npc.id, name: npc.name, home: zoneId });
    }
    return { status: 200, body: { housed, count: housed.length, remaining: unhoused.length - housed.length } };
  } catch (e) { return { status: 400, body: { error: e.message } }; }
}

export async function apiPlaceSafe(id) {
  try {
    const { rows: npcRows } = await query('SELECT id, name, work_zone_id FROM npcs WHERE id=$1', [id]);
    if (!npcRows.length) return { status: 404, body: { error: 'NPC not found' } };
    const npc = npcRows[0];
    if (!npc.work_zone_id) return { status: 400, body: { error: 'NPC has no work zone set.' } };

    // Check if safe already exists
    const { rows: existing } = await query(
      `SELECT id FROM furniture WHERE zone_id=$1 AND flags @> $2 LIMIT 1`,
      [npc.work_zone_id, JSON.stringify({ vendor_safe: true, vendor_npc_id: id })]
    );
    if (existing.length) return { status: 200, body: { already_exists: true, id: existing[0].id } };

    const safeId = `furniture_safe_${id}_${Date.now()}`;
    const flags = { vendor_safe: true, vendor_npc_id: id, hack_difficulty: 5 };
    await query(
      `INSERT INTO furniture (id, zone_id, name, description, flags) VALUES ($1,$2,$3,$4,$5)`,
      [safeId, npc.work_zone_id, `${npc.name}'s Safe`, 'A secure holo-lock safe.', JSON.stringify(flags)]
    );
    return { status: 201, body: { id: safeId } };
  } catch (e) { return { status: 400, body: { error: e.message } }; }
}

export async function apiGetSafeStatus(id) {
  try {
    const { rows: npcRows } = await query('SELECT work_zone_id FROM npcs WHERE id=$1', [id]);
    if (!npcRows.length) return { status: 404, body: { error: 'NPC not found' } };
    const { work_zone_id } = npcRows[0];
    if (!work_zone_id) return { status: 200, body: { exists: false, zone_id: null, furniture_id: null } };

    const { rows } = await query(
      `SELECT id FROM furniture WHERE zone_id=$1 AND flags @> $2 LIMIT 1`,
      [work_zone_id, JSON.stringify({ vendor_safe: true, vendor_npc_id: id })]
    );
    return { status: 200, body: { exists: rows.length > 0, zone_id: work_zone_id, furniture_id: rows[0]?.id || null } };
  } catch (e) { return { status: 400, body: { error: e.message } }; }
}

export async function apiDeleteNpc(id) {
  try {
    const { world: w } = await import('../engine/world.js');
    const npc = w.npcs.get(id);
    if (npc?.zone_id) w.zones.get(npc.zone_id)?.npcs.delete(id);
    w.npcs.delete(id);
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
    const pdraw = body.power_draw_kw != null ? Number(body.power_draw_kw) : null;
    const isLight = body.object_type === 'light';
    const lumenOut = isLight && body.lumen_output != null ? Number(body.lumen_output) : null;
    await query(`INSERT INTO furniture (id,zone_id,name,description,object_type,light_on,light_type,power_draw_kw,lumen_output,flags,price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, body.zone_id, body.name, body.description||'', body.object_type||'furniture', isLight?(body.light_on?1:0):0, isLight?(body.light_type||'lamp'):null, pdraw, lumenOut, JSON.stringify(body.flags||{}), Number(body.price)||0]);
    if (body.flags?.atm) {
      await query(`INSERT INTO atm_units (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [id]);
    }
    if (isLight && body.zone_id) {
      const { rows: lc } = await query(`SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm FROM furniture WHERE zone_id=$1 AND object_type='light' AND light_on=1`, [body.zone_id]);
      await query(`INSERT INTO lighting_states (zone_id,has_emergency_lighting,artificial_light_level,fixture_count,total_lumens) VALUES ($1,0,0,$2,$3) ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2, total_lumens=$3`, [body.zone_id, lc[0]?.cnt||0, lc[0]?.lm||0]).catch(()=>{});
      await recomputePower().catch(()=>{});
    }
    return {status:201,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
export async function apiUpdateFurniture(id, body) {
  try {
    const sets = [], vals = [];
    let i = 1;
    const fields = ['zone_id','name','description','object_type','light_type'];
    for (const f of fields) if (body[f]!=null) { sets.push(`${f}=$${i++}`); vals.push(body[f]); }
    if (body.flags!=null) { sets.push(`flags=$${i++}`); vals.push(JSON.stringify(body.flags)); }
    if (body.light_on!=null) { sets.push(`light_on=$${i++}`); vals.push(body.light_on?1:0); }
    if (body.power_draw_kw!=null) { sets.push(`power_draw_kw=$${i++}`); vals.push(body.power_draw_kw === '' ? null : Number(body.power_draw_kw)); }
    if (body.lumen_output!=null) { sets.push(`lumen_output=$${i++}`); vals.push(body.lumen_output === '' ? null : Number(body.lumen_output)); }
    if (body.price!=null) { sets.push(`price=$${i++}`); vals.push(Number(body.price)||0); }
    if (!sets.length) return {status:400,body:{error:'nothing to update'}};
    vals.push(id);
    await query(`UPDATE furniture SET ${sets.join(',')} WHERE id=$${i}`, vals);
    if (body.flags?.atm) {
      await query(`INSERT INTO atm_units (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [id]);
    }
    // Resync total_lumens for this zone if the row is a light.
    const { rows: updated } = await query(`SELECT zone_id FROM furniture WHERE id=$1 AND object_type='light'`, [id]);
    if (updated[0]?.zone_id) {
      const zid = updated[0].zone_id;
      const { rows: lc } = await query(`SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm FROM furniture WHERE zone_id=$1 AND object_type='light' AND light_on=1`, [zid]);
      await query(`INSERT INTO lighting_states (zone_id,has_emergency_lighting,artificial_light_level,fixture_count,total_lumens) VALUES ($1,0,0,$2,$3) ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2, total_lumens=$3`, [zid, lc[0]?.cnt||0, lc[0]?.lm||0]).catch(()=>{});
      await recomputePower().catch(()=>{});
    }
    return {status:200,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
export async function apiDeleteFurniture(id) {
  try {
    await query('DELETE FROM furniture WHERE id=$1', [id]);
    return {status:200,body:{message:'Furniture deleted'}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiBulkAddStreetlights(auth) {
  const { rows: templates } = await query(
    `SELECT * FROM furniture WHERE object_type='light' AND light_type='streetlight' LIMIT 1`
  );
  const t = templates[0] || { name: 'Street Light', description: 'A tall metal post topped with a flickering sodium lamp.', object_type: 'light', light_type: 'streetlight', power_draw_kw: 200, lumen_output: 8000, flags: {} };
  const { rows: zones } = await query(`
    SELECT z.id, z.name FROM zones z
    WHERE NOT COALESCE((z.flags->>'is_interior')::boolean, false)
      AND NOT COALESCE((z.flags->>'is_apartment')::boolean, false)
      AND NOT COALESCE((z.flags->>'is_building')::boolean, false)
      AND z.is_safe_zone = 1
      AND z.id NOT IN (
        SELECT DISTINCT zone_id FROM furniture WHERE light_type='streetlight'
      )
      AND z.id NOT IN (
        SELECT staged_data::jsonb->>'zone_id' FROM staged_changes WHERE entity_type='furniture' AND staged_data::jsonb->>'light_type'='streetlight'
      )
  `);
  const { rows: authorRows } = await query('SELECT handle FROM players WHERE id=$1', [auth?.playerId]).catch(() => ({ rows: [] }));
  const author = authorRows[0]?.handle || auth?.playerId || 'system';
  let added = 0;
  for (const zone of zones) {
    const furnitureId = `furn_sl_${zone.id}`;
    const requestBody = { id: furnitureId, zone_id: zone.id, name: t.name, description: t.description, object_type: t.object_type, light_type: t.light_type, light_on: 0, power_draw_kw: t.power_draw_kw, lumen_output: t.lumen_output ?? 8000, flags: t.flags || {} };
    await query(`
      INSERT INTO staged_changes (id, entity_type, entity_id, entity_name, change_type, method, api_path, staged_data, description, author, staged_at)
      VALUES (gen_random_uuid()::text, 'furniture', $1, $2, 'create', 'POST', '/furniture', $3, $4, $5, NOW())
      ON CONFLICT (entity_type, entity_id) DO NOTHING`,
      [furnitureId, t.name, JSON.stringify(requestBody), `Add street light to ${zone.name || zone.id}`, author]
    );
    added++;
  }
  return { status:200, body:{ added, message:`${added} street light${added===1?'':'s'} staged — publish to apply.` } };
}
async function apiGetActivityLog() {
  const {rows} = await query(`SELECT event_type, handle, admin_handle, occurred_at FROM server_activity_log ORDER BY occurred_at DESC LIMIT 50`);
  return {status:200, body:{rows}};
}
async function apiGetPlayerCountLog(fullUrl) {
  const range = new URL('http://x' + (fullUrl||'')).searchParams.get('range') || '7d';
  // For long ranges the 1-minute samples are too dense to chart raw, so bucket
  // them server-side (max concurrent per bucket keeps peaks visible).
  if (range === 'all' || range === '30d') {
    const window = range === 'all' ? null : `NOW() - INTERVAL '30 days'`;
    const bucket = range === 'all' ? '1 hour' : '15 minutes';
    const {rows} = await query(
      `SELECT date_bin($1, recorded_at, TIMESTAMPTZ 'epoch') AS recorded_at, MAX(count)::int AS count
         FROM player_count_log
         ${window ? `WHERE recorded_at >= ${window}` : ''}
        GROUP BY 1 ORDER BY 1 ASC`,
      [bucket]
    );
    return {status:200, body:{rows}};
  }
  const {rows} = await query(
    `SELECT recorded_at, count FROM player_count_log
      WHERE recorded_at >= NOW() - INTERVAL '7 days' ORDER BY recorded_at ASC`
  );
  return {status:200, body:{rows}};
}
// Recent code activity from git, for the Dev Log check-in view. Read-only; if
// git isn't available (e.g. deployed from a tarball) it returns an empty list.
async function apiGetDevActivity(fullUrl) {
  const since = new URL('http://x' + (fullUrl||'')).searchParams.get('since');
  const args = [
    'log', '--no-merges',
    since ? `--since=${since}` : '--since=14.days.ago',
    '-n', '300',
    '--pretty=format:%x1e%H%x1f%an%x1f%aI%x1f%s',
    '--shortstat',
  ];
  let stdout = '';
  try {
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    ({ stdout } = await execFileP('git', args, { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 }));
  } catch {
    return { status: 200, body: { commits: [], gitUnavailable: true } };
  }
  const commits = stdout.split('\x1e').map(r => r.trim()).filter(Boolean).map(rec => {
    const nl = rec.indexOf('\n');
    const head = nl === -1 ? rec : rec.slice(0, nl);
    const rest = nl === -1 ? '' : rec.slice(nl + 1);
    const [hash, author, date, subject] = head.split('\x1f');
    const m = rest.match(/(\d+) files? changed/);
    return { hash: (hash||'').slice(0, 8), author: author||'?', date, subject: subject||'', filesChanged: m ? parseInt(m[1], 10) : 0 };
  });
  return { status: 200, body: { commits } };
}

async function apiGetDevNotes() {
  const { rows } = await query(`SELECT id, author, title, body, kind, resolved, created_at FROM dev_notes ORDER BY created_at DESC LIMIT 100`);
  return { status: 200, body: { notes: rows } };
}

async function apiCreateDevNote(body, auth) {
  const title = (body?.title || '').trim();
  if (!title) return { status: 400, body: { error: 'title required' } };
  const kind = ['change','heads-up','action-required'].includes(body?.kind) ? body.kind : 'change';
  const text = (body?.body || '').trim();
  const { rows: p } = await query(`SELECT handle FROM players WHERE id=$1`, [auth.playerId]);
  const author = p[0]?.handle || 'unknown';
  const { rows } = await query(
    `INSERT INTO dev_notes (author, title, body, kind) VALUES ($1,$2,$3,$4)
     RETURNING id, author, title, body, kind, resolved, created_at`,
    [author, title, text, kind]
  );
  return { status: 200, body: { note: rows[0] } };
}

async function apiUpdateDevNote(id, body) {
  if (typeof body?.resolved !== 'boolean') return { status: 400, body: { error: 'resolved boolean required' } };
  await query(`UPDATE dev_notes SET resolved=$1 WHERE id=$2`, [body.resolved, id]);
  return { status: 200, body: { ok: true } };
}

async function apiDeleteDevNote(id) {
  await query(`DELETE FROM dev_notes WHERE id=$1`, [id]);
  return { status: 200, body: { ok: true } };
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
  const {rows}=await query(`SELECT id,username,handle,role,current_zone,anchor_zone,credits,bank_credits,
    hp,hp_max,sanity,sanity_max,hunger,thirst,radiation,stamina,stamina_max,body_temp_c,
    stat_brawn,stat_reflexes,stat_endurance,stat_brains,stat_cool,stat_senses,bonus_xp,
    origin_fragment,archetype,visibly_mutated,offline_sleeping,created_at,last_seen FROM players`);
  const online = new Set(getAllLivePlayers().map(p=>p.id));
  return {status:200,body:rows.map(r=>({...r,online:online.has(r.id)}))};
}

async function apiGetPlayerProgression(id) {
  await ensureTunables();
  const {rows}=await query('SELECT id,stat_brawn,stat_reflexes,stat_endurance,stat_brains,stat_cool,stat_senses,COALESCE(bonus_xp,0) AS bonus_xp FROM players WHERE id=$1',[id]);
  if (!rows.length) return {status:404,body:{error:'Player not found'}};
  const p = rows[0];
  const {rows:skillRows}=await query('SELECT skill_id,ip FROM player_skills WHERE player_id=$1 ORDER BY ip DESC',[id]);
  const skills = skillRows.map(r=>({
    skill_id:r.skill_id,
    name:SKILLS[r.skill_id]?.name || r.skill_id,
    category:SKILLS[r.skill_id]?.category || '—',
    ip:r.ip||0,
    level:Math.floor((r.ip||0)/100),
  }));
  const {total,net}=await getNetXp(id);
  return {status:200,body:{
    skills,
    bonus_xp:Number(p.bonus_xp),
    total_xp:total,
    net_xp:net,
    spent_xp:statSpent(p),
  }};
}

async function apiUpdatePlayer(id, body) {
  const EDITABLE = [
    'handle','username','role','current_zone','anchor_zone',
    'credits','bank_credits','hp','hp_max','sanity','sanity_max',
    'hunger','thirst','radiation','stamina','stamina_max','body_temp_c',
    'stat_brawn','stat_reflexes','stat_endurance','stat_brains','stat_cool','stat_senses','bonus_xp',
    'origin_fragment','archetype','visibly_mutated','covered_in_blood',
  ];
  const {rows:existing}=await query('SELECT * FROM players WHERE id=$1',[id]);
  if (!existing.length) return {status:404,body:{error:'Player not found'}};

  const sets=[]; const vals=[];
  for (const key of EDITABLE) {
    if (!(key in body)) continue;
    sets.push(`${key}=$${vals.length+1}`);
    vals.push(body[key]);
  }
  // Editing endurance without an explicit hp_max keeps max HP consistent with
  // the formula; an explicit hp_max in the same request wins (manual override).
  if ('stat_endurance' in body && !('hp_max' in body)) {
    sets.push(`hp_max=$${vals.length+1}`);
    vals.push(maxHpForEndurance(body.stat_endurance));
  }
  if (!sets.length) return {status:400,body:{error:'No editable fields provided'}};
  vals.push(id);
  const {rows}=await query(`UPDATE players SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`,vals);
  const updated=rows[0];

  // Sync live player object if online
  const live=getAllLivePlayers().find(p=>p.id===id);
  if (live) {
    const LIVE_FIELDS=['handle','role','current_zone','anchor_zone','credits','bank_credits',
      'hp','hp_max','sanity','sanity_max','hunger','thirst','radiation','stamina','stamina_max',
      'body_temp_c','stat_brawn','stat_reflexes','stat_endurance','stat_brains','stat_cool','stat_senses','bonus_xp',
      'origin_fragment','archetype','visibly_mutated','covered_in_blood'];
    for (const f of LIVE_FIELDS) if (f in body) live[f]=updated[f];
    if ('stat_endurance' in body && !('hp_max' in body)) live.hp_max=updated.hp_max;
    broadcastFn(null,{type:'player_update',hp:live.hp,hp_max:live.hp_max,sanity:live.sanity,
      sanity_max:live.sanity_max,hunger:live.hunger,thirst:live.thirst,radiation:live.radiation,
      credits:live.credits,stamina:live.stamina,stamina_max:live.stamina_max},null,id);
  }
  return {status:200,body:{updated:true,player:updated}};
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

  handlePlayerDeath(player, null, { type: 'admin', label: 'Smitten by the Architect' });
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
  logActivity('kick', rows[0].handle, body?.adminHandle || 'An administrator');
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
  if (current_zone && current_zone !== zoneId) broadcastFn(current_zone,{type:'zone_event',message:`${handle} vanishes into thin air.`,refresh:true},id);
  broadcastFn(zoneId,{type:'zone_event',message:`${handle} materialises out of thin air.`,refresh:true},id);
  return {status:200,body:{teleported:true,handle,zoneId}};
}

async function apiGotoPlayer(targetId, auth) {
  if (!auth?.playerId) return {status:401,body:{error:'Not authenticated'}};
  const {rows:tRows}=await query('SELECT handle,current_zone FROM players WHERE id=$1',[targetId]);
  if (!tRows.length) return {status:404,body:{error:'Player not found'}};
  const {handle:targetHandle,current_zone:zoneId}=tRows[0];
  if (!zoneId) return {status:400,body:{error:`${targetHandle} has no current zone`}};
  const zone = getZone(zoneId);
  if (!zone) return {status:404,body:{error:'Zone not found'}};
  const {rows:aRows}=await query('SELECT handle,current_zone FROM players WHERE id=$1',[auth.playerId]);
  if (!aRows.length) return {status:404,body:{error:'Admin player not found'}};
  const {handle:adminHandle,current_zone:adminZone}=aRows[0];
  await query('UPDATE players SET current_zone=$1 WHERE id=$2',[zoneId,auth.playerId]);
  const adminLive = getAllLivePlayers().find(p=>p.id===auth.playerId);
  if (adminLive) {
    removePlayerFromZone(auth.playerId, adminZone);
    adminLive.current_zone = zoneId;
    addPlayerToZone(auth.playerId, zoneId);
  }
  const lookMsg = await describeZone(zone, adminLive || {handle:adminHandle,current_zone:zoneId});
  broadcastFn(null,{type:'move',message:`<span style="color:var(--cyan)">You phase-shift to ${targetHandle}'s location.</span>\n\n${lookMsg}`,zone:zoneId,minimap:getMinimapData(zoneId)},null,auth.playerId);
  if (adminZone && adminZone !== zoneId) broadcastFn(adminZone,{type:'zone_event',message:`${adminHandle} vanishes into thin air.`,refresh:true},auth.playerId);
  broadcastFn(zoneId,{type:'zone_event',message:`${adminHandle} materialises out of thin air.`,refresh:true},auth.playerId);
  return {status:200,body:{teleported:true,adminHandle,targetHandle,zoneId}};
}

async function apiUpdateOwnProfile(auth, body) {
  if (!auth?.playerId) return {status:401,body:{error:'Not authenticated'}};
  const text = (body?.origin_fragment ?? '').toString().trim().slice(0, 200);
  await query('UPDATE players SET origin_fragment=$1 WHERE id=$2', [text || null, auth.playerId]);
  const live = getAllLivePlayers().find(p => p.id === auth.playerId);
  if (live) live.origin_fragment = text || 'A survivor. Still standing, somehow.';
  return {status:200,body:{updated:true}};
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

// Crimes: canonical keys ship as engine defaults (crimes.js); the panel tunes the
// star weight per key. GET returns defaults merged with DB overrides; PUT upserts
// the override for one key.
async function apiGetCrimes() { return {status:200,body:getCrimeList()}; }
async function apiUpdateCrime(id,body) {
  if (!(id in CRIME_DEFAULTS)) return {status:404,body:{error:`Unknown crime "${id}".`}};
  const stars = Math.max(0, Math.min(5, Number(body.stars)));
  if (Number.isNaN(stars)) return {status:400,body:{error:'stars must be a number 0–5.'}};
  try {
    await query(
      `INSERT INTO crimes (id,label,stars,description) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET label=$2, stars=$3, description=$4`,
      [id, body.label || CRIME_DEFAULTS[id].label, stars, body.description || CRIME_DEFAULTS[id].description || '']
    );
    await reloadCrimes();
    return {status:200,body:{id,stars}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}

// Command aliases: shortcut → canonical verb, rewritten before dispatch. Engine
// ships defaults (aliases.js); the panel adds/removes DB rows. GET returns
// defaults merged with DB rows; POST upserts one row; DELETE removes a DB row
// (a shipped default reappears once its override row is gone).
async function apiGetAliases() { return {status:200,body:getAliasList()}; }
async function apiUpsertAlias(body) {
  const alias = String(body.alias||'').trim().toLowerCase();
  const verb  = String(body.verb||'').trim().toLowerCase();
  if (!alias || !verb) return {status:400,body:{error:'alias and verb are required.'}};
  if (/\s/.test(alias) || /\s/.test(verb)) return {status:400,body:{error:'alias and verb must be single words.'}};
  if (alias === verb) return {status:400,body:{error:'alias and verb cannot be identical.'}};
  try {
    await query(
      `INSERT INTO command_aliases (alias,verb) VALUES ($1,$2)
       ON CONFLICT (alias) DO UPDATE SET verb=$2`,
      [alias, verb]
    );
    await reloadAliases();
    return {status:200,body:{alias,verb}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiDeleteAlias(alias) {
  const key = String(alias||'').trim().toLowerCase();
  try {
    await query('DELETE FROM command_aliases WHERE alias=$1', [key]);
    await reloadAliases();
    // Report whether a shipped default still covers this alias after deletion.
    return {status:200,body:{alias:key, reverted_to_default: key in ALIAS_DEFAULTS}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}

async function apiGetMutations() { const {rows}=await query('SELECT * FROM mutations'); return {status:200,body:rows}; }
async function apiCreateMutation(body) {
  const id=body.id||`mut_${Date.now()}`;
  try {
    await query(`INSERT INTO mutations (id,name,description,polarity,visible,stat_modifiers,effects,drawbacks,radiation_threshold) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id,body.name,body.description||'',body.polarity||'mixed',body.visible?1:0,JSON.stringify(body.stat_modifiers||{}),JSON.stringify(body.effects||{}),JSON.stringify(body.drawbacks||[]),body.radiation_threshold||40]);
    await loadMutations();
    return {status:201,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
export async function apiUpdateMutation(id,body) {
  try {
    await query(`UPDATE mutations SET name=$1,description=$2,polarity=$3,visible=$4,stat_modifiers=$5,effects=$6,drawbacks=$7,radiation_threshold=$8 WHERE id=$9`,
      [body.name,body.description||'',body.polarity||'mixed',body.visible?1:0,JSON.stringify(body.stat_modifiers||{}),JSON.stringify(body.effects||{}),JSON.stringify(body.drawbacks||[]),body.radiation_threshold||40,id]);
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

// --- Scavenging tables (reusable loot templates; attached to zones via flags.scavenging_table_id) ---
async function apiGetScavengingTables() {
  const {rows}=await query(`
    SELECT t.*,
      (SELECT COUNT(*) FROM scavenging_table_items ti WHERE ti.table_id=t.id) AS entry_count,
      (SELECT COUNT(*) FROM zones z WHERE z.flags->>'scavenging_table_id' = t.id) AS zone_count
    FROM scavenging_tables t ORDER BY t.name`);
  return {status:200,body:rows};
}
async function apiGetScavengingTable(id) {
  const {rows}=await query('SELECT * FROM scavenging_tables WHERE id=$1',[id]);
  if(!rows.length) return {status:404,body:{error:'Not found'}};
  const {rows:entries}=await query(
    `SELECT ti.*, i.name AS item_name FROM scavenging_table_items ti
     LEFT JOIN items i ON i.id=ti.item_id WHERE ti.table_id=$1 ORDER BY ti.weight DESC`,[id]);
  return {status:200,body:{...rows[0], entries}};
}
async function apiGetScavengingZoneStock(id) {
  const {rows}=await query(
    `SELECT s.zone_id, z.name AS zone_name, s.item_id, i.name AS item_name, s.current_qty
     FROM scavenging_zone_stock s
     LEFT JOIN zones z ON z.id=s.zone_id
     LEFT JOIN items i ON i.id=s.item_id
     WHERE s.zone_id IN (SELECT id FROM zones WHERE flags->>'scavenging_table_id'=$1)
     ORDER BY z.name, i.name`,[id]);
  return {status:200,body:rows};
}
function _scavEntries(body){ return Array.isArray(body.entries)?body.entries:[]; }
async function _writeScavEntries(tableId, entries){
  await query('DELETE FROM scavenging_table_items WHERE table_id=$1',[tableId]);
  for(const e of entries){
    if(!e.item_id) continue;
    await query(
      `INSERT INTO scavenging_table_items (id, table_id, item_id, difficulty, weight, max_qty)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), tableId, e.item_id, parseInt(e.difficulty)||5, parseInt(e.weight)||10, parseInt(e.max_qty)||3]);
  }
}
export async function apiCreateScavengingTable(body) {
  const id=body.id||`scav_${Date.now()}`;
  try {
    await query(
      `INSERT INTO scavenging_tables (id, name, replenish_interval_seconds, messages)
       VALUES ($1,$2,$3,$4)`,
      [id, body.name||'Untitled Table', parseInt(body.replenish_interval_seconds)||300,
       JSON.stringify(body.messages||{})]);
    await _writeScavEntries(id, _scavEntries(body));
    return {status:201,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
export async function apiUpdateScavengingTable(id, body) {
  try {
    await query(
      `UPDATE scavenging_tables SET name=$1, replenish_interval_seconds=$2, messages=$3 WHERE id=$4`,
      [body.name||'Untitled Table', parseInt(body.replenish_interval_seconds)||300,
       JSON.stringify(body.messages||{}), id]);
    await _writeScavEntries(id, _scavEntries(body));
    return {status:200,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
export async function apiDeleteScavengingTable(id) {
  try {
    const {rows}=await query(`SELECT COUNT(*)::int AS n FROM zones WHERE flags->>'scavenging_table_id'=$1`,[id]);
    if(rows[0].n>0) return {status:409,body:{error:`Still attached to ${rows[0].n} zone(s). Detach it first.`}};
    await query('DELETE FROM scavenging_table_items WHERE table_id=$1',[id]);
    await query('DELETE FROM scavenging_tables WHERE id=$1',[id]);
    return {status:200,body:{message:'Deleted'}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}

// --- Scripts (shared graph assets, Phase 4) ---
async function apiGetScripts() { const {rows}=await query('SELECT * FROM scripts ORDER BY name'); return {status:200,body:rows}; }
async function apiCreateScript(body) {
  const id=body.id||`script_${Date.now()}`;
  try {
    await query('INSERT INTO scripts (id,name,description,graph,updated_at) VALUES ($1,$2,$3,$4,EXTRACT(EPOCH FROM NOW()))',
      [id,body.name||'Untitled Script',body.description||'',JSON.stringify(body.graph||{})]);
    return {status:201,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiUpdateScript(id,body) {
  try {
    await query('UPDATE scripts SET name=$1,description=$2,graph=$3,updated_at=EXTRACT(EPOCH FROM NOW()) WHERE id=$4',
      [body.name||'Untitled Script',body.description||'',JSON.stringify(body.graph||{}),id]);
    return {status:200,body:{id}};
  } catch(e) { return {status:400,body:{error:e.message}}; }
}
async function apiDeleteScript(id) {
  try {
    await query('DELETE FROM scripts WHERE id=$1',[id]);
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
export async function apiCreateWindow(body) {
  const { name='window', description='A window.', zone_interior, zone_exterior=null, curtain_open=1, glass_state='intact', light_transmission=0.8, visibility_transmission=0.8 } = body||{};
  if (!zone_interior) return { status:400, body:{error:'zone_interior required'} };
  // Auto-generate sequential id (window1, window2, …) if not provided.
  let id = body.id;
  if (!id) {
    const { rows: existing } = await query(`SELECT id FROM windows WHERE id ~ '^window[0-9]+$'`);
    const nums = existing.map(r => parseInt(r.id.replace('window',''),10)).filter(n => !isNaN(n));
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    id = `window${next}`;
  }
  // Auto-generate handle from name if not provided.
  const handle = body.handle || name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g,'');
  await query('INSERT INTO windows (id,name,handle,description,zone_interior,zone_exterior,curtain_open,glass_state,light_transmission,visibility_transmission) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id,name,handle,description,zone_interior,zone_exterior,curtain_open,glass_state,light_transmission,visibility_transmission]);
  await reloadWindowsEnv().catch(()=>{});
  return { status:201, body:{id} };
}
export async function apiUpdateWindow(id, body) {
  const { name, description, handle, zone_interior, zone_exterior, curtain_open, glass_state, light_transmission, visibility_transmission } = body||{};
  await query(`UPDATE windows SET
    name=COALESCE($1,name), handle=COALESCE($2,handle), description=COALESCE($3,description),
    zone_interior=COALESCE($4,zone_interior), zone_exterior=$5,
    curtain_open=COALESCE($6,curtain_open), glass_state=COALESCE($7,glass_state),
    light_transmission=COALESCE($8,light_transmission), visibility_transmission=COALESCE($9,visibility_transmission)
    WHERE id=$10`,
    [name,handle,description,zone_interior,zone_exterior??null,curtain_open,glass_state,light_transmission,visibility_transmission,id]);
  await reloadWindowsEnv().catch(()=>{});
  return { status:200, body:{updated:true} };
}
export async function apiDeleteWindow(id) {
  await query('DELETE FROM windows WHERE id=$1',[id]);
  await reloadWindowsEnv().catch(()=>{});
  return { status:200, body:{deleted:true} };
}

// --- Doors ---
const DOOR_DEFAULTS = {
  basic: { hp: 1000, hp_max: 1000 },
  shoddy: { hp: 300, hp_max: 300 },
  blast: { hp: 5000, hp_max: 5000 },
};

async function apiGetDoors() {
  const { rows } = await query('SELECT * FROM doors');
  return { status:200, body:rows };
}

async function apiGetZoneDoors(zoneId) {
  const id = decodeURIComponent(zoneId);
  // Include doors directly in this zone, AND doors installed in a neighbor zone whose exit leads here
  // A door leads here if it's in this zone, pinned to this zone (target_zone), or
  // its exit_dir on the source zone points here — as a bare string value OR as one
  // element of an array-valued (multi-exit) direction.
  const { rows } = await query(
    `SELECT d.* FROM doors d
     LEFT JOIN zones z ON z.id = d.zone_id
     WHERE d.zone_id = $1
        OR d.target_zone = $1
        OR z.exits->>d.exit_dir = $1
        OR z.exits->d.exit_dir @> to_jsonb($1::text)`,
    [id]
  );
  return { status:200, body:rows };
}

async function apiCreateKeycard(doorId, body) {
  const id = `keycard_${doorId}`;
  const zoneName = body.zone_name || 'Unknown Room';
  // Idempotent: if this keycard already exists, return it without recreating
  const { rows: existing } = await query('SELECT id FROM items WHERE id=$1', [id]);
  if (existing.length) return { status:200, body:{ id } };
  const name = `Keycard — ${zoneName}`;
  const description = `A slim obsidian card, its surface threaded with bioluminescent circuitry that pulses faintly when held. The access signature encoded in its memory is keyed exclusively to the reader on ${zoneName}'s door — swipe it anywhere else and it's just a pretty piece of plastic.`;
  try {
    await query(
      `INSERT INTO items (id, name, description, type, subtype, weight, value, is_stackable, is_unique, flags)
       VALUES ($1,$2,$3,'key','keycard',0.05,0,0,1,$4)`,
      [id, name, description, JSON.stringify({ keycard_for_door: doorId, unique: true })]
    );
    return { status:201, body:{ id } };
  } catch(e) { return { status:400, body:{ error:e.message } }; }
}

async function apiCreateDoor(body) {
  const { rows: maxRows } = await query(`SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 6) AS INTEGER)), 0) AS max FROM doors WHERE id ~ '^door_[0-9]+$'`);
  const id = `door_${maxRows[0].max + 1}`;
  const type = body.door_type || 'basic';
  const defaults = DOOR_DEFAULTS[type] || DOOR_DEFAULTS.basic;
  const tags = body.tags ?? [];
  const lock_state = body.lock_state ?? null;
  try {
    await query(
      `INSERT INTO doors (id,name,zone_id,exit_dir,target_zone,door_type,is_open,hp,hp_max,flags,tags,lock_state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, body.name||null, body.zone_id, body.exit_dir, body.target_zone||null, type, 0, defaults.hp, defaults.hp_max, JSON.stringify(body.flags||{}), JSON.stringify(tags), lock_state]
    );
    const door = { id, name: body.name||null, zone_id: body.zone_id, exit_dir: body.exit_dir, target_zone: body.target_zone||null, door_type: type, is_open: 0, hp: defaults.hp, hp_max: defaults.hp_max, flags: body.flags||{}, tags, lock_state };
    setDoorCache(id, door);
    return { status:201, body:{id} };
  } catch(e) { return { status:400, body:{error:e.message} }; }
}

async function apiUpdateDoor(id, body) {
  try {
    const tags = body.tags ?? [];
    const lock_state = body.lock_state ?? null;

    // Privacy lock: if the builder left the side on Auto, resolve it to the
    // bathroom side. When neither (or both) sides have a toilet we can't guess —
    // make them pick a side explicitly via the lock-side switch.
    const priv = (tags && !Array.isArray(tags)) ? tags['lock:privacylock'] : null;
    if (priv && !priv.privacySide) {
      const side = await detectBathroomSide({ zone_id: body.zone_id, target_zone: body.target_zone || null, exit_dir: body.exit_dir });
      if (!side) return { status: 400, body: { error: 'No toilet on either side — choose which side the privacy lock is unlockable from (lock-side switch).' } };
      priv.privacySide = side;
    }

    await query(
      `UPDATE doors SET name=$1,zone_id=$2,exit_dir=$3,target_zone=$4,door_type=$5,is_open=$6,hp=$7,hp_max=$8,flags=$9,tags=$10,lock_state=$11 WHERE id=$12`,
      [body.name||null, body.zone_id, body.exit_dir, body.target_zone||null, body.door_type, body.is_open?1:0, body.hp, body.hp_max, JSON.stringify(body.flags||{}), JSON.stringify(tags), lock_state, id]
    );
    const door = { id, ...body, name: body.name||null, flags: body.flags||{}, tags, lock_state };
    setDoorCache(id, door);
    return { status:200, body:{id} };
  } catch(e) { return { status:400, body:{error:e.message} }; }
}

async function apiDeleteDoor(id) {
  try {
    await query('DELETE FROM doors WHERE id=$1', [id]);
    deleteDoorCache(id);
    return { status:200, body:{deleted:true} };
  } catch(e) { return { status:400, body:{error:e.message} }; }
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
  const { name, category='misc', descriptions=[], loudness=3.0, enabled=1, propagation='both' } = body||{};
  if (!name?.trim()) return { status:400, body:{error:'name required'} };
  await query('INSERT INTO sounds (id,name,category,descriptions,loudness,enabled,propagation) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, name.trim(), category, JSON.stringify(descriptions), loudness, enabled?1:0, propagation]);
  return { status:201, body:{id} };
}
async function apiUpdateSound(id, body) {
  const { name, category, descriptions, loudness, enabled, propagation } = body||{};
  const sets = [], vals = [];
  let i = 1;
  if (name!=null)         { sets.push(`name=$${i++}`);         vals.push(name.trim()); }
  if (category!=null)     { sets.push(`category=$${i++}`);     vals.push(category); }
  if (descriptions!=null) { sets.push(`descriptions=$${i++}`); vals.push(JSON.stringify(descriptions)); }
  if (loudness!=null)     { sets.push(`loudness=$${i++}`);     vals.push(loudness); }
  if (enabled!=null)      { sets.push(`enabled=$${i++}`);      vals.push(enabled?1:0); }
  if (propagation!=null)  { sets.push(`propagation=$${i++}`);  vals.push(propagation); }
  if (!sets.length) return { status:400, body:{error:'nothing to update'} };
  vals.push(id);
  await query(`UPDATE sounds SET ${sets.join(',')} WHERE id=$${i}`, vals);
  return { status:200, body:{updated:true} };
}
async function apiDeleteSound(id) {
  await query('DELETE FROM sounds WHERE id=$1',[id]);
  return { status:200, body:{deleted:true} };
}

async function apiGetTagCatalog() {
  const src = readFileSync(CATALOG_PATH, 'utf8');
  const ctx = { globalThis: {} };
  vm.runInNewContext(src, ctx);
  return { status:200, body: ctx.globalThis.TAG_CATALOG ?? {} };
}

async function apiPutTagCatalog(body) {
  if (!body || typeof body !== 'object') return { status:400, body:{ error:'Expected catalog object' } };
  const src = `(function(global){\n  var TAG_CATALOG = ${JSON.stringify(body, null, 2)};\n  global.TAG_CATALOG = TAG_CATALOG;\n})(typeof window !== 'undefined' ? window : globalThis);\n`;
  writeFileSync(CATALOG_PATH, src, 'utf8');
  globalThis.TAG_CATALOG = body;
  return { status:200, body:{ ok:true } };
}

async function apiGetSupertags() {
  const src = readFileSync(SUPERTAGS_PATH, 'utf8');
  const ctx = { globalThis: {} };
  vm.runInNewContext(src, ctx);
  return { status:200, body: ctx.globalThis.TAG_SUPERTAGS ?? {} };
}

async function apiPutSupertags(body) {
  if (!body || typeof body !== 'object') return { status:400, body:{ error:'Expected supertags object' } };
  const src = `(function(global){\n  var TAG_SUPERTAGS = ${JSON.stringify(body, null, 2)};\n  global.TAG_SUPERTAGS = TAG_SUPERTAGS;\n})(typeof window !== 'undefined' ? window : globalThis);\n`;
  writeFileSync(SUPERTAGS_PATH, src, 'utf8');
  globalThis.TAG_SUPERTAGS = body;
  // Live reference: re-materialize every item that references any supertag so a
  // supertag edit propagates to all its items. Re-deriving each item from its own
  // authored tags (__own) + current supertag members also drops members removed
  // from the supertag and picks up newly added ones.
  const { rows } = await query(`SELECT id, tags FROM items WHERE jsonb_exists(tags, '__super')`);
  for (const r of rows) {
    const tags = r.tags && typeof r.tags === 'object' ? r.tags : {};
    const next = materializeItemTags(ownTags(tags), superKeys(tags), body);
    await query('UPDATE items SET tags=$1 WHERE id=$2', [JSON.stringify(next), r.id]);
  }
  return { status:200, body:{ ok:true, rematerialized: rows.length } };
}

async function apiSpawnItem(body) {
  const { item_id, zone_id, quantity = 1 } = body || {};
  if (!item_id || !zone_id) return { status:400, body:{ error:'item_id and zone_id required' } };
  const { rows } = await query('SELECT id FROM items WHERE id=$1', [item_id]);
  if (!rows.length) return { status:404, body:{ error:`No item "${item_id}"` } };
  const invId = `inv_spawn_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  await query('INSERT INTO player_inventory (id,player_id,item_id,quantity) VALUES ($1,$2,$3,$4)',
    [invId, `_ground_${zone_id}`, item_id, quantity]);
  return { status:201, body:{ ok:true } };
}

async function apiGetMotd() {
  const data = await getMotd();
  return { status:200, body: data };
}

async function apiSetMotd(body) {
  const { big, medium, small, dynamic: dyn } = body || {};
  if ([big, medium, small, dyn].every(v => v === undefined)) return { status:400, body:{ error:'No valid fields' } };
  await saveMotd({ big, medium, small, dynamic: dyn });
  return { status:200, body:{ ok:true } };
}

async function apiPushMotd(body) {
  const { dynamic: dyn } = body || {};
  if (typeof dyn === 'string') await saveMotd({ dynamic: dyn });
  const data = await getMotd();
  if (broadcastFn) broadcastFn(null, { type:'motd', ...data });
  return { status:200, body:{ ok:true } };
}
