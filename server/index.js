import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, extname, dirname } from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { createHash, randomUUID } from "crypto";

import {
	initWorld,
	addPlayerToZone,
	removePlayerFromZone,
	setLivePlayer,
	getLivePlayer,
	removeLivePlayer,
	getZone,
	getMinimapData,
	world,
} from "./engine/world.js";
import {
	handleCommand,
	describeZone,
	describeVoidTeleport,
	recomputeEquipped,
} from "./engine/commands/index.js";
import { startGameLoop } from "./engine/gameLoop.js";
import { loadPlugins, fireHook } from "./engine/plugins.js";
import { emit } from "./engine/events.js";
import { getNetXp, maxHpForEndurance } from "./engine/ip.js";
import { dispatchAction } from "./engine/actions.js";
// Side-effect imports: register the Flag store and graph-engine Actions
// (SET_FLAG, CLEAR_FLAG, GRANT_ITEM, TELEPORT, EXECUTE_SCRIPT, …) at boot.
import { filterDialogueOptions, renderDialogueNode } from "./engine/dialogue.js";
import "./engine/graph.js";
import { loadRecipes } from "./engine/crafting.js";
import { loadDrugs } from "./engine/drugs.js";
import { loadItems, getItem } from "./engine/items-cache.js";
import { reloadCrimes } from "./engine/crimes.js";
import { reloadAliases } from "./engine/commands/aliases.js";
import { loadMutations } from "./engine/mutations.js";
import { loadBanterLibrary } from "./engine/npc-banter.js";
import {
	handleApiRequest,
	setBroadcast,
	consumeSwitchToken,
	setGhostTokenStore,
} from "./api/routes.js";
import { cmdGhostLook, cmdGhostMove, cmdGhostHaunt, cmdGhostPowerDrain, makeGhostBroadcast } from "./engine/commands/ghost.js";
import { activateForcefield, deactivateForcefield, reconcileApartmentDoorLocks } from "./engine/apartments.js";
import { startKeepalive } from "./keepalive.js";
import { startUsageLog } from "./usage-log.js";
import { setBroadcast as setMessagingBroadcast } from "./engine/messaging.js";
import { handlePanelData, sendPanelCatalog } from "./engine/panels.js";
import pool, { query, logActivity } from "./models/db.js";
import { loadMisSettings, isMisServerEnabled } from "./engine/mis.js";
import { loadEmailVerificationSetting, isEmailVerificationEnabled } from "./engine/emailVerification.js";

import { initEnvironment, getHUDPayload, getZoneTemperature } from "./engine/environment.js";
import { getPlayerChannels, getChannelHistory } from "./engine/channels.js";
import { getMotd } from "./engine/motd.js";
import { openShopSession, closeShopSession } from "./engine/vendor-session.js";
import { getSoundReach } from "./engine/sounds.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const clients = new Map(); // ws -> session
const playerSockets = new Map(); // playerId -> ws
const reconnectTokens = new Map(); // token -> { playerId, expires }
const ghostTokens = new Map(); // token -> { playerId, zoneId, expires }

function issueReconnectToken(playerId) {
	const token = randomUUID();
	reconnectTokens.set(token, {
		playerId,
		expires: Date.now() + 10 * 60 * 1000,
	});
	return token;
}

setInterval(
	() => {
		const now = Date.now();
		for (const [token, entry] of reconnectTokens) {
			if (entry.expires < now) reconnectTokens.delete(token);
		}
		for (const [token, entry] of ghostTokens) {
			if (entry.expires < now) ghostTokens.delete(token);
		}
	},
	15 * 60 * 1000,
);

setGhostTokenStore((token, playerId, zoneId) => {
	ghostTokens.set(token, { playerId, zoneId, expires: Date.now() + 2 * 60 * 1000 });
});

function broadcast(
	zoneId,
	message,
	excludePlayerId = null,
	targetPlayerId = null,
	excludePlayerId2 = null,
	excludeSet = null,
) {
	const payload = JSON.stringify(message);
	if (targetPlayerId) {
		const ws = playerSockets.get(targetPlayerId);
		if (ws?.readyState === 1) ws.send(payload);
		return;
	}
	for (const [ws, session] of clients) {
		if (ws.readyState !== 1) continue;
		if (excludePlayerId && session.playerId === excludePlayerId) continue;
		if (excludePlayerId2 && session.playerId === excludePlayerId2) continue;
		if (excludeSet && excludeSet.has(session.playerId)) continue;
		if (session.isGhost) {
			// Ghost only receives broadcasts for its watched zone; skip global ones
			if (!zoneId || session.ghostZoneId !== zoneId) continue;
		} else if (zoneId) {
			const p = getLivePlayer(session.playerId);
			if (!p || p.current_zone !== zoneId) continue;
			// Asleep players don't perceive the room around them — no actions, speech, or ambience.
			if (p.sleeping) continue;
			// Aboard an airborne aircraft the player is up in the sky, not in the stale ground
			// zone they took off from — ground ambience (overfly noise, banter, vendors, weather)
			// must not leak into the cockpit. Their own game messages arrive targeted.
			if (p.posture === 'flying') continue;
		}
		ws.send(payload);
	}
	// Notify studio camera relay (broadcast plugin listens to this)
	if (zoneId && !targetPlayerId) emit('zone.broadcast', { zoneId, msg: message });
}

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
};

