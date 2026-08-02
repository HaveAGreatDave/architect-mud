import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { brotliCompressSync, gzipSync, constants } from "zlib";
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
	persistableZone,
	isTransientZone,
	world,
} from "./engine/world.js";
import {
	handleCommand,
	describeZone,
	describeVoidTeleport,
	recomputeEquipped,
} from "./engine/commands/index.js";
import { startGameLoop } from "./engine/gameLoop.js";
import { zoneAudience } from "./engine/delivery.js";
import { modulePreloadTags } from "./modulegraph.js";
import { loadPlugins, fireHook } from "./engine/plugins.js";
import { emit } from "./engine/events.js";
import { getNetXp, maxHpForEndurance, maxStaminaForEndurance } from "./engine/ip.js";
import { dispatchAction } from "./engine/actions.js";
// Side-effect imports: register the Flag store and graph-engine Actions
// (SET_FLAG, CLEAR_FLAG, GRANT_ITEM, TELEPORT, EXECUTE_SCRIPT, …) at boot.
import { filterDialogueOptions, renderDialogueNode } from "./engine/dialogue.js";
import "./engine/graph.js";
import { loadRecipes } from "./engine/crafting.js";
import { loadDrugs, clearActiveDrugBuffs } from "./engine/drugs.js";
import { loadItems, getItem } from "./engine/items-cache.js";
import { reloadCrimes } from "./engine/crimes.js";
import { reloadAliases } from "./engine/commands/aliases.js";
import { loadMutations } from "./engine/mutations.js";
import { loadBanterLibrary } from "./engine/npc-banter.js";
import { loadScriptTriggers } from "./engine/script-triggers.js";
import {
	handleApiRequest,
	setBroadcast,
	consumeSwitchToken,
	setGhostTokenStore,
} from "./api/routes.js";
import { cmdGhostLook, cmdGhostMove, cmdGhostHaunt, cmdGhostPowerDrain, makeGhostBroadcast } from "./engine/commands/ghost.js";
import { activateForcefield, deactivateForcefield, reconcileApartmentDoorLocks, reconcileNpcHomesVsOwnership } from "./engine/apartments.js";
import { wakeFromDream } from "./engine/dreamscape.js";
import { startKeepalive } from "./keepalive.js";
import { startUsageLog } from "./usage-log.js";
import { setBroadcast as setMessagingBroadcast } from "./engine/messaging.js";
import { handlePanelData, sendPanelCatalog } from "./engine/panels.js";
import pool, { query, logActivity } from "./models/db.js";
import { loadMisSettings, isMisServerEnabled } from "./engine/mis.js";
import { loadEmailVerificationSetting, isEmailVerificationEnabled } from "./engine/emailVerification.js";
import { mailerConfigProblem, mailerSender } from "./mailer.js";

import { initEnvironment, getHUDPayload, getZoneTemperature } from "./engine/environment.js";
import { getPlayerChannels, getChannelHistory } from "./engine/channels.js";
import { getMotd } from "./engine/motd.js";
import { openShopSession, closeShopSession } from "./engine/vendor-session.js";
import { getSoundReach } from "./engine/sounds.js";
import { getFlag, hydratePlayerFlags, evictPlayerFlags } from "./engine/flags.js";
import { hydrateDisplayRung, loggedPanelsSync } from "./engine/presentation.js";
import { briefRoom, markSeenZone } from "./engine/room-brief.js";
import { hydrateRelations, flushRelations } from "./engine/relations.js";
import { hydrateIdeologyProfile } from "./engine/ideologies.js";
import { DOMINANT_FLAG, SECOND_FLAG } from "./engine/senses.js";
import { DEFAULT_STANCE } from "./engine/stance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const clients = new Map(); // ws -> session
const playerSockets = new Map(); // playerId -> ws
// Ghost sessions watch a zone without standing in it, so they never appear in
// zone.players. Kept as their own small set so the zone broadcast fast path can
// serve them without falling back to scanning every connected client.
const ghostSockets = new Set();
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

