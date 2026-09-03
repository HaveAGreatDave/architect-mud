// The canvas minimap: same tiles as the DOM renderer, drawn once into a buffer and
// blitted under a camera that can sit between tiles.
//
// WHY. The DOM path rebuilds up to 243 spans (81 cells × three grids) on every step
// and then starts a 180ms transform on top of the resulting layout/paint spike,
// which is why a move reads as a pop. Here the tile work happens only when the tiles
// CHANGE; a frame is a blit, a polyline and a beacon. That buys the thing this was
// actually for: a fractional camera. The marker stays pinned at the centre and the
// world eases underneath it over the real step cadence, so a run is continuous
// motion instead of a sequence of jumps.
//
// THE BUFFER IS THE WHOLE DESIGN. Three surfaces at three tile sizes share buffers
// keyed by device tile size, and each buffer holds MARGIN tiles more than it shows —
// that margin is what the camera glides across. Rebuild a buffer per frame and this
// file is slower than the DOM it replaced.
//
// It imports from minimap.js, which imports it back. That cycle is safe because
// nothing here reads a minimap.js binding at module-evaluation time — only inside
// functions, long after both modules have finished evaluating. Keep it that way.

import { lookup as cacheLookup, ingest as cacheIngest } from './minimap-cache.js';
import { iconFor, preloadIcons, monoFamily, themeColor, onAssetReady } from './minimap-assets.js';
import {
	zoomRadius, glyphPlan, titleFor, hexToRgb,
	isWorldWaterVoid, WATER_VOID_FILL, effectiveTracePath, mapOverlayMode, sendGo,
	updateZoomButtons,
} from './minimap.js';

const MARGIN = 2;     // buffer tiles beyond the viewport, on every side
const ICON_FRAC = 0.82; // matches .mm-icon { width: 82% }

const SURFACES = [
	{ id: 'minimap-grid', base: 1.7 },
	{ id: 'minimap-grid-hud', base: 1.4 },
	{ id: 'minimap-grid-mob', base: 1.75 },
];

// The danger tints from styles.css (.mm-room.danger-*). They apply ONLY to a tile
// with no derived colour of its own — that's what `.mm-styled { background: none }`
// means over there, and getting it wrong paints a grey road green.
const DANGER = {
	safe: ['rgba(35,100,55,0.4)', 'rgba(80,180,100,0.45)'],
	low: ['rgba(115,100,20,0.4)', 'rgba(210,190,60,0.45)'],
	medium: ['rgba(125,75,20,0.45)', 'rgba(220,140,50,0.5)'],
	high: ['rgba(115,30,30,0.45)', 'rgba(200,60,60,0.5)'],
	lethal: ['rgba(115,30,30,0.45)', 'rgba(200,60,60,0.5)'],
};

let views = null;              // the three surfaces, once wired
let raf = 0;
let lastFrame = 0;

// Everything about what to draw. Rebuilt on each payload; read by the frame loop.
const scene = {
	nodes: [],
	byCoord: new Map(),          // `x:y` (space coords) → node, live payload only
	liveIds: new Set(),
	space: null,                 // { mapId, virtual }
	R: 4,
	overlay: 'labels',
	tracePath: [],
	worldMap: false,
	dirty: true,
};

// Camera in fractional space-tile coords. `from`/`to` are whole tiles; `x`/`y` is
// wherever the ease currently is, and a retarget starts from THERE, not from `to` —
// restarting from the previous target snaps backward on every step of a run, which
// is precisely the stutter this file exists to remove.
const cam = { x: 0, y: 0, fromX: 0, fromY: 0, toX: 0, toY: 0, t0: 0, dur: 0 };
let cadence = 300;             // EMA of the observed step interval
let lastPayloadAt = 0;
let motionOff = false;
const fx = { kind: null, t0: 0, dur: 0 }; // z-change / portal flourish