const httpServer = createServer(async (req, res) => {
	const url = req.url || "/";
	const cors = {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers": "Content-Type,Authorization",
		"Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
	};

	if (req.method === "OPTIONS") {
		res.writeHead(204, cors);
		res.end();
		return;
	}

	// Health check endpoint — used by keepalive and Render
	if (url === "/health") {
		res.writeHead(200, { "Content-Type": "application/json", ...cors });
		res.end(
			JSON.stringify({
				status: "ok",
				players: clients.size,
				uptime: process.uptime(),
			}),
		);
		return;
	}

	if (url.startsWith("/api/")) {
		let body = {};
		if (req.method !== "GET") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			try {
				body = JSON.parse(Buffer.concat(chunks).toString());
			} catch {}
		}
		let result;
		try {
			result = await handleApiRequest(url, req.method, body, req.headers);
		} catch (err) {
			console.error("API error:", url, err);
			result = {
				status: 500,
				body: { error: err.message || "Internal server error" },
			};
		}
		res.writeHead(result.status, {
			"Content-Type": "application/json",
			...cors,
			...(result.headers || {}),
		});
		// 304 Not Modified carries no body (the client reuses its cached copy).
		res.end(result.status === 304 ? undefined : JSON.stringify(result.body));
		return;
	}

	let filePath;
	if (url.startsWith("/dev")) {
		filePath = join(
			__dirname,
			"../client/devpanel",
			url === "/dev" || url === "/dev/"
				? "index.html"
				: url.replace("/dev", ""),
		);
	} else if (url.startsWith("/shared/")) {
		filePath = join(
			__dirname,
			"../client/shared",
			url.slice("/shared/".length),
		);
	} else {
		filePath = join(
			__dirname,
			"../client/game",
			url === "/" ? "index.html" : url,
		);
	}
	if (!existsSync(filePath)) {
		// Only fall back to the SPA shell for extension-less paths (real navigation
		// requests). A missing .js/.css file is a module-wiring bug — return a real
		// 404 so the browser console shows a useful error instead of an HTML parse
		// failure that silently breaks the module graph.
		if (extname(url)) {
			res.writeHead(404);
			res.end("Not found");
			return;
		}
		filePath = join(__dirname, "../client/game/index.html");
	}
	try {
		// No build step means asset URLs never change, so browsers would serve
		// stale JS/HTML after a deploy until a manual hard-refresh. Revalidate on
		// every load (no-cache) but keep it cheap: Last-Modified lets an unchanged
		// file answer with a 304. A redeploy rewrites mtimes, busting the cache.
		const lastMod = statSync(filePath).mtime.toUTCString();
		if (req.headers["if-modified-since"] === lastMod) {
			res.writeHead(304);
			res.end();
			return;
		}
		const data = readFileSync(filePath);
		res.writeHead(200, {
			"Content-Type": MIME[extname(filePath)] || "text/plain",
			"Cache-Control": "no-cache",
			"Last-Modified": lastMod,
		});
		res.end(data);
	} catch {
		res.writeHead(404);
		res.end("Not found");
	}
});

const wss = new WebSocketServer({ server: httpServer });

// Message types that count as deliberate player input for idle tracking —
// things a player typed or clicked, not the client keeping itself alive.
const IDLE_ACTIVITY_TYPES = new Set([
	"command", "dialogue", "buy_npc", "sell_npc", "sell_all_npc", "shop_close", "mis_toggle",
]);

wss.on("connection", (ws) => {
	clients.set(ws, {
		playerId: null,
		handle: null,
		role: null,
		isGhost: false,
	});

	// WebSocket keepalive ping/pong
	ws.isAlive = true;
	ws.on("pong", () => {
		ws.isAlive = true;
	});

	ws.on("message", async (data) => {
		// Any message — a real command, the client's own app-level ping, etc. —
		// proves the connection is alive. Don't rely solely on the raw WS
		// protocol ping/pong (below); some proxies mishandle control frames,
		// which would otherwise terminate a connection that's clearly still active.
		ws.isAlive = true;
		let msg;
		try {
			msg = JSON.parse(data.toString());
		} catch {
			return;
		}
		const session = clients.get(ws);
		// Idle-logoff activity stamp: deliberate player actions refresh the live
		// player's _lastInputAt (runtime-only; swept by the idle-logoff plugin).
		// Deliberately excludes auth, app-level pings, and the client's own
		// automation commands (sendCmdSilent tags them silent:true) — an
		// unattended client must still read as idle.
		if (session?.playerId && IDLE_ACTIVITY_TYPES.has(msg.type) && !msg.silent) {
			const live = getLivePlayer(session.playerId);
			if (live) live._lastInputAt = Date.now();
		}
		if (msg.type === "auth") return handleAuth(ws, session, msg);
		if (msg.type === "auth_token") return handleAuthToken(ws, session, msg);
		if (msg.type === "auth_reconnect")
			return handleReconnect(ws, session, msg);
		if (msg.type === "command") return handleGameCommand(ws, session, msg);
		if (msg.type === "dialogue") return handleDialogue(ws, session, msg);
		if (msg.type === "shop_close") { if (session.playerId) closeShopSession(session.playerId); return; }
		if (msg.type === "buy_npc") return handleBuyFromNpc(ws, session, msg);
		if (msg.type === "sell_npc") return handleSellToNpc(ws, session, msg);
		if (msg.type === "sell_all_npc") return handleSellAllToNpc(ws, session, msg);
		if (msg.type === "auth_ghost") return handleGhostAuth(ws, session, msg);
		if (msg.type === "ghost_command") return handleGhostCommand(ws, session, msg);
		if (msg.type === "ghost_jump") return handleGhostJump(ws, session, msg);
		if (msg.type === "ghost_refresh") return handleGhostRefresh(ws, session);
		if (msg.type === "ping") {
			ws.send(JSON.stringify({ type: "pong" }));
			return;
		}
		if (msg.type === "mis_toggle") return handleMisToggle(ws, session, msg);
		if (msg.type === "panel_data") return handlePanelData(session, msg);
		if (msg.type === "panel_watch" || msg.type === "panel_unwatch") {
			if (session.playerId)
				emit("panel.watch", { playerId: session.playerId, feeds: msg.type === "panel_watch" ? (msg.feeds || []) : [] });
			return;
		}
		if (msg.type === "panel_catalog") {
			if (session.playerId) {
				sendPanelCatalog(session);                                  // skills list (engine)
				emit("panel.catalog", { playerId: session.playerId });      // cameras (surveillance plugin)
			}
			return;
		}
		if (msg.type === "tv_watch" || msg.type === "tv_unwatch") {
			if (!session.playerId) return;
			if (msg.type === "tv_watch" && msg.channelId)
				emit("tv.watch", { playerId: session.playerId, channelId: msg.channelId });
			else
				emit("tv.unwatch", { playerId: session.playerId });
			return;
		}
		if (msg.type === "tv_poweroff") {
			if (!session.playerId) return;
			emit("tv.poweroff", { playerId: session.playerId });
			return;
		}
		if (msg.type === "tv_schedule") {
			if (!session.playerId) return;
			emit("tv.schedule", { playerId: session.playerId, channelId: msg.channelId });
			return;
		}
		if (msg.type === "deck_watch" || msg.type === "deck_unwatch") {
			if (!session.playerId) return;
			if (msg.type === "deck_watch" && msg.channelId)
				emit("deck.watch", { playerId: session.playerId, channelId: msg.channelId });
			else
				emit("deck.unwatch", { playerId: session.playerId });
			return;
		}
	});

	ws.on("close", async () => {
		const session = clients.get(ws);
		if (session?.playerId) {
			// Only clean up if this socket is still the active one for this player.
			// If a reconnect already ran finishAuth, playerSockets has been updated
			// to the new socket — don't undo that by removing the live player here.
			const isActiveSocket = playerSockets.get(session.playerId) === ws;
			const player = getLivePlayer(session.playerId);
			if (isActiveSocket) {
				if (player) {
					removePlayerFromZone(session.playerId, player.current_zone);
					broadcast(
						player.current_zone,
						{
							type: "zone_event",
							message: `${session.handle} has fallen asleep.`,
						},
						session.playerId,
					);
					for (const [zoneId, dist] of getSoundReach(player.current_zone, 2.0)) {
						if (dist > 0) broadcast(zoneId, { type: 'ambient', message: `<span class="msg-ambient msg-ambient-distant">Nearby, someone goes quiet.</span>` });
					}
					await activateForcefield(player, broadcast);
					await query(
						"UPDATE players SET last_seen=EXTRACT(EPOCH FROM NOW()), current_zone=$1, offline_sleeping=TRUE WHERE id=$2",
						[player.current_zone, session.playerId],
					).catch(() => {});
				} else {
					await query(
						"UPDATE players SET last_seen=EXTRACT(EPOCH FROM NOW()), offline_sleeping=TRUE WHERE id=$1",
						[session.playerId],
					).catch(() => {});
				}
				closeShopSession(session.playerId);
				emit('player.logout', { id: session.playerId, handle: session.handle });
				logActivity('disconnect', session.handle);
				broadcast(null, { type: 'online_change' });
				playerSockets.delete(session.playerId);
				removeLivePlayer(session.playerId);
			}
		}
		clients.delete(ws);
	});

	ws.send(
		JSON.stringify({
			type: "connected",
			message: "Connected to ARCHITECT.",
		}),
	);

	// Warm the Neon compute the moment a client connects, while they're still
	// on the login screen — so their auth query lands on a hot database. If the
	// wake takes more than a beat, tell the client so a free-tier cold start
	// reads as a normal part of connecting rather than a hang.
	warmDbCompute(ws);
});