// Mark a room description for the scrolling log when the player is on the bottom
// Display Mode rung. Only `look`/`move` carry one; everything else is already a
// log message. See the note at the handleCommand call site.
function stampToLog(player, message) {
	if (!message || (message.type !== 'look' && message.type !== 'move')) return message;
	if (!loggedPanelsSync(player)) return message;
	// The log copy of a room you have walked into BEFORE is abbreviated, so that
	// crossing six rooms is not six paragraphs read aloud. An explicit `look` is
	// never abbreviated, and neither is your first arrival anywhere — see the
	// contract in engine/room-brief.js. The PANE copy stays full either way; only
	// `toLog` carries the brief, because only the log repeats.
	const first = markSeenZone(player, message.zone || player?.current_zone);
	const full = message.type === 'look' || first;
	return { ...message, toLog: true, logMessage: full ? message.message : briefRoom(message.message) };
}

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

	// Shared recipient filter — identical predicates whichever way we got here, so
	// the zone fast path below can never diverge from the global scan.
	const deliver = (ws, session) => {
		if (!ws || ws.readyState !== 1) return;
		if (excludePlayerId && session.playerId === excludePlayerId) return;
		if (excludePlayerId2 && session.playerId === excludePlayerId2) return;
		if (excludeSet && excludeSet.has(session.playerId)) return;
		ws.send(payload);
	};

	if (zoneId) {
		// ── Zone fast path ────────────────────────────────────────────────────
		// WHO receives this lives in engine/delivery.js so it can be tested; this
		// keeps only the part that needs sockets. See that file for why delivery
		// walks zone.players rather than scanning every connected client, and why
		// there is deliberately no parallel zoneId->socket index.
		for (const pid of zoneAudience(zoneId, {
			exclude: [excludePlayerId, excludePlayerId2],
			excludeSet,
		})) {
			const ws = playerSockets.get(pid);
			if (ws) deliver(ws, clients.get(ws) || { playerId: pid });
		}
		// Ghosts watch a zone without standing in it, so they are not in
		// zone.players. There are only ever a handful (a dev tool), tracked in
		// their own set so this stays proportional to ghosts, not to players.
		for (const ws of ghostSockets) {
			const session = clients.get(ws);
			if (session?.ghostZoneId === zoneId) deliver(ws, session);
		}
	} else {
		// Global message: everyone except ghosts, who only ever watch one zone.
		for (const [ws, session] of clients) {
			if (session.isGhost) continue;
			deliver(ws, session);
		}
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
	// Unlisted extensions fall through to text/plain below. That was fine while
	// everything served was HTML/JS/CSS, but favicon.ico and sitemap.xml are
	// both rejected by some clients when mislabelled — robots.txt only worked
	// by accident, because text/plain is genuinely its correct type.
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
};

// ── Static asset cache + compression ──────────────────────────────────────────
//
// Two problems this solves, both on the path that also serves every WebSocket
// message:
//
//  1. Nothing was compressed. A cold load pulls ~5 MB of client JS/CSS/HTML off
//     this server raw. Text compresses 4-6x, and zlib ships with Node, so this
//     costs no dependency and changes no behaviour — only the bytes on the wire.
//  2. Every request did a synchronous readFileSync + statSync. Sync disk I/O
//     blocks the event loop, and that is the SAME loop delivering combat messages
//     and room descriptions to everyone already playing. ~82 assets per cold
//     load meant ~82 micro-stalls for the whole world every time someone
//     refreshed.
//
// So: read + compress once, keep the buffers in memory, key on mtime so an
// edited file is picked up without a restart (node --watch restarts anyway, but
// the devpanel and a bare `npm start` do not). Compression is CPU work we do
// exactly once per file version, not per request.
//
// Only text types are compressed — .png/.ico are already compressed formats and
// running deflate over them burns CPU to make them marginally bigger.
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg", ".txt", ".xml"]);
// Below ~1 KB the framing overhead and the CPU round trip cost more than the
// handful of bytes saved.
const COMPRESS_MIN_BYTES = 1024;

// filePath -> { mtime, raw, br, gzip, type }
const assetCache = new Map();