let filterOk = null;
function supportsFilter(ctx) {
	if (filterOk === null) {
		try { ctx.filter = 'grayscale(1)'; filterOk = ctx.filter !== 'none'; ctx.filter = 'none'; }
		catch { filterOk = false; }
	}
	return filterOk;
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function ensureViews() {
	if (views) return views;
	views = [];
	for (const { id, base } of SURFACES) {
		const container = document.getElementById(id);
		if (!container) continue;
		const canvas = document.createElement('canvas');
		canvas.className = 'mm-canvas';
		const view = { id, base, container, canvas, ctx: canvas.getContext('2d'), tilePx: 0, dpr: 0, n: 0 };
		wireInput(view);
		views.push(view);
	}
	onAssetReady(() => { scene.dirty = true; });
	document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); else stop(); });
	return views;
}

// The canvas lives INSIDE the existing grid div rather than replacing it, so the
// esp-active filter, the delegated dblclick and the crossing/message renderers all
// keep working on the container exactly as before.
function mount(view) {
	if (view.canvas.parentNode !== view.container) {
		view.container.classList.add('mm-canvas-mode');
		view.container.innerHTML = '';
		view.container.appendChild(view.canvas);
	}
	view.canvas.style.display = '';
}

export function hideCanvas() {
	for (const view of views || []) {
		view.container.classList.remove('mm-canvas-mode');
		if (view.canvas.parentNode === view.container) view.canvas.remove();
	}
	stop();
}

// clientWidth rather than offsetParent: the HUD minimap sits inside a fixed-position
// overlay, and offsetParent is null for those whether they're on screen or not.
const visible = (view) => view.container.clientWidth > 0;

