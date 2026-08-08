import { sendCmdSilent } from "../net.js";
import { state } from "../state.js";
import {
	parseMarkup,
	expandTokens,
	MARKUP_HELP_HTML,
	STATUS_TEMPLATE,
} from "../markup.js";

const USERS_TAB = "__users__";
const WHISPER_MAX_MSGS = 100;

// Emoji shortcodes: typing :code: auto-replaces with the emoji as you type.
// Covers every emoji in the picker below (multiple aliases per glyph).
const EMOJI_SHORTCODES = {
	joy: "😂", lol: "😂", laugh: "😂",
	skull: "💀", dead: "💀",
	fire: "🔥", lit: "🔥",
	zap: "⚡", lightning: "⚡",
	rad: "☢️", radiation: "☢️", nuke: "☢️",
	syringe: "💉", needle: "💉",
	blood: "🩸",
	knife: "🗡️", dagger: "🗡️",
	bomb: "💣",
	clown: "🤡",
	devil: "😈", imp: "😈",
	angry_devil: "👿", devilrage: "👿",
	robot: "🤖", bot: "🤖",
	alien: "👾",
	brain: "🧠",
	eye: "👁️",
	sick: "🤢", nauseated: "🤢",
	rage: "😤", huff: "😤",
	cry: "😭", sob: "😭",
	100: "💯", hundred: "💯",
	shaka: "🤙",
	wave: "👋",
	salute: "🫡",
	heart: "❤️",
	sparkles: "✨",
	boom: "💥", explosion: "💥",
	target: "🎯", dart: "🎯", bullseye: "🎯",
	ruins: "🏚️",
	pill: "💊",
	smoke: "🚬", cig: "🚬",
	beer: "🍺",
	money: "💰", cash: "💰",
};

// Classic text emoticons that auto-convert inline as you type (alongside the
// :shortcode: syntax above). Ordered longest-first so multi-char faces win.
const EMOTICONS = [
	[":'(", "😭"],
	[">:(", "😠"],
	[":-)", "😊"],
	[":-D", "😃"],
	[":-(", "😢"],
	[":-P", "😛"],
	[":-p", "😛"],
	[":-O", "😮"],
	[":-o", "😮"],
	[":-/", "😕"],
	[";-)", "😉"],
	[":)", "😊"],
	[":D", "😃"],
	[":(", "😢"],
	[":P", "😛"],
	[":p", "😛"],
	[":O", "😮"],
	[":o", "😮"],
	[":/", "😕"],
	[":|", "😐"],
	[";)", "😉"],
	["<3", "❤️"],
	["xD", "😆"],
	["XD", "😆"],
];

// On input, replace a completed emoji token immediately before the cursor —
// either a :shortcode: or a classic text emoticon.
function _emojiAutoReplace(inp) {
	const pos = inp.selectionStart ?? inp.value.length;
	const before = inp.value.slice(0, pos);
	const _swap = (len, emoji) => {
		const start = pos - len;
		inp.value = inp.value.slice(0, start) + emoji + inp.value.slice(pos);
		inp.selectionStart = inp.selectionEnd = start + emoji.length;
	};
	// :shortcode: — a completed token ending in a colon.
	const m = before.match(/:([a-z0-9_+-]+):$/i);
	if (m) {
		const emoji = EMOJI_SHORTCODES[m[1].toLowerCase()];
		if (emoji) return _swap(m[0].length, emoji);
	}
	// Text emoticons — only when preceded by whitespace/start, so URLs (http://)
	// and mid-word colons don't trip it.
	for (const [token, emoji] of EMOTICONS) {
		if (!before.endsWith(token)) continue;
		const start = pos - token.length;
		if (start > 0 && !/\s/.test(before[start - 1])) continue;
		return _swap(token.length, emoji);
	}
}
const WHISPER_CONVO_KEY = "whisper_convos";
const WHISPER_PERSIST_MAX = 100;

// Channels the server told us this player has access to: id -> { id, permanent, systemOnly }
const _channels = new Map();

let _whisperPanelVisible = false;
let _activeWhisperTab = USERS_TAB;
// Most recently opened PM — kept pinned as a single quick-access strip tab so
// there's always one conversation reachable in one click.
let _lastPmTab = null;
const _whisperConvos = new Map();
// Conversations the player closed this session, kept so an embedder (the Tablet
// Chat's Users hub) can offer to re-open them: key -> { key, label, kind, channel }.
// `channel` holds the stashed channel def for a closed channel so re-opening can
// restore it (PMs are re-created fresh via ensureChatConversation).
const _closedChatTabs = new Map();
let _onlinePlayers = [];

// Window/text size settings
let _windowSize = "small"; // 'small' | 'medium' | 'large'
let _textSize = "medium"; // 'small' | 'medium' | 'large'

// Stored MOTD data received from server (raw templates + dynamic text)
let _motdData = null;
let _motdDims = {}; // { big:{w,h}, medium:{w,h}, small:{w,h} } — cached from off-screen measure

// rem, not pt: an absolute unit here would override the global type scale rather
// than compose with it, so a player reading at the 200% rung would open Whisper
// and find the one panel that ignored them. Same rendered size at the default rung
// as the 5/8/11pt these replace.
const FONT_SIZES = { small: "0.4167rem", medium: "0.6667rem", large: "0.9167rem" };

function _loadSettings() {
	try {
		const s = JSON.parse(localStorage.getItem("whisper_settings") || "{}");
		if (["small", "medium", "large"].includes(s.windowSize))
			_windowSize = s.windowSize;
		if (["small", "medium", "large"].includes(s.textSize))
			_textSize = s.textSize;
	} catch {}
}

function _saveSettings() {
	try {
		localStorage.setItem(
			"whisper_settings",
			JSON.stringify({ windowSize: _windowSize, textSize: _textSize }),
		);
	} catch {}
}

function _saveConvos() {
	try {
		const toSave = {};
		for (const [handle, convo] of _whisperConvos) {
			if (_channels.has(handle) || handle === USERS_TAB) continue;
			toSave[handle] = convo.messages.slice(-WHISPER_PERSIST_MAX);
		}
		if (Object.keys(toSave).length === 0) return;
		localStorage.setItem(WHISPER_CONVO_KEY, JSON.stringify(toSave));
	} catch (e) {
		console.error("[whisper] save failed:", e);
	}
}

function _restoreOrCreate(handle) {
	try {
		const saved = JSON.parse(
			localStorage.getItem(WHISPER_CONVO_KEY) || "{}",
		);
		const messages = saved[handle];
		if (Array.isArray(messages) && messages.length > 0) {
			return { messages, scrollTop: 999999, unread: 0 };
		}
	} catch {}
	return { messages: [], scrollTop: 999999, unread: 0 };
}

