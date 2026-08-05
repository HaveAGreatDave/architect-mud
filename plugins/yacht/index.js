// plugins/yacht/index.js
//
// The Echelon — the admin superyacht in Coldwater Basin. This plugin owns the
// vessel's access control; the rooms, furniture, and NPCs themselves are plain
// world content (JSON under content/, flagged flags.yacht).
//
// Access model:
//   • The owner (Cyd) is always approved. EVERYONE else — admins included — must be
//     on the invite list (the yacht_invites table) to board or even see the boat.
//     Being staff grants no access; an uninvited admin is treated like anyone else.
//     Cyd starts as the only approved occupant.
//   • The Admin Console aboard adds/removes/lists invitees (invite/uninvite/invites
//     verbs, admin-gated — an admin operates the console, but must add themselves to
//     the list before they can board).
//   • Three layers keep the riff-raff off, in order of how a body gets aboard:
//       1. yachtlock — the lock type on interior doors (e.g. Cyd's suite).
//       2. yacht:board move gate — you can't WALK into a yacht zone uninvited
//          (the "non-NPC bouncer": the vessel refuses the gangway).
//       3. zone.entered smite — anyone force-teleported / glitched aboard while
//          uninvited is erased on arrival. This is the backstop the move gate
//          can't cover (TELEPORT bypasses move gates by design).
//
// Owner: Cyd (an admin). Movement, docking, and the emergency broadcast live in
// later slices; this slice is "boardable and secure."

import { query } from '../../server/models/db.js';
import { schedule } from '../../server/engine/scheduler.js';
import { getZone, getLivePlayer, world, addExitOverride, removeExitOverride, registerMinimapNodeFilter, getMinimapData, zoneTerrain } from '../../server/engine/world.js';
import { sendToPlayer, getBroadcast } from '../../server/engine/messaging.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { on } from '../../server/engine/events.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { registerLockType } from '../../server/engine/locks.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { handlePlayerDeath } from '../../server/engine/gameLoop.js';

// ── Invite list ────────────────────────────────────────────────────────────────
// One row per approved non-admin player. Admins bypass the list entirely.

// The owner. The Echelon answers to exactly one person — Cyd — who is always aboard-
// worthy and always sees the vessel, listed or not. EVERYONE else (admins included)
// must be explicitly invited: an admin isn't Cyd, so an uninvited admin can neither
// see the boat on the minimap nor board it until Cyd (or another admin, via the
// console) adds them. Cyd starts as the only approved occupant.
const OWNER_HANDLE = 'Cyd';
const isOwner = (player) => player?.handle === OWNER_HANDLE;

// In-memory mirror of the invite list, for the SYNC minimap filter (getMinimapData
// can't await a DB hit per tile). The DB stays the source of truth for the security
// gates; a briefly-stale cache only means an invitee's boat icon lags a moment.
const invitedIds = new Set();
query('SELECT player_id FROM yacht_invites', [])
  .then(({ rows }) => rows.forEach(r => invitedIds.add(r.player_id)))
  .catch(e => console.error('[yacht] invite cache load:', e.message));

// ── Position persistence (runtime, not content) ──────────────────────────────────
// Her tile + heading are runtime state, kept in world_flags (NOT the zones content
// row git owns). The live zone in world.zones is the read surface everyone uses; this
// only survives a restart. Written on arrival, restored once at boot below.
const YACHT_POS_FLAG = 'yacht_echelon_pos';

async function persistYachtPos(x, y, heading) {
  await setFlag('world', YACHT_POS_FLAG, JSON.stringify({ x, y, heading })).catch(
    e => console.error('[yacht] position persist:', e.message)
  );
}

// Restore her last tile onto the live zone at boot (after initWorld, before any
// flight coord-index query). Nothing rebuilds that index during the boot window.
getFlag('world', YACHT_POS_FLAG)
  .then(async raw => {
    if (!raw) return;
    const pos = JSON.parse(raw);
    const ext = getZone(EXTERIOR);
    if (!ext || pos.x == null || pos.y == null) return;
    ext.grid_x = pos.x;
    ext.grid_y = pos.y;
    ext.flags = { ...(ext.flags || {}), heading: pos.heading ?? ext.flags?.heading ?? 0 };
    // Her gangway persists in zone_exit_overrides across a reboot without re-running dockTo,
    // so re-derive her live door from the pier she's alongside (buildingEntranceDir reads it).
    const pier = adjacentPier(pos.x, pos.y);
    if (pier) ext.flags.entrance = pier.dir; else delete ext.flags.entrance;
    // Her tile and a parked craft's tile persist through SEPARATE paths (this world-flag vs the
    // aircraft row), so on a cold boot they can come back apart — she restores here, but a heli left
    // on her deck reloads at whatever tile it was last written. Re-marry them: rebuild the flight
    // coord index (so landings still find her here) and snap every aircraft parked on her exterior
    // to her restored tile, so a takeoff off her deck always lifts from where she actually is.
    try { const m = await import('../flight/state.js'); m.buildCoordIndex?.(); await m.moveParkedAircraftTo?.(EXTERIOR, pos.x, pos.y); } catch {}
  })
  .catch(e => console.error('[yacht] position restore:', e.message));

async function isInvitedById(playerId) {
  if (!playerId) return false;
  const { rows } = await query('SELECT 1 FROM yacht_invites WHERE player_id=$1 LIMIT 1', [playerId]);
  return rows.length > 0;
}

// The load-bearing check every gate funnels through: the owner, or a player on the
// invite list. NOT admins by default — being staff doesn't grant access to the boat.
export async function isInvited(player) {
  if (!player?.id) return false;
  if (isOwner(player)) return true;
  return isInvitedById(player.id);
}

// Sync counterpart, cache-backed — used only by the minimap filter (display, not security).
function isInvitedSync(player) {
  if (!player?.id) return false;
  return isOwner(player) || invitedIds.has(player.id);
}

