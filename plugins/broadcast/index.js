import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { world, getZonePlayers, getZone, getZoneNpcs, getZoneEnemies } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { on, emit } from '../../server/engine/events.js';
import { registerAction } from '../../server/engine/actions.js';
import { registerViewerChecker } from '../../server/engine/broadcast-bridge.js';
import { getEnvironmentState } from '../../server/engine/environment.js';

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

// graphicsCache.get(id) = { id, name, type, content }
// Loaded at startup and after any graphics CRUD operation.
const graphicsCache = new Map();

// ── Helpers ──────────────────────────────────────────────────────────────────

function devOk(auth) {
  return auth && ['dev', 'admin', 'builder', 'designer'].includes(auth.role);
}

function broadcastDuration(bc) {
  if (bc.override_duration) return bc.override_duration;
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
    nodeId = node.next ?? null;
  }
  return total;
}

function formatMessage(text, deviceType, zone) {
  if (!text) return null;
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
      `SELECT p.*, b.playback_mode, b.messages, b.message_interval, b.override_duration, b.loop, b.broadcast_graph, b.fallback_messages
         FROM media_channel_playlist p
         JOIN media_broadcasts b ON b.id = p.broadcast_id
        ORDER BY p.channel_id, p.start_time`
    );
    const { rows: cams } = await query(
      'SELECT id, zone_id, streaming_channel_id FROM media_cameras WHERE is_streaming = 1 AND is_powered = 1'
    );

    const cameraByChannel = new Map();
    for (const cam of cams) {
      if (cam.streaming_channel_id) cameraByChannel.set(cam.streaming_channel_id, cam);
    }

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
      playlistByChannel.get(item.channel_id).push({
        id: item.id,
        broadcastId: item.broadcast_id,
        startTime: item.start_time,
        duration: dur,
        playback_mode: item.playback_mode,
        messages: Array.isArray(item.messages) ? item.messages : (item.messages ? JSON.parse(item.messages) : []),
        message_interval: item.message_interval || 5,
        loop: item.loop,
        broadcastGraph,
        fallbackMessages: Array.isArray(item.fallback_messages) ? item.fallback_messages : (item.fallback_messages ? JSON.parse(item.fallback_messages) : []),
      });
    }

    channelRuntime.clear();
    for (const ch of channels) {
      const pl = playlistByChannel.get(ch.id) || [];
      const totalDuration = pl.length
        ? Math.max(...pl.map(i => i.startTime + i.duration))
        : 0;
      const idleMsgs = ch.idle_messages ? (Array.isArray(ch.idle_messages) ? ch.idle_messages : JSON.parse(ch.idle_messages)) : [];
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
        offlineGraphicId: ch.offline_graphic_id || null,
        loopOriginMs: Date.now(),
        lastMsgKey: '',
        wasActive: false,
        currentFallbackMessages: [],
        graphBlackboard: { currentNode: null, waitUntil: null, npcAnchor: null, activeBroadcastId: null, hostAbsent: false, absentDetectedAt: null, techDiffMode: false },
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
      furnitureChannelIndex.set(row.id, { zoneId: row.zone_id, channelId: row.channel_id, deviceType });
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

  // Live camera
  if (channelType === 'live' && camera) {
    const text = buildCameraSnapshot(camera.zone_id);
    return text ? { text, key: `cam:${nowMs}` } : null;
  }

  // Daily schedule mode — start_time is seconds from midnight (0–86399)
  if (scheduleMode === 'daily' && playlist.length) {
    const { minutes } = getEnvironmentState();
    const gameSecondsSinceMidnight = minutes * 60;
    const item = playlist.find(i => gameSecondsSinceMidnight >= i.startTime && gameSecondsSinceMidnight < i.startTime + i.duration);
    if (item) {
      state.currentFallbackMessages = item.fallbackMessages || [];
      if (item.broadcastGraph) return tickBroadcastGraph(state.channelId, item.broadcastGraph, state, nowMs);
      const segElapsed = gameSecondsSinceMidnight - item.startTime;
      const result = getScriptedMessage(item.messages, item.message_interval, segElapsed);
      if (result) return { text: result.text, key: `${item.broadcastId}:${result.idx}` };
    }
    // Nothing scheduled right now — fall through to idle
    if (idleBroadcast?.messages?.length) {
      const result = getScriptedMessage(idleBroadcast.messages, idleBroadcast.message_interval, (nowMs / 1000) % (idleBroadcast.messages.length * (idleBroadcast.message_interval || 5)));
      if (result) return { text: result.text, key: `idle:${result.idx}` };
    }
    return null;
  }

  // Playlist-based loop (playlist | mixed | emergency)
  if (playlist.length && totalDuration > 0) {
    const elapsed = ((nowMs - loopOriginMs) / 1000) % totalDuration;
    const item = playlist.find(i => elapsed >= i.startTime && elapsed < i.startTime + i.duration);
    if (item) {
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

// ── Broadcast tick ───────────────────────────────────────────────────────────

async function broadcastTick() {
  const nowMs = Date.now();
  for (const [zoneId, channelMap] of zoneTunings) {
    const players = getZonePlayers(zoneId);
    if (!players.length) continue;

    for (const [channelId, deviceType] of channelMap) {
      const state = channelRuntime.get(channelId);
      if (!state) continue;

      let result;
      try {
        result = await getCurrentMessage(state, nowMs);
      } catch (err) {
        console.error(`[broadcast] tick error (${channelId}):`, err.message);
        continue;
      }
      if (!result || result.key === state.lastMsgKey) {
        if (state.wasActive) {
          state.wasActive = false;
          const graphic = state.offlineGraphicId ? graphicsCache.get(state.offlineGraphicId) : null;
          for (const player of players) {
            sendToPlayer(player.id, { type: 'broadcast', channel: channelId, style: 'off_air',
              offlineGraphicContent: graphic?.content || null,
              offlineGraphicType: graphic?.type || 'ascii' });
          }
        }
        continue;
      }
      state.wasActive = true;
      state.lastMsgKey = result.key;

      // Overlay events (show_overlay / clear_overlay) go direct to TV watchers
      if (result.style === 'overlay') {
        for (const player of players) {
          sendToPlayer(player.id, { type: 'tv_overlay', channelId, overlay: result.overlay ?? null });
        }
        continue;
      }

      const zone = getZone(zoneId);
      const formatted = formatMessage(result.text, deviceType, zone);
      if (!formatted) continue;

      for (const player of players) {
        sendToPlayer(player.id, { type: 'broadcast', message: formatted, channel: channelId, style: result.style || 'raw' });
      }
      emit('broadcast.message', { channelId, zoneId, text: result.text });
    }
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
function tickBroadcastGraph(channelId, graph, state, nowMs) {
  if (!state.graphBlackboard) return null;
  const bb = state.graphBlackboard;

  // Reset blackboard if a different broadcast is now active
  if (bb.activeBroadcastId !== graph._broadcastId) {
    bb.currentNode = null;
    bb.waitUntil = null;
    bb.npcAnchor = null;
    bb.hostAbsent = false;
    bb.absentDetectedAt = null;
    bb.techDiffMode = false;
    bb.activeBroadcastId = graph._broadcastId;
  }

  // Tech-diff mode — host was absent; cycle fallback messages until slot ends
  if (bb.techDiffMode) {
    const pool = state.currentFallbackMessages?.length
      ? state.currentFallbackMessages
      : ['[TECHNICAL DIFFICULTIES] Please stand by.'];
    const idx = Math.floor(nowMs / 5000) % pool.length;
    return { text: pool[idx], key: `techDiff:${channelId}:${idx}:${Math.floor(nowMs / 5000)}`, style: 'raw' };
  }

  // Camera-idle phase — host absent but first 60s; show live studio feed
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
    const pool = state.currentFallbackMessages?.length
      ? state.currentFallbackMessages
      : ['[TECHNICAL DIFFICULTIES] Please stand by.'];
    const idx = Math.floor(nowMs / 5000) % pool.length;
    return { text: pool[idx], key: `techDiff:${channelId}:${idx}:${Math.floor(nowMs / 5000)}`, style: 'raw' };
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

    switch (node.type) {
      case 'start':
        nodeId = _resolveEdge(edges, nodeId, 'next');
        break;

      case 'say': {
        if (bb.hostAbsent) { nodeId = _resolveEdge(edges, nodeId, 'next'); break; }
        const raw = node.data?.text || '';
        const style = node.data?.style || 'raw';
        const voice = bb.npcAnchor ? `[${bb.npcAnchor}] ` : '';
        const text = style === 'ticker' ? `>> ${voice}${raw} <<` : `${voice}${raw}`;
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        return { text, key: `graph:${channelId}:${nodeId}:${nowMs}`, style };
      }

      case 'ticker': {
        if (bb.hostAbsent) { nodeId = _resolveEdge(edges, nodeId, 'next'); break; }
        const text = `>> ${node.data?.text || ''} <<`;
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        return { text, key: `ticker:${channelId}:${nodeId}`, style: 'ticker' };
      }

      case 'npc_anchor': {
        const npcId = node.data?.npc_id;
        const npc = world.npcs?.get(npcId);
        bb.npcAnchor = npc?.name || npcId || null;
        // Presence check — only for live channels with a studio zone configured
        if (npcId && state.channelType === 'live' && state.studioZoneId && !bb.hostAbsent) {
          const zone = getZone(state.studioZoneId);
          if (!(zone?.npcs?.has(npcId))) {
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
        const snap = zoneId ? buildCameraSnapshot(zoneId) : null;
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        if (snap) return { text: `[CAM: ${label}] ${snap}`, key: `cam:${channelId}:${zoneId}:${nowMs}`, style: 'raw' };
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
        const seconds = node.data?.seconds ?? 5;
        bb.waitUntil = nowMs + seconds * 1000;
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
        if (graphic) {
          const caption = node.data?.caption ? `\n${node.data.caption}` : '';
          return { text: graphic.content + caption, key: `graphic:${channelId}:${gid}:${nowMs}`, style: graphic.type === 'svg' ? 'svg' : 'ascii_art' };
        }
        nodeId = bb.currentNode;
        break;
      }

      case 'show_overlay': {
        const overlay = {
          overlayType: node.data?.overlay_type || 'lower_third',
          text: node.data?.text || '',
          subtext: node.data?.subtext || '',
          duration: node.data?.duration_s ?? 6,
        };
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        return { overlay, key: `overlay:${channelId}:${nodeId}:${nowMs}`, style: 'overlay' };
      }

      case 'clear_overlay': {
        bb.currentNode = _resolveEdge(edges, nodeId, 'next');
        return { overlay: null, key: `clear_overlay:${channelId}:${nowMs}`, style: 'overlay' };
      }

      default:
        nodeId = null;
    }
  }
  return null;
}

// ── Actions ──────────────────────────────────────────────────────────────────

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
    const flags = typeof furniture.flags === 'object' ? { ...furniture.flags } : JSON.parse(furniture.flags || '{}');

    // Remove old tuning from cache
    const old = furnitureChannelIndex.get(furniture_id);
    if (old) {
      const zMap = zoneTunings.get(old.zoneId);
      if (zMap) {
        zMap.delete(old.channelId);
        if (!zMap.size) zoneTunings.delete(old.zoneId);
      }
      furnitureChannelIndex.delete(furniture_id);
    }

    if (channel_number === 0) {
      // Tune off
      delete flags.tuned_channel;
      await query('UPDATE furniture SET flags=$1 WHERE id=$2', [JSON.stringify(flags), furniture_id]);
      emit('device.tuned', { furnitureId: furniture_id, channelNumber: 0 });
      return { type: 'output', message: 'Device turned off.' };
    }

    const { rows: chRows } = await query('SELECT * FROM media_channels WHERE number=$1 AND enabled=1', [channel_number]);
    if (!chRows.length) return { type: 'output', message: `No channel ${channel_number}.` };
    const channel = chRows[0];
    flags.tuned_channel = channel_number;
    await query('UPDATE furniture SET flags=$1 WHERE id=$2', [JSON.stringify(flags), furniture_id]);

    // Update cache
    const deviceType = flags.broadcast_device_type || 'tv';
    const zoneId = furniture.zone_id;
    if (!zoneTunings.has(zoneId)) zoneTunings.set(zoneId, new Map());
    zoneTunings.get(zoneId).set(channel.id, deviceType);
    furnitureChannelIndex.set(furniture_id, { zoneId, channelId: channel.id, deviceType });

    emit('device.tuned', { furnitureId: furniture_id, channelNumber: channel_number, channelId: channel.id });
    return { type: 'output', message: `Tuned to channel ${channel_number}: ${channel.name}.` };
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

  if (channelNumber === 0) {
    const flags = typeof device.flags === 'object' ? { ...device.flags } : JSON.parse(device.flags || '{}');
    delete flags.tuned_channel;
    await query('UPDATE furniture SET flags=$1 WHERE id=$2', [JSON.stringify(flags), device.id]);
    // Clear from cache
    const old = furnitureChannelIndex.get(device.id);
    if (old) {
      const zMap = zoneTunings.get(old.zoneId);
      if (zMap) { zMap.delete(old.channelId); if (!zMap.size) zoneTunings.delete(old.zoneId); }
      furnitureChannelIndex.delete(device.id);
    }
    sendToPlayer(player.id, { type: 'tv_off' });
    return { type: 'output', message: 'Device turned off.' };
  }

  const { rows: chRows } = await query('SELECT * FROM media_channels WHERE number=$1 AND enabled=1', [channelNumber]);
  if (!chRows.length) return { type: 'output', message: `Channel ${channelNumber} not found.` };
  const channel = chRows[0];

  const flags = typeof device.flags === 'object' ? { ...device.flags } : JSON.parse(device.flags || '{}');
  flags.tuned_channel = channelNumber;
  await query('UPDATE furniture SET flags=$1 WHERE id=$2', [JSON.stringify(flags), device.id]);

  // Clear old, set new in cache
  const old = furnitureChannelIndex.get(device.id);
  if (old) {
    const zMap = zoneTunings.get(old.zoneId);
    if (zMap) { zMap.delete(old.channelId); if (!zMap.size) zoneTunings.delete(old.zoneId); }
  }
  const deviceType = flags.broadcast_device_type || 'tv';
  if (!zoneTunings.has(player.current_zone)) zoneTunings.set(player.current_zone, new Map());
  zoneTunings.get(player.current_zone).set(channel.id, deviceType);
  furnitureChannelIndex.set(device.id, { zoneId: player.current_zone, channelId: channel.id, deviceType });

  emit('device.tuned', { furnitureId: device.id, channelNumber, channelId: channel.id });
  // If the player has the TV panel open, re-send tv_panel so it switches to the new channel
  buildTvPanel(channel.id, player);
  return { type: 'output', message: `Tuned to channel ${channelNumber}: ${channel.name}.` };
}

function buildTvPanel(channelId, player) {
  const state = channelRuntime.get(channelId);
  if (!state) return null;
  const channelList = [...channelRuntime.values()]
    .filter(s => s.number != null)
    .sort((a, b) => a.number - b.number)
    .map(s => ({ number: s.number, name: s.name, channelId: s.channelId }));
  sendToPlayer(player.id, {
    type: 'tv_panel',
    channelId,
    channelName: state.name || channelId,
    stationName: state.stationName || state.name || channelId,
    channelNumber: state.number ?? 0,
    channelType: state.channelType || 'playlist',
    theme: state.theme || null,
    channelList,
  });
  // If the channel is currently off-air, signal it immediately rather than waiting for the next tick
  if (!state.wasActive) {
    const graphic = state.offlineGraphicId ? graphicsCache.get(state.offlineGraphicId) : null;
    sendToPlayer(player.id, { type: 'broadcast', channel: channelId, style: 'off_air',
      offlineGraphicContent: graphic?.content || null,
      offlineGraphicType: graphic?.type || 'ascii' });
  }
  return { type: 'output', message: 'You turn to the television.' };
}

// Specialized action: use <tv-furniture>
async function doUseTv(args, raw, player) {
  if (!player) return undefined;
  const nameHint = args.join(' ').toLowerCase();

  // Find a tv-flagged furniture in the zone matching the name hint
  const { rows } = await query(
    `SELECT id, name FROM furniture WHERE zone_id=$1 AND jsonb_exists(flags,'tv')${nameHint ? ' AND name ILIKE $2' : ''} LIMIT 1`,
    nameHint ? [player.current_zone, `%${nameHint}%`] : [player.current_zone]
  );
  if (!rows.length) return undefined;

  const entry = furnitureChannelIndex.get(rows[0].id);
  if (!entry || entry.deviceType !== 'tv') return { type: 'output', message: `${rows[0].name} isn't receiving any signal.` };

  return buildTvPanel(entry.channelId, player) ?? { type: 'output', message: `${rows[0].name} has no active channel.` };
}

async function cmdTv(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const zoneMap = zoneTunings.get(player.current_zone);
  if (!zoneMap || !zoneMap.size) return { type: 'output', message: 'There is no television here.' };

  for (const [channelId, deviceType] of zoneMap) {
    if (deviceType !== 'tv') continue;
    const result = buildTvPanel(channelId, player);
    if (result) return result;
  }
  return { type: 'output', message: 'There is no television here.' };
}

async function cmdWatch(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };

  const firstArg = (args[0] || '').toLowerCase();
  if (['tv', 'television', 'monitor', 'screen', 'tele'].includes(firstArg)) {
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

export const commands = {
  tune: cmdTune,
  watch: cmdWatch,
  listen: cmdWatch,
  tv: cmdTv,
};

export const specializedActions = [
  { verb: 'use', requiredTag: 'tv', handler: doUseTv },
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
        const { rows } = await query('SELECT * FROM media_broadcasts ORDER BY name');
        return { status: 200, body: rows };
      }
      if (!id && method === 'POST') {
        const bid = body.id || `bc_${Date.now()}`;
        const graph = body.broadcast_graph ? JSON.stringify(body.broadcast_graph) : null;
        await query(
          `INSERT INTO media_broadcasts (id,name,description,category,tags,playback_mode,messages,message_interval,override_duration,loop,enabled,created_by,updated_at,broadcast_graph,channel_id,fallback_messages)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,EXTRACT(EPOCH FROM NOW()),$13,$14,$15)`,
          [bid, body.name || 'Untitled', body.description || '', body.category || 'general',
           JSON.stringify(body.tags || []), body.playback_mode || 'scripted',
           JSON.stringify(body.messages || []), body.message_interval || 5,
           body.override_duration || null, body.loop ? 1 : 0, body.enabled !== false ? 1 : 0,
           auth?.playerId || 'unknown', graph, body.channel_id || null,
           JSON.stringify(body.fallback_messages || [])]
        );
        await loadChannelRuntimes();
        return { status: 201, body: { id: bid } };
      }
      if (id && method === 'PUT') {
        const graph = body.broadcast_graph ? JSON.stringify(body.broadcast_graph) : null;
        await query(
          `UPDATE media_broadcasts SET name=$1,description=$2,category=$3,tags=$4,playback_mode=$5,
           messages=$6,message_interval=$7,override_duration=$8,loop=$9,enabled=$10,broadcast_graph=$11,
           channel_id=$12,fallback_messages=$13,updated_at=EXTRACT(EPOCH FROM NOW()) WHERE id=$14`,
          [body.name||'Untitled', body.description||'', body.category||'general',
           JSON.stringify(body.tags||[]), body.playback_mode||'scripted',
           JSON.stringify(body.messages||[]), body.message_interval||5,
           body.override_duration||null, body.loop?1:0, body.enabled!==false?1:0, graph,
           body.channel_id||null, JSON.stringify(body.fallback_messages||[]), id]
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
      // Playlist sub-resource
      if (id && sub === 'playlist') {
        if (method === 'GET') {
          const { rows } = await query(
            `SELECT p.*, b.name AS broadcast_name, b.playback_mode, b.messages, b.message_interval, b.override_duration, b.broadcast_graph, b.fallback_messages
               FROM media_channel_playlist p
               JOIN media_broadcasts b ON b.id = p.broadcast_id
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
            await query(
              `INSERT INTO media_channel_playlist (id,channel_id,broadcast_id,start_time,duration_override,priority,conditions)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [pid, id, item.broadcast_id, item.start_time || 0,
               item.duration_override || null, item.priority || 0,
               JSON.stringify(item.conditions || [])]
            );
          }
          await loadChannelRuntimes();
          return { status: 200, body: { message: 'Playlist updated' } };
        }
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
        return { status: 200, body: channels.map(c => ({ ...c, playlist: plByChannel[c.id] || [] })) };
      }
      if (!id && method === 'POST') {
        const cid = body.id || `ch_${Date.now()}`;
        await query(
          `INSERT INTO media_channels (id,name,number,description,station_name,theme_id,enabled,loop_playlist,priority,channel_type,idle_broadcast_id,news_categories,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,EXTRACT(EPOCH FROM NOW()))`,
          [cid, body.name || 'Untitled Channel', body.number || null, body.description || '',
           body.station_name || '', body.theme_id || null,
           body.enabled !== false ? 1 : 0, body.loop_playlist !== false ? 1 : 0,
           body.priority || 0, body.channel_type || 'playlist',
           body.idle_broadcast_id || null, JSON.stringify(body.news_categories || [])]
        );
        await loadChannelRuntimes();
        return { status: 201, body: { id: cid } };
      }
      if (id && !sub && method === 'PUT') {
        await query(
          `UPDATE media_channels SET name=$1,number=$2,description=$3,station_name=$4,theme_id=$5,
           enabled=$6,loop_playlist=$7,priority=$8,channel_type=$9,idle_broadcast_id=$10,news_categories=$11,
           schedule_mode=$12,studio_zone_id=$13,offline_graphic_id=$14,updated_at=EXTRACT(EPOCH FROM NOW()) WHERE id=$15`,
          [body.name || 'Untitled Channel', body.number || null, body.description || '',
           body.station_name || '', body.theme_id || null,
           body.enabled !== false ? 1 : 0, body.loop_playlist !== false ? 1 : 0,
           body.priority || 0, body.channel_type || 'playlist',
           body.idle_broadcast_id || null, JSON.stringify(body.news_categories || []),
           body.schedule_mode || 'loop', body.studio_zone_id || null,
           body.offline_graphic_id || null, id]
        );
        await loadChannelRuntimes();
        return { status: 200, body: { id } };
      }
      if (id && !sub && method === 'DELETE') {
        if (auth?.role !== 'admin') return { status: 403, body: { error: 'Admin access required' } };
        await query('DELETE FROM media_channels WHERE id=$1', [id]);
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

    // ── Graphics ────────────────────────────────────────────────────────────
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

  return null;
};

// ── Startup ──────────────────────────────────────────────────────────────────

await loadChannelRuntimes();
await loadZoneTunings();
await loadGraphicsCache();
setInterval(broadcastTick, 5000);

console.log(`[broadcast] Plugin loaded. ${channelRuntime.size} channel(s), ${zoneTunings.size} tuned zone(s), ${graphicsCache.size} graphic(s).`);