// ── Sizing ───────────────────────────────────────────────────────────────────
// The DOM path expresses tile size as `--mm-room: <base × 9/n>em` against each
// grid's own font-size; we resolve that to pixels once per layout change and keep
// the backing store honest per helm-mode.js's guard.
// THE DEVICE TILE SIZE IS CHOSEN FIRST, and everything else derives from it. That
// ordering is the whole point: the buffer's pixel grid and the canvas's pixel grid
// have to be the SAME grid, or the blit is a fractional resize of the entire map and
// every glyph on it goes soft.
//
// It used to round the CSS size instead, which made the two disagree in 8 of the 9
// surface × zoom combinations — the HUD blitted 99 device px into 101, mobile 171
// into 173, the sidebar 154 into 153 at one zoom and 155 into 153 at the next. Only
// the sidebar at default zoom happened to land exact, which is why it looked fine
// until you zoomed or opened it on a phone.
//
// The cost is that the footprint now varies by a pixel or two across zoom levels
// instead of being pinned. That was never the promise — "roughly the same footprint"
// is, and ±2px keeps it.
function sizeView(view, n) {
	let fontPx = 10;
	try { fontPx = parseFloat(getComputedStyle(view.container).fontSize) || 10; } catch {}
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	const tileDev = Math.max(2, Math.round(view.base * (9 / n) * fontPx * dpr));
	const backing = tileDev * n;

	view.tileDev = tileDev;
	view.tilePx = tileDev / dpr;
	view.cssSize = backing / dpr;
	view.dpr = dpr;
	view.n = n;
	if (view.canvas.width !== backing || view.canvas.height !== backing) {
		view.canvas.width = view.canvas.height = backing;
	}
	view.canvas.style.width = view.canvas.style.height = view.cssSize + 'px';
	view.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ── Surface buffers ──────────────────────────────────────────────────────────
// Keyed by device tile size, so two surfaces that happen to resolve to the same
// pixel grid share one. Each holds (n + 2·MARGIN)² tiles centred on the camera
// TARGET — the margin is the room the ease travels through.
const buffers = new Map();

function bufferFor(view) {
	const tileDev = view.tileDev; // chosen in sizeView; must not be re-derived here
	const span = view.n + 2 * MARGIN;
	const key = `${tileDev}:${span}`;
	let buf = buffers.get(key);
	if (!buf) {
		const cv = document.createElement('canvas');
		cv.width = cv.height = tileDev * span;
		buf = { cv, ctx: cv.getContext('2d'), tileDev, span, stamp: -1 };
		buffers.set(key, buf);
	}
	return buf;
}

function rebuildBuffers() {
	if (buffers.size > 6) buffers.clear(); // zoom churn; they rebuild in one frame
	for (const view of views) {
		if (!visible(view)) continue;
		const buf = bufferFor(view);
		if (buf.stamp === scene.stamp) continue; // another surface already drew this size
		drawSurface(buf);
		buf.stamp = scene.stamp;
	}
}

// ── Tile drawing ─────────────────────────────────────────────────────────────

function nodeAt(x, y) {
	const live = scene.byCoord.get(`${x}:${y}`);
	if (live) return { node: live, remembered: false };
	if (scene.space.virtual) return null;
	const n = cacheLookup(scene.space.mapId, x, y, scene.space.z);
	return n ? { node: n, remembered: true } : null;
}

function drawSurface(buf) {
	const { ctx, tileDev: t, span } = buf;
	const ox = cam.toX - Math.floor(span / 2);
	const oy = cam.toY - Math.floor(span / 2);
	buf.ox = ox; buf.oy = oy;

	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, buf.cv.width, buf.cv.height);

	const cells = [];
	for (let r = 0; r < span; r++) {
		for (let c = 0; c < span; c++) {
			const ax = ox + c, ay = oy + r;
			const hit = nodeAt(ax, ay);
			if (!hit) {
				// Coldwater Bay: the overworld has genuinely empty cells where the water
				// is, tinted rather than authored as zones.
				if (scene.worldMap && isWorldWaterVoid('map_world', ax, ay)) {
					ctx.fillStyle = WATER_VOID_FILL;
					ctx.fillRect(c * t, r * t, t, t);
				}
				continue;
			}
			drawTile(ctx, hit.node, c * t, r * t, t, hit.remembered);
			cells.push([hit.node, c * t, r * t]);
		}
	}
	// Doors last, as their own pass: an edge sits ON the boundary between two tiles,
	// so drawing it inline would let the next tile's fill paint over half of it.
	for (const [node, px, py] of cells) drawEdges(ctx, node, px, py, t);
	drawRoute(ctx, buf);
}

function drawTile(ctx, node, px, py, t, remembered) {
	ctx.save();
	if (node.reachable === false && supportsFilter(ctx)) ctx.filter = 'grayscale(0.55) opacity(0.3)';
	else if (node.reachable === false) ctx.globalAlpha = 0.3;
	if (remembered) ctx.globalAlpha *= 0.55;

	const fill = node.spec?.fill || null;
	const ink = node.spec?.text || null;

	// 1. Ground — a flat authored colour, and that's all it ever is. Terrain used to
	// lay a stretched texture over this; see minimap-assets.js for why it doesn't.
	if (fill) {
		ctx.fillStyle = fill;
		ctx.fillRect(px, py, t, t);
	} else if (node.district?.color) {
		const [r, g, b] = hexToRgb(node.district.color);
		ctx.fillStyle = `rgba(${r},${g},${b},0.20)`;
		ctx.fillRect(px, py, t, t);
	} else if (!ink) {
		// Nothing derived ever coloured this tile, so danger is all it has to say.
		const [bg, border] = DANGER[node.enterable ? 'safe' : (node.danger || 'safe')] || DANGER.safe;
		ctx.fillStyle = bg;
		ctx.fillRect(px, py, t, t);
		ctx.strokeStyle = border;
		ctx.lineWidth = 1;
		ctx.strokeRect(px + 0.5, py + 0.5, t - 1, t - 1);
	}

	// 2. Glyph layer — the same three-way decision symFor() makes for the DOM.
	drawGlyph(ctx, node, px, py, t, ink);

	// 3. Perimeter wall — one band per outward face, ON the tile's own edge, so a run
	//    of tiles draws one continuous line and a corner draws an L. Same faces the DOM
	//    path reads (spec.curtain), same fractions for the gate's gap, so the two
	//    renderers agree tile for tile. The gate's CSS pulse is dropped: it is one tile
	//    on the whole map and not worth a per-frame pass.
	//    No faces derived ⇒ the ring this used to draw, rather than nothing at all.
	const cwFaces = node.spec?.curtain || '';
	if (cwFaces) curtainFaces(ctx, px, py, t, cwFaces, !!node.perimeter_gate);
	else if (node.perimeter_gate) inset(ctx, px, py, t, '#7fe0ff', 1);
	else if (node.curtain) inset(ctx, px, py, t, 'rgba(122,196,255,0.42)', 1);
	else if (node.glacis) inset(ctx, px, py, t, 'rgba(224,120,90,0.45)', 1);

	// 4. Enterable buildings are doors, not rooms — outlined, and clickable (hitTest).
	if (node.enterable) {
		ctx.globalAlpha *= 0.9;
		// Red when a law is holding it shut (shop hours) — same rule, same colour and
		// same source flag as the DOM path's .mm-shut, so the two surfaces agree.
		inset(ctx, px, py, t, node.shut ? themeColor('--red', '#d65a5a') : themeColor('--accent', '#59c2d6'), 1);
	}
	ctx.restore();
}