async function addInvite(playerId, byHandle) {
  await query(
    `INSERT INTO yacht_invites (player_id, added_by) VALUES ($1, $2)
     ON CONFLICT (player_id) DO NOTHING`,
    [playerId, byHandle || null]
  );
  invitedIds.add(playerId);
}

async function removeInvite(playerId) {
  await query('DELETE FROM yacht_invites WHERE player_id=$1', [playerId]);
  invitedIds.delete(playerId);
}

// Hide the Echelon from anyone not on the list: any map surface drops a yacht tile
// for a viewer who isn't invited/admin, leaving the open water tile beneath it.
registerMinimapNodeFilter((zone, viewer) => !zone?.flags?.yacht || isInvitedSync(viewer));

// Resolve a typed handle to { id, handle } — online first (exact/prefix), then the
// DB (offline players can be invited by name).
async function resolveHandle(nameStr) {
  const needle = nameStr.trim().toLowerCase();
  if (!needle) return null;
  for (const p of world.players.values()) {
    if (p.handle?.toLowerCase() === needle) return { id: p.id, handle: p.handle };
  }
  const { rows } = await query(
    'SELECT id, handle FROM players WHERE lower(handle)=lower($1) LIMIT 1',
    [nameStr.trim()]
  );
  return rows.length ? { id: rows[0].id, handle: rows[0].handle } : null;
}

// ── Access gate: the yachtlock lock type ────────────────────────────────────────
// A door tagged { 'lock:yachtlock': {} } opens for any invited player (or admin).
// Tag it { ownerOnly: true } to tighten a threshold to the owner (admins) alone —
// that's how Cyd's private suite stays private from ordinary guests who are
// otherwise cleared to be aboard. Not hackable; the list (or ownership) is the key.
registerLockType('yachtlock', {
  tagType: 'lock:yachtlock',
  kitTag:  'lockkit:yachtlock',
  defaults: {
    messages: {
      lock:   'The Echelon seals the hatch with a whisper of hydraulics.',
      unlock: 'The hatch releases, recognising you.',
      denied: 'The hatch does not acknowledge you. You are not welcome here.',
    },
  },
  authFn: async (lockTag, door, player) => {
    if (lockTag.ownerOnly) return isOwner(player);  // Cyd's private quarters — the owner alone
    return isInvited(player);
  },
});

// ── Access gate: the boarding move gate (the "non-NPC bouncer") ─────────────────
// You cannot WALK into a yacht zone (flags.yacht) unless you're invited/admin.
// Only fires on the crossing FROM a non-yacht tile — moving between yacht rooms
// once you're legitimately aboard never re-queries. Teleports skip move gates, so
// the smite backstop below covers that path.
//
// Her weather deck (the `vessel` tile) is the one place an uninvited body can end up,
// and only by ONE route: swimming out and climbing the hull (the swimming plugin's
// VESSEL_EMBARK, which teleports and so never reaches a move gate). The gangway still
// refuses them on the way up from the pier, and the hatch off the deck into her rooms
// is a real boarding — so the deck counts as OUTSIDE when leaving it inward.
const isOpenDeck = (z) => !!z?.flags?.vessel;
registerMoveGate(async ({ player, from, to }) => {
  if (!to?.flags?.yacht) return;                        // not boarding the yacht
  if (from?.flags?.yacht && !isOpenDeck(from)) return;  // already aboard — internal move
  if (await isInvited(player)) return;
  return { block: true, message: 'An unseen checkpoint holds you at the gangway. The Echelon does not know you.' };
}, 'yacht:board');

// ── Smite backstop ──────────────────────────────────────────────────────────────
// Any player who ends up in a yacht zone while uninvited — forced, teleported, or
// glitched past the move gate — is erased on arrival. NPCs and admins are exempt.
const SMITE_LABEL = 'Erased by The Echelon';
on('zone.entered', async ({ actor, zone }) => {
  if (!actor?.id) return;
  if (!getLivePlayer(actor.id)) return;          // only real, online players — never NPCs
  const z = getZone(zone);
  if (!z?.flags?.yacht) return;
  // The weather deck is reachable from the water by anyone (see the move gate above),
  // so the backstop must not erase a swimmer for standing on it — it guards her ROOMS.
  if (isOpenDeck(z)) return;
  if (await isInvited(actor)) return;
  const bc = getBroadcast();
  bc?.(zone, { type: 'zone_event', message: `${actor.handle} sets foot aboard the Echelon — and is gone in a flash of white light.` }, actor.id);
  sendToPlayer(actor.id, { type: 'output', message: 'The deck recognises an intruder. There is a flash of white, and then nothing at all.' });
  await handlePlayerDeath(actor, null, { type: 'admin', label: SMITE_LABEL }).catch(e => console.error('[yacht] smite:', e.message));
});

// ── Admin Console: invite management ────────────────────────────────────────────
const ADMIN_ONLY = { type: 'error', message: "You don't have the clearance for that." };
// Guest-list management is the OWNER's prerogative (it's his boat) — or an admin's. Being aboard
// isn't enough; an ordinary invited guest can't add or drop other guests.
const canManageInvites = (player) => isOwner(player) || player.role === 'admin';

async function cmdInvite(args, raw, player) {
  if (!canManageInvites(player)) return ADMIN_ONLY;
  const nameStr = (args || []).join(' ').trim();
  if (!nameStr) return { type: 'error', message: 'Usage: invite <player> — adds them to the Echelon invite list.' };
  const target = await resolveHandle(nameStr);
  if (!target) return { type: 'error', message: `No player named "${nameStr}" found.` };
  if (await isInvitedById(target.id)) return { type: 'system', message: `${target.handle} is already on the Echelon invite list.` };
  await addInvite(target.id, player.handle);
  return { type: 'system', message: `${target.handle} added to the Echelon invite list. They may now board.` };
}

