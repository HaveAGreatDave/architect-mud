// What the minimap remembers about tiles it has already been sent.
//
// WHY THIS EXISTS. The server window is about 80 nodes (a depth-8 BFS plus a
// radius-4 sweep, world.js getMinimapData) and the canvas draws a 5×5–9×9 slice of
// it. That was fine while a move was a hard swap, but a camera that GLIDES needs
// tiles it isn't yet centred on: for the ~300ms of an eased step the leading edge
// of the viewport is showing map the payload's window doesn't cover. Without a
// memory the camera slides into blank cells and the whole effect reads as broken.
//
// So: every node that arrives with real grid coords is kept, keyed by its absolute
// position. Absolute is the load-bearing word — the payload's coords are relative
// to wherever you were standing when it was built, so re-basing them to the map's
// own grid is what makes two payloads agree about the same tile.
//
// A cached tile is NOT a live tile, and the renderer must not treat it as one. See
// `remembered` at the call site: no player counts, no reachability styling, no
// beacon — those are things you can only know by being there now.

const MAX = 6000;   // ≈2.4MB of node objects; the whole city grid is ~5,400 tiles
const EVICT = 1000; // evict in batches so the sort cost is amortised

const store = new Map(); // `${mapId}:${x}:${y}:${z}` → { node, x, y, z, mapId, seen }
let clock = 0;           // monotonic counter — cheaper than Date.now, and restart-proof
let activeMap = null;

const keyOf = (mapId, x, y, z) => `${mapId}:${x}:${y}:${z || 0}`;

/**
 * Record everything in a payload that has a place on a map.
 *
 * Nodes with no grid coords (interior rooms laid out by the exit-graph BFS) are
 * skipped: their coordinates are re-derived from where you're standing and shift
 * every step, so there is no stable key to file them under. Those maps run
 * uncached — which costs nothing, because an interior is a handful of rooms and
 * is always fully inside the window anyway.
 */
export function ingest(nodes, current) {
	if (!current?.map_id || current.grid_x == null) return;
	activeMap = current.map_id;
	const stamp = ++clock;
	for (const n of nodes) {
		if (n.map_id !== current.map_id || n.grid_x == null || n.grid_y == null) continue;
		const k = keyOf(n.map_id, n.grid_x, n.grid_y, n.grid_z);
		const hit = store.get(k);
		if (hit) { hit.node = n; hit.seen = stamp; continue; }
		store.set(k, { node: n, mapId: n.map_id, x: n.grid_x, y: n.grid_y, z: n.grid_z || 0, seen: stamp });
	}
	if (store.size > MAX) evict();
}

// Oldest-first, but everything off the map you're standing on goes before anything
// on it — walking a long road should never cost you the street you're on.
function evict() {
	const all = [...store.entries()];
	all.sort((a, b) => {
		const aOff = a[1].mapId !== activeMap, bOff = b[1].mapId !== activeMap;
		if (aOff !== bOff) return aOff ? -1 : 1;
		return a[1].seen - b[1].seen;
	});
	for (let i = 0; i < EVICT && i < all.length; i++) store.delete(all[i][0]);
}

/** The remembered node at an absolute map coord, or null. */
export function lookup(mapId, x, y, z) {
	const hit = store.get(keyOf(mapId, x, y, z));
	if (!hit) return null;
	hit.seen = ++clock;
	return hit.node;
}

/** Wipe everything. For a disconnect, or a content reload that could have moved tiles. */
export function clearAll() { store.clear(); activeMap = null; }

/** Diagnostics — used by the regress/dev surface, not by the renderer. */
export function cacheSize() { return store.size; }
