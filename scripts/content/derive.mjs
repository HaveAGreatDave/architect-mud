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
// Not here yet: `projectEdges` (§7.5, step 6), `deriveMarker`'s four cases (§7.4,
// step 4), and `content/map/index.json` (§2.4). `edges` comes back empty and
// callers must not read it as "no edges exist".

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
 * @param {object} [input.palette] parsed content/map/terrain.json
 * @returns {{ render: Map<string, object>, edges: Array, index: object|null }}
 */
export function deriveWorld({ zones = [], regions = [], palette = null } = {}) {
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

  // edges: §7.5, step 6. Empty is NOT "this world has no edges" — `exits` is
  // still the source of truth until that step lands.
  return { render, edges: [], index: null, markerCollisions: collisions };
}
