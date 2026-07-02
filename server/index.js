import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
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
} from "./engine/world.js";
import {
	handleCommand,
	describeZone,
	describeVoidTeleport,
	recomputeArmor,
	recomputeInsulation,
} from "./engine/commands/index.js";
import { startGameLoop } from "./engine/gameLoop.js";
import { loadPlugins, fireHook } from "./engine/plugins.js";
import { emit } from "./engine/events.js";
import { getNetXp, maxHpForEndurance } from "./engine/ip.js";
import { dispatchAction } from "./engine/actions.js";
// Side-effect imports: register the Flag store and graph-engine Actions
// (SET_FLAG, CLEAR_FLAG, GRANT_ITEM, TELEPORT, EXECUTE_SCRIPT, …) at boot.
import { evalConditions } from "./engine/flags.js";
import "./engine/graph.js";
import { loadRecipes } from "./engine/crafting.js";
import { loadDrugs } from "./engine/drugs.js";
import { loadMutations } from "./engine/mutations.js";
import { loadBanterLibrary } from "./engine/npc-banter.js";
import {
	handleApiRequest,
	setBroadcast,
	consumeSwitchToken,
	setGhostTokenStore,
} from "./api/routes.js";
import { cmdGhostLook, cmdGhostMove, cmdGhostHaunt, cmdGhostPowerDrain, makeGhostBroadcast } from "./engine/commands/ghost.js";
import { activateForcefield, deactivateForcefield } from "./engine/apartments.js";
import { startKeepalive } from "./keepalive.js";
import { setBroadcast as setMessagingBroadcast } from "./engine/messaging.js";
import { query, logActivity } from "./models/db.js";
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
		if (session.isGhost) {
			// Ghost only receives broadcasts for its watched zone; skip global ones
			if (!zoneId || session.ghostZoneId !== zoneId) continue;
		} else if (zoneId) {
			const p = getLivePlayer(session.playerId);
			if (!p || p.current_zone !== zoneId) continue;
			// Asleep players don't perceive the room around them — no actions, speech, or ambience.
			if (p.sleeping) continue;
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
		});
		res.end(JSON.stringify(result.body));
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
		const data = readFileSync(filePath);
		res.writeHead(200, {
			"Content-Type": MIME[extname(filePath)] || "text/plain",
		});
		res.end(data);
	} catch {
		res.writeHead(404);
		res.end("Not found");
	}
});