// Fire a trivial query to wake a suspended Neon compute (free tier scales to
// zero after ~5 min idle). If it doesn't answer within WARM_NOTICE_MS, send a
// "waking" notice; clear it with "awake" once the compute responds. When the
// DB is already hot the query returns fast and neither message is sent, so
// there's no flicker in the common case. Errors are swallowed — a failed warm-up
// just means the real auth query will surface the problem normally.
const WARM_NOTICE_MS = 600;
function warmDbCompute(ws) {
	let noticed = false;
	const timer = setTimeout(() => {
		noticed = true;
		if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "waking" }));
	}, WARM_NOTICE_MS);
	query("SELECT 1")
		.catch(() => {})
		.finally(() => {
			clearTimeout(timer);
			if (noticed && ws.readyState === ws.OPEN)
				ws.send(JSON.stringify({ type: "awake" }));
		});
}

// WebSocket heartbeat — kills stale connections
const heartbeat = setInterval(() => {
	for (const [ws] of clients) {
		if (!ws.isAlive) {
			ws.terminate();
			continue;
		}
		ws.isAlive = false;
		ws.ping();
	}
}, 30000);

wss.on("close", () => clearInterval(heartbeat));

async function handleGhostAuth(ws, session, msg) {
	const entry = ghostTokens.get(msg.token || '');
	if (!entry || entry.expires < Date.now()) {
		ghostTokens.delete(msg.token || '');
		ws.send(JSON.stringify({ type: 'ghost_auth_fail', message: 'Invalid or expired ghost token.' }));
		return;
	}
	ghostTokens.delete(msg.token);
	const { rows } = await query('SELECT handle FROM players WHERE id=$1', [entry.playerId]);
	if (!rows.length) {
		ws.send(JSON.stringify({ type: 'ghost_auth_fail', message: 'Player not found.' }));
		return;
	}
	session.isGhost = true;
	session.ghostZoneId = entry.zoneId;
	session.playerId = entry.playerId;
	session.handle = rows[0].handle;
	ws.send(JSON.stringify({ type: 'ghost_auth_success' }));
	const lookResult = await cmdGhostLook(session);
	ws.send(JSON.stringify(lookResult));
}

const GHOST_MOVE_VERBS = new Set(['go','move','enter']);
const GHOST_DIRECTIONS = new Set(['north','south','east','west','up','down','in','out','exit','n','s','e','w','u','d']);
const GHOST_DIR_EXPAND = { n:'north', s:'south', e:'east', w:'west', u:'up', d:'down' };