function _loadConvos() {
	try {
		const raw = localStorage.getItem(WHISPER_CONVO_KEY);
		const saved = JSON.parse(raw || "{}");
		for (const [handle, messages] of Object.entries(saved)) {
			if (!Array.isArray(messages) || messages.length === 0) continue;
			_whisperConvos.set(handle, {
				messages,
				scrollTop: 999999,
				unread: 0,
			});
		}
	} catch (e) {
		console.error("[whisper] load failed:", e);
	}
}

export function initChannels(channelList) {
	for (const ch of channelList || []) {
		_channels.set(ch.id, ch);
		if (!_whisperConvos.has(ch.id))
			_whisperConvos.set(ch.id, {
				messages: [],
				scrollTop: 999999,
				unread: 0,
			});
	}
}

function _isSystemOnly(tabKey) {
	return _channels.has(tabKey) && _channels.get(tabKey).systemOnly;
}

// Display label for a channel — the server-supplied '#<corp name>' etc., falling
// back to the raw id (which is still the routing key everywhere).
function _channelLabel(id) {
	const ch = _channels.get(id);
	return (ch && ch.label) || id;
}

// ── Embeddable chat API ────────────────────────────────────────────────────
// Lets another surface (the Tablet OS Chat app) present the same conversations
// this floating panel owns, without duplicating the chat state. Subscribers are
// notified whenever a message arrives/sends or the tab set changes, so they can
// re-render live (the tablet has no server push of its own).
const _chatListeners = new Set();
export function onChatUpdate(cb) {
	_chatListeners.add(cb);
	return () => _chatListeners.delete(cb);
}
function _emitChatUpdate() {
	for (const cb of _chatListeners) {
		try { cb(); } catch (e) { console.error("[chat] listener failed:", e); }
	}
}

// Channels then open PM conversations (the USERS hub isn't a real tab). Each:
// { key (routing id), label, kind: 'channel'|'pm', unread, systemOnly }.
export function getChatTabs() {
	const out = [];
	for (const [id, ch] of _channels) {
		const convo = _whisperConvos.get(id);
		out.push({ key: id, label: _channelLabel(id), kind: "channel", unread: convo?.unread || 0, systemOnly: !!ch.systemOnly, closable: !ch.permanent });
	}
	for (const [handle, convo] of _whisperConvos) {
		if (_channels.has(handle) || handle === USERS_TAB) continue;
		out.push({ key: handle, label: handle, kind: "pm", unread: convo.unread || 0, systemOnly: false, closable: true });
	}
	return out;
}

export function getChatMessages(key) {
	const convo = _whisperConvos.get(key);
	if (!convo) return [];
	return convo.messages.map((m) => ({ from: m.from, message: m.message, isMe: !!m.isMe, isHtml: !!m.isHtml }));
}

// Clear a conversation's unread count (the embedder is actively showing it).
// Deliberately does NOT emit an update — it's a read side-effect, not new data,
// and emitting here would loop a subscriber that calls this on every render.
export function markChatRead(key) {
	const convo = _whisperConvos.get(key);
	if (convo && convo.unread) {
		convo.unread = 0;
		_updateChatBadge();
		if (_whisperPanelVisible) _refreshWhisperTabs();
	}
}

// Send to a channel/PM tab (mirrors sendWhisperReply's send path for one tab).
// Returns 'left' if the text was the /leave command (so an embedder can react),
// else undefined.
export function sendChatMessage(key, text) {
	const msg = (text || "").trim();
	if (!msg || !key) return;
	// `/leave` closes the current conversation (channel or PM), same as the tab ✕.
	if (msg.toLowerCase() === "/leave") { leaveChatConversation(key); return 'left'; }
	if (key === USERS_TAB || _isSystemOnly(key)) return;
	const expanded = expandTokens(msg);
	_echoOwnMessage(key, expanded);
	sendCmdSilent(`whisper ${key} ${expanded}`);
}

// Close/leave a conversation from an embedder (Tablet Chat's ✕ / /leave).
// Permanent channels (#system) can't be left — _closeWhisperTab guards that.
export function leaveChatConversation(key) {
	_closeWhisperTab(key);
}

// Conversations closed this session, newest first — the Tablet's Users hub lists
// these so a closed channel/PM can be brought back.
export function getClosedChatTabs() {
	return [..._closedChatTabs.values()].reverse();
}

// Re-open a previously closed conversation. A channel is restored from its
// stashed def; a PM is re-created fresh (its old messages were dropped on close).
export function reopenChatTab(key) {
	const entry = _closedChatTabs.get(key);
	_closedChatTabs.delete(key);
	if (entry && entry.kind === "channel" && entry.channel) {
		_channels.set(key, entry.channel);
		if (!_whisperConvos.has(key))
			_whisperConvos.set(key, { messages: [], scrollTop: 999999, unread: 0 });
		if (_whisperPanelVisible) _refreshWhisperTabs();
		_emitChatUpdate();
		return key;
	}
	return ensureChatConversation(key); // PM (also emits an update)
}

// Drop every corp channel (#corp:<orgId>) from the chat list — called when the
// player's corp folds/disbands, so the now-dead channel disappears everywhere.
export function removeCorpChannels() {
	for (const id of [..._channels.keys()]) {
		if (String(id).startsWith("#corp:")) {
			_channels.delete(id);
			_whisperConvos.delete(id);
			if (_activeWhisperTab === id) _activeWhisperTab = USERS_TAB;
		}
	}
	if (_whisperPanelVisible) _refreshWhisperTabs();
	_updateChatBadge();
	_emitChatUpdate();
}

// ── MOTD ──────────────────────────────────────────────────────────────────────

function _selectMotdSize() {
	if (_windowSize === "large") return "big";
	if (_windowSize === "medium") return "medium";
	return "small";
}