function inset(ctx, px, py, t, color, w) {
	ctx.strokeStyle = color;
	ctx.lineWidth = w;
	ctx.strokeRect(px + w / 2, py + w / 2, t - w, t - w);
}

// The Curtain's outward faces, as filled bands hugging the tile edges they name.
// Whole device pixels for the same reason the glyphs are: a 2px band on a half pixel
// is antialiased into a 3px smear, and across a 37-tile run that reads as a fuzzy
// smudge rather than as a wall.
//
// A gate is the same wall with a hole in it — two stubs at the SAME fractions the DOM
// gradient uses (styles.css .mm-cw-gate), because the one thing worse than a gap in
// the wrong place is two screens disagreeing about where the door is.
function curtainFaces(ctx, px, py, t, faces, gate) {
	const w = Math.max(1, Math.round(t / 12));
	ctx.fillStyle = gate ? '#aef0ff' : 'rgba(122,196,255,0.85)';
	const spans = gate ? [[0, 0.32], [0.68, 1]] : [[0, 1]];
	for (const d of faces) {
		for (const [a, b] of spans) {
			const off = Math.round(a * t), len = Math.round(b * t) - off;
			if (d === 'n') ctx.fillRect(px + off, py, len, w);
			else if (d === 's') ctx.fillRect(px + off, py + t - w, len, w);
			else if (d === 'w') ctx.fillRect(px, py + off, w, len);
			else if (d === 'e') ctx.fillRect(px + t - w, py + off, w, len);
		}
	}
}