const wss = new WebSocketServer({ server: httpServer });

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
		if (msg.type === "auth") return handleAuth(ws, session, msg);
		if (msg.type === "auth_token") return handleAuthToken(ws, session, msg);
		if (msg.type === "auth_reconnect")
			return handleReconnect(ws, session, msg);
		if (msg.type === "command") return handleGameCommand(ws, session, msg);
		if (msg.type === "dialogue") return handleDialogue(ws, session, msg);
		if (msg.type === "shop_close") { if (session.playerId) closeShopSession(session.playerId); return; }
		if (msg.type === "buy_npc") return handleBuyFromNpc(ws, session, msg);
		if (msg.type === "sell_npc") return handleSellToNpc(ws, session, msg);
		if (msg.type === "auth_ghost") return handleGhostAuth(ws, session, msg);
		if (msg.type === "ghost_command") return handleGhostCommand(ws, session, msg);
		if (msg.type === "ghost_jump") return handleGhostJump(ws, session, msg);
		if (msg.type === "ghost_refresh") return handleGhostRefresh(ws, session);
		if (msg.type === "ping") {
			ws.send(JSON.stringify({ type: "pong" }));
			return;
		}
		if (msg.type === "mis_toggle") return handleMisToggle(ws, session, msg);
		if (msg.type === "tv_watch" || msg.type === "tv_unwatch") {
			if (!session.playerId) return;
			if (msg.type === "tv_watch" && msg.channelId)
				emit("tv.watch", { playerId: session.playerId, channelId: msg.channelId });
			else
				emit("tv.unwatch", { playerId: session.playerId });
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
});

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
		origin_fragment: player.origin_fragment || 'A survivor. Still standing, somehow.',
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
	setLivePlayer(player.id, livePlayer);
	logActivity('connect', player.handle);
	broadcast(null, { type: 'online_change' });
	await deactivateForcefield(player.id, livePlayer.home_zone, broadcast);
	await autoEquipOnLogin(player.id);
	await recomputeArmor(livePlayer);
	await recomputeInsulation(livePlayer);
	addPlayerToZone(player.id, livePlayer.current_zone);
	const diedOffline = player.died_offline;
	await query(
		"UPDATE players SET last_seen=EXTRACT(EPOCH FROM NOW()), offline_sleeping=FALSE, died_offline=FALSE WHERE id=$1",
		[player.id],
	);

	broadcast(
		livePlayer.current_zone,
		{ type: "zone_event", message: `${player.handle} has arrived.` },
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
				minimap: getMinimapData(zone.id),
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
					minimap: getMinimapData("zone_start"),
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

async function handleGameCommand(ws, session, msg) {
	if (!session.playerId) {
		ws.send(
			JSON.stringify({ type: "error", message: "Not authenticated." }),
		);
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
			await recomputeArmor(player);
			await recomputeInsulation(player);
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
	const { rows } = await query("SELECT * FROM npcs WHERE id=$1", [msg.npcId]);
	if (!rows.length) {
		ws.send(JSON.stringify({ type: "error", message: "NPC not found." }));
		return;
	}
	const npc = rows[0];

	if (msg.choice === "__shop__") {
		const player = getLivePlayer(session.playerId);
		if (!player) return;
		if (!npc.vendor_inventory?.length) {
			ws.send(JSON.stringify({ type: "error", message: `${npc.name} has nothing to sell.` }));
			return;
		}
		openShopSession(session.playerId, npc.id);
		await sendShopPanel(ws, npc, session.playerId);
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
			const filteredOpts = [];
			for (const opt of prevNode.options || []) {
				if (!(await evalConditions(opt.conditions || opt.condition, player))) continue;
				filteredOpts.push(opt);
			}
			const clickedOpt = filteredOpts[msg.optionIndex];
			if (clickedOpt?.actions?.length) {
				for (const a of clickedOpt.actions) {
					if (!a?.action) continue;
					const result = await dispatchAction({
						type: a.action,
						actor: player,
						params: a.params || {},
						context: { broadcast },
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

	const node = (npc.dialogue_tree || {})[msg.choice];
	if (!node) {
		ws.send(
			JSON.stringify({
				type: "dialogue_end",
				message: `${npc.name} has nothing more to say.`,
			}),
		);
		return;
	}

	// Run the node's Actions (Phase 4). Each is dispatched through the canonical
	// Action path; `grants_item` is kept as a legacy shorthand for GRANT_ITEM.
	const actions = [...(node.actions || [])];
	if (node.grants_item?.item_id) {
		actions.push({ action: "GRANT_ITEM", params: { item_id: node.grants_item.item_id, quantity: node.grants_item.quantity || 1 } });
	}
	if (player) {
		for (const a of actions) {
			if (!a?.action) continue;
			const result = await dispatchAction({
				type: a.action,
				actor: player,
				params: a.params || {},
				context: { broadcast },
			});
			if (result?.type === "grant" && result.granted) {
				appendMessage += `\n\n<span class="item-grant">You receive: ${result.name}${result.quantity > 1 ? ` x${result.quantity}` : ""}.</span>`;
			} else if (result?.type === "error") {
				console.warn(`[dialogue] action ${a.action} failed: ${result.message}`);
			}
		}
	}

	// Condition-gate options against the player's Flags.
	const options = [];
	for (const opt of node.options || []) {
		if (player && !(await evalConditions(opt.conditions || opt.condition, player))) continue;
		options.push(opt);
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
			text: node.text + appendMessage,
			options,
		}),
	);
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
	const { rows } = await query("SELECT * FROM npcs WHERE id=$1", [msg.npcId]);
	if (!rows.length) { ws.send(JSON.stringify({ type: "error", message: "NPC not found." })); return; }
	const npc = rows[0];
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
	const { rows } = await query("SELECT * FROM npcs WHERE id=$1", [msg.npcId]);
	if (!rows.length) { ws.send(JSON.stringify({ type: "error", message: "NPC not found." })); return; }
	const npc = rows[0];
	const { sellToVendor } = await import("./engine/vendor.js");
	const result = await sellToVendor(player, npc, msg.inventoryId, 1);
	await sendShopPanel(ws, npc, session.playerId, { sellResult: result.message, sellSuccess: result.success });
	if (result.success) {
		ws.send(JSON.stringify({ type: "player_update", credits: player.credits }));
	}
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
	httpServer.listen(PORT, () => {
		console.log(`\n🏚  Running on http://localhost:${PORT}`);
		console.log(`   Player:  http://localhost:${PORT}`);
		console.log(`   Dev:     http://localhost:${PORT}/dev`);
		console.log(`   Health:  http://localhost:${PORT}/health\n`);
	});
}

boot().catch((e) => {
	console.error("Boot failed:", e);
	process.exit(1);
});