async function cmdUninvite(args, raw, player) {
  if (!canManageInvites(player)) return ADMIN_ONLY;
  const nameStr = (args || []).join(' ').trim();
  if (!nameStr) return { type: 'error', message: 'Usage: uninvite <player> — removes them from the Echelon invite list.' };
  const target = await resolveHandle(nameStr);
  if (!target) return { type: 'error', message: `No player named "${nameStr}" found.` };
  if (!(await isInvitedById(target.id))) return { type: 'system', message: `${target.handle} is not on the Echelon invite list.` };
  await removeInvite(target.id);
  return { type: 'system', message: `${target.handle} removed from the Echelon invite list.` };
}

async function cmdInvites(args, raw, player) {
  if (!canManageInvites(player)) return ADMIN_ONLY;
  const { rows } = await query(
    `SELECT y.player_id, p.handle, y.added_by, y.added_at
       FROM yacht_invites y LEFT JOIN players p ON p.id = y.player_id
      ORDER BY y.added_at ASC`,
    []
  );
  if (!rows.length) {
    return { type: 'system', message: 'The Echelon invite list is empty. (Admins always have access.)' };
  }
  const lines = rows.map(r => `  ${(r.handle || r.player_id).padEnd(24)} added by ${r.added_by || '—'}`).join('\n');
  return { type: 'system', message: `<span class="help-header">ECHELON INVITE LIST (${rows.length})</span>\n${lines}\n\n(Admins always have access, listed or not.)` };
}

// ── Helm: moving the vessel ─────────────────────────────────────────────────────
// The Echelon occupies one tile on map_world (the exterior zone). An admin at the
// bridge moves it one water tile at a time; each move starts a 5-minute cooldown.
// Only grid_x/grid_y of the exterior tile change — the interior map is coordinate-
// independent, so nothing inside moves. When the vessel comes to rest beside a
// pier, a gangway exit is wired both ways (guarded by yacht:board) so invitees can
// walk aboard; that exit is torn down the moment she gets underway again.

const EXTERIOR = 'zone_echelon_exterior';
// She is a big vessel: getting underway, she takes ninety seconds to complete a passage, and comes
// to rest only when she arrives. No new order can be given until she's there. A direct `sail <dir>`
// order covers SAIL_TILES water tile(s) (stopping short at the first obstacle) — a manual one-tile
// nudge; a charted `sailto` course steams the whole plotted path instead.
const SAIL_TILES = 1;   // one water tile per direct `sail <dir>` order — manual fine control (she stops
                        // short if that tile isn't open water — never enters land). A charted `sailto`
                        // course still steams the whole multi-leg path; only the wheel-driven nudge is 1-tile.
// Single speed now: ~2× the original hull, and the slow bell matches the fast bell (they were asked to be
// equal), so every order is the same ~2.5-second one-tile hop regardless of how far the lever is pushed.
// `cruise` (the streamed visual way — wake/water intensity + shown knots) still tracks the lever so a
// harder bell reads as a bigger wake, but the passage TIME no longer changes.
const SAIL_MS_PER_TILE_SLOW = 2_500;    // 2.5 s per water tile
const SAIL_MS_PER_TILE_FULL = 2_500;    // identical — slow == fast
// A charted course (the map-popup "sail to this tile" mode) cruises at ~half the direct-sail pace —
// a stately voyage across the Basin rather than a brisk hop, per the helm redesign.
const SAIL_MS_PER_TILE_COURSE = 5_000;  // 5 s per water tile along a pathfound course
const DEFAULT_BELL = 0.5;               // a typed `sail <dir>` with no bell = Half Ahead
// throttle t∈[0,1] → { ms per tile, visual cruise 0..1 }
const bellFor = (t) => ({ msPerTile: Math.round(SAIL_MS_PER_TILE_SLOW + (SAIL_MS_PER_TILE_FULL - SAIL_MS_PER_TILE_SLOW) * t), cruise: +(0.35 + 0.65 * t).toFixed(3) });
const DOCK_SOURCE = 'yacht_dock';
// She now answers to all eight rhumbs — the four cardinals plus the diagonals, so she can cut
// straight across open water on a NE/SE/SW/NW heading, not just step the compass points.
const DIR_DELTA = {
  north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
  northeast: [1, -1], northwest: [-1, -1], southeast: [1, 1], southwest: [-1, 1],
};
const DIR_ALIAS = {
  n: 'north', s: 'south', e: 'east', w: 'west', ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
  north: 'north', south: 'south', east: 'east', west: 'west',
  northeast: 'northeast', northwest: 'northwest', southeast: 'southeast', southwest: 'southwest',
};
const DIR_SHORT = { north: 'N', south: 'S', east: 'E', west: 'W', northeast: 'NE', northwest: 'NW', southeast: 'SE', southwest: 'SW' };
const DIR_DEG = { north: 0, northeast: 45, east: 90, southeast: 135, south: 180, southwest: 225, west: 270, northwest: 315 };
const REVERSE = { north: 'south', south: 'north', east: 'west', west: 'east', northeast: 'southwest', southwest: 'northeast', northwest: 'southeast', southeast: 'northwest' };
// The gangway only ever lowers to an ORTHOGONALLY adjacent pier (you can't walk a diagonal between
// zones), so pier-finding stays four-way even though she can sail the diagonals.
const ORTHO_DELTA = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

// While underway: { toX, toY, dir, startAt, arriveAt, timer }; null when moored/idle. Module-level:
// there is exactly one Echelon (a server restart cancels an in-flight passage, leaving her at the
// tile she departed from — position only commits on arrival, so nothing is left half-moved).
let transit = null;
const transitLeft = () => (transit ? Math.max(0, transit.arriveAt - Date.now()) : 0);

// Players with the visual helm console open — we push them the live sky (real weather field) on a
// timer, exactly like the flight sim streams its sky. Pruned as they leave the bridge / go offline.
const helmViewers = new Set();
// The flight plugin owns the authoritative sky/weather field + the shared "making way" wake. Soft-
// imported (yacht → flight is the correct direction) and cached so the sky push isn't a dynamic
// import every tick.
let flightStateMod = null;
import('../flight/state.js').then(m => { flightStateMod = m; }).catch(() => {});

