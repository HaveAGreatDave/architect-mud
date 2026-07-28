// The derive module — see docs/proposals/map-pipeline-spec.md §7.
//
// PURE. No DB handle, no fs, no clock, no RNG, no environment reads. Everything
// here is a function of parsed content and nothing else, so the same input always
// produces the same output on every machine and in CI. That is not a style
// preference: the whole point of moving presentation to build time is that a
// derived value cannot vary by database, and the enforcement is that a `query()`
// written into this file has nothing to call.
//
// `resolveDefault` is the primitive every other derivation calls (§7.3 "Build
// this first"). `deriveWorld` is the whole-map pass the build runs, producing the
// `zone_render` rows renderers read INSTEAD of computing anything themselves.
//
// Not here yet: `content/map/index.json` (§2.4).

// ── The bottom rung ──────────────────────────────────────────────────────────
// What a key means when nobody — tile, region or palette — has said anything.
// A key absent from this table resolves to null, which is the honest answer for
// anything optional; a key present here is one where "nothing" is not a legal
// value and the engine would otherwise have to invent one at the point of use.
export const GLOBAL_DEFAULTS = Object.freeze({
  ambient_theme: 'indoors',
  audio_theme_id: null,
});

/**
 * `flags.terrain` is the authored ground-surface SSOT (docs/systems-terrain.md),
 * plus the legacy inferences a world grown before the paint tool still needs.
 * Dual-purpose and authored — NOT one of the absent-by-default override columns.
 *
 * This is `zoneTerrain` from world.js, moved here so the build resolves terrain
 * the same way the engine always has; world.js now delegates to it. A tile that
 * was never painted and can't be inferred returns **null**, and null means "no
 * ground surface" — an interior room, a building footprint. The spec floated a
 * palette-wide `default` to fill that in; applying one would paint 530 interiors
 * and footprints concrete grey, so there is deliberately no default rung.
 */
export function resolveTerrain(zone) {
  const f = zone?.flags || {};
  if (f.terrain) return f.terrain;
  // DEPRECATED fallbacks, kept verbatim so hand-authored legacy content still
  // reads right. Nothing carries flags.water any more (migrated 2026-07-21).
  if (f.water) return 'water';
  if (f.pier) return 'dock';
  if (/^(road_|runway_)/.test(f.icon || '')) return 'road';
  // A building footprint is not ground. (buildingIconSvg's condition: the facade
  // tag present at all, plus a building_type to pick an icon by.)
  if (Object.prototype.hasOwnProperty.call(f, 'facade') && String(f.building_type || '')) return null;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(zone?.bg_color || '');
  if (m) {
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    // Green-dominant surface = parkland/grass. `g - b >= 15` keeps teal docks out.
    if (g > r && g - b >= 15 && g >= 45) return 'grass';
  }
  return null;
}

/**
 * The defaults-and-overrides primitive (spec §1.3).
 *
 *   tile override  →  region `defaults`  →  palette (by terrain)  →  global
 *
 * Most-specific wins, so a region default deliberately SHADOWS the palette: a
 * region saying "this place sounds like neon rain" outranks a terrain saying
 * "wasteland is quiet". Refining below a region means refining the region.
 *
 * Note the one thing this cannot express: with a nullable column there is no
 * way for a tile to say "explicitly nothing, do not inherit" — absent and none
 * are the same bytes. Every rung therefore treats null/undefined as "no opinion".
 * If a tile ever needs to opt out of its region, that is a new sentinel and a
 * deliberate decision, not something to bolt on at a call site.
 *
 * @param {string} key      column name (audio_theme_id, ambient_theme, color, …)
 * @param {object} zone     the tile row / parsed content file
 * @param {object} [region] the zone's region row (regions.defaults holds the slot)
 * @param {object} [palette] parsed content/map/terrain.json — absent until §11 step 3
 */
