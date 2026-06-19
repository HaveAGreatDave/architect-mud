import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { randomUUID, createHash } from 'crypto';

import { initWorld, addPlayerToZone, removePlayerFromZone, setLivePlayer, getLivePlayer, removeLivePlayer, getZone } from './engine/world.js';
import { handleCommand, describeZone } from './engine/commands.js';
import { startGameLoop } from './engine/gameLoop.js';
import { handleApiRequest } from './api/routes.js';
import { getDb } from './models/migrate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Connected WebSocket clients
// Map: ws -> { playerId, handle, role, isGhost }
const clients = new Map();
// Map: playerId -> ws
const playerSockets = new Map();

// --- Broadcast function ---
function broadcast(zoneId, message, excludePlayerId = null, targetPlayerId = null) {
  const payload = JSON.stringify(message);

  if (targetPlayerId) {
    const ws = playerSockets.get(targetPlayerId);
    if (ws && ws.readyState === 1) ws.send(payload);
    return;
  }

  for (const [ws, session] of clients) {
    if (ws.readyState !== 1) continue;
    if (session.isGhost) continue;
    if (excludePlayerId && session.playerId === excludePlayerId) continue;
    if (zoneId) {
      const player = getLivePlayer(session.playerId);
      if (!player || player.current_zone !== zoneId) continue;
    }
    ws.send(payload);
  }
}

// --- HTTP Server (serves static files + API) ---
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