// The map_world tile at a coordinate, ignoring the yacht's own overlay.
function worldTileAt(x, y) {
  for (const z of world.zones.values()) {
    if (z.map_id !== 'map_world' || z.id === EXTERIOR) continue;
    if (z.grid_x === x && z.grid_y === y && (z.grid_z ?? 0) === 0) return z;
  }
  return null;
}

// Fast water lookup for course charting. Water tiles are static content (git owns them; they never
// change at runtime), so we build the coordinate set once and cache it — A* below hits it thousands
// of times per course and must not loop every zone per probe. Built lazily on the first charting.
// Navigable water is `flags.terrain` — the ground-surface SSOT (docs/systems-terrain.md).
// The legacy `flags.water` boolean this used to test was DELETED 2026-07-30 and now sits on
// no tile in the game, so every test here read `undefined`: `waterSet()` built EMPTY (so
// `sailto` could never chart a course) and `sail <dir>` broke out on its first step (so a
// manual order never found a tile to move to). Both helm controls were dead, silently and
// together, because they share this one predicate. Same test the swimming plugin, the
// pathfinder and combat's `isWaterZone` migrated to.
// Exported ONLY so regress can cross-check it against the world's own terrain rather than
// re-stating the predicate (a test that repeats the implementation would have gone green on
// the dead flag too — which is exactly how this survived).
export const isWater = (z) => !!z && zoneTerrain(z) === 'water';

let _waterSet = null;
function waterSet() {
  if (_waterSet) return _waterSet;
  const s = new Set();
  for (const z of world.zones.values()) {
    if (z.map_id !== 'map_world' || z.id === EXTERIOR) continue;
    if ((z.grid_z ?? 0) !== 0) continue;
    if (isWater(z)) s.add(z.grid_x + ',' + z.grid_y);
  }
  _waterSet = s;
  return s;
}
const isWaterTile = (x, y) => waterSet().has(x + ',' + y);

// The eight sailing steps and the tile delta → direction word, for a charted course.
const NEIGHBORS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
function deltaToDirWord(dx, dy) {
  const sx = Math.sign(dx), sy = Math.sign(dy);
  for (const [word, [ddx, ddy]] of Object.entries(DIR_DELTA)) if (ddx === sx && ddy === sy) return word;
  return 'north';
}

// A* a water-only course from (sx,sy) to (tx,ty), bending around piers/shoreline. Eight-connected,
// octile heuristic; diagonals may not cut a land corner (both flanking orthogonals must be water).
// Returns the tile polyline [[x,y],…] (path[0] = start), or null if the target isn't reachable over
// open water. Node-capped so a boxed-in target fails fast instead of scanning the whole basin.
function chartCourse(sx, sy, tx, ty, maxNodes = 8000) {
  if (!isWaterTile(tx, ty)) return null;
  if (sx === tx && sy === ty) return null;
  const key = (x, y) => x + ',' + y;
  const heur = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy); };
  const start = { x: sx, y: sy, g: 0, parent: null }; start.f = heur(sx, sy);
  const open = new Map([[key(sx, sy), start]]);
  const closed = new Set();
  let count = 0;
  while (open.size) {
    let cur = null; for (const n of open.values()) if (!cur || n.f < cur.f) cur = n;
    open.delete(key(cur.x, cur.y));
    if (cur.x === tx && cur.y === ty) { const path = []; for (let n = cur; n; n = n.parent) path.push([n.x, n.y]); return path.reverse(); }
    closed.add(key(cur.x, cur.y));
    if (++count > maxNodes) return null;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (closed.has(key(nx, ny)) || !isWaterTile(nx, ny)) continue;
      if (dx && dy && (!isWaterTile(cur.x + dx, cur.y) || !isWaterTile(cur.x, cur.y + dy))) continue;   // no corner-cutting past land
      const g = cur.g + (dx && dy ? Math.SQRT2 : 1);
      const ex = open.get(key(nx, ny));
      if (ex && ex.g <= g) continue;
      const node = { x: nx, y: ny, g, parent: cur }; node.f = g + heur(nx, ny);
      open.set(key(nx, ny), node);
    }
  }
  return null;
}

// A pier tile (flags.pier) orthogonally adjacent to (x,y), or null.
function adjacentPier(x, y) {
  for (const [dir, [dx, dy]] of Object.entries(ORTHO_DELTA)) {
    const t = worldTileAt(x + dx, y + dy);
    if (t?.flags?.pier) return { pier: t, dir };
  }
  return null;
}

async function isDocked() {
  const { rows } = await query('SELECT 1 FROM zone_exit_overrides WHERE source=$1 LIMIT 1', [DOCK_SOURCE]);
  return rows.length > 0;
}

// Tear down every gangway exit, wherever it points. Robust across restarts — reads
// the persisted overrides rather than trusting in-memory state.
async function undockAll() {
  const { rows } = await query('SELECT zone_id, direction, target_zone FROM zone_exit_overrides WHERE source=$1', [DOCK_SOURCE]);
  for (const r of rows) await removeExitOverride(r.zone_id, r.direction, r.target_zone);
  // No gangway ⇒ no entrance. The Echelon is the one facade whose door is dynamic:
  // buildingEntranceDir reads flags.entrance, so clear it while she's underway.
  const ext = getZone(EXTERIOR);
  if (ext?.flags?.entrance != null) { ext.flags = { ...ext.flags }; delete ext.flags.entrance; }
}