async function handleGhostCommand(ws, session, msg) {
	if (!session.isGhost) return;
	const raw = (msg.command || '').trim();
	if (!raw) return;
	const lower = raw.toLowerCase();
	const parts = lower.split(/\s+/);
	const verb = parts[0];
	const rest = parts.slice(1).join(' ');

	// Every ghost action feeds the audio plugin's "unseen presence" cadence
	// (it plays a subtle spooky sound to the zone on every Nth action).
	emit('ghost.action', { zoneId: session.ghostZoneId });

	// look
	if (verb === 'look' || verb === 'l') {
		const result = await cmdGhostLook(session);
		ws.send(JSON.stringify(result));
		return;
	}

	// movement — route through ghost move so session.ghostZoneId stays in sync
	if (GHOST_DIRECTIONS.has(verb)) {
		const dir = GHOST_DIR_EXPAND[verb] || verb;
		const result = await cmdGhostMove(dir, session);
		ws.send(JSON.stringify(result));
		return;
	}
	if (GHOST_MOVE_VERBS.has(verb) && rest) {
		const dir = GHOST_DIR_EXPAND[rest] || rest;
		const result = await cmdGhostMove(dir, session);
		ws.send(JSON.stringify(result));
		return;
	}

	// haunt
	if (verb === 'haunt' && rest) {
		const result = await cmdGhostHaunt(raw.slice(6).trim(), session, broadcast);
		ws.send(JSON.stringify(result));
		return;
	}

	// drain — cut this zone's power to zero (ghost sabotage; visibility fades to dark)
	if (verb === 'drain') {
		const result = await cmdGhostPowerDrain(session, broadcast);
		ws.send(JSON.stringify(result));
		if (result.type === 'ghost_power_drained') {
			emit('ghost.drain', { zoneId: session.ghostZoneId });
			// Re-render the ghost's own area view so the drained darkness shows
			// on the ghost screen too — same visibility fade the zone's players get.
			ws.send(JSON.stringify(await cmdGhostLook(session)));
		}
		return;
	}

	// everything else — run through the full command engine at the ghost's zone
	const livePlayer = getLivePlayer(session.playerId);
	const ghostPlayer = { ...(livePlayer || {}), id: session.playerId, handle: session.handle, current_zone: session.ghostZoneId };
	const ghostBroadcast = makeGhostBroadcast(broadcast, session.playerId);
	const result = await handleCommand(raw, ghostPlayer, ghostBroadcast);
	if (result) {
		ws.send(JSON.stringify(result));
		// Mirror the game client's post-command `look`: room-changing actions
		// refresh the area pane so it doesn't go stale under the ghost.
		if (ghostResultChangesRoom(result)) ws.send(JSON.stringify(await cmdGhostLook(session)));
	}
}

// Result types after which the game client re-issues a silent `look` (see
// client/game/js/dispatch.js). The ghost re-renders its area pane the same way.
const GHOST_RELOOK_TYPES = new Set(['combat', 'take', 'drop']);
function ghostResultChangesRoom(result) {
	if (!result) return false;
	if (GHOST_RELOOK_TYPES.has(result.type)) return true;
	if (result.type === 'action' && result.triggerLook) return true;
	if (result.type === 'loot' && result.closeLoot) return true;
	return false;
}

async function handleGhostRefresh(ws, session) {
	if (!session.isGhost) return;
	ws.send(JSON.stringify(await cmdGhostLook(session)));
}

async function handleAuth(ws, session, msg) {
	const hash = createHash("sha256")
		.update(msg.password || "")
		.digest("hex");
	const { rows } = await query("SELECT * FROM players WHERE username=$1", [
		msg.username?.toLowerCase(),
	]);
	if (!rows.length || rows[0].password_hash !== hash) {
		ws.send(
			JSON.stringify({
				type: "auth_fail",
				message: "Invalid credentials.",
			}),
		);
		return;
	}
	if (isEmailVerificationEnabled() && !rows[0].email_verified) {
		ws.send(JSON.stringify({ type: "auth_fail", message: "Please verify your email before logging in.", needsVerification: true }));
		return;
	}
	await finishAuth(ws, session, rows[0]);
}

async function handleAuthToken(ws, session, msg) {
	const entry = consumeSwitchToken(msg.token || "");
	if (!entry) {
		ws.send(
			JSON.stringify({
				type: "auth_fail",
				message: "Invalid or expired switch token.",
			}),
		);
		return;
	}
	const { rows } = await query("SELECT * FROM players WHERE id=$1", [
		entry.playerId,
	]);
	if (!rows.length) {
		ws.send(
			JSON.stringify({ type: "auth_fail", message: "Player not found." }),
		);
		return;
	}
	await finishAuth(ws, session, rows[0]);
}

async function handleReconnect(ws, session, msg) {
	const entry = reconnectTokens.get(msg.token || "");
	if (!entry || entry.expires < Date.now()) {
		reconnectTokens.delete(msg.token || "");
		ws.send(
			JSON.stringify({
				type: "auth_fail",
				message: "Session expired. Please log in again.",
			}),
		);
		return;
	}
	reconnectTokens.delete(msg.token); // one-time use
	const { rows } = await query("SELECT * FROM players WHERE id=$1", [
		entry.playerId,
	]);
	if (!rows.length) {
		ws.send(
			JSON.stringify({ type: "auth_fail", message: "Player not found." }),
		);
		return;
	}
	await finishAuth(ws, session, rows[0]);
}

// Equip any unequipped items tagged auto_equip into their designated slot,
// provided that slot is currently empty. Runs at login to recover from
// partial registration failures and to handle items given while offline.
async function autoEquipOnLogin(playerId) {
	const { rows: unequipped } = await query(
		`SELECT pi.id, i.tags->>'slot' AS slot
		 FROM player_inventory pi JOIN items i ON i.id = pi.item_id
		 WHERE pi.player_id = $1 AND pi.is_equipped = 0
		   AND jsonb_exists(i.tags,'auto_equip')
		   AND i.tags ? 'slot'`,
		[playerId],
	);
	if (!unequipped.length) return;
	const { rows: occupied } = await query(
		`SELECT slot FROM player_inventory WHERE player_id = $1 AND is_equipped = 1`,
		[playerId],
	);
	const occupiedSlots = new Set(occupied.map((r) => r.slot));
	for (const item of unequipped) {
		if (item.slot && !occupiedSlots.has(item.slot)) {
			await query(
				`UPDATE player_inventory SET is_equipped = 1, slot = $1 WHERE id = $2`,
				[item.slot, item.id],
			);
			occupiedSlots.add(item.slot);
		}
	}
}

function loginBodyTempMessage(tempC) {
	if (tempC === null || tempC === undefined) return null;
	if (tempC >= 36 && tempC <= 38) return null;
	// Cold side
	if (tempC < 30)  return 'You are in the grip of hypothermia. Your body is shutting down.';
	if (tempC < 32)  return 'Your core is dangerously cold. Find warmth immediately.';
	if (tempC < 34)  return 'You\'re shivering. You need to warm up.';
	if (tempC < 36)  return 'You feel a little chilly.';
	// Hot side
	if (tempC > 42)  return 'You are in the grip of heat stroke. You are dying.';
	if (tempC > 41)  return 'Your body is overheating badly.';
	if (tempC > 39)  return 'The heat is getting to you. Find shade and water.';
	return 'You feel uncomfortably warm.';
}