function _esc(s) {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

// Lay a list of strings into the space a border token occupied, word-wrapping
// each to `totalSpace` and (when a right border `║` is present) padding every
// line back out to it so the box stays square. Continuation lines re-open the
// left border and indent to the token's column. Borderless callers (the RECENT
// NEWS block in the medium/small templates sits outside the box) get one line
// per item, unwrapped. Shared by the <news> token; mirrors the inline logic the
// <dynamic text> token still uses for its single string.
function _fitBorderLines(prefix, rborder, totalSpace, items) {
	if (!rborder) {
		const flat = items.length ? items : [""];
		return flat.map((l) => prefix + l).join("\n");
	}
	const contLeft = rborder + " ".repeat(Math.max(0, prefix.length - 1));
	const out = [];
	for (const item of items) {
		const s = String(item);
		if (s.length <= totalSpace) { out.push(s); continue; }
		const words = s.split(" ");
		let cur = "";
		for (const w of words) {
			const test = cur ? cur + " " + w : w;
			if (test.length > totalSpace) { if (cur) out.push(cur); cur = w; }
			else cur = test;
		}
		if (cur) out.push(cur);
	}
	if (!out.length) out.push("");
	return out
		.map((l, i) => {
			const pad = " ".repeat(Math.max(0, totalSpace - l.length));
			return (i === 0 ? prefix : contLeft) + l + pad + rborder;
		})
		.join("\n");
}

function _applyMotdSubstitutions(template, handle, dynamicText, newsLines) {
	const date = new Date().toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
	let text = template;

	text = text.replace(/<player name>( *)/g, (_, spaces) => handle + spaces);
	text = text.replace(/<date>/g, date);

	// <dynamic text> substitution: replace placeholder, preserving line width.
	// totalSpace = placeholder width (14) + trailing spaces — the full chars available for dyn.
	// Word-wraps onto continuation lines (║-indented) when dyn exceeds totalSpace.
	text = text.replace(
		/^(.*?)<dynamic text>( *)(║?)$/gm,
		(_, prefix, spaces, rborder) => {
			const totalSpace = spaces.length + 14;
			const dyn = dynamicText || "";

			if (!rborder || dyn.length <= totalSpace) {
				return (
					prefix +
					dyn +
					" ".repeat(Math.max(0, totalSpace - dyn.length)) +
					rborder
				);
			}

			// Word-wrap: continuation lines left-indent to match prefix depth
			const contLeft = rborder + " ".repeat(prefix.length - 1);
			const words = dyn.split(" ");
			const lines = [];
			let cur = "";
			for (const w of words) {
				const test = cur ? cur + " " + w : w;
				if (test.length > totalSpace) {
					if (cur) lines.push(cur);
					cur = w;
				} else cur = test;
			}
			if (cur) lines.push(cur);
			if (!lines.length) return prefix + " ".repeat(totalSpace) + rborder;

			return lines
				.map((l, i) => {
					const pad = " ".repeat(Math.max(0, totalSpace - l.length));
					return (i === 0 ? prefix : contLeft) + l + pad + rborder;
				})
				.join("\n");
		},
	);

	// <news> — expands to the live-news lines the server attached to the MOTD,
	// each wrapped/padded inside the ascii border exactly like <dynamic text>.
	// Falls back to a placeholder when there's no news to show.
	text = text.replace(
		/^(.*?)<news>( *)(║?)$/gm,
		(_, prefix, spaces, rborder) => {
			const totalSpace = spaces.length + 6; // "<news>".length
			const items = newsLines && newsLines.length
				? newsLines
				: ["[No recent broadcasts available]"];
			return _fitBorderLines(prefix, rborder, totalSpace, items);
		},
	);

	return text;
}

// Render each MOTD off-screen to measure natural width + height.
// Cached in _motdDims so _applyWindowSize can size the panel immediately,
// even when #system is not the active tab.
function _measureMotdDims() {
	if (!_motdData) return;
	const handle =
		document.getElementById("handle-display")?.textContent?.trim() ||
		"Player";
	const fs = FONT_SIZES[_textSize];

	const host = document.createElement("div");
	host.style.cssText =
		"position:fixed;top:-9999px;left:0;visibility:hidden;pointer-events:none;width:max-content";
	document.body.appendChild(host);

	for (const size of ["big", "medium", "small"]) {
		const template = _motdData[size] || "";
		if (!template) {
			_motdDims[size] = { w: 0, h: 0 };
			continue;
		}
		const rendered = _applyMotdSubstitutions(
			template,
			handle,
			_motdData.dynamic || "",
			_motdData.news || [],
		);
		const pre = document.createElement("pre");
		pre.style.cssText = `font-family:var(--font-mono);white-space:pre;margin:0;line-height:1.3;font-size:${fs}`;
		pre.textContent = rendered;
		host.appendChild(pre);
		const rect = pre.getBoundingClientRect();
		_motdDims[size] = {
			w: Math.ceil(rect.width) + 40, // +10+10px log padding +2px border +17px scrollbar
			h: Math.ceil(rect.height) + 82, // +10+10px log padding +2px border +26px drag handle +34px tabs row
		};
		host.removeChild(pre);
	}

	document.body.removeChild(host);
}

function _setSystemMOTD(renderedText) {
	const channelId = "#system";
	if (!_whisperConvos.has(channelId))
		_whisperConvos.set(channelId, {
			messages: [],
			scrollTop: 0,
			unread: 0,
		});
	const convo = _whisperConvos.get(channelId);
	const isFirst = convo.messages.length === 0;
	convo.messages = [
		{
			from: "SYSTEM",
			message: `<pre style="font-family:var(--font-mono);white-space:pre;margin:0;line-height:1.3;tab-size:4">${_esc(renderedText)}</pre>`,
			isMe: false,
			isHtml: true,
			ts: Date.now(),
		},
	];
	convo.unread = 0;
	convo.scrollTop = 0;
	convo.stickBottom = false; // MOTD reads from the top, never auto-scrolls
	if (isFirst) {
		_activeWhisperTab = channelId; // default to #system when panel is opened, but don't open it
	} else if (_activeWhisperTab === channelId) {
		// Re-render immediately whenever #system is active, panel open or closed
		_renderWhisperLog();
		const log = document.getElementById("whisper-log");
		if (log) log.scrollTop = 0;
	} else {
		if (_whisperPanelVisible) _refreshWhisperTabs();
	}
}

// Render the MOTD at an explicit size (default 'big'/Large) as ready-to-inject
// HTML, independent of the floating panel's window-size setting. The Tablet
// Chat uses this so it always shows the full Large MOTD (then scales it to fit).
export function getMotdHtml(size = "big") {
	if (!_motdData) return null;
	const template = _motdData[size] || _motdData.big || "";
	if (!template) return null;
	const handle =
		document.getElementById("handle-display")?.textContent?.trim() ||
		"Player";
	const text = _applyMotdSubstitutions(
		template,
		handle,
		_motdData.dynamic || "",
		_motdData.news || [],
	);
	return `<pre style="font-family:var(--font-mono);white-space:pre;margin:0;line-height:1.3;tab-size:4">${_esc(text)}</pre>`;
}

function _rerenderMotd() {
	if (!_motdData) return;
	const size = _selectMotdSize();
	const template = _motdData[size] || "";
	if (!template) return;
	const handle =
		document.getElementById("handle-display")?.textContent?.trim() ||
		"Player";
	const text = _applyMotdSubstitutions(
		template,
		handle,
		_motdData.dynamic || "",
		_motdData.news || [],
	);
	_setSystemMOTD(text);
}

export function receiveMOTD(msg) {
	_motdData = {
		big: msg.big || "",
		medium: msg.medium || "",
		small: msg.small || "",
		dynamic: msg.dynamic || "",
		news: Array.isArray(msg.news) ? msg.news : [],
	};
	_measureMotdDims();
	_applyWindowSize(); // update panel width now that widths are known
	_rerenderMotd();
}

// ── PANEL SIZE / TEXT SIZE ────────────────────────────────────────────────────

function _applyWindowSize() {
	const panel = document.getElementById("whisper-panel");
	const content = document.getElementById("whisper-content");
	if (!panel) return;

	const motdKey = _selectMotdSize(); // 'big' | 'medium' | 'small'
	const dims = _motdDims[motdKey];
	const fallbackW = { small: 300, medium: 500, large: 700 }[_windowSize];
	const fallbackH = { small: 340, medium: 480, large: 600 }[_windowSize];
	const maxW = Math.floor(window.innerWidth * 0.95);
	const maxH = Math.floor(window.innerHeight * 0.92);

	panel.style.width =
		Math.min(Math.max(dims?.w || fallbackW, 150), maxW) + "px";
	panel.style.height =
		Math.min(Math.max(dims?.h || fallbackH, 150), maxH) + "px";
	panel.style.right = "8px";
	panel.style.bottom = "8px";
	panel.style.left = "auto";
	panel.style.top = "auto";
	panel.style.borderRadius = "4px";

	if (content) {
		content.style.transform = "";
		content.style.width = "";
	}

	_refreshCogMenu();
}

function _applyTextSize() {
	const fs = FONT_SIZES[_textSize];
	const log = document.getElementById("whisper-log");
	if (log) log.style.fontSize = fs;
	const inp = document.getElementById("whisper-reply-input");
	if (inp) inp.style.fontSize = fs;
	_refreshCogMenu();
}

function _refreshCogMenu() {
	const menu = document.getElementById("whisper-cog-menu");
	if (!menu) return;
	menu.querySelectorAll("[data-winsize]").forEach((btn) => {
		const active = btn.dataset.winsize === _windowSize;
		btn.style.background = active ? "var(--bg3)" : "transparent";
		btn.style.borderColor = active ? "var(--accent)" : "var(--border)";
		btn.style.color = active ? "var(--accent)" : "var(--text-dim)";
	});
	menu.querySelectorAll("[data-txtsize]").forEach((btn) => {
		const active = btn.dataset.txtsize === _textSize;
		btn.style.background = active ? "var(--bg3)" : "transparent";
		btn.style.borderColor = active ? "var(--accent)" : "var(--border)";
		btn.style.color = active ? "var(--accent)" : "var(--text-dim)";
	});
}

// ── PANEL TOGGLE / TAB OPEN ───────────────────────────────────────────────────

export function toggleWhisperPanel() {
	_whisperPanelVisible = !_whisperPanelVisible;
	const panel = document.getElementById("whisper-panel");
	panel.style.display = _whisperPanelVisible ? "flex" : "none";
	if (_whisperPanelVisible) {
		_applyWindowSize();
		_applyTextSize();
		_switchToTab(_activeWhisperTab);
		if (_activeWhisperTab !== USERS_TAB)
			document.getElementById("whisper-reply-input")?.focus();
		setTimeout(() => {
			const log = document.getElementById("whisper-log");
			if (log) {
				log.scrollTop = log.scrollHeight;
				_checkWhisperScroll();
			}
		}, 0);
	}
	_updateChatBadge();
}

export function openWhisperTab(handle) {
	if (!_whisperConvos.has(handle)) {
		_whisperConvos.set(handle, _restoreOrCreate(handle));
	}
	_whisperConvos.get(handle).unread = 0;
	if (!_channels.has(handle) && handle !== USERS_TAB) _lastPmTab = handle;
	_switchToTab(handle);
	if (!_whisperPanelVisible) {
		_whisperPanelVisible = true;
		const panel = document.getElementById("whisper-panel");
		panel.style.display = "flex";
		_applyWindowSize();
		_applyTextSize();
		setTimeout(() => {
			const log = document.getElementById("whisper-log");
			if (log) {
				log.scrollTop = log.scrollHeight;
				_checkWhisperScroll();
			}
		}, 0);
	}
	if (!_isSystemOnly(handle))
		document.getElementById("whisper-reply-input")?.focus();
	_updateChatBadge();
	_emitChatUpdate();
}

function _switchToTab(key) {
	_activeWhisperTab = key;
	const convo = _whisperConvos.get(key);
	if (convo) convo.unread = 0;
	_updateChatBadge();
	_refreshWhisperTabs();
	_renderWhisperLog();
	const footer = document.getElementById("whisper-footer");
	if (footer)
		footer.style.display =
			key === USERS_TAB || _isSystemOnly(key) ? "none" : "flex";
	if (key === USERS_TAB) _fetchOnlinePlayers();
	const whisperLog = document.getElementById("whisper-log");
	if (_activeWhisperTab != "#system") {
		whisperLog.scrollTop = 100000;
	} else {
		whisperLog.scrollTop = 0;
	}
}

function _closeWhisperTab(handle) {
	if (_channels.has(handle) && _channels.get(handle).permanent) return;
	// Remember it so the Users hub can re-open it. A channel keeps its def (to
	// restore access/labels); a PM just needs its handle.
	const ch = _channels.get(handle);
	_closedChatTabs.set(handle, {
		key: handle,
		label: ch ? _channelLabel(handle) : handle,
		kind: ch ? "channel" : "pm",
		channel: ch || null,
	});
	_saveConvos();
	_whisperConvos.delete(handle);
	_channels.delete(handle);
	// Re-pin the quick-access slot to another remaining PM (if any).
	if (_lastPmTab === handle) {
		_lastPmTab = null;
		for (const [h] of _whisperConvos) {
			if (_channels.has(h) || h === USERS_TAB) continue;
			_lastPmTab = h;
			break;
		}
	}
	if (_activeWhisperTab === handle) _switchToTab(USERS_TAB);
	else {
		_refreshWhisperTabs();
		_updateChatBadge();
	}
	_emitChatUpdate();
}

// ── TABS ──────────────────────────────────────────────────────────────────────

function _refreshWhisperTabs() {
	const tabs = document.getElementById("whisper-tabs");
	if (!tabs) return;
	tabs.innerHTML = "";

	const mkPip = () => {
		const pip = document.createElement("span");
		pip.className = "whisper-tab-pip";
		pip.textContent = "!";
		return pip;
	};

	const mkClosableTab = (label, handle, active, onOpen, onClose) => {
		const convo = _whisperConvos.get(handle);
		const wrap = document.createElement("div");
		wrap.className = `whisper-tab-wrap${active ? " active" : ""}`;
		wrap.addEventListener("click", onOpen);
		if (convo?.unread > 0) wrap.appendChild(mkPip());
		const labelSpan = document.createElement("span");
		labelSpan.className = "whisper-tab-label";
		labelSpan.textContent = label;
		const closeBtn = document.createElement("button");
		closeBtn.className = "whisper-tab-close";
		closeBtn.textContent = "×";
		closeBtn.title = "Close tab";
		closeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			onClose();
		});
		wrap.appendChild(labelSpan);
		wrap.appendChild(closeBtn);
		tabs.appendChild(wrap);
	};

	// Count PM conversations with unread so the hub tab can surface a pip.
	let pmUnread = 0;
	for (const [handle, convo] of _whisperConvos) {
		if (_channels.has(handle) || handle === USERS_TAB) continue;
		if (handle !== _lastPmTab && convo.unread > 0) pmUnread += convo.unread;
	}

	const hubTab = document.createElement("button");
	hubTab.className = `whisper-tab${_activeWhisperTab === USERS_TAB ? " active tab-purple" : ""}`;
	hubTab.textContent = "Chats";
	hubTab.onclick = () => _switchToTab(USERS_TAB);
	if (pmUnread > 0) hubTab.appendChild(mkPip());
	tabs.appendChild(hubTab);

	// Channel tabs
	for (const [id, ch] of _channels) {
		const active = _activeWhisperTab === id;
		const convo = _whisperConvos.get(id);
		if (ch.permanent) {
			const t = document.createElement("button");
			t.className = `whisper-tab${active ? " active tab-yellow" : ""}`;
			t.textContent = _channelLabel(id);
			t.onclick = () => _switchToTab(id);
			if (convo?.unread > 0) t.appendChild(mkPip());
			tabs.appendChild(t);
		} else {
			mkClosableTab(
				_channelLabel(id),
				id,
				active,
				() => openWhisperTab(id),
				() => _closeWhisperTab(id),
			);
		}
	}

	// PM conversations live in the Chats hub list, not the strip. One PM stays
	// pinned here as a quick-access tab (the last one opened); it has no close
	// button — closing happens from the hub, and switching PMs re-pins this slot.
	if (_lastPmTab && _whisperConvos.has(_lastPmTab) && !_channels.has(_lastPmTab)) {
		const active = _activeWhisperTab === _lastPmTab;
		const convo = _whisperConvos.get(_lastPmTab);
		const t = document.createElement("button");
		t.className = `whisper-tab${active ? " active tab-purple" : ""}`;
		t.textContent = _lastPmTab;
		t.onclick = () => openWhisperTab(_lastPmTab);
		if (!active && convo?.unread > 0) t.appendChild(mkPip());
		tabs.appendChild(t);
	}
}