// Text is drawn at WHOLE DEVICE PIXELS (this ctx is untransformed, so `t` is already
// device px). A glyph origin on a half pixel is antialiased across two columns, and
// at a 12px label that reads as blur rather than as position.
function drawGlyph(ctx, node, px, py, t, ink) {
	const plan = glyphPlan(node, scene.overlay);
	const cx = Math.round(px + t / 2), cy = Math.round(py + t / 2);

	if (plan.icon) {
		const img = iconFor(plan.icon, ink || themeColor('--text', '#d8d8d8'));
		if (img) {
			const s = Math.round(t * ICON_FRAC);
			ctx.drawImage(img, cx - (s >> 1), cy - (s >> 1), s, s);
		}
	} else if (plan.fallback) {
		ctx.fillStyle = ink || themeColor('--text', '#d8d8d8');
		ctx.font = `bold ${Math.round(t * 0.55)}px ${monoFamily()}`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(plan.fallback, cx, cy);
	}

	// An authored marker rides OVER the footprint and survives every overlay mode —
	// it's the tile's own drawing, not an annotation. Muted, in the tile's own ink.
	if (plan.mark) {
		ctx.save();
		ctx.globalAlpha *= 0.75;
		ctx.fillStyle = ink || themeColor('--text', '#d8d8d8');
		ctx.font = `${Math.round(t * 0.6)}px ${monoFamily()}`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(plan.mark, cx, cy);
		ctx.restore();
	}

	// Labels mode: white with a black outline, replacing the graphic.
	//
	// THE STROKE IS A HAIRLINE, NOT A HALO. `-webkit-text-stroke-width` is centred on
	// the outline exactly as canvas's lineWidth is, and `paint-order: stroke fill` is
	// exactly strokeText-then-fillText — so the two are equivalent at the SAME width.
	// This used to double it and floor it at 1px, on the mistaken belief that the CSS
	// stroke sat outside the glyph. That put a 2px black stroke on a 12px letterform,
	// 3.4× what the CSS asks for; it closed up the counters and read as blur.
	if (plan.label) {
		const size = Math.max(8, Math.round(t * 0.7));
		// Fractional letter spacing puts every glyph after the first on a subpixel
		// origin, which undoes the rounding above. Whole pixels or nothing.
		const spacing = Math.round(t * -0.03);
		ctx.save();
		ctx.font = `800 ${size}px ${monoFamily()}`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		try { ctx.letterSpacing = `${spacing}px`; } catch {}
		ctx.lineJoin = 'round';
		ctx.miterLimit = 2;
		ctx.lineWidth = t * 0.035;
		ctx.strokeStyle = '#000';
		ctx.strokeText(plan.label, cx, cy);
		ctx.fillStyle = '#fff';
		ctx.fillText(plan.label, cx, cy);
		ctx.restore();
	}
}

// Green where the room opens through, red where it's wall. `open_dirs` is the
// authority and is null outside a floorplan, so a street facade draws only the one
// green line on its door edge — the red half would just outline every building.
//
// A side a lock is holding shut (`locked_dirs`, always a subset of the open ones)
// takes that same red at full strength. A wall and a locked door both mean no way
// through, so they share the colour; the alpha is what separates them.
const EDGE_OPEN = '#3fd07a', EDGE_SHUT = '#d0453f';
const CARDINALS = ['north', 'south', 'east', 'west'];
function drawEdges(ctx, node, px, py, t) {
	const open = Array.isArray(node.open_dirs) ? node.open_dirs : null;
	const locked = Array.isArray(node.locked_dirs) ? node.locked_dirs : null;
	const dirs = open ? CARDINALS : (CARDINALS.includes(node.entrance) ? [node.entrance] : []);
	if (!dirs.length) return;
	const w = Math.max(1, Math.round(t * 0.12));
	const pad = t * 0.2, len = t - pad * 2;
	ctx.save();
	for (const d of dirs) {
		const isLocked = !!locked?.includes(d);
		const isOpen = !isLocked && (open ? open.includes(d) : true);
		ctx.fillStyle = isOpen ? EDGE_OPEN : EDGE_SHUT;
		ctx.globalAlpha = isOpen || isLocked ? 1 : 0.55;
		if (d === 'north') ctx.fillRect(px + pad, py, len, w);
		else if (d === 'south') ctx.fillRect(px + pad, py + t - w, len, w);
		else if (d === 'west') ctx.fillRect(px, py + pad, w, len);
		else ctx.fillRect(px + t - w, py + pad, w, len);
	}
	ctx.restore();
}