async function finishAuth(ws, session, player) {
	const existingWs = playerSockets.get(player.id);
	if (existingWs && existingWs !== ws) {
		existingWs.send(
			JSON.stringify({
				type: "kicked",
				message: "You logged in from another location.",
			}),
		);
		existingWs.close();
	}

	session.playerId = player.id;
	session.handle = player.handle;
	session.role = player.role;
	playerSockets.set(player.id, ws);

	// Keep max HP in sync with endurance. Self-heals pre-existing characters
	// whose stored hp_max predates endurance-scaled HP (no migration script).
	const correctHpMax = maxHpForEndurance(player.stat_endurance);
	if (player.hp_max !== correctHpMax) {
		player.hp_max = correctHpMax;
		player.hp = Math.min(player.hp, correctHpMax);
		await query("UPDATE players SET hp_max=$1, hp=$2 WHERE id=$3", [
			player.hp_max,
			player.hp,
			player.id,
		]);
	}

	const livePlayer = {
		id: player.id,
		handle: player.handle,
		role: player.role,
		origin_fragment: player.origin_fragment || '',
		archetype: player.archetype || null,
		visibly_mutated: player.visibly_mutated || 0,
		covered_in_blood: player.covered_in_blood || 0,
		current_zone: player.current_zone || "zone_start",
		anchor_zone: player.anchor_zone || "zone_start",
		hp: player.hp,
		hp_max: player.hp_max,
		sanity: player.sanity,
		sanity_max: player.sanity_max,
		hunger: player.hunger,
		thirst: player.thirst,
		radiation: player.radiation,
		credits: player.credits,
		bank_credits: player.bank_credits || 0,
		stat_brawn: player.stat_brawn,
		stat_reflexes: player.stat_reflexes,
		stat_endurance: player.stat_endurance,
		stat_brains: player.stat_brains,
		stat_cool: player.stat_cool,
		stat_senses: player.stat_senses,
		xp: 0,
		total_xp: 0,
		armor: 0,
		statuses: [],
		stamina: player.stamina ?? 100,
		stamina_max: player.stamina_max ?? 100,
		body_temp_c: player.body_temp_c ?? 37.0,
		insulation: 0,
		wetness: 0,
		_prevWetness: 0,
		// Appearance & biological systems
		biological_sex: player.biological_sex || 'male',
		hair_style: player.hair_style || 'short',
		hair_length: player.hair_length || 'short',
		hair_color: player.hair_color || 'brown',
		eye_color: player.eye_color || 'brown',
		height_cm: player.height_cm || 170,
		weight_kg: player.weight_kg || 70,
		appearance_free_used: player.appearance_free_used || 0,
		appearance_data: player.appearance_data || {},
		mis_enabled: player.mis_enabled || 0,
		horniness: player.horniness || 0,
		erect: player.erect || 0,
		digestive_load: player.digestive_load || 0,
		hydration_load: player.hydration_load || 0,
		clothing_contamination: player.clothing_contamination || {},
		mob_kills: player.mob_kills || 0,
		player_kills: player.player_kills || 0,
		deaths: player.deaths || 0,
		home_zone: player.home_zone || null,
	};
	const { total: totalXp, net: netXp } = await getNetXp(player.id);
	livePlayer.xp = Math.floor(netXp);
	livePlayer.total_xp = totalXp;
	// Seed the resource diff-gate stamp (Phase 6) from the freshly-loaded row so
	// the first resourceTick after login doesn't write values that never changed.
	livePlayer._lastSavedResources = {
		hunger: livePlayer.hunger, thirst: livePlayer.thirst, hp: livePlayer.hp,
		stamina: livePlayer.stamina, body_temp_c: livePlayer.body_temp_c,
	};
	setLivePlayer(player.id, livePlayer);
	logActivity('connect', player.handle);
	broadcast(null, { type: 'online_change' });
	await deactivateForcefield(player.id, livePlayer.home_zone, broadcast);
	await autoEquipOnLogin(player.id);
	await recomputeEquipped(livePlayer);
	addPlayerToZone(player.id, livePlayer.current_zone);
	const diedOffline = player.died_offline;
	await query(
		"UPDATE players SET last_seen=EXTRACT(EPOCH FROM NOW()), offline_sleeping=FALSE, died_offline=FALSE WHERE id=$1",
		[player.id],
	);

	broadcast(
		livePlayer.current_zone,
		{ type: "zone_event", message: `${player.handle} has arrived.`, refresh: true },
		player.id,
	);
	for (const [zoneId, dist] of getSoundReach(livePlayer.current_zone, 2.0)) {
		if (dist > 0) {
			const stirMessages = [
				'Nearby, someone stirs.',
				'You hear movement not far off.',
				'Something shifts in the distance.',
				'A presence makes itself known nearby.',
				'Footsteps. Close.',
				'Someone\'s up.',
				'There\'s a rustling somewhere close.',
				'You sense movement nearby.',
				'Not far away, someone\'s awake.',
				'A sound. Someone moving.',
			];
			const msg = stirMessages[Math.floor(Math.random() * stirMessages.length)];
			broadcast(zoneId, { type: 'ambient', message: `<span class="msg-ambient msg-ambient-distant">${msg}</span>` }, player.id);
		}
	}
	let envHUD = null;
	try {
		envHUD = { ...getHUDPayload(), tempC: getZoneTemperature(livePlayer.current_zone) };
	} catch {}
	const DEV_ROLES = ["admin", "dev", "builder", "designer"];
	const apiToken = DEV_ROLES.includes(player.role)
		? Buffer.from(`${player.id}:${player.role}:${Date.now()}`).toString(
				"base64",
			)
		: null;
	const reconnectToken = issueReconnectToken(player.id);
	ws.send(
		JSON.stringify({
			type: "auth_success",
			player: livePlayer,
			env: envHUD,
			apiToken,
			reconnectToken,
			channels: getPlayerChannels(livePlayer),
		}),
	);

	try {
		const history = await getChannelHistory(livePlayer);
		if (Object.keys(history).length) {
			ws.send(JSON.stringify({ type: "channel_history", history }));
		}
	} catch (err) {
		console.error("channel history load failed:", err.message);
	}

	// Send all three MOTD templates to client; client picks size based on its settings
	try {
		const motd = await getMotd();
		ws.send(JSON.stringify({ type: 'motd', ...motd }));
	} catch {}

	const bodyTempLoginMsg = loginBodyTempMessage(livePlayer.body_temp_c);
	let zone = getZone(livePlayer.current_zone);
	// Dreamzone rescue: a trip is in-memory only, so a player caught mid-trip by
	// a server restart would otherwise wake inside an isolated hallucination zone.
	// Bounce them back to their anchor.
	if (zone?.flags?.is_dreamzone) {
		const anchor = livePlayer.anchor_zone || "zone_start";
		removePlayerFromZone(player.id, livePlayer.current_zone);
		livePlayer.current_zone = anchor;
		addPlayerToZone(player.id, anchor);
		await query("UPDATE players SET current_zone=$1 WHERE id=$2", [anchor, player.id]);
		zone = getZone(anchor);
	}
	if (zone) {
		ws.send(
			JSON.stringify({
				type: "look",
				message: await describeZone(zone, livePlayer),
				zone: zone.id,
				minimap: getMinimapData(zone.id, 8, livePlayer),
			}),
		);
		if (bodyTempLoginMsg) ws.send(JSON.stringify({ type: 'system', message: bodyTempLoginMsg }));
		if (diedOffline) ws.send(JSON.stringify({ type: 'player_death', message: `\n<span class="death-message">☠ You were murdered in your sleep. You wake up somewhere else, someone else's problem.</span>\n<span class="clone-vat-message">A vending-machine-shaped cloning vat hums, dispenses a fresh you, and prints a receipt nobody asked for. Everything you knew, you still know. Everything that hurt, doesn't anymore.</span>` }));
	} else {
		// Their stored zone was deleted while they were offline — the live
		// rescue in routes.js only catches players connected at deletion time,
		// so this is the equivalent safety net for everyone else.
		livePlayer.current_zone = "zone_start";
		addPlayerToZone(player.id, "zone_start");
		await query("UPDATE players SET current_zone=$1 WHERE id=$2", [
			"zone_start",
			player.id,
		]);
		const startZone = getZone("zone_start");
		if (startZone) {
			ws.send(
				JSON.stringify({
					type: "move",
					message:
						describeVoidTeleport() +
						(await describeZone(startZone, livePlayer)),
					zone: "zone_start",
					minimap: getMinimapData("zone_start", 8, livePlayer),
				}),
			);
			broadcast(
				"zone_start",
				{
					type: "zone_event",
					message: `${player.handle} flickers into existence out of nowhere.`,
				},
				player.id,
			);
			if (bodyTempLoginMsg) ws.send(JSON.stringify({ type: 'system', message: bodyTempLoginMsg }));
		}
	}
	emit('player.login', { id: player.id, handle: player.handle, role: player.role });
}