// ── LOG RENDER ────────────────────────────────────────────────────────────────

function _renderWhisperLog() {
	const log = document.getElementById("whisper-log");
	if (!log) return;
	if (_activeWhisperTab === USERS_TAB) {
		_renderUsersTab(log);
		document.getElementById("whisper-new-msgs").style.display = "none";
		return;
	}
	const convo = _whisperConvos.get(_activeWhisperTab);
	if (!convo) return;
	// Was the view pinned to the bottom before this rebuild? A fresh convo
	// (stickBottom undefined) defaults to pinned so its first messages land at
	// the bottom; #system pins to the top (stickBottom=false, scrollTop=0).
	const stick = convo.stickBottom !== false;
	log.innerHTML = "";
	for (const m of convo.messages) {
		const entry = document.createElement("div");
		entry.style.cssText =
			"padding:4px 0;border-bottom:1px solid var(--border)";
		const nameColor = m.isMe ? "var(--text-dim)" : "var(--purple)";
		const body = m.isHtml ? m.message : parseMarkup(m.message);
		entry.innerHTML = `<div style="color:${nameColor};margin-bottom:2px;font-style:${m.isMe ? "italic" : ""}">${_esc(m.from)}</div><div style="color:var(--text)">${body}</div>`;
		log.appendChild(entry);
	}
	log.scrollTop = stick ? log.scrollHeight : convo.scrollTop || 0;
	_checkWhisperScroll();
}

