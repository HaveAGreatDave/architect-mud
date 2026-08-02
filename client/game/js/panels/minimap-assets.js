// Minimap canvas assets: the terrain textures and the tinted zone-icon footprints.
//
// The DOM minimap gets both of these from CSS — a `background-image` data URI for
// terrain, and a `-webkit-mask` filled with `currentColor` for the icon. Canvas has
// neither, so this module reproduces them: the textures as Images, the icons as
// per-colour tinted offscreen canvases.
//
// Nothing here ever blocks a paint. An asset that isn't decoded yet reports itself
// missing, the renderer draws the tile without it (ground and terrain fill are
// already correct, so the tile looks finished — just bare), and the ready callback
// marks the surfaces dirty so the next frame picks it up. That's the whole
// no-flash story: never wait, always repaint.

// ── Ready notification ───────────────────────────────────────────────────────
// Coalesced to one call per frame. A first render of a fresh district kicks off
// ~20 icon loads that resolve within a few ms of each other; without this the
// surface buffers would rebuild 20 times for one visual result.
const _readyListeners = [];
let _readyQueued = false;
export function onAssetReady(fn) { if (typeof fn === 'function') _readyListeners.push(fn); }
function notifyReady() {
  if (_readyQueued) return;
  _readyQueued = true;
  requestAnimationFrame(() => {
    _readyQueued = false;
    for (const fn of _readyListeners) { try { fn(); } catch {} }
  });
}

// ── Terrain textures ─────────────────────────────────────────────────────────
// There are none. Every terrain is a flat authored fill — water is its blue, grass
// is its green, and that's the whole ground.
//
// Seven of them (water, grass, dock, scrub, redrock, ash, marsh) used to lay a
// stretched SVG overlay on the fill, and this file carried byte-copies of the data
// URIs in styles.css so the canvas could reproduce what the DOM got from `.mm-*`.
// Two copies of an art asset that had to be retuned in lockstep, for lines the
// Studio never drew and the map didn't need. Both copies are deleted.
//
// If a terrain ever earns a texture again it goes in BOTH renderers or neither.

// ── Zone icons ───────────────────────────────────────────────────────────────
// ~70 SVGs under /assets/zone-icons/. In the DOM they're a mask filled with the
// tile's `currentColor`; here we bake that tint by compositing `source-in` over the
// decoded SVG. Cached per (name, colour) — colours come from the derived palette's
// `spec.text`, so the pair count stays in the low hundreds no matter how far you walk.
const ICON_PX = 48;          // source resolution; scaled down at draw time
const ICON_MAX = 400;        // tinted-canvas cap, far above the real working set
const _icons = new Map();    // `${name}|${color}` → canvas
const _iconSrc = new Map();  // name → Image (one load per name, many tints)
const _iconFailed = new Set();

// Shared with minimap.js's iconSvg — both paths must reject the same names before
// building a URL out of authored content.
const ICON_NAME_RE = /^[a-z0-9_-]+$/i;

function loadIconSrc(name) {
	let img = _iconSrc.get(name);
	if (img) return img;
	img = new Image();
	img.addEventListener('load', notifyReady, { once: true });
	img.addEventListener('error', () => { _iconFailed.add(name); }, { once: true });
	img.src = `/assets/zone-icons/${name}.svg`; // same-origin: the canvas stays untainted
	_iconSrc.set(name, img);
	return img;
}

/**
 * A tinted footprint canvas for `spec.feature`, or null while it's still loading
 * (or if the name is bad / the file is missing). Callers draw nothing on null and
 * repaint when onAssetReady fires — they must NOT wait on it.
 */
export function iconFor(name, color) {
	if (!name || !ICON_NAME_RE.test(name) || _iconFailed.has(name)) return null;
	const ink = color || '#e8e8e8';
	const key = `${name}|${ink}`;
	const hit = _icons.get(key);
	if (hit) return hit;

	const img = loadIconSrc(name);
	if (!img.complete || !img.naturalWidth) return null;

	// An SVG with no intrinsic size decodes with naturalWidth 0 in some engines;
	// the guard above already caught that, so by here we have real pixels.
	const cv = document.createElement('canvas');
	cv.width = cv.height = ICON_PX;
	const c = cv.getContext('2d');
	c.drawImage(img, 0, 0, ICON_PX, ICON_PX);
	c.globalCompositeOperation = 'source-in'; // keep the glyph's alpha, replace its ink
	c.fillStyle = ink;
	c.fillRect(0, 0, ICON_PX, ICON_PX);

	if (_icons.size >= ICON_MAX) _icons.clear(); // crude, and correct: they rebuild in a frame
	_icons.set(key, cv);
	return cv;
}

/** Warm the loads for everything in a payload, so a district arrives in one wave. */
export function preloadIcons(nodes) {
	for (const n of nodes || []) {
		const f = n?.spec?.feature;
		if (f && ICON_NAME_RE.test(f) && !_iconSrc.has(f)) loadIconSrc(f);
	}
}

// ── Fonts ────────────────────────────────────────────────────────────────────
// Canvas can't resolve `var(--font-mono)`, so read the computed value once. If the
// webfont hasn't settled the first paint lands in the fallback face — hence the
// fonts.ready repaint.
let _fontFamily = null;
export function monoFamily() {
	if (_fontFamily) return _fontFamily;
	const v = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
	_fontFamily = v || 'monospace';
	return _fontFamily;
}
try { document.fonts?.ready?.then(() => { _fontFamily = null; notifyReady(); }); } catch {}

// ── Theme colours ────────────────────────────────────────────────────────────
// Same idea as wireframe-plane.js's themeColor, with a cache: the minimap reads
// --accent and --bg on every frame, and getComputedStyle is a forced style flush.
const _theme = new Map();
export function themeColor(name, fallback) {
	if (_theme.has(name)) return _theme.get(name);
	let v = '';
	try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch {}
	const out = v || fallback;
	_theme.set(name, out);
	return out;
}
/** Drop the cache after a theme switch (main.js's theme applier calls this). */
export function clearThemeCache() { _theme.clear(); notifyReady(); }
