import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { createHash } from 'crypto';

import { initWorld, addPlayerToZone, removePlayerFromZone, setLivePlayer, getLivePlayer, removeLivePlayer, getZone } from './engine/world.js';
import { handleCommand, describeZone } from './engine/commands.js';
import { startGameLoop } from './engine/gameLoop.js';
import { loadPlugins } from './engine/plugins.js';
import { handleApiRequest } from './api/routes.js';
import { startKeepalive } from './keepalive.js';
import { query } from './models/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const clients = new Map();       // ws -> session
const playerSockets = new Map(); // playerId -> ws

function broadcast(zoneId, message, excludePlayerId = null, targetPlayerId = null) {
  const payload = JSON.stringify(message);
  if (targetPlayerId) {
    const ws = playerSockets.get(targetPlayerId);
    if (ws?.readyState === 1) ws.send(payload);
    return;
  }
  for (const [ws, session] of clients) {
    if (ws.readyState !== 1 || session.isGhost) continue;
    if (excludePlayerId && session.playerId === excludePlayerId) continue;
    if (zoneId) {
      const p = getLivePlayer(session.playerId);
      if (!p || p.current_zone !== zoneId) continue;
    }
    ws.send(payload);
  }
}

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png' };

const httpServer = createServer(async (req, res) => {
  const url = req.url || '/';
  const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'Content-Type,Authorization', 'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS' };

  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  // Health check endpoint — used by keepalive and Render
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type':'application/json', ...cors });
    res.end(JSON.stringify({ status:'ok', players: clients.size, uptime: process.uptime() }));
    return;
  }

  if (url.startsWith('/api/')) {
    let body = {};
    if (req.method !== 'GET') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
    }
    const result = await handleApiRequest(url, req.method, body, req.headers);
    res.writeHead(result.status, { 'Content-Type':'application/json', ...cors });
    res.end(JSON.stringify(result.body));
    return;
  }

  let filePath;
  if (url.startsWith('/dev')) {
    filePath = join(__dirname, '../client/devpanel', url === '/dev' || url === '/dev/' ? 'index.html' : url.replace('/dev',''));
  } else {
    filePath = join(__dirname, '../client/game', url === '/' ? 'index.html' : url);
  }
  if (!existsSync(filePath)) filePath = join(__dirname, '../client/game/index.html');
  try {
    const data = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'text/plain' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  clients.set(ws, { playerId:null, handle:null, role:null, isGhost:false });

  // WebSocket keepalive ping/pong
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (data) => {
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    const session = clients.get(ws);
    if (msg.type === 'auth') return handleAuth(ws, session, msg);
    if (msg.type === 'command') return handleGameCommand(ws, session, msg);
    if (msg.type === 'dialogue') return handleDialogue(ws, session, msg);
    if (msg.type === 'ping') { ws.send(JSON.stringify({ type:'pong' })); return; }
  });

  ws.on('close', async () => {
    const session = clients.get(ws);
    if (session?.playerId) {
      const player = getLivePlayer(session.playerId);
      if (player) {
        removePlayerFromZone(session.playerId, player.current_zone);
        broadcast(player.current_zone, { type:'zone_event', message:`${session.handle} has disconnected.` }, session.playerId);
      }
      playerSockets.delete(session.playerId);
      removeLivePlayer(session.playerId);
      await query('UPDATE players SET last_seen=EXTRACT(EPOCH FROM NOW()) WHERE id=$1', [session.playerId]).catch(()=>{});
    }
    clients.delete(ws);
  });

  ws.send(JSON.stringify({ type:'connected', message:'Connected to ARCHITECT.' }));
});

// WebSocket heartbeat — kills stale connections
const heartbeat = setInterval(() => {
  for (const [ws] of clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

async function handleAuth(ws, session, msg) {
  const hash = createHash('sha256').update(msg.password||'').digest('hex');
  const { rows } = await query('SELECT * FROM players WHERE username=$1', [msg.username?.toLowerCase()]);
  if (!rows.length || rows[0].password_hash !== hash) {
    ws.send(JSON.stringify({ type:'auth_fail', message:'Invalid credentials.' })); return;
  }
  const player = rows[0];

  // Kick existing session if any
  const existingWs = playerSockets.get(player.id);
  if (existingWs && existingWs !== ws) {
    existingWs.send(JSON.stringify({ type:'kicked', message:'You logged in from another location.' }));
    existingWs.close();
  }

  session.playerId = player.id;
  session.handle = player.handle;
  session.role = player.role;
  playerSockets.set(player.id, ws);

  const livePlayer = {
    id:player.id, handle:player.handle, role:player.role,
    current_zone:player.current_zone||'zone_start', anchor_zone:player.anchor_zone||'zone_start',
    hp:player.hp, hp_max:player.hp_max, sanity:player.sanity, sanity_max:player.sanity_max,
    hunger:player.hunger, thirst:player.thirst, radiation:player.radiation, credits:player.credits,
    stat_str:player.stat_str, stat_agi:player.stat_agi, stat_int:player.stat_int,
    stat_wil:player.stat_wil, stat_end:player.stat_end, stat_cha:player.stat_cha,
    armor:0, statuses:[],
  };
  setLivePlayer(player.id, livePlayer);
  addPlayerToZone(player.id, livePlayer.current_zone);
  await query('UPDATE players SET last_seen=EXTRACT(EPOCH FROM NOW()) WHERE id=$1', [player.id]);

  broadcast(livePlayer.current_zone, { type:'zone_event', message:`${player.handle} has arrived.` }, player.id);
  ws.send(JSON.stringify({ type:'auth_success', player:livePlayer }));

  const zone = getZone(livePlayer.current_zone);
  if (zone) ws.send(JSON.stringify({ type:'look', message:describeZone(zone, livePlayer) }));
}

async function handleGameCommand(ws, session, msg) {
  if (!session.playerId) { ws.send(JSON.stringify({ type:'error', message:'Not authenticated.' })); return; }
  const player = getLivePlayer(session.playerId);
  if (!player) { ws.send(JSON.stringify({ type:'error', message:'Session lost. Refresh and reconnect.' })); return; }
  const result = await handleCommand(msg.command, player, broadcast);
  if (result) {
    ws.send(JSON.stringify(result));
    if (result.player_update) ws.send(JSON.stringify({ type:'player_update', ...result.player_update }));
  }
}

async function handleDialogue(ws, session, msg) {
  if (!session.playerId) return;
  const { rows } = await query('SELECT * FROM npcs WHERE id=$1', [msg.npcId]);
  if (!rows.length) { ws.send(JSON.stringify({ type:'error', message:'NPC not found.' })); return; }
  const npc = rows[0];
  const node = (npc.dialogue_tree || {})[msg.choice];
  if (!node) { ws.send(JSON.stringify({ type:'dialogue_end', message:`${npc.name} has nothing more to say.` })); return; }
  ws.send(JSON.stringify({ type:'dialogue', npcId:msg.npcId, npcName:npc.name, node:msg.choice, text:node.text, options:node.options||[] }));
}

async function boot() {
  console.log('\n⚙  Booting ARCHITECT MUD...');
  await initWorld();
  await loadPlugins();
  startGameLoop(broadcast);
  startKeepalive();
  httpServer.listen(PORT, () => {
    console.log(`\n🏚  Running on http://localhost:${PORT}`);
    console.log(`   Player:  http://localhost:${PORT}`);
    console.log(`   Dev:     http://localhost:${PORT}/dev`);
    console.log(`   Health:  http://localhost:${PORT}/health\n`);
  });
}

boot().catch(e => { console.error('Boot failed:', e); process.exit(1); });