export function resolveDefault(key, zone, region, palette) {
  const own = zone?.[key];
  if (own !== null && own !== undefined) return own;

  const fromRegion = region?.defaults?.[key];
  if (fromRegion !== null && fromRegion !== undefined) return fromRegion;

  const terrain = resolveTerrain(zone);
  const fromPalette = terrain ? palette?.terrains?.[terrain]?.[key] : undefined;
  if (fromPalette !== null && fromPalette !== undefined) return fromPalette;

  return key in GLOBAL_DEFAULTS ? GLOBAL_DEFAULTS[key] : null;
}

// ── Palette lookups ──────────────────────────────────────────────────────────

export function paletteEntry(zone, palette) {
  const key = resolveTerrain(zone);
  return key ? (palette?.terrains?.[key] ?? null) : null;
}

/**
 * The tile's map colours.
 *
 * `authored_bg_wins` is the legacy exception, and it is a palette FACT rather
 * than an `if (terrain === 'water' || terrain === 'grass')` repeated in three
 * renderers. Everywhere else a tile's `bg_color` is its room colour identity —
 * 2,923 redrock tiles carry a dark interior brown — so treating it as a map
 * override would black out most of the world. See the palette file's note.
 */
export function deriveColors(zone, palette) {
  const entry = paletteEntry(zone, palette);
  const bg = entry
    ? ((entry.authored_bg_wins && zone?.bg_color) ? zone.bg_color : (entry.fill ?? null))
    : (zone?.bg_color ?? null);
  // A terrain that dictates its own glyph colour (road markings) wins over the
  // tile's authored one: the markings ARE the road, not a per-tile decision.
  // Falling all the way through to contrast means `text` is FINAL — a renderer
  // never has to decide anything, which is the whole point of §2.3.
  const color = entry?.text ?? zone?.color ?? contrastText(bg);
  return { color, bg_color: bg };
}

// Readable ink for a given background. Lifted verbatim from the game minimap's
// luminanceTextColor, because there were TWO of these: the dev panel's returns a
// binary #111111/#eeeeee and the game's a continuous grey, so the same tile was
// lettered differently depending on which tool you were looking at it through.
// The game's version wins for the same reason the game's redrock does — players
// are the audience.
export function contrastText(hex) {
  const h = String(hex ?? '').replace('#', '');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return null;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const t = Math.round((1 - lum) * 255);
  return `rgb(${t},${t},${t})`;
}

// ── deriveMarker — four unrelated jobs, separated (§7.4) ─────────────────────
//
// `zones.marker` was doing four jobs at once. After the split it means exactly
// one thing: A HUMAN OVERRODE THIS TILE'S MAP CODE. Everything else is derived.
//
//   building acronym       62 tiles → derived from building_name; authored wins
//   apartment designation  116      → derived from the unit name
//   sewer corridor art     118      → derived from connectivity
//   terrain glyph          846      → STAYS AUTHORED. See below.
//
// The terrain row is the one place §7.4 was wrong about this world, and the
// measurement is worth keeping: painted terrain does NOT carry one glyph per
// terrain. Water is 945 tiles of which 688 are blank and 256 carry `≈`; road is
// 119 tiles wearing six textures (`⁙∴`×46, `▚`×23, `#`×22, `⸪.`×20 …); redrock is
// 2,996 tiles of which 2,995 are blank. These are hand-placed decoration that
// happens to sit on painted ground, not a function of the paint. Deriving them
// from a palette glyph would blank 375 grass tiles or stamp one on 688 empty
// water tiles. So the palette's `glyph` stays null and these stay authored.

// The significant words of a name. The possessive is stripped BEFORE splitting, or
// "Halloran's Fix-It" becomes [Halloran, s, Fix, It] and abbreviates to "HS" not "HF".
const STOP_WORD = /^(the|of|and|at|a|an|&)$/i;