async function handleMisToggle(ws, session, msg) {
	if (!session.playerId) return;
	if (!isMisServerEnabled()) {
		ws.send(JSON.stringify({ type: 'player_update', mis_enabled: 0, mis_server_disabled: true }));
		return;
	}
	const player = getLivePlayer(session.playerId);
	if (!player) return;
	const enable = !!msg.enable;
	player.mis_enabled = enable ? 1 : 0;
	player.horniness = enable ? (player.horniness || 0) : 0;
	player.erect = enable ? (player.erect || 0) : 0;
	await query('UPDATE players SET mis_enabled=$1, horniness=$2, erect=$3 WHERE id=$4',
		[player.mis_enabled, player.horniness, player.erect, player.id]);
	ws.send(JSON.stringify({
		type: 'player_update',
		mis_enabled: player.mis_enabled,
		horniness: player.horniness,
	}));
	// The MIS plugin owns the consequences: stops ongoing events on disable,
	// sends the tutorial / disabled message.
	emit('mis.toggled', { player, enabled: enable });
}

// Per-connection command rate limit (token bucket). The only sustained legitimate
// sources are macros (~2.9 cmd/s at the 350ms stagger), auto-walk (self-paced),
// and a person clicking (bursts to ~8-10/s in combat), so 5/s sustained with a
// 15-command burst clears every real player while throttling a runaway client
// loop. Extra commands are dropped, not queued, and a throttled error tells the
// player. Client-side verbs never reach here, so this only sees real commands.
const CMD_BUCKET_CAP = 15;       // burst allowance (tokens)
const CMD_REFILL_PER_SEC = 5;    // sustained refill rate
const CMD_NOTICE_COOLDOWN_MS = 2000; // min gap between "slow down" errors

function commandAllowed(session) {
	const now = Date.now();
	const b = session.cmdBucket || (session.cmdBucket = { tokens: CMD_BUCKET_CAP, last: now, notifiedAt: 0 });
	b.tokens = Math.min(CMD_BUCKET_CAP, b.tokens + ((now - b.last) / 1000) * CMD_REFILL_PER_SEC);
	b.last = now;
	if (b.tokens < 1) return false;
	b.tokens -= 1;
	return true;
}

async function handleGameCommand(ws, session, msg) {
	if (!session.playerId) {
		ws.send(
			JSON.stringify({ type: "error", message: "Not authenticated." }),
		);
		return;
	}
	if (!commandAllowed(session)) {
		// Throttle the error itself so a fast loop doesn't get a flood of toasts.
		const now = Date.now();
		if (now - (session.cmdBucket.notifiedAt || 0) > CMD_NOTICE_COOLDOWN_MS) {
			session.cmdBucket.notifiedAt = now;
			ws.send(JSON.stringify({
				type: "error",
				code: "rate_limit",
				message: "⚠ Slow down — you're sending commands too fast. Extra commands are being dropped.",
			}));
		}
		return;
	}
	const player = getLivePlayer(session.playerId);
	if (!player) {
		ws.send(
			JSON.stringify({
				type: "error",
				message: "Session lost. Refresh and reconnect.",
			}),
		);
		return;
	}
	const result = await handleCommand(msg.command, player, broadcast);
	if (result) {
		ws.send(JSON.stringify(result));
		if (result.player_update)
			ws.send(
				JSON.stringify({
					type: "player_update",
					...result.player_update,
				}),
			);
		if (result.type === 'equip') {
			await recomputeEquipped(player);
		}
	}
}

async function handleGhostJump(ws, session, msg) {
	if (!session.isGhost) return;
	const { zoneId } = msg;
	if (!zoneId) return;
	const zone = getZone(zoneId);
	if (!zone) { ws.send(JSON.stringify({ type: 'ghost_error', message: 'Zone not found.' })); return; }
	session.ghostZoneId = zoneId;
	const lookResult = await cmdGhostLook(session);
	ws.send(JSON.stringify(lookResult));
}