// See server/modulegraph.js for why these hints exist and why they are generated
// rather than written by hand. Computed lazily on first use and memoised for the
// process — the import graph is source, and source doesn't change under a running
// server (a dev restart re-walks it; `node --watch` restarts on every edit).
const MODULEPRELOAD_MARKER = "<!--MODULEPRELOAD-->";
let _preloadBlock = null;
function modulePreloadBlock() {
	if (_preloadBlock !== null) return _preloadBlock;
	const gameRoot = join(__dirname, "../client/game");
	try {
		_preloadBlock = modulePreloadTags(join(gameRoot, "js/main.js"), gameRoot);
		const n = (_preloadBlock.match(/rel="modulepreload"/g) || []).length;
		console.log(`  ⇢ ${n} modulepreload hint(s) generated for the game client`);
	} catch (err) {
		// A broken graph walk must never take the page down — worst case we serve
		// the shell without hints and the browser discovers modules the slow way.
		console.error(`[modulepreload] graph walk failed, serving without hints: ${err.message}`);
		_preloadBlock = "";
	}
	return _preloadBlock;
}

function getAsset(filePath) {
	const mtimeMs = statSync(filePath).mtimeMs;
	const hit = assetCache.get(filePath);
	if (hit && hit.mtimeMs === mtimeMs) return hit;

	const ext = extname(filePath);
	let raw = readFileSync(filePath);

	// Inject the modulepreload hints into the game shell. Done here, inside the
	// cache fill, so the graph is walked once per mtime rather than per request —
	// and so the compressed buffers below are built from the final bytes.
	if (ext === ".html" && raw.includes(MODULEPRELOAD_MARKER)) {
		raw = Buffer.from(
			raw.toString("utf8").replace(MODULEPRELOAD_MARKER, modulePreloadBlock()),
			"utf8",
		);
	}

	const entry = {
		mtimeMs,
		lastMod: new Date(mtimeMs).toUTCString(),
		type: MIME[ext] || "text/plain",
		raw,
		br: null,
		gzip: null,
	};
	if (COMPRESSIBLE.has(ext) && raw.length >= COMPRESS_MIN_BYTES) {
		// Quality 5 (not the default 11): 11 is for build-time asset pipelines and
		// can take seconds on a large file, which would stall the loop we are
		// trying to protect. 5 lands within a few percent of 11 on JS for a
		// fraction of the time, and it only ever runs once per file version.
		try {
			entry.br = brotliCompressSync(raw, {
				params: {
					[constants.BROTLI_PARAM_QUALITY]: 5,
					[constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
				},
			});
		} catch { /* fall through to gzip */ }
		try {
			entry.gzip = gzipSync(raw, { level: 6 });
		} catch { /* fall through to raw */ }
	}
	assetCache.set(filePath, entry);
	return entry;
}

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

	// Worldbuilding is a local-only activity: content ships to prod through the
	// CODEX git pipeline, and CONTENT_READONLY default-denies every content write
	// on the server. So on prod the full builder panel is nothing but a wall of
	// 403 traps — send the bare /dev navigation to the ops-only /admin view
	// instead. Bare path ONLY: redirecting the whole /dev prefix would 302 every
	// /dev/js/*.js asset and break the panel that /admin itself is built from.
	if (process.env.CONTENT_READONLY && (url === "/dev" || url === "/dev/")) {
		res.writeHead(302, { Location: "/admin" });
		res.end();
		return;
	}

	let filePath;
	if (url === "/admin" || url === "/admin/") {
		// Same app, same file — the client reads location.pathname and prunes
		// itself to the ops panels. One HTML file means the two views can't drift.
		filePath = join(__dirname, "../client/devpanel", "index.html");
	} else if (url.startsWith("/dev")) {
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
		// stale JS/HTML after a deploy until a manual hard-refresh. The HTML stays
		// on no-cache (revalidate every load; Last-Modified lets an unchanged file
		// answer with a 304, and a redeploy rewrites mtimes to bust it). The ~82
		// JS/CSS assets get a short max-age instead: revalidating each one cost a
		// round trip per file on every load, which dominated load time. A deploy is
		// at most max-age seconds stale for an already-open page.
		const ext = extname(filePath);
		const asset = getAsset(filePath);
		if (req.headers["if-modified-since"] === asset.lastMod) {
			res.writeHead(304);
			res.end();
			return;
		}
		// Pick the best encoding the client actually advertised. Vary tells any
		// cache between us and the player that the body depends on this header —
		// without it, a shared proxy could hand a brotli body to a client that
		// never asked for one.
		const accepts = String(req.headers["accept-encoding"] || "");
		let body = asset.raw;
		let encoding = null;
		if (asset.br && /\bbr\b/.test(accepts)) { body = asset.br; encoding = "br"; }
		else if (asset.gzip && /\bgzip\b/.test(accepts)) { body = asset.gzip; encoding = "gzip"; }

		res.writeHead(200, {
			"Content-Type": asset.type,
			"Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=60",
			"Last-Modified": asset.lastMod,
			"Content-Length": body.length,
			// Vary goes on anything we *could* have compressed, not just what we
			// did — otherwise a shared cache that stored the raw copy would keep
			// serving it, and a proxy that stored a compressed copy could hand it
			// to a client that never advertised support.
			...(COMPRESSIBLE.has(ext) ? { "Vary": "Accept-Encoding" } : {}),
			...(encoding ? { "Content-Encoding": encoding } : {}),
		});
		res.end(body);
	} catch {
		res.writeHead(404);
		res.end("Not found");
	}
});