// Wire the gangway both ways between the exterior tile and an adjacent pier.
async function dockTo(pierZoneId, dirYachtToPier) {
  await addExitOverride(EXTERIOR, dirYachtToPier, pierZoneId, DOCK_SOURCE);
  await addExitOverride(pierZoneId, REVERSE[dirYachtToPier], EXTERIOR, DOCK_SOURCE);
  // Her door faces the pier the gangway drops onto — authored live (see buildingEntranceDir).
  const ext = getZone(EXTERIOR);
  if (ext) ext.flags = { ...(ext.flags || {}), entrance: dirYachtToPier };
}

function rebuildFlightIndex() {
  // The flight plugin caches a coord→surface index; a moved yacht must not linger at its old tile
  // in that index. This MUST run synchronously before we build the helm window on arrival — the
  // cached module (flightStateMod) lets us do that. A stale index left the yacht flagged at BOTH
  // her old tile and her new one, so the chase view painted a second Echelon a tile astern. The
  // async dynamic-import fallback only matters before flightStateMod has finished loading at boot.
  if (flightStateMod?.buildCoordIndex) { flightStateMod.buildCoordIndex(); return; }
  import('../flight/state.js').then(m => m.buildCoordIndex?.()).catch(() => {});
}

function helmStatus(ext, dockedPierName) {
  const left = transitLeft();
  const ready = left > 0 ? `Underway — she reaches her next position in ${Math.ceil(left / 1000)}s.` : 'The engines are ready.';
  const dock = left > 0 ? 'Making way across the Basin.' : (dockedPierName ? `Docked alongside ${dockedPierName}.` : 'Underway, no pier alongside.');
  return `<span class="help-header">ECHELON — HELM</span>\nPosition: ${ext.grid_x}, ${ext.grid_y} (Coldwater Basin)\n${dock}\n${ready}\nUsage: sail <n|ne|e|se|s|sw|w|nw>`;
}

// Arrival: the passage completes ten minutes after casting off. Only now does her authoritative
// tile change; she re-indexes for flight, lowers a gangway if a pier is alongside, and releases
// the helm. Any open helm console is told she's arrived so it unlocks precisely.
async function arriveEchelon() {
  if (!transit) return;
  const { toX, toY, dir } = transit;
  transit = null;
  flightStateMod?.clearYachtTransit?.();   // passage done — pilots see her settled at the new tile
  // Move her authoritative tile + heading in RAM (everything reads the live zone), then persist to
  // the runtime world-flag store — NOT the zones content row, which git owns and a deploy would
  // clobber. flags.heading survives a restart, so she reopens pointing the last way she was sent —
  // never snapping back to bow-north.
  const ext = getZone(EXTERIOR);
  const flags = { ...(ext?.flags || {}), heading: DIR_DEG[dir] };
  delete flags.entrance;   // underway with no gangway yet; dockTo below re-sets it if a pier is alongside
  if (ext) { ext.grid_x = toX; ext.grid_y = toY; ext.flags = flags; }
  await persistYachtPos(toX, toY, DIR_DEG[dir]);
  rebuildFlightIndex();
  // A helicopter parked on her deck sails with her — move any craft parked on the exterior tile
  // to her new position, so its next takeoff lifts off from where she is now, not the water she
  // left. (flight owns the aircraft table, so it does the write; we just hand it her new tile.)
  await flightStateMod?.moveParkedAircraftTo?.(EXTERIOR, toX, toY);
  flightStateMod?.setYachtMakingWay?.();   // a last wake at the new tile for nearby pilots
  const pier = adjacentPier(toX, toY);
  if (pier) await dockTo(pier.pier.id, pier.dir);
  const bc = getBroadcast();
  for (const zid of [EXTERIOR, 'zone_echelon_bridge', 'zone_echelon_stern', 'zone_echelon_foyer']) {
    bc?.(zid, { type: 'zone_event', message: 'The Echelon settles at her new position, engines easing back to idle.' }, null);
  }
  broadcastSettled(bc);   // let the making-way roar fall away everywhere aboard
  // Re-centre every open helm's chase view on the new tile: the real world window (the city/
  // shoreline she's now amongst), plus the authoritative position that releases the console.
  const map = flightStateMod?.yachtHelmWindow?.(toX, toY) || null;
  for (const pid of helmViewers) sendToPlayer(pid, { type: 'helm_arrived', gx: toX, gy: toY, map });
}

// Cut the throttle mid-passage: halt her at the charted tile she's coasted nearest to (position only
// ever commits on a real water tile), then settle exactly as a normal arrival would — re-index for
// flight, lower a gangway if a pier is alongside, and release every open helm. Rounds progress to the
// nearest tile on her path so she stops on open water, never mid-channel between tiles.
async function haltEchelon() {
  if (!transit) return;
  if (transit.timer) clearTimeout(transit.timer);
  const { path, startAt, totalMs } = transit;
  const segs = path.length - 1;
  const frac = Math.max(0, Math.min(1, (Date.now() - startAt) / (totalMs || 1)));
  const idx = Math.max(0, Math.min(segs, Math.round(frac * segs)));
  const li = Math.max(1, idx);   // the leg she's on → the heading she settles pointing
  transit.toX = path[idx][0];
  transit.toY = path[idx][1];
  transit.dir = deltaToDirWord(path[li][0] - path[li - 1][0], path[li][1] - path[li - 1][1]);
  await arriveEchelon();   // reuse the whole settle routine (persist, re-index, dock, helm_arrived)
}

// The unified `stop` verb cuts the throttle — an admin on the bridge halts the Echelon mid-passage.
// Cheap-guarded so it's a no-op for every other player's `stop` (combat/scavenging/etc.).
on('player.stop', ({ player, stopped }) => {
  if (!transit) return;
  if (player?.role !== 'admin') return;
  if (!getZone(player.current_zone)?.flags?.echelon_bridge) return;
  stopped.push('the Echelon');
  haltEchelon().catch(e => console.error('[yacht] halt:', e.message));
});