function _renderUsersTab(log) {
	let html = "";

	// Open PM conversations — the scalable home for whispers that used to each
	// get their own strip tab.
	const pms = [];
	for (const [handle, convo] of _whisperConvos) {
		if (_channels.has(handle) || handle === USERS_TAB) continue;
		pms.push([handle, convo]);
	}
	if (pms.length > 0) {
		html +=
			'<div style="padding:8px 10px 4px;font-size:0.625rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Conversations</div>';
		for (const [handle, convo] of pms) {
			const h = handle.replace(/"/g, "&quot;");
			const badge =
				convo.unread > 0
					? `<span style="background:var(--red);color:#fff;font-size:0.5625rem;font-weight:bold;min-width:12px;height:12px;padding:0 3px;border-radius:2px;display:inline-flex;align-items:center;justify-content:center">${convo.unread}</span>`
					: "";
			html += `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:5px 10px;border-bottom:1px solid var(--border)"><button data-pm="${h}" style="flex:1;text-align:left;background:transparent;border:none;color:var(--text);font-family:var(--font-mono);font-size:0.75rem;cursor:pointer;padding:0">${_esc(handle)}</button>${badge}<button data-pm-close="${h}" title="Close conversation" style="background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono);font-size:0.6875rem;line-height:1;width:16px;height:16px;padding:0;cursor:pointer;border-radius:2px">×</button></div>`;
		}
	}

	if (_channels.size > 0) {
		html +=
			'<div style="padding:8px 10px 4px;font-size:0.625rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Channels</div>';
		for (const [id] of _channels) {
			const h = id.replace(/"/g, "&quot;");
			html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-bottom:1px solid var(--border)"><span style="font-size:0.75rem;color:var(--yellow)">${_esc(_channelLabel(id))}</span><button data-channel="${h}" style="background:transparent;border:1px solid var(--border);color:var(--accent);font-family:var(--font-mono);font-size:0.5625rem;padding:2px 6px;cursor:pointer;border-radius:2px">open</button></div>`;
		}
	}

	html +=
		'<div style="padding:8px 10px 4px;font-size:0.625rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Online now</div>' +
		(_onlinePlayers.length
			? _onlinePlayers
					.map((p) => {
						const h = p.handle.replace(/"/g, "&quot;");
						return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-bottom:1px solid var(--border)"><span style="font-size:0.75rem;color:var(--text)">${_esc(p.handle)}</span><button data-whisper="${h}" title="Whisper ${_esc(p.handle)}" style="background:transparent;border:none;color:var(--accent);font-size:0.8125rem;cursor:pointer;padding:0 2px;line-height:1">💬</button></div>`;
					})
					.join("")
			: '<div style="padding:10px 10px;color:var(--text-dim);font-size:0.6875rem">No other players online.</div>') +
		'<div style="padding:6px 10px"><button data-refresh-online style="width:100%;background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono);font-size:0.625rem;padding:4px;cursor:pointer;border-radius:2px">↻ Refresh</button></div>';

	log.innerHTML = html;

	log.querySelectorAll("[data-pm]").forEach((btn) => {
		btn.addEventListener("click", () => openWhisperTab(btn.dataset.pm));
	});
	log.querySelectorAll("[data-pm-close]").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			_closeWhisperTab(btn.dataset.pmClose);
			_renderUsersTab(log);
		});
	});
	log.querySelectorAll("[data-channel]").forEach((btn) => {
		btn.addEventListener("click", () =>
			openWhisperTab(btn.dataset.channel),
		);
	});
	log.querySelectorAll("[data-whisper]").forEach((btn) => {
		btn.addEventListener("click", () =>
			openWhisperTab(btn.dataset.whisper),
		);
	});
	log.querySelector("[data-refresh-online]")?.addEventListener(
		"click",
		_fetchOnlinePlayers,
	);
}

