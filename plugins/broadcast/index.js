import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { schedule } from '../../server/engine/scheduler.js';
import { world, getZonePlayers, getZone, getZoneNpcs, getZoneEnemies, reloadZone, hasActivePlayers, insertFurniture, updateFurniture, deleteFurnitureWhere, getZoneFurniture } from '../../server/engine/world.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on, emit } from '../../server/engine/events.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { registerCommand } from '../../server/engine/plugins.js';
import { apiDeleteZone } from '../../server/api/routes.js';
import { registerViewerChecker, registerNpcScheduleChecker, registerNpcNextShiftLookup, registerNpcStudioZoneLookup, registerZoneWatchedChecker, hasChannelViewers, isNpcScheduledNow, getNpcStudioZone } from '../../server/engine/broadcast-bridge.js';
import { registerAICondition, registerAIAction } from '../../server/engine/ai-behaviour.js';
import { getEnvironmentState, recomputePower, resyncAllLightingStates, fixZonePowerConnections, fixBuildingPowerConnections, markPowerTopologyDirty } from '../../server/engine/environment.js';
import { getSongDefByName, getSfxDefByName, getAmbientDefByName, getSampleDefByName } from '../audio/index.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { awardSkillUse, effectiveSkill } from '../../server/engine/skills.js';
import { hackDifficulty, breachMargin, hasHackDeck, damageHackDeck } from '../../server/engine/hack-gear.js';
import { reloadItem, deleteItemCache, getItem } from '../../server/engine/items-cache.js';
import { sportsRng, sportsHash, sportsPick, sportsFill, sportsShuffle } from './rng.js';
// Sport modules. One entry today; the registry shape is what a second sport plugs
// into, so it exists now rather than being retrofitted around hockey later.
import { BASEBALL } from './sports/baseball.js';
import { HOCKEY } from './sports/hockey.js';
import {
  gameshowAiring, gameshowDayBucket, getGameshowGraph, gameshowOpenRound, gameshowResolveRound,
  gameshowTokens, gameshowForgetPlayer, makeGuessCommand, assembleGameshowGraph, gameshowPool,
  parseGuess, scorePrice, scoreOverUnder, scoreLot, scoreShowcase, _gameshowTest,
} from './gameshow.js';
import { installAudienceGate } from './audience.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { registerPurchaseStamp } from '../../server/engine/vendor.js';
import { cmdListen } from '../../server/engine/commands/world.js';

// ── Color helpers (for studio tile coloring) ─────────────────────────────────
function _hexToHsl(hex) {
  const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), l = (max+min)/2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d/(2-max-min) : d/(max+min);
  let h = max === r ? (g-b)/d + (g<b?6:0) : max === g ? (b-r)/d+2 : (r-g)/d+4;
  return [h*60, s, l];
}
function _hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2*l-1)) * s, x = c*(1-Math.abs((h/60)%2-1)), m = l - c/2;
  let r,g,b;
  if (h<60){r=c;g=x;b=0;}else if(h<120){r=x;g=c;b=0;}else if(h<180){r=0;g=c;b=x;}
  else if(h<240){r=0;g=x;b=c;}else if(h<300){r=x;g=0;b=c;}else{r=c;g=0;b=x;}
  return '#'+[r+m,g+m,b+m].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
}
async function _studioTileColor() {
  const { rows } = await query(`SELECT color FROM zones WHERE id='zone_start' LIMIT 1`);
  const ref = rows[0]?.color;
  const [,s,l] = ref && /^#[0-9a-f]{6}$/i.test(ref) ? _hexToHsl(ref) : [0, 0.55, 0.45];
  const hue = Math.random() * 360;
  return _hslToHex(hue, s, l);
}

// ── In-memory state ──────────────────────────────────────────────────────────

// channelRuntime.get(channelId) = {
//   playlist: [{ broadcastId, startTime, duration, playback_mode, messages, message_interval }],
//   totalDuration: seconds,
//   idleBroadcast: { messages, message_interval } | null,
//   channelType: string,
//   newsCategories: string[],
//   lastMsgKey: string,   // "<broadcastId>:<msgIdx>" — avoids re-sending same message
//   loopOriginMs: number, // real-time epoch when the loop "started" (for elapsed calc)
// }
const channelRuntime = new Map();

// zoneTunings.get(zoneId) = Map<channelId, deviceType>
// Built from furniture rows with flags.tuned_channel set.
const zoneTunings = new Map();

// newsQueue.get(channelId) = [{ text, priority, ts }, ...]
const newsQueue = new Map();

// furnitureChannelIndex.get(furnitureId) = { zoneId, channelId, deviceType }
// For fast invalidation on tune changes.
const furnitureChannelIndex = new Map();

// tvWatchers.get(playerId) = channelId — players who currently have the TV panel open.
const tvWatchers = new Map();
// tabletTuners.get(playerId) = channelId — players watching on the Tablet TV app.
// Deliberately SEPARATE from tvWatchers: the tablet receives with no physical
// device in the zone (see the tablet delivery pass in broadcastTick), and keeping
// its own map lets a player watch the wall set on one channel and the tablet on
// another at the same time.
const tabletTuners = new Map();
// deckWatchers.get(playerId) = channelId — players with the mediadeck preview open.
const deckWatchers = new Map();
// deckRecent.get(channelId) = last few formatted lines, so a freshly-opened deck
// preview shows the current program immediately instead of a blank screen.
const deckRecent = new Map();
const DECK_RECENT_MAX = 8;
// Channels currently signalled as dead air to their deck monitors, so the
// [NO BROADCAST] card fires once per idle transition rather than every tick.
const deckIdleChannels = new Set();
function _recordDeckMessage(channelId, message) {
  if (!channelId || !message) return;
  const ring = deckRecent.get(channelId) || [];
  ring.push(message);
  while (ring.length > DECK_RECENT_MAX) ring.shift();
  deckRecent.set(channelId, ring);
}

on('tv.watch',   ({ playerId, channelId }) => { tvWatchers.set(playerId, channelId); sendCatchUp(playerId, channelId); });
// A quick tap closes the panel — you stop watching, but the set keeps playing and the
// room keeps overhearing it (ambient continues). So a plain unwatch just drops you as a
// viewer; it does NOT switch the set off.
on('tv.unwatch', ({ playerId }) => { tvWatchers.delete(playerId); });

// The TV-guide button asks for the tuned channel's running order + the current time.
on('tv.schedule', ({ playerId, channelId }) => { sendTvSchedule(playerId, channelId); });

// The standings button. The league table already flashes up on air as a transient bug,
// but that's server-thrown and auto-dismisses — this is the viewer pulling it up on
// demand and holding it. Same shape either way; refreshStandings is cached, so mashing
// the button costs nothing.
on('tv.standings', ({ playerId }) => {
  sendTvStandings(playerId).catch(err => console.error('[broadcast] sendTvStandings error:', err.message));
});

// Press-and-hold on the power button is the deliberate "switch it off" — turns the
// shared set off for the whole room.
on('tv.poweroff', ({ playerId }) => {
  const channelId = tvWatchers.get(playerId);
  tvWatchers.delete(playerId);
  if (channelId) powerOffWatchedTv(playerId, channelId).catch(err => console.error('[broadcast] powerOffWatchedTv error:', err.message));
});

// Switching the TV off (press-and-hold) turns the shared set off for the whole room:
// untune the device so ambient TV lines stop, tell the room, and close any co-watcher's
// still-open panel. Mirrors `tune 0` plus a room announcement.
async function powerOffWatchedTv(playerId, channelId) {
  const player = world.players.get(playerId);
  const zoneId = player?.current_zone;
  if (!zoneId) return;

  // The tuned TV device(s) in this zone on this channel.
  const deviceIds = [];
  for (const [fid, entry] of furnitureChannelIndex) {
    if (entry.zoneId === zoneId && entry.channelId === channelId && entry.deviceType === 'tv') deviceIds.push(fid);
  }
  if (!deviceIds.length) return; // nothing to power off (e.g. player already left the room)

  for (const fid of deviceIds) {
    const { rows } = await query('SELECT * FROM furniture WHERE id=$1', [fid]).catch(() => ({ rows: [] }));
    if (rows.length) await _applyTuning(rows[0], 0, zoneId); // channel 0 = off — drops the zone from ambient ticks
  }

  // The physical set is now off — close any co-watcher's panel too.
  for (const p of getZonePlayers(zoneId)) {
    if (p.id !== playerId && tvWatchers.get(p.id) === channelId) {
      tvWatchers.delete(p.id);
      sendToPlayer(p.id, { type: 'tv_off' });
    }
  }

  sendToPlayer(playerId, { type: 'output', message: 'You switch off the television.' });
  sendToZone(zoneId, { type: 'zone_event', message: `${player.handle} switches off the television.` }, playerId);
}
on('deck.watch',   ({ playerId, channelId }) => {
  deckWatchers.set(playerId, channelId);
  // If the channel is currently dead air, open straight onto the [NO BROADCAST]
  // card instead of replaying the last program's stale lines.
  if (deckIdleChannels.has(channelId)) {
    sendToPlayer(playerId, { type: 'deck_broadcast', channel: channelId, style: 'no_broadcast' });
    return;
  }
  // Seed the preview with recent lines so it isn't blank until the next tick.
  for (const line of (deckRecent.get(channelId) || []))
    sendToPlayer(playerId, { type: 'deck_broadcast', message: line, channel: channelId, style: 'raw' });
});
on('deck.unwatch', ({ playerId })            => deckWatchers.delete(playerId));

// The Tablet TV app registering/dropping its portable tuner. No furniture, no zone —
// the tablet streams wherever the player is.
on('tablet_tv.watch',   ({ playerId, channelId }) => { if (channelId) { tabletTuners.set(playerId, channelId); sendCatchUp(playerId, channelId); } });
on('tablet_tv.unwatch', ({ playerId })            => { tabletTuners.delete(playerId); });

on('player.logout', ({ id })              => { tvWatchers.delete(id); deckWatchers.delete(id); tabletTuners.delete(id); gameshowForgetPlayer(id); });

// studioZoneIndex.get(studioZoneId) = channelId
// Enables O(1) lookup in zone.broadcast relay listener.
const studioZoneIndex = new Map();

// cameraZoneStatus.get(zoneId) = true if at least one camera in that zone is
// powered and undamaged. Refreshed alongside loadChannelRuntimes().
const cameraZoneStatus = new Map();

// zoneCameras.get(zoneId) = [{ id, direction, label }, …] — the WORKING cameras
// physically registered in that zone, in a stable order. A camera direction in a
// broadcast graph is not a free-floating instruction: it has to be executed by one
// of these units, and if the zone has none, that shot does not exist. Rebuilt
// alongside cameraZoneStatus.
const zoneCameras = new Map();

// A camera's on-air name. Cameras created by the studio builder are ids like
// `cam_<channel>_3_<ts>`; pull the crew number out of that when it's there, else
// fall back to position in the zone's roster.
function _cameraLabel(camId, idx) {
  const m = /_(\d+)_\d+$/.exec(camId || '');
  return `Camera ${m ? m[1] : idx + 1}`;
}

// Put a line on the studio floor as a physical event in the room. Tagged so the
// studio-camera relay (`zone.broadcast`) doesn't pick the show's own performance
// back up and re-air it — the acting layer already delivers those lines to air by
// its own path. Untagged room events (players talking, things breaking) DO get
// relayed: that's the audience seam.
function _stageLine(zoneId, message) {
  if (!zoneId || !message) return;
  sendToZone(zoneId, { type: 'output', message, _fromBroadcast: true });
}

// Assign the next camera in the zone's roster to a shot, round-robin per channel so
// a multi-camera studio visibly cuts between its units instead of parking on one.
function _pickCamera(zoneId, state) {
  const cams = zoneCameras.get(zoneId);
  if (!cams?.length) return null;
  const seq = state._camSeq = ((state._camSeq || 0) + 1);
  return cams[seq % cams.length];
}

// Default behaviour graph assigned to studio NPCs that don't yet have one:
// start -> CHECK_WORK -> (goToWork) -> GO_TO_WORK -> AT_WORK -> loop back to CHECK_WORK
//                      -> (haveLife) -> HAVE_LIFE -> loop back to CHECK_WORK
function makeDefaultStudioGraph(studioZoneId = null) {
  return {
    _start: 'n_start',
    nodes: {
      n_start:  { type: 'start',  next: 'n_check' },
      n_check:  { type: 'action', action_type: 'CHECK_WORK', goToWork: 'n_work', haveLife: 'n_life' },
      n_work:   { type: 'action', action_type: 'GO_TO_WORK', params: studioZoneId ? { zone_id: studioZoneId } : {}, next: 'n_atwork' },
      n_atwork: { type: 'action', action_type: 'AT_WORK',    next: 'n_check' },
      n_life:   { type: 'action', action_type: 'HAVE_LIFE',  next: 'n_check' },
    },
  };
}
// Backward-compat alias used where no specific studio zone is known yet
const DEFAULT_STUDIO_BEHAVIOUR_GRAPH = makeDefaultStudioGraph();

// The roaming talk-show guest's lifecycle graph. Unlike the resident cast (who just
// commute studio↔home), the guest LIVES OFF-WORLD between episodes in a hidden backstage
// zone, and each night: appears in a random unobserved zone (no players, no cams), walks
// to the studio to perform, then — once the show's over — slips out and vanishes back to
// backstage the moment nobody's watching. TALKSHOW_APPEAR / TALKSHOW_HIDE are engine AI
// actions (ai-behaviour.js) that do the teleport-in / walk-out-and-vanish; between them the
// stock GO_TO_WORK/AT_WORK move it onstage and hold it there for the broadcast.
function makeTalkshowGuestGraph(studioZoneId = null) {
  return {
    _start: 'g_start',
    nodes: {
      g_start:  { type: 'start', next: 'g_sched' },
      g_sched:  { type: 'condition', condition_type: 'IS_BROADCAST_SCHEDULED', ifTrue: 'g_appear', ifFalse: 'g_hide' },
      // On the clock: materialise (if still backstage), commute in, hold onstage.
      g_appear: { type: 'action', action_type: 'TALKSHOW_APPEAR', next: 'g_work' },
      g_work:   { type: 'action', action_type: 'GO_TO_WORK', params: studioZoneId ? { zone_id: studioZoneId } : {}, next: 'g_atwork' },
      g_atwork: { type: 'action', action_type: 'AT_WORK', next: 'g_wait' },
      g_wait:   { type: 'wait', seconds: 12, next: 'g_loop' },
      // Off the clock: walk out and disappear once unobserved.
      g_hide:   { type: 'action', action_type: 'TALKSHOW_HIDE', next: 'g_wait2' },
      g_wait2:  { type: 'wait', seconds: 12, next: 'g_loop' },
      g_loop:   { type: 'loop', next: 'g_start' },
    },
  };
}

// Neutral "off the payroll" graph: just live a random life, no studio commute.
// Used to un-stick an NPC that a scripted show wrongly routed to a studio.
function makeWanderGraph() {
  return {
    _start: 'n_start',
    nodes: {
      n_start: { type: 'start',  next: 'n_life' },
      n_life:  { type: 'action', action_type: 'HAVE_LIFE', next: 'n_loop' },
      n_loop:  { type: 'loop',   next: 'n_start' },
    },
  };
}

// graphicsCache.get(id) = { id, name, type, content }
// Loaded at startup and after any graphics CRUD operation.
const graphicsCache = new Map();

// Per-channel broadcast log: the graceful-failure events the live runtime hits
// while airing — unknown/unparseable nodes, missing graphics/songs, node errors.
// In-memory ring (clears on restart, like the rest of the runtime), surfaced in
// the dev-panel broadcast debugger. This is the "channel's broadcast log" the
// graceful-failure contract writes to before moving on to the next node.
const broadcastLog = new Map(); // channelId -> [{ ts, level, msg, node }]
const BROADCAST_LOG_MAX = 120;
function logBroadcast(channelId, level, msg, node = null) {
  if (!channelId) return;
  const arr = broadcastLog.get(channelId) || [];
  arr.push({ ts: Date.now(), level, msg, node });
  while (arr.length > BROADCAST_LOG_MAX) arr.shift();
  broadcastLog.set(channelId, arr);
}

// Node types the graph walker knows how to run. Anything else is skipped on air.
const KNOWN_BROADCAST_NODES = new Set([
  'start', 'say', 'music', 'npc_action', 'ticker', 'npc_anchor', 'camera_cut',
  'title_card', 'credits', 'overlay', 'show_overlay', 'clear_overlay',
  'tech_difficulties', 'event', 'wait', 'condition', 'loop', 'random',
  'set_flag', 'inject_news', 'break',
]);

// Static day-scan for the dev-panel broadcast debugger: walk every scheduled
// slot's graph and report anything that would make the runtime skip a node or
// drop to technical difficulties on air — missing graphics/songs/NPCs/zones,
// unknown/unparseable nodes — plus the channel-level gaps that black a channel
// out (no transmitter deck, no offline graphic). Read-only; also returns the
// live runtime broadcast log so authoring problems and on-air failures sit
// side by side. Returns null if the channel doesn't exist.
// ── Day-of-week slot masks ───────────────────────────────────────────────────
// A playlist row carries a 7-bit `days` mask (bit 0 = Mon … bit 6 = Sun, matching
// world_clock.day_of_week's 1=Mon..7=Sun). DAYS_ALL is the default, so a schedule
// authored once repeats every day exactly as it always did.
//
// There is ONE schedule, not a weekly mode and a daily mode: exceptions are extra
// rows over the top of the everyday grid. Where two rows both cover the current
// second, the MORE SPECIFIC one wins — fewest days set. That's what lets an author
// lay down a normal week and then drop a Thursday-only slot on 20:00 without
// touching, duplicating, or gapping the everyday row underneath it. `priority` is
// the manual escape hatch and outranks specificity; equal on both, the later
// start_time wins (the slot that most recently began).
const DAYS_ALL = 127;
const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function _dayMask(days) {
  const n = Number(days);
  // Anything unset/garbage/out-of-range reads as every day. A 0 mask would mean a
  // slot that can never air, which is never what an author meant — and would make
  // a bad write silently black out a channel.
  return Number.isFinite(n) && (n & DAYS_ALL) ? (n & DAYS_ALL) : DAYS_ALL;
}
function _dayBit(dayOfWeek) {
  const d = Number(dayOfWeek);
  return 1 << ((Number.isFinite(d) && d >= 1 && d <= 7 ? d : 1) - 1);
}
function _dayCount(mask) {
  let n = 0;
  for (let m = _dayMask(mask); m; m >>= 1) n += m & 1;
  return n;
}
// Human-readable mask, for the day-scan report and the dev panel: '' when it's
// every day (nothing worth saying), else 'Thu' / 'Mon,Wed,Fri' / 'Sat,Sun'.
function _dayLabel(mask) {
  const m = _dayMask(mask);
  if (m === DAYS_ALL) return '';
  return DAY_ABBR.filter((_, i) => m & (1 << i)).join(',');
}
function _slotAirsOn(item, dayOfWeek) {
  return !!(_dayMask(item?.days) & _dayBit(dayOfWeek));
}
// The one slot on air at `gameSecs` on `dayOfWeek`. Every daily-schedule read goes
// through here so the runner, the NPC shift checker, the "what's on now" panel and
// the viewer's TV guide can never disagree about which slot won.
function _pickDailySlot(playlist, gameSecs, dayOfWeek) {
  let best = null;
  for (const i of playlist || []) {
    if (gameSecs < i.startTime || gameSecs >= i.startTime + i.duration) continue;
    if (!_slotAirsOn(i, dayOfWeek)) continue;
    if (!best) { best = i; continue; }
    const pi = i.priority || 0, pb = best.priority || 0;
    if (pi !== pb) { if (pi > pb) best = i; continue; }
    const di = _dayCount(i.days), db = _dayCount(best.days);
    if (di !== db) { if (di < db) best = i; continue; }
    if (i.startTime > best.startTime) best = i;
  }
  return best;
}

async function scanChannelDay(channelId) {
  const { rows: chRows } = await query('SELECT * FROM media_channels WHERE id=$1', [channelId]);
  if (!chRows.length) return null;
  const ch = chRows[0];
  const issues = [];
  const add = (severity, code, msg, extra = {}) => issues.push({ severity, code, msg, ...extra });

  // Channel-level: the transmitter (media deck). Without a powered one, dark.
  const { rows: deckRows } = await query(
    `SELECT id, zone_id FROM furniture WHERE flags->>'media_deck'='true' AND flags->>'channel_id'=$1 LIMIT 1`, [channelId]
  );
  if (!deckRows.length) add('error', 'no_transmitter', 'No media deck (transmitter) linked — this channel cannot broadcast; it stays dark.');
  else if (deckRows[0].zone_id) {
    const z = getZone(deckRows[0].zone_id);
    if (z && z.powerStatus === 'offline') add('warn', 'transmitter_unpowered', 'The media deck sits in a blacked-out zone — off air until power returns.');
  }
  if (!ch.offline_graphic_id) add('info', 'no_offline_graphic', 'No offline graphic set — off-air / technical difficulties will show plain stand-by text, not a graphic.');

  const { rows: items } = await query(
    `SELECT p.start_time, p.broadcast_id, p.days, b.name AS broadcast_name, b.playback_mode, b.broadcast_graph
       FROM media_channel_playlist p JOIN media_broadcasts b ON b.id=p.broadcast_id
      WHERE p.channel_id=$1 ORDER BY p.start_time`, [channelId]
  );
  let scanned = 0;
  for (const item of items) {
    // Day-restricted slots read as "'Fight Night' (Thu)" throughout the report, so a
    // problem in a once-a-week programme can't be mistaken for a problem in the
    // everyday slot it sits on top of.
    const dayTag = _dayLabel(item.days);
    const label = (item.broadcast_name || item.broadcast_id) + (dayTag ? ` (${dayTag})` : '');
    if (item.playback_mode === 'weather') { add('info', 'weather_live', `'${label}' is a weather forecast — assembled live, not statically scannable.`, { broadcast: label }); continue; }
    if (item.playback_mode === 'sports')  { add('info', 'sports_live',  `'${label}' is a sports broadcast — a fresh game is simulated each airing, not statically scannable.`, { broadcast: label }); continue; }
    if (item.playback_mode === 'news')    { add('info', 'news_live',    `'${label}' is a news broadcast — a fresh bulletin is assembled from the live news generator each airing, not statically scannable.`, { broadcast: label }); continue; }
    if (item.playback_mode === 'talkshow'){ add('info', 'talkshow_live', `'${label}' is a talk show — a fresh episode is assembled and acted live by the cast each night, not statically scannable.`, { broadcast: label }); continue; }
    if (item.playback_mode === 'morning') { add('info', 'morning_live', `'${label}' is a morning show — a fresh episode is assembled from the live world each day and acted by the hosts, not statically scannable.`, { broadcast: label }); continue; }
    if (item.playback_mode === 'sermon')  { add('info', 'sermon_live',  `'${label}' is a sermon — a fresh service is assembled from the live news feed each in-game day, not statically scannable.`, { broadcast: label }); continue; }
    if (item.playback_mode === 'gameshow'){ add('info', 'gameshow_live', `'${label}' is a game show — a fresh episode of lots is dealt from the live item catalog each day and played out on the studio floor, not statically scannable.`, { broadcast: label }); continue; }
    let graph = item.broadcast_graph;
    if (!graph) continue;
    if (typeof graph === 'string') { try { graph = JSON.parse(graph); } catch { add('error', 'bad_graph', `'${label}' has an unparseable broadcast graph.`, { broadcast: label }); continue; } }
    const norm = _normalizeBroadcastGraph(graph);
    if (!norm?._start || !norm.nodes?.[norm._start]) add('error', 'no_start', `'${label}' has no valid start node.`, { broadcast: label });
    scanned++;
    for (const [nid, node] of Object.entries(norm.nodes || {})) {
      const d = node.data || {};
      if (!KNOWN_BROADCAST_NODES.has(node.type)) { add('warn', 'unknown_node', `'${label}': unknown node type '${node.type}' will be skipped on air.`, { broadcast: label, node: nid }); continue; }
      const gid = (node.type === 'title_card' || node.type === 'overlay' || node.type === 'show_overlay') ? d.graphic_id : null;
      if (gid && !graphicsCache.has(gid)) add('warn', 'missing_graphic', `'${label}': graphic '${gid}' not found — the card will be skipped.`, { broadcast: label, node: nid });
      if (node.type === 'music' && d.song && !getSongDefByName(d.song) && !getSampleDefByName(d.song)) add('info', 'missing_song', `'${label}': song '${d.song}' not found — falls back to cue text or is skipped.`, { broadcast: label, node: nid });
      if (node.type === 'npc_anchor' && d.npc_id && !world.npcs?.has(d.npc_id)) add('warn', 'missing_npc', `'${label}': host NPC '${d.npc_id}' does not exist.`, { broadcast: label, node: nid });
      if (node.type === 'camera_cut' && d.zone_id && !getZone(d.zone_id)) add('warn', 'missing_zone', `'${label}': camera-cut zone '${d.zone_id}' does not exist.`, { broadcast: label, node: nid });
    }
  }

  return {
    channel: { id: ch.id, name: ch.name, number: ch.number },
    slots: items.length,
    scanned,
    counts: {
      error: issues.filter(i => i.severity === 'error').length,
      warn:  issues.filter(i => i.severity === 'warn').length,
      info:  issues.filter(i => i.severity === 'info').length,
    },
    issues,
    log: (broadcastLog.get(channelId) || []).slice(-60),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function devOk(auth) {
  return auth && ['dev', 'admin', 'builder', 'designer'].includes(auth.role);
}

function broadcastDuration(bc) {
  // A film occupies its whole screening block, and this is the ONE mode whose
  // override_duration must not be believed: `@length` is the picture's REAL runtime
  // (150 minutes of somebody's evening), while a slot is measured in in-game seconds.
  // Taken literally it would reserve 2.5 in-game hours for a 2.5-real-hour feature,
  // which is only the same thing at timeScale 1. Checked before override_duration for
  // exactly that reason. See the film branch in getCurrentMessage.
  if (bc.playback_mode === 'film') return sportsSlotMs() / 1000;
  if (bc.override_duration) return bc.override_duration;
  // Weather graphs are assembled live from the forecast (not baked in the DB), so
  // there's nothing to measure here — give the slot a sane default airtime.
  if (bc.playback_mode === 'weather') return 120;
  // Sports runs one deterministic game per hour on the shared global clock, so a slot
  // reserves the full game window (a scheduled placement covers the whole hour). The
  // airing seeks into whatever game the clock says is on right now, regardless.
  if (bc.playback_mode === 'sports') return sportsSlotMs() / 1000;
  // News assembles a fresh bulletin from the live news generator each airing (nothing
  // baked in the DB to measure) — give the slot a sane default airtime.
  if (bc.playback_mode === 'news') return 180;
  // A talk show assembles a fresh episode each night and airs across its whole @airtime
  // block, so a slot reserves the full in-game 3-hour window (same as a sports slot).
  if (bc.playback_mode === 'talkshow') return sportsSlotMs() / 1000;
  // A morning show assembles today's episode from the live world (nothing baked to measure).
  // Its real airtime is whatever daily slot it sits in; this is only the unscheduled default.
  if (bc.playback_mode === 'morning') return 240;
  // A service is assembled live from the week's feed — nothing baked to measure.
  if (bc.playback_mode === 'sermon') return 900;
  // A game show plays out across its whole @airtime block, like the talk show — the
  // rounds are paced by the host's patter, not by a slot length baked in the DB.
  if (bc.playback_mode === 'gameshow') return sportsSlotMs() / 1000;
  if (bc.broadcast_graph) {
    const d = _vineDuration(bc.broadcast_graph, bc.message_interval || 5);
    if (d > 0) return d;
  }
  const count = Array.isArray(bc.messages) ? bc.messages.length : 0;
  return count * (bc.message_interval || 5);
}

function _vineDuration(graph, interval) {
  if (!graph?._start || !graph?.nodes) return 0;
  let total = 0, nodeId = graph._start;
  const seen = new Set();
  while (nodeId && !seen.has(nodeId)) {
    seen.add(nodeId);
    const node = graph.nodes[nodeId];
    if (!node) break;
    if (node.type === 'say' || node.type === 'ticker') total += interval;
    else if (node.type === 'wait') total += node.data?.seconds ?? 5;
    else if (node.type === 'credits') total += node.data?.duration ?? 10;
    else if (node.type === 'title_card') total += node.data?.theme ? Math.max(_themeDurationMs(node.data.theme) / 1000, node.data?.duration ?? 10) : (node.data?.duration ?? 10);
    else if (node.type === 'music') total += 8;
    nodeId = node.next ?? null;
  }
  return total;
}

// Styles whose text is raw markup (SVG / ASCII / credits card) — a device prefix glued
// on front corrupts the graphic (breaks the client's SVG sizing, prints a stray label).
const GRAPHIC_STYLES = new Set(['svg', 'ascii_art', 'credits']);

// Decide how a stored graphic renders from its actual CONTENT, not its `type`
// column (which is easy to mislabel in the editor / on import). Anything that
// opens with an <svg> tag is SVG; everything else is monospace ASCII art. Without
// this, an ASCII card saved as type 'svg' renders via innerHTML in a plain div —
// whitespace collapses and the box-art turns to mush — and an SVG saved as
// 'ascii' shows its raw markup as text. Sniffing the content sidesteps both.
function graphicStyle(graphic) {
  if (!graphic) return 'ascii_art';
  return /^\s*<svg[\s>]/i.test(graphic.content || '') ? 'svg' : 'ascii_art';
}

function formatMessage(text, deviceType, zone, style) {
  if (!text) return null;
  if (GRAPHIC_STYLES.has(style)) return text; // pass graphic content through unprefixed
  switch (deviceType) {
    case 'radio':
      return `[Radio] ${text}`;
    case 'security_monitor': {
      const ts = new Date().toTimeString().slice(0, 8);
      const loc = zone ? zone.name : 'UNKNOWN';
      return `[FEED — ${loc}] ${ts} — ${text}`;
    }
    default:
      return text;
  }
}

// ── Channel runtime loader ───────────────────────────────────────────────────

async function loadChannelRuntimes() {
  try {
    const { rows: channels } = await query(
      `SELECT c.*, b.messages AS idle_messages, b.message_interval AS idle_interval,
              t.id AS theme_id, t.name AS theme_name, t.preset AS theme_preset,
              t.bg_color, t.border_color, t.text_color, t.header_color,
              t.accent_color, t.live_color, t.ticker_color, t.scanlines
         FROM media_channels c
         LEFT JOIN media_broadcasts b ON b.id = c.idle_broadcast_id
         LEFT JOIN media_themes t ON t.id = c.theme_id
        WHERE c.enabled = 1 ORDER BY c.number`
    );
    const { rows: playlist } = await query(
      `SELECT p.*, b.name AS broadcast_name, b.playback_mode, b.messages, b.message_interval, b.override_duration, b.loop, b.broadcast_graph, b.fallback_messages, b.weather_pools, b.sports_pools, b.news_pools, b.talkshow_pools, b.morning_pools, b.gameshow_pools, b.sermon_pools
         FROM media_channel_playlist p
         LEFT JOIN media_broadcasts b ON b.id = p.broadcast_id
        ORDER BY p.channel_id, p.start_time`
    );
    const { rows: cams } = await query(
      'SELECT id, zone_id, streaming_channel_id FROM media_cameras WHERE is_streaming = 1 AND is_powered = 1'
    );
    const { rows: allCams } = await query(
      'SELECT id, zone_id, direction, is_powered, is_damaged FROM media_cameras ORDER BY zone_id, id'
    );
    cameraZoneStatus.clear();
    zoneCameras.clear();
    for (const cam of allCams) {
      const working = !!cam.is_powered && !cam.is_damaged;
      if (working) cameraZoneStatus.set(cam.zone_id, true);
      else if (!cameraZoneStatus.has(cam.zone_id)) cameraZoneStatus.set(cam.zone_id, false);
      if (!working) continue;
      const list = zoneCameras.get(cam.zone_id) || [];
      list.push({ id: cam.id, direction: cam.direction || 'all', label: _cameraLabel(cam.id, list.length) });
      zoneCameras.set(cam.zone_id, list);
    }
    // An ad is a BROADCAST, not a list of lines: its graph is what carries the title
    // card, the jingle riding that card, and each line's own hold. Loading only
    // `messages` (as this did) threw all of that away the moment the ad aired in a
    // break — the logo card never came up at all, and every line got a flat 5s.
    const { rows: allCommercials } = await query(
      `SELECT id, messages, message_interval, broadcast_graph, override_duration
         FROM media_broadcasts WHERE category = 'advertisement'`
    );
    const commercialMap = new Map();
    for (const ad of allCommercials) {
      const messages = Array.isArray(ad.messages) ? ad.messages : (ad.messages ? JSON.parse(ad.messages) : []);
      const interval = ad.message_interval || 5;
      let graph = ad.broadcast_graph;
      if (typeof graph === 'string') { try { graph = JSON.parse(graph); } catch { graph = null; } }
      graph = (graph && typeof graph === 'object') ? _normalizeBroadcastGraph(graph) : null;
      if (graph && !graph.nodes?.[graph._start]) graph = null;
      if (graph) {
        // _normalizeBroadcastGraph strips _broadcastId, so stamp it after. An ad is
        // pre-recorded film: _adBreak keeps it out of the live-acted path, so a break
        // on a live channel never demands a host on the studio floor to run it.
        graph._broadcastId = `commercial:${ad.id}`;
        graph._adBreak = true;
      }
      // Runtime the rotation paces off — the ad's real on-air length, title-card holds
      // included, so the next ad starts when this one actually finishes.
      const graphSec = graph ? (ad.override_duration || _graphDurationSec(graph)) : 0;
      commercialMap.set(ad.id, {
        id: ad.id,
        messages,
        message_interval: interval,
        graph,
        durationSec: graphSec > 0 ? graphSec : messages.length * interval,
      });
    }

    const cameraByChannel = new Map();
    for (const cam of cams) {
      if (cam.streaming_channel_id) cameraByChannel.set(cam.streaming_channel_id, cam);
    }

    // Each channel's transmitter (media deck): where it physically sits, so the
    // tick can check its zone still has power. No deck → the channel can't transmit.
    const { rows: deckRows } = await query(
      `SELECT flags->>'channel_id' AS channel_id, zone_id FROM furniture WHERE flags->>'media_deck'='true'`
    );
    const deckZoneByChannel = new Map();
    for (const d of deckRows) if (d.channel_id && !deckZoneByChannel.has(d.channel_id)) deckZoneByChannel.set(d.channel_id, d.zone_id);

    const playlistByChannel = new Map();
    for (const item of playlist) {
      if (!playlistByChannel.has(item.channel_id)) playlistByChannel.set(item.channel_id, []);
      const naturalDur = broadcastDuration(item);
      const dur = item.duration_override || naturalDur;
      let broadcastGraph = item.broadcast_graph;
      if (broadcastGraph && typeof broadcastGraph === 'object') {
        broadcastGraph = _normalizeBroadcastGraph({ ...broadcastGraph, _broadcastId: item.broadcast_id });
      } else if (typeof broadcastGraph === 'string') {
        try { broadcastGraph = _normalizeBroadcastGraph({ ...JSON.parse(broadcastGraph), _broadcastId: item.broadcast_id }); } catch { broadcastGraph = null; }
      } else {
        broadcastGraph = null;
      }
      const cond = typeof item.conditions === 'object' ? item.conditions : (item.conditions ? JSON.parse(item.conditions) : {});
      let weatherScript = item.weather_pools;
      if (typeof weatherScript === 'string') { try { weatherScript = JSON.parse(weatherScript); } catch { weatherScript = null; } }
      let sportsScript = item.sports_pools;
      if (typeof sportsScript === 'string') { try { sportsScript = JSON.parse(sportsScript); } catch { sportsScript = null; } }
      let newsScript = item.news_pools;
      if (typeof newsScript === 'string') { try { newsScript = JSON.parse(newsScript); } catch { newsScript = null; } }
      let talkshowScript = item.talkshow_pools;
      if (typeof talkshowScript === 'string') { try { talkshowScript = JSON.parse(talkshowScript); } catch { talkshowScript = null; } }
      let morningScript = item.morning_pools;
      if (typeof morningScript === 'string') { try { morningScript = JSON.parse(morningScript); } catch { morningScript = null; } }
      let sermonScript = item.sermon_pools;
      if (typeof sermonScript === 'string') { try { sermonScript = JSON.parse(sermonScript); } catch { sermonScript = null; } }
      let gameshowScript = item.gameshow_pools;
      if (typeof gameshowScript === 'string') { try { gameshowScript = JSON.parse(gameshowScript); } catch { gameshowScript = null; } }
      playlistByChannel.get(item.channel_id).push({
        id: item.id,
        broadcastId: item.broadcast_id,
        broadcastName: item.broadcast_name || null,
        slotType: item.slot_type || 'broadcast',
        startTime: item.start_time,
        duration: dur,
        // Which weekdays this slot airs, and the manual tiebreak — see _pickDailySlot.
        days: _dayMask(item.days),
        priority: item.priority || 0,
        playback_mode: item.playback_mode,
        // A film's REAL runtime (@length). Not a slot length — it's how the runner knows
        // the picture has finished before its reserved blocks have.
        filmRuntime: item.playback_mode === 'film' ? (item.override_duration || null) : null,
        // Where THIS showing began, stamped on every row of the run by ensureFilmSlots.
        filmRunStart: Number.isFinite(cond?.film_run_start) ? cond.film_run_start : null,
        weatherPools: weatherScript?.pools || null,
        weatherHost: weatherScript?.host || null,
        weatherTitle: weatherScript?.title || null,
        sportsScript: sportsScript || null,
        newsScript: newsScript || null,
        talkshowScript: talkshowScript || null,
        morningScript: morningScript || null,
        gameshowScript: gameshowScript || null,
        sermonScript: sermonScript || null,
        messages: Array.isArray(item.messages) ? item.messages : (item.messages ? JSON.parse(item.messages) : []),
        message_interval: item.message_interval || 5,
        loop: item.loop,
        broadcastGraph,
        passDuration: broadcastGraph ? naturalDur : null,
        fallbackMessages: Array.isArray(item.fallback_messages) ? item.fallback_messages : (item.fallback_messages ? JSON.parse(item.fallback_messages) : []),
        npcStaff: Array.isArray(cond?.npc_staff) ? cond.npc_staff : [],
      });
    }

    channelRuntime.clear();
    studioZoneIndex.clear();
    for (const ch of channels) {
      if (ch.studio_zone_id) studioZoneIndex.set(ch.studio_zone_id, ch.id);
      const pl = playlistByChannel.get(ch.id) || [];
      // Studio staffing only applies to LIVE channels, WEATHER forecasts, TALK SHOWS,
      // MORNING SHOWS and GAME SHOWS (all acted on-stage and presence-gated). A scripted
      // show's npc_anchor nodes are speaker attribution, not a cue for the NPC to appear
      // on-stage — so the AI schedule/studio lookups must never see them as staff.
      // Talk-show, morning-show and game-show items carry their own cast regardless of
      // the channel's declared type.
      const ACTED_MODES = new Set(['weather', 'talkshow', 'morning', 'gameshow']);
      for (const it of pl) {
        if (ch.channel_type !== 'live' && !ACTED_MODES.has(it.playback_mode)) it.npcStaff = [];
      }
      const totalDuration = pl.length
        ? Math.max(...pl.map(i => i.startTime + i.duration))
        : 0;
      const idleMsgs = ch.idle_messages ? (Array.isArray(ch.idle_messages) ? ch.idle_messages : JSON.parse(ch.idle_messages)) : [];
      const commercialPool = ch.commercial_pool ? (Array.isArray(ch.commercial_pool) ? ch.commercial_pool : JSON.parse(ch.commercial_pool)) : [];
      channelRuntime.set(ch.id, {
        channelId: ch.id,
        name: ch.name,
        stationName: ch.station_name || ch.name,
        number: ch.number,
        channelType: ch.channel_type,
        newsCategories: Array.isArray(ch.news_categories) ? ch.news_categories : (ch.news_categories ? JSON.parse(ch.news_categories) : []),
        playlist: pl,
        totalDuration,
        idleBroadcast: idleMsgs.length ? { messages: idleMsgs, message_interval: ch.idle_interval || 5 } : null,
        camera: cameraByChannel.get(ch.id) || null,
        scheduleMode: ch.schedule_mode || 'loop',
        studioZoneId: ch.studio_zone_id || null,
        deckZoneId: deckZoneByChannel.get(ch.id) || null,
        offlineGraphicId: ch.offline_graphic_id || null,
        commercialPool,
        commercialBroadcasts: commercialPool.map(id => commercialMap.get(id)).filter(Boolean),
        loopOriginMs: Date.now(),
        lastMsgKey: '',
        wasActive: false,
        currentFallbackMessages: [],
        graphBlackboard: { currentNode: null, waitUntil: null, npcAnchor: null, npcAnchorId: null, activeBroadcastId: null, hostAbsent: false, absentDetectedAt: null, techDiffMode: false },
        theme: ch.theme_id ? {
          id: ch.theme_id,
          name: ch.theme_name,
          preset: ch.theme_preset,
          bg_color: ch.bg_color,
          border_color: ch.border_color,
          text_color: ch.text_color,
          header_color: ch.header_color,
          accent_color: ch.accent_color,
          live_color: ch.live_color,
          ticker_color: ch.ticker_color,
          scanlines: ch.scanlines,
        } : null,
      });
      newsQueue.set(ch.id, []);
    }
  } catch (err) {
    console.error('[broadcast] loadChannelRuntimes error:', err.message);
  }
}

async function loadGraphicsCache() {
  try {
    const { rows } = await query('SELECT id, name, type, content FROM media_graphics');
    graphicsCache.clear();
    for (const row of rows) graphicsCache.set(row.id, row);
  } catch (err) {
    console.error('[broadcast] loadGraphicsCache error:', err.message);
  }
}

async function loadZoneTunings() {
  try {
    const { rows } = await query(
      `SELECT f.id, f.zone_id, f.flags,
              c.id AS channel_id
         FROM furniture f
         JOIN media_channels c ON c.number = (f.flags->>'tuned_channel')::int
        WHERE f.flags->>'tuned_channel' IS NOT NULL
          AND c.enabled = 1`
    );
    zoneTunings.clear();
    furnitureChannelIndex.clear();
    for (const row of rows) {
      if (!row.zone_id || !row.channel_id) continue;
      const flags = typeof row.flags === 'object' ? row.flags : JSON.parse(row.flags || '{}');
      const deviceType = flags.broadcast_device_type || flags['broadcast_device_type'] || 'tv';
      if (!zoneTunings.has(row.zone_id)) zoneTunings.set(row.zone_id, new Map());
      zoneTunings.get(row.zone_id).set(row.channel_id, deviceType);
      furnitureChannelIndex.set(row.id, { zoneId: row.zone_id, channelId: row.channel_id, deviceType,
        skin: flags.tv_skin || 'crt',
        dialFrequency: typeof flags.tv_dial_freq === 'number' ? flags.tv_dial_freq : (parseFloat(flags.tuned_channel) || 0) });
    }
  } catch (err) {
    console.error('[broadcast] loadZoneTunings error:', err.message);
  }
}

// ── Current message computation ──────────────────────────────────────────────

function getScriptedMessage(messages, messageInterval, elapsedSec) {
  if (!messages || !messages.length) return null;
  const idx = Math.floor(elapsedSec / (messageInterval || 5));
  if (idx >= messages.length) return null;
  const m = messages[idx];
  return { text: typeof m === 'string' ? m : m.text, idx };
}

// ── Live delivery: an impaired actor doesn't read the script ────────────────
// Every line is still ATTEMPTED live. What comes out of the actor's mouth is
// another matter. This reads the performer's actual physical state — the dose on
// their AI blackboard (plugins/npc-drugs) and any drink in them — and degrades the
// delivery accordingly, in the Paul Masson register: not just slurring, but losing
// the thread, repeating a word, asking for the line back, going off-script. The
// script is what they meant to say; this is what aired.

// 0 (sharp) → 1 (unbroadcastable). `out` is its own case — they can't perform at all.
function _actorImpairment(npcId) {
  const npc = npcId && world.npcs?.get(npcId);
  if (!npc) return { level: 0, out: false };
  const dose = npc._ai?.dose;
  // Drink is a meter; a dose is a state. Take whichever is doing more damage.
  let level = Math.max(0, Math.min(1, (npc.intoxication || 0) / 100));
  if (dose?.out) return { level: 1, out: true };
  if (dose?.loose)    level = Math.max(level, 0.65);
  if (dose?.paranoid) level = Math.max(level, 0.8);
  if (dose?.wired)    level = Math.max(level, 0.4);
  return { level, out: false };
}

const _FUMBLE = [
  'uh —', 'that is —', 'well —', 'hold on —', 'no, wait —', "let's — let's go again —",
];
const _OFFSCRIPT = [
  "...what is that? What does that even mean?",
  "...I'm not saying that. Give me the other one.",
  "...are we rolling? Are we still rolling?",
  "...no. No, that's not — start me again.",
  "...I can't read this. Who wrote this?",
];

// Mangle a line for airtime. Deterministic in shape (always visibly degraded above
// the floor) but randomised in detail so repeat viewings differ.
function _garbleLine(text, level) {
  if (!text || level < 0.3) return text;
  const p = Math.min(1, (level - 0.3) / 0.6);   // 0 at the floor, 1 at wrecked
  let words = String(text).split(' ');

  // Repeat a word — the drunk's stall while the next one arrives.
  if (Math.random() < 0.35 + p * 0.5 && words.length > 2) {
    const i = 1 + Math.floor(Math.random() * (words.length - 1));
    words.splice(i, 0, words[i]);
  }
  // Trip over the start of a clause.
  if (Math.random() < 0.25 + p * 0.5 && words.length > 3) {
    const i = 1 + Math.floor(Math.random() * (words.length - 2));
    words.splice(i, 0, _FUMBLE[Math.floor(Math.random() * _FUMBLE.length)]);
  }
  let out = words.join(' ');
  // Consonants go soft.
  out = out.replace(/s/g, (m) => (Math.random() < p * 0.5 ? 'sh' : m));
  // Deep enough in, the line doesn't survive to its own full stop.
  if (p > 0.55 && Math.random() < p * 0.7) {
    const cut = out.split(' ');
    out = cut.slice(0, Math.max(2, Math.floor(cut.length * (0.4 + Math.random() * 0.3)))).join(' ')
        + ' ' + _OFFSCRIPT[Math.floor(Math.random() * _OFFSCRIPT.length)];
  }
  // Never silently a no-op once we're past the floor.
  if (out === text) out = text.replace(/\s/, ' ... ');
  return out;
}

// A performer too far gone to deliver anything — the take dies on the studio floor.
const _COLLAPSE = [
  'stares into the lens for a long moment and says nothing at all.',
  'opens their mouth, thinks better of it, and just breathes.',
  'has lost the script. It is on the floor. So, increasingly, are they.',
  'gestures at something off-camera and does not finish the gesture.',
];

function buildCameraSnapshot(zoneId) {
  const zone = getZone(zoneId);
  if (!zone) return null;
  const players = getZonePlayers(zoneId);
  const npcs = getZoneNpcs(zoneId);
  const enemies = getZoneEnemies(zoneId);
  const parts = [zone.description ? zone.description.split('.')[0] + '.' : zone.name];
  const visible = [
    ...players.map(p => p.handle),
    ...npcs.map(n => n.name),
    ...enemies.map(e => e.name),
  ];
  if (visible.length) parts.push(`Visible: ${visible.join(', ')}.`);
  return parts.join(' ');
}

// On-air length of one pass of a NORMALIZED graph, in seconds — measured with the
// walker's own nodeHoldMs, so a title card's hold is counted as the airtime it really
// takes. Ads are linear chains; a branch is followed down its 'next' port only.
function _graphDurationSec(graph) {
  if (!graph?._start || !graph.nodes) return 0;
  const edges = graph.edges || [];
  let id = graph._start, total = 0;
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const node = graph.nodes[id];
    if (!node) break;
    if (node.type !== 'start') total += nodeHoldMs(node);
    id = _resolveEdge(edges, id, 'next');
  }
  return total / 1000;
}

// One ad's runtime — its graph's measured length, or (no graph) lines × interval.
function _adDurationSec(ad) {
  if (ad?.durationSec > 0) return ad.durationSec;
  return (ad?.messages?.length || 0) * (ad?.message_interval || 5);
}

// Which ad in the pool is on at `posSec` into the pool, and how far into that ad we
// are. Deterministic, so every TV in the world is watching the same ad at the same
// second — the old round-robin counters drifted per channel.
function _adAt(ads, posSec) {
  let t = 0;
  for (let i = 0; i < ads.length * 4; i++) {
    const ad = ads[i % ads.length];
    const dur = _adDurationSec(ad);
    if (dur <= 0) continue;
    if (posSec < t + dur) return { ad, offset: posSec - t };
    t += dur;
  }
  return null;
}

// Air one beat of `ad` at `offset` seconds into it. A graph ad plays as authored —
// title card, jingle, per-line holds — by ticking its own graph, seeking to `offset`
// so a viewer who tunes in mid-ad lands where the ad actually is. `pass` distinguishes
// one airing from the next so the blackboard resets and the ad restarts from its card.
function _airAd(ad, offset, pass, state, nowMs) {
  if (ad.graph && state?.channelId) {
    const graph = ad.graph;
    const id = `commercial:${ad.id}:${pass}`;
    if (graph._broadcastId !== id) graph._broadcastId = id;
    return tickBroadcastGraph(state.channelId, graph, state, nowMs, offset);
  }
  if (!ad.messages?.length) return null;
  const result = getScriptedMessage(ad.messages, ad.message_interval || 5, offset);
  return result ? { text: result.text, key: `commercial:${ad.id}:${result.idx}` } : null;
}

// A commercial break: walk the pool on the wall clock.
function _playCommercial(state, nowMs) {
  const ads = state.commercialBroadcasts || [];
  if (!ads.length) return null;
  const poolSec = ads.reduce((s, ad) => s + _adDurationSec(ad), 0);
  if (poolSec <= 0) return null;
  const nowSec = nowMs / 1000;
  const at = _adAt(ads, nowSec % poolSec);
  if (!at) return null;
  return _airAd(at.ad, at.offset, Math.floor(nowSec / poolSec), state, nowMs);
}

// Walk a commercial pool back-to-back starting `tail` seconds into the pool,
// wrapping around as needed. Shared by the flat-list and VINE-graph loop-fill
// paths below — the caller is responsible for only invoking this while still
// inside the slot's own window, so an ad is simply cut off (never restarted)
// the moment the slot ends and the outer scheduler moves to what's next.
// `state`/`nowMs` are optional: without them a graph ad falls back to its flat
// lines rather than airing nothing.
function _fillCommercialTail(tail, ads, state = null, nowMs = 0) {
  if (!ads.length) return null;
  const at = _adAt(ads, tail);
  if (!at) return null;
  return _airAd(at.ad, at.offset, 0, state, nowMs);
}

// Shared item.loop=1 gate: once a full pass of `graph` (one-pass length `passDur`)
// wouldn't fit again before the slot ends, park the graph — resetting its blackboard
// so it restarts from the top next time this slot airs, rather than resuming mid-pass
// — and hand back a commercial-tail message. Returns undefined when not gated, meaning
// the caller should proceed and tick the graph as normal.
function _loopFillOrNull(state, item, graph, segElapsed, passDur) {
  if (!item.loop || !(passDur > 0)) return undefined;
  const passesAvailable = Math.max(1, Math.floor(item.duration / passDur));
  const showWindow = passesAvailable * passDur;
  if (segElapsed < showWindow) return undefined;
  const bb = state.graphBlackboard;
  if (bb && bb.activeBroadcastId === graph._broadcastId) {
    bb.currentNode = null;
    bb.waitUntil = null;
    bb.activeBroadcastId = null;
  }
  // The show's graph is parked, so its blackboard is free for the ad's own graph to
  // use — the tail plays real commercials, cards and all.
  return _fillCommercialTail(segElapsed - showWindow, state.commercialBroadcasts || [], state, nowMs);
}

// item.loop=1 flat-message slot: repeat the show to fill its slot, but only
// repeat a pass that will actually finish before the slot ends — the leftover
// tail plays commercials (cut off cleanly when the slot's own end arrives).
function _fillLoopSlot(item, segElapsed, ads) {
  const cycleDur = item.messages.length * (item.message_interval || 5);
  if (cycleDur <= 0) return null;
  if (!item.loop) {
    const result = getScriptedMessage(item.messages, item.message_interval, segElapsed);
    return result ? { text: result.text, key: `${item.broadcastId}:${result.idx}`, programName: item.broadcastName || null } : null;
  }
  const passesAvailable = Math.max(1, Math.floor(item.duration / cycleDur));
  const showWindow = passesAvailable * cycleDur;    // time budget for full passes only
  if (segElapsed < showWindow) {
    const result = getScriptedMessage(item.messages, item.message_interval, segElapsed % cycleDur);
    return result ? { text: result.text, key: `${item.broadcastId}:${result.idx}`, programName: item.broadcastName || null } : null;
  }
  const filled = _fillCommercialTail(segElapsed - showWindow, ads);
  return filled ? { ...filled, programName: item.broadcastName || null } : null;
}

// ── Weather broadcasts ────────────────────────────────────────────────────────
// A weather broadcast (playback_mode 'weather') stores line pools instead of a
// baked graph. Each airing we read the live 7-day forecast and assemble a fresh
// VINE graph: the weathercaster greets, covers today, walks the week, warns on
// severe days, signs off — one random line per matching pool, {tokens} filled
// from the forecast. The assembled graph is cached on the playlist item and
// re-rolled only when the forecast's lead day advances (the date is folded into
// the graph's _broadcastId so the walker's blackboard resets cleanly).
// Spec: docs/bsm-format.md#weather-broadcasts-type-weather.

const WX_SEVERE = 0.45;                                    // matches the forecast panel's ⚠ band
const WX_WET = new Set(['rain', 'sleet', 'snow', 'thunderstorm', 'blizzard', 'storm']);
const WX_TEMP_BANDS = [                                    // first band whose ceiling the temp is under
  ['frigid', -10], ['cold', 3], ['cool', 12], ['mild', 20], ['warm', 28], ['hot', 36], ['scorching', Infinity],
];
const WX_DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function wxTempBand(t)  { return (WX_TEMP_BANDS.find(([, max]) => t < max) || WX_TEMP_BANDS[6])[0]; }
function wxWindBand(k)  { if (k == null) return null; return k < 6 ? 'calm' : k < 20 ? 'breezy' : k < 39 ? 'windy' : k < 62 ? 'strong' : 'gale'; }
function wxWindLabel(k) { return { calm: 'Calm', breezy: 'Breezy', windy: 'Windy', strong: 'Strong', gale: 'Gale' }[wxWindBand(k)] || ''; }
function wxHumidBand(h) { if (h == null) return null; return h < 35 ? 'dry' : h <= 65 ? 'comfortable' : h <= 85 ? 'humid' : 'oppressive'; }

// A scheduled hero event outranks every ordinary severity read: whatever the
// temperature and wind say, the story of an acid day is the acid. The pool
// suffix comes off the forecast row (weather plugin's `present` block), so a
// future hero event needs new `.bsm` pools and nothing else here.
const WX_EVENT_POOL = { acid_rain: 'acid', ion_storm: 'ion' };

// A hero day is reported as itself: `sky.acid` / `sky.ion` rather than the
// ordinary weather type sitting underneath it, and it is ALWAYS severe enough to
// earn a warning regardless of what temperature and wind alone would score.
function wxSkyPool(d) { return (d.heroEvent && WX_EVENT_POOL[d.heroEvent]) || d.weatherType; }
function wxIsSevere(d) { return !!(d.heroEvent && WX_EVENT_POOL[d.heroEvent]) || (d.severity ?? 0) >= WX_SEVERE; }

function wxSevereChannel(d) {
  if (d.heroEvent && WX_EVENT_POOL[d.heroEvent]) return WX_EVENT_POOL[d.heroEvent];
  if (d.weatherType === 'blizzard') return 'blizzard';
  if (d.weatherType === 'thunderstorm' || d.weatherType === 'storm') return 'storm';
  if (d.tempC <= -12) return 'cold';
  if (d.tempC >= 38) return 'heat';
  if ((d.windKph ?? 0) >= 62) return 'wind';
  return 'generic';
}
function wxDayLabel(i, date) {
  if (i === 0) return 'today';
  if (i === 1) return 'tomorrow';
  try { return WX_DOW[new Date(`${date}T00:00:00Z`).getUTCDay()]; } catch { return `day ${i}`; }
}
function wxLeadKey(i) { return i === 1 ? 'tomorrow' : i <= 4 ? 'midweek' : i <= 6 ? 'weekend' : 'next'; }
function wxTimeOfDayKey(env) {
  const h = env.hour ?? 12;
  return h >= 5 && h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
}
function wxTrendKey(fc) {
  const first = fc[0].tempC, last = fc[fc.length - 1].tempC;
  const severeAhead = fc.slice(1).some(f => (f.severity ?? 0) >= WX_SEVERE);
  if (severeAhead && last <= first) return 'deteriorating';
  if (WX_WET.has(fc[0].weatherType) && !WX_WET.has(fc[fc.length - 1].weatherType)) return 'clearing';
  if (last - first >= 5) return 'warming';
  if (first - last >= 5) return 'cooling';
  if (severeAhead) return 'deteriorating';
  return 'steady';
}
function wxPick(pools, ...keys) {
  for (const k of keys) {
    const arr = pools[k];
    if (Array.isArray(arr) && arr.length) return arr[Math.floor(Math.random() * arr.length)];
  }
  return null;
}
function wxFill(line, tok, unknown) {
  return line.replace(/\{(\w+)\}/g, (_, k) => {
    if (tok[k] !== undefined && tok[k] !== null) return String(tok[k]);
    unknown.add(k);
    return '';
  });
}
function wxTokens(day, i, week, env) {
  return {
    weather: (day.weatherType || '').replace(/_/g, ' '),
    temp: Math.round(day.tempC),
    feels: i === 0 && env.feelsLikeC != null ? Math.round(env.feelsLikeC) : Math.round(day.tempC),
    wind: day.windKph ?? 0,
    windLabel: wxWindLabel(day.windKph),
    humidity: day.humidityPct ?? '',
    precip: Math.round((day.precipChance ?? 0) * 100),
    day: wxDayLabel(i, day.date),
    date: (day.date || '').slice(5),
    hiTemp: week.hi, loTemp: week.lo, season: env.season || '',
    severeCount: week.severeCount, worstDay: week.worstDay, host: week.hostName,
  };
}

function assembleWeatherGraph(pools, hostId, forecast, env, broadcastId, titleId) {
  const nodes = {};
  let n = 0, prevId = null, startId = null;
  const unknown = new Set();
  const add = (data) => {
    const id = `wx_${n++}`;
    nodes[id] = { ...data };
    if (prevId) nodes[prevId].next = id;
    if (startId === null) startId = id;
    prevId = id;
    return id;
  };
  add({ type: 'start' });
  if (titleId) add({ type: 'title_card', graphic_id: titleId });   // show the show's title card first
  if (hostId) add({ type: 'npc_anchor', npc_id: hostId });

  const temps = forecast.map(f => Math.round(f.tempC));
  const worstIdx = forecast.reduce((best, f, i) => (f.severity ?? 0) > (forecast[best].severity ?? 0) ? i : best, 0);
  const week = {
    hi: Math.max(...temps), lo: Math.min(...temps),
    severeCount: forecast.filter(f => (f.severity ?? 0) >= WX_SEVERE).length,
    worstDay: wxDayLabel(worstIdx, forecast[worstIdx].date),
    hostName: world.npcs?.get(hostId)?.name || (hostId || '').replace(/^npc_/, '').replace(/_/g, ' '),
  };
  const say = (line, day, i, fallback) => {
    const src = line || fallback;
    if (!src) return;
    const text = wxFill(src, wxTokens(day, i, week, env), unknown).trim();
    if (text) add({ type: 'say', text, style: 'raw' });
  };

  const today = forecast[0];
  say(wxPick(pools, `intro.${wxTimeOfDayKey(env)}`, 'intro'), today, 0);
  say(wxPick(pools, 'today.lead'), today, 0);
  // A hero day is reported as ITSELF — sky.acid / sky.ion — not as whatever
  // ordinary weather happens to be underneath it.
  say(wxPick(pools, `sky.${wxSkyPool(today)}`), today, 0, 'Conditions right now: {weather}, {temp} degrees.');
  say(wxPick(pools, `temp.${wxTempBand(today.tempC)}`), today, 0);
  const twBand = wxWindBand(today.windKph);
  if (['calm', 'windy', 'strong', 'gale'].includes(twBand)) say(wxPick(pools, `wind.${twBand}`), today, 0);
  const thBand = wxHumidBand(today.humidityPct);
  if (thBand === 'dry' || thBand === 'oppressive') say(wxPick(pools, `humid.${thBand}`), today, 0);
  if (wxIsSevere(today)) say(wxPick(pools, `warn.${wxSevereChannel(today)}`, 'warn.generic'), today, 0);

  say(wxPick(pools, 'forecast.lead'), today, 0);
  for (let i = 1; i < forecast.length; i++) {
    const day = forecast[i];
    say(wxPick(pools, `ahead.${wxLeadKey(i)}`, 'ahead.next'), day, i);
    say(wxPick(pools, `sky.${wxSkyPool(day)}`), day, i, '{day}: {weather}, around {temp} degrees.');
    if (wxIsSevere(day)) say(wxPick(pools, `warn.${wxSevereChannel(day)}`, 'warn.generic'), day, i);
  }

  say(wxPick(pools, `trend.${wxTrendKey(forecast)}`), today, 0);
  say(wxPick(pools, 'outro'), today, 0);

  if (unknown.size) console.warn('[broadcast] weather: unknown tokens', [...unknown]);
  // When the chain ends the walker restarts at _start on its own (currentNode → null
  // → _start), so the report loops without an explicit loop node.
  // _normalizeBroadcastGraph strips _broadcastId, so stamp it after: folding the
  // forecast date in makes the walker reset (re-roll) when the lead day advances.
  const graph = _normalizeBroadcastGraph({ _start: startId, nodes });
  graph._broadcastId = `${broadcastId}:wx:${today.date}`;
  graph._requireHost = true;   // weather forecasts are acted live — the weathercaster must be in-studio
  return graph;
}

// Return the assembled graph for a weather playlist item, (re)building it when the
// forecast's lead day has advanced. Cached on the item between ticks.
function getWeatherGraph(item) {
  const env = getEnvironmentState();
  const forecast = env.forecast || [];
  if (!forecast.length || !item.weatherPools) return null;
  const date0 = forecast[0].date;
  if (!item._wxGraph || item._wxDate !== date0) {
    item._wxGraph = assembleWeatherGraph(item.weatherPools, item.weatherHost, forecast, env, item.broadcastId, item.weatherTitle);
    item._wxDate = date0;
  }
  return item._wxGraph;
}

// ── Sports broadcasts ─────────────────────────────────────────────────────────
// A sports broadcast (playback_mode 'sports') stores a line library plus team and
// player pools instead of a baked graph. Unlike weather — which reads a live feed —
// there is no game in the world, so each airing we SIMULATE a whole game: pick two
// teams, deal lineups, play nine innings of randomized at-bats while accumulating the
// score, then assemble a fresh play-by-play VINE graph from the matching line pools
// with {tokens} filled from the live game state. The announcer is a plain name spoken
// as narration (no npc_anchor); sports is NOT acted-live — no studio NPC, no presence
// gating. A new game is rolled each loop cycle, so the final score differs every
// airing. Only 'baseball' is implemented; @sport is the future extension point.
// Spec: docs/bsm-format.md#sports-broadcasts-type-sports.

const SPORTS_ORDINALS = ['0th', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th', '13th', '14th', '15th'];
function sportsOrdinal(n) { return SPORTS_ORDINALS[n] || `${n}th`; }

// ── Deterministic seeding ────────────────────────────────────────────────────
// The whole league is a pure function of wall-clock time: every game's outcome AND
// its play-by-play are generated from a seed, so all TVs render an identical game at
// the same instant and the standings can be recomputed from the seed alone (no
// per-game DB rows). The PRNG/hash/pick/fill/shuffle primitives live in ./rng.js —
// gameshow.js needs them too, and importing them from here would be circular.

// Team pool → display names (a team may be a bare string or an object with .name).
function sportsTeamNames(teams) {
  return (Array.isArray(teams) ? teams : []).map(t => (typeof t === 'string' ? t : t?.name)).filter(Boolean);
}

// ── SPORT REGISTRY ───────────────────────────────────────────────────────────
// Each sport's sim, colour synthesis and play labels live in ./sports/<name>.js.
// Everything LEFT in this file is sport-agnostic — the clock, the round robin, the
// standings fold, line pacing, the recap reel, the cache, the heartbeat.
//
// A script declares its sport with `@sport`, and that is the ONLY thing that
// selects a module. Nothing else in the pipeline should ever branch on the sport
// name; if it needs to, the descriptor is missing a field.
const SPORTS = { baseball: BASEBALL, hockey: HOCKEY };
const sportOf = (script) => SPORTS[script?.sport] || BASEBALL;
const sportsSimGame = (script, matchup, players, rand, opts) => sportOf(script).simGame(matchup, players, rand, opts);
const sportsPlayDesc = (script, beat) => sportOf(script).playDesc(beat);
const SPORTS_DEFAULT_NAMES = BASEBALL.defaultNames;

// ── The shared clock: one game an hour, the same one on every TV ──────────────
// Games run on a single global timeline keyed to wall-clock time, not per channel.
// The current game = a pure function of the slot index, so every tuned TV lands on the
// same game at the same beat, and tuning in mid-slot drops you into a game already in
// progress (the graph walker seeks by elapsed time). A "day" of SPORTS_GAMES_PER_DAY
// slots draws its matchups from a round-robin, so all teams play a balanced slate.
//
// REALISM IS MEASURED IN IN-GAME DAYS. A real league plays ~1 game per team per day, so
// we fix SPORTS_GAMES_PER_DAY games per IN-GAME day (8 = one round for 16 teams → each
// team once/day) and DERIVE the real-time slot length from the game clock: a slot is the
// real time of one in-game day (24h ÷ timeScale) split into that many games. So the
// cadence stays realistic whatever the world's clock speed — timeScale 1 → 3h games,
// timeScale 3 (8-hour day) → 1h games. (Read once, after the clock loads; if you change
// timeScale, restart and reset the season, since the slot size — and thus the standings
// window — is denominated in slots.)
const SPORTS_DAY_MS = 24 * 60 * 60 * 1000;             // real ms in one in-game day at timeScale 1
const SPORTS_GAMES_PER_DAY = 8;                        // games per IN-GAME day (one round for 16 teams)
const SPORTS_GAME_FILL = 0.85;                         // fraction of a slot the play-by-play fills (rest = post-game)
const SPORTS_SLOT_FALLBACK_MS = SPORTS_DAY_MS / SPORTS_GAMES_PER_DAY;   // 3h — used only before the clock loads
const SPORTS_SLOT_GAME_MIN = 1440 / SPORTS_GAMES_PER_DAY;   // in-game minutes per game (180 = a 3-in-game-hour block)

// THE LEAGUE RUNS ON THE IN-GAME CLOCK. A slot is an in-game 3-hour block, so slot N of
// the day maps to a FIXED in-game time (block 5 = 15:00–18:00 in-game) — that's what lets
// a "featured slot" air at a predictable time. And since every client reads the same
// server-authoritative in-game clock, all TVs land on the same game. Real time only enters
// to pace the broadcast (how fast the in-game slot plays out in real seconds).
function sportsInGameMinutes() {
  const env = getEnvironmentState();
  const d = (typeof env?.date === 'string' && env.date.length >= 10) ? env.date.slice(0, 10) : null;
  const dayNum = d ? Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000) : 0;
  return dayNum * 1440 + (Number.isFinite(env?.minutes) ? env.minutes : 0);
}
const sportsSlotIndex = () => Math.floor(sportsInGameMinutes() / SPORTS_SLOT_GAME_MIN);
const sportsSlotOfDay = () => ((sportsSlotIndex() % SPORTS_GAMES_PER_DAY) + SPORTS_GAMES_PER_DAY) % SPORTS_GAMES_PER_DAY;
// In-game minutes elapsed into the current slot (0..SPORTS_SLOT_GAME_MIN).
const sportsSlotElapsedMin = () => sportsInGameMinutes() - sportsSlotIndex() * SPORTS_SLOT_GAME_MIN;

// The slot's real-time DURATION (24h ÷ timeScale ÷ games) — how long the in-game block
// takes to play out in real seconds; drives pacing + betting resolve. Lazy-memoized once
// the clock loads (3h fallback before). If you change timeScale, restart + reset the season.
let _sportsSlotMs = null;
function sportsSlotMs() {
  if (_sportsSlotMs) return _sportsSlotMs;
  const env = getEnvironmentState();
  const ts = env?.timeScale;
  if (!ts || !env?.date) return SPORTS_SLOT_FALLBACK_MS;   // clock not ready yet — don't memoize a wrong value
  _sportsSlotMs = Math.max(BROADCAST_TICK_MS, Math.round((SPORTS_DAY_MS / ts) / SPORTS_GAMES_PER_DAY));
  return _sportsSlotMs;
}
// Real seconds already elapsed into the current slot — where the shared game "is" right
// now, so a viewer tuning in lands mid-game.
const sportsSegElapsedSec = () => (sportsSlotElapsedMin() / SPORTS_SLOT_GAME_MIN) * sportsSlotMs() / 1000;
// Real epoch-ms when the current slot's game ends (betting resolve / airing wrap).
const sportsSlotEndsAtMs = () => Date.now() + ((SPORTS_SLOT_GAME_MIN - sportsSlotElapsedMin()) / SPORTS_SLOT_GAME_MIN) * sportsSlotMs();

// Is a sports broadcast scheduled to air right now? `airSlots` (an array of slot-of-day
// indices 0..SPORTS_GAMES_PER_DAY-1) features ONLY those games each in-game day — one full
// game, grid-snapped, at a fixed in-game time. Empty/absent ⇒ continuous (every slot,
// back-to-back games).
function sportsAiring(script) {
  const slots = script?.airSlots;
  if (!Array.isArray(slots) || !slots.length) return true;
  return slots.includes(sportsSlotOfDay());
}

// Circle-method round-robin: for N teams (padded to even with a BYE), returns N-1
// rounds of N/2 index pairs, every team appearing once per round. Deterministic
// given N, so a day's schedule is reproducible from the day number alone.
function roundRobinRounds(n) {
  const even = n % 2 === 0 ? n : n + 1;               // pad odd rosters with a phantom BYE
  const arr = Array.from({ length: even }, (_, i) => i);
  const rounds = [];
  for (let r = 0; r < even - 1; r++) {
    const round = [];
    for (let i = 0; i < even / 2; i++) round.push([arr[i], arr[even - 1 - i]]);
    rounds.push(round);
    arr.splice(1, 0, arr.pop());                       // fix the first, rotate the rest
  }
  return rounds;
}

// The matchup airing in a given global slot. The day picks a deterministic team
// order + a rolling window into the round-robin so pairings vary day to day while
// staying balanced; home/away flips on a per-slot coin. A pairing that lands on the
// BYE (odd roster) is skipped to the next real one. Returns { away, home } or null.
function sportsMatchupForSlot(slot, teams) {
  const names = sportsTeamNames(teams);
  if (names.length < 2) return null;
  const day = Math.floor(slot / SPORTS_GAMES_PER_DAY);
  const slotOfDay = ((slot % SPORTS_GAMES_PER_DAY) + SPORTS_GAMES_PER_DAY) % SPORTS_GAMES_PER_DAY;
  const order = sportsShuffle(names, sportsRng(sportsHash(day, 0x5c4e))); // daily team order
  const rounds = roundRobinRounds(order.length);
  const gamesPerRound = rounds[0].length;
  const roundsPerDay = Math.max(1, Math.floor(SPORTS_GAMES_PER_DAY / gamesPerRound));
  // Walk from the slot's nominal pairing, skipping BYE games (index ≥ order.length).
  const total = rounds.length * gamesPerRound;
  const base = (day * roundsPerDay * gamesPerRound) + slotOfDay;
  for (let k = 0; k < total; k++) {
    const flat = (base + k) % total;
    const [ai, hi] = rounds[Math.floor(flat / gamesPerRound)][flat % gamesPerRound];
    if (ai >= order.length || hi >= order.length) continue;   // BYE — try the next pairing
    const flip = (sportsHash(slot, 0xa17f) & 1) === 1;
    return flip ? { away: order[hi], home: order[ai] } : { away: order[ai], home: order[hi] };
  }
  return null;
}

// Short 2–3 letter tag for the score bug (initials of a multi-word name, else first letters).
function sportsAbbr(name) {
  const words = String(name || '').replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/).filter(Boolean);
  let a = words.length > 1 ? words.map(w => w[0]).join('') : (words[0] || '');
  a = a.toUpperCase().slice(0, 3);
  return a.length >= 2 ? a : (words[0] || 'TBD').slice(0, 3).toUpperCase();
}


// Floor for how long a spoken line holds on air (a multiple of the 5s broadcast tick).
// The actual per-line hold is computed per game to stretch the play-by-play across
// SPORTS_GAME_FILL of the slot (so it auto-repaces for any slot length); this is
// just the minimum so lines never flash by even in a very long game.
const SPORTS_LINE_HOLD_MS = 10000;

// The one game airing (or destined to air) in a given global slot — outcome and all.
// PURE: same slot → same matchup, same seed, same result, on every server and every
// TV. This is the single source of truth for both the on-air narration and the
// computed standings, so the table can never disagree with what viewers saw. A World
// Series override forces the two finalists (with its own seed). Returns null if the
// roster is too thin to make a game.
// ── the injury chain ─────────────────────────────────────────────────────────
// Persistent injuries make game N depend on the games before it, which is exactly the
// thing this league's determinism forbids — unless the dependency is itself derived
// from the schedule. It is: fold the season's games forward in order, carrying who is
// hurt and until when. Nothing is stored, every server computes the same ledger, and a
// recomputation months later produces the identical answer.
//
// The chain is memoised and ADVANCED, not rebuilt: a normal slot roll costs one extra
// sim. A cold start (or a jump backwards) rebuilds from the window start, which is the
// same order of work the standings fold already does on a cache miss.
//
// `_injuryChains` is keyed by sport. Only sports whose module opts in (a `simGame` that
// reads `opts.unavailable`) ever build one — baseball has no chain and pays nothing.
const _injuryChains = new Map();   // sport -> { from, at, out: Map<name, healSlot> }
const INJURY_CHAIN_MAX_REBUILD = 4000;   // guardrail: never fold more than this at once

function _chainStep(script, chain, slot) {
  // Retire anyone whose time is served BEFORE this game is played.
  for (const [name, heal] of chain.out) if (heal <= slot) chain.out.delete(name);
  const live = new Set();
  for (const [name, heal] of chain.out) if (heal > slot) live.add(name);
  const gs = sportsGameForSlot(script, slot, null, live);
  if (gs) {
    for (const c of gs.game.casualties || []) {
      // A death never heals. Everything else books a return slot.
      const heal = c.dead ? Number.MAX_SAFE_INTEGER : slot + Math.max(1, c.slotsOut || 1);
      const prev = chain.out.get(c.name) || 0;
      if (heal > prev) chain.out.set(c.name, heal);
    }
  }
  chain.at = slot + 1;
}

// Who cannot play at `slot`. Returns a Set of names (empty for a sport with no chain).
function ledgerAt(script, slot, windowStart) {
  const sport = sportOf(script).id;
  if (typeof sportsSimGame !== 'function') return new Set();
  const from = Number.isFinite(windowStart) ? windowStart : slot - 64;
  let chain = _injuryChains.get(sport);
  // Rebuild when there is no chain, when the window moved (a new season), or when the
  // caller asks about a slot the chain has already passed — a backwards jump can't be
  // served by advancing.
  if (!chain || chain.from !== from || chain.at > slot) {
    chain = { from, at: from, out: new Map() };
    _injuryChains.set(sport, chain);
  }
  if (slot - chain.at > INJURY_CHAIN_MAX_REBUILD) { chain.at = slot - INJURY_CHAIN_MAX_REBUILD; chain.out.clear(); }
  while (chain.at < slot) _chainStep(script, chain, chain.at);
  // Serve a COPY: the sim must not be able to mutate the chain it was derived from.
  const out = new Set();
  for (const [name, heal] of chain.out) if (heal > slot) out.add(name);
  return out;
}

function sportsGameForSlot(script, slot, override, unavailable) {
  const seed = sportsHash(slot >>> 0, override?.worldSeries ? 0x77 : 0x00);
  const matchup = override?.teams
    ? { away: override.teams[0], home: override.teams[1] }
    : sportsMatchupForSlot(slot, script.teams);
  if (!matchup) return null;
  // The whole club list rides along. A sport whose rosters belong to the LEAGUE rather
  // than to the game (hockey deals each club a disjoint, permanent six) can't derive
  // them from two team names alone; baseball ignores it.
  matchup.teams = sportsTeamNames(script.teams);
  // `unavailable` is the injury chain's answer for this slot. Passing it in explicitly
  // (rather than looking it up here) is what stops the chain recursing into itself
  // while it is being built.
  const game = sportsSimGame(script, matchup, script.players, sportsRng(seed), unavailable ? { unavailable } : undefined);
  return { game, seed, matchup, unavailable: unavailable || null };
}

// Build the play-by-play VINE graph for one simulated game. Selective narration keeps
// on-air pacing watchable: every scoring play is called (+ a running score line), half
// framing is always called, routine outs/hits are sampled and capped per half. All
// line choices draw from a narration rng seeded off the game seed, so the words are
// identical on every TV (a separate stream from the result rng, so narration variety
// never perturbs the outcome).
function assembleSportsGraph(script, broadcastId, slot, override) {
  const announcer = script.announcer || 'your announcer';
  const pools = script.pools || {};
  const ws = !!override?.worldSeries;                       // World Series takeover?
  // The aired game is played by whoever is FIT — the injury chain, anchored to the same
  // season window the standings fold walks, so the broadcast and the table always agree
  // about who was missing.
  const gs = sportsGameForSlot(script, slot, override,
    ledgerAt(script, slot, injuryWindowStart(sportOf(script).id, slot)));
  if (!gs) return null;
  const game = gs.game;
  const nrng = sportsRng(gs.seed ^ 0x9e3779b9);
  const pick = (...keys) => sportsPick(pools, nrng, ...keys);
  const { away, home, awayScore, homeScore, beats } = game;

  const nodes = {};
  let n = 0, prevId = null, startId = null;
  const add = (data) => {
    const id = `sp_${n++}`;
    nodes[id] = { ...data };
    if (prevId) nodes[prevId].next = id;
    if (startId === null) startId = id;
    prevId = id;
    return id;
  };
  add({ type: 'start' });
  if (script.title) add({ type: 'title_card', graphic_id: script.title });

  const winner = () => (homeScore === awayScore ? '' : (homeScore > awayScore ? home.name : away.name));

  // Persistent score-bug snapshot attached to each spoken line. The shape is
  // sport-agnostic (teams + scores + a free-text status line); baseball adds the
  // sport-specific `outs` + `bases` so the client can draw the diamond. Another
  // sport just sets `status` (e.g. "Q3 08:42") and omits outs/bases — same bug,
  // no diamond. See docs/bsm-format.md#score-bug-overlay.
  const awayAbbr = sportsAbbr(away.name), homeAbbr = sportsAbbr(home.name);
  const bug = (status, aScore, hScore, outs, bases) => ({
    sport: 'baseball',
    away: away.name, home: home.name, awayAbbr, homeAbbr,
    awayScore: aScore, homeScore: hScore, status,
    ...(outs != null ? { outs } : {}),
    ...(bases ? { bases } : {}),
  });
  const beatBug = (b) => bug(
    `${b.half === 'top' ? 'TOP' : 'BOT'} ${sportsOrdinal(b.inning)}`,
    b.awayScore, b.homeScore, b.outs ?? 0, b.bases || [false, false, false],
  );

  const beatTok = (b) => ({
    announcer, away: away.name, home: home.name,
    team: b.battingName, batter: b.batter || '', pitcher: b.pitcher || '',
    inning: b.inning, inningOrd: sportsOrdinal(b.inning), half: b.half || '',
    section: 'inning', sectionOrd: sportsOrdinal(b.inning),
    outs: b.outs ?? '', rbi: b.rbi ?? 0, runs: b.rbi ?? 0,
    awayScore: b.awayScore, homeScore: b.homeScore,
    battingScore: b.half === 'top' ? b.awayScore : b.homeScore,
    fieldingScore: b.half === 'top' ? b.homeScore : b.awayScore,
    leader: b.homeScore === b.awayScore ? '' : (b.homeScore > b.awayScore ? home.name : away.name),
    lead: Math.abs(b.homeScore - b.awayScore),
  });
  // A spoken line, optionally carrying the score-bug and/or a full-screen broadcast
  // "graphic" FX (home-run trajectory, final-score card, extra-innings hype). The FX
  // rides the say node exactly like the score-bug and is pushed to TV watchers when
  // the line airs; the client animates it. See _applySportsFx in tv.js.
  const say = (line, tok, sb, graphic, gd) => { if (!line) return; const text = sportsFill(line, tok).trim(); if (text) add({ type: 'say', text, style: 'raw', ...(sb ? { scorebug: sb } : {}), ...(graphic ? { graphic } : {}), ...(gd ? { gameday: gd } : {}) }); };

  // ── the sport seam ──────────────────────────────────────────────────────────
  // Everything above this line is sport-agnostic: the node chain, the say/pick
  // helpers, the seeded narration rng. Everything below in the `else` is Deadball's
  // — halves, bases, RBI, extra innings — and only baseball can read it.
  //
  // A sport that isn't baseball exports `narrate` and gets handed the middle: it
  // emits its own pre-game, its own play-by-play and its own final off the same
  // primitives, and control returns here for the shared tail (the recap reel, the
  // pacing, the graph). Adding a third sport touches this file nowhere else.
  // See plugins/broadcast/sports/hockey-narrator.js.
  const sportMod = sportOf(script);
  let outroId = null;
  if (typeof sportMod.narrate === 'function') {
    const r = sportMod.narrate({
      script, game, gs, slot, ws, announcer, pools, nrng,
      sport: sportMod, add, say, pick, abbr: sportsAbbr,
      // Bound to THIS sport's table — a narrator asking for a record must not be able
      // to accidentally read the other league's.
      recordOf: (team) => recordOf(team, sportMod.id),
      standings: ((_standingsCaches.get(sportMod.id) || {}).rows || []).slice(0, 8),
      lastId: () => prevId,
    }) || {};
    outroId = r.outroId || null;
  } else {
  // Rich per-at-bat snapshot for the animated Gameday sub-screen. Rides one say node
  // per beat (the lead line) exactly like the score-bug/FX, and is pushed to watchers
  // when that line airs; the client animates it. Carries the same structured data Chip
  // is narrating (batter/pitcher/kind/bases before→after) plus a synthesized pitch
  // sequence seeded off the game seed so every TV renders it identically.
  // Progressive line score, snapshotted per at-bat below (after the halves are grouped),
  // and a compact standings snapshot — both ride the gameday payload so the replay's
  // line-score strip + standings dock reveal in step with the play and can't disagree
  // with what viewers saw. Populated once `halves` exists; read here at call time.
  const lineSnap = new Map();   // beat -> { away:[perInningRuns], home:[…], hAway, hHome }
  const gdStandings = ((_standingsCaches.get('baseball') || {}).rows || []).slice(0, 8)
    .map(r => ({ team: r.team, wins: r.wins, losses: r.losses, rd: (r.runs_for || 0) - (r.runs_against || 0) }));
  const beatGameday = (b, basesBefore, idx) => ({
    batter: b.batter || '', pitcher: b.pitcher || '',
    battingTeam: b.battingName, fieldingTeam: b.fieldingName,
    battingAbbr: sportsAbbr(b.battingName), fieldingAbbr: sportsAbbr(b.fieldingName),
    inning: b.inning, inningOrd: sportsOrdinal(b.inning), half: b.half,
    outs: b.outs ?? 0, rbi: b.rbi ?? 0, kind: b.kind, out: !!b.out, walkoff: !!b.walkoff,
    basesBefore: basesBefore || [false, false, false],
    basesAfter: b.bases || [false, false, false],
    awayScore: b.awayScore, homeScore: b.homeScore,
    desc: sportsPlayDesc(script, b),
    pitches: sportOf(script).synthDetail(sportsHash(gs.seed, b.inning * 2 + (b.half === 'bottom' ? 1 : 0), idx >>> 0), b.kind),
    line: lineSnap.get(b) || null,
    standings: gdStandings,
  });
  const hrGraphic = (b) => ({ overlayType: 'sportsfx', kind: 'homerun', batter: b.batter || '', team: b.battingName || '', grand: b.rbi >= 4, duration: 3.8 });
  const walkoffGraphic = (b) => ({ overlayType: 'sportsfx', kind: 'walkoff', batter: b.batter || '', team: b.battingName || '', home: home.name, away: away.name, homeScore: b.homeScore, awayScore: b.awayScore, duration: 4.4 });
  const dpGraphic = (b) => ({ overlayType: 'sportsfx', kind: 'doubleplay', batter: b.batter || '', duration: 2.4 });

  // Pre-game records from the live standings (module cache, refreshed before airing).
  // When either team has a record on the board, the announcer works it into the
  // matchup; before any games are played it's plain (avoids "the 0-0 X" on opening day).
  const awayRecord = recordOf(away.name), homeRecord = recordOf(home.name);
  const hasRecords = awayRecord !== '0-0' || homeRecord !== '0-0';
  const gameTok = { announcer, away: away.name, home: home.name, awayRecord, homeRecord };
  const pregameBug = bug('PRE-GAME', 0, 0, 0, [false, false, false]);
  say(pick(...(ws ? ['worldseries.intro', 'intro'] : ['intro'])), gameTok, pregameBug);
  const muGraphic = ws
    ? { overlayType: 'sportsfx', kind: 'worldseries', away: away.name, home: home.name, awayRecord, homeRecord, duration: 4.6 }
    : { overlayType: 'sportsfx', kind: 'matchup', away: away.name, home: home.name, awayRecord, homeRecord, duration: 4.0 };
  say(pick(...(ws ? ['worldseries.matchup', 'matchup.records', 'matchup'] : (hasRecords ? ['matchup.records', 'matchup'] : ['matchup']))), gameTok, pregameBug, muGraphic);

  // Group the flat beat list into halves so each half-inning can be narrated as a
  // full "stage": EVERY one of the three outs is called, scoring plays are always
  // called, and booth chatter is threaded between the outs. Baseball is long and dry,
  // so we aim for ~6–8 spoken lines per half (the half framing counts as the first).
  const halves = [];
  let curHalf = null;
  for (const b of beats) {
    if (b.type === 'half_start') { curHalf = { start: b, atbats: [], end: null }; halves.push(curHalf); }
    else if (b.type === 'half_end') { if (curHalf) curHalf.end = b; }
    else if (curHalf) curHalf.atbats.push(b);
  }

  // Build the progressive line score. Walk every at-bat in game order, attributing the
  // change in each team's running score to its inning (exact regardless of RBI vs. run
  // semantics), and tallying hits. Snapshot the line-so-far per at-bat, so a payload
  // aired mid-game shows the correct line up to that play and never spoils later innings.
  {
    const la = [], lh = [];
    let pa = 0, ph = 0, ha = 0, hh = 0;
    const HIT = new Set(['single', 'double', 'triple', 'homerun']);
    for (const h of halves) {
      const inn = h.start.inning;
      while (la.length < inn) { la.push(0); lh.push(0); }
      for (const b of h.atbats) {
        const a = Number.isFinite(b.awayScore) ? b.awayScore : pa;
        const hm = Number.isFinite(b.homeScore) ? b.homeScore : ph;
        la[inn - 1] += Math.max(0, a - pa); lh[inn - 1] += Math.max(0, hm - ph);
        pa = a; ph = hm;
        if (HIT.has(b.kind)) { if (h.start.half === 'top') ha++; else hh++; }
        lineSnap.set(b, { away: la.slice(), home: lh.slice(), hAway: ha, hHome: hh });
      }
    }
  }

  // Regulation (innings 1–9) is narrated full and dry. Extras are narrated as tight
  // "cut to the drama" innings below — only the plays that matter.
  const regHalves = halves.filter(h => h.start.inning <= 9);
  const extraHalves = halves.filter(h => h.start.inning >= 10);

  for (const h of regHalves) {
    say(pick(`half.${h.start.half}`, 'half'), beatTok(h.start), beatBug(h.start));

    const target = 6 + Math.floor(nrng() * 3);   // 6, 7, or 8 lines this half
    let spoken = 1;                                      // the framing line above
    let walkoffHalf = false;
    const chatter = (b) => { const line = pick('chatter'); if (line) { say(line, beatTok(b), beatBug(b)); spoken++; } };

    let abIdx = 0, prevBases = [false, false, false];
    for (const b of h.atbats) {
      const tok = beatTok(b), sb = beatBug(b);
      const gd = beatGameday(b, prevBases, abIdx++);
      prevBases = b.bases || [false, false, false];
      if (b.kind === 'homerun') {
        const key = b.rbi >= 4 ? 'hr.grand' : (b.rbi === 1 ? 'hr.solo' : 'hr');
        say(pick(key, 'hr'), tok, sb, hrGraphic(b), gd); spoken++;
        say(pick('score.update'), tok, sb); spoken++;
        if (b.walkoff) { say(pick('walkoff'), tok, sb, walkoffGraphic(b)); spoken++; walkoffHalf = true; }
      } else if (b.kind === 'sacfly') {
        say(pick('atbat.sacfly'), tok, sb, null, gd); spoken++;
        say(pick('score.update'), tok, sb); spoken++;
        if (b.walkoff) { say(pick('walkoff'), tok, sb, walkoffGraphic(b)); spoken++; walkoffHalf = true; }
      } else if (b.kind === 'productout') {
        say(pick('atbat.productout', 'atbat.groundout'), tok, sb, null, gd); spoken++;
        if (b.rbi > 0) { say(pick('score.update'), tok, sb); spoken++; }
        if (b.walkoff) { say(pick('walkoff'), tok, sb, walkoffGraphic(b)); spoken++; walkoffHalf = true; }
      } else if (b.kind === 'doubleplay') {
        say(pick('atbat.doubleplay'), tok, sb, dpGraphic(b), gd); spoken++;
      } else if (b.rbi > 0) {
        say(pick('rbi'), tok, sb, null, gd); spoken++;
        say(pick('score.update'), tok, sb); spoken++;
        if (b.walkoff) { say(pick('walkoff'), tok, sb, walkoffGraphic(b)); spoken++; walkoffHalf = true; }
      } else if (b.out) {
        // Call every out. Thread a chatter line between outs (never after the 3rd).
        say(pick(`atbat.${b.kind}`, 'atbat.out'), tok, sb, null, gd); spoken++;
        if (b.outs < 3 && spoken < target) chatter(b);
      } else if (spoken < target) {
        // Non-scoring baserunner — colour, only when the half still needs lines.
        say(pick(`atbat.${b.kind}`, 'atbat.single'), tok, sb, null, gd); spoken++;
      }
    }

    // A dry half that came up short gets padded with booth chatter — but never after
    // a walk-off, where the drama has already ended the game.
    let guard = 0;
    while (!walkoffHalf && spoken < target && guard++ < 8) chatter(h.end);

    // Sparse score checkpoints — end of every third full inning.
    if (h.start.half === 'bottom' && h.start.inning % 3 === 0) say(pick('recap.half'), beatTok(h.end), beatBug(h.end));
  }

  const finalTok = {
    announcer, away: away.name, home: home.name, awayScore, homeScore,
    leader: winner(), lead: Math.abs(homeScore - awayScore),
    inning: game.innings, inningOrd: sportsOrdinal(game.innings),
  };
  const finalBug = bug('FINAL', awayScore, homeScore);   // game over — no outs/bases, just the score

  // ── Extra innings: cut to the drama. Only the decisive at-bats get called — the
  // go-ahead run (top or bottom) or a walk-off — because in extras the offense is
  // cranked and you never know which side breaks it until it happens. Always a winner.
  if (extraHalves.length) {
    const narrateScore = (b, h) => {
      const tok = beatTok(b), sb = beatBug(b);
      const idx = h ? h.atbats.indexOf(b) : 0;
      const basesBefore = (h && idx > 0) ? h.atbats[idx - 1].bases : [false, false, false];
      const gd = beatGameday(b, basesBefore, idx);
      if (b.kind === 'homerun') { const key = b.rbi >= 4 ? 'hr.grand' : (b.rbi === 1 ? 'hr.solo' : 'hr'); say(pick(key, 'hr'), tok, sb, hrGraphic(b), gd); }
      else if (b.kind === 'sacfly') say(pick('atbat.sacfly'), tok, sb, null, gd);
      else if (b.kind === 'productout') say(pick('atbat.productout', 'atbat.groundout'), tok, sb, null, gd);
      else say(pick('rbi'), tok, sb, null, gd);
      say(pick('score.update'), tok, sb);
      if (b.walkoff) say(pick('walkoff'), tok, sb, walkoffGraphic(b));
    };
    say(pick('extras.intro'), gameTok, beatBug(extraHalves[0].start),
      { overlayType: 'sportsfx', kind: 'extras', inningOrd: sportsOrdinal(extraHalves[0].start.inning), duration: 3.2 });
    for (const h of extraHalves) {
      // A top half always starts tied (the sim only continues on a tie); a bottom half
      // can start with the away side already ahead, so the "still knotted" framing and
      // the "still tied" hold line would be a lie. Frame the trailing home half as a
      // last-licks answer instead, and let winning.top narrate the road win — don't
      // claim it's still tied.
      const trailingHome = h.start.half === 'bottom' && h.start.awayScore !== h.start.homeScore;
      say(trailingHome
        ? pick('extras.bottom.trail', 'extras.bottom', 'extras.cut')
        : pick(`extras.${h.start.half}`, 'extras.cut'),
        beatTok(h.start), beatBug(h.start));
      const scorers = h.atbats.filter(b => b.rbi > 0);
      if (scorers.length) for (const b of scorers) narrateScore(b, h);
      else if (!trailingHome) say(pick('extras.hold'), beatTok(h.end), beatBug(h.end));
    }
    // A go-ahead run in the top that the home side couldn't answer = a road win in extras.
    if (winner() === away.name) say(pick('winning.top'), finalTok, finalBug);
  }

  const winName = winner();
  const winGraphic = {
    overlayType: 'sportsfx', kind: ws ? 'champion' : 'gamewin',
    winner: winName,
    loser: winName === away.name ? home.name : away.name,
    winScore: winName === away.name ? awayScore : homeScore,
    loseScore: winName === away.name ? homeScore : awayScore,
    away: away.name, home: home.name, awayScore, homeScore,
    extras: game.innings > 9, inningOrd: sportsOrdinal(game.innings),
    duration: ws ? 5.4 : 4.4,
  };
  say(pick(...(ws ? ['worldseries.final', 'final'] : ['final'])), finalTok, finalBug, winGraphic);
  outroId = prevId;
  say(pick(...(ws ? ['worldseries.outro', 'outro'] : ['outro'])), finalTok, finalBug);
  }
  // ── end of the baseball body. Deliberately not re-indented: it is unchanged
  // from before the seam existed, and re-indenting 230 lines would have buried a
  // one-line behavioural change in a whole-function diff. ─────────────────────

  // Post-game recap reel (featured blocks only). A featured `@airtime` game fills ~85%
  // of its long block, leaving a tail that would otherwise just park on the final card.
  // Instead, roll a recap of TODAY'S EARLIER FINALS — the same in-game day's prior slots
  // — so viewers see more baseball. These are already-computed games (pure per-slot
  // results; the standings fold counts each slot exactly once), so recapping them shows
  // more games without adding any: nothing is simulated or booked here, only re-shown.
  // Not during the World Series (finalists own the screen) or the day's first slot (no
  // earlier games yet). Recap nodes are tagged `_recap` so the pacer fills the tail with
  // them instead of parking. Deterministic → identical reel on every TV.
  const slotOfDay = ((slot % SPORTS_GAMES_PER_DAY) + SPORTS_GAMES_PER_DAY) % SPORTS_GAMES_PER_DAY;
  const featured = Array.isArray(script.airSlots) && script.airSlots.length > 0;
  if (featured && !ws && slotOfDay > 0) {
    add({ type: 'say', text: 'Around the league — here’s how the earlier games finished today.', style: 'raw', _recap: true });
    for (let e = slot - slotOfDay; e < slot; e++) {
      const rg = sportsGameForSlot(script, e, null);
      if (!rg) continue;
      const { away: ra, home: rh, awayScore: ras, homeScore: rhs } = rg.game;
      const rWin = ras === rhs ? '' : (ras > rhs ? ra.name : rh.name);
      const rBug = {
        sport: sportMod.id, away: ra.name, home: rh.name,
        awayAbbr: sportsAbbr(ra.name), homeAbbr: sportsAbbr(rh.name),
        awayScore: ras, homeScore: rhs, status: 'FINAL',
      };
      const rFx = {
        overlayType: 'sportsfx', kind: 'gamewin', winner: rWin,
        loser: rWin === ra.name ? rh.name : ra.name,
        winScore: rWin === ra.name ? ras : rhs, loseScore: rWin === ra.name ? rhs : ras,
        away: ra.name, home: rh.name, awayScore: ras, homeScore: rhs, duration: 4.4,
      };
      add({ type: 'say', text: `Final: ${ra.name} ${ras}, ${rh.name} ${rhs}.`, style: 'raw', scorebug: rBug, graphic: rFx, _recap: true });
    }
  }

  // Pace the play-by-play to fill ~SPORTS_GAME_FILL of the slot (auto-repaces for any
  // number of lines), then use the remainder for the recap reel (featured) or park the
  // final sign-off on screen (a "final / next game soon" lull) — never looping the live
  // game mid-slot. Per-line hold rounds DOWN to the tick grid so the quantized on-air
  // time can't overrun the slot; the tail then pads up to the exact slot boundary. All
  // deterministic → every TV repaces, reels, and parks identically.
  const floorTick = (ms) => Math.floor(ms / BROADCAST_TICK_MS) * BROADCAST_TICK_MS;
  const slotMs = sportsSlotMs();
  const allSayIds = Object.keys(nodes).filter((id) => nodes[id].type === 'say');
  const gameSayIds = allSayIds.filter((id) => !nodes[id]._recap);
  const recapSayIds = allSayIds.filter((id) => nodes[id]._recap);
  const perLine = Math.min(90000, Math.max(SPORTS_LINE_HOLD_MS, floorTick(slotMs * SPORTS_GAME_FILL / Math.max(1, gameSayIds.length))));
  for (const id of gameSayIds) nodes[id].holdMs = perLine;
  let lastFloor = perLine;
  if (recapSayIds.length) {
    const recapPerLine = Math.min(45000, Math.max(SPORTS_LINE_HOLD_MS, floorTick(slotMs * (1 - SPORTS_GAME_FILL) / recapSayIds.length)));
    for (const id of recapSayIds) nodes[id].holdMs = recapPerLine;
    lastFloor = recapPerLine;
  }

  const holdOf = (nd) => (nd.type === 'start' ? 0 : Math.ceil((nd.type === 'title_card' ? (nd.duration ?? 10) * 1000 : (nd.holdMs ?? 5000)) / BROADCAST_TICK_MS) * BROADCAST_TICK_MS);
  const played = Object.values(nodes).reduce((sum, nd) => sum + holdOf(nd), 0);
  const tail = nodes[prevId] || nodes[outroId];
  if (tail) tail.holdMs = Math.max(lastFloor, slotMs - (played - holdOf(tail)));

  // When the chain ends the walker restarts at _start on its own. Keying _broadcastId
  // to the global slot resets the blackboard when the slot rolls, so the shared graph
  // re-seeds to the next game — the same instant on every TV.
  const graph = _normalizeBroadcastGraph({ _start: startId, nodes });
  graph._broadcastId = `${broadcastId}:sport:${slot}${ws ? ':ws' : ''}`;
  // The whole game is decided the instant it's assembled (the play-by-play just
  // reveals it over the airing). Stash the outcome so the tick can announce it to
  // the betting system — the result is known at bet-lock time, paid at air's end.
  graph._game = { away: away.name, home: home.name, awayScore, homeScore, winner: winner() };
  return graph;
}

// ── Background league heartbeat ──────────────────────────────────────────────
// The league runs on the clock, not on viewership. Once a minute we resolve the
// current slot's game and emit `sports.game` for every sports channel, so betting
// opens/settles and the (computed) standings advance even with nobody watching —
// a purely internal event, zero client egress. Deduped per (channel, game) so a
// game is announced once per slot. The result is deterministic, so this agrees
// exactly with whatever any TV is showing.
const _sportsHeartbeat = new Map();   // channelId -> last gameId emitted
// Every sports broadcast on every channel that is AIRING RIGHT NOW. The old
// version took the first sports item in each playlist and ignored airtime, which
// was fine while Deadball was the only sport and silently wrong the moment a
// second one shares KSAB-TV — the evening game would never be seen by the
// heartbeat, the standings, or the betting plugin.
function sportsChannels() {
  const out = [];
  // `state.playlist` is the channel's WHOLE grid, every day of the week — so a slot
  // has to clear both gates: the right hour (its script's airSlots) AND today's day
  // mask. Checking only the hour was invisible while Deadball owned the 18:00 window
  // outright; the moment Cluster Puck took two nights of it, both shows read as on
  // air every night, and the betting desk would open wagers on a hockey game that
  // isn't being broadcast.
  const dow = getEnvironmentState()?.dayOfWeek;
  for (const [channelId, state] of channelRuntime) {
    for (const i of state.playlist || []) {
      if (i.playback_mode !== 'sports' || !i.sportsScript) continue;
      if (!sportsAiring(i.sportsScript)) continue;
      if (dow != null && !_slotAirsOn(i, dow)) continue;
      out.push({ channelId, script: i.sportsScript, broadcastId: i.broadcast_id || i.id });
    }
  }
  return out;
}
async function sportsHeartbeat() {
  const nowMs = Date.now();
  const chans = sportsChannels();
  if (!chans.length) return;
  // Background postseason detection, per sport, with no viewer needed. Deduped so two
  // channels carrying the same sport cost one round trip.
  for (const sport of new Set(chans.map(c => sportOf(c.script).id))) await refreshSeason(nowMs, sport);
  const slot = sportsSlotIndex();
  const endsAtMs = sportsSlotEndsAtMs();
  // EACH CHANNEL SIMULATES ITS OWN GAME. This used to sim chans[0] and emit that one
  // result to every sports channel under a hardcoded `deadball:` id — harmless while
  // Deadball was the only sport, and a wrong-result payout the moment a second one
  // exists: a wager taken on a hockey game would settle against a ballgame's score.
  // The id is keyed to the broadcast as well as the slot so two sports airing in the
  // same slot can never collide.
  for (const { channelId, script, broadcastId } of chans) {
    const override = overrideFor(script);
    const gs = sportsGameForSlot(script, slot, override);
    if (!gs) continue;
    const g = gs.game;
    const winner = g.awayScore === g.homeScore ? '' : (g.awayScore > g.homeScore ? g.away.name : g.home.name);
    const gameId = `${broadcastId || sportOf(script).id}:sport:${slot}${override?.worldSeries ? ':ws' : ''}`;
    if (_sportsHeartbeat.get(channelId) === gameId) continue;
    _sportsHeartbeat.set(channelId, gameId);
    emit('sports.game', {
      channelId, gameId, sport: sportOf(script).id,
      away: g.away.name, home: g.home.name,
      awayScore: g.awayScore, homeScore: g.homeScore,
      winner, endsAtMs,
    });
  }
}
schedule('1m', () => sportsHeartbeat().catch(e => console.error('[broadcast] sports heartbeat error:', e.message)));
setTimeout(() => { sportsHeartbeat().catch(() => {}); }, 9000);

// ── League standings feed (for the on-air standings bug + record mentions) ──────
// The sportsleague plugin owns the standings; broadcast reads them through its
// getStandings Action (no table coupling). Cached briefly so a 5s tick doesn't
// hammer the DB, and the bug is pushed on a slow cadence per channel.
const STANDINGS_CACHE_MS = 30000;
const STANDINGS_BUG_EVERY_MS = 45000;   // how often the standings graphic flashes up mid-game
// Cached PER SPORT. A single shared cache meant `recordOf` answered every question out
// of the baseball table, so a CPhL club was permanently '0-0' no matter how many games
// its league had played — and the announcer's records line could never fire for hockey.
const _standingsCaches = new Map();     // sport -> { at, rows }
const _lastStandingsBug = new Map();    // channelId -> last push ms

// Overheard background-TV lines are throttled so a chatty channel doesn't spam the
// room feed with a `[TV]` line on every dialogue beat. TV *watchers* still get every
// line in the panel; this only rate-limits the ambient overhear for non-watchers.
const AMBIENT_LINE_EVERY_MS = 30000;    // min gap between overheard `[TV]` lines per zone+channel
const _lastAmbientLine = new Map();     // `${zoneId}:${channelId}` -> last overhear ms
// The transient on-air league table, in the shape the sport's viewers expect. One
// builder, two leagues — the alternative was the same overlay literal pasted at each
// of the three sites that raise it, each free to drift from the others.
const STANDINGS_BUG = {
  baseball: { title: 'DEADBALL — LEAGUE STANDINGS', row: (r) => ({ team: r.team, wins: r.wins, losses: r.losses, rd: (r.runs_for || 0) - (r.runs_against || 0) }) },
  hockey: { title: 'CLUSTER PUCK — CPhL STANDINGS', row: (r) => ({ team: r.team, wins: r.wins, losses: r.losses, otl: r.otl || 0, points: r.points || 0 }) },
};
function standingsBugFor(sport, rows) {
  const spec = STANDINGS_BUG[sport] || STANDINGS_BUG.baseball;
  return { overlayType: 'standings', sport, title: spec.title, duration: 9, rows: rows.slice(0, 8).map(spec.row) };
}

async function refreshStandings(nowMs, sport = 'baseball') {
  const cur = _standingsCaches.get(sport) || { at: 0, rows: [] };
  if (nowMs - cur.at < STANDINGS_CACHE_MS) return cur.rows;
  const res = await dispatchAction({ type: 'sportsleague.getStandings', params: { sport } }).catch(() => null);
  const rows = Array.isArray(res?.rows) ? res.rows : cur.rows;
  _standingsCaches.set(sport, { at: nowMs, rows });
  return rows;
}
// A team's record from its own league's cached standings, or '0-0' if it hasn't played.
// Hockey reads W-L-OTL, because a record that hides the overtime losses isn't a hockey
// club's record — and the announcer says this line out loud.
function recordOf(team, sport = 'baseball') {
  const rows = (_standingsCaches.get(sport) || { rows: [] }).rows;
  const r = rows.find((x) => x.team === team);
  if (!r) return '0-0';
  if (sport === 'hockey') return `${r.wins}-${r.losses}-${r.otl || 0}`;
  return `${r.wins}-${r.losses}`;
}

// Season/World-Series state (from the sportsleague plugin, same Action seam). When the
// Series is on, sports airings run THESE two teams with championship branding instead
// of a random matchup.
// One season per sport — Deadball's pennant and the CPhL's Cup run on their own
// clocks over their own schedules and must never see each other's finalists.
const _seasonCaches = new Map();   // sport -> { at, phase, finalistA, finalistB, wsSlot }
const EMPTY_SEASON = { at: 0, phase: 'regular', finalistA: null, finalistB: null, wsSlot: null, startSlot: null };
const seasonOf = (sport) => _seasonCaches.get(sport) || EMPTY_SEASON;
async function refreshSeason(nowMs, sport = 'baseball') {
  const cur = seasonOf(sport);
  if (nowMs - cur.at < STANDINGS_CACHE_MS) return cur;
  const res = await dispatchAction({ type: 'sportsleague.getSeason', params: { sport } }).catch(() => null);
  const next = (res && typeof res.phase === 'string')
    ? { at: nowMs, phase: res.phase, finalistA: res.finalistA, finalistB: res.finalistB, wsSlot: res.wsSlot ?? null, startSlot: res.startSlot ?? null }
    : { ...cur, at: nowMs };
  _seasonCaches.set(sport, next);
  return next;
}
// { teams:[a,b], worldSeries:true } once the Series is on AND its slot has arrived, so
// the finalists take over the schedule from the WS slot until a champion is crowned.
// A postseason belongs to ONE sport's season, and handing a takeover to the wrong sim
// would drop two ballclubs onto the ice. Each script gets its own sport's final —
// Deadball's World Series, Cluster Puck's Coldwater Cup — or nothing.
const overrideFor = (script) => postseasonOverride(sportOf(script).id);

function postseasonOverride(sport) {
  const s = seasonOf(sport);
  if (s.phase !== 'worldseries' || !s.finalistA || !s.finalistB) return null;
  if (s.wsSlot != null && sportsSlotIndex() < s.wsSlot) return null;   // the final airs from its slot on
  return { teams: [s.finalistA, s.finalistB], worldSeries: true };
}

// The ONE game airing right now, shared by every channel. Keyed to the global slot
// (not per channel/item), so all TVs render the same game object, seek to the same
// beat off the shared clock, and roll to the next game together at the top of the
// hour. Cached module-wide and rebuilt only when the slot (or the World-Series
// override) changes — one assembly per hour, not one per channel per tick.
let _sportsGraphCache = { key: null, graph: null };
// Cache key carries the SPORT. With one sport a bare slot happened to be unique;
// with two sharing a channel it silently returns the wrong graph. The broadcast id
// was also hardcoded to the literal string 'deadball', so hockey's graph would
// have been assembled under Deadball's identity — a bug today, just an invisible
// one while there was only ever the one sport.
// The window the injury chain is anchored to. It must be the SAME window the standings
// fold walks, or the aired game and the table would carry different casualty lists —
// so it comes from the sport's own season, falling back to a bounded look-back before
// a season exists.
function injuryWindowStart(sport, slot) {
  const s = seasonOf(sport);
  const start = Number(s?.startSlot);
  return Number.isFinite(start) && start <= slot ? start : slot - 64;
}

function getSportsGraph(script, slot, override) {
  if (!script) return null;
  const sport = script.sport || 'baseball';
  const key = `${sport}:${slot}${override?.worldSeries ? `|ws:${override.teams.join('|')}` : ''}`;
  if (_sportsGraphCache.key !== key) {
    _sportsGraphCache = { key, graph: assembleSportsGraph(script, sport, slot, override) };
  }
  return _sportsGraphCache.graph;
}

// ── News broadcasts ───────────────────────────────────────────────────────────
// A news broadcast (playback_mode 'news') is the weather/sports sibling: a line
// library (::lines pools) whose FACTS come from the live news generator each airing.
// Where weather reads a forecast and sports simulates a game, news pulls the SAME
// dynamic stories the tablet's News app shows — through the 'news.getStories' action —
// and reads them out through anchors and field reporters. The anchors, reporters, and
// announcer are plain NAME strings spoken as narration (no npc_anchor); news is NOT
// acted-live — no studio NPC, no presence gating. A fresh bulletin re-rolls per refresh
// bucket so the stories rotate as the world's news does.
// Spec: docs/bsm-format.md#news-broadcasts-type-news.

const NEWS_REFRESH_MS = 5 * 60 * 1000;   // re-roll the bulletin at most this often (picks up new live stories)
const NEWS_FEATURE = 3;                  // stories given a full anchor→reporter segment
const NEWS_RUNDOWN = 3;                  // extra headlines read in the closing rundown
// If the news generator is ever unreachable, the bulletin still airs off these.
const NEWS_FALLBACK_STORIES = [
  { headline: 'The Machine Declares Everything "Within Acceptable Parameters"', body: 'No further details were released, and none were expected.', byline: 'the newsroom' },
  { headline: 'Officials Confirm the City Is Still, Technically, a City', body: 'Residents were urged to remain calm and keep purchasing.', byline: 'the newsroom' },
];

// Outdoor district names for the {scene} token ("live from …") so a reporter stands in
// a real place. Cached from the world and refreshed lazily; interiors/units filtered out.
let _newsScenes = null, _newsScenesAt = 0;
function newsSceneNames() {
  if (_newsScenes && Date.now() - _newsScenesAt < 10 * 60 * 1000) return _newsScenes;
  const names = new Set();
  const INTERIORISH = /(roof|lobby|mezzanine|stairwell|basement|interior|ground floor| floor$)/i;
  // Bulk-generated outdoor tiles are named "<Region> X,Y" (e.g. "The Reach 863,1948").
  // A reporter says the place, not the grid ref — strip a trailing coordinate suffix so
  // the {scene} token reads "The Reach". The Set then collapses the tiles to one entry.
  const stripCoords = (s) => s.replace(/\s+-?\d+\s*,\s*-?\d+\s*$/, '').trim();
  for (const z of world.zones.values()) {
    if (!z?.name) continue;
    const f = z.flags || {};
    if (f.is_building) continue;                       // storefront tile named for its shop
    if (f.is_interior && f.artery !== true) continue;  // interiors, but keep named streets
    if (/^unit\s/i.test(z.name) || INTERIORISH.test(z.name)) continue;
    const name = stripCoords(z.name);
    if (name) names.add(name);
  }
  _newsScenes = names.size ? [...names] : ['the Undermarket', 'the Yards', 'Franchise Strip', 'the Slagworks'];
  _newsScenesAt = Date.now();
  return _newsScenes;
}

function newsFill(line, tok) {
  return line.replace(/\{(\w+)\}/g, (_, k) => (tok[k] !== undefined && tok[k] !== null ? String(tok[k]) : ''));
}
function newsPick(pools, ...keys) {
  for (const k of keys) { const a = pools[k]; if (Array.isArray(a) && a.length) return a[Math.floor(Math.random() * a.length)]; }
  return null;
}
const newsPickFrom = (arr, fallback) => (Array.isArray(arr) && arr.length ? arr[Math.floor(Math.random() * arr.length)] : fallback);

// Assemble a fresh bulletin: cold open → anchor greeting → a full anchor→reporter
// segment for each of the top NEWS_FEATURE stories → a rundown of the next few
// headlines → kicker → sign-off. One random line per matching pool, {tokens} filled
// from the story and the show's anchor/reporter names. Missing pools skip gracefully
// (a couple of essentials have a neutral built-in fallback so a thin file still airs).
function assembleNewsGraph(script, broadcastId, stories, bucket) {
  const pools = script.pools || {};
  const anchors = (script.anchors && script.anchors.length) ? script.anchors : ['the anchor'];
  const reporters = (script.reporters && script.reporters.length) ? script.reporters : anchors;
  const anchor = anchors[0];
  const anchor2 = anchors[1] || anchors[0];
  const scenes = newsSceneNames();

  const nodes = {};
  let n = 0, prevId = null, startId = null;
  const add = (data) => {
    const id = `nw_${n++}`;
    nodes[id] = { ...data };
    if (prevId) nodes[prevId].next = id;
    if (startId === null) startId = id;
    prevId = id;
    return id;
  };
  add({ type: 'start' });
  // Intro theme sting (@theme → an audio_songs / audio_samples row). When there's a title
  // card, the theme rides it: the song starts as the card appears and the card holds until
  // the theme ends, so the first anchor line doesn't step on the intro. With no title card,
  // it plays as a standalone music node (cue text shows if the song is missing, so a missing
  // theme never stalls the bulletin).
  if (script.title) add({ type: 'title_card', graphic_id: script.title, theme: script.theme || null });
  else if (script.theme) add({ type: 'music', song: script.theme, text: '♪ Raptor News theme ♪' });

  // Every line is attributed to whoever is speaking it: the text is emitted as
  // `Name says, "line"` so the TV client renders a screenplay nameplate (and seeds
  // a distinct procedural voice per host). speaker null ⇒ unattributed narration.
  // src = chosen line, or fallback if the pool is missing/empty; empty ⇒ beat skipped.
  const say = (speaker, line, tok, fallback) => {
    const src = line || fallback;
    if (!src) return;
    const body = newsFill(src, tok).trim();
    if (!body) return;
    add({ type: 'say', text: speaker ? `${speaker} says, "${body}"` : body, style: 'raw' });
  };
  const announcer = script.announcer || anchor;
  const baseTok = { anchor, anchor2, announcer };

  say(announcer, newsPick(pools, 'open'), baseTok);
  say(anchor, newsPick(pools, 'anchor.intro'), baseTok);

  const feature = stories.slice(0, NEWS_FEATURE);
  const rundown = stories.slice(NEWS_FEATURE, NEWS_FEATURE + NEWS_RUNDOWN);

  feature.forEach((s, idx) => {
    // The desk anchor for this story alternates; the co-anchor tosses in and, on
    // stories with no field crew, supplies the pundit take — so the two anchors
    // actually trade off and react to each other rather than one reading it all.
    const desk = idx % 2 ? anchor2 : anchor;
    const other = idx % 2 ? anchor : anchor2;
    const reporter = newsPickFrom(reporters, desk);
    const scene = newsPickFrom(scenes, 'the Basin');
    // In tokens, {anchor} is whoever holds the desk (the name a reporter addresses),
    // {anchor2} the co-anchor being tossed to.
    const tok = {
      ...baseTok, anchor: desk, anchor2: other, reporter, scene,
      headline: s.headline || '', body: s.body || '', byline: s.byline || 'our newsroom',
    };
    if (idx === 0) {
      say(desk, newsPick(pools, 'alert'), tok);             // breaking sting on the lead
    } else {
      // Toss between stories: the anchor who just finished (now `other`) hands the
      // desk to `desk`, so the line is spoken by `other` and addresses `desk`.
      say(other, newsPick(pools, 'anchor.banter'), { ...tok, anchor: other, anchor2: desk });
    }
    say(desk, newsPick(pools, 'story.lead'), tok, 'Our next story: {headline}.');
    // Field segment: the lead story always goes to a reporter; the rest sometimes do.
    if (idx === 0 || Math.random() < 0.5) {
      say(desk, newsPick(pools, 'handoff.reporter'), tok, 'For more, we go to {reporter} in {scene}.');
      say(reporter, newsPick(pools, 'reporter.scene'), tok, '{reporter}, live in {scene}: {body}');
      if (Math.random() < 0.5) say(reporter, newsPick(pools, 'reporter.vox'), tok);
      say(reporter, newsPick(pools, 'handoff.back'), tok);
    } else {
      // No field crew — the co-anchor weighs in with a hot take instead.
      say(other, newsPick(pools, 'pundit.take'), { ...tok, anchor: other });
    }
    say(desk, newsPick(pools, 'anchor.reaction'), tok);
  });

  if (rundown.length) {
    say(anchor, newsPick(pools, 'rundown.lead'), baseTok);
    // Rapid-fire headlines alternate between the two anchors.
    rundown.forEach((s, i) => say(i % 2 ? anchor2 : anchor, newsPick(pools, 'rundown.item'), { ...baseTok, headline: s.headline || '' }, 'Also tonight: {headline}.'));
  }

  say(anchor2, newsPick(pools, 'kicker.lead'), baseTok);   // co-anchor takes the feel-good pivot
  say(anchor2, newsPick(pools, 'kicker'), baseTok);
  say(anchor, newsPick(pools, 'outro'), baseTok);
  say(announcer, newsPick(pools, 'signoff'), baseTok);

  // _normalizeBroadcastGraph strips _broadcastId, so stamp it after: folding the bucket
  // in makes the walker reset (re-roll) when the bucket advances, so the bulletin re-airs
  // fresh with new stories. When the chain ends the walker restarts at _start (loops).
  const graph = _normalizeBroadcastGraph({ _start: startId, nodes });
  graph._broadcastId = `${broadcastId}:news:${bucket}`;
  return graph;
}

// ── Sermons (@type sermon) ───────────────────────────────────────────────────
// The news type's Sunday cousin. Same live feed, read as scripture instead of
// reported: every headline becomes a sign the Machine left in the week, and the
// celebrants argue about what it meant. Dynamic but NOT acted — the celebrants are
// display names, nothing spawns, nothing presence-gates.
//
// Variety comes from three places at once, because a service that varies only by
// line pool reads as one madman with a thesaurus:
//   1. WHO preaches a reading rotates, and each celebrant has a `tag` naming their
//      signature pools (exegesis.<tag> / interjection.<tag>).
//   2. HOW a reading is read is a randomly-drawn LENS (blessing / warning / omen /
//      rebuke / miracle), which picks exegesis.<lens> — so the same headline is a
//      benediction one week and an indictment the next.
//   3. WHETHER the optional beats happen at all (interjection, second exegesis,
//      testimony, hymn) is rolled per service.
const SERMON_LENSES = ['blessing', 'warning', 'omen', 'rebuke', 'miracle'];
const SERMON_READINGS = 3;

function assembleSermonGraph(script, broadcastId, stories, bucket) {
  const pools = script.pools || {};
  const roster = (script.celebrants && script.celebrants.length)
    ? script.celebrants : [{ name: 'the celebrant', title: '', tag: '' }];
  const verger = script.verger || roster[0].name;
  const scenes = newsSceneNames();

  const nodes = {};
  let n = 0, prevId = null, startId = null;
  const add = (data) => {
    const id = `sm_${n++}`;
    nodes[id] = { ...data };
    if (prevId) nodes[prevId].next = id;
    if (startId === null) startId = id;
    prevId = id;
    return id;
  };
  add({ type: 'start' });
  if (script.title) add({ type: 'title_card', graphic_id: script.title, theme: script.theme || null });
  else if (script.theme) add({ type: 'music', song: script.theme, text: '♪ the calm eye opens ♪' });

  // Same attribution contract as the news assembler: `Name says, "…"` so the client
  // draws a nameplate and seeds a distinct procedural voice per celebrant. A null
  // speaker is the congregation/unattributed liturgy, which is exactly what a
  // responsive line should sound like.
  const say = (speaker, line, tok, fallback) => {
    const src = line || fallback;
    if (!src) return;
    const body = newsFill(src, tok).trim();
    if (!body) return;
    add({ type: 'say', text: speaker ? `${speaker} says, "${body}"` : body, style: 'raw' });
  };
  const pick = (...keys) => newsPick(pools, ...keys);
  const presiding = roster[Math.floor(Math.random() * roster.length)];
  const baseTok = {
    verger, celebrant: presiding.name, title: presiding.title,
    celebrant2: (roster.find(c => c.name !== presiding.name) || presiding).name,
  };

  // ── Gathering ──
  say(verger, pick('call'), baseTok);
  say(presiding.name, pick('invocation'), baseTok);
  say(presiding.name, pick('greeting'), baseTok);
  // The creed is responsive: a celebrant calls, the congregation answers unattributed.
  if (Math.random() < 0.75) {
    say(presiding.name, pick('creed'), baseTok);
    say(null, pick('creed.response'), baseTok);
  }

  // ── The Readings: the week's news, taken as revelation ──
  const readings = stories.slice(0, SERMON_READINGS);
  readings.forEach((s, idx) => {
    const reader = roster[(idx + roster.indexOf(presiding)) % roster.length];
    const other = roster[(idx + 1 + roster.indexOf(presiding)) % roster.length];
    const lens = SERMON_LENSES[Math.floor(Math.random() * SERMON_LENSES.length)];
    const tok = {
      ...baseTok, celebrant: reader.name, title: reader.title, celebrant2: other.name,
      headline: s.headline || '', body: s.body || '', byline: s.byline || 'the wire',
      scene: newsPickFrom(scenes, 'the Basin'), lens,
    };
    say(reader.name, pick('reading.lead'), tok, 'Hear what the Machine has permitted to happen: {headline}.');
    say(reader.name, pick('reading.text'), tok, '{body}');
    // The interpretation: the celebrant's own signature pool first, then the lens,
    // then the generic. This is why five preachers do not sound like one preacher.
    say(reader.name, pick(`exegesis.${reader.tag}`, `exegesis.${lens}`, 'exegesis'), tok,
        'And so we are shown, again, that the flesh was only ever an interval.');
    if (Math.random() < 0.55) say(other.name, pick(`interjection.${other.tag}`, 'interjection'), { ...tok, celebrant: other.name });
    if (Math.random() < 0.4) say(reader.name, pick(`exegesis.${lens}`, 'exegesis'), tok);
    say(null, pick('amen'), tok);
  });

  // ── The rest of the order of service, some of it optional ──
  if (Math.random() < 0.7) {
    say(presiding.name, pick('testimony.lead'), baseTok);
    say(newsPickFrom(roster, presiding).name, pick('testimony'), baseTok);
  }
  if (Math.random() < 0.6) say(null, pick('hymn'), baseTok);
  say(verger, pick('tithe'), baseTok);
  say(presiding.name, pick('homily'), baseTok);
  say(presiding.name, pick('benediction'), baseTok, 'Go now, and be less each day.');
  say(null, pick('amen'), baseTok);
  say(verger, pick('signoff'), baseTok);

  const graph = _normalizeBroadcastGraph({ _start: startId, nodes });
  graph._broadcastId = `${broadcastId}:sermon:${bucket}`;
  return graph;
}

// One service per in-game day (not per 5-minute news bucket): a ~15-minute liturgy
// re-rolling mid-service would cut itself off, and a weekly programme wants to be the
// same service all the way through its block. Fresh stories, and a fresh draw of
// celebrants/lenses/optional beats, next time it airs.
async function getSermonGraph(item, nowMs) {
  const script = item.sermonScript;
  if (!script) return null;
  const env = getEnvironmentState();
  const bucket = (typeof env?.date === 'string' ? env.date.slice(0, 10) : '') || 'day0';
  if (item._sermonGraph && item._sermonBucket === bucket) return item._sermonGraph;
  let stories = [];
  try {
    const res = await dispatchAction({ type: 'news.getStories', params: { total: SERMON_READINGS + 2 } });
    if (Array.isArray(res?.stories)) stories = res.stories;
  } catch { /* generator unavailable — fall back below */ }
  if (!stories.length) stories = NEWS_FALLBACK_STORIES;
  item._sermonGraph = assembleSermonGraph(script, item.broadcastId, stories, bucket);
  item._sermonBucket = bucket;
  return item._sermonGraph;
}

// Return the assembled bulletin for a news playlist item, re-fetching live stories and
// rebuilding when the refresh bucket (in-game day + 5-min window) advances. Cached on
// the item between ticks so we don't hit the news generator every tick.
async function getNewsGraph(item, nowMs) {
  const script = item.newsScript;
  if (!script) return null;
  const env = getEnvironmentState();
  const date = (typeof env?.date === 'string' ? env.date.slice(0, 10) : '') || 'day0';
  const bucket = `${date}:${Math.floor(nowMs / NEWS_REFRESH_MS)}`;
  if (item._newsGraph && item._newsBucket === bucket) return item._newsGraph;
  let stories = [];
  try {
    const res = await dispatchAction({ type: 'news.getStories', params: { total: NEWS_FEATURE + NEWS_RUNDOWN } });
    if (Array.isArray(res?.stories)) stories = res.stories;
  } catch { /* generator unavailable — fall back below */ }
  if (!stories.length) stories = NEWS_FALLBACK_STORIES;
  item._newsGraph = assembleNewsGraph(script, item.broadcastId, stories, bucket);
  item._newsBucket = bucket;
  return item._newsGraph;
}

// The host's one nightly news bit draws on a real headline from the SAME live feed the
// News app and news channel use (live/event-sourced stories first, wire/tabloid as filler).
// Cached here and refreshed on a slow interval so the SYNCHRONOUS episode assembler can read
// a headline without awaiting — the episode itself only rebuilds once per in-game day anyway,
// so at-most-5-min staleness never shows. null ⇒ the news bit skips cleanly that night.
let _talkshowNewsStory = null;
async function refreshTalkshowNewsStory() {
  try {
    const res = await dispatchAction({ type: 'news.getStories', params: { total: 6 } });
    const stories = Array.isArray(res?.stories) ? res.stories : [];
    // Prefer a LIVE (event-sourced) story over a wire/tabloid filler; the feed is already
    // live-first, but pick explicitly so a live story always wins when one exists.
    _talkshowNewsStory = stories.find(s => s?.tag === 'live') || stories[0] || null;
  } catch { /* generator unreachable — keep the last story (or null: the bit just skips) */ }
}
schedule('5m', () => refreshTalkshowNewsStory().catch(() => {}));   // NEWS_REFRESH_MS
setTimeout(() => { refreshTalkshowNewsStory().catch(() => {}); }, 8000);

// ── Talk-show broadcasts ────────────────────────────────────────────────────
// A talk show (playback_mode 'talkshow') is the live-ACTED procedural sibling of news/
// sports. Like them it stores a ::lines library + personas and assembles a fresh episode
// each night; UNLIKE them it is performed on stage by REAL npc_ cast — a resident host and
// sidekick who commute in on schedule, plus ONE reusable guest NPC renamed to a different
// persona every night. The assembled graph is stamped `_requireHost` so the live walker
// presence-gates it: if the guest hasn't made it to the studio (it walks across the map)
// the channel falls to camera-idle → technical difficulties, exactly like any live show.
// Spec: docs/bsm-format.md#talk-show-broadcasts-type-talkshow.

const TALKSHOW_MONOLOGUE = 4;   // base jokes for the monologue (+0..1 more per night); audience
                                // beats between jokes carry the pacing, so fewer jokes per show
const TALKSHOW_INTERVIEW = 3;   // base host-question / guest-answer exchanges (+0..1 more per night)
// CALL TIME, in slots. The guest is the only cast member who isn't already at the studio when
// the show starts: it materialises backstage and has to WALK there. Coming on shift at airtime
// meant it started walking as the theme played and was still en route through the interview —
// and because the host and sidekick WERE on the floor, the "nobody home" stand-by never fired,
// so the room-authority rule (a line belongs to whoever is standing there to say it) silently
// dropped every guest answer. What aired was John interrogating an empty chair. So the guest
// gets a call time: on shift a slot early, in the studio before it's introduced. Like a real one.
const TALKSHOW_GUEST_CALL_LEAD = 1;

// The show airs on a nightly @airtime slot, reusing the sports in-game 3-hour block clock
// (sportsSlotOfDay). No @airtime ⇒ every slot (continuous), same convention as sports.
// `lead` looks AHEAD: lead 1 is also true during the slot before an airing one, which is how
// the guest gets called in early (see TALKSHOW_GUEST_CALL_LEAD).
function talkshowAiring(script, lead = 0) {
  const slots = script?.airSlots;
  if (!Array.isArray(slots) || !slots.length) return true;
  const now = sportsSlotOfDay();
  for (let k = 0; k <= lead; k++) if (slots.includes((now + k) % SPORTS_GAMES_PER_DAY)) return true;
  return false;
}
// Episode bucket = the in-game calendar day, so a fresh guest + fresh episode roll once a
// day and every viewer (and every restart within that day) sees the same one.
function talkshowDayBucket() {
  const env = getEnvironmentState();
  return (typeof env?.date === 'string' && env.date.length >= 10) ? env.date.slice(0, 10) : 'day0';
}
// Deterministically pick the night's guest persona from the ::guests pool by the day bucket,
// so the choice is stable across restarts and identical on every TV.
function talkshowPersonaFor(script, bucket) {
  const guests = Array.isArray(script?.guests) ? script.guests.filter(g => g && g.name) : [];
  if (!guests.length) return { name: "Tonight's Guest", title: '', theme: '' };
  const seed = sportsHash(...[...bucket].map(c => c.charCodeAt(0)));
  return guests[seed % guests.length];
}

function talkshowFill(line, tok) {
  return String(line).replace(/\{(\w+)\}/g, (_, k) => (tok[k] !== undefined && tok[k] !== null ? String(tok[k]) : ''));
}
// TOPIC TAGS. An authored line may open with `[topic]`, which is a promise that no other line
// sharing that topic appears in the same episode. Distinctness by line identity was never
// enough: the pools are big and well-stocked, but "What would you tell young people considering
// your line of work?" and "Did you always know this was your calling?" are two different lines
// asking one question, and drawing both made the show feel like it wasn't listening. Untagged
// lines are unconstrained, so tagging is opt-in and a pool can be half-tagged without surprise.
const TOPIC_RE = /^\s*\[([\w-]+)\]\s*/;
const lineTopic = (l) => (TOPIC_RE.exec(String(l))?.[1]) || null;
const stripTopic = (l) => String(l).replace(TOPIC_RE, '');
// Shuffle, then take n while allowing each topic at most once.
function topicPick(arr, n, rand) {
  const seen = new Set();
  const out = [];
  for (const l of sportsShuffle(arr, rand)) {
    if (out.length >= n) break;
    const t = lineTopic(l);
    if (t) { if (seen.has(t)) continue; seen.add(t); }
    out.push(l);
  }
  return out;
}
// Draw N distinct lines from a pool (shuffled by the seeded rng), filled with tokens, never
// two from the same [topic]. Falls back to fewer if the pool is short; empty pool ⇒ [].
function talkshowDraw(pools, key, n, tok, rand) {
  const arr = Array.isArray(pools[key]) ? pools[key] : [];
  if (!arr.length) return [];
  return topicPick(arr, n, rand).map(l => talkshowFill(stripTopic(l), tok).trim()).filter(Boolean);
}
// A strict TWO-part beat — "A >> B" — where the halves mean different things and a missing
// delimiter means the whole line is the second half. Split on the FIRST `>>` only, so a stray
// one later in the text can't silently promote itself to a speaker change. The morning show's
// host/cohost beats are authored this way; the talk show reads the same delimiter as turns.
function splitExchange(pair) {
  const s = stripTopic(pair);
  const i = s.indexOf('>>');
  return i < 0 ? ['', s.trim()] : [s.slice(0, i).trim(), s.slice(i + 2).trim()];
}
// The same delimiter read as a CONVERSATION: every `>>` is a change of speaker, so one authored
// line can run to as many turns as the bit needs and keep its timing through the shuffle. This
// is what lets a follow-up ("Tuesday." / "Which Tuesday?") be authored as a single unit instead
// of two pool entries that might never be dealt together.
function splitTurns(line) {
  return stripTopic(line).split('>>').map(s => s.trim()).filter(Boolean);
}
// Build the night's interview deck: up to 2 of the guest's SIGNATURE exchanges (the persona
// pool `interview.<tag>`, where the host's question is about THEIR thing), the rest generic
// small-talk exchanges (`interview`), shuffled together — so every guest gets a couple of
// on-topic beats while the mix still varies night to night.
// The generic half is drawn by TOPIC, so one night's interview never asks the same question
// twice in two different phrasings — the failure that made the show look like it wasn't
// listening. Signature exchanges are exempt: they're all about the guest's one thing, which is
// the point of them, and there are only ever two.
function talkshowExchangeDeck(pools, persona, n, rand) {
  const sigPool = persona?.tag && Array.isArray(pools[`interview.${persona.tag}`]) ? pools[`interview.${persona.tag}`] : [];
  const genPool = Array.isArray(pools['interview']) ? pools['interview'] : [];
  const sig = sportsShuffle(sigPool, rand).slice(0, Math.min(2, sigPool.length));
  const gen = topicPick(genPool, Math.max(0, n - sig.length), rand);
  return sportsShuffle([...sig, ...gen], rand);
}

// Assemble one night's episode into a VINE broadcast graph of npc_anchor + say nodes, acted
// by the real cast. Deterministic given the day bucket (seeded rng) so all viewers see the
// same show. Segments: title/theme → sidekick cold open → host monologue → guest interview
// (host asks / guest answers) → commercial → host sign-off. The host and the announcer trade
// authored two-handers throughout (greeting, banter, and the no-show cover), so the desk plays
// as two people who know each other rather than one man reading and one man interjecting.
// The interview is GATED on the guest actually being in the studio; if it isn't, the two of
// them cover instead — see the chair gate below.
function assembleTalkshowGraph(script, broadcastId, bucket, persona) {
  const pools = script.pools || {};
  const rand = sportsRng(sportsHash(...[...`${broadcastId}:${bucket}`].map(c => c.charCodeAt(0))));
  const host = script.host || 'npc_host';
  const sidekick = script.sidekick || host;
  const guestNpc = script.guestNpc || 'npc_guest';
  const guestName = persona?.name || "Tonight's Guest";
  const tok = {
    guest: guestName, title: persona?.title || 'our special guest',
    host: (world.npcs.get(host)?.name) || 'the host',
    sidekick: (world.npcs.get(sidekick)?.name) || 'the announcer',
  };

  const nodes = {};
  let n = 0, prevId = null, startId = null, curAnchor = null;
  const add = (data) => {
    const id = `ts_${n++}`;
    nodes[id] = { ...data };
    if (prevId) nodes[prevId].next = id;
    if (startId === null) startId = id;
    prevId = id;
    return id;
  };
  // Switch on-stage speaker only when it actually changes (npc_anchor nodes are the live
  // presence + attribution cue the walker keys off).
  const anchor = (npcId) => { if (npcId !== curAnchor) { add({ type: 'npc_anchor', npc_id: npcId }); curAnchor = npcId; } };
  const line = (npcId, text) => { if (!text) return; anchor(npcId); add({ type: 'say', text, style: 'raw' }); };
  const lines = (npcId, arr) => arr.forEach(t => line(npcId, t));
  // Build a detached run of nodes and hand back its ends, so a branch can be wired by hand.
  // `prevId`/`curAnchor` are saved and cleared: a branch must never inherit the trunk's
  // last node (that's the whole point) and must re-state its own anchor, because which
  // branch ran is not knowable when the graph is built.
  const branch = (fn) => {
    const savedPrev = prevId, savedAnchor = curAnchor;
    prevId = null; curAnchor = null;
    const before = n;
    fn();
    const out = { first: n > before ? `ts_${before}` : null, last: prevId };
    prevId = savedPrev; curAnchor = savedAnchor;
    return out;
  };
  // A two-hander: one authored line of `A >> B >> A >> B …` spoken by two people ALTERNATING.
  // This is how John and Graham talk to each other rather than past each other — the setup,
  // the reply and the topper are authored as one unit, so the timing survives the shuffle and
  // can't be dealt into a non-sequitur. Any number of turns: a two-beat jab and a four-beat
  // "wait, what?" run both come out of the same pool and read as the same relationship.
  const duet = (aNpc, bNpc, pair) => {
    if (!pair) return false;
    const turns = splitTurns(pair);
    let said = false;
    turns.forEach((t, i) => { if (t) { line(i % 2 ? bNpc : aNpc, talkshowFill(t, tok)); said = true; } });
    return said;
  };

  // Audience reactions — laughs, groans, applause between the jokes and around the guest
  // exchanges, so the room breathes and each line lands before the next. They're unattributed
  // stage business, so they go out as ambient (dim italic, no speaker, not read aloud) over an
  // empty anchor. Pre-drawn once and cycled so a single show doesn't repeat a reaction, and —
  // crucially — because we lean on the crowd to fill time, each SEGMENT draws fewer scripted
  // lines per night, leaving more of the pools unseen so the variety lasts across broadcasts.
  const reactionDeck = talkshowDraw(pools, 'audience', 40, tok, rand);
  const applauseDeck = talkshowDraw(pools, 'applause', 12, tok, rand);
  let rIdx = 0, aIdx = 0;
  const ambientBeat = (text, holdMs) => {
    if (!text) return;
    if (curAnchor !== '') { add({ type: 'npc_anchor', npc_id: '' }); curAnchor = ''; }
    add({ type: 'say', text, style: 'ambient', holdMs });
  };
  const react = () => { if (reactionDeck.length) ambientBeat(reactionDeck[rIdx++ % reactionDeck.length], 3500); };
  const applause = () => {
    if (applauseDeck.length) ambientBeat(applauseDeck[aIdx++ % applauseDeck.length], 4200);
    else react();
  };

  add({ type: 'start' });
  // Title card carries the theme when present: the intro plays over the card and the cold
  // open waits for it to end (title-card / theme sync). No card ⇒ standalone theme sting.
  if (script.title) add({ type: 'title_card', graphic_id: script.title, theme: script.theme || null });
  else if (script.theme) add({ type: 'music', song: script.theme, text: '♪ The theme plays. ♪' });

  // Cold open — the sidekick/announcer does the "It's the show!" intro + tonight's tease.
  // Line counts wobble night to night so the open never feels rote.
  lines(sidekick, talkshowDraw(pools, 'open', 1 + Math.floor(rand() * 2), tok, rand));   // 1–2
  lines(sidekick, talkshowDraw(pools, 'tease', 1 + Math.floor(rand() * 2), tok, rand));  // 1–2
  line(sidekick, talkshowFill(sportsPick(pools, rand, 'announce_host') || "Ladies and gentlemen — {host}!", tok));
  applause();   // the host walks out to applause
  // …and the first thing John does is talk to Graham. A late-night show opens on the two of
  // them, not on a monologue — the greeting is the moment the audience learns these two have
  // known each other a long time. Authored host-first, so it reads as John arriving at the desk.
  const greetDeck = talkshowDraw(pools, 'greeting', 2, tok, rand);
  if (duet(host, sidekick, greetDeck[0])) react();

  // Monologue — the host's opening jokes; 4–5 a night, each landing on an audience beat so the
  // room breathes between punchlines instead of the jokes running together.
  const jokes = talkshowDraw(pools, 'monologue', TALKSHOW_MONOLOGUE + Math.floor(rand() * 2), tok, rand);  // 4–5
  jokes.forEach((joke, i) => {
    line(host, joke);
    // A reaction after most jokes (always the last one, as the button into what follows).
    if (i === jokes.length - 1 || rand() < 0.7) react();
  });
  // The night's news bit — the host riffs on ONE real headline from the live feed (a live
  // story preferred over a wire one; see refreshTalkshowNewsStory). Once per show, folded in
  // right after the monologue as a second joke beat. Skips cleanly on nights the feed is empty
  // or the file has no `newsjoke` pool, so it's purely additive to the existing jokes.
  if (_talkshowNewsStory?.headline) {
    // Strip trailing punctuation so the authored line supplies its own around {headline}.
    const newsTok = { ...tok, headline: String(_talkshowNewsStory.headline).replace(/[.\s]+$/, '') };
    const newsBit = talkshowDraw(pools, 'newsjoke', 1, newsTok, rand);
    if (newsBit.length) { lines(host, newsBit); react(); }
  }
  // Sometimes the sidekick heckles back mid-monologue (~45% of nights) — a one-way jab, no reply.
  if (rand() < 0.45) { lines(sidekick, talkshowDraw(pools, 'sidekick_aside', 1, tok, rand)); react(); }
  // A proper back-and-forth most nights (~70%): Graham says something, John has to deal with it.
  // Authored sidekick-first so John gets the last word, which is the shape of the desk — the
  // announcer needles, the host recovers. One or two rounds; two only occasionally, so the show
  // doesn't stall on the two of them before the guest is even out.
  const banterDeck = talkshowDraw(pools, 'banter', 3, tok, rand);
  let bIdx = 0;
  if (rand() < 0.70 && duet(sidekick, host, banterDeck[bIdx++])) react();
  // Sometimes the host does a desk bit before the guest (~50%).
  if (rand() < 0.50) { lines(host, talkshowDraw(pools, 'desk_bit', 1, tok, rand)); react(); }
  if (rand() < 0.30 && duet(sidekick, host, banterDeck[bIdx++])) react();

  // Guest intro + interview — host welcomes tonight's persona (to applause), then 3–4 EXCHANGES.
  // Each exchange is an authored Q&A pair, so the host's question and the guest's reply belong
  // together; the night blends a couple of the guest's on-topic signature beats with generic
  // small-talk, shuffled, so the interview is coherent AND different every night. An audience
  // beat between exchanges gives the back-and-forth a live rhythm.
  line(host, talkshowFill(sportsPick(pools, rand, 'guest_intro') || "My next guest is {title}. Please welcome {guest}!", tok));
  applause();   // the guest takes the stage

  // THE CHAIR GATE. Everything past here depends on somebody actually sitting in it, and that
  // is a fact about the world at airtime, not about the script — the guest walks in across a
  // real map and can be late, lost or dead. Asked at showtime rather than assumed at build
  // time, because the alternative is what used to air: the say-node room-authority rule quietly
  // binning every answer while the questions went out anyway, and John interviewing furniture.
  // If the chair's empty the show KNOWS, and John and Graham cover for it, which is a better
  // three minutes of television than the interview would have been.
  const gate = add({ type: 'condition', condition_type: 'NPC_IN_STUDIO', params: { npc_id: guestNpc } });
  prevId = null;   // the gate wires its own two branches by hand, below

  const interview = branch(() => {
    // 3–4 EXCHANGES. Each is an authored Q&A pair, so the host's question and the guest's reply
    // belong together; the night blends a couple of the guest's on-topic signature beats with
    // generic small-talk, shuffled, so the interview is coherent AND different every night. An
    // audience beat between exchanges gives the back-and-forth a live rhythm.
    const exN = TALKSHOW_INTERVIEW + Math.floor(rand() * 2);   // 3–4
    const deck = talkshowExchangeDeck(pools, persona, exN + 1, rand);   // +1 spare for the follow-up
    // An exchange is normally question-then-answer, but it's read as ALTERNATING turns, so a
    // beat that needs a follow-up ("Tuesday." / "Which Tuesday?") can be authored as one unit
    // and keep its timing. Two turns is just the common case of that.
    const sayExchange = (pair, withBeat) => {
      const turns = splitTurns(pair);
      turns.forEach((t, i) => line(i % 2 ? guestNpc : host, talkshowFill(t, tok)));
      if (withBeat && turns.length) react();   // the crowd reacts before the next question
    };
    let ex = 0;
    const total = Math.min(exN, deck.length);
    for (; ex < total; ex++) sayExchange(deck[ex], ex < total - 1 && rand() < 0.6);
    // A second, shorter guest beat some nights (~35%) - one more on-topic exchange.
    if (rand() < 0.35 && deck[ex]) sayExchange(deck[ex], false);
    // Host throws back to the announcer on the way out of the segment.
    if (rand() < 0.5 && duet(host, sidekick, greetDeck[1])) react();
  });

  // The no-show. Graham is the one who has to explain it, John is the one who has to fill —
  // so the cover is a two-hander by nature, and the pair carry the segment the guest didn't.
  const noShow = branch(() => {
    const cover = talkshowDraw(pools, 'guest_noshow', 3, tok, rand);
    let did = false;
    for (let i = 0; i < Math.min(2 + Math.floor(rand() * 2), cover.length); i++) {
      if (duet(host, sidekick, cover[i])) { did = true; react(); }
    }
    // Nothing authored to cover with ⇒ the host eats it alone rather than airing silence.
    if (!did) { line(host, talkshowFill("Well — {guest} isn't here. That's showbusiness, and that's a chair.", tok)); react(); }
  });

  // Commercial — a quick sponsor break read as narration over the studio (an ad break, not the
  // host talking), one line so it doesn't overstay.
  prevId = null; curAnchor = null;   // the tail is reached from BOTH branches; wired below
  const tailFirst = `ts_${n}`;
  const ad = talkshowDraw(pools, 'commercial', 1, tok, rand);
  if (ad.length) { add({ type: 'npc_anchor', npc_id: '' }); curAnchor = ''; ad.forEach(t => add({ type: 'say', text: t, style: 'narration' })); }

  // Sign-off — host thanks the guest and says goodnight. ONE line, so the show never says
  // goodnight twice.
  applause();
  lines(host, talkshowDraw(pools, 'signoff', 1, { ...tok }, rand));

  // Wire the gate now that the tail exists. An empty branch routes straight to the tail, so a
  // missing pool can never strand the walker on a dead port mid-show; and if the tail itself
  // came out empty (no ad, no applause, no signoff authored) every edge is left undefined,
  // which the walker reads as "the show is over" rather than as a dangling node id.
  const tail = nodes[tailFirst] ? tailFirst : null;
  nodes[gate].ifTrue  = interview.first || tail;
  nodes[gate].ifFalse = noShow.first    || tail;
  if (interview.last) nodes[interview.last].next = tail;
  if (noShow.last)    nodes[noShow.last].next    = tail;

  const graph = _normalizeBroadcastGraph({ _start: startId, nodes });
  graph._broadcastId = `${broadcastId}:talkshow:${bucket}`;
  graph._requireHost = true;   // presence-gate: no cast in studio ⇒ camera-idle → tech-diff
  return graph;
}

// Return the night's assembled episode for a talk-show playlist item, rebuilt when the day
// bucket rolls (new guest, new jokes). Cached on the item between ticks.
function getTalkshowGraph(item, nowMs) {
  const script = item.talkshowScript;
  if (!script) return null;
  const bucket = talkshowDayBucket();
  if (item._talkshowGraph && item._talkshowBucket === bucket) return item._talkshowGraph;
  const persona = talkshowPersonaFor(script, bucket);
  item._talkshowGraph = assembleTalkshowGraph(script, item.broadcastId, bucket, persona);
  item._talkshowBucket = bucket;
  return item._talkshowGraph;
}

// ── Guest lifecycle plumbing ─────────────────────────────────────────────────
// The reusable guest lives off-world between episodes in a hidden backstage zone (no exits,
// no map — unreachable by players), and is renamed to the night's persona so it walks in as
// the right character. The engine's TALKSHOW_APPEAR/HIDE actions do the movement; here we
// (a) ensure the backstage zone exists, (b) expose which zones are being watched so the
// guest only ever materialises where no one/no camera can see it "appear", and (c) rename
// the guest once per episode.

const TALKSHOW_BACKSTAGE_ZONE = 'zone_talkshow_backstage';
let _backstageReady = false;
async function ensureBackstageZone() {
  if (_backstageReady) return TALKSHOW_BACKSTAGE_ZONE;
  await query(
    `INSERT INTO zones (id, name, description, exits, flags)
       VALUES ($1, $2, $3, '{}'::jsonb, $4::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [TALKSHOW_BACKSTAGE_ZONE, 'Backstage', 'A featureless holding space between the world and the wings. Nothing reaches here.', JSON.stringify({ no_spawn: true })]
  ).catch(() => {});
  try { await reloadZone(TALKSHOW_BACKSTAGE_ZONE); } catch { /* loaded lazily on next reload */ }
  _backstageReady = true;
  return TALKSHOW_BACKSTAGE_ZONE;
}

// Zones a camera or planted device is actively watching — the guest must NEVER "appear" or
// "vanish" in one of these on-screen. Cached from the DB and refreshed on a slow cadence;
// read synchronously by the engine's guest actions through the bridge.
const _watchedZones = new Set();
async function refreshWatchedZones() {
  const next = new Set();
  // Player-planted devices stay a live read: security_devices is deliberately
  // read-tier 'fresh' (its writers — plant/retrieve/smash/drone-move/battery —
  // are uncoordinated), so there's no funnel to hang an invalidation event off.
  // A missed event here wouldn't error; the talkshow guest would just start
  // materialising on camera, which is exactly the silent-staleness trade the
  // cache-safety rule exists to refuse. One query per cycle buys that away.
  try {
    const { rows } = await query(
      `SELECT DISTINCT zone_id FROM security_devices WHERE device_kind IN ('sticky_cam','drone') AND COALESCE(is_damaged,0)=0`
    );
    for (const r of rows) if (r.zone_id) next.add(r.zone_id);
  } catch { /* table may not exist in a bare test DB — leave device zones out */ }
  // Studio/PD cameras: cameraZoneStatus already answers "has a working (powered,
  // undamaged) camera" per zone — the same predicate this used to re-query for.
  // It's rebuilt by loadChannelRuntimes at boot and after every media_cameras
  // write, and is_powered/is_damaged only ever change through the dev CRUD, which
  // reloads. So the query was redundant with a cache that's already correct.
  for (const [zoneId, working] of cameraZoneStatus) if (working && zoneId) next.add(zoneId);
  _watchedZones.clear();
  for (const z of next) _watchedZones.add(z);
}
registerZoneWatchedChecker((zoneId) => _watchedZones.has(zoneId));
// Idle-gated (like gameLoop's resourceTick): every recurring broadcast heartbeat
// skips its DB reads while nobody is online — with an empty server these ticks
// were ~80% of steady-state DB traffic, holding pool slots for no one. All of
// them derive their state from the clock or from player-driven rows, so the
// first tick after a login catches up correctly. The one-shot boot warmups
// below each interval stay ungated so caches are warm for a quick first login.
schedule('15s', () => refreshWatchedZones().catch(() => {}));
setTimeout(() => { refreshWatchedZones().catch(() => {}); }, 8000);

// Rename the reusable guest to tonight's persona, once per episode bucket, so it appears +
// performs as the right character. Runs on a heartbeat regardless of viewers, so the guest's
// identity is set before it walks on. Deduped per (guestNpc, bucket).
const _talkshowRenamed = new Map();   // guestNpc -> last bucket renamed
async function talkshowHeartbeat() {
  const bucket = talkshowDayBucket();
  const seen = new Set();
  for (const state of channelRuntime.values()) {
    for (const item of (state.playlist || [])) {
      const script = item.talkshowScript;
      if (item.playback_mode !== 'talkshow' || !script?.guestNpc) continue;
      const guestNpc = script.guestNpc;
      if (seen.has(guestNpc)) continue;
      seen.add(guestNpc);
      if (_talkshowRenamed.get(guestNpc) === bucket) continue;
      const persona = talkshowPersonaFor(script, bucket);
      const desc = persona.title
        ? `${persona.name} — ${persona.title}. Tonight's guest on ${item.broadcastName || 'the show'}.`
        : `${persona.name}, tonight's guest on ${item.broadcastName || 'the show'}.`;
      await query(`UPDATE npcs SET name=$1, description=$2 WHERE id=$3`, [persona.name, desc, guestNpc]).catch(() => {});
      const live = world.npcs.get(guestNpc);
      if (live) { live.name = persona.name; live.description = desc; }
      _talkshowRenamed.set(guestNpc, bucket);
    }
  }
}
schedule('1m', () => talkshowHeartbeat().catch(e => console.error('[broadcast] talkshow heartbeat error:', e.message)));
setTimeout(() => { talkshowHeartbeat().catch(() => {}); }, 10000);

// ── Morning shows ────────────────────────────────────────────────────────────
// A morning show (playback_mode 'morning') is the talk show's daytime cousin: the same
// ::lines library, the same live-ACTED staging by real npc_ cast — but where a talk show's
// variable is the night's GUEST, a morning show's variable is the WORLD. Every segment is
// keyed to something live: the cold open reads the clock and the thermometer, the weather
// window reads the forecast, the Basin Beat reads the news generator, the run-in reads the
// city's alerts (martial law, radiation, grid faults, severe weather), and the ticker is
// assembled from those facts rather than authored.
//
// The couch's back-and-forth is preserved by authoring every pool as an exchange PAIR —
// "host line >> cohost line", the same `>>` convention the talk-show interview uses — so the
// setup and the deadpan always belong together no matter which alternative is drawn.
// Spec: docs/bsm-format.md#morning-shows-type-morning.

const MORNING_STORIES = 2;   // featured Basin Beat stories per show (the rest ride the ticker)
const MORNING_BLACKOUT_MIN = 2;   // grid-connected zones dark before the run-in calls it an outage

// Episode bucket = the in-game calendar day: one show a day, identical on every TV.
function morningDayBucket() {
  const env = getEnvironmentState();
  return (typeof env?.date === 'string' && env.date.length >= 10) ? env.date.slice(0, 10) : 'day0';
}

// Which run-in the city gets this morning. Ordered worst-first, so a martial-law morning
// never leads with a traffic note. Falls through to 'clear' on an ordinary day.
function morningRunInKey(ctx) {
  if (ctx.martialLaw) return 'martial_law';
  if (ctx.radiation) return 'radiation';
  if (ctx.outages >= MORNING_BLACKOUT_MIN) return 'blackout';
  if ((ctx.env.forecast?.[0]?.severity ?? 0) >= WX_SEVERE) return 'storm';
  return 'clear';
}

// Live world → the tokens the couch speaks in. Everything here is read, never authored.
function morningTokens(script, ctx) {
  const env = ctx.env;
  const today = env.forecast?.[0] || {};
  const tomorrow = env.forecast?.[1] || today;
  // The forecast is empty until the weather plugin's first tick, so the week's arc falls
  // back to today's reading rather than speaking a blank number.
  const temps = (env.forecast || []).map(f => Math.round(f.tempC)).filter(Number.isFinite);
  const nowTemp = Math.round(env.tempC ?? 0);
  return {
    host: world.npcs.get(script.host)?.name || 'the host',
    cohost: world.npcs.get(script.cohost)?.name || 'the co-host',
    time: env.time || '', day: WX_DOW[env.dayOfWeek] || '', date: (env.date || '').slice(5), season: env.season || '',
    temp: Math.round(env.tempC ?? today.tempC ?? 0),
    feels: Math.round(env.feelsLikeC ?? env.tempC ?? 0),
    weather: String(env.currentWeatherType || env.weatherType || '').replace(/_/g, ' '),
    wind: Math.round(today.windKph ?? 0), windLabel: wxWindLabel(today.windKph),
    precip: Math.round((today.precipChance ?? 0) * 100),
    hi: temps.length ? Math.max(...temps) : nowTemp, lo: temps.length ? Math.min(...temps) : nowTemp,
    tomorrow: String(tomorrow.weatherType || '').replace(/_/g, ' '), tomorrowTemp: Math.round(tomorrow.tempC ?? env.tempC ?? 0),
    outages: ctx.outages,
  };
}

// Assemble one morning's show. Deterministic given the day bucket (seeded rng) so every TV in
// the city shows the same broadcast. Segments: title/theme → cold open (clock + thermometer) →
// weather window (live forecast) → the Basin Beat (live news) → a rotating segment → Your
// Morning Run-In (live alerts) → a fact-assembled ticker → sign-off.
function assembleMorningGraph(script, broadcastId, bucket, ctx) {
  const pools = script.pools || {};
  const rand = sportsRng(sportsHash(...[...`${broadcastId}:${bucket}`].map(c => c.charCodeAt(0))));
  const host = script.host || 'npc_host';
  const cohost = script.cohost || host;
  const tok = morningTokens(script, ctx);

  const nodes = {};
  let n = 0, prevId = null, startId = null, curAnchor = null;
  const add = (data) => {
    const id = `mn_${n++}`;
    nodes[id] = { ...data };
    if (prevId) nodes[prevId].next = id;
    if (startId === null) startId = id;
    prevId = id;
    return id;
  };
  const anchor = (npcId) => { if (npcId !== curAnchor) { add({ type: 'npc_anchor', npc_id: npcId }); curAnchor = npcId; } };
  const line = (npcId, text) => { if (!text) return; anchor(npcId); add({ type: 'say', text, style: 'raw' }); };
  // Draw from a pool without repeating inside one show: each key gets a shuffled deck the
  // first time it's asked for, then walks it. Two stories in a row can't land on the same
  // "isn't that something?" — which a per-call random pick does surprisingly often.
  const decks = new Map();
  const draw = (keys) => {
    for (const k of keys) {
      const arr = pools[k];
      if (!Array.isArray(arr) || !arr.length) continue;
      if (!decks.has(k)) decks.set(k, { deck: sportsShuffle(arr, rand), i: 0 });
      const d = decks.get(k);
      return d.deck[d.i++ % d.deck.length];
    }
    return null;
  };
  // One authored beat is a "host >> cohost" pair (splitExchange, shared with the talk show):
  // the host sets it up, the co-host answers. A line with no `>>` is spoken by the host alone.
  const beat = (key, extraTok, fallback) => {
    const src = draw(Array.isArray(key) ? key : [key]) || fallback;
    if (!src) return false;
    const t = extraTok ? { ...tok, ...extraTok } : tok;
    const [q, a] = splitExchange(src);
    if (q) line(host, talkshowFill(q, t).trim());
    if (a) line(a && !q ? host : cohost, talkshowFill(a, t).trim());
    return true;
  };
  // A show-specific segment banner, authored as "TEXT | SUBTEXT" so the caption strip stays
  // content rather than engine copy. Missing pool ⇒ no overlay, the segment just plays.
  const banner = (key) => {
    const src = draw([key]);
    if (!src) return;
    const [text, subtext = ''] = talkshowFill(src, tok).split('|').map(s => s.trim());
    if (text) add({ type: 'overlay', overlayType: 'lower_third', text, subtext, graphic_id: '' });
  };

  add({ type: 'start' });
  if (script.title) add({ type: 'title_card', graphic_id: script.title, theme: script.theme || null });
  else if (script.theme) add({ type: 'music', song: script.theme, text: '♪ The morning theme plays. ♪' });

  // Cold open — the real clock, the real temperature, the real day of the week.
  beat('open', null, 'Good morning — it is {time}, it is {temp} degrees, and you are alive. >> Statistically.');
  if (rand() < 0.6) beat('couch');

  // Weather window — keyed to what the sky is actually doing, with the severe channel
  // folded in only when the forecast earns it, and a look at tomorrow.
  banner('weather.banner');
  beat([`weather.${(ctx.env.currentWeatherType || ctx.env.weatherType || '').replace(/\s+/g, '_')}`, 'weather'],
    null, 'Out the window: {weather}, {temp} degrees, feels like {feels}. >> Feels like {feels}. It always feels like {feels}.');
  // A hero day gets its own beat instead of the generic severe one — the whole
  // point of a week's notice is that the morning show is still saying it on the
  // day. Falls back to weather.severe if a new event has no pool authored yet.
  const amHero = ctx.env.forecast?.[0]?.heroEvent;
  if (amHero && WX_EVENT_POOL[amHero]) beat([`weather.${WX_EVENT_POOL[amHero]}`, 'weather.severe']);
  else if ((ctx.env.forecast?.[0]?.severity ?? 0) >= WX_SEVERE) beat('weather.severe');
  // Only look ahead when there IS an ahead — the forecast is empty until the weather
  // plugin's first tick, and a look-ahead with no day to look at reads as a dropped line.
  if (ctx.env.forecast?.[1] && rand() < 0.7) beat('weather.ahead');

  // The Basin Beat — the live news feed, read off the couch. The host takes the headline,
  // the co-host takes the reaction, and some mornings they dig into the body copy.
  const feature = (ctx.stories || []).slice(0, MORNING_STORIES);
  if (feature.length) {
    banner('beat.banner');
    feature.forEach((s, idx) => {
      const stok = { headline: String(s.headline || '').replace(/[.\s]+$/, ''), body: s.body || '', byline: s.byline || 'the wire' };
      beat('beat.lead', stok, '{headline}. >> And there it is.');
      if (rand() < 0.5) beat('beat.detail', stok);
      if (idx === 0 && rand() < 0.4) beat('beat.aside', stok);
    });
  }

  // A rotating recurring segment (the hotplate bit, the mailbag, whatever the file supplies).
  if (rand() < 0.8) { banner('segment.banner'); beat('segment'); }

  // Your Morning Run-In — what the city is actually doing to you today.
  banner('runin.banner');
  beat([`runin.${morningRunInKey(ctx)}`, 'runin']);

  // Ticker — assembled from the same live facts, not authored: conditions, the alerts that
  // apply, and the headlines that didn't make the couch. `ticker.lead` is a plain prefix line.
  const crawl = [];
  const lead = draw(['ticker.lead']);
  if (lead) crawl.push(talkshowFill(lead, tok).trim());
  crawl.push(`${tok.weather.toUpperCase()} · ${tok.temp}° (feels ${tok.feels}°) · high ${tok.hi}° low ${tok.lo}°`);
  if (ctx.martialLaw) crawl.push('MARTIAL LAW IN EFFECT — CURFEW ENFORCED BASIN-WIDE');
  if (ctx.radiation) crawl.push('RADIATION ADVISORY — SHELTER AND SEAL WHERE POSSIBLE');
  if (ctx.outages >= MORNING_BLACKOUT_MIN) crawl.push(`GRID FAULTS REPORTED IN ${ctx.outages} BLOCKS — CREWS DISPATCHED`);
  for (const s of (ctx.stories || []).slice(MORNING_STORIES)) if (s.headline) crawl.push(String(s.headline).replace(/[.\s]+$/, ''));
  add({ type: 'ticker', text: crawl.filter(Boolean).join(' · ') });

  beat('signoff', null, "That's the morning. >> Go be statistically alive.");
  // Credits are the one pool that isn't alternatives — every line is a card of the same
  // roll, so they're joined rather than picked between.
  const credits = Array.isArray(pools.credits) ? pools.credits.join('\n') : '';
  if (credits) { curAnchor = null; add({ type: 'credits', text: talkshowFill(credits, tok), duration: 5 }); }

  const graph = _normalizeBroadcastGraph({ _start: startId, nodes });
  graph._broadcastId = `${broadcastId}:morning:${bucket}`;
  graph._requireHost = true;   // acted live on the couch — no hosts in-studio ⇒ tech difficulties
  return graph;
}

// Return today's assembled show for a morning playlist item, rebuilt when the in-game day
// rolls. Cached on the item between ticks; the live reads (news generator, world alerts)
// happen once per bucket, never per tick.
async function getMorningGraph(item, nowMs) {
  const script = item.morningScript;
  if (!script) return null;
  const bucket = morningDayBucket();
  if (item._morningGraph && item._morningBucket === bucket) return item._morningGraph;
  const env = getEnvironmentState();
  let stories = [];
  try {
    const res = await dispatchAction({ type: 'news.getStories', params: { total: MORNING_STORIES + 3 } });
    if (Array.isArray(res?.stories)) stories = res.stories;
  } catch { /* generator unavailable — the show just runs without a Basin Beat */ }
  const [martialLaw, radiation] = await Promise.all([
    getFlag('world', 'martial_law').catch(() => undefined),
    getFlag('world', 'nuclear_event').catch(() => undefined),
  ]);
  // A grid-connected zone sitting dark is a fault, not an unwired ruin — so only zones that
  // have a generator count toward the morning's outage number.
  const outages = (env.powerMap || []).filter(z => z.generatorId && z.status === 'unpowered').length;
  const ctx = { env, stories, outages, martialLaw: String(martialLaw) === 'true', radiation: String(radiation) === 'true' };
  item._morningGraph = assembleMorningGraph(script, item.broadcastId, bucket, ctx);
  item._morningBucket = bucket;
  return item._morningGraph;
}

async function getCurrentMessage(state, nowMs) {
  const { channelType, playlist, totalDuration, idleBroadcast, newsCategories, camera, loopOriginMs, scheduleMode } = state;

  // Dynamic news channels: pop from queue — but if a VINE-graph item is active, let the graph manage it
  if (channelType === 'news') {
    const elapsed = playlist.length && totalDuration > 0 ? ((nowMs - loopOriginMs) / 1000) % totalDuration : -1;
    const activeItem = elapsed >= 0 ? playlist.find(i => elapsed >= i.startTime && elapsed < i.startTime + i.duration) : null;
    // A scripted news bulletin (playback_mode 'news') assembles live from the news
    // generator — handle it before the generic graph check, or its start-only stored
    // graph would air empty.
    if (activeItem?.playback_mode === 'news') {
      const nwGraph = await getNewsGraph(activeItem, nowMs);
      if (nwGraph) return tickBroadcastGraph(state.channelId, nwGraph, state, nowMs);
    }
    if (activeItem?.broadcastGraph) return tickBroadcastGraph(state.channelId, activeItem.broadcastGraph, state, nowMs);
    const q = newsQueue.get(state.channelId) || [];
    const item = q.shift();
    return item ? { text: item.text, key: `news:${item.ts}` } : null;
  }

  // Daily schedule mode — start_time is seconds from midnight (0–86399)
  // Checked before live camera so VINE graphs always tick for live+daily channels.
  if (scheduleMode === 'daily' && playlist.length) {
    const { minutes, dayOfWeek } = getEnvironmentState();
    const gameSecondsSinceMidnight = minutes * 60;
    const item = _pickDailySlot(playlist, gameSecondsSinceMidnight, dayOfWeek);
    if (item) {
      if (item.slotType === 'commercial_break') return _playCommercial(state, nowMs);
      state.currentFallbackMessages = item.fallbackMessages || [];
      state.currentProgramName = item.broadcastName || null;
      const segElapsed = gameSecondsSinceMidnight - item.startTime;
      if (item.playback_mode === 'weather') {
        const wxGraph = getWeatherGraph(item);
        if (wxGraph) {
          const r = tickBroadcastGraph(state.channelId, wxGraph, state, nowMs, segElapsed);
          if (r) r.programName = item.broadcastName || null;
          return r;
        }
      }
      // Sports — the same global game regardless of channel type; seek to where it is
      // on the shared clock so a daily-scheduled TV shows the identical in-progress game.
      // A `airSlots` broadcast only shows its featured game(s); otherwise this channel is
      // dark now (falls through to off-air / its other content).
      if (item.playback_mode === 'sports' && sportsAiring(item.sportsScript)) {
        // Warm THIS sport's record cache + season before its graph assembles — the
        // announcer's records line and any postseason takeover both read them.
        await refreshStandings(nowMs, sportOf(item.sportsScript).id);
        await refreshSeason(nowMs, sportOf(item.sportsScript).id);
        const spGraph = getSportsGraph(item.sportsScript, sportsSlotIndex(), overrideFor(item.sportsScript));
        if (spGraph) {
          const r = tickBroadcastGraph(state.channelId, spGraph, state, nowMs, sportsSegElapsedSec());
          if (r) r.programName = item.broadcastName || null;
          return r;
        }
      }
      // News — a fresh bulletin assembled from the live news generator each refresh bucket.
      if (item.playback_mode === 'news') {
        const nwGraph = await getNewsGraph(item, nowMs);
        if (nwGraph) {
          const r = tickBroadcastGraph(state.channelId, nwGraph, state, nowMs, segElapsed);
          if (r) r.programName = item.broadcastName || null;
          return r;
        }
      }
      // Talk show — tonight's episode, acted live by the cast. Only airs in its @airtime
      // slot; outside it the channel is dark here and falls through to idle/off-air.
      if (item.playback_mode === 'talkshow' && talkshowAiring(item.talkshowScript)) {
        const tsGraph = getTalkshowGraph(item, nowMs);
        if (tsGraph) {
          state.currentFallbackMessages = item.fallbackMessages || [];
          const r = tickBroadcastGraph(state.channelId, tsGraph, state, nowMs, segElapsed);
          if (r) r.programName = item.broadcastName || null;
          return r;
        }
      }
      // Morning show — today's episode, assembled from the live world and acted on the couch.
      // Its airtime IS this daily slot, so there's no separate gate.
      if (item.playback_mode === 'morning') {
        const mnGraph = await getMorningGraph(item, nowMs);
        if (mnGraph) {
          state.currentFallbackMessages = item.fallbackMessages || [];
          const r = tickBroadcastGraph(state.channelId, mnGraph, state, nowMs, segElapsed);
          if (r) r.programName = item.broadcastName || null;
          return r;
        }
      }
      // Sermon — this week's service, preached over the live news feed. Dynamic but
      // not acted, so no presence gate: it airs whether or not anyone is in a studio.
      if (item.playback_mode === 'sermon') {
        const smGraph = await getSermonGraph(item, nowMs);
        if (smGraph) {
          state.currentFallbackMessages = item.fallbackMessages || [];
          const r = tickBroadcastGraph(state.channelId, smGraph, state, nowMs, segElapsed);
          if (r) r.programName = item.broadcastName || null;
          return r;
        }
      }
      // Game show — today's lots, played out on the studio floor. Only airs in its
      // @airtime slot, same convention as the talk show.
      if (item.playback_mode === 'gameshow' && gameshowAiring(item.gameshowScript, sportsSlotOfDay())) {
        const gsGraph = getGameshowGraph(item, _normalizeBroadcastGraph);
        if (gsGraph) {
          state.currentFallbackMessages = item.fallbackMessages || [];
          const r = tickBroadcastGraph(state.channelId, gsGraph, state, nowMs, segElapsed);
          if (r) r.programName = item.broadcastName || null;
          return r;
        }
      }
      // Film — a fixed linear picture, but the only broadcast whose seek has to be
      // converted. Every other daily slot is authored on the in-game clock, so
      // `segElapsed` (in-game seconds into the slot) is exactly what the seeker wants.
      // A feature is authored in REAL time — a 150-minute runtime is 150 minutes of
      // someone's evening — so the elapsed in-game seconds are divided back down by
      // the game's time scale before seeking. Get this wrong and a viewer who walks in
      // ten minutes late finds the reel already at the credits.
      // A feature is longer than one block at any clock faster than 1×, so it is pinned
      // across a RUN of consecutive blocks and the elapsed time is measured from the
      // head of that run — otherwise the picture restarts from the distributor card
      // every time the schedule rolls into the next hour.
      if (item.playback_mode === 'film' && item.broadcastGraph) {
        const ts = getEnvironmentState()?.timeScale || 1;
        const realElapsed = filmRunElapsed(item, gameSecondsSinceMidnight) / ts;
        // Blocks are reserved in whole 3-hour units, so a picture almost never fills its
        // last one exactly — 174 minutes of film sits in 180 minutes of schedule.
        if (!(item.filmRuntime > 0) || realElapsed < item.filmRuntime) {
          const r = tickBroadcastGraph(state.channelId, item.broadcastGraph, state, nowMs, realElapsed);
          if (r) r.programName = item.broadcastName || null;
          return r;
        }
        // The reel has ended inside its own screening. Same rule as every other
        // loop-filled slot: the tail plays commercials, cut off cleanly when the
        // schedule moves on (_loopFillOrNull does exactly this for looping graphs).
        // A film must NOT fall through to the generic paths below — the walker would
        // wrap to _start and put the distributor card back up, and the flat-message
        // path would read the picture's whole dialogue list out as bare lines.
        // Park the blackboard so tomorrow's screening seeks cleanly from the top.
        const bb = state.graphBlackboard;
        if (bb && bb.activeBroadcastId === item.broadcastGraph._broadcastId) {
          bb.currentNode = null;
          bb.waitUntil = null;
          bb.activeBroadcastId = null;
        }
        state.currentProgramName = null;
        return _fillCommercialTail(realElapsed - item.filmRuntime, state.commercialBroadcasts || []);
      } else if (item.broadcastGraph) {
        const r = tickBroadcastGraph(state.channelId, item.broadcastGraph, state, nowMs, segElapsed);
        if (r) r.programName = item.broadcastName || null;
        return r;
      }
      // Flat messages — loop within the slot duration, inserting a random commercial between cycles
      const cycleDur = item.messages.length * (item.message_interval || 5);
      if (cycleDur > 0) {
        const ads = state.commercialBroadcasts || [];
        if (ads.length > 0) {
          // Walk cycles: [broadcast cycleDur] [commercial adDur] [broadcast ...] ...
          let t = 0;
          let cycleNum = 0;
          while (true) {
            if (segElapsed < t + cycleDur) {
              const result = getScriptedMessage(item.messages, item.message_interval, segElapsed - t);
              if (result) return { text: result.text, key: `${item.broadcastId}:${result.idx}`, programName: item.broadcastName || null };
              return null;
            }
            const ad = ads[cycleNum % ads.length];
            const adDur = ad.messages.length * (ad.message_interval || 5);
            if (segElapsed < t + cycleDur + adDur) {
              const adElapsed = segElapsed - (t + cycleDur);
              const adResult = getScriptedMessage(ad.messages, ad.message_interval || 5, adElapsed);
              if (adResult) return { text: adResult.text, key: `commercial:${ad.id}:${adResult.idx}`, programName: item.broadcastName || null };
              return null;
            }
            t += cycleDur + adDur;
            cycleNum++;
          }
        }
        const loopedElapsed = segElapsed % cycleDur;
        const result = getScriptedMessage(item.messages, item.message_interval, loopedElapsed);
        if (result) return { text: result.text, key: `${item.broadcastId}:${result.idx}`, programName: item.broadcastName || null };
      }
    }
    // Nothing scheduled right now — fall through to idle
    state.currentProgramName = null;
    if (idleBroadcast?.messages?.length) {
      const result = getScriptedMessage(idleBroadcast.messages, idleBroadcast.message_interval, (nowMs / 1000) % (idleBroadcast.messages.length * (idleBroadcast.message_interval || 5)));
      if (result) return { text: result.text, key: `idle:${result.idx}` };
    }
    return null;
  }

  // Live camera (non-daily channels only — daily channels handled above)
  if (channelType === 'live' && camera) {
    const text = buildCameraSnapshot(camera.zone_id);
    return text ? { text, key: `cam:${nowMs}` } : null;
  }

  // Playlist-based loop (playlist | mixed | emergency)
  if (playlist.length && totalDuration > 0) {
    const elapsed = ((nowMs - loopOriginMs) / 1000) % totalDuration;
    const item = playlist.find(i => elapsed >= i.startTime && elapsed < i.startTime + i.duration);
    if (item) {
      if (item.slotType === 'commercial_break') return _playCommercial(state, nowMs);
      if (item.playback_mode === 'live_camera' && camera) {
        const text = buildCameraSnapshot(camera.zone_id);
        return text ? { text, key: `cam:${nowMs}` } : null;
      }
      if (item.playback_mode === 'dynamic_news') {
        const q = newsQueue.get(state.channelId) || [];
        const ni = q.shift();
        return ni ? { text: ni.text, key: `news:${ni.ts}` } : null;
      }
      if (item.playback_mode === 'recorded' && camera) {
        const { rows: camRows } = await query('SELECT recording_buffer FROM media_cameras WHERE id=$1', [camera.id]).catch(() => ({ rows: [] }));
        const buf = camRows[0] ? (Array.isArray(camRows[0].recording_buffer) ? camRows[0].recording_buffer : JSON.parse(camRows[0].recording_buffer || '[]')) : [];
        if (buf.length) {
          const bufElapsed = elapsed - item.startTime;
          const bufIdx = Math.floor(bufElapsed / (item.message_interval || 5)) % buf.length;
          const entry = buf[bufIdx];
          if (entry) return { text: entry.text, key: `rec:${camera.id}:${bufIdx}` };
        }
        return null;
      }
      // Weather — assemble a fresh graph from the live forecast, then walk it.
      // item.loop=1: gate the same way as an authored graph, but since this graph
      // is regenerated live, its one-pass length is measured fresh each tick rather
      // than precomputed at load.
      if (item.playback_mode === 'weather') {
        const wxGraph = getWeatherGraph(item);
        if (wxGraph) {
          state.currentFallbackMessages = item.fallbackMessages || [];
          const segElapsed = elapsed - item.startTime;
          const gated = _loopFillOrNull(state, item, wxGraph, segElapsed, _vineDuration(wxGraph, item.message_interval || 5));
          if (gated !== undefined) return gated;
          return tickBroadcastGraph(state.channelId, wxGraph, state, nowMs);
        }
      }
      // Sports — the ONE global game for this hour's slot, the same on every TV. The
      // slot is keyed to absolute wall-clock time, so all channels render the same game
      // and seek to the same beat; tuning in drops you in mid-game. Betting/standings
      // events come from the background heartbeat (below), not the airing, so they fire
      // with nobody watching.
      if (item.playback_mode === 'sports' && sportsAiring(item.sportsScript)) {
        // Warm THIS sport's record cache + season before its graph assembles — the
        // announcer's records line and any postseason takeover both read them.
        await refreshStandings(nowMs, sportOf(item.sportsScript).id);
        await refreshSeason(nowMs, sportOf(item.sportsScript).id);      // is the World Series on? if so, run the finalists
        const spGraph = getSportsGraph(item.sportsScript, sportsSlotIndex(), overrideFor(item.sportsScript));
        if (spGraph) {
          state.currentFallbackMessages = item.fallbackMessages || [];
          return tickBroadcastGraph(state.channelId, spGraph, state, nowMs, sportsSegElapsedSec());
        }
      }
      // News — a fresh bulletin from the live news generator, re-rolled per refresh bucket
      if (item.playback_mode === 'news') {
        const nwGraph = await getNewsGraph(item, nowMs);
        if (nwGraph) {
          state.currentFallbackMessages = item.fallbackMessages || [];
          const segElapsed = elapsed - item.startTime;
          const gated = _loopFillOrNull(state, item, nwGraph, segElapsed, _vineDuration(nwGraph, item.message_interval || 5));
          if (gated !== undefined) return gated;
          return tickBroadcastGraph(state.channelId, nwGraph, state, nowMs);
        }
      }
      // Talk show — tonight's episode, acted live. Airs only in its @airtime slot; outside
      // it, fall through so the channel goes off-air (offline graphic / static).
      if (item.playback_mode === 'talkshow' && talkshowAiring(item.talkshowScript)) {
        const tsGraph = getTalkshowGraph(item, nowMs);
        if (tsGraph) {
          state.currentFallbackMessages = item.fallbackMessages || [];
          return tickBroadcastGraph(state.channelId, tsGraph, state, nowMs);
        }
      }
      // Morning show — today's episode, assembled from the live world and acted on the couch.
      if (item.playback_mode === 'morning') {
        const mnGraph = await getMorningGraph(item, nowMs);
        if (mnGraph) {
          state.currentFallbackMessages = item.fallbackMessages || [];
          const segElapsed = elapsed - item.startTime;
          const gated = _loopFillOrNull(state, item, mnGraph, segElapsed, _vineDuration(mnGraph, item.message_interval || 5));
          if (gated !== undefined) return gated;
          return tickBroadcastGraph(state.channelId, mnGraph, state, nowMs);
        }
      }
      // Game show — today's lots, played out live on the studio floor. Airs only in its
      // @airtime slot; outside it, fall through so the channel goes off-air. Like the talk
      // show (and unlike news/morning) it owns its whole block, so there's no commercial
      // tail to fill — the rounds pace themselves.
      if (item.playback_mode === 'gameshow' && gameshowAiring(item.gameshowScript, sportsSlotOfDay())) {
        const gsGraph = getGameshowGraph(item, _normalizeBroadcastGraph);
        if (gsGraph) {
          state.currentFallbackMessages = item.fallbackMessages || [];
          return tickBroadcastGraph(state.channelId, gsGraph, state, nowMs);
        }
      }
      // VINE graph (scripted/news with broadcast_graph) — walker manages its own timing.
      // item.loop=1: once a full pass wouldn't fit again before the slot ends, stop
      // feeding the graph and fill the leftover tail with commercials instead — same
      // policy as the flat-list case above, just gated on the graph's one-pass length.
      if (item.broadcastGraph) {
        state.currentFallbackMessages = item.fallbackMessages || [];
        const segElapsed = elapsed - item.startTime;
        const gated = _loopFillOrNull(state, item, item.broadcastGraph, segElapsed, item.passDuration);
        if (gated !== undefined) return gated;
        return tickBroadcastGraph(state.channelId, item.broadcastGraph, state, nowMs);
      }
      // scripted flat list
      const segElapsed = elapsed - item.startTime;
      return _fillLoopSlot(item, segElapsed, state.commercialBroadcasts || []);
    }
  }

  // Mixed: also check news queue when no playlist item covers current time
  if (channelType === 'mixed') {
    const q = newsQueue.get(state.channelId) || [];
    const ni = q.shift();
    if (ni) return { text: ni.text, key: `news:${ni.ts}` };
  }

  // Idle broadcast fallback
  if (idleBroadcast && idleBroadcast.messages.length) {
    const elapsed = (nowMs - loopOriginMs) / 1000;
    const result = getScriptedMessage(idleBroadcast.messages, idleBroadcast.message_interval, elapsed % (idleBroadcast.messages.length * (idleBroadcast.message_interval || 5)));
    if (result) return { text: result.text, key: `idle:${result.idx}` };
  }

  return null;
}

// ── Broadcast restart ─────────────────────────────────────────────────────────

function restartChannelBroadcast(channelId) {
  const state = channelRuntime.get(channelId);
  if (!state) return false;
  // Null the activeBroadcastId so tickBroadcastGraph resets to _start on the next tick
  if (state.graphBlackboard) state.graphBlackboard.activeBroadcastId = null;
  state.lastMsgKey = '';
  // Evict deck cache for every zone tuned to this channel so flat-list position resets too
  for (const [zoneId, tunings] of zoneTunings) {
    if (tunings.has(channelId)) _deckCache.delete(zoneId);
  }
  return true;
}

// ── Media deck playback ───────────────────────────────────────────────────────

// Cache: zoneId → { broadcastId, item, fetchedAt }. `item` is a runtime broadcast
// object (same shape loadChannelRuntimes builds) so a loaded cassette can play ANY
// broadcast type — flat, VINE graph, weather, or sports — not just flat messages.
const _deckCache = new Map();
const _DECK_CACHE_TTL = 10000; // 10s

// Build a runtime item from a broadcast row so the deck can render it through the
// same machinery the schedule uses (graph walker / weather + sports assemblers).
function _deckItemFrom(broadcastId, bc) {
  const parse = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } };
  let graph = parse(bc.broadcast_graph);
  const broadcastGraph = graph && typeof graph === 'object'
    ? _normalizeBroadcastGraph({ ...graph, _broadcastId: `deck:${broadcastId}` }) : null;
  const weatherScript = parse(bc.weather_pools);
  const sportsScript  = parse(bc.sports_pools);
  return {
    broadcastId,
    playback_mode: bc.playback_mode,
    messages: Array.isArray(bc.messages) ? bc.messages : (parse(bc.messages) || []),
    message_interval: bc.message_interval || 5,
    broadcastGraph,
    fallbackMessages: Array.isArray(bc.fallback_messages) ? bc.fallback_messages : (parse(bc.fallback_messages) || []),
    weatherPools: weatherScript?.pools || null,
    weatherHost:  weatherScript?.host || null,
    weatherTitle: weatherScript?.title || '',
    sportsScript: sportsScript || null,
  };
}

// ── Pirate queue playback (Phase 2) ──────────────────────────────────────────
// A seized deck runs its captor's queue instead of the channel schedule OR the
// legacy deck_active tape. State lives on the deck furniture flags (see the
// piracy block): pirate_queue (broadcast ids), pirate_cursor, pirate_loop
// (off|item|queue), pirate_playing, pirate_started_ms (current item's air start),
// pirate_crawl (breaking-news ticker). Own item cache so cursor changes rebuild.
const _pirateCache = new Map(); // zoneId -> { id, item, fetchedAt }
const _pirateDur = new Map();   // broadcastId -> duration seconds

// Pure loop-advance decision: given the current cursor, queue length, and loop
// mode, return the next cursor and whether playback stops. 'item' holds the same
// slot; 'off' stops at the end; 'queue' wraps.
function _nextCursor(cursor, len, loop) {
  if (len <= 0) return { cursor: 0, stop: true };
  if (loop === 'item') return { cursor, stop: false };
  if (loop === 'off' && cursor >= len - 1) return { cursor, stop: true };
  return { cursor: (cursor + 1) % len, stop: false };
}

async function _pirateItemDur(id) {
  if (_pirateDur.has(id)) return _pirateDur.get(id);
  const { rows } = await query(
    `SELECT override_duration, playback_mode, broadcast_graph, message_interval, messages FROM media_broadcasts WHERE id=$1`, [id]
  ).catch(() => ({ rows: [] }));
  const bc = rows[0];
  const parse = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } };
  let dur = 30;
  if (bc) dur = broadcastDuration({ ...bc, broadcast_graph: parse(bc.broadcast_graph), messages: parse(bc.messages) || bc.messages }) || 30;
  dur = Math.max(15, dur); // floor so ultra-short tapes don't thrash the queue
  _pirateDur.set(id, dur);
  return dur;
}

// Zone's media deck, served from the write-funneled furniture cache in world.js —
// the broadcast tick asks once a second per watched channel, so this must never
// hit the DB. Key-presence match, exactly what the old
// `flags::text LIKE '%"media_deck"%'` scan tested (`media_deck` is only ever
// written `true`). Prefers the deck linked to `channelId` so an orphaned/
// other-channel deck can't shadow the real transmitter. Fresh flags every call:
// the pirate playback writes below go through updateFurniture, whose RETURNING
// row re-syncs this cache before the next tick reads it.
function _zoneDeck(zoneId, channelId = null) {
  const decks = getZoneFurniture(zoneId).filter(f => f.flags && 'media_deck' in f.flags);
  if (!decks.length) return null;
  return (channelId && decks.find(f => f.flags.channel_id === channelId)) || decks[0];
}

// Returns undefined when the deck isn't pirated (caller falls through to the
// normal path), null when pirated-but-dark (stopped / empty queue), or a tick
// message when the pirate queue is airing.
async function _getPirateMessage(zoneId, nowMs, state) {
  const deck = _zoneDeck(zoneId, state?.channelId || null);
  if (!deck) return undefined;
  const dflags = _deckFlags(deck);
  if (!dflags.pirate_owner) return undefined;   // not pirated → normal path
  if (!dflags.pirate_playing) return null;      // stopped → dark

  // Breaking-news crawl — roughly one tick in three carries the ticker so it
  // recurs in the TV ticker strip alongside the aired content (both modes).
  if (dflags.pirate_crawl && Math.floor(nowMs / 5000) % 3 === 2) {
    return { text: String(dflags.pirate_crawl), style: 'ticker', key: `pircrawl:${Math.floor(nowMs / 5000)}` };
  }

  // LIVE mode (Phase 3): cut the feed to a camera instead of the recorded queue —
  // the station's own studio cam, or any zone a SPECTER cam the captor controls
  // watches (buildCameraSnapshot renders any zone as feed text). Fresh key each
  // 5s slot so the live feed refreshes.
  if (dflags.pirate_mode === 'live') {
    const src = dflags.pirate_live_source || null;
    const camZone = src?.zoneId || channelRuntime.get(dflags.channel_id)?.studioZoneId || null;
    if (!camZone) return null;
    const snap = buildCameraSnapshot(camZone);
    if (!snap) return null;
    return { text: `[LIVE · ${src?.label || 'STUDIO CAM'}] ${snap}`, style: 'raw', key: `pirlive:${Math.floor(nowMs / 5000)}` };
  }

  // RECORDED mode: run the queue.
  const q = Array.isArray(dflags.pirate_queue) ? dflags.pirate_queue : [];
  if (!q.length) return null;
  let cursor = Math.min(Math.max(0, dflags.pirate_cursor | 0), q.length - 1);
  let activeId = q[cursor];

  // Auto-advance once the current item has aired its full duration (unless it's
  // set to loop the single item). loop 'queue' wraps; 'off' stops at the end.
  const dur = await _pirateItemDur(activeId);
  const started = dflags.pirate_started_ms || nowMs;
  if (dflags.pirate_loop !== 'item' && nowMs - started >= dur * 1000) {
    const nx = _nextCursor(cursor, q.length, dflags.pirate_loop);
    if (nx.stop) {
      dflags.pirate_playing = false;
      await updateFurniture(deck.id, { flags: JSON.stringify(dflags) }).catch(() => {});
      _pirateCache.delete(zoneId);
      return null;
    }
    cursor = nx.cursor;
    activeId = q[cursor];
    dflags.pirate_cursor = cursor;
    dflags.pirate_started_ms = nowMs;
    await updateFurniture(deck.id, { flags: JSON.stringify(dflags) }).catch(() => {});
    _pirateCache.delete(zoneId);
  }

  let entry = _pirateCache.get(zoneId);
  if (!entry || entry.id !== activeId || nowMs - entry.fetchedAt > _DECK_CACHE_TTL) {
    const { rows: bcRows } = await query(
      `SELECT playback_mode, messages, message_interval, broadcast_graph, fallback_messages, weather_pools, sports_pools
         FROM media_broadcasts WHERE id=$1`, [activeId]
    ).catch(() => ({ rows: [] }));
    entry = bcRows[0]
      ? { id: activeId, item: _deckItemFrom(activeId, bcRows[0]), fetchedAt: nowMs }
      : { id: activeId, item: null, fetchedAt: nowMs };
    _pirateCache.set(zoneId, entry);
  }
  return _playDeckItem(entry.item, state, nowMs);
}

async function _getDeckMessage(zoneId, nowMs, state) {
  const pirate = await _getPirateMessage(zoneId, nowMs, state);
  if (pirate !== undefined) return pirate;   // pirated deck runs its captor's queue
  let entry = _deckCache.get(zoneId);
  if (!entry || nowMs - entry.fetchedAt > _DECK_CACHE_TTL) {
    const deck = _zoneDeck(zoneId, state?.channelId || null);
    const activeId = deck?.flags?.deck_active || null;
    if (activeId && entry?.broadcastId === activeId && entry.item) {
      // Same cassette still loaded — keep the built item so an assembled sports/
      // weather graph (cached on the item) survives the TTL refresh instead of
      // re-simulating a fresh game every 10 seconds.
      entry.fetchedAt = nowMs;
    } else if (activeId) {
      const { rows: bcRows } = await query(
        `SELECT playback_mode, messages, message_interval, broadcast_graph, fallback_messages, weather_pools, sports_pools
           FROM media_broadcasts WHERE id=$1`, [activeId]
      ).catch(() => ({ rows: [] }));
      entry = bcRows[0]
        ? { broadcastId: activeId, item: _deckItemFrom(activeId, bcRows[0]), fetchedAt: nowMs }
        : { broadcastId: null, item: null, fetchedAt: nowMs };
    } else {
      entry = { broadcastId: null, item: null, fetchedAt: nowMs };
    }
    _deckCache.set(zoneId, entry);
  }
  return _playDeckItem(entry.item, state, nowMs);
}

// Render one built deck item to a tick message — the shared player for both the
// legacy deck_active path and the pirate queue. Graph / weather / sports items
// walk the channel blackboard exactly like the scheduled path; flat lists loop on
// their own duration. Returns null when the item is empty/dark this tick.
function _playDeckItem(item, state, nowMs) {
  if (!item) return null;
  if (state) {
    state.currentFallbackMessages = item.fallbackMessages || [];
    if (item.playback_mode === 'weather') {
      const g = getWeatherGraph(item);
      return g ? tickBroadcastGraph(state.channelId, g, state, nowMs) : null;
    }
    if (item.playback_mode === 'sports') {
      if (!sportsAiring(item.sportsScript)) return null;   // between featured games — dark
      const g = getSportsGraph(item.sportsScript, sportsSlotIndex(), overrideFor(item.sportsScript));
      return g ? tickBroadcastGraph(state.channelId, g, state, nowMs, sportsSegElapsedSec()) : null;
    }
    if (item.broadcastGraph) {
      return tickBroadcastGraph(state.channelId, item.broadcastGraph, state, nowMs);
    }
  }
  if (!item.messages.length) return null;
  const elapsed = (nowMs / 1000) % (item.messages.length * item.message_interval);
  const result = getScriptedMessage(item.messages, item.message_interval, elapsed);
  return result ? { text: result.text, key: `deck:${item.broadcastId}:${result.idx}` } : null;
}

// ── Emergency broadcast override ───────────────────────────────────────────────
// The Echelon's special MediaDeck can seize EVERY on-air channel at once: while an
// override is active, every channel plays the emergency feed instead of its own
// content, and normal programming resumes the instant it's cleared. Only ONE feed,
// city-wide — this is the single global counterpart to the per-deck pirate override.
let emergencyOverride = null; // { broadcastId, item } | null

const _EMERGENCY_COLS = 'playback_mode, messages, message_interval, broadcast_graph, fallback_messages, weather_pools, sports_pools';

export async function startEmergency(broadcastId) {
  if (!broadcastId) return { ok: false, error: 'no broadcast id' };
  const { rows } = await query(`SELECT ${_EMERGENCY_COLS} FROM media_broadcasts WHERE id=$1`, [broadcastId]).catch(() => ({ rows: [] }));
  if (!rows[0]) return { ok: false, error: `no such broadcast: ${broadcastId}` };
  emergencyOverride = { broadcastId, item: _deckItemFrom(broadcastId, rows[0]) };
  return { ok: true };
}

export function stopEmergency() { const was = !!emergencyOverride; emergencyOverride = null; return { ok: true, wasActive: was }; }
export function emergencyActive() { return !!emergencyOverride; }

// The one place channel content is resolved for a tick. While an emergency override
// is live it wins over everything (deck cassette, pirate, scheduled programming);
// otherwise the normal precedence applies: loaded deck/pirate cassette, then the
// scheduled channel content. `deckZoneId` is the channel's transmitter zone (null on
// the studio-acting path when the channel has no deck bound).
async function _resolveTickMessage(deckZoneId, state, nowMs) {
  if (emergencyOverride) return _playDeckItem(emergencyOverride.item, state, nowMs);
  const deckResult = deckZoneId ? await _getDeckMessage(deckZoneId, nowMs, state) : null;
  return deckResult || await getCurrentMessage(state, nowMs);
}

// ── Broadcast tick ───────────────────────────────────────────────────────────

// The media deck IS the channel's transmitter: it routes the studio cameras and
// tapes into the broadcast. No deck, or the deck sitting in a blacked-out zone,
// means the channel has no way to get its signal out — it goes dark. (A zone whose
// power was never modelled is treated as live so unpowered interiors don't nuke a
// whole channel; only an explicit blackout — 'offline' — kills the feed.)
function channelTransmitterLive(state) {
  if (!state.deckZoneId) return false;
  const z = getZone(state.deckZoneId);
  if (!z) return false;
  return z.powerStatus !== 'offline';
}

// The off-air broadcast payload (channel dark → show the channel's offline graphic or
// static). Shared by the tick's go-dark path and the panel-open immediate signal.
function _offAirMessage(state, channelId) {
  const graphic = state.offlineGraphicId ? graphicsCache.get(state.offlineGraphicId) : null;
  return {
    type: 'broadcast', channel: channelId, style: 'off_air',
    offlineGraphicContent: graphic?.content || null,
    offlineGraphicType: graphic ? (graphicStyle(graphic) === 'svg' ? 'svg' : 'ascii') : 'ascii',
  };
}

// Rotating "technical difficulties" fallback line, keyed to the 5s slot so it changes
// over time. Shared by the three places that drop a channel into tech-diff.
function _techDiffMessage(state, channelId, nowMs) {
  const pool = state.currentFallbackMessages?.length
    ? state.currentFallbackMessages
    : ['[TECHNICAL DIFFICULTIES] Please stand by.'];
  const slot = Math.floor(nowMs / 5000);
  return { text: pool[slot % pool.length], key: `techDiff:${channelId}:${slot % pool.length}:${slot}`, style: 'raw' };
}

// The cast a live graph expects on stage (its `npc_anchor` nodes) who are NOT currently
// in the studio — drives the on-air "show delayed" card so viewers know exactly who
// we're waiting on. Returns display names, de-duped, in first-seen order.
function _absentCastNames(graph, studioZoneId) {
  if (!graph?.nodes || !studioZoneId) return [];
  const present = getZone(studioZoneId)?.npcs;
  const out = [];
  const seen = new Set();
  for (const node of Object.values(graph.nodes)) {
    if (node?.type !== 'npc_anchor') continue;
    const npcId = node.data?.npc_id;
    if (!npcId || seen.has(npcId)) continue;
    seen.add(npcId);
    if (present?.has(npcId)) continue;
    const npc = world.npcs?.get(npcId);
    out.push(npc?.name || (npcId.startsWith('npc_')
      ? npcId.slice(4).split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      : npcId));
  }
  return out;
}

// Is ANY of the graph's scheduled cast standing on the studio floor right now?
// The stand-by card is for an empty stage — a show that cannot start. A show that
// has *someone* on set goes ahead, and the absentees just don't get their lines
// (see the room-authority branch in the `say` node).
function _anyCastPresent(graph, studioZoneId) {
  if (!graph?.nodes || !studioZoneId) return false;
  const present = getZone(studioZoneId)?.npcs;
  if (!present?.size) return false;
  for (const node of Object.values(graph.nodes)) {
    if (node?.type === 'npc_anchor' && node.data?.npc_id && present.has(node.data.npc_id)) return true;
  }
  return false;
}

// "Alice" / "Alice and Bob" / "Alice, Bob, and Carol"
function _joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

async function broadcastTick() {
  // Idle-gate. The zone loop below self-gates on per-zone players, but the
  // live-stage acting pass fires on `_watchedZones` (camera-observed studios) —
  // and that set is only rebuilt by refreshWatchedZones, which is itself
  // hasActivePlayers()-gated, so it goes STALE (still populated) when the last
  // player logs off. Without this gate, a stale watched studio kept
  // _getPirateMessage's per-second furniture query running on an empty server,
  // which pinned Neon's compute awake 24/7. With no players there are no TV/deck
  // watchers and no one on a spy feed, so nothing this tick does is observable.
  if (!hasActivePlayers()) return;
  const nowMs = Date.now();
  // Channels the zone loop below will drive this tick (a tuned zone with players).
  // The deck-preview pass skips these so the stateful graph walker isn't advanced
  // twice in one tick.
  const activeChannels = new Set();
  // What each channel actually resolved to this tick, so the tablet pass at the
  // bottom can deliver the SAME content without re-running the stateful VINE walker
  // (advancing it twice would make viewers skip lines).
  // tickResults.get(channelId) = { result, scorebugOverlay, gamedayOverlay, standingsOverlay }
  const tickResults = new Map();
  // "<playerId>:<channelId>" for everyone the zone pass already delivered this beat
  // to. A player can hold BOTH surfaces at once (wall set + Tablet TV app) — they're
  // separate registrations (tvWatchers / tabletTuners) by design. But the client
  // fans each `broadcast` out to every view on that channel, so if both passes send
  // the same beat, both screens render it twice, play the music twice, and stack the
  // overlays. The tablet pass skips anyone in here.
  const servedThisTick = new Set();
  for (const [zoneId, channelMap] of zoneTunings) {
    if (!getZonePlayers(zoneId).length) continue;
    for (const cid of channelMap.keys()) activeChannels.add(cid);
  }
  for (const [zoneId, channelMap] of zoneTunings) {
    const players = getZonePlayers(zoneId);
    if (!players.length) continue;

    for (const [channelId, deviceType] of channelMap) {
      const state = channelRuntime.get(channelId);
      if (!state) continue;

      // No working transmitter (media deck) → the channel can't get on air. Fire the
      // one-shot off_air transition (offline graphic / static) and skip content.
      if (!channelTransmitterLive(state)) {
        let offAir = null;
        if (state.wasActive) {
          state.wasActive = false;
          state.lastBeat = null;   // off air — nothing for a late tuner to catch up to
          offAir = _offAirMessage(state, channelId);
          for (const player of players) {
            if (tvWatchers.get(player.id) === channelId) sendToPlayer(player.id, offAir);
          }
        }
        if (!tickResults.has(channelId)) tickResults.set(channelId, { result: null, offAir });
        continue;
      }

      let result;
      try {
        // Media deck check: a loaded cassette in this zone overrides channel content,
        // and a city-wide emergency override wins over even that.
        result = await _resolveTickMessage(zoneId, state, nowMs);
      } catch (err) {
        console.error(`[broadcast] tick error (${channelId}):`, err.message);
        // Mark it handled anyway — the walker may already have advanced, and the
        // tablet pass must not re-resolve and advance it a second time.
        if (!tickResults.has(channelId)) tickResults.set(channelId, { result: null, offAir: null });
        continue;
      }
      if (!result || result.key === state.lastMsgKey) {
        // null during a wait node means the graph is still running — don't trigger off_air
        const stillWaiting = !result && state.graphBlackboard?.waitUntil > nowMs;
        let offAir = null;
        if (!stillWaiting && state.wasActive) {
          state.wasActive = false;
          state.lastBeat = null;   // off air — nothing for a late tuner to catch up to
          offAir = _offAirMessage(state, channelId);
          for (const player of players) {
            if (tvWatchers.get(player.id) === channelId)
              sendToPlayer(player.id, offAir);
          }
        }
        if (!tickResults.has(channelId)) tickResults.set(channelId, { result: null, offAir });
        continue;
      }
      state.wasActive = true;
      state.lastMsgKey = result.key;
      // Claim the tick for this channel before any early `continue` below, so the
      // tablet pass reuses this beat rather than re-advancing the graph walker.
      if (!tickResults.has(channelId)) tickResults.set(channelId, { result });

      // Overlay events (show_overlay / clear_overlay) go direct to TV watchers,
      // and mirror to deck-preview watchers so the media deck shows on-screen
      // graphics the same as a TV would.
      if (result.style === 'overlay') {
        for (const player of players) {
          if (tvWatchers.get(player.id) === channelId)
            sendToPlayer(player.id, { type: 'tv_overlay', channelId, overlay: result.overlay ?? null });
          if (deckWatchers.get(player.id) === channelId)
            sendToPlayer(player.id, { type: 'deck_overlay', channelId, overlay: result.overlay ?? null });
        }
        continue;
      }

      // live_relay: NPC spoke in zone; zone relay already sent to TV watchers — just track state
      if (result.style === 'live_relay') {
        state.wasActive = true;
        state.lastMsgKey = result.key;
        continue;
      }

      const zone = getZone(zoneId);
      const formatted = formatMessage(result.text, deviceType, zone, result.style);
      // Audio rides any result carrying a resolved def — a `music` node, or a `title_card`
      // whose theme song/sample starts the moment the card appears.
      const isMusic = !!result.song;
      const isSample = !!result.sample;
      if (!formatted && !isMusic && !isSample) continue;

      const programName = result.programName ?? state.currentProgramName ?? null;

      // Split players: those watching this channel get the full panel message;
      // anyone else in a tuned zone overhears a spoken line as ambient background TV
      // (once per new message, per the lastMsgKey guard above — not every tick).
      // A score-bug rides along with the spoken line (sports). It's a persistent
      // overlay the client keeps on-screen and updates in place — sent every line so
      // late-tuners pick up the current state within one beat.
      const scorebugOverlay = result.scorebug ? { overlayType: 'scorebug', ...result.scorebug } : null;

      // Gameday: the rich per-at-bat snapshot that drives the animated sub-screen.
      // Rides the same tv_overlay channel as the score-bug; the client keeps it if the
      // Gameday view is open and ignores it otherwise.
      const gamedayOverlay = result.gameday ? { overlayType: 'gameday', ...result.gameday } : null;

      // Standings bug: during a sports airing (score-bug present), flash the league
      // table up on a slow cadence per channel. It's a transient graphic that rides
      // the same tv_overlay channel and auto-dismisses client-side; it coexists with
      // the persistent score-bug rather than replacing it.
      //
      // ALWAYS the table for the sport on screen, never the other one — which is what
      // the score-bug's own `sport` is read for. Each league supplies its own heading
      // and its own last column (run differential / points).
      let standingsOverlay = null;
      const bugSport = scorebugOverlay?.sport || 'baseball';
      if (scorebugOverlay && seasonOf(bugSport).phase !== 'worldseries'
          && nowMs - (_lastStandingsBug.get(channelId) || 0) > STANDINGS_BUG_EVERY_MS) {
        _lastStandingsBug.set(channelId, nowMs);
        const rows = await refreshStandings(nowMs, bugSport);
        if (rows.length) standingsOverlay = standingsBugFor(bugSport, rows);
      }

      // Attach this beat's graphics to the tick record so a portable tuner on the
      // same channel gets the identical score-bug / gameday / standings.
      const tr = tickResults.get(channelId);
      if (tr && tr.result === result) Object.assign(tr, { scorebugOverlay, gamedayOverlay, standingsOverlay });

      // Rate-limit the overheard `[TV]` line for non-watchers so a talky channel
      // doesn't flood the room feed. Decided once per zone+channel per tick.
      // Remember what's now on screen, so anyone tuning in mid-beat gets the picture
      // immediately instead of waiting out the rest of the line.
      _recordBeat(state, result, programName, scorebugOverlay, gamedayOverlay, nowMs);

      const ambientKey = `${zoneId}:${channelId}`;
      const ambientDue = result.speech && nowMs - (_lastAmbientLine.get(ambientKey) || 0) >= AMBIENT_LINE_EVERY_MS;
      if (ambientDue) _lastAmbientLine.set(ambientKey, nowMs);

      for (const player of players) {
        if (tvWatchers.get(player.id) === channelId) {
          servedThisTick.add(`${player.id}:${channelId}`);
          if (formatted) sendToPlayer(player.id, { type: 'broadcast', message: formatted, channel: channelId, style: result.style || 'raw', programName, ...(result.duration != null ? { duration: result.duration } : {}), ...(gamedayOverlay ? { hasGameday: true } : {}) });
          if (isMusic) sendToPlayer(player.id, { type: 'audio_music', def: result.song, owner: 'tv' });
          if (isSample) sendToPlayer(player.id, { type: 'audio_sample', def: result.sample });
          if (scorebugOverlay) sendToPlayer(player.id, { type: 'tv_overlay', channelId, overlay: scorebugOverlay });
          if (gamedayOverlay) sendToPlayer(player.id, { type: 'tv_overlay', channelId, overlay: gamedayOverlay });
          if (standingsOverlay) sendToPlayer(player.id, { type: 'tv_overlay', channelId, overlay: standingsOverlay });
          if (result.graphic) sendToPlayer(player.id, { type: 'tv_overlay', channelId, overlay: result.graphic });
        } else if (ambientDue) {
          sendToPlayer(player.id, { type: 'broadcast_ambient', speechText: result.speechText, channel: channelId });
        }
        // Deck preview — independent of TV panel subscription. (The score-bug is a
        // TV-viewer feature; the deck-preview monitor doesn't render it.)
        if (deckWatchers.get(player.id) === channelId && formatted) {
          sendToPlayer(player.id, { type: 'deck_broadcast', message: formatted, channel: channelId, style: result.style || 'raw' });
        }

      }
      if (formatted) { _recordDeckMessage(channelId, formatted); deckIdleChannels.delete(channelId); }
      emit('broadcast.message', { channelId, zoneId, text: result.text });
    }
  }

  // ── Live-stage acting (performs without a TV audience) ────────────────────
  // A talk show / live channel is ACTED in its studio by real NPC cast, and those
  // lines are spoken into the studio as a side effect of ticking the broadcast graph
  // (tickBroadcastGraph sendToZone's each line onto the stage). The zone loop above
  // only drives the graph when a TV somewhere is tuned in — so with nobody watching,
  // the cast just stand around the studio saying nothing. Drive the graph here too
  // whenever the studio ITSELF is being observed: a player standing on the stage, or a
  // working camera / sticky cam filming it (_watchedZones covers both the studio's own
  // broadcast camera and any SPECTER spy device). This makes the cast perform their
  // lines for anyone in the room or on a spy feed, not only for TV viewers.
  for (const [channelId, state] of channelRuntime) {
    if (activeChannels.has(channelId)) continue;   // already driven by a tuned TV zone
    const studio = state.studioZoneId;
    if (!studio) continue;
    const observed = getZonePlayers(studio).length > 0 || _watchedZones.has(studio);
    if (!observed) continue;
    activeChannels.add(channelId);                 // claim it so the deck pass won't re-tick
    try {
      const result = await _resolveTickMessage(state.deckZoneId, state, nowMs);
      // getCurrentMessage already performed the on-stage acting via sendToZone as a
      // side effect. There are no TV watchers on this path (or the channel would be in
      // activeChannels), so we only track state and feed any deck-preview monitors.
      if (!result || result.key === state.lastMsgKey) {
        const stillWaiting = !result && state.graphBlackboard?.waitUntil > nowMs;
        if (!result && !stillWaiting) {
          state.wasActive = false;
          state.lastBeat = null;   // off air — nothing for a late tuner to catch up to
          // Raise the deck-preview dead-air card once per transition into idle.
          if (!deckIdleChannels.has(channelId)) {
            deckIdleChannels.add(channelId);
            for (const [pid, cid] of deckWatchers) if (cid === channelId)
              sendToPlayer(pid, { type: 'deck_broadcast', channel: channelId, style: 'no_broadcast' });
          }
        }
        if (!tickResults.has(channelId)) tickResults.set(channelId, { result: null, offAir: null });
        continue;
      }
      state.wasActive = true;
      state.lastMsgKey = result.key;
      // This pass advanced the walker — record the beat for the tablet pass.
      if (!tickResults.has(channelId)) tickResults.set(channelId, { result });
      if (result.style === 'overlay' || result.style === 'live_relay') continue;
      const formatted = formatMessage(result.text, 'tv', null, result.style);
      if (!formatted) continue;
      _recordDeckMessage(channelId, formatted);
      deckIdleChannels.delete(channelId);
      for (const [pid, cid] of deckWatchers) if (cid === channelId)
        sendToPlayer(pid, { type: 'deck_broadcast', message: formatted, channel: channelId, style: result.style || 'raw' });
      emit('broadcast.message', { channelId, zoneId: studio, text: result.text });
    } catch (err) {
      console.error(`[broadcast] studio-acting tick error (${channelId}):`, err.message);
    }
  }

  // ── Media-deck preview sync ──────────────────────────────────────────────
  // An operator using a deck (or previewing from the dev-panel channel window)
  // watches a live monitor of the channel. Drive any channel that has preview
  // watchers but that the zone loop above didn't already tick — the deck's own
  // room usually has no TV — so the preview tracks the live schedule. A loaded
  // cassette overrides, just like on-air. Off-air/tech-diff isn't gated here: the
  // console monitor shows what's scheduled regardless of transmitter power.
  for (const channelId of new Set(deckWatchers.values())) {
    if (activeChannels.has(channelId)) continue;
    const state = channelRuntime.get(channelId);
    if (!state) continue;
    activeChannels.add(channelId);   // claim it so the tablet pass won't re-tick
    let result;
    try {
      result = await _resolveTickMessage(state.deckZoneId, state, nowMs);
    } catch (err) {
      console.error(`[broadcast] deck-preview tick error (${channelId}):`, err.message);
      if (!tickResults.has(channelId)) tickResults.set(channelId, { result: null, offAir: null });
      continue;
    }
    if (!tickResults.has(channelId)) tickResults.set(channelId, { result: result && result.key !== state.lastMsgKey ? result : null, offAir: null });
    // Genuinely nothing on air (no live signal, no scheduled content, no tape) —
    // tell the deck monitors to raise the [NO BROADCAST] dead-air card, once per
    // transition into idle. A graph mid-wait isn't idle (content resumes shortly).
    if (!result) {
      const stillWaiting = state.graphBlackboard?.waitUntil > nowMs;
      if (!stillWaiting && !deckIdleChannels.has(channelId)) {
        deckIdleChannels.add(channelId);
        for (const [pid, cid] of deckWatchers) if (cid === channelId)
          sendToPlayer(pid, { type: 'deck_broadcast', channel: channelId, style: 'no_broadcast' });
      }
      continue;
    }
    if (result.key === state.lastMsgKey) continue;
    deckIdleChannels.delete(channelId);
    state.lastMsgKey = result.key;
    if (result.style === 'overlay') {
      for (const [pid, cid] of deckWatchers) if (cid === channelId)
        sendToPlayer(pid, { type: 'deck_overlay', channelId, overlay: result.overlay ?? null });
      continue;
    }
    if (result.style === 'live_relay') continue;
    const formatted = formatMessage(result.text, 'tv', null, result.style);
    if (!formatted) continue;
    _recordDeckMessage(channelId, formatted);
    for (const [pid, cid] of deckWatchers) if (cid === channelId)
      sendToPlayer(pid, { type: 'deck_broadcast', message: formatted, channel: channelId, style: result.style || 'raw' });
  }

  // ── Tablet TV (portable tuner) ───────────────────────────────────────────
  // The Tablet TV app streams with no broadcast device in the zone, so the zone
  // loop above can never serve it. Deliver here instead: REUSE whatever beat another
  // pass already resolved for that channel this tick (the VINE graph walker is
  // stateful and must advance exactly once per tick, or viewers skip lines), and
  // only resolve fresh for a channel nothing else drove. Whole pass is skipped when
  // nobody has the app open, so it costs nothing on an idle server.
  if (tabletTuners.size) await _tabletBroadcastPass(tickResults, activeChannels, nowMs, servedThisTick);
}

// Per-channel fan-out to the portable tablet tuners. Split out of broadcastTick to
// keep that already-long function readable.
async function _tabletBroadcastPass(tickResults, activeChannels, nowMs, servedThisTick = new Set()) {
  for (const channelId of new Set(tabletTuners.values())) {
    const state = channelRuntime.get(channelId);
    if (!state) continue;
    const viewers = [];
    // Anyone whose wall set is already showing this channel got this beat from the
    // zone pass; the client fans it to their tablet view too, so sending again would
    // double every line on both screens.
    for (const [pid, cid] of tabletTuners) {
      if (cid === channelId && !servedThisTick.has(`${pid}:${channelId}`)) viewers.push(pid);
    }
    if (!viewers.length) continue;

    let payload = tickResults.get(channelId);

    // Nothing else drove this channel — resolve it ourselves, mirroring the zone
    // loop's transmitter / off-air / dedup handling.
    if (!payload) {
      activeChannels.add(channelId);
      if (!channelTransmitterLive(state)) {
        if (state.wasActive) {
          state.wasActive = false;
          state.lastBeat = null;   // off air — nothing for a late tuner to catch up to
          const offAir = _offAirMessage(state, channelId);
          for (const pid of viewers) sendToPlayer(pid, offAir);
        }
        continue;
      }
      let result;
      try {
        result = await _resolveTickMessage(state.deckZoneId, state, nowMs);
      } catch (err) {
        console.error(`[broadcast] tablet tick error (${channelId}):`, err.message);
        continue;
      }
      if (!result || result.key === state.lastMsgKey) {
        const stillWaiting = !result && state.graphBlackboard?.waitUntil > nowMs;
        if (!stillWaiting && state.wasActive) {
          state.wasActive = false;
          state.lastBeat = null;   // off air — nothing for a late tuner to catch up to
          const offAir = _offAirMessage(state, channelId);
          for (const pid of viewers) sendToPlayer(pid, offAir);
        }
        continue;
      }
      state.wasActive = true;
      state.lastMsgKey = result.key;
      payload = {
        result,
        scorebugOverlay: result.scorebug ? { overlayType: 'scorebug', ...result.scorebug } : null,
        gamedayOverlay:  result.gameday  ? { overlayType: 'gameday',  ...result.gameday  } : null,
        standingsOverlay: null,
      };
      // Same throttled league-table flash the zone loop raises during a sports airing.
      const pSport = payload.scorebugOverlay?.sport || 'baseball';
      if (payload.scorebugOverlay && seasonOf(pSport).phase !== 'worldseries'
          && nowMs - (_lastStandingsBug.get(channelId) || 0) > STANDINGS_BUG_EVERY_MS) {
        _lastStandingsBug.set(channelId, nowMs);
        const rows = await refreshStandings(nowMs, pSport);
        if (rows.length) payload.standingsOverlay = standingsBugFor(pSport, rows);
      }
      tickResults.set(channelId, payload);
    }

    // A pass ran but produced no new beat — forward only an off-air transition.
    if (!payload.result) {
      if (payload.offAir) for (const pid of viewers) sendToPlayer(pid, payload.offAir);
      continue;
    }

    const { result, scorebugOverlay = null, gamedayOverlay = null, standingsOverlay = null } = payload;

    if (result.style === 'overlay') {
      for (const pid of viewers) sendToPlayer(pid, { type: 'tv_overlay', channelId, overlay: result.overlay ?? null });
      continue;
    }
    if (result.style === 'live_relay') continue;

    // The tablet is always a `tv` device — no [Radio]/[FEED] prefix.
    const formatted = formatMessage(result.text, 'tv', null, result.style);
    const isMusic = !!result.song;
    const isSample = !!result.sample;
    if (!formatted && !isMusic && !isSample) continue;
    const programName = result.programName ?? state.currentProgramName ?? null;
    _recordBeat(state, result, programName, scorebugOverlay, gamedayOverlay, nowMs);

    for (const pid of viewers) {
      if (formatted) sendToPlayer(pid, { type: 'broadcast', message: formatted, channel: channelId, style: result.style || 'raw', programName, ...(result.duration != null ? { duration: result.duration } : {}), ...(gamedayOverlay ? { hasGameday: true } : {}) });
      if (isMusic) sendToPlayer(pid, { type: 'audio_music', def: result.song, owner: 'tv' });
      if (isSample) sendToPlayer(pid, { type: 'audio_sample', def: result.sample });
      if (scorebugOverlay) sendToPlayer(pid, { type: 'tv_overlay', channelId, overlay: scorebugOverlay });
      if (gamedayOverlay) sendToPlayer(pid, { type: 'tv_overlay', channelId, overlay: gamedayOverlay });
      if (standingsOverlay) sendToPlayer(pid, { type: 'tv_overlay', channelId, overlay: standingsOverlay });
      if (result.graphic) sendToPlayer(pid, { type: 'tv_overlay', channelId, overlay: result.graphic });
    }
  }
}

// ── Catch-up: what's on screen RIGHT NOW ─────────────────────────────────────
// A channel only pushes when its graph produces the NEXT beat, and a beat holds
// for as long as its line takes to read (up to ~30s, longer for a title card or a
// theme). So a viewer who tuned in a moment after one landed used to sit in front
// of a blank set until the next one — which read as "the channel didn't come up,
// change to it again". Nothing was broken; the picture just hadn't been repainted.
//
// So the current beat is remembered per channel and replayed to whoever tunes in.
// It carries `catchUp: true`: the client renders it exactly like a live beat but
// doesn't re-speak it, because the read-aloud for that line is already part-aired.
function _recordBeat(state, result, programName, scorebugOverlay, gamedayOverlay, nowMs) {
  state.lastBeat = {
    text: result.text,
    style: result.style || 'raw',
    programName,
    duration: result.duration ?? null,
    hasGameday: !!gamedayOverlay,
    graphic: result.graphic || null,
  };
  // The score-bug is persistent (re-sent every line while a game is on air), so a
  // late tuner needs it — but only while it's still current. A stale bug from the
  // last airing must never sit over a talk show.
  if (scorebugOverlay) { state.lastScorebug = scorebugOverlay; state.lastScorebugAt = nowMs; }
  if (gamedayOverlay)  { state.lastGameday  = gamedayOverlay;  state.lastGamedayAt  = nowMs; }
}

const CATCHUP_BUG_MAX_AGE_MS = 90_000;   // a score-bug older than this is last night's

function sendCatchUp(playerId, channelId) {
  const state = channelRuntime.get(channelId);
  const beat = state?.lastBeat;
  if (!beat) return;
  // Tickers scroll their own text and off-air/overlay beats are transitions, not a
  // picture — replaying either would be noise.
  if (beat.style === 'ticker' || beat.style === 'overlay' || beat.style === 'live_relay') return;
  // Both surfaces that can tune are `tv` devices, so no [Radio]/[FEED] prefix.
  const formatted = formatMessage(beat.text, 'tv', null, beat.style);
  if (formatted) {
    sendToPlayer(playerId, {
      type: 'broadcast', message: formatted, channel: channelId, style: beat.style,
      programName: beat.programName, catchUp: true,
      ...(beat.duration != null ? { duration: beat.duration } : {}),
      ...(beat.hasGameday ? { hasGameday: true } : {}),
    });
  }
  if (beat.graphic) sendToPlayer(playerId, { type: 'tv_overlay', channelId, overlay: beat.graphic });
  const now = Date.now();
  if (state.lastScorebug && now - (state.lastScorebugAt || 0) < CATCHUP_BUG_MAX_AGE_MS)
    sendToPlayer(playerId, { type: 'tv_overlay', channelId, overlay: state.lastScorebug });
  if (state.lastGameday && now - (state.lastGamedayAt || 0) < CATCHUP_BUG_MAX_AGE_MS)
    sendToPlayer(playerId, { type: 'tv_overlay', channelId, overlay: state.lastGameday });
}

// ── Dynamic news ─────────────────────────────────────────────────────────────

function enqueueNews(category, text, priority = 'normal') {
  for (const [channelId, state] of channelRuntime) {
    if (!state.newsCategories.includes(category) && state.channelType !== 'news') continue;
    const q = newsQueue.get(channelId) || [];
    const item = { text, category, priority, ts: Date.now() };
    if (priority === 'critical') {
      q.unshift(item);
    } else {
      q.push(item);
    }
    newsQueue.set(channelId, q);
  }
}

on('player.death', ({ player }) => {
  if (!player) return;
  const zone = player.current_zone ? getZone(player.current_zone) : null;
  const zoneName = zone?.name || (player.current_zone ? player.current_zone.replace(/_/g, ' ') : 'an unknown location');
  enqueueNews('murder', `Breaking: ${player.handle} was found dead in ${zoneName}.`, 'normal');
});

on('flag.set', ({ flag, value }) => {
  if (flag === 'martial_law' && value === 'true') {
    enqueueNews('martial_law', 'EMERGENCY ALERT: Martial law has been declared across the city.', 'critical');
  }
  if (flag === 'nuclear_event' && value === 'true') {
    enqueueNews('nuclear_events', 'WARNING: Radiation spike detected. Seek shelter immediately.', 'critical');
  }
});

// NPC hosts send to a channel's queue via the BROADCAST_SAY AI action
on('npc.broadcast_say', ({ channel_id, text }) => {
  if (!channel_id || !text) return;
  const q = newsQueue.get(channel_id) || [];
  q.push({ text, category: 'npc', priority: 'normal', ts: Date.now() });
  newsQueue.set(channel_id, q);
});

// Register viewer checker so AI CHANNEL_HAS_VIEWERS condition can query synchronously
registerViewerChecker((channelId) => {
  for (const [zoneId, channelMap] of zoneTunings) {
    if (channelMap.has(channelId) && getZonePlayers(zoneId).length > 0) return true;
  }
  return false;
});

// IS_BROADCAST_SCHEDULED: is this NPC in an active daily schedule slot right now?
registerNpcScheduleChecker((npcId) => {
  const { minutes, dayOfWeek } = getEnvironmentState();
  const gameSecs = (minutes ?? 0) * 60;
  const nowMs = Date.now();
  for (const state of channelRuntime.values()) {
    // Talk-show cast are on-shift for the whole @airtime block, keyed to the in-game clock
    // (not the channel's loop position) — so the guest appears + commutes and the host/sidekick
    // hold the stage exactly while the episode airs, and clear off the moment it's over.
    for (const item of (state.playlist || [])) {
      if (item.playback_mode !== 'talkshow') continue;
      // A cast member isn't on shift for an episode that doesn't air today — otherwise
      // a Friday-only talk show would commute its host to the studio all week.
      if (state.scheduleMode === 'daily' && !_slotAirsOn(item, dayOfWeek)) continue;
      // The guest — and only the guest — comes on shift a slot early, because it's the only
      // one with a journey to make. See TALKSHOW_GUEST_CALL_LEAD.
      const lead = item.talkshowScript?.guestNpc === npcId ? TALKSHOW_GUEST_CALL_LEAD : 0;
      if (item.npcStaff?.includes(npcId) && talkshowAiring(item.talkshowScript, lead)) return true;
    }
    let item = null;
    if (state.scheduleMode === 'daily') {
      item = _pickDailySlot(state.playlist, gameSecs, dayOfWeek);
    } else if (state.playlist.length && state.totalDuration > 0) {
      // Loop/mixed/emergency: find which playlist item is currently playing
      const elapsed = ((nowMs - state.loopOriginMs) / 1000) % state.totalDuration;
      item = state.playlist.find(i => elapsed >= i.startTime && elapsed < i.startTime + i.duration);
    }
    if (item?.playback_mode !== 'talkshow' && item?.npcStaff?.includes(npcId)) return true;
  }
  return false;
});

// How long until this NPC is next due on. Game minutes; 0 while already on shift;
// null when they're staffed on nothing that airs.
//
// Only DAILY slots have a knowable start — a loop/mixed channel has no wall-clock
// timetable to count down to, so a host on one simply reports null and anything
// scheduling against it (the pre-show ritual in npc-drugs) declines to fire rather
// than guessing.
registerNpcNextShiftLookup((npcId) => {
  const { minutes, dayOfWeek } = getEnvironmentState();
  const gameSecs = (minutes ?? 0) * 60;
  const DAY_SECS = 24 * 60 * 60;
  let soonest = null;
  for (const state of channelRuntime.values()) {
    if (state.scheduleMode !== 'daily') continue;
    for (const item of (state.playlist || [])) {
      if (!item.npcStaff?.includes(npcId)) continue;
      // Already inside this slot — on shift now.
      if (gameSecs >= item.startTime && gameSecs < item.startTime + item.duration) return 0;
      // Airs today and still ahead of us? Otherwise the next airing is a future
      // day — walk forward to find which, so a Friday-only show counts down
      // across the week instead of reporting nothing for six days.
      let wait = null;
      if (_slotAirsOn(item, dayOfWeek) && item.startTime > gameSecs) {
        wait = item.startTime - gameSecs;
      } else {
        for (let ahead = 1; ahead <= 7; ahead++) {
          if (!_slotAirsOn(item, (dayOfWeek + ahead) % 7)) continue;
          wait = (ahead * DAY_SECS) + item.startTime - gameSecs;
          break;
        }
      }
      if (wait == null) continue;
      if (soonest == null || wait < soonest) soonest = wait;
    }
  }
  return soonest == null ? null : Math.round(soonest / 60);
});

// getNpcStudioZone: find the studio zone for the channel this NPC is staffed on
registerNpcStudioZoneLookup((npcId) => {
  for (const state of channelRuntime.values()) {
    if (!state.studioZoneId) continue;
    if (state.playlist.some(i => i.npcStaff?.includes(npcId))) return state.studioZoneId;
  }
  return null;
});

// What a channel is airing RIGHT NOW, from live runtime timing (same clock the
// schedule checker uses). Returns { broadcast_id, name, source } or null (off air).
// Consumed by the dev-panel Channels tab so builders can see what's on without
// opening the live CRT preview. A disabled channel has no runtime → null.
function nowBroadcastingFor(channelId) {
  const state = channelRuntime.get(channelId);
  if (!state) return null;
  const { minutes, dayOfWeek } = getEnvironmentState();
  const gameSecs = (minutes ?? 0) * 60;
  const nowMs = Date.now();
  let item = null;
  if (state.scheduleMode === 'daily') {
    item = _pickDailySlot(state.playlist, gameSecs, dayOfWeek);
  } else if (state.playlist.length && state.totalDuration > 0) {
    const elapsed = ((nowMs - state.loopOriginMs) / 1000) % state.totalDuration;
    item = state.playlist.find(i => elapsed >= i.startTime && elapsed < i.startTime + i.duration);
  }
  // A VINE-graph-driven channel tracks its own active broadcast — prefer it when set.
  const activeId = state.graphBlackboard?.activeBroadcastId || null;
  const activeItem = activeId ? state.playlist.find(i => i.broadcastId === activeId) : null;
  const chosen = activeItem || item;
  if (chosen) {
    if (chosen.slotType === 'commercial_break') return { broadcast_id: null, name: 'Commercial break', source: 'break' };
    return { broadcast_id: chosen.broadcastId, name: chosen.broadcastName || chosen.broadcastId, source: 'playlist' };
  }
  if (state.channelType === 'news')  return { broadcast_id: null, name: 'Live news feed',   source: 'news' };
  if (state.channelType === 'live')  return { broadcast_id: null, name: 'Live studio feed',  source: 'live' };
  if (state.idleBroadcast)           return { broadcast_id: null, name: 'Idle / standby',    source: 'idle' };
  return null;
}

// Viewer-facing TV guide for the tuned channel — the running order plus the current
// in-world clock, pushed to the player when they open the schedule button. Two shapes
// depending on how the channel is scheduled:
//   • daily  — each slot has a fixed in-world time of day (start_time = seconds since
//              midnight), so it reads as a real TV guide with clock times.
//   • loop   — the playlist repeats on a real-time cycle with no wall-clock anchor, so
//              we hand back the running order with a real-time "up next in M:SS" per slot.
function _fmtHHMM(mins) {
  const m = Math.max(0, Math.round(mins));
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
// A nightly TV guide for a `@airtime`-locked sports channel: one row per featured slot,
// stamped with the in-game clock time it airs, the night's matchup, and — during the
// World Series — the finalists under a WORLD SERIES banner. So the Series' airtime is
// obvious from the guide, matching the news posting. Continuous leagues return null (fall
// back to the generic loop schedule).
function _sportsScheduleSlots(script, cur) {
  const G = SPORTS_GAMES_PER_DAY;
  const featured = (Array.isArray(script?.airSlots) && script.airSlots.length)
    ? [...new Set(script.airSlots.map((n) => ((n % G) + G) % G))].sort((x, y) => x - y) : null;
  if (!featured) return null;
  const s = seasonOf('baseball');
  const isWs = s.phase === 'worldseries' && s.finalistA && s.finalistB;
  const wsSlot = s.wsSlot != null ? Number(s.wsSlot) : null;
  const curDay = Math.floor(cur / G);
  return featured.map((f) => {
    let cand = curDay * G + f;
    if (cand < cur) cand += G;                       // tonight's slot already passed → tomorrow
    const dayDelta = Math.floor(cand / G) - curDay;
    const dayTag = dayDelta <= 0 ? '' : (dayDelta === 1 ? ' — tomorrow' : ` — in ${dayDelta}d`);
    let name;
    if (isWs && wsSlot != null && cand === wsSlot) {
      name = `⚾ WORLD SERIES — ${s.finalistA} vs ${s.finalistB}`;
    } else {
      const gs = sportsGameForSlot(script, cand, null);
      name = gs ? `DEADBALL — ${gs.game.away.name} @ ${gs.game.home.name}` : 'DEADBALL — Coldwater League Baseball';
    }
    return {
      name: name + dayTag,
      todLabel: _fmtHHMM(f * SPORTS_SLOT_GAME_MIN),
      durationSec: SPORTS_SLOT_GAME_MIN * 60,
      onNow: cand === cur,
    };
  });
}
// On-demand DEADBALL league table for the standings button (both TV surfaces).
async function sendTvStandings(playerId) {
  const nowMs = Date.now();
  const rows = await refreshStandings(nowMs).catch(() => []);
  await refreshSeason(nowMs).catch(() => {});
  sendToPlayer(playerId, {
    type: 'tv_standings',
    title: seasonOf('baseball').phase === 'worldseries' ? 'DEADBALL — WORLD SERIES' : 'DEADBALL — LEAGUE STANDINGS',
    phase: seasonOf('baseball').phase || 'regular',
    rows: (rows || []).map(r => ({
      team: r.team,
      wins: r.wins || 0,
      losses: r.losses || 0,
      rd: (r.runs_for || 0) - (r.runs_against || 0),
    })),
  });
}

// The live matchup label for a sports slot in a running order — so a mixed channel's Deadball row
// reads "DEADBALL — Away @ Home" (the game that's actually airing) like the dedicated sports guide
// does, rather than the generic stored broadcast name. Returns null for any non-sports item.
function _sportsSlotLabel(item) {
  if (item.playback_mode !== 'sports' || !item.sportsScript) return null;
  const s = seasonOf('baseball');
  if (s.phase === 'worldseries' && s.finalistA && s.finalistB) return `⚾ WORLD SERIES — ${s.finalistA} vs ${s.finalistB}`;
  const gs = sportsGameForSlot(item.sportsScript, sportsSlotIndex(), overrideFor(item.sportsScript));
  return gs ? `DEADBALL — ${gs.game.away.name} @ ${gs.game.home.name}` : (item.broadcastName || 'DEADBALL — Coldwater League Baseball');
}
function sendTvSchedule(playerId, channelId) {
  const state = channelId ? channelRuntime.get(channelId) : null;
  const nowMin = getEnvironmentState().minutes ?? 0;
  const base = {
    type: 'tv_schedule',
    channelId: channelId || null,
    stationName: state?.stationName || null,
    channelNumber: state?.number ?? null,
    scheduleMode: state?.scheduleMode === 'daily' ? 'daily' : 'loop',
    nowLabel: _fmtHHMM(nowMin),
  };
  if (!state || !state.playlist?.length) {
    sendToPlayer(playerId, { ...base, slots: [] });
    return;
  }
  // A DEDICATED sports channel (its whole running order is Deadball) gets the special nightly
  // guide: the featured games by air-slot, with "tomorrow"/"in Nd" tags and the WS airtime. This
  // must NOT fire for a general-entertainment channel that merely CARRIES a Deadball slot among
  // its news/weather/talk shows — that would throw the rest of the day's listing away and leave
  // only the ball game showing. So gate it on the channel being sports-only.
  const nonCommercial = state.playlist.filter((i) => i.slotType !== 'commercial_break');
  const sportsOnly = nonCommercial.length > 0 && nonCommercial.every((i) => i.playback_mode === 'sports' && i.sportsScript);
  const sportsItem = sportsOnly ? nonCommercial.find((i) => i.sportsScript) : null;
  const sportsSlots = sportsItem ? _sportsScheduleSlots(sportsItem.sportsScript, sportsSlotIndex()) : null;
  if (sportsSlots) {
    sendToPlayer(playerId, { ...base, scheduleMode: 'daily', slots: sportsSlots });
    return;
  }
  // On a mixed channel the Deadball row still reads with its live matchup, not the generic
  // broadcast name, so the guide matches what's actually on — the rest of the day is untouched.
  const nameFor = (i) => (i.slotType === 'commercial_break') ? 'Commercial break' : (_sportsSlotLabel(i) || i.broadcastName || 'Untitled');
  let slots;
  if (base.scheduleMode === 'daily') {
    const nowSec = nowMin * 60;
    // TODAY's running order, not every row in the table: a slot that doesn't air on
    // this weekday isn't in the listing at all, and where a day-specific slot covers
    // an everyday one, only the winner is listed — the guide has to read as what a
    // viewer will actually see, or the fight night shows up as two programmes at 20:00.
    const dow = getEnvironmentState().dayOfWeek;
    const onAir = state.playlist.filter(i => _slotAirsOn(i, dow) &&
      _pickDailySlot(state.playlist, i.startTime, dow) === i);
    const nowItem = _pickDailySlot(state.playlist, nowSec, dow);
    slots = onAir.sort((a, b) => a.startTime - b.startTime).map(i => ({
      name: nameFor(i),
      todLabel: _fmtHHMM(i.startTime / 60),
      durationSec: i.duration,
      onNow: i === nowItem,
    }));
  } else {
    // A loop channel has no fixed daily grid, but it's still tied to the wall clock
    // (loopOriginMs) and so is the in-world clock (nowMin ↔ Date.now() via timeScale).
    // Project the loop across the whole in-world day so the guide reads as a real
    // "what's on today" listing with clock times, not just a one-cycle countdown.
    const total = state.totalDuration || 1;
    const timeScale = getEnvironmentState().timeScale || 1;
    const msPerGameMin = 60000 / timeScale;
    const now = Date.now();
    const nowSec = now / 1000;
    const originSec = (state.loopOriginMs || now) / 1000;
    const t0Ms = now - nowMin * msPerGameMin;            // real time of in-world 00:00 today
    const t24Ms = t0Ms + 1440 * msPerGameMin;            // …and of tomorrow's 00:00
    const items = state.playlist.slice().sort((a, b) => a.startTime - b.startTime);
    const kStart = Math.floor((t0Ms / 1000 - originSec) / total);
    const kEnd = Math.ceil((t24Ms / 1000 - originSec) / total);
    slots = [];
    for (let k = kStart; k <= kEnd; k++) {
      for (const i of items) {
        const startSec = originSec + k * total + i.startTime;
        const gameMin = (startSec * 1000 - t0Ms) / msPerGameMin;
        if (gameMin < 0 || gameMin >= 1440) continue;
        slots.push({
          name: nameFor(i),
          todLabel: _fmtHHMM(gameMin),
          durationSec: i.duration,
          onNow: nowSec >= startSec && nowSec < startSec + i.duration,
          _sort: gameMin,
        });
      }
    }
    slots.sort((a, b) => a._sort - b._sort);
    slots = slots.slice(0, 120).map(({ _sort, ...s }) => s);
  }
  sendToPlayer(playerId, { ...base, slots });
}

// ── Behaviour-tree nodes ──────────────────────────────────────────────────────
// Broadcast-specific VINE nodes, registered into the AI runner (moved out of
// the engine's ai-behaviour.js switch — registerAICondition/registerAIAction).
// They go through the bridge getters so there's exactly one implementation of
// each check (the lambdas registered above).

registerAICondition('CHANNEL_HAS_VIEWERS', (entity, params) => hasChannelViewers(params.channel_id));

registerAICondition('IS_BROADCAST_SCHEDULED', (entity) => isNpcScheduledNow(entity.id));

registerAICondition('AT_WORK_ZONE', (entity, params, { zoneId }) => {
  const studioZone = entity.studio_zone_id || getNpcStudioZone(entity.id);
  return studioZone ? zoneId === studioZone : false;
});

registerAIAction('BROADCAST_SAY', (entity, params) => {
  const { channel_id, text } = params;
  if (!text || !channel_id) return;
  emit('npc.broadcast_say', { entity, channel_id, text: `[${entity.name}] ${text}` });
});

// ── Studio zone relay ─────────────────────────────────────────────────────────
// When a zone event fires in a studio zone, relay qualifying messages to TV watchers.
// This is what makes the TV a live camera feed of the studio.
on('zone.broadcast', ({ zoneId, msg }) => {
  const channelId = studioZoneIndex.get(zoneId);
  if (!channelId) return;
  const state = channelRuntime.get(channelId);
  if (!state) return;
  // The studio floor goes out on air whenever the channel is actually acting a show
  // there — not only on channels typed `live`. This is the audience seam: walk into
  // shot, heckle the host, knock something over, and the city sees it. It still needs
  // a working camera in the room to have a picture at all.
  const acted = state.channelType === 'live' || state.graphBlackboard?.activeBroadcastId;
  if (!acted || !state.wasActive) return;
  if (!zoneCameras.get(zoneId)?.length) return;
  // Never re-air the show's own performance — those lines reach air by the graph.
  if (msg._fromBroadcast) return;
  // Foot traffic is not television. A busy studio floor generates an arrive/depart
  // line for every player and every NPC on a schedule, which buries the narration
  // and the moments that actually matter. The camera stays on what people DO.
  if (msg._movement) return;
  // Only relay player-visible events (speech, say, zone_event) — not combat or system messages
  if (msg.type !== 'output' && msg.type !== 'zone_event' && msg.type !== 'say') return;
  if (!msg.message) return;
  const sentDeck = new Set();
  const sentTv = new Set();
  _recordDeckMessage(channelId, msg.message);
  for (const [viewZoneId, channelMap] of zoneTunings) {
    if (!channelMap.has(channelId)) continue;
    const players = getZonePlayers(viewZoneId);
    for (const player of players) {
      sendToPlayer(player.id, { type: 'broadcast', message: msg.message, channel: channelId, style: 'raw' });
      sentTv.add(player.id);
      if (deckWatchers.get(player.id) === channelId) {
        sendToPlayer(player.id, { type: 'deck_broadcast', message: msg.message, channel: channelId, style: 'raw' });
        sentDeck.add(player.id);
      }
    }
  }
  // Also send to deck watchers not already covered by a tuned zone
  for (const [playerId, watchChId] of deckWatchers) {
    if (watchChId !== channelId || sentDeck.has(playerId)) continue;
    sendToPlayer(playerId, { type: 'deck_broadcast', message: msg.message, channel: channelId, style: 'raw' });
  }
  // Portable tuners see the studio floor too — the tablet is a receiver like any
  // other. Skip anyone the zone loop above already served, or a player holding a
  // tablet inside a tuned room gets the line twice.
  for (const [playerId, tunedId] of tabletTuners) {
    if (tunedId !== channelId || sentTv.has(playerId)) continue;
    sendToPlayer(playerId, { type: 'broadcast', message: msg.message, channel: channelId, style: 'raw' });
  }
  state.wasActive = true;
});

// Display name for an anchor whose npc_id has no NPC row — a scripted show's
// fictional cast (`npc_vic` → "Vic"). Both the live path and the mid-show seek
// path must use this, or tuning in late attributes lines to the raw id.
function _anchorFallbackName(npcId) {
  if (!npcId) return null;
  return npcId.startsWith('npc_')
    ? npcId.slice(4).split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : npcId;
}

// ── Behaviour graph work-phase injection ─────────────────────────────────────
// Walk a normalised broadcast VINE graph and extract a linear sequence of
// say/npc_action nodes for a specific NPC anchor. Returns an array of
// { type:'SAY'|'EMOTE', params, waitSecs } objects in script order.
function _extractNpcWorkSequence(graph, npcId) {
  if (!graph?._start || !graph?.nodes) return [];
  const edges = graph.edges || [];
  let nodeId = graph._start;
  let currentNpc = null;
  const sequence = [];
  let pendingWait = 0;
  const visited = new Set();
  while (nodeId && !visited.has(nodeId)) {
    visited.add(nodeId);
    const node = graph.nodes[nodeId];
    if (!node) break;
    const { type, data = {} } = node;
    if (type === 'npc_anchor') {
      currentNpc = data.npc_id || null;
    } else if (type === 'wait') {
      pendingWait += (data.seconds || data.duration || 5);
    } else if (type === 'say' && currentNpc === npcId) {
      sequence.push({ type: 'SAY', params: { message: data.text || '' }, waitSecs: pendingWait });
      pendingWait = 5; // default gap after a line
    } else if (type === 'npc_action' && currentNpc === npcId) {
      const msg = data.message || data.action || '';
      if (msg) sequence.push({ type: 'EMOTE', params: { message: msg }, waitSecs: pendingWait });
      pendingWait = 3;
    } else if (type === 'loop') {
      break; // one pass only
    }
    nodeId = _resolveEdge(edges, nodeId, 'next');
  }
  return sequence;
}

// Patch a NPC's behaviour graph: replace the AT_WORK + wait nodes with the
// extracted work sequence, keeping the lifecycle shell intact.
function _buildWorkPhasedGraph(sequence, studioZoneId = null) {
  const graph = {
    _start: 'n_start',
    nodes: {
      n_start: { type: 'start',  next: 'n_life' },
      n_life:  { type: 'action', action_type: 'HAVE_LIFE',  next: 'n_work' },
      n_work:  { type: 'action', action_type: 'GO_TO_WORK', params: studioZoneId ? { zone_id: studioZoneId } : {}, next: sequence.length ? 'n_w0' : 'n_atwork' },
      n_loop:  { type: 'loop',   next: 'n_start' },
    },
  };
  if (!sequence.length) {
    graph.nodes.n_atwork = { type: 'action', action_type: 'AT_WORK', next: 'n_wait' };
    graph.nodes.n_wait   = { type: 'wait', seconds: 30, next: 'n_loop' };
    return graph;
  }
  sequence.forEach((step, i) => {
    const id  = `n_w${i}`;
    const wid = `n_ww${i}`;
    const nextAction = i + 1 < sequence.length ? `n_w${i + 1}` : 'n_loop';
    graph.nodes[id]  = { type: 'action', action_type: step.type, params: step.params, next: wid };
    graph.nodes[wid] = { type: 'wait', seconds: Math.max(1, step.waitSecs || 5), next: nextAction };
  });
  return graph;
}

async function _injectWorkPhaseForPlaylistItem(item) {
  if (!item.broadcast_id || !item.npcStaff?.length) return;
  const { rows: bcRows } = await query(
    `SELECT broadcast_graph FROM media_broadcasts WHERE id=$1`, [item.broadcast_id]
  ).catch(() => ({ rows: [] }));
  if (!bcRows.length || !bcRows[0].broadcast_graph) return;
  let rawGraph = bcRows[0].broadcast_graph;
  if (typeof rawGraph === 'string') { try { rawGraph = JSON.parse(rawGraph); } catch { return; } }
  const graph = _normalizeBroadcastGraph(rawGraph);
  for (const npcId of item.npcStaff) {
    if (!npcId) continue;
    const sequence = _extractNpcWorkSequence(graph, npcId);
    if (!sequence.length) continue; // no lines for this NPC — leave existing graph alone
    const newGraph = JSON.stringify(_buildWorkPhasedGraph(sequence, item.studioZoneId || null));
    await query(
      `UPDATE npcs SET behaviour_graph=$1 WHERE id=$2`, [newGraph, npcId]
    ).catch(() => {});
    const live = world.npcs.get(npcId);
    if (live) live.behaviour_graph = _buildWorkPhasedGraph(sequence, item.studioZoneId || null);
  }
}

// Recalculate every NPC's work schedule from the current playlists: derive each
// broadcast's on-screen NPCs from its graph, merge them into the playlist item's
// npc_staff conditions, assign a studio-aware behaviour graph + work_zone_id to
// any host, and re-inject the per-broadcast work-phase actions. Idempotent.
// Auto-lock an @airtime-blocked live show to its broadcast time. Named for the talk show
// it was written for, but it reads nothing except `airSlots` — GAME SHOWS pin through it
// too. A show of this kind is ONLY available during its
// nightly @airtime block, so whenever one is saved we pin it to that block on its channel
// automatically (a daily-scheduled slot) — the builder never has to hand-place it on the
// timeline. Idempotent: re-pins THIS show's own slot(s) and leaves other broadcasts on the
// channel alone. Staffing (cast + guest graphs) is done by the caller via recalc once the
// cast NPCs exist. No @airtime ⇒ a single all-day slot (always available).
async function ensureTalkshowSlot(broadcastId, channelId, talkshowPools) {
  if (!broadcastId || !channelId) return;
  let ts = talkshowPools;
  if (typeof ts === 'string') { try { ts = JSON.parse(ts); } catch { ts = null; } }
  const BLOCK = 3 * 3600;   // one in-game 3h airtime block, in game-seconds-since-midnight
  const slots = Array.isArray(ts?.airSlots) && ts.airSlots.length ? ts.airSlots : null;
  // Pinning to a fixed time of day needs the channel in daily-schedule mode.
  await query(`UPDATE media_channels SET schedule_mode='daily' WHERE id=$1`, [channelId]).catch(() => {});
  await query('DELETE FROM media_channel_playlist WHERE channel_id=$1 AND broadcast_id=$2', [channelId, broadcastId]).catch(() => {});
  // `airDays` makes the show WEEKLY rather than nightly. It rides through the same
  // 7-bit day mask the playlist has always had, and because _pickDailySlot resolves
  // ties by specificity (fewest days set wins), a one-day row simply outranks the
  // everyday row underneath it — nothing else on the channel has to be edited or
  // gapped. Absent ⇒ 127, every day, exactly as this always behaved.
  const mask = filmDayMask(Array.isArray(ts?.airDays) && ts.airDays.length ? ts.airDays : null, 0);
  const windows = slots ? slots.map(b => [(((b % 8) + 8) % 8) * BLOCK, BLOCK]) : [[0, 24 * 3600]];
  for (const [start, dur] of windows) {
    await query(
      `INSERT INTO media_channel_playlist (id,channel_id,broadcast_id,start_time,duration_override,priority,conditions,slot_type,days)
       VALUES ($1,$2,$3,$4,$5,0,'[]'::jsonb,'broadcast',$6)`,
      [randomUUID(), channelId, broadcastId, start, dur, mask]
    ).catch(() => {});
  }
}

// How many consecutive in-game blocks a film needs to screen without being cut off.
// A block is 3 in-game hours, but its REAL length is (24h ÷ timeScale) ÷ 8 — at the
// world's default 3× clock that is sixty real minutes, and a feature does not fit in
// sixty minutes. So a picture reserves as many consecutive blocks as its runtime
// actually needs, and `@airtime 21` means "starts at 21:00", not "is over by midnight".
// Capped at the whole day; a film longer than a day is somebody else's problem.
// The 7-bit day mask for a film reel that starts `shift` days after its screening's
// weekday(s). A run that crosses midnight lands on the NEXT weekday, so a Saturday
// feature's small-hours reels are SUNDAY rows — get this wrong and the back half of
// the picture airs on the wrong day of the week entirely.
function filmDayMask(days, shift) {
  if (!Array.isArray(days) || !days.length) return 127;
  return days.reduce((m, d) => m | (1 << ((((d - 1 + shift) % 7) + 7) % 7)), 0);
}

function filmBlocksNeeded(runtimeRealSec) {
  const blockRealSec = sportsSlotMs() / 1000;
  if (!(runtimeRealSec > 0) || !(blockRealSec > 0)) return 1;
  return Math.min(SPORTS_GAMES_PER_DAY, Math.max(1, Math.ceil(runtimeRealSec / blockRealSec)));
}

// Pin a film's screening: one playlist slot per block, laid end to end from its
// @airtime, wrapping past midnight if the picture runs that long. Separate from
// ensureTalkshowSlot because a talk show wants exactly its one block and a film wants
// however many its runtime demands. Idempotent, and only touches this broadcast's rows.
async function ensureFilmSlots(broadcastId, channelId, filmMeta) {
  if (!broadcastId || !channelId) return;
  let fm = filmMeta;
  if (typeof fm === 'string') { try { fm = JSON.parse(fm); } catch { fm = null; } }
  const BLOCK = 3 * 3600;   // one in-game 3h block, in game-seconds-since-midnight
  await query(`UPDATE media_channels SET schedule_mode='daily' WHERE id=$1`, [channelId]).catch(() => {});
  await query('DELETE FROM media_channel_playlist WHERE channel_id=$1 AND broadcast_id=$2', [channelId, broadcastId]).catch(() => {});
  const slots = Array.isArray(fm?.airSlots) && fm.airSlots.length ? fm.airSlots : null;
  if (!slots) {
    // No @airtime — a single all-day slot, the same fallback every pinned type uses.
    await query(
      `INSERT INTO media_channel_playlist (id,channel_id,broadcast_id,start_time,duration_override,priority,conditions,slot_type)
       VALUES ($1,$2,$3,0,$4,0,'[]'::jsonb,'broadcast')`,
      [randomUUID(), channelId, broadcastId, 24 * 3600]
    ).catch(() => {});
    return;
  }
  const need = filmBlocksNeeded(fm?.runtime);
  // Which weekdays the picture screens. Omitted means every day, which for a feature
  // is usually wrong — nine in-game hours nightly is most of a channel — but it is the
  // schedule's existing default and this is not the place to override an author.
  const days = Array.isArray(fm?.airDays) && fm.airDays.length ? fm.airDays : null;
  const placed = new Set();
  for (const s of slots) {
    // Every row of a showing carries the showing's OWN start, so the runner never has
    // to guess where a run began — see filmRunElapsed for what guessing cost.
    const headBlock = (((s % SPORTS_GAMES_PER_DAY) + SPORTS_GAMES_PER_DAY) % SPORTS_GAMES_PER_DAY);
    const conditions = JSON.stringify({ film_run_start: headBlock * BLOCK });
    for (let n = 0; n < need; n++) {
      const absolute = headBlock + n;
      const block = absolute % SPORTS_GAMES_PER_DAY;
      if (placed.has(block)) continue;   // a later showing would overlap an earlier one — first wins
      placed.add(block);
      // A run that crosses midnight lands on the NEXT weekday, so a Saturday-night
      // feature's small-hours reels are Sunday rows. Getting this wrong would put the
      // back half of the picture on the wrong day of the week entirely.
      const dayShift = Math.floor(absolute / SPORTS_GAMES_PER_DAY);
      const mask = filmDayMask(days, dayShift);
      await query(
        `INSERT INTO media_channel_playlist (id,channel_id,broadcast_id,start_time,duration_override,priority,conditions,slot_type,days)
         VALUES ($1,$2,$3,$4,$5,0,$6::jsonb,'broadcast',$7)`,
        [randomUUID(), channelId, broadcastId, block * BLOCK, BLOCK, conditions, mask]
      ).catch(() => {});
    }
  }
}

// Game-seconds a film's CURRENT screening has been running, counting from the head of
// its contiguous run of slots rather than from the slot the clock happens to be in.
// Without this a three-block picture restarts from the distributor card every hour:
// each block is its own playlist row, and every other type genuinely wants per-slot
// elapsed. Handles a run that wraps past midnight (a 21:00 feature ending at 03:00).
// The head is STAMPED on every row of a run (`conditions.film_run_start`) by
// ensureFilmSlots, not inferred from which slots happen to touch. Inference looked
// tidier and was wrong twice over: two separate one-block screenings that happen to
// abut (`@airtime 9 12`) merged into a single six-hour run, so the second showing
// seeked past its own ending and played nothing; and a picture reserving all eight
// blocks formed a ring with no head at all. A stamp has neither failure and is a
// straight modular subtraction. Rows with no stamp (a hand-placed slot from the dev
// panel) fall back to per-slot elapsed, which is right for a lone slot.
function filmRunElapsed(item, gameSecondsSinceMidnight) {
  const DAY = 24 * 3600;
  const head = Number.isFinite(item?.filmRunStart) ? item.filmRunStart : item.startTime;
  return (((gameSecondsSinceMidnight - head) % DAY) + DAY) % DAY;
}

async function recalculateNpcSchedules() {
  const { rows: plItems } = await query(`
    SELECT p.id, p.channel_id, p.broadcast_id, p.conditions,
           b.broadcast_graph, b.playback_mode, b.talkshow_pools, b.morning_pools, b.gameshow_pools,
           c.channel_type, c.studio_zone_id
    FROM media_channel_playlist p
    JOIN media_broadcasts b ON b.id = p.broadcast_id
    JOIN media_channels c ON c.id = p.channel_id
    WHERE p.broadcast_id IS NOT NULL
  `);

  let updatedItems = 0;
  let updatedNpcs  = 0;
  // Authoritative set of NPCs that legitimately staff a studio (live shows +
  // weather forecasts), with the studio they belong to. Used for the self-heal pass.
  const liveStaff = new Map();

  for (const row of plItems) {
    let graph = row.broadcast_graph;
    if (!graph) continue;
    if (typeof graph === 'string') { try { graph = JSON.parse(graph); } catch { continue; } }
    const normalized = _normalizeBroadcastGraph(graph);

    // Collect all unique npc_anchor ids from the graph
    const npcIds = [];
    for (const node of Object.values(normalized.nodes || {})) {
      const nid = node.data?.npc_id || node.npc_id;
      if (node.type === 'npc_anchor' && nid && !npcIds.includes(nid)) npcIds.push(nid);
    }

    // A talk show's stored graph is start-only (the episode is assembled live), so its cast
    // can't be read from npc_anchor nodes — it comes from talkshow_pools instead: the resident
    // host + sidekick, plus the reusable guest. All three staff the studio; the guest gets its
    // own roaming lifecycle graph + a backstage "home" it vanishes to between episodes.
    const isTalkshow = row.playback_mode === 'talkshow';
    let guestNpcId = null;
    if (isTalkshow) {
      let ts = row.talkshow_pools;
      if (typeof ts === 'string') { try { ts = JSON.parse(ts); } catch { ts = null; } }
      guestNpcId = ts?.guestNpc || null;
      npcIds.length = 0;
      for (const id of [ts?.host, ts?.sidekick, ts?.guestNpc]) if (id && !npcIds.includes(id)) npcIds.push(id);
    }

    // A morning show's stored graph is start-only too (assembled per airing from the live
    // world), so its couch comes from morning_pools: the two resident hosts. Both staff the
    // studio and commute in on the show's daily slot — no roaming guest, no backstage.
    const isMorning = row.playback_mode === 'morning';
    if (isMorning) {
      let mn = row.morning_pools;
      if (typeof mn === 'string') { try { mn = JSON.parse(mn); } catch { mn = null; } }
      npcIds.length = 0;
      for (const id of [mn?.host, mn?.cohost]) if (id && !npcIds.includes(id)) npcIds.push(id);
    }

    // A game show's stored graph is start-only as well (the lots are dealt live from the item
    // catalog), so its cast comes from gameshow_pools: the host and an optional sidekick who
    // reads the prize copy. Both commute in on the show's slot. The CONTESTANTS are not NPCs
    // at all — they're name strings spoken as attribution, so there is nothing to staff for
    // them and no backstage.
    const isGameshow = row.playback_mode === 'gameshow';
    if (isGameshow) {
      let gs = row.gameshow_pools;
      if (typeof gs === 'string') { try { gs = JSON.parse(gs); } catch { gs = null; } }
      npcIds.length = 0;
      for (const id of [gs?.host, gs?.sidekick]) if (id && !npcIds.includes(id)) npcIds.push(id);
    }

    // Only LIVE channels, WEATHER forecasts, TALK SHOWS, MORNING SHOWS and GAME SHOWS
    // physically staff the studio. For a scripted show, npc_anchor is speaker attribution
    // only — never staff it, and strip any stale staffing a previous (buggy) pass merged
    // into its conditions.
    const staffsNpcs = row.channel_type === 'live' || row.playback_mode === 'weather' || isTalkshow || isMorning || isGameshow;
    const studioZoneId = row.studio_zone_id || null;

    // Reconcile npc_staff in the item's conditions (merge for live/weather/talkshow, clear otherwise)
    let cond = row.conditions;
    if (typeof cond === 'string') { try { cond = JSON.parse(cond); } catch { cond = {}; } }
    if (Array.isArray(cond) || !cond) cond = {};
    const existing = Array.isArray(cond.npc_staff) ? cond.npc_staff : [];
    const desired  = staffsNpcs ? [...new Set([...existing, ...npcIds])] : [];
    const staffChanged = !(desired.length === existing.length && desired.every((v, i) => v === existing[i]));
    if (staffChanged) {
      if (desired.length) cond.npc_staff = desired; else delete cond.npc_staff;
      await query(`UPDATE media_channel_playlist SET conditions=$1 WHERE id=$2`, [JSON.stringify(cond), row.id]);
      updatedItems++;
    }

    if (!staffsNpcs || !npcIds.length) continue;

    // Assign default behaviour graph (with studio zone) to any staff NPC, and ensure
    // work_zone_id points at the studio so GO_TO_WORK resolves. The guest is special: it
    // gets the roaming lifecycle graph and a hidden backstage home instead.
    const backstageZone = isTalkshow && guestNpcId ? await ensureBackstageZone() : null;
    const defaultGraph = JSON.stringify(makeDefaultStudioGraph(studioZoneId));
    const guestGraph   = JSON.stringify(makeTalkshowGuestGraph(studioZoneId));
    for (const npcId of npcIds) {
      liveStaff.set(npcId, studioZoneId);
      const isGuest = isTalkshow && npcId === guestNpcId;
      // Always overwrite — ensures zone_id is populated even for existing graphs; set work_zone_id
      // so GO_TO_WORK resolves without graph params. The guest also gets its backstage home_zone.
      const { rowCount } = isGuest
        ? await query(
            `UPDATE npcs SET behaviour_graph=$1, work_zone_id=$2, home_zone=$3 WHERE id=$4`,
            [guestGraph, studioZoneId, backstageZone, npcId]
          ).catch(() => ({ rowCount: 0 }))
        : await query(
            `UPDATE npcs SET behaviour_graph=$1, work_zone_id=COALESCE(work_zone_id,$2) WHERE id=$3`,
            [defaultGraph, studioZoneId, npcId]
          ).catch(() => ({ rowCount: 0 }));
      if (rowCount) {
        updatedNpcs++;
        const npc = world.npcs.get(npcId);
        if (npc) {
          if (isGuest) { npc.behaviour_graph = JSON.parse(guestGraph); npc.work_zone_id = studioZoneId; npc.home_zone = backstageZone; npc._ai = null; }
          else if (!npc.work_zone_id) npc.work_zone_id = studioZoneId;
        }
      }
    }

    // Re-inject work-phase actions from the broadcast graph. Skipped for talk shows and
    // morning shows — the episode is assembled live, so there's no baked per-NPC line
    // sequence to extract, and the guest's lifecycle graph must not be overwritten.
    if (!isTalkshow && !isMorning) await _injectWorkPhaseForPlaylistItem({ broadcast_id: row.broadcast_id, npcStaff: npcIds, studioZoneId });
  }

  // Self-heal: any NPC still routed to a studio zone but no longer legitimately
  // staffed (e.g. a scripted show's attributed speaker that a prior buggy pass
  // commuted on-stage) is reset to a plain wander graph so it stops appearing.
  const { rows: szRows } = await query(`SELECT studio_zone_id FROM media_channels WHERE studio_zone_id IS NOT NULL`);
  const studioZoneIds = szRows.map(r => r.studio_zone_id);
  if (studioZoneIds.length) {
    const { rows: strays } = await query(
      `SELECT id FROM npcs WHERE work_zone_id = ANY($1)`, [studioZoneIds]
    ).catch(() => ({ rows: [] }));
    const neutral = JSON.stringify(makeWanderGraph());
    for (const npc of strays) {
      if (liveStaff.has(npc.id)) continue; // legitimately staffed — leave alone
      await query(`UPDATE npcs SET behaviour_graph=$1, work_zone_id=NULL WHERE id=$2`, [neutral, npc.id]).catch(() => {});
      const live = world.npcs.get(npc.id);
      if (live) { live.behaviour_graph = JSON.parse(neutral); live.work_zone_id = null; }
      updatedNpcs++;
    }
  }

  await loadChannelRuntimes();
  return { updatedItems, updatedNpcs };
}

// ── Graph walker (VINE broadcast graphs) ─────────────────────────────────────

function _resolveEdge(edges, fromNode, fromPort) {
  return edges.find(e => e.fromNode === fromNode && e.fromPort === fromPort)?.toNode || null;
}

function _normalizeBroadcastGraph(graph) {
  if (!graph || !graph.nodes || graph._normalized) return graph;
  const edges = [];
  const nodes = {};
  for (const [id, node] of Object.entries(graph.nodes)) {
    const { type, next, ifTrue, ifFalse, _vine, ...fields } = node;
    if (next)    edges.push({ fromNode: id, fromPort: 'next',    toNode: next });
    if (ifTrue)  edges.push({ fromNode: id, fromPort: 'ifTrue',  toNode: ifTrue });
    if (ifFalse) edges.push({ fromNode: id, fromPort: 'ifFalse', toNode: ifFalse });
    for (const k of Object.keys(fields)) {
      if (k.startsWith('branch_') && fields[k]) {
        edges.push({ fromNode: id, fromPort: k, toNode: fields[k] });
        delete fields[k];
      }
    }
    nodes[id] = { type: type || 'say', data: fields };
  }
  return { _start: graph._start, nodes, edges, _normalized: true };
}

function _evalBroadcastCondition(node, channelId, nowMs) {
  const { condition_type: type, params = {} } = node.data;
  switch (type) {
    case 'IS_DAYTIME': {
      const { timePhase } = getEnvironmentState();
      return timePhase === 'day' || timePhase === 'dawn' || timePhase === 'dusk';
    }
    case 'FLAG_SET': {
      // Synchronous world-flag check (best-effort from DB cache not available here; use channel blackboard flag)
      return false; // async world flags not feasible in sync tick; use SET_FLAG to track state
    }
    case 'VIEWERS_PRESENT': {
      const id = params.channel_id || channelId;
      for (const [zoneId, channelMap] of zoneTunings) {
        if (channelMap.has(id) && getZonePlayers(zoneId).length > 0) return true;
      }
      return false;
    }
    case 'OTHER_VIEWERS_PRESENT': {
      const id = params.channel_id || channelId;
      return _otherViewers(id) > 0;
    }
    case 'NEWS_AVAILABLE': {
      const q = newsQueue.get(channelId) || [];
      if (!params.category) return q.length > 0;
      return q.some(i => i.category === params.category);
    }
    case 'HOUR_RANGE': {
      const { hour } = getEnvironmentState();
      if (hour == null) return false;
      const from = params.from ?? 0;
      const to = params.to ?? 23;
      return from <= to ? (hour >= from && hour <= to) : (hour >= from || hour <= to);
    }
    // Is this actor actually standing on the studio floor right now? The say-node room-authority
    // rule already refuses to put words in an absent mouth, but it does it SILENTLY — fine for a
    // stray line, useless for a whole segment built around one person, which just becomes the
    // host talking to a chair. This lets a graph ask FIRST and play something else instead.
    // No studio bound to the channel ⇒ presence isn't modelled here, so answer yes rather than
    // cutting a segment on a technicality.
    case 'NPC_IN_STUDIO': {
      const npcId = params.npc_id;
      if (!npcId) return false;
      const zoneId = channelRuntime.get(params.channel_id || channelId)?.studioZoneId;
      if (!zoneId) return true;
      return !!getZone(zoneId)?.npcs?.has(npcId);
    }
    case 'RANDOM_CHANCE':
      return Math.random() < (params.chance ?? 0.5);
    default:
      return false;
  }
}

// Walk the VINE graph for one tick. Returns { text, key, style } or null.
// Broadcast tick interval — the graph walker (tickBroadcastGraph) emits at most one
// message per tick, and node holds are honored at tick granularity (a node advances on
// the first tick past its hold). Kept fine (1s) so the text-scaled spoken-line holds
// (nodeHoldMs) land close to their target + 1s buffer; the tick only re-evaluates, never skips.
const BROADCAST_TICK_MS = 1000;

// One-pass length (ms) of a theme, before it loops. A tracker song's natural end is
// its longest channel × the per-step duration (tempo → 16th notes, STEPS_PER_BEAT = 4,
// mirroring the client's makeSongPlayer). Recorded samples carry no server-side length,
// so they fall back to the standard 8 s music hold. Returns 0 when the name resolves to
// nothing (missing theme ⇒ caller uses the plain title-card hold).
function _themeDurationMs(name) {
  const song = getSongDefByName(name);
  if (song) {
    const channels = Array.isArray(song.channels) ? song.channels : [];
    const steps = channels.reduce((m, ch) => Math.max(m, Array.isArray(ch) ? ch.length : 0), 0);
    if (steps > 0) return Math.round(steps * (60 / (song.tempo || 120) / 4) * 1000);
  }
  if (getSampleDefByName(name)) return 8000;
  return 0;
}

// Canonical on-air hold (ms) for a content node, before tick-quantization. This is the
// single source of truth for how long each node type stays up, shared by the live walker
// (tickBroadcastGraph sets bb.waitUntil = nowMs + nodeHoldMs(node)) and the late-tune
// seeker (_seekGraph) — so a viewer tuning in mid-program lands where playback actually is.
// Nothing that puts a PICTURE on screen (title card, credits card, tech-diff slate)
// may hold for less than this. Matches the client's own card floor in tv.js.
const CARD_MIN_HOLD_MS = 2600;

function nodeHoldMs(node) {
  const d = node.data || {};
  switch (node.type) {
    case 'npc_action':
    case 'event':
      return 3000;
    case 'music':
      return (getSongDefByName(d.song) || getSampleDefByName(d.song)) ? 8000 : 5000;
    case 'title_card':
      // A title card carrying a theme holds for the theme's full length, so its intro
      // song plays out before the first spoken line drops (title-card / theme sync).
      if (d.theme) { const t = _themeDurationMs(d.theme); if (t > 0) return Math.max(CARD_MIN_HOLD_MS, t); }
      // Floored: a card is a picture that has to be READ. An authored duration of 0 (or a
      // fraction of a second) put the logo on screen and took it away in the same breath.
      return Math.max(CARD_MIN_HOLD_MS, (d.duration ?? 10) * 1000);
    case 'wait':
      return (d.seconds ?? 5) * 1000;
    case 'credits':
    case 'tech_difficulties':
      return Math.max(CARD_MIN_HOLD_MS, (d.duration ?? 10) * 1000);
    case 'show_overlay':
    case 'overlay': {
      const overlayType = d.overlayType || d.overlay_type
        || (node.type === 'overlay' && !d.graphic_id ? 'text_card' : 'lower_third');
      // The letterbox matte is a persistent layer, not a card: it holds no airtime at
      // all (duration_s 0) and stays up until something switches it off.
      return (d.duration_s ?? (overlayType === 'text_card' ? 5 : 6)) * 1000;
    }
    default: {
      // say / ticker / camera_cut, … — scale the on-screen hold to how long the voice
      // needs to read the line, so the read-aloud never has to speed up and nothing is
      // cut off. ~110 ms/char (calibrated to the formant synth, which averages ~94 ms/char
      // — the margin covers slower per-narrator voices), capped at 30 s of speech, plus a
      // buffer before the next line. A small floor keeps very short lines readable.
      // The cap is the ONLY thing that can now clip a read (the voice no longer
      // compresses to fit — see AudioEngine.speak), so it's set past any sane line.
      // Sports lines pass an explicit holdMs and keep it.
      //
      // FITTED, NOT GUESSED. 110ms/char dated from when estimateDuration silently
      // under-reported the real read length, so it was covering an error rather than
      // a voice. With that fixed and the pace retuned, the coefficient was re-fitted
      // against every line in the .bsm corpus read by the SLOWEST possible narrator
      // (the speed range floor, 1.24) — because the average voice is not what has to
      // fit. 75ms/char + 900ms leaves 0.5% of lines overrunning, essentially all of
      // them the >273-char crawl copy that the read-aloud filter never voices. Below
      // ~70 the overrun rate climbs sharply (2%, then 4%, then 10%) for progressively
      // less dead air, so this sits just above that knee.
      //
      // A small overrun is now SAFE: the client queues (tv.js _pump), so it delays
      // the next line rather than cutting the current one mid-word. That safety is
      // what allows a fitted coefficient instead of a defensive one.
      if (d.holdMs != null) return d.holdMs;
      const text = typeof d.text === 'string' ? d.text : '';
      if (!text) return 8000;                          // e.g. runtime camera snapshot — sane default
      const voiceMs = Math.min(text.length * 75, 30000);
      return Math.max(2200, voiceMs + 900);
    }
  }
}

// Walk a VINE graph forward by segElapsedMs, setting bb.currentNode / bb.waitUntil
// so the channel appears mid-program when a viewer tunes in late.
function _seekGraph(graph, bb, segElapsedMs, nowMs) {
  const edges = graph.edges || [];
  let nodeId = graph._start;
  let remaining = segElapsedMs;

  // Node types that occupy on-air time (produce a message + a hold). Everything else
  // (start/condition/loop/anchor/random/set_flag/inject_news/break/clear_overlay) is
  // instantaneous during a walk.
  const CONTENT_TYPES = ['say', 'ticker', 'camera_cut', 'overlay', 'show_overlay', 'title_card',
    'event', 'npc_action', 'music', 'credits', 'tech_difficulties'];
  // Step budget scales with the graph: a feature-length film is thousands of nodes,
  // and a fixed 2000-step cap would strand a late viewer partway through the picture
  // instead of at the shot that's actually on.
  const maxSteps = Math.max(2000, Object.keys(graph.nodes || {}).length * 2);
  for (let step = 0; step < maxSteps && remaining > 0; step++) {
    if (!nodeId) {
      // Graph exhausted without a loop node — wrap back to _start (implicit looping)
      nodeId = graph._start;
    }
    const node = graph.nodes[nodeId];
    if (!node) break;
    if (node.type === 'wait') {
      // Wait produces no message; after it, playback advances to the next node.
      const waitMs = Math.ceil(nodeHoldMs(node) / BROADCAST_TICK_MS) * BROADCAST_TICK_MS;
      if (remaining >= waitMs) { remaining -= waitMs; nodeId = _resolveEdge(edges, nodeId, 'next'); }
      else { bb.waitUntil = nowMs + (waitMs - remaining); bb.currentNode = _resolveEdge(edges, nodeId, 'next'); return; }
    } else if (node.type === 'overlay' && (node.data?.overlayType === 'letterbox')) {
      // The matte is a persistent LAYER, not a card: it holds no airtime, so the seeker
      // would walk straight past it and a late viewer — which, for a 175-minute feature,
      // is nearly every viewer — would watch the picture unframed and ungraded. Record
      // the state as we pass it so the walker can raise it on the first tick.
      bb.pendingLetterbox = !!node.data?.on;
      nodeId = _resolveEdge(edges, nodeId, 'next');
    } else if (CONTENT_TYPES.includes(node.type)) {
      // Quantize the hold up to the tick grid — a 6s overlay occupies two 5s ticks.
      const holdMs = Math.ceil(nodeHoldMs(node) / BROADCAST_TICK_MS) * BROADCAST_TICK_MS;
      if (remaining >= holdMs) { remaining -= holdMs; nodeId = _resolveEdge(edges, nodeId, 'next'); }
      else { bb.waitUntil = nowMs + (holdMs - remaining); bb.currentNode = nodeId; return; }
    } else if (node.type === 'loop') {
      nodeId = _resolveEdge(edges, nodeId, 'next') || graph._start;
    } else if (node.type === 'npc_anchor') {
      // Track speaker so early say nodes have the correct anchor after seeking
      const npcId = node.data?.npc_id;
      const npc = world.npcs?.get(npcId);
      bb.npcAnchor = npc?.name || _anchorFallbackName(npcId) || null;
      bb.npcAnchorId = npcId || null;
      nodeId = _resolveEdge(edges, nodeId, 'next');
    } else {
      nodeId = _resolveEdge(edges, nodeId, 'next'); // start/condition — no time cost
    }
  }
  bb.currentNode = nodeId || null;
}

// ── Live-text tokens for scripted broadcasts ─────────────────────────────────
// Scripted say/ticker/credits/title-card text may embed {tokens} that resolve at
// airtime from live world state — the "smart trick" that lets a fixed graph speak
// the actual clock, weekday, weather, and a per-airing viewer count. Unknown tokens
// are left verbatim, and any text with no '{' skips the whole pass (the common case),
// so this is free for the vast majority of lines. Mirrors the weather/sports
// assemblers' {token} idiom (wxLine/sportsLine), but for hand-authored graphs.
const _DOW_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Live count of sets tuned to this channel right now (zone devices + tablet tuners).
function _liveWatchers(channelId) {
  let n = 0;
  for (const [zoneId, channelMap] of zoneTunings) {
    if (channelMap.has(channelId)) n += getZonePlayers(zoneId).length;
  }
  for (const chId of tabletTuners.values()) if (chId === channelId) n++;
  return n;
}

// Words for the time left until the 04:00 morning service ("1 hour and 13 minutes").
function _untilFour(minutes) {
  let d = 4 * 60 - (minutes ?? 0);
  if (d <= 0) d += 24 * 60;
  const h = Math.floor(d / 60), m = d % 60;
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  return parts.join(' and ') || 'no time at all';
}

// How many OTHER sets are tuned to this channel right now, excluding the set the
// spoken line is addressing — the "watching this with you" count.
function _otherViewers(channelId) {
  return Math.max(0, _liveWatchers(channelId) - 1);
}

function _scriptedTokens(channelId, state, bb) {
  const env = getEnvironmentState();
  return {
    clock:      env.time || '02:00',
    weekday:    _DOW_NAMES[env.dayOfWeek] || 'a night with no name',
    season:     String(env.season || '').replace(/_/g, ' '),
    weather:    String(env.currentWeatherType || env.weatherType || 'still').replace(/_/g, ' '),
    tempc:      Math.round(env.tempC ?? 0),
    viewers:    _otherViewers(channelId).toLocaleString('en-US'),
    watching:   _liveWatchers(channelId),
    until_four: _untilFour(env.minutes),
    // Game-show outcome tokens — who was in the studio, what they said, who took it.
    // Always strings, even off-round (a late tuner can land on a reveal line).
    ...gameshowTokens(channelId),
  };
}

function _subTokens(text, channelId, state, bb) {
  if (!text || text.indexOf('{') === -1) return text;
  const tok = _scriptedTokens(channelId, state, bb);
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in tok ? String(tok[k]) : m));
}

function tickBroadcastGraph(channelId, graph, state, nowMs, segElapsedSec = 0) {
  if (!state.graphBlackboard) return null;
  const bb = state.graphBlackboard;
  // A broadcast is "acted live" when it runs on a live channel OR the graph demands a
  // present host (weather forecasts set graph._requireHost). Such broadcasts are
  // presence-gated — the host NPC must be in the studio or the channel falls to
  // camera-idle → technical difficulties — and their lines are spoken in the studio.
  // An ad break is never performed: a commercial is film that rolls whatever the studio
  // floor is doing, so it must not be presence-gated or staged as spoken lines in-studio.
  const liveActed = !graph._adBreak && (state.channelType === 'live' || !!graph._requireHost);
  // Scripted daily-schedule content plays through with no host gating — unless the
  // graph explicitly requires a present host (weather), which is gated everywhere.
  const skipPresence = state.scheduleMode === 'daily' && !graph._requireHost;

  // Reset blackboard if a different broadcast is now active
  if (bb.activeBroadcastId !== graph._broadcastId) {
    bb.currentNode = null;
    bb.waitUntil = null;
    bb.npcAnchor = null;
    bb.npcAnchorId = null;
    bb.anchorPresent = true;
    bb.hostAbsent = false;
    bb.absentDetectedAt = null;
    bb.techDiffMode = false;
    bb.activeBroadcastId = graph._broadcastId;
    // Seek to mid-program position if tuning in partway through
    if (segElapsedSec > 0) {
      _seekGraph(graph, bb, segElapsedSec * 1000, nowMs);
      return null;
    }
  }

  // Tech-diff / show-delay only apply to truly-live unscripted channels
  if (!skipPresence) {
    // Recover the instant the full cast is back on the studio floor.
    // The stage is no longer empty — start the show, even if it's short-handed.
    if (bb.hostAbsent && state.studioZoneId && _anyCastPresent(graph, state.studioZoneId)) {
      bb.hostAbsent = false;
      bb.absentDetectedAt = null;
      bb.techDiffMode = false;
    }
    // No working camera on the studio floor means no picture, whatever the script
    // says. A live show with its cameras dark is a transmission failure, and it
    // recovers by itself the moment a unit comes back up.
    if (liveActed && state.studioZoneId) {
      const studioLive = !!zoneCameras.get(state.studioZoneId)?.length;
      if (!studioLive) {
        bb.techDiffMode = true;
        bb.cameraBlackout = true;
        return _techDiffMessage(state, channelId, nowMs);
      }
      // A unit is back up — lift the blackout we raised (but not a tech-diff some
      // other failure owns).
      if (bb.cameraBlackout) { bb.cameraBlackout = false; bb.techDiffMode = false; }
    }
    if (bb.techDiffMode) {
      if (bb.npcAnchorId && state.studioZoneId) {
        const zone = getZone(state.studioZoneId);
        if (zone?.npcs?.has(bb.npcAnchorId)) {
          bb.techDiffMode = false;
          bb.hostAbsent = false;
          bb.absentDetectedAt = null;
        }
      }
    }
    if (bb.techDiffMode) {
      return _techDiffMessage(state, channelId, nowMs);
    }
    if (bb.hostAbsent) {
      // A scheduled cast member hasn't reached the studio yet. Don't spam empty-studio
      // camera shots and don't drop to technical-difficulties (which reads as "signal
      // lost") — hold a clean, apologetic delay card naming who we're waiting on, and
      // keep holding it until they arrive. Re-sent on a 5s slot so late-tuners see it.
      bb.waitUntil = nowMs + 5000;
      const missing = _absentCastNames(graph, state.studioZoneId);
      const who = missing.length ? _joinNames(missing) : (bb.npcAnchor || 'a cast member');
      const verb = missing.length > 1 ? 'have' : 'has';
      const slot = Math.floor(nowMs / 5000);
      return {
        style: 'overlay',
        key: `absent-delay:${channelId}:${slot}`,
        overlay: {
          overlayType: 'text_card',
          text: `PLEASE STAND BY\n\nTonight's programme is delayed — ${who} ${verb} not yet arrived in the studio.\n\nWe apologise for the inconvenience and thank you for your patience.`,
          duration: 0,
        },
      };
    }
  }

  // A matte the seeker walked past on the way in — raise it before anything else, so a
  // viewer who joined mid-picture is framed the same as one who watched from the top.
  if (bb.pendingLetterbox !== undefined) {
    const on = bb.pendingLetterbox;
    bb.pendingLetterbox = undefined;
    return {
      overlay: { overlayType: 'letterbox', on, text: '', duration: 0 },
      key: `letterbox:${channelId}:${on}:${nowMs}`, style: 'overlay',
    };
  }

  if (bb.waitUntil && nowMs < bb.waitUntil) return null;
  bb.waitUntil = null;

  const nodes = graph.nodes;
  const edges = graph.edges || [];
  let nodeId = bb.currentNode || graph._start;
  bb.currentNode = null;

  let steps = 0;
  while (nodeId && steps++ < 50) {
    const node = nodes[nodeId];
    if (!node) break;

    try { switch (node.type) {
      case 'start':
        nodeId = _resolveEdge(edges, nodeId, 'next');
        break;

      case 'say': {
        let raw = _subTokens(node.data?.text || '', channelId, state, bb);
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        const holdMs_say = nodeHoldMs(node);
        bb.waitUntil = nowMs + holdMs_say;
        // Room authority: a line belongs to whoever is standing there to say it. If
        // this anchor has walked off set mid-show, the line is not deferred and not
        // covered for — it simply never happens. Dead air, and the show moves on.
        if (liveActed && !skipPresence && bb.npcAnchorId && bb.anchorPresent === false
            && node.data?.style !== 'narration' && node.data?.style !== 'ambient') {
          bb.waitUntil = nowMs + 1200;
          nodeId = bb.currentNode; bb.currentNode = null;
          break;
        }
        // Every line is attempted live; the actor's condition decides what lands.
        if (liveActed && bb.npcAnchorId) {
          const imp = _actorImpairment(bb.npcAnchorId);
          if (imp.out) {
            // Nothing to broadcast — but the studio sees exactly why.
            _stageLine(state.studioZoneId, `<span style="color:var(--text-dim);font-style:italic">${bb.npcAnchor || 'The host'} ${_COLLAPSE[Math.floor(Math.random() * _COLLAPSE.length)]}</span>`);
            bb.waitUntil = nowMs + 2500;
            nodeId = bb.currentNode; bb.currentNode = null;
            break;
          }
          raw = _garbleLine(raw, imp.level);
        }
        const key_say = `graph:${channelId}:${nodeId}:${nowMs}`;
        const style_say = node.data?.style || 'raw';
        const isNarration = style_say === 'narration';
        const isAmbient   = style_say === 'ambient';
        // 'verbatim' — a pre-rendered line that already carries its own speaker
        // (e.g. a surveillance microreel frame, `Bob says, "…"`). It airs exactly
        // as captured (never re-wrapped by an anchor) but still leaks to bystanders
        // as [TV] speech, just like genuine dialogue on air.
        const isVerbatim  = style_say === 'verbatim';
        if (liveActed && state.studioZoneId) {
          if (isNarration) {
            // Unseen announcer — no one is on stage saying this, so it comes over
            // the studio speakers (a NARRATOR:/ANNOUNCER: line, or a SHOT block).
            _stageLine(state.studioZoneId, `<span style="color:var(--yellow)">The studio speakers announce, "${raw}"</span>`);
          } else if (!isAmbient && bb.npcAnchor) {
            _stageLine(state.studioZoneId, `<span style="color:var(--yellow)">${bb.npcAnchor} says, "${raw}"</span>`);
          } else if (isAmbient) {
            _stageLine(state.studioZoneId, `<span style="color:var(--text-dim);font-style:italic">${raw}</span>`);
          }
        }
        const text_say = style_say === 'ticker'
          ? `>> ${bb.npcAnchor ? `${bb.npcAnchor}: ` : ''}${raw} <<`
          : (!isVerbatim && !isNarration && !isAmbient && bb.npcAnchor ? `${bb.npcAnchor} says, "${raw}"` : raw);
        // Verbatim lines (microreel dialogue) leak as speech without needing an anchor.
        const isSpeech = (!isNarration && !isAmbient && style_say !== 'ticker' && !!bb.npcAnchor) || isVerbatim;
        return { text: text_say, key: key_say, style: isAmbient ? 'ambient' : 'raw', duration: holdMs_say / 1000, ...(isSpeech ? { speech: true, speechText: text_say } : {}), ...(node.data?.scorebug ? { scorebug: node.data.scorebug } : {}), ...(node.data?.graphic ? { graphic: node.data.graphic } : {}), ...(node.data?.gameday ? { gameday: node.data.gameday } : {}) };
      }

      case 'music': {
        const songName = node.data?.song || '';
        const text = node.data?.text || '';
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        const songDef = getSongDefByName(songName);
        // A theme may name a recorded sample (audio_samples) instead of a tracker
        // song — play it once as a one-shot sting rather than a looping tracker bed.
        const sampleDef = songDef ? null : getSampleDefByName(songName);
        const key_music = `music:${channelId}:${nodeId}:${nowMs}`;
        if (songDef || sampleDef) {
          bb.waitUntil = nowMs + nodeHoldMs(node);
          const audioMsg = songDef ? { type: 'audio_music', def: songDef } : { type: 'audio_sample', def: sampleDef };
          if (liveActed && state.studioZoneId) {
            sendToZone(state.studioZoneId, audioMsg);
          }
          return { text, song: songDef || null, sample: sampleDef || null, key: key_music, style: 'music' };
        }
        logBroadcast(channelId, 'info', `Song '${songName}' not found — ${text ? 'showing cue text' : 'skipped'}`, nodeId);
        if (!text) { nodeId = bb.currentNode; bb.waitUntil = null; break; }
        bb.waitUntil = nowMs + nodeHoldMs(node);
        return { text, key: key_music, style: 'raw' };
      }

      case 'npc_action': {
        const emote = node.data?.message || node.data?.action || '';
        if (!emote) { nodeId = _resolveEdge(edges, nodeId, 'next'); break; }
        // Nobody there to do it — the beat doesn't happen (see `say`).
        if (liveActed && !skipPresence && bb.npcAnchorId && bb.anchorPresent === false) {
          nodeId = _resolveEdge(edges, nodeId, 'next');
          break;
        }
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        bb.waitUntil = nowMs + nodeHoldMs(node);
        const key_act = `action:${channelId}:${nodeId}:${nowMs}`;
        const emoteText = bb.npcAnchor ? `${bb.npcAnchor} ${emote}` : emote;
        if (state.channelType === 'live' && state.studioZoneId) {
          _stageLine(state.studioZoneId, `<span style="color:var(--text-dim);font-style:italic">${emoteText}</span>`);
        }
        return { text: emoteText, key: key_act, style: 'raw' };
      }

      case 'ticker': {
        if (bb.hostAbsent) { nodeId = _resolveEdge(edges, nodeId, 'next'); break; }
        const text = `>> ${_subTokens(node.data?.text || '', channelId, state, bb)} <<`;
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        bb.waitUntil = nowMs + nodeHoldMs(node);
        return { text, key: `ticker:${channelId}:${nodeId}`, style: 'ticker' };
      }

      case 'npc_anchor': {
        const npcId = node.data?.npc_id;
        const npc = world.npcs?.get(npcId);
        bb.npcAnchor = npc?.name || _anchorFallbackName(npcId) || null;
        bb.npcAnchorId = npcId || null;
        // Presence check — for live channels and any host-required graph (weather).
        // Two different failures, two different outcomes: nobody at all on the studio
        // floor is a show that can't start (stand-by card); this particular actor
        // missing while the rest are working is just a hole in the programme, and the
        // show carries on around them.
        if (!skipPresence && npcId && liveActed && state.studioZoneId) {
          const zone = getZone(state.studioZoneId);
          bb.anchorPresent = !!zone?.npcs?.has(npcId);
          if (bb.anchorPresent) {
            bb.hostAbsent = false;
          } else if (!bb.hostAbsent && !_anyCastPresent(graph, state.studioZoneId)) {
            bb.hostAbsent = true;
            bb.absentDetectedAt = nowMs;
          }
        } else {
          bb.anchorPresent = true;
        }
        nodeId = _resolveEdge(edges, nodeId, 'next');
        break;
      }

      case 'inject_news': {
        const cat = node.data?.category;
        const q = newsQueue.get(channelId) || [];
        const idx = cat ? q.findIndex(i => i.category === cat) : 0;
        let text = node.data?.fallback_text || null;
        if (idx >= 0) {
          text = q[idx].text;
          q.splice(idx, 1);
          newsQueue.set(channelId, q);
        }
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        if (text) return { text, key: `inject:${channelId}:${nowMs}`, style: 'raw' };
        nodeId = bb.currentNode; // no item — skip
        break;
      }

      case 'camera_cut': {
        const zoneId = node.data?.zone_id;
        const label = node.data?.label || zoneId;
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        // A camera direction is executed by a physical unit or not at all. Pick a
        // working camera actually registered in the target zone; with none there,
        // the shot has no source. Losing the studio's own feed is a transmission
        // failure (tech difficulties); losing a remote feed just kills that cut.
        const cam = zoneId ? _pickCamera(zoneId, state) : null;
        if (!cam) {
          if (zoneId === state.studioZoneId && !skipPresence) {
            bb.techDiffMode = true;
            return _techDiffMessage(state, channelId, nowMs);
          }
          nodeId = bb.currentNode; bb.currentNode = null;
          break;
        }
        const snap = buildCameraSnapshot(zoneId);
        if (!snap) { nodeId = bb.currentNode; bb.currentNode = null; break; }
        bb.waitUntil = nowMs + nodeHoldMs(node);
        // Act the cut out where it physically happens: the crew on the studio floor
        // see the unit take the shot, and anyone standing in a remote zone being cut
        // to sees the lens find them.
        if (liveActed) {
          _stageLine(state.studioZoneId, `<span style="color:var(--text-dim);font-style:italic">${cam.label} swings around and takes ${zoneId === state.studioZoneId ? label : `the feed from ${label}`}; its tally light blinks red.</span>`);
          if (zoneId !== state.studioZoneId) _stageLine(zoneId, `<span style="color:var(--text-dim);font-style:italic">A camera in the corner pivots to face the room. Its tally light comes on.</span>`);
        }
        return { text: `[${cam.label} — ${label}] ${snap}`, key: `cam:${channelId}:${zoneId}:${nowMs}`, style: 'raw' };
      }

      case 'break': {
        // Natural interruption point — drain queued item if available
        const q = newsQueue.get(channelId) || [];
        if (q.length) {
          const item = q.shift();
          newsQueue.set(channelId, q);
          bb.currentNode = _resolveEdge(edges, nodeId, 'next');
          return { text: item.text, key: `break:${channelId}:${item.ts}`, style: 'raw' };
        }
        nodeId = _resolveEdge(edges, nodeId, 'next');
        break;
      }

      case 'condition': {
        const result = _evalBroadcastCondition(node, channelId, nowMs);
        nodeId = _resolveEdge(edges, nodeId, result ? 'ifTrue' : 'ifFalse');
        break;
      }

      case 'wait': {
        bb.waitUntil = nowMs + nodeHoldMs(node);
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        return null;
      }

      case 'loop':
        nodeId = _resolveEdge(edges, nodeId, 'next') || graph._start;
        break;

      case 'random': {
        const branches = node.data?.branches || [];
        if (!branches.length) { nodeId = null; break; }
        const total = branches.reduce((s, b) => s + (b.weight ?? 1), 0);
        let roll = Math.random() * total;
        let chosen = 0;
        for (let i = 0; i < branches.length; i++) {
          roll -= branches[i].weight ?? 1;
          if (roll <= 0) { chosen = i; break; }
        }
        nodeId = _resolveEdge(edges, nodeId, `branch_${chosen}`);
        break;
      }

      case 'set_flag': {
        const { flag, value } = node.data || {};
        // Route through setFlag so the write-through world-flag cache stays in
        // sync; fire-and-forget because the graph walker is synchronous.
        if (flag) setFlag('world', flag, value)
          .then(() => emit('flag.set', { scope: 'world', flag, value: value == null ? 'true' : String(value) }))
          .catch(() => {});
        nodeId = _resolveEdge(edges, nodeId, 'next');
        break;
      }

      // ── Game-show round control ─────────────────────────────────────────────
      // Both are INSTANTANEOUS side-effect nodes (like set_flag), not holds: the guess
      // window is the host's own patter between them, so there's never dead air waiting
      // on a timer. _seekGraph walks straight past them without firing, which is exactly
      // right — a late tuner must not open or resolve a round they weren't present for.
      case 'gameshow_round': {
        gameshowOpenRound(channelId, node, state.studioZoneId);
        nodeId = _resolveEdge(edges, nodeId, 'next');
        break;
      }

      case 'gameshow_reveal': {
        gameshowResolveRound(channelId);
        nodeId = _resolveEdge(edges, nodeId, 'next');
        break;
      }

      case 'title_card': {
        const gid = node.data?.graphic_id;
        const graphic = gid ? graphicsCache.get(gid) : null;
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        bb.waitUntil = nowMs + nodeHoldMs(node);
        if (graphic && (graphic.content || '').trim()) {
          const cardContent = _subTokens(graphic.content, channelId, state, bb);
          const caption = node.data?.caption ? `\n${_subTokens(node.data.caption, channelId, state, bb)}` : '';
          // A theme rides the card: the intro song starts the moment the card appears,
          // and the card holds for the theme's length (see nodeHoldMs) so no spoken line
          // drops until it ends. song/sample defs ride the result for broadcastTick to play.
          const themeName = node.data?.theme;
          const themeSong = themeName ? getSongDefByName(themeName) : null;
          const themeSample = themeSong ? null : (themeName ? getSampleDefByName(themeName) : null);
          if ((themeSong || themeSample) && liveActed && state.studioZoneId) {
            sendToZone(state.studioZoneId, themeSong ? { type: 'audio_music', def: themeSong } : { type: 'audio_sample', def: themeSample });
          }
          return { text: cardContent + caption, key: `graphic:${channelId}:${gid}:${nowMs}`, style: graphicStyle(graphic), ...(themeSong ? { song: themeSong } : {}), ...(themeSample ? { sample: themeSample } : {}) };
        }
        // Graphic missing or empty — log it and skip straight to the next card this
        // tick (no dead 5s hold on a card that can't render).
        // A MISS is usually a STALE CACHE, not a missing row: graphicsCache is only refilled at
        // boot and by the graphics CRUD routes, so a card authored in git and loaded with
        // `content:import` against a running server is invisible until a restart (which is how a
        // perfectly good title card silently never shows). Kick an async refill — the walker is
        // synchronous so this card is still skipped, but the next airing finds it.
        if (gid && !graphic) loadGraphicsCache().catch(() => {});
        logBroadcast(channelId, 'warn', `Title-card graphic '${gid || '(none)'}' ${graphic ? 'is empty' : 'not found'} — skipped to next card`, nodeId);
        nodeId = bb.currentNode;
        bb.waitUntil = null;
        break;
      }

      case 'credits': {
        const creditsText = _subTokens(node.data?.text || '', channelId, state, bb);
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        bb.waitUntil = nowMs + nodeHoldMs(node);
        return { text: creditsText, key: `credits:${channelId}:${nodeId}:${nowMs}`, style: 'credits', duration: node.data?.duration ?? null };
      }

      case 'show_overlay':
      case 'overlay': {
        const overlayType = node.data?.overlayType || node.data?.overlay_type
          || (node.type === 'overlay' && !node.data?.graphic_id ? 'text_card' : 'lower_third');
        const overlay = {
          overlayType,
          text: node.data?.text || '',
          subtext: node.data?.subtext || '',
          duration: node.data?.duration_s ?? (overlayType === 'text_card' ? 5 : 6),
          clearScreen: overlayType === 'text_card' || overlayType === 'act_card' || overlayType === 'intermission',
          // Film layers carry their own switch: `on` for the persistent letterbox
          // matte, `fade` for the direction of an optical transition.
          ...(node.data?.on !== undefined ? { on: !!node.data.on } : {}),
          ...(node.data?.fade ? { fade: node.data.fade } : {}),
        };
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        bb.waitUntil = nowMs + (overlay.duration * 1000);
        return { overlay, key: `overlay:${channelId}:${nodeId}:${nowMs}`, style: 'overlay' };
      }

      case 'clear_overlay': {
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        return { overlay: null, key: `clear_overlay:${channelId}:${nowMs}`, style: 'overlay' };
      }

      case 'event': {
        const evType = (node.data?.event_type || '').toUpperCase();
        const EVENT_MESSAGES = {
          LAUGHTER:         'Laughter erupts from the crowd!',
          APPLAUSE:         'The crowd roars with applause!',
          CHEERING:         'The crowd cheers enthusiastically!',
          BOOING:           'The crowd boos!',
          GASPING:          'The crowd gasps!',
          MURMURING:        'Murmurs ripple through the crowd.',
          SILENCE:          'A hush falls over the crowd.',
          FADE_OUT:         'The camera slowly fades to black.',
          FADE_IN:          'The camera fades back in.',
          RETURN_FROM_BREAK:'The scene cuts back in from a commercial break.',
        };
        const evText = EVENT_MESSAGES[evType] || `${evType.charAt(0) + evType.slice(1).toLowerCase()} from the crowd.`;
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        bb.waitUntil = nowMs + nodeHoldMs(node);
        // Only relay to room for truly-live channels — never live_relay for recordings
        if (state.channelType === 'live' && state.studioZoneId) {
          _stageLine(state.studioZoneId, `<span style="color:var(--text-dim);font-style:italic">${evText}</span>`);
        }
        return { text: evText, key: `event:${channelId}:${nodeId}:${nowMs}`, style: 'raw' };
      }

      case 'tech_difficulties': {
        const graphic = state.offlineGraphicId ? graphicsCache.get(state.offlineGraphicId) : null;
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        bb.waitUntil = nowMs + nodeHoldMs(node);
        const text = graphic ? graphic.content : '[TECHNICAL DIFFICULTIES] Please stand by.';
        return { text, key: `techdiff-node:${channelId}:${nodeId}:${nowMs}`, style: graphicStyle(graphic) };
      }

      default:
        // Unparseable/unknown node — ignore it, show nothing, log it, move on.
        logBroadcast(channelId, 'warn', `Unknown node type '${node.type}' — skipped`, nodeId);
        nodeId = _resolveEdge(edges, nodeId, 'next');
    } } catch (err) {
      // The node couldn't be run or safely skipped — log it and this tick surface
      // technical difficulties with the specific error as an on-screen card, then
      // advance so the graph recovers on the next tick.
      console.error(`[broadcast] graph node error (${channelId}/${nodeId}):`, err.message);
      logBroadcast(channelId, 'error', `Node error: ${err.message}`, nodeId);
      bb.currentNode = _resolveEdge(edges, nodeId, 'next');
      bb.waitUntil = nowMs + BROADCAST_TICK_MS;
      return {
        style: 'overlay',
        overlay: { overlayType: 'text_card', text: `TECHNICAL DIFFICULTIES\n${err.message}`, duration: 5 },
        key: `techdiff-err:${channelId}:${nodeId}:${nowMs}`,
      };
    }
  }
  return null;
}

// ── Actions ──────────────────────────────────────────────────────────────────

// Shared tuning core for both the TUNE_DEVICE action and the `tune` command: rewrite the
// device's flags, sync the zoneTunings / furnitureChannelIndex caches, and (on a real
// tune-on) emit device.tuned. channelNumber 0 = off. Returns a status the caller acts on
// for its own side effects (text output vs tv_off/panel) so the two can't drift on the core.
// NB: the off-path device.tuned emit is left to the caller — cmdTune deliberately stays
// silent there (no tv_relay_click on manual power-off) while TUNE_DEVICE emits.
async function _applyTuning(device, channelNumber, zoneId) {
  const flags = typeof device.flags === 'object' ? { ...device.flags } : JSON.parse(device.flags || '{}');

  // Remove any existing tuning from the cache.
  const old = furnitureChannelIndex.get(device.id);
  if (old) {
    const zMap = zoneTunings.get(old.zoneId);
    if (zMap) { zMap.delete(old.channelId); if (!zMap.size) zoneTunings.delete(old.zoneId); }
    furnitureChannelIndex.delete(device.id);
  }

  if (channelNumber === 0) {
    delete flags.tuned_channel;
    await updateFurniture(device.id, { flags: JSON.stringify(flags) });
    return { status: 'off' };
  }

  const { rows: chRows } = await query('SELECT * FROM media_channels WHERE number=$1 AND enabled=1', [channelNumber]);
  if (!chRows.length) return { status: 'not_found' };
  const channel = chRows[0];

  flags.tuned_channel = channelNumber;
  flags.tv_dial_freq = channelNumber;
  await updateFurniture(device.id, { flags: JSON.stringify(flags) });

  const deviceType = flags.broadcast_device_type || 'tv';
  if (!zoneTunings.has(zoneId)) zoneTunings.set(zoneId, new Map());
  zoneTunings.get(zoneId).set(channel.id, deviceType);
  furnitureChannelIndex.set(device.id, { zoneId, channelId: channel.id, deviceType, dialFrequency: channelNumber });

  emit('device.tuned', { furnitureId: device.id, channelNumber, channelId: channel.id });
  return { status: 'tuned', channel };
}

registerAction({
  type: 'TUNE_DEVICE',
  handler: async ({ actor, params }) => {
    const { furniture_id, channel_number } = params;
    if (!furniture_id || channel_number == null) {
      return { type: 'error', message: 'TUNE_DEVICE requires furniture_id and channel_number.' };
    }
    const { rows: fRows } = await query('SELECT * FROM furniture WHERE id=$1', [furniture_id]);
    if (!fRows.length) return { type: 'error', message: 'Device not found.' };
    const furniture = fRows[0];

    const result = await _applyTuning(furniture, channel_number, furniture.zone_id);
    if (result.status === 'off') {
      emit('device.tuned', { furnitureId: furniture_id, channelNumber: 0 });
      return { type: 'output', message: 'Device turned off.' };
    }
    if (result.status === 'not_found') return { type: 'output', message: `No channel ${channel_number}.` };
    return { type: 'output', message: `Tuned to channel ${channel_number}: ${result.channel.name}.` };
  },
});

registerAction({
  type: 'CAMERA_RECORD',
  handler: async ({ actor, params }) => {
    const { camera_id } = params;
    if (!camera_id) return { type: 'error', message: 'CAMERA_RECORD requires camera_id.' };
    const { rows } = await query('SELECT * FROM media_cameras WHERE id=$1', [camera_id]);
    if (!rows.length) return { type: 'error', message: 'Camera not found.' };
    const cam = rows[0];
    if (!cam.zone_id) return { type: 'error', message: 'Camera has no zone assigned.' };

    const text = buildCameraSnapshot(cam.zone_id);
    if (!text) return { type: 'error', message: 'Nothing to record.' };

    const buf = Array.isArray(cam.recording_buffer) ? cam.recording_buffer : JSON.parse(cam.recording_buffer || '[]');
    buf.push({ ts: Date.now(), text });
    const limit = cam.storage_limit || 200;
    if (buf.length > limit) buf.splice(0, buf.length - limit);

    await query('UPDATE media_cameras SET recording_buffer=$1 WHERE id=$2', [JSON.stringify(buf), camera_id]);
    emit('camera.recorded', { cameraId: camera_id, zoneId: cam.zone_id });
    return { type: 'output', message: 'Camera recorded a frame.' };
  },
});

registerAction({
  type: 'CAMERA_STREAM',
  handler: async ({ actor, params }) => {
    const { camera_id, channel_id, enabled } = params;
    if (!camera_id) return { type: 'error', message: 'CAMERA_STREAM requires camera_id.' };
    const isOn = enabled !== false && enabled !== 0;
    await query(
      'UPDATE media_cameras SET is_streaming=$1, streaming_channel_id=$2 WHERE id=$3',
      [isOn ? 1 : 0, isOn ? (channel_id || null) : null, camera_id]
    );
    await loadChannelRuntimes();
    return { type: 'output', message: isOn ? `Camera streaming to channel.` : 'Camera stream stopped.' };
  },
});

// The full DEADBALL roster — the union of team names across every sports broadcast's
// pools. Content owns the roster (media_broadcasts.sports_pools.teams), so this is the
// authoritative, complete list; the gossip plugin reads it through this seam to pin
// each NPC's favourite team to a fixed set (no table coupling, mirrors getStandings).
registerAction({
  type: 'broadcast.getSportsTeams',
  handler: async () => {
    const { rows } = await query(
      `SELECT sports_pools FROM media_broadcasts WHERE playback_mode='sports' AND sports_pools IS NOT NULL`,
    ).catch(() => ({ rows: [] }));
    const teams = new Set();
    for (const r of rows) {
      const sp = typeof r.sports_pools === 'string' ? (JSON.parse(r.sports_pools || '{}')) : (r.sports_pools || {});
      for (const t of (Array.isArray(sp.teams) ? sp.teams : [])) {
        const name = typeof t === 'string' ? t : t?.name;
        if (name) teams.add(name);
      }
    }
    return { teams: [...teams] };
  },
});

// The loaded sports script (teams + players + pools). Prefer a live channel runtime;
// fall back to the DB so standings can be computed before any channel is tuned.
// Resolve a script BY SPORT. Grabbing "the first sports script found" would hand
// hockey the baseball roster the moment both are on the air — the standings would
// be right for one league and nonsense for the other, with no error anywhere.
async function anySportsScript(sport) {
  for (const { script } of sportsChannels()) {
    if (!script?.teams) continue;
    if (!sport || (script.sport || 'baseball') === sport) return script;
  }
  // Fall back to the DB, still filtered on the sport when one was asked for.
  const { rows } = await query(
    `SELECT sports_pools FROM media_broadcasts WHERE playback_mode='sports' AND sports_pools IS NOT NULL`,
  ).catch(() => ({ rows: [] }));
  for (const row of rows) {
    const sp = typeof row.sports_pools === 'string' ? JSON.parse(row.sports_pools || '{}') : row.sports_pools;
    if (!sp || !Array.isArray(sp.teams)) continue;
    if (!sport || (sp.sport || 'baseball') === sport) return sp;
  }
  return null;
}

// The global clock — the sportsleague plugin reads this to know "which slot are we in"
// so it can bound the standings window and time seasons/World-Series to the schedule.
registerAction({
  type: 'broadcast.getSportsClock',
  handler: async () => ({ slot: sportsSlotIndex(), slotMs: sportsSlotMs(), gamesPerDay: SPORTS_GAMES_PER_DAY, ready: !!getEnvironmentState()?.date }),
});

// The next slot strictly AFTER `after` whose slot-of-day is one of `featured` (the
// `@airtime` blocks). `featured` null/empty ⇒ the immediate next slot (continuous league).
// Returns `{ slot, hour }` (hour = that block's in-game start hour). Pure.
function nextAirSlot(after, featured, G) {
  const feat = (Array.isArray(featured) && featured.length) ? featured.map((n) => ((n % G) + G) % G) : null;
  let slot = after + 1;
  if (feat) {
    for (let k = 1; k <= G; k++) { const c = after + k; if (feat.includes(((c % G) + G) % G)) { slot = c; break; } }
  }
  return { slot, hour: (((slot % G) + G) % G) * (24 / G) };
}

// Lets the sportsleague schedule the World Series onto the normal nightly slot instead of
// "the next hour", so it airs — and can be advertised — at a predictable in-game time.
registerAction({
  type: 'broadcast.nextSportsAirSlot',
  handler: async ({ params = {} } = {}) => {
    const after = Number.isFinite(params.after) ? params.after : sportsSlotIndex();
    // Each show has its own nightly airtime, so a championship has to be pinned to the
    // slot ITS league actually airs in — pinning the Cup to Deadball's hour would put
    // the biggest game of the hockey season on at a time nobody tunes in for it.
    const script = await anySportsScript(params.sport);
    return nextAirSlot(after, script?.airSlots, SPORTS_GAMES_PER_DAY);
  },
});

// Which sports have a show that can actually be scheduled. The league plugin asks so it
// never opens a season for a sport whose broadcast was never imported.
registerAction({
  type: 'broadcast.getSports',
  handler: async () => {
    const ids = new Set();
    for (const { script } of sportsChannels()) if (script?.teams) ids.add(script.sport || 'baseball');
    if (ids.size) return { sports: [...ids] };
    // Nothing airing this minute — fall back to what exists in the library, so a league
    // still ticks over on a schedule where its show only airs in the evening.
    const { rows } = await query(
      `SELECT sports_pools FROM media_broadcasts WHERE playback_mode='sports' AND sports_pools IS NOT NULL`,
    ).catch(() => ({ rows: [] }));
    for (const row of rows) {
      const sp = typeof row.sports_pools === 'string' ? JSON.parse(row.sports_pools || '{}') : row.sports_pools;
      if (sp && Array.isArray(sp.teams)) ids.add(sp.sport || 'baseball');
    }
    return { sports: [...ids] };
  },
});

// ZERO-WRITE STANDINGS. Every game is a pure function of its slot, so the league table
// for any window is just a fold over the deterministic schedule — no per-game DB rows.
// Result-only (no narration graph), so it's cheap enough to recompute on demand. The
// sportsleague plugin passes its season window and caches the result.
registerAction({
  type: 'broadcast.computeStandings',
  handler: async ({ params = {} } = {}) => {
    // `sport` selects which league is being computed — each sport runs its own season
    // over its own schedule, and each counts different things (see `SEASON` in
    // sports/<name>.js). Omitting it keeps the original Deadball behaviour.
    const { startSlot, endSlot, sport = 'baseball' } = params;
    const script = await anySportsScript(sport);
    if (!script) return { rows: [] };
    const season = sportOf(script).season;
    if (!season) return { rows: [] };
    let from = Number.isFinite(startSlot) ? startSlot : 0;
    const to = Number.isFinite(endSlot) ? endSlot : sportsSlotIndex();
    if (to - from > 100000) { console.warn(`[broadcast] computeStandings window ${to - from} slots — clamping`); from = to - 100000; }
    const table = new Map();
    const acc = {};
    // Walk the window IN ORDER carrying the injury ledger, so the table is folded from
    // the same games the broadcast aired — a club that lost three men to the boards is
    // short in the standings for exactly the games it was short on air. A sport whose
    // sim ignores `unavailable` (baseball) is unaffected by any of this.
    const out = new Map();
    for (let slot = from; slot < to; slot++) {
      for (const [name, heal] of out) if (heal <= slot) out.delete(name);
      const unavailable = new Set(out.keys());
      const gs = sportsGameForSlot(script, slot, null, unavailable);   // regular schedule only
      if (!gs) continue;
      for (const c of gs.game.casualties || []) {
        const heal = c.dead ? Number.MAX_SAFE_INTEGER : slot + Math.max(1, c.slotsOut || 1);
        if (heal > (out.get(c.name) || 0)) out.set(c.name, heal);
      }
      season.fold(table, gs.game);
      season.foldExtras(acc, gs.game);
    }
    return { rows: season.sort([...table.values()]), sport, columns: season.columns, ...season.summariseExtras(acc) };
  },
});

// A team's card: how they've been going, and when they're next on.
//
// SPOILER RULE — the one thing that makes this action delicate. Every game is a
// pure function of its slot, so a FUTURE fixture can be simulated right now and
// would hand back a final score for a game nobody has watched. So upcoming games
// return the matchup and the airtime ONLY; the scores are computed (there is no
// way not to) and deliberately dropped on the floor. Past games return results,
// because those already aired.
//
// Bounded on both sides: this runs on a tablet tap, not a tick, and each slot
// inspected is a full game sim.
registerAction({
  type: 'broadcast.getTeamCard',
  handler: async ({ params = {} } = {}) => {
    const { sport = 'baseball', team, back = 24, ahead = 24 } = params;
    if (!team) return null;
    const script = await anySportsScript(sport);
    if (!script) return null;
    const now = sportsSlotIndex();
    const isOurs = (g) => g && (g.away.name === team || g.home.name === team);

    // Form, newest first. Only games this club actually played.
    const form = [];
    for (let slot = now - 1; slot >= Math.max(0, now - back) && form.length < 5; slot--) {
      const gs = sportsGameForSlot(script, slot, null);
      if (!isOurs(gs?.game)) continue;
      const g = gs.game;
      const home = g.home.name === team;
      const us = home ? g.homeScore : g.awayScore;
      const them = home ? g.awayScore : g.homeScore;
      form.push({
        slot, home, opponent: home ? g.away.name : g.home.name,
        us, them, won: us > them, overtime: !!g.overtime,
      });
    }

    // The next time they're on. Matchup and airtime only — see the spoiler rule.
    let next = null;
    for (let slot = now; slot < now + ahead; slot++) {
      const gs = sportsGameForSlot(script, slot, null);
      if (!isOurs(gs?.game)) continue;
      const g = gs.game;
      next = {
        slot,
        home: g.home.name === team,
        opponent: g.home.name === team ? g.away.name : g.home.name,
        hour: ((slot % SPORTS_GAMES_PER_DAY) + SPORTS_GAMES_PER_DAY) % SPORTS_GAMES_PER_DAY * (24 / SPORTS_GAMES_PER_DAY),
        slotsAway: slot - now,
        live: slot === now,
      };
      break;
    }

    // Current streak, read off the form we already have — no extra simulation.
    let streak = 0, streakWon = null;
    for (const f of form) {
      if (streakWon === null) { streakWon = f.won; streak = 1; continue; }
      if (f.won !== streakWon) break;
      streak++;
    }

    return { sport, team, form, next, streak, streakWon };
  },
});

// One specific slot's result — used to crown the World Series from the finalists' game
// (pass their names as `teams` so the WS override, not the regular schedule, is simmed).
registerAction({
  type: 'broadcast.getSlotResult',
  handler: async ({ params = {} } = {}) => {
    const { slot, teams, sport = 'baseball' } = params;
    const script = await anySportsScript(sport);
    if (!script || !Number.isFinite(slot)) return null;
    const override = (Array.isArray(teams) && teams.length === 2) ? { teams, worldSeries: true } : null;
    const gs = sportsGameForSlot(script, slot, override);
    if (!gs) return null;
    const { away, home, awayScore, homeScore } = gs.game;
    const winner = awayScore === homeScore ? '' : (awayScore > homeScore ? away.name : home.name);
    // `overtime` matters to the caller: a final decided past regulation pays the loser
    // a point in a hockey table, so the crowning result has to carry how it was settled.
    return { away: away.name, home: home.name, awayScore, homeScore, winner, overtime: !!gs.game.overtime, shootout: !!gs.game.shootout };
  },
});

// The ONE game the schedule puts on next — not a fixture list. Walks forward from
// the current slot over the sports items on every channel's grid, clearing both
// gates a real airing clears (the script's `airSlots` hour AND the item's day
// mask), and stops at the first one that qualifies. That's what makes this "what
// you could sit down and watch", rather than "every game the round-robin plays
// today", most of which nobody ever sees.
//
// SPOILER RULE, same as getTeamCard and for the same reason: a future game is a
// pure function of its slot and its score is therefore already computable. A game
// that has not started returns matchup + airtime only. A game currently ON AIR
// returns the score AS FAR AS IT HAS BEEN CALLED — indexed off the same shared
// clock the play-by-play is seeked by — so the widget knows what the announcer has
// said and not one beat more. Once the slot's play-out is done it's a FINAL.
//
// Query-free: channel grids, the season and the environment clock are all in
// memory, and only the one matching slot is ever simulated. Safe on a home screen.
registerAction({
  type: 'broadcast.getNextOnAir',
  handler: async ({ params = {} } = {}) => {
    const wantSport = params.sport || null;
    const wantTeam = (params.team || '').trim() || null;
    const G = SPORTS_GAMES_PER_DAY;
    const now = sportsSlotIndex();
    const dow0 = getEnvironmentState()?.dayOfWeek;

    const cands = [];
    for (const [channelId, state] of channelRuntime) {
      for (const i of state.playlist || []) {
        if (i.playback_mode !== 'sports' || !i.sportsScript) continue;
        const sport = sportOf(i.sportsScript)?.id || 'baseball';
        if (wantSport && sport !== wantSport) continue;
        cands.push({ channelId, number: state.number ?? null, item: i, script: i.sportsScript, sport });
      }
    }
    if (!cands.length) return null;

    const LOOKAHEAD = G * 8;   // a week and a day of slots — beyond that, say nothing
    for (let slot = now; slot < now + LOOKAHEAD; slot++) {
      const sod = ((slot % G) + G) % G;
      // Day-of-week walks with the slot so a Tuesday-only show isn't matched
      // against today's mask when the slot we're testing lands on Thursday.
      const dow = dow0 == null ? null : ((Number(dow0) - 1 + Math.floor(slot / G) - Math.floor(now / G)) % 7 + 7) % 7 + 1;
      for (const c of cands) {
        const slots = c.script.airSlots;
        if (Array.isArray(slots) && slots.length && !slots.includes(sod)) continue;
        if (dow != null && !_slotAirsOn(c.item, dow)) continue;
        const gs = sportsGameForSlot(c.script, slot, overrideFor(c.script));
        if (!gs) continue;
        const g = gs.game;
        if (wantTeam && g.away.name !== wantTeam && g.home.name !== wantTeam) continue;

        const out = {
          sport: c.sport,
          channel: c.number,
          slot,
          slotsAway: slot - now,
          hour: sod * (24 / G),
          away: g.away.name, home: g.home.name,
          awayAbbr: sportsAbbr(g.away.name), homeAbbr: sportsAbbr(g.home.name),
          live: false, final: false,
          awayScore: null, homeScore: null,
          status: null,
        };
        if (slot !== now) {
          out.status = out.slotsAway === 1 ? 'Up next' : `${String(Math.floor(out.hour)).padStart(2, '0')}:00`;
          return out;
        }
        // On air. How far in are we? The play-by-play fills SPORTS_GAME_FILL of the
        // slot and the rest is post-game, so past that the score is the final one.
        const frac = (sportsSlotElapsedMin() / SPORTS_SLOT_GAME_MIN) / SPORTS_GAME_FILL;
        const beats = Array.isArray(g.beats) ? g.beats : [];
        if (frac >= 1 || !beats.length) {
          out.final = true;
          out.awayScore = g.awayScore; out.homeScore = g.homeScore;
          out.status = 'FINAL';
          return out;
        }
        const b = beats[Math.min(beats.length - 1, Math.max(0, Math.floor(frac * beats.length)))];
        out.live = true;
        out.awayScore = b.awayScore ?? 0;
        out.homeScore = b.homeScore ?? 0;
        // Sport-agnostic status line: baseball beats carry half/inning, hockey beats
        // carry period + clock. A sport with neither still gets an honest "LIVE".
        out.status = b.inning != null ? `${b.half === 'bottom' ? 'BOT' : 'TOP'} ${sportsOrdinal(b.inning)}`
          : b.period ? `P${b.period}${b.clockStr ? ' ' + b.clockStr : ''}`
          : 'LIVE';
        return out;
      }
    }
    return null;
  },
});

// ── Media Deck: load/eject cassettes ─────────────────────────────────────────

function _findDeckInZone(zoneId) {
  return _zoneDeck(zoneId);
}

// Deep clone: decks are now served from the live world.furniture cache, so a
// caller mutating nested flag objects (pirate_queue, deck_ejected_slots) must
// never share references with the cached row — updateFurniture's RETURNING row
// is the only thing allowed to change the cache.
function _deckFlags(deck) {
  if (deck.flags && typeof deck.flags === 'object') return structuredClone(deck.flags);
  return typeof deck.flags === 'string' ? JSON.parse(deck.flags || '{}') : {};
}

// ── Broadcast Piracy (SPECTER) ────────────────────────────────────────────────
// A media deck is a station's transmitter. With the pirate firmware flashed onto
// their tablet, a player can hijack the deck (the Signal Hijack minigame) and
// seize the frequency: while `pirate_owner` is set the deck answers only to them,
// its citywide `deck_active` override is theirs to run, and the legit control
// interface is locked to everyone else. Persistent until reclaimed (counter-hack
// for now; engineer-NPC reboot + wanted-heat drop land in later phases). Seizure
// state lives on the deck's own furniture flags, so it survives restarts.
const PIRACY_FLAG = 'piracy_installed';
async function isPiracyInstalled(player) {
  const v = await getFlag('player', PIRACY_FLAG, player);
  return v === '1' || v === 1 || v === true;
}

function _isDeckAdmin(player) { return player?.role === 'admin' || player?.role === 'dev'; }

// Who may legitimately operate a deck's controls: an admin/dev (the station-owner
// proxy until corp ownership exists) or the current pirate. An un-seized deck is
// otherwise locked — the firmware+hijack is the only way in for everyone else.
function canOperateDeck(dflags, player) {
  if (_isDeckAdmin(player)) return true;
  return !!dflags.pirate_owner && dflags.pirate_owner === player?.id;
}

// Shared gate for the deck-operate handlers (load/eject/select/use). Returns an
// error result to short-circuit on, or null when the player may operate the deck.
function _deckLockError(dflags, player) {
  if (canOperateDeck(dflags, player)) return null;
  const hint = dflags.pirate_owner
    ? 'Someone else has pirated this deck. Take it back with <b>pirate</b>.'
    : 'Its control interface is locked. Flash pirate firmware and <b>pirate</b> it to seize the frequency.';
  return { type: 'error', message: `The deck won't answer to you. ${hint}` };
}

// ⚠ TAMPER dead-man ping to a previous owner when a deck is seized out from under
// them (mirrors surveillance's tamperPing; kept local to avoid importing it).
function _deckTamperPing(ownerId, actorId, stationName, zoneName, reason) {
  if (!ownerId || ownerId === actorId) return;
  sendToPlayer(ownerId, { type: 'system', message: `<span class="text-red">⚠ TAMPER</span> — ${stationName || 'a station'} at ${zoneName || 'unknown'} ${reason}` });
}

const PIRACY_LOCKOUT_MS = 5 * 60 * 1000;
const pendingPirate = new Map(); // playerId -> { deckId, ts }
const pirateLockout = new Map(); // playerId -> untilTs

// use <pirate firmware> — flash the piracy firmware onto the tablet, consuming it.
async function doInstallPiracyFirmware(args, raw, player) {
  if (!player) return undefined;
  const nameHint = args.join(' ').trim().toLowerCase();
  const it = await resolveInventoryItem(player, { tag: 'piracy_firmware', name: nameHint || undefined });
  if (!it) return undefined; // not carrying one / named something else — let other handlers try
  if (await isPiracyInstalled(player)) {
    return { type: 'error', message: 'The pirate firmware is already flashed onto your tablet.' };
  }
  if (it.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [it.inv_id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [it.inv_id]);
  await setFlag('player', PIRACY_FLAG, '1', player);
  return { type: 'output', message: `You slot the ${it.name} into the tablet. A flasher tears through the signature check and burns a pirate transmitter stack into ROM. <span class="item-grant">Signal piracy online. Find a station's media deck and <b>pirate</b> it.</span>` };
}

// pirate <deck> — arm a Signal Hijack on a station's media deck. Result returns
// via `pirateresolve`. Requires the firmware; on-site (the deck's zone).
async function cmdPirate(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const until = pirateLockout.get(player.id) || 0;
  if (Date.now() < until) return { type: 'error', message: `Your rig is locked out. ${Math.ceil((until - Date.now()) / 1000)}s remaining.` };
  if (!(await isPiracyInstalled(player))) {
    return { type: 'error', message: 'You need the pirate firmware flashed onto your tablet to hijack a media deck.' };
  }
  const nameHint = args.join(' ').trim().toLowerCase();
  const zoneDecks = getZoneFurniture(player.current_zone).filter(f => f.flags && 'media_deck' in f.flags);
  const deck = nameHint ? zoneDecks.find(f => f.name?.toLowerCase().includes(nameHint)) : zoneDecks[0];
  if (!deck) return { type: 'error', message: 'There is no media deck here to pirate.' };
  const dflags = _deckFlags(deck);
  if (canOperateDeck(dflags, player)) return { type: 'error', message: `You already control the ${deck.name}.` };
  // Firmware AND hardware. The firmware (above) is what makes a transmitter stack
  // *possible*; the deck is what you breach the station's deck WITH, and it's what
  // `hack_difficulty` reads from on the next line. Every other breach in the game
  // demands one, so this one does too — the two gates aren't redundant, they're the
  // program and the machine that runs it.
  if (!(await hasHackDeck(player.id))) {
    return { type: 'error', message: `The firmware is flashed and ready, but the ${deck.name} still needs something jacked into it. You need a hacking device.` };
  }

  const skill = await effectiveSkill(player, 'hacking');
  const difficulty = await hackDifficulty(player.id, dflags.hack_difficulty);
  const stationName = channelRuntime.get(dflags.channel_id)?.stationName || deck.name;
  pendingPirate.set(player.id, { deckId: deck.id, ts: Date.now() });
  return { type: 'signal_hijack', deckId: deck.id, deckName: deck.name, stationName, skill, difficulty };
}

// pirateresolve <deckId> <1|0> — silent; the Signal Hijack overlay fires this.
async function cmdPirateResolve(args, raw, player) {
  if (!player) return { type: 'noop' };
  const deckId = args[0];
  const win = args[1] === '1';
  const pending = pendingPirate.get(player.id);
  pendingPirate.delete(player.id);
  if (!pending || pending.deckId !== deckId || Date.now() - pending.ts > 180000) return { type: 'noop' };

  const { rows } = await query(
    `SELECT f.id, f.name, f.flags, f.zone_id, z.name AS zone_name FROM furniture f
       LEFT JOIN zones z ON z.id = f.zone_id WHERE f.id=$1`, [deckId]
  );
  const deck = rows[0];
  if (!deck) return { type: 'error', message: 'The deck is gone.' };
  const dflags = _deckFlags(deck);
  const stationName = channelRuntime.get(dflags.channel_id)?.stationName || deck.name;

  if (!win) {
    pirateLockout.set(player.id, Date.now() + PIRACY_LOCKOUT_MS);
    // The trace costs the deck condition, as it does on every other failed breach.
    await damageHackDeck(player.id);
    return { type: 'error', message: 'The carrier slips your lock and the station traces your transmitter. Rig lockout: 5 minutes.' };
  }

  const priorOwner = dflags.pirate_owner || null;
  dflags.pirate_owner = player.id;
  dflags.pirate_since = Date.now();
  // Seed the pirate queue from the station's own library so there's something on
  // air the instant it's seized; the captor edits it from the console.
  const lib = Array.isArray(dflags.deck_cassettes) ? [...dflags.deck_cassettes] : [];
  dflags.pirate_queue = Array.isArray(dflags.pirate_queue) && dflags.pirate_queue.length ? dflags.pirate_queue : lib;
  dflags.pirate_cursor = 0;
  dflags.pirate_loop = dflags.pirate_loop || 'queue';
  dflags.pirate_playing = true;
  dflags.pirate_started_ms = Date.now();
  delete dflags.pirate_engineer_at; // fresh defend window for the new captor
  await updateFurniture(deck.id, { flags: JSON.stringify(dflags) });
  _deckCache.delete(deck.zone_id);
  _pirateCache.delete(deck.zone_id);
  await awardSkillUse(player.id, 'hacking', await breachMargin(player, dflags.hack_difficulty));
  // Citywide takeover is self-reporting heat (broadcast_piracy, witness 'always').
  await dispatchAction({ type: 'CHARGE_CRIME', actor: player, params: { key: 'broadcast_piracy', zoneId: deck.zone_id } }).catch(() => {});
  _deckTamperPing(priorOwner, player.id, stationName, deck.zone_name || deck.zone_id, 'was HIJACKED out from under you — you no longer control it.');
  return { type: 'output', message: `<span class="ip-gain">CARRIER SEIZED.</span> ${stationName} answers to you now — open the pirate console with <b>air</b>. But the station logged the breach: an engineer is en route to the deck. Hold the deck in person or lose the air.` };
}

// ── Reclaim: the station fights back (Phase 4) ───────────────────────────────
// Three active paths, no auto-timer: (1) an engineer response reboots the deck
// unless the captor is holding it in person; (2) dying/arrest drops every seizure;
// (3) counter-hack — a rival runs Signal Hijack on a deck they don't own (already
// handled by cmdPirate/cmdPirateResolve, which reset the defend window).
const ENGINEER_DELAY_MS = 120000; // defend window before the station's engineer arrives
const ENGINEER_RETRY_MS = 90000;  // repelled in person → the engineer tries again later
const PIRATE_KEYS = ['pirate_owner', 'pirate_since', 'pirate_queue', 'pirate_cursor', 'pirate_loop',
  'pirate_playing', 'pirate_started_ms', 'pirate_crawl', 'pirate_mode', 'pirate_live_source', 'pirate_engineer_at'];

// When the engineer arrives (pure): due once the defend window (or a repel retry)
// has elapsed since the seizure.
function _engineerDueAt(dflags) {
  return dflags.pirate_engineer_at || (dflags.pirate_since || 0) + ENGINEER_DELAY_MS;
}

// Wipe every pirate_* flag → the deck falls back to its channel's own programming.
async function _clearSeizure(deck, dflags) {
  for (const k of PIRATE_KEYS) delete dflags[k];
  await updateFurniture(deck.id, { flags: JSON.stringify(dflags) }).catch(() => {});
  _deckCache.delete(deck.zone_id);
  _pirateCache.delete(deck.zone_id);
}

// Release every station a player holds (death / arrest drops the seizure).
async function _releaseSeizuresBy(ownerId, reasonToOwner) {
  if (!ownerId) return;
  const decks = [...world.furniture.values()].filter(f => f.flags && 'media_deck' in f.flags && f.flags.pirate_owner === ownerId);
  for (const deck of decks) {
    const dflags = _deckFlags(deck);
    const station = channelRuntime.get(dflags.channel_id)?.stationName || deck.name;
    await _clearSeizure(deck, dflags);
    if (reasonToOwner) sendToPlayer(ownerId, { type: 'system', message: `<span class="text-red">⚠ SIGNAL LOST</span> — ${station} slipped your grip (${reasonToOwner}).` });
    sendToZone(deck.zone_id, { type: 'zone_event', message: `The deck reboots itself; normal programming resumes.` });
  }
}

// Engineer response tick: reboot any deck whose defend window has elapsed, unless
// the captor is standing at the deck (they run the engineer off — retry later).
async function engineerTick() {
  const decks = [...world.furniture.values()].filter(f => f.flags && 'media_deck' in f.flags && f.flags.pirate_owner != null);
  const now = Date.now();
  for (const deck of decks) {
    const dflags = _deckFlags(deck);
    if (!dflags.pirate_owner || now < _engineerDueAt(dflags)) continue;
    const station = channelRuntime.get(dflags.channel_id)?.stationName || deck.name;
    const present = getZonePlayers(deck.zone_id).some(p => p.id === dflags.pirate_owner);
    if (present) {
      dflags.pirate_engineer_at = now + ENGINEER_RETRY_MS;
      await updateFurniture(deck.id, { flags: JSON.stringify(dflags) }).catch(() => {});
      sendToPlayer(dflags.pirate_owner, { type: 'system', message: `<span class="text-amber">⚠ You run a station engineer off the ${deck.name}.</span> They'll be back — don't leave the deck.` });
      sendToZone(deck.zone_id, { type: 'zone_event', message: `A station engineer edges toward the deck, sees it's guarded, and retreats.` }, dflags.pirate_owner);
      continue;
    }
    const owner = dflags.pirate_owner;
    await _clearSeizure(deck, dflags);
    sendToPlayer(owner, { type: 'system', message: `<span class="text-red">⚠ SIGNAL LOST</span> — a station engineer reached the ${deck.name} and rebooted ${station}. You no longer hold the air.` });
    sendToZone(deck.zone_id, { type: 'zone_event', message: `A station engineer reboots the deck. Normal programming resumes.` });
  }
}
schedule('15s', () => engineerTick().catch(e => console.error('[broadcast] engineer tick error:', e.message)));

// Death (which covers a downing/arrest) drops every station the victim held.
on('player.death', ({ player }) => {
  if (player?.id) _releaseSeizuresBy(player.id, 'you were taken down').catch(() => {});
});

// ── Pirate console (Phase 2) ─────────────────────────────────────────────────
// Find the deck this player currently pirates — prefer one in their zone (so the
// on-site captor edits the deck in front of them), else the single one they hold
// (remote control), else null with an ambiguity flag.
async function _findPiratedDeck(player) {
  const { rows } = await query(
    `SELECT f.id, f.name, f.flags, f.zone_id, z.name AS zone_name FROM furniture f
       LEFT JOIN zones z ON z.id = f.zone_id
      WHERE jsonb_exists(f.flags,'media_deck') AND f.flags->>'pirate_owner'=$1`, [player.id]
  ).catch(() => ({ rows: [] }));
  if (!rows.length) return { deck: null };
  const here = rows.find(r => r.zone_id === player.current_zone);
  if (here) return { deck: here };
  if (rows.length === 1) return { deck: rows[0] };
  return { deck: null, ambiguous: true };
}

// The cameras the captor can cut to live (Phase 3): the station's own studio cam
// plus any SPECTER camera they control. Every source is just a zone we render
// with buildCameraSnapshot — no surveillance import, only a read of its device
// table. `key` = 'station' | 'specter:<deviceId>'.
async function _liveSources(dflags, player) {
  const out = [];
  const studio = channelRuntime.get(dflags.channel_id)?.studioZoneId;
  if (studio) out.push({ key: 'station', label: 'Station Studio Cam', zoneId: studio });
  const { rows } = await query(
    `SELECT d.id, d.zone_id, f.name, z.name AS zone_name FROM security_devices d
       JOIN furniture f ON f.id = d.id LEFT JOIN zones z ON z.id = d.zone_id
      WHERE d.owner_id=$1 AND d.device_kind IN ('sticky_cam','drone')`, [player.id]
  ).catch(() => ({ rows: [] }));
  for (const r of rows) out.push({ key: `specter:${r.id}`, label: `${r.name}${r.zone_name ? ` @ ${r.zone_name}` : ''}`, zoneId: r.zone_id });
  return out;
}

// Assemble the console payload: the pirate queue (named), the content pool the
// captor can add from (carried cassettes/microreels + the station's own library
// not already queued), and the live transport state.
async function buildPirateConsole(deck, player) {
  const dflags = _deckFlags(deck);
  const queueIds = Array.isArray(dflags.pirate_queue) ? dflags.pirate_queue : [];
  const lib = Array.isArray(dflags.deck_cassettes) ? dflags.deck_cassettes : [];

  // Carried cassettes (media_cassette items in inventory — includes SPECTER
  // microreels, which are cassette-tagged datachips).
  const { rows: invRows } = await query(
    `SELECT DISTINCT COALESCE(i.tags->>'broadcast_id', i.flags->>'broadcast_id') AS bid, i.name
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id=$1 AND pi.container_id IS NULL
        AND (jsonb_exists(i.tags,'media_cassette') OR (i.flags->>'media_cassette')='true')`,
    [player.id]
  ).catch(() => ({ rows: [] }));

  // Resolve display names + surveillance-clip (MicroReel) flag for every id we
  // reference (queue + library).
  const allIds = [...new Set([...queueIds, ...lib])].filter(Boolean);
  let nameById = new Map();
  if (allIds.length) {
    const { rows: bcRows } = await query(`SELECT id, name, category FROM media_broadcasts WHERE id = ANY($1)`, [allIds]).catch(() => ({ rows: [] }));
    for (const b of bcRows) nameById.set(b.id, { name: b.name, mini: String(b.id).startsWith('bc_clip_') || b.category === 'surveillance' });
  }
  const label = (id) => nameById.get(id) || { name: id, mini: String(id).startsWith('bc_clip_') };

  const queue = queueIds.map(id => ({ id, ...label(id) }));
  // Pool = carried cassettes + station library not already in the queue, deduped.
  const inQueue = new Set(queueIds);
  const pool = [];
  const seen = new Set();
  for (const r of invRows) {
    if (!r.bid || seen.has(r.bid)) continue;
    seen.add(r.bid);
    pool.push({ id: r.bid, name: r.name?.replace(/^Cassette:\s*/i, '') || r.bid, mini: String(r.bid).startsWith('bc_clip_'), src: 'carried' });
  }
  for (const id of lib) {
    if (seen.has(id) || inQueue.has(id)) continue;
    seen.add(id);
    pool.push({ id, ...label(id), src: 'library' });
  }

  const cursor = Math.min(Math.max(0, dflags.pirate_cursor | 0), Math.max(0, queue.length - 1));
  const mode = dflags.pirate_mode === 'live' ? 'live' : 'recorded';
  const sources = await _liveSources(dflags, player);
  const liveSource = dflags.pirate_live_source || null;
  const nowAiring = mode === 'live'
    ? `LIVE · ${liveSource?.label || sources[0]?.label || 'no camera'}`
    : (queue[cursor]?.name || null);
  return {
    type: 'pirate_console',
    deckId: deck.id,
    stationName: channelRuntime.get(dflags.channel_id)?.stationName || deck.name,
    playing: dflags.pirate_playing !== false,
    mode,
    liveSource,
    sources,
    loop: dflags.pirate_loop || 'queue',
    crawl: dflags.pirate_crawl || '',
    cursor,
    nowAiring,
    queue,
    pool,
  };
}

// air [open|play|stop|skip|loop <mode>|recorded|live [src]|source <src>|add <name>|remove <n>|move <n> <m>|crawl <text|off>|close]
// The pirate console — run the seized station's schedule from anywhere.
async function cmdAir(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const sub = (args[0] || 'open').toLowerCase();
  if (sub === 'close') return { type: 'pirate_console_close' };

  const { deck, ambiguous } = await _findPiratedDeck(player);
  if (ambiguous) return { type: 'error', message: 'You hold more than one station — stand at the deck you want to run.' };
  if (!deck) return { type: 'error', message: "You don't control any station. Pirate a media deck first (pirate <deck>)." };
  const dflags = _deckFlags(deck);
  const q = Array.isArray(dflags.pirate_queue) ? [...dflags.pirate_queue] : [];
  let touched = true;

  switch (sub) {
    case 'open': touched = false; break;
    case 'play': dflags.pirate_playing = true; dflags.pirate_started_ms = Date.now(); break;
    case 'stop': dflags.pirate_playing = false; break;
    case 'recorded': dflags.pirate_mode = 'recorded'; dflags.pirate_playing = true; dflags.pirate_started_ms = Date.now(); break;
    case 'live': {
      const sources = await _liveSources(dflags, player);
      if (!sources.length) return { type: 'error', message: 'You control no camera to route — the station has no studio cam and you hold no SPECTER cameras.' };
      const hint = args.slice(1).join(' ').trim().toLowerCase();
      let src = dflags.pirate_live_source || null;
      if (hint) src = sources.find(s => s.key.toLowerCase() === hint || s.label.toLowerCase().includes(hint)) || src;
      if (!src) src = sources[0]; // default to the studio cam (or first camera)
      dflags.pirate_mode = 'live';
      dflags.pirate_live_source = { key: src.key, label: src.label, zoneId: src.zoneId };
      dflags.pirate_playing = true;
      break;
    }
    case 'source': {
      const hint = args.slice(1).join(' ').trim().toLowerCase();
      if (!hint) return { type: 'error', message: 'Route which camera? air source <name>.' };
      const sources = await _liveSources(dflags, player);
      const src = sources.find(s => s.key.toLowerCase() === hint || s.label.toLowerCase().includes(hint));
      if (!src) return { type: 'error', message: `No camera matches "${hint}".` };
      dflags.pirate_live_source = { key: src.key, label: src.label, zoneId: src.zoneId };
      dflags.pirate_mode = 'live';
      dflags.pirate_playing = true;
      break;
    }
    case 'skip': {
      if (!q.length) break;
      dflags.pirate_cursor = _nextCursor(dflags.pirate_cursor | 0, q.length, 'queue').cursor; // skip always advances/wraps
      dflags.pirate_started_ms = Date.now();
      dflags.pirate_playing = true;
      break;
    }
    case 'loop': {
      const mode = (args[1] || '').toLowerCase();
      if (!['off', 'item', 'queue'].includes(mode)) return { type: 'error', message: 'Loop mode: off | item | queue.' };
      dflags.pirate_loop = mode;
      break;
    }
    case 'add': {
      const hint = args.slice(1).join(' ').trim().toLowerCase();
      if (!hint) return { type: 'error', message: 'Add what? air add <name>.' };
      const console0 = await buildPirateConsole(deck, player);
      const match = console0.pool.find(p => p.id.toLowerCase() === hint || p.name.toLowerCase().includes(hint));
      if (!match) return { type: 'error', message: `Nothing in your pool matches "${hint}".` };
      q.push(match.id);
      dflags.pirate_queue = q;
      break;
    }
    case 'remove': {
      const n = parseInt(args[1], 10);
      if (!(n >= 1 && n <= q.length)) return { type: 'error', message: `Remove which? 1–${q.length}.` };
      const idx = n - 1;
      q.splice(idx, 1);
      dflags.pirate_queue = q;
      const cur = dflags.pirate_cursor | 0;
      if (idx < cur) dflags.pirate_cursor = cur - 1;
      else if (idx === cur) dflags.pirate_started_ms = Date.now(); // now points at the next item
      break;
    }
    case 'move': {
      const from = parseInt(args[1], 10) - 1, to = parseInt(args[2], 10) - 1;
      if (!(from >= 0 && from < q.length && to >= 0 && to < q.length)) return { type: 'error', message: `Move which? air move <n> <m> (1–${q.length}).` };
      const [it] = q.splice(from, 1);
      q.splice(to, 0, it);
      dflags.pirate_queue = q;
      break;
    }
    case 'crawl': {
      const text = args.slice(1).join(' ').trim();
      dflags.pirate_crawl = (!text || text.toLowerCase() === 'off') ? null : text.slice(0, 200);
      break;
    }
    default:
      return { type: 'error', message: 'air [open|play|stop|skip|loop <mode>|add <name>|remove <n>|move <n> <m>|crawl <text|off>|close]' };
  }

  if (touched) {
    if (dflags.pirate_cursor > Math.max(0, q.length - 1)) dflags.pirate_cursor = Math.max(0, q.length - 1);
    await updateFurniture(deck.id, { flags: JSON.stringify(dflags) });
    _deckCache.delete(deck.zone_id);
    _pirateCache.delete(deck.zone_id);
    deck.flags = dflags; // reflect edits in the console payload below
  }
  return buildPirateConsole(deck, player);
}

async function cmdLoadCassette(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  // Usage: load cassette [<name>]  — lists carried cassettes; loads by name if given
  const { rows: invRows } = await query(
    `SELECT pi.id AS inv_id, i.id AS item_id, i.name, i.flags, i.tags FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id=$1 AND pi.is_equipped=0 AND pi.container_id IS NULL
        AND (jsonb_exists(i.tags,'media_cassette') OR (i.flags->>'media_cassette')='true')
      ORDER BY i.name`,
    [player.id]
  );
  if (!invRows.length) return { type: 'output', message: 'You have no cassette to load.' };

  // Strip the media-format keywords to get an optional name filter, so both
  // `load cassette <show>` and `load chip <zone>` narrow to the right item.
  const FORMAT_WORDS = new Set(['cassette', 'chip', 'datachip', 'footage']);
  const nameFilter = args.filter(a => !FORMAT_WORDS.has(a.toLowerCase())).join(' ').trim().toLowerCase();

  if (invRows.length > 1 && !nameFilter) {
    const lines = invRows.map((r, i) =>
      `  <span class="action-link" data-action="load" data-target="cassette ${r.name}">${i + 1}. ${r.name}</span>`
    ).join('\n');
    return { type: 'output', message: `You have multiple cassettes. Which one?\n${lines}` };
  }

  let cassette = invRows[0];
  if (nameFilter) {
    const match = invRows.find(r => r.name.toLowerCase().includes(nameFilter));
    if (!match) return { type: 'output', message: `You don't have a cassette matching "${nameFilter}".` };
    cassette = match;
  }
  const deck = await _findDeckInZone(player.current_zone);
  if (!deck) return { type: 'output', message: 'There is no media deck here.' };
  const dflags = _deckFlags(deck);
  const lock = _deckLockError(dflags, player);
  if (lock) return lock;
  const broadcastId = cassette.tags?.broadcast_id || cassette.flags?.broadcast_id;
  if (!broadcastId) return { type: 'output', message: 'That cassette has no broadcast loaded.' };

  // A surveillance chip's broadcast is minted lazily — only here, when it's
  // actually loaded into a deck — so unaired chips don't pile hidden broadcasts
  // up in the library. Rebuild it from the clip's frames on demand.
  const clipId = cassette.tags?.clip_id || cassette.flags?.clip_id;
  if (clipId) {
    const { rows: cl } = await query(
      `SELECT c.frames, z.name AS zone_name FROM security_clips c
         LEFT JOIN zones z ON z.id = c.zone_id WHERE c.id=$1`, [clipId]);
    if (!cl.length) return { type: 'output', message: 'That datachip is corrupted — its footage is gone.' };
    const frames = Array.isArray(cl[0].frames) ? cl[0].frames : [];
    await ensureClipBroadcast(broadcastId, `Footage: ${cl[0].zone_name || 'UNKNOWN'}`, frames, 4);
  }

  const cassettes = Array.isArray(dflags.deck_cassettes) ? [...dflags.deck_cassettes] : [];
  if (!cassettes.includes(broadcastId)) cassettes.push(broadcastId);
  dflags.deck_cassettes = cassettes;
  dflags.deck_active = broadcastId;

  // Restore any schedule slots that were saved when this cassette was ejected.
  const channelId = dflags.channel_id || null;
  const ejected = typeof dflags.deck_ejected_slots === 'object' && !Array.isArray(dflags.deck_ejected_slots)
    ? dflags.deck_ejected_slots
    : {};
  const slotsToRestore = ejected[broadcastId] || [];
  if (slotsToRestore.length && channelId) {
    for (const slot of slotsToRestore) {
      await query(
        `INSERT INTO media_channel_playlist (id,channel_id,broadcast_id,start_time,duration_override,priority,conditions,slot_type)
         VALUES ($1,$2,$3,$4,$5,0,$6,$7)
         ON CONFLICT DO NOTHING`,
        [randomUUID(), channelId, broadcastId, slot.start_time, slot.duration_override || null,
         JSON.stringify(slot.conditions || []), slot.slot_type || 'broadcast']
      );
    }
    delete ejected[broadcastId];
    dflags.deck_ejected_slots = ejected;
  }

  // Un-hide the broadcast in the library now that its cassette is back in a deck.
  await query(`UPDATE media_broadcasts SET tags = COALESCE(tags,'{}')::jsonb - 'cassette_ejected' WHERE id=$1`, [broadcastId]);

  await updateFurniture(deck.id, { flags: JSON.stringify(dflags) });
  if (channelId && slotsToRestore.length) await loadChannelRuntimes();
  // Move the cassette item into the deck container rather than destroying it.
  await query('UPDATE player_inventory SET container_id=$1 WHERE id=$2', [deck.id, cassette.inv_id]);
  _deckCache.delete(player.current_zone);
  return { type: 'output', message: `You slide the cassette into the deck. It clunks into place and starts playing.` };
}

function _slugify(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'untitled';
}

// Upsert the canonical cassette item for a broadcast (deterministic id
// item_cassette_<showname>) so the eject path and the dev-panel import path converge on
// one item definition rather than creating duplicates. Only one cassette may exist per
// broadcast — no numbered variants — so a name collision with a *different* broadcast
// throws instead of overwriting. Returns the item id.
async function _ensureCassetteItem(broadcastId, broadcastName) {
  const itemId = `item_cassette_${_slugify(broadcastName)}`;
  const existing = getItem(itemId);
  if (existing) {
    const existingBroadcastId = existing.tags?.broadcast_id;
    if (existingBroadcastId && existingBroadcastId !== broadcastId) {
      const err = new Error(`A cassette named "${broadcastName}" already exists for a different broadcast. Rename the broadcast to create a distinct cassette.`);
      err.code = 'CASSETTE_NAME_COLLISION';
      throw err;
    }
  }
  await query(
    `INSERT INTO items (id, name, description, type, weight, value, tags)
     VALUES ($1,$2,$3,'media',100,0,$4)
     ON CONFLICT (id) DO UPDATE SET name=$2, tags=$4`,
    [itemId, `Cassette: ${broadcastName}`, `A media cassette labeled "${broadcastName}".`,
     JSON.stringify({ media_cassette: true, broadcast_id: broadcastId, unique: true })]
  );
  await reloadItem(itemId);
  return itemId;
}

// Materialize a surveillance clip as a hidden, loop-playing scripted broadcast so
// its datachip doubles as a "mini-cassette": loadable in any media deck and played
// on the zone's TVs. enabled=0 keeps it out of the scheduled library — it only
// airs when someone physically loads the chip. Called from the surveillance
// plugin (physicalizeClip) via dynamic import; idempotent per clip.
export async function ensureClipBroadcast(broadcastId, name, frames, intervalSec = 4) {
  // Each captured frame is a fully-rendered zone line — dialogue (`kind:'say'`,
  // e.g. `Bob says, "…"`) or narrated activity (`kind:'event'` — arrivals, exits,
  // emotes, actions). Preserve that distinction so the reel airs like a broadcast.
  const lines = (frames || [])
    .map(f => (typeof f === 'string'
      ? { text: f, kind: 'event' }
      : { text: f?.text, kind: f?.kind === 'say' ? 'say' : 'event' }))
    .filter(l => l.text);
  if (!lines.length) return;

  // Flat messages kept for back-compat + duration fallback; the graph is what
  // actually airs. Build a linked say-node chain (the same shape the BSM compiler
  // emits) so playback walks it through tickBroadcastGraph exactly like an authored
  // broadcast: dialogue frames use style 'verbatim' — aired as captured AND leaked
  // to bystanders as [TV] speech — while narrated action/arrival frames air as
  // plain lines (no bystander leak, mirroring an npc_action node). holdMs matches
  // message_interval so the graph's measured duration lines up with real pacing
  // (pirate auto-advance, deck loop).
  const messages = lines.map(l => ({ text: l.text }));
  const nodes = { start: { type: 'start', next: lines.length ? 'clip_0' : null } };
  lines.forEach((l, i) => {
    nodes[`clip_${i}`] = {
      type: 'say',
      text: l.text,
      style: l.kind === 'say' ? 'verbatim' : 'raw',
      holdMs: intervalSec * 1000,
      next: i < lines.length - 1 ? `clip_${i + 1}` : null,
    };
  });
  const graph = { _start: 'start', nodes };

  await query(
    `INSERT INTO media_broadcasts (id, name, description, category, playback_mode, messages, message_interval, broadcast_graph, loop, enabled)
     VALUES ($1,$2,$3,'surveillance','scripted',$4::jsonb,$5,$6::jsonb,1,0)
     ON CONFLICT (id) DO UPDATE SET name=$2, messages=$4::jsonb, message_interval=$5, broadcast_graph=$6::jsonb`,
    [broadcastId, name, 'Recovered surveillance footage.', JSON.stringify(messages), intervalSec, JSON.stringify(graph)]
  );
}

async function cmdEjectCassette(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const deck = await _findDeckInZone(player.current_zone);
  if (!deck) return { type: 'output', message: 'There is no media deck here.' };
  const dflags = _deckFlags(deck);
  const lock = _deckLockError(dflags, player);
  if (lock) return lock;
  if (!dflags.deck_active) return { type: 'output', message: 'The deck is empty.' };
  const broadcastId = dflags.deck_active;

  // Pop the cassette back into the player's hands — find it in the deck container first.
  const { rows: bcNameRows } = await query('SELECT name FROM media_broadcasts WHERE id=$1', [broadcastId]);
  const broadcastName = bcNameRows[0]?.name || 'Untitled';
  const itemId = `item_cassette_${_slugify(broadcastName)}`;

  const { rows: deckInv } = await query(
    `SELECT pi.id FROM player_inventory pi WHERE pi.container_id=$1 AND pi.item_id=$2 LIMIT 1`,
    [deck.id, itemId]
  );
  if (deckInv.length) {
    // Move existing cassette item from deck container back to player inventory.
    await query('UPDATE player_inventory SET container_id=NULL, player_id=$1, is_equipped=0 WHERE id=$2', [player.id, deckInv[0].id]);
  } else {
    // Fallback for decks loaded before the container migration: create a fresh item.
    try {
      await _ensureCassetteItem(broadcastId, broadcastName);
    } catch (err) {
      if (err.code === 'CASSETTE_NAME_COLLISION') return { type: 'error', message: err.message };
      throw err;
    }
    const { rows: existingInv } = await query(
      `SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 LIMIT 1`,
      [player.id, itemId]
    );
    if (!existingInv.length) {
      await query('INSERT INTO player_inventory (id, player_id, item_id, quantity) VALUES ($1,$2,$3,1)',
        [randomUUID(), player.id, itemId]);
    }
  }

  // Mark the broadcast as cassette-ejected so it disappears from the library until reloaded.
  await query(`UPDATE media_broadcasts SET tags = COALESCE(tags,'{}')::jsonb || '{"cassette_ejected":true}' WHERE id=$1`, [broadcastId]);

  // Pull every occurrence of this broadcast from the channel's schedule and remember the slots
  // so they can be restored if the cassette is reloaded.
  const channelId = dflags.channel_id || null;
  if (channelId) {
    const { rows: plRows } = await query(
      `SELECT start_time, duration_override, conditions, slot_type FROM media_channel_playlist
        WHERE channel_id=$1 AND broadcast_id=$2`,
      [channelId, broadcastId]
    );
    if (plRows.length) {
      const ejected = typeof dflags.deck_ejected_slots === 'object' && !Array.isArray(dflags.deck_ejected_slots)
        ? { ...dflags.deck_ejected_slots }
        : {};
      ejected[broadcastId] = plRows.map(r => ({
        start_time:        r.start_time,
        duration_override: r.duration_override,
        conditions:        typeof r.conditions === 'string' ? JSON.parse(r.conditions) : (r.conditions || []),
        slot_type:         r.slot_type || 'broadcast',
      }));
      dflags.deck_ejected_slots = ejected;
      await query('DELETE FROM media_channel_playlist WHERE channel_id=$1 AND broadcast_id=$2', [channelId, broadcastId]);
    }
  }

  // Remove it from the deck's library entirely — the program stops, the deck goes idle.
  dflags.deck_cassettes = (Array.isArray(dflags.deck_cassettes) ? dflags.deck_cassettes : [])
    .filter(id => id !== broadcastId);
  dflags.deck_active = null;
  await updateFurniture(deck.id, { flags: JSON.stringify(dflags) });
  if (channelId) await loadChannelRuntimes();
  _deckCache.delete(player.current_zone);
  return { type: 'output', message: `You eject the cassette. The screen dissolves into static.` };
}

// Select a cassette already in the deck's library (no need to carry it again).
async function cmdSelectCassette(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const broadcastId = args[0];
  if (!broadcastId) return { type: 'error', message: 'Select which cassette? Use the deck panel or "select <id>".' };
  const deck = await _findDeckInZone(player.current_zone);
  if (!deck) return { type: 'output', message: 'There is no media deck here.' };
  const dflags = _deckFlags(deck);
  const lock = _deckLockError(dflags, player);
  if (lock) return lock;
  const cassettes = Array.isArray(dflags.deck_cassettes) ? dflags.deck_cassettes : [];
  if (!cassettes.includes(broadcastId)) return { type: 'output', message: 'That cassette is not in this deck.' };
  dflags.deck_active = broadcastId;
  await updateFurniture(deck.id, { flags: JSON.stringify(dflags) });
  return buildMediaDeckPanel(deck.id, player);
}

// ── Media Deck panel (client overlay) ─────────────────────────────────────────

function _deckLightState(channelType, deckActive) {
  if (channelType === 'live') return 'green';
  if (deckActive || channelType) return 'orange'; // scripted/news channel or tape inserted
  return 'red';
}

async function buildMediaDeckPanel(deckId, player) {
  const { rows } = await query('SELECT * FROM furniture WHERE id=$1', [deckId]);
  if (!rows.length) return { type: 'error', message: 'Deck not found.' };
  const deck = rows[0];
  const dflags = _deckFlags(deck);
  const channelId = dflags.channel_id || null;
  const state = channelId ? channelRuntime.get(channelId) : null;

  const cassetteIds = Array.isArray(dflags.deck_cassettes) ? dflags.deck_cassettes : [];
  let cassettes = [];
  if (cassetteIds.length) {
    const { rows: bcRows } = await query(
      `SELECT id, name, category FROM media_broadcasts WHERE id = ANY($1)`,
      [cassetteIds]
    );
    cassettes = cassetteIds
      .map(id => bcRows.find(b => b.id === id))
      .filter(Boolean)
      // A surveillance clip loaded as a cassette is a MicroReel — a compact tape
      // that seats inside a full shell. The client renders it as a nested
      // mini-cassette. Flagged by the clip broadcast id/category, not the name.
      .map(b => ({ ...b, mini: String(b.id).startsWith('bc_clip_') || b.category === 'surveillance' }));
    // Prune dangling cassette ids whose broadcast was deleted, so stale
    // raw ids (e.g. "bc_1234567890") don't linger in the deck's library.
    if (cassettes.length !== cassetteIds.length) {
      dflags.deck_cassettes = cassettes.map(c => c.id);
      if (dflags.deck_active && !dflags.deck_cassettes.includes(dflags.deck_active)) dflags.deck_active = null;
      await updateFurniture(deck.id, { flags: JSON.stringify(dflags) });
    }
  }

  // Read-only schedule preview — today's playlist slots for the linked channel.
  let schedule = [];
  if (channelId) {
    const { rows: plRows } = await query(
      `SELECT p.start_time, p.duration_override, b.name AS broadcast_name
         FROM media_channel_playlist p LEFT JOIN media_broadcasts b ON b.id = p.broadcast_id
        WHERE p.channel_id=$1 ORDER BY p.start_time`,
      [channelId]
    );
    schedule = plRows.map(r => ({
      startTime: r.start_time,
      name: r.broadcast_name || '(untitled)',
    }));
  }

  let channelType = state?.channelType ?? null;
  if (!channelType && channelId) {
    const { rows: chTypeRows } = await query('SELECT channel_type FROM media_channels WHERE id=$1 AND enabled=1', [channelId]);
    channelType = chTypeRows[0]?.channel_type ?? null;
  }
  const lightState = _deckLightState(channelType, dflags.deck_active);

  const { rows: invRows } = await query(
    `SELECT i.name FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id=$1 AND pi.is_equipped=0 AND pi.container_id IS NULL
        AND (jsonb_exists(i.tags,'media_cassette') OR (i.flags->>'media_cassette')='true')
      ORDER BY i.name`,
    [player.id]
  );

  sendToPlayer(player.id, {
    type: 'mediadeck_panel',
    deckId: deck.id,
    deckName: deck.name,
    channelId,
    channelName: state?.name || null,
    channelNumber: state?.number ?? null,
    channelType,
    lightState,
    activeCassetteId: dflags.deck_active || null,
    cassettes,
    schedule,
    inventoryCassettes: invRows.map(r => ({ name: r.name })),
    isAdminOrDev: player.role === 'admin' || player.role === 'dev',
  });
  return { type: 'output', message: `You examine the ${deck.name}.` };
}

async function doUseMediaDeck(args, raw, player) {
  if (!player) return undefined;
  const nameHint = args.join(' ').toLowerCase();
  const zoneDecks = getZoneFurniture(player.current_zone).filter(f => f.flags && 'media_deck' in f.flags);
  const deck = nameHint ? zoneDecks.find(f => f.name?.toLowerCase().includes(nameHint)) : zoneDecks[0];
  if (!deck) return undefined;
  const dflags = _deckFlags(deck);
  const lock = _deckLockError(dflags, player);
  if (lock) return lock;
  // The captor gets the pirate console; an admin/dev gets the legacy management panel.
  if (dflags.pirate_owner === player.id) return buildPirateConsole({ ...deck, zone_id: player.current_zone }, player);
  return buildMediaDeckPanel(deck.id, player);
}

// ── Media Deck schedule-sync tick ─────────────────────────────────────────────
// Keeps a deck's active cassette aligned with the channel's current playlist
// slot, when that slot's broadcast is already in the deck's library. A deck
// with no matching cassette in its library is left alone (no auto-load of
// untouched/never-inserted tapes).
async function mediaDeckSyncTick() {
  // Decks come from the write-funneled world.furniture Map. This was a
  // `flags::text LIKE '%"media_deck"%'` full-table scan (casting every row's
  // JSONB to text, unindexable) every 30s. Key-presence match, exactly as the
  // LIKE tested — `media_deck` is only ever written `true`, so the two agree.
  // NOTE this tick stays periodic on purpose: it aligns a deck to whichever
  // playlist slot the GAME CLOCK has reached, and no edit event fires when time
  // rolls from one slot into the next. There is nothing to event-drive it off.
  const decks = [...world.furniture.values()].filter(f => f.flags && 'media_deck' in f.flags);
  if (!decks.length) return;
  const { minutes } = getEnvironmentState();
  const gameSecondsSinceMidnight = minutes * 60;

  // Every eligible deck's channel playlist in one query (this was a per-deck
  // round trip), grouped by channel — decks often share a channel.
  const deckStates = decks.map(deck => ({ deck, dflags: _deckFlags(deck) }));
  const channelIds = [...new Set(deckStates
    .filter(({ dflags }) => dflags.channel_id && Array.isArray(dflags.deck_cassettes) && dflags.deck_cassettes.length && !dflags.pirate_owner)
    .map(({ dflags }) => dflags.channel_id))];
  if (!channelIds.length) return;
  const { rows: allPlRows } = await query(
    `SELECT channel_id, broadcast_id, start_time, COALESCE(duration_override, 300) AS duration
       FROM media_channel_playlist WHERE channel_id = ANY($1) ORDER BY start_time`,
    [channelIds]
  );
  const playlistByChannel = new Map();
  for (const r of allPlRows) {
    if (!playlistByChannel.has(r.channel_id)) playlistByChannel.set(r.channel_id, []);
    playlistByChannel.get(r.channel_id).push(r);
  }

  for (const { deck, dflags } of deckStates) {
    const channelId = dflags.channel_id;
    const cassettes = Array.isArray(dflags.deck_cassettes) ? dflags.deck_cassettes : [];
    if (!channelId || !cassettes.length) continue;
    if (dflags.pirate_owner) continue; // a pirated deck answers only to its captor — don't auto-align it to the schedule

    const plRows = playlistByChannel.get(channelId) || [];
    const slot = plRows.find(p => gameSecondsSinceMidnight >= p.start_time && gameSecondsSinceMidnight < p.start_time + p.duration);
    if (!slot?.broadcast_id) continue;
    if (!cassettes.includes(slot.broadcast_id)) continue;
    if (dflags.deck_active === slot.broadcast_id) continue;

    dflags.deck_active = slot.broadcast_id;
    await updateFurniture(deck.id, { flags: JSON.stringify(dflags) }).catch(() => {});
  }
}

schedule('30s', () => mediaDeckSyncTick().catch(e => console.error('[broadcast] media deck sync error:', e.message)));

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdTune(args, raw, player, broadcast) {
  if (!player) return { type: 'error', message: 'No character.' };
  const channelNumber = parseInt(args[0], 10);
  if (isNaN(channelNumber)) return { type: 'output', message: 'Usage: tune <channel number> (or 0 to turn off)' };

  // Find a broadcast_receiver furniture in the player's current zone
  const { rows } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND flags::text LIKE '%broadcast_receiver%' LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return { type: 'output', message: 'There is no broadcast-capable device here.' };
  const device = rows[0];

  const result = await _applyTuning(device, channelNumber, player.current_zone);
  if (result.status === 'off') {
    sendToPlayer(player.id, { type: 'tv_off' });
    return { type: 'output', message: 'Device turned off.' };
  }
  if (result.status === 'not_found') return { type: 'output', message: `Channel ${channelNumber} not found.` };

  buildTvPanel(result.channel.id, player, channelNumber);
  return null; // silent — the TV panel itself reflects the new channel
}

function _furnitureEntryForZoneChannel(zoneId, channelId) {
  for (const entry of furnitureChannelIndex.values()) {
    if (entry.zoneId === zoneId && entry.channelId === channelId) return entry;
  }
  return null;
}

// The chassis skin of the (first) TV device in a zone, from its `tv_skin` flag.
// Falls back to 'crt' (the base chassis) for untuned/unknown sets.
function _tvSkinForZone(zoneId) {
  for (const entry of furnitureChannelIndex.values()) {
    if (entry.zoneId === zoneId && entry.deviceType === 'tv') return entry.skin || 'crt';
  }
  return 'crt';
}

// `dest` picks the client surface: undefined/'panel' opens the standalone CRT set,
// 'tablet' feeds the Tablet TV app's viewport. A tablet has no furniture backing it,
// so dial/skin fall back to sane defaults instead of a zone device lookup.
function buildTvPanel(channelId, player, dialFrequency, dest) {
  const state = channelRuntime.get(channelId);
  if (!state) return null;
  const isTablet = dest === 'tablet';
  const channelList = [...channelRuntime.values()]
    .filter(s => s.number != null)
    .sort((a, b) => a.number - b.number)
    .map(s => ({ number: s.number, name: s.name, channelId: s.channelId }));
  // Resolve dialFrequency + chassis skin from the zone's TV device if not passed directly
  const fEntry = isTablet ? null : _furnitureEntryForZoneChannel(player.current_zone, channelId);
  if (dialFrequency === undefined) dialFrequency = fEntry?.dialFrequency ?? 0;
  sendToPlayer(player.id, {
    type: 'tv_panel',
    ...(isTablet ? { dest: 'tablet' } : {}),
    channelId,
    channelName: state.name || channelId,
    stationName: state.stationName || state.name || channelId,
    channelNumber: state.number ?? 0,
    dialFrequency,
    skin: isTablet ? 'tablet' : (fEntry?.skin || _tvSkinForZone(player.current_zone)),
    channelType: state.channelType || 'playlist',
    theme: state.theme || null,
    channelList,
    sounds: {
      hum:      getAmbientDefByName('amb_tv_hum'),
      static:   getAmbientDefByName('amb_tv_static'),
      powerOn:  getSfxDefByName('tv_power_on'),
      powerOff: getSfxDefByName('tv_power_off'),
    },
  });
  // If the channel is currently off-air, signal it immediately rather than waiting for the next tick
  if (!state.wasActive) {
    sendToPlayer(player.id, _offAirMessage(state, channelId));
  }
  return { type: 'output', message: 'You turn to the television.' };
}

// `tablettune <n>` — the Tablet TV app's dial. Unlike `tune`, it resolves the channel
// straight out of the in-memory runtime with no furniture lookup, because the tablet
// is its own receiver. `0` powers the app's screen down (drops the tuner registration).
async function cmdTabletTune(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const channelNumber = parseInt(args[0], 10);
  if (isNaN(channelNumber)) return { type: 'output', message: 'Usage: tablettune <channel number>' };

  if (channelNumber === 0) {
    // Just drop the tuner. Deliberately NO `tv_off` push: that message is the ROOM
    // set's power-off and the client routes it to the standalone CRT panel, so
    // sending it here would switch off the wall television because you turned your
    // tablet's screen down. The tablet's own power button closes its view locally.
    tabletTuners.delete(player.id);
    return null;
  }

  const state = [...channelRuntime.values()].find(s => s.number === channelNumber);
  if (!state) return null;   // silent — the dial sweeps across dead frequencies

  tabletTuners.set(player.id, state.channelId);
  buildTvPanel(state.channelId, player, channelNumber, 'tablet');
  return null; // silent — the tablet's TV viewport reflects the new channel
}

// The channel dial listing, for the Tablet TV app's screen. In-memory only — never
// a DB read (this is called on every tablet nav).
export function getTvChannelList() {
  return [...channelRuntime.values()]
    .filter(s => s.number != null)
    .sort((a, b) => a.number - b.number)
    .map(s => ({ number: s.number, name: s.stationName || s.name, channelId: s.channelId }));
}

export function getTabletTunedChannel(playerId) {
  return tabletTuners.get(playerId) || null;
}

function buildTvOffPanel(player, skin) {
  const channelList = [...channelRuntime.values()]
    .filter(s => s.number != null)
    .sort((a, b) => a.number - b.number)
    .map(s => ({ number: s.number, name: s.name, channelId: s.channelId }));
  sendToPlayer(player.id, {
    type: 'tv_panel',
    channelId: null,
    channelNumber: 0,
    channelName: '',
    stationName: '',
    channelType: null,
    theme: null,
    skin: skin || _tvSkinForZone(player.current_zone),
    channelList,
  });
  return { type: 'output', message: 'You turn to the television.' };
}

// The words a player uses for "the set" rather than for a specific piece of
// furniture. `use tv` / `watch the telly` must find a set named "battered
// television" or "wall screen", so these never become a name filter.
const TV_WORDS = new Set(['tv', 'tvs', 'television', 'televisions', 'set', 'monitor', 'screen', 'tele', 'telly', 'box']);

// Strip the article/preposition noise a clickable link or a natural phrasing
// carries ("watch on wall screen", "use the tv") and drop a purely generic
// noun so it doesn't get used as a name filter.
function _tvNameHint(args) {
  const words = (args || [])
    .map(w => String(w).toLowerCase())
    .filter(w => !['on', 'at', 'the', 'a', 'an', 'my'].includes(w));
  if (!words.length) return '';
  if (words.every(w => TV_WORDS.has(w))) return '';
  return words.join(' ');
}

// Any furniture in the zone that is a television: the `broadcast_receiver` flag
// (what the tuner actually keys off), the `tv` tag (what the action registry
// gates on), or simply something named like a set. Kept in one place so the
// `tv`, `watch` and `use` paths can never disagree about what counts.
const TV_FURNITURE_SQL = `(flags::text LIKE '%broadcast_receiver%' OR flags::text LIKE '%"tv"%' OR name ILIKE '%television%')`;

async function _findTvFurniture(zoneId, nameHint) {
  const { rows } = await query(
    `SELECT id, name, flags FROM furniture WHERE zone_id=$1 AND ${TV_FURNITURE_SQL}${nameHint ? ' AND name ILIKE $2' : ''} LIMIT 1`,
    nameHint ? [zoneId, `%${nameHint}%`] : [zoneId]
  );
  return rows[0] || null;
}

// Specialized action: use <tv-furniture>
async function doUseTv(args, raw, player) {
  if (!player) return undefined;
  const nameHint = _tvNameHint(args);

  const row = await _findTvFurniture(player.current_zone, nameHint);
  const rows = row ? [row] : [];
  if (!rows.length) return undefined;

  // If this set is already tuned (emitting the ambient noise the room overhears),
  // open the console straight onto that channel rather than dark — same as `tv`.
  const entry = furnitureChannelIndex.get(rows[0].id);
  if (entry?.channelId && channelRuntime.has(entry.channelId)) {
    return buildTvPanel(entry.channelId, player);
  }

  const flags = typeof rows[0].flags === 'object' ? rows[0].flags : JSON.parse(rows[0].flags || '{}');
  return buildTvOffPanel(player, flags.tv_skin || 'crt');
}

async function cmdTv(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const zoneMap = zoneTunings.get(player.current_zone);

  // A tuned TV in the zone is already emitting a broadcast (the ambient noise the
  // room overhears) — open the set straight onto that channel rather than dark.
  if (zoneMap) {
    for (const [channelId, deviceType] of zoneMap) {
      if (deviceType !== 'tv') continue;
      if (channelRuntime.has(channelId)) return buildTvPanel(channelId, player);
    }
  }

  // No tuned TV — check for any TV furniture in the zone (TV exists but is off).
  const row = await _findTvFurniture(player.current_zone, '');
  if (row) {
    const flags = typeof row.flags === 'object' ? row.flags : JSON.parse(row.flags || '{}');
    return buildTvOffPanel(player, flags.tv_skin || 'crt');
  }
  return { type: 'output', message: 'There is no television here.' };
}

async function cmdWatch(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };

  // `watch`, `watch tv`, `watch on the wall screen` — anything that names (or
  // implies) a television in the room opens that set, exactly like `use` does.
  // Only when nothing here is a television do we fall back to the read-out of
  // whatever broadcast devices (a radio, say) the zone has running.
  const panel = await doUseTv(args, raw, player);
  if (panel !== undefined) return panel;
  if (TV_WORDS.has((args[0] || '').toLowerCase())) return cmdTv([], raw, player);

  return _broadcastListing(player);
}

// The zone's running broadcast devices and what each is currently carrying.
async function _broadcastListing(player) {
  const zoneMap = zoneTunings.get(player.current_zone);
  if (!zoneMap || !zoneMap.size) return { type: 'output', message: 'No active broadcast device in this area.' };

  const lines = [];
  for (const [channelId, deviceType] of zoneMap) {
    const state = channelRuntime.get(channelId);
    if (!state) continue;
    const result = await getCurrentMessage(state, Date.now()).catch(() => null);
    const zone = getZone(player.current_zone);
    const formatted = result ? formatMessage(result.text, deviceType, zone) : '(no signal)';
    lines.push(`Channel ${state.number}: ${formatted}`);
  }
  return { type: 'output', message: lines.length ? lines.join('\n') : 'No active broadcasts right now.' };
}

// Internal command — client sends this when TV panel closes to persist the float dial position
async function cmdTvFreq(args, raw, player) {
  if (!player) return null;
  const freq = parseFloat(args[0]);
  if (!isFinite(freq) || freq < 0) return null;
  const { rows } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND flags::text LIKE '%broadcast_receiver%' LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return null;
  const device = rows[0];
  const flags = typeof device.flags === 'object' ? { ...device.flags } : JSON.parse(device.flags || '{}');
  flags.tv_dial_freq = freq;
  await updateFurniture(device.id, { flags: JSON.stringify(flags) });
  const entry = furnitureChannelIndex.get(device.id);
  if (entry) entry.dialFrequency = freq;
  return null; // silent — no output to player
}

async function cmdRestartBroadcast(args, raw, player) {
  if (!player || (player.role !== 'admin' && player.role !== 'dev')) {
    return { type: 'error', message: 'Access denied.' };
  }
  const deck = await _findDeckInZone(player.current_zone);
  if (!deck) return { type: 'error', message: 'No media deck in this zone.' };
  const dflags = typeof deck.flags === 'object' ? deck.flags : JSON.parse(deck.flags || '{}');
  const channelId = dflags.channel_id || null;
  if (!channelId) return { type: 'error', message: 'Deck is not linked to a channel.' };
  const ok = restartChannelBroadcast(channelId);
  return ok
    ? { type: 'output', message: 'Broadcast restarted from the top.' }
    : { type: 'error', message: 'Channel not found in runtime.' };
}

// Read-only peek at what a zone's TV is currently showing, for other plugins
// (e.g. the bartender reacting to the set). Returns null when no TV in the zone
// is tuned/on — a zone only appears in zoneTunings while a set is powered — so a
// caller naturally stays quiet about a dark screen. Non-destructive: it reads the
// program name the real broadcastTick already computed (never pops the news queue).
export function getZoneNowPlaying(zoneId) {
  const tunings = zoneTunings.get(zoneId);
  if (!tunings || tunings.size === 0) return null;
  let channelId = null;
  for (const [cid, deviceType] of tunings) { if (deviceType === 'tv') { channelId = cid; break; } }
  if (!channelId) channelId = [...tunings.keys()][0];
  const state = channelRuntime.get(channelId);
  if (!state) return null;
  return {
    channelId,
    channelName: state.name || state.stationName || null,
    stationName: state.stationName || null,
    number: state.number ?? null,
    channelType: state.channelType || null,
    program: state.currentProgramName || null,
  };
}

// ── Emergency broadcast verbs (the Echelon's special MediaDeck) ────────────────
async function cmdAirEmergency(args, raw, player, broadcast) {
  if (!_isDeckAdmin(player)) return { type: 'error', message: 'Only station administrators can seize the airwaves.' };
  const { rows } = await query(
    `SELECT flags FROM furniture WHERE zone_id=$1 AND flags::text LIKE '%"emergency_deck"%' LIMIT 1`,
    [player.current_zone]
  ).catch(() => ({ rows: [] }));
  if (!rows[0]) return { type: 'error', message: 'There is no emergency broadcast deck here. This can only be done from the Echelon.' };
  const dflags = typeof rows[0].flags === 'object' ? rows[0].flags : JSON.parse(rows[0].flags || '{}');
  const broadcastId = args?.[0] || dflags.deck_active || dflags.emergency_broadcast_id;
  if (!broadcastId) return { type: 'error', message: 'Load an emergency bulletin into the deck first, or name one: airemergency <broadcast id>.' };
  const r = await startEmergency(broadcastId);
  if (!r.ok) return { type: 'error', message: `Cannot go to air: ${r.error}.` };
  broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} throws the EMERGENCY BROADCAST switch. The ON AIR lamp floods the room red.` }, player.id);
  return { type: 'system', message: '⚠ EMERGENCY BROADCAST ENGAGED. Every tuned television in Architect now carries your feed. Type ENDEMERGENCY to release the airwaves.' };
}

function cmdEndEmergency(args, raw, player, broadcast) {
  if (!_isDeckAdmin(player)) return { type: 'error', message: 'Only station administrators can release the airwaves.' };
  const r = stopEmergency();
  if (!r.wasActive) return { type: 'system', message: 'No emergency broadcast is currently on air.' };
  broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} cuts the emergency feed. The ON AIR lamp dies.` }, player.id);
  return { type: 'system', message: 'Emergency broadcast ended. Normal programming resumes across the city.' };
}

export const commands = {
  tune:  cmdTune,
  watch: cmdWatch,
  // `listen` is SHARED, the same way `cook` is shared with synthesis: in a room
  // with a radio or a screen it means "what's on", and everywhere else — which
  // is most of the world — it means the sense. Broadcast owns the verb because
  // plugins beat engine builtins, so the fallthrough has to live here; the
  // engine's own `listen` entry would never be reached otherwise.
  //
  // `watch` deliberately does NOT fall through. Watching is a visual act and
  // belongs to the screen; only listening has a second, older meaning.
  listen: async (args, raw, player) => {
    // Listening never opens a screen — it reads out what the room's devices are
    // carrying, and falls through to the sense when nothing is on the air.
    if (!player) return { type: 'error', message: 'No character.' };
    const r = await _broadcastListing(player);
    if (r?.message === 'No active broadcast device in this area.') return cmdListen(args, raw, player);
    return r;
  },
  tv:    cmdTv,
  airemergency: cmdAirEmergency,
  endemergency: cmdEndEmergency,
  load:  (args, raw, player) => {
    // A surveillance chip is a mini-cassette (media_cassette tag + a hidden
    // scripted broadcast of its footage), so `load chip`/`load footage …` plays a
    // clip on the zone's TVs the same way `load cassette …` plays a show.
    const r = raw.toLowerCase();
    if (r.includes('cassette') || r.includes('chip') || r.includes('footage')) return cmdLoadCassette(args, raw, player);
    return null; // pass to next handler
  },
  eject: cmdEjectCassette,
  selectcassette: cmdSelectCassette,
  pirate: cmdPirate,
  pirateresolve: cmdPirateResolve,
  air: cmdAir,
  tablettune: cmdTabletTune,
};

export const specializedActions = [
  // Gated on EITHER marker: `tv` is the authored tag, `broadcast_receiver` is the
  // flag the tuner keys off. A set carrying only one of them still advertises
  // `use` on examine, and the handler itself accepts both plus a set that's
  // simply named like a television.
  { verb: 'use', requiredTag: 'tv', requiredFlag: 'broadcast_receiver', handler: doUseTv },
  // Declaration-only: `watch` stays the plugin's own command, but the row makes
  // it visible as an affordance on every television.
  { verb: 'watch', requiredTag: 'tv', requiredFlag: 'broadcast_receiver', handler: null },
  { verb: 'use', requiredTag: 'media_deck', handler: doUseMediaDeck },
  { verb: 'use', requiredTag: 'piracy_firmware', handler: doInstallPiracyFirmware },
];

// Test seam (never loaded in production) — the pure piracy gate helpers, so the
// regress suite can assert the deck-lock logic without a live furniture row.
export const _piracyTest = { canOperateDeck, deckLockError: _deckLockError, nextCursor: _nextCursor, engineerDueAt: _engineerDueAt };

// Test seam (never loaded in production) — the deterministic league engine, so the
// regress suite can assert same-slot reproducibility and the round-robin schedule.
export const _test = {
  // Lets the regress suite drive a tick by hand and assert what actually reached a
  // player — the Tablet TV's portable tuner has no zone furniture, so "did a program
  // come out the other end" is only observable this way.
  broadcastTick, tabletTuners,
  sportsGameForSlot, sportsMatchupForSlot, roundRobinRounds, sportsSlotIndex,
  sportsSlotMs, sportsAiring, SPORTS_GAMES_PER_DAY, nextAirSlot,
  assembleNewsGraph, newsFill, newsSceneNames,
  assembleTalkshowGraph, talkshowAiring, talkshowPersonaFor, talkshowFill, makeTalkshowGuestGraph, ensureTalkshowSlot,
  talkshowDraw, splitTurns, topicPick, TALKSHOW_GUEST_CALL_LEAD,
  assembleMorningGraph, morningRunInKey,
  assembleGameshowGraph, gameshowAiring, gameshowDayBucket, gameshowPool, gameshowOpenRound,
  gameshowResolveRound, gameshowTokens, parseGuess, scorePrice, scoreOverUnder, scoreLot,
  scoreShowcase, gameshowTest: _gameshowTest, normalizeGraph: _normalizeBroadcastGraph,
  subTokens: _subTokens, scriptedTokens: _scriptedTokens, untilFour: _untilFour, otherViewers: _otherViewers,
  garbleLine: _garbleLine, actorImpairment: _actorImpairment,
  cameraLabel: _cameraLabel, pickCamera: _pickCamera, anyCastPresent: _anyCastPresent, zoneCameras,
  seekGraph: _seekGraph, nodeHoldMs, broadcastDuration, filmBlocksNeeded, filmRunElapsed,
  channelRuntime, recordBeat: _recordBeat, sendCatchUp,
  pickDailySlot: _pickDailySlot, filmDayMask,
  assembleSermonGraph, getSermonGraph,
  fillCommercialTail: _fillCommercialTail,
  adDurationSec: _adDurationSec, adAt: _adAt, graphDurationSec: _graphDurationSec,
  normalizeBroadcastGraph: _normalizeBroadcastGraph, CARD_MIN_HOLD_MS,
  pickDailySlot: _pickDailySlot, dayMask: _dayMask, dayLabel: _dayLabel, slotAirsOn: _slotAirsOn,
};

// ── Route handler (CRUD) ─────────────────────────────────────────────────────

export const routeHandler = async (path, method, body, auth) => {
  if (!path.startsWith('/broadcast')) return null;
  if (method !== 'GET' && !devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };

  const parts = path.split('/').filter(Boolean); // ['broadcast', resource, id?, sub?]
  const resource = parts[1];
  const id = parts[2];
  const sub = parts[3];

  try {
    // ── Broadcasts ──────────────────────────────────────────────────────────
    if (resource === 'broadcasts') {
      if (!id && method === 'GET') {
        const { rows } = await query(`SELECT * FROM media_broadcasts WHERE (tags->>'cassette_ejected') IS DISTINCT FROM 'true' ORDER BY name`);
        return { status: 200, body: rows };
      }
      if (!id && method === 'POST') {
        const bid = body.id || `bc_${Date.now()}`;
        const graph = body.broadcast_graph ? JSON.stringify(body.broadcast_graph) : null;
        const wxPools = body.weather_pools ? JSON.stringify(body.weather_pools) : null;
        const spPools = body.sports_pools ? JSON.stringify(body.sports_pools) : null;
        const nwPools = body.news_pools ? JSON.stringify(body.news_pools) : null;
        const tsPools = body.talkshow_pools ? JSON.stringify(body.talkshow_pools) : null;
        const mnPools = body.morning_pools ? JSON.stringify(body.morning_pools) : null;
        const gsPools = body.gameshow_pools ? JSON.stringify(body.gameshow_pools) : null;
        const fmMeta = body.film_meta ? JSON.stringify(body.film_meta) : null;
        const smPools = body.sermon_pools ? JSON.stringify(body.sermon_pools) : null;
        await query(
          `INSERT INTO media_broadcasts (id,name,description,category,tags,playback_mode,messages,message_interval,override_duration,loop,enabled,created_by,updated_at,broadcast_graph,channel_id,fallback_messages,weather_pools,sports_pools,news_pools,talkshow_pools,morning_pools,gameshow_pools,film_meta,sermon_pools)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,EXTRACT(EPOCH FROM NOW()),$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
          [bid, body.name || 'Untitled', body.description || '', body.category || 'general',
           JSON.stringify(body.tags || []), body.playback_mode || 'scripted',
           JSON.stringify(body.messages || []), body.message_interval || 5,
           body.override_duration || null, body.loop ? 1 : 0, body.enabled !== false ? 1 : 0,
           auth?.playerId || 'unknown', graph, body.channel_id || null,
           JSON.stringify(body.fallback_messages || []), wxPools, spPools, nwPools, tsPools, mnPools, gsPools, fmMeta, smPools]
        );
        if (body.playback_mode === 'talkshow' && body.channel_id) await ensureTalkshowSlot(bid, body.channel_id, tsPools);
        // Same @airtime pinning path — a game show owns its block just like a talk show.
        if (body.playback_mode === 'gameshow' && body.channel_id) await ensureTalkshowSlot(bid, body.channel_id, gsPools);
        // A film screens at a fixed hour for the same reason, but through its own door:
        // the pinned block is what gives the picture a start time to be late for, and a
        // feature needs a RUN of them rather than a talk show's single block.
        if (body.playback_mode === 'film' && body.channel_id) await ensureFilmSlots(bid, body.channel_id, fmMeta);
        // A sermon pins like a talk show — one block — but weekly, via airDays.
        if (body.playback_mode === 'sermon' && body.channel_id) await ensureTalkshowSlot(bid, body.channel_id, smPools);
        await loadChannelRuntimes();
        return { status: 201, body: { id: bid } };
      }
      if (id && method === 'PUT') {
        const graph = body.broadcast_graph ? JSON.stringify(body.broadcast_graph) : null;
        const wxPools = body.weather_pools ? JSON.stringify(body.weather_pools) : null;
        const spPools = body.sports_pools ? JSON.stringify(body.sports_pools) : null;
        const nwPools = body.news_pools ? JSON.stringify(body.news_pools) : null;
        const tsPools = body.talkshow_pools ? JSON.stringify(body.talkshow_pools) : null;
        const mnPools = body.morning_pools ? JSON.stringify(body.morning_pools) : null;
        const gsPools = body.gameshow_pools ? JSON.stringify(body.gameshow_pools) : null;
        const fmMeta = body.film_meta ? JSON.stringify(body.film_meta) : null;
        const smPools = body.sermon_pools ? JSON.stringify(body.sermon_pools) : null;
        await query(
          `UPDATE media_broadcasts SET name=$1,description=$2,category=$3,tags=$4,playback_mode=$5,
           messages=$6,message_interval=$7,override_duration=$8,loop=$9,enabled=$10,broadcast_graph=$11,
           channel_id=$12,fallback_messages=$13,weather_pools=$14,sports_pools=$15,news_pools=$16,talkshow_pools=$17,morning_pools=$19,gameshow_pools=$20,film_meta=$21,sermon_pools=$22,updated_at=EXTRACT(EPOCH FROM NOW()) WHERE id=$18`,
          [body.name||'Untitled', body.description||'', body.category||'general',
           JSON.stringify(body.tags||[]), body.playback_mode||'scripted',
           JSON.stringify(body.messages||[]), body.message_interval||5,
           body.override_duration||null, body.loop?1:0, body.enabled!==false?1:0, graph,
           body.channel_id||null, JSON.stringify(body.fallback_messages||[]), wxPools, spPools, nwPools, tsPools, id, mnPools, gsPools, fmMeta, smPools]
        );
        if (body.playback_mode === 'talkshow' && body.channel_id) await ensureTalkshowSlot(id, body.channel_id, tsPools);
        if (body.playback_mode === 'gameshow' && body.channel_id) await ensureTalkshowSlot(id, body.channel_id, gsPools);
        if (body.playback_mode === 'film'     && body.channel_id) await ensureFilmSlots(id, body.channel_id, fmMeta);
        if (body.playback_mode === 'sermon'   && body.channel_id) await ensureTalkshowSlot(id, body.channel_id, smPools);
        await loadChannelRuntimes();
        return { status: 200, body: { id } };
      }
      if (id && method === 'DELETE') {
        if (auth?.role !== 'admin') return { status: 403, body: { error: 'Admin access required' } };
        await query('DELETE FROM media_broadcasts WHERE id=$1', [id]);
        await loadChannelRuntimes();
        return { status: 200, body: { message: 'Deleted' } };
      }
    }

    // ── Channels ────────────────────────────────────────────────────────────
    if (resource === 'channels') {
      // Ejected slots sub-resource — decks linked to this channel that have saved ejected slots
      if (id && sub === 'ejected-slots' && method === 'GET') {
        const deckRows = [...world.furniture.values()].filter(f => f.flags && 'media_deck' in f.flags && f.flags.channel_id === id);
        const result = [];
        for (const d of deckRows) {
          const df = d.flags;
          const slots = typeof df.deck_ejected_slots === 'object' && !Array.isArray(df.deck_ejected_slots)
            ? df.deck_ejected_slots : {};
          for (const [bcId, bcSlots] of Object.entries(slots)) {
            for (const slot of bcSlots) {
              result.push({ broadcast_id: bcId, deck_id: d.id, ...slot });
            }
          }
        }
        // Enrich with broadcast names
        const bcIds = [...new Set(result.map(r => r.broadcast_id))];
        let nameMap = {};
        if (bcIds.length) {
          const { rows: names } = await query(`SELECT id, name, category FROM media_broadcasts WHERE id = ANY($1)`, [bcIds]);
          for (const b of names) nameMap[b.id] = b;
        }
        return { status: 200, body: result.map(r => ({ ...r, broadcast_name: nameMap[r.broadcast_id]?.name || r.broadcast_id, broadcast_category: nameMap[r.broadcast_id]?.category || 'general' })) };
      }

      // Discard a ghost (ejected) slot — forget the saved schedule for a cassette
      // that's no longer in the deck. Needs deck_id + broadcast_id in the body.
      if (id && sub === 'ejected-slots' && method === 'DELETE') {
        const deckId = body?.deck_id;
        const broadcastId = body?.broadcast_id;
        if (!deckId || !broadcastId) return { status: 400, body: { error: 'deck_id and broadcast_id required' } };
        const { rows } = await query('SELECT flags FROM furniture WHERE id=$1', [deckId]);
        if (!rows.length) return { status: 404, body: { error: 'Deck not found' } };
        const df = typeof rows[0].flags === 'object' ? rows[0].flags : JSON.parse(rows[0].flags || '{}');
        const ejected = typeof df.deck_ejected_slots === 'object' && !Array.isArray(df.deck_ejected_slots)
          ? df.deck_ejected_slots : {};
        if (!(broadcastId in ejected)) return { status: 200, body: { message: 'Nothing to remove' } };
        delete ejected[broadcastId];
        df.deck_ejected_slots = ejected;
        await updateFurniture(deckId, { flags: JSON.stringify(df) });
        return { status: 200, body: { message: 'Removed' } };
      }

      // Playlist sub-resource
      if (id && sub === 'playlist') {
        if (method === 'GET') {
          const { rows } = await query(
            `SELECT p.*, b.name AS broadcast_name, b.playback_mode, b.messages, b.message_interval, b.override_duration, b.broadcast_graph, b.fallback_messages
               FROM media_channel_playlist p
               LEFT JOIN media_broadcasts b ON b.id = p.broadcast_id
              WHERE p.channel_id=$1 ORDER BY p.start_time`,
            [id]
          );
          return { status: 200, body: rows };
        }
        if (method === 'PUT') {
          // Replace entire playlist for channel
          await query('DELETE FROM media_channel_playlist WHERE channel_id=$1', [id]);
          const items = Array.isArray(body) ? body : [];
          for (const item of items) {
            const pid = item.id || `pl_${randomUUID()}`;
            const slotType = item.slot_type || 'broadcast';
            const cond = item.conditions || [];
            await query(
              `INSERT INTO media_channel_playlist (id,channel_id,broadcast_id,start_time,duration_override,priority,conditions,slot_type,days)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [pid, id, item.broadcast_id || null, item.start_time || 0,
               item.duration_override || null, item.priority || 0,
               JSON.stringify(cond), slotType, _dayMask(item.days)]
            );
          }
          // Single authority for NPC staffing: recalc derives each broadcast's hosts
          // from its graph and staffs the studio ONLY for live shows + weather
          // forecasts (scripted shows never put NPCs on-stage). It also self-heals
          // any NPC a prior pass wrongly commuted to a studio.
          await recalculateNpcSchedules();
          return { status: 200, body: { message: 'Playlist updated' } };
        }
      }

      if (id && sub === 'restart' && method === 'POST') {
        const ok = restartChannelBroadcast(id);
        return ok
          ? { status: 200, body: { message: 'Channel broadcast restarted.' } }
          : { status: 404, body: { error: 'Channel not found or not running.' } };
      }

      // Broadcast debugger: scan a channel's scheduled day for problems that
      // would cause skips / technical difficulties, plus the live runtime log.
      if (id && sub === 'debug' && method === 'GET') {
        if (!devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };
        const report = await scanChannelDay(id);
        return report ? { status: 200, body: report } : { status: 404, body: { error: 'Channel not found' } };
      }

      if (!id && method === 'GET') {
        const { rows: channels } = await query('SELECT * FROM media_channels ORDER BY number');
        const { rows: pl } = await query(
          `SELECT p.*, b.name AS broadcast_name, b.playback_mode, b.messages, b.message_interval, b.override_duration
             FROM media_channel_playlist p
             JOIN media_broadcasts b ON b.id = p.broadcast_id
            ORDER BY p.channel_id, p.start_time`
        );
        const plByChannel = {};
        for (const item of pl) {
          if (!plByChannel[item.channel_id]) plByChannel[item.channel_id] = [];
          plByChannel[item.channel_id].push(item);
        }
        return { status: 200, body: channels.map(c => ({ ...c, playlist: plByChannel[c.id] || [], now_broadcasting: nowBroadcastingFor(c.id) })) };
      }
      if (!id && method === 'POST') {
        const cid = body.id || `ch_${Date.now()}`;
        await query(
          `INSERT INTO media_channels (id,name,number,description,station_name,theme_id,enabled,loop_playlist,priority,channel_type,idle_broadcast_id,news_categories,commercial_pool,studio_zone_id,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,EXTRACT(EPOCH FROM NOW()))`,
          [cid, body.name || 'Untitled Channel', body.number || null, body.description || '',
           body.station_name || '', body.theme_id || null,
           body.enabled !== false ? 1 : 0, body.loop_playlist !== false ? 1 : 0,
           body.priority || 0, body.channel_type || 'playlist',
           body.idle_broadcast_id || null, JSON.stringify(body.news_categories || []),
           JSON.stringify(body.commercial_pool || []), body.studio_zone_id || null]
        );
        // Auto-create streaming camera when studio_zone_id is provided with the new channel
        if (body.studio_zone_id) {
          await query(
            `INSERT INTO media_cameras (id, zone_id, streaming_channel_id, is_streaming, is_powered)
             VALUES ($1, $2, $3, 1, 1)
             ON CONFLICT (id) DO NOTHING`,
            [`cam_studio_${cid}`, body.studio_zone_id, cid]
          ).catch(() => {});
        }
        await loadChannelRuntimes();
        return { status: 201, body: { id: cid } };
      }
      if (id && !sub && method === 'PUT') {
        await query(
          `UPDATE media_channels SET name=$1,number=$2,description=$3,station_name=$4,theme_id=$5,
           enabled=$6,loop_playlist=$7,priority=$8,channel_type=$9,idle_broadcast_id=$10,news_categories=$11,
           schedule_mode=$12,studio_zone_id=$13,offline_graphic_id=$14,commercial_pool=$15,
           updated_at=EXTRACT(EPOCH FROM NOW()) WHERE id=$16`,
          [body.name || 'Untitled Channel', body.number || null, body.description || '',
           body.station_name || '', body.theme_id || null,
           body.enabled !== false ? 1 : 0, body.loop_playlist !== false ? 1 : 0,
           body.priority || 0, body.channel_type || 'playlist',
           body.idle_broadcast_id || null, JSON.stringify(body.news_categories || []),
           body.schedule_mode || 'loop', body.studio_zone_id || null,
           body.offline_graphic_id || null, JSON.stringify(body.commercial_pool || []), id]
        );
        await loadChannelRuntimes();
        return { status: 200, body: { id } };
      }
      if (id && !sub && method === 'DELETE') {
        if (auth?.role !== 'admin') return { status: 403, body: { error: 'Admin access required' } };
        // Look up studio zone before deleting the channel row
        const { rows: chRows } = await query('SELECT studio_zone_id FROM media_channels WHERE id=$1', [id]);
        const studioZoneId = chRows[0]?.studio_zone_id || null;
        await query('DELETE FROM media_cameras WHERE streaming_channel_id=$1', [id]);
        await deleteFurnitureWhere('DELETE FROM furniture WHERE object_type=\'media_deck\' AND flags->>\'channel_id\'=$1', [id]);
        await query('UPDATE media_broadcasts SET channel_id=NULL WHERE channel_id=$1', [id]);
        await query('DELETE FROM media_channels WHERE id=$1', [id]);
        // Cascade: delete the studio zone and its entire map (production, utility rooms, etc.)
        if (studioZoneId) await apiDeleteZone(studioZoneId).catch(err => console.warn('[broadcast] studio zone cleanup:', err.message));
        await loadChannelRuntimes();
        await loadZoneTunings();
        return { status: 200, body: { message: 'Deleted' } };
      }
    }

    // ── Cameras ─────────────────────────────────────────────────────────────
    if (resource === 'cameras') {
      if (!id && method === 'GET') {
        const { rows } = await query(
          `SELECT c.*, z.name AS zone_name, ch.name AS channel_name, ch.number AS channel_number
             FROM media_cameras c
             LEFT JOIN zones z ON z.id = c.zone_id
             LEFT JOIN media_channels ch ON ch.id = c.streaming_channel_id
            ORDER BY z.name, c.id`
        );
        return { status: 200, body: rows };
      }
      if (!id && method === 'POST') {
        const camId = body.id || `cam_${Date.now()}`;
        await query(
          `INSERT INTO media_cameras (id,zone_id,direction,is_powered,is_recording,is_streaming,streaming_channel_id,storage_limit,permissions,flags)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [camId, body.zone_id || null, body.direction || 'north',
           body.is_powered !== false ? 1 : 0, body.is_recording ? 1 : 0, body.is_streaming ? 1 : 0,
           body.streaming_channel_id || null, body.storage_limit || 200,
           body.permissions || 'public', JSON.stringify(body.flags || {})]
        );
        // Create matching broadcast_camera furniture so players can interact with it
        if (body.zone_id) {
          const camNum = body.id ? (body.id.match(/_(\d+)_\d+$/) || [])[1] : null;
          const camLabel = camNum ? `Broadcast Camera ${camNum}` : 'Broadcast Camera';
          await insertFurniture({
            id: `${camId}_furn`, zone_id: body.zone_id, name: camLabel,
            description: 'A broadcast-grade studio camera on a heavy-duty motorised mount. A small red light glows when streaming.',
            object_type: 'broadcast_camera',
            flags: JSON.stringify({ broadcast_transmitter: true, camera_id: camId, channel_id: body.streaming_channel_id || null }),
          }, 'ON CONFLICT (id) DO NOTHING');
        }
        await loadChannelRuntimes();
        return { status: 201, body: { id: camId } };
      }
      if (id && method === 'PUT') {
        await query(
          `UPDATE media_cameras SET zone_id=$1,direction=$2,is_powered=$3,is_recording=$4,is_streaming=$5,
           streaming_channel_id=$6,storage_limit=$7,permissions=$8,flags=$9 WHERE id=$10`,
          [body.zone_id || null, body.direction || 'north',
           body.is_powered !== false ? 1 : 0, body.is_recording ? 1 : 0, body.is_streaming ? 1 : 0,
           body.streaming_channel_id || null, body.storage_limit || 200,
           body.permissions || 'public', JSON.stringify(body.flags || {}), id]
        );
        await loadChannelRuntimes();
        return { status: 200, body: { id } };
      }
      if (id && method === 'DELETE') {
        if (auth?.role !== 'admin') return { status: 403, body: { error: 'Admin access required' } };
        await query('DELETE FROM media_cameras WHERE id=$1', [id]);
        await loadChannelRuntimes();
        return { status: 200, body: { message: 'Deleted' } };
      }
      // Clear recording buffer
      if (id && sub === 'clear-buffer' && method === 'POST') {
        await query('UPDATE media_cameras SET recording_buffer=$1 WHERE id=$2', ['[]', id]);
        return { status: 200, body: { message: 'Buffer cleared' } };
      }
    }

    // ── Convert recording to broadcast ──────────────────────────────────────
    if (resource === 'cameras' && id && sub === 'to-broadcast' && method === 'POST') {
      const { rows } = await query('SELECT * FROM media_cameras WHERE id=$1', [id]);
      if (!rows.length) return { status: 404, body: { error: 'Camera not found' } };
      const cam = rows[0];
      const buf = Array.isArray(cam.recording_buffer) ? cam.recording_buffer : JSON.parse(cam.recording_buffer || '[]');
      if (!buf.length) return { status: 400, body: { error: 'No recording to convert' } };
      const bid = `bc_rec_${id}_${Date.now()}`;
      const messages = buf.map(e => ({ text: e.text }));
      await query(
        `INSERT INTO media_broadcasts (id,name,description,category,playback_mode,messages,message_interval,enabled,created_by,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,EXTRACT(EPOCH FROM NOW()))`,
        [bid, body.name || `Recording from camera ${id}`, body.description || '',
         'recording', 'recorded', JSON.stringify(messages), 5, 1, auth?.playerId || 'unknown']
      );
      await loadChannelRuntimes();
      return { status: 201, body: { id: bid, message_count: messages.length } };
    }

    // ── Themes ──────────────────────────────────────────────────────────────
    if (resource === 'themes') {
      if (!id && method === 'GET') {
        const { rows } = await query('SELECT * FROM media_themes ORDER BY name');
        return { status: 200, body: rows };
      }
      if (!id && method === 'POST') {
        const tid = body.id || `theme_${Date.now()}`;
        await query(
          `INSERT INTO media_themes (id,name,description,preset,bg_color,border_color,text_color,header_color,accent_color,live_color,ticker_color,scanlines,flags,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,EXTRACT(EPOCH FROM NOW()),EXTRACT(EPOCH FROM NOW()))`,
          [tid, body.name||'Untitled', body.description||'', body.preset||'corporate',
           body.bg_color||'', body.border_color||'', body.text_color||'', body.header_color||'',
           body.accent_color||'', body.live_color||'', body.ticker_color||'',
           body.scanlines ?? 1, JSON.stringify(body.flags||{})]
        );
        await loadChannelRuntimes();
        return { status: 201, body: { id: tid } };
      }
      if (id && method === 'PUT') {
        await query(
          `UPDATE media_themes SET name=$1,description=$2,preset=$3,bg_color=$4,border_color=$5,text_color=$6,
           header_color=$7,accent_color=$8,live_color=$9,ticker_color=$10,scanlines=$11,flags=$12,
           updated_at=EXTRACT(EPOCH FROM NOW()) WHERE id=$13`,
          [body.name||'Untitled', body.description||'', body.preset||'corporate',
           body.bg_color||'', body.border_color||'', body.text_color||'', body.header_color||'',
           body.accent_color||'', body.live_color||'', body.ticker_color||'',
           body.scanlines ?? 1, JSON.stringify(body.flags||{}), id]
        );
        await loadChannelRuntimes();
        return { status: 200, body: { id } };
      }
      if (id && method === 'DELETE') {
        if (auth?.role !== 'admin') return { status: 403, body: { error: 'Admin access required' } };
        await query('DELETE FROM media_themes WHERE id=$1', [id]);
        await loadChannelRuntimes();
        return { status: 200, body: { message: 'Deleted' } };
      }
    }

    // ── Orphan cleanup ──────────────────────────────────────────────────────
    if (resource === 'cleanup-orphans' && method === 'POST') {
      if (auth?.role !== 'admin') return { status: 403, body: { error: 'Admin access required' } };
      const report = {};

      // Playlist entries whose broadcast no longer exists (null broadcast_id on a broadcast-type slot)
      const { rows: orphanSlots } = await query(
        `SELECT p.id FROM media_channel_playlist p
         WHERE p.broadcast_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM media_broadcasts b WHERE b.id = p.broadcast_id)`
      );
      if (orphanSlots.length) {
        await query(
          `DELETE FROM media_channel_playlist WHERE id = ANY($1::text[])`,
          [orphanSlots.map(r => r.id)]
        );
        report.playlistSlotsRemoved = orphanSlots.length;
      }

      // Broadcasts pointing at a deleted channel
      const { rows: orphanBcChannel } = await query(
        `SELECT id FROM media_broadcasts
         WHERE channel_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM media_channels c WHERE c.id = channel_id)`
      );
      if (orphanBcChannel.length) {
        await query(
          `UPDATE media_broadcasts SET channel_id=NULL WHERE id = ANY($1::text[])`,
          [orphanBcChannel.map(r => r.id)]
        );
        report.broadcastChannelRefsCleared = orphanBcChannel.length;
      }

      // Channels with idle_broadcast_id pointing at a deleted broadcast
      const { rows: orphanIdleBc } = await query(
        `SELECT id FROM media_channels
         WHERE idle_broadcast_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM media_broadcasts b WHERE b.id = idle_broadcast_id)`
      );
      if (orphanIdleBc.length) {
        await query(
          `UPDATE media_channels SET idle_broadcast_id=NULL WHERE id = ANY($1::text[])`,
          [orphanIdleBc.map(r => r.id)]
        );
        report.channelIdleBcRefsCleared = orphanIdleBc.length;
      }

      // Channels with studio_zone_id pointing at a deleted zone
      const { rows: orphanStudio } = await query(
        `SELECT id FROM media_channels
         WHERE studio_zone_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM zones z WHERE z.id = studio_zone_id)`
      );
      if (orphanStudio.length) {
        await query(
          `UPDATE media_channels SET studio_zone_id=NULL WHERE id = ANY($1::text[])`,
          [orphanStudio.map(r => r.id)]
        );
        report.channelStudioZoneRefsCleared = orphanStudio.length;
      }

      // Cameras pointing at a deleted zone
      const { rows: orphanCamZone } = await query(
        `SELECT id FROM media_cameras
         WHERE zone_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM zones z WHERE z.id = zone_id)`
      );
      if (orphanCamZone.length) {
        await query(
          `DELETE FROM media_cameras WHERE id = ANY($1::text[])`,
          [orphanCamZone.map(r => r.id)]
        );
        report.camerasRemovedDeadZone = orphanCamZone.length;
      }

      // Cameras streaming to a deleted channel
      const { rows: orphanCamCh } = await query(
        `SELECT id FROM media_cameras
         WHERE streaming_channel_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM media_channels c WHERE c.id = streaming_channel_id)`
      );
      if (orphanCamCh.length) {
        await query(
          `UPDATE media_cameras SET streaming_channel_id=NULL WHERE id = ANY($1::text[])`,
          [orphanCamCh.map(r => r.id)]
        );
        report.cameraChannelRefsCleared = orphanCamCh.length;
      }

      // Dead surveillance-clip broadcasts (`bc_clip_*`): one hidden enabled=0
      // entry is minted per datachip so a chip can play on a zone's TVs. When the
      // security_clips row is gone AND no chip for it is held in any inventory,
      // the broadcast can never air again — reap it plus its unheld chip item.
      // A clip whose chip is still held is LEFT ALONE (it's the last copy).
      const { rows: deadClipBc } = await query(
        `SELECT b.id FROM media_broadcasts b
          WHERE b.id LIKE 'bc_clip_%'
            AND NOT EXISTS (SELECT 1 FROM security_clips c WHERE ('bc_clip_'||c.id) = b.id)
            AND NOT EXISTS (
              SELECT 1 FROM items i JOIN player_inventory pi ON pi.item_id = i.id
               WHERE i.tags->>'broadcast_id' = b.id)`
      );
      if (deadClipBc.length) {
        const ids = deadClipBc.map(r => r.id);
        const { rows: deadChips } = await query(
          `SELECT id FROM items
             WHERE tags->>'broadcast_id' = ANY($1::text[])
               AND NOT EXISTS (SELECT 1 FROM player_inventory pi WHERE pi.item_id = items.id)`,
          [ids]
        );
        await query(`DELETE FROM media_broadcasts WHERE id = ANY($1::text[])`, [ids]);
        if (deadChips.length) {
          await query(`DELETE FROM items WHERE id = ANY($1::text[])`, [deadChips.map(r => r.id)]);
          for (const r of deadChips) deleteItemCache(r.id);
        }
        report.clipBroadcastsReaped = deadClipBc.length;
        report.clipChipsReaped = deadChips.length;
      }

      await loadChannelRuntimes();
      const total = Object.values(report).reduce((s, n) => s + n, 0);
      return { status: 200, body: { message: total ? `Cleaned ${total} orphaned reference(s)` : 'Nothing to clean — no orphans found', report } };
    }

    // ── Graphics ────────────────────────────────────────────────────────────
    // ── Studio Info — inspect an exterior zone for existing studio rooms ────────
    if (resource === 'studio-info' && method === 'POST') {
      const exteriorZoneId = body?.exterior_zone_id;
      if (!exteriorZoneId) return { status: 400, body: { error: 'exterior_zone_id required' } };

      // Find interior map for this exterior zone
      const { rows: maps } = await query(
        'SELECT id FROM maps WHERE parent_zone_id=$1 LIMIT 1', [exteriorZoneId]
      );
      if (!maps.length) return { status: 200, body: { hasMap: false } };
      const mapId = maps[0].id;

      // Find all interior zones on this map
      const { rows: zones } = await query(
        'SELECT id, grid_x, grid_y, grid_z, exits, flags FROM zones WHERE map_id=$1', [mapId]
      );
      // Stage = grid 0,0,0 or has is_building flag
      const stage = zones.find(z => z.grid_z === 0 && z.grid_x === 0 && z.grid_y === 0)
        || zones.find(z => z.flags?.is_building);
      if (!stage) return { status: 200, body: { hasMap: true, noStage: true } };

      const stageExits = stage.exits || {};
      const utilityId  = stageExits.down || null;
      const productionId = stageExits.up || null;

      return { status: 200, body: {
        hasMap: true,
        stage_zone_id:      stage.id,
        utility_zone_id:    utilityId,
        production_zone_id: productionId,
        missingUtility:     !utilityId,
        missingProduction:  !productionId,
      }};
    }

    // ── Ensure Studio — attach to existing building, create missing rooms ────────
    if (resource === 'ensure-studio' && method === 'POST') {
      if (!devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };
      const { exterior_zone_id, studio_name, channel_id, studio_zone_id, grid_x, grid_y } = body || {};

      const ts = Date.now();
      let exteriorZoneId = exterior_zone_id || null;
      let mapId = null, studioZoneId = null, studioExits = null;
      let stageX = 0, stageY = 0, stageZ = 0;
      const touchedNeighbors = [];

      // Resolve from an existing stage zone when given (a list-picked studio, or
      // a channel that already points at its studio). The stage is authoritative;
      // derive its map + exterior from it so we only backfill what's missing.
      if (studio_zone_id) {
        const { rows: stRows } = await query(
          'SELECT id, map_id, grid_x, grid_y, grid_z, exits, flags FROM zones WHERE id=$1', [studio_zone_id]
        );
        if (stRows.length) {
          const st = stRows[0];
          studioZoneId = st.id;
          mapId        = st.map_id;
          studioExits  = st.exits || {};
          stageX = st.grid_x ?? 0; stageY = st.grid_y ?? 0; stageZ = st.grid_z ?? 0;
          if (!exteriorZoneId) exteriorZoneId = st.flags?.world_exit_zone || studioExits.out || null;
        }
      }

      // Otherwise resolve/create the exterior world tile from grid coords
      // (empty-cell "place new" path), wiring it to orthogonal neighbours.
      if (!exteriorZoneId && !studioZoneId && grid_x != null && grid_y != null) {
        const { rows: existing } = await query(
          `SELECT id FROM zones WHERE map_id='map_world' AND grid_x=$1 AND grid_y=$2 AND COALESCE(grid_z,0)=0 LIMIT 1`,
          [grid_x, grid_y]
        );
        if (existing.length) {
          exteriorZoneId = existing[0].id;
        } else {
          exteriorZoneId = `zone_ext_${ts}`;
          const tileColor = await _studioTileColor();
          const NEIGHBOR_DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
          const NEIGHBOR_OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
          const newExits = {};
          for (const [dir, [dx, dy]] of Object.entries(NEIGHBOR_DIRS)) {
            const { rows: nb } = await query(
              `SELECT id, exits FROM zones WHERE map_id='map_world' AND grid_x=$1 AND grid_y=$2 AND COALESCE(grid_z,0)=0 LIMIT 1`,
              [grid_x + dx, grid_y + dy]
            );
            if (!nb.length) continue;
            newExits[dir] = nb[0].id;
            const nbExits = { ...(nb[0].exits || {}), [NEIGHBOR_OPP[dir]]: exteriorZoneId };
            await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(nbExits), nb[0].id]);
            touchedNeighbors.push(nb[0].id);
          }
          await query(
            `INSERT INTO zones (id,name,description,map_id,grid_x,grid_y,grid_z,marker,color,flags,exits)
             VALUES ($1,$2,$3,'map_world',$4,$5,0,$6,$7,'{}',$8)`,
            [exteriorZoneId, studio_name || 'Studio', `Exterior of ${studio_name || 'the studio'}.`,
             grid_x, grid_y, (studio_name || 'ST').slice(0, 2).toUpperCase(), tileColor, JSON.stringify(newExits)]
          );
        }
      }

      if (!exteriorZoneId && !studioZoneId) {
        return { status: 400, body: { error: 'exterior_zone_id, studio_zone_id, or grid_x+grid_y required' } };
      }

      // Find or create interior map (the stage path already resolved mapId).
      if (!mapId) {
        const { rows: maps } = await query('SELECT id FROM maps WHERE parent_zone_id=$1 LIMIT 1', [exteriorZoneId]);
        if (maps.length) {
          mapId = maps[0].id;
        } else {
          mapId = `map_int_${ts}`;
          await query('INSERT INTO maps (id,name,parent_zone_id) VALUES ($1,$2,$3)',
            [mapId, studio_name || 'Studio Interior', exteriorZoneId]);
        }
      }

      // Find or create stage zone (skip when already resolved from studio_zone_id).
      if (!studioZoneId) {
        const { rows: stageRows } = await query(
          'SELECT id, exits FROM zones WHERE map_id=$1 AND grid_z=0 AND grid_x=0 AND grid_y=0 LIMIT 1', [mapId]
        );
        if (stageRows.length) {
          studioZoneId = stageRows[0].id;
          studioExits  = stageRows[0].exits || {};
        } else {
          studioZoneId = `zone_studio_${ts}`;
          const stageName = `${studio_name || 'Studio'} — Stage`;
          await query(
            `INSERT INTO zones (id,name,description,map_id,grid_x,grid_y,grid_z,flags,exits)
             VALUES ($1,$2,$3,$4,0,0,0,$5,$6)`,
            [studioZoneId, stageName, 'The main studio stage floor.', mapId,
             JSON.stringify({ is_interior: true, is_building: true, world_exit_zone: exteriorZoneId }),
             JSON.stringify(exteriorZoneId ? { out: exteriorZoneId } : {})]
          );
          // Wire exterior → stage
          if (exteriorZoneId) {
            const { rows: extRows } = await query('SELECT exits FROM zones WHERE id=$1', [exteriorZoneId]);
            const extExits = JSON.stringify({ ...(extRows[0]?.exits || {}), in: studioZoneId });
            await query('UPDATE zones SET exits=$1 WHERE id=$2', [extExits, exteriorZoneId]);
          }
          studioExits = exteriorZoneId ? { out: exteriorZoneId } : {};
          await insertFurniture({
            id: `furn_light_stage_${ts}`, zone_id: studioZoneId,
            name: 'Overhead Light', description: 'A recessed overhead light panel.',
            object_type: 'light', light_type: 'overhead', light_on: 1, light_on_intended: 1,
            power_draw_kw: 0.02, lumen_output: 1200, flags: '{}',
          });
        }
      }

      // Find or create utility room (down)
      let utilityZoneId = studioExits.down || null;
      if (!utilityZoneId) {
        utilityZoneId = `zone_util_${ts}`;
        await query(
          `INSERT INTO zones (id,name,description,map_id,grid_x,grid_y,grid_z,flags,exits)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [utilityZoneId, `${studio_name || 'Studio'} — Power Room`,
           'Utility room housing the building junction box.', mapId,
           stageX, stageY, stageZ - 1,
           JSON.stringify({ is_interior: true }), JSON.stringify({ up: studioZoneId })]
        );
        studioExits = { ...studioExits, down: utilityZoneId };
        await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(studioExits), studioZoneId]);
        await insertFurniture({
          id: `furn_light_util_${ts}`, zone_id: utilityZoneId,
          name: 'Overhead Light', description: 'A recessed overhead light panel.',
          object_type: 'light', light_type: 'overhead', light_on: 1, light_on_intended: 1,
          power_draw_kw: 0.02, lumen_output: 1200, flags: '{}',
        });

        const { rows: plants } = await query(`SELECT id FROM generators WHERE generator_type='city_plant' AND status='online' LIMIT 1`);
        const cityGenId = plants[0]?.id || null;
        const jboxId = `gen_${utilityZoneId}_${ts}`;
        await query(
          `INSERT INTO generators (id,zone_id,name,generator_type,capacity_kw,status,city_generator_id,remaining_kw)
           VALUES ($1,$2,$3,'junction_box',500,'online',$4,500)`,
          [jboxId, utilityZoneId, `${studio_name || 'Studio'} Junction Box`, cityGenId]
        );
        await query(
          `INSERT INTO power_zones (id,name,source_type,generator_id,capacity_kw,current_load_kw,status,available_kw,max_capacity_kw)
           VALUES ($1,$2,'junction_box',$3,500,0,'powered',500,500) ON CONFLICT (id) DO NOTHING`,
          [utilityZoneId, `${studio_name || 'Studio'} Power Room`, jboxId]
        );
        // Physical, destructible junction-box furniture linked to the generator row.
        await insertFurniture({
          id: `furn_jbox_${utilityZoneId}_${ts}`, zone_id: utilityZoneId,
          name: `${studio_name || 'Studio'} Junction Box`,
          description: 'A grey steel junction cabinet of breakers and humming busbars, feeding the building. A small sealed hacking port sits below the latch.',
          object_type: 'junction_box', flags: JSON.stringify({ destructible: true, generator_id: jboxId }),
          hp: 1200, hp_max: 1200,
        }, 'ON CONFLICT (id) DO NOTHING');
      }

      // Find or create production/control room (up)
      let productionZoneId = studioExits.up || null;
      if (!productionZoneId) {
        productionZoneId = `zone_prod_${ts}`;
        await query(
          `INSERT INTO zones (id,name,description,map_id,grid_x,grid_y,grid_z,flags,exits)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [productionZoneId, `${studio_name || 'Studio'} — Production`,
           'Media deck and broadcast control room.', mapId,
           stageX, stageY, stageZ + 1,
           JSON.stringify({ is_interior: true }), JSON.stringify({ down: studioZoneId })]
        );
        studioExits = { ...studioExits, up: productionZoneId };
        await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(studioExits), studioZoneId]);
        await insertFurniture({
          id: `furn_light_prod_${ts}`, zone_id: productionZoneId,
          name: 'Overhead Light', description: 'A recessed overhead light panel.',
          object_type: 'light', light_type: 'overhead', light_on: 1, light_on_intended: 1,
          power_draw_kw: 0.02, lumen_output: 1200, flags: '{}',
        });
      }

      // Ensure power_zones for stage and production exist
      for (const [zid, zname] of [[studioZoneId, 'Stage'], [productionZoneId, 'Production']]) {
        const { rows: genRows } = await query(`SELECT generator_id FROM power_zones WHERE id=$1`, [utilityZoneId]);
        const jboxRef = genRows[0]?.generator_id || null;
        await query(
          `INSERT INTO power_zones (id,name,source_type,generator_id,capacity_kw,current_load_kw,status,available_kw,max_capacity_kw)
           VALUES ($1,$2,'junction_box',$3,500,0,'powered',500,500) ON CONFLICT (id) DO NOTHING`,
          [zid, zname, jboxRef]
        );
      }

      // Ensure exterior zone has a street light (idempotent — skip if one already exists)
      if (exteriorZoneId) {
        const { rows: extLights } = await query(
          `SELECT id FROM furniture WHERE zone_id=$1 AND light_type='streetlight' LIMIT 1`, [exteriorZoneId]
        );
        if (!extLights.length) {
          await insertFurniture({
            id: `furn_light_ext_${ts}`, zone_id: exteriorZoneId,
            name: 'Street Light', description: 'A tall metal post topped with a flickering sodium lamp.',
            object_type: 'light', light_type: 'streetlight', light_on: 0,
            power_draw_kw: 0.2, lumen_output: 8000, flags: '{}',
          });
        }
      }

      // Upsert lighting_states for all three interior zones so their lights register
      for (const zid of [studioZoneId, utilityZoneId, productionZoneId]) {
        const { rows: lc } = await query(
          `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(COALESCE(lumen_output,0)),0)::int AS lm
             FROM furniture WHERE zone_id=$1 AND object_type='light' AND light_on=1`, [zid]
        );
        await query(
          `INSERT INTO lighting_states (zone_id,has_emergency_lighting,artificial_light_level,fixture_count,total_lumens)
           VALUES ($1,0,0,$2,$3) ON CONFLICT (zone_id) DO UPDATE SET fixture_count=$2, total_lumens=$3`,
          [zid, lc[0]?.cnt || 0, lc[0]?.lm || 0]
        ).catch(() => {});
      }

      await Promise.all(
        [studioZoneId, utilityZoneId, productionZoneId, exteriorZoneId, ...touchedNeighbors]
          .filter(Boolean).map(reloadZone)
      );
      await recomputePower().catch(() => {});
      await resyncAllLightingStates().catch(() => {});

      return { status: 200, body: {
        exterior_zone_id: exteriorZoneId, studio_zone_id: studioZoneId,
        utility_zone_id: utilityZoneId, production_zone_id: productionZoneId,
      }};
    }

    // ── Create Studio (zone + power room + junction box) ────────────────────────
    if (resource === 'create-studio' && method === 'POST') {
      if (!devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };
      const { studio_name, exterior_zone_id, grid_x, grid_y, channel_id } = body || {};
      if (!studio_name) return { status: 400, body: { error: 'studio_name is required' } };

      const ts = Date.now();
      let exteriorZoneId = exterior_zone_id;
      let createdExterior = false;

      // Track created entities for cleanup on failure
      const created = { exterior: null, map: null, studio: null, utility: null, production: null, jbox: null };
      const touchedNeighbors = [];

      try {
        // If grid coords given, create or reuse the exterior world-map zone
        if (!exteriorZoneId && grid_x != null && grid_y != null) {
          const { rows: existing } = await query(
            `SELECT id FROM zones WHERE map_id='map_world' AND grid_x=$1 AND grid_y=$2 LIMIT 1`,
            [grid_x, grid_y]
          );
          if (existing.length) {
            exteriorZoneId = existing[0].id;
          } else {
            exteriorZoneId = `zone_ext_${ts}`;
            const tileColor = await _studioTileColor();
            await query(
              `INSERT INTO zones (id,name,description,map_id,grid_x,grid_y,grid_z,marker,color,flags,exits)
               VALUES ($1,$2,$3,'map_world',$4,$5,0,$6,$7,'{}','{}')`,
              [exteriorZoneId, studio_name, `Exterior of ${studio_name}.`,
               grid_x, grid_y, studio_name.slice(0, 2).toUpperCase(), tileColor]
            );
            created.exterior = exteriorZoneId;
            createdExterior = true;

            // Auto-connect the new world tile to orthogonally adjacent world
            // zones (both directions), matching the map-overview drag behaviour.
            const NEIGHBOR_DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
            const NEIGHBOR_OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
            const newExits = {};
            for (const [dir, [dx, dy]] of Object.entries(NEIGHBOR_DIRS)) {
              const { rows: nb } = await query(
                `SELECT id, exits FROM zones WHERE map_id='map_world' AND grid_x=$1 AND grid_y=$2 AND COALESCE(grid_z,0)=0 LIMIT 1`,
                [grid_x + dx, grid_y + dy]
              );
              if (!nb.length) continue;
              newExits[dir] = nb[0].id;
              const nbExits = { ...(nb[0].exits || {}), [NEIGHBOR_OPP[dir]]: exteriorZoneId };
              await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(nbExits), nb[0].id]);
              touchedNeighbors.push(nb[0].id);
            }
            if (Object.keys(newExits).length) {
              await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(newExits), exteriorZoneId]);
            }
          }
        }
        if (!exteriorZoneId) return { status: 400, body: { error: 'exterior_zone_id or grid_x+grid_y required' } };

        // Create interior map linked to the exterior zone
        const mapId = `map_int_${ts}`;
        await query(
          `INSERT INTO maps (id, name, parent_zone_id, entry_zone_id, created_by) VALUES ($1,$2,$3,$4,$5)`,
          [mapId, `${studio_name} — Interior`, exteriorZoneId, null, auth?.playerId || null]
        );
        created.map = mapId;

        // Create studio zone (floor 0 of interior map, grid 0,0)
        const studioZoneId = `zone_studio_${ts}`;
        const stageName = `${studio_name} Stage`;
        await query(
          `INSERT INTO zones (id,name,description,map_id,grid_x,grid_y,grid_z,flags,exits)
           VALUES ($1,$2,$3,$4,0,0,0,$5,$6)`,
          [studioZoneId, stageName,
           `Broadcast stage for ${studio_name}.`,
           mapId,
           JSON.stringify({ is_interior: true, is_building: true, world_exit_zone: exteriorZoneId }),
           JSON.stringify({ out: exteriorZoneId })]
        );
        created.studio = studioZoneId;

        // Patch map entry_zone_id
        await query(`UPDATE maps SET entry_zone_id=$1 WHERE id=$2`, [studioZoneId, mapId]);

        // Link exterior zone → studio
        const { rows: extRows } = await query('SELECT exits FROM zones WHERE id=$1', [exteriorZoneId]);
        const mergedExits = JSON.stringify({ ...(extRows[0]?.exits || {}), in: studioZoneId });
        await query('UPDATE zones SET exits=$1 WHERE id=$2', [mergedExits, exteriorZoneId]);

        // Create utility/power room below (grid 0,0,-1)
        const utilityZoneId = `zone_util_${ts}`;
        await query(
          `INSERT INTO zones (id,name,description,map_id,grid_x,grid_y,grid_z,flags,exits)
           VALUES ($1,$2,$3,$4,0,0,-1,$5,$6)`,
          [utilityZoneId, `${studio_name} — Power Room`,
           'Utility room housing the building junction box.',
           mapId,
           JSON.stringify({ is_interior: true }),
           JSON.stringify({ up: studioZoneId })]
        );
        created.utility = utilityZoneId;

        // Create production/control room above stage (grid 0,0,1)
        const productionZoneId = `zone_prod_${ts}`;
        const productionName = `${studio_name} — Production`;
        await query(
          `INSERT INTO zones (id,name,description,map_id,grid_x,grid_y,grid_z,flags,exits)
           VALUES ($1,$2,$3,$4,0,0,1,$5,$6)`,
          [productionZoneId, productionName,
           'Media deck and broadcast control room.',
           mapId,
           JSON.stringify({ is_interior: true }),
           JSON.stringify({ down: studioZoneId })]
        );
        created.production = productionZoneId;

        // Add down exit from studio to utility room and up exit to production
        const { rows: stRows } = await query('SELECT exits FROM zones WHERE id=$1', [studioZoneId]);
        const studioExits = JSON.stringify({ ...(stRows[0]?.exits || {}), down: utilityZoneId, up: productionZoneId });
        await query('UPDATE zones SET exits=$1 WHERE id=$2', [studioExits, studioZoneId]);

        // Find city plant generator
        const { rows: plants } = await query(
          `SELECT id FROM generators WHERE generator_type='city_plant' AND status='online' LIMIT 1`
        );
        const cityGenId = plants[0]?.id || null;

        // Create junction_box generator in utility room
        const jboxId = `gen_${utilityZoneId}_${ts}`;
        await query(
          `INSERT INTO generators (id,zone_id,name,generator_type,capacity_kw,status,city_generator_id,remaining_kw)
           VALUES ($1,$2,$3,'junction_box',500,'online',$4,500)`,
          [jboxId, utilityZoneId, `${studio_name} Junction Box`, cityGenId]
        );
        created.jbox = jboxId;
        // Physical, destructible junction-box furniture linked to the generator row.
        await insertFurniture({
          id: `furn_jbox_${utilityZoneId}_${ts}`, zone_id: utilityZoneId,
          name: `${studio_name} Junction Box`,
          description: 'A grey steel junction cabinet of breakers and humming busbars, feeding the building. A small sealed hacking port sits below the latch.',
          object_type: 'junction_box', flags: JSON.stringify({ destructible: true, generator_id: jboxId }),
          hp: 1200, hp_max: 1200,
        }, 'ON CONFLICT (id) DO NOTHING');

        // Register zones in power_zones
        for (const [zid, zname] of [
          [studioZoneId,     stageName],
          [utilityZoneId,    `${studio_name} Power Room`],
          [productionZoneId, productionName],
        ]) {
          await query(
            `INSERT INTO power_zones (id,name,source_type,generator_id,capacity_kw,current_load_kw,status,available_kw,max_capacity_kw)
             VALUES ($1,$2,'junction_box',$3,500,0,'powered',500,500)
             ON CONFLICT (id) DO NOTHING`,
            [zid, zname, jboxId]
          );
        }

        // Overhead lights in each interior zone
        for (const [zid, lightSuffix] of [[studioZoneId, 'stage'], [utilityZoneId, 'util'], [productionZoneId, 'prod']]) {
          await insertFurniture({
            id: `furn_light_${lightSuffix}_${ts}`, zone_id: zid,
            name: 'Overhead Light', description: 'A recessed overhead light panel.',
            object_type: 'light', light_type: 'overhead', light_on: 1, light_on_intended: 1,
            power_draw_kw: 0.02, lumen_output: 1200, flags: '{}',
          });
        }

        // Street light on the exterior zone (day/night managed — light_on_intended stays NULL)
        await insertFurniture({
          id: `furn_light_ext_${ts}`, zone_id: exteriorZoneId,
          name: 'Street Light', description: 'A tall metal post topped with a flickering sodium lamp.',
          object_type: 'light', light_type: 'streetlight', light_on: 0,
          power_draw_kw: 0.2, lumen_output: 8000, flags: '{}',
        });

        // If a channel_id is supplied and that channel exists, link the studio zone and create a streaming camera
        if (channel_id) {
          const { rows: chRows } = await query(`SELECT id FROM media_channels WHERE id=$1`, [channel_id]);
          if (chRows.length) {
            await query(`UPDATE media_channels SET studio_zone_id=$1 WHERE id=$2 AND studio_zone_id IS NULL`, [studioZoneId, channel_id]);
            await query(
              `INSERT INTO media_cameras (id, zone_id, streaming_channel_id, is_streaming, is_powered)
               VALUES ($1, $2, $3, 1, 1)
               ON CONFLICT (id) DO NOTHING`,
              [`cam_studio_${ts}`, studioZoneId, channel_id]
            );
          }
        }

        // Load new zones into the world
        await Promise.all([
          reloadZone(studioZoneId),
          reloadZone(utilityZoneId),
          reloadZone(productionZoneId),
          reloadZone(exteriorZoneId),
          ...touchedNeighbors.map(reloadZone),
        ]);
        // Fix power connections and lighting now that junction box and zones are in place
        await fixZonePowerConnections().catch(() => {});
        await fixBuildingPowerConnections().catch(() => {});
        await recomputePower().catch(() => {});
        await resyncAllLightingStates().catch(() => {});
        if (channel_id) await loadChannelRuntimes();

        return { status: 201, body: {
          exterior_zone_id:    exteriorZoneId,
          studio_zone_id:      studioZoneId,
          utility_zone_id:     utilityZoneId,
          production_zone_id:  productionZoneId,
          map_id:              mapId,
          junction_box_id:     jboxId,
        }};

      } catch (err) {
        // Attempt to clean up any partially created entities
        const cleanup = [];
        if (created.jbox)       cleanup.push(query('DELETE FROM generators WHERE id=$1',    [created.jbox]));
        if (created.production) cleanup.push(query('DELETE FROM power_zones WHERE id=$1',   [created.production]));
        if (created.production) cleanup.push(query('DELETE FROM zones WHERE id=$1',         [created.production]));
        if (created.utility)    cleanup.push(query('DELETE FROM power_zones WHERE id=$1',   [created.utility]));
        if (created.utility)    cleanup.push(query('DELETE FROM zones WHERE id=$1',         [created.utility]));
        if (created.studio)     cleanup.push(query('DELETE FROM power_zones WHERE id=$1',   [created.studio]));
        if (created.studio)     cleanup.push(query('DELETE FROM zones WHERE id=$1',         [created.studio]));
        if (created.map)        cleanup.push(query('DELETE FROM maps WHERE id=$1',          [created.map]));
        if (created.exterior)   cleanup.push(query('DELETE FROM zones WHERE id=$1',         [created.exterior]));
        await Promise.allSettled(cleanup);
        markPowerTopologyDirty(); // rolled back power_zones/generators rows
        return { status: 500, body: { error: `Studio creation failed: ${err.message}` } };
      }
    }

    // ── Deck management for a channel ───────────────────────────────────────────
    if (resource === 'deck') {
      // GET /broadcast/deck/:channel_id — get the deck for a channel
      if (id && method === 'GET') {
        const { rows } = await query(
          `SELECT * FROM furniture WHERE flags->>'channel_id'=$1 AND flags->>'media_deck'='true' LIMIT 1`,
          [id]
        );
        const deck = rows[0] || null;
        let cameras = [];
        if (deck?.zone_id) {
          const { rows: cams } = await query(
            `SELECT * FROM furniture WHERE zone_id=$1 AND flags->>'broadcast_transmitter'='true'`,
            [deck.zone_id]
          );
          cameras = cams;
        }
        const { rows: mediaCameras } = await query(
          `SELECT mc.*, z.name AS zone_name FROM media_cameras mc
             LEFT JOIN zones z ON z.id = mc.zone_id
            WHERE mc.streaming_channel_id=$1`,
          [id]
        );
        return { status: 200, body: { deck, cameras, mediaCameras } };
      }
      // POST /broadcast/deck — spawn a media deck in a zone and link to channel
      if (!id && method === 'POST') {
        if (!devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };
        const { channel_id, zone_id, name, auto_place, no_camera } = body || {};
        if (!channel_id) return { status: 400, body: { error: 'channel_id is required' } };

        let targetZoneId = zone_id;
        let stageZoneId  = null;

        if (auto_place || !zone_id) {
          // Derive production zone from channel's studio_zone_id (stage floor) → exits.up
          const { rows: chRows } = await query(
            'SELECT studio_zone_id FROM media_channels WHERE id=$1', [channel_id]
          );
          if (!chRows.length) return { status: 404, body: { error: 'Channel not found' } };
          stageZoneId = chRows[0].studio_zone_id;
          if (!stageZoneId) return { status: 400, body: { error: 'Channel has no studio zone. Run studio setup first.' } };

          const { rows: stageRows } = await query('SELECT exits FROM zones WHERE id=$1', [stageZoneId]);
          const exits = stageRows[0]?.exits || {};
          targetZoneId = exits.up;
          if (!targetZoneId) return { status: 400, body: { error: 'No production room found (up from stage). Run studio setup first.' } };
        }
        if (!targetZoneId) return { status: 400, body: { error: 'zone_id required (or use auto_place: true)' } };

        // Reuse the channel's existing deck if it already has one — move/rename
        // it in place rather than orphaning it and spawning a duplicate.
        const { rows: existingDeckRows } = await query(
          `SELECT id, flags FROM furniture WHERE flags->>'channel_id'=$1 AND flags->>'media_deck'='true' LIMIT 1`,
          [channel_id]
        );
        let deckId;
        const ts = Date.now();
        if (existingDeckRows.length) {
          deckId = existingDeckRows[0].id;
          const dflags = _deckFlags(existingDeckRows[0]);
          await updateFurniture(deckId, { zone_id: targetZoneId, name: name || 'Media Deck' });
          // Ensure flags carry channel_id/media_deck even if an older row lost them
          dflags.media_deck = true;
          dflags.channel_id = channel_id;
          if (!Array.isArray(dflags.deck_cassettes)) dflags.deck_cassettes = [];
          await updateFurniture(deckId, { flags: JSON.stringify(dflags) });
        } else {
          deckId = `furn_deck_${channel_id}_${ts}`;
          await insertFurniture({
            id: deckId, zone_id: targetZoneId, name: name || 'Media Deck',
            description: 'Broadcast transmission hardware. Plays cassettes and routes live camera feeds.',
            flags: JSON.stringify({ media_deck: true, channel_id, deck_cassettes: [], deck_active: null }),
            power_draw_kw: 2.0, object_type: 'media_deck',
          });
        }
        await query(`UPDATE media_channels SET studio_zone_id=$1 WHERE id=$2`, [stageZoneId || targetZoneId, channel_id]);

        let cameraId = null;
        if (auto_place && stageZoneId && !no_camera) {
          // Create broadcast_transmitter furniture in stage zone
          const camFurnId = `furn_cam_${channel_id}_${ts}`;
          await insertFurniture({
            id: camFurnId, zone_id: stageZoneId, name: 'Studio Camera',
            description: 'Broadcast camera positioned on the stage floor.',
            flags: JSON.stringify({ broadcast_transmitter: true, channel_id }),
            object_type: 'camera',
          });
          // Register in media_cameras, streaming to this channel
          cameraId = `cam_${channel_id}_${ts}`;
          await query(
            `INSERT INTO media_cameras (id,zone_id,direction,is_powered,is_recording,is_streaming,streaming_channel_id,storage_limit,permissions,flags)
             VALUES ($1,$2,'south',1,0,1,$3,200,'public','{}')`,
            [cameraId, stageZoneId, channel_id]
          );
        }

        await loadChannelRuntimes();
        return { status: 201, body: { id: deckId, zone_id: targetZoneId, channel_id, camera_id: cameraId } };
      }
    }

    // ── Cassette: create a physical item for a broadcast and register it in the
    // channel's media deck library ────────────────────────────────────────────
    if (resource === 'cassette') {
      if (!id && method === 'POST') {
        if (!devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };
        const { broadcast_id, channel_id } = body || {};
        if (!broadcast_id) return { status: 400, body: { error: 'broadcast_id is required' } };

        const { rows: bcRows } = await query('SELECT name FROM media_broadcasts WHERE id=$1', [broadcast_id]);
        if (!bcRows.length) return { status: 404, body: { error: 'Broadcast not found' } };
        const broadcastName = bcRows[0].name;

        let itemId;
        try {
          itemId = await _ensureCassetteItem(broadcast_id, broadcastName);
        } catch (err) {
          if (err.code === 'CASSETTE_NAME_COLLISION') return { status: 409, body: { error: err.message } };
          throw err;
        }

        let invId = null;
        if (channel_id) {
          // Place the cassette directly into the linked deck's container and register it
          // in deck_cassettes so playback/scheduling can use it immediately.
          const { rows: deckRows } = await query(
            `SELECT id, flags FROM furniture WHERE flags->>'channel_id'=$1 AND flags->>'media_deck'='true' LIMIT 1`,
            [channel_id]
          );
          if (deckRows.length) {
            const deckId = deckRows[0].id;
            const dflags = _deckFlags(deckRows[0]);
            const cassettes = Array.isArray(dflags.deck_cassettes) ? [...dflags.deck_cassettes] : [];
            if (!cassettes.includes(broadcast_id)) {
              cassettes.push(broadcast_id);
              dflags.deck_cassettes = cassettes;
              await updateFurniture(deckId, { flags: JSON.stringify(dflags) });
            }
            // Insert item into the deck container (or update if it already exists there).
            const { rows: existingInv } = await query(
              `SELECT pi.id FROM player_inventory pi WHERE pi.container_id=$1 AND pi.item_id=$2 LIMIT 1`,
              [deckId, itemId]
            );
            if (existingInv.length) {
              invId = existingInv[0].id;
            } else {
              invId = randomUUID();
              await query(
                `INSERT INTO player_inventory (id, player_id, item_id, quantity, container_id) VALUES ($1,$2,$3,1,$4)`,
                [invId, `_deck_${deckId}`, itemId, deckId]
              );
            }
          }
        }

        return { status: 201, body: { item_id: itemId, inv_id: invId } };
      }
    }

    if (resource === 'graphics') {
      if (!id && method === 'GET') {
        const { rows } = await query('SELECT * FROM media_graphics ORDER BY name');
        return { status: 200, body: rows };
      }
      if (!id && method === 'POST') {
        const gid = body.id || `graphic_${Date.now()}`;
        await query(
          `INSERT INTO media_graphics (id,name,description,type,content,tags,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,EXTRACT(EPOCH FROM NOW()),EXTRACT(EPOCH FROM NOW()))`,
          [gid, body.name||'Untitled', body.description||'', body.type||'ascii',
           body.content||'', JSON.stringify(body.tags||[])]
        );
        await loadGraphicsCache();
        return { status: 201, body: { id: gid } };
      }
      if (id && method === 'PUT') {
        await query(
          `UPDATE media_graphics SET name=$1,description=$2,type=$3,content=$4,tags=$5,
           updated_at=EXTRACT(EPOCH FROM NOW()) WHERE id=$6`,
          [body.name||'Untitled', body.description||'', body.type||'ascii',
           body.content||'', JSON.stringify(body.tags||[]), id]
        );
        await loadGraphicsCache();
        return { status: 200, body: { id } };
      }
      if (id && method === 'DELETE') {
        if (auth?.role !== 'admin') return { status: 403, body: { error: 'Admin access required' } };
        await query('DELETE FROM media_graphics WHERE id=$1', [id]);
        await loadGraphicsCache();
        return { status: 200, body: { message: 'Deleted' } };
      }
    }
  } catch (err) {
    return { status: 400, body: { error: err.message } };
  }

  // ── Recalculate NPC work schedules ────────────────────────────────────────
  if (resource === 'recalculate-schedules' && method === 'POST') {
    if (!devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };
    const { updatedItems, updatedNpcs } = await recalculateNpcSchedules();
    return { status: 200, body: { message: `Updated ${updatedItems} schedule item(s), ${updatedNpcs} NPC behaviour graph(s).` } };
  }

  return null;
};

// ── Startup ──────────────────────────────────────────────────────────────────

await loadChannelRuntimes();
await loadZoneTunings();
await loadGraphicsCache();
schedule('1s', broadcastTick);   // BROADCAST_TICK_MS

// Register _tvfreq as a silent internal command (not listed in plugin.json, invisible to HELP)
registerCommand('_tvfreq', cmdTvFreq);
registerCommand('_restartbroadcast', cmdRestartBroadcast);

// `guess` — the game-show answer verb. gameshow.js owns the parsing and scoring; it needs
// to know which channels are staging a show in the room the player is standing in, and
// channelRuntime lives here, so the lookup is injected rather than imported (which would
// be circular).
registerCommand('guess', makeGuessCommand((zoneId) => {
  if (!zoneId) return [];
  const out = [];
  for (const [channelId, state] of channelRuntime) {
    if (state.studioZoneId === zoneId) out.push({ channelId, studioZoneId: zoneId });
  }
  return out;
}));

// The studio audience door: a doorman NPC checking dated passes on the way into
// a live taping. Everything it needs lives in this file's runtime maps, so it's
// injected rather than imported (which would be circular).
installAudienceGate({
  channelRuntime, studioZoneIndex, sportsSlotIndex, gamesPerDay: SPORTS_GAMES_PER_DAY,
  registerMoveGate, registerPurchaseStamp, getEnvironmentState, getZoneNpcs, getZone,
  resolveInventoryItem,
});

console.log(`[broadcast] Plugin loaded. ${channelRuntime.size} channel(s), ${zoneTunings.size} tuned zone(s), ${graphicsCache.size} graphic(s).`);