// The plotted GPS route, as an accent line through tile centres. Drawn into the
// buffer (map space) so it travels with the camera for free.
function drawRoute(ctx, buf) {
	if (scene.tracePath.length < 2) return;
	const { tileDev: t, ox, oy, span } = buf;
	const pts = [];
	for (const id of scene.tracePath) {
		const co = scene.coordOf.get(id);
		if (!co) continue;
		const c = co[0] - ox, r = co[1] - oy;
		if (c < 0 || r < 0 || c >= span || r >= span) continue;
		pts.push([(c + 0.5) * t, (r + 0.5) * t]);
	}
	if (pts.length < 2) return;
	ctx.save();
	ctx.strokeStyle = themeColor('--accent', '#59c2d6');
	ctx.lineWidth = Math.max(1, t * 0.18);
	ctx.lineJoin = ctx.lineCap = 'round';
	ctx.globalAlpha = 0.85;
	ctx.beginPath();
	ctx.moveTo(pts[0][0], pts[0][1]);
	for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
	ctx.stroke();
	ctx.restore();
}

// ── Blit + beacon ────────────────────────────────────────────────────────────

function blit(view, now) {
	const { ctx, n, tilePx, dpr } = view;
	const buf = bufferFor(view);
	const size = view.cssSize;

	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, size, size);

	// A transient scale/fade for a floor change or a doorway — the one bit of the
	// old slideMinimap worth keeping, since those moves have no direction to glide in.
	let alpha = 1, scale = 1;
	if (fx.kind) {
		const k = Math.min(1, (now - fx.t0) / fx.dur);
		if (k >= 1) fx.kind = null;
		else {
			alpha = k;
			if (fx.kind !== 'portal') scale = fx.scale + (1 - fx.scale) * k;
		}
	}
	ctx.save();
	ctx.globalAlpha = alpha;
	if (scale !== 1) {
		ctx.translate(size / 2, size / 2);
		ctx.scale(scale, scale);
		ctx.translate(-size / 2, -size / 2);
	}

	// Source rect: the viewport's left edge in buffer tiles is (cam − half a window)
	// measured from the buffer origin. Pixel-snapped so a 2px door edge lands on
	// whole device pixels instead of smearing across two.
	const sx = Math.round((cam.x + 0.5 - n / 2 - buf.ox) * buf.tileDev);
	const sy = Math.round((cam.y + 0.5 - n / 2 - buf.oy) * buf.tileDev);
	const sw = n * buf.tileDev;
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(buf.cv, sx, sy, sw, sw, 0, 0, size, size);
	ctx.restore();

	drawBeacon(ctx, size / 2, size / 2, tilePx, now);
}