async function handleDialogue(ws, session, msg) {
	if (!session.playerId) return;
	// world.npcs is authoritative — every npcs writer funnels through it (see
	// the npcs write funnel in world.js), so dialogue reads the live entry.
	const npc = world.npcs.get(msg.npcId);
	if (!npc) {
		ws.send(JSON.stringify({ type: "error", message: "NPC not found." }));
		return;
	}

	// The implicit "Browse your wares." option (engine/dialogue.js injects it for
	// vendors that don't author their own shop door).
	if (msg.choice === "__shop__") {
		await openNpcShop(ws, session, npc);
		return;
	}

	const player = getLivePlayer(session.playerId);

	// Execute option-level actions if the player clicked a specific option
	// from the previous node (identified by optionIndex in the incoming message).
	let appendMessage = "";
	if (player && msg.optionIndex != null && session.dialogueNode) {
		const prevNode = (npc.dialogue_tree || {})[session.dialogueNode];
		if (prevNode) {
			// Re-filter previous node's options to match what the client saw.
			const filteredOpts = await filterDialogueOptions(prevNode.options, npc.dialogue_tree, player);
			const clickedOpt = filteredOpts[msg.optionIndex];
			if (clickedOpt?.actions?.length) {
				for (const a of clickedOpt.actions) {
					if (!a?.action) continue;
					const result = await dispatchAction({
						type: a.action,
						actor: player,
						// Dialogue actions are authored FLAT ({action, quest_id, …}) by the VINE
				// dialogue editor, so fall back to the action object itself as the params
				// bag (AI/script graphs nest under .params — hence the `|| a`).
				params: a.params || a,
						context: { broadcast, npc },
					});
					if (result?.type === "grant" && result.granted) {
						appendMessage += `\n\n<span class="item-grant">You receive: ${result.name}${result.quantity > 1 ? ` x${result.quantity}` : ""}.</span>`;
					} else if (result?.type === "goto_node" && result.node) {
						// GOTO_NODE from an option action overrides the destination.
						msg.choice = result.node;
					} else if (result?.type === "error") {
						console.warn(`[dialogue] option action ${a.action} failed: ${result.message}`);
					}
				}
			}
		}
	}

	// A node authored to open the vendor shop (OPEN_SHOP action) IS the shop — the
	// GUI shop panel is its terminal UI. Route it through the same clean shop-open
	// as "__shop__" and stop, rather than letting renderDialogueNode fire OPEN_SHOP
	// and THEN send a `dialogue` message that the client renders into the same panel,
	// clobbering the shop that just opened. (This is why a vendor's authored shop
	// option looked like it "didn't open the shop".)
	const targetNode = (npc.dialogue_tree || {})[msg.choice];
	if (targetNode?.actions?.some((a) => a?.action === "OPEN_SHOP")) {
		await openNpcShop(ws, session, npc);
		return;
	}

	// Runs the node's Actions (Phase 4; `grants_item` legacy GRANT_ITEM shorthand
	// included) and Condition/quest-completion-gates its options — see
	// engine/dialogue.js (shared with Tablet OS's "Turn In" NPC hand-off).
	const rendered = await renderDialogueNode(npc, msg.choice, player, { broadcast, npc });
	if (!rendered) {
		ws.send(
			JSON.stringify({
				type: "dialogue_end",
				message: `${npc.name} has nothing more to say.`,
			}),
		);
		return;
	}

	// Track the current node in session so option-level actions can be resolved
	// on the player's next dialogue message.
	session.dialogueNode = msg.choice;

	ws.send(
		JSON.stringify({
			type: "dialogue",
			npcId: msg.npcId,
			npcName: npc.name,
			node: msg.choice,
			text: appendMessage ? rendered.text + appendMessage : rendered.text,
			options: rendered.options,
		}),
	);
}

// Open a vendor's shop for the player: guards (has-stock, open-hours), start the
// shop session, and push the GUI panel. The single clean shop-open path shared by
// the implicit "__shop__" option and any dialogue node authored with an OPEN_SHOP
// action — so the two can't drift on guards or payload.
async function openNpcShop(ws, session, npc) {
	const player = getLivePlayer(session.playerId);
	if (!player) return;
	if (!npc.vendor_inventory?.length) {
		ws.send(JSON.stringify({ type: "error", message: `${npc.name} has nothing to sell.` }));
		return;
	}
	const { isVendorClosed, vendorClosedLine } = await import("./engine/ai-behaviour.js");
	if (isVendorClosed(npc)) {
		ws.send(JSON.stringify({ type: "error", message: vendorClosedLine(npc) }));
		return;
	}
	openShopSession(session.playerId, npc.id);
	await sendShopPanel(ws, npc, session.playerId);
}

// Render the GUI shop panel (both Buy stock and Sell inventory) for a player.
// Shared by shop-open, buy, and sell so the three paths can't drift on payload shape.
async function sendShopPanel(ws, npc, playerId, extra = {}) {
	const player = getLivePlayer(playerId);
	if (!player) return;
	const { getVendorStock, getSellableInventory } = await import("./engine/vendor.js");
	const stock = await getVendorStock(npc, playerId);
	const inventory = await getSellableInventory(player, npc);
	ws.send(JSON.stringify({
		type: "dialogue_shop",
		npcId: npc.id,
		npcName: npc.name,
		stock,
		inventory,
		credits: player.credits,
		...extra,
	}));
}

async function handleBuyFromNpc(ws, session, msg) {
	if (!session.playerId) return;
	const player = getLivePlayer(session.playerId);
	if (!player) return;
	const npc = world.npcs.get(msg.npcId);
	if (!npc) { ws.send(JSON.stringify({ type: "error", message: "NPC not found." })); return; }
	// Furniture is delivered to an owned apartment rather than carried in inventory
	// (mirrors the `buy` command's furniture branch in the commerce plugin). Buying
	// via the shop dialog must take the same path or it wrongly lands in inventory.
	const boughtItem = getItem(msg.itemId);
	if (boughtItem && boughtItem.type === "furniture") {
		const { buyFurniture } = await import("./engine/furniture-shop.js");
		const catalogueEntry = (npc.vendor_inventory || []).find(e => e.item_id === msg.itemId);
		const fr = await buyFurniture(player, npc, boughtItem, catalogueEntry);
		await sendShopPanel(ws, npc, session.playerId, { buyResult: fr.message, buySuccess: fr.type === "buy" });
		if (fr.type === "buy") {
			ws.send(JSON.stringify({ type: "player_update", credits: player.credits }));
		}
		return;
	}
	const { buyFromVendor } = await import("./engine/vendor.js");
	const result = await buyFromVendor(player, npc, msg.itemId, 1);
	await sendShopPanel(ws, npc, session.playerId, { buyResult: result.message, buySuccess: result.success });
	if (result.success) {
		ws.send(JSON.stringify({ type: "player_update", credits: player.credits }));
	}
}