// ── ONLINE PLAYERS ────────────────────────────────────────────────────────────

export async function refreshOnlinePlayers() {
	await _fetchOnlinePlayers();
}

// Last-fetched online players (excludes self) — for embedders (Tablet Chat app)
// that render their own "start a new message" list. Call refreshOnlinePlayers()
// to update it first.
export function getOnlinePlayers() {
	return _onlinePlayers.slice();
}

// Ensure a PM conversation exists (restoring saved history if any) WITHOUT
// opening or focusing the floating panel — for embedders that own their own
// view. Returns the conversation key (the handle).
export function ensureChatConversation(handle) {
	if (!handle) return null;
	_closedChatTabs.delete(handle); // it's back — drop it from the re-open list
	if (!_whisperConvos.has(handle))
		_whisperConvos.set(handle, _restoreOrCreate(handle));
	_emitChatUpdate();
	return handle;
}

async function _fetchOnlinePlayers() {
	try {
		const r = await fetch("/api/players/online");
		const data = await r.json();
		const myHandle = document
			.getElementById("handle-display")
			?.textContent?.trim();
		_onlinePlayers = Array.isArray(data)
			? data.filter((p) => p.handle !== myHandle)
			: [];
	} catch {
		_onlinePlayers = [];
	}
	if (_whisperPanelVisible && _activeWhisperTab === USERS_TAB) {
		_renderUsersTab(document.getElementById("whisper-log"));
	}
}

// ── SCROLL ────────────────────────────────────────────────────────────────────

function _checkWhisperScroll() {
	const log = document.getElementById("whisper-log");
	const pill = document.getElementById("whisper-new-msgs");
	if (!log || !pill) return;
	const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
	if (nearBottom) pill.style.display = "none";
}

function whisperScrollToBottom() {
	const log = document.getElementById("whisper-log");
	if (log) log.scrollTop = log.scrollHeight;
	document.getElementById("whisper-new-msgs").style.display = "none";
}

// ── SEND / RECEIVE ────────────────────────────────────────────────────────────

// Optimistic echo: your own line is rendered the instant you hit send, before
// the server round-trips. The server still echoes it back (whisper_sent for a
// DM, channel_msg for a channel); we record each optimistic line here and
// consume the matching echo so it isn't shown twice. Entries self-expire.
const _pendingSelfEchoes = [];
const _SELF_ECHO_TTL = 10000;

function _consumeSelfEcho(tab, message) {
	const now = Date.now();
	let matched = false;
	for (let i = _pendingSelfEchoes.length - 1; i >= 0; i--) {
		const e = _pendingSelfEchoes[i];
		if (now - e.ts > _SELF_ECHO_TTL) { _pendingSelfEchoes.splice(i, 1); continue; }
		if (!matched && e.tab === tab && e.message === message) {
			_pendingSelfEchoes.splice(i, 1);
			matched = true;
		}
	}
	return matched;
}

// Render your own outgoing line locally (DMs label it "You"; channels label it
// with your handle, matching how other members see it) and remember it so the
// server's echo is dropped.
function _echoOwnMessage(tab, message) {
	if (!_whisperConvos.has(tab)) _whisperConvos.set(tab, _restoreOrCreate(tab));
	const convo = _whisperConvos.get(tab);
	const isChannel = _channels.has(tab);
	const myHandle = state.player?.handle || "You";
	convo.messages.push(
		isChannel
			? { from: myHandle, message, isMe: false, ts: Date.now() }
			: { from: "You", message, isMe: true, ts: Date.now() },
	);
	if (convo.messages.length > WHISPER_MAX_MSGS) convo.messages.shift();
	convo.stickBottom = true; // sending your own line re-pins to the bottom
	_pendingSelfEchoes.push({ tab, message, ts: Date.now() });
	_saveConvos();
	if (_whisperPanelVisible && _activeWhisperTab === tab) _renderWhisperLog();
	_emitChatUpdate();
}

export function sentWhisper(handle, message) {
	// Already shown optimistically on send — this is just the server's echo.
	if (_consumeSelfEcho(handle, message)) return;
	if (!_whisperConvos.has(handle))
		_whisperConvos.set(handle, _restoreOrCreate(handle));
	const convo = _whisperConvos.get(handle);
	convo.messages.push({ from: "You", message, isMe: true, ts: Date.now() });
	if (convo.messages.length > WHISPER_MAX_MSGS) convo.messages.shift();
	convo.stickBottom = true; // sending your own line re-pins to the bottom
	_saveConvos();
	openWhisperTab(handle);
	_emitChatUpdate();
}

// A whisper we optimistically rendered turned out to be undeliverable (the
// server rejected it — e.g. the target went offline). `attempted` is the exact
// "<tab> <message>" text the server echoes back; pull the matching optimistic
// line back out so the pane never shows a message that wasn't sent.
export function rollbackSelfEcho(attempted) {
	const key = String(attempted).toLowerCase();
	const idx = _pendingSelfEchoes.findIndex(
		(e) => `${e.tab} ${e.message}`.toLowerCase() === key,
	);
	if (idx === -1) return;
	const [pending] = _pendingSelfEchoes.splice(idx, 1);
	const convo = _whisperConvos.get(pending.tab);
	if (!convo) return;
	for (let i = convo.messages.length - 1; i >= 0; i--) {
		if (convo.messages[i].message === pending.message) {
			convo.messages.splice(i, 1);
			break;
		}
	}
	_saveConvos();
	if (_whisperPanelVisible && _activeWhisperTab === pending.tab)
		_renderWhisperLog();
	_emitChatUpdate();
}

export function receiveWhisper(from, message) {
	_closedChatTabs.delete(from); // a new message revives the conversation tab
	if (!_whisperConvos.has(from))
		_whisperConvos.set(from, _restoreOrCreate(from));
	const convo = _whisperConvos.get(from);
	convo.messages.push({ from, message, isMe: false, ts: Date.now() });
	if (convo.messages.length > WHISPER_MAX_MSGS) convo.messages.shift();
	_saveConvos();
	if (_whisperPanelVisible && _activeWhisperTab === from) {
		// _renderWhisperLog auto-pins to the bottom when we were already there;
		// only surface the "new messages" pill when the reader had scrolled up.
		_renderWhisperLog();
		document.getElementById("whisper-new-msgs").style.display =
			convo.stickBottom === false ? "block" : "none";
	} else {
		convo.unread++;
		_updateChatBadge();
		if (_whisperPanelVisible) {
			_refreshWhisperTabs();
			if (_activeWhisperTab === USERS_TAB)
				_renderUsersTab(document.getElementById("whisper-log"));
		}
	}
	_emitChatUpdate();
}