// Push the live sky (time/weather + the REAL moving weather field) to every open helm console —
// the same field the flight sim renders out its canopy. Also re-pings the making-way wake while
// she's underway so nearby pilots keep seeing her working across the Basin, not sitting still.
function pushHelmLive() {
  if (!helmViewers.size) return;
  if (transit) flightStateMod?.setYachtMakingWay?.();
  const sky = flightStateMod?.skyState?.() || null;
  for (const pid of [...helmViewers]) {
    const p = getLivePlayer(pid);
    if (!p || !getZone(p.current_zone)?.flags?.echelon_bridge) { helmViewers.delete(pid); continue; }
    if (sky) sendToPlayer(pid, { type: 'helm_sky', sky });
  }
}
schedule('15s', pushHelmLive);

// Planes over the Basin: stream airborne craft near the Echelon to every open helm so the chase
// view paints them (charter + player aircraft), refreshed briskly since they move. Only while
// someone's at the helm; sends an empty list to clear when the sky's empty.
function pushHelmContacts() {
  if (!helmViewers.size) return;
  const ext = getZone(EXTERIOR); if (!ext) return;
  const contacts = flightStateMod?.aircraftNearCoord?.(ext.grid_x, ext.grid_y) || [];
  for (const pid of helmViewers) sendToPlayer(pid, { type: 'helm_contacts', contacts });
}
schedule('2s', pushHelmContacts);

// Walking off the bridge closes the helm at once (you can only steer from the bridge) — don't wait
// for the 15s prune. The client `helm_close` hands the pane back to the room view.
on('zone.entered', ({ actor, zone }) => {
  if (!actor?.id || !helmViewers.has(actor.id)) return;
  if (getZone(zone)?.flags?.echelon_bridge) return;   // still on the bridge — keep the console up
  helmViewers.delete(actor.id);
  sendToPlayer(actor.id, { type: 'helm_close' });
});

// ── Engine audio: the making-way roar, heard through the whole ship ───────────
// Every yacht zone hears the engines while she's under way, roaring to life then settling — but at
// a per-zone loudness: full in the engine room, muted in the owner's suite, mid everywhere else.
const yachtZones = () => [...world.zones.values()].filter(z => z.flags?.yacht);
function engineLevelFor(z) {
  const id = z.id || '';
  if (z.flags?.echelon_engine || z.flags?.echelon_engineering || /engine|engineering/.test(id)) return 1.0;
  if (z.flags?.echelon_suite || /suite|boudoir/.test(id)) return 0.22;   // quieter in the suite
  return 0.55;
}
function broadcastUnderway(bc, durationMs) {
  for (const z of yachtZones()) bc?.(z.id, { type: 'yacht_underway', level: engineLevelFor(z), durationMs }, null);
}
function broadcastSettled(bc) {
  for (const z of yachtZones()) bc?.(z.id, { type: 'yacht_settled' }, null);
}
// Entering a yacht zone mid-passage picks up that zone's roar level (so walking from the deck down
// into the engine room gets louder, and into the suite quieter, without waiting for the next sail).
on('zone.entered', ({ actor, zone }) => {
  if (!actor?.id || !transit) return;
  const z = getZone(zone);
  if (!z?.flags?.yacht) return;
  sendToPlayer(actor.id, { type: 'yacht_underway', level: engineLevelFor(z), durationMs: transitLeft() });
});

// Cast off along a charted tile polyline (path[0] = her current tile). Shared by the straight-leg
// `sail <dir>` and the pathfound `sailto <x> <y>`: sets up the timed transit, hands the flight
// renderer the whole path so every nearby pilot's windshield glides her hull along it, streams the
// passage to any open helm console (with the absolute path so the chase view follows the bends), and
// rouses the engines aboard. Her tile does NOT change yet — position commits only on arrival. Returns
// the destination tile + passage time. `path` must be ≥2 tiles; msPerTile sets the pace.
async function startPassage(ext, path, cruise, msPerTile, player, broadcast) {
  const segs = path.length - 1;
  const [fx, fy] = path[0], [tx, ty] = path[segs];
  const [lx, ly] = path[segs - 1];
  const dirWord = deltaToDirWord(tx - lx, ty - ly);   // final leg → the heading she settles pointing
  const passageMs = segs * msPerTile;

  await undockAll();
  const now = Date.now();
  transit = { path, fromX: fx, fromY: fy, toX: tx, toY: ty, dir: dirWord, startAt: now, arriveAt: now + passageMs, totalMs: passageMs, cruise, timer: null };
  transit.timer = setTimeout(() => { arriveEchelon().catch(e => console.error('[yacht] arrive:', e.message)); }, passageMs);
  // Authoritative + time-based passage for the flight renderer — identical for everyone, correct for
  // a pilot who arrives mid-passage. A single-leg straight sail and a bending course both ride `path`.
  flightStateMod?.setYachtTransit?.({ path, startAt: now, arriveAt: now + passageMs });
  flightStateMod?.setYachtMakingWay?.();

  // Stream the passage to any open helm console (direction + leg count + timing + bell + the absolute
  // path) so its chase view glides her the whole distance, following the bends of a charted course.
  for (const pid of helmViewers) sendToPlayer(pid, { type: 'helm_underway', dir: DIR_SHORT[dirWord], tiles: segs, ms: passageMs, cruise, path });

  const bc = broadcast || getBroadcast();
  for (const zid of [EXTERIOR, 'zone_echelon_bridge', 'zone_echelon_stern', 'zone_echelon_foyer']) {
    bc?.(zid, { type: 'zone_event', message: 'The deck leans as the Echelon comes about and gets underway.' }, player.id);
  }
  // The engines roar to life for everyone aboard and hold for the whole passage; settled on arrival.
  broadcastUnderway(bc, passageMs);
  return { tx, ty, passageMs };
}