async function handleSellToNpc(ws, session, msg) {
	if (!session.playerId) return;
	const player = getLivePlayer(session.playerId);
	if (!player) return;
	const npc = world.npcs.get(msg.npcId);
	if (!npc) { ws.send(JSON.stringify({ type: "error", message: "NPC not found." })); return; }
	const { sellToVendor } = await import("./engine/vendor.js");
	const result = await sellToVendor(player, npc, msg.inventoryId, msg.quantity || 1);
	await sendShopPanel(ws, npc, session.playerId, { sellResult: result.message, sellSuccess: result.success });
	if (result.success) {
		ws.send(JSON.stringify({ type: "player_update", credits: player.credits }));
	}
}

async function handleSellAllToNpc(ws, session, msg) {
	if (!session.playerId) return;
	const player = getLivePlayer(session.playerId);
	if (!player) return;
	const npc = world.npcs.get(msg.npcId);
	if (!npc) { ws.send(JSON.stringify({ type: "error", message: "NPC not found." })); return; }
	const { sellToVendor, getSellableInventory } = await import("./engine/vendor.js");
	const sellable = await getSellableInventory(player, npc);
	const creditsBefore = player.credits || 0;
	let sold = 0, failMessage = null;
	for (const item of sellable) {
		const result = await sellToVendor(player, npc, item.inventory_id, item.quantity);
		if (!result.success) { failMessage = result.message; break; }
		sold += item.quantity;
	}
	const earned = (player.credits || 0) - creditsBefore;
	const sellResult = failMessage
		? failMessage
		: sold
			? `You sell ${sold} item${sold === 1 ? "" : "s"} for ${earned} credits. (${player.credits} total)`
			: "Nothing to sell.";
	await sendShopPanel(ws, npc, session.playerId, { sellResult, sellSuccess: !failMessage && sold > 0 });
	if (sold) ws.send(JSON.stringify({ type: "player_update", credits: player.credits }));
}

// Safety net: a bug in any single request handler should never be able
// to take the whole server down. Log it, keep running.
process.on("uncaughtException", (err) => {
	console.error("⚠ Uncaught exception (server staying up):", err);
});
process.on("unhandledRejection", (err) => {
	console.error("⚠ Unhandled rejection (server staying up):", err);
});

async function boot() {
	console.log("\n⚙  Booting ARCHITECT MUD...");
	setBroadcast(broadcast);
	setMessagingBroadcast(broadcast);
	await loadMisSettings();
	await loadEmailVerificationSetting();
	await initWorld();
	// Door lock state isn't persisted (world.doors resets to authored state); re-apply
	// each locked apartment's durable lock onto its door(s) in RAM.
	reconcileApartmentDoorLocks();
	// Sweep loot for monster corpses (not persisted) and expired player corpses.
	// Player corpses loaded by initWorld() keep their player_inventory rows.
	await query(
		`DELETE FROM player_inventory
		 WHERE (player_id LIKE 'corpse_%' OR player_id LIKE '_corpse_%')
		 AND player_id NOT IN (SELECT id FROM player_corpses WHERE expires_at > $1)`,
		[Date.now()],
	).catch(() => {});
	await loadRecipes();
	await loadDrugs();
	await loadItems();
	await reloadCrimes();
	await reloadAliases();
	await loadMutations();
	await loadBanterLibrary();
	await loadPlugins();
	try {
		await initEnvironment({
			query,
			broadcast: (zoneIdOrPayload, payload) =>
				broadcast(
					payload !== undefined ? zoneIdOrPayload : null,
					payload !== undefined ? payload : zoneIdOrPayload,
				),
			emitHook: fireHook,
			// Zones currently occupied by a connected, non-ghost player — lets the
			// weather field push per-zone updates only where they'll be seen.
			getOccupiedZones: () => {
				const zs = new Set();
				for (const [ws, session] of clients) {
					if (ws.readyState !== 1 || session.isGhost) continue;
					const p = getLivePlayer(session.playerId);
					if (p?.current_zone) zs.add(p.current_zone);
				}
				return zs;
			},
		});
	} catch (e) {
		console.error(
			"⚠ Environment system failed to init (continuing without it — likely means `npm run db:schema` hasn't been run against this database yet):",
			e.message,
		);
	}
	startGameLoop(broadcast);
	startKeepalive();
	startUsageLog();

	// Single-instance guard: if the port is already taken, another server is
	// running. Exit fast instead of lingering as a zombie that still holds a DB
	// connection pool (a prime cause of pooler "max clients" errors).
	httpServer.on("error", (e) => {
		if (e.code === "EADDRINUSE") {
			console.error(`\n✗ Port ${PORT} is already in use — another server is running. Exiting.\n`);
			process.exit(1);
		}
		throw e;
	});

	httpServer.listen(PORT, () => {
		console.log(`\n🏚  Running on http://localhost:${PORT}`);
		console.log(`   Player:  http://localhost:${PORT}`);
		console.log(`   Dev:     http://localhost:${PORT}/dev`);
		console.log(`   Health:  http://localhost:${PORT}/health\n`);
	});
}

// Graceful shutdown: release DB connections immediately on Ctrl-C / kill so a
// restart starts clean and doesn't leave connections lingering on the pooler.
let _shuttingDown = false;
async function shutdown(signal) {
	if (_shuttingDown) return;
	_shuttingDown = true;
	console.log(`\n${signal} — shutting down…`);
	httpServer.close();
	try { await pool.end(); } catch { /* pool already closed */ }
	process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

boot().catch((e) => {
	console.error("Boot failed:", e);
	process.exit(1);
});