// Replay stored channel history on login. history: { channelId: [{from, message, ts}, ...] }
export function initChannelHistory(history) {
	for (const [channelId, messages] of Object.entries(history || {})) {
		if (!_whisperConvos.has(channelId))
			_whisperConvos.set(channelId, {
				messages: [],
				scrollTop: 999999,
				unread: 0,
			});
		const convo = _whisperConvos.get(channelId);
		convo.messages = (messages || []).slice(-WHISPER_MAX_MSGS).map((m) => ({
			from: m.from,
			message: m.message,
			isMe: false,
			ts: m.ts,
		}));
		if (_activeWhisperTab === channelId) _renderWhisperLog();
	}
	_emitChatUpdate();
}

export function receiveChannelMsg(channelId, from, message) {
	// Our own channel line was already shown optimistically on send; drop the echo.
	if (from === state.player?.handle && _consumeSelfEcho(channelId, message)) return;
	if (!_whisperConvos.has(channelId))
		_whisperConvos.set(channelId, {
			messages: [],
			scrollTop: 999999,
			unread: 0,
		});
	const convo = _whisperConvos.get(channelId);
	convo.messages.push({ from, message, isMe: false, ts: Date.now() });
	if (convo.messages.length > WHISPER_MAX_MSGS) convo.messages.shift();
	if (_whisperPanelVisible && _activeWhisperTab === channelId) {
		_renderWhisperLog();
		document.getElementById("whisper-new-msgs").style.display =
			convo.stickBottom === false ? "block" : "none";
	} else {
		convo.unread++;
		_updateChatBadge();
		if (_whisperPanelVisible) _refreshWhisperTabs();
	}
	_emitChatUpdate();
}

// ── BADGE ─────────────────────────────────────────────────────────────────────

function _updateChatBadge() {
	let total = 0;
	for (const c of _whisperConvos.values()) total += c.unread;
	const btn = document.getElementById("chat-toggle-btn");
	if (btn) {
		btn.textContent = "💬 Chat";
		btn.style.borderColor = total > 0 ? "var(--red)" : "";
		btn.style.color = total > 0 ? "var(--red)" : "";
	}
	const badge = document.getElementById("chat-notif-badge");
	if (badge)
		badge.style.display =
			total > 0 && !_whisperPanelVisible ? "flex" : "none";
}

// ── SEND REPLY ────────────────────────────────────────────────────────────────

async function _openWhisperByHandle(handle) {
	await _fetchOnlinePlayers();
	const found = _onlinePlayers.find(
		(p) => p.handle.toLowerCase() === handle.toLowerCase(),
	);
	if (!found) {
		const log = document.getElementById("whisper-log");
		if (log) {
			const err = document.createElement("div");
			err.style.cssText = "padding:6px 0;color:var(--red);font-size:0.6875rem";
			err.textContent = `"${handle}" is not online.`;
			log.appendChild(err);
			log.scrollTop = log.scrollHeight;
		}
		return;
	}
	openWhisperTab(found.handle);
}

function sendWhisperReply() {
	const input = document.getElementById("whisper-reply-input");
	const msg = input?.value?.trim();
	if (!msg || !_activeWhisperTab || _activeWhisperTab === USERS_TAB) return;

	// Client-only commands
	if (msg.toLowerCase() === "/leave") {
		if (input) input.value = "";
		_closeWhisperTab(_activeWhisperTab);
		return;
	}
	if (msg.toLowerCase() === ".markup") {
		if (input) input.value = "";
		appendToWhisperLog(MARKUP_HELP_HTML);
		return;
	}
	if (msg.toLowerCase() === ".status") {
		if (input) input.value = "";
		sendToActiveTab(STATUS_TEMPLATE);
		return;
	}

	const whisperCmd = msg.match(/^whisper\s+(\S+)$/i);
	if (whisperCmd) {
		if (input) input.value = "";
		_openWhisperByHandle(whisperCmd[1]);
		return;
	}

	// Expand $tokens at send time so recipients see the sender's values
	const expanded = expandTokens(msg);

	if (_channels.has(_activeWhisperTab)) {
		if (_isSystemOnly(_activeWhisperTab)) return;
		_echoOwnMessage(_activeWhisperTab, expanded);
		sendCmdSilent(`whisper ${_activeWhisperTab} ${expanded}`);
		if (input) input.value = "";
		return;
	}

	_echoOwnMessage(_activeWhisperTab, expanded);
	sendCmdSilent(`whisper ${_activeWhisperTab} ${expanded}`);
	if (input) input.value = "";
}

export function debugFakeWhisper() {
	receiveWhisper(
		"TestUser",
		"This is a fake whisper to test the chat notification system.",
	);
}

// Append raw HTML into the active whisper tab. Returns true if it rendered, false if no tab is open.
export function appendToWhisperLog(html) {
	if (
		_activeWhisperTab === USERS_TAB ||
		!_whisperConvos.has(_activeWhisperTab)
	)
		return false;
	const log = document.getElementById("whisper-log");
	if (!log) return false;
	const div = document.createElement("div");
	div.style.cssText = "padding:4px 0;border-bottom:1px solid var(--border)";
	div.innerHTML = html;
	log.appendChild(div);
	log.scrollTop = log.scrollHeight;
	return true;
}

// Send text to the active whisper/channel tab (tokens expanded at call time).
export function sendToActiveTab(text) {
	if (!_activeWhisperTab || _activeWhisperTab === USERS_TAB) return false;
	if (_isSystemOnly(_activeWhisperTab)) return false;
	const expanded = expandTokens(text);
	sendCmdSilent(`whisper ${_activeWhisperTab} ${expanded}`);
	return true;
}

// ── INIT ──────────────────────────────────────────────────────────────────────

