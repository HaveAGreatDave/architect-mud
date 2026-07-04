import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { world, getZonePlayers, getZone, getZoneNpcs, getZoneEnemies, reloadZone } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on, emit } from '../../server/engine/events.js';
import { registerAction } from '../../server/engine/actions.js';
import { registerCommand } from '../../server/engine/plugins.js';
import { apiDeleteZone } from '../../server/api/routes.js';
import { registerViewerChecker, registerNpcScheduleChecker, registerNpcStudioZoneLookup, hasChannelViewers, isNpcScheduledNow, getNpcStudioZone } from '../../server/engine/broadcast-bridge.js';
import { registerAICondition, registerAIAction } from '../../server/engine/ai-behaviour.js';
import { getEnvironmentState, recomputePower, resyncAllLightingStates, fixZonePowerConnections, fixBuildingPowerConnections } from '../../server/engine/environment.js';
import { getSongDefByName, getSfxDefByName, getAmbientDefByName } from '../audio/index.js';

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
// deckWatchers.get(playerId) = channelId — players with the mediadeck preview open.
const deckWatchers = new Map();
// deckRecent.get(channelId) = last few formatted lines, so a freshly-opened deck
// preview shows the current program immediately instead of a blank screen.
const deckRecent = new Map();
const DECK_RECENT_MAX = 8;
function _recordDeckMessage(channelId, message) {
  if (!channelId || !message) return;
  const ring = deckRecent.get(channelId) || [];
  ring.push(message);
  while (ring.length > DECK_RECENT_MAX) ring.shift();
  deckRecent.set(channelId, ring);
}

on('tv.watch',   ({ playerId, channelId }) => tvWatchers.set(playerId, channelId));
on('tv.unwatch', ({ playerId }) => {
  const channelId = tvWatchers.get(playerId);
  tvWatchers.delete(playerId);
  if (channelId) powerOffWatchedTv(playerId, channelId).catch(err => console.error('[broadcast] powerOffWatchedTv error:', err.message));
});

// Powering the TV off (closing the panel) turns the shared set off for the whole
// room: untune the device so ambient TV lines stop, tell the room, and close any
// co-watcher's still-open panel. Mirrors `tune 0` plus a room announcement.
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
  // Seed the preview with recent lines so it isn't blank until the next tick.
  for (const line of (deckRecent.get(channelId) || []))
    sendToPlayer(playerId, { type: 'deck_broadcast', message: line, channel: channelId, style: 'raw' });
});
on('deck.unwatch', ({ playerId })            => deckWatchers.delete(playerId));
on('player.logout', ({ id })              => { tvWatchers.delete(id); deckWatchers.delete(id); });

// studioZoneIndex.get(studioZoneId) = channelId
// Enables O(1) lookup in zone.broadcast relay listener.
const studioZoneIndex = new Map();