async function cmdSail(args, raw, player, broadcast) {
  if (player.role !== 'admin') return ADMIN_ONLY;
  const ext = getZone(EXTERIOR);
  if (!ext) return { type: 'error', message: 'The Echelon is not on the water right now.' };
  if (!getZone(player.current_zone)?.flags?.echelon_bridge) {
    return { type: 'error', message: 'You can only steer the Echelon from her bridge.' };
  }

  const dockPier = adjacentPier(ext.grid_x, ext.grid_y);
  const dirWord = DIR_ALIAS[(args?.[0] || '').toLowerCase()];
  if (!dirWord) return { type: 'system', message: helmStatus(ext, dockPier?.pier?.name) };

  const left = transitLeft();
  if (left > 0) return { type: 'error', message: `The Echelon is already underway. She reaches her next position in ${Math.ceil(left / 1000)}s — you can't give a new order until she's there.` };

  // Optional throttle bell (the helm telegraph sends it as 1–100; a typed order defaults to Half).
  const bellPct = parseInt(args?.[1], 10);
  const t = Number.isFinite(bellPct) ? Math.max(0, Math.min(1, bellPct / 100)) : DEFAULT_BELL;
  const { msPerTile, cruise } = bellFor(t);

  // Carry her up to SAIL_TILES water tiles this passage, stopping short at the first tile that
  // isn't open water — so a single order visibly crosses the Basin instead of creeping one tile.
  const [dx, dy] = DIR_DELTA[dirWord];
  const path = [[ext.grid_x, ext.grid_y]];
  for (let i = 1; i <= SAIL_TILES; i++) {
    const px = ext.grid_x + dx * (i - 1), py = ext.grid_y + dy * (i - 1);   // the tile she's stepping FROM
    const nx = ext.grid_x + dx * i, ny = ext.grid_y + dy * i;
    if (!isWater(worldTileAt(nx, ny))) break;
    // A DIAGONAL step may not cut a land corner: both flanking orthogonal tiles must be water too —
    // exactly the guard the charted-course A* uses (chartCourse). Without this a `sail ne/se/sw/nw`
    // slips the hull diagonally between two land tiles, so she visibly clips the shoreline / a
    // waterfront building (the embassy) even though every tile she lands on is open water.
    if (dx && dy && (!isWater(worldTileAt(px + dx, py)) || !isWater(worldTileAt(px, py + dy)))) break;
    path.push([nx, ny]);
  }
  if (path.length < 2) {
    // Land dead ahead — she can't answer the order. If this came from an open helm console, cancel its
    // optimistic local glide so the chase view snaps her back to her real tile (she never moved).
    if (helmViewers.has(player.id)) sendToPlayer(player.id, { type: 'helm_hold', gx: ext.grid_x, gy: ext.grid_y });
    return { type: 'error', message: 'The Echelon moves only over open water. There is no channel that way.' };
  }

  const { tx, ty, passageMs } = await startPassage(ext, path, cruise, msPerTile, player, broadcast);
  return { type: 'system', message: `You engage the throttle ${dirWord}. The Echelon leans into her turn and gets underway across the Basin — she'll reach ${tx}, ${ty} in about ${Math.round(passageMs / 1000)}s.` };
}

// The map-popup helm mode: chart a water-only course around the shoreline to a chosen tile and get
// underway along it at the stately course pace. Same guards as `sail`; the telegraph passes a bell%
// (visual way only — course time is fixed per tile). The client draws its own course preview and
// fires this on "throttle up"; the server is authoritative, so its path corrects the local glide.
async function cmdSailTo(args, raw, player, broadcast) {
  if (player.role !== 'admin') return ADMIN_ONLY;
  const ext = getZone(EXTERIOR);
  if (!ext) return { type: 'error', message: 'The Echelon is not on the water right now.' };
  if (!getZone(player.current_zone)?.flags?.echelon_bridge) {
    return { type: 'error', message: 'You can only steer the Echelon from her bridge.' };
  }
  const left = transitLeft();
  if (left > 0) return { type: 'error', message: `The Echelon is already underway. She reaches her next position in ${Math.ceil(left / 1000)}s — you can't give a new order until she's there.` };

  const tx = parseInt(args?.[0], 10), ty = parseInt(args?.[1], 10);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return { type: 'error', message: 'Usage: sailto <x> <y> — plot a course to a water tile.' };
  const bellPct = parseInt(args?.[2], 10);
  const t = Number.isFinite(bellPct) ? Math.max(0, Math.min(1, bellPct / 100)) : DEFAULT_BELL;
  const { cruise } = bellFor(t);   // visual way only — a charted course runs at the fixed course pace

  const path = chartCourse(ext.grid_x, ext.grid_y, tx, ty);
  if (!path) {
    if (helmViewers.has(player.id)) sendToPlayer(player.id, { type: 'helm_hold', gx: ext.grid_x, gy: ext.grid_y });
    return { type: 'error', message: 'There is no navigable channel to that tile — the Echelon can only make way over open water.' };
  }

  const { tx: ax, ty: ay, passageMs } = await startPassage(ext, path, cruise, SAIL_MS_PER_TILE_COURSE, player, broadcast);
  return { type: 'system', message: `Course charted — ${path.length - 1} legs to ${ax}, ${ay}. The Echelon gets underway across the Basin, arriving in about ${Math.round(passageMs / 1000)}s.` };
}

async function cmdDock(args, raw, player) {
  if (player.role !== 'admin') return ADMIN_ONLY;
  const ext = getZone(EXTERIOR);
  if (!ext) return { type: 'error', message: 'The Echelon is not on the water right now.' };
  if (await isDocked()) {
    await undockAll();
    return { type: 'system', message: 'The gangway retracts. The Echelon is free to move.' };
  }
  const pier = adjacentPier(ext.grid_x, ext.grid_y);
  if (!pier) return { type: 'error', message: 'There is no pier alongside. Bring her beside one first.' };
  await dockTo(pier.pier.id, pier.dir);
  return { type: 'system', message: `The gangway lowers to ${pier.pier.name}. Invited guests may now board or step ashore.` };
}