const httpServer = createServer(async (req, res) => {
  const url = req.url || '/';

  // API routes
  if (url.startsWith('/api/')) {
    let body = {};
    if (req.method !== 'GET') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
    }
    const result = await handleApiRequest(url, req.method, body, req.headers);
    res.writeHead(result.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' });
    if (req.method === 'OPTIONS') { res.end(); return; }
    res.end(JSON.stringify(result.body));
    return;
  }

  // Static file serving
  let filePath;
  if (url.startsWith('/dev')) {
    filePath = join(__dirname, '../client/devpanel', url === '/dev' || url === '/dev/' ? 'index.html' : url.replace('/dev', ''));
  } else {
    filePath = join(__dirname, '../client/game', url === '/' ? 'index.html' : url);
  }

  if (!existsSync(filePath)) {
    // Fallback to index for SPA routing
    filePath = join(__dirname, '../client/game/index.html');
  }

  try {
    const data = readFileSync(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

// --- WebSocket Server ---
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const sessionId = randomUUID();
  clients.set(ws, { sessionId, playerId: null, handle: null, role: null, isGhost: false });

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    const session = clients.get(ws);

    switch (msg.type) {
      case 'auth': return handleAuth(ws, session, msg);
      case 'command': return handleGameCommand(ws, session, msg);
      case 'dialogue': return handleDialogue(ws, session, msg);
      case 'ghost_move': return handleGhostMove(ws, session, msg);
      default: ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  });

  ws.on('close', () => {
    const session = clients.get(ws);
    if (session?.playerId) {
      const player = getLivePlayer(session.playerId);
      if (player) {
        removePlayerFromZone(session.playerId, player.current_zone);
        broadcast(player.current_zone, { type: 'zone_event', message: `${session.handle} has disconnected.` }, session.playerId);
      }
      playerSockets.delete(session.playerId);
      removeLivePlayer(session.playerId);

      const db = getDb();
      db.prepare('UPDATE players SET last_seen = unixepoch() WHERE id = ?').run(session.playerId);
      db.close();
    }
    clients.delete(ws);
  });

  ws.send(JSON.stringify({ type: 'connected', message: 'Connected to ARCHITECT. Authenticate or register to enter.' }));
});

async function handleAuth(ws, session, msg) {
  const { username, password } = msg;
  const db = getDb();

  const player = db.prepare('SELECT * FROM players WHERE username = ?').get(username?.toLowerCase());
  db.close();

  const hash = createHash('sha256').update(password || '').digest('hex');
  if (!player || player.password_hash !== hash) {
    ws.send(JSON.stringify({ type: 'auth_fail', message: 'Invalid credentials.' }));
    return;
  }

  // Update session
  session.playerId = player.id;
  session.handle = player.handle;
  session.role = player.role;
  playerSockets.set(player.id, ws);

  // Load into world
  const livePlayer = {
    id: player.id,
    handle: player.handle,
    role: player.role,
    current_zone: player.current_zone || 'zone_start',
    anchor_zone: player.anchor_zone || 'zone_start',
    hp: player.hp, hp_max: player.hp_max,
    sanity: player.sanity, sanity_max: player.sanity_max,
    hunger: player.hunger, thirst: player.thirst, radiation: player.radiation,
    credits: player.credits,
    stat_str: player.stat_str, stat_agi: player.stat_agi,
    stat_int: player.stat_int, stat_wil: player.stat_wil,
    stat_end: player.stat_end, stat_cha: player.stat_cha,
    armor: 0, statuses: [],
  };

  setLivePlayer(player.id, livePlayer);
  addPlayerToZone(player.id, livePlayer.current_zone);

  // Update last seen
  const db2 = getDb();
  db2.prepare('UPDATE players SET last_seen = unixepoch() WHERE id = ?').run(player.id);
  db2.close();

  broadcast(livePlayer.current_zone, {
    type: 'zone_event',
    message: `${player.handle} has arrived.`,
  }, player.id);

  ws.send(JSON.stringify({ type: 'auth_success', player: livePlayer }));

  // Send initial look
  const zone = getZone(livePlayer.current_zone);
  if (zone) {
    ws.send(JSON.stringify({
      type: 'look',
      message: describeZone(zone, livePlayer),
    }));
  }
}

async function handleGameCommand(ws, session, msg) {
  if (!session.playerId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated.' }));
    return;
  }

  const player = getLivePlayer(session.playerId);
  if (!player) {
    ws.send(JSON.stringify({ type: 'error', message: 'Session lost. Please reconnect.' }));
    return;
  }

  const result = await handleCommand(msg.command, player, broadcast);
  if (result) {
    ws.send(JSON.stringify(result));

    // If player state changed, send update
    if (result.player_update) {
      ws.send(JSON.stringify({ type: 'player_update', ...result.player_update }));
    }
  }
}

async function handleDialogue(ws, session, msg) {
  if (!session.playerId) return;
  const { npcId, choice } = msg;

  const db = getDb();
  const npc = db.prepare('SELECT * FROM npcs WHERE id = ?').get(npcId);
  db.close();

  if (!npc) { ws.send(JSON.stringify({ type: 'error', message: 'NPC not found.' })); return; }

  const tree = JSON.parse(npc.dialogue_tree || '{}');
  const node = tree[choice];

  if (!node) {
    ws.send(JSON.stringify({ type: 'dialogue_end', message: `${npc.name} has nothing more to say.` }));
    return;
  }

  ws.send(JSON.stringify({
    type: 'dialogue',
    npcId, npcName: npc.name,
    node: choice,
    text: node.text,
    options: node.options || [],
  }));
}

async function handleGhostMove(ws, session, msg) {
  if (!session.playerId) return;
  if (!['admin', 'dev', 'builder', 'designer'].includes(session.role)) return;

  session.isGhost = true;
  session.ghostZone = msg.zone_id;

  ws.send(JSON.stringify({
    type: 'ghost_view',
    zone_id: msg.zone_id,
    message: `[GHOST] Observing zone: ${msg.zone_id}`,
  }));
}

// --- Boot ---
initWorld();
startGameLoop(broadcast);

httpServer.listen(PORT, () => {
  console.log(`\n🏚  ARCHITECT MUD running on http://localhost:${PORT}`);
  console.log(`   Player client: http://localhost:${PORT}`);
  console.log(`   Dev panel:     http://localhost:${PORT}/dev`);
  console.log(`\n   Run 'npm run db:migrate && npm run db:seed' if first launch.\n`);
});