// "You are here": an accent core plus a locator ring, at the exact canvas centre
// because that is where the camera keeps you. Matches @keyframes you-ping.
function drawBeacon(ctx, cx, cy, tilePx, now) {
	const core = tilePx * 0.36; // 0.72em against a 1.7em tile
	const accent = themeColor('--accent', '#5b9af5');
	ctx.save();
	if (motionOff) {
		ctx.globalAlpha = 0.35;
		ctx.strokeStyle = accent;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(cx, cy, (core / 2) * 1.5, 0, Math.PI * 2);
		ctx.stroke();
	} else {
		const k = (now % 1700) / 1700;
		ctx.globalAlpha = 0.7 * (1 - k);
		ctx.strokeStyle = accent;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(cx, cy, (core / 2) * (0.75 + 1.45 * k), 0, Math.PI * 2);
		ctx.stroke();
	}
	ctx.globalAlpha = 1;
	ctx.shadowColor = accent;
	ctx.shadowBlur = 7;
	ctx.fillStyle = accent;
	ctx.beginPath();
	ctx.arc(cx, cy, core / 2, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

// ── Camera ───────────────────────────────────────────────────────────────────

const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3);

function stepCamera(now) {
	if (cam.dur <= 0) { cam.x = cam.toX; cam.y = cam.toY; return; }
	// Clamped at BOTH ends. A frame timestamp earlier than t0 is rare but possible —
	// rAF reports the frame's start time, not the moment the callback runs — and an
	// unclamped negative k sends the eased position wildly past `from`, which blanks
	// the whole viewport rather than degrading gracefully.
	const k = Math.max(0, Math.min(1, (now - cam.t0) / cam.dur));
	const e = easeOutCubic(k);
	cam.x = cam.fromX + (cam.toX - cam.fromX) * e;
	cam.y = cam.fromY + (cam.toY - cam.fromY) * e;
	if (k >= 1) cam.dur = 0;
}

function retarget(tx, ty, snap, now) {
	if (snap || motionOff) {
		cam.x = cam.fromX = cam.toX = tx;
		cam.y = cam.fromY = cam.toY = ty;
		cam.dur = 0;
		return;
	}
	// From WHERE THE CAMERA IS, not from the last target — see the note on `cam`.
	cam.fromX = cam.x; cam.fromY = cam.y;
	cam.toX = tx; cam.toY = ty;
	cam.t0 = now;
	// Settle just before the next step lands, so the glide is continuous rather than
	// arriving early and waiting. Cadence is measured, not assumed: walking is ~1000ms,
	// running ~480ms, and a player typing directions is neither.
	cam.dur = Math.min(420, Math.max(120, cadence)) * 0.85;
}

// ── Frame loop ───────────────────────────────────────────────────────────────

function frame(now) {
	raf = requestAnimationFrame(frame);
	lastFrame = now;
	stepCamera(now);
	if (scene.dirty) { scene.stamp = (scene.stamp || 0) + 1; rebuildBuffers(); scene.dirty = false; }
	for (const view of views) {
		if (!visible(view)) continue;
		if (!view.n) continue;
		blit(view, now);
	}
}
function start() { if (!raf && views?.length) { lastFrame = performance.now(); raf = requestAnimationFrame(frame); } }
function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

// ── Input ────────────────────────────────────────────────────────────────────

function tileAt(view, clientX, clientY) {
	const rect = view.canvas.getBoundingClientRect();
	if (!rect.width) return null;
	const px = clientX - rect.left, py = clientY - rect.top;
	const n = view.n, size = rect.width, tile = size / n;
	const ax = Math.floor(cam.x + 0.5 + (px - size / 2) / tile);
	const ay = Math.floor(cam.y + 0.5 + (py - size / 2) / tile);
	return nodeAt(ax, ay);
}

function wireInput(view) {
	const cv = view.canvas;
	cv.addEventListener('click', (e) => {
		const hit = tileAt(view, e.clientX, e.clientY);
		if (hit && !hit.remembered && hit.node.enterable && hit.node.building_name) sendGo(hit.node.building_name);
	});
	// dblclick is handled by the delegated listener in minimap.js — the canvas is a
	// child of the grid div it matches on, so it needs nothing here.
	let lastKey = '';
	let throttled = 0;
	cv.addEventListener('mousemove', (e) => {
		const now = performance.now();
		if (now - throttled < 80) return;
		throttled = now;
		const hit = tileAt(view, e.clientX, e.clientY);
		const key = hit ? `${hit.node.id}|${hit.remembered}` : '';
		if (key === lastKey) return;
		lastKey = key;
		// A property assignment, not an attribute — escaping here would show entities.
		cv.title = hit ? (hit.remembered ? `${titleFor(hit.node)}\n(remembered)` : titleFor(hit.node)) : '';
		cv.style.cursor = hit && !hit.remembered && hit.node.enterable ? 'pointer' : '';
	});
	cv.addEventListener('mouseleave', () => { lastKey = ''; cv.title = ''; });
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Draw a payload. `current` is the is_current node; `direction` is the move that
 * produced it (null for a re-render in place, e.g. an overlay or zoom change).
 */
export function renderMinimapCanvas(nodes, current, direction) {
	ensureViews();
	if (!views.length) return false;

	const now = performance.now();
	motionOff = document.documentElement.getAttribute('data-motion') === 'off';

	// Layout. Grid coords when the map has them (the only frame two payloads agree
	// on); otherwise a BFS walk that is re-derived from where you stand, and so
	// cannot be cached or glided across — see minimap-cache.js.
	const byId = new Map(nodes.map(n => [n.id, n]));
	const gridded = !!(current.map_id && current.grid_x != null && current.grid_y != null);
	const coordOf = new Map();
	if (gridded) {
		for (const n of nodes) {
			if (n.map_id === current.map_id && n.grid_z === current.grid_z && n.grid_x != null && n.grid_y != null)
				coordOf.set(n.id, [n.grid_x, n.grid_y]);
		}
	} else {
		const DIR = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
		coordOf.set(current.id, [0, 0]);
		const queue = [current.id], seen = new Set([current.id]);
		while (queue.length) {
			const id = queue.shift();
			const node = byId.get(id);
			const [x, y] = coordOf.get(id);
			if (!node) continue;
			for (const [dir, tid] of Object.entries(node.exits || {})) {
				if (!DIR[dir] || !byId.has(tid) || seen.has(tid)) continue;
				coordOf.set(tid, [x + DIR[dir][0], y + DIR[dir][1]]);
				seen.add(tid);
				queue.push(tid);
			}
		}
	}

	const prev = scene.space;
	const space = { mapId: current.map_id || '?', z: current.grid_z || 0, virtual: !gridded };
	const cx = gridded ? current.grid_x : 0;
	const cy = gridded ? current.grid_y : 0;

	// The zoom level, and nothing else. This used to auto-fit to the content extent
	// measured from the player, which made small interiors rescale on every step.
	const R = zoomRadius();
	const n = 2 * R + 1;

	scene.nodes = nodes;
	scene.space = space;
	scene.R = R;
	scene.overlay = mapOverlayMode();
	scene.coordOf = coordOf;
	scene.worldMap = current.map_id === 'map_world';
	scene.liveIds = new Set(nodes.map(nd => nd.id));
	scene.byCoord = new Map();
	for (const [id, [x, y]] of coordOf) scene.byCoord.set(`${x}:${y}`, byId.get(id));
	scene.tracePath = effectiveTracePath(current.id) || [];
	scene.dirty = true;

	if (gridded) { cacheIngest(nodes, current); preloadIcons(nodes); }

	// Cadence: measure it rather than assume it, but only from real moves — a
	// re-render in place (overlay toggle, route change) says nothing about pace.
	if (direction && lastPayloadAt) {
		const delta = now - lastPayloadAt;
		if (delta > 80 && delta < 3000) cadence = cadence * 0.7 + delta * 0.3;
	}
	if (direction) lastPayloadAt = now;

	for (const view of views) { mount(view); sizeView(view, n); }
	updateZoomButtons(); // the DOM path got this from applyMinimapZoom; we must ask

	// Snap rather than glide whenever the two frames aren't the same continuous
	// space: a different map or floor, a resized window, a teleport, or a layout
	// that shifts under you. Gliding across any of those is a smear, not motion.
	const jumped = Math.max(Math.abs(cx - cam.toX), Math.abs(cy - cam.toY)) > 2;
	const snap = !prev
		|| prev.mapId !== space.mapId || prev.z !== space.z || space.virtual
		|| scene.lastR !== R || !direction || jumped;
	scene.lastR = R;
	retarget(cx, cy, snap, now);

	// Up/down/in/out have no direction to glide along, so they keep the flourish the
	// DOM slide gave them: rising expands, descending contracts, a doorway just fades.
	fx.kind = null;
	if (direction && !motionOff) {
		if (direction === 'up') { fx.kind = 'z'; fx.scale = 1.18; fx.dur = 220; fx.t0 = now; }
		else if (direction === 'down') { fx.kind = 'z'; fx.scale = 0.82; fx.dur = 220; fx.t0 = now; }
		else if (direction === 'in' || direction === 'out') { fx.kind = 'portal'; fx.dur = 200; fx.t0 = now; }
	}

	start();
	return true;
}
