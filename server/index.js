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
import { loadRecipes } from "./engine/crafting.js";
import { loadDrugs } from "./engine/drugs.js";
import { loadMutations } from "./engine/mutations.js";
import {
	handleApiRequest,
	setBroadcast,
	consumeSwitchToken,
} from "./api/routes.js";
import { startKeepalive } from "./keepalive.js";
import { query } from "./models/db.js";
import { migrate } from "./models/migrate.js";
import { loadMisSettings } from "./engine/mis.js";

import { initEnvironment, getHUDPayload } from "./engine/environment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const clients = new Map(); // ws -> session
const playerSockets = new Map(); // playerId -> ws
const reconnectTokens = new Map(); // token -> { playerId, expires }

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
	},
	15 * 60 * 1000,
);

function broadcast(
	zoneId,
	message,
	excludePlayerId = null,
	targetPlayerId = null,
) {
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
		if (msg.type === "buy_npc") return handleBuyFromNpc(ws, session, msg);
		if (msg.type === "ping") {
			ws.send(JSON.stringify({ type: "pong" }));
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
		   AND (i.tags->>'auto_equip')::boolean = true
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

	const livePlayer = {
		id: player.id,
		handle: player.handle,
		role: player.role,
		origin_fragment: player.origin_fragment || 'A survivor. Still standing, somehow.',
		archetype: player.archetype || null,
		visibly_mutated: player.visibly_mutated || 0,
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
		stat_senses: player.stat_senses,
		stat_cool: player.stat_cool,
		ip: player.ip || 0,
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
	};
	setLivePlayer(player.id, livePlayer);
	await autoEquipOnLogin(player.id);
	await recomputeArmor(livePlayer);
	await recomputeInsulation(livePlayer);
	addPlayerToZone(player.id, livePlayer.current_zone);
	await query(
		"UPDATE players SET last_seen=EXTRACT(EPOCH FROM NOW()), offline_sleeping=FALSE WHERE id=$1",
		[player.id],
	);

	broadcast(
		livePlayer.current_zone,
		{ type: "zone_event", message: `${player.handle} has arrived.` },
		player.id,
	);
	let envHUD = null;
	try {
		envHUD = getHUDPayload();
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
		}),
	);

	const zone = getZone(livePlayer.current_zone);
	if (zone) {
		ws.send(
			JSON.stringify({
				type: "look",
				message: await describeZone(zone, livePlayer),
				minimap: getMinimapData(zone.id),
			}),
		);
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
		}
	}
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
		const { getVendorStock } = await import("./engine/vendor.js");
		const stock = await getVendorStock(npc, session.playerId);
		ws.send(JSON.stringify({ type: "dialogue_shop", npcId: npc.id, npcName: npc.name, stock, credits: player.credits }));
		return;
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

	let grantMessage = "";
	if (node.grants_item?.item_id) {
		const { item_id, quantity = 1 } = node.grants_item;
		const { rows: already } = await query(
			"SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2",
			[session.playerId, item_id],
		);
		if (!already.length) {
			await query(
				"INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,$4,1.0)",
				[randomUUID(), session.playerId, item_id, quantity],
			);
			const { rows: itemRows } = await query(
				"SELECT name FROM items WHERE id=$1",
				[item_id],
			);
			grantMessage = `\n\n<span class="item-grant">You receive: ${itemRows[0]?.name || item_id}${quantity > 1 ? ` x${quantity}` : ""}.</span>`;
		}
	}

	ws.send(
		JSON.stringify({
			type: "dialogue",
			npcId: msg.npcId,
			npcName: npc.name,
			node: msg.choice,
			text: node.text + grantMessage,
			options: node.options || [],
		}),
	);
}

async function handleBuyFromNpc(ws, session, msg) {
	if (!session.playerId) return;
	const player = getLivePlayer(session.playerId);
	if (!player) return;
	const { rows } = await query("SELECT * FROM npcs WHERE id=$1", [msg.npcId]);
	if (!rows.length) { ws.send(JSON.stringify({ type: "error", message: "NPC not found." })); return; }
	const npc = rows[0];
	const { buyFromVendor, getVendorStock } = await import("./engine/vendor.js");
	const result = await buyFromVendor(player, npc, msg.itemId, 1);
	const stock = await getVendorStock(npc, session.playerId);
	ws.send(JSON.stringify({
		type: "dialogue_shop",
		npcId: npc.id,
		npcName: npc.name,
		stock,
		credits: player.credits,
		buyResult: result.message,
		buySuccess: result.success,
	}));
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
	await migrate();
	setBroadcast(broadcast);
	await loadMisSettings();
	await initWorld();
	await loadRecipes();
	await loadDrugs();
	await loadMutations();
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
		});
	} catch (e) {
		console.error(
			"⚠ Environment system failed to init (continuing without it — likely means `npm run db:migrate` hasn't been run against this database yet):",
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
