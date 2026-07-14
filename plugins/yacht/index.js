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
import { getZone, getLivePlayer, world, invalidateEntranceDirCache, addExitOverride, removeExitOverride, registerMinimapNodeFilter, getMinimapData } from '../../server/engine/world.js';
import { sendToPlayer, getBroadcast } from '../../server/engine/messaging.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { on } from '../../server/engine/events.js';
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
registerMoveGate(async ({ player, from, to }) => {
  if (!to?.flags?.yacht) return;           // not boarding the yacht
  if (from?.flags?.yacht) return;          // already aboard — internal move
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
// to rest only when she arrives. No new order can be given until she's there. A passage covers up
// to SAIL_TILES water tiles (stopping short at the first obstacle), so an order visibly carries her
// across the Basin rather than creeping a single tile.
const SAIL_TILES = 3;   // up to three water tiles per order (she stops at the last water tile before any
                        // non-water tile — never enters land). Same per-tile speed, so a longer passage.
// Single speed now: ~2× the original hull, and the slow bell matches the fast bell (they were asked to be
// equal), so every order is the same ~2.5-second one-tile hop regardless of how far the lever is pushed.
// `cruise` (the streamed visual way — wake/water intensity + shown knots) still tracks the lever so a
// harder bell reads as a bigger wake, but the passage TIME no longer changes.
const SAIL_MS_PER_TILE_SLOW = 2_500;    // 2.5 s per water tile
const SAIL_MS_PER_TILE_FULL = 2_500;    // identical — slow == fast
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
}

// Wire the gangway both ways between the exterior tile and an adjacent pier.
async function dockTo(pierZoneId, dirYachtToPier) {
  await addExitOverride(EXTERIOR, dirYachtToPier, pierZoneId, DOCK_SOURCE);
  await addExitOverride(pierZoneId, REVERSE[dirYachtToPier], EXTERIOR, DOCK_SOURCE);
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
  // Persist BOTH her tile and her heading (the course she just steamed). flags.heading survives a
  // restart, so she reopens pointing the last way she was sent — never snapping back to bow-north.
  const ext = getZone(EXTERIOR);
  const flags = { ...(ext?.flags || {}), heading: DIR_DEG[dir] };
  await query('UPDATE zones SET grid_x=$1, grid_y=$2, flags=$3 WHERE id=$4', [toX, toY, JSON.stringify(flags), EXTERIOR]);
  if (ext) { ext.grid_x = toX; ext.grid_y = toY; ext.flags = flags; }
  invalidateEntranceDirCache();
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
setInterval(pushHelmLive, 15_000);

// Planes over the Basin: stream airborne craft near the Echelon to every open helm so the chase
// view paints them (charter + player aircraft), refreshed briskly since they move. Only while
// someone's at the helm; sends an empty list to clear when the sky's empty.
function pushHelmContacts() {
  if (!helmViewers.size) return;
  const ext = getZone(EXTERIOR); if (!ext) return;
  const contacts = flightStateMod?.aircraftNearCoord?.(ext.grid_x, ext.grid_y) || [];
  for (const pid of helmViewers) sendToPlayer(pid, { type: 'helm_contacts', contacts });
}
setInterval(pushHelmContacts, 2000);

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
  // Higher bell = faster = a shorter passage, and a bigger visual wake.
  const bellPct = parseInt(args?.[1], 10);
  const t = Number.isFinite(bellPct) ? Math.max(0, Math.min(1, bellPct / 100)) : DEFAULT_BELL;
  const { msPerTile, cruise } = bellFor(t);

  // Carry her up to SAIL_TILES water tiles this passage, stopping short at the first tile that
  // isn't open water — so a single order visibly crosses the Basin instead of creeping one tile.
  const [dx, dy] = DIR_DELTA[dirWord];
  let tx = ext.grid_x, ty = ext.grid_y, tiles = 0;
  for (let i = 1; i <= SAIL_TILES; i++) {
    const nx = ext.grid_x + dx * i, ny = ext.grid_y + dy * i;
    if (!worldTileAt(nx, ny)?.flags?.water) break;
    tx = nx; ty = ny; tiles = i;
  }
  if (!tiles) {
    // Land (or another obstacle) dead ahead — she can't answer the order. If this came from an open helm
    // console, cancel its optimistic local glide so the chase view snaps her right back to her real tile
    // (she never moved) instead of holding a bogus lead that would later read as "returning to the start".
    if (helmViewers.has(player.id)) sendToPlayer(player.id, { type: 'helm_hold', gx: ext.grid_x, gy: ext.grid_y });
    return { type: 'error', message: 'The Echelon moves only over open water. There is no channel that way.' };
  }

  // Passage time = distance × the bell's time-per-tile, so the trip is genuinely scaled to how far
  // she's going AND how hard you've throttled up.
  const passageMs = tiles * msPerTile;

  // Cast off and get underway. Her tile does NOT change yet — she's between tiles for the passage and
  // only commits to the new position on arrival (arriveEchelon), scheduled below.
  await undockAll();
  const now = Date.now();
  transit = { fromX: ext.grid_x, fromY: ext.grid_y, toX: tx, toY: ty, dir: dirWord, startAt: now, arriveAt: now + passageMs, totalMs: passageMs, cruise, timer: null };
  transit.timer = setTimeout(() => { arriveEchelon().catch(e => console.error('[yacht] arrive:', e.message)); }, passageMs);
  // Hand the flight renderer the whole passage (from→to, timed) so every nearby pilot's windshield
  // glides her hull sub-tile across the Basin for the full passage — authoritative + time-based,
  // so it's identical for everyone and correct for a pilot who arrives mid-passage. setYachtMakingWay
  // still fires the decaying-wake fallback for the arrival ping; the owner's Helm chase view drives
  // its own glide from the timing the console is handed.
  flightStateMod?.setYachtTransit?.({ fromX: ext.grid_x, fromY: ext.grid_y, toX: tx, toY: ty, startAt: now, arriveAt: now + passageMs });
  flightStateMod?.setYachtMakingWay?.();

  // Tell any open helm console the true passage vector (direction + tile count + timing + bell) so its
  // chase view glides her the whole distance smoothly at the right speed — whether the order came from
  // the telegraph or a typed `sail`. The client snaps to the authoritative position on helm_arrived.
  for (const pid of helmViewers) sendToPlayer(pid, { type: 'helm_underway', dir: DIR_SHORT[dirWord], tiles, ms: passageMs, cruise });

  const bc = broadcast || getBroadcast();
  for (const zid of [EXTERIOR, 'zone_echelon_bridge', 'zone_echelon_stern', 'zone_echelon_foyer']) {
    bc?.(zid, { type: 'zone_event', message: 'The deck leans as the Echelon comes about and gets underway.' }, player.id);
  }
  // Cue the client ambience: the engines roar to life for everyone aboard and hold for the whole
  // passage, per-zone loud→muted; the client settles them on arrival (broadcastSettled).
  broadcastUnderway(bc, passageMs);
  return { type: 'system', message: `You engage the throttle ${dirWord}. The Echelon leans into her turn and gets underway across the Basin — she'll reach ${tx}, ${ty} in about ${Math.round(passageMs / 1000)}s.` };
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

export const commands = {
  invite:   cmdInvite,
  uninvite: cmdUninvite,
  invites:  cmdInvites,
  sail:     cmdSail,
  helm:     cmdHelmConsole,
  dock:     cmdDock,
};