// Compress the socket. Measured on a real room payload: a `look` is ~34 KB, of
// which ~33 KB is the minimap node array — highly repetitive JSON that gzips
// 17.9x and brotlis 24x. Static assets were already compressed; the socket that
// carries every room description and every step was still going out raw.
//
// Configured rather than `perMessageDeflate: true`, because ws's own docs warn
// that the defaults fragment memory badly under load:
//   threshold        — frames under this skip deflate entirely. Most traffic is
//                      small status/vitals ticks where framing overhead would
//                      cost more than it saves; the big room payloads clear it.
//   memLevel 7       — below zlib's default 8; materially less memory per
//                      connection for a few percent of ratio.
//   concurrencyLimit — caps simultaneous zlib jobs so a burst of moves can't
//                      pile compression work onto the event loop the game runs on.
//   clientNoContextTakeover — do not hold a per-connection compression context
//                      open for inbound frames; clients send tiny commands, so
//                      the context buys nothing and costs memory per player.
const wss = new WebSocketServer({
	server: httpServer,
	perMessageDeflate: {
		threshold: 1024,
		concurrencyLimit: 10,
		clientNoContextTakeover: true,
		serverNoContextTakeover: false,   // keep server-side context: consecutive
		                                  // minimaps share ~90% of their bytes
		zlibDeflateOptions: { level: 6, memLevel: 7 },
	},
});

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
		// The Tablet TV app's portable tuner — same shape as tv_watch, but its own
		// registry server-side (it receives with no broadcast device in the zone).
		if (msg.type === "tablet_tv_watch" || msg.type === "tablet_tv_unwatch") {
			if (!session.playerId) return;
			if (msg.type === "tablet_tv_watch" && msg.channelId)
				emit("tablet_tv.watch", { playerId: session.playerId, channelId: msg.channelId });
			else
				emit("tablet_tv.unwatch", { playerId: session.playerId });
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
		if (msg.type === "tv_standings") {
			if (!session.playerId) return;
			emit("tv.standings", { playerId: session.playerId });
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
					// Disconnecting is a wake path, and it was the one nobody counted.
					// Without this the dreamscape is never dissolved (leaking its rooms
					// for the life of the process) and current_zone stays a dream id —
					// so a reconnect BEFORE a restart put the player back inside the
					// dream, awake, with the sleeping state gone. Idempotent, and a
					// no-op for anyone who wasn't dreaming.
					wakeFromDream(player);
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
					// Reverse drug/withdrawal ledger buffs BEFORE the checkpoint write below.
					// activeDrugs live only in memory, so a buff still applied here would be
					// saved as if it were a base stat — and reversing a raised cap clamps the
					// current value under it, which the row must capture.
					clearActiveDrugBuffs(player);
					await query(
						"UPDATE players SET last_seen=EXTRACT(EPOCH FROM NOW()), current_zone=$1, hp=$2, stamina=$3, offline_sleeping=TRUE WHERE id=$4",
						// persistableZone, not current_zone — dropping mid-dream or
						// mid-void-crossing would otherwise checkpoint a RAM-only zone id
						// into the row and strand the player somewhere that stops existing.
						[persistableZone(player), player.hp, player.stamina, session.playerId],
					).catch(() => {});
					player._posDirty = false; // authoritative clean-exit checkpoint for position (see cmdMove)
					player._resDirty = false; // ...and for hp/stamina (see flushDirtyResources) — closes the combat-log window on a graceful logout
				} else {
					await query(
						"UPDATE players SET last_seen=EXTRACT(EPOCH FROM NOW()), offline_sleeping=TRUE WHERE id=$1",
						[session.playerId],
					).catch(() => {});
				}
				closeShopSession(session.playerId);
				// Last chance to persist whatever the session changed about who
				// knows this player — the live object (and its Map) is discarded
				// by removeLivePlayer a few lines down.
				if (player) await flushRelations(player).catch(() => {});
				// Flags are write-through (no dirty set to flush) — just drop the
				// cache so the module registry stops pinning a dead player object.
				evictPlayerFlags(session.playerId);
				emit('player.logout', { id: session.playerId, handle: session.handle });
				logActivity('disconnect', session.handle);
				broadcast(null, { type: 'online_change' });
				playerSockets.delete(session.playerId);
				removeLivePlayer(session.playerId);
			}
		}
		clients.delete(ws);
		ghostSockets.delete(ws);
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
	ghostSockets.add(ws);
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

	// Keep max HP and max stamina in sync with endurance. Self-heals pre-existing
	// characters whose stored maxima predate endurance scaling (no migration
	// script) — which is also how every character already in the world picks up
	// endurance-scaled stamina, on their next login.
	const correctHpMax = maxHpForEndurance(player.stat_endurance);
	const correctStamMax = maxStaminaForEndurance(player.stat_endurance);
	if (player.hp_max !== correctHpMax || player.stamina_max !== correctStamMax) {
		player.hp_max = correctHpMax;
		player.hp = Math.min(player.hp, correctHpMax);
		player.stamina_max = correctStamMax;
		player.stamina = Math.min(player.stamina ?? correctStamMax, correctStamMax);
		await query("UPDATE players SET hp_max=$1, hp=$2, stamina_max=$3, stamina=$4 WHERE id=$5", [
			player.hp_max,
			player.hp,
			player.stamina_max,
			player.stamina,
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
		// Fatigue is derived from this, so it must ride the live object. A player
		// who has never slept reads as fresh rather than as eight hours awake —
		// nobody should log in for the first time already wrecked.
		last_slept_at: Number(player.last_slept_at) || Date.now(),
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
		died_offline: player.died_offline || 0,
		home_zone: player.home_zone || null,
	};
	const { total: totalXp, net: netXp } = await getNetXp(player.id);
	livePlayer.xp = Math.floor(netXp);
	livePlayer.total_xp = totalXp;
	// Combat stance persists across sessions (player_flags), but is read from the
	// LIVE object on every to-hit roll — getFlag is a DB round trip and can never
	// live in that hot path. Login is the one place it's fetched.
	livePlayer.combat_stance = (await getFlag('player', 'combat_stance', livePlayer)) || DEFAULT_STANCE;
	// Sense attunement, for exactly the same reason: `smell` is a spammable verb
	// and acuity is read on every use, so the flags are hydrated once here and
	// answered from the live object thereafter (docs/architecture.md read tiers).
	livePlayer._senseDominant = (await getFlag('player', DOMINANT_FLAG, livePlayer)) || null;
	livePlayer._senseSecond   = (await getFlag('player', SECOND_FLAG, livePlayer)) || null;
	// Who this player has met, and how it went. ONE indexed query here is the
	// entire DB cost of the relationship system for the whole session — every
	// later read (dialogue gates, greetings, vendor manner) is answered from the
	// Map this builds. See the read-tier note at the top of engine/relations.js.
	//
	// On a RECONNECT there may still be a live object from the old session whose
	// Map holds unflushed conversations. Flush it BEFORE reading, or the fresh
	// hydrate races it and the last few minutes of knowing someone are lost.
	const priorSession = getLivePlayer(player.id);
	if (priorSession) await flushRelations(priorSession).catch(() => {});
	// Independent reads — one round trip's latency, not two.
	// The ideology profile (stance + strongest path) is hydrated for the same
	// reason: reputation decay consults it on every vendor price lookup, and five
	// flag round trips there would be indefensible.
	// player_flags joins the same batch: it's the mandated home for per-player
	// scalar state, so it's read constantly at runtime (~70 call sites) and was
	// costing a round trip every time. One query here, Map lookups thereafter.
	await Promise.all([
		hydrateRelations(livePlayer),
		hydrateIdeologyProfile(livePlayer),
		hydratePlayerFlags(livePlayer),
	]);
	// Latch the Display Mode rung onto the live player, AFTER the flag cache is
	// warm so this costs nothing. The room-look renderer runs on every move and
	// cannot await a preference; it reads this latch instead (presentation.js
	// loggedPanelsSync). Same discipline flight uses for `player.textTravel`.
	await hydrateDisplayRung(livePlayer);
	// Seed the resource diff-gate stamp (Phase 6) from the freshly-loaded row so
	// the first resourceTick after login doesn't write values that never changed.
	livePlayer._lastSavedResources = {
		hunger: livePlayer.hunger, thirst: livePlayer.thirst, hp: livePlayer.hp,
		stamina: livePlayer.stamina, body_temp_c: livePlayer.body_temp_c,
	};
	// Reconnect: this replaces the live player object, orphaning any timer that
	// captured the old one. Hand the STALE object to plugins so they can cancel
	// work bound to it. Deliberately not `player.logout` — that tears down state
	// keyed by player id, which the incoming session now owns.
	const stalePlayer = getLivePlayer(player.id);
	if (stalePlayer) {
		clearActiveDrugBuffs(stalePlayer);   // ledger buffs/onsets die with the old object, not into the new one
		emit('player.sessionReplaced', { player: stalePlayer, id: player.id });
	}
	setLivePlayer(player.id, livePlayer);
	logActivity('connect', player.handle);
	broadcast(null, { type: 'online_change' });
	await deactivateForcefield(player.id, livePlayer.home_zone, broadcast);
	await autoEquipOnLogin(player.id);
	await recomputeEquipped(livePlayer);
	addPlayerToZone(player.id, livePlayer.current_zone);
	const diedOffline = player.died_offline;
	await query(
		// Logging off asleep in a bed is a legitimate way to spend the night: you
		// wake rested rather than having to sit and watch the clock. That is the
		// escape valve that keeps fatigue from becoming a chore.
		"UPDATE players SET last_seen=EXTRACT(EPOCH FROM NOW()), last_slept_at=CASE WHEN offline_sleeping THEN EXTRACT(EPOCH FROM NOW())*1000 ELSE last_slept_at END, offline_sleeping=FALSE, died_offline=FALSE WHERE id=$1",
		[player.id],
	);
	// ...and mirror that onto the live object. livePlayer was built from the
	// PRE-update row, and fatigueOf() reads the live object — without this the
	// session right after a logout plays at the fatigue you logged off with and
	// only reads as rested on the NEXT login.
	if (player.offline_sleeping) livePlayer.last_slept_at = Date.now();

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
	// ── Login rescue: you must not wake up somewhere you can't be ──────────────
	//
	// Three ways the stored zone is not a place to log in to, all with the same
	// remedy, so they're one branch rather than the flag-shaped special case this
	// used to be:
	//
	//   1. A LEGACY authored drug dreamzone (`flags.is_dreamzone`). Those shared
	//      rooms are retired — every trip is instanced now — but a database that
	//      predates the retirement can still hold one, and a stored `current_zone`
	//      pointing into it must not be logged in to.
	//   2. A TRANSIENT id — a dreamscape room or a void crossing. `persistableZone`
	//      stops these being written now, but rows already corrupted by the old
	//      disconnect checkpoint are still out there, and this repairs them on the
	//      next login. It is also what will catch instanced drug trips, which have
	//      no DB row at all and so would silently fall through to the branch below.
	//   3. A zone that no longer resolves — deleted while they were offline.
	//
	// All three go to the ANCHOR, not `zone_start`. The old deleted-zone fallback
	// dumped players at world start even when they had a perfectly good anchor;
	// zone_start is now only the last resort when the anchor is gone too.
	// A zone that simply vanished gets the void-teleport narration on arrival; being
	// pulled out of a dream or a crossing does not, because you didn't travel — you
	// just stopped being somewhere that wasn't real.
	const zoneWasDeleted = !zone;
	const zoneIsUninhabitable =
		!zone || zone.flags?.is_dreamzone || isTransientZone(livePlayer.current_zone);
	if (zoneIsUninhabitable) {
		const anchor = livePlayer.anchor_zone || "zone_start";
		const rescued = getZone(anchor) ? anchor : "zone_start";
		removePlayerFromZone(player.id, livePlayer.current_zone);
		livePlayer.current_zone = rescued;
		addPlayerToZone(player.id, rescued);
		await query("UPDATE players SET current_zone=$1 WHERE id=$2", [rescued, player.id]);
		zone = getZone(rescued);
	}
	if (zone) {
		ws.send(
			JSON.stringify({
				type: "look",
				message: (zoneWasDeleted ? describeVoidTeleport() : "") + await describeZone(zone, livePlayer),
				zone: zone.id,
				minimap: getMinimapData(zone.id, 8, livePlayer),
			}),
		);
		if (zoneWasDeleted) {
			broadcast(zone.id, { type: "zone_event", message: `${player.handle} flickers into existence out of nowhere.` }, player.id);
		}
		if (bodyTempLoginMsg) ws.send(JSON.stringify({ type: 'system', message: bodyTempLoginMsg }));
		if (diedOffline) ws.send(JSON.stringify({ type: 'player_death', message: `\n<span class="death-message">☠ You were murdered in your sleep. You wake up somewhere else, someone else's problem.</span>\n<span class="clone-vat-message">A vending-machine-shaped cloning vat hums, dispenses a fresh you, and prints a receipt nobody asked for. Everything you knew, you still know. Everything that hurt, doesn't anymore.</span>` }));
	} else {
		// Unreachable in a healthy world: the rescue above already fell back to the
		// anchor and then to zone_start, so getting here means `zone_start` itself
		// doesn't resolve — a broken or half-imported world, not a player problem.
		// Say so out loud rather than dropping them into silence with no room.
		console.error(`[login] no habitable zone for ${player.handle}: stored=${livePlayer.current_zone}, anchor=${livePlayer.anchor_zone}, and zone_start is missing`);
		ws.send(JSON.stringify({ type: 'system', message: 'The world is still loading. Try again in a moment.' }));
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
	// DISPLAY MODE `log` RIDES EVERY REPLY TOO, for the same reason as the sleep
	// state below: the room description is built at half a dozen sites
	// (movement.js, world.js, the login look, gametable's paneOrLook) and there is
	// no single place that constructs one. Stamping it on the way OUT is the one
	// site that cannot drift.
	//
	// This is the substantive half of the bottom rung. A look normally goes to the
	// top pane and NEVER touches #output, so a player reading through the log
	// alone would walk from room to room hearing nothing about where they are.
	// `toLog` tells the client to append it as well.
	// Sync by contract — reads the latch hydrated at login, never awaits.
	// SLEEP STATE RIDES EVERY REPLY. There are six ways sleep can end (waking,
	// `wake`, any command, the loop, two flavours of being attacked in your bed)
	// and no single funnel that clears `player.sleeping`. Rather than teach all
	// six to notify the client — the exact mistake that left wakeFromDream
	// uncalled on half of them — the truth is stamped on whatever we were already
	// about to send. One site, and it cannot drift out of sync with the server.
	ws.send(JSON.stringify({ type: 'sleep_state', sleeping: !!player.sleeping, dreaming: !!player.sleeping?.inDream }));
	if (result) {
		ws.send(JSON.stringify(stampToLog(player, result)));
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

	// A CONVERSATION WITH SOMETHING THAT IS NOT AN NPC ROW.
	//
	// The dialogue panel is a perfectly good interface for talking to a thing
	// that only exists inside one player's head — but there is no `npcs` row
	// behind it and there never will be. Rather than teach the panel about
	// hallucinations, the engine offers a seam: any npcId a plugin claims is
	// routed to it, and whatever it returns is sent as the next dialogue frame.
	// The engine stays ignorant of what is on the other end (see plugins/trip).
	if (typeof msg.npcId === 'string' && msg.npcId.includes(':')) {
		const player = getLivePlayer(session.playerId);
		const synthetic = await fireHook('dialogue.synthetic', {
			player, npcId: msg.npcId, choice: msg.choice, optionIndex: msg.optionIndex, broadcast,
		});
		if (synthetic) { ws.send(JSON.stringify(synthetic)); return; }
	}

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
	const openShopAction = (targetNode?.actions || []).find((a) => a?.action === "OPEN_SHOP");
	if (openShopAction) {
		// A node may name a SHELF (params.shelf) — that is the only way a back-room
		// catalogue is ever reachable, so the covert half of a vendor stays covert.
		await openNpcShop(ws, session, npc, openShopAction.params?.shelf || openShopAction.shelf || null);
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
			stage: rendered.stage,
			mood: rendered.mood,
		}),
	);
}

// Open a vendor's shop for the player: guards (has-stock, open-hours), start the
// shop session, and push the GUI panel. The single clean shop-open path shared by
// the implicit "__shop__" option and any dialogue node authored with an OPEN_SHOP
// action — so the two can't drift on guards or payload.
async function openNpcShop(ws, session, npc, shelf = null) {
	const player = getLivePlayer(session.playerId);
	if (!player) return;
	if (!(npc.vendor_inventory || []).some((e) => (e.shelf || null) === (shelf || null))) {
		ws.send(JSON.stringify({ type: "error", message: `${npc.name} has nothing to sell.` }));
		return;
	}
	const { isVendorClosed, vendorClosedLine } = await import("./engine/ai-behaviour.js");
	if (isVendorClosed(npc)) {
		ws.send(JSON.stringify({ type: "error", message: vendorClosedLine(npc) }));
		return;
	}
	openShopSession(session.playerId, npc.id, shelf);
	await sendShopPanel(ws, npc, session.playerId);
}

// Render the GUI shop panel (both Buy stock and Sell inventory) for a player.
// Shared by shop-open, buy, and sell so the three paths can't drift on payload shape.
async function sendShopPanel(ws, npc, playerId, extra = {}) {
	const player = getLivePlayer(playerId);
	if (!player) return;
	const { getVendorStock, getSellableInventory } = await import("./engine/vendor.js");
	const { getShopShelf } = await import("./engine/vendor-session.js");
	const stock = await getVendorStock(npc, playerId, getShopShelf(playerId));
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
	const { isStackable } = await import("./engine/tags.js");
	// The GUI shop can request a quantity (stepper / Max button). Clamp it, and
	// force a single unit for non-stackable items so a stack can't collapse a
	// unique into one over-counted row.
	let qty = Math.max(1, Math.min(99, Number(msg.quantity) || 1));
	if (boughtItem && !isStackable(boughtItem)) qty = 1;
	const { getShopShelf } = await import("./engine/vendor-session.js");
	const result = await buyFromVendor(player, npc, msg.itemId, qty, getShopShelf(session.playerId));
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
	// A verification gate with no working mailer locks every new account out, so
	// say so at boot rather than letting registrations quietly strand.
	if (isEmailVerificationEnabled() && mailerConfigProblem()) {
		console.error(`[boot] WARNING: email verification is ON but the mailer is ${mailerConfigProblem()} — new accounts cannot receive verification links.`);
	} else if (isEmailVerificationEnabled()) {
		// Print the sender this process actually resolved. Without it, a dashboard
		// env edit that landed on the wrong service (or never restarted anything)
		// is indistinguishable from one that took effect.
		console.log(`[boot] mailer ready — sender ${mailerSender()}`);
	}
	await initWorld();
	// Door lock state isn't persisted (world.doors resets to authored state); re-apply
	// each locked apartment's durable lock onto its door(s) in RAM.
	reconcileApartmentDoorLocks();
	// LAW: no NPC may be homed in a player-owned apartment. Rehome any squatter a
	// hardcoded content home_zone parked in an owned unit (the "someone's in Akerson's
	// 2A" bug class). Converges — a corrected NPC's home is unowned, so this no-ops next boot.
	await reconcileNpcHomesVsOwnership();
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
	// Subscribes one dispatcher per bound event name — must run before any
	// player is connected, but is order-independent w.r.t. plugin event emitters.
	await loadScriptTriggers();
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