// cameraZoneStatus.get(zoneId) = true if at least one camera in that zone is
// powered and undamaged. Refreshed alongside loadChannelRuntimes().
const cameraZoneStatus = new Map();

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
    `SELECT p.start_time, p.broadcast_id, b.name AS broadcast_name, b.playback_mode, b.broadcast_graph
       FROM media_channel_playlist p JOIN media_broadcasts b ON b.id=p.broadcast_id
      WHERE p.channel_id=$1 ORDER BY p.start_time`, [channelId]
  );
  let scanned = 0;
  for (const item of items) {
    const label = item.broadcast_name || item.broadcast_id;
    if (item.playback_mode === 'weather') { add('info', 'weather_live', `'${label}' is a weather forecast — assembled live, not statically scannable.`, { broadcast: label }); continue; }
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
      if (node.type === 'music' && d.song && !getSongDefByName(d.song)) add('info', 'missing_song', `'${label}': song '${d.song}' not found — falls back to cue text or is skipped.`, { broadcast: label, node: nid });
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
  if (bc.override_duration) return bc.override_duration;
  // Weather graphs are assembled live from the forecast (not baked in the DB), so
  // there's nothing to measure here — give the slot a sane default airtime.
  if (bc.playback_mode === 'weather') return 120;
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
    else if (node.type === 'title_card') total += node.data?.duration ?? 10;
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
      `SELECT p.*, b.name AS broadcast_name, b.playback_mode, b.messages, b.message_interval, b.override_duration, b.loop, b.broadcast_graph, b.fallback_messages, b.weather_pools
         FROM media_channel_playlist p
         LEFT JOIN media_broadcasts b ON b.id = p.broadcast_id
        ORDER BY p.channel_id, p.start_time`
    );
    const { rows: cams } = await query(
      'SELECT id, zone_id, streaming_channel_id FROM media_cameras WHERE is_streaming = 1 AND is_powered = 1'
    );
    const { rows: allCams } = await query(
      'SELECT zone_id, is_powered, is_damaged FROM media_cameras'
    );
    cameraZoneStatus.clear();
    for (const cam of allCams) {
      const working = !!cam.is_powered && !cam.is_damaged;
      if (working) cameraZoneStatus.set(cam.zone_id, true);
      else if (!cameraZoneStatus.has(cam.zone_id)) cameraZoneStatus.set(cam.zone_id, false);
    }
    const { rows: allCommercials } = await query(
      `SELECT id, messages, message_interval FROM media_broadcasts WHERE category = 'advertisement'`
    );
    const commercialMap = new Map();
    for (const ad of allCommercials) {
      commercialMap.set(ad.id, {
        id: ad.id,
        messages: Array.isArray(ad.messages) ? ad.messages : (ad.messages ? JSON.parse(ad.messages) : []),
        message_interval: ad.message_interval || 5,
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
      const dur = item.duration_override || broadcastDuration(item);
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
      playlistByChannel.get(item.channel_id).push({
        id: item.id,
        broadcastId: item.broadcast_id,
        broadcastName: item.broadcast_name || null,
        slotType: item.slot_type || 'broadcast',
        startTime: item.start_time,
        duration: dur,
        playback_mode: item.playback_mode,
        weatherPools: weatherScript?.pools || null,
        weatherHost: weatherScript?.host || null,
        weatherTitle: weatherScript?.title || null,
        messages: Array.isArray(item.messages) ? item.messages : (item.messages ? JSON.parse(item.messages) : []),
        message_interval: item.message_interval || 5,
        loop: item.loop,
        broadcastGraph,
        fallbackMessages: Array.isArray(item.fallback_messages) ? item.fallback_messages : (item.fallback_messages ? JSON.parse(item.fallback_messages) : []),
        npcStaff: Array.isArray(cond?.npc_staff) ? cond.npc_staff : [],
      });
    }

    channelRuntime.clear();
    studioZoneIndex.clear();
    for (const ch of channels) {
      if (ch.studio_zone_id) studioZoneIndex.set(ch.studio_zone_id, ch.id);
      const pl = playlistByChannel.get(ch.id) || [];
      // Studio staffing only applies to LIVE channels and WEATHER forecasts. A scripted
      // show's npc_anchor nodes are speaker attribution, not a cue for the NPC to appear
      // on-stage — so the AI schedule/studio lookups must never see them as staff.
      for (const it of pl) {
        if (ch.channel_type !== 'live' && it.playback_mode !== 'weather') it.npcStaff = [];
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
        commercialIndex: 0,
        _commercialCycleCount: 0,
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

// Round-robin through commercial pool for break slots
function _playCommercial(state, nowMs) {
  const ads = state.commercialBroadcasts || [];
  if (!ads.length) return null;
  const adIdx = (state.commercialIndex || 0) % ads.length;
  const ad = ads[adIdx];
  if (!ad?.messages?.length) {
    state.commercialIndex = adIdx + 1;
    return null;
  }
  const elapsed = (nowMs / 1000) % (ad.messages.length * (ad.message_interval || 5));
  const result = getScriptedMessage(ad.messages, ad.message_interval || 5, elapsed);
  // Advance to next commercial once we've completed a cycle
  const cycleDone = Math.floor((nowMs / 1000) / (ad.messages.length * (ad.message_interval || 5)));
  if (cycleDone > (state._commercialCycleCount || 0)) {
    state._commercialCycleCount = cycleDone;
    state.commercialIndex = adIdx + 1;
  }
  if (result) return { text: result.text, key: `commercial:${ad.id}:${result.idx}` };
  return null;
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

function wxSevereChannel(d) {
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
  say(wxPick(pools, `sky.${today.weatherType}`), today, 0, 'Conditions right now: {weather}, {temp} degrees.');
  say(wxPick(pools, `temp.${wxTempBand(today.tempC)}`), today, 0);
  const twBand = wxWindBand(today.windKph);
  if (['calm', 'windy', 'strong', 'gale'].includes(twBand)) say(wxPick(pools, `wind.${twBand}`), today, 0);
  const thBand = wxHumidBand(today.humidityPct);
  if (thBand === 'dry' || thBand === 'oppressive') say(wxPick(pools, `humid.${thBand}`), today, 0);
  if ((today.severity ?? 0) >= WX_SEVERE) say(wxPick(pools, `warn.${wxSevereChannel(today)}`, 'warn.generic'), today, 0);

  say(wxPick(pools, 'forecast.lead'), today, 0);
  for (let i = 1; i < forecast.length; i++) {
    const day = forecast[i];
    say(wxPick(pools, `ahead.${wxLeadKey(i)}`, 'ahead.next'), day, i);
    say(wxPick(pools, `sky.${day.weatherType}`), day, i, '{day}: {weather}, around {temp} degrees.');
    if ((day.severity ?? 0) >= WX_SEVERE) say(wxPick(pools, `warn.${wxSevereChannel(day)}`, 'warn.generic'), day, i);
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

async function getCurrentMessage(state, nowMs) {
  const { channelType, playlist, totalDuration, idleBroadcast, newsCategories, camera, loopOriginMs, scheduleMode } = state;

  // Dynamic news channels: pop from queue — but if a VINE-graph item is active, let the graph manage it
  if (channelType === 'news') {
    const elapsed = playlist.length && totalDuration > 0 ? ((nowMs - loopOriginMs) / 1000) % totalDuration : -1;
    const activeItem = elapsed >= 0 ? playlist.find(i => elapsed >= i.startTime && elapsed < i.startTime + i.duration) : null;
    if (activeItem?.broadcastGraph) return tickBroadcastGraph(state.channelId, activeItem.broadcastGraph, state, nowMs);
    const q = newsQueue.get(state.channelId) || [];
    const item = q.shift();
    return item ? { text: item.text, key: `news:${item.ts}` } : null;
  }

  // Daily schedule mode — start_time is seconds from midnight (0–86399)
  // Checked before live camera so VINE graphs always tick for live+daily channels.
  if (scheduleMode === 'daily' && playlist.length) {
    const { minutes } = getEnvironmentState();
    const gameSecondsSinceMidnight = minutes * 60;
    const item = playlist.find(i => gameSecondsSinceMidnight >= i.startTime && gameSecondsSinceMidnight < i.startTime + i.duration);
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
      if (item.broadcastGraph) {
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
      // Weather — assemble a fresh graph from the live forecast, then walk it
      if (item.playback_mode === 'weather') {
        const wxGraph = getWeatherGraph(item);
        if (wxGraph) {
          state.currentFallbackMessages = item.fallbackMessages || [];
          return tickBroadcastGraph(state.channelId, wxGraph, state, nowMs);
        }
      }
      // VINE graph (scripted/news with broadcast_graph) — walker manages its own timing
      if (item.broadcastGraph) {
        state.currentFallbackMessages = item.fallbackMessages || [];
        return tickBroadcastGraph(state.channelId, item.broadcastGraph, state, nowMs);
      }
      // scripted flat list
      const segElapsed = elapsed - item.startTime;
      const result = getScriptedMessage(item.messages, item.message_interval, segElapsed);
      if (result) return { text: result.text, key: `${item.broadcastId}:${result.idx}` };
      return null;
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

// Cache: zoneId → { broadcastId, messages, message_interval, fetchedAt }
const _deckCache = new Map();
const _DECK_CACHE_TTL = 10000; // 10s

async function _getDeckMessage(zoneId, nowMs) {
  let entry = _deckCache.get(zoneId);
  if (!entry || nowMs - entry.fetchedAt > _DECK_CACHE_TTL) {
    const { rows } = await query(
      `SELECT flags FROM furniture WHERE zone_id=$1 AND flags::text LIKE '%"media_deck"%' LIMIT 1`,
      [zoneId]
    ).catch(() => ({ rows: [] }));
    const dflags = rows[0] ? (typeof rows[0].flags === 'object' ? rows[0].flags : JSON.parse(rows[0].flags || '{}')) : null;
    const activeId = dflags?.deck_active || null;
    if (activeId) {
      const { rows: bcRows } = await query('SELECT messages, message_interval FROM media_broadcasts WHERE id=$1', [activeId]).catch(() => ({ rows: [] }));
      const bc = bcRows[0];
      entry = bc
        ? { broadcastId: activeId, messages: Array.isArray(bc.messages) ? bc.messages : (bc.messages ? JSON.parse(bc.messages) : []), message_interval: bc.message_interval || 5, fetchedAt: nowMs }
        : { broadcastId: null, messages: [], message_interval: 5, fetchedAt: nowMs };
    } else {
      entry = { broadcastId: null, messages: [], message_interval: 5, fetchedAt: nowMs };
    }
    _deckCache.set(zoneId, entry);
  }
  if (!entry.broadcastId || !entry.messages.length) return null;
  const elapsed = (nowMs / 1000) % (entry.messages.length * entry.message_interval);
  const result = getScriptedMessage(entry.messages, entry.message_interval, elapsed);
  return result ? { text: result.text, key: `deck:${entry.broadcastId}:${result.idx}` } : null;
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

async function broadcastTick() {
  const nowMs = Date.now();
  // Channels the zone loop below will drive this tick (a tuned zone with players).
  // The deck-preview pass skips these so the stateful graph walker isn't advanced
  // twice in one tick.
  const activeChannels = new Set();
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
        if (state.wasActive) {
          state.wasActive = false;
          const offAir = _offAirMessage(state, channelId);
          for (const player of players) {
            if (tvWatchers.get(player.id) === channelId) sendToPlayer(player.id, offAir);
          }
        }
        continue;
      }

      let result;
      try {
        // Media deck check: a loaded cassette in this zone overrides channel content
        const deckResult = await _getDeckMessage(zoneId, nowMs);
        result = deckResult || await getCurrentMessage(state, nowMs);
      } catch (err) {
        console.error(`[broadcast] tick error (${channelId}):`, err.message);
        continue;
      }
      if (!result || result.key === state.lastMsgKey) {
        // null during a wait node means the graph is still running — don't trigger off_air
        const stillWaiting = !result && state.graphBlackboard?.waitUntil > nowMs;
        if (!stillWaiting && state.wasActive) {
          state.wasActive = false;
          const offAir = _offAirMessage(state, channelId);
          for (const player of players) {
            if (tvWatchers.get(player.id) === channelId)
              sendToPlayer(player.id, offAir);
          }
        }
        continue;
      }
      state.wasActive = true;
      state.lastMsgKey = result.key;

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
      const isMusic = result.style === 'music' && result.song;
      if (!formatted && !isMusic) continue;

      const programName = result.programName ?? state.currentProgramName ?? null;

      // Split players: those watching this channel get the full panel message;
      // anyone else in a tuned zone overhears a spoken line as ambient background TV
      // (once per new message, per the lastMsgKey guard above — not every tick).
      for (const player of players) {
        if (tvWatchers.get(player.id) === channelId) {
          if (formatted) sendToPlayer(player.id, { type: 'broadcast', message: formatted, channel: channelId, style: result.style || 'raw', programName, ...(result.duration != null ? { duration: result.duration } : {}) });
          if (isMusic) sendToPlayer(player.id, { type: 'audio_music', def: result.song });
        } else if (result.speech) {
          sendToPlayer(player.id, { type: 'broadcast_ambient', speechText: result.speechText, channel: channelId });
        }
        // Deck preview — independent of TV panel subscription
        if (deckWatchers.get(player.id) === channelId && formatted) {
          sendToPlayer(player.id, { type: 'deck_broadcast', message: formatted, channel: channelId, style: result.style || 'raw' });
        }
      }
      if (formatted) _recordDeckMessage(channelId, formatted);
      emit('broadcast.message', { channelId, zoneId, text: result.text });
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
    let result;
    try {
      const deckResult = state.deckZoneId ? await _getDeckMessage(state.deckZoneId, nowMs) : null;
      result = deckResult || await getCurrentMessage(state, nowMs);
    } catch (err) {
      console.error(`[broadcast] deck-preview tick error (${channelId}):`, err.message);
      continue;
    }
    if (!result || result.key === state.lastMsgKey) continue;
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
  const { minutes } = getEnvironmentState();
  const gameSecs = (minutes ?? 0) * 60;
  const nowMs = Date.now();
  for (const state of channelRuntime.values()) {
    let item = null;
    if (state.scheduleMode === 'daily') {
      item = state.playlist.find(i => gameSecs >= i.startTime && gameSecs < i.startTime + i.duration);
    } else if (state.playlist.length && state.totalDuration > 0) {
      // Loop/mixed/emergency: find which playlist item is currently playing
      const elapsed = ((nowMs - state.loopOriginMs) / 1000) % state.totalDuration;
      item = state.playlist.find(i => elapsed >= i.startTime && elapsed < i.startTime + i.duration);
    }
    if (item?.npcStaff?.includes(npcId)) return true;
  }
  return false;
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
  const { minutes } = getEnvironmentState();
  const gameSecs = (minutes ?? 0) * 60;
  const nowMs = Date.now();
  let item = null;
  if (state.scheduleMode === 'daily') {
    item = state.playlist.find(i => gameSecs >= i.startTime && gameSecs < i.startTime + i.duration);
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
  if (!state || state.channelType !== 'live') return;
  // Only relay player-visible events (speech, say, zone_event) — not combat or system messages
  if (msg.type !== 'output' && msg.type !== 'zone_event' && msg.type !== 'say') return;
  if (!msg.message) return;
  const sentDeck = new Set();
  _recordDeckMessage(channelId, msg.message);
  for (const [viewZoneId, channelMap] of zoneTunings) {
    if (!channelMap.has(channelId)) continue;
    const players = getZonePlayers(viewZoneId);
    for (const player of players) {
      sendToPlayer(player.id, { type: 'broadcast', message: msg.message, channel: channelId, style: 'raw' });
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
  state.wasActive = true;
});

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
async function recalculateNpcSchedules() {
  const { rows: plItems } = await query(`
    SELECT p.id, p.channel_id, p.broadcast_id, p.conditions,
           b.broadcast_graph, b.playback_mode,
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

    // Only LIVE channels and WEATHER forecasts physically staff the studio. For a
    // scripted show, npc_anchor is speaker attribution only — never staff it, and
    // strip any stale staffing a previous (buggy) pass merged into its conditions.
    const staffsNpcs = row.channel_type === 'live' || row.playback_mode === 'weather';
    const studioZoneId = row.studio_zone_id || null;

    // Reconcile npc_staff in the item's conditions (merge for live/weather, clear otherwise)
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

    // Assign default behaviour graph (with studio zone) to any staff NPC, and
    // ensure work_zone_id points at the studio so GO_TO_WORK resolves.
    const defaultGraph = JSON.stringify(makeDefaultStudioGraph(studioZoneId));
    for (const npcId of npcIds) {
      liveStaff.set(npcId, studioZoneId);
      // Always overwrite — ensures zone_id is populated even for existing graphs; set work_zone_id so GO_TO_WORK resolves without graph params
      const { rowCount } = await query(
        `UPDATE npcs SET behaviour_graph=$1, work_zone_id=COALESCE(work_zone_id,$2) WHERE id=$3`,
        [defaultGraph, studioZoneId, npcId]
      ).catch(() => ({ rowCount: 0 }));
      if (rowCount) {
        updatedNpcs++;
        const npc = world.npcs.get(npcId);
        if (npc && !npc.work_zone_id) npc.work_zone_id = studioZoneId;
      }
    }

    // Re-inject work-phase actions from the broadcast graph
    await _injectWorkPhaseForPlaylistItem({ broadcast_id: row.broadcast_id, npcStaff: npcIds, studioZoneId });
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
    case 'RANDOM_CHANCE':
      return Math.random() < (params.chance ?? 0.5);
    default:
      return false;
  }
}

// Walk the VINE graph for one tick. Returns { text, key, style } or null.
// Broadcast tick interval — the graph walker (tickBroadcastGraph) emits at most one
// message per tick, so on-air a node occupies a whole tick even if its hold is shorter.
const BROADCAST_TICK_MS = 5000;

// Canonical on-air hold (ms) for a content node, before tick-quantization. This is the
// single source of truth for how long each node type stays up, shared by the live walker
// (tickBroadcastGraph sets bb.waitUntil = nowMs + nodeHoldMs(node)) and the late-tune
// seeker (_seekGraph) — so a viewer tuning in mid-program lands where playback actually is.
function nodeHoldMs(node) {
  const d = node.data || {};
  switch (node.type) {
    case 'npc_action':
    case 'event':
      return 3000;
    case 'music':
      return getSongDefByName(d.song) ? 8000 : 5000;
    case 'title_card':
      return (d.duration ?? 10) * 1000;
    case 'wait':
      return (d.seconds ?? 5) * 1000;
    case 'credits':
    case 'tech_difficulties':
      return (d.duration ?? 10) * 1000;
    case 'show_overlay':
    case 'overlay': {
      const overlayType = d.overlayType || d.overlay_type
        || (node.type === 'overlay' && !d.graphic_id ? 'text_card' : 'lower_third');
      return (d.duration_s ?? (overlayType === 'text_card' ? 5 : 6)) * 1000;
    }
    default:
      return 5000; // say, ticker, camera_cut, title_card, …
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
  for (let step = 0; step < 2000 && remaining > 0; step++) {
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
      bb.npcAnchor = npc?.name || npcId || null;
      bb.npcAnchorId = npcId || null;
      nodeId = _resolveEdge(edges, nodeId, 'next');
    } else {
      nodeId = _resolveEdge(edges, nodeId, 'next'); // start/condition — no time cost
    }
  }
  bb.currentNode = nodeId || null;
}

function tickBroadcastGraph(channelId, graph, state, nowMs, segElapsedSec = 0) {
  if (!state.graphBlackboard) return null;
  const bb = state.graphBlackboard;
  // A broadcast is "acted live" when it runs on a live channel OR the graph demands a
  // present host (weather forecasts set graph._requireHost). Such broadcasts are
  // presence-gated — the host NPC must be in the studio or the channel falls to
  // camera-idle → technical difficulties — and their lines are spoken in the studio.
  const liveActed = state.channelType === 'live' || !!graph._requireHost;
  // Scripted daily-schedule content plays through with no host gating — unless the
  // graph explicitly requires a present host (weather), which is gated everywhere.
  const skipPresence = state.scheduleMode === 'daily' && !graph._requireHost;

  // Reset blackboard if a different broadcast is now active
  if (bb.activeBroadcastId !== graph._broadcastId) {
    bb.currentNode = null;
    bb.waitUntil = null;
    bb.npcAnchor = null;
    bb.npcAnchorId = null;
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

  // Tech-diff / camera-idle only apply to truly-live unscripted channels
  if (!skipPresence) {
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
    if (bb.hostAbsent && bb.absentDetectedAt) {
      const elapsed = nowMs - bb.absentDetectedAt;
      if (elapsed < 60_000) {
        const snap = state.studioZoneId ? buildCameraSnapshot(state.studioZoneId) : null;
        bb.waitUntil = nowMs + 5000;
        return snap
          ? { text: `[CAM: studio] ${snap}`, key: `absent-cam:${channelId}:${nowMs}`, style: 'raw' }
          : null;
      }
      bb.techDiffMode = true;
      return _techDiffMessage(state, channelId, nowMs);
    }
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
        const raw = node.data?.text || '';
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        bb.waitUntil = nowMs + nodeHoldMs(node);
        const key_say = `graph:${channelId}:${nodeId}:${nowMs}`;
        const style_say = node.data?.style || 'raw';
        const isNarration = style_say === 'narration';
        const isAmbient   = style_say === 'ambient';
        if (liveActed && state.studioZoneId) {
          if (!isNarration && !isAmbient && bb.npcAnchor) {
            sendToZone(state.studioZoneId, {
              type: 'output',
              message: `<span style="color:var(--yellow)">${bb.npcAnchor} says, "${raw}"</span>`,
            });
          } else if (isAmbient) {
            sendToZone(state.studioZoneId, {
              type: 'output',
              message: `<span style="color:var(--text-dim);font-style:italic">${raw}</span>`,
            });
          }
        }
        const text_say = style_say === 'ticker'
          ? `>> ${bb.npcAnchor ? `${bb.npcAnchor}: ` : ''}${raw} <<`
          : (!isNarration && !isAmbient && bb.npcAnchor ? `${bb.npcAnchor} says, "${raw}"` : raw);
        const isSpeech = !isNarration && !isAmbient && style_say !== 'ticker' && !!bb.npcAnchor;
        return { text: text_say, key: key_say, style: 'raw', ...(isSpeech ? { speech: true, speechText: text_say } : {}) };
      }

      case 'music': {
        const songName = node.data?.song || '';
        const text = node.data?.text || '';
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        const songDef = getSongDefByName(songName);
        const key_music = `music:${channelId}:${nodeId}:${nowMs}`;
        if (songDef) {
          bb.waitUntil = nowMs + nodeHoldMs(node);
          if (liveActed && state.studioZoneId) {
            sendToZone(state.studioZoneId, { type: 'audio_music', def: songDef });
          }
          return { text, song: songDef, key: key_music, style: 'music' };
        }
        logBroadcast(channelId, 'info', `Song '${songName}' not found — ${text ? 'showing cue text' : 'skipped'}`, nodeId);
        if (!text) { nodeId = bb.currentNode; bb.waitUntil = null; break; }
        bb.waitUntil = nowMs + nodeHoldMs(node);
        return { text, key: key_music, style: 'raw' };
      }

      case 'npc_action': {
        const emote = node.data?.message || node.data?.action || '';
        if (!emote) { nodeId = _resolveEdge(edges, nodeId, 'next'); break; }
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        bb.waitUntil = nowMs + nodeHoldMs(node);
        const key_act = `action:${channelId}:${nodeId}:${nowMs}`;
        const emoteText = bb.npcAnchor ? `${bb.npcAnchor} ${emote}` : emote;
        if (state.channelType === 'live' && state.studioZoneId) {
          sendToZone(state.studioZoneId, { type: 'output', message: `<span style="color:var(--text-dim);font-style:italic">${emoteText}</span>` });
        }
        return { text: emoteText, key: key_act, style: 'raw' };
      }

      case 'ticker': {
        if (bb.hostAbsent) { nodeId = _resolveEdge(edges, nodeId, 'next'); break; }
        const text = `>> ${node.data?.text || ''} <<`;
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        bb.waitUntil = nowMs + nodeHoldMs(node);
        return { text, key: `ticker:${channelId}:${nodeId}`, style: 'ticker' };
      }

      case 'npc_anchor': {
        const npcId = node.data?.npc_id;
        const npc = world.npcs?.get(npcId);
        const fallbackName = npcId?.startsWith('npc_')
          ? npcId.slice(4).split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
          : npcId;
        bb.npcAnchor = npc?.name || fallbackName || null;
        bb.npcAnchorId = npcId || null;
        // Presence check — for live channels and any host-required graph (weather)
        if (!skipPresence && npcId && liveActed && state.studioZoneId) {
          const zone = getZone(state.studioZoneId);
          if (zone?.npcs?.has(npcId)) {
            bb.hostAbsent = false;
          } else if (!bb.hostAbsent) {
            bb.hostAbsent = true;
            bb.absentDetectedAt = nowMs;
          }
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
        // cameraZoneStatus is `false` only when the zone has a registered camera that's
        // off/damaged — a zone with no camera device at all is left ungated (legacy behavior).
        const camDown = zoneId && cameraZoneStatus.get(zoneId) === false;
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        if (camDown && zoneId === state.studioZoneId && !skipPresence) {
          // The studio's own camera feed is down — go to technical difficulties
          // rather than silently cutting to the next node.
          bb.techDiffMode = true;
          return _techDiffMessage(state, channelId, nowMs);
        }
        const snap = (zoneId && !camDown) ? buildCameraSnapshot(zoneId) : null;
        if (snap) {
          bb.waitUntil = nowMs + nodeHoldMs(node);
          return { text: `[CAM: ${label}] ${snap}`, key: `cam:${channelId}:${zoneId}:${nowMs}`, style: 'raw' };
        }
        nodeId = bb.currentNode;
        break;
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
        if (flag) query(
          `INSERT INTO world_flags (key,value,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2,updated_at=NOW()`,
          [flag, value ?? 'true']
        ).catch(() => {});
        nodeId = _resolveEdge(edges, nodeId, 'next');
        break;
      }

      case 'title_card': {
        const gid = node.data?.graphic_id;
        const graphic = gid ? graphicsCache.get(gid) : null;
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        bb.waitUntil = nowMs + nodeHoldMs(node);
        if (graphic) {
          const caption = node.data?.caption ? `\n${node.data.caption}` : '';
          return { text: graphic.content + caption, key: `graphic:${channelId}:${gid}:${nowMs}`, style: graphicStyle(graphic) };
        }
        // Graphic not found — log it, show nothing, move on to the next node.
        logBroadcast(channelId, 'warn', `Title-card graphic '${gid || '(none)'}' not found — skipped`, nodeId);
        nodeId = bb.currentNode;
        bb.waitUntil = null;
        break;
      }

      case 'credits': {
        const creditsText = node.data?.text || '';
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
          clearScreen: overlayType === 'text_card',
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
          sendToZone(state.studioZoneId, { type: 'output', message: `<span style="color:var(--text-dim);font-style:italic">${evText}</span>` });
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
    await query('UPDATE furniture SET flags=$1 WHERE id=$2', [JSON.stringify(flags), device.id]);
    return { status: 'off' };
  }

  const { rows: chRows } = await query('SELECT * FROM media_channels WHERE number=$1 AND enabled=1', [channelNumber]);
  if (!chRows.length) return { status: 'not_found' };
  const channel = chRows[0];

  flags.tuned_channel = channelNumber;
  flags.tv_dial_freq = channelNumber;
  await query('UPDATE furniture SET flags=$1 WHERE id=$2', [JSON.stringify(flags), device.id]);

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

// ── Media Deck: load/eject cassettes ─────────────────────────────────────────

async function _findDeckInZone(zoneId) {
  const { rows } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND flags::text LIKE '%"media_deck"%' LIMIT 1`,
    [zoneId]
  );
  return rows[0] || null;
}

function _deckFlags(deck) {
  return typeof deck.flags === 'object' ? { ...deck.flags } : JSON.parse(deck.flags || '{}');
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

  // Strip the leading "cassette" keyword from args to get an optional name filter.
  const nameFilter = args.filter(a => a.toLowerCase() !== 'cassette').join(' ').trim().toLowerCase();

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
  const broadcastId = cassette.tags?.broadcast_id || cassette.flags?.broadcast_id;
  if (!broadcastId) return { type: 'output', message: 'That cassette has no broadcast loaded.' };
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

  await query('UPDATE furniture SET flags=$1 WHERE id=$2', [JSON.stringify(dflags), deck.id]);
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
  const { rows: existing } = await query('SELECT tags FROM items WHERE id=$1', [itemId]);
  if (existing.length) {
    const existingBroadcastId = existing[0].tags?.broadcast_id;
    if (existingBroadcastId && existingBroadcastId !== broadcastId) {
      const err = new Error(`A cassette named "${broadcastName}" already exists for a different broadcast. Rename the broadcast to create a distinct cassette.`);
      err.code = 'CASSETTE_NAME_COLLISION';
      throw err;
    }
  }
  await query(
    `INSERT INTO items (id, name, description, type, subtype, weight, value, is_stackable, is_unique, tags)
     VALUES ($1,$2,$3,'media','cassette',100,0,0,1,$4)
     ON CONFLICT (id) DO UPDATE SET name=$2, tags=$4`,
    [itemId, `Cassette: ${broadcastName}`, `A media cassette labeled "${broadcastName}".`,
     JSON.stringify({ media_cassette: true, broadcast_id: broadcastId })]
  );
  return itemId;
}

async function cmdEjectCassette(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const deck = await _findDeckInZone(player.current_zone);
  if (!deck) return { type: 'output', message: 'There is no media deck here.' };
  const dflags = _deckFlags(deck);
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
  await query('UPDATE furniture SET flags=$1 WHERE id=$2', [JSON.stringify(dflags), deck.id]);
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
  const cassettes = Array.isArray(dflags.deck_cassettes) ? dflags.deck_cassettes : [];
  if (!cassettes.includes(broadcastId)) return { type: 'output', message: 'That cassette is not in this deck.' };
  dflags.deck_active = broadcastId;
  await query('UPDATE furniture SET flags=$1 WHERE id=$2', [JSON.stringify(dflags), deck.id]);
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
      .filter(Boolean);
    // Prune dangling cassette ids whose broadcast was deleted, so stale
    // raw ids (e.g. "bc_1234567890") don't linger in the deck's library.
    if (cassettes.length !== cassetteIds.length) {
      dflags.deck_cassettes = cassettes.map(c => c.id);
      if (dflags.deck_active && !dflags.deck_cassettes.includes(dflags.deck_active)) dflags.deck_active = null;
      await query('UPDATE furniture SET flags=$1 WHERE id=$2', [JSON.stringify(dflags), deck.id]);
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
  const { rows } = await query(
    `SELECT id, name FROM furniture WHERE zone_id=$1 AND flags::text LIKE '%"media_deck"%'${nameHint ? ' AND name ILIKE $2' : ''} LIMIT 1`,
    nameHint ? [player.current_zone, `%${nameHint}%`] : [player.current_zone]
  );
  if (!rows.length) return undefined;
  return buildMediaDeckPanel(rows[0].id, player);
}

// ── Media Deck schedule-sync tick ─────────────────────────────────────────────
// Keeps a deck's active cassette aligned with the channel's current playlist
// slot, when that slot's broadcast is already in the deck's library. A deck
// with no matching cassette in its library is left alone (no auto-load of
// untouched/never-inserted tapes).
async function mediaDeckSyncTick() {
  const { rows: decks } = await query(
    `SELECT id, flags FROM furniture WHERE flags::text LIKE '%"media_deck"%'`
  );
  if (!decks.length) return;
  const { minutes } = getEnvironmentState();
  const gameSecondsSinceMidnight = minutes * 60;

  for (const deck of decks) {
    const dflags = _deckFlags(deck);
    const channelId = dflags.channel_id;
    const cassettes = Array.isArray(dflags.deck_cassettes) ? dflags.deck_cassettes : [];
    if (!channelId || !cassettes.length) continue;

    const { rows: plRows } = await query(
      `SELECT broadcast_id, start_time, COALESCE(duration_override, 300) AS duration
         FROM media_channel_playlist WHERE channel_id=$1 ORDER BY start_time`,
      [channelId]
    );
    const slot = plRows.find(p => gameSecondsSinceMidnight >= p.start_time && gameSecondsSinceMidnight < p.start_time + p.duration);
    if (!slot?.broadcast_id) continue;
    if (!cassettes.includes(slot.broadcast_id)) continue;
    if (dflags.deck_active === slot.broadcast_id) continue;

    dflags.deck_active = slot.broadcast_id;
    await query('UPDATE furniture SET flags=$1 WHERE id=$2', [JSON.stringify(dflags), deck.id]).catch(() => {});
  }
}

setInterval(() => mediaDeckSyncTick().catch(e => console.error('[broadcast] media deck sync error:', e.message)), 30 * 1000);

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

function buildTvPanel(channelId, player, dialFrequency) {
  const state = channelRuntime.get(channelId);
  if (!state) return null;
  const channelList = [...channelRuntime.values()]
    .filter(s => s.number != null)
    .sort((a, b) => a.number - b.number)
    .map(s => ({ number: s.number, name: s.name, channelId: s.channelId }));
  // Resolve dialFrequency + chassis skin from the zone's TV device if not passed directly
  const fEntry = _furnitureEntryForZoneChannel(player.current_zone, channelId);
  if (dialFrequency === undefined) dialFrequency = fEntry?.dialFrequency ?? 0;
  sendToPlayer(player.id, {
    type: 'tv_panel',
    channelId,
    channelName: state.name || channelId,
    stationName: state.stationName || state.name || channelId,
    channelNumber: state.number ?? 0,
    dialFrequency,
    skin: fEntry?.skin || _tvSkinForZone(player.current_zone),
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

// Specialized action: use <tv-furniture>
async function doUseTv(args, raw, player) {
  if (!player) return undefined;
  const nameHint = args.join(' ').toLowerCase();

  // Find a tv furniture in the zone matching the name hint. A piece counts as a
  // TV if it carries the `tv` flag OR is simply named like a television.
  const { rows } = await query(
    `SELECT id, name, flags FROM furniture WHERE zone_id=$1 AND (flags::text LIKE '%broadcast_receiver%' OR name ILIKE '%television%')${nameHint ? ' AND name ILIKE $2' : ''} LIMIT 1`,
    nameHint ? [player.current_zone, `%${nameHint}%`] : [player.current_zone]
  );
  if (!rows.length) return undefined;

  const flags = typeof rows[0].flags === 'object' ? rows[0].flags : JSON.parse(rows[0].flags || '{}');
  return buildTvOffPanel(player, flags.tv_skin || 'crt');
}

async function cmdTv(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const zoneMap = zoneTunings.get(player.current_zone);

  if (zoneMap) {
    for (const [channelId, deviceType] of zoneMap) {
      if (deviceType !== 'tv') continue;
      if (channelRuntime.has(channelId)) return buildTvOffPanel(player);
    }
  }

  // No tuned TV — check for any TV furniture in the zone (TV exists but is off).
  // Match the `tv` flag or anything simply named like a television.
  const { rows } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND (flags::text LIKE '%broadcast_receiver%' OR name ILIKE '%television%') LIMIT 1`,
    [player.current_zone]
  );
  if (rows.length) return buildTvOffPanel(player);
  return { type: 'output', message: 'There is no television here.' };
}

async function cmdWatch(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };

  const firstArg = (args[0] || '').toLowerCase();
  if (['tv', 'television', 'monitor', 'screen', 'tele', 'telly'].includes(firstArg)) {
    return cmdTv([], raw, player);
  }

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
  await query('UPDATE furniture SET flags=$1 WHERE id=$2', [JSON.stringify(flags), device.id]);
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

export const commands = {
  tune:  cmdTune,
  watch: cmdWatch,
  listen: cmdWatch,
  tv:    cmdTv,
  load:  (args, raw, player) => {
    if (raw.toLowerCase().includes('cassette')) return cmdLoadCassette(args, raw, player);
    return null; // pass to next handler
  },
  eject: cmdEjectCassette,
  selectcassette: cmdSelectCassette,
};

export const specializedActions = [
  { verb: 'use', requiredTag: 'tv', handler: doUseTv },
  { verb: 'use', requiredTag: 'media_deck', handler: doUseMediaDeck },
];

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
        await query(
          `INSERT INTO media_broadcasts (id,name,description,category,tags,playback_mode,messages,message_interval,override_duration,loop,enabled,created_by,updated_at,broadcast_graph,channel_id,fallback_messages,weather_pools)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,EXTRACT(EPOCH FROM NOW()),$13,$14,$15,$16)`,
          [bid, body.name || 'Untitled', body.description || '', body.category || 'general',
           JSON.stringify(body.tags || []), body.playback_mode || 'scripted',
           JSON.stringify(body.messages || []), body.message_interval || 5,
           body.override_duration || null, body.loop ? 1 : 0, body.enabled !== false ? 1 : 0,
           auth?.playerId || 'unknown', graph, body.channel_id || null,
           JSON.stringify(body.fallback_messages || []), wxPools]
        );
        await loadChannelRuntimes();
        return { status: 201, body: { id: bid } };
      }
      if (id && method === 'PUT') {
        const graph = body.broadcast_graph ? JSON.stringify(body.broadcast_graph) : null;
        const wxPools = body.weather_pools ? JSON.stringify(body.weather_pools) : null;
        await query(
          `UPDATE media_broadcasts SET name=$1,description=$2,category=$3,tags=$4,playback_mode=$5,
           messages=$6,message_interval=$7,override_duration=$8,loop=$9,enabled=$10,broadcast_graph=$11,
           channel_id=$12,fallback_messages=$13,weather_pools=$14,updated_at=EXTRACT(EPOCH FROM NOW()) WHERE id=$15`,
          [body.name||'Untitled', body.description||'', body.category||'general',
           JSON.stringify(body.tags||[]), body.playback_mode||'scripted',
           JSON.stringify(body.messages||[]), body.message_interval||5,
           body.override_duration||null, body.loop?1:0, body.enabled!==false?1:0, graph,
           body.channel_id||null, JSON.stringify(body.fallback_messages||[]), wxPools, id]
        );
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
        const { rows: deckRows } = await query(
          `SELECT id, flags FROM furniture WHERE flags::text LIKE '%"media_deck"%' AND flags::text LIKE $1`,
          [`%${id}%`]
        );
        const result = [];
        for (const d of deckRows) {
          const df = typeof d.flags === 'object' ? d.flags : JSON.parse(d.flags || '{}');
          if (df.channel_id !== id) continue;
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
              `INSERT INTO media_channel_playlist (id,channel_id,broadcast_id,start_time,duration_override,priority,conditions,slot_type)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [pid, id, item.broadcast_id || null, item.start_time || 0,
               item.duration_override || null, item.priority || 0,
               JSON.stringify(cond), slotType]
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
        await query('DELETE FROM furniture WHERE object_type=\'media_deck\' AND flags->>\'channel_id\'=$1', [id]);
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
          await query(
            `INSERT INTO furniture (id,zone_id,name,description,object_type,flags)
             VALUES ($1,$2,$3,$4,'broadcast_camera',$5)
             ON CONFLICT (id) DO NOTHING`,
            [`${camId}_furn`, body.zone_id, camLabel,
             'A broadcast-grade studio camera on a heavy-duty motorised mount. A small red light glows when streaming.',
             JSON.stringify({ broadcast_transmitter: true, camera_id: camId, channel_id: body.streaming_channel_id || null })]
          );
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
          await query(`INSERT INTO furniture (id,zone_id,name,description,object_type,light_type,light_on,light_on_intended,power_draw_kw,lumen_output,flags)
            VALUES ($1,$2,'Overhead Light','A recessed overhead light panel.','light','overhead',1,1,0.02,1200,'{}')`, [`furn_light_stage_${ts}`, studioZoneId]);
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
        await query(`INSERT INTO furniture (id,zone_id,name,description,object_type,light_type,light_on,light_on_intended,power_draw_kw,lumen_output,flags)
          VALUES ($1,$2,'Overhead Light','A recessed overhead light panel.','light','overhead',1,1,0.02,1200,'{}')`, [`furn_light_util_${ts}`, utilityZoneId]);

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
        await query(
          `INSERT INTO furniture (id,zone_id,name,description,object_type,flags,hp,hp_max)
           VALUES ($1,$2,$3,$4,'junction_box',$5,1200,1200) ON CONFLICT (id) DO NOTHING`,
          [`furn_jbox_${utilityZoneId}_${ts}`, utilityZoneId, `${studio_name || 'Studio'} Junction Box`,
           'A grey steel junction cabinet of breakers and humming busbars, feeding the building. A small sealed hacking port sits below the latch.',
           JSON.stringify({ destructible: true, generator_id: jboxId })]
        );
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
        await query(`INSERT INTO furniture (id,zone_id,name,description,object_type,light_type,light_on,light_on_intended,power_draw_kw,lumen_output,flags)
          VALUES ($1,$2,'Overhead Light','A recessed overhead light panel.','light','overhead',1,1,0.02,1200,'{}')`, [`furn_light_prod_${ts}`, productionZoneId]);
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
          await query(
            `INSERT INTO furniture (id,zone_id,name,description,object_type,light_type,light_on,power_draw_kw,lumen_output,flags)
             VALUES ($1,$2,'Street Light','A tall metal post topped with a flickering sodium lamp.','light','streetlight',0,0.2,8000,'{}')`,
            [`furn_light_ext_${ts}`, exteriorZoneId]
          );
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
        await query(
          `INSERT INTO furniture (id,zone_id,name,description,object_type,flags,hp,hp_max)
           VALUES ($1,$2,$3,$4,'junction_box',$5,1200,1200) ON CONFLICT (id) DO NOTHING`,
          [`furn_jbox_${utilityZoneId}_${ts}`, utilityZoneId, `${studio_name} Junction Box`,
           'A grey steel junction cabinet of breakers and humming busbars, feeding the building. A small sealed hacking port sits below the latch.',
           JSON.stringify({ destructible: true, generator_id: jboxId })]
        );

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
          await query(
            `INSERT INTO furniture (id,zone_id,name,description,object_type,light_type,light_on,light_on_intended,power_draw_kw,lumen_output,flags)
             VALUES ($1,$2,'Overhead Light','A recessed overhead light panel.','light','overhead',1,1,0.02,1200,'{}')`,
            [`furn_light_${lightSuffix}_${ts}`, zid]
          );
        }

        // Street light on the exterior zone (day/night managed — light_on_intended stays NULL)
        await query(
          `INSERT INTO furniture (id,zone_id,name,description,object_type,light_type,light_on,power_draw_kw,lumen_output,flags)
           VALUES ($1,$2,'Street Light','A tall metal post topped with a flickering sodium lamp.','light','streetlight',0,0.2,8000,'{}')`,
          [`furn_light_ext_${ts}`, exteriorZoneId]
        );

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
          await query(
            `UPDATE furniture SET zone_id=$1, name=$2 WHERE id=$3`,
            [targetZoneId, name || 'Media Deck', deckId]
          );
          // Ensure flags carry channel_id/media_deck even if an older row lost them
          dflags.media_deck = true;
          dflags.channel_id = channel_id;
          if (!Array.isArray(dflags.deck_cassettes)) dflags.deck_cassettes = [];
          await query('UPDATE furniture SET flags=$1 WHERE id=$2', [JSON.stringify(dflags), deckId]);
        } else {
          deckId = `furn_deck_${channel_id}_${ts}`;
          await query(
            `INSERT INTO furniture (id, zone_id, name, description, flags, power_draw_kw, object_type)
             VALUES ($1,$2,$3,$4,$5,2.0,'media_deck')`,
            [deckId, targetZoneId, name || 'Media Deck',
             'Broadcast transmission hardware. Plays cassettes and routes live camera feeds.',
             JSON.stringify({ media_deck: true, channel_id, deck_cassettes: [], deck_active: null })]
          );
        }
        await query(`UPDATE media_channels SET studio_zone_id=$1 WHERE id=$2`, [stageZoneId || targetZoneId, channel_id]);

        let cameraId = null;
        if (auto_place && stageZoneId && !no_camera) {
          // Create broadcast_transmitter furniture in stage zone
          const camFurnId = `furn_cam_${channel_id}_${ts}`;
          await query(
            `INSERT INTO furniture (id,zone_id,name,description,flags,object_type)
             VALUES ($1,$2,$3,$4,$5,'camera')`,
            [camFurnId, stageZoneId, 'Studio Camera',
             'Broadcast camera positioned on the stage floor.',
             JSON.stringify({ broadcast_transmitter: true, channel_id })]
          );
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
              await query('UPDATE furniture SET flags=$1 WHERE id=$2', [JSON.stringify(dflags), deckId]);
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
setInterval(broadcastTick, 5000);

// Register _tvfreq as a silent internal command (not listed in plugin.json, invisible to HELP)
registerCommand('_tvfreq', cmdTvFreq);
registerCommand('_restartbroadcast', cmdRestartBroadcast);

console.log(`[broadcast] Plugin loaded. ${channelRuntime.size} channel(s), ${zoneTunings.size} tuned zone(s), ${graphicsCache.size} graphic(s).`);