export function initWhisperPanel() {
	_loadSettings();
	_loadConvos();

	window.addEventListener("beforeunload", _saveConvos);

	document
		.getElementById("chat-toggle-btn")
		.addEventListener("click", toggleWhisperPanel);
	const replyInput = document.getElementById("whisper-reply-input");
	replyInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") sendWhisperReply();
	});
	replyInput.addEventListener("input", () => _emojiAutoReplace(replyInput));

	// Close (✕) button
	document.querySelectorAll("#whisper-panel button").forEach((btn) => {
		if (btn.textContent.trim() === "✕")
			btn.addEventListener("click", toggleWhisperPanel);
	});

	const footer = document.getElementById("whisper-footer");
	const sendBtn = footer?.querySelector("button");
	sendBtn?.addEventListener("click", sendWhisperReply);

	// ── Emoji picker ──────────────────────────────────────────────────────────────
	const EMOJIS = [
		"😂",
		"💀",
		"🔥",
		"⚡",
		"☢️",
		"💉",
		"🩸",
		"🗡️",
		"💣",
		"🤡",
		"😈",
		"👿",
		"🤖",
		"👾",
		"🧠",
		"👁️",
		"🤢",
		"😤",
		"😭",
		"💯",
		"🤙",
		"👋",
		"🫡",
		"❤️",
		"✨",
		"💥",
		"🎯",
		"🏚️",
		"💊",
		"🚬",
		"🍺",
		"💰",
	];

	const emojiBtn = document.createElement("button");
	emojiBtn.textContent = "😊";
	emojiBtn.title = "Insert emoji";
	emojiBtn.style.cssText =
		"background:transparent;border:1px solid var(--border);color:var(--text);font-size:0.875rem;padding:3px 7px;cursor:pointer;border-radius:2px;flex-shrink:0;line-height:1";

	const emojiPicker = document.createElement("div");
	emojiPicker.style.cssText = [
		"display:none;position:absolute;bottom:calc(100% + 4px);right:0",
		"background:var(--bg2);border:1px solid var(--border);border-radius:4px",
		"padding:6px;display:none;gap:4px;flex-wrap:wrap;width:220px",
		"z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.4)",
	].join(";");

	for (const emoji of EMOJIS) {
		const btn = document.createElement("button");
		btn.textContent = emoji;
		const code = Object.keys(EMOJI_SHORTCODES).find(
			(k) => EMOJI_SHORTCODES[k] === emoji,
		);
		if (code) btn.title = `:${code}:`;
		btn.style.cssText =
			"background:transparent;border:none;font-size:1.125rem;cursor:pointer;padding:2px;border-radius:2px;line-height:1";
		btn.addEventListener("mouseenter", () => {
			btn.style.background = "var(--bg3)";
		});
		btn.addEventListener("mouseleave", () => {
			btn.style.background = "transparent";
		});
		btn.addEventListener("click", () => {
			const inp = document.getElementById("whisper-reply-input");
			if (!inp) return;
			const start = inp.selectionStart ?? inp.value.length;
			const end = inp.selectionEnd ?? inp.value.length;
			inp.value =
				inp.value.slice(0, start) + emoji + inp.value.slice(end);
			inp.selectionStart = inp.selectionEnd = start + emoji.length;
			inp.focus();
			emojiPicker.style.display = "none";
		});
		emojiPicker.appendChild(btn);
	}

	const emojiWrap = document.createElement("div");
	emojiWrap.style.cssText = "position:relative;flex-shrink:0";
	emojiWrap.appendChild(emojiBtn);
	emojiWrap.appendChild(emojiPicker);

	emojiBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		const open = emojiPicker.style.display !== "none";
		emojiPicker.style.display = open ? "none" : "flex";
	});
	document.addEventListener("click", (e) => {
		if (!emojiWrap.contains(e.target)) emojiPicker.style.display = "none";
	});

	if (sendBtn) footer.insertBefore(emojiWrap, sendBtn);
	else footer?.appendChild(emojiWrap);
	document
		.getElementById("whisper-new-msgs")
		.addEventListener("click", whisperScrollToBottom);
	document
		.getElementById("whisper-scroll-bottom")
		.addEventListener("click", whisperScrollToBottom);

	document.getElementById("whisper-log").addEventListener("scroll", () => {
		if (!_activeWhisperTab || _activeWhisperTab === USERS_TAB) return;
		const log = document.getElementById("whisper-log");
		const convo = _whisperConvos.get(_activeWhisperTab);
		if (convo) {
			convo.scrollTop = log.scrollTop;
			convo.stickBottom =
				log.scrollHeight - log.scrollTop - log.clientHeight < 60;
		}
		_checkWhisperScroll();
	});

	// Cog menu
	const cogBtn = document.getElementById("whisper-cog-btn");
	const cogMenu = document.getElementById("whisper-cog-menu");
	if (cogBtn && cogMenu) {
		cogBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const open = cogMenu.style.display !== "none";
			cogMenu.style.display = open ? "none" : "block";
			if (!open) _refreshCogMenu();
		});
		document.addEventListener("click", (e) => {
			if (!cogMenu.contains(e.target) && e.target !== cogBtn)
				cogMenu.style.display = "none";
		});
		cogMenu.querySelectorAll("[data-winsize]").forEach((btn) => {
			btn.addEventListener("click", () => {
				_windowSize = btn.dataset.winsize;
				_saveSettings();
				_applyWindowSize();
				_rerenderMotd();
				cogMenu.style.display = "none";
			});
		});
		cogMenu.querySelectorAll("[data-txtsize]").forEach((btn) => {
			btn.addEventListener("click", () => {
				_textSize = btn.dataset.txtsize;
				_saveSettings();
				_applyTextSize();
				_measureMotdDims(); // font size changed → widths change
				_applyWindowSize();
				_rerenderMotd();
				cogMenu.style.display = "none";
			});
		});
	}

	const dragHandle = document.getElementById("whisper-drag-handle");
	const panel = document.getElementById("whisper-panel");
	let dragState = null;

	dragHandle.addEventListener("pointerdown", (e) => {
		if (e.target.closest("button") || e.target.closest("#whisper-cog-menu"))
			return;
		e.preventDefault();
		const r = panel.getBoundingClientRect();
		dragState = {
			pointerId: e.pointerId,
			ox: e.clientX - r.left,
			oy: e.clientY - r.top,
		};
		dragHandle.setPointerCapture(e.pointerId);
		dragHandle.style.cursor = "grabbing";
	});

	dragHandle.addEventListener("pointermove", (e) => {
		if (!dragState || dragState.pointerId !== e.pointerId) return;
		const x = Math.max(
			0,
			Math.min(
				window.innerWidth - panel.offsetWidth,
				e.clientX - dragState.ox,
			),
		);
		const y = Math.max(
			0,
			Math.min(
				window.innerHeight - panel.offsetHeight,
				e.clientY - dragState.oy,
			),
		);
		panel.style.left = x + "px";
		panel.style.top = y + "px";
		panel.style.right = "auto";
		panel.style.bottom = "auto";
	});

	document.addEventListener("pointerup", (e) => {
		if (dragState && dragState.pointerId === e.pointerId) {
			dragState = null;
			dragHandle.style.cursor = "grab";
		}
	});
	document.addEventListener("pointercancel", (e) => {
		if (dragState && dragState.pointerId === e.pointerId) {
			dragState = null;
			dragHandle.style.cursor = "grab";
		}
	});
}