// ── Secret teleporter closet ────────────────────────────────────────────────────
// A hidden furniture (flags.teleporter, flags.teleport_target=<zone id>) links Cyd's
// Embassy apartment to a secure room aboard the Echelon, and back — the owner's
// private way aboard regardless of where the yacht is or whether it's docked. To
// anyone not approved it is, and must appear to be, an ordinary closet: the secret
// is never disclosed. It bypasses embarkation/docking but still respects the same
// approval check as every other way aboard.
const CLOSET_MUNDANE = [
  'You rummage through the closet. Coats, a dead umbrella, the smell of old cedar. Nothing else.',
  'You open the closet. Empty hangers chime against each other. Just a closet.',
  'You poke around inside the closet. Dust, a single lost glove, bare shelving. Nothing of interest.',
];

async function doUseTeleporter(args, raw, player, broadcast) {
  const { rows } = await query(
    `SELECT flags FROM furniture WHERE zone_id=$1 AND flags::text LIKE '%"teleporter"%' LIMIT 1`,
    [player.current_zone]
  ).catch(() => ({ rows: [] }));
  if (!rows[0]) return undefined; // no teleporter here — fall through to normal `use`
  const flags = typeof rows[0].flags === 'object' ? rows[0].flags : JSON.parse(rows[0].flags || '{}');

  // Not approved → it's just a closet. Never reveal the mechanism.
  if (!(await isInvited(player))) {
    return { type: 'emote', message: CLOSET_MUNDANE[Math.floor((player.id?.length || 0) % CLOSET_MUNDANE.length)] };
  }
  const dest = flags.teleport_target;
  if (!getZone(dest)) return { type: 'error', message: 'The closet hums, but the far end is dark. Nothing happens.' };

  const bc = broadcast || getBroadcast();
  sendToPlayer(player.id, { type: 'output', message: 'You press the false back of the closet. It swings inward onto a lit alcove, and the world folds sideways around you.' });
  await dispatchAction({ type: 'TELEPORT', actor: player, params: { zone_id: dest }, context: { broadcast: bc } });
  const zone = getZone(dest);
  return zone
    ? { type: 'move', message: await describeZone(zone, player), zone: dest, minimap: getMinimapData(dest, 8, player) }
    : { type: 'emote', message: 'You step through into somewhere else.' };
}

export const specializedActions = [
  { verb: 'use', requiredTag: 'teleporter', handler: doUseTeleporter },
];

// `helm` (admin, on the bridge) opens the visual helm console — the client takes over the area
// pane with the chase view + wheel (dispatch `helm_open`), exactly like the flight sim's cockpit.
// AHEAD in that UI fires the ordinary `sail` command, so all the movement rules stay server-side.
async function cmdHelmConsole(args, raw, player) {
  // Leaving is DETERMINISTIC — the client's ✕ sends `helm close`, which always steps back and never
  // re-opens. Routing the exit through the plain toggle below let a helmViewers desync (see the
  // pushHelmLive zone sweep) flip it back OPEN, so you had to close a second time. Handle it first,
  // before the admin/bridge gates, so closing always works even if you've since left the bridge.
  if ((args[0] || '').toLowerCase() === 'close') {
    helmViewers.delete(player.id);
    sendToPlayer(player.id, { type: 'helm_close' });
    return { type: 'noop' };
  }
  if (player.role !== 'admin') return ADMIN_ONLY;
  const ext = getZone(EXTERIOR);
  if (!ext) return { type: 'error', message: 'The Echelon is not on the water right now.' };
  if (!getZone(player.current_zone)?.flags?.echelon_bridge) {
    return { type: 'error', message: 'You can only take the helm from her bridge.' };
  }
  // `helm` toggles: a second call while the console is up steps back from it (closes the client view).
  if (helmViewers.has(player.id)) {
    helmViewers.delete(player.id);
    sendToPlayer(player.id, { type: 'helm_close' });
    return { type: 'system', message: 'You step back from the helm.' };
  }
  // Open already-underway (heading = her passage's course) so the console restores the lock + ETA;
  // hand over the live sky (real weather field) up front, then pushHelmLive keeps it current.
  const heading = transit ? DIR_DEG[transit.dir] : (Number(ext.flags?.heading) || 0);   // moored ⇒ her last steered course (persisted)
  const transitTiles = transit ? Math.max(Math.abs(transit.toX - transit.fromX), Math.abs(transit.toY - transit.fromY)) : 0;
  const sky = flightStateMod?.skyState?.() || null;
  const map = flightStateMod?.yachtHelmWindow?.(ext.grid_x, ext.grid_y) || null;   // the real basin around her
  sendToPlayer(player.id, { type: 'helm_open', gx: ext.grid_x, gy: ext.grid_y, heading, transitMs: transitLeft(), transitTotal: transit ? transit.totalMs : 0, transitTiles, cruise: transit ? transit.cruise : 0, sky, map });
  helmViewers.add(player.id);
  return { type: 'system', message: 'You take the helm. The console wakes under your hands.' };
}

// A persistent "take the helm" call-to-action on her bridge — mirrors the airfield's
// hangar-bay line (flight's zone.describeRoom). The visual helm console is the primary
// way to steer her, so make it a click target on every look rather than a remembered
// verb. Fires per zone; returns undefined off the bridge so it never touches other rooms.
function describeBridge(zone) {
  if (!zone?.flags?.echelon_bridge) return undefined;
  return `<span class="furniture-label">Helm:</span> <span class="action-link cmd-link" data-action="cmd" data-cmd="helm" title="take the helm — chase view + wheel">take the helm</span> <span class="text-dim">steer her from the console — chart a course across the Basin in 3D</span>`;
}

export const hooks = {
  'zone.describeRoom': describeBridge,
};

export const commands = {
  invite:   cmdInvite,
  uninvite: cmdUninvite,
  invites:  cmdInvites,
  sail:     cmdSail,
  sailto:   cmdSailTo,
  helm:     cmdHelmConsole,
  dock:     cmdDock,
};