export const sigWords = (name) => String(name || '')
  .replace(/['’]s\b/g, '')
  .replace(/[^A-Za-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter((w) => w && !STOP_WORD.test(w));

// The single suggested acronym: initials of the significant words, or the first two
// letters of a lone word.
export function twoLetterAbbrev(name) {
  const words = sigWords(name);
  if (!words.length) return null;
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase() || null;
  return words.map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

// Every 2-glyph code that reads as DERIVED FROM the name. Deliberately wider than
// twoLetterAbbrev()'s single suggestion, because more than one honest acronym exists —
// any ordered pair of the significant words' initials ("Embassy Hotel & Bar" → EH, EB,
// HB) and the first two letters of any one of those words ("The Stacks" → ST). Still
// narrow enough that a thematic code falls outside it, which is the point: `GN` on the
// gunshop Ironside Arms is a choice, not an acronym.
export function nameDerivedMarkers(name) {
  const words = sigWords(name);
  const out = new Set();
  const ini = words.map((w) => w[0].toUpperCase());
  for (let i = 0; i < ini.length; i++) for (let j = i + 1; j < ini.length; j++) out.add(ini[i] + ini[j]);
  for (const w of words) if (w.length >= 2) out.add(w.slice(0, 2).toUpperCase());
  return out;
}

// Pick a code no other building is already wearing. Tries the suggestion, then the
// other name-derived codes in a stable order, then suffixes the first significant
// word's initial with digits. Deterministic: the same name and the same taken set
// always yield the same code — which is what lets the BUILD assign these, seeing
// every building at once, instead of an author guessing one at a time.
export function uniqueMarkerFor(name, taken) {
  const used = taken instanceof Set ? taken : new Set(taken || []);
  const first = twoLetterAbbrev(name);
  if (first && !used.has(first)) return first;
  for (const cand of [...nameDerivedMarkers(name)].sort()) {
    if (!used.has(cand)) return cand;
  }
  const lead = (sigWords(name)[0] || 'X')[0].toUpperCase();
  for (let i = 2; i <= 9; i++) if (!used.has(lead + i)) return lead + i;
  return first;
}

// Astral-aware length: an emoji marker is one glyph, not two code units.
const glyphLen = (s) => [...String(s ?? '')].length;

// The floor designation carried in an apartment's own name ("Unit 2A", "Unit 1001",
// "Halcyon Residence 41-A"). Keep the whole designation when it fits the 2-glyph
// column; otherwise drop to the FLOOR, so the units on one floor share a marker —
// which is what the authored Halcyon stack already does (41-A..E all carry "41").
export function floorDesignation(name) {
  const m = /(?:unit|apt|apartment|residence|room|suite)\s+([A-Za-z0-9][A-Za-z0-9-]*)\s*$/i.exec(String(name || '').trim());
  if (!m) return null;
  const desig = m[1].toUpperCase();
  if (glyphLen(desig) <= 2) return desig;
  const head = desig.split('-')[0];
  if (glyphLen(head) <= 2) return head;
  return /^\d+$/.test(head) ? head.slice(0, -2) : head.slice(0, 2);
}

// Sewer corridor art, from the tile's own connectivity. Lifted from
// scripts/content/build-sewer-grid.mjs, which already re-derived these from FINAL
// connectivity rather than trusting what it had stamped earlier — the same
// conclusion this module exists to generalise.
const SEWER_ART = {
  N: '╨', S: '╥', E: '╞', W: '╡',
  NS: '║', EW: '═', NE: '╚', NW: '╝', SE: '╔', SW: '╗',
  NSE: '╠', NSW: '╣', NEW: '╩', SEW: '╦', NSEW: '╬',
};
const DIR_LETTER = { N: 'north', S: 'south', E: 'east', W: 'west' };
export function sewerArt(exits) {
  const dirs = new Set(Object.keys(exits || {}));
  const key = ['N', 'S', 'E', 'W'].filter((c) => dirs.has(DIR_LETTER[c])).join('');
  return key ? (SEWER_ART[key] ?? '╬') : null;
}

// A BUILDING for marker purposes is a tile on the overworld a player navigates BY
// — the thing whose code appears in Labels mode. `is_building` also sits on 90
// interior rooms (Echelon cabins, aircraft interiors, the Ascendant campus), and
// giving those an acronym would put a building code on a room nobody navigates to
// by code, which is precisely what MARK-1 exists to complain about.
const isBuildingTile = (z) => (z?.map_id === 'map_world') && !!(z?.flags?.facade || z?.flags?.is_building);
const isSewerTile = (z) => (z?.grid_z ?? 0) < 0 && /^zone_under_/.test(z?.id || '');
const authoredMarker = (z) => (z?.marker == null ? '' : String(z.marker).trim());

/**
 * The glyph this tile draws. `ctx.buildingMarkers` is the whole-map assignment
 * deriveWorld computed in one pass — a building's code can only be unique if
 * something sees every building at once, which is what a build is and an author
 * is not.
 */
export function deriveMarker(zone, palette, ctx = {}) {
  const authored = authoredMarker(zone);
  if (authored) return authored;                                  // a human overrode it
  if (isBuildingTile(zone)) return ctx.buildingMarkers?.get(zone.id) ?? null;
  if (zone?.flags?.is_apartment) return floorDesignation(zone.name);
  if (isSewerTile(zone)) return sewerArt(zone.exits);
  return paletteEntry(zone, palette)?.glyph ?? null;              // null everywhere; see the note above
}

/**
 * Assign a code to every building that didn't author one. Two passes over an
 * id-sorted list: authored codes are reserved first (a human's choice outranks a
 * generated one whatever order the rows arrive in), then the gaps are filled.
 * Returns { markers, collisions } — collisions are AUTHORED duplicates, which
 * derive cannot resolve and must not silently paper over.
 */
export function assignBuildingMarkers(zones) {
  const buildings = zones.filter(isBuildingTile)
    .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const taken = new Set();
  const collisions = [];
  const byCode = new Map();
  for (const z of buildings) {
    const authored = authoredMarker(z);
    if (!authored) continue;
    if (taken.has(authored)) collisions.push({ id: z.id, marker: authored, with: byCode.get(authored) });
    else { taken.add(authored); byCode.set(authored, z.id); }
  }
  const markers = new Map();
  for (const z of buildings) {
    const authored = authoredMarker(z);
    if (authored) { markers.set(z.id, authored); continue; }
    const code = uniqueMarkerFor(z.flags?.building_name || z.name, taken);
    if (code) taken.add(code);
    markers.set(z.id, code ?? null);
  }
  return { markers, collisions };
}

// ── projectEdges — the traversal graph (§7.5) ────────────────────────────────
//
// Geometry says where tiles TOUCH. It does not say where a player can WALK, and
// this world is emphatic about the difference: 21,203 authored exits against
// 21,478 cardinal adjacencies. The gap is not noise — it is 660 directed walls,
// and the whole design of this function is the search for which of them are a
// RULE and which are a DECISION.
//
// Measured over the shipped world, three rules and 271 files reproduce every one
// of the 21,203 edges exactly:
//
//   grid            21,478 raw cardinal adjacencies on the same map
//   − facade rule      280  a facade opens at flags.entrance and nowhere else
//   − wilds curtain    268  the city↔wilds boundary, a code-enforced invariant
//   = 20,930 projected, of which 114 are wrong and 387 are missing
//   + 271 connection files (214 links geometry cannot say, 57 walls it cannot
//     un-say) → exact agreement with zones.exits
//
// Two things this refuses to do, both measured rather than assumed:
//
//   VERTICAL IS NOT PROJECTED. Stacking grid_z and emitting up/down looks free
//   and costs 214 more files: 306 apartment floors would gain a hole in the
//   ceiling, and every bunker would open into the utility room beneath it. You
//   cannot walk up through a floor, and the grid has no opinion about stairs.
//
//   TERRAIN IS NOT CONSULTED. §7.5 supposes the palette decides walkability, but
//   the same terrain pair is passable in thousands of places and walled in a
//   handful: 56 of the walls are redrock↔grass, 28 are sand↔sand. Those are hand
//   drawn, so they are files. A terrain-based passability rule would have been a
//   rule that is wrong about the world it describes.

// ── A map's name ─────────────────────────────────────────────────────────────
/**
 * An interior map's name follows the building it hangs off, because they are the
 * same thing named twice and a rename that reaches only one of them is the bug
 * this replaces. 17 of 69 interior maps had already drifted that way: the map
 * still filed under the block it was drawn in ("Cathode Row", "Battery Square")
 * while the facade had long since become The Cherry Pit and Ration Nine.
 *
 * `maps.name` is an absent-by-default OVERRIDE (registry omitWhenNull), so an
 * authored value always wins — that is how the parentless maps keep the names
 * nothing can derive for them (map_world, Dreamzones, the Leviathan cabin), and
 * how any building whose derived name reads badly buys its way out.
 *
 * Nothing player-facing reads this: `maps.name` reaches the dev panel's map list,
 * the Studio's map list and the audit scripts, and nowhere else. It is an
 * authoring label, which is exactly why it is allowed to be derived.
 *
 * @param {object} map        the maps row / content file
 * @param {Map}    zoneById   every zone, by id
 * @returns {string|null}     null only when there is nothing to derive from AND
 *                            nothing authored — which lint reports as an error.
 */
export function deriveMapName(map, zoneById) {
  const authored = typeof map?.name === 'string' ? map.name.trim() : '';
  if (authored) return authored;
  const facade = map?.parent_zone_id ? zoneById?.get?.(map.parent_zone_id) : null;
  if (!facade) return null;
  // building_name over the tile's own name: the tile is the building's footprint,
  // and building_name is the field the rest of the engine treats as its identity.
  const derived = String(facade.flags?.building_name || facade.name || '').trim();
  return derived || null;
}

// The four directions a grid step can take. (x, y) only — see the vertical note.
export const CARDINAL = Object.freeze({ north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] });

// The reverse of every direction the world uses, including the ones no geometry
// implies. A direction absent here has no reverse and can only ever be one-way.
export const OPPOSITE = Object.freeze({
  north: 'south', south: 'north', east: 'west', west: 'east',
  up: 'down', down: 'up', in: 'out', out: 'in',
  northeast: 'southwest', southwest: 'northeast',
  northwest: 'southeast', southeast: 'northwest',
});

const byIdAsc = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
const cellKey = (z) => `${z.map_id}|${z.grid_x},${z.grid_y},${z.grid_z ?? 0}`;

/**
 * A facade is a building's street face. It is a wall on three sides and a door on
 * one, and WHICH one is authored (`flags.entrance`) precisely so terrain paint
 * cannot relocate it — the lesson of 2b6d0680. Without this the 62 facades open
 * on every side they touch: 280 doors nobody cut.
 */
const facadeBlocks = (z, dir) => !!z?.flags?.facade && z.flags.entrance !== dir;

/**
 * The city↔wilds curtain. Not an oversight and not terrain: the map editor
 * refuses to wire across it, routes.js will not re-open it, and
 * seal-wilds-boundary.mjs strips any crossing that appears. It is pierced in
 * exactly one place — The South Gate — which is a connection file, and the audit's
 * GATE-1 guards. A code-enforced invariant belongs in the projection, not in 268
 * identical files saying "still sealed".
 */
const crossesCurtain = (a, b) => (a?.flags?.district === 'wilds') !== (b?.flags?.district === 'wilds');

/**
 * Project the traversal graph.
 *
 * @param {Array} zones        every zone row / content file
 * @param {Array} connections  parsed content/connections/*.json
 * @returns {{ edges: Array, undeclaredOneWays: Array, unusedBlocks: Array }}
 *   edges — { from_zone, direction, to_zone, connection_id, kind } rows for
 *   zone_edges, id-sorted. `kind` is 'grid' (geometry), 'authored' (a file, same
 *   map) or 'portal' (a file joining two maps).
 */
export function projectEdges(zones = [], connections = []) {
  const sorted = [...zones].sort(byIdAsc);
  const byId = new Map(sorted.map(z => [z.id, z]));

  // Position index. A cell can legitimately hold more than one zone (6 do), so
  // this is a list and every occupant is a candidate neighbour.
  const byCell = new Map();
  for (const z of sorted) {
    if (z.map_id == null || z.grid_x == null || z.grid_y == null) continue;
    const k = cellKey(z);
    if (!byCell.has(k)) byCell.set(k, []);
    byCell.get(k).push(z);
  }

  const grid = new Map();   // `from|dir|to` → row
  for (const z of sorted) {
    if (!byCell.has(cellKey(z))) continue;
    for (const [dir, [dx, dy]] of Object.entries(CARDINAL)) {
      if (facadeBlocks(z, dir)) continue;
      const neighbours = byCell.get(`${z.map_id}|${z.grid_x + dx},${z.grid_y + dy},${z.grid_z ?? 0}`) || [];
      for (const n of neighbours) {
        if (facadeBlocks(n, OPPOSITE[dir])) continue;
        if (crossesCurtain(z, n)) continue;
        grid.set(`${z.id}|${dir}|${n.id}`, {
          from_zone: z.id, direction: dir, to_zone: n.id, connection_id: null, kind: 'grid',
        });
      }
    }
  }

  // Authored files, applied over the projection. A connection CLAIMS its
  // (from, direction): any grid edge on that key steps aside, so authoring a link
  // is how you redirect a step as well as how you add one. Two connections on the
  // same (from, direction) coexist — that is the elevator whose `up` serves five
  // floors, and dropping four of them is the failure the 3-part key exists to
  // prevent.
  const authored = [];
  const claimed = new Set();
  const blocked = new Set();
  const unusedBlocks = [];
  for (const c of [...connections].sort(byIdAsc)) {
    const a = byId.get(c.a), b = byId.get(c.b);
    if (!a || !b) continue;                      // lint reports the dangling end
    if (c.blocked) {
      for (const k of [`${c.a}|${c.dir}|${c.b}`, `${c.b}|${OPPOSITE[c.dir]}|${c.a}`]) {
        if (!grid.has(k)) continue;
        blocked.add(k);
      }
      // A wall that walls nothing is a file whose reason has been edited away —
      // the tiles moved apart, or a rule now covers it. Reported, not silent.
      if (!blocked.has(`${c.a}|${c.dir}|${c.b}`)) unusedBlocks.push(c.id);
      continue;
    }
    const kind = a.map_id === b.map_id ? 'authored' : 'portal';
    authored.push({ from_zone: c.a, direction: c.dir, to_zone: c.b, connection_id: c.id, kind });
    claimed.add(`${c.a}|${c.dir}`);
    if (!c.one_way && OPPOSITE[c.dir]) {
      authored.push({ from_zone: c.b, direction: OPPOSITE[c.dir], to_zone: c.a, connection_id: c.id, kind });
      claimed.add(`${c.b}|${OPPOSITE[c.dir]}`);
    }
  }

  const edges = [];
  for (const [k, row] of grid) {
    if (blocked.has(k)) continue;
    if (claimed.has(`${row.from_zone}|${row.direction}`)) continue;
    edges.push(row);
  }
  edges.push(...authored);
  edges.sort((x, y) => x.from_zone.localeCompare(y.from_zone)
    || x.direction.localeCompare(y.direction)
    || x.to_zone.localeCompare(y.to_zone));

  // The undeclared one-way (§7.5): a step that projects one way with nothing
  // saying so. A warp the map cannot draw and nobody chose. A file that says
  // `one_way` is a choice and does not appear here.
  const present = new Set(edges.map(e => `${e.from_zone}|${e.direction}|${e.to_zone}`));
  const declaredOneWay = new Set();
  for (const c of connections) {
    if (c.one_way && !c.blocked) declaredOneWay.add(`${c.a}|${c.dir}|${c.b}`);
  }
  const undeclaredOneWays = [];
  for (const e of edges) {
    const back = OPPOSITE[e.direction];
    if (!back) continue;
    if (present.has(`${e.to_zone}|${back}|${e.from_zone}`)) continue;
    if (declaredOneWay.has(`${e.from_zone}|${e.direction}|${e.to_zone}`)) continue;
    undeclaredOneWays.push(e);
  }
  return { edges, undeclaredOneWays, unusedBlocks };
}

/**
 * The exits-shaped view of a projected graph — the same `{ dir: id | [id, …] }`
 * object `zones.exits` holds, so the two can be compared field for field. This is
 * what makes §11 step 6's "cut over only when they agree" a check rather than a
 * hope, and after the cutover it is how zone_edges presents itself to a runtime
 * that still thinks in exits.
 */
export function edgesToExits(edges = []) {
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.from_zone)) out.set(e.from_zone, {});
    const bag = out.get(e.from_zone);
    const cur = bag[e.direction];
    if (cur === undefined) bag[e.direction] = e.to_zone;
    else if (Array.isArray(cur)) cur.push(e.to_zone);
    else bag[e.direction] = [cur, e.to_zone];
  }
  return out;
}

/**
 * The render spec (§2.3) — the ONLY channel between derive and any renderer.
 * Every renderer reads these values; none of them looks up a palette, and none
 * of them can invent a colour the build didn't produce.
 */
export function buildRenderSpec(zone, palette, resolved) {
  const entry = paletteEntry(zone, palette);
  const spec = {
    fill: resolved.bg_color,
    text: resolved.color,
    glyph: resolved.marker,
    minimap_class: entry?.minimap_class ?? null,
    terrain: resolveTerrain(zone),
    auto_tile: !!entry?.auto_tile,
    speed_mult: entry?.speed_mult ?? 1,
  };
  // Facade-only and building-only extras, present just when they mean something
  // — a spec key that is null on 5,700 tiles teaches a renderer to test for it.
  const entrance = zone?.flags?.entrance;
  if (entrance) spec.entrance = entrance;
  const floors = Number(zone?.flags?.floors);
  if (Number.isFinite(floors) && floors > 0) spec.height = floors;
  return spec;
}

/**
 * The whole-map pass. PURE — the caller reads content and hands over plain
 * objects, so a `query()` written in here has nothing to call (§7.1).
 *
 * @param {object} input
 * @param {Array}  input.zones     every zone row / content file
 * @param {Array}  [input.regions] region rows, for the region rung of resolveDefault
 * @param {Array}  [input.connections] parsed content/connections/*.json (§1.4)
 * @param {object} [input.palette] parsed content/map/terrain.json
 * @returns {{ render: Map<string, object>, edges: Array, index: object|null }}
 */
export function deriveWorld({ zones = [], regions = [], connections = [], palette = null } = {}) {
  const regionById = new Map(regions.map(r => [r.id, r]));
  const render = new Map();
  // Whole-map first: a building's code has to be unique across every building, so
  // it cannot be a per-tile function. Collisions come back rather than being
  // silently resolved — an authored duplicate is a human decision to unpick.
  const { markers: buildingMarkers, collisions } = assignBuildingMarkers(zones);
  const ctx = { buildingMarkers };

  // Sorted iteration: derive must not depend on which rows the upsert happened
  // to touch, or on a Map's insertion order (§7.2).
  for (const zone of [...zones].sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)) {
    const region = zone?.flags?.region_id ? regionById.get(zone.flags.region_id) ?? null : null;
    const { color, bg_color } = deriveColors(zone, palette);
    const resolved = {
      marker: deriveMarker(zone, palette, ctx),
      color,
      bg_color,
      icon: zone?.flags?.icon ?? null,   // derived-only slot; §5.4's authored icon dies in step 4
      ambient_theme: resolveDefault('ambient_theme', zone, region, palette),
      audio_theme_id: resolveDefault('audio_theme_id', zone, region, palette),
    };
    const entry = paletteEntry(zone, palette);
    render.set(zone.id, {
      zone_id: zone.id,
      ...resolved,
      minimap_class: entry?.minimap_class ?? null,
      glyph: resolved.marker,
      spec: buildRenderSpec(zone, palette, resolved),
    });
  }

  // The traversal graph. Built and written, but NOT yet read: `zones.exits` is
  // still the source of truth the engine boots from, and the two are held to
  // exact agreement by regress (§11 step 6). Deleting `exits` is §5 and its own
  // step — this one only earns the right to.
  const { edges, undeclaredOneWays, unusedBlocks } = projectEdges(zones, connections);

  return { render, edges, index: null, markerCollisions: collisions, undeclaredOneWays, unusedBlocks };
}
